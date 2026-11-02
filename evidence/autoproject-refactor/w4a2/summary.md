# W4-A2 — worker slots with a hard background bound in autoproject rounds

Lane: Senior Engineer (board row T35). Contract: `.mpd/plans/autoproject-refactor.md` §10 item A2.
Package: `packages/mpd-autoproject-plugin` only (src + test). Started from the final state of the
escalation repair (T31, completed).

## The knobs (both read PER RUN from the live layer, then the row, then the default)

| knob | live key | row fallback | default |
|---|---|---|---|
| concurrent children | `autoproject.slots` | `config.slots` | **3** |
| hard bound on ONE child | `autoproject.slotBoundMs` | `config.slotBoundMs` | **1_800_000 ms (30 min)** |

Both stay OUTSIDE `SETTINGS_KNOBS` (the count is untouched at 47): they are read through the
`mpdConfig` service by `liveConfigValue(ctx, key)`, exactly like the escalation knobs, so a
`.mpd/mpd.jsonc` edit applies to the NEXT run and never needs a restart.

## What the engine does now

1. **SLOT LEDGER.** `consult()` takes a slot before raising a child and releases it in a `finally`, so a
   success, a roster refusal and a throw all return the slot. When every slot is busy the caller WAITS
   in FIFO order instead of over-subscribing — which is what makes the two parallel phases observable
   (the hyperplan wave raises 5 `Architect` consults, the quality gate raises 3 `Reviewer` ones).
2. **HARD BOUND.** The child is raced against a timer of `slotBoundMs`. On expiry the engine aborts the
   child through its `AbortSignal` (composed with the caller's own signal, so a cancelled turn still
   cancels) and records `late/killed:<role>` in the journal, one row in `state.json`, and a row log line.
3. **HONEST REPORT.** `state.json` carries `slots`, `slotBoundMs`, `slotsPeak` and `kills[]`; the final
   report gains `slots: N child(ren) killed at the <bound> ms bound (<role>@<elapsed>ms round <n>, …)`.
4. **THE RUN IS BLOCKED.** A killed child forces the final status to `blocked` — never `complete`,
   never "still running". An ESCALATED run keeps its hand-off word (a hand-off is not a claim that the
   work finished) and its artifact still carries the killed list; the code comments say so.

## The ledger row shape

`state.json` → `kills: SlotKill[]`, one row per kill:

```json
{ "role": "Junior Engineer", "at": "2026-11-02T13:01:22.345Z", "elapsedMs": 34, "boundMs": 30, "round": 1 }
```

`role` is the roster role the killed child was raised as, `at` the ISO instant the kill was decided,
`elapsedMs` how long it had run, `boundMs` the number that was in force (so a later reader can tell a
slow child from a hung one against ITS OWN bound), and `round` the round it belonged to.
The journal (`ledger.jsonl`) carries the matching line `{lane:"late/killed:<role>", verdict:"killed",
detail:"elapsed=<n>ms bound=<m>ms round=<r>"}`.

## Observed results

| command | result |
|---|---|
| `bun test packages/mpd-autoproject-plugin` | **exit 0 — 49 pass, 0 fail** (3 files; 45 before this task) — `package-tests.log` |
| `bun run typecheck` | exit 1 with **2 errors, both in `packages/mpd-cellwork-plugin/test/`** (another lane's in-flight work); **zero in this package** — `typecheck.log` |
| `node scripts/verify-comment-coverage.ts` | exit 1 with **1 violation in `packages/mpd-cellwork-plugin/test/lib/team-actions-double.ts`** (that lane); **zero in this package** — `verify-comments.log` |

New arms (4):
- **(a)** a child that NEVER settles is killed at a 30 ms bound with ONE slot: the run ends `blocked`,
  `state.json` carries the bound/cap/peak and TWO timestamped kill rows (round 2's child could only be
  raised because round 1's slot came back), the journal carries `late/killed:Junior Engineer`.
- **(b)** `autoproject.slots: 2` really caps concurrency: the hyperplan wave raises 5 `Architect`
  consults and the observed high-water mark is EXACTLY 2.
- **(c)** a THROWING child (the unconfigured-route refusal) still releases its slot: with ONE slot,
  round 2 is raised anyway and nothing is recorded as killed.
- **(d)** a run that stays under the bound reports `complete` exactly as before, with `kills: []`.

## FALSIFIABILITY (measured, both mutations restored afterwards — `falsifiability.log`)

- **Mutation A — the bound removed** (`Promise.race` → plain `await`): arm (a) FAILS by TIMEOUT after
  5 s. The bound is what makes a hung child terminate.
- **Mutation B — the `blocked` override removed**: arm (a) FAILS on `expect(res.status).toBe("blocked")`.
  The "a killed child forbids `complete`" rule is load-bearing, not decorative.

## What I could not do / bounds

- `bun run typecheck` and `verify:comments` are RED for **another lane's** in-flight
  `packages/mpd-cellwork-plugin/**` edits; neither names a file in this package.
- The real `dsh` AbortSignal plumbing is not exercised here: the arms prove the engine aborts and
  releases, and a child that ignores its signal still cannot hold the run (the race returns), but
  whether a REAL roster child terminates on abort is the adapter's contract, not this package's.
- No dist rebuild, no git, no `skills/**`; the tool name, the escalation predicate and the directive
  are untouched.
