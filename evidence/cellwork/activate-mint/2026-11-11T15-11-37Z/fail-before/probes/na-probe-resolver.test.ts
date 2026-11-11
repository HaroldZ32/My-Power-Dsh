// N-a PROBE (evidence only, pre-repair source 4affc62d): the ENDED recorded board is the retry target.
//
// The round-3 README said "On HEAD the retry mints team-3 / appends to the dead board". The first half
// is proven by the sibling probe; this one proves the second half at the RESOLUTION the retry uses:
// with an activated board id that the ended planning board also carries (T1 — both boards number from
// T1), the pre-repair resolver returns the ENDED team as the pass's board. The write then addresses it.
import { expect, test } from "bun:test"
import { resolveCellTeam } from "../src/state.ts"

test("N-a PROBE: on 4affc62d the ENDED recorded team is resolved as the board (arm B's target)", () => {
  /** The ended planning record, whose staging row is `T1` — the id the first activated task minted. */
  const dead = { teamId: "team-1", phase: "ended", endedAt: "2026-11-11T00:00:00.000Z", tasks: [{ id: "T1", subject: "requirements" }] }
  /** The exact cell slice arm B's failed run leaves: `teamId` is the dead board, one board id recorded. */
  const result = resolveCellTeam({
    workspace: "/ws",
    cell: { cellId: "cell-1", teamId: "team-1", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" } },
    teams: { get: (_workspace: string, teamId: string): unknown => (teamId === "team-1" ? dead : undefined) },
  })
  // THE DEFECT: no terminal check on this source, so the ended record wins on the colliding T1.
  expect(result.teamId).toBe("team-1")
  expect(result.resolution).toBe("state.teamId")
})
