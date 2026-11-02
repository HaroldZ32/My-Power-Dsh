# R-W3C repair — HOME-wide in-use gate, per-workspace init cap, duplicate-source plan gate

Repair of `evidence/autoproject-refactor/w3c/verdict.md` (board row T15's FAIL) for board row **T28**.
`dist/` NOT rebuilt; no git command run.

## B1 (High 1) — the merge's in-use gate is HOME-wide

`optimizeWorkmates`/`planWorkmateMerges` share ONE `teamRoots` input. Both call sites that used to hand it
`[dsh.workspaceRoot(exec)]` now hand `agentlessRoots(dsh)` — the union of every live session workspace (or
the env/cwd fallback when the registry is empty):
- `mpd_workmate_optimize`: `teamRoots: agentlessRoots(dsh)`;
- `/workmate-optimize`: the same.
The **cross-PROCESS bound is declared in the COMMENT at each site AND in the `mpd_workmate_optimize`
description**: a live team in another dsh process is invisible to `workspaceRootsAll`, so this gate does
not protect against it.

## B2 (Medium 1) — the auto-init cap is a PER-WORKSPACE budget

Workmate side (`packages/mpd-workmate-plugin`):
- `Meta.workspaces: string[]` — the workspaces the instance has SERVED, most recent first, capped at
  **`WORKSPACE_ATTRIBUTION_CAP = 8`** (the chosen N; bounded so `meta.json` stays a record, not a log).
- `attuneWorkspaces(existing, workspace)` is the ONE write rule (newest first, de-duplicated, capped; a
  blank workspace attributes nothing so an agentless surface invents no owner).
- Written at **init** (birth workspace), and at every **reuse/bind**: `mpd_workmate_spawn`,
  `mpd_workmate_reflect`, `mpd_workmate_persona_set`. The agentless `/plugins/mpd-workmate/init` route
  passes `""` (no session → no attribution).
- `mpd_workmate_list` rows carry `workspaces`, so a consumer can budget per workspace.
Team-core side (`team-actions.ts`, see the AMENDMENT below): `WorkmateRow.workspaces` + the mapping; the
binding pass takes the approving `workspace`; the cap counts
`listing.rows.filter((row) => row.workspaces.includes(workspace)).length`; an instance this pass INITIALIZED
is attributed to the workspace immediately, so the same pass counts it. A legacy unattributed instance
counts NOWHERE until it is reused there — which is the ruling's "an old library cannot block a fresh
project forever". `workmates.max` default stays 12.

## B3 (Medium 2) — a duplicate source is refused at PLAN time, and a pair never aborts the rest

- `planWorkmateMerges`: a `claimedSources` set makes the SECOND row naming a `from` answer
  `reason: "duplicate-source"` — so the dry-run table is honest before anything moves.
- `optimizeWorkmates`'s apply loop wraps each pair in its own `try/catch` and records
  `skipped.push({ from, into, reason: "failed: " + <message> })`. A confirmed call can no longer throw once
  it has mutated anything, and one bad pair cannot drop the rows after it.

The exact sentences:
- plan row: `reason: "duplicate-source"`;
- apply skip: `reason: "failed: mpd_workmate: no workmate named \"<key>\""` (the underlying refusal text);
- cap row (unchanged wording, new meaning): `{ mode: "none", reason: "cap" }`.

## B4 — the scope amendment, ACCEPTED (and one further amendment DECLARED)

Accepted as recorded: the two team-core test files edited by the previous lane stay edited.

**DECLARED FURTHER AMENDMENT (mine):**
1. `packages/mpd-team-core-plugin/src/team-actions.ts` — B2's FIX ("make the cap count …") has no other
   implementation site: the cap lives there, and the workmate package cannot change what that expression
   counts. The edit is additive (row type + mapping + one count + one attribution push + the workspace
   parameter threaded from `approveTeam`, which already had it in scope). No tool name, parameter or
   description moved.
2. `packages/mpd-team-core-plugin/test/workmate-binding.test.ts` — the fixture's `FakeWorkmate` gained an
   optional `workspaces` and its list mapper forwards it, which is the only way the new per-workspace arm
   could be written. No existing arm's expectation changed.

Both are named here because the board's write-scope rule is what stops two lanes colliding; the captain
should record them on T28 exactly as B4 records the earlier pair.

## Gates (command + observed result)

| Command | Result |
|---|---|
| `bun test packages/mpd-workmate-plugin` | **77 pass / 0 fail**, 773 `expect()` calls, exit 0 (`workmate-tests.log`) |
| `bun test packages/mpd-team-core-plugin/test/workmate-binding.test.ts` | **8 pass / 0 fail** (`binding-tests.log`); with `team-actions.test.ts` → 17/17 |
| `bun test packages/mpd-team-core-plugin` | **523 pass / 14 fail** — every failure is in `tool-surface` / `web-*` / `state` / `docker-ui` fixtures, caused by a CONCURRENT in-flight edit to that package's `src/index.ts` (mtime 20:54, changing between my runs: 2 failures at 20:52 → 14 at 20:58). NOT this repair: my two files in that package are green and I touched none of those paths. |
| `bunx tsgo --noEmit` | 2 errors, BOTH in `packages/mpd-cellwork-plugin/src/protocol.ts` (another lane's in-flight edit). ZERO in `mpd-workmate-plugin/**` or in `mpd-team-core-plugin/src/team-actions.ts`. |
| `bun run verify:comments` | 4 violations, ALL in `mpd-cellwork-plugin/src/protocol.ts` and `mpd-team-core-plugin/src/index.ts` (the same concurrent lanes). ZERO in the files this repair touched. |

## The reviewer's three probes, re-run against the shipped code

| Probe | Before (verdict) | After (this repair) |
|---|---|---|
| `probe-busy-scope` | plan `mergeable:true` from B, `applied:["oracle-2->oracle-1"]` | arm "B1: …": plan `mergeable:false`, `reason:"in-use"`, confirmed apply `applied:[]`, source still on disk |
| `probe-cap-scope` | `{mode:"none", reason:"cap"}`, 0 inits, for a workspace owning nothing | arm "(c2)": the same library attributed elsewhere → `mode:"init"`, 1 init; attributed to THIS workspace → `mode:"none"`, `reason:"cap"`, 0 inits |
| `probe-duplicate-pairs` | dry run says both mergeable; confirm THROWS `no workmate named "oracle-2"`, one archive | arm "B3: …": dry run `[true,false]` + `reason:"duplicate-source"`; confirm merges ONE pair, `skipped` carries the duplicate, exactly one archive, no throw |

## Could NOT prove

1. The per-pair `try/catch` has no reachable trigger inside one synchronous call now that the duplicate is
   gated at plan time (`assertNotBusy`'s re-read cannot fire between plan and apply in one call), so the
   catch is DEFENSIVE and is exercised by no arm — stated rather than claimed.
2. The cross-process live-team case is not observable in-process by construction (the declared bound).
3. Both packages' full-suite gates are red from OTHER lanes' concurrent edits; the numbers above separate
   mine from theirs, but a captain re-run after those lanes settle is the authoritative check.
