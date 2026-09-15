# my-power-dsh

[English](./README.md) | **中文**

**my-power-dsh** 是 DeepSeek Harness（DSH）的插件 bundle。一次安装，就能把一套朴素的 DSH
环境变成真正可用于工程开发的工作环境：一个会自动读取你项目规则的主智能体、一份包含十一位专家、
可供咨询或委派的名册、一个会记住自己所学内容的持久化 workmate 智能体库、需要你先审批计划才会
运行的多智能体团队、一套随包提供的 skill 语料库、用于代码理解的 MCP 集成，以及一套扩展接口——
让其他包在不改动核心的前提下贡献 skill、flow、MCP 服务器与专家。

这个 bundle 就是包 `@mpd-dsh/mpd`。它用一条命令安装，也用一条命令卸载，不留残留。

## 能力清单

### 主智能体：`mpd` preset

唯一随包提供的 preset 是 **MPD（Main Working Agent）**。在会话中选中它，你会得到：

- **自动加载项目规则** —— 每次会话开始时，智能体会尝试读取 `AGENT.md`，回退到 `AGENTS.md`，
  再回退到 `CLAUDE.md`。
- **原生工具呈现** —— harness 自带的工具（`bash`、`read`、`edit` 等）直接暴露，再加上本 bundle
  新增的全部能力。
- **内建路由** —— preset 的人设解释了专家名册、workmate 库与团队模式，因此智能体无需额外配置
  就知道该找谁。

### 按用途划分的工具

| 你想做的事 | 工具 |
|---|---|
| 理解代码库 | MCP 工具服务器：`mcp__ast_grep__*`、`mcp__lsp__*`、`mcp__codegraph__*`、`mcp__git_bash__*` |
| 安全地修改 | 写入守卫与输出截断行、`mpd_hashline_read/edit/format/restore`（哈希锚定编辑）、`mpd_comment_check` |
| 推进长任务 | `mpd_ulw` / `mpd_ultrawork`（计划 → 执行 → 验证）、`mpd_boulder_*`（持久化计划进度） |
| 保存记忆 | `mpd_memory_write/read/reflect/reflect_complete/status`（git 或 svn 后端）、`mpd_memory_save/recall` |
| 咨询专家 | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona` |
| 养一个会成长的智能体 | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` |
| 运行一个团队 | `agent_teams_*` 以及 AgentTeams 侧边栏标签页 |
| 配置本 bundle | `.mpd/mpd.jsonc`、`mpd_config_get`、`mpd_config_reload` |
| 扩展本 bundle | `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` 以及 `extensions/` 根目录 |

### 专家：名册

十一位专家以"一次性专家子智能体"的形式提供，而不是独立的 preset。用名字称呼他们即可（大小写、
空格或连字符写法都可以）：

**Architect**（架构评审、深度调试、自审）· **Researcher**（基于证据的代码与开源检索）·
**Planner**（只写计划，从不实现）· **Deep Worker**（端到端执行目标）· **Senior Engineer**
（主要实现与验证）· **Lead**（编排与集成）· **Explorer**（只读代码库检索）· **Reviewer**
（风险发现，不做修复）· **Plan Reviewer**（计划质量审查）· **Vision Analyst**（图像与图表）·
**Junior Engineer**（小而明确范围的改动）。

只读纪律的成员（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）在
spawn 时会被机制性地禁用写入类工具。

### workmate 库

任何专家都可以被"实例化"为一个 **workmate**：`~/.mpd/workmate/` 下的一份持久副本，拥有独立名字、
独立人设、独立记忆和一张简短的说明卡。workmate 在每次工作后会自我总结、持续演化，下一次运行就从
上次结束的地方开始。复用通过 `mpd_workmate_match` 匹配，并且绝不强推弱匹配：匹配不够好时，应当
新建一个 workmate。Workmates 侧边栏标签页让你手工浏览、打开、创建、重命名与归档实例。

### 团队模式

captain 设计名册与任务 DAG，你在 AgentTeams 标签页中审阅并批准计划，然后由感知依赖关系的调度器
执行。成员就是上面的专家；只读纪律的成员保持只读。成员可以由 workmate 背书，这样一个队友就带着
自己积累的记忆。

### Web GUI

- **AgentTeams 标签页** —— 完整的团队界面：本会话的活跃与已归档团队、成员动态、任务行、依赖图、
  停止控制，以及暂存计划的审批编辑器。标签页徽标显示当前活跃团队数量。
- **Workmates 标签页** —— workmate 库：实例、说明卡，以及初始化/重命名/删除流程。

这两个标签页都贡献给社区侧边栏 bundle `dsh-better-sidebar`，出现在它的标签条中。如果你更偏好
命令行，团队工作也完全可以只通过 `agent_teams_*` 工具运行。

### DSH-TUI 版本

同一个 bundle 也可挂载在宿主 `dsh-tui` profile 下（`dsh plugin --profile dsh-tui add
/path/to/my-power-dsh`）：由终端界面承载与 Web 标签页等价的界面 —— 带 key 的状态行、全屏看板、`/mpd`
命令树、受管对话框、快捷键，以及编辑六个 `mpd.jsonc` 旋钮的 `/settings` 分区；该分区桥接到
`<workspace>/.mpd/mpd.jsonc`，并在**重启之后**生效。深入细节（界面清单、准入与分发产物、逐包兼容性
台账、明确的 NOT-CLAIMED 清单）见 [`docs/tui.zh-CN.md`](./docs/tui.zh-CN.md)，英文版为
[`docs/tui.md`](./docs/tui.md)。

### Skills

18 个 skill 随包提供，并且是 **按引用提供，而非复制**：语料库与 `mpd` preset 都位于 bundle 内，
卸载时会干净地一并消失。

### MCP 集成

四个位于本仓库内的 stdio MCP 服务器（ast-grep、git-bash、LSP 桥接、codegraph），加上可选的远程行
（context7、grep_app），为智能体提供结构化代码检索、语言服务器智能、项目代码图和 shell 能力。

### 扩展接口

一种标准化方式，让 **其他包** 在不改动本 bundle 的前提下增加能力：

- 清单文件 —— `mpd-ext.json` —— 声明 `skills`、`flows`、`mcp` 服务器与 `roles`；
- 三个发现根、两种生命周期：按会话（`<工作区>/.mpd/extensions/`，仅 skills 与 flows）与主机级
  （`~/.mpd/extensions/`、`<bundle>/extensions/`，后者还可以贡献 MCP 服务器与 roles）；
- 四个检查工具 —— `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show`；
- 一个零依赖的运行时桥：在插件启动时连接清单声明的 stdio MCP 服务器，并把它们的工具以
  `mcp__<server>__<tool>` 的形式发布出来；
- 一个开发者 CLI —— `bun scripts/mpd-ext.mjs validate|scaffold|list`。

一个默认禁用的参考扩展随包提供：
[`extensions/mpd-ext-example/`](./extensions/README.zh-CN.md)。

### 面向长期可维护

- **唯一的 harness 适配器。** 每个插件行都通过同一个适配器包与 DSH 对话，因此当 harness 版本
  改变某个接缝形状时，只需改一个文件。
- **整体安装、整体卸载。** 插件行、preset、skills 与扩展根目录都位于 bundle 内；DSH home 中不会
  被复制任何东西。卸载后保留下来的是你自己的数据：workmate 库与各工作区的 `.mpd/` 状态。

## 安装

一条命令，直接在检出目录中执行：

```bash
cd <repo> && dsh plugin --profile web add .
```

仓库根目录 **就是** bundle 包本身，所以这一条命令会同时安装全部插件行、`mpd` preset、skill 语料库
与扩展根目录 —— 不需要打包步骤，也不需要复制步骤。重启 `dsh`，然后在会话中选择
**MPD（Main Working Agent）** preset。

如果要使用已发布产物或 tarball 安装，先打包再加入：

```bash
node scripts/pack-mpd.mjs                       # -> dist/mpd-package/（可迁移）
dsh plugin --profile web add dist/mpd-package
```

### 卸载

```bash
dsh plugin remove @mpd-dsh/mpd
```

本 bundle 作为一个整体卸载，skills 也包含在内，并在你的 DSH home 中不留残留。你的 workmate 库
（`~/.mpd/workmate/`）与各工作区的 `.mpd/` 状态仍然归你所有。

## 快速上手

1. **安装**（见上），重启 `dsh`，在 **MPD** preset 上开启一个会话。
2. **让它做一件真事** —— 智能体具备 `bash`/`read`/`edit` 以及 MCP 代码工具。在项目里放一个
   `AGENT.md` 来引导它；它会被自动读取。
3. **咨询一位专家**：用 `mpd_roles_list` 查看名册，然后用
   `mpd_role_spawn { role: "Architect", task: "…" }` 获取第二意见。
4. **把好用的留下来**：`mpd_workmate_init { base: "Architect", name: "system-architect" }`，
   之后用 `mpd_workmate_spawn` 复用它。
5. **扩展成一个团队**：`agent_teams_create { name: "…", description: "…", profile: "mpd",
   approval: "required" }`，在 AgentTeams 标签页审阅计划并批准，然后看调度器开工。
6. **接入你自己的能力**：把一个扩展目录放进 `<工作区>/.mpd/extensions/`，再用 `mpd_ext_list`
   看到它。

## 环境要求

- DeepSeek Harness（DSH），使用 web 或 headless profile，并在 DSH 中配置好模型凭据 ——
  本 bundle 从不会替你配置密钥。
- 可选项：若要使用代码智能相关服务器，需要仓库内的工具链（`node scripts/build-mcp.mjs`）或你
  自己的二进制文件，并通过文档中给出的环境变量指向它。

## 接下来读什么

| 文档 | 适合谁 |
|---|---|
| [`docs/user-guide.zh-CN.md`](./docs/user-guide.zh-CN.md) | 安装/卸载、preset、工具、专家、workmate、团队、GUI、配置、扩展、故障排查 |
| [`docs/extensions.zh-CN.md`](./docs/extensions.zh-CN.md) | 扩展开发者指南：契约、四种贡献种类、CLI |
| [`docs/tui.zh-CN.md`](./docs/tui.zh-CN.md) | DSH-TUI 版本：安装、TUI 原生界面、准入与分发产物、兼容性台账、NOT-CLAIMED 清单 |
| [`docs/architecture.zh-CN.md`](./docs/architecture.zh-CN.md) | bundle 如何组装与挂载：启动链、插件清单、状态布局 |
| [`docs/development.zh-CN.md`](./docs/development.zh-CN.md) | 本仓库的构建、测试、QA 关卡、打包与发布 |
| [`docs/index.zh-CN.md`](./docs/index.zh-CN.md) | 文档中心与阅读顺序 |
| [`AGENTS.md`](./AGENTS.md) | 面向智能体与维护者的仓库手册（英文） |

## 与其他项目的关系

本 bundle 站在他人的工作之上，因此有必要说清楚哪些部分来自哪里。

- **沿用上游的部分。** 专家名册与模型链术语来自
  [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)（OMO），固定在 commit
  `8c57e46`（v5.0.0-beta.20）。这十一位专家在这里以"适配后的队友模板与 workmate 基础模板"的形式
  提供。这份固定基线是工程参考，而不是身份标签：本仓库不是 OMO 的 fork，也不会逐版本跟随它。
- **整体采纳的部分。** 来自 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)
  （MIT）的 `agent-teams` 插件，以一等主代码的形式内嵌，并带有本地适配（continuable-setup 接缝
  的启动安全守卫、live-agent 成员初始化、workmate 人设注入，以及客户端导出桥）。它自身的许可证与
  声明保存在 [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)。
- **本仓库自己写的部分。** DSH 管道（harness 适配器、运行时插件、`mpd` preset、合并后的 web
  客户端）、QA 套件、文档以及扩展接口，都是本项目自己的工作。

在此感谢 OMO 的作者与贡献者，也感谢 `dsh-agent-teams` 的作者以允许这种采纳的许可证发布他们的
工作。

## 许可证

本仓库采用 **SUL-1.0** 许可，继承自上游项目；完整文本见 [LICENSE.md](./LICENSE.md)。上游版权归
code-yeongyu 与 oh-my-openagent 贡献者所有。采纳的 `agent-teams` 组件保留其自身的 MIT 许可证，
该授权仅覆盖该组件本身 —— 本项目自己的代码并非 MIT 许可。详见
[LICENSE-NOTICES.md](./LICENSE-NOTICES.md)。
