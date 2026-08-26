# Feature Audit — OMO spec vs my-power-dsh

Audit date: 2026-08-26. Baseline: oh-my-openagent 8c57e46 (v5.0.0-beta.20) capability surface.
Legend: ✅ full / 🟡 partial / ❌ missing / ➖ not applicable (host-specific legacy).

| Area | OMO spec | Status | Where / note |
|---|---|---|---|
| Agent roster (11) | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-presets-plugin: all 11 mpd-* presets with DeepSeek-adapted personas |
| Team mode | 11-agent orchestration, mailbox, tasklist, state, worktree, tmux | ✅ | dsh-agent-teams v0.1.13 adopted (MIT): durable continuable members, per-member mailbox + wake, dependency-aware scheduler, task DAG Web panel, archive (stateDir .mpd/team; evidence/plan-c/c1-team). mpd_team_spawn/status remain as lightweight one-shot mode |
| ultrawork / ulw loop | plan->execute->verify discipline, modes, hashline edits | 🟡 | mpd_ulw: fresh child per round, bounded structured handoff, state file, verification evidence. Deferred: hashline edit mode, hyperplan gate, wave-specific verifiers |
| /goal & goal rounds | omo /goal with durable state | ✅ | DSH native goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | fresh-agent iteration | ✅ | DSH native tool-ralph |
| plan mode | planning-only mode | ✅ | DSH native plan-mode |
| delegate / multi-model | delegate-task with fallback chains | 🟡 | subagent tools + mpd_modelchain_resolve (11 roles, 2-3 entry DeepSeek chains). Richer variant/effort mapping from upstream model-core not ported |
| background agents | parallel background tasks | ✅ | DSH jobs + tool-jobs |
| Skills corpus | 17 top-level skills | ✅ | all 17 vendored (mpd-skills-plugin/skills) |
| Rules / AGENTS.md | nested rule discovery & injection | ✅ | DSH agent-instructions (baseline + nested + change tracking) |
| Built-in MCPs (5) | git_bash, lsp, codegraph, context7, grep_app | ✅ | git_bash (win-gated), lsp (8 tools), codegraph (plugin+init), context7, grep_app (remote rows) + ast_grep extra |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH native commands + mpd-codegraph command; omo modes delivered as tools (mpd_ulw/mpd_team_*) |
| hashline hash-edits | hash-preserving edit discipline | ❌ | deferred (DSH edit/str_replace_editor cover editing; hashline is a diff-discipline extension) |
| comment-checker | post-edit comment checks | ❌ | deferred (upstream native-dep hook; candidate for MCP wrapper later) |
| monitor / toast / TUI sidebar | session monitor + UI | ➖ | replaced by DSH session telemetry (otel), token-meter, web GUI |
| Telemetry | posthog DAU | ✅ | DSH session-telemetry-otel replaces it (no posthog) |
| Memory engine | git-backed MemFS + reflection | 🟡 | mpd_memory_save/recall (workspace .mpd/memory.json). Deferred: git versioning + reflection state machine |
| Boulder state | durable work state machine | ❌ | deferred (simple .mpd JSON state used by ulw/team today) |
| Config (omo.json) | layered config schema | 🟡 | bundle patch + install-profile replace it (no omo.json layer yet) |
| LSP tooling | diagnostics/goto/refs/rename/symbols | ✅ | mcp__lsp__* (8 tools via offline-built daemon) |
| Multimodal | image analysis model routing | 🟡 | vision route declared (deepseek-v4-flash-vision-exp) + mpd-multimodal-looker preset; no image pipeline test yet |
| Model guardrails | capability heuristics/aliases | 🟡 | chains in mpd_modelchain_resolve; upstream model-core depth not ported |
| Host-specific legacy | claude-code compat loaders, opengateway, mcp-oauth, opencode runtime | ➖ | intentionally out of scope for a DSH bundle |

## Gap closure (this round)

- agent roster 7/11 -> 11/11 presets;
- skills 7/17 -> 17/17 vendored;
- remote MCP rows context7 + grep_app added (network required);
- modelchain chains extended to all 11 roles with 2-3 entry DeepSeek-first fallbacks.

## Remaining gaps (explicitly deferred; tracked in docs/decisions.md)

hashline, comment-checker, boulder state machine, deep team-mode mailbox/tmux, memory git-backing,
model-core guardrail depth. Each is a candidate for a subsequent fix/* iteration.
