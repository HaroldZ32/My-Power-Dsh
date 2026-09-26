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

## Reference Index (on-demand)

The manual's bulk reference material lives in `agent-references/` — **agent-facing, English-only**
files (the bilingual rule above covers human-facing docs only; `bun run verify:docs` does not
discover this tree). They are deliberately NOT named `AGENT.md` / `AGENTS.md` / `CLAUDE.md`, so the
workspace instruction loader never injects them: **open them on demand** when a pointer here or in
a section sends you there. `§1`–`§13` of this manual stay in place, so every `§N` citation from
code, scripts and docs still resolves.

| File | Holds | Open it when |
|---|---|---|
| `agent-references/troubleshooting.md` | the full symptom → cause/fix table (the former body of §12, moved verbatim 2026-09-17 by the T-22 instruction-budget split) | a boot, gate, tool or team behaviour is wrong — look the symptom up before inventing a fix |
| `agent-references/agent-teams-deltas.md` | the adopted agent-teams delta registry: the A1–D26 adaptation table, the registry mechanics (context-pair addressing, `--write-registry`), the live region count and the two unpatched wave-2 driver scripts | you touch `packages/mpd-agent-teams-plugin/**`, `scripts/patch-agent-teams-fixes.mjs`, `scripts/vendor-agent-teams.mjs`, or an `mpd-delta` region |

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
├── agent-references/             # ON-DEMAND agent-facing reference (English-only, NOT auto-injected; index in the manual's "Reference Index (on-demand)"): troubleshooting.md (former §12 body) + agent-teams-deltas.md (former §6 delta registry)
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
  **The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`**
  (open it on demand — it is not auto-injected): that file carries the authoritative A1–D26
  adaptation table (`evidence/wave2/adopted-tooling/result.json`, `adaptation_list`), the registry
  mechanics, the live region count and the wave-2 driver-script warning. Two rules from it stay
  binding here: (a) the registry is **derived** — regenerate it with `--write-registry`, never
  hand-edit an entry; (b) the **REPLACEMENT-shaped** deltas (the D13/D14/D21/D22 class) do **not**
  self-heal after a human re-materialize — the applier REFUSES loudly, file byte-untouched, and the
  remedy is to restore the region or re-author it plus `--write-registry`.

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

The full symptom → cause/fix table lives in **`agent-references/troubleshooting.md`** (open it on
demand — it is not auto-injected; see the Reference Index at the top of this manual). It is the
former body of this section, moved verbatim on 2026-09-17 by the T-22 instruction-budget split; the
moved bytes are hash-verified under `evidence/gates/agents-budget/`. Covered there: the ESM-restart
trap, the fresh-`/tmp` and `nohup` rules, the single `skills/**` writer + one-`VENDOR_LOCK.json`
re-pin rule, the `update_task` `status`/`attempt_id` contract, `--dump-config` vs a mounting boot,
schema-union boot failures, credential/sandbox traps, the codegraph daemon policy, the preset-plane
row-drift class, agent-teams dispatch defects, the failed-dependency pinning trap, the
`inScope overlaps` validator, and profile-row loss after an unrelated install.


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
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
