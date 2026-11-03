# Lane A — the four review-A Nits (N1–N4) are now PINNED by arms, and each arm is demonstrably red

**Task:** T2 (follow-up wave 0.17.2, contract `.mpd/plans/vedit-p0-followup.md` §F2; source
`evidence/cellwork/vedit-p0/review-a/report.md` §4).
**Scope:** `packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts`,
`packages/mpd-cellwork-plugin/test/flow.test.ts`, this evidence subtree. No `src` change, no product fix.
**Loop:** `loop-20261103T061032-d4571e`.

## 1. Every moved / added assertion, by name (R2)

| Nit | arm | disposition |
|---|---|---|
| **N1** — "before any registry-by-id lookup" was not discriminated (both sources served the SAME engine) | **NEW** `D1/C1: the LIVE handle's engine WINS over a registry that answers a DIFFERENT engine` | The harness gained `HarnessOptions.registryEngineOverride` (documented) and `registryEngine` now honours it, so BOTH seams are reachable at once with DIFFERENT answers: the arm asserts the handle's engine is driven (`harness.engine.calls.length === 1`, `.agent === harness.member`), the registry's engine is NEVER driven (`otherEngine.calls.length === 0`), and the member is promoted. No existing arm was removed or relaxed. |
| **N2** — the `< 500 ms` bound cannot see the measured **200 ms** pre-attempt sleep | **REPLACED** `C1: no sleep happens before the FIRST attempt (the engine is driven immediately)` → **NEW** `C1: the FIRST attempt is driven BEFORE any delay is scheduled — ANY delay, hard-coded included (ORDER, never a duration bound)` **+** `C1: the ORDER probe SEES a real retry sleep, whatever its length (two-sided control)` | The duration bound is GONE. Both arms share `orderProbe()`, which records **every timer with a POSITIVE delay** scheduled in the window (value included: `timer(200ms)`) plus the engine's own `drive`, and restores the clock in `finally`; the main arm requires the timeline to be exactly `["drive"]`, so ANY scheduled delay reddens. The control arm proves the probe is not blind — a real retry (answers `[null, …]`, `compactionRetries: 2`, 40 ms) puts `timer(40ms)` in the timeline, after the first drive. **A3-F2 hardening:** the first version recorded only the CONFIGURED `idleBarrierDelayMs`, so a hard-coded 200 ms sleep stayed green (the reviewer's m5); `orderProbe()` closes that — m5 reddens now. |
| **N3** — `cellwork_split`'s description stated no arm | **NEW** `D3/C4: the cellwork_split DESCRIPTION states the warnings rule (black-box, from the captured definition)` in `flow.test.ts` | `CapturedTool` gained `description?: string` (the definition ALWAYS carried one; only the test interface omitted it). The arm reads the registered description from the real `apply()` harness and requires the rule's teeth: `warnings`, `never change`, `writeScopes`, `BEFORE the first write`. |
| **N4** — the promoted arm never asserted "no interrupt" | **EXTENDED** `D1/C6(b,c,d)` | One assertion added next to the existing `reseeds.length === 0`: `expect(harness.interrupts.length).toBe(0)` — an interrupt would kill exactly the member that arm proves stays live. |
| **N5** — the duplicated hash in one red-first header | **NOTE ONLY, per the contract** (`§F2 N5`: the historical log stays) | `evidence/cellwork/vedit-p0/lane-a/red-first/d1-barrier-red.log` line 1 still reads `# RED-FIRST on HEAD d2032bf3 — d2032bf3 — 2026-11-03T03:49:45Z`. It is NOT rewritten: it is the artifact of a past run, and editing it would be exactly the falsification the report keeps flagging. The defect is cosmetic (the timestamp IS present, the instant slot repeats the revision) and this file records it rather than healing it. |

## 2. Falsifiability — every new/extended arm reddens under its own defect

Run in a throwaway copy of `packages/` under `.mpd/recon/qa/mut/` (the repository is never mutated); the
baselines inside that copy are green first, so a red means the MUTATION caused it. Log:
`mutations.log` in this directory.

| case | mutation (in the copy) | arm that must redden | observed |
|---|---|---|---|
| baseline | none | — | `baseline barrier: PASS`, `baseline flow: PASS` |
| **m1** | `engineForBarrier` made **registry-first** | `D1/C1: the LIVE handle's engine WINS …` | **RED** — exit 1 |
| **m2** | the pre-attempt sleep reintroduced (`if (attempt > 1)` dropped) | `C1: the FIRST attempt is driven BEFORE any barrier delay …` | **RED** — exit 1 (both N2 arms) |
| **m3** | an `interruptAgent` call added on the PROMOTED path | `D1/C6(b,c,d)` (the N4 assertion) | **RED** — exit 1 |
| **m4** | the split description's warnings rule removed | `D3/C4: the cellwork_split DESCRIPTION …` | **RED** — exit 1 |
| **m5** | a HARD-CODED `await deps.sleep(200)` before the first attempt (the D1 defect class, A3-F2) | `C1: the FIRST attempt is driven BEFORE any delay is scheduled …` | **RED** — exit 1 (both ORDER arms) |

## 3. Gates (real repo, quoted results)

| command | observed | log |
|---|---|---|
| `bun test packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts` | `10 pass / 0 fail`, 47 expect() calls — **exit 0** | `barrier-tests.log` |
| `bun test packages/mpd-cellwork-plugin/test/flow.test.ts` | `37 pass / 0 fail`, 421 expect() calls — **exit 0** | `flow-tests.log` |
| `bun test packages/mpd-cellwork-plugin` | `198 pass / 0 fail` (24 files) — **exit 0** | `gates.log` |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** | `gates.log` |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS — every declaration … carries a precise comment and a full signature` — **exit 0** | `gates.log` |

## 4. What I could NOT prove (bounds)

- **The ORDER probe records every POSITIVE-delay timer** (A3-F2): ANY scheduled delay before the first drive
  reddens, the configured knob and a hard-coded value alike (m2 and m5 both redden). What it cannot see is
  a delay that never touches `setTimeout` — a busy-wait, a microtask-only loop, or `setImmediate` — because
  the probe observes the clock the barrier actually uses today.
- **N2's probe patches `globalThis.setTimeout` for the duration of one arm** and restores it in `finally`.
  Nothing else in that file depends on a timer, and the two arms run sequentially, but a future arm that
  schedules its own 1500 ms/40 ms timer inside those windows would see it in the timeline.
- **N1's arm reads the ADAPTER SEAM's answer**, not the host's own registry service: the harness's
  `compactionEngineForAgent` double is what the plugin consults, so the arm proves the ORDER the plugin
  applies to the two seams, which is the clause C1 freezes.
- `test:qa` was red on the FIRST run for a reason OUTSIDE this lane (`surface-pin.ts`'s negative control
  no longer matched the team-action enum after lane B added the `end` verb); the captain authorised the
  one-line anchor fix in that skills case (reported under T1). With it, `bun run test:qa` passes — see the
  T1 report's §6.

## 5. Evidence paths

```
evidence/cellwork/vedit-p0/followup/lane-a/
  report.md (this file)  mutations.log  barrier-tests.log  flow-tests.log  gates.log
```
