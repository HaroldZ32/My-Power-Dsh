# Defect fix: the adapter's full-harness unit mock went stale, leaving the suite red

Found by a health pass over `dev` (2026-09-14): `bun test packages` reported
**398 pass / 1 fail** — `mpd-dsh-adapter-plugin` › `capabilities` ›
`"reports every seam of a full harness"`.

## Measurement

```
$ bun test packages/mpd-dsh-adapter-plugin
(fail) capabilities > reports every seam of a full harness
  expect(received).toBe(expected)
  Expected: true
  Received: false
  at packages/mpd-dsh-adapter-plugin/test/adapter.test.ts:51:66
 21 pass / 1 fail   (red.log)
```

## Mechanism

The test asserts that every capability flag is `true` for a "full harness". Its `fakeHarness()`
mock provided `tools`, `subagents`, `skills` and `agentPresets` — the four seams the adapter had
when the mock was written. Commit `7a8d245` (`feat(team-compact)`), already on `dev`, added two
more seams to `capabilities()`:

```
packages/mpd-dsh-adapter-plugin/src/index.ts:406-408
  agents: agents !== undefined && typeof agents?.list === "function",
  compaction: typeof compaction?.compactNow === "function",
  compactionForAgent: scopedCompaction,   // liveAgents()[0].ctx.get("compaction")
```

The mock was never extended, so `agents`, `compaction` and `compactionForAgent` reported
`false` and the "every seam is true" assertion failed. The adapter package's own source is
untouched by this defect: the TEST was stale, not the code.

## Fix

`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` — the mock gains a `compaction` stub
(`compactNow`), an `agents` registry (`list` / `get`) holding one sample agent, and both are
wired into the ctx service map. The sample agent carries its OWN scoped ctx that resolves
`compaction`, mirroring the real harness (the compact-hinge measurement: the agent-scoped
engine and the host-plane one are different objects), so `compactionForAgent` is genuinely
exercised rather than stubbed to `true`.

Test-only change: no source, no dist, no runtime behavior.

## RED / GREEN

| Verdict | Command | Result |
|---|---|---|
| RED | `bun test packages/mpd-dsh-adapter-plugin` (pre-fix test file) | 21 pass / 1 fail (`red.log`) |
| GREEN | same, after the fix (`green-adapter.log`) | 22 pass / 0 fail |

## Gate sweep

| Gate | Result |
|---|---|
| `bun test packages` | PASS — 399 pass / 0 fail (`bun-test-full.log`) |
| `bun run typecheck` | PASS (`typecheck.log`) |
| `bun run test:qa` | PASS — all self-tests (`testqa.log`) |
