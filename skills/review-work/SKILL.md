---
name: review-work
description: "Post-implementation gate review: run hands-on QA on the real surface yourself, then run OUR panel — three read-only reviewer lanes spawned as roster-named teammates (Architect, Reviewer, Explorer) plus your own QA lane — merged into ONE table with the verdict tokens PASS | FAIL | INCONCLUSIVE. Use before a PR handoff or when the user explicitly asks to review completed work."
---
# Review Work - Panel Gate Review Orchestrator

Review completed implementation work through exactly four lanes: your own hands-on manual QA on the real surface, plus three read-only reviewer lanes spawned as roster-named teammates. The review passes only when every lane reaches a terminal verdict and the merge table carries no FAIL.

The panel, the merge table, the degrade matrix and the lane contracts in this skill are THIS REPOSITORY's own work (MIT). They replaced a single gate reviewer; the retired panel text that predated them is not a reference for anything here.


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

**A lane's verdict is a RECORDED verdict, never a vibe.** Every lane reports the commands it ran with their observed exit codes, the artifacts it read, and the paths it cites by path + symbol (never by line number, which rots on the next edit). A lane that cannot cite its evidence returns INCONCLUSIVE, not PASS.

---

## The panel lanes

Four lanes, one per question. Do not widen the panel when a lane's answer is unsatisfying — widen that lane's brief instead.

| # | Lane | Roster role | Lane discipline | Question it answers |
|---|------|-------------|-----------------|---------------------|
| 1 | Manual QA | — (the orchestrator, in person) | hands-on, never edits | Does it actually work on the real surface? |
| 2 | Quality & architecture | Architect | read-only findings | Is it built well - design, structure, maintainability, consistency with this codebase? |
| 3 | Correctness & risk | Reviewer | read-only findings | Is it correct and safe - logic, error paths, security, secrets, blast radius? |
| 4 | Missed context | Explorer | read-only findings | What did the change miss - callers, tests, docs, config, migrations, conventions? |

The three reviewer lanes are **read-only**: they produce findings and evidence pointers, never fixes. `Architect` and `Explorer` are mechanically denied the write tools by the roster's own read-only guard; `Reviewer` carries a findings-only discipline in its roster description ("no fixes") and is bound by the same lane contract, so a reviewer lane that edits the change set has broken the review — record that as a FAIL of that lane rather than accepting its findings.

A lane's role is what it is called by: the roster is the single naming system (`mpd_roles_list` / `mpd_role_persona`), and the same names route the team's model slots.

**A fix is never a lane's action.** A blocking finding becomes a repair task for a writer on a DIFFERENT pass, and the affected lane re-runs after the repair. Bouncing work back is the point of the panel; quietly repairing inside a review lane destroys the independence the verdict rests on.

---

## Degrade matrix (declared, not implied)

The official team path is the primary one. Each fallback below is a DECLARED degrade, and the lane labels itself with the path it took, so a reader can tell which guarantees were actually in force.

| Condition | Panel behaviour | What the lane can still reach |
|---|---|---|
| The official team tools are absent (no `spawn_teammate` in this session's tool list) | spawn each lane one-shot with `mpd_role_spawn`, one call per lane, same roster role; the roster's model-slot route applies on that path | PASS / FAIL / INCONCLUSIVE - the persona and the read-only guard still apply |
| A lane's model slot cannot be resolved | that lane alone is INCONCLUSIVE and NAMES the member and the slot; never substitute another model, and never clamp an effort | INCONCLUSIVE only |
| `mpd-roles-plugin` is unmounted (`mpd_role_persona` / `mpd_role_spawn` are not offered) | spawn plain `subagent` lanes, each labelled `panel=advisory`; they carry no persona and no read-only guard | FAIL or INCONCLUSIVE only - a `panel=advisory` lane can NEVER produce a PASS |

Two more rules hold across the matrix:

- **Silence is not a verdict.** A lane that never reports is INCONCLUSIVE after ONE bounded followup, and the review must say so in the merge table rather than dropping the row.
- **Advisory versus bound.** A panel FAIL is BLOCKING only when the panel runs as a BOUND verification seat (`mpd_verify_seat` + `mpd_verify_record`). Otherwise the verdict is ADVISORY and you, the orchestrator, decide - and you say which of the two you are reporting, because the same table means two different things.

---

## The merge table

ONE table, every lane, whatever path it was spawned by. There is no second table and no lane missing from it:

```markdown
| Lane | Roster role | Verdict | Evidence |
|------|-------------|---------|----------|
| Manual QA | — (the orchestrator) | PASS | <artifact pointer + the exact commands> |
| Quality & architecture | Architect | PASS | <artifact pointer + the exact commands> |
| Correctness & risk | Reviewer | PASS | <artifact pointer + the exact commands> |
| Missed context | Explorer | PASS | <artifact pointer + the exact commands> |
```

The verdict tokens are exactly `PASS`, `FAIL` and `INCONCLUSIVE`.

The lane count is stated once in this skill's opening sentence, and it is the count in the panel table above and in the merge table. A QA case (`skills/dsh-qa/scripts/review-panel.ts`) asserts that all three counts agree and that every roster role named here is a member of the served `ROLES`; a lane added, removed or renamed without updating all three reddens that case.

---

## Phase 0: Gather Review Context

Before running anything, collect these inputs. Extract from conversation history first - the user's original request, constraints discussed, and decisions made are usually already in the thread. Only ask if truly missing.

<required_inputs>

- **GOAL**: The original objective. What was the user trying to achieve? Pull from the initial request in this conversation.
- **CONSTRAINTS**: Rules, requirements, or limitations. Tech stack restrictions, performance targets, API contracts, design patterns to follow, backward compatibility needs.
- **BACKGROUND**: Why this work was needed. Business context, user stories, related systems, prior decisions that informed the approach.
- **CHANGED_FILES**: Auto-collect via `git diff --name-only HEAD~1` or against the appropriate base (branch point, specific commit).
- **DIFF**: Auto-collect via `git diff HEAD~1` or against the appropriate base.
- **FILE_CONTENTS**: The full content of each changed file plus the neighboring files that show the established patterns. Every lane in this bundle's roster can read files and run commands, so hand it the paths and the diff instead of pasting contents; paste contents only when a lane's surface cannot read.
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

Any FAIL ends the review here: report **REVIEW FAILED** with the failing rows and skip the reviewer lanes - reviewing an implementation that does not run wastes three reviewers. Fix first, then re-enter at Phase 0 with the delta.

---

## Phase 2: Launch the three reviewer lanes

Launch all three lanes in ONE turn, in the background, with `context: fresh` so a lane never inherits the author's reasoning as its own starting assumption.

### Per lane: the official team path (primary)

For each of the three reviewer lanes, in this order:

1. **Fetch the persona as TEXT** - `mpd_role_persona {role: "Architect"}` (then `Reviewer`, then `Explorer`). The persona is the lane's operating discipline; paste it into the member's prompt together with the brief below, so the member gets the real role instructions rather than a label.
2. **Spawn ONE teammate per lane** with `spawn_teammate`. The member's `name` IS the roster name (`Architect`, `Reviewer`, `Explorer`), and its `description` MUST BEGIN with that same roster name: the roster provider routes a teammate by the head of its description, so `"Architect - quality and architecture lane"` routes the Architect model slot while `"check the diff"` inherits the lead's route. That prefix is the whole routing contract, not decoration.
3. **Create one task per lane on the shared board** - the lane's deliverable, its acceptance anchor, its evidence requirement and its write scope (read-only: findings only). One task per lane keeps requirement, work and review separable, and gives the merge table one row per task rather than one row per agent.
4. **Hand the member the brief** (below) in the spawn prompt, not in a follow-up message.

The two fallbacks live in the degrade matrix above; use them only under their stated condition, and label the lane with the path it took.

### The lane brief

```text
TASK: <the lane's question, one sentence, naming the change set and the goal>
DELIVERABLE: a verdict message with
  - VERDICT: PASS | FAIL | INCONCLUSIVE
  - FINDINGS: each with severity, the violated goal criterion or requirement, and a pointer
    (path + symbol, never a line number)
  - EVIDENCE: the exact commands you ran with their observed exit codes, and the artifacts you read
SCOPE: <the changed files, the diff base, the docs and config in play>
VERIFY: check each claim against the artifact yourself; distinguish what you observed from what you
  inferred, and name anything you could NOT prove.
FORBIDDEN: editing any file; fixing anything; a PASS without evidence.
```

### What each lane audits

- **Architect (Quality & architecture)** - is the design coherent with the codebase's existing patterns; are boundaries, seams and responsibilities where this repository puts them; is the diff minimal for the requirement; is an abstraction justified by more than one caller; is anything duplicated that already exists; would the next reader understand it without the chat history.
- **Reviewer (Correctness & risk)** - logic and off-by-one errors, error and empty paths, race and ordering hazards, resource cleanup, injection and path-traversal surfaces, secret material in code or logs or evidence, dependency and licence changes, blast radius (what else calls this), and whether the tests assert the requirement rather than the implementation.
- **Explorer (Missed context)** - what else the change touches: callers, importers, generated artifacts, fixtures, migrations, config keys, docs and their bilingual pairs, package READMEs and the repository manual; conventions the change silently broke; and where the evidence for each claim physically lives.

### Waiting, silence and respawn

Wait for completions in bounded cycles, and preserve each lane's result immediately as it arrives - never lose a PASS/FAIL because another lane is slow. Do not treat a timeout, an ack-only reply or an empty child result as a PASS. If a lane stays silent past its bound, send ONE followup, then record the lane INCONCLUSIVE and respawn a smaller reviewer for that exact lane and that exact question. If it is still unfinished after that retry, close the still-running member if that is safe, keep the lane INCONCLUSIVE, and emit the final report with the incomplete lane named in the merge table. Do not spin in repeated wait/followup cycles, and do not use `send_message` as an interrupt: queued followups are not cancellation.

After every lane has reached a terminal state and before delivering the verdict, tear down the review worktree: `git worktree unlock <path>` followed by `git worktree remove <path>`. The lanes run inside that worktree, so removing it earlier destroys their working directory; a crashed review leaves the locked tree as a recoverable marker for manual cleanup.

---

## Phase 3: Deliver the verdict

```text
every lane PASS                             -> REVIEW PASSED
any lane FAIL                               -> REVIEW FAILED - criteria not met
no FAIL and at least one lane INCONCLUSIVE  -> REVIEW INCONCLUSIVE - not approved
```

State whether the verdict is BOUND or ADVISORY: a bound seat's FAIL is blocking by the verification law, while an advisory panel's FAIL is the orchestrator's to weigh. Never report one as the other.

Compile the final report in this format — the merge table is the ONE table declared above, filled in here and not re-declared:

```markdown
# Review Work - Final Report

## Overall Verdict: PASSED / FAILED / INCONCLUSIVE (bound | advisory)

[THE MERGE TABLE - one row per lane, every cell carrying its evidence pointer: the exact commands and
the artifact the lane read. There is no second table: a lane that reported nothing is a row saying
INCONCLUSIVE with the reason, never a missing row.]

## Blocking Issues
[Failing QA rows first, then the lanes' blockers - deduplicated, in fix order, each with its pointer]

## Key Findings
[Top findings across the lanes, grouped by theme]

## Not Proven
[Every claim no lane could settle, with the reason - a panel that hides its bounds is worth less than its table]

## Recommendations
[If FAILED: exactly what to fix, in priority order, and which lane re-runs after the fix]
[If PASSED: non-blocking notes worth considering]
```

If FAILED - be specific. The user should know exactly what to fix and in what order: the problem, the file or artifact, and the fix. No vague "consider improving X".

If PASSED - keep it short. Highlight the non-blocking notes worth considering, but don't turn a passing review into a lecture.
