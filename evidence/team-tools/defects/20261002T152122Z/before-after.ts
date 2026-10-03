// THE RED→GREEN DIFFERENTIAL, measured with the INSTALLED harness's own validators.
//
// It drives the SAME scenario twice: once against the PRE-FIX build that is still committed as
// `packages/mpd-team-core-plugin/dist/index.js` / `packages/mpd-team-watchdog-plugin/dist/index.js`
// (the module the live session actually loaded, T-21), and once against the FIXED `src/`. Every value
// is checked with `isJsonValue` and `validateJsonSchemaValue` imported from the installed dsh
// 0.2.0-rc.2 tree — the authority the live session used — so the "before" column is the real failure
// and the "after" column is the real repair.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** The installed harness, i.e. the validator the live session ran. */
const HARNESS_LIB = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js"
/** The lossless-JSON authority the harness snapshots tool values with. */
const VALUES_LIB = "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-util-values/lib/index.js"
const { validateJsonSchemaValue } = await import(HARNESS_LIB)
const { isJsonValue } = await import(VALUES_LIB)

/** One built or source module pair, as this differential drives them. */
interface Row {
  /** The column label. */
  label: string
  /** The core plugin's row module. */
  core: any
  /** The watchdog plugin's row module. */
  watchdog: any
}

/** The pre-fix build: byte-identical copies of the committed `dist/` the live session loaded
 * (sha256 07d422d238c85fa1e597f53b764dabab98db0021698181d5ad4494a9af3eedec for the core row and
 * 1ae2b3c13505f6d1373be5358bba0725943d230be613ef898b079c35311eaad8 for the watchdog row), snapshotted
 * into `before-dist/` BEFORE this lane rebuilt them, so the red column stays reproducible. */
const before: Row = {
  label: "BEFORE (dist, pre-fix)",
  core: await import("./before-dist/mpd-team-core-plugin.index.js"),
  watchdog: await import("./before-dist/mpd-team-watchdog-plugin.index.js"),
}
/** The fixed source. */
const after: Row = {
  label: "AFTER (src, fixed)",
  core: await import("../../../../packages/mpd-team-core-plugin/src/index.ts"),
  watchdog: await import("../../../../packages/mpd-team-watchdog-plugin/src/index.ts"),
}

/** What one run of the scenario observed, per defect. */
interface Observed {
  /** Defect 1a: the harness's verdict on the status value of a session with NO team. */
  statusEmpty: string
  /** Defect 1b: the harness's verdict on the status value WITH a team record (the Map in `depths`). */
  statusWithTeam: string
  /** Defect 3: the dispatch `halted` sentence under a `{held:false}` HoldView. */
  dispatchUnderFreeHold: string
  /** Defects 4/5: the board rows' owner and blockedBy after a top-level-spelled create_task pair. */
  board: string
  /** Defect 2: the harness's verdict on the watchdog status value. */
  watchdogStatus: string
}

/** A disposer-returning no-op for every seam the scenario never exercises. */
const noop = (): (() => void) => () => {}

/** The stub executor both rows dispatch through. */
const executor = {
  kind: "native",
  reason: "stub",
  providers: () => ["mpd-roster"],
  spawn: async (_caller: unknown, request: { name: string }) => ({ handle: `child-${request.name}` }),
  send: async () => {},
  interrupt: async () => {},
  membership: () => undefined,
  members: () => [],
}

/**
 * Apply one row's plugin against the scenario's stub host.
 * @param mod - the row module.
 * @param workspace - the sandbox workspace.
 * @param watchdog - the `mpdWatchdog` service double, or undefined when none is mounted.
 * @returns the captured tools plus the exec payload.
 */
function host(mod: any, workspace: string, watchdog: unknown): { tools: Map<string, any>; exec: unknown; ctx: any } {
  /** The tools the row registered. */
  const tools = new Map<string, any>()
  /** The stub adapter over the harness double and the scenario's executor. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "registerTool") return (definition: any) => { tools.set(definition.name, definition); return () => {} }
      if (prop === "registerCommand") return () => () => {}
      if (prop === "workspaceRoot") return () => workspace
      if (prop === "workspaceRootsAll") return () => [workspace]
      if (prop === "teamExecutor") return () => executor
      if (prop === "teamListMembers" || prop === "teamListTasks") return () => []
      if (prop === "capabilities") return () => ({})
      if (prop === "teamLiveTeams") return () => []
      if (prop === "settingsReader") return () => ({ get: () => undefined, describe: () => undefined })
      return noop
    },
  })
  /** The services this host answers. */
  const services = new Map<string, unknown>([["mpdDsh", dsh], ["subagents", { startContinuable: undefined }]])
  if (watchdog !== undefined) services.set("mpdWatchdog", watchdog)
  /** The minimal cordis context the row applies against. */
  const ctx = {
    get: (id: string) => services.get(id),
    on: noop,
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: (id: string, value: unknown) => services.set(id, value),
    inject: noop,
    logger: { warn: () => {}, info: () => {} },
    services,
  }
  mod.apply(ctx)
  return { tools, exec: { agent: { session: { id: "sess-1", header: { cwd: workspace } } } }, ctx }
}

/** The watchdog service double: the REAL contract, a HoldView whose `held` is false. */
const freeHold = { isHeld: () => ({ held: false, holdId: null, at: null, reason: null, taskId: null, attemptId: null, workspace: null, source: "none" }), holds: () => [] }

/** Read the board out of the team record the approval wrote. */
function boardOf(workspace: string): string {
  /** The team record directory. */
  const dir = join(workspace, ".mpd", "team", "teams")
  /** The record file names. */
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
  if (names.length === 0) return "(no record)"
  /** The newest record's tasks, projected to the two fields under test. */
  const record = JSON.parse(readFileSync(join(dir, names[names.length - 1]), "utf8"))
  return JSON.stringify(record.tasks.map((task: any) => ({ owner: task.owner ?? null, blockedBy: task.blockedBy ?? [] })))
}

/**
 * Run the whole scenario against one row.
 * @param row - the module pair under test.
 * @returns what the harness said about every defect's value.
 */
async function run(row: Row): Promise<Observed> {
  /** A sandbox workspace for the core half. */
  const coreBox = mkdtempSync(join(tmpdir(), "before-after-core-"))
  /** A sandbox workspace for the watchdog half. */
  const watchBox = mkdtempSync(join(tmpdir(), "before-after-watch-"))
  try {
    /** The core host, with the free HoldView configured. */
    const core = host(row.core, coreBox, freeHold)
    /** One tool call against the core row. */
    const call = async (name: string, args: unknown): Promise<any> => {
      /** The registered tool. */
      const tool = core.tools.get(name)
      if (tool === undefined) throw new Error(`no tool ${name}`)
      return tool.execute(args, core.exec)
    }
    /** The harness's verdict on one value: lossless first, then the declared schema. */
    const verdict = (toolName: string, value: unknown): string => {
      if (!isJsonValue(value)) return "REFUSED: value is not lossless JSON"
      /** The declared output schema of that tool. */
      const schema = core.tools.get(toolName)?.output?.schema
      /** The violations the harness would report. */
      const violations: string[] = validateJsonSchemaValue(schema, value, "value")
      return violations.length === 0 ? "accepted" : `REFUSED: ${violations.join("; ")}`
    }
    // Defect 1a: status with nothing staged and no hold.
    /** The empty status value. */
    const emptyStatus = await call("agent_teams_plan", { action: "status" })
    // Defects 4/5: stage a two-task wave whose owners sit BESIDE `task`, exactly as the live session
    // sent them, then approve and read the board.
    await call("agent_teams_plan", { action: "create", name: "wave", description: "the measured wave" })
    await call("agent_teams_plan", { action: "add_member", member: { name: "TuiAdapter Engineer", description: "Lane A", prompt: "You build." } })
    await call("agent_teams_plan", { action: "create_task", owner: "TuiAdapter Engineer", task: { subject: "W2-T1 Lane A", description: "the adapter" } })
    await call("agent_teams_plan", { action: "create_task", owner: "PanelScene Worker", blocked_by: ["W2-T1 Lane A"], task: { subject: "W2-T3 Lane C", description: "the scene" } })
    await call("agent_teams_plan", { action: "approve" })
    /** The status value read with a real team record behind it (the Map in `depths`). */
    const fullStatus = await call("agent_teams_plan", { action: "status" })
    // Defect 3: a dispatch pass under a FREE HoldView.
    /** The dispatch value. */
    const dispatch = await call("agent_teams_dispatch", { action: "run", dry_run: true })
    // Defect 2: the watchdog's own status value.
    /** The watchdog host, over the same stub seams. */
    const watch = host(row.watchdog, watchBox, freeHold)
    /** The watchdog status tool. */
    const statusTool = watch.tools.get("session-watchdog-status")
    /** The watchdog status value. */
    const watchStatus = statusTool === undefined ? undefined : await statusTool.execute({ team_id: "team-x" }, watch.exec)
    return {
      statusEmpty: verdict("agent_teams_plan", emptyStatus),
      statusWithTeam: verdict("agent_teams_plan", fullStatus),
      dispatchUnderFreeHold: dispatch?.halted === undefined ? "no halt (correct)" : `HALTED: ${dispatch.halted}`,
      board: boardOf(coreBox),
      watchdogStatus: watchStatus === undefined ? "(tool not registered)" : isJsonValue(watchStatus) ? "accepted (lossless)" : "REFUSED: value is not lossless JSON",
    }
  } finally {
    rmSync(coreBox, { recursive: true, force: true })
    rmSync(watchBox, { recursive: true, force: true })
  }
}

/** Both columns, measured in one process. */
const columns: Array<[Row, Observed]> = [
  [before, await run(before)],
  [after, await run(after)],
]
for (const [row, observed] of columns) {
  console.log(`\n===== ${row.label} =====`)
  console.log("defect 1a (plan status, empty session): ", observed.statusEmpty)
  console.log("defect 1b (plan status, team record):  ", observed.statusWithTeam)
  console.log("defect 2  (watchdog status):           ", observed.watchdogStatus)
  console.log("defect 3  (dispatch, free HoldView):   ", observed.dispatchUnderFreeHold)
  console.log("defect 4/5(board tasks after approve): ", observed.board)
}

// ── defect 2, the MECHANISM (stated as a mechanism, never as the live leaf) ─────────────
// The unit replay of the pre-fix dist with the data a sandbox can build is lossless, so the exact
// leaf that broke the live call is NOT reproduced here. What IS shown is the class the fix closes:
// one such value anywhere in the status view is refused by the installed harness, and the boundary
// projection turns exactly that value into an accepted one.
/** A value of the shape a reader can produce and the harness refuses: a Map, `undefined` and -0. */
const poisoned = { teams: [{ heartbeatTails: new Map([["session-a", { count: 1, newest: undefined }]]), at: -0 }] }
console.log("\n===== defect 2 mechanism =====")
console.log("raw value with a Map/undefined/-0:      ", isJsonValue(poisoned) ? "accepted (unexpected)" : "REFUSED: value is not lossless JSON")
/** The FIXED row's projection, applied to the same value. */
const { losslessJson } = await import("../../../../packages/mpd-team-watchdog-plugin/src/lossless.ts")
console.log("after the boundary projection:          ", isJsonValue(losslessJson(poisoned)) ? "accepted (lossless)" : "REFUSED (unexpected)")
