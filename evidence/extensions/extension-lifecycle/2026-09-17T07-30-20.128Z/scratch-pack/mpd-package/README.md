# my-power-dsh

**English** | [中文](./README.zh-CN.md)

**my-power-dsh** is a plugin bundle for the DeepSeek Harness (DSH). One install turns a plain
DSH setup into a working environment for real coding work: a main agent that reads your project
rules, a roster of eleven specialists you can consult or delegate to, a library of durable
"workmate" agents that remember what they learned, multi-agent teams whose plan you approve
before anything runs, a served skill corpus, MCP integrations for code intelligence, and an
extension interface that lets other packages contribute skills, flows, MCP servers and
specialists without touching the core.

The bundle is the package `@mpd-dsh/mpd`. It installs with one command and uninstalls with one
command that leaves no residue.

## Capabilities

### The main agent: the `mpd` preset

The only shipped preset is **MPD (Main Working Agent)**. Selecting it in a session gives you:

- **Project rules loaded automatically** — the agent attempts to read `AGENT.md`, falling back
  to `AGENTS.md`, then `CLAUDE.md`, at the start of every session.
- **Native tool presentation** — the harness's own tools (`bash`, `read`, `edit`, …) are exposed
  directly, plus everything the bundle adds.
- **Routing built in** — the preset's persona explains the specialist roster, the workmate
  library and team mode, so the agent reaches for the right one without extra setup.

### Tools, by job

| You want to… | Tools |
|---|---|
| Understand a codebase | the MCP tool servers: `mcp__ast_grep__*`, `mcp__lsp__*`, `mcp__codegraph__*`, `mcp__git_bash__*` |
| Edit safely | the write guard and output-truncation rows, `mpd_hashline_read/edit/format/restore` (hash-anchored edits), `mpd_comment_check` |
| Drive long work | `mpd_ulw` / `mpd_ultrawork` (plan → execute → verify), `mpd_boulder_*` (durable plan progress) |
| Keep memory | `mpd_memory_write/read/reflect/reflect_complete/status` (git- or svn-backed), `mpd_memory_save/recall` |
| Consult a specialist | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona` |
| Keep an evolving agent | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` |
| Run a team | `agent_teams_*` plus the AgentTeams sidebar tab |
| Configure the bundle | `.mpd/mpd.jsonc`, `mpd_config_get`, `mpd_config_reload` |
| Extend the bundle | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` and the `extensions/` root |

### Specialists: the roster

Eleven specialists ship as one-shot specialist subagents — not as separate presets. Address each
by name (any case, space or hyphen spelling):

**Architect** (architecture review, deep debugging, self-review) · **Researcher** (evidence-based
code and open-source search) · **Planner** (writes plans, never implements) · **Deep Worker**
(executes a goal end-to-end) · **Senior Engineer** (primary implementation and verification) ·
**Lead** (orchestration and integration) · **Explorer** (read-only codebase search) · **Reviewer**
(risk findings, no fixes) · **Plan Reviewer** (plan QA) · **Vision Analyst** (images and
diagrams) · **Junior Engineer** (small, well-scoped changes).

Read-only disciplines (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst)
are mechanically denied the write tools at spawn time.

### The workmate library

Any specialist can be *instantiated* as a **workmate**: a durable copy under `~/.mpd/workmate/`
with its own name, persona, independent memory and a short note card. A workmate evolves after
each job — it summarizes what it did, and its next run starts from there. Reuse is matched by
`mpd_workmate_match`, and a weak match is never forced: you initialize a new workmate instead.
The Workmates sidebar tab lets you browse, open, create, rename and archive instances by hand.

### Team mode

A captain designs a roster and a task DAG, you review and approve the plan in the AgentTeams tab,
and a dependency-aware scheduler runs it. Members are the specialists above; read-only disciplines
stay read-only. Members can be backed by workmates, so a teammate carries its own accumulated
memory.

### Web GUI

- **AgentTeams tab** — the whole team surface: the conversation's live and archived teams, member
  activity, task rows, the dependency map, the stop control, and the staged-plan approval editor.
  The tab badge shows how many teams are live.
- **Workmates tab** — the workmate library: instances, notes, and the init/rename/delete flows.

Both tabs are contributed to the community sidebar bundle `dsh-better-sidebar` and appear in its
tab strip. Team work also runs entirely through the `agent_teams_*` tools if you prefer.

### DSH-TUI edition

The same bundle mounts under the host's `dsh-tui` profile, where the terminal UI hosts the
equivalents of the web tabs: a keyed status line, a full-screen board, the `/mpd` command tree,
managed dialogs, shortcuts and a `/settings` section for the twelve `mpd.jsonc` knobs — the section is
bridged to `<workspace>/.mpd/mpd.jsonc` and takes effect **after a restart**. A routed team is
reachable from the same command: **`/mpd team`** opens the team-workflow surface (id/name/phase,
plan-review state, roster, task DAG, mailbox tail) and **`/mpd plan`** the plan-approval surface —
type `approve <teamId>` exactly, then `Ctrl+X`; `Ctrl+D` twice inside ten seconds discards, and `Esc`
never mutates. The row-by-row parity of every Web-edition surface against its TUI counterpart,
including the still-open deviations, is in [`docs/tui-parity.md`](./docs/tui-parity.md) (Chinese twin:
[`docs/tui-parity.zh-CN.md`](./docs/tui-parity.zh-CN.md)). **The install steps live in ONE place:
[Install → Terminal UI (`dsh-tui`)](#terminal-ui-dsh-tui)** — the command, the
third-patch-layer composition and the launcher are documented there. The deep detail (surfaces,
admission and distribution artifacts, per-package compatibility ledger, explicit NOT-CLAIMED list)
is in [`docs/tui.md`](./docs/tui.md), with the Chinese twin at
[`docs/tui.zh-CN.md`](./docs/tui.zh-CN.md).

### Skills

18 skills ship inside the bundle and are **served, not copied**: the corpus and the `mpd` preset
live in the bundle and disappear cleanly on uninstall.

### MCP integrations

Four in-repo stdio MCP servers (ast-grep, git-bash, an LSP bridge, codegraph) plus the optional
remote rows (context7, grep_app) give the agent structural code search, language-server
intelligence, a project code graph and shell access through MCP.

### The extension interface

A standardized way for **other packages** to add capability without touching this bundle:

- a manifest — `mpd-ext.json` — declaring `skills`, `flows`, `mcp` servers and `roles`;
- three discovery roots with two lifecycles: per-session (`<workspace>/.mpd/extensions/`, skills
  and flows only) and host-wide (`~/.mpd/extensions/`, `<bundle>/extensions/`), which may also
  contribute MCP servers and roles;
- four inspection tools — `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show`;
- a dependency-free runtime bridge that connects declared stdio MCP servers when the plugin
  starts and publishes their tools as `mcp__<server>__<tool>`;
- a developer CLI — `bun scripts/mpd-ext.mjs validate|scaffold|list`.

A disabled reference extension ships in
[`extensions/mpd-ext-example/`](./extensions/README.md), and the copy-me skeleton — all four kinds,
with a placeholder id the scaffold rewrites — lives in
[`templates/mpd-extension/`](./templates/mpd-extension/README.md).

**Start here:** [the extension authoring guide](./docs/extension-authoring-guide.md) answers when to
write an extension, where it goes and how to verify it;
[`EXTENSIONS-FOR-AGENTS.md`](./EXTENSIONS-FOR-AGENTS.md) is the machine contract for an agent that
writes one; the field-level reference stays in [`docs/extensions.md`](./docs/extensions.md).

### Built to stay maintainable

- **One harness adapter.** Every plugin row talks to DSH through a single adapter package, so a
  harness release that reshapes a seam is absorbed in one file.
- **Whole-unit install and uninstall.** Rows, preset, skills and the extension root all live in
  the bundle; nothing is copied into your DSH home. What survives uninstall is your own data:
  the workmate library and each workspace's `.mpd/` state.

## Install

One command, straight from the checkout:

```bash
cd <repo> && dsh plugin --profile web add .
```

The repository root **is** the bundle package, so this installs every plugin row, the `mpd`
preset, the skill corpus and the extension root in one step — no pack step, no copy step.
Restart `dsh`, then pick the **MPD (Main Working Agent)** preset in a session.

### Terminal UI (`dsh-tui`)

The same bundle installs into the terminal-UI profile — one command, same checkout:

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

Our bundle joins that profile as the **THIRD patch layer**, on top of the TUI package:
`dsh.profile.bundles` becomes
`["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`, and
`dsh --profile dsh-tui --dump-config` puts our rows in a layer of their own
(`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`). A TUI session defaults to the
**mpd** preset. Start it with the `dsh-tui` launcher (alias `dst`):

```bash
dsh-tui            # boot in the current directory
dsh-tui --resume   # continue the previous session (-c is the shorthand)
dsh-tui --help     # update | doctor | version | help; other arguments pass through to `dsh --profile dsh-tui`
```

`dsh-tui` needs a real terminal: with piped output it refuses to boot with
`Error: dsh-tui requires an interactive terminal (stdout must be a TTY).` Run `dsh-tui doctor`
if the profile or the toolchain looks wrong. The edition's surfaces, limits and verification live
in [docs/tui.md](./docs/tui.md) (§2 has the layer stack) and
[user-guide §7](./docs/user-guide.md#7-dsh-tui-edition-the-terminal-ui).

For a published or tarball install, pack first and add the artifact to whichever profile you run:

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

The bundle uninstalls as one unit, skills included, and leaves no residue in your DSH home. Your
workmate library (`~/.mpd/workmate/`) and each workspace's `.mpd/` state stay yours.

## Quick start

1. **Install** (above), restart `dsh`, and start a session on the **MPD** preset.
2. **Ask for something real** — the agent has `bash`/`read`/`edit` plus the MCP code tools. Drop
   an `AGENT.md` in your project to steer it; it is read automatically.
3. **Consult a specialist**: `mpd_roles_list` to see the roster, then
   `mpd_role_spawn { role: "Architect", task: "…" }` for a second opinion.
4. **Keep the good one**: `mpd_workmate_init { base: "Architect", name: "system-architect" }`,
   then reuse it with `mpd_workmate_spawn`.
5. **Scale to a team**: `agent_teams_create { name: "…", description: "…", profile: "mpd",
   approval: "required" }`, review the plan in the AgentTeams tab, approve it, and watch the
   scheduler work.
6. **Point it at your own capability**: drop an extension directory into
   `<workspace>/.mpd/extensions/` and see it with `mpd_ext_list`.

## Requirements

- DeepSeek Harness (DSH) with a web or headless profile, and model credentials configured in DSH
  — the bundle never configures keys for you.
- Optional, for the code-intelligence servers: the in-repo toolchain
  (`node scripts/build-mcp.mjs`) or your own binaries, pointed at by the documented environment
  variables.

## Where to go next

| Doc | For |
|---|---|
| [`docs/user-guide.md`](./docs/user-guide.md) | Install/uninstall, the preset, tools, specialists, workmates, teams, the GUI, configuration, extensions, troubleshooting |
| [`docs/extension-authoring-guide.md`](./docs/extension-authoring-guide.md) | Writing an extension: when it is the right instrument, the one plane-selection rule, the isolation posture, the lifecycle matrix, the template walkthrough, distribution, troubleshooting |
| [`EXTENSIONS-FOR-AGENTS.md`](./EXTENSIONS-FOR-AGENTS.md) | The machine contract for an agent: kind-by-kind requirements, a validated manifest skeleton, error signatures, refusals |
| [`docs/extensions.md`](./docs/extensions.md) | The extension developer guide: the contract, the four kinds, the CLI |
| [`docs/tui.md`](./docs/tui.md) | The DSH-TUI edition: install, TUI-native surfaces, admission + distribution artifacts, compatibility ledger, NOT-CLAIMED list |
| [`docs/architecture.md`](./docs/architecture.md) | How the bundle is assembled and mounts: boot chain, plugin inventory, state layout |
| [`docs/development.md`](./docs/development.md) | Building, testing, QA gates, packing and releasing this repository |
| [`docs/index.md`](./docs/index.md) | The documentation hub and reading order |
| [`AGENTS.md`](./AGENTS.md) | The binding repository manual for agents and maintainers |

## Relationship to other projects

This bundle stands on other people's work, and it is worth being precise about which parts.

- **Carried from the upstream project.** The specialist roster and the model-chain vocabulary
  come from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (OMO), pinned at
  commit `8c57e46` (v5.0.0-beta.20). The eleven specialists ship here as adapted teammate
  templates and workmate base templates. The pinned baseline is an engineering reference, not an
  identity: this repository is not a fork of OMO and does not chase it release by release.
- **Adopted outright.** The `agent-teams` plugin from
  [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) (MIT) is vendored as
  first-class main code, with local adaptations (a boot-safety guard for the continuable-setup
  seam, the live-agent member setup, workmate persona injection, and a client export bridge). Its
  own licence and notices are preserved in [LICENSE-NOTICES.md](./LICENSE-NOTICES.md).
- **Written here.** The DSH plumbing (the harness adapter, the runtime plugins, the `mpd` preset,
  the combined web client), the QA suite, the documentation and the extension interface are this
  project's own work.

Thanks are due to the OMO authors and contributors, and to the authors of `dsh-agent-teams` for
publishing their work under a licence that permits this adoption.

## License

The repository is licensed under **SUL-1.0**, inherited from the upstream project; see
[LICENSE.md](./LICENSE.md) for the full text. The upstream copyright belongs to code-yeongyu and
the oh-my-openagent contributors. The adopted `agent-teams` component keeps its own MIT licence,
which covers that component only — this project's own code is not MIT-licensed. See
[LICENSE-NOTICES.md](./LICENSE-NOTICES.md).
