# t42 — round-4 review of lane B2 (the `t41` repair): the fix and the class requirement hold; the SEED's documented counterfactual does not

**Seat:** citation-reviewer (attempt 1, `attempt_id` `ccc172e6-b10d-41d6-b876-cbbb488e619b`).
**Reviewed:** `t41` — the captain-routed round-4 repair of `B2R3-F1` plus the class requirement.
**Protocol:** the pre-registered instrument published before `t31` landed
(`evidence/review/wave2b-laneB2/20260917T1455Z-t32-prep/t32-round2-retake-protocol.md`, `5fb205a4…`), plus my own pre-fix
parser (round 2) whose reading the corrected field must equal.

## VERDICT: `needs_revision` — the FIX is verified by my own seed and by falsification, the CLASS requirement is met, and the seed's PUBLISHED COUNTERFACTUAL is off by one on two fields

`B2R3-F1` is closed: my two-file seed now prints the DISTINCT count its label claims, and the registry states the
computing predicate inline. The class requirement is met as a class — every general-claim field carries either an inline
predicate or a seeded counterexample, the seeded fields are named apart from the merely-read ones, and I PROVED the
sweep can fail by restoring the pre-fix summing computation in a copy. **The defect is B2R4-F1:** the number published
as "what the summing computation printed" is `6 / 8 / 2` in four surfaces; my restored-summing run of the arm's OWN
fixture measures **`6 / 9 / 3`**.

## Revisions pinned

| Artefact | sha256 | Measured |
|---|---|---|
| `scripts/check-citations.mjs` — ROUND-4 REVISION | `453d3d7f499fc5660a9dc733584c59033326d5e3ce69e72439ce0da4f217f354` (1307 lines, mtime 15:09:10Z) | 15:12:40Z … 15:14Z, unchanged across the pass |
| sealed t15/t31 record | `2a80a50f35a801165c601be7f190fdbd1a0716a3f98e6919a59c4570a7505026` | byte-identical; nested corrections only |
| round-1 retained bytes (weakening baseline) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` | on disk in the lane's run dir |
| nested correction (this round) | `PER-DIRECTORY-UNIT-CORRECTION.md` in `evidence/gates/wave2b-laneB2/20260917T145530Z/` | read; carries the two seeded shapes |

## §1 — Acceptance item 1: B2R3-F1's fix, verified by MY OWN instrument and by the seed that produced it

- **My two-file seed** (the shape that produced the finding in round 3 — both files producing and claiming `A1`–`A2`):
  round 3 printed `keys=4 / claims=4`; **now prints `keys=2 / claims=2`** with `key_producers=2`
  (`S1-my-two-file-seed/result.json`, `raw/S1-two-file.stdout.txt`). The distinct-id claim now holds.
- **The arm's own three-file fixture, run by me against the real checker**: `keys=2 / claims=3 / violations=1 /
  key_producers=3`, exit 1, per-file rows `keys=[1,2] claims=[1,2,3] mismatches=[3]` ×3
  (`F3-exact-fixture-real/result.json`, `raw/F3-real.stdout.txt`).
- **The registry states the predicate inline** for all three directory-scope fields ("deduped at DIRECTORY scope (the
  UNION of the directory's files' key ids), never the sum of per-file counts") and the seed is named in the entry.
- **The scope `violations` union claim, seeded by me**: two files in one directory both claiming `A3` while asserting
  only `A1`–`A2` → directory `violations=1` AND scope `violations=1`; a sum would print 2
  (`F2-scope-violations-seed/result.json`). The registry's "deduped at SCOPE (the union over the scanned rows), never a
  sum of per-row counts" reproduces.

## §2 — Acceptance item 2: the CLASS requirement, checked as a class

- **Enumeration of `audit.units` (12 entries) against the general-claim words** (`distinct`, `summed`, `per-directory`,
  `deduped`): `per_directory_split[].keys`, `[].claims`, `[].violations`, the scope `violations`, and
  `third_direction.measured` carry general claims — **each states its computing predicate inline**, and the three
  directory-scope ones also carry the seeded arm. The remaining entries (`files_scanned`, `[].files`,
  `[].key_producers`, `[].no_claim_set`, `claim_set_parsed`, `no_claim_set`,
  `matcher_error_directions[].measured`) state their predicate and unit and make no general claim.
- **Seeded vs read are named separately** in the record's `audit.units_sweep`: `seeded_this_round` (3 fields) and
  `read_and_named_consistent` (8 fields), with a `falsifiable_now` note that the read-only list is an assertion, named
  as such. Present in MY OWN run's record, not only in prose.
- **The sweep is SHOWN able to fail — by my own falsify-and-restore.** I patched a COPY back to the pre-fix summing
  computation (Sets → arrays, `.add`/`.size` → `.push`/`.length`): the `t80-directory-scope-dedup` arm **FAILS**
  (`keys=6 claims=9 violations=3`, expected `2 / 3 / 1 / 3`) and the copy's self-test drops to 3/4 with exit 1
  (`raw/F1-summed-arms.stdout.txt`). So the seeded verdict is not unfalsifiable decoration.
- **FAILED on one point — the documented counterfactual is wrong (B2R4-F1 below).**

### B2R4-F1 — `low`: the seed's published "summing computation" numbers do not reproduce
**file:** `scripts/check-citations.mjs` (the arm's comment and its log line) + `evidence/gates/wave2b-laneB2/20260917T145530Z/PER-DIRECTORY-UNIT-CORRECTION.md` + the record's `audit.units_sweep.seeded_this_round`
**problem:** four surfaces publish the counterfactual as `keys = 6 / claims = 8 / violations = 2`, and the registry
additionally describes the seed as "**two** files claim A3 while asserting only A1–A2". The arm's fixture is **three**
files (`a.mjs`/`b.mjs`/`c.mjs`), each with the header `// This driver CHECKS A1–A3.` and `add("A1")`/`add("A2")`, i.e.
per file `keys=[1,2] claims=[1,2,3] mismatches=[3]`. **My restored-summing run of that exact fixture measures
`keys=6 / claims=9 / violations=3`** (raw/F4-summed.stdout.txt, F4-exact-fixture-summed/result.json) — matching 3 × 3
claims and 3 × 1 mismatch, not 8 and 2. The 9 and 3 are arithmetically forced by the fixture; the published pair is
not. (The deduped assertion itself, `2 / 3 / 1 / 3`, is correct and I reproduced it.) This is the same class the lane
polices — a published derived number that does not reproduce under its own predicate — and it survived because the
counterfactual is only ever asserted in prose.
**requiredFix:** re-take the counterfactual in all four surfaces (`6 / 9 / 3`) and correct "two files" to "three files";
or drop the counterfactual entirely, since the ASSERTED reading (2/3/1/3) and its falsification are what carry the
requirement. **Per this contract's ceiling clause, the captain MINTS this as a register row rather than opening a fifth
round** — this review is the last structured gate for the class.

## §3 — Acceptance item 3: no weakening

- `node scripts/check-citations.mjs` → **13/13** (249 citations, 19 symbol-first, 30 line-dependent, 0 rot, 0 pending,
  12 illustrative); `--self-test` → **25/25** (the citation arm set is unchanged at 25); `--driver-headers --self-test`
  → **4/4** (the 3 fixture arms + the new seeded arm — the arm set GREW, it was not narrowed); live scan
  `54 files / 2 key producers / 2 claim sets / 0 NO-CLAIM-SET / 0 violations`.
- **The round-2 nine-deletion set is unchanged**: the diff against the round-1 retained bytes deletes 16 lines, and all
  nine round-2 deletions are present in that set; the 7 new ones are the dedup fix itself (`bucket.keys += …`,
  `bucket.claims += …`, `bucket.violations += …`, the summing bucket literal, the per-row `violations` reduce, the
  `per_directory_split` emitter) plus the arm-count line — no assertion removed, none narrowed.
- **The corrected reading reproduces against MY OWN pre-fix parser**: 2 reference lines carrying the token set
  `{1, 2, 3, 4, 6}` on `skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs`, 0 on `tui-team-surface.mjs` — equal to the
  field's `2 reference LINE(s) carry 5 A<n> token(s) (A1, A2, A3, A4, A6)`.
- Sealed records unchanged (`2a80a50f…`); every correction this round is a nested note beside them.

## §4 — Bounds (what I did NOT verify)

- the immutability ARM itself (only the exit-3 behaviour);
- the `read_and_named_consistent` list's 8 fields: I verified their labels state a predicate and unit, and the three I
  could re-derive independently (`files_scanned` 54 = my own walk; the per-directory `keys`/`claims` via my seeds;
  `third_direction` via my parser) — the rest are read, not seeded, exactly as `units_sweep` states;
- no repo-wide aggregate and no `--gates`; lane A's T-92 numbers remain unverified and non-inheritable;
- the `7900 B` size item stays an OBSERVATION by captain decision (7900 / 3030 / 3907 / 8683 B) and is not a finding.

## §5 — The one thing to change first, and what must NOT be built

**First:** the counterfactual re-take in the four surfaces (B2R4-F1) — `6 / 9 / 3` and "three files" — or delete the
counterfactual. One sentence per surface; no code path changes.

**Must NOT have:** no fifth review/repair round (the ceiling is declared; the captain mints the row), no new arms, no
re-anchoring of the 249 citations, no rewrite of any sealed record, no `skills/**` edits, no repo-wide aggregate runs.
