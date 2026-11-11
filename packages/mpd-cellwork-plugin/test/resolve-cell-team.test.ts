// THE BOARD RESOLVER NEVER LANDS ON A TERMINAL TEAM (blind review H1/M2 on PR #110).
//
// The resolver is the ONE rule every cellwork reader uses to answer "which team is this cell's board
// on". Two properties are proven here, independently of any tool pass:
//
//   1. a record that carries `endedAt` or a non-live phase is NEVER a landing target — not as the
//      recorded fast path, not as the planning fallback — because a fresh execution team numbers its
//      board from `T1`, the SAME ids the ended planning board carries, so an id-only match would send
//      every retry back to the dead board;
//   2. the team a FAILED activation MINTED is the first candidate, accepted on its own authority: it is
//      the only id that can distinguish the two identically-numbered boards.
//
// The live-phase set is bound to team-core's `TeamPhase` by TYPE in `state.ts`; the first arm adds the
// runtime half, so a widened live set in team-core reddens this file instead of silently diverging.
import { expect, test } from "bun:test"
import { LIVE_TEAM_PHASES } from "../../mpd-team-core-plugin/src/team-lifecycle.ts"
import type { TeamPhase } from "../../mpd-team-core-plugin/src/team-store.ts"
import { resolveCellTeam, type CellTeamResolution } from "../src/state.ts"
// A NAMESPACE import for the phase list: the arm must be able to REPORT the missing binding as a red
// assertion instead of failing the whole file at link time while the fix is still being written.
import * as cellworkState from "../src/state.ts"

/** The fields one arm hands the resolver: the cell record's board-shaped slice plus the team records. */
interface ResolveFixture {
  /** The cell-record fields the resolver reads. */
  cell: Parameters<typeof resolveCellTeam>[0]["cell"]
  /** Team records by id, served through the service's `get`. */
  records: Record<string, Record<string, unknown>>
}

/**
 * Resolve one fixture through the same seam shape the flow uses.
 *
 * @param fixture - the cell slice and the readable team records.
 * @returns the resolution under test.
 */
function resolve(fixture: ResolveFixture): CellTeamResolution {
  /** The team service: `get` only, the one seam every arm needs. */
  const teams = { get: (_workspace: string, teamId: string): unknown => fixture.records[teamId] }
  return resolveCellTeam({ workspace: "/ws", cell: fixture.cell, teams })
}

/** A board row holding one of the cell's activated ids. */
const MATCHING_BOARD = [{ id: "T1", subject: "Implement the auth core" }]

test("N1: the cellwork live-phase set is bound to team-core's TeamPhase and matches its live list", () => {
  // THE COMPILE-TIME HALF: every spelling here must be a member of team-core's `TeamPhase`. A phase
  // renamed or dropped upstream stops this file type-checking, instead of leaving a stale literal.
  /** The phase list, typed against the upstream union. */
  const bound: readonly TeamPhase[] = cellworkState.LIVE_CELL_TEAM_PHASES
  // THE RUNTIME HALF: a live phase ADDED upstream (say `paused`) must be adopted here too, or a record
  // in that phase would be treated as terminal by cellwork while team-core still lets it resolve.
  expect([...bound] as readonly string[]).toEqual(LIVE_TEAM_PHASES)
})

test("resolver: a TERMINAL recorded team is not a landing target, even when its board ids match", () => {
  /** The recorded planning board, ended by the clean-terminal auto-end. */
  const dead = { teamId: "team-plan", phase: "ended", endedAt: "2026-11-11T00:00:00.000Z", tasks: MATCHING_BOARD }
  /** The resolution a retry would take. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "team-plan", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" } },
    records: { "team-plan": dead },
  })
  // The board ids match only because BOTH boards number from T1; the phase is what disqualifies it.
  expect(result.teamId).toBe("")
  expect(result.resolution).toBe("none")
  // THE FIFTH STATE'S PRECONDITION (blind review H1-2): the recorded record is READABLE and terminal, so
  // an activation must refuse the fallback instead of re-adopting the id the resolver just rejected.
  expect(result.recordedTerminal).toBe(true)
})

test("resolver: an UNREADABLE recorded team is NOT terminal — the fifth state stays available", () => {
  // The reader collapses every read failure into `undefined`; that is exactly the shape the documented
  // `unverified` fallback exists for, so it must not look terminal.
  /** The resolution for a recorded id no record answers. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "team-unreadable", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" } },
    records: {},
  })
  expect(result.teamId).toBe("")
  expect(result.resolution).toBe("none")
  expect(result.recordedTerminal).toBe(false)
})

test("resolver: a TERMINAL planning fallback is refused when the cell has no activated ids yet", () => {
  /** The ended planning record: it holds the split's own rows, none of them an activated id. */
  const dead = { teamId: "team-plan", phase: "ended", endedAt: "2026-11-11T00:00:00.000Z", tasks: [{ id: "T2" }] }
  /** The resolution for a cell whose activation has not minted a board id yet. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "", planningTeamId: "team-plan", captainSessionId: "session-captain", activatedTasks: {} },
    records: { "team-plan": dead },
  })
  // With no activated ids the activated-task check is vacuous; the terminal phase must decide instead.
  expect(result.teamId).toBe("")
  expect(result.resolution).toBe("none")
})

test("resolver: the MINTED team a failed pass recorded is the FIRST candidate", () => {
  /** The ended planning board, whose fresh-board ids collide with the minted board's. */
  const dead = { teamId: "team-plan", phase: "ended", endedAt: "2026-11-11T00:00:00.000Z", tasks: MATCHING_BOARD }
  /** The execution team the failed pass minted, still live. */
  const minted = { teamId: "team-exec", phase: "active", tasks: MATCHING_BOARD }
  /** The resolution a retry takes. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "team-plan", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" }, mintedTeamId: "team-exec" },
    records: { "team-plan": dead, "team-exec": minted },
  })
  expect(result.teamId).toBe("team-exec")
  expect(result.resolution).toBe("minted")
})

test("resolver: an explicitly recorded MINTED id is accepted even if its own phase reads terminal", () => {
  /** The minted team as recorded, carrying a terminal phase (the caller addresses it, the write reports). */
  const minted = { teamId: "team-exec", phase: "ended", endedAt: "2026-11-11T00:00:00.000Z", tasks: [] }
  /** The resolution: the minted id is evidence of its own, not a guess from board ids. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: {}, mintedTeamId: "team-exec" },
    records: { "team-exec": minted },
  })
  expect(result.teamId).toBe("team-exec")
  expect(result.resolution).toBe("minted")
})

test("resolver NEGATIVE CONTROL: a LIVE recorded team still resolves on its matching board", () => {
  /** The live team the cell already materialised. */
  const live = { teamId: "team-live", phase: "active", tasks: MATCHING_BOARD }
  /** The resolution. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "team-live", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" } },
    records: { "team-live": live },
  })
  // The terminal rule must not reject the healthy path: the fast path keeps answering it.
  expect(result.teamId).toBe("team-live")
  expect(result.resolution).toBe("state.teamId")
  // A live record is not terminal, so the fifth state's precondition would not refuse a fallback either.
  expect(result.recordedTerminal).toBe(false)
})

test("resolver NEGATIVE CONTROL: an UNKNOWN phase spelling is not proven terminal, so it still resolves", () => {
  // A legacy/foreign record may carry a phase this build never wrote. "Not in the live set" is NOT the
  // same as "proven dead" (team-core still reconciles such rows by content), so only an `endedAt` stamp
  // or a KNOWN terminal spelling may disqualify a candidate — otherwise a healthy board disappears.
  /** The legacy record, spelled with a phase this build does not know. */
  const legacy = { teamId: "team-legacy", phase: "executing", tasks: MATCHING_BOARD }
  /** The resolution. */
  const result = resolve({
    cell: { cellId: "cell-1", teamId: "team-legacy", planningTeamId: "", captainSessionId: "session-captain", activatedTasks: { "auth-core": "T1" } },
    records: { "team-legacy": legacy },
  })
  expect(result.teamId).toBe("team-legacy")
  expect(result.resolution).toBe("state.teamId")
})
