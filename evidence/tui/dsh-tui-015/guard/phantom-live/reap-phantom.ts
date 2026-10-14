// C7-3 live-state demonstration, run over a COPY of this workspace's real `.mpd/team` state.
//
// It never touches the real `.mpd`: the state is copied into a fresh temp workspace and every call runs
// against the copy, which is asserted by printing the sandbox path. What it shows:
//   * every team record's phase and whether the C7-3 rules classify it LIVE;
//   * the hand-patched `archived` ghost (`team-20261014064212`) is NOT live, and a resolution BOUND to it
//     falls through to nothing instead of binding ghost work;
//   * a session whose registry entry points at the LIVE execution team still resolves that team;
//   * the consistency pass marks only the non-live records terminal, on the copy.
import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { activeTeamId, listTeams, readTeam } from "../../../../../packages/mpd-team-core-plugin/src/team-store"
import { isLiveTeam, readArchivedPlanIndex, reapReapedTeams, resolveTeamRecord } from "../../../../../packages/mpd-team-core-plugin/src/team-lifecycle"

/** The real team root of this workspace; read only, never written. */
const REAL = join(process.cwd(), ".mpd", "team")
/** The sandbox workspace the copy lives in. */
const WS = mkdtempSync(join(tmpdir(), "mpd-c7-phantom-"))
console.log("sandbox workspace:", WS)
console.log("real state source :", REAL)
cpSync(REAL, join(WS, ".mpd", "team"), { recursive: true })

/** The archive evidence, read once for every classification below. */
const index = readArchivedPlanIndex(WS)
console.log("\n— every team record, classified by the C7-3 rules —")
for (const record of listTeams(WS)) {
  console.log(`${record.teamId}\tphase=${record.phase}\tlive=${isLiveTeam(record, index)}\tname=${record.name}`)
}

/** The hand-patched phantom team from the measured incident. */
const GHOST_ID = "team-20261014064212"
/** The ghost record, read from the copy. */
const ghost = readTeam(WS, GHOST_ID)
console.log("\n— the measured phantom —")
console.log("ghost record present:", ghost !== undefined, "phase:", ghost?.phase, "live:", ghost === undefined ? "n/a" : isLiveTeam(ghost, index))
if (ghost !== undefined) {
  /** A resolution whose FIRST arm (the session→team index) is the ghost itself. */
  const boundGhost = resolveTeamRecord({ bound: ghost, teams: listTeams(WS), sessionId: ghost.leadSessionId, index })
  console.log("resolution BOUND to the ghost ->", boundGhost.record?.teamId ?? "(none)")
}

console.log("\n— the registry bindings that still exist —")
for (const record of listTeams(WS)) {
  /** The team the index binds this record's lead session to, if any. */
  const bound = activeTeamId(WS, record.leadSessionId)
  if (bound === undefined) continue
  /** The resolution that registry entry produces under the C7-3 rules. */
  const res = resolveTeamRecord({ ...(readTeam(WS, bound) === undefined ? {} : { bound: readTeam(WS, bound)! }), teams: listTeams(WS), sessionId: record.leadSessionId, index })
  console.log(`lead ${record.leadSessionId.slice(0, 8)} bound=${bound} resolved=${res.record?.teamId ?? "(none)"}`)
}

console.log("\n— the consistency pass, on the COPY —")
/** The team ids the pass marked terminal. */
const reaped = reapReapedTeams(WS, new Date("2026-10-14T10:00:00.000Z"))
console.log("reaped:", JSON.stringify(reaped))
for (const id of reaped) {
  /** The repaired record, re-read. */
  const after = readTeam(WS, id)
  console.log(`after ${id}\tphase=${after?.phase}\treason=${after?.archivedReason}`)
}
rmSync(WS, { recursive: true, force: true })
console.log("\nsandbox removed:", WS)
