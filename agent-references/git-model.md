# Git model, the board, and who may write — the long form of `AGENTS.md` §5 rule 5

Moved here on 2026-11-02 by the W4-A5 instruction-budget split (§3 MOVE-FIRST). The rule itself, with
its number and every binding sentence, STAYS in `AGENTS.md` §5 — this file carries the measurement
history and the boundary detail behind it, so a reader who needs "why is it prose?" or "where exactly
does the closure stop?" stops paying for it in every session.

## 1. Why "one git writer per working tree" is prose, not a matcher

Teammates share the captain's checkout, so two writers race on the single `.git/HEAD`. Measured
2026-09-14: a member's `reset HEAD~1` landed on `dev` and moved the tip back one commit; the reflog
held every step and recovery still cost a forensics pass.

The mechanical denial of git write commands for member sessions lived in the `installVerifyGuard`
hook, which was WITHDRAWN on 2026-10-17. Its command list — `commit`, `add`, `rm`, `mv`, `checkout`,
`switch`, `restore`, `reset`, `stash`, `merge`, `branch`, `rebase`, `tag`, `cherry-pick`, `revert`,
`clean`, `apply`, `am`, `update-index`, `worktree`, `init`, `clone` — is recorded here as the RULE,
not as a matcher that still runs. The rule is unchanged and binding:

- the captain commits and branches; a member edits files, runs gates and writes evidence;
- the captain may serialize ONE delegated writer, freezing everyone else first;
- read-only `status`/`log`/`diff`/`show`/`grep` stay open to all;
- tag `backup/<branch>-<sha>` before any history-writing step.

Its actual enforcement is the dispatch contract (who is told to do what) plus review, not a hook.

## 2. Who counts as a child session

A session is a CHILD only when the harness RECORDED a subagent origin (`origin: "subagent"`) or a
delegation depth ≥ 1. The user's own session — `parentSession` + `isSeeded`, delegation depth `0`, no
`origin: "subagent"` — is the CAPTAIN. The predicate that classifies this is `sessionIsTopLevel` in
`complexity-gate.ts`; the git-write rule is a CONTRACT keyed on that classification, never on a preset
name (the preset-keyed variant that made the captain branch unreachable is `T-92` in
`troubleshooting.md`).

## 3. Where the tool-boundary closure stops

The team-door guard (2026-10-23) REFUSES the five official Agent Teams authoring verbs:
`spawn_teammate`, `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`.
`send_message`, `list_agents`, `wait_agent` and `interrupt_agent` stay available for agent
communication — they are also base global harness rows this preset mounts, and the harness tells every
continuable child to call `send_message`.

So the mpd RECORD is the only board a session can create a task on, and every §5 rule runs on every
task a session can create.

THE BOUND, stated rather than implied: the closure stops at the TOOL boundary. A ROW that calls the
team SERVICE directly (the official-executor fallback path) is not a tool call and is NOT gated. The
no-preset-bypass divergence is documented in `packages/mpd-team-core-plugin/README.md`.

## 4. Terminal verbs and the declared owner

The board's own half of §5 rule 5, in more words than the manual keeps:

- `agent_teams_task` carries `complete` and `fail`, both OWNER-ONLY, with an optional `note` and an
  optional `expected_revision` compare-and-set. A FAIL releases its dependents (OPT-1).
- `claim` REFUSES a task whose declared blockers are not satisfied — the SAME readiness predicate the
  dispatch pass uses — while `complete`/`fail`/`release` stay open, so a stranded row is always
  closable.
- `agent_teams_dispatch` pairs a ready task with its DECLARED owner when that member is free. It falls
  back to roster order ONLY when it reports the reason it did so. Owner-only is the DEFAULT since the
  autoproject wave; the positional/roster rule is reachable only under an explicit `mode:"roster"`.
