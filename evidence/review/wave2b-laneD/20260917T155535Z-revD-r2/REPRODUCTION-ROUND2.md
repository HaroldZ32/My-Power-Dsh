# t39 — REVIEW ROUND 2 of wave-2b lane D (judging the REPAIR t38)

Reviewer: packaging-engineer (lane B's author; independent of lane D by authorship and by write set).
Read-only: my inScope is `evidence/review/wave2b-laneD/**`, so this record contains the only writes.
BEFORE-STATE this review judges against: `evidence/review/wave2b-laneD/20260917T144844Z-revD/` (my t24
round: verdict needs_revision, R-D-F1..F4) — not edited here.

## 0. The pinned revision (my own measurement, not the record's)

`pinned-revision-corpus-sha256.txt`: the 14 changed corpus paths with their sha256 as I measured them, plus
the LF-normalized corpus treeSha re-derived by me at my moment —
**`5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a` / fileCount 324** — which is
BYTE-FOR-BYTE the value t38's `repin-preview.log` quotes, with the raw-bytes value `26ec1af2…` marked
NEVER-write. `VENDOR_LOCK.json` is untouched (`git status --porcelain` empty) and
`node ./scripts/repin-vendor.mjs --check` exits **1**: the wave's ONE re-pin is still OWED, and nothing in
this repair pre-empted the captain's step.

## 1. R-D-F1 (blocker) — CLOSED, verified from three directions

1. **The five ex-crashing lanes RUN.** Direct invocations by me (`direct-*.log`):
   `agent-teams-adopt` exit 0 PASS · `workmate-library` exit 0 PASS · `bundle-lifecycle` exit 0 PASS ·
   `team-route-rewire` exit 0 PASS · `mount-assert` exit 2 with its own **usage** line (it requires
   `--expect=…`; the runner supplies it). **Zero** logs anywhere in my run contain
   `REPO is not defined` — in my ten-lane run: `grep -rl 'REPO is not defined' …/lanes10` = 0.
2. **My own independent static scan** (written for this review, no corpus writes): 18 files use
   `join(REPO,` — 113 sites — and **0 files lack a binding** in their own file. The lane's own arm
   (`T-69.call-site-binding`) reports 288 `join(REPO|repoRoot, …)` sites in 42/54 scanned files,
   `UNBOUND: none`; the two counts differ because the arm counts BOTH identifiers while my scan counts only
   `REPO` — both agree on the property.
3. **The before/after pair is kept**: t24's crash logs (the BEFORE) live in the t24 directory; my direct
   runs and the ten-lane run are the AFTER.

## 2. R-D-F2 (high) — CLOSED

The declared ten-lane selection now has TWO kept runs with the case count visible (t38's `1522Z` and
`1529Z`, **10 case lines each** — I counted them myself; its `lanes/result.json` reports
`complete:true, lanes:10`), and I ran the selection a THIRD time myself:
**10 case lines, 8 PASS / 2 red** (`lanes10-run.log`) —
PASS: wave2b-lane-d · workmate-team-member · relocate-smoke · team-route-rewire · mount-assert ·
agent-teams-adopt · workmate-library · tui-team-surface. My session-start-team hit **my own 300 s budget**
(`reason=timeout`), and `bundle-lifecycle` failed on a different step than t38's run A (OBS-1 below).

## 3. R-D-F3 (medium) — CLOSED

`bun ./skills/dsh-qa/scripts/wave2b-lane-d.mjs --self-test` → **exit 0, 8/8 arms**; the live run →
**exit 0, 8 arms / 0 failed**, with the two new arms present:
`T-69.call-site-binding` (binding requirement + the spare/false-positive fixtures) and `T-69.json-stream`
(the wrapper's stream contract). The real-corpus falsifier (re-introducing `join(REPO, …)` → RED, then a
byte-identical restore) is t38's reading, kept in its evidence; I reproduced the arm's FIXTURE red side and
added my own static scan, because my inScope forbids corpus writes — stated as a bound.

## 4. R-D-F4 (low) — CLOSED

`agent-teams-messaging` is NAMED in t38's §4 as the lane kept out of every `--only` selection, with the
one-line reason (its arm (c) recomputes `VENDOR_LOCK.json`'s skills treeSha, so it cannot be green before
the re-pin). Also reproduced: `--only=no-such-case-xyz` → **exit 3** with the refusal text, so the
substitute behaves as the acceptance documents.

## 5. R-D-F5 (the repair's own finding) — verified

`dumpJsonText` (the stream-contract guard) is present in exactly **6** corpus files, and the json-stream arm
passes live: `stdout is the JSON envelope=true, banner on stderr=true, banner on stdout=false`.

## 6. The rest of the acceptance, reproduced by me

`node ./scripts/run-qa-lanes.mjs --check-drift` → **exit 0**: `46 lane script(s) discovered (46 listed,
0 unlisted, 19 outside every suite)`, `immutability required=10`. Single-writer from OUTSIDE the lane: the
live team record holds exactly ONE task with a corpus pattern (`t18`, `skills/**`); no other 2b lane does.
UNION rule: the tree shows 14 distinct changed entries (13 modified + 1 untracked) — and the repair's own
README names `skills/dsh-qa/scripts/mount-assert.mjs` under TWO sections (§1 and §3), so a per-section SUM
would double-count it while the reported count (14) equals the tree's distinct count: **UNION, tested**.
The T-80 rule reproduces (`54 file(s) scanned, 2 claim set(s), 0 violation(s)`), the T-89 scan reproduces
(0 executed-argv offenders, 208 prose occurrences, 54 files), the T-77 pair reproduces (ignored=true via
`.gitignore:87:/.qa-*`, near-miss false), the T-25 arm reproduces (frames=2, naive read first-frame-only,
real-store reading unavailable), the T-74 rule sentence is present.

## 7. OBSERVATIONS (recorded, NOT findings — the repair's four findings are closed)

- **OBS-1 `bundle-lifecycle` boot flake.** In MY ten-lane run it failed exit-1 at the `boot` step
  (`{ok:false,http:true,...}`) while `install/composed/noHomeCopy/layerDurability/uninstall` were all
  `ok:true` — and the SAME lane PASSED standalone minutes later. t38's run A failed this lane on the
  stream-contract class (fixed by F5) and run B passed it; my failure is a DIFFERENT step, so this is a
  residual flake of the heavy boot, NOT the corpus edit (the step the edit touches, `composed`, is green in
  the failing run). Carry-forward candidate.
- **OBS-2 `session-start-team` is stochastic by nature.** Red in every run I have seen, in two shapes
  (`timeout` under my 300 s, `exit-1` under t38's 1010 s) plus `UNAVAILABLE absent-credentials` in t38's
  run A. Its deterministic `compose` step is `{ok:true,exit:0}` in BOTH of its kept runs (I read the
  per-step records myself), and the red half is the live-LLM cell (`twoSided.complexTeams` [1,1,0] in run A
  vs [0,1,0] in run B, notices always fire, `negativeControl` ok:true). A live-model flake, not a corpus
  defect — and it means the declared selection's exit code is 1 whenever that cell lands red.
- **OBS-3 no post-repair hash list in the record.** The t18 list reproduces 6/14 today; the other 8 are the
  files the repair changed (expected). The repaired revision is still pinnable — I filed my own 14-path
  hash pass and the treeSha matches the repair's preview — but a reader cannot pin it from the record
  alone. Advisory.

## 8. BOUNDS of this review (what I did NOT verify)

1. I did not mutate the corpus (inScope): the binding arm's REAL-corpus falsifier is t38's reading; I
   reproduced its fixture red side plus my own static scan.
2. `session-start-team` never completed under my 300 s budget, so my own reading of it is `timeout` plus
   its kept per-step evidence — not a full run of mine.
3. The corpus digest is a ONE-moment reading; any further corpus edit re-opens the pin (and the re-pin
   preview must be re-taken immediately before the captain's `--write`).
4. I did not judge the OTHER 2b lanes' rows — this review is lane D's repair, and the wave's integration
   readings belong to t25/the captain.
