# Wave 3 frozen contract — re-split, hardening, QA cases, docs

Frozen: 2026-10-26T09:58:00Z · owner: captain · basis: `.mpd/plans/cellwork.md` §4.10, §7 and the
Wave-2 verifier's T6 low finding.

A Wave-3 verifier works from THIS contract, the plan, the package README and the documentation band —
never from `packages/mpd-cellwork-plugin/src/**` or `skills/**` before a FAIL is recorded.

## C1 — Re-split path (work)

A requirements `update` must be able to change an ALREADY-ACTIVATED cell's plan without recreating the
team:

- the splitter re-runs and emits a new revision; acceptance records it and marks the previous revision
  superseded;
- `cellwork_activate` on a stale split is REFUSED unless the caller passes the revision explicitly;
- adding work uses the LIVE team record (`agent_teams_plan add_member` / `create_task`): members are
  added with persona text, tasks carry their verification partner, and the verify loop opens before
  dispatch, exactly as the first activation;
- work that the new revision drops is marked `cancelled`, never deleted; the team id and the cell id do
  not change;
- the same split task is re-dispatched (Amendment 5a), not duplicated.

**Arms required:** a second activation adds tasks/members on the SAME team; a removed task becomes
`cancelled`; a stale split without an explicit revision is refused; a revision-mismatched submission is
refused with a teaching message.

## C2 — Hardening closed (work)

The T6 low finding becomes required arms and/or README sentences:

1. the compaction barrier's `busy` and `error` outcomes after the retry budget are classified and
   journaled (the existing arm names only `null`);
2. mail addressing is exercised for a member name, `captain`, and a cross-subcell recipient, and the
   journal carries the `cell:<cellId>` stamp;
3. an UNDELIVERED mail row is surfaced by `cellwork_supervise` (not only the pending board).

## C3 — QA case: live command (`skills/dsh-qa/scripts/cellwork-command.ts`)

- Ships with `--self-test` (including a negative control) and a SKILL.md case-table row.
- Boots an isolated `DSH_HOME` + `HOME` + sandbox workspace (the link-profile or overlay shape the
  mount proof uses — no network, no pnpm).
- Proves from the HARNESS's own evidence, not from prose, that `/cellwork` is registered and that its
  handler submits the activation directive; records `evidence/cellwork/qa/<timestamp>/`.
- A SKIP is not a pass; a missing boot prerequisite must fail loudly in the case.

## C4 — QA case: reproducible mount (`skills/dsh-qa/scripts/cellwork-mount.ts`)

- Reproduces the 2026-10-26 overlay recipe: profile + absolute-module overlay row + real boot.
- Asserts the row's own mount line (`[mpd-cellwork] mounted:`) and the absence of a loader failure;
  fails when the row is absent. `--self-test` with a negative control (an overlay naming a missing
  module must fail).
- Documents in the case header WHY the overlay is used on this machine (stale bundle resolution) and
  that the bundle-row source is a separate proof.
- SKILL.md case-table row + evidence under `evidence/cellwork/qa/<timestamp>/`.

## C5 — Documentation (work)

- `docs/cellwork.md` + `docs/cellwork.zh-CN.md`: bilingual, switch link under the title, identical
  heading tree, real 简体中文. Covers: the command, all tool surfaces, the captain/verifier/checkpoint/
  subcaptain guard modes, the measured budget with its provenance and bounds, the checkpoint protocol,
  cell-aware mail, the state layout, and the declared bounds (mount/overlay, pack closure, mail wake-up,
  reseed, observed-window-only checkpoints, parent_team_id deferred to Wave 4).
- A pointer from `docs/user-guide.md` (+ zh) to the new doc.
- A `CHANGELOG.md` entry under Unreleased describing the feature and the two adjacent Wave-1 fixes.
- Any README sentence needed by C2 lands in the package README pair, both languages.
- Gates: `bun run verify:docs` green, no dead links, both languages carry the same topics.

### Amendment 6 (2026-10-26T10:32Z, captain; from the T1 completion report)

Two defects found OUTSIDE C1–C4 are accepted as repair items and judged by a separate review (T6)
against this amendment. They do NOT affect the T3 verdict on C1–C4.

**R1 — the dispatched contract path.** `dispatchMessageFor` builds the member's contract path from the
BOARD task id while activation and the verify loop use the SPLIT KEY, so a dispatched member is told to
read `contracts/<boardId>.md`, which does not exist. Required: the dispatched message names the SAME
contract file the verify loop opened (the split key), and an arm asserts the named file EXISTS on disk.

**R2 — an accepted verdict must survive a refusal.** A refused same-revision resubmission currently
overwrites `split/<rev>.json`, replacing the ACCEPTED verdict on disk. Required: a refusal never
destroys an accepted verdict (write the refusal to a distinct path, or refuse before writing); an arm
pins that the accepted file is byte-identical after a refused resubmission.

Scope: package `src/` + tests only; rebuild the package dist; no docs and no `skills/**` edits.

## Gates the verifier must run

- `bun run typecheck`, `bun run verify:comments`, `bun run verify:docs`, `bun test packages`,
  `node scripts/verify-dist-fresh.ts`, `bun run verify:rows`, `bun run verify:manifest`,
  `node scripts/verify-no-host-override.ts`, `node scripts/install-profile.ts --dry-run`.
- `bun run test:qa` (all QA self-tests) AND the two new cases' REAL runs, with their evidence paths.
- Evidence under `evidence/cellwork/qa/<timestamp>/` plus the verify-plane ids.

## Declared bounds (not findings)

- `verify-pack-closure` remains red (`PACKED-MISSING`) until the Wave-5 re-pack.
- The mount proof proves the row MODULE applies; the bundle-row source rests on rows/manifest.
- No live-LLM end-to-end cell run is claimed; the QA command case proves registration + the directive
  submission, and the unit suite proves the protocol logic.
