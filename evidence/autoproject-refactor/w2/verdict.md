# R-W2 — review of the cellwork dedupe and `cellwork_open` (board task T48)

Contract: `.mpd/plans/autoproject-refactor.md` §4.4 **including the 2026-11-02 scoping ruling**, §4.5
(plus §4.8-A6 for the pagination params found on the way).
Judged state: commit **3128fb25** on `feature/autoproject-refactor` (on top of `08d0410b`) — the cellwork
package as COMMITTED, not the working tree. The commit bundles other wave items (`mpd-team-core-plugin`
stage derivation, `skills/**` surface pin, `dist/**`, `VENDOR_LOCK.json`, evidence); they are outside this
subject and are listed under the declined items.
Reviewer: Reviewer (findings only — nothing here was fixed by me).
Reviewed at: 2026-11-02 ~21:53–22:10 (+08:00).

## Assessment (risk level: LOW-MEDIUM)

The dedupe is real and it is done the way the scoping ruling asks: `cellwork_dispatch` keeps its NAME, its
`parameters` and its REPORT, but asks the team plane for exactly one `mode:"owner-only"` pass with the raw
`reassign` forwarded, maps `{pairs, skipped, reassigned}` back into the shape it has always answered, and
turns a plane refusal into its own failure envelope (the blocked-row arm proves the plane's sentence reaches
this boundary). `cellwork_handoff` records the checkpoint through `mpdTeamActions.handoff` FIRST and only
then writes its own document and the cell mirror, so the record — not the cell row — is what a dispatch pass
reads. `caller.ts::seatIn` and `cellwork_supervise` prefer the LIVE team record for a closed seat and fall
back to the cell row, and the disagreement arm (cell row says `member`, record says `checkpoint`) is exactly
the falsifiable proof the brief asked for. The private engine is genuinely GONE: `dispatchOwnerOnly`,
`applyReassignments`, `reassignPairs`, `handleOrNull`, `resolveOwner`, `cellMemberOf`, `dispatchMessageFor`
and the rest have zero occurrences in `src/` (only test comments cite them as provenance), the residue in
`dispatch.ts` is vocabulary + delivery helpers, `state.ts` was never touched (so `.mpd/cellwork/**` v1 still
reads), the 15 tool NAMES are the 14 + `cellwork_open`, the coupling inventory is green (no import grew;
the plane is reached through `ctx.get("mpdTeamActions")` / `ctx.get("mpdTeams")`), the package suite is
176/0, typecheck is 0 and the scoped comment gate PASSes. What holds it back is a read regression the
delegation introduced for the CAPTAIN and a module header that still describes the engine the wave deleted:
`planePressureOf` treats the plane's `unavailable` as an ANSWER, so once a cell has a live team id the
captain — a seat the plane's member lookup can never find — gets nulls where the adapter had real numbers.

## Findings (ranked)

### Medium 1 — the captain's own occupancy is degraded to `unavailable`/nulls once the cell has a team id
- **Where:** `packages/mpd-cellwork-plugin/src/protocol.ts` → `planePressureOf` (accepts
  `provenance === "unavailable"` as a usable answer) used by `cellwork_context`'s execute
  (`planePressureOf(teams(), caller.workspace, caller.cell.teamId, caller.member) ?? dsh.contextPressure(exec.agent)`);
  `packages/mpd-cellwork-plugin/src/caller.ts` → `seatIn` names the captain's member `"captain"`;
  `packages/mpd-team-core-plugin/src/index.ts` → `memberContextOf` answers
  `{usedTokens:null, windowTokens:null, ratio:null, provenance:"unavailable", reason:"no member … on the
  roster"}` for a name the team roster does not hold.
- **What happens:** after activation `cell.teamId` is set and the captain is not a roster row (it is the
  LEAD), so `mpdTeams.memberContext(workspace, teamId, "captain")` answers `unavailable`; because
  `planePressureOf` accepts that provenance, `pressure = plane` and `cellwork_context` reports
  `provenance:"unavailable"` with NULL tokens/ratio and `willCheckpoint:false`. Before the wave the same
  call read `dsh.contextPressure(exec.agent)` and returned the captain's real numbers. The same shape hits
  any seat whose CELL name does not match the team roster (a renamed seat).
- **Why it matters:** `cellwork_context` is documented as the tool for "ANY cell seat", and the captain is
  the seat that runs the cell; the checkpoint threshold is the reason the numbers exist. The degradation is
  presented as an authoritative provenance rather than as "this plane could not identify you".
- **Why the tests do not see it:** `test/team-plane-reads.test.ts` ("cellwork_context reports the PLANE's
  provenance and numbers") stubs `memberContext` to answer FOR `"captain"` with `observed` numbers — the
  real plane's member-only lookup is what makes the captain unanswerable, and no arm uses a plane stub that
  refuses an unknown member.
- **Direction of a fix:** treat only `observed`/`no-window` as the plane's answer and fall through to the
  adapter on `unavailable` (the plane's own reason then cannot silence a real meter reading), or skip the
  plane explicitly for a caller that is not a team member. Add one arm whose stub answers `unavailable`
  for an unknown member.

### Medium 2 — `dispatch.ts`'s module header still asserts the design the wave deleted
- **Where:** `packages/mpd-cellwork-plugin/src/dispatch.ts`, the file header.
- **What it says today:** "This module therefore reimplements the small pairing DECISION inside the cell
  (the captain ratified this; no team-core import), pairs at most one task per member per pass, and reports
  every task it leaves alone… the ONE board write in this module is the explicit `cellwork_dispatch
  {reassign}` repair below."
- **What is true after T45:** the module holds only the shared vocabulary and delivery helpers
  (`nameKey`, `fenceReasonOf`, `contractRelativePath`, `sendThroughExecutor`, the view types). There is no
  decision and no board write in it. A reader — or the next migration step this wave explicitly defers —
  trusts a header that describes the deleted engine, in a file still named after it.
- **Why it matters:** the repo's comment discipline asks a comment to state the contract, and this one
  states the OPPOSITE of the contract; `verify:comments` checks presence, not truth, so no gate catches it.
- **Direction:** rewrite the header to say what the residue IS (vocabulary + the executor delivery helper
  shared by the cell tools) and that the pairing/claim decision is the team plane's.

### Nit 1 — three of the 14 `parameters` blocks are NOT byte-identical (the brief's claim)
`cellwork_context`, `cellwork_supervise` and `cellwork_inbox` gained optional `limit`/`offset` (found by
diffing `a0b27996..3128fb25`); `cellwork_inbox` also reports `more`/`nextOffset`, which is exactly
§4.8-A6 ("default 20 … `more` plus a read pointer"). All 15 NAMES are unchanged. So this is a correction to
the brief's wording, not a defect — but the review's record should not repeat "byte-identical apart from
`cellwork_open`".

### Nit 2 — `cellwork_dispatch`'s skip mapping keeps two dead filters
`protocol.ts` filters `reason !== "already completed"` and `!reason.startsWith("not ready (status ")` out of
the plane's skips. The plane's dispatch vocabulary today has no `"not ready (status …)"` reason (grep of
`team-actions.ts`), and the `"cancelled"` rewrite above it is the live one. Harmless, but a filter whose
stated cause no longer exists is a reader trap; either delete it or name the plane's real reason strings.

### Nit 3 — a handoff now writes two documents with independent ordinals
The plane writes `.mpd/team/handoff/<teamId>/<member>-<n>.md` and the cell writes
`.mpd/cellwork/<cellId>/handoff/<member>-<n>.md`; the directive names the cell's copy. The split is the
declared design (plane = state authority, cell = continuity file), but no surface states the precedence.
Worth one sentence in the package README (W5's scope).

## Declined to judge

1. **`cellwork_dispatch`'s own pairing is gone** — verified: the tool asks the plane for ONE owner-only
   pass, maps the report, journals, and returns the plane's refusal sentence on its failure envelope; the
   blocked-row arm goes through the REAL registered tool.
2. **The inherited `reassign` guard set** — the plane now refuses a fenced/cross-team/read-only target, a
   FAILED or PROVISIONING target, a row whose blockers are unmet, and a non-pending row (`team-actions.ts`
   → `applyReassignments`), so cellwork inherits a STRICTER repair path than its deleted engine had (the
   W1-A review's finding is fixed on the plane).
3. **`applyCheckpoint` no longer writing the cell mode** — the checkpoint CALLER still writes
   `mode:"checkpoint"` on the cell row (`protocol.ts`, the injected-checkpoint branch), and the pre-wave
   `seatIn` also read only `mode`, so the guard's fence is not weakened; the record path additionally fences
   it earlier.
4. **The three pagination additions** (Nit 1) — A6-mandated; `cellwork_inbox` carries `more`/`nextOffset`.
5. **The deleted arms' dispositions** — sampled and verified: the five `applyReassignments` arms' subjects
   are asserted on the plane (`test/team-toolchain.test.ts`, "it refuses an in-progress row, an unknown row
   and a fenced target" / "it claims the row for the target…"), the `dispatchOwnerOnly` arm points at
   `dispatch.test.ts` + `team-toolchain.test.ts`, and TWO arms were added at this tool boundary (the
   blocked-row reassign and the record-vs-cell-row fence).
6. **`.mpd/cellwork/**` v1 reads** — `src/state.ts` is untouched across the whole wave (`git diff --stat
   a0b27996..HEAD -- …/state.ts` is empty); no migration rewrites history.
7. **No cross-package import grew** — the coupling-inventory test passes (2/2); the plane and the roster are
   reached through `ctx.get` service reads, and the adapter import was already frozen.
8. **Co-committed non-cellwork changes** (`team-core/src/stage.ts` + `team-web.ts` + `team-store.ts`,
   `skills/dsh-qa/scripts/surface-pin.ts`, `dist/**`, `VENDOR_LOCK.json`, `evidence/**`) — other wave items
   in the captain's integration commit, each with its own reviewer; not this subject.
9. **`cellwork_open`'s best-effort injection** — the directive is returned as TEXT and `injected:false` is
   reported when the turn seam refuses; that is the documented bound of a tool without
   `invocation.submit`.
10. **The handoff's two documents** (Nit 3) — declared design, no correctness effect observed.

## Verdict

**FAIL — request changes.** The dedupe itself is sound, the deletion is genuine and honestly pointed, the
two new arms are falsifiable and go through the real tool, and every cheap gate is green (176/0 cellwork,
typecheck 0, scoped comments PASS, coupling inventory 2/2); but the plane-first read degrades the CAPTAIN's
own `cellwork_context` to nulls on the normal post-activation path — a behaviour regression against the
pre-wave tool, masked by a stub that answers for `"captain"` — and the module header still describes the
engine this wave deleted. Both are small, scoped fixes (one condition and one comment), after which the wave
is ready.

## Bounds of this review

Read: the frozen plan's §4.4 (incl. the scoping ruling), §4.5 and §A6; the full W2 diff of
`packages/mpd-cellwork-plugin/src/` (activate, caller, index, protocol) plus `src/open.ts` and the
`dispatch.ts` residue; the two commits' cellwork test changes (`cellwork.test.ts`, `team-plane-reads.test.ts`,
`dispatch-cr-repairs.test.ts`, `dispatch-fenced.test.ts`, `dispatch-reassign.test.ts`, `flow.test.ts`
pointers); the plane's `applyReassignments` and its readiness guard; `mpdTeams.memberContextOf`; and the
pre-wave `caller.ts::seatIn` for the regression comparison. Did NOT read: the whole `protocol.ts` (≈1 300
lines) outside the dispatch/context/handoff/supervise/subteam regions, `activate.ts` outside the
frozen-contract append, the flow tools' bodies, the cellwork README pair, or any `dist/` artifact.

Ran: `bun test packages/mpd-cellwork-plugin` (176 pass, 0 fail); `bun run typecheck` (exit 0);
`node scripts/verify-comment-coverage.ts --only packages/mpd-cellwork-plugin` (PASS);
`bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` (2 pass); the
`a0b27996..HEAD` schema-line diff and the `state.ts` untouched check. **No live dsh boot was run inside this
package** — the wave's mount proof is `preset-conformance` and `bundle-lifecycle` (both PASS per the wave's
own record), not the package's own, and I did not re-run them here.
