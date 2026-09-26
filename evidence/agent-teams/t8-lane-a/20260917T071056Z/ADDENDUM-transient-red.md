# Addendum: the settled sweep, one transient red, and its record

**Recorded by:** `agent-teams-engineer` (`t8`, lane A) · `2026-09-17T07:50Z` · contract revision 5

## Settled readings (log: `settled-sweep.log`)

| command | reading |
|---|---|
| `bun run typecheck` | **exit 0** — lane C landed the missing `KnobIssue` import in `packages/mpd-team-watchdog-plugin/src/engine.ts`; the earlier cross-lane red (07:29Z → 07:38Z, attributed by hash + line, reported to the captain and to watchdog-engineer) is preserved in `typecheck-cross-lane.log` and NOT rewritten |
| `bun test packages/mpd-agent-teams-plugin/self-fix-tests/` | 101 pass / 0 fail on ten subsequent runs (see below) |
| `bun test …adapter-identity.test.ts (both packages)` | 17 pass / 0 fail |
| `node scripts/patch-agent-teams-fixes.mjs --check` | 78 regions across 9 files, exit 0 |
| `self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail |
| `bun test packages/mpd-agent-teams-plugin` (whole plugin suite) | 258 pass / 0 fail |

## The transient, recorded rather than smoothed

One run of `bun test packages/mpd-agent-teams-plugin/self-fix-tests/` inside the settled sweep printed
**100 pass / 1 fail**, and the failing line was LOST because that command's output was piped through
`tail -4` — a recording error on my side, not evidence of absence. After it:

- four sequential full-suite runs: 101 pass / 0 fail, exit 0 each (`v1.log`, `v2.log`, `v3.log`,
  `verify-1-full.log`);
- **six CONCURRENT full-suite runs** (deliberate load, the condition the transient appeared under):
  101 pass / 0 fail, exit 0 each (`load-run/load1..6.log`).

So the red is **UNREPRODUCED in ten controlled runs** and is NOT claimed here to be either fixed or
explained. The one hypothesis recorded (explicitly a HYPOTHESIS, not a finding): the `T-07 THE RACE`
case's no-wake branch asserts on a logger line produced by `noteDispatchDecline`, whose dedupe key is
`(teamId, memberName, reason)` in a module-level Set — a same-process second occurrence with the same
key logs nothing. That branch's missing binding (`warnings`) is the flake this lane DID repair and
prove pre-existing at HEAD (see `result.json` → `instruments_repaired_beside_the_five_fixes`), and
after the repair it asserts and passes in every run — but this addendum does not claim the 100/1 was
that case, because the line was not captured.

**Carry-forward for the reviewer (`t12`):** the red existed once; its identity is UNKNOWN; the suite
is green on ten runs including six under load; and the recording error (a `tail` on a command whose
detail mattered) is the reason it cannot be named here.
