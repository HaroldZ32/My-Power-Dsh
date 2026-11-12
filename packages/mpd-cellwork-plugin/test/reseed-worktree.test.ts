// Lane C of `.mpd/plans/agent-worktrees.md` (decision D8): the compaction reseed is a FRESH child raised
// beside the old one, so without a `cwd` the promoted member would silently move back into the shared
// checkout. The subject here is the ACTIVATION REQUEST the adapter receives — a supplied worktree path
// must ride `request.cwd`, and an absent one must leave the request's shape exactly as it was.
import { describe, expect, test } from "bun:test"

import { DEFAULT_CELLWORK_CONFIG } from "../src/config.ts"
import { promoteAfterHandoff } from "../src/protocol-core.ts"
import { newCellState, type CellState } from "../src/state.ts"

/** The cell whose worker is being reseeded, with the one live seat the barrier reads. */
function cellWithWorker(): CellState {
  /** The fresh record. */
  const cell = newCellState({ cellId: "cell-wt", objective: "o", captainSessionId: "session-captain", now: new Date() })
  return { ...cell, teamId: "team-wt", members: { worker: { name: "worker", role: "Senior Engineer", sessionId: "session-worker", executorRef: "session-worker", mode: "member" as const, handoffReady: false, handoffs: 0, joinedAt: "" } } }
}

/** The member's worktree path this arm's lookup answers. */
const WORKTREE = "/ws/.mpd/worktrees/team-wt/worker"

/**
 * Drive ONE reseed with the seams a live composition offers.
 * @param worktreeCwd - the lookup the row wires from `mpdWorktree.cwdForMember`, or undefined for none.
 * @param options - the cell record and the RESOLVED execution team id under test.
 * @returns the activation request the adapter received, so the arm reads the real forwarded shape.
 */
async function reseed(
  worktreeCwd?: (input: { teamId: string; member: string }) => string | undefined,
  options: { cell?: CellState; worktreeTeamId?: string } = {},
): Promise<Record<string, unknown>> {
  /** Every activation spec the adapter received. */
  const captured: Array<{ request?: Record<string, unknown> }> = []
  /** The one live member session the retirement targets. */
  const liveMember = { id: "session-worker" }
  /** The captain, the only live ancestor the reseed may be raised under. */
  const liveCaptain = { id: "session-captain" }
  /** The barrier's outcome. */
  const outcome = await promoteAfterHandoff({
    dsh: {
      compactionEngineForAgent: () => ({ compactNow: async () => null }),
      compactionEngineForLiveAgent: () => undefined,
      liveAgentExact: (id: string) => (id === "session-captain" ? liveCaptain : id === "session-worker" ? liveMember : undefined),
      startContinuableAgent: async (spec: unknown) => {
        captured.push(spec as { request?: Record<string, unknown> })
        return { childId: "handle-fresh" }
      },
      interruptAgent: () => {},
    },
    agent: {},
    memberName: "worker",
    sessionId: "session-worker",
    parentSessionId: "session-captain",
    cell: options.cell ?? cellWithWorker(),
    config: { ...DEFAULT_CELLWORK_CONFIG, compactionRetries: 1, idleBarrierDelayMs: 0 },
    handoffText: "## Next step\nfinish B",
    nextStep: "finish B",
    injectDirective: () => {},
    sleep: async () => {},
    ...(options.worktreeTeamId === undefined ? {} : { worktreeTeamId: options.worktreeTeamId }),
    ...(worktreeCwd === undefined ? {} : { worktreeCwd }),
  })
  expect(outcome.outcome).toBe("reseeded")
  // A reseed that never reached the adapter would satisfy a weaker assertion by telling us nothing.
  expect(captured.length).toBe(1)
  return captured[0].request as Record<string, unknown>
}

describe("the compaction reseed keeps the member in its worktree (D8)", () => {
  test("a recorded worktree path rides the reseed request as cwd", async () => {
    /** The activation request, built by the REAL reseed path. */
    const request = await reseed((input) => {
      // The lookup is addressed with the cell's team and the member's own name — never a member id.
      expect(input).toEqual({ teamId: "team-wt", member: "worker" })
      return WORKTREE
    })
    expect(request.cwd).toBe(WORKTREE)
    // The rest of the request is untouched: prompt blocks, the live parent and the depth cap.
    expect(request.parent).toEqual({ id: "session-captain" })
    expect(Array.isArray(request.prompt)).toBe(true)
    // A session with no recorded ancestry is depth 0, so its child lands at depth 1.
    expect(request.maxDepth).toBe(1)
  })

  test("no recorded worktree leaves the request without a cwd KEY", async () => {
    /** The activation request with a lookup that answers nothing. */
    const request = await reseed(() => undefined)
    // Absence is the contract: the host inherits the parent's directory, and a written
    // `cwd: undefined` would be indistinguishable from a caller-supplied path to some serializers.
    expect("cwd" in request).toBe(false)
    expect(Object.hasOwn(request, "cwd")).toBe(false)
  })

  test("a lookup that THROWS is the same as no worktree, never a failed reseed", async () => {
    /** The activation request, whose lookup throws. */
    const request = await reseed(() => { throw new Error("no index here") })
    expect("cwd" in request).toBe(false)
  })

  test("the lookup addresses the RESOLVED EXECUTION team, never the cell's planning id", async () => {
    /** The ended planning team the legacy cell record still names. */
    const planning = "team-planning"
    /** The execution team the live board resolved to, which keys the member's worktree. */
    const execution = "team-exec"
    /** The legacy record: `teamId` still points at the planning team. */
    const legacyCell: CellState = { ...cellWithWorker(), teamId: planning, planningTeamId: planning }
    /** The activation request, whose lookup asserts the id it is addressed with. */
    const request = await reseed((input) => {
      expect(input).toEqual({ teamId: execution, member: "worker" })
      return WORKTREE
    }, { cell: legacyCell, worktreeTeamId: execution })
    // The plan/record still carries the planning id — only the worktree lookup was re-addressed.
    expect(legacyCell.teamId).toBe(planning)
    expect(request.cwd).toBe(WORKTREE)
  })
})
