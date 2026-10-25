# 使用者指南

[English](user-guide.md) | **中文**

按使用顺序，覆盖安装 my-power-dsh bundle 并在日常工作中使用它所需的一切。想先看简版请看
[README](../README.zh-CN.md)；想了解内部原理请看 [详细设计文档](design.zh-CN.md)。

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

本 bundle 声明了**四个**运行时依赖 —— 即 `package.json` 的 `dependencies` 里的四个条目：提供团队模式的
三个官方 Agent Teams 包（`@deepseek-ai/dsh-experimental-agent-team` 及其 `-tool-agent-team`、
`-client-ui-agent-team` 两个同级包），加上 `@dsh-std/sdk`（`0.1.1-rc.2`）—— DSH Standard facet 激活
模块的 scoped 辅助库，与其他已声明依赖一样由包管理器解析，不随本仓库分发。
**`dsh-better-sidebar`**（即承载 Workmates 标签页的社区侧边栏 bundle）**有意不在
其中**：它是可选 peer（外加一个 `devDependency`），bundle 从不安装它，它的缺席是正常的组合状态，
而不是安装损坏（§8）。检出目录安装会直接读取
本仓库，因此请先把仓库依赖落到本地：

```bash
cd <repo> && bun install          # 只需一次：把声明的运行时依赖落到仓库 node_modules
```

如果 `node-gyp` 不可用，可以用
`bun add dsh-better-sidebar@0.28.0 --ignore-scripts` 跳过构建脚本装上这个**可选 peer** —— 只有侧边栏的
终端面板会降级。（当初需要这个开关的传递依赖 `node-pty` 自 `0.24.1` 起已被移除，2026-10-02 实测；
`0.28.0` 同样不含任何安装脚本，2026-10-21 实测。）`dsh-better-sidebar@0.28.0` 要求 harness
**DSH 0.2.1-rc.1 或更新**；本 bundle 固定的是 `0.2.1-rc.2`。
从打包产物安装时无需额外步骤：pnpm 会替你装好那些已声明的依赖（见下方 *打包产物*）。

**每条 `dsh plugin` 命令都必须带 `--profile`**，`--help` 与 `remove` 也不例外：不带时 CLI 会直接
停下并提示 `error: required option '--profile <name>' not specified`。profile 名就是你实际运行的
那个 —— Web GUI 用 `web`，终端界面用 `dsh-tui`（脚本化运行用 `headless`）。

### DSH-TUI profile（`dsh-tui`）

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

同一个 bundle 会以**第三层 patch** 的身份装进终端界面，叠在 TUI 包之上：安装后
`dsh.profile.bundles` 为 `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`，
`node scripts/dump-config.ts --profile dsh-tui`（仓库包装器，会在自身输出里打印
「仅组合」警告）会把我们的行显示在独立的一层里
（`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`）。安装后 `mpd` 只是**可用**，
**不是**会话默认：部署默认仍属于 host，把 `mpd` 选为默认要由你通过文档记载的渠道完成
（见 §7 与 [`preset-default.zh-CN.md`](preset-default.zh-CN.md)）。用 `dsh-tui` 启动器（别名 `dst`）启动：

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
node scripts/pack-mpd.ts                          # -> dist/mpd-package/（可迁移）
dsh plugin --profile web add dist/mpd-package
dsh plugin --profile dsh-tui add dist/mpd-package
# 或者从任何已发布位置
dsh plugin --profile web add <path-or-name-of-@mpd-dsh/mpd>
```

`pack-mpd` 是给 **分发** 用的：它组装出一个自包含的 `@mpd-dsh/mpd`（各插件已构建的 dist +
skill 语料库与 preset patch + 脚手架 `templates/` + 带 EN / `zh-CN` 配对的
`docs/` 文档集 + 按需查阅的 `agent-references/`（故障排查表、验证流程与接缝契约）+
合并后的 web 客户端 + 打包形态的 patch），不依赖检出目录。自 2026-09-17 的打包变更起，
该产物同样**面向作者**：扩展 CLI、脚手架模板与全部指南都随包交付，因此已安装的 bundle 可以直接
`bun node_modules/@mpd-dsh/mpd/scripts/mpd-ext.ts validate <dir>`，其中的 `docs/` 也可就地阅读。
发布、制作 tarball 或验证可迁移性时才需要它；本地安装从不需要。产物必须携带什么不再靠信任：
`node scripts/verify-pack-closure.ts` 会在已声明的资产缺失、`docs/`+`templates/` 与源目录逐文件不符、
或打包 manifest 的 `files` 列表与磁盘内容不一致时大声失败。

### 卸载（一条命令，无残留）

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

本 bundle 整体安装、整体卸载，skills 也包含在内：插件行来自 bundle patch，`mpd` preset 由
`presets/mpd.patch.yml` 里的 `preset-mpd` 行声明（**增量**交付 —— bundle 不对任何 host 行做
id-target，因此部署默认仍属于 host，§7），skill 语料库从 `<bundle>/skills` 提供
（`mpd-bootstrap` 行注册了一个 `ctx.skills` provider）。`$DSH_HOME` 中不会被复制任何东西，因此
卸载会一并带走插件行、preset 与 skills —— 内置 preset 名册恢复原状，`$DSH_HOME/skills`
保持原样。刻意保留下来的只有 **你自己的数据**：workmate 库
（`~/.mpd/workmate`）与各工作区的 `.mpd/` 状态。

从 `<= 0.2.6` 的 bundle（会把 presets + skills 复制进 `$DSH_HOME`）升级：`>= 0.3.0` 的首次启动
会自行删除那些带版本戳的副本。由历史遗留的 `scripts/install-profile.ts` 流程留下的无戳副本不会
被触碰 —— 如果你用过那个流程，请手工删除。

### 历史安装器（仅开发/QA）

```bash
node scripts/install-profile.ts --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]
node scripts/install-profile.ts            # --dry-run 只打印计划，不写任何东西
```

绝不要在 QA 场景中对真实 home 运行这个历史安装器（`--dsh-home` 就是为隔离 QA 准备的）。
受支持的用户路径是 `dsh plugin add`。

## 2. `mpd` preset

唯一随包提供的 preset 是 **MPD（Main Working Agent）**。它的约定：

- **项目指令文件**：会话开始时，智能体必须尝试读取 `AGENT.md`（回退到 `AGENTS.md`，再回退到
  `CLAUDE.md`）—— preset 就是通过 `dsh-agent-instructions` 配置了这几个候选名。
- **新项目引导**：在**顶层**会话中，如果项目目录里没有 `AGENT.md`/`AGENTS.md`/`CLAUDE.md`
  （大小写不敏感），`mpd-project-init` 宿主行会写入一份通用的英文 `AGENT.md`（带显眼的溯源注释，
  不编造事实），同时写入 `<ws>/.mpd/project-init.json` 标记和一行
  `<ws>/.mpd/logs/mpd-project-init.log` 日志。它用 `wx` 写入，绝不覆盖；在 HOME 或 `/`、非项目目录、
  以及标记已存在时保持静默。它写入的文件从**下一个**会话开始才会被注入。
- **原生工具呈现**：harness 自带的工具（bash/read/edit 等）直接暴露。
- preset 的人设解释了专家名册、团队模式与 workmate 库（见下文），因此智能体无需额外配置就能
  正确路由。

## 3. 按用途划分的工具

| 你想做的事 | 工具 | 说明 |
|---|---|---|
| 探索代码库 | `mcp__ast_grep__*`（结构化检索/改写）、`mcp__lsp__*`（cclsp：定义、引用、实现、诊断、悬停、工作区符号、调用层级、重命名）、`mcp__codegraph__*`（项目代码图） | MCP 工具服务器；它们的工具以 `mcp__<server>__<tool>` 形式出现。另外两个家族 **默认不可用**：`mcp__git__*`（git 工具箱，28 个工具）与 `mcp__shell__*`（`run_process`，裸 shell）。两行都自带 `disabled: true`，因此普通会话里不会出现这类工具 —— 想启用哪一个，就把该行的 `disabled:` 改成 `false`，然后重新安装 bundle。 |
| 安全地修改 | 写入守卫与输出截断（无需配置）、`mpd_hashline_read/edit/format/restore`、`mpd_comment_check` | 哈希锚定编辑在锚点过期时会拒绝写入，而不是写到错误的行 |
| 推进长任务 | `mpd_ulw`（轻量）/ `mpd_ultrawork`（完整纪律：计划关卡、执行轮次、验证关卡），或等价的 `/ulw <objective>` / `/ultrawork <objective>` 命令、`mpd_boulder_start/status/complete/task_timer/plan_progress/plans` | 两个命令会注入 ULW 自治指令 —— 该运行不向用户提问，并在工作确需团队时自行建队；`mpd_boulder_*` 跨会话跟踪某个计划 markdown 文件的进度 |
| 让长任务跨轮继续 | `mpd_goal_status`、`mpd_goal_anchor`、`mpd_goal_finish`（以及宿主的 `/goal` 命令与它的 goal 轮次驱动器） | 见 §13.10：**持久化 goal** 是本 bundle 持续化执行的依据 —— heavy 档 ULW 运行、绑定 plan 的 boulder 工作或 `agent_teams_plan` 批准都会 anchor 一个（`goal.autoAnchor` 覆盖长任务；团队批准则自行 anchor），而当 turn 内引擎提前停下时它会保持启用 |
| 保存记忆 | `mpd_memory_write/read/reflect/reflect_complete/status`、`mpd_memory_save/recall` | 版本库后端可以是 git 或 svn；`mpd_memory_save/recall` 是简单的键值层 |
| 咨询专家 | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona` | 一次性（ONE-SHOT）单次咨询子智能体（报告落定后 activation 即被释放 —— 新问题请用新的 spawn）；只读角色会被禁用写入类工具 |
| 养一个会成长的智能体 | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` | 见 §5 |
| 运行一个团队 | `agent_teams_plan`（暂存计划、扩展它、批准它）、`agent_teams_task`（在任务板上 claim / complete / fail）、`agent_teams_dispatch`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` + **Team** 视图 —— 本 bundle 自己的 Web 团队界面（`/plugins/mpd-team/state`）；会话头部的 **Agent Teams** 面板是 harness 自己的、独立的只读投影 | 见 §6 与 §8 |
| 配置本 bundle | `.mpd/mpd.jsonc`、`mpd_config_get`、`mpd_config_reload` | 见 §9 |
| 扩展本 bundle | `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` | 见 §10 |
| 解析模型路由 | `mpd_modelchain_resolve` | 解析某位专家会使用的 provider/model |
| 查看已结束团队 | `mpd_team_compact_run`、`mpd_team_compact_status` | 已完结团队的压缩审计 |

上表中每个家族在 §13 都有可直接照抄的调用示例，全部斜杠命令列在 §12。

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

以单次咨询方式使用：

- `mpd_roles_list` —— 列出名册。
- `mpd_role_spawn { role, task, context? }` —— 一次性（ONE-SHOT）单次咨询：一次有界委派、一份报告；
  子会话保留该角色的人设与模型路由，并以角色名称为 label；报告落定后适配器会释放 activation，因此这次
  咨询**不会**被复用 —— 新问题请用**新的** spawn（harness 的 catalog 只追加，所以已落定的子会话仍可能
  以 `inactive` 列出，但契约就是一次性的）。只读角色会被机制性地禁用写入类工具。
- `mpd_role_persona { role }` —— 取出完整人设文本（例如传给只接受文本人设的 spawn 接口）。

按工作量大小挑选工具：小而机械的改动交给 **Junior Engineer**，边界清晰且独立的一块交给
**Senior Engineer** 或 **Deep Worker**，证据类问题交给 **Researcher** 或 **Explorer**，需要结论时交给
**Reviewer**。每次 spawn 只要**一个**交付物 —— 专家返回的是结果而不是推理过程 —— 值得反复复用的就
提升为 workmate（§5）。

## 5. workmate 库（持久、会演化的专家）

名册只是 **基础模板**。当你会在多个会话中反复使用某位专家时，把它实例化成一个 *workmate* ——
`~/.mpd/workmate/` 下的一份持久副本（在你的 HOME 中，跨项目），拥有独立名字。

```text
mpd_workmate_init   { base: <功能名>, name?: <独立名字>, note? }
  → 创建 ~/.mpd/workmate/<name>/{meta.json, persona.md, memory.md, note.md}
```

`base` 是专家的**功能名**（如 `Deep Worker`，而不是名册 id —— id 属于内部信息，会被拒绝）。
省略 `name` 时，实例名由该功能名自动派生（`Deep Worker` → `deep-worker-1`）。`meta.json` 会把
内部 `baseId` 记为溯源信息，但任何工具输出、路由或界面都不会暴露它。

| 工具 | 用途 |
|---|---|
| `mpd_workmate_list` | 列出实例（name、baseName、uses、updatedAt、note） |
| `mpd_workmate_spawn { name, task, context? }` | 一次性（ONE-SHOT）单次咨询：workmate 以自己的模型路由执行一次有界委派，并带上其演化后的人设 + 独立记忆 + 说明卡；报告落定后 activation 即被释放（持久连续性保存在 workmate 的**记录**里，而不是子会话）；它被要求在最终汇报前调用 `mpd_workmate_reflect` |
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

**当 workmate 正在被使用时，这两种改动都会被拒绝** —— 无论是仍有 `mpd_workmate_spawn`
在运行，还是存在**旧版**团队记录（`.mpd/team/` 下未归档的记录中出现了它的名字；跑在官方插件上的
团队不会留下这种记录）。拒绝信息为
`409 in-use`，并列出阻塞的团队 id 与成员，因此是可行动的：结束正在运行的 spawn（或清理那些旧版
记录），然后重试。同一
道门也覆盖重命名的 **目标名**，所以把 workmate 重命名为某个已被记录为在用的名字也会被同样拒绝。

## 6. 团队模式

**团队平面是 mpd 的 RECORD**，而不是官方插件：成员名册、任务板与每个任务都存放在
`.mpd/team/teams/<id>.json`，由 `mpdTeams` 提供。本 bundle 的 `mpd-agent-team` /
`mpd-tool-agent-team` / `mpd-ui-agent-team` 三行提供队友的**执行**与 **UI** 面 —— 官方服务及其
九个面向模型的工具，以及 Web 端的名册/任务板面板 —— 其中两个执行行在 TUI 组合里被**禁用**：
dsh-tui 宿主拒绝团队服务那个绑定在 root 上的投影（行清单见 [`design.md`](design.md)）。五个官方
撰写动词 —— `spawn_teammate`、`team_task_create`、`team_task_list`、`team_task_get`、
`team_task_update` —— 在工具边界被**拒绝**，所以下面的计划是唯一的门。这个闭合止步于**工具**
边界：某一行直接调用团队**服务**（官方执行器回退路径）不构成工具调用，因此**不受**门禁 —— 这是
唯一声明的边界。你的会话智能体就是 **Lead**（captain）：它 stage 计划、spawn 具名队友、把任务
开在 mpd 任务板上，并亲自整合结果。

```text
agent_teams_plan { action }                                                # 仅 Lead：create | add_member | create_task | edit | approve | delete | status
agent_teams_plan { action: "add_member", member } / { action: "create_task", task }   # 仅 Lead；每个任务都要声明 blocked_by 或 independent
agent_teams_plan { action: "status" }                                      # 计划与任务板上的每个任务
agent_teams_task { task_id, action, expected_revision? }                   # 任务板：claim | contract | depend | release | complete | fail
agent_teams_dispatch { action: "run", limit?, dry_run? }                  # 把就绪任务与空闲成员配对
send_message { agent_id, message } / list_agents { } / wait_agent { timeout_ms }
interrupt_agent { agent_id }                                              # 仅 Lead
```

- **暂存的就是一份需要你批准的计划，而且它跑在「我们的」平面上。** 在 `team.gate: "mechanical"`
  （默认）下，会话起点的复杂度门会通过 `agent_teams_plan` 工具 **stage 一个可批准的 plan shell** ——
  0 成员、0 任务，且处于**惰性**状态：不会 spawn 任何东西。captain 扩展它
  （`add_member` / `create_task`），再用 `agent_teams_plan {action:"approve"}` 批准 —— 这才是
  spawn 成员并发布任务的动作；`action:"status"` 读回计划，`action:"delete"` 将其归档。这个 plan
  平面是**我们的**（`mpd-team-core`），而 mpd RECORD 是唯一的任务板：`agent_teams_task` 驱动它，
  `agent_teams_plan {action:"status"}` 把它读回来。五个官方撰写动词 —— `spawn_teammate`、
  `team_task_create`、`team_task_list`、`team_task_get`、`team_task_update` —— 在工具边界被
  **拒绝**，所以上面的计划是唯一的门。若 `team.gate: "advisory"`，或 `agent_teams_plan`
  没有挂载，门就不会 stage 任何东西，只用一条通知说明，并由 captain 在工作确需团队时自行建队。
- **敏感度决定阈值。** `mpd.jsonc` 里的 `team.sensitivity` 取 `easy`（**默认**）| `normal` | `strict`；
  未知或缺失的值一律解析为 `easy`。`easy` 保留工作区规模信号 F 并更早触发；`normal` 精确复现
  2026-10-22 之前的五信号行为；`strict` 收紧每一项阈值：

  | 敏感度 | B 不同交付动词 | C 行 / 动词 / 子句（三取二） | E 汉字数 / 动词 | F 工作区规模 |
  |---|---|---|---|---|
  | `easy`（默认） | ≥ 2 | ≥ 2 / ≥ 2 / ≥ 2 | ≥ 24 / ≥ 2 | 开 |
  | `normal` | ≥ 4 | ≥ 3 / ≥ 3 / ≥ 3 | ≥ 60 / ≥ 2 | 关 |
  | `strict` | ≥ 6 | ≥ 4 / ≥ 4 / ≥ 4（三取三） | ≥ 80 / ≥ 3 | 关 |

  信号 F 是一次**有界**的根目录 `readdir`（绝不递归）：存在一个项目清单**且**存在一个项目目录**且**
  至少有 8 个可见条目。它只在 `easy` 下评估，而且刻意粗糙 —— 在大工作区里，仅 F 一项就会让 `hello`
  也触发。因此静默的负向对照放在**很小的**工作区里（空提示或 `hello`、以及 `验证一下` 都不会 stage）。
- **一次批准启动三套机制。** 在 `agent_teams_plan` 批准**成功**路径上，团队真正激活之后，同一次批准还会
  anchor 一个持久化 goal（objective = 计划描述；描述为空时回退到计划名称，来源 `team`），并用 `todo_write` 按计划任务写入待办
  （每个任务一条 pending；整表替换；计划没有任务时不写入）。两个副作用都是非致命的 —— 失败只记一行日志，
  绝不让批准失败 —— 且不新增任何旋钮。
- **captain 的侦察与委派守卫重新开启（2026-10-20 恢复）。** 在 `mpd` preset 的**顶层**会话里，
  `captain.investigation`（默认 `deny`）拒绝在**源码**路径上使用 `read` / `grep` / `glob` ——
  文档带仍然可读 —— `delegation.gate`（默认 `deny`）拒绝 harness 自带的通用 spawn 工具
  `subagent`、`subagent_fork` 与 `workflow`，并在拒绝里点名获准的通道（`mpd_role_spawn`、workmate
  库、Agent Teams）。委派门是**按 preset 划定范围的**：别的 preset 的顶层会话（包括部署默认的
  `cordis`）会被放行，而 `mpd` captain 与每个成员/子会话无论跑哪个 preset 都仍被覆盖。
  `write` / `edit` / `bash` **不受**该门限制，验证法则的写入守卫（`verify.mode`）仍处于撤销状态：
  由 captain 写代码，由**另一个**智能体记录判决。两个旋钮都在 `mpd` 设置命名空间下（§9）：
  `captain.investigation` 取 `deny` | `allow`，`delegation.gate` 取 `deny` | `captain`（仅顶层会话）| `allow`。
- **任务板的 compare-and-set 是不对称的。** `release` 与 `complete`/`fail` 会遵守
  `expected_revision` —— 过期值会被拒绝，并同时返回两个 revision 且不写入；`claim`、`contract`
  与 `depend` 不读它，所以 `claim` 总是从自己读到的最新状态冻结一个新的 attempt。
- **`write_scopes` 从不授权写入，而 mpd RECORD 平面上无序的重叠会被拒绝。**
  在 mpd RECORD 平面上，`agent_teams_plan {action:"approve"}` 会**拒绝**两个声明写范围重叠、且彼此
  之间没有依赖路径的任务，并点名这一对与两条补救方式 —— 补上依赖边，或让两个范围互不重叠；在官方
  （OFFICIAL）平面上重叠只是提示，不是锁。`claim` 从不授权写入，而 bash/格式化器/代码生成器会绕过
  一切检查 —— 这就是那条已声明的边界 —— 由 Lead 协调归属并审阅最终 diff。
- **消息是持久的。** `send_message` 回答 `accepted`（已投递）或 `queued`（已落盘、排队中），排队
  中的消息绝不要重发。`list_agents` 报告每位成员的 `agent_id` 与可用状态（`inactive` 表示当前没有
  轮次在执行，不是工作已完成）；当没有其他成员在运行或创建中时，`wait_agent` 立刻回答
  `noProgress`。
- **只读成员就是只读的。** Architect、Researcher、Planner、Explorer、Plan Reviewer 与
  Vision Analyst 会被拒绝那八个写入工具：`mpd_role_spawn` 通道通过 `toolFilter.deny`，团队通道通过
  `mpd-roles-plugin` 里以团队身份为键的工具守卫 —— 因为团队的 spawn 接缝不接受按队友的
  工具过滤器。工作者（Senior Engineer、Junior Engineer、Deep Worker、Lead、Reviewer）负责实现与
  验证。
- **槽位是名册成员唯一的路由来源 —— 而且不再有内置默认层。** 一切路由都来自该成员的
  `teamModels.slot{N}`：配置好的 `provider` + `model`、可选的 `reasoningEffort`，以及该槽位**自己**的
  可选 `fallbacks` 链。`agentRoutes` 已**删除**：旧文件里残留的块会被忽略，且永远不会被改写。未配置
  （或叶子格式错误）的槽位会用一个结构化的 `SLOT_UNCONFIGURED` 错误**拒绝单次 spawn**，点名槽位、它路由的
  成员、缺失的叶子与两条修复路径 —— 不写入任何内容，也不启动任何子会话。回退链在 spawn 之前**只消费
  一次**：模型目录**正面列出**的第一条路由胜出（「未被列出」不等于「不可用」），胜出者再经过推理强度适配。
  **四个槽位**同时作用于这些单次咨询**和团队成员**：团队执行器按身份优先级 **`role` → `description`
  的头部 → 整个 `name`** 解析成员的槽位。匹配不到的成员、或槽位未配置的成员，会**继承暂存它的那个
  会话的路由**（顶层 spawn 是 captain 的，team-lead spawn 是 Lead 的），只记一行日志、**绝不抛错**——
  槽位绝不会让团队半途而废。`mpd-roster-provider` 只服务于官方 `spawn_teammate` 通道，而该通道被
  团队门禁拒绝，所以在默认组合里它不路由任何东西。
- **由 workmate 背书的成员是一段提示词，而不是自动注入。** 现在已经没有任何东西会把某个 workmate
  的人设自动带进队友：先初始化或挑出该 workmate（`mpd_workmate_init` / `mpd_workmate_match`），
  读出它应当携带的内容，再把那段文本放进 `agent_teams_plan {action:"add_member"}` 的提示词；事后用
  `mpd_workmate_reflect` 记录结果（§5）。
- **扩展 role 不是团队成员**：扩展可以贡献一个能被 `mpd_role_spawn` / `mpd_role_persona` 使用的
  role，但队友名册就是 captain 按名字创建出来的那些人，所以扩展 role 不会自己变成队友（见 §10）。

### 调用形态

```text
# 在计划上创建一个队友和它的一条任务
agent_teams_plan { "action": "add_member", "member": { "name": "senior-1", "description": "Owns the README pair", "prompt": "<人设 + 任务>" } }
agent_teams_plan { "action": "create_task", "task": { "subject": "重写安装章节", "description": "…", "blocked_by": [], "write_scopes": ["README.md"] } }

# 操作任务板（任何成员）
agent_teams_plan { "action": "status" }
agent_teams_task { "task_id": "T3", "action": "claim" }
agent_teams_task { "task_id": "T3", "action": "complete", "expected_revision": 3 }
agent_teams_dispatch { "action": "run" }

# 协调
list_agents { }
send_message { "agent_id": "senior-1", "message": "先落 README 的修改，再做使用者指南。" }
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "agent_id": "senior-1" }     # 仅 Lead：停下当前轮次，保留收件箱
```

§13.1 是可照抄的完整走法 —— 创建成员与任务、操作任务板、改派、收尾一波。
`session-watchdog-*` 是另一套独立的内层停滞检测实现（见 §12 与 [`tui.md`](tui.md)）。

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
—— 本 bundle 是**第三层** patch 层 —— 而 `mpd` 只是**可用**的 preset，**不是**默认：部署默认仍属于
host，直到你选择 `mpd` 为止（TUI 的 `/preset mpd`、Web Settings 的 `selectedDefault`，或
`node scripts/set-default-preset.ts --yes` —— 见 [`preset-default.zh-CN.md`](preset-default.zh-CN.md)）。
宿主需要真实终端：stdout 不是 TTY 时 `dsh-tui` 拒绝启动
（`dsh-tui requires an interactive terminal (stdout must be a TTY)`），所以永远不要用管道驱动它。

### 7.1 TUI 原生界面与对应的 Web 界面

| Web 界面 | TUI 等价物 |
|---|---|
| **Team** 视图 —— bundle 自己的侧栏页面，由 `/plugins/mpd-team/state` 提供；会话头部的官方 **Agent Teams** 面板是另一个只读投影，没有 TUI 对应物 | `tuiPanels` 侧栏页面（`MPD`，用 `alt+a` / `/mpd panel` 打开）—— `tuiScenes` 全屏看板 + 带 key 的 `tuiStatus` 状态行仍是回退 |
| Workmates 侧边栏标签页 | `tuiPanels` 的 `workmate` 页面，外加 `/mpd` 命令树（`tuiCommandTrees`）与 `tuiDialogs` |
| 设置 → MPD 栏 | `/settings` 分区（`tuiSettingsSections`） |
| — | `tuiShortcuts` 快捷键 |

这些是**等价物，不是等价功能（parity）**：每个界面都重建在宿主自身的 TUI 接缝上，且有两个接缝被明确
声明为未主张 —— 宿主不提供 prompt 插槽（`tuiPrompt` 宿主不可用），也不为 bundle 的 renderer 事件投射
任何 transcript 行，因此 prompt 插槽与 transcript 行都不作主张。完整清单位于
[`tui.zh-CN.md`](tui.zh-CN.md) §10 NOT-CLAIMED。

### 7.1.1 侧栏面板：注意力徽标、自动打开，以及自己掌管清单的宿主

- **注意力徽标由插件侧发布，而不是由页面发布。** 面板通过 `tuiPanels.badge` 携带徽标，统计**当前
  显示的那个团队**的看门狗 hold。它从行的 apply 路径设置，因为 dsh-tui 只在某个插件面板是活动页时
  才挂载它 —— 页面侧的徽标只能装饰你正在看的那个页面。武装后的第一次发布包含空状态，这正是清掉上一
  次运行遗留的陈旧徽标的方式。
- **`panelAutoOpen`（`mpd-tui` 行的旋钮，默认 `true`）** 每进程**最多打开一次** MPD 页面，触发点是
  团队从 NOT-LIVE → LIVE 的**边沿**：启动时工作区里已有团队不会抢走侧栏；一次性闩锁在面板接缝重绑
  之间共享，所以重绑不会开第二次。宿主的拒绝（dsh-tui 对每个插件的 `open()` 有速率限制）会在下一次
  团队状态变化时重试；宿主若根本不暴露 badge 成员，则永不重试。`panel` 与 `workmate` 两个行旋钮
  分别独立关闭两个页面。
- **在 dsh-tui ≥ 0.16.1 上部署是 STATELESS 的。** 该宿主**自己掌管**侧栏启用清单：它的注册表在注册时
  启用面板、在 dispose 时移除，并在每次 apply 时把已注册 id 并回去，因此本 bundle 的启用保持器变为
  **只读** —— 取消阶梯、不装 feed、不装腰带，连陈旧默认迁移也跳过。在 0.15.x 上保持器加入宿主自愈，
  只保留唯一一次写入（陈旧默认迁移）；0.15 以下仍是 feed-first。`/mpd status` 报告部署情况：宿主分配
  的面板 id、接缝状态与保持器的结论。

### 7.2 `/settings` 界面与 `mpd.jsonc` 桥接

`/settings` 编辑真实的 `mpd.jsonc` 旋钮 —— 共 26 个（原有 13 个、十二个 `teamModels` 槽位叶子，再加
TUI 界面自身的一个旋钮；槽位叶子是只可选择字段，选项来自实时模型目录，回退到声明列表），
其中包括 `hashline.maxDiffChars`、
`commentChecker.autoCheck`、`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir` —— 通过
harness **自带的**表单编辑这一行的 config entry（`configForms.get("mpd-config")`；Web GUI 卡片用的是
同一个 entry）。**在本 bundle 所固定的这个 harness 上，entry 保存由宿主持久化，且不会执行任何
`<workspace>/.mpd/mpd.jsonc` 写入**：保存下来的 override 就是最顶层的配置层，并在进程内生效；而把表单
物化出的默认值投影进你的文件会污染它。文件回写属于**已退役**的 settings 命名空间路径——
`packages/mpd-config-plugin` 仍实现它，但该 harness 上 `settingsRegister` 会被拒绝，因此这条路径处于
**休眠**状态。

在依赖它之前需要知道两件事：

- **保存即在运行中的进程里生效。** 配置服务在每次设置保存时、以及监听到
  `<workspace>/.mpd/mpd.jsonc` 被编辑时都会重新解析，而模型配置旋钮（`modelchain.*`、
  `teamModels.slot*`）是**每次使用**时读取的，因此保存后的改动会到达下一次
  `mpd_config_get`、`mpd_modelchain_resolve` 或 spawn，**无需重启**（`mpd_config_reload` 可强制重读）。
  其余旋钮仍适用挂载时捕获的规则 —— §9.1 逐个旋钮说明。
- **旧命名空间回写路径有两个具名跳过场景（在本 harness 上已休眠）。** 这条路径本身不携带工作区身份，
  所以它的写入目标是保存那一刻存活的会话工作区：没有任何存活会话时，保存只写入宿主 settings 文档并报告
  `no-live-session`；有**多于一个**存活工作区时会被拒绝为 `ambiguous-multi-root`，并逐一列出候选。这两种
  情况下**不会改动任何文件**，而值**不会丢失**——它保存在 settings 文档中，配置层立即对所有工作区生效；
  只有文件写入在等待"恰好一个"存活会话。**entry 保存永远不会走到这段代码。**

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

- **Team**（本 bundle 驱动的团队界面，也是权威界面）：bundle 自己的侧栏页面（页签 id `mpd-team`，
  标题 **Team**）通过 bundle 自己的 `/plugins/mpd-team/state` 路由读取
  `<workspace>/.mpd/team/teams/<id>.json`，因此渲染的就是 mpd RECORD：团队的身份与阶段、带模型路由与
  每人任务数的名册、任务板的任务 DAG（§8.1），以及批准前的待批计划。它从不读官方服务的投影，而 TUI
  渲染的是同一份记录（§7.1）。它会注册进当前组合所提供的那个侧边栏宿主（见下文）。
- **Agent Teams**（另一块界面，只读 —— harness 自己的，不是团队界面）：官方客户端插件
  `@deepseek-ai/dsh-experimental-client-ui-agent-team`（由本 bundle 的 `mpd-ui-agent-team` 行挂载）
  在会话头部增加一个 **Agent Teams** 动作。它读的是共享会话存储里 Lead 会话的 `agentTeam` 投影 ——
  那是**官方服务**的投影，不是 mpd RECORD —— 所以面板打开期间名册或任务变化就会刷新。它列出名册
  （持久名字与阶段：`running`、`inactive`、`provisioning`、`failed`）与共享任务板（任务标识、归属、
  前置、就绪状态、提示性写入范围与重叠警告 —— 那是官方（OFFICIAL）平面的读法，重叠在那里只是
  提示，而 Team 页面所渲染的 mpd RECORD 任务板会**拒绝**无序重叠，见 §6），并能跳进某位队友的
  会话。它是**只读**的：面板不能创建、改名、删除或中断队友，也没有任务修改控件 —— 那些属于
  §6 里的工具。它不展示点对点消息，只展示名册与任务。如果插件是在一个已经
  打开的会话里才启用的，刷新一次页面以接收投影。在 TUI 组合里官方服务那两行
  （`mpd-agent-team`、`mpd-tool-agent-team`）被禁用，因此这块面板没有 TUI 对应物。
- **Workmates 侧边栏标签页**：workmate 库作为标签页贡献给 **DSH-better-sidebar**
  （社区侧边栏 bundle，存在时才挂载的可选 peer），因此它和该侧边栏
  自己的页面在一起 —— 标签条、`+` 菜单，以及侧边栏自己的启用/禁用开关。页面列出
  `~/.mpd/workmate/` 中的实例（base、uses、updated、note），支持筛选、打开查看某人设/记忆/说明卡，
  并可以从 **基于名册的 base 选择器**（不需要手输 id）加上可选名字与说明卡来新建一个实例。它还可以
  **重命名** 与 **删除** 选中的实例 —— 删除流程是显式的（先确认，再归档，然后还有一个需要输入
  完整名字才能永久清除的步骤），两种操作都做了 zh/en 本地化。它读取并调用宿主路由
  `GET /plugins/mpd-workmate/{list,roster,get}` 与
  `POST /plugins/mpd-workmate/{init,rename,delete}`。侧边栏 **标签条上的文字** 仍然保持英文
  `Workmates`（这是一个已记录的推迟项：标签条文字的解析处没有本地化翻译器）；页面正文跟随你的语言。
- **workmate 页面住在哪里**：它是一张侧边栏页面。社区宿主是**可选 peer**，bundle 从不安装它 ——
  `mpd-better-sidebar` 行在 `dsh-better-sidebar` 可解析的位置挂载它，否则自行禁用 —— 因此也不欠你
  第二次手动安装：没有该宿主时，**同一张**页面会注册进 **HARNESS 自带的**右侧边栏并保持可访问；若
  连侧边栏接缝都不存在，mpd 各面板会各自按名字报告一次。团队工作仍然可以通过 mpd record 上的
  `agent_teams_*` 任务板运行（§6），workmate 库也仍然可以通过 `mpd_workmate_*` 工具完整使用。
- **社区宿主存在时有两个侧边栏表面（0.28）**：每张 mpd 页面 —— Team 视图、Workmates 库与
  AgentTeams 看门狗 —— 都会向 `dsh-better-sidebar` 注册**两次**：主标签页（`mpd-team`、
  `mpd-workmate`、`mpd-agent-teams`）以及一个**底部工作台孪生**（`mpd-team:bottom`、
  `mpd-workmate:bottom`、`mpd-agent-teams:bottom`）。孪生复用同一份正文、标题、图标与排序，并标记
  `bottomOnly`，因此只出现在插件自己的底部工作台、不会出现在别处；主标签页仍留在侧边栏标签条。孪生
  按 id 幂等，且**仅当**社区宿主存在时才注册 —— 没有该宿主时走官方右侧边栏回退，回退标签页与主
  标签页保持相同的标题、guide 与描述。以上都不会改变 `mpd_*` 工具，也不改变页面读取的路由。

### 8.1 Team 视图的任务 DAG

Team 视图的这张图按团队状态提供的 rank 布局：每个 rank 一列，按 rank 顺序排列，每一列的节点栈
都以整张图的水平中线为中心对齐，因此短列与长列处在同一水平高度。跨 rank 的边不会横穿节点
卡片 —— 它从图上方或下方的通道绕行，两条通道以中线为轴镜像，再汇入目标节点。相邻的连接线各走
独立车道，不会有两段直线重叠。任务或 rank 变化时图形会重新计算，节点位置随之过渡。

只有 **completed → running** 的边有动画：一个小箭头沿路径移动，同时虚线段向前流动，让任务板上的
推进方向一眼可读。其余边保持静止，整张图不做动画。

节点卡片使用毛玻璃表面。处于 **running** 的节点会带呼吸式光晕，但光晕画在卡片边缘，文字与边框
保持稳定，标签始终清晰可读。系统启用 `prefers-reduced-motion` 时，呼吸效果关闭。

把指针悬停在节点上，光标旁会弹出一个小圆角卡片：半透明白底、黑字，显示状态、归属、已用时间、
截断后的任务标题与进度条。点击节点会将其固定（pin），之后再悬停时卡片变为不透明；鼠标离开即
关闭。图下方原有的「点击固定」详情面板保持不变。

卡片上的已用时间与进度各有明确的边界。已用时间来自任务的 `startedAt` 与 `finishedAt`
时间戳（running 任务算到当前时刻）；没有起始时间戳的旧任务显示破折号，而不是猜一个时长。进度条
是粗粒度的状态推导值 —— completed 100、running 50、claimed 10、pending/failed/cancelled 0 ——
不是实测的工作量。

这一波不提供缩放、平移或小地图；图的布局由 bundle 自己计算，不引入图形布局库。

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
| `goal.enabled`、`goal.autoAnchor`、`goal.autoRounds` | mpd-goal | 持久化 goal 桥：总开关、长任务是否自行 anchor goal、自动 anchor 的轮次上限（默认 `true` / `true` / `32`）。见 §13.10 |
| `extensions.enable`、`extensions.disable` | mpd-ext | 按 id 的扩展启用/禁用列表（进程级：见 §10） |
| `extensions.mcp.*` | mpd-ext | MCP 桥默认值：`enabled`、`connectTimeoutMs`、`toolCallTimeoutMs` |
| `modelchain.*` | mpd-modelchain | 各名册角色的 provider/model 链 |
| `team.stateDir` | 读取旧版团队记录的 mpd 插件（看门狗 web 路由、压缩、TUI 团队界面、workmate 在用检查） | 这些记录的位置（默认 `.mpd/team`）。官方团队插件不读它 |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate / mpd-dsh-adapter（原生团队执行器）/ mpd-roster-provider（官方回退）（经 mpd-config） | 四个**团队模型槽位**：每个槽位是**一条**配置好的路由 —— `{provider, model, reasoningEffort?}`，外加该槽位**自己**的可选 `fallbacks: [{provider, model, reasoningEffort?}, …]`（按优先级排列）。**不再有任何内置默认层**（`TEAM_MODEL_SLOT_DEFAULTS` 已删除）：工作区从未配置的槽位**没有**路由，它要路由的每一次单次 spawn 都会被**拒绝**，并给出一个结构化的 `SLOT_UNCONFIGURED` 错误，点名槽位、成员、缺失的叶子与两条修复路径（`/mpd-model`，或 `.mpd/mpd.jsonc` 里的 `teamModels.slotN`）—— 不写入任何内容，也不启动子会话。回退链在 spawn 前**只消费一次**：实时目录**正面列出**的第一条路由胜出（「未被列出」不等于「不可用」；没有任何正面列出时主路由保留），胜出者随后经过推理强度适配，格式错误的条目会被丢弃并记一行日志 —— 绝不致命。槽位 1 路由 Architect/Planner/Reviewer/Lead/Senior Engineer，槽位 2 路由 Researcher/Explorer/Plan Reviewer，槽位 3 路由 Deep Worker/Junior Engineer，槽位 4 路由 Vision Analyst —— 视觉成员，其槽位模型**必须支持图像输入**。团队成员的槽位按身份优先级 `role` → `description` 的头部 → 整个 `name` 解析；匹配不到名册成员的、或槽位未配置的成员，会**继承暂存它的会话的路由**（§6），只记一行日志、绝不抛错；`mpd-roster-provider` 只在官方执行器回退通道上路由，而该通道在默认组合里被团队门禁拒绝。推理强度永远不会被悄悄钳制；唯一例外是模型在目录里完全没有推理等级 —— 则不发送任何等级，spawn 照常运行。**初始配置是文件初始化，不是运行时默认值：** 若工作区的 `.mpd/mpd.jsonc` 未声明 `teamModels`，挂载时会**只播种一次**：通过 LLM 目录从你已配置的提供商中选取模型（`deepseek-flash` 家族；槽位 1 为 `max`，槽位 2-4 为 `high`），已存在的块或用户编辑**永不改写**；成功的播种会在 `<workspace>/.mpd/model-config-seed.json` 中留下**持久标记**（只创建一次、永不覆盖、在任何尝试之前先检查），因此你**故意删除**的块**永远不会**被重新播种；目录不可用时不写任何内容，第一次 spawn 报告 `SLOT_UNCONFIGURED`。可在 **设置 → MPD** 与 TUI 的 `/settings` 区块中作为只可选择字段编辑（未配置的槽位渲染为 `<unconfigured>` 并列出缺失的叶子）；保存后的改动在运行中的进程里被重新读取，无需重启（`mpd_config_reload` 可强制重读）。 |

`mpd-codegraph` 刻意不在上表中：它的 `autoInit`、`initTimeoutMs`、`cooldownMs` 与 `binary` 来自
它的 **bundle-patch 行** 配置（在 apply 时读取），没有任何插件通过 `mpd.jsonc` 读取
`codegraph.*` 键。它的行在 `cordis.patch.yml` 中自带 `autoInit: true` 与
`initTimeoutMs: 60000`。

### 9.1 保存的旋钮何时生效

这是使用者最容易搞错的一点，所以逐个旋钮说清楚。总规则：消费方在 **挂载**（`apply()`）时通过
`mpdConfig` 服务读取配置，因此对**大多数**旋钮而言，一个变化了的值 —— 无论是手工编辑 `.mpd/mpd.jsonc`
或 `$DSH_HOME/mpd.jsonc`，还是通过 **设置 → MPD** / TUI 的 `/settings` 界面保存 —— 要等
**`dsh` 重启**之后才会改变插件的**行为**。模型配置旋钮是例外。

有三件事不必等这次重启，而且都很有用：

- **模型配置旋钮在进程内实时刷新。** 配置服务在每次设置保存时、以及监听到
  `<workspace>/.mpd/mpd.jsonc` 被编辑时都会重新解析，而模型路由（`modelchain.*`、`teamModels.slot*`）
  是**每次使用**时读取的，因此下一次 `mpd_modelchain_resolve` 调用、或下一次单次咨询
  spawn / workmate spawn / 队友启动都会携带新路由，无需重启。`mpd_config_reload` 仍是需要强制重读时的
  手动兜底。
- **回读永远是即时的。** `mpd_config_get` 与 `mpd_config_reload` 每次调用都重新读取各层并立刻报告
  新的解析值 —— 这是你确认编辑确实落地的办法，即使已挂载的消费方仍持有它挂载时捕获的值。
- **`watchdog.*` 从文件实时重读——表单保存到不了这些旋钮。** 看门狗在挂载时、收到**旧 `mpd` 命名空间**的
  `settings/document-updated` 时（本 bundle 固定的 harness 上命名空间模型已退役，因此该事件不会触发）、以及每个
  tick 都会重新解析自己的旋钮。真正能实时到达它的是 `<workspace>/.mpd/mpd.jsonc` 的编辑：该行在每次解析时
  自己解析这个文件，并在**本进程内**应用发生移动的那一层、无需重启。经 `/settings` 或 Web 卡片的保存写入的是
  `mpd-config` **entry** 文档，而该行不读它，因此这些旋钮保持旧值；要改就读文件，或改
  `mpd-team-watchdog` 行配置（需要一次启动）。`session-watchdog-status` 会打印每个旋钮的 LIVE vs FILE 取值
  以及 `restartRequired` 标志。

| 旋钮 | 谁读取 | 何时读取 | 何时生效 |
|---|---|---|---|
| `hashline.*` | mpd-hashline | 挂载时 | `dsh` 重启后 |
| `commentChecker.*` | mpd-comment-checker | 挂载时 | 重启后 |
| `ulw.*` | mpd-ulw | 挂载时 | 重启后 |
| `goal.*` | mpd-goal | 挂载时 | 重启后 |
| `memory.*` | mpd-memory | 挂载时 | 重启后 |
| `boulder.dir` | mpd-boulder | 挂载时 | 重启后 |
| `modelchain.*` | mpd-modelchain | 每次调用，从实时服务读取 | 实时生效 —— 无需重启：每次 `mpd_modelchain_resolve` 都会重读该 overlay，因此设置保存或文件编辑会改变下一次解析；`mpd_config_reload` 可强制重读 |
| `extensions.enable` / `.disable` / `.mcp.*` | mpd-ext | 插件启动时（进程级） | 重启后 |
| `team.stateDir` | 读取旧版团队记录的 mpd 插件，经实时服务解析 | 每次调用 | 服务重新读取文件之后立即生效（`mpd_config_reload`，或任意一次设置保存）。这些是**旧版**记录：官方团队插件把名册、邮箱与任务板保存在 Lead 的会话日志里，不在这里 |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate（单次咨询通道 `mpd_role_spawn`、`mpd_workmate_spawn`），mpd-dsh-adapter（原生团队执行器：每个团队成员），以及 mpd-roster-provider（仅官方执行器回退） | spawn 时，从实时服务读取 | 实时生效，无需重启：设置保存或手工编辑 `<workspace>/.mpd/mpd.jsonc` 都会在进程内被重新读取，因此下一次 spawn 即携带新值；`mpd_config_reload` 可强制重读。每个槽位**只有一条**路由、没有默认层：未配置或格式错误的槽位会用 `SLOT_UNCONFIGURED` **拒绝单次 spawn**（不写入任何内容、不启动子会话），而团队成员绝不因槽位失败；该槽位自己的 `fallbacks` 链在 spawn 前被消费一次。团队成员的槽位按 `role` → `description` 的头部 → 整个 `name` 解析；匹配不到名册成员的、或槽位未配置的成员，会**继承暂存它的会话的路由**，只记一行日志、绝不抛错 |
| `watchdog.*` | mpd-team-watchdog | 挂载时、旧 `mpd` 命名空间的 `settings/document-updated`（此处已退役）、以及每个 tick —— 该行还会自行解析 `<workspace>/.mpd/mpd.jsonc` | 文件编辑实时生效 —— 无需重启；表单保存（`/settings`、Web 卡片）在本 harness 上**到不了**这些旋钮（该行不读 `mpd-config` entry） |

`mpd-codegraph` 的旋钮是反证这条规则的例外：它们是 patch 行选项（`autoInit`、`initTimeoutMs`、
`cooldownMs`、`binary`），只能改行并重新安装。

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
bun scripts/mpd-ext.ts validate <dir>     # 退出码 1，并逐条打印问题
bun scripts/mpd-ext.ts scaffold my-ext --dir /tmp   # 从一个可工作的骨架开始
```

**诚实的边界。**

- **会话级扩展只能增加 skills 与 flows。** 工具与 provider 的注册是进程级的，因此工作区级清单
  若声明 `mcp` 或 `roles`，会按条目被拒绝并给出明确原因 —— 绝不会半加载。
- **没有 reload。** 修改扩展的 manifest 或资源后，会在下一次 `dsh` 启动时生效；`mpd_ext_list`
  刻意没有对应的重载工具。
- **扩展 role 不是团队成员。** 它们可以通过 `mpd_role_spawn` / `mpd_role_persona` 使用，也可以
  作为 workmate 的基础模板，但队友名册是固定的：只有 captain 把它按名字加进一份已批准的计划，
  它才是队友。
- **`extensions.*` 配置是进程级的**，在插件启动时读取 —— 它不是按会话隔离的。
- **第四方 MCP 服务器是一个子进程。** 它绝不会从你的宿主环境继承名字形如凭据的变量；它需要什么
  就在 manifest 的 `env` 中声明。

## 11. 故障排查速查

- `mpd_role_spawn` 报未知角色 → 角色按 **名字** 应答（`Architect`、`Deep Worker`、
  `plan reviewer` —— 大小写/空格/连字符写法都可以）；运行 `mpd_roles_list`。
- `mpd_workmate_*` 提示 "mpdRoles service unavailable" → `mpd-roles` 行没有挂载（重新安装
  bundle）。
- workmate 的重命名/删除 **因"正在使用"被拒绝** → 仍有 `mpd_workmate_spawn` 在运行，或 `.mpd/team/`
  下某个**旧版**（0.1.7 之前）未归档团队记录中出现了它。拒绝信息会列出阻塞的团队；等运行中的 spawn
  结束（或手工清理那些旧版记录），然后重试。
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
- 侧边栏缺少 Workmates 标签页 → 重新构建随包客户端（`node scripts/build-mpd-client.ts`，然后
  刷新页面），并确认 profile 中存在某个侧边栏宿主。该宿主是 bundle 从不安装的**可选 peer**；
  没有它时 mpd 各页面会注册进 harness 自带的右侧边栏，若连侧边栏接缝都不存在则各自按名字报告
  一次。如果你想要那个社区宿主，请在检出目录执行 `bun install`（或
  `bun add dsh-better-sidebar@0.28.0 --ignore-scripts`），然后重新安装 bundle。若 profile 里的
  `dsh-better-sidebar` 低于 `0.28.0`，那就在受支持的 peer 范围（`>=0.28.0 <0.29.0`）之外：本行重述
  的是 0.28 的 `["webServer","sessions","connection","tools"]` 注入列表，底部工作台孪生也需要
  0.28 的 `bottomOnly` 描述符字段。
- 会话头部缺少 Agent Teams 面板 → 它的行是 `mpd-ui-agent-team`
  （`@deepseek-ai/dsh-experimental-client-ui-agent-team`，已声明依赖）；重新安装 bundle 并刷新一次
  页面。只有当会话真的有 Team 投影可展示时它才会出现。
- GUI 中完全没有客户端界面 → `mpd-web-compat` 自引用行必须存在，并且需要重新安装 bundle
  （`dsh plugin --profile <p> add <repo-or-package>`）。
- `MISSING_CREDENTIAL` → 该 provider 路由需要在你的 DSH 凭据中有密钥；本 bundle 从不配置密钥。
- AGENT.md 没有被注入 → 会话运行的不是 `mpd` preset；请切换 preset。
- **无法创建任何 `mpd` 会话，错误为 `agent-preset/invalid … $.prefix missing required value`**
  → 已安装的 harness 改变了 `dsh-persona` 契约（它接受 `prefix`，而不是已退休的 `text`），于是
  拒绝挂载整个 preset。更新 bundle（`git pull`，然后 `dsh plugin --profile <p> add <repo>`）
  —— 这是 harness 版本兼容性修复，不是你这边配置的问题。
- **缺少 `mcp__git__*` / `mcp__shell__*` 工具** → 这是预期行为而非故障：`mcp-git` 与 `mcp-shell`
  两行都自带 `disabled: true`。请改用 harness 自带的 `bash` 工具与 git 命令，或把想要的那行改成
  `disabled: false` 并重新安装 bundle。`mcp-git` 行还需要 `PATH` 上有 `git`。
- **`mpd_comment_check` 报告二进制缺失** → 它是需要主动开启的检测器：把
  `@code-yeongyu/comment-checker` 装进 `.toolchain`（`--with-comment-checker`），或把
  `MPD_DSH_COMMENT_CHECKER_BIN` 设为绝对路径。
- **CodeGraph 工具什么都不返回** → 运行 `/mpd-codegraph` 生成 `.codegraph/codegraph.db`，并安装
  `@colbymchenry/codegraph` 或设置 `MPD_DSH_CODEGRAPH_BIN`（它的主拼写 `MPD_CODEGRAPH_BIN`
  会先被读取）。
- **保存的旋钮没有生效** → 模型配置旋钮（`modelchain.*`、`teamModels.slot*`）是 live-refreshed 的：
  用 `mpd_config_get` / `mpd_modelchain_resolve` 重新读取，或用 `mpd_config_reload` 强制重读。
  其余旋钮在挂载时捕获配置，需重启会话 —— 而且 `mpd_config_get` 显示新值**不等于**已挂载的插件已经在
  按它行动（§9.1 说明了哪些旋钮是实时生效的）。
- **升级后某个文档链接 404** → 本次发布**重命名**了设计文档（它原名 `architecture.md`，
  `docs/design.zh-CN.md` 是当前名称的中文版），因此旧版文档副本指向的文件已不存在。重新安装 bundle
  （`git pull`，然后 `dsh plugin --profile <p> add <repo>`）即可拿到重新指向后的文档对。

## 12. 命令参考

会话中可用的全部斜杠命令，以及各自生效的位置。表里有两类：本 bundle **贡献的六条命令**
（`mpd-ulw` 注册 `/ulw` 与 `/ultrawork`，`mpd-codegraph` 注册 `/mpd-codegraph`，`mpd-tui` 注册
`/mpd` 与模型选择菜单 `/mpd-model`，团队行注册 `/agent-teams`），以及本 bundle 只是
**记录**的两条 **宿主命令** —— `/settings`（宿主 TUI 设置界面，其 MPD 区块由本 bundle 扩展）与
`/goal`（宿主 goal 命令，由 `mpd` preset 挂载）。除此之外没有别的命令 —— 特别地，**不存在
`/roster` 命令**（名册要通过 `mpd_roles_list` 工具访问）。

| 命令 | 作用 | 可用位置 |
|---|---|---|
| `/ulw <objective>` | 针对该目标启动 ultrawork 循环 —— 与 `mpd_ulw` 同一引擎，使用较轻的默认档位 | Web + TUI |
| `/ultrawork <objective>` | 与 `/ulw` 完全相同（两者都会把 ULW 激活指令作为你的下一条用户消息提交） | Web + TUI |
| `/mpd-codegraph` | 解析 codegraph 二进制并在 `.codegraph/` 下初始化/刷新项目索引 | Web + TUI |
| `/agent-teams <what the team is for>` | 团队行恰好只注册这一条命令：它按文本 stage 一份需要批准的 plan（在你批准之前不会 spawn 任何人），不带参数调用时打印用法 | Web + TUI |
| `/mpd` | TUI 上覆盖 bundle 状态的命令树：裸 `/mpd` 打开选择器，`/mpd <value>` 直接进入，`/mpd status` 打印摘要 | **仅 TUI** —— 在 Web 下注册被拒绝，什么都不会暴露 |
| `/mpd-model` | 打开宿主的选项列表式模型菜单：依次选择槽位 → 提供商 → 模型 → 推理强度，并把 `teamModels.<slot>.<leaf>` 写入 `/settings` 编辑的同一个配置条目；在任一面板取消都不写入，而没有对话框接缝的组合会说明这一点、不打开菜单 | **仅 TUI** |
| `/settings` | 宿主的设置界面；MPD 区块编辑你的 `mpd.jsonc` | **仅 TUI** |
| `/goal` | 宿主的 goal 命令，由 `mpd` preset 挂载（Web overlay 会禁用宿主自带的 `tool-goal` / `command-goal` 行，因此由 preset 承载） | Web + TUI |

命令名之后是自由文本形式的目标。不带目标的裸 `/ulw` 会打印用法、不会启动任何东西；在无法裁决命令
的表面（headless 运行）上，同样的文本会作为指令提交。

## 13. 配方：可直接照抄的调用

下列每一段都是你或你的智能体真正输入的原文；工具参数是 JSON，工具名是稳定的。这就是"到底怎么
调用"的那一节：当你需要某种具体行为时，直接照着要这个调用。

### 13.1 团队

```text
# (a) 暂存计划：门已经 stage 了 shell，captain 扩展它并批准它
agent_teams_plan { "action": "create", "name": "docs-wave", "description": "重写安装章节", "approval": "required" }
agent_teams_plan { "action": "add_member", "member": { "name": "senior-1", "description": "Owns the README pair", "prompt": "<mpd_role_persona 文本>" } }
agent_teams_plan { "action": "create_task", "task": { "subject": "重写安装章节", "description": "覆盖两个 profile 与打包产物。", "blocked_by": [], "write_scopes": ["README.md"] } }
agent_teams_plan { "action": "create_task", "task": { "subject": "验证 README 文档对", "description": "跑文档关卡并贴出原始输出。", "blocked_by": ["<root task>"], "write_scopes": [] } }
agent_teams_plan { "action": "status" }
agent_teams_plan { "action": "approve" }                              # ← 就是这一步 spawn 成员并发布任务

# (b) 建队：扩展计划，每位成员一条成员记录、每条通道一个任务
agent_teams_plan { "action": "add_member", "member": { "name": "senior-1", "description": "Owns the README pair", "prompt": "<mpd_role_persona 文本> + 重写安装章节。用户要能用一条命令从检出目录安装；用 bun run verify:docs 验证。" } }
agent_teams_plan { "action": "create_task", "task": { "subject": "重写安装章节", "description": "覆盖两个 profile 与打包产物。", "blocked_by": [], "write_scopes": ["README.md"] } }
agent_teams_plan { "action": "create_task", "task": { "subject": "验证 README 文档对", "description": "跑文档关卡并贴出原始输出。", "blocked_by": ["<root task>"], "write_scopes": [] } }
agent_teams_plan { "action": "approve" }                              # ← 就是这一步 spawn 成员并发布任务

# (c) 操作任务板（compare-and-set：`release` / `complete` / `fail` 在更新前重新读一次）
agent_teams_plan { "action": "status" }                                // → 任务板，带 revision
agent_teams_task { "task_id": "T1", "action": "claim" }
agent_teams_task { "task_id": "T1", "action": "complete", "expected_revision": 2 }

# (d) 推动一个正在运行的团队
list_agents {}
send_message { "agent_id": "senior-1", "message": "先落 README 的修改，再做使用者指南。" }
agent_teams_dispatch { "action": "run" }
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "agent_id": "senior-1" }                               // 仅 Lead；收件箱保留

# (e) 收尾一波
mpd_team_compact_run {}
mpd_team_compact_status {}
```

队友名字是永久的，且永不复用。每个 `create_task` 都要回答依赖问题 —— `blocked_by: []` 表示真正的
根任务，`blocked_by: ["<root task>"]` 表示依赖它，另一种写法是 `independent: true` —— 并且在 mpd
record 平面上，`agent_teams_plan {action:"approve"}` 会**拒绝**两个写范围重叠、且彼此之间没有依赖
路径的任务。会话通过这些工具创作的每个任务都活在那份 mpd record 上，所以写范围重叠在那里会被
**拒绝**，而不是「只是提示」。这项闭合止于**工具边界**：直接调用团队**服务**的插件行（官方执行器
回退路径）不是工具调用，**不**受这道门约束 —— 这就是那条已声明的边界。基于过期 `revision` 的任务更新会被拒绝 ——
正是这道拒绝让被改派的任务不再接受迟到的结果。在点名它的计划获得**批准**之前，不存在任何队友；质量纪律则由 captain 写进任务描述里。

### 13.2 ULW 循环与它的关卡

```text
mpd_ulw { "objective": "Make every link in the doc pair resolve" }
mpd_ultrawork { "objective": "Rewrite the install chapter", "tier": "heavy", "strictReview": true, "maxRounds": 4 }
/ulw Make every documented command resolve to a real registration
```

`mpd_ulw` 是轻量别名（档位 `light`、不写计划文件）；`mpd_ultrawork` 跑完整纪律：可选的对抗式
hyperplan 波、使用计划文件时的**计划关卡**（planner + plan review）、按标准逐项推进的执行轮次
（PIN → RED → GREEN → SURFACE → CLEAN）、当存在计划且（`tier: "heavy"` 或 `strictReview`）时的
**验证关卡**（momus 复审，最多 2 次再复审），最后是带逐泳道台账的**最终质量关卡**。状态与台账位于
`.mpd/ulw/<id>`。被激活的运行不会向你提问：它先做三角定位，在工作确需团队时自行建队，然后走完
各道关卡才收尾。

### 13.3 专家（单次咨询）

```text
mpd_roles_list {}
mpd_role_spawn { "role": "Reviewer", "task": "按契约审查 docs/user-guide.md，只报告问题。", "context": "契约要求每个工具家族都有字面调用示例。" }
mpd_role_persona { "role": "Architect" }
```

`role` 按功能**名字**应答（`Architect`、`deep worker`、`plan-reviewer`）。只读角色在 spawn 时会
带上针对恰好 `write`、`edit`、`mpd_hashline_edit`、`bash`、`mcp__ast_grep__rewrite`、
`mcp__ast_grep__scan`、`mcp__lsp__rename_symbol`、`mcp__lsp__rename_symbol_strict` 的禁用过滤
—— 这套纪律是机械强制的，不是口头约定。

### 13.4 workmate 库

```text
mpd_workmate_match { "task": "review a bilingual doc pair for parity" }
mpd_workmate_init { "base": "Reviewer", "name": "doc-reviewer", "note": "bilingual doc parity reviews" }
mpd_workmate_spawn { "name": "doc-reviewer", "task": "审查这份使用者指南对。", "context": "EN 与 zh-CN 必须逐节一致。" }
mpd_workmate_reflect { "name": "doc-reviewer", "task": "guide review", "outcome": "发现 2 个失效链接；双语文档一致" }
mpd_workmate_list {}
mpd_workmate_rename { "name": "doc-reviewer", "new_name": "docs-reviewer" }
mpd_workmate_delete { "name": "docs-reviewer" }                       # 先归档
mpd_workmate_delete { "name": "docs-reviewer", "purge": true, "confirm": "docs-reviewer" }
```

`base` 是功能名；`name` 可省（会据此自动生成）。`mpd_workmate_match` 匹配很弱就意味着新建一个
workmate —— 绝不硬用弱匹配。workmate 正被进行中的 spawn（或旧版团队记录）使用时，这两个变更操作
都会被拒绝。

### 13.5 哈希锚定编辑

```text
mpd_hashline_read { "path": "docs/user-guide.md" }        # 每个源文件行打印一行 LINE#HASH|content
mpd_hashline_edit { "path": "docs/user-guide.md", "edits": [ { "op": "replace", "pos": "7#ab12", "lines": "…" }, { "op": "replace", "pos": "9#cd34", "end": "11#ef56", "lines": ["…", "…"] }, { "op": "append", "pos": "20#0a1b", "lines": "…" } ] }
mpd_hashline_format { "path": "docs/user-guide.md" }      # 把该文件登记进这套纪律
mpd_hashline_restore { "path": "docs/user-guide.md" }     # 取消登记（文件本身不被改动）
```

锚点来自 `mpd_hashline_read`，也是 `mpd_hashline_edit` 唯一接受的东西：如果自那次读取之后文件变了，
编辑会被**拒绝**并给出重新映射后的引用，而不是写到错误的行上。`pos`/`end` 形如 `LINE#HASH`；
`lines` 可以是字符串或字符串数组。

### 13.6 boulder 台账

```text
mpd_boulder_plans {}
mpd_boulder_start { "planPath": ".mpd/plans/docs-wave.md" }
mpd_boulder_task_timer { "workId": "<work id>", "taskKey": "1", "action": "start", "taskTitle": "重写 README" }
mpd_boulder_plan_progress { "planPath": ".mpd/plans/docs-wave.md" }
mpd_boulder_status {}
mpd_boulder_complete { "workId": "<work id>" }
```

一次 boulder 把会话绑定到某个计划 markdown 文件，让长任务能跨重启存活；`workId` 默认是当前活跃的
work，`taskKey` 是计划自己的清单编号（`1`、`F1`……），`action` 取 `start` 或 `end`。

### 13.7 记忆

```text
mpd_memory_save { "key": "docs-wave-branch", "value": "feature/docs-wave" }
mpd_memory_recall { "key": "docs-wave-branch" }
mpd_memory_write { "title": "文档波次的决策", "content": "设计文档现在就是架构章节", "kind": "note", "tags": ["docs"] }
mpd_memory_read { "query": "doc wave", "limit": 5 }
mpd_memory_status {}
mpd_memory_reflect {}
mpd_memory_reflect_complete { "title": "文档波次", "content": "…" }
```

`mpd_memory_write` / `mpd_memory_read` 是版本库后端的存储（§9 中的 `memory.vcs`）；
`mpd_memory_save` / `mpd_memory_recall` 是简单的键值层。`mpd_memory_status` 打印计数器，待办的反思
用 `mpd_memory_reflect_complete` 收尾。

### 13.8 扩展

```text
mpd_ext_list {}
mpd_ext_show { "id": "mpd-ext-example" }
mpd_flow_list {}
mpd_flow_show { "id": "<flow id>" }
```

```bash
bun scripts/mpd-ext.ts validate extensions/mpd-ext-example    # 退出码 1 + 每个问题一行
bun scripts/mpd-ext.ts list
bun scripts/mpd-ext.ts scaffold my-ext --dir /tmp --with-mcp
```

### 13.9 团队回路（Lead 与成员）

```text
# Lead（会话智能体）
agent_teams_plan { "action": "status" }                          # 计划中的成员与活跃任务板，带 revision
agent_teams_dispatch { "action": "run" }                          # 把就绪任务与空闲成员配对
send_message { "agent_id": "junior-1", "message": "T5 需要设计文档的链接目标。" }
list_agents {}                                                   # agent_id 与可用状态
wait_agent { "timeout_ms": 60000 }                               # 下一次名册/消息/任务变化
interrupt_agent { "agent_id": "junior-1" }                       # 停下当前轮次，保留收件箱

# 成员
agent_teams_task { "task_id": "T5", "action": "claim" }
agent_teams_task { "task_id": "T5", "action": "complete", "expected_revision": 5, "note": "…进度 + 证据…" }
send_message { "agent_id": "lead", "message": "T5 完成：`bun run verify:docs` 通过。" }
```

只有 `release` 与 `complete`/`fail` 需要带上调用者读到的 `expected_revision`，过期值会以带类型的错误
被拒绝，因此被改派的任务无法悄悄接受迟到的结果；`claim`、`contract` 与 `depend` 不接收 revision。
`approve` 会**拒绝**两个声明写范围重叠、且彼此之间没有依赖路径的暂存任务 —— 补上依赖边，或让两个
范围互不重叠。重叠只在官方（OFFICIAL）平面上是提示。`write_scopes` 从不授权写入，而
bash/格式化器/代码生成器会绕过该检查，所以请在任务描述（或消息）里报告你改了什么，而不是依赖那份
范围清单。结果不会因为队友自己说完成就被接受：Lead 会先等团队（`wait_agent`，然后重新读状态），
并在作答前核对 diff。

### 13.10 持久化 goal（持续化执行）

长目标会活过一个 turn。harness 的 **goal** 就是这件事的持久表达：它写在会话日志里，重启后仍在，
其轮次驱动器会以自动续行轮次持续推进会话，直到 goal 完成（或被阻塞，或轮次上限用尽）。本 bundle
补上了它的插件侧：`mpd-goal` 行。

```text
# 读取当前会话的 goal（无需 driver 在运行）
mpd_goal_status {}

# 为长目标 anchor 一个：包含"未完成 goal 检查 + create + 归属 sidecar"三件事。
# 若已有未完成的 goal 则保留它，绝不替换。
mpd_goal_anchor { "objective": "交付 cordis-dev skill 及其证据", "maxRounds": 24 }

# 目标真正达成时收尾
mpd_goal_finish { "outcome": "complete" }
```

**你很少需要自己调用它们。** 在 `goal.autoAnchor` 打开（默认）时，heavy 档 ULW 运行
（`mpd_ultrawork` 的 `tier: "heavy"` 或 `plan: true`）与绑定 plan 的 `mpd_boulder_start` 会在开始前
为各自的目标 anchor 一个 goal，于是"持续化执行的依据"是这次运行的目标，而不是某次工具调用。团队计划的
**批准**也会 anchor 一个，并在同一路径写入待办（§6）：一次批准同时打包团队记录、goal 与待办清单。运行
结束时：

- `complete` → 完成 goal 并删除 anchor 记录；
- `blocked` → 尝试标记阻塞，harness 可能因其连续轮次阈值而拒绝（拒绝只记日志、绝不致命）；
- `max-rounds` → goal **故意保持启用**：turn 内的引擎停了，由轮次驱动器在后续 turn 接着推进该目标。

归属按会话记录在 `<workspace>/.mpd/goal/anchors.json`，因此一次运行只会收尾它自己 anchor 的
goal：你用 `/goal` 或 `create_goal` 建的 goal 不会被它动。

两条边界值得知道：harness 自身的规则依然生效 —— create / edit / pause / resume 需要顶层 agent 上的
**直接人类轮次**，所以 agent 无法替自己发明工作再无人值守地继续；而 `goal.*` 在行挂载时读取，因此
改 `.mpd/mpd.jsonc` 需要 `dsh` 重启后生效（§9.1）。

### 13.11 MCP 代码理解

```text
# 结构化检索 —— 按语法形状而非文本
mcp__ast_grep__search { "pattern": "useEffect($$$)", "language": "tsx", "paths": ["src"] }
mcp__ast_grep__rewrite { "pattern": "console.log($A)", "rewrite": "logger.info($A)", "language": "typescript", "paths": ["src"], "apply": false }

# 语言服务器智能
mcp__lsp__get_diagnostics { "filePath": "packages/mpd-roles-plugin/src/index.ts" }
mcp__lsp__find_references { "filePath": "packages/mpd-roles-plugin/src/index.ts", "line": 42, "character": 9 }
mcp__lsp__rename_symbol { "filePath": "packages/mpd-roles-plugin/src/index.ts", "line": 42, "character": 9, "newName": "resolvedConfig" }

# 工程图 —— 提一个问题，拿回相关符号与调用路径
mcp__codegraph__codegraph_explore { "query": "how does a task get claimed and updated?" }

# 远端服务器：库文档与 GitHub 代码检索
mcp__context7__resolve-library-id { "libraryName": "zod", "query": "schema parsing" }
mcp__grep_app__searchGitHub { "query": "registerTool({", "language": ["TypeScript"] }
```

`mcp__lsp__rename_symbol`（以及它的 `rename_symbol_strict` 孪生工具）与 `mcp__ast_grep__rewrite` /
`mcp__ast_grep__scan` 会**写文件**：重写类调用先
带 `apply: false` 跑一遍，读完 diff 再应用。`mcp-git` / `mcp-shell` 两行默认不启用（§3）。两个远端
行（`context7`、`grep_app`）是公共 HTTP 服务，需要网络；三个本地服务器需要各自的
二进制（§11）。

## 14. 这些能力的来源

给使用者看的归属事实，说清楚哪些是别人的工作、哪些是本项目的。带完整许可证正文的权威记录是
[`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md)。

| 你使用的功能 | 来源 | 许可 / 版本 | 记录位置 |
|---|---|---|---|
| 团队模式 —— 队友执行平面、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent` 与 Web 面板 | **官方** `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team` / `-client-ui-agent-team` 三个包，由本 bundle 的 `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` 行挂载 | MIT（harness 包组）；声明在 `package.json` 的 `dependencies` | `cordis.patch.yml`；`README.md`（*这次安装挂载了哪些插件*） |
| 被采纳（随后退役、再被**删除**）的内置 `agent-teams` 主体 | **dsh-agent-teams**，作者 程序员阿江（Relakkes）—— 曾被整体采纳并作为一等主代码 | MIT；采纳版本 `0.1.16-rc.3-mpd`（`0.1.14` 主体 + 回移的 `0.1.16-rc.3` 增量）；自 0.1.7-rc.2 起**没有任何行挂载它**，去 vendor 波（2026-10-07）又删除了 `packages/mpd-agent-teams-plugin/**` —— 仅有两块被迁移的产物以我们自己的代码形式存续：`packages/mpd-schemastery/**` 与位于 `packages/mpd-bundle-plugin/adopted/agent-teams-client.js` 的采纳浏览器 bundle | `LICENSE-NOTICES.md` 的 *dsh-agent-teams* 一节 |
| 11 位专家名册、模型链词汇、队友 / workmate BASE 模板 | **oh-my-openagent**，作者 code-yeongyu，固定于提交 `8c57e46`（v5.0.0-beta.20）—— 这里只是**名称与词汇**的历史来源；persona 文本已在 D 波改从宽松许可来源取材 | MIT（本仓库自己的作品）；名称所来自的那个上游当时是 SUL-1.0，仅作历史记录 | `LICENSE-NOTICES.md`；`VENDOR_LOCK.json` |
| 随包服务的技能语料（19 个技能，含本仓库自有的 `dsh-qa` 与 `cordis-dev`） | 16 个移植技能改从 **lazycodex** 取材（同一作者对 oh-my-openagent 语料的 MIT 再许可）；`cordis-dev` 由本仓库撰写，改写自 DeepSeek Harness 的创造模式 preset skills（`@deepseek-ai/dsh-agent-preset`，MIT） | MIT —— 再取样的语料为 `Copyright (c) 2026 Yeongyu Kim`；引用的 harness 材料是 MIT 且不再分发 | `VENDOR_LOCK.json` `assets.skills`；`LICENSE-NOTICES.md` |
| `mcp__ast_grep__*` | **ast-grep** —— **不是**声明依赖；CLI 由 `resolveAstGrepBinary` 在运行时解析（调用方环境固定值 → `$MPD_AST_GREP_BIN_DIR` → 该包自身的 `bin` 入口 → `.toolchain/node_modules/.bin` → `node_modules/.bin`） | MIT；`0.45.2`；不再分发 | `packages/mpd-mcp-shared/bin-resolve.ts`；`MPD_AST_GREP_SG_PATH` / `MPD_AST_GREP_BIN_DIR` |
| `mcp__codegraph__*` 与 `mpd-codegraph` 行 | **codegraph**，作者 Yeongyu Kim —— 可选依赖 `@colbymchenry/codegraph` | MIT；`1.5.0`；预构建服务器已搬运并做 sha256 固定 | `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`；`VENDOR_LOCK.json` |
| `mpd_comment_check` | **comment-checker**，作者 code-yeongyu（`@code-yeongyu/comment-checker`） | MIT；`0.8.0`；**不**随包分发 —— 按需安装到 `.toolchain`（`--with-comment-checker`） | `LICENSE-NOTICES.md`；`MPD_DSH_COMMENT_CHECKER_BIN` |
| DSH-STD 协议族 —— `@dsh-std/sdk` `0.1.1-rc.2`，本 bundle 唯一一个 DSH-STD **依赖**（adapter 属于可选的自装插件，见下文） | **dsh-std**（https://github.com/T-Auto/dsh-std）—— 声明式 npm 依赖，绝非搬运进来的代码 | MIT —— `Copyright (c) 2026 DSH Standard contributors`；安装时解析，不再分发 | `package.json` 的 `dependencies`；`LICENSE-NOTICES.md` |
| 插件系统、工具 / 技能 / preset / agent 接缝、模型 provider、Web 外壳 | DeepSeek Harness —— **`@deepseek-ai/*`** 包 | MIT；仅作为依赖引用 | `LICENSE-NOTICES.md` |
| Agent Teams Web 面板 | 官方客户端插件 `@deepseek-ai/dsh-experimental-client-ui-agent-team` | MIT（harness 包组） | 见上文 §8；patch 行 `mpd-ui-agent-team` |
| Workmates 侧边栏标签页 | 由社区 bundle **`dsh-better-sidebar`** 承载，它是本 bundle 的**可选 peer**（外加一个 `devDependency`）：bundle 从不安装它，带守卫的 `mpd-better-sidebar` 行在它可解析时挂载它 | — | 见上文 §8；`package.json` 的 `peerDependencies` / `peerDependenciesMeta`；patch 行 `mpd-better-sidebar` |
| DSH 接线（adapter、运行时插件、`mpd` preset、合并后的 Web 客户端）、TUI 版本、QA 套件、文档、扩展接口 | 本项目自己编写 | MIT | `README.md`（鸣谢）；`LICENSE.md` |

有两条值得记住的结论：组件即使在 bundle 内也各自保留**自己的**许可证（采纳的浏览器 bundle 与迁移过来
的 schemastery 校验器是 MIT，本仓库自身也是 MIT）；本 bundle 也从不配置你的 provider 凭据 ——
`MISSING_CREDENTIAL` 属于你的 DSH 凭据存储，而不是这些文档该负责的事。

### 14.1 可选的 DSH-STD adapter（自行安装，不属于本 bundle）

`@dsh-std/adapter-dsh` 是 DSH-STD 协议族自己的 adapter 插件。它**不是**本 bundle 的依赖，
`cordis.patch.yml` 里也**没有**它的行，本 bundle 从不挂载它。需要它的 profile 拥有者，
把它装进自己的 profile：

```bash
# 在 dsh 0.2.1-rc.2 基线上，先授予精确版本豁免：
dsh plugin --profile web allow-version @dsh-std/adapter-dsh@0.1.1-rc.2 --dsh-version 0.2.1-rc.2 --accept-risk
# 再执行 adapter 自己设计的这一条安装命令：
dsh plugin --profile web add @dsh-std/adapter-dsh
```

本 bundle 之所以不随包提供它：adapter 的 peer 把宿主 `@deepseek-ai/dsh-*` 盯在 `0.1.2-alpha` 线上，
而本 bundle 的基线是 dsh `0.2.1-rc.2`，于是豁免只能是 profile 拥有者对自己 profile 的显式风险决定；
而把它随包提供也不是中立的替代方案：插件管理器在安装时做两次兼容检查 —— 先在 `pnpm` 运行之前，
对显式指定的安装规格做预检；再在安装之后，对 profile 里已直接安装的依赖、以及被改动 bundle 的
patch 行所点名的组件清单做后验 —— 从不递归扫描整个传递闭包。我们在本改动的一个 v1 变体上实测过
后验（adapter 同时被声明为依赖并被 patch 行点名）：`dsh plugin add` 直接硬拒绝并回滚了整个
bundle 的安装。
