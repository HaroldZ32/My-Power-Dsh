# mpd-comment-checker-plugin

**中文** | [English](./README.md)

Plan C / C4 —— 在 DSH 工具接缝上的注释/docstring 检测（opt-in 二进制）。

Vendored 解析器：上游项目 `packages/comment-checker-core`（base 8c57e46；依 SUL-1.0
授权；`isRecord` 已内联）。检查二进制：`@code-yeongyu/comment-checker` 0.8.0
（MIT，github.com/code-yeongyu/go-claude-code-comment-checker）——原生 tree-sitter
二进制：按原样使用（UNMODIFIED）并声明为 `@mpd-dsh/mpd` bundle 的 optionalDependency
（策略：第三方包是依赖，绝不 vendored 复制）。解析顺序：依赖（通过 createRequire
按包相对定位）-> `MPD_DSH_COMMENT_CHECKER_BIN` -> 本地 checkout QA 的 dev-toolchain
回退。

## 工具 / 钩子

- `mpd_comment_check({files:[{path, content?}]})` —— 逐文件检测（退出码 2 = 发现注释；
  消息会写明需要执行的动作）。
- `config.autoCheck`（默认 **false**）：opt-in 的 `tools/post-execute` 钩子，在
  对已改动文件执行 edit/write 后追加检测结果。

## 安装

无需手动步骤：安装 bundle 会带入 `@code-yeongyu/comment-checker` 作为
optionalDependency（约 51MB）。在插件 config 中设置 `autoCheck: true` 以启用
post-edit 钩子（默认关闭）。

当该 optionalDependency 缺失（本地 checkout）时，可用 `node scripts/install-profile.mjs
--with-comment-checker`（或 `npm install --prefix .toolchain --no-save
@code-yeongyu/comment-checker@0.8.0`）把同一个 pinned 二进制装进仓库本地 toolchain；
插件随后会回退到
`.toolchain/node_modules/@code-yeongyu/comment-checker/vendor/<platform>/comment-checker`。
将 `MPD_DSH_COMMENT_CHECKER_BIN` 设为绝对路径可覆盖解析顺序。

## 构建 / 测试

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test     # skipped automatically when the binary is absent
```
