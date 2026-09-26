# check-citations.mjs — the growth declaration (lane C, t21 record; captain request 2026-09-17)

## THE DECLARATION (one line, as asked)

**The +4,815 B window (25,530 B `5e56c82c…` → 30,345 B `dfe26090…`) is the T-55 symbol-first
verification work — measured at +4,930/−83 = **+4,847 B net** across 9 diff hunks: the
`symbolOnlyClaimCheck`/`citedFileText` rule (+1,872 B), its call-site branch in the citation loop
(+687 B), the generalized negative-control fixture maker and the two new arms with their
`record()` calls (+1,687 B), the shared `reportedEvidence()` helper (+350 B) and the
`symbol_only_anchors_verified` report field (+225 B) — plus one `−32 B` rewrite of the fixture's
guide line; and it **CAN change a reading**: a LINE-LESS path citation that carries a claim whose
text does not appear verbatim in the cited file now FAILS (exit 1) where it used to pass silently,
which is the ONE new failure mode this change set declares.**

The earlier step (24,021 B `471aec42…` → 25,530 B `5e56c82c…`) is the **T-53 immutable-output
plumbing** — measured at +1,758/−249 = **+1,509 B net** — and changes no check rule.

## The measurement (reproduce with `node growth-accounting.mjs` in this directory)

`growth-accounting.mjs` diffs the RETAINED pre-wave copy
(`.mpd/red-baseline/evidence/extensions/docs-claims/check-citations.mjs`, `471aec42…`, 24,021 B —
byte-identical to git HEAD per the reviewer) against the current revision (`dfe26090…`, 30,345 B)
with `git diff --no-index --unified=0`, and attributes each hunk to T-53 or T-55 by the mechanism
its lines name.

| | hunks | lines +/− | bytes +/− | net |
|---|---|---|---|---|
| **T-53** (immutable output: `immutable-output.mjs` import, `--out` parse, `writeImmutable` for run result/log and gate raw, `exitOnRefusal`) | 5 | 22 / 4 | 1,758 / 249 | **+1,509 B** |
| **T-55** (symbol-first: rule + call site + arms + helper + report field) | 9 | 76 / 3 | 4,930 / 83 | **+4,847 B** |
| fixture guide-line rewrite (supports the generalized maker; attributed by hand) | 1 | 1 / 1 | 73 / 105 | **−32 B** |
| **total** | 15 | **99 / 8** | 6,761 / 437 | **+6,324 B** |

Two cross-checks make this exact rather than approximate:

1. **+99 / −8 lines** equals the reviewing seat's independent `--numstat` reading of the same pair.
2. **T-53's net = 1,509 B = exactly the measured 24,021 → 25,530 delta**, and
   **T-55's 4,847 B + the −32 B rewrite = exactly the 4,815 B window**. Every contested byte is
   attributed; there is no residual.

**Retained-revision note (T-82).** The intermediates (`5e56c82c…` 25,530 B, `e332da70…` 28,116 B)
are NOT on disk, so a per-revision byte split inside the window is not reconstructable from files.
It is not needed here: the hunk attribution above sums to both measured deltas exactly, so the
window's content is known even though its intermediate snapshots are gone.

## Declared risk (explicit, not silent)

`symbolOnlyClaimCheck` fires ONLY when the document's own claim annotation names a path citation
with **no line and no endLine** (`entry.path === citation.value && line === undefined &&
endLine === undefined`). For that one input class, two NEW failures exist:

- the claim's text is not verbatim in the cited file's whole text → FAIL
  (`the cited file does not contain the claim …`) — **this is the new failure mode**;
- the claim's text is neither a symbol nor a quoted phrase (or shorter than 2 characters) → FAIL
  (`neither a symbol nor a quoted phrase`).

Consequences a reader must know:

- a line-less citation whose symbol lives in a DIFFERENT file than the one cited now fails;
- a line-less citation to a missing path, a directory or an unreadable file resolves to an empty
  text and therefore fails the claim check (`citedFileText` returns `""`);
- a line-less PATH citation that carries NO claim is untouched (`null` → the caller leaves it
  alone), which is why the existing corpus did not suddenly require claims.

Inputs the reviewer's 12-arm run does not exercise: any line-less citation whose claim text is
absent from its cited file. The rule IS pinned falsifiably by two self-test arms
(`negative-control:symbol-first-present` / `…-absent`) and by the two fixture arms in the same
result, so the behaviour is pinned rather than assumed — but the newly-failing input class above is
the honest boundary of this change set, and it is a STRENGTHENING (a "gate that lies" removed), not
a relaxation. Nothing in T-53's plumbing can change a verdict: it only decides WHERE a run writes.

## The run this record rides on

`node evidence/extensions/docs-claims/check-citations.mjs --out <this dir> --gates`
→ **exit 0**, `15/15 checks passed, 0 failed, 249 citation(s) resolved, 0 pending, 12 illustrative`,
checker sha256 at that run **`dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c`**
(30,345 B), recorded in `checker-sha256.txt`, raw gate output under `raw/`. The three `--gates`
arms (`docs-parity`, `example-validates`, `cli-self-test`) are extra arms on top of the 12 citation
arms, which is why this run reads 15/15 where the plain run reads 12/12 at the same hash.
