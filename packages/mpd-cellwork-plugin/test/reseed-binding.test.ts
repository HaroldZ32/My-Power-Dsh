// THE RESEED MUST BIND ITS SEAT, OR SAY IT DID NOT (contract `.mpd/plans/cellwork-reseed-fix.md` R1–R5).
//
// THE FIELD DEFECT (VEdit, five occurrences, four roles): the journal recorded `outcome:"reseeded"` with a
// fresh handle while the TEAM member row still carried the OLD handle at `mode:"checkpoint"` and the BOARD
// row still named the dead owner. The replacement session therefore had no seat identity — the heartbeat
// was one `member:null` line and then silence.
//
// These arms drive the REAL barrier over a REAL team record file (the plane reads it back through
// `mpdTeams.get`, exactly as `team-core` does), so a bind that only *claims* success fails here:
//   A1 the three surfaces name the fresh handle;      A2 a surface that refuses is loud (no `reseeded`);
//   A3 the directive reaches the NEW handle;          A4 a dead / unverified seat is visible;
//   A5 no warn-only branch (re-read failure, throw);  A6 a spawn without a child id releases its slot.
//   A7 an UNREADABLE record refuses, an ABSENT one is `absent` (F1);
//   A8 an external write inside the bind window is never overwritten (F2);
//   A9 drift OUTSIDE the member roster (board / handoffs / consults) is refused too (F2's byte predicate);
//   A10 an unmounted plane with a readable record FILE binds and verifies from the file (F1).
//   A11 a STALE read-back rolls the TEAM row and the board owners back (Major-7);
//   A12 a rollback that meets a concurrent write REFUSES to overwrite it and reports that;
//   A12b a surviving document that PRESERVES the fresh handle keeps that child alive, records the
//        reconcile marker and hands over a repair that re-points `executorRef` (the A11 hole);
//        A12c the same rule for a rollback that could not be written (`failed`): unproven is never released;
//   A13 a record re-read failure NEVER writes the pre-await snapshot (Major-8);
//   A14 the status RENDER carries the closure reading for a non-live seat and leaves a live one unchanged;
//   A15 a board row owned by the seat's NAME is re-pointed as well — and ANOTHER seat's rows are not;
//   A16 the recovery path is NOT re-entered: a TEAM row already bound to a LIVE child spawns no second one;
//   A17 `rebind` REWRITES a TEAM row that names a DIFFERENT handle (and a non-member mode) — the verb's
//        defining effect, which no earlier arm exercised because their TEAM row already named the handle;
//   A18 `rebind` ALONE leaves `fenced`/`fencedReason` untouched (A12b combined it with `unfence`, so it
//        could not tell "preserved" from "cleared");
//   A19 a write by another process INSIDE rebind's window is refused (`team-record-changed`), not overwritten;
//   A20 the handle is trimmed and must be the host's UUID form — a typo refuses the whole call, journaled;
//   A21 a handle this seat's records never name is refused per entry (`handle-unevidenced`);
//   A22 the handle a reseed DISPLACES is journaled (`displacedExecutorRef` + `displacedUnproven`, R3);
//   A23 a refused rollback whose surviving record is READABLE but carries no string `executorRef` says so
//        instead of calling it unreadable (R4.2);
//   A24 a handle only an OLDER hand-over row names is refused `handle-superseded` — the latest row wins (M1);
//   A25 a displaced handle that is still LIVE is surfaced on the answer and the `member-rebound` row (M1/N1);
//   A26 ANOTHER seat's TEAM row or journal hand-over is never ownership evidence for this seat (M2);
//   A27 the CURRENT record wins: a record written after the last hand-over with no journal row of its own
//       is accepted (never `handle-superseded`, never advised backwards), and with no current handle the
//       journal's latest row still decides while an older row stays non-evidence (F1).
//
// Every workspace is a fresh temp dir; nothing here reads the repository's own state.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { journalPath, newCellState, readCell, statePath, writeCell, type CellMemberRecord, type CellState } from "../src/state.ts"
import { installCellworkProtocol } from "../src/protocol.ts"
import { apply } from "../src/index.ts"
import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.ts"

/** The cell id every arm works in. */
const CELL_ID = "cell-20261111T000000000Z"

/** The team id the cell record names, and the id of the record file this harness serves. */
const TEAM_ID = "team-reseed-bind"

/** The captain's session id: the identity the registry is anchored on and the only `supervise` caller. */
const CAPTAIN_SESSION = "session-captain"

/** The member's board name inside the cell. */
const MEMBER_NAME = "Senior Engineer"

/** The DEAD handle the reseed replaces: the cell row's session, the TEAM `executorRef` and the board owner. */
const OLD_HANDLE = "6b1f7a2c-0000-4000-8000-000000000001"

/** The live parent the reseed is raised under. */
const PARENT_SESSION = "session-parent"

/** The fresh handle the backend mints for the replacement session (the field incident's own UUID form). */
const NEW_HANDLE = "2f86e074-1a13-4871-881f-7af634ff4f3c"

/** A fake live agent: the id the registry keys it by and the session header the workspace resolves from. */
interface FakeAgent {
  /** The shared session/agent id. */
  id: string
  /** The session the workspace root and the parent link resolve from. */
  session: { id: string; header: { cwd: string; parentSession?: string } }
  /** The Agent's own scoped context, which serves the member's compaction engine. */
  ctx?: { get: (name: string) => unknown }
}

/** One captured tool definition (only the fields these arms call). */
interface CapturedTool {
  /** The registered name. */
  name: string
  /** The runner, called with the harness-validated arguments and the dispatch. */
  execute: (args: unknown, exec: unknown) => Promise<unknown>
  /** The tool's output contract; the adapter moves the row's declared `render` in here (A14). */
  output?: { render?: (args: unknown, value: unknown) => unknown }
}

/** The team record this harness serves through `mpdTeams` and writes to disk. */
interface TeamRecordFile {
  /** The record schema version (`readTeam` refuses anything but 1). */
  version: number
  /** A document revision, when the record shape carries one (today's `TeamRecord` does not). */
  revision?: number
  /** The record's own write instant, when it carries one: F1's proof that it postdates a journal row. */
  updatedAt?: string
  /** The team id. */
  teamId: string
  /** ISO instant the team was created. */
  createdAt: string
  /** The stored phase. */
  phase: string
  /** The roster. */
  members: Array<Record<string, unknown>>
  /** The board. */
  tasks: Array<Record<string, unknown>>
  /** The handoff ledger, when this record shape carries one (A9's non-member drift). */
  handoffs?: Array<Record<string, unknown>>
  /** The consult ledger, when this record shape carries one (A9's non-member drift). */
  consults?: Array<Record<string, unknown>>
}

/** The fake harness one arm drives. */
interface Harness {
  /** The temp workspace every root resolves to. */
  workspace: string
  /** The captain's handle. */
  captain: FakeAgent
  /** The stopping member's handle (its session id IS the old handle the records name). */
  member: FakeAgent
  /** The live-session registry the adapter's lookups consult. */
  registry: Map<string, FakeAgent>
  /** Every activation the reseed started, with the release flag the backend would expose. */
  activations: Array<{ childId: string; disposed: boolean }>
  /** Every directive the promotion delivery bound to a HANDLE (`teamExecutor.send`). */
  sends: Array<{ handle: string; text: string }>
  /** Every plane `unfence` call the barrier made. */
  planeUnfences: Array<{ sessionId: string; member: string }>
  /** The captured tool definitions. */
  tools: Map<string, CapturedTool>
  /** The registered event handlers. */
  events: Map<string, (payload: unknown) => unknown>
  /** The team record file path the plane reads. */
  recordPath: string
  /** The record as it stands on disk. */
  record: () => TeamRecordFile
}

/** Options one arm may change. */
interface HarnessOptions {
  /** The TEAM record this arm starts from (defaults to a reseeded-shaped board). */
  team?: TeamRecordFile
  /** Whether the record FILE exists at all (false is A7's control: a cell with no team record). */
  recordFile?: boolean
  /** Whether `mpdTeams` answers at all (false models a composition with no team plane). */
  planeRead?: boolean
  /**
   * WHERE `mpdTeams.get` throws: at the bind's SNAPSHOT read (A7's unreadable record) or at its
   * read-BACK after the write (A5's post-spawn throw).
   */
  planeThrowsAt?: "read" | "verify"
  /** Whether `mpdTeamActions.unfence` exists. */
  planeUnfence?: boolean
  /** What the backend answers instead of a child id (A6). */
  start?: () => unknown
  /** A hook that runs INSIDE the spawn, before it resolves (the corrupt-the-record arm). */
  duringSpawn?: () => void
  /**
   * An EXTERNAL WRITE that commits between the bind's read and its rename (A8): it receives the record
   * the read just served and returns the document another writer left on disk.
   */
  externalWriteAfterRead?: (served: TeamRecordFile) => TeamRecordFile
  /**
   * A STALE read-back (A11): once the fresh handle is on disk, the plane answers a copy that still names
   * the OLD handle instead of the file. The write happened, so the bind must ROLL IT BACK.
   */
  staleVerify?: boolean
  /**
   * An EXTERNAL WRITE that commits AT the read-back (A12): it receives the record the bind just wrote and
   * returns the document another writer left on disk. The bind then sees the mismatch and must find the
   * file changed, so its rollback REFUSES instead of overwriting that writer.
   */
  externalWriteAtVerify?: (written: TeamRecordFile) => TeamRecordFile
  /** The cell row the barrier starts from. */
  member?: CellMemberRecord
  /**
   * Runs immediately BEFORE the A5 read-back throw.
   *
   * A12c uses it to remove the record file: the rollback's own re-read then fails, which is the
   * `rollback:"failed"` shape — the record state is unproven, so the child must be kept like a refused one.
   */
  duringVerifyThrow?: () => void
  /** Whether the agents registry exists at all (false = liveness is always `unknown`). */
  agentsRegistry?: boolean
  /** Extra live sessions the registry holds (A4's dead seat needs the captain ONLY). */
  liveSessions?: readonly string[]
  /** The knobs that change the arm's timing/bounds. */
  knobs?: Partial<typeof DEFAULT_CELLWORK_CONFIG>
  /**
   * A WRITE FROM ANOTHER PROCESS inside `rebind`'s compare-and-set window (A19).
   *
   * The record path is handed to a FIFO whose two reads answer `first` then `second`, so the bytes the verb's
   * compare reads are NOT the bytes its snapshot read — an external commit landing inside the window. The
   * plane's `get` answers `team` (or the default record) from memory for this arm so the pipe is not drained
   * before `rebind` opens it.
   */
  rebindWindowWrite?: { first: TeamRecordFile; second: TeamRecordFile }
}

/** One member row as the CELL record stores it: handoff written, waiting for the barrier. */
function memberRow(overrides: Partial<CellMemberRecord> = {}): CellMemberRecord {
  return {
    name: MEMBER_NAME,
    role: MEMBER_NAME,
    sessionId: OLD_HANDLE,
    executorRef: OLD_HANDLE,
    mode: "checkpoint",
    handoffReady: true,
    handoffs: 1,
    joinedAt: "2026-11-11T00:00:00.000Z",
    ...overrides,
  }
}

/**
 * The team record a reseed lands on: the member still at `checkpoint` with the dead handle, and one
 * `in_progress` board row owned by that dead handle — the incident's exact three surfaces.
 *
 * @param members - the roster this arm needs (defaults to the stranded seat).
 * @returns the record.
 */
function teamRecord(members?: Array<Record<string, unknown>>): TeamRecordFile {
  return {
    version: 1,
    teamId: TEAM_ID,
    createdAt: "2026-11-11T00:00:00.000Z",
    phase: "executing",
    members: members ?? [{
      id: "M1",
      name: MEMBER_NAME,
      role: MEMBER_NAME,
      status: "running",
      executorRef: OLD_HANDLE,
      mode: "checkpoint",
      // THE HANDOFF IS HISTORY: the bind must not delete it.
      handoff: { path: ".mpd/team/handoffs/senior-engineer-1.md", at: "2026-11-11T00:01:00.000Z" },
    }],
    tasks: [
      { id: "T1", subject: "ship the widget", status: "in_progress", owner: OLD_HANDLE, revision: 7, attempt: 14, startedAt: "2026-11-11T00:00:30.000Z" },
      // EVERY TERMINAL STATUS IS HISTORY (F3), not only `completed`: a finished row records who DID the
      // work, so the bind must leave its owner alone whichever way it finished.
      { id: "T0", subject: "earlier work", status: "completed", owner: OLD_HANDLE, revision: 4 },
      { id: "T2", subject: "work that failed", status: "failed", owner: OLD_HANDLE, revision: 5 },
      { id: "T3", subject: "work that was cancelled", status: "cancelled", owner: OLD_HANDLE, revision: 6 },
    ],
  }
}

/**
 * Build the harness: a temp workspace with one handoff-ready member, a REAL team record file behind the
 * `mpdTeams` seam, and the protocol tools installed once.
 *
 * @param options - the plane/spawn/registry variation this arm needs.
 * @returns the harness with every captured registration.
 */
function makeHarness(options: HarnessOptions = {}): Harness {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-reseed-bind-"))
  /** The cell record, persisted so the barrier reads it back like a real cell. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T00:00:00.000Z") })
  /** The cell this arm starts from: executing, on the team the plane serves. */
  const cell: CellState = { ...base, phase: "executing", teamId: TEAM_ID, members: { [MEMBER_NAME]: options.member ?? memberRow() } }
  writeCell(workspace, cell)
  /** The team record file the plane reads (and the bind writes). */
  const recordDir = join(workspace, ".mpd", "team", "teams")
  mkdirSync(recordDir, { recursive: true })
  /** The record file path. */
  const recordPath = join(recordDir, TEAM_ID + ".json")
  // A7's CONTROL starts with NO record file: a cell whose workspace holds no team record at all.
  if (options.recordFile !== false) writeFileSync(recordPath, JSON.stringify(options.team ?? teamRecord(), null, 2) + "\n", "utf8")
  /** The captain's handle. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The member's durable parent: the live authority the reseed is raised under. */
  const parent: FakeAgent = { id: PARENT_SESSION, session: { id: PARENT_SESSION, header: { cwd: workspace } } }
  /** The engine the member's scope serves: `null` is "no safely compactable range", so the reseed runs. */
  const engine = { compactNow: async (): Promise<unknown> => null }
  /** The stopping member's handle: its session id IS the old handle the records name. */
  const member: FakeAgent = { id: OLD_HANDLE, session: { id: OLD_HANDLE, header: { cwd: workspace, parentSession: PARENT_SESSION } }, ctx: { get: (name: string): unknown => (name === "compaction" ? engine : undefined) } }
  /** The live-session registry, which is what the adapter's lookups actually consult. */
  const registry = new Map<string, FakeAgent>()
  registry.set(CAPTAIN_SESSION, captain)
  registry.set(PARENT_SESSION, parent)
  registry.set(OLD_HANDLE, member)
  for (const id of options.liveSessions ?? []) registry.set(id, { id, session: { id, header: { cwd: workspace } } })
  /** Every activation this arm's backend answered. */
  const activations: Array<{ childId: string; disposed: boolean }> = []
  /** Every handle-addressed directive the promotion delivery sent. */
  const sends: Array<{ handle: string; text: string }> = []
  /** Every plane `unfence` call. */
  const planeUnfences: Array<{ sessionId: string; member: string }> = []
  /** The registered event handlers. */
  const events = new Map<string, (payload: unknown) => unknown>()
  /** The captured tool definitions. */
  const tools = new Map<string, CapturedTool>()
  /** The record as it stands on disk, or undefined when this arm has no record file (A7's control). */
  const recordOnDisk = (): TeamRecordFile | undefined => {
    try {
      return JSON.parse(readFileSync(recordPath, "utf8")) as TeamRecordFile
    } catch {
      return undefined
    }
  }
  /** The record as it stands on disk. */
  const record = (): TeamRecordFile => JSON.parse(readFileSync(recordPath, "utf8")) as TeamRecordFile
  /**
   * Whether an A8 EXTERNAL WRITE is armed (it arms when the reseed's spawn lands) and whether it has
   * already committed. Arming at the spawn is what makes the write land inside the BIND's window: the
   * barrier reads the team record through `callerContext` BEFORE the spawn, and that earlier read must
   * not be the one that injects.
   */
  let armed = false
  /** Whether the A8 external write has already landed (it commits ONCE, on the bind's snapshot read). */
  let injected = false
  /**
   * Whether the A5 read-back throw has already fired.
   *
   * ONE-SHOT on purpose: the arm needs the bind's verification read to fail, while a LATER reader (the
   * operator's `rebind` repair, A12b) must be able to read the record the surviving writer left.
   */
  let verifyThrew = false
  /** The adapter double: the shape the host exposes, narrowed to what the barrier touches. */
  const adapter: Record<string, unknown> = {
    registerTool: (definition: CapturedTool): (() => void) => { tools.set(definition.name, definition); return (): void => {} },
    onAgentPreStep: (): (() => void) => (): void => {},
    onEvent: (name: string, handler: (payload: unknown) => unknown): (() => void) => { events.set(name, handler); return (): void => {} },
    workspaceRoot: (): string => workspace,
    contextPressure: (): Record<string, unknown> => ({ usedTokens: null, windowTokens: null, ratio: null, provenance: "no-window" }),
    liveAgent: (id: string): FakeAgent | undefined => registry.get(String(id ?? "")),
    liveAgentExact: (id: string): FakeAgent | undefined => registry.get(String(id ?? "")),
    capabilities: (): Record<string, unknown> => ({ agents: options.agentsRegistry !== false }),
    compactionEngineForLiveAgent: (agent: unknown): unknown => (agent as FakeAgent | undefined)?.ctx?.get("compaction"),
    compactionEngineForAgent: (id: string): unknown => registry.get(String(id ?? ""))?.ctx?.get("compaction"),
    userMessage: (value: unknown): unknown => value,
    injectAgentMessage: (): void => {},
    teamExecutor: (): unknown => ({
      send: async (_caller: unknown, handle: string, content: string): Promise<void> => { sends.push({ handle, text: content }) },
    }),
    interruptAgent: (): void => {},
    startContinuableAgent: async (): Promise<unknown> => {
      options.duringSpawn?.()
      // A8/A12: an EXTERNAL WRITE arms only after the spawn, so it lands inside the BIND's window: the
      // barrier reads the team record through `callerContext` BEFORE the spawn, and that earlier read must
      // not be the one that injects.
      if (options.externalWriteAfterRead !== undefined || options.externalWriteAtVerify !== undefined) armed = true
      if (options.start !== undefined) return options.start()
      /** The activation the backend mints: a child id AND the release seam every real one carries. */
      const activation = { childId: NEW_HANDLE, disposed: false, dispose: async (): Promise<void> => { activation.disposed = true } }
      activations.push(activation)
      return activation
    },
    executeTool: async (): Promise<Record<string, unknown>> => ({ ok: true, isError: false, value: {} }),
  }
  installCellworkProtocol({
    dsh: adapter as unknown as DshAdapter,
    ctx: {
      get: (name: string): unknown => {
        if (name === "mpdTeams") {
          if (options.planeRead === false) return undefined
          return {
            get: (): unknown => {
              // A19: THE PIPE IS NOT DRAINED BY THE BOARD RESOLUTION. The record path is a FIFO whose reads
              // must start at `rebind`'s own snapshot, so this plane answers from memory for that arm.
              if (options.rebindWindowWrite !== undefined) return options.team ?? teamRecord()
              // A7b: the plane's SNAPSHOT read throws while a readable record exists on disk — the
              // "exists but unreadable" case F1 refuses, which is not the same thing as "no record".
              if (options.planeThrowsAt === "read") throw new Error("the mpdTeams record read blew up")
              /** The record this read answers, read ONCE so an external write cannot land mid-answer. */
              const served = recordOnDisk()
              // A12: ANOTHER WRITER COMMITS BETWEEN THE BIND'S WRITE AND ITS READ-BACK. The file moves to
              // the other writer's document, and THAT is what this read answers — the mismatch the bind
              // must detect, and the file state its rollback must refuse to overwrite. Runs BEFORE the
              // read-back throw below so A12b can combine the two: a surviving document that PRESERVES the
              // fresh handle while the read-back itself fails.
              /** The document the other writer committed, when this read lands one. */
              let external: TeamRecordFile | undefined
              if (served !== undefined && armed && !injected && options.externalWriteAtVerify !== undefined && served.members.some((row) => row.executorRef === NEW_HANDLE)) {
                injected = true
                external = options.externalWriteAtVerify(served)
                writeFileSync(recordPath, JSON.stringify(external, null, 2) + "\n", "utf8")
              }
              // A5: the read-BACK after this bind's write throws. Keyed on the COMMITTED shape (the fresh
              // handle is already on disk), so the snapshot read — which sees the OLD record — succeeds.
              if (!verifyThrew && options.planeThrowsAt === "verify" && served?.members.some((row) => row.executorRef === NEW_HANDLE) === true) {
                verifyThrew = true
                options.duringVerifyThrow?.()
                throw new Error("the mpdTeams read-back blew up")
              }
              if (external !== undefined) return external
              // A11: THE PLANE'S READ-BACK IS STALE. The bind's write is on disk, but this answer still names
              // the old handle — a non-throwing verification failure that also owes a rollback.
              if (options.staleVerify === true && served?.members.some((row) => row.executorRef === NEW_HANDLE) === true) {
                return { ...served, members: served.members.map((row) => (row.name === MEMBER_NAME ? { ...row, executorRef: OLD_HANDLE } : row)) }
              }
              // A8: an EXTERNAL WRITE commits AFTER this read served its snapshot and BEFORE the bind's
              // rename. The reader still gets the pre-write document, which is what makes the bind's
              // compare-and-set the thing this arm measures.
              if (served !== undefined && armed && !injected && options.externalWriteAfterRead !== undefined) {
                injected = true
                writeFileSync(recordPath, JSON.stringify(options.externalWriteAfterRead(served), null, 2) + "\n", "utf8")
              }
              return served
            },
          }
        }
        if (name !== "mpdTeamActions" || options.planeUnfence === false) return undefined
        return {
          unfence: async (input: { sessionId: string; member: string }): Promise<Record<string, unknown>> => {
            planeUnfences.push({ sessionId: input.sessionId, member: input.member })
            return { ok: true }
          },
          // A NO-OP PASS, so the captain's `unfence` verb can be driven end-to-end: the pairing engine is
          // the plane's, and this arm measures the LEVER, not a second dispatch implementation.
          dispatch: async (): Promise<Record<string, unknown>> => ({ ok: true, pairs: [], skipped: [], reassigned: [] }),
        }
      },
    },
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 3, idleBarrierDelayMs: 0, ...options.knobs },
    warn: (): void => {},
  })
  return { workspace, captain, member, registry, activations, sends, planeUnfences, tools, events, recordPath, record }
}


/**
 * The `cellwork_status` tool, registered by the ROW itself through `apply` (the tool lives in `index.ts`,
 * so the barrier harness above cannot see it).
 *
 * The fake context carries only what the read needs — the tool registry, the workspace seam through a
 * captain agent, and the same team-record file the barrier harness serves — so the arm proves the
 * PROJECTION rather than the staging flow behind it.
 *
 * @param row - the cell member row the status read reports.
 * @param options - whether an agents registry exists at all, and which sessions it holds.
 * @returns the tool runner, the tool's text render and the captain handle it runs as.
 */
function statusHarness(row: CellMemberRecord, options: { agentsRegistry?: boolean; liveSessions?: readonly string[]; team?: TeamRecordFile } = {}): { run: () => Promise<Record<string, unknown>>; render: (value: unknown) => string; captain: FakeAgent } {
  /** The fresh temp workspace. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-cellwork-status-liveness-"))
  /** The cell record, persisted so the read finds it. */
  const base = newCellState({ cellId: CELL_ID, objective: "ship the widget", captainSessionId: CAPTAIN_SESSION, now: new Date("2026-11-11T00:00:00.000Z") })
  writeCell(workspace, { ...base, phase: "executing", teamId: TEAM_ID, members: { [row.name]: row } })
  /** The captain's handle, whose session header resolves the workspace. */
  const captain: FakeAgent = { id: CAPTAIN_SESSION, session: { id: CAPTAIN_SESSION, header: { cwd: workspace } } }
  /** The live sessions the fake registry holds. */
  const live = new Set<string>([CAPTAIN_SESSION, ...(options.liveSessions ?? [])])
  /** Every captured tool definition. */
  const tools: CapturedTool[] = []
  /** The tool registry double. */
  const toolsService = {
    /**
     * Capture one definition.
     * @param definition - the definition.
     * @returns the disposer.
     */
    register(definition: CapturedTool): () => void { tools.push(definition); return (): void => {} },
    /**
     * Resolve one captured definition.
     * @param name - the tool name.
     * @returns the definition, or undefined.
     */
    get(name: string): CapturedTool | undefined { return tools.find((tool) => tool.name === name) },
  }
  /** The services this fake context answers; an ABSENT registry is modelled by omitting the service. */
  const services: Record<string, unknown> = {
    tools: toolsService,
    ...(options.agentsRegistry === false ? {} : { agents: { list: (): FakeAgent[] => [captain], get: (id: string): FakeAgent | undefined => (live.has(id) ? { id, session: { id, header: { cwd: workspace } } } : undefined) } }),
    mpdTeams: { get: (_workspace: string, teamId: string): unknown => (teamId === TEAM_ID ? (options.team ?? teamRecord()) : undefined) },
    mpdRoles: { list: (): Array<{ name: string }> => [], get: (): null => null },
  }
  /** The fake context. */
  const ctx = {
    tools: toolsService,
    /**
     * Run the cleanup callback at registration time.
     * @param fn - the callback.
     */
    effect(fn: () => unknown): void { fn() },
    /**
     * Resolve one fake service.
     * @param service - the service name.
     * @returns the service, or undefined.
     */
    get(service: string): unknown { return services[service] },
  } as Parameters<typeof apply>[0]
  apply(ctx, {})
  return {
    captain,
    run: async (): Promise<Record<string, unknown>> => {
      /** The captured status definition. */
      const tool = tools.find((candidate) => candidate.name === "cellwork_status")
      if (tool === undefined) throw new Error("cellwork_status was not registered")
      return await tool.execute({}, { name: "cellwork_status", agent: captain }) as Record<string, unknown>
    },
    render: (value: unknown): string => {
      /** The captured status definition. */
      const tool = tools.find((candidate) => candidate.name === "cellwork_status")
      /** The declared render, which the adapter carries inside the output contract. */
      const renderValue = tool?.output?.render
      if (renderValue === undefined) throw new Error("cellwork_status declared no render")
      /** The content blocks the render produced. */
      const blocks = renderValue({}, value) as Array<{ text?: unknown }>
      return Array.isArray(blocks) ? blocks.map((block) => String(block.text ?? "")).join("\n") : ""
    },
  }
}

/**
 * The barrier the plugin registered for `agent/turn-stopping`.
 *
 * @param harness - the harness whose registration is read.
 * @returns the listener.
 */
function stopListener(harness: Harness): (payload: unknown) => unknown {
  /** The registered listener. */
  const listener = harness.events.get("agent/turn-stopping")
  if (listener === undefined) throw new Error("the plugin registered no agent/turn-stopping listener")
  return listener
}

/**
 * Every journal row of the harness's cell, in append order.
 *
 * @param harness - the harness whose cell is read.
 * @returns the parsed rows.
 */
function journalRows(harness: Harness): Array<Record<string, unknown>> {
  /** The raw journal text, or "" when nothing was journaled yet. */
  let text = ""
  try {
    text = readFileSync(journalPath(harness.workspace, CELL_ID), "utf8")
  } catch {
    return []
  }
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Record<string, unknown>)
}

/**
 * The member row the CELL record holds.
 *
 * @param harness - the harness whose cell is read.
 * @returns the row.
 */
function cellMember(harness: Harness): CellMemberRecord {
  /** The record as persisted. */
  const read = readCell(harness.workspace, CELL_ID)
  if (!read.ok) throw new Error("the cell record must be readable: " + read.detail)
  /** The row this arm is about. */
  const row = read.state.members[MEMBER_NAME]
  if (row === undefined) throw new Error("the member row must exist")
  return row
}

/**
 * Seed the cell's append-only journal BEFORE the tool runs, in append order.
 *
 * The arms use this to prove that only the LATEST hand-over row is ownership evidence (M1), and that
 * another seat's row is never evidence for this one (A26). Each line is written the way `appendJournal`
 * writes it: one JSON object per line, oldest first.
 *
 * @param harness - the harness whose cell journal is seeded.
 * @param rows - the rows, oldest first; `at` defaults to a fixed stamp for deterministic assertions.
 */
function seedJournal(harness: Harness, rows: Array<Record<string, unknown>>): void {
  writeFileSync(journalPath(harness.workspace, CELL_ID), rows.map((row) => JSON.stringify({ at: "2026-11-11T00:02:00.000Z", ...row }) + "\n").join(""), "utf8")
}

// ── A1: the three surfaces name the fresh handle ────────────────────────────

test("A1a: a reseed puts the fresh handle on the TEAM member row and leaves the checkpoint window", async () => {
  /** The harness whose plane is a real record file. */
  const harness = makeHarness()
  await stopListener(harness)({ agent: harness.member })
  /** The team record as the plane reads it after the barrier. */
  const record = harness.record()
  /** The seat row. */
  const seat = record.members.find((row) => row.name === MEMBER_NAME)
  // SURFACE 1, BOTH FIELDS: the fresh handle, and the seat back OUT of the checkpoint window.
  expect(seat?.executorRef).toBe(NEW_HANDLE)
  expect(seat?.mode).toBe("member")
  // THE HANDOFF SURVIVES AS HISTORY.
  expect(seat?.handoff).toEqual({ path: ".mpd/team/handoffs/senior-engineer-1.md", at: "2026-11-11T00:01:00.000Z" })
})

test("A1b: a reseed re-points every non-terminal board row the old handle owned", async () => {
  /** The harness whose plane is a real record file. */
  const harness = makeHarness()
  await stopListener(harness)({ agent: harness.member })
  /** The team record as the plane reads it after the barrier. */
  const record = harness.record()
  /** The board rows by id. */
  const tasks = new Map(record.tasks.map((task) => [String(task.id), task]))
  // SURFACE 2: the in_progress row the dead handle owned is re-pointed, revision bumped like the store does.
  expect(tasks.get("T1")?.owner).toBe(NEW_HANDLE)
  expect(tasks.get("T1")?.revision).toBe(8)
  // EVERY TERMINAL STATUS KEEPS ITS OWNER (F3): completed, failed AND cancelled are all history, and a
  // hand-over that rewrote one of them would claim a child did work that it never touched.
  expect(tasks.get("T0")?.owner).toBe(OLD_HANDLE)
  expect(tasks.get("T2")?.owner).toBe(OLD_HANDLE)
  expect(tasks.get("T3")?.owner).toBe(OLD_HANDLE)
  // SURFACE 3: the CELL row carries the fresh handle, and still does.
  /** The cell's member row. */
  const cell = cellMember(harness)
  expect(cell.sessionId).toBe(NEW_HANDLE)
  expect(cell.executorRef).toBe(NEW_HANDLE)
  // AND THE HAND-OVER IS A JOURNALED FACT, not an inference from three records.
  /** The journal rows. */
  const rows = journalRows(harness)
  /** The bind row. */
  const bound = rows.find((row) => row.event === "seat-rebound")
  expect(bound?.plane).toBe("bound")
  expect(bound?.tasks).toBe(1)
  expect(bound?.newHandle).toBe(NEW_HANDLE)
  // A reseed that bound its seat reports `reseeded`.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(true)
})

// ── A2: a surface that refuses is LOUD ──────────────────────────────────────

test("A2: a reseed that cannot write the TEAM row NEVER reports `reseeded` — it names the surface, fences and hands over the retry", async () => {
  // THE ROSTER NAMES NO SUCH MEMBER: the fresh handle has no seat row to bind, which is exactly the
  // "a surface could not be written" shape the contract makes loud.
  /** The harness whose team record has an empty roster. */
  const harness = makeHarness({ team: teamRecord([]) })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // NO SUCCESS IS CLAIMED.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "member-reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  // THE UNRECOVERABLE ROW NAMES THE SURFACE AND THE RETRY.
  /** The give-up row. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-member")
  expect(String(unrecoverable?.reason)).toContain("could not be bound")
  expect(String(unrecoverable?.retry)).toContain('cellwork_dispatch {unfence:[{member, force:true}]}')
  // THE SEAT IS FENCED: the captain can see it and the forced lever can clear it.
  /** The cell's member row. */
  const cell = cellMember(harness)
  expect(cell.fenced).toBe(true)
  expect(String(cell.fencedReason)).toContain("could not be bound")
  // AND THE CHILD THAT COULD NOT BE BOUND IS RELEASED, so no slot is held by a seatless session.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

// ── A3: the replacement is TOLD what to do ──────────────────────────────────

test("A3: the promotion directive is delivered to the NEW handle on the reseed path", async () => {
  /** The harness whose executor records handle-addressed deliveries. */
  const harness = makeHarness()
  await stopListener(harness)({ agent: harness.member })
  // THE DELIVERY SEAM ITSELF, not prose: exactly one message, addressed to the FRESH handle.
  expect(harness.sends).toHaveLength(1)
  expect(harness.sends[0].handle).toBe(NEW_HANDLE)
  // It carries the promotion directive (the sub-cell hand-over), which is what makes the seat act.
  expect(harness.sends[0].text.toLowerCase()).toContain("sub")
  /** The journal row that reports the delivery as a fact. */
  const reseeded = journalRows(harness).find((row) => row.event === "member-reseeded")
  expect(reseeded?.directiveDelivered).toBe(true)
  expect(reseeded?.directiveError).toBeUndefined()
})

// ── A4: a dead (and an unverified) seat is VISIBLE ──────────────────────────

test("A4: a DEAD subcaptain renders live-by-liveness and force-eligible on BOTH surfaces", async () => {
  // THE POST-RESEED ROW the incident left behind: `subcaptain`, no handoff window, a stamped clock, and a
  // recorded session the registry proves dead (the captain anchor resolves; the child does not).
  /** The stranded row. */
  const stranded = memberRow({ mode: "subcaptain", handoffReady: false, handoffs: 1, sessionId: "session-dead-child", executorRef: "session-dead-child", checkpointSince: new Date(Date.now() - 1800000).toISOString() })
  // THE PLANE ROW IS POST-BIND: `mode:"member"` with the dead child's handle — the shape A1 leaves behind
  // when the child it bound dies afterwards, which is the incident's fifth occurrence.
  /** The plane record naming the dead child as an open seat. */
  const plane = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: "session-dead-child", mode: "member" }])
  /** The harness whose registry does not hold the recorded child (the captain anchor still resolves). */
  const harness = makeHarness({ member: stranded, team: plane })
  /** The captain's status read (the tool lives in the row, so it is registered through `apply`). */
  const status = await statusHarness(stranded, { team: plane }).run()
  /** The status member row. */
  const statusRow = (status.members as Array<Record<string, unknown>>)[0]
  expect(statusRow.liveness).toBe("dead")
  expect(statusRow.forceEligible).toBe(true)
  expect(statusRow.deadReseed).toBe(true)
  // THE SWEEP REPORTS THE SAME SEAT WITH THE SAME LEVER.
  /** The captain's sweep. */
  const sweep = await harness.tools.get("cellwork_supervise")!.execute({}, { agent: harness.captain }) as Record<string, unknown>
  /** The sweep's member row. */
  const sweepRow = (sweep.members as Array<Record<string, unknown>>).find((row) => row.name === MEMBER_NAME)
  expect(sweepRow?.liveness).toBe("dead")
  expect(sweepRow?.forceEligible).toBe(true)
  /** The closed-seat row the sweep lists. */
  const listed = (sweep.fenced as Array<Record<string, unknown>>).find((row) => row.name === MEMBER_NAME)
  expect(listed?.deadReseed).toBe(true)
  expect(listed?.forceEligible).toBe(true)
})

test("A4: an UNKNOWN liveness is reported as unverified, never as health, and suppresses no lever field", async () => {
  /** The same stranded row, on a composition with NO agents registry. */
  const stranded = memberRow({ mode: "subcaptain", handoffReady: false, handoffs: 1, sessionId: "session-dead-child", executorRef: "session-dead-child", checkpointSince: new Date(Date.now() - 1800000).toISOString() })
  /** The plane record naming the dead child as an open seat. */
  const plane = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: "session-dead-child", mode: "member" }])
  /** The harness with the registry absent. */
  const harness = makeHarness({ member: stranded, agentsRegistry: false, team: plane })
  /** The captain's status read, on the composition whose registry is ABSENT. */
  const status = await statusHarness(stranded, { agentsRegistry: false, team: plane }).run()
  /** The status member row. */
  const statusRow = (status.members as Array<Record<string, unknown>>)[0]
  expect(statusRow.liveness).toBe("unknown")
  // THE LEVER IS ANSWERED, NOT OMITTED: an absent field would read as healthy.
  expect(statusRow.forceEligible).toBe(false)
  expect(statusRow.forceRefusal).toBe("liveness-unknown")
  // THE SAME SEAT IS LISTED AS UNVERIFIED (never dropped) and its lever stays refused.
  /** The captain's sweep. */
  const sweep = await harness.tools.get("cellwork_supervise")!.execute({}, { agent: harness.captain }) as Record<string, unknown>
  /** The listed closed/unverified row. */
  const listed = (sweep.fenced as Array<Record<string, unknown>>).find((row) => row.name === MEMBER_NAME)
  expect(listed?.unverified).toBe(true)
  expect(listed?.liveness).toBe("unknown")
  expect(listed?.forceEligible).toBe(false)
})

// ── A5: no warn-only branch ─────────────────────────────────────────────────

test("A5: a record re-read failure journals the branch and NEVER writes the pre-await snapshot — the fence is reported `not-persisted`", async () => {
  // The record is corrupted INSIDE the spawn, i.e. after the barrier read it and before it writes: the
  // re-read then fails. The refused bytes are PRESERVED (a pre-await snapshot must never overwrite them)
  // and the journal says the fence did not persist instead of claiming a fence nothing can see.
  /** The invalid document this arm seeds, kept so the arm can prove it was not rewritten. */
  const corrupt = "{ this is not the record"
  /** The harness whose record is corrupted mid-run (the hook runs at barrier time, after construction). */
  let harness: Harness
  harness = makeHarness({ duringSpawn: (): void => { writeFileSync(statePath(harness.workspace, CELL_ID), corrupt, "utf8") } })
  await stopListener(harness)({ agent: harness.member })
  // THE REFUSED FILE COMES FIRST (contract §5's fail-before rule): this is the assertion Major-8 exists to
  // protect, and it must be the one that goes RED on the pre-fix behaviour — not a journal flag downstream
  // of it, which stops the test before the bytes are ever compared.
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(corrupt)
  /** The branch's journal row. */
  const row = journalRows(harness).find((entry) => entry.event === "barrier-record-unreadable")
  expect(row).toBeDefined()
  expect(row?.member).toBe(MEMBER_NAME)
  // HONEST: nothing was persisted, so no fence and no lever is claimed.
  expect(row?.fenced).toBe("not-persisted")
  expect(row?.forceEligible).toBe(false)
  // THE FORCED LEVER IS CONDITIONAL, AND THE ROW SAYS SO: it needs a WRITTEN bound, and this run persisted
  // no fence at all — naming the verb unconditionally beside `forceEligible:false` contradicted itself.
  expect(String(row?.retry)).toContain("ONCE a written bound exists")
  expect(String(row?.retry)).toContain("cellwork_dispatch")
  expect(String(row?.recovery)).toContain("NOT rewritten")
})

test("A5: a throw AFTER the spawn is journaled, fences the seat and RELEASES the activation", async () => {
  // THE THROW LANDS IN THE READ-BACK, after the seat was handed over. A throw at the SNAPSHOT read is the
  // classified F1 shape (`team-record-unreadable`, A7) and never reaches this branch.
  /** The harness whose plane read-back throws once the fresh handle is on disk. */
  const harness = makeHarness({ planeThrowsAt: "verify" })
  await stopListener(harness)({ agent: harness.member })
  /** The give-up row: the refused outcome carries the branch's own sentence. */
  const row = journalRows(harness).find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row).toBeDefined()
  expect(String(row?.reason)).toContain("after the child started")
  // THE CHILD THE SPAWN CREATED IS RELEASED: nothing keeps a slot for a half-bound seat.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
  // THE BIND IS ROLLED BACK (Major-7): the write that preceded the failed read-back is undone, so the TEAM
  // row and the board owner name the OLD handle again — no half-bound seat survives the failure.
  expect(row?.rollback).toBe("restored")
  /** The team record after the rollback. */
  const record = harness.record()
  expect(record.members.find((seat) => seat.name === MEMBER_NAME)?.executorRef).toBe(OLD_HANDLE)
  expect(record.tasks.find((task) => String(task.id) === "T1")?.owner).toBe(OLD_HANDLE)
  // THE SEAT IS FENCED, so the captain can see it and the forced lever can clear it.
  expect(cellMember(harness).fenced).toBe(true)
})

// ── A6: the slot is released ────────────────────────────────────────────────

test("A6: a spawn that answers without a child id disposes the activation", async () => {
  /** The activation the backend answered with: a release seam and NO child id. */
  const activation = { disposed: false, dispose: async (): Promise<void> => { activation.disposed = true } }
  /** The harness whose backend mints no handle. */
  const harness = makeHarness({ start: (): unknown => activation })
  await stopListener(harness)({ agent: harness.member })
  expect(activation.disposed).toBe(true)
  // AND NOTHING IS CLAIMED: no reseed, no bind, and the refusal names the reason.
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "member-reseeded")).toBe(false)
  /** The give-up row. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(String(row?.reason)).toContain("no child id")
  expect(String(row?.reason)).toContain("RELEASED")
  // THE RECORD IS UNTOUCHED: a spawn that failed bound nothing.
  expect(harness.record().members[0].executorRef).toBe(OLD_HANDLE)
})

// ── A7: an UNREADABLE record refuses; an ABSENT one is `absent` (F1) ────────

test("A7: a team record that EXISTS but cannot be read NEVER reports `reseeded` — it names the surface, fences and releases", async () => {
  // A READABLE RECORD IS SEEDED FIRST (makeHarness writes it), then the read path breaks AT BIND TIME: the
  // spawn hook overwrites the record with invalid JSON, i.e. after the barrier read the CELL record and
  // before the bind reads the TEAM record.
  /** The harness whose record is corrupted inside the spawn. */
  let harness: Harness
  harness = makeHarness({ duringSpawn: (): void => { writeFileSync(harness.recordPath, "{ this is not a team record", "utf8") } })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // NO SUCCESS IS CLAIMED OVER A SURFACE NOBODY CAN READ.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "member-reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  // THE UNRECOVERABLE ROW NAMES THE SURFACE AND THE RETRY.
  /** The give-up row. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-unreadable")
  expect(String(unrecoverable?.reason)).toContain("could not be bound")
  expect(String(unrecoverable?.retry)).toContain('cellwork_dispatch {unfence:[{member, force:true}]}')
  // THE SEAT IS FENCED: the captain can see it and the forced lever can clear it.
  expect(cellMember(harness).fenced).toBe(true)
  // AND THE CHILD THAT COULD NOT BE BOUND IS RELEASED, so no slot is held by a seatless session.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
  // THE CORRUPT BYTES ARE NOT OVERWRITTEN: a bind that cannot read a record must not replace it.
  expect(readFileSync(harness.recordPath, "utf8")).toContain("this is not a team record")
})

test("A7: a plane read that THROWS while the record exists is the unreadable case, never `absent`", async () => {
  /** The harness whose record file is readable but whose plane read throws. */
  const harness = makeHarness({ planeThrowsAt: "read" })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // THE EXISTING RECORD IS NOT RE-READ AS "NOTHING": the failure names the unreadable surface.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  /** The give-up row. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-unreadable")
  expect(String(unrecoverable?.reason)).toContain("exists but the plane's read threw")
  // FENCED AND RELEASED, the same shape as the corrupt-file arm.
  expect(cellMember(harness).fenced).toBe(true)
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A7: a cell whose workspace holds NO team record answers `absent` and still reseeds (the control)", async () => {
  // THE CONTROL KEEPS THE OLD BEHAVIOUR: nothing created the surface, so there is nothing to bind and a
  // healthy child must not be stranded for it. Only "exists but unreadable" refuses.
  /** The harness with no record file at all. */
  const harness = makeHarness({ recordFile: false })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(true)
  // THE BIND ROW SAYS WHICH PLANE ANSWERED, and it answered `absent` rather than `bound`.
  /** The bind row. */
  const bound = rows.find((row) => row.event === "seat-rebound")
  expect(bound?.plane).toBe("absent")
  expect(bound?.newHandle).toBe(NEW_HANDLE)
  // THE CELL SURFACE IS STILL BOUND, and no record file was invented.
  expect(cellMember(harness).sessionId).toBe(NEW_HANDLE)
  expect(existsSync(harness.recordPath)).toBe(false)
})

// ── A8: an external write inside the bind window is never overwritten (F2) ──

test("A8: a write that lands between the bind's read and its rename is REFUSED, not overwritten", async () => {
  // THE EXTERNAL WRITER commits AFTER the bind's read served its snapshot and BEFORE the rename: it changes
  // the SEAT ROW (today's `TeamRecord` carries no top-level `revision`, so the member-roster hash is the
  // always-present half of the fingerprint the compare reads; a `revision`/`updatedAt` is honoured too when
  // a record carries one).
  /** The harness whose plane read is followed by another writer's commit. */
  const harness = makeHarness({
    externalWriteAfterRead: (served): TeamRecordFile => ({ ...served, members: served.members.map((row) => (row.name === MEMBER_NAME ? { ...row, status: "inactive" } : row)) }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // THE BIND REFUSED: no success over a record another writer moved.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  /** The give-up row, which names the changed surface and the retry. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-changed")
  expect(String(unrecoverable?.reason)).toContain("changed while this bind was building its write")
  expect(String(unrecoverable?.reason)).toContain("member roster changed")
  // THE OTHER WRITER'S BYTES SURVIVE: the seat is still THEIR row, at the dead handle, and not re-pointed.
  /** The record as it stands after the refusal. */
  const record = harness.record()
  /** The seat row the other writer changed. */
  const seat = record.members.find((row) => row.name === MEMBER_NAME)
  expect(seat?.status).toBe("inactive")
  expect(seat?.executorRef).toBe(OLD_HANDLE)
  expect(seat?.mode).toBe("checkpoint")
  // THE SEAT IS FENCED AND THE FRESH CHILD RELEASED, the same failure shape as every refused bind.
  expect(cellMember(harness).fenced).toBe(true)
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A8: a record that carries a REVISION is refused when that revision moved inside the window", async () => {
  // THE OTHER HALF OF F2's FINGERPRINT: a record shape that carries a top-level `revision` is compared on
  // that number FIRST, so the refusal names the exact document generation the other writer committed.
  /** The harness whose seeded record carries a document revision. */
  const harness = makeHarness({
    team: { ...teamRecord(), revision: 1 },
    externalWriteAfterRead: (served): TeamRecordFile => ({ ...served, revision: 2 }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  /** The give-up row. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-changed")
  expect(String(unrecoverable?.reason)).toContain("revision moved from 1 to 2")
  // THE OTHER WRITER'S GENERATION SURVIVES: revision 2 is still on disk, untouched by this bind.
  expect(harness.record().revision).toBe(2)
  expect(cellMember(harness).fenced).toBe(true)
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A8: without an external write the SAME harness binds normally (the control)", async () => {
  /** The harness with no injected writer. */
  const harness = makeHarness()
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(true)
  /** The bind row. */
  const bound = rows.find((row) => row.event === "seat-rebound")
  expect(bound?.plane).toBe("bound")
  expect(bound?.tasks).toBe(1)
  expect(harness.record().members[0].executorRef).toBe(NEW_HANDLE)
})

// ── A9: drift OUTSIDE the member row is refused too (F2's byte predicate) ───

test("A9: a write that changes only the BOARD inside the window is REFUSED — the raw bytes are the predicate", async () => {
  // THE OTHER WRITER TOUCHES NOTHING THE MEMBER-HASH FINGERPRINT CAN SEE: the roster is byte-identical and
  // the seeded record carries no top-level `revision`/`updatedAt` (today's `TeamRecord` carries neither), so
  // ONLY the whole-byte comparison can catch this. That is the guarantee F2 claims; A8's member-row write
  // cannot distinguish it from a field-level fingerprint.
  /** The harness whose plane read is followed by a BOARD-ONLY commit. */
  const harness = makeHarness({
    externalWriteAfterRead: (served): TeamRecordFile => ({
      ...served,
      tasks: served.tasks.map((task) => (String(task.id) === "T1" ? { ...task, status: "review", revision: 99 } : task)),
    }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // THE BIND REFUSED: no success is claimed over the other writer's board.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  /** The give-up row, which names the changed surface. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-changed")
  // AND THE REFUSAL NAMES THE RAW-BYTE BRANCH: no watched field moved, so the sentence is the byte compare.
  expect(String(unrecoverable?.reason)).toContain("its contents changed")
  expect(String(unrecoverable?.reason)).not.toContain("member roster changed")
  // THE OTHER WRITER'S BYTES SURVIVE, including the board row the bind would have re-pointed.
  /** The record as the FILE stands after the refusal. */
  const record = harness.record()
  /** The board row the other writer moved. */
  const drifted = record.tasks.find((task) => String(task.id) === "T1")
  expect(drifted?.status).toBe("review")
  expect(drifted?.revision).toBe(99)
  expect(drifted?.owner).toBe(OLD_HANDLE)
  // THE SEAT IS FENCED AND THE FRESH CHILD RELEASED, the same failure shape as every refused bind.
  expect(cellMember(harness).fenced).toBe(true)
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A9: a write confined to handoffs/consults is REFUSED as well — no part of the record is exempt", async () => {
  // NEITHER THE ROSTER NOR THE BOARD MOVES: the other writer appends two ledgers the bind never reads. A
  // field/roster fingerprint would let this through; the byte predicate refuses it like any other write.
  /** The harness whose plane read is followed by a LEDGER-ONLY commit. */
  const harness = makeHarness({
    externalWriteAfterRead: (served): TeamRecordFile => ({
      ...served,
      handoffs: [{ member: MEMBER_NAME, path: ".mpd/team/handoffs/senior-engineer-2.md", at: "2026-11-11T00:02:00.000Z" }],
      consults: [{ id: "C1", member: MEMBER_NAME, state: "running" }],
    }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  expect(rows.some((row) => row.event === "seat-rebound")).toBe(false)
  /** The give-up row. */
  const unrecoverable = rows.find((row) => row.event === "checkpoint-unrecoverable")
  expect(unrecoverable?.surface).toBe("team-record-changed")
  expect(String(unrecoverable?.reason)).toContain("its contents changed")
  // THE OTHER WRITER'S LEDGERS SURVIVE: the bind did not replace the file with its own snapshot.
  /** The record as the FILE stands after the refusal. */
  const record = harness.record()
  expect(record.handoffs).toHaveLength(1)
  expect(record.consults).toHaveLength(1)
  expect(record.members[0].executorRef).toBe(OLD_HANDLE)
  // FENCED AND RELEASED, and the fresh handle was never written to the roster.
  expect(cellMember(harness).fenced).toBe(true)
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A9: the SAME seed binds normally when NO external write lands (the contrast)", async () => {
  // THE CONTRAST A9 NEEDS: the refusals above are the WRITE, not the seed. With nothing injected, the same
  // board-shaped record binds and reports `bound`.
  /** The harness with no injected writer. */
  const harness = makeHarness()
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(true)
  /** The bind row. */
  const bound = rows.find((row) => row.event === "seat-rebound")
  expect(bound?.plane).toBe("bound")
  expect(bound?.tasks).toBe(1)
  expect(harness.record().members[0].executorRef).toBe(NEW_HANDLE)
})

// ── A10: the record FILE is the surface when the plane is UNMOUNTED (F1) ────

test("A10: with NO team plane but a readable record file, the bind uses the FILE, verifies from it, and says `plane:\"bound\"`", async () => {
  // A LEGITIMATE COMPOSITION: `mpdTeams` is not mounted, yet `.mpd/team/teams/<id>.json` exists. The bind
  // must take its snapshot FROM THE FILE, write that file, verify it by RE-READING THE FILE (a plane that
  // does not exist cannot answer), and report `plane: "bound"` — `absent` belongs ONLY to a workspace that
  // holds no record at all. A refusal here would strand a healthy child for a surface that does exist.
  /** The harness whose `mpdTeams` service was never mounted. */
  const harness = makeHarness({ planeRead: false })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  // THE RESEED COMPLETED — the unmounted plane is NOT an absent record.
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(true)
  expect(rows.some((row) => row.event === "checkpoint-unrecoverable")).toBe(false)
  /** The bind row: `bound` says a RECORD surfaced this bind, and in this composition that record is the file. */
  const bound = rows.find((row) => row.event === "seat-rebound")
  expect(bound?.plane).toBe("bound")
  expect(bound?.tasks).toBe(1)
  expect(bound?.newHandle).toBe(NEW_HANDLE)
  // THE FILE ITSELF IS WHAT WAS WRITTEN AND VERIFIED, read BACK FROM DISK: no plane exists here, so a green
  // bind is proof the read-back did not go through one.
  /** The record as the FILE answers it. */
  const record = harness.record()
  /** The seat row. */
  const seat = record.members.find((row) => row.name === MEMBER_NAME)
  expect(seat?.executorRef).toBe(NEW_HANDLE)
  expect(seat?.mode).toBe("member")
  /** The board row the old handle owned. */
  const task = record.tasks.find((row) => String(row.id) === "T1")
  expect(task?.owner).toBe(NEW_HANDLE)
  // AND THE CELL SURFACE NAMES THE FRESH HANDLE, unfenced: the bind was reported only after the file read.
  expect(cellMember(harness).sessionId).toBe(NEW_HANDLE)
  expect(cellMember(harness).fenced).not.toBe(true)
})

// ── A11/A12: a failed verification ROLLS BACK, or refuses to overwrite a concurrent write ────────────

test("A11: a read-back that answers a STALE handle ROLLS BACK the TEAM row and the board owners — both surfaces stay consistent", async () => {
  // A NON-THROWING verification failure: the write landed, the plane's read-back answers the OLD handle.
  // The bind must undo its own write instead of leaving the TEAM record bound to a child while the CELL
  // row still names the dead session (the half-bound seat the defect is about).
  /** The harness whose plane read-back is stale. */
  const harness = makeHarness({ staleVerify: true })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  /** The give-up row. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row?.rollback).toBe("restored")
  expect(String(row?.reason)).toContain("ROLLED BACK")
  // BOTH SURFACES ROLLED BACK TOGETHER: the TEAM row carries the pre-bind handle and mode, and the board
  // owner is the old handle again.
  /** The record as the file answers it after the rollback. */
  const record = harness.record()
  /** The seat row. */
  const seat = record.members.find((member) => member.name === MEMBER_NAME)
  expect(seat?.executorRef).toBe(OLD_HANDLE)
  expect(seat?.mode).toBe("checkpoint")
  expect(seat?.handoff).toEqual({ path: ".mpd/team/handoffs/senior-engineer-1.md", at: "2026-11-11T00:01:00.000Z" })
  /** The board rows by id. */
  const tasks = new Map(record.tasks.map((task) => [String(task.id), task]))
  expect(tasks.get("T1")?.owner).toBe(OLD_HANDLE)
  expect(tasks.get("T1")?.revision).toBe(7)
  // THE CELL ROW KEEPS THE OLD SESSION AND IS FENCED, naming the refused surface in its reason.
  /** The cell's member row. */
  const cell = cellMember(harness)
  expect(cell.sessionId).toBe(OLD_HANDLE)
  expect(cell.fenced).toBe(true)
  expect(String(cell.fencedReason)).toContain("could not be bound")
  // AND THE CHILD THAT COULD NOT BE BOUND IS RELEASED.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(true)
})

// ── A12/A12b: a rollback that meets a concurrent write refuses to release what it still names ─────────

test("A12: a rollback that meets a CONCURRENT WRITE refuses to overwrite it and says so", async () => {
  // THE ROLLBACK'S OWN RACE: another writer commits between the bind's write and its read-back. The
  // rollback must compare the bytes it wrote with the file, and on a difference REFUSE — a rollback that
  // clobbered that writer would be the same lost update in the other direction.
  /** The marker the other writer's document carries, so the arm can prove it survived. */
  const MARKER = "concurrent-writer"
  /** The harness whose file moves to another writer's document at the read-back. */
  const harness = makeHarness({ externalWriteAtVerify: (written) => ({
    ...written,
    phase: MARKER,
    members: written.members.map((member) => (member.name === MEMBER_NAME ? { ...member, executorRef: OLD_HANDLE, mode: "checkpoint" } : member)),
    tasks: written.tasks.map((task) => (String(task.id) === "T1" ? { ...task, owner: OLD_HANDLE } : task)),
  }) })
  await stopListener(harness)({ agent: harness.member })
  /** The journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  /** The give-up row. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row?.rollback).toBe("refused")
  expect(String(row?.reason)).toContain("rollback refused due to concurrent change")
  // THE OTHER WRITER'S DOCUMENT IS UNTOUCHED: the rollback read it, proved it was no longer this bind's
  // write, and refused. Its old/old pair is what a reader now sees.
  /** The record on disk. */
  const record = harness.record()
  expect(record.phase).toBe(MARKER)
  /** The seat row the other writer left. */
  const seat = record.members.find((member) => member.name === MEMBER_NAME)
  expect(seat?.executorRef).toBe(OLD_HANDLE)
  expect(record.tasks.find((task) => String(task.id) === "T1")?.owner).toBe(OLD_HANDLE)
  // THE SEAT IS FENCED AND RECOVERABLE: the CELL fence is the give-up fact the captain's `unfence` lever
  // reopens, so a refused rollback never leaves an unclearable seat behind.
  /** The cell's member row. */
  const cell = cellMember(harness)
  expect(cell.fenced).toBe(true)
  expect(cell.barrierFailures).toBe(1)
  /** The captain's unfence call, over the SAME harness the barrier ran in. */
  const cleared = await harness.tools.get("cellwork_dispatch")!.execute({ unfence: [MEMBER_NAME] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** The unfence outcomes. */
  const outcomes = Array.isArray(cleared.unfenced) ? cleared.unfenced as Array<Record<string, unknown>> : []
  expect(outcomes.find((entry) => entry.member === MEMBER_NAME)?.unfenced).toBe(true)
  expect(cellMember(harness).fenced).not.toBe(true)
  expect(harness.activations[0].disposed).toBe(true)
})

test("A12b: a refused rollback whose surviving document PRESERVES the fresh handle KEEPS the child and hands over the rebind", async () => {
  // THE HOLE A12'S OLD/OLD SHAPE COULD NOT REACH (contract §3 A11). A real concurrent writer — team-core's
  // own read-modify-write — commits a document that still carries THIS bind's fresh `executorRef`, and the
  // read-back then fails for its own reason (a throwing plane read). The rollback refuses to overwrite that
  // document, so the surviving record NAMES the child: releasing it would leave the record pointing at a
  // released seat, the exact stranded seat this contract repairs. The child must stay alive, the journal
  // must carry the reconcile marker, and the failure sentence must name a verb that RE-POINTS
  // `executorRef` (`unfence` alone never touches the handle).
  /** The marker the other writer's document carries, so the arm proves it survived. */
  const MARKER = "concurrent-writer-preserves-child"
  /** The harness whose file moves to a new-handle-preserving document and whose read-back then throws. */
  const harness = makeHarness({
    planeThrowsAt: "verify",
    externalWriteAtVerify: (written) => ({
      ...written,
      phase: MARKER,
      members: written.members.map((member) => (member.name === MEMBER_NAME ? { ...member, executorRef: NEW_HANDLE } : member)),
    }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** Every journal row. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  /** The give-up row this refusal writes. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row?.rollback).toBe("refused")
  // THE CHILD IS NOT RELEASED: the surviving document names it, so it is still a legitimate seat holder.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(false)
  // THE REFUSAL IS A RECORD, NOT A HOPE: the row names the kept child, the reconcile requirement, the fact
  // that the binding was kept, and a repair verb that re-points `executorRef`.
  expect(row?.orphanChild).toBe(NEW_HANDLE)
  expect(row?.reconcileRequired).toBe(true)
  expect(String(row?.reason)).toContain("BINDING KEPT")
  expect(String(row?.reason)).toContain(NEW_HANDLE)
  expect(String(row?.retry)).toContain("rebind:")
  // THE OPERATOR'S ANSWER IS THE CELL RECORD ITSELF: the barrier writes `fencedReason` from the refusal's
  // reason, so `cellwork_supervise` shows the same repair sentence the journal row carries.
  expect(String(cellMember(harness).fencedReason)).toContain("rebind")
  // THE OTHER WRITER'S DOCUMENT SURVIVED BYTE-FOR-BYTE: its phase marker is still what the file carries.
  /** The record on disk. */
  const record = harness.record()
  expect(record.phase).toBe(MARKER)
  expect(record.members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
  // AND THE OPERATOR'S FAILURE-SENTENCE REPAIR ACTUALLY RECOVERS THE SEAT: rebind re-points the TEAM row and
  // mirrors the handle into the CELL row, unfence clears the give-up marker, both in ONE call.
  /** The captain's repair, driven exactly as the failure sentence spells it. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }], unfence: [MEMBER_NAME] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** The rebind outcomes. */
  const rebounds = Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []
  expect(rebounds.find((entry) => entry.member === MEMBER_NAME)?.rebound).toBe(true)
  /** The cell row after the repair: the surviving child's handle, an open seat, no pending handoff. */
  const repairedCell = cellMember(harness)
  expect(repairedCell.sessionId).toBe(NEW_HANDLE)
  expect(repairedCell.executorRef).toBe(NEW_HANDLE)
  expect(repairedCell.mode).toBe("member")
  expect(repairedCell.handoffReady).toBe(false)
  expect(repairedCell.fenced).not.toBe(true)
  /** The TEAM row after the repair. */
  const repairedSeat = harness.record().members.find((member) => member.name === MEMBER_NAME)
  expect(repairedSeat?.executorRef).toBe(NEW_HANDLE)
  expect(repairedSeat?.mode).toBe("member")
})

test("A12c: a rollback that could not be WRITTEN keeps the child too — an unproven record never proves a child unbindable", async () => {
  // THE OTHER UNPROVEN SHAPE (contract §3 A11 applied to its own evidence rule). The read-back throws, and
  // by the time the rollback re-reads the record the file is gone: the rollback cannot be written, so NO
  // reader can say whether the record still named the child. Releasing on that silence is the same bet A11
  // forbids for a refused rollback, so the child is kept and the reconcile marker travels.
  /** The harness whose record disappears before the rollback can read it. */
  let harness: Harness
  harness = makeHarness({ planeThrowsAt: "verify", duringVerifyThrow: (): void => { rmSync(harness.recordPath, { force: true }) } })
  await stopListener(harness)({ agent: harness.member })
  /** Every journal row. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction" && row.outcome === "reseeded")).toBe(false)
  /** The give-up row this refusal writes. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row?.rollback).toBe("failed")
  expect(row?.orphanChild).toBe(NEW_HANDLE)
  expect(row?.reconcileRequired).toBe(true)
  expect(String(row?.reason)).toContain("BINDING KEPT")
  expect(String(row?.retry)).toContain("rebind:")
  // THE CHILD IS NOT RELEASED, and the seat is fenced so the operator sees it.
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(false)
  expect(cellMember(harness).fenced).toBe(true)
})

// ── A13: the pre-await snapshot is NEVER written back ───────────────────────────────────────────────

test("A13: a record re-read failure writes NOTHING — a concurrent writer's fields survive and the fence is `not-persisted`", async () => {
  // THE LOST UPDATE. The record is valid JSON this build REFUSES (a future version) and it already carries
  // ANOTHER writer's row. The barrier's pre-await snapshot knows nothing about that row; writing it back
  // would delete it. The branch must write NOTHING, report `fenced:"not-persisted"` and hand over a recovery.
  /** The concurrent writer's row key. */
  const CONCURRENT = "Concurrent Writer"
  /** The exact bytes of the refused document, captured so byte identity can be asserted. */
  let refused = ""
  /** The harness whose record is replaced at spawn time by the concurrent writer's document. */
  let harness: Harness
  harness = makeHarness({ duringSpawn: (): void => {
    /** The current record, read so the concurrent row is ADDED rather than invented. */
    const doc = JSON.parse(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")) as Record<string, unknown>
    doc.version = 999
    doc.members = { ...(doc.members as Record<string, unknown>), [CONCURRENT]: { name: CONCURRENT, role: CONCURRENT, sessionId: "session-concurrent", executorRef: "session-concurrent", mode: "member", handoffReady: false, handoffs: 1, joinedAt: "2026-11-11T00:02:00.000Z" } }
    refused = JSON.stringify(doc, null, 2) + "\n"
    writeFileSync(statePath(harness.workspace, CELL_ID), refused, "utf8")
  } })
  await stopListener(harness)({ agent: harness.member })
  // THE REFUSED BYTES COME FIRST (contract §5's fail-before rule): byte identity is the property Major-8
  // exists to protect, so this assertion — not a journal flag downstream of it — is the one that must go RED
  // on the pre-fix behaviour.
  expect(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")).toBe(refused)
  /** The branch's journal row. */
  const row = journalRows(harness).find((entry) => entry.event === "barrier-record-unreadable")
  expect(row).toBeDefined()
  expect(row?.fenced).toBe("not-persisted")
  expect(row?.forceEligible).toBe(false)
  expect(String(row?.recovery)).toContain("NOT rewritten")
  expect(String(row?.retry)).toContain("ONCE a written bound exists")
  expect(String(row?.retry)).toContain("cellwork_dispatch")
  /** The refused document as it stands on disk. */
  const onDisk = JSON.parse(readFileSync(statePath(harness.workspace, CELL_ID), "utf8")) as Record<string, unknown>
  expect((onDisk.members as Record<string, unknown>)[CONCURRENT]).toBeDefined()
  // AND NOTHING CLAIMED A RESEED.
  expect(journalRows(harness).some((entry) => entry.event === "compaction" && entry.outcome === "reseeded")).toBe(false)
})

// ── A14: the status RENDER carries the closure reading ──────────────────────────────────────────────

test("A14: the status RENDER carries liveness/closed/deadReseed/unverified/forceEligible — and leaves a LIVE seat's line unchanged", async () => {
  // THE INCIDENT'S INVISIBILITY: a dead `subcaptain` rendered byte-identical to a healthy one. The TEXT
  // render must carry the closure reading, not only the structured result.
  /** The dead row A4 uses. */
  const stranded = memberRow({ mode: "subcaptain", handoffReady: false, handoffs: 1, sessionId: "session-dead-child", executorRef: "session-dead-child", checkpointSince: new Date(Date.now() - 1800000).toISOString() })
  /** The plane row naming the dead child as an open seat. */
  const plane = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: "session-dead-child", mode: "member" }])
  /** The dead seat's status harness. */
  const deadHarness = statusHarness(stranded, { team: plane })
  /** The rendered dead-seat status. */
  const deadText = deadHarness.render(await deadHarness.run())
  /** The rendered member line. */
  const deadLine = deadText.split("\n").find((line) => line.includes("members (1):")) ?? ""
  expect(deadLine).toContain("dead")
  expect(deadLine).toContain("closed")
  expect(deadLine).toContain("dead-reseed")
  expect(deadLine).toContain("force-eligible")
  // AN UNVERIFIED SEAT IS NAMED TOO, and its refused lever is never rendered as eligible.
  /** The same row on a composition with NO registry. */
  const unknownHarness = statusHarness(stranded, { agentsRegistry: false, team: plane })
  /** The rendered unknown-seat status. */
  const unknownText = unknownHarness.render(await unknownHarness.run())
  /** The rendered member line. */
  const unknownLine = unknownText.split("\n").find((line) => line.includes("members (1):")) ?? ""
  expect(unknownLine).toContain("unknown")
  expect(unknownLine).toContain("unverified")
  expect(unknownLine).not.toContain("force-eligible")
  // A LIVE, OPEN SEAT GAINS NO NOISE: the mode/flags output is exactly what it was.
  /** A healthy row whose recorded session the registry holds. */
  const liveRow = memberRow({ mode: "member", handoffReady: false, handoffs: 1 })
  /** The plane row naming the live session. */
  const livePlane = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "member" }])
  /** The live seat's status harness. */
  const liveHarness = statusHarness(liveRow, { team: livePlane, liveSessions: [OLD_HANDLE] })
  /** The rendered live-seat status. */
  const liveText = liveHarness.render(await liveHarness.run())
  /** The rendered member line. */
  const liveLine = liveText.split("\n").find((line) => line.includes("members (1):")) ?? ""
  expect(liveLine).toBe("  members (1): Senior Engineer[member]")
})

// ── A15: an owner spelled as the SEAT'S NAME is the same seat ───────────────────────────────────────

test("A15: a board row owned by the SEAT'S NAME is re-pointed too — terminal rows keep their owner", async () => {
  // A board row can name the seat by DISPLAY NAME instead of its session handle. Both spellings are the
  // same seat, so both move; a terminal row remains history whichever spelling it used.
  /** The default record, reshaped so T1 is owned by the member NAME. */
  const seeded = teamRecord()
  /** The board this arm seeds: one name-owned row plus one handle-owned row. */
  const tasks = seeded.tasks.map((task) => (String(task.id) === "T1" ? { ...task, owner: MEMBER_NAME } : task))
  tasks.push({ id: "T4", subject: "owned by the old handle", status: "in_progress", owner: OLD_HANDLE, revision: 2 })
  // THE NEGATIVE CONTROL (contract §3 A15): a row held by ANOTHER seat is never re-pointed. The name
  // spelling moves only the rows this seat holds, so a second member's row — by display name AND by
  // session handle — must survive the bind untouched, revision included.
  tasks.push({ id: "T5", subject: "held by another seat (name)", status: "in_progress", owner: "Junior Engineer", revision: 11 })
  tasks.push({ id: "T6", subject: "held by another seat (handle)", status: "in_progress", owner: "session-other-seat", revision: 12 })
  /** The harness whose board mixes both owner spellings. */
  const harness = makeHarness({ team: { ...seeded, tasks } })
  await stopListener(harness)({ agent: harness.member })
  /** The team record after the bind. */
  const record = harness.record()
  /** The rows by id. */
  const byId = new Map(record.tasks.map((task) => [String(task.id), task]))
  // THE MEMBER-NAME SPELLING IS THE SAME SEAT, so it is re-pointed exactly like the handle spelling.
  expect(byId.get("T1")?.owner).toBe(NEW_HANDLE)
  expect(byId.get("T4")?.owner).toBe(NEW_HANDLE)
  // TERMINAL ROWS ARE HISTORY, whichever spelling their owner used.
  expect(byId.get("T0")?.owner).toBe(OLD_HANDLE)
  expect(byId.get("T2")?.owner).toBe(OLD_HANDLE)
  // ANOTHER SEAT'S ROWS ARE NOT THIS SEAT'S TO HAND OVER — neither spelling, and not even the revision.
  expect(byId.get("T5")?.owner).toBe("Junior Engineer")
  expect(byId.get("T5")?.revision).toBe(11)
  expect(byId.get("T6")?.owner).toBe("session-other-seat")
  expect(byId.get("T6")?.revision).toBe(12)
  // AND THE BIND REPORTED BOTH RE-POINTS.
  expect(journalRows(harness).find((entry) => entry.event === "seat-rebound")?.tasks).toBe(2)
})

// ── A16: the recovery path is NOT re-entered ────────────────────────────────────────────────────────

test("A16: a seat the TEAM row already binds to a LIVE child is NOT reseeded again — the skip is journaled and the rebind repair reconciles the records", async () => {
  // THE RE-ENTRY (contract §3 A11's recovery path). An earlier run spawned the fresh child and its bind
  // SUCCEEDED, but the CELL record could not be re-read afterwards, so it still names the dead session and
  // still says `handoffReady:true`. The fresh child's own turn-end resolves back to this seat through the
  // TEAM row; without a guard the barrier would raise a SECOND child for one seat — one more seat nobody
  // can address. The guard refuses to spawn and says what reconciles the two records.
  /** The TEAM row the earlier bind left: the LIVE fresh handle, an open seat. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: NEW_HANDLE, mode: "member" }])
  /** The board row that moved with that bind. */
  seeded.tasks = seeded.tasks.map((task) => (String(task.id) === "T1" ? { ...task, owner: NEW_HANDLE } : task))
  /** The harness whose registry holds the fresh child as a live agent. */
  const harness = makeHarness({ team: seeded, liveSessions: [NEW_HANDLE] })
  /** The fresh child's own handle: its turn-end resolves to this seat through the TEAM row. */
  const freshChild: FakeAgent = { id: NEW_HANDLE, session: { id: NEW_HANDLE, header: { cwd: harness.workspace } } }
  await stopListener(harness)({ agent: freshChild })
  // NOTHING WAS SPAWNED: no second child, and no compaction attempt was even tried.
  expect(harness.activations).toHaveLength(0)
  /** Every journal row. */
  const rows = journalRows(harness)
  expect(rows.some((row) => row.event === "compaction")).toBe(false)
  /** The skip row this run wrote instead. */
  const row = rows.find((entry) => entry.event === "barrier-skipped")
  expect(row?.branch).toBe("reseed-already-bound")
  expect(row?.handle).toBe(NEW_HANDLE)
  expect(row?.recordedSessionId).toBe(OLD_HANDLE)
  expect(row?.reconcileRequired).toBe(true)
  expect(String(row?.retry)).toContain("rebind:")
  // THE RECORDS ARE LEFT AS THEY WERE: this is a record repair, not a barrier outcome, and a second writer
  // over a record that was just repaired is exactly what the guard exists to prevent.
  expect(cellMember(harness).sessionId).toBe(OLD_HANDLE)
  expect(cellMember(harness).handoffReady).toBe(true)
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
  // THE REPAIR THE ROW NAMES RECONCILES THE TWO RECORDS: the CELL row now names the live child and has no
  // pending handoff, so the guard's premise is gone and the seat is addressable again.
  await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: harness.captain })
  expect(cellMember(harness).sessionId).toBe(NEW_HANDLE)
  expect(cellMember(harness).executorRef).toBe(NEW_HANDLE)
  expect(cellMember(harness).handoffReady).toBe(false)
  expect(cellMember(harness).mode).toBe("member")
})

// ── A17: rebind's DEFINING effect — a DIFFERENT TEAM handle is rewritten ─────────────────────────────

test("A17: `rebind` rewrites a TEAM row that names a DIFFERENT handle and leaves the checkpoint window", async () => {
  // THE HOLE THIS ARM CLOSES. A12b and A16 both seed the TEAM row with the handle the repair is CALLED with,
  // so "the TEAM row names the handle after the call" was true BEFORE the call: a `rebind` whose TEAM write
  // was broken or absent passed both. Here the TEAM row names the OLD handle at `mode:"checkpoint"` and only
  // the CELL row names the fresh one, so this arm can only pass if the verb really writes the TEAM roster row.
  /** The TEAM row the repair starts from: a DIFFERENT handle, still inside the checkpoint window. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint", handoff: { path: ".mpd/team/handoffs/senior-engineer-1.md", at: "2026-11-11T00:01:00.000Z" } }])
  /** The CELL row only: it is what evidences the fresh handle for the operator's repair. */
  const cellRow = memberRow({ sessionId: NEW_HANDLE, executorRef: NEW_HANDLE, mode: "member", handoffReady: false })
  /** The harness whose identity registry PROVES the fresh child live. */
  const harness = makeHarness({ team: seeded, liveSessions: [NEW_HANDLE], member: cellRow })
  /** The TEAM seat row before the call. */
  const before = harness.record().members.find((member) => member.name === MEMBER_NAME)
  // THE PREMISE, ASSERTED — not assumed: the row the verb is supposed to rewrite is NOT already the answer.
  expect(before?.executorRef).toBe(OLD_HANDLE)
  expect(before?.mode).toBe("checkpoint")
  /** The captain's repair, driven exactly as A11's failure sentence spells it. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** The rebound outcomes. */
  const rebounds = Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []
  /** This seat's outcome. */
  const outcome = rebounds.find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(true)
  expect(outcome?.previousSessionId).toBe(OLD_HANDLE)
  expect(outcome?.handle).toBe(NEW_HANDLE)
  // R2: THE REGISTRY'S ANSWER IS REPORTED, never upgraded: this composition holds the child, so it is `live`.
  expect(outcome?.liveness).toBe("live")
  // THE DEFINING EFFECT: the TEAM row now names the fresh handle AND has left the checkpoint window.
  /** The TEAM seat row after the repair. */
  const seat = harness.record().members.find((member) => member.name === MEMBER_NAME)
  expect(seat?.executorRef).toBe(NEW_HANDLE)
  expect(seat?.mode).toBe("member")
  // THE HANDOFF IS HISTORY, not deleted by the re-point.
  expect(seat?.handoff).toEqual({ path: ".mpd/team/handoffs/senior-engineer-1.md", at: "2026-11-11T00:01:00.000Z" })
  // THE CELL MIRROR AGREES: both records name the same child, and no handoff is left pending.
  /** The CELL row after the repair. */
  const cell = cellMember(harness)
  expect(cell.sessionId).toBe(NEW_HANDLE)
  expect(cell.executorRef).toBe(NEW_HANDLE)
  expect(cell.mode).toBe("member")
  expect(cell.handoffReady).toBe(false)
  // AND THE HAND-OVER IS JOURNALED with the displaced spelling quoted.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The rebind row. */
  const row = rows.find((entry) => entry.event === "member-rebound")
  expect(row?.member).toBe(MEMBER_NAME)
  expect(row?.previousSessionId).toBe(OLD_HANDLE)
  expect(row?.handle).toBe(NEW_HANDLE)
  expect(row?.cellRow).toBe("mirrored")
  // THE DOCUMENTED POLICY FOR AN UNPROVEN HANDLE: it is REPORTED (`unproven`), not refused and never called
  // live. The SAME seeded record on a composition whose registry never learned the child.
  /** The harness whose registry does NOT hold the fresh handle. */
  const unprovenHarness = makeHarness({ team: seeded, member: cellRow })
  /** The same repair on that composition. */
  const unproven = await unprovenHarness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: unprovenHarness.captain }) as Record<string, unknown>
  /** That seat's outcome. */
  const unprovenOutcome = (Array.isArray(unproven.rebound) ? unproven.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(unprovenOutcome?.rebound).toBe(true)
  expect(unprovenOutcome?.liveness).toBe("unproven")
  expect(unprovenHarness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
})

// ── A18: rebind ALONE never clears a fence ──────────────────────────────────────────────────────────

test("A18: `rebind` ALONE leaves fenced/fencedReason byte-for-byte — the fence belongs to `unfence`", async () => {
  // A12b drives `rebind` and `unfence` in ONE call and asserts the final unfenced state, so a `rebind` that
  // silently cleared the give-up marker would pass it. This arm drives `rebind` ALONE and pins the marker.
  /** The give-up sentence the CELL row already carries; the arm compares it byte-for-byte afterwards. */
  const FENCE_REASON = "the reseed rollback was refused; repair with cellwork_dispatch {rebind:[...], unfence:[...]}"
  /** The TEAM row: the old handle, inside the checkpoint window (rebind's documented promotion target). */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint" }])
  /** The harness whose CELL row is fenced but already names the handle the repair asks for. */
  const harness = makeHarness({ team: seeded, member: memberRow({ sessionId: NEW_HANDLE, executorRef: NEW_HANDLE, mode: "checkpoint", fenced: true, fencedReason: FENCE_REASON, handoffReady: true }) })
  /** `rebind` alone: no `unfence` key at all. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  // NO UNFENCE OUTCOME EXISTS, because none was asked for.
  expect(repaired.unfenced).toBeUndefined()
  /** The CELL row after the repair. */
  const cell = cellMember(harness)
  // THE MARKER SURVIVED, EXACTLY.
  expect(cell.fenced).toBe(true)
  expect(cell.fencedReason).toBe(FENCE_REASON)
  // AND THE VERB DID DO ITS OWN JOB: the TEAM row left the checkpoint window.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.mode).toBe("member")
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  expect(rows.some((entry) => entry.event === "member-rebound")).toBe(true)
  // NOT ONE ROW CLAIMS A CLEAR: the fence is still the barrier's give-up fact.
  expect(rows.some((entry) => entry.event === "member-unfenced" || entry.event === "member-unfenced-forced")).toBe(false)
})

// ── A19: a write from another PROCESS inside rebind's window is refused ─────────────────────────────

test.skipIf(process.platform === "win32")("A19: a write by ANOTHER PROCESS inside rebind's window is refused (`team-record-changed`), never overwritten", async () => {
  // THE WINDOW IS SYNCHRONOUS (read -> compare -> temp+rename is one block), so an in-process writer cannot
  // land inside it. The arm therefore moves the window to the FILESYSTEM: the record path is a FIFO served by
  // a BACKGROUND WRITER, which answers the verb's SNAPSHOT with document A and its COMPARE with document B.
  // That is exactly the shape A8 measures for the reseed bind — another writer's document appears between
  // the read and the rename — and the verb must refuse it rather than overwrite the other writer.
  /** The document the SNAPSHOT reads: the seat at `checkpoint`, naming the old handle. */
  const first = teamRecord()
  /** The OTHER WRITER's document: a different phase marker, delivered to the COMPARE read. */
  const second: TeamRecordFile = { ...teamRecord(), phase: "concurrent-writer-inside-rebind-window" }
  /** The harness whose plane answers from memory, so the pipe is not drained before `rebind` opens it. */
  const harness = makeHarness({ rebindWindowWrite: { first, second }, team: first, member: memberRow({ sessionId: NEW_HANDLE, executorRef: NEW_HANDLE, mode: "member", handoffReady: false }) })
  /** The FIFO that replaces the record file. */
  rmSync(harness.recordPath, { force: true })
  execFileSync("mkfifo", [harness.recordPath])
  /** The two documents the background writer serves, in order. */
  const docA = join(harness.workspace, "snapshot-document.json")
  /** The other writer's document, served to the verb's COMPARE read. */
  const docB = join(harness.workspace, "external-write-document.json")
  writeFileSync(docA, JSON.stringify(first, null, 2) + "\n", "utf8")
  writeFileSync(docB, JSON.stringify(second, null, 2) + "\n", "utf8")
  /** The handshake file the writer touches once bash is running, before it blocks on the first open. */
  const ready = join(harness.workspace, "feeder.ready")
  /**
   * The background writer: serve A to the first reader, B to the second, then keep serving B so any later
   * read (or a diagnostic) still terminates instead of blocking on an empty pipe.
   */
  const script = 'set -eu; : > "$READY"; cat "$DOC_A" > "$FIFO"; cat "$DOC_B" > "$FIFO"; while :; do cat "$DOC_B" > "$FIFO"; done'
  /** The background writer process, killed in the arm's `finally`. */
  const feeder = spawn("bash", ["-c", script], { stdio: "ignore", detached: true, env: { ...process.env, READY: ready, DOC_A: docA, DOC_B: docB, FIFO: harness.recordPath } })
  try {
    // WAIT FOR THE WRITER TO EXIST before the window opens: the OS must have it running before the read.
    /** The deadline after which the handshake is treated as failed. */
    const deadline = Date.now() + 5000
    while (!existsSync(ready) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(existsSync(ready)).toBe(true)
    /** The captain's repair, on the record whose bytes another process moves inside the window. */
    const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
    /** The rebound outcomes. */
    const rebounds = Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []
    /** This seat's outcome. */
    const outcome = rebounds.find((entry) => entry.member === MEMBER_NAME)
    // THE SAME CAS SEMANTICS AS F2: the concurrent document is refused, never overwritten.
    expect(outcome?.rebound).toBe(false)
    expect(outcome?.reason).toBe("team-record-changed")
    expect(String(outcome?.detail)).toContain("changed while this rebind was building its write")
    // NOTHING WAS RENAMED OVER THE PIPE: the record path is still the FIFO the other writer serves, which is
    // the strongest proof that this verb wrote no document at all.
    expect(statSync(harness.recordPath).isFIFO()).toBe(true)
    // R4.1: THE FAILED ENTRY IS JOURNALED, not only answered.
    /** This arm's journal rows. */
    const rows = journalRows(harness)
    /** The failure row. */
    const failed = rows.find((entry) => entry.event === "member-rebind-failed")
    expect(failed?.member).toBe(MEMBER_NAME)
    expect(failed?.reason).toBe("team-record-changed")
    expect(failed?.handle).toBe(NEW_HANDLE)
    // AND THE CELL ROW WAS NOT MIRRORED: a refused TEAM write never leaves the two records disagreeing.
    expect(cellMember(harness).sessionId).toBe(NEW_HANDLE)
    expect(cellMember(harness).executorRef).toBe(NEW_HANDLE)
  } finally {
    // THE WRITER'S WHOLE GROUP IS KILLED, then the pipe goes away so no blocked `cat` outlives the arm.
    try {
      process.kill(-(feeder.pid as number), "SIGKILL")
    } catch {
      feeder.kill("SIGKILL")
    }
    rmSync(harness.recordPath, { force: true })
    rmSync(docA, { force: true })
    rmSync(docB, { force: true })
    rmSync(ready, { force: true })
  }
})

// ── A20/A21: the handle is validated — shape, trimming, and OWNERSHIP evidence (R2) ────────────────

test("A20: the handle is TRIMMED and must be the host's UUID form — a typo refuses the whole call, journaled", async () => {
  /** The TEAM row this arm repairs. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint" }])
  /** The harness whose registry proves the fresh child live. */
  const harness = makeHarness({ team: seeded, liveSessions: [NEW_HANDLE], member: memberRow({ sessionId: NEW_HANDLE, executorRef: NEW_HANDLE, mode: "member", handoffReady: false }) })
  /** The dispatch tool. */
  const dispatch = harness.tools.get("cellwork_dispatch")!
  // A TYPO IS REFUSED BEFORE ANY WRITE, and the sentence names the expected form.
  /** The refusal for a handle that is not the host's form. */
  const refusedResult = await dispatch.execute({ rebind: [{ member: MEMBER_NAME, handle: "not-a-handle" }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  expect(refusedResult.ok).toBe(false)
  expect(String(refusedResult.error)).toContain("8-4-4-4-12")
  // R4.1: THE ARGUMENT REFUSAL IS JOURNALED TOO.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The failure row. */
  const failed = rows.find((entry) => entry.event === "member-rebind-failed")
  expect(failed?.reason).toBe("invalid-handle")
  expect(failed?.member).toBe(MEMBER_NAME)
  // N4: THE TYPO ITSELF IS IN THE ROW, so the refused value can be reproduced without the answer.
  expect(failed?.handle).toBe("not-a-handle")
  // A VALUE PAST THE JOURNAL BOUND IS RECORDED AS CUT, never silently dropped or written whole.
  /** A paste long enough to exceed the row's `handle` bound (120 chars). */
  const LONG_TYPO = "x".repeat(200)
  await dispatch.execute({ rebind: [{ member: MEMBER_NAME, handle: LONG_TYPO }] }, { name: "cellwork_dispatch", agent: harness.captain })
  /** The LAST failure row, which is the long-value refusal. */
  const truncated = journalRows(harness).filter((entry) => entry.event === "member-rebind-failed").pop()
  expect(truncated?.handleTruncated).toBe(true)
  expect(String(truncated?.handle)).toBe("x".repeat(117) + "...")
  // NOTHING MOVED: the refused call wrote no record.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(OLD_HANDLE)
  // THE WHITESPACE A PASTE ADDS IS NOT PART OF THE IDENTITY: the padded handle is accepted, and the records
  // carry the TRIMMED value (so the next comparison cannot miss it).
  /** The same repair, with the handle padded as a copy/paste leaves it. */
  const accepted = await dispatch.execute({ rebind: [{ member: MEMBER_NAME, handle: "  " + NEW_HANDLE + "\n" }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** The accepted outcome. */
  const outcome = (Array.isArray(accepted.rebound) ? accepted.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(true)
  expect(outcome?.handle).toBe(NEW_HANDLE)
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
  expect(cellMember(harness).sessionId).toBe(NEW_HANDLE)
})

test("A21: a handle this seat's records never name is refused per entry — the registry proves liveness, not ownership", async () => {
  // A REAL, LIVE, WELL-FORMED HANDLE THAT BELONGS TO SOMEWHERE ELSE. The registry answers for it, so a verb
  // that trusted liveness would bind this seat to another session's child and the paired `unfence` would
  // reopen a seat on a ghost identity. Ownership is decided by THIS seat's own record trail.
  /** The foreign handle: shaped like the host mints them, held by the registry, named by no record of this seat. */
  const FOREIGN = "9a0c1d2e-0000-4000-8000-0000000beef0"
  /** The harness whose registry proves the FOREIGN handle live. */
  const harness = makeHarness({ liveSessions: [FOREIGN] })
  /** The captain's repair. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: FOREIGN }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(false)
  expect(outcome?.reason).toBe("handle-unevidenced")
  expect(String(outcome?.detail)).toContain("nothing here vouches for")
  // NEITHER RECORD MOVED.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(OLD_HANDLE)
  expect(cellMember(harness).sessionId).toBe(OLD_HANDLE)
  expect(cellMember(harness).executorRef).toBe(OLD_HANDLE)
  // AND THE ATTEMPT IS IN THE JOURNAL.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The failure row. */
  const failed = rows.find((entry) => entry.event === "member-rebind-failed")
  expect(failed?.reason).toBe("handle-unevidenced")
  expect(failed?.handle).toBe(FOREIGN)
})

// ── A22: the handle a reseed DISPLACES is journaled (R3) ────────────────────────────────────────────

test("A22: a reseed that overwrites an UNPROVEN TEAM handle journals the displaced handle (R3)", async () => {
  // THE GUARD IS INERT HERE ON PURPOSE: nothing proves the TEAM row's handle dead, and the decision to keep
  // that behaviour is deliberate. The consequence is that the bind replaces it — so the displaced handle must
  // stay findable, or an orphaned child disappears from every record.
  /** The handle the TEAM row names that no registry lookup proved dead. */
  const DISPLACED = "3c9b2a10-0000-4000-8000-0000000d15a0"
  /** The TEAM row that names it. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: DISPLACED, mode: "checkpoint" }])
  /** The harness whose registry holds neither the displaced handle nor the fresh one. */
  const harness = makeHarness({ team: seeded })
  await stopListener(harness)({ agent: harness.member })
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  // THE RESEED ITSELF STILL SUCCEEDED: the new handle is bound.
  expect(rows.some((entry) => entry.event === "compaction" && entry.outcome === "reseeded")).toBe(true)
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(NEW_HANDLE)
  // THE DISPLACED HANDLE IS ON EVERY ROW THAT REPORTS THE HAND-OVER, with the unproven marker beside it.
  for (const event of ["compaction", "seat-rebound", "member-reseeded"]) {
    /** The row this event wrote. */
    const row = rows.find((entry) => entry.event === event)
    expect(row?.displacedExecutorRef).toBe(DISPLACED)
    expect(row?.displacedUnproven).toBe(true)
  }
})

// ── A23: an unreadable record and a readable one WITHOUT a handle are told apart (R4.2) ─────────────

test("A23: a refused rollback whose surviving record is READABLE but carries no executorRef says exactly that", async () => {
  // "COULD NOT BE READ" SENDS THE OPERATOR TO REPAIR A FILE THE READER OPENED FINE. The two shapes must be
  // distinguishable in the sentence the refusal and the journal carry.
  /** The marker the other writer's document carries, so the arm proves it survived. */
  const MARKER = "readable-without-handle"
  /** The harness whose other writer leaves a PARSABLE record with a non-string `executorRef`. */
  const harness = makeHarness({
    planeThrowsAt: "verify",
    externalWriteAtVerify: (written) => ({
      ...written,
      phase: MARKER,
      members: written.members.map((member) => (member.name === MEMBER_NAME ? { ...member, executorRef: 42 } : member)),
    }),
  })
  await stopListener(harness)({ agent: harness.member })
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The give-up row this refusal writes. */
  const row = rows.find((entry) => entry.event === "checkpoint-unrecoverable")
  expect(row?.rollback).toBe("refused")
  // THE SENTENCE NAMES THE REAL SHAPE.
  expect(String(row?.reason)).toContain("READABLE")
  expect(String(row?.reason)).toContain("carries no string executorRef")
  expect(String(row?.reason)).not.toContain("could not be read")
  // THE CHILD IS STILL KEPT: an unproven record never proves a child unbindable (contract §3 A11).
  expect(harness.activations).toHaveLength(1)
  expect(harness.activations[0].disposed).toBe(false)
  expect(row?.orphanChild).toBe(NEW_HANDLE)
  // THE OTHER WRITER'S DOCUMENT SURVIVED.
  expect(harness.record().phase).toBe(MARKER)
})

// ── A24/A25: OWNERSHIP IS THE LATEST HAND-OVER, AND THE DISPLACED CHILD'S LIVENESS IS SURFACED (M1) ───

test("A24: a handle only an OLDER compaction row names is refused `handle-superseded` — the LATEST hand-over wins (M1)", async () => {
  // THE HOLE THIS ARM CLOSES. The journal is append-only, so a failure sentence from an EARLIER reseed still
  // quotes that reseed's child. Treating "any historical row named it" as ownership let an operator paste
  // that old handle and re-point the seat BACKWARDS — even to a child the registry still holds live — while
  // the CURRENT child became only `previousSessionId`. Here both records and the NEWER compaction row name
  // the current child; the stale handle exists only in the older row.
  /** The stale handle an operator pastes out of an earlier failure sentence; the registry still holds it. */
  const STALE = "1a2b3c4d-1111-4111-8111-11111111a24a"
  /** The current child: both records and the newer hand-over row name it. */
  const CURRENT = NEW_HANDLE
  /** The TEAM row as the CURRENT child left it — NOT the stale handle the request will name. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: CURRENT, mode: "member" }])
  /** The harness whose registry proves BOTH children live, so only the recency rule can refuse the stale one. */
  const harness = makeHarness({ team: seeded, liveSessions: [STALE, CURRENT], member: memberRow({ sessionId: CURRENT, executorRef: CURRENT, mode: "member", handoffReady: false }) })
  // THE PREMISE, ASSERTED: the old child is still LIVE — this is not a "dead handle" refusal.
  expect(harness.registry.has(STALE)).toBe(true)
  // THE APPEND-ONLY TRAIL: the older row created STALE, the newer row replaced it with CURRENT.
  seedJournal(harness, [
    { event: "compaction", member: MEMBER_NAME, outcome: "reseeded", attempts: 3, reason: "busy", newHandle: STALE },
    { event: "compaction", member: MEMBER_NAME, outcome: "reseeded", attempts: 3, reason: "busy", newHandle: CURRENT },
  ])
  /** The captain's repair, using the handle an old failure sentence quoted. */
  const refused = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: STALE }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(refused.rebound) ? refused.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(false)
  expect(outcome?.reason).toBe("handle-superseded")
  // THE EVIDENCE AND THE SUPERSEDING ROW ARE BOTH NAMED, per entry (M1).
  expect(outcome?.namedBy).toEqual(["journal:compaction"])
  /** The structured source that replaced the request. */
  const supersededBy = outcome?.supersededBy as Record<string, unknown> | undefined
  expect(supersededBy?.event).toBe("compaction")
  expect(supersededBy?.handle).toBe(CURRENT)
  expect(String(outcome?.detail)).toContain("compaction")
  expect(String(outcome?.detail)).toContain(CURRENT)
  // THE REFUSAL REPORTS WHAT IT WOULD HAVE DISPLACED AND WHETHER THAT CHILD IS LIVE (N1/F2): the answer,
  // not only the success path, carries the pair.
  expect(outcome?.previousSessionId).toBe(CURRENT)
  expect(outcome?.previousSessionIdLiveness).toBe("live")
  // AND IT NEVER ADVISES A DIRECTION (F1): the old sentence told the operator to `pass <latest.handle>`,
  // which is the backwards re-point in the crash window; the safe wording states both facts only.
  expect(String(outcome?.detail)).not.toContain("pass ")
  // NEITHER RECORD MOVED: the TEAM row still names the current child and the CELL row still mirrors it.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(CURRENT)
  expect(cellMember(harness).sessionId).toBe(CURRENT)
  expect(cellMember(harness).executorRef).toBe(CURRENT)
  // AND THE REFUSAL IS JOURNALED WITH THE SAME SUPERSEDING SOURCE, not only in the answer.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The failed entry's row. */
  const failed = rows.find((entry) => entry.event === "member-rebind-failed")
  expect(failed?.reason).toBe("handle-superseded")
  expect(failed?.handle).toBe(STALE)
  expect((failed?.supersededBy as Record<string, unknown> | undefined)?.event).toBe("compaction")
  // THE FAILURE PATH CARRIES THE SAME EVIDENCE AND DISPLACEMENT PAIR AS THE ANSWER (N1/F2): a regression that
  // drops `namedBy` or `previousSessionId`/`previousSessionIdLiveness` from a refusal now reddens here, not
  // only on the success path A25 pins.
  expect(failed?.namedBy).toEqual(["journal:compaction"])
  expect(failed?.previousSessionId).toBe(CURRENT)
  expect(failed?.previousSessionIdLiveness).toBe("live")
  // AND THE STALE REQUEST LANDED NO `member-rebound` ROW: nothing was re-pointed.
  expect(rows.some((entry) => entry.event === "member-rebound")).toBe(false)
})

test("A25: the DISPLACED handle's liveness is surfaced — a live previousSessionId says `live` in the answer AND the row (M1/N1)", async () => {
  // A rebind overwrites the TEAM `executorRef`, so a child that is still live can be replaced silently. The
  // answer and the `member-rebound` journal row must say which handle was displaced and whether the registry
  // still holds it, using the SAME `displacedExecutorRef`/`displacedUnproven` pair the reseed bind journals.
  /** The TEAM row: the live-but-replaced child, at the checkpoint window the repair promotes out of. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint" }])
  /** The CELL row: the CURRENT child the repair asks for (and the only surface that names it). */
  const cellRow = memberRow({ sessionId: NEW_HANDLE, executorRef: NEW_HANDLE, mode: "member", handoffReady: false })
  /** The harness whose registry proves the CURRENT child live and still holds the child it displaces. */
  const harness = makeHarness({ team: seeded, liveSessions: [NEW_HANDLE], member: cellRow })
  // THE PREMISE, ASSERTED: the displaced child is LIVE, so this is the visible-loss shape, not a dead handle.
  expect(harness.registry.has(OLD_HANDLE)).toBe(true)
  /** The captain's repair. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: NEW_HANDLE }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(true)
  expect(outcome?.previousSessionId).toBe(OLD_HANDLE)
  // THE THREE-STATE ANSWER FOR THE DISPLACED CHILD, and the R3 marker pair beside it.
  expect(outcome?.previousSessionIdLiveness).toBe("live")
  expect(outcome?.displacedExecutorRef).toBe(OLD_HANDLE)
  expect(outcome?.displacedUnproven).toBe(false)
  // THE EVIDENCE SOURCE IS NAMED: the CELL row was the only surface that named the requested handle.
  expect(outcome?.namedBy).toEqual(["cell"])
  // THE JOURNAL ROW CARRIES THE SAME CLAIMS — an operator reading the record later sees the live child.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The hand-over row. */
  const row = rows.find((entry) => entry.event === "member-rebound")
  expect(row?.previousSessionId).toBe(OLD_HANDLE)
  expect(row?.previousSessionIdLiveness).toBe("live")
  expect(row?.displacedExecutorRef).toBe(OLD_HANDLE)
  expect(row?.displacedUnproven).toBe(false)
  expect(row?.namedBy).toEqual(["cell"])
  expect(row?.handle).toBe(NEW_HANDLE)
  expect(row?.liveness).toBe("live")
})

// ── A26: ANOTHER SEAT'S RECORD IS NEVER THIS SEAT'S OWNERSHIP EVIDENCE (M2) ──────────────────────────

test("A26a: a handle named by ANOTHER seat's TEAM executorRef is refused (`handle-unevidenced`); both records stay put", async () => {
  // THE DECISIVE COUNTEREXAMPLE the earlier A21 could not make: A21 seeded FOREIGN only in the identity
  // registry, so an implementation that scanned EVERY member row would still pass it. Here FOREIGN is the
  // OTHER seat's TEAM `executorRef` — a global scan would happily bind this seat to it.
  /** A real, live, well-formed handle that belongs to the OTHER seat. */
  const FOREIGN = "9a0c1d2e-0000-4000-8000-0000000beef0"
  /** The roster: this seat at the old handle, the other seat at FOREIGN. */
  const seeded = teamRecord([
    { id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint" },
    { id: "M2", name: "Deep Worker", role: "Deep Worker", status: "running", executorRef: FOREIGN, mode: "member" },
  ])
  /** The harness whose registry proves FOREIGN live, so only OWNERSHIP can refuse it. */
  const harness = makeHarness({ team: seeded, liveSessions: [FOREIGN] })
  /** The captain asks for the OTHER seat's child. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: FOREIGN }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(false)
  expect(outcome?.reason).toBe("handle-unevidenced")
  // THE EVIDENCE LIST IS EMPTY: no surface OF THIS SEAT named the foreign handle.
  expect(outcome?.namedBy).toEqual([])
  // NEITHER RECORD MOVED — this seat's row AND the other seat's row.
  /** The team record as it stands after the refusal. */
  const record = harness.record()
  expect(record.members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(OLD_HANDLE)
  expect(record.members.find((member) => member.name === "Deep Worker")?.executorRef).toBe(FOREIGN)
  expect(cellMember(harness).sessionId).toBe(OLD_HANDLE)
  expect(cellMember(harness).executorRef).toBe(OLD_HANDLE)
  // AND THE ATTEMPT IS JOURNALED.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The failed entry's row. */
  const failed = rows.find((entry) => entry.event === "member-rebind-failed")
  expect(failed?.reason).toBe("handle-unevidenced")
  expect(failed?.handle).toBe(FOREIGN)
  expect(rows.some((entry) => entry.event === "member-rebound")).toBe(false)
})

test("A26b: a handle named by ANOTHER seat's journal hand-over is refused (`handle-unevidenced`); both records stay put", async () => {
  // THE JOURNAL HALF OF A26a. A global journal scan (dropping `row.member === memberName`) would accept this
  // foreign handle; the member-scoped rule must not. A21 remains the paired control: a live registry handle
  // that NO record names at all is refused the same way.
  /** The OTHER seat's child, live and named only by that seat's journal row. */
  const FOREIGN = "9a0c1d2e-0000-4000-8000-0000000beef0"
  /** The roster: this seat at the old handle; the other seat is the one the journal row names. */
  const seeded = teamRecord([
    { id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: OLD_HANDLE, mode: "checkpoint" },
    { id: "M2", name: "Deep Worker", role: "Deep Worker", status: "running", executorRef: OLD_HANDLE, mode: "member" },
  ])
  /** The harness whose registry proves FOREIGN live. */
  const harness = makeHarness({ team: seeded, liveSessions: [FOREIGN] })
  // THE OTHER SEAT'S HAND-OVER: a valid compaction row, for a DIFFERENT member.
  seedJournal(harness, [{ event: "compaction", member: "Deep Worker", outcome: "reseeded", attempts: 3, reason: "busy", newHandle: FOREIGN }])
  /** The captain asks this seat for the other seat's child. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: FOREIGN }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(outcome?.rebound).toBe(false)
  expect(outcome?.reason).toBe("handle-unevidenced")
  expect(outcome?.namedBy).toEqual([])
  // THE REFUSAL STILL REPORTS THE HANDLE IT WOULD HAVE DISPLACED AND ITS LIVENESS (N1/F2): the member this
  // seat still names is the live session the harness holds, and the answer must say so on the failure path.
  expect(outcome?.previousSessionId).toBe(OLD_HANDLE)
  expect(outcome?.previousSessionIdLiveness).toBe("live")
  // NEITHER RECORD MOVED.
  /** The team record as it stands after the refusal. */
  const record = harness.record()
  expect(record.members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(OLD_HANDLE)
  expect(record.members.find((member) => member.name === "Deep Worker")?.executorRef).toBe(OLD_HANDLE)
  expect(cellMember(harness).sessionId).toBe(OLD_HANDLE)
  expect(cellMember(harness).executorRef).toBe(OLD_HANDLE)
  // AND THE FAILED ENTRY IS JOURNALED, with the requested handle.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The failed entry's row. */
  const failed = rows.find((entry) => entry.event === "member-rebind-failed")
  expect(failed?.reason).toBe("handle-unevidenced")
  expect(failed?.handle).toBe(FOREIGN)
  // THE FAILURE ROW CARRIES THE SAME PAIR AS THE ANSWER (N1/F2), so the evidence source and the displaced
  // handle survive the call even when the operator reads only the journal.
  expect(failed?.namedBy).toEqual([])
  expect(failed?.previousSessionId).toBe(OLD_HANDLE)
  expect(failed?.previousSessionIdLiveness).toBe("live")
  expect(rows.some((entry) => entry.event === "member-rebound")).toBe(false)
})

// ── A27: THE CURRENT RECORD WINS; THE JOURNAL ONLY CORROBORATES (F1) ────────────────────────────────

test("A27: a record written AFTER the last hand-over with no journal row of its own is ACCEPTED — never superseded, never advised backwards (F1)", async () => {
  // THE WRITER'S OWN CRASH WINDOW. The record write lands after the last hand-over row and leaves no journal
  // row of its own, so the journal's "latest" row is OLDER than the record's current identity. The old rule
  // trusted that row: it marked the record's CURRENT handle `handle-superseded` and advised `pass <OLD>`,
  // which re-points the seat BACKWARDS. The current record must win, the answer must never mention the old
  // handle as a destination, and both records must stay on CURRENT.
  /** The record's CURRENT child: what both current records name and what the operator asks for. */
  const CURRENT = NEW_HANDLE
  /** The handle the last hand-over left behind; its row predates the record's own write. */
  const OLDER = OLD_HANDLE
  /** The record as the LATER write left it, stamped after the journal row seeded below. */
  const seeded: TeamRecordFile = {
    ...teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", executorRef: CURRENT, mode: "member" }]),
    tasks: [],
    updatedAt: "2026-11-11T00:05:00.000Z",
  }
  /** The harness: both current records name CURRENT, so the request cannot be stale. */
  const harness = makeHarness({ team: seeded, liveSessions: [CURRENT], member: memberRow({ sessionId: CURRENT, executorRef: CURRENT, mode: "member", handoffReady: false }) })
  // THE CRASH WINDOW, SEEDED LITERALLY: the journal's LAST hand-over named OLDER at 00:02Z; the record was
  // then written at 00:05Z naming CURRENT, and NO journal row records that write.
  seedJournal(harness, [{ event: "compaction", member: MEMBER_NAME, outcome: "reseeded", attempts: 3, reason: "busy", newHandle: OLDER, at: "2026-11-11T00:02:00.000Z" }])
  /** The captain's repair, asking for the handle the CURRENT records name. */
  const repaired = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: CURRENT }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's outcome. */
  const outcome = (Array.isArray(repaired.rebound) ? repaired.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  // THE RECORD WINS: no supersession and no refusal.
  expect(outcome?.rebound).toBe(true)
  expect(outcome?.reason).toBeUndefined()
  expect(outcome?.supersededBy).toBeUndefined()
  expect(outcome?.handle).toBe(CURRENT)
  // THE F1 MARKERS make the divergence explicit instead of silent.
  expect(outcome?.handleRecordCurrent).toBe(true)
  expect(outcome?.journalHandoverOlder).toBe(true)
  // NO COUNTER-ADVICE ANYWHERE IN THIS ENTRY: the answer never names the older handle and never says `pass`.
  const answer = JSON.stringify(outcome)
  expect(answer).not.toContain(OLDER)
  expect(answer).not.toContain("pass ")
  // THE RENDER OF THE SAME ANSWER CARRIES NEITHER THE OLDER HANDLE NOR A DIRECTION EITHER.
  /** The tool's declared render. */
  const render = harness.tools.get("cellwork_dispatch")!.output?.render
  /** The rendered blocks, flattened the way the adapter shows them. */
  const blocks = typeof render === "function" ? render({ rebind: [{ member: MEMBER_NAME, handle: CURRENT }] }, repaired) as Array<{ text?: unknown }> : []
  /** The text a reader would see. */
  const rendered = Array.isArray(blocks) ? blocks.map((block) => String(block.text ?? "")).join("\n") : ""
  expect(rendered).not.toContain(OLDER)
  expect(rendered).not.toContain("pass ")
  // THE RECORDS DID NOT MOVE BACKWARDS.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(CURRENT)
  expect(cellMember(harness).sessionId).toBe(CURRENT)
  expect(cellMember(harness).executorRef).toBe(CURRENT)
  // THE LANDED ROW CARRIES THE SAME PROVENANCE, and no failed row was written.
  /** This arm's journal rows. */
  const rows = journalRows(harness)
  /** The hand-over row. */
  const row = rows.find((entry) => entry.event === "member-rebound")
  expect(row?.handle).toBe(CURRENT)
  expect(row?.handleRecordCurrent).toBe(true)
  expect(row?.journalHandoverOlder).toBe(true)
  expect(rows.some((entry) => entry.event === "member-rebind-failed")).toBe(false)
})

test("A27 control: with NO current handle the journal's latest hand-over still decides — an older row is never evidence (F1)", async () => {
  // THE PAIRED CONTROL. The record names NO handle at all, so the journal is the only trail: its LATEST row
  // names CURRENT and its older row names OLDER. Requesting OLDER must still refuse `handle-superseded` (an
  // older row is not evidence), while requesting CURRENT — the latest row's handle — is accepted. The journal
  // stays useful exactly where the record is silent, and it never overrides a record that speaks.
  /** The stale handle only the OLDER row names. */
  const OLDER = OLD_HANDLE
  /** The handle the LATEST hand-over row names, and the only one the journal vouches for. */
  const CURRENT = NEW_HANDLE
  /** The roster: this seat exists but names NO executor handle. */
  const seeded = teamRecord([{ id: "M1", name: MEMBER_NAME, role: MEMBER_NAME, status: "running", mode: "member" }])
  /** The harness whose TEAM row and CELL row both name no handle. */
  const harness = makeHarness({ team: seeded, liveSessions: [CURRENT], member: memberRow({ sessionId: "", executorRef: "", mode: "member", handoffReady: false }) })
  seedJournal(harness, [
    { event: "compaction", member: MEMBER_NAME, outcome: "reseeded", attempts: 3, reason: "busy", newHandle: OLDER, at: "2026-11-11T00:02:00.000Z" },
    { event: "compaction", member: MEMBER_NAME, outcome: "reseeded", attempts: 3, reason: "busy", newHandle: CURRENT, at: "2026-11-11T00:03:00.000Z" },
  ])
  /** The captain asks for the handle only the OLDER row names. */
  const refused = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: OLDER }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's refusal. */
  const refusal = (Array.isArray(refused.rebound) ? refused.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(refusal?.rebound).toBe(false)
  expect(refusal?.reason).toBe("handle-superseded")
  expect(refusal?.namedBy).toEqual(["journal:compaction"])
  expect((refusal?.supersededBy as Record<string, unknown> | undefined)?.handle).toBe(CURRENT)
  // THE SAFE WORDING: no `pass <CURRENT>` direction, only the reconcile sentence.
  expect(String(refusal?.detail)).not.toContain("pass ")
  // NOTHING MOVED ON THE OLDER REQUEST.
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBeUndefined()
  // AND WITH THE RECORD SILENT THE LATEST ROW STILL DECIDES: the same harness accepts CURRENT.
  const accepted = await harness.tools.get("cellwork_dispatch")!.execute({ rebind: [{ member: MEMBER_NAME, handle: CURRENT }] }, { name: "cellwork_dispatch", agent: harness.captain }) as Record<string, unknown>
  /** This seat's acceptance. */
  const success = (Array.isArray(accepted.rebound) ? accepted.rebound as Array<Record<string, unknown>> : []).find((entry) => entry.member === MEMBER_NAME)
  expect(success?.rebound).toBe(true)
  expect(success?.namedBy).toEqual(["journal:compaction"])
  expect(success?.handleRecordCurrent).toBeUndefined()
  expect(harness.record().members.find((member) => member.name === MEMBER_NAME)?.executorRef).toBe(CURRENT)
})
