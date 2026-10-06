#!/usr/bin/env bun
// R21 AT THE PRODUCER — the reviewer's independent check that the data plane stops lying.
//
// The clause: an unresolvable blocker reference is REPORTED rather than silently accepted or deleted,
// and "genuinely no blockers" is distinguishable from "blockers did not resolve". The first two
// findings in this report were that `resolveBlocker` returned an unmatched reference UNCHANGED and
// `taskDepths` filtered it out, so every consumer had to defend itself. This script drives the REAL
// store with three tasks — one whose reference resolves, one whose reference names nothing, and one
// with no blocker at all — and asserts the two conditions do not look alike.
//
// Usage: bun evidence/tui/dag-port/verification/r21-producer-check.ts
import { addTeamTask, resolveBlockers, taskDepths } from "../../../../packages/mpd-team-core-plugin/src/team-store.ts"

/** An empty record, shaped as `mpd-team-core` writes it, so `addTeamTask` mints the ids itself. */
const empty = {
  version: 1, teamId: "t", name: "n", leadSessionId: "s", phase: "active",
  createdAt: new Date().toISOString(), members: [], tasks: [], nextMemberNumber: 1, nextTaskNumber: 1,
}

/** The instant every fixture row is stamped with, so the run is deterministic. */
const now = new Date()

/** The board under test: a root, a DANGLING reference, a RESOLVABLE one, and a genuinely bare task. */
const board = [
  { subject: "root", blockedBy: [] as string[] },
  { subject: "dangling", blockedBy: ["2"] },
  { subject: "resolves", blockedBy: ["T1"] },
  { subject: "bare", blockedBy: [] as string[] },
].reduce((record, row) => addTeamTask(record as never, { ...row, kind: "work" } as never, now), empty as never) as {
  tasks: Array<{ id: string; blockedBy: string[]; unresolvedBlockers?: string[] }>
}

/** The task whose reference named nothing. */
const dangling = board.tasks.find(task => task.id === "T2")
/** The task with genuinely no blocker at all. */
const bare = board.tasks.find(task => task.id === "T4")
/** What the split helper answers for the dangling reference and for a resolvable one. */
const split = {
  dangling: resolveBlockers(board as never, ["2"]),
  resolvable: resolveBlockers(board as never, ["T1"]),
}

console.log(JSON.stringify({
  tasks: board.tasks.map(task => ({ id: task.id, blockedBy: task.blockedBy, unresolvedBlockers: task.unresolvedBlockers ?? null })),
  depths: Object.fromEntries(taskDepths(board.tasks as never)),
  split,
  distinguishable: dangling?.unresolvedBlockers?.length === 1 && bare?.unresolvedBlockers === undefined,
}, null, 2))

if (dangling?.unresolvedBlockers?.[0] !== "2") throw new Error("R21: the dangling reference was not REPORTED on the task")
if (bare?.unresolvedBlockers !== undefined) throw new Error("R21: a task with no blocker must carry no unresolved report")
if (split.resolvable.unresolved.length !== 0) throw new Error("R21: a resolvable reference must report nothing")
if (split.dangling.blockedBy[0] !== "2") throw new Error("R21: the caller's own text must survive in blockedBy")
console.log("R21 PASS: the dangling reference is reported, and 'no blockers' is distinguishable from 'did not resolve'")
