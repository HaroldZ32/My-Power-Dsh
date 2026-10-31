# T9 — wave sweep: independent gate + acceptance verification of the whole contract

**Seat:** R2 (`reviewer-planes`), board task **T9** (the wave's own gate evidence).
**Basis:** `.mpd/plans/cellwork-vedit-wave.md` §2–§7 (frozen contract incl. rulings R1–R9), AGENTS.md §4's
gate table and §11's invocation caveat.
**Branch:** `fix/cellwork-vedit-wave`. No git write command was run. No `src/`, `test/`, `docs/`,
`dist/` or gate file was edited; this sweep's write scope is `evidence/cellwork/vedit-wave/sweep/**` and
this document only.
**Sweep instant:** source hashes recorded at 2026-10-31T06:00Z and RE-VERIFIED at 06:02:19Z
(`sha256sum -c sweep/logs/source-hashes-at-sweep.txt` → 19/19 OK, no drift; no package src/dist file
newer than the gate run at 05:56Z). The lane B/D/E files my T7 probes judged are **byte-identical** at
the sweep (split `d37e1b98…`, requirements `ab11bca1…`, gates `f74c82e3…`, tools `f31ea6e6…`,
ledger `9d90ba1f…`, captain-investigation `c7e463cf…`, roles index `9995bc0b…`, guard `cbebd8ca…`,
prompts `62533716…`), so those probes stand on the final bytes; the files that moved after T7
(`mail.ts` + `protocol.ts` render from T16, `flow.ts` comment from T17, workmate `index.ts` from D17,
`dist/**`) were re-probed here.
**Verdict: APPROVE the code and the branch for commit + PR**, with **one required text correction**
(F1: the CHANGELOG's test counts are stale) that the captain must apply before the PR body/CHANGELOG is
final. No Blocker, no High, no code finding.

## 1. Gate table — every wave gate, on the final tree

| Gate | Command | Exit | Verdict (observed) |
|---|---|---|---|
| Dist freshness | `node scripts/verify-dist-fresh.ts` | **0** | PASS — `ok: 34/34 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED files listed` |
| Typecheck | `.toolchain/node_modules/.bin/bun run typecheck` | **0** | PASS — `$ tsgo --noEmit`, no diagnostic |
| Package tests (contract §5's combined command) | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin packages/mpd-verify-plugin packages/mpd-roles-plugin` | **0** | PASS — **407 pass / 0 fail**, 30 files |
| Tests — cellwork (authoritative, per package) | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | **0** | PASS — **148 pass / 0 fail**, 15 files |
| Tests — verify (authoritative, per package) | `.toolchain/node_modules/.bin/bun test packages/mpd-verify-plugin` | **0** | PASS — **74 pass / 0 fail**, 4 files |
| Tests — roles (authoritative, per package) | `.toolchain/node_modules/.bin/bun test packages/mpd-roles-plugin` | **0** | PASS — **185 pass / 0 fail**, 11 files |
| Tests — team-core (authoritative, per package) | `.toolchain/node_modules/.bin/bun test packages/mpd-team-core-plugin` | **0** | PASS — **404 pass / 0 fail**, 27 files |
| Tests — workmate (authoritative, per package) | `.toolchain/node_modules/.bin/bun test packages/mpd-workmate-plugin` | **0** | PASS — **57 pass / 0 fail**, 5 files |
| Doc pairs | `bun run verify:docs` | **0** | PASS — `pairs=52 failed=0 violations=0 links=471 dead=0` (3 derived notes, 24 exempt) |
| Declaration comments | `bun run verify:comments` | **0** | PASS — `501 TypeScript file(s) … 45130 declaration(s)`; `VERDICT: PASS` |
| Plugin manifest | `bun run verify:manifest` | **0** | PASS — files-allowlist 25 patterns, evidence excluded, packed-content 1109 files, 0 required absent |
| Row/parity | `bun run verify:rows` | **0** | PASS — `37 row ids match the 2-file bundle patch layer` |
| No host override | `node scripts/verify-no-host-override.ts` | **0** | PASS — `0 of 0 collide with the 214 host-declared row ids`; 0 exemptions |
| Preset conformance (real mount; REQUIRED — three tool schemas changed) | `node skills/dsh-qa/scripts/preset-conformance.ts` | **0** | PASS — real session `agentPreset=mpd`, boot log read, negative control refused as designed (`agent-preset/invalid`) |

**No gate produced a failing line.** Each command's verbatim output (and its `COMMAND:`/`EXIT:` wrapper)
is in `sweep/gates/<gate>.log`.

**Invocation discipline (R9):** every package was run **alone** (`bun test packages/<one-package>`);
the contract's literal combined command was ALSO run for completeness (407/0) and agrees with the sum
of the per-package runs (148+74+185). No repo-root `bun test` was run (it would scan the historical
`evidence/**` fixtures). `mpd-workmate-plugin`'s suite is run alone on purpose: the captain's R9 note
records that it is not isolated from a shared process (a follow-up, not this wave's regression), and it
reads 57/0 alone.

## 2. Authoritative numbers (for the PR description and CHANGELOG)

| Package | Pass | Fail | Files |
|---|---|---|---|
| mpd-cellwork-plugin | **148** | 0 | 15 |
| mpd-verify-plugin | **74** | 0 | 4 |
| mpd-roles-plugin | **185** | 0 | 11 |
| mpd-team-core-plugin | **404** | 0 | 27 |
| mpd-workmate-plugin | **57** | 0 | 5 |
| **Five-package total** | **868** | **0** | 62 |
| Contract §5's three-package command | **407** | 0 | 30 |

The wave's other measured facts: `verify-dist-fresh` **34/34 fresh**; `verify:comments` **501 files**;
`verify:docs` **52 pairs, 0 violations**; `verify:rows` **37 ids**; `preset-conformance` **PASS on the
final bytes**.

## 3. Acceptance checklist — the whole contract, against the landed state

Each item cites the proof used. **P** = my own probe (a script in this sweep or the T7 probes, which ran
on byte-identical files); **T** = the contract's required test, run here and inspected, used as
corroboration only; **I** = source inspection (named symbol), because the criterion lives inside a tool
handler that needs a live mount.

| Item (defect) | Verdict | Proof |
|---|---|---|
| **C1** a split task may declare its `member` (D10) — validation half | PASS | **P** `review-lanes-bde.md` B01–B07 (21/21 probe checks; 6 invalid-name arms, conflict, shared-member/shared-role legality, self-review by resolved member); files unchanged since |
| **C1** activate half — one member per distinct `member`; contracts name role AND member | PASS | **P** sweep probe C1/activate-half (`Owner: **Senior Engineer** (member \`Seat 1\`) · Verifier: **Reviewer**`); **I** `activate.ts` `materializeSplit` groups `deps.split.tasks` by `roleKey(resolvedMemberName(task))` and fills `newMembers[memberName]` once per member; **T** `activate-resume-e2e.test.ts` + `split-task-owner.test.ts` green (in the 47/0 acceptance file run) |
| **C2** `mpd_verify_open` may name the loop's WRITER (D12) — server half | PASS | **P** lane-D probe D01–D07 (35/35: identity stored, placeholder absent, self+id refused, same-agent refusal vs different-session acceptance, PASS arm with produced evidence, writer.reason on disk); `tools.ts`/`ledger.ts` unchanged since |
| **C2** caller half — `cellwork_activate` passes the member's **session id** and `member: <name>` | PASS | **I** `activate.ts`: the loop-open call sends `writer_id` from `owner.sessionId` (fallback `executorRef`) and `writer_reason: "member: " + memberName`; only a non-empty id is sent. The tool-side storage/refusal is **P** above |
| **C3** a project may declare/override its gates (D13) | PASS | **P** lane-D probe D08–D18 (override/add/fallback, 10 malformed-file refusals with no fallback, 32/33 entry bound, shell:false, cwd, timeout 124, per-call read, effective cmd in the log header + metadata); `gates.ts` unchanged since |
| **C4** the captain may read project instruction files anywhere (D14) | PASS | **P** sweep probe USER-a: `../VEdit/AGENT.md` and an absolute sibling `CLAUDE.md` readable, their `src/` refused, own `docs/` readable, own `src/` refused; lane-E probe E01–E03 (20-path table, refusal text) |
| **C5** the cell PLANNER delegates its reconnaissance (D15) | PASS | **P** sweep probe USER-b: planner `read`/`grep` on source refused with the teaching text (`DELEGATED`, `cellwork_recon`, `mpd_role_spawn`, Explorer, Researcher), `docs/` and `.mpd/` readable; lane-E probe E04–E08 (maxDepth = depth+1 on 9 header shapes, band parity 20-path table, prompt spread); **T** `planner-guard`/`band-parity`/`role-spawn-maxdepth` green |
| **C6** `cellwork_dispatch {reassign}` (D4, D5) | PASS | **P** sweep probe: `reassignPairs` parser (valid/duplicate/missing/non-array); `applyReassignments` claims → journals `task-reassigned` → delivers in that order, a fenced target is refused, a board refusal is reported (never thrown); a healthy pass delivers once per member and skips the fenced owner with the `reassign` repair; **I** `protocol.ts` runs `applyReassignments` BEFORE `dispatchOwnerOnly` and re-reads the record after; **T** `dispatch-reassign.test.ts` green |
| **C7** a fenced member is reported, never messaged (D4, D5) | PASS | **P** sweep probe: `fenceReasonOf` fires on `mode:"checkpoint"`, `handoffReady`, and the barrier's `fenced` flag; `dispatchOwnerOnly` skipped the fenced owner (reason names FENCED + `reassign`) and delivered nothing to it, leaving its row unpaird; **I** `protocol.ts`/`index.ts` barrier path writes `fenced`/`fencedReason` + `checkpoint-unrecoverable`, `cellwork_supervise` lists fenced members with owned rows; second `cellwork_handoff` refused while one waits; **T** `dispatch-fenced.test.ts`, `supervise-lossless.test.ts` green |
| **C8** one activation pass journals ONE partial row (D7) | PASS | **I** `activate.ts` calls `deps.progress(stage,key,ordinal,total)` per artifact (contract/member/task/loop) and hands the FULL partial back only with a failure; `flow.ts` writes one compact `cell-activation-progress` row per step and calls `persistPartial` **once**, only in the `!activated.ok` branch; every row of the pass carries the SAME `activatedAt` instant, so the journal is monotonic; **T** `activate-resume-e2e.test.ts` green (47/0 acceptance run) |
| **C9** a refused split always leaves its findings (D8) | PASS | **P** lane-B probe B08–B09 (refused artifact with `accepted:false` + full findings, accepted verdict byte-identical after a later refusal, `latestSplit` answers the acceptance) + executed RED against HEAD; **I** `flow.ts` `split-refused` row still maps `code`/`taskKey`/`detail`; T17's comment now states this invariant |
| **C10** a `###` subheading belongs to its parent section (D9) | PASS | **P** lane-B probe B11–B12 (nested subheading finalizes; whitespace-only still refused) + executed RED |
| **C11** the cell record reconciles with the live roster (D11, D2, D3) | PASS | **I** `index.ts` `memberDivergence` reports live-only and record-only members in `cellwork_status` and never mutates; `staging.ts` records the split ticket's `splitTaskId`, looks it up by id then by owner, claims a lost owner for `cell-splitter` (with `ownerRepaired` and the hard error naming `agent_teams_task {action:"claim", claimant:"cell-splitter"}`); `flow.ts` keeps `splitTaskId` after activation; **T** `status-reconcile.test.ts` + `split-task-owner.test.ts` green |
| **C12** activation resume is proven end to end (D1) | PASS | **T** `activate-resume-e2e.test.ts`: its own header and `STAGES = ["contract","member","task","loop","dispatch"]` fail activation at EACH stage, re-run `cellwork_activate`, and assert convergence + final `executing`/`activatedRevision`; the six acceptance files ran **47 pass / 0 fail**; **P** the stage-failure journal/partial shape was inspected (C8 above) and the resume fields (`activationInFlight`, reused ids) are the ones the e2e test drives |
| **D6** mail is durable first | PASS | **P** sweep probe `D6/durable-first`: a refused `send` append ends the attempt (`appendWake` never called, no log file, answer says "durable"); the success path's order is `send → wake attempt → wake record` |
| **D16** undelivered bound is PER TEAM (R3/R7) | PASS | **P** sweep probe: 8 outstanding in team-A refuse the ninth send (`backlog-full`, bound 8); one ack frees exactly one slot; one delivery frees exactly one slot; 8 retired-team rows and 5 unstamped legacy rows count for nobody; `scopeToTeam` excludes both classes |
| **D16b** the `unread` branch is team-scoped (R7) | PASS | **P** sweep probe `D16b/unread-scoped`: the unread fold of team-A contains only team-A rows (a retired team's M1 rows and unstamped rows are excluded); **I** `index.ts`'s mail `unread` branch narrows through `scopeToTeam(state, mailTeam?.teamId)`, the same filter the bound uses |
| **D16c** self `unread` resolves the roster member id (R7) | PASS | **I** `index.ts`'s unread branch resolves `ownMember` through the shared `callerIdentity(...)` (recorded handle, then roster name) and addresses the inbox by that member id, not the session id; **T** `pr42-review-repairs.test.ts` + `mailbox-store.test.ts` green (45/0) |
| **D17** `mpd_workmate_spawn` forwards `maxDepth` = caller depth + 1 (new since T7) | PASS | **P** sweep probe `D17/parity`: workmate's `spawnMaxDepthOf` equals roles' export on 9 header shapes and returns the contract's values ({}→1, depth 0→1, 1→2, 2→3, `origin:subagent`→2, subagent+depth1→2, "3"→4, -2→1, 1.9→2); **I** the workmate tool passes `maxDepth: spawnMaxDepthOf(exec.agent)`; **T** `workmate-spawn-maxdepth.test.ts` green (4/0) |
| **T16/N1** a failed `wake`-record append must not report a sent wake | PASS | **P** sweep probe `T16/record-failure`: send row lands, ONLY the wake-record append fails (EACCES on the FILE, uid 1000), transport was called → answer `landed:true, wakeSent:false` with the reason "…its `wake` record could not be written…", raw log exactly `["send"]`, re-read fold shows the message present and undelivered (`wakeSent:false, read:false`), `unreadFor`/`wakeFailures` list it; `T16/transport-failure` produces a DIFFERENT reason ("the transport refused it…") so the two failures are distinguishable; **T** `mail-order.test.ts` green |
| **T17/N2** the `split-refused` comment states the C9 invariant | PASS | **I** `flow.ts` (the comment above the `split-refused` append): a refusal lands at `split/<revision>.refused.json` BESIDE the accepted record, nothing is overwritten, and the journal row is the ordered half; the surrounding append/return code is unchanged; **G** `verify:comments` PASS |

**User-requested end-to-end items (T9 §3):**
- **(a) PASS** — `captainReadablePath("/ws", "../VEdit/AGENT.md")` and an absolute sibling
  `…/VEdit/CLAUDE.md` are `true`; `../VEdit/src/main.rs` and its absolute spelling are `false`; own
  `docs/` is `true` and own `packages/…/src/mail.ts` is `false`.
- **(b) PASS** — the planner seat's `read`/`grep` on `src` are refused with the delegation-teaching text
  (both routes, `Explorer`/`Researcher`, the reason, the readable band), while `.mpd/**`, `docs/**`,
  `evidence/**` and a sibling instruction file are allowed.

## 4. Findings (ranked)

**F1 — Medium (documentation/evidence accuracy, not code): the CHANGELOG's verification numbers are
stale.** `CHANGELOG.md`, the Unreleased section's "**Verification.**" paragraph, states `cellwork 146
pass / 0 fail` and `(866 pass, 0 fail)`. On the final tree I measured **cellwork 148 pass / 0 fail**
(15 files; the T16 repair added two arms) and therefore **868 pass / 0 fail** across the five packages
— `sweep/tests/mpd-cellwork-plugin.log`, `…/mpd-verify-plugin.log`, `…/mpd-roles-plugin.log`,
`…/mpd-team-core-plugin.log`, `…/mpd-workmate-plugin.log`. Every other number in that paragraph matches
what I measured (74/0, 185/0, 404/0, 57/0, typecheck 0, comments 501 files PASS, dist-fresh 34/34,
rows/manifest/no-host-override PASS). T17's task note also carries the pre-T16 146. *Direction:* change
the two figures (and the PR body's copy of them) to 148 and 868; no source change.
*Terminology note (not counted):* the same paragraph says lanes B/D/E were approved "on 12/18/9
probes" — those numbers equal the acceptance-ITEM counts (B 12, D 18, E 9), while the probe scripts
made 21/35/11 assertions; writing "acceptance items" would be exact, but the current reading is
defensible and I do not raise it as a defect.

No Blocker, no High, no other Medium. No code, schema, gate, test or docs behaviour was found to
contradict the contract.

## 5. Declined to judge, and the bounds of this sweep

- **Release-only lanes not run** (correctly outside this PR wave): the Docker real-machine lane, pack
  closure and `repin-vendor` — the wave touched no `skills/**`, no pack and no install path, and the
  contract §5 does not list them. `verify:vendor` was not run for the same reason (no baseline/asset
  change); `verify:gates` is the release sweep, not this wave's.
- **Inspection-only criteria:** C2's caller half, C8's journal mechanics, C11's two reconciliation legs,
  D16c's self-identity resolver and T17's comment cannot be driven without a live harness session/board;
  each is marked **I** above with the symbol that carries it, corroborated by the package tests. I did
  not mistake their tests for proof of the rule — the rules are named from the source.
- **T16's red-first arm** cannot be reproduced from git: the pre-fix `mail.ts` was never committed
  (the wave is uncommitted), so the repair's own "red before the fix" claim rests on its note's mktemp
  copy; I verified the landed behaviour instead (the arm I would have found).
- **Lane A/C/F items** were reviewed by R1 (T6/T14); this sweep re-checks them only through the gates,
  the required e2e test and the code paths named above. The lane reports' own claims were not accepted
  as evidence.
- **Workmate isolation:** the suite reads a shared process state; it is green when run alone (57/0) and
  the captain's R9 note records the isolation weakness as a follow-up, not a wave regression.
- **Evidence hygiene (R9):** all probe workspaces are `mktemp` dirs; this evidence tree contains no
  `*.test.ts`; the checkout root has no `mpd-gates.json` (asserted). Only logs and this document were
  written.
- **Numbers:** the per-package figures above are the ones to publish; the combined 407/0 is the
  contract §5 command and agrees with the sum.

**VERDICT: APPROVE the code and branch for commit + PR, conditional only on F1's two CHANGELOG figures
being corrected before the PR body/CHANGELOG is final. The wave's gates are all green on the final
bytes, every contract item (C1–C12), every listed defect (D1–D15), the late repairs (D16/D16b/D16c,
D17) and the two post-review closures (T16, T17) pass, and both user-requested end-to-end items are
proven on the landed tree.**
