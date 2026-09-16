# t62 (w7) — the SERVICE-PRIMARY revision of the preserving-pause gates

- **Task**: t62, attempt 2, attempt_id `528dcfea-5817-4bd3-aea3-d722e7d0aa96` — already **completed**
  when the captain's re-dispatch arrived carrying the binding instruction *"USE THE SERVICE YOU JUST
  BUILT — it is now the primary read for the gates"*. This directory records that revision; the
  task's terminal status is the captain's to change, not mine.
- **Revision**: `3dec3bd2994d78ae64c30e33118642987a0401cf`
- **Supersedes** `evidence/team-watchdog/pause/20260915T163526Z/` (the file-read iteration of the
  same regions), which is left untouched as a record.

## What changed, and why it is sound

The gates no longer read the durable file themselves. Each of the five call sites now asks the
watchdog's own service:

```js
const watchdog = ctx.get("mpdWatchdog", false)
const hold = watchdog?.isHeld(teamId, workspace)     // synchronous, non-throwing
if (hold?.held === true) → decline, with a named log line
```

The **file stays the durable record** and is now read in exactly ONE place — inside the service
(hydrated at apply, updated on every hold/resume that process performs, with its own file fallback
for a hold another process wrote). Region ids are unchanged; only their bodies are.

The design depends on one kernel fact, so it is quoted from the vendored kernel rather than assumed
(`packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.js`):

```js
/** Read a service from the store without the inject requirement. */
get(name, strict = true) { return getTraceable(this.ctx, this._getImpl(name, strict)?.value) }
```

and it is **measured**, not just read: check K1 mounts two sibling rows on a REAL cordis root — one
`ctx.provide("mpdWatchdog", …)`, the other reading `ctx.get("mpdWatchdog", false)` with **no inject
declaration** — and gets the service (`crossRowHeld: true`, `crossRowNotHeld: true`). K2 shows an
absent service reads as `undefined`, never a throw.

## The checks (33/33 green — `raw/driver.result.json`, driver re-runnable)

```
A   control: no watchdog row, no hold => dispatched                     (1 delivery)
B0  the watchdog row publishes mpdWatchdog
B   service present, not held => dispatch proceeds                      (1 delivery)
C1  the service reports the hold it was given
C2  held => NOTHING dispatched                                          (0 deliveries)
C3  declines from BOTH the team gate and the member gate, named lines
C4  the line names the same hold id the service returned
C7  the IN-LOCK gate refuses a hold that lands while the kick waits     (asked: 2, 0 deliveries, names hold-locked)
D1  the SERVICE answers a foreign hold with source:'file' on the first read
D2  the same read is then served from memory                            (cross-process caveat, measured)
D3  the gate declines on the foreign hold too
E0  no watchdog row => no mpdWatchdog service
E1  FAIL-OPEN: service absent, a held-looking FILE present => DISPATCHED (1 delivery, 0 watchdog lines)
F1  the adopted record's bytes are unchanged while held
F2  status/attemptId/attempt/output/handoffId all survive
F3  nothing was cancelled
G1  claim_task refused with the named watchdog reason
G2  update_task refused with the named watchdog reason
G3  the refusals changed NO record byte
G4  after the resume the boundary no longer reports the hold
I1  a second hold writes no second hold and interrupts nothing
H1  session-watchdog-resume clears the hold      H2 the service agrees the team is free
H3  dispatch resumes through the existing kick machinery (1 delivery)
H4  the resumed task carries a live attempt of its own
I2  a resume for a non-held team is {resumed:false, reason:'not-held'}
H5  a still-claimed attempt is frozen while held and RE-ARMED on resume (attempt 2 -> 3)
J1  a THROWING service reader is swallowed and dispatch proceeds
K1  REAL cordis: a sibling row resolves the service with NO inject declaration
K2  REAL cordis: an absent service reads as undefined, not a throw
```

The declines, verbatim from the captured log:

```
agent-teams: dispatch declined for pause-probe/*: the team is held by the team watchdog (hold 57d055e7-… since …: silence)
agent-teams: dispatch declined for pause-probe/Architect: the team is held by the team watchdog (hold 57d055e7-… since …: silence)
```

## The four declared verify commands

```
$ node scripts/patch-agent-teams-fixes.mjs --check
[patch-agent-teams-fixes] already applied: 53 mpd delta region(s) across 9 adopted file(s)
exit=0

$ bun test packages/mpd-agent-teams-plugin
 220 pass   0 fail   1615 expect() calls   Ran 220 tests across 60 files.
exit=0

$ bun test packages
 699 pass   0 fail   Ran 699 tests across 134 files.
exit=0

$ bun run typecheck
$ tsgo --noEmit
exit=0
```

Delta: one `--write-registry` run; `scheduler.js` **58 insertions / 0 deletions**, `tools.js`
**60 / 0** (both smaller than the file-reading version — the `node:fs` import and the mtime cache are
gone), `mpd-deltas.js` 63/2 where both deletions are that **generated** file's own regenerated
`block:` strings. No reflow, no reformat.

## Not claimed, and one note for whoever reads the file next

- No `haltTeamWork` negative control (w8's lane); `haltTeamWork` is never called.
- No live `dsh` boot: real adopted scheduler + real watchdog dist through stub harness contexts, with
  the kernel-resolution semantics measured on the real cordis. "Fires inside a full host process" is
  not claimed.
- The field-schema discrepancy I reported earlier is now **moot for enforcement** (the gate reads the
  service view), but it stands for anyone reading the file directly: the dispatch text described the
  reader-view spelling `{teamId,holdId,at,reason,actor,source}`; w3 writes
  `{id,teamId,since,cause,taskId,attemptId,sceneAt}`. w3 stays out of scope and unchanged.
- No re-arm claim for an attempt the parked map considers currently parked with the same id
  (`scheduler.js:515-518` deliberately does not re-dispatch it).
