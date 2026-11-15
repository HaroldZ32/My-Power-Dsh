# T3 — independent verification: DSH 0.2.2-rc.3 + DSH-TUI 0.20.1 (bundle 0.20.0)

- **Loop**: `loop-20261115T125058-d73d36`; verifier seat bound in this session (`mpd_verify_seat`), frozen
  doc = the contract.
- **Branch / HEAD**: `feature/dsh-022rc3-tui-0201`, base `f5cb9cda` + the wave's **settled, uncommitted**
  tree (39 modified tracked paths; newest edit `2026-11-15T13:00:09Z`, `.github/workflows/gates.yml`, a
  COMMENT-ONLY T4 correction).
- **Contract**: `.mpd/plans/adapt-dsh-022rc3-tui-0201.md` (§3 facts, §4 D1–D6, §5 T3, §6 bounds).
- **Seat**: Reviewer — independent verifier. Findings only; **nothing in this pass is a fix**.
- **Verdict**: **PASS** on every §D6 item measured below, with the bounds of §7 named honestly. The Docker
  pair was RUN in both modes on the re-cut pack; neither mode skipped.

Environment for every run (never the real `~/.dsh`; all anchors outside the checkout):

| What | Value |
|---|---|
| rc.3 harness anchor | `/home/haroldzhao/qa-anchors/rc3-t3-20261115T124238Z/host-rc3` — `dsh --version` = `0.2.2-rc.3` (nested global install) |
| rc.2 regression anchor | `…/host-rc2` — `0.2.2-rc.2` |
| TUI 0.20.1 host | `/home/haroldzhao/qa-anchors/dsh-022rc3-t3-20261115T124152Z/tui/node_modules/@deepseek-harness-tui/dsh-tui` (`0.20.1`) |
| dsh-Go kit | `.mpd/tmp-dshgo/kit` (`MPD_DSHGO_KIT`) |
| Pin toolchain | `.toolchain/node_modules/.bin/bun` = `1.4.0` (the Docker driver uses it; the local test sweep uses the NATURAL `bun`, §7.5) |

## 0. What this pass decided

§D6 in order: the eleven-member gate aggregate with the rc.3 harness on `PATH` and a discoverable 0.20.1
host; `bun test packages` + typecheck; the flat gates; BOTH web mount arms (rc.3 new, rc.2 regression);
the rc.3 + TUI 0.20.1 mount arm; BOTH Docker modes on the wave's re-cut pack; the three-coordinate rule;
and an independent re-derivation of the contract's §3 measured facts. Facts were judged against the
contract and the shipped docs, not against the implementation's narrative.

## 1. Settled tree and artifact

| Measurement | Value |
|---|---|
| Dirty tracked paths | **39**, all inside T1/T2/T4 declared scopes. **No `cordis.patch.yml`, no `presets/*.patch.yml`, no `packages/*/src/**`** — `git diff dev` over those paths is EMPTY → contract §2 non-goals hold (packaging-only) |
| Newest edit | `2026-11-15T13:00:09Z` `.github/workflows/gates.yml` (T4, comment-only; `git diff --stat` = 3 insertions / 2 deletions, no expression/value touched; `verify-workflows` exit 0). The wave's own edits stop at `12:51:25Z` (`CHANGELOG.md`) |
| Settle snapshot | `logs/final-settle.txt` — every dirty path + sha256, plus the settled bytes of `cordis.patch.yml`, `presets/mpd.patch.yml`, `package.json`, `specs/tui-hosts.json`, `.github/workflows/gates.yml` |
| Pack | `dist/mpd-package` re-cut **12:56:18Z**, `687` files / `20,278,185` B; packed `package.json`/`dsh-plugin.json`/`dsh-distribution.json` = **0.20.0**; packed `host-base …@0.2.2-rc.3`, `host-tui …@0.20.1`; packed `VENDOR_LOCK.json` **byte-identical** to the tree's (`sha256 eb5dfd7c…`; `skills.treeSha 9654c599…`, 393 files) |
| Pack closure | `node scripts/verify-pack-closure.ts` exit **0**: `674 file(s) compared, 674 identical, 0 drift, 0 expected-after-pack`; completeness `563/564 present, 1 declared exemption`; stamp `2026-11-15T12:56:18.905Z` |
| Three-coordinate rule | **PASS** — `specs/tui-hosts.json` = both manifests' `compat.hosts` = the identical sorted four-host set; the `host-tui` ref's coordinate `@deepseek-harness-tui/dsh-tui@0.20.1` is inside the admitted set; `host-base` = `@deepseek-ai/dsh-base@0.2.2-rc.3` inside `engines.dsh >=0.2.1-rc.5 <0.3.0-0`. `logs/three-coordinate-check.txt` |

**The pack had to be re-cut during this pass** (finding F1): at 12:53Z it was still the previous wave's
(`0.19.0`, packed lock `95c77ab0…` vs tree `eb5dfd7c…`). The captain assigned the re-cut as A4; T1 cut it
at 12:56:18Z, and both Docker modes then measured `pack.staticCoherence=true`.

## 2. Contract §3 fact-check — independently re-derived (not carried)

| Fact | Verdict | Evidence |
|---|---|---|
| F1 host layers still declare the team rows | **CONFIRMED** | `dsh-base/cordis.patch.yml:366-372` (`agent-team`, `config.maxTasks: 256`; `tool-agent-team`), `dsh-web-app/cordis.patch.yml:412-413` (`ui-agent-team`); none disabled |
| F2 `ctx.agentTeams` task-board-only | **CONFIRMED** | live service answers exactly `isEnabled,setEnabled,createTask,getTask,listTasks,updateTask` (all three arms); `dsh-tool-agent-team/src/index.ts` registers `team_task_create/list/get/update` |
| F3 `standard` preset unchanged; `tool-office` ACTIVE on rc.3 | **CONFIRMED** | `presets/standard.patch.yml` **byte-identical** rc.2↔rc.3; `tool-office` at `:130-131`; `@deepseek-ai/dsh-tool-office@0.2.2-rc.3` present → resolvable/ACTIVE, not a guarded NOTE |
| F4 no seam renamed; one new host package | **CONFIRMED** | package-set diff = exactly `+ @deepseek-ai/dsh-deepseek-chat-import`; no rc.3 upgrade-guide dir; the live boot resolves the probed seams and the mpd preset mounts |
| F5 `engines.dsh` admits rc.3 | **CONFIRMED** | `>=0.2.1-rc.5 <0.3.0-0`; rc.3 CLI declares only `engines.node >=24.9.0` |
| F6 rc.3 team-package source surface | **CLOSED, two independent methods** | T1 packed the rc.3 tarballs and measured byte-identity; this pass diffed the **installed** anchors: `dsh-agent-team/src` and `dsh-tool-agent-team/src` byte-identical rc.2↔rc.3 (`diff -r` empty). The STOP condition does not trigger |
| F7 peers widen, floor unchanged, one new optional peer | **CONFIRMED** | all 39 `@deepseek-ai/dsh-*` peers append `|| 0.2.2-rc.3`; `peerDependenciesMeta` gains `dsh-session-persistence-jsonl {optional:true}` |
| F8 TUI composition / seams / Ctrl+A contact | **CONFIRMED** | `cordis.patch.yml` byte-identical (28 top-level rows); all **15** real `tui*` seam declarations identical `file:line` (the 16th, `tuiPrompt`, is the documented phantom); `lib/types/ui.js` byte-identical, `useStdin` present |
| F9 `tuiMentions` new, not adopted | **CONFIRMED** | `mention-providers.d.ts:75`; bundle references it in **docs only** (no `.ts/.yml/.json`), seam set stays 15 |
| F10 TUI file sets; only the feed version moves | **CONFIRMED** | `presets/` identical; `tui-profile/` differs only in `feed/first-party.json` (`0.20.0`→`0.20.1`) and `feed/README.md` |

Carrier spot-checks (D1–D4): `host-base` rc.3, `host-tui` 0.20.1; four-host identical sorted sets in
`specs/tui-hosts.json` + BOTH manifests; version **0.20.0** in `package.json`/`dsh-plugin.json`/
`dsh-distribution.json` (all six self-urns) and `docs/market/dsh-go-entry.json`; Docker `DSH_VERSION`
defaults `0.2.2-rc.3` in `entrypoint.sh`, both composes and the UI lane (`MPD_UI_DSH_VERSION`); QA TUI
defaults/PREREQs and `scripts/mpd-tui-panels.ts` prose all read `0.20.1`; `.github/workflows/**` carries
no harness-version literal (both workflows derive from `host-base`, as §D1 predicted); `## 0.20.0`
CHANGELOG entry present; the EN and zh twins of every touched doc move together (`docs-parity` 61 pairs,
0 violations).

## 3. Static gates on the SETTLED tree (rc.3 on `PATH`, 0.20.1 host discoverable)

| Gate | Exit | Measured |
|---|---|---|
| `bun run verify:gates` (11 members) | **0** | **11/11 green** (`logs/final-verify-gates.log`) |
| `bun test packages` (NATURAL `bun`) | **0** | **4164 pass / 6 skip / 0 fail**, 4170 tests, 268 files, 42.27 s |
| `bun run typecheck` | **0** | no output |
| `verify-no-host-override` | **0** | PASS — 0 of 0 id-targets collide with **226** host-declared ids |
| `verify-manual-paths` | **0** | PASS — resolved=160, unresolved=0, over-report=72, under-report=84, declared=2 |
| `verify-dshgo-standard` | **0** | LEGAL — PIN 8/8, MANIFEST/VIEW/COMPAT/HOST PASS, CROSS-CHECK PASSED |
| `verify-dist-fresh` | **0** | 35/35 fresh (rebuilt twice), 1 documented NOT COVERED |
| `verify-vendor` | **0** | PASS — 8 shipped assets fingerprinted |
| `repin-vendor --check` | **0** | GREEN — drift=0, problems=0 (the wave's SINGLE re-pin) |
| `verify-pack-closure` | **0** | 674/674 identical, 0 drift (§1) |
| `preset-conformance --self-test` (aggregate member) | **0** | 33 harness rows conform (4 schema-free), mpd preset 29 children, parity **28/28**, 6/6 negative controls reddened |
| `docs-parity` (aggregate member) | **0** | pairs=61 failed=0 violations=0 links=638 dead=0 |
| `rows-parity` (aggregate member) | **0** | 37 row ids match the 2-file bundle patch |
| `comment-coverage` (aggregate member) | **0** | PASS — every declaration commented, full signatures |
| `workflows` (aggregate member) | **0** | PASS — 3 workflow files loadable, sane shape (T4's comment edit included) |
| `tui-admission` (aggregate member) | **0** | REPORT PASS — 49 arms, 1 allowed deviation, 5 bounds; discovered host **0.20.1**; `H.host PASS`, `COMPAT.host-version PASS` inside the four-host band; BOTH manifests negotiated `compatible` |
| `preset-conformance` LIVE lane, rc.3 | **0** | ours **29 declared / 28 active** vs reference **29/28**, `missing:[] extra:[]`; `sessionCreate` 200 `agentPreset=mpd`; boot signatures `[]`; negative control reddened (`logs/preset-conformance-rc3-real.log`; `evidence/dsh-qa/preset-conformance/2026-11-15T12-54-59.659Z/`) |
| `preset-conformance` LIVE lane, rc.2 | **0** | same **29/28 vs 29/28**, empty diff, session witness, red control (`…/2026-11-15T12-55-54.785Z/`) |
| `bun run test:qa` | **1** | **56/58 pass, 2 red — DECLARED BOUND, not this wave's** (§7.6): `dual-track-smoke.ts` (`devPatch left a packed/self-row operand`) and `preset-register.ts` (`devFlavor left the packed @mpd-dsh/mpd operand or a baseUrl concat in cordis.patch.yml`). Both scan `cordis.patch.yml`, which this wave does **not** touch (`git diff dev` empty), and no CI workflow runs `test:qa`; provenance `80c6f5c6`, follow-up `fix/qa-selftest-needle` (`logs/final-test-qa.log`) |

## 4. Mount arms — live loader probe, BOTH generations (re-run on the settled tree)

Each arm: fresh isolated `DSH_HOME`/`HOME`/workspace under the anchor (outside the checkout),
`dsh plugin --profile t3 add <checkout>` exit 0, `--dump-config` 136 top-level rows, then a **real boot**
with a QA probe plugin inserted by `--patch` (`<anchor>/t3-mount-probe.mjs`, outside the tree) reading the
LIVE loader entry state and `ctx.agentTeams`:

| Watched row | rc.3 arm (`mount-rc3-final/`) | rc.2 arm (`mount-rc2-final/`) |
|---|---|---|
| `agent-team` (HOST) | `disabled: null` (enabled) — **active: true** | same |
| `tool-agent-team` (HOST) | `disabled: null` — **active: true** | same |
| `mpd-agent-team` (bundle) | **`disabled: true` — active: false** | same |
| `mpd-tool-agent-team` (bundle) | **`disabled: true` — active: false** | same |
| `mpd-ui-agent-team` (bundle) | **`disabled: true` — active: false** | same |
| `ctx.agentTeams` | **present**, 6/6 methods | present, 6/6 |
| "already registered" / "has been registered" | **0** | **0** |
| other activation warnings | the ONE `preset-mpd … pending (waiting for service: agentPresets)` of a session-less web boot — pre-existing; no session exists to materialize the preset | same |

Guard line, verbatim from each sandbox (`mount-*-final/guard.log`):

```
[mpd-team-rows] generation guard: generation=new source=argv1 argv1=…/host-rc3/bin/dsh harness=0.2.2-rc.3@… oldRows=disabled newRows=enabled override=-
[mpd-team-rows] generation guard: generation=new source=argv1 argv1=…/host-rc2/bin/dsh harness=0.2.2-rc.2@… oldRows=disabled newRows=enabled override=-
```

On **rc.3** the bundle mounts **ZERO team rows** (all three disabled AND inactive) and the **HOST plane is
enabled** (both host rows active; `agentTeams` answering six methods). The **rc.2 regression arm is
UNCHANGED**: same five row states, same six-method service, `generation=new`. The **rc.1 arm was NOT
re-run** (contract §D6: "plus the rc.1 arm untouched").

## 5. rc.3 + TUI 0.20.1 mount arm, and the TUI composition

**Real TTY lane** (`tui-mount`, tmux, `XDG_RUNTIME_DIR` writable), exit **0**
(`logs/tui-mount-rc3-0201-retry.log`; lane evidence `evidence/tui/lanes/2026-11-15T12-50-33.366Z/`):

- host install `@deepseek-harness-tui/dsh-tui@0.20.1` exit **0**; bundle install exit **0**;
- `dsh.profile.bundles` = **`[dsh-base, dsh-tui, @mpd-dsh/mpd]`** — triple layer in order;
- `mpd-tui` row composed; status line **`mpd: 团队 - · 计划 0 · workmate 0`** rendered, counters rendered;
- **zero apply-crash signatures**; zero isolation offenders;
- guard log inside the sandbox: `[mpd-agent-team] DISABLED in a dsh-tui composition …` and
  `[mpd-team-rows] … oldRows=disabled newRows=disabled` (`tui-composition/mpd-patch-guards.log`);
- **AC-11 DECLARED BOUND**: the keystroke-free boot flushed no session store (`freshSandboxSessions=0`),
  so `presetWitness:"not-materialized"`; the rc.3 mpd-preset session witness is §3's live
  `preset-conformance` lane instead.

**Live row state inside the TUI PROFILE composition** — the same probe booted on the TUI profile
(`logs/tui-profile-probe.log`, `mount-tui-probe.json`):

```
agent-team             disabled=null  active=true
tool-agent-team        disabled=null  active=true
mpd-agent-team         disabled=true  active=false
mpd-tool-agent-team    disabled=true  active=false
mpd-ui-agent-team      disabled=true  active=false
ctx.agentTeams         present, 6/6 methods
```

**TUI seams**: the adapter's apply-time log line says `TUI_SEAMS=(none composed)` because every seam is
bound LAZILY (one deferred inject per seam) — that line is an apply-time snapshot, not a verdict. The
binding witnesses this arm carries: the rendered keyed status line (a `tui*` surface), and
`tui-composition/mpd-tui-panels.json` with `"readBack": "tuiPanels.list"`, `"hostVersion": "0.20.1"`,
`"activation": "session"`; plus zero crash signatures. **Declared bound**: this arm does not enumerate a
bound-seam COUNT; it witnesses render + panels read-back + a clean boot. The adapter log's "no DSH-TUI
service is composed (web composition?)" line is printed even in the TUI composition because of the lazy
binding — pre-existing phrasing, outside this wave's change set (finding F3).

**Environment bound that first produced a FALSE red** (finding F5): the first TUI attempt ended
`requested-host-install-refused` — pnpm 12 puts its store-operation lock in `XDG_RUNTIME_DIR` and this
sandbox mounts `/run/user/1000` **read-only** (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK … Read-only file
system (os error 30)`). With a writable `XDG_RUNTIME_DIR` the SAME command installed cleanly and the arm
passed. Both logs are kept (`logs/tui-mount-rc3-0201.log` red, `…-retry.log` green); the red is
environment, not the host pair.

## 6. Docker real-machine lane — BOTH modes on the re-cut pack (LAST step)

Command, pinned toolchain, rootless daemon present (`docker info` reports `rootless`):

```
.toolchain/node_modules/.bin/bun run verify:docker --mode <source|oneclick> --require-docker --no-browser
```

| Mode | Stamp | Driver exit | Facts |
|---|---|---|---|
| `--mode source` | `evidence/docker/client-install/2026-11-15T12-57-46Z/` | **0** | harness installed/expected **0.2.2-rc.3**; summary `total 244, passed 163, failed 0, null 81, failedNames []`; `pack.present=true` (687 files / 20,258,224 B at the time of the run), **`pack.staticCoherence=true (drifted=none untwinned=none)`**, `pack.distFreshRebuild` true under the pinned `bun 1.4.0` with its mutating CONTROL (`controlVerdict=false`), `pack.licenceCoherence/declarationCoherence` true; `install.exit=0 spec=.`; `boot.teamRowGenerationLive` = `generation=new … harness=0.2.2-rc.3`; `boot.agentTeamTools=4/4 generation=task-board-only`; `boot.agentTeamService=MOUNTED serviceName=TeamService methods=createTask,getTask,listTasks,updateTask`; `boot.mpdTools=6/6`, `boot.mcpTools=3/3`, live MCP search `ok:1` with control `ok:0`; `boot.servesHttp` 200, `boot.presetMount` `agentPreset=mpd`, `boot.noFatalSignatures` 0; TUI plane: host 0.20.1 installed, `tui.pluginAddHost/AddBundle/compose` 0, `preset-mpd` + `mpd-tui` composed, `tui.teamFixtureBound` + `tui.teamSceneOpened/Graph*/Content` PASS, `tui.hostDashboardKeyIntact`; **user-surface arm ran in this mode** (69 rows, `userSurface.findings=-`, negative control, `rowsWitness` 35 declared-bound / 9 loader-active / 2 disabled-by-design / 14 sink / 9 registration) |
| `--mode oneclick` | `evidence/docker/client-install-oneclick/2026-11-15T13-06-23Z/` | **0** | harness installed/expected **0.2.2-rc.3**; summary `total 244, passed 162, failed 0, null 82, failedNames []`; `pack.present=true`, **`pack.staticCoherence=true (drifted=none untwinned=none)`**; `install.exit=0 spec=git+file:///opt/oneclick.git` (the ONE-COMMAND install) with `install.buildScripts` clean; `boot.teamRowGenerationLive` = `generation=new … harness=0.2.2-rc.3`; `boot.agentTeamTools=4/4 generation=task-board-only`; `boot.agentTeamService=MOUNTED TeamService`; `boot.noFatalSignatures` 0; TUI plane host **0.20.1** installed, `preset-mpd` + `mpd-tui` composed, the three official rows composed; **user-surface arm ran** (69 rows, `userSurface.findings=-`). The three SOURCE-ONLY pack rows (`distFreshRebuild`, `rebuildToolchain`, `distFreshRebuildControl`) are **NULL by design** here — the driver's own self-test asserts "with no rebuild both pack rows are null, never a green that measures nothing" (`scripts/docker-e2e.ts:1217`), and the previous wave's green oneclick run carries the identical `nullNames` |

Neither run is a SKIP: the driver's own `[driver] evidence -> …` line names each stamp, `--require-docker`
would have exited 3 on a skip, and the required user-surface arm ran. `complete:false` in `result.json` is
the driver's completeness flag over NULLS: 81 of 244 assertions are DECLARED BOUNDS (e.g. preset-owned
rows composed-not-individually-proven, no live LLM turn without credentials) — the same shape every prior
green run records; `ok:true` and `summary.failedNames:[]` are the verdict.

### 6.1 `--mode oneclick`

**BOTH modes measured GREEN on the re-cut pack**, `summary.failedNames:[]` in each, and the one distinct
difference between the modes is BY DESIGN: `--mode oneclick` installs from the packed artifact
(`git+file:///opt/oneclick.git`), so the three source-only rebuild rows are NULL (`ok:None`) rather than
green — the driver's self-test pins exactly that ("with no rebuild both pack rows are null, never a green
that measures nothing"), and the previous wave's green oneclick run has the identical `nullNames`.
`pack.staticCoherence=true` in BOTH modes is the fact that the re-cut pack agrees with the tree.

## 7. Bounds of this pass (declared, never counted as passes)

1. **The verify plane cannot run a repo gate from this session.** `mpd_verify_evidence {kind:"gate"}`
   resolves the workspace to `/home/haroldzhao` (this session's workspace), so `gate:"typecheck"` ran
   `bun run typecheck` THERE and exited 1 (`error: Script not found "typecheck"`). The §3 numbers come from
   the real commands run in the checkout and their logs, not from a plane gate id; therefore the PASS
   **record** cannot cite gate evidence from this seat. Same plane bound T23 recorded last wave.
2. **`/run/user/1000` is read-only here**; any `dsh plugin add` needs a writable `XDG_RUNTIME_DIR`
   (finding F5). Environment, not the bundle.
3. **CI both workflows is not observable yet** — the branch is not pushed, so no run exists. The §D1
   prediction is confirmed at source level (no harness literal in `.github/workflows/**`, both derive from
   `host-base`) and `verify-workflows` is green; the runs themselves are the PR's.
4. **The rc.1 arm was not re-run** per §D6; the 0.2.1-rc.5 arm is outside this wave's claim set.
5. **`bun test packages` is judged on the NATURAL `PATH`** (`4164/6/0`). Prepending
   `.toolchain/node_modules/.bin` flips `mpd-mcp-shared/bin-resolve.test.ts` (the deprecated `sg` wrapper
   prints an upgrade banner) — an INVOCATION artifact, not the tree; the settled sweep used the natural
   PATH and both this pass and T1 measured `4164/6/0`.
6. **`test:qa` 56/58 is a DECLARED BOUND, not a §D6 pass.** The two reds
   (`dual-track-smoke.ts`, `preset-register.ts`) scan `cordis.patch.yml` text, and this wave does NOT
   touch that file (`git diff dev` empty), so the wave's diff cannot produce them; provenance `80c6f5c6`
   (a coarse needle vs the three generation-guard blocks), no CI workflow runs `test:qa`, follow-up
   `fix/qa-selftest-needle`. Measured result kept in `logs/final-test-qa.log`.
7. **Docker `complete:false` with 81 NULL assertions** is the driver's declared-bound shape (§6); not a
   failure; `ok:true` + `failedNames:[]` is the verdict.
8. **The TUI composition does not enumerate a bound-seam count** (§5) and its AC-11 preset witness is
   `not-materialized`; the mpd-preset session witness is the live `preset-conformance` lane.
9. **`tuiMentions` is NOT adopted** — a new host capability is optional (contract §6); docs declare the
   bound.

## 8. Findings (ranked; findings only — nothing here is a fix)

| # | Severity | What / where | Why it matters | Direction of a fix |
|---|---|---|---|---|
| F1 | **Medium (process; CLOSED mid-pass as A4)** | The §5 task table named **no owner** for `dist/mpd-package/**`, while §D6 requires Docker "on the wave's re-cut pack". At 12:53Z the pack was still the previous wave's (`0.19.0`, packed `95c77ab0…` vs tree `eb5dfd7c…`). | T-88: a derived surface no task owns is a §D6 arm with no executor; a stale pack reddens the Docker lane in BOTH modes (`pack.staticCoherence` — the previous wave's T21-F1 failure). | Captain assigned A4 to T1; the pack was re-cut at 12:56:18Z and both modes then measured `staticCoherence=true`. Future waves: declare `dist/mpd-package/**` on the integration task at CREATION. |
| F2 | **Nit (contract accuracy)** | Contract F6 says rc.3's team-package "SOURCE is not on this disk". It IS: the installed package ships `src/`. | The stated method (pack + diff) was unnecessary; the STOP condition is still correctly evaluated by two independent methods, both byte-identical. | No action this wave; note in the next plan that the published tarballs carry `src/`. |
| F3 | **Nit (diagnostic phrasing, pre-existing)** | `cordis.patch.yml`'s generation guard logs `newRows=enabled` although the bundle ships no `-rc2` team row (`grep -nE "id: mpd-.*-rc2"` empty); the TUI-plane path prints "no DSH-TUI service is composed (web composition?)" because seams bind lazily. | Either line can mislead a reader into thinking a second row set mounted or the TUI plane was skipped. The LIVE results are correct in all three arms. | A future non-packaging change may relabel the log and delete the dead branch; NOT this wave (no patch-row change by contract). |
| F4 | **Nit (doc understatement)** | `docs/tui.md` §11.16 says "No **live TTY capture** of `0.20.1` is claimed". | Understatement, not an overclaim: §5 now supplies that capture (triple layer + rendered status line + zero crash signatures). Safe as written. | Optional: T2 may cite §5 in a follow-up; nothing blocks the release. |
| F5 | info (environment) | `/run/user/1000` read-only → pnpm store lock EROFS → `dsh plugin add` refused. | Produced a FALSE red on the TUI arm until identified; every install/mount lane in this sandbox needs `XDG_RUNTIME_DIR`. | Bound recorded; workaround used and the green re-run kept. |
| F6 | info (plane) | The `mpd_verify_*` plane's workspace is `$HOME`, not the checkout. | A PASS record needs a gate evidence id; the numbers are real but the plane cannot mint one from this seat. | Record from a repo-workspace seat or accept this artifact as the §D6 evidence (as last wave). |

**Declined to judge** (named so nothing is silently dropped): the real `~/.npmrc` carries an npm auth token
(out of scope; unused by these lanes and masked here); CI runs (not pushed yet); the release/publish step
(`npm stage approve` is human); the rc.1 and 0.2.1-rc.5 arms (untouched / outside the claim set); T1's
packed-tarball F6 method's internals (independently reproduced instead); Docker user-surface internals
beyond the driver's recorded facts; the `test:qa` two reds' repair (a different branch).

## 9. Verdict

**PASS.** On the settled tree and the re-cut pack, every §D6 item measured in this pass is green:
`verify:gates` **11/11** with rc.3 on `PATH` and a discovered 0.20.1 host (admission negotiated BOTH
manifests `compatible`, the 0.20.1 host inside the four-host band, `tool-office` ACTIVE on rc.3);
`bun test packages` **4164/6/0**; typecheck, no-host-override, manual-paths, dshgo, dist-fresh, vendor, the
single vendor re-pin and pack closure all exit **0**; BOTH web mount arms measured LIVE with the bundle
mounting **ZERO team rows** and the **HOST plane active** (rc.3 and the unchanged rc.2 regression arm, no
"already registered"); the rc.3 + TUI 0.20.1 arm mounted the triple layer in a real TTY and rendered its
status line with zero crash signatures; and the Docker pair ran on the re-cut pack with
`pack.staticCoherence=true` in both modes. The bounds in §7 are stated as bounds — a SKIP is never a
pass, and nothing is certified that was not run.

## 10. Evidence index (under `evidence/verify-022rc3/2026-11-15T12-45-50Z/`)

| Path | What |
|---|---|
| `logs/final-verify-gates.log` | the settled eleven-member aggregate, exit 0 |
| `logs/final-tests.log`, `logs/final-typecheck.log` | 4164/6/0 on the natural PATH; typecheck exit 0 |
| `logs/final-{no-host-override,manual-paths,dshgo,dist-fresh,vendor,repin-check,pack-closure}.log` | the flat gates, all exit 0 |
| `logs/final-test-qa.log`, `…-exit.txt` | the carried `test:qa` bound (§7.6) |
| `logs/final-settle.txt` | settled tree: every dirty path + sha256, key untouched files, pack bytes |
| `logs/three-coordinate-check.txt` | the three-coordinate rule, PASS |
| `logs/preset-conformance-rc{3,2}-real.log` | live preset lanes: parity 28/28, mpd session witness, red control |
| `logs/tui-mount-rc3-0201.log` / `…-retry.log` | TUI arm red (environment) / green |
| `logs/tui-profile-probe.log`, `mount-tui-probe.json` | live row state in the TUI profile composition |
| `logs/docker-source.log`, `logs/docker-oneclick.log` (+ `-exit.txt`) | the Docker pair (§6) |
| `mount-rc3-final/`, `mount-rc2-final/` | `probe.json` (live rows/service), `boot.log`, `env.log`, `dump-config.yml`, `guard.log`, `team-rows.txt` |
| `tui-composition/` | `mpd-tui.log`, `mpd-tui-panels.json`, `mpd-patch-guards.log`, `mpd-dsh-adapter.log`, `mpd-team-core.log` from the TUI sandbox |
| `evidence/tui/lanes/2026-11-15T12-50-33.366Z/` | TUI lane result + pane captures |
| `evidence/dsh-qa/preset-conformance/2026-11-15T12-54-59.659Z/`, `…12-55-54.785Z/` | live preset lane stamps |
| `evidence/docker/client-install/2026-11-15T12-57-46Z/`, `evidence/docker/client-install-oneclick/2026-11-15T13-06-23Z/` | the two Docker stamps |
