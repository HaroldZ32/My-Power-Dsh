# mpd-roles-plugin
**English** | [中文](./README.zh-CN.md)

The specialists exist as a **specialist roster**, not as standalone presets.
Each role = a stable `id` (also a modelchain chain key) + a normal display `name`
+ persona text (asset `personas/<id>.md`) + DeepSeek model chain + read-only
discipline.

| id | name | readonly |
| --- | --- | --- |
| oracle | Architect | yes |
| librarian | Researcher | yes |
| prometheus | Planner | yes |
| hephaestus | Deep Worker | no |
| sisyphus | Senior Engineer | no |
| atlas | Lead | no |
| explore | Explorer | yes |
| metis | Reviewer | no |
| momus | Plan Reviewer | yes |
| multimodal-looker | Vision Analyst | yes |
| sisyphus-junior | Junior Engineer | no |

## Surface

- `mpdRoles` service (`ctx.get("mpdRoles")`): `list()` / `get(key)` — consumed by
  `mpd-modelchain-plugin` (chain lookup).
- `mpd_roles_list` — the roster, printed name-first as `Architect (oracle)`.
- `mpd_role_spawn` — one-shot consult: spawn one role as a subagent (roster
  persona + route + write-deny toolFilter for read-only roles). The spawned
  subagent is **labelled with the role's normal name** (`Architect`,
  `Deep Worker`), never with `role-<id>-<random>`.
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (e.g. `agent_teams_add_member`).

**One vocabulary for both surfaces (name unification).** The normal display name
is the role's user-facing identity: it is the member name agent-teams stages in
team mode, and it is the label a solo `mpd_role_spawn` produces. Every role key
therefore accepts, in this order:

- the normal name — any spelling of it: `Architect`, `architect`, `Deep Worker`,
  `deep-worker`, `deepworker`, `Plan Reviewer` (case-, space-, hyphen- and
  underscore-insensitive);
- the canonical id (`oracle`, `sisyphus-junior`);
- the modelchain-style chain key (`sisyphusJunior`, `multimodalLooker`);
- the legacy `mpd-<id>` preset alias.

The same resolution is what `ctx.get("mpdRoles").get(key)` uses, so the workmate
library (`mpd_workmate_init base=...`), `mpd_modelchain_resolve` and the roster
tools all take the team word and the id interchangeably.

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