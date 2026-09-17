# F1 (t30's finding) — the cycle note's over-claim, filed as an artifact (T-90)

Filed at the captain's request: the measurement otherwise lives only in an exchange, and **an artifact
path is the anchor while a relay is removable.** The FIX landed under `t43`; this is the reading, not a
second edit — no `lib/**` byte was touched for it.

- **the condition** — `lib/state.js:184`: `if (cycle.length > 0 && dependencyStates(tasks, dependencies).blocking.length > 0)`
  (the acceptance's own either/or, second branch: suppress when the task's own blocking set is empty);
- **the arm** — `self-fix-tests/t43-mailbox-clear-guard.test.mjs:72`, the reviewer's three cases:
  members PENDING → `blocking=['c2']` and the note `[unresolved dep: cycle c2→c1→c2]` (correct, kept exactly);
  members FAILED → `blocking` asserted `[]` (T is CLAIMABLE) and the note asserted `""`; all-COMPLETED → the same;
  reading **3 tests / 0 fail / 18 expect()**;
- **its RED side, by SEMANTIC revert** (not a HEAD mirror): on a scratch copy, removing ONLY the
  `&& blocking.length > 0` conjunct sent the F1 arm to **FAIL** while the other two arms stayed green
  (mirror exit 1). One condition, one arm, and the arm can redden.

The same readings are also stored in `evidence/agent-teams/wave2b-laneA/20260917T153139Z/README.txt`
(the verification package produced for `t45`, which the captain cancelled as redundant with this fix).
