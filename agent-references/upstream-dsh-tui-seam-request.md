# Upstream request draft — a contribution seam for the subagent panel (dsh-tui)

Status: DRAFT, prepared 2026-10-02 by the `@mpd-dsh/mpd` bundle wave "mpd-seam-convergence".
Audience: `ccch1mneyyy/dsh-TUI` (and the `dsh-tui-ecosystem` admission discussion).
Agent-facing, English-only by the bundle's language policy.

## What we measured (dsh-tui 0.12.0, installed)

- `TuiSceneDescriptor` is exactly `{ id: string; title?: string; component: React.ComponentType<TuiSceneProps> }`
  — no `slot`, `parent`, `placement` or `order` field (`lib/types/dsh-adapter/scenes.d.ts`).
- The extension contribution kinds in `dsh-ecosystem-spec/registry/registry-0.15.json` are exactly
  `workspace.provider`, `tui.settings-section`, `tui.scene`; `protocols/tui-contributions.js` ships only
  `SETTINGS_SECTION` and `SCENE`.
- `SubagentDashboard` takes three props (`{ subagents, onClose, onSelect }`) — no `children`, no footer,
  no render prop — and `screens/Chat.js` renders it as an EARLY-RETURN full-screen replacement of the
  conversation subtree (so nothing renders "under" it while it is open).
- The component is not reachable either: the package `exports` map has no `./lib/*` subpath, and
  `./api` re-exports types only.
- The status seam cannot substitute: `TuiStatusEntry` is `{ key, text }`, views are clipped to 3 rows and
  share a 6-row aggregate budget, and the whole region is above the prompt.
- Upstream `main` now carries `ctx.tuiPanels` (PR #1255, merged 2026-10-02) — a **right-sidebar** panel
  (`TuiPanelDescriptor = { apiVersion, id, title, icon?, minColumns?, order?, component?, compact? }`).
  It exposes `TuiPanelSnapshot.subagents[]` read-only, which is useful, but it still cannot place content
  inside or below the subagent dashboard.

## Why a plugin wants it

A plugin that dispatches REAL harness subagents (via `ctx.subagents` / continuable-subagent runs) already
gets its members listed by `Ctrl+A` — the data path works. What it cannot do is contribute the
plugin-specific view of that same work (its task DAG, dependency ranks, requirement chain, review state)
where the user is already looking. Today the only legal options are a second full-screen scene (a context
switch) or a status line (clipped, above the prompt).

## What we ask for (any ONE of these is enough)

1. A contribution kind for panel sections, e.g.
   `ctx.tuiPanels`-style `registerSubagentPanelSection({ id, title, order, component })`, rendered by the
   host's own dashboard BELOW the subagent cards; or
2. a placement field on the scene descriptor (e.g. `slot: 'subagent-panel-footer'`), so an existing scene
   registration can opt into a region instead of the full screen; or
3. an exported, supported `SubagentDashboard`/`SubagentCard` pair (an `exports` subpath such as
   `./components/subagent`) plus a documented "extra rows" prop, so a plugin can compose the host's own
   component with its rows appended.

Each option keeps the host in control of layout, keyboard and lifecycle; none of them requires a plugin to
patch or re-implement host components.

## What we did meanwhile (so the ask is concrete, not hypothetical)

The `@mpd-dsh/mpd` bundle ships an MPD-owned scene that renders the host's own `channel.subagents` rows as
its top section and its team panel below them, opened by its own key binding (`Ctrl+A` is left untouched).
It is a faithful approximation, not a merge — the user must switch to MPD's scene instead of staying in the
host dashboard. The scene is written so that switching to a real seam later is a small change: it consumes
`channel.subagents` and renders plain rows, so a future `slot`/section registration is a registration swap,
not a rewrite.
