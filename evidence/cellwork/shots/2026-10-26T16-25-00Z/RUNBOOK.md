# Nested-DAG captures (cellwork wave 4) — the reproducible recipe

The four committed images (`docs/assets/images/{,zh-CN/}web-team-dag-groups.png` and
`tui-team-dag-groups.png`) were produced from the fixture below, NOT by hand.

## The served model (asserted BEFORE any capture)

`bun .mpd/readme-ref/nested/nested-fixture.ts --verify <workspace>` prints, and the capture refused to
proceed without:

- `groups.length = 1`, ids `["team-nested-sub"]`, memberIds `[::C1, ::C2, ::C3, ::C4]`
- the box pseudo-node `team-nested-sub`, `visual: "group"`, depth 3, blockers `["T4"]`
- both anchored edges: `T4 -> team-nested-sub` and `team-nested-sub -> T5`
- `nodes.length = 11` (six root tasks, the box, four interior tasks)

The records: `team-nested-parent` (root board T1..T6) and `team-nested-sub` with
`parentTeamId: "team-nested-parent"` (interior C1..C4), both live/approved — written by
`nested-fixture.ts --write`.

## WEB

The Docker `mpd-ui-view` image ships a stale bundle (0.15.1). The capture therefore patches the
CURRENT checkout's `mpd-team-core-plugin/dist/index.js`, `mpd-bundle-plugin/dist/index.js` and
`mpd-bundle-plugin/client.js` into the installed profile, restarts the web app with its own home
(`HOME=/data/home DSH_HOME=/data/dsh-web`), seeds the two records into `/data/ws/.mpd/team/teams/`,
binds every session id from `/data/dsh-web/sessions/*/` in `teams.json`, then runs
`.mpd/readme-ref/nested/shot.mts` (Playwright; `PLAYWRIGHT_BROWSERS_PATH=/data/pw-browsers`) at
`viewport 2300x1500, deviceScaleFactor 2`, scrolling the graph right so the box is in view. It asserts
`frames: 1` with `groupRects: ["team-nested-sub,510,0,384,114"]` and ten cards (six root + four
interior inside the frame).

## TUI

Sandbox DSH_HOME from `node scripts/install-profile.ts --yes --profile mpd --dsh-home <sandbox/home>`
(pointing at the checkout), prefs `{completed:true,version:1}` + `{preset:"mpd"}` under
`<sandbox/userhome/.dsh-tui/`, booted in tmux 160x62 (the taller pane keeps the frame's BOTTOM border inside the capture — at 44 rows the box closed below the viewport and the earlier image showed only the top border):
`env -i DSH_HOME=… HOME=… DSH_TUI_LANG=en|zh-CN DSH_TUI_NO_LAUNCHPAD=1 DSH_TUI_WORKSPACE_TARGET=<ws> dsh-tui`,
then `/mpd dag`, an SGR mouse click on the page's `⤢` cell (full screen), `tmux capture-pane -e -p -J`,
and the TRACKED `docker/ui/tui-render.py --scale 2` (byte copy in this directory; the older `.mpd/readme-ref/tui-render.py` variant was NOT used — it lacks the tracked renderer's wide-glyph split). The frame assertion: the pane carries
`╔ subcell-auth ═…╧…╗` and the interior cards (`team-nested-sub::C1..C3`). A CLICK is required because the
narrow sidebar collapses the group (contract D3's declared bound).
