# t30 — independent review of lane A (verdict: PASS)

**Mirrored by the captain from the `t30` task output.** The reviewer (platform-engineer) reported
that its task contract denied it write access, so its evidence lived only in the task output. This
file preserves it on disk verbatim in substance; the reviewer's own report remains the source.

- Task: `t30` — review of lane A (the RED→GREEN watchdog driver / contract §9)
- Reviewed artifact: `t29`'s verification (code-reviewer) — `evidence/team-watchdog/redesign/verify/20260917T040310Z/`
- Verdict: **PASS**, every reading reproduced by the reviewer, nothing inherited
- Method bound the reviewer declared: one observation window + one boot pair (**N3**)

## Reproduced readings (reviewer's own runs)

| reading | value |
|---|---|
| driver `--self-test` | PASS, 16 checks / 0 failed |
| driver full run (`--out /tmp/… --settle-ms 50000`) | exit 0, PASS 19 checks / 0 failed, `redPinned=true`, `settled=true` |
| green fingerprints across the 50 s window | `{ce8bd54cba51, 47c24bd678ae, b9d7acaf6350, 0e0908e5b002}` — identical |
| row (e) | RED `pin` / GREEN `green` |
| row (f) | RED `red` / GREEN `green` |
| row (d) | RED 91000 → 271000 / GREEN 600001 → 650000 |
| `--out` into an EXISTING dir | exit 3 (T-53 immutability) |
| `--check-drift` | exit 0 |
| `bundle-lifecycle` | exit 0 PASS; reviewer's OWN crash-signature scan = **0 for all four** signatures |
| `team-watchdog-boot` | exit 0; **B1 row APPLIED** `{enabled:true, disposers:8, holdService:mpdWatchdog}` |
| fault lane | exit 0 / 15 checks / 0 failed; `deliveriesWhileHeld=0`, `sha256UnchangedAcrossHeldKicks=true`, `deliveriesAfterResume=1`, `preserved=true`, **neighbour team still dispatching (hold is TEAM-SCOPED)** |
| `holds-lifecycle.test.ts` | 20 pass / 0 failed |
| replay (pinned log) | **198 rows, sha256 `baf67b923aa9…`** → legacy 25 (13 held), fold 4 (3 held), §4 report-only 0 |
| §11 | dist **20/20**; README pair present in both languages with switch links (279 CJK lines); **zero member commits**; no `test:qa:all` criterion |

## Two questions the review existed for — both answered

1. **The fault lane prints five `case … FAILED` lines beside `PASS — 15 checks, 0 failed`.**
   They are the DECLARED stale fixture cases: F2 declares them, **F2b asserts each still fails with
   its recorded signature**, and there are 7 explicit `notClaimed` entries — so the green is not
   self-fulfilling. Only the stdout labelling misleads a reader (finding **N1**).
2. **The one clause no instrument exercises: `kick` against a HELD team.**
   Confirmed by the reviewer's own grep — the kick arms are BUSY-member decline logs, never a held
   team. Stated as a BOUND, not a measurement (finding **V1**).

## Findings (none blocking)

| id | severity | finding | disposition |
|---|---|---|---|
| V1 | medium (bound) | `kick` against a held team is uncovered by any instrument | PARTIAL for T-48 stands; a wave-2 arm carries it (same row as its `t29` twin) |
| N1 | low | the stale fixture cases are not labelled inline, so a log reader can be misled both ways | wave 2 |
| N2 | low | the driver's and boots' DEFAULT out-paths point at OTHER lanes' evidence dirs (a §11.4-adjacent hazard; the reviewer hit it twice and removed both strays); remedy: require an explicit `--out` for foreign callers | wave 2 |
| V2 | low | the contract's "85 recorded incidents" literal is now stale against **198 rows** | wave 2 + report (counts pinned per run) |
| N3 | low | the reproduction covers one window and one boot pair | recorded as the review's bound |

Lane A's rate claim stays the bounded statement `t29` wrote; nothing in this review widens it.
