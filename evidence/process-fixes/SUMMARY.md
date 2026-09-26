# Wave impact summary — process hardening (w1)

Objective (user's words): fix the problems that came up in the process just now — i.e. the six
process defects the documentation wave left behind.

Delivered on `dev` (base `f7ed4df`) by team `MPD Process Hardening` wave `w1`: 12 tasks, 11 seats,
review gate PASS (0 blocker, 0 high). Ledger: `hash-ledger.md`.

## The six problems → fix → instrument

| # | Problem (measured) | Fix | Instrument that proves it |
|---|---|---|---|
| 1 | The docs gate was BLIND to link targets — the only link logic was `switchLinkUnderTitle`, a spelling test that never stats a target. Two rounds of dead `architecture.md` links passed it green and were found only by hand-written per-lane sweeps. | `scripts/verify-docs-parity.mjs` now resolves relative link targets across the band it already discovers, reusing the existing `EXEMPT_PROVENANCE` skip and the T-75 discriminator. | Injected dead link → `FAIL link-missing:<source>:<target>` with the resolved path; removed → green. 5 new self-test arms (28 → **34**), each falsifiable: five one-token mutants each redden exactly their guard arm (t5), re-confirmed with two more (t9/t12). |
| 2 | `.gitignore` used the DIR-ONLY `evidence/**/sandbox/`, so the SYMLINK `evidence/web-card-catalog/…/sandbox` was not ignored and a `git add -A` would have swept machine state into a commit. | `evidence/**/sandbox` (no trailing slash) + a comment naming the symlink case. | `git check-ignore -v …/sandbox` exits 0 naming `.gitignore:56` (was exit 1, `??` in `git status`); the real directory still matches. |
| 3 | AGENTS.md §9 carried a stale historical claim ("wave 3 has exactly one re-pin (t3)") in a binding rule. | Restated as a wave-agnostic invariant. | Grep for the stale form returns 0; the rule still states the same invariant. |
| 4 | No HASH-TIMESTAMP discipline — the docs wave hit four "stale reading" rounds from sampling a moving file at different instants. | AGENTS.md §7 gains "Quote a hash WITH its measurement moment" (hash + instant; verifier sandwiches hash → work → re-hash, start == end). | The rule was exercised in this very wave: t9 disclosed the mid-pass `AGENTS.md` move with both moments instead of papering over it. |
| 5 | The language-policy paragraph, which reviewers are told to trust, under-described the gate after the extension. | Two steps: it now names the link-resolution coverage (t4), and the ROOT-relative `/x` class (t10). | Clause-by-clause comparison against the shipped code's measured behaviour (t5, t6). |
| 6 | Six platform frictions that each cost turns were undocumented, so the next wave would rediscover them. | `agent-references/troubleshooting.md` gains a section with the LITERAL refusal strings and the correct response, plus the re-dispatch pattern. | +27/−0, single hunk; the re-dispatch row cites the shipped guard (`deliveryRoutingClass`, region `mpd-delta terminal-dispatch-recheck`) rather than claiming no guard exists — the honesty bound the fact base demanded. |

One defect found DURING this wave was fixed on sight rather than deferred: **t5-F1** — a ROOT-relative
target resolved against the FILESYSTEM root, so a link whose target existed in the tree was reported
dead. Fixed by t8 (explicit leading-slash strip, base = repo root, no silent fallback) with a 34th
falsifiable arm; verified by t9. A second, cosmetic inaccuracy (**O2**: the script's own top-of-file
paragraph omitted the root-relative class it implements) was fixed by t11 and re-verified by t12 as
comment-only.

## The gate's new coverage — and its two honest limits

Coverage: every relative link target in the 92-file band resolves from the LINKING file's own
directory; `./x`, `x`, `../x`, nested paths, a ROOT-relative `/x` (repo root, never the filesystem
root), a directory target, with `#fragment` stripped first; external URLs, protocol-relative `//host`,
in-page anchors, empty targets and code-span text are counted and IGNORED.

Limit 1 — **verbatim provenance is exempt, not green**: 7 dead targets live inside
`packages/mpd-agent-teams-plugin/README.md` (upstream repository paths in a file kept verbatim); they
are printed as `EXEMPT_PROVENANCE` and the counters reconcile as `210 = 217 checked − 7 skipped`. The
skip is file-scoped, proven by a non-exempt fixture reddening on the same input.

Limit 2 — **a packed copy yields a NOTE, not a failure**: with no root `AGENTS.md` the tree is a
packed/partial copy, so an unresolved target is a `link-absent-site` note (T-75). Measured on the
real pack: exit 0, `absentSite=4`, no invented failures. This is also why a demo tree without
`AGENTS.md` shows `dead=0` while a link is missing — the bound, not a hole.

Declared bound kept as-is: **fragments are stripped and never validated** (t5-F2) — `[x](./y.md#anchor)`
resolves on `y.md` and the anchor itself is not checked in v1.

## Deliberately NOT claimed

1. The fact base's census headline (89 files / 192 links) is UNDERSTATED; the authoritative numbers are
   the gate's own counters (`files=92 links=234 checked=217 resolved=210 dead=0`). It reproduces the
   census per file exactly.
2. Anchor/fragment validation is not implemented (Limit/declared bound above).
3. The 7 provenance-exempt dead targets are skipped, not fixed — the upstream README stays verbatim.
4. t11's reversal-based comment-only proof did not corroborate under t12's independent route; the
   equivalence proof is what stands. Recorded, not smoothed over.
5. Two low review observations were left as observations, not converted into work: **O4** (scanner
   bounds: fenced-block and code-span exclusions are heuristic) and **O5** (`.gitignore` matches the
   `sandbox` FILE NAME; a differently-named symlink would need a new rule).
6. The five dot-prefixed scratch harnesses under `evidence/process-fixes/` (`.t5-*`, `.t9-*`, `.t12-*`)
   are kept for reproducibility and ARE committed with the evidence.

## Process notes worth carrying (measured this wave)

- **Premature dispatch is a distinct shape** from the terminal re-offer: `t7` (a captain-only
  contract) was offered to a read-only seat BEFORE its dependency `t12` completed. The seat refused
  it correctly, failed it with two named blockers (ownership + ordering) instead of bluffing, and left
  a preflight that made the eventual captain takeover a single pass. That is the right handling:
  a read-only seat must decline write-shaped work even when dispatched.
- **A captain takeover returns to the member pool when the captain's turn ends** — so a takeover must
  be driven to terminal IN THE SAME TURN, or it will be re-offered to an idle seat (this happened
  twice: `t7` in both waves).
- **Anchors churn when a lane edits a verified artifact**: this wave produced three script revisions
  and three verification passes. The mitigation that worked was (a) each verdict naming the hash WITH
  its moment, (b) each later verdict stating plainly which earlier hash it supersedes, and (c) never
  appending to a previous verdict artifact — each pass wrote a NEW file.
- **Fresh `/tmp` per bash call (T-23) breaks any multi-call demo**: a copy-probe must be built and
  exercised inside ONE bash call. Both a lane and the captain hit this today.
