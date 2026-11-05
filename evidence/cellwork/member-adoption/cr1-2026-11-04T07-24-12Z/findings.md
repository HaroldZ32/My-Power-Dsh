# CodeRabbit round 1 repairs — cellwork member adoption (branch fix/cellwork-member-adoption)

HEAD at repair time: 558bdeb9. Nothing staged, nothing committed, `packages/*/dist` deliberately untouched.

## F1 (Major) — adoption that cannot be persisted is visible, and handoff refuses BEFORE the plane

- `packages/mpd-cellwork-plugin/src/caller.ts` — `CallerContext.adoptionFailure` (new optional field),
  `callerContext` (passes the failure beside the in-memory mirror), `adoptSeat` (now returns
  `{state, failure?}`: unreadable record and a throwing `recordTransition` both carry a sentence naming
  the record path).
- `packages/mpd-cellwork-plugin/src/protocol.ts` — `cellwork_handoff` execute body: refuses right after
  the member-row lookup and before `plane.handoff`, with
  `cellwork_handoff: the cell record could not be written, so this seat ("<name>") was NOT adopted — …`.
- Pin: `test/member-adoption.test.ts` → "B1 repair: an adoption the record cannot persist refuses BEFORE
  the team plane is touched" (a regular file where `split/` belongs makes `writeCell` throw for every uid;
  asserts the refusal text, `plane.handoffs` length 0, and no persisted row). PASS post-fix, FAIL pre-fix.

## F2 (Minor) — a fence that exists only on the TEAM record is cleared through the seam

- `packages/mpd-cellwork-plugin/src/protocol.ts` — `unfenceSeats`: reads the seat through `recordSeat`
  (the same reading `cellwork_supervise` reports), calls `plane.unfence` when the CELL row has no marker
  but the plane reports the seat closed, leaves the CELL row untouched, and answers
  `{member, unfenced, cellRow:"untouched", plane, planeReason?}`. Renderer and the `unfence` /
  `unfenced` schema descriptions updated to match. A member fenced in NEITHER record still answers
  `not-fenced`.
- Pins: `test/dispatch-unfence.test.ts` → "finding 2: a fence recorded ONLY on the TEAM record is cleared
  through the seam, and the CELL row is untouched" (byte-identical cell record) and "finding 2: a
  team-only fence with NO seam is reported as still fenced, and the CELL row stays untouched". Both PASS
  post-fix, FAIL pre-fix.

## F3 (Minor) — merge the unfence write into a FRESH read after the awaits

- `packages/mpd-cellwork-plugin/src/protocol.ts` — `unfenceSeats`: re-reads the cell record after all
  awaited plane calls, merges ONLY the cleared rows into it, and falls back to the pre-await snapshot when
  the read fails.
- Pin: `test/dispatch-unfence.test.ts` → "finding 3: a row written while the plane call is awaited
  survives the unfence write" (the wrapped seam writes a `Reviewer` row mid-await; both rows survive).
  PASS post-fix, FAIL pre-fix.

## F4 (Minor) — exact name match beats the normalized key

- `packages/mpd-cellwork-plugin/src/protocol.ts` — `cellwork_dispatch` execute body, `unfence` target
  resolution: an exact key/`name` match is tried first; the normalized `nameKey` is consulted only when
  it is non-empty.
- Pin: `test/dispatch-unfence.test.ts` → "finding 4: an exact name wins over the normalized key — two
  non-ASCII names never collide" (`工程师乙` cleared, `工程师甲` still fenced, plane called with 乙).
  PASS post-fix, FAIL pre-fix (pre-fix clears 甲).

## F5 (Minor) — docs describe the skip reason the plane actually produces

- `docs/cellwork.md` + `docs/cellwork.zh-CN.md`: the fenced-owner skip reason is the TEAM PLANE's own
  sentence (reported by `cellwork_dispatch`), which names `reassign`
  (`agent_teams_dispatch {reassign:[{task_id, owner}]}`) and NOT `unfence`. Also aligned the adoption,
  `not-fenced` and plane-half wording with the repaired behaviour; `packages/mpd-cellwork-plugin/README.md`
  + `README.zh-CN.md` updated in step.
- Pin: `bun run verify:docs` (bilingual pair, switch link, heading tree, links) — PASS, 55 pairs, 0
  violations.

## Gates (observed, this run)

| Gate | Exit | Result |
|---|---|---|
| `bun test packages/mpd-cellwork-plugin` | 0 | 217 pass, 0 fail, 2486 expect() calls |
| `bun run typecheck` | 0 | `tsgo --noEmit`, no diagnostics |
| `bun run verify:comments` | 0 | PASS — 596 files, 52288 declarations |
| `bun run verify:docs` | 0 | PASS — 55 pairs, 0 violations, 500 links, 0 dead |

Pre-fix falsification: the five new tests were run against `git show HEAD:` copies of `caller.ts` and
`protocol.ts` (files restored afterwards, sha256-verified identical): all five FAILED, exit 1.

## Bounds

- `packages/mpd-cellwork-plugin/dist/` was NOT rebuilt (task order) — `node scripts/verify-dist-fresh.ts`
  would report this package STALE until the captain rebuilds with the pinned toolchain.
- No `bun run verify:gates` / `test:qa` / Docker lane was run (not in the task's gate list; verify:gates
  includes dist freshness, which is red by design until the rebuild).
- Adoption failure is surfaced to `cellwork_handoff` only; `cellwork_context`/`cellwork_status` keep
  answering from the in-memory mirror by design.
- Out-of-scope observation: `seatKey` in `protocol.ts` also derives its mailbox address from the
  ASCII-only `nameKey`, so two non-ASCII seat names share one address; not repaired here.
