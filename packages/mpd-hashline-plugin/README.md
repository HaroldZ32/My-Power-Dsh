# mpd-hashline-plugin
**English** | [中文](./README.zh-CN.md)

Plan C / C3 — hash-anchored edit discipline on the DeepSeek Harness tool seam.

This tree is our own TypeScript, ported **BY DESIGN** from the `crates/pi-edit` crate of
`can1357/oh-my-pi` @ `602b6c812fa9ef774f359f1e399a09d30ee2eaca` (MIT). No SUL-1.0 source is
inherited any more, and the port is a DELIBERATE REDUCTION: the replaced core's fuzzy
"autocorrect" heuristics are not reproduced. The port carries the MIT obligation that crate's
design comes under — the upstream MIT permission text and copyright lines are reproduced
verbatim at the top of EVERY file under `src/vendor/**`, and `LICENSE-NOTICES.md` records the
provenance. The eight files and the responsibility each carries:

- `src/vendor/index.ts` — the public surface the `mpd-hashline` row imports.
- `src/vendor/constants.ts` — the fixed `LINE#HASH|content` vocabulary: alphabet, digest width and the format patterns.
- `src/vendor/hash.ts` — the per-line digest: xxHash32 folded to the short alphabet-encoded anchor.
- `src/vendor/text.ts` — the BOM and line-ending envelope (`canonicalizeFileText` / `restoreFileText`).
- `src/vendor/types.ts` — the edit vocabulary the tool surface accepts.
- `src/vendor/anchors.ts` — parsing and validating a caller's `LINE#HASH` anchor, plus the stale-anchor report.
- `src/vendor/edits.ts` — normalizing and applying an anchored edit batch.
- `src/vendor/diff.ts` — the read-side anchor view and the unified diff an edit reports: our own generator, so no npm `diff` dependency.

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
