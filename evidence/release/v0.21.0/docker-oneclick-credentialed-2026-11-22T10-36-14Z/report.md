# Credentialed one-click Docker lane — verification report

Verifier: agent-18 (Reviewer seat, findings-only; no source/doc/test/gate edits, no git writes).
One invocation of one arm. No retry.

## Anchors (before and after the run)

- Repo: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh` (main checkout)
- `git rev-parse --short HEAD` at run start = `3abf3e0a`
- `git diff | sha256sum` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  (SHA-256 of the EMPTY diff; tracked tree clean before and after)
- Pack re-cut: `node scripts/pack-mpd.ts` exit 0, staged `dist/mpd-package`. Tracked tree still clean after the pack and after the lane.
- **Post-run anchor (captain's commit, not mine):** repo HEAD is now `0c454ca8`
  (`chore(evidence): record the oneclick re-invocation and its fixture-binding figures`, 2026-11-22 18:59:16 +0800),
  a descendant of `3abf3e0a`. `git diff 3abf3e0a 0c454ca8 -- . ':(exclude)evidence'` is EMPTY
  (0 non-evidence files), and the code-tree hashes are identical (`packages`, `scripts`, `docker`,
  `presets`, `skills`, `package.json`, `cordis.patch.yml`). The commit carries 8 files of this evidence
  directory plus 12 files of `evidence/release/v0.21.0/docker-retry-oneclick-2026-11-22T10-23-48Z/`;
  `report.md` and `summary.json` were written after it and remain untracked for the captain to commit.

## Credential handling

`DEEPSEEK_API_KEY` was not in the environment. It was resolved from
`$HOME/.dsh/.credentials.yaml` (mode 600, `refs.DEEPSEEK_API_KEY`) and exported for the one command only.
It was forwarded by NAME through `docker compose ... -e DEEPSEEK_API_KEY`; the value was never printed,
logged, or written to any artifact under `evidence/`. The driver's argv echo shows the name only. Secret
scan of this run's artifacts: no `sk-…` match.

## The invocation (exactly once)

```
XDG_RUNTIME_DIR="$PWD/.qa-tmp/xdg" node scripts/docker-e2e.ts --mode oneclick --require-docker --live
```

- Started 2026-11-22T10:36:27Z, finished 2026-11-22T10:55:51Z (1156 s).
- Driver exit code: **0**. Container exit: 0.
- Docker mode: **ROOTLESS** (driver line: `[driver] docker mode: ROOTLESS (["name=seccomp,profile=builtin","name=rootless","name=cgroupns"])`).
- SKIP line: **none** (`grep -cE '^\[driver\] SKIP|^SKIP '` = 0). The only `skipped` text is the registry
  probe's internal `TARBALL=skipped reason=no-registry-knob`, not a lane skip.
- Driver evidence (left where the driver writes it): `evidence/docker/client-install-oneclick/2026-11-22T10-36-27Z/`
  (copied here under `driver-evidence/`).

## Stamps (verbatim)

- `harnessVersion` = `0.2.2-rc.5` (`facts.harnessVersion`; `facts.harnessVersionExpected` = `0.2.2-rc.5`;
  assertion `harness.version` raw = `0.2.2-rc.5`, ok=true).
- `tuiVersion` = `version=0.20.2 bin=/usr/local/bin/dsh-tui` (assertion `tui.hostInstall`, ok=true).
- Bundle under test: version `0.21.0`, 2 patch layers (`cordis.patch.yml,mpd.patch.yml`), rows=69.

## THE QUESTION — fixture binding, both runs side by side

FAILED run `evidence/docker/client-install-oneclick/2026-11-22T09-43-42Z` (exit 1), raw:

```
session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=
```

THIS run `2026-11-22T10-36-27Z` (exit 0), raw:

```
session=32dc54bd-878b-426b-9002-5b665bbb2b81 materialized=true attempts=2 source=created-during-this-boot-under-this-project-key projectKey=--work-ws-- index=/work/ws/.mpd/team/teams.json;active={"session-1ec40b4c-2295-400b-9a16-d3842a36ca37":"tui-scene","32dc54bd-878b-426b-9002-5b665bbb2b81":"tui-scene"};recordLeadSessionId=32dc54bd-878b-426b-9002-5b665bbb2b81;keySource=import:packages/mpd-team-core-plugin/src/team-store.ts#sessionKey resolve=store=/root/sandbox-dsh/sessions;before=3;after=4;created=--work-ws--/32dc54bd-878b-426b-9002-5b665bbb2b81
```

| figure | failed 09:43Z | this run 10:36Z |
|---|---|---|
| `materialized` | `false` | `true` |
| `attempts` | `4` | `2` |
| `source` | `none` | `created-during-this-boot-under-this-project-key` |
| `before` / `after` | `3` / `3` | `3` / `4` |
| `created` | *(empty)* | `--work-ws--/32dc54bd-878b-426b-9002-5b665bbb2b81` |

Both runs started from the SAME prior store size (`before=3`), with the SAME one-click layout and the same
live flags (`liveRequested=true`, browser lane on, credential staged into the sandbox in both). This run
created the session on the SECOND materialiser attempt (attempt 1 failed, as it does in every observed
bind), bound the fixture, and every dependent row went green.

## The six rows

| row | status |
|---|---|
| `tui.mergedPanelOpens` | **true** — `TITLE_HITS=1 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0` |
| `tui.mergedPanelOrder` | **true** — `TEAM_LINE=11` (subagent line 7 above team body) |
| `tui.teamSceneOpened` | **true** — `chars=11739` |
| `tui.teamGraphDrawn` | **true** — `corners=╭3 ╮3 ╰3 ╯3 tasksFromRecord=3 ids=T1,T2,T3` |
| `tui.teamGraphContent` | **true** — `missing=[none]`, `pinnedFocus=T1`, detail `[T1 · requirement · freeze the contract]` |
| `tui.laneExit` | **true** — `records=21` (the lane ran to completion with every assertion green) |

Precision note: in the failed run the six rows that were FALSE were the five drawing/panel rows plus
`tui.laneExit`; `tui.teamFixtureBound` was NULL and is the *cause* recorded on them, not a seventh false row.

## Install / mount / user-surface arms that must still hold

- `install.*` — 4/4 **true** (`install.exit`, `install.profileDep`, `install.installedTree`, `install.buildScripts`).
  The profile records the GIT spec pnpm resolved (published-package path), not a checkout link.
- `boot.presetMount` — **true**, with `agentPreset=mpd` verbatim:
  `POST /api/session/create -> {"type":"server-response","rpcId":"rpc-1-1795343979-9366","result":{"ok":true,"value":{"sessionId":"session-fdb2330f-9ef0-4d11-acde-a0c63d1c78d1","agentPreset":"mpd"}}}`
  (every row of the `mpd` preset activated; the preset refuses on an inactive row).
- `userSurface.*` — 120 rows: **85 true, 35 null, 0 false**. The 35 nulls are the case's own declared
  `NOT_PROVEN` bounds (`userSurface.row.*` preset-scoped rows with no individually observable witness);
  the driver's `unmeasured` list is empty. Nothing false.

## Counts

`passed=203 failed=0 null=41` (total 244), `ok=true`, `complete=false` (the 41 NULLs are declared bounds:
`build.*` / `pack.*` inapplicable in oneclick mode, `ui.teamBoard` not requested, 35 user-surface bounds).
Driver `requiredPrefixes` = `["userSurface.","live.","boot.llmTurn","ui."]`, excluded `["ui.teamBoard"]`,
`unmeasured=[]` → exit 0.

## Verdict

**PASS. The earlier exit 1 was a non-reproducible timing race — a race, not a one-click layout defect.**

Evidence: same HEAD/tree, same one-click install layout, same live flags, same `before=3` starting store;
the failed run exhausted `attempts=4` with `before=3;after=3;created=` (the session never appeared), while
this run bound at `attempts=2` with `before=3;after=4;created=--work-ws--/32dc54bd-…`. The one-click layout
can bind the fixture, and every `install.*` / `boot.presetMount` / `userSurface.*` arm holds in the same
run. The materialiser's first attempt fails in every observed run (both source arms and this oneclick run
bind at `attempts=2`), so the lane's green depends on its retry loop — this run's retry succeeded where the
failed run's budget ran out.

## Findings (no repairs applied)

- **Medium — the materialiser's retry budget is the only defence.** `docker/tui-lane.sh` (`SESSION_MATERIALIZE_ATTEMPTS`
  loop) sends `/mpd board` blindly and polls the session store up to 4 outer attempts (~36 s each), then the
  resolve poll (15 × 3 s). The first attempt fails in every observed run; the 09:43Z run exhausted the
  budget with zero store change (`before=3;after=3;created=`). Direction (not applied): drive the
  materialiser from a positive attach witness (the store append itself or a session-attached signal) or a
  store-driven deadline rather than a fixed attempt count, and keep the failure message as the honest
  `materialized=false` it already is.
- **Nit — `capture_pane boardOpened` cannot answer the question it was created for.** In
  `docker/tui-lane.sh` the capture runs AFTER the materialiser's closing `Escape` + sleep, so the artifact
  is the post-close chat screen: this run's pane shows the real chat frame (`dsh-TUI v0.20.2`, `/work/ws`,
  `⌸ ❯` composer, `mpd: 团队 - · 计划 0 · workmate 0`, `deepseek-flash · max · ws`), an EMPTY composer, and
  no `/mpd board` transcript/echo or error line. It rules out a TUI that never booted and a visible
  command error, but it cannot by itself separate "driven too early" from "the command did nothing".
  Direction (not applied): capture while the board is open (before the closing Escape), or add a second
  capture immediately after the first send.
- **Nit — the "pane is lost" premise is false.** Both runs' panes survive under
  `evidence/docker/client-install-oneclick/<stamp>/tui-panes/`: the failed run's
  `pane-boardOpened.txt` is 4618 bytes; this run's is 12362 bytes, copied here as `pane-boardOpened.txt`
  (sha256 `3d4d611f3371bfbe2898ec66c02e3f76f410e5f00caefafb2b14ec236cd887b7`). What does NOT survive is the
  lane's step log (`14-tui.log`) — the failed run's `tui-logs/` directory is empty.

## First lines of `pane-boardOpened` (this run; trailing padding trimmed)

```
                                            ✦ dsh-TUI  v0.20.2
                          ... (dsh-TUI ASCII banner) ...
              探索未至之境！
   ▶ （Ctrl+P 展开） 已加载上下文 · 系统提示词 19 段 · 运行时上下文 4 项 · 技能 20 · 工具 126
  mpd: 团队 - · 计划 0 · workmate 0
  ╭──────────────────────────────────────────────────────────────────────────────╮
  ⌸ ❯                                                                              ⛶
  ╰──────────────────────────────────────────────────────────────────────────────╯
   deepseek-flash · max · ws
```

## Declined to judge

- The pane's tool/prompt counts differ between the failed run (18 sections / 125 tools) and this run
  (19 / 126) — declined: the two runs' pane headers are not comparable evidence for the binding question,
  and no row attributes it to a failure.
- Quality/content of the live turn's model output — declined: the live rows are green and the subject is
  the fixture materialiser, not model prose.
- Browser-lane and user-surface case internals — declined: I read their result rows only, not their code.
- Root cause of the 09:43Z run beyond race/layout — declined: the container was removed and the lane's
  step log was not retained; the surviving pane and console output are consistent with a timing stall,
  not with a broken install layout.

## Bounds of this review

- Exactly ONE invocation; no retry, no second run, no `--live` run without the credential.
- The source arms were NOT run (per the task, they already exited 0); the credential-free regression run
  was not run.
- The container was removed by `docker compose run --rm`; residual artifacts are the evidence-mount copies
  (`tui-panes/`, `ui-shots/`, `user-surface/`), not a live container.
- Read for this review: both oneclick runs' `result.json` / `driver.json` / `console.log` / `tui-panes`,
  `scripts/docker-e2e.ts` (live-key guard, compose argv, required-arm exit), `docker/tui-lane.sh`
  (materialiser, bind probe, pane captures), `docker/docker-compose.yml`, `docker/entrypoint.sh` (TUI step
  wiring). Nothing was edited; no board/team verbs, no git writes.
- The two runs' image digests differ (the second build reused cache after the pack re-cut). The comparison
  is same-tree / same-lane / same-flags, not byte-identical images.
