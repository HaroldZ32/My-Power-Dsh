# mpd-mcp-astgrep

**中文** | [English](./README.md)

离线构建的 MCP server，通过 `mcp__ast_grep__*` 工具暴露 **ast-grep** 结构性代码
搜索/重写。由 bundle 的 `mcp-astgrep` row（`@deepseek-ai/dsh-mcp-client`，
serverName `ast_grep`，stdio）包装。

## 功能

- `dist/cli.js`（由 `scripts/build-mcp.mjs` 离线构建）将 MCP 桥接到
  `@ast-grep/cli` 二进制，经由 `MPD_AST_GREP_SG_PATH` 或 bundle 的可选依赖
  `node_modules/.bin/sg` 解析。
- 最适合结构性/模式查询（“找出所有没有错误处理的 `fn`”）、重构候选和全仓库规则检查
  ——远比盲目的 grep 便宜。

## Bundle row

```yaml
- id: mcp-astgrep
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ast_grep
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-astgrep/dist/cli.js]
    env: { MPD_AST_GREP_SG_PATH: <bundle>/node_modules/.bin/sg }
    toolCallTimeoutMs: 60000
```

## 注意事项

- Env 键 `MPD_AST_GREP_SG_PATH` 由上游 vendored 代码读取——切勿重命名（AGENTS.md §1）。
- 缺少二进制的症状：`ast-grep BINARY_NOT_FOUND`——安装 toolchain
  （`node scripts/install-profile.mjs --yes`）或设置该 env 路径。
