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
  `mpd-agent-teams-plugin/README.md`) are exempt and stay untouched.

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
├── package.json / tsconfig.json  # root scripts: build/test/typecheck/test:qa/verify:vendor
├── scripts/
│   ├── verify-vendor.mjs         # blocking vendor gate (commit/version/count/sha/treeSha)
│   ├── build-mcp.mjs             # offline build of ast-grep/git-bash/lsp MCP servers
│   ├── bootstrap.mjs             # preflight + vendor check (P0-era, kept as checks)
│   ├── install-profile.mjs       # ONLY sanctioned writer to a user DSH_HOME (default dry-run)
│   ├── pack-mpd.mjs              # Plan D: assemble the relocatable installable bundle
│   ├── vendor-agent-teams.mjs    # materialize the adopted agent-teams plugin + closure
│   └── gen-roles.mjs             # regenerate the OMO roster data/personas (mpd-roles-plugin)
├── packages/
│   ├── mpd-bundle/               # cordis.patch.yml: llm dual-track, skills, MCPs, all mpd plugins
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
│   ├── mpd-bootstrap-plugin/     # bundle provisioning: the mpd main preset (presets/mpd/) + skills copy to $DSH_HOME
│   ├── mpd-agent-teams-plugin/   # adopted dsh-agent-teams (MIT, first-class main code): agent_teams_* + Web panel; memberPersona injects workmate backing
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client (client.js = adopted agent-teams panel + workmate library floater; built by scripts/build-mpd-client.mjs)
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster (overlay-mounted)
├── skills/                      # skill corpus: dsh-qa (QA skill) + 17 ported upstream skills + svn-master (installed to \$DSH_HOME/skills by mpd-bootstrap)
├── tests/
│   ├── overlays/                 # QA patch overlays (keep empty when rows live in the bundle)
│   ├── golden/                   # golden fixtures + Prometheus plan artifacts
│   └── prompt-adaptation-log.md  # persona adaptation iterations
├── docs/                         # internal docs (English): index.md (hub) / user-guide.md / architecture.md / development.md + plan records
└── evidence/                     # QA evidence: <domain>/<slug>/<timestamp>/ (records, language as produced)
```

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | any baseline/asset change; before release |
| Tests | `bun test` (per package) + `bun run typecheck` | every plugin change |
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

- **Tools**: `ctx.tools.register({name, description, parameters, output:{schema, render}, execute})`.
  `parameters` is object-rooted JSON Schema; `output.schema` the canonical value contract; `render`
  returns `[{type:'text', text}]` blocks. `execute` receives `(args, exec)` with
  `exec.signal` for cancellation.
- **Guards**: `ctx.tools.guard(fn)` where `fn(exec) => string | undefined` (string denies).
  Keep guards monotonic and non-throwing; read only, never mutate.
- **Waterfalls**: `ctx.on('tools/post-execute', async (exec, result, next) => decision)`;
  accept with `{kind:'accept', content?}`, block with `{kind:'block', reason?}`.
- **Subagents**: `ctx.subagents.start('spawn', {label, prompt:[{type:'text',text}], parent: exec.agent,
  signal: exec.signal, agentOptions:{provider,model}, outputSchema, persona, maxDepth, toolFilter})`
  → `run.result` (`{output, structured, stopReason}`).
- **State**: workspace-scoped only (`.mpd/` under cwd); never write `~/.dsh` from a plugin.
  Sanctioned exceptions: (1) the `mpd-bootstrap` provisioning row at boot copies the
  bundle's `mpd` preset into `$DSH_HOME/.agent-presets/` and the skill corpus into
  `$DSH_HOME/skills` (idempotent, version-stamped — see §8); (2) the **workmate library**
  (`mpd-workmate-plugin`) deliberately lives under the user's HOME (`~/.mpd/workmate`) —
  it is the user's cross-project, evolving agent library (QA must boot with
  `HOME=<sandbox>` so tests never touch the real home).
- **Build**: `bun build src/index.ts --target node --format esm --outfile dist/index.js`;
  zero runtime deps preferred (type-only imports).
- **Load/test**: the committed bundle patch ships in PACKED form (`@mpd-dsh/mpd/...` —
  resolvable only in an installed profile). QA boots it from a checkout through the
  dev-flavor rewrite (`devPatch()` in `skills/dsh-qa/scripts/preset-register.mjs`:
  rename rows to checkout-absolute paths, pin MCP binaries via `MPD_DSH_*` env).
  Do NOT keep a bundle row in a QA overlay while it is already in the bundle —
  the loader rejects duplicate entry ids.
- **Docstrings/comments**: English only.

---

## 7. QA Discipline (mirrors upstream, adapted)

- Skill: `skills/dsh-qa` (SKILL.md + case scripts + references). Every script ships `--self-test`.
- Isolation: `DSH_HOME=<mktemp>`; copy credentials ONCE into the sandbox; assert the sandbox path;
  never read/write real `~/.dsh`. Copy env prereqs (sg/codegraph paths) only when present.
- Provability: assert `--dump-config` rows, or assert real tool results (never "it ran").
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- Shell caveat: long-lived MCP children hold inherited fds — run dsh with stdio to FILES
  (`spawnSync` with `stdio: ['ignore', fd, fd]`) or background + log-file redirection, never pipes.

---

## 8. Installer & Profiles

### Primary flow (Plan D): one-plugin install, fully relocatable

- `node scripts/pack-mpd.mjs` assembles the installable bundle `dist/mpd-package/`
  (npm package `@mpd-dsh/mpd`, `dsh.bundle.patch`), with NO checkout-absolute paths:
  plugin rows use the resolvable `name: '@mpd-dsh/mpd/packages/...'`, every path-bearing
  value uses the loader's `baseUrl` (the profile directory), binaries come from the
  package's `optionalDependencies` (`@ast-grep/cli`, `@colbymchenry/codegraph`),
  the adopted `agent-teams` plugin is first-class main code at
  `packages/mpd-agent-teams-plugin` (no npm dependency), the `mpd` preset + skill corpus
  auto-copy at boot via
  `mpd-bootstrap` (version-stamped, idempotent).
- Install from a checkout: `cd <repo> && dsh plugin --profile web add .`
  (or from a published location — the patch never names this repo).

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
| `MISSING_CREDENTIAL` in isolated QA | sandbox has no `.credentials.yaml` — copy it |
| `patch: entry ... not found` | id-targeted row for a row absent in that profile — use `insert:` for new rows |
| codegraph `skipped: project excluded` | cwd contains an `.mpd` segment or is under /tmp — use a normal project path |
| codegraph provision crash | binary missing + read-only home — set `MPD_CODEGRAPH_BIN`/bundle env |
| bash tool hangs after dsh | MCP children hold fds — stdio to files, or `setsid … > log` pattern |
| ast-grep BINARY_NOT_FOUND | sg binary not installed — `.toolchain` via installer or `MPD_AST_GREP_SG_PATH` |
| LSP daemon unreachable | `~/.mpd` unwritable/missing — on real home it self-starts |
| preset not visible in web | presets not installed to `$DSH_HOME/.agent-presets/` — run installer |
| installed presets stale / agents miss tools (e.g. bash) | `mpd-bootstrap` only re-copies presets when the package VERSION changes — bump `package.json` version, `node scripts/pack-mpd.mjs`, restart dsh |
| agent tool call fails with UNKNOWN_TOOL in code-mode deployments | presets declare `tool-presentation { mode: native }` — every row tool (bash/read/edit/...) is exposed directly; in code mode the model may only call `run_code` directly |
| boot fails with ERR_MODULE_NOT_FOUND @nanmicoder/dsh-agent-teams | the legacy profile still pins the old bundle row; the row is now main code (`@mpd-dsh/mpd/packages/mpd-agent-teams-plugin/lib/index.js`) — reinstall the bundle (`dsh plugin --profile <p> add dist/mpd-package`) |
| AGENT.md / AGENTS.md not injected into a session | the session runs a non-mpd preset; the `mpd` preset configures `instructionFileCandidates` (AGENT.md → AGENTS.md → CLAUDE.md) — switch the session to the `mpd` preset |
| `mpd_workmate_*` reports "mpdRoles service unavailable" | the `mpd-roles` plugin row is not mounted (e.g. a legacy install without the roster) — add the `mpd-roles` row (bundle patch / install-profile); the workmate plugin resolves the service lazily at tool-execute time |
| web team/workmate panel never appears in the GUI | the bundle's web client has no loader entry named exactly `@mpd-dsh/mpd` — client-modules builds client rows from `ctx.loader.entries()` entry names, which come from patch rows' `name` field; keep the `mpd-web-compat` self-row (`name: '@mpd-dsh/mpd'`) and the bundle `main`/`exports["."]` pointing at `packages/mpd-bundle-plugin` (regenerate with `node scripts/build-mpd-client.mjs && node scripts/pack-mpd.mjs`) |
| `mpd_role_spawn` reports unknown role | role ids are the roster ids (`oracle`, `sisyphus-junior`, `multimodal-looker`, …) — run `mpd_roles_list`; legacy `mpd-<id>` aliases are accepted |

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
