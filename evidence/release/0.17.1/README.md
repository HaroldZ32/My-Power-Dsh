# Release 0.17.1 — evidence index

Status: **in progress** (fix PR #92 open; the release branch is cut only after the PR merges to `dev`).
The newest measured result wins; this file is an index, never a substitute for the logs.

## The fix wave

- PR: `#92` — `fix/cellwork-vedit-p0` → `dev`; fix commit `1f9e6158`.
- The four VEdit defects + the pre-existing QA-suite red: see
  `evidence/cellwork/vedit-p0/` (provenance, lane-a/b, review-a/b, review-qa, review-docs, integration,
  incidents) and the PR body.
- Independent verdicts: `rec-20261103T041322-933b84` (lane A), `rec-20261103T041318-faef6d` (lane B);
  written verdicts for the QA-suite fix and the bilingual docs.
- The wave's Docker evidence is recorded below; the fix PR itself is gated by CI
  `Static gates` (pass) and `Docker real-machine acceptance` (source mode, no API key, no browser).

## Docker real-machine evidence

| lane | command / spec | evidence | result |
|---|---|---|---|
| source, release branch | `node scripts/docker-e2e.ts --mode source --require-docker --live` on `release/v0.17.1` @ `b74fc348` | `docker-source-live.log` + `evidence/docker/client-install/2026-11-03T05-12-23Z/` | **PASS** — 202 passed, 0 failed, 38 declared bounds, 1130 s (spec `.`); the first pre-release attempt (`docker-source-live-pre.log`, fix commit) failed ONLY `pack.staticCoherence` + `pack.distFreshRebuild` because the host `dist/mpd-package` was still stale at that run's start (04:40, before the 04:51 re-pack): 200/240 passed, every runtime/mount/TUI/user-surface arm green |
| source, credential-free | CI run `41579170886` (`--mode source`, no API key, no browser) | CI job page / stamp | **PASS** (6m8s) — the empty-model-catalog REGRESSION gate |
| oneclick, release branch | `node scripts/docker-e2e.ts --mode oneclick --require-docker --live --spec github:HaroldZ32/My-Power-Dsh#release/v0.17.1` | `evidence/docker/client-install-oneclick/2026-11-03T04-51-22Z/` | **PASS** — 201 passed, 0 failed, 39 declared bounds, 1231 s |

## Release branch

- Branch `release/v0.17.1`, commit `b74fc348` (from the fix merge `b12d026f`); carriers `package.json` /
  `dsh-plugin.json` / `dsh-distribution.json` = 0.17.1 (six self-urn refs too); root README +
  README.zh-CN.md (badge, version table, notes); `AGENTS.md` §8 install line; CHANGELOG with the dshgo
  content and the cellwork section under one `0.17.1` heading.
- Measured on this commit: `verify:gates` **9/9**; `bun test packages` **3450 pass / 6 skip / 0 fail**;
  `bun run typecheck` exit 0; `bun run test:qa` **all self-tests passed**; `verify-no-host-override`
  PASS; `verify-manual-paths` PASS (153 resolved, every audited path exists); `scripts/pack-mpd.ts`
  followed by `verify-pack-closure` **PASS** (pack stamp `2026-11-03T04:51:14.498Z`, 642/642 file(s)
  identical, 0 drift, 0 expected-after-pack, 541/540 declared sources with 1 exemption). The pack's own
  NOTE: the closure anchor omits some root files it DOES pack (`AGENTS.md`, `PLAN.md`, `VENDOR_LOCK.json`,
  `cordis.patch.yml`, `dsh-distribution.json`, `dsh-plugin.json`, `icon.svg`) — a pre-existing gate
  bound, not a drift.
- Merge `--no-ff` to `master`, annotated tag `v0.17.1`, GitHub release; npm publish stays a HUMAN step
  (`npm stage approve <stage-id>`).

## Honest bounds carried from the fix wave

- The host's exact-live-parent condition is reproduced with a registry double, not a live LLM checkpoint.
- A successful `compactNow` still depends on the host engine's safe range; the reseed is the fallback.
- `tui-admission`'s REAL/static grant arms are still red for a permission-less manifest (follow-up; the
  self-test arm that gates `test:qa` is fixed).
- The `dual-track-smoke` deepseek track is `NO_ADAPTER` in this environment (the profile composes
  `deepseek-official`); the official track passes.
- The evidence-loss incident record: `evidence/cellwork/vedit-p0/incidents/2026-11-03-tui-lanes-deletion.md`.
