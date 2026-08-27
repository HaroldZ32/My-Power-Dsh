# mpd-hashline-plugin

Plan C / C3 — hash-anchored edit discipline on the DeepSeek Harness tool seam.

Vendored core: the upstream project `packages/hashline-core` (base commit
8c57e46, SUL-1.0 fork terms). Adaptation: `src/vendor/diff-utils.ts` bundles a
minimal unified-diff generator instead of the npm `diff` dependency.

## Tools

| Tool | Purpose |
|---|---|
| `mpd_hashline_read` | Show a file as `LINE#HASH|content` view; anchors for edits. |
| `mpd_hashline_edit` | Apply anchored replace/append/prepend edits (validated against current hashes), write back plain content, return a unified diff; remaps on drift. |
| `mpd_hashline_format` | Register a file for the discipline (idempotent; no disk change). |
| `mpd_hashline_restore` | Unregister the discipline. |

## Guard

`config.guardEditTools` (default true) warns through `tools/post-execute` when a
plain edit/str_replace_editor/write touches a discipline-registered file, so the
model re-reads anchors or switches to `mpd_hashline_edit`.

## Build / test

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test
```
