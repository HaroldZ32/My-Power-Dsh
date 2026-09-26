# t30 — review round 2: lane B's t29 driver repair, falsified on the round-2 revision

**Reviewer:** watchdog-engineer (lane C; author of round 1 = t13 on the same lane, deliberately re-used
here because round 1's instruments are the ones that found F1/F2). **Reviewed task:** t29 (repair of t9).
**Verdict: `pass` — 0 findings. F1 and F2 are closed, and they are closed by MEASUREMENT, not by the
repair's prose: I re-ran the same falsifications that produced them on the previous revision.**

## Revision pinned for this round

| element | reading |
|---|---|
| HEAD | `c826f16` |
| `scripts/verify-pack-closure.mjs` | sha256 `c0814334013c0da5…` (unchanged since round 1) |
| `scripts/verify-dist-fresh.mjs` | sha256 `0df995fc98f7450c…` |
| `scripts/pack-mpd.mjs` | sha256 `95d55ab9fda96baf…` |
| `run-laneB-evidence.mjs` (the repaired entry point) | sha256 `cae90588897ecb0d…`, 12,206 B, mtime 2026-09-17T08:21:12Z+0800 (pre-repair revision was `abbc33335219766a`) |
| canonical artifact | stamp `ff5f96da7c43a056` / 1190 files, recomputed here by the documented method (sha256 over the **UNSORTED** `find dist/mpd-package -type f -printf '%P\t%s\t%T@\n'` listing + count) — byte-identical before/after every leg |
| evidence for this round | this directory: `gates-round2.log`, `closure*.log`, `dist-fresh*.log`, `fresh-run/`, `falsify/falsification.json`, `broken-harness/`, `ar-bytes.log`, `ar-absent.log` |

## The round-2 question: are F1 and F2 closed? (both verified by re-running the failures)

**F1 — fresh-dir re-runnability and reading provenance. CLOSED.**
* `node …/run-laneB-evidence.mjs <fresh dir>` → **exit 0**, all 11 steps executed, and the four harness
  readings were regenerated **inside that fresh dir** (`t67-build-form-diff.json` 4749 B,
  `t63-t76-seeded-mutation.json` 4369 B, `t63-out-flag-equivalence.json` 2603 B, `t67-round-trip.json`
  2315 B) — with NO pre-existing `.json` anywhere. Round 1's failure was `exit 1 ENOENT … t67-build-form-diff.json`.
* The run's own summary names the resolution root: `driver.resolved_harnesses_from` = the driver's own
  directory, while `driver.output_dir` is the fresh dir.
* **The NEW error path is real, and I falsified it**: I copied the driver + the four harnesses into a
  scratch dir, replaced ONE harness with a script that prints non-JSON, and ran it →
  **exit 1** with `harness_parse_errors = {"t67-build-form-diff": "no JSON object found in the harness
  output"}`. A harness that cannot be parsed can no longer be silently absent from the summary.

**F2 — digest discipline. CLOSED.**
* I planted two probes in the fresh output dir BEFORE the run: `planted-empty.tmp` (0 bytes) →
  `digests_skipped = "empty file at digest time (0 bytes) - not evidence"`; `planted-old.txt`
  (non-empty, mtime 07:00Z, predating the run) → **digested**, which is the documented rule for a
  pre-existing reading. `driver.stdout.log` (0 bytes at digest time because my own shell redirect
  created it) → skipped with the same reason. `driver-summary.json` (25,662 B, run-written) → digested.
  Round 1's failure was `digests["driver-summary.json"] = e3b0c442…` (the empty-string sha).
* The digest map is 17 entries for the run; `result.json` excludes itself and its note says so.

## Per-acceptance reading (t30's 9 stored items)

| # | item | verdict | reading |
|---|---|---|---|
| 0 | every claim reproduced independently; use the driver as the entry point | PASSED | driver exit 0 in a fresh dir (above) + all five gate commands re-run green (below) |
| 1 | seeded content mutation reddens; byte-identical re-pack green | PASSED | my differential harness re-run on the round-2 revision: clean control exit 0 (`1181 compared, 1156 identical, 0 drift, 25 expected-after-pack`); a packed-side byte mutation of a file whose source did not move → exit 1 with a **HARD, NAMED** `CONTENT-DRIFT` in `templates/`, `skills/` and `docs/` |
| 2 | completeness catches a shipped file with no counterpart; the ONE exemption stays an exemption | PASSED | deleting one packed asset → exit 1, `completeness: 406 compared, 404 present, 1 declared exemption, 1 absent`; control reads `405 present, 0 absent` and `exemption exercised: packages/mpd-qa-roles-probe/dist/index.js` |
| 3 | build form verified on the COMMITTED bytes; 13-path-comment count quoted | PASSED | `verify-dist-fresh` repo-wide **exit 0 / 20/20 fresh**, `--only mpd-ext-plugin` **2/2**, `--only mpd-tui-plugin` **1/1**, `--self-test` **12/12** — the gate rebuilds against the committed bytes; my own canonical repo-root build of `mpd-ext-plugin` reproduces **13 path comments / 11 distinct** |
| 4 | `agent-references/**` bytes separated from presence, with the distinguishing mutation | PASSED | re-run: bytes mutated → exit 0 with `agent references 3/3` (presence green) AND one named finding on `agent-references/troubleshooting.md`; same file deleted → exit 1 with `TREE-DRIFT … dropped by the pack: troubleshooting.md` + `REFERENCES - the packed tree does not carry agent-references/troubleshooting.md` |
| 5 | FALSE-RED warning: `expectedFailLines = 16`, per-command verdict rule, self-test number | PASSED | `grep -c "[verify-pack-closure] FAIL"` = **16**, `grep -c "self-test PASS"` = **35** (34 arms + 1 summary), summary `self-test PASS: 34/34 arms`, exit 0 — the 33/33 in the contract text is superseded by t26's extra arm; the real-tree closure log has **0** FAIL-shaped lines and exit 0 |
| 6 | stamp comparability — quote the method with the stamp | PASSED | my recomputation reproduced `ff5f96da7c43a056` / 1190 exactly using the method quoted above; the pre-round-1 `\| sort` construction remains named as non-comparable |
| 7 | post-completion movement is expected, not a discrepancy | PASSED | repo-wide dist-fresh is exit 0 / 20/20 (was exit 1 at lane B's close; my 07:40:20Z rebuild cleared it); closure counters are `1156 identical / 25 expected-after-pack` with every row naming its post-pack writer; the nested corrections (`CORRECTION-post-completion.md`, `CORRECTION-scope-claim-watchdog-dist.md`, `repair-t29/…/digest-deltas.txt`) sit BESIDE the sealed records |
| 8 | findings structured and fail the task | PASSED (nothing to file) | no finding survived falsification this round |

## Bounds carried (stated, not hidden)

1. The repaired driver requires the output directory to EXIST: pointing it at a non-existent path fails
   LOUDLY (`Error: output directory does not exist: …`, exit 1) rather than creating it — my first
   error-path attempt hit exactly that. The header's "point it at one [a fresh directory]" implies the
   caller creates it; recorded as an ergonomic bound, not a defect.
2. `digests` mixes run-written files with inherited-but-eligible ones (non-empty AND older than the run,
   e.g. my `planted-old.txt`); the header documents the rule and every exclusion carries a reason, but the
   map itself has no per-entry run-written flag. A reader who needs that distinction reads
   `driver`/`steps` + the skip map.
3. `verify-gates` exit 1 in the steps is lane D's corpus condition recorded as `expected: "reported"` —
   not a driver defect and not this lane's to fix (t18 owns the aggregate).
4. Round 1's two withdrawn methods (pinned-stamp-to-now; copy-inferred stamps) remain the reason this
   round's mutations are pinned to the artifact's REAL cut time — the falsification method is unchanged,
   so the two rounds' readings are comparable.
5. No live `dsh` boot, no `skills/**` write, no git write, and the canonical artifact was never written
   by this round (stamp identical before/after every leg).
