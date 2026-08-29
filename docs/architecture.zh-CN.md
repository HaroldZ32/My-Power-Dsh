# 架构

**中文** | [English](architecture.md)

my-power-dsh 如何挂载进 DeepSeek Harness (DSH)、每个部件做什么、它们如何交互。
阅读顺序：bundle 组装 → 启动链路 → 插件清单 → 交互流程 → 状态布局 → web client 接线。

## 1. 全局图景

DSH 是 Cordis host：插件是 composition（`cordis.yml` + patch 层）里的行，服务按
scope provide/consume，模型路由由会话的 request header 解析。my-power-dsh 以 **npm
bundle**（`@mpd-dsh/mpd`）交付，其 `dsh.bundle.patch`
（`packages/mpd-bundle/cordis.patch.yml`）向它安装到的任意 profile 添加行。它贡献：

- 8 个 MCP 服务器（ast-grep、git-bash [默认禁用]、LSP、codegraph + 远端 context7 / grep.app），
- 12 个 host 插件（config、tools、modelchain、roles、ulw、hashline、boulder、
  comment-checker、memory、codegraph、workmate、bootstrap）+ 采纳的 agent-teams
  插件 + bundle 自己的 web-compat/client 插件，
- 一个 agent 预设（`mpd`）和一份 skill 语料，启动时自动复制，
- 一个合并的 web client（agent-teams 活动面板 + workmate 库）。

OMO 起源的 11 个代理**不是预设**：它们作为专家 roster（`mpd-roles-plugin`）存在，
也作为采纳的 `agent-teams` `mpd` profile 中的队友实例化模板存在。

## 2. Bundle 组装（Plan D）

`scripts/pack-mpd.mjs` 组装 `dist/mpd-package/` —— 一个**没有任何 checkout 绝对路径**
的可迁移 npm 包：

| 部件 | 去向 | 原因 |
|---|---|---|
| 插件 dist | `packages/<pkg>/dist/index.js` | host 行通过 `@mpd-dsh/mpd/packages/...`（exports map）引用它们 |
| 采纳的 agent-teams | `packages/mpd-agent-teams-plugin/`（lib + `_deps/` + assets） | 整体复制，使 bundle 在任何安装布局下自包含 |
| 合并的 web client | `packages/mpd-bundle-plugin/client.js` | 作为 `@mpd-dsh/mpd` 的 `./client` export 提供 |
| 预设 + skills | `presets/`、`skills/` | 由 `mpd-bootstrap` 启动时复制到 `$DSH_HOME` |
| `cordis.patch.yml` | 包根 | `dsh.bundle.patch` 层 |

Manifest 不变式（为什么存在）：

- `main` / `exports["."]` → `packages/mpd-bundle-plugin/dist/index.js` —— loader 通过
  `exports["."]` 解析 profile bundle；没有它 bundle 无法作为 entry 加载
  （`ERR_PACKAGE_PATH_NOT_EXPORTED`）。
- `exports["./client"]` → 合并 client；`dsh.client.platform: "web"` —— 把本 bundle
  标记为 web client 贡献者。
- **`dependencies` 中不出现 `@nanmicoder/dsh-agent-teams`** —— pnpm（`dsh plugin add`
  背后的引擎）从不把 bundle 的传递依赖链到 profile 根，所以普通的包名行会静默自禁用
  （E4 缺陷，见 `docs/plan-e.md`）。采纳的插件是主代码 + 自带 vendored closure。

`scripts/build-mpd-client.mjs` 组合出合并 client（见 §7）。

## 3. 启动链路与 web-compat 自引用行

1. `dsh --profile <p>` 通过 `dsh-app-boot` 加载 `dsh.profile.bundles`（base、
   web-app/headless、`@mpd-dsh/mpd`）：每个 bundle 贡献它的 `cordis.patch.yml` 行，
   再叠加 profile 自己的 patch。
2. Cordis loader 把每行变成插件 entry。**entry 名来自行的 `name` 字段**（包名或子路径）。
3. `dsh-client-modules` 从 `ctx.loader.entries()` 构建浏览器 boot graph：对名为 `X` 的
   entry，若包 `X` 声明了 `dsh.client`（platform web）+ `exports["./client"]`，它就成为
   boot-graph 行 `/plugins/X/client.js`。
4. 浏览器加载每个行，且被服务的 client 文件必须
   `__ModuleLoader__.load({ id: "<X>", factory })` —— id 必须与行 id 一致，否则 loader
   抛 "bundle ... loaded without registering"。

**推论**：要有 web client，bundle 需要 (a) manifest 上有 `dsh.client` + `./client`，
以及 (b) 一个**准确命名为 `@mpd-dsh/mpd` 的 loader entry** —— 由 patch 自引用行提供：

```yaml
- id: mpd-web-compat
  name: '@mpd-dsh/mpd'   # 加载 bundle 自己的 no-op main（mpd-bundle-plugin）
```

这镜像了 `@linxin666/dsh-web-ui-all` 的 `web-ui-compat` 自引用行。没有它，bundle 的
client 永远不会出现在 boot graph 中（可复现验证；证据
`evidence/plan-f/web-client-adapt`）。因为 entry 名来自 patch 行，其他行必须保持
子路径名（`@mpd-dsh/mpd/packages/...`）—— 不要把它们改成裸包名。

## 4. 插件清单

| 行 id | 包 | 用途 | 工具 / 服务 | 关键配置 |
|---|---|---|---|---|
| `mpd-config` | mpd-config-plugin | 最小 `mpd.jsonc` 运行时配置层（工程 `.mpd/mpd.jsonc` 覆盖用户 `$DSH_HOME/mpd.jsonc`） | `mpd_config_get`、`mpd_config_reload`；服务 `mpdConfig` | `projectFile`、`userFile` |
| `mpd-tools` | mpd-tools-plugin | 写保护（禁止静默覆盖）、工具输出截断（token 预算）、编辑错误恢复提示 | 仅 waterfall | `writeGuard`、`truncateMaxBytes`、`recoveryHint` |
| `mpd-modelchain` | mpd-modelchain-plugin | roster 角色的 DeepSeek 路由解析 + 键值记忆注释 | `mpd_modelchain_resolve`、`mpd_memory_save`、`mpd_memory_recall` | — |
| `mpd-roles` | mpd-roles-plugin | 11 个 OMO 起源专家 roster（id/正常名/persona/模型链/只读） | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona`；服务 `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | 固定 plan→execute→verify 循环纪律 | `mpd_ultrawork`、`mpd_ulw`（轻量别名） | `maxRounds`、`maxReReviews`、`provider/model/reviewerModel`、`planDir`、`stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | 哈希锚定编辑纪律（`LINE#HASH` 锚点） | `mpd_hashline_read`、`mpd_hashline_edit`、`mpd_hashline_format`、`mpd_hashline_restore` | `guardEditTools`、`maxDiffChars`、`registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | 绑定计划 markdown 文件的持久化工作台账 | `mpd_boulder_status`、`mpd_boulder_start`、`mpd_boulder_complete`、`mpd_boulder_task_timer`、`mpd_boulder_plan_progress`、`mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | 注释/docstring 检测（可选二进制） | `mpd_comment_check` | `autoCheck`、`binary`、`timeoutMs`、`maxMessageChars` |
| `mpd-memory` | mpd-memory-plugin | VCS 支撑的记忆（git/svn）+ 反思状态机 | `mpd_memory_write`、`mpd_memory_read`、`mpd_memory_reflect`、`mpd_memory_reflect_complete`、`mpd_memory_status` | `vcs`、`dir`、`agentSlug`、`reflectionEvery` |
| `mpd-codegraph` | mpd-codegraph-plugin | codegraph 二进制解析 + 工程索引初始化 | effect（自动初始化）+ `/mpd-codegraph` 命令 | `autoInit`、`initTimeoutMs`、`cooldownMs`、`binary` |
| `mpd-workmate` | mpd-workmate-plugin | `~/.mpd/workmate/` 下的持久化可演化代理库 | `mpd_workmate_list/init/spawn/reflect/match`；服务 `mpdWorkmate`；web 路由 `/plugins/mpd-workmate/{list,init}` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | 供给：复制 `mpd` 预设 → `$DSH_HOME/.agent-presets`、skill 语料 → `$DSH_HOME/skills`（版本戳，幂等） | 仅 effect | `presetsDir`、`skipPresets`、`skillsDir`、`skipSkills` |
| `mpd-web-compat` | mpd-bundle-plugin | web-compat 自引用行：使 `@mpd-dsh/mpd` 成为 loader entry；承载合并 web client | no-op apply；`./client` | — |
| `agent-teams` | mpd-agent-teams-plugin（采纳，MIT） | 多代理团队协作（captain、成员、任务、调度器、Web 面板） | `agent_teams_*` | `stateDir`、`memberProvider`、`memberMaxDepth`、`maxMembers`、`profiles` |
| `mcp-astgrep/gitbash/lsp/codegraph/context7/grepapp` | dsh-mcp-client 实例 | 工具服务器 | `mcp__*` | 每行 |

## 5. 交互流程

### Roster → 单发专家
`mpd_role_spawn` 读取 roster 规格（`mpdRoles`），构造 `persona + task`，然后
`ctx.subagents.start("spawn", { agentOptions: { provider, model }, persona,
outputSchema, toolFilter (只读 deny) })`。模型路由来自角色链
（`roles.data.ts` chain[0]）；**凭据由 DSH 自身的凭据机制解析 —— 插件从不接触 API
key**。

### Roster → workmate → team
- `mpd_workmate_init`（base + 可选 name）把 roster base 复制到
  `~/.mpd/workmate/<name>/`（meta/persona/memory/note，上限 8/8/1.5 KiB）—— base
  保持原样。
- 工作后 `mpd_workmate_reflect` 追加有界 memory 条目（最旧淘汰）、合并 persona 修订、
  重生成 note（保留特长 + 最新任务）、`uses` 加一。
- `mpd_workmate_spawn` 一次性复用实例：persona + memory + note + 任务，走实例自身路由；
  subagent 被指示在最终报告前调用 `mpd_workmate_reflect`。
- `mpd_workmate_match` 对 note 打分（关键词重叠 + base 名加成，阈值 0.35）；低于阈值
  → `matched: false` + "新建 workmate"（绝不强行弱匹配）。
- 团队模式：`agent_teams_create(profile="mpd")` 把正常命名的 roster 暂存为队友模板。
  采纳插件中被修补的 `memberPersona()` 检查 `~/.mpd/workmate/<member-name>`：若实例
  存在，成员的系统提示会带上该 workmate 的 persona + memory + note，以及
  `mpd_workmate_reflect` 指令（"captain 查 note 后委派给以 workmate 命名的成员"）。

### 服务时序
兄弟插件提供的服务在**工具执行时惰性读取**（`mpd_modelchain`、`mpd-workmate` 在
`execute` 内 `ctx.get("mpdRoles")`），与已验证的 QA-roles-probe 模式一致：apply 时
并非所有 bundle 插件都已 apply。

## 6. 状态布局

| 路径 | 拥有者 | 说明 |
|---|---|---|
| `<workspace>/.mpd/team/` | agent-teams | 团队 stateDir 覆盖（团队 + 邮箱） |
| `<workspace>/.mpd/plans/` | mpd-boulder / mpd-ulw | 计划 markdown 文件 |
| `<workspace>/.mpd/memory.json` | mpd-modelchain | 键值注释 |
| `<workspace>/.mpd/`（VCS 记忆目录） | mpd-memory | git/svn 支撑的记忆 + 反思 |
| `<workspace>/.mpd/mpd.jsonc` | mpd-config | 工程配置层 |
| **`~/.mpd/workmate/`**（用户 HOME） | mpd-workmate | 跨工程 workmate 库 —— 用户批准的对 workspace-scoped 状态规则的刻意例外（AGENTS.md §6）；QA 以 `HOME=<sandbox>` 启动 |
| `$DSH_HOME/.agent-presets/mpd`、`$DSH_HOME/skills` | mpd-bootstrap | 版本戳，幂等 |

## 7. Web client 接线（微妙之处）

`packages/mpd-bundle-plugin/client.js`（由 `scripts/build-mpd-client.mjs` 生成）是一个
脚本：

1. 采纳的 agent-teams `lib/client.js` **逐字**内嵌 —— 它自注册
   `@nanmicoder/dsh-agent-teams`（活动浮窗 + 团队卡片 + 命令视图）；
2. 第二个 `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })`，其 factory
   `require("@nanmicoder/dsh-agent-teams")` 并挂载 `agentTeams.apply(ctx)` 外加
   **workmate 库**浮窗（`shell.overlay`，order 90）与侧边栏脚部切换按钮
   （`sidebar.footer.action`，"Workmates"）。

workmate 浮窗的 host 数据来自 `mpd-workmate` host 插件上懒注册的路由
（`GET /plugins/mpd-workmate/list`、`POST /plugins/mpd-workmate/init`）；
agent-teams 浮窗使用 `/plugins/dsh-agent-teams/{state,halt,plan,assets}`。两者都通过
`webServer.register` 注册并在 `internal/service` 绑定时重试（无 web 的 profile 保持
纯工具模式）。

## 8. 安全与隔离

- 任何插件都不存储、记录或回显凭据；QA 只复制一次沙箱的 `.credentials.yaml` 并断言
  沙箱路径。
- QA 永不动真实的 `~/.dsh` 或真实的 `~/.mpd/workmate`（HOME 被沙箱化）。
- 采纳的代码保留其 MIT 许可 + 来源声明（`LICENSE-NOTICES.md`）；运行时二进制是
  optional 依赖，绝不打包进去。
