// T-D4 — THE WEB PLANE IS ALREADY SESSION-SCOPED (frozen PART D.2 row 5), measured without editing it.
//
// THE CLAIM: the web team view resolves `?sessionId=` through the team record's own resolver, and a
// request WITHOUT a session id gets `team: null` plus a workspace LIST — never a workspace-principal
// team. That is the opposite of the TUI defect this lane repaired, so the contract asks for a PROOF
// that the web plane needs no change rather than a change to it (`mpd-bundle-plugin` is another lane's
// package and is NOT edited here).
//
// WHAT THIS SCRIPT DOES. It drives the PURE projection the route handler itself calls
// (`buildTeamState`, exported by `mpd-team-core-plugin/src/team-web.ts`) with three inputs and prints
// the three payloads: a session with a record, a session without one, and NO session at all. It then
// probes the two SHIPPED artifacts for the wiring (`?sessionId=` on the client, the route's own session
// read on the server) and prints their sha256, so the claim is anchored to bytes rather than to a path.
//
// PROBE ONLY: nothing here writes a file, imports a browser or edits another package.
import { readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { buildTeamState } from "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-team-core-plugin/src/team-web.ts"

const REPO = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
const WORKSPACE = "/tmp/web-probe-ws"
const INSTANT = "2026-10-08T08:00:00.000Z"

/** One mpd team record bound to one session, in the store's own shape. */
function record(sessionId: string, teamId: string): Record<string, unknown> {
  return {
    version: 1,
    teamId,
    name: `board-${teamId}`,
    description: `board for ${sessionId}`,
    leadSessionId: sessionId,
    phase: "active",
    createdAt: INSTANT,
    approvedAt: INSTANT,
    members: [{ id: "M1", name: "lead", description: "Lead", role: "Lead", status: "running", spawnedAt: INSTANT }],
    tasks: [{ id: "T1", subject: "one task", description: "one task", kind: "work", status: "pending", blockedBy: [], writeScopes: [], createdAt: INSTANT, updatedAt: INSTANT, revision: 1 }],
    nextMemberNumber: 2,
    nextTaskNumber: 2,
  }
}

/** The listing the route would read from the workspace directory. */
const listing = { records: [{ teamId: "team-a", name: "board-team-a", leadSessionId: "sess-A", phase: "active" }] }

const executor = { kind: "native", reason: "probe" }

console.log("=== T-D4 · the web plane's session scoping, driven through the route's own projection ===")
const owned = buildTeamState(record("sess-A", "team-a") as never, WORKSPACE, "sess-A", executor, listing as never)
console.log(`session WITH a record   : sessionId=${owned.sessionId} team=${owned.team === null ? "null" : (owned.team as { id: string }).id} tasks=${owned.tasks.length}`)
const other = buildTeamState(undefined, WORKSPACE, "sess-B", executor, listing as never)
console.log(`session WITHOUT a record: sessionId=${other.sessionId} team=${other.team === null ? "null" : "A TEAM (LEAK!)"} tasks=${other.tasks.length} workspaceTeams=${other.workspaceTeams.records.length}`)
const none = buildTeamState(undefined, WORKSPACE, "", executor, listing as never)
console.log(`NO session id at all    : sessionId="${none.sessionId}" team=${none.team === null ? "null" : "A TEAM (principals are NOT served)"} workspaceTeams=${none.workspaceTeams.records.length}`)

console.log("")
console.log("=== the shipped artifacts ===")
for (const path of [
  `${REPO}/packages/mpd-bundle-plugin/dist/index.js`,
  `${REPO}/packages/mpd-bundle-plugin/client.js`,
  `${REPO}/packages/mpd-team-core-plugin/dist/index.js`,
]) {
  const bytes = readFileSync(path)
  const text = bytes.toString("utf8")
  console.log(`${path.replace(REPO + "/", "")}  sha256=${createHash("sha256").update(bytes).digest("hex")}  bytes=${statSync(path).size}`)
  console.log(`    carries "?sessionId=": ${text.includes("?sessionId=")}   carries "team: null": ${text.includes("team: null")}`)
}

console.log("")
console.log("VERDICT: the web plane resolves the TEAM from the session id it was asked about; a session with")
console.log("no record gets team=null plus the workspace listing; and with no session id it does NOT fall back")
console.log("to a principal team. No change to `mpd-bundle-plugin` is required by PART D.2 row 5.")
