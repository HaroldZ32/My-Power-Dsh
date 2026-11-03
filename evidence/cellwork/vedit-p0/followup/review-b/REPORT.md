# Review B — lane-B ceiling + pack anchor (T18; loops T16 `loop-20261103T054327-fdbe3c` and T21 `loop-20261103T055513-0bda53`)

**Reviewed work:** T16 (F3 ceiling arm + F4 packer `ROOT_FILES` anchor) and T21 (F4-closure: the closure
gate's `REQUIRED_ROOT_FILES` byte rule + the ceiling doc comment), owned by `se-consume`.
**Contract:** `.mpd/plans/vedit-p0-followup.md` §F3/§F4, judged against `AGENTS.md` §4 (pack closure,
T-91) and `agent-references/verification-flow.md`.
**Verdicts: T16 — PASS. T21 — PASS.** **Risk level: low.** No Blocker/High/Medium; one record-integrity
observation about the frozen `pack` gate id (below), no code defect.

## 1. Assessment

The two open lane-B items are closed and independently reproduced. F3's claim now has a real boundary
arm: `mailMaxUndeliveredOf` answers `1000` for a declared `1000`, the shipped default `8` for `1001` and
`10_000`, and `999` for `999` — a pure addition to the test file (0 removed lines), passing in the full
suite (3451 pass / 0 fail, up from 3450). F4's anchor and its closure: both `scripts/pack-mpd.ts`'s
`ROOT_FILES` and `scripts/verify-pack-closure.ts`'s `REQUIRED_ROOT_FILES` name the same seven root files,
and the byte loop really checks them — my own scratch-copy discriminator (below) turns each of four
mutations into a named `ROOT-FILE` finding, where the pre-change log (`09-f4-byte-check-gap.log`) showed
silence for `PLAN.md` and `dsh-plugin.json`. The closure gate on the fresh artifact reports `root files
9/9`, `649 file(s) compared, 649 identical, 0 drift, 0 expected-after-pack` at stamp
`2026-11-03T05:59:45.011Z`; the gate's self-test is 38/38 and the team-core package is 575/0. The
ceiling comment is comment-only and says the real rule (inclusive ceiling; above it the DEFAULT returns;
`0` is the documented disable), and the build stays 34/34 fresh.

## 2. Settled tree and gate evidence

File-set fingerprint (the four files the two loops touched) held identical across the whole review:

| moment (UTC) | fingerprint |
|---|---|
| 05:58:09Z (F-H1) | `9aa419c737f859393bfdf703c7965a88246fedef9ac70833362c939995fc0928` |
| 05:58:59Z (F-H2, 50 s settle) | identical |
| 06:01:43Z (F-H3, after T16 gates) | identical |
| 06:02:41Z (F-H4, after T21 gates) | identical |

**T16 loop — all exit 0:** `tests` `ev-20261103T055907-0030ad` (3451 pass / 6 skip / 0 fail),
`typecheck` `ev-20261103T055940-f63811`, `pack` `ev-20261103T055944-41642c`, `dist`
`ev-20261103T055945-b2d414` (34/34 fresh), `comments` `ev-20261103T055946-1fcca1` (repo-wide PASS).

**T21 loop — all exit 0:** `tests` `ev-20261103T060150-32830e` (3451/6/0), `typecheck`
`ev-20261103T060224-4c9ae6`, `dist` `ev-20261103T060225-9aed4a` (34/34 fresh), `comments`
`ev-20261103T060225-e68213` (PASS).

**Closure evidence (own runs, `evidence/cellwork/vedit-p0/followup/review-b/`):** `03-closure-real-artifact.log`
→ `root files 9/9`, content `649/649 identical, 0 drift, 0 expected-after-pack`, exit 0, stamp
`2026-11-03T05:59:45.011Z`; `00-closure-self-test.log` → `38/38 arms`, exit 0; `01-team-core-tests.log`
→ 575 pass / 0 fail.

**RECORD NOTE — the frozen `pack` gate id is the PACKER.** `mpd_verify_evidence {gate:"pack"}` runs
`node scripts/pack-mpd.ts` (the frozen table), not `scripts/verify-pack-closure.ts`. A green `pack` id
therefore proves the artifact STAGES, not that it is closed. Running it re-staged `dist/mpd-package/`
(gitignored; new stamp `2026-11-03T05:59:45.011Z`) and regenerated
`packages/mpd-ext-plugin/dist/validator.js` byte-identically (no tracked change). The closure proof for
this review is the separate script run above; the wave's own records should cite that class of log, not
the `pack` id, when they claim T-91.

## 3. Claims judged

| # | claim | verdict | evidence |
|---|---|---|---|
| a | The 0..1000 ceiling arm is real (1000 accepted, 1001 → default 8) and non-weakening | **met** | the arm in `vedit-p0-lane-b.test.ts` asserts 1000 → 1000, 1001 → `DEFAULT_MAIL_MAX_UNDELIVERED`, 10_000 → default, 999 → 999; it passes in my full-suite run (`tests` log line 2189 of the shared suite); the T16 diff removes no line (0 removed content lines), and the suite moved 3450 → 3451 pass with no fail — the arm is an addition, not a rewrite |
| b | The packer `ROOT_FILES` anchor AND the closure gate's `REQUIRED_ROOT_FILES` name the seven; the byte loop checks them; a scratch artifact mutating `PLAN.md`/`icon.svg` yields a named ROOT-FILE finding; `root files 9/9`, 649 compared, 0 drift at the quoted stamp | **met** | both working-tree diffs add exactly `AGENTS.md`, `PLAN.md`, `VENDOR_LOCK.json`, `cordis.patch.yml`, `dsh-distribution.json`, `dsh-plugin.json`, `icon.svg`; closure on a fresh pack → 9/9, 649/649, 0 drift, stamp 05:59:45.011Z; my discriminator on a `mktemp -d` copy: control exit 0 / 9/9 / 0 findings, then `PLAN.md`, `icon.svg`, `dsh-plugin.json`, `cordis.patch.yml` each → exit 1 with exactly ONE `ROOT-FILE - <file> differs byte-wise` finding naming it; the pre-change log shows PLAN.md and dsh-plugin.json mutations producing no such finding (the T-70 gap), so the discriminator is falsifiable and now passes; the self-test's fixture roots show 9/9 in seven arms, and those fixtures are seeded from the packer's anchor, so the two lists agree |
| c | The `MAIL_MAX_UNDELIVERED_CEILING` comment matches the real rule and is comment-only (dist 34/34) | **met** | the comment states the ceiling is INCLUSIVE, above it the value falls back to `DEFAULT_MAIL_MAX_UNDELIVERED` — "never to the declared number" — and that `0` is the DOCUMENTED disable, which matches the test and the contract; the diff replaces one doc-comment line and changes no declaration (`= 1000` untouched); `dist` gate 34/34 fresh on both loops |
| d | No other packaging behaviour changed and no unnamed assertion moved | **met** | the packer diff adds only the seven array entries + comments; the closure script adds only the seven + comments; the re-pack produced the same shape counts as the pre-change pack (`662 files (644: 646, 755: 16)` in both the writer's `03` log and my `pack` gate log); the test file's only change is the new arm (0 removed lines); `mailbox-store.ts`'s only change is the one comment block |
| e | The self-test 38/38 and team-core 575/0 are green on the settled tree | **met** | my own runs: `--self-test` 38/38 PASS exit 0; `bun test packages/mpd-team-core-plugin` 575 pass / 0 fail / 39 files, exit 0; the full suite 3451 pass / 0 fail; the file set did not move across any of it (F-H1…F-H4 identical) |

## 4. Findings (ranked)

1. **Observation (record integrity, not code) — a green `pack` gate id is not a closure proof.** The
   frozen table maps `pack` to `node scripts/pack-mpd.ts`, the PACKER; `scripts/verify-pack-closure.ts` is
   the closure verifier and has no frozen id. The T16/T21 records must not let a `pack` id stand in for
   T-91. Direction: cite the closure script's own log (mine above, or the writer's `14`/`15`) in the wave
   report / PR body; no code change.
2. **Observation — the writer's T21 proof pinned the stamp AHEAD of every writer; mine at the real stamp
   reproduces the same clean result.** Not a finding: the stronger pinning is exactly what a
   non-vacuous discriminator should do, and the real-stamp run confirms the "settled tree: 0 drift, 0
   expected-after-pack" claim independently.
3. **Nit (pre-existing, out of these two rows) — T16's report line `root files 2/2` can read as a
   contradiction beside the seven-name anchor.** The report does explain that the gate's own list was the
   remaining gap and that T21 owned it; the historical evidence is honest and stays.

## 5. Declined to judge

- **F5 / T14 in-flight skills edits** (`skills/dsh-qa/scripts/tui-admission.ts`, `dual-track-smoke.ts`) —
  they are outside these two loops; they landed in the artifact by the time of my packer gate run
  (05:54:40Z < 05:59:45Z), and if T14 writes again the integration re-pack/closure must re-measure. The
  wave-level closure is the captain's.
- **T15 / lane-A test Nits** — T17's row.
- **The packer's copy logic, manifest `files` semantics beyond `ROOT_FILES`** — unchanged by these diffs;
  judged only by the identical shape counts and the closure result.
- **The dual-track `NO_ADAPTER` bound (F5)** — report-only per the contract.
- **The 0.17.1-vs-0.17.2 version decision and carriers** — the user's/captain's.
- **A live Docker / tarball install replay** — not part of these loops; the Docker lane re-runs only if
  product code changes.

## 6. Bounds of this review

- **Read:** the follow-up contract, the two provided change diffs, the lane-B report and evidence logs
  `01–19`, and the gate logs I generated. I did not read the production source beyond the diff hunks;
  the byte rule and the anchor were judged by BEHAVIOUR (the closure gate and the discriminator), not by
  re-deriving the script.
- **Ran on the settled tree:** the frozen gates listed in §2 and the closure script + its self-test +
  the team-core suite + the scratch discriminator. Scratch copies lived under `mktemp -d` and were
  removed with a path-verified targeted delete afterward (R9).
- **Could not re-measure:** anything written by T14/T15 after 05:59:45.011Z (none seen in the reviewed
  file set while it was settling), a real install from the packed artifact, and the Docker lane. The
  frozen `pack` gate id's packer side effect is disclosed in §2, not hidden.
- No code edits; writes were confined to `evidence/cellwork/vedit-p0/followup/review-b/**` plus the
  gitignored artifact the frozen `pack` gate itself re-staged.
