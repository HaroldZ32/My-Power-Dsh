### ONECLICK (final, corrected apparatus) — evidence/docker/client-install-oneclick/2026-10-09T14-41-54Z

```
ok=false complete=false total=118 passed=72 failed=4 null=42
harness=0.2.0-rc.2 expected=0.2.0-rc.2 node=v24.21.0 (npm 11.19.0) bun=1.4.2 (route=official-script, BUN_INSTALL=/opt/toolchain/bun) pnpm=11.23.0 image=ubuntu 24.04 (Ubuntu 24.04.5 LTS)
obs.npmrc = registry=https://registry.npmmirror.com (a SANDBOX-home .npmrc; pnpm — and therefore every  — resolves through the FILE, not the environment, measured 2026-10-09)
obs.npmRegistry = https://registry.npmmirror.com (route=operator-set-ok; the scoped-metadata endpoint was probed because npm hangs silently on an unreachable one)
obs.buildToolchain = bun@1.4.0
obs.installSpec = git+file:///opt/oneclick.git
obs.installTail =   Virtual store is at:             node_modules/.pnpm Progress: resolved 180, reused 0, downloaded 26, added 25 Progress: resolved 180, reused 0, downloaded 177, added 180, done Done in 4.5s using pnpm v11.23.0 
obs.packArtifact = /src/dist/mpd-package (carried through docker/Dockerfile.dockerignore's one deliberate exception)
obs.dumpMpdRowIds = mpd-agent-team,mpd-better-sidebar,mpd-bootstrap,mpd-boulder,mpd-codegraph,mpd-comment-checker,mpd-config,mpd-dsh-adapter,mpd-ext,mpd-goal,mpd-hashline,mpd-memory,mpd-modelchain,mpd-roles,mpd-roster-provider,mpd-team-compact,mpd-team-core,mpd-team-watchdog,mpd-tool-agent-team,mpd-tools,mpd-tui,mpd-tui-adapter,mpd-ui-agent-team,mpd-ulw,mpd-verify,mpd-web-compat,mpd-workmate,
obs.dumpDefaultMpdLines = 0 (expected 0: the bundle ships no preset override)
obs.dumpAgentTeamRows = mpd-agent-team,mpd-tool-agent-team,mpd-ui-agent-team,
obs.qaHomeCredential = no credential mirror: the live arm was not requested, so the two live cases are expected to refuse and are recorded as null with their own marker quoted
obs.astgrepEngineTree = /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd (the tree whose bundle-relative .toolchain the MCP launcher reads; the installer SCRIPT runs from /opt/mpd/scripts/install-mcp.ts because node_modules paths refuse type stripping)
obs.astgrepToolchain = ast-grep,codegraph,sg,
obs.retiredToolsPresent = <probe did not report>
obs.teamToolPlane = root-plane read=0/9 (0/9 is the documented shape: @deepseek-ai/dsh-experimental-tool-agent-team registers scoped.tools on agent.ctx per agent); the graded read is AGENT_TEAM_TOOLS below
obs.uiTeamRow = resolved in profile node_modules at /root/sandbox-dsh/profiles/web/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/package.json with dsh.client.platform=web; host half is a no-op apply(), so no server-side registration can witness this browser-discovered plugin — its load is witnessed as resolved+composed+no apply failure (boot.noFatalSignatures)
obs.sessionCreate = http=200 type=server-response rpcIdEcho=match ok=true agentPreset=mpd
obs.realHomeMarkers = .bashrc,.profile,sandbox-dsh,sandbox-home,
obs.credentialFiles = .credentials.yaml(161B),.npmrc(40B), (sizes only; the CONTENT of a credential-shaped file is deliberately never copied into the evidence — the check is a secret-shape match, not a dump)
obs.lspTree = /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd (the INSTALLED tree when the profile carries one, because the launcher resolves cclsp from its own location and the one-click service runs no bun install)
obs.mcpCclspConfigAtBoot = /work/.mpd/lsp/cclsp.json
obs.caseEngineTree = /opt/mpd/dist/mpd-package (the bundle root the mcp-call launcher resolves bundle-relatively: the case installs that packed tree with npm  into its sandbox profile)
obs.qaHomeMirrorPresent = false
obs.owedCaseLogs = /out/owed/owed-logs (each case's own output, in the EVIDENCE tree so a red row can be read verbatim; the quoted tails also travel in the assertion rows)
```

**FALSE rows**

- `pack.staticCoherence` — the artifact does NOT agree with the tree it was cut from — it is stale or was edited after the pack: 6 differing file(s), 0 carried file(s) with no twin | raw: drifted=skills/dsh-qa/SKILL.md,skills/dsh-qa/scripts/extension-isolation.ts,skills/dsh-qa/scripts/lib/messages-sse.ts,skills/dsh-qa/scripts/lib/session-evidence.ts,skills/dsh-qa/scripts/readonly-deny.ts,skills/dsh-qa/scripts/software-smoke.ts untwinned=none
- `boot.mcpToolNaming` — the registered MCP surface is not the declared row set: malformed=none undeclaredServers=none silentLocalServers=codegraph missingAstGrepTools=none | raw: MCP_REGISTERED=mcp__ast_grep__rewrite,mcp__ast_grep__scan,mcp__ast_grep__search,mcp__context7__query-docs,mcp__context7__resolve-library-id,mcp__lsp__find_definition,mcp__lsp__find_implementation,mcp__lsp__find_references,mcp__lsp__find_workspace_symbols,mcp__lsp__get_diagnostics,mcp__lsp__get_hover
- `qa.readonlyDeny` — the live readonly-deny case (a read-only spawn whose child must really be restricted) did NOT pass in this run (exit=1); this is the case's real outcome, not the host's excuse | raw: cmd=node skills/dsh-qa/scripts/readonly-deny.ts exit=1 log=/out/owed/owed-logs/qa.readonlyDeny.log tail=  enforcement: {"ok":false,"childRequests":0,"parentRequests":2,"childLeaksWriteCapable":[],"childHasStructuredOutput":false,"parentSeesAllDenyNames":false,"note":"read-only authority is ENFORCED:
- `boot.mcpTools` — an MCP tool is missing from the live registry — its stdio server did not come up | raw: MCP_TOOLS=2/3 MISSING=mcp__codegraph__codegraph_explore

**NULL rows** (each with the reason the run recorded)

- `build.bunInstall` — not applicable in one-click mode: the published package carries its own dependencies and the install materializes them
- `build.dists` — not applicable in one-click mode: the published package ships its built dist entries, and the mount below is what judges them
- `pack.distFreshRebuild` — not measured in this mode: no from-source rebuild of the tree was produced here, so there is nothing to compare the artifact against. A comparison against an un-rebuilt copy would be a second byte-coherence check wearing
- `pack.rebuildToolchain` — not measured in this mode: no from-source rebuild was produced, so no compiler produced the bytes this row would match against the artifact's declared buildToolchain
- `pack.distFreshRebuildControl` — not applicable in mode=oneclick: the control mutates the packed artifact and re-grades it against a from-source rebuild, and this mode produces no rebuild to compare against (see pack.distFreshRebuild in this same report
- `qa.mcpCall` — the live mcp-call case (a real model turn that must record a mcp__ast_grep__search call) did not run to a verdict on this machine: the case itself reported "[mcp-call] missing credentials" — a skip is not a pass, and not
- `live.credentialStaged` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a DEEPSEEK_API_KEY forwarded by name; the mount assertions are the credential-free maximum
- `live.credentialScoped` — not attempted: no credential was staged, so there was nothing to scope-check
- `live.credentialRemoved` — not attempted: nothing was staged, so nothing needed removing
- `live.web.turnStarted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.turnCompleted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.noErrorTurns` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.noMalformedToolJson` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.toolCallsParsed` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.mpdToolCalled` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.web.assistantReplied` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.turnStarted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.turnCompleted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.noErrorTurns` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.noMalformedToolJson` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.toolCallsParsed` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.mpdToolCalled` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.tui.assistantReplied` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.turnStarted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.turnCompleted` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.noErrorTurns` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.noMalformedToolJson` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.toolCallsParsed` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.mpdToolCalled` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.headless.assistantReplied` — not attempted: a live turn needs MPD_E2E_LIVE=1 and a credential forwarded by name; the mount assertions are the credential-free maximum
- `live.teamRecord` — not attempted: no live turn ran, so no approval could materialise a record
- `live.nativeExecutor` — not attempted: no live turn ran, so no member could be raised
- `live.headlessPresetRow` — not attempted: the headless profile was never driven, so its preset activation is unmeasured
- `boot.llmTurn` — not attempted: a live LLM turn needs provider credentials and this container stages none (AGENTS.md §10). The mount assertions above are the credential-free maximum.
- `ui.loads` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.workspaceSelected` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.composerPresent` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.promptSent` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.replyRendered` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.mpdSettingsSection` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.teamPanel` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum
- `ui.noConsoleErrors` — not attempted: the browser lane is opt-in (MPD_E2E_BROWSER=1) because it downloads Chromium; the HTTP assertions above are the browser-free maximum

**The rows this stream owns**

- `toolchain.bunPinned` = **true** — the build toolchain the tree declares is staged and reports EXACTLY that version, so the from-source rebuild below runs under the compiler the artifact was cut with
  - raw: `bin=/opt/toolchain/bun-pinned/bin/bun version=1.4.0 declared=bun@1.4.0 route=official-script`
- `build.bunInstall` = **null** — not applicable in one-click mode: the published package carries its own dependencies and the install materializes them
  - raw: `skipped by design`
- `build.dists` = **null** — not applicable in one-click mode: the published package ships its built dist entries, and the mount below is what judges them
  - raw: `skipped by design`
- `pack.distFreshRebuild` = **null** — not measured in this mode: no from-source rebuild of the tree was produced here, so there is nothing to compare the artifact against. A comparison against an un-rebuilt copy would be a second byte-coherence check wearing freshness's name — the source lane carries this measurement
  - raw: `rebuild=<none passed>`
- `pack.rebuildToolchain` = **null** — not measured in this mode: no from-source rebuild was produced, so no compiler produced the bytes this row would match against the artifact's declared buildToolchain
  - raw: `rebuild=<none passed>`
- `pack.distFreshRebuildControl` = **null** — not applicable in mode=oneclick: the control mutates the packed artifact and re-grades it against a from-source rebuild, and this mode produces no rebuild to compare against (see pack.distFreshRebuild in this same report)
  - raw: `mode=oneclick`
- `pack.staticCoherence` = **false** — the artifact does NOT agree with the tree it was cut from — it is stale or was edited after the pack: 6 differing file(s), 0 carried file(s) with no twin
  - raw: `drifted=skills/dsh-qa/SKILL.md,skills/dsh-qa/scripts/extension-isolation.ts,skills/dsh-qa/scripts/lib/messages-sse.ts,skills/dsh-qa/scripts/lib/session-evidence.ts,skills/dsh-qa/scripts/readonly-deny.ts,skills/dsh-qa/scripts/software-smoke.ts untwinned=none`
- `tui.mergedPanelOpens` = **true** — the MPD combo (alt+a, sent as tmux M-a from the plain chat state) opened the MERGED panel on a real terminal, and the PRE-KEY capture proves the combo is what opened it: the captured pane carries the merged panel: titleHits=2 subagentHits=2 teamHits=2 subagentMarker=line 6 teamMarker=line 9 header=l
  - raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=2 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0 SUB_LINE=6 TEAM_LINE=9 HEAD_LINE=6 EMPTY_LINE=7 pane=pane-merged.txt control=pane-teamClosed.txt chars=13360 controlChars=13030`
- `tui.mergedPanelOrder` = **true** — the captured pane holds the subagent section ABOVE the team body — measured on the same pane the open row reads: the captured pane carries the merged panel: titleHits=2 subagentHits=2 teamHits=2 subagentMarker=line 6 teamMarker=line 9 header=line 6 emptyState=line 7 (each family must be > 0, pre-key
  - raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=2 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0 SUB_LINE=6 TEAM_LINE=9 HEAD_LINE=6 EMPTY_LINE=7 pane=pane-merged.txt control=pane-teamClosed.txt chars=13360 controlChars=13030`
- `tui.laneExit` = **true** — the TUI lane ran to completion with every assertion green
  - raw: `records=21`
- `qa.mcpCallEngine` = **true** — the ast-grep engine the call arm's launcher resolves (bundle-relative, inside the packed tree the case installs) is staged and its own --version probe reports ast-grep, so qa.mcpCall below measures the CASE rather than a missing binary
  - raw: `bin=/opt/mpd/dist/mpd-package/.toolchain/node_modules/.bin/ast-grep probe=ast-grep 0.50.0`
- `qa.mcpCall` = **null** — the live mcp-call case (a real model turn that must record a mcp__ast_grep__search call) did not run to a verdict on this machine: the case itself reported "[mcp-call] missing credentials" — a skip is not a pass, and nothing about the bundle is settled by it
  - raw: `exit=1 marker=[mcp-call] missing credentials tail=[mcp-call] missing credentials`
- `qa.readonlyDeny` = **false** — the live readonly-deny case (a read-only spawn whose child must really be restricted) did NOT pass in this run (exit=1); this is the case's real outcome, not the host's excuse
  - raw: `cmd=node skills/dsh-qa/scripts/readonly-deny.ts exit=1 log=/out/owed/owed-logs/qa.readonlyDeny.log tail=  enforcement: {"ok":false,"childRequests":0,"parentRequests":2,"childLeaksWriteCapable":[],"childHasStructuredOutput":false,"parentSeesAllDenyNames":false,"note":"read-only authority is ENFORCED:`
- `boot.mcpLiveSearch` = **true** — a REAL mcp__ast_grep__search call through the mounted adapter matched 1 site(s) in /opt/mpd/packages/mpd-mcp-astgrep/src, and the negative control matched 0 — the search engine ran, so the registered name is backed by a working server on this machine
  - raw: `dir=/opt/mpd/packages/mpd-mcp-astgrep/src MCP_LIVE_SEARCH=ok:1 MCP_LIVE_SEARCH_CONTROL=ok:0 SHAPE=keys=isError,ok,raw,value ok=true isError=false value(keys=content matches=none)`
- `oneclick.distByteIdentical` = **true** — 32 committed dist entry/entries landed byte-identical, so the install ran no build and shipped what the source tree builds
  - raw: `cmp -s on each entry`
- `oneclick.scratchRepo` = **true** — the scratch remote (a git repository of the build context) exists, so the spec resolves through the real git path
  - raw: `commit=4d43dfe70636a80527e00fb735cf7239b274eb11 repo=/opt/oneclick.git`
- `oneclick.requiredPaths` = **true** — every path the rows and the display metadata name is present in the installed package
  - raw: `checked: patch files, MCP launchers, web client, icon, locale, skills corpus`
- `oneclick.filesAllowlist` = **true** — the files allowlist was honoured: no frozen evidence tree, no git history, no lane scratch in the installed package
  - raw: `absent: evidence/ .git/ docker/ .qa-tmp/`

**Every step, with its exit code and duration**

```
   0      0s  01b-npm-registry  (74 B)  node -e    const registry = process.argv[1]   const probeUrl = process.argv[2]   const mirror = process.argv[3]   const label = process.argv[4]   const out = process.argv[5]   const fs = await import("node:fs")   const probe = async (target) => {     const started = Date.now()     const controller = new AbortController()     const timer = setTimeout(() => controller.abort(), 20000)     try {       const response = await fetch(target, { signal: controller.signal })       await response.text()       clearTimeout(timer)       return { ok: response.status === 200, ms: Date.now() - started, status: "http=" + response.status }     } catch (error) {       clearTimeout(timer)       return { ok: false, ms: Date.now() - started, status: String(error).slice(0, 80) }     }   }   const first = await probe(probeUrl)   const settle = (chosen, route, detail) => {     fs.writeFileSync(out, chosen + "\n" + route + "\n")     console.log("REGISTRY=" + chosen + " ROUTE=" + route + " " + detail)   }   if (first.ok) { settle(registry, label + "-ok", "probeMs=" + first.ms); process.exit(0) }   const second = await probe(mirror + "/@deepseek-ai%2fdsh")   if (second.ok) {     settle(mirror, "mirror-fallback", "officialProbe=" + first.status + " officialProbeMs=" + first.ms + " mirrorMs=" + second.ms)     process.exit(0)   }   settle(registry, "both-unreachable", "officialProbe=" + first.status + " mirrorProbe=" + second.status)  https://registry.npmmirror.com https://registry.npmmirror.com/@deepseek-ai%2fdsh https://registry.npmmirror.com operator-set /work/npm-registry.txt 
   0      9s  01-apt-update  (1634 B)  apt-get update 
   0      9s  01-apt-install  (16425 B)  env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl git ca-certificates unzip xz-utils tmux 
   0      9s  03-bun  (3855 B)  bash -c set -euo pipefail; curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 https://bun.sh/install | bash 
   0      9s  03b-bun-pin  (2902 B)  env BUN_INSTALL=/opt/toolchain/bun-pinned bash -c set -euo pipefail; curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 https://bun.sh/install | bash -s -- 'bun-v1.4.0' 
   0     12s  04-pnpm  (87 B)  npm i -g pnpm@11.23.0 
   0     13s  05-dsh  (1179 B)  npm i -g @deepseek-ai/dsh@0.2.0-rc.2 
   0      0s  06-copy  (0 B)  cp -a /src/. /opt/mpd/ 
   0      1s  06b-oneclick-repo  (0 B)  bash -c rm -rf '/opt/oneclick-src' '/opt/oneclick.git'     && mkdir -p '/opt/oneclick-src'     && cp -a '/src/.' '/opt/oneclick-src/'     && cd '/opt/oneclick-src'     && git init -q .     && git add -A     && git -c user.email=e2e@local -c user.name='mpd e2e' commit -qm 'one-click fixture: the build context as committed'     && git clone -q --bare . '/opt/oneclick.git' 
   0      5s  09-install  (784 B)  bash -c cd '/opt/mpd' && dsh plugin --profile web add 'git+file:///opt/oneclick.git' 
   0      0s  09a-install-closure  (330 B)  node /opt/mpd-e2e/lib/owed-install.ts --install-log /work/steps/09-install.log --exit 0 --roots /root/sandbox-dsh/profiles/web,/opt/mpd --state /work/assertions.ndjson 
   0      0s  08c-pack  (1389 B)  node /opt/mpd-e2e/lib/owed-pack.ts --artifact /src/dist/mpd-package --source /src --rebuild  --rebuild-report  --state /work/assertions.ndjson 
   0      0s  10-dump  (87332 B)  node /opt/mpd/scripts/dump-config.ts --profile web 
   0      2s  09d-astgrep-engine  (1149 B)  node /opt/mpd/scripts/install-mcp.ts --toolchain /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd/.toolchain 
   0      0s  11b-mcp-surface  (480 B)  node /opt/mpd-e2e/lib/owed-mcp.ts --boot-log /work/steps/11-boot.log --state /work/assertions.ndjson --search-dir /opt/mpd/packages/mpd-mcp-astgrep/src 
  -1    183s  11-boot  (2190 B)  dsh --profile web --patch probe.yml --port 3197 --no-open (background; terminated by the harness after the assertions)
   0      0s  12-web-live  (1254 B)  skipped: no live credential staged
   0      0s  13-browser  (0 B)  skipped: MPD_E2E_BROWSER was not set
   0     94s  14-tui  (6368 B)  bash docker/tui-lane.sh
   0      0s  16-owed-lsp  (252 B)  node /opt/mpd-e2e/lib/owed-cases.ts --kind lsp --repo /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd --work /out/owed --state /work/assertions.ndjson 
   0      0s  16b-pack-refresh  (352 B)  node /opt/mpd/scripts/pack-mpd.ts 
   0      1s  16b2-case-engine  (963 B)  node /opt/mpd/scripts/install-mcp.ts --toolchain /opt/mpd/dist/mpd-package/.toolchain 
   0     20s  16c-owed-cases  (1120 B)  node /opt/mpd-e2e/lib/owed-cases.ts --kind cases --repo /opt/mpd --work /out/owed --qa-home  --state /work/assertions.ndjson 
```
