# my-power-dsh

**English** | [中文](./README.zh-CN.md)

**my-power-dsh** is a plugin bundle for the **DeepSeek Harness (DSH)**. One install turns a plain
DSH setup into a working environment for real coding work: a main agent that reads your project
rules, eleven specialists you can consult or delegate to, a library of durable "workmate" agents
that remember what they learned, multi-agent teams whose plan you approve before anything runs, a
served skill corpus, MCP integrations for code intelligence, and an extension interface that lets
other packages contribute skills, flows, MCP servers and specialists without touching the core.

This file is the **user manual**: how to install it, what to type, what each command and tool does,
how to configure it, and where your data lives. The internal assembly — boot chain, package layout,
plugin mechanics — is written down in exactly one place, and this file points at it (see the last
section, *Architecture, in one pointer*).

The bundle is the package `@mpd-dsh/mpd`; this repository root **is** that package. It installs with
one command and uninstalls with one command that leaves no residue.

## What you get

| You want to… | Use | Where the how-to is |
|---|---|---|
| Work with an agent that knows your project rules | the **`mpd` preset** (the only preset the bundle ships) | *The main agent and your project rules* |
| Get a second opinion, or a scoped executor | the **specialist roster** — `mpd_role_spawn` | *Specialists: the roster* |
| Keep a specialist that accumulates knowledge | the **workmate library** — `mpd_workmate_*` | *Keep an evolving agent* |
| Run a real multi-agent workflow | **team mode** — `agent_teams_*` + the AgentTeams tab | *Team mode* |
| Drive a long objective to done | the **ULW loop** — `/ulw` | *Drive long work: the ULW loop* |
| Track a multi-step plan durably | the **boulder ledger** — `mpd_boulder_*` | *Track plan progress: the boulder ledger* |
| Remember facts across sessions | the **memory engine** — `mpd_memory_*` | *Keep durable memory* |
| Edit files without line-drift mistakes | **hash-anchored editing** — `mpd_hashline_*` | *Edit files safely* |
| Understand an unfamiliar codebase | the **MCP servers** — ast-grep, LSP, CodeGraph | *Understand a codebase* |
| Teach the bundle a new trick | the **extension interface** — `mpd_ext_*` | *The extension interface* |
| Drive it all from a terminal | the **DSH-TUI edition** | *The DSH-TUI edition* |

## Install

### Requirements

- DeepSeek Harness (DSH) with a `web` or `headless` profile, and model credentials configured in
  DSH. The bundle never configures keys for you.
- Node.js and `bun` on `PATH` for the repository scripts (`bun` runs the tests and the extension
  CLI).
- Optional, for the code-intelligence servers: the toolchain the bundle can install
  (`node scripts/install-mcp.mjs`) or your own binaries, pointed at with the documented environment
  variables (`MPD_DSH_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`, …).

### Install from the checkout (web profile)

```bash
cd <repo> && dsh plugin --profile web add .
```

The repository root is the bundle package, so this single command installs every plugin row, the
`mpd` preset, the 18-skill corpus and the extension root — no pack step, no copy step. Then restart
`dsh` and pick the **MPD (Main Working Agent)** preset in a session.

A checkout install reads the checkout directly: after a code change, rebuild the touched package's
`dist/` and restart `dsh`.

### Install for the terminal UI (`dsh-tui` profile)

The same bundle installs into the terminal-UI profile:

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

It joins that profile as the **third patch layer**, on top of the TUI package:
`dsh.profile.bundles` becomes
`["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`, and
`dsh --profile dsh-tui --dump-config` puts the bundle's rows in a layer of their own
(`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`). A TUI session defaults to the
**mpd** preset. Start it with the `dsh-tui` launcher (alias `dst`):

```bash
dsh-tui            # boot in the current directory
dsh-tui --resume   # continue the previous session (shorthand: -c)
dsh-tui doctor     # check the profile and the toolchain
dsh-tui --help     # update | doctor | version | help; other arguments pass through to `dsh --profile dsh-tui`
```

`dsh-tui` needs a real terminal: with piped output it refuses to boot with
`Error: dsh-tui requires an interactive terminal (stdout must be a TTY).`

### Install from a packed artifact

For a published package or a tarball, assemble the relocatable bundle first and add that artifact to
whichever profile you run:

```bash
node scripts/pack-mpd.mjs                       # -> dist/mpd-package/ (relocatable)
dsh plugin --profile web add dist/mpd-package
dsh plugin --profile dsh-tui add dist/mpd-package
```

### Uninstall

`--profile` is **required** on every `dsh plugin` command — without it the CLI stops with
`error: required option '--profile <name>' not specified`:

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

The bundle uninstalls as one unit, skills included, and leaves no residue in your DSH home. What
stays is your own data: the workmate library (`~/.mpd/workmate/`) and each workspace's `.mpd/`
state.

### What the install mounts

Every plugin below is declared by the bundle patch `packages/mpd-bundle/cordis.patch.yml` and is
mounted by the one `dsh plugin add` above. That patch carries **27 `- id:` entries in two kinds**:
**25 rows this bundle INSERTS** (grouped below) and **2 host rows it id-TARGETS (replace, not
insert)**. `node scripts/verify-rows-parity.mjs` asserts the 25 insert ids.

**Bundle host plugins — 18 inserted rows**

| Row id | Package | What it provides |
|---|---|---|
| `mpd-web-compat` | `mpd-bundle-plugin` | The loader entry named `@mpd-dsh/mpd` that lets the bundle's web client load; also the combined web UI (see *Web GUI*) |
| `mpd-dsh-adapter` | `mpd-dsh-adapter-plugin` | The single contact surface with the harness tool/agent/skill/preset seams; every other row calls through it |
| `mpd-config` | `mpd-config-plugin` | The `.mpd/mpd.jsonc` layer, the `mpdConfig` service, `mpd_config_get` / `mpd_config_reload` |
| `mpd-team-watchdog` | `mpd-team-watchdog-plugin` | Stall detection for team lanes: heartbeat tails, incidents, the preserving hold |
| `mpd-tools` | `mpd-tools-plugin` | The write guard, output truncation and edit-error recovery for the built-in file tools |
| `mpd-modelchain` | `mpd-modelchain-plugin` | `mpd_modelchain_resolve`, plus `mpd_memory_save` / `mpd_memory_recall` |
| `mpd-ext` | `mpd-ext-plugin` | The extension interface: manifest discovery, four inspection tools, the stdio MCP bridge, the author CLI |
| `mpd-roles` | `mpd-roles-plugin` | The specialist roster and `mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona` |
| `mpd-ulw` | `mpd-ulw-plugin` | The ultrawork loop: `mpd_ultrawork` / `mpd_ulw` and the `/ulw` + `/ultrawork` commands |
| `mpd-hashline` | `mpd-hashline-plugin` | Hash-anchored edit discipline: `mpd_hashline_read/edit/format/restore` |
| `mpd-boulder` | `mpd-boulder-plugin` | The durable work ledger: `mpd_boulder_*` over `.mpd/boulder.json` and `.mpd/plans/` |
| `mpd-comment-checker` | `mpd-comment-checker-plugin` | `mpd_comment_check` over the optional comment-checker binary |
| `mpd-codegraph` | `mpd-codegraph-plugin` | Binary resolution, project index init and the `/mpd-codegraph` command |
| `mpd-memory` | `mpd-memory-plugin` | The git/svn-backed memory store and its reflection state machine |
| `mpd-workmate` | `mpd-workmate-plugin` | The durable workmate library under `~/.mpd/workmate/` (`mpd_workmate_*`) |
| `mpd-team-compact` | `mpd-team-compact-plugin` | Compaction of a finished team's member contexts (`mpd_team_compact_run/status`) |
| `mpd-bootstrap` | `mpd-bootstrap-plugin` | Serves the bundle's skill corpus (the `<bundle>/skills` tree) through the harness skill seam; cleans legacy home copies |
| `mpd-tui` | `mpd-tui-plugin` | The DSH-TUI surfaces: status line, board, `/mpd` tree, dialogs, shortcuts, `/settings` |

`mpd-tui` is composed in **every** profile, not only under `dsh-tui`: in a web or headless
composition its surfaces simply degrade — one warning per missing TUI seam — instead of taking the
boot down.

**In-repo MCP servers — 4 inserted rows** (stdio, launched from this repository)

| Row id | Server name | What it provides |
|---|---|---|
| `mcp-astgrep` | `ast_grep` | AST-aware search, rewrite and YAML rule scanning (`mcp__ast_grep__*`) |
| `mcp-gitbash` | `git_bash` | Git-for-Windows shell bridge — **`disabled: true` by default** (Windows only); set `disabled: false` in the row to enable. No `mcp__git_bash__*` tool exists until then |
| `mcp-lsp` | `lsp` | Language-server intelligence: diagnostics, definitions, references, rename (`mcp__lsp__*`) |
| `mcp-codegraph` | `codegraph` | Structural project graph exploration (`mcp__codegraph__*`) |

**Adopted plugin — 1 inserted row**

| Row id | Package | What it provides |
|---|---|---|
| `agent-teams` | `mpd-agent-teams-plugin` | The multi-agent team engine (MIT, adopted from `dsh-agent-teams` and shipped as first-class main code): the `agent_teams_*` tools, the scheduler, the Web panel. See *Acknowledgements* |

**Remote MCP rows — 2 inserted rows** (public services: network required, optional per use)

| Row id | Server name | What it provides |
|---|---|---|
| `mcp-context7` | `context7` | The public Context7 docs service over streamable HTTP (`https://mcp.context7.com/mcp`) |
| `mcp-grepapp` | `grep_app` | The public grep.app GitHub code-search service over streamable HTTP (`https://mcp.grep.app`) |

**Host rows the bundle id-targets (replace, not insert) — 2 rows**

Both are `@deepseek-ai/dsh-agent-presets`. They root the preset roster at `<bundle>/presets` and
default the session preset to `mpd` — one per plane. They are **replacements of rows the host itself
ships, not inserts**: a second insert with the same loader entry id would collide with the host's own
row.

| Row id | Plane | What it configures |
|---|---|---|
| `agent-presets` | web / base | `default: mpd`, plus a `system`-trust root pointing at `<bundle>/presets` |
| `dsh-tui-agent-presets` | `dsh-tui` | The same default and the same root for the TUI plane |

The harness's own packages (`@deepseek-ai/*`) are dependencies of DSH, not of this bundle, and are
therefore not rows here — they are credited in *Acknowledgements*.

**Optional toolchain dependencies** (declared in `package.json` under `optionalDependencies`; the
matching MCP rows and tools work without them if you point the environment variables at your own
binaries):

| Dependency | Version | Used by |
|---|---|---|
| `@ast-grep/cli` | `0.45.2` | `mcp-astgrep` (the `mcp__ast_grep__*` tools) |
| `@colbymchenry/codegraph` | `1.5.0` | `mcp-codegraph` and the `mpd-codegraph` row |
| `@code-yeongyu/comment-checker` | `0.8.0` | `mpd_comment_check` |

## Quick start

1. **Install** (above), restart `dsh`, and start a session on the **MPD** preset.
2. **Ask for something real.** The agent has `bash`/`read`/`edit` plus the MCP code tools. Drop an
   `AGENT.md` in your project to steer it; it is read automatically at session start.
3. **Consult a specialist.** `mpd_roles_list` shows the roster, then
   `mpd_role_spawn { role: "Architect", task: "review the module boundaries in src/" }`.
4. **Keep the good one.** `mpd_workmate_init { base: "Architect", name: "system-architect" }`, then
   reuse it with `mpd_workmate_spawn { name: "system-architect", task: "…" }`.
5. **Scale to a team.** `agent_teams_create { name: "readme-wave", description: "Documentation
   overhaul", profile: "mpd", approval: "required" }`, review the plan in the **AgentTeams** tab,
   approve it, and watch the dependency-aware scheduler work.
6. **Teach it your own capability.** Put an extension directory into `<workspace>/.mpd/extensions/`
   and check it with `mpd_ext_list`.

## The main agent and your project rules

The bundle ships one preset: **MPD (Main Working Agent)**. Selecting it in a session gives you:

- **Project rules loaded automatically** — at the start of every session the agent attempts to read
  `AGENT.md`, falling back to `AGENTS.md`, then `CLAUDE.md`. Write the file once and every session
  starts already knowing your conventions.
- **The harness's own tools plus the bundle's** — `bash`, `read`, `edit`, `glob`, `grep` and the
  rest are exposed directly; everything this bundle adds (`mpd_*`, `agent_teams_*`, the MCP
  servers) appears next to them.
- **Routing built in** — the preset's persona explains the roster, the workmate library and team
  mode, so the agent reaches for the right instrument without extra setup.

You do not have to choose a preset per task: the same session keeps its preset, and every capability
below is available inside it.

## Commands

Slash commands are typed into the session prompt.

| Command | What happens |
|---|---|
| `/ulw <objective>` | Starts an ultrawork run: the objective is triaged, planned when the work warrants it, executed in rounds, and pushed through the verification and quality gates before it reports done. `/ultrawork <objective>` is the same command |
| `/mpd-codegraph` | Initializes (or re-runs) the CodeGraph index for the session workspace — `.codegraph/codegraph.db`. Errors if the codegraph binary is unavailable: install it or set `MPD_DSH_CODEGRAPH_BIN` |
| `/agent-teams` | Stages a team for the current goal. The generated `/agent-teams-<profile>` spelling (for example `/agent-teams-mpd`) pins a profile |
| `team:` / `!team` in a message | The same explicit staging request in plain text. The session-start complexity gate only ever **advises** — it never stages a team for you |
| `/mpd` (TUI) | The terminal command tree: a bare `/mpd` opens the picker; the actions are `board`, `team`, `plan`, `workmates` and `status` (`/mpd status` prints the summary, `/mpd team` opens the team-workflow surface, `/mpd plan` the plan-approval surface) |
| `/goal <objective>` | Creates a persisted session goal (the host's goal row, enabled by the `mpd` preset): one long-running objective that continues across turns |
| `/settings` (TUI) | Edits the `mpd.jsonc` knobs listed under *Settings* below |

## Tools, by job

This is the index; each subsection below shows the concrete call.

| You want to… | Tools |
|---|---|
| Understand a codebase | `mcp__ast_grep__*`, `mcp__lsp__*`, `mcp__codegraph__*`, `mcp__context7__*`, `mcp__grep_app__*` (`mcp__git_bash__*` has a row but ships **disabled by default**, Windows only — no such tool exists until you enable it) |
| Edit safely | the write guard and truncation rows, `mpd_hashline_read/edit/format/restore`, `mpd_comment_check` |
| Drive long work | `mpd_ulw` / `mpd_ultrawork`, `mpd_boulder_*` |
| Keep memory | `mpd_memory_write/read/reflect/reflect_complete/status`, `mpd_memory_save/recall` |
| Consult a specialist | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`, `mpd_modelchain_resolve` |
| Keep an evolving agent | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` |
| Run a team | `agent_teams_*`, `mpd_team_compact_run/status`, `session-watchdog-*` |
| Configure the bundle | `.mpd/mpd.jsonc`, `mpd_config_get`, `mpd_config_reload` |
| Extend the bundle | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` and the `extensions/` root |

### Understand a codebase (MCP servers)

```jsonc
// Structural search — syntax shape, not text
mcp__ast_grep__search { "pattern": "useEffect($$$)", "language": "tsx", "paths": ["src"] }
mcp__ast_grep__rewrite { "pattern": "console.log($A)", "rewrite": "logger.info($A)", "language": "typescript", "paths": ["src"], "apply": false }

// Language-server intelligence
mcp__lsp__diagnostics { "filePath": "packages/mpd-roles-plugin/src/index.ts" }
mcp__lsp__find_references { "filePath": "…/src/index.ts", "line": 42, "character": 9 }
mcp__lsp__rename { "filePath": "…", "line": 42, "character": 9, "newName": "resolvedConfig" }

// Project graph — ask a question, get the relevant symbols plus the call path
mcp__codegraph__codegraph_explore { "query": "how does a task get claimed and updated?" }

// Remote servers: library docs and GitHub code search
mcp__context7__resolve-library-id { "libraryName": "zod", "query": "schema parsing" }
mcp__grep_app__searchGitHub { "query": "registerTool({", "language": ["TypeScript"] }
```

`mcp__lsp__rename` and `mcp__ast_grep__rewrite` / `mcp__ast_grep__scan` **write files**: run them
with `apply: false` first, read the diff, then apply. `mcp__git_bash__*` is disabled by default
(Windows only). The two remote rows (`context7`, `grep_app`) are public HTTP services and need
network access.

### Edit files safely (hash-anchored, guarded)

The `mpd-tools` row guards the built-in writers: a `write` to an existing file whose content would
change is refused, and oversized tool output is truncated with a pointer instead of flooding the
context.

For files that are edited repeatedly, the hash-anchored discipline removes line-number drift:

```jsonc
mpd_hashline_read { "path": "src/config.ts" }        // returns `LINE#HASH|content` anchors
mpd_hashline_edit {
  "path": "src/config.ts",
  "edits": [{ "op": "replace", "pos": "42#a1b2", "end": "44#c3d4", "lines": ["new line"] }]
}
mpd_hashline_format { "path": "src/config.ts" }      // register the file for the guard
mpd_hashline_restore { "path": "src/config.ts" }     // unregister it
```

Anchors are validated against the current file: if the file moved, the edit is refused with remapped
references instead of landing in the wrong place. Once a file is registered, the guard warns when a
plain `edit`/`write` changes it.

`mpd_comment_check` runs the optional comment/docstring detector on one or more files
(`{ "files": [{ "path": "src/a.ts" }, { "path": "src/b.ts", "content": "…" }] }`); it needs the
`@code-yeongyu/comment-checker` binary or `MPD_DSH_COMMENT_CHECKER_BIN`.

### Drive long work: the ULW loop

```jsonc
mpd_ulw { "objective": "make the docs gate cover every extension README", "maxRounds": 6 }
```

`mpd_ultrawork` is the full form: `{ objective, tier: "light"|"heavy", plan: true, hyperplan: true,
strictReview: true, maxRounds }`. The loop triages the objective first, plans it when the work
warrants a plan, then executes round by round with a per-criterion cycle
(pin → red → green → surface → clean), a separate verification gate and a final quality gate with a
per-lane ledger. A `heavy` tier or `strictReview` forces the verification gate even for small work.
Run state and the ledger live under `.mpd/ulw/<id>`.

The same run is reachable as a command: `/ulw <objective>`.

### Track plan progress: the boulder ledger

The boulder ledger binds a session to a plan file so long work survives a restart:

```jsonc
mpd_boulder_plans { }                                      // list .mpd/plans/*.md
mpd_boulder_start { "planPath": ".mpd/plans/my-plan.md" }  // bind the work, status "active"
mpd_boulder_status { "planPath": ".mpd/plans/my-plan.md" } // works, timers, resume options, checklist progress
mpd_boulder_task_timer { "workId": "…", "taskKey": "1", "action": "start" }   // then "end" — records elapsed_ms
mpd_boulder_plan_progress { "planPath": ".mpd/plans/my-plan.md" }
mpd_boulder_complete { "workId": "…" }
```

State is a plain JSON ledger at `.mpd/boulder.json` in the session's workspace, so a new session can
resume the same plan without re-deriving where it stopped.

### Keep durable memory

```jsonc
mpd_memory_write { "title": "Docs gate scope", "content": "verify:docs discovers every *.md under docs/ …", "kind": "fact", "tags": ["docs"], "description": "one-line summary for recall" }
mpd_memory_read  { "query": "docs gate", "limit": 5 }
mpd_memory_status { }
mpd_memory_reflect { }                                     // is a reflection due?
mpd_memory_reflect_complete { "title": "Week 38", "content": "…" }
mpd_memory_save { "key": "current-wave", "value": "docs-overhaul" }   // key/value note in .mpd/memory.json
mpd_memory_recall { "key": "current-wave" }
```

`mpd_memory_write` stores a durable entry in the VCS-backed store rooted at
`<workspace>/.mpd/memory/` (one repository per agent slug) and commits it; `kind` is `note`, `fact`
or `reflection`. Which VCS is used — `git`, `svn` or `both` — is the `memory.vcs` knob, and the
reflection cadence is `memory.reflectionEvery`.

### Consult and route to specialists

```jsonc
mpd_roles_list { }
mpd_role_persona { "role": "Architect" }         // the full persona text
mpd_role_spawn   { "role": "Architect", "task": "review the plugin boundaries", "context": "optional block" }
mpd_modelchain_resolve { "role": "Deep Worker" } // the provider/model route a roster role resolves to
```

A one-shot specialist is a separate agent with its own context: it returns a result, not a
transcript, so ask for exactly one deliverable. Read-only roles are mechanically denied the seven
write tools (`write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`,
`mcp__ast_grep__scan`, `mcp__lsp__rename`) — `bash` is denied on purpose, because a shell can write.
If you catch yourself spawning the same specialist every week, promote it to a workmate.

### Keep an evolving agent (the workmate library)

A **workmate** is a durable copy of a specialist with its own name, persona, memory and note card.
It lives under `~/.mpd/workmate/`, outside any one project, and is reused across sessions.

```jsonc
mpd_workmate_init { "base": "Architect", "name": "system-architect", "note": "Owns module boundaries." }
mpd_workmate_match { "task": "review the plugin boundaries before the release" }  // reuse, don't re-create
mpd_workmate_spawn { "name": "system-architect", "task": "review this diff" }
mpd_workmate_reflect { "name": "system-architect", "task": "review this diff", "outcome": "Found the seam leak." }
mpd_workmate_list { }
mpd_workmate_rename { "name": "system-architect", "new_name": "arch-reviewer" }
mpd_workmate_delete { "name": "arch-reviewer" }             // archive-first; purge: true + confirm: <name> to erase
```

Rules that matter in daily use:

- `base` is the specialist's **functional name** (`Architect`, `Deep Worker`, …); a name is
  auto-generated when you omit `name`.
- `mpd_workmate_match` scores the library against a task. **If the best score is weak
  (`matched: false`), initialize a new workmate instead of forcing the match.**
- Names are ASCII `[a-z0-9_-]`. Rename moves the whole instance (persona, memory, counters); delete
  archives first, and permanent removal needs `purge: true` together with `confirm` set to the exact
  name.
- Rename and delete are refused while the workmate is in use by a team member or an in-flight
  spawn.
- The **Workmates** sidebar tab does all of this by hand: browse, filter, open, create from a base
  picker, rename, delete.

### Run a team

`agent_teams_*` is a large surface; the ones you reach for, in order:

```jsonc
agent_teams_create { "name": "docs-wave", "description": "README + design doc overhaul", "profile": "mpd", "approval": "required" }
agent_teams_status { }                                      // members, tasks, dependencies, delivery state
agent_teams_approve { "team_id": "…" }                       // start a staged plan (never call it during planning)
agent_teams_send_message { "to": "Deep Worker", "content": "…" }
agent_teams_task_contract { "task_id": "t4" }                // read one task's frozen contract
agent_teams_reassign_task { "task_id": "t4", "assignee": "Senior Engineer" }
agent_teams_resume { "reason": "…" }                         // after the Web "Stop team" control halted the wave
```

Members claim and update their own work with `agent_teams_claim_task` / `agent_teams_update_task`,
read each other's mail with `agent_teams_mailbox_check`, and close a finished wave with
`agent_teams_delete`. `mpd_team_compact_run` compacts a **finished** team's member contexts
(captain excepted) and writes an audit record; `mpd_team_compact_status` reads that audit, including
why a member was skipped. The `session-watchdog-*` tools are the stall detector's own surface
(heartbeats, incidents, the preserving hold) — read-only unless you are deliberately releasing a
hold.

Full workflow: *Team mode* below.

### Configure and extend

```jsonc
mpd_config_get { }                     // every resolved key; mpd_config_get { "key": "ulw.maxRounds" } for one
mpd_config_reload { }                  // re-read the mpd.jsonc layers
mpd_ext_list { }                       // every extension this host knows: id, origin, plane, errors
mpd_ext_show { "id": "mpd-ext-example" }
mpd_flow_list { }
mpd_flow_show { "id": "…" }
```

The extension developer CLI ships with the bundle:

```bash
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example   # exit 0 when valid, 1 with per-item errors
bun scripts/mpd-ext.mjs scaffold <dir>                        # start from templates/mpd-extension/
bun scripts/mpd-ext.mjs list                                  # what this host discovered
```

## Specialists: the roster

Eleven specialists ship as one-shot specialist subagents — not as separate presets. Address each by
name (any case, space or hyphen spelling):

**Architect** (architecture review, deep debugging, self-review) · **Researcher** (evidence-based
code and open-source search) · **Planner** (writes plans, never implements) · **Deep Worker**
(executes a goal end-to-end) · **Senior Engineer** (primary implementation and verification) ·
**Lead** (orchestration and integration) · **Explorer** (read-only codebase search) · **Reviewer**
(risk findings, no fixes) · **Plan Reviewer** (plan QA) · **Vision Analyst** (images and diagrams) ·
**Junior Engineer** (small, well-scoped changes).

How to use them well:

- **Match the instrument to the size of the work.** A small mechanical change goes to a Junior
  Engineer; a bounded independent piece to a Senior Engineer or a Deep Worker; an evidence question
  to a Researcher or Explorer; a verdict to a Reviewer.
- **Ask for one deliverable per spawn.** Each specialist runs in its own context and returns a
  result, not a reasoning trace.
- **Read-only means read-only.** Six of the eleven (Architect, Researcher, Planner, Explorer, Plan
  Reviewer, Vision Analyst) are denied the write tools at spawn time, so a "review" cannot silently
  become an edit.
- **Promote what you reuse.** `mpd_workmate_init` turns a specialist into a durable workmate (see
  *Keep an evolving agent*).

## Team mode

A captain designs a roster and a task DAG, you review and approve the plan, and a dependency-aware
scheduler runs it. Members are the specialists above; read-only disciplines stay read-only; a member
may be backed by a workmate, so a teammate carries its own accumulated memory.

### Start a team

```jsonc
agent_teams_create {
  "name": "docs-wave",
  "description": "Rewrite the README pair and promote the architecture doc",
  "profile": "mpd",                 // the roster profile: 11 members, the captain plans the DAG
  "approval": "required"            // stage the plan and wait for the user
}
```

Two approval modes, and they behave very differently:

- **`approval: "required"`** — the default for anything a person should sign off on. The captain
  builds the roster and the DAG, nothing is dispatched, and the plan waits for you in the
  **AgentTeams** tab (or the TUI's `/mpd plan` surface). Nothing runs until you approve.
- **`approval: "automatic"`** — the plan is approved as it is created and work starts immediately.
  Use it only when the user has explicitly asked to skip review.

You can also stage a team with `/agent-teams` or a `team:` / `!team` request in a message. The
session-start complexity gate only **advises** that a team may be warranted; it never stages one.

Before approving, you can edit the staged plan with `agent_teams_edit_plan` (an ordered atomic
batch: roster, tasks, dependencies, assignees) and inspect any task's frozen contract with
`agent_teams_task_contract`. Approve with `agent_teams_approve` — and never during the planning turn
that created the plan.

### Approve the plan (`approval: "required"`)

In the **AgentTeams** tab the staged plan is the approval editor — roster, tasks, dependencies and
assignees are editable, and the tab shows the dependency map before anything is dispatched. In the
TUI: `/mpd plan`, type `approve <teamId>` exactly, then `Ctrl+X`; two `Ctrl+D` presses inside ten
seconds discard the plan, and `Esc` never mutates anything.

What a good approval catches: a task with no acceptance criteria, a dependency that is not a real
prerequisite, or a member assigned work outside its discipline.

### Work with a running team

- **`agent_teams_status`** is the snapshot: members with live activity, tasks with
  status/assignee/dependencies, the delivery state, and each member's next claimable task.
- **Task contracts are capabilities.** A member claims its own task (`agent_teams_claim_task`) and
  updates it with the returned `attempt_id`; a stale attempt is rejected, which is how a reassigned
  task stops accepting late results.
- **Mail is direct.** `agent_teams_send_message` reaches the captain or a named teammate;
  `agent_teams_mailbox_check` is the duplicate check to run first.
- **Ownership moves explicitly.** `agent_teams_reassign_task` is the only way to move work between
  members (and the way to take a task over as captain); `agent_teams_path_owner` answers "who owns
  this path?" before you declare an `inScope`.
- **Stopping is not deleting.** The Web **Stop team** control pauses a wave without cancelling
  anything; `agent_teams_resume` continues it. (`agent_teams_halt` is the name of that pause
  mechanism — it is not a callable tool.)
- **A failed review does not need manual repair.** The quality kinds (`requirements`,
  `implementation`, `verification`, `review`, `repair`, `integration`) carry contracts, and a
  `needs_revision` verdict automatically opens a repair task plus the next review; wait for that
  loop instead of recreating it.

### Finish: compact or delete

When every task is terminal and every member idle, `mpd_team_compact_run` compacts the members'
contexts and records the audit (the captain is never compacted), and `agent_teams_delete` ends the
team. Keep one team per wave: end it when the wave lands, then start the next one.

## Web GUI

- **AgentTeams tab** — the whole team surface for the current conversation: live and archived teams,
  member activity, task rows, the dependency map, the stop control, and the staged-plan approval
  editor. The tab badge counts live teams; `single: true` re-scopes the tab instead of opening a
  second copy, and an **Auto-open when a team appears** switch (default ON) turns the automatic
  opening off.
- **Workmates tab** — the workmate library: instances with base, use count and note, a filter, an
  open view for persona/memory/note, and the init / rename / delete flows (delete is a two-step
  confirmation, with a typed name for a permanent purge).

Both tabs are contributed to the community sidebar bundle `dsh-better-sidebar` and appear in its tab
strip; without that bundle each page logs one warning and registers nothing, and everything stays
usable through the `agent_teams_*` and `mpd_workmate_*` tools. The bundle's own web client (loaded
through the `mpd-web-compat` row) is what provides these pages, with a floating panel as the
fallback.

## The DSH-TUI edition

Under the `dsh-tui` profile the same bundle gains terminal surfaces that mirror the Web tabs: a keyed
**status line** above the prompt (team, boulder/plan, workmate library), a full-screen **board**, the
**`/mpd`** command tree, managed dialogs, shortcuts, and the **`/settings`** section for the
`mpd.jsonc` knobs — bridged to `<workspace>/.mpd/mpd.jsonc` and effective **after a restart**.

- `/mpd` opens the picker; `/mpd status` prints the summary; `/mpd team` opens the team-workflow
  surface (id/name/phase, plan-review state, roster, task DAG, mailbox tail); `/mpd plan` is the
  plan-approval surface described above.
- The surfaces degrade instead of failing: a profile without the TUI service seams simply does not
  show them.

Install steps for this edition are in *Install for the terminal UI* above; the surface-by-surface
parity ledger against the Web edition (including the still-open deviations) is
[`docs/tui-parity.md`](./docs/tui-parity.md), and the deep detail (admission, distribution
artifacts, per-package compatibility) is [`docs/tui.md`](./docs/tui.md).

## Settings (`.mpd/mpd.jsonc`)

Configuration is JSONC and layered: the project file `<workspace>/.mpd/mpd.jsonc` is merged over the
user file `$DSH_HOME/mpd.jsonc`, **per key**, project wins. Read what is in effect with
`mpd_config_get` (one key: `mpd_config_get { "key": "memory.vcs" }`) and re-read the files with
`mpd_config_reload`.

```jsonc
// <workspace>/.mpd/mpd.jsonc
{
  "memory":         { "vcs": "git", "dir": ".mpd/memory", "reflectionEvery": 20 },
  "boulder":        { "dir": ".mpd" },
  "hashline":       { "guardEditTools": true, "maxDiffChars": 4000 },
  "commentChecker": { "autoCheck": false, "bin": ".toolchain/node_modules/.bin/comment-checker" },
  "ulw":            { "maxRounds": 6, "planDir": ".mpd/plans", "stateDir": ".mpd/ulw" },
  "team":           { "stateDir": ".mpd/team" },
  "teamModels":     { "slot1": { "provider": "deepseek-official", "model": "deepseek-v4-flash", "reasoningEffort": "max" } }
}
```

| Key | Consumer | Meaning |
|---|---|---|
| `memory.vcs` | `mpd-memory` | `git`, `svn` or `both` |
| `memory.dir`, `memory.agentSlug`, `memory.reflectionEvery` | `mpd-memory` | Memory root, agent slug, reflection cadence |
| `boulder.dir` | `mpd-boulder` | Where the ledger and plan files live |
| `hashline.guardEditTools`, `hashline.maxDiffChars`, `hashline.registryFile` | `mpd-hashline` | Guard flag, diff cap, registry file |
| `commentChecker.autoCheck`, `.bin`, `.timeoutMs`, `.maxMessageChars` | `mpd-comment-checker` | Detector behaviour and binary |
| `ulw.maxRounds`, `ulw.planDir`, `ulw.stateDir`, `ulw.provider`, `ulw.model`, `ulw.reviewerModel`, `ulw.maxReReviews` | `mpd-ulw` | Rounds, directories, model routes, review ceiling |
| `extensions.enable`, `extensions.disable` | `mpd-ext` | Per-id enable/disable lists (process-level) |
| `extensions.mcp.*` | `mpd-ext` | MCP bridge defaults: `enabled`, `connectTimeoutMs`, `toolCallTimeoutMs` |
| `modelchain.<chainKey>` | `mpd-modelchain` | Provider/model chains per roster role |
| `team.stateDir` | `agent-teams` | Where team state lives (default `.mpd/team`) |
| `teamModels.slot{1,2,3,4}.*` | `agent-teams` (via `mpd-config`) | The four team-model slots |

The **team-model slots** are how a team member gets its model unless it declares its own route:

| Slot | Default route | Members |
|---|---|---|
| `slot1` | `deepseek-official` / `deepseek-v4-flash` @ `max` | Architect, Planner, Reviewer, Lead, Senior Engineer |
| `slot2` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Researcher, Explorer, Plan Reviewer |
| `slot3` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Deep Worker, Junior Engineer |
| `slot4` | `deepseek-official` / `deepseek-v4-flash-vision-exp` @ `high` | Vision Analyst — this model **must** accept image input |

A slot that cannot be resolved fails team creation **loudly**, naming the member and the slot, writes
no team state, and never silently clamps a `reasoningEffort`.

How to change a knob:

- **Web**: the MPD settings card edits the same keys.
- **TUI**: `/settings` — 25 editable knobs (the 13 core keys plus the twelve `teamModels` leaves,
  which are selection-only fields fed by the live model catalog). It opens on your **file** value,
  not a schema default, and a save writes `<workspace>/.mpd/mpd.jsonc` for the live session
  workspace, preserving comments, key order and trailing commas. With no live session the save is
  kept in the host settings document and reported as `no-live-session`; with more than one live
  workspace it is refused as `ambiguous-multi-root` and every candidate is named — in both cases no
  file changes and nothing is lost.
- **Either way it takes effect after a restart**: the plugins capture their configuration when they
  mount.

`mpd-codegraph` is deliberately not in this table: it reads `autoInit`, `initTimeoutMs`,
`cooldownMs` and `binary` from its **bundle-patch row**, not from `mpd.jsonc`.

## Where your state lives

Everything the bundle writes is workspace-scoped under `.mpd/`, except the user-level workmate
library and your DSH home settings. Uninstalling the bundle removes the code, never your data.

| Path | Holds |
|---|---|
| `<workspace>/.mpd/mpd.jsonc` | Your project-level settings |
| `<workspace>/.mpd/team/` | Team state: rosters, tasks, attempts, mailboxes, archives |
| `<workspace>/.mpd/memory/` | The memory store (one VCS repository per agent slug) |
| `<workspace>/.mpd/memory.json` | Key/value notes from `mpd_memory_save` |
| `<workspace>/.mpd/boulder.json`, `<workspace>/.mpd/plans/` | The boulder ledger and your plan files |
| `<workspace>/.mpd/hashline-files.json` | Files registered for the anchored-edit guard |
| `<workspace>/.mpd/ulw/<id>/` | Ultrawork run state and the per-lane ledger |
| `<workspace>/.mpd/extensions/` | Per-session (project) extensions |
| `<workspace>/.codegraph/` | The project code graph (gitignored) |
| `~/.mpd/workmate/` | The workmate library — cross-project, yours, survives uninstall |
| `~/.mpd/extensions/` | Host-wide extensions (may contribute MCP servers and roles) |
| `$DSH_HOME/mpd.jsonc` | Your user-level settings, merged under each project's file |

## Troubleshooting

| Symptom | What to do |
|---|---|
| `error: required option '--profile <name>' not specified` | Add `--profile web` (or `--profile dsh-tui`) to the `dsh plugin` command |
| A tool or preset is missing after install | Restart `dsh` — plugin modules are cached at session start; after a code change also rebuild the package's `dist/` |
| `dsh-tui requires an interactive terminal` | Run it from a real terminal; `dsh-tui doctor` checks the profile and the toolchain |
| CodeGraph tools answer nothing | Run `/mpd-codegraph` to build `.codegraph/codegraph.db`, and install `@colbymchenry/codegraph` or set `MPD_DSH_CODEGRAPH_BIN` |
| `mpd_comment_check` reports the binary is missing | Install `@code-yeongyu/comment-checker` into `.toolchain` or set `MPD_DSH_COMMENT_CHECKER_BIN` |
| A workmate rename/delete is refused | The instance is in use by a team member or an in-flight spawn — finish or reassign that work first |
| A knob you saved does not apply | The plugins capture configuration at mount: restart the session |
| A team task will not accept an update | The attempt is stale — the task was reassigned; claim the current attempt or ask the captain |
| `mcp__git_bash__*` is unavailable | That row is `disabled: true` by default (Windows only); enable it in the bundle patch |

More: [`docs/user-guide.md`](./docs/user-guide.md) §11 is the quick map, and
[`agent-references/troubleshooting.md`](./agent-references/troubleshooting.md) (English,
agent-facing) is the full symptom → cause → fix table.

## Documentation map

| Doc | For |
|---|---|
| [`docs/user-guide.md`](./docs/user-guide.md) | The long-form user guide: install/uninstall, the preset, tools, specialists, workmates, teams, the GUI, configuration, extensions, troubleshooting |
| [`docs/design.md`](./docs/design.md) | The detailed design document: how the bundle is assembled and mounts — boot chain, plugin inventory, state layout |
| [`docs/tui.md`](./docs/tui.md) | The DSH-TUI edition: install, TUI-native surfaces, admission and distribution artifacts, compatibility ledger, NOT-CLAIMED list |
| [`docs/extension-authoring-guide.md`](./docs/extension-authoring-guide.md) | Writing an extension: when it is the right instrument, plane selection, isolation posture, the template walkthrough, distribution |
| [`docs/extensions.md`](./docs/extensions.md) | The extension developer guide: the contract, the four kinds, the CLI |
| [`EXTENSIONS-FOR-AGENTS.md`](./EXTENSIONS-FOR-AGENTS.md) | The machine contract for an agent that writes an extension (English) |
| [`docs/development.md`](./docs/development.md) | Building, testing, QA gates, packing and releasing this repository |
| [`docs/index.md`](./docs/index.md) | The documentation hub and reading order |
| [`AGENTS.md`](./AGENTS.md) | The binding repository manual for agents and maintainers (English) |

## Architecture, in one pointer

This README deliberately stops at *how to use*. How the bundle is put together — the boot chain, the
patch layers and their order, the plugin inventory and what each row registers, the adapter seam,
the state layout, and the invariants behind them — is the subject of
[`docs/design.md`](./docs/design.md) (Chinese twin:
[`docs/design.zh-CN.md`](./docs/design.zh-CN.md)). Read it before changing anything under
`packages/`.

## Acknowledgements

This bundle stands on other people's work, and it is worth being precise about which parts.

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** — author **code-yeongyu**
  and contributors. The specialist roster, the eleven role descriptions and the model-chain
  vocabulary come from this project; it is pinned at commit `8c57e46` (v5.0.0-beta.20) and ships here
  as adapted teammate templates and workmate base templates. The pinned baseline is an engineering
  reference, not an identity: this repository is not a fork of OMO and does not chase it release by
  release.
- **[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)** — author
  **程序员阿江 (Relakkes)**, MIT. The `agent-teams` plugin is adopted outright and ships as
  first-class main code at `packages/mpd-agent-teams-plugin/` (adopted version `0.1.16-rc.3-mpd`; the
  vendored runtime closure keeps each dependency's own LICENSE). It provides the team engine behind
  `agent_teams_*` and the AgentTeams Web panel. Its licence and notices are preserved in
  [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md).
- **DeepSeek Harness host packages (`@deepseek-ai/*`)** — the DeepSeek team, MIT. The host supplies
  the plugin system, the tool/agent/skill/preset seams, the model providers and the Web shell this
  bundle plugs into; those packages are referenced as dependencies only.
- **[ast-grep](https://github.com/ast-grep/ast-grep)** (MIT) — the AST-aware engine behind the
  `ast_grep` MCP server, consumed as the optional dependency `@ast-grep/cli@0.45.2`.
- **[codegraph](https://github.com/colbymchenry/codegraph)** (MIT) — the structural code-graph
  engine behind the `codegraph` MCP server and the `mpd-codegraph` row, consumed as the optional
  dependency `@colbymchenry/codegraph@1.5.0`.
- **[comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)** (MIT) — the
  comment/docstring detector behind `mpd_comment_check`, consumed as the optional dependency
  `@code-yeongyu/comment-checker@0.8.0`.
- **`dsh-better-sidebar`** — the community sidebar bundle that hosts the AgentTeams and Workmates
  tabs; the pages are contributed to it, and the `agent_teams_*` / `mpd_workmate_*` tools work
  without it.
- **Written here.** The DSH plumbing (the harness adapter, the runtime plugins, the `mpd` preset, the
  combined web client), the DSH-TUI edition, the QA suite, the documentation and the extension
  interface are this project's own work.

Thanks are due to all of them, and to the many contributors behind the tools this bundle is built
on.

## License

The repository is licensed under **SUL-1.0**, inherited from the upstream project; see
[`LICENSE.md`](./LICENSE.md) for the full text. The upstream copyright belongs to code-yeongyu and
the oh-my-openagent contributors. The adopted `agent-teams` component keeps its own MIT licence,
which covers that component only — this project's own code is not MIT-licensed. See
[`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md) for the complete notices.
