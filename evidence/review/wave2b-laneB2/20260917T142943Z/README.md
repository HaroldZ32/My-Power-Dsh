# rev-B2 — independent falsification of wave-2b LANE B2 (T-78 · T-80 · T-82)

**Reviewed task:** `t15` (impl-B2, attempt `9371ef07-b30b-4d23-bdb2-fb9109d97e58`).
**Reviewer:** `agent-teams-engineer` (lane A author — independent of B2 by authorship; task `t21`, attempt
`1f218cba-384f-468f-abbd-33a8070ad721`).
**Verdict: `needs_revision` — the task FAILS on 4 structured findings** (F2 is the substantive one;
F1/F3/F4 are single-sentence repairs).

**Judged against** the lane's DONE-WHEN, not the register's prose:
`evidence/requirements/wave2b-laneB2/20260917T1410Z-wave2b-laneB2-acceptance.md` =
sha256 `514ded6d797217d568bed4e9e330efdcbb02ad16c8f419958cd9e90d7e9e3714` (182 lines: body to
"VERDICT OF THIS FREEZE" + ADDENDUM A), read in full.

**Pinned revisions (T-89 / T-90: a citation is a hash + a moment, never a position):**

| artefact | revision | note |
|---|---|---|
| `scripts/check-citations.mjs` (worktree) | `fbdc02569a8be827745c13dadaec63eb2353ab1380d245ac6a275a2381779f28` | == the lane's recorded `after` |
| `scripts/check-citations.mjs` at `HEAD` | `c86f00cc978863ea28354f4f7ea45ad3a628a84b54b7008082d2d8e581ac5112` | == the lane's recorded `before` |
| frozen superseded revision | `dfe260902b8ec1f1e8f0858126ea5466c0915563fbd231a898179f28c66da65c` | byte-untouched, re-measured |
| `HEAD` | `ca780331abdaecdef2e35ad7cad643bb69d86d90` | whole review |

`HEAD`-vs-worktree equality on BOTH endpoints is what makes the captured diff
(`raw/git-diff-check-citations.diff`, 466 added / 3 removed lines) **exactly** this lane's edit: no
other writer's uncommitted bytes are mixed into the change I reviewed.

---

## 1. What REPRODUCED (criterion 1, first half)

Every reading the lane's acceptance artefact names was re-taken by me on the pinned revision, with
FULL output kept under `raw/` (never a `tail`). My commands point `--out` INSIDE this review's own
in-scope evidence dir, because the contract's verbatim `node scripts/check-citations.mjs` writes the
legacy default root (see F4).

| reading (the lane's record) | lane's value | mine | command / log |
|---|---|---|---|
| scoped citation run | 13/13, 0 failed, 249 citations, 19 symbol-first, 30 line-dependent, 0 rot, 0 pending, 12 illustrative | **identical** | `raw/R1-run.stdout.txt`, `run-verbatim/result.json` |
| `--self-test` arms | 25/25, 0 failed | **identical**, arm-by-arm set equal (12 named arms) | `raw/R2-selftest.stdout.txt` |
| T-80 fixture arms | 3/3 | **identical** | `raw/R3-driver-headers-selftest.stdout.txt` |
| live driver scan | 53 files (45 + 8), 2 key producers, 0 claim sets, 2 NO-CLAIM-SET, 0 violations | **identical on the lane's revision** | `raw/R11-reconstructed-head-live.stdout.txt` |
| audit: over-report | 1 file / 2 keys vs 0 | **identical**, re-derived with MY OWN scanner (`raw/audit-remeasure.py`) on a `git archive HEAD` reconstruction: settings-bridge naive claims {1,2,3,4,6} vs keys {1..5} = 2 mismatches, tui naive claims empty → filtered by the `claims.length > 0` rule = 1 file | `raw/R12`, `raw/R9-audit-remeasure.json` |
| audit: non-recursive glob | 1 vs 2 | **identical** | `R11` + independent scan |
| audit: `.js` assumption | 0 vs 2 | **identical** | `R11` + independent scan |
| audit: whole-repo literal scan | 25 vs 2 | **identical** (my own repo-wide walk: 25 key-producing `.mjs`) | `R9` |
| retained revisions | `checker.mjs` = `fbdc0256…`, `superseded.mjs` = `dfe26090…` | **identical hashes** in the run dir | `sha256sum evidence/gates/…/citation-run/revisions/*.mjs` |
| addendum A(3) anchor scan | 0 matches in 11 files at `14:25:20.609Z` | **reproduces on its moment's file set**: of the text files whose mtime predates that moment, NONE contains the literal; the 3 that do are the scan's OWN records, written after it | `raw/R5` + the mtime reconstruction in this README §7 |

## 2. What I FALSIFIED (criterion 1, second half: every instrument shown to REDDEN)

| instrument the lane touched | seeded rot | result |
|---|---|---|
| T-78 arm (`negative-control:t78-record-carries-the-rule`) | a COPY of the checker with the record's `rules` block **emptied** (byte-verified: `doc_rewrite` object gone, 71459 → 70622 B; the negated copy's own record carries the RULE **0** times and the COMMAND **0** times vs **1/1** in the control) | the arm prints **FAIL** in the negative copy and **ok** in the pristine control (`raw/E6c-neg-selftest.stdout.txt`, `raw/E6c-ctl-selftest.stdout.txt`) — the arm really does assert the RECORD'S BYTES |
| T-80 claimed-but-unasserted | corpus copies with a header claim the code never produces | **exit 1**, naming `A6, A7, A8, A9` + the driver PATH + the header phrase (`raw/E5a-…`) |
| T-80 asserted-but-unclaimed (near miss) | corpus copy whose header under-claims | **exit 1**, naming `A4, A5, A6, A7, A8, A10` + the PATH (`raw/E5b-…`) |
| citation rot (line-number-only anchor) | my own fixture doc | **exit 1** with `line-number-only anchor \`src/probe.ts:2\`: a line number is not a citation` (`raw/E-e2.stdout.txt`) |
| T-90 anchor scan | my own doc containing a mailbox-record-id-shaped anchor | **exit 1**, naming the file, the line and the phrase (`raw/E1b-anchor-scan-seeded.stdout.txt`) |
| T-82 retention | my own one-line change between two runs of a PRISTINE copy | changed pair diff **non-empty at line 2 (`// ARM CHANGE B`)**, unchanged pair **EMPTY**, and the same-copy pair **EMPTY** as the mirror control (`raw/E8b-diff-*.txt`, 440/0/0 bytes) |
| immutability guard | a second run at the same `--out` | **exit 3**, `refusing to overwrite the existing retained revision (the running checker)` (`raw/R7-immutability.stderr.txt`) |

**My own instrument failures, recorded rather than hidden** (nested corrections, the discipline this
wave asks for): the first two attempts at falsifying the T-78 arm measured NOTHING and are preserved
as such — (a) `run-seeded-arms.sh` arm "E6" asserted `"doc_rewrite" not in file`, which the HEADER
COMMENT naming `rules.doc_rewrite` makes false, so the strip never ran and a pristine copy produced an
identical 4278 B record in the "negative" and the control runs; (b) `e6b-falsify-t78-arm.sh` asserted
the RULE STRING was absent from the FILE, which is impossible because the arm's OWN constants carry
the same literal. Only the third attempt (`e6c`) — which keeps the file valid and empties the REPORT's
`rules` block — falsifies the arm. A reviewer who reported attempt (a) as a pass would have certified
an arm that never went red.

## 3. Criterion 2 — the four citation hazards, and the finding

| hazard (my acceptance §2) | caught by the lane? | declared out of the lane's scope? |
|---|---|---|
| a LINE-NUMBER-ONLY anchor | **YES** — flagged as rot, exit 1 (`E-e2`) | — |
| a MAILBOX ID used as evidence | **YES** by the checkable instrument the lane built for it (anchor scan, F5's six parameters named, exit 1 on my seeded hit) | — |
| an arm cited by **POSITION** | **NO** — `See the third assertion in lane A's wave-2a note` produces exit 0, `9/9 checks passed`, **0 citations checked** (`raw/E-e3.stdout.txt`) | **NO** |
| an **ABBREVIATED PATH** | **NO** for a basename (`\`alphaSymbol\`, \`probe.ts\`` → exit 0, 9/9, 0 citations checked, `raw/E-e4.stdout.txt`) — the ellipsis form `.../src/probe.ts` IS caught, but only as a non-existent path (`E-e4b`) | **NO** |

A grep over the checker, the lane's evidence and the lane's acceptance artefact
(`grep -rniE 'basename|abbreviat|position-?only|ordinal|cited by position|cannot see|not checkable|blind'`
over `scripts/check-citations.mjs`, `evidence/gates/wave2b-laneB2`,
`evidence/requirements/wave2b-laneB2`) returns **zero hits**: neither the
lane's surface nor its freeze names the two silent classes. That is F2 below. The lane's own stated
principle — "either policy is acceptable, silence is not" (its acceptance's T-80 neg control (a)) —
therefore does not hold for the classes its matcher cannot see.

## 4. Findings (structured; they FAIL this task)

- **F2 · medium · a silent class beside a checked one.** Problem: two of the four hazards the review
  is required to test pass with exit 0 and are never named as uncheckable — a positional/ordinal arm
  (no path, no symbol) and a basename-only path (the checker's path pattern requires at least one
  `/`, so both shapes are invisible to `analyze()` rather than reported). The lane's surfaces document
  what it DOES catch (policy: claimed-but-unasserted / asserted-but-unclaimed / NO-CLAIM-SET /
  reference lines) and what it CANNOT (nothing), so a reader cannot tell "checked and clean" from
  "not in the family". Required fix: add one named boundary clause to the checker's usage/RULE block
  AND to every run record's policy block, in the lane's own vocabulary — e.g. «OUT OF FAMILY (silently
  uncheckable): an arm cited by POSITION (no literal), and an abbreviated path (a basename with no
  `/`); the family's six addressing parameters require a repo-relative literal» — so the two classes
  are declared instead of silent. Evidence: `raw/E-e3.stdout.txt`, `raw/E-e4.stdout.txt`, and the
  zero-hit grep above.
- **F1 · low · an advertised flag with no effect.** Problem: the lane's record advertises
  `--driver-headers [--self-test] [--dir <dir|file>] [--naive]` as a mode, and the flag is read in
  `driverHeadersMain`, but the ROWS are built with `driverRow(file)` — `naive` is not passed — so
  `--driver-headers --naive` and `--driver-headers` produce IDENTICAL readings and differ only in the
  record's `mode` string. Measured on both revisions (HEAD reconstruction `R11` == `R12`; current tree
  `R13` == `R14`). A reader who runs the flag gets the precise matcher under a "naive matcher" label.
  Required fix: either wire it (`driverRow(file, { naive })`, keeping the audit's own precise baseline
  separate) or drop `[--naive]` from the advertised usage and from the record's `mode` vocabulary.
  Evidence: `raw/R10-driver-headers-naive.stdout.txt`, `R11`/`R12`, `R13`/`R14`.
- **F3 · low · a recorded reading that does not reproduce.** Problem: the lane's record stores
  `revisions.durable_checker.lines = 1143` for the very artefact its own `after` hash pins
  (`fbdc0256…`); the artefact measures **1146** (`wc -l` = 1146 and `awk 'END{print NR}'` = 1146; the
  file ends with a newline, so both agree). Required fix: re-measure and correct the number (or drop
  it — the hash is the identity, the count is decoration that can rot). Evidence: this README's §"line
  count" measurement; `evidence/gates/wave2b-laneB2/20260917T142452Z/result.json` = `2a80a50f…`.
- **F4 · low · one default-output run explained, two exist.** Problem: the lane's record declares
  exactly ONE exception to its own "every run passes an explicit `--out`" rule (the contract's verbatim
  verify, no `--out`), naming the legacy default root. But TWO default-root runs exist:
  `evidence/extensions/docs-claims/runs/run-2026-09-17T14-24-29.334Z` (a `--self-test` run: 21/21,
  12 arms, `output_target: fresh timestamped run directory`) and `…run-2026-09-17T14-25-20.731Z`
  (13/13, no arms — the verbatim verify). Required fix: name BOTH in `declared_exception` (or re-run
  the self-test with `--out`), so the record's rule and its file set agree. Evidence: the two
  `result.json`s above; `run-set.log` = `e63b94d1…`.

## 5. Criterion 4 — no check was made green by weakening it

Measured, not reasoned: the arm-id set went **9 → 12** with **nothing removed** (`negative-control:*`
ids diffed `HEAD`-vs-worktree; the three additions are `t78-record-carries-the-rule`,
`t82-retention-diffable`, `immutability-second-run-refused`); the only three removed lines in the whole
diff are two import statements and one comment line. The narrowing surfaces the lane added are stated
AND printed: a header line naming another artefact's numbering is a REFERENCE — counted and printed
per driver, never dropped; NO-CLAIM-SET is REPORTED with the file and its keys, not silently passed
(the excluded class is named in both cases). The `reference_lines` filter is the one narrowing that
COULD hide a rot, and it is falsifiable: it is exactly the class a whole-header token scan
over-reports, and the audit measures that over-report on itself (1 file / 2 keys).

## 6. Bounds — what this review did NOT verify

1. **The lane's revision is not the tree's revision any more.** `skills/dsh-qa/scripts/…` (lane D's
   corpus) moved at **14:35:00Z / 14:35:45Z**, after the lane's live scan and after my first
   reproduction, while this review was running; the same command now reports 54 files, **2 claim
   sets, 0 NO-CLAIM-SET, 0 violations** (`R13`) — i.e. HOP i's corpus edit landed and the T-80
   conformance now holds on the CURRENT revisions `f18e3b3a…` / `826a39d4…` (HEAD revisions being
   `91a05314…` / `f69c6f61…`). I did not touch those files; the lane's readings are therefore
   reproduced on a `git archive HEAD` reconstruction, hashes verified equal to the HEAD blobs.
2. **No repository-wide aggregate was run** (no `verify:gates`, `test:qa`, `test:qa:all`,
   `verify-vendor`, `verify-dist-fresh`, `typecheck`), and no `bun test` — the lane is a script lane
   whose verify is its own checker; nothing here certifies the rest of the tree.
3. **The citation checker's subject documents** (`docs/**`, `EXTENSIONS-FOR-AGENTS.md`) were judged
   only through the lane's tooling; I did not audit their prose.
4. **The `--gates` path** (which spawns B3's docs gate) was NOT run — the lane's own acceptance puts
   it out of the verify list by name; its behaviour is therefore unverified by me.
5. My anchor-scan re-run over the lane's FINISHED directory cannot return 0 matches (it returns 4 in
   16 text files), because three of the files containing the literal are the scan's own records —
   the reading is moment-bound BY CONSTRUCTION, and the lane stated its moment. Its moment's file set
   is pattern-free (measured), which is the strongest form of the reading available.

## 7. Recorded measurements behind §1's last row and F3/F4

- anchor-scan moment: `run_at 2026-09-17T14:25:20.609Z`, `files_scanned 11`, `matches 0`; of the text
  files under that run dir whose mtime predates the moment, **0 contain `ee9ec16`**; the 3 that do
  (`anchor-scan-id/output.log`, `anchor-scan-id/result.json`, `result.json`) all postdate it.
- line count: `scripts/check-citations.mjs` → `wc -l` 1146, `awk END{NR}` 1146, trailing byte `0a`.
- legacy default-root runs: `14-24-29.334Z` = 21/21 with 12 arms (a `--self-test` run);
  `14-25-20.731Z` = 13/13 without arms (the verbatim verify).

## 8. Scratch derivation and reproducibility (T-89)

Scratch is built OUTSIDE the workspace and DELETED inside the same bash call that consumes it, because
this harness gives each bash call a FRESH `/tmp` (AGENTS.md T-23) — a scratch built in one call is gone
in the next, which cost this review one full fixture set before I measured it. The derivation is on
disk so a re-runner can rebuild exactly what I ran: `raw/scratch-derivation.v2.sh`,
`raw/run-seeded-arms.sh`, `raw/e6b-falsify-t78-arm.sh`, `raw/e6c-falsify-t78-arm.sh`,
`raw/reconstruct-head-corpus.sh`, `raw/audit-remeasure.py`. No path outside
`evidence/review/wave2b-laneB2/**` was written by this review; no git command other than read-only
`show`/`archive`/`status`/`diff` was run.
