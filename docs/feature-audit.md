# Feature Audit — upstream spec vs my-power-dsh

**English** | [中文](./feature-audit.zh-CN.md)

This document is the **current baseline/capability comparison** for the port:
AGENTS.md §1 references it as the engineering target. Historical port-plan records
live under `docs/plan-*` and are process records, not part of this audit.

Audit date: 2026-08-26. Baseline: the upstream project 8c57e46 (v5.0.0-beta.20) capability surface.
Legend: ✅ full / 🟡 partial / ❌ missing / ➖ not applicable (host-specific legacy).

| Area | upstream spec | Status | Where / note |
|---|---|---|---|
| Agent roster (11) | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-roles-plugin roster with normal display names (Senior Engineer, Junior Engineer, Deep Worker, Architect, Researcher, Explorer, Reviewer, Plan Reviewer, Lead, Vision Analyst, Planner); one-shot via `mpd_role_spawn`, teammate templates the Lead spawns by name with the official `spawn_teammate` (persona text from `mpd_role_persona`) |
| Team mode | 11-agent orchestration, mailbox, tasklist, state, worktree, tmux | ✅ | The **official** Agent Teams plugin, mounted by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows (three declared `dependencies`): durable continuable teammates (`spawn_teammate`, fresh or fork), a durable per-member mailbox with wake (`send_message`, `list_agents`, `wait_agent`, `interrupt_agent`), a compare-and-set shared task board with dependencies and readiness (`team_task_*`), and the Web roster/task-board panel in the conversation header. Team state lives in the **Lead's session log** — there is no `.mpd/team` record and no worktree or tmux integration (upstream's worktree/tmux items are ➖). The retired vendored `dsh-agent-teams` body is kept as provenance only; see the section below |
| Workmate library | durable evolving agent pool (~/.mpd/workmate), base→instance, self-reflect, note-based reuse, rename/delete | ✅ | mpd-workmate-plugin: roster BASE → independent-name instance (persona/memory/note, size-capped: 8/8/1.5 KiB); self-summarize after work (mpd_workmate_reflect); note-matching reuse (mpd_workmate_match, threshold 0.35 — weak matches must NOT be forced, initialize a new workmate); one-shot reuse via mpd_workmate_spawn; **rename** (mpd_workmate_rename — moves directory key + meta + index key + note self-reference + renamedFrom, never re-instantiates) and **delete** (mpd_workmate_delete — ARCHIVE-FIRST into `.archive/<key>-<stamp>/`, permanent only with purge + confirm === name; recovery is a manual `mv` back, no in-product restore); both mutations refused 409 `in-use` while an in-flight spawn (or a LEGACY `.mpd/team` record) holds the workmate, naming the blocking teams, and gated in the same synchronous block as the mutation; names are ASCII-only `[a-z0-9_-]` (CJK/upper-case refused before any fs call; Unicode deferred). Routes: `POST /plugins/mpd-workmate/{rename,delete}` with the §D status/reason matrix. Team participation is by PROMPT: a teammate gets the workmate's persona/memory text because the captain puts it into the `spawn_teammate` prompt — the automatic memberPersona injection belonged to the retired vendored plugin. Library under the user's HOME by design (QA boots with HOME=<sandbox>). GUI: the library is a DSH-better-sidebar tab (`mpd-workmate`) and NOTHING else — the overlay floater and the footer toggle were removed, so the sidebar is its only host; the tab carries the rename/delete controls zh/en. Evidence: evidence/plan-f/workmate-library, evidence/workmate/rename-delete-core, evidence/workmate/rename-delete-gui, evidence/workmate/rename-delete-verify |
| ultrawork / ulw loop | plan->execute->verify discipline, modes, hashline edits | ✅ | mpd_ultrawork v2 engine: discovery waves (2-fruitless stop), per-criterion PIN->RED->GREEN->SURFACE->CLEAN, plan gate + verification gate (max 2 re-reviews) + quality gate ledger, optional hyperplan adversarial wave, subagent barrier (evidence/plan-c/c2-ultrawork; deterministic engine tests). mpd_ulw kept as light alias; user-invocable as `/ulw <objective>` / `/ultrawork <objective>` (equivalent; the run stages its own team with `approval="automatic"` when the work warrants one); hashline/comment-checker hooks available in execute-verify |
| /goal & goal rounds | upstream /goal with durable state | ✅ | DSH native goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | fresh-agent iteration | ✅ | DSH native tool-ralph |
| plan mode | planning-only mode | ✅ | DSH native plan-mode |
| delegate / multi-model | delegate-task with fallback chains | 🟡 | subagent tools + mpd_modelchain_resolve (11 roles, 2-3 entry DeepSeek chains). Richer variant/effort mapping from upstream model-core not ported |
| background agents | parallel background tasks | ✅ | DSH jobs + tool-jobs |
| Skills corpus | upstream skill corpus | ✅ | ported (2026-08-27): the corpus ships under `skills/` (19 directories, incl. `svn-master`, the repo's own `dsh-qa` and `cordis-dev` — the latter adapted from the DeepSeek Harness's 创造模式 preset skills, MIT, see `LICENSE-NOTICES.md`) and is SERVED by reference — `mpd-bootstrap` registers `<bundle>/skills` as a `bundled` skills provider through the adapter, so it is never copied into `$DSH_HOME`; see `docs/omo-parity-gap.md` §Content gaps |
| Rules / AGENTS.md | nested rule discovery & injection | ✅ | DSH agent-instructions (baseline + nested + change tracking) |
| Built-in MCPs (5) | git_bash, lsp, codegraph, context7, grep_app | ✅ | git_bash (win-gated), lsp (8 tools), codegraph (plugin+init), context7, grep_app (remote rows) + ast_grep extra |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH native commands + `/mpd-codegraph` and the ULW pair `/ulw` + `/ultrawork` (equivalent; the objective is the argument) + the TUI `/mpd` tree; the ULW engine is also a tool (`mpd_ultrawork`, `mpd_ulw` light alias). There is no `/team` and no `/agent-teams` command — team work is driven by the official tools |
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
- tmux-based team visualization: superseded by the official Agent Teams panel (the Web roster/task-board view in the conversation header).

## Retired dsh-agent-teams: version and the retained body's upstream gap

**Read this section as the history of RETAINED code, not as a shipped capability.** The vendored
`agent-teams` body is kept at `packages/mpd-agent-teams-plugin/` as provenance and no loader row
mounts it since 0.1.7-rc.2, when the official Agent Teams plugin replaced it (see the Team-mode row
above and `docs/plan-0.1.7-adaptation.md`).

The retained plugin is `0.1.16-rc.3-mpd`: the **0.1.14 body** plus the audited upstream
**0.1.16-rc.3** deltas this host generation needs — `lib/harness-compat.ts` (team delivery
through the public `ctx.subagents.prompt(request, signal)` continuable seam on harness
**0.1.5-rc.2+**, with the Alpha.2 `followup` and the Alpha.5…0.1.2-rc.1 symbol-keyed FIFO
queue `Symbol.for('dsh.subagent.queuePrompt')` kept only as older-generation fallbacks;
synchronous member setup on `agent/session-start` that takes the live Agent from the
payload (`setup(agent.ctx, agent)`) instead of reading `childCtx.agent` — an agent-scoped
Cordis ctx is a proxy that throws `cannot get property "agent" without inject` (there is no
`agent` service; the host injects `agents`, plural), and the listener fires for the captain's
own session too, so the old read aborted member initialization team-wide and made 0.1.5 team
mode unusable; retirement guard on every delivery face), `lib/capabilities.ts`
(agent-scoped member instructions + captain-tool denial), `lib/tool-names.ts`,
`lib/web-routes.ts` (browser-authentication fence + bounded JSON body), member
turn-failure handling (`failMemberOpenAttempt`), and the durability fixes (settled
team-lock release, blank optional task-field normalization, captain `claim_task` guard,
parked-attempt recovery idempotency). Evidence: `evidence/agent-teams/scheduler-wakeup-fix/`.

Two upstream deltas are deliberately NOT adopted yet in the RETAINED body (neither affects a shipped
session, which runs on the official plugin):

| Upstream delta | Why not now | What adopting it takes |
| --- | --- | --- |
| Browser bundle 0.1.14 → 0.1.16-rc.3 (`lib/client.js`) | the shipped client is the prebuilt npm artifact; the deltas there are a client-runtime → `store`/`ui-chat`/`ui-conversation` import adaptation plus the member model badge relocation/restyle, i.e. UI polish, not missing function | replace `lib/client.js`(+`.map`) with the rc.3 build, re-run `scripts/patch-agent-teams-client.ts` (export bridge), re-pin the adopted class map in `test/export-bridge.test.ts`, and re-validate the sidebar page parity + `web-client-adapt`/`agent-teams-sidebar` QA cases |
| Shortened fixed team instructions (#138) | the fork's usage text carries MPD-specific rules (roster profiles, workmate backing, Web-approval control messages) that upstream's concise core protocol does not; rewriting it changes every session's system prompt | rewrite `usageSectionText` against upstream's concise protocol while keeping the MPD rules, then re-run the capability/prompt QA cases |
