# T14 — the A3 findings closed (SKILL.md row, hard-coded-sleep-proof ORDER arm, header, R2 wording)

**Task:** T14 (follow-up wave 0.17.2). **Source:** `evidence/cellwork/vedit-p0/followup/review-a3/REPORT.md`
(A3-F1 Medium, A3-F2/F3/F4 Nits, A3-F5/F6/F7 notes). **Loop:** `loop-20261103T070604-6f2ccd`.
**Scope:** `skills/dsh-qa/SKILL.md`, `skills/dsh-qa/scripts/tui-admission.ts` (header only),
`packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts`,
`evidence/cellwork/vedit-p0/followup/**`. No `src`, no `dist`, no git write; the captain re-pins once.

## 1. What changed, by finding

| finding | file | change |
|---|---|---|
| **A3-F1 (Medium)** | `skills/dsh-qa/SKILL.md` (`tui-admission` row) | The row is rewritten to the case's CURRENT behaviour. It no longer promises a no-grant `waiting_authorization` boot, "the manifest's own four rows", applied decision-handler binds, or an intercepted `tui/input` decision — four statements that had become false. It now states: the clone-measured three-way static control, the SHIPPED live posture (`compatible` on both panes with NO grant, no grants hint, loader admits, a real chat turn), the grant-clone's four live states (ungranted `waiting_authorization` + hint / granted `compatible` / wrong-scope `waiting_authorization` / revocation observed), and the CONDITIONAL ledger-attribution arm recorded as the string `inapplicable`. |
| **A3-F2 (Nit)** | `barrier-live-engine.test.ts` | NEW `orderProbe()` records **every timer with a POSITIVE delay** scheduled in the window, with the value in the entry (`timer(200ms)`), plus the engine's own `drive`; the main arm now requires the timeline to be exactly `["drive"]`, so ANY scheduled delay — configured knob or HARD-CODED — reddens. The two-sided control is unchanged in intent and still observes a real retry (`timer(40ms)` after the first drive). |
| **A3-F3 (Nit)** | `tui-admission.ts` header | The `PREREQ:` lines now spell the codes `tuiPrereqs` really gates — `absent-dsh-binary` (dsh-tui), `absent-runtime` (tmux), `absent-fixture` (the sandbox profile) — lifted from `tui-mount.ts`, with one sentence naming the probe each code uses. A new paragraph records the MEASURED sandbox constraints (short unix-socket root path, WARM profile, credentials). The `Evidence ->` line now names the directories THIS run writes (`shipped/`, `clone/`, `grant-clone/`, `REVISION.json`) instead of the retired `negctl/,grants/`. |
| **A3-F4 (Nit)** | `evidence/…/qa-live/report.md` §2 | The `arm2` row no longer says "unchanged": it is the SAME predicate whose MEASUREMENT MOVED to the SHIPPED boot (`shipped/host-stderr.log`), with the reason (only the permission-less boot admits the Component; the retirement of the granted boot's `admitted=0 refused=0`). |
| **A3-F7 (Note)** | runtime state | The experimental `.mpd/recon/qa/tui-lanes/tui-admission` provisioning was REMOVED, so a NO-ARG run on this checkout goes back to the honest `absent-fixture` SKIP instead of dying on the socket-path length. The sanctioned short root (`.mpd/sb/tui-admission`) is what every run in this wave used. |
| **A3-F5 (Note)** | this report | The `surface-pin.ts` edit's AUTHORISATION is recorded here with its loop and the captain's written ruling (below), which is the durable anchor this evidence directory carries; the captain's PR body should cite it. |
| **A3-F6 (Note)** | — | DEFERRED deliberately: adding `end` to `surface-pin.ts`'s pinned `agent_teams_control` action set should land when lane B's END verb is FROZEN (its repair row is still open), otherwise a rename in that repair would redden a pin that is not mine to maintain. Recorded, not silently dropped. |

### The authorisation for the `surface-pin.ts` edit (A3-F5)

Captain's written ruling, verbatim (received in-session for T1, loop `loop-20261103T061032-70b5ca`):
*"Captain ruling — YES, fix `surface-pin.ts`; it rides the wave's single re-pin. Extend T1 (you are the
wave's only skills writer) with this third skills file … Add the exact old/new anchor line + the three exits
to your report/evidence. This is a QA-suite ripple of N3's new verb, not a product defect; no assertion is
weakened — the control is restored to being falsifiable."* The old/new anchor line and the three exits are in
`qa-live/report.md` §7 and `qa-live/surface-pin.log`.

## 2. A3-F2 — the red-first proof the reviewer asked for (m5)

The reviewer's m5 (a hard-coded `await deps.sleep(200)` before the first attempt) was GREEN against the
previous probe (`10 pass / 0 fail`). Against `orderProbe()` it now reddens, and every earlier control still
reddens its own arm. From `mutations.log` (throwaway copy of `packages/`, repository untouched):

```
baseline barrier: PASS
baseline flow: PASS
m1 RED as expected exit=1 ["D1/C1: the LIVE handle's engine WINS over a registry that answers a DIFFERENT engine"]
m2 RED as expected exit=1 ["C1: the FIRST attempt is driven BEFORE any delay is scheduled — ANY delay, hard-coded included (ORDER, never a duration bound)", "C1: the ORDER probe SEES a real retry sleep, whatever its length (two-sided control)"]
m5 RED as expected exit=1 ["C1: the FIRST attempt is driven BEFORE any delay is scheduled — ANY delay, hard-coded included (ORDER, never a duration bound)", "C1: the ORDER probe SEES a real retry sleep, whatever its length (two-sided control)"]
m3 RED as expected exit=1 ["D1/C6(b,c,d): the engine comes from the LIVE handle …"]
m4 RED as expected exit=1 ["D3/C4: the cellwork_split DESCRIPTION states the warnings rule …"]
```

- **m2** = the CONFIGURED-seam sleep reintroduced (`if (attempt > 1)` dropped) → both ORDER arms red.
- **m5** = a HARD-CODED 200 ms sleep (the D1 defect's own class) → the ORDER arm red; **it was GREEN before
  this change** — that is the review's residual, closed.
- The control arm proves the probe is not blind: the retry arm still observes a real `timer(40ms)` after the
  first drive.
- `lane-a/report.md` was updated in the same pass (the N2 row's arm names, the new probe, the m5 row, and its
  bounds section) so the lane's own evidence cannot describe a probe that no longer exists.

## 3. Gates (real repo, quoted exits — full text in `gates.log` / `test-qa.log`)

| command | observed |
|---|---|
| `bun test packages/mpd-cellwork-plugin/test/barrier-live-engine.test.ts` | `10 pass / 0 fail` — **exit 0** |
| `bun test packages/mpd-cellwork-plugin/test/flow.test.ts` | `37 pass / 0 fail` — **exit 0** |
| `bun test packages/mpd-cellwork-plugin` | `198 pass / 0 fail` (24 files) — **exit 0** |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | **exit 0** (a fresh `evidence/tui/lanes/<ts>` run) |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** |

## 4. Bounds

- The ORDER probe observes the clock the barrier uses (`setTimeout`). A delay that never touches it (a
  busy-wait, `setImmediate`, a microtask-only loop) is out of its reach; the clause is about scheduled
  delays, which is what the D1 defect was.
- The probe patches `globalThis.setTimeout` for the duration of ONE arm and restores it in `finally`; a future
  arm that schedules its own positive-delay timer inside those windows would appear in the timeline.
- The SKILL.md row is DOCUMENTATION: it is not mechanically cross-checked against the assertions. It was
  written from the run's `result.json` (`qa-live/run-artifacts/result.json`) and the arm names in the source.
- The live lane was NOT re-run for this row: `tui-admission.ts` changed in its HEADER only (comments), and the
  lane's behaviour is byte-identical apart from that; `--self-test` and `--static-only` were re-run and are
  green, and the live evidence stands from run `2026-11-03T06-33-55.528Z`.

## 5. Evidence in this directory

```
report.md (this file)  mutations.log  gates.log  test-qa.log
```
