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
- **其他每种语言都由「语言→服务器」目录表接入**（`src/server-catalog.ts`），因此用户侧只需
  安装语言服务器这一步——见[语言服务器（bootstrap）](#语言服务器bootstrap)。

## 工具

cclsp 自己的十二个名字，本 bundle **原样使用**——不存在任何名称转换 shim：
`find_definition`、`find_references`、`find_implementation`、`rename_symbol`、
`rename_symbol_strict`、`get_diagnostics`、`get_hover`、`find_workspace_symbols`、
`prepare_call_hierarchy`、`get_incoming_calls`、`get_outgoing_calls`、`restart_server`。

其中两个会写盘（`rename_symbol`、`rename_symbol_strict`），因此二者都在只读专家的拒绝名单上。

## 配置

只有当调用方未设置时，启动器才会设置 `CCLSP_CONFIG_PATH`，顺序如下：

1. 调用方设置的 `CCLSP_CONFIG_PATH`——永远优先；
2. `<workspace>/cclsp.json`——用户手工维护的文件。它是**权威的**：启动器只检测它的存在，
   从不读取、合并或改写它；
3. `<workspace>/.mpd/lsp/cclsp.json`——生成的配置，且仅在其字节会变化时才重写。

生成的文档包含 TS/JS 家族，以及目录表中**实际已安装**服务器的每一种语言（见下）。cclsp 按
扩展名分组**惰性**启动服务器，因此配置里含有你并不使用的语言行，在你真正查询该语言文件之前
不产生任何开销。

## 语言服务器（bootstrap）

`src/server-catalog.ts` 是机器可读的唯一事实来源：**59 行**，每种语言家族一行，每行都带
**`server`**、**`licence`**、**`installCommand`**、**`npmInstallable`** 与 **`caveat`**，
外加裸扩展名 `extensions`、cclsp 启动用的 `command` argv、每个事实所读的 `citations`，
以及一个 `verification` 标记。

- **`verification: "primary"`**——每个事实都可追溯到一份**确实被取回**的文档（包注册表自身的
  元数据、仓库的许可证文件、或其 README/安装页）。共 45 行。
- **`verification: "unverified"`**——至少有一个事实无法钉到这样的文档上。该行的 caveat 以
  `UNVERIFIED` 开头并说明哪一部分较弱，因此无论本 README 还是生成的配置都不会把弱行当作已核验
  的行。共 16 行。

引用不是装饰：`test/server-catalog.test.ts` 驱动启动器所用的同一个校验器，一旦某行缺失任一必需
字段或许可证字符串为空就会变红；`test/language-coverage.test.ts` 把目录表钉在 ≥40 种语言的下限、
八条非宽松守卫、已记录的许可证争议以及 npm 陷阱清单之上。

`references/` 下的两个页面承载 `lsp-setup` 技能路由进本包的 HDL 那一半：
[`references/verilog/README.zh-CN.md`](./references/verilog/README.zh-CN.md) 与
[`references/systemverilog/README.zh-CN.md`](./references/systemverilog/README.zh-CN.md)。

### 语言如何被接入

1. **安装服务器**——执行该行的 `installCommand`，由你来跑。本 bundle 从不安装语言服务器，
   从不在请求时下载，其生成的任何 argv 也不经过 `npx`。
2. **让它可达**——全局装到 `PATH`，或装到工作区的 `node_modules/.bin`。启动器两者都探测，
   并把找到的**绝对路径**写入配置，因此工作区内的服务器无需改动 `PATH` 即可遮蔽全局同名者。
3. **重启会话**——启动器在启动时重新生成配置，新行随即出现。
4. **查询该语言的文件**——cclsp 在首次使用时启动服务器。

未安装的服务器会被**有意排除**在生成的配置之外：该扩展名随后以 cclsp 自己的报错
（“No LSP server configured for file”）失败，而不是为一个并不存在的二进制报 spawn 错误。
另外两个决定值得保留——请勿把它们“改回去”：

- **由探测决定，而不是由目录表决定。** 只有当某行的可执行文件确实可解析（先看工作区的
  `node_modules/.bin`，再看 `PATH`，并写入绝对路径）时，该行才会进入生成的配置。因此是“安装”
  把服务器接入，任何配置都不会指向并不存在的二进制。
- **请求时不安装任何东西。** 生成的 argv 从不经过 `npx`，本 bundle 也不会运行任何一行的
  `installCommand`——这正是语言平面能离线安全、且语言服务器不进入依赖闭包的原因。

### 安装指南

优先使用语言自身的包管理器，并且**不要**手工编辑 `<workspace>/.mpd/lsp/cclsp.json`——它在
字节会变化时会被重新生成。

| 途径 | 何时 | 形态 |
|---|---|---|
| npm | 该行 `npmInstallable: true` | `npm install -g <package>` |
| 语言工具链 | 该行 `npmInstallable: false` | `go install …`、`rustup component add …`、`gem install …`、`opam install …`、`pip install …`、`cargo install …`、`dotnet tool install -g …`、`nimble install -g …` |
| 上游发行版 | 服务器只提供二进制 | 从该行的 `citations` 下载并放入 `PATH` |

若想手工接入——未收录的语言、固定到某个 fork，或目录表在 caveat 里提到的替代者——请写
`<workspace>/cclsp.json`，启动器会原样使用它：

```json
{
  "servers": [
    { "extensions": ["ex", "exs"], "command": ["/opt/elixir-ls/language_server.sh"], "rootDir": "." }
  ]
}
```

扩展名是**裸的**（不带点）——这是 cclsp 自己的格式——而 `command[0]` 会直接交给 `spawn`，
因此绝对路径完全可用。

### npm 陷阱——不要接入这些包

有五个 npm 名字看起来像与它们同名的服务器，但并不是。目录表把它们记为 `NPM_TRAPS`，并有测试
断言没有任何一行的安装命令指向其中之一：

| npm 包 | 它实际上是什么 | 真正的途径 |
|---|---|---|
| `gopls` | 无 bin 的 `0.0.1-security` 占位包 | `go install golang.org/x/tools/gopls@latest` |
| `rust-analyzer` | 无 bin 的 `0.0.1-security` 占位包 | `rustup component add rust-analyzer` |
| `clangd` | 无 bin 的空 `0.0.0` 包 | 发行版的 clangd，或 LLVM 发行版 |
| `zls` | 与 `zigtools/zls` 无关的第三方包装 | 与你的 Zig 版本匹配的 zls 发行版 |
| `marksman` | 无关项目（`fussydesigns/marksman`） | `brew install marksman`（artempyanykh/marksman） |

### 非宽松许可的服务器

调研集合中有八个服务器**并非**宽松许可，任何行、文档或报告都不得把它们称作 MIT：

| 服务器 | 语言 | 许可证 | 说明 |
|---|---|---|---|
| Eclipse JDT LS（`jdtls`） | Java | **EPL-2.0** | 弱 copyleft；只是拉起，本仓库不重新分发。 |
| `terraform-ls` | Terraform / HCL | **MPL-2.0** | 文件级 copyleft 开源许可。 |
| Intelephense 的服务器 | PHP | **专有** | 商业 EULA，Premium Features 由许可证密钥解锁——同时它仍可经 npm 安装，因此“可 npm 安装”与“非开源”是两个独立事实。宽松替代者是 `phpactor`（MIT）。 |
| C# Dev Kit 语言服务器 | C# / Razor | **专有** | 微软随其发布，且完全没有许可证文件。本目录表的宽松 C# 路径是 `csharp-ls`（MIT）。 |
| `lemminx` | XML | **EPL-2.0** | 弱 copyleft（Eclipse）。 |
| `nixd` | Nix | **LGPL-3.0** | 弱 copyleft；目录表改为接入 `nil`（MIT OR Apache-2.0）并写明这一点。 |
| `vhdl_ls` | VHDL | **MPL-2.0** | 文件级 copyleft。 |
| `texlab` | LaTeX | **GPL-3.0** | 强 copyleft。 |

**不要把 Roslyn 的细节压平。** Roslyn **编译器**是 MIT，独立的 NuGet 包
`roslyn-language-server` 也声明 MIT；真正专有的是微软发布的 C# Dev Kit **产品**。请写
“C# Dev Kit（专有）”——永远不要写“Roslyn 是专有的”，也永远不要写“Roslyn 是 MIT”好像那覆盖了
随 C# Dev Kit 发布的服务器。

`src/server-catalog.ts` 里的 `NON_PERMISSIVE_SERVERS` 是这份名单的常驻守卫：服务器名匹配其中
关键词的行必须携带该许可证，且永不被标注为 `MIT`。当两个来源互相矛盾时——例如 `protols`，其
上游 `coder3101/protols` 的 LICENSE 读出 MIT，而一个 404 的 fork 没有许可证——分歧会被记录在
`LICENCE_DISPUTES` 与该行的 caveat 中，而不是被悄悄倒向任何一边。

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
server。目录表把这份广度以我们自己的数据恢复回来，cclsp 则驱动配置里写的东西——区别在于，
这个决定现在是一条你可以阅读和修正的、有文档的行，而不是某个 vendored daemon 里的代码。

## 注意事项

- 精确的符号事实（定义/引用/诊断）优先用 LSP；结构性模式查询用 ast-grep；两者在限定范围时
  都很便宜。
- 若 profile 中缺少该依赖，row 会**保持存活但零工具**，并把原因记录到
  `<root>/.mpd/logs/mpd-mcp-lsp.log`，而不是拖垮启动。
- 决定哪些目录表行会被接入的探测是 `PATH` 与 `<workspace>/node_modules/.bin` 上的**名字查找**，
  在 POSIX 上会校验可执行位。在 Windows 上任何普通文件都会命中，因此名字与包名不同的 `.cmd`
  shim 找不到——请把这类服务器全局安装，或在 `<workspace>/cclsp.json` 中写它的路径。
