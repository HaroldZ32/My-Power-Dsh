# SystemVerilog —— `.sv` / `.svh` 的语言服务器

[English](./README.md) | **中文**

本页是 `lsp-setup` 技能路由中 SystemVerilog 的那一半：该技能把 `.sv` 与 `.svh` 文件送到这里，
即拥有 LSP 平面的那个包。机器可读的那一行在 `packages/mpd-mcp-lsp/src/server-catalog.ts`
（`language: "systemverilog"`）；本页是它的人类可读版本。

## 服务器

| | |
|---|---|
| 服务器 | `svls` |
| 语言 | SystemVerilog（`.sv`、`.svh`） |
| 许可证 | **MIT**——宽松许可 |
| 可执行文件 | `svls` |
| 安装 | `cargo install svls`，或 `sudo snap install svls` |
| npm 可安装 | 本服务器**否** |

## 接入方式

1. 用上面的命令之一安装服务器（或从 <https://github.com/dalance/svls/releases> 下载发行压缩包，
   把二进制放进 `PATH`）。
2. 重启会话。启动器会探测目录表、找到 `svls`，并把 `sv` 与 `svh` 的 `servers` 行写入
   `<workspace>/.mpd/lsp/cclsp.json`。
3. 对 UVM 或 include 密集的项目，在源码旁添加 `svls.toml` 列出 include 目录——没有它，svls 只
   能索引从工作区根可达的内容。

未安装的服务器会被**有意排除**在生成的配置之外，因此未被路由的 `.sv` 文件会以 cclsp 自己的
“No LSP server configured for file” 报错，而不是为一个并不存在的二进制报 spawn 错误。

## 备选方案及其许可证

| 服务器 | 许可证 | 何时选它 |
|---|---|---|
| `svls`（本行） | **MIT** | 一条命令即可安装，自行索引工作区。 |
| `verible-verilog-ls` | Apache-2.0 | 已为 [Verilog 页面](../verilog/README.zh-CN.md)存在；一整套工具链，服务器旁边还有格式化器与 linter。 |
| `@imc-trading/svlangserver`（`svlangserver`） | **MIT** | npm 可安装路径（`npm install -g @imc-trading/svlangserver`），适用于 Node 工具链比 Rust 或发行压缩包更省事的机器。 |

同一时刻只能有一个作为被接入的 `.sv` 服务器——cclsp 把某个扩展名路由到唯一一条 `servers` 条目
——因此切换意味着在 `<workspace>/cclsp.json` 中写明替代者，而启动器永不改写该文件。
