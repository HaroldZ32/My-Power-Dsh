// DIAGNOSTIC PROBE (D-1) — a real harness row that reproduces the mpd-codegraph row's shape.
//
// It declares `inject = []`, exactly like `packages/mpd-codegraph-plugin/src/index.ts`, so it is
// mounted at the SAME point of the loader's first apply pass, and it is inserted LAST in the
// composition (a `--patch` overlay `insert:`) so it can never win a race by being early.
//
// WHAT IT RECORDS (NDJSON, one line per observation, written synchronously):
//   • at `apply`: the strict service reads the ADAPTER itself performs (`ctx.get("commands")`,
//     `ctx.get("mpdDsh")`), the LIVE fiber state of every watched row, and the outcome of a
//     throwaway `commands.register()` attempted through the strict lookup — the exact call the
//     adapter's `registerCommand` makes;
//   • on every poll: the same strict/loose reads, so the instant `commands` turns ACTIVE is visible;
//   • on the first poll where the strict read succeeds: a SECOND throwaway registration, which
//     decides whether a LATE registration lands in the registry the session's agent reads;
//   • at the horizon: for every watched row, `commands` read through THAT ROW'S OWN scoped ctx
//     (`entry.fiber.ctx.get("commands")`), which is the isolation test between the row that failed
//     and the registry every other row reaches.
//
// It ASSERTS NOTHING and never throws: every failure is recorded as a field, because a probe that
// takes the boot down would destroy the measurement it exists for.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/** The row id this probe is mounted under (asserted by the driver). */
export const name = "qa-cg-probe-early"

/** No declared dependencies: this is the DEFECT'S OWN SHAPE, and the whole point of the probe. */
export const inject: string[] = []

/** The rows whose fiber state is tracked: the command registry, the adapter, and every command contributor. */
const WATCHED: readonly string[] = [
  "commands", "tools", "mpd-dsh-adapter", "mpd-codegraph", "mpd-ulw", "mpd-cellwork", "mpd-team-core", "preset-mpd",
]

/** The throwaway names this probe registers, one per moment it CAN reach the registry. */
const EARLY_NAME = "qa-cg-early"
/** The name registered on the first poll where the strict lookup finally answers. */
const LATE_NAME = "qa-cg-late"

/** The probe row's config, as the overlay declares it. */
interface ProbeConfig {
  /** Absolute directory the NDJSON record is written into; required. */
  outDir?: string
  /** How long the poll window runs, in milliseconds (default 4000). */
  horizonMs?: number
  /** The interval between polls, in milliseconds (default 10). */
  pollMs?: number
  /** The session workspace, so the codegraph plugin's own sink can be timestamped. */
  ws?: string
}

/** The slice of the cordis ctx this probe reads. */
interface ProbeContext {
  /**
   * @param serviceName The harness service name.
   * @param strict `true` (the default) answers only an ACTIVE provider — the adapter's own read.
   * @returns The service value, or undefined when it is not (yet) ACTIVE.
   */
  get?: (serviceName: string, strict?: boolean) => unknown
  /**
   * @param callback The snapshot to run later.
   * @param ms Delay in milliseconds.
   * @returns A disposer when the scope offers one.
   */
  setTimeout?: (callback: () => void, ms: number) => unknown
}

/** The fiber fields this probe reads off a loader entry. */
interface FiberLike {
  /** Cordis lifecycle state: 0 pending, 1 loading, 2 active, 3 failed, 4 disposed. */
  state?: unknown
  /** The applied plugin instance, present once the row really ran. */
  runtime?: unknown
  /** The fiber's OWN scoped context — the isolation test this probe exists to make. */
  ctx?: ProbeContext
  /** Older cordis spelling of the same field. */
  context?: ProbeContext
}

/** One loader entry as this probe reads it. */
interface LoaderEntryLike {
  /** The patch row's declared id and disabled flag. */
  options?: { id?: unknown; disabled?: unknown }
  /** The entry's fiber. */
  fiber?: FiberLike
}

/** The live loader service. */
interface LoaderLike {
  /** @returns Every composed entry, in loader order. */
  entries?: () => Iterable<LoaderEntryLike>
}

/** The live command registry slice this probe calls. */
interface CommandsLike {
  /** @param definition A full command definition; the host validates it. */
  register?: (definition: Record<string, unknown>) => unknown
  /** @param agent The agent whose effective view is listed. */
  list?: (agent: unknown) => Array<{ name?: unknown }>
}

/** The live agent registry slice this probe reads. */
interface AgentsLike {
  /** @returns Every live agent. */
  list?: () => Array<{ session?: { header?: { agentPreset?: unknown } } }>
}

/** What one strict/loose service read answered. */
interface ServiceRead {
  /** The strict read (`ctx.get(name)`), which is what the adapter performs. */
  strict: boolean
  /** The non-strict read (`ctx.get(name, false)`), which ignores the provider's fiber state. */
  loose: boolean
  /** The strict read's thrown message, when it threw at all. */
  error: string
}

/** The rendered reason of a thrown value, for a record that must never throw. */
function messageOf(error: unknown): string {
  try {
    const candidate = error as { message?: unknown } | null
    return String(candidate?.message ?? error)
  } catch { return "<unrenderable thrown value>" }
}

/**
 * Read one service strictly and loosely.
 * @param ctx The context to read from.
 * @param serviceName The harness service id.
 * @returns Both answers plus a thrown strict read's message.
 */
function readService(ctx: ProbeContext, serviceName: string): ServiceRead {
  /** The strict answer; the adapter's own `service()` helper reads exactly this way. */
  let strict = false
  /** The non-strict answer, which proves the service EXISTS even before its fiber is ACTIVE. */
  let loose = false
  /** The strict read's thrown message, `""` when it did not throw. */
  let error = ""
  try { strict = (ctx.get?.(serviceName) ?? undefined) !== undefined } catch (thrown) { error = messageOf(thrown) }
  try { loose = (ctx.get?.(serviceName, false) ?? undefined) !== undefined } catch { /* recorded by the strict arm */ }
  return { strict, loose, error }
}

/**
 * The loader's view of every watched row.
 * @param ctx The context to read the loader from (never strict: the probe must not depend on it).
 * @returns One `{id,state,disabled}` record per watched row, plus the loader's entry total.
 */
function readRows(ctx: ProbeContext): { entries: number; rows: Record<string, { state: number | null; disabled: boolean; runtime: boolean }> } {
  /** The per-row answers, keyed by the patches' own ids. */
  const rows: Record<string, { state: number | null; disabled: boolean; runtime: boolean }> = {}
  /** The loader's entry total, 0 when it cannot be read. */
  let entries = 0
  try {
    const loader = ctx.get?.("loader", false) as LoaderLike | undefined
    const all = loader?.entries === undefined ? [] : [...loader.entries()]
    entries = all.length
    for (const entry of all) {
      const id = typeof entry.options?.id === "string" ? entry.options.id : ""
      if (!WATCHED.includes(id)) continue
      rows[id] = {
        state: typeof entry.fiber?.state === "number" ? entry.fiber.state : null,
        disabled: entry.options?.disabled === true,
        runtime: entry.fiber?.runtime !== undefined,
      }
    }
  } catch { /* an unreadable loader is recorded as zero entries */ }
  return { entries, rows }
}

/**
 * Attack the registry exactly the way the defect does: through the STRICT lookup only.
 * @param ctx The row's own context.
 * @param commandName The throwaway command name to register.
 * @returns Whether the registration reached the host registry, and why not when it did not.
 */
function attemptRegister(ctx: ProbeContext, commandName: string): { ok: boolean; reason: string; disposer: string } {
  /** The strict service read; `undefined` here is the silent no-op the adapter turns into a noop disposer. */
  let commands: CommandsLike | undefined
  try { commands = ctx.get?.("commands") as CommandsLike | undefined } catch (thrown) { return { ok: false, reason: "strict read threw: " + messageOf(thrown), disposer: "none" } }
  if (commands === undefined || commands === null) return { ok: false, reason: "strict read answered undefined (no ACTIVE provider) — the adapter returns noop", disposer: "noop" }
  if (typeof commands.register !== "function") return { ok: false, reason: "service exposes no register()", disposer: "none" }
  try {
    const registered = commands.register({
      name: commandName,
      description: "diagnostic probe registration (" + commandName + ")",
      handler: () => ({ kind: "success", text: "probe " + commandName }),
    })
    return { ok: true, reason: "registered", disposer: typeof registered === "function" ? "effect" : "non-callable" }
  } catch (thrown) { return { ok: false, reason: "register threw: " + messageOf(thrown), disposer: "none" } }
}

/**
 * The per-agent command view, read from the root context's registry.
 * @param ctx The probe row's context.
 * @returns The agent count, the first agent's preset, and the names it really lists.
 */
function readAgentView(ctx: ProbeContext): { agents: number; preset: string | null; names: string[] } {
  try {
    const agents = ctx.get?.("agents", false) as AgentsLike | undefined
    const live = typeof agents?.list === "function" ? agents.list() : []
    if (live.length === 0) return { agents: 0, preset: null, names: [] }
    const commands = ctx.get?.("commands", false) as CommandsLike | undefined
    const listed = typeof commands?.list === "function" ? commands.list(live[0]) : []
    const preset = live[0]?.session?.header?.agentPreset
    return {
      agents: live.length,
      preset: typeof preset === "string" ? preset : null,
      names: listed.map((entry) => String(entry?.name ?? "")).filter((entry) => entry !== ""),
    }
  } catch { return { agents: -1, preset: null, names: [] } }
}

/**
 * The codegraph plugin's own sink, which it writes synchronously at its apply moment.
 * @param ws The session workspace, or undefined when the config omits it.
 * @returns The sink's byte size and mtime, or nulls when it does not exist yet.
 */
function readCodegraphSink(ws: string | undefined): { exists: boolean; mtime: string | null; bytes: number } {
  if (ws === undefined) return { exists: false, mtime: null, bytes: 0 }
  try {
    const sink = join(ws, ".mpd", "logs", "mpd-codegraph.log")
    if (!existsSync(sink)) return { exists: false, mtime: null, bytes: 0 }
    const stat = statSync(sink)
    return { exists: true, mtime: new Date(stat.mtimeMs).toISOString(), bytes: stat.size }
  } catch { return { exists: false, mtime: null, bytes: 0 } }
}

/**
 * The mount: record the apply-time truth, then poll until the horizon.
 * @param ctx The row context.
 * @param config The overlay's config (`outDir`, `horizonMs`, `pollMs`, `ws`).
 * @returns Nothing; every observation lands in the NDJSON file.
 */
export function apply(ctx: ProbeContext, config: ProbeConfig = {}): void {
  /** Where the NDJSON record lands. */
  const outDir = String(config.outDir ?? "")
  /** The poll window's length in milliseconds. */
  const horizonMs = Number(config.horizonMs ?? 4_000)
  /** The poll interval in milliseconds. */
  const pollMs = Number(config.pollMs ?? 10)
  /** The session workspace, for the codegraph sink timestamp. */
  const ws = config.ws === undefined ? undefined : String(config.ws)
  /** The file every observation is appended to. */
  const outFile = join(outDir, "probe-early.ndjson")
  /** The instant the probe's own apply began. */
  const startedAt = Date.now()
  /** Set once the late registration has been attempted, so it happens exactly once. */
  let lateAttempted = false

  /** Append one record synchronously; a write failure is silent by design. */
  const emit = (record: Record<string, unknown>): void => {
    try {
      mkdirSync(outDir, { recursive: true })
      appendFileSync(outFile, JSON.stringify(record) + "\n")
    } catch { /* a probe that cannot write must not disturb the boot */ }
  }

  /** One observation: the service reads, the row states and (late enough) the agent view. */
  const snapshot = (phase: string, ordinal: number): void => {
    /** The strict/loose reads the adapter itself performs. */
    const commands = readService(ctx, "commands")
    /** Whether the adapter ROW is ACTIVE — the other half of the same race. */
    const mpdDsh = readService(ctx, "mpdDsh")
    /** The loader's row states at this instant. */
    const rows = readRows(ctx)
    /** The per-agent command view; empty until a session exists. */
    const view = readAgentView(ctx)
    emit({
      phase, ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt,
      commands, mpdDsh, loaderEntries: rows.entries, rows: rows.rows,
      agents: view.agents, preset: view.preset, listing: view.names,
      codegraphSink: readCodegraphSink(ws),
    })
  }

  // 1. THE APPLY MOMENT — the row's own shape, and the registration the defect makes.
  snapshot("apply", 0)
  emit({ phase: "apply-register", ordinal: 0, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt, command: EARLY_NAME, outcome: attemptRegister(ctx, EARLY_NAME) })

  /** @param callback The deferred observation. @param ms The delay. */
  const later = (callback: () => void, ms: number): void => {
    try { ctx.setTimeout?.(callback, ms) ?? setTimeout(callback, ms) } catch { setTimeout(callback, ms) }
  }

  /** How many polls fit in the window. */
  const polls = Math.max(1, Math.floor(horizonMs / Math.max(1, pollMs)))
  for (let ordinal = 1; ordinal <= polls; ordinal += 1) {
    later(() => {
      snapshot("poll", ordinal)
      // 2. THE FIRST MOMENT THE STRICT READ SUCCEEDS — register then (a late registration that
      //    lands proves the registry accepts latecomers; one that does not proves the entry is
      //    filtered, which is a different mechanism entirely).
      const commands = readService(ctx, "commands")
      if (!lateAttempted && commands.strict) {
        lateAttempted = true
        emit({ phase: "late-register", ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt, command: LATE_NAME, outcome: attemptRegister(ctx, LATE_NAME) })
      }
      if (ordinal === polls) {
        // 3. THE ISOLATION TEST: does EACH row's own scoped ctx reach the service now?
        const byRow: Record<string, { rowSeesCommands: boolean; rowSeesMpdDsh: boolean }> = {}
        try {
          const loader = ctx.get?.("loader", false) as LoaderLike | undefined
          for (const entry of loader?.entries?.() ?? []) {
            const id = typeof entry.options?.id === "string" ? entry.options.id : ""
            if (!WATCHED.includes(id)) continue
            const rowCtx = entry.fiber?.ctx ?? entry.fiber?.context
            byRow[id] = { rowSeesCommands: readService(rowCtx ?? {}, "commands").strict, rowSeesMpdDsh: readService(rowCtx ?? {}, "mpdDsh").strict }
          }
        } catch (thrown) { byRow["<read>"] = { rowSeesCommands: false, rowSeesMpdDsh: false }; emit({ phase: "row-ctx-error", reason: messageOf(thrown) }) }
        emit({ phase: "row-ctx", ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt, byRow, listing: readAgentView(ctx).names })
        // A LAST registration at the horizon, through the strict read, as the final falsifier.
        emit({ phase: "final-register", ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt, command: EARLY_NAME + "-final", outcome: attemptRegister(ctx, EARLY_NAME + "-final") })
      }
    }, pollMs * ordinal)
  }
}
