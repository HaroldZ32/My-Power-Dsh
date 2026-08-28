# mpd-roles-plugin

The OMO-origin agents exist as a **specialist roster**, not as standalone presets.
Each role = a stable `id` (also a modelchain chain key) + a normal display `name`
+ persona text (asset `personas/<id>.md`) + DeepSeek model chain + read-only
discipline.

| id | name | readonly |
| --- | --- | --- |
| oracle | Architect | yes |
| librarian | Researcher | yes |
| prometheus | Planner | yes |
| hephaestus | Config Engineer | no |
| sisyphus | Senior Engineer | no |
| atlas | Lead | no |
| explore | Explorer | yes |
| metis | Reviewer | no |
| momus | UX Critic | yes |
| multimodal-looker | Vision Analyst | yes |
| sisyphus-junior | Junior Engineer | no |

## Surface

- `mpdRoles` service (`ctx.get("mpdRoles")`): `list()` / `get(key)` — consumed by
  `mpd-modelchain-plugin` (chain lookup).
- `mpd_roles_list` — the roster (ids → normal names).
- `mpd_role_spawn` — one-shot consult: spawn one role as a subagent (roster
  persona + route + write-deny toolFilter for read-only roles).
- `mpd_role_persona` — fetch the persona text for spawn surfaces that take
  persona as text (e.g. `agent_teams_add_member`).

Role keys accept the canonical id (`oracle`, `sisyphus-junior`), the
modelchain-style key (`sisyphusJunior`, `multimodalLooker`) and the legacy
`mpd-<id>` preset alias.

## Team mode

Multi-member team work is NOT built here. It lives in the adopted
`dsh-agent-teams` plugin: the bundle patch configures a normal-named `mpd`
roster profile (`taskPlanning: captain`) whose members mirror the table above.
The captain calls `agent_teams_create(profile="mpd")` to stage those teammates,
designs the task DAG, and reuses the agent-teams Web plan panel + scheduler.

Read-only roles (Architect, Researcher, Planner, Explorer, UX Critic, Vision
Analyst) get a write-tool deny filter at `mpd_role_spawn`; as team members the
read-only discipline is expressed in the profile protocol / execution prompt
(they take requirements/review/analysis tasks only).