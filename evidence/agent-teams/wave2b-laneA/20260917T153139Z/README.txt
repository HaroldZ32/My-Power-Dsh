T45 EVIDENCE (verification-only; the fix landed under t43 and is NOT re-edited here)
date: 2026-09-17T15:31:39Z

=== 1. the condition (t30-F1), on the current worktree ===
184:    if (cycle.length > 0 && dependencyStates(tasks, dependencies).blocking.length > 0)
1610:    return dependencyStates(tasks, dependencies).blocking.length > 0 ? 'blocked' : 'open';

=== 2. the arm, green ===
bun test v1.3.14 (0d9b296a)

packages/mpd-agent-teams-plugin/self-fix-tests/t43-mailbox-clear-guard.test.mjs:
(pass) P1: the pre-fix return expression is NOT lossless on the real manifest shape, and the shipped one IS [0.51ms]
(pass) P1c: an UNDELIVERED/UNREAD record is PROTECTED by default, reported as skipped_unread, and cleared only with force [6.13ms]
(pass) F1 (t30's finding): the cycle note fires only while the cycle BLOCKS — a failed or completed cycle must not fire [0.59ms]

 3 pass
 0 fail
 18 expect() calls
Ran 3 tests across 1 file. [48.00ms]

=== 3. the RED side by SEMANTIC revert (the t29-era note restored on a scratch copy) ===
mirror: the F1 condition REVERTED (t29-era note)
bun test v1.3.14 (0d9b296a)

packages/mpd-agent-teams-plugin/self-fix-tests/t43-mailbox-clear-guard.test.mjs:
(pass) P1: the pre-fix return expression is NOT lossless on the real manifest shape, and the shipped one IS [0.60ms]
(pass) P1c: an UNDELIVERED/UNREAD record is PROTECTED by default, reported as skipped_unread, and cleared only with force [6.39ms]
72 | test("F1 (t30's finding): the cycle note fires only while the cycle BLOCKS — a failed or completed cycle must not fire", () => {
73 |     const pending = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "pending", dependencies: ["c1"] }]
74 |     expect(unresolvedDependencyNote(pending[0], pending)).toContain("cycle c2→c1→c2")
75 |     const failed = [{ id: "c1", status: "pending", dependencies: ["c2"] }, { id: "c2", status: "failed", dependencies: ["c1"] }]
76 |     expect(dependencyStates(failed, failed[0].dependencies).blocking).toEqual([])
77 |     expect(unresolvedDependencyNote(failed[0], failed), "a FAILED cycle leaves the task CLAIMABLE — the note must not fire").toBe("")
                                                                                                                                 ^
error: a FAILED cycle leaves the task CLAIMABLE — the note must not fire

Expected: ""
Received: " [unresolved dep: cycle c2→c1→c2]"

      at <anonymous> (/tmp/t45-red/packages/mpd-agent-teams-plugin/self-fix-tests/t43-mailbox-clear-guard.test.mjs:77:125)
(fail) F1 (t30's finding): the cycle note fires only while the cycle BLOCKS — a failed or completed cycle must not fire [0.64ms]

 2 pass
 1 fail
 16 expect() calls
Ran 3 tests across 1 file. [49.00ms]

=== 4. the verify: full suite ===
