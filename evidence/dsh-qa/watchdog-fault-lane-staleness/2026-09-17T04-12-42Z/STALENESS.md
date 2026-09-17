# t65 — the watchdog fault lane's staleness: what was wrong, what changed, what is measured

Lane: `skills/dsh-qa/scripts/team-watchdog-fault.mjs`
Revision at the run: sha256 `797b426f5e330eaae358c7c4dfcf95d18deaef6851adc9e1f66abf01b633f9c3`
Run: `bun skills/dsh-qa/scripts/team-watchdog-fault.mjs --out <this dir>` → **exit 0, PASS — 15 checks, 0 failed**

## 1. The pre-fix red was LANE-SIDE staleness, and the mechanism (corrected)

Pre-fix run (in this task's evidence): **exit 1, 11 checks, 3 failed** — F2 (5 fixture cases),
F4 (no hold), F9 (scene-restore `ENOENT … hold/fault-probe.json`).

The failing fixture cases were `mid-turn-stall`, `escalate-3x`, `scene-restore`,
`long-tool-bound-disabled-control`, `completed-tool-not-in-flight`.

**The mechanism, measured rather than assumed (t59's wording is CORRECTED here):** the fixture's
records DO carry member ids (`{name:…, id:…}`, `inject.mjs:294-296`) — the `members: ["Architect"]`
NAME-STRING shape exists only in the fixture's `scenarios()` data description, never in a written
record. What actually happens is that **the fixture never emits `session/event`** (0 occurrences),
so the engine resolves the owner session, asks the fold, gets `null`, and takes §4's degradation:
`fold.view(sessionId) === null` → `{channelState: null, heartbeatFallback: true}`
(`src/engine.ts:1031-1034`) → `observeSilence(…, "silence-heartbeat", null, reportOnly=true)`
(`src/machine.ts:443`) → `if (streak >= warnStreakToEscalate && !reportOnly)` cannot fire
(`src/machine.ts:533`) and the warn is capped at ONE per task+attempt generation
(`reportedFallback`, `src/machine.ts:539-541`).

So those five cases assert PRE-REDESIGN behaviour (warn ×3 → escalate → hold). Their red is a lane
expectation problem, **not an engine regression**; nothing here is recorded as an engine failure.
Compounding stale inputs, also corrected: the fixture's `FROZEN` is its own PRE-REDESIGN tuple
(`90000/3/pause`), not the product's §3 defaults (`600000/6/warn-only`).
`pause-preserves` / `pause-preserves-halt-control` were NEVER red — they apply the hold through the
plugin's own `session-watchdog-hold` action, and their `deliveriesWhileHeld: 0` pin passes.

## 2. What changed in the lane (t65/S1 + S2)

* **S1-a — the §1 escalation is now driven end-to-end, in-lane, against the REAL built dist**:
  `apply(ctx, config)` on a stub ctx → `report.engine.tickOnce(now)`, on a REAL-SHAPED team
  (member OBJECTS carrying ids) with FOLDED events (`turn/start` + `step/start`, no answer, no
  `step/end`) and §3's numbers (`600000/15000/6`) plus the explicit `actionOnEscalate: "pause"`
  the hold path requires. Reading: fold authority `channel`, state `OUTSTANDING`,
  `["warn"×5, "escalate"]`, hold sidecar written, **7 scene files** (5 warn + 1 escalate +
  `latest.json`), `stats.holdsApplied: 1`.
* **S1-b — the contrast**: the same arm with §3's DEFAULT `warn-only` escalates and applies **no**
  hold (`holdFile: false`, `holdsApplied: 0`) — the hold path is opt-in, as §1/§3 state.
* **S1-c — the scene-restore leg is EXERCISED, not skipped**: the scene + hold + incidents are
  re-read from the arm's own sandbox with plain fs; the pointer's hold id matches the sidecar
  (`holdMatch: true`), the escalate incident reads `hold: "applied"`.
* **S1-d — ONE case pins the §4 REPORT-ONLY surface**: with no fold evidence, across four spaced
  ticks (601 s … 2400 s) the arm reads **exactly ONE warn** (`cause: silence-heartbeat`), zero
  escalates, zero holds, no hold file, `predicateStatus().source === "heartbeat"`.
* **S1-e — the stale expectations are DECLARED with signatures** (`STALE_FIXTURE_CASES`): each of
  the five must still fail AND still match the report-only signature; if one starts passing, the
  lane fails and the declaration must be re-checked (F2b). The twelve other fixture cases are
  required to pass (F2).
* **S2 — the label is corrected**: the lane no longer calls the injected tuple "the frozen
  defaults". The result carries `labels.fixtureTuple` (labelled "the PRE-REDESIGN tuple, NOT the
  product default") and `labels.productDefaults` (labelled "FROZEN CONTRACT §3 — 600000/15000/6/
  warn-only"); F13 asserts both labels AND that the §3 numbers are the ones a reader is told are
  the product defaults. The constant could not be "updated in the fixture" — the fixture is
  `packages/**`, outside this task's inScope — so the label was corrected, which is the option the
  contract offers.

## 3. What is measured (same run, quoted)

| reading | value |
|---|---|
| lane verdict | **exit 0 — PASS, 15 checks, 0 failed** |
| `deliveriesWhileHeld` (F6) | **0**, with 2 decline lines naming the hold; 1 delivery after resume (F7) |
| engine suite (`bun test packages/mpd-team-watchdog-plugin`) | **127 pass / 0 fail**, 609 expect() calls, exit 0 (`raw/engine-suite-after.log`) |
| `bun run verify:docs` | exit 0 — 37 pairs, 0 failed (`raw/verify-docs-after.log`) |
| `--self-test` | exit 0 — 22 checks, 0 failed; 21 negative controls, each FAILING its own check(s) |
| fixture cases | 13 pass; the 5 declared-stale ones fail with their recorded signatures (F2b) |

## 4. Bounds the lane declares itself (`notClaimed`)

The fixture's four original limits are repeated verbatim (no genuine provider wedge is
reproducible; the harness is stubbed; no live dsh host; `haltTeamWork` cancels), plus three
in-lane limits: the arms run on a STUB ctx (services/agents/logger/tools simulated — the engine,
machine, store, hold path and scene writer are the real modules); the arm's ticks use an injected
clock with no wall-clock waiting; and the five stale fixture cases are REPORTED with their
readings, never treated as passes.
