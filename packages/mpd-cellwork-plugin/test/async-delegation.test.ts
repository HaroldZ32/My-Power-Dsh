// BACKGROUND DELEGATION — the PURE policy arms (cellwork async delegation, contract §3.2/§3.3).
//
// WHAT THIS FILE PINS, without a harness: the seat matrix (who may start and settle background consults),
// the all-or-nothing task validation, and the fact that the council's two new verbs are refused by BOTH
// the guard and the tool predicate with the SAME teaching sentence. The tool round-trips live in
// `flow.test.ts`, where the fake `mpdConsults` service is mounted.
import { describe, expect, test } from "bun:test"
import {
  CAPTAIN_FORBIDDEN_NAMES,
  CHECKPOINT_ALLOW_TOOLS,
  SUBCAPTAIN_TOOL_NAMES,
  VERIFIER_DENY_TOOLS,
  VERIFIER_NO_DELEGATION,
  captainRefusal,
  cellworkGuardDecision,
  type CellworkSeat,
} from "../src/guard.ts"
import {
  DELEGATE_MAX_TASKS,
  consultRowOf,
  consultSeatRefusal,
  foreignConsultRefusal,
  missingConsultsServiceRefusal,
  readDelegateTasks,
  reportRowOf,
} from "../src/consults.ts"

/** The two verbs this contract adds. */
const NEW_TOOLS: readonly string[] = ["cellwork_delegate", "cellwork_consult"]

/** One seat per guard mode, so the matrix reads as a table. */
const SEATS: Record<string, CellworkSeat> = {
  captain: { cellId: "cell-1", name: "captain", mode: "captain" },
  subcaptain: { cellId: "cell-1", name: "sub", mode: "subcaptain" },
  member: { cellId: "cell-1", name: "senior-engineer", mode: "member" },
  planner: { cellId: "cell-1", name: "cell-planner", mode: "member" },
  verifier: { cellId: "cell-1", name: "cell-reviewer", mode: "verifier" },
  checkpoint: { cellId: "cell-1", name: "worker", mode: "checkpoint" },
}

describe("the guard's seat matrix for the two consult verbs (§3.3)", () => {
  test("the captain is REFUSED, with the ONE sentence that names `cellwork_dispatch` / `agent_teams_dispatch`", () => {
    for (const toolName of NEW_TOOLS) {
      expect(CAPTAIN_FORBIDDEN_NAMES).toContain(toolName)
      /** The guard's denial for the captain. */
      const denial = cellworkGuardDecision(SEATS.captain, toolName)
      expect(denial).toBe(captainRefusal(toolName))
      expect(String(denial)).toContain(toolName)
      expect(String(denial)).toContain("cellwork_dispatch")
      expect(String(denial)).toContain("agent_teams_dispatch")
      expect(String(denial)).toContain("DISPATCHES ONLY")
    }
  })

  test("SUB CAPTAIN is a mini-captain that KEEPS both verbs (the carve-out must not leak down)", () => {
    for (const toolName of NEW_TOOLS) {
      expect(SUBCAPTAIN_TOOL_NAMES).toContain(toolName)
      expect(cellworkGuardDecision(SEATS.subcaptain, toolName)).toBeUndefined()
    }
  })

  test("the planner and an ordinary member keep both verbs", () => {
    for (const toolName of NEW_TOOLS) {
      expect(cellworkGuardDecision(SEATS.member, toolName)).toBeUndefined()
      expect(cellworkGuardDecision(SEATS.planner, toolName)).toBeUndefined()
    }
  })

  test("a VERIFIER is refused with the DELEGATION sentence, and checkpoint mode keeps no channel", () => {
    for (const toolName of NEW_TOOLS) {
      expect(VERIFIER_NO_DELEGATION).toContain(toolName)
      expect(VERIFIER_DENY_TOOLS).toContain(toolName)
      /** The verifier's denial. */
      const denial = String(cellworkGuardDecision(SEATS.verifier, toolName) ?? "")
      expect(denial).toContain(toolName)
      expect(denial).toContain("NEVER DELEGATES")
      // Checkpoint mode allows only its three names, so the two verbs are refused there too.
      expect(CHECKPOINT_ALLOW_TOOLS).not.toContain(toolName)
      expect(String(cellworkGuardDecision(SEATS.checkpoint, toolName) ?? "")).toContain("CONTEXT CHECKPOINT")
    }
  })

  test("a session in NO cell is untouched — the mode costs nothing while it is off", () => {
    for (const toolName of NEW_TOOLS) expect(cellworkGuardDecision(undefined, toolName)).toBeUndefined()
  })
})

describe("the tool predicate repeats the authorisation (defence in depth)", () => {
  test("captain, verifier and checkpoint are refused with the SAME sentences the guard uses", () => {
    for (const toolName of NEW_TOOLS) {
      expect(consultSeatRefusal(toolName, SEATS.captain)).toBe(captainRefusal(toolName))
      /** The verifier's sentence. */
      const verifierDenial = String(consultSeatRefusal(toolName, SEATS.verifier) ?? "")
      expect(verifierDenial).toContain("NEVER DELEGATES")
      /** The checkpoint's sentence. */
      const checkpointDenial = String(consultSeatRefusal(toolName, SEATS.checkpoint) ?? "")
      expect(checkpointDenial).toContain("CONTEXT CHECKPOINT")
    }
  })

  test("planner, subcaptain and recorded member pass; NO seat is refused with the allowed classes named", () => {
    for (const toolName of NEW_TOOLS) {
      expect(consultSeatRefusal(toolName, SEATS.planner)).toBeUndefined()
      expect(consultSeatRefusal(toolName, SEATS.subcaptain)).toBeUndefined()
      expect(consultSeatRefusal(toolName, SEATS.member)).toBeUndefined()
      /** The no-seat refusal. */
      const noSeat = String(consultSeatRefusal(toolName, undefined) ?? "")
      expect(noSeat).toContain(toolName)
      expect(noSeat).toContain("cell-planner")
      expect(noSeat).toContain("SUBCAPTAIN")
      expect(noSeat).toContain("MEMBER")
    }
  })
})

describe("`cellwork_delegate` task validation is ALL-OR-NOTHING", () => {
  test("1..16 tasks parse, in the caller's order, with the optional context", () => {
    /** The parsed answer. */
    const parsed = readDelegateTasks([
      { role: "Explorer", task: "find the router" },
      { role: "Deep Worker", task: "probe it", context: "the cell asked" },
    ])
    expect("tasks" in parsed).toBe(true)
    if (!("tasks" in parsed)) return
    expect(parsed.tasks).toEqual([
      { role: "Explorer", task: "find the router" },
      { role: "Deep Worker", task: "probe it", context: "the cell asked" },
    ])
  })

  test("a non-array, an empty list and more than 16 are refused", () => {
    expect(String((readDelegateTasks("nope") as { error: string }).error)).toContain("array")
    expect(String((readDelegateTasks([]) as { error: string }).error)).toContain("empty")
    /** Seventeen well-formed tasks. */
    const tooMany = Array.from({ length: DELEGATE_MAX_TASKS + 1 }, (_value, index) => ({ role: "Explorer", task: "q" + String(index) }))
    expect(String((readDelegateTasks(tooMany) as { error: string }).error)).toContain(String(DELEGATE_MAX_TASKS))
  })

  test("an empty role, an empty task, a bad context and a non-object entry are refused by INDEX", () => {
    expect(String((readDelegateTasks([{ role: " ", task: "x" }]) as { error: string }).error)).toContain("tasks[0].role")
    expect(String((readDelegateTasks([{ role: "Explorer", task: "  " }]) as { error: string }).error)).toContain("tasks[0].task")
    expect(String((readDelegateTasks([{ role: "Explorer", task: "x", context: 7 }]) as { error: string }).error)).toContain("tasks[0].context")
    expect(String((readDelegateTasks(["Explorer"]) as { error: string }).error)).toContain("tasks[0] is not an object")
    // The FIRST bad entry is the one named, so a reader fixes them one at a time and nothing started.
    expect(String((readDelegateTasks([{ role: "Explorer", task: "ok" }, { role: "", task: "x" }]) as { error: string }).error)).toContain("tasks[1].role")
  })
})

describe("the refusal sentences name the missing piece, never just `not found`", () => {
  test("the absent service names the `mpd-roles` row and forbids an unsupervised fallback", () => {
    /** The sentence both consult verbs use. */
    const refusal = missingConsultsServiceRefusal("cellwork_delegate")
    expect(refusal).toContain("mpdConsults")
    expect(refusal).toContain("mpd-roles")
    expect(refusal).toContain("no unsupervised fallback")
    expect(refusal).toContain("MPD_DSH_CONSULT_MAX")
  })

  test("a foreign consultId names the ownership rule, the other channels and the restart bound", () => {
    /** The sentence. */
    const refusal = foreignConsultRefusal("cellwork_consult", "consult-9", "cell-1")
    expect(refusal).toContain("consult-9")
    expect(refusal).toContain("did not start")
    expect(refusal).toContain("mpd_role_consult")
    expect(refusal).toContain("restart")
    expect(refusal).toContain("cell-1")
  })
})

describe("the service replies are parsed at this boundary", () => {
  test("a view, an outcome with a report, and junk each project honestly", () => {
    expect(consultRowOf({ consultId: "c1", role: "Explorer", state: "running", startedAt: 5, elapsedMs: 1 })).toEqual({ consultId: "c1", role: "Explorer", state: "running", startedAt: 5, elapsedMs: 1 })
    /** One collected outcome. */
    const outcome = consultRowOf({ consultId: "c1", role: "Explorer", state: "complete", startedAt: 5, elapsedMs: 9, report: { role: "Explorer", status: "complete", summary: "S", recommendation: "R", details: "D", evidence: ["e"], stopReason: "end", consultId: "c1", elapsedMs: 9 } })
    expect(outcome?.report?.summary).toBe("S")
    expect(outcome?.report?.evidence).toEqual(["e"])
    expect(consultRowOf({ role: "Explorer" })).toBeUndefined()
    expect(consultRowOf("nope")).toBeUndefined()
    expect(reportRowOf(null)).toBeUndefined()
  })
})
