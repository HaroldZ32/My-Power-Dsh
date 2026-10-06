# R13 — the invisible `team` panel: ROOT CAUSE, and the remedy that makes it visible

Lane: `seam-guard` (T5). Measured against the INSTALLED host `@deepseek-harness-tui/dsh-tui@0.13.0`
in a warm sandbox profile (`.mpd/recon/tui-013`, bundle mounted as the third patch layer), driven on a
real PTY through `skills/dsh-qa/scripts/lib/tui-lane.ts` (`runTuiSession`: tmux + `send-keys` +
`capture-pane`). Every file:line below is the host's own shipped code, not a guess.

## The answer in one sentence

The panel does register and does render; the **host** decides whether it is visible, and by default it
is not: the sidebar starts CLOSED (`sidePanel.open` default `false`) and the plugin's own
registration-time enable is **overwritten** by the host's config-driven display mirror, so the panel id
never reaches the tab strip.

## The chain, link by link

1. **The tab strip paints only ENABLED ids.**
   `lib/types/components/sidePanel/SidePanelColumn.js` — `const tabs = controller.enabledPanelIds.map(id => …)`
   (`enabledPanelIds` drives both the bar and its empty state).
   `lib/types/components/sidePanel/useSidePanel.js` — `const enabledPanelIds = React.useMemo(() => parseSidePanelIds(panelsCsv), [panelsCsv])`.
2. **The enabled list defaults to the three builtins.**
   `lib/types/tuiDisplayPrefs.js` — `export const DEFAULT_SIDE_PANEL_IDS = 'todo,jobs,agents'`;
   `parseSidePanelIds` normalizes it, and `SIDE_PANEL_ID_PATTERN` (`/^[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)*$/`)
   is the grammar a plugin id must satisfy.
3. **The sidebar itself starts closed.**
   `lib/types/tuiDisplayPrefs.js` — `createLiveSetting(false, …)` for the `open` store; the host's own
   setting is `dsh-tui.sidePanel.open` ("Side panel starts open", **off by default**, `lib/types/settings/definitions.js`).
   `useSidePanel.js` — `const open = openSetting && splitAvailable`, so with the default nothing in the
   sidebar is painted at all until `Ctrl+B` (keymap action `sidePanel`, default `ctrl+b`) or `/panel`.
4. **The host DOES auto-enable a plugin panel at registration — and then discards it.**
   `lib/types/dsh-adapter/panels.js` `register()`:
   `const unregister = panelStore.register(definition, ownerTag); … enablePanelIdInStore(finalId);`
   with `enablePanelIdInStore` documented as "注册即入侧栏启用列表" (registered ⇒ in the enable list).
   `lib/types/dsh-adapter/plugin.js` — `applyDisplay` ends with
   `applySidePanelPanels(value.sidePanel?.panels ?? config.sidePanel?.panels)` (line ~830) and the boot
   path calls `applySidePanelPanels(config.sidePanel?.panels)` (line ~586). The `dsh-tui` Config schema
   declares `.default({ … panels: DEFAULT_SIDE_PANEL_IDS })`, so this write is ALWAYS a concrete
   `todo,jobs,agents` — the appended plugin id cannot survive it. `apply(...)` runs at boot and again
   from `scope.watch(next => apply(next))` when the settings layer arrives (the host's own comment at
   `plugin.js` line 81 notes "settings user layer (settings.yaml) can arrive after the 300ms").
5. **The consequence: `/mpd panel` is a FALSE GREEN.**
   `lib/types/dsh-adapter/panels.js` `open(id)` → `panelBridgeRequests.request('open', id)`, which
   returns `true` as soon as a Chat consumer is attached (`lib/types/components/sidePanel/panelBridge.js`),
   while the consumer DROPS the request for an id that is not enabled
   (`useSidePanel.js` — `if (!view.enabledPanelIds.includes(request.id)) return`).
   So the plugin is told "opened" while nothing appears. This is a genuine host defect: it auto-enables
   a registered plugin panel and then immediately overwrites the list.

## What was MEASURED on the real PTY (`no-switch/` in this directory)

- `/mpd panel` → harness command record (session store, not prose)
  `mpd 侧栏面板：已打开（act1:team）`: the seam bound, the host's own `list()` read-back yielded
  `<pluginId>:team`, and `open()` returned true. Registration is NOT the failure.
- The host's LIVE enable list, read through the host's own `/panel ` completion provider (built from
  `parseSidePanelIds(getSidePanelPanels())` — the same store the bar renders from):
  6 items — `toggle, focus, zoom, todo, jobs, agents` + `↓1`. `act1:team` is ABSENT.
- After `/panel toggle` (sidebar open) the tab strip is exactly `│ ‹ 待办 › ▸ ◆` — three tabs.
- At that same moment `open(act1:team)` still returns true (the owner record is alive), which rules out
  the registration/dispose path and pins the cause to the config-driven CSV rewrite.

`act1` is the host's FALLBACK plugin id (`panels.js` `pluginIdFor` → `componentIdentityOf` is absent for
a plain loader row, so the host issues `act<N>` per activation) — which is why a user typing the slug
`team` can never match, and why the id must be READ from the session (R25).

## The remedy (proven in `with-switch/`)

Set the host's own two switches for the `dsh-tui` row — either in the profile's `cordis.patch.yml`, or
live through `/settings → side panel`:

```yaml
- id: dsh-tui
  name: "@deepseek-harness-tui/dsh-tui"
  config:
    sidePanel:
      open: true
      panels: todo,jobs,agents,act1:team     # add every MPD page you want: :team, :dag, :workmate
```

Measured with that switch set (same PTY, same sandbox):

- boot capture tab strip: `│ ‹ 待办 › ▸ ◆ M` — the MPD tab IS there (its one-cell icon fallback `M`);
- `/panel ` completion list: 7 items (`↓2`), i.e. the id is now part of the host's live enable list;
- `/panel act1:team` + Enter: the active capsule becomes `‹ MPD ›` and the panel RENDERS —
  `subagents` section ("No subagents in the current session"), the DAG rows
  (`○ T1 WRK [requirement] …`, `T4`, `T5`, `T6` with their owners) and the legend row
  (`▼/▸ blocker above → dependent below · ▶ focus lights its chain` / `✓ completed · ◐ running · ○ open · ✗ failed · ⊘ cancelled`).

`Ctrl+B` remains the user's own toggle (`/panel toggle` works identically); `sidePanel.open: true` only
decides whether the sidebar is already expanded at boot.

## What the bundle could NOT do (evaluated, rejected — no fake fix)

- There is NO seam that exposes the enable list: `tuiPanels.list()` reports only the caller's own
  REGISTERED panels (no enabled flag), `tuiPanels.open(id)` acknowledges DELIVERY, not visibility, and
  `tuiSettingsSections.list()/section(ns)` are owner-filtered (a plugin cannot read the host's own
  section). Verified in `lib/types/dsh-adapter/{panels,settings-sections}.js`.
- Writing the CSV from the bundle would need a SECOND host-internals contact
  (`lib/types/tuiDisplayPrefs.js` by file URL), it would fight the user's own `sidePanel.panels` value
  on every settings change, and it is exactly the "third contact site" AGENTS.md §6 forbids. Rejected.
- Recommend NO (captain's R26 question): the honest sentence that names the step is unconditionally true,
  whereas a read of the live store would be a snapshot that the host can invalidate a moment later —
  we would pay a version-fragile contact and still need the sentence. The measurement belongs in the QA
  lane (which may read host internals as a test), not in the product.

## Consequences other lanes must carry

- **R25**: acceptance must ENABLE the switches for every page before judging visibility, and must READ
  the composed id from the session (never hard-code `act1`). A registered-but-unenabled panel is
  neither a pass nor a lane failure — the acceptance step would be wrong.
- The two new pages (`dag`, `workmate`) are subject to the same host switches.
- `PanelHost.js` additionally swaps a page's BODY for a `panel-too-narrow` notice when the panel column
  is narrower than the descriptor's `minColumns` — a second way for an ENABLED panel to show no content
  (relevant to `DAG_PANEL_MIN_COLUMNS`, currently 32 in `dag-theme.ts` while the host's own default is 28).
