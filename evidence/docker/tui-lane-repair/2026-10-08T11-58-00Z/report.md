# T3 — Docker TUI lane repair: result (writer's report)

**Run:** `node scripts/docker-e2e.ts --mode source --require-docker`, rootless Docker 29.8.2.
**Driver summary, verbatim:**

```
[report] ok=true complete=false passed=66 failed=0 null=30 scrubbed=true -> /out/result.json
```

**Driver exit code:** 0 · started `2026-10-08T11:56:41.803Z`, finished `2026-10-08T12:03:01.815Z`.
**Run evidence (the driver's own):** `evidence/docker/client-install/2026-10-08T11-56-41Z/`.

**Frozen revision.** HEAD `20f312636b1f6fcdb43441d785494d98c3b8df08`; `docker/tui-lane.sh`
sha256 `226cdb1c84b9eff09a3260aa9aec33abe40bacb87358c833dcb5db9557094b00` (read `2026-10-08T11:55Z` and
re-read unchanged after the run). The SAME hash was measured INSIDE the running container
(`/opt/mpd-e2e/tui-lane.sh` and the tree-under-test copy `/opt/mpd/docker/tui-lane.sh`) — so the
verdict is a verdict on the frozen bytes, not on a rebuild of something else. Transcript of that
measurement: `lane-identity-in-container.txt` in this directory.

---

## 1. Requirement 3 — the empty-state / other-session-invisible arm: **GREEN, and non-vacuous**

Row `tui.teamSceneOtherSessionInvisible = true`, raw (verbatim from `result.json`):

```
otherSession=session-8f9c858f-5c29-4261-a2f7-8e3d443fd059 liveSession=4d62504c-9919-4045-8f78-d4fb4468f739 otherKey=session-8f9c858f-5c29-4261-a2f7-8e3d443fd059 index={"session-8f9c858f-5c29-4261-a2f7-8e3d443fd059":"tui-scene"} marker=[no team in this session] markerSite=packages/mpd-tui-plugin/src/team-state.ts#NO_SESSION_TEAM_MARKER assertedAbsent=[T1,T2,T3] foundDrawn=[none] corners=0 pane=pane-teamOtherSession.txt
```

The captured pane this arm judged — `tui-panes/pane-teamOtherSession.txt:4`:

```
  │ no team in this session — stage one with agent_teams_plan, then approve it                    │
```

- **PRESENT** is a SUBSTRING test against the product's OWN constant: `no team in this session` is
  read out of its exported declaration (`team-state.ts:57`, cited in the raw as `markerSite`) at run
  time and never retyped. The pane line proves why equality would have been wrong: it carries a
  suffix (`— stage one with agent_teams_plan, then approve it`).
- **ABSENT** was measured on that same pane: `foundDrawn=[none]` — none of `assertedAbsent=[T1,T2,T3]`
  appears as a node label (`[^ ] <id> +│`, the content arm's own predicate), and the rounded-corner
  census on the pane is `corners=0`.
- **NON-VACUOUS.** The instrument was non-empty and the foreign board really was bound to somebody
  else: `otherSession=session-8f9c858f…` ≠ `liveSession=4d62504c…`, `otherKey` is that sibling's key,
  and the index at that instant carried **only** the sibling's binding
  (`index={"session-8f9c858f…":"tui-scene"}`) — which is exactly the state under test: this session
  owned nothing while a sibling owned the seeded board. The ids asserted absent are recorded on the
  row, so a later reader can tell what the absence assertion covered.
- A run whose `OTHER_SESSION_IDS` is empty, or whose foreign board could not be bound / whose marker
  could not be read, records this row as **`null` with the reason** (two such branches exist in the
  lane); it can never record a pass in that state.

## 2. Requirement 4 — the false abort is **GONE**

- The failing run double-reported: `console.log:3193` the normal terminal record, `:3194` the bogus
  abort, `:3210` the driver's FAIL row carrying `abort=exit-1 net=EXIT-trap`. In THIS run:
  `grep -c 'without the ERR trap seeing it' console.log` → **0**; `grep -c 'abort=exit-' console.log` →
  **0**; and exactly **one** row named `tui.laneExit` exists in `result.json`.
- The green ending: `[record] tui.laneExit=true — the TUI lane ran to completion with every assertion
  green`, raw `records=21`.
- **The mechanism chosen, and why.** `LANE_EXIT_RECORDED=1` is now set by the terminal red path
  (`docker/tui-lane.sh`, immediately before its `exit 1`) — NOT a new flag. That variable is already
  the ONE predicate both nets read ("this exit already carries a `tui.laneExit` record"): `on_err` sets
  it because it writes that record, and the terminal red path writes that record too, but never set
  the flag, so `on_exit` read an ordinary red ending as the abort it was written to catch. The
  ERR/EXIT protection is untouched: an exit NOBODY recorded — the ERR trap, or the `set -u` abort the
  header at `:97-101` documents — still publishes the abort row. The trap comment now states both
  defects (the 2026-10-06 false PASS and the 2026-10-08 false ABORT) so a future reader cannot
  re-introduce either.

## 3. Requirements 1–2 (inherited, uncommitted) — now proven on a real run

| row | value | raw |
|---|---|---|
| `tui.teamFixtureBound` | true | `session=4d62504c… source=created-during-this-boot-under-this-project-key … active={"session-8f9c858f…":"tui-scene","4d62504c…":"tui-scene"};recordLeadSessionId=4d62504c…` |
| `tui.teamSceneOpened` | true | `chars=11741` |
| `tui.teamGraphDrawn` | true | `corners=╭3 ╮3 ╰3 ╯3 tasksFromRecord=3 ids=T1,T2,T3` |
| `tui.teamGraphEdges` | true | — |
| `tui.teamGraphContent` | true | `ids=T1,T2,T3 fromRecord=3 labelsExpected=3 missing=[none] pinnedFocus=T1 detail=[T1 · requirement · freeze the contract]` |

Both spellings the product's own `createTeam` writes are on disk, and the sibling's entry survives.

## 4. Requirement 5 — the summary line, with the null classes separated

`passed=66 failed=0 null=30`. The 30 nulls are **not** one class:

- **credential-gated — 28**: the 27 `live.*` rows **plus `boot.llmTurn`**, which is gated the same way
  and carries no `live.` prefix (a check keyed on that prefix finds 27 and would report a phantom
  discrepancy). Credential-free runs leave them null, which is correct; they are not "fixed" and not
  claimed as passes.
- **host observability — 2**: `tui.mergedPanelOpens`, `tui.mergedPanelOrder`, null for their own
  reason, unrelated to credentials.

The count moved exactly as expected against the failing run: `60 → 66 passed` is the four previously
red `tui.*` rows plus the two new rows, and `null=30` is UNCHANGED — no assertion was traded away.
(`complete=false` is also unchanged from the failing run and describes canonical rows never reached.)

## 5. Files changed in this task

| file | change |
|---|---|
| `docker/tui-lane.sh` | the new arm (requirement 3), the terminal-exit fix (requirement 4), the task-table read hoisted above the first scene open, the `tui.*` header contract list, the record floor `19 → 21` |
| `docker/README.md` + `docker/README.zh-CN.md` | the documented assertion count corrected to the measured **twenty-two** `tui.*` assertions and the two new arms added (the pair updates together) |

The README edit does NOT change `docker/tui-lane.sh`'s sha256 — the verified artifact is untouched by
it.

## 6. Bounds (stated, not smoothed over)

1. **No independent verdict here.** This is the writer's report; T4 owns the verdict, on this frozen
   hash, from the frozen contract.
2. The lane was run ONCE at this revision; the empty-state pane is a single capture of a single run.
3. The `live.*` rows remain unexercised — no credential is staged in this container by design
   (§10 Security & Privacy), so their null reading is the credential-free maximum, not a pass.
4. The README count is a static count of the lane's `tui.*` writers (22 names), cross-checked against
   the run's own `records=21` + the terminal row; it is not itself an executed gate.
