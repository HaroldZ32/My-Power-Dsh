# NESTED CORRECTION — the recorded line count (t31 / B2-F1)

`result.json` in this directory is SEALED and is not rewritten. This note sits BESIDE it.

## What was wrong

`revisions.durable_checker.lines` recorded **1143** while the same object pins the revision by
`after` = `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28`. That revision measures
**1146**. No counting predicate of that file yields 1143, so the field was a stale reading of an
EARLIER revision kept beside the hash of a later one — the exact class this lane exists to police
(a derived value that rots; T-55/T-92).

## The re-taken count, with predicate, unit and moment

| field | value |
|---|---|
| unit | `scripts/check-citations.mjs` — the file the sealed record pins by `after` sha256 (and whose bytes this lane also retained at `citation-run/revisions/checker.mjs`) |
| pinned revision | sha256 `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` |
| count (**wc -l**, the predicate named in the review's requiredFix) | **1146** |
| predicate 2 — `readFileSync(...).split("\n").length` | 1147 (the file is newline-terminated, so the split yields one empty trailing piece) |
| predicate 3 — non-empty lines | 1095 |
| re-taken at | 2026-09-17T14:47Z (the t31 evidence run dir `evidence/gates/wave2b-laneB2/20260917T144602Z/`) |
| re-take command | `wc -l scripts/check-citations.mjs` (output reproduced in `line-count-retake.txt` in the t31 run dir) |
| agreement | the retained copy in this directory measures the SAME `wc -l` 1146 at the SAME sha — so the count, the hash and the retained bytes now agree |

**Two revisions, two counts — stated so neither reads as the other** (this is the precise confusion the
finding was made of):

| revision | sha256 | `wc -l` |
|---|---|---|
| the revision THIS sealed record pins (its bytes retained at `citation-run/revisions/checker.mjs`) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` | **1146** |
| the CURRENT revision after the t31 repair (with its own record in `…/20260917T144602Z/`) | `53ae5cbc387c95566fadaf6697cff6b31f9e759f6cdefb9e519d99f33bc8b41f` | **1230** |

The RULE this leaves behind, applied in t31's own record: a line count is a DERIVED value and must be
recorded with its predicate and unit, or not at all. The t31 record states the predicate explicitly.
