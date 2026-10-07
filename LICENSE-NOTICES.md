# License Notices

- This repository is derived from the upstream project oh-my-openagent
  (https://github.com/code-yeongyu/oh-my-openagent; upstream commit 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29, v5.0.0-beta.20).
- License: Sustainable Use License 1.0 (SUL-1.0). See LICENSE.md for the full text.
- Third-party components keep their original licenses/notices in their source trees.
- DSH packages (@deepseek-ai/*) are MIT licensed and referenced as dependencies only.

## oh-my-openagent MCP servers (SUL-1.0, with one MIT component) — sources snapshotted in-repo

The sources of the three MCP servers this bundle ships (`mpd-mcp-astgrep`, `mpd-mcp-gitbash`,
`mpd-mcp-lsp`) and their four shared packages (`mcp-stdio-core`, `utils`, `omo-config-core`,
`lsp-core`) are snapshotted VERBATIM at `vendor/mcp-src/`, copied from the oh-my-openagent
repository (https://github.com/code-yeongyu/oh-my-openagent) at commit
`8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29` (v5.0.0-beta.20). That snapshot — not an external
checkout — is the build input for `scripts/build-mcp.ts`.

Licensing is MEASURED, never assumed: oh-my-openagent's own `LICENSE.md` places its content under
the Sustainable Use License 1.0, the same licence this repository inherits, and six of the seven
snapshotted packages declare no `license` field at all; only `lsp-daemon`
(`@code-yeongyu/lsp-daemon`) self-declares MIT. The snapshot is therefore **SUL-1.0 with that one
MIT component — it is not MIT.** `vendor/mcp-src/README.md` records the origin, the one-time fetch
that produced the snapshot, the declared omission of the upstream `AGENTS.md` instruction files
(with each omitted file's sha256) and the full licence table.

**Declared bound:** `vendor/mcp-src/**` is deliberately NOT in `package.json`'s `files` allowlist.
It is a BUILD-TIME input for a checkout; the published package ships the built `packages/mpd-mcp-*/dist/`
servers instead, so a packed install never needs — and never receives — the snapshot.

## Agent Teams (MIT) — official plugin set, mounted by this bundle

From 2026-09-27 the bundle's team capability is the DeepSeek Harness OFFICIAL plugin set, mounted by
this bundle's own rows (`mpd-agent-team`, `mpd-tool-agent-team`, `mpd-ui-agent-team`) and reached only
through `mpd-dsh-adapter`:

- `@deepseek-ai/dsh-experimental-agent-team` (MIT) — the `ctx.agentTeams` `TeamService`: implicit-root
  roster, durable peer mailbox, shared task DAG.
- `@deepseek-ai/dsh-experimental-tool-agent-team` (MIT) — the scoped model-facing tools
  `spawn_teammate`, `send_message`, `list_agents`, `wait_agent`, `interrupt_agent`,
  `team_task_create` / `team_task_list` / `team_task_get` / `team_task_update`.
- `@deepseek-ai/dsh-experimental-client-ui-agent-team` (MIT) — the Web roster, shared task board and
  teammate navigation client.

All three are declared in this package's `dependencies` at the harness version they were validated
against and are distributed under the MIT License; none of their source is vendored into this
repository. See `docs/plan-0.1.7-adaptation.md` for the adoption record.

## dsh-agent-teams (MIT) — adopted plugin, DELETED; two relocated pieces remain

The `agent-teams` plugin was adopted from the dsh-agent-teams project (0.1.14 body, with the audited
upstream 0.1.16-rc.3 deltas backported — Harness subagent boundary, agent-scoped capabilities, tool
names, authenticated web routes, member turn-failure handling and the durability fixes;
https://github.com/NanmiCoder/dsh-agent-teams), distributed under the MIT License, adopted package
version `0.1.16-rc.3-mpd`.

**Its source is no longer in this repository.** The plugin was RETIRED from the composition on
2026-09-27 (no loader row mounted it; the harness shipped its own official Agent Teams plugin, see
the section above), and the `de-vendor-and-verify-law` wave then DELETED the whole body —
`packages/mpd-agent-teams-plugin/**`, 768 files — together with the three scripts that vendored,
patched and reclaimed it and the delta registry it was documented by. Nothing in this repository
reads, patches, fingerprints or copies it any more.

Two pieces of that work DO still ship, relocated into mpd-owned homes in the same commit as the
deletion, and both keep the MIT acknowledgement above:

- **The adopted browser client bundle** — `packages/mpd-bundle-plugin/adopted/agent-teams-client.js`
  (the 0.1.14 build) and its source map. It is embedded verbatim by
  `scripts/build-mpd-client.ts` into the shipped `packages/mpd-bundle-plugin/client.js`, which is
  what backs the AgentTeams sidebar tab. `packages/mpd-bundle-plugin/adopted/` is the source half of
  that artifact.
- **The DSH runtime modules this repository owns as its own code** —
  `packages/mpd-schemastery/`, the schemastery validator plus `cosmokit` used by four SHIPPED
  plugins, and the DSH framework modules (`cordis`, `dsh-tools`, `dsh-llm`, `dsh-session`,
  `dsh-scope`, `dsh-timeout`) that this repository's test suite drives directly. Both upstream
  notices are reproduced in full in `packages/mpd-schemastery/LICENSE`: Shigma
  (Copyright (c) 2021-present) for schemastery/cosmokit/cordis, DeepSeek (Copyright (c) 2026) for
  the `@deepseek-ai/dsh-*` modules.


## @code-yeongyu/comment-checker (MIT) — opt-in check binary

The optional comment/docstring detection binary used by mpd-comment-checker-plugin
is the npm package `@code-yeongyu/comment-checker` 0.8.0
(https://github.com/code-yeongyu/go-claude-code-comment-checker), distributed under
the MIT License. It is not redistributed in this repository; it is installed on
demand into `.toolchain` (installer flag `--with-comment-checker`).

## DeepSeek Harness 创造模式 skills (MIT) — adapted into `skills/cordis-dev`

The `cordis-dev` skill shipped in this repository's served skill corpus is an
adaptation, written for this bundle, of the four skills the DeepSeek Harness
ships with its `cordis` agent preset (创造模式 / creation mode):
`cordis-plugin-development` (+ its `references/` and `templates/`),
`editing-cordis-compositions`, `cordis-composition-reference` (+ its generated
`references/packages.md`) and `agent-experience`. Those files ship inside the
npm package `@deepseek-ai/dsh-agent-preset`
(https://github.com/deepseek-ai/deepseek-harness), distributed under the MIT
License, Copyright (c) 2026 DeepSeek — the same licence as the rest of the
`@deepseek-ai/*` harness packages this bundle already references.

What that means concretely: the knowledge transferred is the Loader patch
dialect, the plugin forms (Host / Web UI client / configuration-only MCP
bundle), the practices and the verification discipline; the wording here is this
repository's, and every section that is specific to this bundle (the adapter
seam rule, the mounting contract, the gate table, the goal plane) is ours. The
upstream files are NOT redistributed: this bundle references the installed
harness packages instead, and a reader who wants the upstream text verbatim can
read it at
`<dsh>/node_modules/@deepseek-ai/dsh-agent-preset/skills/` (the path the
`cordis-dev` skill names for its templates).
