# t6 — review round 3: the wave-2b plan after repair t5 (NOTE N1 + the staged A2)

**Reviewed object:** the plan artifact `evidence/planning/friction-p2-wave-2b-plan/20260917T0945Z-wave-2b-plan.md`, now 494 lines (358-line body + AMENDMENT A1 = the repairs + NOTE N1), read at this revision; plus the staged landing file `…-A2-to-land.md` (80 lines, A2.1–A2.8) and the plan-of-record `.mpd/plans/friction-p2-wave-2b.md` (still 407 lines, correctly unchanged). **Seat:** Plan Reviewer, read-only, no shell command run.

**Verdict: PASS — with one CARRY-FORWARD ACTION that is the captain's own next step, not a plan defect: land the staged A2 (`cat …-A2-to-land.md >> .mpd/plans/friction-p2-wave-2b.md`) and record the two file digests, as A2.8 specifies. The plan is executable now: NOTE N1 declares the artifact the operative text until the landing.**

## 1. R2-F-1's three consequences — each addressed

1. **The plan-of-record lacked the repairs.** The repair seat is mechanically forbidden the write (`t5`'s evidence quotes the platform verbatim: "a READ-ONLY seat … may write artifacts only under evidence/** … got \".mpd/plans/friction-p2-wave-2b.md\""). The exact bytes are therefore STAGED at `…-A2-to-land.md`, with a leading separator so a plain append lands them unchanged, and NOTE N1 states which file is operative until then: "Until the captain appends … the PLAN OF RECORD still lacks the two repairs and a reader must use THIS file (artifact `A1` = the repairs) as the operative text." **Addressed.**
2. **F1 asserted an equality that cannot hold.** F1 is superseded in substance in both places — A2.8 ("F1 now reads: the plan-of-record's **BODY** sha256 is `0dd3d2fd4744802d37031477…` and every amendment preserves it; the file digests are taken with `sha256sum` by the writer of record at the moment of landing and quoted BESIDE the amendment") and NOTE N1's matching paragraph. The body does stay byte-identical (both the 358-line body and the artifact's body section read as before). **Addressed.**
3. **Two texts shared one label.** The label map is now explicit: the plan-of-record's `A1` = the errata (E1b), the repairs land as `A2`, and "Artifact `A1` ≡ plan-of-record `A2`" (NOTE N1; A2's own header repeats it). **Addressed.**

## 2. The round-2 notes — all three accepted and folded in

- The `expected: "reported"` label does not exempt a verify at the platform → A2.1 (and the artifact's N1.1): **r-D keeps the lock-asserting lane OUT of its `--only` set**; the red is evidence-only.
- "No glob anywhere in this DAG" → A2.2/N1.2: corrected to **"no glob in B's set"**, with directory scopes allowed elsewhere only where the lane is that unit's ONLY writer (A's `self-fix-tests/**`, C's `evidence/team-watchdog/**`, B3's `templates/**`+`docs/**`) — none collide.
- T-89's contract half "owned by no lane" → A2.3/N1.3: **the requirements seats (r-A…r-D), checked by the captain at DAG creation**, alongside D's corpus half and B's runner half.

## 3. The round-1 blockers — still closed in the landed text

A2.1 ≡ A1.1 (D's verify = `--check-drift` + `--only <r-D's lanes>` + the modified drivers' own `--self-test`; `test:qa`/`test:qa:all` removed from every lane list); A2.2/A2.3 ≡ A1.2/A1.3 (B's set file-exact with `scripts/verify-docs-parity.mjs` B3's only; A's set file-exact; C narrowed to `evidence/team-watchdog/**`). A2.6 restates the two dangerous orderings as dependencies (impl-D ← impl-B; integration ← every review, so rev-B3 precedes the pack). A2.5's NEW-artifact list is consistent. A2.7 confirms nothing else moves — no reference, id, arithmetic or verify-list consequence re-opens (reconciled in rounds 1–2 and untouched here).

## 4. Notes (recorded, not filings)

- **A one-line staleness inside the artifact:** A1.4 still ends "the two errata files … are SUPERSEDED by this amendment; the captain needs no separate append" — untrue now (the captain HAD appended E1b as the plan-of-record's `A1`). NOTE N1's label map supersedes it in substance, but a reader meets A1.4 first; an inline pointer ("superseded by NOTE N1") would close it.
- **The staged A2 is a strict superset of the artifact's A1** (it folds N1's three corrections in place instead of leaving them in a separate note), so after landing the plan-of-record is the cleaner, self-contained text — "equals this artifact in substance" is accurate.
- No new path, id, dependency or verify-list item is introduced by N1/A2; the register arithmetic and §4.3's no-dependency claim stand as verified in rounds 1–2.

## 5. Bounds of this review

No command was run: the staged bytes were read end to end, the label map checked against both files' headers and tails, the refusal re-read from `t5`'s evidence, and the round-1/round-2 verifications (references, ids, arithmetic, DAG, write sets, verify scoping) carried forward unchanged because A2.7 and N1 touch none of them. The landing and the two digests cannot be verified from this seat until the captain performs them — that is why it is stated as the pass's carry-forward action rather than as a finding.
