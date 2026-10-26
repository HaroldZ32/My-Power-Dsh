# cell-work — live status snapshot (2026-10-26T11:52Z)

Branch: `feature/cellwork` (from `dev`). Plan: `.mpd/plans/cellwork.md` (W1–W5 + acceptance). Frozen
contracts: `cellwork-w1..w4-contract.md`. This file is the resume anchor if a session is compacted.

## Landed commits

| Wave | Commits | Content |
|---|---|---|
| W1 | ac3151ff, 9ef5a6a7, be795221, 6fe9e27e | adapter seams (contextPressure, model window, maxDepth), compact AbortSignal fix, TUI host-drift re-judge, evidence |
| W2 | 78cb08a3, a6932fd1 | cellwork core plugin (command, guard, planner/splitter, checkpoint protocol) + mount proof + evidence |
| W3 | 7e187fb2, b23a41fe, 6171fd7e | re-split, hardening, two QA cases, bilingual docs, vendor re-pin (skills treeSha → 104cbc00), evidence |
| W4 | (uncommitted) | nested DAG groups: graph-core, team-core, TUI, web, docs |

All three blind verifier rows of W1/W2/W3 PASS: W1 T3/T4/T8; W2 T4/T5/T6; W3 T4/T3/T6. No FAIL was ever
recorded except the W4 D1 items below (self-reported and verifier-confirmed).

## W4 board (team `team-20261026105056350-z559-00a`)

| Row | Owner | State |
|---|---|---|
| T1 graph-core D1 | graph-engineer | completed — **T4 FAIL** on Amendment 8 R1 (outer task ranks depth 0 while the drawn edge is anchored on the box) and R2 (gate fixture never exercises group→group) |
| T2 team-core D2/D5 + Amendment 7 | team-engineer | completed — seam = **(b) implicit derivation** (`deriveParentTeam` at approve, NO `parent_team_id`; tool surface 4,996/5,000). Both Amendment-9 reds self-fixed (D5 root cause: millisecond cell-id collision → `freeCellId`; coupling edge removed via structural `GroupInput`) |
| T3 TUI D3 | render-engineer | completed — **T6 in progress** (second one-cell glyph family, frame tree, nested drawing, 18 arms) |
| T15 TUI coupling inventory | render-engineer | completed — REDUCE + one deliberate `rankPlan` pin; TUI dist byte-identical (`684fa6f7…`) |
| T7 web D4 | team-engineer (after T6) | pending — its own recursive-reuse design; hard stop-loss (`git checkout -- packages/mpd-bundle-plugin` + narrow seam) |
| T9 D6 docs | graph-engineer (after T11+T7) | pending — render-engineer handed over the measured inputs (README section, seam, Amendment 7, D5) |
| T11/T12 | graph-engineer / verifier | T11 READY (T4 completed): anchored ranking + cross-frame cycle + gate group→group |
| T13/T14 | team-engineer / verifier | blocked by T5; expected NO-OP completion with the root-cause note |
| T5/T6/T8/T10/T16 | w4-verifier | queue: T6 → T5 → T16 → T11/T12 → T7/T8 → T9/T10 |

## Known environment facts (do not re-derive)

- Team mailbox bound is 8 undelivered; idle members stop draining it. **Use `send_message` with the
  member's session id** for critical wakes/relays (verified path; `agent_teams_mail` refuses at the bound).
- A FRESH team member raise FAILS in this environment (LLM catalog registry down → spawn route
  resolution). Do not plan on new members; reuse an existing one or the captain.
- This machine's bundle resolution picks a stale `@mpd-dsh/mpd` 0.15.5 (global + dsh-tui profile +
  `dist/mpd-package/`), so the mount proof uses a `--patch` overlay with an absolute module path
  (`evidence/cellwork/mount-proof/2026-10-26T09-39-31Z/`); bundle wiring rests on rows/manifest.
- `bundle-lifecycle` dies at its pnpm install step offline (declared bound).
- `verify-pack-closure` is RED (`PACKED-MISSING [mpd-cellwork-plugin]`) until the W5 re-pack; T-91
  expected-after-pack list + `--require-packed` at W5.
- `.mpd/logs/*.log` are polluted by unit-test fixture runs (e.g. repeated "task T1 failed by lead");
  never read them as live team state.
- `skills/**` has ONE writer per wave; the W3 re-pin is in `7e187fb2`. No skills change since, so
  `verify:vendor` is green.

## Next steps (in order)

1. Finish W4 verdicts (T6, T5, T16, T12, T8, T10) and the repairs (T11, T7, T9).
2. Captain integration: rebuild every graph-core importer's dist with the pinned bun 1.4.0
   (graph-core, team-core, tui, bundle, cellwork) — the fan-out is the captain's.
3. W4 commit set: feature (graph-core + team-core + tui + bundle + cellwork + client.js + gate) /
   docs / evidence; then W5.
4. W5: `node scripts/pack-mpd.ts` → `verify-pack-closure --require-packed`; full gate sweep (incl.
   vendor, manifest, docs, rows, comments, dist, tests, typecheck, QA, Docker lanes — a skip is not a
   pass); bilingual PR body (English then 简体中文) with evidence paths, gates + observed results,
   declared bounds; push `feature/cellwork`; open the PR against `dev`; wait for CodeRabbit and
   reconcile every finding FIXED/STALE/STILL-VALID.

## Declared bounds to carry into the PR

- Mount: row APPLIES via overlay; bundle source proven by rows/manifest; pnpm install path unproven.
- Pack closure: red until the W5 re-pack (then re-run).
- Mail wake-up best-effort; member→captain durable+polled; reseed best-effort.
- Checkpoints need an observed window.
- D2: no `originTaskId` is authored in this wave, so no `source:"derived"` spawn edge occurs; a
  subcell's own plan markdown is not merged into its box.
- D4 web: the router refactor + client rebuild are the wave's long pole; a narrow seam is the declared
  fallback if the full refactor cannot land green.
- The 1/4 budget is a certified estimate (±25% English; CJK punitive), not a measurement.
