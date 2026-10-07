# Team-build feature test — observed behaviour and defects

Run: 2026-10-06 ~13:49–13:53Z, workspace `/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`.
Request under test: "你创建一个队伍" (create a team) for the TUI DAG-port wave.

The captain exercised the full documented path: `agent_teams_plan create` → 7 × `add_member` →
10 × `create_task` → `approve`. Everything below is what was OBSERVED, with the command that
produced it.

## What worked

- **Staging is inert, as documented.** `create` + `add_member` + `create_task` produced
  `plan-20261006134910 (staged): 7 member(s), 10 task(s)` and spawned nothing.
  `list_agents` still showed only `lead` while the plan was staged.
- **Approval is what executes.** `approve` returned
  `approved plan-20261006134910: 7 member(s), 10 task(s)` and created
  `.mpd/team/teams/team-20261006135108.json` with `phase: "active"`, all 7 members
  `status: "running"`, and tasks `T1`..`T10` owned exactly as staged.
- **Members are real and self-directing.** All seven started work from their instantiation prompts.
  Measured within ~90 s: `fidelity-verifier` wrote a real baseline gate log
  (`evidence/tui/dag-port/verification/20261006T135211Z/gate-bun-test-tui-plugin.log`, 15 passing
  assertions); `visual-reviewer` created its evidence dir; `doc-scribe` sent a BLOCKED message
  refusing to fabricate documentation for files that do not exist yet — correct behaviour, not a
  failure.
- **The native executor spawns members that are addressable.** `agent_teams_mail send` to a member
  by name returned a message id and the member answered in a later turn.

## DEFECT 1 — the dispatcher pairs ready tasks to idle members POSITIONALLY, ignoring `owner`

**Severity: high.** A task can be handed to a member that is not its owner.

Evidence — `agent_teams_dispatch { action: "run", dry_run: true }` printed:

```
REQUIREMENT: freeze the acceptance contract ... -> dag-geometry
WORK: the adaptive vertical DAG layout engine (dag-layout.ts) -> panel-surface
WORK: the independent dag + workmate sidebar pages ... -> tui-visuals
WORK: redesign the whole mpd-tui surface layer ... -> seam-guard
WORK: ROOT-CAUSE why the existing team sidebar panel was invisible (R13) -> fidelity-verifier
```

every line is OFF BY ONE against the staged ownership recorded in
`team-20261006135108.json`, which is correct:

| Task | Staged owner | Dry-run paired to |
|---|---|---|
| T1 REQUIREMENT | `lead` | `dag-geometry` |
| T2 dag-layout | `dag-geometry` | `panel-surface` |
| T3 panels | `panel-surface` | `tui-visuals` |
| T4 visuals | `tui-visuals` | `seam-guard` |
| T5 visibility root-cause | `seam-guard` | `fidelity-verifier` |

The pairing walks the ready-task list and the idle-member list in lockstep and never consults the
task's own `owner`. The most telling line is the FIRST: a task owned by `lead` was offered to a
teammate. **Consequence in this run: the captain did NOT execute the dispatch; every member worked
its own staged charter instead.** Had `run` been executed without the dry run, five members would
have received another member's work — with overlapping write scopes, which the wave's whole
one-writer-per-file partition is built to prevent.

## DEFECT 2 — staged `blocked_by` refs are stored un-remapped and the board ids never match them

**Severity: medium (unresolvable ambiguity).**

`create_task` accepted `blocked_by: ["2"]` and the staged plan stored it verbatim. After approval
the record holds:

- board task ids: `T1`, `T2`, … `T10`
- `blockedBy` values: `["2"]`, `["2","3","4","6"]`, `["7"]`, `["2","3","4","5","6"]`, `["7","8","9"]`

So every dependency names a string that is NOT any task id on the board. Two readings are possible
and the record cannot distinguish them (both give the same ready-set in this run, so the dry run
does not disambiguate either):

1. the refs are 1-based POSITIONS into the plan's task list, resolved at dispatch time — in which
   case they are correct by accident here (position N == id `TN`) and would silently mis-resolve the
   day a task is inserted or reordered; or
2. the refs are ids, in which case every dependency is DANGLING and nothing downstream is actually
   gated by its prerequisites.

Either reading is a trap. Recommendation: store resolved board ids at approval, or reject a
`blocked_by` that does not name a task in the same plan.

## DEFECT 3 — the official board tools and the plan's board are different boards

**Severity: medium (tool-surface contradiction).**

- `agent_teams_plan { action: "status" }` → `plan (none) · members 7 · tasks 10 · hold none`
  (the plan is no longer "staged", and the members/tasks are visible).
- `team_task_list` → `{"tasks": []}` — EMPTY, while 10 tasks exist.
- `team_task_get { task_id: "T6" }` → `Error: team task "T6" not found`.
- `list_agents` → only `{"target":"lead", ...}` — the 7 running members are absent.
- `agent_teams_mail { action: "summary" }` reported members from a DIFFERENT, older team
  (`ToolDefects Engineer`, `Independence Engineer`, `TuiAdapter Engineer`).

The plan/task tools that a captain is told to use for the board cannot see the tasks the plan
created, and the roster tool cannot see the members it spawned. Worked around here by reading the
record file `.mpd/team/teams/team-20261006135108.json` directly. This is consistent with the
documented team-plane split (the MPD team record is authoritative, the official calls are the
fallback), but the CAPTAIN-FACING tools were not updated with it.

## Captain's operating decision for this wave

Given defects 1–3: **no automated dispatch**. Each member works the staged charter carried in its
instantiation prompt; the captain pairs work by hand via `agent_teams_mail` and reads
`.mpd/team/teams/team-20261006135108.json` plus the artefacts on disk as the progress record.
That is a workaround for this run, not a fix — the three defects above stay open.
