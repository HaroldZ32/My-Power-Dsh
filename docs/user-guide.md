# User Guide

**English** | [中文](user-guide.zh-CN.md)

Everything a person using the my-power-dsh bundle needs, in workflow order.

## 1. Install

### Packed bundle (primary, Plan D)

```bash
# from this repo (installs the relocatable bundle into the profile)
dsh plugin --profile <mpd|web> add dist/mpd-package
# or from any published location
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

Then start DSH and select the **MPD (Main Working Agent)** preset.

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

Size caps keep injected context bounded: persona ≤ 8 KiB, memory ≤ 8 KiB, note ≤ 1.5 KiB.

Workmates are your agents' *evolving memory*: after each task the workmate itself
summarizes (via the spawn instruction or the team-member persona), so future sessions
start from where it left off.

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

- **Team activity floater** (agent-teams): live team tree (members, tasks, activity)
  while a team runs; opened from the in-conversation team card.
- **🤖 Workmates button** (sidebar foot) → **Workmate library floater**: lists
  `~/.mpd/workmate/` instances (base, uses, note) and initializes new ones from the
  form (base + optional name) via the host routes `/plugins/mpd-workmate/{list,init}`.

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
- Team/workmate panel missing in the GUI → the `mpd-web-compat` self-row must exist and
  the bundle must be reinstalled (`dsh plugin --profile <p> add dist/mpd-package`).
- `MISSING_CREDENTIAL` → the provider route needs a key in your DSH credentials; keys
  are never configured by this bundle.
- AGENT.md not injected → the session runs a non-`mpd` preset; switch presets.
