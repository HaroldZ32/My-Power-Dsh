# mpd-comment-checker-plugin

**English** | [中文](./README.zh-CN.md)

Plan C / C4 — comment/docstring detection on the DSH tool seam (opt-in binary).

No vendored parser: this plugin VENDORS NOTHING and carries no SUL-1.0 source — detection
runs in the on-demand npm binary `@code-yeongyu/comment-checker` 0.8.0 (MIT,
github.com/code-yeongyu/go-claude-code-comment-checker), which the plugin resolves and spawns
per check. Native tree-sitter
binary: used UNMODIFIED and declared as an optionalDependency of the `@mpd-dsh/mpd`
bundle (policy: third-party packages are dependencies, never vendored copies).
Resolution order (`resolveBinary`): an explicit `config.binary` (the `commentChecker.bin` leaf) ->
`MPD_DSH_COMMENT_CHECKER_BIN` -> the installed optional dependency (package-relative
`createRequire`, then its `vendor/<platform>/comment-checker`) -> the repo-local `.toolchain`
copies for checkout QA. Every candidate must exist on disk; with none the tool call errors and
the post-edit hook leaves the decision untouched.

## Tools / hooks

- `mpd_comment_check({files:[{path, content?}]})` — per-file detection (exit 2 =
  comments found; the message spells the required action).
- `config.autoCheck` (default **false**): opt-in `tools/post-execute` hook that
  appends detection results after edit/write on a changed file.

## Install

No manual step: installing the bundle brings `@code-yeongyu/comment-checker` as an
optionalDependency (~51MB). Set `autoCheck: true` in the plugin config to enable the
post-edit hook (off by default).

When that optional dependency is absent (a local checkout), provision the same pinned
binary into the repo-local toolchain with `node scripts/install-profile.ts
--with-comment-checker` (or `npm install --prefix .toolchain --no-save
@code-yeongyu/comment-checker@0.8.0`); the plugin then falls back to
`.toolchain/node_modules/@code-yeongyu/comment-checker/vendor/<platform>/comment-checker`.
Set `commentChecker.bin` in the plugin config (or `MPD_DSH_COMMENT_CHECKER_BIN` in the
environment) to an absolute path to override the sources above.

## Build / test

```sh
bun build packages/mpd-comment-checker-plugin/src/index.ts --target node --format esm --outfile packages/mpd-comment-checker-plugin/dist/index.js
bun test     # skipped automatically when the binary is absent
```
