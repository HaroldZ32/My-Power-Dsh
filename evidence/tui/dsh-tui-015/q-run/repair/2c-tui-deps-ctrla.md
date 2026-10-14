# STEP 2c — `tui-deps-ctrla` store arm: the expectation is CORRECT, the store is what is missing

Lane: `tui-deps-ctrla` (`skills/dsh-qa/scripts/tui-deps-ctrla.ts`, `PANEL_STORE_ARM` +
`evaluateStoreArms`).

## 1. The semantic did NOT move — re-derived from the harness's own records

```
$ bun -e '<readCommandRecords over .mpd/recon/qa/tui-lanes/tui-015>'
RUN  {"sessionId":"95c42456-…","commandId":"cmd-a04404e6-2","name":"mpd","args":" panel"}
DONE {"sessionId":"95c42456-…","commandId":"cmd-a04404e6-2","kind":"success",
      "text":"mpd 侧栏面板：宿主已接受 act1:team；若没有出现面板，请在 /settings → 侧栏里把 act1:team 加入面板列表，并按 Ctrl+B 展开（或开启"启动时展开侧栏"）"}
```
The pair `command/run {name:"mpd", args:" panel"}` + `command/done {kind:"success"}` carrying the
panel-opened sentence IS what the harness records — the lane's expectation (`name: "mpd"`, `args:/panel/`,
`doneKind: "success"`, `text: [PANEL_OPENED_TEXT, PANEL_OPENED_ID]`) is exactly right. Three sandbox
sessions created by OTHER lanes carry it (`95c42456…`, `b27acb78…`, `39cafc76…`, each a command-only store
of ~876 bytes with the three `/mpd …` pairs).

## 2. What IS missing: this lane's own boot leaves no session store at all

Four `tui-deps-ctrla` runs, same sandbox, same env, same command:

| run | host `.dsh-tui/history.jsonl` shows the submitted line | new `sessions/<key>/<id>/` |
|---|---|---|
| T8 (09:15Z) | yes (`/mpd panel` @09:15:57) | none |
| 09:49Z | yes (`/mpd panel` @09:49:55) | none |
| 09:57Z (driver) | yes (`/mpd panel` @09:57:10) | none |
| 10:13Z | yes (`/mpd workmates` @10:13:54 + `/mpd panel` @10:14:04) | none |

Corroborating host state for that boot: `home/.dsh-tui/last-run.json` carries `"sessionId": ""`.
`readCommandRecords` therefore has nothing to judge, and the lane's Δ-session filter correctly refuses to
let an earlier run's record stand in.

## 3. The three drive variants that were tried — and FALSIFIED

1. a `/mpd workmates` **materializer step** ahead of the panel command → `repair/2c-before.log`,
   `repair/2c-materializer-first.log`: `store arm: ok=false`, no store.
2. the materializer moved **ahead of the `settle` Escape** (this lane's first driven key is `Escape`,
   unlike the two lanes whose commands DO land) → same: no store, `store arm: ok=false`.
3. a **560-column pane** (the geometry `tui-panels` uses) → `repair/2c-wide-pane.log`: `store arm:
   ok=false`.

All three are recorded and all three failed, so **the drive was left exactly as it was** — a change no
measurement supports is not a repair. The lane's own diff for this step is zero; only the comment block
that carries this trail was added.

## 4. Verdict

**DECLARED BOUND, not a lane staleness and not a NEW red.** The arm is red for the same reason it was red
in T8 (the lane's boot produces no store to read), the expectation it asserts is confirmed correct by
direct measurement, and the cause is narrowed to: *a `dsh-tui` boot in this sandbox that never materializes
its session store, while other lanes' boots in the same sandbox do.* The next step is a
packages/host-side question (why this boot's session is created with `sessionId: ""` and never flushed),
which is outside this task's write scope.
