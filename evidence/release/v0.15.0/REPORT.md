# v0.15.0 release sweep — report

Release: **v0.15.0** of `@mpd-dsh/mpd` (my-power-dsh).
Branch: `release/v0.15.0`, cut from merged `dev` @ `8f1736c507914d46f329539d61daef17569f166e`.
Scope: the 2026-10-20 guard split (reconnaissance + delegation guards back, session gate mechanical
again, `verify.mode` still withdrawn), the seeded-fork `sessionQualifies` fix, the investigation guard's
error boundary, the TUI attention badge + stateless sidebar deployment on dsh-tui ≥ 0.16.1, the
`cordis-dev` auto-load, the audit's QA repairs, and the documentation/UI refresh. Full notes:
[`CHANGELOG.md`](../../../CHANGELOG.md) and [`RELEASE-v0.15.0.md`](./RELEASE-v0.15.0.md).

## Status of this report

Written by the **release-docs lane**. The tables below separate what that lane RAN (observed, with the
evidence path) from what the **captain's final sweep** must still fill in (placeholders). A placeholder
is not a pass.

## Documentation lane — gates actually run

Commands run from the repo root with the pinned toolchain (`.toolchain/node_modules/.bin/bun`, 1.4.0;
node v24.21.0). Evidence: [`docs/20261020T112746Z/`](./docs/20261020T112746Z/) (`result.json` +
`output.log`).

| Gate | Command | Exit | Observed |
|---|---|---|---|
| Doc pairs | `bun run verify:docs` | 0 | **PASS** — `pairs=48 failed=0 violations=0 exempt=24 derived=3 links=438 dead=0 files=117`; link census `checked=406 resolved=406 dead=0 ignoredExternal=26 ignoredAnchorOnly=6` |
| Plugin manifest | `bun run verify:manifest` | 0 | **PASS** — `version:dsh-plugin.json: version = 0.15.0`; `version:dsh-distribution.json: distribution.version = 0.15.0`; 27 row module paths, 0 missing; 25 `files` patterns, 0 required path absent; `npm pack --dry-run` lists 1011 files, 0 required path absent |
| Typecheck | `bun run typecheck` | 0 | **PASS** — `tsgo --noEmit`, no diagnostics (no source file was edited by this lane) |

### Knob count — verified, not assumed

The plan asked for the counted "59 knobs" claim to be checked against the settings schema at every site
it appears. Method: runtime import of `packages/mpd-config-plugin/src/settings-schema.ts` and a count of
`SETTINGS_KNOBS` under the pinned bun:

```bash
.toolchain/node_modules/.bin/bun -e "import { SETTINGS_KNOBS } from './packages/mpd-config-plugin/src/settings-schema.ts'; console.log(SETTINGS_KNOBS.length)"
# 59
```

Breakdown: 13 original knobs + 12 `teamModels` slot leaves (4 slots × 3) + 33 `agentRoutes` leaves
(11 members × 3) + 1 `tui.dashboardKey` = **59**. The claim therefore HOLDS and no number changed. The
TUI **row** carries four knobs (`panel`, `workmate`, `panelAutoOpen`, `dashboardKey`), but the first three
are `cordis.patch.yml` row config — not `mpd.jsonc` namespace knobs — so they do not enter the `/settings`
count. Sites checked (line numbers after this wave's edits): `docs/user-guide.md:403`,
`docs/user-guide.zh-CN.md:364`, `docs/tui.md:120` and `:149`, `docs/tui.zh-CN.md:110` and `:131`.

## Static gates — captain's final sweep (PLACEHOLDERS)

| Gate | Command | Result | Log |
|---|---|---|---|
| Vendor | `bun run verify:vendor` | `<captain>` | `gates/vendor.log` |
| Row parity | `bun run verify:rows` | `<captain>` | `gates/rows.log` |
| Declaration comments | `bun run verify:comments` | `<captain>` | `gates/comments.log` |
| No host override | `node scripts/verify-no-host-override.ts` | `<captain>` | `gates/no-host-override.log` |
| Manual paths | `node scripts/verify-manual-paths.ts` | `<captain>` | `gates/manual-paths.log` |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | `<captain>` | `gates/dist-fresh.log` |
| Graph model | `bun run verify:graph` | `<captain>` | `gates/graph.log` |
| Aggregate | `bun run verify:gates` | `<captain>` | `gates/gates.log` |
| Unit tests | `.toolchain/node_modules/.bin/bun test packages` | `<captain>` | `gates/bun-test.log` |
| QA self-tests | `bun run test:qa` | `<captain>` | `gates/qa-selftests.log` |
| Preset conformance (self-test) | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | `<captain>` | `gates/preset-conformance-selftest.log` |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `validate extensions/mpd-ext-example` | `<captain>` | `gates/mpd-ext-selftest.log`, `gates/mpd-ext-validate.log` |
| Verify-law self-test | `node skills/dsh-qa/scripts/verify-law.ts --self-test` | `<captain>` | `gates/verify-law-selftest.log` |

## Boot lanes — captain's final sweep (PLACEHOLDERS)

| Lane | Command | Result | Log |
|---|---|---|---|
| Bundle lifecycle (the audit-fixed sandbox) | `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` | `<captain>` | `gates/boot-bundle-lifecycle.log` |
| Preset conformance (real mount) | `node skills/dsh-qa/scripts/preset-conformance.ts` | `<captain>` | `gates/preset-conformance-real.log` |
| Verify-law boot | `node skills/dsh-qa/scripts/verify-law.ts` | `<captain>` | `gates/verify-law-boot.log` |
| Delegation-gate live | `node skills/dsh-qa/scripts/delegation-gate.ts` | `<captain>` — must show the deny side on a preset-carrying session and `delegationGate=allow` on the released side | `gates/delegation-gate.log` |
| Session-start team live | `node skills/dsh-qa/scripts/session-start-team.ts` | `<captain>` — incl. the `mechanical-default` side (no seeded `team.gate`) | `gates/session-start-team.log` |

## Live cases — captain's final sweep (PLACEHOLDERS)

| Case | Command | Result | Evidence |
|---|---|---|---|
| `dual-track-smoke` (official track) | `node skills/dsh-qa/scripts/dual-track-smoke.ts` | `<captain>` | `gates/dual-track-smoke.log` |
| `dual-track-smoke` (gateway track) | same | **cannot run on this host** — `NO_ADAPTER` for provider `deepseek` (unchanged since v0.13.2; see the honest bounds) | `gates/dual-track-smoke.log` |
| `mcp-call` | `node skills/dsh-qa/scripts/mcp-call.ts` | `<captain>` | `gates/mcp-call.log` |

## Pack — captain's final sweep (PLACEHOLDERS)

| Step | Command | Result |
|---|---|---|
| Pack | `node scripts/pack-mpd.ts` | `<captain>` |
| Closure before re-pack | `node scripts/verify-pack-closure.ts` | `<captain>` |
| Re-pack | `node scripts/pack-mpd.ts` | `<captain>` |
| Closure after re-pack | `node scripts/verify-pack-closure.ts` | `<captain>` — freshness is read from the `expected-after-pack` list, never from the exit code |

## Docker real-machine lanes — captain's final sweep (PLACEHOLDERS)

Run AFTER the last write, with `--require-docker` so a skip cannot pass silently.

| Lane | Command | Result | Evidence |
|---|---|---|---|
| Source | `node scripts/docker-e2e.ts --mode source --require-docker --live` | `<captain>` | `evidence/docker/client-install/<stamp>/` |
| One-click | `node scripts/docker-e2e.ts --mode oneclick --require-docker --live` | `<captain>` | `evidence/docker/client-install-oneclick/<stamp>/` |

The one-click lane installs the repository's DEFAULT branch; run it after the master push, or state that
it graded a local stand-in.

## Documentation / UI refresh

What the release-docs lane changed (docs text and version carriers only):

- `package.json`, `dsh-plugin.json`, `dsh-distribution.json` → **0.15.0**; the six `@0.12.0` component
  refs → `@0.15.0`; the `x-mpd-tui-surfaces` note says "(version 0.15.0)" and keeps the separate
  `@mpd-dsh/mpd-tui` package at 0.1.0. `$schema`, `manifestVersion` and `claimVersion` untouched.
- `README.md` / `README.zh-CN.md`: version badge and "current release" line → v0.15.0; a new capability
  bullet for the skill corpus naming `cordis-dev` and its detection signals. Image alt texts untouched.
- `CHANGELOG.md`: new `## v0.15.0` section above v0.14.0 (English), grouped Changed / Added / Fixed with
  the guard split, the session-gate fix, the TUI badge + stateless deployment, `cordis-dev` and the QA
  repairs.
- `docs/tui.md` / `docs/tui.zh-CN.md`: preamble target REWRITTEN to dsh-tui **0.16.1** and pointed at
  §11.8 (the 0.14.0 narrative is kept as history); §11.8's "Was" cell corrected to 0.14.0 with its
  citation narrowed to the preamble. §11.6/§11.7 history untouched.
- `packages/mpd-tui-plugin/README.md` / `README.zh-CN.md`: "adapted to 0.16.1".
- `docs/user-guide.md` / `docs/user-guide.zh-CN.md`: §6 bullet on the restored guards and the delegation
  gate's preset scope; "seven write tools" → **eight** (the canonical deny list includes `bash`); §7.1
  names `tuiPanels` as the primary Agent Teams surface; new §7.1.1 on the attention badge, `panelAutoOpen`
  and the stateless ≥ 0.16.1 deployment.
- `docs/design.md` / `docs/design.zh-CN.md`: `mode: hard` dropped from the `mpd-verify` config column
  (diagnostic only); every `mpd-tools` `writeGuard` mention kept.
- New files: `RELEASE-v0.15.0.md` (bilingual, English first) and this report.

What the **second writer** owns (not touched by this lane): the documentation images, the three SVGs,
`docs/index.md` captions and the README image alt texts. At the time of writing, `team-lifecycle.svg` still
reads "seven write" (the plan's SVG correction was not yet applied) — the image writer's pass must land it
before the tag, together with the architecture row count and patch path and the refreshed captures under
`evidence/release/v0.15.0/ui-capture/`.

## Honest bounds

- The gateway (non-official) DeepSeek track cannot run on this host (`NO_ADAPTER` for provider
  `deepseek`), unchanged since v0.13.2. The official track and the Docker live rows are the model-reaching
  evidence.
- This lane ran ONLY `verify:docs`, `verify:manifest` and `typecheck`. Tests, QA self-tests, boot lanes,
  live cases, pack closure and both Docker lanes are placeholders above until the captain's sweep fills
  them; nothing in this report should be read as a pass for those rows.
- The one-click Docker lane grades the DEFAULT branch; run it after the master push, or state that it
  graded a local stand-in.
- `bun test` at the repo root scans historical `evidence/**` fixtures; the canonical gate is
  `.toolchain/node_modules/.bin/bun test packages`.
- The version/changelog commit carries no separate verifier seat (docs-only), as in v0.14.0.
- No git write command was run by this lane; nothing is committed. The tree carries one unrelated
  untracked path, `docker/ui/out/readme/`, which belongs to the UI-capture lane.
