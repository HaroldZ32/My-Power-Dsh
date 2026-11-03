# R-W3C — review of workmate auto-binding and `/workmate-optimize` (board task T15)

Contract: `.mpd/plans/autoproject-refactor.md` §4.6 (requirement 4) + the W3-C row of §5 + C5; the
per-wave acceptance text of board row **T12**.
Subject: the uncommitted W3-C diff — `packages/mpd-workmate-plugin/src/index.ts` (+
`test/optimize.test.ts`), `packages/mpd-team-core-plugin/src/team-actions.ts` (+
`test/workmate-binding.test.ts`). The lane's own record: `evidence/autoproject-refactor/w3c/{summary.md,result.json}`.
Reviewer: Reviewer (read-only on the reviewed work — nothing here was fixed by me).
Reviewed at: 2026-11-02 ~19:57–20:15 (+08:00), against the working tree, not a commit.

## Assessment (risk level: MEDIUM-HIGH)

The wave delivers the shape its contract asks for, and delivers it well: a five-step binding table at
`approveTeam` reached only through `dsh.executeTool`, non-fatal on every throw, with the name-free rule
enforced against the plan's own roster and renamed tasks following their owners; `mpd_workmate_optimize`
with a plan table, dry-run default, `confirm`-gated apply, an archive-not-delete destination that cannot
be purged, and a merge that preserves the evolved record (memory deduped by sha256 under the cap, the
longer persona plus one `merged-from` line, uses summed, history accumulated). The new tests are real —
they read the record and the archive back, they prove the refusal of an absent explicit name writes
nothing, and the dry-run arm checks the bytes. I re-ran every gate the lane claims: 69/69 workmate,
521/521 team-core, typecheck exit 0, `verify:comments` PASS repo-wide AND scoped for both packages, and
`SETTINGS_KNOBS` still pins 47 with no `workmates.*` added. What blocks the wave is SCOPE in two places
where the contract names a boundary and the code takes one workspace's view: the merge's in-use gate is
handed only the CALLING workspace, so a workmate a live team in another project is using can be merged
(proved); and the auto-init cap counts the HOME-wide library rather than the contract's per-workspace
budget (proved). A third, smaller defect: a duplicate source in an explicit `pairs` list throws AFTER a
partial apply, from a plan table that had said both rows were mergeable (proved).

## Findings (ranked)

### High 1 — the merge's in-use gate scans ONE workspace, not "any live team"
- **Where:** `packages/mpd-workmate-plugin/src/index.ts` → `optimizeWorkmates` / `planWorkmateMerges` →
  `busyTeams`; the callers that fix the root set are the `mpd_workmate_optimize` tool registration and the
  `/workmate-optimize` command handler **in the same file** (`teamRoots: [dsh.workspaceRoot(exec)]`).
- **What:** the library is HOME-scoped and cross-project, but the tool and the command hand the gate
  exactly one root — the caller's own workspace. The contract says a pair may merge only when neither
  instance is busy in **ANY live team** (`busyTeams`), and `busyTeams` itself documents that its callers
  pass "the union of live session workspaces (GUI path)" for the agentless surfaces.
- **Proved:** `evidence/autoproject-refactor/w3c/probe-busy-scope.log` — a live mpd team record in
  workspace A names `oracle-1`; run from workspace B, the plan says `mergeable:true` and the apply
  reports `applied:["oracle-2->oracle-1"]` with no warning; the same plan with the union
  `[B, A]` correctly answers `reason:"in-use"`. When the in-use instance is the SOURCE, the live
  teammate's workmate disappears from the library, so its final `mpd_workmate_reflect` cannot land.
- **Why it matters:** requirement 4 exists for a user who runs several projects; the one gate the
  contract names to protect a live seat is silently skipped outside the caller's own project, and the
  result is reported as an applied merge.
- **Direction of a fix (described, not applied):** pass the union the file already computes —
  `agentlessRoots(dsh)` (which is `dsh.workspaceRootsAll()` with the single-root fallback) — for both the
  tool and the command. Cross-PROCESS sessions remain a declared bound; say so.

### Medium 1 — the auto-init cap counts the HOME-wide library, not a per-workspace budget
- **Where:** `packages/mpd-team-core-plugin/src/team-actions.ts` → `bindStagedWorkmates`
  (`if (listing.rows.length >= config.max)`).
- **What:** the contract says "library size < `workmates.max` (default 12, **PER WORKSPACE**)". The
  workmate library is HOME-scoped and carries no workspace attribution (`Meta` has no such field), so
  `listing.rows.length` is the whole cross-project library: another project's instances consume this
  workspace's budget, and vice versa.
- **Proved:** `evidence/autoproject-refactor/w3c/probe-cap-scope.log` — a workspace that owns ZERO
  workmates is refused auto-init (`{mode:"none", reason:"cap"}`, zero init calls) because a different
  project left two instances in the library and `workmates.max:2`. The (c) arm cannot see this: it builds
  an empty library.
- **Why it matters:** a multi-project user pays for every other project's instances; the reported reason
  ("cap") is true only of the union. Unreported by the lane and untested.
- **Direction:** attribute an instance to the workspace at init (a `Meta` field written by
  `mpd_workmate_init`, or an index map) and count only this workspace's — or amend the contract to say
  the cap is global. Either way the answer must say which budget it used.

### Medium 2 — a duplicate source in `pairs` throws AFTER a partial apply
- **Where:** `packages/mpd-workmate-plugin/src/index.ts` → `optimizeWorkmates`'s apply loop →
  `mergeOneWorkmate` → `resolveTarget`.
- **What:** the plan is computed before anything moves, so two rows naming the same `from` are both
  `mergeable` at plan time; the first row archives that source, and the second then throws
  `no workmate named "<key>"` (a 404 `WorkmateError`) out of the call, after the first merge landed.
  `assertNotBusy`'s apply-time re-read has the same throw shape, but cannot fire inside one synchronous
  call.
- **Proved:** `evidence/autoproject-refactor/w3c/probe-duplicate-pairs.log` — the dry run's table says both
  rows mergeable; the confirmed call throws, one archive exists, the second pair is silently not applied.
- **Why it matters:** the "A pair refused for live-team use skips ONLY that pair" discipline is not
  extended to a pair that cannot run, and the plan table a caller previewed is not what the apply does.
- **Direction:** reject a repeated `from` while PLANNING (a `duplicate-source` gate, so the dry run is
  honest) and/or catch per row into `skipped`.

### Medium 3 — scope discipline: two out-of-scope existing test files were edited
- **Where:** `packages/mpd-team-core-plugin/test/team-actions.test.ts`,
  `packages/mpd-team-core-plugin/test/goal-todo-bundle.test.ts`.
- **What:** T12 declares `packages/mpd-workmate-plugin/`,
  `packages/mpd-team-core-plugin/src/team-actions.ts`, and a NEW team-core test file for the binding.
  Both edited files are outside that list. The edits are small and NECESSARY (the approval now awaits the
  binding before spawning, so one arm needs a tick; a fixture must answer the workmate tools as absent),
  and both are disclosed in the lane's `result.json`.
- **Why it matters:** the board's write-scope rule is what stops two lanes from colliding in one file; a
  silent widening would be a defect, a disclosed one is a scope amendment the captain must record.
- **Direction:** record the amendment on the board (or extend T12's declared scopes retroactively); no
  revert is warranted.

### Nit 1 — `bindings` is invisible in the approved plan's contract
`agent_teams_plan`'s output schema does not declare `bindings`, and the tool `render` prints only counts,
so a REUSE that RENAMES a seat ("Senior Engineer" → `senior-engineer-1`) is not mentioned in the answer
the captain reads. Reported by the lane as outside its write scope (`src/index.ts` of team-core); the
team-core owner should declare the field and say a seat was rebound.

### Nit 2 — the binding MODE has no durable home
`TeamMemberRecord.mode` is the SEAT mode (`member | checkpoint`), so `reuse|init|none` cannot be stored
there without a team-store type change (out of scope). The `workmate` field IS persisted per seat; the
mode lives only in the approval payload. Reported by the lane; a 4-line additive change for the team-core
owner.

### Nit 3 — the archived plan keeps the STAGED names
`approveTeam` persists and archives `plan`, while the board is built from `buildPlan`; after a binding the
archive's `members[].name`/`tasks[].owner` name the pre-binding seats and `created.members` names the
final ones. Deliberate and reported ("the STAGED plan stays as staged"), and consistent with the archive
being "what was staged, kept" — but W3-D's archive digest must read TITLES, not owners, or it will name
seats that never existed on the board.

### Nit 4 — the "cannot purge" arm asserts a proxy
`test/optimize.test.ts` (e) proves the property by `Object.keys(optimizeWorkmates(...))`, which says the
optimize surface has no purge parameter — true, but the real invariant is that `delete`'s sanitized key can
never name `.archive` (it survives structurally: `.` is stripped, so `.archive` becomes `archive`). The
arm would stay green if that sanitization changed.

### Nit 5 — `workmates.mode|autoInit|max` are documented only in the plan file
No README or docs mention them; the package README pair is W5's declared scope, so this is a hand-off
note, not a defect.

## Declined to judge

1. **A read-only workmate reused under a non-roster name escaping the C7-2 guard** — CHECKED AND
   DISMISSED: the record keeps the member's `role`, and the dispatch roster classifies read-only by role
   as well as by name (`isReadonlyMemberName(member.role, …)` in `runDispatchBody`), so a reused
   `oracle-1` with role `Plan Reviewer` stays read-only.
2. **The approval now awaits before its first write** — a second concurrent approval is refused by
   `approvalsInFlight`; the staging-slot race it opens is pre-existing (spawns already awaited before the
   plan write) and unchanged in class.
3. **Chained `pairs` (`a→b`, `b→c`)** — applies as a cascade and ends with `c` holding both records; not
   judged.
4. **`mergeOneWorkmate`'s target-before-move ordering** — a failure at the move leaves both copies and a
   retry would double `uses`; needs a filesystem failure, and the code documents the order.
5. **Score rounding to 2 decimals before the threshold comparisons** (≤0.005 slack) — display parity with
   the match tool; no measurable effect.
6. **One `mpd_workmate_list` call per approval even when the workmate row is not mounted** — the lane
   documents it as the "no-library" composition; one failed tool call, no log line, no write.
7. **Dist not rebuilt / no MOUNT boot** — the contract puts dist on integration (T-88) and the new
   tool/command schemas are exercised through `apply` in tests; the mount belongs to W1-B/W5.
8. **Package READMEs and the QA skill corpus** — W5's declared scope.
9. **`AGENTS.md` changed under this review** (its git-model section moved to
   `agent-references/git-model.md`); nothing in the W3-C subject depends on the moved text.

## Verdict

**FAIL — request changes.** The acceptance list is met and the merge is faithful to almost every clause,
but the merge's in-use gate is scoped to ONE workspace where the contract says "any live team" (High,
proved with a live team in a second workspace), the auto-init cap is the HOME-wide library instead of the
per-workspace budget (Medium, proved), and a duplicate `pairs` source throws after a partial apply
(Medium, proved) — each is small and each must either be repaired or recorded as a contract amendment
before W2/W3-D build on this surface.

## Bounds of this review

Read: the frozen plan's §4.6/§5-W3-C/C5 and the full T12 contract; the complete W3-C diff of
`team-actions.ts` (binding region), the workmate plugin's new optimization section, the new/edited tests,
the plugin's `Meta`/`sanitizeName`/`wmDir`/`busyTeams`/`inUseCount`/`assertNotBusy`/`assertMutationSandboxed`
helpers and the match tool's output shape; the lane's `summary.md` and `result.json`; the dispatch
manifest's `isReadonlyMemberName`/`pairingRefusal`; and the three probes above. Did NOT read: the whole of
either package (2 000+ line files) outside the diff and the symbols above, `README*.md` pairs, the web
routes, or any `dist/` artifact.

Ran: `bun test packages/mpd-workmate-plugin` (69 pass — `workmate-test.log`), `bun test
packages/mpd-team-core-plugin` (521 pass — `team-core-test.log`), `bun run typecheck` (exit 0 —
`typecheck.log`), `bun run verify:comments` repo-wide (PASS — `verify-comments-repo.log`) and scoped
`--only` for both packages (PASS), `bun test packages/mpd-config-plugin/test/team-models.test.ts` (21
pass — `SETTINGS_KNOBS` 47), and the three probes (`probe-busy-scope.log`, `probe-cap-scope.log`,
`probe-duplicate-pairs.log`). Could NOT run: a real MOUNT boot of the new tool/command (needs a rebuilt
dist and an isolated `DSH_HOME` — integration), a cross-PROCESS live-team scenario (the busy scan can
never see another dsh process), or the Docker lane.
