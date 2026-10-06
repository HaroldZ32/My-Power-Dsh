# mpd-hashline-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C3 — hash-anchored edit discipline on the DeepSeek Harness tool seam.

Vendored core: the upstream project `packages/hashline-core` (base commit
8c57e46; SUL-1.0, inherited from upstream). Adaptation: `src/vendor/diff-utils.ts` bundles a
minimal unified-diff generator instead of the npm `diff` dependency.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_hashline_read` | Show a file as `LINE#HASH|content` view; anchors for edits. |
| `mpd_hashline_edit` | Apply anchored replace/append/prepend edits (validated against current hashes), write back plain content, return a unified diff; remaps on drift. |
| `mpd_hashline_format` | Register a file for the discipline (idempotent; no disk change). |
| `mpd_hashline_restore` | Unregister the discipline. |

## Line count, diff header and file envelope

`lines` is ONE source-line count shared by read/format/edit: a final newline TERMINATES the last
line, so a 2-line file reports 2 (not 3). A unified-diff hunk header names the hunk's own first
line, including a hunk that starts at line 1. `mpd_hashline_edit` reads and writes through the
vendored canonicalization (`canonicalizeFileText` / `restoreFileText`), so an anchored edit
preserves a CRLF- or BOM-carrying file's envelope while the anchors stay CR-insensitive.

## Guard

`config.guardEditTools` (default true) warns through `tools/post-execute` when a
plain edit/str_replace_editor/write touches a discipline-registered file, so the
model re-reads anchors or switches to `mpd_hashline_edit`.

## Build / test

```sh
bun build packages/mpd-hashline-plugin/src/index.ts --target node --format esm --outfile packages/mpd-hashline-plugin/dist/index.js
bun test
```
