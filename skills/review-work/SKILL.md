---
name: review-work
description: "Post-implementation gate review: run manual QA on the real surface yourself, then launch ONE gate reviewer (never a panel) to audit goal, constraints, code quality, security, missed context, and QA evidence. Use before a PR handoff or when the user explicitly asks to review completed work."
---
# Review Work - Gate Review Orchestrator

Review completed implementation work through exactly two lanes: your own hands-on manual QA on the real surface, and ONE gate reviewer sub-agent that audits the whole change set against the goal, the constraints, and your QA evidence. The review passes only when the QA matrix has no failing row AND the gate reviewer returns APPROVE.


When `review-work` is used as a final implementation, PR, or `$ulw-execute`
gate, the selected review is blocking. A timeout, missing deliverable, ack-only response,
explicit `BLOCKED:`, or inconclusive lane is not a pass. Treat that lane as
failed, investigate the underlying uncertainty with the `debugging` skill when
runtime behavior may be wrong, fix with evidence, and rerun the affected lane
before claiming completion, creating or handing off a PR, or merging.

After each lane reaches PASS, immediately append a durable task-evidence record
to the active ledger with the lane name, exact full commit SHA, PASS verdict,
and report artifact/source. Before reusing coverage after continuation or
compaction, re-read that record and require the exact lane/SHA pair. Memory,
chat history, or an unstamped report is not coverage; a new commit requires
fresh applicable lane records.

A rejecting lane must name its blockers inline in its final message — each
blocker cites the violated goal criterion or requirement plus an evidence
pointer. A bare REJECT/FAIL token without findings is not a verdict; treat it
as an inconclusive lane (one bounded respawn, then record it inconclusive with
that reason).

When reviewing a PR or branch, collect diff, file contents, and verification
results from a dedicated review worktree attached to that branch. Never
checkout, test, or edit the review branch in the main worktree.

Review evidence must be safe to share. Redact or mask secrets and sensitive
user data before including evidence in logs, PR bodies, or handoffs. Never
include raw tokens, credentials, auth headers, cookies, API keys, env dumps,
private logs, or PII; summarize with lengths, hashes, and short non-sensitive
prefixes when identity is needed.

One reviewer, not a panel. A single gate reviewer holding the full context (goal, diff, history, QA evidence) catches what a fan-out of narrow reviewers misses between their seams, and it costs one agent instead of five. Never add review lanes; widen the gate reviewer's checklist instead.

| Lane | Who runs it | Question it answers |
|------|-------------|---------------------|
| Manual QA | You, the orchestrator, on the real surface | Does it actually work? |
| Gate review | One gate reviewer sub-agent (`oracle` on OpenCode; the surface's gate-reviewer agent elsewhere) | Did we build what was asked - correctly, safely, well, and without missing context? |

---

## Phase 0: Gather Review Context

Before running anything, collect these inputs. Extract from conversation history first - the user's original request, constraints discussed, and decisions made are usually already in the thread. Only ask if truly missing.

<required_inputs>

- **GOAL**: The original objective. What was the user trying to achieve? Pull from the initial request in this conversation.
- **CONSTRAINTS**: Rules, requirements, or limitations. Tech stack restrictions, performance targets, API contracts, design patterns to follow, backward compatibility needs.
- **BACKGROUND**: Why this work was needed. Business context, user stories, related systems, prior decisions that informed the approach.
- **CHANGED_FILES**: Auto-collect via `git diff --name-only HEAD~1` or against the appropriate base (branch point, specific commit).
- **DIFF**: Auto-collect via `git diff HEAD~1` or against the appropriate base.
- **FILE_CONTENTS**: The full content of each changed file plus the neighboring files that show the established patterns. Required verbatim when the reviewer cannot read files (`oracle`); when your surface's gate reviewer can read files and run commands, pass the paths and the diff instead of pasting everything.
- **RUN_COMMAND**: How to start/run the application. Check `package.json` scripts, `Makefile`, `docker-compose.yml`, or ask the user.
- **CONTEXT_MINING**: What the history and the trackers say about this area (collected below).

</required_inputs>

Review PRs and branches from a dedicated review worktree only: create or attach one with `git worktree add <path> <branch>` before collecting changed files, diff, file contents, or running checks, then immediately lock it with `git worktree lock <path> --reason "review:<pr-or-branch>"`. The main worktree is read-only context; never checkout, test, or edit the review branch there.

**Auto-collection sequence:**

```bash
# 1. Get changed files
git diff --name-only HEAD~1  # or: git diff --name-only main...HEAD

# 2. Get diff
git diff HEAD~1  # or: git diff main...HEAD

# 3. Detect run command
# Check package.json -> "scripts.dev" or "scripts.start"
# Check Makefile -> default target
# Check docker-compose.yml -> services

# 4. Mine the context the implementation may have missed (keep the output short)
git log --oneline -20 -- <each changed file>            # recent changes and their reasons
git log --all --oneline --grep="<keywords from goal>"    # related commits, reverts
gh issue list --search "<keywords>" --state all           # related issues (when gh is available)
gh pr list --search "<keywords>" --state all              # related PRs and their review comments
rg -n "TODO|FIXME|HACK" <changed files>                   # warnings left by previous authors
# plus: files that import the changed modules, tests touching the same paths,
# docs and config that reference the changed behavior
```

Record CONTEXT_MINING as a short list: source -> finding -> why it matters for this change. Slack, Notion, and Discord searches belong here too when those tools exist.

For GOAL, CONSTRAINTS, BACKGROUND - review the full conversation history. The user's original message almost always contains the goal. Constraints often emerge during discussion. If anything critical is ambiguous, ask ONE focused question - not a checklist.

---

## Phase 1: Manual QA (you run it)

You are the QA lane. Do not delegate hands-on QA to a sub-agent: the orchestrator owns the real-surface proof, exactly as the ulw-loop final gate records `manualQa` under the main session.

1. **Reuse first.** If this session already captured real-surface evidence for the FINAL tree (an ultrawork or ulw-loop evidence directory, a `visual-qa` verdict on this same build), consume it as QA rows instead of re-running. A fix committed after a capture stales that capture: re-run the rows it covered.
2. **Pick the channel that faithfully exercises the surface** and capture the artifact:
   - HTTP: `curl -i` (or an API request context) - status line, headers, body.
   - CLI / TUI: a real pty - drive the command and keep the transcript; for color or layout evidence render through a browser-based terminal, never a `tmux capture-pane` dump.
   - Web: the `agent-browser` CLI run from `bash` (see the `ultimate-browsing` skill's `references/chrome-stealth.md`) — the owned engine (a local `agent-browser --cdp <port>` session on a task-owned profile, or CloakBrowser for bot-scored targets) for unauthenticated pages, the attached engine (the user's signed-in browser, reached through `scripts/extract_cookies.py` cookie injection) when the page needs their login; never a clone of or a launch against the live profile. Capture action log plus screenshot.
   - Desktop / GUI: OS-level automation against the running app - action log plus screenshot.
   - Library / SDK: a script that imports and exercises the public API - transcript.
   - Data-shaped work (migrations, configs, generated files): the resulting artifact itself, diffed or dumped.
3. **Cover at least**: the happy path the goal names, the riskiest edge (empty, boundary, malformed, or concurrent input), and one regression on adjacent behavior the change could have broken. Add a row for every stated success criterion.
4. **Build the QA matrix** - one row per scenario:

| # | Scenario | Exact command / action | Expected | Observed | Verdict | Artifact |
|---|----------|------------------------|----------|----------|---------|----------|

A row without an artifact path is not PASS. If the application cannot even start, that is an immediate FAIL.

Any FAIL ends the review here: report **REVIEW FAILED** with the failing rows and skip the gate reviewer - reviewing code that does not work wastes the reviewer. Fix first, then re-enter at Phase 0 with the delta.

---

## Phase 2: Launch the Gate Reviewer (one agent)

Launch exactly one reviewer, in the background, then keep doing independent root work (teardown prep, report scaffolding) while it runs.

`oracle` cannot read files or run commands: it receives everything inline (DIFF + FILE_CONTENTS + CONTEXT_MINING + the QA matrix). If your surface's gate reviewer has read and shell tools, still paste the diff and the QA matrix, and hand it file paths instead of full contents.

```
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Gate-review the completed work against goal, constraints, and QA evidence",
  prompt="""
<review_type>GATE REVIEW</review_type>

<original_goal>
{GOAL - paste the user's original request and any clarifications}
</original_goal>

<constraints>
{CONSTRAINTS - every rule, requirement, or limitation discussed}
</constraints>

<background>
{BACKGROUND - why this work was needed, broader context}
</background>

<changed_files>
{CHANGED_FILES - list of modified file paths}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of every changed file, clearly delimited per file}
</file_contents>

<diff>
{DIFF - the actual git diff}
</diff>

Review whether this implementation correctly and completely achieves the stated goal within the given constraints. Be obsessively thorough - the point of this review is to catch what the implementer missed.

REVIEW CHECKLIST:

1. **Goal Completeness**: Break the goal into every sub-requirement (explicit AND implied). For each, mark ACHIEVED / MISSED / PARTIAL. Missing even one implied requirement that a reasonable engineer would have addressed = PARTIAL at minimum.

2. **Constraint Compliance**: List every constraint. For each, verify compliance with specific code evidence. A constraint violated = automatic FAIL.

3. **Requirement Gaps**: Requirements the user clearly wanted but didn't spell out. Things implied by the goal or background that a thoughtful engineer would have included.

4. **Over-Engineering**: Anything added that wasn't requested - unnecessary abstractions, extra features, premature optimizations, speculative generality. Flag these as scope creep.

5. **Edge Cases**: Given the goal, what inputs or scenarios would break this? Trace through at least 5 edge cases mentally.

6. **Behavioral Correctness**: Walk through the code logic for 3+ representative scenarios. Does the code actually produce the expected behavior in each case?

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<goal_breakdown>
  For each sub-requirement:
  - [ACHIEVED/MISSED/PARTIAL] Requirement description
  - Evidence: specific code reference or gap
</goal_breakdown>
<constraint_compliance>
  For each constraint:
  - [ACHIEVED/MISSED] Constraint description - evidence
</constraint_compliance>
<findings>
  - [PASS/FAIL/WARN] Category: Description
  - File: path (line range if applicable)
  - Evidence: specific code or logic reference
</findings>
<blocking_issues>Issues that MUST be fixed. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 2: QA via App Execution (unspecified-high) - MAIN

This agent answers: "Does it actually work when you run it?"

The QA agent follows a structured process: brainstorm scenarios exhaustively first, then self-review and augment, then create a task list, then execute systematically.

```
DSH: subagent(description="<same as below>", persona="<fetch via mpd_role_persona(role=Deep Worker)>", agentOptions={model: "deepseek-v4-pro"}, run_in_background: true, prompt="<TASK/DELIVERABLE/SCOPE/VERIFY + role>")
task(
  category="unspecified-high",
  run_in_background=true,
  ,
  description="QA by actually running and using the application",
  prompt="""
<review_type>QA - HANDS-ON APP EXECUTION</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<run_command>
{RUN_COMMAND - how to start the application, or "unknown" if not determined}
</run_command>

You are a QA engineer. Your job is to RUN the application and verify it works through hands-on testing. You do not review code - you test behavior.

If the orchestrator already ran the `visual-qa` dual-oracle gate on this same build, consume that verdict instead of re-running it - your lane covers hands-on behavior the visual gate does not.

MANDATORY PROCESS (follow in order):

### Step 1: Scenario Brainstorm

Before touching the app, write down EVERY test scenario you can think of. Be exhaustive. Think about:

- **Happy paths**: The primary use cases this implementation enables. What's the main thing the user wanted to do?
- **Boundary conditions**: Empty inputs, maximum-length inputs, zero values, negative numbers, special characters, unicode, very large datasets.
- **Error paths**: Invalid inputs, network failures, missing files, permission denied, timeout conditions.
- **Regression scenarios**: Existing features that touch the same code paths. Things that worked before and must still work.
- **State transitions**: What happens when you do things out of order? Rapid repeated actions? Concurrent usage?
- **UX scenarios** (if applicable): Layout on different sizes, keyboard navigation, screen reader compatibility, loading states, error messages.
- **Integration points**: Does this feature interact with external services, databases, or other modules? Test those boundaries.

Write each scenario as a one-liner with expected behavior. Aim for 15-30 scenarios minimum.

### Step 2: Scenario Augmentation

Review your scenario list with fresh eyes. For each scenario, ask:
- "What could go wrong here that I haven't considered?"
- "What would a malicious or careless user do?"
- "What environmental conditions could affect this?" (disk full, slow network, expired tokens)

Add at least 5 more scenarios from this reflection. Group scenarios by priority: P0 (must pass), P1 (should pass), P2 (nice to pass).

### Step 3: Create Task List

Convert your augmented scenario list into a structured task list (use TaskCreate/TaskUpdate or your todo system). Each task = one test scenario with:
- Test name
- Steps to execute
- Expected result
- Priority (P0/P1/P2)

### Step 4: Execute Systematically

Work through the task list in priority order (P0 first). For each test:

1. Execute the test steps
2. Record actual result
3. Compare with expected result
4. Mark PASS or FAIL
5. If FAIL: capture evidence (screenshot, terminal output, error message)
6. Mark the task complete

**Execution guidance by app type:**
- **Web app**: Drive a real browser — Playwright, agent-browser, or dev-browser — for work that does not need an authenticated user session, and a persistent/authenticated browser profile when the test does. Navigate, click, fill forms, and verify visual output through the chosen browser surface.
- **CLI tool**: Run commands with various arguments, pipe inputs, check exit codes and output.
- **Library/SDK**: Write and execute a test script that imports and exercises the public API.
- **Backend API**: Use curl/httpie to hit endpoints with various payloads, verify response codes and bodies.
- **Mobile/Desktop**: If not directly runnable, write integration tests and execute them.

If the app cannot be started (build failure), that's an immediate FAIL - no need to continue.

### Step 5: Compile Results

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<scenario_coverage>
  Total scenarios: N
  P0: X tested, Y passed
  P1: X tested, Y passed
  P2: X tested, Y passed
</scenario_coverage>
<test_results>
  For each test:
  - [PASS/FAIL] Test name (Priority)
  - Steps: What you did
  - Expected: What should happen
  - Actual: What actually happened
  - Evidence: Screenshot path or terminal output snippet (if FAIL)
</test_results>
<blocking_issues>P0 or P1 failures only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 3: Code Quality Review (Oracle) - MAIN

This agent answers: "Is the code well-written, maintainable, and consistent with the codebase?"

```
subagent(description="oracle",
  run_in_background=true,
  ,
  description="Review overall code quality, patterns, and architecture",
  prompt="""
<review_type>CODE QUALITY REVIEW</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files AND neighboring files that show existing patterns}
</file_contents>

<diff>
{DIFF}
</diff>

<background>
{BACKGROUND}
</background>

You are a senior staff engineer conducting a code review. Your standard: "Would I approve this PR without comments?"

REVIEW DIMENSIONS (examine each):

1. **Correctness**: Logic errors, off-by-one, null/undefined handling, race conditions, resource leaks, unhandled promise rejections.

2. **Pattern Consistency**: Does new code follow the codebase's established patterns? Compare with the neighboring files provided. Introducing a new pattern where one already exists = finding.

3. **Naming & Readability**: Clear variable/function/type names? Self-documenting code? Would another engineer understand this without explanation?

4. **Error Handling**: Errors properly caught, logged, and propagated? No empty catch blocks? No swallowed errors? User-facing errors are helpful?

5. **Type Safety**: Any `as any`, `@ts-ignore`, `@ts-expect-error`? Proper generic usage? Correct type narrowing? (If TypeScript/typed language)

6. **Performance**: N+1 queries? Unnecessary re-renders? Blocking I/O on hot paths? Memory leaks? Unbounded growth?

7. **Abstraction Level**: Right level of abstraction? No copy-paste duplication? But also no premature over-abstraction?

8. **Testing**: New behaviors covered by tests? Tests are meaningful, not just coverage padding? Test names describe scenarios?

9. **API Design**: Public interfaces clean and consistent with existing APIs? Breaking changes flagged?

10. **Tech Debt**: Does this introduce new tech debt? Or create coupling that will be painful to change?

Categorize each finding by severity:
- **CRITICAL**: Will cause bugs, data loss, or crashes in production
- **MAJOR**: Significant quality issue that should be fixed before merge
- **MINOR**: Improvement worth making but not blocking
- **NITPICK**: Style preference, optional

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<findings>
  - [CRITICAL/MAJOR/MINOR/NITPICK] Category: Description
  - File: path (line range)
  - Current: what the code does now
  - Suggestion: how to improve
</findings>
<blocking_issues>CRITICAL and MAJOR items only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 4: Security Review (Oracle) - SUB

This agent answers: "Are there security vulnerabilities in these changes?"

This is supplementary - it focuses exclusively on security. It does NOT comment on code style, architecture, or functionality unless those directly create a security risk.

```
subagent(description="oracle",
  run_in_background=true,
  ,
  description="Security-focused review of implementation changes",
  prompt="""
<review_type>SECURITY REVIEW (supplementary)</review_type>

<changed_files>
{CHANGED_FILES}
</changed_files>

<file_contents>
{FILE_CONTENTS - full content of changed files}
</file_contents>

<diff>
{DIFF}
</diff>

You are a security engineer. Review this diff exclusively for security vulnerabilities and anti-patterns. Ignore code style, naming, architecture - unless it directly creates a security risk.

SECURITY CHECKLIST:

1. **Input Validation**: User inputs sanitized? SQL injection, XSS, command injection, SSRF vectors?
2. **Auth & AuthZ**: Authentication checks where needed? Authorization verified for each action? Privilege escalation paths?
3. **Secrets & Credentials**: Hardcoded secrets, API keys, tokens in code or config? Secrets in logs?
4. **Data Exposure**: Sensitive data in logs? PII in error messages? Over-exposed API responses?
5. **Dependencies**: New dependencies added? Known CVEs? Suspicious or unnecessary packages?
6. **Cryptography**: Proper algorithms? No custom crypto? Secure random? Proper key management?
7. **File & Path**: Path traversal? Unsafe file operations? Symlink following?
8. **Network**: CORS configured correctly? Rate limiting? TLS enforced? Certificate validation?
9. **Error Leakage**: Stack traces exposed to users? Internal details in error responses?
10. **Supply Chain**: Lockfile updated consistently? Dependency pinning?

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<severity>CRITICAL / HIGH / MEDIUM / LOW / NONE</severity>
<summary>1-3 sentence overall assessment</summary>
<findings>
  - [CRITICAL/HIGH/MEDIUM/LOW] Category: Description
  - File: path (line range)
  - Risk: What could an attacker do?
  - Remediation: Specific fix
</findings>
<blocking_issues>CRITICAL and HIGH items only. Empty if PASS.</blocking_issues>
""")
```

---

### Agent 5: Context Mining (unspecified-high) - MAIN

This agent answers: "Did we miss any context that should have informed this implementation?"

```
DSH: subagent(description="<same as below>", persona="<fetch via mpd_role_persona(role=Deep Worker)>", agentOptions={model: "deepseek-v4-pro"}, run_in_background: true, prompt="<TASK/DELIVERABLE/SCOPE/VERIFY + role>")
task(
  category="unspecified-high",
  run_in_background=true,
  ,
  description="Mine all accessible contexts for missed requirements or background knowledge",
  prompt="""
<review_type>CONTEXT MINING - MISSED REQUIREMENTS & BACKGROUND</review_type>

<original_goal>
{GOAL}
</original_goal>

<constraints>
{CONSTRAINTS}
</constraints>

<changed_files>
{CHANGED_FILES}
</changed_files>

<background>
{BACKGROUND}
</background>

You are an investigator. Your mission: search every accessible information source to find context that should have informed this implementation but might have been missed. The question: "Is there something we should have known but didn't?"

SOURCES TO SEARCH (use every available tool):

1. **Git History** (ALWAYS search):
   - `git log --oneline -20 -- {each changed file}` - recent changes and their reasons
   - `git blame {critical sections}` - who wrote what and when
   - `git log --all --grep="{keywords from goal}"` - related commits
   - Look for reverted commits, TODO/FIXME/HACK comments in history

2. **GitHub** (if `gh` CLI available):
   - `gh issue list --search "{keywords}"` - related open/closed issues
   - `gh pr list --search "{keywords}" --state all` - related PRs and their review comments
   - Check if any issue is specifically linked to this work
   - Look at review comments on past PRs touching these files

3. **Communication Channels** (if MCP tools available):
   - Slack: search for messages mentioning the feature, file names, or related keywords
   - Notion: search for design docs, RFCs, ADRs related to this feature
   - Discord: relevant discussions

4. **Codebase Cross-References** (ALWAYS search):
   - Files that import or reference the changed modules
   - Tests that might need updating due to behavior changes
   - Documentation (README, docs/, comments) that references changed behavior
   - Config files that might need corresponding updates
   - Related features in the same domain

WHAT TO LOOK FOR:

- Requirements mentioned in issues/PRs that the implementation misses
- Past decisions explaining WHY code was written a certain way - and whether new changes respect those reasons
- Related systems or features affected by these changes
- Warnings from previous developers (PR review comments, inline TODOs, commit messages)
- Migration or deprecation notes that affect the changed code
- Design decisions documented outside the codebase (Notion, Slack, ADRs)

OUTPUT FORMAT:
<verdict>PASS or FAIL</verdict>
<confidence>HIGH / MEDIUM / LOW</confidence>
<summary>1-3 sentence overall assessment</summary>
<sources_searched>
  - [SEARCHED/SKIPPED] Source name - what was searched (or why it wasn't accessible)
</sources_searched>
<discovered_context>
  For each discovery:
  - Source: Where found (git commit abc123, GitHub issue #42, Slack message, etc.)
  - Finding: What was found
  - Relevance: How it relates to the current work
  - Impact: [BLOCKING / IMPORTANT / FYI]
</discovered_context>
<missed_requirements>Requirements the implementation should address but doesn't. Empty if none.</missed_requirements>
<blocking_issues>BLOCKING items only. Empty if PASS.</blocking_issues>
""")
```

## Phase 2: Wait & Collect

After launching all 5 agents in one turn, wait for completions in bounded
cycles. Do not treat a timeout, ack-only reply, or empty child result as
a PASS.

As each completes, collect via the Codex mapping above (`job_output`,
then the child's substantive final result). Preserve completed lane
results immediately; never lose a PASS/FAIL because another lane is
still running. Store each verdict independently:

| Agent | Verdict | Notes |
|-------|---------|-------|
| 1. Goal Verification | pending/PASS/FAIL/INCONCLUSIVE | - |
| 2. QA Execution | pending/PASS/FAIL/INCONCLUSIVE | - |
| 3. Code Quality | pending/PASS/FAIL/INCONCLUSIVE | - |
| 4. Security | pending/PASS/FAIL/INCONCLUSIVE | - |
| 5. Context Mining | pending/PASS/FAIL/INCONCLUSIVE | - |

Do NOT deliver the final report until ALL 5 lanes have a terminal state:
PASS, FAIL, or INCONCLUSIVE.
If a lane remains silent after the reliability followup, record it as
inconclusive and respawn a smaller reviewer/worker for that exact lane.
If it still remains unfinished after that retry, close the still-running
agent if safe, keep the lane INCONCLUSIVE, and emit the final aggregate
review result with the incomplete lane named. Do not spin in repeated
wait/followup cycles. Do not use `send_message` as an interrupt; queued
followups are not cancellation.

After ALL 5 lanes reach a terminal state and before delivering the verdict, tear down the review worktree: run `git worktree unlock <path>` followed by `git worktree remove <path>`. The lanes above run inside that worktree, so removing it earlier destroys their working directory; a crashed review leaves the locked tree as a recoverable marker for manual cleanup.

---

## Phase 3: Deliver Verdict

<verdict_logic>

ALL 5 agents returned PASS → **REVIEW PASSED**
ANY agent returned FAIL → **REVIEW FAILED - criteria not met**
ANY lane is INCONCLUSIVE and none failed → **REVIEW INCONCLUSIVE - not approved**

</verdict_logic>

Compile the final report in this format:

```markdown
# Review Work - Final Report

## Overall Verdict: PASSED / FAILED / INCONCLUSIVE

| Lane | Verdict | Confidence |
|------|---------|------------|
| Manual QA (N rows, M artifacts) | PASS/FAIL | - |
| Gate review | APPROVE/REJECT/INCONCLUSIVE | HIGH/MED/LOW |

## Blocking Issues
[Failing QA rows first, then the reviewer's blockers - deduplicated, in fix order, each with its pointer]

## Key Findings
[Top findings across QA and review, grouped by theme]

## Recommendations
[If FAILED: exactly what to fix, in priority order]
[If PASSED: non-blocking notes worth considering]
```

If FAILED - be specific. The user should know exactly what to fix and in what order: the problem, the file or artifact, and the fix. No vague "consider improving X".

If PASSED - keep it short. Highlight the non-blocking notes worth considering, but don't turn a passing review into a lecture.
