# Evidence — t2: the six platform frictions documented in the on-demand reference

Seat: **Lead** (worker; orchestration / integration) · Task: **t2** · Attempt 1
(`c7824903-fc06-4f69-97ed-26388eeb3eea`) · Wave: **w1** of team `mpd-process-hardening` ·
Date: 2026-09-19 (UTC).

## What changed

| Artifact | State |
|---|---|
| `agent-references/troubleshooting.md` | MODIFIED — a new section appended at the END of the file. The 75 pre-existing lines are byte-identical to `HEAD`: `git diff --stat` reads `1 file changed, 27 insertions(+)` and the single hunk header is `@@ -75,0 +76,27 @@` — no existing entry was reworded or reordered. |
| `evidence/process-fixes/troubleshooting-rows.md` | this record (written under the task's `inScope`). |

## Measured revision, with its measurement moment

- `sha256(agent-references/troubleshooting.md) = af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0`
  — measured **2026-09-19T11:27:37Z** (UTC), after the LAST content edit; the gate below was run on
  these same bytes.
- This record cannot carry its own final hash (writing it would move it); the reader re-samples it.

## Contract verify command (in contract order)

`bun run verify:docs` → **exit 0**:

```
[verify-docs-parity] root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS
```

Stated honestly: the gate does **not** discover `agent-references/**` (T-28 — that tree is
agent-facing, English-only, outside the bilingual band), so this is a **no-regression check, not a
coverage claim** about the new section. The section's own evidence is the literal provenance below.

## Literal provenance — every quoted string re-verified against the tree, mechanically

Each row's literal was read out of the shipped source and re-checked with a fixed-string search
(grep -F) or a programmatic extraction **after** the section was written (not from memory):

| # | Friction (literal, shortened) | Source of the shipped string | How verified |
|---|---|---|---|
| 1 | `… completion requires passed acceptanceResults for every acceptance item … (matched N of M)` | `lib/quality-gates.js` — `evaluateQualityCompletion` + `coverageGapText` | grep -F on both refusal templates; instantiated examples quoted from `evidence/agent-teams/wave2b-laneA/20260917T145437Z/repair-arms-after.out.txt` (lines 1 and 6) and `evidence/review/wave2b-laneA/round2-probes.out.txt` |
| 2 | `repair tasks require sourceTaskId and at least one sourceFindingId` | `lib/quality-gates.js` — `validateCreateTask` | grep -F OK (also `review tasks require reviewedTaskId`, `source task "…" does not exist`) |
| 3 | `repair must not depend on failed task "t13"` | `lib/quality-gates.js` — `validateCreateTask` dependency loop (template `${kind} must not depend on ${upstream.status} task "${dependency}"`), with the auto-wire in region `mpd-delta repair-source-open-edge` | grep -F OK; the instantiated `… t13` form is the measured capture in `.mpd/team/archive/friction-p2-wave/inbox/archive/agent-teams-engineer.9999999999999.jsonl` |
| 4 | `task tN is owned by member "<name>"; call agent_teams_reassign_task with assignee="captain" before takeover` | `lib/tools.js` — the `agent_teams_update_task` captain branch (registry region `mpd-delta update-task-amend-owned-task`); the turn-scoped rule is the `agent_teams_reassign_task` description; the dependency variant is in `agent_teams_reassign_task`'s execute path | grep -F OK on all three fragments; the older capture (shorter tool name) is `.mpd/team/archive/friction-p1-wave/inbox/agent-teams-engineer.jsonl` |
| 5 | `amend` accepts `subject, description, dependencies, acceptance, inScope, outOfScope, verify` and nothing else | `lib/tools.js` — the `agent_teams_update_task` parameter block; honored by `amendChangesDefinition` | **programmatic extraction** of the `amend:` block: keys `["subject","description","dependencies","acceptance","inScope","outOfScope","verify"]`, `additionalProperties: false` present, `objective` and `kind` ABSENT |
| 6 | `Append-or-create (never truncates); a seat whose write/edit/bash are denied may only use evidence/**.` | `lib/tools.js` — the `artifact` parameter description; the write is `writeTaskArtifact` (`writeFileSync(resolved, existing ? \`${prior}\n${text}\` : text)`) | grep -F OK; the two-document consequence re-measured by parsing `evidence/docs-overhaul/verify-design.json` with `JSONDecoder.raw_decode`: 2 documents at char offsets 0…19211 and 19213…30487, and whole-file parse fails `Extra data: line 103 column 1 (char 19213)` |
| 7 | `task status cannot move from "completed" to "claimed"` / `task tN became completed before its assignment could be delivered` | `lib/state.js` — `transitionError` (used by the claim path) and `lib/tools.js` claim transition; `lib/scheduler.js` — `deliveryRoutingClass` + region `mpd-delta terminal-dispatch-recheck` | grep -F OK on both templates and on the routing-class decline fragment; the "six in one wave" counts are quoted from `.mpd/team/archive/friction-p2-wave/inbox/captain.jsonl` and `evidence/docs-overhaul/SUMMARY.md` |

Every artifact path cited in the section was existence-checked with `test -e` (9/9 present, all
under `evidence/`, `.mpd/team/archive/` or `.mpd/memory/`). Per T-90 the anchor cited is the
**artifact path**, never a mailbox id; the two `.jsonl` citations are read-while-present archive
records and are labelled as such in the row text.

## Deliberately recorded deviations (so a reviewer does not have to guess)

1. **The amend key list.** The task's acceptance enumerates "description/acceptance/inScope/
   outOfScope/verify/dependencies" (six keys). The shipped `amend` schema declares **seven** — it
   also declares `subject` (extracted programmatically, above). The section states the tree's list
   and says the parameter block is the authority; the acceptance's substantive clause ("a stale
   `objective` or `kind` CANNOT be amended") holds exactly (`objective`/`kind` are absent from the
   closed schema).
2. **"Platform" is named precisely.** The frictions are behaviour of the ADOPTED `agent-teams`
   plugin, which is first-class IN-REPO main code (`packages/mpd-agent-teams-plugin/lib/**`), plus
   the DSH harness's own surfaces. The section's scope paragraph says so and states plainly that
   none of the six is fixed by this wave and no script change accompanies them. One row (the
   re-dispatch race) names the partial in-tree guard (`deliveryRoutingClass`, region
   `mpd-delta terminal-dispatch-recheck`) while giving the seat response as the operative remedy.
3. **The `work` kind is exempt from the acceptance/commands coverage gate** (`quality-gates.js`
   returns ok early for `work`), which is why friction (1) is described as a refusal of the QUALITY
   kinds; the section says which kinds are judged rather than implying every completion.

## What this record does NOT claim

- No plugin code, no script and no gate was changed to "fix" any of the six — the deliverables are
  the reference section and this record only.
- `bun run verify:docs` is not evidence that the new rows are correct; the literal provenance table
  above is.
- No boot/`--dump-config` claim is made: nothing here changes a row, a preset or a plugin, so no
  mounting boot is owed (§4's rule binds behaviour claims, and none is made).

## Quoted: the section added to `agent-references/troubleshooting.md` (verbatim, new lines 76–102)

<!-- BEGIN QUOTED SECTION -->

## Platform frictions measured in the process-hardening wave (2026-09-19)

Six platform frictions cost this workspace turns while the documentation wave ran and none of them
was written down. They follow in the SAME symptom → cause/fix shape as the table above, so a seat
that hits one of these exact messages finds its response here before spending a turn rediscovering
it.

**Scope — what this section is and is not.** Every entry below is behaviour of the ADOPTED
`agent-teams` plugin (first-class in-repo main code at `packages/mpd-agent-teams-plugin/lib/**`,
upstream plus the `mpd-delta` regions) or of the DSH harness's own contract surface. **NONE of the
six is a defect this wave fixes, and no script change accompanies this section**: four are
deliberate REFUSALS whose correct response is a seat discipline, the re-dispatch race is a platform
delivery window with only a partial in-tree guard, and the artifact channel's append semantics are
deliberate never-destroy-a-byte design. Literal strings are quoted byte-for-byte from the shipped
source named in each row (never from memory); a measured first-party instance is cited by its
artifact PATH — an artifact path is the anchor, a mailbox id is not (T-90).

| Symptom | Cause / fix |
|---|---|
| a completion that looks finished is refused: `implementation completion requires passed acceptanceResults for every acceptance item — no entry for <criterion>; nearest provided: "<what the payload actually said>" (matched 0 of N)` (likewise `verification completion requires a passed commandsRun entry for every verify command — no entry for <command> …`) | the quality gate (`packages/mpd-agent-teams-plugin/lib/quality-gates.js`, `evaluateQualityCompletion` + `coverageGapText`) matches each contract `acceptance[]` item to an `acceptanceResults[].criterion` entry BY NAME — exact first, then a fallback that still requires a one-for-one NAME match, so a right-count/wrong-name payload is refused (the count-only reading was withdrawn under the captain's NAME ruling, T-29/T-87). `matched 0 of N` means NO provided criterion equals ANY contract criterion, and `absent` (not present at all) is distinguished from `unpaid` (present, not `passed`). **Fix: read the contract with `agent_teams_task_contract` and copy every `acceptance` item VERBATIM — never paraphrase, abbreviate or split one — and copy from the STRUCTURED view, because the rendered `Acceptance:` line joins the items with `, `.** Only the quality kinds are judged (`implementation`/`repair`/`verification`/`integration`; a plain `work` kind returns ok early), and one `failed` `commandsRun` entry fails any completion on its own (`verify failure must fail the task`). Measured instances, verbatim: `implementation completion requires passed acceptanceResults for every acceptance item — no entry for item-9; nearest provided: "item-9-UNDER-A-DIFFERENT-NAME" (matched 8 of 9)` and `verification completion requires a passed commandsRun entry for every verify command — no entry for bun run x; nearest provided: "SOME OTHER COMMAND" (matched 0 of 1)` (`evidence/agent-teams/wave2b-laneA/20260917T145437Z/repair-arms-after.out.txt`; the same probes with their assertions in `evidence/review/wave2b-laneA/round2-probes.out.txt`). |
| task creation is refused: `repair tasks require sourceTaskId and at least one sourceFindingId` | a `kind=repair` task is FINDING-DRIVEN, and `validateCreateTask` (`lib/quality-gates.js`) refuses one that cites neither a source task nor explicit finding ids. Pass BOTH: `sourceTaskId` = the task the finding came from, `sourceFindingIds: ["F1", …]` = the finding ids that task's review carries (`agent_teams_task_contract` shows the source's `source_finding_ids`/`findings`). The sibling string for a review is `review tasks require reviewedTaskId`, and a non-existent source answers `source task "tN" does not exist`. Neither field is amendable later (see the amend row below), so get them right at creation. |
| task creation is refused: `repair must not depend on failed task "t13"` | `validateCreateTask` refuses a repair whose (declared or AUTO-WIRED) dependency has status `failed` or `cancelled` — only `completed`/`cancelled` satisfy a dependency, so a repair hanging off a failed task could never dispatch (the family rule is the "task is stuck behind a dependency that FAILED" row above). The auto-wire is the trap: a repair naming a `sourceTaskId` acquires the edge `repair → source` for every NON-OPEN source (`mpd-delta repair-source-open-edge`), so a FAILED source becomes a refused dependency the moment it is cited. **Fix: when a verification fails, file the correction as `kind=work` against the upstream WORK task (no `sourceTaskId`, so no auto-wired edge), or cite a source that is `completed` or still open — and re-verify with a NEW verification task that depends on the repair, never by re-opening or depending on the failed verification.** Measured instance: `repair must not depend on failed task t13` (`.mpd/team/archive/friction-p2-wave/inbox/archive/agent-teams-engineer.9999999999999.jsonl`). |
| a captain write is refused with `task tN is owned by member "<name>"; call agent_teams_reassign_task with assignee="captain" before takeover`, or a takeover the captain started is no longer his by the next turn | a captain takeover is a TURN-scoped capability, not a durable lane. `agent_teams_reassign_task`'s own description states the rule: `Use assignee="captain" only when you will finish that task in this turn; a captain can own only one unfinished takeover at a time, and an unfinished takeover returns to the member pool when the captain becomes idle.` **Fix: take over ONE task, drive it to a terminal status IN THE SAME TURN, and end the turn with no captain-owned work open** — if the turn ends first, the member pool owns the task again and the next write hits the ownership refusal above, so RE-TAKE it (a fresh attempt id) instead of arguing with the message. A takeover is likewise refused while the task's own dependencies are unfinished: `task t43 is blocked by unfinished dependencies: t39, t42 — complete them before captain takeover` (the shipped wording lives in `agent_teams_reassign_task`'s execute path, `lib/tools.js`; the measured capture is `.mpd/memory/agents/agent-my-power-dsh/repo/memory/agentteams-routing-limits-measured-dependency-bl-mu4xd1sw.md`). Measured first-party capture, written under an earlier revision of the string: `task t9 is owned by member agent-teams-engineer; call reassign_task with assignee=captain before takeover` (`.mpd/team/archive/friction-p1-wave/inbox/agent-teams-engineer.jsonl`) — trust the shipped source, not the older capture. |
| a contract's stale `objective` / `kind` cannot be corrected: `amend` accepts a key list that does not contain them | `agent_teams_update_task`'s `amend` is a CLOSED object (`additionalProperties: false`) whose declared properties are exactly `subject`, `description`, `dependencies`, `acceptance`, `inScope`, `outOfScope`, `verify` (`packages/mpd-agent-teams-plugin/lib/tools.js`, the update-task parameter block; honored by `amendChangesDefinition`). `objective` and `kind` are NOT declared by it, and no other surface edits them, so **a drifted objective is corrected by re-stating the intent in `acceptance` (and/or `description`) and RECORDING the objective's staleness in the completion output — never by pretending the objective still matches.** Two more literals of the same surface: a member may amend only at claim time — `task tN is in_progress: a member may amend a contract ONLY at claim time (status "claimed"); ask the captain to amend it otherwise` — and an amend is DEFINITION-only, so it is admitted on a member-owned task while every other captain write there still answers the ownership refusal of the row above. (The plan that produced this section listed six amendable keys; the shipped schema also declares `subject` — the parameter block is the authority.) |
| a second verdict attached to the SAME artifact path yields two documents in one file, and a JSON artifact then fails to parse (`Unexpected non-whitespace character after JSON` / `Extra data: line N column 1 (char X)`) | the task-artifact channel is APPEND-OR-CREATE by design and never truncates: `writeTaskArtifact` (`lib/tools.js`) writes ``writeFileSync(resolved, existing ? `${prior}\n${text}` : text)``, and the tool description says it plainly — `Append-or-create (never truncates); a seat whose write/edit/bash are denied may only use evidence/**.`. **Fix: write a RE-VERDICT (round 2, an amended contract, a corrected payload) to a NEW file and attach that with its own `artifact` call — never append a second document to the first verdict's path.** Measured in this workspace: `evidence/docs-overhaul/verify-design.json` is 30,686 B holding TWO concatenated JSON documents (the first ends at char 19211, the second starts at 19213 after the inserted newline), so parsing the file as ONE document fails while each document parses alone; the append is recorded on the team (`path` with `bytes: 11275`, `total_bytes: 30488`, `by: Explorer`) in `.mpd/team/archive/mpd-default-c1a3fcab/team.json`. The same append semantics govern `output_append` (the terminal-output repair channel) — appending there is safe ONLY because the stored output is a text summary, never a machine-parsed document. |
| a seat is woken for a task that is ALREADY TERMINAL: the claim answers `task status cannot move from "completed" to "claimed"`, or the pre-wake guard declines with `task tN became completed before its assignment could be delivered` | PLATFORM behaviour: a delivery is composed under the team lock and DELIVERED after that lock is released, so a task finished inside the window is still offered; the shipped tree already classifies the offer (`deliveryRoutingClass` in `packages/mpd-agent-teams-plugin/lib/scheduler.js`, region `mpd-delta terminal-dispatch-recheck`) and names it in the decline — `… (routing class reoffer-terminal-same-attempt: the delivery carries the attempt id the task's own completion recorded — a RE-OFFER of finished work, not a reassignment)`. The class REPEATED across waves and was measured as a count twice over: `six offers to terminal tasks: t1, t2, t3, t4, t6, t22 — each refused by terminal immutability, one turn burned each` (`.mpd/team/archive/friction-p2-wave/inbox/captain.jsonl`) and `six automatic re-dispatches of already-terminal tasks (t13 ×2, t3, t15 ×2, t16)` (`evidence/docs-overhaul/SUMMARY.md`, "Process notes worth carrying"). **The SEAT RESPONSE is the discipline, not a workaround: refuse the claim, re-read the contract with `agent_teams_task_contract`, verify the acceptance on disk, and NEVER redo or re-file a terminal result — "a terminal payload is the answer".** Terminal work is immutable (`terminal task tN is immutable; use agent_teams_reassign_task to retry failed/cancelled work`); the ONE sanctioned revive is a deliberate captain `agent_teams_reassign_task`, which mints a FRESH attempt id — never a seat reacting to a wake. |

<!-- END QUOTED SECTION -->
