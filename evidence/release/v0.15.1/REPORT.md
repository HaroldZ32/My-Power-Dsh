# v0.15.1 release sweep — report

Release: **v0.15.1** of `@mpd-dsh/mpd` (my-power-dsh).
Branch: `release/v0.15.1`, cut from merged `dev` @ `be58f097` (PR #57); release prep commit `46aa3b1a`.
Scope: the full reconciliation of the v0.15.0 context-diet wave with the shipped code — routing truth,
the team record, the verifier's envelope, workmate injection, the Docker release recipe, the gate facts,
the single-call-consult wording (the harness keeps roster/workmate children continuable), the CodeRabbit
reconciliation, and the live real-machine evidence. Full notes:
[`CHANGELOG.md`](../../../CHANGELOG.md).

## Status

Every gate is green, both Docker real-machine lanes are green with `--live`, and the wave carries an
independent verification trail (FAIL → repair → PASS). Two declared bounds remain, both pre-existing and
named under "Declared bounds" below: the gateway `deepseek` track answers `NO_ADAPTER` (unchanged since
v0.13.2) and the one-click mode reports its six mode-specific NULLs.

## Static gates (captain's sweep, observed 2026-10-21)

| Gate | Command | Result |
|---|---|---|
| Aggregate | `bun run verify:gates` | **PASS** — 9/9 member gates green |
| Vendor | `bun run verify:vendor` | **PASS** — 7 shipped assets, `skills` 382 files |
| Unit tests | `bun test packages` | **PASS** — 2161 pass / 3 skip / 0 fail (2164 tests, 134 files) |
| Typecheck | `bun run typecheck` | **PASS** — `tsgo --noEmit`, no diagnostics |
| QA self-tests | `bun run test:qa` | **PASS** — all self-tests passed |
| Doc pairs | `bun run verify:docs` | **PASS** — 48 pairs, 438 links, 0 dead, 24 exempt, 3 derived |
| Row parity | `bun run verify:rows` | **PASS** — 35 row ids match the 2-file patch layer |
| Preset conformance | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | **PASS** — 32 harness rows, 29 preset children, parity 27/27, 4/4 negative controls reddened |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | **PASS** — 32/32 targets fresh (rebuilt twice), pinned bun 1.4.0; 1 declared NOT COVERED |
| Pack closure | `node scripts/verify-pack-closure.ts` | **PASS** — 609/609 content files identical, 0 drift, 0 expected-after-pack; pack stamp `2026-10-21T04:08:43.653Z` |
| No host override | `node scripts/verify-no-host-override.ts` | **PASS** — 0 id-target collisions against 213 host ids |
| Manual paths | `node scripts/verify-manual-paths.ts` | **PASS** — resolved 151 |
| Plugin manifest | `bun run verify:manifest` | **PASS** — version coherence 0.15.1, packaging contract holds |
| Declaration comments | `bun run verify:comments` | **PASS** — 426 files, 37,567 declarations |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `validate extensions/mpd-ext-example` | **PASS** — 53 checks; example valid |
| MCP call (real case) | `node skills/dsh-qa/scripts/mcp-call.ts` | **PASS** — 108 recorded tools, real `mcp__ast_grep__search` with the fixture line (`evidence/dsh-qa/mcp-call/2026-10-21T04-13-42.903Z/`) |
| Dual-track smoke | `node skills/dsh-qa/scripts/dual-track-smoke.ts` | official track **PASS**; gateway `deepseek` track **`NO_ADAPTER`** — declared host bound (`evidence/dsh-qa/llm-dual-track/{official,deepseek}/2026-10-21T04-09-*/`) |

## Docker real-machine lanes (rootless Docker 29.9.1, `--live`)

| Lane | Command | Result | Evidence |
|---|---|---|---|
| Source | `node scripts/docker-e2e.ts --mode source --require-docker --live` | **PASS** — `ok=true`, **117 passed / 0 failed / 5 declared NULL**, exit 0; a real model turn on Web, TUI and headless | `evidence/docker/client-install/2026-10-21T04-09-46Z/` |
| One-click | `node scripts/docker-e2e.ts --mode oneclick --require-docker --live` | **PASS** — `ok=true`, **116 passed / 0 failed / 6 declared NULL**, exit 0 | `evidence/docker/client-install-oneclick/2026-10-21T04-19-38Z/` |

The source lane's five NULLs are the four `oneclick.*` rows (not applicable in source mode) and
`ui.teamBoard` (no team build requested). The one-click lane's six NULLs are `build.bunInstall`,
`build.dists`, `pack.distFreshRebuild`, `pack.rebuildToolchain`, `pack.distFreshRebuildControl` (all
mode-specific by design) and `ui.teamBoard`. The live credential was staged ONCE into the sandbox home
(mode 0600), scoped and deleted before the report — its value never appears in any artifact.

## Wave verification trail

- Independent verifier round 1 — **FAIL** on three shipped-text defects: `evidence/verification/context-diet-reconcile/2026-10-21T02-50-59Z/`
- Independent verifier round 2 after repair — **PASS** on every criterion: `evidence/verification/context-diet-reconcile/2026-10-21T03-03-10Z/`
- Writer-lane verification record: `evidence/verification/context-diet-reconcile-residuals/20261021T024612Z/`
- PR #57 (merged as `be58f097`): CI **Static gates SUCCESS**, **Docker real-machine acceptance SUCCESS** on the merged head; CodeRabbit completed two review passes (4 + 1 actionable comments, all FIXED and reconciled in the PR) and an incremental pass on the final commit with **no actionable comments**.

## Declared bounds

- The `deepseek` gateway track of `dual-track-smoke` answers `NO_ADAPTER` in this environment (no adapter
  for the provider named `deepseek`); the `deepseek-official` track ran a real turn. Unchanged since
  v0.13.2 and recorded as a host bound, not a bundle defect.
- A repo-root `bun test` also discovers the committed historical `evidence/**` fixtures and fails on them
  (18 pre-existing failures, none in the shipped tree). The canonical gate is `bun test packages`, and
  `AGENTS.md` §11 now says so.
- Released `CHANGELOG.md` entries (v0.10.0 / v0.11.0) keep their historical wording as released history;
  the reconciliation binds live shipped text.
- The post-publish `github:` one-click spec against the default branch is a separate post-release step.
  **It was then run and PASSED after the tag was pushed**: a bare `ubuntu:24.04` installed
  `@mpd-dsh/mpd` straight from `github:HaroldZ32/My-Power-Dsh` (master @ `83ef3603`) with `--live` —
  `ok=true`, 116 passed / 0 failed / 6 mode-specific declared NULL, exit 0
  (`evidence/docker/client-install-oneclick/2026-10-21T04-33-29Z/`).
