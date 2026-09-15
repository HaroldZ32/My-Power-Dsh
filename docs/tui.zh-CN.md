# DSH-TUI 版本

[English](./tui.md) | **中文**

本页说明 my-power-dsh 的 **DSH-TUI 版本**：它提供什么、如何安装、逐包兼容性测量的结果，以及它
**明确不声明**什么。目标宿主为 `@deepseek-harness-tui/dsh-tui` 0.10.1 及其内置的准入
（admission）配置文件。

> **请先读这一段。** 本仓库**没有**发布任何一致性声明（conformance claim）。该生态的声明产物
> （`schemas/conformance-claim.schema.json`，`claimVersion` 为 `"0.15"`，`specVersion` 为
> `"community-v0.15"`，`evidenceLevel` 取 Declared/Parsed/Negotiated/Tested/Observed/Attested）
> 是一个独立的、刻意未执行的步骤。下文的每一条结论都标注了真正支撑它的证据级别；本页写作时仍在
> 进行中的验证通道一律写为 **pending（待完成）**，不会写成"已验证"。

## 1. TUI 版本包含什么

| 产物 | 路径 | 说明 |
|---|---|---|
| TUI 界面包 | `packages/mpd-tui-plugin/` | TUI 原生界面：状态行、`/settings` 区块、全屏面板场景、`/mpd` 命令树、快捷键、受中介的对话框、**宿主未投影**的转写渲染器注册（明确不声明第 10 条），以及"就绪但未激活"的决策事件接缝。 |
| 准入清单 | `dsh-plugin.json`（仓库根目录） | 整个 bundle 的**唯一**一份 Community v0.15 清单——这是刻意的偏离（见 §7）。 |
| 环境描述符 | `dsh-distribution.json`（仓库根目录） | 面向 dsh-distribution 元协议（Draft）的 `DistributionDescriptor`。 |
| TUI 组合 | `packages/mpd-bundle/cordis.patch.yml` | 新增 `mpd-tui` 行与 `dsh-tui` 花名册默认值，使 TUI 会话默认使用 **mpd** 预设。 |
| 本页 | `docs/tui.md`、`docs/tui.zh-CN.md` | 以上内容的人工说明。 |

Web 版本不受影响：同一个 bundle 仍可安装到 web profile。

## 2. 安装

```sh
dsh plugin --profile dsh-tui add /path/to/my-power-dsh
```

这一条命令就是全部安装内容（插件代码、清单、技能、MCP 行）。不存在逐包 `dsh plugin add`；
TUI 包刻意不带 `cordis.patch.yml`——第二次挂载会产生重复的 loader entry id，而 loader 会直接
拒绝。

安装后的组合实测（t5，`evidence/tui/composition/20260915T053445Z/`）：
`dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`，
本 bundle 是**第三个** patch 层；bundle patch 贡献 24 行；真实启动日志中应用期崩溃特征计数为
**0**（`unsupported JSON schema`、`JsonSchemaError`、`plugin tree failed to load`、
`failed to apply loader entry`、`Error:`）；没有重复的 loader entry id。**证据级别：**
`Observed`（一次被记录的真实 dsh-TUI 启动，加上宿主自身的 `--dump-config`）。仅有
`--dump-config` 只能证明组合，不能证明加载——崩溃特征计数来自真实启动。

TUI 会话默认使用 **mpd** 预设，由组合中的 `dsh-tui-agent-presets` 行承载（依据是抓取到的会话
记录，而不是 patch 文本）。

任何实机通道的前提：stdout 不是 TTY 时 `dsh-tui` 拒绝启动
（`dsh-tui requires an interactive terminal (stdout must be a TTY)`），因此 QA 通道必须在 tmux
内驱动真实 TUI 并抓取 pane；也正因这一边界，TUI 通道**没有**纳入 `bun run test:qa` 的自检扫描。

## 3. TUI 界面与对应的 Web 界面

原先仅存在于 Web 的界面，在 TUI 中有**等价物**，不属于同等对齐：

| Web 界面 | TUI 等价物 | 证据级别 |
|---|---|---|
| AgentTeams 侧边栏面板 | `tuiScenes` 全屏面板 + `tuiStatus` 状态行 | 已在实机通道中渲染——`evidence/tui/live/20260915T063140Z/result.json`（t8；7 个界面中 6 个） |
| Workmate 库标签页 | `tuiCommandTrees`（`/mpd …`）+ `tuiDialogs` | 同上（同一实机通道证据） |
| Bundle 悬浮窗 | `tuiStatus` 状态行；`tuiRenderers` 转写行**宿主未投影** | 状态行已渲染；渲染器行**未渲染**——见明确不声明第 10 条 |
| — | `tuiSettingsSections`（mpd.jsonc 可调项的 `/settings` 区块） | 已渲染——同上，另有限制见 §6.2 |
| — | `tuiShortcuts` | 已渲染——同上 |

13 个接缝在范围内：本波次新建 8 个（settings 区块、场景、对话框、状态、快捷键、渲染器**注册**、
决策事件尝试、组合行）；已有 5 个由既有 bundle 承载（会话事件、技能打包、主题资源、系统提示区块、
profile 组合）；**1 个（`tuiPrompt`）宿主不提供，完全不声明**；**另 1 个（`tuiRenderers`）虽已注册，
但宿主不投影任何转写行，因此其转写行同样不声明**——与 `tuiPrompt` 采用同一种明确处理，记为明确不
声明第 10 条。

## 4. 准入与分发产物

### 4.1 `dsh-plugin.json`（宿主自身的准入路径）

唯一的 bundle 级清单：`manifestVersion` 为 `0.15`，id 为 `com.mpd-dsh.mpd-tui`，只有一个 host
facet，入口为 `packages/mpd-tui-plugin/dist/index.js`，**没有** `provides`、**没有**
`requires.services`，没有 client/worker facet；四个默认拒绝的决策事件权限；
`tui.dsh/v1alpha1#DecisionEvents` **仅**作为可选要求声明，并附有书面降级说明。在宿主自身的解析、
投影与协商路径上实测：准入状态为 `waiting_authorization`，原因为四个拦截权限的
`PERMISSION_NOT_GRANTED`——这是该协议五种准入状态之一，不是解析错误。在真实 TUI 内执行
`/plugins check <dsh-plugin.json 绝对路径>` 得到相同结果并打印出我们的 id。
**证据级别：** `Parsed` + `Negotiated`（宿主模块，加一次真实 `/plugins check`），并记录了对照
实验（去掉四个权限的清单协商为 `compatible`；损坏的清单报 JSON 解析错误）。

准入状态是五态投影：`compatible / compatible_degraded / waiting_authorization / rejected / unknown`。

本包中有一处注册刻意留在清单投影之外——`/mpd` 命令，它走的是宿主的 `commands` 服务（见 §6.4）。

### 4.2 `dsh-distribution.json`（dsh-distribution 元协议）

协议**不强制**文件名（`docs/getting-started.md:27`）；本仓库采用其建议的
`dsh-distribution.json`。它是 `distribution.dsh.dev/v1alpha1` 下的 `DistributionDescriptor`，
身份为 `urn:dsh:distribution:mpd:my-power-dsh`，版本取自 `package.json` 的真实版本；包含一个
`EnvironmentComposition`（8 个组件：两个 DSH 宿主 bundle、本 bundle、插件、MCP 服务器、技能语料、
Web 客户端、TUI 版本）和一个覆盖真实数据位置的 `ManagedLayout`（9 项资源）：

| 资源 | 位置（方案前缀） | 归属 / 可迁移性 / 敏感性 |
|---|---|---|
| `workspace-config` | `dsh-workspace:.mpd/mpd.jsonc` | exclusive / portable / private |
| `workspace-state` | `dsh-workspace:.mpd` | exclusive / conditional / private |
| `codegraph-cache` | `dsh-workspace:.codegraph` | exclusive / nonportable / private |
| `workmate-library` | `dsh-home:.mpd/workmate` | shared / conditional / private |
| `workspace-extensions`、`user-extensions`、`bundle-extensions` | `dsh-workspace:.mpd/extensions`、`dsh-home:.mpd/extensions`、`dsh-bundle:extensions` | 依次 exclusive-shared-exclusive / portable / private-private-public |
| `bundle-install` | `dsh-profile:node_modules/@mpd-dsh/mpd` | exclusive / nonportable / public |
| `credentials` | `dsh-external:host-managed-credential-store` | external / external / secret |

位置使用协议的 URI 形态（仅校验形状，协议不会解引用），原因有二：真实根目录跨多个 root——会话
工作区、用户 HOME、已安装的 profile；且协议的 `relative-path` 不接受以点开头的路径段（例如
`.mpd`）。方案前缀由本仓库定义：`dsh-workspace:`（会话工作区）、`dsh-home:`（用户 HOME）、
`dsh-bundle:`（已安装 bundle）、`dsh-profile:`（DSH profile 目录）、`dsh-external:`（由宿主管理、
本 bundle 不接管的存储）。描述符中不含任何私有机器路径，也不含任何密钥值。

该描述符的诚实边界：

- 该协议目前是 **Draft**（`registry/protocols.json`），其 README 也提醒：通过格式校验**不等于**
  数据安全认证。
- `EnvironmentLifecycle`、`EnvironmentPortability`、`EnvironmentDiscovery` 三项**刻意省略**：本
  bundle 没有实现版本化的生命周期操作，也没有 clone/export/migrate 能力，并且不发布安装实例身份。
  声明为空的这些字段在结构上合法，却等于什么都没说。
- 由该协议自带一致性 CLI 执行的校验现已交付：分发通道（`t9`）把协议仓库复制进沙箱、完成构建
  （`pnpm install --frozen-lockfile` 与 `pnpm build` 均退出 0），并运行
  `packages/conformance/lib/cli.js dsh-distribution.json`（退出 0）——描述符由协议自带工具验证，
  而不是由重新实现验证（`evidence/tui/conformance/20260915T064521Z/03-distribution.log`）。通过该
  CLI 仍然只证明格式与内部一致性，绝不证明数据安全。按协议 schema 文件做的本仓库结构检查另记录在
  `evidence/tui/docs/20260915T060010Z/descriptor-check.json`。

## 5. 三个不同的版本字符串

它们**不可互换**，每个只对应一个产物：

| 字符串 | 它标识什么 | 记录位置 |
|---|---|---|
| `tui-admission/0.15` | 宿主实际执行的**配置文件**版本 | 宿主 `registry/registry-0.15.json` → `profileVersion` |
| `community-v0.15` | 声明所写的**规范**版本 | `schemas/conformance-claim.schema.json` → `specVersion` 常量（其 `claimVersion` 是另一个常量 `"0.15"`） |
| `dsh-tui-admission-v0.15` | **要求套件**版本 | `conformance/requirements-v0.15.json` → `profileVersion` |

本版本的规范目标是**宿主内置的 `tui-admission/0.15` 配置文件，修订 `d28c267`**——即已安装的
`@deepseek-harness-tui/dsh-tui` 包内自带的准入内容。它**不是**"当前生态标准"：生态当前的 main
分支根本没有 TUI 配置文件（`registry/profiles.json` 为空），因此本仓库发布的任何内容都不得被描述为
生态已认可。实测表明宿主自带内容与归档的 v0.15 内容逐字节一致（抽样 8 个文件 sha256 相同；真实
描述符的 DecisionEvents 摘要 `sha256:56440dde1b00…` 与两侧文件哈希一致），因此不存在需要追赶的更新
TUI 配置文件。

**状态词汇。** 生态使用的状态名为 Draft / Experimental / Candidate / Stable / Deprecated；本页的
对应关系是精确的：本版本是 bundle 对宿主内置配置文件的**实验性适配（experimental adaptation）**；
它对准的规范内容是**社区草案（community draft）**（`community-v0.15`，目前以宿主内置 TUI 准入策略
的形式承载）；TUI 界面接缝的**参考实现（reference implementation）**是宿主自身
（`@deepseek-harness-tui/dsh-tui`），不是本 bundle。本仓库没有任何内容是 Stable，也没有任何内容
获得生态认可。

## 6. 已知限制

### 6.1 决策事件接缝已就绪但未激活

profile 安装的插件无法注册 `tui.dsh/v1alpha1#DecisionEvents`：在宿主修订 `b246411` 上，公开的
`admit()` 直接抛出，`admitInternal` 由模块私有 token 把关，导出的生产访问器没有任何调用方——因此
身份从未被授予，注册在任何策略判断之前就被拒绝。插件因此只对其四个拦截点尝试受中介注册，把拒绝视为
预期结果，**只告警一次**，不注册任何内容，也从不使用测试专用 token 或伪造身份。**不声明任何输入、
回退、会话切换或压缩拦截。** 清单将该接缝声明为带降级说明的可选要求；使其可用的上游修复记录在研究
文档（`.mpd/recon/UPSTREAM-RESEARCH.md`）中。

相关：`trusted-in-process` 是**兼容性/审计标签，不是安全边界**。SHA-256 摘要只能证明字节一致，
**不能**证明发布者身份。

### 6.2 `/settings` 区块未与 `.mpd/mpd.jsonc` 打通

该区块声明的是真实的 mpd.jsonc 可调项（`hashline.maxDiffChars`、`commentChecker.autoCheck`、
`ulw.maxRounds`、`memory.vcs`、`team.stateDir`、`boulder.dir`），并在宿主的 settings 命名空间
`mpd` 下编辑它们。而 mpd 插件通过 `packages/mpd-config-plugin` 读取 `.mpd/mpd.jsonc`，**不是**
宿主的 settings 文档：保存的结果只写入 settings 文档，**不会**改写 `.mpd/mpd.jsonc`。现在全部六个字段
提示都已在界面上写明这一点（`mpd.jsonc <key> — not bridged: a save here does not rewrite
.mpd/mpd.jsonc`，存在于交付产物 `dist/index.js`，sha256 `5dce2563fd0e3b20…`）。真正的打通是一个已命名
的后续任务（`mpd-settings-bridge`），不是已交付行为。界面级披露已由后续任务验证：
`evidence/tui/plugin-followup/20260915T060032Z/`（`disclosure.json` 打印六个已注册提示，
`result.json` 记录验收行）。**证据级别：** 对构建产物的提示文本为 `Observed`——这并不主张"在界面上
编辑会写入配置文件"，事实恰恰相反。

### 6.3 包内技能只是资源

`packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` 随包发布，但**不**由本行注册：bundle 的语料由
`mpd-bootstrap` 从 `<bundle>/skills` 提供（18 个技能）。

### 6.4 `/mpd` 命令使用的是宿主未归属（unattributed）的 `commands` 服务

`packages/mpd-tui-plugin/src/commands.ts:53-60` 把 `/mpd` 注册到宿主的 `commands` 服务上——即宿主以
`commands.dsh/v1alpha1` 契约对外声明的那个面——而清单声明的是 `contributes.commands: []`。这两件事同时
为真：清单的 `x-mpd-tui-surfaces.whyNoContribution` 陈述的是更窄、也更精确的事实——本插件"没有通过
Command 能力注册任何 host Command"。由清单中介的 Command **贡献**面是另一条路径，它才需要贡献 id
（以及按宿主注册表 `registry/permissions-0.1.json`，`commands.invoke` 权限）。本包刻意把宿主的
`commands` 服务留在该投影之外、不声明任何贡献，因此 `contributes.commands: []` 是**真话，而不是遗漏**。

其后果是被测量并披露的，而不是被掩盖：宿主的效果台账把这次注册记为 `undeclared`，因为受中介
（`tuiPluginHost.registerCommand`）的路径需要一个已准入的组件身份，而准入按设计处于
`waiting_authorization`——这是 t10 的 F4 披露，见 `evidence/tui/review/t12/REVIEW.md:62` 与
`result.json:115`。`/mpd` 本身可用：实机通道渲染了该命令及其命令树，属于七个界面中已渲染的六个（第七个
由明确不声明第 10 条覆盖）。另一种读法——在清单里声明该命令——需要已授予的 `commands.invoke` 权限，以及
profile 安装的插件无法到达的准入路径（§6.1），因此不是本版本选择的读法。生态最终采用哪种读法，由交付报告
说明。

## 7. 对生态惯例的刻意偏离

| 偏离项 | 取值 | 为什么是刻意的 |
|---|---|---|
| 包名 | `@mpd-dsh/mpd-tui` | 保持本 bundle 的命名空间；生态使用自己的命名。 |
| 许可证 | SUL-1.0（`LICENSE.md`） | 本版本未改动；任何产物都不得声明许可证变更。 |
| 清单 | **唯一**一份 bundle 级 `dsh-plugin.json`，而非 25 份逐包清单 | 本 bundle 作为一个整体安装；清单的 host facet 指向唯一的 TUI 插件模块。 |

## 8. 逐包兼容性台账

由组合任务（t5）在 `@deepseek-harness-tui/dsh-tui` 0.10.1 上、本 bundle 作为第三个 patch 层时
测量。事实来源：`evidence/tui/composition/20260915T053445Z/ledger.json`（生成于
2026-09-15T05:54:03.989Z，sha256
`a292c88b95c8cf1f0566fa8a13e3276e2447db44079834554bb7178686974bf3`）；同目录 `ledger.md` 为人工
摘要；逐包观察、caveat 与原始产物（`raw/tool-list.json`、`raw/tui-*.log`、
`raw/dsh-tui-dump-config.txt` 等）都在旁边。下表是该测量的逐条复述，不是本页重新推导的结果。

计数：**usable 22 · inert 2 · web-only 1 · 合计 25**。

| 包 | 角色 | 分类 | 实测见证 |
|---|---|---|---|
| `mpd-bundle` | 组合层（bundle patch 本身） | usable | 组合配置含 24 行（含 `mpd-tui` 与 `dsh-tui-agent-presets` 覆盖）；真实启动 0 崩溃特征 |
| `mpd-dsh-adapter-plugin` | 与宿主接缝的唯一接触面 | usable | 应用期日志 `[mpd-dsh-adapter] mpdDsh provided` |
| `mpd-config-plugin` | mpd.jsonc 运行时配置层 | usable | 工具 `mpd_config_get`、`mpd_config_reload` |
| `mpd-tools-plugin` | 写入守卫 / 截断 / waterfall | usable | 组合行 `mpd-tools` 及其配置；不拥有工具名 |
| `mpd-modelchain-plugin` | 模型链解析 + 工作区记忆 | usable | 工具 `mpd_modelchain_resolve` |
| `mpd-ext-plugin` | 扩展注册表（技能/流程/角色/MCP） | usable | 工具 `mpd_ext_list`、`mpd_ext_show`、`mpd_flow_list`、`mpd_flow_show` |
| `mpd-roles-plugin` | 专家花名册 | usable | 工具 `mpd_role_persona`、`mpd_role_spawn`、`mpd_roles_list` |
| `mpd-ulw-plugin` | ulw 循环纪律 | usable | 工具 `mpd_ultrawork`、`mpd_ulw` |
| `mpd-hashline-plugin` | 锚点编辑纪律 | usable | 4 个 `mpd_hashline_*` 工具 |
| `mpd-boulder-plugin` | 持久工作台账 | usable | 6 个 `mpd_boulder_*` 工具 |
| `mpd-comment-checker-plugin` | 注释/文档串检测（可选二进制） | usable | 工具 `mpd_comment_check` |
| `mpd-codegraph-plugin` | codegraph 项目初始化 + 二进制解析 | usable | 应用期 `[mpd-codegraph] init status=marker …` |
| `mpd-memory-plugin` | git/svn 支撑的记忆 + 反思 | usable | 7 个 `mpd_memory_*` 工具 |
| `mpd-workmate-plugin` | 持久演化型智能体库 | usable | 7 个 `mpd_workmate_*` 工具 |
| `mpd-team-compact-plugin` | 已结束团队的压缩 | usable | 工具 `mpd_team_compact_run`、`mpd_team_compact_status` |
| `mpd-bootstrap-plugin` | 提供 bundle 技能语料（不复制到 HOME） | usable | 应用期 `skill corpus served from <bundle>/skills` |
| `mpd-tui-plugin` | TUI 原生界面包（本版本） | usable | 组合行 `mpd-tui` → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js` |
| `mpd-agent-teams-plugin` | 采用的 AgentTeams 插件（工具 + Web 面板） | usable | 17 个 `agent_teams_*` 工具 |
| `mpd-mcp-astgrep` | ast-grep MCP 服务器（stdio 启动器） | usable | 3 个 `mcp__ast_grep__*` 工具 |
| `mpd-mcp-lsp` | LSP MCP 服务器（stdio 启动器） | usable | 8 个 `mcp__lsp__*` 工具 |
| `mpd-mcp-codegraph` | codegraph MCP 服务器（stdio 启动器） | usable | 服务器在进程内运行；**在该沙箱**中 0 个工具，因为 CodeGraph 策略排除含 `.mpd` 的项目路径（沙箱现象，不是 TUI 限制） |
| `mpd-mcp-gitbash` | git-bash MCP 服务器（上游仅 Windows） | inert | 任何 profile 下该行组合为 `disabled: true` |
| `mpd-mcp-shared` | MCP 启动器共用的二进制解析库 | usable | 支持库，自身无行/工具；由已启动的 MCP 子进程间接见证 |
| `mpd-bundle-plugin` | bundle web 兼容包（浏览器客户端 + 空操作 main） | **web-only** | 无 TUI 渲染面；TUI 等价物见 §3 |
| `mpd-qa-roles-probe` | 仅 QA 的探针包 | inert | bundle patch 中没有它的行（仅由 QA overlay 挂载） |

台账自身记录的 caveat：测量时 `packages/mpd-tui-plugin` 仍在由 t4 编写，台账记录的插件摘要即该修订
（`dist/index.js` sha256 `695f68c4858745cc…`）。该产物在本波次中又被重建两次，因此台账中的插件哈希
是**历史，绝不是交付产物**：本页绑定的是 §11 与
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md` 记录的交付修订，而台账的*组合*观察仍然
成立。七个接缝界面的*渲染*不属于该台账的主张：它属于实机通道，该通道渲染了七个中的六个（明确不
声明第 10 条）。本页没有对任何包重新分类（AC-12 是 t5 的测量，由 t8 复核）。

## 9. 要求级证据类型

准入的要求套件为每条要求固定了证据类型；规范一致性通道（`t9`）此后已用固定输入运行了该套件，并为
全部七行记录了逐条状态与对应产物，因此没有任何一行留空——但套件自身的运行器被阻断（vendored
`dsh-std` 子模块只提供源码，`pinned-cli`/`pinned-suite` 退出 1），逐条矩阵是用固定解析器在固定输入
上求得的。这是一条被记录的阻断，**不是**套件干净通过，也**不是**本 bundle 的一致性结论：
`evidence/tui/conformance/20260915T064521Z/04-spec-conformance.log`。

每条要求固定的证据类型：

| 要求 | 证据类型 |
|---|---|
| `BASE-STD-001`、`TUI-PKG-001`、`TUI-PKG-002`、`TUI-PRIVATE-001`、`TUI-HOST-001`、`TUI-OBS-001` | `automated` |
| `TUI-TRUST-001` | `review` |

有两条条款限制了以上内容能被拔高成什么：仅验证源码仓库、或仅运行参考实现测试，**不足以**产生产物
级声明（`TUI-DEP-001`）；`trusted-in-process` 是兼容性/审计标签，不是安全边界（`TUI-TRUST-001`）。
兼容性判定、验证级别与限制被刻意分节陈述。

## 10. 明确不声明（NOT-CLAIMED）

本节没有任何一项是可用的功能。

1. **决策事件接缝（decision-event seam）** —— 因宿主准入不可达而被阻断（§6.1）。就绪但未激活；不声明
   任何拦截。
2. **身份门控服务** —— `storage.local`、`messages.observe` 与受中介的 `registerCommand` 路径需要
   同样的已核实组件身份；因此效果台账目前把我们的界面记为 `undeclared`。
3. **仅 Web 的界面** —— agent-teams **侧边栏**、workmate 标签页与 bundle 悬浮窗
   （`dsh.client.platform = web`）在 TUI 中不渲染。§3 的 TUI 等价物不是像素级或功能级对齐声明。
4. **引擎版本偏差** —— 宿主打印
   `⚠ dsh 引擎为 0.1.5-rc.2，比本界面验证过的 0.1.5-rc.1 新`，并继续运行。我们的验证针对已安装的
   `0.1.5-rc.2` 引擎，而不是界面验证时所用的修订。本页不把任何结论锚定在生态的当前状态上。
5. **接缝 2（`tuiPrompt`）** —— 宿主不提供；不声明。
6. **宿主内部门禁不是我们的一致性验证** —— 宿主自带的 `verify:plugin-*` 验证的是**宿主**的插件
   子系统；即使通过也不构成本 bundle 的一致性结论，且它可能被阻断（宿主检出没有
   `node_modules`/`lib/`）。
7. **非自动化的 TTY 边界** —— TUI 只在 stdout 为真实终端时启动，因此 TUI 通道在 tmux 下运行，且
   被排除在自动化的 `bun run test:qa` 扫描之外；自动化通道无法见证 TUI 界面。
8. **未发布一致性声明，也不构成数据安全认证** —— 描述符合法不等于安全保证，我们的通道也不是证书
   （`TUI-DEP-001`）。
9. **`/settings` 打通、包内技能资源、刻意的偏离** —— 见 §6.2、§6.3 与 §7。
10. **`tuiRenderers` 转写行未被宿主投影。** 插件为其纯日志事件 `mpd-tui/board-opened` 注册了渲染器，
   该事件在持久存储中确有记录，但**界面上没有出现任何转写行**，而其余六个受激活门控的界面都正常渲染：
   `evidence/tui/live/20260915T063140Z/result.json` 记录 `"tuiRenderers": false`（以及
   `"sceneReportedTranscriptRows": 0`），`T8-LIVE-VERIFY.md:19` 记录 "6/7 seams render …
   `tuiRenderers` MISSING"。归因在**宿主侧**，不是本插件的默认失败：同一次启动中，两个彼此独立的插件
   都能到达该服务并调用 `register()` 且不抛错，而已安装的运行时对 `tuiRenderers` 只捕获一次、没有任何
   本地兜底，却给 `tuiSettingsSections` 提供了兜底。诚实的限制是：宿主只读且**没有注册回读接口**，因此
   究竟是通道构造时捕获到的运行时为 `undefined`（H1），还是宿主根本不投影插件注册（H2）——**尚未
   证实**，两种解释都在宿主侧。`register()` 返回函数并不能证明任何事，因为被拒绝时返回的是同一个空操作
   disposer；正因如此，本包对该接缝只报 `requested`，从不报 `confirmed`。之后的一次单进程交叉运行复现
   了"全新事件类型会渲染、这个已知类型不会"（同目录 `CORRECTION-renderer-causation.md`），这把原因
   收窄到宿主的拒绝名单捕获顺序，而不是"任何渲染行都无法产生"；处置结论不变。

## 11. 本页的验证状态

**修订绑定。** 下表每一条都绑定到交付修订：`dsh-plugin.json` sha256
`84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9`（身份三元组
`@mpd-dsh/mpd` / 版本 0.9.1 / id `com.mpd-dsh.mpd-tui`），以及它的入口
`packages/mpd-tui-plugin/dist/index.js` sha256
`5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f`（98883 字节）。该产物在本波次中
被重建两次，因此更早的摘要是**历史，不是当前产物**；逐步链记录在
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md`。引用更早的摘要绝不等于引用交付产物。

| 结论组 | 本页主张的级别 | 状态与证据 |
|---|---|---|
| 安装 / 三层结构 / 24 行 / 0 崩溃特征 / mpd 预设默认值 | Observed | 有证据——t5 `evidence/tui/composition/20260915T053445Z/`，并由 t8（`evidence/tui/live/20260915T063140Z/lanes/tui-mount/`）与 t9（`…/conformance/20260915T064521Z/09-mount-boot.log`、`10-mount-boot-clean-root.log`）重跑 |
| 清单被解析、投影、协商（`waiting_authorization`）、真实 `/plugins check` | Parsed + Negotiated | 有证据——t9 `…/conformance/20260915T064521Z/01-admission-static.log`（清单 `84ed4a5d…`、入口 `5dce2563…`）与 `02-admission-live.log` |
| 逐包台账 | Observed（逐包） | 有证据——`ledger.json`（t5）；其结构由 t8 复核 |
| 插件契约形态（无默认导出、清理、软探测） | Tested（单元） | 有证据——`evidence/tui/plugin/20260915T054343Z/`（t4）；547 个包测试通过（t9） |
| 七个受激活门控的界面在真实 TUI 中的表现 | Observed | **7 个中交付 6 个**——`evidence/tui/live/20260915T063140Z/result.json`（`"tuiRenderers": false` → 明确不声明第 10 条） |
| 准入 / 分发 / 规范一致性通道 | Parsed + Negotiated / Tested / Tested（含被记录的阻断） | 有证据——t9 `…/conformance/20260915T064521Z/01`–`04`（分发：协议自带 CLI 退出 0，`fullyValidated=true`；规范套件：因未构建的 vendored `dsh-std` 而 `pinned-cli`/`pinned-suite` 退出 1，逐条矩阵已记录） |
| Web profile 仍可启动（回归） | — | **未验证**——只存在组合层面的代理证据（R4：24 个 row id，退出 0；干净存储的 TUI 挂载启动退出 0）。尚未运行真实的 web profile 启动 |
| 从干净沙箱重跑实机通道 | Observed | 有证据——t8 `…/live/20260915T063140Z/`（自建 root，`inherited: []`，隔离违规 0） |
| R3 `bun run test:qa` | — | 在船长单次 `VENDOR_LOCK` 重新固定之前**按设计失败**（t9 残留：技能语料 307 文件 / `e510d8c5c6de` vs 固定值 301 / `0dd4a6ee68e0`） |

本 bundle 到已准入要求套件的映射已经存在，该通道也已在固定输入上执行、并为每一行记录了逐条状态；尚待
处理的是被记录的规范套件阻断、web profile 启动，以及船长的单次重新固定——本页不会把其中任何一项变成
"通过"。
