# t21 rev-B2 — boundary check requested by the captain (nested addition, the sealed review is untouched)

The review of record is `t21-rev-B2-review.md` (sha256 `6add598b736990ef366879eb53767cb0ec362316320bed649d7d2845fce7e0c5`) and stays
byte-identical; this file is the ADDITION the captain's brief asked for (hand-off boundary + the reference
escape hatch), taken at **2026-09-17T14:44:26Z** with the checker pinned at
`fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` (1146 lines — the lane's record says 1143, that is finding B2-F1).

## Direction 1 — the reference escape hatch: IT SWALLOWS A REAL KEY (finding B2-F4, reproduced)

A copy of the real driver `skills/dsh-qa/scripts/tui-team-surface.mjs` whose header gains the claim
`// CHECKS A11 …` (the code never asserts A11):

- **without** a reference token on the line → exit **1**, `CLAIMED-BUT-UNASSERTED A11` + the driver PATH + the header
  phrase (`raw/FU4b-seed-clean.stdout.txt`);
- **with** `t21` on the same line → exit **0** (`raw/FU4-seed-claimed.stdout.txt`).

So the rule the lane describes as "the rule that stops the engine header's `t35 acceptance A1-A4/A6` line inventing a
defect" is applied **per LINE, not per TOKEN**: any line carrying `design|acceptance|plan|§|t<nn>` is discarded from
the claim set entirely, and a genuine claimed-but-unasserted key on such a line is silently missed. This is an
undeclared third matcher-error direction, pointing the way ER-2 exists to prevent (under-report).

Two adjacent readings, same window (`raw/A-a3-position.stdout.txt`, `raw/A-a4-abbreviated-path.stdout.txt`,
`raw/A-control.stdout.txt`): an arm cited by POSITION and a basename-only path each exit **0 with 9/9 green** — silent
non-recognition is indistinguishable from checked-and-clean (finding B2-F3).

On the T-78 arm the captain quotes as "asserted against a record's 7900 bytes": the byte figure is NOT an identity —
the lane's arm record measured 7900 B, my stripped-copy arm records measured 3030/3907 B, my own full-run record 8683 B,
because the size depends on the run's subject set. What makes the arm falsifiable is the strip, and I measured it:
the stripped copy's real record has **no `rules` key** and carries the rule 0 times, and the arm is the **only**
negative-control FAILURE in that copy (`raw/FU1-stripped-record.stdout.txt`, `raw/FU1-stripped-selftest.stdout.txt`,
`raw/strip_rules_block.py`).

## Direction 2 — the lane-D hand-off boundary: IT HOLDS

- **no `skills/**` write in lane B2's window.** B2's run dir is stamped 14:24:31Z…14:25:20Z. Every `skills/**` change
  on disk now is later: `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` 14:35:00Z,
  `skills/dsh-qa/scripts/tui-team-surface.mjs` 14:35:45Z, the new untracked `skills/dsh-qa/scripts/wave2b-lane-d.mjs`
  14:41:40Z, plus the wider lane D set (13 modified files at 14:44:26Z).
- **the skill-side diff is exactly the hand-off**: the two drivers gain 2 × 4 lines of `CLAIM SET (T-80)` block and
  nothing else (`git diff -- skills/`), i.e. the driver-side conformance the lane's record explicitly hands to lane D.
- **both key-producing drivers are named by PATH and both exist**: the record's `T80.live_scan.drivers[]` names
  `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` and `skills/dsh-qa/scripts/tui-team-surface.mjs`, and my own
  live scan printed the same two paths.
- B2's own record declares the boundary in its `scope` block (`inScope`: `scripts/check-citations.mjs`,
  `evidence/extensions/**`, `evidence/gates/wave2b-laneB2/**`; `not_touched`: `skills/** (lane D)` …).

## Consequence of the boundary (not a defect, a moment)

The live reading legitimately MOVED after the lane measured it: 53 files / 0 claim sets / 2 NO-CLAIM-SET at 14:24:52Z
versus 54 files / 2 claim sets / 0 NO-CLAIM-SET / 0 violations at my 14:36:55Z (driver hashes `f18e3b3a…` and
`826a39d4…`, identical before and after my scan). The lane's 0-violation reading was correct for the pre-claim corpus
it measured — I reproduced it on the HEAD blobs of both drivers (`raw/FU2-head-precise.stdout.txt`). During the
transition I even caught a REAL rot at 14:35:43Z — the corpus briefly carried a transient claim containing `A9` and the
checker reported `CLAIMED-BUT-UNASSERTED A9` with the driver PATH — which lane D's next save removed. That is live
proof the T-80 checker works on the corpus it guards.
