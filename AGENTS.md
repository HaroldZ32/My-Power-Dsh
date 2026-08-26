# AGENTS.md — my-power-dsh Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins. Agent-facing content in this
repository is English-only (see Language Policy).

---

## 1. Overview & Provenance

**my-power-dsh** ports the portable capabilities of **oh-my-openagent** (upstream, GitHub
code-yeongyu/oh-my-openagent; base commit `8c57e46`, v5.0.0-beta.20) into the DeepSeek Harness
(DSH) as a plugin bundle. The capability baseline is pinned to oh-my-openagent `8c57e46` (v5.0.0-beta.20); OMO-spec parity is the engineering target (see docs/feature-audit.md). License: SUL-1.0 (`LICENSE.md`); inheritance declared in `README.md`.

- Upstream product names and repository paths stay upstream's (provenance only).
- Our naming prefix is **`mpd`** (my-power-dsh): packages, plugin ids, tool names (`mpd_*`),
  preset ids (`mpd-oracle` …), env keys (`MPD_DSH_*`), state dir (`.mpd`).
- **Upstream binary-resolution env keys must NOT be renamed**: `OMO_AST_GREP_SG_PATH` (sg resolver)
  and `OMO_CODEGRAPH_BIN` (codegraph serve) are read by upstream vendored code.
- DSH plugin names (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the
  host's API and are never renamed.
- **Adopted third-party plugins keep their vendor ids and tool names** (intentional namespace
  exception, same rule as the `context7`/`grep_app` remote MCP rows): the `agent-teams`
  plugin (tools `agent_teams_*`, Web activity panel) is adopted from
  `@nanmicoder/dsh-agent-teams` (MIT) — see LICENSE-NOTICES.md. Its `stateDir` is overridden
  to `.mpd/team` so all our state stays under one `.mpd` root.

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
│   └── install-profile.mjs       # ONLY sanctioned writer to a user DSH_HOME (default dry-run)
├── packages/
│   ├── mpd-bundle/               # cordis.patch.yml: llm dual-track, skills, MCPs, all mpd plugins
│   ├── mpd-skills-plugin/        # vendored OMO skills (SKILL.md corpus)
│   ├── mpd-mcp-astgrep|gitbash|lsp|codegraph/
│   ├── mpd-presets-plugin/       # preset dirs mpd-oracle|mpd-librarian|mpd-prometheus|mpd-hephaestus
│   ├── mpd-tools-plugin/         # B1: write guard, truncation, edit-error recovery
│   ├── mpd-modelchain-plugin/    # B4: mpd_modelchain_resolve + mpd_memory_save/recall
│   ├── mpd-ulw-plugin/           # B3: mpd_ulw loop discipline
│   ├── mpd-team-plugin/          # B2: mpd_team_spawn / mpd_team_status
│   ├── mpd-codegraph-plugin/     # binary resolve + project init + mpd-codegraph command
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendor hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendor boulder-state)
│   ├── mpd-config-plugin/        # C7: minimal mpd.jsonc runtime config layer
│   ├── mpd-comment-checker-plugin/ # C4: comment/docstring detection (opt-in binary)
│   ├── mpd-memory-plugin/        # C6: git/svn-backed memory + reflection state machine
│   └── mpd-qa-preset-probe/      # QA-only preset probe plugin
├── skills/dsh-qa/                # QA skill: SKILL.md + scripts (each with --self-test) + references/
├── tests/
│   ├── overlays/                 # QA patch overlays (keep empty when rows live in the bundle)
│   ├── golden/                   # golden fixtures + Prometheus plan artifacts
│   └── prompt-adaptation-log.md  # persona adaptation iterations
├── docs/                         # internal docs (English)
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
- Remote (Gitee) sync uses the same model: feature/* → dev → release/v* → master (tags).
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
- **State**: workspace-scoped only (`.mpd/` under cwd); never write `~/.dsh` from a plugin
  (the installer is the only sanctioned writer).
- **Build**: `bun build src/index.ts --target node --format esm --outfile dist/index.js`;
  zero runtime deps preferred (type-only imports).
- **Load/test**: add to bundle patch (insert row with absolute path here; npm packaging later uses
  `@mpd-dsh/<pkg>`). Do NOT keep the same row in a QA overlay while it is already in the bundle —
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

- `node scripts/install-profile.mjs --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
  Default is `--dry-run`: print, never write. `--dsh-home` enables isolated QA installs.
- What it writes: profile manifest (base + web-app/headless), home `cordis.patch.yml` with absolute
  paths (existing rows id-targeted, new rows via `insert:`), presets → `$DSH_HOME/.agent-presets/`,
  toolchain if missing.
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
- Gitee pushes use the per-command `http.extraheader` token approach; no token in `.git/config`,
  no token in commit messages. Revoke tokens if leaked.
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
| codegraph `skipped: project excluded` | cwd contains an `.omo` segment or is under /tmp — use a normal project path |
| codegraph provision crash | binary missing + read-only home — set `OMO_CODEGRAPH_BIN`/bundle env |
| bash tool hangs after dsh | MCP children hold fds — stdio to files, or `setsid … > log` pattern |
| ast-grep BINARY_NOT_FOUND | sg binary not installed — `.toolchain` via installer or `OMO_AST_GREP_SG_PATH` |
| LSP daemon unreachable | `~/.omo` unwritable/missing — on real home it self-starts |
| preset not visible in web | presets not installed to `$DSH_HOME/.agent-presets/` — run installer |

---

## 13. Glossary

- DSH: DeepSeek Harness (host; cordis plugin architecture, web/headless profiles).
- bundle: npm package with `dsh.bundle.patch` patch layer (here: `mpd-bundle`).
- patch layer: id-targeted override or `insert:` list applied in order.
- preset: directory with `preset.yml` + `agent.cordis.yml` (agent-plane composition).
- mpd: our naming prefix (my-power-dsh).
- golden: graded benchmark task set in `tests/golden`.
