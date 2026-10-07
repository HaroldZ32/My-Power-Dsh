# Honesty note — what is achieved, and what is NOT (Lane C)

**ACHIEVED.** An MPD-owned scene (`mpd-tui-subagents`) renders the TUI's OWN subagent array —
`props.channel.subagents`, the same channel object `Ctrl+A`'s dashboard renders from — as its TOP section,
and the MPD team panel (team header/roster/tasks/mail plus the `graph.ts` DAG box) BELOW it. It opens from
MPD's own `alt+a` and `/mpd subagents`. This is a real DATA-level merge: MPD teammates are ordinary
continuable subagents, so they already appear in the host's array — the panel simply shows both views at once.

**NOT ACHIEVED — the literal request.** It is NOT a merge INTO dsh-tui's `SubagentDashboard`. Measured on
dsh-tui 0.12.0: `TuiSceneDescriptor` is `{id, title, component}` (no slot/section/panel field);
`SubagentDashboard` is a Chat-LOCAL early return (Chat.js swaps the whole screen for it) and is not an
importable contribution target; the plugin surface has no panel/section contribution kind. So the team rows
sit BELOW the host's rows inside an MPD scene — they do not appear INSIDE the host's panel. Landing the
literal merge needs the upstream seam requested in parallel (a `TuiSceneDescriptor.slot`, a panel registry,
or a row hook).

**ALSO NOT ACHIEVED.** The DAG is drawn but NOT interactive here: no click-to-pin, no hover detail, no
scrolling inside the merged panel. The team scene (`alt+t`) remains the interactive surface. And `alt+a` is a
NEW MPD combo, not a rebinding of the host's `Ctrl+A` — MPD never registers `Ctrl+A`.
