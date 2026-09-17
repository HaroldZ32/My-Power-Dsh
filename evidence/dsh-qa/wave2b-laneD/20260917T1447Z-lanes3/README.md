# t18 CORRECTION + CARRY-FORWARD — the `--only` subset's third lane, resolved (not "in flight")

Nested record beside the SEALED t18 stamp (`evidence/dsh-qa/wave2b-laneD/20260917T143544Z/`), which is
NOT edited by this file. Author: qa-lane-engineer (lane D). Written 2026-09-17T15:02Z.

## 1. THE CORRECTION

t18's stored output ends its verify paragraph with "subset run: 2 of 3 selected lanes PASS at
submission …, third in flight." That sentence is now RESOLVED and it was over-optimistic: the third
lane is **RED**, and it is red on a re-run as well.

- The original subset run was still executing when t18 was submitted; it finished afterwards with
  `ONLY EXIT=1` (`evidence/dsh-qa/wave2b-laneD/20260917T143544Z/lanes/result.json`,
  `complete:true`, `finishedAt 2026-09-17T14:52:32.766Z`):
  `session-start-team fail exit 1 ms 529791 reason exit-1`.
- Independent re-run by this seat, ONE lane, new stamp:
  `node scripts/run-qa-lanes.mjs --only=session-start-team --evidence-dir=evidence/dsh-qa/wave2b-laneD/20260917T1447Z-lanes3`
  → **exit 1**, `complete:true`, `finishedAt 2026-09-17T15:01:48.160Z`, `ms 855936`.
  Runner log: `runner.log` in this directory; per-case log: `lanes/lanes/session-start-team.log`;
  lane evidence: `evidence/dsh-qa/session-start-team/2026-09-17T14-47-32.307Z/`.

A reader must therefore NOT treat the `--only` subset as 3/3. It is **2 PASS / 1 FAIL**, and the FAIL
is classified in §4 rather than hidden.

## 2. WHICH ARM FAILED, AND WHAT IS GREEN IN THE SAME RUN

Both runs fail the same arm: `twoSided.ok=false`, and inside it **only the complex side's team count**.
`complexNotices` is `[true,true,true]` in EVERY run — the session-start NOTICE always fired; what varies
is whether the model actually starts a team.

| run | twoSided | complexTeams | failing cell(s) |
|---|---|---|---|
| 14:43:43.007Z (subset) | false | `[1,0,1]` | #2 `team: fix the flaky test` (teams 0) |
| 14:47:32.307Z (re-run) | false | `[0,0,1]` | #1 `Align the bundle with upstream…` and #2 (teams 0) |

Everything else in both runs is green, including every step my T-69 change touches:
`settled {ok:true, rev ca780331abdaecdef2e35ad7cad643bb69d86d90, gateHash b8a483c176fcbe30…}` ·
`installer {ok:true,exit:0}` · `patchRow {ok:true,hasRow:true}` · **`compose {ok:true,exit:0}`** ·
`negativeControl {ok:true,disarmed:true}` · `simpleSide` 3/3 `ok:true` (correctly starting NO team).

## 3. THE FLAKE CENSUS (artifact paths, not prose)

| stamp | complexTeams | twoSided | when relative to this lane's diff |
|---|---|---|---|
| `evidence/dsh-qa/session-start-team/2026-09-16T07-47-18.287Z/result.json` | `[1,0,1]` | false | before wave 2 |
| `evidence/dsh-qa/session-start-team/2026-09-17T01-39-23.411Z/result.json` | `[1,1,1]` | **true** | before |
| `evidence/dsh-qa/session-start-team/2026-09-17T04-38-14.171Z/result.json` | `[1,0,0]` | false | before |
| `evidence/dsh-qa/session-start-team/2026-09-17T04-56-06.842Z/result.json` | `[0,0,1]` | false | before |
| `evidence/dsh-qa/session-start-team/2026-09-17T14-43-43.007Z/result.json` | `[1,0,1]` | false | after (this lane's change) |
| `evidence/dsh-qa/session-start-team/2026-09-17T14-47-32.307Z/result.json` | `[0,0,1]` | false | after |

Five of six recent runs are red and the failing CELL moves; the single green run is the earliest of the
wave-2 day. The arm is a live-LLM routing decision, so this is the expected signature of a stochastic
assertion, not of a deterministic regression.

## 4. THE THREE-WAY CLASSIFICATION (why lane D does not patch it here)

1. **Missing prerequisite — NO.** Every prerequisite step reports ok in the failing runs (§2); the lane
   executed end-to-end and wrote its evidence.
2. **Product/assertion bug fixable in-lane — NO, and patching it would change semantics.** The failing
   predicate is "the model starts a team for each of three complex prompts". Loosening it (accept 1 of 3,
   retry, or drop the cell) would silently weaken a lane that was deliberately built two-sided with a
   disarmed negative control. That is a semantics change and belongs to a routed repair task, not to a
   terminal implementation task.
3. **In-flight teammate edit — NO, by the same census.** Three red runs predate this lane's diff; the
   corpus mtime is frozen at `2026-09-17 22:41:40 +0800` (this lane's own edit) and the digest is
   unchanged through both runs (§5).

The diff this lane made in that file is 5 insertions / 2 deletions and touches ONLY the compose step,
which is green in both red runs:

```
-  const dump = runSync("dsh", ["--profile", "mpd-headless", "--dump-config"], …)
-  steps.compose = { ok: dump.status === 0 && dump.out.includes("agent-teams") … }
+  const dump = runSync(process.execPath, [join(repoRoot, "scripts", "dump-config.mjs"), "--profile", "mpd-headless", "--json"], …)
+  const dumpText = safeJson(dump.out)?.stdout ?? dump.out
+  steps.compose = { ok: dump.status === 0 && dumpText.includes("agent-teams") … }
```

## 5. THE RE-PIN READING, RE-DERIVED AFTER BOTH LANE RUNS (2026-09-17T15:02:03Z)

`node scripts/repin-vendor.mjs` (dry run, exit 0):
`skills` locked `b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620` / 323 →
**computed (LF) `234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70` / 324**
(1 file LF-normalized); raw-bytes `a917a4055fd31455b253b894a3d06ab520113acd566af94e0a105ea7994aaacf`
NEVER to be written. The other treeSha asset (`packages/mpd-agent-teams-plugin/_deps`) is in sync
(`d1d10603…` / 635). `node scripts/repin-vendor.mjs --check` → **exit 1** (pre-write state, lock
byte-unchanged). The value is IDENTICAL to t18's request, i.e. no `skills/**` edit happened after the
one that invalidated the lock — the request stands as written.

## 6. CARRY-FORWARD (for the captain's routing, not a self-assignment)

- `session-start-team` is one of the wave's corpus lanes (T-69 switched its compose step). Its
  deterministic half is green; its stochastic half is red in 5 of 6 recent runs, including three
  pre-diff runs. Any wave-level sweep that runs this lane (e.g. `bun run test:qa`) can therefore go red
  for a reason unrelated to the wave's changes.
- Two honest remedies, for the captain to choose: (a) a routed repair task that makes the routing arm
  falsifiable-by-construction (e.g. an explicit team-start trigger the harness guarantees, or a declared
  N-of-M bound recorded in the lane's own output), or (b) a declared, measured bound in the wave report —
  this census, with the per-run `complexTeams` vector and the notice-always-fires fact.
- Lane D does NOT self-assign either; t18 is terminal and its attempt is closed.
