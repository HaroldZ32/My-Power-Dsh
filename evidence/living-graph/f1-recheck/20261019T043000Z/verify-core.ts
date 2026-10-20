// LANE E — independent core preflight (before lanes B/C/D settle).
//
// WHAT THIS IS: an evidence harness that drives `packages/mpd-graph-core` DIRECTLY, with fixtures
// hand-authored from the package README's documented plan subset and expectations derived from the
// frozen contract's six-case table. Nothing here is imported from the writer's own tests: the
// expected values are written down by hand and compared against the OBSERVED model, so a writer's
// test cannot make this pass by sharing its mistake.
//
// WHAT IT DOES NOT COVER (planned for the settled-tree pass): the TUI plane, the web plane, the host
// projection, the gate, and the pre-existing suites. Those need lanes B/C/D in the tree.
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildModel,
  parsePlanMarkdown,
  rankPlan,
  watchGraph,
} from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask, GraphChangeEvent, GraphModel, PlanDocument } from "../../../../packages/mpd-graph-core/src/index.ts"

/** This run's own directory, where fixtures, result.json and output.log live. */
const HERE = import.meta.dirname
/** The hand-authored fixture directory. */
const FIXTURES = join(HERE, "fixtures")
/** One measured check: what was claimed, what was expected, what was actually seen. */
interface Check {
  /** Stable id, cited by the verdict table. */
  id: string
  /** The contract claim this check bears on. */
  claim: string
  /** The value the contract/README says must hold. */
  expected: string
  /** The value observed in this run. */
  observed: string
  /** Whether the observation matches the expectation. */
  pass: boolean
  /** Optional structured detail (the full observed value on a failure). */
  detail?: unknown
}
/** Every measured check, in execution order. */
const checks: Check[] = []

/**
 * Record one check.
 * @param id - stable id.
 * @param claim - the claim it verifies.
 * @param expected - the contract/README expectation, as a string.
 * @param observed - what this run saw, as a string.
 * @param pass - whether they agree.
 * @param detail - optional failure payload.
 */
function check(id: string, claim: string, expected: string, observed: string, pass: boolean, detail?: unknown): void {
  checks.push({ id, claim, expected, observed, pass, ...(detail === undefined ? {} : { detail }) })
}

/**
 * The canonical rendering of a JSON-able value: object keys sorted, so two equal maps compare equal
 * regardless of the order their keys were written in.
 * @param value - the value to render.
 * @returns a stable string form.
 */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`
  if (value !== null && typeof value === "object") {
    /** The value's own entries, key-sorted, so map order cannot decide the comparison. */
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canon(entry)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/**
 * Compare two JSON-able values for deep equality and record the check.
 * @param id - stable id.
 * @param claim - the claim it verifies.
 * @param expected - the contract/README expectation.
 * @param actual - what this run saw.
 */
function equal(id: string, claim: string, expected: unknown, actual: unknown): void {
  /** The canonical rendering of the expectation. */
  const want = canon(expected)
  /** The canonical rendering of the observation. */
  const got = canon(actual)
  check(id, claim, want, got, want === got, want === got ? undefined : { expected, actual })
}

/**
 * Read a JSON fixture as text and parse it.
 * @param name - fixture file name under the fixtures directory.
 * @returns the parsed value.
 */
function fixtureJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T
}

/**
 * Read a fixture as raw text.
 * @param name - fixture file name under the fixtures directory.
 * @returns the file's text.
 */
function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8")
}

/** Resolve after `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The parsed six-case plan and board, used by several sections.
 * @returns the two inputs.
 */
function sixInputs(): { plan: PlanDocument; board: BoardTask[] } {
  return { plan: parsePlanMarkdown(fixtureText("plan-six.md")), board: fixtureJson<BoardTask[]>("board-six.json") }
}

/** The rank buckets of a model, as arrays of ids. */
const ranksOf = (model: GraphModel): string[][] => model.ranks
/** The sorted-with-the-published-collator form of an id list, per the contract's stated key. */
const idSet = (ids: readonly string[]): string[] => [...ids].sort((a, b) => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare(a, b))

// ── A. THE PARSER, FROM THE README'S OWN SUBSET ──────────────────────────────────────────────────
try {
  /** The parsed six-case plan. */
  const { plan } = sixInputs()
  equal("A1-plan-ids", "README: TODO ordinal N → T<N>, final marker → F<N>", ["F1", "T1", "T2", "T3", "T4", "T6"], plan.tasks.map((task) => task.id))
  equal("A1-plan-section", "README: TODO vs final-wave section is recorded", ["final-wave", "todo", "todo", "todo", "todo", "todo"], plan.tasks.map((task) => task.section))
  equal("A2-plan-owners", "README: lane table resolves owners, trailing qualifier cut", { T2: "Junior Engineer", T3: "Deep Worker", T4: "Junior Engineer", T6: "Reviewer" }, Object.fromEntries(plan.tasks.filter((task) => task.owner !== undefined).map((task) => [task.id, task.owner])))
  equal("A3-plan-edges", "README: parenthesised, colon-labelled and lane references all declare blockers", { T1: [], T2: ["T1"], T3: ["T2"], T4: [], T6: ["T4"], F1: ["T4"] }, Object.fromEntries(plan.tasks.map((task) => [task.id, task.blockedBy])))
  equal("A4-plan-problems", "README: a half-typed candidate line is a problem at its 1-based line", [{ line: 9, text: "- [ ] 5" }], plan.problems.map((problem) => ({ line: problem.line, text: problem.text })))
  check("A4b-plan-problem-reason", "README: every problem carries a reason", "a non-empty reason", plan.problems[0]?.reason ?? "<none>", (plan.problems[0]?.reason ?? "") !== "")
} catch (error) {
  check("A-parser", "parser section executed", "no throw", String(error), false)
}

// ── B. THE SIX CONFLICT CASES OF THE FROZEN CONTRACT ─────────────────────────────────────────────
try {
  /** The six-case inputs. */
  const { plan, board } = sixInputs()
  /** The one model. */
  const model = buildModel({ board, plan })
  equal("B1-node-order", "contract: node ids ordered by the published collator", ["F1", "T1", "T2", "T3", "T4", "T6", "T7"], model.nodes.map((node) => node.id))
  /** The plan-only ids, as nodes. */
  const ghosts = model.nodes.filter((node) => node.planned)
  equal("B2-ghosts", "contract: plan-only id is a GHOST (planned:true, visual 'planned') and never dropped", { ids: ["F1", "T6"], visuals: ["planned", "planned"] }, { ids: ghosts.map((node) => node.id), visuals: ghosts.map((node) => node.visual) })
  equal("B3-board-only", "contract: board-only id is REPORTED and drawn from the board", ["T7"], model.report.boardOnly)
  equal("B3-plan-only", "contract: plan-only ids are REPORTED", ["F1", "T6"], model.report.planOnly)
  equal("B4-edges", "contract: every declared edge is drawn with its declaring side", [
    { from: "T1", to: "T2", source: "both" },
    { from: "T1", to: "T7", source: "board" },
    { from: "T2", to: "T3", source: "plan" },
    { from: "T3", to: "T4", source: "board" },
    { from: "T4", to: "F1", source: "plan" },
    { from: "T4", to: "T6", source: "plan" },
  ], model.edges)
  equal("B5-edge-plan-only", "contract: plan-only edges are REPORTED", [
    { from: "T2", to: "T3", source: "plan" },
    { from: "T4", to: "F1", source: "plan" },
    { from: "T4", to: "T6", source: "plan" },
  ], model.report.edgePlanOnly)
  equal("B5b-edge-board-only", "contract: board-only edges are REPORTED", [
    { from: "T1", to: "T7", source: "board" },
    { from: "T3", to: "T4", source: "board" },
  ], model.report.edgeBoardOnly)
  check("B5c-agreeing-edge-not-reported", "contract: an agreeing edge is ordinary, not a disagreement", "T1->T2 in neither list", JSON.stringify({ inPlanOnly: model.report.edgePlanOnly.some((edge) => edge.from === "T1" && edge.to === "T2"), inBoardOnly: model.report.edgeBoardOnly.some((edge) => edge.from === "T1" && edge.to === "T2") }), !model.report.edgePlanOnly.some((edge) => edge.from === "T1" && edge.to === "T2") && !model.report.edgeBoardOnly.some((edge) => edge.from === "T1" && edge.to === "T2"))
  equal("B6-plan-problems", "contract: an unreadable plan line reaches the report at its line", [{ line: 9, text: "- [ ] 5" }], model.report.planProblems.map((problem) => ({ line: problem.line, text: problem.text })))
  equal("B7-unresolved", "contract: an unresolvable reference is reported, kept in dependencies, and draws no edge", { unresolved: ["T9"], T7Deps: ["T1", "T9"], t9Edges: 0 }, { unresolved: model.report.unresolved, T7Deps: model.nodes.find((node) => node.id === "T7")?.dependencies, t9Edges: model.edges.filter((edge) => edge.from === "T9").length })
  /** The board's own subject and the plan's own title, kept side by side. */
  const t2 = model.nodes.find((node) => node.id === "T2")
  equal("B8-board-wins-subject", "contract: the board supplies the subject, the plan's title sits beside it", { subject: "TUI plane adoption", title: "TUI panel adoption (blocked by 1)", status: "in_progress", assignee: "Junior Engineer" }, { subject: t2?.subject, title: t2?.title, status: t2?.status, assignee: t2?.assignee })
  equal("B9-ranks-derived", "contract: node.depth IS the derived rank, not the served depth", { T1: 0, T2: 1, T3: 2, T4: 3, T6: 4, T7: 1, F1: 4, ranksDerived: true }, { T1: model.nodes.find((n) => n.id === "T1")?.depth, T2: model.nodes.find((n) => n.id === "T2")?.depth, T3: model.nodes.find((n) => n.id === "T3")?.depth, T4: model.nodes.find((n) => n.id === "T4")?.depth, T6: model.nodes.find((n) => n.id === "T6")?.depth, T7: model.nodes.find((n) => n.id === "T7")?.depth, F1: model.nodes.find((n) => n.id === "F1")?.depth, ranksDerived: model.report.ranksDerived })
  equal("B10-ranks", "contract: ranks are buckets of ids, sorted within a rank", [["T1"], ["T2", "T7"], ["T3"], ["T4"], ["F1", "T6"]], ranksOf(model))
  equal("B11-cycles", "contract: cycles are a first-class model field", [], model.cycles)
} catch (error) {
  check("B-six-cases", "six-case section executed", "no throw", String(error), false)
}

// ── C. DETERMINISM AND SERIALIZABILITY ───────────────────────────────────────────────────────────
try {
  /** The six-case inputs. */
  const { plan, board } = sixInputs()
  /** The same model built twice. */
  const first = buildModel({ board, plan })
  /** The second run over the same inputs. */
  const second = buildModel({ board, plan })
  /** Whether the two runs produced the same bytes. */
  const twiceEqual = JSON.stringify(first) === JSON.stringify(second)
  check("C1-twice", "contract: same board + same plan => byte-identical model", "JSON strings equal", twiceEqual ? "equal" : "DIFFERENT", twiceEqual)
  /** The board in reverse order. */
  const reversedBoard = [...board].reverse()
  /** The plan's tasks and problems in reverse order (the document's own sort must absorb it). */
  const reversedPlan: PlanDocument = { tasks: [...plan.tasks].reverse(), lanes: [...plan.lanes].reverse(), problems: [...plan.problems].reverse() }
  /** The model built from shuffled inputs. */
  const shuffled = buildModel({ board: reversedBoard, plan: reversedPlan })
  check("C2-shuffle", "contract: every collection is sorted by a stated key, so input ORDER cannot reach the drawing", "JSON strings equal", JSON.stringify(first) === JSON.stringify(shuffled), JSON.stringify({ equal: JSON.stringify(first) === JSON.stringify(shuffled), first: first.ranks, shuffled: shuffled.ranks }))
  /** The round-tripped model. */
  const roundTrip = JSON.parse(JSON.stringify(first)) as GraphModel
  /** Whether the round-trip preserved every byte. */
  const roundTripEqual = JSON.stringify(first) === JSON.stringify(roundTrip)
  check("C3-roundtrip", "contract: the model is plain JSON and round-trips losslessly", "deep equal after JSON round-trip", roundTripEqual ? "equal" : "DIFFERENT", roundTripEqual)
} catch (error) {
  check("C-determinism", "determinism section executed", "no throw", String(error), false)
}

// ── D. THE DISCRIMINATING FIXTURE: served depth and derived rank DISAGREE ────────────────────────
try {
  /** The depth-disagree board. */
  const board = fixtureJson<BoardTask[]>("board-depth-disagree.json")
  /** The model with no plan. */
  const model = buildModel({ board })
  equal("D1-depth-disagree-ranks", "THE discriminating case: derived rank wins over a disagreeing served depth (T4 served 5, derived 0)", [["T1", "T4"], ["T2"], ["T3"]], ranksOf(model))
  equal("D1b-depth-disagree-node-depth", "the same fact on the node field the planes carry", { T1: 0, T4: 0, T2: 1, T3: 2 }, { T1: model.nodes.find((n) => n.id === "T1")?.depth, T4: model.nodes.find((n) => n.id === "T4")?.depth, T2: model.nodes.find((n) => n.id === "T2")?.depth, T3: model.nodes.find((n) => n.id === "T3")?.depth })
  check("D2-ranks-derived-flag", "the fallback is reported, not silent", "ranksDerived true", String(model.report.ranksDerived), model.report.ranksDerived === true)
} catch (error) {
  check("D-depth-disagree", "depth-disagree section executed", "no throw", String(error), false)
}

// ── E. THE FLAT BOARD DRAWS FLAT ────────────────────────────────────────────────────────────────
try {
  /** The flat board. */
  const board = fixtureJson<BoardTask[]>("board-flat.json")
  /** Its model. */
  const model = buildModel({ board })
  equal("E1-flat", "contract: every blockedBy:[] draws FLAT (one rank, honestly)", [["T1", "T2", "T3", "T4", "T5"]], ranksOf(model))
  check("E2-flat-derived", "the flat picture is the DERIVED one, not a fallback claim", "ranksDerived true", String(model.report.ranksDerived), model.report.ranksDerived === true)
} catch (error) {
  check("E-flat", "flat section executed", "no throw", String(error), false)
}

// ── F. A CYCLE IS REPORTED AND STILL DRAWN ──────────────────────────────────────────────────────
try {
  /** The cyclic board. */
  const board = fixtureJson<BoardTask[]>("board-cycle.json")
  /** Its model. */
  const model = buildModel({ board })
  equal("F1-cycle-reported", "contract: cycle ids are reported", ["T1", "T2"], model.cycles)
  check("F2-cycle-finite", "contract: a cycle is RENDERED, never a throw or an infinite rank", "every rank finite", JSON.stringify(ranksOf(model)), ranksOf(model).flat().every((id) => model.nodes.some((node) => node.id === id)))
  /** The model built from the board in the opposite order. */
  const shuffled = buildModel({ board: [...board].reverse() })
  check("F3-cycle-order-stability", "OBSERVATION: a cyclic board's ranks must not depend on the array order (contract's determinism invariant)", "JSON strings equal", JSON.stringify({ first: ranksOf(model), reversed: ranksOf(shuffled) }), JSON.stringify(ranksOf(model)) === JSON.stringify(ranksOf(shuffled)))
} catch (error) {
  check("F-cycle", "cycle section executed", "no throw", String(error), false)
}

// ── G. THE ONE WATCHER: COALESCING, LATENCY, RESYNC, REPLACE ─────────────────────────────────────
try {
  /** A scratch directory inside this evidence run, removed by the caller's cleanup policy. */
  const scratch = mkdtempSync(join(HERE, "watch-"))
  /** The watched board directory. */
  const boardDir = join(scratch, "boards")
  /** The watched plan directory. */
  const planDir = join(scratch, "plans")
  mkdirSync(boardDir)
  mkdirSync(planDir)
  /** The watched plan file. */
  const planFile = join(planDir, "task-plan.md")
  /** The board file the watcher sees appear. */
  const boardFile = join(boardDir, "team.json")
  /** Write one board array to the watched file. */
  const writeBoard = (tasks: Array<{ id: string; subject: string; blockedBy: string[]; depth: number; status?: string }>): void => writeFileSync(boardFile, JSON.stringify(tasks, null, 1))
  /** Write one plan text to the watched file. */
  const writePlan = (text: string): void => writeFileSync(planFile, text)
  writeBoard([{ id: "T1", subject: "one", blockedBy: [], depth: 0, status: "completed" }, { id: "T2", subject: "two", blockedBy: ["T1"], depth: 0 }])
  writePlan("## TODOs\n\n- [ ] 1. One\n- [ ] 2. Two (blocked by 1)\n")
  /** Delivered batches, in order. */
  const events: GraphChangeEvent[] = []
  /** A pending waiter for the next batch. */
  let waiter: { resolve: (event: GraphChangeEvent) => void; reject: (error: unknown) => void } | undefined
  /** The one watcher under test; a batch goes to the waiting reader or to the queue, never both. */
  const watcher = watchGraph({ boardDir, planFile }, {
    debounceMs: 250,
    onChange: (event) => {
      if (waiter !== undefined) {
        /** The reader that was waiting for exactly this batch. */
        const pending = waiter
        waiter = undefined
        pending.resolve(event)
        return
      }
      events.push(event)
    },
  })
  /** Wait for the next batch, or fail after `ms`. */
  const nextEvent = (ms: number): Promise<GraphChangeEvent> => new Promise((resolve, reject) => {
    /** The queued batch, when one already arrived. */
    const queued = events.shift()
    if (queued !== undefined) {
      resolve(queued)
      return
    }
    /** The timeout that turns silence into a measured failure. */
    const timer = setTimeout(() => { waiter = undefined; reject(new Error(`no batch within ${ms} ms`)) }, ms)
    waiter = { resolve: (event) => { clearTimeout(timer); resolve(event) }, reject: (error) => { clearTimeout(timer); reject(error) } }
  })
  check("G0-watching", "the watcher arms at least one directory handle", "true", String(watcher.watching), watcher.watching === true)
  await sleep(50)
  // G1: TWO CHANGES TO TWO TARGETS INSIDE ONE DEBOUNCE WINDOW.
  writeBoard([{ id: "T1", subject: "one", blockedBy: [], depth: 0, status: "completed" }, { id: "T2", subject: "two", blockedBy: ["T1"], depth: 0 }, { id: "T3", subject: "three", blockedBy: [], depth: 0, status: "pending" }])
  /** The moment the second write landed, so latency is measured from the LAST write. */
  const secondWriteAt = Date.now()
  await sleep(10)
  writePlan("## TODOs\n\n- [ ] 1. One\n- [ ] 2. Two (blocked by 1)\n\n## Final Verification Wave\n\n- [ ] F1. Final check (blocked by 2)\n")
  /** The batch the two writes produced. */
  const batch = await nextEvent(4000)
  /** The model built at the moment the batch arrived, from the two files as they are. */
  const modelAtBatch = buildModel({ board: JSON.parse(readFileSync(boardFile, "utf8")) as BoardTask[], plan: parsePlanMarkdown(readFileSync(planFile, "utf8")) })
  check("G1-one-batch", "a debounce window with TWO writes delivers ONE batch", "sequence 1, no queued batch", JSON.stringify({ sequence: batch.sequence, queued: events.length }), batch.sequence === 1 && events.length === 0)
  equal("G1b-paths", "the batch names BOTH watched targets whose signature moved (the board DIR and the plan file)", [boardDir, planFile].sort(), [...batch.paths].sort())
  check("G1c-coalesced", "the batch absorbed at least two raw notifications (a proven collapse, not a dropped change)", "coalesced >= 2", String(batch.coalesced), batch.coalesced >= 2)
  equal("G1d-model-latest", "the model after the batch shows BOTH changes (nothing silently dropped)", { hasT3: true, hasGhostF1: true }, { hasT3: modelAtBatch.nodes.some((node) => node.id === "T3"), hasGhostF1: modelAtBatch.nodes.some((node) => node.id === "F1" && node.planned) })
  check("G1e-latency", "the refresh latency of one event batch, measured from the last write", "< 4000 ms (the wait budget)", `${Date.now() - secondWriteAt} ms`, Date.now() - secondWriteAt < 4000)
  // G3: ONE BOARD EDIT, A SECOND BATCH.
  /** The moment the single edit landed. */
  const singleAt = Date.now()
  writeBoard([{ id: "T1", subject: "one", blockedBy: [], depth: 0, status: "completed" }, { id: "T4", subject: "four", blockedBy: [], depth: 0, status: "pending" }])
  /** The second batch. */
  const second = await nextEvent(4000)
  check("G3-second-batch", "a later single edit still delivers (the debounce does not swallow it)", "sequence 2", String(second.sequence), second.sequence === 2)
  check("G3b-latency", "single-edit refresh latency", "reported", `${Date.now() - singleAt} ms`, Date.now() - singleAt < 4000)
  // G4: POLL IS THE RESYNC PATH.
  writeBoard([{ id: "T1", subject: "one", blockedBy: [], depth: 0, status: "completed" }])
  /** Whether the manual poll delivered. */
  const polled = watcher.poll()
  check("G4-poll", "poll() is the manual resync path and delivers exactly once", "true, manual batch", JSON.stringify({ polled, last: events[events.length - 1] ?? null }), polled === true)
  /** The manual batch the poll delivered. */
  const manual = events.shift()
  check("G4b-poll-manual", "the poll batch is marked manual", "manual true", String(manual?.manual), manual?.manual === true)
  await sleep(500)
  check("G4c-poll-no-duplicate", "the debounced notification for the same change is absorbed, not delivered twice", "sequence stays", JSON.stringify({ queued: events.length }), events.length === 0)
  // G5: A RENAME-REPLACE OF THE PLAN FILE IS SEEN (the inode changes; mtime/size may not).
  /** The replacement file written beside the target before the rename. */
  const replacement = join(planDir, "replacement.tmp")
  writeFileSync(replacement, "## TODOs\n\n- [ ] 1. Renamed plan\n")
  renameSync(replacement, planFile)
  /** The batch the replace produced. */
  const replaced = await nextEvent(4000)
  check("G5-replace", "a rename-replace of the plan file is detected (signature includes the inode)", "paths include the plan file", JSON.stringify(replaced.paths), replaced.paths.includes(planFile))
  watcher.close()
  check("G6-close", "close() stops the handles and makes later polls no-ops", "closed true, poll false, watching false", JSON.stringify({ closed: watcher.closed, poll: watcher.poll(), watching: watcher.watching }), watcher.closed === true && watcher.poll() === false && watcher.watching === false)
  /** The batches' sequences, in arrival order: the collapse, the single edit, the manual poll, the replace. */
  const sequences = [batch.sequence, second.sequence, manual?.sequence, replaced.sequence]
  equal("G7-sequences", "batch sequence numbers are 1-based and monotonic across event and manual batches", [1, 2, 3, 4], sequences)
} catch (error) {
  check("G-watcher", "watcher section executed", "no throw", String(error), false)
}

// ── H. rankPlan's served overload (the TUI's path) ──────────────────────────────────────────────
try {
  /** A tiny structural row set, the narrow shape the README promises. */
  const rows = [
    { id: "T1", dependencies: [], depth: 0 },
    { id: "T2", dependencies: ["T1"], depth: 0 },
  ]
  /** The served ranks the host would have computed. */
  const served = new Map([["T1", 4], ["T2", 9]])
  /** The plan with the served map applied. */
  const plan = rankPlan(rows, served)
  equal("H1-served-overload", "README: rankPlan(tasks, served) applies ranks computed elsewhere", { derived: false, rankOf: [["T1", 4], ["T2", 9]] }, { derived: plan.derived, rankOf: [...plan.rankOf.entries()] })
} catch (error) {
  check("H-overload", "served-overload section executed", "no throw", String(error), false)
}

// ── RESULT ──────────────────────────────────────────────────────────────────────────────────────
/** How many checks failed. */
const failed = checks.filter((entry) => !entry.pass).length
/** The run's own verdict over the checks it could execute. */
const result = {
  run: "lane-e-core-preflight",
  at: new Date().toISOString(),
  contract: ".mpd/plans/living-graph.md",
  inputs: { fixtures: "fixtures/ (hand-authored from the package README subset)", core: "packages/mpd-graph-core/src/index.ts" },
  summary: { checks: checks.length, passed: checks.length - failed, failed },
  checks,
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(result, null, 1))
/** The human-readable lines this run writes beside result.json. */
const lines: string[] = [`lane E core preflight — ${checks.length} checks, ${failed} failed`, ""]
for (const entry of checks) lines.push(`${entry.pass ? "PASS" : "FAIL"} ${entry.id} | expected ${entry.expected} | observed ${entry.observed}`)
writeFileSync(join(HERE, "output.log"), `${lines.join("\n")}\n`)
console.log(lines.join("\n"))
if (failed > 0) process.exitCode = 1
