# S-C — the dispatch-table trap row (T3)

**Writer:** `docs-writer` (Junior Engineer) · **Contract:** `.mpd/plans/restore-acceptance-fix.md` §4 S-C
**Loop:** `loop-20261009T115806-6f91f7` (verifier `lane-verifier`)
**Artifact:** `agent-references/troubleshooting.md` sha256
`5a1c619298e85f8bcc8965fac0a40d94697cfd1ca1fdda9cc9185b0f7901fb08` — **one** inserted row (line 84),
`git diff --stat` reads `1 file changed, 1 insertion(+)`.

**Row text as written** (`agent-references/troubleshooting.md` line 84):

> `agent_teams_dispatch {action:"run"}` skips a task with `reason: "already dispatched to <member>"`, naming
> a member that is NOT on this team (often one from a PREVIOUS wave), and no pass of this session ever
> paired it | `.mpd/team/dispatch.json` is keyed by TASK ID ALONE and lives at the WORKSPACE level, so the
> ledger is shared **across teams**: `DispatchLedger = Record<string, DispatchAssignment>` keyed by
> `taskId`, `assign()` writes `[pair.taskId]`, `release()` deletes by `taskId`, and neither the key nor the
> path carries a team dimension (`packages/mpd-team-core-plugin/src/dispatch.ts`,
> `packages/mpd-team-core-plugin/src/index.ts`). A new team whose board reuses `T1..Tn` therefore INHERITS
> the old team's pairs, and `reconcile()` — run at the top of `run` against the CURRENT board — prunes only
> an entry whose task is ABSENT or `completed`, so a live, non-terminal `T1` keeps its stale pairing and
> `planDispatch` skips it `already dispatched to <memberName>`. Recorded instance rather than inferred: the
> previous wave lost a stream's dispatch this way until the stale id was found
> (`.mpd/plans/restore-three-capabilities.md`, "Platform traps" item 1, carried forward in
> `.mpd/plans/restore-acceptance-fix.md` §9 item 1). Remedy: release the stale pairing BEFORE dispatching —
> `agent_teams_dispatch {action:"release", task_id:"Tn"}` answers `{ released: true }`, and
> `{ released: false }` when that id was never dispatched (a no-op, never an error) — then dispatch again. |

## Evidence (`evidence/restore/acceptance/sC/output.log`)

- `bun run verify:docs` → **exit 0**, `pairs=47 failed=0 violations=0 exempt=24 derived=3 links=434 dead=0 — PASS`.
- Table shape: `awk` over lines 83-86 → every neighbour row reports `pipes=3`, so the inserted row keeps the
  2-cell shape and did not break the table.
- Every mechanism sentence is quoted from source in the log:
  `DispatchLedger = Record<string, DispatchAssignment>` (dispatch.ts:84) ·
  the skip string `already dispatched to ${…memberName}` (dispatch.ts:181) ·
  `assign()`/`release()` keyed by `taskId` (dispatch.ts:229-254) ·
  `reconcile()` pruning only `task === undefined || task.status === "completed"` (dispatch.ts:258-274) ·
  `const pruned = reconcile(readLedger(workspace), tasks)` (index.ts:1093) ·
  `dispatchPath = (workspace) => join(workspace, ".mpd", "team", "dispatch.json")` (index.ts:187).

## Bounds

- `verify:docs` does **not** discover `agent-references/**` (AGENTS.md §3: the agent-facing band is
  deliberately outside the bilingual discovery), so a red there could never have been the S-C evidence.
  The gate is recorded because the contract asks for it; the row's real checks are the table-shape
  assertion and the source reads above — both in the log.
- `AGENTS.md` was **NOT** edited, so §4 S-C criterion 3's instruction-budget re-measure is not owed. The
  reason: no manual sentence is contradicted — §12 line 592 already lists "agent-teams dispatch defects"
  among the topics that table covers, so the new row makes that sentence more true; §5 rule 5 says only
  that `agent_teams_dispatch` pairs a ready task with its declared owner, which the trap does not contradict.
- The row's "recorded instance" clause cites the previous wave's artifacts rather than a measurement made
  by this writer.
