# Repair round 2 — cellwork member adoption (findings A, B, C)

Branch: `fix/cellwork-member-adoption` (PR #95), on top of HEAD `558bdeb9` + the preceding uncommitted
round-1 repair. Scope: the three findings the independent verifier returned after round 1. Nothing was
staged, committed or released; `packages/mpd-cellwork-plugin/dist/index.js` was NOT rebuilt (the captain
rebuilds it afterwards, by instruction).

## A (High) — `unfence` clears only an explicit GIVE-UP fence

- **Symbols:** `recordSeat` (protocol.ts) now returns the TEAM row's explicit `fenced` flag beside its
  display `checkpoint` derivation; `unfenceSeats` (protocol.ts) gates the team-only branch on
  `seat.fenced === true` and answers `{member, unfenced:false, reason:"checkpoint-pending", detail}` when
  the TEAM row is `mode:"checkpoint"` with no `fenced` flag — nothing is written to either record and the
  plane seam is not called. The asked-for behaviour is kept: an explicit `fenced:true` TEAM row with no
  CELL marker is cleared through `mpdTeamActions.unfence` while the CELL row stays untouched
  (`cellRow:"untouched"`).
- **Text:** `cellwork_dispatch` description, the `unfence` parameter description, the `unfenced` output
  schema, the `cellwork_supervise` `fenced` schema/render, `docs/cellwork(.zh-CN).md`, `README(.zh-CN).md`.
- **Tests:** `test/dispatch-unfence.test.ts` — "finding A: a PENDING checkpoint is not a give-up …"
  (new). RED against the pre-fix source: the same arm answered `unfenced:true` (cleared through the
  plane) because it read the display `checkpoint` derivation. The round-1 arms ("finding 2: a fence
  recorded ONLY on the TEAM record …") still pin the kept behaviour.

## B (High) — one unambiguous member-resolution helper

- **Symbols:** new `resolveMemberName` (dispatch.ts) — exact member-table key, then exact display name,
  then the normalized `nameKey` ONLY when it is non-empty AND exactly one member carries it; otherwise
  `undefined`. Used by `cellwork_dispatch`'s `unfence` target resolution and by `cellwork_send`'s
  recipient lookup + self-message guard (exact key or exact display name; a same-cell broadcast's
  self-exclusion is unchanged and remains out of this finding's scope).
- **Tests:** `test/dispatch-unfence.test.ts` — "后端1 and 前端1 both normalize to `1`, and the exact name
  clears only its own seat", "an ambiguous normalized lookup refuses the WHOLE call instead of guessing",
  "`unfence:[\"运维1\"]` (absent) is refused and nothing is cleared".
  `test/member-resolution.test.ts` (new) — the exact CJK recipient wins over the collision; an ambiguous
  normalized recipient is refused; `运维1` is refused; a CJK self-message is still refused by exact name.
  RED against the pre-fix source: the ambiguous/absent arms cleared the first collision and the send arm
  delivered 前端1's message to 后端1. The self-message arm is a regression guard (it was already refused
  before the fix, accidentally, because both names normalized to the same key).

## C (Nits)

- **Symbols:** `adoptSeat` (caller.ts) writes the cell record BEFORE appending the `member-adopted`
  journal row (C-i), and reports `AdoptionFailure {kind:"read"|"write", detail}`; `cellwork_handoff`
  (protocol.ts) phrases the refusal from `kind`, so a read failure no longer claims a write failed
  (C-ii).
- **Tests:** `test/member-adoption.test.ts` — the write-failure arm now also asserts the journal holds no
  `member-adopted` row (RED pre-fix: the journal already carried it); a new arm breaks the record between
  the cell scan and the adoption's fresh read and asserts the refusal says "could not be read" and never
  "could not be written" (RED pre-fix: it said "could not be written").

## Gates (run from the repo root; logs in this directory)

| Command | Exit |
|---|---|
| `bun test packages/mpd-cellwork-plugin` | 0 — 226 pass, 0 fail, 2539 expect() calls, 27 files |
| `bun run typecheck` | 0 |
| `bun run verify:comments` | 0 — PASS, 597 files, 52368 declarations |
| `bun run verify:docs` | 0 — PASS, 55 pairs, 500 links, 0 dead |

## Bounds and residual findings

- **`dist/` is deliberately STALE**: `packages/mpd-cellwork-plugin/dist/index.js` still carries the
  round-1 build. `verify-dist-fresh` will redden until the captain rebuilds the package with the pinned
  toolchain; no dist file was touched by this repair.
- **`seatKey` still normalizes CJK names** (`"seat:" + cellId + "/" + nameKey(name)`): 后端1 and 前端1
  share one mailbox address, and the shared store's own self-check (`sendMany`) compares those ids. A
  CJK member sending to a DIFFERENT CJK colleague is therefore still refused by the store, and a
  same-cell broadcast from such a member can be refused once the corrected exclusion includes the
  colliding colleague. This is pre-existing and outside the frozen scope (the helper addresses name
  LOOKUP, not stable mailbox identity); it needs its own defect.
- The read-vs-write proof for C-ii injects the failure through the test's `mpdTeams.get` double (the one
  step between the cell scan and the adoption's fresh read); the branch is otherwise unreachable through
  a real tool call without a race.
- Red proofs were produced by temporarily restoring the pre-fix logic in `protocol.ts`, `caller.ts` and
  `dispatch.ts`, running the new arms, then restoring the fixed code (verified by a clean `PRE-FIX`
  grep, the full green suite and the typecheck). No test or gate was edited to obtain a pass.
