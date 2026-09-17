# wave-2b lane A (`t27`) — the three PRODUCT-SHAPED rows: T-13 · T-27 · T-44

**Task:** `t27` (impl-A/2, attempt `e7ff83cc-68e6-4c02-a0e9-7ae371542aaf`), lane A's remaining product rows
after plan **AMENDMENT A3** (implement all four product-shaped changes; none may be closed by rule).
**Verify (contract):** `bun test ./packages/mpd-agent-teams-plugin` → **269 pass / 0 fail / 2356 expect()
calls / 40 files, exit 0**.

**Instrument for all three rows:** `packages/mpd-agent-teams-plugin/self-fix-tests/wave2b-laneA-product-rows.test.mjs`
(sha256 `549e7dd6fd720ec24d7baba7a0fe44e42d60d81c71e590aa3e43e7799aa756a7`). Every arm drives the REAL
registered tool through its `execute` boundary against a real team record on disk; no arm asserts a
hand-built value.

## 1. Both readings, kept (the discipline the acceptance names)

| side | revision of `lib/` | driver reading | file |
|---|---|---|---|
| **BEFORE** | `HEAD` (`git archive HEAD packages/mpd-agent-teams-plugin/lib`) — `tools.js` `6021bf6d…`, `types.js` `c1d82db9…`, `scheduler.js` `4b824797…` | **exit 1 — 1 pass / 2 fail**: T-13 RED (`TASK_KINDS` does not contain `deferred`), T-27 RED (`task "t1,t2,t3" does not exist …` — the list is read as ONE id), **T-44 PASS** | `arm-before.out.txt` |
| **AFTER** | worktree — `tools.js` `13ca360f…`, `types.js` `8f5fa76f…`, `scheduler.js` `405d4e36…` | **exit 0 — 3 pass / 0 fail** | `arm-after.out.txt` |

The BEFORE side was re-taken with the FINAL driver text against a `git archive HEAD` reconstruction of
`lib/` (with `_deps` linked) so the two sides differ by the fix and nothing else: the scratch root was
created and deleted inside one bash call (this harness gives each bash call a fresh `/tmp`, AGENTS.md
T-23).

**T-44 is green on BOTH sides, and that is the finding, not a gap:** its DELIVERABLE already exists in
`HEAD` — `agent_teams_approve` is registered, captain-only, and `lib/index.js`'s Web route calls the
SAME runtime (`approveStagedTeam`) the tool calls. The row is therefore closed by MEASURING the reading
the acceptance names (a text-surface approval of a staged team; the resulting record identical to the
panel path's transition; a non-captain refused with a reason), not by a code change dressed up as one.

## 2. What each row now measures

**T-13 — a `deferred` kind that never dispatches.** `lib/types.js` gains `mpd-delta deferred-kind`
(`NON_DISPATCHABLE_TASK_KINDS` + `isNonDispatchableKind()`, and `TASK_KINDS` gains `deferred` — the
region that makes `types.js` the TENTH adopted file). THREE dispatch surfaces had to agree, because a
readiness-only filter would have left the row's claim false:
1. `lib/scheduler.js` `isTaskReady` (inside `mpd-delta ready-task-predicate`) — the PUMP never offers it;
2. `lib/tools.js` `claim_task` (`mpd-delta deferred-claim-refusal`) — a seat cannot CLAIM it by name;
3. `lib/tools.js` `reassign_task` (`mpd-delta deferred-reassign-refusal`) — a captain cannot DISPATCH it
   (reassignment wakes the member with the assignment prompt);
plus the two allowance predicates (`mpd-delta deferred-allowance`): a seat holding only a parked record
is still eligible.
Arms: `isTaskReady(deferred) === false` **while its kind-less twin is true** (the negative control), the
claim of the deferred task is refused naming the kind **while the twin is claimed**, the status view
renders `kind: "deferred"`, and a captain holding ONLY a deferred task still takes over another task.

**T-27 — the contract tool reads N contracts in one call.** `mpd-delta task-contract` (modified in
place): a comma-separated list in the existing `task_id` returns `{requested, contracts, unresolved}`,
every resolved contract being the SAME `taskContractView` the single-id call returns, and an id with no
task reported AS ITSELF in `unresolved`. Empty entries and the empty batch are refused loudly. The batch
renderer lives in `mpd-delta task-contract-render`. Arms: 3 contracts in one call all attributed; a
missing id named and not dropped; a one-id call deep-equal to the single-id call AND every element of a
multi-id batch deep-equal to its own single call (the shape control in both forms); `"t1,"` and `""`
refused.

**THE DESIGN DECISION, AND THE REJECTED ALTERNATIVE (measured):** the first implementation declared a
NEW `task_ids` array parameter. That turned `test/task-contract-tool.test.mjs`'s read-only-surface pin
`Object.keys(tool.parameters.properties)).toEqual(["task_id"])` RED — and `test/**` is NOT in this lane's
write set (the `test/**` hop is granted to t29, bounded to T-92's absence-pin assertions). Rather than
request a hop for a pin whose INTENT (the contract surface takes exactly one read-only argument) my
change does not violate, the batch rides ON that one parameter as a comma-separated list. Measured cost
of the array form, kept as the record of why: `bun test ./packages/mpd-agent-teams-plugin` went
**266 pass / 3 fail** — the read-only-surface pin above, the `t41` pin below, and my own T-44 comparison.
A second, independent coupling was exposed by the same run and FIXED IN SCOPE: the `t41` falsification
arm neutralises the literal `(known tasks: ${known || 'none'})` in a scratch copy of `lib/tools.js` and
asserts BOTH refusal paths report the neutralised text; my batch branch had DUPLICATED that literal, so
`String.replace` (first occurrence only) neutralised the wrong one. The fix single-sources the sentence
in `unknownTaskText(team, id)`, used by the single-id refusal and the batch `unresolved` entry alike —
the pin binds both paths again, and the suite is green.

## 3. Registry family — one change, count cited by row id + region ids + sha (never inherited)

- five NEW regions: `mpd-delta deferred-kind` (`lib/types.js`), `mpd-delta deferred-kind-import`,
  `mpd-delta deferred-allowance`, `mpd-delta deferred-reassign-refusal`,
  `mpd-delta deferred-claim-refusal` (`lib/tools.js`);
- three MODIFIED in place (ids unchanged, blocks re-registered): `mpd-delta ready-task-predicate`
  (`lib/scheduler.js`), `mpd-delta task-contract`, `mpd-delta task-contract-render` (`lib/tools.js`);
- `node scripts/patch-agent-teams-fixes.mjs --write-registry` → **93 regions across 10 adopted files**
  (`--check` exit 0, `registry-check.log`); registry revision `lib/mpd-deltas.js`
  `6915cd8ba924ea3daa9c20ab250ae4cabd30264bd7ecbe882b70ea27f3ae18b0`;
- the count sentence in `agent-references/agent-teams-deltas.md` (`4fd1ef5c…`) moved in the SAME change
  (88/9 → **93/10**) with the t27 provenance clause, and the derived arm reads true:
  `bun run verify:docs` → **exit 0, PASS**, `carried **93**/10 vs derived 93/10` and the D-range claim
  `A1–D42` unchanged (adding REGIONS does not move the derived value — the captain's ruling);
- **two regions with the same id in one file** must be avoided, and a region NESTED inside another is
  invisible to the registry scanner: the batch code was first wrapped in its own marker INSIDE
  `mpd-delta task-contract` and `--write-registry` reported 93 while the nested id never appeared. The
  markers were removed; the lesson is recorded rather than smoothed.

## 4. Bounds — what this task did NOT do

- **No repo-wide aggregate was run** (the forbidden five: `verify:gates`, `test:qa`, `test:qa:all`,
  `verify-dist-fresh`, `typecheck`; also no `verify-vendor`/`verify-pack-closure`) — left to integration.
- `packages/*/dist/**`, `dist/mpd-package/**`, `VENDOR_LOCK.json` and `.mpd/plans/**` are UNTOUCHED; the
  plugin ships `lib/`, so no rebuild is involved.
- **No `test/**` write and no hop requested**: the batch was redesigned to keep the pin that lives there.
- **T-44's panel path is exercised through the runtime function the Web route calls**
  (`registerAgentTeamsTools(...).approveStagedTeam`), not by booting the HTTP route; the record
  comparison therefore normalises the three per-run fields (`approvedAt`, `updatedAt`, `attemptId`) to
  TYPE TOKENS so presence and shape are still asserted while the instance values are ignored.
- **T-11 is explicitly NOT claimed here** (its own task), and the schema/contract cluster
  (T-08/T-14/T-15), the state/plan rows (T-06/T-42/T-92/T-93) and the `test/**` hop remain other tasks'.

## 5. Files

`lib/types.js`, `lib/scheduler.js`, `lib/tools.js`, `lib/mpd-deltas.js` (regenerated),
`agent-references/agent-teams-deltas.md`, `self-fix-tests/wave2b-laneA-product-rows.test.mjs`, and this
evidence directory (`arm-before.out.txt`, `arm-after.out.txt`, `suite-plugin-after.log`,
`registry-check.log`, `gate-verify-docs.log`).
