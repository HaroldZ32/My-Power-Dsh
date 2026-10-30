# P2a writer report — idle-member guard (§3.1–3.3 + §3.5 + Amendment 1)

**Row:** T6 (P2a-WORK, owner dispatch-engine). **Contract:** `.mpd/plans/team-idle-member-guard.md`
(FROZEN 2026-10-30, plus §8 Amendment 1 — the seven T5 amendments are part of this acceptance basis).
**Branch:** `fix/team-idle-member-guard` (the captain's; the tree was clean at start). No commit, no
branch, no dist rebuild, no re-pin, no README/docs edit (docs-qa owns T7).

## 1. What changed (paths + symbols)

| Path | Symbols |
|---|---|
| `packages/mpd-team-core-plugin/src/idle-guard.ts` **NEW** | `IDLE_DIRECTIVE_TEXT`, `IDLE_DENIAL_TEXT`, `IDLE_PREAMBLE_TEXT`, `OPEN_TASK_STATUSES`, `IdleGuardSeams`, `IdleGuard`, `sessionIdOfAgent`, `memberForSession`, `memberHasOpenTask`, `findMemberTeam`, `withIdlePreamble`, `installIdleGuard` |
| `packages/mpd-team-core-plugin/src/index.ts` | the install block (`installIdleGuard` + its disposers) before the service publication; `MpdTeamsService.registerControlSeat`; the provided service method; `withIdlePreamble(...)` at BOTH spawn sites (`add_member` mid-run and `approve`) |
| `packages/mpd-team-core-plugin/test/idle-guard.test.ts` **NEW** | 21 arms: taskless mark + ONE directive + all-tools denial; `pending`/`claimed`/`in_progress` allowed; `completed`/`failed`/`cancelled` marked; **A2** marked + assigned → cleared (tools allowed, no directive); lead exempt; registered control seat exempt; unregistered `cell-*` NOT exempt; terminal team clears; one directive per turn; `agent/created` arms / `agent/disposed` releases a late member; the pure helpers |
| `packages/mpd-team-core-plugin/test/team-record.test.ts` | the spawn-prompt arm now asserts the idle preamble is the prompt's FIRST block (§3.3, Amendment A6) |
| `packages/mpd-team-core-plugin/test/team-door-guard.test.ts` | the registration arm now asserts **two** guards (team door + idle guard) and that dispose releases **both** |
| `skills/dsh-qa/scripts/team-idle-member-guard.ts` **NEW** | the live case: `evaluateOwner`, `evaluateIdle`, `toolCallCount`, `userTexts`, `buildOverlay`, `sessionLogs`, `selfTest`, `live` |
| `skills/dsh-qa/scripts/lib/team-idle-member-guard-probe.ts` **NEW** | the probe row (`name`, `inject`, `apply`): stages + approves a two-member/one-task plan through the REAL `agent_teams_plan` tool as the Lead's live agent |
| `skills/dsh-qa/SKILL.md` | one case row (`team-idle-member-guard`) |

**Amendment coverage.** A1: `installIdleGuard` registers `registerAgentPreStep` for every `liveAgents()`
entry and re-arms on `agent/created`, releasing on `agent/disposed` (the `session-gate.ts` route). A2: the
pre-step re-evaluates BOTH ways on every step — an open task clears the mark — with the three explicit
clears kept as the contract allows. A3: `executorRef` is the only handle matched; owner spelling accepted
as `member.name` OR `member.executorRef`; the "declared verifier" clause is dropped because the board has
no such field (the reviewer is the review task's `owner`). A4: `completed`/`cancelled`/`failed` are all
idle-terminal. A5: the registration API + the "unregistered `cell-*` is not exempt" arm ship here; the
cellwork call sites are P2's. A6: the preamble is applied at the executor hand-off. §3.4 lazy spawn was
NOT attempted → the one-turn bound stands (§6.1).

## 2. Commands and observed results (full log: `gates.log` in this directory)

| Command | Result |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **384 pass / 0 fail**, 1725 expect(), 26 files |
| `bun run typecheck` (`tsgo --noEmit`) | **clean** (no diagnostics) |
| `bun run verify:comments` | **PASS** — 483 files, 43847 declarations |
| `bun skills/dsh-qa/scripts/team-idle-member-guard.ts --self-test` | **PASS — 10 arms incl. negative controls**, exit 0 |
| `bun run test:qa` | **all self-tests passed**, and the new case is discovered and run (`[test:qa] team-idle-member-guard.ts` → self-test PASS) |
| `bun run verify:docs` | **PASS** — pairs=52 failed=0 violations=0 |
| `node scripts/verify-dist-fresh.ts` | **exit 1** — `FAIL - 1 of 34 targets not fresh (STALE: 1)`: `packages/mpd-team-core-plugin/dist/index.js` is stale against the changed src. **The captain rebuilds dist** (contract §5; T6 forbids me to). |
| `node scripts/verify-vendor.ts` | **exit 1** — `FAIL - asset skills treeSha mismatch`: this row changed `skills/**` (the case, the probe, the SKILL.md row). The single `repin-vendor --write --i-know-this-is-the-captains-step` is the captain's integration step (§9/§11; T6 forbids me to run it). |

A note on the log: its first capture piped the two gate commands through `tail`, so those lines' `exit=0`
was tail's status; the appended CORRECTION section re-ran both gates without a pipe and records **exit 1**
each with the gate's own FAIL line. Read the correction, not the piped status.

## 3. Red-first discriminator

- The unit suite **reddened on the change before the tests were updated**: 2 arms failed on the first run
  (`team-record`'s prompt assertion — the preamble was absent from the expectation — and `team-door-guard`'s
  "exactly one guard" count). Both were updated to assert the NEW contract behaviour (preamble first;
  two guards released), not weakened. That is the observed red.
- The new falsifiers are negative controls, not just positives: the idle-member arm goes RED when a
  tool/call row exists, when the directive is missing and when it appears twice; the owner arm goes RED
  on an errored result and on prose-only narration (answer narration is not tool evidence — AGENTS.md §7).
- The QA self-test pins the directive and denial LITERALS against the plugin source, so a paraphrase on
  either side reddens instead of silently passing both.
- The A2 arm is the deadlock discriminator: if the pre-step did not clear on an assigned task, the
  "marked + assigned → tools allowed + no directive" arm would fail.

## 4. What I could not prove (bounds)

1. **The live case was NOT run by me.** T6 assigns the real live run to the verifier (T8) after the
   captain rebuilds dist. The guard's live behaviour — a real teammate's spawn turn, the injected
   directive in the harness session log, zero `tool/call` rows — is therefore **UNVERIFIED by the
   writer**. The script exists, its offline falsifier passes, and it FAILS (never skips) on a missing
   `dsh` binary, a failed install, a failed boot or a missing verdict.
2. **dist is stale until the captain rebuilds** (`verify-dist-fresh` exit 1, above). The QA case and the
   verifier must run against the rebuilt module.
3. **The vendor gate is red until the captain's single re-pin** (`skills/**` treeSha). I did not run the
   re-pin.
4. **No bundle-row mount proof is claimed**: the row id and module path did not change, so no patch/mount
   change is in this diff; the mount lane is not re-run here.
5. **Lazy spawn is not claimed.** The spawn turn still costs one model turn; the guard makes it a
   zero-tool turn whose single directive ends it. The case declares this rather than proving session
   absence.
6. **Pre-step cost**: the listener resolves the live team set from disk on every step of every live agent
   (no cache, deliberately — a cache could miss the A2 clear). The cost is small for the team sizes this
   bundle sees but was not measured on a large board.
7. If the harness does NOT run a turn for a freshly spawned member, the live case will find no idle
   directive and FAIL. That is the intended falsifier, stated here so a red is not mistaken for a skip.

## 5. Evidence index

- This report: `evidence/team/idle-member-guard/writer/2026-10-30T10-21-43Z/report.md`
- Gate log (with the corrected exit codes): `.../gates.log`
- Machine-readable summary: `.../result.json`
