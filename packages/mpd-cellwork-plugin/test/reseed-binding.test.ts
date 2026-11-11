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
//
// Every workspace is a fresh temp dir; nothing here reads the repository's own state.
import { test, expect } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
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
const OLD_HANDLE = "session-old-member"

/** The live parent the reseed is raised under. */
const PARENT_SESSION = "session-parent"

/** The fresh handle the backend mints for the replacement session. */
const NEW_HANDLE = "handle-fresh-child"

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
}

/** The team record this harness serves through `mpdTeams` and writes to disk. */
interface TeamRecordFile {
  /** The record schema version (`readTeam` refuses anything but 1). */
  version: number
  /** A document revision, when the record shape carries one (today's `TeamRecord` does not). */
  revision?: number
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
  /** The cell row the barrier starts from. */
  member?: CellMemberRecord
  /** Whether the agents registry exists at all (false = liveness is always `unknown`). */
  agentsRegistry?: boolean
  /** Extra live sessions the registry holds (A4's dead seat needs the captain ONLY). */
  liveSessions?: readonly string[]
  /** The knobs that change the arm's timing/bounds. */
  knobs?: Partial<typeof DEFAULT_CELLWORK_CONFIG>
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
      // THE BIND RUNS ONLY AFTER THE SPAWN: from here on, the next team-record read is the bind's.
      if (options.externalWriteAfterRead !== undefined) armed = true
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
              // A7b: the plane's SNAPSHOT read throws while a readable record exists on disk — the
              // "exists but unreadable" case F1 refuses, which is not the same thing as "no record".
              if (options.planeThrowsAt === "read") throw new Error("the mpdTeams record read blew up")
              /** The record this read answers, read ONCE so an external write cannot land mid-answer. */
              const served = recordOnDisk()
              // A5: the read-BACK after this bind's write throws. Keyed on the COMMITTED shape (the fresh
              // handle is already on disk), so the snapshot read — which sees the OLD record — succeeds.
              if (options.planeThrowsAt === "verify" && served?.members.some((row) => row.executorRef === NEW_HANDLE) === true) throw new Error("the mpdTeams read-back blew up")
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
 * @returns the tool runner and the captain handle it runs as.
 */
function statusHarness(row: CellMemberRecord, options: { agentsRegistry?: boolean; liveSessions?: readonly string[]; team?: TeamRecordFile } = {}): { run: () => Promise<Record<string, unknown>>; captain: FakeAgent } {
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

test("A5: a record re-read failure journals the branch and FENCES the seat", async () => {
  // The record is corrupted INSIDE the spawn, i.e. after the barrier read it and before it writes: the
  // re-read then fails, which used to be one `warn` line and a silent return.
  /** The harness whose record is corrupted mid-run (the hook runs at barrier time, after construction). */
  let harness: Harness
  harness = makeHarness({ duringSpawn: (): void => { writeFileSync(statePath(harness.workspace, CELL_ID), "{ this is not the record", "utf8") } })
  await stopListener(harness)({ agent: harness.member })
  /** The branch's journal row. */
  const row = journalRows(harness).find((entry) => entry.event === "barrier-record-unreadable")
  expect(row).toBeDefined()
  expect(row?.member).toBe(MEMBER_NAME)
  expect(row?.fenced).toBe("written")
  expect(String(row?.retry)).toContain("force: true")
  // THE SEAT IS FENCED WITH THE FORCED LEVER'S WRITTEN LICENCE, not left looking healthy.
  /** The cell's member row. */
  const cell = cellMember(harness)
  expect(cell.fenced).toBe(true)
  expect(cell.mode).toBe("checkpoint")
  expect(cell.barrierFailures).toBeGreaterThanOrEqual(DEFAULT_CELLWORK_CONFIG.compactionRetries)
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
