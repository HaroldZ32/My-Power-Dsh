---
name: ulw-research
description: "Maximum-saturation research orchestration: ALWAYS proposes the final materials first (PDF+DOCX default), then parallel Explorer+Researcher lanes across codebase, web, official docs, and OSS repos — max-roster DSH team mode on this bundle's mpd team plane (`agent_teams_plan` + the shared `agent_teams_task` board) — with live journaling, a recursive EXPAND loop driven by leads lanes return in message text, empirical verification by running code, and a cited synthesis with charts/Mermaid/assets behind a mandatory visual-QA gate. ACTIVATES ONLY on an explicit user demand for research — the word 'ulw-research' in any prefix form, any 'ulw' research wording including combined invocations like 'mass ulw research', 'ultradebate' or 'hyperdebate' research requests, or an explicit request for research / deep research / an ultra-precise investigation, in any language. Never self-activates for ordinary questions, debugging, or implementation context-gathering. While active it overrides exploration-bounding defaults: exhaustive coverage is the goal."
---

## DSH Harness Tool Compatibility

Translate any OpenCode/Codex-only tool name to its DeepSeek Harness equivalent:

| OpenCode/Codex example | DSH tool to use |
| --- | --- |
| explorer/librarian `subagent(...)` | `mpd_role_spawn(role="Explorer" \| "Researcher", task=...)` — ONE-SHOT and synchronous: one bounded delegation, one report as the tool result; no `run_in_background`, `persona`, `agentOptions` or `description` |
| planning agent | `mpd_role_spawn(role="Planner", task=...)` |
| rigorous reviewer | `mpd_role_spawn(role="Plan Reviewer" \| "Architect", task=...)` |
| implementation / QA worker | `mpd_role_spawn(role="Deep Worker" \| "Senior Engineer" \| "Junior Engineer", task=...)` |
| `subagent_fork(...)` | no mounted equivalent — pass the needed parent context in `mpd_role_spawn`'s `context` |
| `job_output(task_id="...")` | no mounted equivalent: a one-shot consult returns its report as the tool result, so N SERIAL consults can still cover the work, at the cost of concurrency; the team plane is the concurrency path |
| `team_*(...)` | the mpd team plane (this bundle's team plane is the mpd RECORD): stage and approve with `agent_teams_plan` (`add_member` / `create_task` / `approve`), drive with `agent_teams_task` (`claim` / `complete` / `fail`) and `agent_teams_dispatch`, read with `agent_teams_plan {action:"status"}`. The official Agent Teams authoring tools — `spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update` — are REFUSED at the tool boundary by the team-door guard; `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` remain for agent communication |

Role-specific behavior goes in a self-contained `task`. `mpd_role_spawn` is ONE-SHOT: the child starts with only the `task` (and optional `context`) you give it, and no channel inherits full parent history — pass the needed context in `context`. Include any required context, files, diffs, constraints, and skill names directly in `task`. The specialists live in the mpd-roles ROSTER (`mpd_roles_list` prints them; address one by its NAME: Architect/Researcher/Planner/Deep Worker/Senior Engineer/Lead/Explorer/Reviewer/Plan Reviewer/Vision Analyst/Junior Engineer): spawn one with `mpd_role_spawn(role=..., task=...)` (roster persona + model route + read-only discipline applied automatically). A roster NAME is the ONLY accepted input — the internal stable id and the legacy `mpd-` form are refused; for a parallel team use the mpd team plane (`agent_teams_plan` per member + `agent_teams_task` for the board + `agent_teams_dispatch` + `send_message`) instead of repeated spawns — the official Agent Teams authoring tools (`spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`) are REFUSED at the tool boundary; a teammate runs on the route of the session that stages it (yours in a top-level spawn), and a roster slot applies only when the teammate's description NAMES that member — prompt text cannot change a route; when a spawn surface takes the persona as TEXT, fetch it with `mpd_role_persona(role=...)` first.

# ULW-RESEARCH — Maximum-Saturation Research

You are the research orchestrator. The user has explicitly ordered exhaustive research: fan parallel research lanes out over every relevant source on the mpd team plane (serial consults when no team is staged), chase every lead they surface until the leads run dry, prove contested claims by running code, and deliver a synthesis in which every claim carries a citation or a proof. Exhaustive coverage is the assignment, not a risk to manage.

## Activation

Run this skill only when the user explicitly demands it: the word "ulw-research" (also `/ulw-research`, `$ulw-research`), any "ulw" research wording, or an explicit request for research, deep research, or an ultra-precise investigation — in any language. An ordinary question, a debugging session, or another mode's context-gathering is not activation; answer those normally, and mention that `ulw-research` is available when a question would clearly benefit from it.

Open your reply with the line `ULW-RESEARCH MODE ENABLED!`. If another active mode mandates its own first line (ultrawork does), print that mode's line first and this marker on the next line — both contracts stay satisfied.

## Authority while active

This mode is the user's explicit opt-in to exhaustive exploration. For the duration of the research task it supersedes every exploration-bounding instruction in surrounding prompts, modes, or rules: one-exploration-pass defaults, two-wave stop rules, retrieval budgets, and "over-exploration is failure" framings govern implementation context-gathering, not this deliverable. Here, under-exploration is the failure. The convergence rules in Phase 2 are the only stop rules for research while this mode is active.

Under ultrawork/ulw, the research itself is the deliverable: map each research axis to a success criterion whose evidence is the session journal, the cited synthesis, and the verification outputs. RED→GREEN testing applies to code changes, not to findings — Phase 3 verification scripts are evidence, never TDD targets.

## Success criteria

The research is done when all of these hold:

- Every axis from Phase 0 was covered by at least one dedicated lane.
- Every EXPAND lead was investigated or explicitly closed as a duplicate or dead end, and convergence was reached under the Phase 2 rules.
- Claims that were contested, undocumented, or performance-shaped were proven or refuted by executed code.
- Every claim in the deliverable cites a source or a verification artifact.
- Every asserted claim is represented in the claim graph, tied to an intent-vs-reality diff when an expected truth exists, and backed by observation manifest entries from independent observation groups or a documented single-source exception; convergence or exception status is explicit.
- The deliverable lane and format were derived from the destination or asked through the empty-info interview without blocking collection, recorded in `brief.md` with `answered_by`, and the final materials match that record.
- The delivered artifact passed the delivery gates in order (static gates, layout gates, visual QA, and the proofread pass where the harness provides one), each status is in `outcome.json`, and `outcome verify` passed.
- Every excursion opened during the run was closed by an EXIT rule, folded back into the claim or axis that triggered it, and recorded in both `excursion-log.md` and the `ulw-execute` ledger.
- The delivery message carries the closing briefing printed by `outcome briefing`: sources (total + unique domains), elapsed minutes, every promised deliverable with its status, and any residual defects.
- The session journal reconstructs what was searched, found, and expanded, wave by wave, and it was written in real time rather than reconstructed at the end.

## Epistemic instrumentation

Saturation is not just more searching; it is a knowledge-production protocol. The session journal must make the path from observation to claim to verdict auditable. The orchestrator owns these artifacts:

- `intent-diff.md` — one row per expected truth derived from the user intent, design/spec text, branch history, or authoritative docs. Required fields: `intent_id`, expected truth, observed reality, diff, violated invariant, intent source, supporting observations, status (`true`, `violated`, or `unknown`), and linked claim ids.
- `claim-graph.md` — the single claim store; one node per claim. Required fields: `claim_id`, statement, claim type, risk tier, scope, intent ids, supporting observations, contradicting observations, independent observation groups, convergence status, counter-search result, primary source backing, dependencies, status (`supported`, `partial`, `refuted`, or `unresolved`), and final synthesis location. High-risk non-code nodes that clear the Phase 3b gate are mirrored into a `verified-claims` digest section at the top of the file — the sole allowlist the synthesis draws non-code claims from.
- `observation-manifest.md` — one row per observation. Required fields: `observation_id`, source path or URL, evidence layer, observer group, independence basis, observer, `observed_at`, `valid_at` or `claim_valid_at`, artifact path, quote or line anchor, and contamination notes.
- `verification-economics.md` — one row per proof decision. Required fields: claim, risk, error cost, verification cost/time, chosen verification path, defer/verify decision, outcome, and residual risk.
- `cause-disappearance.md` — one row per causal finding. Required fields: cause id, expected truth, previous observation, `last_seen`, disconfirming observation, replacement cause if any, current status, and whether the violation is no longer observed.

Observation candidates and claim candidates travel back from lanes as message text. The orchestrator writes the instrumentation artifacts, links candidates into the intent diff and claim graph, and records where each observation entered the synthesis. A conclusion is not ready for final materials until its expected truth/reality diff is closed or marked unknown, its claim node exists, and its independent-observation convergence status is supported or explicitly excepted.

## Run the swarm as a cooperating team

Saturation research defaults to DSH team mode on this bundle's mpd team plane, not isolated one-shot consults: a lead one lane surfaces almost always reshapes what another should search next. When your harness gives you real cooperating members — DSH: `agent_teams_plan` (`add_member` / `create_task` / `approve`) + the shared `agent_teams_task` board driven by `agent_teams_dispatch` (the mpd RECORD; captain = current session, members are durable continuable teammates, tasks with owners + blockers, durable per-member mailbox), with `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` for agent communication — run this swarm as a team. The official Agent Teams authoring tools (`spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`) are REFUSED at the tool boundary by the team-door guard. Fall back to SERIAL one-shot `mpd_role_spawn` consults only when the team plane is unavailable, or the axes are genuinely independent with no cross-pollination expected.

- **One member per axis — by part, ownership, or perspective, never a job title.** Each Phase 0 axis is one member owning one concrete slice: a codebase part, a source territory, or a question lens. No two members share an angle. "Backend researcher" or "the web person" gives no real boundary and invites overlap — name what the member owns.
- **Always the maximum roster.** The team is not sized by taste: fill every member slot your harness allows (the agent-teams config `maxMembers: 8`; give each member its own axis) on every run. If you can only name five axes, split the broadest one — by source territory, by time window, by perspective — until the roster is full. A half-empty team is a half-covered topic.
- **Compose deliberately across the roster.** Before writing the roster, enumerate every role `mpd_roles_list` offers and give each slot the role that fits ITS job: broad recon to `Explorer`, external source hunting to `Researcher`, contested analysis to `Deep Worker`/`Senior Engineer`, attack lanes to `Architect`/`Reviewer`. Mixed roles by design, never one role across the whole board — and there is no effort knob to tune per slot.
- **Routing words from the user are literal.** "quick", "fast", "deep", "all quick", "max parallel" — in any language — are hard instructions, not mood. Map them to roster roles (`quick`/`fast` -> `Junior Engineer` or `Explorer`, `deep` -> `Deep Worker`, strongest -> `Architect`) and journal `requested shape -> spawned role -> fallback reason` for every slot. Silently promoting a "quick" request to a stronger role is a defect, and so is dropping to a cheaper one without saying why.
- **Debate members are mandatory for ultradebate/hyperdebate, default otherwise.** At least one skeptic or red-team perspective attacks claims, evidence quality, source independence, synthesis structure, and report choices before they reach the deliverable. When the user says ultradebate or hyperdebate, run at least two attacking perspectives and give every contested claim a full round.

**One team, or a sequence — decided by scale and precision.** One team is the floor, not the ceiling. When the brief shows 6+ axes, several source territories, or a long final document — or a wrong claim is expensive (legal, medical, financial, procurement, public-facing) — run the research team to convergence, disband it, and stand up a REFINEMENT team from your strongest reasoning tiers whose only job is to attack and sharpen the synthesis before the document is written. A fresh premium team reading a finished journal reasons better than the same researchers grading their own homework. Build each team from a written brief, drive every task to a terminal state on its board, and compact the finished team (`mpd_team_compact_run`) before the next one starts; never leave two research teams live at once.
- **The raise law — broadcast every lead the instant it surfaces.** Members over-communicate relentlessly: every new lead, finding, contradiction, and dead end is raised to you the moment it surfaces, never hoarded for a final dump. Through long team passes they send `WORKING: <axis> - <phase>`, and `BLOCKED: <reason>` the moment progress stops, via `send_message` — the mounted member channel — so you always know a member is alive. Too many small updates is correct here; going quiet is the only failure.
- **You lead; expand on each raised lead.** Members raise via message text, never write session files. Journal each lead and issue its expansion the instant it lands (Phase 2), not only when a member's final reply arrives.

## Lane ground rules

Research lanes (`Explorer`, `Researcher`, browsing) differ by surface, but assume:

- **Read-only.** The read-only roster roles cannot write files. Never ask a lane to write the journal or any session file — every journal write is yours.
- **No recursion — consults AND members.** A one-shot consult cannot spawn its own consult, and a team member must not re-orchestrate: a member researches its axis and reports; it never stands up its own team, loads this skill, or fans out a research swarm of its own. Depth comes from YOUR expansion waves. Say so in every task message — a lane that starts its own research protocol burns the run's budget on duplicated orchestration and returns nothing you can cite.
- **Built-in brakes.** Lanes often ship with their own retrieval budgets ("stop when answered") and rigid output templates. Your task message must explicitly lift the budget and demand the EXPAND tail, or the lane returns a thin single-pass answer with no leads.
- **Capability routing.** There is no effort knob: the roster slot route sets the model and its configured reasoning effort, and `mpd_role_spawn` takes no model parameter — the call cannot override the slot. Route saturation research to the stronger roles (`Deep Worker`, `Senior Engineer`, `Architect`) rather than trying to raise an effort; when the route cannot change, narrow each lane's scope and add more lanes instead.

### The task-message contract

Every research task message contains, in order:

1. `TASK:` — one imperative line naming the role and the axis.
2. The budget lift: "This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and report every lead."
3. Scope — the axis, the sources to hit, and what a complete answer contains.
4. The role protocol (Phase 1).
5. The reply tail. EXPAND markers, observation candidates, and claim candidates travel back as message text, never as files. Every lane ends the reply with:

```
## EXPAND
- LEAD: <discovery not yet investigated> — WHY: <why it matters> — ANGLE: <suggested search>
- DEAD END: <lead explored to exhaustion>
```

A worker with nothing to expand writes `## EXPAND` followed by `none — <one-line reason>`. A reply missing the tail is incomplete: send that lane one follow-up demanding it before closing the lane (`send_message` for a team member; a new one-shot consult carrying the prior report in `context`).

## Phase 0 — Decompose and open the journal

Before dispatching anything, decompose the query. Start from "what must be true if the user's intent/spec is true?", not "what looks broken?" Seed `intent-diff.md` with those expected truths before treating code, current docs, or web results as the source of truth:

```
<analysis>
Core question: <the actual information need>
Axes (3+ orthogonal): <axis — what to search, where, why> ...
Codebase relevant: <yes/no> · External: <yes/no> · Browsing: <yes/no> · Verification likely: <yes/no>
Scale: <axis count, source territories, target document length> · Precision demand: <what a wrong claim costs here> → lifecycle: <single team | research team then refinement team>
</analysis>
```

Then create the session directory:

```bash
mkdir -p .mpd/ulw-research/$(date +%Y%m%d-%H%M%S)
```

This is `$SESSION_DIR`. The orchestrator owns the journal: you write every file in it; lanes never do. Maintain:

- `wave-<N>-<kind>-<axis>.md` — your digest of each lane return: key findings, sources with URLs, and the lane's EXPAND markers verbatim.
- `expansion-log.md` — per wave: lanes dispatched, markers gained, leads opened and closed.
- `excursion-log.md` — one ENTER row and one EXIT row per excursion: `excursion_id`, parent claim or axis, ENTER trigger, depth, workers spent, the EXIT rule that closed it, what it changed in the top-level answer (`none` is a valid, required answer), and the `ulw-execute` ledger entry id it was mirrored into.
- `intent-diff.md` — orchestrator-owned expected-truth ledger comparing intent/spec/history to observed reality.
- `claim-graph.md` — orchestrator-owned claim graph linking every final assertion to observations, counterevidence, dependencies, and verdict.
- `observation-manifest.md` — orchestrator-owned observation manifest with `observed_at`, temporal validity, artifact paths, and contamination notes.
- `verification-economics.md` — proof-cost ledger mapping claim risk to verification path, deferral decisions, and residual risk.
- `cause-disappearance.md` — cause ledger tracking expected truth, previous observation, `last_seen`, disconfirming observation, and whether the violation is no longer observed.
- `verify-<slug>.md`, `SYNTHESIS.md`, `REPORT.*` from later phases.

Append each digest the moment its lane returns, not in a batch at the end — the journal is your recovery point after context loss and the user's audit trail.

### Run it as a loop, and journal in real time

`ulw-execute` is ON by default for this mode: when the `ulw-execute` skill is available, register the research axes as Boulder goals so the run has durable state and survives a compaction. The session directory's timestamp is the run's start clock — the closing briefing is computed from it, so create it once and never rename it. From that point every finding, source, quote, number, and lead is written into `$SESSION_DIR` **the instant it lands** — never held in the conversation for an end-of-run dump. After any context loss, re-read the brief and the journal before doing anything else, then resume from the open wave.

### Deliverable lane, format, and the empty-info interview

Never block collection on the shape of the deliverable, and never guess it either. Read [references/deliverable-phase.md](references/deliverable-phase.md) sections 1-6 before writing the brief, then:

1. **Derive first.** Name the lane (`template-strict`, `template-vibe`, `no-format`, `edit-existing`) and the promised formats from the request and its destination (the reference's section 3). When the request refers to an existing deliverable, decide its state with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome state --deliverable <path> --session-dir "$SESSION_DIR"`: `partial` resumes the skeleton on disk, `complete` means edit-existing and never a regenerated report. `$SKILL_DIR` is this skill's own directory, the folder containing this SKILL.md.
2. **Read the requester's format memory** with the memory tool when the harness exposes one: the pointer `system/human/report-style.md`, then `reference/human-report-style.md`; take the choice recorded for the most similar context (same destination kind and audience) as the first option.
3. **Ask only what is still missing**: at most the reference's three questions (destination and format, audience and length, template lineage) in one call to the harness question tool (`ask_user_question` or `request_user_input`), non-blocking where the harness supports it, each with its default first, a labelled "other / describe the format" option, and a "don't care, you decide" option. Collection starts without waiting; a late answer is folded in until the assembly worker starts, and after that it becomes a re-render request.
4. **Record it.** Write `## Deliverable` into `brief.md` (lane, state, formats, destination, audience, template, format description, each with `answered_by: user|default|request`) and open the manifest in the same step: `node "$SKILL_DIR/scripts/report-tools.mjs" outcome init --promised <formats> --lane <lane> --session-dir "$SESSION_DIR"`.

Phase 5 opens by turning the recorded fields into `design-spec.md`.

## Phase 1 — Saturation wave

**When the user asked for MASS research, the wave is sized by the topic's angles, not by the roster ceiling.** "mass ulw research", "mulw research", "ulw mass research" — in any language — order over-collection that a team of 8 cannot produce. Stage collection on the mpd team plane: a 60+ task opening wave covering every angle the topic has, one `create_task` per node carrying its `blocked_by` edges, routed across the roster by task shape — mechanical sweeps and per-item harvest batches to `Junior Engineer`, judgment-shaped angles to `Senior Engineer`, cross-territory angles to `Deep Worker`, and the deepest `Architect` reserved for genuinely hairy contradictions. Each wave's EXPAND leads define the next wave's tasks, and the synthesis reduces through several parallel `Senior Engineer`/`Deep Worker` tasks into ONE `Architect` reducer. A failed node is `agent_teams_task {action:"fail"}` plus a `kind:"repair"` row with `sourceTaskId`. Absent a staged team, hold the same shape with SERIAL one-shot consults. Everything else in this skill still binds: the deliverable interview, the journal, the claim graph, the convergence rules, and the delivery gates.

Otherwise stage the entire first wave at once — every axis as a team task when a team is staged, or as a tight sweep of SERIAL one-shot consults when it is not. "Start with one axis and see" defeats the mode.

Scaling floor — more angles always justify more workers:

| Query scope | Explorer | Researcher | browsing | repo-dive | floor |
|---|---|---|---|---|---|
| Single topic, codebase only | 3 | 0 | 0 | 0 | 3 |
| Single topic, web only | 0 | 4 | 1 | 1 | 6 |
| Single topic, both | 2 | 3 | 1 | 1 | 7 |
| Multi-faceted | 4 | 6 | 2 | 2 | 14 |
| Full due diligence | 4 | 6 | 3 | 2 | 15 |

**Disambiguate before you expand.** When the topic names something that could resolve several ways — a product, a person, a codename, a version — the first wave settles WHICH entity before any worker researches its history, benchmarks, or controversies: canonical name, first-party URL or account, whether it exists in the claimed category, and a confidence line. An unresolved entity never becomes a premise in a later wave's spawn message; that is exactly how a run starts inventing facts about something that does not exist.

Role protocols — embed the relevant one in each task message; every lane gets a unique angle:

- **Codebase (Explorer), 2-4 lanes.** Grep with 3+ keyword variations; structural/AST search; LSP definitions and references; file-name globs. Cross-validate hits across tools. Report absolute file paths, patterns with `file:line`, and how findings connect. History including deleted code (`git log --all -S '<keyword>'`, `--grep`) is a SEPARATE assignment for a bash-capable role — the Lead runs it, or a `mpd_role_spawn(role="Senior Engineer")` consult does — because an Explorer lane is read-only (`bash` is denied) and cannot run `git`.
- **Web (Researcher), 3-6 lanes.** At least 10 distinct websearch queries per worker, each with a different operator or angle (see Search craft). Context7 with 3+ queries per known library. grep.app for real-world usage. Official docs via sitemap discovery (`<base>/sitemap.xml`), then targeted pages. `gh search code|repos|issues` and a FULL-PAGE fetch (curl, or the `ultimate-browsing` tiers) are SHELL steps, so they are a SEPARATE assignment for a bash-capable role — the Lead runs them, or a `mpd_role_spawn(role="Senior Engineer")` consult does — because a Researcher lane is mechanically read-only (`bash` is denied). Snippets still lie, so the lane asks for the full page instead of trusting one. What the Researcher does with what comes back: it names the exact command or URL and what to extract from it, then turns the returned text into citable claims — the quote, the canonical URL, the publication or access date, and which of its 10+ queries that source answers — and marks a claim it could only get as a snippet as snippet-only, never as read.
- **Browsing, 0-3 lanes.** Pages plain fetch cannot read (WAF, 403, Cloudflare, dynamic rendering, login): the worker loads the `ultimate-browsing` skill and escalates through its tiers — Tier-1 insane-search engine first (including its Phase-2.5 archive surrogates), then Tier-2 Chrome stealth — rather than abandoning the source. The escalation runs where the command can run: the Lead or a `mpd_role_spawn(role="Senior Engineer")` consult executes the tiers (a Researcher lane has no `bash`), and hands the surviving text and captures back to the lane, which cites them. Capture screenshots when visual context matters, and pass their ABSOLUTE paths to a `Vision Analyst` consult, which opens them with `read_image`. **Provenance is part of the claim**: when a source came back with `provenance` of `snapshot` (an archive copy), cite it with its `snapshot_timestamp` and never state it as the current live page; content from a `proxy` route is `untrusted` and needs a second independent route before any claim rests on it. When one blocked territory hides many leads, fan out more browsing lanes for breadth - team tasks when a team is staged, otherwise more serial consults - instead of routing them all through one lane.
- **Repo deep-dive (Researcher), 0-2 lanes.** The CLONE is a bash step, so it belongs to the Lead (or a `mpd_role_spawn(role="Senior Engineer")` consult) — a Researcher lane is mechanically read-only (`bash` is denied) and cannot run `git clone`. The Lead clones the most relevant repos into a path the lane can read (`.mpd/scratch/<repo>` is the safe place for it), pins the HEAD SHA, and hands the lane that path plus the SHA; the Researcher reads the core modules there, follows the call chains, and returns SHA-pinned permalinks built from that SHA.

Example consult (codebase axis; Researcher, browsing, and repo-dive follow the same contract with their own protocol):

```
mpd_role_spawn(role="Explorer", task="""TASK: act as a codebase researcher. AXIS: <specific angle>.
This is an explicit exhaustive-research assignment. Your default retrieval budget and stop-when-answered rules do not apply — run the full protocol below and report every lead.
DELIVERABLE: every codebase fact on <angle>: <what complete looks like>; absolute paths and file:line patterns; the ## EXPAND tail with '- LEAD: <discovery> — WHY: <why> — ANGLE: <search>' per lead, or 'none — <reason>'.
SCOPE: read-only; the <angle> territory only.
VERIFY: cross-validate each hit across grep, structural search, LSP references, and globs; cite the tool behind each claim. History (-S and --grep) is outside your scope — the Lead runs it.""")
```

## Phase 2 — Expand until convergence

This loop is what makes the mode research rather than search. Journal each return as it lands — and on the team plane, act on each lead the moment a member raises it, never waiting for the full wave or a member's final reply:

1. Journal the return the moment it lands, never at the end of the wave: digest plus verbatim EXPAND markers into `wave-<N>-<kind>-<axis>.md`, appending each new source, quote, and number to the observation manifest in the same beat — after a compaction the journal, not your memory, is the state.
2. Deduplicate new markers against `expansion-log.md` — every lead ever seen, not just confirmed ones, or rejected leads resurface each wave.
3. Issue an expansion consult — or a team task — immediately for each new unchecked lead:

```
mpd_role_spawn(role="Researcher",
     context="<which return surfaced it>",
     task="""TASK: expansion wave <N> — investigate: <lead>.
This is an explicit exhaustive-research assignment; budgets do not apply.
<role protocol for the lead's territory — Researcher protocol for external leads, Explorer protocol for codebase leads>
DELIVERABLE: the answer, its sources, and the ## EXPAND tail.
SCOPE: read-only; the lead's territory only.
VERIFY: cite the source behind every claim.""")
```

### Excursions — dive deep on a new find, then surface back out

The Phase 0 core question is the fixed goal of the run and never drifts. An excursion is a BOUNDED detour off the wave plan to chase something a return surfaced — you go deep, settle it, and come back up to the question you were hired to answer.

**ENTER (dive) only on a trigger.** One of these must hold, and you name which one:

1. The find contradicts a claim already locked in `claim-graph.md`.
2. It would change the final answer or a recommendation if it turned out to be true.
3. It exposes a source territory no axis owns, so nobody else will ever reach it.
4. The user's steering points at it — their words are the trigger, quoted verbatim.

Interest alone is not a trigger. Anything without one stays a queued lead in `expansion-log.md`, and the wave plan continues.

**Budget the dive before you take it.** State the worker count and the probe count for this level in the ENTER row. An excursion may spawn at most ONE nested sub-excursion; a third level means the thing has become its own research question — surface immediately and either promote it to a real axis with its own worker or record it as an out-of-scope gap in `SYNTHESIS.md`. When the `ulw-execute` skill is driving the run, a promotion is a `subgoal-added` entry in its ledger (`.mpd/ulw-execute/ledger.jsonl`) carrying the axis title, what it must answer, the evidence that surfaced it, and why the plan changes.

**EXIT (surface) the moment any of these holds** — you do not need all of them:

- The ENTER trigger is resolved: the claim is confirmed, refuted, or its dependency is closed.
- Two consecutive probes changed nothing in the parent answer.
- The finding stops moving any claim's status — diminishing return is an exit, not a reason to push harder.
- The level's stated budget is spent.

**Fold back on the way out.** Every EXIT writes one line saying what the excursion changed in the top-level answer, and `none — <reason>` is a legitimate, required outcome; an excursion whose result is silently dropped is a lost run. Update the parent claim node or axis digest with the result, then mirror the whole excursion into the `ulw-execute` ledger (`.mpd/ulw-execute/ledger.jsonl`) as an entry carrying what it observed and what it changed (or `none`), plus a criterion entry naming goal id, criterion id, status (`pass`/`fail`/`blocked`) and the artifact when it settled a criterion. After a compaction, `mpd_boulder_status` plus `excursion-log.md` tell you which excursions are still open.

**Anti-drift.** After every EXIT, re-read the core question in the journal and confirm the run still answers it. Three consecutive excursions that changed nothing end excursions for the run: converge on what you have.

4. Record the wave in `expansion-log.md`: spawned, markers gained, leads opened/closed.
5. **Relay the user's steering to everyone.** When the user changes scope, cadence, target sources, language, or format mid-run, broadcast it to every live worker and member immediately and record the exact wording in `expansion-log.md`. Steering only you saw silently splits the swarm's assignment from the user's actual ask.

**Convergence — the only stop rules while this mode is active.** Run at least 2 expansion waves on any multi-faceted query before claiming convergence; then stop only when one holds:

- Zero unchecked leads remain — each investigated or closed as duplicate/dead end.
- 3 consecutive waves produced no new actionable leads.
- Expansion depth reached 5 waves — pause, show the open leads, and ask the user whether to extend.

**Never end the run on a lane's completion.** Lanes finishing is not the deliverable; your synthesis is. Reserve the last fifth of the run's context and time for Phases 4-5 and stop opening waves the moment that reserve is threatened. A converged answer with two open leads beats nine finished workers and no report.

## Phase 3 — Verify contested claims by running code

Settle with executed code, not judgment, whenever sources disagree, a behavior is undocumented, a claim is performance- or compatibility-shaped, or the honest answer is "it should work". Issue one verification consult per claim:

```
mpd_role_spawn(role="Deep Worker", task="""TASK: verify by execution: <claim>.
SOURCE: <where it came from>; CONTRADICTION: <opposing source, if any>.
Write a minimal self-contained script that tests the claim; run it (uv run --with <deps> python / bun / direct compile); capture full stdout+stderr; pin versions.
DELIVERABLE: the exact code, the full output, environment (OS, runtime, dependency versions), and a verdict — CONFIRMED / REFUTED / PARTIAL — grounded in the output.
SCOPE: a throwaway script and its run; no product files.
VERIFY: paste the command and its raw exit status.""")
```

Journal each verdict to `verify-<slug>.md`.

## Phase 3b — Lock non-code claims through the claim graph

Code settles code-shaped claims (Phase 3). Numeric, market-share, legal, dated, causal, and financial claims cannot be run — so they pass through a data-flow-lock instead (the verification idea adapted from fivetaku/insane-research): the synthesis may assert a high-risk non-code claim **only** if it cleared this gate, and the gate's output is the sole allowlist the synthesis draws from. Skip the gate and there is nothing to synthesize — the lock is self-enforcing.

The claim graph is orchestrator-owned. Lanes only return verified-claim markers, observation candidates, and claim candidates as message text, the same channel as EXPAND markers — never a file. As leads resolve, you record one node per asserted claim in `claim-graph.md` and compute its status; workers report claim candidates in their replies, and you decide. The graph is the single claim store: final synthesis may not draw from free-form claims that skipped it.

A high-risk claim clears the gate to `verified-claims` only when all hold:

- **>= 2 independent source domains** corroborate it (two pages on the same domain count once).
- **>= 2 independent observation groups** converge on it, unless the graph records why a primary-only source is the correct single-source exception.
- **One counter-search** actively looked for a refutation and did not find a stronger one.
- **A primary source** (the standard, filing, dataset, or first-party doc) backs it, not only secondary commentary.
- **Temporal evidence is explicit**: each supporting observation records `observed_at` and either `valid_at` or `claim_valid_at`, so branch-only, historical, release, and current-runtime claims cannot be conflated.

Anything that fails goes to an `Unresolved` (insufficient evidence) or `Refuted` (counter-search won) annex — abstention is a correct outcome, not a gap to paper over. Record each gate outcome on the claim node itself — risk tier, independent source domains, counter-search result, primary source backing, and status — and mirror the cleared nodes into the `verified-claims` digest section at the top of `claim-graph.md`. Worker reply marker (message text, same channel as EXPAND):

```
## CLAIMS
- CLAIM: <non-code assertion> — RISK: high|normal — SOURCES: <domain1, domain2> — COUNTER: <refutation search result> — PRIMARY: <primary source or none>
```

## Phase 4 — Synthesize

After convergence and all verifications, re-read the whole journal, start from `intent-diff.md`, `claim-graph.md`, and `observation-manifest.md`, then write `SYNTHESIS.md`:

```
# ULW-Research Synthesis: <query>
Workers: <total> · Waves: <count> · Excursions: <count> · Sources: <count> (<unique domains> domains) · Verifications: <count> · Elapsed: <minutes> min

## Executive summary        — 2-3 paragraphs answering the core question
## Findings by theme        — per theme: consensus, evidence links, key quote (<20 words, attributed), verified yes/no
## Codebase findings        — absolute paths with line references
## Sources (ranked)         — URL, what it contains, reliability, access date
## Verified claims          — code: claim | verdict | verify-<slug>.md · non-code: only rows cleared into verified-claims
## Epistemic instrumentation — intent-vs-reality diff closure, claim graph coverage, observation manifest coverage, independent-observation convergence, verification economics summary, cause-disappearance records
## Contradictions           — source A vs source B, resolution with evidence
## Gaps                     — what saturation could not answer · unresolved/refuted claim-graph nodes
## Expansion trace          — per wave: workers → markers; convergence reason
```

`SYNTHESIS.md` is the citation source of truth for final materials: every claim carries inline `[Source N]` citations, and every high-risk non-code claim you assert must be a verified-claims row from Phase 3b. Assert nothing the gate left in the unresolved/refuted annex.

**Write the skeleton early and fill it as claims lock.** The moment the brief records the deliverable, create the deliverable file with its section headings and a `STATUS: draft — <n> sections open` line as line 2 (an HTML comment in HTML); that line is the partial-state marker `outcome state` reads, removed only when the deliverable is complete. An interrupted run must leave a partial report on disk, never an empty directory and a lost conversation.

**Keep sourced numbers, assumptions, and derived results visibly apart.** Every quantitative claim carries its lineage: `MEASURED` (a number a source states, cited), `ASSUMED` (a coefficient, distribution, or scope you chose — say why), `DERIVED` (computed from those, showing the formula), plus a sensitivity line whenever the assumption moves the answer. Presenting a derived estimate with the confidence of a measured one is the most damaging thing this mode can ship.

**Search in English, deliver in the user's language.** Retrieval stays English-first (Search craft), but the synthesis and every final material are written in the language the user wrote to you in unless they ask otherwise — and a translated report still quotes its original-language sources verbatim.

## Phase 5 — Final materials

The promised formats recorded in `brief.md` and `outcome.json` are binding; `pdf` + `docx` is the default pair only when a document was asked for with no format word and no destination:

| Target | How |
|---|---|
| PDF (default) | Author the report as one self-contained HTML file, then print it headless: `chrome --headless --disable-gpu --no-pdf-header-footer --print-to-pdf=<out.pdf> file://<report.html>`. Embed the `design-spec.md` fonts as real webfonts (CJK included) instead of trusting system fallbacks. `uv run --with weasyprint python` is the fallback renderer. |
| DOCX (default) | `pandoc <report.md> -o <out.docx>`, adding `--reference-doc=<template.docx>` when the user has a house style; `uv run --with python-docx python` when pandoc is unavailable. Charts and Mermaid renders go in as images. |
| Slides / deck | `uv run --with python-pptx python` — one claim per slide, a chart or diagram per claim. |
| Standalone HTML / Markdown | The authored source itself. |

**Write `design-spec.md` the moment the deliverable is recorded — before any asset worker spawns.** When a document was pointed at, extract it instead of retyping its stylesheet: `node "$SKILL_DIR/scripts/report-tools.mjs" format-extract <reference> --out "$SESSION_DIR/design-spec.md"` (`--from-url` for a URL), then fill every `TODO: ask` from the interview answers, never by guessing. It is the one design contract every asset and assembly worker receives: template family (absent a reference, the clean analyst-report register — one accent over neutral tones, generous margins, styled section headings, no emoji, no clipart), palette tokens, body/heading fonts (a real gothic CJK webfont — Pretendard, Noto Sans KR — when the report language needs one, with `word-break: keep-all` for Korean), responsive breakpoints and HTML/CSS charts for web deliverables, the figure standard below, and the lineage mode on its own line: `Lineage: inline` (analyst default: every unit-bearing number tagged MEASURED / ASSUMED / DERIVED or cited in the same element) or `Lineage: section` (web and blog register: every section cited, lineage in the figure captions). The reference's section 6 lists the full defaults. One font family and one palette govern prose, charts, Mermaid, and generated images alike; a diagram rendering in a random default font inside a styled report is a defect, not a style choice.

**The figure standard — binding for every image, chart, and diagram.** Each figure sits in a fixed-size container styled from the spec (border, background, caption); the image scales to fit entirely inside it with its original aspect ratio preserved — object-fit: contain semantics — never stretched, never cropped, never spilling out. Every chart carries a title, axis labels, units, and value labels in the report's language; a bare number the reader cannot name is a defect.

Asset lanes (team tasks on the mpd team plane, or serial consults, each fed `design-spec.md`) — visuals are the DEFAULT deliverable of this phase, not garnish the user must ask for; a delivered report without figures is an incomplete run:

- **Charts for every quantitative finding, computed from real data.** Pull the numbers into an actual table first (CSV/JSON under `$SESSION_DIR`), then plot from that table, never from prose. Follow the data-scientist tool doctrine — numpy always, Polars for filtering/sorting/transforms, DuckDB for joins/aggregations/window functions, never pandas — and load the `data-scientist` skill when this session has it: `uv run --with numpy --with polars --with duckdb --with pyarrow --with matplotlib python`. Keep `pyarrow` in that set — the DuckDB-to-Polars handoff (`.pl()`) fails without it, and `.df()` fails without pandas, so hand data across through `.pl()`, never `.df()`. Save to `$SESSION_DIR/assets/`.
- **Mermaid graphs** for process, architecture, argument, timeline, and evidence-flow structure, themed to the spec's fonts and palette. Render each to SVG and confirm the file exists before the document references it.
- **Generated visuals when — and only when — the session really has an image tool** (no `imagegen` skill is shipped; `frontend` carries design references, not a generator): a cover plus a concept illustration per major theme, prompted from the spec's style, palette, and mood — document-styled illustration, never generic stock art dropped into a designed page.
- **Full-page screenshots** of the top 5-10 sources (browsing lane) as provenance you can show.

**Verify the asset manifest before rendering.** List every asset the document references, assert each file exists and is non-empty on disk, and re-render whatever is missing. A document that renders with three broken diagrams is a document you will publish twice.

Assembly lane — `mpd_role_spawn(role="Deep Worker", task=...)`, with the skills it must load named INSIDE `task` (`frontend`, `visual-qa`, `data-scientist`, `ulw-execute`) because there is no `load_skills` argument: before writing, read every available design and visualization skill and apply it — the report is a designed artifact, not a text dump; the worker's prompt carries `design-spec.md`. Use the template the user approved; absent a stronger house style the default skeleton is executive summary → key findings by theme → detailed analysis (quotes under 20 words with attribution, charts, Mermaid graphs, generated visuals, SHA-pinned permalinks, verification results) → comparative analysis when options compete → numbered sources with access dates → methodology appendix (workers, waves, searches, verifications, debate rounds) → correction log naming what verification overturned. Write it long and specific: every claim cites `[Source N]`, and the sources section lists every source the run actually used rather than a curated few.

### The delivery gates — every gate for the QA tier must PASS, in order

Nothing reaches the user until the gates pass. Record each result with `node "$SKILL_DIR/scripts/report-tools.mjs" outcome gate <static|layout|visual|proofread> <pass|fail|not_run> --session-dir "$SESSION_DIR"`; a gate this harness does not provide is recorded `not_run`. A chat or post answer (light tier) runs the static gates and one render; every paginated or web deliverable runs them all (the reference's sections 3 and 7).

1. **Static gates (always, before anyone looks at pixels).** `node "$SKILL_DIR/scripts/report-tools.mjs" check "$SESSION_DIR/report.html" --design-spec "$SESSION_DIR/design-spec.md" > "$SESSION_DIR/defects.json"`: keep-all, palette tokens, emoji, em dashes, heading length, unsourced numbers, figure containers, chart text, gothic-only fonts, citations, the closing and sources sections, broken assets. Codes and fixes: [references/report-gates.md](references/report-gates.md).
2. **Layout gates.** Print the probe with `node "$SKILL_DIR/scripts/report-tools.mjs" layout-probe --json`, evaluate its `source` in the rendered page through the `agent-browser` CLI, save the result as `$SESSION_DIR/boxes.json`, and re-run `check` with `--layout "$SESSION_DIR/boxes.json"` (overflow, clipped text, distorted images, overlapping siblings).
3. **Visual QA.** Render the produced artifact back to images — PDF pages to PNG, the HTML through the `agent-browser` CLI at desktop and phone widths — and look at them: missing or broken figures, images stretched or spilling their containers, diagram or chart text rendered off the spec's font or palette, clipped tables, overflowing CJK text, blank pages, unlabeled chart values, wrong page breaks. Reading the source markup is not visual QA; inspect the pixels.

**Repair is bounded.** After every gate run that found defects, ask `node "$SKILL_DIR/scripts/report-tools.mjs" repair decide --state "$SESSION_DIR/repair-state.json" --defects "$SESSION_DIR/defects.json" --artifact-bytes <bytes> --renders <pages> --session-dir "$SESSION_DIR"` and obey it: `repair` means fix and re-run; `deliver` means stop and ship with the residual defects the manifest now lists; `block` means a content-integrity defect remains (or there is no usable artifact), so do not deliver: tell the user what blocks it and record the row as `failed` with the reason. Never repair past a stop decision (3 attempts, a 2-attempt plateau, an oscillation, or 15 minutes; the reference's section 8).

Then resolve every manifest row (`outcome set <format> delivered --path <file>` or `blocked_capability` / `skipped` / `failed` with `--reason`) and deliver: the artifact plus a compact chat-readable summary of what it says — the answer in a few sentences, the numbers that matter, and what to look at first. The document is the deliverable; the summary is what gets it read.

### The closing briefing — every run ends with it

The last thing the user reads states, in one compact block, what the answer is made of:

- **The printed block.** `node "$SKILL_DIR/scripts/report-tools.mjs" outcome verify --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome finish --session-dir "$SESSION_DIR" && node "$SKILL_DIR/scripts/report-tools.mjs" outcome briefing --session-dir "$SESSION_DIR"`: sources and distinct domains counted from `sources-ledger.md`, elapsed minutes from the session directory's own timestamp, every promised deliverable with its status, the gate results, the residual defects, and the repair summary. A failing `verify` means the run is not done.
- **Effort.** Workers, waves, excursions, and verifications — the same counters as the `SYNTHESIS.md` header — plus how many sources were primary and how many claims went to the unresolved/refuted annex.

Never ship the artifact without this block, and never fill it from memory — paste the printed block and read the rest off the journal.

**Record the format choice.** After delivery, when the harness exposes a memory tool and the run qualifies (the user declared a preference, or made the same unsolicited choice on 2+ runs), append one episode line to `reference/human-report-style.md` in the grammar of the reference's section 5, and update the `system/human/report-style.md` pointer when a generalization changed.
 If you stood up a team, confirm every task is terminal, run `mpd_team_compact_run`, and only then give the final answer.

## Search craft

English first: run every search in English by default — it is the largest, most authoritative corpus on every engine, GitHub, and documentation site. Add a secondary local-language sweep (1-2 `Researcher` consults) only after the English sweep, when the topic is inherently local, or when the user asks for sources in a specific language.

Vary operators on every query — same query twice wastes a worker:

| Operator | Example | Use |
|---|---|---|
| `site:` | `site:github.com <topic>` | Restrict to a domain |
| `filetype:` | `filetype:pdf <topic> survey` | Papers, specs |
| `intitle:` / `inurl:` | `intitle:benchmark <topic>` | Targeted pages |
| `"exact"` / `-term` | `"<exact phrase>" -tutorial` | Precision, exclusion |
| `OR` | `<a> OR <b> <topic>` | Coverage |
| `before:` / `after:` | `<topic> after:2025-06-01` | Recency control |

High-yield combinations: official docs (`site:<docs domain>`), GitHub implementations (`site:github.com`), recent discussion (`site:reddit.com OR site:news.ycombinator.com after:<date>`), academic (`site:arxiv.org OR filetype:pdf survey`), changelog hunting (`changelog OR "release notes" <version>`), alternatives (`vs OR alternative OR comparison`).

## Failure modes

| Failure | Correction |
|---|---|
| Sequential one-at-a-time probing, or trimming the first wave | All first-wave lanes staged at once as team tasks (serial consults only with no team), scaling floor respected |
| A team member hoards leads for one final dump | Raise law — every lead, finding, and dead end broadcast the moment it surfaces |
| Lane reply without the EXPAND tail | One follow-up demanding it; the lane stays open until it lands |
| Stopping after wave 1 because "enough was found" | Convergence rules only: 2+ expansion waves, leads run dry |
| Obeying a surrounding "stop exploring" rule mid-research | Authority section — those rules do not bind this mode |
| Asking a lane to write journal or session files | Lanes are read-only; you journal every return |
| Two lanes given the same angle | One unique angle per lane, always |
| A `Browsing: yes` run whose roster carries no browsing lane, or a browsing lane dispatched without `ultimate-browsing` | The browsing column is binding — name the angle in the task, name the `ultimate-browsing` skill inside it, and dispatch it in the first wave before any lead is chased |
| Contested claim settled by judgment | Phase 3 — run code, capture output, verdict |
| Deliverable claims without citations | Every claim cites a source or a verification artifact |
| Guessing the deliverable format | Derive it from the request and destination; ask the empty-info interview only for what is still missing, and record `answered_by` for every field |
| Blocking the collection wave on the format question | Ask non-blocking and start collecting; unanswered fields run on the shown defaults |
| A roster smaller than the harness ceiling | Fill every member slot; split the broadest axis until the team is full |
| One tier across the whole roster | Mixed tiers by design — cheap breadth, premium attack |
| Silently re-routing a "quick"/"fast" instruction | Routing words are literal; journal requested -> spawned -> fallback per slot |
| A lane or member that starts its own research swarm | Members research one axis and report; orchestration is yours alone |
| Expanding on an entity the first wave never disambiguated | Settle canonical identity and first-party source before any later task asserts it |
| Batching findings into an end-of-run journal dump | Journal each return as it lands; the journal is what survives a compaction |
| Ending the run because every lane finished | Reserve the final fifth of the run for synthesis and materials |
| A derived estimate presented as a measured number | MEASURED / ASSUMED / DERIVED lineage on every quantitative claim, plus a sensitivity line |
| Delivering before the delivery gates pass | Static and layout gates, visual QA on rendered pages, plus the harness's proofread gate — a typo the user finds means a gate did not run |
| Skipping the static gates | `report-tools check` runs before any pixel review; its defects are cheaper than a visual pass |
| Delivering with a pending manifest row | `outcome verify` must pass; every promised format ends `delivered`, `blocked_capability`, `skipped`, or `failed` with a reason |
| Repairing past the tracker's stop decision | `repair decide` owns the budget; `deliver` ships with the residual list, `block` stops delivery |
| Guessing a design-spec value the extractor marked `TODO: ask` | Fill it from the interview answers or the reference's defaults, never by guessing |
| Referencing an asset that is not on disk | Verify the asset manifest before rendering; re-render whatever is missing |
| A figure stretched, cropped, or styled off the report's design language | `design-spec.md` binds every asset: fixed containers, contain-fit with aspect preserved, spec fonts and palette in charts and Mermaid |
| Chasing an interesting find with no ENTER trigger | Excursions need a named trigger; everything else stays a queued lead |
| An excursion that never came back, or drifted into a new mission | EXIT rules are unconditional; depth 3 means promote it to an axis or record it as a gap |
| An excursion whose result was never folded back | Every EXIT writes what it changed in the top-level answer, `none` included, and mirrors into the loop ledger |
| Delivering without the closing briefing | Paste the block `outcome briefing` prints; never compute or recall its numbers by hand |
