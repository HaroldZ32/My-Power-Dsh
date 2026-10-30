# P2a blind verification — idle-member guard

**Task:** T8 (P2a-VERIFY). **Loop:** `loop-20261030T100405-801842` (contract `.mpd/plans/team-idle-member-guard.md`, 171 lines). **Verifier:** verifier-b (seat bound). **Writer:** dispatch-engine. **Verdict record:** `rec-20261030T103226-0e7ad4` (PASS, basis `blind`).

## Basis (read before the verdict; no implementation/test source opened)

- `.mpd/plans/team-idle-member-guard.md` — frozen contract §1–§7 + Amendment 1 (A1–A7). sha256 `e3995f868dc669521a399689e4544280eaac587fcc0ee8425164aaf5e119477f`.
- `packages/mpd-team-core-plugin/README.md` + `README.zh-CN.md` — the idle-member guard section and the "Known limits" lazy-spawn bound (sha256 in `sources.sha256`).
- Ran only: the repo gates, the QA case `--self-test`, and the real live case (exit 0). Did not read `packages/mpd-team-core-plugin/src` or its tests, and did not read the QA case script.

## Gates observed (evidence ids from `mpd_verify_evidence`)

| Gate | Result | Evidence id |
|---|---|---|
| `bun test packages/mpd-team-core-plugin` | 384 pass / 0 fail, 1725 expect, 26 files | `ev-20261030T102931-a9a313` |
| `bun run typecheck` | exit 0 | `ev-20261030T102922-ebeb47` |
| `bun run verify:comments` | PASS (483 files, 43847 declarations) | `ev-20261030T102925-1c67a1` |
| `bun run verify:docs` | PASS (52 pairs, 0 violations, 0 dead links) | `ev-20261030T102928-ec14ab` |
| `node scripts/verify-dist-fresh.ts` | 34/34 fresh incl. team-core dist (captain rebuild) | `ev-20261030T102930-39df2f` |
| `bun run test:qa` | all self-tests passed; case discovered and green | `test-qa.log` |
| `node scripts/verify-vendor.ts` | PASS after the single repin | `vendor.log` |
| case `--self-test` | PASS, 10 arms incl. negative controls | `qa-self-test.log` |

Unit arms (`packages/mpd-team-core-plugin/test/idle-guard.test.ts`, from the gate log): taskless pre-step marks + ONE directive + every tool denied; pending/claimed/in_progress open; completed/failed/cancelled idle; A2 assigned-task clear (tools allowed, no directive) and re-mark; Lead exempt; registered control seat exempt/released; unregistered `cell-*` not exempt; terminal team clears; one directive per turn; `agent/created` arms and `agent/disposed` releases; helper spellings (`executorRef`, owner name/handle).

## Live merge gate (required)

`bun skills/dsh-qa/scripts/team-idle-member-guard.ts` — real boot in an isolated DSH_HOME/HOME/workspace, local stub model, probe row staging+approving a two-member/one-task plan through the REAL `agent_teams_plan` tool.

- exit 0, `problems=[]`, `sessions {logs:3, owners:1, idle:1}`, `stubRequests=7`.
- `probe.json` approve record: members M1 `cell-owner` executorRef `db17a7e9-c65e-4aac-9bb6-8bd6e844c231`, M2 `cell-idle` executorRef `3ae71d2b-932d-418d-992b-44ed9e08886a`; task T1 owner `cell-owner` (both members spawned, so "zero calls" is about a spawned member).
- The case's harness-session-log assertions (its `proves`): the owner records an `agent_teams_task` call with a non-error result; the taskless member records ZERO `tool/call` rows and exactly ONE idle directive.
- Lazy spawn: NOT claimed (result `doesNotProve[0]`); §6.1 one-turn bound declared in the README.

## Bounds of this verdict

1. The live sandbox `/tmp/mpd-team-idle-member-guard-Gd26tc` was removed with the run, so I did not independently re-decode the raw session store; the live assertions are the case's own harness-session-log read (`result.json` `proves`/`problems`), not my re-derivation. The case's `--self-test` (10 arms, negative controls: tool call, missing/doubled directive, errored result, prose-only) is the falsifier for those detectors.
2. A3: the declared-verifier clause is DROPPED (the board has no separate declared-verifier field; the review task's `owner` is the reviewer). A3 permits this; the README states it.
3. Observation, not a finding (fail-safe): the README's "a session whose team record cannot be read is never marked" has no dedicated unit arm in the gate output; §4 does not require one, and the failure direction denies tools rather than authorizes, so it stays an unproven branch.
4. Not judged by me: P2 (cellwork call sites of `registerControlSeat`, per A5), P3/P4, and the bundle-wiring proof (`verify:rows`/`verify:manifest`; no row/manifest change here). Dist and the single `skills/**` re-pin are the captain's integration steps and were observed fresh/green.
