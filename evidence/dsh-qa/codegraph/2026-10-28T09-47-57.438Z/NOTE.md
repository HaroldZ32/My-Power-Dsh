# D-2 — `codegraph-smoke` reads the apply-time marker from the row's log sink

Subject: `skills/dsh-qa/scripts/codegraph-smoke.ts` (symbols `SINK_NAME`, `INIT_MARKER`, `INIT_LINE`,
`sinkPath` in `runReal`). Contract: `.mpd/plans/fix-codegraph.md` AC-4.

## Defect, measured before this change

`evidence/dsh-qa/codegraph/2026-10-14T08-40-39.630Z/result.json` recorded `initOk: false` together with
`tool.succeeded: true`, `resultChars: 502`, `resultHasNorm: true` → `ok: false`. The predicate grepped
the BOOT STDOUT for `init status=`, but R5 (lane F) had moved that line into the shared sink
`<workspace>/.mpd/logs/mpd-codegraph.log`. Re-measured on this run's own boot log:

    $ grep -c 'init status=' evidence/dsh-qa/codegraph/2026-10-28T09-47-57.438Z/output.log
    0

so the old predicate could never match again.

## What changed

The marker is read from the row's sink, `<workspace>/.mpd/logs/mpd-codegraph.log` (root = the session's
workspace plane, which this boot sets to its spawn cwd), and the sink content is filed with the verdict
as `codegraph-sink.log`. An absent sink yields `""`, `INIT_LINE.test("")` is false, `ok` is false and
the case exits 1 — falsifiability kept.

## Measurements (2026-10-28)

    [codegraph-smoke] ok=true (tool recorded, result 502 chars)
    [codegraph-smoke] PASS
    exit 0

`result.json`: `ok: true`, `exit: 0`, `initOk: true`, `initSink.chars: 205`, `tool.succeeded: true`,
`resultChars: 502`, `resultHasNorm: true`. `codegraph-sink.log` holds exactly one line:

    [2026-10-28T09:47:48.237Z] [mpd-codegraph] init status=ok binary=<repo>/.toolchain/node_modules/.bin/codegraph cwd=<repo>/.cg-qa

## Falsifiability — negative control on real bytes

`evidence/dsh-qa/codegraph-negative-control/2026-10-28T09-49-00.074Z/`: the same case with only
`SINK_NAME = "mpd-codegraph-absent"` exited **1** with `initOk: false`, `initSink.chars: 0`, while the
same tool call still succeeded (`tool.succeeded: true`, `resultChars: 502`, `resultHasNorm: true`).

## Offline self-test

    $ bun skills/dsh-qa/scripts/codegraph-smoke.ts --self-test
    [codegraph-smoke self-test] ok: project-path precondition + composed codegraph server name
    (mcp__codegraph__codegraph_explore) + sink marker contract verified on fixtures
    exit 0

Besides the pre-existing fixture/name arms it now pins the row's half of the contract (the
`openLogSink("mpd-codegraph"` call and the `[mpd-codegraph] init status=` literal in
`packages/mpd-codegraph-plugin/src/index.ts`) and asserts the predicate REJECTS an absent sink, an
empty string, and a real non-initialized status (`no-binary`).

## Gates run for this change

- `bun run verify:comments` → `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` (479 files, 43558 declarations).
- `bun run typecheck` (`tsgo --noEmit`) → exit 0.
