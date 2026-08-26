# mpd-comment-checker-plugin

Plan C / C4 — comment/docstring detection on the DSH tool seam (opt-in binary).

Vendored parser: upstream oh-my-openagent `packages/comment-checker-core` (base
8c57e46, SUL-1.0 fork terms; `isRecord` inlined). Check binary:
`@code-yeongyu/comment-checker` 0.8.0 (MIT,
github.com/code-yeongyu/go-claude-code-comment-checker) — native tree-sitter
binary, resolved via `MPD_DSH_COMMENT_CHECKER_BIN` or
`.toolchain/node_modules/@code-yeongyu/comment-checker/vendor/<platform>/comment-checker`.

## Tools / hooks

- `mpd_comment_check({files:[{path, content?}]})` — per-file detection (exit 2 =
  comments found; the message spells the required action).
- `config.autoCheck` (default **false**): opt-in `tools/post-execute` hook that
  appends detection results after edit/write on a changed file.

## Install

```sh
node scripts/install-profile.mjs --yes --with-comment-checker   # ~51MB binary into .toolchain
```

## Build / test

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test     # skipped automatically when the binary is absent
```
