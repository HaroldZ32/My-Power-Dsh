# mpd-roles-plugin
**中文** | [English](./README.md)

各专家以 **专家名册**（specialist roster）形式存在，而非独立的 presets。每个 role 以其**名称**称呼、以其**职责**说明；另外还带有 persona 文本（`personas/<内部键>.md`）、DeepSeek model chain 以及 read-only discipline。

| role（它做什么） | readonly |
| --- | --- |
| Architect — 架构评审、深度调试、自审 | yes |
| Researcher — 基于证据的代码/开源检索 | yes |
| Planner — 只产出 `.mpd/plans` 计划，绝不实现 | yes |
| Deep Worker — 端到端执行目标并自验 | no |
| Senior Engineer — 主要实现与验证 | no |
| Lead — 编排、委派、整合 | no |
| Explorer — 只读的代码库检索与定位 | yes |
| Reviewer — 正确性/风险发现，不修 | no |
| Plan Reviewer — 计划可执行性与引用核查 | yes |
| Vision Analyst — 图像/截图/PDF 分析 | yes |
| Junior Engineer — 快速、边界清晰的小改动 | no |

## Surface

- `mpdRoles` service（`ctx.get("mpdRoles")`）：`list()` / `get(key)` — 被 `mpd-modelchain-plugin` 消费（chain lookup）。
- `mpd_roles_list` — roster，每个 role 一行：名称、route、做什么。
- `mpd_role_spawn` — one-shot consult：将一个 role 作为 subagent 生成（roster persona + route + 对 read-only roles 的 write-deny toolFilter）。被生成的 subagent **以该 role 的名称为 label**（`Architect`、`Deep Worker`），而不再是 `role-<id>-<random>`。
- `mpd_role_persona` — 为需要将 persona 作为文本使用的 spawn surface 获取 persona 文本（例如 `agent_teams_add_member`）。

**两个 surface 共用同一套命名（名称统一）。** 名称就是 role 的身份：它既是 team mode 下 agent-teams 为成员取的名称，也是单次 `mpd_role_spawn` 产生的 label。称呼时任意拼写均可：`Architect`、`architect`、`Deep Worker`、`deep-worker`、`deepworker`、`Plan Reviewer`（大小写、空格、连字符、下划线均不敏感）。**任何 surface 都不再展示沿袭自上游的别称** —— role 只用它做什么来描述。

*兼容性（内部实现，任何 surface 都不展示）：* 名册仍接受其稳定的内部键 —— `mpd-modelchain-plugin` 与 `personas/<键>.md` 使用的 chain key（`oracle`、`sisyphus-junior` …）、camelCase 写法（`sisyphusJunior`）以及 legacy 的 `mpd-<键>` 形式 —— 以保证既有 chain、workmate 记录（`meta.baseId`）与调用方继续可用；它们永远不会被返回、列出或要求。

`ctx.get("mpdRoles").get(key)` 使用同一套解析，因此 workmate library（`mpd_workmate_init base=...`）、`mpd_modelchain_resolve` 与 roster 工具都以同一方式称呼 role。

## Team mode

多成员 team work 并非在此构建。它位于所采用的 `dsh-agent-teams` plugin 中：bundle patch 配置了一个普通命名的 `mpd` roster profile（`taskPlanning: captain`），其成员与上表一致。captain 调用 `agent_teams_create(profile="mpd")` 来 stage 这些 teammates，设计 task DAG，并复用 agent-teams Web plan panel + scheduler。

Read-only roles（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）在 `mpd_role_spawn` 处获得 write-tool deny filter；作为 team member，其 read-only discipline 通过 profile protocol / execution prompt 表达（它们只接受 requirements/review/analysis 类任务）。
