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
its top section and its team panel below them. It is a faithful approximation, not a merge — the user is
looking at MPD's scene rather than at the host dashboard's own rendering. The scene is written so that
switching to a real seam later is a small change: it consumes `channel.subagents` and renders plain rows,
so a future `slot`/section registration is a registration swap, not a rewrite.

**Amendment (2026-10-05, user decision): the key is no longer left untouched.** Because no seam can reach
the host dashboard, the bundle's adapter now resolves the INSTALLED host root and dynamic-imports
`<hostRoot>/lib/types/ui.js` **by file URL** to obtain the host's own `useStdin`, then a zero-row status
view prepends a listener on the host input bus and re-points `Ctrl+A` at MPD's merged panel — but ONLY
when the workspace's team projection holds a team with at least one task, and only while the `/settings`
knob allows it. With no team, `Ctrl+A` opens the host dashboard exactly as before. No host file is
patched; every resolution failure degrades to "no take-over" with one log line; the proof is the PTY lane
`skills/dsh-qa/scripts/tui-deps-ctrla.ts` (team arm = panel + arrows, no-team arm = host dashboard). This
is a workaround, not a claim on the host's UI: **the ask below still stands**, and it would let the bundle
delete the host-internals contact entirely and register a section instead.

**TWO HOST CONSTRAINTS the workaround had to accept (both measured on 0.12.0, both are arguments for the
seam):** (1) the file-URL import returns a FOREIGN module instance whose `useStdin()` answers nothing, so
the live input context is only reachable through the kit the host hands a SCENE render — the take-over
therefore arms after the session has rendered any MPD scene, and stays inert before that; and (2) the
`tuiStatus` seam refuses a registration whose identity is the consumer's activation (it must be the
calling activation — the injected scope), which is a sharp edge no plugin author should have to discover
by measurement. An exported dashboard row hook (option 3 below) or a panel-section contribution kind
(option 1) removes both.
