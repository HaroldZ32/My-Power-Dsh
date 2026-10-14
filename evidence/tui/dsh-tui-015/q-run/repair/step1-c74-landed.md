# STEP 1 — the C7-4 case extension landed in `skills/dsh-qa/scripts/team-dispatch-guard.ts`

Writer: Lane Q (the wave's single `skills/**` writer). No `packages/**` path was touched.

## What changed

| Path + symbol | Change |
|---|---|
| `skills/dsh-qa/scripts/team-dispatch-guard.ts` — imports | added `apply` (`mpd-team-core-plugin/src/index.ts`), `send as sendRawMail` (`mailbox-store.ts`), `archivePlan/newPlanId/stagePlan/writePlan/type StagedPlan` (`plan-store.ts`), `createTeam/newTeamId` (added to the existing `team-store.ts` import) |
| `.../team-dispatch-guard.ts` — `Tool`, `HeaderOpts`, `LEAD`, `NOW`, `Harness`, `harness()`, `approveTeam()`, `handleOf()`, `statusOnDisk()`, `refusalOf()`, `c74Arms()` | folded from `evidence/tui/dsh-tui-015/guard/case-draft/c74/c74-arms.ts` (everything from its `── harness ──` banner down, plus the four shared declarations above it; the draft's duplicate `Arm` interface and its imports were NOT copied — the case already declares both) |
| `.../team-dispatch-guard.ts` — `selfTest()` | now `async`; arms = `[...arms(), ...(await c74Arms())]` (17) |
| `.../team-dispatch-guard.ts` — `main()` | now `async`; real-lane arms = `[...arms(), ...lane.arms, ...(await c74Arms())]` (21) |
| `.../team-dispatch-guard.ts` — module footer | `main(process.argv.slice(2)).then((code) => process.exit(code), (error) => exitOnRefusal(error, SLUG))` |
| `.../team-dispatch-guard.ts` — header comment | names the C7-4 fold and cl. (e) |
| `skills/dsh-qa/SKILL.md` — `team-dispatch-guard` row | names the thirteen C7-4 arms |

The fold is EXACTLY the HANDOFF recipe: the draft's import prefix `../../../../../../packages/` (6 levels) was rewritten to `../../../packages/` (3 levels), the harness block copied verbatim, and the two functions made `async` with `...(await c74Arms())`.

## Commands and observed results

```
$ bun skills/dsh-qa/scripts/team-dispatch-guard.ts --self-test
... 17 lines, all `ok`
SELF-TEST: PASS (17 arms: 4 C7-1..C7-3 seam assertions + 13 C7-4 arms incl. their negative controls)
exit=0
```

```
$ bun skills/dsh-qa/scripts/team-dispatch-guard.ts --out evidence/tui/dsh-tui-015/guard/c74/lane-run-landed-20261014T094505Z
(a) (b) (c) (d) green; (b-real) (d-real) (c-real) (registry-real) green;
(f1) (f1-neg-staged-approved) (f1-neg-no-team) (f2) (f2-neg) (f3) (f3-neg)
(f4) (f4-neg-team) (f4-neg-plan) (f5) (f5-neg-unbound) (f5-neg-child) green
evidence -> evidence/tui/dsh-tui-015/guard/c74/lane-run-landed-20261014T094505Z
exit=0
```
Evidence: `evidence/tui/dsh-tui-015/guard/c74/lane-run-landed-20261014T094505Z/{result.json,output.log}`

```
$ bun run test:qa            # before the STEP-2 lane edits — re-run after them (see step3-gates.md)
[test:qa] all self-tests passed
exit=0
```

```
$ bun run typecheck          # tsgo --noEmit
exit=0
$ bun run verify:comments
VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.
exit=0
```

## Registration

`node scripts/run-qa-lanes.ts --list` prints
`team-dispatch-guard	lane	all	skills/dsh-qa/scripts/team-dispatch-guard.ts`
(no `cases.json` change was needed — the lane already exists).

## Honest bounds (carried from the draft's HANDOFF)

- C7-1 is asserted at the PAIRING SEAM (`planDispatch`/`pairingRefusal`); a cross-team task×member pool is not constructible through `agent_teams_dispatch`, which builds both sides from ONE record.
- The archive arm cannot be "an approved archived plan exists": approval ARCHIVES the staged plan for every team. Only an UNAPPROVED archived plan is terminal evidence.
- C7-2 fails OPEN when the `mpdRoles` row is absent (no read-only key → the pairing is left as it was) and logs one line saying so.
- The C7-4 arms run in-process over the bundle's own source (a stub executor + stub adapter, no `dsh` spawn); the official identity plane is ABSENT in them, which is the measured condition of the defects they pin.
