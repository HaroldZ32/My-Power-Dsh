# MPD —— 这个插件为 DeepSeek Harness 增添了什么

[English](./plugin-details.md) | **中文**

**my-power-dsh**（包名 `@mpd-dsh/mpd`）是一个 DeepSeek Harness 插件 bundle。它不替换 harness，而是
安装在它旁边，经由自己的 `cordis.patch.yml` 层挂载，贡献 **MPD（Main Working Agent，主工作智能体）**
preset、专家花名册、共享团队看板、长期演进的 workmates、记忆库、校验界面，以及原生的 **DSH-Go** 面板。
一切都按工作区隔离在 `.mpd/` 下；bundle 不在用户 home 留副本，卸载后也不留安装残留。

## MPD 为 DSH 增添了什么

- **一个为真实工作准备的 preset。** `mpd` 是把花名册、团队平面、workmate 库、记忆与校验工具都接好的
  主工作智能体。
- **十一位专家。** Architect、Researcher、Planner、Deep Worker、Senior Engineer、Lead、Explorer、
  Reviewer、Plan Reviewer、Vision Analyst、Junior Engineer——既可以做一次性咨询
  （`mpd_role_spawn`），也可以做团队成员，或成为长期演进的 workmate。
- **一块共享看板。** 队长用 `agent_teams_plan` 起草计划、审批，然后用 `agent_teams_task` /
  `agent_teams_dispatch` 驱动看板；团队的依赖图、负责人与评审行会显示在侧边栏 **Team** 视图、TUI 的
  `/mpd team` 场景，以及 DSH-Go 的团队面板里。
- **Workmates 与记忆。** `mpd_workmate_*` 在 `~/.mpd/workmate` 下为每个专业保留一个长期演进实例；
  `mpd_memory_*` 为工作区保留一份由 VCS 支撑的记忆。
- **校验界面。** `mpd_verify_open` / `mpd_verify_evidence` / `mpd_verify_record` 让“写者与验证者分离”
  成为可审计的记录，而不是一句承诺。
- **原生 DSH-Go 界面。** 两个面板、一条 composer strip、composer 与 message 动作，以及工具卡片——在
  清单里静态声明，由应用自己渲染，在没有桥的宿主上保持静默。

## 专家花名册

花名册是一组按名字寻址的 teammate 实例化模板。一次咨询就是一次有边界的委派，返回一份报告；多人协作走
团队平面，每个成员保有自己的模型路由（`mpd.jsonc` 里的 `agentRoutes.<Agent>`）。被证明好用的专家可以
实例化为 **workmate**：一个带有自己人格、记忆与便签卡的长期实例，跨会话延续。

## 团队看板

团队工作是被编排的，不是临时拼的。队长创建计划、按各自人格加入成员、加入任务（每个任务声明它的依赖
答案——`blocked_by` 或显式的 `independent: true`——以及它的写入范围），然后审批。审批即执行计划：成员被
启动，看板被播种，一个目标加一份 todo 列表锚定整个 run。验证行由与写者**不同**的智能体持有，一次被
记录的 FAIL 会把工作退回成修复任务。

## Workmates 与记忆

workmate 住在用户 home 的 `~/.mpd/workmate` 下，通过 `mpd_workmate_reflect` 演进，并按便签匹配复用
（`mpd_workmate_match`）。记忆按工作区隔离并由 VCS 支撑（`mpd_memory_write` / `mpd_memory_read`），每隔
若干条进行一次反思循环，让智能体把经验带下去。这两个界面都不是 bundle 启动所必需的。

## DSH-Go 面板

bundle 声明一份 DSH-Go 协议 1 清单：两个面板（`mpd` 工作台与 `mpd-team` 看板）、一条 composer strip、
两个 composer 动作和两个 message 动作，每个面板都在 `dsh-go/views/` 下指名一份手写静态视图。宿主半边
通过适配器里唯一一个延迟的 `ctx.inject(["dshGo"], …)` 绑定 `dshGo` 桥；没有桥的宿主什么也不注册，只打
一行 `dshGo=absent`，并且不轮询。标准、门禁与边界见
[`dsh-go-standard.zh-CN.md`](dsh-go-standard.zh-CN.md)。

## 完整文档在哪里

- [`../README.zh-CN.md`](../README.zh-CN.md) —— 产品页：界面、能力清单、安装、快速开始。
- [`index.zh-CN.md`](index.zh-CN.md) —— 文档中心。
- [`user-guide.zh-CN.md`](user-guide.zh-CN.md) —— 面向任务的指南。
- [`tui.zh-CN.md`](tui.zh-CN.md) —— DSH-TUI 版；[`tui-admission.zh-CN.md`](tui-admission.zh-CN.md) —— 它的
  准入记录。
- [`drive-surface.zh-CN.md`](drive-surface.zh-CN.md) —— 面向集成方的 DSH-Go / 团队 / 提问中继接缝。
- [`compatibility.zh-CN.md`](compatibility.zh-CN.md) —— 三平面兼容矩阵，以及展示元数据契约（图标、`meta`
  包装、`meta.detail`）。
- [`development.zh-CN.md`](development.zh-CN.md) —— 门禁、QA、打包、发布流程。
- [`../CHANGELOG.md`](../CHANGELOG.md) —— 每个版本改了什么。
