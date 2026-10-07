# Lane E — the five measured team-tool defects (2026-10-02)

Write scope used: `packages/mpd-team-core-plugin/**`, `packages/mpd-team-watchdog-plugin/**`,
`evidence/team-tools/defects/20261002T152122Z/**`. No git command was run. Plugin code changes are
**invisible to the live session until dsh restarts (T-21)** — every result below is a unit/process
measurement, and the live tool surface was NOT re-checked live.

## What is in this directory

| File | What it is |
|---|---|
| `before-after.ts` | The red→green differential. Drives the SAME scenario twice: against byte-identical copies of the PRE-FIX `dist/` the live session loaded (`before-dist/`, sha256 pinned in `output.log`), and against the fixed `src/`. Every value is judged by the INSTALLED harness (dsh 0.2.0-rc.2: `isJsonValue` + `validateJsonSchemaValue`), i.e. the authority that produced the live failures. |
| `output.log` | Its output — the measured red and green columns, plus the defect-2 mechanism demo. |
| `session-log-quotes.ts` / `session-log-quotes.txt` | The LIVE evidence, decoded from the captain session's own log: the harness refusals, the "not held" answers, and the ARGUMENTS of every `agent_teams_plan action:"create_task"` call. |
| `recon-plan-calls.ts`, `recon-watchdog-*.ts`, `recon-harness-validator.ts`, `measure-surface.ts` | The reconnaissance scripts each finding came from (kept so a reviewer can re-run the measurement instead of trusting the prose). |
| `test-team-core.log`, `test-team-watchdog.log`, `typecheck.log`, `verify-comments.log`, `verify-dist-fresh.log` | The gate outputs, captured on the settled tree. |

## Defect 1 — `agent_teams_plan action:"status"` returned invalid output

**Root cause (two, in `packages/mpd-team-core-plugin/src/index.ts`).**
1. The declared output schema said `plan: {type:"object"}` / `hold: {type:"object"}` while the status
   branch (`execute`, action `"status"`) answers `readPlan(...) ?? null` / `readHold(...) ?? null` for a
   session with no staged plan and no hold. The harness validated the value against the tool's OWN
   schema and refused it: live log seq 154 — `"value.plan" must be an object; "value.hold" must be an object`.
2. With a team record present the branch returned `summary: summariseTeam(record)`, and
   `summariseTeam` (`team-store.ts`) embeds `depths: taskDepths(board)` — a **`Map`**. The harness
   snapshots a tool body's value with its lossless-JSON rule BEFORE the schema check, and a Map is not
   lossless: live log seq 213 — `tool "agent_teams_plan" returned invalid output: value is not lossless JSON`.

**Fix.** The schema now states the nullable shape honestly (`oneOf: [{type:"object"},{type:"null"}]`
for `plan`/`hold`/`team`/`summary`, plus the previously undeclared `team`) — the harness's schema
subset has no `type` arrays, so `oneOf` is the exact-one nullable form. The producer projects the
summary at the tool boundary through the new `losslessSummary(record)` in `team-store.ts` (`depths`
as a plain id→depth record); the `mpdTeams` service keeps the Map, so no consumer changed.

**Measured.** `bun run evidence/team-tools/defects/20261002T152122Z/before-after.ts`:
BEFORE `REFUSED: "value.plan" must be an object; "value.hold" must be an object` → AFTER `accepted`;
BEFORE `REFUSED: value is not lossless JSON` → AFTER `accepted`.
Regression test: `packages/mpd-team-core-plugin/test/tool-output-schema.test.ts` — every action's value
is validated against its own declared schema (a local mirror of the harness's subset walk) AND against
the lossless rule, in the harness's order (lossless first).

## Defect 2 — `session-watchdog-status` returned non-lossless JSON

**Root cause.** Live log seq 218/219: `tool "session-watchdog-status" returned invalid output: value
is not lossless JSON`. The status view (`packages/mpd-team-watchdog-plugin/src/actions.ts`, `STATUS_TOOL`)
is assembled from every reader in the store (durable holds, heartbeat tails, incidents, watermarks,
the predicate's per-session states, the per-knob readings) and crossed the tool boundary raw.

**Fix.** `packages/mpd-team-watchdog-plugin/src/lossless.ts` (`losslessJson`) — a total projection
applied to the whole status value at the tool boundary: Map→record, Set→array, Date→ISO string,
bigint→decimal string, non-finite/`-0`→the values `JSON.stringify` writes, `undefined`/function/symbol
dropped as properties, foreign prototypes and symbol/non-enumerable keys rebuilt away, cycles → null.
Every human-readable field is preserved.

**Measured — and the honest limit.** The installed harness refuses the class
(`raw value with a Map/undefined/-0: REFUSED: value is not lossless JSON`) and accepts the projected
value (`after the boundary projection: accepted (lossless)`). **I could NOT reproduce the live leaf**:
three faithful replays of the pre-fix build (minimal store, real `apply` with the engine/registry, and a
copy of the live workspace's own `.mpd/team` state) all came back lossless under the installed
harness's rule set, so the specific reader that answered non-losslessly in the live process is not
identified. The fix makes that class impossible at the boundary rather than claiming a leaf.
Regression test: `packages/mpd-team-watchdog-plugin/test/status-lossless.test.ts`.

## Defect 3 — dispatch reported a watchdog hold the watchdog did not have

**Root cause.** `packages/mpd-team-core-plugin/src/index.ts`, `watchdogHold`:
`return watchdog.isHeld(record.teamId, workspace) ? \`the team watchdog holds ${record.teamId}\` : undefined`.
The watchdog's `HoldView` is ALWAYS a truthy object (`{held:false,…}` included) — the watchdog's own
documented gate call is `isHeld(teamId, workspace)?.held === true`
(`packages/mpd-team-watchdog-plugin/src/holds.ts`, `HOLD_GATE_CALL`). So EVERY dispatch under a mounted
watchdog refused with a hold nobody had: live log seq 211 `halted: the team watchdog holds
team-20261002150828` while seq 237 answered `not-held` and seq 243 `was not halted`.

**Fix.** The gate now reads ONE authoritative source — the `mpdWatchdog` service — and branches on
`.held === true`, returning the discriminated `WatchdogHoldRead` (`held` / `free` / `not-readable`).
An absent service stays `free` (the watchdog's own stated FAIL-OPEN RULE); a service that answers a
non-boolean `held`, throws, or exposes no `isHeld()` is `not-readable` — reported in the result as
`holdRead: "not-readable: …"` and it does NOT park the team. The workspace `hold.json` and the
watchdog hold remain separate and both stop a pass, each named by its own reason.

**Measured.** BEFORE `HALTED: the team watchdog holds team-20261002153133` (under a `{held:false}`
view) → AFTER `no halt (correct)`. Regression arms in
`packages/mpd-team-core-plugin/test/team-record.test.ts`: held, lifted, absent service, unreadable.
The pre-existing double had modelled `isHeld() => boolean`, which is why the live defect was invisible
to the suite; it now models the real HoldView.

## Defects 4 + 5 — `create_task` dropped `owner` (and `blocked_by`)

**Root cause (one, for both).** `packages/mpd-team-core-plugin/src/index.ts`, action `"create_task"`
read ONLY the nested spelling (`raw.owner`, `raw.blocked_by`). The CALLER sent them BESIDE `task`:
`session-log-quotes.txt` shows 9 of 10 live `create_task` calls with `top owner=…` and one with
`top blocked_by=["W2-T1"]` while `nested owner=undefined`. The value was dropped in silence — no error,
no note — so the board came back `owner: null, blockedBy: []`. (W1's T1 was the one call that used the
nested spelling, and it is the one row that kept its owner — which is exactly the measured
"inconsistent, not merely missing".)

**Fix.** The branch reads both spellings — the nested key wins, the top-level alias is the caller's —
and the top-level `owner`/`blocked_by` are now DECLARED in the tool's parameter schema, so the accepted
shape is discoverable instead of silently ignored. `blocked_by` still resolves subject→id through
`addTeamTask`'s `resolveBlocker`. The context budget arm stays green (4,949 / 5,000 characters) by
keeping the nested shape in the `task` description.

**Measured.** BEFORE `[{"owner":null,"blockedBy":[]},{"owner":null,"blockedBy":[]}]` → AFTER
`[{"owner":"TuiAdapter Engineer","blockedBy":[]},{"owner":"PanelScene Worker","blockedBy":["T1"]}]`.
Regression arms (all five in `tool-output-schema.test.ts`): owner nested + idle, owner given while the
member is busy, no owner (never a `null` owner), and the measured top-level spelling reaching both the
staged plan and the board.

## Item 5 — seam names from Lane D's constants

Lane D's `dshSeamInject(...)` + `DSH_SEAM_*` had landed in
`packages/mpd-dsh-adapter-plugin/src/index.ts`, so both rows now build their `inject` from it:
`dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_COMMANDS)` (team-core) and
`dshSeamInject(DSH_SEAM_TOOLS, DSH_SEAM_AGENTS)` (watchdog). The runtime strings are unchanged
(`["tools","commands"]`, `["tools","agents"]`) — `dshSeamInject` returns exactly the ids passed in.

## Gates on the settled tree

| Gate | Result |
|---|---|
| `bun test packages/mpd-team-core-plugin` | 103 pass, 0 fail (8 files) |
| `bun test packages/mpd-team-watchdog-plugin` | 141 pass, 0 fail (14 files) |
| `bun run typecheck` | no error mentions either package (the repo-wide run still exits 1 on OTHER lanes' files — see `typecheck.log`) |
| `bun run verify:comments` | no violation in either package (the gate's remaining violations are other lanes' files — 1 left in `mpd-tui-adapter-plugin/src/index.ts` at the capture in `verify-comments.log`; a moving number, so read the log, not this row) |
| `node scripts/verify-dist-fresh.ts` | `FRESH packages/mpd-team-core-plugin/dist/index.js sha ee6bc8ac5548…`, `FRESH packages/mpd-team-watchdog-plugin/dist/index.js sha 0b61e1791493…` (the 4 STALE targets are other lanes') |

Rebuild command used, from the repository root:
`bun build packages/mpd-team-core-plugin/src/index.ts --target node --format esm --outfile packages/mpd-team-core-plugin/dist/index.js`
(and the same for `mpd-team-watchdog-plugin`).

## NOT verified

* **The live surface** — plugin code changes need a dsh restart (T-21); no live re-check was possible
  from this lane and none is claimed.
* **Defect 2's exact leaf** — see above: the class is closed and measured, the offending reader is not
  identified.
* **The other lanes' red gates** — `verify:comments`, `verify-dist-fresh` (4 other packages) and
  `bun run typecheck` still fail on files outside this lane's scope; they are reported, not fixed, and
  their counts move as other lanes work — the captured logs are the time-stamped record.
