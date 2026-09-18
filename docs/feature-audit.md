# Feature Audit — upstream spec vs my-power-dsh

**English** | [中文](./feature-audit.zh-CN.md)

This document is the **current baseline/capability comparison** for the port:
AGENTS.md §1 references it as the engineering target. Historical port-plan records
live under `docs/plan-*` and are process records, not part of this audit.

Audit date: 2026-08-26. Baseline: the upstream project 8c57e46 (v5.0.0-beta.20) capability surface.
Legend: ✅ full / 🟡 partial / ❌ missing / ➖ not applicable (host-specific legacy).

| Area | upstream spec | Status | Where / note |
|---|---|---|---|
| Agent roster (11) | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-roles-plugin roster with normal display names (Senior Engineer, Junior Engineer, Deep Worker, Architect, Researcher, Explorer, Reviewer, Plan Reviewer, Lead, Vision Analyst, Planner); one-shot via `mpd_role_spawn`, teammate templates via the dsh-agent-teams `mpd` profile |
| Team mode | 11-agent orchestration, mailbox, tasklist, state, worktree, tmux | ✅ | dsh-agent-teams 0.1.16-rc.3-mpd adopted as FIRST-CLASS MAIN CODE (MIT; packages/mpd-agent-teams-plugin loaded via bundle exports — pnpm never links a bundle's transitive deps into the profile root, so a plain dependency row would self-disable; server closure vendored under _deps/; evidence/plan-e/e4-team-vendor): durable continuable members, per-member mailbox + wake, dependency-aware scheduler, task DAG in the GUI, archive (stateDir .mpd/team; evidence/plan-c/c1-team). The specialist roster is exposed as a normal-named `mpd` roster profile (`taskPlanning: captain`); the bespoke `mpd_team_spawn/status` one-shot mode was removed in favor of the adopted team plugin (reuse its architecture + GUI); web client adaptation: the @mpd-dsh/mpd bundle client now loads (mpd-web-compat self-row + '@mpd-dsh/mpd'-registered combined client.js — the agent-teams views composed by the DSH-better-sidebar `mpd-agent-teams` tab; evidence/plan-f/web-client-adapt) |
| Workmate library | durable evolving agent pool (~/.mpd/workmate), base→instance, self-reflect, note-based reuse, rename/delete | ✅ | mpd-workmate-plugin: roster BASE → independent-name instance (persona/memory/note, size-capped: 8/8/1.5 KiB); self-summarize after work (mpd_workmate_reflect); note-matching reuse (mpd_workmate_match, threshold 0.35 — weak matches must NOT be forced, initialize a new workmate); one-shot reuse via mpd_workmate_spawn; **rename** (mpd_workmate_rename — moves directory key + meta + index key + note self-reference + renamedFrom, never re-instantiates) and **delete** (mpd_workmate_delete — ARCHIVE-FIRST into `.archive/<key>-<stamp>/`, permanent only with purge + confirm === name; recovery is a manual `mv` back, no in-product restore); both mutations refused 409 `in-use` while a team record or an in-flight spawn holds the workmate, naming the blocking teams, and gated in the same synchronous block as the mutation; names are ASCII-only `[a-z0-9_-]` (CJK/upper-case refused before any fs call; Unicode deferred). Routes: `POST /plugins/mpd-workmate/{rename,delete}` with the §D status/reason matrix. team integration via patched memberPersona (member named after a workmate gets its persona+memory injected + reflect instruction). Library under the user's HOME by design (QA boots with HOME=<sandbox>). GUI: the library is a DSH-better-sidebar tab (`mpd-workmate`) and NOTHING else — the overlay floater and the footer toggle were removed, so the sidebar is its only host; the tab carries the rename/delete controls zh/en. Evidence: evidence/plan-f/workmate-library, evidence/workmate/rename-delete-core, evidence/workmate/rename-delete-gui, evidence/workmate/rename-delete-verify |
| ultrawork / ulw loop | plan->execute->verify discipline, modes, hashline edits | ✅ | mpd_ultrawork v2 engine: discovery waves (2-fruitless stop), per-criterion PIN->RED->GREEN->SURFACE->CLEAN, plan gate + verification gate (max 2 re-reviews) + quality gate ledger, optional hyperplan adversarial wave, subagent barrier (evidence/plan-c/c2-ultrawork; deterministic engine tests). mpd_ulw kept as light alias; user-invocable as `/ulw <objective>` / `/ultrawork <objective>` (equivalent; the run stages its own team with `approval="automatic"` when the work warrants one); hashline/comment-checker hooks available in execute-verify |
| /goal & goal rounds | upstream /goal with durable state | ✅ | DSH native goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | fresh-agent iteration | ✅ | DSH native tool-ralph |
| plan mode | planning-only mode | ✅ | DSH native plan-mode |
| delegate / multi-model | delegate-task with fallback chains | 🟡 | subagent tools + mpd_modelchain_resolve (11 roles, 2-3 entry DeepSeek chains). Richer variant/effort mapping from upstream model-core not ported |
| background agents | parallel background tasks | ✅ | DSH jobs + tool-jobs |
| Skills corpus | upstream skill corpus | ✅ | ported (2026-08-27): the corpus ships under `skills/` (18 directories, incl. `svn-master` and the repo's own `dsh-qa`) and is SERVED by reference — `mpd-bootstrap` registers `<bundle>/skills` as a `bundled` skills provider through the adapter, so it is never copied into `$DSH_HOME`; see `docs/omo-parity-gap.md` §Content gaps |
| Rules / AGENTS.md | nested rule discovery & injection | ✅ | DSH agent-instructions (baseline + nested + change tracking) |
| Built-in MCPs (5) | git_bash, lsp, codegraph, context7, grep_app | ✅ | git_bash (win-gated), lsp (8 tools), codegraph (plugin+init), context7, grep_app (remote rows) + ast_grep extra |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH native commands + `/mpd-codegraph`, the ULW pair `/ulw` + `/ultrawork` (equivalent; the objective is the argument) and the adopted `/agent-teams`; the ULW engine is also a tool (`mpd_ultrawork`, `mpd_ulw` light alias) |
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
| Host-specific legacy | claude-code compat loaders, opengateway, mcp-oauth, the upstream CLI runtime | ➖ | intentionally out of scope for a DSH bundle |

## Gap closure (Plan C waves)

- Wave A: team adoption (dsh-agent-teams, MIT notice, live mailbox/DAG panel/archive), hashline plugin, boulder plugin, mpd.jsonc config layer, vision e2e proof;
- Wave B: ultrawork v2 engine (waves/gates/ledger/hyperplan), comment-checker plugin (opt-in binary), vendor gate PASS;
- Wave C: memory engine with git + svn versioning + reflection (mpd-memory-plugin, live PASS + unit tests).
- Plan C complete: all audited gaps closed except model-core depth (user decision D-C9) and the host-specific legacy set (intentionally out of scope).

## Remaining gaps / next items (tracked in docs/plan-c.md)

- C6 (next): memory engine with git + svn versioning + reflection state machine (user: both VCS needed).
- model-core depth: intentionally skipped (user decision, D-C9).
- tmux-based team visualization: superseded by the adopted agent-teams team GUI (the DSH-better-sidebar AgentTeams tab).

## Adopted dsh-agent-teams: version and remaining upstream gap

The adopted plugin is `0.1.16-rc.3-mpd`: the **0.1.14 body** plus the audited upstream
**0.1.16-rc.3** deltas this host generation needs — `lib/harness-compat.js` (team delivery
through the public `ctx.subagents.prompt(request, signal)` continuable seam on harness
**0.1.5-rc.2+**, with the Alpha.2 `followup` and the Alpha.5…0.1.2-rc.1 symbol-keyed FIFO
queue `Symbol.for('dsh.subagent.queuePrompt')` kept only as older-generation fallbacks;
synchronous member setup on `agent/session-start` that takes the live Agent from the
payload (`setup(agent.ctx, agent)`) instead of reading `childCtx.agent` — an agent-scoped
Cordis ctx is a proxy that throws `cannot get property "agent" without inject` (there is no
`agent` service; the host injects `agents`, plural), and the listener fires for the captain's
own session too, so the old read aborted member initialization team-wide and made 0.1.5 team
mode unusable; retirement guard on every delivery face), `lib/capabilities.js`
(agent-scoped member instructions + captain-tool denial), `lib/tool-names.js`,
`lib/web-routes.js` (browser-authentication fence + bounded JSON body), member
turn-failure handling (`failMemberOpenAttempt`), and the durability fixes (settled
team-lock release, blank optional task-field normalization, captain `claim_task` guard,
parked-attempt recovery idempotency). Evidence: `evidence/agent-teams/scheduler-wakeup-fix/`.

Two upstream deltas are deliberately NOT adopted yet:

| Upstream delta | Why not now | What adopting it takes |
| --- | --- | --- |
| Browser bundle 0.1.14 → 0.1.16-rc.3 (`lib/client.js`) | the shipped client is the prebuilt npm artifact; the deltas there are a client-runtime → `store`/`ui-chat`/`ui-conversation` import adaptation plus the member model badge relocation/restyle, i.e. UI polish, not missing function | replace `lib/client.js`(+`.map`) with the rc.3 build, re-run `scripts/patch-agent-teams-client.mjs` (export bridge), re-pin the adopted class map in `test/export-bridge.test.mjs`, and re-validate the sidebar page parity + `web-client-adapt`/`agent-teams-sidebar` QA cases |
| Shortened fixed team instructions (#138) | the fork's usage text carries MPD-specific rules (roster profiles, workmate backing, Web-approval control messages) that upstream's concise core protocol does not; rewriting it changes every session's system prompt | rewrite `usageSectionText` against upstream's concise protocol while keeping the MPD rules, then re-run the capability/prompt QA cases |
