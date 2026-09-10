# AGENTS.md — my-power-dsh Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins. Agent-facing content in this
repository is English-only (see Language Policy).

**Language policy (binding):**
- Agent-facing content (this manual, code comments, QA scripts/logs) stays **English-only**.
- **Human-facing documentation is BILINGUAL**: every doc a person reads — `README.md`,
  `docs/*.md`, and every `packages/*/README.md` — ships BOTH an English file and a
  **简体中文** (`*.zh-CN.md`) translation. Both versions must exist and stay in sync.
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
  `docs/track-a-report.md`, `docs/ulw-deepseek-optimization.md`) — are process
  artifacts exempt from the bilingual requirement (see §3).

---

## 1. Overview & Provenance

**my-power-dsh** ports the portable capabilities of the upstream project (GitHub `code-yeongyu`;
provenance and inheritance are declared in `README.md`; base commit `8c57e46`, v5.0.0-beta.20)
into the DeepSeek Harness (DSH) as a plugin bundle. The capability baseline is pinned to upstream
`8c57e46` (v5.0.0-beta.20); upstream spec parity is the engineering target (see docs/feature-audit.md).
License: SUL-1.0 (`LICENSE.md`); inheritance declared in `README.md`.

- Upstream product names and repository paths stay upstream's (provenance only).
- Our naming prefix is **`mpd`** (my-power-dsh): packages, plugin ids, tool names (`mpd_*`),
  preset id (`mpd`), env keys (`MPD_DSH_*`), state dir (`.mpd`).
- **The OMO-origin agents are specialists and teammate templates, not presets**: the 11
  upstream roles ship as a specialist roster with normal display names —
  Architect (oracle), Researcher (librarian), Planner (prometheus), Deep
  Worker (hephaestus), Senior Engineer (sisyphus), Lead (atlas), Explorer
  (explore), Reviewer (metis), Plan Reviewer (momus), Vision Analyst
  (multimodal-looker), Junior Engineer (sisyphus-junior). The stable `id` is the
  modelchain chain key. One-shot consult via `mpd-roles-plugin`
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
  a new workmate instead). The ONLY
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
  `@nanmicoder/dsh-agent-teams` (MIT, v0.1.14) and ships as **first-class main code** at
  `packages/mpd-agent-teams-plugin/` (runtime closure under `_deps/`): it loads from the
  bundle exports map, so it needs no npm dependency and works under every install layout
  (pnpm never links a bundle's transitive deps into the profile root — see §12). See
  LICENSE-NOTICES.md. Its `stateDir` is overridden to `.mpd/team` so all our state stays
  under one `.mpd` root.

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
│   ├── build-mcp.mjs             # offline build of ast-grep/git-bash/lsp MCP servers
│   ├── bootstrap.mjs             # preflight + vendor check (P0-era, kept as checks)
│   ├── install-profile.mjs       # ONLY sanctioned writer to a user DSH_HOME (default dry-run)
│   ├── pack-mpd.mjs              # Plan D: assemble the relocatable installable bundle
│   ├── vendor-agent-teams.mjs    # materialize the adopted agent-teams plugin + closure
│   └── build-mpd-client.mjs      # build the combined bundle web client (client.js)
├── packages/
│   ├── mpd-bundle/               # cordis.patch.yml: llm dual-track, skills, MCPs, all mpd plugins
│   ├── mpd-dsh-adapter-plugin/   # THE single contact surface with harness seams (tools/subagents/skills/presets); every other plugin calls through it
│   ├── mpd-skills-plugin/ (removed)
│   ├── mpd-mcp-astgrep|gitbash|lsp|codegraph/
│   ├── mpd-roles-plugin/         # OMO-origin specialists: roster (roles.data.ts, normal names + stable ids) + personas/ + mpd_roles_list / mpd_role_spawn / mpd_role_persona + mpdRoles service
│   ├── mpd-tools-plugin/         # B1: write guard, truncation, edit-error recovery
│   ├── mpd-modelchain-plugin/    # B4: mpd_modelchain_resolve + mpd_memory_save/recall
│   ├── mpd-ulw-plugin/           # B3: mpd_ulw loop discipline
│   ├── mpd-codegraph-plugin/     # binary resolve + project init + mpd-codegraph command
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendor hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendor boulder-state)
│   ├── mpd-config-plugin/        # C7: minimal mpd.jsonc runtime config layer (consumed by the plugins above)
│   ├── mpd-comment-checker-plugin/ # C4: comment/docstring detection (opt-in binary)
│   ├── mpd-memory-plugin/        # C6: git/svn-backed memory + reflection state machine
│   ├── mpd-workmate-plugin/      # durable evolving agent library (~/.mpd/workmate): base→instance, self-reflect (persona+memory capped), short note, reuse via mpd_workmate_* (no forced weak matches)
│   ├── mpd-bootstrap-plugin/     # bundle provisioning BY REFERENCE: serves <bundle>/skills via the adapter; cleans legacy (<=0.2.6) home copies
│   ├── mpd-agent-teams-plugin/   # adopted dsh-agent-teams (MIT, first-class main code): agent_teams_* + Web panel; memberPersona injects workmate backing
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client (client.js = adopted agent-teams panel + workmate library floater; built by scripts/build-mpd-client.mjs)
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster (overlay-mounted)
├── skills/                      # skill corpus: dsh-qa (QA skill) + 17 ported upstream skills + svn-master + rtl-* (SERVED from the bundle by mpd-bootstrap; never copied to \$DSH_HOME)
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
| Boot check | `dsh --profile headless --dump-config` (isolated DSH_HOME) | any patch change |

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
  upstream main code (MIT) that a `scripts/vendor-agent-teams.mjs` refresh overwrites,
  so it keeps its own `ctx.*` calls; its only local adaptation is the
  `registerContinuableSetup` boot-safety guard in `lib/members.js`. Everything else —
  including every future mpd plugin — goes through the adapter.
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
- **State**: workspace-scoped only (`.mpd/` under cwd); never write `~/.dsh` from a plugin.
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
  Live-LLM cases must ALSO copy `settings.yaml` when present: homes whose keys come from
  gateway providers (`llm-pi-ai` providers — opencode-go/scnet) configure the chain there, and
  without it headless falls back to the base `deepseek-official` route → `MISSING_CREDENTIAL`.
- Provability: assert `--dump-config` rows, or assert real tool results (never "it ran").
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
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

---

## 10. Security & Privacy

- Credentials: only ever copied into an ephemeral QA sandbox; never committed, logged, or echoed.
- Evidence logs must not contain secret material (api key values, tokens).
- License: SUL-1.0 (LICENSE.md): internal/personal use; distribution free & non-commercial only.

---

## 11. Release Process

1. From dev: `git checkout -b release/vX.Y.Z`; bump version (package.json + changelog note).
2. Full gate sweep: verify-vendor, bun test, typecheck, `test:qa`, real smoke (dual-track/mcp-call).
3. Merge `--no-ff` to master with `release: vX.Y.Z …`; annotated tag `vX.Y.Z`.
4. Push master + tag; announce with evidence links.

---

## 12. Troubleshooting (known)

| Symptom | Cause / fix |
|---|---|
| `duplicate loader entry id` | same row in bundle patch and an overlay — remove from one |
| a plugin crashes with `cannot get property "x" without inject` / `... is not a function` | a harness seam changed shape — fix it in `packages/mpd-dsh-adapter-plugin/src/index.ts` only, rebuild, re-pack; plugin rows must not touch `ctx.tools`/`ctx.subagents`/`ctx.skills`/`ctx.agentPresets` directly (§6) |
| `MISSING_CREDENTIAL` in isolated QA | sandbox has no `.credentials.yaml` — copy it; live-LLM cases also need `settings.yaml` when the home uses gateway providers (see §7) |
| `patch: entry ... not found` | id-targeted row for a row absent in that profile — use `insert:` for new rows |
| codegraph `skipped: project excluded` | cwd contains an `.mpd` segment or is under /tmp — use a normal project path |
| codegraph provision crash | binary missing + read-only home — set `MPD_CODEGRAPH_BIN`/bundle env |
| bash tool hangs after dsh | MCP children hold fds — stdio to files, or `setsid … > log` pattern |
| ast-grep BINARY_NOT_FOUND | sg binary not installed — `.toolchain` via installer or `MPD_AST_GREP_SG_PATH` |
| LSP daemon unreachable | `~/.mpd` unwritable/missing — on real home it self-starts |
| preset not visible in web | the bundle patch's `agent-presets` id-target row is not composed — check `dsh --profile web --dump-config` shows `id: agent-presets` with `default: mpd` + the `<bundle>/presets` root, and that `dsh.profile.bundles` contains `@mpd-dsh/mpd` |
| installed presets stale / agents miss tools (e.g. bash) | the profile points at an old bundle — for a checkout (`link:`) install rebuild the touched `dist/` and restart dsh; for a packed/registry install bump the version, `npm run pack`, `dsh plugin --profile <p> add dist/mpd-package` |
| `dsh plugin add .` says "declares no dsh.bundle" | you ran it outside the bundle package root — run it in the repo root (the manifest there IS `@mpd-dsh/mpd` with `dsh.bundle.patch`) |
| skills missing in a session | the corpus is served, not copied: check the boot log for `[mpd-bootstrap] skill corpus served from <bundle>/skills`; if absent the `mpd-bootstrap` row is not mounted (or its `dist/index.js` is stale — rebuild) |
| leftover `$DSH_HOME/skills` or `.agent-presets/mpd*` after upgrading from <=0.2.6 | the first 0.3.0 boot removes the stamped copies; unstamped copies (legacy `install-profile.mjs`) are left on purpose — delete them by hand |
| agent tool call fails with UNKNOWN_TOOL in code-mode deployments | presets declare `tool-presentation { mode: native }` — every row tool (bash/read/edit/...) is exposed directly; in code mode the model may only call `run_code` directly |
| boot fails with ERR_MODULE_NOT_FOUND @nanmicoder/dsh-agent-teams | the legacy profile still pins the old bundle row; the row is now main code (`@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js`) — reinstall the bundle (`dsh plugin --profile <p> add dist/mpd-package`) |
| AGENT.md / AGENTS.md not injected into a session | the session runs a non-mpd preset; the `mpd` preset configures `instructionFileCandidates` (AGENT.md → AGENTS.md → CLAUDE.md) — switch the session to the `mpd` preset |
| `mpd_workmate_*` reports "mpdRoles service unavailable" | the `mpd-roles` plugin row is not mounted (e.g. a legacy install without the roster) — add the `mpd-roles` row (bundle patch / install-profile); the workmate plugin resolves the service lazily at tool-execute time |
| web team/workmate panel never appears in the GUI | the bundle's web client has no loader entry named exactly `@mpd-dsh/mpd` — client-modules builds client rows from `ctx.loader.entries()` entry names, which come from patch rows' `name` field; keep the `mpd-web-compat` self-row (`name: '@mpd-dsh/mpd'`) and the bundle `main`/`exports["."]` pointing at `packages/mpd-bundle-plugin` (regenerate with `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs`) |
| `mpd_role_spawn` reports unknown role | role ids are the roster ids (`oracle`, `sisyphus-junior`, `multimodal-looker`, …) — run `mpd_roles_list`; legacy `mpd-<id>` aliases are accepted |
| the GUI lists a plugin under a foreign name (e.g. "oh-my-opencode") and `@mpd-dsh/mpd` is absent | that name is a real dependency of the profile (`<profile>/package.json`), NOT a rename of the bundle: a `link:` to the upstream omo CLI checkout declares no `dsh.bundle`, so it joins the layer stack as a plain dependency while our layer is gone. Inspect with `dsh --profile <p> --dump-config` (no `@mpd-dsh/mpd` rows) and `dsh.profile.bundles` in the profile manifest, then re-add the bundle in one command (`dsh plugin --profile <p> add <repo>`) |
| our rows vanish after an unrelated `pnpm install` / `dsh plugin add <other>` in the profile | profiles are pnpm projects: a manifest in which `@mpd-dsh/mpd` is not a dependency loses it on the next install, and a stale `node_modules/@mpd-dsh/mpd` symlink can survive as an orphan. `dsh plugin` only ever appends and only removes a layer it saw removed, so re-add BOTH entries at once (`dsh plugin --profile <p> add <other> <repo>`) and confirm the composed rows again. Never recompute `dsh.profile.bundles` from the dependency list — `@deepseek-ai/dsh-base` / `@deepseek-ai/dsh-web-app` are box bundles that are NOT dependencies and would be dropped (a hand-rolled reconcile must preserve the existing list and only append our name) |

---

## 13. Glossary

- DSH: DeepSeek Harness (host; cordis plugin architecture, web/headless profiles).
- bundle: npm package with `dsh.bundle.patch` patch layer (here: `mpd-bundle`).
- patch layer: id-targeted override or `insert:` list applied in order.
- preset: directory with `preset.yml` + `agent.cordis.yml` (agent-plane composition).
- roster: the OMO-origin specialist definitions (stable id = modelchain chain key, normal
  display name, persona + model chain + read-only discipline) served by
  `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona`); the same
  specialists are exposed as normal-named teammate instantiation templates through the
  adopted dsh-agent-teams `mpd` roster profile.
- workmate: a durable, evolving agent instance in `~/.mpd/workmate/` created by
  `mpd-workmate-plugin` (`mpd_workmate_*`) from a roster BASE template with an
  independent name; it self-summarizes after each work (persona + independent memory,
  size-capped) and keeps a short note card. Reuse is via `mpd_workmate_match`; weak
  matches must NOT be forced — initialize a new workmate instead.
- mpd: our naming prefix (my-power-dsh).
- golden: graded benchmark task set in `tests/golden`.
