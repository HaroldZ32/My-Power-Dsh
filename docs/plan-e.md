# Plan E — Route team mode onto the adopted dsh-agent-teams protocol + rewrite delegation tendency

Status: **DRAFT (2026-08-27)** — pending review items in §2 (E4 upgrade, mpd_team_spawn disposition, E2 scope).

Goal:
1. **Team mode** stays on the already-adopted `@nanmicoder/dsh-agent-teams` plugin (vendor id
   `agent-teams`, tools `agent_teams_*`, Web activity panel). All team guidance in personas/skills
   is rewired to that protocol; nothing of the team protocol (mailbox/tasklist/scheduler) is rebuilt
   in `mpd-*`.
2. **Subagent invocation tendency** is rewritten across the persona presets in DSH semantics, closing
   the gaps found by the OMO-vs-mpd audit (delegation check, decompose-and-delegate, anti-duplication,
   per-model caller guidance, tool-description compensation).

## 0. Context (audit findings, condensed)

- **Upstream OMO team**: members are mailbox-writing executors only (sisyphus / atlas /
  sisyphus-junior; hephaestus conditional); read-only agents (oracle / librarian / explore / metis /
  momus / prometheus / multimodal-looker) are hard-rejected as members and go through one-shot
  `task` delegation instead. 8 members max, 4–8 parallel, mailbox + tasklist + auto-delivery + closure.
- **Our mpd_team_spawn** (plan-c B2, one-shot): role pool = oracle / prometheus / librarian /
  hephaestus — 3 of the 4 are upstream hard-rejected read-only roles → semantically inverted;
  no inter-member channel, spawn-once-and-finish.
- **dsh-agent-teams** (adopted v0.1.13, MIT, `LICENSE-NOTICES.md`; bundle row overrides
  `stateDir: .mpd/team`, `memberProvider: spawn`, `memberMaxDepth: 1` in
  `packages/mpd-bundle/cordis.patch.yml`): 13 `agent_teams_*` tools
  (create / add_member / remove_member / create_task / claim_task / update_task / reassign_task /
  send_message / status / approve / resume / delete / edit_plan), continuable members, dependency
  DAG scheduler with auto-claim, per-member mailbox + direct messages, quality gates, Web tree/DAG
  activity panel, `/agent-teams` slash command + natural-language activation. The npm copy on disk
  is **0.1.14**, which adds multi-role team profiles and the approval-staged planning GUI
  (`StagingPlanEditor`). → upstream's mailbox/tasklist/auto-delivery/closure all have counterparts
  there; adoption, not reimplementation, is the plan.
- **Delegation tendency audit (ours)**: persona text direction is aligned (strong-delegation
  sisyphus/atlas/hephaestus; anti-spawn oracle/explore/librarian/prometheus/multimodal-looker/
  sisyphus-junior) but the upstream structural sections are missing: MANDATORY three-step delegation
  check + `Default Bias: DELEGATE`, `DECOMPOSE AND DELEGATE` (one subagent per unit, all in parallel),
  anti-duplication, and caller guidance per target model. The host `subagent`/`subagent_fork` tool
  descriptions cannot be rewritten by a plugin (host limit, recorded in `docs/omo-parity-gap.md`),
  so persona text is the only lever. `skills/ulw-plan` still teaches OpenCode-native delegation
  syntax; `skills/ulw-research` still enumerates Codex `teammode` / OpenCode `team_mode`.

## 1. Item plans

### E1 — Team trigger surface: point personas/skills at `agent_teams_*` (text-only)

| # | File | Change |
|---|---|---|
| 1 | `packages/mpd-presets-plugin/presets/mpd-atlas/agent.cordis.yml:5` | Replace `mpd_team_spawn for role teams` with agent-teams guidance: captain = current session, members = continuable subagents, tasks carry owners + dependencies; read-only advisors stay one-shot `subagent` calls, they never join a team |
| 2 | `skills/ulw-execute/SKILL.md:19` | Mapping row `team_*(...)` → `mpd_team_spawn + mpd_team_status` becomes `team_*(...)` → `agent_teams_create/add_member/create_task/... + agent_teams_status` (scheduler auto-claims ready tasks; members wake as continuable subagents; web DAG panel mirrors state) |
| 3 | `skills/ulw-research/SKILL.md:17` | Same mapping row rewrite as #2 |
| 4 | `skills/ulw-research/SKILL.md:58-68` | "Run the swarm as a cooperating team": replace the Codex `teammode` / OpenCode `team_mode` enumeration with the `agent_teams_*` protocol; "fill every member slot (OpenCode `team_mode` caps members at 8)" → agent-teams `maxMembers: 8`; keep the one-member-per-axis + max-roster rules |
| 5 | `packages/mpd-presets-plugin/presets/mpd-hephaestus/agent.cordis.yml` | In-team positioning from the legacy "config manager" stance to executor member (upstream contract: direct execution default, joins a team as an implementer member) |
| 6 | `docs/feature-audit.md` | Update the team row + supersession note: `agent-teams` is the only primary team path in persona/skill guidance; `mpd_team_spawn/status` stay as unreferenced one-shot tools |

Trigger coverage needs no code: `/agent-teams` slash + natural-language activation are built into
the adopted plugin (keyword-hook equivalent), and the Web panel already mounts in the GUI.

### E2 — Delegation-tendency rewrite across the persona presets (DSH semantics)

All edits are `packages/mpd-presets-plugin/presets/<persona>/agent.cordis.yml` prompt text.

| Persona | Add / change |
|---|---|
| mpd-sisyphus | MANDATORY three-step delegation check before acting directly (specialist preset? skill catalog via `skill`? can I do it myself FOR SURE?) + `Default Bias: DELEGATE`; `DECOMPOSE AND DELEGATE` section, DSH version: one subagent per independent unit, spawn all in parallel — never sequential; `persona` must be a preset id (`mpd-*`), never free text; route provider/model per `mpd_modelchain_resolve`; anti-duplication: never redo a search already delegated to explore/librarian |
| mpd-atlas | Same DECOMPOSE section; team path per E1-1 |
| mpd-hephaestus | Upstream contract: direct execution is the default; spawn explore/librarian/oracle for context; delegate only when the unit exceeds one coherent edit |
| mpd-oracle / mpd-librarian / mpd-explore / mpd-momus / mpd-multimodal-looker | Keep anti-spawn clauses; add subagent-mode self-awareness: "you are consulted one-shot — never spawn children, never create teams" |
| mpd-prometheus | Keep anti-spawn clause; add coordinator note: "you are a coordinator persona — never accept being spawned as a subagent" (text-level equivalent of upstream coordinator-subagent-guard) |
| mpd-sisyphus-junior | Worker-mode clause stays; rephrase any leftover `category=` wording to DSH (preset id + model tier) |
| mpd-metis | Keep conditional delegation + anti-duplication; align phrasing |
| all 11 | Shared "Subagent usage rules" block compensating for the unwritable host tool descriptions: background mode only for 5+ independent parallel explorations; check the skill catalog before EVERY delegation; flash-model children get numbered must-do steps, forbidden deviations, concrete success criteria |

### E3 — ulw-* skill residual text alignment

1. `skills/ulw-plan/SKILL.md:86-94` — "Delegation (OpenCode-native)" rewritten as DSH-native:
   `subagent(label=…, prompt="TASK/DELIVERABLE/SCOPE/VERIFY…", persona: "mpd-…")`; drop the
   `category=` line in favor of DSH wording (never dispatch implementer personas); keep the
   read-only role list.
2. Full-file grep sweep of `skills/ulw-*` and the 17+1 skill corpus for `teammode|team_mode|category=|codex_app|MultiAgentV2|subagent(description=` — replace where the text is instruction;
   keep functional external-platform enumerations per the established scrub rule.

### E4 — dsh-agent-teams 0.1.13 → 0.1.14 (default: upgrade)

- Pins: `scripts/pack-mpd.mjs:96` (`^0.1.13`) and `scripts/install-profile.mjs:183` (`@0.1.13`)
  → 0.1.14. The npm copy already installed is 0.1.14 (adds multi-role team profiles + approval-staged
  planning GUI, closer to upstream team spec + review flow).
- Re-run `skills/dsh-qa/scripts/agent-teams-adopt.mjs` and the relocate smoke.
- Option B (no upgrade): E1–E3 do not depend on 0.1.14 features; pins stay 0.1.13.

### E5 — QA + delivery gates

- New dsh-qa case `team-route-rewire`: assert the installed `$DSH_HOME` skills/presets carry the
  `agent_teams_*` guidance at the 3 E1 touchpoints and no primary guidance names `mpd_team_spawn`;
  headless `agent_teams_*` e2e smoke (create → add member → task with dependency → run to completion
  → status → delete) in an isolated DSH_HOME with copied credentials.
- Gates: verify-vendor, bun test, tsgo typecheck, test:qa, relocate-smoke — all PASS; version bump
  0.2.3 (triggers preset + skill refresh on installed profiles).
- Evidence under `evidence/plan-e/<item>/<ts>/`; one `feature/*` or `fix/*` branch per item from
  `dev`, `--no-ff` merges, commit messages per AGENTS.md.

## 2. Review items (decide before execution)

1. **E4 upgrade**: A (default) upgrade the pin to 0.1.14 · B keep 0.1.13.
2. **mpd_team_spawn/status**: keep as unreferenced one-shot tools (default, plan-c D-C1 unchanged)
   · retire the rows/tools entirely (larger diff, touches presets tool rows).
3. **E2 scope**: rewrite all 11 personas (default) · only the 7 delegation-relevant ones.

## 3. Execution model

- Branch flow: `git checkout dev && git checkout -b feature/plan-e-<item>` per item; QA evidence
  lands in the item branch; `--no-ff` merge back to `dev`; push Gitee after each merge.
- Final: version bump to 0.2.3 + all five gates + push; plan status flipped to COMPLETE with
  evidence links (plan-c/plan-d pattern).
