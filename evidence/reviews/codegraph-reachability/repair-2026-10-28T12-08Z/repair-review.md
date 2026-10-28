# Independent re-verification — CodeRabbit F1/F2/F3 repair delta

Verifier seat: `reviewer` (session aafdffa3), bound to loop `loop-20261028T120804-18bac2`.
Recorded verdict: **PASS** — `rec-20261028T121114-d17689` (2026-10-28T12:11:14Z), basis `blind`,
6 gate-evidence logs, 4 cited documents, findings `[]`.

Frozen basis: `.mpd/plans/fix-codegraph-repair.md` (R1–R6), the quoted findings
`evidence/mcp-codegraph/d3-repair-cr/2026-10-28T12-03-17Z/findings/coderabbit-pr76-quoted.txt`, the
documentation band, and measurements I ran. Delta under test: `d486db10` (parent `6d2ddc8d`), tracked
tree clean at 2026-10-28T12:08Z and again after my runs; the main contract and its verdict
`rec-20261028T102333-0045ca` stand for the pre-repair tree `046a04ba`.

Per the contract, the verdict was recorded from the contract, the quoted findings, the evidence
artifacts and my own gate runs BEFORE the repair's implementation was read; the code was then read
only to confirm or refute. The confirmation and the independent reproduction below are recorded here,
and a refutation would have been reported as a Blocker with a corrective FAIL.

## Assessment

The repair is sound and answers all three findings at the place the defect lives. F1 and F3 are
confirmed by behaviour, not by narrative: I rebuilt the real unhoisted layout on disk and ran BOTH
the repaired resolver and the pre-repair snapshot against it — the pre-repair resolver rejects the
healthy shim, the repaired one accepts it — and I reproduced the win32 false-ACCEPT that F1 closes
(runtime-only was accepted before, rejected now). F2's fixture correction is in place; its effect is
Windows-conditional and is recorded as a bound. R5's emitted diff is exactly as disclosed: three dist
targets, the ast-grep pair differing by one import line each, ast-grep's probe untouched, the LSP
launcher not a consumer. R6 gates are green on my own runs. Risk level: **LOW**.

## R1 — dispositions, confirmed against the code at `d486db10`

| # | Finding | Disposition | Deciding evidence (mine) |
|---|---|---|---|
| F1 | win32 probe must require `node.exe` **and** `lib/dist/bin/codegraph.js` | **FIXED** | `hasCodegraphPlatformBundle` builds a per-platform required list and returns `every(...)`; my reproduction: runtime-only → false, app-entry-only → false, both → true, while the **pre-repair** resolver returned **true** for runtime-only (the false ACCEPT). Bound: platform injected, no Windows host. |
| F2 | complete-install fixture must build the platform's launcher shape | **FIXED** | `platformLauncherFiles` / `touchPlatformLaunchers` build both the complete-install state and the unhoisted arm; the complete-install fixture calls the helper instead of hard-coding `bin/codegraph`. On this POSIX host old and new fixtures behave alike, so the fix is code-confirmed only (bound). |
| F3 | the probe must anchor at the `.bin` link target | **FIXED** | `anchor = opts.anchor ?? realpathIfPossible` and `createRequire(resolve(anchor(shimPath)))`; real layout measured in my reproduction (below): repaired default accepts, identity anchor (pre-repair search from `.bin`) rejects, pre-repair resolver rejects. |

R2 (test that fails on the old behaviour + negative control): F1's arm fails on the old resolver
(runtime-only true→false) with the both-files case as its control; F3's arm asserts the identity
anchor rejects (old behaviour) with the default accept as its control; the broken-shim case remains
the false-ACCEPT control. F2's "fails on old behaviour" is win32-conditional (bound).

## R3 — real-layout measurement (the deciding one)

`evidence/mcp-codegraph/d3-repair-cr/2026-10-28T12-03-17Z/arms/nested-anchor-function.txt` is a real
unhoisted layout (real 1.5.0 `npm-shim.js` under `vendor/`, the real platform bundle nested under it,
`node_modules/.bin/codegraph` symlinked to the shim) and names both outcomes:
`anchored (default, realpath): true`, `unanchored (identity anchor): false`, link target printed.
That is a real-layout measurement with both anchors named, so R3 is satisfied by the artifact, and a
unit arm with an injected anchor alone would NOT have satisfied it.

I reproduced it independently (`r3-repro.ts`, log `r3-repro.log`, pinned bun 1.4.0): a real temp tree
with `node_modules/.bin/codegraph` as a real symlink into `vendor/@colbymchenry/codegraph/npm-shim.js`
and the platform package under the target package's own `node_modules` (the `.bin` node_modules holds
no platform package), compared against the pre-repair resolver snapshot from `6d2ddc8d`:

```
nested: repaired default (anchored at the link target) ACCEPTS the healthy shim   true
nested: identity anchor (pre-repair search from .bin) REJECTS it                  false
nested: PRE-REPAIR resolver REJECTS the healthy shim                              false
flat:   repaired default accepts / identity anchor accepts / pre-repair accepts   true/true/true
broken: repaired default REJECTS the unusable shim                                false
```

The flat row is the accidental-green shape the finding describes; the broken row keeps the original
bug closed. The layout uses the real shape and real symlink semantics; the launcher file itself is a
stub because the predicate asks existence, not content (the writer's arm used the real 281 MB bundle —
a stronger fixture, but the same question; recorded as a nuance, not a gap in the decision).

## R4 — both directions

- **False REJECT (the dangerous one):** exercised by the identity anchor on a HEALTHY shim — false in
  both my reproduction and the writer's real-layout arm. This is the direction F3 is about.
- **False ACCEPT (the original bug):** exercised by the missing-platform-bundle case (false), the
  complete-install state without the platform files (skipped, never pinned), F1's runtime-only case
  (pre-repair true → repaired false), and the launcher arms: `armA-incomplete-pin` → `TOOLS=0` with
  upstream's "no prebuilt bundle" message, `armB-complete-pin` → `TOOLS=1 codegraph_explore`,
  `armC-checkout-no-pin` → `TOOLS=1`.

## R5 — no collateral regression, from bytes

- Emitted targets in the repair: exactly three dist files —
  `packages/mpd-mcp-codegraph/dist/launch.js` (17 lines) and the ast-grep pair
  `dist/launch.js` + `dist/cli.js`, each **one line**: `node:fs` gains `realpathSync` in the inlined
  `bin-resolve.ts` import. Verified by `git diff 6d2ddc8d d486db10 -- packages/*/dist/`; no other
  dist bytes moved; `verify-dist-fresh` 34/34 proves every committed dist equals a from-src rebuild.
- `realpathSync` occurs exactly ONCE in each ast-grep dist — in the import specifier, unused. The
  writer's "tree-shaken out" phrasing describes the USAGE; the binding remains in the import line,
  which is precisely the one-line diff disclosed. Behaviour unchanged.
- ast-grep keeps its own probe: the repair's resolver diff contains no ast-grep hunk; the ast-grep
  test arms all pass (`--version` probe honoured, never accepted by name, real toolchain probe).
- The LSP launcher does not consume the resolver: no reference in `packages/mpd-mcp-lsp/src/`, and
  the frozen coupling inventory lists LSP's `mpd-mcp-shared` imports as log-sink / dependency-entry /
  unavailable-server only. The coupling-inventory independence gate passes.
- README pair (`packages/mpd-mcp-codegraph/README.md` + `.zh-CN.md`) changed together; the doc-pairs
  member of `verify:gates` is green.

## R6 — gates, run by me on `d486db10`

| gate | id | observed |
|---|---|---|
| gates | ev-20261028T120941-a17731 | PASS — **9/9** members |
| tests | ev-20261028T120948-c790ae | **2660 pass / 6 skip / 0 fail** (2666 tests) |
| typecheck | ev-20261028T121020-801c92 | `tsgo --noEmit` exit 0 |
| comments | ev-20261028T121020-ebc35f | PASS (479 files, 43597 declarations) |
| dist | ev-20261028T121027-2613f0 | **34/34 fresh**, pinned bun 1.4.0, 1 declared NOT COVERED |
| pack | ev-20261028T121027-c88a30 | closure **627/627 identical, 0 drift**, 523/524 present + 1 declared exemption, stamp 2026-10-28T12:10:28.118Z |

Pack bytes also match HEAD for `mpd-mcp-codegraph/dist/launch.js` and both ast-grep dists.

## Findings

1. **Nit (evidence shape)** — the function-level real-layout arm's driver script (`check.mts` under
   `/tmp/nestedfn-…`) was not preserved with its output, so a reader cannot re-run the writer's exact
   arm. Mitigated by my independent reproduction, which replaces the gap. Direction: keep the fixture
   driver beside its output in a future evidence dir.
2. **Nit (wording precision)** — "realpathSync is tree-shaken out of ast-grep's emitted code": the
   symbol is unused there but remains in the import specifier. The emitted diff is exactly the one
   line the captain described, and behaviour is unchanged; this is a phrasing nit, not a defect.

No Blockers. No STILL-VALID findings remain.

## Declined to judge

- Whether F1 is correct on a genuine Windows host — unmeasurable here; the platform-injected arms and
  upstream's cited two-file requirement are the basis, and the writer did not claim a Windows run.
- Which fallback tier served the end-to-end unhoisted runs — not attributed and explicitly not used
  as F3 proof by the writer; I did not use it either.
- The 281 MB real bundle fixture's content vs my stub-shaped layout — the predicate asks existence;
  the shape is what R3 names. Recorded as a nuance above.
- The repair's README prose — covered by the doc-pairs gate; not re-read for content.
- Anything outside the repair delta (the main wave's ACs, release sweep, Docker lanes, version bump) —
  out of scope by the contract.

## Bounds of this review

- **NO Windows host exists in this session.** F1/F2 are confirmed by the repair's arms (platform
  injected) and upstream's cited behaviour, never by a Windows launcher start; any Windows-measured
  claim would have been a Blocker — none was made.
- No Docker lane. The pack is the tree's own staged artifact, re-staged by my own `pack` run.
- My reproduction builds the REAL layout SHAPE on Linux with stub launcher files; the writer's arm
  used the real platform bundle — the symlink semantics are the same, and both agree.
- One real-layout reproduction run, one host, one architecture; the tree was clean before and after.
- I did not commit anything; artifacts are untracked under `evidence/reviews/`.

## Verdict

**PASS** — all three findings are correctly classified FIXED at `d486db10`, the consequential one (F3)
is proven by a real-layout measurement with both anchors named and independently reproduced against
the pre-repair resolver, the dangerous direction is exercised, R5's emitted diff matches the
disclosure byte-for-byte, and R6 is green on my own runs. The only residuals are a Windows bound the
writer stated honestly and two wording/evidence-shape nits.
