# my-power-dsh

**English** | [中文](./README.zh-CN.md)

[![Version](https://img.shields.io/badge/version-0.11.1-blue.svg)](https://github.com/HaroldZ32/My-Power-Dsh/releases)
[![License: SUL-1.0](https://img.shields.io/badge/license-SUL--1.0-orange.svg)](./LICENSE.md)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.1.7--rc.2-4B32C3.svg)](#acknowledgements)
[![Platforms](https://img.shields.io/badge/platforms-web%20%7C%20dsh--tui-informational.svg)](./docs/tui.md)
[![Runtime](https://img.shields.io/badge/runtime-Bun%201.4.0-black.svg)](https://bun.sh)
[![Gates](https://github.com/HaroldZ32/My-Power-Dsh/actions/workflows/gates.yml/badge.svg)](https://github.com/HaroldZ32/My-Power-Dsh/actions/workflows/gates.yml)
[![Docs](https://img.shields.io/badge/docs-EN%20%2B%20%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-success.svg)](./docs/index.md)

**my-power-dsh** is a plugin bundle for the **DeepSeek Harness (DSH)**. One install turns a plain
DSH setup into a working environment for real coding work: a main agent that reads your project
rules, eleven specialists you can consult or delegate to, a library of durable "workmate" agents
that remember what they learned, multi-agent teams run on the harness's official Agent Teams plugin,
a served skill corpus, MCP integrations for code intelligence, and an extension interface that lets
other packages contribute skills, flows, MCP servers and specialists without touching the core.

This file is the **user manual**: how to install it, what to type, what each command and tool does,
how to configure it, and where your data lives. The internal assembly — boot chain, package layout,
plugin mechanics — is written down in exactly one place, and this file points at it (see
*Architecture*).

The bundle is the package `@mpd-dsh/mpd`; this repository root **is** that package. It installs with
one command and uninstalls with one command that leaves no residue.

![A my-power-dsh session in the DSH Web UI: the MPD (Main Working Agent) preset selected, the Agent Teams panel showing its roster and shared task board, and the model selector reading DeepSeek-V41-Flash.](./docs/assets/images/web-ui-session.png)

*The **MPD (Main Working Agent)** preset in the DSH Web UI, with the Agent Teams roster and shared task board open beside the conversation. Every screenshot in this manual is a real capture of the shipped bundle, taken from the running app by the Docker UI lane (`docker/ui/`).*

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Project rules and the main agent](#project-rules-and-the-main-agent)
- [Commands](#commands)
- [Usage](#usage)
- [Specialists: the roster](#specialists-the-roster)
- [Team mode](#team-mode)
- [Web GUI](#web-gui)
- [The DSH-TUI edition](#the-dsh-tui-edition)
- [Configuration](#configuration)
- [Where your state lives](#where-your-state-lives)
- [Architecture](#architecture)
- [FAQ](#faq)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features

| You want to… | Use | Where the how-to is |
|---|---|---|
| Work with an agent that knows your project rules | the **`mpd` preset** (the only preset the bundle ships) | *Project rules and the main agent* |
| Get a second opinion, or a scoped executor | the **specialist roster** — `mpd_role_spawn` | *Specialists: the roster* |
| Keep a specialist that accumulates knowledge | the **workmate library** — `mpd_workmate_*` | *Keep an evolving agent* |
| Run a real multi-agent workflow | **team mode** — the official Agent Teams tools (`spawn_teammate`, `team_task_*`) + the Web roster/task-board panel | *Team mode* |
| Drive a long objective to done | the **ULW loop** — `/ulw` | *Drive long work: the ULW loop* |
| Track a multi-step plan durably | the **boulder ledger** — `mpd_boulder_*` | *Track plan progress: the boulder ledger* |
| Remember facts across sessions | the **memory engine** — `mpd_memory_*` | *Keep durable memory* |
| Edit files without line-drift mistakes | **hash-anchored editing** — `mpd_hashline_*` | *Edit files safely* |
| Understand an unfamiliar codebase | the **MCP servers** — ast-grep, LSP, CodeGraph | *Understand a codebase* |
| Teach the bundle a new trick | the **extension interface** — `mpd_ext_*` | *Configure and extend* |
| Drive it all from a terminal | the **DSH-TUI edition** | *The DSH-TUI edition* |

## Requirements

- **DeepSeek Harness (DSH)** with a `web` or `headless` profile, and model credentials configured in
  DSH. The bundle never configures keys for you. The bundle is built and verified against harness
  **0.2.0-rc.2**.
- **Node.js** and **Bun** (`1.4.0`, the version recorded by the `buildToolchain` field in
  `package.json`) on `PATH` for the repository scripts (`bun` runs the tests and the extension CLI).
- **git**, for a source install: the primary flow clones this repository and installs from the
  checkout.
- Optional, for the code-intelligence servers: the toolchain the bundle can install
  (`node scripts/install-mcp.ts`) or your own binaries, pointed at with the documented environment
  variables (`MPD_DSH_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`, …).

## Installation

### One command, no clone (recommended)

The bundle is an ordinary package: the profile pulls it, packs it through the manifest's `files`
allowlist and mounts it from its own `cordis.patch.yml` layers. Nothing is cloned and nothing is
built on your machine.

```bash
dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh
```

Then restart `dsh` and start a session on the **MPD (Main Working Agent)** preset:

```bash
dsh web            # boot (or restart) the web profile — same as: dsh --profile web
```

Requirements: **Node.js ≥ 22.18** and `pnpm` on `PATH` — `dsh plugin` delegates the install to pnpm,
and the bundle executes TypeScript directly through Node's type stripping. The package declares no
`cordis` dependency and no `preinstall`/`install`/`postinstall`/`prepare` script, so installing it
runs no code from the package.

To remove it again:

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
```

### Work from a checkout

Cloning is the path for contributors, for a pinned revision, and for the DSH-TUI edition's checkout
flow. The rest of this section uses the checkout; every command is identical if you installed the
published package.

```bash
git clone https://github.com/HaroldZ32/My-Power-Dsh.git
cd My-Power-Dsh
```

### Install dependencies

```bash
bun install
```

The bundle declares four runtime dependencies — `dsh-better-sidebar` (the community sidebar bundle
that hosts the Workmates tab) and the three official Agent Teams packages that provide team mode (see
*What the install mounts*) — so a checkout install materializes the repository's dependencies first.
A published-package install needs none of this: pnpm resolves those dependencies itself.

If `node-gyp` is unavailable, install the sidebar without build scripts — only the sidebar's terminal
panel degrades. Earlier sidebar releases needed this because they pulled a transitive `node-pty` whose
postinstall builds with `node-gyp` (and is what pnpm reports as an ignored build script);
`dsh-better-sidebar@0.24.1` no longer depends on `node-pty` (measured 2026-10-02: it is absent from its
`dependencies`), so the flag is belt-and-braces rather than a requirement:

```bash
bun add dsh-better-sidebar@0.24.1 --ignore-scripts
```

A packed install takes care of this itself (pnpm installs the declared dependencies), see *Install
from a packed artifact* below.

### Build from source

The committed `dist/` files are build products and ship with the repository, so a plain install needs
no build step. Rebuild only the package you changed, and rebuild from the **repository root** with
path-qualified arguments:

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

A multi-entry package repeats that command per entry. `node scripts/verify-dist-fresh.ts` rebuilds
every `packages/*/src` entry and compares it byte-for-byte with the committed `dist/`, so a source
change and its rebuild belong in the same commit. `bun run typecheck` (root) and `bun test packages`
are the other two commands you will use most; the full gate list is in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

A checkout install reads the checkout directly: after a code change, rebuild the touched package's
`dist/` and restart `dsh`.

### Install the bundle into DSH (web profile)

```bash
dsh plugin --profile web add .
```

The repository root is the bundle package, so this single command installs every plugin row, the
`mpd` preset, the 19-skill corpus and the extension root — no pack step, no copy step. Then restart
`dsh` and pick the **MPD (Main Working Agent)** preset in a session:

```bash
dsh web            # boot (or restart) the web profile — same as: dsh --profile web
```

### Install for the terminal UI (`dsh-tui` profile)

The same bundle installs into the terminal-UI profile:

```bash
dsh plugin --profile dsh-tui add .
```

It joins that profile as the **third patch layer**, on top of the TUI package:
`dsh.profile.bundles` becomes
`["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`, and
`dsh --profile dsh-tui --dump-config` puts the bundle's rows in a layer of their own
(`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`). The bundle overrides NO host row: it
ships the **mpd** preset additively, and you make it the default with one user action
(`/preset mpd` in the TUI, `DSH_TUI_PRESET=mpd`, the Settings `selectedDefault` field, or
`node scripts/set-default-preset.ts --yes`) — see [docs/preset-default.md](./docs/preset-default.md).
Start it with the `dsh-tui` launcher (alias `dst`):

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
node scripts/pack-mpd.ts                       # -> dist/mpd-package/ (relocatable)
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

Every plugin below is declared by this bundle's two patch files — `cordis.patch.yml`
(everything tabulated below) and `presets/mpd.patch.yml` (the `preset-mpd` row, see *No host row is
overridden*) — and is mounted by the one `dsh plugin add` above. `package.json` lists both as
the array `dsh.bundle.patch`. The main patch carries **31 `- id:` entries, and every one of them sits
inside an `insert:` list** (five of them); it id-targets **0** host rows.
`node scripts/verify-rows-parity.ts` keeps these row ids in step with the installer, and
`node scripts/verify-no-host-override.ts` fails the moment a host row would be id-targeted.

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

**Official Agent Teams rows — 3 inserted rows**

The bundle's team capability is the **official** DSH Agent Teams plugin set, not a vendored engine:
the three packages are declared in `package.json` → `dependencies` and mounted by the rows below.
The vendored `dsh-agent-teams` engine that used to sit behind those rows was retired from the
composition and has since been DELETED (`de-vendor-and-verify-law`); *Acknowledgements* records what
of it still ships and where.

| Row id | Package | What it provides |
|---|---|---|
| `mpd-agent-team` | `@deepseek-ai/dsh-experimental-agent-team` | The `ctx.agentTeams` team service: the implicit-root roster, the durable peer mailbox and the shared task board. Roster, mailbox and task state are persisted in the **Lead's session log** |
| `mpd-tool-agent-team` | `@deepseek-ai/dsh-experimental-tool-agent-team` | The nine model-facing tools — `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update` — plus the `team:policy` prompt section every member gets |
| `mpd-ui-agent-team` | `@deepseek-ai/dsh-experimental-client-ui-agent-team` | The Web roster, shared task board and teammate-navigation panel in the conversation header (read-only: no spawn, rename, delete or interrupt control, and no task-mutation control) |

The entry ids are `mpd`-owned on purpose: the official
`@deepseek-ai/dsh-experimental-agent-team-profile` bundle mounts the same three packages under the
ids `agent-team` / `tool-agent-team` / `ui-agent-team`, and a duplicate loader entry id is fatal even
when one side is disabled. Unlike that profile bundle, this bundle also keeps the direct delegation
rows (`subagent`, `subagent_fork`) mounted, so a session has both the one-shot subagent path and the
durable team path.

**The sidebar host — 1 inserted row**

The community sidebar bundle that hosts the Workmates tab is a **declared runtime
dependency** of this bundle (`package.json` → `dependencies`, `dsh-better-sidebar`), not an optional
extra the user installs by hand: the row below mounts it, so one install command is enough.

| Row id | Package | What it provides |
|---|---|---|
| `mpd-better-sidebar` | `dsh-better-sidebar` | The sidebar host for the two mpd tabs (see *Web GUI*). It mounts **once**: the row disables itself wherever any composed patch layer already mounts the package — every declared bundle layer's `dsh.bundle.patch` (e.g. the `@linxin666/dsh-web-all` aggregate), the profile's `cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, or a `--patch` overlay path read from the command line (both `--patch X` and `--patch=X`) — or when no enabled `@deepseek-ai/dsh-host-webserver` **entry** exists (the `dsh-tui` / headless profile), or when the package cannot be resolved. A foreign layer suppresses this row only when its patch contains a **row that mounts** the package — a row naming `dsh-better-sidebar` whose `disabled` is not literally `true`; a mention inside a comment, or a row that is literally `disabled: true`, mounts nothing and does not suppress our mount. Any form the row scanner cannot parse falls back to the conservative behaviour (treated as a mount), because a false disable costs only the sidebar while a false enable dies with `duplicate prefix route`. The session then degrades to "no sidebar" with one log line instead of failing to boot |

**Remote MCP rows — 2 inserted rows** (public services: network required, optional per use)

| Row id | Server name | What it provides |
|---|---|---|
| `mcp-context7` | `context7` | The public Context7 docs service over streamable HTTP (`https://mcp.context7.com/mcp`) |
| `mcp-grepapp` | `grep_app` | The public grep.app GitHub code-search service over streamable HTTP (`https://mcp.grep.app`) |

**No host row is overridden — this patch is ADDITIVE-ONLY**

Every row the bundle ships is an `insert:` under its own entry id; it never id-targets a row a host
layer declares (`dsh-base`, `dsh-web-app`, `dsh-headless`, `dsh-tui`). The gate
`node scripts/verify-no-host-override.ts` fails if that ever changes, and a run that finds no host
layer refuses to pass vacuously.

The deployment default preset is a HOST-OWNED setting (the `default` key of the host's own
`@deepseek-ai/dsh-agent-preset-registry` row), so the bundle does not touch it: it ships the `mpd`
preset additively and leaves the choice to you — `/preset mpd` in the TUI (persisted to
`~/.dsh-tui/agent-preset.json`), `DSH_TUI_PRESET=mpd` in your own profile patch, the Settings
`selectedDefault` field in the Web UI, or `node scripts/set-default-preset.ts --yes`. See
[docs/preset-default.md](./docs/preset-default.md) for what changes for an EXISTING user (their
default stops being `mpd` until they run one of those, and a `dsh-tui` profile then falls back to the
host's `standard`, which that composition does not ship).

The `mpd` preset itself — its persona, the project-instruction convention, its tool rows — is
declared by the bundle's SECOND patch file, `presets/mpd.patch.yml`, as a **row** rather than a
directory: an insert of `preset-mpd` with `name: '@deepseek-ai/dsh-agent-preset'`, `config.id: mpd`
and the preset's whole child entry list inline under `config.plugins`. Harness **0.1.7-rc.2 replaced
the directory form**: `@deepseek-ai/dsh-agent-presets` (the package that served `preset.yml` +
`agent.cordis.yml` from a preset root) no longer exists, there is no `<bundle>/presets` preset root
and no `$DSH_HOME/.agent-presets` copy, and `package.json`'s `dsh.bundle.patch` is the two-file array
named above.

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

![The Plugins page of the DSH Web UI after the one install command: @mpd-dsh/mpd listed under Installed with its toggle on, above the harness's own official plugins.](./docs/assets/images/web-ui-plugins.png)

*What the one install command produced, as a user sees it: the Plugins page lists `@mpd-dsh/mpd` under **Installed** with its toggle on — the whole bundle arrives as that single package.*

## Quick start

1. **Install** (above), restart `dsh`, and start a session on the **MPD** preset.
2. **Ask for something real.** The agent has `bash`/`read`/`edit` plus the MCP code tools. Drop an
   `AGENT.md` in your project to steer it; it is read automatically at session start.
3. **Consult a specialist.** `mpd_roles_list` shows the roster, then
   `mpd_role_spawn { role: "Architect", task: "review the module boundaries in src/" }`.
4. **Keep the good one.** `mpd_workmate_init { base: "Architect", name: "system-architect" }`, then
   reuse it with `mpd_workmate_spawn { name: "system-architect", task: "…" }`.
5. **Scale to a team.** Ask for one, or describe work that warrants one: the captain spawns each
   member with `spawn_teammate` (name, description, initial prompt) and opens its lane with
   `team_task_create`, then drives it with `send_message` / `wait_agent`. Watch the roster and the
   shared board in the Web panel's **Agent Teams** view (conversation header).
6. **Teach it your own capability.** Put an extension directory into `<workspace>/.mpd/extensions/`
   and check it with `mpd_ext_list`.

![The DSH Web UI landing screen for a workspace: the composer with the MPD (Main Working Agent) preset selected and the DeepSeek-V41-Flash model route shown.](./docs/assets/images/web-ui-home.png)

*Step 1 in the Web GUI: a new session's composer, already on the **MPD (Main Working Agent)** preset, with the model route and permission mode beside it.*

## Project rules and the main agent

The bundle ships one preset: **MPD (Main Working Agent)**. Selecting it in a session gives you:

- **Project rules loaded automatically** — at the start of every session the agent attempts to read
  `AGENT.md`, falling back to `AGENTS.md`, then `CLAUDE.md`. Write the file once and every session
  starts already knowing your conventions.
- **The harness's own tools plus the bundle's** — `bash`, `read`, `edit`, `glob`, `grep` and the
  rest are exposed directly; everything this bundle adds (`mpd_*`, the official `spawn_teammate` /
  `team_task_*` team tools, the MCP servers) appears next to them.
- **Routing built in** — the preset's persona explains the roster, the workmate library and team
  mode, so the agent reaches for the right instrument without extra setup.

![The Agent presets settings page: the MPD (Main Working Agent) preset listed under CUSTOM and badged as the default for a new task.](./docs/assets/images/web-ui-agent-presets.png)

*The **Agent presets** page: the bundle's `mpd` preset is the custom entry badged **New task default**, so a new session starts on it without anyone picking it.*

You do not have to choose a preset per task: the same session keeps its preset, and every capability
below is available inside it.

## Commands

Slash commands are typed into the session prompt.

| Command | What happens |
|---|---|
| `/ulw <objective>` | Starts an ultrawork run: the objective is triaged, planned when the work warrants it, executed in rounds, and pushed through the verification and quality gates before it reports done. `/ultrawork <objective>` is the same command |
| `/mpd-codegraph` | Initializes (or re-runs) the CodeGraph index for the session workspace — `.codegraph/codegraph.db`. Errors if the codegraph binary is unavailable: install it or set `MPD_DSH_CODEGRAPH_BIN` |
| `team:` / `!team` in a message | An explicit team request — signal **A** of the session-start complexity gate, and the marker is **consumed** from the message. With the default `team.gate: "mechanical"` the gate STAGES an approvable plan shell (0 members, 0 tasks) and injects ONE notice naming the returned plan id; NOTHING is spawned, and the shell is INERT until the captain extends it (`add_member` / `create_task`) and approves it with `agent_teams_plan {action:"approve"}` |
| `/mpd` (TUI) | The terminal command tree: a bare `/mpd` opens the picker; the actions are `board`, `team`, `plan`, `workmates` and `status` (`/mpd status` prints the summary, the others open their TUI scene) |
| `/goal <objective>` | Creates a persisted session goal (the host's goal row, enabled by the `mpd` preset): one long-running objective that continues across turns |
| `/settings` (TUI) | Edits the `mpd.jsonc` knobs listed under *Configuration* below |

## Usage

This is the index; each subsection below shows the concrete call.

| You want to… | Tools |
|---|---|
| Understand a codebase | `mcp__ast_grep__*`, `mcp__lsp__*`, `mcp__codegraph__*`, `mcp__context7__*`, `mcp__grep_app__*` (`mcp__git_bash__*` has a row but ships **disabled by default**, Windows only — no such tool exists until you enable it) |
| Edit safely | the write guard and truncation rows, `mpd_hashline_read/edit/format/restore`, `mpd_comment_check` |
| Drive long work | `mpd_ulw` / `mpd_ultrawork`, `mpd_boulder_*` |
| Keep memory | `mpd_memory_write/read/reflect/reflect_complete/status`, `mpd_memory_save/recall` |
| Consult a specialist | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona`, `mpd_modelchain_resolve` |
| Keep an evolving agent | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` |
| Run a team | `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create/list/get/update`, `mpd_team_compact_run/status`, `session-watchdog-*` |
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

![Flowchart of an ultrawork run: entry, triage, optional plan, round-by-round execution through the pin → red → green → surface → clean cycle, the verification gate and the quality gate, with a feedback path from a red gate back into the round.](./docs/assets/images/ulw-loop.svg)

*One ultrawork run, from `/ulw` to "done" — the objective is triaged first, and the run only reports done after both gates pass. Run state and the per-lane ledger live under `<workspace>/.mpd/ulw/<id>/`.*

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

Team work is the **official Agent Teams plugin** (`mpd-agent-team` / `mpd-tool-agent-team` /
`mpd-ui-agent-team`, see *What the install mounts*). Your session agent is the **Lead**; a teammate is
a named, durable child with its own mailbox. The calls, in the order you use them:

```jsonc
spawn_teammate { "name": "senior-1", "description": "Owns the README pair", "prompt": "<persona text + the task>", "context": "fresh" }
team_task_create { "subject": "Rewrite the install chapter", "description": "…", "blocked_by": [], "write_scopes": ["README.md"] }
team_task_list { "ready": true }                          // what is claimable right now
team_task_get { "task_id": "task-3" }                     // the full task, with its current revision
team_task_update { "task_id": "task-3", "expected_revision": 2, "action": "claim" }
send_message { "target": "senior-1", "message": "…" }     // durable; target comes from list_agents
list_agents { }                                           // each member's target + availability
wait_agent { "timeout_ms": 60000 }                        // the next team change; re-read state after
interrupt_agent { "target": "senior-1" }                  // Lead only: stop the current turn, keep the inbox
```

The board is **compare-and-set**: `team_task_update` carries the revision you read, a stale one is
rejected instead of overwriting newer work, and its actions are `claim`, `release`, `edit`,
`set_dependencies`, `complete`, `reopen`, `reassign` and `delete`. A task is claimable only when
everything in `blocked_by` is complete. `write_scopes` are advisory hints that raise an overlap
warning, never a lock.

The mailbox is **durable**: a message is stored before delivery, so the result is `accepted`
(delivered now) or `queued` (waiting) — a queued message must never be resent. A running target is
steered at its nearest step boundary; an inactive one is started or cold-resumed. `list_agents`
reports `inactive` for "no turn is executing" — that is not a task verdict, and `wait_agent` answers
`noProgress` immediately when no other member is running or provisioning.

Two bounds to know before you promise a result:

- **A teammate inherits the Lead's model route.** The official `TeamService` forwards only the prompt
  and the parent to the subagent registry, so no per-teammate provider, persona or tool filter can be
  injected. The `teamModels` slots (see *Configuration*) therefore apply to the **one-shot consult**
  path (`mpd_role_spawn`, `mpd_workmate_spawn`); if a teammate needs a different model, say so in its
  prompt.
- **The roster's read-only discipline still holds.** A teammate whose name normalises to a read-only
  roster member (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst) is denied
  the seven write tools by a guard keyed on team membership — the official `spawn_teammate` cannot
  take a per-teammate tool filter, so the guard is what enforces it.

`mpd_team_compact_run` compacts a **finished** team's member contexts (the Lead is never compacted)
and writes an audit record under `<workspace>/.mpd/team-compact/`; `mpd_team_compact_status` reads it,
including why a member was skipped. The `session-watchdog-*` tools are the stall detector's own
surface (heartbeats, incidents, the preserving hold) — read-only unless you are deliberately releasing
a hold. Note that `<workspace>/.mpd/team/` is **not** where team state lives any more: the official
service keeps roster, mailbox and board in the Lead's session log.

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
bun scripts/mpd-ext.ts validate extensions/mpd-ext-example   # exit 0 when valid, 1 with per-item errors
bun scripts/mpd-ext.ts scaffold <dir>                        # start from templates/mpd-extension/
bun scripts/mpd-ext.ts list                                  # what this host discovered
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

![Team-mode lifecycle: a triggered session-start gate stages an approvable, inert plan shell (0 members, 0 tasks), the Lead extends and approves it and decides the roster and task graph, teammates are spawned and tasks posted, members claim and complete work, the wave is compacted and the next wave starts in a new session. A guardrails band lists the read-only tool denial, the durable mailbox, the compare-and-set board and advisory write scopes.](./docs/assets/images/team-lifecycle.svg)

*One team wave, end to end. The session-start complexity gate STAGES an approvable plan shell (0 members, 0 tasks — nothing spawned, inert until approved); the Lead extends and approves it, and the wave is compacted and ended when it lands.*

The session agent is the **Lead** (the captain). It decides a roster and a task DAG, spawns each
member as a named teammate, opens every task on the shared board, and integrates the results itself.
Members are the specialists above; the read-only disciplines stay read-only; a teammate can be given a
workmate's persona text, so it works with that instance's accumulated knowledge. Every member — the
Lead included — holds the same nine tools, and the `team:policy` prompt section states the shared
rules: one working directory, edits visible to everyone immediately, split write scopes, and wait for
the team before answering.

### Start a team

A team is not a precondition of a session. When the session-start complexity gate triggers, it STAGES an
approvable plan **shell** through `agent_teams_plan` — 0 members, 0 tasks, and INERT: nothing is spawned,
and no teammate exists until the captain extends it (`add_member` / `create_task`, each member's prompt
taken from `mpd_role_persona`) and approves it with `agent_teams_plan {action:"approve"}`, which is what
spawns the members and posts their tasks. Under `team.gate: "advisory"` — or with that tool unmounted —
the ONE notice is advisory instead and says `NO team was staged`; the captain then stages the team itself,
when the work warrants it. The official tools stay the interface for the members and the board:

```jsonc
spawn_teammate {
  "name": "senior-1",                      // lowercase, permanent, never reused
  "description": "Owns the README pair",
  "prompt": "<the persona text from mpd_role_persona> + the exact task",
  "context": "fresh"                       // "book" a fresh child, or "fork" to inherit the Lead's turns
}
team_task_create {
  "subject": "Rewrite the install chapter",
  "description": "…what done looks like, and the evidence expected…",
  "blocked_by": [],                        // task ids that must complete first
  "write_scopes": ["README.md"]            // advisory hints; overlap raises a warning, never a block
}
```

`spawn_teammate` is **Lead-only**, and a name is reserved by the first creation attempt even when that
attempt fails. The captain fetches a roster member's persona text with `mpd_role_persona` and pastes it
into the prompt — nothing injects it for you.

### The shared task board

Any member can create a task; the Lead assigns, and any member claims and completes. The board carries
the work once it exists: a staged plan shell is INERT until it is extended and approved, and only an
**approved** plan spawns members and posts tasks — the work starts then, not when the shell is staged.

- **`team_task_create`** adds a task with a title, details, optional `blocked_by` dependencies and
  optional `write_scopes`. A task is claimable only when everything it depends on is complete.
- **`team_task_list`** browses the active board (`status`, `owner`, `ready` filters); **`team_task_get`**
  reads one task with its current `revision`.
- **`team_task_update`** is compare-and-set: pass the `expected_revision` you read, choose an action
  (`claim`, `release`, `edit`, `set_dependencies`, `complete`, `reopen`, `reassign`, `delete`), and a
  stale revision is **rejected** rather than overwriting newer work. Reassign is the Lead's way to move
  work between members. A deleted task is tombstoned: it leaves the active list, not the history.
- **Write scopes are advisory.** Two in-progress tasks that plan to touch overlapping paths raise a
  warning; the board never blocks a claim and never authorizes a write. Bash, formatters and code
  generators bypass every check, so the Lead coordinates ownership and reviews the final diff.

### Messages, waiting and interruption

- **`send_message`** reaches the Lead (`target: "lead"`) or any teammate. Delivery is durable: the
  result is `accepted` or `queued`, and a queued message is already stored — never resend it. A running
  target is steered at its nearest step boundary; an inactive one starts or cold-resumes.
- **`list_agents`** shows every member's `target` and availability. Use that `target` value as the
  `target` of a message or an interrupt, and as a task's `owner`. `inactive` means no turn is
  executing (loaded or stored); `provisioning` and `failed` describe creation.
- **`wait_agent`** waits for the next team change — a status edge, an incoming message or a task
  update — instead of polling. It answers `noProgress` immediately when no other member is running or
  provisioning, which means "wake a teammate first"; either way, re-read the state afterwards.
- **`interrupt_agent`** is Lead-only: it stops a teammate's current turn, keeps its queued messages,
  and does not release task ownership.

### Finish: compact

When every task is terminal and every member idle, `mpd_team_compact_run` compacts the members'
contexts and records the audit under `<workspace>/.mpd/team-compact/` (the Lead is never compacted).
Keep one team per wave: a team accumulates members and tasks for the life of the session, so end the
wave when it lands and start the next one in a new session.

## Web GUI

- **Agent Teams** — the official roster and shared task board for the current conversation, opened
  from the conversation header (the `mpd-ui-agent-team` row →
  `@deepseek-ai/dsh-experimental-client-ui-agent-team`). It shows every member with its phase, the
  tasks with owner, blockers, readiness and advisory write scopes, and it navigates into a
  teammate's conversation. It is **read-only**: it cannot spawn, rename, delete or interrupt a
  teammate, and it has no task-mutation controls — those belong to the tools. The panel reads the
  Lead session's live projection, so a roster or task change appears while it is open; if the plugin
  was enabled after the conversation opened, reload the page once.
- **Workmates tab** — the workmate library: instances with base, use count and note, a filter, an
  open view for persona/memory/note, and the init / rename / delete flows (delete is a two-step
  confirmation, with a typed name for a permanent purge).

The Workmates tab is contributed to the community sidebar bundle `dsh-better-sidebar` and appears in
its tab strip. That sidebar is **installed and mounted with this bundle**: `dsh-better-sidebar` is a
declared runtime dependency and the `mpd-better-sidebar` row mounts it (see *What the install
mounts*), so the tab works out of the box after the one install command above. The page is
**sidebar-only** — no floating-panel fallback: the one warning path (`… has no host`) is what a
missing or broken dependency produces (a checkout install that never ran `bun install`, or a non-web
composition, where the row disables itself on purpose). Everything stays usable through the
`mpd_workmate_*` tools, and the bundle's own web client (loaded through the `mpd-web-compat` row) is
what provides that page.

## The DSH-TUI edition

Under the `dsh-tui` profile the same bundle gains terminal surfaces that mirror the Web tabs: a keyed
**status line** above the prompt (team, boulder/plan, workmate library), a full-screen **board**, the
**`/mpd`** command tree, managed dialogs, shortcuts, and the **`/settings`** section for the
`mpd.jsonc` knobs — bridged to `<workspace>/.mpd/mpd.jsonc` and effective **after a restart**.

- `/mpd` opens the picker; `/mpd status` prints the summary; `/mpd board`, `/mpd team`,
  `/mpd plan` and `/mpd workmates` open the corresponding TUI scenes
  (`packages/mpd-tui-plugin/src/command-trees.ts` is the action list).
- The surfaces degrade instead of failing: a profile without the TUI service seams simply does not
  show them.

Install steps for this edition are in *Install for the terminal UI* above; the surface-by-surface
parity ledger against the Web edition (including the still-open deviations) is
[`docs/tui-parity.md`](./docs/tui-parity.md), and the deep detail (admission, distribution
artifacts, per-package compatibility) is [`docs/tui.md`](./docs/tui.md).

## Configuration

Configuration is JSONC and layered: the project file `<workspace>/.mpd/mpd.jsonc` is merged over the
user file `$DSH_HOME/mpd.jsonc`, **per key**, project wins. Read what is in effect with
`mpd_config_get` (one key: `mpd_config_get { "key": "memory.vcs" }`) and re-read the files with
`mpd_config_reload`.

![The MPD section of the DSH settings panel, showing the bundle's knobs: inline diff limit, comment checker, ultrawork rounds, memory backend, team state directory, boulder directory and watchdog enabled, each with a Reset to the file value button.](./docs/assets/images/web-ui-settings.png)

*The **MPD** settings card in the Web GUI — the same knobs as `.mpd/mpd.jsonc`, with each value showing whether it comes from the file. Captured from the shipped bundle.*

```jsonc
// <workspace>/.mpd/mpd.jsonc
{
  "memory":         { "vcs": "git", "dir": ".mpd/memory", "reflectionEvery": 20 },
  "boulder":        { "dir": ".mpd" },
  "hashline":       { "guardEditTools": true, "maxDiffChars": 4000 },
  "commentChecker": { "autoCheck": false, "bin": ".toolchain/node_modules/.bin/comment-checker" },
  "ulw":            { "maxRounds": 6, "planDir": ".mpd/plans", "stateDir": ".mpd/ulw" },
  "team":           { "stateDir": ".mpd/team" },   // legacy team records; the official team plugin keeps its state in the Lead's session log
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
| `team.stateDir` | the mpd plugins that read legacy team records (stall detector, compaction, the TUI team scene, the workmate in-use check) | Where those records live (default `.mpd/team`). The official team plugin does not read it |
| `teamModels.slot{1,2,3,4}.*` | `mpd-roles` / `mpd-workmate` (via `mpd-config`) | The four model slots of the roster's member classes — they route the ONE-SHOT consult paths |

The **team-model slots** are the default routes of the roster's member classes. They are resolved when
a specialist is spawned as a **one-shot subagent** (`mpd_role_spawn`, `mpd_workmate_spawn`), which
pass the route explicitly:

| Slot | Default route | Members |
|---|---|---|
| `slot1` | `deepseek-official` / `deepseek-v4-flash` @ `max` | Architect, Planner, Reviewer, Lead, Senior Engineer |
| `slot2` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Researcher, Explorer, Plan Reviewer |
| `slot3` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Deep Worker, Junior Engineer |
| `slot4` | `deepseek-official` / `deepseek-v4-flash-vision-exp` @ `high` | Vision Analyst — this model **must** accept image input |

A slot that cannot be resolved fails the corresponding spawn **loudly**, naming the member and the
slot, writes no state, and never silently clamps a `reasoningEffort`.

**A teammate created by `spawn_teammate` does not use these slots**: the official `TeamService`
forwards only the prompt and the parent to the subagent registry, so a teammate inherits the Lead's
route. Tell a teammate in its prompt when it needs a different model.

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
| `<workspace>/.mpd/team/` | Legacy team records. The official team plugin keeps the roster, the mailbox and the board in the **Lead's session log**, so a shipped session does not write here; the stall detector and the workmate in-use check still read this path when it exists |
| `<workspace>/.mpd/team-compact/` | The compaction audit for a finished team's member contexts (`mpd_team_compact_run`) |
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

## Architecture

![Layered architecture diagram: the DeepSeek Harness host at the top; patch layer 1 with the bundle's plugin and MCP rows; patch layer 2 with the mpd preset; the single mpd-dsh-adapter seam; the user surfaces (Web GUI, DSH-TUI edition, served skill corpus); and the state roots at the bottom.](./docs/assets/images/architecture.svg)

*How the bundle is assembled: the DSH host, the two patch layers, the one adapter seam, the surfaces the user touches and the state roots. The full assembly is [`docs/design.md`](./docs/design.md).*

This README deliberately stops at *how to use*. How the bundle is put together — the boot chain, the
patch layers and their order, the plugin inventory and what each row registers, the adapter seam,
the state layout, and the invariants behind them — is the subject of
[`docs/design.md`](./docs/design.md) (Chinese twin:
[`docs/design.zh-CN.md`](./docs/design.zh-CN.md)). Read it before changing anything under
`packages/`.

## FAQ

### Common questions

**Do I have to clone the repository?** No. Cloning is the primary source install, and it is what you
need if you intend to change the bundle. A published tarball installs with
`dsh plugin --profile web add dist/mpd-package` (see *Install from a packed artifact*).

**Does the bundle configure my model credentials?** No. DSH owns credentials and providers; the
bundle only declares the model routes its roster uses (`Configuration` → the team-model slots).

**Which preset should I pick?** **MPD (Main Working Agent)** — the only preset the bundle ships. The
deployment default is a host-owned setting the bundle deliberately does not touch, so make it yours in
one step ([docs/preset-default.md](./docs/preset-default.md)).

**Where does my data live?** Under each workspace's `.mpd/` directory, plus the user-level workmate
library at `~/.mpd/workmate/`. The complete list is *Where your state lives*; uninstalling the
bundle never removes it.

**Is this a fork of oh-my-openagent?** No. The roster, the model-chain vocabulary and the pinned
capability baseline come from that project, and the provenance is recorded in *Acknowledgements*,
[`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md) and `VENDOR_LOCK.json`.

**Why is a change not visible after I saved a setting?** The plugins capture their configuration when
they mount, so a saved knob takes effect after a restart.

### Symptom → fix index

| Symptom | What to do |
|---|---|
| `error: required option '--profile <name>' not specified` | Add `--profile web` (or `--profile dsh-tui`) to the `dsh plugin` command |
| A tool or preset is missing after install | Restart `dsh` — plugin modules are cached at session start; after a code change also rebuild the package's `dist/` |
| `dsh-tui requires an interactive terminal` | Run it from a real terminal; `dsh-tui doctor` checks the profile and the toolchain |
| CodeGraph tools answer nothing | Run `/mpd-codegraph` to build `.codegraph/codegraph.db`, and install `@colbymchenry/codegraph` or set `MPD_DSH_CODEGRAPH_BIN` |
| `mpd_comment_check` reports the binary is missing | Install `@code-yeongyu/comment-checker` into `.toolchain` or set `MPD_DSH_COMMENT_CHECKER_BIN` |
| A workmate rename/delete is refused | The instance is in use by a team member or an in-flight spawn — finish or reassign that work first |
| A knob you saved does not apply | The plugins capture configuration at mount: restart the session |
| A team task will not accept an update | `team_task_update` is compare-and-set: re-read the task with `team_task_get` and retry with its current `revision` |
| `wait_agent` answers `noProgress` at once | No other member is running or provisioning — wake a teammate first (`send_message`) or check `list_agents` |
| `mcp__git_bash__*` is unavailable | That row is `disabled: true` by default (Windows only); enable it in the bundle patch |

More: [`docs/user-guide.md`](./docs/user-guide.md) §11 is the quick map, and
[`agent-references/troubleshooting.md`](./agent-references/troubleshooting.md) (English,
agent-facing) is the full symptom → cause → fix table.

## Documentation

| Doc | For |
|---|---|
| [`docs/index.md`](./docs/index.md) | The documentation hub and reading order |
| [`docs/user-guide.md`](./docs/user-guide.md) | The long-form user guide: install/uninstall, the preset, tools, specialists, workmates, teams, the GUI, configuration, extensions, troubleshooting |
| [`docs/design.md`](./docs/design.md) | The detailed design document: how the bundle is assembled and mounts — boot chain, plugin inventory, state layout |
| [`docs/tui.md`](./docs/tui.md) | The DSH-TUI edition: install, TUI-native surfaces, admission and distribution artifacts, compatibility ledger, NOT-CLAIMED list |
| [`docs/extension-authoring-guide.md`](./docs/extension-authoring-guide.md) | Writing an extension: when it is the right instrument, plane selection, isolation posture, the template walkthrough, distribution |
| [`docs/extensions.md`](./docs/extensions.md) | The extension developer guide: the contract, the four kinds, the CLI |
| [`EXTENSIONS-FOR-AGENTS.md`](./EXTENSIONS-FOR-AGENTS.md) | The machine contract for an agent that writes an extension (English) |
| [`docs/development.md`](./docs/development.md) | Building, testing, QA gates, packing and releasing this repository |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute: development setup, gates, git model, review expectations |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release notes, one section per released version |
| [`AGENTS.md`](./AGENTS.md) | The binding repository manual for agents and maintainers (English) |

Every human-facing document ships in English and Simplified Chinese; the Chinese twin sits next to
the English file with a `.zh-CN.md` suffix and each file links to the other under its title.

## Contributing

Contributions are welcome — bug reports, documentation fixes, extensions and code alike.

1. **Read [`CONTRIBUTING.md`](./CONTRIBUTING.md)** (Chinese twin:
   [`CONTRIBUTING.zh-CN.md`](./CONTRIBUTING.zh-CN.md)). It covers the development setup, the build
   and test commands, the gate list, the git model (`dev` is the integration line;
   `feature/<slug>` and `fix/<slug>` branches; `<type>(<scope>): <summary>` commits) and the
   evidence rule.
2. **Keep the documentation bilingual.** Every human-facing doc ships an English file and a
   `*.zh-CN.md` twin with a language switch link under the title; a change to one updates both in the
   same commit. `bun run verify:docs` enforces the pair, the heading tree, the real CJK content and
   every relative link target.
3. **Leave the tree green.** `bun run verify:gates` runs the fast static gates (vendor, dist
   freshness, row parity, doc pairs, preset conformance); `bun run typecheck` and `bun test` cover the
   packages. A change without evidence on disk is not done.
4. **Open small, focused pull requests.** One capability or one defect per branch, merged with
   `--no-ff` and a descriptive message; never rebase a published branch. Bug reports are most useful
   with the exact command, the observed result and the expected one — [open an
   issue](https://github.com/HaroldZ32/My-Power-Dsh/issues) or send a pull request.

Security problems follow a separate, private path: see [`SECURITY.md`](./SECURITY.md) and never open a
public issue for one.

This repository is licensed under SUL-1.0 ([`LICENSE.md`](./LICENSE.md)); by contributing you agree
that your contribution is distributed under the same terms. Please do not include credentials, tokens
or private data in issues, pull requests or evidence.

## Changelog

Release notes live in [`CHANGELOG.md`](./CHANGELOG.md), newest first, one section per released version
(the current release is **v0.11.1**). Annotated tags are listed under
[Releases](https://github.com/HaroldZ32/My-Power-Dsh/releases).

## Acknowledgements

This bundle stands on other people's work, and it is worth being precise about which parts.

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** — author **code-yeongyu**
  and contributors. The specialist roster, the eleven role descriptions and the model-chain
  vocabulary come from this project; it is fixed at commit `8c57e46` (v5.0.0-beta.20) and ships here
  as adapted teammate templates and workmate base templates. That baseline is an engineering
  reference — historical, with no synchronisation owed: this repository is not a fork of OMO, no gate
  or document claim depends on an upstream checkout, and nothing here chases it release by release.
  Its MCP server sources are also snapshotted into this repository at
  [`vendor/mcp-src/`](./vendor/mcp-src/README.md), which is what `scripts/build-mcp.ts` builds the
  shipped servers from; the snapshot and no external checkout is the build input.
- **[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)** — author
  **程序员阿江 (Relakkes)**, MIT. Its `agent-teams` plugin was adopted outright (version
  `0.1.16-rc.3-mpd`), then retired from the composition — no loader row mounted it — and the
  `de-vendor-and-verify-law` wave DELETED the whole body. Two pieces of that work still ship,
  relocated into mpd-owned homes: the adopted browser client bundle at
  `packages/mpd-bundle-plugin/adopted/agent-teams-client.js`, which the shipped sidebar builds on,
  and the DSH runtime modules now owned at `packages/mpd-schemastery/`. Team mode runs on the
  official Agent Teams plugin (the three `mpd-*-agent-team` rows above). The MIT attribution and the
  full record are preserved in [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md).
- **DeepSeek Harness host packages (`@deepseek-ai/*`)** — the DeepSeek team, MIT. The host supplies
  the plugin system, the tool/agent/skill/preset seams, the model providers and the Web shell this
  bundle plugs into — including the **official Agent Teams plugin set**
  (`@deepseek-ai/dsh-experimental-agent-team`, `-tool-agent-team`, `-client-ui-agent-team`) that the
  bundle mounts for team mode; those packages are referenced as dependencies only.
- **[ast-grep](https://github.com/ast-grep/ast-grep)** (MIT) — the AST-aware engine behind the
  `ast_grep` MCP server, consumed as the optional dependency `@ast-grep/cli@0.45.2`.
- **[codegraph](https://github.com/colbymchenry/codegraph)** (MIT) — the structural code-graph
  engine behind the `codegraph` MCP server and the `mpd-codegraph` row, consumed as the optional
  dependency `@colbymchenry/codegraph@1.5.0`.
- **[comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)** (MIT) — the
  comment/docstring detector behind `mpd_comment_check`, consumed as the optional dependency
  `@code-yeongyu/comment-checker@0.8.0`.
- **`dsh-better-sidebar`** — the community sidebar bundle that hosts the Workmates tab; it is a
  **declared runtime dependency of this bundle** (installed and mounted with it, see *What the
  install mounts*), and the `mpd_workmate_*` tools work without it.
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
