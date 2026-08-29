# Cluster 2 (F2 = Deep Worker) — runtime/QA fix closure

- Date: 2026-08-30
- Task: t7 — Fix cluster 2: runtime/QA bugs & low-risk improvements
- Findings in scope: F-06, F-07 (per .mpd/findings/repo-scan-20260830/report.md §3 Cluster 2)

## F-06 [low BUG] — mpd-tools-plugin truncation banner not counted against maxBytes

- File: packages/mpd-tools-plugin/src/index.ts (truncation waterfall, ~line 47)
- Before: head/tail slices were sized against the full `maxBytes`, then the banner
  `"... [mpd-tools truncated N chars ...]"` was appended on top, so emitted output could
  exceed the declared budget by the banner length.
- Fix: compute the banner first, subtract its length from the slice budget
  (`const budget = Math.max(0, maxBytes - banner.length)`), and slice head(0.7)/tail(0.3)
  within that reduced budget. Guard `budget > 0` so a budget smaller than the banner emits
  only the banner (no `slice(-0)` whole-string leak).
- Rebuilt committed dist: packages/mpd-tools-plugin/dist/index.js (bun build).
- Regression tests added: packages/mpd-tools-plugin/test/tools.test.ts
  - "truncation output (incl. banner) never exceeds truncateMaxBytes" (budgets 128..4096)
  - "truncation with a budget smaller than the banner adds no head/tail slices" (budget 64)
  - "truncation keeps head and tail slices plus the banner"
  - "truncation passes through outputs within the budget unchanged"
- Evidence: evidence/scan/t7-20260830/mpd-tools-plugin.test.log — 8 pass / 0 fail / 20 expect.

## F-07 [low IMPR/decision] — mpd-codegraph `.codegraph/` state root documented (not relocated)

- Decision per report: document `.codegraph/` as the sanctioned second workspace state root
  (minimal diff) rather than relocate under `.mpd` (would churn upstream-mirrored behavior).
- Files changed:
  - packages/mpd-codegraph-plugin/README.md — new "## State" section.
  - packages/mpd-codegraph-plugin/README.zh-CN.md — matching "## 状态（State）" section.
  - AGENTS.md §6 State — added exception (3): mpd-codegraph keeps its project index in
    `.codegraph/` under the workspace (upstream-mirrored second state root, gitignored).
- Bilingual pair verified: switch links under the title in both directions
  (`[中文](./README.zh-CN.md)` / `[English](./README.md)`); headings in sync.
- `.gitignore` already covers `.codegraph/` (line 7) — no repo-hygiene change needed here.

## Recursive scan (in-scope packages)

Reviewed packages/mpd-ulw-plugin/src/index.ts (full) and the adopted
packages/mpd-agent-teams-plugin lib outside `_deps/`. No additional runtime/QA bugs found
beyond F-06/F-07; `_deps/` vendored closure left untouched (cluster 4 owns regen).

## Gates

- `bun run test:qa` (all skills/dsh-qa --self-test): PASS, exit 0
  (evidence/scan/t7-20260830-testqa.log)
- `bun test` packages/mpd-tools-plugin: 8 pass / 0 fail
- `bun run typecheck` (root): PASS (0 errors)
- Isolation: unit tests + test:qa self-tests only; no real `~/.dsh` touched. Full
  codegraph real boot not run because the toolchain `codegraph` binary is absent; F-07 is
  documentation-only so no behavioral boot proof is required.

## Forwarded

- None. Cluster-4 owns VENDOR_LOCK re-lock (F-24) after other clusters' asset changes; this
  cluster changed no vendored/upstream fingerprints (docs + plugin source only).
