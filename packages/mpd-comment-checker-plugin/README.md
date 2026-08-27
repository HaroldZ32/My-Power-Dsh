# mpd-comment-checker-plugin

Plan C / C4 — comment/docstring detection on the DSH tool seam (opt-in binary).

Vendored parser: upstream oh-my-openagent `packages/comment-checker-core` (base
8c57e46, SUL-1.0 fork terms; `isRecord` inlined). Check binary:
`@code-yeongyu/comment-checker` 0.8.0 (MIT,
github.com/code-yeongyu/go-claude-code-comment-checker) — native tree-sitter
binary: used UNMODIFIED and declared as an optionalDependency of the `@mpd-dsh/mpd`
bundle (policy: third-party packages are dependencies, never vendored copies).
Resolution order: dependency (package-relative via createRequire) ->
`MPD_DSH_COMMENT_CHECKER_BIN` -> dev-toolchain fallback for local checkout QA.

## Tools / hooks

- `mpd_comment_check({files:[{path, content?}]})` — per-file detection (exit 2 =
  comments found; the message spells the required action).
- `config.autoCheck` (default **false**): opt-in `tools/post-execute` hook that
  appends detection results after edit/write on a changed file.

## Install

No manual step: installing the bundle brings `@code-yeongyu/comment-checker` as an
optionalDependency (~51MB). Set `autoCheck: true` in the plugin config to enable the
post-edit hook (off by default).

## Build / test

```sh
bun build src/index.ts --outdir dist --target node --format esm
bun test     # skipped automatically when the binary is absent
```
