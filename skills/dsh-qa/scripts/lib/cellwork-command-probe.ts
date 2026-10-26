#!/usr/bin/env node
// QA probe plugin (Wave 3 / C3): mounted INSIDE a real headless boot by `cellwork-command.ts` through a
// `dsh --patch` overlay. It reads the LIVE command registry and dispatches `/cellwork` twice — once
// EMPTY and once with an objective — through the harness's own dispatcher, recording what the registry
// accepted into `config.outFile`. It asserts nothing: the assertions live in the case.
//
// WHY A PROBE IS REQUIRED: `--dump-config` composes rows and NEVER executes plugin code, no CLI surface
// dispatches a slash command, and a source grep proves nothing about the mounted build. A real registry
// listing plus a real `commands.execute()` call is the only evidence that the name is registered and
// that the handler really submitted the activation directive (AGENTS.md §4/§7).
//
// The empty dispatch runs FIRST on purpose: it must settle `kind:"error"` with the usage line and write
// NO cell state, so a composition that answered it by creating a cell would be caught before the real
// arm consumes the workspace's one-cell slot.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The probe row's plugin id, asserted by the case and by the offline self-test. */
export const name: string = "cellwork-command-probe"

// The command registry is a harness seam; a PROBE may read it directly (the adapter rule binds plugin
// rows, not QA instrumentation), and `inject` makes the mount wait for the service instead of racing it.
/** The harness services the mount must wait for before `apply` runs. */
export const inject: readonly string[] = ["commands"]

/** The cancellation signal the probe forwards, of which it only ever reads `aborted`. */
export interface AbortLike {
  /** Whether the owning turn was cancelled before the deferred dispatch ran. */
  readonly aborted: boolean
}

/** One command descriptor as the LIVE registry listed it. */
export interface CommandDescriptor {
  /** The command name the registry answers to. */
  readonly name?: string
  /** The descriptor's help text. */
  readonly description?: string
  /** The descriptor's argument hint, when it declares one. */
  readonly input?: { readonly hint?: string }
}

/** The settled result of one `commands.execute` call. */
export interface CommandExecution {
  /** The handler's command id, echoed back by the dispatcher. */
  readonly commandId?: string
  /** The handler's own result envelope. */
  readonly result?: { readonly kind?: string; readonly text?: string }
}

/** The two-method slice of the live `commands` service this probe calls. */
export interface CommandsService {
  /**
   * @param agent The agent whose command view is listed.
   * @returns Every descriptor the live registry holds for that agent.
   */
  list(agent: unknown): readonly CommandDescriptor[]
  /**
   * @param agent The agent the command is dispatched for.
   * @param line The full command line, name and argument included.
   * @param args The ATTACHMENT vector; the dispatcher parses the line itself, so this is `[]` for a
   *             plain-text command (a non-empty value is refused as "does not accept attachments").
   * @param signal The cancellation signal of the invoking turn.
   * @returns The settled execution, or `undefined`/`null` when the name does not resolve.
   */
  execute(agent: unknown, line: string, args: readonly string[], signal: AbortLike): Promise<CommandExecution | undefined | null>
}

/** The `agent/pre-step` payload fields the probe reads. */
export interface PreStepPayload {
  /** The agent the step belongs to. */
  readonly agent?: unknown
  /** The turn's cancellation signal. */
  readonly signal?: AbortLike
}

/** The `agent/pre-step` waterfall listener shape the probe registers. */
export type PreStepListener = (payload: PreStepPayload, next?: () => Promise<unknown>) => Promise<unknown>

/** The harness plugin context slice the probe uses. */
export interface ProbeContext {
  /**
   * @param event The harness event name.
   * @param listener The waterfall listener to register.
   */
  on(event: string, listener: PreStepListener): void
  /**
   * @param serviceName The harness service name to resolve.
   * @returns The mounted service, or `undefined` when it is not mounted.
   */
  get?(serviceName: string): unknown
}

/** The probe row's config, as the overlay's `dsh --patch` row declares it. */
export interface ProbeConfig {
  /** Absolute path of the JSON document the probe records into; required. */
  readonly outFile?: string
  /** The objective token the non-empty invocation is dispatched with. */
  readonly objective?: string
}

/** One listed descriptor as the probe records it (every field optional in the source). */
export interface ListedDescriptor {
  /** The command name the registry listed. */
  readonly name: string | undefined
  /** The descriptor's help text. */
  readonly description: string | undefined
  /** The descriptor's argument hint, or `null` when it declares none. */
  readonly hint: string | null
}

/** One invocation's recorded result, or `null` when the name did not resolve at all. */
export interface InvocationRecord {
  /** The handler's command id, echoed back by the dispatcher. */
  readonly commandId: string | undefined
  /** The handler's result kind (`error` for the usage answer, `success` for a submitted directive). */
  readonly kind: string | null
  /** The handler's result text; `""` when the handler produced none. */
  readonly text: string
}

/** One cell directory the probe observed after the dispatch, read from the disk the boot wrote. */
export interface CellRecordProbe {
  /** The cell id (the directory name inside `<ws>/.mpd/cellwork/`). */
  readonly cellId: string
  /** The parsed `state.json` the plugin wrote, or `null` when it could not be read or parsed. */
  readonly state: { readonly objective?: unknown; readonly phase?: unknown; readonly captainSessionId?: unknown } | null
  /** The absolute `state.json` path, so the case can name it in its evidence. */
  readonly statePath: string
  /** The journal's first parsed line, or `null` when the journal is absent or empty. */
  readonly firstJournalEvent: unknown
}

/** The whole JSON document the probe writes to `config.outFile`. */
export interface ProbeRecord {
  /** ISO instant the probe ran, so a case can prove it observed the live registry. */
  at: string
  /** The objective token the non-empty invocation carried. */
  objective: string
  /** The working directory the boot ran in (the case asserts it is its own sandbox workspace). */
  cwd: string
  /** The listed command names, or `null` when the listing itself failed. */
  listed: string[] | null
  /** The listed descriptors, or `null` when the listing itself failed. */
  descriptors: ListedDescriptor[] | null
  /** The EMPTY invocation's result, or `null` when the name did not resolve. */
  empty: InvocationRecord | null
  /** The non-empty invocation's result, or `null` when the name did not resolve. */
  filled: InvocationRecord | null
  /** Every cell directory present after both dispatches, oldest first. */
  cells: CellRecordProbe[]
  /**
   * Every cell directory present after the EMPTY dispatch ONLY — the snapshot the case asserts is empty.
   *
   * WHY IT EXISTS (CodeRabbit 4377306805). `cells` is overwritten by the non-empty dispatch, so the state
   * the usage answer left behind was recorded and then lost: the case's own claim ("the empty invocation
   * left the cell root empty") was checked only INDIRECTLY, through a later invocation that would merely
   * produce two cells or be refused. This field keeps the evidence for the claim itself.
   */
  cellsAfterEmpty: CellRecordProbe[]
  /** Every error the probe swallowed, so a case can fail with the real cause. */
  errors: string[]
}

/** The cell root this probe reads, relative to the boot's working directory. */
const CELL_ROOT: readonly string[] = [".mpd", "cellwork"]

/**
 * Read every cell the boot wrote, so the case can assert the HANDLER's own artifact.
 * @param cwd The boot's working directory.
 * @returns One entry per cell directory, oldest first; `[]` when the root does not exist.
 */
export function readCells(cwd: string): CellRecordProbe[] {
  /** The absolute cell root. */
  const root = join(cwd, ...CELL_ROOT)
  if (!existsSync(root)) return []
  /** The directory names, sorted so the oldest cell is first. */
  let names: string[] = []
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith("cell-")).map((entry) => entry.name).sort()
  } catch {
    return []
  }
  return names.map((cellId): CellRecordProbe => {
    /** The cell's own record path. */
    const statePath = join(root, cellId, "state.json")
    /** The parsed record, or null when it is missing or unparsable. */
    let state: CellRecordProbe["state"] = null
    try {
      /** The parsed JSON, narrowed to the three fields the case reads. */
      const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>
      state = { ...(typeof parsed.objective === "string" ? { objective: parsed.objective } : {}), ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {}), ...(typeof parsed.captainSessionId === "string" ? { captainSessionId: parsed.captainSessionId } : {}) }
    } catch {
      state = null
    }
    /** The journal's first line, which names how the cell started. */
    let firstJournalEvent: unknown = null
    try {
      /** The first non-blank journal line. */
      const line = readFileSync(join(root, cellId, "journal.jsonl"), "utf8").split("\n").find((candidate) => candidate.trim() !== "")
      firstJournalEvent = line === undefined ? null : JSON.parse(line)
    } catch {
      firstJournalEvent = null
    }
    return { cellId, state, statePath, firstJournalEvent }
  })
}

/**
 * Mount the probe: list the live registry, dispatch `/cellwork` empty and then with the objective,
 * and record everything into `config.outFile`.
 * @param ctx The harness plugin context the row is mounted with.
 * @param config The row config; `outFile` is required.
 * @throws When `config.outFile` is missing or empty.
 */
export function apply(ctx: ProbeContext, config: ProbeConfig = {}): void {
  /** The absolute path every recording is flushed to; required, so a missing one fails loudly. */
  const outFile = config?.outFile
  if (typeof outFile !== "string" || outFile.length === 0) throw new Error("cellwork-command-probe: config.outFile is required")
  /** The objective token the non-empty invocation is dispatched with. */
  const objective = typeof config?.objective === "string" && config.objective.length > 0 ? config.objective : "qa-cellwork-objective-token"
  /** The record document, rewritten after every step so a crash still leaves partial evidence. */
  const record: ProbeRecord = { at: new Date().toISOString(), objective, cwd: process.cwd(), listed: null, descriptors: null, empty: null, filled: null, cells: [], cellsAfterEmpty: [], errors: [] }
  /** Persist the record; a write failure is recorded rather than thrown into the step. */
  const flush = (): void => {
    try { writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n") } catch (error) { record.errors.push("flush: " + String((error as Error)?.message ?? error)) }
  }
  // Whether the one-shot dispatch has already been scheduled for this session.
  let fired = false

  // `agent/pre-step` is a WATERFALL: await next() first and return its decision verbatim (a bare value
  // would REPLACE the step decision). The work is deferred so the probe can never delay the step it was
  // woken by.
  ctx.on("agent/pre-step", async (payload, next) => {
    /** The downstream decision, awaited so the waterfall stays untouched. */
    const decision = typeof next === "function" ? await next() : undefined
    if (!fired) {
      fired = true
      /** The agent the registry listing and both dispatches are scoped to. */
      const agent = payload?.agent
      /** The turn's own signal, replaced only when it is already aborted. */
      const turnSignal = payload?.signal
      /** The signal the deferred dispatch really runs under. */
      const signal = turnSignal !== undefined && turnSignal.aborted !== true ? turnSignal : new AbortController().signal
      setTimeout(() => { void run(agent, signal) }, 0)
    }
    return decision
  })

  /**
   * List the live registry and dispatch both `/cellwork` spellings, recording each step.
   * @param agent The agent the listing and dispatches are scoped to.
   * @param signal The cancellation signal the dispatches run under.
   */
  async function run(agent: unknown, signal: AbortLike): Promise<void> {
    /** The mounted `commands` service, or undefined when the row mounted without it. */
    const commands = typeof ctx.get === "function" ? ctx.get("commands") : undefined
    if (commands === undefined || commands === null) {
      record.errors.push("the commands service is not mounted")
      flush()
      return
    }
    /** The live registry, whose two methods this probe calls. */
    const registry = commands as CommandsService
    try {
      /** Every descriptor the live registry holds for this agent. */
      const descriptors = registry.list(agent)
      record.descriptors = descriptors.map((descriptor) => ({ name: descriptor?.name, description: descriptor?.description, hint: descriptor?.input?.hint ?? null }))
      record.listed = record.descriptors.map((descriptor) => descriptor.name as string)
      console.log("[cellwork-command-probe] LISTED=" + record.listed.join(","))
    } catch (error) {
      record.errors.push("list: " + String((error as Error)?.message ?? error))
    }
    flush()

    // THE EMPTY INVOCATION must answer usage and write nothing. `execute` returns undefined when the
    // name does not resolve at all, recorded as null so the case can tell "not registered" from
    // "registered and answered".
    try {
      /** The dispatcher's answer to the bare `/cellwork` spelling. */
      const empty = await registry.execute(agent, "/cellwork", [], signal)
      record.empty = empty === undefined || empty === null ? null : { commandId: empty.commandId, kind: empty.result?.kind ?? null, text: typeof empty.result?.text === "string" ? empty.result.text : "" }
    } catch (error) {
      record.errors.push("empty: " + String((error as Error)?.message ?? error))
    }
    // The cell root must still be EMPTY here: the usage answer is not allowed to create a cell, and this
    // is the ONLY moment the pre-invocation state is observable — the next dispatch overwrites `cells`.
    record.cellsAfterEmpty = readCells(record.cwd)
    flush()

    // THE NON-EMPTY INVOCATION is the arm the case gates on: the handler must settle `success`, which
    // it only does when the submission through the invoking agent's own turn seam returned true.
    try {
      /** The dispatcher's answer to `/cellwork <objective>`. */
      const filled = await registry.execute(agent, "/cellwork " + objective, [], signal)
      record.filled = filled === undefined || filled === null ? null : { commandId: filled.commandId, kind: filled.result?.kind ?? null, text: typeof filled.result?.text === "string" ? filled.result.text : "" }
    } catch (error) {
      record.errors.push("filled: " + String((error as Error)?.message ?? error))
    }
    record.cells = readCells(record.cwd)
    flush()
    console.log("[cellwork-command-probe] FILLED=" + String(record.filled?.kind ?? "none") + " CELLS=" + record.cells.map((cell) => cell.cellId).join(","))
  }
}
