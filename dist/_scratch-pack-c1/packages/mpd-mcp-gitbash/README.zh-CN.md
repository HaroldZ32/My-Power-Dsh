# mpd-mcp-gitbash

**中文** | [English](./README.md)

一个启动器，**两个**已声明 npm 依赖，由 bundle 的两个 row 启动：`mcp-git` 与 `mcp-shell`
（`@deepseek-ai/dsh-mcp-client`，serverName `git` 与 `shell`，stdio，二者都是
`disabled: true`）。

## 功能

- `dist/launch.js` 是我们自己的文件（由本包的 `build` 脚本构建）。它把本进程的终端写入者从终端
  移走（`<root>/.mpd/logs/mpd-mcp-gitbash.log`），从已安装 profile 的 `node_modules` 解析所选
  依赖，并在进程内导入其 `bin` 入口。
- `argv[2]` 选择 server：`git`（默认）启动 `@cyanheads/git-mcp-server`（Apache-2.0，28 个
  `git_*` 工具，需要 `PATH` 上有 `git`）；`shell` 启动 `mcp-server-commands`（`run_process`）。
- 不再有任何 vendored 内容：SUL-1.0 的 `git-bash-mcp` 构建、已退役的 `scripts/build-mcp.ts`
  以及它读取的 `vendor/mcp-src/**` 快照都已删除（de-omo B2 波）。

## 许可证据

`mcp-server-commands` 0.8.2 附带的 `LICENSE` 文件正文就是 MIT 授权文本，但它的 `package.json`
**完全没有 `license` 字段**——本 bundle 所依赖的证据是那个许可文件
（sha256 `bee06c55…`），而不是某个已声明的 SPDX 标识符。`@cyanheads/git-mcp-server` 2.15.3
声明 `Apache-2.0` 并附带其 `LICENSE`（sha256 `7915fc5b…`）。

两个包在其已发布清单里都带一个 `prepare` 脚本。对于 registry 依赖而言，二者都不是安装脚本：
pnpm 安装它们时既不需要构建脚本批准，也没有 ignored-builds 报错（已实测——见本波证据），
而且二者附带的入口**已经构建完成**（`dist/index.js`、`build/index.js`）。

## Bundle rows

```yaml
- id: mcp-git
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: git
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/launch.js, git]
    toolCallTimeoutMs: 60000
- id: mcp-shell
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true
  config:
    serverName: shell
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/launch.js, shell]
    toolCallTimeoutMs: 60000
```

## 能力差异（de-omo B2 波）

**一个旧 row 变成了两个**，而且旧 server 并不是它名字暗示的东西。被退役的 `git-bash-mcp` 暴露
的是一个裸 shell 运行器——`run`、`which_bash`、`diagnose`——且该 row 携带 `disabled: true`
（上游把 `run` 标为仅原生 Windows 可用）。这些都没有被悄悄继承：

| 旧工具 | 状态 | 去向 |
|---|---|---|
| `run` | 已替换 | `mcp__shell__run_process`（`mcp-server-commands`）——同样的裸 shell 能力，且不再仅限 Windows |
| `which_bash` | **已删除** | 内置 `bash` 工具已经能回答它；新 row 没有 shell 发现工具 |
| `diagnose` | **已删除** | 它报告的是 vendored server 自己的 bash 发现结果；没有对应物，其对象也已不存在 |
| — | **新增** | 整个 `mcp__git__git_*` 家族（28 个工具：`git_status`、`git_diff`、`git_log`、`git_commit`、`git_blame`、`git_worktree` 等）——旧 row 从来没有过的真正 git 工具箱 |

两个 row 都保留旧 row 的 `disabled: true` 姿态。它们天生可写（会执行命令、改动仓库），这也是
为什么两个工具名都不在只读拒绝名单里：被禁用的 row 不注册任何工具，而 harness 在 spawn 时会
校验整份拒绝名单。

## 注意事项

- 在 Linux/macOS 上，内置 `bash` 工具覆盖日常 shell 工作；`mcp-shell` row 的存在是为了让该能力
  在没有 vendored server 的情况下依然存续。
- 若 profile 中缺少该依赖，row 会**保持存活但零工具**，并把原因记录到
  `<root>/.mpd/logs/mpd-mcp-gitbash.log`，而不是拖垮启动。
