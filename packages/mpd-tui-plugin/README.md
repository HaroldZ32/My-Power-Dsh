# mpd-tui — DSH-TUI surfaces for `@mpd-dsh/mpd`

[中文](./README.zh-CN.md)

`packages/mpd-tui-plugin` gives the `@mpd-dsh/mpd` bundle a TUI-native face. It
is a single Cordis plugin row (`mpd-tui`) whose module specifier is owned by the
bundle patch:

```text
@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js
```

There is **no `cordis.patch.yml` inside this package on purpose**: the bundle
patch (`cordis.patch.yml`) owns the row, and a second mount
would duplicate a loader entry id (the loader rejects duplicates outright).

## What it provides

| Seam | Host service | What the user gets |
|---|---|---|
| Status line | `ctx.tuiStatus` | one keyed `mpd` contribution above the prompt: `mpd: team … · boulder … · plans … · workmates …` |
| Transcript renderers | `ctx.tuiRenderers` | the bundle's log-only session events (`agent-teams/*`, `mpd-tui/board-opened`) as plain text rows, live and on replay |
| Settings section | `ctx.tuiSettingsSections` | the mpd.jsonc knobs — the original 13 plus the twelve `teamModels` slot leaves (25 in all), the slot leaves rendered as **catalog-driven selections** — declared as editable `/settings` fields, **bridged** to `<workspace>/.mpd/mpd.jsonc` (a save writes the file; the plugin behaviour needs a restart); every field hint says so on screen (see NOT CLAIMED #2) |
| Full-screen board | `ctx.tuiScenes` | team + task ledger, boulder work ledger, plans, workmate library; two extra rows for a routed team: `team-plan …` (staged only) and `team-hold held (…)` (only while a watchdog hold lasts) |
| Team workflow scene | `ctx.tuiScenes` | `mpd-tui-team` — open with `/mpd team`, or `a` while the board is open: team id/name/phase, plan-review state, the watchdog hold, the roster (role/model/status/progress/current task) and the task DAG (kind/status/assignee/attempt/round/verdict/deps, depth-indented, `failed-dep=` marked) plus the mailbox tail |
| Plan scene (approval, W6) | `ctx.tuiScenes` | `mpd-tui-plan` — open with `/mpd plan`. It renders the live board and carries the approval gate: type the EXACT phrase the pane shows (`approve plan-…`, served by the SAME projection the Web panel renders) and press `Ctrl+X`; `Ctrl+D` twice within 10 s discards the staged plan, `Ctrl+R` re-reads, `esc` goes back. The action is an `agent_teams_plan {action:"approve"\|"delete"}` call carrying the LIVE agent resolved from the adapter's own registry — a caller it cannot resolve is refused loudly, never fabricated (below) |
| Command tree | `ctx.tuiCommandTrees` | `/mpd board`, `/mpd team`, `/mpd plan`, `/mpd status`, `/mpd panel`, `/mpd dag`, `/mpd workmate`, `/mpd workmates` completion, plus the `/mpd-model` root — both roots and every child carry BOTH languages in `descriptions`, resolved by the host with its own active `/lang` |
| Model menu (R3) | `ctx.tuiDialogs` + the shared catalog/settings seam | **`/mpd-model`** — a real pick-list that walks slot → provider → model → reasoning effort and writes the picked route into the `mpd-config` entry the `/settings` section edits. The options are the section's OWN projection (`teamModelOptionLists`) over the same live catalog, so the menu and the rows cannot disagree; the outcome carries the same disclosure sentence the section carries. Cancelling any panel writes nothing |
| Shortcuts | `ctx.tuiShortcuts` | `alt+m` board · `alt+a` the subagents + team panel · `alt+t` team workflow · `alt+w` workmate picker · `alt+r` refresh the status line |
| Sidebar pages (dsh-tui 0.13.0) | `ctx.tuiPanels` (through the adapter) | THREE pages — `team` (`MPD`, `order` 10, the merged view), `dag` (`MPD DAG`, `◈`, `order` 11) and `workmate` (`MPD workmate`, `◆`, `order` 12); all `minColumns` 28 and no `compact`. `alt+a` / `/mpd panel` route to the merged view through `tuiPanels.open()` when the seam is bound; `/mpd dag` and `/mpd workmate` route to their own pages. EVERY refusal FALLS BACK to that page's full-screen scene (`mpd-tui-subagents` for `team`/`dag`, the board for `workmate`) — never a silent no-op — and each command prints a bilingual status line naming the surface and the final id it reached. See the reachability paragraph below: the host's own two switches are what put a page on screen |
| Merged panel | `ctx.tuiScenes` | `mpd-tui-subagents` — the host's own subagent rows (with its running/completed/failed counts), the team body, and the task DAG whose every drawn edge ends in a directional `▼` with a legend under it: this is the FALLBACK surface — `alt+a` and `/mpd panel` land here when the host has no panel seam or refuses the open — and on a pre-0.13.0 host **`Ctrl+A`** reaches it whenever the workspace holds a team (the take-over below). `enter` opens the selected subagent's detail, `i` interrupts the selected live run, a click selects a row |
| `Ctrl+A` take-over | a `ctx.tuiStatus` view + the adapter's host-input contact | `Ctrl+A` opens the merged panel instead of the host's own dashboard while the team projection holds a team with at least one task; with no team — or on a host whose input bus the adapter cannot reach — the key behaves exactly as before (`tui.dashboardKey`, default `true`; see NOT CLAIMED 7-9) |
| Dialogs | `ctx.tuiDialogs` | the mediated workmate picker (`select`) |
| Decision events | `tuiPluginHost.subscribeDecision` | attempted, expected to be refused, **not activated** (see below) |

Supporting surfaces (not one of the seven seams): the `/mpd` command on the
harness command registry, the `mpd` settings namespace registration, and the
log-only `mpd-tui/board-opened` session record.

### Three sidebar pages (dsh-tui 0.13.0): the merged view, the DAG and the workmate shelf

The bundle contributes **three** pages through the host's `tuiPanels` seam, each with its own FROZEN
descriptor (`*_DESCRIPTOR_FROZEN` at module scope) and each inside the host's own
`MAX_PANELS_PER_PLUGIN = 4` budget:

| Module | slug (the host prefixes it with the activation's plugin id) | title | icon | `order` | `minColumns` |
|---|---|---|---|---|---|
| `src/panel.ts` | `team` | `MPD` | — | 10 | 28 |
| `src/panel-dag.ts` | `dag` | `MPD DAG` | `◈` | 11 | 28 |
| `src/panel-workmate.ts` | `workmate` | `MPD workmate` | `◆` | 12 | 28 |

Every page is `apiVersion` 1 (the only value 0.13.0 accepts) and declares **no `compact`**: 0.13.0
validates and stores that row slot but does not mount its render slot, so declaring one would claim a
surface the host never draws.

**ALL THREE ASK FOR `minColumns` 28 — the host's own floor — and that number is the fix for the defect
that made the old panel invisible.** The host's `components/sidePanel/PanelHost.js` computes
`tooNarrow = def.minColumns !== undefined && width < def.minColumns` and renders a `panel-too-narrow`
notice **instead of** the page's body, while `components/sidePanel/dimensions.js` puts the panel column
at exactly its own `PANEL_MIN_COLUMNS = 28` at the split threshold. The previous descriptor asked the
host for 32, which created a band of terminal widths in which the sidebar opened, the tab existed, and
the user was shown a refusal notice rather than the team graph. The host's descriptor validator accepts
32 happily, so nothing reddened at registration; only a width-band test catches this class. Readability
at 28 columns is the PAGE's own job (the DAG page picks `boxes`/`rail`/`list` from the width it is
actually given), never a demand that the host widen the column.

The registration is safe on every host build: the apply-time `registerPanel(...)` is QUEUED by the
adapter's deferred binder and settled as `absent` where no `tuiPanels` service exists, and it never
throws. The final id is not composed here — it is DISCOVERED from the host's own `list()` read-back,
which is why the debug line reads `sidebar panel id: act1:team` (measured) on the real 0.13.0 host and
`(not discovered)` everywhere else.

**HOW A USER ACTUALLY REACHES A PAGE — read this paragraph before concluding a page is missing.** The
final id is DYNAMIC (`<activationId>:<slug>`; measured `act1:team`, `act1:dag`, `act1:workmate` in a
composition whose loader row carries no Component identity), so it is never hard-coded anywhere: learn
it from the host's `/panel ` completion list, or from the line `/mpd panel`, `/mpd dag` and
`/mpd workmate` print (each names the id it went to). Registering a page does NOT by itself put it on
screen. Two switches in the HOST's own row config decide that, and the bundle cannot set either of them
(a patch row may never id-target a host-owned row):

1. **The page must be in the enabled-panel list** — `/settings` → side panel → *Enabled panels*
   (`dsh-tui.sidePanel.panels`, default `todo,jobs,agents`): add the page's final id. The host keeps a
   well-formed id that no panel claims **yet**, so adding `act1:dag` before the plugin registers it is
   fine; the default list is why a fresh profile shows only the host's own tabs.
2. **The sidebar must be open** — press `Ctrl+B` (the host's three-state toggle), or turn on *Side
   panel starts open* (`dsh-tui.sidePanel.open`, default `false`).

**WHY SWITCH 1 USED TO UNDO ITSELF, AND THE TWO ROUTES THAT NOW HOLD IT.** The host's own registration
path DOES append a successfully registered id (`enablePanelIdInStore` in
`lib/types/dsh-adapter/panels.js`), so the list reads `todo,jobs,agents,act1:team,…` right after a boot —
and then, MEASURED at about **+5.4 s**, the `dsh-tui` row re-applies its CONFIG
(`applySidePanelPanels(config.sidePanel?.panels)`, reached through a `Fiber._reload`) and the appended ids
are gone. That transient append is why a fresh profile shows the host's three tabs and nothing of ours.
Two INDEPENDENT routes now hold the list:

* **Automatic and bounded** — the TUI adapter (`packages/mpd-tui-adapter-plugin`) carries a settle keeper
  that re-asserts ONLY the ids the host's own `list()` read-back produced, and it does so only when the
  enable list names **NONE** of them; it appends them as ONE set after the user's list, never removing a
  token and never reordering one. A list that names **ANY** of ours is a configuration that has taken a
  position on this bundle — you enabled us in `/settings`, or ran the script below, or deliberately
  removed some of us and kept the rest — and the keeper **stands down**, so it can never put back a page
  you meant to remove. It walks six ticks over the first ~25 s and then **stops for good**. The ids it
  discovered are recorded to `<workspace>/.mpd/logs/mpd-tui-panels.json`, because no source constant can
  know them. This is the adapter's SECOND host-internals contact (the first is the `Ctrl+A` `useStdin`
  reach; AGENTS.md §6 counts that class, so both are named in that file).
  **Named residual:** a user who removes **ALL** of ours on purpose leaves a list indistinguishable from a
  fresh profile's, so the keeper re-adds the set once per boot. Telling those two cases apart needs the
  CONFIGURED value — a third host-internals contact, and a §6 count decision deliberately not taken in
  this wave. Removing a bundle page for good is the user layer's business, which is exactly what the
  script writes; the keeper then leaves it alone.
* **Durable, one command** — `node scripts/mpd-tui-panels.ts` writes `dsh-tui.sidePanel.panels` into the
  profile's own patch file, which IS the host's settings user layer: `dsh-config-editor` answers
  `documentPath` from `profileContext.patchPath`, and `dsh-app-boot` builds that as
  `<profileDir>/cordis.patch.yml`. The script reads BOTH installed sources and REFUSES to write when it
  cannot prove the path. It is a DRY RUN by default, prints the exact leaf it would change, supports
  `--apply`, keeps a `.bak` copy, and adds only the ids the list is missing. Use it when a settings layer
  arrives too late for the bounded keeper to see, or when you want the choice to persist across restarts.

With both switches in place, `/panel <id>` switches to the page (`/panel toggle` / `focus` / `zoom` are the
other forms) and `Alt+Z` zooms it. Measured WITHOUT them: the bar reads `│ ‹ 待办 › ▸ ◆` and the host's
live enable list is `toggle, focus, zoom, todo, jobs, agents`. Measured WITH them, at 120 columns: the
bar carries `‹ MPD ›`, `‹ MPD DAG ›` and `‹ MPD workmate ›` and the page body renders. The panel column
exists only where the host splits — at 80 and 48 columns the same capture reports `split=false`, i.e. no
panel column at all, which is the host's own threshold and not an MPD setting.

For the same reason the `/mpd panel` sentence is deliberately modest: *"the host accepted {id}; if no
panel appeared, add {id} to the panel list in /settings → side panel, then press Ctrl+B (or turn on
\"Side panel starts open\")"*. The host's `tuiPanels.open()` returns `true` when the request was
DELIVERED, while its own `useSidePanel` DROPS a request whose id is not in the enabled list — so the
older wording was a false green. MPD cannot observe a render either: the host's `TuiPanelEvent` set is
`registered|unregistered|badge|error|disabled` (`opened`/`focused` are an explicit host TODO), so
honesty lives in the sentence, not in the branch.

The BODY is the SAME merged view the full-screen scene draws, through ONE reader (`readWorkflow`, the
agentless form of the scenes' own `readDashboardWorkflow`), so the two surfaces cannot describe one team
differently: the host's curated `host.snapshot().subagents` rows FIRST, then the MPD dependency DAG,
both reusing `subagent-scene.ts` (`subagentSectionRows`, `teamGraphView`) and `graph.ts`. It renders
ONLY through the props' own kit — `props.React` and `props.ui` — because the host renders the panel
inside its own reconciler: importing React (or any second copy of it) here would mount a foreign tree,
so the panel never imports it and never reads a theme of its own (the single-React rule).

**Entry points, and the ONE routed open.** `alt+a` and the new `/mpd panel` subcommand both land on
`openMergedPanel()`, which decides PER CALL — the seam binds asynchronously, so a key pressed before the
binding must still find a surface: the sidebar panel when `panelSeamBound()` is true and an id was
discovered, otherwise the full-screen `mpd-tui-subagents` scene. A host REFUSAL is not a no-op either:
`opened() === false` (not this activation's panel, the one-open-per-5000 ms rate limit, or no live panel
consumer) opens the scene as the fallback and logs why. A QUEUED request (`opened() === undefined`) is
NOT read as a refusal. `/mpd subagents` keeps its pre-panel boolean contract; `/mpd panel` prints the
routed outcome in the active language (`panel.opened` / `panel.fallback` / `panel.refused` /
`panel.unavailable`), so a fallback can never be read as "the panel opened", and a host that BOUND the
seam yet REFUSED the registration says refused — never "this host exposes no panel seam".

**The two independent pages route the same way.** `/mpd dag` and `/mpd workmate` call `openPage(...)`
with the same arbitration and each page's own FALLBACK scene (`dag` → the full-screen merged subagents
scene, `workmate` → the board scene), and each prints `slug · <the same routed sentence>`, so the line
names WHICH page the host admitted and the final id it went to. The bare-`/mpd` action picker gains the
same two actions, and every child row carries both languages for the host's `/lang`.

**`Ctrl+A` is VERSION-GATED.** On a host that offers the panel seam the legacy host-input contact is
skipped outright — `takeoverArmed(seamBound, savedKnob, floor)` returns `false` whatever the config
layers say, the aggregate line names the reason, and `Ctrl+A` keeps the host's own dashboard meaning. On
a host WITHOUT the seam the contact arms exactly as before, and there the saved `tui.dashboardKey` knob
outranks the row config's floor. The gate is re-read PER PRESS, not only at apply, because the adapter
binds the seam through a deferred inject — so `tui.dashboardKey` is meaningful on OLD hosts only, and on
a 0.13.0 host that key is not MPD's to spend.

The row config's new `panel` switch (default `true`) turns BOTH the contribution and the routing off: no
registration is attempted (the aggregate reports the adapter's own `skipped("panels", …)` outcome naming
the config), `alt+a` and `/mpd panel` keep the pre-panel full-screen path, and the `Ctrl+A` arming is
decided by the seam alone.

**BOUNDS, stated plainly.** (1) The visibility claim is a claim about the TWO SWITCHES, and it is
measured: with `sidePanel.panels` carrying the page ids and the sidebar open, the 120-column frozen
capture's panel bars read `≡ ▸ ◆ ‹ MPD › ◈ ◆`, `≡ ▸ ◆ M ‹ MPD DAG › ◆` and `≡ ▸ ◆ M ◈ ‹ MPD workmate ›`
with `mpdTab=true`; without them the bar is the host's own three tabs (`‹ 待办 › ▸ ◆`). At 80 and 48
columns the same capture reports `split=false` — the host draws no panel column at all, so no page can
be visible there whatever the list says. (2) MPD cannot observe a RENDER: the host's `TuiPanelEvent` set
carries no `opened`/`focused` (an explicit host TODO), so what the plugin knows is a composed id and an
accepted request — never a paint, and the earlier byte-identical capture that motivated R13 is why the
sentence names the remedy instead of claiming success. (3) The 0.12.0 leg has NO PTY proof: a clean
0.12.0 sandbox needs `dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`, refused here by the read-only
pnpm store lock (the existing `.mpd/recon/tui-012` fixture is a mixed-version composition whose loader
fails on the 0.13.0-only row before a chat screen exists), so the old-host arming path rests on the unit
arms — the predicate is `takeoverArmed` in `src/panel.ts`, covered by `test/panel.test.ts`, plus the
`Ctrl+A` decision arms in `test/dashboard-key.test.ts` — and NOT on a pane.

Evidence: `evidence/tui/lanes/2026-10-06T10-27-42.389Z/` (mount lane PASS),
`evidence/tui/lanes/2026-10-06T10-27-53.571Z/` (7 of 8 surfaces render, the panel row green, the negative
control red), `evidence/tui/lanes/2026-10-06T10-28-57.807Z/` (the host's `Ctrl+A` stayed INERT and
`/mpd panel` proved the sidebar registration + an accepted open),
`evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`, and — for THIS wave's three
pages — `evidence/tui/dag-port/verification/pty/frozen/` (the frozen-revision PTY capture: the three MPD
tabs in the bar, the pin/unpin key set, and the width matrix with its `split=false` arms) plus
`evidence/tui/dag-port/seam-guard/20261006T135423Z/T6-WIRING.md` (the wiring and the R26 wording).

### The DAG page: adaptive vertical ranks, the six tones and the legend

`src/panel-dag.ts` is the dependency DAG as its OWN page (frozen R1), with the chrome the merged panel
cannot afford: a bordered frame, a header naming the team and its progress, the drawing, the legend, and
a footer naming the keys this page really handles.

- **Vertical and adaptive, with no fixed size anywhere.** Rank is the VERTICAL axis (top→bottom), and
  the drawing is REUSED from `graph.ts` rather than re-implemented: `layoutBoxes` (one bordered box per
  task), `layoutRail` (an indented forest) and `layoutList` (a rank-grouped table with progress bars —
  the view that had no caller until this page). `dagPanelLayout` picks the mode from the width the panel
  actually measured: `boxes` REFUSES rather than draw a squeezed box, the rail takes over while a forest
  still fits its row budget, and `list` is the dense fallback for a narrow, busy board. Nothing here
  decides how wide anything is; the user's decision for this wave was 纵向，但不要固定尺寸 (vertical
  ranks, no fixed sizes).
- **Rank is DERIVED from the graph, never trusted from a served `depth` (R17).** The drawing computes
  each rank itself as the longest chain of blockers that RESOLVE on the board; a served `depth` is at
  most a hint. This repairs a measured, silent lie: the live board's blocker references were plan
  ordinals (`["2"]`) while its task ids were `T1..T10`, so the store dropped every unresolvable
  reference, every task became a root, every depth became 0 — and the drawing showed ONE column with NO
  edges while saying nothing at all. The page reports which source actually drew:
  `view boxes · 12 tasks · ranks derived` versus `· ranks served`.
- **An unresolved blocker reference is a VISIBLE FACT (R18).** `GraphView.unresolved` is printed as
  `unresolved blockers: <ids>` in the warning tone — silent data loss is what produced the defect above
  and must not be reproduced one layer down.
- **The six-state tone palette is ONE table, not scattered literals (R5).** `dag-theme.ts` holds
  `DAG_STATE_TONES` (the six states in legend order), `DAG_TONE_THEME` (completed→`success`,
  running→`activity`, failed→`error`, blocked→`warning`, cancelled→`inactive`, open→`subtle`),
  `DAG_TONE_GLYPH` (`✓ ◐ ✗ ○ ⊘ ○`), `DAG_KIND_ABBREV` (`REQ WRK REV FIX INT`) and `DAG_CHROME` (the
  border styles and the `▼ ▸ ▶ ◆` markers the legend must name). The WEB view's hexes are recorded as
  PROVENANCE only (`DAG_TONE_WEB_HEX`); nothing renders them.
- **The legend disambiguates what the WEB view never had to (R6).** `blocked` and `open` share the
  glyph `○` by design, so the legend prints the twin (`○ open=blocked · ○ blocked=open`) and wraps the
  state key rather than abbreviating it — a legend entry that does not fit is DROPPED, never cut. The
  arrow and focus sentences come from `graph.ts`'s own `legendLines`, so the legend names exactly the
  characters the drawing paints.
- **Click-to-pin and keyboard (R11); hover deliberately absent.** A click resolves through the drawing's
  own hit rectangle and pins that task; the pinned body sits under the drawing and prints ten facts in a
  fixed order, `—` for any the record does not carry: `id`, `kind`, `visual`, `verdict`, `failedBy`,
  `owner`, `attempt`, `round`, `blockedBy`, `dependents`. Keys: `↑↓/jk` move the focus, `Enter` pins,
  `Esc` unpins. There is NO hover surface, because a terminal has no pointer-move and the user dropped
  that requirement explicitly.
- **Scrolling, and one KNOWN OPEN DEFECT.** The body is self-windowed with a PERMANENT proportional
  gutter while content overflows, plus wheel and `PgUp`/`PgDn`/`Home`/`End`. Permanence is the host's
  own rule: an auto-hiding gutter changes the content width and rewraps every row the moment it appears.
  The defect: an unbounded `PgDn` run can drive the window to zero rows, because the offset accumulates
  across renders. It is diagnosed, bounded and recorded — the scrollbar is functional, NOT flawless.
- **Badge, empty state, cycle.** A failed task badges `error`, a task waiting on an unfinished blocker
  `warning`, a running board `info`, and a board with nothing to report clears the badge (a stale badge
  is worse than none). With no team the page names the call that fills it:
  `no team in this workspace — `agent_teams_plan` stages one`. A dependency CYCLE is reported in the
  failed tone (`dependency cycle: <ids>`) instead of being drawn silently short.

**OPT-1 is a user decision, not an implementation detail.** A **FAILED** dependency does NOT block its
dependents: they stay `open` and dispatchable, and the failure is reported BESIDE the state
(`failedBy`, rendered as `failedBy <ids>` in the pinned body) rather than folded into `blocked`
(`graph.ts`'s header, `team-store.ts` and `team-state.ts` carry the same rule; the drawing only paints
the `visual` it is handed and never re-derives it).

Observed on the frozen revision at 120 columns: the page's own line reads
`view rail · 12 tasks · ranks derived`, and the legend's state key disambiguates the shared glyph as
`○ open=blocked · ○ blocked=open`.

### The workmate page: the library as its own read-only shelf

`src/panel-workmate.ts` (frozen R12) renders the durable workmate library (`$HOME/.mpd/workmate/<key>/`)
as its OWN page rather than as a section of the merged panel, because the library is a per-USER shelf
and not a per-workspace team. It is **read-only by construction**: it creates, mutates and archives
nothing — the mutating surface stays `mpd_workmate_*`, because a page that could archive a library
entry with one keystroke would be a footgun. Every filesystem read is contained: a missing library (the
normal state before the first `mpd_workmate_init`), an unreadable directory, a hand-edited `meta.json`
or an instance with no note costs a row or a field, never the page. Each entry draws its `name · key`,
its base template, its use count, its description and its note, sorted newest-updated first — the same
order `mpd_workmate_list` serves, so the panel and the tool cannot disagree. The keyboard behaves as on
the DAG page, and the empty state names the call that fills it:
`no workmates yet — `mpd_workmate_init` creates one`. Its refresh tick is 2000 ms against the DAG
page's 1000 ms, because a library changes on a tool call rather than on a keypress.

### The dependency graph: arrows, the legend and the `Ctrl+A` take-over

`src/graph.ts` draws the board three ways and picks the widest one the terminal fits: `boxes` (a layered
DAG whose vertical axis is the longest dependency path, so a chain reads top to bottom), `rail` (an
indented forest for a narrow terminal) and `list` (a rank-grouped table for a very dense board). Every
DRAWN dependency edge ends in a directional arrowhead — `▼` in `boxes`, `▸` in `rail` — pointing INTO the
dependent, and a fan-in of several blockers still shows exactly ONE arrow: the merged entry is written as
text rather than as a junction, because no direction bit can say "…and the dependency points into this
box". Both callers (the team scene and the merged panel) render `legendLines(width)` directly under the
drawing; it names both marks, the five state glyphs (read from the same table the drawing paints) and the
focus marker, and it drops a sentence rather than cutting one when the terminal is narrow.

**The engine DERIVES what it draws, and says which source won (this wave).** Rank is computed from the
dependency graph the board actually resolves — the longest chain of blockers that resolve beneath a
task, with a served `depth` used only as a hint when nothing resolves at all — and `GraphView` carries
`ranksDerived` (which source drew) and `unresolved` (blocker references naming no task on the board), so
a page can surface both instead of hiding them. Two further measured defects are fixed INSIDE the
drawing: a wide (CJK) glyph occupies two cells, so the cell after it now renders as nothing rather than
as a space — a boxed line used to lose its closing border after any wide character — and the narrow
floor is honest: `layoutBoxes` returns `undefined` rather than draw a box narrower than `MIN_NODE_WIDTH`
(16), and the DAG page asks for a label area of at least `MIN_BOX_LABEL_CELLS` (32) before it elects the
boxed view, so a narrow panel degrades to the rail or the list instead of clipping a box.

`Ctrl+A` opens the merged panel — the host's own subagent rows with their counts, the team body and that
DAG — whenever the workspace's team projection holds a team with at least one task. The host's built-in
`dashboard` action owns that key and no contribution kind can reach its component, so the adapter loads
the host's own `useStdin` (see `packages/mpd-tui-adapter-plugin`) and a zero-row status view prepends a
listener that consumes the key first. With no team the listener touches nothing, and every failure — an
unreachable host module, a version-skewed one, the `tui.dashboardKey` knob off — degrades to exactly
today's behaviour. `skills/dsh-qa/scripts/tui-deps-ctrla.ts` proves both arms (and the settings-screen
control) on a real PTY. **Since dsh-tui 0.13.0 this path is VERSION-GATED**: on a host that offers the
sidebar panel seam the contact is skipped outright and `Ctrl+A` keeps the host's own dashboard meaning —
the take-over arms only on a host WITHOUT the seam (see the sidebar panel section above).

ONE HOST CONSTRAINT, stated because it changes what you see: the live input context is only ever handed
to a SCENE render, so the take-over arms itself from the first MPD panel or scene you open in a session
(`alt+a`, `alt+t`, `alt+m`, `/mpd board`, …). Before that — and on any host that answers a plugin's own
import with a foreign module instance — the hook attaches nothing and `Ctrl+A` opens the host dashboard
exactly as it does without this bundle. Opening the panel once is enough for the rest of the session.

### Team-model slot fields are catalog-driven selections

The twelve `teamModels` leaves (`slot{1,2,3,4}.{provider,model,reasoningEffort}`) are
declared `select` fields. The host renders a `select` by CYCLING a **frozen** option
list (there is no pick-list dialog), so their options are computed **at registration**
from the model catalog the adapter reports — `mpdDsh.llmCatalog()`, the additive seam
documented by `packages/mpd-dsh-adapter-plugin`:

- **provider** options = the catalog's provider ids (label = the provider name);
- **model** options = the union of every provider's model ids (labels = model names);
- **reasoning effort** options = the union of every model's effort ids (labels = effort
  names).

Every value is the raw id the settings document stores (so `deepseek-official` /
`deepseek-v4-flash` / `max` stay the vocabulary the config layer reads). When the
catalog is unavailable or **degraded** (`{ providers: [], degraded: true }` — also the
shape an adapter build without the seam produces), each field falls back to the
declared `TEAM_MODEL_FALLBACK_OPTIONS` of the shared schema: a slot field is therefore
never registered with an empty list and never requires typing. Because the catalog read
is async and the host freezes the list at register time, the section registration is
deferred by one microtask chain while the catalog is read (the host registry's own
late-registration seam); a reader without the seam registers synchronously with the
declared lists. The branch that produced the options is logged on every registration:
`settings section mpd slot options: provider=live(N)|declared(N) model=… reasoningEffort=… catalog=live|degraded|unavailable`.

The board is the TUI-native equivalent of the web-only surfaces (agent-teams
sidebar, workmate tab). It reads state — it never writes:
- the OFFICIAL Agent Teams readout (`dsh.teamLiveTeams()`, through the adapter — 0.1.7:
  the retired `.mpd/team/<teamId>/team.json` is gone, and a SOLO session is not shown as a team)
- `<workspace>/.mpd/boulder.json`
- `<workspace>/.mpd/plans/*.md`
- `$HOME/.mpd/workmate/<key>/meta.json` (the durable workmate library)

Every path is resolved per call under the **calling session's workspace**
(`packages/mpd-dsh-adapter-plugin`'s `workspaceRoot` / `workspaceRootsAll`),
never the dsh process cwd.

The read-only rule is not a policy statement here, it is a property of the built
bytes: the package contains no write primitive — every team mutation is a TOOL call the
scene makes through the adapter. 0.1.7 RETIRED the two tools the first implementation
called (`agent_teams_approve`, `agent_teams_delete`), which for a while left the pane
with nothing to call; since W6 it calls THIS bundle's own `agent_teams_plan`
(`approve` / `delete`), so the gate acts again. Every failure is a loud refusal, never a
fabricated success.

**The caller is resolved, never invented.** `agent_teams_plan` needs a caller
(`exec.agent`), and the harness authenticates it BY IDENTITY against its own live store —
a hand-built `{ session: { id } }` was measured being refused there. The scene therefore
resolves it from the adapter's own registry: `liveAgent(sessionId)`, else a live entry
whose own `session.id` matches, else — only when the scene carries no id at all — the ONE
live agent. When none of those names a caller the pane REFUSES before calling anything:
`session "<id>" is not live in this process — no live agent to speak as, so nothing was
called` (with no id on the surface: `no live agent to speak as and no session id on this
surface — nothing was called`). A composition without the `agent_teams_plan` tool refuses
the same way. **NOT claimed:** that every host and every session resolves — this page
promises the resolution ORDER and the refusal text, not universal success on a host the
wave has not exercised.

**Where each Web-edition surface stands against its TUI counterpart** is answered
row by row in `docs/tui-parity.md` (+ `docs/tui-parity.zh-CN.md`): status, reason
and evidence level per surface, with the still-open deviations recorded rather than
smoothed over. Read it before quoting a parity claim from this file.

## The language of every surface (R4)

The host localizes a contribution through per-field maps it resolves with its OWN active language.
Where such a field exists, this package uses it and nothing else:

| Contribution | Localized field | Carries |
|---|---|---|
| Settings field label | `TuiSettingsField.descriptions` | `{ zh }` — the English is the `label` base (the host's own pattern; `pick(text, descriptions)` falls back to the base) |
| Settings field hint | `TuiSettingsField.hintDescriptions` | `{ zh }` — the English is the `hint` base. Set only for the twelve slot leaves, whose hint has a translated sentence; the other rows keep `hint` alone |
| Settings section | `TuiSettingsSection.descriptions` | `{ zh, en }` — the section's own disclosure sentence in both languages |
| Command tree (root + every child) | `TuiCommandTreeProvider.descriptions` | `{ zh, en }` — the English half IS the node's `description` base by construction |

What the host gives NO localized field for — a scene `title`, a shortcut `description`, a status
entry's `text`, a dialog's own title and labels, and every literal this package renders — is
resolved by `src/i18n.ts` through the **host's own chain**, verbatim
(`lib/types/i18n.js`): `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → `LC_ALL` / `LC_MESSAGES` / `LANG`
(a `zh` prefix is zh; **any other STATED locale is en**, so `C.UTF-8` ⇒ en; zh only when the whole
chain is empty) → `zh`.

**Limits, stated rather than skirted (see NOT CLAIMED 10–12).** `~/.dsh-tui` is READ ONLY — MPD
owns no language preference, `/lang` stays the single switch, and nothing is ever written there. A
string resolved by MPD is evaluated **at use**, so it follows the next command / the next status
publish after a `/lang` switch; it is **not** a per-frame subscription, and no surface here claims
one. A scene `title` is fixed when the scene is REGISTERED (the host's descriptor carries one
string), so it follows a restart instead.

## Static assets

- `themes/mpd-tui.json` — a dark TUI theme (a partial colour override). The
  theme seam is a static asset by design: copy the file into
  `~/.dsh-tui/themes/` to make it selectable. This row does **not** install it.
- `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` — an asset only; see "What is NOT claimed" #4.

## Plugin contract

- pure ESM, `.js` suffixes on relative imports;
- `name` / `Config` (type) / `Config` (schemastery schema) / `apply`, **no
  default export**;
- every config key defaulted in both the schema and the resolver;
- cleanup owned by `ctx.effect`;
- every optional service probed with `ctx.get(id, false)` and degraded with a
  diagnostic — `apply` never throws when a service is absent, so the row is
  inert in a web composition and live in a `dsh-tui` composition.

Harness seams (tools, skills, agent registry, subagents) are not touched here:
they go through `packages/mpd-dsh-adapter-plugin`. The `tui*` services,
`ctx.commands` and `ctx.settings` are host services consumed directly with a
soft probe, which is the host's documented idiom.

### Config keys

| Key | Default | Effect |
|---|---|---|
| `statusLine` | `true` | publish the keyed status contribution |
| `statusIntervalMs` | `3000` | refresh cadence; `0` keeps it manual (`alt+r`, `/mpd status`) |
| `renderers` | `true` | register the transcript renderers |
| `settingsSection` | `true` | declare the `/settings` section (and the `mpd` namespace) |
| `scene` | `true` | register the board scene |
| `commandTrees` | `true` | register the `/mpd` completion tree |
| `commands` | `true` | register the `/mpd` command (the board's opening path) |
| `shortcuts` | `true` | register the key bindings |
| `panel` | `true` | contribute the sidebar panel (dsh-tui 0.13.0) and route `alt+a` / `/mpd panel` through it. Off ⇒ no registration is attempted (the aggregate reports the adapter's own `skipped("panels", …)` outcome naming the config) and both entry points keep the pre-panel path, the full-screen merged scene |
| `dashboardKey` | `true` | arm the `Ctrl+A` take-over: with a team in the workspace `Ctrl+A` opens the merged panel, and with no team (or with this off) the key keeps the host's own meaning. UNLIKE every other knob here it is read PER KEYPRESS through the config layer, so a `/settings` save applies without a restart. The take-over itself arms once the host has handed this session its live input kit — i.e. after any MPD scene or panel render (NOT CLAIMED 12). **On a host that offers the sidebar panel seam (dsh-tui 0.13.0+) this knob is INERT** — the contact stays disarmed whatever it says, so it is meaningful on OLD hosts only |
| `dialogs` | `true` | enable the mediated dialog facade |
| `sessionEvents` | `true` | append the log-only `mpd-tui/board-opened` record, and only after the event type is verified known to a reachable `dsh-session` copy |
| `decisionEvents` | `true` | attempt the mediated decision-event registration (expected: refused) |
| `logPrefix` | `"mpd-tui"` | diagnostic tag |

### Diagnostics

`stdout` stays silent (a TUI frame owns it): diagnostics go to `ctx.logger`, and
only when no logger exists to `stderr`, with `debug` gated behind
`DSH_TUI_DEBUG`. One aggregate line is logged per boot:

```text
[mpd-tui] mpd TUI surfaces: tuiStatus, tuiScenes, tuiDialogs, tuiRenderers, tuiSettingsSections, tuiCommandTrees, tuiShortcuts, commands · skipped: …
[mpd-tui] no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped
```

## What is NOT claimed

1. **The decision-event seam (`tui.dsh/v1alpha1#DecisionEvents`) is built ready
   but NOT activated.** For a profile-installed plugin, admission is
   token-gated and unreachable (`src/dsh-adapter/plugin-host.ts` at host
   revision `b246411`: the public `admit()` throws, `admitInternal` needs an
   unexported token, `getHostAdmission*` has no production caller), so the
   identity assertion throws before any policy question. The plugin therefore
   attempts the mediated registration for the four intercept points
   (`tui/input`, `tui/rewind-prompt`, `tui/session-switch`, `tui/compact`),
   treats the refusal as the expected outcome, warns **once**, and registers
   nothing. It never calls `admit`/`admitInternal`, never uses the test-only
   token, and never fakes an identity. **No input, rewind, session-switch or
   compact interception is claimed.**
2. **The `/settings` section IS bridged to `<workspace>/.mpd/mpd.jsonc`, and the behaviour
   change needs a restart.** The fields declare the real mpd.jsonc knobs
   (`hashline.maxDiffChars`, `commentChecker.autoCheck`, `ulw.maxRounds`,
   `memory.vcs`, `team.stateDir`, `boulder.dir`) and edit them under the harness
   settings namespace `mpd`. That namespace is **served by
   `packages/mpd-config-plugin`** (design §10.1), which registers it with a
   `base`, so both front doors display the file's real values instead of the
   schema defaults; this plugin is a pure consumer and only registers as a
   guarded **fallback** when a composition has no config plugin. The base follows
   a **cardinality rule**: one live root ⇒ that workspace's `<workspace>/.mpd/mpd.jsonc`;
   zero roots ⇒ the mount-time (exec-less) root, an absent file there giving an
   empty base (schema defaults) — the normal boot path, since this row usually
   precedes any live session; more than one root ⇒ **no file base is invented**
   (`base: undefined`, `ambiguous-multi-root`, every candidate warned and surfaced
   by `states()`), so the namespace shows schema defaults until exactly one
   workspace is live. The base is **fixed for the process lifetime** (the host
   exposes no disposal handle for a live registration) — the honest reason the
   sentence below says "after a restart" — while the **resolved value** and the
   config layer's **per-call file reads** are what the plugins actually use. A saved edit is written back into the live session
   workspace's `<workspace>/.mpd/mpd.jsonc` with comments and key order preserved, and the
   config layer applies it to every workspace immediately. **The plugin
   BEHAVIOUR change needs a restart** for every knob in this section, because the
   mpd consumers capture their config at `apply()` — stated in the same words on
   screen: every field hint names its mpd.jsonc key and carries `a save writes
   <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect
   for the mpd plugins after a restart (this knob is read at plugin mount)`,
   followed by the clause that a settings-only save is never a lost save. The twelve
   team-model slot hints LEAD with the knob's own human sentence — the group the
   slot routes (`槽位 2 提供商（分析型成员）` / `Slot 2 provider (analysis members)`)
   and what configuring it does — and only then state the key and that disclosure. The
   write-back **refuses** (loudly, writing no file) when the target is ambiguous
   — no live session (`no-live-session`), several live workspaces
   (`ambiguous-multi-root`, every candidate named), a read-only/unparsable/
   conflicting file — while the settings value still applies; the status line
   carries the matching runtime notice. Not claimed: a specific front door's
   rendering (the Web card's browser render is verified by the user in their GUI).
3. **Web-only surfaces have no TUI rendering face.** The agent-teams sidebar and
   the workmate tab (`dsh.client.platform = web`) do not render in the TUI. The
   board, the status line and the dialogs are equivalents — not a pixel or
   feature parity claim. The web profile is untouched.
4. **The packaged skill is an asset only.** `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` ships with
   the package, but the bundle's corpus is served from `<bundle>/skills` by
   `mpd-bootstrap`; this package-local copy is not registered by this row.
5. **Engine version skew.** The host prints that the dsh engine is newer than
   the UI revision it was validated against; verification runs against the
   installed engine, not that revision.
6. **Host-internal gates are not our conformance.** The host's own
   `verify:plugin-*` suite validates the host's plugin subsystem; even a green
   run would not be a conformance verdict on this plugin.
7. **The `Ctrl+A` take-over is a KEY RE-POINT, not a merge into the host's dashboard.** No host file
   is patched and the host's own dashboard rendering is not extended: the panel you land on is
   `mpd-tui-subagents`, which renders the host's `channel.subagents` rows itself. While a team holds
   at least one task, `Ctrl+A` no longer opens the host dashboard at all — turn `tui.dashboardKey`
   off to get the host's behaviour back.
8. **It keys off the KEY, not off the host's current `dashboard` binding.** If you remap that action
   in `/settings`, `Ctrl+A` still opens the merged panel while a team exists: the hook watches the
   host's default combo. Nothing is remapped for you and the host's own binding table is untouched.
9. **It fires on the plain chat screen only.** The hook rides a status-view component, and every
   exclusive host surface (a dialog, `/settings`, the session tree, the supervisor, a plugin scene,
   the host dashboard itself) unmounts it — the `tui-deps-ctrla` lane's settings arm proves that on a
   real pane, rather than inferring it from the host's branch order.
10. **Cross-rank dependency edges are not drawn in the `boxes` view.** A task whose blocker sits two
    or more ranks up shows no connector for that blocker (pre-existing layout rule: only the rank
    immediately above is wired). The `rail` view names the extras inline (`⇠ T4+T6`).
11. **A merged entry's arrowhead takes the DEPENDENT's tone, not the edge's.** One cell cannot carry
    several parents' tones, so a dimmed edge can end in an arrowhead drawn in the child's own colour.
12. **The `Ctrl+A` take-over ARMS once the host has handed MPD its own ui kit** — i.e. after any MPD
    scene or panel has rendered in the session (`alt+a`, `alt+t`, `alt+m`, `/mpd board`) — because the
    host module a plugin can resolve by file URL is NOT the instance the running host renders with
    (measured on dsh-tui 0.12.0: that import's `useStdin()` answers nothing, while the kit a scene
    receives returns the live context). Until then the contact falls back to that module and `Ctrl+A`
    keeps its current behaviour. Nothing is claimed about a host whose kit never arrives.

13. **`/mpd-model` writes a value; it does not make team creation succeed.** The menu offers what the
    live catalog lists, and a route the provider does not actually serve still FAILS team creation
    loudly (naming the member and the slot) — that failure is the honest outcome, and this command
    does not pre-validate it. Neither does it clamp a choice: every panel offers ids, never labels.
14. **`LocalCommand.descriptions` is UNREACHABLE on this host, so `/mpd-model` does not declare one.**
    `dsh-commands`' `normalizeDefinition` rebuilds every definition as
    `{definitionId?, name, description, input?, recordInput?, handler}` and drops unknown fields, so a
    `descriptions` map never survives to the registry. The string a user sees in the slash menu is the
    command-TREE node, which DOES carry both languages; the command's own `description` stays the
    English base the host's `tOr('cmd-desc-<name>', description)` fallback reads.
15. **The language resolution is NOT a per-frame subscription, and MPD writes no language preference.**
    It reads `DSH_TUI_LANG` → `~/.dsh-tui/lang.json` → the OS locale (`zh` prefix ⇒ zh, any other
    STATED locale ⇒ en, so `C.UTF-8` ⇒ en; zh only when the whole chain is empty) → `zh`, evaluated at
    use. `~/.dsh-tui` is READ ONLY: `/lang` stays the single switch, and a `/lang` switch reaches a
    MPD-resolved string at its next use — a scene `title` (fixed at registration) only after a
    restart. A host whose language is pinned by `cordis.yml`'s `lang` is a KNOWN gap: that key is read
    by the host's own `plugin.apply` and is invisible to a plugin.
16. **A sidebar page appears only with the HOST's two switches, and MPD can never observe a render.**
    Measured on the frozen revision: with `sidePanel.panels` carrying the page ids and the sidebar open,
    the 120-column PTY capture's bars read `≡ ▸ ◆ ‹ MPD › ◈ ◆`, `≡ ▸ ◆ M ‹ MPD DAG › ◆` and
    `≡ ▸ ◆ M ◈ ‹ MPD workmate ›` (`mpdTab=true`); without them the bar carries only the host's own three
    tabs, and at 80/48 columns the host reports `split=false`, so there is no panel column at all. The
    page ids are DYNAMIC (`<activationId>:<slug>`; measured `act1:team`, `act1:dag`, `act1:workmate`), and
    a patch row may not id-target the host's row to set either switch, so the remedy is documented user
    steps (see the reachability paragraph). What the plugin itself knows is a composed id and an accepted
    `open()` request — never a paint: the host's `TuiPanelEvent` set carries no `opened`/`focused` (an
    explicit host TODO).
17. **The old-host `Ctrl+A` arming path has NO PTY proof.** A clean 0.12.0 sandbox needs
    `dsh plugin add @deepseek-harness-tui/dsh-tui@0.12.0`, which is refused here by the read-only pnpm
    store lock; the existing `.mpd/recon/tui-012` fixture is a mixed-version composition whose loader
    fails on the 0.13.0-only `dsh-tui-panels` row before any chat screen exists. That path therefore
    rests on the unit arms — the predicate is `takeoverArmed` in `src/panel.ts` (`test/panel.test.ts`,
    16 pass) plus the `Ctrl+A` decision arms in `test/dashboard-key.test.ts` (11 pass) — and nothing is
    claimed about a real 0.12.0 pane.
18. **Browser-only behaviour is deliberately NOT ported.** Hover, the WEB view's PIXEL geometry (fixed
    `168px` columns, `42px` nodes), CSS ellipsis, `overflow:auto`, native tooltips, DOM reads and `fetch`
    polling have no terminal equivalent and are dropped rather than faked. The port is of the WEB view's
    SEMANTICS and visual language — the six states, their tone families, the rank direction — never of
    its geometry, which is why every size in the TUI is computed from the measured panel. The WEB DAG is
    the REFERENCE for those semantics and is not itself modified beyond the rank-derivation and
    edge-routing repairs its own legibility required.
19. **The DAG page's scrollbar is functional but NOT flawless.** An unbounded `PgDn` run can drive the
    window to zero rows, because the scroll offset accumulates across renders; `clampScroll` bounds the
    band but the accumulation itself is open. It is diagnosed and recorded — at the frozen revision the
    two failing `bun test ./packages` arms are exactly the offset-accumulation arms
    (`evidence/tui/dag-port/freeze/FROZEN-REVISION.md`).

## Build and test

```sh
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
  --outfile packages/mpd-tui-plugin/dist/index.js
bun test packages/mpd-tui-plugin
bun run typecheck
```

`dist/index.js` is built with the repo's own toolchain (bun, no network step) and
is self-contained: the only external imports it needs are Node builtins. The
`Config` schema comes from the schemastery copy the bundle already vendors at
`packages/mpd-agent-teams-plugin/_deps/schemastery` — this package declares no
dependency of its own. That vendored copy is the one relative specifier that
names a package directory (resolved through its own `package.json`, which
carries both `exports.import` and `types`); every relative **file** import in
`src/` carries its explicit extension (`.js`), and the built bundle inlines the
vendored copy so the shipped artifact has no relative specifier at all.

## License

Unchanged: the repository license (`LICENSE.md`, SUL-1.0). This package claims no
license change.
