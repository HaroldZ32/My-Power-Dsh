# mpd-autoproject-plugin
**English** | [中文](./README.zh-CN.md)

A fixed-policy autoproject engine on the DSH subagent seam, and the second design
to replace the retired loop engine. The discipline has ONE command and ONE tool: `/autoproject` and
`mpd_autoproject`.

## Commands

- `/autoproject <objective>` — injects the autoproject activation directive for that objective and starts
  the run. Empty input returns usage.
- No command surface (headless): a plain-text `/autoproject …` message is recognised at the plugin's
  `agent/pre-step` boundary and receives the same directive.

## Autonomy policy (carried by the activation directive)

An activated autoproject run executes autonomously and **stops for a human at exactly THREE decision
points**: (a) the over-limit escalation fired and `autoproject.escalate.mode` is `ask`; (b) a
credential, a secret or an external capability is absent; (c) the next write would leave the declared
scope. Nothing else stops the run — the four blanket "ask nothing" clauses are DELETED, and the
directive says so in one closing sentence.

1. **Triage first** — an unclear objective, or an investigate-then-execute task, gets one
   normal-MPD investigation round before the gate, a team, or the loop.
2. **The same complexity gate — evaluated MECHANICALLY before the directive is injected.** The run
   reads the SAME frozen predicate (`evaluateComplexityGate`) with the SAME `team.sensitivity`
   threshold row (`resolveSensitivity`; absent or unknown reads `easy`, the default) and the same
   inputs the session-start gate uses: signal **A** the explicit `team:` / `!team` flag; **B**
   distinct deliverable verbs; **C** THREE sub-signals, each scored against the row's own threshold —
   enumerated lines (numbered / bulleted / table rows), distinct action verbs, and clauses that OPEN
   with an action verb — of which at least `cSubSignals` must hold; **D** an ACTIVE boulder work
   (`readBoulderGate`'s `active` — a `.mpd/plans` FILE is not a signal); **E** BOTH the row's
   Han-character threshold AND its distinct action-verb threshold (the same count C2 reads); **F**
   large-workspace scale (`readWorkspaceScale`, `easy` row only). On the `easy` row: C1/C2/C3 at ≥ 2
   each with 2 of the 3 holding, and E at ≥ 24 Han characters AND ≥ 2 distinct action verbs — every
   row's numbers are in `SENSITIVITY_THRESHOLDS`. Never a second predicate. `team.gate: off` returns
   BEFORE the predicate runs; a fired gate under `mechanical` stages the plan shell, while `advisory`
   reports the verdict and stages nothing.
3. **A team when warranted** — a fired gate (or genuinely complex work) means the run stages the
   team ITSELF, and the DEFAULT is the staged-plan path: `agent_teams_plan` with `add_member` per
   roster member, then `create_task` for each DAG node (carrying its dependency answer), then
   `approve`. Approving its own staged plan is part of the run; it is not a second user confirmation.
   That is the ONLY way in: this bundle's team plane is the mpd RECORD, the official Agent Teams tools
   are REFUSED at the tool boundary (`spawn_teammate`, `team_task_create`, `team_task_list`,
   `team_task_get`, `team_task_update`), and `send_message` / `list_agents` / `wait_agent` /
   `interrupt_agent` remain for agent communication. The retired VENDORED family (`agent_teams_create`,
   `agent_teams_add_member`, `agent_teams_create_task`, `agent_teams_approve`, `agent_teams_status`,
   `agent_teams_send_message`, `agent_teams_shutdown*`, `agent_teams_delete`) does not exist on harness
   0.1.7 either — the five live tools are `agent_teams_plan`, `agent_teams_task`,
   `agent_teams_dispatch`, `agent_teams_mail` and `agent_teams_control`; team state is the mpd RECORD.
4. **Loop to completion** — rounds continue until every success criterion is clean. A defect the run
   finds is fixed in the same turn, never report-and-wait — EXCEPT a fix that would write outside the
   declared scope, which is decision point (c) and stops the run.
5. **Close out on proof** — `complete` is reported only after a verification PASS is RECORDED through
   the `mpd_verify_*` plane (tests alone never prove done) and the final quality-gate ledger approves.

## The engine, in one table

| Piece | What the run does |
|---|---|
| Children | every round is ONE `mpd_role_spawn` consult, routed through the roster and `agentRoutes` — Deep Worker on a heavy tier, Senior Engineer on a planned light one, Junior Engineer otherwise. No parallel engine, no private spawn seam. |
| Verification | the `mpd_verify_*` plane only: a RECORDED PASS is required to report `complete`; `strictReview` is accepted for compatibility and the gate runs regardless. |
| Ledger | `.mpd/boulder.json` via the six `mpd_boulder_*` tools, whose NAMES and params are unchanged and which this package now registers (the boulder package merged here). The ledger is the in-flight truth the TUI and the complexity gate read. |
| State | `.mpd/autoproject/<runId>/{state.json,ledger.jsonl,escalation.json}`. |
| Tiers | `tier: "light"` (no plan file) or `"heavy"`; `plan: true` forces a plan file even on light. |
| Scope | `scope` (an array of workspace-relative paths) is the caller's DECLARED write scope. Present, it drives the escalation scope signal, the verify loop's authorising scope and the cellwork hand-off; absent, the engine falls back to the paths its children evidenced, and `escalation.json` records which (`scopeSource: declared | evidence`). A next write outside the declared scope is decision point (c). |
| Over-limit escalation | the ONE independent decision, taken by the ENGINE at the round boundary: predicate `S2 ∨ S3 ∨ count(S1,S4,S6,S7) ≥ 2` over S1 criteria > `criteriaMax` (12), S2 `status == max-rounds`, S3 fruitless waves ≥ 2, S4 ledger bytes > `ledgerBytesMax`, S6 distinct scope trees > `scopePathsMax` (20), S7 same-criterion verify FAILs ≥ `verifyFailsMax` (2). **S5 is RETIRED** (R-W1B2 ruling, 2026-11-02): `autoproject.escalate.tasksMax` still parses for a `.mpd/mpd.jsonc` that sets it, but no signal reads it. `autoproject.escalate.mode` (`off`/`ask`/`auto`) decides only what happens NEXT; the artifact is `.mpd/autoproject/<runId>/escalation.json` `{version,at,mode,signals[],objective,planFile,criteria,evidence,scope,roundsUsed,mandate}`; `state.status = "escalated"` leaves the anchored goal ARMED. Hand-off: `cellwork_open` when that tool exists, else the `/cellwork <objective>` instruction. |


**The NORMAL autoproject flow — extending the staged plan through `agent_teams_plan` — is the GUARDED one.**
Stage the team with `agent_teams_plan`: `add_member` per roster member, then `create_task` for each DAG
node, then `approve`. The guard is the TOOL's, not advice: `create_task` REQUIRES the dependency answer
(`blocked_by: [...]`, an explicit empty root, or `independent: true`), and `approve` REFUSES two tasks
whose declared write scopes overlap with no dependency path between them (naming the pair and the two
remedies).

**There is no bypass at the TOOL boundary: the team door closes it there.** The mpd RECORD
(`<workspace>/.mpd/team/teams/<teamId>.json`, served as `mpdTeams`) is this bundle's team plane and
`agent_teams_plan` is the way in; the team-door guard REFUSES `spawn_teammate`, `team_task_create`,
`team_task_list`, `team_task_get` and `team_task_update` on every session, while `send_message` /
`list_agents` / `wait_agent` / `interrupt_agent` stay for agent communication. **The bound, stated once:**
a ROW that calls the team SERVICE directly (the official-executor fallback) is not a tool call and is NOT
gated. So no task a TOOL authors can reach a board without its dependency answer: `create_task` requires
it, and `approve` refuses an overlapping write scope with no dependency path.

## Policy — upstream shape, our wording

The discipline's SHAPE is upstream's: it is re-expressed from the **documented** upstream autoproject
discipline (base 8c57e46). The WORDING shipped here is this package's own — **no upstream prompt,
policy or error text was found or copied**, and the clauses below name things that exist only in this
bundle (the `mpd` toolbox, the five `agent_teams_*` tools this harness has, `.mpd/autoproject`, the
`mpdConfig` keys).

**Un-diffed residual, stated rather than smoothed over:** four clauses could NOT be compared against
any upstream text — the ladder `PIN → RED → GREEN → SURFACE → CLEAN`, the
stop-after-2-fruitless-discovery-waves rule, the subagent barrier, and evidence-never-suppressed.
They are OURS in wording; that they are upstream's in intent is unproven, and this note does not
claim it.

- Discovery waves: fresh child per round; bounded waves of independent work
  concurrent; stop after 2 fruitless discovery waves.
- Per-criterion loop: PIN → RED → GREEN → SURFACE → CLEAN until all criteria clean.
- Plan gate: Prometheus planner writes `.mpd/plans/<slug>.md` + checklist;
  Momus plan review when heavy/sensitive (max 2 re-reviews).
- Verification gate: the `mpd_verify_*` plane. A RECORDED PASS is required to report `complete`;
  `strictReview` is accepted for compatibility, and the gate runs regardless of tier.
- Final quality gate: gate reviewer stamps per-lane ledger (`.mpd/autoproject/<id>/ledger.jsonl`:
  code quality, hands-on QA, goal verification); any FAIL blocks completion.
- Subagent barrier and evidence-never-suppressed rules are part of this package's fixed directive —
  two of the four clauses with no upstream text to diff them against.
- Optional hyperplan wave: 5 adversarial category reviewers (unspecified-low/high,
  deep, ultrabrain, artistry) → insight bundle → planner.

## Tools

- `mpd_autoproject({objective, tier?, plan?, hyperplan?, strictReview?, maxRounds?, scope?})` — ONE tool; `tier`
  picks the shape (`light` / `heavy`), `plan: true` forces a plan file, `maxRounds` is 1..8 (default 6).
  There is no alias and no second entry point.
- `/autoproject <objective>` — the ONE command; it submits the activation directive as your own next
  user turn.

## State

`.mpd/autoproject/<runId>/{state.json, ledger.jsonl, escalation.json}`; plans land in `.mpd/plans/`;
the boulder ledger stays `.mpd/boulder.json`.

## Build / test

Run from the repository root with path-qualified arguments — the canonical form. A build
run inside the package directory writes different bundler path comments, so
`node scripts/verify-dist-fresh.ts` flags its output as stale:

```sh
bun build packages/mpd-autoproject-plugin/src/index.ts --target node --format esm --outfile packages/mpd-autoproject-plugin/dist/index.js
```

Test: `bun test packages/mpd-autoproject-plugin`.
Live QA: `node skills/dsh-qa/scripts/autoproject-smoke.ts`.

## dsh-Go tool cards

`mpd_boulder_status` also publishes a native **dsh-Go tool card** through `output.presentationMeta`:
a v1 tree (`stack` title → `row` of metrics → `keyValue` → `table`) with no data bindings and no
actions, measured before publication against the app's 8 KiB / 40 nodes / depth-6 tool-card budget.
A card that cannot be built returns `{}`, so the app falls back to its generic tool row. The text
`render` and the output schema are unchanged.

## The slot bound and interrupted consults (2026-11-05)

`autoproject.slotBoundMs` now defaults to `900000` ms (15 minutes) — the SAME bound the one-shot
consult deadman uses, so the two mechanisms do not race with different timers. The slot ledger stays
the ONLY accounting: `state.json` carries `slotBoundMs` and the `kills` array.

A consult that reports `status:"interrupted"` (its deadman fired) is recorded as a `SlotKill` row with
the roster's reported `elapsedMs` at the run's current `boundMs`, stamped in the journal as
`late/interrupted:<role>` (including the handoff path), and answered as `null` — exactly like a
hard-bound kill, which forces the run to `blocked`. It is never a silent `null`.
