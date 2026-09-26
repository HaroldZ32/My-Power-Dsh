# t50 — T-06: the monotone revision token through the `writeTeam` funnel

Stamp `20260917T155633Z` · lane A (agent-teams-engineer) · attempt `e98edb42-c6c3-47c2-8a11-6aeddf704801`.

## Deliverable

A MONOTONE revision token on the team record, bumped at the record's write sites, validated in the
shape chain, readable back from the record, and printed beside the task states it belongs to.

- `lib/state.js` — `teamRevisionOf(team)` (the ONE reader; a legacy record reads as 0),
  `bumpTeamRevision(team)` (the bump helper; RETURNS the new value), the bump in the FUNNEL
  `writeTeam` (every one of the 29 measured call sites goes through it), the opening bump in the
  record's other writer `createTeamDir`, and the token in `isTeamState`'s shape chain
  (`undefined` allowed for legacy; otherwise a non-negative safe integer, refused like a bad `taskSeq`).
- `lib/tools.js` — `agent_teams_status`'s payload carries `revision: teamRevisionOf(team)`, and
  `renderStatus` prints `Revision: N (monotone; every team write moves it)` BEFORE the task lines, so
  the states below are stamped by the token above them.
- A COUNTER, never a clock: ten writes inside one millisecond still differ, and a clock stepping
  backwards cannot make the token regress.

Regions added (7) — `team-revision-token`, `team-revision-shape`, `team-revision-open`,
`team-revision-bump` (`lib/state.js`); `team-revision-import`, `status-revision-payload`,
`status-revision-render` (`lib/tools.js`). All siblings, none nested, none splitting a function.

## CORRECTED CENSUS (measured here, replaces the inherited number)

The hand-over's census was `members 3 / scheduler 6 / tools 20 / state 1`. Measured by counting
**call sites** (not definition lines), the tree has **29**: `members.js` 3 / `scheduler.js` 6 /
`tools.js` 20 — and `state.js` contributes the DEFINITION, not a call (`lib/mpd-deltas.js` is the
derived registry and embeds region bodies as strings, so it is excluded from the census). And there
are **TWO `team.json` writers**, both in `lib/state.js`: `createTeamDir` (opens a record; all three of
its call sites create a FRESH team, so there is no prior counter to preserve — it stamps 1) and
`writeTeam` (the funnel for every subsequent write). Arm 3 pins the two-writer census, so a third
writer reddens; the alternative (leave the opening write un-stamped, so a fresh team's status would
print `unrecorded`) was rejected and is named in the code comment.

## Readings (all on the settled tree)

| command | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin` | **288 pass / 0 fail / 2584 expect() / 45 files**, exit 0 (`suite.log`) |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/t50-team-revision.test.mjs` | 6 pass / 0 fail / 49 expect(), exit 0 (`arms-after.log`) |
| `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail, exit 0 (`heal.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 106 regions / 10 adopted files (`registry-check.log`) |
| `bun run verify:docs` | PASS — derived arm true, `carried **106**/10 vs derived 106/10` (`verify-docs.log`) |
| `bun test ./packages/mpd-team-watchdog-plugin` (CROSS-LANE READING) | 139 pass / 0 fail / 684 expect() / 13 files, exit 0 (`cross-lane.log`) |

`--write-registry` ran in the same change as the edit (99 → 106 regions) and the count sentence in
`agent-references/agent-teams-deltas.md` moved with it.

## RED SIDES (both bump sites armed independently)

Scratch mirrors outside the workspace, each with ONE bump neutralised, same arm file:

| mirror | neutralised | result |
|---|---|---|
| A | `writeTeam` (funnel) | **exit 1 — 4 arms red**: 1 FUNNEL, 2 NEG CONTROL, 4 STATUS, 5 OPENING (`arms-mirrorA-funnel-bump-reverted.txt`) |
| B | `createTeamDir` (opening) | **exit 1 — 1 arm red**: 5 OPENING (`arms-mirrorB-opening-bump-reverted.txt`) |

IN-ARM negative control (runs in the normal suite, no mirror): an un-bumped fixture written directly
(`revision: 7` and unchanged) makes the SAME `assertMoved(previous, next)` predicate that the decisive
reading uses throw (`did not move forward: 7 -> 7`), and a regression / non-integer / string also
throws — the check cannot be satisfied by any constant.

## `test/**` grant — NOT EXERCISED (measured)

15 files under `packages/mpd-agent-teams-plugin/test/` read team records (re-measured here by
`taskSeq` references). NO `test/**` file was edited by t50: the four that show cumulative wave edits
(`r1-message-channel`, `t49-send-dedup-wiring`, `t52-interjection-tools`, `task-contract-tool`) carry
mtimes 23:34–23:41, all from t47/t48/t49, while the only file t50 created has mtime 23:56:33 (this
stamp). The token is ADDITIVE, so no record-shape pin moved; the grant was declared and not needed.

## Honest bounds

- The suite's `expect()` total moved 2479 (t49) → 2527 **before the arms existed** with no test file
  edited, and 2584 with the six arms (their own contribution: 49). The movement is REPORTED as
  measured, not attributed; it is not an acceptance criterion, and the substantive reading — 0 fail
  at both revisions — is unchanged. (An attribution mirror run was inconclusive and is not cited.)
- The WEB PANEL copy of the token is NOT delivered: T-06's deliverable names the model-facing
  `renderStatus` only. If the panel must carry it, the source change belongs in `lib/snapshot.js`
  (inside lane A's `lib/**`) and the BUILT client needs the named hop — no built artifact was edited.
- `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`, `skills/**`
  untouched; no repo-wide aggregate claimed; every path-qualified command is `./`-formed.

## Revisions (sha256, first 16)

`lib/state.js 58d76b5c70cf8259…` · `lib/tools.js 25dfc8722c8e685e…` ·
`lib/mpd-deltas.js aa4524aebbcc3682…` (106 regions) · `agent-references/agent-teams-deltas.md
2ef785fc6c365167…` · arm `self-fix-tests/t50-team-revision.test.mjs cc81768cd0108ff6…`.
Baseline for this attempt (pinned by t49): `lib/state.js 5d0c03310844b0b8…`,
`lib/index.js f81511414eb6a2bb…`, `lib/tools.js b7ab6ef5769d3188…`, registry `517443d86ed72c2c…`.
