# TARGETED RE-RUN — one-click live arm (`--mode oneclick --require-docker --live`)

**Outcome: NOT RUN. Exit code 3 at the driver's pre-build credential guard. One invocation, no retry.**

- UTC: 2026-11-22T10:23:48Z (dir name) / run started 10:23:48Z, ended 10:23:56Z
- Anchor: `head=3abf3e0a` · `diffSha=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty) · `trackedChangedCount=0` · branch `feature/dsh-022rc5-tui-0202`
- The task statement named HEAD `2cfa9430`; actual HEAD is `3abf3e0a`, whose ONLY delta is
  `evidence/release/v0.21.0/docker-2026-11-22T09-23-53Z/**` (`git diff --name-only 2cfa9430 3abf3e0a`).
  `package.json`'s `files` excludes `evidence/`, so the pack is source-identical between the two commits.
- Pack re-cut first: `node scripts/pack-mpd.ts` → exit 0, `dist/mpd-package`, version 0.21.0, 687 files.

## What the single invocation did

```
[driver] --live was passed but DEEPSEEK_API_KEY is not set in this environment; refusing to run a lane
that would report the credential-free NULL. Export the key, or drop --live.
```

Guard: `scripts/docker-e2e.ts` → `liveRequested && !keyPresent` → `process.exitCode = 3; return`.

- **No SKIP printed.** No container, no build, no TUI capture.
- **Docker mode: not probed** (the refusal precedes the docker probe). The host itself is rootless:
  `[name=seccomp,profile=builtin name=rootless name=cgroupns]`.
- **No `result.json` from this run**, so no pass/fail/null counts and no stamps were produced.
- The credential exists on this host at `$HOME/.dsh/.credentials.yaml` (`refs.DEEPSEEK_API_KEY`), which the
  previous lane's own record names as its source; this verifier's process environment does not carry it and
  the delegated scope cannot widen. The value was never read or printed.
- **The command was not invoked a second time** (mandate).

## Answers to the requested facts

| Fact | This run | Prior run (committed baseline, HEAD 2cfa9430) |
|---|---|---|
| Exit code | **3** (refusal, not a verdict) | 1 |
| ROOTLESS/rootful | not probed; host rootless | ROOTLESS |
| SKIP printed | no — refusal line only | no |
| `tui.teamFixtureBound` | **NOT MEASURED** | `null` |
| its raw | — | `session=none materialized=false attempts=4 source=none projectKey=--work-ws-- no-bind-attempted resolve=store=/root/sandbox-dsh/sessions;before=3;after=3;created=` |
| `tui.mergedPanelOpens` | NOT MEASURED | false |
| `tui.mergedPanelOrder` | NOT MEASURED | false |
| `tui.teamSceneOpened` | NOT MEASURED | false |
| `tui.teamGraphDrawn` | NOT MEASURED | false |
| `tui.teamGraphContent` | NOT MEASURED | false |
| `tui.laneExit` | NOT MEASURED | false |
| `harnessVersion` | NOT MEASURED | `0.2.2-rc.5` (expected `0.2.2-rc.5`) |
| `tuiVersion` | NOT MEASURED | `0.20.2` |
| `install.*` | NOT MEASURED | all true (`install.exit` spec `git+file:///opt/oneclick.git`, exit 0) |
| `boot.presetMount` / `agentPreset=mpd` | NOT MEASURED | true; raw carries `"agentPreset":"mpd"` for `session-6b92dc0c-…` |
| `userSurface.*` | NOT MEASURED | held: 120 rows, 85 true, 0 false, 35 null declared bounds, `rowNullUnexcused: []` |
| Pass/fail/null | none produced | 244 total / 196 pass / 6 fail / 42 null |

Source arms (unchanged, not re-run): `run-1` bound at `attempts=2`, `before=3;after=4`, session
`4986cc67…`; `run-3` bound at `attempts=2`, `before=1;after=2`, session `7df5c697…`. Both exit 0.

## The narrow question

**Unanswered by this execution.** It produced no sample, so neither "timing race" nor "deterministic
one-click-layout defect" is supported by this run. The prior run's single unbound sample (`attempts=4`)
is consistent with both readings, and the lane's own history shows the materialiser is timing-sensitive
by construction: `docker/tui-lane.sh` sends `/mpd board` up to 4 times, each attempt polling the session
store for up to 36 s (12 × 3 s), because the first command is commonly swallowed before the session is
attached — and in both source arms the bind landed on **attempt 2**, i.e. attempt 1 genuinely failed.
One all-four-attempts failure therefore cannot separate "slower than the window" from "never appends".

## Findings about the evidence chain (not repaired here)

1. **High — the one diagnostic that would settle the question is captured and discarded.**
   `docker/tui-lane.sh` calls `capture_pane boardOpened` after the materialiser, writing
   `pane-boardOpened.txt`, but nothing reads it: no assertion, no `raw`, and the committed one-click
   record carries only counters. The distinguishing fact — whether `/mpd board` rendered an
   unknown-command/swallowed line or a transcript line with no append — is lost with the container.
   Direction: surface that pane's first transcript line (and the per-attempt store delta) into
   `tui.teamFixtureBound`'s `raw`; keep the pass condition unchanged.
2. **Medium — a false green sits inside the same arm.** `tui.teamGraphEdges` reported **true**
   (`junctions=46`) in the run whose graph was definitively not drawn (`tui.teamGraphDrawn=false`, all four
   corners 0). Its predicate is `grep -qE '┬|┴|│'` over the whole pane, so any bordered frame — including
   the empty state — satisfies it. Direction: require the junctions to be attributable to the graph
   region, or gate the row on `tui.teamGraphDrawn`.
3. **Medium — "cannot measure" is reported in the same class as "product wrong".** `tui.teamFixtureBound`
   is `null`, yet its six dependents are `false` and `tui.laneExit` is `false`, so the headline says
   "6 failed" (exit 1) for a precondition the record itself calls an unmade measurement. The six reds are
   defensible as anti-silent-pass; the headline is not. Direction: keep the rows red if wanted, but let the
   report/exit path name the class ("unbound fixture") distinctly — e.g. exit 3 (cannot-run) when the only
   failures descend from a NULL fixture row.
4. **Nit — two reason strings misdescribe their own raw.** `tui.mergedPanelOpens` says the panel "did NOT
   open" while its raw shows `TITLE_HITS=1 SUB_HITS=2` (it opened; only the team family was absent), and
   `EMPTY_LINE=8` in that raw counts the **subagent** empty state
   (`docker/lib/tui-panel-body.ts` :: `SUB_EMPTY`, `No subagents in the current session`) — not the team
   empty state. The correct citation for the product's team empty state in the prior run is
   `tui.teamSceneOtherSessionInvisible=true`, `marker=[no team in this session]`,
   `markerSite=packages/mpd-tui-plugin/src/team-state.ts#NO_SESSION_TEAM_MARKER`. Verbatim
   `no team in this session` appears **zero** times in the committed one-click `console.out`.
5. **Nit — `tui.sessionPreset` is a proxy.** It read `e078be04-…` as `scope=newest-record-proxy`, i.e. the
   newest record, not the session the TUI was bound to. Disclosed in the raw; must not be quoted as proof
   that the TUI's session was known at fixture time.

## Bounds

Not read: `docker/entrypoint.sh` in full and the one-click install path; the product's drawing internals
(`packages/mpd-tui-plugin/**` beyond the marker constants). Not run: the one-click arm (no credential), any
source arm (excluded), and no second attempt of anything. Container-internal panes from the prior run are
not in the committed evidence and the container is gone, so the empty-state rendering was never inspected
visually — only its marker row was.
