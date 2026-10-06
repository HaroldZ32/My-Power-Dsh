// CAPTAIN REPAIR of the live team board's blocker references (one-off, recorded as evidence).
//
// WHY THIS EXISTS. `agent_teams_plan create_task` was given `blocked_by: ["2", "3", …]` — plan
// POSITIONS, which is not a reference form the engine accepts. `NewTaskInput.blockedBy` documents
// the accepted forms as "subjects or ids", and `resolveBlocker` resolves exactly those two and
// otherwise returns the reference UNCHANGED. The board therefore carried ten dangling references,
// `taskDepths` filtered every one of them out, and every task collapsed to depth 0 — which is the
// one-column, edge-less DAG the user reported on the WEB GUI.
//
// WHAT THIS SCRIPT DOES, and nothing else:
//   1. rewrites each dangling numeric reference `N` to the board id `TN` the plan position denotes;
//   2. corrects ONE captain off-by-one: T6 (wiring) was written `["2"]` but was always intended to be
//      blocked by the PANELS task, which is plan position 3 — so it becomes `["T3"]`;
//   3. appends the two follow-up lanes the amendment opened (T11 the WEB DAG repair, T12 the data
//      plane repair) with real id blockers.
// It does NOT touch any status, owner, attempt, round or verdict.
//
// It writes through the store's OWN API (`updateTeamTask` / `addTeamTask` / `writeTeam`) rather than
// editing JSON, so every revision bump, `updatedAt` stamp and blocker resolution stays the engine's.
import { readTeam, writeTeam, updateTeamTask, addTeamTask } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** The live team this repair targets. */
const TEAM_ID = "team-20261006135108"

/** The workspace root this script runs against; the repo root is where it is invoked from. */
const workspace = process.cwd()

/** The plan position of the PANELS task, which T6 was always meant to be blocked by. */
const PANELS_POSITION = 3

/** The blocker references each task SHOULD carry, by board id; absent means leave the task alone. */
const intendedBlockers: Readonly<Record<string, string[]>> = Object.freeze({
  T6: ["T3"],
  T7: ["T2", "T3", "T4", "T6"],
  T8: ["T7"],
  T9: ["T2", "T3", "T4", "T5", "T6"],
  T10: ["T7", "T8", "T9"],
})

/**
 * Rewrite one dangling reference to a board id.
 *
 * A reference already naming a task is returned as-is, so this is idempotent.
 * @param reference - the stored reference, which may be a plan position such as `"2"`.
 * @param ids - every task id currently on the board.
 * @returns the resolved id when the position denotes one, else the original reference.
 */
function repairReference(reference: string, ids: ReadonlySet<string>): string {
  if (ids.has(reference)) return reference
  if (!/^[0-9]+$/.test(reference)) return reference
  const candidate = "T" + reference
  return ids.has(candidate) ? candidate : reference
}

/** The live record, or a hard stop when the team is not there. */
const record = readTeam(workspace, TEAM_ID)
if (record === undefined) {
  console.error("REFUSING: no team record at " + TEAM_ID)
  process.exit(1)
}

/** Every id on the board, which is what a reference must name to resolve. */
const ids = new Set(record.tasks.map((task) => task.id))

console.log("BEFORE")
for (const task of record.tasks) console.log("  " + task.id + " blockedBy=" + JSON.stringify(task.blockedBy))

/** The record after each task's blockers are repaired. */
let repaired = record
for (const task of record.tasks) {
  /** The blockers this task should carry: the intended set when declared, else the repaired positions. */
  const wanted = intendedBlockers[task.id]
  const blockedBy = wanted ?? task.blockedBy.map((reference) => repairReference(reference, ids))
  repaired = updateTeamTask(repaired, task.id, { blockedBy }, new Date())
}

/** The record after the two amendment lanes are appended. */
let withNew = addTeamTask(
  repaired,
  {
    subject: "FIX: the WEB DAG collapses to one column — derive rank from the graph (R17/R19/R20)",
    description:
      "`packages/mpd-bundle-plugin/src/team-view.ts` trusts the served `depth` and never re-derives, so a board whose blocker references do not resolve draws ONE column with NO edges. Derive rank from the `blockedBy` graph, surface unresolved references, adopt the reference project's NUMERIC task-id ordering, state the reading direction, and make the focused detail name what the task UNLOCKS.",
    kind: "repair",
    blockedBy: ["T2"],
    writeScopes: ["packages/mpd-bundle-plugin/src/team-view.ts", "packages/mpd-bundle-plugin/test/team-view.test.ts"],
    owner: "dag-geometry",
    coverageOf: "R17/R19/R20",
  },
  new Date(),
)

withNew = addTeamTask(
  withNew,
  {
    subject: "FIX: the data plane silently flattens a DAG when blocker refs do not resolve (R21)",
    description:
      "`plan-store.ts` stores `blockedBy` verbatim and `resolveBlocker` returns an unresolvable reference unchanged; `taskDepths` then filters it out, so every task becomes a root and the DAG flattens with no warning. An unresolvable blocker must be a REPORTED condition at acceptance time, and \"genuinely no blockers\" must be distinguishable from \"blockers did not resolve\".",
    kind: "repair",
    blockedBy: ["T6"],
    writeScopes: ["packages/mpd-team-core-plugin/src/team-store.ts", "packages/mpd-team-core-plugin/src/plan-store.ts"],
    owner: "seam-guard",
    coverageOf: "R21",
  },
  new Date(),
)

writeTeam(workspace, withNew)

console.log("AFTER")
for (const task of withNew.tasks) console.log("  " + task.id + " blockedBy=" + JSON.stringify(task.blockedBy))
