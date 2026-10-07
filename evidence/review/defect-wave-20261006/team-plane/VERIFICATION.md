# `fix/team-plane` — the verification record

Findings T1–T7 of `../FINDINGS.md`. Every number below was re-measured by the captain on the branch
tip AFTER the writers stopped, not quoted from a writer's report.

Baseline `dev` @ `82f7663e`. Branch `fix/team-plane`.

## What changed

| Package | Files |
|---|---|
| `packages/mpd-team-core-plugin` | `src/index.ts`, `src/plan-store.ts`, `src/team-store.ts`, `dist/index.js`, 3 test files |
| `packages/mpd-team-watchdog-plugin` | `src/team.ts`, `src/index.ts`, `src/engine.ts`, `src/actions.ts`, `src/sidecars.ts`, `dist/index.js`, 2 test files, README pair |
| `packages/mpd-team-compact-plugin` | `src/index.ts`, `dist/index.js`, `test/compaction.test.ts`, README pair |

## The coupled design decision (T1 + T3)

The MPD team record is the AUTHORITATIVE team plane (AGENTS.md §1). The watchdog's team universe
therefore reads `mpdTeams.list(workspace)` FIRST and keeps `dsh.teamLiveTeams()` — the OFFICIAL fold —
as the fallback; the two are deliberately NOT unioned, because one team present on both planes would
be reported twice under two ids.

That is what closes T1: `team.ts#projectMpdTeam` sets the record's `id` to the mpd `teamId`
(`team-<stamp>`), so the id the watchdog FILES a hold under (`engine.ts#performHold(workspace,
team.id, …)` → `paths.ts#holdPath`) is now the same id the dispatch gate ASKS about
(`mpd-team-core-plugin/src/index.ts#readWatchdogHold` → `isHeld(record.teamId, workspace)`).

T1's regression test pins the ARGUMENTS: the `isHeld` double is keyed by
`(teamId, workspace)` against the real record list, so the argument-blind stub that let this ship can
no longer answer "held" to whatever id it is handed.

## Measured on the branch tip

| Check | Observed |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **124 pass / 0 fail**, 594 expect() calls, 9 files |
| `bun test packages/mpd-team-watchdog-plugin` | **152 pass / 0 fail**, 729 expect() calls, 15 files |
| `bun test packages/mpd-team-compact-plugin` | **23 pass / 0 fail**, 105 expect() calls, 1 file |
| `node scripts/verify-dist-fresh.ts` | `ok: 29/29 targets fresh (each rebuilt twice, byte-identical)` |
| `bun run verify:comments` | `VERDICT: PASS` — 395 files, 32 406 declarations |
| `node scripts/verify-rows-parity.ts` | `ok: 33 row ids` |
| `bun run verify:docs` | `failed=0 violations=0` — PASS |
| `bun run typecheck` | **4 errors, ALL pre-existing** in `skills/programming/scripts/typescript/check-no-excuse-rules.ts`; **0 added** |

## The RED that each fix was pinned against

Quoted from the writers' transcripts and re-run by the captain where noted.

- **T1/T3** — `expect(received).toEqual(expected)  - ["team-20261006120000"]  + []` (6 of 10 arms red
  when replayed against the official-only read).
- **T2** — `Expected: "in_progress"  Received: "pending"` — the concurrent claim erased by the pass's
  stale snapshot.
- **T4** — `Expected - ["team-20261006120000"]  Received + []` (RED replayed by temporarily restoring
  the pre-fix read).
- **T5** — `Expected pattern: /path separator/  Received function did not throw`, plus the second arm
  that caught `archivePlan` bypassing the reducer (`escaped plan.json exists: true`).
- **T6** — `Expected: false  Received: true`; after the fix nothing is written (`readWatermarks` = `{}`).
- **T7** — `expect(Object.keys(ledger).sort()).toEqual(["T3"])` → `Received ["T1","T3"]`, with the two
  preceding assertions (`pairs === ["T3"]`, `ledgerAtSend === []`) already green, which is what proves
  the concurrent release landed INSIDE the await and only the blind final write resurrected it.

## Named residuals (stated, not glossed)

1. **Cross-PROCESS** last-writer-wins on `.mpd/team/dispatch.json` is not covered — T7 closes the
   in-process async window only.
2. (**T4 runtime**) compaction of a NATIVE teammate depends on `dsh.liveAgent(executorRef)` resolving
   the continuable child id. Not verified here: it degrades honestly to `skipped-not-live`, and a live
   boot was out of scope for this branch.
3. `verify-vendor` cannot run on this machine at all (no `MPD_UPSTREAM_ROOT` upstream checkout) — see
   `../gate-sweep.log`; it is an environment prerequisite, not a code defect, and it is the ONLY member
   that reddens `bun run verify:gates` here.

## Build toolchain (operational, cost real time to find)

`verify-dist-fresh.ts` compares against the PINNED toolchain. On this machine the PATH bun is **1.4.2**
and emits bytes the gate reads as STALE; the pinned **1.4.0** lives at `.toolchain/bun/bin/bun`. Every
rebuild on this branch used the pinned binary, and `29/29 fresh` is the evidence it mattered.
