# Docker real-machine lane — my-power-dsh v0.21.0

- Verdict: **FAIL** — run 2 (oneclick-live) exited 1 — failing facts: tui.mergedPanelOpens,tui.mergedPanelOrder,tui.teamSceneOpened,tui.teamGraphDrawn,tui.teamGraphContent,tui.laneExit
- Branch: `feature/dsh-022rc5-tui-0202` @ `e3f36a99` (package `0.21.0`)
- Start anchor: HEAD `e3f36a99`, `git diff | sha256sum` = `69e285f76dfb7ecd569391625aa3f858bdd14c9cd1fc1d9059def7b8e1412013`, tracked changed files `44`
- End anchor: HEAD `2cfa9430`, `git diff | sha256sum` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, tracked changed files `0`
- Docker: client 29.9.2, server 29.8.2, compose 5.7.0; ROOTLESS (["name=seccomp,profile=builtin","name=rootless","name=cgroupns"])
- `XDG_RUNTIME_DIR`: `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/.qa-tmp/xdg`
- DeepSeek key: $HOME/.dsh/.credentials.yaml refs.DEEPSEEK_API_KEY; exported into the runner environment and forwarded to compose by NAME (-e DEEPSEEK_API_KEY); value never printed, never written to evidence

| # | mode / flags | exit | evidence path | passed | failed | null | harness stamp | TUI stamp | userSurface true/null | failing facts |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `--mode source --require-docker --live` | 0 | `evidence/docker/client-install/2026-11-22T09-24-43Z` | 204 | 0 | 40 | 0.2.2-rc.5 | 0.20.2 | 85/35 | none |
| 2 | `--mode oneclick --require-docker --live` | 1 | `evidence/docker/client-install-oneclick/2026-11-22T09-43-42Z` | 196 | 6 | 42 | 0.2.2-rc.5 | 0.20.2 | 85/35 | `tui.mergedPanelOpens`, `tui.mergedPanelOrder`, `tui.teamSceneOpened`, `tui.teamGraphDrawn`, `tui.teamGraphContent`, `tui.laneExit` |
| 3 | `--mode source --require-docker --no-browser` | 0 | `evidence/docker/client-install/2026-11-22T10-07-05Z` | 163 | 0 | 81 | 0.2.2-rc.5 | 0.20.2 | 85/35 | none |

## Stamps, verbatim
- run 1 (source-live): harness `0.2.2-rc.5` (expected `0.2.2-rc.5`), TUI `version=0.20.2`; `facts.pins` = `nodePin=24.19.0 dsh=0.2.2-rc.5 pnpm=11.23.0`
- run 2 (oneclick-live): harness `0.2.2-rc.5` (expected `0.2.2-rc.5`), TUI `version=0.20.2`; `facts.pins` = `nodePin=24.19.0 dsh=0.2.2-rc.5 pnpm=11.23.0`
- run 3 (source-nobrowser): harness `0.2.2-rc.5` (expected `0.2.2-rc.5`), TUI `version=0.20.2`; `facts.pins` = `nodePin=24.19.0 dsh=0.2.2-rc.5 pnpm=11.23.0`

## Required proof per run
### run 1 — source-live

| group | name | verdict | raw |
|---|---|---|---|
| INSTALL | `install.exit` | TRUE | `exit=0 spec=.` |
| INSTALL | `install.profileDep` | TRUE | `dep=link:/opt/mpd bundles=@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,@mpd-dsh/mpd` |
| INSTALL | `install.installedTree` | TRUE | `/root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd` |
| INSTALL | `install.buildScripts` | TRUE | `ERROR_CLASS_LINES=none WARN_LINES=none INVENTORY=none` |
| MOUNT | `compose.mpdRows` | TRUE | `rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate layers=2 idTargets=0 defaultMpdLines=0 gate exit=0 subject=byte-identical [verify-no-host-override] PASS: every id-target is bundle-owned (0 of 0 collide with the 204 host-declared row ids) ` |
| MOUNT | `compose.presetRow` | TRUE | `- id: preset-mpd` |
| MOUNT | `boot.mpdTools` | TRUE | `CORE_TOOLS=6/6` |
| MOUNT | `boot.presetMount` | TRUE | `POST /api/session/create -> {"type":"server-response","rpcId":"rpc-1-1795339840-16398","result":{"ok":true,"value":{"sessionId":"session-2dab7e26-ee26-4854-a22d-34e9e71bd135","agentPreset":"mpd"}}}` |
| MOUNT | `boot.sessionGateListener` | TRUE | `[mpd-roles] session gate listener registered for agent "session-2dab7e26-ee26-4854-a22d-34e9e71bd135" agentPreset=mpd (file=/work/.mpd/logs/mpd-roles.log)` |
| MOUNT | `boot.servesHttp` | TRUE | `/plugins/mpd-workmate/list -> 200` |
| MOUNT | `boot.agentTeamTools` | TRUE | `[docker-probe] AGENT_TEAM_TOOLS=4/4 agent=session-2dab7e26-ee26-4854-a22d-34e9e71b generation=task-board-only scopelessRead=4/4` |
| MOUNT | `tui.hostInstall` | TRUE | `version=0.20.2 bin=/usr/local/bin/dsh-tui` |
| MOUNT | `tui.boot` | TRUE | `tmux=new-session-ok ready=chat-screen noLaunchpad=1 onboardingHex=7b0a202022636f6d… landingMarkerHits=0` |
| MOUNT | `tui.presetPreference` | TRUE | `pref=/root/sandbox-home/.dsh-tui/agent-preset.json hex=7b0a202022707265736574223a20226d7064220a7d writerParity=identical hostRowDefault=standard bundleForcedMpdLines=0 shippedIdTargets=<none> layers=2/2` |
| MOUNT | `tui.presetRow` | TRUE | `id=preset-mpd` |
| MOUNT | `tui.sessionPreset` | TRUE | `{"found":true,"sessionId":"4986cc67-c485-46bc-bc2a-28ab7fac2457","agentPreset":"mpd","bytes":196432,"scope":"this-boot-session"}` |
| userSurface | `userSurface.rowsEnumerated` | TRUE | `version=0.21.0 layers=cordis.patch.yml,mpd.patch.yml rows=69 disabled=mcp-git,mcp-shell,tool-plugin-market` |
| userSurface | `userSurface.rowsWitness` | TRUE | `witnessCounts={"declared-bound":35,"loader-active":9,"disabled-by-design":2,"sink":14,"registration":9} failed=-` |
| userSurface | `userSurface.probe` | TRUE | `phase=tick-13 loaderEntries=158 commands=34 tools=129` |
| userSurface | declared-bound markers | 35 TRUE | rows 69, row-nulls excused 35, unexcused [] |

pack rows: `pack.present`=true, `pack.licenceCoherence`=true, `pack.declarationCoherence`=true, `pack.staticCoherence`=true, `pack.distFreshRebuild`=true, `pack.distFreshRebuildControl`=true

### run 2 — oneclick-live

| group | name | verdict | raw |
|---|---|---|---|
| INSTALL | `install.exit` | TRUE | `exit=0 spec=git+file:///opt/oneclick.git` |
| INSTALL | `install.profileDep` | TRUE | `dep=git+file:///opt/oneclick.git bundles=@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,@mpd-dsh/mpd` |
| INSTALL | `install.installedTree` | TRUE | `/root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd` |
| INSTALL | `install.buildScripts` | TRUE | `ERROR_CLASS_LINES=none WARN_LINES=none INVENTORY=node_modules/@cyanheads/git-mcp-server:prepare,node_modules/colorette:prepare,node_modules/content-disposition:prepare,node_modules/content-type:prepare,node_modules/eventsource:prepare,node_modules/express-rate-limit:prepare,node_modules/ip-address:prepare,node_modules/mcp-server-commands:prepare,node_modules/path-to-regexp:prepare,node_modules/pino-abstract-transport:prepare,node_modules/signal-exit:prepare,node_modules/typescript-language-server:prepare` |
| MOUNT | `compose.mpdRows` | TRUE | `rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate layers=2 idTargets=0 defaultMpdLines=0 gate exit=0 subject=byte-identical [verify-no-host-override] PASS: every id-target is bundle-owned (0 of 0 collide with the 204 host-declared row ids) ` |
| MOUNT | `compose.presetRow` | TRUE | `- id: preset-mpd` |
| MOUNT | `boot.mpdTools` | TRUE | `CORE_TOOLS=6/6` |
| MOUNT | `boot.presetMount` | TRUE | `POST /api/session/create -> {"type":"server-response","rpcId":"rpc-1-1795340806-27786","result":{"ok":true,"value":{"sessionId":"session-6b92dc0c-c56c-4130-b19c-9e8f04bf6b4a","agentPreset":"mpd"}}}` |
| MOUNT | `boot.sessionGateListener` | TRUE | `[mpd-roles] session gate listener registered for agent "session-6b92dc0c-c56c-4130-b19c-9e8f04bf6b4a" agentPreset=mpd (file=/work/.mpd/logs/mpd-roles.log)` |
| MOUNT | `boot.servesHttp` | TRUE | `/plugins/mpd-workmate/list -> 200` |
| MOUNT | `boot.agentTeamTools` | TRUE | `[docker-probe] AGENT_TEAM_TOOLS=4/4 agent=session-6b92dc0c-c56c-4130-b19c-9e8f04bf generation=task-board-only scopelessRead=4/4` |
| MOUNT | `tui.hostInstall` | TRUE | `version=0.20.2 bin=/usr/local/bin/dsh-tui` |
| MOUNT | `tui.boot` | TRUE | `tmux=new-session-ok ready=chat-screen noLaunchpad=1 onboardingHex=7b0a202022636f6d… landingMarkerHits=0` |
| MOUNT | `tui.presetPreference` | TRUE | `pref=/root/sandbox-home/.dsh-tui/agent-preset.json hex=7b0a202022707265736574223a20226d7064220a7d writerParity=identical hostRowDefault=standard bundleForcedMpdLines=0 shippedIdTargets=<none> layers=2/2` |
| MOUNT | `tui.presetRow` | TRUE | `id=preset-mpd` |
| MOUNT | `tui.sessionPreset` | TRUE | `{"found":true,"sessionId":"e078be04-acd6-4c5f-ba8f-2f1c9d9ee256","agentPreset":"mpd","bytes":189692,"scope":"newest-record-proxy"}` |
| userSurface | `userSurface.rowsEnumerated` | TRUE | `version=0.21.0 layers=cordis.patch.yml,mpd.patch.yml rows=69 disabled=mcp-git,mcp-shell,tool-plugin-market` |
| userSurface | `userSurface.rowsWitness` | TRUE | `witnessCounts={"declared-bound":35,"loader-active":9,"disabled-by-design":2,"sink":14,"registration":9} failed=-` |
| userSurface | `userSurface.probe` | TRUE | `phase=tick-16 loaderEntries=158 commands=34 tools=116` |
| userSurface | declared-bound markers | 35 TRUE | rows 69, row-nulls excused 35, unexcused [] |

oneclick rows: `oneclick.scratchRepo`=true, `oneclick.requiredPaths`=true, `oneclick.filesAllowlist`=true, `oneclick.distByteIdentical`=true

pack rows: `pack.present`=true, `pack.licenceCoherence`=true, `pack.declarationCoherence`=true, `pack.staticCoherence`=true, `pack.distFreshRebuild`=null, `pack.distFreshRebuildControl`=null

### run 3 — source-nobrowser

| group | name | verdict | raw |
|---|---|---|---|
| INSTALL | `install.exit` | TRUE | `exit=0 spec=.` |
| INSTALL | `install.profileDep` | TRUE | `dep=link:/opt/mpd bundles=@deepseek-ai/dsh-base,@deepseek-ai/dsh-web-app,@mpd-dsh/mpd` |
| INSTALL | `install.installedTree` | TRUE | `/root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd` |
| INSTALL | `install.buildScripts` | TRUE | `ERROR_CLASS_LINES=none WARN_LINES=none INVENTORY=none` |
| MOUNT | `compose.mpdRows` | TRUE | `rows=mpd-dsh-adapter,mpd-bootstrap,mpd-web-compat,mpd-roles,mpd-workmate layers=2 idTargets=0 defaultMpdLines=0 gate exit=0 subject=byte-identical [verify-no-host-override] PASS: every id-target is bundle-owned (0 of 0 collide with the 204 host-declared row ids) ` |
| MOUNT | `compose.presetRow` | TRUE | `- id: preset-mpd` |
| MOUNT | `boot.mpdTools` | TRUE | `CORE_TOOLS=6/6` |
| MOUNT | `boot.presetMount` | TRUE | `POST /api/session/create -> {"type":"server-response","rpcId":"rpc-1-1795342333-25805","result":{"ok":true,"value":{"sessionId":"session-572e0144-47bc-486b-bbc1-8c42246f4055","agentPreset":"mpd"}}}` |
| MOUNT | `boot.sessionGateListener` | TRUE | `[mpd-roles] session gate listener registered for agent "session-572e0144-47bc-486b-bbc1-8c42246f4055" agentPreset=mpd (file=/work/.mpd/logs/mpd-roles.log)` |
| MOUNT | `boot.servesHttp` | TRUE | `/plugins/mpd-workmate/list -> 200` |
| MOUNT | `boot.agentTeamTools` | TRUE | `[docker-probe] AGENT_TEAM_TOOLS=4/4 agent=session-572e0144-47bc-486b-bbc1-8c42246f generation=task-board-only scopelessRead=4/4` |
| MOUNT | `tui.hostInstall` | TRUE | `version=0.20.2 bin=/usr/local/bin/dsh-tui` |
| MOUNT | `tui.boot` | TRUE | `tmux=new-session-ok ready=chat-screen noLaunchpad=1 onboardingHex=7b0a202022636f6d… landingMarkerHits=0` |
| MOUNT | `tui.presetPreference` | TRUE | `pref=/root/sandbox-home/.dsh-tui/agent-preset.json hex=7b0a202022707265736574223a20226d7064220a7d writerParity=identical hostRowDefault=standard bundleForcedMpdLines=0 shippedIdTargets=<none> layers=2/2` |
| MOUNT | `tui.presetRow` | TRUE | `id=preset-mpd` |
| MOUNT | `tui.sessionPreset` | TRUE | `{"found":true,"sessionId":"7df5c697-0513-4004-9f74-37b8a0786d55","agentPreset":"mpd","bytes":1456,"scope":"this-boot-session"}` |
| userSurface | `userSurface.rowsEnumerated` | TRUE | `version=0.21.0 layers=cordis.patch.yml,mpd.patch.yml rows=69 disabled=mcp-git,mcp-shell,tool-plugin-market` |
| userSurface | `userSurface.rowsWitness` | TRUE | `witnessCounts={"declared-bound":35,"loader-active":9,"disabled-by-design":2,"sink":14,"registration":9} failed=-` |
| userSurface | `userSurface.probe` | TRUE | `phase=tick-13 loaderEntries=158 commands=34 tools=129` |
| userSurface | declared-bound markers | 35 TRUE | rows 69, row-nulls excused 35, unexcused [] |

pack rows: `pack.present`=true, `pack.licenceCoherence`=true, `pack.declarationCoherence`=true, `pack.staticCoherence`=true, `pack.distFreshRebuild`=true, `pack.distFreshRebuildControl`=true

## SKIP accounting

`--require-docker` was passed on every run; a skip would have exited 3. Runs that printed `[driver] SKIP`: none.

## Commits during the lane

- `d2a93abc` at 2026-11-22T09:31:09Z: feat(adapt): support DSH 0.2.2-rc.5 and dsh-tui 0.20.2 (0.21.0)
- `8828e3c9` at 2026-11-22T09:39:07Z: chore(evidence): record the v0.21.0 gate transcripts for commit d2a93abc
- `2cfa9430` at 2026-11-22T09:42:48Z: chore(evidence): add the static verdict record and its post-freeze proof

### What the tree move means for the artifact

- run 1 build tree: HEAD e3f36a99 + 44 tracked dirty paths (the wave version carriers already moved), build context frozen at 2026-11-22T09:24:43Z
- run 2/3 build tree: HEAD 2cfa9430 (wave commit d2a93abc plus two evidence-only commits), clean working tree
- substantive delta: VENDOR_LOCK.json — the vendor re-pin, mtime 2026-11-22T17:27:43+08:00 (09:27:43Z), after run 1 build freeze; it IS carried in dist/mpd-package but is not one of the 32 hashed installed files
- no other delta: all other 44 paths of the wave tree had mtimes before run 1 09:24:43Z build freeze; commits 8828e3c9 and 2cfa9430 add evidence/ only, and the Docker build context and the pack both exclude evidence/
- artifact identity: the 32 recorded installed-artifact hashes are identical across all three runs

## Tree movement

- moved (start vs end): **YES**; added paths: none; removed paths: `AGENTS.md`, `CHANGELOG.md`, `docker/docker-compose.yml`, `docker/entrypoint.sh`, `docker/README.md`, `docker/README.zh-CN.md`, `docker/tui-lane.sh`, `docker/ui/docker-compose.yml`, `docker/ui/entrypoint.sh`, `docs/compatibility.md`, `docs/compatibility.zh-CN.md`, `docs/development.md`, `docs/development.zh-CN.md`, `docs/index.md`, `docs/index.zh-CN.md`, `docs/tui-admission.md`, `docs/tui-admission.zh-CN.md`, `docs/tui.md`, `docs/tui.zh-CN.md`, `docs/user-guide.md`, `docs/user-guide.zh-CN.md`, `dsh-distribution.json`, `dsh-plugin.json`, `.github/workflows/gates.yml`, `package.json`, `packages/mpd-tui-adapter-plugin/src/index.ts`, `packages/mpd-tui-plugin/dsh-plugin.json`, `packages/mpd-tui-plugin/test/panel-visibility.test.ts`, `presets/mpd.patch.yml`, `README.md`, `README.zh-CN.md`, `scripts/mpd-tui-panels.ts`, `skills/dsh-qa/scripts/dual-track-smoke.ts`, `skills/dsh-qa/scripts/install-dependencies.ts`, `skills/dsh-qa/scripts/lib/tui-lane.ts`, `skills/dsh-qa/scripts/preset-register.ts`, `skills/dsh-qa/scripts/tui-admission.ts`, `skills/dsh-qa/scripts/tui-deps-ctrla.ts`, `skills/dsh-qa/scripts/tui-keeper-standdown.ts`, `skills/dsh-qa/scripts/tui-mount.ts`, `skills/dsh-qa/scripts/tui-panels.ts`, `skills/dsh-qa/scripts/tui-team-surface.ts`, `skills/dsh-qa/scripts/user-surface-mount.ts`, `specs/tui-hosts.json`
- run 1: before diffSha `69e285f76dfb7ecd569391625aa3f858bdd14c9cd1fc1d9059def7b8e1412013` (44 files), after diffSha `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (0 files), moved during run: YES; added [] removed ["AGENTS.md","CHANGELOG.md","docker/docker-compose.yml","docker/entrypoint.sh","docker/README.md","docker/README.zh-CN.md","docker/tui-lane.sh","docker/ui/docker-compose.yml","docker/ui/entrypoint.sh","docs/compatibility.md","docs/compatibility.zh-CN.md","docs/development.md","docs/development.zh-CN.md","docs/index.md","docs/index.zh-CN.md","docs/tui-admission.md","docs/tui-admission.zh-CN.md","docs/tui.md","docs/tui.zh-CN.md","docs/user-guide.md","docs/user-guide.zh-CN.md","dsh-distribution.json","dsh-plugin.json",".github/workflows/gates.yml","package.json","packages/mpd-tui-adapter-plugin/src/index.ts","packages/mpd-tui-plugin/dsh-plugin.json","packages/mpd-tui-plugin/test/panel-visibility.test.ts","presets/mpd.patch.yml","README.md","README.zh-CN.md","scripts/mpd-tui-panels.ts","skills/dsh-qa/scripts/dual-track-smoke.ts","skills/dsh-qa/scripts/install-dependencies.ts","skills/dsh-qa/scripts/lib/tui-lane.ts","skills/dsh-qa/scripts/preset-register.ts","skills/dsh-qa/scripts/tui-admission.ts","skills/dsh-qa/scripts/tui-deps-ctrla.ts","skills/dsh-qa/scripts/tui-keeper-standdown.ts","skills/dsh-qa/scripts/tui-mount.ts","skills/dsh-qa/scripts/tui-panels.ts","skills/dsh-qa/scripts/tui-team-surface.ts","skills/dsh-qa/scripts/user-surface-mount.ts","specs/tui-hosts.json"]
- run 2: before diffSha `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (0 files), after diffSha `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (0 files), moved during run: no
- run 3: before diffSha `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (0 files), after diffSha `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (0 files), moved during run: no
- Each run's `COPY . /src/` freezes the build context at BUILD time, so a mid-run edit after that freeze does not change what the container installed; the per-run anchors record when the shared checkout moved.

- Artifact hash identity: identical; 32 recorded files compared across 3 runs.

## Failing facts, verbatim
- run 2 (oneclick-live): `tui.mergedPanelOpens` — the MPD combo did NOT open the merged panel on the captured pane, or the capture cannot attribute the panel to the combo: the captured pane does NOT carry the merged panel: titleHits=1 subagentHits=2 teamHits=0 subagentMarker=line 7 teamMarker=line 0 header=line 7 emptyState=line 8 (each family must be > 0, pre-key control hits = 0) THE FIXTURE WAS NOT BOUND TO THIS SESSION (session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=), so this red is about an UNMEASURED fixture and NOT yet about the drawing: the product is entitled to draw the empty state for a session that owns no board (tui.teamFixtureBound carries the cause). | raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=1 SUB_HITS=2 TEAM_HITS=0 CONTROL_HITS=0 SUB_LINE=7 TEAM_LINE=0 HEAD_LINE=7 EMPTY_LINE=8 pane=pane-merged.txt control=pane-teamClosed.txt chars=13196 controlChars=12349 log=[tui-panel] SHAPE=present [tui-panel] TITLE_HITS=1 SUB_HITS=2 TEAM_HITS=0 CONTROL_HITS=0 [tui-panel] SUB_LINE=7 TEAM_LINE=0 HEAD_LINE=7 EMPTY_LINE=8 [tui-panel] OPENS=false [tui-panel] ORDER=false [tui-panel] REASON=the captured pane does NOT carry the merged panel: titleHits=1 subagentHits=2 teamHits=0 subagentMarker=line 7 teamMarker=line 0 header=line 7 emptyState=line 8 (each family must be > 0, pre-key control hits = 0)`
- run 2 (oneclick-live): `tui.mergedPanelOrder` — the subagent section is NOT above the team body on the captured pane (or a marker is missing, or the panel did not open — an order claim about a panel that is not on screen is not a measurement): the captured pane does NOT carry the merged panel: titleHits=1 subagentHits=2 teamHits=0 subagentMarker=line 7 teamMarker=line 0 header=line 7 emptyState=line 8 (each family must be > 0, pre-key control hits = 0) THE FIXTURE WAS NOT BOUND TO THIS SESSION (session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=), so this red is about an UNMEASURED fixture and NOT yet about the drawing: the product is entitled to draw the empty state for a session that owns no board (tui.teamFixtureBound carries the cause). | raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=1 SUB_HITS=2 TEAM_HITS=0 CONTROL_HITS=0 SUB_LINE=7 TEAM_LINE=0 HEAD_LINE=7 EMPTY_LINE=8 pane=pane-merged.txt control=pane-teamClosed.txt chars=13196 controlChars=12349`
- run 2 (oneclick-live): `tui.teamSceneOpened` — the /mpd team scene opened on a real terminal (the capture waited for the scene's own header or for the product's empty-state line, so a pane still on the host's startup frame is no longer judged as a drawing) THE FIXTURE WAS NOT BOUND TO THIS SESSION (session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=), so this red is about an UNMEASURED fixture and NOT yet about the drawing: the product is entitled to draw the empty state for a session that owns no board (tui.teamFixtureBound carries the cause). | raw: `chars=11549`
- run 2 (oneclick-live): `tui.teamGraphDrawn` — the boxes were NOT drawn one per task: the record carries 3 task(s) and the pane's rounded corners are ╭0 ╮0 ╰0 ╯0, each of which must equal the task count. THE FIXTURE WAS NOT BOUND TO THIS SESSION (session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=), so this red is about an UNMEASURED fixture and NOT yet about the drawing: the product is entitled to draw the empty state for a session that owns no board (tui.teamFixtureBound carries the cause). | raw: `corners=╭0 ╮0 ╰0 ╯0 tasksFromRecord=3 ids=T1,T2,T3 pane=pane-team.txt`
- run 2 (oneclick-live): `tui.teamGraphContent` — the pane does not carry the record's own data: ids read from the record=3 missing=[T1,T2,T3] pinnedFocus=[none] — each record id must be DRAWN, and one 'j' keystroke must reach a task's own subject in the pinned detail body. THE FIXTURE WAS NOT BOUND TO THIS SESSION (session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=), so this red is about an UNMEASURED fixture and NOT yet about the drawing: the product is entitled to draw the empty state for a session that owns no board (tui.teamFixtureBound carries the cause). | raw: `ids=T1,T2,T3 fromRecord=3 labelsExpected=3 missing=[T1,T2,T3] pane=pane-team.txt chars=11549 pinnedFocus=none detail=[none] pinnedPane=pane-teamPinned.txt`
- run 2 (oneclick-live): `tui.laneExit` — the TUI lane finished with failing or missing assertions | raw: `records=21 failed=5`

## Bounds

- A run that cannot find a rootless daemon SKIPS, and a SKIP is never a pass; --require-docker turns it into exit 3.
- The live/browser arms are model-driven and depend on the operator's credential; a credential-free run cannot see a path that depends on an EMPTY model catalog.
- Declared bounds (`userSurface.bound.<id>`) are composed-but-not-individually-proven rows, not passes.
- The driver's own evidence lands under evidence/docker/<slug>/<stamp>/ per its contract; this lane copies the verdicts and metadata into this release directory.
- run 1 declared NULL rows (40 total, 5 outside userSurface): `oneclick.scratchRepo`, `oneclick.requiredPaths`, `oneclick.filesAllowlist`, `oneclick.distByteIdentical`, `ui.teamBoard`
- run 2 declared NULL rows (42 total, 7 outside userSurface): `build.bunInstall`, `build.dists`, `pack.distFreshRebuild`, `pack.rebuildToolchain`, `pack.distFreshRebuildControl`, `tui.teamFixtureBound`, `ui.teamBoard`
- run 3 declared NULL rows (81 total, 46 outside userSurface): `qa.mcpCall`, `oneclick.scratchRepo`, `oneclick.requiredPaths`, `oneclick.filesAllowlist`, `oneclick.distByteIdentical`, `live.credentialStaged`, `live.credentialScoped`, `live.credentialRemoved`, `live.web.turnStarted`, `live.web.turnCompleted`, `live.web.noErrorTurns`, `live.web.noPromptVariableError`, `live.web.noMalformedToolJson`, `live.web.toolCallsParsed`, `live.web.mpdToolCalled`, `live.web.assistantReplied`, `live.tui.turnStarted`, `live.tui.turnCompleted`, `live.tui.noErrorTurns`, `live.tui.noPromptVariableError`, `live.tui.noMalformedToolJson`, `live.tui.toolCallsParsed`, `live.tui.mpdToolCalled`, `live.tui.assistantReplied`, `live.headless.turnStarted`, `live.headless.turnCompleted`, `live.headless.noErrorTurns`, `live.headless.noPromptVariableError`, `live.headless.noMalformedToolJson`, `live.headless.toolCallsParsed`, `live.headless.mpdToolCalled`, `live.headless.assistantReplied`, `live.teamRecord`, `live.nativeExecutor`, `live.headlessPresetRow`, `boot.llmTurn`, `ui.loads`, `ui.workspaceSelected`, `ui.composerPresent`, `ui.promptSent`, `ui.replyRendered`, `ui.mpdSettingsSection`, `ui.teamPanel`, `ui.noConsoleErrors`, `ui.mpdSettingsSectionNegativeControl`, `ui.teamBoard`


## Reviewer verdict and findings

Verdict: **FAIL** — the lane as invoked is not green: run 2 (`--mode oneclick --require-docker --live`)
exited 1 on six TUI team-scene rows. The three proofs this lane exists to carry are green in ALL THREE
runs: INSTALL (`install.exit`, `install.profileDep`, `install.installedTree`, `install.buildScripts` all
TRUE), MOUNT (`boot.presetMount` with `agentPreset=mpd`, `boot.mpdTools`, `boot.sessionGateListener`,
`boot.servesHttp`, `boot.agentTeamTools`, `tui.hostInstall`, `tui.boot`, `tui.presetPreference`,
`tui.presetRow`, `tui.sessionPreset`, `compose.mpdRows`, `compose.presetRow` all TRUE), the
`userSurface.*` arm (`userSurface.probe`, `userSurface.rowsEnumerated`, `userSurface.rowsWitness` TRUE;
85 TRUE rows; 35 NULL rows each excused by a TRUE `userSurface.bound.<id>`; 0 unexcused), and both
stamps verbatim `0.2.2-rc.5` and `0.20.2`. The red is NOT a version, install or mount defect.

### Findings

- **High — oneclick live run red on the TUI team-fixture arm.** `tui.teamFixtureBound` is NULL with
  `session=none materialized=false attempts=4 source=none projectKey=--work-ws--
  resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=`; the five dependent drawing rows
  (`tui.mergedPanelOpens`, `tui.mergedPanelOrder`, `tui.teamSceneOpened`, `tui.teamGraphDrawn`,
  `tui.teamGraphContent`) and `tui.laneExit` are FALSE. The captured pane shows the product's CORRECT
  empty state (`no team in this session — stage one with agent_teams_plan, then approve it`) and the TUI
  later ran a live turn in session `e078be04-acd6-4c5f-ba8f-2f1c9d9ee256`, so the fixture was never
  bound — this is not the renderer dropping boxes. Both source runs bound the same fixture at
  attempts=2. Root cause not settled: the shape is the materializer race `docker/tui-lane.sh ::
  SESSION_MATERIALIZE` documents (the `/mpd board` drive firing before the session store materializes),
  which oneclick mode lost here. Direction: drive `/mpd board` only after the chat session is registered
  (or wait on the session store's own signal), then re-run the oneclick live arm. Nothing fixed here.
- **Medium — mixed-tree certification.** Run 1 built `e3f36a99` + 44 tracked dirty paths (build context
  frozen at 09:24:43Z, before the wave commit); runs 2 and 3 built commit `2cfa9430` (clean tree). The
  only substantive delta is `VENDOR_LOCK.json` (the vendor re-pin; mtime 09:27:43Z, after run 1's build
  freeze). It is carried in `dist/mpd-package` but not in the 32 hashed installed files; the pack tree
  hash moved between run 1 and run 2 consistently with that one-line change, and commits after the wave
  commit are evidence-only (excluded from both the Docker build context and the pack). The 32 recorded
  installed-artifact hashes are IDENTICAL across all three runs, but the three runs did not all test one
  committed tree. Direction: re-run the source `--live` arm on the final commit if the release record
  must cite one artifact.
- **Nit — the TUI stamp is the requested exact pin, not an observed installed version.**
  `docker/tui-lane.sh :: tui.hostInstall` records `version=$TUI_VERSION` (raw `version=0.20.2`) after an
  exact `npm i -g @deepseek-harness-tui/dsh-tui@0.20.2`; the harness stamp IS measured
  (`harness.version` compares the `dsh --version` output, `facts.harnessVersion=0.2.2-rc.5`). An
  exact-pin install fails on a different version, so the risk is low, but a read-back (installed
  profile `package.json` or `dsh-tui --version`) would turn the stamp into a measurement.

### Declined to judge

- `tui.boot` readiness vs the `正在启动 DSH…` line in the captured boot pane — the same line appears on
  the panes of the two GREEN source runs, so it cannot be established as a landing frame rather than the
  normal status/footer; declined (no claim either way).
- Whether the oneclick fixture failure is reproducible — exactly one run per required command was made
  and none was retried; a re-run is a diagnosis/repair step, not this lane.
- The 35 `userSurface.row.*` NULLs — each is excused by a TRUE `userSurface.bound.<id>` marker (35/35 in
  every run): composed-but-not-individually-proven rows, not passes; declined as declared bounds.
- `pack.distFreshRebuild` / `pack.distFreshRebuildControl` NULL in oneclick mode — by design (that mode
  produces no rebuild); the source runs carry the real measurement (TRUE both times); declined.
- `complete=false` on the two green runs — caused by declared bounds (40 and 81 NULLs), not failures; the
  required-arm gate passed with exit 0; declined.

### Bounds

- Rootless Docker was available (`SecurityOptions` contains `rootless`); no run printed `[driver] SKIP`,
  and `--require-docker` would have turned a skip into exit 3.
- The live arms are model-driven and used the operator's credential from
  `$HOME/.dsh/.credentials.yaml` refs.DEEPSEEK_API_KEY, forwarded by NAME and never printed or stored;
  run 3 is the credential-free `--no-browser` arm.
- The driver's own evidence remains at `evidence/docker/client-install/2026-11-22T09-24-43Z`,
  `evidence/docker/client-install-oneclick/2026-11-22T09-43-42Z` and
  `evidence/docker/client-install/2026-11-22T10-07-05Z`; this directory carries the transcripts, copied
  result/driver JSON, per-run tree anchors, pack manifests and the generated `summary.json`.
- Not run: no retry of any arm, no rootful run, no `--mode all` aggregate, and no static-lane gate (the
  parallel lane owns that).

### Pack cuts (the relocatable artifact)

| cut | version | files | tree sha256 | cut at (UTC) |
|---|---|---|---|---|
| before run 1 (source live) | 0.21.0 | 687 | `eceb56c6f994ba77d3062206330c24decf325fcd665f13210d3f0e083c760f6f` | 2026-11-22T09:24:43.457Z |
| before run 2 (oneclick live) | 0.21.0 | 687 | `3b5709c03ce71166e669bcdd39c018f4c4b574d315982ccf712a28394ffb327a` | 2026-11-22T09:43:42.069Z |
| before run 3 (source no-browser) | 0.21.0 | 687 | `3b5709c03ce71166e669bcdd39c018f4c4b574d315982ccf712a28394ffb327a` | 2026-11-22T10:07:05.663Z |

All three cuts exited 0 and carry `dist/mpd-package/package.json` version `0.21.0`. The run-2 cut is the
mandated immediate re-cut; cuts 2 and 3 are byte-identical (the tree was stable after the wave commit),
and cut 1 differs only through the pre-commit `VENDOR_LOCK.json` (see the mixed-tree finding). The pack
rows are green on the source runs (`pack.staticCoherence=true`, `pack.distFreshRebuild=true`,
`pack.distFreshRebuildControl=true`), so the stale-pack warning is discharged; the oneclick run records
`pack.staticCoherence=true` and the two rebuild rows NULL by design.

### Start-anchor detail

- First probe (before the pack pre-cut): HEAD `e3f36a99`, `git diff | sha256sum` =
  `e0b00ab5de4230b8c13f20f68a6f9720ba5505b9cb61a24bbc71bc1f9654924c` (42 tracked modified paths).
- Lane-start anchor (immediately before run 1): HEAD `e3f36a99`, diff =
  `69e285f76dfb7ecd569391625aa3f858bdd14c9cd1fc1d9059def7b8e1412013` (44 tracked modified paths).
  Between the two anchors `skills/dsh-qa/scripts/preset-register.ts` and
  `skills/dsh-qa/scripts/dual-track-smoke.ts` moved — the concurrent `skills/dsh-qa/scripts/**`
  sentinel lane the task anticipated.
- End anchor (after all three runs and all evidence writes): HEAD `2cfa9430`, diff =
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (clean tree, 0 tracked changes;
  the only new paths are untracked `evidence/` entries).
