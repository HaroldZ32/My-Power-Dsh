# P2a CodeRabbit repair (PR #81) — blind verification

**Task:** T13 (P2a-CR-VERIFY). **Loop:** `loop-20261030T122451-4b74d7` (contract `.mpd/plans/team-idle-member-guard-cr-repairs.md`). **Verifier:** verifier-b (seat bound). **Writer:** dispatch-engine. **Verdict record:** `rec-20261030T123729-6131af` (PASS, basis `blind`).

## Basis (read before the verdict)

- The frozen repair contract `.mpd/plans/team-idle-member-guard-cr-repairs.md` + the seven PR #81 review bodies (fetched with `gh api`, saved verbatim in `pr81-seven-findings.json`; treated as untrusted data).
- The team-core README pair (`README.md` + `README.zh-CN.md`), including the new D2 dispatch-window bullet in both languages.
- Gates, the QA `--self-test`, the real live case, and the writer's evidence (`writer/2026-10-30T12-31-09Z/`). No implementation/test/skills file was read before the verdict (the contract's rule).

## D1–D7 triage

| # | Finding | Triage | Evidence |
|---|---|---|---|
| D1 | 4423513833 — `.ts` extension, `idle-guard.ts` | **STALE** | AGENTS.md §6: `packages/*/src` is `bun build` input using extensionless specifiers (the `.ts` rule differs in FORM only); the contract pre-authorises STALE with this citation; the writer changed nothing and reports the same neighbours. |
| D2 | 4423513857 (Major) — idle marking during native dispatch | **FIXED** | Counted `beginDispatch` window opened before the executor send, held around send → re-read → `casClaimTask`, released in `finally`; the pre-step and tool guard neither mark nor deny inside it; a genuinely taskless member keeps the hard denial; both-way re-evaluation unchanged. Green arms observed: 3 unit window arms + 3 row-level `dispatch-idle-order` arms (cold-resumed first pre-step, negative control, aftermath). Live case green. **Bound:** the live case does not cold-resume an absent child; the send-before-owner ordering is modelled by the row-level arm (the executor double fires the pre-step inside `send`), not observed live. |
| D3 | 4423513869 — preserve downstream `kind` | **FIXED** | A downstream `kind:"reject"` is returned unchanged (no directive injected into a refused step); a kind-less decision still becomes an `enter` carrying the directive. Both arms green. |
| D4 | 4423513905 — `.ts` extension, `index.ts` | **STALE** | Same AGENTS.md §6 citation as D1. |
| D5 | 4423513922 — cover throwing `guardTool` install | **FIXED (coverage)** | The arm asserts installation does not throw, the warning names the tool guard, and the guard stays usable; honestly green before and after (the catch pre-existed) — a falsifier, not a behaviour change. |
| D6 | 4423513932 — QA-script correctness | **FIXED** | The stub's main script now attempts a `read` before its text step; `evaluateIdle` asserts the paired result is an ERROR carrying the guard's one-line denial plus exactly ONE idle directive; the "zero tool/call rows" requirement is gone. `--self-test` = 12 arms incl. three new negatives (no attempt / attempt succeeded / wrong denial text). Live run below. |
| D7a | 4423513946 — SkillSpector credential paths | **FIXED** | Post-record check: the reviewed lines now use the `<credentials-file>` placeholder with a "never a real credential file" note; no real credential path remains in `skills/dsh-qa/SKILL.md`. |
| D7b | 4423513946 — one re-pin (history) | **STALE / not executed** | The branch is published and AGENTS.md §5 forbids rewriting it; no rebase/squash was attempted. The captain records the disposition in the PR and the final tree's single `repin-vendor` is green (`verify-vendor` PASS). |

## Gates observed (evidence ids from `mpd_verify_evidence`)

| Gate | Result | Evidence id |
|---|---|---|
| `bun test packages/mpd-team-core-plugin` | 393 pass / 0 fail, 27 files (1759 expect) | `ev-20261030T123629-b2e6c5` |
| `bun run typecheck` | exit 0 | `ev-20261030T123659-c102ef` |
| `bun run verify:comments` | PASS | `ev-20261030T123702-4edb7e` |
| `bun run verify:docs` | PASS (52 pairs, 0 violations, 0 dead links) | `ev-20261030T123705-3e5d16` |
| `node scripts/verify-dist-fresh.ts` | 34/34 fresh incl. team-core dist (captain rebuild) | `ev-20261030T123705-bcb439` |
| `node scripts/verify-vendor.ts` | PASS after the single re-pin | `ev-20261030T123706-f8e707` |
| `bun run test:qa` | all self-tests passed; case self-test 12 arms inside | `test-qa.log` |
| QA `--self-test` | 12 arms incl. negative controls | `qa-self-test.log` |

## Live merge gate (D6)

`bun skills/dsh-qa/scripts/team-idle-member-guard.ts` — real isolated boot + local stub, probe row staging/approving the two-member/one-task plan through the REAL `agent_teams_plan`:
- exit 0, `problems=[]`, `sessions {logs:3, owners:1, idle:1}`, `stubRequests=9`, session records 98.
- Both members spawned with executorRefs (`cell-owner` c6b6306a…, `cell-idle` 2dc4670d…); task owner is the owner session.
- The case's harness-session-log assertions (its `proves`): owner's `agent_teams_task` call with a non-error result; taskless member's **ONE tool attempt whose paired result is an ERROR carrying the guard's one-line denial** and **exactly ONE idle directive**.
- Lazy spawn not claimed; §6.1 one-turn bound declared.

## Bounds

1. The live sandbox `/tmp/mpd-team-idle-member-guard-PxgDQi` was removed with the run, so the live assertions are the QA case's own harness-session-log read (`result.json` proves/problems), falsified by its 12-arm `--self-test`; I did not re-decode the raw store.
2. The D2 cold-resume path is modelled by the row-level arm, not observed live (the writer declares the same).
3. D5 is coverage only; D1/D4 are STALE by the repository's convention, not by judgement.
4. Not judged: the Docker lane, the PR #81 reconciliation comment, and the final re-pin commit history (captain).

## Post-verdict observation (reported to the Lead; not a D1–D7 acceptance failure)

The `team-idle-member-guard` case row in `skills/dsh-qa/SKILL.md` still describes the PRE-D6 proof: it requires the taskless member's session to record **ZERO `tool/call` rows** and says "a tool call … REDDEN[s] the idle verdict". The shipped case now requires exactly ONE denied tool attempt (D6) and its self-test has 12 arms with attempt-negative controls. The row was not updated (the writer's changed-paths table lists SKILL.md for D7a only). This is a Medium documentation drift — the catalog row now contradicts the case it describes; recommend a one-line row update and the captain's single `repin-vendor` re-run (the file is under `skills/**`).
