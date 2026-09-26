# AGENTS.md — my-power-dsh Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins. Agent-facing content in this
repository is English-only (see Language Policy).

**Language policy (binding):**
- Agent-facing content (this manual, code comments, QA scripts/logs) stays **English-only**.
- **Human-facing documentation is BILINGUAL**: every doc a person reads — `README.md`,
  `docs/*.md`, and every `packages/*/README.md` — ships BOTH an English file and a
  **简体中文** (`*.zh-CN.md`) translation. Both versions must exist and stay in sync.
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.mjs`) enforces the pair, the switch link, the heading tree and real CJK content for every pair it discovers — every `*.md` under `docs/` at any depth, `extensions/**/README.md`, `packages/*/README.md` and the root README — reports a zh-CN document with no EN twin or a non-exempt package with no README as a violation, and prints the documented exemptions (see §4).
- **Every bilingual doc carries a language switch link directly under its title**:
  the English file links `[中文](./<name>.zh-CN.md)`, the Chinese file links
  `[English](./<name>.md)`.
- A change to a human-facing doc updates BOTH versions in the same commit. Adopted
  third-party docs kept verbatim as provenance (e.g. the upstream
  `mpd-agent-teams-plugin/README.md` and `README_ZH.md`) are exempt and stay
  untouched. Internal QA/golden reference docs (e.g. `docs/adder4.md`,
  `docs/cnt8.md`) and historical/process records — plan files
  (`docs/plan-*.md`, `docs/decisions.md`) **and** prior-phase reports
  (`docs/bline-report.md`, `docs/omo-parity-gap.md`, `docs/review-p0-p3.md`,
  `docs/track-a-report.md`, `docs/ulw-deepseek-optimization.md`,
  `docs/tui-edition-report.md`) — are process
  artifacts exempt from the bilingual requirement (see §3).

---

## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **What it carries from upstream**: the
roster, the model-chain vocabulary and the roster's stable ids come from the upstream project, and
the capability baseline is
a pinned snapshot of `code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded
in `VENDOR_LOCK.json` and not chased per §9), whose 11 specialists ship as adapted teammate templates
and workmate BASE templates; one component is adopted outright, the `agent-teams` plugin from
dsh-agent-teams under the MIT License, vendored as first-class main code. **What is ours**: the DSH
plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream spec parity is an engineering
reference, not an identity label — describe this repository by what it ships, never by what it is
not. License: SUL-1.0 (`LICENSE.md`), inherited from upstream; inheritance and attribution are
declared in `README.md` and `LICENSE-NOTICES.md`.

- Upstream product names and repository paths stay upstream's (provenance only).
- Our naming prefix is **`mpd`** (my-power-dsh): packages, plugin ids, tool names (`mpd_*`),
  preset id (`mpd`), env keys (`MPD_DSH_*`), state dir (`.mpd`).
- **The specialist roster's 11 specialists are teammate templates, not presets**: the 11
  upstream roles ship as a specialist roster whose members are addressed by NAME and
  described by what they do — Architect (architecture review, deep debugging, self-review),
  Researcher (evidence-based code / open-source search), Planner (produces `.mpd/plans`
  plans, never implements), Deep Worker (executes goals end-to-end), Senior Engineer
  (implementation and verification), Lead (orchestration and delegation),
  Explorer (read-only codebase search), Reviewer (risk findings, no fixes),
  Plan Reviewer (plan review), Vision Analyst (image analysis), Junior Engineer (fast,
  scoped execution). The stable `id` (chain key,
  `personas/<id>.md`, workmate `meta.baseId`) is INTERNAL: accepted for compatibility and
  never advertised — no description, render or result lists or returns one. One-shot
  consult via `mpd-roles-plugin`
  (`mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona`, `mpdRoles` service
  consumed by `mpd_modelchain_resolve`). Team work uses the adopted
  **dsh-agent-teams** plugin (first-class main code at
  `packages/mpd-agent-teams-plugin`, `agent_teams_*` tools + Web activity
  panel): the bundle patch configures a normal-named `mpd` roster profile
  (`taskPlanning: captain`) that exposes these specialists as teammate
  instantiation templates. The roster specialists are also BASE templates for the
  **workmate library** (`mpd-workmate-plugin`): a base can be instantiated into a
  durable, evolving copy under `~/.mpd/workmate/` with an independent name, which
  self-summarizes after each work (persona + memory, size-capped) and keeps a short
  note; reuse is via `mpd_workmate_match` and weak matches must NOT be forced (initialize
  a new workmate instead). Its agent tool surface is exactly seven tools:
  `mpd_workmate_list`, `mpd_workmate_init`, `mpd_workmate_spawn`, `mpd_workmate_reflect`,
  `mpd_workmate_match`, `mpd_workmate_rename` (moves the instance's whole evolved identity —
  directory key, meta, index key, note self-reference, `renamedFrom`) and
  `mpd_workmate_delete` (ARCHIVE-FIRST into `.archive/<key>-<stamp>/`; permanent removal only
  with `purge: true` + `confirm === name`, and recovery is a manual `mv` back — there is no
  in-product restore). Both mutations are refused while the workmate is in use (see §12) and
  names are ASCII-only `[a-z0-9_-]` before any filesystem call. The ONLY
  shipped preset is `mpd` — the main working agent — which also carries the
  project-instruction convention: every session MUST attempt to read `AGENT.md`
  (falling back to `AGENTS.md`, then `CLAUDE.md`) via `dsh-agent-instructions`.
- **Upstream binary-resolution env keys must NOT be renamed**: `MPD_AST_GREP_SG_PATH` (sg resolver)
  and `MPD_CODEGRAPH_BIN` (codegraph serve) are read by upstream vendored code.
- DSH plugin names (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the
  host's API and are never renamed.
- **Adopted plugins keep their plugin ids and tool names** (intentional namespace
  exception, same rule as the `context7`/`grep_app` remote MCP rows): the `agent-teams`
  plugin (tools `agent_teams_*`, Web activity panel) is adopted from
  `@nanmicoder/dsh-agent-teams` (MIT; adopted package version `0.1.16-rc.3-mpd`) and ships
  as **first-class main code** at `packages/mpd-agent-teams-plugin/` (runtime closure under
  `_deps/`): it loads from the bundle exports map, so it needs no npm dependency and works
  under every install layout (pnpm never links a bundle's transitive deps into the profile
  root — see §12). That version is a **0.1.14 body with the audited 0.1.16-rc.3 deltas
  backported**, and `lib/client.js` is still the 0.1.14 client build — so the 0.1.14 body is
  real provenance, never a stale claim; LICENSE-NOTICES.md is the authoritative record.
  Its `stateDir` is overridden to `.mpd/team` so all our state stays under one `.mpd` root.

---

## 2. Principles

1. **The agent is the worker.** Everything here optimizes for an agent that reads the repo cold and
   behaves correctly: explicit conventions, executable gates, evidence on disk.
2. **Plugin form.** Every delivered capability is a DSH cordis plugin (self-written) or an official
   plugin instance configured in the bundle patch. No logic in profiles, scripts, or the user home.
3. **Evidence without evidence is incomplete.** A change without QA evidence is not done.
4. **Isolation.** QA never touches the real `~/.dsh`. Everything boots in a temp DSH_HOME.
5. **Baseline discipline.** Upstream assets are pinned and verified; we don't chase upstream.
6. **Minimal diffs.** Prefer the smallest change that satisfies the requirement; no speculative refactors.

---

## 3. Repository Layout

```
mpd-dsh/
├── AGENTS.md                     # this manual
├── README.md                     # public overview (inheritance declared in README)
├── PLAN.md                       # port plan (Track A/B)
├── LICENSE.md / LICENSE-NOTICES.md
├── VENDOR_LOCK.json              # upstream commit/version/stats + vendored asset fingerprints
├── package.json                  # THE BUNDLE MANIFEST (name @mpd-dsh/mpd): dsh.bundle.patch
│                                 #   + dsh.client + exports -> `dsh plugin add .` is the whole install
├── tsconfig.json                 # root tsgo config (covers packages/*/src/**/*.ts)
├── presets/                      # the shipped `mpd` preset (served at <bundle>/presets)
├── scripts/
│   ├── verify-vendor.mjs         # blocking vendor gate (commit/version/count/sha/treeSha)
│   ├── build-mcp.mjs             # offline build of ast-grep/git-bash/lsp MCP servers + their BUILD.lock (needs MPD_UPSTREAM_ROOT on a normal clone: the default is the legacy ../../../ layout)
│   ├── bootstrap.mjs             # preflight + vendor check (P0-era, kept as checks)
│   ├── install-profile.mjs       # ONLY sanctioned writer to a user DSH_HOME (default dry-run)
│   ├── pack-mpd.mjs              # Plan D: assemble the relocatable installable bundle
│   ├── vendor-agent-teams.mjs    # materialize the adopted agent-teams plugin + closure
│   ├── mpd-ext.mjs               # extension developer CLI (validate/scaffold/list/--self-test); shares the RUNTIME validator (imports the TS source under bun)
│   └── build-mpd-client.mjs      # build the combined bundle web client (client.js)
├── packages/
│   ├── mpd-bundle/               # cordis.patch.yml: llm dual-track, skills, MCPs, all mpd plugins
│   ├── mpd-dsh-adapter-plugin/   # THE single contact surface with harness seams (tools/subagents/skills/presets); every other plugin calls through it
│   ├── mpd-skills-plugin/ (removed)
│   ├── mpd-mcp-astgrep|gitbash|lsp|codegraph/
│   ├── mpd-roles-plugin/         # specialists: roster (roles.data.ts, normal names + stable ids) + personas/ + mpd_roles_list / mpd_role_spawn / mpd_role_persona + mpdRoles service
│   ├── mpd-tools-plugin/         # B1: write guard, truncation, edit-error recovery
│   ├── mpd-modelchain-plugin/    # B4: mpd_modelchain_resolve + mpd_memory_save/recall
│   ├── mpd-ulw-plugin/           # B3: mpd_ulw loop discipline
│   ├── mpd-codegraph-plugin/     # binary resolve + project init + mpd-codegraph command
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendor hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendor boulder-state)
│   ├── mpd-config-plugin/        # C7: minimal mpd.jsonc runtime config layer (consumed by the plugins above)
│   ├── mpd-comment-checker-plugin/ # C4: comment/docstring detection (opt-in binary)
│   ├── mpd-memory-plugin/        # C6: git/svn-backed memory + reflection state machine
│   ├── mpd-workmate-plugin/      # durable evolving agent library (~/.mpd/workmate): base→instance, self-reflect (persona+memory capped), short note, reuse via mpd_workmate_* (no forced weak matches); rename/delete (archive-first, refused while in use)
│   ├── mpd-bootstrap-plugin/     # bundle provisioning BY REFERENCE: serves <bundle>/skills via the adapter; cleans legacy (<=0.2.6) home copies
│   ├── mpd-agent-teams-plugin/   # adopted dsh-agent-teams (MIT, first-class main code): agent_teams_* + Web panel; memberPersona injects workmate backing
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client (client.js = adopted agent-teams panel + the workmate library registered as a DSH-better-sidebar tab, with the bundle floater as fallback; built by scripts/build-mpd-client.mjs)
│   ├── mpd-ext-plugin/           # the extension interface (row `mpd-ext`, service `mpdExtensions`): frozen descriptor contract v1, code + data planes, lifecycle-split discovery (project per call = skills/flows only; user + bundle at apply = all four kinds), skills/flows providers, the runtime stdio MCP bridge (`mcp__<server>__<raw>` naming parity, connect-at-apply, two-phase swap with full rollback, keep-or-drop on the SCHEMA never the tool, object-root normalization of a foreign `inputSchema`), extension roles resolved per call by mpd-roles, the four inspection tools (mpd_ext_list/show, mpd_flow_list/show — including a catalog-backed `skillServing` check and `env` redaction) and the author SDK
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster (overlay-mounted)
├── extensions/                  # bundle-shipped extension discovery root: <bundle>/extensions/*/mpd-ext.json (host-wide plane, all four kinds) + the DISABLED reference extension mpd-ext-example (skill, flow, role, working dependency-free stdio MCP server)
├── skills/                      # skill corpus: dsh-qa (QA skill) + 16 ported upstream skills + svn-master (SERVED from the bundle by mpd-bootstrap; never copied to \$DSH_HOME)
├── tests/
│   ├── overlays/                 # QA patch overlays (keep empty when rows live in the bundle)
│   ├── golden/                   # golden fixtures + Prometheus plan artifacts
│   └── prompt-adaptation-log.md  # persona adaptation iterations
├── docs/                         # human-facing docs (BILINGUAL EN + zh-CN): index.md (hub) / user-guide.md / architecture.md / development.md; historical plan records (plan-*.md, decisions.md) and internal QA/golden reference docs (adder4.md, cnt8.md) are process records exempt from bilingual
└── evidence/                     # QA evidence: <domain>/<slug>/<timestamp>/ (records, language as produced)
```

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | any baseline/asset change; before release |
| Tests | `bun test` (per package) + `bun run typecheck` (root) | every plugin change |
| QA self-tests | `bun run test:qa` (all `--self-test`) | every plugin/QA-script change |
| QA real cases | `node skills/dsh-qa/scripts/<case>.mjs` | runtime-behavior changes |
| Installer | `node scripts/install-profile.mjs --dry-run` | any bundle-patch/installer change |
| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.mjs`; ships `--self-test` with a negative control; recursive under `docs/` and `extensions/**/README.md`, and it fails on a zh-only doc or an undocumented package) | any human-facing doc change (`README*.md`, `docs/**`, `packages/*/README*.md`, `extensions/**`); before release |
| Extension CLI | `bun scripts/mpd-ext.mjs --self-test` + `bun scripts/mpd-ext.mjs validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension MUST exit 1 with per-item errors) | any extension-interface/manifest/CLI change |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs` (host rows) and `node skills/dsh-qa/scripts/preset-conformance.mjs` (the `mpd` preset's standing mount + every harness-owned row config; its negative control proves the assertion is falsifiable), or the `full-profile-boot.sh` / `mount-proof.sh` pattern with registration instrumentation | any patch change, any preset/row change, and REQUIRED for any tool-schema change |

`--dump-config` is NOT this gate: it only COMPOSES rows and never executes plugin code, so a
schema/apply abort that takes the whole plugin tree down is invisible to it. Measured:
`dsh --profile mpd --dump-config` exited 0 with the `mpd-workmate` row present while the real
boot of the same profile could not load the tree; the decisive check was a mounting boot with
registration instrumentation (`WORKMATE_TOOLS` 7/7 ok, 0 apply-crash signatures) —
`evidence/workmate/rename-delete-core/20260910T131415Z-fullboot/full-boot.result.json` and
`…/20260910T132303Z-mount/mount-proof.result.json`, both carrying the note that no
`--dump-config` result is cited as load evidence. **`--dump-config` proves COMPOSITION ONLY —
never a plugin load.** Use it to check that rows/presets are composed and that an id-targeted
patch landed; never as a health signal for plugin code.

No evidence on disk for a gate = the change is not complete. Merge to dev only after the relevant
gates pass and their evidence is committed with the change.

---

## 5. Git Model (dev/release/defect separation)

| Branch | Purpose | Rules |
|---|---|---|
| `master` | release line | only release merges; never direct commits or pushes |
| `dev` | integration | feature/fix branches merge here; full gates must pass |
| `feature/<slug>` | capabilities | from dev, kebab-case, atomic commits + evidence |
| `fix/<slug>` | defects | from dev; one branch per defect; reproduction evidence + QA PASS before merge |
| `release/vX.Y.Z` | release prep | from dev; version/docs-only; merged to master with annotated tag |

- Commit format: `<type>(<scope>): <summary>` (feat/fix/docs/test/chore/release).
- Fixes cite the defect. Every defect branch is merged only after its evidence lands.
- Never rebase published branches; merge with `--no-ff` and a descriptive message.
- **ONE git writer per working tree — binding.** Teammates share the captain's checkout, so two
  writers race on the single `.git/HEAD`. Measured (2026-09-14): a member switched branches
  mid-command and its `reset HEAD~1` landed on `dev`, moving the tip back one commit; the
  captain's own `--soft HEAD~1` then hit `dev` instead of the branch it meant. Nothing was lost
  (the reflog held every step) but recovery cost a full forensics pass. Rules: a teammate NEVER
  runs `commit`/`add`/`checkout`/`switch`/`reset`/`stash`/`merge`/`branch`/`rebase`/`tag`; it
  edits files, runs gates and writes evidence, and the **captain alone** commits and branches —
  or the captain serializes ONE delegated writer and freezes everyone else first. Read-only
  `status`/`log`/`diff`/`show`/`grep` stay open to all. Tag a backup ref
  (`git tag backup/<branch>-<sha> <sha>`) before any history-writing step.
- **Attribution cannot come from the author field.** A shared checkout writes every commit under
  ONE configured identity, so attribute by task ownership + content + reflog ORDER, never by `%an`.
- **The captain's standing rules (user-set, 2026-09-16)** — instructions, not suggestions:
  1. **Archive the team as soon as its wave is merged** (`agent_teams_delete`). One team that keeps
     accumulating is what inflates the session's context and erases the wave boundary: the measured
     case reached **86 tasks across four waves**, after which one wave's seven fixes read as
     unrelated chores. Keep ONE team per wave, and end it when the wave lands.
  2. **Dispatch by WORKLOAD SIZE — size picks the EXECUTOR, it never decides "do it myself".**
     Team mode is NOT a precondition for using specialists: outside a team the MPD-native path is
     always available — `mpd_role_spawn` for a one-shot specialist and the workmate library
     (`mpd_workmate_*`) for an instance that accumulates across sessions. Size chooses WHICH
     executor: a small mechanical change goes to a Junior Engineer, a bounded independent piece to
     a Senior Engineer or Deep Worker, an evidence question to a Researcher or Explorer, a verdict
     to a Reviewer. The captain executes only what must not be delegated by rule — the single git
     writer, contract amendments and plan/roster shaping, releasing a watchdog hold, and the final
     integration — and does so without framing it as "working solo".
  3. **Keep requirement / task / review SEPARATE.** A dispatched piece of work gets a requirement
     task (the frozen acceptance contract), a work task and a review task rather than one lumped
     implementation task; finding-driven work uses `kind=repair` + `sourceTaskId`/
     `sourceFindingIds`, and `coverageOf` names the user clause a task serves — that is what turns
     the Web plan from a flat list into a requirement chain.

---

## 6. Plugin Authoring Guide

Structure per plugin package: `src/index.ts` (cordis `name`/`inject`/`apply`), `dist/index.js`
(bun build), `README.md`, optional `package.json` with `@mpd-dsh/<name>` naming.

- **Harness seams go through `mpd-dsh-adapter` — binding.** No plugin row may touch a
  harness service directly (`ctx.tools`, `ctx.subagents`, `ctx.skills`,
  `ctx.agentPresets`); `packages/mpd-dsh-adapter-plugin` is the ONE file allowed to,
  so a harness release that renames or reshapes a seam is absorbed there instead of
  across every plugin. Resolve it with
  `const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)`
  (`ctx.get("mpdDsh")` is the mounted instance; the fallback keeps a plugin standalone
  in unit tests). QA proves the surface: `bundle-lifecycle` asserts the row, the boot
  log line and the probe's `ADAPTER_SEAMS`/`ADAPTER_TOOL_CALL=ok`.
  **One documented exception:** `packages/mpd-agent-teams-plugin/lib` is adopted
  upstream main code (MIT) that keeps its own `ctx.*` calls. The refresh script
  `scripts/vendor-agent-teams.mjs` does **not** re-copy that tree: it rewrites bare
  import specifiers in place (`rewriteFile` writes back only when the text changed),
  its `rmSync`/`cpSync` work inside `_deps/`, and it asserts that OUR
  `packages/mpd-agent-teams-plugin/lib/index.js` still exists — so `lib/` survives a
  vendor run untouched. The risk is a **human re-vendor** (hand re-materializing the
  upstream tree over ours), which is exactly what the delta applier now makes loud:
  `scripts/patch-agent-teams-fixes.mjs` refuses to heal a file that still carries an
  upstream declaration a region would re-define, and `scripts/vendor-agent-teams.mjs`
  runs that guard with `--write` and exits 1 on refusal (wave-2 t15 measured the
  residual: on a hand re-materialize of `tools.js` a line-keyed anchor can still land a
  region one statement late — see the carry-forward list in the wave-2 report).
  **The local adaptations, transcribed from t4's authoritative enumeration**
  (`evidence/wave2/adopted-tooling/result.json`, `adaptation_list`) — the pre-existing
  six, only A1 of which this section used to name:

  | Id | File · function/line | Marker | Purpose |
  |---|---|---|---|
  | A1 | `lib/members.js` `installContinuableSetup` | no | Live-Setup guard / legacy `registerContinuableSetup` fallback |
  | A2 | `lib/members.js` `installMemberSelectionRuntime` | no | takes the live Agent from the harness payload, never `childCtx.agent` |
  | A3 | `lib/harness-compat.js:16` delivery probe | no | does not throw when no delivery contract exists; prefers the public `prompt` seam |
  | A4 | `lib/members.js:28-78,499` workmate persona injection | no | injects `~/.mpd/workmate` persona/memory (HOME resolved per call, name sanitized) |
  | A5 | `lib/session-start.js:355-396` notices + `evaluateComplexityGate` | region `mpd-delta session-start-gate` | gate wording ("routed by the complexity gate", never a mandatory team) + the frozen signal predicate |
  | A6 | `lib/client.js` export bridge region | region + own patcher | additive re-exports consumed by mpd client code (`scripts/patch-agent-teams-client.mjs`) |
  | D1 | `lib/quality-gates.js` `pathMatchesScope` + glob helpers | `mpd-delta scope-glob` | `**` crosses separators, `*`/`?` single segment |
  | D2 | `lib/quality-gates.js` `pathMatchesScopeNormalized` | `mpd-delta scope-glob-core` | B5 exact/dir-prefix kept bit-identical — **now merged into `scope-glob`** (post-t4, so a re-materialize cannot strand an upstream copy of the function) |
  | D3 | `lib/quality-gates.js` `contractContradiction` + `repairScopeFromFindings` | `mpd-delta contract-contradiction` | rejects an unsatisfiable contract; generates a contradiction-free repair scope that carves the required path out of the inherited `outOfScope`; hosts the B7 overlap relation (wave 4 fix) |
  | D4 | `lib/quality-gates.js` `planQualityFollowUp` scope build | `mpd-delta repair-scope` | routes the generated repair scope through D3 |
  | D5 | `lib/quality-gates.js` repair object scope fields | `mpd-delta repair-scope-fields` | spreads the generated scope onto the repair task |
  | D6 | `lib/tools.js` `agent_teams_task_contract` registration | `mpd-delta task-contract` | the read-only contract surface |
  | D7 | `lib/tools.js` `taskContractView` + `renderTaskContract` | `mpd-delta task-contract-render` | the view/render pair behind D6 |
  | D8 | `lib/mpd-deltas.js` | generated | registry of the regions, each keyed by a `beforeContext`/`afterContext` **CONTEXT PAIR** measured on the region-stripped skeleton — the wave-2 line-keyed `anchor`/`anchorOccurrence`/`anchorMarker` fields are GONE, and uniqueness is required at BOTH emit and heal time (regenerate with `--write-registry`, never hand-edit) |
  | D9 | `scripts/patch-agent-teams-fixes.mjs` | n/a | idempotent applier (`--check` / `--write` / `--write-registry`) |
  | D10 | `scripts/vendor-agent-teams.mjs` | n/a | invokes D9 with `--write` and exits 1 on refusal, so a vendor run cannot silently drop a delta |
  | D11 | `self-fix-tests/scope-glob-and-contract.test.mjs` | n/a | behaviour, guard-refusal and byte-fidelity tests |
  | D12 | `test/task-contract-tool.test.mjs` | n/a | tool-level readable-while-running tests |
  | D13 | `lib/tools.js` `agent_teams_update_task` contract text | `mpd-delta update-task-contract` | wave-3: `status` REQUIRED + the minimal terminal-call shape. **REPLACEMENT-shaped** (the upstream `description:` line sits INSIDE the block): after a re-materialize it is NOT self-healable — the heal REFUSES loudly, file byte-untouched, same class as `scope-glob` under F3; remedy = restore the region or re-author + `--write-registry`. |
  | D14 | `lib/tools.js` `agent_teams_update_task` `status` parameter | `mpd-delta update-task-required-status-param` | wave-3: an omitted `status` fails loudly at the tool boundary. **REPLACEMENT-shaped** for the same reason (the single top-level `status:` line) → a re-materialize REFUSES; it cannot silently duplicate the key (last-wins). |
  | D15 | `lib/tools.js` `agent_teams_update_task` attempt-id branch | `mpd-delta update-task-required-attempt-id` | wave-3: an omitted `attempt_id` says REQUIRED; the stale wording stays for a mismatch. **Purely ADDITIVE → DOES self-heal** after a re-materialize. |
  | D16–D18 | `lib/tools.js` `update_task` amend path | `mpd-delta update-task-amend-*` (4 regions) | wave-4: a member's `amend`, a terminal-task field change, and a `pending`-task amendment all used to do NOTHING silently (and `pending` was unreachable); loud now. ADDITIVE. |
  | D19–D20 | amend deadlock + member read-only deny | `mpd-delta update-task-amend-running`, `mpd-delta member-tool-deny-*` (5 regions) | wave-4: `kickTeam(...)` inside `withTeamLock(...)` self-deadlocked the tool (kick removed); a "read-only" TEAM member still held `write`/`edit`/`bash` (now `toolDeny` profile data → harness `toolFilter`). Proof: `evidence/agent-teams/{amend-lock-and-guards,defect-sweep}/`. |
  | D21–D22 | `lib/scheduler.js` pool capability guard | `mpd-delta pool-capability-guard` (ADDITIVE), `mpd-delta pool-capability-select` (**REPLACEMENT-shaped**) | v0.9.1: the pool branch of the selection had no capability test, so a read-only member was handed a pooled `implementation`/`repair` task it could not execute (measured twice: the read-only Architect and Reviewer). `nextCapableTask` keeps the member's OWN task first (explicit assignment still dispatches, loudly) and leaves a pooled task it cannot run IN THE POOL, logging once per (team, member, reason). Like D13/D14 the replacement REFUSES after a re-materialize; remedy = restore the region or re-author + `--write-registry`. Proof: `packages/mpd-agent-teams-plugin/self-fix-tests/pool-capability-guard.test.mjs`. |
  | D23–D26 | the team watchdog's PRESERVING hold, read from adopted code | `mpd-delta watchdog-hold-reader` (ADDITIVE, **2 regions**: `lib/tools.js` + `lib/scheduler.js` carry the same `watchdogHoldOf` helper), `mpd-delta claim-task-hold-guard`, `mpd-delta update-task-hold-guard`, `mpd-delta kick-member-hold-decline` | the team-watchdog wave: the claim / update / kick paths consult the watchdog's own `mpdWatchdog` service through cordis's inject-free `ctx.get(name, false)` lookup and DECLINE while that team is held, so a hold pauses dispatch without cancelling anything (adopted `inject` lists are not ours to change, which is why the lookup is inject-free). FAIL-OPEN (binding): with the watchdog row absent the service is `undefined`, the gate reads nothing, and dispatch behaves exactly as before — a hold-looking file on disk alone changes no decision. Proof: `evidence/team-watchdog/pause/20260915T164700Z/` + the heartbeat/fault lanes' preserving-pause cases. |

  The live registry is **53** regions across **9** adopted files (`--write-registry`, `--check` clean;
  D16–D20 are wave 4, D21–D22 are v0.9.1, D23–D26 are the team-watchdog wave — measured with
  `node scripts/patch-agent-teams-fixes.mjs --check`, 2026-09-16). **An `id` is a LOGICAL delta, not a
  registry key: one id may carry several regions when the same block is needed in several files** —
  `mpd-delta watchdog-hold-reader` is one such pair (the identical `watchdogHoldOf` helper, applied in
  `lib/tools.js` AND `lib/scheduler.js`, each with its own context pair), so a duplicate id is intended
  and uniqueness is required of the CONTEXT PAIR PER FILE, never of the id. **Addressing is by a CONTEXT PAIR, not a line key:** each entry carries the
  shortest `beforeContext`/`afterContext` windows measured on the region-STRIPPED skeleton that occur
  exactly once (k ≤ 6, the emitter FAILS rather than using a far-away anchor) and that bracket the seam
  from outside every region — so the heal is exact under ANY insertion history (wave-2's line-keyed
  anchors were order-dependent: `tools.js` healed to 60 diff lines). The applier also refuses an OLD
  anchor-format registry, a drifted orphan body, and a region that would re-declare a symbol the file
  still carries. Proof: `evidence/wave3/t5-verify/20260911T083206Z/` (strip BOTH files from the same
  state → one heal → 0 diff lines each) + the permanent suite
  `packages/mpd-agent-teams-plugin/self-fix-tests/registry-context-heal.test.mjs`. **Absolute line
  numbers are NOT part of any contract:** the canonical `mpd-delta task-contract` region moved
  1733 → **1757** when the wave-3 regions were inserted above it, and the heal keys on the context
  pair — re-read the registry after any region change instead of reusing a remembered line.
  **Two wave-2 driver scripts are deliberately UNPATCHED historical records:**
  `evidence/wave2/t10-review/20260911T063000Z/{guard-copy.mjs,guard-fullstrip.mjs}` still import the
  OLD anchor-format registry, so they now fail with the old-format refusal by design — a future
  reader must NOT "fix" them (editing them would rewrite evidence); write a new driver instead.
  Everything else — including every future mpd plugin — goes through the adapter.
- **Tools**: `dsh.registerTool({name, description, parameters, output:{schema, render}, execute})`.
  The adapter defaults `parameters` to an object-rooted schema and `output.render` to a
  text block, and always calls `execute(args, exec)` with objects. `parameters` is
  object-rooted JSON Schema; `output.schema` the canonical value contract; `render`
  returns `[{type:'text', text}]` blocks; `exec.signal` cancels.
- **Guards**: `dsh.guardTool(fn)` where `fn(exec) => string | undefined` (string denies).
  Keep guards monotonic and non-throwing; read only, never mutate.
- **Waterfalls**: `dsh.onPostToolExecute(async (exec, result, downstream) => decision | undefined)`;
  the adapter owns `next()`, so the listener only decides: return `{...downstream, content}`
  to replace, `undefined` to pass through. Accept with `{kind:'accept', content?}`, block
  with `{kind:'block', feedback}` (the harness key is `feedback`; `decision.block(reason)`
  builds it).
- **Subagents**: `dsh.spawnAgent({label, prompt, parent: exec.agent, signal: exec.signal,
  provider, model, outputSchema, persona, maxDepth, toolFilter})` → `{output, structured,
  stopReason}`. Flat `provider`/`model` and harness-shaped `agentOptions` both work, and
  `run.result` is awaited whether it is a promise or an object.
- **Internal tool calls**: `dsh.hasTool(name)` / `dsh.executeTool({name, arguments, callId?, signal?})`
  (→ `{ok, isError, value, error}`) — never `ctx.tools.get`/`ctx.tools.execute` directly.
- **Capability probing**: `dsh.capabilities()` reports one boolean per seam; degrade with a
  warning instead of aborting a plugin tree (a missing optional seam must never take the
  boot down — see the `registerContinuableSetup` guard in the adopted agent-teams plugin).
- **State**: workspace-scoped only (`.mpd/` under the **calling session's workspace**, never the
  dsh process cwd); never write `~/.dsh` from a plugin. Every plugin resolves that root through
  the ONE adapter helper — `dsh.workspaceRoot(exec)` with precedence
  **session header cwd → `DSH_WORKSPACE_ROOT` → `process.cwd()`** — plus `dsh.workspaceRootsAll()`
  (union of live session cwds, `[]` when the agent registry is absent) for agentless surfaces such
  as web routes. The session fact outranks the process-wide env because one host serves many
  sessions with different workspaces; an explicit row/config override (`boulder.dir`,
  `hashline.registryFile`, `memory.dir`, `ulw.planDir`, `config.projectFile`,
  `MPD_DSH_VERIF_VENV|WORK`) still wins over all of them. Resolve it PER CALL: never cache the root
  in a module-level const, never `chdir`, and never set `DSH_WORKSPACE_ROOT` from a row — each of
  those would "fix" one session by breaking the multi-session host. Evidence:
  `evidence/session-workspace-root/b1-resolution/`.
  Sanctioned exceptions: (1) the bundle writes NOTHING to the home any more — the
  `mpd-bootstrap` row serves `<bundle>/skills` through a `ctx.skills` provider and the
  bundle patch roots the `agent-presets` roster at `<bundle>/presets`, so both assets
  exist exactly while the bundle is installed (§8); the row only REMOVES the
  version-stamped copies that bundle `<= 0.2.6` wrote; (2) the **workmate library**
  (`mpd-workmate-plugin`) deliberately lives under the user's HOME (`~/.mpd/workmate`) —
  it is the user's cross-project, evolving agent library (QA must boot with
  `HOME=<sandbox>` so tests never touch the real home); (3) the **`mpd-codegraph`** plugin
  keeps its project index in `.codegraph/` under the workspace (upstream-mirrored second
  state root, gitignored — see `packages/mpd-codegraph-plugin/README.md`).
- **Build**: `bun build src/index.ts --target node --format esm --outfile dist/index.js`;
  zero runtime deps preferred (type-only imports).
- **Load/test**: the committed patch names rows as `@mpd-dsh/mpd/packages/...`, which
  resolve in BOTH install layouts (the repo root IS `@mpd-dsh/mpd`, so a checkout
  install resolves them through the link; the packed package resolves them through its
  own name). QA boots it straight from a checkout through the dev-flavor rewrite
  (`devPatch()` in `skills/dsh-qa/scripts/preset-register.mjs`: rename rows to
  checkout-absolute paths, rewrite the preset-root expression, pin MCP binaries via
  `MPD_DSH_*` env) because a QA sandbox has no installed profile.
  Do NOT keep a bundle row in a QA overlay while it is already in the bundle —
  the loader rejects duplicate entry ids.
- **Docstrings/comments**: English only.

---

## 7. QA Discipline (mirrors upstream, adapted)

- Skill: `skills/dsh-qa` (SKILL.md + case scripts + references). Every script ships `--self-test`.
- Isolation: `DSH_HOME=<mktemp>`; copy credentials ONCE into the sandbox; assert the sandbox path;
  never read/write real `~/.dsh`. Copy env prereqs (sg/codegraph paths) only when present.
  **`DSH_HOME`/`HOME` do NOT isolate WORKSPACE state — sandbox the workspace too.** Every
  workspace-scoped root resolves from the session workspace (`agent.session.header.cwd ?? process.cwd()`
  in the adopted agent-teams plugin; `dsh.workspaceRoot(exec)` in ours, where the session cwd outranks
  `DSH_WORKSPACE_ROOT`), so the env cannot protect a case. Every dsh spawn and every `session/create`
  payload carries an explicit sandbox cwd (`sandboxWorkspace(sandbox)` from
  `skills/dsh-qa/scripts/lib/workspace-isolation.mjs`) and each live case asserts that no
  `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists (`assertSessionsSandboxed`, e.g. no
  `--root-dshProj-my-power-dsh--`). Without it an "isolated" boot writes real
  `<repo>/.mpd/team/mpd-default-*` records — exactly the records the `mpd_workmate_rename/delete`
  in-use gate scans — plus `.mpd/{memory,boulder.json,hashline-files.json,verif,plans,ulw}` and
  `.codegraph`.
  **Skill roots leak through HOME**: the provider's user roots are `<DSH_HOME>/skills` (`user-dsh`)
  and `<agentsHome>/skills` (`user-agents`, `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`) — sandbox
  `HOME` too (2026-09-14: `SKILLS=24 BUNDLED=18` → probe FAIL).
  Live-LLM cases must ALSO copy `settings.yaml` when present: homes whose keys come from
  gateway providers (`llm-pi-ai` providers — opencode-go/scnet) configure the chain there, and
  without it headless falls back to the base `deepseek-official` route → `MISSING_CREDENTIAL`.
- Provability: assert a REAL tool result (never just "it ran"), or — for composition-only questions —
  `--dump-config` rows. `--dump-config` proves COMPOSITION ONLY and never a plugin load (§4): it does
  not execute plugin code, so it cannot witness an apply/schema abort. Anything about plugin BEHAVIOUR
  (a tool registered, a route answering, a schema accepted) needs a boot that MOUNTS the rows in an
  isolated `DSH_HOME` with registration instrumentation, or a real tool call.
- **A live case proves a tool call from the HARNESS's session log, never from the model's prose**
  (`skills/dsh-qa/scripts/lib/session-evidence.mjs`: `readSessionEvents` / `findToolCall` /
  `recordedToolNames`). The store is `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/` and — the
  trap — a CONCATENATED-ZSTD-FRAME container: one `zstdDecompressSync` returns the header frame
  ONLY, so a naive reader sees zero events and reports "no tool call" (a real artifact: 10 frames,
  1 vs 25 records). Decode frame by frame with the harness's own structure-only scan.
  `tool/call.data.name` + a non-error `tool/result` is tool evidence;
  `request/header.data.header.tools[]` is tool-list evidence. Asserting `/mcp__…/` against the
  ANSWER goes red when the model just reports the result and green when it merely names the tool —
  both measured (`codegraph-smoke`, `evidence/dsh-qa/codegraph/2026-09-14T08-56-10.102Z` false green,
  `…T14-45-59.644Z` false red).
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- **Preset/row conformance against the INSTALLED harness** (`preset-conformance`, required for any
  preset, patch or overlay change): a row config is validated with the installed plugin's own
  schemastery `Config`, because that is what the loader runs. Two failure modes exist and only one
  is loud: a MISSING REQUIRED key fails the row, and `dsh-agent-presets` then refuses to mount the
  whole preset (`agent-preset/invalid … row(s) did not activate`), while an UNKNOWN key is silently
  KEPT by schemastery — the row applies and quietly loses that setting. The case also pins the
  `mpd` preset's row set against the installed shipped `standard` preset: the harness moves rows
  between the host plane and the preset plane between releases (the Web overlay disables the host
  `tool-goal`/`command-goal`; `present` only exists from 0.1.5-alpha.2), so a missing row is a
  capability every mpd session loses. `--dump-config`, `agentPresets.list`/`resolve` and every
  `--self-test` that never creates a session are all blind to this class — only a real mount is not.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- **Verify on SETTLED hashes.** An edit/revert still landing is measurable: wave 2's first
  verification pass ran while a revert was in flight and measured a half-reverted tree (a failure
  that no longer existed minutes later). Pin the revision by hash, re-check it after a short settle
  window (wave 2 used 50 s), then run the contract — and anchor every verdict to the hashes you measured.
- Shell caveat: long-lived MCP children hold inherited fds — run dsh with stdio to FILES
  (`spawnSync` with `stdio: ['ignore', fd, fd]`) or background + log-file redirection, never pipes.

---

## 8. Installer & Profiles

### Primary flow: ONE command, no extra step

- **`cd <repo> && dsh plugin --profile web add .`** is the whole install. The repo root
  IS the bundle package: `package.json` is named `@mpd-dsh/mpd` and declares
  `dsh.bundle.patch` (`./packages/mpd-bundle/cordis.patch.yml`), `dsh.client`
  (`platform: web`), the `exports` map the rows resolve through (`./packages/*`,
  `./skills/*`, `./presets/*`, `./client`) and the toolchain `optionalDependencies`.
  `dsh plugin remove @mpd-dsh/mpd` is the matching one-command uninstall.
- Every path-bearing patch value resolves through the loader's `baseUrl` (the profile
  directory), so the same patch works for a checkout install (`node_modules/@mpd-dsh/mpd`
  → the repo) and for a packed install. The adopted `agent-teams` plugin is first-class
  main code at `packages/mpd-agent-teams-plugin` (no npm dependency); the `mpd` preset
  and the skill corpus are SERVED by reference (`agent-presets` root → `<bundle>/presets`,
  `mpd-bootstrap` → `<bundle>/skills`) — no home copy, so uninstall leaves no residue.
  Only user data stays: the workmate library under `~/.mpd/workmate`.
- **`node scripts/pack-mpd.mjs` (alias `npm run pack`) is the RELEASE step, not an install
  step.** It assembles the relocatable `dist/mpd-package/` for publishing / tarball
  installs (`dsh plugin --profile web add dist/mpd-package`): it copies the built plugin
  dists, the adopted agent-teams main code, `skills/` + `presets/`, the combined web
  client and the docs/licences, and writes the packed-form manifest + patch — and it
  refuses to ship a package with a missing `dist/`. A checkout install never needs it;
  run it when publishing, shipping a tarball, or testing relocation.
- **After a code change:** rebuild the touched package's `dist/` (`bun build …`) and
  restart dsh — a `link:` install reads the checkout directly. Re-pack only when the
  distribution artifact must be refreshed, and bump `package.json` version for releases.

### Dev/QA flow (legacy): `scripts/install-profile.mjs`

- `node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
  Default is `--dry-run`: print, never write. `--dsh-home` enables isolated QA installs.
- What it writes: profile manifest (base + web-app/headless), home `cordis.patch.yml` with absolute
  paths (existing rows id-targeted, new rows via `insert:`), presets → `$DSH_HOME/.agent-presets/`,
  toolchain if missing. Superseded by the packed bundle for user installs.
- Never run the installer against the real home from a QA context; that is what `--dsh-home` is for.

---

## 9. Vendor & Baseline

- `VENDOR_LOCK.json`: upstream commit/version/stats; per-asset `fileCount` + `sha256` (single file)
  or `treeSha` (dir, sorted relpath + per-file sha256). Item counts and fingerprints are blocking.
- Update policy: never chase upstream; a baseline change requires a deliberate branch + evidence.
- Vendored skill corpus: refresh as whole-dir replacements from upstream, keep provenance links.
- **`skills/**` has ONE writer per wave (single-skills-writer rule).** Every `skills/**` edit
  invalidates the corpus `treeSha` in `VENDOR_LOCK.json`, and the re-pin must land in the SAME
  commit as the change that invalidated it (§11). Two writers therefore force two coupled
  commits, a mid-wave re-pin, and a `verify-vendor` failure on anyone who commits in between.
  Serialize all `skills/**` edits of a wave through a single writer and re-pin exactly once;
  wave 3 has exactly one re-pin (t3), and that is the invariant a reviewer checks.

---

## 10. Security & Privacy

- Credentials: only ever copied into an ephemeral QA sandbox; never committed, logged, or echoed.
- Evidence logs must not contain secret material (api key values, tokens).
- License: SUL-1.0 (LICENSE.md): internal/personal use; distribution free & non-commercial only.

---

## 11. Release Process

1. From dev: `git checkout -b release/vX.Y.Z`; bump version (package.json + changelog note).
2. Full gate sweep: verify-vendor, bun test, typecheck, `test:qa`, real smoke (dual-track/mcp-call).
   - **Release-checklist line (VENDOR_LOCK pairing rule):** `VENDOR_LOCK.json` lands in the SAME
     commit as every `skills/**` change that invalidates its `treeSha`; with the single-skills-writer
     rule (§9) that is exactly ONE re-pin per wave — verify the wave's single re-pin is present and
     that no `skills/**` change is committed without it.
3. Merge `--no-ff` to master with `release: vX.Y.Z …`; annotated tag `vX.Y.Z`.
4. Push master + tag; announce with evidence links.

---

## 12. Troubleshooting (known)

| Symptom | Cause / fix |
|---|---|
| an adopted-plugin / plugin-module edit does not show up in a running session (e.g. `agent_teams_update_task` still answers with the pre-fix wording) | the module was loaded into the live process at session start — ESM caches it, so an edit on disk is NOT hot-reloaded. Measured wave 3: a member session kept the pre-fix diagnostic after the file was rewritten, while a fresh process and a fresh mounted boot registered the new contract (`evidence/wave3/t5-verify/20260911T083206Z/`). **Restart `dsh` before judging any plugin-module semantics on a live session** — neither the running session nor `--dump-config` reads the edited file. |
| a scratch file written under `/tmp` in an earlier bash call is gone in the next call | every bash tool call gets a FRESH `/tmp` (measured wave 3). Keep cross-call state inside the workspace (e.g. `<evidence>/…/raw/`) or finish the work in one call — never assume `/tmp` persistence between calls. |
| long background work started with `nohup … &` inside a bash call dies mid-run | the file sandbox is `bwrap --die-with-parent`, so a detached child is killed the moment the call that started it returns — visible as a half-written artifact plus a liveness check that lies (measured 2026-09-16: a `nohup`-ed 13-gate sweep died inside `bun test packages`, its summary frozen after two gates, while `pgrep -f run-sweep.sh` reported RUNNING because the probe's OWN command line contained the script name). Run long work as a MANAGED background job (the bash tool's `run_in_background`) and never with `nohup`; and when probing liveness, match a pattern your own command line cannot contain |
| a wave's `skills/**` change needs a SECOND `VENDOR_LOCK.json` re-pin | `skills/**` has ONE writer per wave and the re-pin rides in the SAME commit as the change that invalidated the corpus `treeSha` (§9, §11). Serialize every `skills/**` edit through one writer; re-pin exactly once |
| `agent_teams_update_task` "did not keep my status / my trailing field" on a long payload | the trailing key was never emitted by the model (wave-2 DEFECT 6, re-measured in wave 3: the raw provider fragment stream is byte-identical to the assembled arguments and the harness parse is a key-lossless `JSON.parse`, with no size cap anywhere). The tool now REQUIRES `status` on EVERY call — a payload-only update must repeat the current status explicitly — so the t6-style omission is refused loudly instead of silently leaving the task unchanged; an omitted `attempt_id` is reported as REQUIRED (never as a stale attempt). Field-proven shape: split a large payload into several small calls and end with a minimal `{task_id, status, attempt_id[, verdict]}` call. A model-side omission of `output`/`changedPaths` stays undetectable by the plugin — bound it by splitting. |
| `duplicate loader entry id` | same row in bundle patch and an overlay — remove from one |
| a plugin crashes with `cannot get property "x" without inject` / `... is not a function` | a harness seam changed shape — fix it in `packages/mpd-dsh-adapter-plugin/src/index.ts` only, rebuild, re-pack; plugin rows must not touch `ctx.tools`/`ctx.subagents`/`ctx.skills`/`ctx.agentPresets` directly (§6) |
| `MISSING_CREDENTIAL` in isolated QA | sandbox has no `.credentials.yaml` — copy it; live-LLM cases also need `settings.yaml` when the home uses gateway providers (see §7) |
| `patch: entry ... not found` | id-targeted row for a row absent in that profile — use `insert:` for new rows |
| a plugin change looks green in `--dump-config` but does nothing at runtime (tools missing, routes 404, or the whole tree dead) | `--dump-config` only COMPOSES rows — it never executes plugin code, so it cannot see an apply/schema abort (§4). Reproduce with a boot that MOUNTS the rows in an isolated `DSH_HOME` + sandbox `HOME` (registration instrumentation; `mount-proof.sh` or `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`) and read the boot log for the apply-crash signatures (`unsupported JSON schema`, `JsonSchemaError`, `plugin tree failed to load`, `failed to apply loader entry`). Measured instance: a `type: ["string","null"]` ARRAY (likewise `["string","array"]`) is REJECTED by this harness and takes the whole tree down; the accepted union spelling is `oneOf: [{type:"string"},{type:"null"}]` (or the `items:` variant), proven by booting. It stayed latent because this release asserts OUTPUT schemas only — never rely on that asymmetry: **a FUTURE instance gets its own scoped change with its own mount proof; do NOT "clean it up" inside an unrelated change** (`mpd_hashline_edit`'s `lines` parameter, proof `evidence/hashline/schema-union-fix/`). |
| codegraph `skipped: project excluded` | the project root contains an `.mpd` segment or is under /tmp — use a normal project path. Note the root itself: `mpd-codegraph` is the ONE workspace consumer that still resolves at APPLY time (§6 State), so it uses `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD` → `process.cwd()`, NOT the calling session's workspace — set the env override to index a specific project (routing it through the exec-less `dsh.workspaceRoot()` is a listed follow-up, `evidence/session-workspace-root/t8-verify/attempt-2/repair-t13/`) |
| ast-grep BINARY_NOT_FOUND | the bundle patch names no binary path (B8): each MCP row launches `packages/mpd-mcp-<name>/launch.mjs`, which resolves through the ONE shared resolver `packages/mpd-mcp-shared/bin-resolve.mjs` and sets the upstream env key only when the caller left it unset. Precedence: `MPD_AST_GREP_SG_PATH` → `MPD_AST_GREP_BIN_DIR` → `createRequire(<optionalDependency>)` → `<bundle>/.toolchain/node_modules/.bin/{ast-grep,sg}` → (unset) the adopted chain's own fallback. **The measured trap: in ast-grep 0.45.x the npm `sg` entry is a deprecated wrapper that FAILS `--version` (exit 1; the real binary is `ast-grep`, exit 0 printing `ast-grep 0.45.3`)**, so `ast-grep` is tried first in every tier and a candidate is accepted only when `--version` prints `ast-grep` — preferring `sg` silently ships a dead tool. Fix a failure by installing the toolchain (`--with-*` / `.toolchain`) or pointing `MPD_AST_GREP_SG_PATH` at an `ast-grep` binary, never at the wrapper |
| codegraph provision crash | **RESOLVED (wave 3 t4).** With no `.toolchain` and an unwritable `$HOME/.mpd` the provisioning path DIED with an uncaught `ENOENT: mkdir '<home>/.mpd/codegraph'` instead of degrading. Fixed LAUNCHER-SIDE in `packages/mpd-mcp-codegraph/launch.mjs`: catch, warn on stderr, pin `MPD_CODEGRAPH_BIN` to `/nonexistent/mpd-codegraph-unavailable`, retry ONCE → the adopted resolver serves an unavailable-but-alive surface (0 tools, exit 0). Proof: `evidence/wave3/codegraph-degrade-and-applytime/20260911T081649Z/`. |
| `[CodeGraph MCP] Shared daemon connection lost; … serving this session in-process (degraded)` on the CLI | **expected upstream fallback, REMOVED by default here.** The adopted server proxies to a per-project-root shared daemon (`<root>/.codegraph/daemon.{sock,pid}`); when it vanishes mid-session the session continues from its own engine (upstream #662). It vanishes because upstream reaps a daemon idle 30 min even with a client attached (`DEFAULT_MAX_IDLE_MS`), a `codegraph daemon` stop SIGTERMs it, or a PID-namespaced host reads a LIVE daemon's pid lock as stale. `packages/mpd-mcp-codegraph/daemon-policy.mjs` defaults our child to in-process (no daemon, no line; `.codegraph/codegraph.db` stays shared): `MPD_CODEGRAPH_DAEMON=1` restores upstream's daemon, `=0` is explicit, `CODEGRAPH_NO_DAEMON=1` is never overridden. Proof: `evidence/mpd-defects-2/`. |
| bash tool hangs after dsh | MCP children hold fds — stdio to files, or `setsid … > log` pattern |
| LSP daemon unreachable | `~/.mpd` unwritable/missing — on real home it self-starts |
| preset not visible in web | the bundle patch's `agent-presets` id-target row is not composed — check `dsh --profile web --dump-config` shows `id: agent-presets` with `default: mpd` + the `<bundle>/presets` root, and that `dsh.profile.bundles` contains `@mpd-dsh/mpd` |
| **EVERY mpd session fails to start**: `agent-preset/invalid: agent-presets: preset "mpd" failed to mount: failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config: - $.prefix missing required value (at prefix)` | the persona row's config no longer matches the installed harness. `dsh-persona` took ONE `text` key through 0.1.2-rc.1; from 0.1.3-alpha.2 it registers the deployment persona PREFIX/SUFFIX sections and `prefix` is REQUIRED, so a `text:` row fails the row and `dsh-agent-presets` refuses the WHOLE preset (`mountPreset` → `inactiveRows`). Fix: write the persona into `prefix:` (and `suffix:` only when a suffix is wanted). Measured 2026-09-11 (0.1.5-rc.1 CLI + rc.2 packages) by creating a session over the gateway (`POST /api/session/create` with `agentPreset: "mpd"`): red before the fix, green after. Gate: `node skills/dsh-qa/scripts/preset-conformance.mjs` |
| **a turn dies ~120 ms after `turn/start`, before the model call**: `turn/end {reason:{kind:"error",error:{message:"Cannot read properties of undefined (reading 'map')",code:"UNKNOWN"}}}` — the message differs by workspace state (`… (reading 'findLastIndex')` with a `.mpd/plans` artifact present, `… (reading 'length')` under `--profile headless`), and EVERY turn of EVERY mpd session in the process fails | **a listener on a cordis WATERFALL returned a value instead of calling `next()`**, so its return value REPLACED the value being composed. `EventsService.waterfall` runs listeners outermost-first with `next` appended (`(cbs.shift() ?? inner)(...args)`), so a listener that returns without `next()` VETOES the chain and its own return value becomes the decision. Measured instance (fixed 2026-09-16): the watchdog's `agent/pre-step` heartbeat was `(payload) => this.stamp("step", …)` — it returned a `HeartbeatStamp`, so the step decision became `{kind:"step",…}` with no `messages`, and the first consumer to read `decision.messages` (`agent-loop`'s `.length` check, the adopted policy's `.findLastIndex`, a `.map` in the assembly path) threw. Rule: on `agent/pre-step`, `agent/request`, `agent/request-error`, `fs/edit-intent`, `fs/write-intent` (the harness's waterfall events) a listener MUST `return next()` (or return `undefined` while still delegating, and contain its own failures — `subscribe`'s catch answers `undefined`, which is itself a veto). Pins: `bun test packages/mpd-team-watchdog-plugin/test/pre-step-waterfall.test.ts` (drives the real vendored cordis, with a negative control that re-enacts the retired shape) + the live BEFORE/AFTER driver `evidence/team-watchdog/pre-step-waterfall/20260916T010000Z/{drive.mjs,result.json,before-fix/}`. Why no lane saw it: every `team-watchdog-*.mjs` lane drives the built modules in-process and never spawns a real `dsh`, so no lane exercised a harness turn with the row mounted. |
| the compaction audit fills with identical `not-live` records and no member is ever compacted | **MEASURED 2026-09-16: 235 records / 2260 member entries, every one `skipped-not-live`, ZERO successes.** Two causes, both fixed in `packages/mpd-team-compact-plugin`: (1) every pass persisted a record, so ONE unreachable team produced 73 identical files in 30 hours — the audit is now WRITE-ON-CHANGE (`sameAuditOutcome`; repeats are counted into the next written record's `suppressed`; `force: true` overrides). (2) the only automatic trigger was `agent/status`, which fires when a continuable child has ALREADY been released — its Activation is process-local (`@deepseek-ai/dsh-subagent`: "Child session id → its live Activation. Process-local, never durable"), so the pass could only ever answer `not-live`. A second trigger now runs at the member's OWN turn boundary (`agent/turn-stopping` — a `serial` dispatch, so the listener returns `undefined` and contains its failures), which is the one moment the member is still resident. Records now carry the `caller` and the `liveAgentIds` the registry actually exposed, so "who keeps calling this?" is answerable from disk. |
| a healthy team is paused ~90 s after a member starts a long tool call (a build, a lane that boots `dsh`, a slow test) | r6: the heartbeat stamped on tool COMPLETION only, so a call longer than `warnSilenceMs` was indistinguishable from a wedge. The adapter's observe-only PRE hook (`onPreToolExecute` → `tools/pre-execute`) now stamps `tool-start` with the harness `callId`, the POST stamp closes it, and the silence predicate treats an OPEN call younger than `watchdog.toolInFlightMaxMs` (default 15 min, `0` disables) as explained activity. Past the bound the call is reported ONCE as a `tool-expired` incident (WARN-class: no scene, no hold, no escalate) - a member wedged INSIDE a tool is therefore reported, never paused. Both front doors render the knob (it is declared in `mpd-config-plugin`'s `SETTINGS_KNOBS` and in the Web card's `FIELDS`). Proof: `evidence/team-watchdog/long-tool-false-positive/20260916T015821Z/` |
| a preset/patch row applies but SILENTLY loses a setting (no error anywhere) | schemastery KEEPS unknown config keys, so a renamed/retired key (`persona:` on `dsh-system-prompt` — the schema says `personaPrefix`; `text:` on `dsh-persona`) is accepted and ignored, and the capability it configured simply never appears. Only a key the schema REQUIRES can fail loudly. Check every `@deepseek-ai/*` row against the INSTALLED schemas with `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` (it validates the preset, the bundle patch and the QA overlays, materializing `!!js` nodes) |
| an mpd session has no `present` tool, or the user's `/goal` does not resolve | the harness moves model-facing rows between the host plane and the preset plane between releases, and this preset is kept row-for-row equal to the shipped `standard` preset: the Web overlay disables the HOST `tool-goal` AND `command-goal` rows ("presets own the human command and model-facing tool"), and `present` only exists from 0.1.5-alpha.2. Add the missing row to `presets/mpd/agent.cordis.yml`; `preset-conformance --self-test` fails with the exact missing/extra row list against the installed `standard` preset |
| installed presets stale / agents miss tools (e.g. bash) | the profile points at an old bundle — for a checkout (`link:`) install rebuild the touched `dist/` and restart dsh; for a packed/registry install bump the version, `npm run pack`, `dsh plugin --profile <p> add dist/mpd-package` |
| `dsh plugin add .` says "declares no dsh.bundle" | you ran it outside the bundle package root — run it in the repo root (the manifest there IS `@mpd-dsh/mpd` with `dsh.bundle.patch`) |
| skills missing in a session | the corpus is served, not copied: check the boot log for `[mpd-bootstrap] skill corpus served from <bundle>/skills`; if absent the `mpd-bootstrap` row is not mounted (or its `dist/index.js` is stale — rebuild) |
| leftover `$DSH_HOME/skills` or `.agent-presets/mpd*` after upgrading from <=0.2.6 | the first 0.3.0 boot removes the stamped copies; unstamped copies (legacy `install-profile.mjs`) are left on purpose — delete them by hand |
| agent tool call fails with UNKNOWN_TOOL in code-mode deployments | the process-wide presentation switch is the HOST `tools` row `mode` (`native` \| `ptc` \| `both`; the Web overlay feeds it `DSH_TOOLS_MODE`), and under `ptc` the model may only call `run_code` directly — that is the deployment's choice, not a preset's. A preset that must PIN its own presentation carries one `@deepseek-ai/dsh-agent-tool-presentation` row (`{ mode }`, one per composition: it calls `ctx.tools.presentAs()` for the preset's scope); neither the shipped `standard` preset nor ours mounts one today, and the `mpd` preset is row-for-row parity-checked against `standard`, so adding it is a deliberate deviation |
| boot fails with ERR_MODULE_NOT_FOUND @nanmicoder/dsh-agent-teams | the legacy profile still pins the old bundle row; the row is now main code (`@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js`) — reinstall the bundle (`dsh plugin --profile <p> add dist/mpd-package`) |
| agent-teams: members never receive the second batch (captain reads "delivered via mailbox", member logs show only the spawn prompt), or `member initialization failed: cannot get property "agent" without inject` (captain has only a header, 11 members idle, `tasks: []`) | two measured defects, both fixed in `packages/mpd-agent-teams-plugin/lib`. (1) The Harness delivery seam drifted: `harness-compat.js` is the ONLY adaptation point and probes three generations in order — 0.1.5-rc.2+ `ctx.subagents.prompt(...)`, Alpha.2 receiver-bound `followup`, the Alpha.5…0.1.2-rc.1 symbol queue `Symbol.for('dsh.subagent.queuePrompt')` — preferring `prompt`; `sendMessage` only steers a RUNNING agent and must never carry team work. (2) Member setup read `childCtx.agent`, and an agent-scoped ctx is a Cordis proxy that THROWS on any property not in `inject` (there is no `agent` service — the host registers `agents`, id→Agent); the listener also fires for the captain's OWN `agent/session-start`, so one throw killed member init team-wide. Fix: `installContinuableMemberSetup` passes the live Agent from the harness payload (`setup(agent.ctx, agent)`; `installMemberSelectionRuntime` takes `hostChild ?? childCtx.agent` on the legacy path). Guards: `bun test packages/mpd-agent-teams-plugin/test/harness-compat.test.ts` (its fixture ctx throws on `.agent`) + `agent-teams-dispatch.mjs --self-test`. A headless captain must be HELD OPEN (the probe runs three `sleep 110` calls): one-shot `dsh --profile headless` disposes every continuable member at exit, so no idle edge fires and the scheduler never runs. |
| AGENT.md / AGENTS.md not injected into a session | the session runs a non-mpd preset; the `mpd` preset configures `instructionFileCandidates` (AGENT.md → AGENTS.md → CLAUDE.md) — switch the session to the `mpd` preset |
| a session has no team, or a `team:` prefixed prompt still shows `team:` in the goal text | **expected, not a bug.** The session-start rule is a GATE, not a mandate: `sessionTeamPolicy.mode` defaults to `off` (upstream parity — the upstream team mode ships disabled) and the decoupled `autoRoute` gate (default on) provisions a team only when `trigger = anyExplicitFlag OR (matchedSignals >= 1)` fires at the first pre-step — the RATIFIED Option A predicate (a satisfied C's own 2-of-3 bar suffices; accepted cost: a multi-clause prompt like "Check the test, build the package, verify the output." also routes). The `team:`/`!team` marker is CONSUMED by `consumeFlagFromMessage`. Do NOT restore an "every session runs in a team" invariant, and do not move the gate after the sizing doctrine — it must stay on the PRE-STEP so it can prevent a team. Predicates + prompt sets: `packages/mpd-agent-teams-plugin/lib/session-start.js` (frozen: `evidence/omo-align/requirements/frozen-contract.json`); case: `bun skills/dsh-qa/scripts/session-start-team.mjs` (>60 s). |
| `mpd_workmate_*` reports "mpdRoles service unavailable" | the `mpd-roles` plugin row is not mounted (e.g. a legacy install without the roster) — add the `mpd-roles` row (bundle patch / install-profile); the workmate plugin resolves the service lazily at tool-execute time |
| `mpd_workmate_rename` / `mpd_workmate_delete` is refused "is in use by …" (409 `in-use`) | the gate found a NON-archived team record under `<cwd>/.mpd/team/<teamId>/team.json` whose members include the workmate's key, or an `mpd_workmate_spawn` of it still running in this process. The refusal names every blocking `<teamId>/<member>`. Clear it by archiving (or retiring) those teams in the AgentTeams tab **and** letting the running spawn finish, then repeat. Consequence worth knowing: a record whose member is a roster name (e.g. `architect`) blocks that same key, so renaming a workmate *to* it is refused too. The gate is a READ-ONLY scan — never write `.mpd/team` to bypass it (that state belongs to the agent-teams plugin) |
| an archived workmate must come back | archive-first delete moved it to `~/.mpd/workmate/.archive/<key>-<stamp>/`, which is hidden from `list`/`match` by construction (no `meta.json` there, and `.archive` is not an addressable key). There is deliberately NO in-product restore: move the directory back with `mv ~/.mpd/workmate/.archive/<key>-<stamp> ~/.mpd/workmate/<key>` (the directory name IS the key) and it is listed again. A `purge` — `mpd_workmate_delete { name, purge: true, confirm: "<key>" }`, i.e. the same call plus the exact name — is unrecoverable, so a lost workmate can only be missing because it was purged |
| a workmate name is rejected (`400 invalid-name`) | names are ASCII-only, lower-case `[a-z0-9_-]`, and must already be in sanitized form: `Alice`, `my agent`, CJK names, `a/b`, `..` and `.archive` are all refused BEFORE any filesystem call (a superset of every key the library has ever written, so no existing instance becomes un-addressable). Pick an ASCII name; Unicode/CJK workmate names are a listed follow-up, not a bug. Renaming to the current key (including a case-only rename, which sanitizes to the same key) is refused with the same reason |
| the GUI/sidebar reports `cannot resolve target "<cwd>/team-activity": ENOENT … realpath '<cwd>/team-activity'` | the AgentTeams tab's auto-open passed a CONTENT SEED. From `dsh-better-sidebar` 0.19 a seed carrying `path` (or `url`) is routed to DSH's NATIVE right column (`surface.openResource(fileAddress(sessionId, cwd, path))`) instead of opening the registered tab type, so the throwaway marker path made the host resolve `<cwd>/team-activity`, fail `realpath`, and raise the error while the tab never opened at all (pre-0.19 used that seed only to expand a collapsed panel). Fix: seedless `openTab({ type: TEAM_ID })` in `packages/mpd-bundle-plugin/src/team-page.js`, then `node scripts/build-mpd-client.mjs` + re-pack. Gates: `bun test packages/mpd-bundle-plugin` and `node skills/dsh-qa/scripts/agent-teams-sidebar.mjs` (`seedlessAutoOpen` pins the shipped AND the served bytes) |
| a plugin web route answers 401 to a QA poll (e.g. `/plugins/dsh-agent-teams/state`) | **expected, not a bug**: the host authenticates every non-static route through a browser session and accepts the process launch token ONLY on `GET /?token=…` (the URL the boot log prints), minting an authority-bound signed cookie — no query token elsewhere, no header token. Exchange it once and poll with that `set-cookie` pair. Case: `team-route-rewire` (303 + cookie → 200) |
| the Workmates tab is missing from the DSH-better-sidebar tab strip | the tab is contributed at client-apply time through `ctx.betterSidebar.registerTab` — check the boot log/console for `[mpd] better-sidebar not installed` (the sidebar bundle is not composed) and that `packages/mpd-bundle-plugin/client.js` contains `SIDEBAR_TAB_ID = "mpd-workmate"` (rebuild with `node scripts/build-mpd-client.mjs`). A profile without that sidebar intentionally falls back to the bundle floater + sidebar-foot toggle, so the page is still reachable. `bun test packages/mpd-bundle-plugin/test/sidebar-tab.test.mjs` pins both hosts |
| web team/workmate panel never appears in the GUI | the bundle's web client has no loader entry named exactly `@mpd-dsh/mpd` — client-modules builds client rows from `ctx.loader.entries()` entry names, which come from patch rows' `name` field; keep the `mpd-web-compat` self-row (`name: '@mpd-dsh/mpd'`) and the bundle `main`/`exports["."]` pointing at `packages/mpd-bundle-plugin` (regenerate with `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs`) |
| the GUI shows a red "Failed to load plugins" banner: `web boot: 1 entry did not activate` / `@mpd-dsh/mpd: pending (waiting for service: X)` | the CLIENT half declared a service this harness release does not register — `assertEntriesActive` treats a declared-but-unregistered service as a fatal `pending` entry and the entire page fails to mount. Observed drift: `conversationEvents` (this harness speaks `conversationViews`) and `modelDirectories` (not mounted). Fix in `packages/mpd-bundle-plugin/src/web-client.js`: declare ONLY stable seams (`slots`, `locale`) and await drift-prone ones with `ctx.inject(deps, cb)` — it simply never runs when they are absent — wrap the optional mount in try/catch, then `node scripts/build-mpd-client.mjs` and reload the page. `web-client-adapt --self-test` asserts both rules |
| `mpd_role_spawn` reports unknown role | roles answer to their NAME (the team-mode member name: `Architect`, `Deep Worker`, `plan reviewer` — any case/space/hyphen spelling) — run `mpd_roles_list`. The upstream chain keys still RESOLVE (compatibility for chains, workmate records and legacy callers) but no surface advertises one. A spawn is LABELLED with the name, never `role-<id>-<random>` |
| the GUI lists a plugin under a foreign name (e.g. "oh-my-opencode") and `@mpd-dsh/mpd` is absent | that name is a real dependency of the profile (`<profile>/package.json`), NOT a rename of the bundle: a `link:` to the upstream oh-my-openagent CLI checkout declares no `dsh.bundle`, so it joins the layer stack as a plain dependency while our layer is gone. Inspect with `dsh --profile <p> --dump-config` (no `@mpd-dsh/mpd` rows) and `dsh.profile.bundles` in the profile manifest, then re-add the bundle in one command (`dsh plugin --profile <p> add <repo>`) |
| an extension never appears in `mpd_ext_list` | check the directory really holds `mpd-ext.json`, that it is a DIRECT child of one of the three roots (`<workspace>/.mpd/extensions`, `~/.mpd/extensions`, `<bundle>/extensions`), and that `dsh` was restarted — there is no reload tool by design. A rejected manifest is reported per item by `mpd_ext_list` / the CLI (`bun scripts/mpd-ext.mjs validate <dir>`) |
| an extension's MCP tools are missing after boot | `mpd_ext_show { id }` reports the server's exact state: `unavailable`/`failed` carry the child's stderr tail and the reason (an unreachable, hanging or immediately-exiting server is CONTAINED, never fatal), `disabled` means the extension or `extensions.mcp.enabled` is off. Only a tool whose **`inputSchema`** cannot be projected (or whose normalized object root would leave the subset) is skipped loudly; a `outputSchema` outside the subset costs that tool its `structuredContent` and keeps the tool, with the reason recorded — a foreign schema is never rewritten, and the harness's own `supportedOutputSchema` drops the schema the same way (v0.9.1 F1/F2) |
| a project-level extension's `mcp`/`roles` items were rejected | expected, not a bug: tool and skill-provider registration is process-global, so only the host-wide roots (`~/.mpd/extensions/`, `<bundle>/extensions/`) may contribute MCP servers and roles. Move the directory, or drop those kinds — the rejection is recorded per item, never silent and never a half-load |
| an extension role is missing from a team's member list | expected: extension roles are resolved per call by `mpd-roles` for `mpd_role_spawn` / `mpd_role_persona` (and as workmate base templates), but the agent-teams member list is static patch configuration |
| a task is stuck behind a dependency that FAILED | only `completed`/`cancelled` satisfy a dependency, so a `failed` slot pins every dependent FOREVER. **Retiring it as `cancelled` does NOT free them — the plugin releases a cancelled dependency's downstream by CANCELING it too** (measured 2026-09-14: cancelling one failed verification destroyed both of its dependents). Remedy: leave the failed slot as the honest record, and **create NEW downstream tasks that depend on the REPAIR + the closure VERIFICATION instead**. |
| task creation is refused `inScope overlaps <task> at <paths>` | the validator checks the new task's `inScope` against every OPEN sibling WRITE task. **Fixed in wave 4:** the relation was inverted (unrelated concrete paths "collided"; a parent scope did not collide with a file inside it), so the old remedy was naming an unrelated task as a DIRECT dependency. It is now a true may-two-writers-touch-it test — same path, parent-covers-child and glob-compatible pairs collide, different concrete paths are disjoint (`evidence/mpd-naming/verifier-contract/`: RED 10/11 pre-fix, GREEN 0). A refusal names a genuinely shared path, or the process predates the fix (restart `dsh`); a direct dependency still serializes, transitive ancestry still does NOT. |
| our rows vanish after an unrelated `pnpm install` / `dsh plugin add <other>` in the profile | profiles are pnpm projects: a manifest in which `@mpd-dsh/mpd` is not a dependency loses it on the next install, and a stale `node_modules/@mpd-dsh/mpd` symlink can survive as an orphan. `dsh plugin` only ever appends and only removes a layer it saw removed, so re-add BOTH entries at once (`dsh plugin --profile <p> add <other> <repo>`) and confirm the composed rows again. Never recompute `dsh.profile.bundles` from the dependency list — `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` are box bundles that are NOT dependencies and would be dropped (a hand-rolled reconcile must preserve the existing list and only append our name) |

---

## 13. Glossary

- DSH: DeepSeek Harness (host; cordis plugin architecture, web/headless profiles).
- bundle: npm package with `dsh.bundle.patch` patch layer (here: `mpd-bundle`).
- patch layer: id-targeted override or `insert:` list applied in order.
- preset: directory with `preset.yml` + `agent.cordis.yml` (agent-plane composition).
- roster: the specialist roster definitions (addressed by NAME; the stable `id` is an
  internal chain key, never advertised) served by
  `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona`); the same
  specialists are exposed as normal-named teammate instantiation templates through the
  adopted dsh-agent-teams `mpd` roster profile. The **read-only discipline is the exported
  deny list** — exactly seven names, identical in `mpd-roles-plugin` and
  `mpd-workmate-plugin` (asserted equal by `roles.test.ts`): `write`, `edit`,
  `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`,
  `mcp__lsp__rename`. `bash` is denied on purpose (a shell can write files), and
  `read`/`glob`/`grep` stay available. **Do NOT re-add `str_replace_editor` or
  `apply_patch`**: both were REMOVED because they are not registered in this profile —
  the harness validates the WHOLE list at spawn time and rejects the child when any single
  name is unknown, so one dead entry breaks every read-only spawn (an installed
  `dsh-tool-str-replace-editor` package or a `dsh-base` patch row is NOT proof of runtime
  registration, and `dsh --dump-config` composes rows without mounting them). Do not filter
  the list with `dsh.hasTool` either: it reads the global tool view, where `write`/`edit`/`bash`
  answer false, so filtering would silently DROP the entries that are the guarantee.
- workmate: a durable, evolving agent instance in `~/.mpd/workmate/` created by
  `mpd-workmate-plugin` (`mpd_workmate_*`) from a roster BASE template with an
  independent name; it self-summarizes after each work (persona + independent memory,
  size-capped) and keeps a short note card. Reuse is via `mpd_workmate_match`; weak
  matches must NOT be forced — initialize a new workmate instead. The tool surface is
  `mpd_workmate_list` / `mpd_workmate_init` / `mpd_workmate_spawn` / `mpd_workmate_reflect` /
  `mpd_workmate_match` / `mpd_workmate_rename` / `mpd_workmate_delete`; **the directory name
  IS the instance key** (`meta.name` is only a display mirror), which is what makes a rename
  a directory move and an interrupted one harmless. `delete` is archive-first
  (`~/.mpd/workmate/.archive/<key>-<stamp>/`, no in-product restore — recover by hand with
  `mv`), permanent only with `purge: true` + `confirm === name`; both mutations are refused
  while the workmate is in use and names are ASCII-only `[a-z0-9_-]`.
- mpd: our naming prefix (my-power-dsh).
- golden: graded benchmark task set in `tests/golden`.
