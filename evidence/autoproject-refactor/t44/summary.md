# T44 — the `RunState` contract comment (comment-gate blocker)

The gate read `packages/mpd-autoproject-plugin/src/engine.ts` → `237: comment — RunState`. The cause was a
PLACEMENT defect from the W4-A2 slots work, not a missing sentence: the doc-comment that belonged to
`RunState` ("The durable state document this engine writes after every mutation") had been left ABOVE
`SlotKill`, so `RunState` had no comment of its own and `SlotKill` carried two.

FIX (comments only, zero behaviour):
- the stray sentence above `SlotKill` is removed (that interface keeps its own precise comment);
- `RunState` gains ONE contract comment stating what the record is (the run's durable round JOURNAL at
  `<stateDir>/<runId>/state.json`, rewritten never appended), the invariant a reader must keep (**it is
  not the authority on anything** — the verdict is the verify plane's record and the in-flight ledger is
  `.mpd/boulder.json`, so no field here may be read as a second verdict), and the three fields that are
  easy to misread: `wave` is the last round that RAN (not the cap), `status` exists only once terminal,
  `verdict` mirrors the verify plane instead of deciding it — plus the optional `slots*`/`kills` block
  meaning "the hard bound never fired" when absent.

Verified: `git diff -U0` on the file has no non-comment changed line (14 insertions / 1 deletion, all
`/**`, ` *` or `//`).

## Gates

| Command | Result |
|---|---|
| `bun run verify:comments` | **VERDICT: PASS**, 555 files / 50050 declarations, exit 0 (`comments.log`) |
| `bun test packages/mpd-autoproject-plugin` | **49 pass / 0 fail**, 436 `expect()`, exit 0 (`tests.log`) |
