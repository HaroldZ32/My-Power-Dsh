# User Guide

**English** | [中文](user-guide.zh-CN.md)

Everything a person using the my-power-dsh bundle needs, in workflow order.

## 1. Install

### One command, from the checkout

```bash
cd <repo> && dsh plugin --profile <mpd|web> add .
```

The repo root IS the bundle package (`@mpd-dsh/mpd`): `dsh.bundle.patch`, `dsh.client` and
the `exports` map live in its manifest, so this one command installs every plugin row, the
`mpd` preset and the whole skill corpus. Nothing else to run — no pack step, no copy step.
`dsh plugin remove @mpd-dsh/mpd` uninstalls the same unit.

### Packed package (release / publishing)

```bash
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/ (relocatable)
dsh plugin --profile <mpd|web> add dist/mpd-package
# or from any published location
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

`pack-mpd` exists for DISTRIBUTION: it assembles a self-contained `@mpd-dsh/mpd` (built
plugin dists + adopted agent-teams main code + skill corpus and presets + combined web
client + packed-form patch) that does not depend on a checkout. Use it when publishing,
shipping a tarball, or testing relocation; a local install never needs it.

Then start DSH and select the **MPD (Main Working Agent)** preset.

### Uninstall (one command, no residue)

```bash
dsh plugin --profile <mpd|web> remove @mpd-dsh/mpd
```

The bundle installs as ONE unit and uninstalls as ONE unit, skills included: the
plugin rows come from the bundle patch, the `mpd` preset is served from
`<bundle>/presets` (the patch roots the preset roster there) and the skill corpus
from `<bundle>/skills` (the `mpd-bootstrap` row registers a `ctx.skills`
provider). Nothing is copied into `$DSH_HOME`, so removal takes the rows, the
preset and the skills with it — the stock preset roster (`default: standard`)
returns and `$DSH_HOME/skills` / `$DSH_HOME/.agent-presets` stay as they were.
What deliberately survives is YOUR data: the workmate library (`~/.mpd/workmate`)
and per-workspace `.mpd/` state.

Upgrading from a bundle `<= 0.2.6` (which copied presets + skills into
`$DSH_HOME`): the first boot of `>= 0.3.0` removes those stamped copies itself.
Unstamped copies left by the legacy `scripts/install-profile.mjs` flow are not
touched — delete them by hand if you used that flow.

### Legacy installer (dev/QA only)

```bash
node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]
node scripts/install-profile.mjs            # --dry-run prints the plan, writes nothing
```

Never run the legacy installer against the real home from a QA context
(`--dsh-home` exists for isolated QA).

## 2. The `mpd` preset

The only shipped preset is **MPD**, the main working agent. Its conventions:

- **Every project instruction file**: at session start the agent MUST attempt to read
  `AGENT.md` (falling back to `AGENTS.md`, then `CLAUDE.md`) — the preset configures
  `dsh-agent-instructions` with those candidate names.
- **Native tool presentation**: row tools (bash/read/edit/…) are exposed directly.
- The preset persona explains the specialists, team mode and workmate library (see
  below), so the agent routes correctly without extra setup.

## 3. Specialists (the roster)

The 11 OMO-origin agents are specialist subagents, **not presets**:

| Normal name | stable id | model (chain[0]) | discipline |
|---|---|---|---|
| Architect | `oracle` | deepseek-v4-pro | read-only |
| Researcher | `librarian` | deepseek-v4-flash | read-only |
| Planner | `prometheus` | deepseek-v4-pro | read-only |
| Deep Worker | `hephaestus` | deepseek-v4-flash | worker |
| Senior Engineer | `sisyphus` | deepseek-v4-pro | worker |
| Lead | `atlas` | deepseek-v4-pro | worker |
| Explorer | `explore` | deepseek-v4-flash | read-only |
| Reviewer | `metis` | deepseek-v4-pro | worker |
| Plan Reviewer | `momus` | deepseek-v4-flash | read-only |
| Vision Analyst | `multimodal-looker` | deepseek-v4-flash-vision-exp | read-only |
| Junior Engineer | `sisyphus-junior` | deepseek-v4-flash | worker |

Use them one-shot:

- `mpd_roles_list` — list the roster.
- `mpd_role_spawn { role, task, context? }` — spawn one specialist as a subagent with
  its persona + model route; read-only roles are mechanically denied write tools.
- `mpd_role_persona { role }` — fetch the full persona text (e.g. to pass to a spawn
  surface that takes persona as text).

## 4. Workmate library (durable, evolving specialists)

The roster is **base templates only**. When you will reuse a specialist across
sessions, instantiate it as a *workmate* — a durable copy under `~/.mpd/workmate/`
(your HOME, cross-project) with an independent name.

```text
mpd_workmate_init   { base: <roster id or normal name>, name?: <independent name>, note? }
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

Workmates are your agents' *evolving memory*: after each task the workmate itself
summarizes (via the spawn instruction or the team-member persona), so future sessions
start from where it left off.

### Renaming and deleting a workmate

**Names are ASCII-only** (`[a-z0-9_-]`, lower-case). `Alice`, a CJK name, `a/b` or `..` is
refused up front with `400 invalid-name` — nothing on disk is touched. Unicode names are a
listed follow-up, not a bug.

**Rename** (`mpd_workmate_rename { name, new_name }`) MOVES the workmate instead of
rebuilding it: the directory key, `meta.json`, the library index, the note's self-reference
and its previous-name history (`renamedFrom`) all move together, while persona, memory,
use count and creation date are preserved byte-for-byte. Renaming onto an existing name is
refused (`409 collision`), and so is renaming to the current name.

**Delete** (`mpd_workmate_delete { name }`) is **archive-first**: the instance moves to
`~/.mpd/workmate/.archive/<name>-<stamp>/`, disappears from `list` and `match`
immediately, and can be brought back by hand:

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

Only the explicit purge destroys anything: `mpd_workmate_delete { name, purge: true,
confirm: "<name>" }` — the exact name is required, and without it the call is refused and
nothing is removed. There is no in-product restore button: archive-first is deliberately
one-way in the UI, and recovery is the `mv` above.

**Both mutations are refused while the workmate is in use** — by a team member (a
non-archived team record under `.mpd/team/` names it) or by an in-flight
`mpd_workmate_spawn`. The refusal is `409 in-use` and names the blocking team ids and
members, so it is actionable: finish/archive those teams, then repeat the mutation. The
same gate covers the rename *target*, so renaming a workmate **to** a roster name in use
by a team (e.g. `architect`) is refused the same way.

## 5. Team mode (adopted dsh-agent-teams)

```text
agent_teams_create { name: <team>, description: <goal>, profile: "mpd", approval: "required" }
  → stages the normal-named roster as teammates + an empty task DAG
# while staged: edit members/tasks in the Web plan panel, or with
agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan
agent_teams_approve  # user-approved → spawns the members, scheduler starts
# leader (you/captain):
agent_teams_status / agent_teams_send_message / agent_teams_reassign_task
```

- `approval: "required"` is the two-phase flow (recommended): nothing runs until you
  review the plan in the GUI.
- The `mpd` profile is **captain-planned** (`taskPlanning: captain`): the roster is
  fixed, the captain designs the DAG during the staged plan.
- Read-only members (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision
  Analyst) never edit files; workers (Senior Engineer, Junior Engineer, Deep Worker,
  Lead, Reviewer) implement and verify.
- **Workmate-backed members**: if you initialize a workmate (e.g. `alice`) and add a
  member named `alice`, the member's system prompt automatically carries `alice`'s
  persona + memory + note and it reflects back into the workmate after each task. The
  captain guidance: check `mpd_workmate_match` before delegating; weak match → init a
  new workmate instead of forcing it.

## 6. Web GUI

- **AgentTeams sidebar tab** (the only team surface): the whole team GUI is one tab in
  **DSH-better-sidebar** (`dsh-better-sidebar`, the community sidebar bundle; tab id
  `mpd-agent-teams`). It lists the teams of *this conversation* — live teams first (members
  and their live activity, task rows with status, the dependency map, the captain context,
  the stop-team control) and then archived ones — and it hosts the staged-plan approval
  editor, so a plan is reviewed and edited where it was created. The tab badge shows how
  many teams are live in this conversation, and the tab `single: true` re-scopes instead of
  opening a second copy. When a team appears the tab opens once by itself; turn that off
  with the **Auto-open when a team appears** switch in the sidebar settings page (plugin
  setting `autoOpenOnTeamActivity`, default ON). The tab renders the removed floater's own
  interior — the panel head with its title, live-activity dot and collapse control, the
  scrolling team body, the adopted empty hint and the archived labels — so it looks exactly
  like the panel it replaced; the collapse control closes the sidebar panel itself. The
  former in-conversation team card and top-right activity floater **no longer exist**, and
  there is no fallback: a profile without DSH-better-sidebar logs one warning and has no team
  GUI at all — team work still runs through the `agent_teams_*` tools and the `.mpd/team`
  state.
- **Workmates sidebar tab**: the workmate library is contributed as a second tab
  to **DSH-better-sidebar** (`dsh-better-sidebar`, the community sidebar bundle), so it
  lives where that sidebar's own pages do — tab strip, `+` menu, and the sidebar's own
  enable/disable switch in its settings. The page lists `~/.mpd/workmate/` instances
  (base, uses, updated, note), filters them, opens one for its persona/memory/note, and
  initializes a new one from a roster-backed **base picker** (no id typing) plus optional
  name and note. It also **renames** and **deletes** the selected instance — the delete flow
  is explicit (a confirmation step, then archive, and a further step that requires typing the
  exact name for a permanent purge), and both operations are localized zh/en. It reads and
  posts to the host routes
  `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}`.
  The sidebar **tab-strip label** itself stays the English `Workmates` (a documented
  deferral — the strip label is resolved where no localized translator is in scope, like the
  AgentTeams tab); the page body follows your language.
- **Sidebar-only, for both pages**: neither page has a fallback. Without DSH-better-sidebar
  each logs exactly one warning and registers nothing, and the bundle no longer ships the
  workmate 🤖 overlay floater or its sidebar-foot button.

## 7. Configuration (`mpd.jsonc`)

`mpd-config` merges the project layer `.mpd/mpd.jsonc` over the user layer
`$DSH_HOME/mpd.jsonc` (per key, project wins). Query with `mpd_config_get` /
`mpd_config_reload`. Keys consulted by plugins:

| Key | Consumer | Meaning |
|---|---|---|
| `memory.vcs` | mpd-memory | `git` / `svn` / `both` |
| `memory.dir`, `memory.agentSlug`, `memory.reflectionEvery` | mpd-memory | memory root, agent slug, reflection cadence |
| `boulder.dir` | mpd-boulder | boulder ledger location |
| `hashline.*` | mpd-hashline | guard flag, diff cap, registry file |
| `commentChecker.*` | mpd-comment-checker | autoCheck, binary, timeouts |
| `ulw.*` | mpd-ulw | rounds, plan/state dirs, provider/model routes |
| `codegraph.*` | mpd-codegraph | autoInit, binary, timeouts |

## 8. Troubleshooting quick map

- `mpd_role_spawn` unknown role → ids are roster ids (`oracle`, `sisyphus-junior`, …);
  run `mpd_roles_list`.
- `mpd_workmate_*` says "mpdRoles service unavailable" → the `mpd-roles` row is not
  mounted (reinstall the bundle / add the row).
- A workmate rename/delete is **refused because it is in use** → a non-archived team
  record under `.mpd/team/` names it, or an `mpd_workmate_spawn` is still running. The
  refusal lists the blocking teams; archive (or retire) those teams in the AgentTeams tab
  and let running spawns finish, then repeat. Renaming *to* a roster name in use
  (`architect`, `lead`, …) is refused the same way.
- A workmate was deleted by accident → its default delete only ARCHIVED it: move
  `~/.mpd/workmate/.archive/<name>-<stamp>` back to `~/.mpd/workmate/<name>`. There is no
  in-product restore, and a `purge` (run with `confirm: <name>`) is unrecoverable.
- A workmate name is rejected (`400 invalid-name`) → names are ASCII-only,
  lower-case `[a-z0-9_-]`: uppercase, spaces, punctuation, `/` and CJK names are refused
  before anything is touched. Pick an ASCII name; Unicode names are a listed follow-up.
- AgentTeams tab missing from the sidebar → rebuild the shipped client
  (`node scripts/build-mpd-client.mjs`, then reload) and confirm the profile has
  `dsh-better-sidebar` (without it the team page logs one warning and has no host).
- Client surface missing entirely in the GUI → the `mpd-web-compat` self-row must exist and
  the bundle must be reinstalled (`dsh plugin --profile <p> add dist/mpd-package`).
- `MISSING_CREDENTIAL` → the provider route needs a key in your DSH credentials; keys
  are never configured by this bundle.
- AGENT.md not injected → the session runs a non-`mpd` preset; switch presets.
- The sidebar shows `cannot resolve target "…/team-activity"` → the AgentTeams tab's auto-open
  used to hand the sidebar a marker file path; from `dsh-better-sidebar` 0.19 a seeded open is
  routed to DSH's native right column, which resolves real files. Update the bundle
  (`git pull`, then `dsh plugin --profile <p> add <repo>`) and reload the page — the auto-open is
  seedless now, so the tab simply opens.
- **No `mpd` session can be created and the error says `agent-preset/invalid … $.prefix missing
  required value`** → the installed harness changed the `dsh-persona` contract (it takes `prefix`,
  not the retired `text`) and refuses to mount the whole preset. Update the bundle
  (`git pull`, then `dsh plugin --profile <p> add <repo>`) — this is a harness-version compatibility
  fix, not a configuration problem on your side.
