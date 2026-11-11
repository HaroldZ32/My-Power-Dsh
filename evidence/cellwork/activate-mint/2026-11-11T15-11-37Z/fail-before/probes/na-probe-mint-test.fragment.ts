// ── N-a PROBE (evidence only, pre-repair source 4affc62d): the retry mints a SECOND team ─────────
//
// THIS FILE IS A PROBE, NOT A GATE: it asserts the DEFECT the round-3 fail-before log only named. Bun
// stops at the first failing assertion, so the round-3 run red at `failed.mintedTeamId` (a field that
// did not exist yet) and never reached the create-count / byte assertions. This probe is run against
// the SAME pre-repair source with ONLY behavioural assertions, so its PASS is the missing support for
// "on HEAD the retry mints team-3".
test("N-a PROBE: on 4affc62d arm A's retry mints a SECOND execution team (create +2)", async () => {
  /** The harness on an ended planning board. */
  const harness = makeHarness()
  /** The cell and the dead planning record. */
  const { planning } = await endedPlanningCell(harness)
  /** The `create` calls staging spent before activation. */
  const createsBefore = createCalls(harness)
  /** The dead board's row count, which must not move. */
  const planningRowsBefore = planning.tasks.length
  // THE SAME FAILURE ARM A INJECTS: the mint succeeds, then the first LIVE member append is refused.
  harness.injection.memberFailAt = 1
  /** The failed pass: it minted team-2. */
  const failed = await runTool(harness, "cellwork_activate", {})
  expect(failed.ok).toBe(false)
  expect(createCalls(harness)).toBe(createsBefore + 1)
  // THE RETRY, with the failure cleared. On this source the partial checkpoint does NOT carry the minted
  // id, so the retry sees an "initial" pass again and its mint arm runs a SECOND time.
  harness.injection.memberFailAt = 0
  /** The resumed pass. */
  const retried = await runTool(harness, "cellwork_activate", {})
  expect(retried.ok).toBe(true)
  // THE DEFECT, AS NUMBERS: one more `create` than the fixed build (team-3 beside the orphaned team-2).
  expect(createCalls(harness)).toBe(createsBefore + 2)
  expect(harness.teamRecords.size).toBe(3)
  expect(harness.teamRecords.has("team-3")).toBe(true)
  // The ended planning board is untouched either way: the orphan is the MINTED team-2, not the dead board.
  expect(planning.tasks.length).toBe(planningRowsBefore)
})
