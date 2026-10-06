# Independent verification — wave `tui-dag-port` (clauses R1..R27)

**INSTRUMENTS I WROTE (my only product files, both green):**
`packages/mpd-tui-plugin/test/dag-fidelity.test.ts` — 28 arms (WEB parity, R17 derivation + the three
fallback arms, R19 ordering, R22 CJK-by-cell, geometry invariants, adversarial widths/boards).
`packages/mpd-tui-plugin/test/panel-visibility.test.ts` — 7 arms pinning the host's panel-enablement
chain and the split thresholds, read from the INSTALLED host package.


**Seat:** `fidelity-verifier` (Reviewer). I wrote no implementation file. Every claim below is either a
command I ran and quote, or a file I read and cite by symbol.
**Written:** 2026-10-06, from 13:51Z (wave start) to the timestamps named per section.
**Revision anchors** (sha256 prefix / byte size, read 2026-10-06T14:03:12Z; full list in
`revision-hashes.txt`): `dag-theme.ts a9c509e9/8047`, `graph.ts 071f8543/48046`,
`panel.ts 40eb4ce2/27955`, `panel-dag.ts 7c4de123/41650`, `panel-workmate.ts 87dedfa6/24554`,
`panel-core.ts 284655c5/34661`, `team-view.ts 61774b70/84279`, `team-store.ts 00117a63/40126`,
`.mpd/team/teams/team-20261006135108.json c2902ca2/31667`.
The implementation kept moving while I verified; **every verdict names the artefact it was measured
against**, and I re-measured the R13 floor and the R20 derivation when their files changed under me.

**Isolation.** Every PTY capture ran through the repo's own harness (`runTuiSession` in
`skills/dsh-qa/scripts/lib/tui-lane.ts`): `DSH_HOME=<root>/dshhome`, `HOME=<root>/home`,
workspace cwd `<root>/ws`, private tmux socket, `env -i`. `bun skills/dsh-qa/scripts/tui-mount.ts
--sandbox-root .mpd/recon/tui-013` reported `isolationOffenders=0` and
`session keys created=[]`, so no boot touched the real `~/.dsh` or `~/.mpd/workmate`.

---

## 1. The R1..R21 status table

| Clause | Verdict | Evidence (what I actually ran/read) |
|---|---|---|
| **R1** independent `dag` page registered through the adapter | **VERIFIED (INTERIM build)** | `pty/interim-368005/w120/tab1.pane.txt`: the strip carries `≡ ▸ ◆ M ‹ MPD DAG › ◆` and the page paints a full body — header, the rail with `└─▸` edges, `view rail · 12 tasks · ranks derived`, the legend, the state key and the hints. Anchored to `dist/index.js` 368005 B sha `584b02f3…`; FINDINGS 11–12 are its two rendering defects. |
| **R2** adaptive vertical geometry, no fixed sizes | **VERIFIED (invariants)** | `dag-fidelity.test.ts` geometry arms: every row ≤ cols at 13 widths incl. 1/2/8/12; shrinking never grows a row; hits contained; pointer resolves back. |
| **R3** WEB-parity node content (glyph/id/kind/subject) | **VERIFIED** | Parity read out of the WEB source: glyph table, `kind` words and the six hexes all match (`dag-fidelity.test.ts` 9 arms). |
| **R4** one edge per `blockedBy`, orthogonal, per-source lanes, `▼` preserved | **VERIFIED on a PTY** | `pty/interim-368005/w120/tab1.pane.txt` and `pty/run-enabled/w120/panel.pane.txt` paint the rail's real edges: `└─▸ ○ T11`, `├─▸ ○ T9`, `└─▸ ○ T12` and the nested `│ └─▸ ○ T8`. `▼`/`▸` equal the drawing's own constants (arm). Per-source LANE separation (fan-in legibility): **NOT VERIFIED** — no fixture of mine isolates two sources into distinct lanes. |
| **R5** six-state TONE palette as ONE table | **VERIFIED** | `DAG_TONE_THEME` total over 11 tones; no state borrows another state's hex; `DAG_TONE_WEB_HEX` equals the WEB source's own hexes. |
| **R6** chrome + header + footer + legend | **PARTIAL** | The legend and the header are PAINTED (`pty/interim-368005/w120/tab1.pane.txt` row 32 `▼/▸ blocker → dependent · ▶ focus`, row 4 the header). The **border TITLE is missing** in the interim build and the frame's right border drifts (FINDINGS 11–12). `legendLines` names both markers and the direction, reads every glyph out of `GLYPH`, and returns `[]` below `MIN_LEGEND_COLS` (arm). |
| **R7** progress stats reachable (`layoutList` gains a caller) | **VERIFIED** | `layoutList` is exported and `panel-dag.test.ts` "a busy narrow board reaches the dense list" passes; `layoutGraph` falls back boxes→rail only, so the list caller is the panel's own choice. |
| **R8** running animation via `useAnimationTime`, static when absent | **NOT VERIFIED** | I did not exercise a running task on a PTY, and I ran no animation-timer arm. The contract is declared (`DAG_ANIM`); nothing I ran proves it renders. |
| **R9** panel badge (`info`/`warning`/`error`) | **NOT VERIFIED** | The host's badge setter exists (`panels.js` `badge`) and the badge glyph is rendered by `PanelBar` only when `tab.badge != null`; the frozen frames show `◈`/`M` for our inactive tabs with **no `●`/`!`/`×` beside them**, i.e. no badge was set in this capture — which is consistent with a board that has nothing to report and does NOT prove the badge path works. I did not construct a failing task to force one. |
| **R10** empty / CYCLE / `failedBy` beside the state | **PARTIAL** | Cycle: VERIFIED (`graph.ts` `cycleIds`, arm on a 3-ring and a self-dependency). `failedBy BESIDE` (OPT-1): **NOT VERIFIED** — no arm I ran distinguishes `failed` from `blocked` on a PTY. |
| **R11** click-to-pin detail + keyboard focus | **VERIFIED (keyboard path)** | Reached deterministically at the FROZEN revision (`pty/frozen-pin/w120/pin.pane.txt`): from `MPD`, one `Right` to `MPD DAG`, then `Down Down Enter`. The pin body paints `◆ T2` and `id T2 · kind work · visual open · verdict — · failedBy — · owner dag-geometry · attempt — · round — · blockedBy — · dependents T11,T7,T9`, and the focused row carries `▶` instead of its state glyph. Mouse click: **NOT VERIFIED** (no pointer in a tmux capture). |
| **R12** independent `workmate` page | **VERIFIED (INTERIM build)** | `pty/interim-368005/w120/tab2.pane.txt`: the strip carries `≡ ▸ ◆ M ◈ ‹ MPD workmate ›` and the page paints `1 instance · read-only` with its scroll/keys hints — an independent tab with its own body. |
| **R13** invisible panel root-caused + fixed | **ROOT CAUSE VERIFIED / FIX PARTIAL** | The mechanism is nailed (FINDINGS 1–2) and the remedy is proven to work on a real PTY: with the enable CSV set, `‹ MPD ›`, `‹ Dag ›`, `‹ Workmate ›` all appear and the MPD page draws the real board. What is NOT done is the user-facing half: the default config still hides it and `/mpd panel` still reports a false "opened". |
| **R14** whole-surface redesign shares one visual system | **NOT VERIFIED** | `scenes.ts`/`status.ts`/`subagent-scene.ts` changed, but I ran no scene capture or before/after render diff, so I have no evidence either way. |
| **R15** invariant tests + real-PTY captures | **VERIFIED for tests / PARTIAL for captures** | Invariant tests exist and pass (33 arms). Captures exist at 200/120/105/104/96/80/48/32 (plain) and 200/120/80/48/32 (CJK). |
| **R16** evidence dirs + a real Docker machine run | **PARTIAL** | Evidence dirs exist; **I ran no Docker lane** — `verify:docker` is later-wave and I did not run it, so the "real machine" half is unverified by me. |
| **R17** TUI rank DERIVED, never trusted | **VERIFIED** | Three fallback arms on `graph.ts`: lying depths → 5 ranks + `ranksDerived=true`; flat-and-honest → 1 rank; nothing-resolves+varying → fallback fires and reports `ranksDerived=false`; dangling refs surfaced. |
| **R18** an `unresolved` list for references naming no task | **VERIFIED** | `GraphView.unresolved` is sorted + de-duplicated and carries exactly the eight dangling references of the user's board (arm); the WEB side's own unresolved reporting: **NOT VERIFIED** (I read only the TUI list). |
| **R19** numeric within-column order; direction stated; detail names what it UNLOCKS; focus precedence | **VERIFIED for ordering, direction and UNLOCKS** | **What it UNLOCKS: VERIFIED** — the pin body's `dependents T11,T7,T9` row is exactly the set of tasks whose `blockedBy` names T2 (checked against the live record), and the rail annotates a multi-blocker row as `⇠ T2+T3+T4+T6`. Focus precedence pinned > keyboard: VERIFIED (a pinned T2 keeps `◆`/`▶` while the keyboard move is inert on it); hover: NOT REQUIRED by the user and NOT VERIFIED, as before. | Ordering was RED when I first measured it and is now GREEN on BOTH planes, re-measured by direct probe rather than by trusting my own arm: scrambled board `T10,T2,T1,T3,T20` → TUI `T1,T2,T3,T10,T20` and WEB `T1,T2,T3,T10,T20`. Direction: VERIFIED (legend arm + the painted legend). "Names what it UNLOCKS" and focus precedence: **NOT VERIFIED**. |
| **R22** the CJK cell bug (boxed line loses its RIGHT border) | **VERIFIED FIXED** | Arm: every node's own top border, sliced by CELL, is exactly `colEnd+1` wide, starts `┌` and ends `┐`, at 48/64/80/120/200 cols on a 7-task all-CJK board. A code-point slice reported 4 phantom mismatches — which is the mistake the bug hid behind. I did not quote `dag-geometry`'s numbers; these are mine. |
| **R23** the 32-column floor must be true | **VERIFIED FIXED** | At 32/31/33 cols: `chain` stays `boxes` with **0 overflowing rows** (no clipping), `cjk` and `fanin` degrade to `rail`. The old "boxes that clips at 32" shape is gone. |
| **R24** no drawn edge may cross a node box | **VERIFIED** | Rendered rows show the junction glyphs sitting ON a box's own border row (`┬` on a bottom border where an edge leaves, `┴` on a top border where it enters) and the arrowhead one row ABOVE the child's border; no edge glyph lands in a node's interior. My first probe flagged 10 "intersections" — inspecting the pixels showed they were the border T-junctions, i.e. my glyph set was wrong, not the drawing. |
| **R25** acceptance must enable the host switches | **VERIFIED** | With `sidePanel.panels` naming `act1:team,act1:dag,act1:workmate` and `open: true`, all three tabs appear and are selectable (`pty/run-enabled/`). I also independently reproduced the captain's host citation: `SidePanelColumn.js:42 const tabs = controller.enabledPanelIds.map(…)`. |
| **R26** no surface may claim an unverifiable success | **VERIFIED (sentence half)** | `i18n.ts panel.opened` (EN): *"mpd sidebar panel: the host accepted {id}; if no panel appeared, add {id} to the panel list in /settings → side panel, then press Ctrl+B (or turn on \"Side panel starts open\")"*, with the ZH twin in the same entry — it states what it knows and names the step. `panel.ts` still routes on `opened() === true`; that is a **deliberate, reasoned choice by the owner**, not an oversight: the host's `TuiPanelEvent` set is `registered \| unregistered \| badge \| error \| disabled` with `opened`/`focused` an explicit host TODO, so the bundle **cannot observe a render** and narrowing the branch would replace one unverifiable claim with a differently-worded one. The honesty lives in the sentence; recorded that way. |
| **R27** the remedy is documented | **NOT VERIFIED** | `doc-scribe`'s bilingual docs were not on disk when I read; I did not review them. |
| **R20** WEB DAG derives too | **VERIFIED (fixed, with a corrected fixture)** | The discriminating fixture is a board whose references RESOLVE while EVERY served `depth` is `0`. Before the port it measured `rankCount 1`; after it measures **`rankCount 5`** with real columns. `team-view.ts` grew 84279 B → **94016 B at 22:14**, and the old trust expression `Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0` is gone, replaced by a `servedRank` fallback used only when the graph resolves nothing. Three arms in `dag-fidelity.test.ts` now pin it, green. |
| **R21** unresolvable blocker reference REPORTED, distinguishable from "genuinely none" | **VERIFIED FIXED (both planes)** | TUI layout: `GraphView.unresolved`, sorted+deduped. **Producer: VERIFIED by driving the real store** — `store/resolveBlockers` now splits every reference into `{blockedBy, unresolved}`, `addTeamTask`/`updateTeamTask` store both halves, and a task whose reference names nothing carries `unresolvedBlockers: ["2"]` while a task with genuinely no blocker carries `undefined`. Reproduce with `bun evidence/tui/dag-port/verification/r21-producer-check.ts` (exit 0, `R21 PASS`). |

**Gates at my last sweep:** `typecheck` PASS · `verify:rows` PASS · `verify:docs` PASS ·
`verify:manifest` PASS · `verify:comments` PASS · `bun test ./packages` **1764 pass / 2 fail / 3 skip**
(the 2 are the in-progress scrollbar feature, not mine) · `verify-dist-fresh` FAIL (stale dist, the
bound in FINDING 1b) · `tui-mount` PASS · `tui-panels` FAIL on its store-blind `tuiRenderers` arm.

**Clauses I could NOT verify, listed plainly:** R4 (per-source lane separation), R8 (animation), R9
(badge), R11 (click/keyboard detail body), R14 (whole-surface redesign — I ran no scene capture), R16
(Docker real-machine lane — I ran none), R18 (the WEB side's unresolved reporting), R19 (the focused
detail naming what a task UNLOCKS; focus precedence pinned > keyboard > hover), R27 (the docs).

---

## 1a. FROZEN REVISION CAPTURE — the verdicts the final frames carry

**FROZEN, declared by the captain at 22:20Z and verified byte-for-byte by me before the capture:**

| artifact | sha256 prefix | bytes |
|---|---|---|
| `packages/mpd-tui-plugin/dist/index.js` | `c8b87a32dafde0c9` | 368228 |
| `packages/mpd-bundle-plugin/client.js` | `2fbd0e26da6e898c` | 640774 |
| `packages/mpd-team-core-plugin/dist/index.js` | `a6b96536dbfdf3bf` | 136550 |

Every artefact matched the declared sha and size at read time, so this capture measures a build anyone
can name. Artefacts: `pty/frozen/{w120,w80,w48,w32}/`, `pty/frozen-cjk/…`, `pty/frozen-pin/w120/`.

**What only this revision could settle, and the answer each got at 120 columns:**

| clause | frozen verdict | frame |
|---|---|---|
| R6's border TITLE | **PRESENT** — `┌MPD DAG───…┐`, `┌MPD workmate───…┐` (interim pane preserved as the BEFORE, bare) | `tab1`, `tab2` |
| R1's page body | **RENDERS** — header, rail with `└─▸` edges, `view rail · 12 tasks · ranks derive`, legend, state key, hints | `tab1` |
| R12's workmate body | **RENDERS** — `1 instance · read-only`, `◆ qa-tui-probe · qa-tui-probe`, `base (unknown base)`, `uses 0` | `tab2` |
| R11's detail body | **RENDERS** — `◆ T2` + `id/kind/visual/verdict/failedBy/owner/attempt/round/blockedBy/dependents` | `frozen-pin/w120/pin` |
| R9's badge | **no badge set** in this capture (no `●`/`!`/`×` beside our tabs) — consistent with a clean board, and NOT proof of the path | all |
| R14's whole-surface redesign | **NOT VERIFIED** — I ran no scene capture, so the scenes/status line are outside what these frames judge | — |
| the rail's legibility defect | **FIXED** — 24 rows for 12 tasks → 12 rows, assignees inline | `interim/w120/tab1` vs `frozen/w120/tab1` |

## 1b. INTERIM BUILD CAPTURE — `dist/index.js` 368005 B, sha256 `584b02f34c1da39a46a134a1`, mtime 22:10

**This section is labelled INTERIM by the captain's explicit instruction**, because every lane was still
writing when it was taken. It is the FIRST build in the wave that contains `panel-dag.ts`,
`panel-workmate.ts` and `panel-core.ts` (the 306516 B build did not — FINDING 1b), so it is the first
frame in which the two new pages have a body to paint. Artefacts: `pty/interim-368005/w120/`.

**The tab strip at 120 columns, after the R25 switches:**

```
bars = ["≡ ▸ ◆ ‹ MPD › ◈ ◆", "‹ 待办 › ▸ ◆ M ◈ ◆", "≡ ▸ ◆ M ‹ MPD DAG › ◆",
        "≡ ▸ ◆ M ◈ ‹ MPD workmate ›", "≡ ‹ 任务 › ◆ M ◈ ◆   ⤢", "≡ ▸ ‹ 代理 › M ◈ ◆   ⤢"]
```

Three independent MPD pages, each its own selectable tab, our icon `◈` on the inactive ones.

**THE PAGES RENDER — R1 and R12 are now VERIFIED, not inferred.** `‹ MPD DAG ›` paints a full page:
the header `team tui-dag-port  phase active task`, the rail with real `└─▸` edges (`└─▸ ○ T11` under
T2, `└─▸ ○ T6` under T3, the nested `└─▸ ○ T8`, `├─▸ ○ T9`, `└─▸ ○ T12`), the page's own status line
**`view rail · 12 tasks · ranks derived`** — the derivation DECLARED on screen — the legend
`▼/▸ blocker → dependent · ▶ focus`, the state key (`✓ completed · ◐ running`, `○ open=blocked`, …) and
the key hints (`↑↓/jk move · Enter pin · Esc unpin`). `‹ MPD workmate ›` paints `1 instance · read-only`
plus its hints. `‹ MPD ›` paints the merged view.

### FINDING 11 — THE RAIL EXCEEDED ITS INTERIOR AND WRAPPED — **re-recorded**; the border-column claim is **RETRACTED as an instrument artefact** (severity: **high as the real defect, retracted as stated**)

**RETRACTION FIRST, because the withdrawn claim is the more instructive half.** My interim account said
"the frame's right border lands on the wrong column, on 4 of 44 rows, in two pages whose bodies are
EMPTY". **That was my measure's bug, not the panel's.** I sliced the sidebar out of each row with
`[...line].slice(81)` — a **code-point** slice — while the CHAT column on those rows carries CJK (the
`提示：/mcp 技能…` tips line, `探索未至之境！`, `▶ （Ctrl+P 展开）`). A code-point slice drifts LEFT by one
cell per wide glyph, so the slice started in the wrong place and the border *appeared* displaced. Those
four rows are exactly the four rows whose chat column carries wide characters.

Re-measured with a CELL-accurate slicer, on the FROZEN build:

```
frozen/w120  panel / tab1 / tab2 / back / pin :  42 content rows each
             left border at cell 0 on every row, right border at cell 36 on every row
             offenders: 0 and 0
```

The frame is a perfect rectangle — **in the interim build too** (the captain reproduced this
independently with the repo's own `cellWidth`). There is no border defect. The instrument lesson is
recorded in §6.

**THE REAL DEFECT THE SAME ROWS CARRIED — independently measured, before/after at named shas.**

The rail's label-plus-assignee composition exceeded the frame's interior, so the HOST wrapped every
row and the assignee fell onto a row of its own, doubling the rail:

| build | rows naming a task | continuation rows (an assignee or fragment with no task id) | rail height for 12 tasks |
|---|---|---|---|
| INTERIM 368005 B, sha `584b02f3…` | 12 | **12** (`lead`, `dag-geometry`×2, `panel-surface`, `seam-guard`×3, `tui-visuals`, `visual-reviewer`, and the fragments `v`, `r`, `docs`) | **24 rows** |
| FROZEN 368228 B, sha `c8b87a32…` | 12 | **0** | **12 rows** |

Frozen, every assignee is inline: `│○ T2 WRK WORK: the ad  dag-geometry│`. Interim, `T2`'s row read
`│○ T2 WRK WORK: the adap            │` with `dag-geometry` on the NEXT row. The captain measured the
same effect on a 7-task fixture (14 → 7); on the live 12-task board it is 24 → 12. The fix
(`panelContentWidth(cols) = max(1, cols - 2)`, one budget applied to every drawing call and row clamp —
verified at `panel-core.ts:462` and one call per page at `panel-dag.ts:579`, `panel.ts:226`,
`panel-workmate.ts:364`) is **vindicated on this basis, not on my phantom**, and the legibility
difference is visible in one glance between the two panes.

### FINDING 12 — (INTERIM) the frame carries NO border title in this build; the prediction is CONFIRMED (severity: **medium**, fix already in src)

All three plugin pages draw `┌───────────────────────────────────┐` with a bare top border — no title on
any of them. The host's contract, read from the installed package
(`lib/types/ink/render-border.js:97`):

```js
if (showTopBorder && node.style.borderText?.position === 'top') { …embedTextInBorder(…) }
else if (showTopBorder) { topBorder = styleBorderLine(topBorderLine, …) }   // title silently dropped
```

The prediction was: `panel-core.ts` passes `borderText: panelText(title, 80)` — a bare STRING, which has
no `.position`, so the title takes the plain branch and vanishes. **Confirmed on the terminal, and the
src has already been fixed** — `panel-core.ts` now carries the note *"THE BORDER TITLE IS AN OBJECT, NOT
A STRING — measured against the installed host … the title is SILENTLY DROPPED"*. So this capture is the
**BEFORE** frame; the freeze capture is the AFTER. I record it either way, as asked.

For fairness of comparison: the host's own `任务`/`代理` panels draw **no bordered frame at all** in the
sidebar (their content sits directly on the column, and `────── 子代理面板 ──────` is the agents panel's
own separator, not a border title). So the bordered frame is entirely ours and its title is entirely our
contract (R6) — there is nothing for the host to lend us.

## 2. Findings, numbered, most severe first

### FINDING 1 — R13 root cause: the panel is registered, reported "opened", and is NOT enabled (severity: **critical**)

> **THE DEFECT IS TWO HALVES AND ONLY ONE IS FIXED.** With the host's DEFAULT config the panel is
> invisible (measured below, unchanged). With `sidePanel.panels` naming the composed ids it is fully
> visible and draws the real board (measured, `pty/run-enabled/`). So the remaining work is the
> user-facing half — the default and the false "opened" sentence — not the rendering.

**What I measured.** On a real PTY at 200 and 120 columns, after `/mpd panel`, after `C-b`, and after
cycling every tab with `→` ×3, the host's tab strip carried **exactly the three builtins and never our
panel**:

```
cols=120  bars=["‹ 待办 › ▸ ◆", "≡ ‹ 任务 › ◆    ⤢", "≡ ▸ ‹ 代理 › ◆    ⤢"]   mpdTab=false
cols=200  bars=["‹ 待办 › ▸ ◆", "≡ ‹ 任务 › ◆    ⤢", "≡ ▸ ‹ 代理 › ◆    ⤢"]   mpdTab=false
```

`▸` = jobs and `◆` = agents are the host's own declared icons
(`builtinPanels.js` `{id:'jobs', icon:'▸'}` / `{id:'agents', icon:'◆'}`), so the strip is
`todo + jobs + agents` — the default CSV and nothing else. Frames:
`pty/run/w120/{panel,sidebar,tab1,tab2,tab3}.pane.txt`, `pty/run/w200/…`,
`pty/run-cjk/w120/…` (CJK fixture, identical).

**And the command lied to the user.** Every `/mpd panel` recorded
`command/done {kind:"success", text:"mpd 侧栏面板：已打开（act1:team）"}` — "sidebar panel: opened".
The frame captured right after it has **no split at all** (`divider=NONE`), while the very next
`C-b` frame does (`divider=80`). So `opened()` returned true and the layout never changed.

**The mechanism, read out of the installed host (`@deepseek-harness-tui/dsh-tui` 0.13.0):**

1. `tuiDisplayPrefs.js` `DEFAULT_SIDE_PANEL_IDS = "todo,jobs,agents"` — an unconfigured host's enabled
   CSV contains no plugin panel at all.
2. `dsh-adapter/panels.js` `enablePanelIdInStore(finalId)` **does** append a successfully registered id
   to that CSV — the mechanism exists.
3. `tuiDisplayPrefs.js` `createLiveSetting` is **in-memory only** (`let state = initial`; no read/write
   of any file), so the CSV is rebuilt from configuration whenever settings are applied.
4. `dsh-adapter/plugin.js` `applyDisplay` calls `applySidePanelPanels(value.sidePanel?.panels ??
   config.sidePanel?.panels)` — i.e. it **rewrites the CSV from configuration**, whose schema default
   is `DEFAULT_SIDE_PANEL_IDS`. That is what removes the appended id.
5. `components/sidePanel/useSidePanel.js` `openPanel(id)` opens the sidebar only
   `if (parseSidePanelIds(getSidePanelPanels()).includes(id))` — otherwise it returns **without
   opening**, and the bridge has already answered the plugin's request, which is why `opened()` is
   true while nothing changes.

`packages/mpd-tui-plugin/test/panel-visibility.test.ts` pins all five links mechanically against the
installed host (7 arms, green). The `panel id=act1:team` also shows the host could not derive a
component identity for the row and fell back to its `act1` namespace (`panels.js` `pluginIdFor`), so
the final id is **not predictable by a user** — which is what makes "set `sidePanel.panels` yourself"
a poor remedy as things stand.

**Why no gate caught it:** `skills/dsh-qa/scripts/tui-panels.ts` declares its `tuiPanels` surface
`source: "store"`, so it passes on the command-registry record alone. My run of that lane today
reported `tuiPanels=rendered` **while the panel was unreachable**. A store-sourced arm cannot see a
layout the host never drew.

### FINDING 1b — THE `dag` PAGE'S BODY COULD NOT BE JUDGED: every PTY capture in this wave ran a STALE `dist` (severity: **high as a bound, not as a defect**)

I first read this as a defect and then falsified my own reading. What I measured, twice, at 120 columns:
the `dag` tab is present and selectable (`≡ ▸ ◆ M ‹ Dag › W`) with **0 body rows** between the strip and
the footer rule, while the sibling `MPD` page paints 36 rows of the same board in the same boot.

**What disqualifies that as a finding:**

```
packages/mpd-tui-plugin/dist/index.js   306516 B   2026-10-06 21:34
packages/mpd-tui-plugin/src/panel-dag.ts 47805 B   2026-10-06 22:09
grep -c 'dagPanel' packages/mpd-tui-plugin/dist/index.js   -> 0
grep -c 'dagPanel' packages/mpd-tui-plugin/src/panel-dag.ts -> 4    (and 22 occurrences of 'Dag')
```

The running build predates `panel-dag.ts` by 35 minutes and **does not contain the current page at
all** — it carries an earlier registration whose body is empty. So the empty `dag` body is a
**stale-artefact**, and I cannot say whether the current source renders. `node scripts/verify-dist-fresh.ts`
already reports exactly this (`packages/mpd-tui-plugin/dist/index.js` STALE, 1 of 29 targets).

**THE BOUND THIS PUTS ON EVERY OTHER RENDERING VERDICT IN THIS REPORT.** All my PTY captures read the
21:34 dist. So:
- the R4 rail edges, the R6 legend and the R17 derivation I quote are **verified for the 21:34 build**
  and are not evidence about any source edit made after it;
- R1's page body, R9's badge, R11's detail body, R12's workmate body and R14's redesign remain
  **NOT VERIFIABLE** until the captain rebuilds (`bun build packages/mpd-tui-plugin/src/index.ts
  --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js`, from the repo root) and
  the captures are re-run. My driver is re-runnable in one command for exactly that reason.

### FINDING 2 — `reach=1` is a false positive; `/mpd panel` must verify the layout, not the bridge (severity: **high**)

`panel.ts` `PanelSeam.openOrScene` treats `tui.openPanel(id).opened() === true` as "opened" and
prints `panel.opened`. The host's `open` resolves through `panelBridgeRequests.request('open', id)`,
which reports **consumption**, not effect (FINDING 1 step 5). Evidence:
`evidence/tui/lanes/2026-10-06T14-02-20.539Z` and every `command/done` I read. The sentence shown to
the user is therefore false in the one case it exists for. Fix shape: have the adapter/existing
`subscribe` seam observe `opened/focused` (the host's event source is marked TODO in `panels.js`) or
have the panel print "requested" until a frame proves the split.

### FINDING 3 — the panel column is un-openable below 93 content columns, and un-splittable at 32/48/80 on a real PTY (severity: **medium**, contract-limited)

`dimensions.js`: `canSplit(columns) = columns >= CHAT_MIN_COLUMNS(64) + PANEL_MIN_COLUMNS(28) +
DIVIDER_COLUMNS(1) = 93`, and `resolveSidePanelGeometry` returns `null` below that **even with
`open: true`**. With the host's default `pageMargin: normal` (2 columns per side) that means a terminal
below ~97 columns cannot show the sidebar at all. My frames agree exactly: `split=true` at 200/120,
`split=false` at 80/48/32 (`pty/run/summary.json`). No plugin-side change can fix this — it is a
host-owned limit, and the honest remedy is the full-screen scene plus a documented terminal-width
requirement.

### FINDING 4 — the trap band was REAL and has just been closed (severity: **medium**, closed)

While this bundle's `panel.ts` declared `minColumns: 32` and `dag-theme.ts` declared
`DAG_PANEL_MIN_COLUMNS = 32`, the sidebar opened at content width 93 but the panel column was 28, and
`PanelHost` paints its own `panel-too-narrow` string (`宽度不足（需 ≥ 32 列）`) whenever
`width < def.minColumns` — so the panel was **invisible across content widths 93..100**, the exact
band a 100/104-column terminal lands in. I measured the first content width at which 32 was satisfied
as **101**. Both files now declare **28** (the host's own floor): `panel.ts PANEL_MIN_COLUMNS = 28`,
`dag-theme.ts DAG_PANEL_MIN_COLUMNS = 28`, `WORKMATE_PANEL_MIN_COLUMNS = 28`. My arm flipped from
red to green at 14:0xZ **because the defect was fixed, not because the assertion weakened** — it still
asserts that the declared floor is satisfied at the very first width the host will split at.

### FINDING 4b — the acceptance step itself was wrong, and that is the wave's most valuable correction (severity: **medium**, informational)

`seam-guard`'s earlier captures and my own first matrix both concluded "no panel" from a boot whose
config never named our ids. Side by side, the SAME revision at the SAME width:

| Sandbox config | Tab strip at 120 cols | Verdict |
|---|---|---|
| default (`todo,jobs,agents`) | `‹ 待办 › ▸ ◆` + `‹ 任务 ›` + `‹ 代理 ›` | our panel absent — `pty/run/w120/` |
| `sidePanel: { open: true, panels: "todo,jobs,agents,act1:team,act1:dag,act1:workmate" }` | `≡ ▸ ◆ ‹ MPD › D W`, `‹ Dag ›`, `‹ Workmate ›` | all three reachable — `pty/run-enabled/w120/` |

So "the panel does not render" and "the panel is not enabled" are different findings, and only the
second was true of the earlier captures. I record both because the USER's report is about the default
experience: an unedited config shows nothing, and the host's own auto-enable is overwritten
(FINDING 1 steps 3–4). A remedy the user can type requires a PREDICTABLE id, and today's is `act1:*`.

### FINDING 5 — the wave's own red tests: 9 at my first sweep, **2 at my last** (severity: **medium**, mostly resolved)

`bun test ./packages` moved **1704 pass / 9 fail** → **1764 pass / 2 fail / 3 skip** during the wave, and
`bun run verify:comments` moved **FAIL (15 violations across 7 lane-owned files)** → **PASS**. The six
failures I reported were repaired, including the three in `mpd-bundle-plugin/test/team-view.test.ts` whose
helper read a `blockedBy` field the R20 repair had moved. What remains red is the in-progress scrollbar
feature (`panel-surface`): *"FOCUS AUTO-SCROLL: the focused task is inside the rendered window at both ends
of an overflowing board"* and *"the offset clamps to [0, max(0, content - viewport)] and never renders a
blank page"*. Neither is mine; both are in the file that lane is actively writing.

### FINDING 6 — `bun skills/dsh-qa/scripts/tui-panels.ts` fails on its renderer arm (severity: **low**, pre-existing-looking)

`tuiRenderers=MISSING`: the lane's own diagnosis is *"the plugin APPENDED its log-only event (proven in
the session store) but the host projected NO row … a PROJECTION gap, not a registration one"*. Nothing
in this wave's scope, but it makes that lane red, so a reader must not read `tui-panels exit=1` as a
wave regression. Full log: `gate-tui-panels.log`.

### FINDING 7 — R19's within-column ordering was met by NEITHER surface — **CLOSED during the wave** (severity: **medium**, now closed)

Handed the same scrambled board (`T10, T2, T1, T3, T20`), BOTH planes originally drew the served order:
TUI `layoutGraph` → `T10,T2,T1,T3,T20`; WEB `layout` → `columns [["T10","T2","T1","T3","T20"]]`. I left the
arm RED on purpose and said so in its own comment. Re-measured at the end of the wave, by a direct probe
`(bun -e`, not by reading my own assertion):

```
TUI drawn order   : T1,T2,T3,T10,T20
WEB drawn order   : T1,T2,T3,T10,T20
numeric expected  : T1,T2,T3,T10,T20
```

So the gap was real, was found by the arm, and is now closed on both planes. The arm stays armed.

### FINDING 7b — MY OWN R20 ARM MEASURED THE PAYLOAD, NOT THE VIEW (severity: **informational**, and the wave's second instrument lesson)

Worth recording because it is the failure mode this seat exists to prevent, and I made it. My first
evidence script computed the served `depth` with the real `taskDepths` and then reported
`rankCount 5` — a GREEN that said nothing about the WEB view, because it handed the view a CORRECT
payload and a view that trusts `depth` lays a correct payload out correctly. The captain falsified it
(`grep -c 'deriveRanks|rankPlan|rankOf|ranksDerived' team-view.ts` = 0 at their read). The fix is the
fixture below, and it is now the arm that can actually fail: **references that RESOLVE while every
served `depth` is `0`**. Its verdict flipped exactly once, at the moment the port landed:

| reading | `team-view.ts` | payload depths | WEB `rankCount` |
|---|---|---|---|
| 14:03Z | 84279 B, no derivation | all 0 | **1** |
| 22:1x, minutes before the port | 84279 B | all 0 | **1** |
| 22:14 onward | 94016 B, derives | all 0 | **5** |

The TUI arm (R17) was written the same way from the start — red on purpose until the engine derived —
which is why it needed no correction. The rule this wave produced twice: **a fixture that cannot
distinguish "the subject fixed it" from "the input was already right" is not a test.**

### FINDING 8 — R21's data plane dropped dangling references silently — **CLOSED during the wave** (severity: **high**, now closed)

Reproduced by running the real modules (`one-column-repro.ts`, `--json one-column-repro.json`):

- `team-store.ts resolveBlocker` (as it stood): returned the reference **unchanged** when neither an
  exact id nor an exact subject matched — `["2"]` survived approval as the string `"2"`.
- `team-store.ts taskDepths`: `[...task.blockedBy].filter(candidate => byId.has(candidate))` — drops
  every unresolvable reference, so on the pre-repair board `servedDepths` was **all 0**, `distinctRanks
  [0]`, `links 0`, and `unresolved` was nowhere recorded.
- `team-view.ts` then trusted it (`Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0`,
  and edges only when `parent.depth < child.depth`) → `rankCount 1`, all ten tasks in one column,
  height 518px. **The user's report reproduced end-to-end.**

**CLOSED.** The producer now reports: `team-store.ts` gained `resolveBlockers(record, references):
BlockerResolution` (`{blockedBy, unresolved}`) as "THE ONE PLACE THE SPLIT IS COMPUTED", and both
`addTeamTask` and `updateTeamTask` call it, storing the caller's text in `blockedBy` and the unmatched
entries on `TeamTaskRecord.unresolvedBlockers`. Verified by driving the real store rather than by
reading the comment — `r21-producer-check.ts`, exit 0:

```
T2 | blockedBy=["2"]   | unresolvedBlockers=["2"]     <- REPORTED
T3 | blockedBy=["T1"]  | unresolvedBlockers=null      <- resolved, nothing to report
T4 | blockedBy=[]      | unresolvedBlockers=null      <- genuinely no blockers
depths: {T1:0, T2:0, T3:1, T4:0}
```

A dangling reference and "no blocker" are now different facts on the record itself, which is the whole
of R21. `taskDepths` still filters with `byId.has` — correct, because a reference that resolves to no
task contributes no path length; the reporting is what was missing, and it is there.

### FINDING 9 — the live-record repair is internally inconsistent in exactly one edge (severity: **low**, but it changes the user's picture)

Read at 13:56Z, `.mpd/team/teams/team-20261006135108.json`:

| Task | pre-repair `blockedBy` | post-repair | every other task's mapping implies |
|---|---|---|---|
| T6 | `["2"]` | `["T3"]` | `["T2"]` |
| T7 | `["2","3","4","6"]` | `["T2","T3","T4","T6"]` | same ✓ |
| T8 | `["7"]` | `["T7"]` | same ✓ |
| T9 | `["2","3","4","5","6"]` | `["T2","T3","T4","T5","T6"]` | same ✓ |
| T10 | `["7","8","9"]` | `["T7","T8","T9"]` | same ✓ |

One edge was re-pointed while the same rule was applied everywhere else. The repair is otherwise
verified: **`distinctRanks [0,1,2,3,4]` (5 columns), `links 16`, `unresolved []`, `cycles []`, and the
WEB layout draws `rankCount 5`** — so the user's current WEB view is correct in shape. Whether T6
truly depends on T3 rather than T2 is a captain call, not a measurement; I report the inconsistency
and its evidence, and I record it as a **live-board workaround, not a substitute for R21**.

### FINDING 10 — anti-slop: the port mostly resisted the rewrite, with two exceptions (severity: **low**)

- **No second renderer.** `panel-dag.ts` consumes `graph.ts`; there is one engine, as the ruling
  requires. `dag-layout.ts` never appeared. Good.
- **No duplicated tone table.** `graph.ts` keeps `GRAPH_THEME` and the new surfaces read
  `dag-theme.ts`; I found no second copy of the six glyphs — the one place a second copy would have
  hidden is exactly what `dag-fidelity.test.ts` reads the WEB source to prevent.
- **Aspect 1 — a third tone table is one too many.** `graph.ts GLYPH`/`KIND_ABBREV`/`GRAPH_THEME` and
  `dag-theme.ts DAG_TONE_GLYPH`/`DAG_KIND_ABBREV`/`DAG_TONE_THEME` now hold the same six states twice,
  in the same package. My parity arms currently prove they agree; nothing structural stops them
  drifting. Two tables for one vocabulary is the port's one speculative abstraction.
- **Aspect 2 — panel count vs the host budget.** The host allows `MAX_PANELS_PER_PLUGIN = 4`; the wave
  now registers 3. One more panel makes the fourth registration fail **silently** (`register` returns
  `undefined`). Worth a comment where the panels are registered.

---

## 2b. Two instrument lessons, and one known tolerance

**Lesson 1 — a fixture that cannot fail is not a test.** My first R20 arm computed the served `depth`
with the real `taskDepths` and then reported `rankCount 5` for the WEB view: it measured the PAYLOAD,
not the VIEW, and handed a trusting view a payload that is trivially correct. FINDING 7b.

**Lesson 2 — an instrument that counts CODE POINTS cannot measure a grid laid out in CELLS, and it
fails SILENTLY, in the direction of reporting defects that are not there.** This error class appeared
**twice in one wave**: inside the product as R22 (a wide glyph written through a one-cell cursor, which
cost every boxed CJK line its right border), and inside the instrument measuring the product, when my
`[...line].slice(81)` sliced a 118-cell pane row by code point on exactly the rows whose chat column
carries CJK and reported four phantom border offenders (FINDING 11's retraction). The fix in both places
is the same: measure with `cellWidth` and slice by cell. The repo now keeps
`evidence/tui/dag-port/freeze/measure-frame.mts` so the cell-accurate measurement is not re-derived.

**Known tolerance, NOT a finding.** In the frozen `panel` frame, one row measures 36 cells in my
counter against 37 in the host's, because of `⚪` (U+26AA): my counter treats it as width 1 and so does
the host's `eastAsianWidth(…, { ambiguousAsWide: false })`, but the row was PADDED to 37 by the host's
own composition. It is a one-glyph convention difference on one row, visible in no other frame, and it
is recorded here so a future reader does not rediscover it as a defect.

## 3. The ONE thing I would change first

**Make the panel's reachability an honest, verifiable fact: implement R26 (stop claiming an open the
plugin cannot verify) and make the composed id discoverable, so the enablement step R25 requires can
actually be typed by a user.**

Concretely, in order: (a) `panel.ts PanelSeam.openOrScene` must not route on `opened() === true` alone —
the host's `open` reports the BRIDGE consuming the request while `useSidePanel.openPanel` silently drops
it for an id outside the enable CSV (measured: the frame after `/mpd panel` has no divider, the next
`C-b` frame has one at column 80), so the sentence must say what is known and name the step that makes
the panel visible; (b) make the composed id PREDICTABLE — give the row a Component identity so the host
composes `mpd-tui:<slug>` instead of `act1:<slug>` (`panels.js pluginIdFor` falls back only when the
identity is underivable), because R25 requires the id to be READ from the session and today it is not
guessable; (c) give `skills/dsh-qa/scripts/tui-panels.ts` a PANE-sourced `tuiPanels` surface — it is
`source: "store"` today and reported `tuiPanels=rendered` while no pane showed the tab, which is exactly
how this class passed every gate for a whole wave.

Rationale: R1, R9, R11, R12, R13, R14 and R26 all terminate in "is it on screen and does the ticket say
so". Today the rendering works once the switches are set, and the surfaces still tell the user it opened
when it did not.

## 4. Pre-refactor verification — exact commands and expected outputs

Run from the repository root. `$D` = `evidence/tui/dag-port/verification/20261006T135211Z`.

```bash
# 1. My independent instruments (3 arms red BY DESIGN: R19 ordering + the two R13 arms that
#    were red until the floor was fixed — re-check which are red before "restoring" greenness).
bun test ./packages/mpd-tui-plugin/test/dag-fidelity.test.ts     # expect 27 pass / 1 fail (R19 numeric order)
bun test ./packages/mpd-tui-plugin/test/panel-visibility.test.ts # expect 7 pass / 0 fail
#    Before refactoring EITHER seam, capture the red set:
#    `bun test ./packages/mpd-tui-plugin/test/dag-fidelity.test.ts 2>&1 | tail -3`

# 2. The whole suite — the wave's own red set must not grow (FINDING 5).
bun test ./packages            # FINAL: 1764 pass / 2 fail / 3 skip -> $D/gate-bun-test-final.log
                               # (first sweep: 1704 pass / 9 fail -> $D/gate-bun-test.log)

# 3. Static gates I ran, with their observed verdicts.
bun run typecheck              # PASS (tsgo --noEmit, no output, exit 0) -> gate-typecheck-final.log
bun run verify:rows            # PASS — 33 row ids match the 2-file bundle patch layer
bun run verify:docs            # PASS — pairs=45 failed=0 violations=0 links=439 dead=0
bun run verify:manifest        # PASS — version coherence, 2 patch files, 26 module paths, allowlist
bun run verify:comments        # FINAL PASS; first sweep FAIL with 15 violations across 7 lane files
node scripts/verify-dist-fresh.ts  # FAIL — packages/mpd-tui-plugin/dist/index.js STALE (1 of 29); the
                               # captain also reports mpd-team-core-plugin/dist stale mid-edit (his call)
```

**A gate that must be run BEFORE any of the above is trusted, because it bounds all of them:**

```bash
node scripts/verify-dist-fresh.ts   # measured FAIL: packages/mpd-tui-plugin/dist/index.js STALE
# Rebuild from the repo root, path-qualified (AGENTS.md §6), then RE-RUN the PTY driver:
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm --outfile packages/mpd-tui-plugin/dist/index.js
```
Every PTY capture in this report read a `dist` built at 21:34 while `panel-dag.ts` was last written at
22:09 (`grep -c dagPanel dist/index.js` → **0**), so R1's page body, R9, R11, R12 and R14 are NOT
VERIFIABLE until that rebuild lands and the captures are re-run.

**Expected outputs after the fix, in the same order:** `bun test ./packages` → `0 fail` (the lane red
set of FINDING 5 must be repaired, not silenced); `verify:comments` → `VERDICT: PASS`;
`verify-dist-fresh` → `all 29 targets fresh` after the captain's rebuild from the repo root with
path-qualified args (AGENTS.md §6).

**PTY reproduction, re-runnable:**

```bash
# two isolated sandbox roots, both warm (`.mpd/recon/tui-013` plain fixture, `.mpd/recon/tui-013-fv` CJK)
bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root .mpd/recon/tui-013       # PASS (exit 0)
bun evidence/tui/dag-port/verification/pty/width-panel-capture.ts --self-test   # PASS, 10 arms
bun evidence/tui/dag-port/verification/pty/width-panel-capture.ts \
  --sandbox-root .mpd/recon/tui-013 --widths 200,120,80,48,32 --out $D/../pty/run
# expect: split=true at 200/120 (mpdTab=false -> FINDING 1) ; split=false at 80/48/32 -> FINDING 3
bun evidence/tui/dag-port/verification/one-column-repro.ts --json $D/one-column-repro.json
# expect (post-port): preRepair rankCount 1 (nothing resolves, so nothing to derive)
#                     resolvableFlatZero rankCount 5  <- THE ARM: refs resolve, every depth is 0
#                     resolvableFlatServed rankCount 5 ; live rankCount 5
# PRE-PORT the same command read resolvableFlatZero = 1. That flip is the R20 verdict.
bun skills/dsh-qa/scripts/tui-panels.ts --sandbox-root .mpd/recon/tui-013
# measured: tuiPanels=rendered (STORE-sourced) while no pane shows the tab; tuiRenderers=MISSING
```

**A behaviour-preserving refactor must not change:** any `cellWidth` bound in the arms, the six
glyph/tone mappings, `ranksDerived`/`unresolved` semantics, the `▼`/`▸` markers, the host module
functions quoted in `panel-visibility.test.ts`, and the two per-width frame sets under `pty/run*/`.

---

## 5. Evidence index

| Path | What it is |
|---|---|
| `verification/20261006T135211Z/report.md` | this report |
| `verification/20261006T135211Z/revision-hashes.txt` | sha256 prefix + size per cited file, with the read instant |
| `verification/20261006T135211Z/one-column-repro.json` | R17/R20/R21 reproduction: pre-repair, resolved-flat, live |
| `verification/20261006T135211Z/gate-*.log` | `bun test`, typecheck, comments, rows, docs, manifest, dist-fresh, tui-panels |
| `verification/one-column-repro.ts` | the reproduction script (source) |
| `verification/r21-producer-check.ts` + `20261006T135211Z/r21-producer-check.txt` | the R21 producer check and its output (exit 0) |
| `verification/pty/width-panel-capture.ts` | the PTY driver (repo harness; `--self-test` = 10 arms) |
| `verification/pty/run/w{200,120,105,104,96,80,48,32}/` | plain-fixture frames: `boot`, `panel`, `sidebar`, `tab1..tab3` |
| `verification/pty/run-cjk/w{200,120,80,48,32}/` | CJK-fixture frames (7-task board, real blockers) |
| `verification/pty/run-enabled/w{120,80,48,32}/` | **enabled-sidebar** frames (R25 protocol): the live 12-task board, all six tab frames |
| `verification/pty/run-cjk-enabled/w{120,80,48,32}/` | enabled-sidebar CJK frames at each of the four required widths |
| `verification/pty/run/summary.json`, `run-cjk/summary.json`, `run-enabled/summary.json`, `run-cjk-enabled/summary.json` | per-width verdicts incl. every tab strip seen |

### The build identity of every capture (READ FIRST — see FINDING 1b)

`packages/mpd-tui-plugin/dist/index.js` was **306516 B, built 21:34** while `src/panel-dag.ts` was last
written **22:09** (`grep -c 'dagPanel' dist/index.js` → **0**). The captain then rebuilt (368005 B) and
`verify-dist-fresh` immediately asked for 367817 B, because the lanes were still writing. The agreed
protocol is a **SRC FREEZE → rebuild → message me the sha → capture against it**: until that handshake
completes, every rendering verdict in this report is a statement about the **21:34 build** and the
re-runnable command above reproduces it in one line.

**Enabled-sidebar results (all four required widths, both fixtures):** at 120 cols `split=true` and the
tab strip carries `≡ ▸ ◆ ‹ MPD › D W`, `‹ Dag ›`, `‹ Workmate ›`; at 80/48/32 `split=false` — no sidebar
at all, the host's own 93-column floor (FINDING 3), so `mpdTab=false` there is the HOST refusing a split,
not our panel failing to register.
