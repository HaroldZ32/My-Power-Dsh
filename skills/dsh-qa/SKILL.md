---
name: dsh-qa
description: "QA the my-power-dsh bundle against the REAL dsh binary in strict isolation. Every case must prove a plugin row is mounted (via dsh --dump-config) or a real tool call succeeds, write evidence to evidence/<domain>/<slug>/, and ship helper scripts that pass --self-test. Use whenever a bundle/plugin change, a DeepSeek route smoke, an MCP wire-up, an installer change, or a preset registration needs verification."
metadata:
  short-description: Isolated QA for the my-power-dsh bundle on the real DeepSeek Harness binary
---

# dsh-qa

QA skill: verify my-power-dsh bundle/plugin behavior with the real `dsh` binary in a **strictly isolated**
sandbox (temp DSH_HOME + sandbox HOME + sandbox workspace cwd — see Hard rule 1), writing evidence to
`evidence/<domain>/<slug>/`. Structure mirrors upstream
the upstream host QA skills.

## Hard rules

1. **Isolation**: every case creates a temp DSH_HOME (`mktemp -d`) and boots inside it; never read/write the
   real `~/.dsh`. Scripts must assert the sandbox path. **`DSH_HOME`/`HOME` do NOT isolate WORKSPACE
   state**: every workspace-scoped root resolves from the session workspace
   (`agent.session.header.cwd ?? process.cwd()` in the adopted plugin, `dsh.workspaceRoot(exec)` in ours),
   and a session cwd outranks `DSH_WORKSPACE_ROOT`, so the env cannot protect a case. Every dsh spawn and
   every `session/create` payload therefore carries an explicit sandbox cwd
   (`sandboxWorkspace(sandbox)` in `scripts/lib/workspace-isolation.mjs`), and the case calls
   `assertSessionsSandboxed(dshHome, sandbox)` — no `<DSH_HOME>/sessions/<projectKey(realCwd)>` key
   (e.g. `--root-dshProj-my-power-dsh--`) may exist. Roots that otherwise leak into the checkout:
   `.mpd/team`, `.mpd/memory`, `.mpd/boulder.json`, `.mpd/hashline-files.json`, `.mpd/verif`,
   `.mpd/plans`, `.mpd/ulw`, `.codegraph`.
2. **Provability**: assert that plugin rows are mounted (substring/structure assertions on
   `dsh --dump-config`) or that a real call succeeded (tool/skill/MCP executed and result asserted).
3. **Evidence**: each case writes `result.json` + raw output to
   `evidence/<domain>/<slug>/<timestamp>/`. Old evidence without a
   `result.json` (e.g. `evidence/dsh-qa/bline/2026-08-26T07-35-55.364Z/`,
   `evidence/plan-f/roles-subagent/2026-08-28T03-50-53/`) counts as incomplete;
   historical artifacts are never rewritten.
4. **--self-test**: every helper script ships `--self-test` (offline, no network, no real API).
5. **Language**: all descriptions, logs, and script strings are English.

## Cases (grow per phase)

All cases in this corpus are **software-type**: they exercise the harness/bundle software surface
(rows, tools, routes, sessions, files, processes) and never an EDA/RTL toolchain. The RTL/EDA
corpus and its golden fixtures live in the silicon sub-bundle
(`gitee.com/nop_chip/my-power-dsh-silicon`).

| slug | domain | assertion | phase |
|---|---|---|---|
| mount-assert | bundle mount | --dump-config contains/lacks expected plugin rows | P0 |
| dual-track-smoke | DeepSeek dual-track | deepseek-official and pi-ai deepseek routes both serve a real headless task; boots the DEV-FLAVOR patch (packed `@mpd-dsh/mpd/...` operand rewritten to checkout-absolute paths) so the boot really reaches the model step instead of dying `ERR_MODULE_NOT_FOUND @mpd-dsh/mpd` (that pre-existing boot failure made the sandbox-workspace isolation this case carries INERT) | P1 |
| mcp-call | MCP | mcp__ast_grep__*/mcp__lsp__* callable with server responses; sandboxed DSH_HOME **and HOME** (plugin state `~/.mpd` never touches the real home), `settings.yaml` copied alongside `.credentials.yaml` (AGENTS.md §7), and NO `MPD_DSH_*_CLI` / `MPD_AST_GREP_SG_PATH` / `MPD_CODEGRAPH_BIN` pin pre-set — a caller pin wins in the B8 launcher and would mask a broken operand | P3 |
| preset-register | roster | mpd main preset resolves FROM THE BUNDLE-SERVED ROOT (PRESET_PATH under the presets dir, trust system) with no $DSH_HOME/.agent-presets copy + mpdRoles serves the 11-role OMO roster; the dev-flavor rewrite consumes the WHOLE packed MCP operand (checkout-absolute launcher paths, no `<baseUrl>/node_modules/<abs-repo>` splice) and pre-sets no CLI/binary pin, so the boot proves the real B8 launcher chain resolves the MCP rows | P4/refactor |
| codegraph-smoke | codegraph | binary resolve -> init -> mcp__codegraph__explore real call. **This case pins `MPD_CODEGRAPH_BIN` to the toolchain binary BY DESIGN** — it exists to exercise that binary/init/tool-call path, so its green is NOT evidence that the bundle's own B8 resolution chain works (that is mcp-call's and the launcher-resolver tests' job). Do not remove the pin as if it were a masked defect | P4+ |
| agent-teams-adopt | agent-teams adopt | installer writes bundle dep + stateDir override (.mpd/team); composed config contains the row; real headless AgentTeams run creates team state + archives on delete; web profile serves /plugins/dsh-agent-teams/state | Plan C/C1 |
| ultrawork-smoke | ultrawork | plan gate, execution rounds, verification gate, quality-gate ledger in one real headless session | Plan C/C2 |
| plan-c-smoke | plan-c live | one headless session exercising mpd_config_get + mpd_boulder_* + mpd_hashline_* together | Plan C |
| memory-smoke | memory engine | real headless mpd_memory_write -> commit -> mpd_memory_read -> reflection hint | Plan C/C6 |
| vision-smoke | multimodal | deterministic PNG fixture + real DeepSeek vision API call, image-grounded answer asserted; route id vs official catalog | Plan C/C8 |
| tool-output-validation | plugin tools | mpd_config_get / mpd_boulder_status return host-validated lossless JSON (no "not lossless JSON" / "must be an object" errors); evidence per defect under evidence/fix/<slug>/ | C5/C7 |
| skill-catalog-probe | plan-d install | staged install -> the corpus is served from <bundle>/skills (NO $DSH_HOME/skills copy) -> real headless skill load of svn-master works; prerequisite: the staged pack (`dist/mpd-package/package.json`, reason `absent-staged-pack`) — absent ⇒ SKIP with the canonical marker, never a failure | Plan D |
| relocate-smoke | plan-d relocate | staged bundle installs with ZERO fixed checkout paths; dump-config no dev-path leak; real headless boot serves preset root + corpus from the RELOCATED package with no home copy; prerequisite: the staged pack (`dist/mpd-package/package.json`, reason `absent-staged-pack`) — absent ⇒ SKIP with the canonical marker, never a failure | Plan D/P5 |
| team-route-rewire | plan-e team route | staged install serves agent-teams from the bundle (first-class main code @mpd-dsh/mpd/packages/mpd-agent-teams-plugin, no @nanmicoder npm dep); agent-teams row mounted (stateDir .mpd/team, normal-named `mpd` roster profile); the INSTALLED package's mpd preset carries the AGENT.md convention + specialist rosters (mpd_role_spawn), routes team work to agent_teams_* and leaves no $DSH_HOME copy; real headless boot passes; prerequisite: the staged pack (`dist/mpd-package/package.json`, reason `absent-staged-pack`) — absent ⇒ SKIP with the canonical marker, never a failure | Plan E/refactor |
| workmate-library | plan-f workmate | legacy install mounts mpd-roles/workmate/bootstrap; real headless boot runs init->list->spawn->reflect->match against a SANDBOX HOME; asserts ~/.mpd/workmate files in the sandbox and that the real home is untouched; the self-test also pins the SIDEBAR surface (host `roster`/`get` routes, the client's `betterSidebar.registerTab` contribution, and that NO floater/footer-toggle fallback ships) AND the rename/delete surface: the POST-only `rename`/`delete` host routes with their `allow: POST` refusal, the §D reason matrix (`invalid-name`, `unknown`, `collision`, `in-use` + `blocking`, `confirm-required`), archive-first delete (`.archive/` root, purge returns `archived: null, purged: true`) and the service's `rename`/`delete` properties — so a route or reason rename cannot silently invalidate the docs | Plan F/workmate; workmate rename/delete |
| workmate-team-member | plan-f workmate team | real headless team run: workmate alice joins via agent_teams_add_member; asserts the member reports the injected memory (PINEAPPLE42) AND self-reflects (memory gains a second entry / uses>=2); real home untouched | Plan F/workmate |
| web-client-adapt | plan-f web client | manual-copy web boot proves the @mpd-dsh/mpd client entry appears in the boot graph (mpd-web-compat self-row), /plugins/@mpd-dsh/mpd/client.js serves and registers the matching id, /plugins/mpd-workmate/list + /init answer and create under a SANDBOX HOME; the self-test also pins that the client's rename/delete URLs match the host's rename/delete route literals and that it branches on every §D refusal reason; real home untouched. The boot-graph deadline is 150 s (env-overridable `MPD_DSH_QA_WEB_BOOT_DEADLINE_MS`) and `bootEntry` records `elapsedMs`/`deadlineMs`/`timedOut`, because the old hard 60 s deadline went red at ~69 s under concurrent load and passed solo — a slow-but-healthy boot must stay visibly BOUNDED and never read as "the client entry is missing" | Plan F/workmate |
| agent-teams-dispatch | fix scheduler wakeup | the shared-task scheduler must wake the next batch after the first batch completes. Offline self-test asserts the INSTALLED host contract (no `subagent followup` member; the public `ctx.subagents.prompt(request, signal)` continuable seam exists), that member delivery goes through `queueMemberPrompt` preferring `runtime.prompt` with the older followup/symbol-queue forms kept only as fallbacks, that both scheduler triggers exist (task mutation → kickTeam, idle edge → kickMember), that a failed delivery rolls the claim back, that the modern member setup takes the live Agent from the `agent/session-start` payload (never `childCtx.agent`), and that members are denied every captain-only tool. Real run: isolated headless two-task dependency chain, asserts both tasks completed AND the scheduler's automatic assignment prompt reached the member owning the DEPENDENT task (the first-batch member can finish inside its spawn turn from the join prompt and need no wake — that is correct, so the marker is asserted on the dependent assignee only). NOTE the scheduler is driven by live idle edges, so the one-shot headless captain must OUTLIVE member settlement — the probe prompt has it run three separate `sleep 110` bash calls after approving (process exit disposes every member, so without the hold-open no member ever reaches idle); the case reads the current `session.v3.jsonl.zstd` log name (legacy `session.jsonl.zstd` kept as fallback) | fix/scheduler-wakeup |
| session-start-team | fix session-start team gate | isolated headless boot, TWO-SIDED on the same settled revision hash (git rev-parse HEAD + file sha256, stable over a 50 s settle window), each side in its own sandbox workspace with `sandboxWorkspace` + `assertSessionsSandboxed`: the installer row and the composed config carry `sessionTeamPolicy` with `mode: "off"` + `autoRoute: true` (the gate default) and the configPlane keys; each of the 3 verbatim SIMPLE prompts leaves NO new `.mpd/team/**/team.json` and NO startup-notice marker in the session log; each of the 3 verbatim COMPLEX prompts (incl. `team: fix the flaky test` and the 4-step numbered one) leaves EXACTLY ONE staged `MPD Default` team (profile mpd, members not spawned) AND the notice marker. Assertion objects are limited to `.mpd/team/**/team.json` and the log marker; the offline `--self-test` pins the gate predicate against both prompt sets, so a gate that cannot fail one side cannot pass | fix/session-start-team |
| bundle-lifecycle | bundle install/uninstall | ONE command straight from the checkout — `dsh plugin --profile w add <repo root>` (the repo root manifest IS `@mpd-dsh/mpd`, no pack step) — installs the whole capability set as ONE unit (dependency + dsh.profile.bundles), a real boot serves the mpd preset (PRESET_PATH under the installed bundle, trust system) and the skill corpus from the installed bundle with NO $DSH_HOME copy, the boot also proves the harness adapter (row `mpd-dsh-adapter`, boot line, probe `ADAPTER_SEAMS=…` + `ADAPTER_TOOL_CALL=ok`), then `dsh plugin remove` takes dependency + bundle entry + composed rows + installed tree away, restores the stock preset row and leaves zero bundle residue in DSH_HOME/HOME | bundle 0.3.0 (plugin unit) |
| preset-conformance | fix preset mount (harness drift) | the `mpd` preset must MOUNT, and every harness-owned row config in this repo must still mean what the INSTALLED harness says it means. Offline self-test: each `@deepseek-ai/*` row in `presets/mpd/agent.cordis.yml`, the bundle patch and the QA overlays is validated against the installed packages' own schemastery schemas — required keys satisfied AND no unknown key (schemastery DROPS unknown keys silently, so a `persona:`-style rename loses the setting with no error anywhere), with `!!js` nodes materialized so expression-bearing rows are checked too; plus row-id PARITY with the installed shipped `standard` preset, and the persona row must carry `prefix` (the `text:` form died in 0.1.3-alpha.2 and made EVERY mpd session fail to mount). Real run: an isolated DSH_HOME/HOME boots the web profile FROM THIS CHECKOUT and creates a session with `agentPreset: "mpd"` over the gateway (`session/create` mounts the preset's standing composition and refuses on any inactive row, so its `ok: true` IS the mount proof), asserts the durable session header records `agentPreset: "mpd"` and the boot log carries no apply-failure signature — then a NEGATIVE CONTROL boots the same sandbox against a copy of the preset rewritten back to `text:` and must fail with `$.prefix missing required value`, so the positive assertion cannot pass vacuously | fix/preset-mount |
| agent-teams-sidebar | agent-teams GUI migration | the SHIPPED bundle client registers exactly ONE DSH-better-sidebar tab for AgentTeams (id mpd-agent-teams, order 85, single, auto-open switch) and carries the `@mpd-dsh/team-page` module — asserted on an isolated sandbox COPY of `packages/mpd-bundle-plugin/client.js`, both textually and by really evaluating it in a module-loader runtime written by the case; no mpd client source registers a removed surface (`agent-teams-activity`, `conversation.chat.node`) while `conversation.chat.commandview` stays; the adopted client carries the mpd export bridge (marker region + 17 pinned exports, patch script idempotent); the auto-open is SEEDLESS (`seedlessAutoOpen`: `openTab({ type: TEAM_TAB_ID })`, no `path`/`url` — from dsh-better-sidebar 0.19 a seeded open is routed to DSH's native right column, where the retired marker path failed `realpath` with `cannot resolve target "…/team-activity"` and the tab never opened); and a REAL offline web boot in a sandbox proves the host route `/plugins/dsh-agent-teams/state` (HTTP 200 with a `teams` array) plus the SERVED `@mpd-dsh/mpd` client bundle carrying the page module and tab id — falling back to the plugin-row + server-half-source assertion, said honestly in result.json, when no `dsh`/installed profile is available | agent-teams GUI migration |
| readonly-deny | fix read-only spawn | a READ-ONLY specialist spawn must really START a child **and that child must be RESTRICTED**: the offline self-test pins that the roles AND workmate deny lists (src + built dist) carry exactly the seven live-registered write-capable names (`write, edit, mpd_hashline_edit, bash, mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__lsp__rename`), that the two unregistered legacy editor names are absent from every copy, and that the shipped MCP servers really expose `rewrite`/`scan`/`rename` plus the agent-plane composition that explains the original failure. The live part needs NO provider credential — a local OpenAI-shaped stub answers the PARENT model step with one `mpd_role_spawn` call inside a FRESH dsh process (throwaway key), so the child-composition path really runs; it asserts that the exact seven-name list reaches the harness, that a child is CREATED AND ANSWERS, and — the load-bearing part — that the child's own requests **EXPOSE NONE of the seven write-capable names** while the parent's exposes all seven (measured: child 81 tools with none of the seven, parent 87 with all seven plus `structured_output`). Falsifiability is not rhetorical: a re-injection control lane FIRST PROVES the mutation loaded (`mutationLoaded`, read from the filter the adapter actually delivered) and THEN shows the child receiving the FULL tool set with no refusal — so the enforcement assertion is genuinely **falsifiable**, and that falsifiability was independently witnessed from the reviewer's side on the final bytes rather than taken from the author's word. **The measured failure mode is SILENT UN-GUARDING, not a loud refusal**: a stale-but-still-known name does not throw — the list is accepted, the denial it should have contributed simply never takes effect, and the child receives the full unguarded toolset with no error anywhere (two anchors: `@deepseek-ai/dsh-subagent` applies the filter only when `composition.toolFilter` is defined, while `@deepseek-ai/dsh-tools` throws only for names OUTSIDE `view(scope).restrictableNames` — so the ABSENCE of a refusal must never be read as a pass in either direction). Consequently the enforcement assertion demonstrably fails whenever the restriction is absent, and a run that never reaches a child cannot pass vacuously. Do not read this row's freshness from the file mtime: this file once carried a NEWER mtime than the case change while still describing the old pass condition. (The case also relays the build: `dsh --dump-config` is not a health signal because it never executes plugin code, and an in-session call cannot prove this because plugin code is loaded at boot.) | fix/readonly-deny |

| software-smoke | software dev flow | a REAL headless mpd session (local OpenAI-shaped stub, throwaway key — no provider credential) writes a tiny deterministic game with the `write` tool and runs it with the `bash` tool in a SANDBOX workspace; the case replays the program's REAL transcript through its OWN oracle (legality, optimality, winner, determinism) and requires the mutation control to go RED | RTL-extraction follow-up (t8) |

### Absent prerequisites: SKIP with a reason (fresh clones)

A case whose prerequisite is not present must SKIP, not FAIL — while an explicit strict request
must still fail loudly, and a *broken* prerequisite always fails:

| lane | prerequisite | strict flag | exit | stdout |
|---|---|---|---|---|
| `--self-test` | absent | none | 0 | one `[mpd-qa] SKIP …` line as the FIRST stdout line |
| `--self-test` | absent | `--no-skip` or `--require-pack` | 1 | one `[mpd-qa] FAIL …` line (first on stdout) |
| real run | absent pack | none | 0 | one `[mpd-qa] SKIP …` line (first on stdout), NO evidence directory |
| real run | absent pack | either strict flag | 1 | one `[mpd-qa] FAIL …` line |
| real run | absent credentials in a case that does NOT declare them skippable | any | 1 | the case's own failure (e.g. `missing credentials`) |
| any | present but broken | any | 1 | the case's own FAIL — a skip is never allowed here |

Marker grammar (exactly one line per invocation, the FIRST stdout line of the case's output; emitted
on stdout in both the SKIP and the FAIL mode):
[mpd-qa] SKIP case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"
[mpd-qa] FAIL case=<slug> lane=<self-test|real> reason=<code> prereq=<path|probe> remedy="<command|doc:path#section|->"

Reason codes: absent-staged-pack / absent-toolchain-binary / absent-credentials /
absent-model-route / absent-dsh-binary / absent-harness-closure / absent-runtime /
absent-fixture / unsupported-platform.

Rules: probe the exact prerequisite positively (never catch a failure); run prerequisite-independent
assertions first; a present prerequisite is always checked and always fails loudly when broken;
a prerequisite that is not declared skippable is never routed through the gate; never build/execute
the remedy from a lane; never print a PASS after a skip; one marker per case.

Callers: exit 0 + a SKIP line = skipped (never a pass); exit 0 with no marker = pass; exit 1 = fail.
Count skips: `bun run test:qa 2>&1 | grep -c '^\[mpd-qa\] SKIP '`.
Strict suites (no skips tolerated): `bun run test:qa:strict` (self-tests), `bun run test:qa:all` (real lanes).
Declare prerequisites in the case header, one line each, in check order:
`// PREREQ: <reason-code> <repo-relative-path-or-probe> <remedy>`
Strict flag spellings: `--no-skip` (generic) and `--require-pack` (the reserved, case-specific name for
the staged pack); a case that has both accepts either, with identical semantics.

## Run

```bash
bun run test:qa                          # all self-tests
node skills/dsh-qa/scripts/mount-assert.mjs --self-test
node skills/dsh-qa/scripts/<case>.mjs    # one real case (isolated DSH_HOME + sandbox workspace cwd)
```
