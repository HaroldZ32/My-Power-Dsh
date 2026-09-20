# t8 RESULT — the "bundle floater" claims: verdict, corrections, and the full mention inventory

Task: `t8` (implementation, attempt 2, attempt_id `18e9131c-b3b9-4769-860b-8daa29267062`)
Moment: verification read 2026-09-20T03:42:09Z; edits applied 2026-09-20T03:43Z; settled gate
window 2026-09-20T03:44:59Z → 03:45:14Z.

## 1. VERDICT — the floater is GONE (it is not alive; the doc claims were the stale side)

Plainly: **the bundle no longer contributes any floater, and no fallback surface exists.** The three
claims named in t8 were all false; `docs/design.md`'s opposite claim ("Both GUIs are sidebar-only —
no fallback anywhere") is correct. The floater's *registration code* still rides inside the shipped
artifact because the adopted client is embedded verbatim for its views/styles — that text is expected
and stays UNREGISTERED. The gate is REGISTRATION, not text.

Symbols that prove it (each measured, raw output in `verification.txt`):

1. `scripts/build-mpd-client.mjs` → `const LEGACY_SURFACES` names every removed surface
   (`id: "agent-teams-activity"`, `inject("conversation.chat.node"`, `inject("shell.overlay"`,
   `inject("sidebar.footer.action"`), and the loop right below it prints
   `[build-mpd-client] FAIL: the removed …` and calls `process.exit(1)` when
   `webClientFactory.includes(legacy) || teamPageFactory.includes(legacy)`.
2. `packages/mpd-bundle-plugin/src/web-client.js` and `packages/mpd-bundle-plugin/src/team-page.js`:
   ZERO hits for any `LEGACY_SURFACES` needle (grep exit 1). `src/web-client.js` states it in prose:
   no overlay floater, no footer toggle.
3. `packages/mpd-agent-teams-plugin/lib/client.js`: `function apply(ctx)` is the ONLY code that
   registers the floater (`ctx.slots.inject("shell.overlay", … id: "agent-teams-activity" …)`) and it
   is merely exported (`exports.apply = apply`). The embedded module self-registers under id
   `@nanmicoder/dsh-agent-teams`, while the bundle patch mounts the adopted plugin under entry name
   `@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js` (row id `agent-teams`) — nothing ever
   calls that `apply`.
4. `skills/dsh-qa/scripts/agent-teams-sidebar.mjs` asserts the whole story: `LEGACY_PATTERNS`,
   `steps.sourcesRegisterNoRemovedSurface`, `steps.adoptedNeverApplied`
   (`client.reads.adoptedApply === undefined`) with `artifactStillContainsAdoptedStrings`,
   `steps.noLegacyRegistration`, `steps.noFloaterDefined`, `steps.buildGatePresent`.

## 2. WHAT t8 CORRECTED (6 insertions / 6 deletions, exactly 3 files)

| File | Was | Now |
|---|---|---|
| `AGENTS.md` §3, `packages/mpd-bundle-plugin/` tree line | "…registered as a DSH-better-sidebar tab, with the bundle floater as fallback; built by `scripts/build-mpd-client.mjs`" | "…registered as a DSH-better-sidebar tab — both GUI surfaces are sidebar-only, no floater fallback; built by `scripts/build-mpd-client.mjs`" |
| `docs/tui.md` §3 surface-mapping row | web cell `Bundle floater` | web cell `—` (the table's own idiom for a row with no web counterpart; the TUI-side cells are unchanged) |
| `docs/tui.md` §11 NOT-CLAIMED item 3 | "the agent-teams **sidebar**, the workmate tab and the bundle floater" | "the agent-teams **sidebar** and the workmate tab" |
| `docs/tui.zh-CN.md` §3 row | `Bundle 悬浮窗` | `—` |
| `docs/tui.zh-CN.md` §11 item 3 | "…workmate 标签页与 bundle 悬浮窗" | "…workmate 标签页" |

`docs/tui.md` and `docs/tui.zh-CN.md` now contain ZERO floater mentions.

One DISCLOSED extra edit in the same inScope file: `AGENTS.md` line 12 wrote the docs-gate link
shapes as code spans `./x`, `x`, `../x`, `/x`, and `./x` is audited as the literal relative path `x`,
so `node scripts/verify-manual-paths.mjs` was ALREADY RED at HEAD (`FAIL unresolved=1 -> x
(AGENTS.md:12)`; introduced by commit `e820cbd`, 2026-09-19 — see `gates.before.log`). That gate is
one of t8's two verify commands, so the shapes now read `./<path>`, `<path>`, `../<path>`, `/<path>`
— placeholders, exempt through the auditor's own `PLACEHOLDER_RE` bucket. Revert independently if the
captain prefers it as a separate task.

## 3. GATES (settled)

| Command | Exit | Result |
|---|---|---|
| `bun run verify:docs` | 0 | `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| `node scripts/verify-manual-paths.mjs` | 0 | `PASS resolved=116 over-report=87 under-report=91 declared=2` |

Hash sandwich (start 03:44:59Z == end 03:45:14Z, 15 s settle, all three identical):
`AGENTS.md` `529c0f6e…d1153`, `docs/tui.md` `05d09f93…ccc74`, `docs/tui.zh-CN.md` `c47704c5…6bfe80`.
Raw output: `gates.after.log` (before: `gates.before.log`).

## 4. OTHER MENTIONS — the complete inventory (for t10 and the captain)

Nothing in this list was edited by t8 except the rows marked CORRECTED.

| # | Location | Status |
|---|---|---|
| 1 | `AGENTS.md:208`; `docs/tui.md` §3 row + §11 item 3; `docs/tui.zh-CN.md` §3 row + §11 item 3 | **CORRECTED by t8** |
| 2 | `docs/user-guide.md:312` (`| Bundle floater | the tuiStatus line |`), `docs/user-guide.zh-CN.md:284` (`| bundle 悬浮面板 | … |`) | **STALE — t10's scope (Senior Engineer); deliberately untouched** |
| 3 | `packages/mpd-tui-plugin/README.md:62` ("web-only surfaces (agent-teams sidebar, workmate tab, bundle floater)") and `:185` ("…the workmate tab and the bundle floater (`dsh.client.platform = web`) do not render in the TUI") plus the zh twin `packages/mpd-tui-plugin/README.zh-CN.md:54` ("bundle 浮层") and `:159` | **STALE — NEW finding, no task yet.** Same shape as the `docs/tui.md` pair t8 just fixed; both languages affected (zh spells it 浮层) |
| 4 | `agent-references/troubleshooting.md` (the "Workmates tab is missing from the DSH-better-sidebar tab strip" row) | **STALE and actively misleading — NEW finding, no task yet.** It says "A profile without that sidebar intentionally falls back to the bundle floater + sidebar-foot toggle, so the page is still reachable." The floater and the footer toggle are REMOVED (build-gated); without the host the page logs one warning and registers nothing. Agent-facing reference (English-only band) |
| 5 | `docs/plan-tui-edition.md:289`; `docs/tui-edition-report.md:119` | STALE but **EXEMPT prior-phase records** per AGENTS.md §3 (`plan-*.md`, prior-phase reports) — reported only |
| 6 | `docs/design.md:442`, `:489` (+ zh `:375`, `:415`); `packages/mpd-bundle-plugin/README.md:19`, `:25`, `:28`, `:38` (+ zh twin); `docs/feature-audit.md:16` (+ zh) | **Correct as written** — they describe the floater's interior as reproduced, or name it explicitly as removed, or describe the sidebar-tab contribution that still ships. No action |
| 7 | `skills/dsh-qa/scripts/*.mjs` (`agent-teams-sidebar.mjs`, `web-client-adapt.mjs`, `workmate-library.mjs`) | Assertions that the removed surfaces stay unregistered — correct, and `skills/**` belongs to the wave's single skills writer (t3). No action |

Out-of-scope paths touched by t8: none. `git status` for this task shows only ` M AGENTS.md`,
` M docs/tui.md`, ` M docs/tui.zh-CN.md`, plus this in-scope evidence directory.
