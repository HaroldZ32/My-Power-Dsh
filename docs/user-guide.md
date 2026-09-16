# User Guide

**English** | [中文](user-guide.zh-CN.md)

Everything you need to install the my-power-dsh bundle and use it day to day, in workflow order.
For the short version, see the [README](../README.md); for how it works inside, see
[architecture.md](architecture.md).

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
`dsh --profile dsh-tui --dump-config` shows our rows in a layer of their own
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
dists + the adopted agent-teams main code + the skill corpus and presets + the combined web
client + the packed-form patch) that does not depend on a checkout. Use it when publishing,
shipping a tarball, or testing relocation; a local install never needs it.

### Uninstall (one command, no residue)

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

The bundle installs as ONE unit and uninstalls as ONE unit, skills included: the plugin rows come
from the bundle patch, the `mpd` preset is served from `<bundle>/presets` (the patch roots the
preset roster there) and the skill corpus from `<bundle>/skills` (the `mpd-bootstrap` row
registers a `ctx.skills` provider). Nothing is copied into `$DSH_HOME`, so removal takes the
rows, the preset and the skills with it — the stock preset roster returns and `$DSH_HOME/skills`
/ `$DSH_HOME/.agent-presets` stay as they were. What deliberately survives is YOUR data: the
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
| Explore a codebase | `mcp__ast_grep__*` (structural search/rewrite), `mcp__lsp__*` (definitions, references, diagnostics, rename), `mcp__codegraph__*` (project graph), `mcp__git_bash__*` (shell) | MCP tool servers; their tools appear as `mcp__<server>__<tool>` |
| Edit safely | the write guard and output truncation (no configuration needed), `mpd_hashline_read/edit/format/restore`, `mpd_comment_check` | hash-anchored edits reject a stale anchor instead of writing to the wrong line |
| Drive long work | `mpd_ulw` (light) / `mpd_ultrawork` (full discipline: plan gate, execution rounds, verification gate), `mpd_boulder_start/status/complete/task_timer/plan_progress/plans` | `mpd_boulder_*` tracks progress of a plan markdown file across sessions |
| Keep memory | `mpd_memory_write/read/reflect/reflect_complete/status`, `mpd_memory_save/recall` | the VCS-backed store can be git or svn; `mpd_memory_save/recall` is the simple key/value layer |
| Consult a specialist | `mpd_roles_list`, `mpd_role_spawn`, `mpd_role_persona` | one-shot subagents; read-only roles are denied write tools |
| Keep an evolving agent | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` | see §5 |
| Run a team | `agent_teams_*` + the AgentTeams tab | see §6 |
| Configure the bundle | `.mpd/mpd.jsonc`, `mpd_config_get`, `mpd_config_reload` | see §9 |
| Extend the bundle | `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` | see §10 |
| Resolve a model route | `mpd_modelchain_resolve` | resolves the provider/model a specialist would use |
| Inspect retired teams | `mpd_team_compact_run`, `mpd_team_compact_status` | compaction audit for finished teams |

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
mpd_workmate_init   { base: <roster name>, name?: <independent name>, note? }
  → creates ~/.mpd/workmate/<name>/{meta.json, persona.md, memory.md, note.md}
```

| Tool | Use |
|---|---|
| `mpd_workmate_list` | list instances (name, base, uses, updatedAt, note) |
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

**Both mutations are refused while the workmate is in use** — by a team member (a non-archived
team record under `.mpd/team/` names it) or by an in-flight `mpd_workmate_spawn`. The refusal is
`409 in-use` and names the blocking team ids and members, so it is actionable: finish or archive
those teams, then repeat the mutation. The same gate covers the rename *target*, so renaming a
workmate **to** a roster name in use by a team is refused the same way.

## 6. Team mode

```text
agent_teams_create { name: <team>, description: <goal>, profile: "mpd", approval: "required" }
  → stages the normal-named roster as teammates + an empty task DAG
# while staged: edit members/tasks in the Web plan panel, or with
agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan
agent_teams_approve  # user-approved → spawns the members, scheduler starts
# leader (you/captain):
agent_teams_status / agent_teams_send_message / agent_teams_reassign_task
```

- `approval: "required"` is the two-phase flow (recommended): nothing runs until you review the
  plan in the GUI.
- The `mpd` profile is **captain-planned** (`taskPlanning: captain`): the roster is fixed, and the
  captain designs the task DAG during the staged plan.
- Read-only members (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst)
  never edit files; workers (Senior Engineer, Junior Engineer, Deep Worker, Lead, Reviewer)
  implement and verify.
- **Workmate-backed members**: if you initialize a workmate (e.g. `alice`) and add a member named
  `alice`, the member's system prompt automatically carries `alice`'s persona + memory + note, and
  it reflects back into the workmate after each task. The captain guidance: check
  `mpd_workmate_match` before delegating; a weak match means initializing a new workmate instead
  of forcing it.
- **Extension roles are not team members**: an extension can contribute a role usable by
  `mpd_role_spawn` / `mpd_role_persona`, but the team member list is fixed patch configuration, so
  extension roles never become teammates (see §10).

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
| AgentTeams sidebar tab | the `tuiScenes` full-screen board plus the keyed `tuiStatus` line |
| Workmates sidebar tab | the `/mpd` command tree (`tuiCommandTrees`) plus `tuiDialogs` |
| Bundle floater | the `tuiStatus` line |
| Settings → MPD section | the `/settings` section (`tuiSettingsSections`) |
| — | `tuiShortcuts` keyboard shortcuts |

These are **equivalents, not parity**: each surface is rebuilt on the host's own TUI seams, and two
seams are deliberately not claimed — the host offers no prompt slot (`tuiPrompt` is host-unavailable)
and it projects no transcript row for the bundle's renderer event, so neither a prompt slot nor a
transcript line is claimed. The full list is §10 NOT-CLAIMED of [`tui.md`](tui.md).

### 7.2 The `/settings` screen and the `mpd.jsonc` bridge

`/settings` edits the six real `mpd.jsonc` knobs — `hashline.maxDiffChars`,
`commentChecker.autoCheck`, `ulw.maxRounds`, `memory.vcs`, `team.stateDir`, `boulder.dir` — under the
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

- **AgentTeams sidebar tab** (the only team surface): the whole team GUI is one tab in
  **DSH-better-sidebar** (the community sidebar bundle; tab id `mpd-agent-teams`). It lists the
  teams of *this conversation* — live teams first (members and their live activity, task rows with
  status, the dependency map, the captain context, the stop-team control) and then archived ones —
  and it hosts the staged-plan approval editor, so a plan is reviewed and edited where it was
  created. The tab badge shows how many teams are live in this conversation, and `single: true`
  re-scopes the tab instead of opening a second copy. When a team appears the tab opens once by
  itself; turn that off with the **Auto-open when a team appears** switch in the sidebar settings
  page (plugin setting `autoOpenOnTeamActivity`, default ON).
- **Workmates sidebar tab**: the workmate library is contributed as a second tab to the same
  sidebar, so it lives where that sidebar's own pages do — tab strip, `+` menu, and the sidebar's
  own enable/disable switch. The page lists `~/.mpd/workmate/` instances (base, uses, updated,
  note), filters them, opens one for its persona/memory/note, and initializes a new one from a
  roster-backed **base picker** (no id typing) plus an optional name and note. It also **renames**
  and **deletes** the selected instance — the delete flow is explicit (a confirmation step, then
  archive, then a further step that requires typing the exact name for a permanent purge), and
  both operations are localized zh/en. It reads and posts to the host routes
  `GET /plugins/mpd-workmate/{list,roster,get}` and
  `POST /plugins/mpd-workmate/{init,rename,delete}`. The sidebar **tab-strip label** itself stays
  the English `Workmates` (a documented deferral: the strip label is resolved where no localized
  translator is in scope, like the AgentTeams tab); the page body follows your language.
- **Sidebar-only, for both pages**: neither page has a fallback. Without DSH-better-sidebar each
  logs exactly one warning and registers nothing. Team work still runs through the `agent_teams_*`
  tools and the `.mpd/team` state, and the workmate library is still fully usable through the
  `mpd_workmate_*` tools.

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
| `team.stateDir` | agent-teams | where team state lives (defaults to `.mpd/team`) |

`mpd-codegraph` is deliberately absent from this table: it takes `autoInit`, `initTimeoutMs`,
`cooldownMs` and `binary` from its **bundle-patch row** options (read at apply time), and no plugin
reads a `codegraph.*` key through `mpd.jsonc`. Its row ships `autoInit: true` and
`initTimeoutMs: 60000` in `packages/mpd-bundle/cordis.patch.yml`.

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
  `mpd_role_persona` and as workmate base templates, but the agent-teams member list is static
  patch configuration.
- **`extensions.*` configuration is process-level**, read when the plugin starts — it is not
  scoped per session.
- **A fourth-party MCP server is a child process.** It never inherits credential-shaped variables
  from your host environment; declare what it needs in the manifest's `env`.

## 11. Troubleshooting quick map

- `mpd_role_spawn` reports an unknown role → roles answer to their NAMES (`Architect`,
  `Deep Worker`, `plan reviewer` — any case/space/hyphen spelling); run `mpd_roles_list`.
- `mpd_workmate_*` says "mpdRoles service unavailable" → the `mpd-roles` row is not mounted
  (reinstall the bundle).
- A workmate rename/delete is **refused because it is in use** → a non-archived team record under
  `.mpd/team/` names it, or an `mpd_workmate_spawn` is still running. The refusal lists the
  blocking teams; archive (or retire) those teams in the AgentTeams tab and let running spawns
  finish, then repeat.
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
- AgentTeams tab missing from the sidebar → rebuild the shipped client
  (`node scripts/build-mpd-client.mjs`, then reload) and confirm the profile has
  `dsh-better-sidebar` (without it the team page logs one warning and has no host).
- Client surface missing entirely in the GUI → the `mpd-web-compat` self-row must exist and the
  bundle must be reinstalled (`dsh plugin --profile <p> add <repo-or-package>`).
- `MISSING_CREDENTIAL` → the provider route needs a key in your DSH credentials; keys are never
  configured by this bundle.
- AGENT.md not injected → the session runs a non-`mpd` preset; switch presets.
- The sidebar shows `cannot resolve target "…/team-activity"` → an old client opened the AgentTeams
  tab with a content seed. Update the bundle (`git pull`, then
  `dsh plugin --profile <p> add <repo>`) and reload the page — the auto-open is seedless now.
- **No `mpd` session can be created and the error says `agent-preset/invalid … $.prefix missing
  required value`** → the installed harness changed the `dsh-persona` contract (it takes `prefix`,
  not the retired `text`) and refuses to mount the whole preset. Update the bundle (`git pull`,
  then `dsh plugin --profile <p> add <repo>`) — this is a harness-version compatibility fix, not a
  configuration problem on your side.
