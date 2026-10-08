# Independent verdict — does `evidence/docker/tui-lane-repair/red-run/` CLOSE finding F1?

**VERDICT: PASS — F1 is CLOSED, with three recorded bounds.** Finding F1 demanded one thing: the corrected
record of a **RED** run, quoted from a real run's `console.log` and `result.json` rather than from the lane's
source. A real container run of the frozen lane exists at the frozen hash, it ended on its TERMINAL red path,
and its own artifacts carry exactly ONE `tui.laneExit=false — the TUI lane finished with failing or missing
assertions` with ZERO abort claims. Every number the author reported is true of the bytes on disk.

- **Judging seat:** Reviewer, read-only. No file edited; this verdict is the only file written.
- **Artifact judged:** `evidence/docker/tui-lane-repair/red-run/` (run stamp 2026-10-08T12:24:15Z → 12:29:38Z).
- **Finding judged:** `evidence/docker/tui-lane-verify/2026-10-08T12-06Z/verdict.md` §5.4 (F1), condition (iii).
- **Contract:** `.mpd/plans/repair-r-docker-tui-fixture-amendment.md` §2, replaced requirement 4.
- **Verdict written:** 2026-10-08T12:35Z.

**The sub-question that DECIDES this verdict is #3 (the forced precondition).** #1, #2 and #4 all pass
outright; #3 is the only place a reasonable reviewer could land on FAIL, and the artifact carries enough
checkable structure to settle it in the artifact's favour. §4 states the reasoning that makes it checkable.

---

## 1. What I ran, verbatim

All commands were run with `evidence/docker/tui-lane-repair/red-run` as cwd (or the path named), on
2026-10-08 between 12:32Z and 12:35Z:

```
$ wc -l -c console.log result.json output.log
  3248 191526 console.log
  1219  70543 result.json
  3316 196397 output.log

$ grep -c 'abort=exit-' console.log                 -> 0
$ grep -c 'net=EXIT-trap' console.log               -> 0
$ grep -c 'the TUI lane aborted' console.log        -> 0
$ grep -c 'tui.laneExit=false' console.log          -> 1
$ grep -c 'abort=exit-' result.json                 -> 0
$ grep -c 'net=EXIT-trap' result.json               -> 0
$ grep -c 'abort=' result.json                      -> 0
$ grep -c 'abort' result.json                       -> 0
$ grep -c 'the TUI lane aborted' result.json        -> 0
$ grep -c 'abort' console.log                       -> 6   (all incidental prose — see §2)
$ grep -c 'the TUI lane aborted' output.log         -> 0
$ grep -n 'tui.laneExit' console.log
3197:[record] tui.laneExit=false — the TUI lane finished with failing or missing assertions
3215:[report] FAIL tui.laneExit — the TUI lane finished with failing or missing assertions | raw: records=21 failed=4
$ grep -n '^\[report\] ok=' console.log
3210:[report] ok=false complete=false passed=60 failed=5 null=31 scrubbed=true -> /out/result.json
$ grep -n '^\[red-run\]' console.log
1:[red-run] build start 2026-10-08T12:24:12Z
94:[red-run] build exit=0 at 2026-10-08T12:24:15Z
95:[red-run] container start 2026-10-08T12:24:15Z
3248:[red-run] container exit=1 at 2026-10-08T12:29:38Z

$ sha256sum docker/tui-lane.sh
226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00  docker/tui-lane.sh
$ find vendor/mcp-src -type f | wc -l
459
$ git status --porcelain docker/tui-lane.sh
 M docker/tui-lane.sh
```

---

## 2. Sub-answer 1 — IS THE RECORD REAL? **YES.** Every reported claim is true; nothing is false.

The terminal record exists, once, in all three surfaces the author names:

| surface | location | text |
|---|---|---|
| `console.log` | `:3197` | `[record] tui.laneExit=false — the TUI lane finished with failing or missing assertions` |
| `console.log` (reporter row) | `:3215` | `[report] FAIL tui.laneExit — … \| raw: records=21 failed=4` |
| `output.log` | `:3116`, `:3310` | same two lines |
| `result.json` | single entry | `{"name":"tui.laneExit","ok":false,"reason":"the TUI lane finished with failing or missing assertions","raw":"records=21 failed=4"}` |

The abort strings are genuinely absent. The `6` hits for the *bare* token `abort` in `console.log` are all
incidental prose from the bundle's own documentation stream — `console.log:487` (`…an apply abort or a schema
rejection`), and five copies of the MPD preset text `If the review channel is unavailable or aborted, stay in
plan` (`:757, :1210, :1392, :1656, :2398`). None is a record. `result.json` contains **zero** occurrences of
`abort` in any spelling. The `counts.txt` table reproduces exactly; I found no claim in `report.md` that the
bytes contradict.

The run is authentic, not an assembled log: `console.log:1-16` is a real buildkit stream (`load local bake
definitions`, `load build definition from Dockerfile`), and `console.log:82` carries
`#20 exporting manifest list sha256:1a5bb7b19c6d293a1880dabf8f9973df5dc12446393de35cc4c2c82f72f386ea` — the
image identity `report.md:14` claims, present in the build output rather than only in prose.

## 3. Sub-answer 2 — IS IT THE RIGHT PATH? **YES, and this is not inference from prose.**

The lane's own append-only record stream (`raw-state/assertions.ndjson`, 96 records, written by the lane's
`record()` via `printf … >> "$STATE_FILE"`) has this order:

```
 63 tui.teamSceneOtherSessionInvisible=None
 64 tui.teamFixtureBound=False
 65 tui.teamSceneOpened=False
 66 tui.teamGraphDrawn=False
 67 tui.teamGraphEdges=True          <- an arm BETWEEN the failing ones still measured
 68 tui.teamGraphContent=False
 69 tui.mergedPanelOpens=None
 70 tui.mergedPanelOrder=None
 71 tui.hostDashboardKeyIntact=True
 72 tui.noDirectTuiSeam=True
 73-79 live.tui.* = None
 80 tui.boot=True                    <- the three arms the F1 verdict named as terminal-path proof
 81 tui.noFatalSignatures=True
 82 tui.sessionPreset=True
 83 tui.laneExit=False
 84-95 live.headless.* + boot.llmTurn + live.teamRecord/nativeExecutor/headlessPresetRow/credentialRemoved
```

Every arm after the scene sequence ran and recorded; the lane reached its END. The run then continued into
the entrypoint's next step (`live.headless.*`), which can only happen after the lane process is gone.

Two further checks that the terminal class — not the abort class — was taken:

1. **No ERR-trap record.** `grep -c 'the TUI lane aborted' …` = 0 everywhere; the ERR handler at
   `docker/tui-lane.sh:119-124` is the only writer of that text and it never ran.
2. **The exit code is the lane's own.** `result.json` step `14-tui` is `exit=1, cmd="bash docker/tui-lane.sh"`,
   and `console.log:3248` reports `container exit=1`. A signal kill would be 137/143, not 1; the only `exit 1`
   site in the lane is `docker/tui-lane.sh:1241`.
3. **The census floor held.** The terminal record's own raw is `records=21 failed=4` — the pinned floor of 21
   (`docker/tui-lane.sh:1226-1232`) was met exactly, so the seed did not thin the lane's record set.

## 4. Sub-answer 3 — DOES THE FORCED PRECONDITION INVALIDATE IT? **NO — and here is the checkable reasoning.**

The predicate under test, verbatim from the frozen bytes (`docker/tui-lane.sh:126-132` and `:1232-1241`):

```
on_exit() {
  local code=$?
  if [ "$code" != "0" ] && [ "$LANE_EXIT_RECORDED" = "0" ]; then
    record tui.laneExit false "the TUI lane exited with $code without the ERR trap seeing it …" \
           "abort=exit-$code net=EXIT-trap"
  fi
}
trap 'on_exit' EXIT
…
if [ "${TUI_BAD:-0}" = "0" ] && [ "${TUI_TOTAL:-0}" -ge 21 ]; then
  record tui.laneExit true "the TUI lane ran to completion with every assertion green" "records=$TUI_TOTAL"
  exit 0
fi
record tui.laneExit false "the TUI lane finished with failing or missing assertions" "records=$TUI_TOTAL failed=$TUI_BAD"
LANE_EXIT_RECORDED=1
exit 1
```

Three independent pillars, each checkable by a reader who trusts only the artifacts or only the bytes:

**Pillar 1 — the predicate reads exactly two things, and the seed can influence neither.** `on_exit` reads
`$code` and `$LANE_EXIT_RECORDED`. The seed (`teams.json` / `teams/tui-scene.json` symlinked to `/dev/null`)
can only change the *arm values* that feed the census at `:1232`; it cannot change which branch runs once
`TUI_BAD ≥ 1`. A natural red and a forced red with `TUI_BAD ≥ 1` fall through the identical three statements
`:1236 → :1240 → :1241`. There is no third route to `exit 1` in the file: every other `exit` is either
`on_err`'s (`:123`) or the green branch's (`:1234`).

**Pillar 2 — the artifact itself pins the program counter past `:1236`.** The string
`the TUI lane finished with failing or missing assertions` is written by exactly ONE statement in the lane
(`:1236`), and the artifact carries it once, with the matching raw `records=21 failed=4`. Between that
statement and the observed `exit 1` there are only two statements — the flag assignment and the exit. So the
artifact **contains** the fact that `LANE_EXIT_RECORDED=1` was executed before the observed exit; the flag is
not an assumption imported from the source. Bash runs an installed EXIT trap on the `exit` builtin, and the
lane installs it once (`:132`) and never removes it (no `trap -` anywhere; `grep -n 'trap' docker/tui-lane.sh`
returns only `:125`, `:132` and comments). Therefore the guard at `:128` was evaluated and returned false.
That is why "no abort record" here is a suppression, not a silence.

**Pillar 3 — the counterfactual is demonstrated twice, at two different levels.** (a) The real pre-repair
container run at the same defect shows the double report: `evidence/docker/client-install/2026-10-08T08-52-23Z/`
`console.log:3192` (terminal record) **and** `:3193` (false abort), with `:3210`
`[report] FAIL tui.laneExit … | raw: abort=exit-1 net=EXIT-trap`; I re-ran the counts on that baseline:
`abort=exit- 1`, `net=EXIT-trap 1`. (b) The extracted-bytes harness control
`evidence/docker/tui-lane-repair/red-path/arms/a-red-nofix/state.jsonl` — the same prologue/epilogue with the
ONE line `LANE_EXIT_RECORDED=1` deleted — gives back exactly two `tui.laneExit` records, the second with
`"raw":"abort=exit-1 net=EXIT-trap"`. Same exit code (1), same arms, only the predicate differs.

**Why the forced route is not merely a shortcut around a cheap natural route.** At the frozen lane hash, a
natural red that still reaches the TERMINAL path requires the fixture scene arms to fail while every other arm
measures — i.e. the requirements-1/2 fixture-binding code (the very code under test, uncommitted in the same
file) not taking effect. Reproducing it naturally means reverting that implementation, which produces an
artifact at a DIFFERENT hash — no longer "the frozen lane". The seed changes the environment around the frozen
bytes instead of the bytes: the hash sandwich (`lane-sha256-before/in-container/after.txt`) is the same
`226cdb1c…7094b00`, and I re-measured the file today: `226cdb1c…7094b00`, 87598 bytes, mtime 11:55:40Z,
`git status` still ` M`. The author's own harness report states the natural-red container option was not
attempted and cannot be promised to reach the terminal path (`red-path/result.md` §8.2, §9) — an honest bound
that matches what I find the code implying.

**On F1's own wording.** F1's `expected:` reads: *"a REAL red run (e.g. the pre-repair defect state, fixture
unbound, which made the four rows red on the 08:52 baseline)"*. The artifact IS a fixture-unbound red run
whose scene rows are red — three of the four by the same mechanism. The `e.g.` names an example, and the
artifact satisfies the demand (terminal record + no abort claim, quoted from a real run) while being a
different *flavour* of unbound fixture. That difference is a bound (§6), not a failure to answer.

**Counter-argument I weighed and rejected.** One could argue that a forced red is not the defect state the
requirement was written about, so the requirement is still unproven. That argument proves too much: replaced
requirement 4's subject is *"a red run that reached its end"*, not *"a red run caused by defect X"* — the
defect the requirement is about is the REPORTING defect, and the reporting defect is exactly what a red run
exercises. Holding F1 open for a natural red would mean holding it open for an artifact that the freeze makes
unreachable, which is perfectionism, not rigour.

## 5. Sub-answer 4 — IS THE ARTIFACT SELF-CONSISTENT? **YES.**

| claim | check | result |
|---|---|---|
| one lane hash, three measurements | `lane-sha256-{before,in-container,after}.txt` all `226cdb1c…7094b00`; I re-measured the repo file today | **identical** |
| the in-container path is real | `docker/Dockerfile:60` `COPY docker/tui-lane.sh /opt/mpd-e2e/tui-lane.sh` matches the path in `lane-sha256-in-container.txt` | **matches** |
| `vendor/mcp-src` unpolluted | `find vendor/mcp-src -type f \| wc -l` | **459** (as before; matches the F1 verdict's own before/after) |
| the extra bind is the only addition | `docker/docker-compose.yml` binds only `${MPD_DOCKER_OUT}:/out`; `run-red.sh` adds `-v "$EVID/scratch:/work"` over the service's `WORKDIR /work` | **consistent with the seed story** |
| the container's tree fingerprints | the red run's 28 `result.json` `hashes` entries vs the independently-verified driver run `evidence/docker/client-install/2026-10-08T12-05-34Z/result.json` | **28/28 identical, 0 different** (expected: the 12:05:57Z `mpd-tui-plugin/dist` rebuild predates this 12:24Z build) |
| the red is real, not asserted in prose | `tui-panes/pane-team.txt` carries `MPD team — (none)` and `no team in this session — stage one with agent_teams_plan, then approve it`; `pane-boot.txt` shows the TUI's chat screen | **matches the failing arms** |

**One adjacent observation, NOT part of this verdict and NOT a finding against F1 (severity: low, pre-existing).**
`tui.teamSceneOpened`'s reason is a constant, so a FAILING instance still reads `the /mpd team scene opened on a
real terminal` (`docker/tui-lane.sh:795-796`); the same pair appears in the 08-52 baseline (`[report] FAIL
tui.teamSceneOpened — the /mpd team scene opened on a real terminal`). My verdict does not require a fix, and
requirement 2 ("keep every existing arm's meaning") puts it out of this scope — but a reader of the red artifact
who reads reasons rather than `ok` values could be misled.

## 6. Residual bounds this PASS carries (stated, not implied)

1. **B1 — the red shape is not the baseline's shape.** The seed also blinded the record, so
   `tui.teamGraphDrawn` reads `tasksFromRecord=0` where the 08-52 baseline read `3`, and one arm,
   `tui.teamSceneOtherSessionInvisible`, recorded `null` (not measured) rather than its green `true`. This
   costs nothing that is not covered elsewhere: F1's own verdict already recorded condition (ii)
   (requirement 3's arm, both directions) as **PASS** on its independent green run
   (`…/2026-10-08T12-06Z/verdict.md` §5.2). The red run therefore does not need to re-prove requirement 3, and
   this PASS does not claim it did.
2. **B2 — no `driver.json`.** The run drove the compose service directly, so the shipped wrapper's fields
   (`unmeasured`, `requiredPrefixes`, the driver's own exit classification) are absent. The contract names
   `console.log` and `result.json`, and both are present and are the container's own reporter output; the
   `console.log` is a runner capture of the same stream the driver tees, which the author disclosed
   (`report.md` §5.4). A future reader should not cite a `driver.json` for this run — there is none.
3. **B3 — the comparison baseline is cited, not re-measured.** The pre-repair double report is quoted from
   `2026-10-08T08-52-23Z`, a different hash by necessity. The in-vitro control (`a-red-nofix`) supplies the
   same pair without that dependency, and that control is a mutation of extracted bytes — it demonstrates the
   harness can fail, not that the lane is broken.

## 7. What I could NOT verify

1. **That the seed alone, absent the repair, would produce the abort on this exact container run.** Not
   measured; the counterfactual rests on B3's two independent observations.
2. **The genuine-abort half in a container** (`set -u` / ERR trap). Out of F1's scope, and still unverified —
   F1 itself listed it under "what I could not verify" (§6.3 of the verdict). The in-vitro arms
   `b-exitnet`/`c-errtrap` show both nets still fire, but they are extracted bytes, not a container.
   Note for the record: `b-exitnet`'s `abort=exit-1 net=EXIT-trap` appears only in `state.jsonl`, never in
   `console.log` — the lane's `record()` prints `name=status` plus the reason, not the raw
   (`docker/tui-lane.sh:88-92`), so the raw reaches a console only through the reporter's `| raw:` suffix.
   A reader grepping a console for `net=EXIT-trap` will always get 0; grep `state.jsonl`/`assertions.ndjson`
   or the reporter rows instead.
3. **No re-run of the 25-minute lane.** I judged the artifacts; I did not reproduce the container run.

## 8. Reproduction / verification commands (agent-executable, no user intervention)

Run from the repo root; every command is read-only and every expected value is the one I measured.

```
# 1. the record under test: exactly one, honest, and no abort anywhere
cd evidence/docker/tui-lane-repair/red-run
grep -c 'tui.laneExit=false' console.log            # expect 1
grep -c 'abort=exit-' console.log                   # expect 0
grep -c 'net=EXIT-trap' console.log                 # expect 0
grep -c 'the TUI lane aborted' console.log          # expect 0
grep -c 'abort' result.json                         # expect 0
python3 -c "import json;d=json.load(open('result.json'));print([a['raw'] for a in d['assertions'] if a['name']=='tui.laneExit'])"   # expect ['records=21 failed=4']

# 2. terminal path, not abort: the arms after the scene sequence exist and are true
python3 -c "
import json
for r in map(json.loads, open('raw-state/assertions.ndjson')):
    if r['name'] in ('tui.boot','tui.noFatalSignatures','tui.sessionPreset','tui.laneExit'): print(r['name'], r['ok'])"
# expect: tui.boot True / tui.noFatalSignatures True / tui.sessionPreset True / tui.laneExit False

# 3. the frozen bytes never moved (run these two from the REPO ROOT)
sha256sum docker/tui-lane.sh         # expect 226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00
find vendor/mcp-src -type f | wc -l  # expect 459

# 4. the counterfactual (the control that shows the ONE line is the operative cause)
grep -c 'tui.laneExit' evidence/docker/tui-lane-repair/red-path/arms/a-red/state.jsonl        # expect 1
grep -c 'tui.laneExit' evidence/docker/tui-lane-repair/red-path/arms/a-red-nofix/state.jsonl  # expect 2
grep -c 'abort=exit-1 net=EXIT-trap' evidence/docker/tui-lane-repair/red-path/arms/a-red-nofix/state.jsonl  # expect 1
grep -c 'abort=exit-1 net=EXIT-trap' evidence/docker/client-install/2026-10-08T08-52-23Z/console.log        # expect 1
```

Any repair or re-run of this question must leave those eight values unchanged, and must NOT be "verified" by
re-running the green lane or by a grep for `abort=exit-` on a green run — F1 exists precisely because that
reading is true of the broken lane too.

## 9. Must NOT have (guards against over-engineering the reply to this verdict)

- **No second red run.** The 25-minute lane does not need to be re-run to close an evidence-sufficiency
  finding that the existing artifacts settle; a re-run would spend a wave's time to re-produce bytes already on disk.
- **No `driver.json` retro-fitted** for `red-run/`. Fabricating the wrapper's fields after the fact would
  convert a disclosed bound into a false claim — worse than the bound.
- **No new instrumentation in `docker/tui-lane.sh`** (e.g. a marker line on the suppressed branch) to make the
  suppression directly observable. The artifact plus the `a-red-nofix` control already pin it; requirement 4's
  deliverable is an artifact, and the lane is not in scope for this verdict.
- **No edits to the fixture arms or the seed** to "restore" the baseline's `tasksFromRecord=3` shape. That
  shape difference is bounded (§6 B1), not a defect, and chasing it would re-open a frozen artifact.
- **No re-open of F1 for a "natural" red.** The freeze makes the natural terminal red unreachable without
  reverting the code under test; demanding it would be a requirement no artifact could satisfy.
- **No scope creep into requirement 3's red behaviour.** Condition (ii) is already PASS on the independent
  green run; this verdict does not restate or re-verify it.

**The one thing I would change first:** nothing in the artifact — it stands. The first thing to fix is the
record-wording trap that makes a correct product read as wrong: give `tui.teamSceneOpened`
(`docker/tui-lane.sh:795-796`) a failing-branch reason, so a FAIL row never carries a success sentence. That
is a follow-up task, not a condition of this PASS.
