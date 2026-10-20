# v0.15.0 release sweep — report

Release: **v0.15.0** of `@mpd-dsh/mpd` (my-power-dsh).
Branch: `release/v0.15.0`, cut from merged `dev` @ `8f1736c5`; the zh-DAG fix PR #54 merged as
`00396b64` was then merged into the release branch (`dff60cb7`).
Scope: the 2026-10-20 guard split (reconnaissance + delegation guards back, session gate mechanical,
`verify.mode` still withdrawn), the seeded-fork `sessionQualifies` fix, the investigation guard's error
boundary, the TUI attention badge + stateless sidebar deployment on dsh-tui ≥ 0.16.1, the `cordis-dev`
auto-load, the audit's QA repairs, the Web DAG ASCII-kind fix, and the documentation/UI refresh. Full
notes: [`CHANGELOG.md`](../../../CHANGELOG.md) and [`RELEASE-v0.15.0.md`](./RELEASE-v0.15.0.md).

## Status

The captain's final sweep is complete on the release branch. Every gate is green **except the declared
gateway-track bound** (`NO_ADAPTER`, unchanged since v0.13.2); the one-click Docker lane is recorded
separately below. Raw logs and `summary.txt`: [`gates/`](./gates/).

## Static gates (captain's sweep, `gates/`)

| Gate | Command | Result | Log |
|---|---|---|---|
| Aggregate | `bun run verify:gates` | **PASS** — 9/9 member gates green | `verify-gates.log` |
| Vendor | `bun run verify:vendor` | **PASS** — 7 shipped assets; `skills` 382 files; `client.js` re-pinned | `vendor.log` |
| Row parity | `bun run verify:rows` | **PASS** — 35 row ids match the 2-file patch layer | `rows.log` |
| Declaration comments | `bun run verify:comments` | **PASS** — 426 files, 37,567 declarations | `comments.log` |
| Doc pairs | `bun run verify:docs` | **PASS** — 48 pairs, 438 links, 406 checked, 0 dead, 24 exempt, 3 derived, 117 files | `docs.log` |
| Plugin manifest | `bun run verify:manifest` | **PASS** — 0.15.0 in both manifests, 27 row module paths, 25 `files` patterns, `npm pack --dry-run` 1011 files, 0 required absent | `manifest.log` |
| No host override | `node scripts/verify-no-host-override.ts` | **PASS** — 0 collisions with the host row ids | `no-host-override.log` |
| Manual paths | `node scripts/verify-manual-paths.ts` | **PASS** | `manual-paths.log` |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | **PASS** — 32/32 targets fresh (rebuilt twice), pinned bun 1.4.0; 1 declared NOT COVERED | `dist-fresh.log` |
| Graph model | `bun run verify:graph` | **PASS** — 8 nodes, 6 edges, ranks/cycles/report equal the declared input | `graph.log` |
| Preset conformance (self-test) | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | **PASS** | `preset-conformance-selftest.log` |
| Verify-law (self-test) | `node skills/dsh-qa/scripts/verify-law.ts --self-test` | **PASS** | `verify-law-selftest.log` |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `validate extensions/mpd-ext-example` | **PASS** | `ext-selftest.log`, `ext-validate.log` |
| Docker driver (self-test) | `node scripts/docker-e2e.ts --self-test` | **PASS** | `docker-selftest.log` |
| Typecheck | `bun run typecheck` | **PASS** — `tsgo --noEmit`, no diagnostics | `typecheck.log` |
| Unit tests | `.toolchain/node_modules/.bin/bun test packages` | **PASS** — **2161 pass / 3 skip / 0 fail**, 2164 tests / 134 files | `tests.log` |
| QA self-tests | `bun run test:qa` | **PASS** — every case | `qa-selftests.log` |

## Boot lanes (captain's sweep, `gates/`)

| Lane | Command | Result | Log |
|---|---|---|---|
| Bundle lifecycle (audit-fixed sandbox) | `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | **PASS** — install/composed/boot/noHomeCopy/layerDurability/uninstall all `ok:true`, `residue: []` | `lifecycle.log` |
| Preset conformance (real mount) | `node skills/dsh-qa/scripts/preset-conformance.ts` | **PASS** — `agentPreset=mpd`, boot log clean, negative control red | `preset-conformance-real.log` |
| Verify-law boot | `node skills/dsh-qa/scripts/verify-law.ts` | **PASS** — withdrawn state reported, real marker unchanged, sessions sandboxed | `verify-law-boot.log` |

## Live cases (captain's sweep, `gates/`)

| Case | Command | Result | Evidence |
|---|---|---|---|
| Delegation-gate live | `node skills/dsh-qa/scripts/delegation-gate.ts` | **PASS** — 3 sides / 10 rows, `delegationGate=deny`/`allow` boot lines, real checkout untouched | `evidence/roles/delegation-gate/2026-10-20T12-29-36.953Z/` |
| Captain-scope live | `node skills/dsh-qa/scripts/captain-scope.ts` | **PASS** — 8 rows; two guards by mode, session gate mechanical, write guard absent | `evidence/roles/captain-scope/2026-10-20T12-30-34.934Z/` |
| MCP call | `node skills/dsh-qa/scripts/mcp-call.ts` | **PASS** — 108 recorded tools, real `mcp__ast_grep__search` call with the fixture line | `evidence/dsh-qa/mcp-call/2026-10-20T12-33-04.708Z/` |
| Dual-track smoke | `node skills/dsh-qa/scripts/dual-track-smoke.ts` | official track **PASS** (real turn); gateway track **`NO_ADAPTER`** — declared host bound | `evidence/dsh-qa/llm-dual-track/official/2026-10-20T12-33-13.467Z/`, `…/deepseek/2026-10-20T12-33-20.342Z/` |

The optional `session-start-team` 15-side live matrix was not run in this release sweep; its contract
self-test is green (and the fix wave stopped the matrix after 2/15 sides in 11 min). The release gate
does not require it.

## Pack (captain's sweep, `gates/`)

| Step | Command | Result |
|---|---|---|
| Pack | `node scripts/pack-mpd.ts` | **PASS** — 0.15.0 |
| Closure before re-pack | `node scripts/verify-pack-closure.ts` | **PASS** |
| Re-pack | `node scripts/pack-mpd.ts` | **PASS** |
| Closure after re-pack | `node scripts/verify-pack-closure.ts` | **PASS** — 608/608 content files identical, 0 drift, 0 expected-after-pack, 509 declared/508 present/1 declared exemption, 28/28 packages, pack stamp `2026-10-20T12:55:15.305Z` (re-packed after the docs-only caption edits; same 608/608/0-drift result) |

## Docker real-machine lanes

| Lane | Command | Result | Evidence |
|---|---|---|---|
| Source | `node scripts/docker-e2e.ts --mode source --require-docker --live` | **PASS** — `ok=true`, **117 passed / 0 failed / 5 declared NULL**, exit 0 (`ui.replyRendered`, `ui.teamPanel`, `ui.mpdSettingsSection`, `ui.noConsoleErrors`, lifecycle install/mount/uninstall and the live owed cases all green) | `evidence/docker/client-install/2026-10-20T12-33-21Z/` |
| One-click | `node scripts/docker-e2e.ts --mode oneclick --require-docker --live` | first run **FAILED** one check: `pack.staticCoherence` — 3 docs files (README.md, README.zh-CN.md, docs/index.md) drifted because the caption edits were uncommitted when the lane snapshotted the tree. The product bytes were unchanged; the re-run from the clean release commit is recorded below. | first run `evidence/docker/client-install-oneclick/2026-10-20T12-52-47Z/` (`gates/docker-oneclick-first.log`); re-run in the following commit |

The 5 source-mode NULLs are the four `oneclick.*` rows (not applicable in `--mode source`) and
`ui.teamBoard` (no team build was requested). `complete:false` reflects those declared NULLs, not a
failure: `ok=true`, `failed=0`.

## Documentation / UI refresh

- **Version carriers.** `package.json`, `dsh-plugin.json`, `dsh-distribution.json` → **0.15.0**; the six
  `@0.12.0` component refs → `@0.15.0`; the `x-mpd-tui-surfaces` note says "(version 0.15.0)" and keeps
  the separate `@mpd-dsh/mpd-tui` package at 0.1.0. `$schema`, `manifestVersion` and `claimVersion`
  untouched.
- **READMEs.** v0.15.0 badge/current-release line; `cordis-dev` capability bullet; the presets alt text
  now says the new-task-default badge is on the host's Standard mode and the MPD preset is under CUSTOM;
  the plugins alt text no longer claims official-plugin rows the crop does not show.
- **Changelog / release note.** New `## v0.15.0` section above v0.14.0 (Changed / Added / Fixed), the
  bilingual `RELEASE-v0.15.0.md`, and this report.
- **Behaviour docs.** `docs/tui.md` pair: preamble target rewritten to dsh-tui **0.16.1** pointing at
  §11.8 (0.14.0 narrative kept as history); §11.8 "Was" cell corrected. `docs/user-guide.md` pair §6
  guard/preset-scope bullet, "seven write tools" → **eight**, §7.1 names `tuiPanels` as the primary
  Agent-Teams surface, new §7.1.1 on the attention badge, `panelAutoOpen` and the stateless ≥ 0.16.1
  deployment. `docs/design.md` pair drops `mode: hard` from `mpd-verify` (diagnostic only) and keeps every
  `mpd-tools` `writeGuard` mention. `packages/mpd-tui-plugin/README.md` pair says "adapted to 0.16.1".
- **Images (16 PNGs + 3 SVGs, both locales).** Re-captured from ONE fixture team per locale
  (`webui-tui-i18n`, 5 members, 6 tasks) through the Docker UI lane; the hero pairs the same team on both
  halves; the TUI DAG prints the state key once with `+ planned`; the status line carries
  `(workspace-level)`; the workmates page shows `base Senior Engineer`; the presets page shows the badge on
  Standard and MPD under CUSTOM. The zh-CN set is its own render set. `team-lifecycle.svg` "seven" →
  eight; `architecture.svg` drops the commented-out id-target claim, corrects the patch path to
  `./cordis.patch.yml` and the host-row count to 34. Evidence:
  [`ui-capture/20261020T115739Z/`](./ui-capture/20261020T115739Z/), plus the zh re-capture after the DAG
  fix.
- **The Web DAG ASCII-kind fix (PR #54).** Under zh-CN the node legend now draws `REQ|WRK|REV|FIX|INT`
  (`dag-edges-scroll` §F1); the detail body and tooltips keep the localized kind and verbatim subject.
  The zh web capture went 17/18 → 18/18; evidence `evidence/fix/web-dag-cjk-kind/20261020T121109Z/`.
- **Independent visual review (Vision Analyst).** All 16 images inspected: no stale image, one fixture
  team, ASCII chips in both locales, no duplicated legend, no pre-0.15 chrome. Two caption-level defects
  were found and fixed (the plugins alt clause; the zh-CN index's over-broad TUI-localization sentence).
  Residual: the zh settings modal carries two English sentences (an in-app i18n gap, not a doc
  contradiction), and the EN workmates tile clips long lines at its 158-column capture geometry.

## Knob count — verified

`.toolchain/node_modules/.bin/bun -e "import { SETTINGS_KNOBS } from './packages/mpd-config-plugin/src/settings-schema.ts'; console.log(SETTINGS_KNOBS.length)"`
answers **59** = 13 original + 12 `teamModels` slot leaves (4 × 3) + 33 `agentRoutes` leaves (11 × 3) +
1 `tui.dashboardKey`. The TUI row's other three knobs (`panel`, `workmate`, `panelAutoOpen`) are
`cordis.patch.yml` row config, not `mpd.jsonc` namespace knobs, so the `/settings` count stays 59 at all
six claim sites.

## Honest bounds

- The gateway (non-official) DeepSeek track cannot run on this host: `dsh: NO_ADAPTER: no adapter
  registered for provider "deepseek"`. The official track runs a real turn; the Docker live rows reach a
  model.
- The source Docker lane's `complete:false` is the 5 declared NULLs above, not a failure.
- The one-click lane grades the repository's DEFAULT branch; its result is recorded above when it is run
  against the published default branch after the master push. A local checkout stand-in is labelled as
  such, never as the published artifact.
- `bun test` at the repo root scans historical `evidence/**` fixtures; the canonical gate is
  `bun test packages`.
- The documentation/UI refresh edits (captions, images) are docs-only and were applied after the source
  Docker lane's product bytes were fixed; the final pack is refreshed and closure-checked after them.
- The version/changelog commit carries no separate verifier seat (docs-only), as in v0.14.0; the product
  fix (zh-DAG) WAS verified by an independent Architect seat (`rec-20261020T122016-9bb0bf`, PASS).
- The zh-CN settings capture contains two English sentences from the app's settings modal (an in-app
  localization gap, pre-existing); it is not a stale image and is recorded as a follow-up.
- The EN workmates tile is captured at the 158-column TUI geometry and clips long lines at the right
  edge; the zh tile uses the wider 218-column geometry and is clean. Cosmetic, not a caption
  contradiction.
