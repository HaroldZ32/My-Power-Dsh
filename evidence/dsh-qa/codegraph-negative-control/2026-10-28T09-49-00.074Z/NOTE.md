# Negative control — `codegraph-smoke` with the sink name mutated

This run is DELIBERATELY RED. It is the falsifiability arm of `.mpd/plans/fix-codegraph.md` AC-4 (D-2).

The case was copied to `skills/dsh-qa/scripts/.codegraph-smoke-neg.ts` (deleted after the run) and ONE
constant was changed; nothing else differs from the green run in
`evidence/dsh-qa/codegraph/2026-10-28T09-47-57.438Z/` — same sandbox recipe, same staged bundle, same
fixture, same prompt, same assertion:

    const SINK_NAME = "mpd-codegraph-absent"   // was "mpd-codegraph"

Observed:

    [codegraph-smoke] ok=false (tool recorded, result 502 chars)
    exit 1

`result.json`: `initOk: false`, `initSink: { path: /tmp/mpd-dsh-qa-fJtzhW/ws/.mpd/logs/mpd-codegraph-absent.log, chars: 0 }`,
`tool.succeeded: true`, `resultChars: 502`, `resultHasNorm: true`.

The ONLY failing conjunct of the verdict is the marker, so a missing marker still fails the case; the
green run's pass cannot come from anything but the sink read.
