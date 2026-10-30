# P1 CodeRabbit repair report (PR #80, findings F1/F2/F3)

**Contract:** `.mpd/plans/cellwork-p1-cr-repairs.md` (frozen 2026-10-30). The three review comments were read
in full from `gh api repos/HaroldZ32/My-Power-Dsh/pulls/80/comments` (ids `4422787251`, `4422787261`,
`4422787295`) BEFORE the code was changed. All three judged STILL-VALID and fixed.

**Branch:** `fix/cellwork-resume` (PR #80 head `aa3b373a`). No commit/branch/switch/stash; no dist rebuild;
no README/docs edit (docs-qa's).

**Evidence dir:** `evidence/cellwork/fix-activate/cr-repairs/writer/20261030T121103Z/`
(`red-first.log`, `tests.log`, `typecheck.log`, `comments.log`, `qa.log`, this report).

## 1. Fixes

| Finding | File | Change |
|---|---|---|
| **F1** (minor, `activate.ts`) | `packages/mpd-cellwork-plugin/src/activate.ts` | New module constant `CONTRACT_LOOP_PLACEHOLDER` shared by `buildContractDoc`/`withLoopId`; new `contractAlreadyNamesLoop(deps, taskKey)` (exists + placeholder absent, with the declaration comment `verify:comments` requires); the loop pass skips a KEPT task whose contract already names a loop (`armedByContract`), so no `mpd_verify_open` and no contract rewrite; the dispatch gate accepts that contract-proven arming. A fresh task, or a kept task whose contract still carries the placeholder, is still armed. |
| **F2** (major, `flow.ts`) | `packages/mpd-cellwork-plugin/src/flow.ts` | The in-flight refusal now fires ONLY when `acceptedRevision < activationInFlight` ("OLDER than the in-flight revision"). A strictly greater accepted revision supersedes the older partial, journaling `activation-in-flight-superseded {previous, by, reason}`; the materialisation reuses recorded rows via the existing reconciliation (kept ids reused, dropped keys cancelled). Same-revision resume unchanged. |
| **F3** (trivial, `flow.ts`) | `packages/mpd-cellwork-plugin/src/flow.ts` | `reused` declared in `cellwork_activate.output.schema.properties` (`array` of `string`, with a precise description); the tool description now states: opens a verify loop for EVERY code task that has none yet BEFORE dispatch; a failed pass is checkpointed and the SAME accepted revision resumes it; a newer accepted revision supersedes an older in-flight one. |

Tests added to `packages/mpd-cellwork-plugin/test/activate-resume.test.ts`:
- `F1:` old record (no `activatedLoops`, `activatedRevision` 1) + kept armed `auth-core` contract + kept
  `cli-core` contract back in its placeholder form + re-split → exactly ONE new `mpd_verify_open`
  (`cli-core.md`), `auth-core.md` byte-identical, the record's `activatedLoops` gains only `cli-core`,
  board rows remain the kept ones (2 staging + 4 split + the 1 replacement splitter row the update
  re-dispatched).
- `F2:` failed rev 1 (`activationInFlight=1`, 4 board rows, 1 loop) → requirements update → rev 2
  accepted (auth pair kept, CLI pair dropped, spec pair added) → activate rev 2 SUCCEEDS; the journal has
  one `activation-in-flight-superseded` row (`previous:1`, `by:2`); no duplicate row (8 board rows, 8
  distinct subjects); the kept `auth-core` keeps its rev-1 board id; `activatedLoops` = auth+spec;
  `cancelledTasks` = `cli-core`/`cli-review` and their live rows are kept; `phase:"executing"`,
  `activationInFlight:null`, `activatedRevision:2`.
- `F2:` a LOWER accepted revision is still refused — synthetic in-flight revision ahead of the accepted
  one → the "OLDER than the in-flight revision" teaching error.
- `F3:` literal-pin arm — the registered `cellwork_activate` schema declares `reused` (`array`/`string`
  with a non-empty description) and the description contains the three assembled behaviour phrases.

No existing arm was weakened, edited or deleted.

## 2. Commands and observed results

| Command | Exit | Observed |
|---|---|---|
| `bun test packages/mpd-cellwork-plugin` | **0** | 75 pass / 0 fail / 886 expect() across 5 files (71 before the repair + 4 new arms) |
| `bun run typecheck` (`tsgo --noEmit`) | **0** | no diagnostics |
| `bun run verify:comments` | **0** | 481 files, 43930 declarations — PASS |
| `bun run test:qa` | **0** | all self-tests passed |
| `bun run verify:docs` | not run | docs are docs-qa's task (T10); this lane edits no doc |
| `node scripts/verify-dist-fresh.ts` | not run | captain-integration after the pinned dist rebuild (contract §4) |

## 3. Red → green discriminator

`red-first.log` is `git archive HEAD packages` (PR #80 head `aa3b373a`, PRE-repair sources) + the repaired
test file, run in a scratch tree under `.mpd/tmp/` (removed afterwards). Result: **8 pass / 4 fail** — every
pre-existing arm passes, and all four repair arms fail for the finding's own reason:

```
(fail) F1: a pre-upgrade kept code task with an armed contract is skipped ...   [2 loop opens, expected 1]
(fail) F2: a newer accepted revision supersedes an older in-flight partial ...  [activation refused]
(fail) F2: a LOWER accepted revision still cannot supersede an in-flight one    [wrong refusal text]
(fail) F3: the cellwork_activate schema DECLARES `reused` ...                   [reused undefined]
```

On the repaired tree the same suite is **75 pass / 0 fail** (`tests.log`).

## 4. Bounds / what is NOT proven

1. **No dist rebuild and no real mount.** The F3 change is a TOOL_SCHEMA change, so the contract (§4)
   assigns its real-mount proof to the PR's CI Docker lane after the captain rebuilds `dist` with the
   pinned bun — this lane proves the registration objects offline only.
2. **F1 skips without recording the old loop id.** A pre-upgrade task's loop id is absent from
   `activatedLoops` (the field did not exist); the frozen contract's armed sentence is the durable
   evidence, and the dispatch gate accepts it. The cell record is therefore truthful about what it knows
   and is not back-filled with a value it never had.
3. **F2's lower-revision refusal is exercised on a SYNTHETIC record** (an in-flight revision ahead of the
   accepted one). The forward flow cannot normally produce it; the predicate is defensive and tested as
   such.
4. **No `verify:docs`/`verify:rows`/`verify:manifest`** in this lane: no doc/row/manifest file changed.
5. The dispatch in the F2 arm re-sends the kept pending work and pairs the new spec task — the board rows
   are asserted for count/subject uniqueness, not for delivery scheduling.

## 5. Findings outside scope

None. `git status` shows only `src/activate.ts`, `src/flow.ts`, `test/activate-resume.test.ts` and this
evidence directory; the docs twins and `dist/` are untouched.
