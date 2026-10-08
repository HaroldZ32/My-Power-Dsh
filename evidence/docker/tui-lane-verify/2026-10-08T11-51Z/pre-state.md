# T4 pre-state — the Docker TUI lane verifier's frozen basis (written BEFORE any implementation read)

**Seat:** Deep Worker, session `5ffe06cc-bb99-41af-9bfc-f71d097dd7ac` (team member M2).
**Loop:** `loop-20261008T114859-975ba4` (opened by the team approval for this session; no `contract`
field, so its resolved contract is the declared default `AGENTS.md` — DECLARED BOUND, below).
**Board task:** T4, blocked by T3.
**Instant this file was written:** 2026-10-08T11:52Z (UTC).
**Blindness statement:** `docker/tui-lane.sh` had NOT been read (nor its diff) when this file was
written, and will not be read before `mpd_verify_record` runs.

## Frozen contract (the documents the verdict works from)

| Doc | What it fixes |
|---|---|
| `.mpd/plans/repair-r-docker-tui-fixture.md` | the two findings F1/F2 and the five required behaviours + hard rules |
| `.mpd/plans/lane-td-session-scope-and-push.md` | the INTENTIONAL session-scoped team view (the product behaviour stays; the lane catches up) |
| `.mpd/verify/records/rec-20261008T083541-7e3a91.json` | the PASS record that closed that earlier lane |
| `AGENTS.md` §4 | the Docker real-machine row and its "a SKIP is not a pass" rule |
| `docker/README.md` | the lane's own published contract (step 15 of the container) |

## The failure this lane repairs (baseline, quoted from the captain's sweep)

Driver summary read from `evidence/docker/client-install/2026-10-08T08-52-23Z/driver.json`:

```
"verdict": "ok=false complete=false passed=60 failed=4 null=30 FAILED=[tui.teamSceneOpened,tui.teamGraphDrawn,tui.teamGraphContent,tui.laneExit]"
```

The four failing rows, verbatim from that run's `result.json` `assertions[]`:

- `tui.teamSceneOpened` — `chars=11549`
- `tui.teamGraphDrawn` — `corners=╭0 ╮0 ╰0 ╯0 tasksFromRecord=3 ids=T1,T2,T3 pane=pane-team.txt`
- `tui.teamGraphContent` — `ids=T1,T2,T3 fromRecord=3 labelsExpected=3 missing=[T1,T2,T3] pane=pane-team.txt chars=11549 pinnedFocus=none detail=[none] pinnedPane=pane-teamPinned.txt`
- `tui.laneExit` — `abort=exit-1 net=EXIT-trap`

## The four acceptance conditions I will judge (from the contract ALONE)

1. The four rows above are NOT in `failedNames` of MY OWN run.
2. The requirement-3 arm exists BY NAME and asserts BOTH directions on a captured pane: the
   empty-state marker is present in a session with no bound board, AND none of the other board's
   task ids appear in that pane.
3. `tui.laneExit` no longer reports a FALSE abort for an ordinary red exit (the double-report
   defect named at `docker/tui-lane.sh:1109-1110` in the reply to the plan).
4. Every non-credential-gated assertion passes; the 28 `live.*` nulls are attributed to the
   credential-free run and the `tui.mergedPanel*` nulls are reported as their OWN class, never
   counted as passes.

## The evidence I will produce (black box, before any implementation read)

- a SECOND, independent `node scripts/docker-e2e.ts --mode source --require-docker` run of my own,
  as a managed background job with its log redirected to a file;
- `mpd_verify_evidence` gate rows from the fixed table;
- a content-free probe of the driver's artifacts (bytes + sha256 + mtime).

## Pre-state hashes (measured 2026-10-08T11:50:42Z, before the writer's T3 work settled)

| Path | sha256 |
|---|---|
| `docker/tui-lane.sh` | `57b1fc291ae054a86f8aaf804840b5bdd9be1f7e539eb44fb1f98f8979347fc6` |
| `docker/README.md` | `c6d6f06ad1412b6bf56c14247da2fee5b698c0229fc67043e1be243a76ef6f8e` |

## DECLARED BOUNDS (what this seat cannot settle)

1. **The loop's `contract` field is absent**, so `basis.frozenContract` hashes `AGENTS.md`, not the
   repair plan. The repair plan is cited in the record's `sources[]` instead; this is stated, not
   hidden.
2. **Credential-gated arms.** No credentials are staged (AGENTS.md §10), so the 28 `live.*` rows stay
   null; a null is NOT a pass and is never claimed as one.
3. **The two `tui.mergedPanel*` nulls** are not pane-observable on this host (the 0.13.0 panel seam
   is present); they are reported as their own class.
4. **Host load.** My run and the writer's run are sequenced, never concurrent, so an image-tag race on
   `mpd-docker-e2e:local` cannot corrupt either result.
