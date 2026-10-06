// THE PRODUCER'S OWN SHAPE, MINTED BY THE PRODUCER'S OWN CODE — so the WEB view's reader test is not a guess.
//
// `team-store.ts resolveBlockers` splits a reference list into "what resolved" and "what matched
// nothing"; `addTeamTask` stores the first half in `blockedBy` (UNRESOLVED ENTRIES INCLUDED, verbatim)
// and the second in `unresolvedBlockers`, which is ABSENT when everything resolved. This script calls
// those two functions and prints the task they mint, which is the fixture the view's reader is tested
// against.
//
// Run: bun evidence/tui/dag-port/web-dag/<ts>/producer-shape.mts
import { addTeamTask, resolveBlockers } from "../../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** An empty record: no team, no tasks, and the id counters a fresh board starts from. */
const EMPTY = {
  version: 1,
  teamId: "team-shape-probe",
  name: "shape probe",
  description: "minting the producer's own unresolved-blocker shape",
  leadSessionId: "session-probe",
  phase: "active",
  createdAt: "2026-10-06T00:00:00.000Z",
  members: [],
  tasks: [],
  nextMemberNumber: 1,
  nextTaskNumber: 1,
} as never

/** The board after one task with NO blockers, which must carry no `unresolvedBlockers` key at all. */
const clean = addTeamTask(EMPTY, { subject: "a task with no blockers", blockedBy: [] }, new Date("2026-10-06T00:00:01.000Z"))
/** A reference list with one real id and one that names nothing. */
const split = resolveBlockers(clean, ["T1", "ghost-7", "ghost-7"])
console.log("resolveBlockers(['T1','ghost-7','ghost-7']) -> blockedBy=" + JSON.stringify(split.blockedBy) + " unresolved=" + JSON.stringify(split.unresolved))
/** The board after a task whose second reference names nothing. */
const dangling = addTeamTask(clean, { subject: "a task with one dangling reference", blockedBy: ["T1", "ghost-7"] }, new Date("2026-10-06T00:00:02.000Z"))
console.log("task WITHOUT a dangling reference: " + JSON.stringify(clean.tasks[0]))
console.log("task WITH a dangling reference   : " + JSON.stringify(dangling.tasks[1]))
console.log("the first task carries the key: " + String("unresolvedBlockers" in (clean.tasks[0] as Record<string, unknown>)))
console.log("the second task carries the key: " + String("unresolvedBlockers" in (dangling.tasks[1] as Record<string, unknown>)))
