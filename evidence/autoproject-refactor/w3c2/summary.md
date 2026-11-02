# W3-C2 — persist the workmate binding mode + declare/render the approval bindings

Lane: Senior Engineer (board row T21). Closed the two gaps W3-C could not reach because the files were
outside its scope. Additive only: no existing field renamed, no existing output key removed.

## GAP 1 — the binding MODE is now a record field

`packages/mpd-team-core-plugin/src/team-store.ts`:
- `export type WorkmateBindMode = "reuse" | "init" | "none"` — deliberately NOT `TeamMemberMode`
  (`member` | `checkpoint`); the comment says so, so nobody overloads the seat mode later.
- `TeamMemberRecord.workmateMode?` + `.workmateReason?`; the same two on `MemberPatch`.
- `updateTeamMember` writes them, with ONE documented rule: a `reuse`/`init` patch CLEARS a stale
  `workmateReason`, so a bound seat never keeps "cap" beside it; a patch naming neither field leaves
  both alone (additive, never a reset).

`packages/mpd-team-core-plugin/src/team-actions.ts`: the approval's binding loop now writes
`workmateMode` for EVERY seat (including `none`) plus `workmateReason` when the pass recorded one, so
the decision is durable rather than only reported in the answer.

## GAP 2 — the answer is DECLARED and RENDERED

`packages/mpd-team-core-plugin/src/index.ts`:
- the approve output schema declares `bindings: { type: "array", items: { type: "object" } }` (the
  payload carried the field since W3-C; the schema did not), and
- the approve `render` prints one line per seat — `  impl — reuse: impl-1`, `  three — none (cap)`.

## Observed results

| command | result |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **exit 0 — 536 pass, 0 fail** (35 files, up from 521/34) — `team-core-tests.log` |
| new arms (6) | `workmate-binding.test.ts`: `updateTeamMember` round-trip + stale-reason clearing; the approval persists `workmateMode` for reuse/init AND `none`+`reason:"cap"`. `workmate-binding-status.test.ts`: `agent_teams_plan {action:"status"}` reports `workmateMode`/`workmateReason`/`workmate`; the approve output schema declares `bindings`; an approval answer carries them and the render prints one line per seat |
| surface budget | **RE-MEASURED 6,379 / 6,400** (21 chars headroom) — UNCHANGED, because `costOf` charges name+description+parameters and the additions are an output schema + a render. Recorded in the budget arm's comment chain; the arm passes — `measure-surface.ts` |
| `node scripts/verify-comment-coverage.ts` | **exit 0 — PASS** (552 files, every declaration documented and fully typed) — `verify-comments.log` |
| `bun run typecheck` | **exit 1** with 4 errors, ALL in `packages/mpd-workmate-plugin` (3 in `src/index.ts`, 1 in its test) — ANOTHER lane's in-flight versioned-persona work (`personaRevision`/`personaHash`/`baseRevision`); **zero in this task's four files** — `typecheck.log` |

## What I could not do

- **The WEB payload does not carry the binding fields yet.** `team-web.ts`'s `TeamWebMember` is an
  explicit whitelist and `team-web.ts` is outside this task's write scope; `agent_teams_plan
  {action:"status"}` DOES report them (the record is served verbatim), so the requested
  "status/the web payload" arm is satisfied through `status`. Adding the two fields to `TeamWebMember`
  is a one-line change for whoever owns `team-web.ts`.
- `bun run typecheck` is red for another lane (above); it is not caused by this change.
- No dist rebuild, no git, no `skills/**`, per the task's hard rules.
