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
- Harness 适配器（`mpd-dsh-adapter`）：所有其他行都经由它调用，
- 13 个 host 插件（adapter、config、tools、modelchain、roles、ulw、hashline、boulder、
  comment-checker、memory、codegraph、workmate、bootstrap）+ 采纳的 agent-teams
  插件 + bundle 自己的 web-compat/client 插件，
- 一个 agent 预设（`mpd`）和一份 skill 语料，由 bundle 直接供给（不复制到 home），
- 一个合并的 web client（AgentTeams 侧边栏页 + workmate 库）。

OMO 起源的 11 个代理**不是预设**：它们作为专家 roster（`mpd-roles-plugin`）存在，
也作为采纳的 `agent-teams` `mpd` profile 中的队友实例化模板存在。

## 2. Bundle 组装（Plan D）

**仓库根目录就是 bundle 包。** `package.json` 名为 `@mpd-dsh/mpd`，声明了
`dsh.bundle.patch`（`./packages/mpd-bundle/cordis.patch.yml`）、`dsh.client`、各行解析所依赖的
`exports` 映射以及工具链 `optionalDependencies`，因此在仓库根执行 `dsh plugin add .` 一条命令即可
完成整体安装（无需打包步骤）。`scripts/pack-mpd.mjs` 是**发布**步骤：为发布/tarball 安装组装
可迁移的 `dist/mpd-package/` —— 一个**没有任何 checkout 绝对路径**的自包含 npm 包：

| 部件 | 去向 | 原因 |
|---|---|---|
| 插件 dist | `packages/<pkg>/dist/index.js` | host 行通过 `@mpd-dsh/mpd/packages/...`（exports map）引用它们 |
| 采纳的 agent-teams | `packages/mpd-agent-teams-plugin/`（lib + `_deps/` + assets） | 整体复制，使 bundle 在任何安装布局下自包含 |
| 合并的 web client | `packages/mpd-bundle-plugin/client.js` | 作为 `@mpd-dsh/mpd` 的 `./client` export 提供 |
| 预设 + skills | `presets/`、`skills/` | 由包内直接供给：patch 把 preset 名册根指向 `presets/`，`mpd-bootstrap` 把 `skills/` 注册为 skill provider——不向 `$DSH_HOME` 复制 |
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
| `mpd-dsh-adapter` | mpd-dsh-adapter-plugin | 与 Harness 接缝的**唯一**接触面：工具注册/guard/post-execute/execute、子代理 spawn、skill provider + 目录、preset 解析、能力探测 | 服务 `mpdDsh` | `defaultTimeoutMs`、`quiet` |
| `mpd-roles` | mpd-roles-plugin | 11 个 OMO 起源专家 roster（id/正常名/persona/模型链/只读） | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona`；服务 `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | 固定 plan→execute→verify 循环纪律 | `mpd_ultrawork`、`mpd_ulw`（轻量别名） | `maxRounds`、`maxReReviews`、`provider/model/reviewerModel`、`planDir`、`stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | 哈希锚定编辑纪律（`LINE#HASH` 锚点） | `mpd_hashline_read`、`mpd_hashline_edit`、`mpd_hashline_format`、`mpd_hashline_restore` | `guardEditTools`、`maxDiffChars`、`registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | 绑定计划 markdown 文件的持久化工作台账 | `mpd_boulder_status`、`mpd_boulder_start`、`mpd_boulder_complete`、`mpd_boulder_task_timer`、`mpd_boulder_plan_progress`、`mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | 注释/docstring 检测（可选二进制） | `mpd_comment_check` | `autoCheck`、`binary`、`timeoutMs`、`maxMessageChars` |
| `mpd-memory` | mpd-memory-plugin | VCS 支撑的记忆（git/svn）+ 反思状态机 | `mpd_memory_write`、`mpd_memory_read`、`mpd_memory_reflect`、`mpd_memory_reflect_complete`、`mpd_memory_status` | `vcs`、`dir`、`agentSlug`、`reflectionEvery` |
| `mpd-codegraph` | mpd-codegraph-plugin | codegraph 二进制解析 + 工程索引初始化 | effect（自动初始化）+ `/mpd-codegraph` 命令 | `autoInit`、`initTimeoutMs`、`cooldownMs`、`binary` |
| `mpd-workmate` | mpd-workmate-plugin | `~/.mpd/workmate/` 下的持久化可演化代理库（变更操作 rename/delete，删除默认先归档） | `mpd_workmate_list/init/spawn/reflect/match/rename/delete`；服务 `mpdWorkmate`（`list`/`get`/`read`/`rename`/`delete`）；web 路由 `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | 按引用供给：经由适配器把 `<bundle>/skills` 注册为 skill provider（rank 600 `bundled`），并清理 bundle <= 0.2.6 写入 home 的带版本戳副本 | 仅 effect | `skillsDir`、`skipSkills`、`skipPresets`、`skipLegacyCleanup` |
| `mpd-web-compat` | mpd-bundle-plugin | web-compat 自引用行：使 `@mpd-dsh/mpd` 成为 loader entry；承载合并 web client | no-op apply；`./client` | — |
| `agent-teams` | mpd-agent-teams-plugin（采纳，MIT） | 多代理团队协作（captain、成员、任务、调度器；其视图为 AgentTeams 侧边栏 Tab 提供内容） | `agent_teams_*` | `stateDir`、`memberProvider`、`memberMaxDepth`、`maxMembers`、`profiles` |
| `mcp-astgrep/gitbash/lsp/codegraph/context7/grepapp` | dsh-mcp-client 实例 | 工具服务器 | `mcp__*` | 每行 |

## 5. 交互流程

### Roster → 单发专家
`mpd_role_spawn` 读取 roster 规格（`mpdRoles`），构造 `persona + task`，然后
`dsh.spawnAgent({ provider, model, persona,
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
- `mpd_workmate_rename { name, new_name }` **搬移**已演化的身份 —— 目录键**就是**身份，
  因此 `resolveTarget` 以目录为准，`meta.name` 只是会被修复的显示镜像，而 `renamedFrom`
  （去重、上限 10）经 `readMeta` 白名单携带先前键。冲突守卫用 `lstat`（静默覆盖空目录与
  悬空符号链接对 `existsSync` 都不可见），搬移后的写入失败会把目录回滚。
- `mpd_workmate_delete { name, purge?, confirm? }` 默认**先归档**：目录被移入
  `~/.mpd/workmate/.archive/<key>-<compactUtcStamp>/`（按构造即对 `list`/`match` 不可见 ——
  归档根没有 `meta.json`，也不是可寻址的键），两条路径都会删除索引键，而 purge 额外要求
  `confirm === name`。失败的删除会恢复索引键，因此绝不会留下被部分移除的实例。
- **使用中闸门（单一同步块）**：`assertNotBusy` 同时检查进程内的 `Map<key, count>`
  （在 `mpd_workmate_spawn` 中围绕 `dsh.spawnAgent` 增减、在 `finally` 中释放）与对
  `<cwd>/.mpd/team/<teamId>/team.json` **直接子目录**的只读扫描（归档团队位于
  `.mpd/team/archive/**`，按构造被排除）；重命名还会检查目标键。闸门、冲突守卫与变更之间
  没有 `await`，因此任何 spawn 或 reflect 都无法插队 —— 无需锁文件。这里**从不**写
  `.mpd/team` 状态（那是 agent-teams 插件的状态），且读取失败时**放行**。
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
| **`~/.mpd/workmate/`**（用户 HOME） | mpd-workmate | 跨工程 workmate 库（`<key>/` 实例 + `.archive/` —— 已删除实例被移出库、手动 `mv` 搬回即可恢复）—— 用户批准的对 workspace-scoped 状态规则的刻意例外（AGENTS.md §6）；QA 以 `HOME=<sandbox>` 启动 |
| `$DSH_HOME/.agent-presets/mpd*`、`$DSH_HOME/skills/*` | mpd-bootstrap | 仅历史遗留（bundle <= 0.2.6 的带版本戳副本），首次 0.3.0 启动时删除——新版本不再写 home |

## 6b. Harness 适配器（唯一的接缝接触面）

`packages/mpd-dsh-adapter-plugin` 是本 bundle 与 DeepSeek Harness 服务之间的**唯一**接触面。所有 mpd 行都调用
`dsh.registerTool` / `dsh.guardTool` / `dsh.onPostToolExecute` / `dsh.executeTool` /
`dsh.spawnAgent` / `dsh.registerSkillProvider` / `dsh.loadSkill` / `dsh.resolvePreset`，
而不是直接使用 `ctx.tools` / `ctx.subagents` / `ctx.skills` / `ctx.agentPresets`；因此 Harness
更名或改变某个接缝时，只需改一个文件（AGENTS.md §6）。

- 该行插在所有 mpd 行之前，提供 `mpdDsh` 服务；消费方写
  `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`，因此插件在单元测试中也能独立工作。
- 适配器不声明 `inject`，所有接缝都在调用时惰性解析：loader 会并发应用同级行（在 `apply`
  时取快照会漏报），且 Cordis 中把未注入的服务当属性读取会抛错。`capabilities()`
  为每个接缝返回布尔值，供调用方优雅降级。
- 原先散落在各插件里的归一化逻辑集中于此：缺省对象根 `parameters`、缺省文本
  `output.render`、始终对象化的 `(args, exec)`、由适配器调用 `next()` 的
  `tools/post-execute` 瀑布、`run.result` 无论 Promise 还是对象都会 await、
  `{ok, isError, value, error}` 工具调用结果、`{output, structured, stopReason}` spawn 结果。
- QA 证明：`bundle-lifecycle` 断言组合后的行、启动日志行、探针的 `ADAPTER_SEAMS=…`
  快照与 `ADAPTER_TOOL_CALL=ok`（通过归一化路径真实调用一次 `mpd_config_get`）。
- **边界：** 采纳的 `agent-teams` 插件（`packages/mpd-agent-teams-plugin`，MIT，升级时从上游重新
  vendor）**不**经过适配器——其 `lib/` 是上游主代码，重新 vendor 会覆盖改动。它保留自己的
  `ctx.*` 调用，外加唯一一处本地适配：`lib/members.js` 中的 `registerContinuableSetup`
  启动安全守卫（见 LICENSE-NOTICES.md）。

## 6c. Agent 预设层（`mpd` 预设）

`presets/mpd/agent.cordis.yml` 是每个 `mpd` 会话加入的 agent 层组合。它是**当前实际安装的
Harness 所附 `standard` 预设的逐行镜像**，而这种镜像关系是承载性的：

- Harness 会在版本之间把面向模型的行在 host 层与预设层之间搬移。Web overlay 会禁用 HOST 侧的
  `tool-goal` / `command-goal` 行（"presets own the human command and model-facing tool"），
  因此只挂 `tool-goal` 的预设会让会话失去 `/goal`；`present` 自 0.1.5-alpha.2 才出现，
  是 Web 端"交付物"行背后的工具。缺一行就是缺一项能力 —— 而且不会产生任何报错。
- 行的 `config` 在该行 apply 时会用所装插件自己的 schemastery schema 校验。两种失效模式的可见性不同：
  **缺少必填键**会让该行失败，随后 `dsh-agent-presets.mountPreset` 拒绝挂载**整个预设**
  （`agent-preset/invalid: … row(s) did not activate`），于是该预设上的每个会话都无法启动；
  **未知键**会被 schemastery 静默保留，行照常生效，但它本该携带的设置永远不会起作用。
- 实测事故（2026-09-11，Harness 0.1.5-rc.1 CLI + rc.2 包）：preset 的 persona 行仍在用
  `dsh-persona` 到 0.1.2-rc.1 为止支持的单键 `text:`。自 0.1.3-alpha.2 起该行注册的是部署 persona 的
  prefix/suffix 两个 section，且 `prefix` 为必填，于是该行失败、整个预设拒绝挂载 ——
  每次创建 `mpd` 会话都报 `$.prefix missing required value`。既有门禁全都没看见它：
  `--dump-config` 从不执行插件代码，`agentPresets.list`/`resolve` 只解析组合文件的 YAML 结构与行可解析性，
  而没有任何用例真正创建过会话。
- 对应门禁是 `skills/dsh-qa/scripts/preset-conformance.mjs`：其 `--self-test` 用**已安装**的 schema
  校验 preset、bundle patch 与 QA overlay 中的每一个 `@deepseek-ai/*` 行（包含未知键，`!!js` 节点会被
  实体化），并锁定与已安装 `standard` 预设的行 id 一致；真实运行会在隔离的 `DSH_HOME`/`HOME` 中启动 web
  profile，并通过网关以 `agentPreset: "mpd"` 创建会话 —— `session/create` 会挂载该预设的 standing 组合，
  任何未激活的行都会被拒绝 —— 另有负向对照：用已废弃的 `text:` persona 形式启动同一沙箱，必须失败，
  因此该断言不可能空过。

## 7. Web client 接线（微妙之处）

`packages/mpd-bundle-plugin/client.js`（由 `scripts/build-mpd-client.mjs` 生成）是一个
脚本：

1. 采纳的 agent-teams `lib/client.js` **逐字**内嵌 —— 它自注册
   `@nanmicoder/dsh-agent-teams`。它现在严格作为**视图库**使用：
   `scripts/patch-agent-teams-client.mjs` 通过一个固定的导出桥接（export bridge）把它的视图
   （`TeamSection`、历史卡片）、监控 store、zh/en 词典与 CSS 增量导出，
   `scripts/vendor-agent-teams.mjs` 在每次刷新后重新施加该桥接；采纳的 `apply(ctx)`
   **永不被调用** —— 正是它注册了已删除的那些界面；
2. 一个 `__ModuleLoader__.load({ id: "@mpd-dsh/team-page", factory })` —— mpd 自有的
   AgentTeams 页面（`src/team-page.js`）：它把上述采纳视图组合为一个 DSH-better-sidebar Tab
   （id `mpd-agent-teams`，order 85，`single: true`），列出本对话的进行中与已归档团队，并带上
   暂存计划审批编辑器、进行中团队数角标与 `autoOpenOnTeamActivity` 开关。其自动打开是**无 seed** 的（`openTab({ type })`）：
   从 dsh-better-sidebar 0.19 起，带 `path`/`url` 的 seed 会被路由到 DSH 原生右栏
   （`surface.openResource(fileAddress(sessionId, cwd, path))`），而不会打开本 tab 类型；因此旧实现携带的
   占位路径会让宿主去解析 `<cwd>/team-activity`，`realpath` 失败并在 GUI 抛
   `cannot resolve target …`，同时 tab 根本不会打开 —— 仅带 type 的 open 才会落到本 tab 自己的表面并展开，
   这正是"自动打开"应有的语义（`agent-teams-sidebar` 的 `seedlessAutoOpen` 锁定已发布与已服务字节；
   `team-page.test.mjs` 驱动真实 client）。**视觉一致是硬性要求**：
   页面渲染的是浮窗自己的内部结构 —— 同一个带采纳 `panel` 类的 `aside` 根（该类正是那份样式表
   声明 `--dsw-alias-*` 自定义属性的地方，而每条采纳规则都读这些变量，去掉它整个团队区就会失去
   样式）、同一个 `panelHead`（标题 + 忙碌圆点 + 收起控件，用平台自带的
   `IconChevronDownOutline14`）、同一个 `teams` 滚动体、同样的
   `emptyHint`/`archivedWrap`/`archiveLabel` 标记。只有窗口管理器那一半被内联覆盖
   （定位/尺寸交给侧栏面板、无拖拽与改宽把手、无边框/圆角/阴影/背板模糊），且收起控件驱动的是
   侧栏自己的 `store.reduce` 面板开关；
3. 第三个 `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })`，其 factory 贡献
   **workmate 库**（作为它自己的侧边栏 Tab）以及那个隐藏 `/agent-teams` 命令结果的
   `conversation.chat.commandview` 空行。

**Seam 策略（这个文件存在的意义就是防止这类故障）**：web boot 会为每个条目断言其声明的
每个 `inject` 服务都已注册；声明了但缺失的服务会让该条目停留在 `pending` 并抛出
`Failed to load plugins`，整个 GUI 直接白屏。因此 bundle factory 只声明 `slots` +
`locale`，其余每个 seam（`betterSidebar`、`sessions`、`modelDirectories` 等）都用 `ctx.get`
在一个永不抛错的 helper 后面探测 —— 缺失的服务只降级它自己那一处界面，而不是整页。
导致这一设计的漂移：当前 DSH 版本已用
`conversationViews` 取代 `conversationEvents`，而采纳的 client 半边只把该 seam 用在已删除的
对话内卡片上，因此该 client 半边现在完全不施加。每个可选挂载仍包在 try/catch 内。

**这条规则的另一半 —— 以及藏在它后面的那个 bug**：「绝不静态声明可选 seam」并不等于「用
`ctx.get` 探测它」：cordis 的服务解析走 fiber 自己的作用域，因此**由另一个插件提供的服务对一次性
探测是不可见的**；而 `notify()` 只会重新求值**声明了**该依赖的 fiber，所以探测也永远无法恢复。
在真实 GUI 上实测：`apply()` 内 `ctx.get('betterSidebar')` 返回 `false`，8 秒后返回 `true`，于是
两个侧栏页面都静默地什么都没注册，侧边栏 `+` 菜单里根本没有 mpd 的那两行。修法就是运行时自己的
模式 —— `ctx.inject(['betterSidebar'], cb)`（正是 better-sidebar 用来接它异步挂载的
`remote.session` 的同一个调用）—— 它会等待提供者、在提供者重挂载后重跑，并且**不会**把本条目
挂成 `pending`：没有该侧边栏的 profile 只是永远不触发回调。
`packages/mpd-bundle-plugin/test/client-harness.mjs` 现在**默认**建模这个竞态（侧边栏服务在
`apply()` 之后才发布），因此一旦有人改回探测，测试会立刻失败。

**两个 GUI 都只在侧边栏，任何地方都没有回退**：`WorkmateLibraryView` 由
`registerSidebarTab` 注册为一个 **DSH-better-sidebar** Tab
（`ctx.betterSidebar.registerTab({id: "mpd-workmate", …})`，`single: true`，order 90），
AgentTeams 页面由 `registerTeamSidebarTab` 注册。没有 DSH-better-sidebar 时两者各自只输出一条
警告（`… has no host (no floating fallback by design)`）并且什么都不注册，因此侧边栏之外不存在
任何界面。`scripts/build-mpd-client.mjs` 在构建期就强制这一点：只要有 mpd client 源注册了
`agent-teams-activity`、`conversation.chat.node`、`shell.overlay` 或 `sidebar.footer.action`
其中之一，构建即失败 —— 那正是被移除的对话内卡片、活动浮窗与 workmate 浮窗/页脚切换按钮。

host 数据来自 `mpd-workmate` host 插件上懒注册的路由
（`GET /plugins/mpd-workmate/list`；`GET /plugins/mpd-workmate/roster` —— 由 roster 填充的
base 选择器；`GET /plugins/mpd-workmate/get?name=` —— persona/memory/note 详情；`POST
/plugins/mpd-workmate/init`；以及两条变更路由 `POST /plugins/mpd-workmate/rename` +
`POST /plugins/mpd-workmate/delete`，它们返回与工具相同的 reason 编码拒绝 ——
`400 invalid-name` / `400 confirm-required` / `404 unknown` / `409 collision` /
`409 in-use`（带 `blocking` 团队列表），动词错误则为 `405` + `allow: POST`）；
AgentTeams 页面驱动采纳的监控 store，后者轮询
`/plugins/dsh-agent-teams/{state,halt,plan,assets}`。全部通过
`webServer.register` 注册并在 `internal/service` 绑定时重试（无 web 的 profile 保持
纯工具模式）。

## 8. 安全与隔离

- 任何插件都不存储、记录或回显凭据；QA 只复制一次沙箱的 `.credentials.yaml` 并断言
  沙箱路径。
- QA 永不动真实的 `~/.dsh` 或真实的 `~/.mpd/workmate`（HOME 被沙箱化）。
- 采纳的代码保留其 MIT 许可 + 来源声明（`LICENSE-NOTICES.md`）；运行时二进制是
  optional 依赖，绝不打包进去。
