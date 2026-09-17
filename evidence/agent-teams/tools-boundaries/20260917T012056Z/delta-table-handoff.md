# Handoff — delta-table rows after wave 1 t9 (lane B1)

Owned file: `agent-references/agent-teams-deltas.md` (and the `AGENTS.md` §6 pointer to it).
I did NOT edit it: it is outside t9's `inScope` and the docs lane owns it. This file carries the
exact text to apply. Measured with `node scripts/patch-agent-teams-fixes.mjs --check` on
2026-09-17: **51 regions across 9 adopted files** (was 53).

## 1. Replace the D23–D26 row (was line 42) with these three rows

```markdown
| D23–D24 | the team watchdog's PRESERVING hold, where it MUST still act | `mpd-delta watchdog-hold-reader` (ADDITIVE, **`lib/scheduler.js` ONLY** after wave 1 t9), `mpd-delta kick-member-hold-decline` | narrowed by wave 1 (t9 / contract §5 D2): a hold stops **NEW DISPATCH only**. What SURVIVES is the dispatch half — the scheduler's own `watchdogHoldOf` reader (its three call sites) and the kick decline that logs a decline instead of dispatching. The `claim_task` / `update_task` TOOL-boundary guards were DELETED with `lib/tools.js`'s copy of the reader: a member must always be able to record what it finished and a wave's entry point must never be frozen. FAIL-OPEN (binding) is unchanged. Proof: `packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` (with a live hold, claim+update succeed; the ONLY hold reads carry `scheduler.js` frames; a re-injected guard in a scratch module copy still FAILS the same call) + the untouched `evidence/team-watchdog/pause/20260915T164700Z/`. |
| D25–D26 | REMOVED (wave 1, t9 / contract §5 D2) | `mpd-delta claim-task-hold-guard`, `mpd-delta update-task-hold-guard`, and `lib/tools.js`'s copy of `mpd-delta watchdog-hold-reader` | these three regions **no longer exist** and are not in the registry (53 → 51). Their ABSENCE is the fix: a hold may never refuse a member's own `claim_task` / `update_task`. **Do NOT re-add them on a re-materialize** — a re-materialized upstream `tools.js` would restore the guards, and `--check` cannot catch that (an ABSENT region is not a DRIFTED region). The pinned self-fix test above is the guard. |
| D27 | `lib/tools.js` `agent_teams_status` render | `mpd-delta status-pause-mechanisms` (ADDITIVE → DOES self-heal) | wave 1 (t9), T-19 adopted side: the status surface NAMES both pause mechanisms (`Pause: agent-teams halt ACTIVE|not active`) and DEFERS the team watchdog's hold to `session-watchdog-status`, naming its own `session-watchdog-resume` as the only releaser — the reader that could have read the hold here was deleted with D25–D26, and a hold must not be guessed at. No new resume verb is added. |
| — (marker-less) | `lib/tool-names.js` `MEMBER_TOOL_NAMES` | none (the file carries no `mpd-delta` marker — same documented class as A1–A4) | wave 1 (t9), T-49: `agent_teams_task_contract` moved into `MEMBER_TOOL_NAMES`, so BOTH deny computations — the spawn `toolFilter` in `lib/members.js` and the runtime `tools.restrict` in `lib/capabilities.js`, each derived as `TEAM_TOOL_NAMES` minus `MEMBER_TOOL_NAMES` — stop hiding the READ-ONLY contract surface from every seat. A human re-materialize of `lib/tool-names.js` would drop this silently; the pinned self-fix test and the mounted probe are the guards. |
```

## 2. Update the count / duplicate-id paragraph (was lines 44–50)

- `The live registry is **53** regions across **9** adopted files` → `The live registry is **51** regions across **9** adopted files` and append `(wave 1 t9 removed three regions and added one: 53 → 51)`; the measured date becomes `2026-09-17`.
- The duplicate-`id` example must move to the past tense: `mpd-delta watchdog-hold-reader` **was** such a pair (the identical `watchdogHoldOf` helper in `lib/tools.js` AND `lib/scheduler.js`); after wave 1 t9 it is **single-file** (`lib/scheduler.js` only). The RULE it illustrates is unchanged: an `id` is a LOGICAL delta, uniqueness is required of the CONTEXT PAIR PER FILE, never of the id.

## 3. Registry mechanics consequence (for `agent-references/agent-teams-deltas.md` §mechanics)

`--write-registry` was re-run after the deletions and the new region; it now reports **51** entries and
`--check` is clean. The new region's context pair was emitted by the tool (never hand-written), and
`lib/mpd-deltas.js` was not touched by hand at any point.
