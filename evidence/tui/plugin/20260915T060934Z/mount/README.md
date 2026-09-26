# t23 live mount lane — what each capture proves (and what it does NOT)

Environment: the warm sandbox `.mpd/recon/qa/` (`dshhome/` profile with
`@deepseek-harness-tui/dsh-tui@0.10.1` + this bundle linked at
`/root/dshProj/my-power-dsh`; `home/` sandbox HOME seeded with one workmate,
`demo-workmate`). Every run is a real `dsh-tui` boot inside tmux (one process per
run, `pipe-pane` raw capture, `kill-server` at the end — a tmux server does not
survive a shell invocation). Six runs total (A–F).

| Capture | Surface | What the pane shows |
|---|---|---|
| `01-boot.pane.txt` | `tuiStatus` | `mpd: team MPD Default 11·0/0 · plans 3 · workmates 1 · notes 1` rendered ABOVE the prompt box (the convention's placement) |
| `02-mpd-status.pane.txt` | `/mpd status` handled by the plugin | same status line, and the pane contains **no** model fallback (`turn error` / `no API key` count = 0), unlike the pre-repair run |
| `03-mpd-picker.pane.txt` | `tuiDialogs` + bare-command grammar | the picker dialog with `Board / Workmates / Status`, footer `Enter to select · Esc to exit` |
| `04-board-scene.pane.txt`, `11-board-by-command.pane.txt` | `tuiScenes` | the board scene: team/members/tasks/boulder/plans/workmates rows, my `esc/q close · r refresh` footer, opened by the picker/command |
| `13-board-by-shortcut.pane.txt` | `tuiShortcuts` | the same scene opened by `alt+m` (Meta-m), i.e. a registered shortcut really fires |
| `14-workmate-dialog.pane.txt` | `tuiDialogs` (`alt+w`) | `mpd workmates` dialog listing the seeded `demo-workmate` + `qa-tui-probe`, `Enter to select · Esc to exit` |
| `15/31-settings-scrolled.pane.txt` | `tuiSettingsSections` + t21 disclosure | `╭─ MPD bundle (mpd) ── … [applies on restart] ╮` with all six fields, and the selected field's hint on screen: `mpd.jsonc hashline.maxDiffChars — not bridged: a save here does not rewrite .mpd/mpd.jsonc` |
| `16-command-completion.pane.txt` + run F raw | `tuiCommandTrees` | the completion popup `╭─ commands · 1 items ─╮` / `│ ❯ mpd board   Open the mpd board scene │` — the provider's child with its own description |
| `12/20/30/50` | transcript / scene exit | scene exit returns to the chat; the status line survives; the workspace-scoped line changes with the session's workspace (run E showed `mpd: team - · plans 0 · workmates 2` for a different workspace) |
| `session-log-evidence.json` (this directory's parent) | `/mpd` + log-only event | durable `command/run` records with `name:"mpd"` and `mpd-tui/board-opened` events in the concatenated-zstd session store |
| `../ledger-status-records.jsonl` | `tuiStatus` effects | the host effect ledger records our `replace status` contributions (and the fix that followed: publishes are now deduped to the CHANGED text only, because a fixed-cadence republish churned the ledger) |

## NOT demonstrated (recorded as failed, carried to t8/t12)

> **SUPERSEDED CAUSE — do not cite the paragraph below as the cause.** It attributes
> the missing renderer row to the channel capturing its renderer facade once
> (`channel.ts:255-259`, "no local fallback"). That attribution is WRONG and was
> retracted by the same author after six further instrumented boots: the verified
> cause is that the host refuses a plugin renderer for a type it already knows, so a
> renderer only ever fires for a NEVER-BEFORE-SEEN type on the first boot that uses
> it — see `renderer-type-probe/FINDING-CORRECTION.md` and probe9 there. The verdict
> is unchanged (no demonstrable renderer line); only the cause is corrected.

**A `tuiRenderers` transcript line was never observed.** Across six real boots —
including one with the append moved BEFORE the scene opens and one replay attempt
— no `mpd board` renderer row and no `opened via …` text appears in any pane or in
the ANSI-stripped raw log, while the session log provably carries
`mpd-tui/board-opened`. Host-side analysis (read-only, host revision b246411):
`src/dsh-adapter/channel.ts:255-259` captures the renderer facade ONCE when the
channel is constructed —
`const rendererRuntime = getHostRenderers(ctx.get('tuiRenderers') …)` — and, unlike
the sibling `tuiSettingsSections` (which has `getLocalSettingsSectionsHost()`
fallback for the documented "row disposed right after load" case, issue #557),
there is NO local fallback for renderers: when that `ctx.get` yields nothing at
construction, plugin events stay invisible for the whole session. The type shape
is not the cause (`TYPE_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/u` accepts
`mpd-tui/board-opened`), and a plugin cannot distinguish an accepted registration
from a refused one (both return a disposer) — which is exactly why the seam
reports `requested`, never `confirmed`.


## CORRECTION (measured after this evidence was written)

The analysis below attributes the missing renderer row to the channel capturing
its renderer facade once at construction. That attribution was WRONG. Follow-up
instrumented boots (see `renderer-type-probe/FINDING-CORRECTION.md`) isolate the
real mechanism: the host treats an event type that a PREVIOUS boot already
persisted as built-in, refuses the plugin's renderer for it, and has no host-side
projection for it — so the row can never appear again. The same boot rendered a
never-used type and a control type normally, and the effect-ledger absence noted
earlier is explained by `tuiEffectLedger` being unreachable from the service's
ctx (probe-measured `ledger: absent`), not by a refused registration.

The verdict is unchanged: the `tuiRenderers` transcript line is NOT demonstrated
and cannot be, stably, for any type this bundle appends.
