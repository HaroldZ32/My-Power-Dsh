// INDEPENDENT FIDELITY INSTRUMENT for the WEB surface of the wave `dag-edges-scroll` (Reviewer, T6).
//
// WHO WROTE THIS. The reviewer, NOT the two implementation lanes. The WEB view is a FACTORY BODY with no
// `import`/`export` (the bundle build splices it into `client.js`), so it cannot be imported: it is
// STRIPPED with the same tool the build uses and EVALUATED, and every arm below therefore runs against
// the shipped bytes rather than against a copy. The two written contracts it judges are
// `evidence/dag/dag-edges-scroll/requirements.md` (the frozen clauses) and
// `evidence/dag/dag-edges-scroll/design-freeze.md` + `captain-rulings.md` (authoritative for NAMES).
//
// WHAT IT COVERS
//   * C4/R3 — the graph-safe label rule, implemented HERE from the frozen text, compared against BOTH
//     surfaces' `graphSafeLabel`, over an adversarial table plus the `#<ordinal>` fallback;
//   * C2    — one composer per surface, proven BEHAVIOURALLY: all three TUI drawing modes and the WEB's
//     node box draw the same label for the same board, so a renderer composing its own label reddens;
//   * C1    — the DRAWING (node box text, rail/list node text, edge glyphs, legend lines) carries zero
//     C1-banned characters on both surfaces, while the pinned detail body keeps the raw Chinese (C3);
//   * C5    — the negative control: the pre-rule pass-through is MEASURED to violate the same check;
//   * the W-family arms (containment, arrival, radius) live in `dag-fidelity.test.ts`, which owns the
//     TUI drawing and the WEB curve geometry.
//
// WHY THE TUI SURFACE IS PROBED DYNAMICALLY. The wave's TUI names are frozen by `captain-rulings.md`
// R2/R3, but a static `import` of a name that has not landed yet kills the WHOLE FILE with one module
// error — which would hide the twenty arms that have nothing to do with it. The TUI module is therefore
// imported at run time and probed per arm, so an absent export reddens ITS clause and nothing else.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"

import { createHookRuntime, type ElementNode, type HookRuntime, type TreeNode } from "../../mpd-bundle-plugin/test/client-harness.ts"

/** The WEB view's own source text — the artefact the evaluated factory is built from. */
const WEB_SOURCE_PATH = join(import.meta.dir, "..", "..", "mpd-bundle-plugin", "src", "team-view.ts")

/**
 * The CJK / full-width ranges clause C1 bans inside the DAG drawing, as inclusive code-point bounds.
 *
 * Spelled as bounds rather than one regex so a control can name the range a character was caught by.
 */
const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x2e80, 0x2fff],
  [0x3000, 0x303f],
  [0x3040, 0x9fff],
  [0xac00, 0xd7af],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef],
]

/**
 * Every character of `value` that clause C1 bans, in order, duplicates included.
 * @param value - the string under inspection, typically one rendered row or a whole drawing.
 * @returns the banned characters; an empty array means the string satisfies C1.
 */
function bannedChars(value: string): string[] {
  /** The banned characters found so far. */
  const found: string[] = []
  for (const character of value) {
    /** The character's code point, which is what the ranges are stated in. */
    const code = character.codePointAt(0) ?? 0
    if (CJK_RANGES.some(([low, high]) => code >= low && code <= high)) found.push(character)
  }
  return found
}

/**
 * Clause C4's graph-safe label rule, implemented from the frozen text.
 *
 * `\x20`-`\x7E` is printable ASCII, so a TAB, a newline or any non-ASCII character is a SEPARATOR: it
 * ends the run it interrupts. The runs are joined with one space, then whitespace is collapsed and the
 * result trimmed - which is what makes `"fix 登录页 styles"` come out single-spaced.
 * @param subject - the task's subject, in whatever language it was written.
 * @returns the non-empty label, or `""` when the subject carries no printable ASCII at all.
 */
function labelRule(subject: string): string {
  /** The maximal runs of printable ASCII, in order. */
  const runs = subject.match(/[\x20-\x7e]+/g) ?? []
  return runs.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * The pre-rule behaviour the user's decision BANS: the node draws the subject verbatim.
 *
 * It exists only as the negative control, so an arm can prove it is able to tell the rule from the
 * status quo. Nothing in the instrument asserts the product still behaves this way.
 * @param subject - the task's subject.
 * @returns the subject, unchanged.
 */
function preRuleLabel(subject: string): string {
  return subject
}

/** One row of the adversarial table: a subject, the label C4 demands for it, and why that is the case. */
interface LabelCase {
  /** The subject fed to the composer. */
  readonly subject: string
  /** The label C4 demands when the subject yields printable ASCII. */
  readonly label: string
  /** Whether C4's fallback applies instead, i.e. the label is `#<ordinal>`. */
  readonly fallsBack: boolean
  /** What this row is here to catch. */
  readonly why: string
}

/**
 * The adversarial table: every class the user's decision named, plus the near misses that break a
 * naive implementation.
 */
const LABEL_CASES: readonly LabelCase[] = [
  { subject: "Build the header and the progress bar", label: "Build the header and the progress bar", fallsBack: false, why: "pure ASCII passes through unchanged — a rule that rewrote it would be lossy" },
  { subject: "冻结验收契约", label: "", fallsBack: true, why: "pure Chinese — the decision's own case: no ASCII run, so the fallback must fire" },
  { subject: "fix 登录页 styles", label: "fix styles", fallsBack: false, why: "mixed — three spaces collapse to one, and the Chinese run vanishes whole" },
  { subject: "T1冻结T2", label: "T1 T2", fallsBack: false, why: "adjacent runs with no surrounding space still join with exactly ONE space" },
  { subject: "（，。！）", label: "", fallsBack: true, why: "full-width punctuation is U+FF00–U+FFEF: banned AND non-ASCII, so the fallback fires" },
  { subject: "--- === ???", label: "--- === ???", fallsBack: false, why: "ASCII punctuation is printable ASCII and stays: the rule is not a word filter" },
  { subject: "🎉🚀", label: "", fallsBack: true, why: "emoji-only (astral) — a code-unit-wise scan sees two units that are not ASCII" },
  { subject: "done 🎉", label: "done", fallsBack: false, why: "emoji beside ASCII: the trailing run trims to a single word" },
  { subject: "42", label: "42", fallsBack: false, why: "numbers-only is ASCII and must survive verbatim" },
  { subject: "Ｔ１ 冻结", label: "", fallsBack: true, why: "FULL-WIDTH ASCII (U+FF34 'T', U+FF11 '1') looks like text but is banned and non-ASCII — the sharpest near miss" },
  { subject: "a\tb", label: "a b", fallsBack: false, why: "TAB is not printable ASCII, so it is a separator and never reaches the drawing" },
  { subject: "  spaced  out  ", label: "spaced out", fallsBack: false, why: "leading/trailing whitespace trims, interior runs collapse" },
  { subject: "", label: "", fallsBack: true, why: "an empty subject cannot produce a label, so the ordinal is the only honest text left" },
]

describe("C4 · the graph-safe label rule, implemented from the frozen text", () => {
  test("the adversarial table: every class the decision named, including the near misses", () => {
    for (const row of LABEL_CASES) {
      // Compared through a template literal so the failure message names the SUBJECT rather than only
      // the two labels: a table of thirteen rows is unreadable when the diff shows one bare string.
      expect(`[${row.subject}] -> ${labelRule(row.subject)}`).toBe(`[${row.subject}] -> ${row.label}`)
    }
  })

  test("every produced label is non-empty ONLY when the rule found ASCII, and carries no banned character", () => {
    for (const row of LABEL_CASES) {
      /** The label the rule produces for this row. */
      const produced = labelRule(row.subject)
      // The emptiness is the fallback's trigger, so it is asserted as a fact about the RULE, not
      // re-derived inside the test: `fallsBack` claims the label is empty and nothing else.
      expect(produced.length === 0).toBe(row.fallsBack)
      // C1's corollary: a composer that leaves one full-width glyph behind reddens here.
      expect(bannedChars(produced).length).toBe(0)
    }
  })

  test("NEGATIVE CONTROL: the pre-rule pass-through VIOLATES the same table, so the check can fail", () => {
    /** How many of the table's rows carry a banned character at all, which bounds the control. */
    let carrying = 0
    for (const row of LABEL_CASES) {
      /** The banned characters of the SUBJECT, i.e. of the pre-rule input. */
      const raw = bannedChars(row.subject)
      if (raw.length === 0) continue
      carrying += 1
      // The pre-rule input is exactly what the user photographed: a Chinese subject drawn verbatim. The
      // counts are compared so the control cannot pass by measuring a different string than it claims.
      expect(bannedChars(preRuleLabel(row.subject)).length).toBe(raw.length)
      if (row.fallsBack) expect(preRuleLabel(row.subject)).not.toBe(row.label)
    }
    // A control over an empty class proves nothing, so the class's own size is asserted: five of the
    // table's thirteen rows carry a banned character, and this number is MEASURED — the first draft of
    // this file said three, and the arm above refused it.
    expect(carrying).toBe(5)
  })
})

// ── the WEB view, driven rather than copied ────────────────────────────────────────────────────

/** One rectangle in the canvas's own pixels. */
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

/** The painted form of one route, as the freeze's (a) A1 freezes it. */
interface EdgeCurve {
  /** The `<path>` `d`. */
  d: string
  /** The flattened polyline of exactly that path. */
  points: Array<{ x: number; y: number }>
  /** The ARRIVAL POINT — the border the edge arrives at, not a rectangle. */
  tip: { x: number; y: number }
  /** The corner radius the path was built with. */
  radius: number
}

/** The WEB layout's output, typed to the fields this file reads. */
interface WebGeometry {
  /** How many rank columns the grid draws. */
  rankCount: number
  /** One entry per node, in column-major order, each carrying its BOARD ordinal. */
  nodes: Array<{ task: { id: string }; rank: number; row: number; ordinal: number }>
  /** One entry per drawn dependency, in board order. */
  edges: Array<{ parent: string; child: string; witness: string; segments: Array<{ key: string; rect: Rect }>; curve: EdgeCurve; marker: Rect; pointsLeft: boolean }>
}

/** The WEB factory's module shape, typed to the frozen surface. */
interface WebModule {
  /** The component under test. */
  TeamView: (props?: unknown) => unknown
  /** The pure geometry, with the W6 control parameter. */
  layout: (tasks: ReadonlyArray<Record<string, unknown>>, radius?: number) => WebGeometry
  /** The label composer (R3), factory-scoped on this surface. */
  graphSafeLabel: (subject: string, ordinal: number) => string
}

/**
 * Strip the factory's types and evaluate it as the arrow expression it is.
 * @returns the factory the module evaluates to.
 */
function loadWebFactory(): (deps: unknown) => { createTeamView: (deps: unknown) => WebModule } {
  /** The source, read at run time so a lane edit re-judges every arm below. */
  const source = readFileSync(WEB_SOURCE_PATH, "utf8")
  /** The source with every type annotation erased, as the build's own strip does it. */
  const stripped = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  /** The evaluated expression, which the build wraps the same way. */
  const value = new Function("return (" + stripped.trim().replace(/;$/, "") + ")")() as unknown
  if (typeof value !== "function") throw new Error("the WEB factory body no longer evaluates to a function")
  return value as (deps: unknown) => { createTeamView: (deps: unknown) => WebModule }
}

/** The WEB module, built without rendering — what the composer arms need. */
function webModule(): WebModule {
  return loadWebFactory()({}).createTeamView({ react: null, statePath: "/plugins/mpd-team/state" })
}

/** One task row as the WEB payload serves it. */
interface WebTaskRow extends Record<string, unknown> {
  /** The task id. */
  id: string
  /** The subject, verbatim. */
  subject: string
  /** The rendered state. */
  visual: string
  /** The ids this task is blocked by. */
  blockedBy: string[]
  /** The ids whose failure released this task; the detail body reads it, so a served row carries it. */
  failedBy: string[]
  /** The longest dependency path. */
  depth: number
}

/**
 * Build the state payload the view reads, around one board.
 * @param tasks - the board, in the order the store served it.
 * @returns the payload object, as the route answers it.
 */
function stateOf(tasks: ReadonlyArray<WebTaskRow>): unknown {
  return {
    ok: true,
    workspace: "/w",
    team: { id: "team-alpha", name: "Wave", phase: "active" },
    counts: { total: tasks.length, completed: 0, running: 0, ready: tasks.length, blocked: 0, failed: 0, releasedByFailure: 0 },
    members: [],
    tasks,
    cycles: [],
    executor: { kind: "native", reason: "test" },
    problems: [],
  }
}

/** Everything one rendered case hands back. */
interface Rendered {
  /** The settled element tree. */
  tree: ElementNode
  /** The component, so an interaction can re-render the SAME one. */
  component: Function
  /** The hook runtime, so an interaction's state update reaches the tree. */
  hooks: HookRuntime
  /** The module under test. */
  module: WebModule
}

/**
 * Render the view against canned routes, with the real offline hook runtime.
 *
 * `globalThis.fetch` is replaced for the case and restored afterwards, so a later case can never run
 * against this one's canned answers.
 * @param tasks - the board the state route serves.
 * @param props - the component's props.
 * @returns the settled tree and the handles an interaction needs.
 */
async function renderWeb(tasks: ReadonlyArray<WebTaskRow>, props: Record<string, unknown> = { sessionId: "s1" }): Promise<Rendered> {
  /** The canned answers, keyed by path. */
  const routes: Record<string, unknown> = {
    "/plugins/mpd-team/state": stateOf(tasks),
    "/plugins/mpd-team/plan": { ok: true, workspace: "/w", plan: null },
    "/plugins/mpd-team/task": { ok: true, workspace: "/w", contracts: [], hold: null },
  }
  /** The process fetch this case replaces, kept for the restore in the `finally`. */
  const saved = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    /** The path half of the requested URL. */
    const path = String(url).split("?")[0]
    /** The canned answer, or a 404 the view renders as unreadable. */
    const body = routes[path]
    return body === undefined ? { ok: false, status: 404, json: async () => null } : { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
  try {
    /** The offline React double the view's hooks run on. */
    const hooks = createHookRuntime()
    /** The module under test. */
    const module = loadWebFactory()({}).createTeamView({ react: hooks.react, statePath: "/plugins/mpd-team/state", planPath: "/plugins/mpd-team/plan", taskPath: "/plugins/mpd-team/task", pollMs: 60_000 })
    /** The tree the poll settled into. */
    const tree = await hooks.render(module.TeamView as never, props as never)
    return { tree, component: module.TeamView as Function, hooks, module }
  } finally {
    globalThis.fetch = saved
  }
}

/** Flatten a subtree to its concatenated text, the way a rendered panel reads. */
function flatText(node: TreeNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flatText).join("")
  if (typeof node === "object" && "props" in node) return flatText((node as ElementNode).props?.children as TreeNode)
  return ""
}

/**
 * Every element in the tree carrying one string prop, in render order.
 *
 * ARRAYS ARE WALKED, because `createElement` keeps a list the view built with `map` a LIST inside its
 * parent's children: a walker that only followed elements would report a drawing with no nodes in it.
 * @param node - the subtree to walk.
 * @param prop - the prop name.
 * @returns the matching elements' props bags, in depth-first order.
 */
function collect(node: TreeNode, prop: string): Array<Record<string, unknown>> {
  /** The matches found so far. */
  const found: Array<Record<string, unknown>> = []
  if (Array.isArray(node)) {
    for (const child of node) found.push(...collect(child, prop))
    return found
  }
  if (node === null || node === undefined || typeof node !== "object") return found
  /** The element under inspection. */
  const element = node as ElementNode
  if (typeof element.props?.[prop] === "string") found.push(element.props)
  found.push(...collect(element.props?.children as TreeNode, prop))
  return found
}

/** The one element carrying an exact prop value; a duplicate is a failure, never a silent first hit. */
function one(node: TreeNode, prop: string, value: string): Record<string, unknown> {
  /** Every element carrying the prop. */
  const found = collect(node, prop).filter(props => props[prop] === value)
  expect(found.length).toBe(1)
  return found[0]
}

/**
 * Parse the `left,top,width,height` rectangle grammar every WEB mark publishes.
 * @param text - the mark's value.
 * @returns the rectangle, in the canvas's own pixels.
 */
function parseRect(text: string): Rect {
  /** The four numbers, which a malformed mark leaves short. */
  const parts = text.split(",").map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value))) throw new Error(`the mark ${JSON.stringify(text)} is not a rectangle`)
  return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] }
}

// ── the fixture board: PURE Chinese subjects, which is the case the user reported ────────────────

/** The four subjects, every one a pure-Chinese string with no printable ASCII at all. */
const CHINESE_SUBJECTS: readonly string[] = ["冻结验收契约", "建立头部与进度条", "绘制依赖图的连线", "修复被截断的成员路由"]

/** The WEB payload rows for that board: a chain, so the drawing has edges as well as boxes. */
const CHINESE_BOARD: readonly WebTaskRow[] = CHINESE_SUBJECTS.map((subject, index) => ({
  id: `T${index + 1}`,
  subject,
  kind: index === 0 ? "requirement" : index === 3 ? "repair" : "work",
  visual: "open",
  blockedBy: index === 0 ? [] : [`T${index}`],
  failedBy: [],
  depth: index,
}))

/**
 * The DRAWING's own text on the WEB surface, and NOTHING else.
 *
 * The scope is a LIST, not a subtree guess (freeze risk 3): the node boxes, the edges and the legend
 * lines are the drawing; the roster line, the progress rows, the task list and the pinned detail body
 * legitimately draw raw Chinese and are EXEMPT. Collecting by MARK rather than by walking the panel's
 * DOM is what keeps that boundary exact.
 * @param tree - the rendered tree.
 * @returns the concatenated drawing text.
 */
function webDrawingText(tree: TreeNode): string {
  /** The drawing's parts, in render order. */
  const parts: string[] = []
  for (const props of collect(tree, "data-mpd-node")) parts.push(flatText(props.children as TreeNode))
  for (const props of collect(tree, "data-mpd-edge")) parts.push(flatText(props.children as TreeNode))
  for (const props of collect(tree, "data-mpd-legend")) parts.push(flatText(props.children as TreeNode))
  return parts.join("\n")
}

/** Ten distinct PURE-Chinese subjects, which is what the C1 arms need: no printable ASCII at all. */
const CHINESE_LONG_SUBJECTS: readonly string[] = [
  "冻结验收契约", "建立头部与进度条", "绘制依赖图的连线", "修复被截断的成员路由", "设计冻结说明",
  "曲线的包含性证明", "自然宽度入口", "单元格感知切片", "双向滚轴按键", "真实终端捕获",
]

/**
 * The dependency table of the rank-skipping board, keyed by task id.
 *
 * THE SHAPE MATTERS AND IS MEASURED: a chain of ADJACENT ranks has a gutter only eight pixels wide, so
 * no leg is long enough to carry a corner radius and every edge comes out straight — the containment
 * arm would then be judging straight lines, and the curve-domain control would have nothing to bulge.
 * This table gives the board five ranks and fourteen edges, of which eleven carry a real fillet.
 */
const CHINESE_LONG_DEPS: Readonly<Record<string, readonly string[]>> = {
  T1: [], T2: [], T3: [], T4: [], T5: [],
  T6: ["T2"], T7: ["T2", "T3", "T4", "T6"], T8: ["T7"], T9: ["T2", "T3", "T4", "T5", "T6"], T10: ["T7", "T8", "T9"],
}

/** The rank-skipping payload board these arms are judged on: ten tasks, five ranks, pure Chinese. */
const CHINESE_LONG_BOARD: readonly WebTaskRow[] = Object.keys(CHINESE_LONG_DEPS).map((id, index) => ({
  id,
  subject: CHINESE_LONG_SUBJECTS[index],
  kind: index < 5 ? "work" : index === 9 ? "integration" : "review",
  visual: "open",
  blockedBy: [...CHINESE_LONG_DEPS[id]],
  failedBy: [],
  depth: index,
}))

/** The board's own subjects, joined — the pre-rule input a control measures against. */
function rawSubjects(board: ReadonlyArray<WebTaskRow>): string {
  return board.map(row => row.subject).join("\n")
}

describe("C1/C3 · the WEB drawing is CJK-free while the pinned detail keeps the Chinese", () => {
  test("the fixture really is the reported case: the RAW subjects carry banned characters", () => {
    // Non-vacuity first: if the fixture had no Chinese, every arm below would pass while measuring
    // nothing at all. This is the negative control's own precondition, asserted rather than assumed.
    expect(bannedChars(rawSubjects(CHINESE_BOARD)).length).toBeGreaterThan(0)
    expect(CHINESE_BOARD.length).toBe(4)
  })

  test("ZERO banned characters inside the rendered drawing", async () => {
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_BOARD)
    /** The drawing's text, scoped by mark. */
    const drawing = webDrawingText(rendered.tree)
    // The arm must be able to see a drawing at all: an empty scope would make the assertion below true
    // for the wrong reason, which is exactly the vacuous green clause C5 forbids.
    expect(drawing.length).toBeGreaterThan(0)
    expect(collect(rendered.tree, "data-mpd-node").length).toBe(CHINESE_BOARD.length)
    expect(bannedChars(drawing)).toEqual([])
  })

  test("C3: the pinned detail body still carries the ORIGINAL Chinese subject", async () => {
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_BOARD)
    /** The node whose detail the case pins, chosen because its subject is pure Chinese. */
    const node = one(rendered.tree, "data-mpd-node", "T2")
    /** The node's own click handler, which is how the panel pins a task. */
    const onClick = node.onClick as (() => void) | undefined
    if (typeof onClick !== "function") throw new Error("the WEB node carries no onClick, so its detail cannot be pinned")
    onClick()
    /** The tree after the pin's state update landed. */
    const pinned = await rendered.hooks.act(rendered.component, { sessionId: "s1" } as never)
    /** The pinned detail body's text. */
    const detail = flatText(one(pinned, "data-mpd-detail", "T2").children as TreeNode)
    expect(detail).toContain(CHINESE_BOARD[1].subject)
    // AND THE DRAWING IS NO LESS CJK-FREE FOR IT: the exemption is the detail body, not the drawing.
    expect(bannedChars(webDrawingText(pinned))).toEqual([])
  })

  test("POSITIVE CONTROL: the pre-rule drawing of the SAME board is measurably not CJK-free", () => {
    // The control is not a hypothetical: it is the string the WEB node would have drawn before the
    // rule, built from the same board, and the SAME predicate above finds the violation in it.
    /** The pre-rule drawing text: every node's subject, verbatim, as the node box used to carry it. */
    const preRule = CHINESE_BOARD.map(row => `✓ ${row.id} WRK ${preRuleLabel(row.subject)}`).join("\n")
    expect(bannedChars(preRule).length).toBeGreaterThan(0)
    // The measured baseline of this control is recorded in the evidence log: the pre-rule drawing of a
    // two-task Chinese board carried 14 banned characters.
    expect(bannedChars(preRule).length).toBe(CHINESE_SUBJECTS.join("").length)
  })
})

describe("C4/R3 · both surfaces implement the SAME composer", () => {
  test("the WEB factory exposes `graphSafeLabel`, and it implements the frozen rule over the whole table", () => {
    /** The WEB module under test. */
    const module = webModule()
    if (typeof module.graphSafeLabel !== "function") throw new Error("the WEB factory no longer exposes graphSafeLabel (R3)")
    for (const row of LABEL_CASES) {
      // The ordinal is deliberately NOT the one the fallback would naturally use, so an arm that passed
      // `0` and one that passed `1` cannot both look green: the composer must echo what it was given.
      /** The label the WEB composer produces for this row at ordinal 7. */
      const produced = module.graphSafeLabel(row.subject, 7)
      /** The label the frozen rule demands. */
      const expected = row.fallsBack ? "#7" : row.label
      expect(`[${row.subject}]@7 -> ${produced}`).toBe(`[${row.subject}]@7 -> ${expected}`)
      expect(bannedChars(produced)).toEqual([])
    }
  })

  test("the TUI exports the SAME name and the SAME answers (R3: one concept, one name)", async () => {
    /** The TUI module, probed at run time. */
    const surface = await loadTuiGraph()
    /** The TUI composer, which R3 freezes on this surface too. */
    const composer = surface.graphSafeLabel
    if (typeof composer !== "function") throw new Error("graph.ts no longer exports graphSafeLabel (R3)")
    /** The WEB composer, so the two are compared against each other and not only against the rule. */
    const web = webModule().graphSafeLabel
    for (const row of LABEL_CASES) {
      /** The TUI's answer at ordinal 3. */
      const tui = composer(row.subject, 3)
      /** The WEB's answer at the same ordinal. */
      const fromWeb = web(row.subject, 3)
      /** The frozen rule's answer. */
      const expected = row.fallsBack ? "#3" : row.label
      expect(`[${row.subject}]@3 tui -> ${tui}`).toBe(`[${row.subject}]@3 tui -> ${expected}`)
      expect(`[${row.subject}]@3 web -> ${fromWeb}`).toBe(`[${row.subject}]@3 web -> ${expected}`)
    }
  })

  test("C2: on the WEB the composer is the ONLY thing that turns a subject into drawing text", async () => {
    /** The rendered case over a board whose subjects are pure Chinese. */
    const rendered = await renderWeb(CHINESE_BOARD)
    /** Every node box's text, in the view's own order. */
    const boxes = collect(rendered.tree, "data-mpd-node").map(props => flatText(props.children as TreeNode))
    expect(boxes.length).toBe(CHINESE_BOARD.length)
    for (const [index, box] of boxes.entries()) {
      // The fallback label is the RULE's own output for a subject with no printable ASCII, so a node
      // box carrying anything else would mean a renderer composed its own label (C2's exact violation).
      expect(box).toContain(`#${index + 1}`)
      expect(bannedChars(box)).toEqual([])
    }
    // The node ALSO keeps the original subject in its tooltip, which C3 exempts explicitly. Asserted so
    // the exemption is proven rather than assumed: an arm that stripped it would redden here.
    expect(String(one(rendered.tree, "data-mpd-node", "T1").title)).toBe(CHINESE_BOARD[0].subject)
  })

  test("the ordinal is the 1-based BOARD index, never the rank or the drawn order", () => {
    /** A board served in an order no rank sort would produce: the deepest task first. */
    const scrambled: WebTaskRow[] = [
      { id: "T3", subject: "冻结验收契约", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T1", subject: "冻结验收契约", visual: "open", blockedBy: [], failedBy: [], depth: 0 },
      { id: "T2", subject: "冻结验收契约", visual: "open", blockedBy: ["T1"], failedBy: [], depth: 1 },
    ]
    /** The geometry the view derived from that order. */
    const geometry = webModule().layout(scrambled)
    /** Where each id stood in the array the layout was HANDED. */
    const boardIndex = new Map(scrambled.map((row, index) => [row.id, index + 1]))
    expect(geometry.nodes.length).toBe(scrambled.length)
    for (const node of geometry.nodes) {
      expect(`${node.task.id} ordinal=${node.ordinal}`).toBe(`${node.task.id} ordinal=${boardIndex.get(node.task.id)}`)
    }
    // Non-vacuity: the two orders really do differ on this board, so the arm is not comparing a list
    // with itself. T3 is served FIRST and T2 stands THIRD in the board.
    expect(boardIndex.get("T3")).toBe(1)
    expect(boardIndex.get("T2")).toBe(3)
  })
})

// ── the TUI drawing, probed at run time ─────────────────────────────────────────────────────────

/** One task as the TUI drawing needs it; a structural subset of `GraphTask`, so no import is needed. */
interface TuiTask {
  /** The task id. */
  id: string
  /** The subject, verbatim. */
  subject: string
  /** The kind, abbreviated by the drawing. */
  kind?: string
  /** The rendered state. */
  visual: string
  /** The ids this task is blocked by. */
  dependencies: readonly string[]
  /** The longest dependency path. */
  depth: number
}

/** One rendered TUI row: a list of same-tone spans. */
interface TuiSpan {
  /** The characters. */
  text: string
  /** What they mean. */
  tone: string
}

/** One rendered TUI view, as this file reads it. */
interface TuiView {
  /** The rows, top to bottom. */
  lines: TuiSpan[][]
  /** Which layout was drawn. */
  mode: "boxes" | "rail" | "list"
  /** The cells the drawing occupies. */
  width: number
  /** The tasks taking part in a cycle. */
  cycles: string[]
}

/** The TUI graph's surface, with the wave's frozen names OPTIONAL so an absent one reddens its own arm. */
interface TuiGraphSurface {
  /** R3's composer. */
  graphSafeLabel?: (subject: string, ordinal: number) => string
  /** The adaptive boxes layout, which is the drawing's own entry point. */
  layoutGraph?: (tasks: readonly TuiTask[], cols: number, focus?: string) => TuiView
  /** The natural-width boxes layout (T1). */
  layoutGraphNatural?: (tasks: readonly TuiTask[], focus?: string, budget?: { rows?: number }) => TuiView
  /** The boxes layout, refusing rather than squeezing. */
  layoutBoxes?: (tasks: readonly TuiTask[], cols: number, focus?: string) => TuiView | undefined
  /** The rail fallback. */
  layoutRail?: (tasks: readonly TuiTask[], cols: number, focus?: string) => TuiView
  /** The list fallback. */
  layoutList?: (tasks: readonly TuiTask[], cols: number, focus?: string) => TuiView
  /** The legend lines, which clause C1 bans CJK from as part of the drawing. */
  legendLines?: (cols: number) => string[]
}

/**
 * Load the TUI drawing module at run time.
 *
 * Dynamic on purpose: the wave's frozen names are still landing, and a static import of a name that is
 * not there yet would fail the WHOLE FILE rather than the one clause that names it.
 * @returns the module, typed to the surface this file reads.
 */
async function loadTuiGraph(): Promise<TuiGraphSurface> {
  return (await import("../src/graph")) as unknown as TuiGraphSurface
}

/** The TUI fixture board: the same pure-Chinese chain, in the drawing's own vocabulary. */
const TUI_CHINESE_BOARD: readonly TuiTask[] = CHINESE_SUBJECTS.map((subject, index) => ({
  id: `T${index + 1}`,
  subject,
  kind: index === 0 ? "requirement" : index === 3 ? "repair" : "work",
  visual: "open",
  dependencies: index === 0 ? [] : [`T${index}`],
  depth: index,
}))

/**
 * One TUI view's whole drawn text, row by row.
 * @param view - the rendered view.
 * @returns the rows' texts joined by newlines.
 */
function tuiText(view: TuiView): string {
  return view.lines.map(row => row.map(span => span.text).join("")).join("\n")
}

describe("C1 · the TUI drawing carries no banned character in ANY of its three modes", () => {
  test("boxes, rail and list all draw the pure-Chinese board without one CJK glyph", async () => {
    /** The TUI module under test. */
    const surface = await loadTuiGraph()
    /** The three modes, each with how it is called, so a missing entry point names itself. */
    const modes: Array<{ name: string; draw: () => TuiView }> = []
    if (typeof surface.layoutGraph === "function") modes.push({ name: "boxes", draw: () => (surface.layoutGraph as NonNullable<TuiGraphSurface["layoutGraph"]>)(TUI_CHINESE_BOARD, 200) })
    if (typeof surface.layoutRail === "function") modes.push({ name: "rail", draw: () => (surface.layoutRail as NonNullable<TuiGraphSurface["layoutRail"]>)(TUI_CHINESE_BOARD, 40) })
    if (typeof surface.layoutList === "function") modes.push({ name: "list", draw: () => (surface.layoutList as NonNullable<TuiGraphSurface["layoutList"]>)(TUI_CHINESE_BOARD, 40) })
    // All THREE modes are the C2/C1 subject: a renderer that composed its own label would show up in
    // exactly one of them, which is why a single-mode arm would miss it.
    expect(modes.map(mode => mode.name)).toEqual(["boxes", "rail", "list"])
    for (const mode of modes) {
      /** This mode's drawing. */
      const view = mode.draw()
      /** Its whole drawn text. */
      const text = tuiText(view)
      expect(`${mode.name}: ${text.length > 0}`).toBe(`${mode.name}: true`)
      expect(`${mode.name}: ${JSON.stringify(bannedChars(text))}`).toBe(`${mode.name}: []`)
    }
  })

  test("the legend lines are part of the drawing and are CJK-free too", async () => {
    /** The TUI module under test. */
    const surface = await loadTuiGraph()
    if (typeof surface.legendLines !== "function") throw new Error("graph.ts no longer exports legendLines")
    /** The legend at the widths the panel and the scene draw it. */
    const lines = [surface.legendLines(80), surface.legendLines(40), surface.legendLines(12)].flat()
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(bannedChars(line)).toEqual([])
  })

  test("the drawing really uses the ordinal fallback, per mode, in the same order as the board", async () => {
    /** The TUI module under test. */
    const surface = await loadTuiGraph()
    if (typeof surface.layoutList !== "function") throw new Error("graph.ts no longer exports layoutList")
    /** The list drawing, whose rows are one task each and therefore readable per ordinal. */
    const view = surface.layoutList(TUI_CHINESE_BOARD, 60)
    /** The drawing's text. */
    const text = tuiText(view)
    for (const [index] of TUI_CHINESE_BOARD.entries()) {
      expect(`${index + 1} in drawing: ${text.includes(`#${index + 1}`)}`).toBe(`${index + 1} in drawing: true`)
    }
    // And NOTHING of the raw subjects survived into the drawing.
    for (const subject of CHINESE_SUBJECTS) expect(text.includes(subject)).toBe(false)
  })
})

// ── W3 · the six-step containment proof, over the DRAWN curve ────────────────────────────────────
//
// WHY THE OBVIOUS ARM IS NOT ENOUGH. The bundle's own suite proves that a RECTANGLE route crosses no
// box (`team-view.test.ts`, `entersInterior`). That proof does not transfer to this wave: the painted
// line is now a filleted path with a cubic sweep, so the rectangles ARE the elbow skeleton while the
// curve can bulge outside them — the old arm would stay green while the user saw a line through a box.
// The six steps below are the freeze's (b) replacement, in its own order:
//   1. boxes from the DOM, 2. samples from the pure layout, 3. a DOM<->layout `data-mpd-curve` bridge,
//   4. a SEGMENT-vs-interior test, 5. the existing control plus a CURVE-DOMAIN control, 6. non-vacuity.

/** The WEB layout's edge, typed to what the containment test reads. */
interface ContainmentEdge {
  /** The blocker's id. */
  parent: string
  /** The dependent's id. */
  child: string
  /** The witness the `<g data-mpd-edge>` carries. */
  witness: string
  /** The routing truth, whose count is one half of the non-vacuity floor. */
  segments: Array<{ key: string; rect: Rect }>
  /** The painted form. */
  curve: EdgeCurve
  /** Whether the edge arrives from the right. */
  pointsLeft: boolean
}

/** The layout, typed to the fields the containment test reads. */
interface ContainmentGeometry {
  /** One entry per node. */
  nodes: Array<{ task: { id: string }; rank: number; row: number }>
  /** One entry per drawn dependency. */
  edges: ContainmentEdge[]
}

/** The WEB module's containment surface. */
interface ContainmentModule {
  /** The pure geometry, with the freeze's control parameter. */
  layout: (tasks: ReadonlyArray<Record<string, unknown>>, radius?: number) => ContainmentGeometry
}

/** The slack that keeps a TOUCH from counting as an entry: the border is 1px, this is a millionth. */
const TOUCH_EPSILON = 1e-6

/** The declared column width, read out of the WEB source: the space the DOM marks are published in. */
const WEB_COLUMN_WIDTH = Number(readFileSync(WEB_SOURCE_PATH, "utf8").match(/column:\s*(\d+)/)?.[1])

/** The layout radius the curve-domain control uses: deliberately far past the declared knob. */
const BULGE_RADIUS = 200

/**
 * Every element carrying one string prop, in render order — the ELEMENTS, not only their props.
 *
 * The bridge arm needs the element itself so it can search INSIDE one edge's own group, which a walker
 * that returned bare props bags could not do.
 * @param node - the subtree to walk.
 * @param prop - the prop name.
 * @returns the matching elements, in depth-first order.
 */
function elementsWith(node: TreeNode, prop: string): ElementNode[] {
  /** The matches found so far. */
  const found: ElementNode[] = []
  if (Array.isArray(node)) {
    for (const child of node) found.push(...elementsWith(child, prop))
    return found
  }
  if (node === null || node === undefined || typeof node !== "object") return found
  /** The element under inspection. */
  const element = node as ElementNode
  if (typeof element.props?.[prop] === "string") found.push(element)
  found.push(...elementsWith(element.props?.children as TreeNode, prop))
  return found
}

/**
 * The box without its one-pixel border, which is the area a route may never cover.
 * @param box - the box, as the DOM published it.
 * @returns the interior rectangle.
 */
function interiorOfRect(box: Rect): Rect {
  return { left: box.left + 1, top: box.top + 1, width: box.width - 2, height: box.height - 2 }
}

/**
 * Whether one SEGMENT passes through a box's interior.
 *
 * A SEGMENT and not a point, which is the freeze's step 4: a point-only test can thread a one-pixel
 * line between two samples and report the drawing clear. The test is Liang-Barsky clipping against the
 * interior, so it is exact and needs no sampling-density assumption at all — that is why the density
 * bound W6 used to carry was retired rather than tightened.
 *
 * The interior is shrunk by its border PLUS an epsilon, so an arrival that ABUTS the border it attaches
 * to (every edge does, by W5) is not counted as an entry.
 * @param from - the segment's first sample.
 * @param to - the segment's second sample.
 * @param box - the node box, as the DOM published it.
 * @returns true when the segment crosses the box's interior.
 */
function segmentEntersInterior(from: { x: number; y: number }, to: { x: number; y: number }, box: Rect): boolean {
  /** The interior's left bound, off the border and off a touch. */
  const left = box.left + 1 + TOUCH_EPSILON
  /** The interior's right bound. */
  const right = box.left + box.width - 1 - TOUCH_EPSILON
  /** The interior's top bound. */
  const top = box.top + 1 + TOUCH_EPSILON
  /** The interior's bottom bound. */
  const bottom = box.top + box.height - 1 - TOUCH_EPSILON
  if (right <= left || bottom <= top) return false
  /** How far along the segment the clipped part starts. */
  let enter = 0
  /** How far along the segment the clipped part ends. */
  let exit = 1
  /** The segment's own span, which the slab tests divide by. */
  const dx = to.x - from.x
  /** The segment's vertical span. */
  const dy = to.y - from.y
  /**
   * Clip the segment against one slab, narrowing [enter, exit].
   * @param p - the direction component for this slab.
   * @param q - the distance from the segment's start to the slab's bound.
   * @returns false when the segment cannot intersect the slab.
   */
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    /** Where the segment crosses the slab's bound, as a fraction of its length. */
    const ratio = q / p
    if (p < 0) {
      if (ratio > exit) return false
      if (ratio > enter) enter = ratio
    } else {
      if (ratio < enter) return false
      if (ratio < exit) exit = ratio
    }
    return true
  }
  if (!clip(-dx, from.x - left)) return false
  if (!clip(dx, right - from.x)) return false
  if (!clip(-dy, from.y - top)) return false
  if (!clip(dy, bottom - from.y)) return false
  return exit > enter
}

/**
 * Whether one POINT stands strictly inside a box's interior — the weaker, point-only test.
 * @param point - the sample.
 * @param box - the node box.
 * @returns true when the point is inside the interior.
 */
function insideInteriorOf(point: { x: number; y: number }, box: Rect): boolean {
  /** The box's interior. */
  const inner = interiorOfRect(box)
  return point.x > inner.left && point.x < inner.left + inner.width && point.y > inner.top && point.y < inner.top + inner.height
}

/**
 * Every (segment, box) invasion a polyline commits, named so a failure is readable.
 * @param points - the polyline's samples, in order.
 * @param boxes - every node box, as the DOM published them.
 * @param label - the edge's witness, for the failure message.
 * @returns one string per invasion; an empty array means the polyline is clear.
 */
function invasionsOf(points: Array<{ x: number; y: number }>, boxes: Array<{ id: string; box: Rect }>, label: string): string[] {
  /** The invasions found. */
  const found: string[] = []
  for (let index = 1; index < points.length; index += 1) {
    for (const box of boxes) {
      if (segmentEntersInterior(points[index - 1], points[index], box.box)) found.push(`${label} segment ${index} enters ${box.id}`)
    }
  }
  return found
}

describe("W3 · the DRAWN curve of every WEB edge stays out of every node box", () => {
  test("steps 1-3: the rendered `<path>`'s `data-mpd-curve` IS the layout edge's `curve.d`", async () => {
    /** The rendered case, over the board whose edges really curve. */
    const rendered = await renderWeb(CHINESE_LONG_BOARD)
    /** The layout of the same board, which the samples come from. */
    const geometry = rendered.module.layout(CHINESE_LONG_BOARD)
    /** The drawn edge groups, which carry the witness. */
    const groups = elementsWith(rendered.tree, "data-mpd-edge")
    expect(groups.length).toBe(geometry.edges.length)
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      /** The witness this group announces. */
      const witness = String(group.props["data-mpd-edge"])
      /** The layout edge with that witness, which is the bridge's other half. */
      const edge = geometry.edges.find(candidate => candidate.witness === witness)
      if (edge === undefined) throw new Error(`the render drew ${witness}, which the layout did not route`)
      /** The path inside this edge's own group, which is what the browser paints. */
      const paths = elementsWith(group.props?.children as TreeNode, "data-mpd-curve")
      // W1's structure: ONE path per drawn edge, and its `data-mpd-curve` is the `d` verbatim.
      expect(`${witness} paths=${paths.length}`).toBe(`${witness} paths=1`)
      expect(`${witness} d=${String(paths[0].props["data-mpd-curve"])}`).toBe(`${witness} d=${edge.curve.d}`)
      // WITHOUT THIS BRIDGE THE WHOLE PROOF IS ABOUT A DRAWING NOBODY RENDERED: the samples below come
      // from the LAYOUT while the boxes come from the DOM, so the two must be tied to one artefact.
    }
  })

  test("steps 1, 2, 4: no SEGMENT of any drawn curve enters any rendered box interior", async () => {
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_LONG_BOARD)
    /** The layout of the same board. */
    const geometry = rendered.module.layout(CHINESE_LONG_BOARD)
    /** The boxes, as the DOM published them, keyed by the node mark. */
    const boxes = elementsWith(rendered.tree, "data-mpd-node").map(element => ({ id: String(element.props["data-mpd-node"]), box: parseRect(String(element.props["data-mpd-box"])) }))
    expect(boxes.length).toBe(CHINESE_LONG_BOARD.length)
    /** Every invocation found, across every edge. */
    const invasions: string[] = []
    /** How many segments were actually tested, which is what makes the empty list meaningful. */
    let segments = 0
    for (const edge of geometry.edges) {
      segments += edge.curve.points.length - 1
      invasions.push(...invasionsOf(edge.curve.points, boxes, edge.witness))
    }
    // MEASURED on this board: 14 edges and 555 samples, so the floor below cannot be met by an empty
    // drawing — which is what the first revision of this arm tripped over on the eight-pixel chain.
    expect(segments).toBeGreaterThan(200)
    expect(invasions).toEqual([])
  })

  test("step 6: the proof is NOT vacuous — a sample floor and edges that are really curved", async () => {
    /** The layout under judgement. */
    const geometry = webModule().layout(CHINESE_LONG_BOARD)
    /** How many samples the containment test above walked. */
    let samples = 0
    /** How many edges publish MORE samples than their elbow skeleton has rects. */
    let curved = 0
    for (const edge of geometry.edges) {
      samples += edge.curve.points.length
      if (edge.curve.points.length > edge.segments.length + 1) curved += 1
    }
    // The freeze's step 6, both halves: a sample floor, and a non-zero count of edges whose polyline is
    // a FLATTENING of a curve rather than the skeleton's own corners.
    expect(samples).toBeGreaterThan(200)
    // MEASURED: 11 of the 14 edges publish more samples than their skeleton has rects, so the arm is
    // judging a FLATTENING rather than a rectangle chain.
    expect(curved).toBeGreaterThan(5)
    // And the routing truth is still published beside the curve, so W4's `data-mpd-route` did not lose
    // its meaning while the painted form gained one.
    expect(geometry.edges.every(edge => edge.segments.length > 0)).toBe(true)
  })

  test("step 5a: POSITIVE CONTROL — a segment displaced into a box IS caught, the same one the real curve does not enter", async () => {
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_LONG_BOARD)
    /** The layout of the same board. */
    const geometry = rendered.module.layout(CHINESE_LONG_BOARD)
    /** The boxes, as the DOM published them. */
    const boxes = elementsWith(rendered.tree, "data-mpd-node").map(element => ({ id: String(element.props["data-mpd-node"]), box: parseRect(String(element.props["data-mpd-box"])) }))
    /** The box the bad route is aimed at — a real box, on a real node. */
    const target = boxes[boxes.length - 1]
    /** A REAL edge's samples, with ONE sample moved to the box's centre. */
    const points = geometry.edges[0].curve.points.map(point => ({ ...point }))
    /** The index of the sample the bad router displaces. */
    const at = Math.floor(points.length / 2)
    points[at] = { x: target.box.left + target.box.width / 2, y: target.box.top + target.box.height / 2 }
    /** What the check finds in the bad route. */
    const caught = invasionsOf(points, boxes, "control")
    expect(caught.length).toBeGreaterThan(0)
    expect(caught.some(name => name.includes(target.id))).toBe(true)
    // AND THE CHECK DISCRIMINATES: the REAL polyline at the same sample is inside nothing, so the green
    // above cannot be the accident of a predicate that says "clear" to everything.
    expect(invasionsOf(geometry.edges[0].curve.points, boxes, "real").length).toBe(0)
  })

  test("step 5b: CURVE-DOMAIN CONTROL — a box BETWEEN two samples is caught, which a point-only test misses", async () => {
    // THIS IS THE CONTROL THAT JUSTIFIES THE FREEZE'S STEP 4, and it is the one the freeze's own
    // suggestion cannot reach: "a deliberately huge radius that bulges a sweep into a neighbouring box"
    // CANNOT FIRE on this implementation, and that is a measured property rather than an oversight —
    // the per-vertex clamp `r_i = min(radius, legIn/2, legOut/2)` bounds every fillet by the legs that
    // carry it, so the published polyline stays clear at radius 6, 20, 60 AND 200 (measured: 0
    // invasions at each, on the same 14-edge board). The curve domain therefore has to be probed where
    // it can actually fail: a SEGMENT that threads a box while both of its own samples sit outside.
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_LONG_BOARD)
    /** The boxes, as the DOM published them. */
    const boxes = elementsWith(rendered.tree, "data-mpd-node").map(element => ({ id: String(element.props["data-mpd-node"]), box: parseRect(String(element.props["data-mpd-box"])) }))
    /** A real box to thread, taken from the DOM rather than invented. */
    const target = boxes[boxes.length - 1]
    /** The y at which the threading segment crosses the box, well inside its interior. */
    const through = target.box.top + target.box.height / 2
    // The two samples sit TWO PIXELS OUTSIDE the box's own borders, so a point-only test — the shape
    // the bundle's `entersInterior` arm has — reports this route as completely clear.
    /** A deliberately bad route whose two samples straddle the box and whose segment crosses it. */
    const threaded = [{ x: target.box.left - 2, y: through }, { x: target.box.left + target.box.width + 2, y: through }]
    /** What a POINT-only test would say about the same route. */
    const pointOnly = threaded.filter(point => insideInteriorOf(point, target.box))
    expect(pointOnly.length).toBe(0)
    // AND THE SEGMENT TEST CATCHES IT. This is the whole reason the containment proof moved from points
    // to segments, stated as an executable fact rather than as a comment.
    const caught = invasionsOf(threaded, boxes, "threaded")
    expect(caught.length).toBeGreaterThan(0)
    expect(caught.some(name => name.includes(target.id))).toBe(true)
    // The real curve, on the same box, is still clear — so the control is not a blanket refusal.
    const geometry = rendered.module.layout(CHINESE_LONG_BOARD)
    for (const edge of geometry.edges) expect(invasionsOf(edge.curve.points, boxes, edge.witness)).toEqual([])
  })

  test("step 5c: a sample taken from the MIDDLE of a real fillet, displaced into a box, is caught", async () => {
    // The first control displaces a sample of a straight leg; this one displaces a sample that lies ON a
    // fillet arc, which is where the wave's new geometry actually is.
    //
    // THE BOXES COME FROM THE DOM, AND THE FIRST REVISION OF THIS ARM IS THE REASON WHY. It built them
    // from the layout's rank/row and the declared column width, and they were WRONG: this board's inset
    // is lane-driven (`inset 15`, not the declared minimum 4, because the gutter has to carry fourteen
    // edges), so an arc that grazes the real border at x=153 stood well inside the invented box whose
    // border was at x=164. The rendered `data-mpd-box` is the box the browser paints, which is why every
    // containment arm here reads it rather than re-deriving it.
    /** The rendered case, over the board whose edges really curve. */
    const rendered = await renderWeb(CHINESE_LONG_BOARD)
    /** The layout of the same board. */
    const geometry = rendered.module.layout(CHINESE_LONG_BOARD)
    /** The boxes, as the DOM published them. */
    const boxes = elementsWith(rendered.tree, "data-mpd-node").map(element => ({ id: String(element.props["data-mpd-node"]), box: parseRect(String(element.props["data-mpd-box"])) }))
    // The bridge that makes the displacement meaningful: the samples and the boxes must describe ONE
    // drawing, so the edge's own group is checked to carry the same path the layout published.
    for (const group of elementsWith(rendered.tree, "data-mpd-edge")) {
      /** The witness this group announces. */
      const witness = String(group.props["data-mpd-edge"])
      /** The layout edge with that witness. */
      const edge = geometry.edges.find(candidate => candidate.witness === witness)
      if (edge === undefined) throw new Error(`the render drew ${witness}, which the layout did not route`)
      expect(`${witness} d=${String(elementsWith(group.props?.children as TreeNode, "data-mpd-curve")[0].props["data-mpd-curve"])}`).toBe(`${witness} d=${edge.curve.d}`)
    }
    /** The first edge whose path really curves and whose polyline is a flattening rather than a skeleton. */
    const curved = geometry.edges.find(edge => /[Qq]/.test(edge.curve.d) && edge.curve.points.length > 4)
    if (curved === undefined) throw new Error("no curved edge on this board, so the curve-domain control has nothing to displace")
    /** The box the displaced sample is aimed at — a real box, on a real node. */
    const target = boxes[boxes.length - 1]
    /** The real arc's samples, with one of them moved into the target's interior. */
    const displaced = curved.curve.points.map(point => ({ ...point }))
    /** The sample the control displaces, taken from the MIDDLE of the arc rather than from either end. */
    const at = Math.floor(displaced.length / 2)
    displaced[at] = { x: target.box.left + target.box.width / 2, y: target.box.top + target.box.height / 2 }
    expect(invasionsOf(displaced, boxes, curved.witness).some(name => name.includes(target.id))).toBe(true)
    // And the REAL arc is clear on the same boxes, so the check discriminates on the same input shape.
    expect(invasionsOf(curved.curve.points, boxes, curved.witness)).toEqual([])
  })

  test("W5/W4 on the DOM: `data-mpd-tip` is a ZERO-WIDTH rect at the arrival point", async () => {
    /** The rendered case. */
    const rendered = await renderWeb(CHINESE_BOARD)
    /** The layout of the same board, whose `curve.tip` the mark must encode. */
    const geometry = rendered.module.layout(CHINESE_BOARD)
    /** The drawn edge groups. */
    const groups = elementsWith(rendered.tree, "data-mpd-edge")
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      /** The witness this group announces. */
      const witness = String(group.props["data-mpd-edge"])
      /** The layout edge with that witness. */
      const edge = geometry.edges.find(candidate => candidate.witness === witness)
      if (edge === undefined) throw new Error(`the render drew ${witness}, which the layout did not route`)
      /** The head polygon's tip mark. */
      const marks = elementsWith(group.props?.children as TreeNode, "data-mpd-tip")
      expect(`${witness} tips=${marks.length}`).toBe(`${witness} tips=1`)
      /** The tip rectangle, in the canvas's own pixels. */
      const tip = parseRect(String(marks[0].props["data-mpd-tip"]))
      // ZERO WIDTH is what makes the arrival point DOM-readable at all: the CSS triangle's apex used to
      // be `marker.left + MARK_W` (or `marker.left` for a back edge) and `MARK_W` is published nowhere,
      // so a zero-width rect IS the point — and only `x` needs the direction to be known.
      expect(`${witness} tipWidth=${tip.width}`).toBe(`${witness} tipWidth=0`)
      expect(`${witness} tipX=${tip.left}`).toBe(`${witness} tipX=${edge.curve.tip.x}`)
      expect(`${witness} tipTop=${tip.top}`).toBe(`${witness} tipTop=${edge.curve.tip.y - tip.height / 2}`)
      // The head is drawn on a POLYGON, not a path, so W1's "one `<path>` per drawn edge" stays
      // countable: a head drawn as a path would inflate the very count the docker capture reads.
      expect(`${witness} headPoly=${marks[0].type === "polygon"}`).toBe(`${witness} headPoly=true`)
    }
  })
})
