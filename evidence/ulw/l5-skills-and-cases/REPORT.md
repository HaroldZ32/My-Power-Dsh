# L5 / t7 — skills lane report (gate case re-assertion, new /ulw case, ulw-* host residue)

- Task: `t7` implementation (owner `qa-engineer`), attempt `9`, attempt_id
  `0cc3f96a-7647-4974-9cc5-2307a65eae69`
- Wave: `ulw-commands-and-gate`; lane = the wave's ONLY `skills/**` writer
- Base revision of the measured runs: `5aa222a144e4238b67453731c5decd806db6db94` (`git rev-parse HEAD`,
  unchanged over the 50 s settle window; `session-start.js` sha256
  `4888f69fad5c746432e4f57f0bb62b65da53f4d6dca082f256678ccb9fdbafc8` before and after)

## 1. Deliverables

| # | Deliverable | Status |
|---|---|---|
| 1 | `skills/dsh-qa/scripts/session-start-team.mjs` rewritten THREE-WAY (simple → no team/no notice; soft-complex → NO team + ADVISORY notice naming signals; explicit `team:` → exactly one staged team + provisioning notice) + `lib/gate-probe.mjs` extended to the action mapping (`none`/`advise`/`provision`) with a policy-disabled control | DONE, live run PASS |
| 2 | NEW case `skills/dsh-qa/scripts/ulw-command.mjs` + probe `skills/dsh-qa/scripts/lib/ulw-command-probe.mjs` + SKILL.md rows | DONE, live run PASS |
| 3 | Foreign-host residue removed (S6–S9) | DONE, grep clean |

Touched files (workspace-relative POSIX paths; sha256 recorded below):

    skills/dsh-qa/scripts/session-start-team.mjs
    skills/dsh-qa/scripts/lib/gate-probe.mjs
    skills/dsh-qa/scripts/ulw-command.mjs                     (new)
    skills/dsh-qa/scripts/lib/ulw-command-probe.mjs           (new)
    skills/dsh-qa/SKILL.md
    skills/ulw-plan/references/full-workflow.md
    skills/ulw-research/SKILL.md
    skills/ulw-execute/SKILL.md

No `git` write command, no `VENDOR_LOCK.json`, no `docs/**`, no `AGENTS.md`, no `packages/**`, no `dist/**`.

## 2. Live evidence

### 2.1 `session-start-team` (three-way) — PASS on the FINAL revision

Evidence: `evidence/ulw/l5-skills-and-cases/session-start-team-2026-09-18T01-07-40.004Z/{result.json,output.log,sides/**}`
(an earlier run on the same code path: `…/session-start-team-2026-09-18T01-00-42.487Z/` — both `ok:true`; the earlier one measured the explicit side ACTIVE, the final one measured it ARCHIVED with a recorded `agent_teams_delete` tool call, so both branches of the staged-record assertion are covered by real runs)

- settled hash pinned before/after the 50 s window (revision + `session-start.js` sha256)
- installer row + composed config carry `sessionTeamPolicy` `mode:"off"` + `autoRoute:true`
- SIMPLE (3/3): `stagedTotal=0`, `notice.any=false`
- SOFT-COMPLEX (2/2): `stagedTotal=0` — clause 4, no pre-staging — `advisory=1`, signals `["C"]`
  (`No team was staged`, advisory phrase found in the user-role messages of the harness session log)
- EXPLICIT `team: fix the flaky test` (1/1): `stagedTotal=1` (active+archived), `phase="staged"`,
  `profile="mpd"`, 11 members, 0 spawned, `provisioned=1`, `advisory=0`; in the final run
  `archivedRecords=1` + `archivedByModel=true` (the live model archived the staged team, which the
  notice names as an accepted outcome) and in the earlier run `active=1`, `archived=0`
- NEGATIVE CONTROL (`autoRoute:false` + soft-complex prompt): `teams=0`, no notice, `disarmed=true`
- `assertSessionsSandboxed` green for the main sandbox and every side; every spawn carried an explicit
  sandbox cwd (`sandboxWorkspace`) with sandboxed `HOME`

### 2.2 `ulw-command` (C2/C3) — PASS, with one labelled cross-lane finding

Evidence: `evidence/ulw/l5-skills-and-cases/ulw-command-2026-09-18T00-51-38.756Z/{result.json,output.log,raw/**}`

Gated arm (real boot; the two stale shipped rows replaced by sandbox builds of the SAME canonical
`bun build` command — see finding F2):

- live `commands` registry listing includes `ulw` AND `ultrawork` (with descriptions + `objective` hint):
  `[agent-teams, agent-teams-mpd, compact, feedback, goal, mpd, permission, plan, ultrawork, ulw]`
- empty invocation → `{kind:"error", text:"usage: /ulw <objective> (alias: /ultrawork <objective>) — …"}`
- `/ultrawork qa-ulw-objective-command` → `{kind:"success", text:"ULW activated: qa-ulw-objective-command"}`
- harness session log: `command/run` for `ulw` + `ultrawork`, `command/done` kinds `error` + `success`
- harness session log: a USER-ROLE message carrying the activation directive with
  `OBJECTIVE: qa-ulw-objective-command` and the ordered clauses
  `triage → gate → team(approval="automatic", profile="mpd") → loop → fix on sight → close-out`
  (6 numbered clauses found in order, head sentence "ask the user nothing")
- `stubServed: 7` requests — the boot really reached the model step (local OpenAI-shaped stub; no
  provider credential read or copied, and the stub cannot start a real autonomous run)
- observation: the request header offered 103 tools, none of the 11 equivalence-table RHS names missing

## 3. Findings

### F1 (cross-lane defect, owner L4 `packages/mpd-ulw-plugin/src/index.ts`) — C2.4 gesture path never fires

Measured: `dsh --profile mpd-headless "/ulw qa-ulw-objective-gesture"` → the session log holds the RAW
prompt (one user message), then the runtime-context notice and the `<system-reminder>` skill catalog as
LATER user messages, and **0** occurrences of the directive head. Cause: the gesture listener matches
`/ulw …` against `latestUserMessage(messages)` — the LAST user-role message — which in this composition
is a plugin-injected notice. Fix: match the pattern against the user's own message of the claimed batch
(first user text, or scan every user text). The case records this as `crossLaneFindings[0]` with the
owner + repair and `gating:false`; the arm still fails the case on any OTHER gesture failure. Reported
to the captain in one R1 message (amendment text included).

### F2 (integration-critical, owner t8) — shipped dists are stale and the shipped boot ABORTS

`packages/mpd-ulw-plugin/dist/index.js` lacks `registerCommand` / `ULW_ACTIVATION_DIRECTIVE` /
`usage: /ulw`, and `packages/mpd-dsh-adapter-plugin/dist/index.js` lacks `registerCommand` /
`submitUserTurn`. A boot of the SHIPPED composition therefore fails loud:
`dsh: failed to apply loader entry …: dsh.registerCommand is not a function` (the adapter row provides
`mpdDsh`, so the ULW plugin's apply throws). Both are recorded as `steps.artifact.pendingIntegrationRebuild`
and `steps.shippedComposition` (red, `applyFailure=true`, `gating:false` while the rebuild is pending);
after t8's rebuild the case switches to `source:"shipped"` and that arm becomes gating.

### F3 (case-design correction, mine) — the explicit side must count active AND archived records

The first live run of the rewritten case failed the explicit side because the LIVE MODEL archived the
staged team (`agent_teams_delete`) after reading the provisioning notice — which itself names archiving
as "an accepted outcome". The old assertion (`teams.length === 1` at exit) was therefore model-dependent.
The case now counts `.mpd/team/**/team.json` PLUS `archive/<id>/team.json`, asserts the staged record's
shape (`phase="staged"`, `profile.name="mpd"`, no spawned members), and records `archivedByModel` from the
harness's own `agent_teams_delete` tool call. The re-run measured `stagedTotal=1` (active) and passed.

## 4. Commands run

| Command | Result |
|---|---|
| `node skills/dsh-qa/scripts/lib/gate-probe.mjs` (+ `--self-test`) | exit 0 — SIMPLE→`none`, SOFT→`advise`, EXPLICIT→`provision`, `autoRoute:false`→`none` everywhere |
| `node skills/dsh-qa/scripts/lib/ulw-command-probe.mjs --self-test` | exit 0 |
| `node skills/dsh-qa/scripts/session-start-team.mjs --self-test` | exit 0 (probe + notices + patch + installer + persona + always-advise negative control) |
| `node skills/dsh-qa/scripts/ulw-command.mjs --self-test` | exit 0 (every predicate with a negative control + overlay surgery + shipped directive literal + SKILL.md row) |
| `node skills/dsh-qa/scripts/session-start-team.mjs` (real, evidence-redirected) | exit 0 — PASS, three-way |
| `node skills/dsh-qa/scripts/ulw-command.mjs` (real, evidence-redirected) | exit 0 — PASS on the resolved artifacts |
| `bun run test:qa` | **exit 1 — REPORTED, not green**: stops at `agent-teams-messaging.mjs` → `VENDOR_LOCK skills asset is stale: lock=324/2c039e4c49b9 tree=326/234d58c1a321 (re-pin in the same commit, AGENTS.md §9)`. This lane's two new files make the corpus 324→326, and the wave's SINGLE re-pin is the captain's step (I must not touch `VENDOR_LOCK.json`); the case can only be green after that re-pin. Full output: `test-qa.final.log`. |
| per-case sweep over `skills/dsh-qa/scripts/*.mjs` + `mpd-ext` self-test/validate (does not stop at the first red) | **48/49 exit 0**; the ONLY red is `agent-teams-messaging.mjs`, same vendor-lock reason (`test-qa.self-tests.log`). `session-start-team.mjs` and `ulw-command.mjs` both exit 0. |

## 5. sha256 of the touched files (FINAL revision, measured after the last edit)

        f9fb3f4ffab47c5508855b63e93ba576bf3b0c17a13873066e085dc0a3cfc2be  skills/dsh-qa/scripts/session-start-team.mjs
    5e03eec31c685370da69f75c08c047a8e2c7ce5591e73564372b3924a94add5f  skills/dsh-qa/scripts/ulw-command.mjs
    ac080728790b9100a4136010b7cf52dd27a385be5a50bfb78a0f60c86d1483b8  skills/dsh-qa/scripts/lib/gate-probe.mjs
    02bd398e6784c10ac807d90f7f1b1acbcc99c7ebd8f37cc22dafebff49464e7c  skills/dsh-qa/scripts/lib/ulw-command-probe.mjs
    d7827c42f257d3f1b6c8718346e0e8f90332f988598d13ca8b9c790876540f8f  skills/dsh-qa/SKILL.md
    c82f7f9c0bf96afb1e8a19805554926ef9e742f756907e564f401fe356d8d5c4  skills/ulw-plan/references/full-workflow.md
    182ad90f3b08e84880d3a9fca1e5f19d9b966b29563a6c6da66c1a5f7311c5f2  skills/ulw-research/SKILL.md
    7da4d46b913cf80158b6c8952dc348e0d9aae71d63d1bf1ec6cff97d0a458464  skills/ulw-execute/SKILL.md

## 6. Clause-1 residue check (clause 1 item 4 / S6–S9)

    grep -rn "OpenCode-native\|OpenCode task surface\|teammode\|Stop-hook continuation" skills/   -> no match

Replacements describe this repository's real mechanism only: DSH background jobs (`subagent` +
`job_output`) / `mpd_role_spawn` / the adopted `agent_teams_*` protocol; `DSH team mode through the
adopted agent_teams_* protocol`; `Boulder-ledger resumption across turns (.mpd/boulder.json …
dsh:<session_id>)`. The two `OpenCode/Codex example → DSH tool` equivalence tables are KEPT (the frozen
contract's "explicitly NOT in the clause-1 required set") and their RHS names were positively confirmed
against the real request header (see 2.2).
