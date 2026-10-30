# P1 docs report — resumable activation, live producer, lossless supervise (T3, docs-qa)

**Contract:** `.mpd/plans/cellwork-remediation-p1.md` §5 (Docs) and §7 (declared bounds). This report
records the docs lane: the four human-facing twins, re-checked against the FINAL implementation (T2
complete) and the frozen contract.

**Branch:** `fix/cellwork-resume`. No git write of any kind (the captain is the only writer). No
`src/`, `dist/` or test file touched; `git status` shows only the four twins plus this evidence dir.

**Files changed (4 twins, same commit when the captain commits):**

| File | Change |
|---|---|
| `packages/mpd-cellwork-plugin/README.md` | Guard table: captain allowlist gains the exact name `mpd_verify_open` (every other `mpd_verify_*` refused). New «Resumable activation» bullet (per-artifact checkpoint, `cell-activation-partial`, phase semantics, live-roster reconciliation, board-id reuse, loop per code task missing from `activatedLoops`, `activatedRevision` only after dispatch). New «Lossless tool results» bullet. «Verify-loop producer» rewritten: producer = the captain's LIVE agent/session, `producer: cellwork:<cellId>` only as DATA on the contract, self-writer loop inert, refusal before any write without a live caller. |
| `packages/mpd-cellwork-plugin/README.zh-CN.md` | Same three changes, mirrored. |
| `docs/cellwork.md` | «The four phases» #3: a part-way failure does not wedge the cell; phase left as it was. New `### A failed activation resumes` (in-flight fields, `cell-activation-partial`, resume rules, `activatedRevision` on success, refusals). Tool table: `cellwork_activate` resumable, `cellwork_supervise` lossless. Guard table: exact-name `mpd_verify_open`. `state.json` field list names `activationInFlight` and `activatedLoops`. Two Declared-bounds bullets (producer = captain's live session; resume is not a transaction). Test bullet names the resume arms. |
| `docs/cellwork.zh-CN.md` | Same changes, mirrored (heading tree identical, switch links untouched). |

## 1. Re-check against the final implementation (symbols, not line numbers)

| Claim in the twins | Final code | Verdict |
|---|---|---|
| Two optional state fields, version unchanged, old record readable | `CellState.activatedLoops` / `CellState.activationInFlight`; `newCellState` seeds `{}`/`null`; `normalizeCellState` reads an old record as `{}`/`null`; `CELLWORK_STATE_VERSION` stays 1 | matches |
| Partial persisted after EACH artifact under `cell-activation-partial`, phase untouched | `ActivateDeps.checkpoint` called after each contract, member, task and loop; `persistPartial` in `cellwork_activate` writes `activationInFlight` + merged `members`/`activatedTasks`/`activatedLoops` with the event name; no `phase` override | matches |
| Retry of the SAME revision resumes; different revision refused with a teaching error; already-materialised and stale refused | `cellwork_activate`: `activationInFlight !== acceptedRevision` refusal; live-agent refusal first; `activatedRevision !== null` forward-only refusals; stale-split refusal kept | matches |
| Members reconciled from the cell record AND the live roster; duplicate `add_member` reused | `materializeSplit`: `liveRoster` seed merged into `existingMembers` (live `executorRef` wins); `is already on the roster` resolved from a fresh `recordFor` read and recorded in `reused` | matches |
| Board ids reused per split key; loops opened for every code task whose key is absent from `activatedLoops` (not `freshCode`) | `previous` seeded from `activatedTasks`; loop loop keyed on `deps.cell.activatedLoops`, condition `loopIds.has(task.key) continue` | matches |
| `activatedRevision` only after the dispatch pass succeeds | `materializeSplit` runs dispatch last and returns `ok` only after it; the `cell-activation` transition sets `phase:"executing"`, `activatedRevision`, `activationInFlight:null`, merged `activatedLoops` | matches |
| Producer = captain's live agent; cell id only as DATA; no synthetic session; refusal before any write without a live caller | `mpd_verify_open` called with `agent: deps.captainAgent`; `producerIdentity` used only for the contract's `producer: cellwork:<cellId>` line and journal; `sessionIdOf(exec.agent) === ""` refuses before any write; no `producerAgent`/`producerSessionId` remains in `src/` | matches |
| Only `mpd_verify_open` (exact name) is on the captain allowlist | `CAPTAIN_TOOL_NAMES = ["ask_user_question", "todo_write", "mpd_verify_open"]`; prefixes are `cellwork_`/`agent_teams_`/`mpd_memory_` only, so seat/evidence/record/escape stay refused | matches |
| `cellwork_supervise` projections are lossless | `superviseTaskRow` conditional-spread: `owner` omitted when absent; `unreadMail`/`wakeFailures` unchanged | matches (wording corrected, see drift D2) |
| Test arms named in the docs exist | `activate-resume.test.ts`: 8 arms (2nd loop/member/task, dispatch stage, live agent + data, duplicate roster, no live caller, pre-field record); `supervise-lossless.test.ts`: B1 ownerless task + B2 walk; `cellwork.test.ts`: A5 both directions | matches |

## 2. Drift list (draft → final; both languages fixed)

- **D1 (behaviour wording, all four twins).** The draft said "the phase stays `split`" on a failed
  activation. The final `persistPartial` leaves the phase as it was: `split` for an activation that began
  from `split`, but still `executing` for a partial RE-SPLIT of an executing cell (the phase never
  regresses). Corrected in the docs `executing` item, the `### A failed activation resumes` section, and
  the README «Resumable activation» bullet (EN + zh).
- **D2 (projection wording, README EN/zh).** The draft said the optional `owner` is "normalised"; the final
  `superviseTaskRow` OMITS the key (absence stays absence). Corrected to "OMITTED, never set to
  `undefined`" / "直接省略，绝不写成 `undefined`".
- No other drift: the remaining draft statements matched the final code as tabulated above.

## 3. Gate

Run from the repo root after the FINAL edit:

`bun run verify:docs` → **exit 0**

```
[verify-docs-parity] root=/home/haroldzhao/MyProj/DshProj/My-Power-Dsh pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS
```

Full output: `docs.log` in this directory (5,695 bytes).

## 4. Bounds

- Docs only: no `src/`, `dist/`, test, row, manifest or package.json edit; no commit/branch/stash.
- `bun test packages/mpd-cellwork-plugin` was NOT re-run by this lane (the writer ran it green, 71 pass;
  the docs lane's gate is `verify:docs`), and the contract is not re-verified here — verifier-a owns that.
- The twins describe the frozen contract and the final code; they do not claim a live end-to-end cell run,
  a dispatcher, or mail changes (none are in P1).
