# The RED container run of the Docker TUI lane — one run, both halves of the repair

F1 of `evidence/docker/tui-lane-verify/2026-10-08T12-06Z/verdict.md` said the wave had never observed
a RED run of the repaired lane. This directory holds one: a real `docker compose run` of the frozen
lane, ending on its **terminal** red path, whose own artifacts show the honest terminal record and
**zero** abort records.

## 0. The run's identity

| | |
|---|---|
| run stamp | 2026-10-08T12:24:15Z → 12:29:38Z (container), build 12:24:12Z → 12:24:15Z |
| command | `docker compose -f docker/docker-compose.yml run --rm -T -e MPD_E2E_BROWSER=1 -v <EVID>/scratch:/work mpd-client` (verbatim in `run-command.txt` / `run-red.sh`) |
| image | `mpd-docker-e2e:local` = `sha256:1a5bb7b19c6d293a1880dabf8f9973df5dc12446393de35cc4c2c82f72f386ea`, built by this run (`build exit=0`) |
| mounts | `${MPD_DOCKER_OUT}:/out` (the service's own) **and** `<EVID>/scratch:/work` (the one addition) |
| `docker/tui-lane.sh` sha256 | `226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00` BEFORE (`lane-sha256-before.txt`, read 12:24Z), INSIDE the built image (`lane-sha256-in-container.txt`, `/opt/mpd-e2e/tui-lane.sh`, read 12:25Z), and AFTER (`lane-sha256-after.txt`, read 12:31Z) — **one value, three measurements** |
| container exit | `[red-run] container exit=1` (the lane's own `exit 1`) |
| whole-run verdict | `[report] ok=false complete=false passed=60 failed=5 null=31 scrubbed=true -> /out/result.json` |

`console.log` is the compose run's whole stdout+stderr (the same stream the shipped driver tees into
its `console.log`); `result.json` and `output.log` are the CONTAINER's own reporter output, written
through the service's `/out` bind; `tui-panes/` are the pane captures the LANE wrote as evidence;
`raw-state/assertions.ndjson` is the lane's raw record stream.

## 1. Acceptance — the terminal red record, verbatim

`console.log:3197` — the LAST `tui.*` record the lane writes, produced by its summarise step:

```
[record] tui.laneExit=false — the TUI lane finished with failing or missing assertions
```

and the reporter's row for it, `console.log:3215`:

```
[report] FAIL tui.laneExit — the TUI lane finished with failing or missing assertions | raw: records=21 failed=4
```

The same record inside `result.json` — exactly ONE entry of that name, read from the file:

```json
{"name": "tui.laneExit", "ok": false, "reason": "the TUI lane finished with failing or missing assertions", "raw": "records=21 failed=4"}
```

That is the **terminal** record: it is written by the branch at the very end of the lane
(`TUI_SUMMARY` counted, the floor of 21 records met, the false arms non-zero), immediately followed
by `LANE_EXIT_RECORDED=1` and `exit 1`. The raw state file carries it exactly **once**
(`grep -c '"name":"tui.laneExit"' raw-state/assertions.ndjson` → `1`).

The next records in the same file are the ENTRYPOINT's next step (`live.headless.*`), i.e. the lane's
process was gone and the run continued — the EXIT net published nothing in between
(`console.log:3198` onwards).

## 2. Acceptance — ZERO abort records, counted

`counts.txt` (every line is a real command with its real output):

```
$ grep -c 'abort=exit-' console.log
0
$ grep -c 'net=EXIT-trap' console.log
0
$ grep -c 'the TUI lane aborted' console.log
0
$ grep -c 'tui.laneExit=false' console.log
1
$ grep -c 'abort=exit-' result.json
0
$ grep -c 'net=EXIT-trap' result.json
0
$ grep -c 'abort=' result.json
0
```

The SAME red conditions on the pre-repair lane produced **two** records — `tui.laneExit=false` (the
terminal one) AND `tui.laneExit=false … abort=exit-1 net=EXIT-trap`
(`evidence/docker/client-install/2026-10-08T08-52-23Z/console.log:3192-3193`, raw at `:3210`). This
run produces only the honest one. Requirement 4 is demonstrated on a real run's own artifacts.

## 3. Acceptance — which arms went false, and why this is the terminal class

`result.json` `failedNames`, five rows, quoted from `console.log:3211-3215`:

```
tui.teamFixtureBound | the fixture was NOT bound to cbb433f5-aef5-4570-8604-26075b65835d: the read-back does not carry BOTH spellings on disk (expected teams.json active[<sessionKey>] = "tui-scene" AND the record's leadSessionId = <sessionKey>) — the scene will draw its empty state whatever the drawing code does | raw: session=cbb433f5-aef5-4570-8604-26075b65835d source=created-during-this-boot-under-this-project-key projectKey=--work-ws-- index=/work/ws/.mpd/team/teams.json;active={};recordLeadSessionId=(absent);keySource=import:packages/mpd-team-core-plugin/src/team-store.ts#sessionKey resolve=store=/root/sandbox-dsh/sessions;before=2;after=3;created=--work-ws--/cbb433f5-aef5-4570-8604-26075b65835d
tui.teamSceneOpened | the /mpd team scene opened on a real terminal | raw: chars=11549
tui.teamGraphDrawn | the boxes were NOT drawn one per task: the record carries 0 task(s) and the pane's rounded corners are ╭0 ╮0 ╰0 ╯0, each of which must equal the task count | raw: corners=╭0 ╮0 ╰0 ╯0 tasksFromRecord=0 ids=none pane=pane-team.txt
tui.teamGraphContent | the pane does not carry the record's own data: ids read from the record=0 missing=[none] pinnedFocus=[none] — each record id must be DRAWN, and one 'j' keystroke must reach a task's own subject in the pinned detail body | raw: ids=none fromRecord=0 labelsExpected=0 missing=[none] pane=pane-team.txt chars=11549 pinnedFocus=none detail=[none] pinnedPane=pane-teamPinned.txt
tui.laneExit | the TUI lane finished with failing or missing assertions | raw: records=21 failed=4
```

The three scene arms reddened **by observation, not by assumption**: the product's own empty state is
what the lane captured (`tui-panes/pane-team.txt:4`):

```
  │ no team in this session — stage one with agent_teams_plan, then approve it
```

and `chars=11549` is byte-for-byte the same pane size the PRE-repair baseline recorded for
`tui.teamSceneOpened` (`evidence/docker/client-install/2026-10-08T08-52-23Z/console.log:3207`,
`raw: chars=11549`).

**Why this is the terminal class and not an abort.** The lane reached its own end: the last three
records before the exit are the arms that run AFTER the scene sequence —
`tui.boot=true` (`:3194`), `tui.noFatalSignatures=true`, `tui.sessionPreset=true` (`:3196`) — and then
the summarise step wrote the terminal record. An EARLY failure cannot look like this: the lane's
first steps are **unguarded** and would have fired the ERR trap instead —

```
172:npm i -g "@deepseek-harness-tui/dsh-tui@$TUI_VERSION" >"$TUI_DIR/install-host.log" 2>&1
182:dsh plugin --profile dsh-tui add "@deepseek-harness-tui/dsh-tui@$TUI_VERSION" >"$TUI_DIR/add-host.log" 2>&1
187:( cd "$APP_DIR" && dsh plugin --profile dsh-tui add . ) >"$TUI_DIR/add-bundle.log" 2>&1
193:dsh --profile dsh-tui --dump-config >"$TUI_DIR/dump.yml" 2>"$TUI_DIR/dump.err"
321:tmux -f /dev/null -S "$SOCK" new-session -d -s tui -x 220 -y 50 -c "$WORK_DIR/ws" 2>"$TUI_DIR/tmux.err"
372:cat >"$WORK_DIR/ws/.mpd/team/teams/tui-scene.json" <<'TEAMJSON'
395:printf '{"version":1,"active":{}}' >"$WORK_DIR/ws/.mpd/team/teams.json"
```

each of which, failing, would have produced `tui.laneExit=false — the TUI lane aborted (exit N)`, a
record that appears **zero** times here. Every one of those steps succeeded in this run
(`tui.hostInstall=true`, `tui.pluginAddHost=true`, `tui.pluginAddBundle=true`, `tui.compose=true`).
The red is the ordinary one the repair is about.

## 4. The recipe I chose, and why

The lane's environment surface is CLOSED: it reads only `TUI_VERSION`, `LIB_DIR`, `LIVE`, `OUT_DIR`,
`STATE_FILE`, `FACTS_FILE`, `APP_DIR`, `WORK_DIR`, `DSH_HOME`, `HOME`, `PATH`
(`docker/entrypoint.sh` sets every one of them explicitly on the lane's command line), and
`TUI_VERSION` is the ERR-trap class the brief rules out. So the unbound-fixture state was **seeded
at the mount**, not asked for through a knob:

    mkdir -p "<seed>/ws/.mpd/team/teams"
    ln -sfn /dev/null "<seed>/ws/.mpd/team/teams.json"
    ln -sfn /dev/null "<seed>/ws/.mpd/team/teams/tui-scene.json"

then `-v <seed>:/work`. `seed.sh` reproduces it; `seed-state.txt` and `seed-preflight.txt` record
what it does. `/dev/null` and not a read-only mount, for a measured reason: the lane's own two fixture
writes (`:372`, `:395`) are unguarded, so a read-only target makes THEM fail and produces the ABORT —
the wrong half. A `/dev/null` target accepts both writes with **exit 0** and persists nothing:

```
lanes seed writes, replayed against the seed:
  index  write exit=0
  record write exit=0
  read-back index  = UNPARSABLE(SyntaxError)
  read-back record = UNPARSABLE(SyntaxError)
  probe write exit=0 (nothing persisted)
```

The lane then discovers its own session by the product's own rule
(`keySource=import:packages/mpd-team-core-plugin/src/team-store.ts#sessionKey`,
`created=--work-ws--/cbb433f5-…`), finds the fixture bound to no session, and runs to the end.

## 5. Honest bounds

1. **The red is a FORCED environment precondition, not the natural pre-repair defect.** The natural
   state (a fixture seeded and then left bound to nobody) is written by the lane itself at `:395` and
   immediately overwritten by its own binding step; the lane exposes no switch to skip that. I did not
   edit the lane, the entrypoint, the compose file or any app source, and I forged no record — every
   row quoted here was produced by the lane from its own read-backs. But a reader should know the red
   was induced by a mount-level seed, and can discount it accordingly.
2. **The record file was unreadable in this run**, so `tasksFromRecord=0` rather than the baseline's
   `3`: the seed blinds the fixture's record as well as its index. The scene therefore drew the empty
   state for the strongest possible reason (neither of the product's two readers resolves a team).
   The baseline's specific reading — a readable 3-task record with nobody bound — was deliberately NOT
   reproduced, because one state cannot be made to differ between the lane's early task-table read and
   its later binding rewrite using only static mounts.
3. **`tui.teamSceneOtherSessionInvisible` recorded `null`, not a pass** — the same seed also blinds the
   sibling board's index write (`console.log`): `NOT MEASURED: the state under test could not be
   built — the foreign board bound as bound=false to key=… ({})`. It is an honest unmade measurement,
   and it is the one arm this exercise cost.
4. **The run is the compose service, not the shipped driver wrapper.** `scripts/docker-e2e.ts` cannot
   add a volume, so I ran the same service by hand with the same image, entrypoint and lane bytes, plus
   `-e MPD_E2E_BROWSER=1` to match the two previous runs of this lane. There is therefore no
   `driver.json` for this run; `console.log` is my runner's log of the same stream (see `run-red.sh`).
5. **The scratch tree was pruned after harvest.** The `/work` bind produced an 890 MB tree
   (`pw-browsers`). The small artifacts were copied to `raw-state/` and the tree removed, so nothing of
   this run sits in the repository except this evidence directory (1.9 MB). `find vendor/mcp-src -type f
   | wc -l` → **459** (before and after; the compose file binds only `/out`, and the extra bind was an
   evidence-local directory, so the run created nothing under `vendor/`).

## 6. Bottom line

Requirement 4's deliverable now exists as a real run's artifacts: **one** terminal
`tui.laneExit=false — the TUI lane finished with failing or missing assertions`, **zero**
`abort=exit-`, **zero** `net=EXIT-trap`, on the frozen lane bytes at the frozen hash, with the fixture
arms red and the run finishing normally. The mechanism the pre-repair baseline failed on — an ordinary
red ending being double-reported as an abort — is now falsified on a container run rather than on an
extracted harness.
