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
- `mpd_roles_list` — roster，以 name 开头打印：`Architect (oracle)`。
- `mpd_role_spawn` — one-shot consult：将一个 role 作为 subagent 生成（roster persona + route + 对 read-only roles 的 write-deny toolFilter）。被生成的 subagent **以该 role 的普通名称为 label**（`Architect`、`Deep Worker`），而不再是 `role-<id>-<random>`。
- `mpd_role_persona` — 为需要将 persona 作为文本使用的 spawn surface 获取 persona 文本（例如 `agent_teams_add_member`）。

**两个 surface 共用同一套命名（名称统一）。** 普通显示名称才是 role 对外的身份：它既是 team mode 下 agent-teams 为成员取的名称，也是单次 `mpd_role_spawn` 产生的 label。因此每个 role key 按以下顺序接受：

- 普通名称 —— 任意拼写：`Architect`、`architect`、`Deep Worker`、`deep-worker`、`deepworker`、`Plan Reviewer`（大小写、空格、连字符、下划线均不敏感）；
- canonical id（`oracle`、`sisyphus-junior`）；
- modelchain-style chain key（`sisyphusJunior`、`multimodalLooker`）；
- legacy 的 `mpd-<id>` preset alias。

`ctx.get("mpdRoles").get(key)` 使用同一套解析，因此 workmate library（`mpd_workmate_init base=...`）、`mpd_modelchain_resolve` 与 roster 工具都能互换地接受 team 名称与 id。

## Team mode

多成员 team work 并非在此构建。它位于所采用的 `dsh-agent-teams` plugin 中：bundle patch 配置了一个普通命名的 `mpd` roster profile（`taskPlanning: captain`），其成员与上表一致。captain 调用 `agent_teams_create(profile="mpd")` 来 stage 这些 teammates，设计 task DAG，并复用 agent-teams Web plan panel + scheduler。

Read-only roles（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）在 `mpd_role_spawn` 处获得 write-tool deny filter；作为 team member，其 read-only discipline 通过 profile protocol / execution prompt 表达（它们只接受 requirements/review/analysis 类任务）。
