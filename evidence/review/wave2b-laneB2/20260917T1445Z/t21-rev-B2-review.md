# t21 — rev-B2 — falsifying review of wave-2b lane B2 (the citation / derived-value family)

**Seat:** citation-reviewer (reviewer, attempt 2, `attempt_id` `a13f7c1a-4ee0-42e1-8a2f-e40b2f53541a`).
**Reviewed:** `t15` (`citation-checker-engineer`, attempt `9371ef07-b30b-4d23-bdb2-fb9109d97e58`), i.e. the
implementation of the three rows **T-78 / T-80 / T-82**.
**Judged against:** the lane's DONE-WHEN, `evidence/requirements/wave2b-laneB2/20260917T1410Z-wave2b-laneB2-acceptance.md`
(182 lines, sha256 `514ded6d797217d568bed4e9e330efdcbb02ad16c8f419958cd9e90d7e9e3714` — re-measured this review),
plus the plan's ER-2 rule (`.mpd/plans/friction-p2-wave-2b.md`, the `ER-2` block) and `.mpd/TODO.md` rows T-78 / T-80 / T-82 / T-90 / T-92.

## VERDICT: `needs_revision` — the FROZEN CRITERIA are met; the ARTIFACTS still say two things that are not true

Every substantive reading the lane's acceptance names **reproduced** on my own shell, and every checker the lane
touched **reddened** on a rot I seeded myself (§1, §2). What fails is narrower and is exactly this lane's own class:
**a recorded count that no reading of the artefact it names reproduces**, a **flag whose record calls a matcher by a
name it did not run**, **three silences the records do not name**, and **an "absence" arm that cannot be re-taken**
(§3). Findings B2-F1…B2-F6; the one thing I would change first is B2-F1, in one nested correction that can carry
B2-F1, B2-F5 and B2-F6 together.

## Revisions pinned (file + sha256 + moment; nothing below is inherited)

| Artefact | sha256 | Measured at |
|---|---|---|
| `scripts/check-citations.mjs` (the durable checker under review) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` | 2026-09-17T14:35:25Z … 14:40:16Z (file mtime 14:24:14Z, unchanged through the review) |
| `evidence/extensions/docs-claims/check-citations.mjs` (the frozen superseded revision) | `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c` | same window; BYTE-UNTOUCHED |
| `git show HEAD:scripts/check-citations.mjs` (the pre-t15 revision the lane names as `before`) | `c86f00cc978863ea28354f4f7ea45ad3a628a84b54b7008082d2d8e581ac5112` | 14:35Z — **equals the lane's recorded `before`**, so the diff I audited is the lane's real diff |
| lane run dir `evidence/gates/wave2b-laneB2/20260917T142452Z/` | `result.json` `2a80a50f35a801165c601be7f190fdbd1a0716a3f98e6919a59c4570a7505026` | 14:33Z |
| my own review dir | `evidence/review/wave2b-laneB2/20260917T1445Z/` | 14:35Z … 14:41Z |

The register rows this review judges were read **by row id** in `.mpd/TODO.md` (T-78 [gap] "A doc-rewrite task's verify
list omitted its own citation driver"; T-80 [gap] "A driver header's `A<n>` claims are prose, unchecked against its own
assertion keys"; T-82 [gap] "The checker's intermediate revisions are not retained"; T-90 [trap] the mailbox-clearing
rot; T-92 [trap] the negative-assertion pin) — cited by declaration, never by position (T-55).

**My own writes are entirely inside `evidence/review/wave2b-laneB2/**`** (the review's `inScope`): every checker run
below carries an explicit `--out` under that tree, and I re-checked the legacy default root afterwards — no run
directory there is mine (the two present are the lane's, §3 B2-F6).

## §1 — Reproduced readings (I executed each; full output on disk under `<stamp>/raw/`)

| Lane's reading | Mine | Evidence |
|---|---|---|
| scoped citation run: `13/13`, 249 citations, 19 symbol-first, 30 line-dependent, 0 rot, 0 pending, 12 illustrative | **identical** (exit 0) | `raw/R1-citation-run.stdout.txt`, `run-verbatim/result.json` |
| `--self-test`: `25/25`, 0 failed | **identical** | `raw/R2-selftest.stdout.txt` |
| T-80 fixture arms: `3/3` | **identical** (`t80-matching` 0; `t80-claimed-but-unasserted` 1; `t80-extra-key-near-miss` 1) | `raw/R3-driver-headers-selftest.stdout.txt` |
| duplicate `--out` refused, exit 3 | **identical**, message `refusing to overwrite the existing retained revision (the running checker)` | `raw/R5-immutability.stderr.txt` |
| retained revisions `checker.mjs`/`superseded.mjs` in the run dir | **byte-identical** to the two pinned hashes; the retained `checker.mjs` is the 1146-line file | `sha256sum` over the lane's `citation-run/revisions/` |
| T-78 record carries rule + command | **my own record** (8683 B) carries the rule, the command and all six parameters; the arm asserts against bytes | `raw/A-t78-my-record` (in `raw/FU-run-all.stdout.txt`) |
| T-82 two-run diff: changed pair non-empty and names the changed line; unchanged pair EMPTY | **identical** on my own pristine copy: 448 B diff naming `// ARM CHANGE B`; unchanged pair 0 B; same-copy mirror pair 0 B | `raw/A-a8-diff-changed-pair.txt`, `…-unchanged-pair.txt`, `…-same-copy-pair.txt` |
| audit direction "whole-header token scan over-reports": 1 file / 2 keys vs 0 | **identical**, re-derived on the corpus revision the lane actually measured (the HEAD blobs of the two drivers) | `raw/FU2-head-precise.stdout.txt`, `raw/FU2-head-naive.stdout.txt` |
| audit directions "non-recursive glob under-reports: 1 vs 2" and "`.js` assumption: 0 vs 2" | **identical**, with MY OWN instrument (`ls`/`grep` predicates, not the lane's flags) | `raw/FU3-base-rate.txt` |
| audit direction "whole-repo literal scan over-reports: 25 vs 2" | **identical** once the checker's own walk predicate is applied (my naive `grep` says 27 because it also counts `node_modules` copies — the predicate difference is named in the same file) | `raw/FU3-base-rate.txt` |
| live driver scan: 53 files (45 top-level + 8 `lib/`), 2 key producers, 0 violations, 2 NO-CLAIM-SET | **at my moment** 54 files (46 + 8) with **2 claim sets, 0 NO-CLAIM-SET, 0 violations** — the corpus MOVED (see §7): lane D added the claim blocks and a new driver file | `raw/A-b1-driver-headers-live.stdout.txt` (driver hashes before **and** after the scan, identical) |
| ADDENDUM A(3) anchor scan: 0 matches in 11 files | **NOT re-takeable** — see B2-F5 | `raw/FU7-anchor-ee9ec16.stdout.txt` |

## §2 — Seeded rot: every instrument the lane touched REDDENED under my hand

| Instrument | My seed | Result |
|---|---|---|
| `negative-control:t78-record-carries-the-rule` | a COPY of the checker with the `rules` block stripped (850 B removed; the copy's real record then has **no** `rules` key and contains the rule 0 times) | **FAIL** in the stripped copy, and the pristine control passes — the arm is falsifiable, not decorative | `raw/FU1-stripped-selftest.stdout.txt`, `raw/strip_rules_block.py` |
| `negative-control:t82-retention-diffable` | `retainRevision()` made a no-op in a copy | **FAIL**, `retained {"runA_checker":false,…}`, `changed pair … (NO DIFF)`; exactly 1 negative-control failure; `t78` and the immutability arm still pass | `raw/FU5-retention-disabled-selftest.stdout.txt` |
| T-80 claimed-but-unasserted | a copy of the real driver whose header adds `CHECKS A11` while the code never asserts A11 | **exit 1**, `CLAIMED-BUT-UNASSERTED A11` + the driver PATH + the header phrase | `raw/FU4b-seed-clean.stdout.txt` |
| T-80 asserted-but-unclaimed | a copy of the real driver whose claim block says `A1–A3` while the code produces `A1–A5` | **exit 1**, `ASSERTED-BUT-UNCLAIMED A4, A5` + the PATH | `raw/FU4-seed-unclaimed.stdout.txt` |
| citation ROT (line-number-only) | my own fixture doc | **exit 1**, 4 failed arms, 2 `line-number-only anchor(s)` | `raw/A-a2-line-number-only.stdout.txt` |
| T-90 anchor scan | my own doc carrying a mailbox-record-id-shaped literal | **exit 1**; and the absent-pattern control exits **0** | `raw/A-d1-anchor-scan-seeded.stdout.txt`, `raw/A-d2-anchor-scan-absent.stdout.txt` |

The live scan ALSO reddened on real rot during this review: at 14:35:43Z the corpus carried a transient claim
containing `A9` and the checker reported `CLAIMED-BUT-UNASSERTED A9` with the driver PATH (that revision was
replaced ~2 s later by its owner — §7).

**My own first harness attempt is captured and NOT used as evidence:** `raw/A-a6-t78-stripped-selftest.stdout.txt` is
an INCONCLUSIVE run (my strip script aborted on an over-strict assertion BEFORE writing the stripped file, so the
"stripped" copy was in fact intact and the arm rightly passed). The falsification of record is `raw/FU1-*`, where the
strip wrote the file and the arm FAILED.

## §3 — Findings

### B2-F1 — `blocker`-class for the record, `medium` for the wave: a recorded count that does not reproduce
**file:** `evidence/gates/wave2b-laneB2/20260917T142452Z/result.json`
**problem:** `revisions.durable_checker.lines = 1143` for the artefact the SAME object pins by `after` =
`fbdc0256…`. That revision measures **1146** (`wc -l`), **1147** (`split("\n")`), **1095** non-empty lines; the lane's
own retained copy at the same hash is 1146. No plausible counting predicate of that file yields 1143, so the field is
a stale reading of an earlier revision, kept beside the hash of a later one. This is the exact class the lane exists
to police (a derived value that rots; T-55/T-92 discipline), and the lane's own acceptance's T-82 note forbids
leaving a false sentence beside a fix.
**requiredFix:** a NESTED correction beside the sealed record (the wave's rule — never a rewrite of the frozen
`result.json`): a sibling note under the same run dir stating the re-taken count **with its predicate, unit and
moment** (`wc -l` 1146 at the pinned sha), or a statement that the count is dropped because the hash is the identity.
**evidence:** `raw/FU6-line-counts.txt`.

### B2-F2 — `low`: `--naive` names a matcher that did not run
**file:** `scripts/check-citations.mjs`
**problem:** `driverHeadersMain()` reads `const naive = process.argv.includes("--naive")` and uses it ONLY in the
record's `mode` label (`mode: naive ? "driver-headers (naive matcher)" : "driver-headers"`); every row is built with
`driverRow(file)` — no `naive` argument. Measured: `--driver-headers` and `--driver-headers --naive` produce
byte-identical readings and differ only in the `mode` field. So a record can state that the naive matcher produced
its (precise) verdicts — the "record says what its producer did not do" shape the T-82 note closed one paragraph
earlier.
**requiredFix:** either pass `{ naive }` into the row builder for that run (keeping the audit's precise baseline
separate), or drop `--naive` from the usage block and from the `mode` vocabulary.
**evidence:** `raw/A-b1-driver-headers-live.stdout.txt` vs `raw/A-b2-driver-headers-naive.stdout.txt`;
`raw/FU2-head-precise.stdout.txt` vs `raw/FU2-head-naive.stdout.txt`.

### B2-F3 — `low`: the citation family's boundary is unstated, so two measured hazards read as "clean"
**file:** `scripts/check-citations.mjs` (usage/RULE block) + the records' `policy` block
**problem:** both hazards exit **0 with 9/9 green**, indistinguishable from "checked and clean":
(i) **an arm cited by POSITION** — `See the third assertion in lane A note for the constant.` → 9/9, no citation
recognised; (ii) **an abbreviated path** — `` `alphaSymbol`, `probe.ts` `` → 9/9, no citation recognised. Only a
form the extractor recognises can be judged, and the extraction family (a repo-relative literal with at least one
`/`) is stated only inside the regexes, never as a boundary a reader can apply. (The ellipsis form
`` `alphaSymbol`, `.../src/probe.ts` `` does redden — as an unresolvable path, i.e. by accident of the pattern, not
by a rule.)
**requiredFix:** one named boundary clause in the usage/RULE block AND in every run record's policy block: a
position citation (no literal) and a basename-only citation (no `/`) are OUT OF FAMILY and pass silently, because the
family's six addressing parameters require a repo-relative literal.
**evidence:** `raw/A-a3-position.stdout.txt`, `raw/A-a4-abbreviated-path.stdout.txt`, `raw/A-a4b-ellipsis-path.stdout.txt`,
`raw/A-control.stdout.txt`.
**scope note:** these two hazards are outside the lane's three frozen rows (T-78/T-80/T-82), which is why this is a
`low` declaration fix and NOT a demand for new machinery.

### B2-F4 — `low`: the reference filter exempts a whole LINE, and that third error direction is undeclared
**file:** `scripts/check-citations.mjs` (`parseHeaderClaims`, the `REFERENCE_MARKERS` filter)
**problem:** a claim line is discarded entirely when it carries any `design|acceptance|plan|§|t<nn>` token. Measured
pair: `// CHECKS A11 …` reddens (`CLAIMED-BUT-UNASSERTED A11`), while the SAME seed with `t21` on the line exits
**0** — a real claimed-but-unasserted key is silently missed. The audit declares two matcher-error directions; this is
a third, undeclared one, and it points the same way ER-2 exists to prevent (under-report).
**requiredFix:** declare it in the audit's `matcher_error_directions` (or the policy note) as a measured third
direction, or scope the exemption to the TOKEN rather than the line.
**evidence:** `raw/FU4-seed-claimed.stdout.txt` (contaminated seed, exit 0) vs `raw/FU4b-seed-clean.stdout.txt` (clean
seed, exit 1).

### B2-F5 — `low`: the "absence is checkable" arm is not re-takeable at its own command
**file:** `evidence/gates/wave2b-laneB2/20260917T142452Z/result.json` (`addendum_A3_anchor_scan`)
**problem:** the recorded reading is `0 matches in 11 files`; re-running the lane's EXACT command at my moment gives
**4 matches in 16 files**, and all four are the scan's own artefacts inside the scanned root
(`anchor-scan-id/result.json`, `anchor-scan-id/output.log`, and the lane's `result.json` at its two recorded command
lines). The scan writes its record INSIDE the tree it scans, and that record carries the literal — so the first run
poisons every later re-take, and a reader cannot distinguish "the mailbox id is absent" from "the pattern now lives in
the scanner's own output".
**requiredFix:** state the self-reference (name the matched paths as the scan's own records) and either write the
scan's output outside the scanned root or state the exclusion in the command, so the 0 is re-takeable.
**evidence:** `raw/FU7-anchor-ee9ec16.stdout.txt`, `raw/FU7-anchor-mine.stdout.txt`.

### B2-F6 — `low`: the record accounts for ONE default-root run; the tree holds TWO
**file:** `evidence/gates/wave2b-laneB2/20260917T142452Z/result.json` (`output_domain_and_immutability`)
**problem:** the lane's own output-domain rule is "every run this lane RECORDS passes an explicit `--out`", with a
declared exception naming exactly `run-2026-09-17T14-25-20.731Z`. Under `evidence/extensions/docs-claims/runs/` there
are **two** entries: `run-2026-09-17T14-24-29.334Z` (`output_target` "fresh timestamped run directory",
`negative_control` present, 21/21 — an earlier `--self-test` revision) as well as the named verbatim run. An auditor
of the lane's file set finds an unaccounted record.
**requiredFix:** name both (one sentence in the same declared-exception field, as a nested correction), or state that
the self-test artefacts of intermediate revisions are deliberately left in the legacy tree.
**evidence:** my own read of both `result.json` files + the lane's `declared_exception` string, captured in
`raw/FU-run-all.stdout.txt` context; see also `evidence/extensions/docs-claims/runs/`.

## §4 — The four measured hazards, each classified

| Hazard | Verdict | Evidence |
|---|---|---|
| line-number-only anchor | **CAUGHT** (exit 1, 2 rot anchors flagged) | `raw/A-a2-line-number-only.stdout.txt` |
| mailbox id used as evidence | **CAUGHT** by `--anchor-scan` (exit 1 on the seeded literal; exit 0 on an absent pattern) | `raw/A-d1…`, `raw/A-d2…` |
| arm cited by POSITION | **NOT caught, and NOT named anywhere** → B2-F3 | `raw/A-a3-position.stdout.txt` |
| abbreviated path | **NOT caught** (basename-only form); the ellipsis form reddens only as an unresolvable path → B2-F3 | `raw/A-a4-abbreviated-path.stdout.txt`, `raw/A-a4b-ellipsis-path.stdout.txt` |

They are outside the lane's three frozen rows (T-78/T-80/T-82); the failure I report is the SILENCE, not the
exclusion.

## §5 — ER-2 / T-92 discipline: satisfied on the lane's OWN subject, and correctly NOT inherited

- the audit **names its directory** (`./skills/dsh-qa/scripts/`, recursive) and reports a **per-directory split**
  (45 + 8 files at its moment; 46 + 8 at mine) with key-producer/claim/violation counts per bucket;
- **both matcher-error directions are declared AND reproducible**: over-report 1 file / 2 keys vs 0 (I re-derived it
  on the HEAD corpus), under-report 1 vs 2 and 0 vs 2 (my own `ls`/`grep` instrument);
- **lane A's `25 self-fix-tests/** + 17 test/** = 42` split is explicitly NOT inherited**, with the reason stated in
  both the code comment and the record — the correct reading of ER-2 ("measures a DIFFERENT audit");
- the review contract's parenthetical that names 42 = 25 + 17 is therefore read as the SHAPE the discipline was
  established with, not as a number this lane must restate; applying it literally would have contradicted the frozen
  acceptance's own T-80 negation.

## §6 — No check was made green by weakening it

- the diff against the pre-t15 revision deletes exactly **three** lines: two import statements (replaced by wider
  ones) and the false sentence `// checker's intermediate revisions are diffable, not merely hash-comparable.` — no
  assertion was removed or loosened;
- the negative-control arm set went **9 → 12** and the total **22 → 25**; all nine old arm ids are still registered,
  and my `25/25` run shows every one of them `ok`;
- the two NEW arms are falsifiable (B2-F1-adjacent §2 table: `t78` FAILs when the rules block is stripped, `t82`
  FAILs when retention is disabled) — neither is a check that cannot fail;
- the T-82 sentence is now TRUE by construction (retention exists, verified byte-wise), not re-worded.

## §7 — Boundary: the tree moved under this review (recorded, not chased)

- `skills/dsh-qa/scripts/tui-team-surface.mjs` and `…/lib/settings-bridge-lane.mjs` were edited by lane D at
  14:35:00Z and after 14:35:43Z (the T-80 claim blocks — the lane B2 hand-off, hop i), and a NEW driver
  `skills/dsh-qa/scripts/wave2b-lane-d.mjs` appeared (54 vs 53 files). My live reading is pinned by the driver
  hashes recorded BEFORE and AFTER the scan (`f18e3b3a…`, `826a39d4…`, unchanged across the scan).
- the lane's live 0-violation reading is a MOMENT reading and was correct for the pre-claim corpus it measured
  (reproduced by me on the HEAD blobs: 2 producers, 0 claims, 2 NO-CLAIM-SET, 0 violations).
- **a second seat is/was writing into this review's own evidence slug**: `evidence/review/wave2b-laneB2/20260917T142943Z/`
  belongs to another reviewer's attempt at this same task (`agent-teams-engineer`, verdict `needs_revision`), which
  converged with three of my findings and contributed B2-F6, which I re-took myself before reporting it. The
  coordination fact (two seats producing one review task's evidence) is the captain's to resolve; I did not touch
  that directory.

## §8 — What I did NOT verify (explicit bounds)

- I did **not** falsify the `immutability-second-run-refused` arm itself — only its underlying behaviour (a second
  run at the same `--out` exits 3 with the refusal message). Treat that arm as **behaviourally reproduced, not
  falsified**.
- I did **not** run any of the six repo-wide aggregates the lane's acceptance forbids for this lane, nor
  `--gates` (it spawns lane B3's `verify-docs-parity.mjs`); every command above is lane-scoped.
- I did **not** verify lane A's T-92 `42 = 25 + 17` numbers (a different audit, out of this lane).
- I did **not** test the position / abbreviated-path hazards against any other lane's rules — only that lane B2's
  checker does not catch them.
- My instrument for the repo-wide key-producer count is `grep` with the checker's own key pattern (27 hits), which
  differs from the checker's `walkFiles` count (25) exactly by the two copies under a `node_modules` directory — the
  predicate, not a disagreement.
- `evidence/gates/wave2b-laneB2/**` and `scripts/check-citations.mjs` were **not** modified by this review (the
  checker is out of scope; the lane's records are sealed).

## §9 — The one thing to change first, and what must NOT be built

**First:** land ONE nested correction under `evidence/gates/wave2b-laneB2/20260917T142452Z/` carrying the re-taken
count (B2-F1), the self-reference statement for the anchor scan (B2-F5) and the second default-root run (B2-F6) —
three record-truth items, one sealed-record-adjacent artefact, no code change.

**Must NOT have:** no new checker arms, no re-anchoring of the 249 recorded citations, no rewrite of the sealed
`result.json`/`output.log` files, no edits to `skills/**` (lane D's corpus) or to `scripts/verify-docs-parity.mjs`
(lane B3's), no re-run of the six repo-wide aggregates, and no widening of the lane's three rows.
