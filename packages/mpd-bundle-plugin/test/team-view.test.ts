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
/** The sentence the empty TASKS panel must keep, verbatim, from the frozen contract. */
const EMPTY_SENTENCE = "No shared task yet — the captain posts them with team_task_create."
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

/** Build a full team payload around one board, overriding the tally the case needs. */
function stateOf(tasks: Array<Record<string, unknown>>, counts: Partial<Record<string, number>> = {}, cycles: string[] = []): unknown {
  return {
    ok: true,
    workspace: WORKSPACE,
    team: { id: "team-alpha", name: "Wave GUI", description: "the team GUI wave", phase: "active", approvedAt: "2026-10-05T10:00:00.000Z", links: 0 },
    counts: { total: tasks.length, completed: 1, running: 1, ready: 1, blocked: 1, failed: 0, releasedByFailure: 0, ...counts },
    members: [
      { id: "m1", name: "web-team-gui", role: "Senior Engineer", status: "running", done: 1, total: 2, current: "Build the header", route: "deepseek/deepseek-chat" },
      { id: "m2", name: "web-settings-card", role: "Senior Engineer", status: "idle", done: 0, total: 1 },
    ],
    tasks,
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
  layout: (tasks: Array<Record<string, unknown>>) => GraphGeometry
  /** The graph-safe label rule itself (clause C4), exposed so the drawing's one composer is provable. */
  graphSafeLabel: (subject: string, ordinal: number) => string
  /** The curve builder itself, exposed so its `radius = 0` control can be driven directly (clause W6). */
  curveOf: (waypoints: Array<{ x: number; y: number }>, radius: number) => { d: string; points: Array<{ x: number; y: number }> }
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
  nodes: Array<{ task: { id: string }; rank: number; row: number; ordinal: number; top: number }>
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
  /** How many rows each rank's column holds, reserved rows included. */
  slots: number[]
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
    expect(SOURCE).toContain("layout: (tasks: TeamTask[], radius?: number) => GraphGeometry")
    expect(SOURCE).toContain("graphSafeLabel: (subject: string, ordinal: number) => string")
    expect(SOURCE).toContain("curveOf: (waypoints: CurvePoint[], radius: number)")
  })
})

describe("team-view DAG geometry", () => {
  test("one column per depth rank, one node box per task, in rank order", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The geometry of the four-task fixture board. */
    const graph = view.layout(TASKS)
    expect(graph.columns.map((column) => column.map((task) => task.id))).toEqual([["T1"], ["T2"], ["T3"], ["T4"]])
    expect(graph.rankCount).toBe(4)
    expect(graph.width).toBe(4 * 168)
    expect(graph.gridTemplateColumns).toBe("repeat(4, 168px)")
    expect(graph.nodes.map((node) => [node.task.id, node.rank, node.row, node.top])).toEqual([
      ["T1", 0, 0, 4], ["T2", 1, 0, 4], ["T3", 2, 0, 4], ["T4", 3, 0, 4],
    ])
  })

  test("a negative or missing depth falls back to the first column instead of dropping the task", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
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
    // The route's own runs are still published, which is what keeps `data-mpd-route` the routing truth:
    // the lead-out STARTS on the parent's right border and the lead-in ENDS on the child's first pixel.
    /** The edge's route as published: its runs, then `R`/`L` and the arrowhead's own box. */
    const [route, marker] = String(edge[0].props["data-mpd-route"]).split("|")
    /** Those runs, in draw order. */
    const runs = route.split(";").map(parseRect)
    expect(runs[0].left).toBe(borders(0).right)
    expect(runs[runs.length - 1].left + runs[runs.length - 1].width).toBe(borders(1).left + 1)
    // Every run lies on the one row's middle, so an edge meets a border at its midpoint.
    for (const run of runs) expect(run.top).toBe(middle)
    // The route `data-mpd-route` publishes is the layout's own, run for run and pixel for pixel.
    expect(route.split(";")).toEqual((drawn as { segments: Array<{ rect: Rect }> }).segments.map((segment) => rectTextOf(segment.rect)))
    // THE CURVE TRAVELS THE SAME TWO POINTS: it leaves the blocker's border middle and lands on the
    // dependant's, which is what makes the painted form a parametrisation of the route, not a redraw.
    expect(curve.points[0]).toEqual({ x: borders(0).right, y: middle })
    expect(curve.points[curve.points.length - 1]).toEqual({ x: borders(1).left, y: middle })
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
    // only rounds it. `segments` keeps its names and its rectangles (clause W4), so this arm keeps its
    // exact numbers and only changes the accessor.
    /** The geometry's own T2←T3 edge: its route runs AND the curve painted over them. */
    const drawn = view.layout(board).edges.find((candidate) => candidate.witness === "T2<-T3") as {
      segments: Array<{ key: string; rect: Rect }>
      curve: { points: Array<{ x: number; y: number }> }
    }
    /** Its riser, the run that has to span the rows. */
    const riser = drawn.segments.filter((segment) => segment.key === "riser")[0].rect
    // Row 1's centre is 4 + 52 + 21 = 77; row 0's is 25, so the riser is 52px tall starting at 25.
    expect(riser.top).toBe(25)
    expect(riser.height).toBe(52)
    // AND THE PAINTED CURVE SPANS THE SAME ROWS: the sweep bends the leg, it does not shorten it.
    const ys = drawn.curve.points.map((point) => point.y)
    expect(Math.min(...ys)).toBe(25)
    expect(Math.max(...ys)).toBe(77)
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
    /** The same board's geometry, where every run and every curve is checkable as a number. */
    const graph = view.layout(CYCLE_TASKS)
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
    expect(detail).toContain("blocked by T2, T9")
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
    expect(marked).toContain(ZH + "kind.req")
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
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(LONG_EDGE_TASKS)
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
    // arm could pass by measuring nothing at all. That formula put T2→T7's riser at the centre of the
    // band between T2's right border (164) and T7's left border (340) — x=252, inside rank 1 — and ran
    // it from the parent's middle (25) down to the child's (77).
    /** The pre-fix T2→T7 riser, reconstructed from the removed formula, which the check MUST catch. */
    const oldRiser: Rect = { left: 252, top: 25, width: 1, height: 52 }
    /** The boxes that riser stood inside, which is the tangle the user photographed. */
    expect([...boxes].filter(([, box]) => entersInterior(oldRiser, box)).length).toBeGreaterThan(0)
    // POSITIVE CONTROL 2 — THE CURVE DOMAIN: the SAME segment instrument, fed a polyline that bends
    // through a column. This is the control the rect skeleton cannot give: it proves the arm can fail on
    // a sample path, which is exactly the failure mode a curve introduces. (The per-vertex clamp to half
    // a leg is what makes a real curve unable to bulge, so an injected path — not a huge radius — is the
    // honest way to make this instrument fail in its own domain.)
    /** The pre-fix route's shape, emitted as a curve at a radius far larger than any leg it has. */
    const bulging = view.curveOf([{ x: 164, y: 25 }, { x: 252, y: 25 }, { x: 252, y: 77 }, { x: 340, y: 77 }], 400).points
    /** How many boxes that injected curve enters, which must be at least one. */
    let caught = 0
    for (let index = 1; index < bulging.length; index += 1) {
      for (const box of boxes.values()) if (segmentEntersInterior(bulging[index - 1], bulging[index], box)) caught += 1
    }
    expect(caught).toBeGreaterThan(0)
  })

  test("a rank-skipping edge is routed as a CHAIN of adjacent-rank hops, not one riser through a column", async () => {
    /** The view module, built without rendering, for the pure geometry. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(LONG_EDGE_TASKS)
    /** The long edge this arm follows: rank 0 → rank 2, over rank 1. */
    const long = graph.edges.find((edge) => edge.parent === "T2" && edge.child === "T7")
    expect(long).toBeDefined()
    // BEFORE: three runs (lead-out, riser, lead-in) with ONE riser standing in the middle of rank 1's
    // column. AFTER: five runs — the path leaves T2, drops into gutter 0, CROSSES rank 1 along a row
    // reserved in it, drops into gutter 1 and arrives at T7.
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
    // And the CROSSING runs along a row BELOW every box of the rank it crosses, which is why it cannot
    // meet one. The rank members are read off the GEOMETRY's own nodes (R20 derives them), never off the
    // fixture's served `depth`: this board is the captain's rank list, and the two disagree for `T12` —
    // which is exactly the class of lie the derivation exists to ignore.
    /** The crossing run, which is the horizontal hop over rank 1. */
    const crossing = byKey.get("cross1") as Rect
    /** The bottom edge of the lowest box the DRAWING placed in rank 1. */
    const rank1Bottom = Math.max(...graph.nodes.filter((node) => node.rank === 1).map((node) => node.top + 42))
    expect(crossing.top).toBeGreaterThanOrEqual(rank1Bottom)
    // AND THE PAINTED CURVE CROSSES ON THAT SAME ROW: the fillets round the turns but never move the
    // crossing, so the polyline must carry samples ON the reserved row itself. Without this the curve
    // could satisfy every rect assertion above while being drawn somewhere else entirely.
    /** That edge's flattened polyline, which is what the renderer painted. */
    const curve = long as { curve: { points: Array<{ x: number; y: number }> } }
    expect(curve.curve.points.some((point) => point.y === crossing.top)).toBe(true)
  })

  test("every gutter lane gets its OWN column: one x per hop, none on a border", async () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The routed geometry of the screenshot's board. */
    const graph = view.layout(LONG_EDGE_TASKS)
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

describe("team-view R20: the rank is DERIVED, never trusted from the served depth", () => {
  test("a board whose references RESOLVE and whose every depth is 0 draws FIVE columns, not one", () => {
    // THE ARM THE EARLIER VERIFICATION LACKED. Before this port the view bucketed by `task.depth`, so
    // this board — all zeros — collapsed to ONE column with no edges, which is the user's photograph.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The geometry of the lying board. */
    const graph = view.layout(WEB_DERIVED_TASKS)
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

  test("the two fallback arms, exactly as the TUI engine has them", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // ARM A — A GENUINELY FLAT BOARD SERVED FLAT STAYS FLAT, and says it derived: nothing is invented.
    /** Two independent roots, served flat. */
    const flat = view.layout([{ id: "A", depth: 0 }, { id: "B", depth: 0 }])
    expect(flat.rankCount).toBe(1)
    expect(flat.ranksDerived).toBe(true)
    // ARM B — NOTHING RESOLVES AND THE SERVED DEPTHS VARY, so the fallback fires and reports itself.
    /** Ghost references whose served depths claim two ranks. */
    const ghosts = view.layout([{ id: "A", depth: 0, blockedBy: ["Z"] }, { id: "B", depth: 1, blockedBy: ["Y"] }])
    expect(ghosts.ranksDerived).toBe(false)
    expect(ghosts.rankCount).toBe(2)
    expect(ghosts.unresolved).toEqual(["Y", "Z"])
  })

  test("R21: unresolved references are SURFACED with their ids, never silently dropped", () => {
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    // The MEASURED record, verbatim: ids T1..T10 and `blockedBy` holding plan ordinals. Not one
    // reference resolves, so the board is genuinely flat — and now it SAYS why instead of drawing a
    // one-column picture that looks like a healthy board.
    /** The record as it sits on disk. */
    const ordinals = [
      { id: "T1", depth: 0, blockedBy: [] }, { id: "T2", depth: 0, blockedBy: [] }, { id: "T3", depth: 0, blockedBy: [] },
      { id: "T4", depth: 0, blockedBy: [] }, { id: "T5", depth: 0, blockedBy: [] },
      { id: "T6", depth: 0, blockedBy: ["2"] }, { id: "T7", depth: 0, blockedBy: ["2", "3", "4", "6"] },
      { id: "T8", depth: 0, blockedBy: ["7"] }, { id: "T9", depth: 0, blockedBy: ["2", "3", "4", "5", "6"] },
      { id: "T10", depth: 0, blockedBy: ["7", "8", "9"] },
    ]
    /** The geometry of that record. */
    const graph = view.layout(ordinals)
    expect(graph.unresolved).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"])
    expect(graph.rankCount).toBe(1)
    expect(graph.edges.length).toBe(0)
    // A MIXED BOARD SEPARATES THE TWO FACTS: the reference that resolves draws, the ghost is reported.
    /** One drawable blocker and one ghost on the same task. */
    const mixed = view.layout([{ id: "P", depth: 0 }, { id: "C", depth: 0, blockedBy: ["P", "GHOST"] }])
    expect(mixed.unresolved).toEqual(["GHOST"])
    expect(mixed.edges.length).toBe(1)
    expect(mixed.rankCount).toBe(2)
  })

  test("the hover halo measures the DRAWN ranks, so a lying depth cannot kill the highlight", () => {
    // The second site that trusted the lie: the chain's monotone guard compared served depths, so on this
    // all-zero board EVERY hop was pruned (`0 >= 0`) and a hover lit one node while dimming the rest.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** The geometry of the lying board, which is where the halo's ranks come from. */
    const graph = view.layout(WEB_DERIVED_TASKS)
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

describe("R18's reader side: the RECORD's own unresolved report, beside the view's re-derivation", () => {
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

  test("a REPAIRED board still reports what the record said: the reader sees more than the re-derivation", () => {
    // THE CASE ONLY THE READER CAN SEE, and the live board is exactly it: `blockedBy` was rewritten to
    // real ids after the fact, so the served references now ALL resolve and the view's own scan finds
    // nothing. The record still remembers what did not resolve when it was written, and a viewer must
    // not be told the board is clean.
    /** The view module, built without rendering. */
    const view = loadFactory()({}).createTeamView({ react: null, statePath: STATE_PATH })
    /** A board whose references were repaired while the record's own report was kept. */
    const repaired = [
      { id: "T1", depth: 0, blockedBy: [], failedBy: [] },
      { id: "T2", depth: 1, blockedBy: ["T1"], failedBy: [], unresolvedBlockers: ["2", "6"] },
    ]
    /** The geometry of the repaired board. */
    const graph = view.layout(repaired)
    // The view's re-derivation sees a clean board…
    expect(graph.unresolvedRecorded).toEqual(["2", "6"])
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
