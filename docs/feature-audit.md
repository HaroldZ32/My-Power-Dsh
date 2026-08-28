# Feature Audit — upstream spec vs my-power-dsh

Audit date: 2026-08-26. Baseline: the upstream project 8c57e46 (v5.0.0-beta.20) capability surface.
Legend: ✅ full / 🟡 partial / ❌ missing / ➖ not applicable (host-specific legacy).

| Area | upstream spec | Status | Where / note |
|---|---|---|---|
| Agent roster (11) | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-roles-plugin roster with normal display names (Senior Engineer, Junior Engineer, Deep Worker, Architect, Researcher, Explorer, Reviewer, Plan Reviewer, Lead, Vision Analyst, Planner); one-shot via `mpd_role_spawn`, teammate templates via the dsh-agent-teams `mpd` profile |
| Team mode | 11-agent orchestration, mailbox, tasklist, state, worktree, tmux | ✅ | dsh-agent-teams v0.1.14 adopted and VENDORED (MIT; third-party/dsh-agent-teams loaded via bundle exports — pnpm never links a bundle's transitive deps into the profile root, so a plain dependency row would self-disable; evidence/plan-e/e4-team-vendor): durable continuable members, per-member mailbox + wake, dependency-aware scheduler, task DAG Web panel, archive (stateDir .mpd/team; evidence/plan-c/c1-team). The OMO specialists are exposed as a normal-named `mpd` roster profile (`taskPlanning: captain`); the bespoke `mpd_team_spawn/status` one-shot mode was removed in favor of the adopted team plugin (reuse its architecture + GUI) |
| ultrawork / ulw loop | plan->execute->verify discipline, modes, hashline edits | ✅ | mpd_ultrawork v2 engine: discovery waves (2-fruitless stop), per-criterion PIN->RED->GREEN->SURFACE->CLEAN, plan gate + verification gate (max 2 re-reviews) + quality gate ledger, optional hyperplan adversarial wave, subagent barrier (evidence/plan-c/c2-ultrawork; deterministic engine tests). mpd_ulw kept as light alias; hashline/comment-checker hooks available in execute-verify |
| /goal & goal rounds | upstream /goal with durable state | ✅ | DSH native goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | fresh-agent iteration | ✅ | DSH native tool-ralph |
| plan mode | planning-only mode | ✅ | DSH native plan-mode |
| delegate / multi-model | delegate-task with fallback chains | 🟡 | subagent tools + mpd_modelchain_resolve (11 roles, 2-3 entry DeepSeek chains). Richer variant/effort mapping from upstream model-core not ported |
| background agents | parallel background tasks | ✅ | DSH jobs + tool-jobs |
| Skills corpus | upstream skill corpus | ➖ | removed by decision (2026-08-27): no upstream-derived content ships; the skill tool keeps DSH default + user roots (custom skills via `$DSH_HOME/.agent-presets`/skill dirs) |
| Rules / AGENTS.md | nested rule discovery & injection | ✅ | DSH agent-instructions (baseline + nested + change tracking) |
| Built-in MCPs (5) | git_bash, lsp, codegraph, context7, grep_app | ✅ | git_bash (win-gated), lsp (8 tools), codegraph (plugin+init), context7, grep_app (remote rows) + ast_grep extra |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH native commands + mpd-codegraph command; upstream modes delivered as tools (mpd_ulw/mpd_team_*) |
| hashline hash-edits | hash-preserving edit discipline | ✅ | mpd_hashline_read/edit/format/restore + registered-file post-edit guard (vendor hashline-core; evidence/plan-c/plan-c-smoke + unit tests) |
| comment-checker | post-edit comment checks | ✅ | mpd_comment_check (opt-in binary @code-yeongyu/comment-checker, MIT; installer --with-comment-checker; autoCheck off by default; unit tests + plan-c-smoke) |
| monitor / toast / TUI sidebar | session monitor + UI | ➖ | replaced by DSH session telemetry (otel), token-meter, web GUI |
| Telemetry | posthog DAU | ✅ | DSH session-telemetry-otel replaces it (no posthog) |
| Memory engine | git-backed MemFS + reflection | ✅ | mpd-memory-plugin: Markdown memo files (frontmatter), journal, reflection state machine (step-count/manual triggers, reservation), VCS abstraction with git AND svn backends (memory.vcs git|svn|both); tools mpd_memory_write/read/reflect/reflect_complete/status; evidence/plan-c/c6-memory + unit tests (git real commits, svn fake-CLI wiring) |
| Boulder state | durable work state machine | ✅ | mpd_boulder_status/start/complete/task_timer/plan_progress/plans on .mpd/boulder.json (vendor boulder-state, dsh: session prefix; evidence/plan-c/plan-c-smoke + unit tests) |
| Config (the upstream config) | layered config schema | ✅ | minimal mpd.jsonc runtime layer (project .mpd/mpd.jsonc + user $DSH_HOME/mpd.jsonc, JSONC, deep merge; bundle patch stays composition truth; evidence/plan-c/plan-c-smoke + unit tests) |
| LSP tooling | diagnostics/goto/refs/rename/symbols | ✅ | mcp__lsp__* (8 tools via offline-built daemon) |
| Multimodal | image analysis model routing | ✅ | modality route verified live: fixture PNG -> deepseek-v4-flash-vision-exp official API -> grounded answer (evidence/plan-c/c8-vision) |
| Model guardrails | capability heuristics/aliases | ✅ (scoped) | chains in mpd_modelchain_resolve (11 roles, DeepSeek-first). Upstream model-core depth intentionally skipped (user decision: DeepSeek-only, official vs unofficial API; D-C9) |
| Host-specific legacy | claude-code compat loaders, opengateway, mcp-oauth, upstream host runtime | ➖ | intentionally out of scope for a DSH bundle |

## Gap closure (Plan C waves)

- Wave A: team adoption (dsh-agent-teams, MIT notice, live mailbox/DAG panel/archive), hashline plugin, boulder plugin, mpd.jsonc config layer, vision e2e proof;
- Wave B: ultrawork v2 engine (waves/gates/ledger/hyperplan), comment-checker plugin (opt-in binary), vendor gate PASS;
- Wave C: memory engine with git + svn versioning + reflection (mpd-memory-plugin, live PASS + unit tests).
- Plan C complete: all audited gaps closed except model-core depth (user decision D-C9) and the host-specific legacy set (intentionally out of scope).

## Remaining gaps / next items (tracked in docs/plan-c.md)

- C6 (next): memory engine with git + svn versioning + reflection state machine (user: both VCS needed).
- model-core depth: intentionally skipped (user decision, D-C9).
- tmux-based team visualization: superseded by the adopted agent-teams Web activity panel.
