# mpd-mcp-gitbash

**中文** | [English](./README.md)

离线构建的 MCP server，通过 `mcp__git_bash__*` 工具暴露 **Git Bash**（原生
Windows git 操作）。由 bundle 的 `mcp-gitbash` row（`@deepseek-ai/dsh-mcp-client`，
serverName `git_bash`，stdio）包装。

## 功能

- `dist/cli.js`（由 `scripts/build-mcp.mjs` 离线构建）将 MCP 桥接到 Windows 上的原生
  Git Bash。
- **按设计仅限 Windows**（上游原始内容：`run` 仅在原生 Windows 上可用）；bundle row
  默认携带 `disabled: true`，因此非 Windows 部署不受影响。

## Bundle row

```yaml
- id: mcp-gitbash
  name: '@deepseek-ai/dsh-mcp-client'
  disabled: true   # Windows deployments may flip this
  config:
    serverName: git_bash
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-gitbash/dist/cli.js]
    toolCallTimeoutMs: 60000
```

## 注意事项

- 在 Linux/macOS 上请使用 `bash` 工具；此 server 仅服务于原生 Windows git UX。
