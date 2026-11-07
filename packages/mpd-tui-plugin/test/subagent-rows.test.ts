// THE ROW LIFECYCLE'S OWN SUITE — the burn projection and the compact row format.
//
// WHAT THIS FILE OWNS (frozen contract `.mpd/plans/tui-panel-wave.md` §5.A1 / §5.A5, decisions
// D1/D2/D7/D8): the two directions of every burn arm, the never-hidden guards, the exactness and
// ambiguity rules of the team arm, the grace window and the compact row text. The SURFACES that consume
// this module are tested where they render (`subagent-scene.test.ts` for the merged scene, and the DAG
// page's own suite); this suite is about the projection itself, so it drives the pure functions with an
// explicit clock instead of racing the wall clock.
import { describe, expect, test } from "bun:test"
import {
  SUBAGENT_ROW_GRACE_MS,
  filterSubagentEntries,
  subagentRowAge,
  subagentRowEntries,
  subagentRowFilter,
  subagentRowLine,
  subagentRowView,
  subagentRowVisible,
  subagentSectionOf,
  subagentSectionRows,
  subagentTeamScope,
  visibleSubagentRows,
} from "../src/subagent-rows"

/** The render clock every arm pins; the fixtures are offsets from it. */
const NOW = Date.UTC(2026, 9, 2, 15, 30, 0)

/** This session's id, as the surfaces read it off their own carrier. */
const SESSION = "session-owner"

/**
 * One host catalog entry, shaped like `channel.subagents`/`snapshot().subagents`.
 * @param overrides - the fields this arm changes; absent ones keep the "settled 30 s ago" defaults.
 * @returns the raw entry the module projects.
 */
function hostRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: "agent-1",
    description: "Plan Reviewer",
    mode: "one-shot",
    status: "completed",
    startedAt: NOW - 300_000,
    completedAt: NOW - 30_000,
    ...overrides,
  }
}

/**
 * A channel double carrying the given host entries.
 * @param rows - the host's own catalog, verbatim.
 * @returns the carrier the module reads.
 */
function channelOf(rows: readonly unknown[]): Record<string, unknown> {
  return { version: 1, sessionId: SESSION, subagents: rows }
}

/**
 * The burn filter for one arm.
 * @param extra - the team scopes (and/or session id) this arm adds.
 * @returns the filter with the pinned clock.
 */
function filterOf(extra: { teams?: readonly { members: readonly string[]; ended: boolean }[]; sessionId?: string } = {}): {
  now: number
  teams?: readonly { members: readonly string[]; ended: boolean }[]
  sessionId?: string
} {
  return { now: NOW, sessionId: SESSION, ...extra }
}

describe("burn after use · ARM 1 — the terminal grace", () => {
  test("the grace is exactly the captain's 60 seconds, and it is exported to be pinned", () => {
    expect(SUBAGENT_ROW_GRACE_MS).toBe(60_000)
  })

  test("a settled row is DRAWN inside the grace and NOT drawn one millisecond past it", () => {
    /** The row exactly ON the bound: `now - endedAt === grace`. */
    const onBound = subagentRowView(hostRow({ completedAt: NOW - SUBAGENT_ROW_GRACE_MS }))!
    /** The same row one millisecond OLDER than the bound. */
    const pastBound = subagentRowView(hostRow({ completedAt: NOW - SUBAGENT_ROW_GRACE_MS - 1 }))!
    expect(subagentRowVisible(onBound, filterOf())).toBe(true)
    expect(subagentRowVisible(pastBound, filterOf())).toBe(false)
    // The positive control: the same row well inside the window is drawn, so the arm above is not
    // passing because the row was unreadable.
    expect(subagentRowVisible(subagentRowView(hostRow({ completedAt: NOW - 1_000 }))!, filterOf())).toBe(true)
  })

  test("`endedAt` outranks `completedAt`, and a terminal row with NEITHER is hidden at once", () => {
    // A row whose two end projections disagree follows the host's settled one.
    const both = subagentRowView(hostRow({ endedAt: NOW - 1_000, completedAt: NOW - 600_000 }))!
    expect(subagentRowVisible(both, filterOf())).toBe(true)
    // No end instant at all: there is nothing to grace, so the row stops being drawn immediately.
    const noEnd = subagentRowView(hostRow({ completedAt: undefined }))!
    expect(noEnd.endedAt).toBeUndefined()
    expect(subagentRowVisible(noEnd, filterOf())).toBe(false)
  })

  test("FAILED and CANCELLED are terminal exactly like COMPLETED", () => {
    for (const status of ["failed", "cancelled"]) {
      /** The settled row in this terminal state. */
      const settled = subagentRowView(hostRow({ status, completedAt: NOW - SUBAGENT_ROW_GRACE_MS - 1 }))!
      expect(subagentRowVisible(settled, filterOf())).toBe(false)
    }
  })

  test("a `starting` or `running` row is NEVER hidden, however old it is", () => {
    for (const status of ["starting", "running"]) {
      /** A live row whose start is decades in the past — the age is irrelevant to liveness. */
      const live = subagentRowView(hostRow({ status, startedAt: 1, completedAt: undefined }))!
      expect(live.live).toBe(true)
      expect(subagentRowVisible(live, filterOf())).toBe(true)
    }
  })

  test("`unknown` is terminal only when a end instant makes its finish provable", () => {
    // No end: the host cannot prove how the run ended, so it stays drawn.
    const open = subagentRowView(hostRow({ status: "unknown", completedAt: undefined }))!
    expect(subagentRowVisible(open, filterOf())).toBe(true)
    // With an end instant the fact is "finished, outcome unknown", which the grace DOES burn.
    const ended = subagentRowView(hostRow({ status: "unknown", completedAt: NOW - SUBAGENT_ROW_GRACE_MS - 1 }))!
    expect(subagentRowVisible(ended, filterOf())).toBe(false)
  })

  test("a row PROVABLY from another session's catalog is never hidden", () => {
    // An ancient terminal row that belongs to somebody else: the projection does not own it.
    const foreign = subagentRowView(hostRow({ completedAt: 1, parentSessionId: "session-other" }))!
    expect(subagentRowVisible(foreign, filterOf())).toBe(true)
    // The SAME row, now provably this session's: the burn applies.
    const own = subagentRowView(hostRow({ completedAt: 1, parentSessionId: SESSION }))!
    expect(subagentRowVisible(own, filterOf())).toBe(false)
    // A carrier with no session id cannot prove foreignness, so the session-scoped catalog is filtered.
    expect(subagentRowVisible(foreign, { now: NOW })).toBe(false)
  })

  test("NO filter draws everything — the back-compat control for a caller that has not wired the scope", () => {
    // This is the declared behaviour a fixture without a clock relies on: the burn projection is
    // OPT-IN, so an unwired call site keeps the historical unfiltered list instead of losing rows.
    const ancient = subagentRowView(hostRow({ completedAt: 1 }))!
    expect(subagentRowVisible(ancient)).toBe(true)
    expect(subagentSectionRows(channelOf([hostRow({ completedAt: 1 })]))).toHaveLength(3)
  })
})

describe("burn after use · ARM 2 — the retired team", () => {
  /** The ended team scope naming this fixture's description. */
  const ENDED = { members: ["Plan Reviewer"], ended: true }
  /** The live team scope naming the same member. */
  const LIVE = { members: ["Plan Reviewer"], ended: false }

  test("an ended team's member row stops being drawn AT ONCE, inside the grace included", () => {
    /** A freshly settled member row — ARM 1 alone would still draw it. */
    /** A settled member row one second old. */
    const fresh = subagentRowView(hostRow({ completedAt: NOW - 1_000 }))!
    expect(subagentRowVisible(fresh, filterOf())).toBe(true)
    expect(subagentRowVisible(fresh, filterOf({ teams: [ENDED] }))).toBe(false)
  })

  test("a LIVE team's member row is never hidden, even long after its own end instant", () => {
    /** A member row settled long past the grace. */
    const old = subagentRowView(hostRow({ completedAt: 1 }))!
    expect(subagentRowVisible(old, filterOf({ teams: [LIVE] }))).toBe(true)
    // And a name that resolves to BOTH a live and an ended team is kept: a live row must never burn.
    expect(subagentRowVisible(old, filterOf({ teams: [ENDED, LIVE] }))).toBe(true)
  })

  test("the match is EXACT: a description that only carries the name falls back to ARM 1", () => {
    /** A team member row whose host description is the task line, not the bare name. */
    const taskLine = subagentRowView(hostRow({ description: "Plan Reviewer — review the wave" }))!
    // Inside the grace the row is drawn: the team arm did NOT fire on a containment match.
    expect(subagentRowVisible(taskLine, filterOf({ teams: [ENDED] }))).toBe(true)
    // Past the grace ARM 1 takes it, exactly as it would with no team scope at all.
    /** The same row, now older than the grace. */
    /** The same non-matching description, settled long past the grace. */
    const oldTaskLine = subagentRowView(hostRow({ description: "Plan Reviewer — review the wave", completedAt: 1 }))!
    expect(subagentRowVisible(oldTaskLine, filterOf({ teams: [ENDED] }))).toBe(false)
  })

  test("an AMBIGUOUS ended match does not fire — two ended teams naming one member keep the row", () => {
    /** A settled member row one second old, matched by TWO ended teams. */
    const fresh = subagentRowView(hostRow({ completedAt: NOW - 1_000 }))!
    expect(subagentRowVisible(fresh, filterOf({ teams: [ENDED, ENDED] }))).toBe(true)
  })

  test("a team with no readable member contributes no scope at all", () => {
    expect(subagentTeamScope(undefined)).toBeUndefined()
    expect(subagentTeamScope({ team: { phase: "ended" }, members: [] })).toBeUndefined()
    expect(subagentTeamScope({ team: { phase: "ended" }, members: [{ name: "Plan Reviewer" }] })).toEqual({ members: ["Plan Reviewer"], ended: true })
    expect(subagentTeamScope({ team: { phase: "active" }, members: [{ name: "Plan Reviewer" }] })).toEqual({ members: ["Plan Reviewer"], ended: false })
    // A hostile projection is "no team scope", never a throw.
    expect(subagentTeamScope({ team: { phase: "ended" }, members: "nope" })).toBeUndefined()
  })
})

describe("the compact row (clause 5 / D7)", () => {
  test("a LIVE row draws its description, its status and its run age — no mode, no ISO", () => {
    /** A running row that started three minutes ago. */
    const live = subagentRowView(hostRow({ status: "running", startedAt: NOW - 3 * 60_000, completedAt: undefined }))!
    /** Its rendered line. */
    const line = subagentRowLine(live, NOW)
    expect(line).toBe("🟡 Plan Reviewer · running · started 3m")
    expect(line).not.toContain("one-shot")
    expect(line).not.toContain("continuable")
    // A full ISO-8601 instant is what clause 5 forbids; the regex is the contract's own shape.
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  test("a SETTLED row draws the age of its end — no mode, no ISO instant", () => {
    /** A completed row that ended thirty seconds ago. */
    const settled = subagentRowView(hostRow({ completedAt: NOW - 30_000 }))!
    /** Its rendered line. */
    const line = subagentRowLine(settled, NOW)
    expect(line).toBe("🟢 Plan Reviewer · completed · ended 30s")
    expect(line).not.toContain("one-shot")
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  test("the age vocabulary is Ns / Nm / Nh / Nd — and `?` for an instant the host never reported", () => {
    for (const [delta, expected] of [
      [999, "<1s"],
      [1_000, "1s"],
      [59_999, "59s"],
      [60_000, "1m"],
      [3_599_999, "59m"],
      [3_600_000, "1h"],
      [86_399_999, "23h"],
      [86_400_000, "1d"],
      [2 * 86_400_000, "2d"],
    ] as const) {
      expect(subagentRowAge(NOW - delta, NOW)).toBe(expected)
    }
    // Epoch 0 is a placeholder rather than a reported instant; a clock that ran backwards floors at 0.
    expect(subagentRowAge(0, NOW)).toBe("?")
    expect(subagentRowAge(Number.NaN, NOW)).toBe("?")
    expect(subagentRowAge(NOW + 5_000, NOW)).toBe("<1s")
  })

  test("a FAILED row keeps the host's red glyph, and an UNKNOWN row the neutral one", () => {
    expect(subagentRowLine(subagentRowView(hostRow({ status: "failed" }))!, NOW).startsWith("🔴")).toBe(true)
    expect(subagentRowLine(subagentRowView(hostRow({ status: "unknown", completedAt: undefined }))!, NOW).startsWith("⚪")).toBe(true)
  })
})

describe("the section over the DRAWN rows", () => {
  test("`rowIndex` addresses the drawn rows, so a hidden row can never shift a click", () => {
    /** The source: one live row, one settled row past the grace, one settled row inside it. */
    const source = channelOf([
      hostRow({ agentId: "live", description: "Live", status: "running", completedAt: undefined }),
      hostRow({ agentId: "gone", description: "Gone", completedAt: 1 }),
      hostRow({ agentId: "fresh", description: "Fresh", completedAt: NOW - 5_000 }),
    ])
    /** The rows this render draws. */
    const drawn = visibleSubagentRows(source, filterOf())
    expect(drawn.map((row) => row.description)).toEqual(["Live", "Fresh"])
    /** The section built from those rows. */
    const section = subagentSectionOf(drawn, NOW)
    // Header, counts row, then the two drawn rows — and their indices are 0 and 1, NOT 0 and 2.
    expect(section).toHaveLength(4)
    expect(section[0].text).toContain("2 total · 1 running · 1 completed · 0 failed")
    expect(section[2]).toEqual({ text: "🟡 Live · running · started 5m", rowIndex: 0 })
    expect(section[3]).toEqual({ text: "🟢 Fresh · completed · ended 5s", rowIndex: 1 })
    // The hidden row is in NEITHER the section nor the visible projection.
    expect(section.some((row) => row.text.includes("Gone"))).toBe(false)
  })

  test("the section end-to-end hides the settled row and keeps the live one", () => {
    /** The source both directions are asserted against. */
    const source = channelOf([hostRow({ description: "Live", status: "running", completedAt: undefined }), hostRow({ completedAt: 1 })])
    /** The filtered section. */
    const section = subagentSectionRows(source, filterOf())
    expect(section[0].text).toContain("1 total · 1 running")
    expect(section.some((row) => row.text.includes("Live"))).toBe(true)
    expect(section.some((row) => row.text.includes("Plan Reviewer"))).toBe(false)
    // THE NEGATIVE CONTROL: the same source with no filter draws both rows, proving the arm above is
    // the projection at work and not an unreadable source.
    expect(subagentSectionRows(source)[0].text).toContain("2 total")
  })

  test("an empty drawn set still answers the header plus the host's own empty state", () => {
    expect(subagentSectionRows(channelOf([]), filterOf())).toHaveLength(3)
    expect(subagentSectionRows(channelOf([hostRow({ completedAt: 1 })]), filterOf())[1].text).toContain("No subagents in the current session")
  })

  test("the reader never re-orders and never throws on a hostile carrier", () => {
    /** A source carrying one readable and one unreadable entry. */
    const source = channelOf([hostRow({ description: "First" }), null, hostRow({ description: "Second" })])
    expect(subagentRowEntries(source).map((pair) => pair.view.description)).toEqual(["First", "Second"])
    expect(subagentRowEntries(null)).toEqual([])
    expect(filterSubagentEntries(subagentRowEntries(source), filterOf())).toHaveLength(2)
  })

  test("`subagentRowFilter` carries the team scope and the session, and omits what it does not know", () => {
    /** A workflow naming one ended team. */
    const workflow = { team: { phase: "ended" }, members: [{ name: "Plan Reviewer" }] }
    expect(subagentRowFilter(workflow, SESSION, NOW)).toEqual({ now: NOW, teams: [{ members: ["Plan Reviewer"], ended: true }], sessionId: SESSION })
    expect(subagentRowFilter(undefined, undefined, NOW)).toEqual({ now: NOW })
    expect(subagentRowFilter(undefined, "", NOW)).toEqual({ now: NOW })
  })
})
