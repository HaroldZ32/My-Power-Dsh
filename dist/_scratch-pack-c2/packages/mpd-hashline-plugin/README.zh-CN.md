# mpd-hashline-plugin
**中文** | [English](./README.md)

Plan C / C3 — 在 DeepSeek Harness tool seam 上的 hash-anchored（哈希锚定）编辑纪律。

这棵树是我们自己的 TypeScript，**按设计**移植自 `can1357/oh-my-pi` 的 `crates/pi-edit` crate @ `602b6c812fa9ef774f359f1e399a09d30ee2eaca`（MIT）。此处不再继承任何 SUL-1.0 源码，且该移植是一次**有意的削减**：被替换的核心中模糊的「autocorrect」启发式规则没有被复现。该移植承担了那个 crate 的设计所附带的 MIT 义务——上游 MIT 许可全文与版权行逐字复制在每个 `src/vendor/**` 文件的顶部，来源记录在 `LICENSE-NOTICES.md`。八个文件及其各自承担的责任：

- `src/vendor/index.ts` —— `mpd-hashline` row 导入的公开接口面。
- `src/vendor/constants.ts` —— 固定的 `LINE#HASH|content` 词汇表：字母表、摘要宽度与格式模式。
- `src/vendor/hash.ts` —— 逐行摘要：xxHash32 折叠为短的字母表编码锚点。
- `src/vendor/text.ts` —— BOM 与行尾封装（`canonicalizeFileText` / `restoreFileText`）。
- `src/vendor/types.ts` —— 工具接口面接受的编辑词汇表。
- `src/vendor/anchors.ts` —— 解析并校验调用方给出的 `LINE#HASH` 锚点，以及 stale-anchor 报告。
- `src/vendor/edits.ts` —— 规范化并应用一批锚定编辑。
- `src/vendor/diff.ts` —— 读取侧的锚点视图与编辑返回的 unified diff：我们自己的生成器，因此不依赖 npm `diff`。

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
