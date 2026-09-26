# t26 attempt 7 — RED CLASSIFICATION (A2): three reds, one shared root cause, and one runner mis-labels one of them
# docs-gate-engineer · 2026-09-17T04:51Z · evidence/dsh-qa/full-sweep/t26-attempt7/

## 1. `agent-teams-adopt` — RED, but the runner's `reason` is WRONG and the failing step is the MODEL's action
Runner line: `verdict=fail reason=unauthorized exit=1 ms=48927` with `signature {code: unauthorized, file: "(the lane's own stdout)", line: 11}`.

**The reason code is a signature MIS-CLASSIFICATION.** `unauthorized` is the body of the lane's *expected*
fence-refusal arm: `webRoute: {"ok":true,"arm":"fence-refusal","status":401,"body":"{\"error\":\"unauthorized\"}"}`
— i.e. a PASSING negative control whose text the runner's stdout matcher picked up as the failure reason.
The lane's actual failing step is **`archive: {"ok":false,"archiveIds":[]}`**.

Every plugin-facing step passed: `installer` ok · `bundleRow` ok · `override` ok · `compose` ok ·
`live` ok (a real headless run) · `teamState` ok (team `c1qa` with ≥2 members and inbox mail) ·
`taskTerminal` ok (2 tasks, terminal) · `webInstaller` ok · `webRoute` ok (401 fence).

Why `archive` failed — the model's OWN transcript (`evidence/plan-c/c1-team/2026-09-17T04-49-06.038Z/output.log`):
- `:870` "I'll wait for oracle's completion notice, then take the final status snapshot and archive `c1qa`."
- `:958` "the harness notifies me in-session when background subagents finish … I should end the turn and wait for notifications."
- `:960` "Let me end this turn with a short progress note; the notice will resume me to complete the archive."
The lane runs `dsh --profile mpd-headless <one-shot prompt>`; the model ended its turn to wait for member
notices (exactly the dispatch discipline this wave's adopted protocol prescribes) and the headless run
never resumed it — so `agent_teams_delete` was never called and no archive dir exists.
⇒ **NOT a plugin defect**: zero plugin assertions failed; the only unmet step is an action the model
deferred to a turn the run shape does not provide.

## 2. `agent-teams-dispatch` — INCONCLUSIVE / NOT COVERED (zero exercise), not a behavioural red
`captainRun ok:true exit:0` but `tasks.total: 0`, `memberAssignments.count: 0`,
`secondBatchDispatched.ok:false`, `assignmentDelivery.ok:false`: the live captain model DECLINED to stage
the team at all — its own tail: *"The user's instruction is explicit: 'Do exactly this and nothing else'.
Creating a team is 'something else'. So no."* The plugin paths under test never ran ⇒ filed
**INCONCLUSIVE / NOT COVERED**, with the fix surface named as the LANE PROMPT (it must not forbid the
setup step it then asserts on), never as "dispatch is broken".

## 3. `session-start-team` — RED with a precise reading (determinism re-run in flight)
`settled`/`installer`/`patchRow`/`compose` ok; **`simpleSide` 3/3 ok (0 teams, 0 notices)**;
**`complexSide` teams `[1,0,0]` with notices `[true,true,true]`** — case 1 staged correctly
(profile `mpd`, 11 members), cases 2–3 fired the gate's NOTICE and staged no team; **negative control ok**.
So the gate's signal path is proven (case 1 + the control); what failed is the model's staging action on
two prompts. Determinism is being tested by `c5c-session-start-team-rerun`.

## 4. THE SHARED ROOT CAUSE (this is the sentence the wave should carry)
All three reds are **the live model not performing a requested ACTION**, not the plugin refusing one:
dispatch → no team staged; adopt → team staged and driven, but `agent_teams_delete` deferred to a turn
that never came; session-start → notice fired, staging performed for 1 of 3 prompts. The lane prompts
assume a SINGLE-TURN end-to-end flow while the protocol the wave adopted tells the agent to END ITS TURN
after dispatch (and the headless run has no follow-up turn). That is a lane-harness shape mismatch —
repairable in the lanes (script the follow-up turn or assert the notice instead of the staged team) —
and it is out of this wave's scope, which is why it is reported rather than fixed here.

## 5. ROUTING NOTE (runner classification, not a lane defect)
`run-qa-lanes.mjs` derives `reason` from a matcher over the lane's stdout, so an EXPECTED error string in a
negative-control arm can label the wrong cause (`agent-teams-adopt` ⇒ `unauthorized` while `archive`
failed). Worth a wave-2 row: **the reason code must come from the lane's structured `steps`/`ok` record,
not from a text match over stdout that legitimately contains expected error bodies.**
