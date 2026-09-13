# mpd-mcp-codegraph

**中文** | [English](./README.md)

离线构建的 MCP server，提供 CodeGraph 工具面（`mcp__codegraph__*`）。由 bundle 的 `mcp-codegraph` 行包装（`@deepseek-ai/dsh-mcp-client`，serverName `codegraph`，stdio）。

## 它做什么

- `launch.mjs` 是该 row 的入口（B8）：它以**相对 bundle 的方式**解析二进制——调用方
  env 固定值 → 通过 `createRequire` 解析 `@colbymchenry/codegraph` 可选依赖（packed
  布局；使用该包自身的 `bin` 条目，例如 `npm-shim.js`）→
  `<bundle>/.toolchain/node_modules/.bin/codegraph`（checkout `link:` 安装）。仅当调用方
  未设置 `MPD_CODEGRAPH_BIN` 时才写入它，随后调用 `dist/serve.js`（在打包时从 vendored 的
  预构建 codegraph dist 构建；见 `packages/mpd-mcp-codegraph/LICENSE` + `NOTICE`）的
  `runCodegraphServe()`。
- 为什么使用 launcher 而不是 row env：上游解析器对**错误**的 `MPD_CODEGRAPH_BIN` 即使在
  文件不存在时也会直接返回，从而硬性阻断其 bundled → provisioned → PATH → download 链路。
- **降级（F-B8-1，wave 3）**：若 `runCodegraphServe()` **抛出异常**——已测量的情形是二进制
  无法解析且状态目录不可写：此时 `ensureCodegraphProvisioned` 在自身 try/catch **之前**调用了
  `acquireLock(...)`，而 `mkdir(<home>/.mdp/codegraph/.locks)` 失败——launcher 会把错误写到
  stderr，将 `MPD_CODEGRAPH_BIN` 设为不存在的、形似路径的哨兵值，并再次调用
  `runCodegraphServe()`。被采纳的解析器随后取 `source: "env"`，`provisionMissingCodegraph`
  在其第一个守卫处返回 null，子进程作为 unavailable MCP server 存活（0 个工具，stderr 输出
  skip 提示，退出码 0），而不是以未捕获异常崩溃。仅当 stdout 尚未写入任何内容时才重试（MCP
  协议独占 stdout）。该降级位于 launcher，而**不是** `dist/serve.js` 内的 delta：后者是受
  sha 固定、由阻塞式 vendor 门禁（`scripts/verify-vendor.mjs`）保护的预构建文件，在那里打标记
  delta 要么使门禁失败，要么把门禁变成自我背书
  （`evidence/wave3/registry-redesign/t1-decision-record.txt` §A4）。
- 与 `mpd-codegraph-plugin`（项目索引初始化）和 `mcp-codegraph` 行搭配使用。

## 证明

`evidence/wave3/codegraph-degrade-and-applytime/`——`degrade-launcher.mjs` 以真正只读的
`$HOME/.mpd` 驱动真实 MCP 子进程：修复前的 launcher 以未捕获的
`ENOENT: ... mkdir '<home>/.mpd/codegraph'` 崩溃且不响应任何 MCP 请求，修复后的 launcher
退出码 0 并响应 `initialize` / `tools/list`（0 个工具）。

## 用法

```bash
node scripts/pack-mpd.mjs   # 将 dist/serve.js + launch.mjs 打包进 bundle
```

bundle patch 行的配置：

```yaml
- id: mcp-codegraph
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codegraph
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-codegraph/launch.mjs]
    toolCallTimeoutMs: 60000
```
