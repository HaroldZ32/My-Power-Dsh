#!/usr/bin/env node
// THE PICTURE-VS-INPUT GATE (wave `living-graph`, G5 of `.mpd/plans/living-graph.md`).
//
// WHAT IT PROVES. For a fixture plan and a fixture board, `buildModel({board, plan})` must produce
// nodes, edges and a report EQUAL to what that input DECLARES: every board id present, every
// plan-only id drawn as a ghost (`planned: true`), every declared edge present with the right
// `source` (board | plan | both), the six disagreement lists exactly as constructed, and the ranks
// derived from the merged graph. It also proves the model is DETERMINISTIC (two builds are
// byte-identical) and INPUT-ORDER INDEPENDENT (shuffling the arrays changes nothing).
//
// WHY AN INDEPENDENT ORACLE. The expected model is computed HERE, from the parsed plan and the board
// rows, by a hand-written reading of the frozen contract — never by calling `buildModel` twice. A gate
// that compared the implementation to itself would be green forever, which is the exact failure mode
// this file exists to prevent. The oracle is GATE-ONLY: no plane imports it.
//
// THE NEGATIVE CONTROL. `--seed-wrong-edge` flips one produced edge's `source` before the comparison;
// the gate must then exit non-zero with a line naming that edge. `--self-test` runs BOTH directions
// (positive green, seeded negative red) PLUS the path forms, so one command proves the gate
// discriminates rather than merely runs.
//
// USAGE
//   node scripts/verify-graph-model.ts                      the inline default fixture
//   node scripts/verify-graph-model.ts --emit               ... and print the model snapshot
//   node scripts/verify-graph-model.ts --fixture <dir>      read <dir>/plan.md + <dir>/board.json
//   node scripts/verify-graph-model.ts --board <b> --plan <p>
//   node scripts/verify-graph-model.ts --seed-wrong-edge    the seeded negative control
//   node scripts/verify-graph-model.ts --self-test          both directions + the path forms
//
// The fixture board file is a JSON array of `BoardTask` rows (`{id, subject, blockedBy, status, …}`)
// or an object carrying them under `tasks`. The fixture plan is ORDINARY TASK-PLAN MARKDOWN — the
// real grammar this repository's plan files use (`## TODOs` with `- [ ] N. …`, a lane/owner table,
// `## Final Verification Wave` with `- [ ] F<n>. …`, and `(blocked by: …)` / `blocked_by: …` forms) —
// because a fixture in an invented dialect would test the parser against something nothing writes.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildModel } from "../packages/mpd-graph-core/src/model.ts"
import { parsePlanMarkdown } from "../packages/mpd-graph-core/src/plan.ts"
import type { BoardTask, GraphEdge, GraphModel, GraphNode, PlanDocument } from "../packages/mpd-graph-core/src/types.ts"

/** This script's own path, used by `--self-test` to spawn the gate for the exit-code arms. */
const SELF = fileURLToPath(import.meta.url)
/** The prefix every line of this gate prints, so a log line names its producer. */
const PREFIX = "[verify-graph-model]"

/**
 * The id order the contract states: a numeric collator with base sensitivity.
 *
 * Spelled HERE rather than imported from the core on purpose: an oracle that borrows the
 * implementation's own comparator could not detect a change to it.
 * @param left - one id.
 * @param right - the other id.
 * @returns the comparator's ordering.
 */
function idCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
}

/**
 * A value's canonical JSON: object keys sorted recursively, so equality is independent of key order.
 * @param value - any JSON-shaped value.
 * @returns its canonical string form.
 */
function canonical(value: unknown): string {
  /** The value as canonical JSON. */
  const render = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(render)
    if (node !== null && typeof node === "object") {
      /** The object's own keys, sorted. */
      const keys = Object.keys(node as Record<string, unknown>).sort()
      /** The rendered entries in key order. */
      const out: Record<string, unknown> = {}
      for (const key of keys) out[key] = render((node as Record<string, unknown>)[key])
      return out
    }
    return node
  }
  return JSON.stringify(render(value))
}

/**
 * The status-to-visual mapping the contract states for a board row with no computed visual.
 * @param status - the durable status.
 * @returns one of the six renderer states.
 */
function statusVisual(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "claimed":
    case "in_progress":
      return "running"
    case "blocked":
      return "blocked"
    default:
      return "open"
  }
}

/** The visuals a renderer already knows; anything else falls through to the status mapping. */
const RENDER_VISUALS: ReadonlySet<string> = new Set(["completed", "running", "failed", "blocked", "open", "cancelled"])

/**
 * The visual a board row draws in, by the contract: a computed visual wins, else the status maps.
 * @param task - the board row.
 * @returns the renderer state.
 */
function visualOf(task: BoardTask): string {
  return task.visual !== undefined && RENDER_VISUALS.has(task.visual) ? task.visual : statusVisual(task.status)
}

/**
 * The rank a board-supplied `depth` claims, which is the ONE served fallback the contract allows.
 * @param depth - the served depth, when the board carries one.
 * @returns the non-negative integer rank.
 */
function servedRankOf(depth: number | undefined): number {
  return typeof depth === "number" && Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0
}

/**
 * The longest resolved-blocker path of every id — the oracle's own derivation.
 *
 * Deliberately independent of `rank.ts`: iterative, cycle-safe, and a closing cycle edge contributes
 * nothing, which is the stated rule. The gate must be able to redden if the core's derivation changes.
 * @param ids - every node id, sorted.
 * @param deps - each id's declared blocker references (unresolved ones included).
 * @returns the rank of every id.
 */
function deriveRanksOracle(ids: readonly string[], deps: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  /** The id set, so a reference that resolves to nothing is skipped. */
  const known = new Set(ids)
  /** The settled rank of every id. */
  const settled = new Map<string, number>()
  /** The ids on the current walk. */
  const walking = new Set<string>()
  for (const root of ids) {
    if (settled.has(root)) continue
    /** The walk's frames: the id and how many of its blockers were expanded. */
    const stack: Array<{ id: string; next: number }> = [{ id: root, next: 0 }]
    walking.add(root)
    while (stack.length > 0) {
      /** The frame being worked. */
      const frame = stack[stack.length - 1]
      /** This id's references that RESOLVE to a node. */
      const resolved = (deps.get(frame.id) ?? []).filter((dep) => known.has(dep))
      if (frame.next < resolved.length) {
        /** The next reference to expand. */
        const dependency = resolved[frame.next]
        frame.next += 1
        if (settled.has(dependency) || walking.has(dependency)) continue
        walking.add(dependency)
        stack.push({ id: dependency, next: 0 })
        continue
      }
      /** The longest chain under this id, one longer than its deepest resolved blocker. */
      let deepest = 0
      for (const dependency of resolved) deepest = Math.max(deepest, (settled.get(dependency) ?? 0) + 1)
      settled.set(frame.id, deepest)
      walking.delete(frame.id)
      stack.pop()
    }
  }
  return settled
}

/**
 * The ids that take part in a dependency cycle — the oracle's own walk.
 * @param ids - every node id.
 * @param deps - each id's declared blocker references.
 * @returns the cyclic ids, sorted.
 */
function cycleIdsOracle(ids: readonly string[], deps: ReadonlyMap<string, readonly string[]>): string[] {
  /** Ids whose subtree was fully walked. */
  const done = new Set<string>()
  /** The current walk, in visit order. */
  const stack: string[] = []
  /** Membership of `stack`. */
  const onStack = new Set<string>()
  /** Ids proven cyclic. */
  const cyclic = new Set<string>()
  /**
   * Walk one id's references.
   * @param id - the id to visit.
   */
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (onStack.has(id)) {
      for (const entry of stack.slice(stack.indexOf(id))) cyclic.add(entry)
      return
    }
    if (!deps.has(id)) return
    onStack.add(id)
    stack.push(id)
    for (const dependency of deps.get(id) ?? []) if (deps.has(dependency)) visit(dependency)
    stack.pop()
    onStack.delete(id)
    done.add(id)
  }
  for (const id of ids) visit(id)
  return [...cyclic].sort(idCompare)
}

/**
 * The model the fixture DECLARES, computed by this gate's own reading of the contract.
 * @param plan - the parsed plan (the fixture's markdown, parsed by the real parser).
 * @param board - the fixture's board rows.
 * @returns the expected model.
 */
function expectedModel(plan: PlanDocument, board: readonly BoardTask[]): GraphModel {
  /** The board rows by id; a repeated id keeps the last row, as the contract says. */
  const boardById = new Map<string, BoardTask>()
  for (const row of board) boardById.set(row.id, row)
  /** The plan's tasks by id. */
  const planById = new Map(plan.tasks.map((task) => [task.id, task]))
  /** Every id either input names, ordered by the stated collator. */
  const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort(idCompare)
  /** The id set, so an edge or a reference that names nothing is dropped/reported. */
  const known = new Set(ids)
  /** Each id's declared blocker references: the UNION of both sides, sorted. */
  const deps = new Map<string, string[]>()
  for (const id of ids) {
    /** The board's own blockers for this id. */
    const boardRefs = boardById.get(id)?.blockedBy ?? []
    /** The plan's own blockers for this id. */
    const planRefs = planById.get(id)?.blockedBy ?? []
    deps.set(id, [...new Set([...boardRefs, ...planRefs])].sort(idCompare))
  }
  /** How many declared references resolve to a node, which decides the served-depth fallback. */
  let resolvedCount = 0
  for (const refs of deps.values()) for (const ref of refs) if (known.has(ref)) resolvedCount += 1
  /** The ranks the board's `depth` claims, which only draw when the graph says nothing. */
  const served = new Map<string, number>(ids.map((id) => [id, servedRankOf(boardById.get(id)?.depth)]))
  /** Whether the served depths claim any structure at all. */
  const servedVaries = new Set(served.values()).size > 1
  /** The rank of every id: derived, or the documented served fallback when nothing resolves. */
  const rankOf = resolvedCount === 0 && servedVaries ? served : deriveRanksOracle(ids, deps)
  /** The deepest rank, so every bucket from 0 to it exists. */
  const deepest = ids.reduce((max, id) => Math.max(max, rankOf.get(id) ?? 0), 0)
  /** The rank buckets as ids, each sorted, exactly as the serialized model carries them. */
  const ranks: string[][] = Array.from({ length: ids.length === 0 ? 0 : deepest + 1 }, () => [] as string[])
  for (const id of ids) ranks[Math.min(Math.max(0, rankOf.get(id) ?? 0), deepest)].push(id)
  for (const bucket of ranks) bucket.sort(idCompare)
  /** Every declared edge pair, merged so the two inputs meet on one edge. */
  const declared = new Map<string, { from: string; to: string; board: boolean; plan: boolean }>()
  /**
   * The join key for an edge pair.
   * @param from - the blocker id.
   * @param to - the blocked id.
   * @returns a key no id can collide with.
   */
  const pairKey = (from: string, to: string): string => `${from}\u0000${to}`
  for (const row of board) {
    for (const from of row.blockedBy ?? []) {
      /** The merged entry, created on first sight. */
      const entry = declared.get(pairKey(from, row.id)) ?? { from, to: row.id, board: false, plan: false }
      entry.board = true
      declared.set(pairKey(from, row.id), entry)
    }
  }
  for (const task of plan.tasks) {
    for (const from of task.blockedBy) {
      /** The merged entry, created on first sight. */
      const entry = declared.get(pairKey(from, task.id)) ?? { from, to: task.id, board: false, plan: false }
      entry.plan = true
      declared.set(pairKey(from, task.id), entry)
    }
  }
  /** The drawable edges: both ends must be nodes, and the source records who declared the pair. */
  const edges: GraphEdge[] = []
  for (const entry of declared.values()) {
    if (!known.has(entry.from) || !known.has(entry.to)) continue
    edges.push({ from: entry.from, to: entry.to, source: entry.board && entry.plan ? "both" : entry.plan ? "plan" : "board" })
  }
  edges.sort((left, right) => idCompare(left.from, right.from) || idCompare(left.to, right.to))
  /** The nodes, each carrying the fields the contract says it carries. */
  const nodes: GraphNode[] = ids.map((id) => {
    /** The board row, when the board carries this id. */
    const row = boardById.get(id)
    /** The plan task, when the plan declares this id. */
    const task = planById.get(id)
    /** The owner: the board's assignment wins over the plan's lane owner. */
    const assignee = row?.owner ?? task?.owner
    /** The plan's own title, carried beside the board's subject. */
    const title = task?.title
    return {
      id,
      subject: row?.subject ?? task?.title ?? id,
      visual: row === undefined ? "planned" : visualOf(row),
      dependencies: deps.get(id) ?? [],
      depth: rankOf.get(id) ?? row?.depth ?? 0,
      planned: row === undefined,
      ...(row?.kind === undefined ? {} : { kind: row.kind }),
      ...(assignee === undefined ? {} : { assignee }),
      ...(title === undefined ? {} : { title }),
      ...(row?.status === undefined ? {} : { status: row.status }),
    }
  })
  /** Blocker references that resolve to no node, sorted and de-duplicated. */
  const unresolved = [...new Set([...deps.values()].flat().filter((ref) => !known.has(ref)))].sort(idCompare)
  return {
    nodes,
    edges,
    ranks,
    cycles: cycleIdsOracle(ids, deps),
    report: {
      boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
      planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id)),
      edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
      edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
      planProblems: [...plan.problems],
      unresolved,
      ranksDerived: !(resolvedCount === 0 && servedVaries),
    },
  }
}

/**
 * Every way the produced model differs from the declared expectation.
 *
 * Each returned line names what differed and both values, because a failure a reader has to decode is
 * a failure that gets waved through.
 * @param model - the produced model.
 * @param expected - the model the input declares.
 * @returns one line per failed expectation; empty means equal.
 */
function checkModel(model: GraphModel, expected: GraphModel): string[] {
  /** The failed expectations. */
  const failures: string[] = []
  /** The produced nodes by id. */
  const actualNodes = new Map(model.nodes.map((node) => [node.id, node]))
  /** The expected nodes by id. */
  const expectedNodes = new Map(expected.nodes.map((node) => [node.id, node]))
  /** The produced node ids, in the model's own order. */
  const actualOrder = model.nodes.map((node) => node.id)
  /** The declared node ids, in the order the contract states. */
  const expectedOrder = expected.nodes.map((node) => node.id)
  if (canonical(actualOrder) !== canonical(expectedOrder)) failures.push(`node order: expected ${JSON.stringify(expectedOrder)} got ${JSON.stringify(actualOrder)}`)
  for (const id of expectedOrder) {
    /** The produced node for this id. */
    const actual = actualNodes.get(id)
    if (actual === undefined) {
      failures.push(`node ${id}: missing from the model`)
      continue
    }
    /** The declared node for this id. */
    const want = expectedNodes.get(id) as GraphNode
    if (canonical(actual) !== canonical(want)) failures.push(`node ${id}: expected ${canonical(want)} got ${canonical(actual)}`)
  }
  for (const id of actualOrder) if (!expectedNodes.has(id)) failures.push(`node ${id}: unexpected in the model`)
  /** The pair key a failure line names an edge by. */
  const edgeKey = (edge: GraphEdge): string => `${edge.from}→${edge.to}`
  /** The produced edges by pair. */
  const actualEdges = new Map(model.edges.map((edge) => [edgeKey(edge), edge]))
  /** The declared edges by pair. */
  const expectedEdges = new Map(expected.edges.map((edge) => [edgeKey(edge), edge]))
  for (const [key, want] of expectedEdges) {
    /** The produced edge for this pair. */
    const actual = actualEdges.get(key)
    if (actual === undefined) {
      failures.push(`edge ${key}: missing (expected source "${want.source}")`)
      continue
    }
    if (actual.source !== want.source) failures.push(`edge ${key}: expected source "${want.source}" got "${actual.source}"`)
    if (actual.from !== want.from || actual.to !== want.to) failures.push(`edge ${key}: endpoints differ (got ${edgeKey(actual)})`)
  }
  for (const key of actualEdges.keys()) if (!expectedEdges.has(key)) failures.push(`edge ${key}: unexpected in the model`)
  if (canonical(model.edges) !== canonical(expected.edges)) failures.push(`edge list: expected ${canonical(expected.edges)} got ${canonical(model.edges)}`)
  if (canonical(model.ranks) !== canonical(expected.ranks)) failures.push(`ranks: expected ${canonical(expected.ranks)} got ${canonical(model.ranks)}`)
  if (canonical(model.cycles) !== canonical(expected.cycles)) failures.push(`cycles: expected ${canonical(expected.cycles)} got ${canonical(model.cycles)}`)
  /** The report fields compared one by one, so a failure names the list that differs. */
  const fields: ReadonlyArray<keyof GraphModel["report"]> = ["boardOnly", "planOnly", "edgePlanOnly", "edgeBoardOnly", "planProblems", "unresolved", "ranksDerived"]
  for (const field of fields) {
    if (canonical(model.report[field]) !== canonical(expected.report[field])) failures.push(`report.${field}: expected ${canonical(expected.report[field])} got ${canonical(model.report[field])}`)
  }
  return failures
}

/** The fixture this gate's default run checks, with its inline golden cross-check. */
interface Fixture {
  /** The plan markdown, in the repository's real task-plan grammar. */
  planText: string
  /** The board rows the host would read from `.mpd/team/teams/<id>.json`. */
  board: BoardTask[]
  /** The six cases hard-coded independently of the oracle; absent for a caller-authored fixture. */
  golden?: Golden
}

/** The default fixture's six-case expectations, written from the contract and NOT from the oracle. */
interface Golden {
  /** The merged node ids, in draw order. */
  nodeIds: string[]
  /** Every declared edge with the source that declared it. */
  edges: GraphEdge[]
  /** The disagreement lists, the derivation's report and the one unreadable plan line. */
  report: {
    /** Ids only the board carries. */
    boardOnly: string[]
    /** Ids the plan declares and the board does not (the ghosts). */
    planOnly: string[]
    /** Edges only the plan declares. */
    edgePlanOnly: GraphEdge[]
    /** Edges only the board carries. */
    edgeBoardOnly: GraphEdge[]
    /** Blocker references that name no node. */
    unresolved: string[]
    /** Whether the derivation, not the served depth, drew. */
    ranksDerived: boolean
    /** The one line the tolerant parser refuses, verbatim. */
    planProblem: { text: string; reason: string }
  }
}

/** The line the default plan deliberately leaves unreadable, so `planProblems` is non-empty. */
const GOLDEN_PLAN_PROBLEM_TEXT = "- [ ] a half-typed line the tolerant parser must REPORT"

/** The reason the parser gives for that line, which the report must carry verbatim. */
const GOLDEN_PLAN_PROBLEM_REASON = "not a numbered TODO item"

/** The inline default plan: the real grammar, five TODOs, one lane table, two final-wave items. */
const DEFAULT_PLAN = [
  "# Fixture plan — the gate's declared input",
  "",
  "## TODOs",
  "",
  "- [ ] 1. A. Build the shared model",
  "- [ ] 2. B. Adopt the shared model (blocked by: 1)",
  "- [ ] 3. C. Serve the ranks on both planes",
  "- [ ] 4. D. Gate the picture against the plan (blocked_by: 2, 3)",
  "- [ ] 5. E. Verify the wave independently",
  GOLDEN_PLAN_PROBLEM_TEXT,
  "",
  "| Lane | Owner |",
  "| --- | --- |",
  "| A | Senior Engineer |",
  "| B | Junior Engineer |",
  "| C | Deep Worker |",
  "| D | Junior Engineer |",
  "| E | Reviewer |",
  "",
  "## Final Verification Wave",
  "",
  "- [ ] F1. Prove both planes draw one model",
  "- [ ] F2. Prove the live refresh (blocked by: F1)",
].join("\n")

/** The inline default board: ids on both sides, a plan-only ghost, a board-only row, a dangling ref. */
const DEFAULT_BOARD: BoardTask[] = [
  { id: "T1", subject: "Build the shared model", kind: "requirement", status: "completed", owner: "Senior Engineer", blockedBy: [], depth: 0 },
  { id: "T2", subject: "Adopt the shared model", kind: "work", status: "in_progress", owner: "Junior Engineer", blockedBy: ["T1"], depth: 1 },
  { id: "T3", subject: "Serve the ranks", kind: "work", status: "pending", blockedBy: [], depth: 0 },
  { id: "T4", subject: "Gate the picture", kind: "work", status: "pending", owner: "Junior Engineer", blockedBy: ["T1", "T3"], depth: 2 },
  { id: "T9", subject: "Board-only sidetrack", kind: "work", status: "cancelled", blockedBy: ["T4", "T99"], depth: 3 },
]

/**
 * The default fixture, with the golden's plan-problem line computed from the plan text itself.
 * @returns the fixture the no-argument run checks.
 */
function defaultFixture(): Fixture {
  /** The 1-based line the deliberately unreadable plan line sits on. */
  const problemLine = DEFAULT_PLAN.split("\n").indexOf(GOLDEN_PLAN_PROBLEM_TEXT) + 1
  return {
    planText: DEFAULT_PLAN,
    board: DEFAULT_BOARD,
    golden: {
      // Hard-coded in the order the contract states (numeric id collator), NOT computed with the
      // oracle's comparator: a change to that ordering must redden this expectation.
      nodeIds: ["F1", "F2", "T1", "T2", "T3", "T4", "T5", "T9"],
      edges: [
        { from: "F1", to: "F2", source: "plan" },
        { from: "T1", to: "T2", source: "both" },
        { from: "T1", to: "T4", source: "board" },
        { from: "T2", to: "T4", source: "plan" },
        { from: "T3", to: "T4", source: "both" },
        { from: "T4", to: "T9", source: "board" },
      ],
      report: {
        boardOnly: ["T9"],
        planOnly: ["F1", "F2", "T5"],
        edgePlanOnly: [
          { from: "F1", to: "F2", source: "plan" },
          { from: "T2", to: "T4", source: "plan" },
        ],
        edgeBoardOnly: [
          { from: "T1", to: "T4", source: "board" },
          { from: "T4", to: "T9", source: "board" },
        ],
        unresolved: ["T99"],
        ranksDerived: true,
        planProblem: { text: GOLDEN_PLAN_PROBLEM_TEXT, reason: GOLDEN_PLAN_PROBLEM_REASON },
      },
    },
  }
}

/**
 * Compare the produced model with the default fixture's hard-coded six-case expectations.
 * @param model - the produced model.
 * @param golden - the contract's own expectations.
 * @returns one line per failed expectation.
 */
function checkGolden(model: GraphModel, golden: Golden): string[] {
  /** The failed expectations. */
  const failures: string[] = []
  if (canonical(model.nodes.map((node) => node.id)) !== canonical(golden.nodeIds)) failures.push(`golden node ids: expected ${canonical(golden.nodeIds)} got ${canonical(model.nodes.map((node) => node.id))}`)
  if (canonical(model.edges) !== canonical(golden.edges)) failures.push(`golden edges: expected ${canonical(golden.edges)} got ${canonical(model.edges)}`)
  /** The golden report fields compared one by one. */
  const fields: ReadonlyArray<keyof Omit<Golden["report"], "planProblem">> = ["boardOnly", "planOnly", "edgePlanOnly", "edgeBoardOnly", "unresolved", "ranksDerived"]
  for (const field of fields) {
    if (canonical(model.report[field]) !== canonical(golden.report[field])) failures.push(`golden report.${field}: expected ${canonical(golden.report[field])} got ${canonical(model.report[field])}`)
  }
  /** The one plan problem the model must carry, verbatim. */
  const problem = model.report.planProblems[0]
  if (model.report.planProblems.length !== 1) failures.push(`golden report.planProblems: expected 1 entry got ${model.report.planProblems.length}`)
  else if (problem.text !== golden.report.planProblem.text || problem.reason !== golden.report.planProblem.reason) failures.push(`golden report.planProblems[0]: expected ${canonical(golden.report.planProblem)} got ${canonical({ text: problem.text, reason: problem.reason })}`)
  return failures
}

/**
 * Flip ONE produced edge's source, which is the gate's negative control.
 * @param model - the produced model.
 * @returns the seeded model and a one-line note naming what was changed.
 */
function seedWrongEdge(model: GraphModel): { model: GraphModel; note: string } {
  if (model.edges.length === 0) return { model, note: "there is no edge to seed a wrong one from" }
  /** The edge the seed mutates: the first in the model's own order, so the arm is deterministic. */
  const first = model.edges[0]
  /** The wrong source: any value other than the declared one. */
  const flipped: GraphEdge["source"] = first.source === "board" ? "plan" : "board"
  /** The seeded edges. */
  const edges = model.edges.map((edge, index) => (index === 0 ? { ...edge, source: flipped } : edge))
  return { model: { ...model, edges }, note: `${first.from}→${first.to}: source "${first.source}" seeded to "${flipped}"` }
}

/**
 * Load a fixture from a directory carrying `plan.md` and `board.json`.
 * @param dir - the fixture directory.
 * @returns the fixture; no golden, because the caller authored the input.
 */
function loadFixtureDir(dir: string): Fixture {
  return loadFixturePaths(join(dir, "plan.md"), join(dir, "board.json"))
}

/**
 * Load a fixture from explicit plan and board paths.
 * @param planPath - the plan markdown path.
 * @param boardPath - the board JSON path.
 * @returns the fixture.
 */
function loadFixturePaths(planPath: string, boardPath: string): Fixture {
  /** The plan markdown, verbatim. */
  const planText = readFileSync(planPath, "utf8")
  /** The parsed board JSON, which is an array or an object carrying `tasks`. */
  const raw: unknown = JSON.parse(readFileSync(boardPath, "utf8"))
  /** The rows, when they are an array. */
  const rows = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" && Array.isArray((raw as { tasks?: unknown }).tasks) ? (raw as { tasks: unknown[] }).tasks : undefined
  if (rows === undefined) fail(`the board file ${boardPath} is neither an array nor an object carrying a \`tasks\` array`)
  /** The usable board rows: anything without a string id is refused rather than dropped silently. */
  const board: BoardTask[] = []
  for (const row of rows) {
    if (row === null || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string") fail(`the board file ${boardPath} carries a row with no string id: ${canonical(row)}`)
    // The row is narrowed to "object with a string id" only; the remaining fields are the fixture
    // author's declaration and are judged by the comparison, so a structural cast is the honest form.
    board.push(row as BoardTask)
  }
  return { planText, board }
}

/**
 * Print one failure line and exit non-zero — the CLI's own fatal path.
 * @param message - what went wrong; never returns.
 * @returns never.
 */
function fail(message: string): never {
  console.error(`${PREFIX} FAIL: ${message}`)
  process.exit(1)
}

/** The parsed invocation. */
interface Cli {
  /** Whether `--self-test` was requested. */
  selfTest: boolean
  /** Whether the model snapshot should be printed. */
  emit: boolean
  /** Whether the negative control should seed a wrong edge. */
  seedWrongEdge: boolean
  /** The fixture directory, when `--fixture` was given. */
  fixtureDir?: string
  /** The explicit board path, when `--board` was given. */
  boardPath?: string
  /** The explicit plan path, when `--plan` was given. */
  planPath?: string
  /** Whether `--help` was requested. */
  help: boolean
}

/**
 * Parse this gate's arguments.
 * @param argv - the arguments after the script name.
 * @returns the parsed invocation.
 */
function parseCli(argv: readonly string[]): Cli {
  /** The invocation under construction. */
  const cli: Cli = { selfTest: false, emit: false, seedWrongEdge: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    /** The current argument. */
    const arg = argv[index]
    if (arg === "--self-test") cli.selfTest = true
    else if (arg === "--emit") cli.emit = true
    else if (arg === "--seed-wrong-edge") cli.seedWrongEdge = true
    else if (arg === "--help" || arg === "-h") cli.help = true
    else if (arg === "--fixture" || arg === "--board" || arg === "--plan") {
      /** The value that must follow the flag. */
      const value = argv[index + 1]
      if (value === undefined) fail(`${arg} needs a value`)
      index += 1
      if (arg === "--fixture") cli.fixtureDir = value
      else if (arg === "--board") cli.boardPath = value
      else cli.planPath = value
    } else fail(`unknown argument ${arg}`)
  }
  if (cli.fixtureDir !== undefined && (cli.boardPath !== undefined || cli.planPath !== undefined)) fail("--fixture cannot be combined with --board/--plan")
  if ((cli.boardPath === undefined) !== (cli.planPath === undefined)) fail("--board and --plan must be given together")
  return cli
}

/** The help text, printed by `--help`. */
const HELP = [
  "usage: node scripts/verify-graph-model.ts [--fixture <dir> | --board <path> --plan <path>]",
  "",
  "  --emit              print the serialized model snapshot",
  "  --seed-wrong-edge   flip one edge (the negative control) and expect a non-zero exit",
  "  --self-test         run both directions plus the path forms",
  "  --help              print this text",
].join("\n")

/**
 * Run one check over a fixture and report it.
 * @param fixture - the fixture to check.
 * @param cli - the invocation (its `emit` and `seedWrongEdge` flags drive the output).
 * @returns the process exit code: 0 when equal, 1 otherwise.
 */
function runFixture(fixture: Fixture, cli: Cli): number {
  /** The parsed plan, through the REAL parser. */
  const plan = parsePlanMarkdown(fixture.planText)
  /** The model the core builds from exactly this input. */
  const model = buildModel({ board: fixture.board, plan })
  /** The model the input declares, by this gate's own reading. */
  const expected = expectedModel(plan, fixture.board)
  if (cli.emit) console.log(JSON.stringify(model, null, 2))
  /** The model the comparison judges — mutated only by the deliberate negative control. */
  let judged = model
  if (cli.seedWrongEdge) {
    /** The seeded model and the note naming its changed edge. */
    const seeded = seedWrongEdge(model)
    judged = seeded.model
    console.log(`${PREFIX} negative control: ${seeded.note}`)
  }
  /** Every failed expectation. */
  const failures = checkModel(judged, expected)
  if (fixture.golden !== undefined) failures.push(...checkGolden(judged, fixture.golden))
  if (failures.length > 0) {
    for (const line of failures) console.log(`${PREFIX} FAIL ${line}`)
    console.log(`${PREFIX} FAIL — ${failures.length} expectation(s) did not hold`)
    return 1
  }
  console.log(`${PREFIX} PASS — nodes (${model.nodes.length}), edges (${model.edges.length}), ranks, cycles and the report equal the declared input`)
  return 0
}

/** One self-test arm: its name, whether it held, and the detail printed beside it. */
interface Arm {
  /** What the arm proves. */
  name: string
  /** Whether it held. */
  ok: boolean
  /** The observed detail, bounded before it is printed. */
  detail: string
}

/**
 * Spawn this gate as a child process, which is how the exit-code arms are measured.
 * @param args - the arguments for the child.
 * @returns the child's exit status and its combined output.
 */
function spawnGate(args: readonly string[]): { status: number; output: string } {
  /** The child's result. */
  const result = spawnSync(process.execPath, [SELF, ...args], { encoding: "utf8" })
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` }
}

/**
 * Drive both directions and the path forms; hermetic (temp files only, always cleaned).
 * @returns the process exit code: 0 when every arm held.
 */
function selfTest(): number {
  /** The arms, in run order. */
  const arms: Arm[] = []
  /** The default fixture. */
  const fixture = defaultFixture()
  /** The parsed default plan. */
  const plan = parsePlanMarkdown(fixture.planText)
  /** The model built from the default input. */
  const model = buildModel({ board: fixture.board, plan })
  /** The declared expectation. */
  const expected = expectedModel(plan, fixture.board)
  /** The positive arm's failures: the oracle AND the golden must both hold. */
  const positive = checkModel(model, expected).concat(fixture.golden === undefined ? [] : checkGolden(model, fixture.golden))
  arms.push({ name: "positive: the default model equals its declared input (oracle + golden)", ok: positive.length === 0, detail: positive[0] ?? "0 mismatches" })
  /** The second build of the same input, for the determinism arm. */
  const again = buildModel({ board: fixture.board, plan })
  arms.push({ name: "determinism: two builds serialize byte-identically", ok: canonical(model) === canonical(again), detail: canonical(model) === canonical(again) ? "identical" : "the two builds differ" })
  /** The plan with every array reversed, so input order cannot leak into the output. */
  const shuffledPlan: PlanDocument = { ...plan, tasks: [...plan.tasks].reverse().map((task) => ({ ...task, blockedBy: [...task.blockedBy].reverse() })), problems: [...plan.problems].reverse() }
  /** The model built from reversed inputs. */
  const shuffled = buildModel({ board: [...fixture.board].reverse(), plan: shuffledPlan })
  arms.push({ name: "input-order independence: reversed board and plan arrays build the same model", ok: canonical(shuffled) === canonical(model), detail: canonical(shuffled) === canonical(model) ? "identical" : "order leaked into the model" })
  /** The seeded model and its note. */
  const seeded = seedWrongEdge(model)
  /** The seeded model's failures: the gate must refuse it and name the edge. */
  const seededFailures = checkModel(seeded.model, expected)
  /** Whether at least one failure names the seeded edge. */
  const namesEdge = seededFailures.some((line) => line.includes("→"))
  arms.push({ name: "negative: a seeded wrong edge is refused and NAMED", ok: seededFailures.length > 0 && namesEdge, detail: seededFailures[0] ?? "the seeded edge was accepted" })
  /** A throwaway directory for the path-form arms. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-graph-gate-"))
  try {
    /** The plan file the path forms read. */
    const planPath = join(dir, "plan.md")
    /** The board file the path forms read. */
    const boardPath = join(dir, "board.json")
    writeFileSync(planPath, fixture.planText)
    writeFileSync(boardPath, JSON.stringify(fixture.board, null, 2))
    /** The `--fixture <dir>` run: the arm writes the same files a lane E author would. */
    const dirRun = spawnGate(["--fixture", dir])
    arms.push({ name: "--fixture <dir> loads plan.md + board.json and exits 0", ok: dirRun.status === 0, detail: `exit ${dirRun.status}: ${dirRun.output.trim().split("\n").slice(-1)[0] ?? ""}` })
    /** The explicit-path run. */
    const pathRun = spawnGate(["--board", boardPath, "--plan", planPath])
    arms.push({ name: "--board <path> --plan <path> loads the explicit files and exits 0", ok: pathRun.status === 0, detail: `exit ${pathRun.status}: ${pathRun.output.trim().split("\n").slice(-1)[0] ?? ""}` })
    /** The spawned negative control: non-zero AND the seeded edge named. */
    const negativeRun = spawnGate(["--fixture", dir, "--seed-wrong-edge"])
    arms.push({ name: "--seed-wrong-edge exits non-zero and names the edge", ok: negativeRun.status !== 0 && negativeRun.output.includes("→"), detail: `exit ${negativeRun.status}: ${negativeRun.output.trim().split("\n").filter((line) => line.includes("→"))[0] ?? "(no edge named)"}` })
    /** The snapshot run: exit 0 and a serialized model on stdout. */
    const emitRun = spawnGate(["--fixture", dir, "--emit"])
    arms.push({ name: "--emit prints the serialized model and still exits by the check", ok: emitRun.status === 0 && emitRun.output.includes("\"nodes\"") && emitRun.output.includes("\"report\""), detail: `exit ${emitRun.status}, snapshot=${emitRun.output.includes("\"nodes\"") ? "present" : "missing"}` })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  for (const arm of arms) console.log(`${PREFIX} self-test ${arm.ok ? "PASS" : "FAIL"} — ${arm.name} :: ${arm.detail.slice(0, 240)}`)
  /** How many arms failed. */
  const failed = arms.filter((arm) => !arm.ok).length
  if (failed > 0) {
    console.log(`${PREFIX} self-test FAIL — ${failed} of ${arms.length} arm(s) did not hold`)
    return 1
  }
  console.log(`${PREFIX} self-test PASS — ${arms.length} arms: both directions and the path forms`)
  return 0
}

/** The invocation this process was started with. */
const cli = parseCli(process.argv.slice(2))
if (cli.help) {
  console.log(HELP)
  process.exit(0)
}
if (cli.selfTest) {
  process.exit(selfTest())
}
/** The fixture this run judges: an explicit one when paths were given, else the inline default. */
const fixture = cli.fixtureDir !== undefined ? loadFixtureDir(resolve(cli.fixtureDir)) : cli.boardPath !== undefined && cli.planPath !== undefined ? loadFixturePaths(resolve(cli.planPath), resolve(cli.boardPath)) : defaultFixture()
process.exit(runFixture(fixture, cli))
