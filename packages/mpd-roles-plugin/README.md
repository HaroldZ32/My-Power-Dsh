# mpd-roles-plugin
**English** | [中文](./README.zh-CN.md)

The specialists exist as a **specialist roster**, not as standalone presets.
Each role is addressed by its **name** and described by what it does; it also carries
a persona text (`personas/<internal-key>.md`), a DeepSeek model chain and its
read-only discipline.

| role (what it does) | readonly |
| --- | --- |
| Architect — architecture review, deep debugging, self-review | yes |
| Researcher — evidence-based code/open-source search | yes |
| Planner — produces `.mpd/plans` plans, never implements | yes |
| Deep Worker — executes goals end-to-end with tools | no |
| Senior Engineer — primary implementation and verification | no |
| Lead — orchestration, delegation, integration | no |
| Explorer — read-only codebase search and location | yes |
| Reviewer — correctness/risk findings, no fixes | no |
| Plan Reviewer — plan executability and reference review | yes |
| Vision Analyst — image/screenshot/PDF analysis | yes |
| Junior Engineer — fast, well-scoped execution | no |

## Surface

- `mpdRoles` service (`ctx.get("mpdRoles")`): `list()` / `get(key)` — consumed by
  `mpd-modelchain-plugin` (chain lookup).
- `mpd_roles_list` — the roster, one line per role: name, route, and what it does.
- `mpd_role_spawn` — one-shot consult: spawn one role as a subagent (roster
  persona + route + write-deny toolFilter for read-only roles). The spawned
  subagent is **labelled with the role's name** (`Architect`,
  `Deep Worker`), never with `role-<id>-<random>`.
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (e.g. `agent_teams_add_member`).

**One vocabulary for both surfaces (name unification).** The role's name is its
identity: it is the member name agent-teams stages in team mode, and it is the label a
solo `mpd_role_spawn` produces. Address a role by that name in any spelling —
`Architect`, `architect`, `Deep Worker`, `deep-worker`, `deepworker`,
`Plan Reviewer` (case-, space-, hyphen- and underscore-insensitive). No surface
advertises an upstream alias: a role is described by what it does.

*Compatibility (internal, undocumented on any surface):* the roster also still accepts
its stable internal keys — the chain keys used by `mpd-modelchain-plugin` and by
`personas/<key>.md` (`oracle`, `sisyphus-junior`, …), the camelCase spellings
(`sisyphusJunior`) and the legacy `mpd-<key>` form — so existing chains, workmate
records (`meta.baseId`) and callers keep working. They are never returned, listed or
required.

The same resolution is what `ctx.get("mpdRoles").get(key)` uses, so the workmate
library (`mpd_workmate_init base=...`), `mpd_modelchain_resolve` and the roster tools
all address a role the same way.

## Team mode

Multi-member team work is NOT built here. It lives in the adopted
`dsh-agent-teams` plugin: the bundle patch configures a normal-named `mpd`
roster profile (`taskPlanning: captain`) whose members mirror the table above.
The captain calls `agent_teams_create(profile="mpd")` to stage those teammates,
designs the task DAG, and reuses the agent-teams Web plan panel + scheduler.

Read-only roles (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision
Analyst) get a write-tool deny filter at `mpd_role_spawn`; as team members the
read-only discipline is expressed in the profile protocol / execution prompt
(they take requirements/review/analysis tasks only).