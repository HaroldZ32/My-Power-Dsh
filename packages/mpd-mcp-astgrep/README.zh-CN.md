# mpd-mcp-astgrep

**中文** | [English](./README.md)

离线构建的 MCP server，通过 `mcp__ast_grep__*` 工具暴露 **ast-grep** 结构性代码
搜索/重写。由 bundle 的 `mcp-astgrep` row（`@deepseek-ai/dsh-mcp-client`，
serverName `ast_grep`，stdio）包装。

## 功能

- `launch.ts` 是该 row 的入口（B8）：它以**相对 bundle 的方式**解析二进制——调用方
  env 固定值 → `$MPD_AST_GREP_BIN_DIR/{ast-grep,sg}` → 通过 `createRequire` 解析
  `@ast-grep/cli` 可选依赖（packed 布局，适用于任意 node linker）→
  `<bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}`（checkout `link:` 安装）。
  仅当调用方未设置 `MPD_AST_GREP_SG_PATH` 时才写入它，随后启动 `dist/cli.js`
  （由 `scripts/build-mcp.ts` 离线构建），把 MCP 桥接到上游 ast-grep server。
- 每个层级都优先 `ast-grep` 而非 `sg`：候选必须通过 `--version` 输出包含
  `ast-grep` 的探测，从而拒绝已废弃的 `.bin/sg` wrapper（它以 1 退出）。
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
    args: [<bundle>/packages/mpd-mcp-astgrep/launch.ts]
    toolCallTimeoutMs: 60000
```

该 row **不再指定任何二进制路径**（B8）：解析逻辑位于 `launch.ts` +
`packages/mpd-mcp-shared/bin-resolve.ts`，因此在两种安装布局下都可用，且调用方的
错误固定值不会被静默覆盖。

## 注意事项

- Env 键 `MPD_AST_GREP_SG_PATH` 由上游 vendored 代码读取——切勿重命名（AGENTS.md §1）。
  当调用方设置了它时，launcher 不会改动它。
- 缺少二进制的症状：`ast-grep BINARY_NOT_FOUND`——安装 toolchain
  （`node scripts/install-mcp.ts` 或 `install-profile.ts --yes`）或设置该 env 路径。
