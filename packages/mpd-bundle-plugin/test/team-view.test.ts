// Proves the team GUI contract (docs/plan-webui-tui-i18n.md §3, task-1's frozen acceptance text) is
// what `src/team-view.ts` actually renders: one PLAIN card per member, one rank column per `depth`,
// one DRAWN edge per `blockedBy` entry naming a task on the board, a hover focus chain, a
// click-to-pin detail body quoting the frozen contract, a reported cycle, and the empty-state
// sentence that names the call filling it.
//
// THE SOURCE IS DRIVEN, NOT A COPY OF IT. `team-view.ts` is a FACTORY BODY — one arrow expression
// spliced into `client.js` by `scripts/build-mpd-client.ts` — so it has no `import`/`export` to
// resolve and cannot be evaluated raw. This file strips its types with the SAME tool the build uses
// (`typescript5`'s `transpileModule`, the build's `stripTypeScriptTypes`), then evaluates the result
// as the expression it is. Every arm below therefore reads the real shipped bytes, and the render
// runs on the offline hook runtime rather than a hand-rolled React double.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript5";
import { buildModel, type BoardTask, type GraphModel, type PlanDocument } from "../../mpd-graph-core/src/index.ts"
import { createHookRuntime, type ElementNode, type HookRuntime, type TreeChild, type TreeNode } from "./client-harness.ts";

/** Repository root, three directories above this test file. */
const ROOT = join(import.meta.dirname, "..", "..", "..")
/** The authoritative team-view source, read as text for the structural pins and the evaluation. */
const SOURCE = readFileSync(join(ROOT, "packages", "mpd-bundle-plugin", "src", "team-view.ts"), "utf8")

/** The route the payloads below are canned for. */
const STATE_PATH = "/plugins/mpd-team/state"
/** The staged-plan route; it answers an empty plan unless a case overrides it. */
const PLAN_PATH = "/plugins/mpd-team/plan"
/** The frozen-contract route the detail body quotes from. */
const TASK_PATH = "/plugins/mpd-team/task"

/** The workspace the fixture team was read from. */
const WORKSPACE = "/home/harold/MyProj/DshProj/My-Power-Dsh"
/** The sentence the empty TASKS panel must keep, verbatim — it names the ALLOWED authoring door, never a refused official tool. */
const EMPTY_SENTENCE = "No shared task yet — the captain posts them with agent_teams_plan {action:\"create_task\", blocked_by:[…]}."
/** The Chinese the fixture translator answers with, so every arm can tell a key from its text. */
const ZH = "ZH:"

/** The fixture board: four ranks, one blocker that is NOT on the board, and one repair task. */
const TASKS = [
  { id: "T1", subject: "Freeze the acceptance contract", kind: "requirement", status: "completed", visual: "completed", owner: "web-team-gui", attempt: 1, blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "Build the header and the progress bar", kind: "work", status: "running", visual: "running", owner: "web-team-gui", attempt: 2, blockedBy: ["T1"], failedBy: [], depth: 1 },
  { id: "T3", subject: "Draw the dependency graph edges", kind: "review", status: "open", visual: "blocked", owner: "web-settings-card", attempt: 1, round: 1, verdict: "changes", blockedBy: ["T2", "T9"], failedBy: [], depth: 2 },
  { id: "T4", subject: "Repair the truncated member route", kind: "repair", status: "open", visual: "open", blockedBy: ["T3"], failedBy: [], depth: 3 },
]
/** The two tasks that reference each other, which is how a cycle reaches the panel. */
const CYCLE_TASKS = [
  { id: "T1", subject: "first", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2"], failedBy: [], depth: 0 },
  { id: "T2", subject: "second", kind: "work", status: "open", visual: "blocked", blockedBy: ["T1"], failedBy: [], depth: 1 },
]

/**
 * The SERVED model one board (plus an optional plan) would arrive with: computed by the SHARED CORE.
 *
 * THE WEB VIEW NO LONGER DERIVES ANYTHING (`.mpd/plans/living-graph.md`, Amendment 3): the host
 * computes the model ONCE with `mpd-graph-core` and serves it beside the board. So the harness asks
 * the core what the payload would carry, and every arm below proves the view RENDERS that model
 * instead of inventing a second one. A test-side import is what makes the fixture the SAME
 * implementation the host runs, not a hand-copied expectation.
 * @param tasks - a fixture board, in board order.
 * @param plan - the parsed plan, when the case needs plan-only ghosts or declared edges.
 * @returns the rank per task id, and the model as the wire carries it.
 */
function servedOf(tasks: Array<Record<string, unknown>>, plan?: PlanDocument): { ranks: Record<string, number>; model: GraphModel } {
  /** The board rows the core's merge consumes: the store's own vocabulary, as the host hands it over. */
  const board: BoardTask[] = tasks.map((task) => ({
    id: String(task.id),
    subject: String(task.subject ?? task.id),
    ...(typeof task.kind === "string" ? { kind: task.kind } : {}),
    ...(typeof task.status === "string" ? { status: task.status } : {}),
    ...(typeof task.owner === "string" ? { owner: task.owner } : {}),
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy.map(String) : [],
    depth: Number(task.depth ?? 0),
    ...(typeof task.attempt === "number" ? { attempt: task.attempt } : {}),
    ...(typeof task.visual === "string" ? { visual: task.visual } : {}),
  }))
  /** The core's own answer, which is what the host would serve. */
  const model = buildModel({ board, ...(plan === undefined ? {} : { plan }) })
  /** The rank each id draws in, read off the model's own nodes. */
  const ranks: Record<string, number> = {}
  for (const node of model.nodes) ranks[node.id] = node.depth
  return { ranks, model }
}

/**
 * Stamp one fixture board with the served ranks, and answer the model the payload would carry.
 * @param tasks - a fixture board.
 * @param plan - the parsed plan, when the case needs plan-only ghosts or declared edges.
 * @returns the tasks as the host serves them (each with `rank`), plus the served model.
 */
function withServed(tasks: Array<Record<string, unknown>>, plan?: PlanDocument): { tasks: Array<Record<string, unknown>>; model: GraphModel } {
  /** What the host would serve for this board. */
  const served = servedOf(tasks, plan)
  return { tasks: tasks.map((task) => ({ ...task, rank: served.ranks[String(task.id)] ?? 0 })), model: served.model }
}

/** One canned route answer, in the shape the view's own `readOne` consumes. */
interface CannedRoute {
  /** Whether the answer carries a 2xx status, as `Response.ok` reports it. */
  ok: boolean
  /** The status the answer reports. */
  status: number
  /** The payload `Response.json()` resolves to. */
  body: unknown
}

/** One canned response, as the view's transport reads it: a status flag plus a JSON body resolve. */
interface CannedResponse {
  /** Whether the status is a 2xx. */
  ok: boolean
  /** The canned status code. */
  status: number
  /** Parse the canned body, the way the host's own `Response.json()` does. */
  json: () => Promise<unknown>
}

/**
 * Build a full team payload around one board, overriding the tally the case needs.
 *
 * @param tasks - the board, in board order.
 * @param counts - the tally fields this case overrides.
 * @param cycles - the cycle ids the payload carries.
 * @param plan - the parsed plan, when the case needs plan-only ghosts or declared edges.
 * @param omitModel - true to build the OLDER-SERVER payload: no `model`, no per-task `rank`.
 * @returns the payload the route would serve.
 */
function stateOf(tasks: Array<Record<string, unknown>>, counts: Partial<Record<string, number>> = {}, cycles: string[] = [], plan?: PlanDocument, omitModel: boolean = false): unknown {
  // THE BOARD THE HOST WOULD SERVE: every task carries the rank the shared core computed, and the
  // payload carries the model beside it. The view reads both; nothing here is re-derived. `omitModel`
  // is the pre-wave shape, so the degrade path is exercised by the same harness.
  /** The served form of this fixture board, with the plan's ghosts and edges when a case supplies one. */
  const served = withServed(tasks, plan)
  return {
    ok: true,
    workspace: WORKSPACE,
    team: { id: "team-alpha", name: "Wave GUI", description: "the team GUI wave", phase: "active", approvedAt: "2026-10-05T10:00:00.000Z", links: 0 },
    counts: { total: tasks.length, completed: 1, running: 1, ready: 1, blocked: 1, failed: 0, releasedByFailure: 0, ...counts },
    members: [
      { id: "m1", name: "web-team-gui", role: "Senior Engineer", status: "running", done: 1, total: 2, current: "Build the header", route: "deepseek/deepseek-chat" },
      { id: "m2", name: "web-settings-card", role: "Senior Engineer", status: "idle", done: 0, total: 1 },
    ],
    tasks: omitModel ? tasks : served.tasks,
    ...(omitModel ? {} : { model: served.model }),
    cycles,
    executor: { kind: "native", reason: "ctx.subagents.startContinuable" },
    problems: [],
  }
}

/** The frozen contract the task route serves for one task. */
function contractsOf(): unknown {
  return {
    ok: true,
    workspace: WORKSPACE,
    contracts: [{
      taskId: "T3",
      subject: "Draw the dependency graph edges",
      description: "ACCEPTED WHEN: one drawn edge exists per blockedBy entry.",
      claimedBy: "web-team-gui",
      claimedAt: "2026-10-05T10:05:00.000Z",
      attempt: 1,
      blockedBy: ["T2"],
    }],
    hold: null,
  }
}

/** Flatten an element tree into its text, the way a rendered panel reads. */
function flatText(value: TreeNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return ""
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(flatText).join(" ")
  if (typeof value === "object" && "props" in value) return flatText(value.props?.children)
  return ""
}

/** Depth-first search for the first element matching one predicate. */
function findFirst(node: TreeNode, predicate: (candidate: ElementNode) => boolean): ElementNode | null {
  // ARRAYS ARE WALKED TOO, for the same reason `collect` walks them: a list the view built with `map`
  // stays a list inside its parent's children.
  if (Array.isArray(node)) {
    for (const child of node) {
      /** The first match under this entry, when it holds one. */
      const found = findFirst(child, predicate)
      if (found !== null) return found
    }
    return null
  }
  if (node === null || typeof node !== "object") return null
  if (predicate(node)) return node
  return findFirst(node.props?.children as TreeNode, predicate)
}

/** Flatten the tree into every element carrying one prop, in render order. */
function collect(node: TreeNode, prop: string): ElementNode[] {
  /** The matches found so far, in depth-first order. */
  const found: ElementNode[] = []
  // The walker descends into ARRAYS as well as elements, because `createElement` keeps a nested list a
  // list: the DAG's per-rank `map` hands the grid one array per column, and a walker that only followed
  // elements would report a graph with no nodes in it — the exact false negative this arm exists to
  // prevent in production code.
  if (Array.isArray(node)) {
    for (const child of node) found.push(...collect(child, prop))
    return found
  }
  if (node === null || typeof node !== "object") return found
  if (typeof node.props?.[prop] === "string") found.push(node)
  /** The node's children, one node or a list of them. */
  const children = node.props?.children
  found.push(...collect(children as TreeNode, prop))
  return found
}

/** Every element whose own `key` (hoisted off its props bag by the harness) equals one value. */
function collectByKey(node: TreeNode, key: string): ElementNode[] {
  /** The matches found so far, in depth-first order. */
  const found: ElementNode[] = []
  if (Array.isArray(node)) {
    for (const child of node) found.push(...collectByKey(child, key))
    return found
  }
  if (node === null || typeof node !== "object") return found
  if (node.key === key) found.push(node)
  found.push(...collectByKey(node.props?.children as TreeNode, key))
  return found
}

/** The one element in the tree carrying an exact prop value. */
function one(node: TreeChild, prop: string, value: string): ElementNode {
  /** Every element carrying the prop, so a duplicate is a failure rather than a silent first hit. */
  const found = collect(node, prop).filter((element) => element.props[prop] === value)
  expect(found.length).toBe(1)
  return found[0]
}

/** One inline style value off an element, as a string. */
function styleOf(node: ElementNode, key: string): string {
  /** The element's style bag, which the view always sets. */
  const style = node.props.style as Record<string, unknown> | undefined
  return String(style?.[key] ?? "")
}

/** A canned fetch over a route map, installed as the process global for one case. */
interface RouteStub {
  /** The routes this stub answers, keyed by path without the query string. */
  routes: Record<string, CannedRoute>
  /** Every URL the view asked for, in call order. */
  asked: string[]
}

/**
 * Strip the factory's types and evaluate it as the arrow expression it is.
 *
 * The strip is `typescript5`'s, the same tool class the build's `stripTypeScriptTypes` comes from, so
 * what this evaluates is the source the next `bun scripts/build-mpd-client.ts` splices.
 * @returns the factory function the module evaluates to.
 */
function loadFactory(): (deps: unknown) => { createTeamView: (deps: unknown) => ViewModule } {
  /** The source with every type annotation erased, whitespace preserved by the printer. */
  const stripped = ts.transpileModule(SOURCE, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  /** The evaluated expression, which the build wraps the same way. */
  const value = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as unknown
  expect(typeof value).toBe("function")
  return value as (deps: unknown) => { createTeamView: (deps: unknown) => ViewModule }
}

/** The module a factory call returns. */
interface ViewModule {
  /** The component under test. */
  TeamView: (props?: unknown) => unknown
  /** The pure geometry the panel draws with. */
  layout: (tasks: Array<Record<string, unknown>>, radius?: number, served?: GraphModel) => GraphGeometry
  /** The graph-safe label rule itself (clause C4), exposed so the drawing's one composer is provable. */
  graphSafeLabel: (subject: string, ordinal: number) => string
  /** The curve builder itself, exposed so its `radius = 0` control can be driven directly (clause W6). */
  curveOf: (waypoints: Array<{ x: number; y: number }>, radius: number) => { d: string; points: Array<{ x: number; y: number }> }
  /**
   * The pure overlap audit, exposed so a deliberately overlapping pair can be FED to it.
   * @param edges - the routed edges to audit.
   * @returns every collinear overlap between two different edges' runs.
   */
  overlapAudit: (edges: GraphGeometry["edges"]) => Array<{ a: string; b: string; orientation: "horizontal" | "vertical"; at: number; overlap: number }>
  /** The elapsed formatter D2 exposes additively, so the duration grammar is provable here. */
  formatElapsed: (task: { startedAt?: string; finishedAt?: string; visual: string }, nowMs?: number) => string
}

/** The geometry `layout` returns, as this file reads it. */
interface GraphGeometry {
  /** One column per rank, in rank order. */
  columns: Array<Array<{ id: string }>>
  /** How many columns the grid draws. */
  rankCount: number
  /** The grid's own width. */
  width: number
  /** The grid's own height. */
  height: number
  /** The column-major grid template. */
  gridTemplateColumns: string
  /** Every node's box, in column-major order. */
  nodes: Array<{ task: { id: string; visual?: string; planned?: boolean }; rank: number; row: number; ordinal: number; top: number }>
  /** One ROUTED edge per drawable dependency, which is what the render paints and the arms assert. */
  edges: Array<{
    parent: string
    child: string
    witness: string
    segments: Array<{ key: string; rect: Rect }>
    /** The painted form: the SVG `d`, its flattened polyline, the arrival POINT and the radius used. */
    curve: { d: string; points: Array<{ x: number; y: number }>; tip: { x: number; y: number }; radius: number }
    marker: Rect
    pointsLeft: boolean
  }>
  /** The inset every box keeps inside its column, widened by the lane count it must pay for. */
  inset: number
  /** The measured gutter between two neighbouring columns' boxes. */
  gutter: number
  /** How many vertical runs the busiest gutter carries. */
  maxLanes: number
  /** How many lanes could not be given a distinct column. */
  laneOverflow: number
  /** How many boxes each rank's column holds; a long edge no longer reserves a row in it. */
  slots: number[]
  /** The y every column's stack is centred on, which is the canvas's own horizontal midline. */
  centerY: number
  /** Every collinear overlap between two DIFFERENT edges' runs; empty is the promise. */
  overlaps: Array<{ a: string; b: string; orientation: "horizontal" | "vertical"; at: number; overlap: number }>
  /** Whether the ranks were DERIVED from the `blockedBy` graph (R20), or taken off the served depth. */
  ranksDerived: boolean
  /** The blocker references no task on the board carries, sorted. */
  unresolved: string[]
  /** The subset of `unresolved` that the RECORD ITSELF reports; empty when the payload carries none. */
  unresolvedRecorded: string[]
}

/** Everything one rendered case needs: the tree, the runtime and the restored globals. */
interface Rendered {
  /** The rendered tree, after the poll settled. */
  tree: ElementNode
  /** The component under test, which a follow-up `act` re-renders. */
  component: Function
  /** The hook runtime this case rendered in, for an `act` re-render. */
  hooks: HookRuntime
  /** The factory's module, for the pure `layout` assertions. */
  view: ViewModule
  /** The routes the view asked for, in call order. */
  asked: string[]
}

/**
 * Render the view against canned routes, with the real hook runtime.
 *
 * `globalThis.fetch` is replaced for the case and restored afterwards, the way the bundle harness
 * does it, so a later case can never run against this one's canned answers.
 * @param options - the route overrides, the props and the translator to render with.
 * @returns the settled tree and the handles a follow-up interaction needs.
 */
async function renderView(options: { routes?: Record<string, CannedRoute>; props?: Record<string, unknown>; t?: (key: string) => string; taskPath?: boolean; state?: unknown } = {}): Promise<Rendered> {
  /** The routes this case answers: the three the view reads, plus any override. */
  /** The routes this case answers, keyed by path: the three the view reads, plus any override. */
  const routes: Record<string, CannedRoute> = {
    [STATE_PATH]: { ok: true, status: 200, body: options.state ?? stateOf(TASKS) },
    [PLAN_PATH]: { ok: true, status: 200, body: { ok: true, workspace: WORKSPACE, plan: null } },
    [TASK_PATH]: { ok: true, status: 200, body: contractsOf() },
    ...options.routes,
  }
  /** Every URL the view asked for, in call order. */
  const asked: string[] = []
  /** The process fetch this case replaces, kept for the restore in the `finally`. */
  const saved = globalThis.fetch
  globalThis.fetch = (async (url: unknown): Promise<CannedResponse> => {
    /** The requested URL, query string included, so an arm can prove the session travelled. */
    const full = String(url)
    asked.push(full)
    /** The path half of the URL. */
    const path = full.split("?")[0]
    /** The canned answer for that path, or a 404 the view renders as unreadable. */
    const answer = routes[path]
    if (answer === undefined) return { ok: false, status: 404, json: async () => null }
    return { ok: answer.ok, status: answer.status, json: async () => answer.body }
  }) as unknown as typeof fetch
  try {
    /** The hooks surface this case renders in. */
    const hooks = createHookRuntime()
    /** The factory module, in its own scope, as the build's IIFE gives it one. */
    const view = loadFactory()({}).createTeamView({
      react: hooks.react,
      statePath: STATE_PATH,
      planPath: PLAN_PATH,
      taskPath: options.taskPath === false ? undefined : TASK_PATH,
      pollMs: 60_000,
      t: options.t,
    })
    /** The component under test, kept so an `act` re-render drives the SAME component. */
    const component = view.TeamView as Function
    /** The tree the poll settled into. */
    const tree = await hooks.render(component, (options.props ?? { sessionId: "s1" }) as never)
    return { tree, component, hooks, view, asked }
  } finally {
    globalThis.fetch = saved
  }
}

/** The answer a route returns when the payload never arrived, so the panel renders its reason. */
const UNAVAILABLE: CannedRoute = { ok: false, status: 503, body: null }

describe("team-view factory shape", () => {
  test("stays a single factory body: one arrow expression, no import/export, no JSX, no MEASUREMENT", () => {
    expect(SOURCE.startsWith("// mpd bundle web client")).toBe(true)
    expect(SOURCE.trimEnd().endsWith("}")).toBe(true)
    // THE BUILD'S OWN BOUNDARY RULE, read off the SOURCE: the factory opener is the ONE line at COLUMN
    // ZERO that ends in `=> {` — every other arrow in this file is indented inside the factory. Counting
    // all such lines instead would measure the render callbacks, which is why this pins the column.
    const openers = SOURCE.split("\n").filter((line) => !line.startsWith(" ") && line.trimEnd().endsWith("=> {"))
    expect(openers.length).toBe(1)
    expect(openers[0].startsWith("(require: ")).toBe(true)
    // A module would break the splice; JSX has no transform here. The plane itself is now an SVG (clause
    // W1), so the pin is NOT "no SVG" any more — the prohibition that SURVIVES the wave's contract
    // amendment is MEASUREMENT (clause W2): the route is computed in the pure layout, so no DOM read, no
    // box measurement and no layout-scheduled work may appear anywhere in this file.
    expect(/^\s*(import|export)\b/m.test(SOURCE)).toBe(false)
    expect(SOURCE).not.toContain("getBoundingClientRect")
    expect(SOURCE).not.toContain("requestAnimationFrame")
    expect(SOURCE).not.toContain("ResizeObserver")
    expect(SOURCE).not.toContain("getComputedStyle")
    expect(SOURCE).not.toContain("offsetWidth")
    // AND THE POSITIVE HALF, because a pin that can only go green on absence is not evidence: the drawn
    // plane is really an SVG, and the pure builder that shapes it is really there.
    expect(SOURCE).toContain('createElement("svg"')
    expect(SOURCE).toContain("const curveOf = (waypoints: CurvePoint[], radius: number)")
  })

  test("the layout and the painted edge carry no DOM access at all", () => {
    // W2's own shape: the ROUTE (the `layout` function) and the PAINT composed from it reach the screen
    // through nothing but arithmetic. `sessionIdFromPane` is excluded on purpose — it reads the host's
    // own sidebar marker, which is session identity, never geometry — so this arm slices the two regions
    // the clause is about rather than scanning the file and calling a documented read a violation.
    /** The layout's own body, from its declaration to the curve builder that follows it. */
    const layoutBody = SOURCE.slice(SOURCE.indexOf("const layout = (tasks: TeamTask[]"), SOURCE.indexOf("const focusChain = (tasks: TeamTask[]"))
    /** The paint, from `edgeOf` to the detail body that follows it. */
    const paintBody = SOURCE.slice(SOURCE.indexOf("const edgeOf = (edge: DrawnEdge"), SOURCE.indexOf("const rectText = (rect: EdgeRect)"))
    expect(layoutBody.length).toBeGreaterThan(1000)
    expect(paintBody.length).toBeGreaterThan(500)
    for (const region of [layoutBody, paintBody]) {
      expect(region).not.toContain("document.")
      expect(region).not.toContain("getBoundingClientRect")
      expect(region).not.toContain("offsetWidth")
      expect(region).not.toContain("getComputedStyle")
      expect(region).not.toContain("querySelector")
    }
  })

  test("takes an OPTIONAL translator and a task route, and exposes the pure layout and its builders", () => {
    // THE EVENTS ROUTE TRAVELS ON THE SIGNATURE TOO (lane W), and OPTIONALLY: a composition with no
    // change stream keeps the poll as its whole story, and the engine that consumes it is `start`.
    expect(SOURCE).toContain("planPath?: string; taskPath?: string; eventsPath?: string; pollMs?: number; t?: Translator")
    // THE W6 CONTROL TRAVELS ON THE SIGNATURE: `radius` is optional, so every existing caller keeps the
    // shipped 6px while a test can drive the same pure layout with `0` and get the orthogonal path back.
    // THE THIRD ARGUMENT IS AMENDMENT 3's (2026-10-19): the host's merge report. It is optional so a
    // payload from an older server still lays out (from the served `depth`), and REQUIRED to be absent
    // when no model arrived so `ranksDerived`/`unresolved` degrade coherently with it.
    expect(SOURCE).toContain("layout: (tasks: TeamTask[], radius?: number, served?: ServedGraphModel) => GraphGeometry")
    expect(SOURCE).toContain("graphSafeLabel: (subject: string, ordinal: number) => string")
    expect(SOURCE).toContain("curveOf: (waypoints: CurvePoint[], radius: number)")
  })
})

describe("team-view DAG geometry", () => {
  test("one column per SERVED rank, one node box per task, in rank order", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // THE RANKS ARE THE HOST'S (Amendment 3): this fixture's served depths happen to agree with the
    // shared core's derivation, so stamping them changes no column — which is exactly the arm's point:
    // the geometry follows the served rank, and this board's ranks are 0..3 either way.
    /** The four-task board exactly as the host would serve it. */
    const served = withServed(TASKS)
    /** The geometry of the four-task fixture board. */
    const graph = view.layout(served.tasks, undefined, served.model)
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([["T1"], ["T2"], ["T3"], ["T4"]])
    expect(graph.rankCount).toBe(4)
    expect(graph.width).toBe(4 * 168)
    expect(graph.gridTemplateColumns).toBe("repeat(4, 168px)")
    expect(graph.nodes.map((node) => [node.task.id, node.rank, node.row, node.top])).toEqual([
      ["T1", 0, 0, 4], ["T2", 1, 0, 4], ["T3", 2, 0, 4], ["T4", 3, 0, 4],
    ])
  })

  test("the DEGRADE (no served model): a negative or missing depth falls back to the first column", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // NO TASK CARRIES A SERVED RANK AND NO REPORT ARRIVES: this is the OLDER-SERVER payload, and the
    // one documented degrade of Amendment 3. The columns come from `depth` and nothing is re-derived.
    /** A board whose second task carries an impossible rank. */
    const graph = view.layout([{ id: "A", depth: 0 }, { id: "B", depth: -3 }, { id: "C", depth: 2 }])
    // B lands in rank 0, so rank 2 still exists: the columns are contiguous, and the empty one between
    // them is the rank NO task occupies — kept, because it is the vertical channel an edge's riser
    // would otherwise cross a node in.
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([["A", "B"], [], ["C"]])
    expect(graph.nodes.map((node) => [node.task.id, node.rank])).toEqual([["A", 0], ["B", 0], ["C", 2]])
  })

  test("R19: within a column the task order is NUMERIC, so t2 precedes t10 and t20 follows t2", () => {
    // THE BOARD IS HANDED IN DELIBERATELY SCRAMBLED, and the ids are chosen to break a LEXICAL sort:
    // character-wise `T10` and `T20` both precede `T2`, which is exactly the order this arm exists to
    // catch. MEASURED before the fix: the column drew `T10, T2, T1, T3, T20`.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** Five tasks of one rank, served in an order no reader would draw. */
    const scrambled = [
      { id: "T10", depth: 0 }, { id: "T2", depth: 0 }, { id: "T1", depth: 0 }, { id: "T3", depth: 0 }, { id: "T20", depth: 0 },
    ]
    /** The geometry of that board. */
    const graph = view.layout(scrambled)
    expect(graph.columns[0].map((task) => task.id)).toEqual(["T1", "T2", "T3", "T10", "T20"])
    // AND THE NODES ARE PLACED IN THAT ORDER: the rows are what the render stacks, so a sorted column
    // that the boxes ignored would be a fix in name only.
    expect(graph.nodes.map((node) => [node.task.id, node.row])).toEqual([["T1", 0], ["T2", 1], ["T3", 2], ["T10", 3], ["T20", 4]])
  })
})

describe("team-view panels", () => {
  test("header, progress bar and one PLAIN card per member with route, current task and fraction", async () => {
    /** The settled render of the fixture payload. */
    const { tree } = await renderView()
    expect(flatText(tree)).toContain("Wave GUI")
    expect(flatText(tree)).toContain("active")
    expect(flatText(tree)).toContain("approved 2026-10-05T10:00:00.000Z")
    expect(flatText(tree)).toContain("workspace My-Power-Dsh")
    // 1 of 4 complete is the reference's own figure, and the bar is drawn at that width.
    expect(flatText(tree)).toContain("1/4 complete")
    expect(flatText(tree)).toContain("Progress 25%")
    expect(styleOf(one(tree, "data-progress", "25"), "width")).toBe("25%")
    // One card per member, and no member card is anything but a PLAIN div: no <img>, no avatar.
    expect(collect(tree, "data-member").map((card) => card.props["data-member"])).toEqual(["m1", "m2"])
    /** The first member's card, which the arm below reads field by field. */
    const card = one(tree, "data-member", "m1")
    expect(card.type).toBe("div")
    expect(flatText(card)).toContain("web-team-gui")
    expect(flatText(card)).toContain("Senior Engineer")
    expect(flatText(card)).toContain("deepseek/deepseek-chat")
    // The current task is labelled and carries the whole string in its own `title`, so a truncated
    // line is still readable on hover rather than silently lossy.
    expect(flatText(card)).toContain("current Build the header")
    expect(String((findFirst(card, (candidate) => candidate.props.title === "Build the header") as ElementNode).props.title)).toBe("Build the header")
    expect(flatText(card)).toContain("1/2")
    expect(findFirst(tree, (node) => node.type === "img")).toBeNull()
  })

  test("truncates a long current task in the card, and keeps the whole string on its title", async () => {
    /** A member whose current task is far longer than the card can hold. */
    const LONG = "Build the header and the progress bar that the reference shows its reader"
    // The card is `short(current, 30)`, so the line is clipped to 29 characters plus an ellipsis while
    // the title carries the original — the label is the truncated form, the trace is the full one.
    /** The settled render of a member carrying that long task. */
    const rendered = await renderView({
      state: {
        ok: true,
        workspace: WORKSPACE,
        team: { id: "team-alpha", name: "Wave GUI", description: "d", phase: "active", links: 0 },
        counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
        members: [{ id: "m1", name: "web-team-gui", status: "running", done: 0, total: 1, current: LONG }],
        tasks: [],
        cycles: [],
        executor: { kind: "native", reason: "x" },
        problems: [],
      },
    })
    /** The one member card. */
    const card = one(rendered.tree, "data-member", "m1")
    expect(flatText(card)).toContain("current " + LONG.slice(0, 29) + "…")
    expect(flatText(card)).not.toContain(LONG)
    expect((findFirst(card, (candidate) => candidate.props.title === LONG) as ElementNode).props.title).toBe(LONG)
  })

  test("renders the empty-state sentence that names the call filling it", async () => {
    /** The settled render of a board with no tasks at all. */
    const empty = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf([], { total: 0, completed: 0, running: 0, ready: 0, blocked: 0 }) } } })
    expect(flatText(empty.tree)).toContain("TASKS (0)")
    expect(flatText(empty.tree)).toContain(EMPTY_SENTENCE)
    // With nothing to draw there is no DAG canvas, and no edge layer to be empty in.
    expect(collect(empty.tree, "data-mpd-graph").length).toBe(0)
  })

  test("a session with no team renders the WORKSPACE's teams, not the dead empty state (D2)", async () => {
    // THE USER-REPORTED STATE, as a render contract: a session that approved nothing of its own used
    // to get one sentence claiming the workspace was empty, while the workspace held teams another
    // session had built. The listing is what the panel shows instead.
    /** The workspace's teams, in the shape the route serves them. */
    const teams = [
      { id: "team-20261002150828", name: "mpd-seam-wave1", description: "seam audit", phase: "active", tasks: { total: 6, completed: 6, failed: 0 }, members: 4, active: false },
      { id: "team-20261005072738", name: "mpd-tui-dep-view", description: "arrows and legend", phase: "idle", tasks: { total: 5, completed: 3, failed: 1 }, members: 3, active: false },
    ]
    /** The settled render of a session with no team of its own, one of them BOUND to this session. */
    const rendered = await renderView({
      state: {
        ok: true,
        workspace: WORKSPACE,
        workspaceTeams: { records: [{ ...teams[0], active: true }, teams[1]], activeId: "team-20261002150828" },
        team: null,
        counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
        members: [],
        tasks: [],
        cycles: [],
        executor: { kind: "native", reason: "x" },
        problems: [],
      },
    })
    // The root still carries the tab marker, and it now also states how many teams it listed — the
    // marker a driver can assert on without parsing the panel's words.
    expect(rendered.tree.props["data-mpd-team-tab"]).toBe("")
    expect(rendered.tree.props["data-mpd-workspace-teams"]).toBe("2")
    // ONE ROW PER TEAM, by id: this is what proves the listing was rendered rather than summarised.
    expect(collect(rendered.tree, "data-mpd-workspace-team").map((row) => row.props["data-mpd-workspace-team"]))
      .toEqual(["team-20261002150828", "team-20261005072738"])
    /** The panel's whole text. */
    const text = flatText(rendered.tree)
    expect(text).toContain("mpd-seam-wave1")
    expect(text).toContain("mpd-tui-dep-view")
    expect(text).toContain("team-20261005072738")
    expect(text).toContain("6/6")
    expect(text).toContain("3/5")
    // THE DEAD END IS GONE: the sentence that claimed the workspace was empty must not render beside
    // a listing that proves otherwise.
    expect(text).not.toContain("No team in this workspace yet")
    // The phase is the record's own word, and the panel still says how to get a team of its own.
    expect(text).toContain("active")
    expect(text).toContain("Stage one with agent_teams_plan")
    // THE ACTIVE MARKER: the row the index binds to this session is marked, and the OTHER one is not —
    // so a captain can tell which team its own approvals would drive.
    expect(collect(rendered.tree, "data-mpd-workspace-active").map((row) => row.props["data-mpd-workspace-active"]))
      .toEqual(["team-20261002150828"])
  })

  test("the listing renders in Chinese through the SAME keys, so the two tables cannot drift", async () => {
    // The host dictionary is the Chinese half (`mpdTeamSidebar` in web-client.ts); this arm drives the
    // view with a translator that prefixes the key, which is how every other localization arm here
    // proves a string was routed THROUGH the table rather than hard-coded.
    /** The settled render of a session with no team, translated. */
    const rendered = await renderView({
      t: (key: string) => ZH + key,
      state: {
        ok: true,
        workspace: WORKSPACE,
        workspaceTeams: { records: [{ id: "team-x", name: "波次", description: "d", phase: "ended", tasks: { total: 2, completed: 2, failed: 0 }, members: 1, active: true }], activeId: "team-x" },
        team: null,
        counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
        members: [],
        tasks: [],
        cycles: [],
        executor: { kind: "native", reason: "x" },
        problems: [],
      },
    })
    /** The panel's translated text. */
    const text = flatText(rendered.tree)
    for (const key of ["workspace.title", "workspace.hint", "workspace.active", "workspace.members", "workspace.stage", "phase.ended"]) {
      expect(text).toContain(ZH + key)
    }
  })

  test("a workspace with genuinely NO teams keeps the honest empty state", async () => {
    // The other direction, so the fix cannot over-reach: with an empty listing the sentence is still
    // the answer, and no workspace section is drawn around it.
    /** The settled render of a workspace that never held a team. */
    const rendered = await renderView({
      state: {
        ok: true,
        workspace: WORKSPACE,
        workspaceTeams: { records: [] },
        team: null,
        counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
        members: [],
        tasks: [],
        cycles: [],
        executor: { kind: "native", reason: "x" },
        problems: [],
      },
    })
    expect(flatText(rendered.tree)).toContain("No team in this workspace yet")
    expect(collect(rendered.tree, "data-mpd-workspace-team").length).toBe(0)
    expect(rendered.tree.props["data-mpd-workspace-teams"]).toBeUndefined()
  })

  test("says so when a team raised no member at all", async () => {
    // A team can exist with an empty roster (the pre-dispatch window), and an empty MEMBERS list would
    // otherwise be a heading with nothing under it.
    /** The settled render of a team with no members. */
    const empty = await renderView({
      state: {
        ok: true,
        workspace: WORKSPACE,
        team: { id: "team-alpha", name: "Wave GUI", description: "d", phase: "staged", links: 0 },
        counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 },
        members: [],
        tasks: [],
        cycles: [],
        executor: { kind: "native", reason: "x" },
        problems: [],
      },
    })
    expect(flatText(empty.tree)).toContain("No member was raised for this team.")
  })

  test("reports a cycle instead of hiding it", async () => {
    /** The settled render of the two-task cycle. */
    const { tree } = await renderView({
      routes: {
        [STATE_PATH]: { ok: true, status: 200, body: stateOf(CYCLE_TASKS, { total: 2, completed: 0, running: 0, ready: 0, blocked: 2 }, ["T1", "T2"]) },
      },
    })
    expect(flatText(tree)).toContain("CYCLE T1, T2")
  })

  test("renders the reason instead of an empty box when the route is unreadable", async () => {
    /** The settled render of a failing state route. */
    const { tree } = await renderView({ routes: { [STATE_PATH]: UNAVAILABLE } })
    expect(flatText(tree)).toContain("No team state is being served. The mpd team row may not be mounted in this profile.")
  })
})

describe("team-view drawn edges", () => {
  test("draws one SVG path per blockedBy entry, and the painted `d` IS the layout's own", async () => {
    /** The settled render of the fixture board, plus the pure module it rendered from. */
    const { tree, view } = await renderView()
    /** The edge layer, which every drawn edge lives in. */
    const layer = one(tree, "data-edges", "1")
    /** The edges themselves, one per drawable `blockedBy` entry. */
    const edges = collect(layer, "data-mpd-edge")
    // T2←T1, T3←T2, T4←T3 are drawn; T3's `T9` entry names a task the board does not carry, so it
    // draws nothing rather than an edge into nowhere.
    expect(edges.map((edge) => edge.props["data-mpd-edge"])).toEqual(["T2<-T1", "T3<-T2", "T4<-T3"])
    // THE WITNESSABLE COUNTS AGREE WITH THE DRAWING: the host asserts `edges=` against the number of
    // `data-mpd-edge` marks, so a payload id that draws nothing must not be counted.
    expect(one(tree, "data-mpd-graph", "ranks=4 edges=3").props["data-mpd-graph"]).toBe("ranks=4 edges=3")
    expect(collect(tree, "data-mpd-edge").length).toBe(3)
    expect(collect(tree, "data-mpd-node").map((node) => node.props["data-mpd-node"])).toEqual(["T1", "T2", "T3", "T4"])
    // ONE `<path>` PER DRAWN EDGE (clause W1): the layer is a single painting plane, so a rectangle per
    // run is gone for good — `data-mpd-curve` appears exactly once per edge, and the arrowhead is a
    // polygon that KEEPS its `data-mpd-head` name (clause W4: no published mark is removed) beside the
    // zero-width tip rect.
    expect(collect(layer, "data-mpd-curve").length).toBe(3)
    expect(collect(layer, "data-mpd-tip").length).toBe(3)
    expect(collect(layer, "data-mpd-head").length).toBe(3)
    /** The T1→T2 edge, located by its own key; its children are the curve and the arrowhead. */
    const edge = collectByKey(layer, "edge:T1>T2")
    expect(edge.length).toBe(1)
    /** The edge's two painted children, in draw order. */
    const painted = edge[0].props.children as ElementNode[]
    expect(painted.map((child) => child.key)).toEqual(["curve", "head"])
    expect(painted[0].type).toBe("path")
    expect(painted[1].type).toBe("polygon")
    // THE PAINTED `d` IS THE LAYOUT'S OWN, character for character: the string the browser draws and the
    // string the containment arm flattens come out of the SAME pure call, so the picture cannot be a
    // different curve than the one that was proven (clause W2 read as a fact rather than a promise).
    /** The geometry of this board, which the relations below are read off. */
    const graph = view.layout(TASKS)
    /** The geometry's own T1→T2 edge. */
    const drawn = graph.edges.find((candidate) => candidate.witness === "T2<-T1")
    expect(drawn).toBeDefined()
    /** The curve that pure layout published for it. */
    const curve = (drawn as { curve: { d: string; points: Array<{ x: number; y: number }>; tip: { x: number; y: number }; radius: number } }).curve
    expect(painted[0].props["data-mpd-curve"]).toBe(curve.d)
    expect(painted[0].props.d).toBe(curve.d)
    // The TIP travels as its own ZERO-WIDTH rect, so the host reads the arrival without knowing MARK_W.
    expect(painted[1].props["data-mpd-tip"]).toBe(curve.tip.x + "," + (curve.tip.y - 4) + ",0,8")
    // THE ROUTE STAYS THE ROUTE (clause W4): the layout's own runs keep their names and their order.
    expect((drawn as { segments: Array<{ key: string }> }).segments.map((segment) => segment.key)).toEqual(["out", "riser", "in"])
    // MERMAID-STYLE ROUTING, so the numbers are the boxes' own borders rather than a fixed inset.
    // THE PROPERTY, NOT THE PIXELS. Pinning the four literals would re-couple this arm to the sizes it
    // is supposed to be independent of — the reviewer's point that a scale change must not detach the
    // edges. What has to hold is the RELATION, read off the same accessors the layout renders the boxes
    // with: a node sits `inset` inside a `column`-wide column, the lane stands in the gutter between two
    // columns, and a forward edge leaves the blocker's RIGHT border for the dependant's LEFT one. The
    // INSET IS READ OFF THE GEOMETRY rather than restated: it is DERIVED (the lane count widens it) and
    // a literal here would need editing on every gutter tune — the drift this arm exists to catch.
    /** The four sizes the layout derives every position from; the inset is the geometry's own. */
    const DIMS = { column: 168, inset: graph.inset, nodeHeight: 42, nodeGap: 10, pad: 4 }
    /** One node's borders, derived from the sizes rather than written down. */
    const borders = (rank: number): { left: number; right: number } =>
      ({ left: rank * DIMS.column + DIMS.inset, right: rank * DIMS.column + DIMS.column - DIMS.inset })
    /** The vertical middle of the one row this fixture puts both nodes on. */
    const middle = DIMS.pad + DIMS.nodeHeight / 2
    // THE TWO BOXES THE EDGE ATTACHES TO, read off the layout's own centred placement. The middle
    // above is the PARENT's port exactly, because T1 has one incident edge; the dependant T2 carries
    // two (in from T1, out to T3), so its ports spread about the middle (D1's anti-overlap device).
    /** The parent's box, whose single incident edge attaches at its middle. */
    const parentBox = graph.nodes.find((node) => node.task.id === "T1") as { top: number }
    /** The dependant's box, whose two incident edges spread its ports. */
    const childBox = graph.nodes.find((node) => node.task.id === "T2") as { top: number }
    // The route's own runs are still published, which is what keeps `data-mpd-route` the routing truth:
    // the lead-out STARTS on the parent's right border and the lead-in ENDS on the child's first pixel.
    /** The edge's route as published: its runs, then `R`/`L` and the arrowhead's own box. */
    const [route, marker] = String(edge[0].props["data-mpd-route"]).split("|")
    /** Those runs, in draw order. */
    const runs = route.split(";").map(parseRect)
    expect(runs[0].left).toBe(borders(0).right)
    expect(runs[runs.length - 1].left + runs[runs.length - 1].width).toBe(borders(1).left + 1)
    // PORTS, NOT ONE SHARED MIDDLE (D1). The lead-out leaves the blocker's own port — its middle here,
    // because T1 has ONE incident edge — and the lead-in arrives at the dependant's port, which is
    // offset because T2 has two. What the route must keep is that BOTH attachments live inside their
    // box's own height and land where the painted curve starts and stops.
    expect(runs[0].top).toBe(parentBox.top + DIMS.nodeHeight / 2)
    expect(runs[0].top).toBe(curve.points[0].y)
    expect(runs[runs.length - 1].top).toBe(curve.points[curve.points.length - 1].y)
    for (const attachment of [curve.points[0].y, curve.points[curve.points.length - 1].y]) {
      expect(attachment).toBeGreaterThan(0)
      expect(attachment).toBeLessThan(DIMS.pad + DIMS.nodeHeight)
    }
    expect(middle).toBe(parentBox.top + DIMS.nodeHeight / 2)
    expect(curve.points[curve.points.length - 1].y).toBeGreaterThan(childBox.top)
    expect(curve.points[curve.points.length - 1].y).toBeLessThan(childBox.top + DIMS.nodeHeight)
    // The route `data-mpd-route` publishes is the layout's own, run for run and pixel for pixel.
    expect(route.split(";")).toEqual((drawn as { segments: Array<{ rect: Rect }> }).segments.map((segment) => rectTextOf(segment.rect)))
    // THE CURVE TRAVELS THE SAME TWO ATTACHMENTS: it leaves the blocker's border at its port (the
    // middle, T1 having one edge) and lands on the dependant's port — above the middle, T2 having two.
    // That is what makes the painted form a parametrisation of the route, not a redraw.
    expect(curve.points[0]).toEqual({ x: borders(0).right, y: middle })
    expect(curve.points[curve.points.length - 1].x).toBe(borders(1).left)
    expect(curve.points[curve.points.length - 1].y).toBeGreaterThan(childBox.top)
    expect(curve.points[curve.points.length - 1].y).toBeLessThan(childBox.top + DIMS.nodeHeight)
    expect(curve.points[curve.points.length - 1]).toEqual({ x: curve.tip.x, y: curve.tip.y })
    // The arrowhead points RIGHT (the edge arrives from the left) and its tip is the child's border.
    expect(marker.startsWith("R")).toBe(true)
    /** The arrowhead's box, which `data-mpd-route` still carries. */
    const head = parseRect(marker.slice(1))
    expect(head.left + head.width).toBe(borders(1).left)
    expect(head.height).toBe(8)
  })

  test("draws a riser that spans the two rows when a blocker sits below its dependant", async () => {
    /** A board whose second task depends on a task two rows further down its column. */
    const board = [
      { id: "T1", subject: "a", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "b", kind: "work", status: "open", visual: "blocked", blockedBy: ["T3"], failedBy: [], depth: 0 },
      { id: "T3", subject: "c", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 1 },
    ]
    /** The settled render of that board, plus the pure module behind it. */
    const { tree, view } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** The single drawn edge, as the DOM carries it. */
    const edge = one(one(tree, "data-edges", "1"), "data-mpd-edge", "T2<-T3")
    // THE RISER IS READ OFF THE LAYOUT, which is where it has always been computed: the painted curve
    // only rounds it. `segments` keeps its names and its rectangles (clause W4), so this arm keeps the
    // route's own numbers and only changes the accessor.
    //
    // THE ROWS MOVED (D1), and the arm follows the geometry rather than a literal: each column's stack
    // is now CENTRED on the graph's midline, so rank 1's single node no longer sits at the top of its
    // column and its box middle is no longer `4 + 52 + 21`. The PROPERTY is unchanged — the riser spans
    // exactly the two boxes' attachment ys — so those two ys are read off the route's own ends.
    // THE PURE CALL GETS THE SAME BOARD THE HOST SERVED, ranks included: the render above received
    // `stateOf(board)`, whose tasks carry the core's ranks (T2 rank 1, T3 rank 0), so a bare fallback
    // here would lay out a DIFFERENT board than the one that was painted.
    /** The board exactly as the host served it. */
    const served = withServed(board)
    /** The geometry's own T2←T3 edge: its route runs AND the curve painted over them. */
    const drawn = view.layout(served.tasks, undefined, served.model).edges.find((candidate) => candidate.witness === "T2<-T3") as {
      segments: Array<{ key: string; rect: Rect }>
      curve: { points: Array<{ x: number; y: number }> }
    }
    /** Its riser, the run that has to span the rows. */
    const riser = drawn.segments.filter((segment) => segment.key === "riser")[0].rect
    // THE TWO ATTACHMENTS, off the route's own ends: the blocker's port and the dependant's port.
    /** Where the painted route leaves the blocker. */
    const leaveY = drawn.curve.points[0].y
    /** Where it arrives at the dependant. */
    const arriveY = drawn.curve.points[drawn.curve.points.length - 1].y
    // THE RISER SPANS THOSE TWO ROWS EXACTLY — the arm's whole subject, now independent of where the
    // centring put them. A zero-height riser would mean the two rows collapsed; a shorter one would
    // mean the line stopped short of a box.
    expect(riser.top).toBe(Math.min(leaveY, arriveY))
    expect(riser.height).toBe(Math.abs(arriveY - leaveY))
    expect(Math.abs(arriveY - leaveY)).toBeGreaterThan(0)
    // AND THE PAINTED CURVE SPANS THE SAME ROWS: the sweep bends the leg, it does not shorten it.
    const ys = drawn.curve.points.map((point) => point.y)
    expect(Math.min(...ys)).toBe(Math.min(leaveY, arriveY))
    expect(Math.max(...ys)).toBe(Math.max(leaveY, arriveY))
    // The DOM's own path is that geometry's, which the main edge arm proves character for character.
    expect(String(collect(edge, "data-mpd-curve")[0].props["data-mpd-curve"]).startsWith("M ")).toBe(true)
  })

  test("a cycle's back-edge keeps a non-negative width and a finite curve instead of drawing NaN", async () => {
    // The store resolves a revisited node to rank 0, so a back-edge can point RIGHT TO LEFT: its riser
    // then sits at a negative offset, and a width taken from the difference alone would go negative.
    // The trap is that a negative width is not a crash — it is an edge that silently vanishes — so the
    // geometry has to clamp, and this arm pins the clamp on BOTH outputs of the one loop.
    /** The view module, built without rendering, for the pure geometry. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The settled render of the two-task cycle, for the witness set the DOM carries. */
    const { tree } = await renderView({
      routes: {
        [STATE_PATH]: { ok: true, status: 200, body: stateOf(CYCLE_TASKS, { total: 2, completed: 0, running: 0, ready: 0, blocked: 2 }, ["T1", "T2"]) },
      },
    })
    /** Both drawn edges, which this cycle's ranks make point in both directions. */
    const edges = collect(one(tree, "data-edges", "1"), "data-mpd-edge")
    // A cycle's two tasks resolve to the SAME rank, so the drawn order is the board's own order — the
    // arm pins the SET of edges, which is the fact the geometry can guarantee.
    expect(edges.map((edge) => edge.props["data-mpd-edge"]).sort()).toEqual(["T1<-T2", "T2<-T1"])
    // THE SAME SERVED BOARD, for the same reason: the core ranks both cycle members 0, while the raw
    // fixture's depths say 0 and 1 — a bare fallback would draw a different picture than the one rendered.
    /** The cycle exactly as the host would serve it. */
    const servedCycle = withServed(CYCLE_TASKS)
    /** The same board's geometry, where every run and every curve is checkable as a number. */
    const graph = view.layout(servedCycle.tasks, undefined, servedCycle.model)
    expect(graph.edges.length).toBe(2)
    for (const edge of graph.edges) {
      /** Every rect the route publishes, which must never be negative or unparsable. */
      for (const segment of edge.segments) {
        expect(Number.isFinite(segment.rect.width)).toBe(true)
        expect(segment.rect.width).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(segment.rect.height)).toBe(true)
        expect(segment.rect.height).toBeGreaterThanOrEqual(0)
      }
      // THE CURVE GUARD: the painted form is a string of numbers, and one NaN in it is an edge that
      // silently disappears — the failure mode a rect-only assertion would have missed entirely.
      expect(edge.curve.d).not.toContain("NaN")
      expect(edge.curve.d).not.toContain("undefined")
      for (const token of edge.curve.d.replace(/[MLQC]/g, " ").trim().split(/\s+/)) expect(Number.isFinite(Number(token))).toBe(true)
      for (const point of edge.curve.points) {
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
      }
      expect(Number.isFinite(edge.curve.tip.x)).toBe(true)
      expect(Number.isFinite(edge.curve.tip.y)).toBe(true)
      // The tip is the route's last vertex, which is the arrival border.
      expect(edge.curve.points[edge.curve.points.length - 1]).toEqual(edge.curve.tip)
    }
  })

  test("the curve builder degrades to the straight orthogonal route at radius = 0 (clause W6)", () => {
    // THE FALSIFIABILITY CONTROL FOR THE WHOLE LANE. Every claim about the curve rests on it being a
    // parametrisation of the route: at `radius = 0` the builder must give the route back EXACTLY — the
    // same vertices, in the same order, joined by straight lines — so the fillet and the closing sweep
    // are the only difference between the proven route and the painted curve.
    /** The view module, built without rendering, for the pure builder. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** One realistic route: right along a lane, down it, then into the dependant's border. */
    const waypoints = [{ x: 164, y: 25 }, { x: 168, y: 25 }, { x: 168, y: 77 }, { x: 172, y: 77 }]
    /** The control: the same route with every corner radius removed. */
    const flat = view.curveOf(waypoints, 0)
    // BYTE-COMPARABLE, not merely "renders the same": the path is `M`/`L` only …
    expect(flat.d).toBe("M 164 25 L 168 25 L 168 77 L 172 77")
    expect(/[QC]/.test(flat.d)).toBe(false)
    // … and the flattened polyline IS the waypoint list, point for point and in order. This is the
    // control the reviewer can re-run without knowing anything about the curve's own construction.
    expect(flat.points).toEqual(waypoints)
    // AND THE CURVE ITSELF, at the declared radius: a `Q` at the elbow and a `C` into the arrival —
    // clause W6's grammar, read off the string the browser would draw.
    /** The same route with the shipped radius. */
    const curved = view.curveOf(waypoints, 6)
    expect(curved.d).toContain(" Q ")
    expect(curved.d).toContain(" C ")
    expect(curved.d).not.toContain("NaN")
    // It ends on the same border point, and it bends only BETWEEN the two ends: the fillet and the sweep
    // round the route's own corners, they never move where the edge starts or stops.
    expect(curved.points[0]).toEqual({ x: 164, y: 25 })
    expect(curved.points[curved.points.length - 1]).toEqual({ x: 172, y: 77 })
    // The arcs are DENSE, which is what W3's instrument needs: the curved form carries more samples than
    // the four vertices it was built from, while the flat form carried exactly those four.
    expect(curved.points.length).toBeGreaterThan(waypoints.length)
    // Every sample stays inside the corridor its own route occupies: no fillet or sweep may leave the
    // bounding box of the waypoints — the property the containment arm then measures against real boxes.
    for (const point of curved.points) {
      expect(point.x).toBeGreaterThanOrEqual(164)
      expect(point.x).toBeLessThanOrEqual(172)
      expect(point.y).toBeGreaterThanOrEqual(25)
      expect(point.y).toBeLessThanOrEqual(77)
    }
  })

  test("the arrowhead's tip lands ON the border it arrives at, by arithmetic (clause W5)", async () => {
    /**
     * Check every drawn edge of one rendered board, and report how the arrivals split by border.
     *
     * The tip mark is a ZERO-WIDTH rect whose left edge IS the tip, so this needs no knowledge of the
     * head's own width — which is exactly why the mark is zero-width.
     * @param tree - one settled render of a board.
     * @returns how many edges arrived at the right border, out of every edge checked.
     */
    const checkArrivals = (tree: ElementNode): { left: number; right: number } => {
      /** Every box as published, keyed by task id. */
      const boxes = new Map<string, Rect>()
      for (const node of collect(tree, "data-mpd-node")) boxes.set(String(node.props["data-mpd-node"]), parseRect(String(node.props["data-mpd-box"])))
      /** How many edges arrived at a LEFT border. */
      let left = 0
      /** How many arrived at a RIGHT border — the back edges and the same-rank ones. */
      let right = 0
      for (const edge of collect(tree, "data-mpd-edge")) {
        /** `child<-parent`, the witness the edge publishes. */
        const mark = String(edge.props["data-mpd-edge"])
        /** The box the edge arrives at. */
        const box = boxes.get(mark.split("<-")[0]) as Rect
        // The direction travels with the ROUTE, which is still the routing truth: `L` means the head
        // points left and the edge therefore arrives at the dependant's RIGHT border.
        /** Whether this edge arrives at its child's right border. */
        const arrivesAtRight = String(edge.props["data-mpd-route"]).split("|")[1].startsWith("L")
        /** The arrival point as published: `left,top,width,height` with a zero width. */
        const tip = parseRect(String(collect(edge, "data-mpd-tip")[0].props["data-mpd-tip"]))
        expect(tip.width).toBe(0)
        expect(tip.height).toBe(8)
        /** The border this edge must touch: the box's first pixel from the left, its right edge from the right. */
        const border = arrivesAtRight ? box.left + box.width : box.left
        expect(tip.left).toBe(border)
        // The head is CENTRED on the arrival row, so its tip touches the border at the point the edge's
        // own last sample does — a head floating above or below the line would read as another edge.
        expect(tip.top + tip.height / 2).toBeGreaterThan(box.top)
        expect(tip.top + tip.height / 2).toBeLessThan(box.top + box.height)
        if (arrivesAtRight) right += 1
        else left += 1
      }
      return { left, right }
    }
    // THE FORWARD BOARD: every dependency runs downhill, so every arrival is on a left border.
    /** The five-rank board's render. */
    const downhill = (await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(LONG_EDGE_TASKS) } } })).tree
    /** That board's arrivals. */
    const forward = checkArrivals(downhill)
    expect(forward.left).toBe(collect(downhill, "data-mpd-edge").length)
    // THE CYCLIC BOARD: a revisited node resolves to rank 0, so its back edge comes back around the
    // column and arrives on the RIGHT border — the other half of W5, without which this arm would be a
    // claim about one direction only.
    /** The two-task cycle's render. */
    const cyclic = (await renderView({
      routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(CYCLE_TASKS, { total: 2, completed: 0, running: 0, ready: 0, blocked: 2 }, ["T1", "T2"]) } },
    })).tree
    /** That board's arrivals, at least one of which must land on a right border. */
    const back = checkArrivals(cyclic)
    expect(back.right).toBeGreaterThan(0)
  })

  test("the graph-safe label rule is clause C4 exactly", () => {
    /** The view module, built without rendering, for the pure composer. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // THE RULE, clause by clause: the maximal printable-ASCII runs, joined by ONE space, whitespace
    // collapsed, trimmed. An English subject is therefore unchanged.
    expect(view.graphSafeLabel("Build the parser", 3)).toBe("Build the parser")
    expect(view.graphSafeLabel("   spaced   out   ", 1)).toBe("spaced out")
    // A non-ASCII separator is DROPPED and the runs around it are JOINED — the `·` here is U+00B7, which
    // is outside `\x20`-`\x7E`, so the label reads as two runs rather than as the original sentence.
    expect(view.graphSafeLabel("T1 · REV #2", 2)).toBe("T1 REV #2")
    // A subject whose ASCII leaves nothing but the SPACES around the Chinese still falls back: the runs
    // are joined, collapsed and trimmed away, which is the branch a naive `runs.length === 0` test misses.
    expect(view.graphSafeLabel("修复 登录 页面", 4)).toBe("#4")
    expect(view.graphSafeLabel("修复登录页面", 4)).toBe("#4")
    expect(view.graphSafeLabel("！？。", 9)).toBe("#9")
    expect(view.graphSafeLabel("", 12)).toBe("#12")
    // THE ORDINAL IS THE BOARD'S OWN POSITION, not the drawn row: the columns are re-ordered by rank and
    // id, so a node that numbered itself off the picture would name a different task.
    /** A board whose ids sort unlike their served order. */
    const board = [
      { id: "T9", subject: "中文标题", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "second", kind: "work", status: "open", visual: "open", blockedBy: ["T9"], failedBy: [], depth: 0 },
    ]
    /** The geometry's own ordinals, which the label composer is handed. */
    const ordinals = view.layout(board).nodes.map((node) => [node.task.id, node.ordinal]).sort()
    expect(ordinals).toEqual([["T2", 2], ["T9", 1]])
  })

  test("a Chinese subject is drawn graph-safe, while the detail and the tooltip keep the original", async () => {
    /** A board whose subjects are pure Chinese, which is exactly what the drawing may not carry. */
    const board = [
      { id: "T1", subject: "冻结验收契约", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "构建头部与进度条", kind: "work", status: "running", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
    ]
    /** The settled render of that board, plus the handles a click needs. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** That render's tree. */
    const { tree } = rendered
    /**
     * The text the DRAWING carries for one node.
     *
     * The node's own element is read whole — every glyph, id, kind and label it draws — because clause C1
     * is a statement about the picture rather than about one div.
     */
    const drawn = (id: string): string => flatText(one(tree, "data-mpd-node", id))
    expect(drawn("T1")).toContain("#1")
    expect(drawn("T2")).toContain("#2")
    // CLAUSE C1's OWN FORM, over the whole drawing: no codepoint in any of the declared CJK/full-width
    // ranges survives into it. The declared glyphs (✓ ◐ ✗ ○ ⊘) are outside those ranges by design.
    /** The drawing's own text: every node and every edge, with nothing of the panel's chrome. */
    const picture = collect(tree, "data-mpd-node").map((node) => flatText(node)).join(" ")
    expect(/[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(picture)).toBe(false)
    // NEGATIVE CONTROL: the same assertion over the PRE-RULE text — the raw subjects — MUST fail, or the
    // check above could be passing because it is looking at the wrong string.
    /** The board's subjects as served, which is what the drawing used to carry. */
    const before = board.map((task) => task.subject).join(" ")
    expect(/[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(before)).toBe(true)
    // CLAUSE C3: the hover TOOLTIP is not drawing text, so it keeps the original subject verbatim.
    expect(String(one(tree, "data-mpd-node", "T1").props.title)).toContain("冻结验收契约")
    // And so does the pinned DETAIL body, which is where the Chinese belongs.
    ;(one(tree, "data-mpd-node", "T1").props.onClick as () => void)()
    /** The tree after the click pinned T1. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(flatText(one(pinned, "data-mpd-detail", "T1"))).toContain("冻结验收契约")
  })

  test("under a zh locale the node legend draws the ASCII kind, while the detail body keeps the localized kind and the Chinese subject", async () => {
    // THE REPORTED DEFECT: the node's kind chip went through `kindOf`, which IS the translated kind — so
    // a zh-CN capture drew 需求/工作/评审 in the DAG where clause F1 fixes the ASCII
    // `REQ | WRK | REV | FIX | INT`. The DRAWING is the one place the kind must be locale-free; the task
    // detail body is chrome, so it keeps the localized word. Both halves are pinned here, because a
    // blanket "make every kind ASCII" fix would redden the second assertion and is not the contract.
    /** The host's zh dictionary for the five kinds, spelled as the shipped client localizes them. */
    const zh: Record<string, string> = { "kind.req": "需求", "kind.wrk": "工作", "kind.rev": "评审", "kind.fix": "修复", "kind.int": "集成" }
    /** The translator a zh-CN browser hands the view: localized kinds, every other key marked. */
    const t = (key: string): string => zh[key] ?? ZH + key
    // NEGATIVE CONTROL, stated before the render: this translator really does produce CJK for a kind
    // key, so a green no-CJK assertion below is a statement about the DRAWING, not about the fixture.
    expect(/[\u4E00-\u9FFF]/.test(t("kind.req"))).toBe(true)
    /** One task of each kind F1 declares, every subject pure Chinese so the C3 half is not vacuous. */
    const board = [
      { id: "T1", subject: "冻结验收契约", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "构建头部与进度条", kind: "work", status: "running", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T3", subject: "画依赖边", kind: "review", status: "open", visual: "open", blockedBy: ["T2"], failedBy: [], depth: 2 },
      { id: "T4", subject: "修复截断的路由", kind: "repair", status: "open", visual: "blocked", blockedBy: ["T3"], failedBy: [], depth: 3 },
      { id: "T5", subject: "集成收尾", kind: "integration", status: "open", visual: "open", blockedBy: ["T4"], failedBy: [], depth: 4 },
    ]
    /** The settled render of that board through the zh translator. */
    const rendered = await renderView({ t, routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** That render's tree. */
    const tree = rendered.tree
    /** Each task's F1 abbreviation beside the zh word the SAME kind translates to. */
    const kinds: Array<[string, string, string]> = [
      ["T1", "REQ", zh["kind.req"]], ["T2", "WRK", zh["kind.wrk"]], ["T3", "REV", zh["kind.rev"]],
      ["T4", "FIX", zh["kind.fix"]], ["T5", "INT", zh["kind.int"]],
    ]
    for (const [id, code, word] of kinds) {
      /** One node's whole drawn legend: the glyph, the id, the kind and the graph-safe label. */
      const drawn = flatText(one(tree, "data-mpd-node", id))
      expect(drawn).toContain(code)
      expect(drawn).not.toContain(word)
    }
    // CLAUSE C1/F1 over the whole drawing: no codepoint in any declared CJK/full-width range survives —
    // with the zh translator threaded in, which is the locale the shipped check failed under.
    /** The drawing's own text: every node box, with none of the panel's chrome. */
    const picture = collect(tree, "data-mpd-node").map((node) => flatText(node)).join(" ")
    expect(/[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(picture)).toBe(false)
    // CLAUSE C3: the hover TOOLTIP is not drawing text, so it keeps the original subject verbatim.
    expect(String(one(tree, "data-mpd-node", "T3").props.title)).toContain("画依赖边")
    // AND SO DOES THE PINNED DETAIL BODY — including its localized kind, which is chrome and stays zh.
    ;(one(tree, "data-mpd-node", "T3").props.onClick as () => void)()
    /** The tree after the click pinned T3. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The pinned body's text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T3"))
    expect(detail).toContain("画依赖边")
    expect(detail).toContain(zh["kind.rev"])
  })
})

describe("team-view interaction", () => {
  test("hover tints the transitive chain and dims every other node, and leaving restores it", async () => {
    /** The settled render, plus the handles its nodes' handlers need. */
    const rendered = await renderView()
    /** The hook runtime and the settled tree this arm drives. */
    /** The hook runtime and the settled tree this arm drives. */
    const { hooks, tree } = rendered
    // Hover on T2: its ancestors are T1, and its descendants are T3 and (through T3) T4 — the fixture
    // is one chain, so the halo is the whole board and the assertion that matters is the FOCUS witness.
    ;(one(tree, "data-mpd-node", "T2").props.onMouseEnter as () => void)()
    /** The tree after the hover re-rendered. */
    const hovered = await hooks.act(rendered.component, { sessionId: "s1" } as never)
    // THE HOVER IS WITNESSABLE FROM OUTSIDE: the host drives a real mouse move and reads the graph's
    // focus attribute, which is written by the node's OWN enter/leave handler and nothing else.
    expect(one(hovered, "data-mpd-graph", "ranks=4 edges=3").props["data-mpd-focus"]).toBe("chain")
    expect(styleOf(one(hovered, "data-mpd-node", "T1"), "opacity")).toBe("1")
    expect(styleOf(one(hovered, "data-mpd-node", "T2"), "opacity")).toBe("1")
    expect(styleOf(one(hovered, "data-mpd-node", "T3"), "opacity")).toBe("1")
    expect(styleOf(one(hovered, "data-mpd-node", "T4"), "opacity")).toBe("1")
    // The focused edge is tinted brighter than an unfocused one — AS A STROKE (clause W7), because a
    // curve has no background to colour: the tint travels through the path's stroke and the head's fill.
    /** The focused edge's two painted children: the curve and its arrowhead. */
    const focused = collectByKey(hovered, "edge:T1>T2")[0].props.children as ElementNode[]
    expect(focused[0].props.stroke).toBe("var(--dsw-alias-label-secondary, #5b6472)")
    expect(focused[1].props.fill).toBe("var(--dsw-alias-label-secondary, #5b6472)")
    expect(focused[0].props.fill).toBe("none")
    // Leaving clears the halo, so every node is full again.
    ;(one(hovered, "data-mpd-node", "T2").props.onMouseLeave as () => void)()
    /** The tree after the pointer left. */
    const left = await hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(left, "data-mpd-node", "T4"), "opacity")).toBe("1")
    expect(one(left, "data-mpd-graph", "ranks=4 edges=3").props["data-mpd-focus"]).toBe("none")
    expect((collectByKey(left, "edge:T1>T2")[0].props.children as ElementNode[])[0].props.stroke).not.toBe("var(--dsw-alias-label-secondary, #5b6472)")
  })

  test("marks the root with the team id, and with an empty marker when there is no team", async () => {
    /** The settled render of the fixture team. */
    const withTeam = await renderView()
    expect(withTeam.tree.props["data-mpd-team-tab"]).toBe("team-alpha")
    // Exactly one root carries the marker, so a reader can find the tab without guessing.
    expect(collect(withTeam.tree, "data-mpd-team-tab").length).toBe(1)
    /** Every rank column of that render, in order. */
    const ranks = collect(withTeam.tree, "data-mpd-rank").map((column) => column.props["data-mpd-rank"])
    expect(ranks).toEqual(["0", "1", "2", "3"])
    // WITHOUT a team — the pre-approval shape — the marker is the empty string rather than absent.
    /** The settled render of a session with no team and no staged plan. */
    const withoutTeam = await renderView({
      routes: { [STATE_PATH]: { ok: true, status: 200, body: { ok: true, workspace: WORKSPACE, team: null, counts: { total: 0, completed: 0, running: 0, ready: 0, blocked: 0, failed: 0, releasedByFailure: 0 }, members: [], tasks: [], cycles: [], executor: { kind: "native", reason: "x" }, problems: [] } } },
    })
    expect(withoutTeam.tree.props["data-mpd-team-tab"]).toBe("")
    expect(collect(withoutTeam.tree, "data-mpd-graph").length).toBe(0)
  })

  test("clicking a node pins its detail body with the frozen contract, and closes again", async () => {
    /** The settled render, plus the handles its nodes' handlers need. */
    const rendered = await renderView()
    /** The hook runtime and the settled tree this arm drives. */
    /** The hook runtime and the settled tree this arm drives. */
    const { hooks, tree } = rendered
    ;(one(tree, "data-mpd-node", "T3").props.onClick as () => void)()
    /** The tree with T3 pinned. */
    const pinned = await hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The pinned node's own element, which marks itself pressed. */
    const node = one(pinned, "data-mpd-node", "T3")
    expect(node.props["aria-pressed"]).toBe(true)
    // THE PIN IS WITNESSABLE FROM OUTSIDE: the detail body names the task it belongs to, and the
    // attribute is simply absent while nothing is pinned.
    expect(collect(pinned, "data-mpd-detail").map((body) => body.props["data-mpd-detail"])).toEqual(["T3"])
    expect(collect(rendered.tree, "data-mpd-detail").length).toBe(0)
    expect(styleOf(node, "borderWidth")).toBe("1px")
    /** The detail body's text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T3"))
    expect(detail).toContain("Draw the dependency graph edges")
    expect(detail).toContain("T3 · REV · ○ blocked")
    expect(detail).toContain("owner web-settings-card")
    expect(detail).toContain("attempt 1")
    expect(detail).toContain("round 1")
    expect(detail).toContain("verdict changes")
    // The blockers name what it rests on, the dependents are derived from the board, and the frozen
    // acceptance contract is QUOTED rather than summarized.
    // THE ROW NAMES THE EDGES THE DRAWING ROUTES (CodeRabbit PR #47): T2 resolves and is drawn, so it
    // is named. T9 names nothing on the board, so no edge is painted for it; the served report still
    // carries it in `graph.unresolved` (pinned by R21's arm), which is where an unresolved reference
    // belongs — the hover/detail may not claim a relationship the picture does not draw.
    expect(detail).toContain("blocked by T2 dependents T4")
    expect(detail).toContain("dependents T4")
    expect(detail).toContain("acceptance contract ACCEPTED WHEN: one drawn edge exists per blockedBy entry.")
    // The close control unpins it again.
    ;(one(pinned, "data-detail-close", "T3").props.onClick as () => void)()
    /** The tree after the close. */
    const closed = await hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(collect(closed, "data-detail-close").length).toBe(0)
    expect(collect(closed, "data-mpd-detail").length).toBe(0)
    expect(flatText(closed)).not.toContain("ACCEPTED WHEN")
  })

  test("says so when the task route served no contract, instead of rendering a blank body", async () => {
    /** The settled render of a view built WITHOUT the task route. */
    const rendered = await renderView({ taskPath: false })
    ;(one(rendered.tree, "data-mpd-node", "T3").props.onClick as () => void)()
    /** The tree with T3 pinned. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(flatText(pinned)).toContain("No frozen acceptance contract was served for this task.")
    // Not asking for the route is a choice, not a failure: the other two routes were still read.
    expect(rendered.asked.some((url) => url.startsWith(TASK_PATH))).toBe(false)
  })

  test("reads all three routes in one pass, each naming the session it was asked about", async () => {
    /** The settled render, with its record of every URL asked for. */
    const rendered = await renderView()
    expect(rendered.asked).toEqual([STATE_PATH + "?sessionId=s1", PLAN_PATH + "?sessionId=s1", TASK_PATH + "?sessionId=s1"])
    expect(rendered.view.layout([]).rankCount).toBe(1)
  })
})

describe("the halo and the pinned detail follow the DRAWN edges (CodeRabbit PR #47)", () => {
  // THE COHERENCE DEFECT: after Amendment 3 the DRAWING routes the served model's edges, while the halo
  // and the pinned body still read the board's `blockedBy`. A plan-declared arrow was therefore painted
  // while its hover called the relationship nonexistent — the picture disagreeing with itself, which is
  // the failure class this wave exists to end. Both arms below drive the SAME interaction surface the
  // host drives (a real `onMouseEnter` and a real `onClick`), never a private helper.
  /** Two board tasks whose paths are BOTH empty: only the plan declares their relationship. */
  const planOnlyBoard = [
    { id: "T1", subject: "board blocker", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
    { id: "T2", subject: "board dependent", kind: "review", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  ]
  /** A plan that declares `T2 blocked by T1`, an edge neither board task carries. */
  const planEdge: PlanDocument = {
    tasks: [{ id: "T2", title: "board dependent", section: "todo", line: 5, blockedBy: ["T1"] }],
    lanes: [],
    problems: [],
  }

  test("with a model: the hover halo and the pinned body name the SERVED blocker", async () => {
    /** The board exactly as the host would serve it, with the plan edge merged in. */
    const served = withServed(planOnlyBoard, planEdge)
    // The model really carries the edge, and the layout really routes it: the picture is the premise.
    expect(served.model.report.edgePlanOnly.map((edge) => [edge.from, edge.to])).toEqual([["T1", "T2"]])
    /** The settled render of the served payload. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(planOnlyBoard, {}, [], planEdge) } } })
    expect(collect(rendered.tree, "data-mpd-edge").map((edge) => edge.props["data-mpd-edge"])).toEqual(["T2<-T1"])
    // HOVER T2: the served blocker T1 is IN the halo, so the arrow it is drawn with is a relationship
    // the interaction also names.
    ;(one(rendered.tree, "data-mpd-node", "T2").props.onMouseEnter as () => void)()
    /** The tree after the hover re-rendered. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(one(hovered, "data-mpd-graph", "ranks=2 edges=1").props["data-mpd-focus"]).toBe("chain")
    expect(styleOf(one(hovered, "data-mpd-node", "T1"), "opacity")).toBe("1")
    // PIN T2: the detail body's BLOCKED-BY row names T1 even though the board's own list is empty.
    ;(one(hovered, "data-mpd-node", "T2").props.onClick as () => void)()
    /** The tree after the click pinned T2. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The pinned body's flat text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T2"))
    expect(detail).toContain("blocked by")
    expect(detail).toContain("T1")
  })

  test("without a model: the same interaction uses the board's `blockedBy` (the degrade control)", async () => {
    // THE OLDER-SERVER PAYLOAD: no model, no served ranks, so `blockedBy` and `depth` are all there is.
    // The interaction must still name the same blocker — the fallback is a degrade, not a regression.
    /** Two board tasks where the SECOND carries the blocker itself. */
    const board = [
      { id: "T1", subject: "board blocker", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "board dependent", kind: "review", status: "open", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1 },
    ]
    /** The settled render of the pre-wave payload. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board, {}, [], undefined, true) } } })
    expect(collect(rendered.tree, "data-mpd-edge").map((edge) => edge.props["data-mpd-edge"])).toEqual(["T2<-T1"])
    ;(one(rendered.tree, "data-mpd-node", "T2").props.onMouseEnter as () => void)()
    /** The tree after the hover re-rendered. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(hovered, "data-mpd-node", "T1"), "opacity")).toBe("1")
    ;(one(hovered, "data-mpd-node", "T2").props.onClick as () => void)()
    /** The tree after the click pinned T2. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The pinned body's flat text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T2"))
    expect(detail).toContain("blocked by")
    expect(detail).toContain("T1")
  })

  test("clicking a plan-only GHOST pins its detail, with its graph-derived relationships", async () => {
    // THE PART THE HOVER ARM COULD NOT CATCH (CodeRabbit's third round): the PIN resolved the id
    // against the BOARD, so a ghost click set `aria-pressed` but rendered no detail body at all. The
    // click arm is deliberately separate from the hover arm — that asymmetry is what hid the defect.
    /** A board whose two tasks have no relationships of their own. */
    const board = [
      { id: "T1", subject: "board blocker", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "board dependent", kind: "review", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
    ]
    /** A plan declaring a GHOST T9, blocked by the board's T1. */
    const ghostPlan: PlanDocument = {
      tasks: [{ id: "T9", title: "plan-only work", section: "todo", line: 3, blockedBy: ["T1"] }],
      lanes: [],
      problems: [],
    }
    /** The board exactly as the host would serve it, with the ghost and its edge merged in. */
    const served = withServed(board, ghostPlan)
    expect(served.model.nodes.find((node) => node.id === "T9")?.planned).toBe(true)
    expect(served.model.report.edgePlanOnly.map((edge) => [edge.from, edge.to])).toEqual([["T1", "T9"]])
    /** The settled render of the served payload. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board, {}, [], ghostPlan) } } })
    // The ghost is ON SCREEN, carrying the served rank — so the click has something to hit.
    /** The ghost's rendered box. */
    const ghost = one(rendered.tree, "data-mpd-node", "T9")
    expect(ghost.props["data-mpd-planned"]).toBe("true")
    // CLICK, not hover: this is the interaction that used to fall through.
    ;(ghost.props.onClick as () => void)()
    /** The tree after the click pinned the ghost. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(one(pinned, "data-mpd-node", "T9").props["aria-pressed"]).toBe(true)
    // THE DETAIL BODY RENDERS FOR THE GHOST, and its BLOCKED-BY row names the served relationship.
    /** The pinned ghost's detail text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T9"))
    expect(detail).toContain("plan-only work")
    expect(detail).toContain("blocked by")
    expect(detail).toContain("T1")
  })
})

describe("team-view localization", () => {
  test("routes every visible string through the translator, and falls back to English without one", async () => {
    // WITH a translator: every label the view owns comes back marked, so no literal leaked into the
    // render. The payload's own strings (subjects, names, ids) stay untouched, as they must.
    /** The settled render through a marking translator. */
    const withT = await renderView({ t: (key: string) => ZH + key })
    /** The rendered text. */
    const marked = flatText(withT.tree)
    expect(marked).toContain(ZH + "members.title")
    expect(marked).toContain(ZH + "task.title")
    expect(marked).toContain(ZH + "progress.label")
    expect(marked).toContain(ZH + "tally.running")
    expect(marked).toContain(ZH + "header.complete")
    expect(marked).toContain(ZH + "executor.label")
    expect(marked).toContain(ZH + "members.current")
    // THE KIND IS THE DECLARED EXCEPTION (frozen contract §F1, `.mpd/plans/dag-edges-scroll.md`): the
    // node legend line's `<KIND>` is the ASCII abbreviation, so the DRAWING must not route it through the
    // translator at all. The localized word is still chrome — the pinned detail body prints it, and the
    // zh arm above drives that half — so the assertion here is inverted rather than dropped.
    expect(marked).not.toContain(ZH + "kind.req")
    expect(marked).toContain("REQ")
    // The two payload-owned strings are NOT translated, because they are not the view's words.
    expect(marked).toContain("Build the header")
    expect(marked).not.toContain("Members (")
    // WITHOUT one: the English literals in the code are the fallback, so nothing renders as a key.
    /** The settled render through no translator at all. */
    const withoutT = await renderView()
    /** The rendered text. */
    const english = flatText(withoutT.tree)
    expect(english).toContain("MEMBERS (2)")
    expect(english).toContain("TASKS (4)")
    expect(english).toContain("Progress 25%")
    expect(english).toContain("1 running · 1 ready · 1 blocked")
    expect(english).toContain("REQ")
    expect(english).toContain("REV")
  })

  test("survives a translator that throws, rather than taking the panel down with it", async () => {
    /** The settled render through a translator that always fails. */
    const rendered = await renderView({ t: () => { throw new Error("locale is broken") } })
    expect(flatText(rendered.tree)).toContain("MEMBERS (2)")
  })
})

/**
 * The board from the user's own screenshot (2026-10-06), transcribed rank by rank.
 *
 * FIVE ranks, and — the point of the fixture — EIGHT edges that SKIP a rank:
 * `T2→T7`, `T3→T7`, `T4→T7` (rank 0 → rank 2), `T2→T9`, `T3→T9`, `T4→T9`, `T5→T9` (rank 0 → rank 2)
 * and `T7→T10` (rank 2 → rank 4). Those are exactly the edges the old router ran THROUGH the
 * intermediate column: it took the space between the two end boxes as "the band the riser lives in",
 * and for a skipping edge that band is the whole column, so the riser stood in the middle of it.
 *
 * `T12←T6` is deliberately a SAME-RANK edge (the captain's own rank list puts both in rank 1), which is
 * how the third routing shape — no gutter between the ends — is exercised by real data too.
 */
const LONG_EDGE_TASKS = [
  { id: "T1", subject: "freeze the contract", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "the layout engine", kind: "work", status: "running", visual: "running", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T3", subject: "the panels", kind: "work", status: "running", visual: "running", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T4", subject: "the surface redesign", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T5", subject: "the invisible panel", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T6", subject: "wire the panels", kind: "work", status: "open", visual: "blocked", blockedBy: ["T3"], failedBy: [], depth: 1 },
  { id: "T11", subject: "sidebar adapters", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2"], failedBy: [], depth: 1 },
  { id: "T12", subject: "the panel seam", kind: "work", status: "open", visual: "blocked", blockedBy: ["T6"], failedBy: [], depth: 1 },
  { id: "T7", subject: "independent verification", kind: "review", status: "open", visual: "blocked", blockedBy: ["T2", "T3", "T4", "T6"], failedBy: [], depth: 2 },
  { id: "T9", subject: "bilingual docs", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2", "T3", "T4", "T5", "T6"], failedBy: [], depth: 2 },
  { id: "T8", subject: "visual fidelity", kind: "review", status: "open", visual: "blocked", blockedBy: ["T7"], failedBy: [], depth: 3 },
  { id: "T10", subject: "integration", kind: "integration", status: "open", visual: "blocked", blockedBy: ["T7", "T8", "T9"], failedBy: [], depth: 4 },
]

/** One axis-aligned rectangle, as the geometry and the DOM both publish them. */
interface Rect {
  /** The left x. */
  left: number
  /** The top y. */
  top: number
  /** The width. */
  width: number
  /** The height. */
  height: number
}

/** Parse one `left,top,width,height` text into a rectangle. */
function parseRect(text: string): Rect {
  /** The four numbers, in the order the view writes them. */
  const parts = text.split(",").map((value) => Number(value))
  expect(parts.length).toBe(4)
  for (const value of parts) expect(Number.isFinite(value)).toBe(true)
  return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] }
}

/** Write one rectangle as the comma-joined text the view publishes it with — the inverse of `parseRect`. */
function rectTextOf(rect: Rect): string {
  return rect.left + "," + rect.top + "," + rect.width + "," + rect.height
}

/**
 * Whether a ROUTE RUN enters a box's INTERIOR.
 *
 * The tolerance is deliberate and is the only honest one: a run may ABUT the border it attaches to
 * (that is what "the edge arrives here" means, and the lead-in covers that border's own pixel), so the
 * comparison is against the box shrunk by one pixel on every side. A run that crosses a box enters
 * its interior and is caught; a line stopping one pixel short of the box it describes shows up in the
 * separate "every edge reaches both of its boxes" arm.
 */
function entersInterior(run: Rect, box: Rect): boolean {
  /** The box without its one-pixel border, which is the area a drawing may never cover. */
  const inner = { left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }
  return run.left < inner.left + inner.width && inner.left < run.left + run.width
    && run.top < inner.top + inner.height && inner.top < run.top + run.height
}

/**
 * Whether the SEGMENT between two consecutive curve samples enters a box's interior.
 *
 * THIS IS THE W3 INSTRUMENT, and it measures SEGMENTS rather than points on purpose. A curve makes the
 * route's rectangles an elbow SKELETON rather than the painted line, so a rect test keeps passing while
 * the curve crosses a box — the vacuous green clause W3 forbids. A point-only sample test has the
 * mirror hole: a 1px line can thread a box BETWEEN two samples. Measuring the segment between
 * consecutive samples is exact for a straight leg, needs no sampling-density assumption and still
 * catches a bulge, which is why `curve.points` can stay the waypoint list at `radius = 0`.
 *
 * The 1px shrink carries the same tolerance {@link entersInterior} declares: a curve may ABUT the
 * border it attaches to, and the segment test uses the classic parametric slab clip, so it is exact
 * for any orientation rather than only for the axis-aligned runs the rect test was written for.
 * @param from - the segment's first sample.
 * @param to - its second sample.
 * @param box - the box as the render published it.
 * @returns whether any part of the segment lies inside the box's interior.
 */
function segmentEntersInterior(from: { x: number; y: number }, to: { x: number; y: number }, box: Rect): boolean {
  /** The box without its one-pixel border: the area a drawing may never cover. */
  const inner = { left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }
  /** The segment's own direction. */
  const dx = to.x - from.x
  /** That direction's y. */
  const dy = to.y - from.y
  /** The clipped parameter interval still inside the slab, starting as the whole segment. */
  let enter = 0
  /** The other end of that interval. */
  let exit = 1
  /**
   * Clip the segment against one slab of the interior.
   * @param p - the direction's component along the slab's normal.
   * @param q - the distance from the slab's boundary along that normal.
   * @returns whether any of the segment survives this slab.
   */
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    /** Where the segment meets the slab's boundary. */
    const at = q / p
    if (p < 0) {
      if (at > exit) return false
      if (at > enter) enter = at
    } else {
      if (at < enter) return false
      if (at < exit) exit = at
    }
    return true
  }
  return clip(-dx, from.x - inner.left) && clip(dx, inner.left + inner.width - from.x)
    && clip(-dy, from.y - inner.top) && clip(dy, inner.top + inner.height - from.y)
}

describe("team-view edge legibility (the reported tangle)", () => {
  // WHAT THIS ARM IS WORTH, stated before it is read: containment here is STRUCTURAL, not merely tested.
  // `curveOf` clamps every fillet to half of its shorter adjacent leg, so a leg can never be overshot and
  // the painted curve cannot leave the corridor its orthogonal route was proven to occupy — the property
  // holds by CONSTRUCTION. This arm is therefore a REGRESSION GUARD: it catches a future change to the
  // clamp, to the lane assignment or to the waypoint list, and it is the only thing that would catch a
  // curve crossing a box if that construction were ever weakened. It is NOT a live proof that today's
  // curve was lucky enough to stay clear, and a reader must not trust it for more than the guard it is.
  test("NO drawn CURVE enters any node box, on the five-rank board from the screenshot", async () => {
    /** The settled render of the screenshot's board, plus the pure module whose curves it painted. */
    const { tree, view } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(LONG_EDGE_TASKS) } } })
    // The witness counts first: 16 drawable dependencies on this board, in 5 ranks. The docker capture
    // reads exactly these, so the geometric arm below is asserting the picture the user sees.
    expect(one(tree, "data-mpd-graph", "ranks=5 edges=16").props["data-mpd-graph"]).toBe("ranks=5 edges=16")
    /** Every box, as the render published it, keyed by task id. */
    const boxes = new Map<string, Rect>()
    for (const node of collect(tree, "data-mpd-node")) boxes.set(String(node.props["data-mpd-node"]), parseRect(String(node.props["data-mpd-box"])))
    expect(boxes.size).toBe(LONG_EDGE_TASKS.length)
    // THE SAMPLES COME FROM THE PURE LAYOUT, not from a re-derivation in this file: the polyline the
    // containment claim is about is the one the layout published as `points`.
    /** The screenshot's board exactly as the host served it, ranks included. */
    const servedLong = withServed(LONG_EDGE_TASKS)
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(servedLong.tasks, undefined, servedLong.model)
    expect(graph.edges.length).toBe(16)
    // THE BRIDGE, without which samples and paint could drift apart and this arm would be proving a
    // drawing nobody rendered: every edge's RENDERED `data-mpd-curve` must BE the layout's own `d`.
    /** What each rendered edge actually painted, keyed by its witness. */
    const painted = new Map<string, string>()
    for (const edge of collect(tree, "data-mpd-edge")) painted.set(String(edge.props["data-mpd-edge"]), String(collect(edge, "data-mpd-curve")[0].props["data-mpd-curve"]))
    expect(painted.size).toBe(graph.edges.length)
    for (const edge of graph.edges) expect(painted.get(edge.witness)).toBe(edge.curve.d)
    // NON-VACUITY, ASSERTED: the instrument is fed a real sample set, and the arcs really were flattened
    // — an edge carrying no more points than its own legs would mean the curve was never sampled.
    /** Every sample of every drawn edge. */
    let samples = 0
    /** How many edges carry MORE points than their route has legs, which only an arc can do. */
    let flattened = 0
    for (const edge of graph.edges) {
      samples += edge.curve.points.length
      if (edge.curve.points.length > edge.segments.length + 1) flattened += 1
    }
    expect(samples).toBeGreaterThan(graph.edges.length * 2)
    expect(flattened).toBeGreaterThan(0)
    // THE MEASUREMENT: every segment between consecutive samples of every drawn curve, against every box
    // as the RENDER published it. None may enter an interior.
    /** How many (segment, box) pairs the drawn curves enter, which must be none. */
    let crossings = 0
    for (const edge of graph.edges) {
      for (let index = 1; index < edge.curve.points.length; index += 1) {
        for (const box of boxes.values()) if (segmentEntersInterior(edge.curve.points[index - 1], edge.curve.points[index], box)) crossings += 1
      }
    }
    expect(crossings).toBe(0)
    // POSITIVE CONTROL 1 — THE OLD ROUTER: the same instrument fed the pre-fix run must FLAG it, or this
    // arm could pass by measuring nothing at all. That formula put ONE riser for a rank-skipping edge at
    // the centre of the band between the parent's right border and the child's left border — x=252,
    // inside rank 1's column — and ran it between the two ends' attachment ys. The X is the removed
    // formula's own; the YS come from the CURRENT geometry's T4→T7 edge, because D1 moved the rows
    // (the stacks are centred now) and a frozen `25..77` would describe a picture this layout never
    // draws. The pair is chosen because T4's port to T7 and T7's port from T4 straddle rank 1's boxes.
    /** The real T4→T7 edge, whose two attachment ys the old formula would have spanned in one riser. */
    const oldRoute = graph.edges.find((candidate) => candidate.witness === "T7<-T4")
    expect(oldRoute).toBeDefined()
    /** The y it leaves T4 at. */
    const oldLeaveY = (oldRoute as { curve: { points: Array<{ x: number; y: number }> } }).curve.points[0].y
    /** The y it arrives at T7. */
    const oldPoints = (oldRoute as { curve: { points: Array<{ x: number; y: number }> } }).curve.points
    /** The arrival y. */
    const oldArriveY = oldPoints[oldPoints.length - 1].y
    /** The pre-fix single riser: the removed formula's x, spanning the two attachment ys. */
    const oldRiser: Rect = { left: 252, top: Math.min(oldLeaveY, oldArriveY), width: 1, height: Math.abs(oldArriveY - oldLeaveY) }
    /** The boxes that riser stood inside, which is the tangle the user photographed. */
    expect([...boxes].filter(([, box]) => entersInterior(oldRiser, box)).length).toBeGreaterThan(0)
    // POSITIVE CONTROL 2 — THE CURVE DOMAIN: the SAME segment instrument, fed a polyline that bends
    // through a column. This is the control the rect skeleton cannot give: it proves the arm can fail on
    // a sample path, which is exactly the failure mode a curve introduces. (The per-vertex clamp to half
    // a leg is what makes a real curve unable to bulge, so an injected path — not a huge radius — is the
    // honest way to make this instrument fail in its own domain.)
    // The injected shape is built from a REAL box, because D1 moved the stacks (they are centred now)
    // and the old `164,25 -> 252,77` stub no longer passes through anything. It runs down that box's
    // centre line and out past its right edge, which the instrument must catch on the way through.
    /** One box the injected curve is meant to invade. */
    const victim = boxes.get("T6") as Rect
    /** The pre-fix route's shape: straight through a node, emitted at the shipped radius. */
    const bulging = view.curveOf([
      { x: victim.left + victim.width / 2, y: victim.top - 10 },
      { x: victim.left + victim.width / 2, y: victim.top + victim.height + 10 },
      { x: victim.left + victim.width + 10, y: victim.top + victim.height + 10 },
    ], 6).points
    /** How many boxes that injected curve enters, which must be at least one. */
    let caught = 0
    for (let index = 1; index < bulging.length; index += 1) {
      for (const box of boxes.values()) if (segmentEntersInterior(bulging[index - 1], bulging[index], box)) caught += 1
    }
    expect(caught).toBeGreaterThan(0)
  })

  test("a rank-skipping edge rises beside its blocker, crosses on a band row, and descends beside its dependant", async () => {
    /** The view module, built without rendering, for the pure geometry. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The screenshot's board exactly as the host served it, ranks included. */
    const servedLong = withServed(LONG_EDGE_TASKS)
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(servedLong.tasks, undefined, servedLong.model)
    /** The long edge this arm follows: rank 0 → rank 2, over rank 1. */
    const long = graph.edges.find((edge) => edge.parent === "T2" && edge.child === "T7")
    expect(long).toBeDefined()
    // BEFORE: three runs (lead-out, riser, lead-in) with ONE riser standing in the middle of rank 1's
    // column. AFTER: five runs — the path leaves T2, rises in gutter 0 to its own BAND row, crosses
    // rank 1 on that row (outside the box area), descends in gutter 1 and arrives at T7.
    expect((long as { segments: Array<{ key: string }> }).segments.map((segment) => segment.key)).toEqual(["out", "riser", "cross1", "riser2", "in"])
    /** The runs of that edge, by key, so each claim reads off the drawn rectangle. */
    const byKey = new Map((long as { segments: Array<{ key: string; rect: Rect }> }).segments.map((segment) => [segment.key, segment.rect]))
    /** The first riser: the one that leaves T2's gutter. */
    const riser1 = byKey.get("riser") as Rect
    /** The second riser: the one that arrives at T7. */
    const riser2 = byKey.get("riser2") as Rect
    // THE TWO RISERS STAND IN DIFFERENT GUTTERS, which is the whole construction: a single riser could
    // only travel down one x, and that x would have to cross rank 1's column.
    expect(riser2.left).not.toBe(riser1.left)
    // And the CROSSING runs along a row OUTSIDE every box of the rank it crosses — ABOVE the topmost
    // or BELOW the bottommost — which is why it cannot meet one. THE BAND REPLACED THE BELOW-ONLY ROW
    // (D1, contract §5.1): the old router appended a dummy row under each intermediate column, so every
    // long edge crossed underneath and the picture read as a one-sided comb. The frozen contract says
    // to update such an assertion deliberately and allow a top OR bottom band, which is exactly this
    // widening — the invariant kept is "outside the box area", not "below it". The rank members are
    // read off the GEOMETRY's own nodes (R20), never off the fixture's served `depth`.
    /** The crossing run, which is the horizontal hop over rank 1. */
    const crossing = byKey.get("cross1") as Rect
    /** The topmost box the DRAWING placed in rank 1. */
    const rank1Top = Math.min(...graph.nodes.filter((node) => node.rank === 1).map((node) => node.top))
    /** The bottom edge of the lowest box the DRAWING placed in rank 1. */
    const rank1Bottom = Math.max(...graph.nodes.filter((node) => node.rank === 1).map((node) => node.top + 42))
    expect(crossing.top < rank1Top || crossing.top >= rank1Bottom).toBe(true)
    // AND THE PAINTED CURVE CROSSES ON THAT SAME ROW: the fillets round the turns but never move the
    // crossing, so the polyline must carry samples ON the band row itself. Without this the curve
    // could satisfy every rect assertion above while being drawn somewhere else entirely.
    /** That edge's flattened polyline, which is what the renderer painted. */
    const curve = long as { curve: { points: Array<{ x: number; y: number }> } }
    expect(curve.curve.points.some((point) => point.y === crossing.top)).toBe(true)
  })

  test("every gutter lane gets its OWN column: one x per hop, none on a border", async () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The screenshot's board exactly as the host served it, ranks included. */
    const servedLong = withServed(LONG_EDGE_TASKS)
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(servedLong.tasks, undefined, servedLong.model)
    // THE ARITHMETIC IS CHECKED AGAINST THE DRAWING, not against a literal: an edge crosses EVERY gutter
    // between its two ends, so each gutter's lane count is countable from the fixture and the DRAWN ranks
    // alone. (The busiest is gutter 1 with ten hops here, because the rank-skipping edges pass through it
    // on their way to rank 2 — the served depths would have said nine.)
    /** The drawn rank of every task, read off the geometry. */
    const rankOf: Record<string, number> = {}
    for (const node of graph.nodes) rankOf[node.task.id] = node.rank
    /** How many hops cross each gutter, counted from the fixture's own references. */
    const perGutter = new Map<number, number>()
    for (const task of LONG_EDGE_TASKS) {
      for (const reference of task.blockedBy) {
        /** The blocker's drawn rank. */
        const from = rankOf[reference]
        /** The blocked task's drawn rank. */
        const to = rankOf[task.id]
        for (let gap = Math.min(from, to); gap < Math.max(from, to); gap += 1) perGutter.set(gap, (perGutter.get(gap) ?? 0) + 1)
      }
    }
    expect(graph.maxLanes).toBe(Math.max(...perGutter.values()))
    // THE GUTTER IS PAID FOR OUT OF THE INSET: with that many lanes at the preferred 3px spacing the
    // boxes give up more of their column, so the lanes are distinct instead of clamped onto one another.
    expect(graph.gutter).toBeGreaterThanOrEqual(8)
    expect(graph.laneOverflow).toBe(0)
    /** The x of every riser standing in the first gutter, one per hop through it. */
    const xs: number[] = []
    for (const edge of graph.edges) {
      // The FIRST vertical run is the one that drops out of the edge's blocker, so it stands in the
      // gutter the blocker's column opens onto — here gutter 0, whose centre is the 168px boundary.
      /** That edge's lead-out riser, absent when the route has no vertical run at all. */
      const riser = edge.segments.find((segment) => segment.key === "riser")
      if (riser === undefined) continue
      if (riser.rect.left > 168 - graph.inset && riser.rect.left < 168 + graph.inset) xs.push(riser.rect.left)
    }
    /** How many hops cross the FIRST gutter, which is the lane count its risers must match. */
    const firstGutterHops = perGutter.get(0) ?? 0
    expect(xs.length).toBe(firstGutterHops)
    expect(new Set(xs).size).toBe(xs.length)
    // EVERY LANE CLEARS BOTH BORDERS: the lanes are strictly inside the gutter, which is what a crowded
    // board buys by widening the gutter instead of letting a lane land on a box.
    for (const x of xs) expect(x).toBeGreaterThan(168 - graph.inset)
    for (const x of xs) expect(x).toBeLessThan(168 + graph.inset)
  })

  test("every drawn run reaches both of the boxes it names", async () => {
    /** The settled render of the screenshot's board. */
    const { tree } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(LONG_EDGE_TASKS) } } })
    /** Every box, as published. */
    const boxes = new Map<string, Rect>()
    for (const node of collect(tree, "data-mpd-node")) boxes.set(String(node.props["data-mpd-node"]), parseRect(String(node.props["data-mpd-box"])))
    for (const edge of collect(tree, "data-mpd-edge")) {
      /** `child<-parent`, the witness the edge publishes. */
      const mark = String(edge.props["data-mpd-edge"])
      /** The two task ids the witness names. */
      const [child, parent] = mark.split("<-")
      /** The route, split into its runs and its marker. */
      const [route, marker] = String(edge.props["data-mpd-route"]).split("|")
      /** The runs, as rectangles. */
      const runs = route.split(";").map((text) => parseRect(text))
      /** The marker's own box, whose `R`/`L` says which way the edge arrives. */
      const head = parseRect(marker.slice(1))
      // The lead-out starts ON the parent's border, and the lead-in covers the child's border's pixel:
      // an edge that stopped short would be a picture of a dependency that does not arrive.
      expect(runs[0].left === boxes.get(parent)!.left + boxes.get(parent)!.width || runs[0].left + runs[0].width === boxes.get(parent)!.left).toBe(true)
      /** The child's box. */
      const into = boxes.get(child) as Rect
      /** The last run, which is the lead-in. */
      const last = runs[runs.length - 1]
      // WHICH BORDER THE EDGE ARRIVES AT IS A FACT ABOUT THE ROUTE, not a constant: a forward edge
      // arrives on the left border, a back edge and a same-rank edge wrap around to the right one. The
      // marker's own `R`/`L` publishes that, and the border's pixel column is what both must cover.
      /** Whether this edge arrives at the child's RIGHT border, which is what `L` says. */
      const arrivesAtRight = marker.startsWith("L")
      // THE CODEBASE'S ONE CONVENTION, restated so this arm reads it rather than re-inventing it:
      // `leftOf` is the box's FIRST pixel, and `rightOf` is the pixel immediately AFTER its last one —
      // the box's right edge — so a left arrival covers the first pixel (an overlap of exactly one) and
      // a right arrival starts on that edge, one pixel past the box's last one. Both MEET the box; a
      // run that stopped short would leave a gap and read as a dependency that does not arrive.
      if (arrivesAtRight) {
        expect(last.left).toBeLessThanOrEqual(into.left + into.width)
      } else {
        expect(last.left).toBeLessThanOrEqual(into.left)
        expect(last.left + last.width).toBeGreaterThan(into.left)
      }
      expect(last.top).toBeGreaterThan(into.top)
      expect(last.top).toBeLessThan(into.top + into.height)
      // The arrowhead's tip sits on that border — on the box's first pixel from the left, and on its
      // right edge from the right — so a reader can see which way the dependency runs.
      expect(arrivesAtRight ? head.left : head.left + head.width).toBe(arrivesAtRight ? into.left + into.width : into.left)
      expect(head.height).toBe(8)
      // THE CURVE TWIN (clause W5 over the PAINT rather than over the route): the tip mark names the
      // same border the route does, and the flattened polyline ENDS on the arrival point — so the drawn
      // curve lands exactly where the arrowhead points.
      /** The arrival point as the zero-width tip mark publishes it. */
      const tip = parseRect(String(collect(edge, "data-mpd-tip")[0].props["data-mpd-tip"]))
      expect(tip.left).toBe(arrivesAtRight ? into.left + into.width : into.left)
      expect(tip.height).toBe(8)
    }
  })
})

/**
 * D1 — the layout's SHAPE as arithmetic: symmetry, zero overlaps, separated ports and the crossing band.
 *
 * Every arm reads the PURE layout rather than a picture: `layout` is the one composer, and the render
 * paints exactly what it returns (the edge arm above proves that character for character). The three
 * fixtures are the frozen contract's own acceptance set, so a change that re-tangles them reddens here.
 */
describe("team-view D1 layout: symmetric stacks, zero overlaps, separated ports", () => {
  /** The three fixtures the frozen contract names, each with the label its failure message carries. */
  const FIXTURES: Array<[string, Array<Record<string, unknown>>]> = [
    ["TASKS", TASKS], ["LONG_EDGE_TASKS", LONG_EDGE_TASKS], ["CYCLE_TASKS", CYCLE_TASKS],
  ]

  test("every column's stack is CENTRED on the graph's midline, and a one-row column keeps top = 4", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    for (const [label, fixture] of FIXTURES) {
      /** The fixture exactly as the host would serve it. */
      const served = withServed(fixture)
      /** Its geometry. */
      const graph = view.layout(served.tasks, undefined, served.model)
      // THE MIDLINE IS THE CANVAS'S OWN MIDDLE: the same pad and the same band extent above and below,
      // so `height / 2` and `centerY` are the same number. That single equality IS the symmetry claim
      // at the canvas level; the per-column loop below is the same claim at the stack level.
      expect(`${label} centerY=${graph.centerY}`).toBe(`${label} centerY=${graph.height / 2}`)
      for (let rank = 0; rank < graph.columns.length; rank += 1) {
        // AN EMPTY RANK STAYS EMPTY and has no stack to centre.
        if (graph.columns[rank].length === 0) continue
        /** The boxes this column placed. */
        const boxes = graph.nodes.filter((node) => node.rank === rank)
        /** The top of the column's stack. */
        const top = Math.min(...boxes.map((node) => node.top))
        /** The bottom of the column's stack. */
        const bottom = Math.max(...boxes.map((node) => node.top + 42))
        expect(`${label} rank ${rank} center=${top + (bottom - top) / 2}`).toBe(`${label} rank ${rank} center=${graph.centerY}`)
      }
      // A ONE-ROW BOARD KEEPS THE FROZEN TOP: with at most one box per column the midline is `pad + 21`,
      // so the single box starts at `pad` — the contract's "single-node column must still produce 4".
      if (graph.columns.every((column) => column.length <= 1)) {
        for (const node of graph.nodes) expect(`${label} ${node.task.id} top=${node.top}`).toBe(`${label} ${node.task.id} top=4`)
      }
      // AND THE GUTTERS HOLD EVERY LANE: a normal fixture never has to report an overflow.
      expect(`${label} laneOverflow=${graph.laneOverflow}`).toBe(`${label} laneOverflow=0`)
    }
  })

  test("overlaps is EMPTY on all three fixtures, no run enters a box, and the audit catches a planted pair", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    for (const [label, fixture] of FIXTURES) {
      /** The fixture exactly as the host would serve it. */
      const served = withServed(fixture)
      /** Its geometry. */
      const graph = view.layout(served.tasks, undefined, served.model)
      expect(`${label} overlaps=${JSON.stringify(graph.overlaps)}`).toBe(`${label} overlaps=[]`)
      // NO ROUTE RUN ENTERS A NODE BOX INTERIOR either — the rect half of legibility, beside the
      // painted-curve arm above (which measures the long-edge board's flattened samples).
      for (const edge of graph.edges) {
        for (const segment of edge.segments) {
          for (const node of graph.nodes) {
            /** The box exactly as the render publishes it: the layout's inset and the centred top. */
            const box = { left: node.rank * 168 + graph.inset, top: node.top, width: 168 - graph.inset * 2, height: 42 }
            expect(`${label} ${edge.witness} ${segment.key} enters ${node.task.id}=${entersInterior(segment.rect, box)}`).toBe(`${label} ${edge.witness} ${segment.key} enters ${node.task.id}=false`)
          }
        }
      }
    }
    // POSITIVE CONTROL — the audit is fed a DELIBERATELY overlapping pair: two real edges, with one run
    // moved onto the other's. Without this the three empty lists above could be the output of an audit
    // that never compares anything. Both orientations are exercised, so neither half is untested.
    /** The long-edge board's geometry, whose first two edges supply well-formed witnesses. */
    const served = withServed(LONG_EDGE_TASKS)
    /** That geometry. */
    const graph = view.layout(served.tasks, undefined, served.model)
    /** The first real edge, which the planted pair reuses for its identity. */
    const first = graph.edges[0]
    /** The second real edge. */
    const second = graph.edges[1]
    /** Two edges sharing 20px of one horizontal run. */
    const horizontal = [
      { ...first, segments: [{ key: "out", rect: { left: 10, top: 20, width: 40, height: 1 } }] },
      { ...second, segments: [{ key: "out", rect: { left: 30, top: 20, width: 40, height: 1 } }] },
    ]
    /** What the audit reports for that pair. */
    const horizontalFound = view.overlapAudit(horizontal)
    expect(horizontalFound.length).toBe(1)
    expect(`${horizontalFound[0].orientation} at=${horizontalFound[0].at} overlap=${horizontalFound[0].overlap}`).toBe("horizontal at=20 overlap=20")
    expect(`${horizontalFound[0].a}|${horizontalFound[0].b}`).toBe(`${first.witness}|${second.witness}`)
    /** Two edges sharing 15px of one vertical run. */
    const vertical = [
      { ...first, segments: [{ key: "riser", rect: { left: 50, top: 10, width: 1, height: 30 } }] },
      { ...second, segments: [{ key: "riser", rect: { left: 50, top: 25, width: 1, height: 30 } }] },
    ]
    /** What the audit reports for the vertical pair. */
    const verticalFound = view.overlapAudit(vertical)
    expect(verticalFound.length).toBe(1)
    expect(`${verticalFound[0].orientation} at=${verticalFound[0].at} overlap=${verticalFound[0].overlap}`).toBe("vertical at=50 overlap=15")
  })

  test("a node with several edges gets DISTINCT ports ordered by counterpart y, and distinct lanes", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The long-edge board exactly as the host would serve it. */
    const served = withServed(LONG_EDGE_TASKS)
    /** Its geometry. */
    const graph = view.layout(served.tasks, undefined, served.model)
    /** Every edge T2 originates, which is the most crowded port set on this board. */
    const fromT2 = graph.edges.filter((edge) => edge.parent === "T2")
    expect(fromT2.length).toBe(3)
    /** T2's box, whose middle the three ports spread about. */
    const t2 = graph.nodes.find((node) => node.task.id === "T2") as { top: number }
    /** The departure y of each of T2's edges, keyed by the dependant it reaches. */
    const portOfChild = new Map(fromT2.map((edge) => [edge.child, edge.curve.points[0].y]))
    // THREE DISTINCT PORT YS, each INSIDE the node's own height — the attachment contract.
    expect(new Set(portOfChild.values()).size).toBe(3)
    for (const port of portOfChild.values()) {
      expect(port).toBeGreaterThan(t2.top)
      expect(port).toBeLessThan(t2.top + 42)
    }
    // ORDERED BY THE COUNTERPART'S Y: T7 is the topmost dependant, then T11, then T9 — so their ports
    // ascend in exactly that order, with the middle port on the border middle.
    expect(portOfChild.get("T7") as number).toBeLessThan(portOfChild.get("T11") as number)
    expect(portOfChild.get("T11") as number).toBeLessThan(portOfChild.get("T9") as number)
    expect(portOfChild.get("T11") as number).toBe(t2.top + 21)
    // AND DISTINCT LANES: each of those three hops stands in its own gutter column, which its first
    // riser's x publishes — a shared x with overlapping y is exactly the collinear run the audit bans.
    const lanes = fromT2.map((edge) => (edge.segments.find((segment) => segment.key === "riser") as { rect: Rect }).rect.left)
    expect(new Set(lanes).size).toBe(lanes.length)
    // A SINGLE-INCIDENT NODE HAS NO SPREAD: it attaches at the border middle plus its COLUMN'S
    // parity channel (D1's anti-collinearity device) — odd pixels on even ranks, even ones on odd.
    // T11 is only ever blocked by T2 and sits in rank 1, so its arrival is the middle + 1.
    /** The one edge into T11. */
    const onlyT11 = graph.edges.find((edge) => edge.child === "T11") as GraphGeometry["edges"][number]
    /** T11's box. */
    const t11 = graph.nodes.find((node) => node.task.id === "T11") as { top: number }
    expect(onlyT11.curve.points[onlyT11.curve.points.length - 1].y).toBe(t11.top + 22)
    // AND THE OTHER PARITY: T5 is a rank-0 root with exactly one incident edge (T9←T5), so its port is
    // exactly the border middle (channel 0) — together they prove the channel is per COLUMN, not a
    // global shift.
    /** The one edge out of T5. */
    const onlyT5 = graph.edges.find((edge) => edge.parent === "T5") as GraphGeometry["edges"][number]
    /** T5's box. */
    const t5 = graph.nodes.find((node) => node.task.id === "T5") as { top: number }
    expect(onlyT5.curve.points[0].y).toBe(t5.top + 21)
  })

  test("a 2-incoming fan-in arrives >=10px apart, so the two 8px arrowheads cannot overlap (D2 repair)", () => {
    // THE REPORTED DEFECT (Docker UI capture 2026-10-21): two edges into one child landed 4px apart,
    // and their 8px-tall arrowhead polygons merged into a single thick arrow. The repair widens the
    // port pitch for small fan-in; this arm pins the ARRIVAL gap and the arrowhead boxes, while the
    // property battery below still proves no horizontal run became collinear (`overlaps === []`).
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** Two roots feeding ONE child: the exact fan-in the screenshot showed on T4. */
    const board = [
      { id: "T1", subject: "first", kind: "work", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T3", subject: "second", kind: "work", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T4", subject: "join", kind: "work", status: "running", visual: "running", blockedBy: ["T1", "T3"], failedBy: [], depth: 1 },
    ]
    /** The board exactly as the host would serve it. */
    const served = withServed(board)
    /** Its geometry. */
    const graph = view.layout(served.tasks as never, undefined, served.model as never)
    /** Both arrivals at the one child. */
    const arrivals = graph.edges.filter((edge) => edge.child === "T4")
    expect(arrivals.length).toBe(2)
    /** The two arrival ys, ascending. */
    const ys = arrivals.map((edge) => edge.curve.tip.y).sort((left, right) => left - right)
    // THE TARGET: at least 10px for a 2-incoming fan-in (the shipped 4px pitch failed this).
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(10)
    // THE ARROWHEADS THEMSELVES: two 8px boxes at those tips must be disjoint, not overlapping.
    /** The two arrival markers, ordered by their top edge. */
    const heads = arrivals.map((edge) => edge.marker).sort((left, right) => left.top - right.top)
    expect(heads[0].top + heads[0].height).toBeLessThanOrEqual(heads[1].top)
    // THE D1 PARITY CHANNEL SURVIVES: the child is rank 1 (odd), so its ports attach on EVEN pixels.
    for (const edge of arrivals) expect(edge.curve.tip.y % 2).toBe(0)
    // AND THE ANTI-COLLINEARITY PROPERTY: widening the pitch must not put two runs on one y.
    expect(graph.overlaps).toEqual([])
  })

  test("rank-skipping edges cross on DISTINCT, MIRRORED band rows and never through a box", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The long-edge board exactly as the host would serve it. */
    const served = withServed(LONG_EDGE_TASKS)
    /** Its geometry. */
    const graph = view.layout(served.tasks, undefined, served.model)
    /** The rank each id was drawn in, read off the geometry's own nodes (R20). */
    const rankOf = new Map(graph.nodes.map((node) => [node.task.id, node.rank]))
    /** The edges that skip at least one rank, which the band must carry. */
    const long = graph.edges.filter((edge) => Math.abs((rankOf.get(edge.parent) ?? 0) - (rankOf.get(edge.child) ?? 0)) >= 2)
    expect(long.length).toBe(9)
    /** Each long edge's crossing row, read off its own `cross1` run. */
    const rows = long.map((edge) => (edge.segments.find((segment) => segment.key === "cross1") as { rect: Rect }).rect.top)
    // DISTINCT ROWS: two long edges sharing a row would be a collinear pair the audit above would flag.
    expect(new Set(rows).size).toBe(rows.length)
    /** The rows above the midline, ascending. */
    const above = rows.filter((row) => row < graph.centerY).sort((left, right) => left - right)
    /** The rows below the midline, ascending. */
    const below = rows.filter((row) => row > graph.centerY).sort((left, right) => left - right)
    // HALF AND HALF: the odd row goes on top, mirroring by midpoint y.
    expect(above.length).toBe(Math.ceil(rows.length / 2))
    expect(below.length).toBe(Math.floor(rows.length / 2))
    // MIRRORED ABOUT THE MIDLINE: the row nearest the boxes on each side is the same distance away, and
    // so is every following pair — the property the one-sided below-only band could not have.
    for (let index = 0; index < below.length; index += 1) {
      expect(`${graph.centerY - above[above.length - 1 - index]}`).toBe(`${below[index] - graph.centerY}`)
    }
    // AND NO CROSSING ENTERS A BOX: the row is outside every box's y range, and the run is long enough
    // to pass over at least one intermediate column — otherwise this arm would be measuring a stub.
    for (const [index, edge] of long.entries()) {
      /** That edge's crossing run. */
      const crossing = (edge.segments.find((segment) => segment.key === "cross1") as { rect: Rect }).rect
      for (const node of graph.nodes) {
        /** The box as the render publishes it. */
        const box = { left: node.rank * 168 + graph.inset, top: node.top, width: 168 - graph.inset * 2, height: 42 }
        expect(`${edge.witness} crosses ${node.task.id}=${entersInterior(crossing, box)}`).toBe(`${edge.witness} crosses ${node.task.id}=false`)
      }
      expect(crossing.top).toBe(rows[index])
    }
  })

  test("PROPERTY: a battery of generated boards has zero overlaps, no box entry and correct borders", () => {
    // THE ABSOLUTE REQUIREMENT, MEASURED OVER SHAPES RATHER THAN ONE FIXTURE. The three frozen boards
    // are kept as their own arms above; this one throws the awkward generators at the router: fan-out,
    // fan-in, diamond, chain, a flat cycle (same-rank edges), rank-skipping long edges, a rank GAP and
    // a ~20-node mixed board with a back edge. Every board is laid out BOTH ways — the depth degrade
    // and the served model — because the two rank sources produce different column shapes.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /**
     * One battery task row.
     * @param id - the task id.
     * @param depth - the explicit depth the degrade layout uses as its rank.
     * @param blockedBy - the blockers it names, all of which are on the same board.
     * @returns the row the layout consumes.
     */
    const row = (id: string, depth: number, blockedBy: string[] = []): Record<string, unknown> => ({ id, subject: id, blockedBy, depth })
    /**
     * A run of ids.
     * @param prefix - the id prefix.
     * @param count - how many ids.
     * @returns `prefix0 … prefix<count-1>`.
     */
    const ids = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => prefix + index)
    /** The battery: one entry per board shape, each a self-contained board. */
    const battery: Array<{ name: string; tasks: Array<Record<string, unknown>> }> = [
      // FAN-OUT 6→6 — the shape that defeated the first D1 router: each child takes two adjacent roots,
      // so a root's lead-out and a child's lead-in share a gutter at the same row.
      {
        name: "fan-out 6→6",
        tasks: [...ids("R", 6).map((id) => row(id, 0)), ...ids("C", 6).map((id, index) => row(id, 1, ["R" + index, "R" + ((index + 1) % 6)]))],
      },
      // FAN-IN: three sinks, each blocked by all six roots — eighteen edges and six ports per sink.
      {
        name: "fan-in 6→3",
        tasks: [...ids("R", 6).map((id) => row(id, 0)), ...ids("S", 3).map((id) => row(id, 1, ids("R", 6)))],
      },
      // FAN-IN 19→1: ONE sink with nineteen ports, which is past the four-pixel pitch's eleven and
      // exactly the documented fallback-pitch / parity-shift capacity bound.
      {
        name: "fan-in 19→1",
        tasks: [...ids("Q", 19).map((id) => row(id, 0)), row("SINK", 1, ids("Q", 19))],
      },
      // DIAMOND: two roots, two middles, one join.
      {
        name: "diamond",
        tasks: [row("A", 0), row("B", 0), row("C", 1, ["A", "B"]), row("D", 1, ["A"]), row("E", 2, ["C", "D"])],
      },
      // CHAIN: ten ranks of one node — the single-incident case at every attachment.
      {
        name: "chain 10",
        tasks: ids("N", 10).map((id, index) => row(id, index, index === 0 ? [] : ["N" + (index - 1)])),
      },
      // FLAT CYCLE: four mutual blockers at ONE depth — four same-rank edges wrapping one column.
      {
        name: "flat cycle",
        tasks: ids("K", 4).map((id, index) => row(id, 0, ["K" + ((index + 1) % 4)])),
      },
      // LONG EDGES OVER A RANK GAP: rank 1 is empty, every rank-0 node reaches rank 2 and then rank 4.
      {
        name: "long edges over a gap",
        tasks: [...ids("A", 5).map((id) => row(id, 0)), ...ids("B", 5).map((id) => row(id, 2)), row("Z", 4, ids("B", 5))],
      },
      // MIXED ~20 NODES: six roots, five middles, five deep nodes, four finals at rank 4 (rank 3 empty),
      // with long edges, a densely blocked node, and a BACK edge (a rank-0 root blocked by a rank-2 node).
      {
        name: "mixed ~20",
        tasks: [
          ...ids("R", 6).map((id) => row(id, 0)),
          ...ids("M", 5).map((id, index) => row(id, 1, ["R" + index, "R" + ((index + 2) % 6)])),
          ...ids("D", 5).map((id, index) => row(id, 2, ["M" + index, "R" + index])),
          ...ids("F", 4).map((id, index) => row(id, 4, ["D" + index, "D" + ((index + 1) % 5), "M" + index])),
          row("BACK", 0, ["D0"]),
        ],
      },
    ]
    /** Every routed edge across the battery, so the coverage floors below are measured. */
    let routed = 0
    /** How many rank-skipping edges the battery exercised. */
    let long = 0
    /** How many back edges (parent drawn to the right of its dependant). */
    let back = 0
    /** How many same-rank edges. */
    let level = 0
    /** How many nodes with more than one incident edge. */
    let crowded = 0
    for (const board of battery) {
      // BOTH RANK SOURCES: the depth degrade (which is what makes the awkward shapes reachable) and the
      // served model the live host sends.
      /** The board exactly as the host would serve it. */
      const served = withServed(board.tasks)
      /** The layouts judged for this board, degrade first. */
      const layouts: Array<{ name: string; graph: GraphGeometry }> = [
        { name: board.name + " (degrade)", graph: view.layout(board.tasks) },
        { name: board.name + " (served)", graph: view.layout(served.tasks, undefined, served.model) },
      ]
      for (const { name, graph } of layouts) {
        expect(`${name} edges=${graph.edges.length > 0}`).toBe(`${name} edges=true`)
        // ZERO OVERLAPS IS THE HARD REQUIREMENT, and the audit is the measurement.
        expect(`${name} overlaps=${JSON.stringify(graph.overlaps)}`).toBe(`${name} overlaps=[]`)
        /** The node each id was drawn as. */
        const nodeOf = new Map(graph.nodes.map((node) => [node.task.id, node]))
        /** How many incident edges each node carries, for the crowded-node floor. */
        const incident = new Map<string, number>()
        for (const edge of graph.edges) {
          routed += 1
          /** The blocker's box. */
          const parent = nodeOf.get(edge.parent)
          /** The dependant's box. */
          const child = nodeOf.get(edge.child)
          if (parent === undefined || child === undefined) throw new Error(`${name}: ${edge.witness} names a task the layout did not place`)
          incident.set(edge.parent, (incident.get(edge.parent) ?? 0) + 1)
          incident.set(edge.child, (incident.get(edge.child) ?? 0) + 1)
          /** Whether the dependency runs downhill, which is the ordinary case. */
          const forward = parent.rank <= child.rank
          /** Whether both ends sit in one column. */
          const sameColumn = parent.rank === child.rank
          /** The border the route must LEAVE: the blocker's right when forward/level, its left otherwise. */
          const leaveX = forward ? parent.rank * 168 + 168 - graph.inset : parent.rank * 168 + graph.inset
          // The level route leaves the right border too, which `forward` already covers.
          /** The border it must ARRIVE at: the dependant's right for a level/back edge, its left otherwise. */
          const arriveX = sameColumn || !forward ? child.rank * 168 + 168 - graph.inset : child.rank * 168 + graph.inset
          /** The route's first vertex. */
          const start = edge.curve.points[0]
          /** Its last vertex, which IS the tip. */
          const end = edge.curve.points[edge.curve.points.length - 1]
          // ATTACHMENT ON THE CORRECT BORDER, and INSIDE the box it names (a port, not empty space).
          expect(`${name} ${edge.witness} leaveX=${start.x}`).toBe(`${name} ${edge.witness} leaveX=${leaveX}`)
          expect(`${name} ${edge.witness} arriveX=${end.x}`).toBe(`${name} ${edge.witness} arriveX=${arriveX}`)
          expect(`${name} ${edge.witness} startInside=${start.y > parent.top && start.y < parent.top + 42}`).toBe(`${name} ${edge.witness} startInside=true`)
          expect(`${name} ${edge.witness} endInside=${end.y > child.top && end.y < child.top + 42}`).toBe(`${name} ${edge.witness} endInside=true`)
          // NO ROUTE RUN ENTERS A BOX INTERIOR: every rect against every box, by arithmetic.
          for (const segment of edge.segments) {
            for (const node of graph.nodes) {
              /** The box as the render publishes it. */
              const box = { left: node.rank * 168 + graph.inset, top: node.top, width: 168 - graph.inset * 2, height: 42 }
              expect(`${name} ${edge.witness} ${segment.key} enters ${node.task.id}=${entersInterior(segment.rect, box)}`).toBe(`${name} ${edge.witness} ${segment.key} enters ${node.task.id}=false`)
            }
          }
          // COVERAGE COUNTERS, accumulated so the floors below prove the battery had teeth.
          if (Math.abs(parent.rank - child.rank) >= 2) long += 1
          if (!forward) back += 1
          if (sameColumn) level += 1
        }
        for (const count of incident.values()) if (count > 1) crowded += 1
      }
    }
    // NON-VACUITY FLOORS: the battery must carry a real load and every route class must appear at
    // least once, or "zero overlaps" could be the audit of a graph the router never drew.
    expect(routed).toBeGreaterThan(100)
    expect(long).toBeGreaterThan(0)
    expect(back).toBeGreaterThan(0)
    expect(level).toBeGreaterThan(0)
    expect(crowded).toBeGreaterThan(0)
  })

  test("R20's served ranks and the radius-0 curve control are unchanged by the new routing", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // R20 — THE RANKS ARE THE HOST'S: this board's every served depth is 0 and its references resolve,
    // so a client that re-derived would collapse it to one column. It draws five, in the core's order.
    /** The board exactly as the host would serve it. */
    const served = withServed(WEB_DERIVED_TASKS)
    /** Its geometry. */
    const graph = view.layout(served.tasks, undefined, served.model)
    expect(graph.ranksDerived).toBe(true)
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([
      ["T1", "T2", "T3", "T4", "T5"], ["T6"], ["T7", "T9"], ["T8"], ["T10"],
    ])
    // W6 — THE BYTE-EXACT CONTROL PATH: `curveOf` is untouched by the routing change, so the frozen
    // four-vertex route still collapses to the exact `M`/`L` string the contract pins.
    /** The contract's frozen control waypoints. */
    const waypoints = [{ x: 164, y: 25 }, { x: 168, y: 25 }, { x: 168, y: 77 }, { x: 172, y: 77 }]
    expect(view.curveOf(waypoints, 0).d).toBe("M 164 25 L 168 25 L 168 77 L 172 77")
    // AND THE RADIUS ECHOES ON EVERY ROUTED EDGE, so the control is observable in the layout itself.
    for (const edge of graph.edges) expect(edge.curve.radius).toBe(6)
  })
})

/**
 * THE WEB PLANE'S OWN R20 BOARD — and the fixture that catches what the earlier arm could not.
 *
 * The board the captain measured green before this port was the REPAIRED RECORD: its stored depths had
 * been rewritten, so the view's `task.depth` bucketing happened to agree with the graph. This fixture
 * removes that accident: every reference RESOLVES, and every served `depth` is 0 — the lie the store
 * served on our live board, with the ordinals replaced by real ids.
 */
const WEB_DERIVED_TASKS = [
  { id: "T1", subject: "freeze the contract", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T2", subject: "the layout", kind: "work", status: "running", visual: "running", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T3", subject: "the panels", kind: "work", status: "running", visual: "running", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T4", subject: "the redesign", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T5", subject: "the invisible panel", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
  { id: "T6", subject: "wire the panels", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2"], failedBy: [], depth: 0 },
  { id: "T7", subject: "verification", kind: "review", status: "open", visual: "blocked", blockedBy: ["T2", "T3", "T4", "T6"], failedBy: [], depth: 0 },
  { id: "T8", subject: "fidelity", kind: "review", status: "open", visual: "blocked", blockedBy: ["T7"], failedBy: [], depth: 0 },
  { id: "T9", subject: "docs", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2", "T3", "T4", "T5", "T6"], failedBy: [], depth: 0 },
  { id: "T10", subject: "integration", kind: "integration", status: "open", visual: "blocked", blockedBy: ["T7", "T8", "T9"], failedBy: [], depth: 0 },
]

describe("team-view R20 (Amendment 3): the web plane RENDERS the host's ranks and derives nothing", () => {
  test("a board whose references RESOLVE and whose every served depth is 0 draws FIVE columns, not one", () => {
    // THE ARM THE EARLIER VERIFICATION LACKED, re-pointed by Amendment 3. Before R20 the view bucketed
    // by `task.depth`, so this board — all zeros — collapsed to ONE column with no edges, which is the
    // user's photograph. R20 then fixed it by DUPLICATING the TUI's rank walk inside this factory body;
    // Amendment 3 deletes that duplicate and the HOST (`mpd-team-core-plugin`, via `mpd-graph-core`)
    // serves the ranks. This arm now proves the view DRAWS the served ranks: the fixture is stamped by
    // the shared core through `withServed`, so a view that re-derived — or ignored the payload — fails.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The board exactly as the host would serve it, plus the merge report it would carry. */
    const served = withServed(WEB_DERIVED_TASKS)
    /** The geometry of that served board. */
    const graph = view.layout(served.tasks, undefined, served.model)
    expect(graph.ranksDerived).toBe(true)
    expect(graph.rankCount).toBe(5)
    expect(graph.rankCount).not.toBe(1)
    // The ranks are the longest resolving blocker chain: five roots, then T6, then T7/T9, then T8, then
    // T10 — read off the COLUMNS, which is what the render draws left to right.
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([
      ["T1", "T2", "T3", "T4", "T5"], ["T6"], ["T7", "T9"], ["T8"], ["T10"],
    ])
    // And the drawing is not merely sorted differently: the nodes carry those ranks, which is what every
    // edge's geometry is computed from.
    expect(graph.nodes.map((node) => [node.task.id, node.rank])).toEqual([
      ["T1", 0], ["T2", 0], ["T3", 0], ["T4", 0], ["T5", 0],
      ["T6", 1], ["T7", 2], ["T9", 2], ["T8", 3], ["T10", 4],
    ])
    expect(graph.unresolved).toEqual([])
  })

  test("the served report's two arms are SURFACED, not re-decided here", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // ARM A — A GENUINELY FLAT BOARD: the CORE reports it as derived (nothing resolves and the depths do
    // not vary, so its own fallback does not fire), and the drawing says exactly that.
    /** The core's served answer for two independent roots. */
    const flatServed = withServed([{ id: "A", depth: 0 }, { id: "B", depth: 0 }])
    /** The geometry of that served board. */
    const flat = view.layout(flatServed.tasks, undefined, flatServed.model)
    expect(flat.rankCount).toBe(1)
    expect(flat.ranksDerived).toBe(true)
    // ARM B — NOTHING RESOLVES AND THE SERVED DEPTHS VARY: the CORE's own fallback fires, reports
    // `derived: false` and hands the unresolved ids on; the view surfaces both and decides neither.
    /** The core's served answer for ghost references whose depths claim two ranks. */
    const ghostServed = withServed([{ id: "A", depth: 0, blockedBy: ["Z"] }, { id: "B", depth: 1, blockedBy: ["Y"] }])
    /** The geometry of that served board. */
    const ghosts = view.layout(ghostServed.tasks, undefined, ghostServed.model)
    expect(ghosts.ranksDerived).toBe(false)
    expect(ghosts.rankCount).toBe(2)
    expect(ghosts.unresolved).toEqual(["Y", "Z"])
    // THE DEGRADE, on the SAME board with NO served model (an older server): it lays out from `depth`,
    // and `ranksDerived`/`unresolved` degrade WITH it — coherent, rather than looking like a model that
    // lost its report. The absence of `model` on the payload is the one signal the component forwards.
    /** The same board with no model, i.e. the older-server payload. */
    const degraded = view.layout([{ id: "A", depth: 0, blockedBy: ["Z"] }, { id: "B", depth: 1, blockedBy: ["Y"] }])
    expect(degraded.ranksDerived).toBe(false)
    expect(degraded.rankCount).toBe(2)
    expect(degraded.unresolved).toEqual([])
  })

  test("R21: the host's unresolved references are SURFACED with their ids, never silently dropped", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // The MEASURED record, verbatim: ids T1..T10 and `blockedBy` holding plan ordinals. Not one
    // reference resolves, so the board is genuinely flat — and now the HOST says why (the core's
    // `report.unresolved`) instead of the view drawing a one-column picture that looks healthy.
    /** The record as it sits on disk. */
    const ordinals = [
      { id: "T1", depth: 0, blockedBy: [] }, { id: "T2", depth: 0, blockedBy: [] }, { id: "T3", depth: 0, blockedBy: [] },
      { id: "T4", depth: 0, blockedBy: [] }, { id: "T5", depth: 0, blockedBy: [] },
      { id: "T6", depth: 0, blockedBy: ["2"] }, { id: "T7", depth: 0, blockedBy: ["2", "3", "4", "6"] },
      { id: "T8", depth: 0, blockedBy: ["7"] }, { id: "T9", depth: 0, blockedBy: ["2", "3", "4", "5", "6"] },
      { id: "T10", depth: 0, blockedBy: ["7", "8", "9"] },
    ]
    /** The record exactly as the host would serve it, plus the core's report. */
    const served = withServed(ordinals)
    /** The geometry of that served record. */
    const graph = view.layout(served.tasks, undefined, served.model)
    expect(graph.unresolved).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"])
    expect(graph.rankCount).toBe(1)
    expect(graph.edges.length).toBe(0)
    // A MIXED BOARD SEPARATES THE TWO FACTS: the reference that resolves draws, the ghost is reported.
    /** One drawable blocker and one ghost on the same task, as the host would serve them. */
    const mixedServed = withServed([{ id: "P", depth: 0 }, { id: "C", depth: 0, blockedBy: ["P", "GHOST"] }])
    /** The geometry of that served board. */
    const mixed = view.layout(mixedServed.tasks, undefined, mixedServed.model)
    expect(mixed.unresolved).toEqual(["GHOST"])
    expect(mixed.edges.length).toBe(1)
    expect(mixed.rankCount).toBe(2)
  })

  test("the hover halo measures the DRAWN ranks, so a lying depth cannot kill the highlight", () => {
    // The second site that trusted the lie: the chain's monotone guard compared served depths, so on this
    // all-zero board EVERY hop was pruned (`0 >= 0`) and a hover lit one node while dimming the rest.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The board exactly as the host would serve it — the ranks are the shared core's. */
    const served = withServed(WEB_DERIVED_TASKS)
    /** The geometry of that served board, which is where the halo's ranks come from. */
    const graph = view.layout(served.tasks, undefined, served.model)
    /** The drawn rank of every task. */
    const rankOf: Record<string, number> = {}
    for (const node of graph.nodes) rankOf[node.task.id] = node.rank
    // The columns prove the relation the halo needs: T10 rests on T7/T8/T9, each of which is drawn ABOVE
    // it, so an upstream walk from T10 has somewhere to go.
    expect(rankOf.T7).toBeLessThan(rankOf.T10)
    expect(rankOf.T8).toBeLessThan(rankOf.T10)
    expect(rankOf.T9).toBeLessThan(rankOf.T10)
    expect(rankOf.T2).toBeLessThan(rankOf.T7)
  })
})

describe("Amendment 3's discriminating fixture: the SERVED rank decides the column, the depth does not", () => {
  // THE FIXTURE LANE E RUNS TOO, and the one this lane's before/after is measured on: `T2` is blocked by
  // `T3`, so the shared core ranks `T3` 0 and `T2` 1 — while the record's served depths say the exact
  // opposite (`T2` 0, `T3` 1). A client that trusts `depth` draws T2 in the first column; a client that
  // renders the served model draws T2 in the SECOND. That move is the whole contract in one assertion.
  test("the columns MOVE to the derived ranks, and each drawn box publishes the rank it got", async () => {
    /** A board whose served depths disagree with the dependency graph. */
    const board = [
      { id: "T1", depth: 0, blockedBy: [], failedBy: [] },
      { id: "T2", depth: 0, blockedBy: ["T3"], failedBy: [] },
      { id: "T3", depth: 1, blockedBy: [], failedBy: [] },
    ]
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // BEFORE — no model on the payload (the older-server degrade): `depth` decides, so T2 sits LEFT of T3.
    /** The bare layout, which is what an older server's payload produces. */
    const degraded = view.layout(board)
    expect(degraded.columns.map((column) => column.map((task) => task.id))).toEqual([["T1", "T2"], ["T3"]])
    expect(degraded.ranksDerived).toBe(false)
    // AFTER — the host's model: the CORE's derivation decides, so T2 crosses into the second column.
    /** The board exactly as the host would serve it. */
    const served = withServed(board)
    expect(servedOf(board).ranks).toEqual({ T1: 0, T2: 1, T3: 0 })
    /** The geometry of the served board. */
    const graph = view.layout(served.tasks, undefined, served.model)
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([["T1", "T3"], ["T2"]])
    expect(graph.nodes.map((node) => [node.task.id, node.rank])).toEqual([["T1", 0], ["T3", 0], ["T2", 1]])
    expect(graph.ranksDerived).toBe(true)
    // AND THE RENDER CARRIES IT: the rendered payload goes through the same served fixture, and every
    // box publishes the rank it was DRAWN in — the vehicle a verifier can measure without inverting
    // `data-mpd-box`'s x coordinate.
    /** The settled render of the served board. */
    const { tree } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** The drawn rank of every rendered node, as the box publishes it. */
    const boxRank: Record<string, string> = {}
    for (const node of collect(tree, "data-mpd-node")) boxRank[String(node.props["data-mpd-node"])] = String(node.props["data-mpd-box-rank"])
    expect(boxRank).toEqual({ T1: "0", T2: "1", T3: "0" })
  })
})

describe("Amendment 3's plan contribution: plan-only GHOSTS and plan-declared edges are DRAWN", () => {
  // THE USER'S REQUIREMENT, ON THE WEB SIDE: "改 task plan 就可以实时调整工程". The plan's unique
  // contribution to the picture is exactly what the board does not carry — a task only the plan
  // declares, and a dependency only the plan declares. If the web drew the board alone, that edit
  // would show on the TUI and not here, which is the split this wave exists to end.
  test("a ghost is a box in the EXISTING open tone, and a plan-declared edge is routed", async () => {
    /** A board with two independent tasks: no ghosts, no edges of its own. */
    const board = [
      { id: "T1", subject: "board work", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "board review", kind: "review", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
    ]
    /** A plan that declares a GHOST (T9) and an edge the board does not carry (T2 blocked by T1). */
    const plan: PlanDocument = {
      tasks: [
        { id: "T9", title: "plan-only work", section: "todo", line: 3, blockedBy: [] },
        { id: "T2", title: "board review", section: "todo", line: 7, blockedBy: ["T1"] },
      ],
      lanes: [],
      problems: [],
    }
    /** The board exactly as the host would serve it, with the plan merged in. */
    const served = withServed(board, plan)
    // THE CORE'S REPORT PROVES THE INPUT REACHED THE MODEL: one ghost id, one plan-only edge.
    expect(served.model.report.planOnly).toEqual(["T9"])
    expect(served.model.report.edgePlanOnly.map((edge) => [edge.from, edge.to])).toEqual([["T1", "T2"]])
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The geometry of the merged model. */
    const graph = view.layout(served.tasks, undefined, served.model)
    // THE GHOST IS A BOX (at the rank the host served), and the plan's edge is ROUTED.
    expect(graph.nodes.map((node) => node.task.id).sort()).toEqual(["T1", "T2", "T9"])
    expect(graph.edges.map((edge) => edge.witness).sort()).toEqual(["T2<-T1"])
    /** The ghost's own drawn entry, which carries the planned visual. */
    const ghost = graph.nodes.find((node) => node.task.id === "T9")
    expect(ghost?.task.visual).toBe("planned")
    // AND THE RENDER CARRIES BOTH: the ghost box publishes its planned marker, the edge is painted,
    // and the ghost's border is the SAME colour a board `open` task draws — no new tone was invented.
    /** The settled render of the merged model. */
    const { tree } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board, {}, [], plan) } } })
    /** The ghost's rendered box. */
    const ghostBox = one(tree, "data-mpd-node", "T9")
    expect(ghostBox.props["data-mpd-planned"]).toBe("true")
    one(tree, "data-mpd-edge", "T2<-T1")
    /** A board task in the ordinary open state, for the tone comparison. */
    const openBox = one(tree, "data-mpd-node", "T1")
    expect(styleOf(ghostBox, "borderColor")).toBe(styleOf(openBox, "borderColor"))
  })
})

describe("R18's reader side: the RECORD's own unresolved report, beside the SERVED one", () => {
  test("the served `unresolvedBlockers` reaches the geometry, and is reported AS the record's", () => {
    // THE SHAPE IS NOT INVENTED: `evidence/tui/dag-port/web-dag/20261006T143500Z/producer-shape.mts`
    // mints these very objects with the producer's own `addTeamTask`/`resolveBlockers`, which store the
    // entries that resolved in `blockedBy` — unresolvable ones INCLUDED, verbatim — and the ones that
    // matched nothing, de-duplicated, in `unresolvedBlockers`. Measured there:
    //   {"id":"T2",…,"blockedBy":["T1","ghost-7"],…,"unresolvedBlockers":["ghost-7"]}
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The producer's own shape: one blocker that resolves, one that names nothing. */
    const board = [
      { id: "T1", depth: 0, blockedBy: [], failedBy: [] },
      { id: "T2", depth: 1, blockedBy: ["T1", "ghost-7"], failedBy: [], unresolvedBlockers: ["ghost-7"] },
    ]
    /** The geometry of that board. */
    const graph = view.layout(board)
    expect(graph.unresolved).toEqual(["ghost-7"])
    expect(graph.unresolvedRecorded).toEqual(["ghost-7"])
    // The two sources agree here, which is the state a board written by the current producer is in.
    expect(graph.edges.length).toBe(1)
    expect(graph.rankCount).toBe(2)
  })

  test("a REPAIRED board still reports what the record said: the reader sees more than the served scan", () => {
    // THE CASE ONLY THE READER CAN SEE, and the live board is exactly it: `blockedBy` was rewritten to
    // real ids after the fact, so the served references now ALL resolve and the CORE's report finds
    // nothing. The record still remembers what did not resolve when it was written, and a viewer must
    // not be told the board is clean.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** A board whose references were repaired while the record's own report was kept. */
    const repaired = [
      { id: "T1", depth: 0, blockedBy: [], failedBy: [] },
      { id: "T2", depth: 1, blockedBy: ["T1"], failedBy: [], unresolvedBlockers: ["2", "6"] },
    ]
    /** The board as the host would serve it, plus the core's (clean) report. */
    const served = withServed(repaired)
    /** The geometry of the repaired board. */
    const graph = view.layout(served.tasks, undefined, served.model)
    // The HOST's report sees a clean board: every served reference resolves…
    expect(served.model.report.unresolved).toEqual([])
    expect(graph.unresolvedRecorded).toEqual(["2", "6"])
    // …and the record's own report STILL reaches the reader, beside it.
    expect(graph.unresolved).toEqual(["2", "6"])
    expect(graph.ranksDerived).toBe(true)
  })

  test("an ABSENT key means this task HAS no blockers, not that its blockers were lost", () => {
    // The producer omits `unresolvedBlockers` when everything resolved — measured in `producer-shape.mts`,
    // where the clean task carries no such key at all. That absence is the distinction the field exists
    // for, so the reader must not turn it into a report.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** A board with no unresolved facts anywhere. */
    const clean = view.layout([{ id: "T1", depth: 0, blockedBy: [], failedBy: [] }, { id: "T2", depth: 1, blockedBy: ["T1"], failedBy: [] }])
    expect(clean.unresolved).toEqual([])
    expect(clean.unresolvedRecorded).toEqual([])
  })

  test("the pinned detail body NAMES the record's unresolved references, beside blocked-by and dependents", async () => {
    // R19's other half, on the same surface: the detail body already names what the task UNLOCKS (its
    // dependents), and it now also names what the RECORD could not resolve.
    /** The fixture board, with one repaired-but-recorded task and one dependent of it. */
    const board = [
      { id: "T1", subject: "first", kind: "work", status: "open", visual: "open", owner: "web-team-gui", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "second", kind: "work", status: "open", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1, unresolvedBlockers: ["2", "6"] },
      { id: "T3", subject: "third", kind: "work", status: "open", visual: "blocked", blockedBy: ["T2"], failedBy: [], depth: 2 },
    ]
    /** The settled render of that board, plus the handles a node's handler needs. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    // Open T2's body the way a reader does: a click on its node, then the re-render the hook runtime
    // performs after the state it set lands.
    ;(one(rendered.tree, "data-mpd-node", "T2").props.onClick as () => void)()
    /** The tree with T2 pinned. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** T2's detail body. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T2"))
    // WHAT IT UNLOCKS (R19): T3 rests on it, so the dependents row names T3.
    expect(detail).toContain("dependents T3")
    // AND WHAT THE RECORD COULD NOT RESOLVE (R18): the two references, named rather than dropped.
    expect(detail).toContain("unresolved blockers 2, 6")
    // A task with no recorded report renders NO such row, so the absence stays an absence.
    ;(one(pinned, "data-detail-close", "T2").props.onClick as () => void)()
    /** The tree with T2 closed again. */
    const closed = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    ;(one(closed, "data-mpd-node", "T1").props.onClick as () => void)()
    /** The tree with T1 pinned, which carries no unresolved report. */
    const clean = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(flatText(one(clean, "data-mpd-detail", "T1"))).not.toContain("unresolved blockers")
  })
})

/**
 * D2's fixture: a completed task with BOTH stamps, a running dependant, and a blocked dependant.
 *
 * The shapes are chosen so ONE board proves every D2 claim: `T1 -> T2` is the completed -> running
 * edge (the one moving arrow), `T1 -> T3` is a completed -> blocked edge (which must stay static),
 * `T1` owns a deterministic 1m 5s elapsed span, `T3` has no owner (the "unassigned" fallback), and
 * the served progress values exercise both ends of the clamp.
 */
const VISUAL_TASKS = [
  { id: "T1", subject: "Freeze the acceptance contract and publish the frozen text for every lane", kind: "requirement", status: "completed", visual: "completed", owner: "web-team-gui", attempt: 1, blockedBy: [], failedBy: [], depth: 0, startedAt: "2026-10-21T10:00:00.000Z", finishedAt: "2026-10-21T10:01:05.000Z", progress: 100 },
  { id: "T2", subject: "Build the hover card", kind: "work", status: "running", visual: "running", owner: "web-dag", blockedBy: ["T1"], failedBy: [], depth: 1, startedAt: "2026-10-21T10:02:00.000Z", progress: 50 },
  { id: "T3", subject: "Blocked child", kind: "review", status: "open", visual: "blocked", blockedBy: ["T1"], failedBy: [], depth: 1, progress: 140 },
]

describe("team-view D2: the scoped stylesheet and the frosted node", () => {
  test("renders ONE stylesheet at the panel root, outside the graph, with the contracted material", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    /** Every stylesheet marker in the tree, so a second one is a failure rather than a silent pass. */
    const sheets = collect(rendered.tree, "data-mpd-dag-css")
    expect(sheets.length).toBe(1)
    expect(sheets[0].props["data-mpd-dag-css"]).toBe("1")
    /** The stylesheet's own text. */
    const css = flatText(sheets[0])
    // THE GLASS: a real backdrop filter, a translucent white/host-token GRADIENT with an opaque
    // host-token fallback before it, an inset top highlight, a soft outer shadow, the exact
    // transition the contract names, and dark text.
    expect(css).toContain("backdrop-filter: blur(14px) saturate(1.25)")
    expect(css).toContain("background: var(--dsw-alias-bg-layer-1, #ffffff)")
    expect(css).toContain("background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.62) 55%, rgba(238,243,251,.58) 100%)")
    expect(css).toContain("inset 0 1px 0 rgba(255,255,255,.95)")
    expect(css).toContain("0 6px 18px rgba(16,24,40,.12)")
    expect(css).toContain("transition: transform 420ms cubic-bezier(.2,.8,.2,1), opacity 200ms, border-color 200ms, box-shadow 200ms;")
    expect(css).toContain("will-change: transform;")
    expect(css).toContain("border: 0.5px solid")
    expect(css).toContain("color: #111827")
    // THE BREATHING: a keyframe + the running selector that uses it, edge glow only. The glow is
    // deliberately STRONG on a white page: a 9px spread at .32 alpha plus a .90 ring in the crest.
    expect(css).toContain("@keyframes mpd-dag-breathe")
    expect(css).toContain('.mpd-dag-node[data-visual="running"] { animation: mpd-dag-breathe')
    expect(css).toContain("0 0 0 9px rgba(77,107,254,.32)")
    expect(css).toContain("0 0 0 2px rgba(77,107,254,.90)")
    // THE CARD: translucent white, black text, the pinned override.
    expect(css).toContain("rgba(255,255,255,.78)")
    expect(css).toContain("color: #111;")
    expect(css).toContain('.mpd-dag-tip[data-pinned="true"] { background: #ffffff')
    expect(css).toContain("pointer-events: none")
    // THE DASH-FLOW keyframe and the reduced-motion block. The draw-in is deliberately GONE: it
    // depended on `pathLength`, which crushed the 6px dash pattern (Docker 2026-10-21).
    expect(css).toContain("@keyframes mpd-dag-dash")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    // THE SMIL OVERLAY IS HIDDEN TOO (CodeRabbit a11y repair): a media query can stop a CSS
    // animation, but it cannot stop an SVG `animateMotion`, so the block hides the overlay group.
    // Slicing from the query proves the rule lives INSIDE the media block, not elsewhere in the sheet.
    /** The reduced-motion block's own text, from the query to the end of the stylesheet. */
    const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"))
    expect(reducedMotion).toContain("[data-mpd-flow] { display: none; }")
    // ONLY the moving overlay goes: the static dependency path and its arrowhead stay visible.
    expect(reducedMotion).not.toContain("[data-mpd-curve]")
    expect(reducedMotion).not.toContain("[data-mpd-head]")
    expect(css).not.toContain("mpd-dag-draw")
    // ASCII ONLY, so the stylesheet cannot smuggle a full-width codepoint into the drawing's page.
    expect(/[^\x00-\x7F]/.test(css)).toBe(false)
    // OUTSIDE THE GRAPH SUBTREE: the graph's own descendants carry no stylesheet, so the CJK-free
    // drawing region and the stylesheet's carrier are disjoint by construction.
    const graph = one(rendered.tree, "data-mpd-graph", "ranks=2 edges=2")
    expect(collect(graph, "data-mpd-dag-css").length).toBe(0)
  })

  test("every node carries the glass class, its rendered state, and a translate3d position", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    /** The rendered tree. */
    const tree = rendered.tree
    /** One node element by id. */
    const nodeOf = (id: string): ElementNode => one(tree, "data-mpd-node", id)
    // THE VISUAL MARKERS: what the stylesheet's breathing selector keys on.
    expect(nodeOf("T1").props["data-visual"]).toBe("completed")
    expect(nodeOf("T2").props["data-visual"]).toBe("running")
    expect(nodeOf("T3").props["data-visual"]).toBe("blocked")
    for (const id of ["T1", "T2", "T3"]) expect(nodeOf(id).props.className).toBe("mpd-dag-node")
    // THE GEOMETRY IS STILL THE LAYOUT'S: the box is published in LAYOUT coordinates, and the inline
    // style moves the SAME numbers through `translate3d`, which is what the transition animates.
    /** The served board, with the ranks the host would send. */
    const served = withServed(VISUAL_TASKS)
    /** The pure geometry that render drew from. */
    const graph = rendered.view.layout(served.tasks as never, 6, served.model as never)
    /** T2's own node in that geometry. */
    const placed = graph.nodes.find((node) => node.task.id === "T2") as { rank: number; top: number }
    /** T2's painted element. */
    const painted = nodeOf("T2")
    expect(parseRect(String(painted.props["data-mpd-box"]))).toEqual({ left: placed.rank * 168 + graph.inset, top: placed.top, width: 168 - graph.inset * 2, height: 42 })
    expect(styleOf(painted, "transform")).toBe("translate3d(" + graph.inset + "px," + placed.top + "px,0)")
    expect(styleOf(painted, "left")).toBe("0px")
    expect(styleOf(painted, "top")).toBe("0px")
    expect(styleOf(painted, "right")).toBe("")
    expect(styleOf(painted, "width")).toBe(168 - graph.inset * 2 + "px")
    // THE EXISTING INLINE SEMANTICS SURVIVE: an idle border is 0.5px and an unpinned node is opaque.
    expect(styleOf(painted, "borderWidth")).toBe("0.5px")
    expect(styleOf(painted, "opacity")).toBe("1")
  })
})

describe("team-view D2: the completed -> running flow overlay", () => {
  test("one overlay for a completed -> running edge, none for completed -> blocked, counts unchanged", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    /** The rendered tree. */
    const tree = rendered.tree
    /** The edge layer. */
    const layer = one(tree, "data-edges", "1")
    /** Every motion overlay in the drawing. */
    const flows = collect(tree, "data-mpd-flow")
    // EXACTLY ONE: T1 completed -> T2 running. T1 completed -> T3 blocked stays static.
    expect(flows.map((flow) => flow.props["data-mpd-flow"])).toEqual(["T2<-T1"])
    expect(collect(layer, "data-mpd-flow").length).toBe(1)
    /** The one overlay group. */
    const flow = flows[0]
    // IT CARRIES NONE OF THE COUNTED MARKS, so the one-path/one-head-per-edge counts stay edge facts.
    for (const counted of ["data-mpd-edge", "data-mpd-curve", "data-mpd-tip", "data-mpd-head"]) {
      expect(flow.props[counted]).toBeUndefined()
      expect(collect(flow, counted).length).toBe(0)
    }
    /** The overlay's arrow polygon. */
    const arrow = findFirst(flow, (candidate) => candidate.type === "polygon")
    expect(arrow).not.toBeNull()
    expect(String(arrow?.props.points)).toBe("-5,-4 5,0 -5,4")
    // THE MOTION RIDES THE SAME `d` THE EDGE DRAWS: read the pure layout, never a copy.
    /** The served board, with the ranks the host would send. */
    const served = withServed(VISUAL_TASKS)
    /** The geometry that render drew from. */
    const graph = rendered.view.layout(served.tasks as never, 6, served.model as never)
    /** The routed edge the overlay animates. */
    const routed = graph.edges.find((edge) => edge.witness === "T2<-T1") as { curve: { d: string } }
    /** The SMIL element inside the overlay. */
    const motion = findFirst(flow, (candidate) => candidate.type === "animateMotion")
    expect(motion).not.toBeNull()
    expect(motion?.props.path).toBe(routed.curve.d)
    expect(motion?.props.dur).toBe("1.6s")
    expect(motion?.props.repeatCount).toBe("indefinite")
    expect(motion?.props.rotate).toBe("auto")
    // THE MAIN PATH gets the dash-flow class; the completed -> blocked path does NOT.
    /** The children of one edge group: [curve, head]. */
    const painted = (key: string): ElementNode[] => collectByKey(layer, key)[0].props.children as ElementNode[]
    expect(String(painted("edge:T1>T2")[0].props.className)).toContain("mpd-dag-flow")
    expect(String(painted("edge:T1>T3")[0].props.className)).not.toContain("mpd-dag-flow")
    // NO `pathLength` NORMALISATION (D2 repair): it scaled the 6px dash pattern down on short edges,
    // so the flow class must be the ONLY class on the path and the attribute must be absent.
    expect(painted("edge:T1>T2")[0].props.pathLength).toBeUndefined()
    expect(String(painted("edge:T1>T2")[0].props.className)).not.toContain("mpd-dag-draw")
    // THE COUNTS AND THE PAINTED `d` ARE UNCHANGED: the overlay adds motion, never an edge.
    expect(collect(layer, "data-mpd-edge").length).toBe(2)
    expect(collect(layer, "data-mpd-curve").length).toBe(2)
    expect(collect(layer, "data-mpd-tip").length).toBe(2)
    expect(collect(layer, "data-mpd-head").length).toBe(2)
    expect(one(tree, "data-mpd-graph", "ranks=2 edges=2").props["data-mpd-graph"]).toBe("ranks=2 edges=2")
    /** The routed T1 -> T2 edge's own `d`. */
    const curve = routed.curve.d
    expect(painted("edge:T1>T2")[0].props["data-mpd-curve"]).toBe(curve)
    expect(painted("edge:T1>T2")[0].props.d).toBe(curve)
  })
})

describe("team-view D2: the hover card", () => {
  test("shows status, owner, elapsed, a truncated subject and progress, outside the graph", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    // Hover T1 at a known viewport point: the card anchors 14px below/right of it.
    ;(one(rendered.tree, "data-mpd-node", "T1").props.onMouseEnter as (event: unknown) => void)({ clientX: 40, clientY: 60 })
    /** The tree with the card open. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The one card. */
    const card = one(hovered, "data-mpd-tip-card", "1")
    // OUTSIDE THE GRAPH SUBTREE: the card is a SIBLING of the graph, which is what keeps the raw
    // subject it shows legal while the drawing stays CJK-free.
    expect(collect(one(hovered, "data-mpd-graph", "ranks=2 edges=2"), "data-mpd-tip-card").length).toBe(0)
    expect(card.props["data-pinned"]).toBe("false")
    expect(styleOf(card, "left")).toBe("54px")
    expect(styleOf(card, "top")).toBe("74px")
    /** The card's whole text. */
    const text = flatText(card)
    expect(text).toContain("status")
    expect(text).toContain("completed")
    expect(text).toContain("owner")
    expect(text).toContain("web-team-gui")
    expect(text).toContain("elapsed")
    expect(text).toContain("1m 5s")
    expect(text).toContain("progress")
    expect(text).toContain("100%")
    // THE SUBJECT IS ONE LINE WITH AN ELLIPSIS, and the FULL text stays on `title`.
    /** The card's subject element. */
    const subject = collectByKey(card, "tip-subject")[0]
    expect(String(subject.props.title)).toBe(VISUAL_TASKS[0].subject)
    expect(flatText(subject).endsWith("…")).toBe(true)
    // MOUSEMOVE FOLLOWS THE CURSOR: the same offset from the new point, still no measurement API.
    ;(one(hovered, "data-mpd-node", "T1").props.onMouseMove as (event: unknown) => void)({ clientX: 100, clientY: 120 })
    /** The tree after the pointer moved. */
    const moved = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(moved, "data-mpd-tip-card", "1"), "left")).toBe("114px")
    expect(styleOf(one(moved, "data-mpd-tip-card", "1"), "top")).toBe("134px")
  })

  test("clamps the card inside a small viewport when the host exposes one", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    /** The global scope, narrowed so the stubbed viewport can be installed and removed. */
    const scope = globalThis as { window?: unknown }
    /** The host global this case replaces, kept for the restore in the `finally`. */
    const saved = scope.window
    scope.window = { innerWidth: 300, innerHeight: 200 }
    try {
      // A pointer at (950, 500) would put the 240x104 card far outside a 300x200 viewport; the
      // clamp pins it to `width - TIP_WIDTH - TIP_OFFSET` and `height - TIP_HEIGHT - TIP_OFFSET`.
      ;(one(rendered.tree, "data-mpd-node", "T1").props.onMouseEnter as (event: unknown) => void)({ clientX: 950, clientY: 500 })
      /** The tree with the clamped card open. */
      const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
      /** The clamped card. */
      const card = one(hovered, "data-mpd-tip-card", "1")
      expect(styleOf(card, "left")).toBe("46px")
      expect(styleOf(card, "top")).toBe("82px")
    } finally {
      scope.window = saved
    }
  })

  test("a coordinate-less focus never parks the card at the viewport origin (D2 repair)", async () => {
    // THE REPORTED DEFECT (Docker UI capture 2026-10-21): clicking a node focused it, `onFocus` ran
    // `tipPoint(FocusEvent)` — which has no clientX/clientY — and the (14,14) fallback OVERWROTE the
    // pointer anchor, parking the card in the viewport's top-left corner. The repair removes the
    // focus-triggered card entirely; the keyboard path is the pin (Enter/Space opens the detail).
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    // A real pointer anchor first: (400,300) + the 14px offset.
    ;(one(rendered.tree, "data-mpd-node", "T1").props.onMouseEnter as (event: unknown) => void)({ clientX: 400, clientY: 300 })
    /** The tree with the pointer-derived card open. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(hovered, "data-mpd-tip-card", "1"), "left")).toBe("414px")
    expect(styleOf(one(hovered, "data-mpd-tip-card", "1"), "top")).toBe("314px")
    // THE FIX IS STRUCTURAL: there is no focus handler to overwrite the anchor with.
    /** The hovered node's element. */
    const node = one(hovered, "data-mpd-node", "T1")
    expect(node.props.onFocus).toBeUndefined()
    // Even if a host did deliver a FocusEvent, the anchor must not move to (14,14).
    if (typeof node.props.onFocus === "function") (node.props.onFocus as (event: unknown) => void)({ type: "focus" })
    /** The tree after the (absent) focus event. */
    const afterFocus = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(afterFocus, "data-mpd-tip-card", "1"), "left")).toBe("414px")
    expect(styleOf(one(afterFocus, "data-mpd-tip-card", "1"), "top")).toBe("314px")
    // LEAVING STILL CLOSES the card, and the pin path still opens the detail body.
    ;(one(afterFocus, "data-mpd-node", "T1").props.onMouseLeave as () => void)()
    /** The tree after the pointer left. */
    const left = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(collect(left, "data-mpd-tip-card").length).toBe(0)
  })

  test("labels the elapsed dash `not started` ONLY when the task never started (CodeRabbit repair)", async () => {
    // THE REPORTED DEFECT: `formatElapsed` dashes three different situations, and the card labelled
    // ALL of them "not started" — false for a completed task missing `finishedAt` and for a malformed
    // stamp. Only an absent/empty `startedAt` may carry the sublabel now.
    /** One completed task with a start but NO finish, one with malformed stamps, and one never started. */
    const board = [
      { id: "T1", subject: "no finish", kind: "requirement", status: "completed", visual: "completed", startedAt: "2026-10-21T10:00:00.000Z", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "malformed", kind: "requirement", status: "completed", visual: "completed", startedAt: "not-a-date", finishedAt: "also-bad", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T3", subject: "never started", kind: "work", status: "pending", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1 },
    ]
    /** The settled render of that board. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** The current tree, advanced after every hover so the next handler is fresh. */
    let tree = rendered.tree
    /**
     * Hover one node and answer its elapsed row.
     * @param id - the node to hover.
     * @returns the card's elapsed row element.
     */
    const elapsedRowOf = async (id: string): Promise<ElementNode> => {
      ;(one(tree, "data-mpd-node", id).props.onMouseEnter as (event: unknown) => void)({ clientX: 10, clientY: 10 })
      tree = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
      return collectByKey(one(tree, "data-mpd-tip-card", "1"), "tip-elapsed")[0]
    }
    // (b) STARTED, NO FINISH: the dash is honest, but the task clearly started — no sublabel.
    /** T1's elapsed row. */
    const noFinish = await elapsedRowOf("T1")
    expect(flatText(noFinish)).toContain("elapsed -")
    expect(flatText(noFinish)).not.toContain("not started")
    expect(noFinish.props.title).toBeUndefined()
    // (c) MALFORMED START: a start exists, so the dash stays and the sublabel stays away.
    /** T2's elapsed row. */
    const malformed = await elapsedRowOf("T2")
    expect(flatText(malformed)).toContain("elapsed -")
    expect(flatText(malformed)).not.toContain("not started")
    expect(malformed.props.title).toBeUndefined()
    // (a) NO START: this is the one case the sublabel describes.
    /** T3's elapsed row. */
    const never = await elapsedRowOf("T3")
    expect(flatText(never)).toContain("elapsed -")
    expect(never.props.title).toBe("not started")
  })

  test("a legacy payload's progress falls back to STATUS, so claimed is 10 and in_progress 50 (CodeRabbit repair)", async () => {
    // THE REPORTED DEFECT: a legacy payload has no `progress`, and `claimed` DRAWS as running — the
    // old visual-only fallback reported 50 for work nobody had started. The fallback now reads the
    // record's status first (completed 100, in_progress 50, claimed 10, pending/blocked/failed/
    // cancelled 0); only an absent/unknown status keeps the visual rule. A served number still wins
    // and still clamps.
    /** One task per documented status, all without `progress`, plus the two explicit numeric cases. */
    const board = [
      { id: "T1", subject: "completed", kind: "requirement", status: "completed", visual: "completed", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "in progress", kind: "work", status: "in_progress", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T3", subject: "claimed", kind: "work", status: "claimed", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T4", subject: "pending", kind: "work", status: "pending", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T5", subject: "blocked", kind: "work", status: "blocked", visual: "blocked", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T6", subject: "failed", kind: "work", status: "failed", visual: "failed", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T7", subject: "cancelled", kind: "work", status: "cancelled", visual: "cancelled", blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T8", subject: "explicit high", kind: "work", status: "claimed", visual: "running", progress: 140, blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T9", subject: "explicit low", kind: "work", status: "pending", visual: "open", progress: -20, blockedBy: ["T1"], failedBy: [], depth: 1 },
      { id: "T10", subject: "no status", kind: "work", status: "", visual: "running", blockedBy: ["T1"], failedBy: [], depth: 1 },
    ]
    /** The settled render of that board. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** The current tree, advanced after every hover so the next handler is fresh. */
    let tree = rendered.tree
    /**
     * Hover one node and answer its progress fill width.
     * @param id - the node to hover.
     * @returns the bar fill's inline width (`NN%`).
     */
    const percentOf = async (id: string): Promise<string> => {
      ;(one(tree, "data-mpd-node", id).props.onMouseEnter as (event: unknown) => void)({ clientX: 10, clientY: 10 })
      tree = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
      return styleOf(collectByKey(one(tree, "data-mpd-tip-card", "1"), "tip-fill")[0], "width")
    }
    expect(await percentOf("T1")).toBe("100%")
    expect(await percentOf("T2")).toBe("50%")
    // THE DISCRIMINATOR: claimed draws as running, but means 10.
    expect(await percentOf("T3")).toBe("10%")
    expect(await percentOf("T4")).toBe("0%")
    expect(await percentOf("T5")).toBe("0%")
    expect(await percentOf("T6")).toBe("0%")
    expect(await percentOf("T7")).toBe("0%")
    // A SERVED NUMBER STILL WINS, clamped at both ends.
    expect(await percentOf("T8")).toBe("100%")
    expect(await percentOf("T9")).toBe("0%")
    // NO STATUS AT ALL keeps the visual fallback (running -> 50).
    expect(await percentOf("T10")).toBe("50%")
  })

  test("pinning makes the next hover OPAQUE, leaves the detail body open, and mouseleave closes the card", async () => {
    /** The settled render of D2's fixture. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    // Pin T1 with the EXISTING click behaviour, then hover it again.
    ;(one(rendered.tree, "data-mpd-node", "T1").props.onClick as () => void)()
    /** The tree with T1 pinned. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(collect(pinned, "data-mpd-detail").map((body) => body.props["data-mpd-detail"])).toEqual(["T1"])
    ;(one(pinned, "data-mpd-node", "T1").props.onMouseEnter as (event: unknown) => void)({ clientX: 20, clientY: 30 })
    /** The tree with the pinned task's card open. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The card, which the stylesheet renders opaque through this flag. */
    const card = one(hovered, "data-mpd-tip-card", "1")
    expect(card.props["data-pinned"]).toBe("true")
    expect(flatText(card)).toContain("100%")
    // THE EXISTING DETAIL PANEL IS STILL THERE, beside the card.
    expect(flatText(one(hovered, "data-mpd-detail", "T1"))).toContain("Freeze the acceptance contract")
    // LEAVING CLOSES THE CARD and leaves the PINNED detail body alone.
    ;(one(hovered, "data-mpd-node", "T1").props.onMouseLeave as () => void)()
    /** The tree after the pointer left. */
    const left = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(collect(left, "data-mpd-tip-card").length).toBe(0)
    expect(collect(left, "data-mpd-detail").length).toBe(1)
  })

  test("falls back to `unassigned` for a task with no owner, and clamps the progress bar", async () => {
    /** The settled render of D2's fixture (T3 has no owner and a served progress ABOVE the clamp). */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(VISUAL_TASKS) } } })
    ;(one(rendered.tree, "data-mpd-node", "T3").props.onMouseEnter as (event: unknown) => void)({ clientX: 10, clientY: 10 })
    /** The tree with T3's card open. */
    const high = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** T3's card. */
    const highCard = one(high, "data-mpd-tip-card", "1")
    expect(flatText(highCard)).toContain("unassigned")
    expect(styleOf(collectByKey(highCard, "tip-fill")[0], "width")).toBe("100%")
    // THE LOW END: a board whose served progress is negative draws an EMPTY bar, never a negative width.
    /** D2's board with T3's progress pushed below zero. */
    const negative = VISUAL_TASKS.map((task) => (task.id === "T3" ? { ...task, progress: -20 } : task))
    /** A fresh render of that board. */
    const lowRendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(negative) } } })
    ;(one(lowRendered.tree, "data-mpd-node", "T3").props.onMouseEnter as (event: unknown) => void)({ clientX: 10, clientY: 10 })
    /** The tree with the clamped card open. */
    const low = await lowRendered.hooks.act(lowRendered.component, { sessionId: "s1" } as never)
    /** The clamped fill. */
    const fill = collectByKey(one(low, "data-mpd-tip-card", "1"), "tip-fill")[0]
    expect(styleOf(fill, "width")).toBe("0%")
    expect(flatText(one(low, "data-mpd-tip-card", "1"))).toContain("0%")
  })
})

describe("team-view D2: elapsed formatting and the ticker", () => {
  test("formats Xs, Xm Ys and Xh Ym, and dashes a record that cannot answer", () => {
    /** The view module, built without rendering because the formatter is pure. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** A fixed clock, so every case is deterministic. */
    const start = "2026-10-21T12:00:00.000Z"
    /** The epoch milliseconds of that start. */
    const base = Date.parse(start)
    expect(view.formatElapsed({ visual: "running", startedAt: start }, base)).toBe("0s")
    expect(view.formatElapsed({ visual: "running", startedAt: start }, base + 65_000)).toBe("1m 5s")
    expect(view.formatElapsed({ visual: "running", startedAt: start }, base + 3_661_000)).toBe("1h 1m")
    // A finished task measures start -> finish, never now.
    expect(view.formatElapsed({ visual: "completed", startedAt: start, finishedAt: "2026-10-21T12:01:05.000Z" }, base)).toBe("1m 5s")
    // THE HONEST DASHES: no start, a completed task with no finish, and a malformed stamp.
    expect(view.formatElapsed({ visual: "running" }, base)).toBe("-")
    expect(view.formatElapsed({ visual: "running", startedAt: "" }, base)).toBe("-")
    expect(view.formatElapsed({ visual: "completed", startedAt: start }, base)).toBe("-")
    expect(view.formatElapsed({ visual: "running", startedAt: "not-a-date" }, base)).toBe("-")
    // A clock that runs backwards clamps to zero instead of printing a negative span.
    expect(view.formatElapsed({ visual: "running", startedAt: start }, base - 5_000)).toBe("0s")
  })

  test("ticks once a second ONLY while a running task is visible, and cleans the interval up", () => {
    // A SOURCE PIN: the harness has no fake clock, so the arm proves the SHIPPED guard, cadence and
    // cleanup are present rather than waiting a real second in a unit test.
    expect(SOURCE).toContain('const runningVisible = state !== null && state.tasks.some((task) => task.visual === "running")')
    expect(SOURCE).toContain("if (!runningVisible) return undefined")
    expect(SOURCE).toContain("setInterval(() => setClockState(Date.now()), 1000)")
    expect(SOURCE).toContain("return () => clearInterval(timer)")
  })

  test("the drawing stays CJK-free while the card shows the raw subject", async () => {
    /** A board whose subjects are pure Chinese, which is exactly what the drawing may not carry. */
    const board = [
      { id: "T1", subject: "冻结验收契约", kind: "requirement", status: "completed", visual: "completed", owner: "web-team-gui", blockedBy: [], failedBy: [], depth: 0, startedAt: "2026-10-21T10:00:00.000Z", finishedAt: "2026-10-21T10:01:05.000Z" },
      { id: "T2", subject: "构建悬停卡片", kind: "work", status: "running", visual: "running", owner: "web-dag", blockedBy: ["T1"], failedBy: [], depth: 1, startedAt: "2026-10-21T10:02:00.000Z" },
    ]
    /** The settled render of that board. */
    const rendered = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    ;(one(rendered.tree, "data-mpd-node", "T1").props.onMouseEnter as (event: unknown) => void)({ clientX: 30, clientY: 40 })
    /** The tree with the card open. */
    const hovered = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The drawing's own text: every node box, none of the card's chrome. */
    const picture = collect(hovered, "data-mpd-node").map((node) => flatText(node)).join(" ")
    expect(/[\u2E80-\u2FFF\u3000-\u303F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(picture)).toBe(false)
    // C3: the card keeps the original subject verbatim, and it is outside the graph subtree.
    /** The card's subject element, whose text may carry the Chinese. */
    const subject = collectByKey(one(hovered, "data-mpd-tip-card", "1"), "tip-subject")[0]
    expect(flatText(subject)).toContain("冻结验收契约")
    expect(collect(one(hovered, "data-mpd-graph", "ranks=2 edges=1"), "data-mpd-tip-card").length).toBe(0)
  })
})
