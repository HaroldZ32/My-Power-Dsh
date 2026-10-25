# Wave report — adapt @mpd-dsh/mpd to DeepSeek Harness 0.2.1-rc.3 + dsh-tui 0.17.0 (v0.15.5)

Task: team T1 (`kind: work`, owner `senior-engineer`). Contract: `.mpd/plans/adapt-021-rc3-tui-017.md`
(FROZEN). Writer ran on 2026-10-25 (UTC stamp of this directory). No git write was performed — the
captain commits (§5: one git writer).

## 1. What changed (file by file)

### §1 — release identity 0.15.4 → 0.15.5
| File | Change |
|---|---|
| `package.json` | `version` 0.15.4 → 0.15.5 |
| `dsh-plugin.json` | `version` 0.15.4 → 0.15.5 |
| `dsh-distribution.json` | `distribution.version` 0.15.4 → 0.15.5, AND all **6** self-urn refs (`distribution@`, `plugins@`, `mcp-servers@`, `skills-corpus@`, `web-client@`, `tui-edition@`) |
| `README.md` / `README.zh-CN.md` | version badge `0.15.4` → `0.15.5`; "the current release is **vX.Y.Z**" sentence |
| `CHANGELOG.md` | NEW top entry `## v0.15.5 — …` (no plugin source changed; both host versions named; the README table announced; `@dsh-std/sdk` left alone) |

Note: `dsh-plugin.json`'s `x-mpd-tui-surfaces.note` prose still says "(version 0.15.1)" — a STALE
pre-existing sentence that is NOT one of §1's carriers and NOT a self-urn. Left untouched on purpose
(see §5 "deliberate non-edits"); the verifier may classify it.

### §2 — harness pin 0.2.1-rc.2 → 0.2.1-rc.3
| File | Change |
|---|---|
| `package.json` | the three `@deepseek-ai/dsh-experimental-*` dependencies → `0.2.1-rc.3` |
| `bun.lock` | regenerated with the PINNED toolchain (`./.toolchain/node_modules/.bin/bun` = **1.4.0**): 7 lines — the 3 deps, their 3 resolution rows, `@deepseek-ai/dsh-brand` (the one real transitive dependency). Peer lists inside the lock now name rc.3; peers are host-provided and are not installed |
| `README.md` / `README.zh-CN.md` | DeepSeek Harness badge `0.2.1--rc.2` → `0.2.1--rc.3`; known-limitations sentence "tested against **0.2.1-rc.3**" |
| `AGENTS.md` | §8 `dsh-better-sidebar` note: "(this repo pins 0.2.1-rc.3)" |
| `docs/user-guide.md` + `.zh-CN.md` | better-sidebar note "pins `0.2.1-rc.3`"; §14.1 DSH-STD exemption example `--dsh-version 0.2.1-rc.3` + the "baseline is dsh `0.2.1-rc.3`" sentence (the `@dsh-std/adapter-dsh@0.1.1-rc.2` pin itself is UNCHANGED — separate community line) |
| `docs/development.md` + `.zh-CN.md` | "(this repository pins `0.2.1-rc.3`)" |
| `docker/README.md` + `.zh-CN.md` | step 5 default pin; the TUI step's target rationale |
| `presets/mpd.patch.yml` | the FOUR comments (lines 82, 170, 217, 385): `0.2.1-rc.2` → `0.2.1-rc.3` |
| `docker/entrypoint.sh` | `DSH_VERSION` default + comment |
| `docker/docker-compose.yml` | header comment, `mpd-client` block, `mpd-oneclick` block (two services) |
| `docker/ui/docker-compose.yml` | `MPD_UI_DSH_VERSION: "0.2.1-rc.3"` |
| `docker/ui/entrypoint.sh` | `npm i -g @deepseek-ai/dsh@${MPD_UI_DSH_VERSION:-0.2.1-rc.3}` |

CI needed no edit, as the contract predicted: `.github/workflows/gates.yml:86` derives
`HARNESS_VERSION` from `package.json`'s `dependencies['@deepseek-ai/dsh-experimental-agent-team']`, so
the rc.3 pin flows through automatically (checked, not assumed).

### §3 — TUI pin 0.16.1 → 0.17.0
| File | Change |
|---|---|
| `dsh-plugin.json` | `compat.hosts` → `@deepseek-harness-tui/dsh-tui@0.17.0` |
| `dsh-distribution.json` | `host-tui` ref → `pkg:npm/@deepseek-harness-tui/dsh-tui@0.17.0` |
| `docker/entrypoint.sh` | `TUI_VERSION` default 0.17.0 + comment (0.17.0 = first host whose declared peers include harness 0.2.1-rc.3, 36 of 39) |
| `docker/tui-lane.sh` | `TUI_VERSION` default 0.17.0 + comment |
| `docker/docker-compose.yml` | `MPD_E2E_TUI_VERSION` in both services |
| `docker/ui/docker-compose.yml` | `MPD_UI_TUI_VERSION: "0.17.0"` |
| `docker/ui/entrypoint.sh` | the TWO defaults (`npm i -g …` and `dsh plugin … add …`) |
| `skills/dsh-qa/scripts/tui-mount.ts` | `TUI_HOST_SPEC` default → `"0.17.0"`; PREREQ remedy; a NEW top "MOVED 0.16.1 -> 0.17.0 (2026-10-25)" docblock entry (the 0.15.0→0.16.1 entry kept as history) |
| `skills/dsh-qa/scripts/lib/tui-lane.ts` | header comment + `tuiPrereqs()` remedy |
| `skills/dsh-qa/scripts/install-dependencies.ts` | TUI closure `remedy` |
| `skills/dsh-qa/scripts/tui-admission.ts`, `tui-deps-ctrla.ts`, `tui-keeper-standdown.ts` (2), `tui-panels.ts`, `tui-team-surface.ts` (2) | PREREQ remedy strings + the "installed 0.17.0 host" case sentence |
| `skills/dsh-qa/SKILL.md` | the `tui-keeper-standdown` row: "installed 0.17.0 host" |

### §5 — the README version-correspondence table (the user's explicit deliverable)
One new `## Version compatibility` section (zh: `## 版本对应关系`) in BOTH `README.md` and
`README.zh-CN.md`, placed immediately after Install and before Quick start, carrying the six rows
0.15.5 → 0.14.0 and the statement of what a row means (the pair a release was BUILT AND VERIFIED
against; harness pin in `package.json`, TUI pin in `dsh-plugin.json` + `dsh-distribution.json`; a newer
host is not claimed until a release row names it; pin both). Every cell was re-derived from its release
tag — raw sweep saved as `02-tag-sweep.txt` — and the sweep CONFIRMS every row of contract §5 (no cell
correction was owed). Relative links `./package.json`, `./dsh-plugin.json`, `./dsh-distribution.json`
resolve in both languages (docs gate, below).

### §4 invariants — deliberately NOT touched (each verified present and unchanged)
`dsh-plugin.json` `manifestVersion`/`$schema` (0.15); `PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"` and
`PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"` plus the `hostVersion` fixtures (0.14.0/0.15.0/0.16.0/0.17.0);
the "on dsh-tui >= 0.16.1 …" range statements (`docs/user-guide.md:454` + zh twin, `docs/tui.md` §6.2);
historical measurements (`docs/tui-dag-renderer.md` + zh, `agent-references/troubleshooting.md:83`,
`docker/tui-lane.sh`'s "measured 2026-10-14 on dsh-tui 0.15.0", the dated 2026 lines in
`docker/entrypoint.sh`, `docs/plan-webui-tui-i18n.md`, `CHANGELOG.md` history); `packages/*/src/**`,
`packages/*/dist/**`, `dist/**`, `VENDOR_LOCK.json`, `evidence/**`. `@dsh-std/sdk` stays `0.1.1-rc.2`.
`scripts/verify-plugin-manifest.ts:708` is a self-test MUTANT (`pkg:` ref out of scope) — untouched.

## 2. Gates run — observed results (logs in this directory)

| # | Command | Exit | Observed |
|---|---|---|---|
| 20 | `node scripts/verify-plugin-manifest.ts --pack` | **0** | `VERDICT: PASS`; version = 0.15.5 in both carriers; **6 self-urn refs, 0 stale**; 28 module paths, 0 missing; `npm pack --dry-run` lists 1044 files, 0 required absent |
| 21 | `node scripts/verify-docs-parity.ts` | **0** | `pairs=50 failed=0 violations=0 dead=0` — the new bilingual section + its 3 relative links pass |
| 22 | `node scripts/verify-rows-parity.ts` | **0** | 36 row ids match the 2-file patch layer |
| 23 | `node scripts/verify-no-host-override.ts` | **0** | `PASS: every id-target is bundle-owned (0 of 0 collide with the 213 host-declared row ids)`; 4 host layers on disk |
| 24 | `node scripts/verify-manual-paths.ts` | **0** | `PASS resolved=153`; AGENTS.md edit audited (no unresolved path) |
| 25 | `node scripts/install-profile.ts --dry-run` | **0** | `DRY-RUN done (nothing written)`; the composed rows resolve |
| 26 | `node scripts/verify-vendor.ts` | **1 (EXPECTED)** | `FAIL - asset skills treeSha mismatch` — the `skills/**` carriers of §3 invalidated the corpus treeSha; the captain's single `repin-vendor` is the fix (§9). NOT fixed here |
| 27 | `node scripts/run-qa-selftests.ts` with `TMPDIR=<ws>/.mpd/tmp/qa` | 1 (ENVIRONMENTAL) | see "bounds": the ONLY red bullet was `install-dependencies.ts` → `DSH_HOME/HOME must never point into the real home` |
| 27b | `node scripts/run-qa-selftests.ts` (default `TMPDIR=/tmp`) | **0** | `[test:qa] all self-tests passed` — 51 cases; proves 27's red was my TMPDIR override, not the edit |
| 28 | `node scripts/verify-comment-coverage.ts` | **0** | 444/444 files, 39790 declarations; `VERDICT: PASS` |
| 29 | `node_modules/.bin/tsgo --noEmit` | **0** | no diagnostics (the skills `*.ts` edits type-check) |
| 10 | `bun install` (pinned 1.4.0) | **0** | `+ @deepseek-ai/dsh-experimental-{agent-team,client-ui-agent-team,tool-agent-team}@0.2.1-rc.3`; `Saved lockfile`; `5 packages installed` |

Extra, beyond §6: 27/27b (`test:qa`), 28 (`verify:comments`), 29 (typecheck) were run because the wave
edits `skills/**/*.ts`, which both of those standing gates cover.

## 3. Bounds — what this evidence does NOT prove

1. **No host was booted.** This is a pin-and-documents wave (contract §0: no code adaptation owed). No
   real DSH 0.2.1-rc.3 mount, no real dsh-tui 0.17.0 PTY boot, no tool-call verification. The Docker
   real-machine lanes (`docker-e2e.ts`) were NOT run: they carry the new defaults but running them is
   the release sweep's LAST step (§4/§11), not this task's DoD. **The user's "本机版本较老，用 docker 做
   验证" is therefore NOT yet satisfied by T1** — it needs the release-sweep Docker lane.
2. **`verify:vendor` is RED by construction** until the captain re-pins. I am this wave's single
   `skills/**` writer and did NOT run `repin-vendor` (it refuses without the captain flag).
3. **`node_modules` was refreshed** by `bun install` (gitignored) — the three experimental packages are
   now rc.3 on disk; peer host packages were not installed by this repo and are supplied by the profile.
4. **test:qa under a workspace TMPDIR cannot pass in this session** (the sandbox forces temp inside the
   workspace, which sits under the real `HOME`, so `install-dependencies`' sandbox-path assertion fires
   by construction). Run 27b with the default `/tmp` is the real result.
5. Not run (not required by §6, and out of scope): `bun test packages`, `verify:dist-fresh`
   (no `packages/**` changed), `verify:pack-closure` (no pack was made), `preset-conformance` real
   mount, `docker-e2e` (above), `scripts/repin-vendor.ts` (captain's), `pack-closure`.
6. No browser render, no screenshot, no UI claim is made by this wave.

## 4. Environment notes (reproducibility)

* The first `bun install` failed with `bun is unable to write files to tempdir: EROFS` (the DSH
  workspace-write sandbox denies bun's tempdir). Retried with
  `TMPDIR=<ws>/.mpd/tmp/bun-tmp BUN_INSTALL_CACHE_DIR=<ws>/.mpd/tmp/bun-cache` — the log in
  `10-bun-install.log` is that successful, pinned-toolchain run (`bun install v1.4.0 (34cbb9a40)`).
* Gate commands are run with the repo's own `node`; `bun run <script>` is not needed for any of them.

## 5. Deliberate non-edits / findings for the Lead (outside the frozen carrier lists)

1. `dsh-plugin.json` → `x-mpd-tui-surfaces.note` says "(version 0.15.1)" — stale prose, not a self-urn
   and not one of §1's carriers. NOT touched (minimal diff); it will read stale after this release.
2. `AGENTS.md:507` — "LIVE on the registry at **0.15.4** (measured 2026-10-25)" is a REGISTRY
   measurement, not the package version carrier. 0.15.5 is not published by this wave, so the sentence
   is still true today; it becomes stale at publish time. NOT touched.
3. `scripts/verify-plugin-manifest.ts:708` keeps `dsh-tui@0.16.1` inside a self-test MUTANT fixture
   (explicitly "a `pkg:` ref is out of scope by design") — a gate fixture, NOT a carrier.
4. The doc/CHANGELOG references to 0.16.1 / 0.2.1-rc.2 that remain are HISTORY: the 0.16.1 peer-band
   statements (docker lanes, `docs/tui.md` §11.8 preamble twin), the 0.15.x/0.14.0 earlier-pin lists,
   `docs/tui-dag-renderer.md`'s declaration reads, `agent-references/troubleshooting.md:83`, the
   CHANGELOG's older sections, and the README table rows themselves.
5. `docs/tui.md` gained a §11.10 amendment (both languages) rather than editing §11.8's dated table,
   because §4 freezes historical measurements; §11.8's own text is unchanged.

## 6. Evidence index (this directory)

`00-inventory-before.txt` · `01-inventory-after.txt` · `02-tag-sweep.txt` · `10-bun-install.log` ·
`20-verify-manifest.log` · `21-verify-docs.log` · `22-verify-rows.log` ·
`23-verify-no-host-override.log` · `24-verify-manual-paths.log` · `25-install-profile-dry-run.log` ·
`26-verify-vendor.log` · `27-test-qa.log` · `27b-test-qa-default-tmp.log` · `28-verify-comments.log` ·
`29-typecheck.log` · `REPORT.md`.
