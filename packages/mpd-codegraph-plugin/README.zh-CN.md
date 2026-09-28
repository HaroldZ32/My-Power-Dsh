# mpd-codegraph-plugin

**中文** | [English](./README.md)

CodeGraph（仓库/代码智能索引）集成：解析 `codegraph` 二进制，在启动时自动初始化项目索引，并暴露 `/mpd-codegraph` 命令用于手动（重新）运行。

## 它做什么

- 二进制解析顺序：`config.binary` → `MPD_CODEGRAPH_BIN` / `MPD_DSH_CODEGRAPH_BIN`
  环境变量（存在性检查）→ bundle 的可选依赖（`createRequire("@colbymchenry/codegraph")`，
  packed 布局）→ `<bundle>/.toolchain/node_modules/.bin/codegraph`（B8：checkout
  `link:` 布局；pnpm 不会把 link 包的可选依赖装进 profile——与
  `mpd-comment-checker-plugin` 一致）→ PATH。
- 在 apply 时：如果 `autoInit`，则在工作区以超时运行 `codegraph init`；当二进制缺失、初始化冷却（cooldown）生效、或自动初始化被禁用时跳过（报告一行状态）。
- 跳过用户 home 作为项目（避免索引整台机器）；请使用真实的项目目录、`MPD_DSH_CODEGRAPH_PROJECT_CWD` 或 `/mpd-codegraph`。
- 当存在命令注册表（command registry）时，注册 `/mpd-codegraph` 命令（按调用解析项目根，返回 harness 的 `CommandResult` 形状）。

## 项目根解析（O-1）

`mpd-codegraph` 是唯一在 **apply** 时（任何会话存在之前）解析工作区的 mpd 消费者，因此它拿不到工具 `exec`。它改为通过共享适配器的 workspace 平面解析，而不再使用裸 `process.cwd()` 链（`packages/mpd-dsh-adapter-plugin`）。顺序（优先级从高到低）：

1. `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD`——显式覆盖。它同时也是被采纳的 MCP 子进程的 project-cwd 环境变量（`serve.js` 顺序：`MPD_CODEGRAPH_PROJECT_CWD` → session-start cwd → `PWD`），而子进程环境在其 row 启动时即被冻结，因此这仍是子进程的文档化逃生舱。
2. `dsh.workspaceRoot(exec)`——当命令调用提供时，为调用会话的工作区（`/mpd-codegraph` 的调用时路径）；exec-less 形式（apply 时）解析 `DSH_WORKSPACE_ROOT` → `process.cwd()`。
3. `process.cwd()`——适配器自身的最后一级（启动、单元测试）。

行为验证：`packages/mpd-codegraph-plugin/src/index.test.ts` 与
`evidence/wave3/codegraph-degrade-and-applytime/`（带/不带 session root 的挂载启动）。

## 状态（State）

项目索引与初始化锁/冷却标记位于工作区下的 `.codegraph/` 目录（`.codegraph/codegraph.db`、`init.lock`、`init.cooldown`），沿用上游纪律并已加入 `.gitignore` 不会提交。这是与 `.mpd/` 并列的**第二个被认可的工作区状态根**（参见 AGENTS.md §6）——该插件从不在工作区之外写入。

## 配置

| Key | Type | Default |
|---|---|---|
| `autoInit` | boolean | `true` |
| `initTimeoutMs` | number | `60000` |
| `cooldownMs` | number | — |
| `binary` | string | resolved per above |

## 环境变量

- `MPD_CODEGRAPH_BIN`——显式二进制路径（上游 vendored 代码也会读取它）。
- `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD`——项目根目录覆盖（对本插件与 MCP 子进程都是最高优先级）。

## 用法

没有模型工具；MCP 伴生行 `mcp-codegraph` 暴露 `mcp__codegraph__*`。`codegraph` MCP 行的 `command` env 使用 `MPD_DSH_CODEGRAPH_CLI || <pkg>/packages/mpd-mcp-codegraph/launch.ts`；launcher（B8）自行解析二进制，且仅在未设置时写入 `MPD_CODEGRAPH_BIN`，因此本插件与 MCP 行共享同一套解析规则。
