# C7-4 hard-gate case arms — handoff (Deep Worker → the wave's single skills writer)

This directory holds the FIVE C7-4 case arms and their negative controls as CONTENT. The author did NOT
write `skills/**` (AGENTS.md §9, single-skills-writer rule): the bytes here are for the writer to fold into
the standing QA lane `skills/dsh-qa/scripts/team-dispatch-guard.ts`, which already owns the C7-1..C7-3
arms (F8). Nothing else about that case changes.

## Files

| File | What it is |
|---|---|
| `c74-arms.ts` | the arms + their mini-harness, `--self-test` green IN PLACE (see `../c74/case-draft-run.log`), written at this draft's depth (6 levels to the repo root) |
| `run-c74.ts` | the runner that proves the draft in place and writes `result.json` with `--out` |
| `../c74/case-draft-run.log` + `../c74/case-draft-run/result.json` | the observed run produced from THIS draft text |

## The fold (exact)

1. Rewrite every import prefix `../../../../../../packages/` (6 levels) to `../../../packages/` (3
   levels) — the case's home is `skills/dsh-qa/scripts/`.
2. Copy everything from the `── harness ──` banner down of `c74-arms.ts` into
   `skills/dsh-qa/scripts/team-dispatch-guard.ts`.
3. `c74Arms()` is **async** (it drives the real registered tools, whose `execute` returns a promise):
   - `selfTest()` becomes `async`, and the bottom of the file becomes
     `main(process.argv.slice(2)).then((code) => process.exit(code))`;
   - in `selfTest()` and in `main()` append `...(await c74Arms())` to the arm list.
4. Nothing else: `c74Arms()` returns the case's own `Arm` shape and removes every sandbox it created.

Optional (writer's call): the `SKILL.md` row for `team-dispatch-guard` still says the case proves the C7
guards. If the writer wants the row to name C7-4 too, update that ONE sentence in the same `skills/**`
commit. No `cases.json` change is needed — the lane already exists.

## What the arms assert (5 fixes + 8 negative controls = 13)

| Arm | Assertion |
|---|---|
| `f1` | after approval, `create_task` appends to the LIVE APPROVED record with `kind`/`coverageOf`/`sourceTaskId` (read back from disk) |
| `f1-neg-staged-approved` | a staged-and-approved plan still refuses with the exact sentence |
| `f1-neg-no-team` | no staged plan and no live team keeps `no team is staged in this session — call agent_teams_create first` |
| `f2` | a member session whose id IS the recorded `executorRef` closes a row owned by its NAME, `closedBy:"owner"` |
| `f2-neg` | a roster member still cannot close a row it does not own (exact refusal, row untouched) |
| `f3` | the mailbox summary is filtered to the resolved team and labelled `scope:"team"` |
| `f3-neg` | with no resolved team it is labelled `scope:"workspace"` and carries the whole fold |
| `f4` | two mints in the SAME millisecond differ (team and plan), keeping the ms stamp sortable |
| `f4-neg-team` | a colliding TEAM id reddens (`createTeam` refuses an existing id) |
| `f4-neg-plan` | a colliding PLAN id reddens (`archivePlan` refuses an existing archive) |
| `f5` | a forked lead session resolves and closes as lead, and the heal persists (`leadHistory` + `teams.json`) |
| `f5-neg-unbound` | an unbound session with no history is still refused |
| `f5-neg-child` | a recorded DELEGATION CHILD of the lead is NOT healed into the lead history |

## Fixture notes (honest bounds — carry into the PR body)

- ONE stub executor mints `child-<member name>` as the handle; that handle IS the member session's own id
  in these arms, exactly as the record spells `executorRef` on a real spawn.
- The official identity plane is ABSENT (membership answers `undefined`) — the measured condition of every
  defect here, so nothing can pass by reading the official roster.
- The F5 churn arm stamps `header.parentSession` (a seeded fork: parent + depth 0 + NO subagent origin).
  The delegation-child negative control `origin:"subagent"` + `delegationDepth:1` proves captaincy is NOT
  widened to a child.
- The F1 negative control plants a staged-but-approved plan BY HAND: that is the partial-approval state
  (record written, archival skipped) the refusal sentence exists for, not a state a normal run reaches.
- `c74Arms()` is in-process over the bundle's own source (no `dsh` spawn); the durable rows are read back
  from real files in a temp workspace it removes itself.
