# t12 — repoint the cross-references the `architecture.md` → `design.md` rename orphaned

Task: **t12** (work), attempt 4, attempt_id `a0ac2891-326b-48db-b86b-33229230f4e3`, contract revision 3.
Member: Junior Engineer. Executed 2026-09-19 (UTC window below). Scope: exactly four paths.

## The four edits (before → after)

### 1. `docs/index.md` line 20
```diff
-| [`architecture.md`](architecture.md) | engineers, curious users | How the bundle is assembled and mounts: patch layers, boot chain, plugin inventory, interaction flows, state layout, web-client wiring, TUI edition wiring. |
+| [`design.md`](design.md) | engineers, curious users | How the bundle is assembled and mounts: patch layers, boot chain, plugin inventory, interaction flows, state layout, web-client wiring, TUI edition wiring. |
```

### 2. `docs/index.zh-CN.md` line 19
```diff
-| [`architecture.zh-CN.md`](architecture.zh-CN.md) | 工程师、好奇的使用者 | bundle 如何组装与挂载：补丁层、启动链、插件清单、交互流程、状态布局、web 客户端接线、TUI 版本接线。 |
+| [`design.zh-CN.md`](design.zh-CN.md) | 工程师、好奇的使用者 | bundle 如何组装与挂载：补丁层、启动链、插件清单、交互流程、状态布局、web 客户端接线、TUI 版本接线。 |
```

### 3. `AGENTS.md` line 209 — docs-list filename ONLY, inside the repository-layout tree comment
```diff
-├── docs/                         # human-facing docs (BILINGUAL EN + zh-CN): index.md (hub) / user-guide.md / architecture.md / development.md; historical plan records (plan-*.md, decisions.md) and internal QA/golden reference docs are process records exempt from bilingual
+├── docs/                         # human-facing docs (BILINGUAL EN + zh-CN): index.md (hub) / user-guide.md / design.md / development.md; historical plan records (plan-*.md, decisions.md) and internal QA/golden reference docs are process records exempt from bilingual
```
`git diff -U0 -- AGENTS.md` prints exactly one hunk, `@@ -209 +209 @@`, one line removed and one added —
no other AGENTS.md content moved.

### 4. `packages/mpd-bundle/cordis.patch.yml` line 255 — a COMMENT, nothing else
```diff
-    # dependency mechanism here (docs/architecture.md: a sibling-provided service is read
+    # dependency mechanism here (docs/design.md: a sibling-provided service is read
```
`git diff -U0 -- packages/mpd-bundle/cordis.patch.yml` prints exactly one hunk, `@@ -255 +255 @@`, and the changed
line is a `#` comment: **no row id, name or config value is touched** (confirmed also by gate 2 below).

Diff scope of the whole change: `4 files changed, 4 insertions(+), 4 deletions(-)` — one line per file.

## The two raw greps (criterion 2 — both pasted, so a skipped zh edit cannot hide)

### GREP A — the literal single-pattern form
```
$ git grep -n "architecture\.md" -- '*.md' '*.mjs' '*.ts' '*.yml' '*.json' ':!evidence/**' ':!skills/**'
docs/user-guide.md:547:  to be `architecture.md`, and `docs/design.zh-CN.md` is the Chinese twin of the current name), so an
docs/user-guide.zh-CN.md:493:- **升级后某个文档链接 404** → 本次发布**重命名**了设计文档（它原名 `architecture.md`，
exit=0
```

### GREP B — the two-pattern judging form (`-E "architecture(\.zh-CN)?\.md"`)
```
$ git grep -nE "architecture(\.zh-CN)?\.md" -- '*.md' '*.mjs' '*.ts' '*.yml' '*.json' ':!evidence/**' ':!skills/**'
docs/user-guide.md:547:  to be `architecture.md`, and `docs/design.zh-CN.md` is the Chinese twin of the current name), so an
docs/user-guide.zh-CN.md:493:- **升级后某个文档链接 404** → 本次发布**重命名**了设计文档（它原名 `architecture.md`，
exit=0
```

**Zero hits inside t12's four paths under BOTH patterns.** Grep B is the arm that matters: the zh-CN filename
`architecture.zh-CN.md` does not contain the substring `architecture.md`, so GREP A alone would have passed even if
edit 2 had been skipped (that gap was reported as a finding before this attempt and is now closed in the acceptance).

## Gates (criterion 4 and 6)

### Gate 1 — `bun run verify:docs` → exit 0
```
$ bun run verify:docs
... (38 pairs checked; the index pair line is `ok   docs/index.md`) ...
[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS
exit=0
```
The gate asserts the pair, the language switch link, the heading tree and real CJK content for this pair, so a valid
bilingual index pair after the edit is exactly what exit 0 means.

### Gate 2 — `node scripts/verify-rows-parity.mjs` → exit 0
```
$ node scripts/verify-rows-parity.mjs
[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (agent-teams, mcp-astgrep, mcp-codegraph,
mcp-context7, mcp-gitbash, mcp-grepapp, mcp-lsp, mpd-bootstrap, mpd-boulder, mpd-codegraph, mpd-comment-checker,
mpd-config, mpd-dsh-adapter, mpd-ext, mpd-hashline, mpd-memory, mpd-modelchain, mpd-roles, mpd-team-compact,
mpd-team-watchdog, mpd-tools, mpd-tui, mpd-ulw, mpd-web-compat, mpd-workmate)
exit=0
```

## Index pair integrity after the edit

- Switch links intact: `docs/index.md` line 3 `**English** | [中文](index.zh-CN.md)`; `docs/index.zh-CN.md` line 3 `[English](index.md) | **中文**`.
- Heading trees: 6 headings each (`#`, and `##` × 5 in both), unchanged by this edit.
- Row targets: EN row now links `design.md`, ZH row now links `design.zh-CN.md` (criterion 4).
- Every relative link in both index files resolves on the filesystem — EN 20/20, ZH 17/17, including `design.md`
  and `design.zh-CN.md`.

## Attributed observations (NOT failures of t12 — owning lane named, not fixed here)

1. `docs/user-guide.md:547` and `docs/user-guide.zh-CN.md:493` still contain the string `architecture.md`
   (owning lane: **t5 / Lead**). Both are **prose inside an upgrade-troubleshooting note** that deliberately tells a
   reader the design document *used to be* named `architecture.md`; neither is a markdown link. Verified:
   `grep -nE "\]\(architecture(\.zh-CN)?\.md\)" docs/user-guide.md docs/user-guide.zh-CN.md README.md README.zh-CN.md`
   → no match, so no live file link to a removed name remains in any of those four files. Nothing to repair here
   unless the captain wants the prose reworded (it is arguably correct as written).
2. The README pair (`README.md`, `README.zh-CN.md`, owning lane t4/Deep Worker) is clean under both patterns — 0 hits.
3. Historical records under `docs/` (`plan-*.md`, `decisions.md`, prior-phase reports) keep the historical filename on
   purpose and were not touched (`:!evidence/**` plus the pathspec set also excludes them from live-source concern).

## Post-edit hashes of the four paths

| Path | sha256 (after) |
|---|---|
| `docs/index.md` | `9a824fe66982a3554906bc6085a68ca1cbebd060a61881b995ebb3ca7bf22089` |
| `docs/index.zh-CN.md` | `b256e8bdf8fd3692eaf503f876b97d93d7c30fdf54b8e42f85390893d170d3fc` |
| `AGENTS.md` | `6518ab4a28f86b985636f43659ad57c6760f1f21b79104832bc38ae1d865b5a7` |
| `packages/mpd-bundle/cordis.patch.yml` | `d141f70771c18cc06dd2492aae0cab92423929ab554a3c1031e2bbb9d3c1c23a` |

Note on git: teammates do not run git write commands in this shared checkout (AGENTS.md §5); all commands above are
read-only (`git grep`, `git diff`, `sha256sum`, gates). The captain commits.
