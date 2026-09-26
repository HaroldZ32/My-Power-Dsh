# t32 (round-2 review of lane B2) — PRE-REGISTERED RE-TAKE PROTOCOL

**Seat:** citation-reviewer. **Status:** written BEFORE `t31` (the repair) is terminal, deliberately — so the repair can
self-check against the same predicates the round-2 review will run, and so a fix that cannot be re-taken is visible
BEFORE it is declared closed (t32's sixth acceptance item: "A finding whose fix cannot be re-taken by a reader is NOT
closed").

**Contract verified on the board:** `t32` reports `[pending]`, assignee `citation-reviewer`, dependency `t31`
(`citation-checker-engineer`, `in_progress`), `In scope: evidence/review/wave2b-laneB2/**`, and acceptance item 3 in the
DISCIPLINE form (directories named, per-directory base rate with this lane's own counts, subject-scoped subset
separated, both matcher-error directions declared on the LANE'S OWN corpus, lane A's split non-inheritable) — the
withdrawal the captain described has landed in `t32` (`agent_teams_task_contract t32`, read 2026-09-17T14:50Z).

## 0 — What this review will NOT do

- It will not re-open `t21` (terminal: `failed`, `needs_revision`, six findings); it reviews the REPAIR.
- It will not inherit any reading from `t21` or from the sibling round-1 seat: every value below is re-taken on the
  repaired revision, which will be pinned by `sha256` + moment before judging.
- It will not accept a fix whose evidence cannot be re-taken by a reader who runs the same command.

## 1 — Revision pin (first action of the round-2 pass)

```
sha256sum scripts/check-citations.mjs
wc -l scripts/check-citations.mjs            # predicate/unit named with every count
git show HEAD:scripts/check-citations.mjs | sha256sum   # is the repair committed or worktree-only?
stat -c '%y %n' scripts/check-citations.mjs  # the moment the pinned revision was written
```

Expected: a NEW sha (not `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28`, the round-1 revision). Every
reading below is anchored to it. If the tree moves during the pass, the boundary is recorded, not chased.

## 2 — The six findings, each with its own re-take (this is t32's sixth acceptance item)

| Finding | The fix predicate | The command I will run | What CLOSES it | Anti-fake control |
|---|---|---|---|---|
| **B2-F1** recorded `lines: 1143` | a nested correction beside the sealed `evidence/gates/wave2b-laneB2/20260917T142452Z/result.json` stating the re-taken count WITH predicate + unit + moment, or an explicit statement that the count is dropped | `wc -l`, `split("\n")`, `grep -c .` over the pinned checker; `sha256sum` of the sealed record to prove it was not rewritten | the correction names a count that one of my predicates reproduces (1146 if `wc -l`), and the sealed record's sha is unchanged | re-run the predicates: a correction claiming a number I cannot reproduce FAILS, even if it says "verified" |
| **B2-F2** `--naive` inert | `{ naive }` actually reaching `driverRow`, OR `[--naive]` gone from the usage block AND `mode` no longer says "naive matcher" | `--driver-headers --out <A>` then `--driver-headers --naive --out <B>` on the same corpus; diff the two `result.json` | if the flag now changes `drivers[]`/verdicts, A ≠ B in a way the message states; if removed, `grep -n 'naive' scripts/check-citations.mjs` shows no advertised mode and B is a usage error | the flag must not merely change the `mode` label — that was the original defect |
| **B2-F3** family boundary unstated | a named clause in the usage/RULE block AND in every run record's `policy` block: a position citation (no literal) and a basename-only citation (no `/`) are OUT OF FAMILY and pass silently | my own fixtures: (a) `See the third assertion in lane A note for the constant.`; (b) `` `alphaSymbol`, `probe.ts` ``; (c) control `` `alphaSymbol`, `src/probe.ts:2` `` | the clause is present in BOTH surfaces (the record is checked as BYTES, not as a comment), and the three fixtures behave as the clause says | the clause must not claim these are "checked"; green-without-a-statement stays a finding |
| **B2-F4** line-wide reference exemption | the exemption declared as a measured THIRD matcher-error direction, OR scoped to the TOKEN | the measured pair: a driver copy claiming `A11` (a) `// CHECKS A11 …` and (b) the same with `t21` on the line | (a) reddens AND (b) reddens too (token-scoped) — or (b) is still green but the audit/policy names the line-wide exemption as a direction with its own count | a declaration with no count is not a measured direction; the count must come from a run I can repeat |
| **B2-F5** anchor scan not re-takeable | the scan's output written OUTSIDE the scanned root, or the exclusion stated in the command, with the self-reference named | `node scripts/check-citations.mjs --anchor-scan ./evidence/gates/wave2b-laneB2/20260917T142452Z --pattern ee9ec16 --out <OUTSIDE>` (and the lane's recorded command form) | re-running the RECORDED command reproduces the recorded count, or the record states the exclusion and prints the self-referential paths as such | I will re-run the exact recorded command twice and compare; a 0 that exists only at the author's moment is not closed |
| **B2-F6** one declared default-root exception, two runs | both runs named in the declared-exception field, or deliberate retention stated | enumerate `evidence/extensions/docs-claims/runs/`, read each `result.json`'s `output_target`/`negative_control`, read the lane's declared-exception text | the record's statement accounts for EVERY entry I can enumerate at the moment of my pass | a statement that names one of two remains a finding |

## 3 — The round-1 criteria, re-run in full (not just the deltas)

The repair can regress the parts that were already green, so the round-2 pass re-runs them:

```
node ./scripts/check-citations.mjs --out ./evidence/review/wave2b-laneB2/<stamp>/run-verbatim
node ./scripts/check-citations.mjs --self-test --out ./evidence/review/wave2b-laneB2/<stamp>/selftest
node ./scripts/check-citations.mjs --driver-headers --self-test --out ./evidence/review/wave2b-laneB2/<stamp>/t80-arms
node ./scripts/check-citations.mjs --driver-headers --out ./evidence/review/wave2b-laneB2/<stamp>/t80-live
```

Expected baselines to beat or match (round-1 readings, to be RE-TAKEN, never inherited): 13/13 with 249 citations /
19 symbol-first / 30 line-dependent / 0 rot; 25/25 arms; 3/3 T-80 arms; every negative-control arm id from round 1 still
present and green; arm count ≥ 25; T-82's changed-pair diff non-empty and both control pairs EMPTY; a second run at the
same `--out` refused with exit 3; the T-78 arm still FAILING when a copy's `rules` block is stripped; the T-82 arm still
FAILING when `retainRevision` is a no-op; the corpus-side live scan green at ITS moment with the driver hashes pinned.

## 4 — Weakening check (the buy-the-green direction)

`git diff HEAD -- scripts/check-citations.mjs` (and against the round-1 revision if it is reachable): every deleted line
must be justified by one of the six fixes; any assertion removed or loosened outside those fixes is a finding. The arm
count may only grow; a shrinking negative-control set is a finding regardless of colour.

## 5 — Bounds this protocol cannot remove

- The immutability ARM (as opposed to the behaviour) is still not falsified unless I disable the guard in a copy; if I
  do not, it is reported as behaviourally reproduced.
- No repo-wide aggregate and no `--gates` will be run (lane-scoped only).
- Lane A's T-92 numbers stay unverified and non-inheritable — the discipline is checked on lane B2's own corpus.

## 6 — Mechanical note for the repair (from the round-1 forensics)

Each bash call gets a FRESH `/tmp`: a scratch fixture built in one call must be consumed and deleted in the SAME call, or
the next call sees nothing (this bit both my pass and the sibling round-1 seat). Two round-1 arm attempts were invalidated
by that and by an over-strict assert; the invalid captures are labelled INCONCLUSIVE in the round-1 artifact and are NOT
used as evidence. Any re-take in this round will follow the same labelling rule.
