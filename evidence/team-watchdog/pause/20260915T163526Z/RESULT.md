# t62 — w7 THE PRESERVING PAUSE: enforcement result

- **Task**: t62 (implementation), attempt 2, attempt_id `528dcfea-5817-4bd3-aea3-d722e7d0aa96`
  (the dispatch text promised attempt 1 / `09871ebc-…`; `claim_task` returned attempt 2 and that
  return value is the authoritative capability — every update carried it).
- **Revision**: `3dec3bd2994d78ae64c30e33118642987a0401cf`
- **Evidence**: this directory (`driver.mjs` is standalone and re-runnable; `raw/` holds every log
  and the fixture workspace it leaves behind).

## What was wired

The hold is ENFORCED, at every place the adopted plugin already declines work, plus the tool
boundary — all ADDITIVE, and the resume path is untouched except that it now actually releases
dispatch.

| Site | Shape | What it does |
|---|---|---|
| `scheduler.js` — module scope | **NEW region** `mpd-delta watchdog-hold-reader` | the synchronous, fail-open hold reader (no cross-package import, no service) |
| `scheduler.js` — `kickTeam` | INSIDE the existing `mpd-delta kick-team-decline-logs` region | declines the whole team with a named reason |
| `scheduler.js` — `kickMember` | **NEW region** `mpd-delta kick-member-hold-decline` | declines one member's dispatch |
| `scheduler.js` — the locked re-read | INSIDE the existing `mpd-delta kick-member-locked-decline-logs` region | declines again after the lock, so a hold that lands mid-kick still wins |
| `tools.js` — module scope | **NEW region** `mpd-delta watchdog-hold-reader` | the same reader for the tool boundary |
| `tools.js` — `agent_teams_claim_task` | **NEW region** `mpd-delta claim-task-hold-guard` | loud named refusal (the claim path had NO halted guard — measured) |
| `tools.js` — `agent_teams_update_task` | **NEW region** `mpd-delta update-task-hold-guard` | loud named refusal, so a member holding an attempt cannot keep working a held team |

`--write-registry` ran **exactly once**: `registry regenerated: packages/mpd-agent-teams-plugin/lib/mpd-deltas.js (53 regions)`,
and `--check` is clean at **53 regions across 9 adopted files** (was 48). The adopted sources carry
**zero deletions** (`scheduler.js` 70/0, `tools.js` 72/0); the registry's 2 deletions are its own
regenerated `block:` strings for the two in-region edits.

## The read contract, and one discrepancy I must report

The dispatch described the file as `{ teamId, holdId, at, reason, actor, source }`. That is the
watchdog's **reader-view** spelling. What w3 actually writes — verified in
`packages/mpd-team-watchdog-plugin/src/sidecars.ts` (`HoldRecord`) and in a file the plugin wrote on
disk — is `{ id, teamId, since, cause, taskId, attemptId, sceneAt }`.

The gate therefore **accepts both spellings** (`holdId ?? id`, `at ?? since`, `reason ?? cause`) and
treats only the absence or unreadability of the file as "not held". w3 is terminal and out of this
task's scope, so nothing was changed there — the discrepancy is reported, not papered over.

**FAIL-OPEN (binding, implemented):** no file, no watchdog row, an unreadable path or a parse
failure all mean NO hold. Cost per gate call: one `statSync` plus at most one `readFileSync`, cached
by `(path, mtimeMs, size)` with a bounded cache — no hot-path I/O.

## Raw evidence (27 checks, all green — `raw/driver.result.json`)

```
$ bun driver.mjs
driver ok: True | checks: 27 | all passed: True

A1 CONTROL: without a hold the member IS dispatched                    (1 delivery)
A2 held: nothing dispatched, decline named `hold hold-a2 … silence`    (0 deliveries, 2 named lines)
A3 held: the pooled task is left in the pool too                       (both tasks still pending)
B  preservation: sha256(team.json) UNCHANGED; in_progress/att-live/attempt 3/output/handoffId survive
C1 the {holdId,at,reason} spelling also enforces
C2 fail-open: a corrupt hold file does NOT block dispatch              (1 delivery)
C3 fail-open: no hold file => dispatch exactly as before               (1 delivery, 0 watchdog lines)
C4 cache: clearing the file is observed without a restart
D1 the plugin's own session-watchdog-hold writes the durable hold
D2 the dispatch gate and the tool boundary read ONE hold
D4 session-watchdog-resume clears the hold
D5 dispatch resumes through the existing kick machinery                (1 delivery)
D7 a still-claimed attempt is frozen while held and RE-ARMED on resume (attempt 2/att-live-2/`kept` -> attempt 3)
E1 claim_task refused: "team pause-probe is held by the team watchdog (hold 1b752647-…): …"
E2 update_task refused with the same named reason
E3 the refusals changed NO record byte
E4 after the resume the boundary no longer reports the hold
F1 a second hold writes no second hold (byte + mtime identical) and interrupts nothing
F2 a resume for a non-held team is {resumed:false, reason:'not-held'}
```

The declines come out in the plugin's existing log shape:

```
agent-teams: dispatch declined for pause-probe/*: the team is held by the team watchdog (hold hold-a2 since 2026-09-15T16:36:18.900Z: silence)
agent-teams: dispatch declined for pause-probe/Architect: the team is held by the team watchdog (hold hold-a2 since 2026-09-15T16:36:18.900Z: silence)
```

## The four declared verify commands

```
$ node scripts/patch-agent-teams-fixes.mjs --check
[patch-agent-teams-fixes] already applied: 53 mpd delta region(s) across 9 adopted file(s)
exit=0

$ bun test packages/mpd-agent-teams-plugin
 220 pass
 0 fail
Ran 220 tests across 60 files.
exit=0

$ bun test packages
 695 pass
 0 fail
Ran 695 tests across 134 files.
exit=0

$ bun run typecheck
$ tsgo --noEmit
exit=0
```

**Disclosed:** two EARLIER full-suite runs in this session were red (13 fails, then 1 fail), with
every failure confined to `packages/mpd-bundle-plugin` (page rendering, badge polling) while another
writer was actively rewriting `packages/mpd-bundle-plugin/client.js` (mtime moved
`00:37:33 → 00:41:00 → 00:41:43` across those runs). That package alone, and together with mine in
one process, is green:

```
$ bun test packages/mpd-agent-teams-plugin packages/mpd-bundle-plugin
 288 pass
 0 fail
```

so the reds were foreign and load-order/timing dependent, not caused by these regions. The final
settled run is the 695/0 above. The red runs were not captured into `raw/` (the log file was reused);
they are recorded here rather than presented as a clean history.

## Regions

```
scheduler.js   13   (11 before + this task's 2 new ids)
tools.js       20   (17 before + this task's 3 new ids)
quality-gates.js 7 · state.js 4 · profiles.js 3 · index.js 2 · session-start.js 2 · members.js 1 · command.js 1
total          53   across 9 adopted files
```

## Not claimed

- No `haltTeamWork` negative control (plan AC-17's `--case pause-preserves-halt-control`) — that is
  w8's fault-injection lane; this driver never calls it and its cancel loop was not touched.
- No live `dsh` boot: the driver drives the REAL adopted scheduler and the REAL watchdog plugin
  through stub harness contexts (the shape the plugin's own `dispatch-stall-regression` test uses),
  so "the gates fire inside a real host process" is not claimed here.
- Re-arm is NOT claimed for an attempt the parked map considers currently parked with the same id —
  `scheduler.js:515-518` deliberately does not re-dispatch that case (upstream's "a resident idle
  member may keep an attempt open" policy). D7 measures the recovery branch that does re-arm.
