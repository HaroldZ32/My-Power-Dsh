# The Docker TUI lane's RED path, captured without a container lane run

**What this answers.** The independent verdict `evidence/docker/tui-lane-verify/2026-10-08T12-06Z/verdict.md`
recorded FAIL on one point only — finding **F1** (§5.4): condition (iii) *"`tui.laneExit` no longer reports a
FALSE abort for an ordinary red exit"* is **UNVERIFIED**, because every run of the repaired lane this wave
produced was green, and a green run cannot distinguish the repaired lane from the broken one (with an
all-green ending the code is `exit 0`, so the EXIT net's `code != 0` guard never even evaluates). §6.3 adds
that the genuine-abort branch the same predicate guards is unverified too.

This directory captures the two paired observations the finding asks for, from a harness that executes the
lane's own reporting bytes — **without** running the 25-minute container lane.

## 1. The frozen artifact (hash sandwich)

| Moment (UTC) | `docker/tui-lane.sh` sha256 | How measured |
|---|---|---|
| before the harness (step 1 of `output.log`) | `226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00` | `sha256sum`, refused if unequal |
| after every arm (step 9 of `output.log`) | `226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00` | `sha256sum`, printed by the harness |

The file's mtime is unchanged (`2026-10-08 19:55:40 +0800` = `11:55:40Z`, matching the verifier's own
`11:55:40.295Z` probe). The harness only ever READS the lane; it writes under this directory.

## 2. The harness, and why it is faithful

`run-red-path-harness.sh` (bash 5.3.9). It does not copy, paraphrase or rewrite any of the lane's decision
logic. It **extracts two byte ranges out of the frozen file itself**, asserts that the extracted text
carries the mechanism under test, and runs those bytes in a real bash under the lane's own `set -uo pipefail`:

| Extract | Lines taken | sha256 | Verified content |
|---|---|---|---|
| `extracted/prologue.sh` | 48 lines, `json_escape() {` … `trap 'on_exit' EXIT` | `e5c49b9930ff315aca4c922b789809be9a241d53b37bff9f4413003cb920e3dc` | `record() {`, `LANE_EXIT_RECORDED=0`, `trap 'on_err' ERR`, `trap 'on_exit' EXIT`, `abort=exit-$code net=EXIT-trap` |
| `extracted/epilogue.sh` | 23 lines, `# Summarise: every tui.* record…` … `exit 1` | `179394fd34c0205da13518c35cf866ca4c4382de0c115717ce3ffffaabdccbec` | `TUI_SUMMARY=`, the awk census `"name":"tui\.`, `LANE_EXIT_RECORDED=1`, `exit 1` |

Both are installed at the same point in the script's lifetime as in the lane: the prologue's traps are
installed before the first arm (lane line 172), the epilogue is the real terminal summary and ending.

- **What is real:** the reporting helper, the ERR trap handler, the EXIT net, the awk census over the state
  file, the green/red branch, the `exit 1`, and bash's own EXIT/ERR trap dispatch.
- **What the arms stand in for:** only the arm bodies (npm / dsh / tmux / probes) that decide *which*
  records exist. Each seed calls the lane's OWN `record` function with the lane's OWN 21 arm names, read out
  of the frozen file (the harness asserts the count is 21).
- **What is stubbed:** the scratch environment (`STATE_FILE` plus the three path variables the lane
  requires). This cannot influence the predicate: the predicate reads the script's exit status and the value
  of `LANE_EXIT_RECORDED`, nothing else.

### The arms

| arm | what it stands for | expectation |
|---|---|---|
| `d-green` | all 21 arms true (the wave's green runs) | green ending, exit 0, no abort claim |
| `a-red` | the four fixture arms false — the 2026-10-08 08:52 baseline state | **half 1**: red ending, exit 1, NO abort record |
| `b-exitnet` | a `set -u` unbound-variable abort (the lane's own 2026-10-06 incident) | **half 2**: the EXIT net publishes `abort=exit-1 net=EXIT-trap` |
| `c-errtrap` | an unguarded step failing with code 9 (the shape of lane line 172) | **half 2**: the ERR trap publishes the abort, the net stays silent |
| `a-red-nofix` | the `a-red` run with the ONE line `LANE_EXIT_RECORDED=1` deleted | **falsifiability control**: must reproduce the pre-repair double report |

32 assertions, 0 failures, harness exit 0 (section census in `output.log`: 9 on the extracted text, 1 on the
arm count, 4 + 7 + 3 + 4 + 4 on the five arms).

## 3. Observation 1 — an ordinary red terminal exit records its failing assertions and NO abort record

The lane is driven to its real red ending through the extracted epilogue. `arms/a-red/exit-code.txt` is `1`.

The terminal record, verbatim (`arms/a-red/console.log`, last line):

```
[record] tui.laneExit=false — the TUI lane finished with failing or missing assertions
```

The record as written to the state file (`arms/a-red/state.jsonl`):

```
{"name":"tui.laneExit","ok":false,"reason":"the TUI lane finished with failing or missing assertions","raw":"records=21 failed=4"}
```

The four failing arms and the single terminal record (`state.jsonl` holds 22 lines, exactly ONE
`tui.laneExit`):

```
{"name":"tui.teamSceneOpened","ok":false,"reason":"arm seed: this lane arm ran and recorded through the lane own record helper","raw":"seed=red-path-harness"}
{"name":"tui.teamGraphDrawn","ok":false,"reason":"arm seed: this lane arm ran and recorded through the lane own record helper","raw":"seed=red-path-harness"}
{"name":"tui.teamGraphEdges","ok":false,"reason":"arm seed: this lane arm ran and recorded through the lane own record helper","raw":"seed=red-path-harness"}
{"name":"tui.teamGraphContent","ok":false,"reason":"arm seed: this lane arm ran and recorded through the lane own record helper","raw":"seed=red-path-harness"}
```

The abort claim, counted on both surfaces:

```
grep -cF 'abort=exit-' arms/a-red/console.log  ->  0
grep -cF 'abort=exit-' arms/a-red/state.jsonl  ->  0
grep -cF 'net=EXIT-trap' arms/a-red/console.log -> 0
```

**Half 1 holds: a red terminal exit publishes the failing-assertions record and no abort record.**

## 4. Observation 2 — a GENUINE abort still reports an abort (both trap classes)

### 4a. EXIT-net class — an abort the ERR trap cannot see (`set -u` unbound variable)

`arms/b-exitnet/console.err`:

```
…/arms/b-exitnet/arm.sh: line 88: MERGED_TITLE_HITS: unbound variable
```

`arms/b-exitnet/exit-code.txt` is `1`. `arms/b-exitnet/console.log`, last line:

```
[record] tui.laneExit=false — the TUI lane exited with 1 without the ERR trap seeing it (an immediate abort such as a set -u unbound variable) — earlier tui.* records are the assertions that had already run, and every arm after this point reads as 'not reached'
```

`arms/b-exitnet/state.jsonl`:

```
{"name":"tui.laneExit","ok":false,"reason":"the TUI lane exited with 1 without the ERR trap seeing it (an immediate abort such as a set -u unbound variable) — earlier tui.* records are the assertions that had already run, and every arm after this point reads as 'not reached'","raw":"abort=exit-1 net=EXIT-trap"}
```

### 4b. ERR-trap class — an unguarded step fails (the shape of lane line 172)

`arms/c-errtrap/exit-code.txt` is `9` — the failing step's own code, preserved by `exit "$code"`.
`arms/c-errtrap/state.jsonl` carries exactly ONE `tui.laneExit`:

```
{"name":"tui.laneExit","ok":false,"reason":"the TUI lane aborted (exit 9) — see this step's log; earlier tui.* records are the assertions that had already run","raw":"line=88"}
```

`grep -cF 'net=EXIT-trap' arms/c-errtrap/state.jsonl` -> `0`: the ERR trap recorded the abort and the EXIT
net correctly stayed silent, so a genuine abort is reported exactly ONCE.

**Half 2 holds: both nets still fire when the script does not itself set `LANE_EXIT_RECORDED`. The pair
`a-red` (exit 1, no abort claim) against `b-exitnet` (exit 1, abort claim) differs ONLY in the predicate,
so the reading in §3 is caused by `LANE_EXIT_RECORDED=1` and not by anything else.**

## 5. Falsifiability control — the harness can fail

`arms/a-red-nofix` is the same red run with `LANE_EXIT_RECORDED=1` deleted from the extracted epilogue.
`a-red-nofix.diff` shows the generated scripts differ by exactly that line (plus their own header comment):

```
109d108
< LANE_EXIT_RECORDED=1
```

The control arm's `state.jsonl` then carries TWO `tui.laneExit` records — the pre-repair double report:

```
{"name":"tui.laneExit","ok":false,"reason":"the TUI lane finished with failing or missing assertions","raw":"records=21 failed=4"}
{"name":"tui.laneExit","ok":false,"reason":"the TUI lane exited with 1 without the ERR trap seeing it (an immediate abort such as a set -u unbound variable) — earlier tui.* records are the assertions that had already run, and every arm after this point reads as 'not reached'","raw":"abort=exit-1 net=EXIT-trap"}
```

This reproduces the measured 2026-10-08T08-52-23Z defect (`abort=exit-1 net=EXIT-trap` beside the terminal
record) and shows the harness is able to observe an abort. It is a MUTATION of the extracted text, used only
as a control: it says nothing about the lane, which still carries that line.

## 6. Fidelity anchor against the REAL container run

The harness's green arm reproduces the real run's own line byte-for-byte.

- real run, `evidence/docker/tui-lane-verify/2026-10-08T12-06Z/lane.log`:
  `[record] tui.laneExit=true — the TUI lane ran to completion with every assertion green`
- harness `arms/d-green/console.log`, last line: the same line, byte-identical
- and `arms/d-green/state.jsonl`: `{"name":"tui.laneExit","ok":true,"reason":"the TUI lane ran to completion with every assertion green","raw":"records=21"}`,
  matching the verifier's quoted `tui.laneExit ok=true raw=records=21` (§5.1 of the verdict).

The harness therefore reproduces the wave's observed green ending as well as the unobserved red one; it is
not rigged to emit aborts.

## 7. Does this close condition (iii)?

**On the mechanism: yes, with a controlled pair.** The predicate is shown flipping under a red exit — the
exact thing the verifier said no green run could show — and the repair is shown to be narrowly scoped
(deleting its one line restores the defect; both abort classes still report).

**On the contract's wording: not literally.** `.mpd/plans/repair-r-docker-tui-fixture-amendment.md` §2 asks
for the corrected record of a red run *"quoted from a real run's `console.log` and `result.json` — never a
reading of the lane's source"*. What is captured here is not a reading: the lane's own bytes were EXECUTED
and the records were produced by the lane's own `record` into a real state file. But it is not the container
lane either — the arm bodies are stood in for. A strict reader may still hold that (iii) needs a container
red run, and the captain is the one who decides. My recommendation is in §9.

## 8. What I could NOT verify

1. **The container lane never ran here.** The npm/dsh/tmux/probe arm bodies that produce the 21 records'
   values are not exercised; only their reporting path is. Cost avoided: ~25 minutes of container time.
2. **No real red container run was attempted, and none is claimed.** The wave's red baseline
   (`evidence/docker/client-install/2026-10-08T08-52-23Z/`) is cited, not re-measured.
3. **The credential-gated and host-observability nulls** are outside this harness, as before.
4. **`a-red-nofix` is a mutation**, not the lane's bytes: it demonstrates the harness can fail, nothing more.

## 9. If a container red run is required, the honest options

- **Ordinary red ending (half 1) in a container is NOT reachable by an environment perturbation.** The
  lane's early steps are UNGUARDED (line 172 `npm i -g …`, line 182 `dsh plugin … add`), so an early failure
  trips the ERR trap and becomes an abort, not an ordinary red ending. The ordinary red ending requires a
  `record … false` arm, and every such arm is guarded (`$(… && echo true || echo false)`), so it needs the
  fixture/product state that made the four fixture rows red — i.e. the pre-repair baseline state. That is a
  ~25-minute run against a scratch tree carrying the pre-repair product code with the lane file still at the
  frozen hash; I did not attempt it and cannot promise it reaches the terminal red path rather than an abort.
- **Half 2 in a container IS reachable with zero edits**, and cheaply in setup: compose wires
  `MPD_E2E_TUI_VERSION` (`docker/docker-compose.yml:64`) and the entrypoint exports it as the lane's
  `TUI_VERSION`, so `MPD_E2E_TUI_VERSION=<uninstallable> node scripts/docker-e2e.ts --mode source
  --require-docker` makes step 1 fail → the ERR trap publishes `line=…` in a real container. Still ~25
  minutes, and it exercises the ERR class only. **Not run by me; stated as available, not as measured.**

## 10. Reproduce

```
bash evidence/docker/tui-lane-repair/red-path/run-red-path-harness.sh   # exit 0 == every assertion held
```

Raw console output of the run: `output.log`. Per-arm raw artifacts: `arms/<arm>/{arm.sh, console.log,
console.err, state.jsonl, exit-code.txt}`.

| file | sha256 |
|---|---|
| `run-red-path-harness.sh` | `618d55165574abf4f97adec87f342000cfbc9116e77838f6160a859784e2d2e2` |
| `extracted/prologue.sh` | `e5c49b9930ff315aca4c922b789809be9a241d53b37bff9f4413003cb920e3dc` |
| `extracted/epilogue.sh` | `179394fd34c0205da13518c35cf866ca4c4382de0c115717ce3ffffaabdccbec` |
| `arms/d-green/arm.sh` | `26614658764afd1cf1c8504d0fecaad41e309019f1767a932e64ab89e67795e5` |
| `arms/a-red/arm.sh` | `a49365cea531d30f7c3e6c3a2e80c8b0c7e922fadb6a7af977330f2369de0001` |
| `arms/b-exitnet/arm.sh` | `2ba3aabd90e99adfc14d4c2228706439c49a3c32568925cc56a1bacaa7f13915` |
| `arms/c-errtrap/arm.sh` | `106ba2bd6665e02d4322593cc67d58bf008c250aedb6efd99b95e315a4a2ebda` |
| `arms/a-red-nofix/arm.sh` | `27dd8e017fab97d2d3e3cefd718dfbc6b24bd9519b1b71fbc8aba079c572fa7d` |
