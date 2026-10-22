# T9 / CodeRabbit F-CR7 — dangling `else` in the QA case's side seeding (2026-10-22)

Task: `T9` (`F-CR7: QA script dangling-else mis-seeds the large-workspace side`), repair kind.
Scope: `skills/dsh-qa/scripts/session-start-team.ts` only (single skills writer for this wave).

## The defect

The large-workspace seed had been inserted BETWEEN the `mpdJsonc` seed and its `else if`:

```ts
if (side.seed?.mpdJsonc !== undefined) seedFile(sideWs, join(".mpd", "mpd.jsonc"), side.seed.mpdJsonc)
// … inserted …
if (side.seed?.largeWorkspace === true) seedLargeWorkspace(sideWs)
// …
else if (side.expectedMode === GATE_MODE_MECHANICAL && side.unsetGate !== true) seedFile(…)
```

The `else` therefore bound to the `largeWorkspace` `if`, so on the `large-workspace` side the
explicit `team.gate` seed was silently skipped. The mode still resolved to `mechanical` through the
DEFAULT, which is exactly why the arm could look green while violating the case's own discipline
("a mechanical side NAMES its mode instead of inheriting it") and while its `gateKeyAbsent` audit no
longer described what the side declared.

## The fix

The large-workspace seed moved BEFORE the mode pair, so `if (mpdJsonc) … else if (expectedMode …)`
is adjacent again, and a comment records why the order is load-bearing (so a future insert cannot
re-introduce the dangling else). Diff: 5 insertions, 3 deletions, one file.

```ts
if (side.seed?.largeWorkspace === true) seedLargeWorkspace(sideWs)   // moved up
if (side.seed?.mpdJsonc !== undefined) seedFile(… mpd.jsonc …)
else if (side.expectedMode === GATE_MODE_MECHANICAL && side.unsetGate !== true) seedFile(… mechanical …)
```

A scan of the file finds exactly two more `else if`s (`evaluateSide`'s verdict chain at ~1839/1841);
both are adjacent to their `if` in the same chain, so no other instance of this class exists.

## Verification (quoted)

$ node skills/dsh-qa/scripts/session-start-team.ts --self-test
  [session-start-team self-test] ok: the shipped PURE gate module conforms to the MECHANICAL contract
  (… corpus table, FOUR negative controls reddened, C7/C8 both ways, team.sensitivity's three rows,
  the PER-ROW LEXICON, the user's verbatim first message, signal F both ways, bundle mounts mpd-roles,
  preset carries the session-start convention)
  selftest_exit=0

$ bun run typecheck
  $ tsgo --noEmit
  (exit 0)

## Honest bound

The `--self-test` arm is OFFLINE and does not execute `runSide` (it is a nested function of the live
lane), so it cannot prove the seeding change behaviourally. What is proven here is the binding
(adjacent `if`/`else if`, visible in the file) plus the case's contract still passing. The
`large-workspace` side is exercised only by the LIVE case, which the captain runs (and whose result
will show `signals=F`, `staged=1`, and — now — the side's own seeded `team.gate`); `dist/` was NOT
rebuilt, as instructed.
