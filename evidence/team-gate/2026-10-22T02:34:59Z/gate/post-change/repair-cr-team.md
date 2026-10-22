# T7 / findings F-CR4 + F-CR5 — bounded, cancellable todo seed, and the two non-fatal branch arms

Task: `T7` (`F-CR4/F-CR5: todo seed cancellation + non-fatal branch tests`, kind `repair`, write scope
`packages/mpd-team-core-plugin`). CodeRabbit findings on PR #59, both in this package. Context of the
change under repair: R4 of `team-gate-wave` — the `agent_teams_plan` approve path anchors a goal and
seeds `todo_write`.

## F-CR4 — the seed had no cancellation of its own and no row-owned bound

**VERIFIED FIRST, as the task requires.** The adapter's `executeTool` computes its cancellation as
`input.signal ?? timeoutSignal(input.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS)`, with
`DEFAULT_TOOL_TIMEOUT_MS = 120_000` (`packages/mpd-dsh-adapter-plugin/src/index.ts`). So a caller
`signal` **REPLACES** the timeout: passing both would silently drop the timeout, passing only a signal
drops the bound, and passing neither leaves the adapter's 120 s default. The shipped seed call passed
NEITHER (no `signal`, no `timeoutMs`), so the pre-fix bound was the adapter's 120 s default and the
approving turn's cancellation could not reach the write. The finding's premise holds in substance; its
phrasing ("passes `timeoutMs` but no signal") describes a revision that never shipped — the shipped call
passed neither — but the consequence it names (a hung todo can last the 120 s default) is exactly what
the shipped code did.

**Change — `packages/mpd-team-core-plugin/src/index.ts`:**

- `SEED_TIMEOUT_MS = 10_000` — the bounded seed clock the ROW owns, with the reason written down (the
  seed is the last act of an approval that already succeeded; a whole-list local write 10 s is generous).
- `seedSignal(upstream)` — composes `AbortSignal.timeout(SEED_TIMEOUT_MS)` with the approving call's
  `exec.signal` through `AbortSignal.any`, so the seed ends on EITHER the caller's cancellation OR the
  bound. Degrades to the caller's own signal where a runtime lacks `AbortSignal.any`/`timeout` (the same
  defensive shape the adapter's own `timeoutSignal` uses).
- `bundleApprovalEffects` — the `dsh.executeTool` call now passes `signal: seedSignal(exec.signal)`.
- The `mpdGoal.anchor` path is **UNCHANGED**, per the finding (the bridge owns its own cancellation
  through the goal tools).

**Falsifiability (measured, not asserted).** With only the `signal:` line removed from the call, the new
assertion reddens:

```
Expected constructor: [class AbortSignal extends EventTarget]
Received value: undefined
(fail) R4 — approval bundles the durable goal and the todo checklist >
       ONE whole-list todo_write, seeded pending from the task subjects and scoped to the live agent
 10 pass
 1 fail
```

The source was then restored **byte-identically**: sha256
`40ed516ff30ddf62fb2785f0b41a419dcd0e054c37f2d0de934e39e78f5a745d` before and after the mutation.

## F-CR5 — the two missing non-fatal branch arms

`packages/mpd-team-core-plugin/test/goal-todo-bundle.test.ts`:

- **"a REFUSED anchor logs one line and leaves the approval intact"** — the harness's new
  `goal: "refuse"` makes the service answer `{ok: false, error: "the harness refused the anchor"}`. The
  arm asserts the log list is EXACTLY that one refusal line, the todo seed still runs (the effects are
  independent), and the team record exists on disk.
- **"a THROWING hasTool probe skips the seed silently and leaves the approval intact"** — the new
  `hasToolThrows` option makes the probe throw (a partial-adapter path). The arm asserts NO tool call,
  **NO** log line (a probe miss is the degrade step, not a failure), the anchor still ran, and the team
  record exists on disk.
- The harness now records the `signal` of every `executeTool` call, which is what makes F-CR4 a REQUEST
  assertion (`instanceof AbortSignal`, not aborted) rather than a behavioural guess.

Both arms are falsifiable against the shipped branches: removing the `ok:false` log empties `logLines`
(exact-equality arm fails), and removing `hasTodoTool`'s catch lets the probe throw out of the approval
(the answer is never defined).

## Gates (observed output)

```
$ bun test packages/mpd-team-core-plugin
 244 pass
 0 fail
 1078 expect() calls
Ran 244 tests across 18 files. [1118.00ms]
 exit=0

$ bun test packages/mpd-team-core-plugin/test/goal-todo-bundle.test.ts
 11 pass
 0 fail
 50 expect() calls
Ran 11 tests across 1 file. [138.00ms]
 exit=0

$ bun run typecheck
$ tsgo --noEmit
 exit=0

$ bun run verify:comments
VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.
 exit=0
```

NOT run, deliberately: the `dist/` rebuild (the captain's integration step, and the task forbids it
here), and every gate outside the three the task names.

## Scope and bounds

```
$ git diff --stat -- packages/mpd-team-core-plugin
 packages/mpd-team-core-plugin/src/index.ts         | 46 +++++++++++++++++
 .../test/goal-todo-bundle.test.ts                  | 59 +++++++++++++++++++---
 2 files changed, 97 insertions(+), 8 deletions(-)
```

- No new config knob: `SEED_TIMEOUT_MS` is a row constant, not a setting.
- The bound is **stated, not waited out**: no test sleeps 10 s to observe the abort. The arms prove a
  composed, non-aborted signal is handed to the adapter and that this assertion is falsifiable; the
  adapter's `signal`-replaces-timeout semantics were READ from the shipped adapter, not re-implemented.
- `mpdGoal.anchor` deliberately unchanged; the goal bridge's own cancellation is that row's contract.
- Nothing outside the two files and this evidence path was touched; no git write command was run.
