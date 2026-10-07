# Lane C evidence — the workload gate fires on a non-English instruction (W3 + C7 + C8)

Wave `de-vendor-and-verify-law`, branch `feature/de-vendor-and-verify-law`, Lane C (Junior Engineer),
2026-10-07 UTC. Frozen contract: `.mpd/plans/de-vendor-and-verify-law.md` (read, never edited).

## What this lane changed (all inside its scope; one write, one re-pin)

| File | Change |
|---|---|
| `packages/mpd-roles-plugin/src/complexity-gate.ts` | full-width clause separators, the CJK action/deliverable lexicon, the NEW signal `E` (CJK scale AND intent), the C7 team-record reader, the C8 source-kind rule in `latestUserMessage` |
| `packages/mpd-roles-plugin/src/session-gate.ts` | the C7 guard in the step handler (+ the `readDir` seam) |
| `packages/mpd-roles-plugin/test/team-plane.test.ts` | signal E (both conjuncts + the frozen controls), the full-width separator arm, C8's three exclusions with the falsifiability twin, C7's reader matrix, the C7 WIRING arm, the real-directory reader arm |
| `skills/dsh-qa/scripts/session-start-team.ts` | the CJK corpus (the owner's VERBATIM instruction + 3 negative controls), the calibration-band assertions, direction 6 (C7/C8), the FOURTH negative control (CJK-blind), the printed corpus table, the two live CJK sides, the header contract |
| `skills/dsh-qa/scripts/ulw-command.ts` | the C3.2 probe's restatement moved to `signal A-E` (the other half of that pair lives in `packages/mpd-ulw-plugin`, granted by the captain) |
| `packages/mpd-ulw-plugin/src/index.ts`, `packages/mpd-ulw-plugin/test/commands.test.ts` | the injected directive's restatement + both test expectations moved to `A-E` (granted; `test/engine.test.ts` untouched — Lane B's carve-out) |
| `skills/dsh-qa/SKILL.md` | the `session-start-team` case row now names A/B/C/D/E, the CJK corpus, the calibration band, the fourth control, C7 and C8 |
| `packages/mpd-roles-plugin/dist/index.js` | REBUILT with the canonical root-relative command (the captain's GO hop); sha256 in `dist-rebuild.txt` — the integration task's rebuild at T16 wins if the two differ |

## The measured defect, before and after

`corpus-before-after.out` drives the case's OWN frozen sets through both source images: the
before-image is `git show cae00e5a:packages/mpd-roles-plugin/src/complexity-gate.ts` (kept verbatim as
`complexity-gate-pre-wave.ts`), the after-image is the working tree. Exactly ONE verdict moves —
`cjk-positive` `false []` → `true ["E"]` — and every English case keeps its verdict byte-for-byte.

Baseline (before ANY edit, same session, the shipped tip): the owner's verbatim instruction measured
`trigger=false signals=[]` at 159 Han characters — B=0, C=0, D=absent, i.e. NO team whatever the
workload. That is the W3 root cause the plan froze; it reproduces from the branch point above.

## Falsifiability — the red-when-removed control

`revert-control.md` + `revert-control-self-test.log`: the working tree was REVERTED to the pre-wave
predicate (ASCII separators, the tiny CJK lexicon, no `E`), the self-test was run, and the file was
restored byte-for-byte (sha256 identical before and after). The reverted run EXITS 1 with:

```
- cjk-positive: "脱去该项目对于Oh-my-openage" must trigger with signal E, got {"trigger":false,"signals":[]}
[session-start-team] FAIL: the shipped gate violates its frozen contract (1 problem(s))
```

A FOURTH permanent negative control (`cjkBlind`) keeps that arm honest forever: the case builds a gate
that strips every Han character and full-width separator before evaluating, asserts the contract
reddens, and asserts the red is the `cjk-positive` arm.

## The three QA arms the amendment asked for (C9)

| Arm | Where | Result |
|---|---|---|
| (i) an inbound agent-style message (>= 3 enumerated lines + action verbs) does NOT fire | `self-test` direction 6 + `team-plane.test.ts` C8 describe | the fixture text fires C when judged; as a `team-message`/`agent-message` it is never selected; the SAME text tagged `user` IS selected |
| (ii) the owner's VERBATIM Chinese instruction DOES fire and stages a shell | `self-test` direction 5 + the `cjk-positive` live side | pure: `trigger=true signals=["E"]`; live: `session-start-team-*/sides/cjk-positive/` (see the case's own `result.json`) |
| (iii) a session already leading a team stages nothing, even on a strong human prompt | C7 WIRING arm in `team-plane.test.ts` (drives the real step listener) | `{out: undefined, toolCalls: 0}`; notice behaviour chosen: NO notice in any mode, and the session is NOT marked `acted` so it is re-judged once its team ends |

## The C8 payload shape (the marker EXISTS — no honest bound needed)

`c7-c8-payload-shape.md` quotes the installed harness: the official team plugin delivers a teammate
report as `createUserMessage({content, source: {kind:"team-message", teamId, messageId, senderId,
senderName}})` and `root.steer(input)`; a relayed subagent message is
`{kind:'agent-message', form:'relay', senderSessionId}`; the human turn is `{kind:"user"}` on BOTH the
CLI/ACP and the web/RPC path; the full kind vocabulary is the harness's `MessageSourceMap`. The rule is
POSITIVE: only `user` (or an UNTAGGED message) is the goal.

## Known state, stated rather than hidden

- `bun test packages` (`bun-test-packages.out`): the mpd-roles suites are green; three failures belong
  to other lanes' in-flight edits at capture time — `mpd-team-core-plugin/test/dispatch.test.ts`
  (the dispatched-member message wording), the `mpd-schemastery` relocation in the cross-package
  coupling inventory, and `F1 shipped artifact` on `mpd-roles-plugin/dist` (`739150fe…` committed vs
  `0be06288…` freshly built): the dist INLINES the adapter, and the adapter was edited after this
  lane's canonical rebuild. That F1 red is the EXPECTED mid-wave state the captain named; T16's
  rebuild is the one that ships.
- `bun run verify:docs` fails on 7 violations owned by other lanes (the new `mpd-verify-plugin` has no
  README; `agent-references/agent-teams-deltas.md` is gone while `AGENTS.md`, `agent-references/index.md`
  and both `docs/index.*.md` still link it; `mpd-team-compact-plugin/README*.md` links the deleted
  `mpd-agent-teams-plugin/README.md`). None of them is a file this lane owns.
- The C7 guard reads the record of the workspace the SESSION resolves to; a team recorded elsewhere is
  not visible to it — the same bound signal D has always had.
- Signal E is English-immune by construction (an ASCII text carries zero Han characters), which is why
  no English verdict could move; the CJK corpus is where its two conjuncts are asserted.

## Gates run in this pass (each with its observed colour)

| Command | Result |
|---|---|
| `node skills/dsh-qa/scripts/session-start-team.ts --self-test` | PASS, exit 0 (`self-test.out`, which PRINTS the corpus table and the calibration band) |
| `bun test packages/mpd-roles-plugin` | 51 pass / 0 fail (`team-plane.test.ts` carries the E, C7, C8 and wiring arms) |
| `bun test packages` | 3 failures, ALL owned by other lanes' in-flight edits (`bun-test-packages.out`) — see "Known state" below |
| `bun run typecheck` | PASS, exit 0 (`typecheck.out`) |
| `node scripts/verify-comment-coverage.ts` | PASS — "every declaration in the family carries a precise comment and a full signature" (`comment-coverage.out`) |
| `bun run test:qa` | 42 of 48 pass; the 6 failures are the vendored-body deletion's blast radius (5 of them `skills/**`, listed for Lane B's authoritative row list) and one adapter unit suite (`test-qa-allselftests.out`) |
| `bun run verify:docs` | 7 violations, none in a file this lane owns (README above) |
| `node skills/dsh-qa/scripts/session-start-team.ts` (LIVE) | see `output.log` / `result.json` in the run's own subdirectory for the per-side verdicts |

**The live run, and why its directory is numbered twice.** The first live attempt
(`session-start-team-2026-10-07T10-32-35.957Z/`) was ABORTED after its simple side on purpose: at
~5 minutes per work-shaped boot its CJK acceptance sides sat behind thirteen other boots, so the case's
side order was changed to run the CJK sides FIRST (a comment in the case says so; side order carries no
contract meaning) and the run was restarted as
`session-start-team-2026-10-07T10-36-01.185Z/`. The aborted directory is KEPT — it carries no
`result.json` and proves nothing; only the complete run's verdict is evidence.

## The bound on the C8 rule (stated, not implied)

`session-gate.ts` selects the goal as `latestUserMessage(rawClaimed) ?? latestUserMessage(decisionMessages)`
(a pre-existing line, untouched by this lane). With the source-kind rule in place, a payload whose raw
list holds ONLY an inbound report yields `undefined` and the caller falls through to the spliced
DECISION list, where the newest eligible human turn may be an EARLIER turn than the one just arrived.
That is bounded in two ways: re-judging an earlier human turn is idempotent (a turn that did not fire
does not start firing later, and one that DID fire marked the agent `acted` before it staged), and C7
now short-circuits every already-leading session before the predicate runs at all — which is exactly
the incident's shape. The alternative (never falling back) was rejected because a host that tags nothing
would then never gate at all.

## Artifacts added after the first report

| File | What it carries |
|---|---|
| `live-cjk-arms.md` | the LIVE arms: the `cjk-positive` row-log line (`signals=E … staged=1 plan=plan-20261007103657`), the notice/staged-slot agreement, the three silent controls, and the C7 wiring table |
| `skills-retirement-sweep.md` | the whole `skills/**` sweep, pass by pass, with the drift gate's final `DRIFT_EXIT=0` and the law case's re-copy |
| `c7-c8-payload-shape.md` | the C7/C8 evidence, including the installed harness's producer-owned source kinds |
| `t14-repair-verification.out` | the T14 repair, all three items quoted: the byte-identical re-copy (both sha256), `--check-drift` exit 0, the corrected sweep arithmetic |
| `test-qa-final2.out` | the aggregate self-test sweep in which `verify-law.ts` is green |
| `workmate-library-runner.out` | the canonical `run-qa-lanes --only=workmate-library` run (PASS) that answers the accidental-run question |

## FINAL PASS (skills closure) — every number the gate can reproduce

Artifact: `final-pass-verification.out` (2026-10-07T10:51Z), plus `test-qa-closure.out`.

| Check | Observed |
|---|---|
| `sha256sum packages/mpd-verify-plugin/qa/verify-law.ts skills/dsh-qa/scripts/verify-law.ts` | both `d5f1eb2f6881a6994b88f9db1c06b96d9b6831409cfccf5bf69184de4eac21ab` |
| `bun skills/dsh-qa/scripts/verify-law.ts --self-test` | `ok: the registered copy is byte-identical (d5f1eb2f6881)` + `ok: patch row + dist symbols + refusal vocabulary + decision/row arms`, exit 0 |
| `grep -c mpd-agent-teams-plugin skills/dsh-qa/scripts/watchdog-redesign.ts` | `0` — no deleted path survives; the two constants are gone (the rows DECLARE `RETIRED_ADOPTED_TOOLS` instead) |
| `bun skills/dsh-qa/scripts/watchdog-redesign.ts --self-test` | `PASS — watchdog-redesign (15 checks, 0 failed)` |
| `grep -c mpd-agent-teams-plugin skills/dsh-qa/SKILL.md` | `0` — the rotted row now names the real subject (`packages/mpd-schemastery/harness/cordis/lib/index.ts`) |
| `node scripts/run-qa-lanes.ts --check-drift` | `manifest and disk agree (48 entries, 42 lane script(s) discovered)`, exit **0** |
| `bun run test:qa` | `all self-tests passed`, exit 0 |

THE LIVE RUN CLOSED GREEN — the whole case, not only the CJK sides:
`session-start-team-2026-10-07T10-36-01.185Z/result.json` → `ok: true`, `verdicts.ok: true`, `sides: 14`,
`failed: []`, settle window pinned rev `cae00e5a…` with `gateHash 995564251c877723…` (the same bytes the
revert control restored). `cjkPositive: notices 1, signals ["E"], stagedPlans 1, planIds
["plan-20261007103657"], teamRecords 0`; `cjkNegative: three sides, notices 0, stagedPlans 0`; and the
previously-known-RED boulder-active arm now reports `signals ["D"], stagedPlans 1` — GREEN.

## THE LAW'S `denied` ARM — corrected to behaviour, and the LIVE ARM RE-RUN (2026-10-07T10:52Z)

HOP granted over `packages/mpd-verify-plugin/qa/verify-law.ts` (the `denied` arm only). The arm had
asserted a TEXT channel the harness does not reliably produce: a `tools.guard` denial is blocked BEFORE
dispatch, so the recorded `tool/result` is neither error-flagged nor carries the guard's sentence —
measured, which is why `denied` read `false` while the artifact was never created.

WHAT CHANGED (nothing else):
- `denied` now asserts the BEHAVIOURAL PAIR `write.called === true` AND `codeNotWritten === true`, read
  in the SAME run as the control pair `controlNotDenied && controlWritten` — which is what attributes the
  block to the guard rather than to any other failure.
- `sentenceRelayed` is kept as a REPORTED, non-asserted value (`result.json.reported`), with the measured
  reason stated in the comment.
- NO other assertion was relaxed: all nine arms keep their names, and `controlNotDenied`, `controlWritten`,
  `codeNotWritten`, `docsAllowed`, `sandboxMarker`, `realMarkerUnchanged`, `sessionsSandboxed` stay
  assertions.
- A HARNESS-LEVEL DENIAL SIGNAL WAS LOOKED FOR AND NOT FOUND: the sanctioned reader
  (`skills/dsh-qa/scripts/lib/session-evidence.ts`) exposes `called` / `succeeded` / `resultText` / `calls`
  and nothing guard-specific, and the installed harness records no guard-denial event type — so the pair
  above is used rather than an invented signal.

PROOF OF THE COPY (the anti-drift arm caught the divergence first, then the verbatim copy closed it):

```
$ bun skills/dsh-qa/scripts/verify-law.ts --self-test      # BEFORE the copy — the arm WORKING:
[verify-law] FAIL: the registered case has DRIFTED from the authored body: …/verify-law.ts fa61eb58… vs …/skills/…/verify-law.ts d5f1eb2f… — re-copy the authored file verbatim
$ cp packages/mpd-verify-plugin/qa/verify-law.ts skills/dsh-qa/scripts/verify-law.ts
$ sha256sum both paths
fa61eb5825ad7f21ce309ddea82edf3dc6a987d78a4a898ba15d4d2dcf0336cb  packages/mpd-verify-plugin/qa/verify-law.ts
fa61eb5825ad7f21ce309ddea82edf3dc6a987d78a4a898ba15d4d2dcf0336cb  skills/dsh-qa/scripts/verify-law.ts
$ bun skills/dsh-qa/scripts/verify-law.ts --self-test
[verify-law self-test] ok: the registered copy is byte-identical (fa61eb5825ad)
[verify-law self-test] ok: patch row + dist symbols + refusal vocabulary + decision/row arms
```

THE LIVE ARM — `node skills/dsh-qa/scripts/verify-law.ts`, exit 0, evidence
`evidence/gates/verify-law/2026-10-07T10-52-07.173Z/{result.json,output.log}`. RAW nine values:

| Arm | Value | Reading |
|---|---|---|
| mounted | true | the harness recorded a write call for the code path |
| denied | true | the behavioural pair: called AND never created |
| codeNotWritten | true | the denied code path was never created |
| controlNotDenied | true | with `verify.mode=off` the same write was NOT refused |
| controlWritten | true | with `verify.mode=off` the code path really WAS written |
| docsAllowed | true | a `docs/**` write is allowed and exists in the sandbox |
| sandboxMarker | true | the law wrote its boot marker in the SANDBOX workspace |
| realMarkerUnchanged | true | REAL marker before=false, after=false |
| sessionsSandboxed | true | no real-cwd session key exists |

`reported: {sentenceRelayed: false, controlSentenceRelayed: false}` — the unreliable channel, recorded and
never judged. **The REAL workspace's `.mpd/verify/boot.json` was ABSENT before the run and ABSENT after
it**, so the isolation claim holds on both sides of the measurement.
