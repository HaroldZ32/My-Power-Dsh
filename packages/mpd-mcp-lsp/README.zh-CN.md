# mpd-mcp-lsp

**中文** | [English](./README.md)

已声明 npm 依赖 **`cclsp`**（MIT，© 2025 ktnyt）的薄启动器——bundle 的语言服务器平面，
以 `mcp__lsp__*` 工具暴露。由 bundle 的 `mcp-lsp` row（`@deepseek-ai/dsh-mcp-client`，
serverName `lsp`，stdio）包装。

## 功能

- `dist/launch.js`（我们自己的文件，由本包的 `build` 脚本构建）从已安装 profile 的
  `node_modules` 解析 `cclsp`，把本进程的终端写入者从终端移走
  （`<root>/.mpd/logs/mpd-mcp-lsp.log`），再在进程内导入 cclsp 的 `bin` 入口。
- 没有任何 vendored 内容，也没有任何东西再从 `vendor/mcp-src/**` 构建：该快照、已退役的
  `scripts/build-mcp.ts`，以及它产出的 SUL-1.0 `lsp-daemon` 构建都已删除（de-omo B2 波）。
- TS/JS 语言服务器无需用户安装：cclsp 依赖 `typescript-language-server`（Apache-2.0），
  启动器生成的配置直接指向那一份。

## 工具

cclsp 自己的十二个名字，本 bundle **原样使用**——不存在任何名称转换 shim：
`find_definition`、`find_references`、`find_implementation`、`rename_symbol`、
`rename_symbol_strict`、`get_diagnostics`、`get_hover`、`find_workspace_symbols`、
`prepare_call_hierarchy`、`get_incoming_calls`、`get_outgoing_calls`、`restart_server`。

其中两个会写盘（`rename_symbol`、`rename_symbol_strict`），因此二者都在只读专家的拒绝名单上。

## 配置

只有当调用方未设置时，启动器才会设置 `CCLSP_CONFIG_PATH`，顺序如下：

1. 调用方设置的 `CCLSP_CONFIG_PATH`——永远优先；
2. `<workspace>/cclsp.json`——用户手工维护的文件；
3. `<workspace>/.mpd/lsp/cclsp.json`——生成的配置，仅 TypeScript/JavaScript，且仅在其字节会
   变化时才重写。

其他语言就是配置文件里的一条 `servers` 条目：cclsp 会启动其中指定的语言服务器，而该服务器
由用户自行安装（`gopls`、`pylsp`、`rust-analyzer` 等）。

## Bundle row

```yaml
- id: mcp-lsp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: lsp
    transport: stdio
    command: node
    args: [<bundle>/packages/mpd-mcp-lsp/dist/launch.js]
    toolCallTimeoutMs: 60000
```

## 能力差异（de-omo B2 波）

被退役的 server 暴露八个名字；cclsp 暴露十二个，其中旧名字里有三个没有对应物。没有任何一个是
悄悄消失的：

| 旧名字 | 状态 | 原因 |
|---|---|---|
| `status` | **已删除** | 它报告的是 vendored daemon 自身的状态；那个 daemon 已不存在。存活下来的运维动词是 `restart_server`，而 LSP 平面的自述落在启动器的日志文件里。 |
| `prepare_rename` | **已删除** | cclsp 的 `rename_symbol` 原子地完成符号解析与改写，因此没有单独的 prepare 步骤可调用。该能力是被吸收，而非丢失。 |
| `install_decision` | **已删除** | 它记录的是已退役 `lsp-core` 读取的决策。cclsp 没有这种机制：缺失的语言服务器按请求报错。 |
| `diagnostics` | 已替换 | `get_diagnostics` |
| `goto_definition` | 已替换 | `find_definition` |
| `find_references` | 已替换 | `find_references` |
| `symbols` | 已替换 | `find_workspace_symbols` |
| `rename` | 已替换 | `rename_symbol`（+ `rename_symbol_strict`） |
| — | **新增** | `find_implementation`、`get_hover`、`prepare_call_hierarchy`、`get_incoming_calls`、`get_outgoing_calls`、`restart_server` |

**语言覆盖也是差异**：退役的 overlay 带有约 40 种语言的安装提示，并由自己的代码决定启动哪个
server。cclsp 驱动配置里写的东西，因此 TS/JS 家族开箱可用（来自它自己的依赖），其他任何语言
则是 `cclsp.json` 一条条目加上用户自己的语言服务器。

## 注意事项

- 精确的符号事实（定义/引用/诊断）优先用 LSP；结构性模式查询用 ast-grep；两者在限定范围时
  都很便宜。
- 若 profile 中缺少该依赖，row 会**保持存活但零工具**，并把原因记录到
  `<root>/.mpd/logs/mpd-mcp-lsp.log`，而不是拖垮启动。
