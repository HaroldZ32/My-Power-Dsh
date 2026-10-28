// DIAGNOSTIC PROBE (D-1) — the CONTRAST arm for probe-early.ts.
//
// It is the same row in every respect EXCEPT `inject`, which names the one harness service the
// defect's registration needs: `commands`. Cordis applies a row only once every declared dependency
// is ACTIVE, so this row's apply is the moment the probe-early row would have needed.
//
// It records the same observations and attempts the same throwaway registration (its own name), so
// the two NDJSON files differ by exactly one variable: the declared dependency.
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/** The row id this probe is mounted under (asserted by the driver). */
export const name = "qa-cg-probe-late"

/** The one harness service the mount waits for: the registry the defect fails to reach. */
export const inject: string[] = ["commands"]

/** The row this probe's own context is compared against. */
const COUNTERPART = "mpd-codegraph"

/** The pre-registered name: a registration through the strict read from a row cordis let wait. */
const INJECTED_NAME = "qa-cg-inject"

/** The probe row's config, as the overlay declares it. */
interface ProbeConfig {
  /** Absolute directory the NDJSON record is written into; required. */
  outDir?: string
  /** How long the poll window runs, in milliseconds (default 3000). */
  horizonMs?: number
  /** The interval between polls, in milliseconds (default 10). */
  pollMs?: number
}

/** The slice of the cordis ctx this probe reads. */
interface ProbeContext {
  /**
   * @param serviceName The harness service name.
   * @param strict `true` (the default) answers only an ACTIVE provider.
   * @returns The service value, or undefined when it is not available.
   */
  get?: (serviceName: string, strict?: boolean) => unknown
  /**
   * @param callback The snapshot to run later.
   * @param ms Delay in milliseconds.
   * @returns A disposer when the scope offers one.
   */
  setTimeout?: (callback: () => void, ms: number) => unknown
}

/** The fiber fields read off a loader entry. */
interface FiberLike {
  /** Cordis lifecycle state: 0 pending, 1 loading, 2 active, 3 failed, 4 disposed. */
  state?: unknown
  /** The applied plugin instance. */
  runtime?: unknown
  /** The fiber's own scoped context. */
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
  /** The strict read, which is what the adapter performs. */
  strict: boolean
  /** The non-strict read, which ignores the provider's fiber state. */
  loose: boolean
  /** The strict read's thrown message, when it threw at all. */
  error: string
}

/** The rendered reason of a thrown value. @param error The thrown value. @returns Its message. */
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
  /** The strict answer. */
  let strict = false
  /** The non-strict answer. */
  let loose = false
  /** The strict read's thrown message. */
  let error = ""
  try { strict = (ctx.get?.(serviceName) ?? undefined) !== undefined } catch (thrown) { error = messageOf(thrown) }
  try { loose = (ctx.get?.(serviceName, false) ?? undefined) !== undefined } catch { /* recorded by the strict arm */ }
  return { strict, loose, error }
}

/**
 * The state of the two rows the comparison turns on.
 * @param ctx The probe's own context.
 * @returns The command registry's and mpd-codegraph's fiber state, plus the loader's entry total.
 */
function readRows(ctx: ProbeContext): { entries: number; commandsState: number | null; counterpartState: number | null } {
  /** The loader's entry total. */
  let entries = 0
  /** The command registry's fiber state. */
  let commandsState: number | null = null
  /** The codegraph row's fiber state. */
  let counterpartState: number | null = null
  try {
    const loader = ctx.get?.("loader", false) as LoaderLike | undefined
    const all = loader?.entries === undefined ? [] : [...loader.entries()]
    entries = all.length
    for (const entry of all) {
      const id = typeof entry.options?.id === "string" ? entry.options.id : ""
      const state = typeof entry.fiber?.state === "number" ? entry.fiber.state : null
      if (id === "commands") commandsState = state
      if (id === COUNTERPART) counterpartState = state
    }
  } catch { /* an unreadable loader is recorded as zero entries */ }
  return { entries, commandsState, counterpartState }
}

/**
 * Attack the registry through the STRICT lookup, exactly as the adapter does.
 * @param ctx The row's own context.
 * @param commandName The throwaway command name to register.
 * @returns Whether the registration reached the host registry, and why not when it did not.
 */
function attemptRegister(ctx: ProbeContext, commandName: string): { ok: boolean; reason: string; disposer: string } {
  /** The strict service read. */
  let commands: CommandsLike | undefined
  try { commands = ctx.get?.("commands") as CommandsLike | undefined } catch (thrown) { return { ok: false, reason: "strict read threw: " + messageOf(thrown), disposer: "none" } }
  if (commands === undefined || commands === null) return { ok: false, reason: "strict read answered undefined", disposer: "noop" }
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
 * The mount: the deferred apply is the measurement.
 * @param ctx The row context.
 * @param config The overlay's config (`outDir`, `horizonMs`, `pollMs`).
 * @returns Nothing; every observation lands in the NDJSON file.
 */
export function apply(ctx: ProbeContext, config: ProbeConfig = {}): void {
  /** Where the NDJSON record lands. */
  const outDir = String(config.outDir ?? "")
  /** The poll window's length in milliseconds. */
  const horizonMs = Number(config.horizonMs ?? 3_000)
  /** The poll interval in milliseconds. */
  const pollMs = Number(config.pollMs ?? 10)
  /** The file every observation is appended to. */
  const outFile = join(outDir, "probe-late.ndjson")
  /** The instant the deferred apply began. */
  const startedAt = Date.now()

  /** Append one record synchronously; a write failure is silent by design. */
  const emit = (record: Record<string, unknown>): void => {
    try {
      mkdirSync(outDir, { recursive: true })
      appendFileSync(outFile, JSON.stringify(record) + "\n")
    } catch { /* a probe that cannot write must not disturb the boot */ }
  }

  // THE APPLY MOMENT OF A ROW THAT DECLARED `inject: ["commands"]`.
  emit({
    phase: "apply", ordinal: 0, at: new Date().toISOString(), sinceApplyMs: 0,
    commands: readService(ctx, "commands"), mpdDsh: readService(ctx, "mpdDsh"), rows: readRows(ctx),
    register: attemptRegister(ctx, INJECTED_NAME),
  })

  /** @param callback The deferred observation. @param ms The delay. */
  const later = (callback: () => void, ms: number): void => {
    try { ctx.setTimeout?.(callback, ms) ?? setTimeout(callback, ms) } catch { setTimeout(callback, ms) }
  }

  /** How many polls fit in the window. */
  const polls = Math.max(1, Math.floor(horizonMs / Math.max(1, pollMs)))
  for (let ordinal = 1; ordinal <= polls; ordinal += 1) {
    later(() => {
      const view = readAgentView(ctx)
      emit({
        phase: ordinal === polls ? "horizon" : "poll", ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt,
        commands: readService(ctx, "commands"), rows: readRows(ctx), agents: view.agents, preset: view.preset, listing: view.names,
      })
      if (ordinal === polls) {
        emit({
          phase: "final-register", ordinal, at: new Date().toISOString(), sinceApplyMs: Date.now() - startedAt,
          command: INJECTED_NAME + "-final", outcome: attemptRegister(ctx, INJECTED_NAME + "-final"),
        })
      }
    }, pollMs * ordinal)
  }
}
