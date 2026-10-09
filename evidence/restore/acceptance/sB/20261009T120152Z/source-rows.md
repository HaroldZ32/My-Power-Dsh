### source (final) — evidence/docker/client-install/2026-10-09T14-12-54Z

```
ok=false complete=false total=118 passed=76 failed=1 null=41
harness=0.2.0-rc.2 expected=0.2.0-rc.2 node=v24.21.0 (npm 11.19.0) bun=1.4.2 (route=official-script, BUN_INSTALL=/opt/toolchain/bun) pnpm=11.23.0 image=ubuntu 24.04 (Ubuntu 24.04.5 LTS)
obs.npmrc = registry=https://registry.npmmirror.com (a SANDBOX-home .npmrc; pnpm — and therefore every  — resolves through the FILE, not the environment, measured 2026-10-09)
obs.npmRegistry = https://registry.npmmirror.com (route=operator-set-ok; the scoped-metadata endpoint was probed because npm hangs silently on an unreachable one)
obs.buildToolchain = bun@1.4.0
obs.rebuildNoSrc = NO_SRC=mpd-bundle=package has no src/ directory (dist is the only committed artifact),mpd-mcp-shared=built by the package itself (bun build src/launch.ts -> dist/launch.js) or a sha-pinned prebuilt — no offline snapshot build any more,mpd-schemastery=package has no src/ directory (dist is the only committed artifact)
obs.rebuildBun = [rebuild] BUN=/opt/toolchain/bun-pinned/bin/bun VERSION=1.4.0
obs.installSpec = .
obs.installTail = + @mpd-dsh/mpd link:/opt/mpd  Already up to date Done in 335ms using pnpm v11.23.0 
obs.packArtifact = /src/dist/mpd-package (carried through docker/Dockerfile.dockerignore's one deliberate exception)
obs.dumpMpdRowIds = mpd-agent-team,mpd-better-sidebar,mpd-bootstrap,mpd-boulder,mpd-codegraph,mpd-comment-checker,mpd-config,mpd-dsh-adapter,mpd-ext,mpd-goal,mpd-hashline,mpd-memory,mpd-modelchain,mpd-roles,mpd-roster-provider,mpd-team-compact,mpd-team-core,mpd-team-watchdog,mpd-tool-agent-team,mpd-tools,mpd-tui,mpd-tui-adapter,mpd-ui-agent-team,mpd-ulw,mpd-verify,mpd-web-compat,mpd-workmate,
obs.dumpDefaultMpdLines = 0 (expected 0: the bundle ships no preset override)
obs.dumpAgentTeamRows = mpd-agent-team,mpd-tool-agent-team,mpd-ui-agent-team,
obs.qaHomeCredential = no credential mirror: the live arm was not requested, so the two live cases are expected to refuse and are recorded as null with their own marker quoted
obs.astgrepEngineTree = /opt/mpd (the tree whose bundle-relative .toolchain the MCP launcher reads; the installer SCRIPT runs from /opt/mpd/scripts/install-mcp.ts because node_modules paths refuse type stripping)
obs.astgrepToolchain = ast-grep,codegraph,sg,
obs.retiredToolsPresent = <probe did not report>
obs.teamToolPlane = root-plane read=0/9 (0/9 is the documented shape: @deepseek-ai/dsh-experimental-tool-agent-team registers scoped.tools on agent.ctx per agent); the graded read is AGENT_TEAM_TOOLS below
obs.uiTeamRow = resolved in the bundle's own node_modules (resolved through the link: dependency) at /opt/mpd/node_modules/@deepseek-ai/dsh-experimental-client-ui-agent-team/package.json with dsh.client.platform=web; host half is a no-op apply(), so no server-side registration can witness this browser-discovered plugin — its load is witnessed as resolved+composed+no apply failure (boot.noFatalSignatures)
obs.sessionCreate = http=200 type=server-response rpcIdEcho=match ok=true agentPreset=mpd
obs.realHomeMarkers = .bashrc,.profile,sandbox-dsh,sandbox-home,
obs.credentialFiles = .credentials.yaml(161B),.npmrc(40B), (sizes only; the CONTENT of a credential-shaped file is deliberately never copied into the evidence — the check is a secret-shape match, not a dump)
obs.lspTree = /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd (the INSTALLED tree when the profile carries one, because the launcher resolves cclsp from its own location and the one-click service runs no bun install)
obs.mcpCclspConfigAtBoot = /work/.mpd/lsp/cclsp.json,/work/ws/.mpd/lsp/cclsp.json
obs.caseEngineTree = /opt/mpd/dist/mpd-package (the bundle root the mcp-call launcher resolves bundle-relatively: the case installs that packed tree with npm  into its sandbox profile)
obs.qaHomeMirrorPresent = false
obs.owedCaseLogs = /out/owed/owed-logs (each case's own output, in the EVIDENCE tree so a red row can be read verbatim; the quoted tails also travel in the assertion rows)
```

**FALSE rows**

- `pack.staticCoherence` — the artifact does NOT agree with the tree it was cut from — it is stale or was edited after the pack: 6 differing file(s), 0 carried file(s) with no twin | raw: drifted=skills/dsh-qa/SKILL.md,skills/dsh-qa/scripts/extension-isolation.ts,skills/dsh-qa/scripts/lib/messages-sse.ts,skills/dsh-qa/scripts/lib/session-evidence.ts,skills/dsh-qa/scripts/readonly-deny.ts,skills/dsh-qa/scripts/software-smoke.ts untwinned=none

**NULL rows** (each with the reason the run recorded)

- `qa.mcpCall` — the live mcp-call case (a real model turn that must record a mcp__ast_grep__search call) did not run to a verdict on this machine: the case itself reported "[mcp-call] missing credentials" — a skip is not a pass, and not
- `oneclick.scratchRepo` — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by 
- `oneclick.requiredPaths` — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by 
- `oneclick.filesAllowlist` — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by 
- `oneclick.distByteIdentical` — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by 
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
- `build.bunInstall` = **true** — bun install resolved the workspace and the dev/optional dependencies
  - raw: `exit=0`
- `build.dists` = **true** — every discovered packages/*/dist entry rebuilt with exit 0 and a non-empty artifact
  - raw: `BUILD_OK=31/31`
- `pack.distFreshRebuild` = **true** — every one of the 31 built entries in the artifact is byte-identical to the container's own from-source rebuild — the packed dist is FRESH, not merely present
  - raw: `drifted=none uncovered=none rebuildBun=/opt/toolchain/bun-pinned/bin/bun rebuildBunVersion=1.4.0 declaredBuildToolchain=bun@1.4.0 declaredVersion=1.4.0 exactMatch=true witness=/work/rebuild.json`
- `pack.rebuildToolchain` = **true** — the from-source rebuild ran under bun 1.4.0, which IS the version the repository declares for its canonical build (bun@1.4.0), so a byte difference from this rebuild can be read as staleness rather than as a compiler difference
  - raw: ` rebuildBun=/opt/toolchain/bun-pinned/bin/bun rebuildBunVersion=1.4.0 declaredBuildToolchain=bun@1.4.0 declaredVersion=1.4.0 exactMatch=true witness=/work/rebuild.json`
- `pack.distFreshRebuildControl` = **true** — the freshness arm is FALSIFIABLE on this machine: mutating one built entry in a copy of the same artifact flips pack.distFreshRebuild to FALSE against the SAME from-source rebuild, so a green on the untouched artifact is a measurement rather than a constant (the control's own rows are in /out/owed/p
  - raw: `mutated=packages/mpd-better-sidebar-host/dist/index.js controlVerdict=false artifactCopy=/work/pack-mutated`
- `pack.staticCoherence` = **false** — the artifact does NOT agree with the tree it was cut from — it is stale or was edited after the pack: 6 differing file(s), 0 carried file(s) with no twin
  - raw: `drifted=skills/dsh-qa/SKILL.md,skills/dsh-qa/scripts/extension-isolation.ts,skills/dsh-qa/scripts/lib/messages-sse.ts,skills/dsh-qa/scripts/lib/session-evidence.ts,skills/dsh-qa/scripts/readonly-deny.ts,skills/dsh-qa/scripts/software-smoke.ts untwinned=none`
- `tui.mergedPanelOpens` = **true** — the MPD combo (alt+a, sent as tmux M-a from the plain chat state) opened the MERGED panel on a real terminal, and the PRE-KEY capture proves the combo is what opened it: the captured pane carries the merged panel: titleHits=2 subagentHits=2 teamHits=2 subagentMarker=line 6 teamMarker=line 9 header=l
  - raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=2 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0 SUB_LINE=6 TEAM_LINE=9 HEAD_LINE=6 EMPTY_LINE=7 pane=pane-merged.txt control=pane-teamClosed.txt chars=13362 controlChars=13032`
- `tui.mergedPanelOrder` = **true** — the captured pane holds the subagent section ABOVE the team body — measured on the same pane the open row reads: the captured pane carries the merged panel: titleHits=2 subagentHits=2 teamHits=2 subagentMarker=line 6 teamMarker=line 9 header=line 6 emptyState=line 7 (each family must be > 0, pre-key
  - raw: `panelSeam=present driver=docker/lib/tui-panel-body.ts TITLE_HITS=2 SUB_HITS=2 TEAM_HITS=2 CONTROL_HITS=0 SUB_LINE=6 TEAM_LINE=9 HEAD_LINE=6 EMPTY_LINE=7 pane=pane-merged.txt control=pane-teamClosed.txt chars=13362 controlChars=13032`
- `tui.laneExit` = **true** — the TUI lane ran to completion with every assertion green
  - raw: `records=21`
- `qa.mcpCallEngine` = **true** — the ast-grep engine the call arm's launcher resolves (bundle-relative, inside the packed tree the case installs) is staged and its own --version probe reports ast-grep, so qa.mcpCall below measures the CASE rather than a missing binary
  - raw: `bin=/opt/mpd/dist/mpd-package/.toolchain/node_modules/.bin/ast-grep probe=ast-grep 0.45.3`
- `qa.mcpCall` = **null** — the live mcp-call case (a real model turn that must record a mcp__ast_grep__search call) did not run to a verdict on this machine: the case itself reported "[mcp-call] missing credentials" — a skip is not a pass, and nothing about the bundle is settled by it
  - raw: `exit=1 marker=[mcp-call] missing credentials tail=[mcp-call] missing credentials`
- `qa.readonlyDeny` = **true** — the live readonly-deny case (a read-only spawn whose child must really be restricted) ran to a clean exit in this run — the case's own assertions are what passed
  - raw: `cmd=node skills/dsh-qa/scripts/readonly-deny.ts exit=0 log=/out/owed/owed-logs/qa.readonlyDeny.log tail=  positiveOk: {"ok":true,"note":"positive lane: exit=0, denyListMatchesTheEight=true, spawnDriven=true, restrictError=false, missingCredential=false, childRequests=1, childLeaksWriteCapable=[]"} |`
- `boot.mcpLiveSearch` = **true** — a REAL mcp__ast_grep__search call through the mounted adapter matched 1 site(s) in /opt/mpd/packages/mpd-mcp-astgrep/src, and the negative control matched 0 — the search engine ran, so the registered name is backed by a working server on this machine
  - raw: `dir=/opt/mpd/packages/mpd-mcp-astgrep/src MCP_LIVE_SEARCH=ok:1 MCP_LIVE_SEARCH_CONTROL=ok:0 SHAPE=keys=isError,ok,raw,value ok=true isError=false value(keys=content matches=none)`
- `oneclick.distByteIdentical` = **null** — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by path — the one-click lane carries the measurement
  - raw: `mode=source`
- `oneclick.scratchRepo` = **null** — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by path — the one-click lane carries the measurement
  - raw: `mode=source`
- `oneclick.requiredPaths` = **null** — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by path — the one-click lane carries the measurement
  - raw: `mode=source`
- `oneclick.filesAllowlist` = **null** — not applicable in mode=source: this row grades the PUBLISHED package's installed tree (the scratch git build, the manifest's files allowlist, and the byte identity of what landed), and this mode installs the checkout by path — the one-click lane carries the measurement
  - raw: `mode=source`

**Every step, with its exit code and duration**

```
   0      0s  01b-npm-registry  (74 B)  node -e    const registry = process.argv[1]   const probeUrl = process.argv[2]   const mirror = process.argv[3]   const label = process.argv[4]   const out = process.argv[5]   const fs = await import("node:fs")   const probe = async (target) => {     const started = Date.now()     const controller = new AbortController()     const timer = setTimeout(() => controller.abort(), 20000)     try {       const response = await fetch(target, { signal: controller.signal })       await response.text()       clearTimeout(timer)       return { ok: response.status === 200, ms: Date.now() - started, status: "http=" + response.status }     } catch (error) {       clearTimeout(timer)       return { ok: false, ms: Date.now() - started, status: String(error).slice(0, 80) }     }   }   const first = await probe(probeUrl)   const settle = (chosen, route, detail) => {     fs.writeFileSync(out, chosen + "\n" + route + "\n")     console.log("REGISTRY=" + chosen + " ROUTE=" + route + " " + detail)   }   if (first.ok) { settle(registry, label + "-ok", "probeMs=" + first.ms); process.exit(0) }   const second = await probe(mirror + "/@deepseek-ai%2fdsh")   if (second.ok) {     settle(mirror, "mirror-fallback", "officialProbe=" + first.status + " officialProbeMs=" + first.ms + " mirrorMs=" + second.ms)     process.exit(0)   }   settle(registry, "both-unreachable", "officialProbe=" + first.status + " mirrorProbe=" + second.status)  https://registry.npmmirror.com https://registry.npmmirror.com/@deepseek-ai%2fdsh https://registry.npmmirror.com operator-set /work/npm-registry.txt 
   0     14s  01-apt-update  (1635 B)  apt-get update 
   0     10s  01-apt-install  (16425 B)  env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl git ca-certificates unzip xz-utils tmux 
   0      8s  03-bun  (3855 B)  bash -c set -euo pipefail; curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 https://bun.sh/install | bash 
   0      8s  03b-bun-pin  (3062 B)  env BUN_INSTALL=/opt/toolchain/bun-pinned bash -c set -euo pipefail; curl -fsSL --retry 8 --retry-delay 2 --retry-all-errors --connect-timeout 20 https://bun.sh/install | bash -s -- 'bun-v1.4.0' 
   0      1s  04-pnpm  (86 B)  npm i -g pnpm@11.23.0 
   0     14s  05-dsh  (1179 B)  npm i -g @deepseek-ai/dsh@0.2.0-rc.2 
   0      0s  06-copy  (0 B)  cp -a /src/. /opt/mpd/ 
   0      7s  07-bun-install  (545 B)  bash -c cd '/opt/mpd' && bun install 
   0      1s  08-rebuild  (4309 B)  node /opt/mpd-e2e/lib/rebuild.ts --repo /opt/mpd --bun /opt/toolchain/bun-pinned/bin/bun --json /work/rebuild.json 
   0      0s  09-install  (161 B)  bash -c cd '/opt/mpd' && dsh plugin --profile web add '.' 
   0      0s  09a-install-closure  (329 B)  node /opt/mpd-e2e/lib/owed-install.ts --install-log /work/steps/09-install.log --exit 0 --roots /root/sandbox-dsh/profiles/web,/opt/mpd --state /work/assertions.ndjson 
   0      0s  08c-pack  (1328 B)  node /opt/mpd-e2e/lib/owed-pack.ts --artifact /src/dist/mpd-package --source /src --rebuild /opt/mpd --rebuild-report /work/rebuild.json --state /work/assertions.ndjson 
   0      1s  08c2-pack-control  (1467 B)  node /opt/mpd-e2e/lib/owed-pack.ts --artifact /work/pack-mutated --source /src --rebuild /opt/mpd --rebuild-report /work/rebuild.json --state /work/pack-control.ndjson 
   0      0s  10-dump  (87332 B)  node /opt/mpd/scripts/dump-config.ts --profile web 
   0      2s  09d-astgrep-engine  (1005 B)  node /opt/mpd/scripts/install-mcp.ts --toolchain /opt/mpd/.toolchain 
   0      0s  11b-mcp-surface  (591 B)  node /opt/mpd-e2e/lib/owed-mcp.ts --boot-log /work/steps/11-boot.log --state /work/assertions.ndjson --search-dir /opt/mpd/packages/mpd-mcp-astgrep/src 
  -1     26s  11-boot  (2132 B)  dsh --profile web --patch probe.yml --port 3197 --no-open (background; terminated by the harness after the assertions)
   0      0s  12-web-live  (1254 B)  skipped: no live credential staged
   0      0s  13-browser  (0 B)  skipped: MPD_E2E_BROWSER was not set
   0    105s  14-tui  (6368 B)  bash docker/tui-lane.sh
   0      0s  16-owed-lsp  (252 B)  node /opt/mpd-e2e/lib/owed-cases.ts --kind lsp --repo /root/sandbox-dsh/profiles/web/node_modules/@mpd-dsh/mpd --work /out/owed --state /work/assertions.ndjson 
   0      1s  16b-pack-refresh  (352 B)  node /opt/mpd/scripts/pack-mpd.ts 
   0      1s  16b2-case-engine  (963 B)  node /opt/mpd/scripts/install-mcp.ts --toolchain /opt/mpd/dist/mpd-package/.toolchain 
   0    363s  16c-owed-cases  (1107 B)  node /opt/mpd-e2e/lib/owed-cases.ts --kind cases --repo /opt/mpd --work /out/owed --qa-home  --state /work/assertions.ndjson 
```
