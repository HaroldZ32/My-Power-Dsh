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
  nodes: Array<{ task: { id: string }; rank: number; row: number; top: number }>
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
  test("stays a single factory body: one arrow expression, no import/export, no JSX, no SVG", () => {
    expect(SOURCE.startsWith("// mpd bundle web client")).toBe(true)
    expect(SOURCE.trimEnd().endsWith("}")).toBe(true)
    // THE BUILD'S OWN BOUNDARY RULE, read off the SOURCE: the factory opener is the ONE line at COLUMN
    // ZERO that ends in `=> {` — every other arrow in this file is indented inside the factory. Counting
    // all such lines instead would measure the render callbacks, which is why this pins the column.
    const openers = SOURCE.split("\n").filter((line) => !line.startsWith(" ") && line.trimEnd().endsWith("=> {"))
    expect(openers.length).toBe(1)
    expect(openers[0].startsWith("(require: ")).toBe(true)
    // A module would break the splice; JSX has no transform here; an SVG or a canvas would be a
    // measuring pass by another name, which the frozen contract forbids.
    expect(/^\s*(import|export)\b/m.test(SOURCE)).toBe(false)
    expect(SOURCE).not.toContain("createElement(" + "svg")
    expect(SOURCE).not.toContain("getBoundingClientRect")
    expect(SOURCE).not.toContain("requestAnimationFrame")
    expect(SOURCE).not.toContain("ResizeObserver")
  })

  test("takes an OPTIONAL translator and a task route, and exposes the pure layout", () => {
    expect(SOURCE).toContain("planPath?: string; taskPath?: string; pollMs?: number; t?: Translator")
    expect(SOURCE).toContain("layout: (tasks: TeamTask[]) => GraphGeometry")
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
  test("draws one absolutely-positioned three-segment edge per blockedBy entry ON the board", async () => {
    /** The settled render of the fixture board. */
    const { tree } = await renderView()
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
    /** The three segments of the T1→T2 edge: lead-out, riser, lead-in. */
        /** The T1→T2 edge, located by its own key; its children are the three segments. */
    const edge = collectByKey(layer, "edge:T1>T2")
    expect(edge.length).toBe(1)
    /** The edge's three segments, in draw order. */
    const segments = (edge[0].props.children as ElementNode[])
    expect(segments.map((segment) => segment.key)).toEqual(["out", "riser", "in"])
    // MERMAID-STYLE ROUTING, so the numbers are the boxes' own borders rather than a fixed inset.
    // A node is `COLUMN_PAD` (4) inside its 168px column, so column 0's box spans 4..164 and column 1's
    // spans 172..332. Both boxes' vertical middle is their top (4) plus half a node (21) = 25.
    //
    // T1->T2 is a forward edge, so it LEAVES T1's right border (164) and ARRIVES at T2's left border
    // (172), with the riser in the 8px gap between them — one lane at the gap's centre, 168.
    expect(styleOf(segments[0], "left")).toBe("164px")
    expect(styleOf(segments[0], "top")).toBe("25px")
    // The stub spans the GAP only (164 -> 168), so nothing it draws can reach under a node.
    // THE PROPERTY, NOT THE PIXELS. Pinning the four literals would re-couple this arm to the sizes it
    // is supposed to be independent of — the reviewer's point that a scale change must not detach the
    // edges. What has to hold is the RELATION, read off the same accessors the layout renders the boxes
    // with: a node sits `GEO.inset` inside a `GEO.column`-wide column, so column 0's box spans 4..164 and
    // column 1's spans 172..332, and T1->T2 is a forward edge at one row, so it leaves T1's RIGHT border
    // and arrives at T2's LEFT border with the riser between them.
    /** The four sizes the layout derives every position from, restated so the relation is checkable. */
    const DIMS = { column: 168, inset: 4, nodeHeight: 42, nodeGap: 10, pad: 4 }
    /** One node's borders, derived from the sizes rather than written down. */
    const borders = (rank: number): { left: number; right: number } =>
      ({ left: rank * DIMS.column + DIMS.inset, right: rank * DIMS.column + DIMS.column - DIMS.inset })
    /** The vertical middle of the one row this fixture puts both nodes on. */
    const middle = DIMS.pad + DIMS.nodeHeight / 2
    /** The edge's three painted segments. */
    /** One painted segment's box, as numbers. */
    const geo = (index: number): { left: number; top: number; width: number } =>
      ({ left: Number.parseFloat(styleOf(segments[index], "left")), top: Number.parseFloat(styleOf(segments[index], "top")), width: Number.parseFloat(styleOf(segments[index], "width")) })
    /** The lead-out the edge paints: from the parent's right border to the riser. */
    const out = geo(0)
    /** The vertical run joining the two rows, inside the boxes' gap. */
    const riser = geo(1)
    /** The lead-in: from the riser to the child's left border. */
    const into = geo(2)
    // The lead-out STARTS on the parent's right border and ENDS on the riser.
    expect(out.left).toBe(borders(0).right)
    expect(out.left + out.width).toBe(riser.left)
    // The riser is a vertical line INSIDE the two boxes' gap, never on either border.
    expect(riser.left).toBeGreaterThan(borders(0).right)
    expect(riser.left).toBeLessThan(borders(1).left)
    expect(riser.width).toBe(1)
    // The lead-in starts on the riser and ENDS on the child's left border.
    expect(into.left).toBe(riser.left)
    expect(into.left + into.width).toBe(borders(1).left + 1)
    // Every segment runs along ONE box's vertical middle, so an edge meets a border at its midpoint.
    expect([out.top, riser.top, into.top]).toEqual([middle, middle, middle])
    // Nothing an edge paints reaches under a box: every segment lives in the gap between the borders.
    expect(out.left).toBeGreaterThanOrEqual(borders(0).right)
    expect(into.left + into.width).toBeLessThanOrEqual(borders(1).left + 1)
  })

  test("draws a riser that spans the two rows when a blocker sits below its dependant", async () => {
    /** A board whose second task depends on a task two rows further down its column. */
    const board = [
      { id: "T1", subject: "a", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "b", kind: "work", status: "open", visual: "blocked", blockedBy: ["T3"], failedBy: [], depth: 0 },
      { id: "T3", subject: "c", kind: "work", status: "open", visual: "open", blockedBy: [], failedBy: [], depth: 1 },
    ]
    /** The settled render of that board. */
    const { tree } = await renderView({ routes: { [STATE_PATH]: { ok: true, status: 200, body: stateOf(board) } } })
    /** The single drawn edge. */
    const edge = one(one(tree, "data-edges", "1"), "data-mpd-edge", "T2<-T3")
    /** Its riser, the segment that has to span the rows. */
    const riser = (edge.props.children as ElementNode[])[1]
    // Row 1's centre is 4 + 52 + 21 = 77; row 0's is 25, so the riser is 52px tall starting at 25.
    expect(styleOf(riser, "top")).toBe("25px")
    expect(styleOf(riser, "height")).toBe("52px")
  })

  test("a cycle's back-edge keeps a non-negative width instead of drawing NaN", async () => {
    // The store resolves a revisited node to rank 0, so a back-edge can point RIGHT TO LEFT: its riser
    // then sits at a negative offset, and a width taken from the difference alone would go negative.
    // The trap is that a negative width is not a crash — it is an edge that silently vanishes — so the
    // geometry has to clamp, and this arm pins the clamp.
    /** The settled render of the two-task cycle. */
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
    for (const edge of edges) {
      for (const segment of edge.props.children as ElementNode[]) {
        /** This segment's own width, which must never be negative or unparsable. */
        const width = styleOf(segment, "width")
        expect(width.endsWith("px")).toBe(true)
        expect(Number.parseInt(width, 10) >= 0).toBe(true)
        expect(width).not.toContain("NaN")
      }
    }
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
    // The focused edge is tinted brighter than an unfocused one.
    /** The focused edge's segments. */
    const focused = (collectByKey(hovered, "edge:T1>T2")[0].props.children as ElementNode[])
    expect(styleOf(focused[0], "background")).toBe("var(--dsw-alias-label-secondary, #5b6472)")
    // Leaving clears the halo, so every node is full again.
    ;(one(hovered, "data-mpd-node", "T2").props.onMouseLeave as () => void)()
    /** The tree after the pointer left. */
    const left = await hooks.act(rendered.component, { sessionId: "s1" } as never)
    expect(styleOf(one(left, "data-mpd-node", "T4"), "opacity")).toBe("1")
    expect(one(left, "data-mpd-graph", "ranks=4 edges=3").props["data-mpd-focus"]).toBe("none")
    expect(styleOf((collectByKey(left, "edge:T1>T2")[0].props.children as ElementNode[])[0], "background")).not.toBe("var(--dsw-alias-label-secondary, #5b6472)")
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
