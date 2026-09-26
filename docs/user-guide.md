# User Guide

**English** | [中文](user-guide.zh-CN.md)

Everything you need to install the my-power-dsh bundle and use it day to day, in workflow order.
For the short version, see the [README](../README.md); for how it works inside, see the
[detailed design document](design.md).

## 1. Install

### One command, from the checkout

```bash
cd <repo> && dsh plugin --profile web add .        # Web GUI
cd <repo> && dsh plugin --profile dsh-tui add .    # terminal UI (DSH-TUI)
```

The repository root **is** the bundle package (`@mpd-dsh/mpd`): `dsh.bundle.patch`, `dsh.client`
and the `exports` map live in its manifest, so this one command installs every plugin row, the
`mpd` preset, the whole skill corpus and the extension root. Nothing else to run — no pack step,
no copy step. Restart `dsh`, then start a session on the **MPD (Main Working Agent)** preset.

The bundle declares four runtime dependencies: **`dsh-better-sidebar`**, the community sidebar
bundle that hosts the Workmates tab (§8), and the three official Agent Teams packages that provide
team mode. A checkout install reads this repository,
so materialize the repository's dependencies first:

```bash
cd <repo> && bun install          # required once: materializes the declared runtime dependencies
```

If `node-gyp` is unavailable (the sidebar's transitive `node-pty` builds with it),
`bun add dsh-better-sidebar@0.19.0-alpha.1 --ignore-scripts` installs the dependency without build
scripts — only the sidebar's terminal panel degrades. A packed install needs no extra step: pnpm
installs the declared dependency for you (see *Packed package* below).

`--profile` is **required on every `dsh plugin` command**, including `--help` and `remove`:
without it the CLI stops with `error: required option '--profile <name>' not specified`. The
profile names are the ones you actually run — `web` for the Web GUI and `dsh-tui` for the
terminal UI (`headless` for a scripted run).

### DSH-TUI profile (`dsh-tui`)

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

The same bundle installs into the terminal UI as the **THIRD patch layer**, on top of the TUI
package: after the install `dsh.profile.bundles` is
`["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`, and
`node scripts/dump-config.mjs --profile dsh-tui` (the repo wrapper, which prints the
composition-only warning in its own output) shows our rows in a layer of their own
(`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`) with the `mpd` preset as the
session default. Start the TUI with the `dsh-tui` launcher (alias `dst`):

```bash
dsh-tui            # boot in the current directory
dsh-tui --resume   # continue the previous session (-c is the shorthand)
dsh-tui --help     # update | doctor | version | help; other arguments pass through to `dsh --profile dsh-tui`
```

`dsh-tui` requires a real terminal: with piped output it refuses to boot with
`Error: dsh-tui requires an interactive terminal (stdout must be a TTY).` The edition's surfaces,
its NOT-CLAIMED list and its verification record are in
[tui.md](./tui.md) (see §2 for the layer stack) and §7 below.

### Packed package (release / publishing)

```bash
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/ (relocatable)
dsh plugin --profile web add dist/mpd-package
dsh plugin --profile dsh-tui add dist/mpd-package
# or from any published location
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

`pack-mpd` exists for DISTRIBUTION: it assembles a self-contained `@mpd-dsh/mpd` (built plugin
dists + the retired (unmounted) agent-teams main code + the skill corpus and the preset patch +
the scaffold
`templates/` + the `docs/` set with its EN / `zh-CN` pairs + the on-demand `agent-references/`
(the troubleshooting table and the adopted-plugin delta registry) + the combined web client + the
packed-form patch) that does not depend on a checkout. Since the 2026-09-17 packaging change the
artifact is **author-facing** too: the extension CLI, the scaffold template and the guides all
travel inside the package, so an installed bundle answers
`bun node_modules/@mpd-dsh/mpd/scripts/mpd-ext.mjs validate <dir>` and its `docs/` is readable in
place. Use it when publishing, shipping a tarball, or testing relocation; a local install never
needs it. What the artifact must carry is not left to trust: `node scripts/verify-pack-closure.mjs`
fails loudly when a declared asset is absent, when `docs/`+`templates/` differ from the source file
for file, or when the packed manifest's `files` list disagrees with what is on disk.

### Uninstall (one command, no residue)

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

The bundle installs as ONE unit and uninstalls as ONE unit, skills included: the plugin rows come
from the bundle patch, the `mpd` preset is declared by the `preset-mpd` row in
`presets/mpd.patch.yml` (with `agent-preset-registry` id-targeted to `default: mpd`) and the skill
corpus from `<bundle>/skills` (the `mpd-bootstrap` row
registers a `ctx.skills` provider). Nothing is copied into `$DSH_HOME`, so removal takes the
rows, the preset and the skills with it — the stock preset roster returns and `$DSH_HOME/skills`
stays as it was. What deliberately survives is YOUR data: the
workmate library (`~/.mpd/workmate`) and each workspace's `.mpd/` state.

Upgrading from a bundle `<= 0.2.6` (which copied presets + skills into `$DSH_HOME`): the first
boot of `>= 0.3.0` removes those stamped copies itself. Unstamped copies left by the legacy
`scripts/install-profile.mjs` flow are not touched — delete them by hand if you used that flow.

### Legacy installer (dev/QA only)

```bash
node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]
node scripts/install-profile.mjs            # --dry-run prints the plan, writes nothing
```

Never run the legacy installer against the real home from a QA context (`--dsh-home` exists for
isolated QA). The supported user path is `dsh plugin add`.

## 2. The `mpd` preset

The only shipped preset is **MPD (Main Working Agent)**. Its conventions:

- **Every project instruction file**: at session start the agent MUST attempt to read `AGENT.md`
  (falling back to `AGENTS.md`, then `CLAUDE.md`) — the preset configures
  `dsh-agent-instructions` with those candidate names.
- **Native tool presentation**: the harness's own tools (bash/read/edit/…) are exposed directly.
- The preset persona explains the specialists, team mode and the workmate library (see below), so
  the agent routes correctly without extra setup.

## 3. Tools, by job

| You want to… | Tools | Notes |
|---|---|---|
| Explore a codebase | `mcp__ast_grep__*` (structural search/rewrite), `mcp__lsp__*` (definitions, references, diagnostics, rename), `mcp__codegraph__*` (project graph) | MCP tool servers; their tools appear as `mcp__<server>__<tool>`. A fourth family, `mcp__git_bash__*`, is **not available by default**: its row ships `disabled: true` (the upstream server is native-Windows-only), so no such tool appears in a normal session — enable it by flipping that row's `disabled:` to `false` in `packages/mpd-bundle/cordis.patch.yml` and reinstalling the bundle. |
| Edit safely | the write guard and output truncation (no configuration needed), `mpd_hashline_read/edit/format/restore`, `mpd_comment_check` | hash-anchored edits reject a stale anchor instead of writing to the wrong line |
| Drive long work | `mpd_ulw` (light) / `mpd_ultrawork` (full discipline: plan gate, execution rounds, verification gate), or the equivalent `/ulw <objective>` / `/ultrawork <objective>` commands, `mpd_boulder_start/status/complete/task_timer/plan_progress/plans` | the commands inject the ULW autonomy directive — a run asks the user nothing and stages its own team when the work warrants one; `mpd_boulder_*` tracks progress of a plan markdown file across sessions |
| Keep memory | `mpd_memory_write/read/reflect/reflect_complete/status`, `mpd_memory_save/recall` | the VCS-backed store can be git or svn; `mpd_memory_save/recall` is the simple key/value layer |
| Consult a specialist | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona` | one-shot subagents; read-only roles are denied write tools |
| Keep an evolving agent | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` | see §5 |
| Run a team | `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, `team_task_create/list/get/update` + the Web Agent Teams panel | see §6 |
| Configure the bundle | `.mpd/mpd.jsonc`, `mpd_config_get`, `mpd_config_reload` | see §9 |
| Extend the bundle | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` | see §10 |
| Resolve a model route | `mpd_modelchain_resolve` | resolves the provider/model a specialist would use |
| Inspect retired teams | `mpd_team_compact_run`, `mpd_team_compact_status` | compaction audit for finished teams |

Every family above has a literal, copy-pasteable call in §13, and the slash commands are listed in
full in §12.

## 4. Specialists (the roster)

The roster's 11 specialists are specialist subagents, **not presets**. Address each by NAME (any
case, space or hyphen spelling: `Architect`, `deep worker`, `plan-reviewer`):

| Name | Discipline |
|---|---|
| Architect | architecture review, deep debugging, self-review — read-only |
| Researcher | evidence-based code / open-source search — read-only |
| Planner | produces plans, never implements — read-only |
| Deep Worker | executes a goal end-to-end |
| Senior Engineer | primary implementation and verification |
| Lead | orchestration and delegation |
| Explorer | read-only codebase search |
| Reviewer | correctness and risk findings, no fixes |
| Plan Reviewer | checks a plan is executable, rejects only true blockers — read-only |
| Vision Analyst | reads screenshots and diagrams — read-only |
| Junior Engineer | small, well-scoped mechanical changes |

Use them one-shot:

- `mpd_roles_list` — list the roster.
- `mpd_role_spawn { role, task, context? }` — spawn one specialist as a subagent with its persona
  and model route; read-only roles are mechanically denied the write tools.
- `mpd_role_persona { role }` — fetch the full persona text (e.g. to pass to a spawn surface that
  takes persona as text).

## 5. Workmate library (durable, evolving specialists)

The roster is **base templates only**. When you will reuse a specialist across sessions,
instantiate it as a *workmate* — a durable copy under `~/.mpd/workmate/` (your HOME,
cross-project) with an independent name.

```text
mpd_workmate_init   { base: <functional name>, name?: <independent name>, note? }
  → creates ~/.mpd/workmate/<name>/{meta.json, persona.md, memory.md, note.md}
```

`base` is the specialist's **functional name** (`Deep Worker`, not a roster id — ids are internal
and are refused). Omit `name` and the instance is auto-named from that functional name
(`Deep Worker` → `deep-worker-1`). `meta.json` records the internal `baseId` as provenance, but no
tool output, route or GUI ever exposes it.

| Tool | Use |
|---|---|
| `mpd_workmate_list` | list instances (name, baseName, uses, updatedAt, note) |
| `mpd_workmate_spawn { name, task, context? }` | one-shot reuse: the workmate runs with its evolved persona + independent memory + note on its own model route; it is instructed to call `mpd_workmate_reflect` before its final report |
| `mpd_workmate_reflect { name, task, outcome, persona_delta?, note? }` | self-evolve after work: bounded memory append (oldest evicted), persona revision merge, note regenerate, `uses++` |
| `mpd_workmate_match { task }` | rank notes against a task; below threshold → `matched: false` and the suggestion is to **initialize a NEW workmate** — never force a weak match |
| `mpd_workmate_rename { name, new_name }` | rename an instance (moves its evolved identity) |
| `mpd_workmate_delete { name, purge?, confirm? }` | delete an instance — archive-first; permanent only with `purge: true` + `confirm: <name>` |

Size caps keep injected context bounded: persona ≤ 8 KiB, memory ≤ 8 KiB, note ≤ 1.5 KiB.

Workmates are your agents' *evolving memory*: after each task the workmate itself summarizes (via
the spawn instruction or the team-member persona), so future sessions start from where it left
off.

### Renaming and deleting a workmate

**Names are ASCII-only** (`[a-z0-9_-]`, lower-case). `Alice`, a CJK name, `a/b` or `..` is refused
up front with `400 invalid-name` — nothing on disk is touched. Unicode names are a known
follow-up, not a bug.

**Rename** (`mpd_workmate_rename { name, new_name }`) MOVES the workmate instead of rebuilding it:
the directory key, `meta.json`, the library index, the note's self-reference and its
previous-name history (`renamedFrom`) all move together, while persona, memory, use count and
creation date are preserved byte-for-byte. Renaming onto an existing name is refused
(`409 collision`), and so is renaming to the current name.

**Delete** (`mpd_workmate_delete { name }`) is **archive-first**: the instance moves to
`~/.mpd/workmate/.archive/<name>-<stamp>/`, disappears from `list` and `match` immediately, and
can be brought back by hand:

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

Only the explicit purge destroys anything: `mpd_workmate_delete { name, purge: true,
confirm: "<name>" }` — the exact name is required, and without it the call is refused and nothing
is removed. There is no in-product restore button: archive-first is deliberately one-way in the
UI, and recovery is the `mv` above.

**Both mutations are refused while the workmate is in use** — by an in-flight
`mpd_workmate_spawn`, or by a LEGACY team record (a non-archived record under `.mpd/team/` names it;
a team run on the official plugin keeps no such record). The refusal is
`409 in-use` and names the blocking team ids and members, so it is actionable: finish the running
spawn (or clear those legacy records), then repeat the mutation. The same gate covers the rename
*target*, so renaming a workmate **to** a name that is recorded as in use is refused the same way.

## 6. Team mode

Team mode runs on the harness's **official Agent Teams plugin**, mounted by this bundle's rows
`mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` (see
[`design.md`](design.md) for the row inventory). Your session agent is the **Lead** (the captain): it
spawns named teammates, opens tasks on a shared board and integrates the results.

```text
spawn_teammate { name, description, prompt, context: "fresh" | "fork" }   # Lead only
team_task_create { subject, description, blocked_by?, write_scopes? }
team_task_get { task_id } / team_task_list { status?, owner?, ready? }
team_task_update { task_id, expected_revision, action }                   # compare-and-set
send_message { target, message } / list_agents { } / wait_agent { timeout_ms }
interrupt_agent { target }                                                # Lead only
```

- **There is no staged plan and no approval mode.** The old two-phase flow (stage a plan, approve it
  in the GUI, then spawn) belonged to the retired vendored plugin. Here the captain spawns a member and
  opens its task; the board *is* the plan, and the work starts when a teammate is spawned.
- **The board is compare-and-set.** `team_task_update` carries the `expected_revision` you read and
  answers a stale revision with an error instead of overwriting newer work. Actions: `claim`,
  `release`, `edit`, `set_dependencies`, `complete`, `reopen`, `reassign`, `delete`.
- **`write_scopes` are advisory.** Two in-progress tasks that plan to touch overlapping paths raise a
  warning; the board never blocks a claim and never authorizes a write, and bash/formatters/codegen
  bypass every check — the Lead coordinates ownership and reviews the final diff.
- **Messages are durable.** `send_message` answers `accepted` (delivered now) or `queued` (stored and
  waiting), and a queued message must never be resent. `list_agents` reports each member's `target` and
  availability (`inactive` means no turn is executing, not that the work is done); `wait_agent` answers
  `noProgress` immediately when no other member is running or provisioning.
- **Read-only members stay read-only.** Architect, Researcher, Planner, Explorer, Plan Reviewer and
  Vision Analyst are denied the seven write tools: on the one-shot path through `toolFilter.deny`, and
  on the team path through a tool guard in `mpd-roles-plugin` keyed on team membership, because the
  official `spawn_teammate` cannot take a per-teammate tool filter. Workers (Senior Engineer, Junior
  Engineer, Deep Worker, Lead, Reviewer) implement and verify.
- **A teammate runs on the Lead's model route.** The official `TeamService` forwards only the prompt
  and the parent to the subagent registry, so the `teamModels.slot*` settings apply to the ONE-SHOT
  consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`) and cannot be injected per teammate. If a
  member needs another model, say so in its spawn prompt.
- **Workmate-backed members are a prompt, not an injection.** Nothing carries a workmate's persona
  into a teammate automatically any more: initialize or pick the workmate
  (`mpd_workmate_init` / `mpd_workmate_match`), read what it should carry, and put that text into the
  `spawn_teammate` prompt; record the outcome afterwards with `mpd_workmate_reflect` (§5).
- **Extension roles are not team members**: an extension can contribute a role usable by
  `mpd_role_spawn` / `mpd_role_persona`, but the teammate roster is the roster the captain spawns by
  name, so extension roles never become teammates on their own (see §10).

### The call shapes

```text
# create a teammate and its lane
spawn_teammate { "name": "senior-1", "description": "Owns the README pair", "prompt": "<persona + task>", "context": "fresh" }
team_task_create { "subject": "Rewrite the install chapter", "description": "…", "blocked_by": [], "write_scopes": ["README.md"] }

# work the board (any member; the Lead may also reassign)
team_task_list { "ready": true }
team_task_get { "task_id": "task-3" }
team_task_update { "task_id": "task-3", "expected_revision": 2, "action": "claim" }
team_task_update { "task_id": "task-3", "expected_revision": 3, "action": "complete" }

# coordinate
list_agents { }
send_message { "target": "senior-1", "message": "Land the README edit before the guide." }
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "target": "senior-1" }     # Lead only: stop the turn, keep the inbox
```

§13.1 is the literal walkthrough — creating members and tasks, driving the board, reassigning,
finishing a wave. The `session-watchdog-*` tools are a separate, internal stall-detection layer (see
§12 and [`tui.md`](tui.md)).

## 7. DSH-TUI edition (the terminal UI)

The same bundle runs as a **TUI edition** under the host's `dsh-tui` profile: the profile's own
terminal UI hosts TUI-native surfaces for what the web GUI renders as tabs. The edition is documented
in depth in [`tui.md`](tui.md); this chapter is the day-to-day summary.

```sh
dsh plugin --profile dsh-tui add /path/to/my-power-dsh
```

That ONE command is the whole install (plugin code, the bundle-level `dsh-plugin.json`, the skills
corpus, the MCP rows). There is no per-package `dsh plugin add`, and the TUI package ships no
`cordis.patch.yml` of its own — the bundle patch owns the single `mpd-tui` row, because a second mount
would duplicate a loader entry id, which the loader rejects outright. After that install
`dsh.profile.bundles` is `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`
— this bundle is the **third** patch layer — and a session created in the TUI defaults to the **mpd**
preset. The host needs a real terminal: `dsh-tui` refuses to start when stdout is not a TTY
(`dsh-tui requires an interactive terminal (stdout must be a TTY)`), so it is never driven through a
pipe.

### 7.1 TUI-native surfaces and their web counterparts

| Web surface | TUI equivalent |
|---|---|
| Agent Teams panel (conversation header) | the `tuiScenes` full-screen board plus the keyed `tuiStatus` line |
| Workmates sidebar tab | the `/mpd` command tree (`tuiCommandTrees`) plus `tuiDialogs` |
| Settings → MPD section | the `/settings` section (`tuiSettingsSections`) |
| — | `tuiShortcuts` keyboard shortcuts |

These are **equivalents, not parity**: each surface is rebuilt on the host's own TUI seams, and two
seams are deliberately not claimed — the host offers no prompt slot (`tuiPrompt` is host-unavailable)
and it projects no transcript row for the bundle's renderer event, so neither a prompt slot nor a
transcript line is claimed. The full list is §10 NOT-CLAIMED of [`tui.md`](tui.md).

### 7.2 The `/settings` screen and the `mpd.jsonc` bridge

`/settings` edits the real `mpd.jsonc` knobs — 25 in all (the original 13 plus the twelve
`teamModels` slot leaves, which are selection-only fields whose options come from the live model
catalog, with the declared lists as fallback), among them `hashline.maxDiffChars`,
`commentChecker.autoCheck`, `ulw.maxRounds`, `memory.vcs`, `team.stateDir` and `boulder.dir` — under the
harness settings namespace `mpd`. That namespace is served by `packages/mpd-config-plugin`, whose base
is the workspace FILE value, so the screen opens on your file rather than on a schema default; a save
**writes `<workspace>/.mpd/mpd.jsonc`** for the live session workspace, preserving comments, key order
and trailing commas — the same write-back the Web GUI card triggers (§3.1 of [`tui.md`](tui.md)).

Two things to know before you rely on it:

- **It takes effect after a restart.** The mpd plugins capture their configuration when they mount
  (`applies: "restart"`), and the host exposes no disposal handle for a live namespace registration, so
  a saved knob is used by the plugins after you restart the session. The on-screen hint says exactly
  that.
- **Two named skip cases.** The settings path carries no workspace identity, so the write target is
  the live session workspaces at the moment of the save: with **no** live session the save is stored in
  the host settings document and reported as `no-live-session`; with **more than one** live workspace it
  is refused as `ambiguous-multi-root` and every candidate is named. In both cases **no file is
  changed** and the value is **not lost** — it lives in the settings document and the config layer
  applies it to every workspace immediately; only the file write waits for exactly one live session.

A duplicated key in `mpd.jsonc` is edited at its **last** occurrence (the one `JSON.parse` reads) and
the diagnostic names every occurrence line; a duplicated intermediate object is refused as
`ambiguous-intermediate` with the file byte-untouched (§6.5 of [`tui.md`](tui.md)).

### 7.3 The `/mpd` command and the status line

`/mpd` is the TUI command tree over the same state the sidebar tabs showed: a bare `/mpd` opens the
picker, `/mpd <value>` goes direct, and `/mpd status` prints the summary. The **status line**
(`tuiStatus`) is a keyed single line above the prompt reporting the bundle's live state — team,
boulder/plan and the workmate library — read from the `.mpd` state of the session's workspace. It is
display-only; the interactive half lives in the board scene, the dialogs and the shortcuts.

For the admission and distribution artifacts, the per-package compatibility ledger, the version
strings, the state scopes and the explicit NOT-CLAIMED list, read [`tui.md`](tui.md).

## 8. Web GUI

- **Agent Teams** (the team surface): the official client plugin
  `@deepseek-ai/dsh-experimental-client-ui-agent-team`, mounted by this bundle's `mpd-ui-agent-team`
  row, adds an **Agent Teams** action to the conversation header. It reads the Lead session's
  `agentTeam` projection from the shared session store, so updates appear while the panel stays open.
  It lists the roster (durable names and phases: `running`, `inactive`, `provisioning`, `failed`) and
  the shared task board (task identity, owner, blockers, readiness, advisory write scopes and overlap
  warnings), and it navigates into a teammate's conversation. It is **read-only**: the panel cannot
  spawn, rename, delete or interrupt a teammate and offers no task-mutation control — those belong to
  the tools in §6. Peer messages are not shown; the panel shows roster and tasks only. If the plugin
  was enabled in an already-open conversation, reload the page once to receive the projection.
- **Workmates sidebar tab**: the workmate library is contributed as a tab to **DSH-better-sidebar**
  (the community sidebar bundle, installed with this bundle), so it lives where that sidebar's own
  pages do — tab strip, `+` menu, and the sidebar's own enable/disable switch. The page lists
  `~/.mpd/workmate/` instances (base, uses, updated,
  note), filters them, opens one for its persona/memory/note, and initializes a new one from a
  roster-backed **base picker** (no id typing) plus an optional name and note. It also **renames**
  and **deletes** the selected instance — the delete flow is explicit (a confirmation step, then
  archive, then a further step that requires typing the exact name for a permanent purge), and
  both operations are localized zh/en. It reads and posts to the host routes
  `GET /plugins/mpd-workmate/{list,roster,get}` and
  `POST /plugins/mpd-workmate/{init,rename,delete}`. The sidebar **tab-strip label** itself stays
  the English `Workmates` (a documented deferral: the strip label is resolved where no localized
  translator is in scope); the page body follows your language.
- **Sidebar-only for the workmate page**: it has no fallback, and the sidebar host itself is
  installed with the bundle — `dsh-better-sidebar` is a declared runtime dependency and the
  `mpd-better-sidebar` patch row mounts it, so the one warning path is a **missing or broken
  dependency**, not a missing manual install. Without a host the page logs exactly one warning and
  registers nothing. Team work still runs through the official team tools, and the workmate library
  is still fully usable through the `mpd_workmate_*` tools.

## 9. Configuration (`mpd.jsonc`)

`mpd-config` merges the project layer `.mpd/mpd.jsonc` over the user layer `$DSH_HOME/mpd.jsonc`
(per key, project wins). Query the resolved values with `mpd_config_get` and re-read them with
`mpd_config_reload`. Keys consulted by plugins:

| Key | Consumer | Meaning |
|---|---|---|
| `memory.vcs` | mpd-memory | `git` / `svn` / `both` |
| `memory.dir`, `memory.agentSlug`, `memory.reflectionEvery` | mpd-memory | memory root, agent slug, reflection cadence |
| `boulder.dir` | mpd-boulder | boulder ledger location |
| `hashline.*` | mpd-hashline | guard flag, diff cap, registry file |
| `commentChecker.*` | mpd-comment-checker | autoCheck, binary, timeouts |
| `ulw.*` | mpd-ulw | rounds, plan/state dirs, provider/model routes |
| `extensions.enable`, `extensions.disable` | mpd-ext | per-id enable/disable lists for extensions (process-level: see §10) |
| `extensions.mcp.*` | mpd-ext | MCP bridge defaults: `enabled`, `connectTimeoutMs`, `toolCallTimeoutMs` |
| `modelchain.*` | mpd-modelchain | provider/model chains per roster role |
| `team.stateDir` | the mpd plugins that read legacy team records (watchdog web routes, compaction, the TUI team scene, the workmate in-use check) | where those records live (defaults to `.mpd/team`). The official team plugin does not read it |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate (via mpd-config) | the four **team-model slots**: `{provider, model, reasoningEffort}` per slot, defaulting to `deepseek-official` / `deepseek-v4-flash` at `max`/`high`/`high` (slot 4: `deepseek-official` / `deepseek-v4-flash-vision-exp` at `high`). Slot 1 routes Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/Plan Reviewer, slot 3 Deep Worker/Junior Engineer, slot 4 Vision Analyst — the vision member, whose slot model MUST accept image input. They are resolved by the ONE-SHOT consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass the route explicitly; a teammate created by `spawn_teammate` inherits the Lead's route instead (§6). A slot that cannot be resolved fails the corresponding spawn **loudly** (the member and the slot are named, nothing is written) and an effort is never silently clamped. Editable as selection-only fields in **Settings → MPD** and the TUI `/settings` section; a saved change reaches the file immediately and the plugins after a restart. |

`mpd-codegraph` is deliberately absent from this table: it takes `autoInit`, `initTimeoutMs`,
`cooldownMs` and `binary` from its **bundle-patch row** options (read at apply time), and no plugin
reads a `codegraph.*` key through `mpd.jsonc`. Its row ships `autoInit: true` and
`initTimeoutMs: 60000` in `packages/mpd-bundle/cordis.patch.yml`.

### 9.1 When a saved knob takes effect

This is the part users get wrong, so it is stated per knob. The general rule: a consumer reads its
configuration through the `mpdConfig` service when it **mounts** (`apply()`), so a value that changed
— hand-edited in `.mpd/mpd.jsonc` or `$DSH_HOME/mpd.jsonc`, or saved through **Settings → MPD** /
the TUI `/settings` screen — changes plugin **behaviour** after a **`dsh` restart**.

Two things do not wait for that restart, and both are useful:

- **The read-back is always immediate.** `mpd_config_get` and `mpd_config_reload` re-read the layers
  on every call and report the new resolved value right away. That is how you verify an edit landed,
  even while the already-mounted plugin still holds its captured value.
- **`watchdog.*` is re-read live.** The watchdog re-resolves its knobs at mount, on a settings-document
  update and once per tick, so a file edit reaches it in THIS process with no restart;
  `session-watchdog-status` prints the per-knob LIVE vs FILE value with its `restartRequired` flag.

| Knob | Who reads it | Read when | Takes effect |
|---|---|---|---|
| `hashline.*` | mpd-hashline | at mount | after a `dsh` restart |
| `commentChecker.*` | mpd-comment-checker | at mount | after a restart |
| `ulw.*` | mpd-ulw | at mount | after a restart |
| `memory.*` | mpd-memory | at mount | after a restart |
| `boulder.dir` | mpd-boulder | at mount | after a restart |
| `modelchain.*` | mpd-modelchain | at mount | after a restart |
| `extensions.enable` / `.disable` / `.mcp.*` | mpd-ext | when the plugin starts (process-level) | after a restart |
| `team.stateDir` | the mpd plugins that read legacy team records, through the live service | per call | right after the service re-reads the file (`mpd_config_reload`, or any settings save). These are LEGACY records: the official team plugin keeps its roster, mailbox and board in the Lead's session log, not here |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate, resolved at the one-shot consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`) | at spawn | the next one-shot spawn: a settings save establishes the file watcher and re-reads, so no restart is needed; after a hand edit, call `mpd_config_reload` once (or restart) so the resolve reads the new value. A `spawn_teammate` teammate is NOT routed by these slots |
| `watchdog.*` | mpd-team-watchdog | at mount, on a settings update, and every tick | live — no restart |

`mpd-codegraph`'s knobs are the exception that proves the rule: they are patch-row options
(`autoInit`, `initTimeoutMs`, `cooldownMs`, `binary`), so they change only by editing the row and
reinstalling.

## 10. Extensions, from your side

The extension interface lets a package — or a plain directory — add skills, flows, MCP servers
and specialist roles to your DSH setup without touching the bundle. The full contract for authors
is in [extensions.md](extensions.md); this section is what a *user* needs.

**Where extensions are discovered** (an extension is a directory containing `mpd-ext.json`):

| Root | When | May contribute |
|---|---|---|
| `<workspace>/.mpd/extensions/` | re-read per call, from the calling session's workspace | skills + flows only |
| `~/.mpd/extensions/` | discovered when the plugin starts | skills, flows, MCP servers, roles |
| `<bundle>/extensions/` | discovered when the plugin starts | skills, flows, MCP servers, roles |

**Adding one.** Drop the directory in the right root (host-wide if it needs MCP servers or roles;
per-workspace if it only adds skills and flows), then restart `dsh`. There is no reload tool: a
restart is the honest reload.

**Turning one on or off.** An extension's own manifest has `"enabled": true|false`; the shipped
reference extension is disabled by default. You can also override it without editing the
manifest, in `.mpd/mpd.jsonc`:

```jsonc
{
  "extensions": {
    "enable": ["my-runtime-ext"],
    "disable": ["noisy-ext"],
    "mcp": { "enabled": true, "connectTimeoutMs": 10000, "toolCallTimeoutMs": 60000 }
  }
}
```

`disable` wins over `enable`, which wins over the manifest's own `enabled`.

**Checking what loaded.** `mpd_ext_list` shows every known extension with its plane, effective
enabled state, contribution counts, per-item errors and — per extension — which of its claimed skill
names the harness catalog really serves; `mpd_ext_show { id }` shows one extension
in full, including that serving check, each MCP server's exact state (`connected`, `unavailable`,
`failed`, `disabled`) and the tools it published. (`mpd_ext_show` redacts the MCP `env` values an
author declared — the keys stay visible, the secrets do not reach your session log.) `mpd_flow_list` / `mpd_flow_show` inspect contributed
flows. Validate a directory before trusting it:

```bash
bun scripts/mpd-ext.mjs validate <dir>     # exit 1 + one line per problem
bun scripts/mpd-ext.mjs scaffold my-ext --dir /tmp   # start from a working skeleton
```

**The honest limits.**

- **Per-session extensions add skills and flows only.** Tool and provider registration is
  process-global, so a workspace-level manifest that declares `mcp` or `roles` is rejected per
  item with a stated reason — it never half-loads.
- **There is no reload.** Editing an extension's manifest or assets takes effect on the next
  `dsh` start; `mpd_ext_list` has no reload counterpart by design.
- **Extension roles are not team members.** They are usable through `mpd_role_spawn` /
  `mpd_role_persona` and as workmate base templates, but the teammate roster is fixed: a teammate
  exists only when the captain spawns it by name with `spawn_teammate`.
- **`extensions.*` configuration is process-level**, read when the plugin starts — it is not
  scoped per session.
- **A fourth-party MCP server is a child process.** It never inherits credential-shaped variables
  from your host environment; declare what it needs in the manifest's `env`.

## 11. Troubleshooting quick map

- `mpd_role_spawn` reports an unknown role → roles answer to their NAMES (`Architect`,
  `Deep Worker`, `plan reviewer` — any case/space/hyphen spelling); run `mpd_roles_list`.
- `mpd_workmate_*` says "mpdRoles service unavailable" → the `mpd-roles` row is not mounted
  (reinstall the bundle).
- A workmate rename/delete is **refused because it is in use** → an `mpd_workmate_spawn` is still
  running, or a LEGACY (pre-0.1.7) non-archived team record under `.mpd/team/` names it. The refusal
  lists the blocking teams; let running spawns finish (or clear the legacy records) and repeat.
- A workmate was deleted by accident → its default delete only ARCHIVED it: move
  `~/.mpd/workmate/.archive/<name>-<stamp>` back to `~/.mpd/workmate/<name>`. There is no
  in-product restore, and a `purge` (run with `confirm: <name>`) is unrecoverable.
- A workmate name is rejected (`400 invalid-name`) → names are ASCII-only, lower-case
  `[a-z0-9_-]`: uppercase, spaces, punctuation, `/` and CJK names are refused before anything is
  touched.
- **An extension does not appear in `mpd_ext_list`** → check the directory really contains
  `mpd-ext.json`, that it sits directly under one of the three roots, and that `dsh` was
  restarted. A rejected manifest is reported by `mpd_ext_list` with its per-item reason.
- **An extension's MCP tools are missing** → `mpd_ext_show { id }` reports the server's state:
  `unavailable`/`failed` carry the child's stderr tail and the reason; `disabled` means the
  extension is off or `extensions.mcp.enabled` is false. A tool whose **arguments** cannot be
  projected onto the harness subset is skipped loudly (it appears as a recorded error), not
  silently; a foreign `outputSchema` costs the tool only its `structuredContent` — the tool still
  registers, with the reason recorded. A skill that is claimed but not served is reported as
  `notServed` (`served` means the harness catalog really resolves the name to that extension).
- **A project-level extension's `mcp`/`roles` items were rejected** → expected: only host-wide
  roots (`~/.mpd/extensions/`, `<bundle>/extensions/`) may contribute tools and providers. Move
  the directory, or drop the unsupported kinds from the manifest.
- Workmates tab missing from the sidebar → rebuild the shipped client
  (`node scripts/build-mpd-client.mjs`, then reload) and confirm the profile has the sidebar host.
  The bundle installs it itself (declared dependency + the `mpd-better-sidebar` row); if
  `dsh-better-sidebar` is absent from the profile, the install did not materialize the dependency —
  run `bun install` in the checkout (or
  `bun add dsh-better-sidebar@0.19.0-alpha.1 --ignore-scripts`) and reinstall the bundle. Without the
  host the workmate page logs one warning and registers nothing.
- The Agent Teams panel is missing from the conversation header → its row is
  `mpd-ui-agent-team` (`@deepseek-ai/dsh-experimental-client-ui-agent-team`, a declared dependency);
  reinstall the bundle and reload the page once. It appears only when the session really has a Team
  projection to show.
- Client surface missing entirely in the GUI → the `mpd-web-compat` self-row must exist and the
  bundle must be reinstalled (`dsh plugin --profile <p> add <repo-or-package>`).
- `MISSING_CREDENTIAL` → the provider route needs a key in your DSH credentials; keys are never
  configured by this bundle.
- AGENT.md not injected → the session runs a non-`mpd` preset; switch presets.
- **No `mpd` session can be created and the error says `agent-preset/invalid … $.prefix missing
  required value`** → the installed harness changed the `dsh-persona` contract (it takes `prefix`,
  not the retired `text`) and refuses to mount the whole preset. Update the bundle (`git pull`,
  then `dsh plugin --profile <p> add <repo>`) — this is a harness-version compatibility fix, not a
  configuration problem on your side.
- **`mcp__git_bash__*` tools are missing** → expected, not a fault: the `mcp-gitbash` row ships
  `disabled: true` (the upstream server is native-Windows-only). Use the harness's own `bash` tool,
  or enable that row (`disabled: false`) and reinstall the bundle.
- **A knob you saved does not apply** → the plugins capture their configuration at mount: restart the
  session. `mpd_config_get` proving the new value is NOT proof that the running plugin acts on it
  (§9.1 says which knobs are live instead).
- **A document link 404s after an upgrade** → the design document was RENAMED in this release (it used
  to be `architecture.md`, and `docs/design.zh-CN.md` is the Chinese twin of the current name), so an
  older copy of these docs points at a file that no longer exists. Reinstall the bundle (`git pull`,
  then `dsh plugin --profile <p> add <repo>`) to pick up the repointed pair.

## 12. Command reference

Every slash command a session can use, with where each one works. The table carries two classes: the
**four commands this bundle contributes** (`mpd-ulw` registers `/ulw` and `/ultrawork`,
`mpd-codegraph` registers `/mpd-codegraph`, and `mpd-tui` registers `/mpd`), and the **two
HOST-provided commands the bundle only documents** — `/settings`, the host's TUI settings screen
(whose MPD section the bundle extends), and `/goal`, the host goal command the `mpd` preset mounts.
Nothing else exists — in particular **there is no `/roster` command** (the roster is reached with the
`mpd_roles_list` tool) and **no `/agent-teams` command** (team work is driven by the official
`spawn_teammate` / `team_task_*` tools; the retired vendored plugin that registered that command is no
longer mounted).

| Command | What it does | Where |
|---|---|---|
| `/ulw <objective>` | starts the ultrawork loop on the objective — the same engine as `mpd_ulw`, at the lighter default tier | Web + TUI |
| `/ultrawork <objective>` | identical to `/ulw` (both submit the ULW activation directive as your own next turn) | Web + TUI |
| `/mpd-codegraph` | resolves the codegraph binary and initialises/refreshes the project index under `.codegraph/` | Web + TUI |
| `/mpd` | the TUI command tree over bundle state: a bare `/mpd` opens the picker, `/mpd <value>` goes direct, `/mpd status` prints the summary | **TUI only** — under Web the registration is refused and nothing is exposed |
| `/settings` | the host's settings screen; the MPD section edits your `mpd.jsonc` | **TUI only** |
| `/goal` | the host's goal command, mounted by the `mpd` preset (the Web overlay disables the host's own `tool-goal` / `command-goal` rows, so the preset carries both) | Web + TUI |

The objective is free text after the command name. A bare `/ulw` with no objective prints usage and
starts nothing; on surfaces without command adjudication (a headless run) the same text is submitted
as a directive instead.

## 13. Recipes: literal calls

Each block below is literally what you or your agent type; tool arguments are JSON, and the tool names
are stable. This is the "how do I call this" section: when you want a specific behaviour, ask for the
exact call.

### 13.1 Teams

```text
# (a) creating the team: one spawn per member, one task per lane
spawn_teammate { "name": "senior-1", "description": "Owns the README pair", "prompt": "<mpd_role_persona text> + Rewrite the install chapter. A user can install from a checkout in one command; verify with bun run verify:docs.", "context": "fresh" }
team_task_create { "subject": "Rewrite the install chapter", "description": "Cover both profiles and the packed package.", "blocked_by": [], "write_scopes": ["README.md"] }
team_task_create { "subject": "Verify the README pair", "description": "Run the docs gate and report the raw output.", "blocked_by": ["task-1"], "write_scopes": [] }

# (b) working the board (compare-and-set: re-read before every update)
team_task_list { "ready": true }
team_task_get { "task_id": "task-1" }                                  // → revision
team_task_update { "task_id": "task-1", "expected_revision": 1, "action": "claim" }
team_task_update { "task_id": "task-1", "expected_revision": 2, "action": "complete" }

# (c) driving a running team
list_agents {}
send_message { "target": "senior-1", "message": "Land the README edit before the guide." }
team_task_update { "task_id": "task-1", "expected_revision": 2, "action": "reassign", "owner": "junior-1" }   // Lead only
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "target": "senior-1" }                               // Lead only; the inbox is kept

# (d) finishing a wave
mpd_team_compact_run {}
mpd_team_compact_status {}
```

Team names are permanent and are never reused. `write_scopes` are advisory (workspace-relative
prefixes): overlapping in-progress tasks are warned about, never blocked. A task update based on an
outdated `revision` is rejected — that rejection is the mechanism that stops a reassigned task from
accepting a late result. There is no plan-approval step: the board is the plan, and the quality
discipline is whatever the captain puts in the task description.

### 13.2 The ULW loop and its gates

```text
mpd_ulw { "objective": "Make every link in the doc pair resolve" }
mpd_ultrawork { "objective": "Rewrite the install chapter", "tier": "heavy", "strictReview": true, "maxRounds": 4 }
/ulw Make every documented command resolve to a real registration
```

`mpd_ulw` is the light alias (tier `light`, no plan file); `mpd_ultrawork` runs the full discipline:
the optional adversarial hyperplan wave, the **plan gate** (planner + plan review) when a plan file is
used, execution rounds driven per criterion (PIN → RED → GREEN → SURFACE → CLEAN), the **verification
gate** (momus reviewer, at most 2 re-reviews) when a plan exists AND (`tier: "heavy"` or
`strictReview`), then the **final quality gate** with a per-lane ledger. State and ledger live under
`.mpd/ulw/<id>`. An activated run asks you nothing: it triages first, stages its own team when the
work warrants one, and closes out through the gates.

### 13.3 Specialists (one-shot subagents)

```text
mpd_roles_list {}
mpd_role_spawn { "role": "Reviewer", "task": "Review docs/user-guide.md against its contract; report findings only.", "context": "The contract requires a literal invocation for every tool family." }
mpd_role_persona { "role": "Architect" }
```

`role` answers to the functional NAME (`Architect`, `deep worker`, `plan-reviewer`). A read-only role
is spawned with a deny filter over exactly `write`, `edit`, `mpd_hashline_edit`, `bash`,
`mcp__ast_grep__rewrite`, `mcp__ast_grep__scan` and `mcp__lsp__rename` — the discipline is mechanical,
not advisory.

### 13.4 The workmate library

```text
mpd_workmate_match { "task": "review a bilingual doc pair for parity" }
mpd_workmate_init { "base": "Reviewer", "name": "doc-reviewer", "note": "bilingual doc parity reviews" }
mpd_workmate_spawn { "name": "doc-reviewer", "task": "Review the guide pair.", "context": "EN and zh-CN must match section for section." }
mpd_workmate_reflect { "name": "doc-reviewer", "task": "guide review", "outcome": "2 dead links found; parity OK" }
mpd_workmate_list {}
mpd_workmate_rename { "name": "doc-reviewer", "new_name": "docs-reviewer" }
mpd_workmate_delete { "name": "docs-reviewer" }                       # archive-first
mpd_workmate_delete { "name": "docs-reviewer", "purge": true, "confirm": "docs-reviewer" }
```

`base` is the functional name; `name` is optional (auto-derived from it). A weak `mpd_workmate_match`
means initialize a NEW workmate — never force the match. Both mutations are refused while the workmate
is in use by an in-flight spawn (or by a legacy team record).

### 13.5 Hash-anchored edits

```text
mpd_hashline_read { "path": "docs/user-guide.md" }        # prints one LINE#HASH|content line per source line
mpd_hashline_edit { "path": "docs/user-guide.md", "edits": [ { "op": "replace", "pos": "7#ab12", "lines": "…" }, { "op": "replace", "pos": "9#cd34", "end": "11#ef56", "lines": ["…", "…"] }, { "op": "append", "pos": "20#0a1b", "lines": "…" } ] }
mpd_hashline_format { "path": "docs/user-guide.md" }      # register the file for the discipline
mpd_hashline_restore { "path": "docs/user-guide.md" }     # unregister it (the file itself is untouched)
```

The anchors come from `mpd_hashline_read` and are the only thing `mpd_hashline_edit` accepts: if the
file moved since that read, the edit is REFUSED with remapped refs instead of landing on the wrong
line. `pos`/`end` are `LINE#HASH`; `lines` is a string or an array of strings.

### 13.6 The boulder ledger

```text
mpd_boulder_plans {}
mpd_boulder_start { "planPath": ".mpd/plans/docs-wave.md" }
mpd_boulder_task_timer { "workId": "<work id>", "taskKey": "1", "action": "start", "taskTitle": "Rewrite the README" }
mpd_boulder_plan_progress { "planPath": ".mpd/plans/docs-wave.md" }
mpd_boulder_status {}
mpd_boulder_complete { "workId": "<work id>" }
```

A boulder binds a session to a plan markdown file so long work survives a restart; `workId` defaults
to the active work, and `taskKey` is the plan's own checklist id (`1`, `F1`, …). `action` is `start`
or `end`.

### 13.7 Memory

```text
mpd_memory_save { "key": "docs-wave-branch", "value": "feature/docs-wave" }
mpd_memory_recall { "key": "docs-wave-branch" }
mpd_memory_write { "title": "Doc wave decisions", "content": "The design document is the architecture chapter now", "kind": "note", "tags": ["docs"] }
mpd_memory_read { "query": "doc wave", "limit": 5 }
mpd_memory_status {}
mpd_memory_reflect {}
mpd_memory_reflect_complete { "title": "Doc wave", "content": "…" }
```

`mpd_memory_write` / `mpd_memory_read` are the VCS-backed store (`memory.vcs` in §9);
`mpd_memory_save` / `mpd_memory_recall` are the simple key/value layer. `mpd_memory_status` prints the
counters, and a pending reflection is closed with `mpd_memory_reflect_complete`.

### 13.8 Extensions

```text
mpd_ext_list {}
mpd_ext_show { "id": "mpd-ext-example" }
mpd_flow_list {}
mpd_flow_show { "id": "<flow id>" }
```

```bash
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example    # exit 1 + one line per problem
bun scripts/mpd-ext.mjs list
bun scripts/mpd-ext.mjs scaffold my-ext --dir /tmp --with-mcp
```

### 13.9 The team loop (Lead and member)

```text
# Lead (the session agent)
team_task_list {}                                                # the active board, with revisions
team_task_get { "task_id": "task-5" }                            # one task, frozen at its revision
team_task_update { "task_id": "task-5", "expected_revision": 4, "action": "reassign", "owner": "junior-1" }
send_message { "target": "junior-1", "message": "task-5 needs the design-doc link target." }
list_agents {}                                                   # targets + availability
wait_agent { "timeout_ms": 60000 }                               # next roster/message/task edge
interrupt_agent { "target": "junior-1" }                         # stop the current turn, keep the inbox

# member
team_task_update { "task_id": "task-5", "expected_revision": 4, "action": "claim" }
team_task_update { "task_id": "task-5", "expected_revision": 5, "action": "edit", "description": "…progress + evidence…" }
team_task_update { "task_id": "task-5", "expected_revision": 6, "action": "complete" }
send_message { "target": "lead", "message": "task-5 done: `bun run verify:docs` passes." }
```

Every mutation carries the `expected_revision` the caller read; a stale one is refused with a typed
error, so a reassigned task cannot silently accept a late result. `write_scopes` warn about overlap
and never authorize a write, so report what you changed in the task description (or a message) rather
than relying on the scope list. A result is not accepted because a teammate says so: the Lead waits
for the team (`wait_agent`, then re-read) and verifies the diff before answering.

## 14. Where these capabilities come from

The attribution facts a user needs, so it is clear which parts are this project's work and which are
other people's. The authoritative record, with the full licence texts, is
[`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md).

| What you use | Where it comes from | Licence / version | Recorded in |
|---|---|---|---|
| Team mode — `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`, the `team_task_*` board and the Web panel | the **official** `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team` / `-client-ui-agent-team` packages, mounted by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows | MIT (harness package set); declared in `package.json` `dependencies` | `packages/mpd-bundle/cordis.patch.yml`; `README.md` (*What the install mounts*) |
| The retired vendored `agent-teams` body (kept, not mounted) | **dsh-agent-teams** by 程序员阿江 (Relakkes) — adopted outright as first-class main code | MIT; adopted package version `0.1.16-rc.3-mpd` (a `0.1.14` body with the audited `0.1.16-rc.3` deltas backported); NO row mounts it since 0.1.7-rc.2 | `LICENSE-NOTICES.md`; licence text at `packages/mpd-agent-teams-plugin/LICENSE` |
| The 11-specialist roster, the model-chain vocabulary, the teammate / workmate BASE templates | **oh-my-openagent** by code-yeongyu, pinned at commit `8c57e46` (v5.0.0-beta.20) | SUL-1.0 — the licence this repository inherits | `LICENSE-NOTICES.md` §1; `VENDOR_LOCK.json` |
| The served skill corpus (18 skills, 326 fingerprinted files) | vendored from upstream oh-my-openagent | SUL-1.0 | `VENDOR_LOCK.json` `assets.skills` |
| `mcp__ast_grep__*` | **ast-grep** — the optional dependency `@ast-grep/cli` | MIT; `0.45.2`; resolved at runtime, not redistributed | `package.json` `optionalDependencies`; `MPD_AST_GREP_SG_PATH` / `MPD_AST_GREP_BIN_DIR` |
| `mcp__codegraph__*` and the `mpd-codegraph` row | **codegraph** by Yeongyu Kim — the optional dependency `@colbymchenry/codegraph` | MIT; `1.5.0`; the prebuilt server is vendored and sha256-pinned | `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`; `VENDOR_LOCK.json` |
| `mpd_comment_check` | **comment-checker** by code-yeongyu (`@code-yeongyu/comment-checker`) | MIT; `0.8.0`; **not** redistributed — installed on demand into `.toolchain` (`--with-comment-checker`) | `LICENSE-NOTICES.md`; `MPD_DSH_COMMENT_CHECKER_BIN` |
| The plugin system, the tool / skill / preset / agent seams, the model providers, the Web shell | DeepSeek Harness — the **`@deepseek-ai/*`** packages | MIT; referenced as dependencies only | `LICENSE-NOTICES.md` |
| The Agent Teams Web panel | the official `@deepseek-ai/dsh-experimental-client-ui-agent-team` client plugin | MIT (harness package set) | §8 above; patch row `mpd-ui-agent-team` |
| The Workmates sidebar tab | hosted by the community bundle **`dsh-better-sidebar`**, a declared runtime dependency of this bundle (installed and mounted with it) | — | §8 above; `package.json` `dependencies`; patch row `mpd-better-sidebar` |
| The DSH plumbing (adapter, runtime plugins, `mpd` preset, combined web client), the TUI edition, the QA suite, the documentation, the extension interface | written here | SUL-1.0 | `README.md` (Acknowledgements); `LICENSE.md` |

Two consequences worth carrying away: a component keeps its **own** licence even inside this bundle
(the retained `agent-teams` main code is MIT while the repository is SUL-1.0), and nothing here
configures your provider credentials — a `MISSING_CREDENTIAL` error belongs to your DSH credential
store, not to these docs.
