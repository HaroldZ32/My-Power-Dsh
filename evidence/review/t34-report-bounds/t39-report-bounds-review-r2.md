# t39 — review round 2: the repaired wave-2a report (264-line revision)

**Reviewed object:** `evidence/wave2a-integration/20260917T085313Z-sweep-part1/REPORT.md`, read in full at its post-repair revision (264 lines; t34 judged the 181-line revision). **Seat:** Plan Reviewer, read-only, no shell command run. **Verdict:** needs_revision — three findings (R2-F-1…R2-F-3), each a one-line correction. Every t34 finding is closed; everything else reconciles.

**Boundary:** §9 states it in the artifact — t34's verdict judges the bytes it read; the changes are the requested fixes plus the items the captain had already dispositioned post-review (§A-48's shipping bound, lane C's post-pack confirmation). I verified that claim: the inline corrections sit in §1, §2's package-test row, §5.1, §5.5 and §6's closure bullet; §3, §4, §5.2–§5.4, §5.6–§5.7, §6 b1/b3/b5–b8, §7 and §8 are unchanged from the revision t34 reconciled and were re-read here.

## 1. t34's four findings — closure verified against records

| finding | what the repair now says | record I verified | verdict |
|---|---|---|---|
| F-1 (high) | §5 rule 5: eight **SHAPES**; catcher provenance measured on the SIX then-known instances ("five caught independently, the sixth by the author — but only after a peer's challenge"), citing §A-32; the two later shapes carry their own provenance (§A-42; §A-38(4)) | captain log §A-32 ("FIVE of six with an independent catcher, and the sixth AUTHOR-caught after a peer's challenge" … "The 6/6 form is WITHDRAWN; the 5+1 form … is the report's text"); §A-38(4) carries the population-from-counter instance; §A-42 carries the null-result/occurrence rule | **CLOSED** |
| F-2 (medium) | §1: "Eight register rows were added … six new ids minted … plus T-73 and T-74, registered from the wave-1 journal … Predicate: §8.6 grew 24 → 32 rows" | plan §A5/§A6/§A9/§A11/§A13/§A14 (the six new ids); `.mpd/TODO.md` §8.6 at 32; §A-6(1) (the wave-1 journal declares its own numbering authoritative — the new citation checks out) | **CLOSED** |
| F-3 (medium) | §5.5 cites the durable structure; the eighth instance has a home | captain log **§A-51** ("THE EIGHTH INSTANCE, with its predicate, citation and correction"; the complete EIGHT-shape tally; the SIX-instance catcher provenance; §A-38(4) as the instance's record) | **CLOSED** |
| F-4 (medium) | §9(a) the 25 absorbed writers grouped by owner + the packed-but-not-swept files; §9(b) t30's four bounds quoted with their grounding readings; §5.1/§6 owner records inline | `pre-pack-state.txt`'s 25 entries match §9's grouping exactly (lane A 5 · B2 1 · B3 5 · C 2 · D 12 = 25; `agent-references/index.md` is B3's — plan amendment: "D-5 adopted into `t19`"); `review-B/20260917T084000Z-t30/result.json` `bounds[]` = the four quoted entries; §5.1's lane D home is real (its `t11` README carries the bridge-cite correction `:421/:422`, `:651/:652` that the source map calls "the O2 fact") and row T-90 carries the class clause + calibration | **CLOSED** (with R2-F-2 and R2-F-3 on two of the pointers) |

## 2. New findings (this round)

**R2-F-1 (medium) — §6's transient bullet carries an unsupported run count.** The text reads: "against **sixteen-plus GREEN runs recorded** (4 sequential + 6 concurrent pre-`t37`, then 6 more full-capture runs — all `265/0/2207 expects` or `266/0/2219`, exit 0, zero failure lines)". The durable records say TEN: `evidence/agent-teams/t8-lane-a/20260917T071056Z/ADDENDUM-transient-red.md` ("UNREPRODUCED in ten controlled runs"; four sequential `v1/v2/v3/verify-1-full` + six concurrent `load-run/load1..6`), t8's own `acceptanceResults` ("Ten full-suite runs are green (four sequential + six concurrent after the two instrument repairs)"), and the captain log twice (§A-19-area "ten green runs since — six of them concurrent"; §A-32-area "ten subsequent green runs"). No record enumerates six further runs at `265/0/2207` or `266/0/2219` — each of those two revisions has ONE recorded run (`pause-surface/20260917T082935Z/result.json`; `seeded-negative-control/20260917T085849Z/result.json` + `verify.log`) — and the phrase "full-capture" appears nowhere but the report. Required fix: name the six runs' logs, or restore the count to the recorded ten ("ten controlled runs, six of them concurrent"). Shape: *a tally inverting its own instances* / an *11-vs-12 double-count* — the class rule 5 names.

**R2-F-2 (low) — §9's attribution of "the four late writers" does not match §A-25's own labels.** §9 reads "The four writers §A-25 counted as 'late' are lane D's corpus, lane B's gate scripts, lane B2's re-point and lane B3's README pair." §A-25 labels the **SECOND** late writer as lane B3's README pair (matches §9) and the **THIRD** as lane C's digest row in `agent-references/troubleshooting.md` — which §9's four omit. Required fix: cite the enumeration that names four, or restate to the labels §A-25 actually carries.

**R2-F-3 (low) — §6's closure bullet cites a section that does not carry the trade.** §9's pointer sentence and §6 b2 both point at "captain log §A-8/§A-29". §A-29 is correct (the trade's second half, the `--pack-stamp` rule). §A-8 ("the last cross-lane red cleared, and the §8.4 audit refuted part of its own register row") carries the docs-gate derived values and the T-48 premise audit — neither half of the timestamp-order trade. The trade's architecture is §A-25(1) ("`exit 0` and `0 drift` are TRUE BEFORE the re-pack too … the post-re-pack acceptance is **membership**") and §A-26(2) (the count corrected into a membership test). Required fix: replace §A-8 with §A-25(1)/§A-26(2).

## 3. Completeness re-check (plan §A15 / the contract's checklist)

1. T-79 residual + named probe + 2b test — CARRIED §6 b1, §7 (unchanged) ✓
2. closure gate's timestamp-order/integrity trade — CARRIED §6 b2 + owner record 08:01:19Z / gate comment ✓ (pointer: R2-F-3)
3. the four late writers + the one-re-pack ordering — CARRIED §9(a) + §3 ✓ (attribution: R2-F-2)
4. 12-file corpus union rule — CARRIED §3, unchanged ✓
5. two-run reconciliation — CARRIED §4, unchanged ✓
6. seats' declared bounds — t14/t32/t24-t73/t13 carried; **t30's four now quoted with their readings** ✓; §A-48's ship bound now in §9 ✓ (the item §A-48 had dispositioned as post-review)
7. re-pin authority rule — CARRIED §3 ✓

## 4. Bounds of this review

- No command run; the report's identity is stated by its revision boundary (§9) and its section structure, not by a digest — I cannot hash files from this seat. The line count moved 181 → 264 as t38 declared.
- I re-read all 264 lines; the paragraphs unchanged from the t34 revision were matched to the records cited in the t34 review rather than re-sourced one by one.
- I did not re-open the two transient RED captures (they are recorded as lost to a `tail`; §6 b4 now states that bound, and the ADDENDUM corroborates it for the first one).

## 5. Independence

I authored none of the text judged, none of the register rows or A-sections it cites, and none of the lane records reconciled; my earlier acts in this wave were t7 (the plan) and t34 (this report's previous revision).
