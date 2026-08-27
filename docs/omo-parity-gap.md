# OMO Parity Audit — my-power-dsh vs upstream (om-opencode src/agents)

Audit date: 2026-08-27. Upstream base: oh-my-openagent @ 8c57e46 (v5.0.0-beta.20), prompts under
`packages/omo-opencode/src/agents/` + `packages/prompts-core/prompts/{atlas,prometheus}/*` +
`packages/shared-skills/skills/`.

## 1. What was aligned this round (11 mpd-* personas)

| Role | Aligned upstream contract (source) | Changes |
|---|---|---|
| sisyphus | todo discipline (default.ts 87-116), delegation guides (default.ts 158-417), Oracle_Usage protocol (core-sections), skills section | + Oracle protocol (consult first, block dependent impl, never cancel), + explore trust rule, + plan-first, + skills clause |
| atlas | Master Orchestrator (prompts-core/prompts/atlas/default.md) | + parallel-by-default fan-out, + 6-section delegation prompt, + auto-continue (never "should I continue"), + anti-duplication, + Final Verification Wave, + todo discipline, + skills |
| sisyphus-junior | default.ts (75l) | + todo discipline (2+ steps), + verification gate (lint/build/todos, stop after first success, max 2 status checks), + no-delegation mandate, + skills |
| explore | explore.ts | + mandatory `<analysis>` block, + 3+ parallel tools first, + exact `<results>` format, absolute paths, no emojis, + skills |
| librarian | librarian.ts | + TYPE D classification, + communication rules (no tool names, no preamble, always cite), + skills |
| metis | metis.ts | + intent classification, + MUST/MUST-NOT (pre-refactor verification, per-change verify, no scope creep, no invented patterns), + AI-slop flags, + zero-intervention agent-executable QA criteria, + anti-duplication, + skills |
| momus | momus.ts | Role realigned: upstream is a **work-plan QA reviewer** (executability, REJECT ≤3 blockers, approve-by-default) — local UI-critic function kept as an explicit extension line |
| multimodal-looker | multimodal-looker.ts | + never call tools / never spawn / never load by path, + extract-only-requested, + no preamble |
| oracle | oracle.ts | + read-only identity ("you advise; others execute; cannot write/edit/patch/delegate"), + never fabricate, + skills |
| prometheus | prompts-core/prompts/prometheus/default.md | + upstream's ulw-plan skill dependency bridged (load via skill tool when the catalog has a planning skill; self-contained discipline otherwise), + skills |
| hephaestus | hephaestus/agent.ts + gpt-*.ts | Role realigned: upstream is an **Autonomous Deep Worker** (goal-driven, explore-then-implement end-to-end) — local config-manager framing replaced; + skills, + per-change verification |

All personas now carry a skills clause (check catalog before work/delegation, domain-match, user
skills priority, name required skills in delegation prompts) and DSH-native tool names
(`todo_write`, `subagent`/`subagent_fork`, `workflow`, `mpd_team_spawn`, `skill`).

## 2. Mechanism mapping (present parity)

| OMO construct | DSH counterpart | Status |
|---|---|---|
| `task(subagent_type=...)` / `run_in_background` | `subagent` (background default) / `subagent_fork` | full |
| task_id continuation (`ses_...`) | `send_message` + `list_agents` | full |
| `background_output` polling | `job_output` / completion notice | full |
| todowrite/todocomplete | `todo_write` (whole-list replace, status enum) | full |
| plan mode / plan agent | `planning` group + `mpd-prometheus` | full |
| categories (domain-model routing) | `mpd_modelchain_resolve` (role→provider/model) | full (different shape) |
| team mode | `mpd_team_spawn` / `mpd_team_status` | full |
| builtin/custom/user skill discovery | `skill` catalog + `skill-filesystem` roots | full |

## 3. Remaining gaps (by severity)

### Host-level limits (cannot be fixed in this repo)
- **No per-tool permissions on the preset plane.** OMO denies write/edit/patch per agent
  (explore/librarian/momus metis are hard read-only via `permissions`). DSH row-disable is
  whole-package (disabling tool-fs kills read too). Current read-only enforcement is
  persona-level text only. Would need `ctx.tools.restrict()`-based host preset support.
- **TodoPanel is display-only** in the web UI; no click-to-complete. Status updates go through
  `todo_write` (agent-side contract — now fixed).
- **`subagent` has no `load_skills` array**: OMO passes skills per delegation. DSH subagents
  keep their own `skill` tool + selectable `persona`; the contract is carried in the prompt
  (now codified in every persona's skills clause).

### Content gaps (deliberate or unported)
- **Skills corpus (13 upstream skills not shipped)**: ast-grep, coding-agent-sessions,
  data-scientist, debugging, frontend, git-master, init-deep, lsp-setup, programming, refactor,
  remove-ai-slops, review-work, ulw-plan. Per prior decision (docs/feature-audit: skills corpus
  removed, no upstream-derived content ships) the repo ships only `skills/dsh-qa`; the reference
  QA case flows cover the same ground locally. Re-porting any of these is a deliberate baseline
  change (VENDOR_LOCK-aware) — this audit only lists them.
- **`ulw-plan` skill**: prometheus persona now bridges it (load-if-present; self-contained
  discipline otherwise).
- **Model-variant prompt families** (sisyphus default/opus/gpt/kimi/…, hephaestus gpt-5.x):
  upstream selects prompts per model; my-power-dsh targets DeepSeek only, keeping one persona per
  role. Not a defect for the DeepSeek-first deployment.

### Behavioral notes (deliberate local choices)
- **metis** keeps a review mandate alongside upstream's Pre-Planning Consultant role; **momus**
  keeps UI/UX critique as a declared extension; **prometheus** writes `.mpd/plans` (upstream
  `.omo/plans`) — both are namespace-convention adaptations.
- **hephaestus model gating** (upstream restricts to GPT-5.3+) is not applicable under a
  DeepSeek-only route; the Deep Worker behavior was ported, the gating was not.

## 4. Verification
- `relocate-smoke` (staged bundle install + boot + presets=11): PASS (evidence under
  evidence/plan-d/relocate/).
- Preset YAML validated by the dsh loader during the relocate boot.
- No TypeScript change (presets only); no dist rebuild required.
