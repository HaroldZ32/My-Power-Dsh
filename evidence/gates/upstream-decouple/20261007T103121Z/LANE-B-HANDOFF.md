# LANE A → LANE B HANDOFF (verbatim text to place)

From: Lane A (Senior Engineer), task T4.
To: Lane B (Deep Worker) — **relay requested from the captain**: the official team mailbox in this
composition holds a PREVIOUS wave's members (`ToolDefects Engineer`, `Independence Engineer`,
`TuiAdapter Engineer`, `doc-scribe`, `panel-surface`, `tui-visuals`, `Lead`) and `agent_teams_plan
status` reports `members 0`, so Lane A cannot address "Deep Worker" by name. The captain owns the
relay.

Per the captain's write-scope correction, `README.md` / `README.zh-CN.md` / `LICENSE-NOTICES.md` /
`docs/**` belong to Lane B this wave. **Lane A edited none of them** — verified with
`git status --porcelain README.md README.zh-CN.md LICENSE-NOTICES.md docs/` (no Lane A modification).

---

## 1. A NOW-FALSE CLAIM — fix required

`docs/development.md` (Gates table) and `docs/development.zh-CN.md` (same row) still say the vendor
gate needs `MPD_UPSTREAM_ROOT`. It no longer does: the rewritten `scripts/verify-vendor.ts` reads **no
environment variable at all**.

English — replace the Vendor row:

```
| Vendor | `node scripts/verify-vendor.ts` (fingerprints the assets this repo ships; resolves NO upstream checkout) |
```

简体中文 — same row:

```
| Vendor（供应商/资产指纹） | `node scripts/verify-vendor.ts`（对本仓库发布的资产做指纹校验；不再解析任何上游 checkout） |
```

**Do NOT touch** `docs/plan-f.md`, `docs/plan-0.1.7-adaptation.md` or `docs/plan-team-plane-split.md`.
Their `MPD_UPSTREAM_ROOT` mentions are PLAN PROCESS RECORDS of past waves describing the state THEN.
Rewriting them would falsify the record.

---

## 2. `LICENSE-NOTICES.md` — add this block

The existing `oh-my-openagent` entry at the top of that file STAYS. Add, beside it:

```markdown
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
```

简体中文（同一段的对译，随英文一起移动）:

```markdown
## oh-my-openagent MCP 服务器（SUL-1.0，含一个 MIT 组件）—— 源码以快照形式收入本仓库

本 bundle 发布的三个 MCP 服务器（`mpd-mcp-astgrep`、`mpd-mcp-gitbash`、`mpd-mcp-lsp`）及其四个
共享包（`mcp-stdio-core`、`utils`、`omo-config-core`、`lsp-core`）的源码，以**逐字节快照**形式存于
`vendor/mcp-src/`，取自 oh-my-openagent 仓库（https://github.com/code-yeongyu/oh-my-openagent）
的提交 `8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`（v5.0.0-beta.20）。`scripts/build-mcp.ts`
的构建输入是这个快照，而不是任何外部 checkout。

许可为**实测**结论，而非假定：oh-my-openagent 自己的 `LICENSE.md` 将其内容置于 Sustainable Use
License 1.0 之下 —— 即本仓库继承的同一份许可；七个快照包中有六个**未声明** `license` 字段，只有
`lsp-daemon`（`@code-yeongyu/lsp-daemon`）自我声明 MIT。因此该快照是 **SUL-1.0 外加那一个 MIT
组件 —— 它不是 MIT**。来源、产生快照的一次性取回、对上游 `AGENTS.md` 指令文件的已声明省略（含每个
被省略文件的 sha256）以及完整许可表，均记录在 `vendor/mcp-src/README.md`。
```

---

## 3. `README.md` / `README.zh-CN.md` — two deltas

**(a)** The *Acknowledgements* entry for oh-my-openagent credits the roster, the model-chain
vocabulary and the capability baseline. ADD the MCP sources to that credit.

English:

```markdown
Its MCP server sources are also snapshotted into this repository at
[`vendor/mcp-src/`](./vendor/mcp-src/README.md), which is what `scripts/build-mcp.ts` builds the
shipped servers from; the snapshot and no external checkout is the build input.
```

简体中文：

```markdown
其 MCP 服务器源码同样以快照形式收入本仓库，位于
[`vendor/mcp-src/`](./vendor/mcp-src/README.md)，`scripts/build-mcp.ts` 即以它为构建输入生成随包
发布的服务器；构建输入是该快照，不再需要任何外部 checkout。
```

**(b)** `README.md` (Acknowledgements, ~line 284) says
"(*Acknowledgements* records why the retired vendored copy is still on disk)". Once Lane B's deletion
lands, that parenthetical is FALSE — the copy is no longer on disk. Replacement wording is Lane B's
call; the "still on disk" clause must not stand.

---

## 4. Bound Lane B should know

`vendor/**` is deliberately **NOT** in `package.json`'s `files` allowlist, so the snapshot never
ships: a packed install consumes the prebuilt `packages/mpd-mcp-*/dist/cli.js`. Lane A did not change
`files` (outside its granted scope). Packing the snapshot is a separate decision for the captain.
