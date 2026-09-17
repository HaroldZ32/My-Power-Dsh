# t28 — lane D follow-up: lane C's two routed specs landed (T-18 `--live` pin + T-48 permanent KICK row)

**Author:** `qa-lane-engineer` (the wave's single `skills/**` writer) · **evidence stamp** from the run dir name · **task** t28 (attempt 1)
**inScope honoured:** `skills/dsh-qa/**` + `evidence/dsh-qa/**` only. **Changed (2 corpus files):** `skills/dsh-qa/scripts/team-watchdog-config.mjs` (`32d244c4e7ffb957` → `f9f03ca7e048e207`), `skills/dsh-qa/scripts/watchdog-redesign.mjs` (`98519dad94c53d78` → `bf5b65353bfca24c` — see `before-after.txt` for the exact pair). **No other lane's file was touched**; the plugin's `test/**` arm is read-only for this lane.

## 1. Both specs taken from lane C's handoff FILES, verbatim

Source dir: `evidence/team-watchdog/lane-c-2a/20260917T074144Z/` (`result.json`, `kick-arm-handoff.md`, `lane-c-live.mjs`).

· **`--live` spec, verbatim from `result.json.handoffForLaneD.sharedCheckerFlag`:** "add `--live` to skills/dsh-qa/scripts/team-watchdog-config.mjs: mount the row in-process, write the sandbox workspace's .mpd/mpd.jsonc, re-read the SAME engine, print knobs before/after + the same-instance identity + liveWithoutRestart, and exit 0 only when the reading is real; keep its existing `restart-needed` mutant as the reddening arm. lane-c-live.mjs in this dir is the executable reference."
· **KICK spec, verbatim from `kick-arm-handoff.md`:** row id **`kick`**, subject "a HOLD stops NEW DELIVERY only — a kick is ANSWERED with a NAMED decline, claim/update still succeed, and the SAME kick delivers after the release"; the fixture table (state root `<workspace>/.mpd/team`, `probe-team` phase running, member `Architect`, tasks `t1`/`t2`, the REAL sidecar + registry `applyHold(...)`, `installTeamScheduler(ctx, {stateDir})` with `ctx.get('mpdWatchdog')` bridged); the **four readings** (0 deliveries + the named decline warning; claim/update SUCCEED with the hold record unchanged; after `session-watchdog-resume` the same kick delivers exactly 1; the refused kick writes nothing); the **two controls** (kick: the hold read neutered → 1 delivery while held; claim/update: the re-injected pre-redesign guard → throws); and its own "Expected row verdict: RED = the two controls; GREEN = the four readings".

## 2. The `--live` flag (T-18's regression pin) — landed and proven both ways

Landed in `skills/dsh-qa/scripts/team-watchdog-config.mjs` (functions `liveReading`, `seededLiveRevert`, `runLiveCli`, `liveVerdict`; CLI `--live` | `--mutant restart-needed [--out <dir>]`, with the existing `--self-test`/run paths untouched). **Three readings, all in this dir:**

| reading | command | result |
|---|---|---|
| shipped tree | `bun …/team-watchdog-config.mjs --live --out …/live` | **exit 0**; `mounted=90000 file=900000 sameInstance=900000 fileApplied=true restartRequired=false`; **`liveWithoutRestart: true`** — "the same instance reported the on-disk value with no restart" |
| the mutant | `… --mutant restart-needed --out …/mutant` | **exit 0** (detection is the success condition); the seeded revert reports `restartRequired=true`, `sameInstance=90000` → the assertion REDDENED; log: "mutant restart-needed: DETECTED (the assertion reddened)" |
| the gate's own `--self-test` | `bun …/team-watchdog-config.mjs --self-test` | **exit 0** ("PASS — team-watchdog-config (8 checks, 0 failed)") with the new arms `live-live: pass/0`, `live-restart-needed: fail/1`, `live-not-same-instance: fail/1` |

`config-live.log`, `config-mutant.log`, `config-self-test.log`; the two immutable `live-result.json` payloads are under `live/` and `mutant/` (an existing target is refused, exit 3).

## 3. The permanent KICK row — driven from the plugin's OWN suite (no second home)

`skills/dsh-qa/scripts/watchdog-redesign.mjs` now carries **row (g) `g`** (the next free letter after (a)–(f)): `kind: "suite"`, title/required/redPrediction taken from the frozen handoff, and the **driving delegated to the plugin's own instrument** — `runKickRow()` runs `packages/mpd-team-watchdog-plugin/test/lane-c-wave2.test.ts` and verdicts from ITS result (the instrument is the home; this row is the continuity/sweep-level reading, not a second instrument). The reading is marked `treeIndependent: true` and is cached, so both trees share one suite run.

**The instrument, run directly (`instrument-t48.log`, exit 0) — the three T-48 tests by name:**
```
(pass) T-48 … > held: the kick is ANSWERED with a NAMED decline, zero deliveries, team bytes untouched; claim+update still SUCCEED
(pass) T-48 … > CONTROL (kick): neutering the hold read site delivers while held — the KICK arm REDDENS
(pass) T-48 … > CONTROL (claim/update): re-injecting the pre-redesign tool guard REFUSES the same calls
```
**The row's own verdict (`redesign-row-g.log`, exit 0, `PASS — 9 checks, 0 failed`):**
```
row (g) the KICK arm (T-48, frozen D-2): a HOLD stops NEW DELIVERY only
  RED   verdict: RED   — instrument=…/lane-c-wave2.test.ts exit=0 readings=pass kickControl=pass claimUpdateControl=pass
  GREEN verdict: GREEN — instrument=…/lane-c-wave2.test.ts exit=0 readings=pass kickControl=pass claimUpdateControl=pass
  row verdict  : red=red green=green
```
So both directions are observed: RED = the two controls reproduced their mutant, GREEN = the four D-2 readings held. The driver's offline `--self-test` (which gained the row's fixture) is green too: **16 checks, 0 failed** (`redesign-self-test.log`).

**A pre-existing trap worth recording:** this driver must be run with **`bun`**, not `node`. Under `node` it dies importing the RED tree (`.mpd/red-baseline/…/machine.ts` → `./team.js`, which only bun resolves to `team.ts`); I verified that failure reproduces with the COMMITTED driver (`git show HEAD:…`), so it is not caused by this change — but a `node` invocation will look like a lane regression.

## 4. The runner contract — unchanged

`node scripts/run-qa-lanes.mjs --check-drift` → **exit 0**, printing `immutability required=9: team-watchdog-boot, team-watchdog-config, team-watchdog-fault, team-watchdog-heartbeat, team-watchdog-notify, team-watchdog-scene, tui-settings-bridge, watchdog-redesign, web-settings-bridge exempt=36` + "manifest and disk agree (51 entries)". No manifest change was needed: the row lives in the existing `watchdog-redesign.mjs` lane (`check-drift.log`).

## 5. The corpus change, MEASURED and re-reported (this supersedes the re-pin preview)

`node scripts/repin-vendor.mjs` (dry run, nothing written) — `repin-vendor-after.log`:
```
locked     : treeSha=68318157344aafecabb641b9d947d0f17ab6a4bce5c399b486f18790cc7e3a9c fileCount=323
computed   : treeSha=b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620 fileCount=323
             (1 file(s) LF-normalized)
raw-bytes  : 357b4bc858ebcb5154992a116b7a92bdd73c64476c3f84fc927c6afa94f7714c   <- NEVER write this one
DELTA      : 68318157344a… -> b9097d115ae0…
```
**The preview `2c748d482fd8bb9d…` (t11's reading) is SUPERSEDED** — a preview is a moment-bound reading, so the captain must re-derive at the write; this file records the value as of this change. **Cause: exactly the two files named in the header** (both under `skills/dsh-qa/scripts/`). THE UNION, measured rather than summed: t11's 13-file write set ∪ t28's 2 files = **14 distinct files = 12 CORPUS + 2 NON-CORPUS** — `team-watchdog-config.mjs` is in the overlap (t11 counted it; this task changed it again), so "11 + 2" would double-count it. Corpus list: `cases.json`, `extension-lifecycle.mjs`, `lib/immutable-output.mjs`, `team-watchdog-{boot,config,fault,heartbeat,notify,scene}.mjs`, `tui-settings-bridge.mjs`, `watchdog-redesign.mjs`, `web-settings-bridge.mjs`; non-corpus: `scripts/run-qa-lanes.mjs`, `scripts/reconcile-register.py`. File count unchanged (323 → 323).

## 6. Declared red and bounds

· **`bun run test:qa` → exit 1**, solely on the vendor lock: the full enumeration (`selftest-sweep.txt`) is **45 lanes, exactly ONE failing** — `agent-teams-messaging.mjs --self-test`, whose only failing line is `VENDOR_LOCK skills asset is stale: lock=323/68318157344a tree=323/b9097d115ae0 (re-pin in the same commit, AGENTS.md §9)` — i.e. the captain's single re-pin, which this task must precede, not perform. Both changed lanes' own self-tests pass (`config-self-test.log`, `redesign-self-test.log`).
· **Bounds:** the row is tree-independent by construction and says so in its reading — it is a continuity row, not a second instrument; the plugin's `test/**` arm remains the sole instrument home (lane C's inScope). No live `dsh` boot was run; everything here is in-process or a subprocess of the plugin's own suite.
