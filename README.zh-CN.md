# my-power-dsh

[English](./README.md) | **中文**

**my-power-dsh** 是 **DeepSeek Harness（DSH）** 的插件 bundle。一次安装，就能把一套朴素的 DSH
环境变成真正可用于工程开发的工作环境：一个会自动读取你项目规则的主智能体、十一位可供咨询或委派的
专家、一个会记住自己所学内容的持久化 workmate 智能体库、需要你先审批计划才会运行的多智能体团队、
一套随包提供的 skill 语料库、用于代码理解的 MCP 集成，以及一套扩展接口 —— 让其他包在不改动核心的
前提下贡献 skill、flow、MCP 服务器与专家。

本文是它的**使用手册**：怎么安装、该敲什么、每条命令与每个工具做什么、怎么配置、你的数据放在哪里。
内部实现（启动链、包的构成、插件机制）只写在一处，本文用最后那一节 *架构：只留一条指引* 指过去。

这个 bundle 就是包 `@mpd-dsh/mpd`，而本仓库根目录**就是**这个包。它用一条命令安装，也用一条命令
卸载，不留残留。

## 一次安装，你得到什么

| 你想做的事 | 用什么 | 详细说明在哪 |
|---|---|---|
| 让智能体知道你的项目规则 | **`mpd` preset**（本 bundle 唯一随包提供的 preset） | *主智能体与你的项目规则* |
| 要一份第二意见，或一个范围明确的执行者 | **专家名册** —— `mpd_role_spawn` | *专家：名册* |
| 养一个会不断积累知识的专家 | **workmate 库** —— `mpd_workmate_*` | *养一个会成长的智能体* |
| 跑一条真正的多智能体流水线 | **团队模式** —— `agent_teams_*` + AgentTeams 标签页 | *团队模式* |
| 把一个长期目标推到完成 | **ULW 循环** —— `/ulw` | *推进长任务：ULW 循环* |
| 持久地跟踪一份多步计划 | **boulder 账本** —— `mpd_boulder_*` | *跟踪计划进度：boulder 账本* |
| 跨会话记住事实 | **记忆引擎** —— `mpd_memory_*` | *保存持久记忆* |
| 避免行号漂移导致的误改 | **哈希锚定编辑** —— `mpd_hashline_*` | *安全地编辑文件* |
| 快速看懂陌生代码库 | **MCP 服务器** —— ast-grep、LSP、CodeGraph | *理解代码库* |
| 让 bundle 学会一项新本事 | **扩展接口** —— `mpd_ext_*` | *扩展接口* |
| 全部在终端里驱动 | **DSH-TUI 版本** | *DSH-TUI 版本* |

## 安装

### 环境要求

- DeepSeek Harness（DSH），使用 `web` 或 `headless` profile，并在 DSH 中配置好模型凭据 ——
  本 bundle 从不会替你配置密钥。
- 仓库脚本需要 `PATH` 上有 Node.js 与 `bun`（`bun` 用来跑测试与扩展 CLI）。
- 可选项：若要使用代码智能相关服务器，可用 bundle 提供的工具链安装
  （`node scripts/install-mcp.mjs`），也可以用自己的二进制文件，并通过文档中给出的环境变量指向它
  （`MPD_DSH_AST_GREP_SG_PATH`、`MPD_CODEGRAPH_BIN` 等）。

### 从检出目录安装（web profile）

```bash
cd <repo> && dsh plugin --profile web add .
```

仓库根目录就是 bundle 包本身，所以这一条命令会同时安装全部插件行、`mpd` preset、18 个 skill 的
语料库与扩展根目录 —— 不需要打包步骤，也不需要复制步骤。之后重启 `dsh`，在会话中选择
**MPD（Main Working Agent）** preset。

检出目录安装会直接读取该目录：改动代码后，重新构建所改包的 `dist/`，再重启 `dsh`。

### 安装到终端界面（`dsh-tui` profile）

同一个 bundle 也能装进终端界面 profile：

```bash
cd <repo> && dsh plugin --profile dsh-tui add .
```

安装后，本 bundle 成为该 profile 的**第三层 patch**，叠在 TUI 包之上：`dsh.profile.bundles`
变为 `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`，
`dsh --profile dsh-tui --dump-config` 会把我们的行显示在独立的一层里
（`# == @deepseek-harness-tui/dsh-tui, patched by @mpd-dsh/mpd`）。TUI 会话默认使用 **mpd**
preset。用 `dsh-tui` 启动器（别名 `dst`）启动：

```bash
dsh-tui            # 在当前目录启动
dsh-tui --resume   # 继续上一个会话（简写 -c）
dsh-tui doctor     # 检查 profile 与工具链
dsh-tui --help     # update | doctor | version | help；其余参数原样转发给 `dsh --profile dsh-tui`
```

`dsh-tui` 需要真实终端：如果输出被重定向到管道，它会拒绝启动并提示
`Error: dsh-tui requires an interactive terminal (stdout must be a TTY).`

### 从打包产物安装

如果要使用已发布包或 tarball，先组装出可迁移的 bundle，再把该产物加入你实际使用的那个 profile：

```bash
node scripts/pack-mpd.mjs                       # -> dist/mpd-package/（可迁移）
dsh plugin --profile web add dist/mpd-package
dsh plugin --profile dsh-tui add dist/mpd-package
```

### 卸载

每条 `dsh plugin` 命令都必须带 `--profile` —— 不带时 CLI 会直接停下并提示
`error: required option '--profile <name>' not specified`：

```bash
dsh plugin --profile web remove @mpd-dsh/mpd
dsh plugin --profile dsh-tui remove @mpd-dsh/mpd
```

本 bundle 作为一个整体卸载，skills 也包含在内，并在你的 DSH home 中不留残留。留下来的都是你自己的
数据：workmate 库（`~/.mpd/workmate/`）与各工作区的 `.mpd/` 状态。

### 这次安装挂载了哪些插件

下面每一个插件都由 bundle patch `packages/mpd-bundle/cordis.patch.yml` 声明，并被上面那一条
`dsh plugin add` 一次性挂载。该 patch 一共写了 **27 个 `- id:` 条目，分两种**：**本 bundle 插入
（insert）的 25 行**（分组如下）与**它 id 定向（id-target，即 replace，不是 insert）的 2 个宿主行**。
`node scripts/verify-rows-parity.mjs` 校验的正是这 25 个 insert id。

**Bundle 宿主插件 —— 18 个 insert 行**

| Row id | 包 | 提供的能力 |
|---|---|---|
| `mpd-web-compat` | `mpd-bundle-plugin` | 名为 `@mpd-dsh/mpd` 的 loader entry，让 bundle 的 web 客户端能被加载；同时也是合并后的 Web 界面（见 *Web GUI*） |
| `mpd-dsh-adapter` | `mpd-dsh-adapter-plugin` | 与 harness 的 tool/agent/skill/preset 接缝之间唯一的接触面；其他每一行都经由它调用 |
| `mpd-config` | `mpd-config-plugin` | `.mpd/mpd.jsonc` 配置层、`mpdConfig` 服务、`mpd_config_get` / `mpd_config_reload` |
| `mpd-team-watchdog` | `mpd-team-watchdog-plugin` | 团队通道的停滞检测：心跳尾部、事件记录、保留式 hold |
| `mpd-tools` | `mpd-tools-plugin` | 内置文件工具的写入守卫、输出截断与编辑失败恢复提示 |
| `mpd-modelchain` | `mpd-modelchain-plugin` | `mpd_modelchain_resolve`，以及 `mpd_memory_save` / `mpd_memory_recall` |
| `mpd-ext` | `mpd-ext-plugin` | 扩展接口：清单发现、四个检查工具、stdio MCP 桥、作者 CLI |
| `mpd-roles` | `mpd-roles-plugin` | 专家名册与 `mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona` |
| `mpd-ulw` | `mpd-ulw-plugin` | ultrawork 循环：`mpd_ultrawork` / `mpd_ulw` 与 `/ulw`、`/ultrawork` 命令 |
| `mpd-hashline` | `mpd-hashline-plugin` | 哈希锚定编辑纪律：`mpd_hashline_read/edit/format/restore` |
| `mpd-boulder` | `mpd-boulder-plugin` | 持久化工作账本：基于 `.mpd/boulder.json` 与 `.mpd/plans/` 的 `mpd_boulder_*` |
| `mpd-comment-checker` | `mpd-comment-checker-plugin` | 基于可选 comment-checker 二进制的 `mpd_comment_check` |
| `mpd-codegraph` | `mpd-codegraph-plugin` | 二进制解析、项目索引初始化与 `/mpd-codegraph` 命令 |
| `mpd-memory` | `mpd-memory-plugin` | git/svn 后端记忆库及其反思（reflection）状态机 |
| `mpd-workmate` | `mpd-workmate-plugin` | `~/.mpd/workmate/` 下的持久 workmate 库（`mpd_workmate_*`） |
| `mpd-team-compact` | `mpd-team-compact-plugin` | 对已结束团队的成员上下文做压缩（`mpd_team_compact_run/status`） |
| `mpd-bootstrap` | `mpd-bootstrap-plugin` | 通过 harness 的 skill 接缝提供 bundle 的 skill 语料库（`<bundle>/skills` 树）；清理旧版遗留在 home 的副本 |
| `mpd-tui` | `mpd-tui-plugin` | DSH-TUI 界面：状态行、看板、`/mpd` 命令树、受管对话框、快捷键、`/settings` |

`mpd-tui` 在**每一个** profile 中都会被组合，而不只是 `dsh-tui`：在 web 或 headless 组合里，它的界面
只是降级（每缺一个 TUI 接缝就警告一次），并不会把启动拖垮。

**仓库内的 MCP 服务器 —— 4 个 insert 行**（stdio，从本仓库启动）

| Row id | 服务器名 | 提供的能力 |
|---|---|---|
| `mcp-astgrep` | `ast_grep` | 基于 AST 的检索、重写与 YAML 规则扫描（`mcp__ast_grep__*`） |
| `mcp-gitbash` | `git_bash` | Git-for-Windows shell 桥 —— **默认 `disabled: true`**（仅 Windows）；把该行改成 `disabled: false` 才会启用，在那之前不存在 `mcp__git_bash__*` 工具 |
| `mcp-lsp` | `lsp` | 语言服务器智能：诊断、跳转定义、引用查找、重命名（`mcp__lsp__*`） |
| `mcp-codegraph` | `codegraph` | 项目结构化代码图探索（`mcp__codegraph__*`） |

**整体采纳的插件 —— 1 个 insert 行**

| Row id | 包 | 提供的能力 |
|---|---|---|
| `agent-teams` | `mpd-agent-teams-plugin` | 多智能体团队引擎（MIT，采纳自 `dsh-agent-teams`，以一等主代码形式随包）：`agent_teams_*` 工具、调度器、Web 面板。见 *鸣谢* |

**远程 MCP 行 —— 2 个 insert 行**（公开服务：需要网络，按需选用）

| Row id | 服务器名 | 提供的能力 |
|---|---|---|
| `mcp-context7` | `context7` | 公开的 Context7 文档服务，走 streamable HTTP（`https://mcp.context7.com/mcp`） |
| `mcp-grepapp` | `grep_app` | 公开的 grep.app GitHub 代码检索服务，走 streamable HTTP（`https://mcp.grep.app`） |

**本 bundle id 定向（id-target，即 replace，不是 insert）的宿主行 —— 2 个**

两者都是 `@deepseek-ai/dsh-agent-presets`：它们把 preset 名册的根指向 `<bundle>/presets`，并把会话
默认 preset 设为 `mpd` —— 每个平面各一个。它们是**对宿主自带行的替换，而不是插入**：再插入一个同名
loader entry id 的行会与宿主自己的行冲突。

| Row id | 平面 | 配置内容 |
|---|---|---|
| `agent-presets` | web / base | `default: mpd`，外加一个指向 `<bundle>/presets` 的 `system` 信任根 |
| `dsh-tui-agent-presets` | `dsh-tui` | TUI 平面上的同一个默认值与同一个根 |

harness 自己的包（`@deepseek-ai/*`）属于 DSH 的依赖，而不是本 bundle 的依赖，所以它们不在这里的行
清单中 —— 它们的致谢写在 *鸣谢* 一节。

**可选工具链依赖**（声明在 `package.json` 的 `optionalDependencies` 中；如果你用自己的二进制并通过
环境变量指过去，对应的 MCP 行与工具在没有它们时也能工作）：

| 依赖 | 版本 | 用在哪 |
|---|---|---|
| `@ast-grep/cli` | `0.45.2` | `mcp-astgrep`（`mcp__ast_grep__*` 工具） |
| `@colbymchenry/codegraph` | `1.5.0` | `mcp-codegraph` 与 `mpd-codegraph` 行 |
| `@code-yeongyu/comment-checker` | `0.8.0` | `mpd_comment_check` |

## 快速上手

1. **安装**（见上），重启 `dsh`，在 **MPD** preset 上开启一个会话。
2. **让它做一件真事。** 智能体具备 `bash`/`read`/`edit` 以及 MCP 代码工具。在项目里放一个
   `AGENT.md` 来引导它；会话开始时会被自动读取。
3. **咨询一位专家。** 先用 `mpd_roles_list` 看名册，然后
   `mpd_role_spawn { role: "Architect", task: "review the module boundaries in src/" }`。
4. **把好用的留下来。** `mpd_workmate_init { base: "Architect", name: "system-architect" }`，
   之后用 `mpd_workmate_spawn { name: "system-architect", task: "…" }` 复用它。
5. **扩展成一个团队。** `agent_teams_create { name: "readme-wave", description: "Documentation
   overhaul", profile: "mpd", approval: "required" }`，在 **AgentTeams** 标签页审阅计划、批准，
   然后看感知依赖关系的调度器开工。
6. **接入你自己的能力。** 把一个扩展目录放进 `<工作区>/.mpd/extensions/`，再用 `mpd_ext_list`
   查看它。

## 主智能体与你的项目规则

本 bundle 只随包提供一个 preset：**MPD（Main Working Agent）**。在会话中选中它，你会得到：

- **自动加载项目规则** —— 每次会话开始时，智能体会尝试读取 `AGENT.md`，回退到 `AGENTS.md`，
  再回退到 `CLAUDE.md`。这个文件写一次，之后每个会话一开始就知道你的约定。
- **harness 自带工具 + 本 bundle 的工具** —— `bash`、`read`、`edit`、`glob`、`grep` 等原生工具
  直接暴露；本 bundle 新增的一切（`mpd_*`、`agent_teams_*`、MCP 服务器）就排在它们旁边。
- **内建路由** —— preset 的人设解释了专家名册、workmate 库与团队模式，因此智能体无需额外配置
  就知道该找谁。

你不必为每件事重选 preset：同一个会话保持它自己的 preset，下面每一项能力在其中都可以直接用。

## 命令

斜杠命令直接敲在会话输入框里。

| 命令 | 会发生什么 |
|---|---|
| `/ulw <目标>` | 启动一次 ultrawork 运行：先对目标做分诊，在需要计划时先立计划，然后按轮次执行，并在报告完成前通过验证关卡与质量关卡。`/ultrawork <目标>` 是同一条命令 |
| `/mpd-codegraph` | 为当前会话工作区初始化（或重跑）CodeGraph 索引 —— `.codegraph/codegraph.db`。codegraph 二进制不可用时报错：装上它，或设置 `MPD_DSH_CODEGRAPH_BIN` |
| `/agent-teams` | 为当前目标暂存（stage）一个团队。生成出来的 `/agent-teams-<profile>` 拼写（例如 `/agent-teams-mpd`）会指定 profile |
| 消息里的 `team:` / `!team` | 同样是一次显式的组队请求，只是用纯文本写出。会话起点的复杂度门只会**建议**，永远不会替你组建团队 |
| `/mpd`（TUI） | 终端命令树：只敲 `/mpd` 打开选择器；动作有 `board`、`team`、`plan`、`workmates`、`status`（`/mpd status` 打印摘要，`/mpd team` 打开团队工作流界面，`/mpd plan` 打开计划审批界面） |
| `/goal <目标>` | 创建一个持久的会话目标（宿主的目标行，由 `mpd` preset 启用）：一个会跨轮次持续推进的长期目标 |
| `/settings`（TUI） | 编辑下面 *设置* 一节列出的 `mpd.jsonc` 旋钮 |

## 按用途划分的工具

这里只是索引；下面每一小节给出可直接照抄的调用。

| 你想做的事 | 工具 |
|---|---|
| 理解代码库 | `mcp__ast_grep__*`、`mcp__lsp__*`、`mcp__codegraph__*`、`mcp__context7__*`、`mcp__grep_app__*`（`mcp__git_bash__*` 有对应的行，但**默认关闭**且仅 Windows —— 不启用就不会暴露该工具） |
| 安全地修改 | 写入守卫与输出截断行、`mpd_hashline_read/edit/format/restore`、`mpd_comment_check` |
| 推进长任务 | `mpd_ulw` / `mpd_ultrawork`、`mpd_boulder_*` |
| 保存记忆 | `mpd_memory_write/read/reflect/reflect_complete/status`、`mpd_memory_save/recall` |
| 咨询专家 | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona`、`mpd_modelchain_resolve` |
| 养一个会成长的智能体 | `mpd_workmate_list/init/spawn/reflect/match/rename/delete` |
| 运行一个团队 | `agent_teams_*`、`mpd_team_compact_run/status`、`session-watchdog-*` |
| 配置本 bundle | `.mpd/mpd.jsonc`、`mpd_config_get`、`mpd_config_reload` |
| 扩展本 bundle | `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` 以及 `extensions/` 根目录 |

### 理解代码库（MCP 服务器）

```jsonc
// 结构化检索 —— 按语法形状，而不是按文本
mcp__ast_grep__search { "pattern": "useEffect($$$)", "language": "tsx", "paths": ["src"] }
mcp__ast_grep__rewrite { "pattern": "console.log($A)", "rewrite": "logger.info($A)", "language": "typescript", "paths": ["src"], "apply": false }

// 语言服务器智能
mcp__lsp__diagnostics { "filePath": "packages/mpd-roles-plugin/src/index.ts" }
mcp__lsp__find_references { "filePath": "…/src/index.ts", "line": 42, "character": 9 }
mcp__lsp__rename { "filePath": "…", "line": 42, "character": 9, "newName": "resolvedConfig" }

// 项目代码图 —— 抛一个问题，拿回相关符号与调用路径
mcp__codegraph__codegraph_explore { "query": "how does a task get claimed and updated?" }

// 远程服务器：库文档与 GitHub 代码检索
mcp__context7__resolve-library-id { "libraryName": "zod", "query": "schema parsing" }
mcp__grep_app__searchGitHub { "query": "registerTool({", "language": ["TypeScript"] }
```

`mcp__lsp__rename` 与 `mcp__ast_grep__rewrite` / `mcp__ast_grep__scan` 会**写文件**：先用
`apply: false` 跑一遍，看清 diff，再真正应用。`mcp__git_bash__*` 默认是关闭的（仅 Windows）。
两个远程行（`context7`、`grep_app`）是公开 HTTP 服务，需要网络。

### 安全地编辑文件（哈希锚定 + 守卫）

`mpd-tools` 行给内置写入工具加了守卫：对已存在文件做内容会变化的 `write` 会被拒绝；过大的工具输出
会被截断并给出提示，而不是把上下文淹没。

对于会被反复编辑的文件，哈希锚定纪律消除了行号漂移：

```jsonc
mpd_hashline_read { "path": "src/config.ts" }        // 返回 `LINE#HASH|内容` 锚点
mpd_hashline_edit {
  "path": "src/config.ts",
  "edits": [{ "op": "replace", "pos": "42#a1b2", "end": "44#c3d4", "lines": ["new line"] }]
}
mpd_hashline_format { "path": "src/config.ts" }      // 把该文件登记给守卫
mpd_hashline_restore { "path": "src/config.ts" }     // 取消登记
```

锚点会针对当前文件校验：文件已经变化时，编辑会被拒绝并给出重映射后的引用，而不是落到错误的位置。
文件一经登记，若普通 `edit`/`write` 改动了它，守卫会发出警告。

`mpd_comment_check` 对一个或多个文件运行可选的注释/docstring 检测器
（`{ "files": [{ "path": "src/a.ts" }, { "path": "src/b.ts", "content": "…" }] }`）；它需要
`@code-yeongyu/comment-checker` 二进制，或 `MPD_DSH_COMMENT_CHECKER_BIN`。

### 推进长任务：ULW 循环

```jsonc
mpd_ulw { "objective": "make the docs gate cover every extension README", "maxRounds": 6 }
```

`mpd_ultrawork` 是完整形态：`{ objective, tier: "light"|"heavy", plan: true, hyperplan: true,
strictReview: true, maxRounds }`。这个循环先对目标做分诊，在值得立计划时先立计划，然后一轮一轮地
执行，每个验收项走一遍（pin → red → green → surface → clean）循环，之后还有独立的验证关卡，最后是
带逐通道台账的质量关卡。`heavy` 档或 `strictReview` 会强制开启验证关卡，即使任务不大。运行状态与
台账位于 `.mpd/ulw/<id>`。

同一次运行也能用命令触发：`/ulw <目标>`。

### 跟踪计划进度：boulder 账本

boulder 账本把一个会话绑定到一份计划文件，让长任务能跨越重启：

```jsonc
mpd_boulder_plans { }                                      // 列出 .mpd/plans/*.md
mpd_boulder_start { "planPath": ".mpd/plans/my-plan.md" }  // 绑定工作，状态变为 active
mpd_boulder_status { "planPath": ".mpd/plans/my-plan.md" } // 工作项、计时、恢复选项、清单进度
mpd_boulder_task_timer { "workId": "…", "taskKey": "1", "action": "start" }   // 之后用 "end"，记录 elapsed_ms
mpd_boulder_plan_progress { "planPath": ".mpd/plans/my-plan.md" }
mpd_boulder_complete { "workId": "…" }
```

状态就是会话工作区里的普通 JSON 账本 `.mpd/boulder.json`，因此新会话可以直接接着同一份计划继续，
不必重新推导停在哪里。

### 保存持久记忆

```jsonc
mpd_memory_write { "title": "Docs gate scope", "content": "verify:docs discovers every *.md under docs/ …", "kind": "fact", "tags": ["docs"], "description": "供召回的一行摘要" }
mpd_memory_read  { "query": "docs gate", "limit": 5 }
mpd_memory_status { }
mpd_memory_reflect { }                                     // 现在是否该做一次反思？
mpd_memory_reflect_complete { "title": "Week 38", "content": "…" }
mpd_memory_save { "key": "current-wave", "value": "docs-overhaul" }   // 写入 .mpd/memory.json 的键值便签
mpd_memory_recall { "key": "current-wave" }
```

`mpd_memory_write` 把一条持久条目写进以 `<工作区>/.mpd/memory/` 为根、按 agent slug 一库的
VCS 存储并提交；`kind` 取 `note`、`fact` 或 `reflection`。用哪种 VCS（`git`、`svn` 或 `both`）由
`memory.vcs` 决定，反思节奏由 `memory.reflectionEvery` 决定。

### 咨询与路由专家

```jsonc
mpd_roles_list { }
mpd_role_persona { "role": "Architect" }         // 完整人设文本
mpd_role_spawn   { "role": "Architect", "task": "review the plugin boundaries", "context": "可选上下文块" }
mpd_modelchain_resolve { "role": "Deep Worker" } // 该角色解析到的 provider/model 路由
```

一次性专家是独立上下文的另一个智能体：它返回的是结果，而不是过程记录，所以一次只让它交一件东西。
只读角色在 spawn 时被机制性地禁用七个写入工具（`write`、`edit`、`mpd_hashline_edit`、`bash`、
`mcp__ast_grep__rewrite`、`mcp__ast_grep__scan`、`mcp__lsp__rename`）—— `bash` 是**故意**禁用的，
因为 shell 同样能写文件。如果你发现自己每周都在 spawn 同一位专家，就把它提升为 workmate。

### 养一个会成长的智能体（workmate 库）

**workmate** 是一位专家带独立名字、独立人设、独立记忆与说明卡的持久副本。它住在
`~/.mpd/workmate/`，不属于任何单一项目，可跨会话复用。

```jsonc
mpd_workmate_init { "base": "Architect", "name": "system-architect", "note": "负责模块边界。" }
mpd_workmate_match { "task": "review the plugin boundaries before the release" }  // 先复用，别急着新建
mpd_workmate_spawn { "name": "system-architect", "task": "review this diff" }
mpd_workmate_reflect { "name": "system-architect", "task": "review this diff", "outcome": "Found the seam leak." }
mpd_workmate_list { }
mpd_workmate_rename { "name": "system-architect", "new_name": "arch-reviewer" }
mpd_workmate_delete { "name": "arch-reviewer" }             // 先归档；要彻底删除需 purge: true + confirm: <名字>
```

日常使用中真正要紧的规则：

- `base` 是专家的**功能名字**（`Architect`、`Deep Worker` 等）；省略 `name` 时会自动生成一个名字。
- `mpd_workmate_match` 会拿任务给库里的 workmate 打分。**如果最高分很弱（`matched: false`），
  就新建一个 workmate，不要强行匹配。**
- 名字是 ASCII 的 `[a-z0-9_-]`。rename 会整体搬走这个实例（人设、记忆、计数）；delete 先归档，
  彻底删除需要 `purge: true` 且 `confirm` 恰好等于该名字。
- 当 workmate 正被某个团队成员或一次进行中的 spawn 使用时，rename 与 delete 会被拒绝。
- **Workmates** 侧边栏标签页让你手工完成这一切：浏览、过滤、打开、从 base 选择器新建、重命名、删除。

### 运行团队

`agent_teams_*` 是一大片接口；按使用顺序，最常伸手的是这些：

```jsonc
agent_teams_create { "name": "docs-wave", "description": "README + design doc overhaul", "profile": "mpd", "approval": "required" }
agent_teams_status { }                                      // 成员、任务、依赖、交付状态
agent_teams_approve { "team_id": "…" }                       // 启动一份暂存计划（规划那一轮里绝不要调用）
agent_teams_send_message { "to": "Deep Worker", "content": "…" }
agent_teams_task_contract { "task_id": "t4" }                // 读某个任务被冻结的契约
agent_teams_reassign_task { "task_id": "t4", "assignee": "Senior Engineer" }
agent_teams_resume { "reason": "…" }                         // 在 Web 的 Stop team 暂停了这一波之后
```

成员用 `agent_teams_claim_task` / `agent_teams_update_task` 认领并更新自己的工作，用
`agent_teams_mailbox_check` 读彼此的邮件，用 `agent_teams_delete` 结束一波已经落地的工作。
`mpd_team_compact_run` 压缩一个**已结束**团队的成员上下文（captain 除外）并写下审计记录；
`mpd_team_compact_status` 读出该审计，包括某个成员被跳过的原因。`session-watchdog-*` 是停滞检测器
自己的接口（心跳、事件、保留式 hold）—— 除非你是有意释放 hold，否则它是只读的。

完整流程见下面的 *团队模式*。

### 配置与扩展

```jsonc
mpd_config_get { }                     // 全部已解析的键；mpd_config_get { "key": "ulw.maxRounds" } 只取一个
mpd_config_reload { }                  // 重新读取 mpd.jsonc 两层文件
mpd_ext_list { }                       // 本宿主已知的全部扩展：id、来源、平面、错误
mpd_ext_show { "id": "mpd-ext-example" }
mpd_flow_list { }
mpd_flow_show { "id": "…" }
```

扩展开发者 CLI 随包提供：

```bash
bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example   # 合法时退出 0，否则逐项报错并退出 1
bun scripts/mpd-ext.mjs scaffold <dir>                        # 从 templates/mpd-extension/ 起步
bun scripts/mpd-ext.mjs list                                  # 本宿主发现了什么
```

## 专家：名册

十一位专家以"一次性专家子智能体"的形式提供，而不是独立的 preset。用名字称呼他们即可（大小写、
空格或连字符写法都可以）：

**Architect**（架构评审、深度调试、自审）· **Researcher**（基于证据的代码与开源检索）·
**Planner**（只写计划，从不实现）· **Deep Worker**（端到端执行目标）· **Senior Engineer**
（主要实现与验证）· **Lead**（编排与集成）· **Explorer**（只读代码库检索）· **Reviewer**
（风险发现，不做修复）· **Plan Reviewer**（计划质量审查）· **Vision Analyst**（图像与图表）·
**Junior Engineer**（小而明确范围的改动）。

用好它们的要点：

- **让工具匹配工作规模。** 小而机械的改动交给 Junior Engineer；边界清晰的独立一块交给
  Senior Engineer 或 Deep Worker；需要证据的问题交给 Researcher 或 Explorer；要一个结论就交给
  Reviewer。
- **一次 spawn 只要一件交付物。** 每位专家在独立上下文里运行，返回的是结果，不是推理过程。
- **只读就是只读。** 十一位里有六位（Architect、Researcher、Planner、Explorer、Plan Reviewer、
  Vision Analyst）在 spawn 时被禁用写入工具，所以"评审"不会悄悄变成"改动"。
- **可复用的就提升。** `mpd_workmate_init` 能把专家变成持久 workmate（见 *养一个会成长的智能体*）。

## 团队模式

captain 设计名册与任务 DAG，你审阅并批准计划，然后由感知依赖关系的调度器执行。成员就是上面的专家；
只读纪律的成员保持只读；成员可以由 workmate 背书，这样一个队友就带着自己积累的记忆。

### 启动一个团队

```jsonc
agent_teams_create {
  "name": "docs-wave",
  "description": "Rewrite the README pair and promote the architecture doc",
  "profile": "mpd",                 // 名册 profile：11 位成员，由 captain 设计 DAG
  "approval": "required"            // 暂存计划，等待用户审批
}
```

两种审批模式，行为差别很大：

- **`approval: "required"`** —— 需要有人签字的工作都用它。captain 只搭出名册与 DAG，不派发任何任务，
  计划在 **AgentTeams** 标签页等你（或在 TUI 的 `/mpd plan` 界面）。你不批准，它就什么也不跑。
- **`approval: "automatic"`** —— 计划刚创建就被视为已批准，工作立即开始。只有在用户明确要求跳过
  审阅时才用。

你也可以用 `/agent-teams`，或在消息里写 `team:` / `!team` 来组建团队。会话起点的复杂度门只会**建议**
当前工作可能值得组队；它永远不会替你组建。

批准之前，你可以用 `agent_teams_edit_plan` 编辑暂存计划（一次有序的原子批处理：名册、任务、依赖、
受派人），并用 `agent_teams_task_contract` 查看任意任务被冻结的契约。用 `agent_teams_approve` 批准 ——
绝不要在创建这份计划的那一轮规划里就批准。

### 审批计划（`approval: "required"`）

在 **AgentTeams** 标签页里，暂存计划本身就是审批编辑器 —— 名册、任务、依赖与受派人都可编辑，
而且在派发任何任务之前就能看到依赖图。在 TUI 里：`/mpd plan`，逐字输入 `approve <teamId>`，再按
`Ctrl+X`；十秒内按两次 `Ctrl+D` 丢弃计划，`Esc` 永不产生任何变更。

一次好的审批应当抓住：没有验收标准的任务、并非真正前置的依赖，或被派了超出其纪律范围工作的成员。

### 与运行中的团队协作

- **`agent_teams_status`** 是快照：带实时活动的成员、带状态/受派人/依赖的任务、交付状态，以及每位
  成员下一个可认领的任务。
- **任务契约就是能力凭证。** 成员自己认领任务（`agent_teams_claim_task`），并用返回的 `attempt_id`
  更新它；过期 attempt 会被拒绝 —— 这正是被改派的任务不再接受迟到结果的方式。
- **邮件是直达的。** `agent_teams_send_message` 可以发给 captain 或某位具名队友；
  `agent_teams_mailbox_check` 是发之前该做的重复检查。
- **归属关系显式转移。** `agent_teams_reassign_task` 是成员之间转移工作的唯一方式（也是 captain
  接手某个任务的方式）；`agent_teams_path_owner` 在你声明 `inScope` 之前回答"这条路径归谁"。
- **暂停不等于删除。** Web 的 **Stop team** 控件会暂停一波工作，但不会取消任何东西；
  `agent_teams_resume` 让它继续。（`agent_teams_halt` 是这个暂停机制的名字，不是可以调用的工具。）
- **评审失败不需要你手工修补。** 质量类任务（`requirements`、`implementation`、`verification`、
  `review`、`repair`、`integration`）都带契约，`needs_revision` 结论会自动开出修复任务与下一轮评审；
  等这个回路走完，而不是自己重建一遍。

### 收尾：压缩或删除

当所有任务都已终结、所有成员都空闲时，`mpd_team_compact_run` 压缩成员上下文并记录审计
（captain 永不被压缩），`agent_teams_delete` 结束该团队。保持一波一个团队：这一波落地就结束它，
再开下一个。

## Web GUI

- **AgentTeams 标签页** —— 当前会话的完整团队界面：活跃与已归档团队、成员动态、任务行、依赖图、
  停止控制，以及暂存计划的审批编辑器。标签页徽标统计活跃团队数；`single: true` 会把标签页重新定位，
  而不是再开一个副本；**Auto-open when a team appears** 开关（默认开）可以关掉自动打开。
- **Workmates 标签页** —— workmate 库：列出实例的 base、使用次数与说明卡，支持过滤，打开后可看
  人设/记忆/说明卡，并提供初始化 / 重命名 / 删除流程（删除是两步确认，彻底清除还需逐字输入名字）。

两个标签页都贡献给社区侧边栏 bundle `dsh-better-sidebar`，出现在它的标签条里；没有这个 bundle 时，
两个页面各只记录一条警告、不注册任何内容，而一切仍然可以通过 `agent_teams_*` 与 `mpd_workmate_*`
工具使用。bundle 自己的 web 客户端（通过 `mpd-web-compat` 行加载）提供这些页面，并以浮动面板作为
兜底。

## DSH-TUI 版本

在 `dsh-tui` profile 下，同一个 bundle 获得与 Web 标签页对等的终端界面：提示符上方带 key 的
**状态行**（团队、boulder/计划、workmate 库）、全屏**看板**、**`/mpd`** 命令树、受管对话框、
快捷键，以及编辑 `mpd.jsonc` 旋钮的 **`/settings`** 分区 —— 它桥接到
`<工作区>/.mpd/mpd.jsonc`，并在**重启之后**生效。

- `/mpd` 打开选择器；`/mpd status` 打印摘要；`/mpd team` 打开团队工作流界面（id/名称/阶段、
  计划审阅状态、名册、任务 DAG、邮箱尾部）；`/mpd plan` 就是上面说的计划审批界面。
- 这些界面是降级而不是崩溃：如果某个 profile 没有提供 TUI 的服务接缝，它们就不会出现。

这一版的安装步骤见上面的 *安装到终端界面*；与 Web 版逐界面的对照台账（含仍未修复的偏差）见
[`docs/tui-parity.zh-CN.md`](./docs/tui-parity.zh-CN.md)，深入细节（准入、分发产物、逐包兼容性）见
[`docs/tui.zh-CN.md`](./docs/tui.zh-CN.md)。

## 设置（`.mpd/mpd.jsonc`）

配置是 JSONC，并且分层：项目文件 `<工作区>/.mpd/mpd.jsonc` 会逐键合并到用户文件
`$DSH_HOME/mpd.jsonc` 之上，**项目层获胜**。用 `mpd_config_get` 读取当前生效的值
（只看一个键：`mpd_config_get { "key": "memory.vcs" }`），用 `mpd_config_reload` 重新读取文件。

```jsonc
// <工作区>/.mpd/mpd.jsonc
{
  "memory":         { "vcs": "git", "dir": ".mpd/memory", "reflectionEvery": 20 },
  "boulder":        { "dir": ".mpd" },
  "hashline":       { "guardEditTools": true, "maxDiffChars": 4000 },
  "commentChecker": { "autoCheck": false, "bin": ".toolchain/node_modules/.bin/comment-checker" },
  "ulw":            { "maxRounds": 6, "planDir": ".mpd/plans", "stateDir": ".mpd/ulw" },
  "team":           { "stateDir": ".mpd/team" },
  "teamModels":     { "slot1": { "provider": "deepseek-official", "model": "deepseek-v4-flash", "reasoningEffort": "max" } }
}
```

| 键 | 消费方 | 含义 |
|---|---|---|
| `memory.vcs` | `mpd-memory` | `git`、`svn` 或 `both` |
| `memory.dir`、`memory.agentSlug`、`memory.reflectionEvery` | `mpd-memory` | 记忆根目录、agent slug、反思节奏 |
| `boulder.dir` | `mpd-boulder` | 账本与计划文件所在目录 |
| `hashline.guardEditTools`、`hashline.maxDiffChars`、`hashline.registryFile` | `mpd-hashline` | 守卫开关、diff 上限、登记文件 |
| `commentChecker.autoCheck`、`.bin`、`.timeoutMs`、`.maxMessageChars` | `mpd-comment-checker` | 检测器行为与二进制 |
| `ulw.maxRounds`、`ulw.planDir`、`ulw.stateDir`、`ulw.provider`、`ulw.model`、`ulw.reviewerModel`、`ulw.maxReReviews` | `mpd-ulw` | 轮次、目录、模型路由、评审上限 |
| `extensions.enable`、`extensions.disable` | `mpd-ext` | 按 id 的启用/禁用列表（进程级） |
| `extensions.mcp.*` | `mpd-ext` | MCP 桥默认值：`enabled`、`connectTimeoutMs`、`toolCallTimeoutMs` |
| `modelchain.<chainKey>` | `mpd-modelchain` | 各名册角色的 provider/model 链 |
| `team.stateDir` | `agent-teams` | 团队状态所在目录（默认 `.mpd/team`） |
| `teamModels.slot{1,2,3,4}.*` | `agent-teams`（经 `mpd-config`） | 四个团队模型槽位 |

**团队模型槽位**决定了团队成员用哪个模型（除非它自己声明了路由）：

| 槽位 | 默认路由 | 成员 |
|---|---|---|
| `slot1` | `deepseek-official` / `deepseek-v4-flash` @ `max` | Architect、Planner、Reviewer、Lead、Senior Engineer |
| `slot2` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Researcher、Explorer、Plan Reviewer |
| `slot3` | `deepseek-official` / `deepseek-v4-flash` @ `high` | Deep Worker、Junior Engineer |
| `slot4` | `deepseek-official` / `deepseek-v4-flash-vision-exp` @ `high` | Vision Analyst —— 该模型**必须**接受图像输入 |

槽位无法解析时，团队创建会**大声失败**：指名成员与槽位、不写任何团队状态，并且永远不会悄悄裁剪
`reasoningEffort`。

怎么改旋钮：

- **Web**：MPD 设置卡片编辑的是同一批键。
- **TUI**：`/settings` —— 25 个可编辑旋钮（13 个核心键 + 十二个 `teamModels` 叶子；后者是由实时
  模型目录驱动的选择项）。它打开时显示的是你**文件**里的值，而不是 schema 默认值；保存会写入当前
  会话工作区的 `<工作区>/.mpd/mpd.jsonc`，并保留注释、键顺序与尾逗号。没有活跃会话时，保存内容留在
  宿主设置文档中并报告为 `no-live-session`；有多个活跃工作区时，会以 `ambiguous-multi-root` 拒绝
  并列出每一个候选 —— 两种情况下都**不改动任何文件**，也**不会丢失**这个值。
- **两种方式都是重启后生效**：插件在挂载时就固定了配置。

`mpd-codegraph` 有意不在上表里：它的 `autoInit`、`initTimeoutMs`、`cooldownMs` 与 `binary` 来自
它的 **bundle-patch 行**，而不是 `mpd.jsonc`。

## 你的状态存放在哪里

本 bundle 写入的一切都按工作区收敛在 `.mpd/` 下，只有用户级的 workmate 库与你的 DSH home 设置例外。
卸载 bundle 只会移除代码，永远不会动你的数据。

| 路径 | 存放内容 |
|---|---|
| `<工作区>/.mpd/mpd.jsonc` | 你的项目级设置 |
| `<工作区>/.mpd/team/` | 团队状态：名册、任务、attempt、邮箱、归档 |
| `<工作区>/.mpd/memory/` | 记忆库（按 agent slug 一库） |
| `<工作区>/.mpd/memory.json` | `mpd_memory_save` 写入的键值便签 |
| `<工作区>/.mpd/boulder.json`、`<工作区>/.mpd/plans/` | boulder 账本与你的计划文件 |
| `<工作区>/.mpd/hashline-files.json` | 登记给锚定编辑守卫的文件 |
| `<工作区>/.mpd/ulw/<id>/` | ultrawork 运行状态与逐通道台账 |
| `<工作区>/.mpd/extensions/` | 按会话（项目）的扩展 |
| `<工作区>/.codegraph/` | 项目代码图（已 gitignore） |
| `~/.mpd/workmate/` | workmate 库 —— 跨项目、属于你、卸载后仍在 |
| `~/.mpd/extensions/` | 主机级扩展（可贡献 MCP 服务器与 roles） |
| `$DSH_HOME/mpd.jsonc` | 你的用户级设置，合并到每个项目文件之下 |

## 故障排查

| 症状 | 怎么办 |
|---|---|
| `error: required option '--profile <name>' not specified` | 给 `dsh plugin` 命令补上 `--profile web`（或 `--profile dsh-tui`） |
| 安装后工具或 preset 不见了 | 重启 `dsh` —— 插件模块在会话开始时就已缓存；改过代码的话还要重建该包的 `dist/` |
| `dsh-tui requires an interactive terminal` | 从真实终端启动；`dsh-tui doctor` 会检查 profile 与工具链 |
| CodeGraph 工具没有任何结果 | 用 `/mpd-codegraph` 生成 `.codegraph/codegraph.db`，并安装 `@colbymchenry/codegraph` 或设置 `MPD_DSH_CODEGRAPH_BIN` |
| `mpd_comment_check` 报告二进制缺失 | 把 `@code-yeongyu/comment-checker` 装进 `.toolchain`，或设置 `MPD_DSH_COMMENT_CHECKER_BIN` |
| workmate 的 rename/delete 被拒绝 | 该实例正被某个团队成员或进行中的 spawn 使用 —— 先结束或改派那项工作 |
| 保存过的旋钮没有生效 | 插件在挂载时固定配置：重启会话 |
| 团队任务不接受更新 | attempt 已过期 —— 任务被改派了；认领当前 attempt，或询问 captain |
| `mcp__git_bash__*` 不可用 | 该行默认 `disabled: true`（仅 Windows）；在 bundle patch 里启用它 |

更多：[`docs/user-guide.zh-CN.md`](./docs/user-guide.zh-CN.md) §11 是速查表，英文的
[`agent-references/troubleshooting.md`](./agent-references/troubleshooting.md)（面向智能体）是完整的
症状 → 原因 → 修复对照表。

## 文档地图

| 文档 | 适合谁 |
|---|---|
| [`docs/user-guide.zh-CN.md`](./docs/user-guide.zh-CN.md) | 长文使用者指南：安装/卸载、preset、工具、专家、workmate、团队、GUI、配置、扩展、故障排查 |
| [`docs/design.zh-CN.md`](./docs/design.zh-CN.md) | 详细设计文档：bundle 如何组装与挂载 —— 启动链、插件清单、状态布局 |
| [`docs/tui.zh-CN.md`](./docs/tui.zh-CN.md) | DSH-TUI 版本：安装、TUI 原生界面、准入与分发产物、兼容性台账、NOT-CLAIMED 清单 |
| [`docs/extension-authoring-guide.zh-CN.md`](./docs/extension-authoring-guide.zh-CN.md) | 编写扩展：什么时候它才是对的工具、平面选择、隔离姿态、模板实操、分发 |
| [`docs/extensions.zh-CN.md`](./docs/extensions.zh-CN.md) | 扩展开发者指南：契约、四种贡献种类、CLI |
| [`EXTENSIONS-FOR-AGENTS.md`](./EXTENSIONS-FOR-AGENTS.md) | 供智能体写扩展使用的机器契约（英文） |
| [`docs/development.zh-CN.md`](./docs/development.zh-CN.md) | 本仓库的构建、测试、QA 关卡、打包与发布 |
| [`docs/index.zh-CN.md`](./docs/index.zh-CN.md) | 文档中心与阅读顺序 |
| [`AGENTS.md`](./AGENTS.md) | 面向智能体与维护者的仓库手册（英文） |

## 架构：只留一条指引

本文刻意只讲**怎么用**。bundle 是怎么拼起来的 —— 启动链、patch 层及其顺序、插件清单与每一行注册了
什么、适配器接缝、状态布局，以及背后的各项不变量 —— 是
[`docs/design.zh-CN.md`](./docs/design.zh-CN.md) 的主题（英文版为
[`docs/design.md`](./docs/design.md)）。改动 `packages/` 下任何东西之前，先读它。

## 鸣谢

本 bundle 站在他人的工作之上，因此有必要把"哪些部分来自谁"说清楚。

- **[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** —— 作者
  **code-yeongyu** 与各位贡献者。专家名册、十一个角色描述与模型链术语来自这个项目；它固定在
  commit `8c57e46`（v5.0.0-beta.20），在这里以"适配后的队友模板与 workmate 基础模板"的形式提供。
  这份固定基线是工程参考，而不是身份标签：本仓库不是 OMO 的 fork，也不会逐版本跟随它。
- **[dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)** —— 作者
  **程序员阿江（Relakkes）**，MIT。`agent-teams` 插件被整体采纳，并作为一等主代码放在
  `packages/mpd-agent-teams-plugin/`（采纳版本 `0.1.16-rc.3-mpd`；内嵌的运行时闭包保留了每个依赖
  自己的 LICENSE）。它提供 `agent_teams_*` 背后的团队引擎与 AgentTeams Web 面板。它的许可证与声明
  保存在 [LICENSE-NOTICES.md](./LICENSE-NOTICES.md)。
- **DeepSeek Harness 宿主包（`@deepseek-ai/*`）** —— DeepSeek 团队，MIT。宿主提供了本 bundle 接入
  的插件系统、tool/agent/skill/preset 接缝、模型提供方与 Web 外壳；这些包只作为依赖被引用。
- **[ast-grep](https://github.com/ast-grep/ast-grep)**（MIT）—— `ast_grep` MCP 服务器背后的
  AST 引擎，以可选依赖 `@ast-grep/cli@0.45.2` 的方式使用。
- **[codegraph](https://github.com/colbymchenry/codegraph)**（MIT）—— `codegraph` MCP 服务器与
  `mpd-codegraph` 行背后的结构化代码图引擎，以可选依赖 `@colbymchenry/codegraph@1.5.0` 的方式使用。
- **[comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker)**（MIT）——
  `mpd_comment_check` 背后的注释/docstring 检测器，以可选依赖
  `@code-yeongyu/comment-checker@0.8.0` 的方式使用。
- **`dsh-better-sidebar`** —— 承载 AgentTeams 与 Workmates 标签页的社区侧边栏 bundle；页面贡献给它，
  而 `agent_teams_*` / `mpd_workmate_*` 工具在没有它时同样可用。
- **本仓库自己写的部分。** DSH 管道（harness 适配器、运行时插件、`mpd` preset、合并后的 web
  客户端）、DSH-TUI 版本、QA 套件、文档以及扩展接口，都是本项目自己的工作。

在此感谢以上所有项目与作者，也感谢本 bundle 所依赖的那些工具背后众多的贡献者。

## 许可证

本仓库采用 **SUL-1.0** 许可，继承自上游项目；完整文本见 [LICENSE.md](./LICENSE.md)。上游版权归
code-yeongyu 与 oh-my-openagent 贡献者所有。采纳的 `agent-teams` 组件保留其自身的 MIT 许可证，
该授权仅覆盖该组件本身 —— 本项目自己的代码并非 MIT 许可。完整声明见
[LICENSE-NOTICES.md](./LICENSE-NOTICES.md)。
