#!/usr/bin/env node
// QA probe row for the user-surface gate (`user-surface-mount.ts`). Mounted INSIDE a real boot by
// appending it to the SANDBOX PROFILE's own user layer — never by a `--patch` overlay of product
// rows, so the artifact's rows stay the only subject and the probe stays instrumentation.
//
// WHAT IT RECORDS, and why each reading is needed:
//   • `loaderRows` — `ctx.loader.entries()` mapped to `{id,state,hasRuntime,disabled}`. This is the
//     harness's OWN view of the composed tree: a row the loader does not hold was never composed, and
//     a row whose fiber state is not 2 (ACTIVE) never applied. It is the only per-row witness that
//     works for a row that writes no log sink and names no inspectable tool/command.
//   • `commands` — the LIVE `commands` service, listed for the session's own agent on the first
//     `agent/pre-step`. Reading the registry (not a source grep, not `--dump-config`) is what makes
//     a command assertion evidence; the per-agent view is where the preset's rows appear.
//   • `tools` — `tools.schemas()` names, the registrations a row can be witnessed by.
//   • `services` — optional reads of the bundle's own service ids, so a row that provides a service
//     instead of a tool still has a registration witness available to the case.
//
// IT ASSERTS NOTHING and never throws: every assertion lives in the case, and a probe failure must
// degrade the case to "no observation" rather than fail the boot it is measuring.
import { appendFileSync, writeFileSync } from "node:fs"

/** The probe row's plugin id, asserted by the case so an overlay cannot silently replace it. */
export const name: string = "qa-user-surface-probe"

/** The one harness service the mount must wait for before `apply` runs. */
export const inject: readonly string[] = ["commands"]

/** The bundle service ids the probe asks about by name, for the registration witness. */
const SERVICE_IDS: readonly string[] = [
  "mpdConfig", "mpdDsh", "mpdTui", "mpdTeams", "mpdGoal", "mpdExtensions", "mpdBoulder",
  "mpdMemory", "mpdHashline", "mpdRoles", "tuiPanels", "tuiCommands", "commands", "tools",
]

/** One row as the live loader held it. */
interface LoaderRow {
  /** The loader entry's id, which is the patch row's id. */
  id: string
  /** The cordis fiber state (0 pending, 1 loading, 2 active, 3 failed, 4 disposed); null when absent. */
  state: number | null
  /** True when the applied fiber carries a runtime, i.e. the plugin instance exists. */
  hasRuntime: boolean
  /** True when the entry is declared disabled, i.e. composed and deliberately never applied. */
  disabled: boolean
  /** Which loader the entry was read from: the root tree, or the session agent's own preset realm. */
  scope: string
}

/** The probe's whole record, written once per boot to `config.outFile`. */
interface ProbeRecord {
  /** Which trigger produced this record: a settle tick, or the first agent step. */
  phase: string
  /** The tick ordinal, so a reader can tell the last snapshot from an early one. */
  tick: number
  /** ISO instant the snapshot was taken. */
  at: string
  /** Every loader entry the boot composed, in loader order. */
  loaderRows: LoaderRow[]
  /** The command names the live registry listed for the session's agent. */
  commands: string[]
  /** The agent preset the listing was taken for, as the harness recorded it. */
  agentPreset: string | null
  /** How many live agents the harness reported when the listing was taken. */
  agentCount: number
  /** Every tool name the live registry answered to at record time. */
  tools: string[]
  /** Optional service reads, `true` when `ctx.get(id, false)` answered. */
  services: Record<string, boolean>
  /** Structural problems the probe hit while reading; never fatal, always quoted. */
  problems: string[]
}

/** The slice of the cordis ctx this probe reads (only the seams it declares). */
interface ProbeContext {
  /**
   * @param event The harness event name to listen on.
   * @param listener The waterfall listener, awaited by the dispatcher.
   */
  on(event: string, listener: (payload: AgentStepPayload, next?: () => Promise<unknown>) => Promise<unknown>): void
  /**
   * @param serviceName The harness service name.
   * @param strict `false` reads the service WITHOUT declaring an inject dependency.
   * @returns The mounted service, or undefined when it is absent.
   */
  get?(serviceName: string, strict?: boolean): unknown
  /**
   * @param callback The snapshot to run later.
   * @param ms Delay in milliseconds.
   * @returns A disposer, when the scope offers one.
   */
  setTimeout?(callback: () => void, ms: number): unknown
}

/** The `agent/pre-step` payload fields the probe reads. */
interface AgentStepPayload {
  /** The agent the step belongs to; its `session` header names the preset. */
  agent?: { session?: { header?: { agentPreset?: unknown } } }
}

/** The probe row's config, as the sandbox profile's user layer declares it. */
interface ProbeConfig {
  /** Absolute path of the JSON document the probe records into; required. */
  outFile?: string
  /** How long to wait before the settle snapshot, in milliseconds (default 15000). */
  settleMs?: number
  /**
   * How many snapshots to take after `apply`, counted in TICKS OF `settleMs` (not milliseconds), the
   * n-th landing at `settleMs * n`; the last tick wins, so this is how long a turn the record covers.
   * Optional because the YAML row may omit it and the probe then uses the default of 20 ticks.
   */
  ticks?: number
}

/**
 * The entries of one loader, or an empty list when it cannot be read.
 *
 * TWO SCOPES EXIST, and a preset row only lives in the second one: the ROOT tree holds the profile's
 * host rows plus the preset ENTRY, while the `mpd` preset's own rows are created inside the session
 * agent's realm (`agent.ctx.loader`). Measured 2026-10-27: read from the root alone, 24 preset rows
 * looked "composed but never applied" and 9 looked absent, while the same boot served their tools and
 * commands to the session.
 * @param source The loader service (root ctx's, or an agent ctx's).
 * @param scope The label stamped onto every row.
 * @param problems Collector for the reason an empty list came back.
 * @returns One record per composed loader entry.
 */
function loaderRowsOf(source: unknown, scope: string, problems: string[]): LoaderRow[] {
  try {
    /** The loader service as this probe reads it. */
    const loader = source as { entries?: () => Iterable<{ options?: { id?: unknown; disabled?: unknown }; fiber?: { state?: unknown; runtime?: unknown } }> } | undefined
    if (loader?.entries === undefined) { problems.push(scope + ": loader.entries() is not reachable"); return [] }
    /** The mapped entries, in loader order. */
    const rows: LoaderRow[] = []
    for (const entry of loader.entries()) {
      /** The entry's declared id, which the patch row also declares. */
      const id = typeof entry.options?.id === "string" ? entry.options.id : ""
      if (id === "") continue
      rows.push({
        id,
        state: typeof entry.fiber?.state === "number" ? entry.fiber.state : null,
        hasRuntime: entry.fiber?.runtime !== undefined,
        disabled: entry.options?.disabled === true,
        scope,
      })
    }
    return rows
  } catch (error) {
    problems.push(scope + ": reading the loader entries threw: " + String((error as { message?: unknown } | null)?.message ?? error))
    return []
  }
}

/**
 * The live loader's ROOT entries.
 * @param ctx The booted row's ctx.
 * @param problems Collector for the reason an empty list came back.
 * @returns One record per composed root entry.
 */
function readLoaderRows(ctx: ProbeContext, problems: string[]): LoaderRow[] {
  return loaderRowsOf(ctx.get?.("loader", false), "root", problems)
}

/**
 * The live tool names, read through the registry's own listing.
 * @param ctx The booted row's ctx.
 * @param problems Collector for the reason an empty list came back.
 * @returns The registered tool names.
 */
function readToolNames(ctx: ProbeContext, problems: string[]): string[] {
  try {
    /** The tool registry, read without an inject dependency so a missing seam cannot block the mount. */
    const tools = ctx.get?.("tools", false) as { schemas?: () => Array<{ name?: unknown }> } | undefined
    if (tools?.schemas === undefined) { problems.push("tools.schemas() is not reachable from this boot"); return [] }
    return (tools.schemas() ?? []).map((schema) => String(schema?.name ?? "")).filter((entry) => entry !== "")
  } catch (error) {
    problems.push("reading the tool registry threw: " + String((error as { message?: unknown } | null)?.message ?? error))
    return []
  }
}

/**
 * The live command names for one agent, read from the harness's own registry.
 * @param ctx The booted row's ctx.
 * @param agent The agent whose command view is listed.
 * @param problems Collector for the reason an empty list came back.
 * @returns The listed command names, without the leading slash.
 */
function readCommandNames(ctx: ProbeContext, agent: unknown, problems: string[]): string[] {
  try {
    /** The command registry service. */
    const commands = ctx.get?.("commands", false) as { list?: (agent: unknown) => Array<{ name?: unknown }> } | undefined
    if (commands?.list === undefined) { problems.push("commands.list() is not reachable from this boot"); return [] }
    return (commands.list(agent) ?? []).map((entry) => String(entry?.name ?? "")).filter((entry) => entry !== "")
  } catch (error) {
    problems.push("listing the command registry threw: " + String((error as { message?: unknown } | null)?.message ?? error))
    return []
  }
}

/** The slice of one live Agent this probe reads. */
interface LiveAgent {
  /** The agent's session, whose header names the preset the session runs. */
  session?: { header?: { agentPreset?: unknown } }
  /** The agent's OWN scoped ctx, where its preset's rows live. */
  ctx?: { loader?: unknown; tools?: { schemas?: (agent?: unknown) => Array<{ name?: unknown }> } }
}

/**
 * The live agents the harness's own registry reports.
 *
 * WHY THE REGISTRY AND NOT `agent/pre-step`: the settle snapshot has to be self-sufficient. A TUI
 * boot with no model turn never emits a pre-step, so a listing taken only there would be empty on
 * every run that does not drive a turn — and an empty listing reads as "no command is registered",
 * which is the exact false red this case must not produce.
 * @param ctx The booted row's ctx.
 * @param problems Collector for the reason an empty list came back.
 * @returns The live agents, empty when the service is absent.
 */
function readLiveAgents(ctx: ProbeContext, problems: string[]): LiveAgent[] {
  try {
    /** The agent registry service, read without an inject dependency. */
    const agents = ctx.get?.("agents", false) as { list?: () => LiveAgent[] } | undefined
    if (agents?.list === undefined) { problems.push("agents.list() is not reachable from this boot"); return [] }
    return agents.list() ?? []
  } catch (error) {
    problems.push("listing the live agents threw: " + String((error as { message?: unknown } | null)?.message ?? error))
    return []
  }
}

/**
 * The optional bundle service ids by name.
 * @param ctx The booted row's ctx.
 * @returns One boolean per probed id.
 */
function readServices(ctx: ProbeContext): Record<string, boolean> {
  /** The answers, keyed by service id. */
  const services: Record<string, boolean> = {}
  for (const id of SERVICE_IDS) {
    try { services[id] = ctx.get?.(id, false) !== undefined } catch { services[id] = false }
  }
  return services
}

/**
 * Write one snapshot to the evidence path, atomically enough for a reader that polls it.
 * @param outFile Absolute path of the record.
 * @param record The record to serialize.
 * @param problems The structural problems collected while reading.
 */
function emit(outFile: string, record: ProbeRecord, problems: string[]): void {
  if (outFile === "") return
  /** The record with its problems list finalized. */
  const body: ProbeRecord = { ...record, problems }
  try {
    writeFileSync(outFile + ".tmp", JSON.stringify(body, null, 2) + "\n")
    writeFileSync(outFile, JSON.stringify(body, null, 2) + "\n")
  } catch (error) {
    // A probe that cannot write must leave a trace somewhere: the boot's own console is the last resort.
    try { appendFileSync(outFile + ".errors", String((error as { message?: unknown } | null)?.message ?? error) + "\n") } catch { /* nothing left to try */ }
  }
}

/**
 * The row's entry point: snapshot the loader after a settle window, then refine the command listing
 * on the first real agent step (the only moment a per-agent command view exists).
 * @param ctx The booted row's ctx.
 * @param config The row's config (`outFile`, optional `settleMs`).
 */
export async function apply(ctx: ProbeContext, config: ProbeConfig): Promise<void> {
  /** Where every snapshot lands. */
  const outFile = String(config?.outFile ?? "")
  /** The interval between snapshots. */
  const settleMs = Number(config?.settleMs ?? 8_000)
  /** How many snapshots to take; the LAST one wins, so a post-turn snapshot replaces an early one. */
  const ticks = Number(config?.ticks ?? 20)
  /** Problems hit while reading; re-reported with each snapshot. */
  const problems: string[] = []
  /** The tool names, read once: the registry is stable early. */
  const tools = readToolNames(ctx, problems)
  /** The service reads, taken with the same snapshot. */
  const services = readServices(ctx)

  /**
   * Take one snapshot of the live loader, the agent registry and the per-agent command view.
   * @param phase The trigger that produced it.
   * @param tick The tick ordinal; 0 for the apply-time baseline.
   */
  const snap = (phase: string, tick: number): void => {
    /** The live agents at snapshot time; the first one is the session the TUI attached. */
    const liveAgents = readLiveAgents(ctx, problems)
    /** The preset the first live agent's session runs. */
    const preset = liveAgents[0]?.session?.header?.agentPreset
    /** The ROOT tree's rows. */
    const rootRows = readLoaderRows(ctx, problems)
    /** The session agent's OWN preset-realm rows, when an agent exists. */
    const agentRows = liveAgents.length === 0 ? [] : loaderRowsOf(liveAgents[0]?.ctx?.loader, "agent", problems)
    /** The number of entries the two scopes produced, quoted in the ledger's own fields. */
    const scopeTotal = rootRows.length + agentRows.length
    /** The per-agent command view; empty until a session exists. */
    const commands = liveAgents.length === 0 ? [] : readCommandNames(ctx, liveAgents[0], problems)
    /** The merged view: the agent's own entry WINS over a root copy of the same id, because only the
     * agent-scoped fibre says whether the row really applied for this session. */
    const merged = new Map<string, LoaderRow>()
    for (const row of rootRows) merged.set(row.id, row)
    for (const row of agentRows) {
      /** The root-scope entry this agent-scoped one may replace. */
      const prior = merged.get(row.id)
      if (prior === undefined || (row.state === 2 && prior.state !== 2) || (row.disabled === false && prior.disabled)) merged.set(row.id, row)
    }
    emit(outFile, {
      phase,
      tick,
      at: new Date().toISOString(),
      loaderRows: [...merged.values()],
      commands,
      agentPreset: typeof preset === "string" ? preset : null,
      agentCount: liveAgents.length,
      tools,
      services,
      problems,
    }, problems)
    // A compact per-tick ledger: the evidence must show WHEN the tree became active, not only its end
    // state, because "the rows were never composed" and "the rows applied late" look identical in a
    // single snapshot and only the second one is healthy.
    try {
      appendFileSync(outFile + ".ticks.ndjson", JSON.stringify({
        scopes: scopeTotal,
        phase, tick, at: new Date().toISOString(), agentCount: liveAgents.length, commands: commands.length,
        entries: merged.size,
        rootEntries: rootRows.length,
        agentEntries: agentRows.length,
        active: [...merged.values()].filter((row) => row.state === 2 && row.hasRuntime).length,
        noFiber: [...merged.values()].filter((row) => row.state === null && !row.disabled).length,
        failed: [...merged.values()].filter((row) => row.state === 3 || row.state === 4).length,
      }) + "\n")
    } catch { /* the ledger is best-effort; the main record above is not */ }
  }

  // The FIRST agent step is the moment a per-agent command view definitely exists; snapshot there too.
  ctx.on("agent/pre-step", async () => {
    snap("agent-pre-step", 0)
    return undefined
  })

  // THE BASELINE IS TAKEN NOW, AND EVERY LATER SNAPSHOT IS DEFERRED — never awaited.
  //
  // MEASURED DEFECT (2026-10-27): an `apply` that AWAITED its settle window (18 × 8 s) delayed the
  // boot's own readiness by the same 144 s, and a 44-tick variant exceeded the readiness budget
  // outright: the host's pane still read `正在启动 DSH…` at 180 s while every assertion below was
  // green-in-waiting. The loader treats a plugin's `apply` promise as part of the boot, so this probe
  // must SCHEDULE its observations and return immediately.
  snap("apply", 0)
  /** The scoped timer when the ctx offers one, so the callbacks are disposed with the fiber. */
  const later = (callback: () => void, ms: number): void => {
    try { ctx.setTimeout?.(callback, ms) ?? setTimeout(callback, ms) } catch { setTimeout(callback, ms) }
  }
  for (let tick = 1; tick <= ticks; tick += 1) later(() => snap("tick-" + String(tick), tick), settleMs * tick)
  return undefined
}
