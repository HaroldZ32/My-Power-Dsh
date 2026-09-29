# 详细设计

**中文** | [English](design.md)

my-power-dsh 的详细设计：它设计什么、遵循哪些设计原则、如何组装并挂载进 DeepSeek Harness
(DSH)、每个部件做什么、部件之间如何交互。

**本文档面向工程师，不是用户手册。** 安装 bundle、要输入的命令、设置项和操作配方都在
[`README.zh-CN.md`](../README.zh-CN.md) 与面向任务的[用户指南](user-guide.zh-CN.md)里——当某个
功能背后的机制值得深究时，那两份文档会指向本文档。

![分层架构图：DeepSeek Harness 宿主、bundle 的两层 patch、唯一的适配器接缝、用户接触到的界面，以及各个状态根目录。](./assets/images/architecture.svg)

*一张图看清 bundle 的全貌。下面 §3–§7 会把这张图逐层拆开：包结构、patch 层与启动链路、插件清单、交互流程与状态布局。同一张图的简版在 [README](../README.zh-CN.md#架构) 里。*

阅读顺序：设计范围 → 设计原则 → bundle 与包结构 → patch 层与启动链路 → 插件清单 → 交互流程 →
状态布局 → web client 接线 → TUI 接线 → 已知限制。

## 0. 本文档设计的对象

**被设计的系统是 bundle，而不是 host。** DSH（DeepSeek Harness）是 Cordis 插件 host：loader、
会话/代理运行时、模型路由、Web 与 TUI 外壳以及基础行集合都由它提供。`@mpd-dsh/mpd` 设计的是
**在这一 host 之上**新增的内容，以及新增的方式：

- 一层 **patch**：把 bundle 的各行插入到安装该 bundle 的任意 profile 中；并用一个 id-target
  加上第二个 patch 文件让
  bundle 自带的 `mpd` 预设成为这些 composition 的默认预设，
- **28 个插入行**（6 个 MCP client 行、18 个 `mpd-*` 插件行（含 `mpd-web-compat` 自引用行）、
  3 个官方 Agent Teams 行，以及挂载 bundle 已声明侧边栏依赖的 `mpd-better-sidebar` 宿主行），
  以及每一行各自拥有的服务、工具、命令、路由与状态（§4），
- 在 host 自有外壳中渲染 bundle 界面的 **web client** 与 **TUI 界面**（§7、§7b），
- bundle 写入会话工作区与用户 home 的**状态布局**（§6），以及让 QA 与这两处保持隔离的规则（§8）。

本文档**不**设计：host 自身的接缝与行集合、模型供应商，以及本 bundle 所依赖的上游成果——这些
出处记录在 [`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md)，并在 README 中概述。

## 0b. 设计原则

以下是塑造下文各部件形态的规则；违反其中任何一条的改动即使"能跑"，也是缺陷。

1. **代理才是执行者。** 所有界面的存在都是为了让"冷启动阅读本仓库"的代理行为正确：明确的约定、
   可执行的关卡、落盘的证据。名册以数据 + persona 而非散文形式交付、本文档明确写出自身限制
   （§8b）而非留待被发现，都源于此。
2. **唯一接缝接触面。** 只有一个包（`mpd-dsh-adapter`）接触 host 的工具/代理/skill/preset 接缝；
   其他所有行都经由 `mpdDsh` 服务调用。host 版本重塑接缝时，只需在该处吸收，而不必全树修改（§6b）。
   被**保留但已从组合中退役**的上游 `agent-teams` 主体同样不是例外：它的 `lib/` 依旧经由该适配器
   接触这些接缝，其背后是
   mpd 自有的桥接模块 `lib/mpd-adapter-ctx.ts`（§6b）—— 这正是这段代码被保留而不是删掉的原因。
3. **插件形态、按引用配置。** 每个能力都是 Cordis 插件行或配置好的 host 插件实例；profile 与脚本里
   不放逻辑。资产（skill 语料、`mpd` 预设）由 bundle 直接供给而非复制进 `$DSH_HOME`，因此卸载不留
   残留（§2、§6c）。
4. **状态按工作区归属，且每次调用重新解析。** 状态落在调用方会话的工作区下（`.mpd/…`），每次调用
   都经由适配器解析——绝不用模块级常量、绝不 `chdir`、绝不从行里设置 `$DSH_WORKSPACE_ROOT`（§6）。
   唯一有意的例外是用户级的 workmate 库 `~/.mpd/workmate`（§6）。
5. **没有证据的改动不算完成。** 行为性主张需要关卡或真实工具调用来支撑，而不是 composition 转储：
   `--dump-config` 只组合行、从不执行插件代码，因此永远不能作为加载证据（§4）。本文档的每项主张都
   写明其证据。
6. **QA 隔离。** QA 在临时 `DSH_HOME`、沙箱 `HOME` 与沙箱工作区中启动，绝不触碰真实的 `~/.dsh`
   或 `~/.mpd/workmate`（§8）。
7. **基线纪律与最小 diff。** 上游资产被固定并校验（`VENDOR_LOCK.json`），不追新；能满足需求的最小
   改动优先。

## 1. 全局图景

DSH 是 Cordis host：插件是 composition（`cordis.yml` + patch 层）里的行，服务按
scope provide/consume，模型路由由会话的 request header 解析。my-power-dsh 以 **npm
bundle**（`@mpd-dsh/mpd`）交付，其 `dsh.bundle.patch` 数组
（先是 `cordis.patch.yml`，再是 `presets/mpd.patch.yml`）向它安装到的任意
profile 添加行。它贡献：

- **28 个插入行**，分布在**两层**增量 patch 中：6 个 MCP client 行（本地 ast-grep、git-bash
  [默认禁用]、LSP、codegraph；远端 context7、grep.app）、18 个 `mpd-*` 插件行（含使 bundle 成为
  loader entry 的 `mpd-web-compat` 自引用行）、3 个**官方** Agent Teams 行，以及挂载 bundle 已
  声明侧边栏依赖（社区侧边栏宿主）的 `mpd-better-sidebar` 行——§4 逐一列出。第二个 patch 文件
  贡献的是 `preset-mpd` 行，
- **1 个 id-target**（不是插入行）：让 bundle 自带预设成为默认 ——
  `agent-preset-registry` → `{ default: mpd }`（§2、§6c），
- Harness 适配器（`mpd-dsh-adapter`）：所有其他行都经由它调用，
- 一个以**行**形式声明的 agent 预设（`mpd`），以及一份按引用供给的 skill 语料（不复制到 home），
- 一个合并的 web client（workmate 库页；团队界面是官方客户端插件自己的面板，§7）。

专家名册中的 11 个专家**不是预设**：它们作为专家名册（`mpd-roles-plugin`）存在，
也作为队友实例化模板存在 —— Lead 用官方 `spawn_teammate` 按名字创建，人设文本取自
`mpd_role_persona`。

## 2. Bundle 与包结构

**仓库根目录就是 bundle 包。** `package.json` 名为 `@mpd-dsh/mpd`，声明了
`dsh.bundle.patch`（数组：先是 `./cordis.patch.yml`，再是
`./presets/mpd.patch.yml`）、`dsh.client`、各行解析所依赖的
`exports` 映射以及工具链 `optionalDependencies`，因此在仓库根执行 `dsh plugin add .` 一条命令即可
完成整体安装（无需打包步骤）。`scripts/pack-mpd.ts` 是**发布**步骤：为发布/tarball 安装组装
可迁移的 `dist/mpd-package/` —— 一个**没有任何 checkout 绝对路径**的自包含 npm 包：

| 部件 | 去向 | 原因 |
|---|---|---|
| 插件 dist | `packages/<pkg>/dist/index.js` | host 行通过 `@mpd-dsh/mpd/packages/...`（exports map）引用它们 |
| 已退役的 agent-teams 主体 | `packages/mpd-agent-teams-plugin/`（lib + `_deps/` + assets） | 作为来源记录保留，并整体复制，使打包产物在任何安装布局下自包含；**没有任何行挂载它**（§4） |
| 合并的 web client | `packages/mpd-bundle-plugin/client.js` | 作为 `@mpd-dsh/mpd` 的 `./client` export 提供 |
| skills | `skills/` | 由包内直接供给：`mpd-bootstrap` 把 `skills/` 注册为 skill provider —— 不向 `$DSH_HOME` 复制 |
| 预设 | `presets/mpd.patch.yml` | `preset-mpd` **行**（`@deepseek-ai/dsh-agent-preset`、`config.id: mpd`，子 entry 列表内联），也是 manifest 的第二个 `dsh.bundle.patch` 条目 |
| `cordis.patch.yml` | 包根 | 第一个 `dsh.bundle.patch` 层（插入行与那一个 id-target） |

Manifest 不变式（为什么存在）：

- `main` / `exports["."]` → `packages/mpd-bundle-plugin/dist/index.js` —— loader 通过
  `exports["."]` 解析 profile bundle；没有它 bundle 无法作为 entry 加载
  （`ERR_PACKAGE_PATH_NOT_EXPORTED`）。
- `exports["./client"]` → 合并 client；`dsh.client.platform: "web"` —— 把本 bundle
  标记为 web client 贡献者。
- **被保留的 `agent-teams` 主体不是已声明依赖。** pnpm（`dsh plugin add`
  背后的引擎）从不把 bundle 的传递依赖链到 profile 根，普通的包名行会在模块无法解析时自禁用
  （E4 缺陷，见 `docs/plan-e.md`）。该主体是主代码 + 自带 vendored closure
  （`packages/mpd-agent-teams-plugin/_deps/`），而从 0.1.7-rc.2 起**没有任何行挂载它**。
- **`dependencies` 有四个条目：`dsh-better-sidebar` 与三个官方 Agent Teams 包**
  （`@deepseek-ai/dsh-experimental-agent-team`、`-tool-agent-team`、`-client-ui-agent-team`）。
  只声明依赖不会挂载任何东西，而只有行也会在模块无法解析时让启动致命，所以**两半都必需**：
  它们可被解析，是因为
  `@deepseek-ai/dsh-app-boot#healProfileModuleFallback` 会在 loader 运行前把非安装型 bundle 层的
  依赖闭包落到 `<profile>/node_modules`；本 bundle 则用自有的 `mpd-*-agent-team` 行挂载它们（§4）。
  检出目录安装还会先把它们落到仓库里（`bun install`）。挂载侧边栏
  的行（`mpd-better-sidebar`）带守卫且与层序无关（§4），因此自己挂载该包的组合照常工作，无法解析
  的包只降级为"没有侧边栏"，绝不会让启动失败。

`scripts/build-mpd-client.ts` 组合出合并 client（见 §7）。

**共享模块：同一个决策只实现一次。** 过去有三种形态按包复制，现在各自只有一处实现。它们都以相对
路径被引入，因此会被打包进消费方的 `dist/`，对外发布面没有任何新增。

| 模块 | 负责什么 | 消费者 |
|---|---|---|
| `packages/mpd-dsh-adapter-plugin/src/shared.ts` | 每行都需要的纯工具（不触碰任何接缝）——`isRecord`、`errorMessage`、`bundleRootOf`，并从适配器入口再导出，因此一行只需一个 import | 所有 mpd 行 |
| `packages/mpd-ext-plugin/src/skill-frontmatter.ts` | skill frontmatter 的 YAML 子集：`parseFrontmatter`、`parseYamlBlock`、`stringField`、`frontmatterBoolean`、`parseInvocation`、`isAbsent` | 扩展的 skill 面与 `mpd-bootstrap` 的语料 provider |
| `scripts/lib/repo.ts` | `repoRootFrom` 与 `readJson`——`scripts/` 下每个脚本过去都要手写一遍的两个原语 | 仓库自身的门禁与辅助脚本 |

反例是刻意的、不是疏漏：`scripts/repin-vendor.ts` 镜像了 `scripts/verify-vendor.ts` 的指纹
算法，并拿权威文件自身的字节复核这份镜像（`assertAuthorityShape()`），因此这两份 helper 的实现
体是有意保留的重复——把它们上提会破坏那条防止二者漂移的检查。

## 3. patch 层、启动链路与 web-compat 自引用行

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

5. 兄弟行是**并发** apply 的，因此任何东西都不能假设顺序：服务在工具执行时惰性解析
   （`ctx.get(...)`），而必须在启动阶段完成工作的插件应当返回 **async** 的 `apply`
   （Cordis 会 await 它），而不是推迟到之后惰性完成。`mpd-ext` 行是唯一真正在启动阶段
   完成实际工作的一行：它发现主机级扩展根，并在自己的 apply 结束之前连接这些根声明的
   stdio MCP 服务器，因此**可达服务器的第一代工具**在会话开始时就已经存在。

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

**`cordis.patch.yml` 的每一行，按 composition 列出。** patch 层是增量的，
共携带 **28 个 `insert` 行**；本 bundle 的**第二个** patch 文件（`presets/mpd.patch.yml`）再携带一个
插入行 —— `preset-mpd` —— 两个文件都列在 manifest 的 `dsh.bundle.patch` **数组**里。
`node scripts/verify-rows-parity.ts` 断言这份列表与本仓库自身的行
账目一致。另有一条 **id-target**（不是插入行）——它**替换** host 自己拥有的行——因此单独列在下面的
表里。

`Composition` 列回答"该行进入哪个 composition"：`insert` 行进入安装该 bundle 的每一个 profile
（`web + dsh-tui`）。那条 id-target 进入铸造该 registry 行的 composition。**仅证明 composition 的证据**：
`evidence/tui/composition/20260915T053445Z/raw/web-dump-config-final.txt` 与
`…/raw/dsh-tui-dump-config.txt` 在两个 composition 中列出同一批 bundle 行；该快照早于
`mpd-team-watchdog`，后者由 patch 以同区段的 `insert` 加入。转储只证明 **composition 本身**——
它从不执行插件代码，因此永远不是加载证据（§8b）。

| 行 id | 包 | Composition | 用途 | 工具 / 服务 | 关键配置 |
|---|---|---|---|---|---|
| `mcp-astgrep` | dsh-mcp-client | web + dsh-tui | 本地 ast-grep stdio 服务器；`launch.ts` 按 bundle 相对路径解析二进制（env pin → `$MPD_AST_GREP_BIN_DIR` → createRequire 可选依赖 → `<bundle>/.toolchain/node_modules/.bin` → `<bundle>/node_modules/.bin`；每个候选都会展开为该主机可执行的各种拼写：win32 解析 `.exe`/`.com`，绝不使用无 shell 运行器无法启动的 `.cmd` 垫片） | `mcp__ast_grep__*`（search / rewrite / scan） | `serverName: ast_grep`、`toolCallTimeoutMs: 60000` |
| `mcp-gitbash` | dsh-mcp-client | web + dsh-tui，**默认禁用** | 本地 git-bash stdio 服务器；上游按 Windows 专属设计，因此该行自带 `disabled: true` | 启用后为 `mcp__git_bash__*` | 改 `disabled: false` 启用 |
| `mcp-lsp` | dsh-mcp-client | web + dsh-tui | 本地 LSP 桥（`…/mpd-mcp-lsp/dist/cli.js mcp`） | `mcp__lsp__*` | `serverName: lsp`、`toolCallTimeoutMs: 60000` |
| `mcp-codegraph` | dsh-mcp-client | web + dsh-tui | 本地 codegraph stdio 服务器；`launch.ts` 按 bundle 相对路径解析二进制，并且只在调用方未设置时写入 `MPD_CODEGRAPH_BIN` | `mcp__codegraph__*` | `serverName: codegraph`、`toolCallTimeoutMs: 60000` |
| `mcp-context7` | dsh-mcp-client | web + dsh-tui（需网络） | 远端 streamable-http MCP 服务器（公共服务，按需使用） | `mcp__context7__*` | `url: https://mcp.context7.com/mcp` |
| `mcp-grepapp` | dsh-mcp-client | web + dsh-tui（需网络） | 远端 streamable-http MCP 服务器（公共服务，按需使用） | `mcp__grep_app__*` | `url: https://mcp.grep.app` |
| `mpd-web-compat` | mpd-bundle-plugin | web + dsh-tui | web-compat 自引用行：使 `@mpd-dsh/mpd` 成为 loader entry（只有存在该确切名字的 entry，web client 才会加载）；承载合并 web client | no-op apply；`./client` | — |
| `mpd-dsh-adapter` | mpd-dsh-adapter-plugin | web + dsh-tui | 与 Harness 接缝的**唯一**接触面：工具注册/guard/post-execute/execute、子代理 spawn、skill provider + 目录、preset 解析、能力探测 | 服务 `mpdDsh` | `defaultTimeoutMs`、`quiet` |
| `mpd-config` | mpd-config-plugin | web + dsh-tui | 最小 `mpd.jsonc` 运行时配置层（工程 `.mpd/mpd.jsonc` 覆盖用户 `$DSH_HOME/mpd.jsonc`）；持有设置回写（§7b） | `mpd_config_get`、`mpd_config_reload`；服务 `mpdConfig` | `projectFile`、`userFile` |
| `mpd-team-watchdog` | mpd-team-watchdog-plugin | web + dsh-tui | 面向成员**与** captain 的逐步/逐工具心跳存储、基于 `watchdog.*` 旋钮的 WARN→ESCALATE 状态机、可原子恢复的场景快照，以及写在 `<workspace>/.mpd/team/watchdog/` 下（它**自己的**命名空间：官方 Team 服务把团队状态保存在 Lead 会话日志，看门狗经由适配器读名册）的持久 hold/incident 边车文件；有意挂载在 HOST 面，使预设作用域的心跳不可能漏看被卡住的 captain | `session-watchdog-status`、`session-watchdog-hold`、`session-watchdog-resume` | `stateDir`、`warnSilenceMs`、`tickIntervalMs`、`warnStreakToEscalate`、`actionOnEscalate`、`toolInFlightMaxMs`、`holdTtlMs` |
| `mpd-tools` | mpd-tools-plugin | web + dsh-tui | 写保护（禁止静默覆盖）、工具输出截断（token 预算）、编辑错误恢复提示 | 仅 waterfall | `writeGuard`、`truncateMaxBytes`、`recoveryHint` |
| `mpd-modelchain` | mpd-modelchain-plugin | web + dsh-tui | roster 角色的 DeepSeek 路由解析 + 键值记忆注释 | `mpd_modelchain_resolve`、`mpd_memory_save`、`mpd_memory_recall` | — |
| `mpd-ext` | mpd-ext-plugin | web + dsh-tui | 扩展接口：一份冻结的描述符契约、两个面（代码 `register()` + 数据面 `mpd-ext.json`）、按生命周期划分的发现、skills/flows provider、运行时 stdio MCP 桥、扩展 role | `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show`；服务 `mpdExtensions` | `quiet` + 惰性 `mpd.jsonc` 层（`extensions.enable`、`extensions.disable`、`extensions.mcp.*`） |
| `mpd-roles` | mpd-roles-plugin | web + dsh-tui | 专家名册中的 11 个专家（正常名字/persona/模型链/只读），并在每次调用时与扩展贡献的 role 合并；为 Lead 注册名册提示词小节（persona 文本经 `mpd_role_persona` 取得，并写明实测的模型路由边界），并为名字规范化后落在只读名册成员上的在线 Team 队友注册**只读工具守卫** | `mpd_roles_list`、`mpd_role_spawn`、`mpd_role_persona`；服务 `mpdRoles` | `personasDir` |
| `mpd-ulw` | mpd-ulw-plugin | web + dsh-tui | 固定 plan→execute→verify 循环纪律（C2 ultrawork v2） | `mpd_ultrawork`、`mpd_ulw`（轻量别名）；命令 `/ulw`、`/ultrawork` | `maxRounds`、`maxReReviews`、`provider/model/reviewerModel`、`planDir`、`stateDir` |
| `mpd-hashline` | mpd-hashline-plugin | web + dsh-tui | 哈希锚定编辑纪律（`LINE#HASH` 锚点） | `mpd_hashline_read`、`mpd_hashline_edit`、`mpd_hashline_format`、`mpd_hashline_restore` | `guardEditTools`、`maxDiffChars`、`registryFile` |
| `mpd-boulder` | mpd-boulder-plugin | web + dsh-tui | 绑定计划 markdown 文件的持久化工作台账 | `mpd_boulder_status`、`mpd_boulder_start`、`mpd_boulder_complete`、`mpd_boulder_task_timer`、`mpd_boulder_plan_progress`、`mpd_boulder_plans` | `boulderDir` |
| `mpd-comment-checker` | mpd-comment-checker-plugin | web + dsh-tui | 注释/docstring 检测（可选二进制） | `mpd_comment_check` | `autoCheck`、`binary`、`timeoutMs`、`maxMessageChars` |
| `mpd-codegraph` | mpd-codegraph-plugin | web + dsh-tui | codegraph 二进制解析 + 工程索引初始化 | effect（自动初始化）+ `/mpd-codegraph` 命令 | `autoInit`、`initTimeoutMs`、`cooldownMs`、`binary` |
| `mpd-memory` | mpd-memory-plugin | web + dsh-tui | VCS 支撑的记忆（git/svn）+ 反思状态机 | `mpd_memory_write`、`mpd_memory_read`、`mpd_memory_reflect`、`mpd_memory_reflect_complete`、`mpd_memory_status` | `vcs`、`dir`、`agentSlug`、`reflectionEvery` |
| `mpd-workmate` | mpd-workmate-plugin | web + dsh-tui | `~/.mpd/workmate/` 下的持久化可演化代理库（变更操作 rename/delete，删除默认先归档） | `mpd_workmate_list/init/spawn/reflect/match/rename/delete`；服务 `mpdWorkmate`（`list`/`get`/`read`/`rename`/`delete`）；web 路由 `GET /plugins/mpd-workmate/{list,roster,get}` + `POST /plugins/mpd-workmate/{init,rename,delete}` | — |
| `mpd-team-compact` | mpd-team-compact-plugin | web + dsh-tui | 对**已结束**的团队做成员压缩（所有任务终态且所有成员 idle），经由每个成员**自己的**作用域上下文执行；captain 交由人类 `/compact` 处理；审计落在 `<workspace>/.mpd/team-compact/`，该行从不写 `.mpd/team` | `mpd_team_compact_run`、`mpd_team_compact_status` | — |
| `mpd-bootstrap` | mpd-bootstrap-plugin | web + dsh-tui | 按引用供给：经由适配器把 `<bundle>/skills` 注册为 skill provider（rank 600 `bundled`），并清理 bundle <= 0.2.6 写入 home 的带版本戳副本 | 仅 effect | `skillsDir`、`skipSkills`、`skipPresets`、`skipLegacyCleanup` |
| `mpd-tui` | mpd-tui-plugin | web + dsh-tui（在 dsh-tui 中生效，其他 composition 降级） | dsh-tui 版本的原生界面：绑定 host 的激活门控 TUI 接缝，并用 `ctx.get(id, false)` + warn-once 降级逐个探测，因此 web/headless composition 失去的是 TUI 界面而不是启动（§7b） | 无面向模型的工具；TUI 状态行 / 设置区块 / 看板 / 命令树 / 快捷键 / 对话框 / 转录渲染器 | — |
| `mpd-agent-team` | @deepseek-ai/dsh-experimental-agent-team | web + dsh-tui | **官方** Agent Teams 域服务（`ctx.agentTeams`）：隐式根名册、持久点对点邮箱与共享任务板；名册、邮箱与任务状态都持久化在 **Lead 的会话日志**里 | 服务 `agentTeams` | `maxMembers: 16`、`maxTasks: 256`、`maxPendingMessagesPerMember: 64`、`maxMessageBytes: 32768`、`disposalTimeoutMs: 5000` |
| `mpd-tool-agent-team` | @deepseek-ai/dsh-experimental-tool-agent-team | web + dsh-tui | 每位成员都会收到的九个面向模型的工具 —— `spawn_teammate`、`send_message`、`list_agents`、`wait_agent`、`interrupt_agent`、`team_task_create/list/get/update` —— 以及 `team:policy` 提示词小节 | 上述九个工具 | `freshProvider: spawn`、`forkProvider: fork` |
| `mpd-ui-agent-team` | @deepseek-ai/dsh-experimental-client-ui-agent-team | web（其他 composition 中 host 导出惰性） | 会话头部里的官方 Web 名册、共享任务板与队友导航面板；只读（没有创建/改名/删除/中断控件，也没有任务修改控件） | `/client` 浏览器半边 | — |
| `mpd-better-sidebar` | dsh-better-sidebar（bundle 已声明的依赖；entry id 有意带 `mpd-` 前缀，绝不复用该包自己的 `better-sidebar`，也不复用聚合包的 id） | web（当不存在已启用的 `@deepseek-ai/dsh-host-webserver` 条目时，守卫会禁用它，`dsh-tui` 亦然） | 挂载**承载** Workmates 标签页的社区侧边栏 bundle，因此无需第二次手动安装插件；守卫与层序无关：只要**任何被组合的 patch 层**已经点名该包 —— 每个已声明 bundle 层自身的 `dsh.bundle.patch`（例如 `@linxin666/dsh-web-all` 聚合包）、`<profileDir>/cordis.patch.yml`、`$DSH_HOME/cordis.patch.yml`，以及从 `process.argv` 读到的每个 `--patch` 覆盖层路径（两种写法、可重复）—— 或者当 `dsh-better-sidebar` 本身就是一个 bundle 层、当该包无法解析、当不存在**已启用**的 `@deepseek-ai/dsh-host-webserver` 条目（被表达式禁用的 webserver 行不算）时，本行就会禁用。外部层只有在其 patch 里含有**真正挂载该包的行**时才会抑制本行 —— 即某行的 `name` 为 `dsh-better-sidebar` 且其 `disabled` 不是字面量 `true`（匹配前先剥离 YAML 注释）；注释里的提及、或字面量 `disabled: true` 的行都不挂载任何东西，因此不会抑制我们的挂载；行扫描器无法解析的形式一律回退到保守行为（视作挂载）—— 误禁只损失侧边栏，误启用会让启动以 `duplicate prefix route` 直接失败。以上每条路径都只打印一行日志并降级为"没有侧边栏"，绝不让启动失败 | 侧边栏宿主 + 它的 tab 注册表（`ctx.betterSidebar`） | `disabled: !!js` 挂载守卫 |

**那一条 id-target**（它替换某个 composition 自带的预设选择行；id-target 是按 key 的浅覆盖，因此
host 行其余 key 会保留；没有该行的 composition 只记录 `patch: entry … not found` 并跳过）：

| entry id | 目标 | Composition | 本文档中它承载的内容 |
|---|---|---|---|
| `agent-preset-registry` | `dsh-web-app` 插入的 registry 行 | web / base 面 | `default: mpd`，因此一条 `dsh plugin add` 就选中 bundle 的预设。该 registry 只声明**一个**配置键（`default`），所以复述它是完整的；不携带该行的组合会记录 `patch: entry … not found` 并保留自己的默认值（警告，绝不是错误） |

有两行在不同的 composition 里**故意**表现不同，二者都不是缺陷：`mpd-tui` 绑定 TUI 接缝，在没有这些
接缝处（web / headless）warn-once 降级；`mpd-web-compat` 负责把 bundle 的 web client 放进启动图
（§3、§7），在其他 composition 中保持惰性。

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
  保持原样。base 只按**功能名**寻址（名册 id 会被拒绝，并给出只列名称的错误；名册界面是
  `mpd_roles_list` **工具**，它与任何其他已注册界面都从不返回 roster id）；
  省略 `name` 时由该功能名自动生成（`Deep Worker` → `deep-worker-1`）。
  `meta.json` 保留内部 `baseId` 作为溯源，而所有工具输出、路由与界面都会剥离它。
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
  `<cwd>/.mpd/team/<teamId>/team.json` **直接子目录**的只读扫描 —— 只针对**旧版**记录，因为官方
  Team 服务不会留下这种文件（归档团队位于
  `.mpd/team/archive/**`，按构造被排除）；重命名还会检查目标键。闸门、冲突守卫与变更之间
  没有 `await`，因此任何 spawn 或 reflect 都无法插队 —— 无需锁文件。这里**从不**写
  `.mpd/team` 状态（那曾是已退役插件的状态；官方服务把名册、邮箱与任务板保存在 Lead 的会话
  日志里），且读取失败时**放行**。
- 团队模式：会话智能体就是 Lead。它按成员逐个调用 `spawn_teammate`（名字、描述，以及由
  `mpd_role_persona` 文本加任务拼成的提示词），用 `team_task_create` 给每人开一条通道，再用
  `team_task_list` / `team_task_get` / `team_task_update`（对任务 `revision` 做 compare-and-set）
  与邮箱工具驱动任务板。两条实测边界是设计的一部分，不是遗漏：队友**继承 Lead 的模型路由**
  （`TeamService` 只把提示词与父会话转发给 subagent 注册表），因此 `teamModels` 槽位只作用于
  一次性咨询通道；只读名册成员的写入工具由 `mpd-roles` 上以团队身份为键的守卫拒绝，因为
  `spawn_teammate` 无法接受按队友的工具过滤器。persona 与 workmate 记忆**不会**被自动注入 ——
  它们随提示词文本一起传递。

### 扩展 → skills、flows、MCP 工具与 roles

`mpd-ext` 行提供 `mpdExtensions` 服务，并通过**同一个**校验器加载标准化的描述符
（`mpd-ext.json`，或 `register(descriptor, { root })` 的第一个参数），因此数据面目录与代码面插件
行产生完全相同的注册表条目。

- **两种发现生命周期。** apply 时根（`~/.mpd/extensions/` 与 `<bundle>/extensions/`）在该行
  apply 时扫描一次，可以贡献全部四种种类；按调用的工程根（`<会话工作区>/.mpd/extensions/`，从
  发起调用的会话工作区解析，绝不使用 `process.cwd()`）每次调用都重新读取，且只能贡献 skills 与
  flows —— 工具与 provider 的注册是进程级的，因此工程级的 `mcp`/`roles` 条目会按条目被拒绝并给出
  明确原因，而不是静默半加载。
- **skills 与 flows** 通过适配器的 `registerSkillProvider` 以每扩展独立的 provider 名提供；每个
  候选都会按 harness 自身的规则预校验，违规候选会被跳过并记录。flow 是一份声明式 JSON 文档，
  被渲染成内存中的 SKILL.md 形态候选 —— harness 没有 flow 接缝，因此这一面不新增任何接缝。
- **MCP 服务器** 在 apply 时并行、带时限地启动：运行时桥 spawn 清单声明的 stdio 子进程，依次
  执行 `initialize` → `notifications/initialized` → `tools/list`，并在插件完成激活**之前**发布
  第一代工具。之后的工具列表变化走两阶段 fetch/swap，回滚后该服务器留下的工具数量为零。工具名
  逐字节复刻 harness 的 `publicToolName` 线上契约（`mcp__<server>__<raw>`、64 字符上限、任何有损
  变换都追加 `_<12-hex sha256(server NUL raw)>`）；第三方的 `outputSchema` 要么保留、要么丢弃
  该工具（绝不改写），第三方 `inputSchema` 会被投影到 harness 强制的 schema 子集上。启动失败是
  被包容的 —— 该服务器被记录为 `unavailable`/`failed`，并带上它的 stderr 尾部。
- **roles** 由 `mpd-roles` 在每次调用时解析（在查询时把基础名册与扩展贡献的 role 惰性合并，绝不
  在 apply 时合并），因此扩展 role 可以通过 `mpd_role_spawn` / `mpd_role_persona` 使用，也可以
  作为 workmate 的基础模板。它永远不会自己变成队友：只有 Lead 用 `spawn_teammate`
  按名字创建出来，才存在队友。
- 四个工具可以检查这一切 —— `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` ——
  而 `scripts/mpd-ext.ts`（`validate` / `scaffold` / `list`）共享同一个运行时校验器。

### 服务时序
兄弟插件提供的服务在**工具执行时惰性读取**（`mpd_modelchain`、`mpd-workmate` 在
`execute` 内 `ctx.get("mpdRoles")`），与已验证的 QA-roles-probe 模式一致：apply 时
并非所有 bundle 插件都已 apply。

## 6. 状态布局

| 路径 | 拥有者 | 说明 |
|---|---|---|
| `<workspace>/.mpd/team/` | 旧版团队记录 + 看门狗**自己的**命名空间 | 官方 Team 服务把名册、邮箱与任务板保存在 Lead 的会话日志里，因此没有任何随包行会在这里写团队记录；看门狗在它下面维护 `<stateDir>/watchdog/{heartbeat,scene,hold,incidents.jsonl}`，而 workmate 在用检查仍会读取存在的旧版 `team.json` |
| `<workspace>/.mpd/team-compact/` | mpd-team-compact | 已结束团队成员上下文的压缩审计 |
| `<workspace>/.mpd/plans/` | mpd-boulder / mpd-ulw | 计划 markdown 文件 |
| `<workspace>/.mpd/memory.json` | mpd-modelchain | 键值注释 |
| `<workspace>/.mpd/`（VCS 记忆目录） | mpd-memory | git/svn 支撑的记忆 + 反思 |
| `<workspace>/.mpd/mpd.jsonc` | mpd-config | 工程配置层 |
| `<workspace>/.mpd/extensions/*/mpd-ext.json` | mpd-ext | **按调用** 的扩展面：每次调用都从发起调用的会话工作区重新读取，因此从仓库目录启动的 QA 启动不会把仓库自己的扩展泄漏进沙箱（仅 skills + flows） |
| **`~/.mpd/extensions/*/mpd-ext.json`**（用户 HOME） | mpd-ext | 主机级的用户扩展面，在 apply 时发现（skills、flows、mcp、roles）—— 与 workmate 库一样，是一处经用户批准的 HOME 作用域例外 |
| **`<bundle>/extensions/*/mpd-ext.json`** | mpd-ext | bundle 自带的主机级扩展面（skills、flows、mcp、roles）；它随包提供默认禁用的参考扩展，并在卸载时一并消失 |
| **`~/.mpd/workmate/`**（用户 HOME） | mpd-workmate | 跨工程 workmate 库（`<key>/` 实例 + `.archive/` —— 已删除实例被移出库、手动 `mv` 搬回即可恢复）—— 用户批准的对 workspace-scoped 状态规则的刻意例外（AGENTS.md §6）；QA 以 `HOME=<sandbox>` 启动 |
| `$DSH_HOME/.agent-presets/mpd*`、`$DSH_HOME/skills/*` | mpd-bootstrap | 仅历史遗留（bundle <= 0.2.6 的带版本戳副本），首次 0.3.0 启动时删除——新版本不再写 home，且预设是以**行**形式从 bundle 提供的（§6c） |

## 6b. Harness 适配器（唯一的接缝接触面）

`packages/mpd-dsh-adapter-plugin` 是本 bundle 与 DeepSeek Harness 服务之间的**唯一**接触面。所有 mpd 行都调用
`dsh.registerTool` / `dsh.guardTool` / `dsh.onPostToolExecute` / `dsh.executeTool` /
`dsh.spawnAgent` / `dsh.registerSkillProvider` / `dsh.loadSkill` / `dsh.resolvePreset`，
而不是直接使用 `ctx.tools` / `ctx.subagents` / `ctx.skills` / `ctx.agentPresets`；因此 Harness
更名或改变某个接缝时，只需改一个文件（AGENTS.md §6）。

- 该行插在所有 mpd 行之前，提供 `mpdDsh` 服务；消费方统一通过适配器自带的
  `resolveDshAdapter(ctx)` 解析——先取已挂载的服务，单元测试中则回退到本行私有的
  `createDshAdapter(ctx)`——因此所有行共用同一条解析规则。若某行还必须扛住"provider 尚未
  ACTIVE"的瞬时未命中，则改用 `createLazyDshAdapter(ctx, { label })`。
- 除接缝面之外，该包还承载 bundle 的纯工具（`src/shared.ts`，并从入口再导出）：
  `isRecord`、`errorMessage`、`bundleRootOf(import.meta.url)`。
  它们不触碰任何 Harness 接缝；它们的存在是为了让过去每行各带一份的九处 `message()`、四处
  `isRecord()` 与五处根目录解析只剩一处实现。
- 适配器不声明 `inject`，所有接缝都在调用时惰性解析：loader 会并发应用同级行（在 `apply`
  时取快照会漏报），且 Cordis 中把未注入的服务当属性读取会抛错。`capabilities()`
  为每个接缝返回布尔值，供调用方优雅降级。
- 原先散落在各插件里的归一化逻辑集中于此：缺省对象根 `parameters`、缺省文本
  `output.render`、始终对象化的 `(args, exec)`、由适配器调用 `next()` 的
  `tools/post-execute` 瀑布、`run.result` 无论 Promise 还是对象都会 await、
  `{ok, isError, value, error}` 工具调用结果、`{output, structured, stopReason}` spawn 结果。
- QA 证明：`bundle-lifecycle` 断言组合后的行、启动日志行、探针的 `ADAPTER_SEAMS=…`
  快照与 `ADAPTER_TOOL_CALL=ok`（通过归一化路径真实调用一次 `mpd_config_get`）。
- **保留代码的接缝路由（原“边界”，已于 2026-09-19 关闭；这段代码随后于 2026-09-27 从组合中
  退役）：** `packages/mpd-agent-teams-plugin` 处的 `agent-teams` 主体（MIT）作为来源记录被保留，
  且没有任何 loader 行挂载它，但它仍然
  每个 Harness 接缝都经由本适配器 —— 但
  `setup(childCtx, child)` 这一条**已计数**的例外除外（见 `AGENTS.md` §6：`lib/members.ts`
  中五行、逐行断言；该 scoped ctx 由宿主传入，会转交给 vendored 的 `_deps/dsh-agent` 助手，
  且在旧版 Alpha.2 宿主上 `childCtx` 不保证等于 `child.ctx`）。新增的
  mpd 自有模块 `lib/mpd-adapter-ctx.ts`（命名规则 `lib/mpd-*.js`，可由 delta 注册表按字节
  恢复）在 `apply` 顶部**只构建一次**门面，因此**六个**已桥接的采纳文件
  （`lib/index.ts`、`lib/capabilities.ts`、`lib/harness-compat.ts`、`lib/members.ts`、
  `lib/command.ts`、`lib/tools.ts`）使用该门面，其余采纳的服务端文件原样接收它。
  让这段代码继续经由适配器，正是它被保留而不是删除的原因：后续波次可以在不必重新推导 D6 分析的
  前提下删除它。门面惰性解析已挂载的 `mpdDsh` 服务，并在缺失时 warn-once 回退（每个插件实例
  **恰好一行**
  缺失日志），因此适配器缺席时插件仍能应用。**十四个**适配器方法承载这些调用，每个都在一个
  `capabilities()` 标志之后（一个标志可覆盖两个方法；`subagentRuntime` 复用既有的 `subagents`
  标志）：`registerHostTool`（逐字节透传，`Object.is`）、`subagentRuntime` /
  `subagentProvider` / `subagentProviders` / `startContinuableAgent` / `interruptAgent`、
  `llmListModels` / `llmResolveCallConfig`、`registerPromptSection`、`agentScope`，以及
  `agentTurn*` 家族（`startAgentTurn` / `cancelAgentTurn` / `steerAgentTurn` /
  `injectAgentMessage`）。保留的本地适配不变 —— 包装宿主 `registerContinuableSetup` 的
  `installContinuableMemberSetup` 启动安全守卫、workmate persona 注入，以及抗重新 vendor 的
  `mpd-delta` 区域。该关闭状态连同其**残留清单**写在 AGENTS.md §6（R1–R5 以及 `members.js`
  中已计数的旁路），已桥接的区域 id 记录在 `agent-references/agent-teams-deltas.md`。
- 随包消费方使用的是**适配器自己的**团队面：`teamMembership`、`teamListMembers`、
  `teamListTasks`、`teamCreateTask`、`teamGetTask`、`teamUpdateTask`、`teamSendMessage`、
  `teamSpawnTeammate`、`teamInterrupt`、`teamWaitForChange` 与 `teamLiveTeams` —— 每一个都是对
  已挂载 `agentTeams` 服务的薄投影且从不抛错，因此没有任何 mpd 插件（看门狗、名册守卫、ULW 引擎、
  TUI 或 web 路由）直接引用 `ctx.agentTeams`。

## 6c. Agent 预设层（`mpd` 预设）

`presets/mpd.patch.yml` 把 `mpd` 预设声明为一个普通的**行**：插入一行 `preset-mpd`
（`name: '@deepseek-ai/dsh-agent-preset'`、`config.id: mpd`，子 entry 列表内联在
`config.plugins` 下）。那份子列表**就是**每个 `mpd` 会话加入的 agent 层组合，而该文件是 manifest 的
第二个 `dsh.bundle.patch` 条目；`cordis.patch.yml` 把
`agent-preset-registry` id 定向为 `{ default: mpd }`。Harness **0.1.7-rc.2 替换了目录形式**：
`@deepseek-ai/dsh-agent-presets`（那个从 preset 根目录提供 `preset.yml` + `agent.cordis.yml` 的包）
已不存在，因此不再有 `<bundle>/presets` preset 根目录，也不再有 `$DSH_HOME/.agent-presets` 副本。
它是**当前实际安装的
Harness 所附 `standard` 预设的逐行镜像**，而这种镜像关系是承载性的：

- Harness 会在版本之间把面向模型的行在 host 层与预设层之间搬移。Web overlay 会禁用 HOST 侧的
  `tool-goal` / `command-goal` 行（"presets own the human command and model-facing tool"），
  因此只挂 `tool-goal` 的预设会让会话失去 `/goal`；`present` 自 0.1.5-alpha.2 才出现，
  是 Web 端"交付物"行背后的工具。缺一行就是缺一项能力 —— 而且不会产生任何报错。
- 行的 `config` 在该行 apply 时会用所装插件自己的 schemastery schema 校验。两种失效模式的可见性不同：
  **缺少必填键**会让该行失败，随后预设 registry 拒绝挂载**整个预设**
  （`agent-preset/invalid: … row(s) did not activate`），于是该预设上的每个会话都无法启动；
  **未知键**会被 schemastery 静默保留，行照常生效，但它本该携带的设置永远不会起作用。
- 实测事故（2026-09-11，Harness 0.1.5-rc.1 CLI + rc.2 包）：preset 的 persona 行仍在用
  `dsh-persona` 到 0.1.2-rc.1 为止支持的单键 `text:`。自 0.1.3-alpha.2 起该行注册的是部署 persona 的
  prefix/suffix 两个 section，且 `prefix` 为必填，于是该行失败、整个预设拒绝挂载 ——
  每次创建 `mpd` 会话都报 `$.prefix missing required value`。既有门禁全都没看见它：
  `--dump-config` 从不执行插件代码，`agentPresets.list`/`resolve` 只解析组合文件的 YAML 结构与行可解析性，
  而没有任何用例真正创建过会话。
- 对应门禁是 `skills/dsh-qa/scripts/preset-conformance.ts`：其 `--self-test` 用**已安装**的 schema
  校验 preset、bundle patch 与 QA overlay 中的每一个 `@deepseek-ai/*` 行（包含未知键，`!!js` 节点会被
  实体化），并锁定与已安装 `standard` 预设的行 id 一致；真实运行会在隔离的 `DSH_HOME`/`HOME` 中启动 web
  profile，并通过网关以 `agentPreset: "mpd"` 创建会话 —— `session/create` 会挂载该预设的 standing 组合，
  任何未激活的行都会被拒绝 —— 另有负向对照：用已废弃的 `text:` persona 形式启动同一沙箱，必须失败，
  因此该断言不可能空过。

## 7. Web client 接线（微妙之处）

`packages/mpd-bundle-plugin/client.js`（由 `scripts/build-mpd-client.ts` 生成）是一个
脚本：

1. 被保留的 agent-teams `lib/client.js` **逐字**内嵌 —— 它自注册
   `@nanmicoder/dsh-agent-teams`。它严格作为**视图库**使用：
   `scripts/patch-agent-teams-client.ts` 通过一个固定的导出桥接（export bridge）把它的视图
   （`TeamSection`、历史卡片）、监控 store、zh/en 词典与 CSS 增量导出，
   `scripts/vendor-agent-teams.ts` 在每次刷新后重新施加该桥接；采纳的 `apply(ctx)`
   **永不被调用** —— 正是它注册了已删除的那些界面；
2. 一个从同一份 vendored 主体保留下来（`src/team-page.ts`）的
   `__ModuleLoader__.load({ id: "@mpd-dsh/team-page", factory })` 条目。它的**宿主半边**是已退役
   `agent-teams` 插件的路由
   （`/plugins/dsh-agent-teams/{state,halt,plan,assets}`），而现在已经没有任何已挂载的行提供它们 ——
   因此**随包的团队界面是官方插件自己的面板**（`mpd-ui-agent-team`，见下一小节），本条目**不**被
   文档描述为提供团队界面；
3. 第三个 `__ModuleLoader__.load({ id: "@mpd-dsh/mpd", factory })`，其 factory 贡献
   **workmate 库**（作为它自己的侧边栏 Tab）。

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
`packages/mpd-bundle-plugin/test/client-harness.ts` 现在**默认**建模这个竞态（侧边栏服务在
`apply()` 之后才发布），因此一旦有人改回探测，测试会立刻失败。

**两个 mpd 界面都由侧边栏承载；团队面板则来自官方插件**：`WorkmateLibraryView` 由
`registerSidebarTab` 注册为一个 **DSH-better-sidebar** Tab
（`ctx.betterSidebar.registerTab({id: "mpd-workmate", …})`，`single: true`，order 90）。
没有 DSH-better-sidebar 时它只输出一条
警告（`… has no host (no floating fallback by design)`）并且什么都不注册，因此侧边栏之外不存在
任何界面。宿主本身并不是可选第三方附加项：`dsh-better-sidebar` 是已声明的运行时依赖，由带守卫的
`mpd-better-sidebar` 行挂载（§4），因此那条警告路径对应的是依赖缺失或损坏，而不是普通安装会遇到
的情形。**Agent Teams 面板**是另一回事，完全不依赖该侧边栏：它是官方
`@deepseek-ai/dsh-experimental-client-ui-agent-team` 客户端插件，由本 bundle 自己的
`mpd-ui-agent-team` 行挂载，注册一个会话头部动作，渲染 Lead 会话的 `agentTeam` 投影
（名册 + 任务板，只读）。`scripts/build-mpd-client.ts` 在构建期就强制侧边栏这条规则：只要有
mpd client 源注册了
`agent-teams-activity`、`conversation.chat.node`、`shell.overlay` 或 `sidebar.footer.action`
其中之一，构建即失败 —— 那正是被移除的对话内卡片、活动浮窗与 workmate 浮窗/页脚切换按钮。

host 数据来自 `mpd-workmate` host 插件上懒注册的路由
（`GET /plugins/mpd-workmate/list`；`GET /plugins/mpd-workmate/roster` —— 由 roster 填充的
base 选择器；`GET /plugins/mpd-workmate/get?name=` —— persona/memory/note 详情；`POST
/plugins/mpd-workmate/init`；以及两条变更路由 `POST /plugins/mpd-workmate/rename` +
`POST /plugins/mpd-workmate/delete`，它们返回与工具相同的 reason 编码拒绝 ——
`400 invalid-name` / `400 confirm-required` / `404 unknown` / `409 collision` /
`409 in-use`（带 `blocking` 团队列表），动词错误则为 `405` + `allow: POST`）。
全部通过
`webServer.register` 注册并在 `internal/service` 绑定时重试（无 web 的 profile 保持
纯工具模式）。

## 7b. TUI 版本接线（§7 的对应章节）

同一个 bundle 作为**第三层** patch 层挂载在宿主的 `dsh-tui` profile 下：host-base
（`@deepseek-ai/dsh-base`）→ host-tui（`@deepseek-harness-tui/dsh-tui`）→ 本 bundle，实测为
`dsh.profile.bundles = ["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`
（`evidence/tui/composition/20260915T053445Z/`）。bundle patch 只贡献一行 TUI 行：

- `mpd-tui` → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`。该包自身**不**携带
  `cordis.patch.yml`：这一行 id 由 bundle patch 独占，第二次挂载会重复 loader entry id，而 loader 会
  直接拒绝。

该插件做什么、以及刻意不做什么：

- **做**：绑定宿主那些需激活的 TUI 接缝，每一个都通过软探测（`ctx.get(id, false)`）访问，因此服务缺席
  时只降级并给出警告，而不会让启动失败：带 key 的状态行（`tuiStatus`）、`/settings` 分区
  （`tuiSettingsSections`）、全屏看板（`tuiScenes`）、`/mpd` 命令树（`tuiCommandTrees`）、快捷键
  （`tuiShortcuts`）、受管对话框（`tuiDialogs`）以及 transcript renderer 的注册（`tuiRenderers`；宿主
  不为 bundle 的 renderer 事件投射任何行）。所有注册都通过 `ctx.effect` 释放。
- **不做**：完全不写文件系统 —— settings 回写位于 `packages/mpd-config-plugin`（见下），而 TUI 包的
  零写入属性由它自己的 lane 断言（`tui-settings-bridge.ts` 的 T7 检查）。它也不主张任何已准入的
  Component 身份：bundle 级 `dsh-plugin.json` 声明 host facet，而宿主自身的准入对四个默认拒绝的
  decision-event 权限给出 `waiting_authorization`，因此 effect ledger 把这次注册记为 `undeclared`
  （`docs/tui.zh-CN.md` §4 与 §6.1）。

**接缝提供方，按组合解析顺序。**（1）**settings 分区提供方**是 `packages/mpd-config-plugin`：它通过
适配器的 `settingsRegister` 注册 `mpd` 命名空间，其 base **来自文件** —— 恰好一个会话根存活时取该工作区
的 `<workspace>/.mpd/mpd.jsonc` 值，一个都没有时取挂载时（无 exec）根，多个时给出
`ambiguous-multi-root`（绝不臆造 base）—— 并且由它负责**回写**：触发源是宿主
`settings/document-updated(ns, revision)` 事件中 `source === 'update'` 的那一支，在锁 + 原始字节
compare-and-swap + 同目录临时文件 + 原子 rename 下完成。（2）**宿主提供的 `tuiSettingsSections` 接缝**
负责渲染该分区：TUI 包为命名空间 `mpd` 注册一个分区（对缺少 config 插件的组合保留一个带保护的
fallback），宿主把这次注册绑定到它自己的 `/settings` 界面 —— 这个"提供方/宿主"分工正是界面能按文件值
打开、而 TUI 包自身从不读文件的原因。（3）**状态发布方**是 TUI 包的 `tuiStatus` 键：每个键都取自会话
工作区的 `.mpd` 状态（工作区按调用通过适配器解析），并用插件自身的 `ctx.effect` 释放，因此插件重载不会
留下过期的一行。

## 8. 安全与隔离

- 任何插件都不存储、记录或回显凭据；QA 只复制一次沙箱的 `.credentials.yaml` 并断言
  沙箱路径。
- QA 永不动真实的 `~/.dsh` 或真实的 `~/.mpd/workmate`（HOME 被沙箱化）。
- 采纳的代码保留其 MIT 许可 + 来源声明（`LICENSE-NOTICES.md`）；运行时二进制是
  optional 依赖，绝不打包进去。

## 8b. 设计的已知限制

本设计对自己"不承诺什么"是明确的。以下是读者应随身带着的限制——写出来，而不是留待被发现：

- **composition 转储不是加载证据。** `dsh --profile <p> --dump-config` 只组合行、从不执行插件
  代码，因此永远无法见证插件加载、schema 中止或接缝缺失。本文档的每项行为性主张都改用关卡或真实
  工具调用来支撑（§4）。
- **预设层只能靠真实挂载启动来验证。** 某行的 `config` 缺少**必填** key 时该行失败，
  预设 registry 随即拒绝**整个**预设（`agent-preset/invalid: … row(s) did not activate`）；
  而**未知** key 会被 schemastery 静默保留，行照常生效、那个设置却悄悄失效。`agentPresets.list` /
  `resolve` 两类都看不见；只有 `skills/dsh-qa/scripts/preset-conformance.ts`（含其反向对照）能看见
  （§6c）。
- **插件模块没有热重载。** ESM 在会话开始时缓存模块，所以插件改动在 `dsh` 重启前不可见；会话中途
  应用的改动必须在下次启动时验证。
- **两条配置路径，生效时机不同。** `mpd.jsonc` 各层（schema 默认值 → patch 行的 `config` → 文件）
  在插件挂载时读取一次，因此 `.mpd/mpd.jsonc` 的改动在下次启动时生效；设置文档路径（TUI
  `/settings` 界面、回写与 `settings/document-updated` 重读）才是实时路径（§6c、§7b）。
- **watchdog hold 目前是契约，还不是互锁。** 该行拥有 `session-watchdog-hold` / `-resume` 与持久
  hold 记录；让**官方**派发门控真正遵守 hold 是后续任务。在此之前 hold 只被记录与上报，而停下队友当前
  轮次的是官方 `interrupt_agent`（仅 Lead）（§4）。
- **被保留的团队主体**不**被挂载。** `packages/mpd-agent-teams-plugin` 作为来源记录保留：没有任何
  loader 行挂载它，所以它的任何工具、它的 `.mpd/team` 记录与它的侧边栏面板都不属于随包
  会话。它的 `lib/` 依旧经由适配器（§6b），client 半边作为视图库保留（§7）；删除它是已声明的后续
  任务，而不是疏忽。
- **web client 的 mpd 页面只做侧边栏。** 没有会话内回退：该 mpd 页面是一个侧边栏 Tab；可选接缝必须用
  `ctx.inject([...])` 挂载，而不是用一次性 `ctx.get` 探测——探测既看不见别的插件拥有的服务，也无法
  在该提供方晚挂载时恢复（§7）。侧边栏宿主随 bundle 一起安装（已声明的 `dsh-better-sidebar`
  依赖 + 带守卫的 `mpd-better-sidebar` 行，§4），因此这条限制描述的是代码路径，而不是用户需要
  自己补做的一步安装。Agent Teams 面板是按构造的例外：官方客户端插件把它渲染在**会话头部**，
  而不是侧边栏里。
- **有两行按设计是惰性或降级的。** `mcp-gitbash` 默认禁用（上游为 Windows 专属），`mpd-tui` 在没有
  TUI 接缝的 composition 中 warn-once 降级，因此"该行已被组合"与"该能力已存在"是两个不同的陈述
  （§4）。
- **vendored skill 语料是固定快照。** `skills/**` 的指纹记录在 `VENDOR_LOCK.json`；语料改动会使该
  指纹失效，因此每波改动都串行经过唯一写入者，且重新固定（re-pin）与改动落在同一个提交里。
- **本次改名与本文档的角色。** 本文档**就是** bundle 所引用的详细设计文档（`docs/design.md`，
  其孪生为 `docs/design.zh-CN.md`）；这一对自身的切换链接与对内链接由本文档维护。早于改名的记录
  ——`docs/decisions.md` 与各阶段报告——**有意**保留旧文件名：它们是历史记录，而不是现行文档。

### 从事实基线与基线度量中带过来的残留缺口

本文档定稿前阅读了两份波次前的证据产物；它们自述的限制在此如实带过来，而不是丢弃：

- **Composition 列是"组合"证据，不是"加载"证据。** 事实基线的 composition 章节依据的是 patch、两份已
  安装 profile 的 manifest 与会话实时工具列表——它自己的 `dump-config` 运行因文件系统只读而失败——因此
  §4 引用的是存档的 `evidence/tui/composition/20260915T053445Z` 产物。**本文档没有运行隔离
  `DSH_HOME` 中的挂载启动**；`skills/dsh-qa/scripts/preset-conformance.ts` 与 `bundle-lifecycle.ts`
  仍是能够证明"加载"的关卡。
- **事实基线以哈希锚定，因而会过期。** 它是在本文档改写期间测量的，所以其行号指向的是改写前的字节——但
  它所报告的问题（§4 表缺少 `mpd-team-watchdog`、`mpd-team-compact` 与 `mpd-tui`；把名册界面说成一个
  在 bundle 中毫无注册的斜杠命令；8 与 6 的 MCP 计数）在本文档中均已修复。
- **设置项数量有意不在本文档复述。** 基线度量已审计过它（`25 = 13 个非 slot 键 + 12 个 teamModels
  叶`，与 schema 声明一致），并且在本文件与其前身中都未发现过期副本；该计数属于 README / 用户指南 /
  schema 注释。给该计数的读者：那 13 是 6 个单键小节 + 7 个 `watchdog.*` 字段（不是 13 个小节），而
  `teamModels` 权威地是**四**个槽（不是三个）。
