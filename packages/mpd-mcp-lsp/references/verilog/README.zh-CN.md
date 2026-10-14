# Verilog —— `.v` / `.vh` 的语言服务器

[English](./README.md) | **中文**

本页是 `lsp-setup` 技能路由中 Verilog 的那一半：该技能把 `.v` 与 `.vh` 文件送到这里，即拥有 LSP
平面的那个包。机器可读的那一行在 `packages/mpd-mcp-lsp/src/server-catalog.ts`（`language:
"verilog"`）；本页是它的人类可读版本。

## 服务器

| | |
|---|---|
| 服务器 | `verible-verilog-ls`（Verible 工具链的一部分） |
| 语言 | Verilog（`.v`、`.vh`） |
| 许可证 | **Apache-2.0**——宽松许可 |
| 可执行文件 | `verible-verilog-ls` |
| 安装 | 从 <https://github.com/chipsalliance/verible/releases> 下载并解压发行版 |
| npm 可安装 | **否**——Verible 没有受支持的 npm 包 |

Verible 是 Chips Alliance 的 SystemVerilog 工具链；`verible-verilog-ls` 是其发行压缩包中的语言
服务器二进制，`verible-verilog-format` / `verible-verilog-lint` 与它同处一包，因此同一次安装也
带来了格式化器与 linter。

## 接入方式

1. 从发行版页面下载对应平台的压缩包并解压。
2. 把 `verible-verilog-ls` 放进 `PATH`。
3. 重启会话。启动器会探测目录表、找到该可执行文件，并把 `v` 与 `vh` 的 `servers` 行写入
   `<workspace>/.mpd/lsp/cclsp.json`。

如果二进制位于不常见的位置，跳过第 2 步，改为在 `<workspace>/cclsp.json` 中写明它——该文件是
权威的，启动器永不改写它：

```json
{
  "servers": [
    { "extensions": ["v", "vh"], "command": ["/opt/verible/bin/verible-verilog-ls"], "rootDir": "." }
  ]
}
```

## 需要知道的边界

- 在多数发行版中该二进制**不**通过包管理器分发，因此发行压缩包就是途径；项目也记录了从源码用
  Bazel 构建的方法。
- Verible 是 SystemVerilog 时代的解析器：它未建模的旧式 Verilog-2001 构造会以解析诊断的形式
  返回，而不是静默通过。
- 该行只声明 `.v` 与 `.vh`。混有 `.sv` 源文件的项目还需要
   [`systemverilog` 页面](../systemverilog/README.zh-CN.md)——两行可以同时存在。
