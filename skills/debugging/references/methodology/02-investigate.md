# Phase 2 + 3 — Hypothesis Formation & Parallel Investigation

One hypothesis is a hunch. Three hypotheses is a decision. Investigation is how you turn the decision into runtime evidence.

---

## Phase 2 — Hypothesis Formation (Minimum Three)

### Why three, not one

A single hypothesis creates confirmation bias: you'll read runtime state looking for evidence that confirms it and unconsciously discount contradictions. Three hypotheses force you to design queries that *distinguish* between them, which is the only way runtime evidence becomes decisive.

### Generate across orthogonal axes

If your three hypotheses are all variations of "the handler has a bug", you don't actually have three hypotheses. Span the space:

| Axis | Example framing |
|---|---|
| **User-code logic** | "The handler early-returns because condition X is unexpectedly true" |
| **Library/SDK behavior** | "The third-party client swallows the error and returns a stub" |
| **Environment/config** | "The env var is read at module-load time before it gets populated, so it's empty" |
| **Async/timing** | "The promise rejects (or goroutine panics) after the response is already sent" |
| **Silent side-effect** | "An earlier turn mutated shared state that the current turn inherits" |
| **Observability gap** | "The error is raised but suppressed before logging; it only exists as an unawaited rejection / ignored signal" |
| **Binary-level** (when applicable) | "The function we think is running is actually jumped over by a patched thunk / a different version loaded" |
| **Build-vs-runtime** | "The code we're reading is not the code that's running — stale build, wrong symlink, cached wheel, or dist/ ahead of src/" |

### For each hypothesis, write in the journal

1. **Claim** — one sentence.
2. **Distinguishing evidence** — the exact value or state that confirms or refutes it, AND where to read it (file:line, log source, breakpoint location, memory address).
3. **If true, the fix is** — two words. Forces you to think through fix cost before committing to the hunt.

### Collapse rule

If two hypotheses have identical distinguishing evidence, they aren't actually different — collapse them and find a real alternative. If you can't come up with a third distinct hypothesis, you don't understand the system well enough yet. Go read a little more code before investigating.

---

## Phase 3 — Parallel Investigation

### State freshness invariant

**A debug session's state is a snapshot with a lifetime, not a fact you can carry forward indefinitely.**
- Before any action that mutates the debuggee, re-observe the session's current state.
- This includes continue, step, side-effecting evaluation, setting or removing breakpoints, and termination.
- Record the current thread state and stop reason; those are the concrete tells for whether the old plan still applies.
- An observation from an earlier turn may already be stale when the next action is issued.
- Turns can be minutes apart while the debuggee runs at full speed, so this failure mode is normal, not exceptional.
- If the thread state or stop reason has moved, re-observe the new state and do not replay the old plan.
- Treat every mutation as conditional on the state you just observed, not on a remembered stop.

### Failure-to-recovery taxonomy

| Failure signature | Most likely cause | Next move |
|---|---|---|
| Adapter or debugger process failed to start | Wrong binary or missing installation | Verify the tool exists, then re-launch; do not retry blindly. |
| Breakpoint accepted but never bound or verified | Source path mismatch, optimized-out code, or missing debug symbols | Check the binary was built with symbols and that the debugger-resolved path matches your file. |
| Attach refused | Permissions, ptrace scope, SIP, or wrong PID | Fix the environment or target identity; a retry will not change it. |
| No stop event within the expected window | Process is running, the breakpoint is unreachable, or the wait was too short | Pause and inspect threads rather than waiting longer. |
| Session terminated unexpectedly | The debuggee crashed or exited | Capture the exit and crash evidence before restarting. |

Branch depending on what's available.

### Path A: Team mode ENABLED

When `agent_teams_plan` is present, stage a **debug-squad** team and split investigation across members working on different evidence sources. This is the right default whenever you have ≥3 hypotheses and any of them would take >10 minutes to investigate single-threaded.

**Team spec** — staged through `agent_teams_plan`, never written to a file: the plan writes the team RECORD (`.mpd/team/teams/<id>.json`), and that record is the only board.

```text
agent_teams_plan { action: "create", name: "debug-squad", description: "<the bug, one line>" }
agent_teams_plan { action: "add_member", member: { name, description, prompt } }       # once per role below
agent_teams_plan { action: "create_task", task: { subject, description, blocked_by } } # once per hypothesis / experiment
agent_teams_plan { action: "approve" }                                                 # spawns the members, posts the tasks
```

The four members — each `description` STARTS with the roster role (the name must be the whole head before a separator); a member staged with an explicit `role` is matched on `role` first, otherwise on that description head. The bullet text is the `prompt`:

- **Runtime State Inspector** (`description`: `"Deep Worker - runtime state inspection"`) — attach to the live process, hit breakpoints, read program state (variables, heap, goroutines, stack, registers depending on runtime), and report observed values verbatim. Never guess: if you don't see the value, say so. Report with `send_message(agent_id=<lead>)` plus file:line / address references and captured values — there is no broadcast recipient. Never edit source code. Never run git commands. If you need an instrumentation statement added (`breakpoint()`, `debugger;`, `dbg!`, etc.), ask the Lead first.
- **Log Archaeologist** (`description`: `"Explorer - log archaeology"`) — grep server logs, stderr streams, SDK-internal debug output (`DEBUG`, `RUST_LOG`, `GODEBUG`, `PYTHONASYNCIODEBUG`), and correlate timestamps. Produce a timeline of events with latencies. Flag anything that looks like a silent catch, a swallowed rejection, a panic recovered-and-ignored, a success response that contains failure signals (HTTP 200 with empty body, `stopReason=error`, exit 0 with error-in-stdout). Never edit source code.
- **Reproduction Engineer** (`description`: `"Junior Engineer - reproduction engineering"`) — build the smallest reliable repro: a curl command, a vitest/pytest/go test, a tmux script, a Playwright script for browser bugs, a pwntools script for binary targets. It must reproduce on first try and be copy-pasteable by the Lead. Document exact input, expected output, observed output. Save repro artifacts under `/tmp/` and tell the Lead to journal them. If the bug is browser-based you MUST use Playwright CLI — do not simulate with curl.
- **Trace Correlator** (`description`: `"Architect - trace correlation"`) — take findings from the other members and cross-link them. Build a causal chain from symptom to suspected cause. Identify missing evidence. Propose the next single most-decisive runtime query. Never edit source code; only reason across already-captured evidence. If hypotheses diverge sharply after correlation, tell the Lead immediately — that is the signal for the Oracle Triple.

**Assignment rule**: one hypothesis → one `agent_teams_plan {action:"create_task"}`. Answer the dependency question on every task: `blocked_by: [...]` (an empty list is a genuine root), or `independent: true` when the hypotheses are independent. Give each hypothesis to the member whose evidence source is most likely to confirm or refute it, then pair work with `agent_teams_dispatch {action:"run"}` or an explicit `agent_teams_task {task_id, action:"claim"}`. Put the full hypothesis list in each task description instead of broadcasting it: `send_message` takes ONE named recipient (`agent_id=…`), and there is no `*` recipient.

**Lead responsibilities**:
- Maintain the journal (members do not write to it).
- Approve any source-code edits (including `debugger;` / `breakpoint()` / `dbg!` statements).
- Synthesize member reports into updated hypothesis statuses.
- Drive the board: `agent_teams_task {task_id, action:"claim" | "complete" | "fail"}` — `complete`/`fail` are owner-only, and a `fail` releases its dependents.
- Decide when to close: `agent_teams_task {task_id, action:"complete" | "fail"}` on every task, then `mpd_team_compact_run`. Every task then holds a terminal status, the team is finished and its members are compacted together. There is no end-team verb — the retired `team_*` family (`team_send_message`, `team_shutdown_request`, `team_approve_shutdown`, `team_delete`) spells nothing on this plane.

**Team does NOT include Oracle** — the squad has no Oracle member; Oracle is used separately in Phase 4 (see `04-oracle-triple.md`).

### Path B: Team mode DISABLED

Issue SERIAL one-shot consults instead. Same rule: one hypothesis per consult — `role="Explorer"` for a runtime-state or log/timing investigation, `role="Deep Worker"` for a reproduction minimizer. Each call returns its report as the tool result, so there is no background burst and no completion notification; synthesize as each returns. The harness's generic spawn tools are REFUSED in an mpd session (`delegation.gate:"deny"`).

```
mpd_role_spawn(role="Explorer",
     context="[bug summary + which hypothesis you own + what state to look at]",
     task="TASK: runtime state investigation for hypothesis 1: ... DELIVERABLE: ... SCOPE: ... VERIFY: ...")
mpd_role_spawn(role="Explorer",
     task="TASK: log/timing investigation for hypothesis 2: ... DELIVERABLE: ... SCOPE: ... VERIFY: ...")
mpd_role_spawn(role="Deep Worker",
     task="TASK: reproduction minimizer for hypothesis 3: ... DELIVERABLE: ... SCOPE: ... VERIFY: ...")
```

Synthesize once every consult has returned.

---

## Evidence capture discipline (both paths)

For every piece of runtime state captured, record in the journal:

```markdown
### <ISO timestamp> — <what you looked at>
- Source: <file:line | log source | curl command | breakpoint address>
- Value: `<verbatim>`
- Interpretation: <one line — why this matters>
- Refutes/Confirms: H<n>
```

**Verbatim values only. No paraphrasing.**

- `messages.length=0` is evidence.
- "messages seemed empty" is not evidence — it's a memory of an observation, and memory of observations is where debug sessions go to die.

If you find yourself about to paraphrase, stop, go back, and copy the raw value.

---

## Round completion

A "round" is complete when every hypothesis has either confirming or refuting evidence — or when you have exhausted the evidence sources available without a decisive result. If the round ends inconclusively, that counts as a failed round for the counter in the journal. See `04-oracle-triple.md` for what to do at 2 consecutive failed rounds.
