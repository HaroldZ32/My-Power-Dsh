# mpd-roles-plugin
**中文** | [English](./README.md)

各专家以 **专家名册**（specialist roster）形式存在，而非独立的 presets。每个 role = 一个稳定的 `id`（也是 modelchain chain key）+ 一个普通显示 `name` + persona 文本（asset `personas/<id>.md`）+ DeepSeek model chain + read-only discipline。

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

- `mpdRoles` service（`ctx.get("mpdRoles")`）：`list()` / `get(key)` — 被 `mpd-modelchain-plugin` 消费（chain lookup）。
- `mpd_roles_list` — roster（ids → normal names）。
- `mpd_role_spawn` — one-shot consult：将一个 role 作为 subagent 生成（roster persona + route + 对 read-only roles 的 write-deny toolFilter）。
- `mpd_role_persona` — 为需要将 persona 作为文本使用的 spawn surface 获取 persona 文本（例如 `agent_teams_add_member`）。

Role keys 接受 canonical id（`oracle`、`sisyphus-junior`）、modelchain-style key（`sisyphusJunior`、`multimodalLooker`）以及 legacy 的 `mpd-<id>` preset alias。

## Team mode

多成员 team work 并非在此构建。它位于所采用的 `dsh-agent-teams` plugin 中：bundle patch 配置了一个普通命名的 `mpd` roster profile（`taskPlanning: captain`），其成员与上表一致。captain 调用 `agent_teams_create(profile="mpd")` 来 stage 这些 teammates，设计 task DAG，并复用 agent-teams Web plan panel + scheduler。

Read-only roles（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）在 `mpd_role_spawn` 处获得 write-tool deny filter；作为 team member，其 read-only discipline 通过 profile protocol / execution prompt 表达（它们只接受 requirements/review/analysis 类任务）。
