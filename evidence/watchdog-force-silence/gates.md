# Watchdog force-silence — gate results (2026-11-06)

All commands run from the repo root. The two `bun build` invocations use the PINNED toolchain.

| Gate | Command | Exit |
|---|---|---|
| build (watchdog) | `.toolchain/node_modules/.bin/bun build packages/mpd-team-watchdog-plugin/src/index.ts --target node --format esm --outfile packages/mpd-team-watchdog-plugin/dist/index.js` | 0 |
| build (core) | `.toolchain/node_modules/.bin/bun build packages/mpd-team-core-plugin/src/index.ts --target node --format esm --outfile packages/mpd-team-core-plugin/dist/index.js` | 0 |
| typecheck | `bun run typecheck` | 0 |
| tests | `bun test packages/mpd-team-watchdog-plugin packages/mpd-team-core-plugin` | 0 (799 pass / 0 fail / 3914 expect() / 61 files) |
| comments | `bun run verify:comments` | 0 (604 files, 53553 declarations, PASS) |
| docs | `bun run verify:docs` | 0 (pairs=55 failed=0 violations=0 — PASS) |
| dist freshness | `node scripts/verify-dist-fresh.ts` | **1** |

## The dist-freshness failure is NOT this wave's

`verify-dist-fresh` reports 2 of 34 targets stale, and NEITHER belongs to this wave's write scope:

- `packages/mpd-roster-provider-plugin/dist/index.js`
- `packages/mpd-tui-plugin/dist/index.js`

Evidence that my change cannot have caused them:

- `grep -c "team-actions|wedged-grace|graceWedgedTask" packages/mpd-tui-plugin/dist/index.js
  packages/mpd-roster-provider-plugin/dist/index.js` → `0` and `0`: neither committed bundle embeds a
  module this wave edited.
- `mpd-tui-plugin` imports only `import type { TeamRecord } from .../team-store.js` (an ERASABLE type
  import, erased by `bun build`), and `mpd-roster-provider-plugin` imports nothing from these packages.
- My two packages are FRESH in the same run: neither appears in the STALE list.

Rebuilding them would edit files outside this wave's ownership row, so it is reported, not absorbed.

## Test coverage added/updated

- `packages/mpd-team-watchdog-plugin/test/wedge-force.test.ts`: the 9 age-based arms updated to the
  silence rule (stale stamps + `graceMs: 0` where the arm pins the kill), plus AC1 (ancient row, fresh
  activity → no decision), AC2 (grace → wait → one kill, one per generation), AC3 (non-bash open tool
  inside/past its bound), AC4 (engine: directive on tick 1, NO interrupt, kill on tick 2).
- `packages/mpd-team-core-plugin/test/wedge-force.test.ts`: S4 adoption of a member handoff (no
  template, no interrupt), S5/AC7 handoff content (description, scopes, argument excerpt, idle clock,
  real row ids, no "system message"), S6/AC5 terminal race (row stays completed, no requeue/split, one
  force-skipped journal row), S7/AC6 split rows (owner/blockedBy []/sourceTaskId) and the mailbox
  recovery verbs; the two old "unowned split" pins were UPDATED, never deleted.
- `packages/mpd-team-core-plugin/test/claim-clock.test.ts`: AC8 — claiming a row whose `startedAt` is a
  day old stamps the claim's own instant.
