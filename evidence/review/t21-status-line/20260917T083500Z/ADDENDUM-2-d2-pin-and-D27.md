# ADDENDUM 2 (nested beside the sealed t32 record) — the D2 pin's assertions and the D27 many-to-one row

**Task:** t32 (review of t21) · **Reviewer:** code-reviewer · **Written:** 2026-09-17 after lane A's pointers
`result.json` is NOT edited; this page quotes two shipped assertions I had executed but not quoted.

## 1. The D2 pin — "the display read gates nothing" is asserted, not merely read by me

`packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs`, case `D2: the two tool-boundary guards and tools.js's reader copy are gone; scheduler keeps its own` (this case is INSIDE the file I ran green at 7 pass / 0 fail in the verdict):

* `expect(tools).not.toContain("mpd-delta claim-task-hold-guard")` and `…update-task-hold-guard` — the two tool-boundary guards are DELETED from `lib/tools.js` and are absent from the registry (`MPD_DELTAS.filter(...)` length 0);
* `expect(tools).not.toContain("watchdogHoldOf")` and `…"mpd-delta watchdog-hold-reader"` — tools.js carries **no copy** of the hold reader;
* the surviving half is asserted in `lib/scheduler.js`: `expect(scheduler).toContain("mpd-delta watchdog-hold-reader")`, `…"function watchdogHoldOf(ctx, teamId, workspace)"`, and the registry's reader entries number **1**, its file ending in `scheduler.js`.

So the "display read gates nothing; the dispatch gate stays in the scheduler" claim is covered by a shipped, executed pin — my verdict's version rested on the same facts read from the source, and this addendum upgrades it to a quoted assertion.

## 2. The D27 row documents THREE regions (many-to-one), and the count sentence reads 81/9

`agent-references/agent-teams-deltas.md`:

* **D27** (the `agent_teams_status` pause surface) names all three regions: `mpd-delta status-pause-mechanisms` (the ONE line), `mpd-delta pause-surface-helper` (ADDITIVE — the display read + `describePause`), `mpd-delta pause-surface-apply` (ADDITIVE — the read in the status execute), and states "**MANY-TO-ONE: this row now documents THREE registered regions**".
* The count line reads "the live registry is **81** regions across **9** adopted files", with the chain recorded to t21's two pause-surface regions, and the wave-1 peer wording (`· team watchdog hold:` / `run session-watchdog-status`) named as asserted-ABSENT by the drift pin.

My verdict measured the three regions present **1/1 in registry AND source** and `verify:docs` carrying **81/9 vs derived 81/9**; this addendum adds the row-level text that ties those three ids to the D27 documentation, so "registry ↔ count sentence ↔ row" are all three quoted.
