# mpd-mcp-lsp

**中文** | [English](./README.md)

离线构建的 MCP server，通过 `lsp` transport 驱动语言服务器（`mcp__lsp__*` 工具）
——定义、引用、诊断、悬停。由 bundle 的 `mcp-lsp` row（`@deepseek-ai/dsh-mcp-client`，
serverName `lsp`，stdio）包装。

## 功能

- `dist/cli.js`（由 `scripts/build-mcp.mjs` 离线构建）与随附的 LSP daemon 说 MCP；
  `mcp` 子命令用于选择 server 模式。
- 在真实 home 上 daemon 会自动启动；设置破损的症状：`LSP daemon unreachable`
  （`~/.mpd` 不可写/缺失）。

## Bundle row

```yaml
- id: mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: lsp
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/dist/cli.js, mcp]
    toolCallTimeoutMs: 60000
```

## 注意事项

- 精确的符号事实（定义/引用/诊断）优先用 LSP；结构性模式查询用 ast-grep；两者在限定
  范围时都很便宜。

## RTL（Verilog / SystemVerilog）LSP 支持

离线构建的 `dist/cli.js` 内置了两个 HDL 语言服务器的**内置（builtin）注册**
（由 `scripts/build-mcp.mjs` 应用仓库内 overlay，锚点 `mpd-rtl-overlay-v1`）：

- `verible` → `verible-verilog-ls`，扩展名 `.v .vh`
- `slang-server` → `slang-server`，扩展名 `.sv .svh`

可执行文件在 `PATH` 上时按文件扩展名自动解析；`lsp-setup` skill 将 `.v/.vh`
路由到 `references/verilog/README.md`、`.sv/.svh` 路由到
`references/systemverilog/README.md` 获取安装/验证步骤。

### 自定义二进制逃生通道

如果你手工构建了 `verible-verilog-ls` / `slang-server` 且它们**不在** `PATH`
上，请在 **用户级** LSP 配置（`~/.codex/lsp-client.json`，或
`LSP_TOOLS_MCP_USER_CONFIG` 指定的单一路径）中用显式 `command` 定义它们。
现成模板位于 `templates/rtl-lsp-client.json` —— 将其 `"lsp"` 条目合并进该用户
配置。**不要**把自定义命令放进项目 `.codex/lsp-client.json`：项目配置会忽略
非内置 id。
