# Manual verification recipe — the merged subagent + team panel (Lane C)

Subject: `packages/mpd-tui-plugin/src/subagent-scene.ts` (scene id `mpd-tui-subagents`, opened by MPD's
own `alt+a` and by `/mpd subagents`).

Why this is a recipe and not a screenshot: the panel is a **dsh-tui** surface driven by a live session
channel (`props.channel.subagents`) and a real terminal size. The unit suite proves the composition, the
ordering and the defensive rules; only a human in a real TUI can confirm what the screen looks like.

## Prerequisites

1. A checkout with the wave applied, installed into a dsh-tui profile: `dsh plugin --profile <p> add .`
   (from the repo root — the repo root IS the bundle package).
2. A workspace whose `.mpd/team/teams/<id>.json` holds a team (so the team section has content).
3. A session that has spawned at least one subagent. An MPD team gives several: its teammates are real
   **continuable** subagents.
4. A terminal at least ~100 columns wide (narrower is fine — the panel falls back to 100 cells for the
   DAG layout and the host re-measures on the next render).

## Steps and expected screen

1. Start dsh-tui in that workspace; let one teammate run (`mpd` preset, a team staged/approved).
2. **Press `ctrl+a` first — this is the HOST's own dashboard.** Expected: the host's
   ` Subagent Dashboard ` overlay with the subagent card rows. Note one card's description and status.
   Leave with `Esc`. This step is the control: it shows the SAME source the merged panel will render.
3. **Press `alt+a`** (MPD's binding). Expected: a full-screen MPD scene, top to bottom:
   - row 1 (bold): `MPD subagents + team` followed by ` · <cols>x<rows>` when the host measured the terminal;
   - row 2 (bold): `subagents  N total · R running · C completed · F failed`;
   - rows 3..: one row per subagent, in the host's own array order, each:
     `<glyph> <description> · <mode> · <status> · started <ISO-8601 UTC>` (plus ` · ended <ISO-8601 UTC>`
     when the host reports an end). Glyphs are the host's own: `🟡` running/starting, `⚪` unknown
     (a discovered historical child the host cannot prove the outcome of), `🔴` failed/cancelled,
     `🟢` completed. The selected row is bold;
   - one blank row, then the MPD team body — exactly the team scene's projection:
     `team       <name> (<id>)`, `phase      …`, `roster`, the roster rows, `tasks`, the task rows
     (`T2 [work] … · pending … deps=T1`), `tasks      N total · …`, `mail       …`, any `note       …`;
   - `task dependency graph` (dim) and then the boxed DAG, drawn in the graph's own colours;
   - a dim footer: `esc/q close · ↑↓ select · i interrupt the selected run · r refresh · alt+a this panel ·
     alt+t team · alt+m board`.
4. **Confirm the data-level merge**: the subagent you noted in step 2 appears in the merged panel with the
   same description, mode and status. That is the point: MPD teammates ARE the host's subagents.
5. **Selection + interrupt**: press `↓` (the selection is bold now) and `i` on a row whose status is
   `running`. Expected: a notice row appears just above the footer —
   `interrupt requested for <description>` — and the host's own control was called exactly once.
   Move onto a `completed` row and press `i`: expected `interrupt: <description> is completed, not running`,
   and the subagent is untouched (the gesture is refused for a settled row).
6. **Exit**: `esc` or `q` returns to the chat screen.
7. **Empty list**: in a session with no subagents, `alt+a` still shows the team section; the subagent
   section reads `subagents  0 total · 0 running · 0 completed · 0 failed` followed by the host's own empty
   tone (`⚪ No subagents in the current session` and the hint line below it).
8. **The `/mpd` action**: `/mpd` opens the picker, which lists `Subagents`; `/mpd subagents` opens the same
   panel directly; typing `/mpd sub` and pressing Tab completes to `subagents`.
9. **Negative control (must hold)**: `ctrl+a` still opens the HOST's dashboard, unchanged. MPD never binds
   `ctrl+a`; `alt+a` is a different combo and is not in the host's reserved set.

## What a failure looks like

- Rows in the wrong order, or the team section missing → the composition regressed (see
  `test/subagent-scene.test.ts`).
- `alt+a` does nothing → the shortcut seam refused the combo; the boot diagnostic reports the
  `tuiShortcuts` outcome (`list()` is the read-back; a refusal prints the combos the host did confirm).
- A control character repainting the screen, or `[object Object]` in a row → the `sanitize.ts` boundary
  regressed (the suite has an arm for both).
- A crash that closes the scene → the host's `PluginSceneBoundary` reports it in the transcript; the
  scene must never throw from a render (`useInput`/render paths are all guarded).
