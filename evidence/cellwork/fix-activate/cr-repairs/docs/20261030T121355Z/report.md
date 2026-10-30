# P1 CR docs report — supersession, loop arming, `reused` (T10, docs-qa)

**Contract:** `.mpd/plans/cellwork-p1-cr-repairs.md` §1 F1/F2/F3 and §3 (Docs). Basis: PR #80 CodeRabbit
findings `4422787251` (F1), `4422787261` (F2), `4422787295` (F3), all judged STILL-VALID and fixed by T9.
Branch `fix/cellwork-resume`; no git write of any kind.

**Files changed (4 P1 twins, +46/−20):**

| File | Change |
|---|---|
| `docs/cellwork.md` | `### A failed activation resumes`: the loop sentence now says a KEPT task from a pre-upgrade cell whose frozen contract already names a loop counts as armed (skipped, contract NOT rewritten; only a task with no loop or a placeholder contract gets one), and a new paragraph states that a NEWER accepted revision SUPERSEDES an older in-flight partial (journaled `activation-in-flight-superseded`, older partial abandoned, its recorded rows reconciled) with only a LOWER revision refused. `cellwork_activate` tool row: adds supersession and the `reused` answer list. `journal.jsonl` row: names the two supersession events. |
| `docs/cellwork.zh-CN.md` | The same three changes, mirrored. |
| `packages/mpd-cellwork-plugin/README.md` | «Resumable activation» bullet: the loop rule gains the pre-upgrade contract-armed exception (contract not rewritten, no second loop), a NEWER accepted revision supersedes an older in-flight partial while a LOWER one is refused, and the answer's `reused` list is named. Flow-tools sentence: `cellwork_activate` returns `reused`. |
| `packages/mpd-cellwork-plugin/README.zh-CN.md` | The same changes, mirrored. |

## 1. Re-check against the final implementation (symbols, not line numbers)

| Documented claim | Final code | Verdict |
|---|---|---|
| A kept task from a pre-upgrade cell (no `activatedLoops` entry) whose contract already names a loop is skipped; its contract is not rewritten | `contractAlreadyNamesLoop` (true only when the file exists AND no longer carries `CONTRACT_LOOP_PLACEHOLDER`); the loop pass does `if (keptKeys.has(task.key) && contractAlreadyNamesLoop(deps, task.key)) continue` | matches |
| A task with no loop, or one whose contract still carries the placeholder, still gets a loop | the skip needs BOTH a kept key and the armed contract; any other code task enters `mpd_verify_open`, and `withLoopId` rewrites the placeholder contract | matches |
| A NEWER accepted revision supersedes an older in-flight partial, journaled by name | the in-flight refusal fires only when `acceptedRevision < state.activationInFlight`; otherwise `appendJournal(..., { event: "activation-in-flight-superseded", previous, by, reason })` runs and the materialisation proceeds | matches |
| Only a LOWER revision is refused | the shipped teaching error reads "OLDER than the in-flight revision"; the "OLDER than the materialised revision" refusal is unchanged | matches |
| The same-revision resume still works | `acceptedRevision === state.activationInFlight` skips both the refusal and the supersession journal, and re-enters the reconciliation path | matches |
| The older partial's artifacts are reconciled, not duplicated | the existing `activatedTasks`/`activatedLoops`/live-roster reconciliation runs for every pass; dropped keys are cancelled | matches |
| The tool returns `reused` (declared in the output schema) | `cellwork_activate.output.schema.properties.reused` = `array` of `string` with a precise description; the result includes `reused: activated.outcome.reused` | matches |
| The description states the two behaviours | the registered description says the SAME revision resumes a failed pass and a newer accepted revision supersedes an older in-flight one, and that every code task with no loop is armed before dispatch (a kept contract-armed task is untouched) | matches |

## 2. Wording decisions

- The twins say the pre-upgrade skip is about a **KEPT** task whose **frozen contract** already names a loop
  — not a general "skip if a contract exists", which would misstate the code (a fresh task's contract is
  written before its loop; only the placeholder's absence proves arming).
- The twins name the journal event (`activation-in-flight-superseded`) and say the older partial is
  **abandoned**, because a reader of the journal must be able to tell a supersession from a resume.
- `reused` is described as "members resolved from the cell record or the live roster instead of raised",
  the same words the schema property uses, so the tool row and the schema cannot drift apart silently.

## 3. Gate

Run from the repo root after the FINAL edit: `bun run verify:docs` → **exit 0**

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS
```

Full output: `docs.log` in this directory. Heading parity holds (no heading added or removed in either twin),
the switch links are untouched, no link is dead.

## 4. Bounds

- Docs only: no `src/`, `dist/`, test, `skills/**`, row or manifest edit by this lane; no commit/branch.
- `bun test packages/mpd-cellwork-plugin`, `bun run typecheck`, `bun run verify:comments` and
  `bun run test:qa` are the writer's gates (T9) and are NOT re-run here; the docs lane's gate is
  `verify:docs`.
- The dist rebuild, `verify:dist-fresh`, `verify:gates` and the Docker real-machine lane are the captain's
  integration steps (§4); this lane changed neither `dist` nor a row.
- The twins describe the contract and the final code; they do not claim a live end-to-end run.
