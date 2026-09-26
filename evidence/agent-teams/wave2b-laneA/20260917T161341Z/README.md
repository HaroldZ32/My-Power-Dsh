# t52 — T-42: ONE plan format through BOTH paths, compared as a READING

Stamp `20260917T161341Z` · lane A (agent-teams-engineer) · attempt `d172bc05-ae0e-43c8-95a2-8fb5b0251b9d`.

## The row and what was absent

The session-start path only asked WHETHER a `.mpd/plans/*.md` artifact exists (a soft signal for the complexity
gate); the DAG seed took its tasks from a profile's `tasks` templates, and nothing compared the two. Declared
convention now: **the PLAN'S OWN item ids** — `## TODOs` numbered items (`T1`, `T2`, …) and
`## Final Verification Wave` items (`F1`, …) — normalised once and consumed by BOTH paths.

| region | file | what it does |
|---|---|---|
| `mpd-delta plan-format-seed` | `lib/session-start.js` | `parsePlanSeedItems` (the declared format, subjects normalised, ids `T<n>`/`F<n>`), `readPlanSeedSet(workspace[, planFile])` (the session-start half), and the COLLISION REFUSAL naming the id and both lines |
| `mpd-delta seed-task-drafts` | `lib/tools.js` | `seedTaskDrafts(templates, seedToActual, now)` — the DAG seed's ONE draft builder, extracted from the inline mapping (`t<index+1>` + `profileSeedId` preserved) |
| `mpd-delta plan-file-seeds-dag` | `lib/tools.js` | `initializeProfileTeam` accepts `planFile`: its draft tasks come from the plan artifact through the SAME reader, throwing `plan seed refused for "<file>": <error>` on a refusal |
| `mpd-delta plan-format-import` | `lib/tools.js` | the import, with the FUNCTION-LEVEL ESM cycle documented (session-start imports `initializeProfileTeam` from tools) |

## The reading (both sets side by side — printed by the arm, so the log IS the comparison)

```
[T-42] path A (plan artifact .mpd/plans/fixture-plan.md): [{"seedId":"T1","id":"t1","subject":"the first item — do the first thing"},{"seedId":"T2","id":"t2","subject":"the second item — do the second thing"},{"seedId":"F1","id":"t3","subject":"run the reading"}]
[T-42] path B (DAG seed seam, 3 draft task(s)):           [{"seedId":"T1","id":"t1",…},{"seedId":"T2","id":"t2",…},{"seedId":"F1","id":"t3","subject":"run the reading"}]
[T-42] path B' (profile tasks convention):                [identical]
```

with `expect(setB).toEqual(setA)` over the normalised `{seedId, id, subject}` triples and `expect(fromTemplates).toEqual(setA)`
for the other convention.

## DECLARED BOUND (the uncovered half, named rather than implied)

The FULL staged `initializeProfileTeam` leg is **not** driven end-to-end in the arm. It was attempted and refused
twice by the member/LLM machinery before the plan path is reached (`AgentTeams profile "fixture-profile" has no
members`, then `captain.session.requestHeader is not a function`, then `captain.options.provider`) — i.e. it needs
the member-spawning LLM witness, not a plan. The arm therefore exercises the seed's OWN mapping seam
(`seedTaskDrafts`, the function the seed calls) and asserts the CALL and the plan-file wiring against the source
(declared as WIRING, never counted as the behavioural reading). The comparison of the two conventions IS the
declared reading.

## Collisions: refused, never merged

Two items naming one id → `plan item id "T2" is named twice (lines 5 and 6) — ids are IDENTITY: the plan is
refused, never merged and never suffixed`; the reader reports it, the DAG seed throws on it before writing, and a plan
that declares no items is refused too (`no plan items found`). RED SIDE: the mirror with the refusal block removed
(`arms-mirrorM1-collision-refusal-removed.txt`) is **exit 1 — the collision arm FAILS**, i.e. the refusal is the
thing being tested.

## Readings (all at the final revision)

| command | result |
|---|---|
| `bun test ./packages/mpd-agent-teams-plugin` | **295 pass / 0 fail / 2695 expect() / 47 files**, exit 0 (`suite.log`) |
| `bun test …/self-fix-tests/t52-one-plan-format.test.mjs` | 3 pass / 0 fail / 19 expect() (`arms-after.log`) |
| `bun test …/self-fix-tests/registry-context-heal.test.mjs` | 21 pass / 0 fail (`heal.log`) |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 113 regions / 10 adopted files (`registry-check.log`) |
| `bun run verify:docs` | PASS — `carried **113**/10 vs derived 113/10` (`verify-docs.log`) |
| `bun test ./packages/mpd-team-watchdog-plugin` (CROSS-LANE READING) | **139 pass / 0 fail / 684 expect() / 13 files**, exit 0 (`cross-lane.log`) |

`--write-registry` ran in the same change (110 → 113 regions) and the count sentence in
`agent-references/agent-teams-deltas.md` moved with it. Counts that moved: suite 292/2652/46 → 295/2695/47 — the new
arm contributes 3 tests / 19 `expect()`, the remainder is reported as MEASURED, not attributed. NO `test/**` file
was edited. `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json`, `.mpd/plans/**`, `skills/**` untouched;
no repo-wide aggregate; every path-qualified command is `./`-formed with its discovered file count.
