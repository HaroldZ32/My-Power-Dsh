# 为 my-power-dsh 贡献

[English](./CONTRIBUTING.md) | **中文**

感谢你愿意花时间贡献。本仓库是 DeepSeek Harness（DSH）的插件 bundle，开发时遵循一小组硬性规则，
在提交第一个 pull request 之前很值得先读一遍：每一份交付的能力都必须是一个插件；没有落盘证据的改动
不算完成；每份面向人的文档都必须同时提供英文与简体中文两个版本。

权威约定在 [`AGENTS.md`](./AGENTS.md)（英文，面向智能体与维护者），可操作的细节在
[`docs/development.zh-CN.md`](./docs/development.zh-CN.md)。本文件是贡献者的入口；如果它与
`AGENTS.md` 冲突，以 `AGENTS.md` 为准。

你贡献的内容将按本仓库的许可 **SUL-1.0**（[`LICENSE.md`](./LICENSE.md)）分发。

## 目录

- [贡献方式](#贡献方式)
- [开发环境](#开发环境)
- [构建](#构建)
- [测试](#测试)
- [关卡](#关卡)
- [git 模型](#git-模型)
- [文档规则](#文档规则)
- [证据](#证据)
- [报告问题](#报告问题)
- [提交 pull request](#提交-pull-request)
- [许可证](#许可证)

## 贡献方式

- **报告缺陷** —— 一份最小复现（确切的命令、观察到的结果、期望的结果）是你最有价值的贡献。
- **修文档** —— 错别字、失效链接、说不清的步骤。别忘了下面的双语规则：改动英文文档时，必须在同一次
  提交里同步它的 `*.zh-CN.md` 中文版。
- **写扩展** —— 扩展接口让一个包在不改动核心的前提下贡献 skill、flow、MCP 服务器与专家。先读
  [`docs/extension-authoring-guide.zh-CN.md`](./docs/extension-authoring-guide.zh-CN.md) 与
  [`docs/extensions.zh-CN.md`](./docs/extensions.zh-CN.md)。
- **修或扩展 bundle** —— `packages/` 下的插件包、`scripts/` 下的新关卡，或 `skills/dsh-qa/` 下的
  QA 用例。

## 开发环境

### 环境要求

- **Node.js** 与 **Bun**（`1.4.0`，即 `package.json` 中 `buildToolchain` 记录的版本）。
- 已安装 **DeepSeek Harness（DSH）**，并具备 `web` 或 `headless` profile 与模型凭据 —— 部分 QA
  用例会用本机的 provider 路由启动真实会话。
- **git**。

### 克隆并安装依赖

```bash
git clone https://github.com/HaroldZ32/My-Power-Dsh.git
cd My-Power-Dsh
bun install
```

`bun install` 会把声明的运行时依赖落到本地，其中包括 `dsh-better-sidebar`，它的传递依赖
`node-pty` 需要 `node-gyp`。当 `node-gyp` 不可用时：

```bash
bun add dsh-better-sidebar@0.19.0-alpha.1 --ignore-scripts
```

只有侧边栏的终端面板会降级。

### 仓库结构

| 路径 | 存放内容 |
|---|---|
| `packages/` | 每个插件包一个目录（`src/`、已提交的 `dist/`、双语 `README` 对） |
| `packages/mpd-bundle/cordis.patch.yml` | bundle patch：全部插件行、MCP 行与侧边栏行 |
| `presets/mpd.patch.yml` | `mpd` preset 行 |
| `scripts/` | 各类关卡、打包器、安装器与扩展 CLI |
| `skills/` | 随包提供的 skill 语料库（含 `skills/dsh-qa`） |
| `extensions/`、`templates/` | 随包提供的扩展根目录与脚手架 |
| `tests/`、`evidence/` | golden 固件与 QA 证据树 |
| `docs/`、`agent-references/` | 面向人的文档（双语）与按需查阅的智能体参考（仅英文） |

## 构建

仓库中已提交的 `dist/` 文件就是构建产物。只重建你改动的包，并且要**在仓库根目录**用带路径的完整参数
执行：

```bash
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

多入口的包对每个入口重复这条命令。必须用这种规范写法：`bun build` 会把模块相对于当前工作目录的路径
写进产物，而 `node scripts/verify-dist-fresh.mjs` 复现的正是这些字节 —— 在包目录里执行的构建会被
判定为 STALE。

其他构建入口：

```bash
node scripts/build-mcp.mjs          # MCP 服务器，离线使用仓库内源码
node scripts/build-mpd-client.mjs   # 合并后的 web 客户端，改动 agent-teams 客户端之后执行
node scripts/pack-mpd.mjs           # 仅发布用：生成可迁移的 dist/mpd-package/ 产物
```

新增插件包还必须加入 `scripts/pack-mpd.mjs` 的 `PLUGIN_PKGS` 允许清单，否则打包安装会漏掉它，并在
启动时以 `ERR_MODULE_NOT_FOUND` 失败。

## 测试

```bash
bun run typecheck            # 根目录 tsgo --noEmit，覆盖全部包
bun test packages            # 各包单元测试，离线（mock ctx，不需要 DSH 二进制，也不需要模型）
bun test packages/<pkg>      # 单个包
bun run test:qa              # 全部 QA 用例的离线 --self-test
bun run test:qa:all          # 真实/联调通道（真实 DSH 启动，和/或真实 provider）
```

会触碰状态的测试把 `process.env.HOME` 指向临时目录；插件直接读 `$HOME`。

## 关卡

`bun run verify:gates` 是静态关卡的快速汇总。提交 pull request 前请先跑它；当你的改动触及下表中某一项
时，再单独跑对应的关卡：

| 关卡 | 命令 |
|---|---|
| 快速汇总（静态关卡） | `bun run verify:gates` |
| vendor 基线与资产指纹 | `bun run verify:vendor` |
| `dist/` 新鲜度（确定性重建并比对） | `node scripts/verify-dist-fresh.mjs` |
| 行一致性与 preset 一致性 | `bun run verify:rows` 与 `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` |
| 文档成对、标题树、链接目标 | `bun run verify:docs` |
| 打包产物闭包 | `node scripts/verify-pack-closure.mjs` |
| 安装器（dry-run） | `node scripts/install-profile.mjs --dry-run` |
| 扩展 CLI | `bun scripts/mpd-ext.mjs --self-test` 与 `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` |
| 启动检查（挂载） | 在隔离的 `DSH_HOME` + 沙箱 `HOME` 中真实启动：`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` 或 `node skills/dsh-qa/scripts/preset-conformance.mjs` |

有两条规则让这些关卡真正有意义：

- **`--dump-config` 只能证明"组合"，永远不能证明"插件被加载"。** 它不执行插件代码，因此看不到 apply
  或 schema 层面的崩溃。任何关于插件**行为**的问题，都需要一次真正挂载的启动，或一次真实的工具调用。
- **没有落盘证据的关卡等于没跑。** 把运行结果记录到
  `evidence/<domain>/<slug>/<timestamp>/`（`result.json` + `output.log`），并与改动一起提交。

### QA 隔离

QA 绝不触碰真实的 `~/.dsh` 与真实的 `~/.mpd/workmate`：

- `DSH_HOME=<mktemp>` —— 凭据只复制进去一次，并且会断言沙箱路径；
- `HOME=<沙箱>` —— skill 根目录与 workmate 库都经由 `HOME` 解析；
- 一个**沙箱工作区** —— 所有按工作区收敛的根目录都从会话工作区解析，因此每次 spawn 与
  `session/create` 都要带上显式的沙箱 cwd。

## git 模型

| 分支 | 用途 | 规则 |
|---|---|---|
| `master` | 发布线 | 只接收发布合并；绝不直接提交或推送 |
| `dev` | 集成线 | 特性与修复分支合并到这里；全部关卡必须通过 |
| `feature/<slug>` | 能力 | 从 `dev` 切出，kebab-case，原子提交并附证据 |
| `fix/<slug>` | 缺陷 | 从 `dev` 切出，一个分支一个缺陷，附复现证据 |

- 提交格式：`<type>(<scope>): <summary>`（`feat`/`fix`/`docs`/`test`/`chore`/`release`）。
- 用 `--no-ff` 与描述性提交信息合并；已发布的分支永不 rebase。
- 修复必须指明它修的是哪个缺陷，并且只有证据就位后才合并。
- **同一个工作树只有一个写者。** 如果多个人（或多个智能体）共用一个检出目录，其中只能有一个执行
  `commit`/`checkout`/`merge`/`reset`；其他人只改文件、跑关卡。
- **`skills/**` 每一波只有一个写者。** 任何 `skills/**` 改动都会让 `VENDOR_LOCK.json` 里的语料指纹
  失效，而唯一那次重新固定（`node scripts/repin-vendor.mjs --write
  --i-know-this-is-the-captains-step`）必须与让它失效的那次改动落在同一次提交里。

## 文档规则

- **必须双语。** 每份面向人的文档 —— 根目录 `README.md`、`docs/` 下的一切，以及每个
  `packages/*/README.md` —— 都要同时提供英文文件与以 `*.zh-CN.md` 命名的简体中文版，并且两个文件都在
  标题正下方带语言切换链接。
- **改一个就必须在同一次提交里改另一个。** `bun run verify:docs` 会校验成对关系、标题树（层级与顺序
  必须完全一致）、中文文件里的真实 CJK 内容，以及每一条相对链接与图片目标的解析结果。
- **面向智能体的内容只用英文。** `AGENTS.md`、`agent-references/**` 以及所有代码注释与 docstring 都
  保持英文。
- **保持标准结构。** 根 README 是产品页（特性、环境要求、安装、快速上手、用法、配置、常见问题、
  贡献指南、变更日志、许可证）；文档中心是 [`docs/index.zh-CN.md`](./docs/index.zh-CN.md)。图片统一
  放在 `docs/assets/images/` 下。
- **按符号引用代码，绝不按行号** —— 文件一改，行号指针就失效了。

## 证据

改动的证据要在提交里与改动放在一起，才算完成：

```
evidence/<domain>/<slug>/<timestamp>/result.json
evidence/<domain>/<slug>/<timestamp>/output.log
```

证据日志绝不能包含凭据、令牌或私有数据。

## 报告问题

- **缺陷与功能请求** —— 直接开 issue。请附上确切的命令、观察到的结果、期望的结果、你的 DSH profile
  与 bundle 版本。
- **安全问题** —— **不要**开公开 issue。请使用 GitHub 仓库 **Security** 标签页里的私密漏洞报告；如果
  该入口不可用，就开一个简短 issue 说明你有一份安全报告并请求私密渠道，但不要在其中披露细节。
- **疑问** —— 先读 [`README.zh-CN.md`](./README.zh-CN.md) 与 [`docs/`](./docs/index.zh-CN.md) 文档
  中心；README 的常见问题一节覆盖了安装与配置上的常见故障。

本项目不随包提供任何凭据，你的报告、补丁与证据里也不应该有。

## 提交 pull request

1. 从 `dev` 切分支（`feature/<slug>` 或 `fix/<slug>`）。
2. 只做一件聚焦的改动；不要夹带无关重构。
3. 跑覆盖你这处改动的关卡 —— 至少 `bun run typecheck`、`bun test packages`，以及（任何文档改动都要跑
   的）`bun run verify:docs`；静态关卡整体用 `bun run verify:gates`。
4. 按 `<type>(<scope>): <summary>` 提交，并带上你的证据目录。
5. 开 pull request 并填好模板：改了什么、为什么改、如何验证，以及哪些关卡留下了落盘证据。

小而聚焦的 pull request 会被很快审查并合并；把新功能、重构和文档重写混在一起的大改动则不会。

## 许可证

本仓库采用 **SUL-1.0** 许可（[`LICENSE.md`](./LICENSE.md)）；采纳的 `agent-teams` 组件保留其自身的
MIT 许可证，该授权仅覆盖该组件本身。完整声明见 [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md)。
