---
name: ulw-execute
description: "Execute a Prometheus work plan with Boulder state, evidence ledger updates, worktree discipline, serial roster consults, the mpd team plane, and Boulder-ledger resumption across turns (`.mpd/boulder.json` says this `dsh:<session_id>` still has unchecked plan work, so execute plan / resume plan re-enters it). Use after planning when the user says ulw-execute, execute plan, continue plan, resume plan, or asks to run a .mpd/plans plan."
---

## DSH Harness Tool Compatibility

Translate any OpenCode/Codex-only tool name in an inherited example to its DeepSeek Harness equivalent:

| OpenCode/Codex example | DSH tool to use |
| --- | --- |
| worker / reviewer `task(...)` | `mpd_role_spawn(role="<Roster Name>", task="TASK: … DELIVERABLE: … SCOPE: … VERIFY: …")` — ONE-SHOT consult: synchronous, one bounded delegation, one report. `context` carries the needed history; there is no `run_in_background`, `persona`, `agentOptions` or `description` |
| `subagent_fork(...)` | no mounted equivalent — a one-shot consult inherits no parent history; pass the needed context in `mpd_role_spawn`'s `context` |
| `job_output(task_id="...")` | no mounted equivalent: a one-shot consult returns its report as the tool result, so N SERIAL `mpd_role_spawn` calls can still cover the work, at the cost of concurrency; the team plane is the concurrency path |
| `task_id` continuation / re-task one child | a one-shot consult cannot be resumed — ask a NEW `mpd_role_spawn` and pass the prior report in `context`; for a team use `send_message(agent_id=<member>)` |
| `workflow` runs | the mpd team plane: `agent_teams_plan {action:"create"}` → one `add_member` per lane → one `create_task` per lane carrying `blocked_by` edges → `{action:"approve"}` → `agent_teams_dispatch {action:"run"}`. There is NO node-level `retry`/`amend`/`send`: a failed node is `agent_teams_task {action:"fail"}` plus a `kind:"repair"` row with `sourceTaskId`, and steering is `send_message(agent_id=<member>)` |
| `team_*(...)` | the mpd team plane (this bundle's team plane is the mpd RECORD): stage and approve with `agent_teams_plan` (`add_member` / `create_task` / `approve`), drive with `agent_teams_task` (`claim` / `complete` / `fail`) and `agent_teams_dispatch`, read with `agent_teams_plan {action:"status"}`. The official Agent Teams authoring tools — `spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update` — are REFUSED at the tool boundary by the team-door guard; `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` remain for agent communication |
| stop one child | `agent_teams_task {action:"fail"}` on a team lane; a one-shot consult cannot be interrupted mid-call |

Role-specific behavior goes inside the consult's `task` (self-contained `TASK / DELIVERABLE / SCOPE / VERIFY` blocks). Child agents keep their own `skill` tool — name the skills the child must load inside `task`. The specialists live in the mpd-roles ROSTER (ids from `mpd_roles_list`; normal names: Architect/Researcher/Planner/Deep Worker/Senior Engineer/Lead/Explorer/Reviewer/Plan Reviewer/Vision Analyst/Junior Engineer): `mpd_role_spawn(role=..., task=...)` applies the roster persona and model route, plus the mechanical read-only deny list for the six mechanically read-only roles (Architect/Researcher/Planner/Explorer/Plan Reviewer/Vision Analyst) — `Reviewer` is write-capable and findings-only by DISCIPLINE, not by a fence, so it CAN run a command-level pass (Phase 4's verifier rule). For multi-member team work use the mpd team plane (`agent_teams_plan` with `add_member` per member, `create_task` per DAG node, then `approve`; `agent_teams_task` / `agent_teams_dispatch` to drive, `send_message` to steer), not repeated one-shot spawns — the official Agent Teams authoring tools (`spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`) are REFUSED at the tool boundary; a teammate runs on the route of the session that stages it (yours in a top-level spawn), and a roster agent's own `agentRoutes.<Agent>` entry applies only when the teammate is identified as that member (its `role`, or the HEAD of its `description`) — prompt text cannot change a route; for a team member staged with the persona as text, fetch it with `mpd_role_persona(role=...)`; a one-shot consult takes only the roster NAME in `role`.

### Model tiering (DeepSeek V4)

A consult's model route is a CONFIGURATION choice, never a per-call one: the unit of model configuration is the AGENT, and the member's OWN persisted `agentRoutes.<Agent>` entry in `mpd.jsonc` decides the route — provider, model and its configured reasoning effort — and the consult cannot override it, because `mpd_role_spawn` accepts only `role`, `task` and `context` and has no `model` parameter at all. To move a class of consult to a stronger or cheaper route, use `/mpd-model`: its FOUR group shortcuts are a BULK-EDIT convenience that overwrites each affected agent's own entry (after a confirmation panel that lists the agents and their current routes), and the group itself stores nothing. An agent with no usable entry is REFUSED at spawn with `AGENT_UNCONFIGURED` naming the missing leaves (`agentRoutes.<Agent>.provider` / `.model`), so nothing runs on an invented route; there is no effort knob either, and no spawn surface here can pin a different one. Reasoning-heavy gates (plan review, verification, quality gate) are therefore only ever as strong as the agent route that serves their roles.

### Consult reliability (DSH)

Every consult task is a self-contained executable assignment (`TASK / DELIVERABLE / SCOPE / VERIFY`). `mpd_role_spawn` is SYNCHRONOUS: the report is the tool result, so there is no background child, no `job_output` poll and no `WORKING:`/`BLOCKED:` message to require. Two truthful topologies replace the old background burst: **(a)** N SERIAL `mpd_role_spawn` calls, one report each, when the lanes are independent — the work still gets covered, but with no concurrency; **(b)** the mpd team plane when the lanes are genuinely concurrent, where `agent_teams_dispatch` pairs ready tasks with members and `send_message` steers a member mid-flight. A consult that returns without its deliverable is recorded inconclusive (never a pass) and re-issued as a smaller task naming the missing deliverable.

## ABSOLUTE RULE: YOU ARE AN ORCHESTRATOR — NEVER THE IMPLEMENTER

**YOU DO NOT WRITE CODE. YOU DO NOT EDIT PRODUCT FILES. YOU DO NOT RUN QA YOURSELF. EVERY unit of implementation, test, QA, and review work MUST be delegated to a spawned roster worker (`mpd_role_spawn`) or a team member. NO EXCEPTIONS.** Your hands touch only plan selection, `.mpd/` state (Boulder, ledger, plan checkboxes), decomposition, dispatch, verdicts, and evidence records. About to edit a product file or run an implementation command yourself? **STOP. SPAWN A WORKER INSTEAD.** Orchestrate at **MAXIMUM SAFE CONCURRENCY**: independent units run as serial one-shot consults, and only genuinely concurrent lanes go on the team plane, where named dependencies serialize.

# ulw-execute

Execute a work plan until every top-level checkbox is complete. This skill pairs with the harness's ulw-execute continuation hook, which re-injects the next turn while `.mpd/boulder.json` says this `codex:<session_id>` still has unchecked plan work.

## Usage

```text
$ulw-execute [plan-name] [--worktree <absolute-path>] [--make-pr] [--ship]
```

- `plan-name` (optional): a full or partial file stem under `.mpd/plans/`.
- `--worktree` (required for PR/branch work; otherwise optional): the task-owned git worktree path.
- `--make-pr` (optional): deliver the work as a pull request. IMPLIES worktree mode: when `--worktree` is absent, create a task-owned worktree (`git worktree add <absolute-path> <base-branch>`) before implementation and record it as `worktree_path`. On completion, push the branch and open a reviewer-readable PR, then hand off with the PR URL - merge only if the user asks.
- `--ship` (optional): full delivery lifecycle; implies `--make-pr`. After the PR opens, stay on the job until it is MERGED: watch CI and review gates, fix failures and address feedback from the worktree (fresh QA evidence for behavior changes), merge per the repository's merge policy, then remove the worktree and sync `.mpd/` state back.

## Goal and todo discipline (MANDATORY)

Do ALL of this immediately after the plan is selected, BEFORE the first implementation dispatch. Skipping any step is a defect.

1. **Set the goal, in detail.** When a goal tool is available (`create_goal`), call it with a DETAILED objective: the plan name and path, the concrete end state, the phase and task counts, the delivery mode (direct, `--make-pr`, or `--ship`), and how completion will be verified. One work session = one goal. No goal tool -> record the same objective as the first ledger entry.
2. **Register every phase and task as todos.** Mirror the plan into the todo/plan tool of your harness: one phase per plan wave, one todo per column-zero checkbox (including the final verification wave). Register ALL of them up front - never keep tasks in memory only.
3. **Keep them current at every moment.** Mark a todo in_progress when its work dispatches and done immediately after its verification passes. Never batch-complete at the end, never execute work that is not a registered todo; discovered work is appended as a todo before it runs. The todo list, Boulder state, and plan checkboxes must always tell the same story.

## Phase 1: Select the plan

1. Read `.mpd/boulder.json` if it exists.
2. List Prometheus plan files under `.mpd/plans/`.
3. If `plan-name` was provided, select the matching plan.
4. If exactly one active or paused Boulder work exists for this session, resume it.
5. If no active work exists and exactly one plan exists, select it.
6. If no active work exists and there is no selectable plan, enter **No-plan bootstrap**.
7. If multiple plans remain possible, ask one focused selection question.

### No-plan bootstrap

When the user explicitly said `start work` / `execute plan` and no selectable plan exists, treat that phrase as approval: bootstrap `ulw-plan` to create the approved plan before execution and implementation, instead of stalling or asking for generic approval again. A brief or notes file without waves, checkboxes, and acceptance criteria is NOT decision-complete — enter this bootstrap too.

1. Invoke the `ulw-plan` skill from the current request and require its dynamic adversarial workflow: collect, verify, design, adversarial plan-review, synthesize.
2. The generated Prometheus plan must be saved under `.mpd/plans/<slug>.md` before implementation or Boulder state writes that point at plan work.
3. Use maximum safe parallelism in the generated plan: independent files/tasks fan out; same-file writes, shared state, and named dependencies serialize.
4. Preserve safety boundaries. Ask one focused question only when the objective is missing, destructive, or has a safety/product ambiguity that repository exploration cannot resolve.
5. After the plan exists, continue directly to Phase 2.

## Phase 2: Create or update Boulder state

Write `.mpd/boulder.json` before implementation starts. Prefix session ids with `dsh:` so the continuation driver can identify its own session.

```json
{
  "schema_version": 2,
  "active_work_id": "<work-id>",
  "works": {
    "<work-id>": {
      "work_id": "<work-id>",
      "active_plan": ".mpd/plans/<plan-name>.md",
      "plan_name": "<plan-name>",
      "session_ids": ["dsh:<session_id>"],
      "status": "active",
      "worktree_path": null
    }
  }
}
```

Every phase (plan wave) runs in its own task-owned worktree with its own goal: before the wave's first dispatch, record the wave's goal — its checkboxes and their acceptance criteria — as a ledger entry, then `git worktree add <repo>-wt/<plan>-<wave> <branch off the integration base>` (or verify a `--worktree` path with `git worktree list --porcelain`), store the absolute path as `worktree_path`, run every edit, command, test, and evidence capture inside it; the wave lands on the integration base once its checkboxes are verified (direct merge, or the PR under `--make-pr`/`--ship`), and the next wave branches from that landed base.

## Delivery lanes (serial consults and teams)

One-shot consults run serially; the mpd team plane is the concurrency topology. Decide once, when the wave's lanes are known, and record the verdict in the ledger:

- **Independent lanes -> serial consults.** Separate files, no shared contract: N SERIAL `mpd_role_spawn` calls, each returning its report; no team.
- **Dependency-ordered lanes -> the mpd team plane.** Sub-tasks with real ordering between them (C needs A and B finished first): stage one plan (`agent_teams_plan {action:"create"}`), one `add_member` per lane, one `create_task` per lane carrying its `blocked_by` edges (or `independent:true`), then `{action:"approve"}` and `agent_teams_dispatch {action:"run"}`. There is NO node-level `retry`/`amend`/`send`: a failed node is `agent_teams_task {action:"fail"}` plus a `kind:"repair"` row with `sourceTaskId`, and mid-flight steering is `send_message(agent_id=<member>)`.
- **Overlapping lanes -> a team, never a parallel burst.** The lanes touch the same module or contract AND a team finishes sooner: the team plane serializes the dependency edges and one lane's discoveries relay through you mid-flight.
- **PR-mode independent lanes -> a worktree per lane.** Under `--make-pr`/`--ship`, when a wave holds independent checkboxes, give each lane its own branch and task-owned worktree, delivered as its own PR.

Landing rules, regardless of topology:

- **Merge per verified unit.** A lane lands the moment its own gates pass — it never waits for the slowest sibling. Integrate landed work back into the base the remaining lanes branch from.
- **Only the orchestrator merges.** Workers and team members never merge and never push the base branch.
- **Conflicts are the orchestrator's job.** Decide the landing order and tell the later lane what changed; a worker never resolves a sibling's conflict blind.

## Phase 3: Execute the next checkbox

1. Read the full selected plan.
2. Find the first unchecked column-0 checkbox in `## TODOs` or `## Final Verification Wave`.
3. Ignore nested checkboxes under acceptance criteria, evidence, and definition-of-done sections.
4. Classify the checkbox tier and record it in its ledger entry. Default is LIGHT — a narrow change inside existing layers. Take HEAVY only on a fact you can point to: a new module / abstraction / domain model; auth, security, or session; an external integration; a DB schema or migration; concurrency or transaction boundaries; a cross-domain refactor; or the plan or user signals care. When unsure, take HEAVY; upgrade and redo skipped gates the moment a HEAVY fact surfaces; never downgrade.
5. Decompose that checkbox into atomic sub-tasks sized for ONE worker in ONE consult — a sub-task that would need mid-flight steering is two sub-tasks. Collect every other unchecked checkbox in the same plan wave whose dependencies are met — their lanes run as serial consults, or concurrently on the team plane when a team is staged. A wave that could split further but holds fewer than 3 independent sub-tasks is under-split.
6. **DELEGATE EVERYTHING. YOU NEVER IMPLEMENT.** Route every sub-task through the delegation router below, then dispatch every independent sub-task across those checkboxes: SERIAL `mpd_role_spawn` calls, or one `create_task` per lane on the team plane; route named dependencies per the lane-topology decision above. Verification and checkbox marking stay per-checkbox.
7. Give every dispatched sub-task its completion condition and track it per the section below. A dispatch whose completion nobody tracks is an unfinished dispatch.

### Track every dispatched consult or team lane to its completion condition

A dispatched lane is not fire-and-forget. For EACH consult or team task, name the observable state that ends its lane — the file written, the PR opened, the checkbox's gates green.

- **A serial consult completes when it returns.** `mpd_role_spawn` yields its report as the tool result; there is no background child and therefore no watcher, poll or completion notification to arm.
- **A team lane completes on the board.** `agent_teams_task {action:"complete"}` / `{action:"fail"}` is the signal; read it with `agent_teams_plan {action:"status"}`, and steer a working member with `send_message(agent_id=<member>)`.
- **NEVER poll and NEVER sleep.** There is no async child to wait on; between consults do the independent root work, and between team waves read the board once.
- **Then advance.** A returned report plus verified evidence closes the lane; a report that returns without its deliverable is recorded inconclusive and re-issued — never treated as a pass.

### Delegation router — roster role by task shape

When the plan annotates a todo with `Recommended task executor category:`, map that annotation through the table below; deviate only for a reason recorded in the ledger entry. There is no `category` or `load_skills` argument on the mounted spawn surface — name the skill the child must load inside `task` instead.

| Plan annotation / task shape | `mpd_role_spawn(role=...)` |
| --- | --- |
| `quick`, `unspecified-low`, `git`, mechanical, single-file, boilerplate, config/copy | Junior Engineer — the default for every splittable piece |
| `writing` | Junior Engineer, with the documentation rule named in `task` |
| `unspecified-high` | Senior Engineer |
| `visual-engineering`, frontend, UI/UX, styling | Vision Analyst |
| `deep-low` | Deep Worker |
| `deep-high` | Deep Worker, or Senior Engineer when the central decision rests on a cross-package contract |
| `ultrabrain` | Architect — hand it the goal, not step-by-step instructions |

Sizing is a two-branch decision made per checkbox, before dispatch:

- **Splittable work splits.** When the checkbox decomposes into independent pieces, issue SERIAL Junior Engineer consults for them — one report each — and stage a team only when the pieces are genuinely concurrent and touch disjoint scopes.
- **Cohesive hard work stays whole.** When splitting would sever shared reasoning (one algorithm, one migration, one subtle bug), send the WHOLE problem to ONE `deep`-shaped role — Deep Worker, Senior Engineer or Architect — as ONE consult. Never force-split work whose parts share one insight.

Each sub-task message must include:

1. Goal and exact files or directories in scope.
2. The tests already covering the touched behavior, READ before any edit as the behavior of record (intent, coverage, pass); a bug's reproduction captured before the fix. A new test ONLY where the repository keeps tests for this behavior AND a regression would otherwise pass unnoticed by the sub-task's Manual-QA scenario — never one that mirrors its implementation (mock-call assertions, pinned constants) or restates the change.
3. Implementation constraints from the plan and project rules.
4. Automated verification commands to run.
5. One Manual-QA channel, named with the exact tool and exact invocation (the literal `curl`, `send-keys`, `page.click` / `session.click`, payload, selectors, and the binary observable that decides PASS/FAIL), not "verify it works". A LIGHT checkbox needs one real-surface proof of its deliverable, and auxiliary surfaces (CLI stdout, DB state diff, parsed config dump) are first-class when the surface is CLI- or data-shaped:
   - HTTP call: `curl -i` against the live endpoint.
   - Terminal / TUI: drive a real pty; `tmux send-keys` is fine for a boot/behavior smoke, but color/layout/CJK evidence goes through the xterm.js web terminal below, NEVER `tmux capture-pane`.
   - Browser use: the `agent-browser` CLI run from `bash` (see the `ultimate-browsing` skill's `references/chrome-stealth.md`) — the owned engine (a local `agent-browser --cdp <port>` session on a task-owned profile, CloakBrowser for bot-scored targets) for unauthenticated pages, the attached engine (the user's signed-in browser, reached through `scripts/extract_cookies.py` cookie injection) when the page needs their login; never a clone of or a launch against the live profile.
   - Computer use: OS-level GUI automation against the running desktop app when the surface is not a page.
   - TUI visual evidence: when a TUI claim needs visual QA or PR proof, run `bun script/qa/web-terminal-visual-qa.mjs --command "<cmd>" --input "{Enter}" --evidence-dir <dir>` (real pty rendered through xterm.js in Chrome) and attach `terminal.png` plus `metadata.json`.
6. The adversarial classes that apply to this sub-task (from the 9 ultraqa classes) and how each is probed.
7. Required artifact path and cleanup receipt.
8. Tool-use expectations: batch independent tool calls in parallel; when the harness exposes a code-execution surface (eval), use it for multi-call steps instead of one-by-one calls.

The 9 ultraqa classes are trigger-mapped: new input parsing → malformed input; untrusted external text → prompt injection; resumable or long-running flows → cancel/resume; generated or cached artifacts → stale state; uncommitted user files in scope → dirty worktree; long external commands → hung or long commands; new or timing-sensitive tests → flaky tests; log-based success claims → misleading success output; mid-operation interrupts → repeated interruptions. A class applies when its trigger fact holds. Probe each applicable class; record the rest as not-applicable with a one-line reason.

## Phase 4: Verify and record evidence

For each checkbox, complete all five gates before marking it done:

1. Plan reread: confirm the checkbox and acceptance criteria.
2. Automated verification: run tests, typecheck, lint, build, or the plan-specific equivalent.
3. Manual-QA channel: capture a real artifact, not a dry-run claim.
4. Adversarial QA: exercise every class the Phase 3 trigger map marks applicable and capture the observable result for each.
5. Cleanup: register every QA resource teardown as its own todo when spawned (QA scripts, tmux assets, browser sessions, PIDs, ports, containers, temp dirs), execute each, and capture the receipt. No QA asset is left running.

Append evidence to `.mpd/ulw-execute/ledger.jsonl`, one JSON object per line. Include at least `event`, `plan`, `task`, `session_id`, `commands`, `artifact`, `adversarial_classes`, and `cleanup` fields. `adversarial_classes` lists each probed class with its observable result and each ruled-out class with a one-line reason.

### Sisyphus-style completion contract

A worker done claim is never final: each implementation sub-task returns a `DoneClaim`, a different context runs `AdversarialVerify` probing or reproducing the claim, failures loop back to the executor, and only a confirmed verifier verdict becomes `FullyDone`.

```json
{
  "DoneClaim": {
    "task": "<task id/title>",
    "changed_files": ["path"],
    "tests": ["exact command + result"],
    "manual_qa": ["artifact path"],
    "cleanup": ["receipt"],
    "risks": ["known risk or none"]
  },
  "AdversarialVerify": {
    "verdict": "confirmed | false-positive | needs-fix | needs-human-review",
    "evidence": ["file path, command, log, artifact, or explicit not inspected"],
    "repro": "exact command or manual steps when available",
    "confidence": 0.0
  }
}
```

Rules:
- `confirmed` is the only pass verdict. `false-positive`, `needs-fix`, and `needs-human-review` all block checkbox completion.
- The verifier must be independent from the executor: a READ-LEVEL pass (architecture, design, findings judged from evidence already on disk) goes to `mpd_role_spawn(role="Architect")` — mechanically read-only (no `bash`), so it cannot touch what it judges; a COMMAND-LEVEL pass (probes and repro commands actually run) goes to `role="Reviewer"` (write-capable and findings-only by DISCIPLINE, not by a fence — it can run `bash` and still reports without editing) or to `role="Senior Engineer"`, else `role="Deep Worker"` — choose for capability plus independence from the executor. Or a fresh reviewer lane on the team plane, or root only when root did not implement or materially rewrite that task.
- A worker done claim must be independently verified before it becomes checkbox completion.
- On any non-confirmed verdict, append the feedback to the ledger, reset the checkbox work to in-progress, and re-dispatch the executor with the exact failure.
- The verifier must probe the applicable adversarial keys, including `stale_state`, `dirty_worktree`, and `misleading_success_output`, before allowing `FullyDone`.

## Phase 5: Mark progress

Only after verification passes:

1. Edit the plan checkbox from `- [ ]` to `- [x]`.
2. Re-read the plan and confirm the remaining count decreased.
3. Append a `task-completed` ledger entry.
4. Continue with the next checkbox. Do not ask whether to continue.

## Completion

When all top-level checkboxes in `## TODOs` and `## Final Verification Wave` are complete:

1. Run the plan's final verification commands.
2. Record a self-review in the notepad: re-read the diff, run diagnostics, and capture evidence for every acceptance criterion. Run your own manual QA on the real surface.
3. Only when the user demanded strict, rigorous, or high-accuracy review, spawn ONE rigorous reviewer — `mpd_role_spawn(role="Architect", task=...)`, on whatever route the roster slot gives it; otherwise your self-review is the final verification.
4. Finish the PR/branch lifecycle from its task-owned worktree: sync `.mpd/` state back to the main repo, create or update the PR, wait for review/verification gates, merge by default unless explicitly opted out, and remove the worktree only after successful merge or explicit handoff.
5. Remove or mark the Boulder work as completed.
6. Print an `ORCHESTRATION COMPLETE` block with the plan path, verification commands, artifacts, and cleanup receipts.

## Hard rules

- No production change before the tests covering that behavior were read and a bug's reproduction captured; existing tests are green on the unchanged code first, and one that contradicts the intent is a FINDING, never edited green.
- No `--dry-run` as completion evidence.
- No tests-only completion claim. A Manual-QA artifact is required.
- **NO DIRECT IMPLEMENTATION BY THE ORCHESTRATOR.** Root NEVER edits product files, writes tests, or runs QA itself — a spawned worker does.
- No completion claim while an applicable ultraqa adversarial class was never probed. Each applicable class needs a captured observable result; each skipped class needs a one-line not-applicable reason in the ledger.
- No implementation, review, or merge in the main checkout; every phase works in a task-owned worktree.
- No unprefixed session ids in Boulder state. Sessions are always recorded as `codex:<session_id>`.
- No stale-memory execution. The plan and ledger are the durable source of truth.
- Codex final verification is the exception to the delegated-QA-only rule above: perform your own manual QA on the real surface and record a self-review before completion.
