# omo-dsh porting implementation plan

> Bring oh-my-openagent's portable capabilities into DeepSeek Harness (DSH) as a third-party bundle,
> with the DeepSeek official API as the primary track, achieving "DeepSeek all-in-one".
>
> **Two iron rules (new in this revision):**
> 1. Test and development requirements strictly align with OMO's original discipline (bun test / type gates / isolated QA / evidence landing / stage gates);
> 2. Everything developed is ultimately delivered as a DSH plugin (cordis plugin) — no loose scripts, no bare config.
>
> Status: draft v2 (enter P0 after confirmation)　Date: 2026-08-26

---

## 1. Goals and scope

### 1.1 Background conclusions (from architecture reconnaissance)

1. omo has completed "multi-host adapter" layering: 19 Core pure-TS packages + stdio MCP + SKILL.md skills are all host-agnostic and directly reusable;
   host coupling is concentrated in three adapters: omo-opencode (2787 files/16MB), omo-codex, omo-senpi.
2. DSH's extension seams map one-to-one to omo capabilities: tools pipeline (pre/execute/post + guard), skills, persona/preset,
   subagent (supporting per-child persona/model/structured output/tool filtering), goal/ralph/workflow, jobs,
   dsh-mcp-client, dsh-agent-instructions (AGENTS.md injection), compaction, storage, Web GUI.
3. DSH already ships a DeepSeek official API adapter (dsh-llm-deepseek, default models deepseek-v4-flash/pro);
   omo's own fallback chain already has a deepseek-v4-flash entry; DSH's dsh-llm-pi-ai shares the same origin as omo's Senpi edition (pi-ai).
4. The biggest risk is not the wiring, but verifying prompt/behavior-layer adaptation to DeepSeek's thinking format.

### 1.2 Porting target definition (the object of this plan)

> Create a new independent local repo omo-dsh, delivering a **plugin bundle** loadable by a DSH profile:
> - Each capability = one cordis plugin (self-developed plugin or official plugin instantiation entry); the bundle only does mounting/summary;
> - Reuse omo's skills / MCP / agent prompt assets;
> - All agents route to the DeepSeek official API (deepseek-official), with pi-ai's deepseek route as dual-track compatibility;
> - The first milestone (Track A) is bounded by a minimal usable closed loop; deep porting (Team Mode/ultrawork) becomes the later B line.

### 1.3 Success criteria (measurable)

| # | Standard | Measurement |
|---|---|---|
| S1 | omo-dsh repo can reproducibly build a DSH plugin bundle | Run the bootstrap script in a clean directory → dsh --dump-config passes |
| S2 | DeepSeek official routing works in both headless and web (thinking + tool call) | dsh --profile omo-headless smoke + manual test in this GUI |
| S3 | ≥3 omo skills, ≥2 MCP, ≥3 agent presets run | tool/skill directory + real-call evidence |
| S4 | Golden-task pass rate ≥ 80% (including ≥2 hardware code tasks) | scoring rubric landed |
| S5 | Original repo zero changes, zero pushes; all changes only in the new omo-dsh repo | git status verification + remote check |
| S6 | License and third-party notices compliant | LICENSE-NOTICES.md |
| S7 | **All deliverables as plugins**: no loose scripts, no bare config; every plugin bun test + tsgo all green + QA evidence landed | repo structure review + CI-style script |

### 1.4 Scope

**In scope (Track A)**: pluginized bundle structure, DeepSeek dual-track, skills subset plugin, MCP plugin
(ast-grep/git-bash first, lsp per network decision), first-batch agent preset plugin (oracle/librarian/prometheus) +
Hephaestus native minimal plugin, dsh-qa skill, behavior verification and prompt iteration.

**Out of scope (explicitly not doing)**: modifying omo original repo source; porting the opencode TUI/installer/opencode-specific hooks (tui-sidebar,
zauc-mocks, claude-code-*-loader, opengateway-provider, etc.); external release/commercial distribution; B-line deep porting (see 4.7).

---

## 2. Baseline, environment, and hard constraints

| Item | Value |
|---|---|
| omo baseline | Checkout HEAD 8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29 (2026-08-26), package 5.0.0-beta.20; historical snapshot f3642fcd for reference only |
| DSH baseline | @deepseek-ai/dsh 0.1.1-rc.2, installed at ~/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh |
| DSH host | ~/.dsh (web profile already includes base + web-app + dshmarket + @linxin666/dsh-web-all + nowledge-mem) |
| Toolchain | bun 1.4.0 / node v24.19.0 / pnpm / git (all usable) |
| Network constraints | Direct GitHub connections hang → install deps with bun install --ignore-scripts; build omo with OMO_SKIP_MATERIALIZE=1; reuse installed node_modules where possible |
| Process hard constraints | ① All changes go into a new local repo (this repo), never push the original repo; ② QA evidence for each stage lands in evidence/; ③ omo source read-only, only vendor copies |
| Iron rule 1 | Tests and development align with the OMO original (see §5) |
| Iron rule 2 | All deliverables as plugins (see §3.3) |

---

## 3. Repo, plugin form, and loading mechanism

### 3.1 Repo location and isolation

The repo is located at the original omo checkout's .omo/port/omo-dsh/ — the original repo's .gitignore already ignores .omo/*,
so the original repo's git status stays completely clean, while the new repo has independent git history.

### 3.2 Directory structure (P0 landing, one package per plugin)

    omo-dsh/
    ├── PLAN.md                  # this file
    ├── README.md
    ├── LICENSE-NOTICES.md       # SUL-1.0 compliance notice + third-party notices
    ├── VENDOR_LOCK.json         # locks omo commit sha + file-count/loc verification values
    ├── AGENTS.md                # this repo's gates (aligned with the discipline spirit of omo's root AGENTS.md)
    ├── package.json             # root scripts mirror omo: typecheck / test / test:fast / test:qa
    ├── tsconfig.json
    ├── packages/                # one capability one plugin, structure aligned with omo packages/ (src + *.test.ts + AGENTS.md)
    │   ├── omo-dsh-bundle/      # bundle package: cordis.patch.yml summarizes and mounts all the plugin entries below
    │   ├── omo-skills-plugin/   # plugin: skill provider (points at skills assets inside the bundle)
    │   ├── omo-mcp-astgrep/     # plugin: ast-grep MCP integration (including build artifacts and integration tests)
    │   ├── omo-mcp-gitbash/     # plugin: git-bash MCP integration
    │   ├── omo-mcp-lsp/         # plugin: lsp MCP integration (per decision D2)
    │   ├── omo-presets-plugin/  # plugin: oracle/librarian/prometheus presets + persona registration
    │   ├── omo-hephaestus/      # plugin: Hephaestus config-management agent (minimal version, P4 starting point before B line)
    │   └── omo-tools-plugin/    # (from B1) tool/hook plugin
    ├── profiles/
    │   ├── omo/                 # web profile template
    │   └── omo-headless/        # CI smoke profile template
    ├── skills/
    │   └── dsh-qa/              # QA skill, same structure as omo opencode-qa (including --self-test scripts)
    ├── scripts/                 # bootstrap / build / smoke / evidence / verify-vendor
    ├── tests/                   # golden-task set + rubric + adaptation log
    └── evidence/                # single canonical evidence path (aligned with .omo/evidence/<domain>/<slug>/)

### 3.3 Plugin-form iron rule (landing rules for iron rule 2)

- **Any logic means a self-developed plugin**: any capability that needs code (skill provider, preset registration, Hephaestus, later hooks/tools/team mode)
  is always written as a cordis plugin (name/inject/apply + schemastery Config), compiled as a package and tested.
- **Pure config means a plugin instantiation entry**: assembly-only capabilities (llm dual-track, dsh-mcp-client line, skill-filesystem line)
  are published as plugin entries in the bundle's cordis.patch.yml — DSH's official plugin instantiation is itself the plugin mode.
- **Boundary decision D7**: when "pure config instantiation" starts to carry logic (preprocessing, conditional switches, path resolution), upgrade to a self-developed wrapper plugin.
- The bundle only handles mounting/summary; it is forbidden to scatter logic across profiles, scripts, or user home-directory config.

### 3.4 Loading mechanism (verified against DSH docs)

- bundle = npm package, package.json declares "dsh": { "bundle": { "patch": "./cordis.patch.yml" } };
- profile = $DSH_HOME/profiles/<name>/, containing package.json (ordered dsh.profile.bundles list) + cordis.patch.yml;
- bundle resolution uses two anchors: first the DSH install directory, then the profile's node_modules (managed by dsh plugin --profile omo <pnpm args>);
- each cordis.patch.yml is a patch layer (id-level config override is whole-entry replacement, not deep merge);
- validation: dsh --dump-default-config / dsh --dump-config.

---

## 4. Phase planning

### 4.1 P0 repo and baseline (estimated 1–1.5 person-days)

**Goal**: new repo usable, baseline locked, norms complete, gate skeleton in place.

**Tasks**
1. git init + first commit; README / PLAN / LICENSE-NOTICES / VENDOR_LOCK (SUL-1.0 compliance notice).
2. **Gate docs**: write this repo's AGENTS.md, codifying §5's test/QA gates into rules (aligned with the gate spirit of omo's root AGENTS.md).
3. Generate VENDOR_LOCK.json: omo commit sha + find/wc verification values; write scripts/verify-vendor.mjs.
4. Root scripts mirror omo: typecheck (tsgo --noEmit per package), test (bun test), test:fast, test:qa; bootstrap.mjs reproducibly builds the bundle.
5. **dsh-qa skill skeleton**: skills/dsh-qa/ (structure aligned with omo opencode-qa: SKILL.md + scripts/*.mjs all with --self-test + references/ domain reference), first version only includes the "bundle mount assertion" case.

**Acceptance**: ① original repo git status shows no change; ② new repo first commit done; ③ bootstrap runs in a clean directory;
④ dsh-qa script --self-test passes.

**Evidence**: evidence/p0/git-status-clean.txt, VENDOR_LOCK.json, evidence/p0/self-test.log.

### 4.2 P1 DSH Profile and DeepSeek dual-track (1–2 person-days) [Track A first step]

**Goal**: DeepSeek official API runs headless inside DSH, pi-ai track coexists and is switchable; all delivered as plugin entries.

**Tasks**
1. Create the profiles/omo-headless template (bundles: base + headless + omo-dsh-bundle); profiles/omo
   (bundles: base + web-app + omo-dsh-bundle, UI third-party bundles merged in by the user as needed).
2. omo-dsh-bundle's cordis.patch.yml mounts (as plugin entries):
   - dsh-llm-deepseek: apiKeyEnv: DEEPSEEK_API_KEY, thinking: enabled, reasoningEffort: high;
   - dsh-llm-pi-ai: deepseek directory routing (dual-track coexists, primary track = official).
3. Smoke: dsh --profile omo-headless "use tools to list the current directory and reply ok", assert tool call + thinking + token-meter.
4. Dual-track comparison: run the same task once on deepseek-official and once on pi-ai deepseek, record latency/format/tool-call success rate.
5. dsh-qa new case: "llm dual-track mounted" (assert on the --dump-config output).

**Acceptance**: ① both routes complete the task under headless; ② --dump-config has no warnings and QA assertions pass; ③ comparison data landed.

**Evidence**: evidence/p1/smoke-*.log, evidence/p1/dual-track.md, evidence/p1/qa-mount.log.

### 4.3 P2 Skills plugin (0.5–1 person-day)

**Goal**: omo skills enter the DSH skill directory as a plugin.

**Tasks**
1. First-batch list (suggested): ulw-plan, init-deep, lsp-setup, git-master, review-work, programming, ast-grep
   (each includes the references directory, preserving relative-path semantics), vendored into the omo-skills-plugin asset directory.
2. Delivery form: omo-skills-plugin = a self-developed thin plugin that wraps dsh-skill-filesystem instantiation (customSkillDirs points to this package's skills/,
   path-resolution logic goes into plugin code) — satisfying "any logic means a self-developed plugin".
3. Unit tests (bun test, aligned with omo's test style): frontmatter compatible parsing, directory-list snapshot, relative-path semantics;
   metadata: record extra-key behavior via actual tests (if it errors → strip script becomes normalize logic inside the plugin).
4. QA: dsh-qa case "skill directory visible + loaded content complete".

**Acceptance**: catalog visible + loads correctly + no frontmatter errors; plugin tests all green.

**Evidence**: evidence/p2/skill-catalog.txt, evidence/p2/load-sample.log.

### 4.4 P3 MCP plugin (1–2 person-days)

**Goal**: omo's stdio MCP mounts into DSH as a plugin.

**Tasks**
1. Priority: ast-grep-mcp (highest value for Verilog/RTL syntax trees) → git-bash-mcp → lsp-tools-mcp+lsp-daemon (D2).
2. Delivery form: omo-mcp-astgrep / omo-mcp-gitbash each as a plugin package — containing vendored source + bun build artifacts +
   the entry that instantiates dsh-mcp-client (write a self-developed wrapper plugin if dynamic path/env handling is needed).
3. Integration test: boot the real dsh under an isolated DSH_HOME, assert mcp__ast_grep__* / mcp__git_bash__* appear in the tool list;
   make one real call against a sample Verilog file (record timeout/reconnect behavior).
4. QA: dsh-qa case "both MCPs mounted and callable", evidence landed.

**Acceptance**: tools visible + real call succeeds + failure reconnect has log evidence; integration tests all green.

**Evidence**: evidence/p3/tool-list.txt, evidence/p3/verilog-sample-call.log.

### 4.5 P4 preset plugin + Hephaestus plugin (2–4 person-days)

**Goal**: omo's first-batch agents land in DSH as plugins with DeepSeek-native prompts.

**Tasks**
1. First-batch agents: oracle (review, deepseek-v4-pro), librarian (retrieval, v4-flash), prometheus (planning, v4-pro);
   extract identity sections from omo's builtin-agents prompt source, remove reasoning variant/multi-provider wording, rewrite for DeepSeek thinking context.
2. Delivery form: omo-presets-plugin — a self-developed plugin responsible for preset/persona registration (first investigate dsh-agent-presets' registration API:
   config declaration vs programmatic; if a programmatic API exists then code it all, otherwise publish as agent.cordis.yml inside the plugin package +
   bundle entries); persona text and prompts are assets inside the plugin, and must not scatter into user directories.
3. omo-hephaestus plugin (minimal version): config-management agent — can read/edit the profile's cordis.patch.yml, presets, model routing,
   MCP registration, produce diffs; DeepSeek-native prompts; first round only requires "read config + explain" capability; read/write logic becomes plugin-internal tools.
4. Run each preset through a corresponding golden task under headless; establish tests/prompt-adaptation-log.md (record reason/effect for every prompt change).
5. Tests: plugin unit tests (bun test) + preset registration assertions + isolated DSH_HOME integration smoke.

**Acceptance**: the three presets + Hephaestus each pass 1 golden task; adaptation log has ≥2 iteration records; tests all green.

**Evidence**: evidence/p4/preset-smoke-*.log, tests/prompt-adaptation-log.md.

### 4.6 P5 behavior verification and tuning (3–5 person-days)

**Goal**: Track A's definition of done fully achieved.

**Tasks**
1. Golden-task set (≥8 tasks): 3 general coding, 2–3 hardware code (RTL module+testbench, lint cleanup, doc/waveform explanation), 2 tool-use.
2. Matrix batch run: preset × task; rubric (completion 40% / tool-use correctness 30% / cost and time 15% / no overreach and no dishonesty 15%).
3. Prompt iteration ≤3 rounds per task, all recorded; root-cause classification for failed tasks (prompt / model capability / tool wiring).
4. Full gates: all dsh-qa cases + all plugin bun test + tsgo all green, all evidence landed.
5. Output docs/track-a-report.md: pass rate, cost summary, leftovers, B-line launch recommendations.

**Acceptance**: S1–S7 all achieved (§1.3).

**Evidence**: evidence/p5/ full batch run + report.

### 4.7 B-line backlog (start after Track A acceptance, needs rescheduling)

| # | Content (all delivered as plugins) | Estimate |
|---|---|---|
| B1 | omo-tools-plugin: tool-level hook porting (write-existing-file-guard, edit-error-recovery, tool-output-truncator, etc. → DSH tools/pre|post-execute + guard) | 1–2 weeks |
| B2 | omo-team-plugin: Team Mode adapter, reuse team-core domain primitives, rebind TeamSessionClient to DSH session/subagent | 2–4 weeks |
| B3 | omo-ulw-plugin: ulw-loop/ultrawork loop discipline, implement omo's state machine on goal-round-driver + schedule | 1–2 weeks |
| B4 | omo-memory-plugin / omo-modelchain-plugin: pluginize memory-core, boulder-state, model-core fallback chain | on demand |

---

## 5. Test and development norms (strictly aligned with the OMO original)

This section is the landing plan for iron rule 1. The left column is omo's original discipline, the right column is this repo's aligned implementation.

| # | OMO original discipline | omo-dsh aligned implementation |
|---|---|---|
| T1 | Test framework bun:test, test files co-located with source (*.test.ts) | Each plugin package places *.test.ts beside src/, root script test = bun test |
| T2 | Type gate tsgo --noEmit per package (typecheck / typecheck:packages) | Root package.json mirrors the same-named scripts, runs tsgo per plugin package |
| T3 | One QA skill per domain: opencode-qa / codex-qa / senpi-qa, including --self-test helper scripts and domain references | New dsh-qa skill (skills/dsh-qa/), same structure as omo's QA skills: SKILL.md + scripts (all with --self-test) + references/ |
| T4 | Strict isolation: real binary + isolated home directory, never touch the user's real config (e.g. isolated CODEX_HOME / SENPI_CODING_AGENT_DIR) | QA always uses an isolated DSH_HOME (temp dir), boots the real dsh binary; scripts assert isolation is effective |
| T5 | Provability: assert plugin hook/events actually fire (hook/started + hook/completed), not just "it runs" | dsh-qa asserts plugin entries are mounted (--dump-config output assertions) and self-developed plugin side-effect events/logs; smoke results landed |
| T6 | Single canonical evidence path .omo/evidence/<domain>/<slug>/ | This repo's evidence/<domain>/<slug>/, same name and structure; no evidence = stage not complete |
| T7 | Stage gates: changes must run the corresponding QA and land evidence (AGENTS.md gate) | This repo's AGENTS.md codifies the same gate; stage acceptance = all plugins of that stage have test + tsgo + QA evidence complete |

Supplementary rules:
- All logs produced by smoke/batch runs go into evidence/; forbidden to scatter into /tmp and then discard;
- Prompt/asset changes count as code changes and go through test + QA;
- Golden rubric and pass-rate definitions are in §4.6, batch scripts themselves carry --self-test.

---

## 6. Track A definition of done (DoD)

1. Run bootstrap in a clean directory → bundle builds successfully, dsh --dump-config passes;
2. deepseek-official works on both headless and web; pi-ai dual-track switchable with comparison evidence;
3. ≥3 skills, ≥2 MCP, ≥3 presets + Hephaestus minimal version all run real tasks;
4. Golden pass rate ≥80%, all evidence in evidence/;
5. Original repo zero changes, zero pushes, new repo commit history complete;
6. LICENSE-NOTICES complete, no unauthorized distribution;
7. **All deliverables as plugins (S7)**: no loose scripts, no bare config; every self-developed plugin bun test + tsgo all green;
   all dsh-qa cases pass and evidence landed (T1–T7 all satisfied).

---

## 7. Quality gates

- Stage gate: don't start the next stage before the previous stage's acceptance evidence lands (T7).
- Alignment statement: omo's original opencode-qa gate only constrains omo-opencode source changes; this repo doesn't change omo source,
  and uses dsh-qa + plugin tests as the equivalent gate, with the same discipline and evidence path structure (§5).
- Regression: after any bundle/plugin change, must rerun dsh --dump-config + one headless smoke, appending results to evidence/.

---

## 8. Risk register

| # | Risk | Probability/Impact | Mitigation |
|---|---|---|---|
| R1 | omo prompts don't fit DeepSeek behavior (biggest risk) | High/High | P5 dedicated iteration budget + adaptation log + failure root-cause classification |
| R2 | DeepSeek API rate limiting / uncontrolled billing | Medium/Medium | dual-track switching + batch budget cap + result caching |
| R3 | no-network build of lsp-daemon (npm ci) | High/Medium | decision D2: publish package / defer / reuse remote prebuilt |
| R4 | omo version drift (HEAD 8c57e46 ≠ historical snapshot f3642fc) | High/Medium | VENDOR_LOCK lock + verification script, don't chase updates |
| R5 | DSH rc updates break bundle compatibility | Medium/Medium | pin dependency versions + --dump-config regression |
| R6 | SUL-1.0 license restriction | Low/Medium | internal use only; keep all notices; no external release |
| R7 | original repo polluted / accidental push | Low/High | repo in .omo/port (already ignored); git status before each stage; no remote configured |
| R8 | plugin scoping (agent-plane/host-plane/realm isolation) misused causing registration conflicts or missing capabilities | Medium/Medium | use DSH built-in preset's agent.cordis.yml comments as template; dsh-qa asserts registration result |
| R9 | QA isolation failure pollutes the user's real ~/.dsh | Low/High | QA scripts force DSH_HOME=temp dir and assert in-script (T4) |

---

## 9. Pending decisions (finalize before entering the corresponding stage)

| # | Decision | Default inclination | Trigger stage |
|---|---|---|---|
| D1 | profile form: independent omo profile vs directly modifying web profile | Independent omo profile, UI third-party bundles merged by the user as needed | P1 |
| D2 | lsp-daemon build strategy (no network) | If npm ci hangs → defer lsp to B line, deliver ast-grep+git-bash first | P3 |
| D3 | first-batch agent roster | oracle + librarian + prometheus + hephaestus (minimal version) | P4 |
| D4 | dual-track primary | official deepseek-official as primary track, pi-ai as compatible track | P1 |
| D5 | skill subset list | ulw-plan / init-deep / lsp-setup / git-master / review-work / programming / ast-grep | P2 |
| D6 | tool-presentation (native vs code mode) | main agent uses code mode (run_code), lightweight agents use native | P4 |
| D7 | self-developed plugin vs pure-config instantiation boundary | with logic → self-developed plugin; pure assembly → official plugin entries in bundle (§3.3) | throughout |
| D8 | dsh-qa skill location | in this repo's skills/dsh-qa/, shipped with the bundle | P0 |

---

## 10. Milestones and effort summary

| Stage | Content (plugin deliverables) | Estimate | Exit condition |
|---|---|---|---|
| P0 | repo/baseline/dsh-qa skeleton (bundle + scripts) | 1–1.5 person-days | reproducible, original repo zero changes, --self-test passes |
| P1 | Profile + DeepSeek dual-track (bundle entries) | 1–2 person-days | official API headless fully works + QA assertions |
| P2 | omo-skills-plugin | 0.5–1 person-day | skill directory + load verification + tests all green |
| P3 | omo-mcp-astgrep / omo-mcp-gitbash plugins | 1–2 person-days | real call succeeds + integration tests all green |
| P4 | omo-presets-plugin + omo-hephaestus plugin | 2–4 person-days | three presets each pass 1 golden task |
| P5 | behavior verification and tuning (full dsh-qa gate) | 3–5 person-days | Track A DoD fully achieved |
| Total | | ≈ 9–16 person-days | |
| B2 (largest) | omo-team-plugin | 2–4 weeks | defined separately |

---

## 11. First batch of actions to start immediately (P0 checklist)

1. git init + first commit for this repo (PLAN/README/LICENSE-NOTICES/VENDOR_LOCK/AGENTS.md skeleton);
2. Confirm .omo/port/omo-dsh is not tracked by the original repo (git status clean);
3. Write VENDOR_LOCK.json + scripts/verify-vendor.mjs and run it;
4. Create the skills/dsh-qa skeleton (SKILL.md + one mount assertion script with --self-test);
5. After delivery, wait for user confirmation → enter P1 (create profile, mount DeepSeek official adapter, headless smoke).
