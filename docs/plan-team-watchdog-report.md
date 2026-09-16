# The team watchdog wave (w1–w13) — acceptance ledger, evidence index and NOT-CLAIMED list

**What this is.** The integration record of the team-watchdog wave: one row per acceptance criterion of
`.mpd/plans/team-watchdog.md` §3 (AC-1…AC-17) with its final status, the artifact that establishes it and
the task that produced it; one consolidated NOT-CLAIMED section; the two post-terminal amendments; the
wave's review history **including its three `needs_revision` rounds**; the platform/process gaps measured
here for the follow-up `fix/` branch; and a path-existence check the report itself ran.

**Written by** task `t78` (integration). **Read-only everywhere else**: no `packages/**`, `skills/**`,
`docs/**`, `VENDOR_LOCK.json` or `AGENTS.md` was touched; the only writes are this file and
`evidence/team-watchdog/integration/<ts>/`. No git command was run.

**Revision the ledger is anchored to.** The tree as it stood at the end of the wave: docs-parity gate
`scripts/verify-docs-parity.mjs` (t76's repair), watchdog `dist/index.js` per `evidence/team-watchdog/plugin/20260915T173604Z/`,
adopted registry **53 regions across 9 files** (`node scripts/patch-agent-teams-fixes.mjs --check` →
`already applied: 53 mpd delta region(s) across 9 adopted file(s)`, exit 0), `VENDOR_LOCK.json` skills
**316 / `10c945f47a5e645e0ecd9e4bce198b3a314389407f4681fd8906b988f8e7f3bb`** (`verify-vendor` PASS).

**Status vocabulary.** `passed` = an on-disk artifact establishes the claim. `passed / not-claimed (leg)`
= the mechanism is established but a named clause of the AC was NOT witnessed in this environment — the
limit is carried, never upgraded. `not-claimed` = nothing on disk establishes it. No row is restated from
memory: every artifact below was read or measured by this task.

---

## 1. The wave, task by task

| Task | Owner | Deliverable | Status | Evidence root |
|---|---|---|---|---|
| t52 | Architect (read-only) | w1 design freeze | completed; text persisted by t56 | `evidence/team-watchdog/design/DESIGN.md` |
| t53 | Explorer (read-only) | w2 seam audit | completed; text persisted by t56 | `evidence/team-watchdog/seam-audit/20260915T154132Z/REPORT.md` |
| t54 | Deep Worker | w3 core package + `mpdWatchdog` service | completed (+ amendment 1) | `evidence/team-watchdog/plugin/20260915T160657Z/`, `…/20260915T162351Z/` |
| t58 | Reviewer (read-only) | pool-capability guard miss: root cause reproduced | completed, **no fix applied** | `evidence/team-watchdog/pool-guard/20260915T1745Z/` |
| t60 | Junior Engineer | doc-pair parity gate promoted | completed (+ repaired by t76) | `evidence/tui/docs-parity-gate/20260915T155030Z/` |
| t61 | Junior Engineer | w4 five knobs in the shared settings | completed | `evidence/team-watchdog/config/20260915T162158Z/` |
| t62 | Deep Worker | w7 preserving pause (regions + gates) | completed (+ amendment 1) | `evidence/team-watchdog/pause/20260915T163526Z/`, `…/20260915T164700Z/` |
| t63 | Lead | w5 web front door | completed (attempt 4) | `evidence/team-watchdog/notify/web/20260915T163907Z/` |
| t64 | Junior Engineer | w6 TUI front door | completed | `evidence/team-watchdog/notify/tui/20260915T163453Z/` |
| t65 | Junior Engineer | w6b TUI zero-write invariant restored | completed | `evidence/team-watchdog/notify/tui/20260915T164827Z/` |
| t66 | Deep Worker | w8 fault-injection fixture | completed | `evidence/team-watchdog/fault/20260915T165635Z/` |
| t67 | Lead | w9 five QA lanes + `skills/**` slot + the wave's ONE re-pin | completed | `evidence/team-watchdog/lanes/` |
| t68 | Reviewer | w10 independent verification (clean sandbox) | completed — **PASS, no finding** | `evidence/team-watchdog/live/20260915T171438Z/` |
| t69 | Architect (read-only) | w12 delta/re-materialise + fail-safety review | **failed — `needs_revision`** (ESCALATE-1 high, ESCALATE-2 medium, TEST-1 medium) → repaired by t71 | verdict in the task payload; repair evidence `evidence/team-watchdog/pause/20260915T172352Z/` |
| t70 | Reviewer (read-only) | w11 correctness + fail-safe review | **failed — `needs_revision`** (W11-1 medium, W11-2 low) → repaired by t73 | `evidence/team-watchdog/review/20260915T171918Z/REPORT.md` |
| t71 | repair (posted by the captain on the author's behalf) | w12 findings closed | completed | `evidence/team-watchdog/pause/20260915T172352Z/` |
| t72 | Architect (read-only) | re-review of t71 | completed — **pass**, 0 unresolved blocker/high/medium | verdict in the task payload; adopted files byte-identical to its round-1 baseline |
| t73 | Deep Worker | w11 findings closed | completed — 2/2 acceptance, adopted tree untouched | `evidence/team-watchdog/plugin/20260915T173114Z/`, `…/20260915T173604Z/` |
| t74 | Reviewer (read-only) | re-review of t73 | completed — **PASS**, 0 blocker/high; one LOW doc/code mismatch | `evidence/team-watchdog/review/20260915T173532Z/REPORT.md` |
| t75 | Architect (read-only) | adversarial review of the doc-pair gate | **failed — `needs_revision`** → repaired by t76 | `evidence/tui/docs-parity-gate/…` (t76 records every T75 finding id) |
| t76 | Junior Engineer | doc-pair gate repair round 2 | completed | `evidence/tui/docs-parity-gate/20260915T172817Z/` |
| t77 | Architect (read-only) | re-review of t76 | completed — **pass**, 0 unresolved blocker/high/medium | verdict in the task payload |
| t78 | Lead | this ledger | completed | `evidence/team-watchdog/integration/` |

---

## 2. AC-1 … AC-17

| AC | Status | Artifact that establishes it | Producer | Carried limit / note |
|---|---|---|---|---|
| **AC-1** heartbeat is REAL and per-step | `passed / not-claimed (live-turn leg)` | `evidence/team-watchdog/lanes/20260915T171218Z-heartbeat/result.json` (13 checks; re-run by t68 at `…/live/20260915T171438Z/heartbeat/`) + **the real-boot lane t80** `evidence/team-watchdog/boot/20260916T012131Z/result.json` | t67 (mechanism), t54 (writer), t68 (independent re-run), t80 (real boot) | The lane drives the host's own event sequence on a MOUNTED boot (`agent/pre-step` → `step` stamps; the member's file carries `turn-start,step,step,tool,turn-end`) and reads the stamps back from a FRESH process. **t80 then booted a REAL `dsh` with the row mounted and drove a real session + prompt** (`skills/dsh-qa/scripts/team-watchdog-boot.mjs`, evidence `evidence/team-watchdog/boot/20260916T012131Z/`): the row applied (`disposers: 5`, `holdService: mpdWatchdog`), the session was created on `agentPreset: "mpd"`, and the harness's own session log recorded exactly **one `turn/end` with NO veto signature** — so a turn really happens with the row mounted. It ends as `model-error` (`llm-deepseek: no API key for provider route "deepseek-default"`, a MISSING_CREDENTIAL-class failure), i.e. the turn REACHED the model call and failed there; a COMPLETED live model turn is therefore still **not witnessed in this sandbox**, so the AC's "during a live member turn … captured while the turn runs" clause stays NOT CLAIMED, now with a measured reason instead of an assumed one. The ≥3 distinct monotonic `lastSeen` values ARE witnessed on disk. |
| **AC-2** heartbeat also advances on TOOL calls, members AND captain; POST-only semantics | `passed` | same artifact (`data-watchdog…` no — the lane's `H4` tool stamp with `tool`/`callId`/`ok:true`, `H8` captain stamp, `H5` = no `tools/pre-execute` in the built bytes) | t67, t54, t68 | The captain's tool-less turn is the "no-tool" witness (its `step` stamp exists without any `tool` stamp). The pre-dispatch stamp is explicitly NOT claimed (W-9). |
| **AC-3** 90 s silence ⇒ WARN + snapshot, bounded latency | `passed` | `evidence/team-watchdog/lanes/20260915T171218Z-fault/result.json` (case `warn-90s`), fixture `evidence/team-watchdog/fault/20260915T165635Z/` | t66, t67, t68 | The clock is injected; `belowThreshold.decisions = 0` at +89 999 and `warnCount = 1` at +90 001 with `warnLatencyWithinThresholdPlus5s = true` and `knobsAreTheFrozenDefaults = true`. |
| **AC-4** three consecutive WARNs ⇒ exactly one ESCALATE, no 4th WARN | `passed` | same artifact (case `escalate-3x`: `kinds: [warn,warn,escalate,""]`, `exactlyOneEscalatePerTaskAttempt`, `noFourthWarn`, `holdAppliedOnce`, `stats.scenes: 3/incidents: 3/holdsApplied: 1`) | t66, t67, t68 | — |
| **AC-5** scene snapshot complete and restorable (fresh process) | `passed` | `evidence/team-watchdog/lanes/20260915T171218Z-scene/result.json` (10 checks) + `evidence/team-watchdog/plugin/20260915T160657Z/result.json` | t54, t67, t68 | Field set read back from a FRESH `node` process with plain fs: `schemaVersion/at/reason/cause/team{hold}/tasks/members{…}/mailbox/parkedAttempts/incidents` + the `latest.json` pointer agreeing with the hold sidecar. |
| **AC-6** snapshot atomic and idempotent; torn write impossible | `passed / not-claimed (crash-injection leg)` | `evidence/team-watchdog/plugin/20260915T173114Z/` and `…/fault/20260915T165635Z/raw/tests-watchdog.log` (`55 pass / 0 fail`), test source `packages/mpd-team-watchdog-plugin/test/scene.test.ts:92` | t54 | Round-trip byte-identity and "a second identical write changes no bytes" ARE unit-witnessed (and the writer is temp+rename). The AC's **crash-injection of the writer was never run**; the only torn-input test is for heartbeat lines. Not upgraded. |
| **AC-7** pause is PRESERVING and TEAM-scoped; nothing cancelled | `passed / not-claimed (second-team leg)` | `evidence/team-watchdog/lanes/20260915T171218Z-fault/result.json` (case `pause-preserves`: `sha256UnchangedAcrossHeldKicks: true`, `deliveriesWhileHeld: 0`, `cancelled: false`) + `evidence/team-watchdog/pause/20260915T164700Z/` | t62, t66, t67 | The hold is per-team by construction and the file diff carries only hold fields (no status/attemptId change, no `cancelledTasks`). The AC's "a SECOND untouched team keeps dispatching through the same window" leg has **no direct case**; the closest measurement is t73's two-team tick (`[{warn,team-a,1},{warn,team-b,1}]`, no hold for either). Not upgraded. |
| **AC-8** one resume clears the hold AND re-arms the held attempt; second resume is a no-op | `passed / not-claimed (same-attemptId leg)` | `evidence/team-watchdog/pause/20260915T163526Z/` + `…/20260915T164700Z/` (amendment 1) + the `pause-preserves` observation (`resumed: true`, `deliveriesAfterResume: 1`, `sha256AfterResume: "changed (the re-arm minted the next attempt)"`) | t62, t67 | `evidence/team-watchdog/pause/20260915T164700Z/RESULT.md:115` states the limit verbatim: "No re-arm claim for an attempt the parked map considers currently parked with the same id" — i.e. the FRESH-attempt branch is witnessed, the SAME-`attemptId` branch is not. |
| **AC-9** captain-wedge: the process-level tick still fires; the notice survives a restart | `passed` | `evidence/team-watchdog/lanes/20260915T171218Z-fault/result.json` (case `captain-wedge`: `captainFlagged: true`, `memberFlagged: false`, `agentTurnsDriven: 0`) + the notify lanes' fresh-load replay (`…/lanes/20260915T171218Z-notify-both/result.json`) | t66, t67, t68 | AC-9's "notice survives a process restart" is witnessed by the notify lanes' SIX/S7 restart legs (a fresh client on the same store). |
| **AC-10** NEGATIVE CONTROL: watchdog disabled ⇒ no WARN, no scene, no pause; a vacuous pass is a failure | `passed (unit level) / not-claimed (fixture-level arm)` | `packages/mpd-team-watchdog-plugin/test/failsafe.test.ts:216` ("a row config kill switch also disables the engine": `report.applied === true`, `tickOnce().skipped === "disabled"`), recorded in `evidence/team-watchdog/fault/20260915T165635Z/raw/tests-watchdog.log` (`55 pass / 0 fail`) | t54 | The disabled control exists and fires at the ENGINE level. A run of the whole fixture with the watchdog disabled was **never produced**, so the fixture-level negative control is not claimed. |
| **AC-11** the five knobs are the `mpd` namespace's, visible in both front doors, live-re-read, clamped | `passed` | `evidence/team-watchdog/lanes/20260915T171218Z-config/result.json` (10 checks) + `evidence/team-watchdog/config/20260915T162158Z/result.json` (t61) | t61, t67, t35 (bridge lane, `skills/dsh-qa/scripts/tui-settings-bridge.mjs`) | Live re-read witnessed through the adapter's own `settings/document-updated` bridge (60000→30000, streak 2→3, no restart); clamp witnessed (requested 40000 → applied 10000 < 30000) with the issue recorded. |
| **AC-12** Web: banner at the TOP + one activity record, WIRED into the render | `passed / not-claimed (real browser render)` | `evidence/team-watchdog/notify/web/20260915T163907Z/` (driver 17/17) + `…/lanes/20260915T171218Z-notify-both/result.json` | t63, t67, t68 | Asserted on the RENDERED TREE (the panel root's `children[0]` is the banner carrying the payload's own values) and on the payload (`activity.length === 1`) — never on a source string. No browser exists here: a real render is NOT claimed. |
| **AC-13** TUI: status-line row while the condition lasts + a dialog/notice | `passed / not-claimed (rendered pane)` | `evidence/team-watchdog/notify/tui/20260915T163453Z/` (t64) + `…/20260915T164827Z/` (t65, zero-write invariant) + `…/lanes/20260915T171218Z-notify-both/result.json` | t64, t65, t67 | The TUI arm asserts the COMPOSED status value (`composeNotices`), the replay dialog request (option id `acknowledge`) and the BUILT dist bytes — not a rendered TTY pane (a keystroke drive is `tui-panels`' job and was not run here). |
| **AC-14** unread replay in the mailbox-unread shape, both readers, ack per reader, honest fallback | `passed` | `…/lanes/20260915T171218Z-notify-both/result.json` (18 checks: web reader `web-panel`, TUI reader `mpd-tui`, watermark sha256 before/after, replay stop, second incident replays) | t63, t64, t67, t68 | The fallback is stated in every result AND on screen: **without an acknowledge the replay is PERMANENT RE-DISPLAY BY DESIGN**. |
| **AC-15** fail-safe (no wedge: caught timer, bounded timers, no write loop, loud degradation) | `passed` | `evidence/team-watchdog/plugin/20260915T160657Z/result.json` (fail-safe acceptance row) + the package suite recorded in `…/fault/20260915T165635Z/raw/tests-watchdog.log` (`55 pass / 0 fail`) + `…/live/20260915T171438Z/` | t54, t68 | — |
| **AC-16** no adopted-code drift; ONE `--write-registry`; additive regions | `passed` | measured by this task: `node scripts/patch-agent-teams-fixes.mjs --check` → `already applied: 53 mpd delta region(s) across 9 adopted file(s)`, exit 0 (pasted in §8); registry on disk `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` = 53 `mpd-delta` ids; pre-wave count **48** at `evidence/release/v0.9.1/delta-registry.log`; **the strip → heal → 0-diff drill re-run by the reviewers** (t69 round 1, t72 round 2, on copies in `/tmp`) | t62 (regions), t69 + t72 (reviews), t74 (re-review), t78 (this check) | The wave's registry grew **48 → 53** regions with ONE `--write-registry` run (the wave's single-registry invariant). The AC's strip → heal → 0-diff proof **WAS re-run for the wave's own regions** and the figures are these, quoted from the reviews: **t69** — "106 windows checked across 53 regions → 0 non-unique" (an independent skeleton build + window counter, not the applier's own) and "strip→heal→0-diff byte-exact"; **t72** (round 2, on the settled tree) — `scheduler.js`: stripped **13 regions / 319 lines** → healed 13 regions, **byte-identical TRUE, diff lines: 0**; `tools.js`: stripped **20 regions / 701 lines** → healed 20 regions, **byte-identical TRUE, diff lines: 0**; each of the five wave regions was also deleted from a copy and healed byte-exact back to canonical, and the healed shas equal the untouched working tree. **Correction (t80, 2026-09-16):** an earlier revision of this row said that proof had NOT been re-run — that was STALE, and the figures above replace it. The remaining honest limit is narrower and stays: `--check` proves the registry matches the files, not that a region body sits in the intended WINDOW of the upstream function. |
| **AC-17** pause PRESERVES in-flight work; the halt control reddens it | `passed` | `…/lanes/20260915T171218Z-fault/result.json` (cases `pause-preserves` and `pause-preserves-halt-control`: `cancelledTasks: 1`, `sha256Changed: true`, `wouldReddenAC17: true`, `mechanism: "haltTeamWork … CALLED — never stubbed"`) | t62, t66, t67 | The falsifying control is the fixture's own halt case; the payload preserves (`preserved: true`, `cancelled: false`). |

**Plan/implementation naming note (recorded, not a defect).** The plan's §3 names case flags that the
fixture does not implement as such (`--case pause-scope`, `--case resume`, `--case atomic`,
`--case idempotent`, `--case negative`). The fixture's `CASES` are
`member-stops-stepping, captain-wedge, warn-90s, escalate-3x, pause-preserves, pause-preserves-halt-control,
scene-restore`, and the five lanes expose them through `runAll`/their own evaluators. A reviewer looking for
`--case resume` will not find it: the resume legs live inside `pause-preserves` (plus t62's driver).

---

## 3. NOT-CLAIMED — one place, verbatim where the producer wrote it

### 3.1 The fixture's four entries (w8/t66 + the fault lane, verbatim)

> W-3: a GENUINE provider wedge is not reproducible here. Every case injects SILENCE (the absence of new heartbeats); no case may claim that a real wedge was caught.
> The harness is stubbed (ctx services, agents, subagents, logger). The scheduler, the watchdog engine/machine/store and the halt path are the REAL modules; the surrounding host is not.
> No live dsh host, no model credential, no network: the fixture never boots a session.
> `haltTeamWork` cancels; the fixture does not claim that the halt path is ever the RIGHT mechanism — it exists to show that AC-17 goes RED when the pause is built on it.

Source: `evidence/team-watchdog/fault/20260915T165635Z/result.json` → `notClaimed` (repeated verbatim by
the fault lane in its own output and result, on purpose).

### 3.2 The lanes' own entries (w9/t67, verbatim)

- **No live model turn** — "No LIVE member turn was driven: this sandbox has no dsh host, no model credential and no network (the fixture's own NOT_CLAIMED #3). The witness is the mounted boot plus the events the host would fire, read back by a fresh process."
- **No pre-dispatch tool stamp** — "No pre-dispatch tool stamp exists or is claimed (W-9): the tool stamp is POST-completion only."
- **No real browser render, no real TTY** — "No real browser render and no real TTY: the web arm asserts the RENDERED TREE through the offline hook runtime driving the REAL built client against the REAL route's payload; the TUI arm asserts the composed status value, the dialog request and the REAL watermark file (a keystroke drive is `tui-panels`' job)." (t63's own record words the browser half as: "a real browser render and a click-driven save … no browser binary exists in this environment".)
- **Permanent re-display** — "The fallback is stated, never hidden: without an acknowledge the replay is permanent re-display by design."
- **Scene provenance** — "The snapshot is the INJECTED silence (the fixture's W-3) — no genuine provider wedge is claimed." / "The scene was produced in-process by the fixture and read from outside with plain fs; the read is what this lane witnesses, not a live host's write."
- **Config provenance** — "The live re-read is driven through the adapter's own `settings/document-updated` bridge on a stub harness (the host's event, the real row) — not through a live GUI session." / "The clamp is asserted from the running engine's reported knobs, not from a source string."

### 3.3 The parked-map re-arm exception (w7/t62, verbatim)

> No re-arm claim for an attempt the parked map considers currently parked with the same id

`evidence/team-watchdog/pause/20260915T164700Z/RESULT.md:115` (and identically at
`evidence/team-watchdog/pause/20260915T163526Z/RESULT.md:136`). The in-process parked map is not reachable
through the adapter, so AC-8's same-`attemptId` branch is not claimed by the producer either.

### 3.4 `--check` is not window integrity (AC-16)

`node scripts/patch-agent-teams-fixes.mjs --check` proves the registry matches the adopted files on disk.
It says nothing about whether a region body sits in the intended WINDOW of the upstream function, and
nothing about a hypothetical re-materialise — that class needs the strip → heal → 0-diff drill, which the
reviewers DID re-run for this wave's regions (t69: 106/106 unique windows, strip→heal→0-diff; t72:
`scheduler.js` 13 regions/319 lines and `tools.js` 20 regions/701 lines, both healed byte-identical with
0 diff lines, and the five wave regions each healed byte-exact after deletion). **Correction (t80): an
earlier revision of this section said that drill was not re-run; that was stale.** The limit that remains
is the sentence before this one — `--check` is not window integrity.

### 3.5 What could NOT be verified in this environment, and why

| Not verifiable here | Why |
|---|---|
| A genuine provider wedge | Not reproducible by construction (fixture W-3); every case injects silence. |
| A COMPLETED live model turn | t80 booted a REAL `dsh` and drove a real session + prompt, but the model call fails in this sandbox (`llm-deepseek: no API key for provider route "deepseek-default"`, MISSING_CREDENTIAL-class): the turn reaches the model and the machinery survives the row, yet no completed turn is witnessed. |
| A real browser render / a click-driven save | No browser binary exists in this environment. |
| A real TTY pane / keystroke drive | The TUI lanes need a real terminal under tmux; not driven in this wave. |
| A second team dispatching through a held window (AC-7 leg) | No case drives two teams with one held. |
| Writer crash-injection (AC-6 leg) | No crash-injection harness exists for the scene writer. |
| The fixture-level disabled control (AC-10 arm) | The kill switch is unit-witnessed; the fixture arm was never run. |
| Strip → heal → 0-diff for the five new regions (AC-16 leg) | Only the v0.9.1-era regions carry that drill. |
| `bun run test:qa` in a single pass during the wave | It aborts at the first failure; during the wave it aborted on the owed VENDOR_LOCK pairing until the captain's re-pin, after which it passed (`evidence/team-watchdog/lanes/20260915T173500Z-repin-verified/raw/test-qa.log`). |

---

## 4. The two post-terminal amendments

| Amendment | What changed | Why no terminal task was re-opened | Artifact |
|---|---|---|---|
| **t54 amendment 1** (w3) | The `mpdWatchdog` hold service was published after t54 closed: the row's `provide(HOLD_SERVICE, …)` reader with `isHeld/holds/list/hydrate/hydratedRoots/gateCall` plus the front-door reads (`heldTeams/unread/acknowledge/view`). Trigger: the captain's briefing carried **AMENDMENT 2** of the frozen plan, which the first run had never read (the plan's mtime 15:49:35Z preceded the first package file at 15:57:12Z — a genuine recon miss, disclosed in the record). | t54 was already terminal; re-opening it would have pinned every dependent (`AGENTS.md` §12's failed/cancelled-dependency trap). A NEW timestamp directory was written instead, leaving the first run's evidence untouched. | `evidence/team-watchdog/plugin/20260915T162351Z/{RESULT.md,result.json}` |
| **t62 amendment 1** (w7) | **Service-primary** gate enforcement SUPERSEDED the file-read variant: the same five call sites / same region ids now ask the `mpdWatchdog` service instead of reading the durable sidecar from each gate. The amendment note argues the smaller diff is a real simplification, not just a smaller patch, and ADDS to the record without rewriting it. | Same reason: t62 was terminal. The superseded iteration is kept whole, with a `README-supersedes.txt` pointer, and the amendment was captain-verified. | `evidence/team-watchdog/pause/20260915T164700Z/{AMENDMENT-NOTE.md,README-supersedes.txt,RESULT.md,result.json}`; superseded: `evidence/team-watchdog/pause/20260915T163526Z/` |

Neither amendment re-opened a terminal task; neither rewrote a recorded artifact — both are additive
directories with explicit supersession pointers.

---

## 5. Review history — including the three `needs_revision` rounds

A report that shows only green is not this wave's report. Four review rounds across two domains ran, and
**three of them returned `needs_revision`**.

### 5.1 w11 correctness (t70, Reviewer) — `needs_revision`, repaired by t73

- **W11-1 (MEDIUM, a real false-positive path).** The streak key omitted `teamId`, so two teams' WARNs
  summed into one streak: three single WARNs spread across two healthy teams produced ONE spurious
  ESCALATE that took a hold while the second team was never observed. Fixed by
  `streakKey(teamId, taskId, attemptId)`, threaded through clear/hasEscalated/snapshot and the scene's
  per-task streak lookup. Proof: the old-key MODEL (same observations, old 2-part key) vs the new keying,
  plus a shipped-dist two-team tick and a regression test.
- **W11-2 (LOW).** Fixed the stronger of the two offered options.
- Repair evidence: `evidence/team-watchdog/plugin/20260915T173114Z/` and `…/20260915T173604Z/`;
  re-review **t74 PASS** (`evidence/team-watchdog/review/20260915T173532Z/REPORT.md`), which re-falsified
  both findings in both directions and found only one LOW doc/code mismatch.
- Reviews: `evidence/team-watchdog/review/20260915T171918Z/REPORT.md` (t70).

### 5.2 w12 delta discipline + fail-safety (t69, Architect) — `needs_revision`, repaired by t71

- **ESCALATE-1 (HIGH, a real false-positive path).** A COMPLETED-then-idle member escalated and held a
  healthy team. Fixed: `observe()` branches on `candidate.lastKind === "turn-end"` and both withholds and
  clears the streak; the RESET clause was verified with an isolated three-phase run (warn, warn → healthy
  phase → new stall starts at streak 1).
- **ESCALATE-2 (MEDIUM).** `never-started` was invisible on every front door; it now records a durable
  incident (`hold: 'not-requested'`, no pause).
- **TEST-1 (MEDIUM).** The fixture could not distinguish idle from stall; it now defines both cases.
- Repair evidence: `evidence/team-watchdog/pause/20260915T172352Z/` (t71's boundary run, whose raw includes
  `completed-turn-idle.json`); re-review **t72 pass** with the adopted tree byte-identical to its round-1
  baseline (scheduler.js `ca617036920b213c445beae1`, tools.js `49025f4d9901fb2599f42bbb`,
  mpd-deltas.js `9a5eccbd6b5c63c6d7565535`).

### 5.3 The doc-pair gate (t75 → t76 → t77)

- **t75 (Architect, adversarial): `needs_revision`** — the gate enforced, but its DISCOVERY had false
  negatives, one output line contradicted its exit code, and the exemption count read as more than it was.
  The review wrote nothing to the repo (fixtures under `/tmp` via `--root`).
- **t76 repair** (`evidence/tui/docs-parity-gate/20260915T172817Z/`): recursive discovery under `docs/`
  and `extensions/`, the inverse scan (every `*.zh-CN.md` must have its EN twin), a package-README
  failure, exemption bookkeeping, scoped wording.
- **t77 re-review: pass**, 0 unresolved blocker/high/medium (verdict in the task payload).
- The gate's promotion is t60's: `evidence/tui/docs-parity-gate/20260915T155030Z/`.

### 5.4 Independent verification (t68, Reviewer) — PASS, no finding

All five lanes were re-run from a clean sandbox created by the reviewer, all five `--self-test`s passed with
named negative controls, both tree gates passed, and every named mechanism was traced to the real thing.
Evidence: `evidence/team-watchdog/live/20260915T171438Z/` (per-lane subdirectories + `raw/`).

### 5.5 The wave's MOST SEVERE defect: the `agent/pre-step` waterfall veto (found by a real session, fixed 2026-09-16)

Neither the lanes nor the three `needs_revision` rounds found this one; a REAL user session did. Adding it here
because a ledger that omits its worst defect is not a ledger.

- **Symptom (measured).** In the Web GUI every message to an `mpd` session failed instantly; the harness
  recorded, ≈120 ms after `turn/start` and BEFORE any model call:
  `turn/end {reason:{kind:"error",error:{message:"Cannot read properties of undefined (reading 'map')",code:"UNKNOWN"}}}`
  (turn 113, and again on 114). The message is state-dependent: `… (reading 'findLastIndex')` with a
  `.mpd/plans/*.md` artifact present, `… (reading 'length')` under a one-shot `--profile headless` boot
  (exit 1). Every turn of every mpd session in the process failed.
- **Root cause.** `agent/pre-step` is a **cordis waterfall**: `EventsService.waterfall` runs listeners
  outermost-first with `next` appended and composes them as `(cbs.shift() ?? inner)(...args)`, so a listener
  that returns WITHOUT calling `next()` **vetoes the chain and its own return value becomes the decision**.
  The watchdog's heartbeat writer was `(payload) => this.stamp("step", agentOf(payload))` — it returned a
  `HeartbeatStamp` (`{kind:"step", …}`, no `messages`), which replaced the `{kind:'enter', messages}`
  decision; the first consumer to read `decision.messages` threw.
- **Fix.** `packages/mpd-team-watchdog-plugin/src/engine.ts` `install()`: the `agent/pre-step` listener now
  stamps AND delegates (`return next()`) with its own body in a `try/catch` (a thrown handler would be
  answered by `subscribe`'s wrapper with `undefined`, which is itself a veto); the `agent/session-start`
  (emit) and `agent/turn-stopping` (serial) handlers return nothing at all.
- **Pins.** `packages/mpd-team-watchdog-plugin/test/pre-step-waterfall.test.ts` (drives the REAL vendored
  cordis with a negative control that re-enacts the retired shape) and the live BEFORE/AFTER driver
  `evidence/team-watchdog/pre-step-waterfall/20260916T010000Z/{drive.mjs,result.json,before-fix/}`.
- **The lesson, and what this task did about it.** The reason no lane saw it is stated verbatim in
  AGENTS.md §12: **every `team-watchdog-*.mjs` lane drives the built modules in-process and never spawns a
  real `dsh`**, so no lane exercised a harness turn with the row mounted. Task `t80` closed that gap with
  `skills/dsh-qa/scripts/team-watchdog-boot.mjs` — a REAL dev-web boot, a session on `agentPreset: "mpd"`,
  one prompt, and a verdict read from the harness's own session log — whose first run
  (`evidence/team-watchdog/boot/20260916T012131Z/`) shows the row applied, one `turn/end`, and no veto
  signature. Its `--self-test` re-enacts the retired shape against the REAL vendored cordis and requires the
  veto to be observed, so the assertion is falsifiable rather than decorative.

### 5.6 What the reviews bought, stated plainly

Three of the four review rounds found real defects, two of them false-positive paths that would have paused
healthy teams in production (a completed-turn idle member; two teams sharing one streak). Neither was
visible from the green lanes; both were found by reviewers attacking the machine, and both repairs carry
their own falsification in BOTH directions. The wave's MOST severe defect (§5.5) was found by neither: only a
real session could see it, which is exactly why the boot lane now exists.

---

## 6. Platform / process gaps for the follow-up `fix/` branch

### 6.1 The four delivery shapes the captain measured

1. **Pooled-unassigned → read-only seat.** A pooled `implementation` task was handed to a read-only member
   that could not execute it (measured twice: the read-only Architect and Reviewer). Root cause reproduced
   standalone by t58 with no tree edit: `evidence/team-watchdog/pool-guard/20260915T1745Z/`
   (`REPORT.md`, `ADDENDUM-2instances.md`, `repro.mjs`, `repro-2instances.mjs`, raw logs) — plus the
   readers' view at `evidence/team-watchdog/pool-guard-readers/REPORT.md`.
2. **Assigned-while-busy never delivered.** A seat assigned while it was already running never received the
   work (a second prompt is dropped by the delivery seam that only steers a RUNNING turn).
3. **Terminal task re-offered.** A member could be re-offered a task it had already posted as terminal.
4. **A stale READ by the captain.** The captain read a task's pre-update state and acted on it.

### 6.2 The captain-takeover-return-to-pool variant

t71 was **posted by the captain on the author's behalf** ("the captain performed ONLY the terminal call it
was mechanically blocked on"): the author had delivered everything but could not post a payload, and a
member may hold only one unfinished task, so the dependents stayed unclaimable behind it. The variant to
fix: a captain takeover that posts on a member's behalf should RETURN the slot to the pool (or record the
authorship split) instead of leaving the pool unaware.

### 6.3 The scope-defect classes (two, different owners)

1. **An implementation task whose acceptance needs a rebuilt `dist/` (or the package's server half) that
   its `inScope` does not cover** — measured on t63 (the web front door's routes needed
   `src/index.ts` + `dist/index.js` + a test file beyond the declared `src/team-page.js`, `client.js`,
   `evidence/…`; the completion validator refused the four undeclared paths) and t65 (the TUI zero-write
   repair). Remedy used: the captain amended the scope to the package-wide set. The class fix: a
   contract generator that adds the package-wide prefix whenever an `implementation` task's acceptance
   mentions a build artifact or a `dist/`.
2. **A contract-defect class the captain owned** — the t67 case: the acceptance required reporting a
   failing `verify-vendor`/`test:qa` (the owed VENDOR_LOCK pairing) while the validator required a PASSED
   `commandsRun` entry for every verify command. The captain resolved it by executing remedy 2: landing the
   re-pin first, after which the verify list passed as written without weakening it.

### 6.4 Single-registry / single-re-pin accounting

| Invariant | Before the wave | After the wave | Note |
|---|---|---|---|
| Adopted delta registry | **48** regions / 9 files (`evidence/release/v0.9.1/delta-registry.log`) | **53** regions / 9 files (`--check` clean; 53 `mpd-delta` ids in `mpd-deltas.js`) | ONE `--write-registry` run by the wave (t62); no other task regenerated it. |
| `VENDOR_LOCK.json` skills corpus | 310 / `8ec53287296e…` | **316 / `10c945f47a5e645e0ecd9e4bce198b3a314389407f4681fd8906b988f8e7f3bb`** | The wave's ONE re-pin, performed by the captain in the same commit as the `skills/**` change (five lanes + `lib/watchdog-lane.mjs`); `verify-vendor` PASS and `test:qa` exit 0 afterwards (`evidence/team-watchdog/lanes/20260915T173500Z-repin-verified/`). |

---

## 7. Evidence index (root → what it holds)

| Root | Holds |
|---|---|
| `evidence/team-watchdog/design/` | t52's design freeze, persisted verbatim by t56 (with its provenance header + verbatim checker). |
| `evidence/team-watchdog/seam-audit/20260915T154132Z/` | t53's seam audit, persisted verbatim by t56. |
| `evidence/team-watchdog/requirements/20260915T090440Z/` | t43's requirements/dossier (`HOST-WATCHDOG.md`, `result-decisions.json`). |
| `evidence/team-watchdog/plugin/` | t54 (core package), t54 amendment 1, t73 (w11 repairs, two runs). |
| `evidence/team-watchdog/pause/` | t62 (file-read iteration + service-primary amendment), t71 (w12 repair boundary run). |
| `evidence/team-watchdog/config/20260915T162158Z/` | t61 (five knobs declared + visible). |
| `evidence/team-watchdog/notify/web/20260915T163907Z/` | t63 (web front door: routes, rendered tree, watermark proof). |
| `evidence/team-watchdog/notify/tui/` | t64 (front door), t65 (zero-write invariant restored). |
| `evidence/team-watchdog/fault/20260915T165635Z/` | t66's fixture: 7 cases, raw store, test logs. |
| `evidence/team-watchdog/lanes/` | t67's five lanes (per-lane timestamped dirs), the pre-re-pin integration record, the post-re-pin verification record. |
| `evidence/team-watchdog/live/20260915T171438Z/` | t68's independent verification (fresh sandbox, per-lane re-runs). |
| `evidence/team-watchdog/review/` | t70's and t74's reports + raw. |
| `evidence/team-watchdog/pool-guard/`, `…/pool-guard-readers/` | t58's reproduction + the readers' report. |
| `evidence/team-watchdog/integration/` | this ledger's machine-readable companion (`result.json` + the pasted existence check). |
| `evidence/team-watchdog/boot/` | t80's REAL-dsh boot runs (the row applied + a real `turn/end` + the veto-signature assertion). |
| `evidence/team-watchdog/pre-step-waterfall/20260916T010000Z/` | the wave's most severe defect (§5.5): the live BEFORE/AFTER driver, its `before-fix/` run and the fix's pins. |
| `evidence/tui/docs-parity-gate/` | t60 (gate promotion) and t76 (repair round 2) with their raw logs. |
| `evidence/release/v0.9.1/delta-registry.log` | the pre-wave registry count (48) used in §6.4. |

---

## 8. Path-existence check (run by this task)

`evidence/team-watchdog/integration/20260915T180000Z/check-paths.mjs` extracts every backticked
repo-relative path from this report, checks it with `existsSync`, and prints the result. Pasted output:

```
[check-paths] report=/root/dshProj/my-power-dsh/.mpd/plans/team-watchdog-report.md
[check-paths] repo=/root/dshProj/my-power-dsh
[check-paths] cited repo-relative tokens=70 · checked=69 · skipped(placeholders)=7 · missing=0
[check-paths] PASS — every cited path exists

… (the full per-path list, with each `:<line>` citation's line content, is in
`evidence/team-watchdog/integration/20260915T180000Z/raw/check-paths.log`)
  OK   scripts/verify-docs-parity.mjs
  OK   skills/dsh-qa/scripts/tui-settings-bridge.mjs
[check-paths] PASS — every cited path exists

```

**Result: PASS — 70 cited repo-relative tokens, 69 checked (brace groups expanded, `:<line>` suffixes
stripped for the existence test and the LINE verified), 7 placeholders/globs skipped and listed, 0
missing** (the count includes this section's own citations of the checker and its log). The two `:<line>` citations that the first checker pass flagged were a citation-FORMAT
limitation of the checker, not a missing artifact: the checker now strips the suffix, checks the file,
and additionally prints the cited line's content — which is how the `failsafe.test.ts:216` citation was
corrected from `:218` to the test's own declaration line.

---

## 9. Honesty statement

No row above upgrades a limit into a pass: **10 rows are plain `passed` and 7 carry a named limit**
(AC-1's live-turn leg, AC-6's crash injection, AC-7's second-team window, AC-8's same-attemptId branch,
AC-10's fixture-level arm, AC-12's real browser render, AC-13's rendered TTY pane). Where this report was
itself wrong it says so in place — see t80's AC-16 correction (§2 and §3.4) and the added §5.5, the wave's
most severe defect — and the wave's three
`needs_revision` review rounds — including the two false-positive paths that would have paused healthy
teams — are recorded with their repairs rather than smoothed into the ledger. Every cited artifact was
verified to exist by this task (§8); a citation that had been missing would have been marked
`failed`/`not-claimed` instead of quietly passed.
