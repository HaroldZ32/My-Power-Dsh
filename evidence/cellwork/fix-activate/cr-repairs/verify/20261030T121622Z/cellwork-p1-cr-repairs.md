# P1 CodeRabbit repair contract (frozen 2026-10-30)

**Basis:** PR #80 CodeRabbit review (check SUCCESS, review state COMMENTED) — three actionable inline
comments. Full bodies are ON the PR; the writer must read them with
`gh api repos/HaroldZ32/My-Power-Dsh/pulls/80/comments --jq '.[] | select(.id==<id>) | .body'`:
- `4422787251` — `packages/mpd-cellwork-plugin/src/activate.ts` (Minor, functional correctness)
- `4422787261` — `packages/mpd-cellwork-plugin/src/flow.ts` (Major, functional correctness)
- `4422787295` — `packages/mpd-cellwork-plugin/src/flow.ts` (Trivial, maintainability)

**Branch:** `fix/cellwork-resume` (the P1 branch). The repair is a NEW commit on that branch; the PR #80
head changes, so the CodeRabbit review must be re-run and every finding reconciled in a PR comment.
**Writer:** cellwork-core. **Docs:** docs-qa. **Verifier:** verifier-a, a NEW loop, blind.
**Non-goals:** P2/P3/P4; no dispatcher, no mail, no workmate.

## 1. Findings and required outcomes (all three are STILL-VALID; fix all three)

**F1 — Minor, `activate.ts` around the loop pass (comment 4422787251).**
A cell activated BEFORE this change has no `activatedLoops`; `state.ts` reads it as `{}`. The loop
condition now covers every code task, so the FIRST re-split of such a cell re-runs `mpd_verify_open` for
every KEPT code task and rewrites its frozen contract — duplicate loops, and a contract a verifier may
already be reading is changed.
Required outcome: skip a KEPT code task whose `activatedLoops` has no entry BUT whose contract file
already names a loop id (the `withLoopId` placeholder is gone). Add a narrowly named helper
(`contractAlreadyNamesLoop`) that reads the contract path, returns true only when the file exists and no
longer contains the placeholder sentence the contract writes before a loop is armed, and carries the
precise declaration comment `verify:comments` requires. Do NOT rewrite a frozen contract. A task with no
loop (a genuinely fresh task, or a kept task whose contract still carries the placeholder) still gets
one. Add the arm: an OLD cell record (`activatedRevision` non-null, NO `activatedLoops`) + a kept code
task whose contract is already armed + a re-split → zero new `mpd_verify_open` calls for that key, the
contract bytes unchanged; a second task with the placeholder still gets its loop.

**F2 — Major, `flow.ts` around the `activationInFlight` refusal (comment 4422787261).**
An in-flight older revision still wedges the cell after a newer split is accepted: activation of rev 1
fails (`activationInFlight = 1`), the planner updates requirements, the splitter's rev 2 is accepted, and
`cellwork_activate` then refuses every call because `1 !== 2`; the refusal tells the caller to resume
rev 1 "while it is still the accepted split", but it is no longer accepted. The only exit is
`cellwork_stop`.
Required outcome: refuse ONLY when `acceptedRevision < activationInFlight` (a lower revision cannot
supersede); allow a STRICTLY GREATER accepted revision to supersede the in-flight older one, journal the
supersession (`appendJournal`, naming both revisions and that the older partial is abandoned), and
materialise the newer revision with the existing reconciliation (`activatedTasks`/`activatedLoops`/
members are reused where keys survive; the newer split's dropped work is cancelled per the re-split
rules). The same-revision resume stays. Add the arm: failed rev 1 partial → requirements update → rev 2
accepted → `cellwork_activate` rev 2 succeeds, the journal names the supersession, the old partial's
artifacts are not duplicated, the new revision's kept/dropped/cancelled rows are right; a lower revision
is still refused with the existing teaching error.

**F3 — Trivial, `flow.ts` around the `cellwork_activate` tool schema (comment 4422787295).**
The result returns `reused`, but the output schema does not declare it, and the description still says
"one verify loop per NEW code task" and does not say a failed pass resumes with the same revision.
Required outcome: add `reused` to `output.schema.properties` as `{ type: "array", items: { type: "string" } }`
with a precise description; update the description to: opens a verify loop for every code task that has
none yet BEFORE dispatch; a failed pass is checkpointed and the SAME revision resumes it; a newer
accepted revision supersedes an older in-flight one. Add a literal-pin arm asserting the schema declares
`reused` and the description contains the two behaviours (the test must assemble the literals, not paste
the whole string if a forbidden-literal scan applies).

## 2. Tests

Keep every existing arm green; add the F1/F2/F3 arms to `test/activate-resume.test.ts` (or the nearest
existing file) and record a RED-FIRST run against the pre-fix source (`git archive HEAD packages`), with
every new arm failing on the prefix and passing on the fix. Do not weaken or delete an existing arm.

## 3. Docs (docs-qa, after the code)

Update all four P1 twins (`packages/mpd-cellwork-plugin/README.md` + `.zh-CN.md`, `docs/cellwork.md` +
`.zh-CN.md`):
- the resumable-activation section: a newer accepted revision SUPERSEDES an older in-flight partial (the
  older is journaled and abandoned; refused only for a lower revision), alongside the same-revision
  resume;
- the loop rule: every code task that has NO loop gets one before dispatch, but a kept task from a
  pre-upgrade cell whose contract already names a loop is skipped and its frozen contract is not rewritten;
- the `cellwork_activate` tool row/description: `reused` is returned; the description's two behaviours.
Keep EN/ZH parity, headings, links, CJK; run `bun run verify:docs`.

## 4. Gates / evidence

Writer: `bun test packages/mpd-cellwork-plugin`, `bun run typecheck`, `bun run verify:comments`,
`bun run test:qa`; red-first log. Captain: rebuild
`packages/mpd-cellwork-plugin/dist/index.js` with the pinned bun, `node scripts/verify-dist-fresh.ts`,
`bun run verify:docs`, `bun run verify:gates`, and the PR's CI **Docker real-machine** lane (the output
schema change needs a real mount; the P1 PR check is the proof). Evidence:
`evidence/cellwork/fix-activate/cr-repairs/{writer,docs,verify}/<UTC>/`. The captain posts the PR
reconciliation comment (`F1/F2/F3 FIXED` with the commit and paths) and re-triggers CodeRabbit.

## 5. Verifier instructions (verifier-a, NEW loop)

Read THIS contract and the four P1 doc twins FIRST. Do not read `activate.ts`/`flow.ts`/the tests before
recording a verdict. Bind the captain's new loop. Run the checkable gates, read the writer/docs evidence,
and judge the three findings as FIXED/STALE/STILL-VALID against the contract. Record PASS/FAIL with
sources + a gate evidence id; a FAIL needs findings with the doc source. Do not fix anything. State the
bounds. Only a recorded FAIL unlocks implementation reading for diagnosis.
