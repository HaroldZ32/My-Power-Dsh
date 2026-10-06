# mpd-hashline-plugin
**中文** | [English](./README.md)

Plan C / C3 — 在 DeepSeek Harness tool seam 上的 hash-anchored（哈希锚定）编辑纪律。

Vendored core：上游项目 `packages/hashline-core`（base commit 8c57e46；依 SUL-1.0 授权）。改编：`src/vendor/diff-utils.ts` 打包了一个极简 unified-diff 生成器，替代 npm `diff` 依赖。

## 工具

| Tool | Purpose |
|---|---|
| `mpd_hashline_read` | Show a file as `LINE#HASH|content` view; anchors for edits. |
| `mpd_hashline_edit` | Apply anchored replace/append/prepend edits (validated against current hashes), write back plain content, return a unified diff; remaps on drift. |
| `mpd_hashline_format` | Register a file for the discipline (idempotent; no disk change). |
| `mpd_hashline_restore` | Unregister the discipline. |

## 行数、diff 头与文件封装

`lines` 是 read/format/edit 共用的**唯一**源码行数：末尾换行是最后一行的**终止符**，所以 2 行文件报 2（而不是 3）。unified-diff 的 hunk 头命名该 hunk 自己的首行，包括从第 1 行开始的 hunk。`mpd_hashline_edit` 通过 vendored 的规范化函数（`canonicalizeFileText` / `restoreFileText`）读写文件，因此锚定编辑会保留 CRLF 或带 BOM 文件的封装，而 anchors 依旧对 CR 不敏感。

## Guard

`config.guardEditTools`（默认 true）在普通 edit/str_replace_editor/write 触及已注册纪律的文件时，通过 `tools/post-execute` 发出警告，以便模型重读 anchors 或改用 `mpd_hashline_edit`。

## 构建 / 测试

```sh
bun build packages/mpd-hashline-plugin/src/index.ts --target node --format esm --outfile packages/mpd-hashline-plugin/dist/index.js
bun test
```
