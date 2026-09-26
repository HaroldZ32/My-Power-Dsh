# t54 — REPAIR: the hold-enforcement reader (AMENDMENT 2 / A2-1)

- **Task**: t54 (the w3 watchdog core), attempt 2, attempt_id `ad5aacf7-0fbe-4b84-bf57-e07e5a403d3b`
- **Trigger**: the captain's t54 briefing arrived late (it was written before the first run, hence its
  "`packages/mpd-team-watchdog-plugin/` does not exist"). It carries **AMENDMENT 2** of the frozen
  plan, which the first run had never read.
- **Final revision**: the whole gate set below was re-run at revision `3dec3bd2994d78ae64c30e33118642987a0401cf`
  *with the w4 knob-declaration edits already in the working tree*, so nothing here is stale against a moving checkout.
- **Evidence**: this directory — a NEW timestamp, because the briefing forbids writing into an
  existing evidence directory. The first run's evidence at
  `evidence/team-watchdog/plugin/20260915T160657Z/` is untouched.

## The recon miss this repair fixes (disclosed, not hidden)

The plan file `.mpd/plans/team-watchdog.md` carries **AMENDMENT 2** at lines 419-483. Its mtime is
**23:49:35 local (15:49:35Z)**; the first package file was written at **23:57:12 local (15:57:12Z)**.
The amendment therefore existed **before** the first line of code, and my recon read the plan's
§0–§3 and §9 but never its tail. That is a real miss on my part.

What the miss cost: **A2-1**. It says a bare sidecar cannot enforce the pause — `state.js` owns
`team.json` and every reader path goes through `readTeam`, so the three scheduler decline gates are
blind to a sidecar — and it requires w3 to *name* the option it implements and *expose the reader
signature* w7 will match. The first run shipped the durable sidecar with **no reader**.

A2-4/A2-8 (heartbeats, captain coverage, POST-only tool stamps, zero adopted edits), A2-5 (host-plane
row) were already satisfied; A2-2/A2-3/A2-6/A2-7 target w4/w6/w7/w9 and change nothing here.

## What the repair adds

**Option (b), named explicitly** — the sidecar stays the durable, authoritative record **and** the
row publishes a stable synchronous reader:

```js
const watchdog = ctx.get("mpdWatchdog", false)          // undefined when this row is absent
const hold = watchdog?.isHeld(teamId, workspace)         // synchronous, never throws
if (hold?.held) return noteDispatchDecline(/* … */, "held by the team watchdog")
```

| Member | Signature |
|---|---|
| `isHeld` | `(teamId, workspace?) => { held, holdId, at, reason, taskId, attemptId, workspace, source }` |
| `holds` | `(teamId, workspace?) => boolean` |
| `list` | `() => Array<{workspace, teamId, holdId, since, cause, taskId, attemptId}>` |
| `hydrate` / `hydratedRoots` | `(roots?) => number` / `() => string[]` |
| `gateCall` | the documented gate expression, so the contract travels with the code |

* **Fail-open** — the row absent ⇒ the service absent ⇒ `isHeld` is never called ⇒ dispatch behaves
  exactly as today. The watchdog can only ADD a decline.
* **Cross-process** — the map hydrates at apply and updates on every hold/resume this process
  performs; an unknown team costs ONE small file read, which is how a second process learns of a hold
  another process wrote (no restart, writer need not be alive).
* **Non-throwing** — a decline gate runs in the scheduler's hot path; every member is guarded.

Two further fixes came out of reading the amendment set against the code:

1. **Per-tick knob re-read.** The `mpd` namespace is registered *deferred* (mpd-config parks its
   registration on the settings service), so a row that applied first would sit on its row-config
   defaults until somebody edited settings — live tuning would appear broken. The tick now re-reads the
   knobs on **every** tick as well as on `settings/document-updated`.
2. **Row placement.** The row moved directly beneath `mpd-config` (patch line 227, the neighbour A2-5
   names) — still the host plane, now matching the locator too. `git diff --stat` on the patch is
   **19 insertions, 0 deletions**.

## Raw evidence

```
$ bun run typecheck
$ tsgo --noEmit
exit=0
```

```
$ bun test packages/mpd-team-watchdog-plugin
 52 pass
 0 fail
 220 expect() calls
Ran 52 tests across 12 files.
exit=0
```

```
$ node scripts/verify-rows-parity.mjs
[verify-rows-parity] ok: 25 row ids match the bundle patch insert list (… mpd-team-watchdog …)
exit=0
```

```
$ bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
[bundle-lifecycle] PASS
exit=0
```

The mounted boot's own line (raw/mount-boot.log, line 4) — the new field is the proof that `ctx.provide`
exists on a row context and the service really published:

```
[mpd-team-watchdog] applied: enabled=true warnSilenceMs=90000 tickIntervalMs=15000 warnStreakToEscalate=3 actionOnEscalate=pause stateDir=.mpd/team disposers=5 holdService=mpdWatchdog hydratedHolds=0
```

```
$ node skills/dsh-qa/scripts/preset-conformance.mjs
[preset-conformance] PASS
exit=0
```

Extra gates: `bun test packages` → **686 pass / 0 fail**; `verify-docs-parity` → **pairs=34 failed=0**
(the new bilingual section keeps both heading trees identical); `git status --porcelain
packages/mpd-agent-teams-plugin` → **empty**.

## The reader, measured end to end (raw/driver.result.json → holdReader)

```
published            : true
members              : [gateCall, holds, hydrate, hydratedRoots, isHeld, list]
hydratedRoots        : [ …/raw/ws ]
gateCall             : ctx.get("mpdWatchdog", false)?.isHeld(teamId, workspace)?.held === true
gateBeforeEscalate   : false
gateAfterEscalate    : true          ← the ESCALATE really made the team un-dispatchable to w7
view                 : { held:true, holdId:"b99eafec-…", at:…, reason:"silence", taskId:"t1", attemptId:"att-1", source:"memory" }
otherTeam            : false
after a FOREIGN hold file was written by "another process":
  otherTeamView      : { held:true, holdId:"h-foreign", at:4242, source:"file" }   ← the cheap file fallback
  gateOtherTeamAfterForeignWrite : true
  otherTeamSecondRead: "memory"                                                   ← then cached
```

Tick shape and the untouched adopted record are unchanged from the first run:
`{tick1:['warn'], tick2:['warn'], tick3:['escalate'], tick4:[]}` and
`adoptedRecordUnchanged.identical === true`.

## Board state

t54 was already `completed` when this repair started, so no status transition is claimed here. The
work is on disk and verified; whether the repair is recorded by re-opening t54 or by a follow-up task
is the captain's call.
