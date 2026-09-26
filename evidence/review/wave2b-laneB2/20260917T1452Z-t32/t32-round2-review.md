# t32 — round-2 review of lane B2 (the `t31` repair): findings, dispositions and bounds

**Seat:** citation-reviewer (attempt 2, `attempt_id` `65308246-89f8-4ab0-86c1-866a8e1686ce`).
**Reviewed:** `t31` (`citation-checker-engineer`) — the repair of the six round-1 findings on wave-2b lane B2 (T-78 / T-80 / T-82).
**Pre-registered protocol this pass follows:** `evidence/review/wave2b-laneB2/20260917T1455Z-t32-prep/t32-round2-retake-protocol.md`
(sha256 `5fb205a489cc38b9fee51e3f2e3fc1f666c2cef23faa15a6fa6622f6c8dbafa5`) — published before the repair landed so every fix
could be self-checked, and so a fix that cannot be re-taken is visible before it is called closed.

## VERDICT: `needs_revision` — FIVE of the six fixes are closed by my own readings; ONE new derived-value defect remains

The repair is substantive and honest: each of the six findings was fixed by the branch the acceptance named, none by
weakening an arm, and the two nested corrections sit BESIDE the sealed record rather than rewriting it. **B2-F4's fix
introduces one new count whose unit does not match its predicate** (B2R2-F1: the audit prints `1 reference line(s)`
where `1` counts driver FILES and the checker's own record lists **2** reference lines carrying tokens). That is the
same class as B2-F1 — a published number a reader cannot reproduce — and it is one line to fix.

## Revisions pinned (file + sha256 + moment)

| Artefact | sha256 | Measured |
|---|---|---|
| `scripts/check-citations.mjs` — THE REPAIRED REVISION | `53ae5cbc387c95566fadaf6697cff6b31f9e759f6cdefb9e519d99f33bc8b41f` (1230 lines, mtime 14:47:04Z) | 14:50:15Z … 14:53Z, unchanged across the pass |
| round-1 revision (the lane's retained bytes) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` (1146 lines) | via `evidence/gates/wave2b-laneB2/20260917T142452Z/citation-run/revisions/checker.mjs` |
| frozen superseded revision | `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c` | re-measured in my own run dir |
| sealed lane record (must NOT move) | `2a80a50f35a801165c601be7f190fdbd1a0716a3f98e6919a59c4570a7505026` | byte-identical before and after the repair |

## §1 — The six findings, each dispositioned with its own reading

**B2-F1 — CLOSED.** `evidence/gates/wave2b-laneB2/20260917T142452Z/LINES-COUNT-CORRECTION.md` is a NESTED correction
(the sealed `result.json` is byte-identical at `2a80a50f…`, so nothing was rewritten). It states the re-taken count with
PREDICATE, UNIT and MOMENT (`wc -l` = 1146 at the pinned sha; split = 1147; non-empty = 1095; re-taken 14:47Z) and a
TWO-REVISION TABLE (pinned 1146 vs post-repair 1230) so neither count can be read as the other. My own re-take: the
retained round-1 copy measures `wc -l` 1146 at that same sha, and the correction's rule ("a line count is a DERIVED value
and must carry its predicate") is the right lesson.

**B2-F2 — CLOSED (acceptance's second branch).** `grep -n naive scripts/check-citations.mjs` now finds the identifier
only in the internal alternative matcher (`parseHeaderClaims(text, { naive })`, used by the audit's over-report
measurement) and in the note at the old flag's site; the usage block advertises `--driver-headers [--self-test]` only,
and the record's `mode` is hardcoded `"driver-headers"`. My probe `--driver-headers --naive` produced a record whose
`mode` is `"driver-headers"` — no record can claim the naive matcher produced its rows. **Observation, not a finding:**
the flag is now silently accepted-and-ignored rather than rejected; that is within the branch the acceptance allowed,
and no record lies about it.

**B2-F3 — CLOSED.** The clause is in the usage/RULE block (`THE CITATION FAMILY'S BOUNDARY`, naming a POSITION citation
and a BASENAME-ONLY citation as OUT OF FAMILY and pass-silently BY DESIGN), and in every run record's policy BYTES —
verified for all three modes: citation run `rules.family_boundary.out_of_family`, driver-header `policy.out_of_family`,
anchor-scan `policy.out_of_family` (my `D-clause-in-records.txt`). Truth test with my own fixtures on the repaired
revision: control `` `alphaSymbol`, `src/probe.ts:2` `` → 9/9 with **1 citation checked**; POSITION citation → 9/9 with
**0 citations checked**; basename-only → 9/9 with **0 citations checked**; line-number-only → **exit 1, 4 failed**, 2 rot
anchors. The clause and the behaviour agree — silence is now named rather than green.

**B2-F4 — DECLARED AND MEASURED (mechanism closed) — with the new unit defect below.** `parseHeaderClaims` now collects
the tokens on REFERENCE lines and the audit reports `third_direction{name: "the line-wide REFERENCE exemption",
measured: …}`. My independent parser (my own regexes over the two key-producing drivers' header blocks) agrees on the
TOKEN SET {A1,A2,A3,A4,A6} = 5 unique tokens. The declared third direction is real: my own seeded pair reproduces it —
`// CHECKS A11 … (t32 seed …)` is swallowed (exit 0) because the line carries `t32`, while the same seed with a
reference-free line reddens (exit 1, `CLAIMED-BUT-UNASSERTED A11` + PATH + phrase). The acceptance's either/or branch is
therefore satisfied: declared, not silent.

**B2-F5 — CLOSED, and it is the strongest part of the repair.** The usage block states the re-takeability rule, the scan
excludes its own output root, and hits inside an anchor-scan record (or a capture quoting the scan's command) are
classified `SELF-REFERENCE` and NAMED, never counted. My two runs of the RECORDED form (`--out` written INSIDE the
scanned root) return the IDENTICAL summary: `0 anchor match(es) in 18 file(s) … 4 self-reference match(es) classified
and named (not anchors)`; a third run with `--out` outside also exits 0. The reading that was un-re-takeable in round 1
is now re-takeable, with the self-reference named.

**B2-F6 — CLOSED.** `DEFAULT-ROOT-EXCEPTIONS.md` (nested, beside the sealed record) names BOTH runs
(`run-2026-09-17T14-24-29.334Z` self-test 21/21; `run-2026-09-17T14-25-20.731Z` the verbatim verify), states the rule as
it should have been ("every run the lane EXECUTES without `--out` … is named here"), and records that a superseded
reading is never deleted. My enumeration of `evidence/extensions/docs-claims/runs/` matches the note.

## §2 — NEW FINDING (this round)

### B2R2-F1 — `low`: the third direction's count carries the wrong unit
**file:** `scripts/check-citations.mjs` (`driverHeadersMain`, `audit.third_direction.measured`)
**problem:** the published string is `"1 reference line(s) carry 5 A<n> token(s) (A1, A2, A3, A4, A6)"`. The `1` comes
from `rows.filter((row) => row.reference_tokens.length > 0).length` — that counts driver FILES with reference tokens,
not reference lines. The checker's OWN record for that driver lists **6** reference lines
(`drivers[].reference_lines`), of which **2** carry `A<n>` tokens (the `<workspace>/.mpd/mpd.jsonc (t34 design …; t35
acceptance A1-A4/A6)` line and the `A6 the write-back switch (… the design's key …)` line). So the number does not
reproduce under its own label, in the very field the B2-F4 fix added — the predicate/unit mismatch class the wave
polices ("every count carries its predicate and unit"), one generation after B2-F1.
**requiredFix:** count lines rather than files (sum, over `rows`, of the reference lines carrying an `A<n>` token — the
record already carries `reference_lines` per row, so no new state is needed), or relabel the unit to `driver file(s)`
and keep the number. Either is a one-line change; the token set and its size (5, deduped) are correct as printed.
**evidence:** `raw/R7-record-readings.txt` (the record), `raw/A-third-direction-mine.txt` (my independent parser),
`evidence/review/wave2b-laneB2/20260917T1452Z-t32/R4-t80-live/result.json` (the `reference_lines` list).

## §3 — The round-1 criteria re-run on the repaired revision (re-taken, never inherited)

| Criterion reading | Result |
|---|---|
| scoped citation run | **13/13**, 249 citations, 19 symbol-first, 30 line-dependent, 0 rot, 0 pending, 12 illustrative |
| `--self-test` | **25/25**, 0 failed (arm set unchanged; all round-1 negative-control ids still present and green) |
| T-80 fixture arms | **3/3** |
| live driver scan | **54 files / 2 key producers / 2 claim sets / 0 NO-CLAIM-SET / 0 violations** — the corpus is lane D's current state |
| audit discipline (this lane's OWN corpus) | directories NAMED (`./skills/dsh-qa/scripts/`, recursive); per-directory split with this lane's counts (46 + 8 files; key producers 1 + 1; keys 9 + 5; claims 9 + 5; violations 0 + 0); subject-scoped subset separated (54 scanned vs the 2 key-producing subjects; violations attributed only to those rows); BOTH matcher-error directions declared with own measurements (over-report 1 file/1 key vs 0; under-report 1 vs 2 non-recursive; 0 vs 2 under a `.js` assumption; 25 vs 2 repo-wide under the checker's own walk predicate). Lane A's `42 = 25 + 17` is explicitly NOT inherited |
| retention | my run dir retains `checker.mjs` = `53ae5cbc…` and `superseded.mjs` = `dfe26090…` (hash-verified) |
| T-82 pair on the repaired revision | changed pair **424 B** non-empty and names the changed line; unchanged pair **0 B EMPTY**; both retained files exist |
| immutability | a second run at the same `--out` → **exit 3** with the refusal message |
| hazards | line-number-only **CAUGHT** (exit 1); mailbox id **CAUGHT** (seeded exit 1, absent-pattern control exit 0); POSITION and basename-only **OUT OF FAMILY and now NAMED** (0 citations checked, clause present) |

## §4 — Seeded rot on the repaired arms (all red under my hand)

- strip the record's `rules` block from a COPY → the stripped record has **no `rules` key** and the
  `t78-record-carries-the-rule` arm is the **only** negative-control FAILURE (1198 B removed);
- make `retainRevision` a no-op in a COPY → `t82-retention-diffable` **FAILS** alone, `t78` still ok;
- T-80 claimed-but-unasserted (reference-free seed) → **exit 1** naming A11 + PATH; asserted-but-unclaimed → **exit 1**
  naming A4, A5;
- mailbox-id anchor scan → **exit 1**; absent pattern → **exit 0**.

## §5 — Weakening check (the buy-the-green direction)

`diff` of the round-1 retained bytes against the repaired revision deletes exactly **9 lines**, all accounted for:
2 destructuring/return widenings that add `referenceTokens` (B2-F4), 2 removals of the `--naive` flag and its `mode`
ternary (B2-F2), 4 replacements in the anchor scan's walk/report/summary (B2-F5), 1 comment reflow in the usage block.
**No assertion was removed or loosened**; the arm count is unchanged at 25 and every round-1 arm id is still green.

## §6 — Observations and bounds (what I did NOT verify)

- **`--naive` is silently ignored rather than rejected** (observation, not a finding — see B2-F2).
- **The immutability ARM (as opposed to the behaviour) is still not falsified** — I reproduced the exit-3 refusal but
  did not disable the guard in a copy.
- No repo-wide aggregate and no `--gates` was run (lane-scoped only). Lane A's T-92 numbers stay unverified and
  non-inheritable.
- One of my own intermediate checks was **INCONCLUSIVE and is labelled as such**: the first T-82 quick check
  (`raw/R8-*`) ran a checker copy whose repo root lacked the frozen revision, so the retention threw ENOENT before any
  record was written; the valid re-take is `raw/R9-*` (fixture root present). Same class as the round-1 inconclusive
  arm — my instrument, not the lane's.
- The corpus (`skills/dsh-qa/scripts/**`) remains lane D's; I touched none of it. My writes are confined to
  `evidence/review/wave2b-laneB2/**`.

## §7 — The one thing to change first, and what must NOT be built

**First:** the one-line unit fix in `audit.third_direction.measured` (B2R2-F1) — count reference LINES or relabel to
driver FILES — plus a nested note in the t31 evidence dir recording the re-taken number with its predicate, so the
corrected reading is re-takeable the way B2-F5's now is.

**Must NOT have:** no new arms, no re-anchoring of the 249 recorded citations, no rewrite of either sealed record
(`evidence/gates/wave2b-laneB2/20260917T142452Z/result.json` stays at `2a80a50f…`), no `skills/**` edits, no repo-wide
aggregate runs, and no widening of lane B2's three rows.
