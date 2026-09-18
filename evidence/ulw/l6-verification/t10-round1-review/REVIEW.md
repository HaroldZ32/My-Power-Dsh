# t10 — review (round 1): advisory gate + delta registry integrity — verdict PASS

- Task `t10`, attempt `1ad51113-12b5-41b3-ac93-e000d942a9f9`; reviewed task `t5`
  (gate advisory auto-route + delta registry), judged on the **post-t17-repair** revision.
- Reviewer seat, 2026-09-18 ~02:15–02:30 UTC.

## Revision judged (pinned + settled)

- HEAD `5aa222a144e4238b67453731c5decd806db6db94`, branch `dev`, dirty wave tree.
- Pinned `2026-09-18T02:15:23Z`.

| file | sha256 |
|---|---|
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | `4888f69fad5c746432e4f57f0bb62b65da53f4d6dca082f256678ccb9fdbafc8` |
| `packages/mpd-agent-teams-plugin/lib/mpd-deltas.js` | `5d73ff247eefa91a2849dc7ac9cd5a50cf4deef8dd3b95c09fd43d10bf2d175d` |
| `scripts/patch-agent-teams-fixes.mjs` | `8d6a3102eed6973dfda5148c30ab49e5e84caaef7beaa223bd8383a8f108db6d` |
| `skills/dsh-qa/scripts/session-start-team.mjs` (t17-repaired) | `c6dc9cb495ab4b8857a1b39f774c3de89d9d8e65d24394efa7937ddf9e824a79` |
| `skills/dsh-qa/scripts/lib/gate-probe.mjs` | `ac080728790b9100a4136010b7cf52dd27a385be5a50bfb78a0f60c86d1483b8` |
| `presets/mpd/agent.cordis.yml` | `ccdb671209f7605ca7604d2756c30ac7b7e48e03674139a892152b5b147f057b` |
| `packages/mpd-bundle/cordis.patch.yml` | `a48f142d87155c437affb817fe52b9af4ff8a392fa28dcff73d4a3ab3c012116` |

My own live case independently reports the SAME settled pair
(`rev 5aa222a1` + `gateHash 4888f69fad5c…`), so the gate bytes reviewed are the gate bytes measured.

## Acceptance, item by item

1. **Verdict judges the LATEST state** — every check below ran against the post-t17 revision above.
2. **No-pre-staging, mechanically proven** — `packages/mpd-agent-teams-plugin/test/session-start.test.ts`,
   `installSessionTeamPolicy: a triggered SOFT auto-route injects the advisory and stages NO team`:
   drives the REAL listener with a soft-complex prompt, asserts the one advisory notice (marker,
   `NO team was staged`, `agent_teams_create(approval="required", profile="mpd")`) and asserts the
   state root carries **no team record at all**. Backed live by my own isolated three-way run:
   `softPluginStaged [0, 0]`, `softTeams [0, 0]`, `softAdvisory [1, 1]`, `softSignals [["C"], ["C"]]`.
3. **Delta integrity** — `node scripts/patch-agent-teams-fixes.mjs --check` → exit 0
   (`already applied: 120 mpd delta region(s) across 10 adopted file(s)`). `--check` is defined by the
   script itself as "every registered region present and byte-identical to the registry block", so a
   hand-edited registry entry would fail; the applier's nesting scan
   (`region "…" is NESTED inside region "…" … a marker must be a SIBLING`) is part of the same run and
   did not trip. No split declaration: the module parses and its 301 tests pass.
4. **Explicit request / mode:auto unchanged** — unit `routeDecision: a triggered auto-route ADVISES;
   explicit flag / auto / instruct keep provisioning` asserts `provision` for `team:` and `!team`,
   `provision` for `mode:"auto"`, `instruct` for `mode:"instruct"`, `none` for `autoRoute:false`.
   Live explicit arm: `explicitTeams [1]`, `explicitPluginStaged [1]`, `explicitProvisioned [1]`,
   record attributed **plugin** (auto-route description + matching `captainSessionId`); the model
   archived it (`archivedByModel: true`) — the count is active+archived, an accepted outcome.
5. **No live pre-staging promise remains** — verified surface by surface:
   `presets/mpd/agent.cordis.yml` (advisory branch + `trigger = explicit flag OR (matchedSignals >= 1)`),
   `packages/mpd-bundle/cordis.patch.yml` (advisory comment + same predicate),
   `packages/mpd-bundle/README{,.zh-CN}.md` (advisory, both twins), `AGENTS.md` ("ADVISES — it never
   pre-stages a team"), `lib/session-start.js` (`advisoryNotice`; `provisionedNotice` reachable only
   from the provision branch), the adopted README pair (speaks only about the explicit `/agent-teams`
   path — its staging narrative is still true), `skills/dsh-qa/SKILL.md` (three-way documented).
6. **Anti-false-positive honoured** — `matchedSignals >= 2` occurs in the live surfaces exactly four
   times, all rationale/history and NONE a rule: `lib/session-start.js` (the "superseded … must NOT be
   restored" module doc + the Option-A supersession note), the generated copy of that comment inside
   `lib/mpd-deltas.js`, and the pre-fix narration in `test/r3-f1-signal-c.test.mjs`. The frozen
   predicate in code is `input.explicitFlag === true || signals.length >= 1`. A review that filed this
   string as a restoration would be a FALSE POSITIVE; none was filed.

## CARRY-FORWARD (explicitly NOT a t5 finding)

The **stale packed artifact** `dist/mpd-package/**` still carries the pre-fix gate text — e.g.
`dist/mpd-package/presets/mpd/agent.cordis.yml` ("gate TRIGGERED -> the plugin has already staged the
default team" + `trigger = (matchedSignals >= 2) OR explicit flag`) and
`dist/mpd-package/cordis.patch.yml`. It is the RELEASE pack assembled by `scripts/pack-mpd.mjs`, and
T-88 assigns `dist/mpd-package/**` (like every `packages/*/dist/**`) to the integration task, whose
title is "rebuild every dist, ONE re-pin, ONE re-pack". Reported here with its exact paths so the t8
re-pack cannot silently skip it; not filed as a finding against t5, consistent with the captain's
correction of the stale-dist class (F3a: 18 of 20 build targets) and the F3b note (the SHIPPED
composition boots cleanly; only a mixed fresh+stale composition aborts).

## Commands run

| command | result |
|---|---|
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 120 regions / 10 files, byte-identical |
| `node skills/dsh-qa/scripts/lib/gate-probe.mjs` | exit 0 — simple→none, soft→advise, explicit→provision, autoRoute:false→none |
| `bun test packages/mpd-agent-teams-plugin` | 301 pass / 0 fail |
| `bun run verify:rows` | exit 0 — 25 row ids match the insert list |
| `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | exit 0 — 31 rows conform, row parity 31/31 |
| `node skills/dsh-qa/scripts/session-start-team.mjs` (live, isolated DSH_HOME + sandboxed HOME/workspace) | PASS, exit 0 — `evidence/ulw/l6-verification/session-start-team-2026-09-18T02-17-39.924Z/**` |

Live three-way (my run): simple ×3 → 0 teams, no notice; soft-complex ×2 → 0 teams, **0 plugin-staged**,
one advisory notice each naming signal C; explicit → exactly 1 `MPD Default` staged (11 roster members,
0 spawned), plugin-attributed; negative control (`autoRoute` disarmed) → 0 teams, no notice.
