# Lane L2 (Interaction) — AC4 + AC6 evidence

Subject: `packages/mpd-tui-plugin/src/panel-dag.ts` + `packages/mpd-tui-plugin/test/panel-dag.test.ts`
Wave: `tui-dag-highlight` (contract `.mpd/plans/tui-dag-highlight.md`).

## Files in this directory

| File | What it holds |
|---|---|
| `gates.log` | the three gates this lane must run, verbatim |
| `probe-click.log` | the captain's own probe, **unchanged**, on the board named in its first line |
| `discriminate-click.ts` | this lane's discriminating instrument for AC4 (see the bound below) |
| `discriminate-click.log` | its output |
| `acceptance.log` | the captain's acceptance instrument, 8/8 |

Board used for every run in this directory:
`.mpd/recon/tui-013-fv/ws/.mpd/team/teams/mpd-probe-team.json` (7 tasks; `T2` and `T3` are both blocked
by `T1`, so they share one row band and differ only in column). The board the captain's probe was written
against (`.mpd/recon/qa/tui-lanes/dag-verify/ws/.mpd/team/teams/team-dag-verify.json`) no longer exists —
its sandbox was cleaned at 20:16 — so the same two-box-rank shape was taken from this surviving fixture.

## The bound on the captain's probe (measured, not assumed)

`probe-click.ts` clicks the row that DRAWS `T3` with the stub coordinate `{ localRow: 0, localCol: 0 }`.
On this board that row carries BOTH boxes, and column 0 is INSIDE THE LEFT ONE (`T2` cols 0-9, `T3` cols
13-22, both on rows 6-8). So the probe's click **is** geometrically a click on `T2` — before and after the
fix — and the probe's two lines are identical either way. It reproduces the defect's SYMPTOM ("clicking
the row that draws T3 pins T2") but cannot witness the fix, because its coordinate is not discriminating.

`discriminate-click.ts` closes exactly that gap: same row, same handler, a column INSIDE the second box.

```
$ bun evidence/tui/dag-highlight/20261007T1230Z/discriminate-click.ts <board> 80 40
7 box(es): T1[rows 0-2 cols 0-9] T2[rows 6-8 cols 0-9] T3[rows 6-8 cols 13-22] T4[rows 12-14 cols 0-9] ...
shared row band: T2 cols 0-9 and T3 cols 13-22, both on rows 6-8
hitTest(row 6, col 0)  -> T2   (the captain's stub coordinate, INSIDE the left box)
hitTest(row 6, col 14) -> T3   (a column inside the SECOND box)
AFTER clicking the row that draws T3 at localCol 14: pinned marker present for T3 = true, for T2 = false
```

## What the gates say (`gates.log`)

- `bun test packages/mpd-tui-plugin` — **410 pass / 0 fail** (the lane's own file: 49 pass / 0 fail).
- `bun run typecheck` — exit 0.
- `bun run verify:comments` — **VERDICT: PASS**.
- `bun .mpd/recon/termaid-revert/acceptance.ts <board> 80 40` — **8/8 criteria PASS**, including
  `AC4 clicked the SECOND box of the rank at localCol=14; pinned T3=true, pinned the leftmost T2=false`
  and `AC6 pinned=true openAgentPage called with ["agent-verify"]`.
