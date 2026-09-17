# t13 — review-B: falsification of lane B's gate rules (bytes · completeness · build form · agent-references)

**Reviewer:** watchdog-engineer (lane C). **Contract:** t13 revision 4, attempt 7 (reassigned from
`code-reviewer`). **Reviewed task:** t9 (+ its repair t9-R1/t26).
**Verdict: `needs_revision` — 2 findings (F1 medium, F2 low). The GATE RULES themselves survived every
attack I could land; both findings are in the lane's EVIDENCE ARTIFACTS, not in the gates.**

## Revision pinned for this review (every reading below is anchored to it)

| element | reading |
|---|---|
| HEAD | `c826f16` |
| `scripts/verify-pack-closure.mjs` | sha256 `c0814334013c0da50317e8e64a4b6a341ae31cb6402cdc9dbf937dfd1b745e7d` |
| canonical artifact `dist/mpd-package` | stamp `ff5f96da7c43a056` / 1190 files, IDENTICAL before and after every leg in this review |
| stamp method (quoted with the number, per acceptance 7) | sha256 over the **UNSORTED** `find dist/mpd-package -type f -printf '%P\t%s\t%T@\n'` listing + file count — the ONE canonical construction the driver documents; my independent computation reproduced `ff5f96da7c43a056` / 1190 exactly |

Evidence and re-runnable instruments: this directory (`falsification.json`, `falsification.v1/v2.json`
superseded passes, `review-falsification-2.mjs`, `agent-references-split.log`, `driver.stdout.log`,
`findings.log`, the copied lane-B helper scripts, and the regenerated gate/self-test logs).

## What I did to falsify (method first)

1. Re-ran the gates and self-tests myself (closure, closure `--self-test`, dist-fresh repo-wide,
   `--only mpd-ext-plugin`, `--only mpd-tui-plugin`, dist-fresh `--self-test`).
2. Ran lane B's driver at a FRESH evidence dir — the entry point the contract told me to use.
3. Ran the four lane-B harnesses directly (their stdout is JSON) and compared each payload to the sealed
   `.json` **semantically, ignoring timestamps**: `t67-build-form-diff` IDENTICAL; the other three differ
   only in the post-completion counters (mutation `candidate_counts` 337/68 → 335/70, out-flag
   `changed_count` 18 → 25, round-trip mtimes/ms) — each explained by a NAMED post-pack writer, which is
   lane B's own acceptance rule ("re-measure before calling a moved number a defect").
4. Wrote my OWN differential falsification harness (`review-falsification-2.mjs`): every mutated scratch
   pack is compared finding-line-by-finding-line against a CLEAN scratch pack read in the same run, with
   `--pack-stamp` pinned to the artifact's real inferred moment so the only difference is the mutation.
5. Attacked the two rules that MOVED under t26 (the root-file byte rule, which was deleted from 5b and
   re-homed into the sweep) directly on scratch copies.

**Two methods withdrawn and recorded, not smoothed** (`falsification.v1.json`): (v0) pinning the stamp to
*now* reddened the CLEAN control with 24 hard drifts — a valid rule reacting to a false stamp claim, so the
method was wrong, not the gate; (v1) letting a mutated copy infer its own stamp MOVED the stamp forward and
reclassified all 25 honest post-pack writers as hard drifts — the mutation poisoned the measurement. Both
passes are kept as evidence of the method search.

## Per-acceptance findings (t13, stored array — 9 items)

| # | item | verdict | reading |
|---|---|---|---|
| 0 | every t9 claim reproduced independently; **use the driver** | **FAILED (F1)** | The gate/self-test/harness readings reproduce (see below), but the designated entry point cannot be used as documented: re-homed it dies `ENOENT … t67-build-form-diff.json` (exit 1), and even in its own dir the four harness readings it assembles come from pre-existing `.json` files its steps do not write. |
| 1 | content mutation reddens; byte-identical re-pack green | PASSED | My clean control (pinned stamp, scratch copy) → exit 0, `content bytes: 1181 compared, 1156 identical, 0 drift, 25 expected-after-pack`; one byte appended on the PACKED side to a file whose source did not move → exit 1 with a HARD `CONTENT-DRIFT` **naming that file** (measured for templates/, skills/, docs/). Lane B's own two arms agree: "real artifact copy, one byte changed → reported" + "same mutation, stamp pinned → hard CONTENT-DRIFT, exit 1". |
| 2 | completeness catches a shipped file with no counterpart; the ONE exemption stays an exemption | PASSED | Deleting one packed asset → exit 1, `completeness: 406 compared, 404 present, 1 declared exemption, 1 absent` (control: 405 present, 0 absent). Exemption reading: `1 declared exemption(s), 0 absent; exemption exercised: packages/mpd-qa-roles-probe/dist/index.js` — exercised, not silently skipped (its own self-test arm asserts exactly that). |
| 3 | build form verified on the COMMITTED dist bytes; 13-path-comment count quoted | PASSED | `verify-dist-fresh --only mpd-ext-plugin` → exit 0 `2/2 fresh` (the gate rebuilds and compares against the COMMITTED bytes — no reviewer-produced rebuild is judged); repo-wide → exit 0 `20/20 fresh`. My own canonical repo-root build of `mpd-ext-plugin`: **13 `// ` path comments, 11 distinct** — the manual's number, reproduced. `t67-build-form-diff` exits 1 BY DESIGN when the two forms are IDENTICAL, which is the false-red class the acceptance warns about (its own marker: `forms_identical`). |
| 4 | `agent-references/**` bytes separated from presence, with the distinguishing mutation | PASSED | My two-leg split on the same file (`agent-references-split.log`): BYTES mutated, presence intact → exit 0, `agent references 3/3` (presence green) AND a named finding `CONTENT-DRIFT-EXPECTED … agent-references/troubleshooting.md: source mtime … is AFTER the artifact stamp …`; the SAME file DELETED → exit 1 with two named presence findings (`TREE-DRIFT … dropped by the pack: troubleshooting.md`; `REFERENCES - the packed tree does not carry agent-references/troubleshooting.md`). Bytes and presence are separately reddening. |
| 5 | FALSE-RED warning; `expectedFailLines = 16`; per-command verdict rule; self-test number | PASSED | `grep -c "[verify-pack-closure] FAIL"` over the self-test log = **16** in BOTH the sealed log and my fresh run (the contract's corrected number). `grep -c "self-test PASS"` = 34, i.e. 33 arm lines + 1 summary — a bare `grep FAIL`/count would read a false red. Per-command verdicts: closure exit 0, `--self-test` exit 0 `33/33` (sealed) / **`34/34`** (my run — t26's repair added an arm AFTER the contract was written; the movement is expected and both numbers are quoted with their revision), dist-fresh `--self-test` 12/12. |
| 6 | stamp comparability — quote the method with the stamp | PASSED | The driver documents the ONE canonical construction (unsorted `find -printf` + count) and records the older `\| sort` construction as NOT comparable. My independent computation reproduced the sealed stamp `ff5f96da7c43a056` exactly; the pinned-stamp legs quote the method in their own output (`pack stamp … (command line (--pack-stamp))`). |
| 7 | post-completion movement is expected, not a discrepancy | PASSED | Repo-wide dist-fresh moved exit 1 → exit 0 (20/20) because lane C rebuilt the watchdog dist at 07:40:20Z; the closure counters moved 1160→1156 identical / 21→25 expected and the new entries NAME the post-pack writers (my `dist/index.js`, my `agent-references/troubleshooting.md`, the README pair, `EXTENSIONS-FOR-AGENTS.md`); the nested corrections exist beside the sealed record (`CORRECTION-post-completion.md`, `CORRECTION-scope-claim-watchdog-dist.md` + its cross-ref). No defect. |
| 8 | findings structured and fail this task | PASSED (this review) | F1/F2 below are structured with required fixes; the verdict is `needs_revision`. |

## Findings

**F1 — medium — the contract's designated entry point does not run re-homed and does not regenerate 3 of
the readings it assembles.**
`file`: `evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/run-laneB-evidence.mjs`.
`problem` (measured): `node <driver> <fresh-dir>` → exit 1, `ENOENT … <fresh-dir>/t67-build-form-diff.json`
(reproduced; `driver.stdout.log`). Static half, same root cause: the four harness scripts only
`console.log(JSON.stringify(...))` — none writes a `.json` — while the driver captures their stdout into
`<name>.log` and then READS `<name>.json` (lines 120-123). In the sealed dir those four `.json` files
predate the driver's own runs (`captured_at` 07:28:12 / 07:36:57 / 07:37:13 / 07:37:52 vs the `.log` files
written 07:38), so the harness readings in `result.json` are read rather than regenerated — while the claim
on the driver header and in the contract is "regenerates every reading it cites".
`requiredFix`: parse the JSON from the `<name>.log` the driver itself just wrote (or write `<name>.json`
from that captured stdout), and make the `[<evidence-dir>]` argument self-sufficient — resolve the four
harness scripts by the DRIVER's own directory (or copy them in), so a reviewer can point it at a fresh dir.

**F2 — low — one recorded digest describes a file that was still empty when it was taken.**
`file`: `evidence/pack-closure/wave2-laneB/20260917T072544Z-laneB/result.json` (`digests`).
`problem` (measured): `digests["driver-summary.json"] = e3b0c44298fc1c14…` — the sha256 of the EMPTY
string — while the file on disk is 4362 B (`8d066764e62752eb…`). The shell redirection had created the file
empty during the run, so the digest loop captured it mid-write; the "a digest for every file it wrote"
claim is therefore false for that one entry.
`requiredFix`: exclude the file the process is writing (or any 0-byte file / a file whose mtime is inside
the run) from the digest loop, and digest it after the run; or run the driver with its stdout outside the
evidence dir.

## Bounds I carry (stated, not hidden)

* The root-file byte rule **cannot hard-fail** a packed-side mutation while that file's source is itself a
  post-pack writer: my leg `mutation_root_file` → exit 0 + a named `CONTENT-DRIFT-EXPECTED` finding. This is
  exactly lane B's own REPORT.md §5 bound 1 (the EXPECTED class is a timestamp-ORDER discriminator, not
  content provenance) — recorded as VERIFIED-WITH-BOUND, not as a defect. The hard shape is proven for
  files whose source did not move (templates/skills/docs legs).
* No rule was made green by weakening it: the only DELETED check line in the two gate scripts is the old
  rule-5b root-file byte check, and its replacement reddens (hard, named) for unchanged-source files —
  measured by my own mutation legs on scratch copies.
* I did NOT re-run lane B's `t63-out-flag-equivalence`/`t67-round-trip` claims about the PACKER's `--out`
  route beyond their own harnesses; their payloads were compared to the sealed ones and differ only in
  counters their own bounds predict. The canonical artifact was never written (stamp identical before/after
  every leg).
* A review is not a proof: `bun run verify:gates` was not re-run here (lane D's corpus is in flux; the
  aggregate belongs to t18), and no live `dsh` boot was involved.


## Method clarification (captain's working note, folded in)

The captain's note asks the reviewer to say WHICH of the two options was used when mutating an artifact
copy, because the class cannot make that distinction on its own. Recorded precisely:

* I did NOT restore the copy's mtimes. I passed **`--pack-stamp 2026-09-17T05:19:48.265Z`** — the canonical
  artifact's OWN inferred cut time, read from the artifact before anything was copied — in **every** leg,
  including the clean control, so the stamped input is identical across legs and the ONLY difference is the
  mutation (`falsification.json` → `pinned_stamp` + `method_note`).
* Additionally I chose mutation targets whose SOURCE had not moved since the pack (filter:
  `source mtime <= artifact newest mtime` AND source/packed bytes currently identical), so the mutation
  could only land in the HARD class — and it did: exit 1 with a HARD `CONTENT-DRIFT` naming the target for
  `templates/`, `skills/` and `docs/`.
* The two methods that FAILED this requirement are kept as evidence, not deleted: (v0) pinning the stamp to
  *now* reddened even the clean control (25 honest post-pack writers became hard drifts — a valid rule
  answering a false stamp claim); (v1) letting a mutated copy infer its own stamp let the MUTATION MOVE the
  stamp forward, which reclassified those 25 honest writers — the mutation contaminating its own
  measurement. Both are filed as `falsification.v1.json`.
* Where the mutation necessarily lands EXPECTED, that is stated with its cause rather than reported as a
  gate failure: the ROOT-file leg (`EXTENSIONS-FOR-AGENTS.md`, source mtime 07:43 > stamp 05:19) and the
  `agent-references` BYTES leg both produced `CONTENT-DRIFT-EXPECTED` rows NAMING the file — which is the
  class's documented behaviour, and the presence rule stayed green in the same run.

## The sharper trade, judged (captain's second question)

After t26 a green closure gate does not certify artifact freshness or integrity by itself. Is that
disclosed where a reader will find it? **Yes — five on-disk surfaces, so PASS with the reading recorded:**
1. the gate's own constant block: "the claim is weaker than 'the artifact is authentic' … TIMESTAMP ORDER,
   not content provenance … Pin the stamp with `--pack-stamp <iso>` when the inference cannot hold";
2. its usage line and sweep docstring ("reported loudly, never silently dropped, and never counted as a
   closure violation");
3. lane B's `REPORT.md` §5 bounds 1-2;
4. `repair-t9-R1/…/result.json` → `handoff_to_t18` (the reading clears at the ONE re-pack);
5. **the wave plan itself** (`.mpd/plans/friction-p2-wave.md`), which states the sharper criterion the
   integration task must apply: "the re-pack check is **membership, NOT a count**: at the re-pack moment
   the `expected-after-pack` list must contain **NONE of those** files" and "`EXTENSIONS-FOR-AGENTS.md`
   DROPS OUT of the `expected-after-pack` list".
And the gate's own verdict line already carries the number a bare exit code hides:
`… content bytes: 1181 file(s) compared, 1156 identical, 0 drift, 25 expected-after-pack; completeness:
406 declared source file(s) compared, 405 present, 1 declared exemption(s), 0 absent`.

**Residual named, NOT filed as a finding against lane B (out of scope for t9 and for t13's rule):** the
repository manual's §4 gate table does not mention the closure gate or its post-t26 bound at all
(`grep -n "closure\|verify-pack-closure" AGENTS.md` → unrelated hits only), so a reader who consults only
the manual will not learn it. That is an integration/documentation surface (t18 / the docs lanes), not
lane B's record, and the disclosure chain above is complete on disk.


## Citation convention (captain's form note, adopted)

Line-number citations below are ADVISORY and rot (T-55, extended this wave to test arms). The stable
anchor for every arm cited in this review is its **label plus its assertion** — grep the label, e.g.
`negative-control (same drift, stamp pinned ahead of the writer, exit 1)` or
`negative-control (post-pack writer of a ROOT FILE -> expected, exit 0)` — and read the assertion beside
it. Same rule for the gate script's constants: cite `EXPECTED_KIND` / `EXPECTED_SLACK_MS` by name.
