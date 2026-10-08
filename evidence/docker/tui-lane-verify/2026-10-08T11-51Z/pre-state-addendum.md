# T4 addendum — the acceptance checklist as the FROZEN CONTRACT defines it (post-amendment)

Written 2026-10-08T12:00Z, still before any read of `docker/tui-lane.sh`.

**Frozen contract in force (hashed by the record's `basis.frozenContract`):**
`.mpd/plans/repair-r-docker-tui-fixture.md`, loop `loop-20261008T115240-db7ee8`.
**Authoritative amendment** (it wins where the two disagree):
`.mpd/plans/repair-r-docker-tui-fixture-amendment.md`, cleared by
`.mpd/plans/repair-r-docker-tui-fixture-review.md` (VERDICT: PASS).

## A. The five required behaviours (plan §"Required behaviour", as amended)

| # | Requirement | What I will look for in MY run's artifacts |
|---|---|---|
| 1 | Bind the seeded fixture to the LIVE session, with the product's own key rule | a named arm (`tui.teamFixtureBound` per the writer's card) reporting PASS, and the team arms drawing the seeded board |
| 2 | Every existing arm keeps its MEANING (one box per record task, record ids as node labels) | `tui.teamGraphDrawn` corners == 3 and `tui.teamGraphContent` `missing=[]` |
| 3 | ADD the empty-state / other-session-invisible arm | one named row asserting PRESENT (substring `no team in this session`, never equality) AND ABSENT (no other board id in the same pane) AND NON-VACUOUS (instrument non-empty; empty ⇒ null/FAIL, never PASS) |
| 4 | No FALSE abort on an ordinary red exit; the genuine-abort protection stays | `tui.laneExit` PASS on a green run; no `abort=` claim that contradicts the terminal record; `console.log` free of a false `net=EXIT-trap` reading |
| 5 | A real re-run proving `passed=<n> failed=0` | my own driver summary line, quoted verbatim |

## B. The two null classes (amendment §5 — they must NOT be reported as one)

- **credential-gated (28):** the 27 `live.*` rows **plus `boot.llmTurn`** — correct to be null in a
  credential-free run (AGENTS.md §10); never "fixed", never claimed as passes.
- **host observability (2):** `tui.mergedPanel*` — null because the 0.13.0 panel seam makes the merged
  view non-pane-observable on this host; reported as its own class.

The arithmetic I will hold the run to: `total = passed + failed + null`, and
`null = 28 credential-gated + 2 host-observability` on a green run.

## C. What a FAIL will look like (pre-committed, so the verdict cannot drift)

Each of these is a finding with the verbatim failing output and a `doc_source`:

- any of `tui.teamSceneOpened`, `tui.teamGraphDrawn`, `tui.teamGraphContent`, `tui.laneExit` in
  `failedNames` of my run;
- the requirement-3 arm absent by name, or present but asserting only ONE direction;
- the requirement-3 arm PASSING while its instrument is empty (the vacuity guard's exact false-pass);
- a `tui.laneExit` reading that claims an abort for a run that reached its terminal record;
- a non-credential-gated assertion that is false;
- a null counted as a pass, or the two null classes collapsed into one.

## D. Declared bounds (unchanged)

1. `basis.frozenContract` = the repair plan (this loop's contract). The amendment and the review are
   cited in `sources[]`; they are NOT hashed by the loop.
2. The genuine-abort branch (a `set -u` abort) cannot be exercised by a green run: I can verify only
   that a green run publishes NO abort claim. Stated, not smoothed over.
3. No credentials ⇒ the 28 credential-gated rows stay null (see pre-state.md §"DECLARED BOUNDS").
