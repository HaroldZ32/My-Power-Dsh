# PREPARED PATCH — `agent-references/agent-teams-deltas.md` (D27 row + count sentence)

**Why:** the D27 row describes the wave-1 pause surface ("NAMES both pause mechanisms … DEFERS the hold
to `session-watchdog-status`, naming its own `session-watchdog-resume` as the only releaser"). After
t21's collapse that description is FALSE — the status line names ONE mechanism and reports the hold as
its internal implementation, with the hold's id/reason inline. The registry also gains TWO regions
(`pause-surface-helper`, `pause-surface-apply`), so the count sentence must move in the SAME change
(the derived-count rule; measured: **79 → 81** regions across 9 files).

**Range pointer stays A1–D42**: the two new regions are documented INSIDE the existing D27 row (they are
the same T-19 surface work: the one line, its helpers and the payload wiring), so `AGENTS.md` and
`agent-references/index.md` need no hop — the same folding choice t24 made for D40.

## D27 row — proposed replacement text

| D27 | `lib/tools.js` `agent_teams_status` pause surface | `mpd-delta status-pause-mechanisms` (the ONE line), `mpd-delta pause-surface-helper` (ADDITIVE — the display read + `describePause`), `mpd-delta pause-surface-apply` (ADDITIVE — the read in the status execute) | wave 1 (t9) put ONE mechanism's name on this surface; **wave 2 (t21) collapses it to ONE mechanism as the user's T-19 ruling requires**: `agent_teams_halt` is the SOLE external pause mechanism, and the team watchdog's PRESERVING hold is reported as its **INTERNAL implementation** — the operator still gets the hold's id, timestamp and reason inline instead of being sent to a second status surface, and the wave-1 peer wording (`· team watchdog hold:` / `run session-watchdog-status`) is asserted ABSENT by a drift pin. The hold is read for **DISPLAY ONLY** through the watchdog's own service (`ctx.get('mpdWatchdog', false)` → `isHeld(teamId, workspace)` — the surviving dispatch half keeps its own reader region in `lib/scheduler.js`); the read is fail-open and **gates nothing** — the tool-boundary guards stay deleted (D25–D26), because a hold stops NEW DISPATCH only. The status tool's declared output schema is unchanged (`additionalProperties: true`); the collapsed view rides an additive `pause` field. Proof: `self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` (requalified T-19 pin + the fail-open pin), `evidence/agent-teams/pause-surface/20260917T082935Z/`. |

## Count sentence — proposed replacement

> The live registry is **81** regions across **9** adopted files — the count MEASURED at this edit
> (2026-09-17, `node scripts/patch-agent-teams-fixes.mjs --check`) with the full chain recorded: the
> table used to say 53; wave-1 t9 took it to 51 (three regions deleted, one added), t14 to 59, t19 to
> 65, t20 to 71, and t36's two ADDITIVE regions to **73**; wave-2 lane A (t8) then added **five** (D39–D42
> + the `strict-tool-arguments-apply` call region; `--write-registry` reported `78 regions`), t24 added
> ONE (T-73, documented in the D40 row because it lives in the SAME function; `79 regions`), and t21
> added TWO for the pause surface (documented in the D27 row; `81 regions`). The number with measuring
> authority is the last one; every earlier number is provenance. …

**Also needing a check in the same change:** `verify:docs`'s derived arm reads that sentence against
`lib/mpd-deltas.js`, so the sentence and the registry must move together (this is the window lane B2's
rule exists to make loud).
