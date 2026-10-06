# Requirements — WEB dependency-DAG port to the MPD TUI surfaces

Status: **FROZEN by the requirements conference** (captain + user, single consolidated batch).
This file is the input to the wave's staged plan. Every task's acceptance is a clause here.

## User's verbatim decisions

| Question | User's answer |
|---|---|
| Port fidelity / orientation | **纵向，但不要固定尺寸** — vertical rank (top→bottom), and **no fixed sizes**: geometry adapts to the measured panel |
| Sidebar page shape | **workmate 也加上去（独立 panel）**; and the existing `team` panel **可能不太可见，我调的时候没看到，你得 docker 实机验一下确保没问题** |
| Interaction | **都要，hover 可以没有，你保留点击的就行** — keep click-to-pin + keyboard; hover is NOT required |
| Visual features | **ALL of them** (bordered node boxes + panel frame; WEB-aligned six-state TONE palette; header + footer + explicit legend; progress bars; `useAnimationTime` running animation; panel badge + 1-cell icon; empty / cycle / failed-dependency states) |
| Polish scope | **C. 全面重设计整个 mpd-tui 表面层（panel + 全部 scene + 状态行）** |
| Acceptance | **都得测，不过几何那边…不能固定尺寸，你锁字符可能不太好** — all of it is tested, but geometry tests must assert INVARIANTS, not byte-frozen grids |
| Team shape | **同意，按此组队** (the 8-member on-the-spot roster below) |

## Acceptance criteria (binding)

- **R1 · Independent DAG page.** A NEW sidebar panel `dag` is registered through `mpd-tui-adapter`
  and is reachable in the host's panel UI. It renders the current workspace's team dependency DAG.
- **R2 · Adaptive vertical geometry.** Rank is the VERTICAL axis (top→bottom). Node width/height,
  gaps, insets and column count are COMPUTED from the measured panel width/height — **no fixed pixel
  or cell constants as the layout rule**. The port is of the WEB version's *semantics and visual
  language*, not of its pixel geometry (`GEO.column = 168px` etc. must NOT be transplanted as sizes).
- **R3 · WEB-parity node content.** Each node carries: status glyph, task id, `kind` abbreviation,
  and the subject, with the WEB `TONE`/`GLYPH` tables as the semantic source of truth
  (completed ✓ / running ◐ / failed ✗ / blocked ○ / cancelled ⊘ / open ○).
- **R4 · WEB-parity edges.** One drawn edge per `blockedBy` entry, orthogonal routing, per-source
  lane separation so a fan-in stays readable, and the existing TUI `▼` entry marker preserved.
- **R5 · Six-state TONE palette** mapped to host theme keys, one key per WEB tone, declared as data
  (one table), never as scattered literals.
- **R6 · Chrome.** Bordered node boxes AND a bordered panel frame with a border title; a header row,
  a footer key-hint row, and an **explicit legend** (the WEB DAG has none, and `blocked`/`open`
  share the glyph `○` — the legend is what disambiguates them).
- **R7 · Progress / completion stats** wired to a real caller — the already-written but currently
  UNREACHABLE `layoutList` must gain one, or be explicitly superseded and deleted.
- **R8 · Running-state animation** via `ui.useAnimationTime`, degrading to a static frame when the
  host offers no timer. Must be verified on a real PTY before it is claimed.
- **R9 · Panel badge + 1-cell icon** reflecting team state (`info`/`warning`/`error` levels).
- **R10 · Explicit special states**: empty state naming the call that fills it, dependency CYCLE,
  and failed blockers reported BESIDE the state (`failedBy`) — never folded into `blocked`
  (OPT-1, user decision 2026-09-13; see `graph.ts` header).
- **R11 · Interaction**: click-to-pin detail body + keyboard focus movement and pin/unpin. Hover is
  NOT required. Pinned detail body carries id/kind/visual/verdict/failedBy/owner/attempt/round/
  blocked-by/dependents.
- **R12 · Workmate page.** The workmate library gets its own INDEPENDENT sidebar panel.
- **R13 · The invisible-panel defect is ROOT-CAUSED and fixed.** The existing `team` panel was not
  visible to the user. Root cause it against the installed host's side-panel enablement rules
  (`DEFAULT_SIDE_PANEL_IDS`, the display-prefs `panels` CSV, `defaultEnabled`, `mountPolicy`) and fix
  it — or, where the host owns the switch, ship the one-command remedy AND document it. Proven on a
  real PTY, then on a real machine.
- **R14 · Whole-surface redesign**: panels + every scene + the status line share one visual system.
- **R15 · Tests**: unit + invariant/golden geometry tests + real-PTY captures. Geometry assertions
  are INVARIANT-shaped (relative ranks, monotonicity, containment, edge-endpoint membership) —
  NOT byte-frozen grids, and NOT fixed sizes.
- **R16 · Evidence**: `evidence/<domain>/<slug>/<timestamp>/` records for every claim, plus a real
  Docker machine run proving panel visibility.

## AMENDMENT 2 (2026-10-06 ~13:57Z) — the user found the WEB DAG itself is broken

The user, looking at the live WEB GUI: *"有前置依赖的怎么和没前置的在一列？这依赖关系怎么表示的？这块参考
https://github.com/NanmiCoder/dsh-agent-teams 人家项目的依赖DAG图做，这是个什么东西，TUI也不能有这种问题"*.

### Measured root cause (three independent faults, all verified in code)

1. **The board's blocker references never resolved.** `team-store.ts resolveBlocker` resolves a staged
   plan's blocker reference by exact task ID or exact task SUBJECT and otherwise **returns it
   unchanged**; `plan-store.ts` stores `blockedBy` verbatim. Our own team record
   `.mpd/team/teams/team-20261006135108.json` holds ids `T1..T10` with `blockedBy` values `["2"]`,
   `["2","3","4","6"]`, `["7"]`, … — neither ids nor subjects. The captain wrote those refs as
   indices; that was a captain error, and the tool accepted it without complaint.
2. **A dangling blocker is silently deleted.** `team-store.ts taskDepths` does
   `[...task.blockedBy].filter((candidate) => byId.has(candidate))`. Every unresolvable reference is
   dropped, every task becomes a root, every `depth` becomes 0.
3. **The WEB view then trusts that zero.** `team-view.ts` reads
   `Number.isFinite(task.depth) && task.depth >= 0 ? task.depth : 0` and never re-derives. So one
   column is drawn, no edge is drawn, and nothing anywhere says a word.

Each fault alone is survivable; together they produce a DAG that SILENTLY LIES about the dependency
structure — which is the single most important thing a DAG exists to show.

### New acceptance criteria

- **R17 · Rank is DERIVED, never trusted.** Every DAG surface (TUI and WEB) computes rank itself as
  the longest path over the blockers that RESOLVE on the board. A served `depth` may be used as a
  hint at most. A board whose served depths are all 0 while its dependency graph is not flat must
  still draw the real ranks. Asserted by a fixture modelled on the measured broken board.
- **R18 · An unresolved blocker is a VISIBLE FACT.** A reference that resolves to no task on the board
  is surfaced (a count and the offending ids) rather than silently dropped. Silent data loss is what
  produced this defect; it must not be reproduced one layer down.
- **R19 · Adopt the reference model (`NanmiCoder/dsh-agent-teams`, cloned read-only to
  `.qa-tmp/dsh-agent-teams-ref`).** Its `lib/state.js taskDepthsById` recomputes depth from
  `task.dependencies` at render time — the structural reason it cannot develop fault 3; its
  `lib/client/activity-model.js compactDagLayout`/`taskStages` place one column per depth with tasks
  in NUMERIC TASK-ID order inside a column; its header states the reading direction
  ("从左到右：完成前置后解锁"); its detail pane names what the focused task UNLOCKS, not only what blocks
  it; and its focus precedence is `pinned > keyboard > hover`. Adopt all five.
  Its edges are cubic Béziers — a TERMINAL draws orthogonal box-drawing edges instead (a terminal has
  no curves); that one divergence is deliberate and stays.
- **R20 · The WEB DAG is fixed too.** It is the surface the user was looking at, and the reference for
  the port. `task-view.ts`/`team-view.ts` must derive rank from the graph exactly as R17 requires.
- **R21 · The data plane stops lying.** A staged plan's blocker reference that resolves to no task is
  a REPORTED condition at approval time (warn, or reject), not a silent flattening. Where the plan's
  reference form is a subject, that must be documented where a captain writes it.

### Captain's immediate action

The captain repairs the live team record's `blockedBy` to real ids so the user's current WEB view is
correct, and records that repair as evidence. The repair is a workaround for the live board, NOT a
substitute for R21.

## AMENDMENT 3 (2026-10-06 ~14:00Z) — the frozen layout contract is RETIRED

**`packages/mpd-tui-plugin/src/dag-layout.ts` is DROPPED, and with it the frozen
`layoutDag`/`DagView` signature.** `dist/panel-dag.ts` had already landed consuming the EXISTING
`src/graph.ts` engine (`layoutBoxes` / `layoutRail` / `layoutList`) — a decision the captain BLESSES:
it takes the previously-unreachable `layoutList` (progress bars) into the shipping path, it reuses a
working tested engine instead of standing a second one beside it (AGENTS.md §2.6 minimal diffs), and
`visual-reviewer` flagged a second engine as exactly the over-engineering this repo forbids.

**`packages/mpd-tui-plugin/src/graph.ts` becomes the ONE drawing engine** and gains, as its owner's
work items:

- **R17 · rank DERIVED from `dependencies`**, never trusted from a served `depth`. Fixture: ids
  `T1..T12`, blockers `[["T2"],["T2","T3","T4","T6"],["T7"],["T2","T3","T4","T5","T6"],["T7","T8","T9"]]`,
  every `depth: 0` — it must NOT collapse to one rank.
- **R18 · an `unresolved` list** for blocker references that name no task on the board.
- **R22 · the CJK cell bug.** `label(top+1, cursor, char, at); cursor += cellWidth(char)` writes ONE
  grid slot per char while advancing TWO cells per wide char, so every intervening slot stays
  background and a boxed line loses its RIGHT BORDER. Measured verbatim at 120 cols:
  `│ ✓ T1 WRK 冻 结 验 收 契 约      ` (no closing `│`) against a control that closes at col 33.
  Reproduces at 120/80/48/32 and with a SINGLE wide char. The regression test must assert a boxed
  line ENDS ON ITS BORDER COLUMN — a `cellWidth <= cols` assertion alone cannot catch this class.
- **R23 · the 32-column floor must be true.** `DAG_PANEL_MIN_COLUMNS = 32` is promised, but
  `fanin @32` degrades to `rail` (honest) while `chain`/`cjk @32` stay in `boxes` and CLIP.

`graph.ts` ownership: **`dag-geometry`**. `scenes.ts` / `subagent-scene.ts` / `status.ts` /
`renderers.ts` consume it and are `tui-visuals`'. Interface changes are EXTEND-only; a reshape must be
raised with the captain first.

## AMENDMENT 4 (2026-10-06 ~14:03Z) — the WEB DAG's edges are illegible

The user, screenshot in hand, after the board repair: *"你看看你这个依赖关系连线，根本看不清啊，优化一下这个连线吧"*.
The repair worked (5 real columns appeared); what is unreadable is the ROUTING.

**Measured cause, in `team-view.ts edgeOf` — two compounding defects, neither cosmetic:**

1. **A multi-rank edge routes its riser THROUGH an intermediate column.** `edgeOf` derives
   `gapLeft`/`gapRight` from the two BOX BORDERS and treats that span as "the band the riser lives
   in". That is a real band only when parent and child sit in ADJACENT ranks. For a rank-skipping edge
   the span covers the whole intermediate column, so `bandCentre` lands in the MIDDLE OF THAT COLUMN
   and the riser runs vertically through the intermediate rank's boxes. On our board most edges skip
   (`T7 ← {T2,T3,T4,T6}` makes `T2→T7` a rank-0 → rank-2 edge).
2. **The edge layer is painted ON TOP of the boxes.** The render composes `[…columns…, edgeLayer]`
   with the edge layer LAST, so a mis-routed line is drawn over a node rather than behind it. There is
   no z-order safety net.

**Why several edges also read as ONE thick line:** `CSS.node` is `left:4px; right:4px` inside a 168px
column, so the gutter between adjacent boxes is **8px total**, while the lanes are `0,+3,-3,+6,-6`
clamped into it — three edges leaving one column collapse onto the same 1–2 pixel positions.

**New acceptance criterion**

- **R24 · No drawn edge may intersect a node box.** Routed as a layered graph:
  (a) **dummy nodes** — every edge spanning more than one rank expands into a chain of adjacent-rank
  hops through a reserved virtual row in each intermediate rank, so a riser always stands in a real
  gutter and a horizontal run always travels in a row no box occupies;
  (b) the inter-column **gutter is wide enough for the lanes actually needed**, and lane spacing is
  computed from the measured gutter so lanes cannot silently collapse (a lane that cannot be placed
  distinctly is REPORTED, not stacked);
  (c) **edges are painted behind the boxes**, as a safety net independent of (a);
  (d) a **direction marker at the arrival** — the WEB view draws no arrowhead, so with a fan-in there
  is no way to read which way the dependency runs (the TUI already keeps a `▼` for exactly this).

  Proven by the geometric invariant **no edge segment's rectangle intersects any node box rectangle**,
  over the real 12-task/5-rank board that fails today. Note this is the WEB plane; the TUI's `boxes`
  routing already satisfies the invariant (`visual-reviewer` measured a 2-rank edge routing down gap
  rows 9–11 without overpainting).

## AMENDMENT 5 (2026-10-06 ~14:07Z) — R13 ROOT-CAUSED: the panel was never IN THE TAB STRIP

This is the answer to the user's original *"目前 team 这个，可能不太可见，我调的时候没看到"*. The panel did not
fail to register — **it was never enabled, and the command that claimed it opened was lying.**

**The chain, verified by the captain against the INSTALLED host sources (not taken on report):**

1. The tab strip paints **only ids present in the host's live enable CSV** —
   `components/sidePanel/SidePanelColumn.js` `const tabs = controller.enabledPanelIds.map(…)`, with
   `enabledPanelIds = parseSidePanelIds(panelsCsv)` in `components/sidePanel/useSidePanel.js`, and the
   CSV defaulting to `todo,jobs,agents` (`tuiDisplayPrefs.js DEFAULT_SIDE_PANEL_IDS`).
2. The host **does** auto-enable a plugin panel at registration — `dsh-adapter/panels.js register()`
   calls `enablePanelIdInStore(finalId)` ("注册即可见") — **but the display mirror then overwrites that
   CSV** from a concrete config value: `dsh-adapter/plugin.js` `applySidePanelPanels(config.sidePanel?.panels)`
   at boot and `applySidePanelPanels(value.sidePanel?.panels ?? config.sidePanel?.panels)` when the
   async settings arrive. The plugin's freshly appended id is gone before the bar paints.
   **This is a host defect: it auto-enables a registered panel and immediately discards it.**
3. The sidebar also starts **closed** (`sidePanel.open` default false).
4. **`/mpd panel` is a FALSE GREEN.** `tuiPanels.open(id)` returns a bridge request that is TRUE
   whenever a live Chat consumer is attached, while `useSidePanel.js` DROPS the request for an id not
   in the enabled set (`if (!parseSidePanelIds(getSidePanelPanels()).includes(id)) …`). The plugin
   therefore printed "已打开" while nothing appeared — **the user was told a surface opened that could
   not open.** This is the single worst UX fact in the wave: it makes a working feature look broken and
   hides a real cause behind a success message.

**Remedy, PROVEN on a real PTY (tmux, sandboxed profile):** set the host's own two switches —
`dsh-tui.sidePanel.panels = todo,jobs,agents,<activationId>:<slug>` and `dsh-tui.sidePanel.open = true`.
Measured: boot bar gains a 4th tab, `/panel <id>` renders the panel (DAG rows, legend, sections).

**The bundle CANNOT flip either switch.** They are host-owned row config, and a patch row may never
id-target a host-owned row (AGENTS.md §6, `verify-no-host-override.ts`). Writing the CSV through host
internals was evaluated and REJECTED: it would add a contact site and would fight the user's own
settings on every settings change. The honest deliverable is therefore a documented one-time step,
not a silent fix.

### New acceptance criteria

- **R25 · Acceptance must enable the switches.** Any PTY or Docker acceptance of the `team`, `dag` or
  `workmate` page MUST first set `sidePanel.panels` to include the page's REAL composed id and
  `sidePanel.open = true`. A panel that registers correctly but is not enabled is **neither a pass nor
  a lane failure** — the acceptance step is what was wrong. The composed id is dynamic
  (`<actN>:<slug>`; `act1` when a plain loader row carries no Component identity), so it must be READ
  from the session (the host's `/panel ` completion, or `/mpd panel`), never hard-coded in a doc.
- **R26 · No surface may claim a success it cannot verify.** `/mpd panel` and every related sentence
  must stop asserting that a panel opened when the request may have been dropped. It must say what it
  actually knows and name the step that would make the panel visible.
- **R27 · The remedy is documented where a user will look**, including how to discover the composed id.
  The host defect in (2) is recorded for an upstream report.

## AMENDMENT 6 (2026-10-06 ~14:12Z) — independent verification: what PASSES, and the R1 blocker

`fidelity-verifier` ran an ENABLED real-PTY boot (`.mpd/recon/tui-013-en`, 120 cols, the switches per
R25) and measured both halves. Recorded here because these are the first PTY-verified facts of the wave.

**PASSES (someone other than the author measured these):**
- **R4 / R6 / R17** — the `MPD` page paints **36 body rows**: `task dependency graph (rail)`,
  `○ T1 WRK …`, `└─▸ ○ T11 FIX …`, `├─▸ ○ T9`, nested `│ └─▸ ○ T8`, and the legend row
  `▼/▸ blocker → dependent · ▶ focus`. Derivation is VISIBLE (T11 under T2, T6 under T3, T8/T10/T9/T12
  deeper). Five tab strips observed, including `≡ ▸ ◆ M ‹ Dag › W` and `≡ ▸ ◆ M D ‹ Workmate ›`.
- **R25 confirmed** — default config at the same revision/width shows only `‹ 待办 › ▸ ◆` + jobs +
  agents (`mpdTab=false`); with the switches, `mpdTab=TRUE`.
- **R20** — the WEB `layout` derives: references RESOLVED with every served `depth: 0` → `rankCount 5`
  (was **1**); live repaired board → `rankCount 5`.
- **R22** — every node's top border, sliced BY CELL, is exactly `colEnd+1` wide, starts `┌` ends `┐`,
  at 48/64/80/120/200 on an all-CJK board. (A code-point slice reports 4 phantom mismatches — that is
  the exact mistake the original bug hid behind.)
- **R23** — at 31/32/33 cols `chain` stays `boxes` with 0 overflowing rows; `cjk`/`fanin` degrade to `rail`.
- **R24** — junctions sit ON a box's border row; the `▼` is one row above the child's border.
- Gates: `verify:rows` PASS · `verify:docs` PASS (pairs=45, dead=0) · `verify:manifest` PASS ·
  `typecheck` PASS (0 errors).

**OPEN — ~~R1 IS A BLOCKER~~ WITHDRAWN — IT WAS A STALE-DIST ARTEFACT, NOT A FINDING.**
`fidelity-verifier` reported "the `dag` page paints 0 body rows" and then **falsified its own finding**:
`packages/mpd-tui-plugin/dist/index.js` is 306516 B stamped **21:34**, while
`packages/mpd-tui-plugin/src/panel-dag.ts` is 47805 B stamped **22:09**; `grep -c 'dagPanel'` is **0** in
that dist and 4 in the source. The captured build **predates the page entirely** — it carries an earlier
registration whose body is empty. `verify-dist-fresh` says the same thing. So the empty body proves
nothing about the source. Withdrawn, and replaced by the bound below.

**THE BOUND — every PTY capture in this wave reads the 21:34 dist.**
- VERIFIED for that build and that build ONLY: the R4 rail edges (`└─▸ ○ T11`, `├─▸ ○ T9`, nested
  `│ └─▸ ○ T8`), the R6 legend row, the R17 derivation visible as a real hierarchy, the R25 enable
  switches, and the R13 root cause.
- **NOT verifiable for any source edit after 21:34: R1's page body, R9's badge, R11's detail body,
  R12's workmate body, R14's redesign.** Those need a rebuild followed by a re-capture.
- This is the wave's most transferable lesson: **a PTY capture is evidence about a BUILD, never about a
  SOURCE TREE.** A stale `dist/` makes every rendering verdict simultaneously true-of-the-old-build and
  false-of-the-current-code, and neither the capture nor the reader can tell. The rebuild is the
  captain's (derived surface), and a capture taken before it is not a result.

**Also open:** R19 (numeric task-id ordering within a rank) is met by NEITHER plane — both draw
`T10, T2, T1, T3, T20` for a scrambled board; R26 still unimplemented (`i18n.ts panel.opened` still
reads `已打开（{id}）`, and `panel.ts PanelSeam.openOrScene` still routes on `opened() === true` alone);
R21 producer untouched (the one-column collapse reproduces end-to-end, `rankCount 1`);
`verify:comments` 15 · `verify-dist-fresh` 1 stale (captain's).

**Captain call (documented):** the live record's T6 went `["2"]` → `["T3"]` where a mechanical
`position N → id T<N>` mapping implies `["T2"]`. Deliberate: the wiring task's real dependency was always
the PANELS task. Rank is unaffected (both are roots). Recorded as a captain call inside an already
provisional repair — a repair can be wrong even when its mapping is right.

## AMENDMENT 7 (2026-10-06 ~14:18Z) — `tui-visuals` complete; a silent frame-title defect found and confirmed

**`tui-visuals` finished all four surfaces** (`subagent-scene.ts`, `scenes.ts`, `status.ts`,
`renderers.ts`) plus `test/scene-visuals.test.ts` (23 arms, 0 fail). Every exported name and signature
is unchanged — verified by grep on the tree, which is the constraint that mattered because
`panel.ts`/`panel-dag.ts` import `subagentSectionRows`/`teamGraphView` and `index.ts` imports the scene
ids/titles. It built no second renderer: tone→theme key, glyphs, the toned text row and the legend all
come from `panel-core.ts` + the frozen `dag-theme` tables, so the full-screen legend and the page legend
are ONE legend.

- **R28 · A frame title must use the host's OBJECT form.** `tui-visuals` reported that
  `panel-core.ts:412` passes `borderText: panelText(title, 80)` — a BARE STRING — and the captain
  CONFIRMED it against the host: `lib/types/ink/render-border.js` reads
  `node.style.borderText?.position === 'top'` and then `borderText.content`; a string satisfies neither,
  so the `else if` branch draws a PLAIN border and **the title is silently dropped**.
  `subagent-scene.ts:399/433` uses the correct form
  (`{ content: safeRow(title), position: "top", align: "start" }`). Had it shipped, every panel frame
  would render title-less on a real terminal — an unlabelled box in a sidebar whose native siblings are
  all titled, which is precisely the class of defect this wave exists to remove. **No unit test catches
  it, because an assertion on the props object sees `borderText` PRESENT and stops.** The regression
  test must therefore assert the SHAPE, not the presence.
- **Captain ruling — the legend keeps TWO key groups.** `tui-visuals` asked whether to unify
  `legend-<i>` (the drawing's lines, pinned by existing suites) with `state-key-<i>` (the contract's
  appended six-state key) by amending `test/subagent-scene.test.ts`. **No.** A React `key` is internal
  and invisible; the user-visible output is already ONE legend because both groups come from
  `legendLinesFor`. Amending another lane's pinned test for a cosmetic key change trades a real
  interface for a non-difference. The two groups are to be DOCUMENTED in place instead.

**Gate status at this revision** — `tsgo --noEmit -p tsconfig.json` **0 errors**;
`verify:comments` **PASS** (404 files scanned, 33728 declarations, "every declaration in the family
carries a precise comment and a full signature") — the 15 violations are CLOSED and both standing gates
are green; `verify-dist-fresh` STALE on 2 of 29 (`mpd-tui-plugin`, and `mpd-team-core-plugin` because
the R21 producer is mid-edit) — both the captain's, both to be rebuilt at the freeze.

## AMENDMENT 8 (2026-10-06 ~14:26Z) — FINDING 11: phantom mechanism, REAL defect, and the wave's best lesson

**The stated mechanism is WITHDRAWN.** "The frame's right border lands on the wrong column" was an
INSTRUMENT ARTEFACT. `fidelity-verifier` found it first — it had sliced the sidebar out with a
**code-point** slice (`[...line].slice(81)`) while the chat column on those rows carries CJK, so the
slice drifted left by one cell per wide glyph and the borders only *appeared* misaligned on exactly the
rows whose neighbour column held wide characters. **The captain then reproduced the measurement
independently** (`evidence/tui/dag-port/freeze/measure-frame.mts`, kept so nobody repeats it), and the
interim build is a clean rectangle too: left border at cell 81, right at cell 117, **on all 40+ rows**
of a 118-cell frame.

**BUT THE DEFECT WAS REAL — only its mechanism was wrong.** Diffing the rail region between the two
builds:

| build | rail rows for 7 tasks | shape |
|---|---|---|
| INTERIM 368005 B | **14** | fragments interleaved: `│ v`, `│visual-reviewer`, `│ r`, `│docs`, `│seam-guard` |
| FROZEN 368228 B | **7** | one row per task, assignee INLINE |

**The rail exceeded the frame interior and wrapped**, doubling the page's row count and scattering
one-word fragments down the panel — a real, user-visible legibility defect, and the one originally
reported before it was mis-attributed to the border column. `panelContentWidth(cols) = max(1, cols - 2)`,
applied to every drawing call and every row clamp, is therefore **vindicated on a real basis**, not on a
phantom one.

**THE WAVE'S MOST TRANSFERABLE LESSON — the same error class appeared TWICE.** Code-point versus cell
first appeared **inside the product** (the CJK border loss, R22: `cursor += cellWidth(char)` writing one
grid slot). It then appeared **inside the instrument measuring the product** (the slice above). An
instrument that counts code points cannot measure a grid laid out in cells, **and it fails silently in
the direction of reporting defects that are not there** — which costs a lane's effort and, worse,
threatens to put a fiction in the PR body. Two independent retractions were needed to catch it.

**Known instrument tolerance, recorded so it is not rediscovered as a finding:** `panel` row 6 measures
36 cells in the verifier's counter because of `⚪` (U+26AA), an ambiguous-width convention difference
against the host's `stringWidth`, on one glyph on one row. Not a defect.

## Non-goals

- ~~Web-plane changes: the WEB DAG itself is the REFERENCE and must not be modified.~~
  **SUPERSEDED (2026-10-06) by the `dag-edges-scroll` wave**, whose captain-amended contract is
  `evidence/dag/dag-edges-scroll/requirements.md`. The user explicitly instructed a change to the WEB
  DAG's own edge rendering (*"优化WEB界面的依赖DAG的连线渲染…可以用曲线"*), so the WEB DAG stops being a
  frozen reference for that wave. This non-goal bounded THIS wave (`tui-dag-port`) and still describes
  what this wave did; it no longer binds anything that comes after it.
- Porting browser-only behaviours: hover, pixel hairlines, CSS ellipsis, `overflow:auto`, native
  tooltips, DOM reads, `fetch` polling.
- Any change to the retired vendored `mpd-agent-teams-plugin` body.

## Frozen interfaces (captain-owned, so writers never share a file)

Written by the captain in `packages/mpd-tui-plugin/src/dag-theme.ts` BEFORE any lane starts:

```
export type DagTone = "completed"|"running"|"failed"|"blocked"|"cancelled"|"open"|"focus"|"dim"|"edge"|"chain"|"blank"
export const DAG_TONE_THEME: Readonly<Record<DagTone, string>>   // -> host theme key
export const DAG_TONE_GLYPH: Readonly<Record<...>>              // -> status glyph
export const DAG_KIND_ABBREV: Readonly<Record<string, string>>
export const DAG_CHROME: { ... }                                 // border styles, markers, caps
```

Layout contract (owned by `dag-geometry`, consumed read-only by `panel-surface`):

```
layoutDag(tasks: readonly DagTask[], opts: { cols: number; rows?: number; focus?: string })
  => DagView { lines: DagSpan[][]; hits: DagHit[]; width: number; height: number;
               mode: "boxes"|"rail"|"list"; cycles: string[]; focus?: string; chain: string[] }
```

## Write-scope partition (one writer per file — AGENTS.md §5)

| Member | Files it may write |
|---|---|
| captain (Lead) | `src/dag-theme.ts`, `evidence/**`, `packages/*/dist/**`, `dist/mpd-package/**`, git |
| `dag-geometry` | `src/dag-layout.ts`, `test/dag-layout.test.ts` |
| `panel-surface` | `src/panel-dag.ts`, `src/panel-workmate.ts`, `src/panel.ts`, `test/panel-dag.test.ts` |
| `tui-visuals` | `src/scenes.ts`, `src/subagent-scene.ts`, `src/status.ts`, `src/renderers.ts`, `test/scene-visuals.test.ts` |
| `seam-guard` | `src/index.ts`, `src/registration.ts`, `src/types.ts`, `src/commands.ts`, `src/command-trees.ts`, `src/shortcuts.ts`, `src/dashboard-key.ts`, `packages/mpd-tui-adapter-plugin/src/index.ts` (only if unavoidable) |
| `fidelity-verifier` | `test/dag-fidelity.test.ts`, `test/panel-visibility.test.ts` |
| `visual-reviewer` | `evidence/tui/dag-port/visual/**` (findings only; read-only by roster guard) |
| `doc-scribe` | `packages/mpd-tui-plugin/README.md` + `.zh-CN.md`, `packages/mpd-tui-adapter-plugin/README.md` + `.zh-CN.md`, `docs/tui.md` + `docs/tui.zh-CN.md` |

**ONE git writer**: the captain. Members NEVER run `commit`/`add`/`checkout`/`switch`/`reset`/
`stash`/`merge`/`branch`/`rebase`/`tag` (AGENTS.md §5). Members edit files, run gates, write evidence.
