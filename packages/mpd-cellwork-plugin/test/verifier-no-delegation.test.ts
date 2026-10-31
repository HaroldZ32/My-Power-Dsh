// A VERIFIER NEVER DELEGATES (CR repair E).
//
// WHY. The verifier seat's envelope already refused the eight write tools, and a delegated consult slipped past
// it: `mpd_role_spawn` could pick a write-capable role, which would then do the writing the verifier must not
// do — and, worse for the law, it would put another agent's REPORT inside a verdict the verifier signs. So the
// two bundle spawn tools are refused at DISPATCH, with their own sentence, while every reading tool, `bash`,
// the gates and the five `mpd_verify_*` calls stay exactly as they were.
//
// THE CONTROL ARMS matter as much as the refusal: the rule must be scoped to the VERIFIER seat, so an ordinary
// member and the cell PLANNER keep the spawn tools they legitimately use.
import { expect, test } from "bun:test"

import {
  VERIFIER_DENY_TOOLS,
  VERIFIER_NO_DELEGATION,
  cellworkGuardDecision,
  verifierDelegationRefusal,
  verifierRefusal,
  type CellworkSeat,
} from "../src/guard.ts"

/** A VERIFIER seat of one running cell. */
const VERIFIER: CellworkSeat = { cellId: "cell-1", name: "cell-reviewer", mode: "verifier" }

/** An ordinary work member: it keeps the spawn tools, which is the control this file needs. */
const MEMBER: CellworkSeat = { cellId: "cell-1", name: "senior-engineer", mode: "member" }

/**
 * Run one call through the REAL decision.
 *
 * @param seat - the caller's seat.
 * @param toolName - the registered tool name being dispatched.
 * @returns the denial paragraph, or `undefined` when the call is allowed.
 */
function decide(seat: CellworkSeat, toolName: string): string | undefined {
  return cellworkGuardDecision(seat, toolName)
}

test("the no-delegation list is the two bundle spawn tools, and it is NOT the write deny", () => {
  expect([...VERIFIER_NO_DELEGATION]).toEqual(["mpd_role_spawn", "mpd_workmate_spawn"])
  // The write deny is a SEPARATE list and stays exactly the write-capable names: one list per reason, so a
  // refusal always teaches the one repair that matches what it refused.
  for (const name of VERIFIER_NO_DELEGATION) expect(VERIFIER_DENY_TOOLS).not.toContain(name)
  expect(VERIFIER_DENY_TOOLS).toContain("write")
  // `bash` stays available to a verifier BY DESIGN (a gate run needs a shell), so it is in neither list.
  expect(VERIFIER_DENY_TOOLS).not.toContain("bash")
  expect(VERIFIER_NO_DELEGATION).not.toContain("bash")
})

test("a verifier is refused BOTH spawn tools, with a sentence that says why and names the channel", () => {
  for (const toolName of VERIFIER_NO_DELEGATION) {
    /** The denial the verifier seat produces for that spawn tool. */
    const denial = String(decide(VERIFIER, toolName) ?? "")
    expect(denial).toContain(toolName)
    expect(denial).toContain("NEVER DELEGATES")
    // The reason: the verdict is the seat's own work, and a consult would put a report inside it.
    expect(denial).toContain("OWN")
    // The channel it should use instead, and the fact that its normal surface is intact.
    expect(denial).toContain("mpd_verify_record")
    expect(denial).toContain("repair task")
    expect(denial).toContain("bash")
  }
})

test("the delegation refusal is DISTINCT from the write refusal — each names its own repair", () => {
  /** The sentence a verifier's `write` produces. */
  const writeDenial = String(decide(VERIFIER, "write") ?? "")
  /** The sentence a verifier's `mpd_role_spawn` produces. */
  const spawnDenial = String(decide(VERIFIER, "mpd_role_spawn") ?? "")
  expect(writeDenial).toContain("never fixes what it judges")
  expect(writeDenial).not.toContain("NEVER DELEGATES")
  expect(spawnDenial).toContain("NEVER DELEGATES")
  expect(spawnDenial).not.toContain("never fixes what it judges")
  // The two exported builders are the ones the arms above drive, so the wiring cannot drift from the text.
  expect(verifierRefusal("write")).toBe(writeDenial)
  expect(verifierDelegationRefusal("mpd_workmate_spawn")).toBe(String(decide(VERIFIER, "mpd_workmate_spawn")))
})

test("CONTROL: the verifier keeps its whole reading surface — only the two spawn names are gone", () => {
  for (const toolName of ["read", "grep", "glob", "bash", "mpd_verify_record", "mpd_verify_evidence", "mpd_verify_seat", "mpd_verify_open", "mpd_verify_escape", "todo_write"]) {
    expect(decide(VERIFIER, toolName)).toBeUndefined()
  }
})

test("CONTROL: the rule is SCOPED to the verifier seat — a member and the planner keep the spawn tools", () => {
  for (const toolName of ["mpd_role_spawn", "mpd_workmate_spawn"]) {
    expect(decide(MEMBER, toolName)).toBeUndefined()
    // The PLANNER seat is a `member` too: its delegation routes are its OWN contract and are untouched here.
    expect(decide({ cellId: "cell-1", name: "cell-planner", mode: "member" }, toolName)).toBeUndefined()
  }
})
