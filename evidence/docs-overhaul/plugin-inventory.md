# Plugin + tool/command inventory — t1 fact base (Architect, read-only)

**Measured:** 2026-09-19T10:21Z–10:26Z in workspace `/root/dshProj/my-power-dsh`, working tree at
`a9c3c3e` **plus the uncommitted doc-wave edits in flight at measurement time**.

**Anchors (sha256 of the exact bytes this report describes — re-hash before trusting a number):**

| Artifact | sha256 |
|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `d12dc97f6fda53691e1d2abfd7c3b95ee001673da14078d1d86599d7927f91d4` |
| `package.json` | `ef7d0884e56df8cafd8a485a870dcab49b895c6e81e200139c28d1a58ec4f763` |
| `VENDOR_LOCK.json` | `4ae15e8149cb0f250fc29af42e6d4e9793295028ff10511c1dc2b4c37b064477` |
| `LICENSE-NOTICES.md` | `82a97397891d02753193ce1ea97c71a97fff51992fed1f78a679fdab8c029f78` |
| `README.md` | `2357bb31e6b15211e31dc9ac12ef02080109772556453e8a072ff862b243926b` |
| `docs/user-guide.md` | `a0b956bdb27b3ac71dbe8901b7455d9591eeb75554e85fad160b63a5afb1ced1` |
| `docs/design.md` | `6c53f452ea6c58a0a288bf2c124e190e8f583351cab7d373f9da4ff77f4c683b` |
| `docs/design.zh-CN.md` | `ae3cbe5510c326e5307ea1576d8e41fddcec23c5b278176ffc048697a3a37035` |

**MOVING TARGET — read before citing a line.** While this fact base was being built, another lane
renamed `docs/architecture.md` → `docs/design.md` (+ `.zh-CN`) and began rewriting it (`git status`:
` D docs/architecture.md`, ` D docs/architecture.zh-CN.md`, `?? docs/design.md`,
`?? docs/design.zh-CN.md`). Every `docs/architecture.md` citation below is therefore given with BOTH
identities: the pre-rename path as it exists at `git show HEAD:docs/architecture.md`, and the current
path with the hash measured here. **Cite by heading/symbol, never by line (T-55).**
A rename is a HOP, not a free edit: `docs/architecture.md` still being linked from anywhere is a real
finding until t3 lands and t12 repoints.

---

## 0. Commands actually run, with exit codes

| # | Command | Exit | What it proves |
|---|---|---|---|
| 1 | `node scripts/verify-rows-parity.mjs` | **0** | patch `- insert:` ids (25) == the legacy installer's dry-run row ids; no duplicates |
| 2 | `node scripts/dump-config.mjs --profile web` | **1** | BLOCKED, environment: `EROFS: read-only file system, open '/root/.dsh/profiles/web/cordis.yml'` — the file sandbox (workspace-write) denies the harness's profile write. Raw log: `evidence/docs-overhaul/raw/web-cfg.err` |
| 3 | `node scripts/dump-config.mjs --profile dsh-tui` | **1** | same, `…/dsh-tui/cordis.yml`. Raw log: `evidence/docs-overhaul/raw/tui-cfg.err` |
| 4 | `git show HEAD:docs/architecture.md \| diff - docs/design.md` | 1 (differs) | the rename/rewrite is genuinely in flight |
| 5 | `git status --porcelain` | 0 | ` D docs/architecture.md`, ` D docs/architecture.zh-CN.md`, `?? docs/design.md`, `?? docs/design.zh-CN.md`, `?? evidence/docs-overhaul/` |
| 6 | read-only scans (python/grep over `packages/*/src/**`, `packages/mpd-agent-teams-plugin/lib/**`, `presets/mpd/**`, the docs) | 0 | every count in §1–§6 |

**Gate semantics you must not over-read (row 1).** `verify-rows-parity` compares the patch's 25
`- insert:` ids against what `scripts/install-profile.mjs --dry-run` prints. It does **not** parse the
preset, and it deliberately excludes the file's two column-0 id-TARGET (`- id:`, replace) rows and
commented-out rows. A green run therefore means "the legacy installer and the bundle patch declare the
same insert set" — never "the preset is valid" and never "the rows mount".

### 0b. Live-surface evidence (used for §2 and §5)

This report was written **from a live session that runs the `mpd` preset on the Web profile** (an
Architect teammate of team `mpd-default-c1a3fcab`). The harness tool list of that session is a direct
measurement of the mounted surface, not a composition reading:

- **All 42 bundle-owned tools are present**, including `session-watchdog-hold/-resume/-status` and
  `mpd_team_compact_run/-status` → those two rows are LIVE on the **Web** profile.
- **No `mcp__git_bash__*` tool exists** in that session → `mcp-gitbash`'s `disabled: true` is real at
  runtime, not a cosmetic flag.
- MCP families present: `mcp__ast_grep__*`, `mcp__lsp__*`, `mcp__codegraph__*`, `mcp__context7__*`,
  `mcp__grep_app__*`.
- `agent_teams_*`: 21 tools present (matches the 21 registrations in
  `packages/mpd-agent-teams-plugin/lib/tools.js`).

No `--dump-config` output is cited as load evidence anywhere in this report (runs 2–3 failed for an
environment reason and are recorded as such).

---

## 1. Bundle rows — all 27 (25 inserts + 2 id-targets)

Source of every row: `packages/mpd-bundle/cordis.patch.yml` (hash above). `line` is the patch line at
that hash. "Composition" is explained in §5; short form: **all rows are composed in BOTH the Web and
the dsh-tui profile** (the bundle is listed in both profiles' `dsh.profile.bundles` — §5), and the
column notes the activation difference.

| # | line | row id | entry name (resolves through the bundle exports map) | purpose | tools / commands / services | key config (as declared in the row) | composition |
|---|---|---|---|---|---|---|---|
| 1 | 28 | `agent-presets` *(id-TARGET, replace)* | `@deepseek-ai/dsh-agent-presets` | serve the bundle's own preset root as the default roster | — | `default: mpd`; `roots: [{path: <bundle>/presets, trust: system}]` | Web/base plane only (row owner `dsh-web-app`); absent in dsh-tui → `patch: entry agent-presets not found`, skipped |
| 2 | 93 | `dsh-tui-agent-presets` *(id-TARGET, replace)* | `@deepseek-ai/dsh-agent-presets` | same default + root, for the TUI plane | — | `default: mpd`; `roots: [{path: <bundle>/presets, trust: system}]` | dsh-tui only (minted by the TUI's own patch); absent in Web |
| 3 | 110 | `mcp-astgrep` | `@deepseek-ai/dsh-mcp-client` | ast-grep MCP server (stdio, in-repo) | `mcp__ast_grep__search/rewrite/scan` | `serverName: ast_grep`; `command: node`; `args: [<bundle>/packages/mpd-mcp-astgrep/launch.mjs]` (override `MPD_DSH_ASTGREP_CLI`); `toolCallTimeoutMs: 60000` | both; active |
| 4 | 121 | `mcp-gitbash` | `@deepseek-ai/dsh-mcp-client` | git-bash MCP server (upstream design: native Windows) | `mcp__git_bash__*` (`run`, `diagnose`, `which_bash` in `dist/cli.js`) when enabled | **`disabled: true`**; `serverName: git_bash`; `command: node`; `args: [<bundle>/packages/mpd-mcp-gitbash/dist/cli.js]`; `toolCallTimeoutMs: 60000` | both; **NOT mounted** unless a deployment flips `disabled: false` |
| 5 | 131 | `mcp-lsp` | `@deepseek-ai/dsh-mcp-client` | LSP bridge (stdio, in-repo) | `mcp__lsp__diagnostics/find_references/goto_definition/install_decision/prepare_rename/rename/status/symbols` | `serverName: lsp`; `args: [<bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]`; timeout 60000 | both; active |
| 6 | 150 | `mcp-codegraph` | `@deepseek-ai/dsh-mcp-client` | code-graph server (stdio, in-repo) | `mcp__codegraph__codegraph_explore` | `serverName: codegraph`; `args: [<bundle>/packages/mpd-mcp-codegraph/launch.mjs]`; timeout 60000 | both; active |
| 7 | 205 | `mpd-web-compat` | `@mpd-dsh/mpd` | web-compat self-row: the loader entry named exactly `@mpd-dsh/mpd`; hosts the combined client | no-op apply; `./client` export | — | both; load-bearing for the Web client graph |
| 8 | 212 | `mpd-dsh-adapter` | `…/mpd-dsh-adapter-plugin/dist/index.js` | THE single contact surface with harness seams | service `mpdDsh` | — (row defaults) | both; active |
| 9 | 216 | `mpd-config` | `…/mpd-config-plugin/dist/index.js` | minimal `mpd.jsonc` runtime config layer | `mpd_config_get`, `mpd_config_reload`; service `mpdConfig` | — | both; active |
| 10 | 227 | `mpd-team-watchdog` | `…/mpd-team-watchdog-plugin/dist/index.js` | HOST-plane heartbeat store + WARN→ESCALATE machine + restorable scene + `watchdogHold` sidecar | `session-watchdog-hold`, `session-watchdog-resume`, `session-watchdog-status` | `stateDir: .mpd/team`; `warnSilenceMs: 600000`; `tickIntervalMs: 15000`; `warnStreakToEscalate: 6`; `actionOnEscalate: warn-only`; `toolInFlightMaxMs: 900000`; `holdTtlMs: 900000` | both; **applies to Web** (§5.3) |
| 11 | 244 | `mpd-tools` | `…/mpd-tools-plugin/dist/index.js` | write guard, tool-output truncation, edit-error recovery | waterfalls only (no tool) | `writeGuard: true`; `truncateMaxBytes: 8192` | both; active |
| 12 | 249 | `mpd-modelchain` | `…/mpd-modelchain-plugin/dist/index.js` | DeepSeek route resolution for roster roles + key/value memory notes | `mpd_modelchain_resolve`, `mpd_memory_save`, `mpd_memory_recall` | — | both; active |
| 13 | 272 | `mpd-ext` | `…/mpd-ext-plugin/dist/index.js` | extension interface: frozen descriptor v1, code + data planes, stdio MCP bridge, extension roles | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show`; service `mpdExtensions` | `quiet: false` | both; active |
| 14 | 276 | `mpd-roles` | `…/mpd-roles-plugin/dist/index.js` | the 11-specialist roster (+ extension roles merged per call) | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`; service `mpdRoles` | — | both; active |
| 15 | 278 | `mpd-ulw` | `…/mpd-ulw-plugin/dist/index.js` | ultrawork v2 loop discipline | `mpd_ultrawork`, `mpd_ulw`; **commands `/ulw`, `/ultrawork`** | `maxRounds: 3` (row) | both; active |
| 16 | 282 | `mpd-hashline` | `…/mpd-hashline-plugin/dist/index.js` | hash-anchored edit discipline | `mpd_hashline_read/edit/format/restore` | `guardEditTools: true` | both; active |
| 17 | 286 | `mpd-boulder` | `…/mpd-boulder-plugin/dist/index.js` | durable work ledger bound to plan markdown | `mpd_boulder_status/start/complete/task_timer/plan_progress/plans` | — | both; active |
| 18 | 288 | `mpd-comment-checker` | `…/mpd-comment-checker-plugin/dist/index.js` | comment/docstring detection (opt-in binary) | `mpd_comment_check` | `autoCheck: false` (row) | both; active |
| 19 | 292 | `mpd-codegraph` | `…/mpd-codegraph-plugin/dist/index.js` | codegraph binary resolve + project index init | effect (auto init) + **command `/mpd-codegraph`** | `autoInit: true`; `initTimeoutMs: 60000` | both; active |
| 20 | 297 | `mpd-memory` | `…/mpd-memory-plugin/dist/index.js` | VCS-backed memory + reflection state machine | `mpd_memory_write/read/reflect/reflect_complete/status` | `vcs: git` | both; active |
| 21 | 301 | `mpd-workmate` | `…/mpd-workmate-plugin/dist/index.js` | durable evolving agent library under `~/.mpd/workmate/` | `mpd_workmate_list/init/spawn/reflect/match/rename/delete`; service `mpdWorkmate`; routes `GET /plugins/mpd-workmate/{list,roster,get}`, `POST /plugins/mpd-workmate/{init,rename,delete}` | — | both; active |
| 22 | 309 | `mpd-team-compact` | `…/mpd-team-compact-plugin/dist/index.js` | compact a FINISHED team's members; audit under `<workspace>/.mpd/team-compact/` | `mpd_team_compact_run`, `mpd_team_compact_status` | — | both; **applies to Web** (§5.3) |
| 23 | 316 | `mpd-bootstrap` | `…/mpd-bootstrap-plugin/dist/index.js` | provisioning BY REFERENCE: serves `<bundle>/skills` through a `ctx.skills` provider (rank 600 `bundled`); removes bundle ≤ 0.2.6 home copies | effect only | — | both; active |
| 24 | 329 | `mpd-tui` | `…/mpd-tui-plugin/dist/index.js` | DSH-TUI edition surfaces (status line, board scene, `/mpd` tree, dialogs, shortcuts, `/settings` section) | **command `/mpd`** (TUI only); no model tool | — | both composed; **surfaces active only under dsh-tui** (§5.2) |
| 25 | 341 | `agent-teams` | `…/mpd-agent-teams-plugin/lib/index.js` (adopted, MIT) | multi-agent team collaboration: captain, members, tasks, dependency-aware scheduler, mailboxes; its views back the AgentTeams sidebar tab | 21 `agent_teams_*` tools; **command `/agent-teams` + generated alias `/agent-teams-mpd`**; web routes `/plugins/dsh-agent-teams/{state,halt,plan,assets}` | `stateDir: .mpd/team`; `memberProvider: spawn`; `memberMaxDepth: 1`; `maxMembers: 16`; `sessionTeamPolicy: {mode: off, autoRoute: true, profile: mpd, presets: [mpd], name: "MPD Default", approval: required}`; `profiles.mpd` = the 11 normal-named members | both; active |
| 26 | 496 | `mcp-context7` | `@deepseek-ai/dsh-mcp-client` | remote MCP (streamable-http) | `mcp__context7__resolve-library-id`, `mcp__context7__query-docs` | `serverName: context7`; `url: https://mcp.context7.com/mcp`; timeout 60000 | both; needs network |
| 27 | 503 | `mcp-grepapp` | `@deepseek-ai/dsh-mcp-client` | remote MCP (streamable-http) | `mcp__grep_app__searchGitHub` | `serverName: grep_app`; `url: https://mcp.grep.app`; timeout 60000 | both; needs network |

**Two rows exist in the file ONLY as comments and mount nowhere** (patch lines 174–194): `mcp-wave-mcp`
and `mcp-traceweave` (optional external Python servers). They are NOT rows and must not be counted as
such; §7 M-3 below is what happens when a document does count them.

**Reconciliation (this is the arithmetic a doc lane should reuse):**
25 inserts = 6 MCP-client rows (4 local + 2 remote) + 17 `mpd-*` rows + 1 `mpd-web-compat` self-row
(+ the adopted `agent-teams` row) → 6 + 17 + 1 + 1 = 25. ✔
18 `mpd-*` insert rows total (17 + `mpd-web-compat`). ✔

**Packages with NO row (expected, not an omission):** `mpd-bundle` (the patch directory itself),
`mpd-mcp-shared` (shared library), `mpd-qa-roles-probe` (QA-only probe, overlay-mounted).

---

## 2. The complete tool surface (42 bundle-owned + 21 adopted = 63)

Counts are double-derived and they agree: a regex scan of `registerTool({…})` in `packages/*/src/**`
(35), the three watchdog constants (`actions.ts` `HOLD_TOOL`/`RESUME_TOOL`/`STATUS_TOOL`), the four
`mpd-ext` tool definitions, and the live session tool list (§0b).

| Owning row | Tools |
|---|---|
| `mpd-config` | `mpd_config_get`, `mpd_config_reload` |
| `mpd-team-watchdog` | `session-watchdog-hold`, `session-watchdog-resume`, `session-watchdog-status` |
| `mpd-tools` | *(none — waterfalls only)* |
| `mpd-modelchain` | `mpd_modelchain_resolve`, `mpd_memory_save`, `mpd_memory_recall` |
| `mpd-ext` | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` (+ one `mcp__<server>__<tool>` per extension-declared stdio server, e.g. the disabled example's `mcp__lint-mcp__describe_extension`) |
| `mpd-roles` | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona` |
| `mpd-ulw` | `mpd_ultrawork`, `mpd_ulw` |
| `mpd-hashline` | `mpd_hashline_read`, `mpd_hashline_edit`, `mpd_hashline_format`, `mpd_hashline_restore` |
| `mpd-boulder` | `mpd_boulder_status`, `mpd_boulder_start`, `mpd_boulder_complete`, `mpd_boulder_task_timer`, `mpd_boulder_plan_progress`, `mpd_boulder_plans` |
| `mpd-comment-checker` | `mpd_comment_check` |
| `mpd-codegraph` | *(none — effect + `/mpd-codegraph` command)* |
| `mpd-memory` | `mpd_memory_write`, `mpd_memory_read`, `mpd_memory_reflect`, `mpd_memory_reflect_complete`, `mpd_memory_status` |
| `mpd-workmate` | `mpd_workmate_list`, `mpd_workmate_init`, `mpd_workmate_spawn`, `mpd_workmate_reflect`, `mpd_workmate_match`, `mpd_workmate_rename`, `mpd_workmate_delete` |
| `mpd-team-compact` | `mpd_team_compact_run`, `mpd_team_compact_status` |
| `mpd-bootstrap` / `mpd-tui` / `mpd-dsh-adapter` / `mpd-web-compat` | *(no tools)* |
| **bundle-owned subtotal** | **42** |
| `agent-teams` (adopted) | `agent_teams_create`, `_approve`, `_edit_plan`, `_add_member`, `_remove_member`, `_create_task`, `_reassign_task`, `_claim_task`, `_update_task`, `_send_message`, `_status`, `_resume`, `_delete`, `_task_contract`, `_path_owner`, `_move_path`, `_rollover`, `_mailbox_check`, `_mailbox_clear`, `_interject_request`, `_interject_decide` (**21**) |
| **total** | **63** |

**Not a tool, despite the name:** `agent_teams_halt` is a *string constant* naming the pause mechanism
(`lib/mpd-deltas.js` `PAUSE_MECHANISM`, `lib/tools.js`); the operator reaches it through the **web
Stop-team route**. It is not registered as a callable tool (21 registrations, no `halt`) and does not
appear in a live session's tool list. A doc that lists it beside `agent_teams_*` tools is wrong.

**Roster facts (for §4/§5 doc claims):** `packages/mpd-roles-plugin/src/roles.data.ts` `ROLES` has
exactly **11** entries — Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer,
Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The read-only deny list
(`packages/mpd-roles-plugin/src/index.ts` `READONLY_DENY`) is exactly **7** names: `write`, `edit`,
`mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename`.

---

## 3. Slash commands (every one that exists)

| Command | Registered by | Composition |
|---|---|---|
| `/ulw <objective>`, `/ultrawork <objective>` | `mpd-ulw` (via `dsh.registerCommand` in the adapter) | both |
| `/mpd-codegraph` | `mpd-codegraph` | both (a no-op disposer if the composition has no command registry) |
| `/mpd` (bare picker; `/mpd board|team|workmates|status`) | `mpd-tui` (`COMMAND_ROOT = "mpd"` in `src/command-trees.ts`) | **TUI only** — under Web the registration reports `refused`/`absent` and nothing is exposed |
| `/agent-teams` | adopted `agent-teams` (`lib/command.js` `AGENT_TEAMS_COMMAND`) | both |
| `/agent-teams-mpd` | same file, `profileCommandName("mpd")` — one generated alias per command-representable profile key | both |
| `/settings` | host (the TUI settings screen; the bundle contributes the MPD section through `mpd-tui` + `mpd-config`) | TUI |
| `/goal` | host row owned by the `mpd` PRESET (`presets/mpd/agent.cordis.yml`) — the Web overlay disables the host `tool-goal`/`command-goal` rows | both |

**There is no `/roster` command.** See §7 M-2.

---

## 4. MCP tool families

| Row | Family | Tools observed/declared |
|---|---|---|
| `mcp-astgrep` | `mcp__ast_grep__*` | `search`, `rewrite`, `scan` |
| `mcp-lsp` | `mcp__lsp__*` | `diagnostics`, `find_references`, `goto_definition`, `install_decision`, `prepare_rename`, `rename`, `status`, `symbols` |
| `mcp-codegraph` | `mcp__codegraph__*` | `codegraph_explore` |
| `mcp-context7` | `mcp__context7__*` | `resolve-library-id`, `query-docs` |
| `mcp-grepapp` | `mcp__grep_app__*` | `searchGitHub` |
| `mcp-gitbash` | `mcp__git_bash__*` | `run`, `diagnose`, `which_bash` — **row disabled by default; absent from a live Web session** |

---

## 5. Composition — every row, Web vs dsh-tui

### 5.1 The shared fact
Both installed profiles list the bundle, so the ONE patch layer composes into both (measured:
`~/.dsh/profiles/web/package.json` → `dsh.profile.bundles` = `[@deepseek-ai/dsh-base,
@deepseek-ai/dsh-web-app, @linxin666/dsh-web-all, dshmarket, dsh-cost-meter,
nowledge-mem-deepseek-harness, @mpd-dsh/mpd]`; `~/.dsh/profiles/dsh-tui/package.json` →
`[@deepseek-ai/dsh-base, @deepseek-harness-tui/dsh-tui, @mpd-dsh/mpd]` — the bundle is the THIRD layer
there). Therefore: **every row in §1 is composed in both profiles**, with the two activation
differences named in the table: the two id-TARGET preset rows are plane-specific (each exists in
exactly one composition, which is why neither can duplicate the other's loader entry id), and
`mcp-gitbash` is `disabled: true` in both.

### 5.2 `mpd-tui` — composed in Web, surfaces only under dsh-tui
Apply in Web is not an error: the plugin binds each TUI seam through `onService(ctx, id, …)`
(`packages/mpd-tui-plugin/src/host.ts`), which uses `ctx.inject([id], …)` + `readableService(scoped,
id)` → `scoped.get(id, false)`, and records a per-seam outcome (`absent`/`refused`/`requested`). With
none of the `tui*` services present the row loads, registers nothing and stores a degrade outcome; it
never takes the boot down, and there is no `/mpd` command and no status line on Web. The patch comment
at that row states the same rule.

### 5.3 `mpd-team-watchdog` and `mpd-team-compact` — BOTH apply to Web (explicit answer)
- **Row plane:** both are HOST-plane rows in the bundle patch, not preset rows. The patch comment on
  `mpd-team-watchdog` gives the reason verbatim: *"HOST plane on purpose: a preset row's listeners
  are scoped to one agent, so a preset-mounted tick could not witness a wedged CAPTAIN (AC-9)."*
- **Live proof:** this report's own session is a **Web** session and its tool list contains
  `session-watchdog-hold`, `session-watchdog-resume`, `session-watchdog-status`,
  `mpd_team_compact_run` and `mpd_team_compact_status` — i.e. both rows are mounted and their tools
  are callable on Web. (The watchdog's own state files live beside the adopted `team.json` under
  `<workspace>/.mpd/team/`; `mpd-team-compact` writes audits under `<workspace>/.mpd/team-compact/`.)
- **Not GUI-dependent:** neither needs a sidebar tab, a TUI seam or a web route; their surfaces are
  tools. So the answer for all three question rows is: `mpd-team-watchdog` → yes, `mpd-team-compact` →
  yes, `mpd-tui` → row yes / surfaces no.

---

## 6. Third-party ledger (versions, licences, targets)

| Component | Version / pin | Licence | Where it lives here | Declared in |
|---|---|---|---|---|
| **oh-my-openagent** (OMO) | commit `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`, `v5.0.0-beta.20` | SUL-1.0 (this repo inherits it) | roster + model-chain vocabulary + the adapted teammate/workmate BASE templates; corpus fingerprinted as `assets.skills` (**326 files**, treeSha) | `VENDOR_LOCK.json`; `LICENSE-NOTICES.md` §1; `AGENTS.md` §1 |
| **dsh-agent-teams** (adopted plugin) | adopted package version **`0.1.16-rc.3-mpd`** = a `0.1.14` body with the audited `0.1.16-rc.3` deltas backported; `lib/client.js` is still the **0.1.14** build | MIT (© 2026 程序员阿江(Relakkes)) — verbatim text in `packages/mpd-agent-teams-plugin/LICENSE` | `packages/mpd-agent-teams-plugin/` (lib + assets) + runtime closure `_deps/` (**635 files**, treeSha) | `LICENSE-NOTICES.md` §dsh-agent-teams; row `agent-teams` |
| vendored `_deps` closure | versions pinned to the host at vendor time | MIT | `@deepseek-ai/{schemastery, cosmokit, cordis, dsh-scope, dsh-timeout, dsh-llm, dsh-session, dsh-subagent, dsh-tools, dsh-agent}`, `zod`, `@standard-schema/spec` — each with its own LICENSE retained | `LICENSE-NOTICES.md`; regenerate with `node scripts/vendor-agent-teams.mjs` |
| **`@ast-grep/cli`** | **`0.45.2`** | not stated in `LICENSE-NOTICES.md` (npm optionalDependency, resolved at runtime, not redistributed) | binary for the `mcp-astgrep` row; resolved by `packages/mpd-mcp-astgrep/launch.mjs` (env `MPD_AST_GREP_BIN_DIR` / `MPD_AST_GREP_SG_PATH`) | `package.json` `optionalDependencies` |
| **`@colbymchenry/codegraph`** | **`1.5.0`** | MIT (© 2026 Yeongyu Kim) — text in `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE` + `NODE-RUNTIME-LICENSES.md` (**not** in `LICENSE-NOTICES.md`) | prebuilt `packages/mpd-mcp-codegraph/dist/serve.js` is vendored (sha256 in `VENDOR_LOCK.json`); binary also resolvable at runtime via `MPD_CODEGRAPH_BIN` | `package.json` `optionalDependencies`; `VENDOR_LOCK.json` asset source text |
| **`@code-yeongyu/comment-checker`** | **`0.8.0`** | MIT | **not redistributed** — installed on demand into `.toolchain` (installer flag `--with-comment-checker`) for `mpd-comment-checker-plugin` | `package.json` `optionalDependencies`; `LICENSE-NOTICES.md` §comment-checker |
| host **`@deepseek-ai/*`** packages | host installation version | MIT | referenced as dependencies only | `LICENSE-NOTICES.md` line 7 |
| in-repo MCP servers | `dist/cli.js` / `dist/serve.js`, sha256-pinned | built from upstream (`packages/ast-grep-mcp`, `git-bash-mcp`, `lsp-daemon`, codegraph dist) | `packages/mpd-mcp-{astgrep,gitbash,lsp,codegraph}` | `VENDOR_LOCK.json` `assets.*.source` |

Finding on this table: **F-1** in §7.

---

## 7. MISMATCH findings — a doc claim that the source does not support

Severity here means "a reader who trusts the sentence is misled about what exists".

### M-1 — `mcp__git_bash__*` is presented as available shell access (MEDIUM, live-measured)
- **Claims:** `README.md` "Tools, by job" row 1 (`… mcp__git_bash__*`) and its "MCP integrations"
  paragraph ("Four in-repo stdio MCP servers (ast-grep, git-bash, an LSP bridge, codegraph) … give the
  agent … shell access through MCP"); `docs/user-guide.md` §3 table row 1 (`mcp__git_bash__* (shell)`).
- **Source:** `packages/mpd-bundle/cordis.patch.yml` row `mcp-gitbash` carries `disabled: true`; the
  patch's own comment: *"git_bash … is Windows-only …; this bundle disables it by default; Windows
  deployments can change this row to `disabled: false` to enable it."*
- **Live measurement:** a Web session running the `mpd` preset exposes NO `mcp__git_bash__*` tool.
- **Required:** either state "disabled by default (Windows-only); enable the row to use it" or move it
  out of the available-tools table. `docs/design.md`/pre-rename `architecture.md` correctly says
  "git-bash [disabled by default]".

### M-2 — `/roster` does not exist (MEDIUM)
- **Claim:** `docs/design.md` §5 "Roster → workmate → team" bullet 1 (current hash `6c53f452…`,
  pre-rename `docs/architecture.md` §5): *"a roster id is refused with a names-only error, and
  `/roster` never serves an id either"*; the same sentence survives in `docs/design.zh-CN.md`
  (`/roster`).
- **Source:** no command named `roster` is registered anywhere in the bundle (registered commands are
  exactly the seven in §3) and none in the adopted lib. The roster surface is the `mpd_roles_list`
  TOOL, whose rendered text is `roster (<n>):` — which is almost certainly what the sentence meant.
- **Required:** cite `mpd_roles_list` (tool) or delete the clause. Do not introduce `/roster` into the
  new README/user-guide.

### M-3 — MCP server count (MEDIUM, pre-rename text; verify the rewritten §1 keeps it fixed)
- **Claim (HEAD `docs/architecture.md` §1):** *"8 MCP servers (ast-grep, git-bash [disabled by
  default], LSP, codegraph + remote context7 / grep.app)"* — six names, the number eight; the extra
  two come from rows that exist only as COMMENTS (`mcp-wave-mcp`, `mcp-traceweave`).
- **Source:** 6 MCP-client rows are inserted; 2 more are commented out and mount nowhere.
- **Status:** the rewritten `docs/design.md` §1 now says "6 MCP client rows (…)" — **fixed in flight**
  (verify the final hash at review time; `docs/design.zh-CN.md` has NOT yet been rewritten — §8 D-3).

### M-4 — `mpd_config_get`'s own description names three team-model slots (LOW, code-side, not a doc)
- **Source symbol:** `packages/mpd-config-plugin/src/index.ts` — the `mpd_config_get` tool
  `description` lists `teamModels.slot1|slot2|slot3.provider/model/reasoningEffort` (slot4 omitted), and
  the doc comment above the resolved-view builder says "the three `teamModels` slots".
- **Truth:** `settings-schema.ts` declares FOUR slots (`TEAM_MODEL_SLOTS`, `slot1..slot4`), the patch
  row's `profiles.mpd` assigns Vision Analyst to slot 4, and the captain's calibration ruling (copied
  in `evidence/docs-overhaul/captain-rulings.md`) states FOUR is authoritative.
- **Required (doc lane):** never quote the tool description as the slot count. **Required (code lane,
  not t1's scope):** the description string is stale and should be fixed where it is declared.

---

## 8. Known-drift findings (reported separately, as the contract requires)

### D-1 — §4 inventory table was missing rows (pre-rename; RE-CHECK at t7)
HEAD `docs/architecture.md` §1 claimed *"13 host plugins (adapter, config, tools, modelchain, roles,
ulw, hashline, boulder, comment-checker, memory, codegraph, workmate, bootstrap)"* while the patch has
18 `mpd-*` rows; §4's table listed 16 rows + one aggregated MCP row and omitted `mpd-team-watchdog`,
`mpd-team-compact` and `mpd-tui`.
**Current state:** `docs/design.md` §1 is REWRITTEN and now reconciles exactly ("25 inserted rows …
6 MCP client rows … 17 `mpd-*` plugin rows, the `mpd-web-compat` self-row … agent-teams", plus the 2
id-targets) — I re-derived that arithmetic independently and it checks out.
**Residual (measured at `docs/design.md` sha256 `6c53f452…`):** the §4 table (lines 165–181 at that
hash) still lists only 17 of the 27 rows — it contains no row for **`mpd-team-watchdog`**
(tools `session-watchdog-*`, 7 config keys), **`mpd-team-compact`** (`mpd_team_compact_*`) or
**`mpd-tui`** (`/mpd`). Those three are exactly the rows §5 asks about, so §4 must gain them.

### D-2 — the two id-target rows are not inserts (wording precision)
A document that says "the bundle inserts 27 rows" is wrong; it inserts **25** and **id-TARGETS
(replaces) 2**. `verify-rows-parity` only sees the 25, which is why a doc line saying "27 rows" cannot
be checked by that gate. State the split.

### D-3 — the bilingual pair is mid-flight
`docs/design.zh-CN.md` is still byte-identical to HEAD `docs/architecture.zh-CN.md`
(sha256 `ae3cbe55…`) while `docs/design.md` has been rewritten (`6c53f452…`), so the pair disagrees by
content even though both files exist. t3/t5 own the fix; this is a STATUS note for the verifiers, not
a defect for a verifier to report twice.

### D-4 — stale pointers to the pre-rename path
`docs/architecture.md` is deleted in the working tree but the rename is not yet reflected everywhere.
Grep for `architecture.md` before review; the README/user-guide link tables are the likely survivors.
(t12 exists for this.)

---

## 9. Claims I verified as TRUE (so no lane needs to re-derive them)

1. **`node scripts/verify-rows-parity.mjs` → exit 0**, "ok: 25 row ids match the bundle patch insert
   list" (list printed by the gate; identical set to §1 minus the two id-targets). Semantics in §0.
2. **"25 `mpd.jsonc` knobs = 13 + the 12 `teamModels` leaves"** (`README.md`; `docs/user-guide.md` §7.2)
   — derived from `SettingsSchema`: 6 single-key sections (`hashline.maxDiffChars`,
   `commentChecker.autoCheck`, `ulw.maxRounds`, `memory.vcs`, `team.stateDir`, `boulder.dir`)
   + **7** `watchdog.*` fields (`enabled`, `warnSilenceMs`, `tickIntervalMs`, `warnStreakToEscalate`,
   `actionOnEscalate`, `toolInFlightMaxMs`, `holdTtlMs`) + 12 `teamModels` leaves = **25**. The 13 are
   the 6 + 7, NOT "13 metadata entries" and not 13 sections.
3. **"18 skills ship inside the bundle"** (`README.md`) — `skills/` holds exactly 18 entries
   (`ast-grep, data-scientist, debugging, dsh-qa, frontend, git-master, init-deep, lsp-setup,
   programming, refactor, remove-ai-slops, review-work, svn-master, ultimate-browsing, ulw-execute,
   ulw-plan, ulw-research, visual-qa`). The corpus is fingerprinted as 326 files in `VENDOR_LOCK.json`.
4. **"Eleven specialists"** — 11 `name` entries in `roles.data.ts` `ROLES`; 11 `- name:` members in the
   patch's `profiles.mpd`; roster names match the README list one-for-one.
5. **"Read-only disciplines are mechanically denied the write tools"** — `READONLY_DENY`, exactly the
   7 names in §2, applied as `toolFilter: { deny: … }` on spawn of a `readonly: true` role.
6. **"The TUI is the THIRD patch layer"** — measured in `~/.dsh/profiles/dsh-tui/package.json`
   (`bundles` = base, dsh-tui, `@mpd-dsh/mpd`).
7. **Watchdog defaults are equal across the three declared layers** — the patch row's 6 explicit keys
   + implicit `enabled: true` equal `settings-schema.ts` `SettingsSchema.watchdog` and (per that row's
   own comment) `machine.ts` `WATCHDOG_DEFAULTS`.
8. **Every backticked tool identifier in `README.md`, `README.zh-CN.md`, `docs/user-guide.md`,
   `docs/user-guide.zh-CN.md`, `docs/design.md`, `docs/design.zh-CN.md`, `docs/index.md` and
   `docs/development.md` resolves to a real registration** — the only exceptions are service names
   (`mpdDsh`, `mpdConfig`, `mpdRoles`, `mpdExtensions`, `mpdWorkmate`, `mpd_modelchain`) and the
   preset/dir names (`mpd`, `.mpd/mpd.jsonc`), which are correctly not tools. The single
   non-existent COMMAND claim is M-2.
9. **Route names quoted by the docs exist** — `GET /plugins/mpd-workmate/{list,roster,get}` and
   `POST /plugins/mpd-workmate/{init,rename,delete}` in `mpd-workmate-plugin`; the adopted plugin's
   `/plugins/dsh-agent-teams/{state,halt,plan,assets}`.
10. **The extension CLI verbs quoted by the README** (`bun scripts/mpd-ext.mjs validate|scaffold|list`)
    exist in `scripts/mpd-ext.mjs`, with `validate <dir|mpd-ext.json>` and `scaffold <name> [--dir]
    [--with-mcp]`.
11. **The four extension kinds and the disabled reference extension** — `extensions/mpd-ext-example/mpd-ext.json`
    declares `skills`, `flows`, `roles` (Code Reviewer, read-only) and `mcp` (`lint-mcp`, stdio,
    `server.mjs`, tool `describe_extension`), with `enabled: false`; `templates/mpd-extension/` ships
    the same four kinds.

---

## 10. What this evidence does NOT prove

- **No mount/load claim for the composed rows.** The two `dump-config` runs failed on a read-only
  filesystem (§0 rows 2–3); a mounting boot in an isolated `DSH_HOME` (`bundle-lifecycle`,
  `preset-conformance`) was NOT run by this task and is not implied here. Composition statements in §5
  rest on the patch + the two installed profile manifests + this session's live tool list.
- **Not an inventory of behaviour.** Tool names, commands, config keys, row ids, file counts and
  hashes are measured; a tool's runtime semantics are described only where the source states them
  (e.g. `READONLY_DENY`).
- **No preset-plane row inventory.** §1 covers the bundle patch only. `presets/mpd/agent.cordis.yml` is
  a separate composition (mirrors the harness's shipped `standard` preset); `preset-conformance` is its
  gate and the design doc's §6c is its current home.
- **Hash-anchored, therefore perishable.** `docs/design.md` was being rewritten while this was
  measured; re-hash before citing §7/§8 against the current tree.
