# `vendor/mcp-src` —— 三个 MCP 服务器的仓库内源码快照

[English](./README.md)

本目录是 `scripts/build-mcp.ts` 的**构建输入**。它的存在，是为了让本 bundle 发布的三个 MCP 服务器
可以从**本仓库自身**重建：不需要外部 checkout、不需要网络、不需要 `MPD_UPSTREAM_ROOT`。在此快照之前，
构建需要从一份被钉住的 `oh-my-openagent` checkout 中读取这些源码，因此一台没有该 checkout 的机器
无法重建任何东西 —— `vendor` 门甚至连启动都会被拒绝。

这份快照是**供体源码，不是我们的代码**。它刻意**没有**被 `package.json` 的 `files` 白名单收录，
因此永远不会被打进发布的 `@mpd-dsh/mpd` 制品：打包安装消费的是预构建的
`packages/mpd-mcp-*/dist/cli.js`，只有 checkout 才会重建。

## 来源（可重新推导）

| 事实 | 取值 |
|---|---|
| 上游仓库 | `code-yeongyu/oh-my-openagent`（`https://github.com/code-yeongyu/oh-my-openagent`） |
| 钉住的提交 | `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`（v5.0.0-beta.20） |
| 取回后解析到的提交 | `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` —— 由 `git rev-parse HEAD` 断言与钉子相等 |
| 快照日期（UTC） | 2026-10-07 |
| 源子树 | `packages/{ast-grep-mcp,git-bash-mcp,lsp-daemon,mcp-stdio-core,utils,omo-config-core,lsp-core}` |

快照由**一次性的**浅层稀疏取回产生：把钉住的提交取到被 gitignore 的 scratch 根，再复制这七个包目录：

```bash
git init upstream && cd upstream
git remote add origin https://github.com/code-yeongyu/oh-my-openagent
git config core.sparseCheckout true
git sparse-checkout init --cone
git sparse-checkout set packages/ast-grep-mcp packages/git-bash-mcp packages/lsp-daemon \
  packages/mcp-stdio-core packages/utils packages/omo-config-core packages/lsp-core
git fetch --depth 1 origin 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
git checkout FETCH_HEAD
git rev-parse HEAD   # 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
```

**运行期完全不需要这些。** 取回只在构建期发生一次，scratch 根已被删除；在一台没有 checkout、
没有网络的机器上，`vendor` 门是绿的。

## 内容

| 包 | npm 名称 | 文件数 | 为什么在这里 |
|---|---|---|---|
| `ast-grep-mcp` | `@oh-my-opencode/ast-grep-mcp` | 23 | `mpd-mcp-astgrep` 服务器源码 |
| `git-bash-mcp` | `@oh-my-opencode/git-bash-mcp` | 14 | `mpd-mcp-gitbash` 服务器源码 |
| `lsp-daemon` | `@code-yeongyu/lsp-daemon` | 54 | `mpd-mcp-lsp` 服务器源码 |
| `lsp-core` | `@oh-my-opencode/lsp-core` | 93 | daemon 导入的共享 LSP 实现 |
| `mcp-stdio-core` | `@oh-my-opencode/mcp-stdio-core` | 10 | 共享 MCP stdio 传输层 |
| `omo-config-core` | `@oh-my-opencode/omo-config-core` | 79 | 共享配置加载 |
| `utils` | `@oh-my-opencode/utils` | 184 | 共享工具函数 |
| | **合计** | **457** | |

七个目录逐字节复制，仅有**一项已声明的省略**。

### 已声明的省略：上游的 `AGENTS.md` 指令文件

取回的子树中有八个名为 `AGENTS.md` 的文件。它们是**上游自己**为上游自己仓库写的操作指令，
不是构建输入；而本仓库的项目指令约定会自动读取从项目根到工作目录的 `AGENTS.md` —— 把一份外来指令
文件放进我们的树里，会让任何进入该快照目录的会话读到为**另一个项目**写的指令。因此它们被省略，
并在此登记，使这一省略**可审计、可还原**。每个哈希都是该文件在钉住提交处的 sha256（`sha256sum`）：

| 省略路径（相对于取回后的 `packages/`） | sha256 |
|---|---|
| `AGENTS.md` | `1aa1f5157b0721eab05266bde4c5f434e43fa2b3b94b96d1dc35e0492e55a727` |
| `ast-grep-mcp/AGENTS.md` | `64585b7b84f765f48f67398ad3d37859db8e9d4b4c21011f4365c6647d7eeae5` |
| `git-bash-mcp/AGENTS.md` | `8d6e35a209e65102ad22edb421058eceb7fa86de279013d2146c5d3f3d9987ee` |
| `lsp-core/AGENTS.md` | `f068017014fc734f31b2378df088cff1aa2794b75d41f708bdeb71a1440b2df7` |
| `lsp-daemon/AGENTS.md` | `e2627e9b8794219228764209ecc279a6d85cfd3a42b51da8ce0861a6c450f192` |
| `mcp-stdio-core/AGENTS.md` | `52c6dc98d180009b13db0fc5589ff4b5fe33c2e82325f3b087624a2f71b373de` |
| `omo-config-core/AGENTS.md` | `a74a1a899df11607dd5e77f01eaf3cb9214726a61bd2e16ce7487aba301a9df5` |
| `utils/AGENTS.md` | `e88392304ae33b35a691a25ebb8755ebbd9f3b28343f40be4a05322fccd34cc1` |

没有其他文件被丢弃、改名或修改。

## 许可与署名 —— 实测，而非假定

上游仓库自己的 `LICENSE.md`（在钉住的提交处）把其内容置于 **Sustainable Use License 1.0
（SUL-1.0）** 之下，并声明"并入 oh-my-opencode 软件的第三方组件，按适用组件的所有者提供的原始
许可授权"。这正是本仓库继承的同一份 SUL-1.0（见 `LICENSE.md` 与 `LICENSE-NOTICES.md`）。

逐包声明（读取每个快照自己的 `package.json`）：

| 包 | `license` 字段 |
|---|---|
| `lsp-daemon`（`@code-yeongyu/lsp-daemon`） | `MIT` —— 该包自我声明 |
| 其余六个（`@oh-my-opencode/*`） | 缺失 —— 归入仓库的 SUL-1.0 |

**一项更正，明写而不是悄悄消化掉：** 本波计划条款 A3 要求这份快照携带"其来源 + MIT 声明"。
对照钉住的源码实测，这一措辞对本快照是**错的** —— MCP 源码是 SUL-1.0（其中 `lsp-daemon` 自我声明
MIT），把它们标成 MIT 会是**虚假的来源声明**。计划所指的那项 MIT 署名属于 `dsh-agent-teams`，
那是**另一个上游**、由**另一条 lane** 迁移。本文件登记实测到的许可。两个上游的署名都保留在
`LICENSE-NOTICES.md` 与双语的 `README.md` 对照文件中，这正是条款 A5 的要求。
