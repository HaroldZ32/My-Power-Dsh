# W7 — one QA case pinning every surface this refactor introduced

Task T42. Lane: Senior Engineer (this wave's single `skills/**` writer). One new `dsh-qa` case:
`skills/dsh-qa/scripts/surface-pin.ts` + its `SKILL.md` case-table row + a `cases.json` entry.
OFFLINE: no dsh, no credentials, no sandbox, no evidence directory written by the case itself.

## Why a DECLARATION pin

The surfaces this refactor introduced are declarations — a tool's name, its parameter keys, its action
enum, a command's registered name, and the STRUCTURAL KEY NAMES coupling the global-memory archive hook
to three producers. All of them are read from the SHIPPED SOURCE, so the case is a source-level pin and
runs in milliseconds under plain `node` (it reaches no `packages/*/src` module graph). What was missing
was ONE place that reddens the day one of them is renamed away — the M1 defect class, where a
producer-side rename silently turns the hook into a no-op.

## What it pins (all read from the shipped code, not from reports)

1. `mpd_autoproject` exists WITH `scope`; `mpd_ulw` / `mpd_ultrawork` are absent from the WHOLE shipped
   set (D1 — no aliases).
2. `/autoproject` is registered; `/ulw` and `/ultrawork` are not.
3. The five `agent_teams_*` names are unchanged, with the new verbs: `task{context,handoff}`,
   `control{fence,unfence}`, `dispatch{mode,reassign}` (plus its real parameter set —
   `action, task_id, dry_run, limit, mode, reassign`; `sessionId` rides the exec, not the schema).
4. All fifteen `cellwork_*` names survive, including the NEW `cellwork_open`.
5. `mpd_workmate_optimize`, `mpd_workmate_persona_set`, `/workmate-optimize` exist.
6. `mpd_memory_write|read|status` declare `scope`; `mpd_memory_read` declares `offset` and its output
   declares `next_offset` (plus `count`, `offset`, `returned`, `scope`).
7. **THE CROSS-PACKAGE PIN (M1).** The archive hook's contract is asserted on BOTH sides in one process:
   - producer side: `mpd_boulder_complete` → `workId`; `cellwork_stop` → `ok` + `cellId`;
     `agent_teams_plan` (action `delete`) → `archivedTo`; the archived-plan listing → `planId` + `path`
     (optional `approvedAt`/`teamId`);
   - consumer side: the hook really READS `value?.workId`, `value?.ok === false`, `value?.cellId`,
     `value?.archivedTo`, `plan.approvedAt`, `plan.teamId`, `plan.planId`, and its `ArchivedPlanView`
     declares `planId: string` / `path: string`.

## Negative controls (the repo judges a case by these)

`--self-test` drives every predicate against a fixture, then against the SHIPPED tree (which must pass),
then through **EIGHT** mutations, each of which MUST redden:

| # | mutation | expected red |
|---|---|---|
| a | `scope` renamed in `mpd_autoproject`'s parameters | "no longer declares parameter 'scope'" |
| b | `fence` removed from `agent_teams_control`'s enum | "no longer offers action 'fence'" |
| c | an `mpd_ulw` alias tool re-added | "the RETIRED tool mpd_ulw is still declared" |
| d | a `/ulw` command re-registered | "the RETIRED command 'ulw' is still registered" |
| e | `cellwork_handoff` renamed | "cellwork tool cellwork_handoff is missing" |
| f | `value?.workId` renamed on the CONSUMER side | "no longer reads 'value?.workId'" |
| g | `cellId` dropped from `cellwork_stop`'s output (asserting the mutation REALLY applied first) | "no longer declares result key 'cellId'" |
| h | `/workmate-optimize` renamed | "command 'workmate-optimize' is NOT registered" |

Plus two structural self-checks: the fixture exercises the block scanner on a registration whose
DESCRIPTION contains a `}` and a `//` (a naive regex ends the block early), and the SKILL.md case table
must list the case.

## Observed results

| command | result |
|---|---|
| `node skills/dsh-qa/scripts/surface-pin.ts --self-test` | **exit 0** — `[surface-pin self-test] ok: the extractors, the SHIPPED-tree pin, EIGHT negative controls (…) and the SKILL.md case-table row` — `self-test.log` |
| `node skills/dsh-qa/scripts/surface-pin.ts` | **exit 0** — `PASS — every surface the autoproject refactor introduced is declared as the contract fixes it (12 tool surfaces, 2 command surfaces, 15 cellwork names, 4 archive producer keys + 7 consumer reads)` — `case-run.log` |
| `bun run test:qa` | **exit 0** — `[test:qa] all self-tests passed`; the log shows `[test:qa] surface-pin.ts` followed by its ok line, so the runner really picked the case up — `test-qa.log` |
| `node scripts/verify-comment-coverage.ts` | **exit 0 — PASS** (556 files, 50,161 declarations) — `verify-comments.log` |
| `bun run verify:docs` | **exit 0** — `pairs=54 failed=0 violations=0 exempt=24 derived=3 links=505 dead=0 — PASS` (skills/** is outside the doc band; nothing to pair) — `verify-docs.log` |

## Honest bounds

- This is a DECLARATION pin, not a behavioural proof: it says the surfaces are still declared as the
  contract fixes them, never that they behave — behaviour is covered by the packages' own suites and by
  the live QA lanes.
- The scanner is deliberately narrow: it reads `registerTool({…})` / `registerCommand({…})` blocks and
  the two array-driven command shapes. A registration spelled in a way it does not recognise is SKIPPED,
  never guessed at — which is why the case also asserts the SHIPPED tree passes (a skipped surface shows
  up as a missing tool, i.e. red).
- `skills/**` is fingerprinted as one `VENDOR_LOCK.json` tree, so this addition rides the wave's SINGLE
  corpus re-pin at integration (`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`).
- No package source, no `dist/**`, no git actions were performed.
