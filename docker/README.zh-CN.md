# Docker 客户端安装端到端测试（ubuntu 24.04 + compose）

[English](./README.md)

在仓库根目录执行一条命令：

```bash
node scripts/docker-e2e.ts
```

它会通过 `docker/docker-compose.yml` 构建 `docker/Dockerfile`（一个纯净的 `ubuntu:24.04`，其中没有
node、没有 bun、没有 pnpm、也没有 dsh），运行 `mpd-client` compose 服务，把容器控制台实时输出到终端，
并把证据写入
`evidence/docker/client-install/<UTC 时间戳>/{result.json, output.log, console.log, driver.json}`。
仓库内不会产生任何副本：构建上下文就是仓库根目录，由 `docker/Dockerfile.dockerignore` 负责过滤。

退出码：`0` 表示每个断言都为真或显式为 `null`；`1` 表示至少有一个断言为假；`2` 表示本次运行完全没有产出
`result.json`；`3` 表示宿主机上没有可用的 docker。

## 容器内实际执行的步骤

`docker/entrypoint.sh` 按顺序执行，并为每一项观测记录一个断言：

1. 断言构建上下文已被过滤（`copy.contextFiltered`）。如果宿主机的 `node_modules`、`.git`、
   `evidence`、`.toolchain` 或打包产物 `dist/` 泄漏进镜像，`bun install` 就可能"借用"宿主机已有的模块
   而假装成功；此时本次运行会直接中止，而不是靠借来的零件变绿。
2. `apt-get update` 与 `apt-get install -y --no-install-recommends curl git ca-certificates unzip
   xz-utils` —— `ubuntu:24.04` 一个都没有。
3. 用官方 tarball 安装 Node.js 24，并**用官方发布的 `SHASUMS256.txt` 校验 sha256**；再用官方安装脚本
   安装 `bun`。两者版本都被断言。
4. 安装 `pnpm`（`npm i -g pnpm@…`）。这不是装饰：`dsh plugin <args>` 会在 profile 目录里转发给
   `pnpm`，缺少它时 harness 会打印 `pnpm was not found; install pnpm and make it available on PATH`。
   没有 pnpm 的机器根本无法安装 bundle。
5. `npm i -g @deepseek-ai/dsh@0.2.0-rc.2`（默认 pin；可用 `MPD_E2E_DSH_VERSION=<版本>` 覆盖 ——
   `docker/docker-compose.yml` 负责透传，`docker/entrypoint.sh` 负责读取），然后断言 `dsh --version`
   打印的字符串**完全等于**该版本号。
6. 把检出复制到 `/opt/mpd`，执行 `bun install`，并按 `AGENTS.md` §6 的规范仓库根命令**从源码重建每一个**
   `packages/*/dist` 条目（`bun build packages/<pkg>/src/<entry>.ts --target node --format esm --outfile
   packages/<pkg>/dist/<entry>.js`）。
7. 切换到隔离的 `HOME=/root/sandbox-home` 与 `DSH_HOME=/root/sandbox-dsh`，然后执行真正的客户端安装：
   `cd /opt/mpd && dsh plugin --profile web add .`。
8. 用受认可的封装器组合 profile（`node scripts/dump-config.ts --profile web`），断言 mpd 行 id、
   `preset-mpd` 行，以及三个官方 agent-team 行及其包名。**这一步只是 COMPOSITION（组合）证据**——它不会
   执行任何插件代码。它同时断言**只做加法（additive-only）契约**：已安装 bundle 的两个随包 patch 层
   （`cordis.patch.yml` + `presets/mpd.patch.yml`）中，列 0 的 `- id:` 条目数为**零**，即本 bundle 不覆盖任何
   宿主行（已退役的两个 preset 注册表行上的 `default: mpd` id-target 正是这一类），并且在 node 可用时
   `node scripts/verify-no-host-override.ts` 还必须退出 0。该门禁以 `--allow-no-host` 运行，它只豁免一种情况
   ——容器里没有任何可比的宿主层——绝不豁免真实发现。
9. 通过 `--patch` 插入注册插桩（`docker/probe.ts`）来**启动**已安装的 profile，并从启动日志断言插件树
   确实挂载了：探针的 `apply()` 执行过；适配器提供了 `mpdDsh`；通过适配器发起的一次内部工具调用返回
   `ok`；每一个核心 mpd 工具都从活体工具注册表应答；官方 TeamService 已挂载（`ctx.get("agentTeams")`
   → 类 `TeamService`，即 `mpd-agent-team` 行提供的服务）；官方 agent-team 工具同样从注册表应答；Web 应用
   返回 HTTP 200；并且没有致命的 apply/模块错误特征。适配器的启动行从该行**自己的文件日志**读出——
   `<workspace>/.mpd/logs/mpd-dsh-adapter.log`，即 R5 下的首要见证（见下方 **本 lane 遵循的契约**）——控制台
   日志保留为次要见证；只有当两处都没有该行时，断言才判红。第三行 `mpd-ui-agent-team` 是浏览器侧发现的插件，其
   宿主侧只是一个空的 `apply()`——证据把它能拿到的最强服务端事实（已组合、无 apply 失败、包已在 profile
   中落地且 `dsh.client.platform=web`）记为 observation，而不是暗示一个并不存在的加载证明。
10. 通过 `POST /api/session/create`（`agentPreset: "mpd"`，沙箱 `cwd`）**创建会话**，并断言
    `result.ok === true` 且 `agentPreset: "mpd"`（`boot.presetMount`）。只要该 preset 有任何一行未能激活，
    网关就会拒绝该请求，因此这就是 preset 的**挂载**证明——与第 8 步的"仅组合"不同。鉴权走**签名 Cookie**：
    网关在携带启动日志中 `?token=` 的根请求上签发 Cookie，且仅凭该 Cookie 放行 `/api/*`，因此这一步像浏览器
    一样使用 cookie jar（裸 POST 会得到 `401 unauthorized`，2026-09-27 实测）。token 行是**轮询获取**而不是只读
    一次：`dsh web: …?token=…` 只有在整棵插件树挂载完成后才会打印，提前读取会得到空 token、没有 Cookie，进而
    401——这正是"同一天同一插桩先绿后红"的实测原因。请求体是 RPC 信封
    `{type:"client-request", rpcId, method, payload}`（不是裸 body），`method` 必须是完整 endpoint
    `session/create`，且会话创建还会校验响应回显的 `rpcId` 与请求一致。
11. **在官方团队工具真正所在的层面判定它们。** 它们注册在**唯一确定的 Agent 作用域**内
    （`@deepseek-ai/dsh-experimental-tool-agent-team` 按 agent 调用 `scoped.tools.register(...)`），因此根层
    读取返回 `0/9` 是**设计如此**——本 lane 第一次 Docker 运行就测到了这一点：根层读数看起来像失败，而插件树
    其实是健康的。探针因此把根层读数记为 observation，并为它看到的每个 agent 打印一行；第 10 步创建的会话
    提供了那个 agent，`boot.agentTeamTools` 就以该 Agent 作用域的行为准。
12. **断言会话门是"活的"而不只是"挂着的"。** 会话创建之后，该行自己的文件日志
    `<workspace>/.mpd/logs/mpd-roles.log` 必须包含
    `[mpd-roles] session gate listener registered for agent "…" agentPreset=mpd`
    （`boot.sessionGateListener`），控制台日志作为次要见证；两处都没有该行时断言判红。在 v0.10.0 中，
    会话启动复杂度门虽然挂载却从未触发——"行已组合"从来不是该契约的
    证据——因此这一行（在本轮运行创建的会话的 `agent/created` 上打印）才是它的存活证明。
13. 断言隔离：沙箱 `HOME`/`DSH_HOME` 确实生效；真实 `/root` 下不存在任何 harness 或工具链标记
    （`.dsh`、`.mpd`、`.npm`、`.bun`）；没有任何凭据文件携带形似密钥的**值**（harness 在沙箱 home 中生成的
    空 `.credentials.yaml` 是预期行为，并连同其大小一起登记）。随后 reporter 会重新读取自己写出的产物，拒绝
    让任何 token 形状残留其中（`evidenceScrubbed`；一旦泄漏即判定为红，并用定向清洗重写两个文件）。
14. 把 `boot.llmTurn` 记为 **`null` 并附原因**——见下。
15. **跑一遍 DSH-TUI 版本**（`docker/tui-lane.sh`）——这是开发机唯一无法演练的 profile：TUI 宿主必须从 npm
    装进一个可写的全局前缀，并在真正的 PTY 上启动。该步安装 `@deepseek-harness-tui/dsh-tui@0.14.0`
    —— 即本 bundle 现在对标的 dsh-tui 版本，其 peer 范围仍覆盖本 lane 会跑的整段区间（`0.1.7-rc.2`、
    `0.2.0-rc.1` 与 `0.2.0-rc.2`）；`0.11.2` 只到 `0.2.0-rc.1`，对上 `0.2.0-rc.2` 时
    `dsh plugin --profile dsh-tui add` 会因 peer 范围被拒。此前的 `0.13.0`（以及更早的 `0.12.0`）仅作历史保留。
    可用 `MPD_E2E_TUI_VERSION` 覆盖，并与 `MPD_E2E_DSH_VERSION` 保持配套。它把本 bundle 作为第三层 patch 装进 `dsh-tui`
    profile，并记下二十二条 `tui.*` 断言：宿主安装、两次 `plugin add`、组合、**用户级预设偏好**（见下）、
    `preset-mpd` / `mpd-tui` / 官方团队行、种子看板**绑定到 TUI 实际运行的那个会话**（产品自身 `createTeam` 的两种写法都写上）、
    无主会话中**看不见**兄弟会话的看板——即产品自身的 `no team in this session` 空态、`/mpd team` 场景在真实终端上画出依赖图、
    真实 tmux PTY 启动并到达聊天界面、无致命签名，
    以及所创建会话**实际**运行的预设——从 harness 自己的会话存储读出（`agentPreset: "mpd"`），绝不从界面文本
    推断。**本 lane 自己执行了官方文档里的用户路径**：在 TUI 进程启动之前，它按 dsh-tui 自己的 `writePresetPref`
    的字节形状写入 `<HOME>/.dsh-tui/agent-preset.json`（当安装好的那个写入器可定位时，直接与它的输出比对），
    断言宿主 `dsh-tui-agent-preset-registry` 行**未被本 bundle 触碰**，随后让会话存储证明正是该偏好解析出了
    `mpd`。不写它，会话会回落到 `standard`——一个该组合并未声明的预设——因此这是一次真正的验收，不是冒烟。

## 本 lane 遵循的契约

本 lane 遵循本波次的契约，两半都落在真实的断言上：

- **MPD 诊断从文件读，而不是从控制台读（R5）。** MPD 行从不写终端：`rowLogLine` 追加到
  `<workspace>/.mpd/logs/<row>.log`（`agent-references/seam-adapters.md`）。两个存活断言因此以
  `<workspace>/.mpd/logs/mpd-dsh-adapter.log` 与 `<workspace>/.mpd/logs/mpd-roles.log` 作为**首要**证据，
  同时搜索启动进程自身的工作区与本轮创建的会话工作区，并在 raw 见证里写明是哪一份文件给出了该行。控制台 grep
  保留为次要见证：某个宿主若把行的诊断重新送回终端，断言仍然通过；而两处都没有该行时，断言记为 FALSE。
- **本 bundle 只做加法（ADDITIVE-ONLY）。** 它只用 `insert:` 列表添加行，绝不 id-target 任何宿主层声明的行
  （严格零覆盖，2026-10-02 用户决定）。`compose.mpdRows` 读取**已安装** bundle 的两个随包 patch 层，只要出现列 0 的
  `- id:` 条目就判红；node 可用时还会运行更强的第二见证 `node scripts/verify-no-host-override.ts`。
- **默认预设是用户级设置，本 lane 亲自执行它。** 本 bundle 只提供 `mpd` preset，不做任何选择：部署默认属于用户
  （`docs/preset-default.md`）。Web 侧通过显式 `agentPreset: "mpd"` 的 `POST /api/session/create` 演练；TUI 侧
  通过 dsh-tui 自带的持久化偏好演练——由本 lane 在启动前写入，并按字节精确断言。本 lane 不依赖对任何宿主行
  的覆盖。

## 它证明了什么——以及没有证明什么

证明：

- 干净的 `ubuntu:24.04` 能获取工具链，并按固定版本安装 `@deepseek-ai/dsh`；
- bundle 能用**一条命令**从**本检出的副本**安装（无需打包步骤、不依赖宿主机工作区、不要求预构建的
  `dist/`——dist 全部从源码重建）；
- 已安装的 profile **组合**出了 mpd 行与官方 agent-team 行，且都是**新增**的——两个随包 patch 层的列 0
  id-target 数为零，因此没有覆盖任何宿主自有内容（**仅组合**——`result.json` 把这一主张单独放在
  `provesCompositionOnly` 字段里，绝不与加载证明混在一起）；
- 已安装的 profile **确实挂载**：插件代码执行了，适配器提供了服务（在其自己的文件日志中见证，R5），mpd 工具已注册，
  官方 TeamService 已挂载，官方团队工具在 Agent 作用域内应答，mpd 会话门监听器为真实会话完成注册，`mpd` preset
  能为真实会话激活，Web 应用在提供服务；
- 一次真实的 DSH-TUI 会话通过官方文档的用户级偏好解析出 `mpd`，而宿主 preset 注册表行未被本 bundle 触碰。

没有证明：

- **任何真实的 LLM 回合或模型路由。** 容器内不复制、不读取、不写入任何凭据（`AGENTS.md` §10），因此不会发起
  模型请求。该断言以 `null` 加原因记录——绝不记为通过。
- 组合出的行列表与挂载的行列表完全一致。`--dump-config` 只组合行、从不执行插件代码（`AGENTS.md` §4）；证据中
  它被标注为仅组合，所有挂载主张都来自第 9 步的启动或第 10 步的会话创建。
- 把 `dist/mpd-package` **作为安装包**的打包/tarball 安装，以及迁移安装。它的一致性与新鲜度**确实被评测**
  （见下文 §7 各项）——但该产物从未被安装，因此 tarball 安装这条路径仍未得到证明；
- 离线运行：apt、nodejs.org、bun.sh、npm 与包注册表都会被使用。

## §7 验收项（restore-three-capabilities §7——跳过不等于通过）

`.mpd/plans/restore-three-capabilities.md` §7 规定：凡是开发宿主机无法判定的主张，都由本 lane 在真实机器上判定。
为此新增了五项答案，每一项都是 `docker/lib/report.ts` 的 `EXPECTED` 清单中**已声明**的一行——因此从未执行到的
项会被报告为"应做而未做"，而不是被悄悄丢掉。

| 断言 | 它测量什么 | 它如何变红（负向对照） |
|---|---|---|
| `install.buildScripts` | 客户端安装以"没有任何未批准的依赖构建脚本"完成：退出码 0、输出中没有 `ERR_PNPM_IGNORED_BUILDS`、没有 `Ignored build scripts` 警告——并附带对已安装闭包中**声明**了 `preinstall`/`install`/`postinstall`/`prepare` 的每一个 manifest 的清单 | 日志里出现该错误类或该警告，或退出码非 0。已在宿主机演练：日志中被植入 `ERR_PNPM_IGNORED_BUILDS` 时记为 `false`，并引用两处原文 |
| `pack.present`、`pack.licenceCoherence`、`pack.declarationCoherence`、`pack.staticCoherence`、`pack.distFreshRebuild` | 打包产物 `dist/mpd-package`：它究竟有没有被带进来；它的 `LICENSE.md`/`LICENSE-NOTICES.md` 是否与切出它的那棵树逐字节相同、声明的 `license` 是否仍然一致；它对自己做出的每一项声明是否都成立（`files` 白名单可解析、`dsh.bundle.patch` 层存在、它自己的 patch 里点名的每个行模块路径都能在包内解析、没有把 `evidence/`/`.git/`/`docker/`/`node_modules` 带进来）；它与切出它的那棵树是否逐字节一致（且只有**两个已声明**的生成路径例外：`package.json`、`packages/mpd-ext-plugin/dist/validator.js`）；以及每个已构建条目是否等于容器自己从源码重建出的那份 | 第二项是**正在生效的**对照而不是假设：今天携带的产物就在 `pack.staticCoherence` 上以 10 个不同文件变红（打包之后那棵树又前进了），并在 `pack.distFreshRebuild` 上以 2 个变红——这正是宿主机门禁拒绝做出的测量（`verify-pack-closure.ts` 明示不证明新鲜度；`--pack` 没有许可证检查）。产物缺失时五项全部记为 `false`，绝不用 `null` |
| `boot.mcpToolNaming` | 探针枚举**每一个**已注册的 `mcp__*` 名称；本行评测 `mcp__<server>__<tool>` 形状、服务端集合是否**恰好**是随包启用的三行、`disabled: true` 的行是否真的什么都没注册、以及 ast-grep 行是否发布了它声明的全部工具 | 出现 `{ast_grep, lsp, codegraph}` 之外的服务端段就变红——例如被禁用的行泄漏出 `mcp__git__*`/`mcp__shell__*`，或某行改了个没人断言过的 `serverName`。已用合成启动日志演练 |
| `boot.mcpLiveSearch` | 通过已挂载的 adapter **真实调用**一次 `mcp__ast_grep__search`，搜索本 bundle 自己的源码，并**附带负向对照**（任何源码文件都不可能匹配的模式必须命中 0 次） | 返回 `BINARY_NOT_FOUND`（没有引擎）会变红，对照项命中任何东西也会变红——一个对两次调用回同样答案的桩无法通过。已用合成日志双向演练 |
| `restore.reviewPanelSelfTest`、`restore.reviewPanelCase`、`restore.lspBootstrap`、`restore.hashlineRepair`、`qa.mcpCall`、`qa.readonlyDeny` | §7 应做的各用例，**在容器内**运行：三个被恢复能力各自的用例，以及在开发宿主机上因**既存原因**变红的那两个 live QA 用例 | 用例退出码非 0 记为 `false`；用例打印出自己的拒绝标记（如 `[mcp-call] missing credentials`）时记为 `null` 并引用该标记，**绝不记为 `true`**；本 wave 应做而树里没有的用例记为 `false`，不是跳过 |

`restore.lspBootstrap` 是一**对**对照，而不是单点检查：launcher 会在 stdin 关闭的情况下被驱动两次——一次在没有配置
的空目录（它必须**生成** `<root>/.mpd/lsp/cclsp.json`、能解析、并至少有一个覆盖 TypeScript 族的服务端），一次在
携带用户自有 `cclsp.json` 的目录（后者必须逐字节存活，且旁边不得出现任何生成文件）。一个会覆盖用户文件的
launcher 能通过"是否写出了配置"的检查，却违背契约所述的能力。

live 搜索所需的引擎由本仓库**自己的**安装脚本 `node scripts/install-mcp.ts` 落地（第 09d 步）：
`@ast-grep/cli` 已不在 bundle 的 `dependencies` 中，而在许多 Linux 主机上 `/usr/bin/sg` 是 util-linux 的
`setgroups`，并非 ast-grep——因此最终判定的是服务端自己的 `--version` 探测，而不是 PATH。

这些仪器与本 lane 的其他模块（`report.ts`、`rebuild.ts`、`live-verdict.ts`）放在一起：
`docker/lib/owed-install.ts`、`owed-pack.ts`、`owed-mcp.ts`、`owed-cases.ts`。它们是仅用于 QA 的仪器，被固化在
`/opt/mpd-e2e/lib/`，绝不取自被测树——仓库副本可以提供自己的插件，但永远不能提供自己的判决。

## restore wave 的验收项（restore-acceptance-fix §4 S-B，2026-10-09）

PR #28 已合并三项被恢复的能力，但本 lane 自己的验收运行发生在该合并**之后**且从未提交。重新测量后，它的五行
不是环境事实，而是 QA 仪器的缺陷。以下修正全部落在本 lane 与其 reporter 内：

| 行 | 变更内容 |
|---|---|
| `toolchain.bunPinned`（新增） | 容器把 `package.json.buildToolchain` 声明的编译器（`bun@1.4.0`）落地到**独立**前缀（`$TOOLCHAIN_DIR/bun-pinned`），并断言它报告的版本与之完全一致。它绝不链接进 PATH，因此 `toolchain.bun` 仍测量机器自带的 bun。版本比较是**精确相等**、不是子串：官方脚本抖动时回退到 npm 路径，落地失败会记为 `false` 而不是静默穿过 |
| `pack.distFreshRebuild` | 现在是一次真正的**陈旧性**测量：重建在落地后的 pin 下运行，比较只看字节。该行的 raw 见证引用**实际产出**此次重建的编译器——取自重建自身的 `--json` 见证（`rebuildBun`、`rebuildBunVersion`），而不是别处做的 PATH 查找。旧版本在 PATH 上问 `bun --version` 并用 `declaredPin.includes(containerBun)` 判断，于是即使干活的是 pin 二进制也会报 `1.4.2`，且两段式 `1.4` 也能匹配 `bun@1.4.0` |
| `pack.rebuildToolchain`（新增） | 配套行：产出重建的编译器是否**精确**等于声明的 pin（与重建见证做字符串相等比较）。没有重建（one-click 模式）或没有见证时，它带着实测原因记 `null`/`false`，而不是一个什么都没测的绿灯 |
| `pack.distFreshRebuildControl`（新增） | **反向对照**，在同一容器内运行：复制一份产物，改动其中一个已构建条目，再对**同一次**重建重新判定。仅当该副本把陈旧性行翻成 `false` 时此行才为 `true`——因此未改动产物上的绿灯是一次测量，而不是常量。没有这一项，一个永远回答 `true` 的相等测试与正确的测试无法区分 |
| `tui.mergedPanelOpens`、`tui.mergedPanelOrder` | **实测**，不再是 `null`。在提供 0.13.0 `ctx.tuiPanels` seam 的主机上，这两行曾以"主机**接受**的 `open()` 改变 tmux 捕获的零个字节"为由记为 `null`——而该依据是在 0.13.0 **之前**的全屏场景上测得的，在合并视图变成**侧栏面板**之后再未复测。权威运行自己的 `tui-panes/pane-merged.txt` 携带完整面板正文；两行由 `docker/lib/tui-panel-body.ts` 判定，它读取面板外框、主机自带的 subagent 区块与 MPD 的团队头部/DAG 页脚，并且**当按键前的捕获已经携带面板正文时拒绝称之为"打开"**（这正是捕获顺序或按键失效时该行变红的方式） |
| `qa.mcpCallEngine`（新增） | 引擎被落地到 `mcp-call` launcher **实际读取**的那棵树：该用例用 `npm install file:` 把打包产物（`dist/mpd-package`）装入沙箱 profile，而 MCP launcher 以 bundle 相对路径解析 `sg`——因此 `node scripts/install-mcp.ts --toolchain <APP>/dist/mpd-package/.toolchain` 在打包刷新**之后**运行（否则那一步会把它删掉）。第 09d 步的落地覆盖各行；这一步覆盖该用例 |
| 分步预算与 npm 传输 | 2026-10-09 实测：一次运行在 `npm i -g @deepseek-ai/dsh@0.2.0-rc.2` 里卡了 **23 分钟**、CPU 0.3%、容器空闲——是取包卡死而非进行中——只能人工杀掉，整场验收运行随之报废。现在每个 `run_step` 都由 `MPD_E2E_STEP_TIMEOUT`（默认 900 秒）限时，被杀的步骤记为退出码 124 并带自己的原因；npm 的单请求超时与重试也一并限界。同一次测量还发现官方源**作用域**元数据端点（harness pin 正是经它解析）一次探测失败、下一次 1.5 秒成功，因此第 `01b` 步会先探测该端点：能应答就用官方源，`MPD_E2E_NPM_MIRROR` 只作为**记录在案**的回退（`obs.npmRegistry` 写明实际用的是哪个源），`MPD_E2E_NPM_REGISTRY` 则允许操作者直接指定源 |
| `EXPECTED` 主脊 | 现在一条主脊覆盖**两种**模式：两种模式已记录名称的并集是 114，且 one-click 集合是 source 集合的严格超集，因此四个仅 one-click 的行被声明，并在 source 模式下以**实测模式**为原因记为 `null`——绝不用缺失名称会合成出的"not reached"。旧主脊之外被记录的那 13 行也已声明 |

该分类器与离线证伪器**共用同一份代码**：`node scripts/docker-e2e.ts --self-test` 会用植入的 pane 驱动
`docker/lib/tui-panel-body.ts`（面板正文存在 → `OPENS=true`；区块顺序**颠倒** → `ORDER=false`；对照捕获已携带正文
→ `false`；0.13.0 之前的形态 → 仍然判定），并断言 `docker/tui-lane.sh` 确实在调用它。`--self-test` 还会在植入的
产物/重建/见证三棵树上驱动打包比较器（含 `1.4` 对 `bun@1.4.0` 的子串陷阱与改动产物的对照），并用一个植入的假
编译器驱动 `rebuild.ts`，以证明见证确实来自被调用的二进制。

## 仓库是如何进入镜像的

`docker/docker-compose.yml` 使用 `context: ..`（仓库根目录）与 `dockerfile: docker/Dockerfile` 构建；
Dockerfile 把该上下文复制到 `/src`。**磁盘上不存在任何暂存目录或临时副本**——本 lane 早期的一个版本曾把整棵树
复制到 `docker/src`，而那份仓库内副本被 `bun test` 的 glob 以及所有遍历目录的门禁拾取（2026-09-27 实测），
因此该机制被移除而不是换个位置。

上下文携带什么由 `docker/Dockerfile.dockerignore` 决定，BuildKit 会为 `docker/Dockerfile` 的构建应用它
（已在 Docker 29.8.1 上验证）。该文件与被它约束的 Dockerfile 放在一起，因此本仓库不需要根级
`.dockerignore`。它排除：

| 被排除项 | 原因 |
|---|---|
| `.git`、`.gitignore`、`.gitattributes` | 安装不应依赖历史 |
| `node_modules`、`**/node_modules` | `bun install` 会在容器内重建 |
| `dist/*`，**但 `dist/mpd-package` 除外** | 打包产物不是源码输入——然而 §7 第 5 项正是要**对它**做测量，因此恰好这一个路径会进镜像，并由 `copy.contextFiltered` 断言 `dist/` 下没有别的东西跟进 |
| `evidence`、`.qa-*`、`.toolchain`、`.codegraph`、`.t18ev`、`.t28ev`、`.bun-tmp`、`.mpd` | 宿主机本地状态 |

`packages/*/dist` 是**刻意保留**的：容器会从源码重建它们，而这次重建本身就是一个断言，不是走过场。过滤结果还会
在容器内被断言（`copy.contextFiltered`），因此泄漏的上下文绝不可能产生假绿。

**该主张的边界，明确写在这里以免被过度解读：** `docker/Dockerfile.dockerignore` 仅在**用该 Dockerfile 路径
进行 BuildKit 构建**时生效——Docker 29.8.1 自带的 docker CLI（`docker compose build`、
`docker build -f docker/Dockerfile`）满足该条件，且驱动还会在容器内断言过滤结果。若审阅者用**其他构建器**
（或把 Dockerfile 复制到别的路径——那会改变 BuildKit 查找的 ignore 文件名）构建同一上下文，则不得把本次运行
读作"上下文已被过滤"的证明：请查看 `result.json` 中的 `copy.contextFiltered`，它在容器内求值，因此对产生该
镜像的任何构建器都成立。

## 环境（Environment）

本 lane 所处的沙箱禁止在仓库之外写入，而 docker CLI 会把 buildx 状态放在 `$DOCKER_CONFIG`（默认
`~/.docker/buildx`），因此直接 `docker build` 会失败：
`mkdir <home>/.docker/buildx: read-only file system`。驱动因此为每个 docker 子进程把 `BUILDX_CONFIG`
指向一个私有可写临时目录（调用方自己设置的值优先），并在结束时删除；真实 `~/.docker` 中的 rootless docker
上下文仍被使用，且**不会复制任何凭据文件**。手工执行时，先 `export BUILDX_CONFIG=$(mktemp -d)` 再调用
compose。

构建还需要**守护进程**（而不是驱动进程）能从 Docker Hub 解析两个基础镜像——`node:24-bookworm` 与
`ubuntu:24.04`；本地镜像库为空时这就是硬前置条件而非缓存命中：路由不通时运行会在 buildx 的
`load metadata` 阶段就失败，此时一层都还没构建。2026-10-02 在一台「IPv6 出网全部被重置、IPv4 可达
registry」的机器上实测：守护进程拨的是 AAAA 记录，连续三次运行都死在
`read: tcp [...]:443: read: connection reset by peer`。解法不需要改守护进程配置——改从一个**不发布
AAAA 记录**的镜像源拉取（这样只能走 IPv4），再打回 Dockerfile 中 `FROM` 使用的官方名字：

```bash
# 实测使用 docker.m.daocloud.io；任何纯 IPv4 镜像源同样可行
docker pull docker.m.daocloud.io/library/ubuntu:24.04
docker tag  docker.m.daocloud.io/library/ubuntu:24.04 ubuntu:24.04
docker pull docker.m.daocloud.io/library/node:24-bookworm
docker tag  docker.m.daocloud.io/library/node:24-bookworm node:24-bookworm
```

此后 `docker compose build` 会直接从本地镜像库解析两个 `FROM` 阶段，lane 无需任何改动即可运行。

### 实时回合的提示词开关（`MPD_E2E_LIVE_PROMPT`）

容器的第 15 步（`docker/entrypoint.sh`）会驱动一次真实的 headless agent 会话，其任务默认是一段
**团队平面冒烟提示词**。`MPD_E2E_LIVE_PROMPT` 会**替换**该任务：当它被设置且非空时，其值原样作为该回合的
提示词，因此可以要求本 lane 去做另一件事。未设置或为空时，内置提示词**逐字节**保持不变——该开关只做增量，
绝不改变行为。

它只在实时运行中才有意义，因此调用方式就是实时的那一套：

```bash
export DEEPSEEK_API_KEY=…                 # 按“名字”转发，绝不写进 argv 被回显
export MPD_E2E_LIVE=1                     # 实时类断言是可选开启的
export MPD_E2E_LIVE_PROMPT='把一个可玩的贪吃蛇游戏写到 <路径> …'
node scripts/docker-e2e.ts --live
```

没有 `MPD_E2E_LIVE=1`（或没有转发 `DEEPSEEK_API_KEY`）时，运行根本到不了第 15 步；而驱动在手里没有密钥时会
直接拒绝 `--live`。驱动用 `-e MPD_E2E_LIVE_PROMPT` 转发该提示词——**按名字转发，而不是按值**，与凭据的传递
方式一致——并且 `docker/docker-compose.yml` 在**两个**服务的 `environment:` 块里都写了
`${MPD_E2E_LIVE_PROMPT:-}`，这正是该变量能从宿主机送达容器的原因：compose 只转发 compose 文件自己插值过的
变量。

某一回合实际用的是哪条提示词，本身就是证据的一部分：第 15 步会打印
`[live-prompt] promptSource=… bytes=… firstLine="…"` 这一行，把同样的说明记录为 `result.json` 中的
`livePrompt` 事实，并写入 `boot.llmTurn` 断言的 `raw` 字段。因此，即使调用方给的提示词很长，也能被识别出来，
而不会被当作一团无法阅读的文本倾倒进日志。

## 隔离模型

- `docker/docker-compose.yml` 只声明**一个**服务与**一个**绑定挂载：证据目录 `/out`。它不挂载 `$HOME`、
  `~/.dsh`、`~/.mpd`、`~/.agents`、docker socket 或仓库本身，并且
  `node scripts/docker-e2e.ts --self-test` 会静态断言这一点。
- 容器内的 `HOME` 与 `DSH_HOME` 在工具链运行**之前**就被重定向到沙箱路径，`NPM_CONFIG_CACHE` /
  `BUN_INSTALL` 指向 `/opt/toolchain`，因此连包管理器缓存都不会落到真实 home。
- 证据中的本地 Web UI token 由两道彼此独立的脱敏（容器内的 reporter 与宿主机驱动）清除；reporter 还会重新读取
  自己写出的产物，以证明没有任何 token 形状残留（`evidenceScrubbed`；其触发路径在 `--self-test` 中有负向对照）。

## 开关与退出码

```bash
node scripts/docker-e2e.ts --self-test   # 离线：不需要 docker，也不需要网络
node scripts/docker-e2e.ts --no-build    # 复用已有的 mpd-docker-e2e:local 镜像
```

不需要驱动时的原始 compose 路径：

```bash
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml run --rm mpd-client
# 除非 MPD_DOCKER_OUT 指向别处，证据会落在 docker/out/
```

若失败信息为 `mkdir <home>/.docker/buildx: read-only file system`，见上文 **环境（Environment）**
（`export BUILDX_CONFIG=$(mktemp -d)`）。

退出码：`0` 所有断言为真或 `null`；`1` 至少一个为假；`2` 没有 `result.json`；`3` 宿主机上没有可用的
docker。

## 如何阅读一次红色运行

1. `evidence/…/result.json` → `summary.failedNames` 列出失败的断言；每一项都带有 `reason` **以及**支撑该判定
   的原始日志行。
2. `evidence/…/output.log` → 同样的判定，外加每一步的完整输出（已脱敏）。底部的断言清单是最快的读法。
3. `evidence/…/console.log` → 宿主机看到的容器原始控制台输出。
4. `evidence/…/driver.json` → 宿主机做了什么：镜像大小、确切的 docker 命令及其退出状态、以及使用的 buildx
   状态目录。

记为 `null` 的断言**不是**通过：它表示本次运行在到达该断言之前就停止了（`reason` 会说明），或该断言被有意排除在
范围之外（目前只有 `boot.llmTurn`）。`result.json` 还带有 `evidenceScrubbed` 字段——它是从已写出的产物重新读回
得出的，而不是来自内存。

## 自检

`node scripts/docker-e2e.ts --self-test` 是离线的，既不需要 docker 也不需要网络。它检验驱动自身的记账逻辑
——UTC 证据时间戳、判定到退出码的映射、脱敏规则、BUILDX_CONFIG 注入——以及 compose 文件、Dockerfile、
ignore 文件与 entrypoint 的静态规则，并对证据写入做一次往返验证。记账未被检验的驱动只会产出自信的废话，
所以它先被检验。
