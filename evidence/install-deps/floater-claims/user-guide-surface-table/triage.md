# t10 — the fourth stale floater claim: user-guide surface table (EN + zh-CN)

**Task:** t10, team `mpd-install-deps`, Senior Engineer, attempt 1 (`d53d2093-8c5b-4f60-9edf-c909d3ccbd67`).
**Kind:** implementation. **Evidence is author-run and therefore ADVISORY.**
**Moment of the sweep and the edit:** 2026-09-20T03:46–03:48Z (individual instants below).

## 1. The verdict is INHERITED from t8, not re-decided

`evidence/install-deps/floater-claims/verification.txt` (t8, measured 2026-09-20T03:42:09Z, BEFORE its
own edit) proves the bundle floater is GONE:

* `packages/mpd-bundle-plugin/src/**` registers **no** removed surface (no match for
  `agent-teams-activity`, `conversation.chat.node`, `shell.overlay`, `sidebar.footer.action`);
* `scripts/build-mpd-client.mjs#LEGACY_SURFACES` **fails the build** (`process.exit(1)`) when an mpd
  client source registers one of those four ids — the gate is REGISTRATION, not text;
* the adopted `lib/client.js` still CONTAINS the floater's strings but its `apply(ctx)` is only
  exported (`exports.apply = apply`), never called by the bundle patch (the `agent-teams` row names
  the server module, not the client id);
* the dsh-qa case `agent-teams-sidebar.mjs` asserts `sourcesRegisterNoRemovedSurface`,
  `adoptedNeverApplied`, `noLegacyRegistration`, `noFloaterDefined`, `buildGatePresent`.

Conclusion taken as given: **the floater does not ship**, so a document that presents it as a live
web surface is stale and is corrected here (t10's acceptance clause 1: "if t8 proved the floater is
gone, the rows are corrected").

## 2. The fix (minimal, bilingual, inScope only)

Two one-line deletions — the stale row and its zh-CN twin, nothing else:

| file | before | after |
|---|---|---|
| `docs/user-guide.md` §7.1 (was line 312) | deleted row `\| Bundle floater \| the \`tuiStatus\` line \|` | row removed |
| `docs/user-guide.zh-CN.md` §7.1 (was line 284) | deleted row `\| bundle 悬浮面板 \| \`tuiStatus\` 状态行 \|` | row removed |

Both tables keep their header, the four remaining rows, the `| — |` idiom row, the paragraph below
and the cross-link to `tui.md` / `tui.zh-CN.md`; the heading tree and the switch links are untouched
(proved by the docs gate below). The TUI-side fact the deleted row carried (`tuiStatus` is the keyed
status line) is NOT lost: the row above it already claims `tuiStatus` as the AgentTeams sidebar
tab's TUI equivalent, so keeping the stale row would have duplicated that claim while promising a
web surface that does not exist.

Traceability of the deleted claim (acceptance clause 4): the row asserted a **web-only bundle
floater**; `scripts/build-mpd-client.mjs#LEGACY_SURFACES` (`id: "agent-teams-activity"`) plus the
zero-match census over `packages/mpd-bundle-plugin/src/**` in t8's `verification.txt` are the symbols
that make the assertion false.

**Attribution note:** both files ALSO carry t4's uncommitted sidebar-dependency edits (task t4 of this
wave). This lane's contribution to those files is exactly the two deleted rows above; the file
hashes below cover the combined working-tree state, which is what the gate measured.

## 3. Every mention found — triaged by class (acceptance clause 3)

Sweep (repo-wide, `floater|悬浮|浮窗|浮层|浮动` over `docs/`, `AGENTS.md`, `README.md`,
`README.zh-CN.md`, `packages/*/README*.md`, `extensions/`, `templates/`), raw output in
`mentions-sweep.txt`. Two scope traps are worth naming: the bilingual glob is `README*.md` (a
`packages/*/README.md` glob silently MISSES every `*.zh-CN.md` twin), and the zh wording is
`浮层`/`悬浮窗` rather than one term — the first sweep saw no user-guide hits only after both were
corrected, which is the check that the fix landed.

| mention | quote (abridged) | class | action |
|---|---|---|---|
| `docs/user-guide.md:312` + `docs/user-guide.zh-CN.md:284` | "Bundle floater / bundle 悬浮面板" (live surface row) | **LIVE STALE — inScope** | **CORRECTED** (§2) |
| `docs/design.md:442,489` + `docs/design.zh-CN.md:375,415` | "renders the floater's own interior"; "the removed activity floater …" | LIVE — **already correct** | none (verified, not assumed) |
| `docs/feature-audit.md:16` + `docs/feature-audit.zh-CN.md:15` | "the overlay floater and the footer toggle were removed" | LIVE — already correct | none |
| `packages/mpd-bundle-plugin/README.md:19,25` | "registered the removed in-conversation team card and activity floater"; "the removed floater's own interior" | LIVE — already correct | none |
| `AGENTS.md:208` | "both GUI surfaces are sidebar-only, no floater fallback" | LIVE — corrected by t8 | none (t8's edit, in tree) |
| `README.zh-CN.md:527` | "只存在于侧边栏 —— 没有浮动面板兜底" | LIVE — already correct | none (t4's edit, in tree) |
| `docs/plan-tui-edition.md:289` | "the bundle floater (`dsh.client.platform = web`)" | **EXEMPT process record** (`docs/plan-*.md`, AGENTS.md §3) | untouched, named here |
| `docs/tui-edition-report.md:119` | "the bundle floater" (prior-phase report) | **EXEMPT process record** (AGENTS.md §3 named list) | untouched, named here |
| `docs/tui-parity.zh-CN.md:21,61,79` | "浮动几何 / 可拖拽的浮动窗口" | NOT the removed bundle floater (the adopted activity panel's window geometry) | none — different subject, claim still true |
| `packages/mpd-tui-plugin/README.md:62,185` + `README.zh-CN.md:54,158` | "the web-only surfaces (agent-teams sidebar, workmate tab, bundle floater)"; "The agent-teams sidebar, the workmate tab and the bundle floater … do not render in the TUI" | **LIVE STALE — OUT OF inScope** | **NOT edited — finding for a follow-up task** (§5) |

## 4. Gates (raw output in `gates.log`)

* `bun run verify:docs` → `exit=0`; `[verify-docs-parity] root=… pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` (heading trees, switch links and every relative target still resolve; 19 pre-existing exemptions unchanged).
* `node scripts/verify-manual-paths.mjs` (extra, not required by the contract) → `exit=0`, `PASS resolved=116 over-report=87 under-report=91 declared=2`.
* Hash sandwich, equal at start and end (both reads inside `gates.log`, UTC `2026-09-20T03:47:50Z`):
  * `docs/user-guide.md` `sha256 1245a6138839ef25e17b20d8ec24bbfb7fdc1036a29c9382430f6b3cd85a8d82`
  * `docs/user-guide.zh-CN.md` `sha256 74eaab3a5561d9ed8b890f625e7eaa74b0702d36e69427bb38ed2addef038e09`
* No file outside `docs/user-guide.md`, `docs/user-guide.zh-CN.md` and this evidence directory was touched by this lane (`git status` shows the same file set t4/t8 already had open).

## 5. Residual finding (reported, not silently fixed) — needs a follow-up

`packages/mpd-tui-plugin/README.md` (EN, lines 61–62 and 184–185) and its zh-CN twin
(`README.zh-CN.md` lines 54 and 158–159) still list **"the bundle floater" / "bundle 浮层"** as one of
the *web-only surfaces* the TUI board is the equivalent of. That is the same stale claim class this
task fixed in the user guide, and both are LIVE policed docs — but they are outside t10's declared
inScope, so this lane did not edit them. Proposed follow-up amendment (one task, two files, four
lines): reword to the two surfaces that actually ship (`agent-teams sidebar` + `workmate tab`) in
`packages/mpd-tui-plugin/README.md` and `README.zh-CN.md`, then re-run `bun run verify:docs`.
The zh twin's phrase is 浮层 (the EN sweep's `floater|悬浮|浮窗` did not catch it; the widened sweep
with 浮层 did), which is why an alias-complete sweep is part of this evidence.
