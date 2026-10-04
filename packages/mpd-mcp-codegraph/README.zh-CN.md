# mpd-mcp-codegraph

**中文** | [English](./README.md)

离线构建的 MCP server，提供 CodeGraph 工具面（`mcp__codegraph__*`）。由 bundle 的 `mcp-codegraph` 行包装（`@deepseek-ai/dsh-mcp-client`，serverName `codegraph`，stdio）。

## 它做什么

- `launch.ts` 是该 row 的入口（B8）：它以**相对 bundle 的方式**解析二进制——调用方
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
  sha 固定、由阻塞式 vendor 门禁（`scripts/verify-vendor.ts`）保护的预构建文件，在那里打标记
  delta 要么使门禁失败，要么把门禁变成自我背书
  （`evidence/wave3/registry-redesign/t1-decision-record.txt` §A4）。
- **预构建文件“加载失败”时同样降级（主机缺陷，2026-09-22 实测）**：该产物在**模块加载期**执行
  `var ACCOUNT_HOME_DIR = userInfo().homedir`，因此在 libuv 的 `uv_os_get_passwd` 失败的主机上，
  它在回答第一帧之前就抛出 `SystemError: ... ENOMEM`；而一个 MCP 子进程崩溃会把整个 bundle 的启动
  一起拖垮（Web 应用始终无法提供服务）。因此 `launch.ts` 现在包裹该 `import`：失败时由自身作为
  UNAVAILABLE server 应答握手（0 个工具，原因输出到 stderr，退出码 0），会话照常启动、原因可读。
  规则同上：delta 只写在 launcher 里，绝不写进受 sha 固定的预构建文件。
- **共享 daemon 策略（`daemon-policy.ts`）**：被采纳的 server 既可依托按项目根共享的 daemon
  （`<projectRoot>/.codegraph/daemon.{sock,pid}`），也可用自身进程内引擎服务会话。daemon 的消失
  并不受会话控制——上游会在空闲 30 分钟后回收它（即使仍有客户端连接，`DEFAULT_MAX_IDLE_MS`），
  `codegraph daemon` 的停止会 SIGTERM 它，而基于 pid 的存活探测在 PID namespace 中不可信——连接
  丢失时会报 `[CodeGraph MCP] Shared daemon connection lost; serving this session in-process
  (degraded), re-serving 0 in-flight request(s).`。因此本 bundle 默认改为**进程内服务**（无
  daemon、无该提示；`.codegraph/codegraph.db` 仍在会话间共享，只有引擎/watcher 是每会话的）。
  `MPD_CODEGRAPH_DAEMON=1` 恢复上游共享 daemon，`=0` 显式声明默认行为，显式设置的
  `CODEGRAPH_NO_DAEMON=1`（上游自带的 opt-out）永不被覆盖。launcher 在 import `dist/serve.js`
  **之前**应用该策略，因为 vendored bridge 在加载时即冻结子进程 env。
- 与 `mpd-codegraph-plugin`（项目索引初始化）和 `mcp-codegraph` 行搭配使用。

## 证明

`evidence/wave3/codegraph-degrade-and-applytime/`——`degrade-launcher.mjs` 以真正只读的
`$HOME/.mpd` 驱动真实 MCP 子进程：修复前的 launcher 以未捕获的
`ENOENT: ... mkdir '<home>/.mpd/codegraph'` 崩溃且不响应任何 MCP 请求，修复后的 launcher
退出码 0 并响应 `initialize` / `tools/list`（0 个工具）。
`evidence/mpd-defects-2/raw/codegraph-daemon-probe.ts` 是 daemon 的双向证明：A 臂（默认）用自身
引擎应答 `initialize`/`tools/call`，且不产生任何 daemon 产物、也没有 `Shared daemon` 提示；B 臂
（`MPD_CODEGRAPH_DAEMON=1`）则走上游的 daemon 路径。

## 终端输出（R5）

`launch.ts` 的第一条语句就调用 `packages/mpd-mcp-shared/log-sink.ts` 的
`installTerminalSilence("mpd-mcp-codegraph")`，早于 `dist/serve.js` 的导入。harness 构造该 row 时
**没有 `stderr` 选项**，MCP SDK 随后以 `stdio: ["pipe", "pipe", "inherit"]` 派生本子进程，于是本进程的
fd 2 就是 dsh 进程的 fd 2——在 TUI 会话中即 Ink 备用屏幕。该 sink 把 `process.stderr.write` 与
`console` 的五个输出方法替换为写入 `<root>/.mpd/logs/mpd-mcp-codegraph.log`（1 MiB 上限、单个 `.1`
轮转），且绝不回退到终端。`process.stdout` 始终不动：它承载 MCP 协议。

**已知残留（2026-10-02 实测）：** 被采纳的 `dist/serve.js` bridge 以硬编码的
`stdio: ["pipe", "pipe", "inherit"]`（`runBridgedCodegraphProcess`）派生真正的 codegraph CLI，
因此那个孙进程的 stderr 仍会直达 fd 2、绕过本次替换。`dist/serve.js` 是 vendor 门禁下的
sha 固定预构建件，故此处不做 delta。两条可行路径：(a) row 层修复属于 harness——在
`createTransport` 的 `StdioClientTransport` 选项中传入 `stderr: "pipe"`；(b) 在文件描述符层面加一层
包装，让 bridge 的子进程拿到日志 fd 而非继承的 fd。

**手工调试开关：** `MPD_MCP_STDERR_REBIND=0` 只跳过描述符重绑，因此人工运行该 launcher 时仍能在终端
看到 stderr；基于 writer 的 sink（写文件）保持生效。此时
`installTerminalSilence(...).stderrRebind()` 报告 `"disabled"`。

## 用法

```bash
node scripts/pack-mpd.ts   # 将 dist/serve.js + launch.ts 打包进 bundle
```

bundle patch 行的配置：

```yaml
- id: mcp-codegraph
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: codegraph
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-codegraph/dist/launch.js]
    toolCallTimeoutMs: 60000
```
