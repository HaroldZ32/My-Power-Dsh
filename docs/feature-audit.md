# Feature Audit — upstream spec vs my-power-dsh

**English** | [中文](./feature-audit.zh-CN.md)

This document is the **current baseline/capability comparison** for the port:
AGENTS.md §1 references it as the engineering target. Historical port-plan records
live under `docs/plan-*` and are process records, not part of this audit.

> **STATUS REFRAMED (de-vendor-and-verify-law, 2026-10-07).** oh-my-openagent is an EARLY
> REFERENCE, not a conformance target. The identity checks that used to measure this repository
> against it are DELETED, no gate reads an upstream checkout, and no synchronisation is owed — the
> roster, the eleven role descriptions and the model-chain vocabulary came from that project and are
> acknowledged in [`LICENSE-NOTICES.md`](../LICENSE-NOTICES.md) and the root README. Everything below
> is therefore a HISTORICAL MEASUREMENT of a capability surface, kept because the comparison is
> informative; read a ✅ as "this shipped", never as "this is still upstream-conformant", and read
> nothing here as a promise to follow upstream release by release.

Audit date: 2026-08-26. Baseline: the upstream project 8c57e46 (v5.0.0-beta.20) capability surface.
Legend: ✅ full / 🟡 partial / ❌ missing / ➖ not applicable (host-specific legacy).

| Area | upstream spec | Status | Where / note |
|---|---|---|---|
| Agent roster (11) | sisyphus, sisyphus-junior, hephaestus, oracle, librarian, explore, metis, momus, atlas, multimodal-looker, prometheus | ✅ | mpd-roles-plugin roster with normal display names (Senior Engineer, Junior Engineer, Deep Worker, Architect, Researcher, Explorer, Reviewer, Plan Reviewer, Lead, Vision Analyst, Planner); one-shot via `mpd_role_spawn`, teammate templates the Lead spawns by name with the official `spawn_teammate` (persona text from `mpd_role_persona`) |
| Team mode | 11-agent orchestration, mailbox, tasklist, state, worktree, tmux | ✅ | The **official** Agent Teams plugin provides the RUNTIME, mounted by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows (three declared `dependencies`): teammates spawned with `spawn_teammate` (fresh or fork) as ONE-SHOT consults — one bounded delegation, one report, the activation DISPOSED once that report settles, so a settled child is never resumed (the append-only catalog may still LIST it `inactive`); a per-member mailbox with wake (`send_message`, `list_agents`, `wait_agent`, `interrupt_agent`), a compare-and-set shared task board with dependencies and readiness (`team_task_*`), and the Web roster/task-board panel in the conversation header. **The team TRUTH is the mpd-OWNED record** `<workspace>/.mpd/team/teams/<teamId>.json` (`mpd-team-core-plugin`): roster, board, DAG, `kind`/`attempt`/`round`/`verdict` and every executor handle, read by every mpd surface; the official plane's own roster/mailbox/board state (persisted in the Lead's session log and read back through `dsh.teamLiveTeams()`) is the contained FALLBACK for a composition that runs the official executor. No worktree or tmux integration (upstream's worktree/tmux items are ➖). The retired vendored `dsh-agent-teams` body is provenance only; see the section below |
| Workmate library | durable evolving agent pool (~/.mpd/workmate), base→instance, self-reflect, note-based reuse, rename/delete | ✅ | mpd-workmate-plugin: roster BASE → independent-name instance (persona/memory/note, size-capped: 8/8/1.5 KiB); self-summarize after work (mpd_workmate_reflect); note-matching reuse (mpd_workmate_match, threshold 0.35 — weak matches must NOT be forced, initialize a new workmate); one-shot reuse via mpd_workmate_spawn; **rename** (mpd_workmate_rename — moves directory key + meta + index key + note self-reference + renamedFrom, never re-instantiates) and **delete** (mpd_workmate_delete — ARCHIVE-FIRST into `.archive/<key>-<stamp>/`, permanent only with purge + confirm === name; recovery is a manual `mv` back, no in-product restore); both mutations refused 409 `in-use` while an in-flight spawn (or a team record in EITHER layout — the mpd-owned `.mpd/team/teams/<teamId>.json` a team approved today writes, and the retired `.mpd/team/<teamId>/team.json` still honoured) holds the workmate, naming the blocking teams, and gated in the same synchronous block as the mutation; names are ASCII-only `[a-z0-9_-]` (CJK/upper-case refused before any fs call; Unicode deferred). Routes: `POST /plugins/mpd-workmate/{rename,delete}` with the §D status/reason matrix. Team participation is by PROMPT: a teammate gets the workmate's persona/memory text because the captain puts it into the `spawn_teammate` prompt — the automatic memberPersona injection belonged to the retired vendored plugin. Library under the user's HOME by design (QA boots with HOME=<sandbox>). GUI: the library is a DSH-better-sidebar tab (`mpd-workmate`) and NOTHING else — the overlay floater and the footer toggle were removed, so the sidebar is its only host; the tab carries the rename/delete controls zh/en. Evidence: evidence/plan-f/workmate-library, evidence/workmate/rename-delete-core, evidence/workmate/rename-delete-gui, evidence/workmate/rename-delete-verify |
| ultrawork / ulw loop | plan->execute->verify discipline, modes, hashline edits | ✅ | mpd_ultrawork v2 engine: discovery waves (2-fruitless stop), per-criterion PIN->RED->GREEN->SURFACE->CLEAN, plan gate + verification gate (max 2 re-reviews) + quality gate ledger, optional hyperplan adversarial wave, subagent barrier (evidence/plan-c/c2-ultrawork; deterministic engine tests). mpd_ulw kept as light alias; user-invocable as `/ulw <objective>` / `/ultrawork <objective>` (equivalent; the run stages its own team with `approval="automatic"` when the work warrants one); hashline/comment-checker hooks available in execute-verify |
| /goal & goal rounds | upstream /goal with durable state | ✅ | DSH native goal + tool-goal + command-goal + goal-round-driver |
| ralph loop | fresh-agent iteration | ➖ | the host **REMOVED its `tool-ralph` row from the 0.2.1 `standard` preset** (`tool-subagent-codex` / `tool-subagent-claude-code` went with it), and the `mpd` preset is kept row-for-row in step with `standard`, so no preset of this bundle composes it any more — on a harness that still ships the row the `ralph` tool remains callable. The fresh-agent loop discipline the row carried is covered by `mpd_ultrawork`'s execution rounds and by Agent Teams members |
| plan mode | planning-only mode | ✅ | DSH native plan-mode |
| delegate / multi-model | delegate-task with fallback chains | 🟡 | subagent tools + mpd_modelchain_resolve (11 roles, 2-3 entry DeepSeek chains). Richer variant/effort mapping from upstream model-core not ported |
| background agents | parallel background tasks | ✅ | DSH jobs + tool-jobs |
| Skills corpus | upstream skill corpus | ✅ | ported (2026-08-27): the corpus ships under `skills/` (19 directories, incl. `svn-master`, the repo's own `dsh-qa` and `cordis-dev` — the latter adapted from the DeepSeek Harness's 创造模式 preset skills, MIT, see `LICENSE-NOTICES.md`) and is SERVED by reference — `mpd-bootstrap` registers `<bundle>/skills` as a `bundled` skills provider through the adapter, so it is never copied into `$DSH_HOME`; see `docs/omo-parity-gap.md` §Content gaps |
| Rules / AGENTS.md | nested rule discovery & injection | ✅ | DSH agent-instructions (baseline + nested + change tracking) |
| Built-in MCPs (5) | git_bash, lsp, codegraph, context7, grep_app | ✅ | git (28 tools) + shell (`run_process`, both rows `disabled: true`), lsp (12 cclsp tools), codegraph (plugin+init), context7, grep_app (remote rows) + ast_grep extra |
| Slash commands | /goal /ultrawork /team /hyperplan … | 🟡 | DSH native commands + the seven this bundle contributes — `/mpd-codegraph`, the ULW pair `/ulw` + `/ultrawork` (equivalent; the objective is the argument), `/agent-teams`, `/cellwork` — plus the TUI-only `/mpd` and `/mpd-model` trees; the full list with its MEASURED reachability is [`user-guide.md`](user-guide.md) §12. The ULW engine is also a tool (`mpd_ultrawork`, `mpd_ulw` light alias). There is no `/team` command — team work is driven by the official tools |
| hashline hash-edits | hash-preserving edit discipline | ✅ | mpd_hashline_read/edit/format/restore + registered-file post-edit guard (vendor hashline-core; evidence/plan-c/plan-c-smoke + unit tests) |
| comment-checker | post-edit comment checks | ✅ | mpd_comment_check (opt-in binary @code-yeongyu/comment-checker, MIT; installer --with-comment-checker; autoCheck off by default; unit tests + plan-c-smoke) |
| monitor / toast / TUI sidebar | session monitor + UI | ➖ | replaced by DSH session telemetry (otel), token-meter, web GUI |
| Telemetry | posthog DAU | ✅ | DSH session-telemetry-otel replaces it (no posthog) |
| Memory engine | git-backed MemFS + reflection | ✅ | mpd-memory-plugin: Markdown memo files (frontmatter), journal, reflection state machine (step-count/manual triggers, reservation), VCS abstraction with git AND svn backends (memory.vcs git|svn|both); tools mpd_memory_write/read/reflect/reflect_complete/status; evidence/plan-c/c6-memory + unit tests (git real commits, svn fake-CLI wiring) |
| Boulder state | durable work state machine | ✅ | mpd_boulder_status/start/complete/task_timer/plan_progress/plans on .mpd/boulder.json (vendor boulder-state, dsh: session prefix; evidence/plan-c/plan-c-smoke + unit tests) |
| Config (the upstream config) | layered config schema | ✅ | minimal mpd.jsonc runtime layer (project .mpd/mpd.jsonc + user $DSH_HOME/mpd.jsonc, JSONC, deep merge; bundle patch stays composition truth; evidence/plan-c/plan-c-smoke + unit tests) |
| LSP tooling | diagnostics/goto/refs/rename/symbols | ✅ | mcp__lsp__* (12 tools via the declared cclsp dependency; `status`/`prepare_rename`/`install_decision` dropped — packages/mpd-mcp-lsp/README.md) |
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

## Retired (2026-09-27) and REMOVED (2026-10-07) dsh-agent-teams: version history and the retained body's upstream gap

**Read this section as HISTORY, never as a shipped capability: the body it describes is RETIRED
(2026-09-27) and REMOVED (2026-10-07), and nothing in it exists in the tree.** The vendored
`agent-teams` body — 768 files, its `_deps/` closure included — was DELETED at
`packages/mpd-agent-teams-plugin/` by the de-vendor wave (2026-10-07); no loader row had mounted it
since 0.1.7-rc.2, when the official Agent Teams plugin replaced it (see the Team-mode row
above, `docs/plan-0.1.7-adaptation.md`, and the deletion record in `docs/design.md`,
`docs/independence.md` §5 and `LICENSE-NOTICES.md`).

The last retained version was `0.1.16-rc.3-mpd` — the **0.1.14 body** plus the audited upstream
**0.1.16-rc.3** deltas this host generation needed — `lib/harness-compat.ts` (team delivery
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

**That version is RETIRED (2026-09-27) AND REMOVED (2026-10-07).** The official Agent Teams plugin
replaced it on 2026-09-27 and it was never mounted again, and the de-vendor wave deleted
`packages/mpd-agent-teams-plugin/` on 2026-10-07 — the `lib/…` paths named above do not exist in this
tree, no loader row mounts them, and the only surviving pieces of the adopted body were relocated as
our own code: the schemastery validator at `packages/mpd-schemastery/**` and the adopted browser
bundle retained as a view library (`docs/design.md` §7). Everything in this section, the two
never-adopted deltas below included, is a removal-time record kept for provenance.

Two upstream deltas were never adopted into that body before it was removed (neither can affect a
shipped session, which runs on the official plugin):

| Upstream delta | Why not then | What adopting it would have taken |
| --- | --- | --- |
| Browser bundle 0.1.14 → 0.1.16-rc.3 (`lib/client.js`) | the client that shipped with that body was the prebuilt npm artifact; the deltas there are a client-runtime → `store`/`ui-chat`/`ui-conversation` import adaptation plus the member model badge relocation/restyle, i.e. UI polish, not missing function | replace `lib/client.js`(+`.map`) with the rc.3 build, re-run `scripts/patch-agent-teams-client.ts` (export bridge), re-pin the adopted class map in `test/export-bridge.test.ts`, and re-validate the sidebar page parity + `web-client-adapt`/`agent-teams-sidebar` QA cases |
| Shortened fixed team instructions (#138) | the fork's usage text carries MPD-specific rules (roster profiles, workmate backing, Web-approval control messages) that upstream's concise core protocol does not; rewriting it changes every session's system prompt | rewrite `usageSectionText` against upstream's concise protocol while keeping the MPD rules, then re-run the capability/prompt QA cases |
