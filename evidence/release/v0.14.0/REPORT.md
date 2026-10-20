# v0.14.0 release sweep — report

Release: **v0.14.0** of `@mpd-dsh/mpd` (my-power-dsh).
Branch: `release/v0.14.0` from `dev` (tip at cut: `3aa71f73`).
Scope: DeepSeek Harness 0.2.1-rc.2 + dsh-tui 0.16.1, the shared plan→graph model, the real-team
acceptance lane, and the 2026-10-10/11 guard withdrawal. Full notes: [`CHANGELOG.md`](../../../CHANGELOG.md)
and [`RELEASE-v0.14.0.md`](./RELEASE-v0.14.0.md).

## Housekeeping performed before the cut

- 44 local branches already merged into `dev` were deleted (all retained on `origin`); the only local
  branches left are `dev`, `master` and the unmerged `fix/web-dag-edge-spacing` (left untouched).
- `git fetch --prune` removed stale remote-tracking refs.
- ~7.7 GB of regenerable scratch was removed: `.qa-*`, `.bun-tmp`, `.mpd/{recon,tmp,tmp-cache,
  ci-rehearsal,scratch,reference}`. `.codegraph/`, `.mpd/{team,memory,plans,logs,verify}` were kept.
- `dsh-tui-export-1792376508593.md` — an accidentally committed session export — was removed in
  `dba43b1d`, and `.gitignore` now ignores `dsh-tui-export-*.md`.
- A backup tag `backup/dev-3aa71f73` pins the release cut point.

## Static gates (logs under [`gates/`](./gates/))

| Gate | Command | Result |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts` | PASS — 7 shipped assets fingerprinted |
| Row parity | `node scripts/verify-rows-parity.ts` | PASS — 35 row ids |
| Doc pairs | `node scripts/verify-docs-parity.ts` | PASS — 48 pairs, 438 links, 0 dead |
| Plugin manifest | `node scripts/verify-plugin-manifest.ts --pack` | PASS — 1009 packed files, every required path present |
| Declaration comments | `node scripts/verify-comment-coverage.ts` | PASS — 424 files, 37,359 declarations |
| Graph model | `node scripts/verify-graph-model.ts` | PASS — nodes/edges/ranks/cycles equal the declared input |
| No host override | `node scripts/verify-no-host-override.ts` | PASS — 0 of 0 collisions with 213 host row ids |
| Manual paths | `node scripts/verify-manual-paths.ts` | PASS — 166 resolved; declared/anticipatory class counted apart |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | PASS — 32/32 targets fresh, each rebuilt twice byte-identical |
| Aggregate | `node scripts/verify-gates.ts` | PASS — 9/9 member gates green |
| Typecheck | `node_modules/.bin/tsgo --noEmit` | exit 0 |
| Unit tests | `.toolchain/node_modules/.bin/bun test packages` | 2,129 pass / 0 fail — 2,132 tests across 133 files |
| QA self-tests | `node scripts/run-qa-selftests.ts` | PASS — every case, plus `mpd-ext --self-test` (53 checks) and `validate` |
| Preset conformance | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | PASS — 32 harness rows, 29 preset child rows, 27/27 parity, 4/4 negative controls |
| Pack + closure | `node scripts/pack-mpd.ts`, `node scripts/verify-pack-closure.ts` (twice) | PASS — 608/608 content files identical, 0 drift, 0 expected-after-pack |
| Docker driver self-test | `node scripts/docker-e2e.ts --self-test` | PASS — all arms |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `validate extensions/mpd-ext-example` | PASS — 53 checks; example loadable |

`bun test` ran under the pinned `.toolchain` bun (1.4.0); `tsgo` is the repository's own binary.

## Live cases

| Case | Result | Evidence |
|---|---|---|
| `dual-track-smoke` official track | PASS — real headless turn with a recorded tool call | `evidence/dsh-qa/llm-dual-track/official/2026-10-20T02-42-15.458Z/` |
| `dual-track-smoke` gateway track | **CANNOT RUN on this host** — `dsh: NO_ADAPTER: no adapter registered for provider "deepseek"`; the same failure is recorded in the v0.13.2 release evidence, and the host carries no `dsh-llm-pi-ai` adapter | `evidence/dsh-qa/llm-dual-track/deepseek/2026-10-20T02-42-22.193Z/` |
| `mcp-call` | PASS — 108 recorded tools, `mcp__ast_grep__` + `mcp__lsp__` present, a real `mcp__ast_grep__search` call recorded with the fixture line | `evidence/dsh-qa/mcp-call/2026-10-20T02-43-52.743Z/` |

## Docker real-machine lanes

Both lanes run on the local **rootless** Docker (29.9.0 / Compose v5.6.0), with `--require-docker` so a
skip cannot pass silently, and `--live` so the WEB / TUI / HEADLESS turns really reach a model. The
lanes built the worktree at release commit `ca8c3523`; the commits after it only add release evidence
and remove an unrelated session export, so the product bytes those lanes graded are the product bytes
this tag ships.

| Lane | Result | Evidence |
|---|---|---|
| `--mode source --require-docker --live` | **PASS — 117 passed / 0 failed / 5 declared NULL**, exit 0. The 5 NULLs are 4 one-click-only rows (not applicable in source mode) and `ui.teamBoard` (the run did not ask for a team build). The live rows recorded a real headless turn (`boot.llmTurn`), a real team record (`live.teamRecord`), the native executor (`live.nativeExecutor`), and credential removal. | `evidence/docker/client-install/2026-10-20T02-44-13Z/` |
| `--mode oneclick --require-docker --live` | **PASS — 116 passed / 0 failed / 6 declared NULL**, exit 0. The 6 NULLs are 5 source-mode-only rows (no from-source rebuild in one-click mode) and `ui.teamBoard` (no team build requested). | `evidence/docker/client-install-oneclick/2026-10-20T02-57-09Z/` |

The source lane's own evidence directory carries `result.json`, `console.log`, the WEB screenshots
(`ui-shots/`), the TUI captures (`tui-panes/`, `tui-logs/`) and the owed-case logs.

## Honest bounds

- The gateway (non-official) DeepSeek track cannot run on this host; see the table above. The official
  track and every Docker live row DID reach a model.
- npm publishing is STAGED by the tag push (trusted publishing). Nothing is public until a human runs
  the approve dispatch; this report does not claim the package is on the registry.
- The release sweep was run by the captain session itself; no separate verifier seat was bound for the
  version/changelog commit, which changes no product code.
- The two Docker lanes drive the checkout / a local git stand-in for the `github:` spec. The
  registry-published install is exercised only after the npm stage is approved.
