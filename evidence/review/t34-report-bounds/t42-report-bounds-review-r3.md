# t42 — review round 3: the wave-2a report at its 275-line revision

**Reviewed object:** `evidence/wave2a-integration/20260917T085313Z-sweep-part1/REPORT.md`, read at its round-3 revision (275 lines; t34 judged 181, t39 judged 264). **Seat:** Plan Reviewer, read-only, no shell command run. **Verdict: PASS** — the three round-2 findings are closed at their records, no over-claim survives, and every completeness item of the contract is carried.

**Boundary:** §9 states it in the file and it holds — the round-3 edits are the three R2 fixes, the excluded-runs parenthetical and the four-vs-five-owner-groups distinction; the rest of the file is byte-stable against the revision t39 reconciled (§1, §5.5, §6 b1/b3/b5–b8, §7, §8 spot-checked here; §2's package-test row, §3, §4, §5.1–§5.4, §5.6–§5.7 read at 264).

## 1. Round-2 findings — closure verified

| finding | the fix on disk | record checked | verdict |
|---|---|---|---|
| R2-F-1 (medium) | §6's transient bullet: "against **TEN controlled GREEN runs, recorded** — four sequential plus six concurrent under load, enumerated in `evidence/agent-teams/t8-lane-a/20260917T071056Z/ADDENDUM-transient-red.md` (v1/v2/v3/verify-1-full + `load-run/load1..6`) and counted the same way in `t8`'s own `acceptanceResults`"; the excluded runs are declared as a message-level report and kept OUT of the count: "*(A further six runs were REPORTED in a message while this revision was being written; no durable record enumerates them, so they are excluded from the count rather than cited — T-90's rule applied to our own tally.)*"; "full capture" survives only where a record supports it (the integration run's own log) | `ADDENDUM-transient-red.md` ("UNREPRODUCED in ten controlled runs"; the four sequential + six concurrent logs), t8's `acceptanceResults` ("Ten full-suite runs are green (four sequential + six concurrent…)"); independent grep: `sixteen-plus`, `6 more`, `full-capture` → 0 occurrences | **CLOSED** |
| R2-F-2 (low) | §9: "The four late writers §A-25 counts, by ITS OWN labels: FIRST = lane D's self-caught evidence repair (its §A-25(4) item …); SECOND = lane B3's README pair (`t20`); THIRD = lane C's digest row in `agent-references/troubleshooting.md`; FOURTH = lane C's own honest addendum correcting an unmeasured \"55 rows\"." plus the substantive disambiguation: "**The set this re-pack absorbed is the five OWNER groups above, not the same four**" | §A-25(2) labels the SECOND as lane B3's README pair ✓; §A-25(3) labels the THIRD as lane C's digest row AND names the FOURTH ("and the FOURTH with the lane's own honest addendum") ✓; the FIRST is disclosed as §A-25's item (4) in-line | **CLOSED** (one wording residual, recorded below, non-blocking) |
| R2-F-3 (low) | §6's closure bullet now ends: "…and captain log **§A-25(1)** ('exit 0 and 0 drift are TRUE BEFORE the re-pack too … the post-re-pack acceptance is **membership**') plus **§A-26(2)** (the count corrected into a membership test) carry the trade's architecture, with **§A-29** carrying its second half (integrity: timestamp order + `--pack-stamp`)." | §A-25(1) reads "`exit 0` and `0 drift` are TRUE BEFORE the re-pack too … the post-re-pack acceptance is **membership**" ✓; §A-26(2) is "A COUNT was refuted into a MEMBERSHIP test" ✓; §A-29 = the trade's second half ✓; independent grep: `§A-8/§A-29` → 0 occurrences | **CLOSED** |

## 2. Residual recorded, NOT a finding

§9's phrase "**by ITS OWN labels**" is stronger than §A-25 supports: that section explicitly labels the SECOND and THIRD, names a FOURTH in passing, and carries no FIRST label — the FIRST is the report's reading of §A-25(4). It is disclosed in-line ("its §A-25(4) item"), each of the four names its source item, and the substantive point the round-2 finding raised — that the four are NOT the set the re-pack absorbed — is now stated outright with the five owner groups named above it. A reader cannot be misled into the conflation that mattered, so this is recorded rather than filed.

## 3. Soundness and completeness re-check

- No bound in §6 claims more than its record: T-79 UNRESOLVED with the probe's own semantics as the bound; the closure class cause-blind but loud with both directions (`20a green / 20c red`); the failure-mode count on its shapes with per-shape provenance; the transients "unresolved, named, 2b-shaped" with the lost-capture bound stated; the declared reds enumerated; the non-blocking observations carried with their authors; the T-19 pin with its hash-proved additive lane.
- Counts carry predicates: eight redispatch events (row T-79's six + seventh + eighth), 16 by-design FAIL lines (`expectedFailLines = 16` + the self-test log), 32 §8.6 rows (both reconcile logs), 36 live rows (all `T-01…T-60`), 25 absorbed files (`pre-pack-state.txt`), ten green runs (the `ADDENDUM` + `acceptanceResults`), `920/0/6526` (the post-`t37` capture), `1181/1181/0/0` (the post-pack closure log).
- Completeness (plan §A15 / the contract): T-79 residual + probe + 2b test ✓ · closure trade ✓ · the four late writers + the one-re-pack ordering ✓ (with the four-vs-five distinction) · the 12-file corpus union ✓ · the two-run reconciliation ✓ · the seats' declared bounds (t13 via T-91, t14, t30's four quoted with their readings, t32's eight gaps) ✓ · the re-pin authority rule ✓ · §A-48's shipping bound ✓.

## 4. Bounds of this review

- No command was run (read-only seat, no shell); the report's identity is stated by its revision boundary (§9) and structure, not by a digest. The round-3 edits were verified by reading the changed passages and by independent greps for the removed forms (each 0 occurrences).
- The unchanged paragraphs were matched to the records cited in the t34 and t39 reviews rather than re-sourced one by one; the two transient RED captures remain un-opened (recorded as lost to a `tail`, and the report now states that bound).

## 5. Independence

I authored none of the text judged, none of the register rows or captain-log sections it cites, and none of the lane records reconciled; my earlier acts in this wave were t7 (the plan), t34 and t39 (this report's previous revisions).
