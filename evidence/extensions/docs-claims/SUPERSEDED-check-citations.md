# SUPERSEDED — the citation checker moved out of the evidence tree (T-72)

**The `check-citations.mjs` in this directory is FROZEN at the revision below. It is never edited
again.** This page is the nested correction written *beside* it (never in place), by wave 2's lane
B2 task `t16`.

| | |
|---|---|
| frozen revision | `evidence/extensions/docs-claims/check-citations.mjs` — 30 345 bytes, sha256 `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c` |
| durable home | `scripts/check-citations.mjs` — sha256 `d64dfeb52d3b6c9d18acee5c7e9d8685c82b847e44a4f6f4ef94f21eb1f45c13` (660 lines) |
| how the durable copy was built | line-range splice from the frozen revision: `t72-symbol-first-20260917T072356Z/t72-patch.mjs` (19 asserted ranges; every line it does not name is copied byte-for-byte). The resulting unified diff is `t72-symbol-first-20260917T072356Z/checker.diff`. |
| evidence for the move | `t72-symbol-first-20260917T072356Z/{result.json,probe-before.json,probe-after.json,checker-after-selftest/,checker-after-plain/}` |

## Why the checker moved (T-72, register §8.6, class `trap`, P1)

T-72's row says the anchor grammar makes every citation ROT because a line number is mandatory.
Measured on the frozen revision, the residual is **enforcement**, not extraction: `PATH_PATTERN` and
`CLAIM_PATTERN` already accepted a line-less anchor, but

1. the claim that excused an anchored citation was matched by `(path, line)` **anywhere in the
   document**, so a bare `path:line` was ACCEPTED whenever any other anchor in the same file carried
   a claim for that same `path:line` — measured: exit 0 (`probe-before.json`, arm
   `line-only-shadowed`);
2. the remedy the checker taught in its own failure message was the line-bearing form
   (`` `SYMBOL`, `path:line` ``);
3. nothing classified, counted or reported rot.

The durable revision closes that:

* `claimForSite()` pairs a claim with the anchor **at its own site** (same `path`/`line`/`endLine`,
  within `ROT_SITE_WINDOW = 1` line — the window was chosen from a measurement of the recorded
  subjects: 32 line-bearing citations, 31 claims at distance 0, 1 at distance 1, none farther).
* `lineNumberOnlyProblem()` is the ROT verdict: an anchor whose only locator is a line number is
  reported per anchor and **fails the run**. It is a `record("content:rot", …)` check, counted in
  `rot_line_number_only_anchors`.
* `claimContentProblem()` keeps the t21 content assertion, now site-bound.
* `symbolOnlyClaimCheck()` (the T-55 symbol-first form, verified against the whole file) is unchanged
  and is counted in `symbol_only_anchors_verified`; the accepted line-bearing form is counted
  separately in `line_dependent_anchors_verified` (still green on purpose — no mass re-anchoring).
* every run now records its own revision and the revision it supersedes:
  `result.json.checker = { path, sha256, supersedes: { path, sha256 } }`, so the checker's
  intermediate revisions are **diffable**, not merely hash-comparable.

## Consumers still pointing at the frozen path

* `EXTENSIONS-FOR-AGENTS.md:48-49` — "The skeleton below is extracted from this file by
  `evidence/extensions/docs-claims/check-citations.mjs`". The pointer still RESOLVES (the frozen copy
  is intact and still extracts the skeleton), but it names the superseded revision. That file is
  OUTSIDE lane B2's `inScope` (`scripts/check-citations.mjs`, `evidence/extensions/docs-claims/**`,
  `docs/**`) — reported to the captain as a carry-forward; the durable path is the one to cite.
* `skills/dsh-qa/scripts/lib/immutable-output.mjs:14` — a comment naming the same path. `skills/**`
  is wave 2's single-writer lane (lane D); the sentence is not wrong (the frozen copy still imports
  that library), so no change was made.

## How to run the durable checker

```
node scripts/check-citations.mjs --self-test   # 21 checks: the 5 subject files, the gate arms and
                                               #   8 negative-control arms (T-55 and T-72 forms)
node scripts/check-citations.mjs               # the repo-wide run; evidence lands in
                                               #   evidence/extensions/docs-claims/runs/<slug>-<ts>/
```

A plain run is immutable-by-default (T-53): it writes a FRESH timestamped directory and refuses to
overwrite an existing one.
