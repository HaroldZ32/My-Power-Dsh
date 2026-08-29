# mpd-codegraph-plugin

**中文** | [English](./README.md)

CodeGraph（仓库/代码智能索引）集成：解析 `codegraph` 二进制，在启动时自动初始化项目索引，并暴露 `/mpd-codegraph` 命令用于手动（重新）运行。

## 它做什么

- 二进制解析顺序：`config.binary` → `MPD_CODEGRAPH_BIN` 环境变量 → bundle 的可选依赖（`@colbymchenry/codegraph`，位于 `node_modules/.bin`）。
- 在 apply 时：如果 `autoInit`，则在工作区以超时运行 `codegraph init`；当二进制缺失、初始化冷却（cooldown）生效、或自动初始化被禁用时跳过（报告一行状态）。
- 跳过用户 home 作为项目（避免索引整台机器）；请使用真实的项目目录、`MPD_DSH_CODEGRAPH_PROJECT_CWD` 或 `/mpd-codegraph`。
- 当存在命令注册表（command registry）时，注册 `/mpd-codegraph` 命令。

## 配置

| Key | Type | Default |
|---|---|---|
| `autoInit` | boolean | `true` |
| `initTimeoutMs` | number | `60000` |
| `cooldownMs` | number | — |
| `binary` | string | resolved per above |

## 环境变量

- `MPD_CODEGRAPH_BIN`——显式二进制路径（上游 vendored 代码也会读取它）。
- `MPD_DSH_CODEGRAPH_PROJECT_CWD`——项目根目录覆盖。

## 用法

没有模型工具；MCP 伴生行 `mcp-codegraph` 暴露 `mcp__codegraph__*`。`codegraph` MCP 行的 `command` env 使用 `MPD_DSH_CODEGRAPH_CLI || <pkg>/packages/mpd-mcp-codegraph/dist/serve.js`。
