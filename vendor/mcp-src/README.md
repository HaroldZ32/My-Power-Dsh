# `vendor/mcp-src` — the in-repo source snapshot of the three MCP servers

[中文](./README.zh-CN.md)

This directory is the BUILD INPUT for `scripts/build-mcp.ts`. It exists so the three MCP servers this
bundle ships can be rebuilt from THIS repository alone, with no external checkout, no network and no
`MPD_UPSTREAM_ROOT`. Before this snapshot the build read those sources out of a pinned
`oh-my-openagent` checkout, so a machine without that checkout could not rebuild anything — and the
`vendor` gate refused to even start.

The snapshot is **vendored source, not our code**. It is deliberately NOT admitted by the `files`
allowlist in `package.json`, so it is never packed into the published `@mpd-dsh/mpd` artifact: a
packed install consumes the prebuilt `packages/mpd-mcp-*/dist/cli.js`, and only a checkout rebuilds.

## Origin (re-derivable)

| Fact | Value |
|---|---|
| Upstream repository | `code-yeongyu/oh-my-openagent` (`https://github.com/code-yeongyu/oh-my-openagent`) |
| Pinned commit | `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` (v5.0.0-beta.20) |
| Resolved commit after fetch | `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` — asserted equal to the pin by `git rev-parse HEAD` |
| Snapshot date (UTC) | 2026-10-07 |
| Source subtree | `packages/{ast-grep-mcp,git-bash-mcp,lsp-daemon,mcp-stdio-core,utils,omo-config-core,lsp-core}` |

The snapshot was produced by a ONE-TIME shallow sparse fetch of the pinned commit into a gitignored
scratch root, followed by a copy of the seven package directories:

```bash
git init upstream && cd upstream
git remote add origin https://github.com/code-yeongyu/oh-my-openagent
git config core.sparseCheckout true
git sparse-checkout init --cone
git sparse-checkout set packages/ast-grep-mcp packages/git-bash-mcp packages/lsp-daemon \
  packages/mcp-stdio-core packages/utils packages/omo-config-core packages/lsp-core
git fetch --depth 1 origin 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
git checkout FETCH_HEAD
git rev-parse HEAD   # 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29
```

**Run time needs none of this.** The fetch was build-time only, and the scratch root was deleted; the
`vendor` gate is green on a machine with no checkout and no network.

## Contents

| Package | npm name | Files | Why it is here |
|---|---|---|---|
| `ast-grep-mcp` | `@oh-my-opencode/ast-grep-mcp` | 23 | the `mpd-mcp-astgrep` server source |
| `git-bash-mcp` | `@oh-my-opencode/git-bash-mcp` | 14 | the `mpd-mcp-gitbash` server source |
| `lsp-daemon` | `@code-yeongyu/lsp-daemon` | 54 | the `mpd-mcp-lsp` server source |
| `lsp-core` | `@oh-my-opencode/lsp-core` | 93 | shared LSP implementation the daemon imports |
| `mcp-stdio-core` | `@oh-my-opencode/mcp-stdio-core` | 10 | shared MCP stdio transport |
| `omo-config-core` | `@oh-my-opencode/omo-config-core` | 79 | shared config loading |
| `utils` | `@oh-my-opencode/utils` | 184 | shared helpers |
| | **total** | **457** | |

The seven directories are copied byte-for-byte, with ONE declared omission.

### Declared omission: the upstream `AGENTS.md` instruction files

Eight files in the fetched subtree are named `AGENTS.md`. They are upstream's OWN operating
instructions for upstream's own repository, they are not a build input, and this repository's
project-instruction convention auto-reads `AGENTS.md` from the project root down to the working
directory — so placing a foreign instruction file inside our tree would make a session that descends
into the snapshot read instructions written for a different project. They are therefore omitted, and
recorded here so the omission is auditable and reversible. Each hash is the sha256 of the file as it
exists at the pinned commit (`sha256sum`):

| Omitted path (relative to the fetched `packages/`) | sha256 |
|---|---|
| `AGENTS.md` | `1aa1f5157b0721eab05266bde4c5f434e43fa2b3b94b96d1dc35e0492e55a727` |
| `ast-grep-mcp/AGENTS.md` | `64585b7b84f765f48f67398ad3d37859db8e9d4b4c21011f4365c6647d7eeae5` |
| `git-bash-mcp/AGENTS.md` | `8d6e35a209e65102ad22edb421058eceb7fa86de279013d2146c5d3f3d9987ee` |
| `lsp-core/AGENTS.md` | `f068017014fc734f31b2378df088cff1aa2794b75d41f708bdeb71a1440b2df7` |
| `lsp-daemon/AGENTS.md` | `e2627e9b8794219228764209ecc279a6d85cfd3a42b51da8ce0861a6c450f192` |
| `mcp-stdio-core/AGENTS.md` | `52c6dc98d180009b13db0fc5589ff4b5fe33c2e82325f3b087624a2f71b373de` |
| `omo-config-core/AGENTS.md` | `a74a1a899df11607dd5e77f01eaf3cb9214726a61bd2e16ce7487aba301a9df5` |
| `utils/AGENTS.md` | `e88392304ae33b35a691a25ebb8755ebbd9f3b28343f40be4a05322fccd34cc1` |

No other file was dropped, renamed or edited.

## License and attribution — measured, never assumed

The upstream repository's own `LICENSE.md` (at the pinned commit) licenses its content under the
**Sustainable Use License 1.0 (SUL-1.0)**, and states that "All third party components incorporated
into the oh-my-opencode Software are licensed under the original license provided by the owner of the
applicable component". That is the same SUL-1.0 this repository inherits (see `LICENSE.md` and
`LICENSE-NOTICES.md`).

Per-package declaration, read from each snapshot's own `package.json`:

| Package | `license` field |
|---|---|
| `lsp-daemon` (`@code-yeongyu/lsp-daemon`) | `MIT` — self-declared by the package |
| the other six (`@oh-my-opencode/*`) | absent — they fall under the repository's SUL-1.0 |

**A correction, stated rather than silently resolved:** the wave plan's clause A3 asks this snapshot to
carry "its provenance + MIT notice". Measured against the pinned sources, that wording is wrong for
this snapshot — the MCP sources are SUL-1.0 (with `lsp-daemon` self-declaring MIT), and labelling them
MIT would be a false provenance claim. The MIT acknowledgement the plan refers to belongs to the
`dsh-agent-teams` body, which is a DIFFERENT upstream relocated by a different lane. This file records
the measured licence instead. Attribution for both upstreams survives in `LICENSE-NOTICES.md` and in
the bilingual `README.md` pair, as clause A5 requires.
