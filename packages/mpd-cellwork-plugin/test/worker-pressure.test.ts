import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshContextPressure } from "../../mpd-dsh-adapter-plugin/src/index"
import { reserveWorkerMaintenance, workerPressureBudget } from "../src/worker-pressure"
import { finishPressureEpoch, reservePressureEpoch } from "../src/pressure-epochs"

/** The measured worker request must leave the configured completion and maintenance reserves. */
const limits = { checkpointRatio: 0.1, outputReserveTokens: 8192, compactionHeadroomTokens: 65536 }

/** Boot projection shape, using the measured window instead of a fallback configuration field. */
function observed(used: number, window: number = 1000000): DshContextPressure {
  return { usedTokens: used, windowTokens: window, ratio: used / window, provenance: "observed" }
}

test("soft occupancy keeps a useful next request admissible after idle compaction", () => {
  expect(workerPressureBudget(observed(150021), limits)).toMatchObject({ kind: "defer", reserve: 73728 })
  expect(workerPressureBudget(observed(146298), limits)).toMatchObject({ kind: "defer", used: 146298, window: 1000000 })
})

test("hard reserve takes precedence over even a configured 100 percent soft threshold", () => {
  /** The provider's actual maximum completion is larger than the configured minimum. */
  const maxOutput = 16000
  expect(workerPressureBudget(observed(918464), { ...limits, checkpointRatio: 1 }, maxOutput)).toMatchObject({ kind: "hard", reserve: 81536 })
  expect(workerPressureBudget(observed(918463), { ...limits, checkpointRatio: 1 }, maxOutput)?.kind).toBe("below")
  expect(workerPressureBudget(observed(990000), limits)?.kind).toBe("hard")
})

test("unobserved and invalid windows grant neither exception nor invented capacity", () => {
  expect(workerPressureBudget({ usedTokens: 146298, windowTokens: null, ratio: null, provenance: "no-window" }, limits)).toBeUndefined()
  expect(workerPressureBudget(observed(10, 0), limits)).toBeUndefined()
  expect(workerPressureBudget(observed(Number.NaN), limits)).toBeUndefined()
})

test("same-session reactivation and unrelated board revisions cannot repeat maintenance", () => {
  /** This marker is a real exclusive file under a fresh synthetic cell root. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-pressure-marker-"))
  try {
    /** The first maintenance reserves one whole attempt even if the engine subsequently refuses. */
    const assignment = { workspace, cellId: "cell-pressure", attemptKey: "same-project/member/session/T1/1", teamId: "team-original", sessionId: "member-executor", taskId: "T1", attempt: 1, revision: 4 }
    expect(reserveWorkerMaintenance(assignment)).toBe(true)
    expect(reserveWorkerMaintenance({ ...assignment, revision: 5 })).toBe(false)
    expect(reserveWorkerMaintenance({ ...assignment, attempt: 2, attemptKey: "same-project/member/session/T1/2" })).toBe(true)
    /** A separate active case has a durable resolved history boundary at native sequence 100. */
    const later = { ...assignment, attempt: 3, attemptKey: "same-project/member/session/T1/3" }
    /** One real reservation remains spent if the process stopped before producing a receipt. */
    const marker = reservePressureEpoch(later)
    if (marker === undefined) throw new Error("first pressure epoch refused")
    expect(reservePressureEpoch(later, { used: 190000, window: 1000000, useful: { seq: 108, bytes: 2100 } })).toBeUndefined()
    finishPressureEpoch(marker, { used: 150000, window: 1000000, seq: 100 })
    expect(reservePressureEpoch(later, { used: 180000, window: 1000000, useful: { seq: 100, bytes: 3000 } })).toBeUndefined()
    expect(reservePressureEpoch(later, { used: 150010, window: 1000000, useful: { seq: 108, bytes: 3000 } })).toBeUndefined()
    expect(reservePressureEpoch(later, { used: 180000, window: 1000000, useful: { seq: 108, bytes: 3000 } })).toBeDefined()
    expect(reservePressureEpoch(later, { used: 180000, window: 1000000, useful: { seq: 108, bytes: 3000 } })).toBeUndefined()
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
