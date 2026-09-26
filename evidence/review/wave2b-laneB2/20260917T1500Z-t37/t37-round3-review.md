# t37 — round-3 review of lane B2 (the `t36` repair): the unit fix is closed; the class sweep has one falsified verdict

**Seat:** citation-reviewer (attempt 1, `attempt_id` `4be45f1e-adef-46b6-88f8-c6042e1205ba`).
**Reviewed:** `t36` (`citation-checker-engineer`) — the repair of `t32`'s finding plus the captain-added class sweep.
**Protocol this pass follows:** the same pre-registered shape published before `t31` landed
(`evidence/review/wave2b-laneB2/20260917T1455Z-t32-prep/t32-round2-retake-protocol.md`, `5fb205a4…`).

## VERDICT: `needs_revision` — BOTH t36 items are landed and item 1 is closed by my own reading; item 2's sweep is real work that MISSES one labelled-consistent field, which my seeded fixture falsifies

## Revisions pinned

| Artefact | sha256 | Measured |
|---|---|---|
| `scripts/check-citations.mjs` — THE ROUND-3 REVISION | `bc49d6c716652038d5418d9795b1b9d6bc96733d83955b96089e430e070a755b` (1257 lines, mtime 14:57:48Z) | 15:00:11Z … 15:01:30Z, unchanged across the pass |
| my round-2 revision (the `before` of this repair's lineage) | `53ae5cbc387c95566fadaf6697cff6b31f9e759f6cdefb9e519d99f33bc8b41f` (1230 lines) | pinned in `t32`'s review |
| round-1 revision (the lane's retained bytes) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` (1146 lines) | retained on disk |
| sealed lane records | `2a80a50f35a801165c601be7f190fdbd1a0716a3f98e6919a59c4570a7505026` | byte-identical, never rewritten |

## §1 — t36 item 1 (the unit fix): CLOSED, confirmed against my OWN parser

- The field now reads **`2 reference LINE(s) carry 5 A<n> token(s) (A1, A2, A3, A4, A6)`** and carries a `unit:`
  string beside the number ("reference LINES (not driver files): the sum, over the scanned rows, of their
  `reference_lines` entries that carry an `A<n>` token").
- **My independent parser — written in round 2, unchanged since — measures exactly `2` reference lines carrying
  tokens and the token set `{1,2,3,4,6}`** on the same corpus: the `…t35 acceptance A1-A4/A6` line and the
  `A6 the write-back switch (… the design's key …)` line, both in
  `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`; `tui-team-surface.mjs` carries none. The corrected number
  is the number I derived before the fix existed.
- `THIRD-DIRECTION-UNIT-CORRECTION.md` (sha256 `78b63faf…`) sits BESIDE the sealed record and states the wrong
  predicate, the re-taken count, its unit, its moment and the corpus moment. The sealed `result.json` is untouched.
- **B2R2-F1 is therefore CLOSED**, and it is closed in the strongest available form: the reading reproduces.

## §2 — t36 item 2 (the class sweep): PERFORMED and carried in the record — with one verdict my fixture falsifies

The sweep is genuine work, not prose: `FIELD-UNITS-SWEEP.md` (sha256 `345598d9…`) enumerates 17 rows with field,
printed value, label-implied unit, the unit actually counted and a verdict; the record carries a new `audit.units`
registry (12 entries) plus `audit.moment`; and the boundary is named explicitly (fields outside the audit block,
lists rather than counts, the citation run's counters). My verification of the counts I could re-derive agrees:
`files_scanned` 54 = my own walk (46 + 8); `keys` 9 / 5 and `claims` 9 / 5 match the two drivers' key sets and claim
blocks; `violations` 0; the four `matcher_error_directions` numbers match my round-2 re-derivations; `third_direction`
now matches my parser.

**But one row marked `consistent` does not survive a seeded counterexample:**

### B2R3-F1 — `low`: `per_directory_split[].keys` / `[].claims` say "distinct … in that directory" while the number is a SUM OVER FILES
**file:** `scripts/check-citations.mjs` (`driverHeadersMain`'s bucket loop) + the `audit.units` registry
**problem:** the registry labels are `"distinct A<n> keys produced in that directory (unit: KEYS)"` and
`"distinct A<n> keys CLAIMED by that directory's headers (unit: KEYS)"`, but the computation is
`bucket.keys += row.keys.length` / `bucket.claims += row.claims.length` — the sum, over the directory's files, of each
file's OWN distinct count. A key id produced (or claimed) by two files in one directory therefore counts twice, and
the word "distinct" is not enforced at directory scope. **Measured counterexample:** a seeded directory holding two
drivers that each produce A1–A2 prints `keys = 4`, `claims = 4`, while the distinct ids in that directory are **2**
(`raw/S1-dupkeys.stdout.txt` + `S1-dupkeys/result.json`; the same run prints `key_producers = 2`, correctly).
On the current corpus the two predicates coincide (each directory holds one key-producing driver), so the sweep's
`consistent` verdict is true for the observed corpus and false as a general label claim — which is exactly what a
class sweep exists to separate. The `violations` field in the same bucket is NOT affected (two files mismatching the
same key id are two defects).
**requiredFix:** either dedupe at directory scope (the union of the directory's rows' key/claim ids, so the label is
true), or relabel both registry entries to state the summing predicate ("keys produced, summed over the directory's
driver files — a key id produced by two files counts twice"). One expression, or one sentence; the numbers need no
change.
**evidence:** `raw/S1-dupkeys.stdout.txt`, `S1-dupkeys/result.json`, `raw/R7-record-readings.txt`.

## §3 — The six t31 findings, dispositioned (re-verified on this revision)

B2-F1 CLOSED (nested correction beside the sealed record; my re-take of the retained round-1 copy gives `wc -l` 1146) ·
B2-F2 CLOSED (no user-facing naive mode; `mode` hardcoded) · B2-F3 CLOSED (OUT-OF-FAMILY clause in the usage block and
in the policy bytes of all three modes; my fixtures: control 9/9 with 1 citation checked, POSITION 9/9 with 0 checked,
basename-only 9/9 with 0 checked, line-number-only exit 1) · B2-F4 **fully CLOSED** (declared third direction, token
set verified by my parser, AND the unit corrected in t36) · B2-F5 CLOSED (self-output excluded, SELF-REFERENCE hits
named, two runs of the recorded form give the IDENTICAL summary `0 anchor match(es) … 4 self-reference match(es)` — I
re-ran that this pass) · B2-F6 CLOSED (both default-root runs named).

## §4 — Reproduced on the round-3 revision

`13/13` (249 citations, 19 symbol-first, 30 line-dependent, 0 rot, 0 pending, 12 illustrative) · `--self-test 25/25` ·
T-80 fixture arms `3/3` · live scan `54 files / 2 key producers / 2 claim sets / 0 NO-CLAIM-SET / 0 violations` ·
retained revisions `bc49d6c7…` + `dfe26090…` · a second run at the same `--out` → **exit 3** · the clause present in the
BYTES of all three record types.

## §5 — Seeded rot on this revision (all red under my hand)

T-78 arm FAILS alone when the record's `rules` block is stripped from a copy (stripped record: no `rules` key, rule
string 0 times) · T-82 arm FAILS alone with `retainRevision` a no-op · claimed-but-unasserted reddens on a clean seed
(`CLAIMED-BUT-UNASSERTED A11` + PATH) and is swallowed when the line carries `t32` — the declared line-wide exemption,
reproduced again · asserted-but-unclaimed reddens (A4, A5) · mailbox-id anchor scan reddens with a green absent-pattern
control.

## §6 — Weakening check

The diff against the round-1 retained bytes deletes **the same 9 lines as round 2**, all mapped to B2-F2/B2-F4/B2-F5 or
a comment reflow; the round-3 delta (`53ae5cbc…` → `bc49d6c7…`) is ADDITIONS ONLY (the `unit:` string, the
`referenceLinesWithTokens` computation, the `audit.units` registry, `audit.moment`, usage prose). No assertion removed
or loosened; the arm set is unchanged at 25 and every round-1 arm id is still green.

## §7 — Bounds (what I did NOT verify)

- the immutability ARM itself (only its exit-3 behaviour);
- the citation-run counters and the anchor-scan match fields, which the sweep explicitly puts OUTSIDE its scope — I
  checked the field names name their subjects, but did not re-derive each counter;
- no repo-wide aggregate and no `--gates` was run; lane A's T-92 numbers remain unverified and non-inheritable;
- the sweep's rows 8/13–16 verdicts rest on my round-2 re-derivations plus this pass's read of the record; I re-derived
  the four matcher directions and the token set, not every per-directory number on a synthetic corpus other than the
  one counterexample above.

## §8 — The one thing to change first, and what must NOT be built

**First:** the one-expression (or one-sentence) fix for `per_directory_split[].keys`/`[].claims` in the `audit.units`
registry — dedupe at directory scope, or state the summing predicate — plus a nested note beside the t36 sweep
recording the counterexample (`two files → keys 4, distinct 2`) so the corrected reading is re-takeable.

**Must NOT have:** no new arms, no re-anchoring of the 249 citations, no rewrite of any sealed record, no `skills/**`
edits, no repo-wide aggregate runs, and no widening of lane B2's three rows.
