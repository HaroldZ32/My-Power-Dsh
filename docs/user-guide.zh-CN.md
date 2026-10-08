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

本 bundle 声明了**三个**运行时依赖 —— 提供团队模式的三个官方 Agent Teams 包
（`@deepseek-ai/dsh-experimental-agent-team` 及其 `-tool-agent-team`、`-client-ui-agent-team`
两个同级包）。**`dsh-better-sidebar`**（即承载 Workmates 标签页的社区侧边栏 bundle）**有意不在
其中**：它是可选 peer（外加一个 `devDependency`），bundle 从不安装它，它的缺席是正常的组合状态，
而不是安装损坏（§8）。检出目录安装会直接读取
本仓库，因此请先把仓库依赖落到本地：

```bash
cd <repo> && bun install          # 只需一次：把声明的运行时依赖落到仓库 node_modules
```

如果 `node-gyp` 不可用，可以用
`bun add dsh-better-sidebar@0.24.1 --ignore-scripts` 跳过构建脚本装上这个**可选 peer** —— 只有侧边栏的
终端面板会降级。（当初需要这个开关的传递依赖 `node-pty` 在 `0.24.1` 中已被移除，2026-10-02 实测。）
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
- **原生工具呈现**：harness 自带的工具（bash/read/edit 等）直接暴露。
- preset 的人设解释了专家名册、团队模式与 workmate 库（见下文），因此智能体无需额外配置就能
  正确路由。

## 3. 按用途划分的工具

| 你想做的事 | 工具 | 说明 |
|---|---|---|
| 探索代码库 | `mcp__ast_grep__*`（结构化检索/改写）、`mcp__lsp__*`（cclsp：定义、引用、实现、诊断、悬停、工作区符号、调用层级、重命名）、`mcp__codegraph__*`（项目代码图） | MCP 工具服务器；它们的工具以 `mcp__<server>__<tool>` 形式出现。另外两个家族 **默认不可用**：`mcp__git__*`（git 工具箱，28 个工具）与 `mcp__shell__*`（`run_process`，裸 shell）。两行都自带 `disabled: true`，因此普通会话里不会出现这类工具 —— 想启用哪一个，就把该行的 `disabled:` 改成 `false`，然后重新安装 bundle。 |
| 安全地修改 | 写入守卫与输出截断（无需配置）、`mpd_hashline_read/edit/format/restore`、`mpd_comment_check` | 哈希锚定编辑在锚点过期时会拒绝写入，而不是写到错误的行 |
| 推进长任务 | `mpd_ulw`（轻量）/ `mpd_ultrawork`（完整纪律：计划关卡、执行轮次、验证关卡），或等价的 `/ulw <objective>` / `/ultrawork <objective>` 命令、`mpd_boulder_start/status/complete/task_timer/plan_progress/plans` | 两个命令会注入 ULW 自治指令 —— 该运行不向用户提问，并在工作确需团队时自行建队；`mpd_boulder_*` 跨会话跟踪某个计划 markdown 文件的进度 |
| 让长任务跨轮继续 | `mpd_goal_status`、`mpd_goal_anchor`、`mpd_goal_finish`（以及宿主的 `/goal` 命令与它的 goal 轮次驱动器） | 见 §13.10：**持久化 goal** 是本 bundle 持续化执行的依据 —— heavy 档 ULW 运行或绑定 plan 的 boulder 工作会自动 anchor 一个（`goal.autoAnchor`），而当 turn 内引擎提前停下时它会保持启用 |
| 保存记忆 | `mpd_memory_write/read/reflect/reflect_complete/status`、`mpd_memory_save/recall` | 版本库后端可以是 git 或 svn；`mpd_memory_save/recall` 是简单的键值层 |
| 咨询专家 | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona` | 一次性子智能体；只读角色会被禁用写入类工具 |
| 养一个会成长的智能体 | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` | 见 §5 |
| 运行一个团队 | `agent_teams_plan`（暂存计划、扩展它、批准它）、`spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create/list/get/update` + Web 的 Agent Teams 面板 | 见 §6 |
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

一次性使用：

- `mpd_roles_list` —— 列出名册。
- `mpd_role_spawn { role, task, context? }` —— 以子智能体形式 spawn 一位专家，带上它的人设与
  模型路由；只读角色会被机制性地禁用写入类工具。
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

**当 workmate 正在被使用时，这两种改动都会被拒绝** —— 无论是仍有 `mpd_workmate_spawn`
在运行，还是存在**旧版**团队记录（`.mpd/team/` 下未归档的记录中出现了它的名字；跑在官方插件上的
团队不会留下这种记录）。拒绝信息为
`409 in-use`，并列出阻塞的团队 id 与成员，因此是可行动的：结束正在运行的 spawn（或清理那些旧版
记录），然后重试。同一
道门也覆盖重命名的 **目标名**，所以把 workmate 重命名为某个已被记录为在用的名字也会被同样拒绝。

## 6. 团队模式

团队模式跑在 harness 的**官方 Agent Teams 插件**上，由本 bundle 的 `mpd-agent-team` /
`mpd-tool-agent-team` / `mpd-ui-agent-team` 三行挂载（行清单见 [`design.md`](design.md)）。
你的会话智能体就是 **Lead**（captain）：它创建具名队友、把任务开在共享任务板上，并亲自整合结果。

```text
agent_teams_plan { action }                                                # 仅 Lead：create | add_member | create_task | edit | approve | delete | status
spawn_teammate { name, description, prompt, context: "fresh" | "fork" }   # 仅 Lead
team_task_create { subject, description, blocked_by?, write_scopes? }
team_task_get { task_id } / team_task_list { status?, owner?, ready? }
team_task_update { task_id, expected_revision, action }                   # compare-and-set
send_message { target, message } / list_agents { } / wait_agent { timeout_ms }
interrupt_agent { target }                                                # 仅 Lead
```

- **暂存的就是一份需要你批准的计划，而且它跑在「我们的」平面上。** 在 `team.gate: "mechanical"`
  （默认）下，会话起点的复杂度门会通过 `agent_teams_plan` 工具 **stage 一个可批准的 plan shell** ——
  0 成员、0 任务，且处于**惰性**状态：不会 spawn 任何东西。captain 扩展它
  （`add_member` / `create_task`），再用 `agent_teams_plan {action:"approve"}` 批准 —— 这才是
  spawn 成员并发布任务的动作；`action:"status"` 读回计划，`action:"delete"` 将其归档。这个 plan
  平面是**我们的**（`mpd-team-core`），不属于官方 Agent Teams 插件：团队本身仍然跑在官方任务板上 ——
  `spawn_teammate` 与 `team_task_*` 生命周期。若 `team.gate: "advisory"`，或 `agent_teams_plan`
  没有挂载，门就不会 stage 任何东西，只用一条通知说明，并由 captain 在工作确需团队时自行建队。
- **任务板是 compare-and-set 的。** `team_task_update` 要带上你读到的 `expected_revision`，过期
  revision 会得到错误而不是覆盖更新的工作。动作有 `claim`、`release`、`edit`、
  `set_dependencies`、`complete`、`reopen`、`reassign`、`delete`。
- **`write_scopes` 只是提示。** 两个进行中的任务如果计划触碰重叠路径，只会收到警告；任务板从不阻止
  认领，也从不授权写入，而 bash/格式化器/代码生成器会绕过一切检查 —— 由 Lead 协调归属并审阅最终
  diff。
- **消息是持久的。** `send_message` 回答 `accepted`（已投递）或 `queued`（已落盘、排队中），排队
  中的消息绝不要重发。`list_agents` 报告每位成员的 `target` 与可用状态（`inactive` 表示当前没有
  轮次在执行，不是工作已完成）；当没有其他成员在运行或创建中时，`wait_agent` 立刻回答
  `noProgress`。
- **只读成员就是只读的。** Architect、Researcher、Planner、Explorer、Plan Reviewer 与
  Vision Analyst 会被拒绝那七个写入工具：一次性通道通过 `toolFilter.deny`，团队通道通过
  `mpd-roles-plugin` 里以团队身份为键的工具守卫 —— 因为官方 `spawn_teammate` 无法接受按队友的
  工具过滤器。工作者（Senior Engineer、Junior Engineer、Deep Worker、Lead、Reviewer）负责实现与
  验证。
- **队友跑在 Lead 的模型路由上。** 官方 `TeamService` 只把提示词与父会话转发给 subagent 注册表，
  因此 `teamModels.slot*` 只作用于**一次性咨询**通道（`mpd_role_spawn`、`mpd_workmate_spawn`），
  无法按队友注入。某位成员需要别的模型时，在它的 spawn 提示词里说明。
- **由 workmate 背书的成员是一段提示词，而不是自动注入。** 现在已经没有任何东西会把某个 workmate
  的人设自动带进队友：先初始化或挑出该 workmate（`mpd_workmate_init` / `mpd_workmate_match`），
  读出它应当携带的内容，再把那段文本放进 `spawn_teammate` 的提示词；事后用
  `mpd_workmate_reflect` 记录结果（§5）。
- **扩展 role 不是团队成员**：扩展可以贡献一个能被 `mpd_role_spawn` / `mpd_role_persona` 使用的
  role，但队友名册就是 captain 按名字创建出来的那些人，所以扩展 role 不会自己变成队友（见 §10）。

### 调用形态

```text
# 创建一个队友和它的一条任务
spawn_teammate { "name": "senior-1", "description": "Owns the README pair", "prompt": "<人设 + 任务>", "context": "fresh" }
team_task_create { "subject": "重写安装章节", "description": "…", "blocked_by": [], "write_scopes": ["README.md"] }

# 操作任务板（任何成员；Lead 还可以改派）
team_task_list { "ready": true }
team_task_get { "task_id": "task-3" }
team_task_update { "task_id": "task-3", "expected_revision": 2, "action": "claim" }
team_task_update { "task_id": "task-3", "expected_revision": 3, "action": "complete" }

# 协调
list_agents { }
send_message { "target": "senior-1", "message": "先落 README 的修改，再做使用者指南。" }
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "target": "senior-1" }     # 仅 Lead：停下当前轮次，保留收件箱
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
| Agent Teams 面板（会话头部） | `tuiScenes` 全屏看板 + 带 key 的 `tuiStatus` 状态行 |
| Workmates 侧边栏标签页 | `/mpd` 命令树（`tuiCommandTrees`）+ `tuiDialogs` |
| 设置 → MPD 栏 | `/settings` 分区（`tuiSettingsSections`） |
| — | `tuiShortcuts` 快捷键 |

这些是**等价物，不是等价功能（parity）**：每个界面都重建在宿主自身的 TUI 接缝上，且有两个接缝被明确
声明为未主张 —— 宿主不提供 prompt 插槽（`tuiPrompt` 宿主不可用），也不为 bundle 的 renderer 事件投射
任何 transcript 行，因此 prompt 插槽与 transcript 行都不作主张。完整清单位于
[`tui.zh-CN.md`](tui.zh-CN.md) §10 NOT-CLAIMED。

### 7.2 `/settings` 界面与 `mpd.jsonc` 桥接

`/settings` 编辑真实的 `mpd.jsonc` 旋钮 —— 共 25 个（原有 13 个加十二个 `teamModels` 槽位叶子，
后者是只可选择字段，选项来自实时模型目录，回退到声明列表），其中包括 `hashline.maxDiffChars`、
`commentChecker.autoCheck`、`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir` —— 它们位于 harness settings 命名空间
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

- **Agent Teams**（团队界面）：官方客户端插件
  `@deepseek-ai/dsh-experimental-client-ui-agent-team`（由本 bundle 的 `mpd-ui-agent-team` 行挂载）
  在会话头部增加一个 **Agent Teams** 动作。它读的是共享会话存储里 Lead 会话的 `agentTeam` 投影，
  所以面板打开期间名册或任务变化就会刷新。它列出名册（持久名字与阶段：`running`、`inactive`、
  `provisioning`、`failed`）与共享任务板（任务标识、归属、前置、就绪状态、提示性写入范围与重叠
  警告），并能跳进某位队友的会话。它是**只读**的：面板不能创建、改名、删除或中断队友，也没有任务
  修改控件 —— 那些属于 §6 里的工具。它不展示点对点消息，只展示名册与任务。如果插件是在一个已经
  打开的会话里才启用的，刷新一次页面以接收投影。
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
  连侧边栏接缝都不存在，mpd 各面板会各自按名字报告一次。团队工作仍然可以通过官方团队工具运行，
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
| `goal.enabled`、`goal.autoAnchor`、`goal.autoRounds` | mpd-goal | 持久化 goal 桥：总开关、长任务是否自行 anchor goal、自动 anchor 的轮次上限（默认 `true` / `true` / `32`）。见 §13.10 |
| `extensions.enable`、`extensions.disable` | mpd-ext | 按 id 的扩展启用/禁用列表（进程级：见 §10） |
| `extensions.mcp.*` | mpd-ext | MCP 桥默认值：`enabled`、`connectTimeoutMs`、`toolCallTimeoutMs` |
| `modelchain.*` | mpd-modelchain | 各名册角色的 provider/model 链 |
| `team.stateDir` | 读取旧版团队记录的 mpd 插件（看门狗 web 路由、压缩、TUI 团队界面、workmate 在用检查） | 这些记录的位置（默认 `.mpd/team`）。官方团队插件不读它 |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate（经 mpd-config） | 四个**团队模型槽位**：每个槽位是 `{provider, model, reasoningEffort}`，默认 `deepseek-official` / `deepseek-v4-flash`，推理强度依次为 `max`/`high`/`high`（槽位 4 默认 `deepseek-official` / `deepseek-v4-flash-vision-exp` / `high`）。槽位 1 路由 Architect/Planner/Reviewer/Lead/Senior Engineer，槽位 2 路由 Researcher/Explorer/Plan Reviewer，槽位 3 路由 Deep Worker/Junior Engineer，槽位 4 路由 Vision Analyst —— 视觉成员，其槽位模型**必须支持图像输入**。它们由**一次性咨询**通道（`mpd_role_spawn`、`mpd_workmate_spawn`）解析，由这两条通道显式传入路由；而 `spawn_teammate` 创建的队友继承 Lead 的路由（§6）。槽位解析失败会让对应的 spawn **大声失败**（指名成员与槽位，不写入任何内容），且推理强度**永远不会**被悄悄钳制。可在 **设置 → MPD** 与 TUI 的 `/settings` 区块中作为只可选择字段编辑；保存后立即落到文件，插件在重启后生效。 |

`mpd-codegraph` 刻意不在上表中：它的 `autoInit`、`initTimeoutMs`、`cooldownMs` 与 `binary` 来自
它的 **bundle-patch 行** 配置（在 apply 时读取），没有任何插件通过 `mpd.jsonc` 读取
`codegraph.*` 键。它的行在 `cordis.patch.yml` 中自带 `autoInit: true` 与
`initTimeoutMs: 60000`。

### 9.1 保存的旋钮何时生效

这是使用者最容易搞错的一点，所以逐个旋钮说清楚。总规则：消费方在 **挂载**（`apply()`）时通过
`mpdConfig` 服务读取配置，因此一个变化了的值 —— 无论是手工编辑 `.mpd/mpd.jsonc` 或
`$DSH_HOME/mpd.jsonc`，还是通过 **设置 → MPD** / TUI 的 `/settings` 界面保存 —— 要等
**`dsh` 重启**之后才会改变插件的**行为**。

有两件事不必等这次重启，而且都很有用：

- **回读永远是即时的。** `mpd_config_get` 与 `mpd_config_reload` 每次调用都重新读取各层并立刻报告
  新的解析值 —— 这是你确认编辑确实落地的办法，即使已挂载的插件仍持有它挂载时捕获的值。
- **`watchdog.*` 是实时重读的。** 看门狗在挂载时、收到 settings 文档更新时、以及每个 tick 都会
  重新解析自己的旋钮，所以文件改动在**本进程内**即可生效、无需重启；
  `session-watchdog-status` 会打印每个旋钮的 LIVE vs FILE 取值以及 `restartRequired` 标志。

| 旋钮 | 谁读取 | 何时读取 | 何时生效 |
|---|---|---|---|
| `hashline.*` | mpd-hashline | 挂载时 | `dsh` 重启后 |
| `commentChecker.*` | mpd-comment-checker | 挂载时 | 重启后 |
| `ulw.*` | mpd-ulw | 挂载时 | 重启后 |
| `goal.*` | mpd-goal | 挂载时 | 重启后 |
| `memory.*` | mpd-memory | 挂载时 | 重启后 |
| `boulder.dir` | mpd-boulder | 挂载时 | 重启后 |
| `modelchain.*` | mpd-modelchain | 挂载时 | 重启后 |
| `extensions.enable` / `.disable` / `.mcp.*` | mpd-ext | 插件启动时（进程级） | 重启后 |
| `team.stateDir` | 读取旧版团队记录的 mpd 插件，经实时服务解析 | 每次调用 | 服务重新读取文件之后立即生效（`mpd_config_reload`，或任意一次设置保存）。这些是**旧版**记录：官方团队插件把名册、邮箱与任务板保存在 Lead 的会话日志里，不在这里 |
| `teamModels.slot{1,2,3,4}.*` | mpd-roles / mpd-workmate，在一次性咨询通道（`mpd_role_spawn`、`mpd_workmate_spawn`）解析 | spawn 时 | 下一次一次性 spawn：设置保存会建立文件监听并重新读取，因此无需重启；如果是手工编辑文件，先调用一次 `mpd_config_reload`（或重启）让解析读到新值。`spawn_teammate` 创建的队友**不**由这些槽位路由 |
| `watchdog.*` | mpd-team-watchdog | 挂载时、settings 更新时、每个 tick | 实时生效 —— 无需重启 |

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
  作为 workmate 的基础模板，但队友名册是固定的：只有 captain 用 `spawn_teammate` 按名字创建的
  才是队友。
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
  `bun add dsh-better-sidebar@0.24.1 --ignore-scripts`），然后重新安装 bundle。
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
- **保存的旋钮没有生效** → 插件在挂载时捕获配置：重启会话。`mpd_config_get` 显示新值**不等于**
  正在运行的插件已经在按它行动（§9.1 说明了哪些旋钮是实时生效的）。
- **升级后某个文档链接 404** → 本次发布**重命名**了设计文档（它原名 `architecture.md`，
  `docs/design.zh-CN.md` 是当前名称的中文版），因此旧版文档副本指向的文件已不存在。重新安装 bundle
  （`git pull`，然后 `dsh plugin --profile <p> add <repo>`）即可拿到重新指向后的文档对。

## 12. 命令参考

会话中可用的全部斜杠命令，以及各自生效的位置。表里有两类：本 bundle **贡献的四条命令**
（`mpd-ulw` 注册 `/ulw` 与 `/ultrawork`，`mpd-codegraph` 注册 `/mpd-codegraph`，`mpd-tui` 注册
`/mpd`），以及本 bundle 只是
**记录**的两条 **宿主命令** —— `/settings`（宿主 TUI 设置界面，其 MPD 区块由本 bundle 扩展）与
`/goal`（宿主 goal 命令，由 `mpd` preset 挂载）。除此之外没有别的命令 —— 特别地，**不存在
`/roster` 命令**（名册要通过 `mpd_roles_list` 工具访问），也**不存在 `/agent-teams` 命令**
（团队工作由官方的 `spawn_teammate` / `team_task_*` 工具驱动；注册那条命令的内置插件已不再挂载）。

| 命令 | 作用 | 可用位置 |
|---|---|---|
| `/ulw <objective>` | 针对该目标启动 ultrawork 循环 —— 与 `mpd_ulw` 同一引擎，使用较轻的默认档位 | Web + TUI |
| `/ultrawork <objective>` | 与 `/ulw` 完全相同（两者都会把 ULW 激活指令作为你的下一条用户消息提交） | Web + TUI |
| `/mpd-codegraph` | 解析 codegraph 二进制并在 `.codegraph/` 下初始化/刷新项目索引 | Web + TUI |
| `/mpd` | TUI 上覆盖 bundle 状态的命令树：裸 `/mpd` 打开选择器，`/mpd <value>` 直接进入，`/mpd status` 打印摘要 | **仅 TUI** —— 在 Web 下注册被拒绝，什么都不会暴露 |
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
agent_teams_plan { "action": "create_task", "task": { "subject": "重写安装章节", "description": "覆盖两个 profile 与打包产物。", "write_scopes": ["README.md"] } }
agent_teams_plan { "action": "status" }
agent_teams_plan { "action": "approve" }                              # ← 就是这一步 spawn 成员并发布任务

# (b) 建队：每位成员一次 spawn，每条通道一个任务
spawn_teammate { "name": "senior-1", "description": "Owns the README pair", "prompt": "<mpd_role_persona 文本> + 重写安装章节。用户要能用一条命令从检出目录安装；用 bun run verify:docs 验证。", "context": "fresh" }
team_task_create { "subject": "重写安装章节", "description": "覆盖两个 profile 与打包产物。", "blocked_by": [], "write_scopes": ["README.md"] }
team_task_create { "subject": "验证 README 文档对", "description": "跑文档关卡并贴出原始输出。", "blocked_by": ["task-1"], "write_scopes": [] }

# (c) 操作任务板（compare-and-set：每次更新前都重新读一次）
team_task_list { "ready": true }
team_task_get { "task_id": "task-1" }                                  // → revision
team_task_update { "task_id": "task-1", "expected_revision": 1, "action": "claim" }
team_task_update { "task_id": "task-1", "expected_revision": 2, "action": "complete" }

# (d) 推动一个正在运行的团队
list_agents {}
send_message { "target": "senior-1", "message": "先落 README 的修改，再做使用者指南。" }
team_task_update { "task_id": "task-1", "expected_revision": 2, "action": "reassign", "owner": "junior-1" }   // 仅 Lead
wait_agent { "timeout_ms": 60000 }
interrupt_agent { "target": "senior-1" }                               // 仅 Lead；收件箱保留

# (e) 收尾一波
mpd_team_compact_run {}
mpd_team_compact_status {}
```

队友名字是永久的，且永不复用。`write_scopes` 只是提示（工作区相对前缀）：进行中的任务范围重叠只会
收到警告，不会被阻塞。基于过期 `revision` 的任务更新会被拒绝 —— 正是这道拒绝让被改派的任务不再接受
迟到的结果。在点名它的计划获得**批准**之前，不存在任何队友；质量纪律则由 captain 写进任务描述里。

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

### 13.3 专家（一次性子智能体）

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
team_task_list {}                                                # 活跃任务板，带 revision
team_task_get { "task_id": "task-5" }                            # 冻结在该 revision 上的单个任务
team_task_update { "task_id": "task-5", "expected_revision": 4, "action": "reassign", "owner": "junior-1" }
send_message { "target": "junior-1", "message": "task-5 需要设计文档的链接目标。" }
list_agents {}                                                   # target 与可用状态
wait_agent { "timeout_ms": 60000 }                               # 下一次名册/消息/任务变化
interrupt_agent { "target": "junior-1" }                         # 停下当前轮次，保留收件箱

# 成员
team_task_update { "task_id": "task-5", "expected_revision": 4, "action": "claim" }
team_task_update { "task_id": "task-5", "expected_revision": 5, "action": "edit", "description": "…进度 + 证据…" }
team_task_update { "task_id": "task-5", "expected_revision": 6, "action": "complete" }
send_message { "target": "lead", "message": "task-5 完成：`bun run verify:docs` 通过。" }
```

每次修改都要带上调用者读到的 `expected_revision`；过期值会以带类型的错误被拒绝，因此被改派的任务
无法悄悄接受迟到的结果。`write_scopes` 只对重叠发出警告，从不授权写入，所以请在任务描述（或消息）里
报告你改了什么，而不是依赖那份范围清单。结果不会因为队友自己说完成就被接受：Lead 会先等团队
（`wait_agent`，然后重新读状态），并在作答前核对 diff。

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
为各自的目标 anchor 一个 goal，于是"持续化执行的依据"是这次运行的目标，而不是某次工具调用。运行
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
| 团队模式 —— `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_*` 任务板与 Web 面板 | **官方** `@deepseek-ai/dsh-experimental-agent-team` / `-tool-agent-team` / `-client-ui-agent-team` 三个包，由本 bundle 的 `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` 行挂载 | MIT（harness 包组）；声明在 `package.json` 的 `dependencies` | `cordis.patch.yml`；`README.md`（*这次安装挂载了哪些插件*） |
| 被采纳（随后退役、再被**删除**）的内置 `agent-teams` 主体 | **dsh-agent-teams**，作者 程序员阿江（Relakkes）—— 曾被整体采纳并作为一等主代码 | MIT；采纳版本 `0.1.16-rc.3-mpd`（`0.1.14` 主体 + 回移的 `0.1.16-rc.3` 增量）；自 0.1.7-rc.2 起**没有任何行挂载它**，去 vendor 波（2026-10-07）又删除了 `packages/mpd-agent-teams-plugin/**` —— 仅有两块被迁移的产物以我们自己的代码形式存续：`packages/mpd-schemastery/**` 与位于 `packages/mpd-bundle-plugin/adopted/agent-teams-client.js` 的采纳浏览器 bundle | `LICENSE-NOTICES.md` 的 *dsh-agent-teams* 一节 |
| 11 位专家名册、模型链词汇、队友 / workmate BASE 模板 | **oh-my-openagent**，作者 code-yeongyu，固定于提交 `8c57e46`（v5.0.0-beta.20）—— 这里只是**名称与词汇**的历史来源；persona 文本已在 D 波改从宽松许可来源取材 | MIT（本仓库自己的作品）；名称所来自的那个上游当时是 SUL-1.0，仅作历史记录 | `LICENSE-NOTICES.md`；`VENDOR_LOCK.json` |
| 随包服务的技能语料（19 个技能，含本仓库自有的 `dsh-qa` 与 `cordis-dev`） | 16 个移植技能改从 **lazycodex** 取材（同一作者对 oh-my-openagent 语料的 MIT 再许可）；`cordis-dev` 由本仓库撰写，改写自 DeepSeek Harness 的创造模式 preset skills（`@deepseek-ai/dsh-agent-preset`，MIT） | MIT —— 再取样的语料为 `Copyright (c) 2026 Yeongyu Kim`；引用的 harness 材料是 MIT 且不再分发 | `VENDOR_LOCK.json` `assets.skills`；`LICENSE-NOTICES.md` |
| `mcp__ast_grep__*` | **ast-grep** —— 可选依赖 `@ast-grep/cli` | MIT；`0.45.2`；运行时解析，不再分发 | `package.json` 的 `optionalDependencies`；`MPD_AST_GREP_SG_PATH` / `MPD_AST_GREP_BIN_DIR` |
| `mcp__codegraph__*` 与 `mpd-codegraph` 行 | **codegraph**，作者 Yeongyu Kim —— 可选依赖 `@colbymchenry/codegraph` | MIT；`1.5.0`；预构建服务器已搬运并做 sha256 固定 | `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`；`VENDOR_LOCK.json` |
| `mpd_comment_check` | **comment-checker**，作者 code-yeongyu（`@code-yeongyu/comment-checker`） | MIT；`0.8.0`；**不**随包分发 —— 按需安装到 `.toolchain`（`--with-comment-checker`） | `LICENSE-NOTICES.md`；`MPD_DSH_COMMENT_CHECKER_BIN` |
| 插件系统、工具 / 技能 / preset / agent 接缝、模型 provider、Web 外壳 | DeepSeek Harness —— **`@deepseek-ai/*`** 包 | MIT；仅作为依赖引用 | `LICENSE-NOTICES.md` |
| Agent Teams Web 面板 | 官方客户端插件 `@deepseek-ai/dsh-experimental-client-ui-agent-team` | MIT（harness 包组） | 见上文 §8；patch 行 `mpd-ui-agent-team` |
| Workmates 侧边栏标签页 | 由社区 bundle **`dsh-better-sidebar`** 承载，它是本 bundle 的**可选 peer**（外加一个 `devDependency`）：bundle 从不安装它，带守卫的 `mpd-better-sidebar` 行在它可解析时挂载它 | — | 见上文 §8；`package.json` 的 `peerDependencies` / `peerDependenciesMeta`；patch 行 `mpd-better-sidebar` |
| DSH 接线（adapter、运行时插件、`mpd` preset、合并后的 Web 客户端）、TUI 版本、QA 套件、文档、扩展接口 | 本项目自己编写 | MIT | `README.md`（鸣谢）；`LICENSE.md` |

有两条值得记住的结论：组件即使在 bundle 内也各自保留**自己的**许可证（采纳的浏览器 bundle 与迁移过来
的 schemastery 校验器是 MIT，本仓库自身也是 MIT）；本 bundle 也从不配置你的 provider 凭据 ——
`MISSING_CREDENTIAL` 属于你的 DSH 凭据存储，而不是这些文档该负责的事。
