# C7 hard-gate case — landing handoff (Guard Engineer → Deep Worker / Lane Q)

Everything needed to land the standing QA case `team-dispatch-guard` is in this directory. The author
did NOT write into `skills/**` (single-skills-writer rule, AGENTS.md §9): the files here are CONTENT.

## Files

| File | What it is |
|---|---|
| `team-dispatch-guard.ts` | the COMPLETE case script, already `--self-test` green and real-lane green (see `lane-run.output.log`) |
| `cases.json-row.json` | the exact lane object to append to `skills/dsh-qa/cases.json` `lanes` |
| `SKILL.md-row.md` | the exact table row to insert into `skills/dsh-qa/SKILL.md` (the `\| slug \| domain \| assertion \| phase \|` table) |
| `lane-run/result.json` + `lane-run.output.log` | the run produced from THIS draft text, over the real team store |

## Landing checklist

1. Copy `team-dispatch-guard.ts` to `skills/dsh-qa/scripts/team-dispatch-guard.ts`. Its relative imports
   (`../../../packages/...`, `./lib/immutable-output.ts`) are already written for that location.
2. Append `cases.json-row.json` to the `lanes` array of `skills/dsh-qa/cases.json`.
3. Insert `SKILL.md-row.md` into the 4-column case table of `skills/dsh-qa/SKILL.md`, after the
   `model-config-live-refresh` row (currently the table's last data row).
4. Run and record: `bun run test:qa` (the `--self-test` sweep), `node scripts/run-qa-lanes.ts --check-drift`,
   and `node scripts/run-qa-lanes.ts --only=team-dispatch-guard` with a FRESH `--out` directory.
5. `skills/**` is the wave's ONE-writer band: land the script + both registrations in the SAME commit as
   the wave's single `VENDOR_LOCK.json` re-pin (AGENTS.md §9/§11).

## Honest bounds (carry these into the PR body)

- **C7-1 is asserted at the PAIRING SEAM.** The mpd-native `agent_teams_dispatch` pass builds BOTH the
  board and the roster from ONE team record, so a cross-team task×member pool is not constructible
  THROUGH the tool; the guard makes the invariant mechanical at `planDispatch`/`pairingRefusal`, which is
  the code that decides every pairing. The tool now tags both sides with the record's `teamId`, so any
  future caller that assembles a workspace-wide pool is refused.
- **The archive arm cannot be "an approved archived plan exists".** Approval ARCHIVES the staged plan for
  EVERY team (`agent_teams_plan {action:"approve"}` → `archivePlan`), so that reading would skip every
  approved team, the live one included (measured over this workspace's own archive: 21 plan directories,
  every live team's plan among them). Only an UNAPPROVED archived plan (discarded or replaced) is
  terminal evidence. The 13 legacy `phase: active` records whose waves ended without an `endedAt` remain
  `live=true`; that residual is recorded, not guessed at.
- **C7-2 fails OPEN when the `mpdRoles` row is absent** (no read-only key → the pairing is left as it was)
  and logs ONE line saying so.
