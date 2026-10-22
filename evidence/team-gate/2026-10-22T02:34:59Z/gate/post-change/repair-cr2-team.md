# T15 / CR round 2 — caller cancellation reaches the todo seed

Task: `T15` (`CR round 2: prove caller cancellation reaches the todo seed`, kind `repair`, write scope
`packages/mpd-team-core-plugin`). CodeRabbit round-2 finding (Trivial) on
`test/goal-todo-bundle.test.ts`: `Harness.call` always passed `signal: undefined`, so the F-CR4 arm only
proved that SOME signal reached `todo_write` (the row's 10 s timeout), never that **caller**
cancellation propagates.

## Change — test only (`packages/mpd-team-core-plugin/test/goal-todo-bundle.test.ts`)

No source change was needed: `seedSignal(exec.signal)` already composes
`AbortSignal.any([exec.signal, AbortSignal.timeout(SEED_TIMEOUT_MS)])`, which follows the caller's
signal for the composite's whole lifetime. What was missing was a test that puts a REAL caller signal
on the exec.

- `Harness.call` gained an optional `signal` parameter, forwarded **verbatim** on the exec
  (`{ agent, signal }`) instead of the hard-coded `signal: undefined`.
- `approveWave` gained an optional `signal` parameter, passed to the `approve` call only (the staging
  calls carry none — there is no effect to cancel there).
- New arm **"CALLER cancellation reaches the seed: the write's signal follows the approving turn"**:
  it aborts an `AbortController` AFTER the approval returns and asserts the signal recorded on the
  `todo_write` request flips from `aborted: false` to `aborted: true`, with the approval's team record
  still on disk. The existing composed-signal assertion in the whole-list arm is kept unchanged.

The property proven is **live propagation**, not creation-time composition: the signal object handed to
`dsh.executeTool` is the composite, so it aborts whenever the approving turn aborts.

## Falsifiability (measured, not asserted)

The composition was temporarily reduced to the pre-T7 shape — `seedSignal` returning only the bounded
timeout — and the file re-run:

```
Expected: true
Received: false
(fail) R4 — approval bundles the durable goal and the todo checklist >
       CALLER cancellation reaches the seed: the write's signal follows the approving turn (F-CR4)
 11 pass
 1 fail
```

ONLY the new arm reddens — which is exactly the CodeRabbit point: the pre-existing composed-signal
assertion (a signal exists, not aborted) passes against a timeout-only implementation. The source was
restored **byte-identically**: sha256
`40ed516ff30ddf62fb2785f0b41a419dcd0e054c37f2d0de934e39e78f5a745d` before and after the mutation.

## Gates (observed output)

```
$ bun test packages/mpd-team-core-plugin
 245 pass
 0 fail
 1081 expect() calls
Ran 245 tests across 18 files. [1161.00ms]
 exit=0

$ bun run typecheck
$ tsgo --noEmit
 exit=0

$ bun run verify:comments
VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.
 exit=0
```

NOT run, deliberately: the `dist/` rebuild (captain's integration step; the task forbids it here) and
every gate outside the three the task names.

## Scope and bounds

```
$ git status --porcelain -- packages/mpd-team-core-plugin
 M packages/mpd-team-core-plugin/test/goal-todo-bundle.test.ts
$ git diff --stat -- packages/mpd-team-core-plugin
 .../test/goal-todo-bundle.test.ts   | 37 +++++++++++++++++++---
 1 file changed, 32 insertions(+), 5 deletions(-)
```

- The arm asserts the signal **handed to `dsh.executeTool`** follows the caller. Whether the harness's
  own tool runtime actually stops the write on that signal is the adapter/harness contract (the adapter
  forwards it verbatim): read, not re-implemented, and not claimed beyond the hand-off.
- No source, README or dist change; no new config knob. No git write command was run.
