# 使用者指南

[English](user-guide.md) | **中文**

按使用顺序，覆盖安装 my-power-dsh bundle 并在日常工作中使用它所需的一切。想先看简版请看
[README](../README.zh-CN.md)；想了解内部原理请看 [architecture.zh-CN.md](architecture.zh-CN.md)。

## 1. 安装

### 一条命令，直接在检出目录中执行

```bash
cd <repo> && dsh plugin --profile web add .        # Web GUI
cd <repo> && dsh plugin --profile dsh-tui add .    # 终端界面（DSH-TUI）
```

仓库根目录 **就是** bundle 包本身（`@mpd-dsh/mpd`）：`dsh.bundle.patch`、`dsh.client` 与
`exports` 映射都在它的 manifest 里，因此这一条命令会安装全部插件行、`mpd` preset、整个 skill
语料库以及扩展根目录。没有别的步骤 —— 不需要打包，也不需要复制。重启 `dsh`，然后在
**MPD（Main Working Agent）** preset 上开启会话。

**每条 `dsh plugin` 命令都必须带 `--profile`**，`--help` 与 `remove` 也不例外：不带时 CLI 会直接
停下并提示 `error: required option '--profile <name>' not specified`。profile 名就是你实际运行的
那个 —— Web GUI 用 `web`，终端界面用 `dsh-tui`（脚本化运行用 `headless`）。

### DSH-TUI profile（`dsh-tui`）

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

同一个 bundle 会以**第三层 patch** 的身份装进终端界面，叠在 TUI 包之上：安装后
`dsh.profile.bundles` 为 `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`，
`dsh --profile dsh-tui --dump-config` 会把我们的行显示在独立的一层里
（`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`），并把 `mpd` preset 作为会话默认。
用 `dsh-tui` 启动器（别名 `dst`）启动：

```bash
dsh-tui            # 在当前目录启动
dsh-tui --resume   # 继续上一个会话（简写 -c）
dsh-tui --help     # update | doctor | version | help；其余参数原样转发给 `dsh --profile dsh-tui`
```

`dsh-tui` 需要真实终端：输出被重定向到管道时它会拒绝启动并提示
`Error: dsh-tui requires an interactive terminal (stdout must be a TTY).` 该版本的界面、
明确不声明清单与验证记录见 [tui.zh-CN.md](./tui.zh-CN.md)（分层结构见 §2）以及下方 §7。

### 打包产物（发布 / 分发）

```bash
node scripts/pack-mpd.mjs                          # -> dist/mpd-package/（可迁移）
dsh plugin --profile web add dist/mpd-package
dsh plugin --profile dsh-tui add dist/mpd-package
# 或者从任何已发布位置
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

`pack-mpd` 是给 **分发** 用的：它组装出一个自包含的 `@mpd-dsh/mpd`（各插件已构建的 dist +
采纳的 agent-teams 主代码 + skill 语料库与 presets + 合并后的 web 客户端 + 打包形态的 patch），
不依赖检出目录。发布、制作 tarball 或验证可迁移性时才需要它；本地安装从不需要。

### 卸载（一条命令，无残留）

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

本 bundle 整体安装、整体卸载，skills 也包含在内：插件行来自 bundle patch，`mpd` preset 从
`<bundle>/presets` 提供（patch 把 preset 根指向那里），skill 语料库从 `<bundle>/skills` 提供
（`mpd-bootstrap` 行注册了一个 `ctx.skills` provider）。`$DSH_HOME` 中不会被复制任何东西，因此
卸载会一并带走插件行、preset 与 skills —— 内置 preset 名册恢复原状，`$DSH_HOME/skills` 与
`$DSH_HOME/.agent-presets` 保持原样。刻意保留下来的只有 **你自己的数据**：workmate 库
（`~/.mpd/workmate`）与各工作区的 `.mpd/` 状态。

从 `<= 0.2.6` 的 bundle（会把 presets + skills 复制进 `$DSH_HOME`）升级：`>= 0.3.0` 的首次启动
会自行删除那些带版本戳的副本。由历史遗留的 `scripts/install-profile.mjs` 流程留下的无戳副本不会
被触碰 —— 如果你用过那个流程，请手工删除。

### 历史安装器（仅开发/QA）

```bash
node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]
node scripts/install-profile.mjs            # --dry-run 只打印计划，不写任何东西
```

绝不要在 QA 场景中对真实 home 运行这个历史安装器（`--dsh-home` 就是为隔离 QA 准备的）。
受支持的用户路径是 `dsh plugin add`。

## 2. `mpd` preset

唯一随包提供的 preset 是 **MPD（Main Working Agent）**。它的约定：

- **项目指令文件**：会话开始时，智能体必须尝试读取 `AGENT.md`（回退到 `AGENTS.md`，再回退到
  `CLAUDE.md`）—— preset 就是通过 `dsh-agent-instructions` 配置了这几个候选名。
- **原生工具呈现**：harness 自带的工具（bash/read/edit 等）直接暴露。
- preset 的人设解释了专家名册、团队模式与 workmate 库（见下文），因此智能体无需额外配置就能
  正确路由。

## 3. 按用途划分的工具

| 你想做的事 | 工具 | 说明 |
|---|---|---|
| 探索代码库 | `mcp__ast_grep__*`（结构化检索/改写）、`mcp__lsp__*`（定义、引用、诊断、重命名）、`mcp__codegraph__*`（项目代码图）、`mcp__git_bash__*`（shell） | MCP 工具服务器；它们的工具以 `mcp__<server>__<tool>` 形式出现 |
| 安全地修改 | 写入守卫与输出截断（无需配置）、`mpd_hashline_read/edit/format/restore`、`mpd_comment_check` | 哈希锚定编辑在锚点过期时会拒绝写入，而不是写到错误的行 |
| 推进长任务 | `mpd_ulw`（轻量）/ `mpd_ultrawork`（完整纪律：计划关卡、执行轮次、验证关卡）、`mpd_boulder_start/status/complete/task_timer/plan_progress/plans` | `mpd_boulder_*` 跨会话跟踪某个计划 markdown 文件的进度 |
| 保存记忆 | `mpd_memory_write/read/reflect/reflect_complete/status`、`mpd_memory_save/recall` | 版本库后端可以是 git 或 svn；`mpd_memory_save/recall` 是简单的键值层 |
| 咨询专家 | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona` | 一次性子智能体；只读角色会被禁用写入类工具 |
| 养一个会成长的智能体 | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` | 见 §5 |
| 运行一个团队 | `agent_teams_*` 以及 AgentTeams 标签页 | 见 §6 |
| 配置本 bundle | `.mpd/mpd.jsonc`、`mpd_config_get`、`mpd_config_reload` | 见 §9 |
| 扩展本 bundle | `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` | 见 §10 |
| 解析模型路由 | `mpd_modelchain_resolve` | 解析某位专家会使用的 provider/model |
| 查看已结束团队 | `mpd_team_compact_run`、`mpd_team_compact_status` | 已完结团队的压缩审计 |

## 4. 专家（名册）

名册中的 11 位专家是专家子智能体，**不是 preset**。用 **名字** 称呼他们即可（大小写、空格或连
字符写法都可以：`Architect`、`deep worker`、`plan-reviewer`）：

| 名字 | 纪律 |
|---|---|
| Architect | 架构评审、深度调试、自审 —— 只读 |
| Researcher | 基于证据的代码 / 开源检索 —— 只读 |
| Planner | 产出计划，从不实现 —— 只读 |
| Deep Worker | 端到端执行目标 |
| Senior Engineer | 主要实现与验证 |
| Lead | 编排与委派 |
| Explorer | 只读代码库检索 |
| Reviewer | 正确性与风险发现，不做修复 |
| Plan Reviewer | 检查计划是否可执行，只拒绝真实阻塞项 —— 只读 |
| Vision Analyst | 读取截图与图表 —— 只读 |
| Junior Engineer | 小而明确范围的机械化改动 |

一次性使用：

- `mpd_roles_list` —— 列出名册。
- `mpd_role_spawn { role, task, context? }` —— 以子智能体形式 spawn 一位专家，带上它的人设与
  模型路由；只读角色会被机制性地禁用写入类工具。
- `mpd_role_persona { role }` —— 取出完整人设文本（例如传给只接受文本人设的 spawn 接口）。

## 5. workmate 库（持久、会演化的专家）

名册只是 **基础模板**。当你会在多个会话中反复使用某位专家时，把它实例化成一个 *workmate* ——
`~/.mpd/workmate/` 下的一份持久副本（在你的 HOME 中，跨项目），拥有独立名字。

```text
mpd_workmate_init   { base: <名册名字>, name?: <独立名字>, note? }
  → 创建 ~/.mpd/workmate/<name>/{meta.json, persona.md, memory.md, note.md}
```

| 工具 | 用途 |
|---|---|
| `mpd_workmate_list` | 列出实例（name、base、uses、updatedAt、note） |
| `mpd_workmate_spawn { name, task, context? }` | 一次性复用：workmate 以其演化后的人设 + 独立记忆 + 说明卡，在自己的模型路由上运行；它被要求在最终汇报前调用 `mpd_workmate_reflect` |
| `mpd_workmate_reflect { name, task, outcome, persona_delta?, note? }` | 工作后自我演化：有上限的记忆追加（最旧的被淘汰）、人设修订合并、说明卡重生成、`uses++` |
| `mpd_workmate_match { task }` | 针对任务给说明卡打分；低于阈值时返回 `matched: false`，并建议 **新建一个 workmate** —— 绝不强推弱匹配 |
| `mpd_workmate_rename { name, new_name }` | 重命名实例（迁移它已演化的身份） |
| `mpd_workmate_delete { name, purge?, confirm? }` | 删除实例 —— 先归档；只有 `purge: true` + `confirm: <name>` 才是真正删除 |

容量上限让注入的上下文保持有界：人设 ≤ 8 KiB、记忆 ≤ 8 KiB、说明卡 ≤ 1.5 KiB。

workmate 是你智能体的 *演化记忆*：每次任务后由 workmate 自己总结（通过 spawn 指令或团队成员
人设），因此后续会话从上次结束处继续。

### 重命名与删除 workmate

**名字仅限 ASCII**（`[a-z0-9_-]`，小写）。`Alice`、中文名、`a/b` 或 `..` 会在最前面就被拒绝
（`400 invalid-name`）—— 磁盘上不会被动任何东西。Unicode 名字是已知的后续项，不是缺陷。

**重命名**（`mpd_workmate_rename { name, new_name }`）是 **迁移** workmate 而不是重建：目录键、
`meta.json`、库索引、说明卡中的自我引用以及历史名字（`renamedFrom`）一起迁移，而人设、记忆、
使用次数与创建时间按字节保留。重命名到已存在的名字会被拒绝（`409 collision`），重命名为当前
名字同样会被拒绝。

**删除**（`mpd_workmate_delete { name }`）是 **先归档**：实例被移动到
`~/.mpd/workmate/.archive/<name>-<stamp>/`，立即从 `list` 与 `match` 中消失，并可以手工找回：

```bash
mv ~/.mpd/workmate/.archive/<name>-<stamp> ~/.mpd/workmate/<name>
```

只有显式 purge 才会销毁任何东西：`mpd_workmate_delete { name, purge: true, confirm: "<name>" }`
—— 必须给出完全一致的名字，否则调用会被拒绝且不会删除任何内容。产品内没有"恢复"按钮：先归档在
UI 上是刻意的单向操作，恢复就是上面那条 `mv`。

**当 workmate 正在被使用时，这两种改动都会被拒绝** —— 无论是被团队成员使用（`.mpd/team/` 下
未归档的团队记录中出现了它的名字），还是仍有 `mpd_workmate_spawn` 在运行。拒绝信息为
`409 in-use`，并列出阻塞的团队 id 与成员，因此是可行动的：结束或归档那些团队，然后重试。同一
道门也覆盖重命名的 **目标名**，所以把 workmate 重命名为某个正被团队使用的名册名字也会被同样拒绝。

## 6. 团队模式

```text
agent_teams_create { name: <团队>, description: <目标>, profile: "mpd", approval: "required" }
  → 暂存一份使用正常名字的名册作为队友 + 一个空的任务 DAG
# 暂存期间：在 Web 计划面板中编辑成员/任务，或者用
agent_teams_add_member / agent_teams_create_task / agent_teams_edit_plan
agent_teams_approve  # 用户批准 → spawn 成员，调度器启动
# 队长（你 / captain）：
agent_teams_status / agent_teams_send_message / agent_teams_reassign_task
```

- `approval: "required"` 是两阶段流程（推荐）：在你于 GUI 中审阅之前，什么都不会运行。
- `mpd` profile 是 **captain 规划制**（`taskPlanning: captain`）：名册固定，由 captain 在暂存
  计划阶段设计任务 DAG。
- 只读成员（Architect、Researcher、Planner、Explorer、Plan Reviewer、Vision Analyst）从不编辑
  文件；工作者（Senior Engineer、Junior Engineer、Deep Worker、Lead、Reviewer）负责实现与验证。
- **由 workmate 背书的成员**：如果你初始化了一个 workmate（例如 `alice`）并添加一个名为
  `alice` 的成员，该成员的系统提示会自动带上 `alice` 的人设 + 记忆 + 说明卡，并在每次任务后
  回写进该 workmate。captain 的行为准则：委派前先查 `mpd_workmate_match`；匹配很弱就新建一个
  workmate，而不是硬用。
- **扩展 role 不是团队成员**：扩展可以贡献一个能被 `mpd_role_spawn` / `mpd_role_persona` 使用
  的 role，但团队成员列表是静态的 patch 配置，所以扩展 role 永远不会成为队友（见 §10）。

## 7. DSH-TUI 版本（终端界面）

同一个 bundle 在宿主 `dsh-tui` profile 下就是 **TUI 版本**：由 profile 自带的终端界面承载与 Web GUI
标签页对应的 TUI 原生界面。深入说明见 [`tui.zh-CN.md`](tui.zh-CN.md)；本章只讲日常使用。

```sh
dsh plugin --profile dsh-tui add /path/to/my-power-dsh
```

这一条命令就是全部安装（插件代码、bundle 级 `dsh-plugin.json`、skills 语料、MCP 行）。没有按包执行的
`dsh plugin add`，而且 TUI 包自身不携带 `cordis.patch.yml` —— `mpd-tui` 这一行由 bundle patch 独占，
因为第二次挂载会重复 loader entry id，而 loader 会直接拒绝。安装后
`dsh.profile.bundles` 为 `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`
—— 本 bundle 是**第三层** patch 层 —— 且 TUI 中创建的会话默认使用 **mpd** preset。宿主需要真实终端：
stdout 不是 TTY 时 `dsh-tui` 拒绝启动
（`dsh-tui requires an interactive terminal (stdout must be a TTY)`），所以永远不要用管道驱动它。

### 7.1 TUI 原生界面与对应的 Web 界面

| Web 界面 | TUI 等价物 |
|---|---|
| AgentTeams 侧边栏标签页 | `tuiScenes` 全屏看板 + 带 key 的 `tuiStatus` 状态行 |
| Workmates 侧边栏标签页 | `/mpd` 命令树（`tuiCommandTrees`）+ `tuiDialogs` |
| bundle 悬浮面板 | `tuiStatus` 状态行 |
| 设置 → MPD 栏 | `/settings` 分区（`tuiSettingsSections`） |
| — | `tuiShortcuts` 快捷键 |

这些是**等价物，不是等价功能（parity）**：每个界面都重建在宿主自身的 TUI 接缝上，且有两个接缝被明确
声明为未主张 —— 宿主不提供 prompt 插槽（`tuiPrompt` 宿主不可用），也不为 bundle 的 renderer 事件投射
任何 transcript 行，因此 prompt 插槽与 transcript 行都不作主张。完整清单位于
[`tui.zh-CN.md`](tui.zh-CN.md) §10 NOT-CLAIMED。

### 7.2 `/settings` 界面与 `mpd.jsonc` 桥接

`/settings` 编辑六个真实的 `mpd.jsonc` 旋钮 —— `hashline.maxDiffChars`、`commentChecker.autoCheck`、
`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir` —— 它们位于 harness settings 命名空间
`mpd` 之下。该命名空间由 `packages/mpd-config-plugin` 提供，其 base 是工作区**文件**里的值，所以界面
打开时显示的是你的文件值而不是 schema 默认值；保存会**写入 `<workspace>/.mpd/mpd.jsonc`**（针对当时
存活的会话工作区），并保留注释、键顺序与尾随逗号 —— 与 Web GUI 卡片触发的是同一条回写路径（
[`tui.zh-CN.md`](tui.zh-CN.md) §3.1）。

在依赖它之前需要知道两件事：

- **重启后才生效。** mpd 插件在挂载时读取配置（`applies: "restart"`），而宿主不提供注销一个已注册
  命名空间的句柄，所以保存后的旋钮要等你重启会话后才被插件使用。界面上的提示就是这么写的。
- **两个具名跳过场景。** settings 路径本身不携带工作区身份，所以写入目标是保存那一刻存活的会话工作区：
  没有任何存活会话时，保存只写入宿主 settings 文档并报告 `no-live-session`；有**多于一个**存活工作区时
  会被拒绝为 `ambiguous-multi-root`，并逐一列出候选。这两种情况下**不会改动任何文件**，而值**不会丢失**
  —— 它保存在 settings 文档中，配置层立即对所有工作区生效；只有文件写入在等待"恰好一个"存活会话。

`mpd.jsonc` 中重复的键会编辑其**最后**一次出现（即 `JSON.parse` 读到的那一个），诊断信息会列出每一处
出现所在行；重复的中间对象则被拒绝为 `ambiguous-intermediate`，文件保持逐字节不变（
[`tui.zh-CN.md`](tui.zh-CN.md) §6.5）。

### 7.3 `/mpd` 命令与状态行

`/mpd` 是覆盖侧边栏标签页原有状态的 TUI 命令树：裸 `/mpd` 打开选择器，`/mpd <值>` 直接执行，
`/mpd status` 打印摘要。**状态行**（`tuiStatus`）是提示框上方的一行带 key 读数，报告 bundle 的实时
状态 —— 团队、boulder/计划与 workmate 库 —— 读自会话工作区的 `.mpd` 状态。它只用于显示；可交互的部分
在看板场景、对话框与快捷键里。

准入与分发产物、逐包兼容性台账、版本字符串、状态作用域以及明确的 NOT-CLAIMED 清单，请读
[`tui.zh-CN.md`](tui.zh-CN.md)。

## 8. Web GUI

- **AgentTeams 侧边栏标签页**（唯一的团队界面）：整个团队 GUI 是 **DSH-better-sidebar**
  （社区侧边栏 bundle；标签 id `mpd-agent-teams`）中的一个标签页。它列出 *本会话* 的团队 ——
  先活跃团队（成员及其实时动态、带状态的任务行、依赖图、captain 上下文、停止团队控制），再是
  已归档团队 —— 并且承载暂存计划的审批编辑器，因此计划在它被创建的地方被审阅和编辑。标签徽标
  显示本会话中活跃团队的数量，`single: true` 会让标签页重新定位而不是打开第二份副本。当出现团队
  时，标签页会自行打开一次；可以在侧边栏设置页用 **Auto-open when a team appears** 开关关闭
  （插件设置 `autoOpenOnTeamActivity`，默认开启）。
- **Workmates 侧边栏标签页**：workmate 库作为第二个标签页贡献给同一个侧边栏，因此它和该侧边栏
  自己的页面在一起 —— 标签条、`+` 菜单，以及侧边栏自己的启用/禁用开关。页面列出
  `~/.mpd/workmate/` 中的实例（base、uses、updated、note），支持筛选、打开查看某人设/记忆/说明卡，
  并可以从 **基于名册的 base 选择器**（不需要手输 id）加上可选名字与说明卡来新建一个实例。它还可以
  **重命名** 与 **删除** 选中的实例 —— 删除流程是显式的（先确认，再归档，然后还有一个需要输入
  完整名字才能永久清除的步骤），两种操作都做了 zh/en 本地化。它读取并调用宿主路由
  `GET /plugins/mpd-workmate/{list,roster,get}` 与
  `POST /plugins/mpd-workmate/{init,rename,delete}`。侧边栏 **标签条上的文字** 仍然保持英文
  `Workmates`（这是一个已记录的推迟项：标签条文字的解析处没有本地化翻译器，AgentTeams 标签页
  同样如此）；页面正文跟随你的语言。
- **两个页面都只存在于侧边栏中**：都没有降级方案。没有 DSH-better-sidebar 时，两者各自只会打印
  一条警告且不注册任何东西。团队工作仍然可以通过 `agent_teams_*` 工具与 `.mpd/team` 状态运行，
  workmate 库也仍然可以通过 `mpd_workmate_*` 工具完整使用。

## 9. 配置（`mpd.jsonc`）

`mpd-config` 把项目层 `.mpd/mpd.jsonc` 合并到用户层 `$DSH_HOME/mpd.jsonc` 之上（逐键合并，项目
优先）。用 `mpd_config_get` 查询解析后的值，用 `mpd_config_reload` 重新读取。插件会读取的键：

| 键 | 消费方 | 含义 |
|---|---|---|
| `memory.vcs` | mpd-memory | `git` / `svn` / `both` |
| `memory.dir`、`memory.agentSlug`、`memory.reflectionEvery` | mpd-memory | 记忆根目录、agent slug、反思节奏 |
| `boulder.dir` | mpd-boulder | boulder 台账位置 |
| `hashline.*` | mpd-hashline | 守卫开关、diff 上限、注册表文件 |
| `commentChecker.*` | mpd-comment-checker | autoCheck、二进制、超时 |
| `ulw.*` | mpd-ulw | 轮数、计划/状态目录、provider/model 路由 |
| `extensions.enable`、`extensions.disable` | mpd-ext | 按 id 的扩展启用/禁用列表（进程级：见 §10） |
| `extensions.mcp.*` | mpd-ext | MCP 桥默认值：`enabled`、`connectTimeoutMs`、`toolCallTimeoutMs` |
| `modelchain.*` | mpd-modelchain | 各名册角色的 provider/model 链 |
| `team.stateDir` | agent-teams | 团队状态位置（默认 `.mpd/team`） |

`mpd-codegraph` 刻意不在上表中：它的 `autoInit`、`initTimeoutMs`、`cooldownMs` 与 `binary` 来自
它的 **bundle-patch 行** 配置（在 apply 时读取），没有任何插件通过 `mpd.jsonc` 读取
`codegraph.*` 键。它的行在 `packages/mpd-bundle/cordis.patch.yml` 中自带 `autoInit: true` 与
`initTimeoutMs: 60000`。

## 10. 从使用者视角看扩展

扩展接口让一个包 —— 或一个普通目录 —— 在不改动 bundle 的前提下，为你的 DSH 环境增加 skill、
flow、MCP 服务器与专家 role。作者的完整契约见 [extensions.zh-CN.md](extensions.zh-CN.md)；本节
只讲 *使用者* 需要知道的部分。

**扩展从哪里被发现**（一个扩展就是包含 `mpd-ext.json` 的目录）：

| 根目录 | 时机 | 可贡献 |
|---|---|---|
| `<工作区>/.mpd/extensions/` | 每次调用重新读取，来自发起调用的会话工作区 | 仅 skills + flows |
| `~/.mpd/extensions/` | 插件启动时发现 | skills、flows、MCP 服务器、roles |
| `<bundle>/extensions/` | 插件启动时发现 | skills、flows、MCP 服务器、roles |

**添加一个扩展。** 把目录放进正确的根（需要 MCP 服务器或 roles 就用主机级；只增加 skills 与
flows 就可以放在工作区级），然后重启 `dsh`。没有 reload 工具：重启就是唯一诚实的重载方式。

**打开或关闭。** 扩展自己的 manifest 里有 `"enabled": true|false`；随包的参考扩展默认禁用。
你也可以不改 manifest，而是在 `.mpd/mpd.jsonc` 中覆盖：

```jsonc
{
  "extensions": {
    "enable": ["my-runtime-ext"],
    "disable": ["noisy-ext"],
    "mcp": { "enabled": true, "connectTimeoutMs": 10000, "toolCallTimeoutMs": 60000 }
  }
}
```

`disable` 优先于 `enable`，`enable` 优先于 manifest 自身的 `enabled`。

**查看加载了什么。** `mpd_ext_list` 显示所有已知扩展及其 plane、有效启用状态、贡献计数、逐条目
错误，以及每个扩展声明的技能名里有哪些真的被 harness 目录服务；`mpd_ext_show { id }` 显示单个
扩展的全部信息，包括这份服务校验、每个 MCP 服务器的确切状态
（`connected`、`unavailable`、`failed`、`disabled`）以及它发布的工具。（`mpd_ext_show` 会把作者
声明的 MCP `env` 值脱敏——键仍然可见，密钥不会进入你的会话日志。）`mpd_flow_list` /
`mpd_flow_show` 用于查看所贡献的 flow。在信任一个目录之前先校验它：

```bash
bun scripts/mpd-ext.mjs validate <dir>     # 退出码 1，并逐条打印问题
bun scripts/mpd-ext.mjs scaffold my-ext --dir /tmp   # 从一个可工作的骨架开始
```

**诚实的边界。**

- **会话级扩展只能增加 skills 与 flows。** 工具与 provider 的注册是进程级的，因此工作区级清单
  若声明 `mcp` 或 `roles`，会按条目被拒绝并给出明确原因 —— 绝不会半加载。
- **没有 reload。** 修改扩展的 manifest 或资源后，会在下一次 `dsh` 启动时生效；`mpd_ext_list`
  刻意没有对应的重载工具。
- **扩展 role 不是团队成员。** 它们可以通过 `mpd_role_spawn` / `mpd_role_persona` 使用，也可以
  作为 workmate 的基础模板，但 agent-teams 的成员列表是静态 patch 配置。
- **`extensions.*` 配置是进程级的**，在插件启动时读取 —— 它不是按会话隔离的。
- **第四方 MCP 服务器是一个子进程。** 它绝不会从你的宿主环境继承名字形如凭据的变量；它需要什么
  就在 manifest 的 `env` 中声明。

## 11. 故障排查速查

- `mpd_role_spawn` 报未知角色 → 角色按 **名字** 应答（`Architect`、`Deep Worker`、
  `plan reviewer` —— 大小写/空格/连字符写法都可以）；运行 `mpd_roles_list`。
- `mpd_workmate_*` 提示 "mpdRoles service unavailable" → `mpd-roles` 行没有挂载（重新安装
  bundle）。
- workmate 的重命名/删除 **因"正在使用"被拒绝** → `.mpd/team/` 下某个未归档团队记录中出现了它，
  或仍有 `mpd_workmate_spawn` 在运行。拒绝信息会列出阻塞的团队；在 AgentTeams 标签页中归档（或
  退役）那些团队并等待运行中的 spawn 结束，然后重试。
- workmate 被误删 → 默认删除只会 **归档**：把
  `~/.mpd/workmate/.archive/<name>-<stamp>` 移回 `~/.mpd/workmate/<name>` 即可。产品内没有恢复
  功能，而 `purge`（配合 `confirm: <name>`）不可恢复。
- workmate 名字被拒绝（`400 invalid-name`）→ 名字仅限 ASCII、小写 `[a-z0-9_-]`：大写、空格、
  标点、`/` 与中文名都会在触碰任何东西之前被拒绝。
- **扩展没有出现在 `mpd_ext_list` 中** → 检查目录里确实有 `mpd-ext.json`、它确实位于三个根之一
  之下，并且 `dsh` 已重启。被拒绝的清单会由 `mpd_ext_list` 连同逐条目原因一起报告。
- **扩展的 MCP 工具缺失** → `mpd_ext_show { id }` 会报告该服务器的状态：`unavailable`/`failed`
  会带上子进程的 stderr 尾部与原因；`disabled` 表示扩展被关闭或 `extensions.mcp.enabled` 为
  false。**参数** 无法投影到 harness 子集的工具会被明确跳过（作为已记录的错误出现），而不是静默
  消失；而外来的 `outputSchema` 只让该工具失去 `structuredContent`——工具仍然注册，并记录原因。
  被声明却未被服务的技能会报成 `notServed`（`served` 表示 harness 目录确实把该名字解析到了这个
  扩展）。
- **工作区级扩展的 `mcp`/`roles` 条目被拒绝** → 符合预期：只有主机级根
  （`~/.mpd/extensions/`、`<bundle>/extensions/`）可以贡献工具与 provider。请移动该目录，或从
  清单中去掉不支持的种类。
- 侧边栏缺少 AgentTeams 标签页 → 重新构建随包客户端（`node scripts/build-mpd-client.mjs`，然后
  刷新页面），并确认 profile 中存在 `dsh-better-sidebar`（没有它，团队页面只打印一条警告且没有
  宿主）。
- GUI 中完全没有客户端界面 → `mpd-web-compat` 自引用行必须存在，并且需要重新安装 bundle
  （`dsh plugin --profile <p> add <repo-or-package>`）。
- `MISSING_CREDENTIAL` → 该 provider 路由需要在你的 DSH 凭据中有密钥；本 bundle 从不配置密钥。
- AGENT.md 没有被注入 → 会话运行的不是 `mpd` preset；请切换 preset。
- 侧边栏显示 `cannot resolve target "…/team-activity"` → 旧客户端用内容种子打开了 AgentTeams
  标签页。更新 bundle（`git pull`，然后 `dsh plugin --profile <p> add <repo>`）并刷新页面 ——
  现在的自动打开不再带种子。
- **无法创建任何 `mpd` 会话，错误为 `agent-preset/invalid … $.prefix missing required value`**
  → 已安装的 harness 改变了 `dsh-persona` 契约（它接受 `prefix`，而不是已退休的 `text`），于是
  拒绝挂载整个 preset。更新 bundle（`git pull`，然后 `dsh plugin --profile <p> add <repo>`）
  —— 这是 harness 版本兼容性修复，不是你这边配置的问题。
