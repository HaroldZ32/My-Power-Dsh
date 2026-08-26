# B-line Report (Plan B completed)

Implementation of the plan backlog (B1-B4) as self-written DSH plugins. All verified with real
headless runs in isolated DSH_HOME (see evidence/dsh-qa/bline/).

| Plugin | Capability | QA result |
|---|---|---|
| omo-tools-plugin (B1) | write-existing-file guard (same-content rewrite passes), tool-output truncation (post-execute, 8 KiB budget), edit-error recovery guidance | PASS — guard denied an overwrite with the exact message; model did not bypass |
| omo-modelchain-plugin (B4a) | upstream-style fallback chains resolved DeepSeek-first (sisyphus/oracle/atlas/prometheus/librarian/explore/hephaestus) via mpd_modelchain_resolve | PASS — oracle -> deepseek-official/deepseek-v4-pro (2-entry chain) |
| (B4b memory) | workspace-scoped memory save/recall (.mpd/memory.json) | PASS — alpha=beta round-trip |
| omo-ulw-plugin (B3) | ulw-loop discipline on the subagent seam: fresh child per round, plan->execute->verify, bounded structured handoff, state persisted | PASS — 1 round complete; hello.txt verified via cat/wc/od; state file recorded |
| omo-team-plugin (B2) | parallel role team (2-4 members, role persona + per-role model route, mailbox state file, convergence report, status tool) | PASS — librarian+oracle paralled, both completed with structured mailbox |

## Integration

- Bundle patch: 4 insert rows (absolute dist paths here; npm packaging would use @mpd-dsh/<pkg>).
- Installer: buildPlan now includes the 4 rows (dry-run shows 8 omo-* plugin lines total).

## Deferred (honest scope notes)

- B2 deep items: mailbox polling/notification between live members (current: one-shot parallel + mailbox file),
  tmux visualization, tasklist/worktree snapshots — follow-up when the MVP is used in anger.
- B4 deeper: git-backed memory (memory-core port), boulder state machine — deferred until the plain
  JSON memory proves insufficient.
- hashline, codegraph auto-init command UX, LSP language-server provisioning — still environment-setup items.
