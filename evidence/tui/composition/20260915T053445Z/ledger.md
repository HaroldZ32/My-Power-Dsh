# TUI compatibility ledger — every package under `packages/`

Measured 2026-09-15T06:07:55.114Z against @deepseek-harness-tui/dsh-tui 0.10.1 under a `dsh-tui` profile with the bundle as the third patch layer.
Counts: **usable 22**, **inert 2**, **web-only 1**, total 25.

| package | role | class | live tools / row | observation |
|---|---|---|---|---|
| `mpd-bundle` | composition layer (the bundle patch itself) | **usable** | — | composition:dump-config: The `# == @mpd-dsh/mpd` section of the host's own composed config lists 24 rows, incl. `mpd-tui` and the `dsh-tui-agent-presets` roster override. |
| `mpd-dsh-adapter-plugin` | single contact surface with the harness seams | **usable** | rows: mpd-dsh-adapter | live-mount:plugin-log: [mpd-dsh-adapter] mpdDsh provided (harness seams resolved lazily, inject-free) |
| `mpd-config-plugin` | mpd.jsonc runtime config layer | **usable** | 2 tools | live-mount:tool-list: mpd_config_get, mpd_config_reload |
| `mpd-tools-plugin` | write guard / truncation / post-execute waterfall | **usable** | rows: mpd-tools | composition:dump-config: row `mpd-tools` composed with config writeGuard: true, truncateMaxBytes: 8192 |
| `mpd-modelchain-plugin` | model-chain resolution + workspace memory | **usable** | 1 tools | live-mount:tool-list: mpd_modelchain_resolve |
| `mpd-ext-plugin` | extension registry (skills/flows/roles/MCP) | **usable** | 4 tools | live-mount:tool-list: mpd_ext_list, mpd_ext_show, mpd_flow_list, mpd_flow_show |
| `mpd-roles-plugin` | specialist roster | **usable** | 3 tools | live-mount:tool-list: mpd_role_persona, mpd_role_spawn, mpd_roles_list |
| `mpd-ulw-plugin` | ulw loop discipline | **usable** | 2 tools | live-mount:tool-list: mpd_ultrawork, mpd_ulw |
| `mpd-hashline-plugin` | anchored edit discipline | **usable** | 4 tools | live-mount:tool-list: mpd_hashline_edit, mpd_hashline_format, mpd_hashline_read, mpd_hashline_restore |
| `mpd-boulder-plugin` | durable work ledger | **usable** | 6 tools | live-mount:tool-list: mpd_boulder_complete, mpd_boulder_plan_progress, mpd_boulder_plans, mpd_boulder_start, mpd_boulder_status, mpd_boulder_task_timer |
| `mpd-comment-checker-plugin` | comment/docstring detector (opt-in binary) | **usable** | 1 tools | live-mount:tool-list: mpd_comment_check (autoCheck false by config; the tool is registered) |
| `mpd-codegraph-plugin` | codegraph project init + binary resolve | **usable** | rows: mpd-codegraph | live-mount:plugin-log: [mpd-codegraph] init status=marker binary=…/codegraph/npm-shim.js cwd=<sandbox workspace> |
| `mpd-memory-plugin` | git/svn-backed memory + reflection | **usable** | 7 tools | live-mount:tool-list: mpd_memory_read, mpd_memory_recall, mpd_memory_reflect, mpd_memory_reflect_complete, mpd_memory_save, mpd_memory_status, mpd_memory_write |
| `mpd-workmate-plugin` | durable evolving agent library | **usable** | 7 tools | live-mount:tool-list: mpd_workmate_delete, mpd_workmate_init, mpd_workmate_list, mpd_workmate_match, mpd_workmate_reflect, mpd_workmate_rename, mpd_workmate_spawn |
| `mpd-team-compact-plugin` | finished-team compaction | **usable** | 2 tools | live-mount:tool-list: mpd_team_compact_run, mpd_team_compact_status |
| `mpd-bootstrap-plugin` | serves the bundle's skills corpus (no home copy) | **usable** | rows: mpd-bootstrap | live-mount:plugin-log: [mpd-bootstrap] skill corpus served from /root/dshProj/my-power-dsh/skills |
| `mpd-tui-plugin` | the TUI-native surface package (this edition) | **usable** | rows: mpd-tui | composition:dump-config: row `mpd-tui` → module '@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js' |
| `mpd-agent-teams-plugin` | adopted AgentTeams plugin (tools + Web panel) | **usable** | 17 tools | live-mount:tool-list: 17 tools: agent_teams_add_member, agent_teams_approve, agent_teams_claim_task, agent_teams_create, agent_teams_create_task, agent_teams_delete, … |
| `mpd-mcp-astgrep` | ast-grep MCP server (stdio launcher) | **usable** | 3 tools | live-mount:tool-list: mcp__ast_grep__rewrite, mcp__ast_grep__scan, mcp__ast_grep__search |
| `mpd-mcp-lsp` | LSP MCP server (stdio launcher) | **usable** | 8 tools | live-mount:tool-list: mcp__lsp__diagnostics, mcp__lsp__find_references, mcp__lsp__goto_definition, mcp__lsp__install_decision, mcp__lsp__prepare_rename, mcp__lsp__rename, mcp__lsp__status, mcp__lsp__symbols |
| `mpd-mcp-codegraph` | codegraph MCP server (stdio launcher) | **usable** | — | live-mount:plugin-log: [mpd-mcp-codegraph] serving codegraph in-process (no shared daemon): … |
| `mpd-mcp-gitbash` | git-bash MCP server (Windows-only upstream) | **inert** | — | composition:dump-config: row `mcp-gitbash` is composed with `disabled: true` (upstream design: run is available only on native Windows), so it launches nothing under any profile — no TUI limitation. |
| `mpd-mcp-shared` | shared binary resolver used by the MCP launchers | **usable** | — | source-read: Imported by the mcp-* launch.mjs launchers; it owns no loader row of its own — witnessed indirectly by the ast_grep / lsp MCP children that launched (tool-list.json). |
| `mpd-bundle-plugin` | bundle web-compat package (browser client + no-op main) | **web-only** | — | source-read: The package's deliverable is the browser bundle (agent-teams panel, workmate tab registered through ctx.betterSidebar.registerTab, bundle floater fallback); the root package.json declares dsh.client.platform = web. |
| `mpd-qa-roles-probe` | QA-only probe package | **inert** | — | composition:dump-config: No row in the bundle patch references it; the composed dsh-tui config has no row for it (it is mounted only by the QA overlay tests/overlays/roles-probe.yml). |

## Disclosed gaps

- Web-only faces (agent-teams sidebar, workmate tab, bundle floater) have no TUI rendering face — NOT CLAIMED W-3.
- The decision-event seam is ready-but-not-activated: host admission is unreachable for a profile-installed plugin — NOT CLAIMED W-1.
- Engine skew: the host prints that the 0.1.5-rc.2 engine is newer than the 0.1.5-rc.1 it was validated against — NOT CLAIMED W-4.
- In this sandbox the CodeGraph project is excluded (workspace path contains `.mpd`), so mpd-mcp-codegraph contributed 0 tools here.
- packages/mpd-tui-plugin was still being written by t4 at measurement time; its seam-rendering verification belongs to the panels lane (AC-4 / t8), not to this ledger.

## Observation semantics

- **usable** - the package's function is reachable from a TUI session and at least one thing this lane ACTUALLY SAW proves it: a live tool name in a recorded request/header, the package's own apply-time log line, or the row applying in a live boot with zero apply-crash signatures.
- **inert** - the row never runs under a dsh-tui profile (disabled in the composition, or not composed at all): nothing could be exercised, and the ledger says so instead of guessing.
- **web-only** - the package's only face is the browser client; the live TUI boot does not load it, which is recorded as a negative observation rather than inferred from a filename.

## NOT exercised in this lane (and why)

- `mpd-bundle` - The composition layer itself: what was observed is that the host's own composed config lists its 24 rows and that a live boot mounted them with 0 apply-crash signatures. There is no separate runtime surface to exercise.
- `mpd-tools-plugin` - Only the row applying was observed (0 apply-crash signatures). It owns no tool name and prints no apply-time line, and its write guard / truncation / post-execute waterfall needs a real write-tool call to witness - NOT exercised beyond apply in this lane; a guard probe belongs to the live/panels lane (t8).
- `mpd-mcp-gitbash` - NOT exercised by construction: the composed row carries `disabled: true` (upstream design, Windows-only), so no process was started and no tool appeared. The observation is the composed row's disabled flag plus its absence from the live tool list.
- `mpd-qa-roles-probe` - NOT composed in any user-facing profile: no row in the bundle patch references it, so the live TUI never loaded it. Observed: absent from the host's composed dsh-tui config; mounted only by the QA overlay tests/overlays/roles-probe.yml.
- `mpd-mcp-shared` - A library with no loader row of its own: NOT exercised directly. Its effect is witnessed indirectly - the ast_grep and lsp MCP children that import it launched and contributed 11 tools to the live session.
- `mpd-bundle-plugin` - NOT exercised under the TUI, and that is the finding: it is the browser bundle. Observed negatively - the live TUI pane log contains no `better-sidebar` / registerTab / floater line, its `mpd-web-compat` row loads a no-op main, and no tool or skill in the live counters (93 tools / 18 skills) comes from it. Its web face needs the web profile, which is out of this lane.

Detail, caveats and per-package observations: `ledger.json` (same directory).
