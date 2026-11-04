# Repair round 3 — `unfence` against the PRODUCTION give-up shape

Branch: `fix/cellwork-member-adoption` (PR #95), on top of HEAD `558bdeb9` plus the uncommitted repair
rounds 1–2. Scope: the Blocker the third independent verifier returned. Nothing was staged, committed or
released; `packages/mpd-cellwork-plugin/dist/index.js` was NOT rebuilt (the captain rebuilds it after this
round, by instruction).

## Root cause (the production shape)

- `memberAfterBarrier` (protocol-core.ts) writes the give-up fence ONLY on the CELL row: `mode:"checkpoint"`,
  `handoffReady:true`, `fenced:true`, `fencedReason` (persisted by `runBarrier` in protocol.ts, which writes
  only the cell record).
- `writeMemberHandoff` (packages/mpd-team-core-plugin/src/team-actions.ts) sets the TEAM row to
  `mode:"checkpoint"` and NOTHING else.
- The only writer of a TEAM `fenced:true` is the plane's own `fence` action, and nothing in this bundle
  ever calls it.
- Round 2 gated every clear on `teamFenced === true`, so every REAL give-up answered `checkpoint-pending`
  and wrote nothing — the deadlock was back. The suite could not see it because every clear-path arm
  manufactured a TEAM `fenced:true`.

## A — corrected decision table (symbol: `unfenceSeats`, protocol.ts)

1. CELL row `fenced:true` → clear the CELL row (`fenced`/`fencedReason` deleted, `mode:"member"`,
   `handoffReady:false`, `handoffs` kept) AND reopen the TEAM seat through `mpdTeamActions.unfence`; the
   plane outcome is reported as `unfenced` / `absent` / `refused`, never assumed.
2. CELL row not fenced + TEAM row `fenced:true` → clear through the plane seam, CELL row untouched.
3. CELL row not fenced + TEAM row `mode:"checkpoint"` with no `fenced` → `checkpoint-pending`: NEITHER
   record written, seam NOT called.
4. Neither marker → `not-fenced`.

Tests (RED against a temporary restore of the round-2 branch order — see `red-proof.log`, 5 failing arms):

- `round 3: the PRODUCTION give-up shape — CELL fenced:true, TEAM checkpoint with NO fenced — is fully
  recovered` (new): cell row cleared, TEAM `mode:"checkpoint"` reopened to `member` through the seam,
  `handoffReady:false`, and the member hand off again (ordinal 3).
- `round 3: the production give-up clears the CELL row but never claims the TEAM seat was reopened without
  a seam` (new): absent seam → `plane:"absent"` with a `planeReason` saying NOT reopened.
- `B2: unfence removes both fence keys …` — fixture converted from the manufactured TEAM flag to the
  production shape.
- `B2: unfence and reassign travel in one call …` — fixture converted to the production shape.

## B — `cellwork_supervise` (symbol: `cellwork_supervise`, protocol.ts)

Each `fenced[]` row now carries `giveUp` (explicit `fenced:true` on EITHER record). The render gives a
give-up seat the two levers (`reassign` + `unfence`) and a barrier-owned seat
`"… BARRIER-OWNED) … nothing for you to do: the compaction barrier owns this seat …"` with NO unfence or
reassign advice. The tool's top-level description and the `fenced` schema description state the distinction
in full, not as a trailing parenthetical.

Test: `round 3: a BARRIER-PENDING seat gets NO unfence command — the compaction barrier owns it` (new; RED
in the same run; also pins `giveUp:false` and the description text).

## C — documentation

`packages/mpd-cellwork-plugin/README.md` + `README.zh-CN.md` and `docs/cellwork.md` + `docs/cellwork.zh-CN.md`:
removed the sentence saying the lever writes neither record even when the CELL row carries a marker; the
decision table, the plane outcome and the barrier-owned supervise render now match the code. `verify:docs`
exits 0.

## D — gates (observed; logs beside this file)

`tests=0 typecheck=0 comments=0 docs=0` (`gates-exit.txt`)

- `bun test packages/mpd-cellwork-plugin`: 229 pass, 0 fail, 2576 expect() calls across 27 files.
- `bun run typecheck`: exit 0 (`tsgo --noEmit`).
- `bun run verify:comments`: exit 0, `VERDICT: PASS`.
- `bun run verify:docs`: exit 0, `pairs=55 failed=0 violations=0 dead=0 — PASS`.

## Bounds

- The red proof temporarily restored the round-2 branch order in `unfenceSeats` and disabled the
  give-up/barrier split in the supervise render; the fixed source was restored afterwards and the full
  suite re-ran green. Only `red-proof.log` is the failing run.
- `dist/` was not rebuilt (instruction); `verify:dist` is NOT claimed.
- No commit, stage or rebuild was performed.
