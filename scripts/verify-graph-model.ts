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
// THE GROUP ARM (`cellwork` wave 4, `.mpd/plans/cellwork-w4-contract.md` D1). `--grouped` checks a
// NESTED fixture — a root frame, a subcell blocked by the root and spawned by one of its tasks, and a
// sub-subcell whose task names both an inner blocker and an unknown id — against a SECOND independent
// oracle that derives the frames, the anchoring and each frame's own ranks by hand. `--seed-wrong-anchor`
// is its negative control: it un-anchors one box edge, which the gate must refuse by NAMING the pair.
//
// USAGE
//   node scripts/verify-graph-model.ts                      the inline default (flat) fixture
//   node scripts/verify-graph-model.ts --emit               ... and print the model snapshot
//   node scripts/verify-graph-model.ts --fixture <dir>      read <dir>/plan.md + <dir>/board.json
//   node scripts/verify-graph-model.ts --board <b> --plan <p>
//   node scripts/verify-graph-model.ts --grouped            the nested (group) fixture
//   node scripts/verify-graph-model.ts --seed-wrong-edge    the flat seeded negative control
//   node scripts/verify-graph-model.ts --seed-wrong-anchor   the grouped seeded negative control
//   node scripts/verify-graph-model.ts --self-test          both directions, the group arms, the path forms
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
import type { BoardTask, GraphEdge, GraphGroup, GraphGroupInput, GraphModel, GraphNode, PlanDocument } from "../packages/mpd-graph-core/src/types.ts"

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
  // THE DE-DUPLICATED ROWS, not the raw array: the contract keeps the LAST row for a repeated board
  // id, so an oracle that iterated `board` would read blockers from a row the model discarded.
  for (const row of boardById.values()) {
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
  // THE GROUPS TRAVEL AS ONE VALUE: a flat model carries no `groups` key on either side, so this
  // comparison also pins the backward guarantee at the gate (not only in the package's own test).
  if (canonical(model.groups) !== canonical(expected.groups)) failures.push(`groups: expected ${canonical(expected.groups)} got ${canonical(model.groups)}`)
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
  /** Whether `--grouped` was requested: check the built-in nested fixture on its own. */
  grouped: boolean
  /** Whether the negative control should seed a WRONG BOX ANCHOR. */
  seedWrongAnchor: boolean
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
  const cli: Cli = { selfTest: false, emit: false, seedWrongEdge: false, grouped: false, seedWrongAnchor: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    /** The current argument. */
    const arg = argv[index]
    if (arg === "--self-test") cli.selfTest = true
    else if (arg === "--emit") cli.emit = true
    else if (arg === "--seed-wrong-edge") cli.seedWrongEdge = true
    else if (arg === "--grouped") cli.grouped = true
    else if (arg === "--seed-wrong-anchor") cli.seedWrongAnchor = true
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
  if (cli.grouped && (cli.fixtureDir !== undefined || cli.boardPath !== undefined)) fail("--grouped checks the built-in nested fixture and cannot be combined with --fixture/--board/--plan")
  return cli
}

/** The help text, printed by `--help`. */
const HELP = [
  "usage: node scripts/verify-graph-model.ts [--grouped] [--fixture <dir> | --board <path> --plan <path>]",
  "",
  "  (no argument)       check the flat fixture (the six-case table), as before groups existed",
  "  --grouped           check the built-in nested (group) fixture",
  "  --emit              print the serialized model snapshot of the fixture being checked",
  "  --seed-wrong-edge   flip one edge (the negative control) and expect a non-zero exit",
  "  --seed-wrong-anchor un-anchor one box edge (the grouped negative control)",
  "  --self-test         run both directions, the grouped arms and the path forms",
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
  /** The pair the seed actually flipped, so the failure line must name EXACTLY that edge. */
  const seededPair = `${seeded.model.edges[0]?.from ?? ""}→${seeded.model.edges[0]?.to ?? ""}`
  /** Whether at least one failure names the seeded edge (not merely some edge, and not an arrow). */
  const namesEdge = seededFailures.some((line) => line.includes(`edge ${seededPair}:`))
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
    /** The snapshot run: exit 0 and a serialized model on stdout. */
    const emitRun = spawnGate(["--fixture", dir, "--emit"])
    arms.push({ name: "--emit prints the serialized model and still exits by the check", ok: emitRun.status === 0 && emitRun.output.includes("\"nodes\"") && emitRun.output.includes("\"report\""), detail: `exit ${emitRun.status}, snapshot=${emitRun.output.includes("\"nodes\"") ? "present" : "missing"}` })
    /** The snapshot parsed back, so the negative arm can name the edge the seed will flip. */
    let emitted: GraphModel | undefined
    try {
      emitted = JSON.parse(emitRun.output.slice(emitRun.output.indexOf("{"), emitRun.output.lastIndexOf("}") + 1)) as GraphModel
    } catch {
      emitted = undefined
    }
    /** The pair the seed flips: the gate always mutates the FIRST edge in model order. */
    const seededPair = emitted?.edges[0] === undefined ? "" : `${emitted.edges[0].from}→${emitted.edges[0].to}`
    /** The spawned negative control. */
    const negativeRun = spawnGate(["--fixture", dir, "--seed-wrong-edge"])
    // THE ARM REQUIRES THE NAMED FAILURE, not just a non-zero exit: a gate that reddened for an
    // unrelated reason would satisfy "exit !== 0" while proving nothing about the seeded edge, so the
    // FAIL line must name exactly the pair the seed mutated.
    const named = seededPair !== "" && negativeRun.output.includes(`FAIL edge ${seededPair}:`)
    arms.push({ name: "--seed-wrong-edge exits non-zero and a FAIL line NAMES the edge", ok: negativeRun.status !== 0 && named, detail: `exit ${negativeRun.status}: ${negativeRun.output.trim().split("\n").filter((line) => line.includes("FAIL edge"))[0] ?? "(no edge named)"}` })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  /** The built-in grouped fixture, the same tree `--grouped` checks. */
  const groupFixture = defaultGroupFixture()
  /** The nested model, built once for the positive arms. */
  const groupModel = buildGroupedModel(groupFixture)
  /** The tree's declared model, by the gate's own reading. */
  const groupExpected = expectedGroupedModel(groupFixture)
  /** The nested positive arm: the oracle AND the hand-written golden must both hold. */
  const groupedPositive = checkModel(groupModel, groupExpected).concat(checkGroupedGolden(groupModel, groupFixture.golden))
  arms.push({ name: "grouped positive: the nested model equals its declared tree (oracle + golden)", ok: groupedPositive.length === 0, detail: groupedPositive[0] ?? "0 mismatches" })
  /** The second build of the same tree, for the nested determinism arm. */
  const groupedAgain = buildGroupedModel(groupFixture)
  arms.push({ name: "grouped determinism: two builds of the tree serialize byte-identically", ok: canonical(groupModel) === canonical(groupedAgain), detail: canonical(groupModel) === canonical(groupedAgain) ? "identical" : "the two builds differ" })
  /** The nested model built from every array reversed, so input order cannot leak into a frame. */
  const groupedShuffled = buildModel({ board: [...groupFixture.board].reverse(), plan: parsePlanMarkdown(groupFixture.planText), groups: reversedGroupInputs(groupFixture.groups) })
  arms.push({ name: "grouped input-order independence: reversed boards and subcells build the same tree", ok: canonical(groupedShuffled) === canonical(groupModel), detail: canonical(groupedShuffled) === canonical(groupModel) ? "identical" : "order leaked into the nested model" })
  /** The flat model of the default fixture: the backward guarantee, at the gate. */
  const flatModel = buildModel({ board: fixture.board, plan })
  /** Whether the flat model stayed flat: no `groups` key, and no node claiming a frame. */
  const stayedFlat = !Object.prototype.hasOwnProperty.call(flatModel, "groups") && flatModel.nodes.every((node) => !("group" in node))
  arms.push({ name: "backward: a model built with no group carries no groups key and no node frame", ok: stayedFlat, detail: stayedFlat ? "flat, as before groups existed" : "a group leaked into a flat model" })
  /** The grouped snapshot, so the arm can name the pair the seed will un-anchor. */
  const groupedEmit = spawnGate(["--grouped", "--emit"])
  /** The snapshot parsed back, when it parses. */
  let groupedSnapshot: GraphModel | undefined
  try {
    groupedSnapshot = JSON.parse(groupedEmit.output.slice(groupedEmit.output.indexOf("{"), groupedEmit.output.lastIndexOf("}") + 1)) as GraphModel
  } catch {
    groupedSnapshot = undefined
  }
  /** The pair the seed un-anchors: the first edge with a box as an endpoint. */
  const seededAnchorPair = firstBoxEdgePair(groupedSnapshot)
  /** The spawned grouped negative control. */
  const anchorRun = spawnGate(["--grouped", "--seed-wrong-anchor"])
  // THE ARM REQUIRES THE NAMED FAILURE: a red exit for an unrelated reason would prove nothing about
  // the un-anchored box edge, so the FAIL line must name exactly the pair the seed moved.
  const anchorNamed = seededAnchorPair !== "" && anchorRun.output.includes(`FAIL edge ${seededAnchorPair}:`)
  arms.push({ name: "--seed-wrong-anchor exits non-zero and a FAIL line NAMES the un-anchored box edge", ok: anchorRun.status !== 0 && anchorNamed, detail: `exit ${anchorRun.status}: ${anchorRun.output.trim().split("\n").filter((line) => line.includes("FAIL edge"))[0] ?? "(no edge named)"}` })
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

/**
 * The plain codepoint order, used ONLY to compare two collections as SETS.
 *
 * The collation order a fixture's ids draw in is the oracle's business; a second opinion on it here
 * would make the golden depend on the platform's ICU build instead of on the contract, so the golden
 * states membership and leaves ordering to the oracle.
 * @param left - one value.
 * @param right - the other value.
 * @returns the codepoint comparison.
 */
function plainCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Two collections compared as SETS, for the golden's arms.
 * @param values - the values, in any order.
 * @returns the distinct values in codepoint order.
 */
function asSet(values: readonly string[]): string[] {
  return [...new Set(values)].sort(plainCompare)
}

/** One frame of a GROUPED fixture: its own plan text and board rows, plus its nested subcells. */
interface GroupFixture {
  /** The group id, which is the box's id and its pseudo-node id inside the parent frame. */
  id: string
  /** The box title. */
  label: string
  /** The task that spawned this subcell, when the fixture declares one. */
  originTaskId?: string
  /** The frame's plan markdown, in the repository's task-plan grammar; omitted means no plan. */
  planText?: string
  /** The frame's own board rows. */
  board: BoardTask[]
  /** The subcells nested inside this one. */
  groups: GroupFixture[]
}

/** The grouped fixture `--grouped` checks, with the hand-written expectations that judge it. */
interface GroupedFixture {
  /** The root frame's plan markdown. */
  planText: string
  /** The root frame's board rows. */
  board: BoardTask[]
  /** The root frame's subcells. */
  groups: GroupFixture[]
  /** The expectations written BY HAND from the contract, independent of the oracle AND of the core. */
  golden: GroupedGolden
}

/** The grouped fixture's hand-written expectations, stated as sets so no ICU build can move them. */
interface GroupedGolden {
  /** Every node id of the whole tree, as a SET. */
  nodeIds: string[]
  /** Each node's frame, column and visual, keyed by id, so the golden states the ranking rule itself. */
  placement: Record<string, { depth: number; group?: string; visual: string }>
  /** Every drawn edge as `from→to(source)`, as a SET. */
  edges: string[]
  /** The boxes, shallow-first, exactly as the model must serialize them. */
  groups: GraphGroup[]
  /** The root frame's rank buckets, which are the only buckets the model carries. */
  ranks: string[][]
  /** The disagreement lists the merge must report across the whole tree. */
  report: {
    /** Ids a frame's board carries and its plan does not. */
    boardOnly: string[]
    /** Ids a frame's plan declares and its board does not (the ghosts inside boxes included). */
    planOnly: string[]
    /** Edges only a plan declared, as `from→to`. */
    edgePlanOnly: string[]
    /** Edges only a board carried, as `from→to`. */
    edgeBoardOnly: string[]
    /** References that name no task and no group anywhere in the tree. */
    unresolved: string[]
  }
}

/** One frame as the grouped oracle resolves it: its input, its place in the tree, its own merge. */
interface OracleFrame {
  /** The group id, or `null` for the root frame. */
  id: string | null
  /** The box title, or `null` for the root frame. */
  label: string | null
  /** The enclosing frame, or `null` for the root frame. */
  parent: OracleFrame | null
  /** Nesting depth: `-1` for the root frame, `0` for a box inside it. */
  depth: number
  /** The spawn origin, when the fixture declares one. */
  originTaskId?: string
  /** The frame's parsed plan. */
  plan: PlanDocument
  /** The frame's board rows. */
  board: readonly BoardTask[]
  /** The nested frames, ordered by the id collator. */
  children: OracleFrame[]
}

/** One frame's own merge, as the grouped oracle resolves it. */
interface OracleRows {
  /** The frame's own ids, ordered by the collator. */
  ids: string[]
  /** Each id's declared blockers: the union of both sides, sorted. */
  deps: Map<string, string[]>
  /** The frame's own task nodes, columns still to be resolved. */
  nodes: GraphNode[]
  /** Ids the frame's board carries and its plan does not. */
  boardOnly: string[]
  /** Ids the frame's plan declares and its board does not. */
  planOnly: string[]
}

/** One pair as a frame declared it, before the attachment rule anchors it. */
interface OraclePair {
  /** The blocker id. */
  from: string
  /** The blocked id. */
  to: string
  /** Whether the frame's board declared the pair. */
  board: boolean
  /** Whether the frame's plan declared the pair. */
  plan: boolean
  /** Whether the model derives the pair from a spawn origin instead of reading it. */
  derived: boolean
}

/** The grouped fixture's root plan: two TODOs whose edge the root board agrees with. */
const GROUPED_ROOT_PLAN = ["# Grouped fixture plan", "", "## TODOs", "", "- [ ] 1. Root build", "- [ ] 2. Root adopt (blocked by: 1)", "- [ ] 3. Root verify"].join("\n")

/**
 * The subcell's plan: ONE final-wave item, so its GHOST lives inside the box and its id cannot collide
 * with the root plan's `T<n>` ids (which is what a per-frame plan has to prove here).
 */
const GROUPED_SUBCELL_PLAN = ["## Final Verification Wave", "", "- [ ] F1. Subcell verification"].join("\n")

/** The grouped fixture's root board: a completed task, one waiting on it, and one waiting INSIDE a box. */
const GROUPED_ROOT_BOARD: BoardTask[] = [
  { id: "T1", subject: "Root build", kind: "work", status: "completed", owner: "Senior Engineer", blockedBy: [], depth: 0 },
  { id: "T2", subject: "Root adopt", kind: "work", status: "in_progress", blockedBy: ["T1"], depth: 1 },
  { id: "T3", subject: "Root verify", kind: "work", status: "pending", blockedBy: ["E1"], depth: 2 },
]

/**
 * The built-in grouped fixture, which exercises EVERY branch of the attachment rule at the GATE:
 *
 * - `teamB` waits on the root (`B1` names `T1`) while the root's `T2` spawned it — the derived edge;
 * - `teamB`'s interior holds a further box `teamB1`, whose task names one blocker inside `teamB` and one
 *   id that exists nowhere (`T99`), so the box→box lift and `report.unresolved` are both drawn;
 * - the sibling `teamC` waits on a task INSIDE `teamB` (`E1` names `B1`), which is the contract's
 *   GROUP→GROUP branch (`teamB→teamC` at the root frame);
 * - the root's `T3` waits on `E1`, a task INSIDE `teamC`, which is the outer-blocked-by-inner case the
 *   repair had to rank from the DRAWN edge (`teamC→T3`) rather than from the authored reference.
 * @returns the fixture the `--grouped` run and the self-test's grouped arms check.
 */
function defaultGroupFixture(): GroupedFixture {
  return {
    planText: GROUPED_ROOT_PLAN,
    board: GROUPED_ROOT_BOARD,
    groups: [
      {
        id: "teamB",
        label: "Subcell B",
        originTaskId: "T2",
        planText: GROUPED_SUBCELL_PLAN,
        board: [
          { id: "B1", subject: "Child build", kind: "work", status: "in_progress", blockedBy: ["T1"] },
          { id: "B2", subject: "Child adopt", kind: "work", status: "pending", blockedBy: ["B1"] },
        ],
        groups: [
          {
            id: "teamB1",
            label: "Subcell B1",
            originTaskId: "B2",
            board: [{ id: "D1", subject: "Grandchild work", kind: "work", status: "pending", blockedBy: ["B1", "T99"] }],
            groups: [],
          },
        ],
      },
      {
        id: "teamC",
        label: "Subcell C",
        board: [{ id: "E1", subject: "Sibling work", kind: "work", status: "pending", blockedBy: ["B1"] }],
        groups: [],
      },
    ],
    golden: {
      // Written in the order the tree draws them, NOT read back off the model: an id list that came
      // from the implementation would agree with a wrong model forever.
      nodeIds: ["B1", "B2", "D1", "E1", "F1", "T1", "T2", "T3", "teamB", "teamB1", "teamC"],
      placement: {
        T1: { depth: 0, visual: "completed" },
        T2: { depth: 1, visual: "running" },
        teamB: { depth: 2, visual: "group" },
        teamC: { depth: 3, visual: "group" },
        T3: { depth: 4, visual: "open" },
        B1: { depth: 0, group: "teamB", visual: "running" },
        B2: { depth: 1, group: "teamB", visual: "open" },
        F1: { depth: 0, group: "teamB", visual: "planned" },
        teamB1: { depth: 2, group: "teamB", visual: "group" },
        D1: { depth: 0, group: "teamB1", visual: "open" },
        E1: { depth: 0, group: "teamC", visual: "open" },
      },
      edges: [
        "B1→B2(board)",
        "B1→teamB1(board)",
        "B2→teamB1(derived)",
        "T1→T2(both)",
        "T1→teamB(board)",
        "T2→teamB(derived)",
        // THE CONTRACT'S GROUP→GROUP BRANCH, stated in the golden so it cannot go unexercised again.
        "teamB→teamC(board)",
        // THE OUTER-BLOCKED-BY-INNER BRANCH: the root's T3 waits for a task inside teamC.
        "teamC→T3(board)",
      ],
      groups: [
        { id: "teamB", label: "Subcell B", parentId: null, memberIds: ["B1", "B2", "F1", "teamB1"], depth: 0, originTaskId: "T2" },
        { id: "teamC", label: "Subcell C", parentId: null, memberIds: ["E1"], depth: 0 },
        { id: "teamB1", label: "Subcell B1", parentId: "teamB", memberIds: ["D1"], depth: 1, originTaskId: "B2" },
      ],
      ranks: [["T1"], ["T2"], ["teamB"], ["teamC"], ["T3"]],
      report: {
        boardOnly: ["B1", "B2", "D1", "E1"],
        planOnly: ["F1"],
        edgePlanOnly: [],
        edgeBoardOnly: ["T1→teamB", "teamB→teamC", "teamC→T3", "B1→B2", "B1→teamB1"],
        unresolved: ["T99"],
      },
    },
  }
}

/**
 * Turn one declared subcell into the input the core takes, parsing its plan with the REAL parser.
 * @param group - the fixture's subcell.
 * @returns the group input, nested.
 */
function groupInputOf(group: GroupFixture): GraphGroupInput {
  return {
    id: group.id,
    label: group.label,
    board: group.board,
    groups: group.groups.map((child) => groupInputOf(child)),
    ...(group.originTaskId === undefined ? {} : { originTaskId: group.originTaskId }),
    ...(group.planText === undefined ? {} : { plan: parsePlanMarkdown(group.planText) }),
  }
}

/**
 * Build the model a grouped fixture declares.
 * @param fixture - the fixture.
 * @returns the model the core builds from its tree.
 */
function buildGroupedModel(fixture: GroupedFixture): GraphModel {
  return buildModel({ board: fixture.board, plan: parsePlanMarkdown(fixture.planText), groups: fixture.groups.map((group) => groupInputOf(group)) })
}

/**
 * The same subcells with every array reversed, so the input-order arm reaches the nesting too.
 * @param groups - the subcells to reverse.
 * @returns the reversed subcells, recursively.
 */
function reversedGroupInputs(groups: readonly GroupFixture[]): GraphGroupInput[] {
  return [...groups].reverse().map((group) => ({
    id: group.id,
    label: group.label,
    board: [...group.board].reverse(),
    groups: reversedGroupInputs(group.groups),
    ...(group.originTaskId === undefined ? {} : { originTaskId: group.originTaskId }),
    ...(group.planText === undefined ? {} : { plan: parsePlanMarkdown(group.planText) }),
  }))
}

/**
 * Collect one declared subcell into an oracle frame, recursively.
 * @param group - the fixture's subcell.
 * @param parent - the frame that contains it.
 * @returns the frame, its own children ordered by the id collator.
 */
function collectOracleFrame(group: GroupFixture, parent: OracleFrame): OracleFrame {
  /** The frame under construction. */
  const frame: OracleFrame = {
    id: group.id,
    label: group.label,
    parent,
    depth: parent.depth + 1,
    plan: parsePlanMarkdown(group.planText ?? ""),
    board: group.board,
    children: [],
    ...(group.originTaskId === undefined ? {} : { originTaskId: group.originTaskId }),
  }
  frame.children = group.groups.map((child) => collectOracleFrame(child, frame)).sort((left, right) => idCompare(left.id ?? "", right.id ?? ""))
  return frame
}

/**
 * One frame's path up to the root, starting at the frame itself.
 * @param frame - the frame to walk from.
 * @returns the frames from `frame` to the root.
 */
function oraclePath(frame: OracleFrame): OracleFrame[] {
  /** The frames on the way up. */
  const path: OracleFrame[] = []
  for (let cursor: OracleFrame | null = frame; cursor !== null; cursor = cursor.parent) path.push(cursor)
  return path
}

/**
 * The deepest frame two frames share, which is the frame that draws an edge between them.
 * @param left - one endpoint's frame.
 * @param right - the other endpoint's frame.
 * @returns the lowest common ancestor frame.
 */
function lowestCommonOracleFrame(left: OracleFrame, right: OracleFrame): OracleFrame {
  /** The right frame's chain, so the left walk stops at the first shared frame. */
  const rightPath = oraclePath(right)
  for (const candidate of oraclePath(left)) if (rightPath.includes(candidate)) return candidate
  return lowestCommonOracleFrame(left, left)
}

/**
 * The id that represents one endpoint inside the frame that draws the edge.
 * @param frame - the frame holding the endpoint.
 * @param home - the shared frame the edge is drawn in.
 * @param id - the endpoint's id.
 * @returns `id` itself when the frame is the shared one, else the box one level below it.
 */
function anchorOracleAt(frame: OracleFrame, home: OracleFrame, id: string): string {
  if (frame === home) return id
  /** The path from the frame up to the root; the entry directly below `home` is the box that represents it. */
  const path = oraclePath(frame)
  /** That box, when the path really passes through `home`. */
  const below = path[path.indexOf(home) - 1]
  return below?.id ?? id
}

/**
 * Place one oracle pair in the frame that draws it, by the contract's attachment rule.
 * @param pairs - each frame's merged pairs, mutated in place.
 * @param frameOf - which frame holds each id.
 * @param entry - the pair as a frame declared (or derived) it.
 */
function placeOraclePair(pairs: Map<OracleFrame, Map<string, OraclePair>>, frameOf: ReadonlyMap<string, OracleFrame>, entry: OraclePair): void {
  /** The frame holding the blocker. */
  const fromFrame = frameOf.get(entry.from)
  /** The frame holding the blocked id. */
  const toFrame = frameOf.get(entry.to)
  if (fromFrame === undefined || toFrame === undefined) return
  /** The frame that draws this line. */
  const home = lowestCommonOracleFrame(fromFrame, toFrame)
  /** The re-anchored blocker. */
  const from = anchorOracleAt(fromFrame, home, entry.from)
  /** The re-anchored blocked id. */
  const to = anchorOracleAt(toFrame, home, entry.to)
  if (entry.derived && from === to) return
  /** The drawing frame's pair index. */
  const held = pairs.get(home)
  if (held === undefined) return
  /** The pair's merged entry. */
  const merged = held.get(`${from}\u0000${to}`) ?? { from, to, board: false, plan: false, derived: false }
  merged.board = merged.board || entry.board
  merged.plan = merged.plan || entry.plan
  merged.derived = merged.derived || entry.derived
  held.set(`${from}\u0000${to}`, merged)
}

/**
 * The model a grouped fixture DECLARES, computed here by this gate's own reading of the contract.
 *
 * It never calls `buildModel`: the frames, the anchoring, the per-frame ranking and the flattened
 * picture are all derived here from the fixture and `deriveRanksOracle`/`cycleIdsOracle`, which is what
 * makes a green run mean "the core agrees with the contract" instead of "the core agrees with itself".
 * @param fixture - the grouped fixture.
 * @returns the model the tree declares.
 */
function expectedGroupedModel(fixture: GroupedFixture): GraphModel {
  /** The root frame. */
  const root: OracleFrame = { id: null, label: null, parent: null, depth: -1, plan: parsePlanMarkdown(fixture.planText), board: fixture.board, children: [] }
  root.children = fixture.groups.map((group) => collectOracleFrame(group, root)).sort((left, right) => idCompare(left.id ?? "", right.id ?? ""))
  /** Every frame, pre-order. */
  const frames: OracleFrame[] = []
  /**
   * Walk the tree in pre-order.
   * @param frame - the frame to visit.
   */
  const walk = (frame: OracleFrame): void => {
    frames.push(frame)
    for (const child of frame.children) walk(child)
  }
  walk(root)
  /** Each frame's own merge. */
  const rows = new Map<OracleFrame, OracleRows>()
  for (const frame of frames) {
    /** The frame's board rows by id; the last row wins. */
    const boardById = new Map<string, BoardTask>()
    for (const row of frame.board) boardById.set(row.id, row)
    /** The frame's plan tasks by id. */
    const planById = new Map(frame.plan.tasks.map((task) => [task.id, task]))
    /** Every id the frame names, ordered by the collator. */
    const ids = [...new Set([...boardById.keys(), ...planById.keys()])].sort(idCompare)
    /** Each id's declared blockers: the union of both sides, sorted. */
    const deps = new Map<string, string[]>()
    for (const id of ids) deps.set(id, [...new Set([...(boardById.get(id)?.blockedBy ?? []), ...(planById.get(id)?.blockedBy ?? [])])].sort(idCompare))
    /** The frame's nodes, columns still unset. */
    const nodes: GraphNode[] = ids.map((id) => {
      /** The board row, when the board carries this id. */
      const row = boardById.get(id)
      /** The plan task, when the plan declares this id. */
      const task = planById.get(id)
      /** The owner: the board's assignment wins over the plan's lane owner. */
      const assignee = row?.owner ?? task?.owner
      return {
        id,
        subject: row?.subject ?? task?.title ?? id,
        visual: row === undefined ? "planned" : visualOf(row),
        dependencies: deps.get(id) ?? [],
        depth: row?.depth ?? 0,
        planned: row === undefined,
        ...(row?.kind === undefined ? {} : { kind: row.kind }),
        ...(assignee === undefined ? {} : { assignee }),
        ...(task?.title === undefined ? {} : { title: task.title }),
        ...(row?.status === undefined ? {} : { status: row.status }),
        ...(frame.id === null ? {} : { group: frame.id }),
      }
    })
    rows.set(frame, {
      ids,
      deps,
      nodes,
      boardOnly: ids.filter((id) => boardById.has(id) && !planById.has(id)),
      planOnly: ids.filter((id) => planById.has(id) && !boardById.has(id)),
    })
  }
  /** Which frame holds each id: every task, and every group's box. */
  const frameOf = new Map<string, OracleFrame>()
  for (const frame of frames) for (const node of rows.get(frame)?.nodes ?? []) frameOf.set(node.id, frame)
  /** The box of each group frame, drawn as a node of its parent frame. */
  const pseudos: GraphNode[] = []
  /** The nodes drawn inside each frame: its own tasks plus its child boxes. */
  const level = new Map<OracleFrame, GraphNode[]>()
  for (const frame of frames) level.set(frame, [...(rows.get(frame)?.nodes ?? [])])
  for (const frame of frames) {
    if (frame.id === null || frame.label === null || frame.parent === null) continue
    /** The frame that draws this box. */
    const parent = frame.parent
    /** The box itself. */
    const pseudo: GraphNode = { id: frame.id, subject: frame.label, visual: "group", dependencies: [], depth: 0, planned: false, ...(parent.id === null ? {} : { group: parent.id }) }
    frameOf.set(frame.id, parent)
    pseudos.push(pseudo)
    level.get(parent)?.push(pseudo)
  }
  /** The pairs each frame will draw. */
  const pairs = new Map<OracleFrame, Map<string, OraclePair>>()
  for (const frame of frames) pairs.set(frame, new Map())
  for (const frame of frames) {
    /** The frame's board rows by id; the last row wins. */
    const boardById = new Map<string, BoardTask>()
    for (const row of frame.board) boardById.set(row.id, row)
    for (const row of boardById.values()) for (const from of row.blockedBy ?? []) placeOraclePair(pairs, frameOf, { from, to: row.id, board: true, plan: false, derived: false })
    for (const task of frame.plan.tasks) for (const from of task.blockedBy) placeOraclePair(pairs, frameOf, { from, to: task.id, board: false, plan: true, derived: false })
  }
  for (const frame of frames) {
    if (frame.id === null || frame.originTaskId === undefined) continue
    if (!frameOf.has(frame.originTaskId)) continue
    placeOraclePair(pairs, frameOf, { from: frame.originTaskId, to: frame.id, board: false, plan: false, derived: true })
  }
  /** The blockers each node is DRAWN with, per frame: the oracle's own reading of the attachment rule. */
  const drawnDeps = new Map<OracleFrame, Map<string, string[]>>()
  for (const frame of frames) {
    /** This frame's per-node blockers, in pair order. */
    const blockers = new Map<string, string[]>()
    /** This frame's merged pairs. */
    const held = pairs.get(frame)
    if (held !== undefined) {
      for (const entry of held.values()) {
        /** The blockers already listed under the blocked id. */
        const list = blockers.get(entry.to)
        if (list === undefined) blockers.set(entry.to, [entry.from])
        else list.push(entry.from)
      }
    }
    drawnDeps.set(frame, blockers)
  }
  for (const pseudo of pseudos) {
    /** The frame that draws this box. */
    const parent = frameOf.get(pseudo.id)
    if (parent === undefined) continue
    /** The blockers the attachment rule anchored onto this box. */
    pseudo.dependencies = [...new Set(drawnDeps.get(parent)?.get(pseudo.id) ?? [])].sort(idCompare)
  }
  /** The root frame's rank buckets, which are the only buckets the model carries. */
  let rootRanks: string[][] = []
  for (const frame of frames) {
    /** The nodes drawn inside this frame. */
    const nodes = level.get(frame) ?? []
    /** The blockers this frame DRAWS onto each node: the column follows the LINES, not the authored text. */
    const drawn = drawnDeps.get(frame) ?? new Map<string, string[]>()
    /** How many drawn lines reach a node of this frame; every one of them resolves by construction. */
    let resolved = 0
    for (const blockers of drawn.values()) resolved += blockers.length
    /** The served depths this frame's rows claim, which draw only when the frame's graph says nothing. */
    const served = new Map(nodes.map((node) => [node.id, servedRankOf(node.depth)]))
    /** The rank of every node inside this frame. */
    const rankOf = resolved === 0 && new Set(served.values()).size > 1 ? served : deriveRanksOracle(nodes.map((node) => node.id), new Map(nodes.map((node) => [node.id, drawn.get(node.id) ?? []])))
    /** The frame's own buckets, each sorted by the collator. */
    const deepest = nodes.reduce((max, node) => Math.max(max, rankOf.get(node.id) ?? 0), 0)
    /** One bucket per rank, so an empty rank still exists and the frame's spacing stays honest. */
    const buckets: string[][] = Array.from({ length: nodes.length === 0 ? 0 : deepest + 1 }, () => [] as string[])
    for (const node of nodes) {
      node.depth = rankOf.get(node.id) ?? node.depth
      buckets[Math.min(Math.max(0, node.depth), deepest)].push(node.id)
    }
    for (const bucket of buckets) bucket.sort(idCompare)
    if (frame === root) rootRanks = buckets
  }
  /** Every drawn edge of every frame, ordered by (`from`, then `to`). */
  const edges: GraphEdge[] = []
  for (const frame of frames) {
    for (const entry of pairs.get(frame)?.values() ?? []) edges.push({ from: entry.from, to: entry.to, source: entry.board && entry.plan ? "both" : entry.plan ? "plan" : entry.board ? "board" : "derived" })
  }
  edges.sort((left, right) => idCompare(left.from, right.from) || idCompare(left.to, right.to))
  /** Every node of every frame, in the draw order. */
  const nodes: GraphNode[] = [...frames.flatMap((frame) => rows.get(frame)?.nodes ?? []), ...pseudos].sort((left, right) => idCompare(left.id, right.id))
  /** Cyclic ids of every frame, joined. */
  const cyclic = new Set<string>()
  for (const frame of frames) {
    /** The frame's nodes. */
    const frameNodes = level.get(frame) ?? []
    /** The blockers this frame DRAWS onto each node, which is what a loop is made of. */
    const drawn = drawnDeps.get(frame) ?? new Map<string, string[]>()
    for (const id of cycleIdsOracle(frameNodes.map((node) => node.id), new Map(frameNodes.map((node) => [node.id, drawn.get(node.id) ?? []])))) cyclic.add(id)
  }
  /** Every reference the tree declared. */
  const refs = new Set<string>()
  for (const frame of frames) for (const node of rows.get(frame)?.nodes ?? []) for (const ref of node.dependencies) refs.add(ref)
  for (const frame of frames) if (frame.originTaskId !== undefined) refs.add(frame.originTaskId)
  /** The declared boxes, shallow-first. */
  const groups: GraphGroup[] = []
  for (const frame of frames) {
    if (frame.id === null || frame.label === null || frame.parent === null) continue
    groups.push({
      id: frame.id,
      label: frame.label,
      parentId: frame.parent.id,
      memberIds: [...(level.get(frame) ?? []).map((node) => node.id)].sort(idCompare),
      depth: frame.depth,
      ...(frame.originTaskId === undefined ? {} : { originTaskId: frame.originTaskId }),
    })
  }
  groups.sort((left, right) => left.depth - right.depth || idCompare(left.id, right.id))
  return {
    nodes,
    edges,
    ranks: rootRanks,
    cycles: [...cyclic].sort(),
    report: {
      boardOnly: [...frames.flatMap((frame) => rows.get(frame)?.boardOnly ?? [])].sort(idCompare),
      planOnly: [...frames.flatMap((frame) => rows.get(frame)?.planOnly ?? [])].sort(idCompare),
      edgePlanOnly: edges.filter((edge) => edge.source === "plan"),
      edgeBoardOnly: edges.filter((edge) => edge.source === "board"),
      planProblems: frames.flatMap((frame) => [...frame.plan.problems]),
      unresolved: [...refs].filter((ref) => !frameOf.has(ref)).sort(),
      ranksDerived: true,
    },
    groups,
  }
}

/**
 * Compare the produced nested model with the grouped fixture's hand-written expectations.
 * @param model - the produced model.
 * @param golden - the contract's own expectations, as sets.
 * @returns one line per failed expectation.
 */
function checkGroupedGolden(model: GraphModel, golden: GroupedGolden): string[] {
  /** The failed expectations. */
  const failures: string[] = []
  if (canonical(asSet(model.nodes.map((node) => node.id))) !== canonical(asSet(golden.nodeIds))) failures.push(`golden node ids: expected ${canonical(asSet(golden.nodeIds))} got ${canonical(asSet(model.nodes.map((node) => node.id)))}`)
  for (const [id, want] of Object.entries(golden.placement)) {
    /** The produced node for this id. */
    const node = model.nodes.find((candidate) => candidate.id === id)
    if (node === undefined) {
      failures.push(`golden placement ${id}: missing from the model`)
      continue
    }
    if (node.depth !== want.depth) failures.push(`golden placement ${id}: expected depth ${want.depth} got ${node.depth}`)
    if ((node.group ?? null) !== (want.group ?? null)) failures.push(`golden placement ${id}: expected group ${JSON.stringify(want.group ?? null)} got ${JSON.stringify(node.group ?? null)}`)
    if (node.visual !== want.visual) failures.push(`golden placement ${id}: expected visual "${want.visual}" got "${node.visual}"`)
  }
  /** An edge as the golden spells it. */
  const edgeText = (edge: GraphEdge): string => `${edge.from}→${edge.to}(${edge.source})`
  if (canonical(asSet(model.edges.map(edgeText))) !== canonical(asSet(golden.edges))) failures.push(`golden edges: expected ${canonical(asSet(golden.edges))} got ${canonical(asSet(model.edges.map(edgeText)))}`)
  /** The box ids the golden declares, so the contract's group→group branch can be required by name. */
  const boxIds = new Set(golden.groups.map((group) => group.id))
  // THE BRANCH MUST STAY EXERCISED: the fixture declares a dependency between two sibling subcells, so a
  // model that never draws a box→box edge has silently dropped the rule the contract names.
  if (!golden.edges.some((text) => isBoxEdgeText(text, boxIds))) failures.push("golden: the fixture declares a dependency between two subcells, so it must state a box→box edge")
  if (!model.edges.some((edge) => boxIds.has(edge.from) && boxIds.has(edge.to))) failures.push("golden group→group: the fixture declares a dependency between two subcells, so the model must draw at least one box→box edge")
  if (canonical(model.groups) !== canonical(golden.groups)) failures.push(`golden groups: expected ${canonical(golden.groups)} got ${canonical(model.groups)}`)
  if (canonical(model.ranks) !== canonical(golden.ranks)) failures.push(`golden ranks: expected ${canonical(golden.ranks)} got ${canonical(model.ranks)}`)
  if (canonical(asSet(model.report.boardOnly)) !== canonical(asSet(golden.report.boardOnly))) failures.push(`golden report.boardOnly: expected ${canonical(asSet(golden.report.boardOnly))} got ${canonical(asSet(model.report.boardOnly))}`)
  if (canonical(asSet(model.report.planOnly)) !== canonical(asSet(golden.report.planOnly))) failures.push(`golden report.planOnly: expected ${canonical(asSet(golden.report.planOnly))} got ${canonical(asSet(model.report.planOnly))}`)
  if (canonical(asSet(model.report.edgePlanOnly.map((edge) => `${edge.from}→${edge.to}`))) !== canonical(asSet(golden.report.edgePlanOnly))) failures.push(`golden report.edgePlanOnly: expected ${canonical(asSet(golden.report.edgePlanOnly))} got ${canonical(asSet(model.report.edgePlanOnly.map((edge) => `${edge.from}→${edge.to}`)))}`)
  if (canonical(asSet(model.report.edgeBoardOnly.map((edge) => `${edge.from}→${edge.to}`))) !== canonical(asSet(golden.report.edgeBoardOnly))) failures.push(`golden report.edgeBoardOnly: expected ${canonical(asSet(golden.report.edgeBoardOnly))} got ${canonical(asSet(model.report.edgeBoardOnly.map((edge) => `${edge.from}→${edge.to}`)))}`)
  if (canonical(asSet(model.report.unresolved)) !== canonical(asSet(golden.report.unresolved))) failures.push(`golden report.unresolved: expected ${canonical(asSet(golden.report.unresolved))} got ${canonical(asSet(model.report.unresolved))}`)
  return failures
}

/**
 * Whether a golden edge spelling joins two BOXES, which is the contract's group→group branch.
 * @param text - one golden edge, spelled `from→to(source)`.
 * @param boxes - the group ids the golden declares.
 * @returns whether both endpoints of that edge are boxes.
 */
function isBoxEdgeText(text: string, boxes: ReadonlySet<string>): boolean {
  /** The blocker: everything before the arrow. */
  const from = text.slice(0, text.indexOf("→"))
  /** The blocked id: everything between the arrow and the `(` that opens the source suffix. */
  const to = text.slice(text.indexOf("→") + 1, text.indexOf("("))
  return boxes.has(from) && boxes.has(to)
}

/**
 * Un-anchor ONE produced box edge, which is the grouped gate's negative control.
 *
 * The seed replaces a box endpoint with the first member of that box, which is exactly the picture the
 * attachment rule forbids: a line drawn INTO the frame instead of terminating on its border.
 * @param model - the produced model.
 * @returns the seeded model and a one-line note naming what was changed.
 */
function seedWrongAnchor(model: GraphModel): { model: GraphModel; note: string } {
  /** Each box and its first member, so a box endpoint has somewhere wrong to move to. */
  const memberOf = new Map((model.groups ?? []).map((group) => [group.id, group.memberIds[0]]))
  /** The index of the first edge that names a box, in the model's own order. */
  const index = model.edges.findIndex((edge) => memberOf.has(edge.from) || memberOf.has(edge.to))
  if (index < 0) return { model, note: "there is no box-anchored edge to seed" }
  /** The edge the seed mutates. */
  const anchored = model.edges[index]
  /** The box endpoint the seed moves; the `to` side when both ends are boxes. */
  const box = memberOf.has(anchored.to) ? anchored.to : anchored.from
  /** The inner id the box endpoint is seeded to. */
  const inner = memberOf.get(box)
  if (inner === undefined) return { model, note: `box "${box}" declares no member to un-anchor to` }
  /** The seeded edges. */
  const edges = model.edges.map((edge, position) => position === index ? { ...edge, ...(memberOf.has(anchored.to) ? { to: inner } : { from: inner }) } : edge)
  return { model: { ...model, edges }, note: `${anchored.from}→${anchored.to}: endpoint "${box}" seeded to "${inner}"` }
}

/**
 * The pair the grouped negative control will un-anchor: the first edge (in the model's order) that
 * names a group id as either endpoint.
 * @param model - the model the gate emitted.
 * @returns `from→to`, or "" when the snapshot carries no box edge.
 */
function firstBoxEdgePair(model: GraphModel | undefined): string {
  if (model === undefined) return ""
  /** The box ids the model declares. */
  const boxes = new Set((model.groups ?? []).map((group) => group.id))
  /** The first box edge, in the emitted order. */
  const edge = model.edges.find((candidate) => boxes.has(candidate.from) || boxes.has(candidate.to))
  return edge === undefined ? "" : `${edge.from}→${edge.to}`
}

/**
 * Run the grouped check: the built-in nested fixture against the oracle AND the golden.
 * @param cli - the invocation (its `emit` and `seedWrongAnchor` flags drive the output).
 * @returns the process exit code: 0 when equal, 1 otherwise.
 */
function runGrouped(cli: Cli): number {
  /** The built-in nested fixture. */
  const fixture = defaultGroupFixture()
  /** The model the core builds from the declared tree. */
  const model = buildGroupedModel(fixture)
  /** The model the tree declares, by this gate's own reading. */
  const expected = expectedGroupedModel(fixture)
  if (cli.emit) console.log(JSON.stringify(model, null, 2))
  /** The model the comparison judges — mutated only by the deliberate negative control. */
  let judged = model
  if (cli.seedWrongAnchor) {
    /** The seeded model and the note naming what it changed. */
    const seeded = seedWrongAnchor(model)
    judged = seeded.model
    console.log(`${PREFIX} negative control: ${seeded.note}`)
  }
  /** Every failed expectation: the oracle's and the golden's. */
  const failures = checkModel(judged, expected).concat(checkGroupedGolden(judged, fixture.golden))
  if (failures.length > 0) {
    for (const line of failures) console.log(`${PREFIX} FAIL ${line}`)
    console.log(`${PREFIX} FAIL — ${failures.length} grouped expectation(s) did not hold`)
    return 1
  }
  console.log(`${PREFIX} PASS — grouped nodes (${model.nodes.length}), edges (${model.edges.length}), groups (${model.groups?.length ?? 0}), ranks and the report equal the declared tree`)
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
// THE DEFAULT RUN IS THE FLAT ARM, EXACTLY AS BEFORE GROUPS EXISTED: same fixture, same PASS line,
// same snapshot on `--emit`, byte for byte. The GROUP arm is `--grouped` (and `--self-test` proves
// both directions), which is how the contract names it — so this gate's historical output never moved.
if (cli.grouped) process.exit(runGrouped(cli))
if (cli.fixtureDir !== undefined) process.exit(runFixture(loadFixtureDir(resolve(cli.fixtureDir)), cli))
if (cli.boardPath !== undefined && cli.planPath !== undefined) process.exit(runFixture(loadFixturePaths(resolve(cli.planPath), resolve(cli.boardPath)), cli))
process.exit(runFixture(defaultFixture(), cli))
