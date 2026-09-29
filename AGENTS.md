# AGENTS.md — my-power-dsh Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins. Agent-facing content in this
repository is English-only (see Language Policy).

**Language policy (binding):**
- Agent-facing content (this manual, code comments, QA scripts/logs) stays **English-only**.
- **Human-facing documentation is BILINGUAL**: every doc a person reads — `README.md`, `docs/*.md`,
  and every `packages/*/README.md` — ships BOTH an English file and a **简体中文** (`*.zh-CN.md`)
  translation, and every bilingual doc carries its language switch link directly under the title
  (`[中文](./<name>.zh-CN.md)` from the English file, `[English](./<name>.md)` from the Chinese one).
  A change to one updates BOTH in the same commit.
- The policy is executable: `bun run verify:docs` (`scripts/verify-docs-parity.ts`, which ships
  `--self-test` with a negative control) enforces the pair, the switch link, the heading tree, real
  CJK content and the RESOLUTION of relative link targets across the band it discovers — every `*.md`
  under `docs/` at any depth, `extensions/**/README.md`, `templates/**/README.md`,
  `packages/*/README.md` and the root README. A `./`- or `../`-spelled target resolves from the
  LINKING file's own directory, a ROOT-relative `/`-spelled one against the REPO ROOT (`/docs/index.md`
  means `docs/index.md` in this tree, never the filesystem root), a `#fragment` is stripped first, and
  a directory counts (external URLs, in-page anchors and code spans are ignored); a zh-CN doc with no
  EN twin, a non-exempt package with no README and an unresolved target are violations. Classification
  is DECLARED, not directory-sensitive: a `*.md`
  carrying `<!-- docs-parity: doc -->` is a doc wherever it lives, so a misplaced doc reddens instead
  of escaping. A file kept VERBATIM as provenance is exempt from the link check too (its dead targets
  are reported as EXEMPT, never as passes), and in a packed copy with no root `AGENTS.md` an
  unresolved target is a NOTE rather than a failure (T-75).
- **The agent-facing band is deliberately OUT of that discovery.** `agent-references/**` is
  agent-facing content, so it is English-only and ships no `*.zh-CN.md` twin; the docs gate does not
  discover that tree (T-28). Read this as a POLICY SENTENCE, not an omission: an English-only agent
  document belongs OUTSIDE `docs/` — never inside a band whose every `*.md` is policed.
- **A lone file exempts ITSELF, not by a hand-maintained list.** The gate derives the process-record
  exemptions from the file: a doc carrying `<!-- docs-parity: exempt <reason> -->` is reported with
  that reason, and the same doc without the marker is a normal policed file (T-30). The policy classes
  named BY GLOB (`docs/plan-*.md`) stay a declared pattern, and the two ANTICIPATORY paths
  (`docs/adder4.md`, `docs/cnt8.md`) are kept by design and printed as their own class, so an
  exemption for a file that does not exist can never rot silently.
- Process records exempt from the bilingual requirement (see §3): internal QA/golden reference docs;
  plan files (`docs/decisions.md`); prior-phase reports (`docs/bline-report.md`,
  `docs/omo-parity-gap.md`, `docs/review-p0-p3.md`, `docs/track-a-report.md`,
  `docs/ulw-deepseek-optimization.md`, `docs/tui-edition-report.md`); and adopted third-party docs
  kept verbatim as provenance (the upstream `mpd-agent-teams-plugin/README.md` and `README_ZH.md`).

## Reference Index (on-demand)

The manual's bulk reference material lives in `agent-references/` — **agent-facing, English-only**
files (`verify:docs` does not discover this tree). They are deliberately NOT named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the loader never injects them: **open them on demand** when a
pointer here or in a section sends you there. `§1`–`§13` stay in place, so every `§N` citation from
code, scripts and docs still resolves. The register is `agent-references/index.md`.

| File | Holds | Open it when |
|---|---|---|
| `agent-references/troubleshooting.md` | the full symptom → cause/fix table (the former body of §12, moved verbatim 2026-09-17 by the T-22 instruction-budget split) | a boot, gate, tool or team behaviour is wrong — look the symptom up before inventing a fix |
| `agent-references/agent-teams-deltas.md` | the adopted agent-teams delta registry: the authoritative A1–D42 adaptation table, the registry mechanics (context-pair addressing, `--write-registry`), the live region count and the two unpatched wave-2 driver scripts | you touch `packages/mpd-agent-teams-plugin/**`, `scripts/patch-agent-teams-fixes.ts`, `scripts/vendor-agent-teams.ts`, or an `mpd-delta` region |
| `agent-references/verification-flow.md` | the ordered verification flow behind §4/§11: what each gate is worth, why the Docker lane is the LAST step, and the measured rootless / skip / `--require-docker` policy | you run a verification pass, or a Docker step skipped and you need to know why |

---

## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **What it carries from upstream**: the
roster, the model-chain vocabulary and the roster's stable ids come from the upstream project, and
the capability baseline is
a pinned snapshot of `code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded
in `VENDOR_LOCK.json` and not chased per §9), whose 11 specialists ship as adapted teammate templates
and workmate BASE templates; one component was adopted outright (the `agent-teams` plugin from
dsh-agent-teams under the MIT License, vendored as first-class main code) and is now RETIRED from the
composition in favour of the harness's own official Agent Teams plugin. **What is ours**: the DSH
plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream spec parity is an engineering
reference, not an identity label — describe this repository by what it ships, never by what it is
not. License: SUL-1.0 (`LICENSE.md`), inherited from upstream; inheritance and attribution are
declared in `README.md` and `LICENSE-NOTICES.md`.

- **Naming.** Our prefix is **`mpd`** (my-power-dsh): packages, plugin ids, tool names (`mpd_*`),
  preset id (`mpd`), env keys (`MPD_DSH_*`), state dir (`.mpd`). Two exceptions are deliberate: DSH
  plugin names (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the host's
  API and are never renamed, and **Adopted plugins keep their plugin ids and tool names** (the
  `context7`/`grep_app` remote MCP rows follow the same rule). Upstream product names and repository
  paths stay upstream's (provenance only), and the two vendored binary-resolution env keys
  (`MPD_AST_GREP_SG_PATH`, the sg resolver, and `MPD_CODEGRAPH_BIN`, codegraph serve) are read by
  upstream vendored code and are never renamed.
- **Roster.** The 11 specialists are teammate instantiation templates — NOT presets — addressed by NAME
  and described by what they do, never by their internal stable `id`. One-shot consult goes through
  `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` / `mpd_role_persona`, `mpdRoles` service
  consumed by `mpd_modelchain_resolve`); team work uses the **official Agent Teams plugin**
  (`@deepseek-ai/dsh-experimental-agent-team` + `-tool-agent-team` + `-client-ui-agent-team`, mounted
  by this bundle's `mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team` rows: the
  `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` / `interrupt_agent` / `team_task_*`
  tools plus the official Web roster and task board); durable, evolving instances come from the
  **workmate library** (`mpd-workmate-plugin`). §13 defines roster, stable id, workmate and
  team-model slot precisely, and `mpd-roles-plugin` holds the authoritative names — read §13 before
  touching any of them.
- **THE TEAM RECORD IS OURS (team-plane split, W1, 2026-09-30).** `mpd-team-core-plugin` owns the team
  (roster, board, DAG, `kind`/`attempt`/`round`/`verdict`) in `.mpd/team/teams/<id>.json`, served as
  **`mpdTeams`**: mpd surfaces read THAT, not `dsh.teamLiveTeams()`, and the official plane is one
  interchangeable EXECUTOR backend. See `docs/plan-team-plane-split.md`.
- **The vendored `agent-teams` body is RETIRED from the composition (2026-09-27).** It is a **0.1.14
  body with the audited 0.1.16-rc.3 deltas backported** (adopted package version `0.1.16-rc.3-mpd`;
  `lib/client.js` is still the 0.1.14 client build), it still lives at
  `packages/mpd-agent-teams-plugin`, and `LICENSE-NOTICES.md` remains its authoritative provenance
  record — but **no loader row mounts it any more**, so `agent_teams_*` tools, that plugin's
  `<workspace>/.mpd/team` record and its Web activity panel are NOT part of a shipped session. Harness 0.1.7-rc.2
  shipped an official Agent Teams plugin, and this bundle adopted it (see the roster bullet above and
  `docs/plan-0.1.7-adaptation.md`). Its `lib/` stays mediated through `mpd-dsh-adapter` except the
  counted `setup(childCtx, child)` residual that §6 names, which is why the code is retained rather
  than deleted: the D6 gate and the adapter still cover it, and a later wave can delete it without
  re-deriving that analysis. Deleting it is a declared follow-up, not an oversight.
- **A dependency a bundle DECLARES is mounted by a row that needs it.** The three official Agent Teams
  packages are declared in this package's `dependencies`, and `dsh-app-boot`'s
  `healProfileModuleFallback` materializes that closure into `<profile>/node_modules` before the
  loader runs. The same mechanism is how the `mpd-better-sidebar` row (the sidebar HOST the bundle's
  GUI pages need, deliberately id-named apart from the upstream row) resolves its sidebar host.
- **ULW is user-invocable**: the C2 (Plan C) ultrawork v2 engine (`mpd-ulw-plugin`) is reachable as
  `/ulw <objective>` and `/ultrawork <objective>` (equivalent, objective as argument) — the command
  submits the ULW activation directive as the invoking agent's own next user turn, so the run
  actually starts; empty input returns usage, and a plain-text `/ulw …` gesture gets the same
  directive on surfaces without command adjudication (headless). An activated ULW run asks the user
  nothing: it triages an unclear or investigate-first objective first, evaluates the same complexity
  predicate as any MPD request, stages a team itself with `spawn_teammate` + `team_task_create` (the
  official tools, through the adapter) when the work warrants one, loops to
  completion, fixes defects on sight, and closes out through the verification and quality gates
  before reporting done.
- **The session-start complexity gate ADVISES — it never pre-stages a team.** The frozen predicate
  `trigger = explicit flag OR (matchedSignals >= 1)` is still evaluated at the session's first
  pre-step, and its notice keeps the marker `[AgentTeams] Session-start team rule`, but a triggered
  auto-route only injects ONE advisory notice naming the fired signals and stating that **no team was
  staged**; the captain stages a team with `spawn_teammate` + `team_task_create`
  at the moment the work actually warrants one, or continues solo and says so. An explicit `team:` /
  `!team` request is likewise only ADVISED — the captain is told to stage, nothing is pre-staged for
  it. The gate is implemented by `mpd-roles-plugin` on the official plugin's seams (the retired
  `sessionTeamPolicy.mode: "auto"` unconditional-provisioning path is gone with the plugin that owned
  it).
- **The ONLY shipped preset is `mpd`** — the main working agent — which also carries the
  project-instruction convention: every session MUST attempt to read `AGENT.md` (falling back to
  `AGENTS.md`, then `CLAUDE.md`) via `dsh-agent-instructions`.

---

## 2. Principles

1. **The agent is the worker.** Everything here optimizes for an agent that reads the repo cold and
   behaves correctly: explicit conventions, executable gates, evidence on disk.
2. **Plugin form.** Every delivered capability is a DSH cordis plugin (self-written) or an official
   plugin instance configured in the bundle patch. No logic in profiles, scripts, or the user home.
   **Mounting is by `cordis.patch.yml` + the profile mechanism and NOTHING else — binding** (full
   statement in §8): this repository is an independent PACKAGE the profile references; it never
   injects rows into the harness, never edits DSH sources, and never writes the home by hand.
3. **Evidence without evidence is incomplete.** A change without QA evidence is not done.
4. **Isolation.** QA never touches the real `~/.dsh`. Everything boots in a temp DSH_HOME.
5. **Baseline discipline.** Upstream assets are pinned and verified; we don't chase upstream.
6. **Minimal diffs.** Prefer the smallest change that satisfies the requirement; no speculative refactors.

---

## 3. Repository Layout

```
mpd-dsh/
├── AGENTS.md                     # this manual
├── README.md / README.zh-CN.md   # public overview, bilingual pair (inheritance declared in README)
├── PLAN.md                       # port plan (Track A/B)
├── LICENSE.md / LICENSE-NOTICES.md
├── VENDOR_LOCK.json              # upstream commit/version/stats + vendored asset fingerprints
├── package.json                  # THE BUNDLE MANIFEST (name @mpd-dsh/mpd): dsh.bundle.patch
│                                 #   (an ARRAY of the bundle patch + the preset patch) + dsh.client
│                                 #   + exports -> `dsh plugin add .` is the whole install
├── cordis.patch.yml              # THE host-plane patch layer, at the package ROOT (standard layout)
├── tsconfig.json                 # root tsgo config (covers packages/*/src/**/*.ts)
├── presets/                      # mpd.patch.yml: the `preset-mpd` row (@deepseek-ai/dsh-agent-preset,
│                                 #   inline plugin list). The retired directory form is gone.
├── scripts/                      # gates, packer, installer, extension CLI, vendor + delta appliers
│                                 #   + lib/repo.ts: the shared primitives every script imports
├── packages/                     # one dir per plugin package (src/ + dist/ + README.md each);
│   ├── mpd-dsh-adapter-plugin/   # THE single contact surface with harness seams (§6)
│   ├── mpd-roles-plugin/         # the specialist roster + mpd_roles_* + the mpdRoles service
│   ├── mpd-agent-teams-plugin/   # RETIRED vendored dsh-agent-teams body — kept, NOT mounted (§1)
│   ├── mpd-workmate-plugin/      # durable evolving agent library (~/.mpd/workmate)
│   ├── mpd-ulw-plugin/           # C2 ultrawork v2 engine: mpd_ultrawork + /ulw, /ultrawork
│   ├── mpd-mcp-astgrep / mpd-mcp-codegraph / mpd-mcp-gitbash / mpd-mcp-lsp / mpd-mcp-shared /
│   │                             # the MCP servers: AST search, code graph, git-bash, LSP, shared libs
│   ├── mpd-tools-plugin/         # B1: write guard, output truncation, edit-error recovery
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendored hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendored boulder-state)
│   ├── mpd-config-plugin/        # C7: the mpd.jsonc runtime config layer (read by the plugins above)
│   ├── mpd-memory-plugin/        # C6: git/svn-backed memory + the reflection state machine
│   ├── mpd-comment-checker-plugin/ # C4: comment/docstring detection (opt-in binary)
│   ├── mpd-modelchain-plugin/    # B4: mpd_modelchain_resolve + mpd_memory_save/recall
│   ├── mpd-codegraph-plugin/     # binary resolve + project init + the mpd-codegraph command
│   ├── mpd-bootstrap-plugin/     # serves <bundle>/skills by reference; cleans legacy (<=0.2.6) copies
│   ├── mpd-team-watchdog-plugin/ # stall detection: the member record-stream fold, heartbeat store,
│   │                             #   WARN->ESCALATE ladder, preserving hold (NEW DISPATCH only)
│   ├── mpd-team-compact-plugin/  # compacts FINISHED teams (never the captain); ledger in .mpd/team-compact
│   ├── mpd-team-core-plugin/     # THE TEAM RECORD + WORKFLOW + the `mpdTeams` service (W1)
│   ├── mpd-roster-provider-plugin/ # per-member model routing for OFFICIAL teammates: registers
│   │                             #   the `mpd-roster` subagent provider the team tool row points at
│   ├── mpd-ext-plugin/           # the extension interface (row `mpd-ext`, service `mpdExtensions`)
│   ├── mpd-tui-plugin/           # the DSH-TUI edition's surface package (`ctx.tui*` seams, warn-once)
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster
├── extensions/                   # <bundle>/extensions/*/mpd-ext.json + the DISABLED mpd-ext-example
├── skills/                       # dsh-qa + 16 ported upstream skills + svn-master (SERVED by reference)
├── templates/                    # plugin/extension scaffolds shipped by the packer
├── tests/                        # overlays/ (keep empty when rows live in the bundle) + golden/
├── docs/                         # human-facing docs (BILINGUAL EN + zh-CN); hub is docs/index.md
│                                 #   plan records + internal QA/golden docs are EXEMPT from the
│                                 #   bilingual rule (the §3 policy the gate cites)
├── agent-references/             # ON-DEMAND agent-facing reference (never auto-injected)
└── evidence/                     # QA evidence: <domain>/<slug>/<timestamp>/ (records, language as produced)
```

Each `packages/<pkg>/README.md` holds that plugin's own contract — this tree is a map, not a
specification.

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts`; the corpus re-pin is DERIVED — `node scripts/repin-vendor.ts` (dry-run by default, `--check` asserts, `--write` applies; the helper REFUSES the repository's own `VENDOR_LOCK.json` without `--i-know-this-is-the-captains-step`, so a wave cannot re-pin mid-flight) — and lands in the commit that invalidated the `treeSha` (§9/§11) | any baseline/asset change; before release |
| Dist freshness | `node scripts/verify-dist-fresh.ts` (deterministic rebuild-and-diff: every `packages/*/src` entry is rebuilt twice into a temp dir and compared byte-for-byte with its committed `dist/`; unmatched `dist/` files are printed in a loud NOT COVERED section, never silently skipped; `--self-test` seeds a mismatch; the canonical REBUILD command — repo root, path-qualified args — and the package-directory trap are named in §6's Build line) | any `packages/*/src` or `dist/` change; before release |
| Row/parity | `bun run verify:rows` + `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | any bundle-patch / preset / overlay / row change |
| Pack closure | `node scripts/verify-pack-closure.ts` (completeness + the byte identity of files whose sources did not move; `--self-test` is the fixture-driven arm; `--pack-stamp <t>` re-anchors the comparison for a reviewer mutating a copy) | any pack, any post-pack writer, and in the release sweep (§11) |
| Tests | `bun test` (per package) + `bun run typecheck` (root) | every plugin change |
| QA self-tests | `bun run test:qa` (all `--self-test`) | every plugin/QA-script change |
| QA real cases | `node skills/dsh-qa/scripts/<case>.ts` | runtime-behavior changes |
| Installer | `node scripts/install-profile.ts --dry-run` | any bundle-patch/installer change |
| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.ts`; ships `--self-test` with a negative control; recursive under `docs/`, `extensions/**/README.md` and `templates/**/README.md`, and it fails on a zh-only doc or an undocumented package) | any human-facing doc change (`README*.md`, `docs/**`, `packages/*/README*.md`, `extensions/**`, `templates/**/README*.md`); before release |
| **Plugin manifest (STANDING — user-mandated)** | `bun run verify:manifest` (= `node scripts/verify-plugin-manifest.ts --pack`): the TWO install-time rules — **no `cordis`** in `dependencies` / `peerDependencies` / `optionalDependencies` (by NAME; the optional field is NOT an exemption) and no `preinstall` / `install` / `postinstall` / `prepare` script NAME — the VERSION-COHERENCE rule (`dsh-plugin.json` + `dsh-distribution.json` must carry `package.json`'s version) — plus the packaging contract a one-command install rests on: declared patch files exist, every row module path resolves, the `files` allowlist admits every runtime path, `evidence/` stays out, and **npm's own `npm pack --dry-run` list carries them**. `--self-test`: six arms with clean controls | every manifest/patch/row/file-layout/version change, and EVERY release sweep |
| **Declaration comments (STANDING — user-mandated)** | `bun run verify:comments` (= `node scripts/verify-comment-coverage.ts`): a TypeScript-AST check (never a line scan) that every declaration in the source set (`packages/*/{src,test,self-fix-tests}`, `scripts/`, `skills/*/scripts/`, `docker/`, `tests/`, `templates/`, `extensions/`) has a precise comment above it, and that every NAMED function writes down its parameter and return types | any source edit, and EVERY release sweep |
| Manual paths | `node scripts/verify-manual-paths.ts` (T-66: a path-shaped token this manual spells in a code span is AUDITED only when its first segment is an entry at the repo root; a token that is not root-anchored (a GitHub slug, an API route, an `@scope/name`) or not written literally (a glob, a placeholder, an elision) is counted in its own bucket and NEVER fails the run — so it catches a wrong ROOT-relative path, not a wrong package-relative spelling; the DECLARED anticipatory class and its rot guard are printed apart from the audited subjects) | any edit to this manual |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `bun scripts/mpd-ext.ts validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension MUST exit 1 with per-item errors) | any extension-interface/manifest/CLI change |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (host rows) and `node skills/dsh-qa/scripts/preset-conformance.ts` (the `mpd` preset's standing mount + every harness-owned row config; its negative control proves the assertion is falsifiable), or the `full-profile-boot.sh` / `mount-proof.sh` pattern with registration instrumentation | any patch change, any preset/row change, and REQUIRED for any tool-schema change |
| Composition only | `node scripts/dump-config.ts --profile <p>` (repo wrapper around the raw harness flag: prints the composition-only banner in its own output and propagates the child's exit code) | whenever a row/preset composition question is asked |
| **Docker real-machine (LAST step)** | `bun run verify:docker` (`node scripts/docker-e2e.ts`; `--mode source` = checkout, `--mode oneclick` = the PUBLISHED package, `--spec <install-spec>` = any spec including the live `github:` one). Builds a real `ubuntu:24.04` and asserts the INSTALL then the MOUNT — rows activating, tools registering, the TUI booting on a real PTY, `agentPreset=mpd` in the session store — never merely "the install exited 0". **A machine without a ROOTLESS Docker PRINTS A NOTICE AND SKIPS (exit 0)**: rootless runs, rootful skips unless `--allow-rootful-docker`, an absent daemon skips, `--require-docker` makes any skip exit 3. A SKIP is not a pass — the steps ABOVE it carry the wave | every release sweep, and any install/mount-path change (`files`/`dsh.*`, a patch row, `docker/**`) |

**The pack-closure bound (T-91):** a green `node scripts/verify-pack-closure.ts` certifies COMPLETENESS
plus the BYTE IDENTITY of every file whose source did not move; **freshness is NOT what the exit code
says** — it is read from the `expected-after-pack` list at the re-pack (T-26's discriminator: TIMESTAMP
ORDER; `--pack-stamp <t>` re-anchors it for a reviewer mutating a COPY). The gate's `--self-test` fixture
arms are the operative evidence; a grep for this paragraph is not.

`--dump-config` is NOT a gate: it COMPOSES rows and never executes plugin code, so a schema/apply abort
is invisible to it. Measured: `dsh --profile mpd --dump-config` exited 0 with the `mpd-workmate` row
present while the same profile's real boot could not load the tree; the decisive check was a mounting boot
with registration instrumentation (`evidence/workmate/rename-delete-core/20260910T132303Z-mount/`).
**It proves COMPOSITION ONLY — never a plugin load.** Every instruction that sends a reader to the flag
goes through the repo wrapper `node scripts/dump-config.ts` (T-31), which prints that warning itself;
only passages that CONTRAST the flag keep the raw spelling on purpose.

No evidence on disk for a gate = the change is not complete. Merge to dev only after the relevant gates
pass and their evidence is committed with the change.

`bun run verify:gates` is the fast aggregate over the static gates (vendor, dist freshness, row parity,
doc pairs, preset conformance) — one command for a patch/preset edit and for the release sweep. It
expects a CLEAN tree: a dirty `skills/**` corpus legitimately reddens the vendor gate until the wave's
single re-pin lands (§9/§11).

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
- **ONE git writer per working tree — binding.** Teammates share the captain's checkout, so two writers
  race on the single `.git/HEAD`. Measured (2026-09-14): a member switched branches mid-command and its
  `reset HEAD~1` landed on `dev`, moving the tip back one commit — nothing lost (the reflog held every
  step), but recovery cost a full forensics pass. Rules: a teammate NEVER runs
  `commit`/`add`/`checkout`/`switch`/`reset`/`stash`/`merge`/`branch`/`rebase`/`tag`; it edits files, runs
  gates and writes evidence, and the **captain alone** commits and branches — or the captain serializes
  ONE delegated writer and freezes everyone else first. Read-only `status`/`log`/`diff`/`show`/`grep`
  stay open to all. Tag `backup/<branch>-<sha>` before any history-writing step.
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

Structure per plugin package: `src/index.ts` (cordis `name`/`inject`/`apply`), `packages/<pkg>/dist/index.js`
(bun build), `README.md`, optional `package.json` with `@mpd-dsh/<name>` naming.

- **Harness seams go through `mpd-dsh-adapter` — binding.** No plugin row may touch a harness service
  directly (`ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`); `packages/mpd-dsh-adapter-plugin`
  is the ONE file allowed to, so a harness release that renames or reshapes a seam is absorbed there
  instead of across every plugin. Resolve it with the adapter's own helper,
  `const dsh = resolveDshAdapter(ctx)` (the mounted `mpdDsh` instance, or a row-private
  `createDshAdapter` so the plugin stays standalone in unit tests) — or `createLazyDshAdapter(ctx,
  { label })` when the row must also survive a transient "provider not ACTIVE yet" miss. The
  package also carries the bundle's pure, harness-free helpers (`src/shared.ts`, re-exported from the
  entry: `isRecord`, `errorMessage`, `bundleRootOf`); the SEAM surface stays
  `src/index.ts`. The skill-frontmatter subset has ONE implementation for both the extension skill
  plane and the bundle corpus (`packages/mpd-ext-plugin/src/skill-frontmatter.ts`).
  QA proves the surface: `bundle-lifecycle` asserts the row, the boot log line and the probe's
  `ADAPTER_SEAMS`/`ADAPTER_TOOL_CALL=ok`.
- **The adopted-plugin exception is CLOSED (2026-09-19), and not overstated.** Its SIX bridged files
  (`lib/{index,capabilities,harness-compat,members,command,tools}.js`) route through the facade
  `lib/mpd-adapter-ctx.ts` — an mpd-OWNED module (name rule `lib/mpd-*.js`, healed byte-faithfully from
  the registry) that resolves the mounted `mpdDsh` lazily behind a warn-once fallback, so the plugin
  still applies with the adapter absent (exactly ONE absent line per instance). Each bridged call sits
  in a bracketed `mpd-delta` region and goes through a capability-flagged adapter method:
  `registerHostTool` (VERBATIM, `Object.is` — `registerTool` cannot serve it), the `subagent*` /
  `agentTurn*` families, `llmListModels` / `llmResolveCallConfig`, `registerPromptSection`, `agentScope`.
  **One bypass is COUNTED, never routed:** the ctx the HOST hands `setup(childCtx, child)` stays DIRECT
  on its **5 counted lines** in `lib/members.ts` (two raw `childCtx.on('agent/error' |
  'agent/request-error')` subscriptions, the `installModelSelection(childCtx, …)` hand-off into a
  VENDORED `_deps/dsh-agent` helper, the legacy `hostChild ?? childCtx.agent` read) — on a legacy Alpha.2
  host a `childCtx` need not be `child.ctx`, so re-resolving it could change that path. `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.ts` pins exactly those
  5 lines (plus the two `whenIdle` Class-B sites), so a NEW use reddens instead of hiding.
- **Five further residuals stay NAMED**, so the closure is never read as unconditional: (R1)
  adapter-mediated registrations (`tools.register`, `commands.register`, `systemPrompt.section`,
  `ctx.on`) belong to the ADAPTER row's fiber — a plugin-only unload would not revoke them (accepted:
  shared boot lifetime, no module hot reload, T-21); (R2) the retired-member delivery guard still PATCHES
  `subagentRuntime()`'s object — delivery stays in the plugin, RESOLUTION in the adapter; (R3)
  `lib/client.js` (browser bundle) is OUT OF SCOPE, its export bridge guarded by
  `scripts/patch-agent-teams-client.ts`; (R4) `liveAgent`/`liveAgents`/`onEvent` swallow-and-degrade
  where the raw ctx would throw — the adapter's never-crash contract, deliberate; (R5) the count sentence
  in `agent-references/agent-teams-deltas.md` keeps its exact wording (the docs gate's regex is FIXED)
  while only its numbers move.
- **The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`** (on demand,
  not injected): the A1–D42 table, the registry mechanics, the region count and the wave-2 driver-script
  warning. Two rules bind: (a) the registry is **derived** — regenerate with `--write-registry`, never
  hand-edit an entry; (b) the **REPLACEMENT-shaped** deltas (D13/D14/D21/D22) do **not** self-heal after
  a human re-materialize — the applier REFUSES loudly, file byte-untouched, and the remedy is to restore
  the region or re-author it plus `--write-registry`. `scripts/vendor-agent-teams.ts` never re-copies the
  tree (it rewrites bare specifiers in place, works inside `_deps/`, and asserts OUR `lib/index.ts`
  survives), so the risk is a human re-vendor — which the applier makes loud (a line-keyed anchor can
  still land a region one statement late). A hand-dropped `lib/mpd-adapter-ctx.ts` heals byte-faithfully.

  Everything else — including every future mpd plugin — goes through the adapter.
- **Tools**: `dsh.registerTool({name, description, parameters, output:{schema, render}, execute})`.
  The adapter defaults `parameters` to an object-rooted schema and `output.render` to a text block, and
  always calls `execute(args, exec)` with objects. `parameters` is object-rooted JSON Schema;
  `output.schema` the canonical value contract; `render` returns `[{type:'text', text}]` blocks;
  `exec.signal` cancels.
- **Guards**: `dsh.guardTool(fn)` where `fn(exec) => string | undefined` (string denies). Keep guards
  monotonic and non-throwing; read only, never mutate.
- **Waterfalls**: `dsh.onPostToolExecute(async (exec, result, downstream) => decision | undefined)` —
  the adapter owns `next()`, so the listener only decides: return `{...downstream, content}` to replace,
  `undefined` to pass through. Accept with `{kind:'accept', content?}`, block with
  `{kind:'block', feedback}` (the harness key is `feedback`; `decision.block(reason)` builds it).
- **Subagents**: `dsh.spawnAgent({label, prompt, parent: exec.agent, signal: exec.signal, provider,
  model, outputSchema, persona, maxDepth, toolFilter})` → `{output, structured, stopReason}`. Flat
  `provider`/`model` and harness-shaped `agentOptions` both work, and `run.result` is awaited whether it
  is a promise or an object.
- **Internal tool calls**: `dsh.hasTool(name)` / `dsh.executeTool({name, arguments, callId?, signal?})`
  (→ `{ok, isError, value, error}`) — never `ctx.tools.get`/`ctx.tools.execute` directly.
- **Capability probing**: `dsh.capabilities()` reports one boolean per seam; degrade with a warning
  instead of aborting a plugin tree (a missing optional seam must never take the boot down — see the
  `registerContinuableSetup` guard in the adopted agent-teams plugin).
- **State**: workspace-scoped only (`.mpd/` under the **calling session's workspace**, never the dsh
  process cwd); never write `~/.dsh` from a plugin. Every plugin resolves that root through the ONE
  adapter helper — `dsh.workspaceRoot(exec)` with precedence **session header cwd →
  `DSH_WORKSPACE_ROOT` → `process.cwd()`** — plus `dsh.workspaceRootsAll()` (the union of live session
  cwds, `[]` when the agent registry is absent) for agentless surfaces such as web routes. The session
  fact outranks the process-wide env because one host serves many sessions with different workspaces; an
  explicit row/config override (`boulder.dir`, `hashline.registryFile`, `memory.dir`, `ulw.planDir`,
  `config.projectFile`, `MPD_DSH_VERIF_VENV|WORK`) still wins over all of them. Resolve it PER CALL:
  never cache the root in a module-level const, never `chdir`, and never set `DSH_WORKSPACE_ROOT` from a
  row — each of those would "fix" one session by breaking the multi-session host. Evidence:
  `evidence/session-workspace-root/b1-resolution/`. Sanctioned exceptions: (1) the bundle writes NOTHING
  to the home any more — the `mpd-bootstrap` row serves `<bundle>/skills` through a `ctx.skills`
  provider and the bundle patch roots the `agent-presets` roster at `<bundle>/presets`, so both assets
  exist exactly while the bundle is installed (§8), and the row only REMOVES the version-stamped copies
  that bundle `<= 0.2.6` wrote; (2) the **workmate library** deliberately lives under the user's HOME
  (`~/.mpd/workmate`), the user's cross-project evolving agent library (§13), and QA must boot with
  `HOME=<sandbox>` so tests never touch the real home; (3) **`mpd-codegraph`** keeps its project index in
  `.codegraph/` under the workspace (the upstream-mirrored second state root, gitignored — see
  `packages/mpd-codegraph-plugin/README.md`).
- **TypeScript is the only source language, run directly by Node — binding.** Every file this
  repository owns is `.ts` and runs as `node <file>.ts` (type stripping; `engines.node` states the
  floor). Four rules: **erasable syntax only** (no `enum`, `namespace`, parameter properties or
  decorators); **every relative specifier carries the explicit `.ts` extension**; `import type` for
  type-only imports; no `tsconfig`-`paths` mapping. `packages/*/src` differs in FORM only (`bun build`
  → `dist/*.js`, extensionless specifiers), and a genuine CommonJS module is spelled `.cts`. The ONLY
  JavaScript left is 32 files, for a MEASURED reason: Node refuses to strip types for any path under
  `node_modules`, and a shipped bundle IS installed there — the list and the failure are in
  `agent-references/troubleshooting.md` (last row). The converted ADOPTED body carries `@ts-nocheck`
  and its suite is out of the type program (`tsconfig.json`).
- **Every declaration is documented and every named function is fully typed — binding, enforced by
  §4's `verify:comments`.** A comment states the contract, unit, invariant or reason — never a
  restatement of the name; a local inside a function body counts as a declaration. Types are precise:
  `unknown` plus narrowing instead of `any`, an existing interface/type reused instead of a structural
  clone, and a cast only where narrowing is impossible, with a comment saying why.
- **Build — from the REPO ROOT, with path-qualified args**: `bun build
  packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`
  (a multi-entry package repeats it per entry, e.g. `packages/mpd-ext-plugin/src/sdk.ts` →
  `packages/mpd-ext-plugin/dist/sdk.js`). The canonical form matters: `bun build` writes every bundled
  module's path RELATIVE TO CWD into the artifact's path comments, and
  `node scripts/verify-dist-fresh.ts` reproduces THESE bytes — so a build run from a PACKAGE directory
  is flagged STALE even though it looks sanctioned. Three packages used to carry exactly that shape in
  their own `build` scripts (`mpd-ext-plugin`, `mpd-team-watchdog-plugin`, `mpd-tui-plugin`); T-67 moved
  them to the canonical form above, which now begins with `cd "$(git rev-parse --show-toplevel)"`. Zero
  runtime deps preferred (type-only imports).
- **Load/test**: the committed patch names rows as `@mpd-dsh/mpd/packages/...`, which resolve in BOTH
  install layouts (the repo root IS `@mpd-dsh/mpd`, so a checkout install resolves them through the
  link; the packed package through its own name). QA boots it straight from a checkout through the
  dev-flavor rewrite (`devPatch()` in `skills/dsh-qa/scripts/preset-register.ts`: rename rows to
  checkout-absolute paths, rewrite the preset-root expression, pin MCP binaries via `MPD_DSH_*` env)
  because a QA sandbox has no installed profile. Do NOT keep a bundle row in a QA overlay while it is
  already in the bundle — the loader rejects duplicate entry ids.
- **Docstrings/comments**: English only.

---

## 7. QA Discipline (mirrors upstream, adapted)

- Skill: `skills/dsh-qa` (SKILL.md + case scripts + references). Every script ships `--self-test`.
- **Isolation is THREE things, not one.** (a) `DSH_HOME=<mktemp>`: credentials copied ONCE into the
  sandbox, the sandbox path asserted, the real `~/.dsh` never read or written; env prereqs (sg/codegraph)
  copied only when present. (b) `HOME=<sandbox>` — skill roots leak through HOME (the provider's user
  roots are `<DSH_HOME>/skills` and `<agentsHome>/skills`, `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`;
  measured 2026-09-14: `SKILLS=24 BUNDLED=18` → FAIL). (c) A SANDBOXED WORKSPACE: `DSH_HOME`/`HOME` do
  NOT isolate workspace state, because every workspace root resolves from the session workspace
  (`dsh.workspaceRoot(exec)`; `agent.session.header.cwd ?? process.cwd()` in the adopted plugin), so
  every dsh spawn and `session/create` payload carries an explicit sandbox cwd
  (`sandboxWorkspace(sandbox)` from `skills/dsh-qa/scripts/lib/workspace-isolation.ts`) and each live
  case asserts no `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists (`assertSessionsSandboxed`).
  Without it an "isolated" boot writes real `<repo>/.mpd/team/mpd-default-*` records (exactly what the
  `mpd_workmate_rename/delete` in-use gate scans) plus `.mpd/{memory,boulder.json,hashline-files.json,
  verif,plans,ulw}` and `.codegraph`.
- Live-LLM cases must ALSO copy `settings.yaml` when present: homes whose keys come from gateway
  providers (`llm-pi-ai` providers — opencode-go/scnet) configure the chain there, and without it
  headless falls back to the base `deepseek-official` route → `MISSING_CREDENTIAL`.
- **Provability: assert a REAL tool result, never just "it ran".** For composition-only questions the
  subject is `--dump-config` rows — but that proves COMPOSITION ONLY and never a plugin load (§4): it
  does not execute plugin code, so it cannot witness an apply/schema abort. Anything about plugin
  BEHAVIOUR (a tool registered, a route answering, a schema accepted) needs a boot that MOUNTS the rows
  in an isolated `DSH_HOME` with registration instrumentation, or a real tool call.
- **A live case proves a tool call from the HARNESS's session log, never from the model's prose**
  (`skills/dsh-qa/scripts/lib/session-evidence.ts`: `readSessionEvents` / `findToolCall` /
  `recordedToolNames`). The store is `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/` and — the trap
  — a CONCATENATED-ZSTD-FRAME container: one `zstdDecompressSync` returns the header frame ONLY, so a
  naive reader sees zero events and reports "no tool call" (a real artifact: 10 frames, 1 vs 25
  records). Decode frame by frame with the harness's own structure-only scan. `tool/call.data.name` + a
  non-error `tool/result` is tool evidence; `request/header.data.header.tools[]` is tool-list evidence.
  Asserting a tool NAME against the model's ANSWER is wrong in BOTH directions — both measured
  (`codegraph-smoke`, `evidence/dsh-qa/codegraph/`).
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- **Durable anchors (T-90): an ARTIFACT PATH is the anchor — a mailbox id is not a link.** A citation
  must survive the policy that owns its target: a line pointer rots by an EDIT (T-55), and a mailbox id
  rots by a MAILBOX CLEARING — archive-first, so nothing is hard-deleted, but no member-facing surface
  serves a cleared record any more, so the citation resolves to nothing. The artifact is the primary
  anchor, the relay is secondary, and the id is provenance, not an anchor — cite it as "read while
  present"; a seat that must cite an EXCHANGE copies the quoted bytes into its own artifact the moment
  it identifies them. This is a CLASS rule, not a pattern hunt: an `attemptId`/session id is DATA, and a
  shape scan is only a discovery heuristic with a measured calibration bound (31 of 31 hits were false
  positives on one scan).
- **Derived surfaces are declared at PLAN time (T-88): `packages/*/dist/**`, `dist/mpd-package/**`,
  `VENDOR_LOCK.json` and `.mpd/plans/**` belong to the INTEGRATION task's `inScope` at CREATION.**
  Measured: a lane edited a package's `src/**`, its own `verify-dist-fresh` reddened on a built
  `packages/<pkg>/dist/index.js` that belonged to NO lane's scope, and the platform refused the
  completion (`1 changed path(s) not covered by inScope`). Two halves: pre-declare the derived path on
  the task whose edits redden it — the hop rule applied BEFORE the refusal — and treat the mid-wave
  escape as a HOP requested with the exact amendment text in ONE message and no work attached; a LANE
  must not declare a `dist/**` pattern for itself (the platform's `inScope overlaps` validator refused
  exactly that, measured), because the declaration belongs at plan time.
- **Preset/row conformance against the INSTALLED harness** (`preset-conformance`, required for any
  preset/patch/overlay change): a row config is validated with the installed plugin's own schemastery
  `Config`, because that is what the loader runs. Two failure modes, only one loud: a MISSING REQUIRED
  key fails the row and `dsh-agent-presets` then refuses the whole preset (`agent-preset/invalid …
  row(s) did not activate`), while an UNKNOWN key is silently KEPT — the row applies and quietly loses
  that setting. It also pins the `mpd` preset's row set against the installed `standard` preset, because
  the harness moves rows between the host and preset planes between releases, so a missing row is a
  capability every mpd session loses. `--dump-config`, `agentPresets.list`/`resolve` and every
  `--self-test` that never creates a session are blind to this class — only a real mount is not.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- **Verify on SETTLED hashes, and quote a hash WITH its measurement moment.** An edit or revert still
  landing is measurable — a verification pass once measured a half-reverted tree, reporting a failure
  that no longer existed minutes later. Pin the revision by hash, re-check it after a short settle
  window (wave 2 used 50 s), then run the contract, anchoring every verdict to the hashes you measured;
  and state the UTC instant each hash was read (second precision), sandwiching a verifier's read —
  hash → work → re-hash, with start == end after the settle window — so "settled" is distinguishable
  from "another lane edited the file while I sampled".
- Shell caveat: long-lived MCP children hold inherited fds — run dsh with stdio to FILES (`spawnSync`
  with `stdio: ['ignore', fd, fd]`) or background + log-file redirection, never pipes.

---

## 8. Installer & Profiles

### The mounting contract — BINDING (user-set)

**A row reaches the harness ONLY through `cordis.patch.yml` + the profile mechanism.** Concretely:
(a) the deliverable is an INDEPENDENT PACKAGE (`@mpd-dsh/mpd`) whose `dsh.bundle.patch` array names its
patch layers — this bundle's `cordis.patch.yml` (host rows) and
`presets/mpd.patch.yml` (the `mpd` preset as an ordinary row); (b) the profile mechanism is the only
way in: `dsh plugin --profile <p> add <spec>` installs the package, `reconcile` validates that the patch
files load and appends the package name to `dsh.profile.bundles`, and the rows resolve from
`<profile>/node_modules`; (c) this repository NEVER edits DSH sources, NEVER writes a profile by hand
and NEVER pushes a row into `<DSH_HOME>` (the retired escape hatches — a home `cordis.patch.yml`, a
copied `skills/` tree, a preset directory — are dev/QA flows or removed outright); (d) uninstall is the
mirror image, one command, leaving no residue except the user's own `~/.mpd/workmate`. A capability
that arrives by any other route is a defect, not a shortcut — `verify-plugin-manifest --pack` plus the
Docker lane hold this line.

### Primary flow: ONE command, no extra step

- **The USER-facing install is ONE command against the PUBLISHED package — no clone, no build:**
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` (or `… add @mpd-dsh/mpd` once it is on
  the registry). The harness hands the spec to pnpm in `<DSH_HOME>/profiles/<profile>/`; pnpm packs it
  through the manifest's **`files` allowlist**, then `reconcile` reads the installed package's
  `dsh.bundle.patch` files, validates that they load, and appends the package name to
  `dsh.profile.bundles` — that pair is what makes the mount travel through `cordis.patch.yml` + the
  profile mechanism and NOTHING else. Proof: the live lane (`node scripts/docker-e2e.ts --mode
  oneclick --spec github:HaroldZ32/My-Power-Dsh`) on a bare `ubuntu:24.04`. The allowlist keeps the
  download small: 100.9 MB without it, 7.6 MB / 1134 files with it.
- **A plain `github:<owner>/<repo>` spec resolves the repository's DEFAULT BRANCH.** Measured
  2026-09-28: it served `master` while the wave sat on `dev`, so the install ran OLD code and failed on a
  dependency that branch still declared. An installable wave is RELEASED to the default branch (§11); a
  dev install must name the ref (`github:<owner>/<repo>#dev`).
- **`cd <repo> && dsh plugin --profile web add .`** is the whole install from a CHECKOUT. The repo root
  IS the bundle package: `package.json` is named `@mpd-dsh/mpd` and declares
  `dsh.bundle.patch` (an ARRAY: `./cordis.patch.yml` then
  `./presets/mpd.patch.yml`), `dsh.client`
  (`platform: web`), the `exports` map the rows resolve through (`./packages/*`,
  `./skills/*`, `./presets/*`, and the `client` subpath
  `packages/mpd-bundle-plugin/client.js`) and the toolchain `optionalDependencies`.
  `dsh plugin remove @mpd-dsh/mpd` is the matching one-command uninstall.
- **The published dependency closure is BUILD-SCRIPT-FREE on purpose**: pnpm 11 hard-exits on
  unapproved dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`) and the CLI `dsh plugin add` has no
  approval channel (`plugin_manager`'s `approvedBuilds` is the Web/MCP path only). So
  `dsh-better-sidebar` is an optional PEER + a `devDependency` (its `node-pty` postinstall is the
  offending script; its row's mount guard disables it when absent), and `@ast-grep/cli` +
  `@code-yeongyu/comment-checker` left `optionalDependencies` — their launchers resolve from
  `PATH`/`.toolchain`. The `mpd-oneclick` service keeps this honest.
- Every path-bearing patch value resolves through the loader's `baseUrl` (the profile
  directory), so the same patch works for a checkout install (`<profile>/node_modules/@mpd-dsh/mpd`
  → the repo) and for a packed install. The three official Agent Teams packages are declared
  `dependencies` of this bundle and mounted by this bundle's own rows (`healProfileModuleFallback`
  materializes that closure before the loader runs); the `mpd` preset
  and the skill corpus are SERVED by reference (the `preset-mpd` row → the inline plugin list,
  `mpd-bootstrap` → `<bundle>/skills`) — no home copy, so uninstall leaves no residue.
  Only user data stays: the workmate library under `~/.mpd/workmate`.
- **`node scripts/pack-mpd.ts` (alias `npm run pack`) is the RELEASE step, not an install step.** It
  assembles the relocatable `dist/mpd-package/` (tarball installs: `dsh plugin --profile web add
  dist/mpd-package`) from the built dists, `skills/` + `presets/`, `extensions/`, `templates/`, the
  `docs/` pairs, `agent-references/` and `scripts/`, declared in `files`; a checkout install never
  needs it.
- **After a code change:** rebuild the touched package's `dist/` (`bun build …`) and
  restart dsh — a `link:` install reads the checkout directly. Re-pack only when the
  distribution artifact must be refreshed, and bump `package.json` version for releases.

### Dev/QA flow (legacy): `scripts/install-profile.ts`

- `node scripts/install-profile.ts --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
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
  exactly ONE re-pin per wave — landing in the same commit as the change that invalidated that
  `treeSha` — is the invariant a reviewer checks.

---

## 10. Security & Privacy

- Credentials: only ever copied into an ephemeral QA sandbox; never committed, logged, or echoed.
- Evidence logs must not contain secret material (api key values, tokens).
- License: SUL-1.0 (LICENSE.md): internal/personal use; distribution free & non-commercial only.

---

## 11. Release Process

1. From dev: `git checkout -b release/vX.Y.Z`; bump the version in ALL THREE carriers — `package.json`, `dsh-plugin.json`, `dsh-distribution.json` (`verify:manifest` reddens on any mismatch) — plus the changelog note.
2. Full gate sweep, each command named exactly: `bun run verify:vendor` (after the wave's single
   `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` re-pin when
   `skills/**` changed), `bun test`,
   `bun run typecheck`, `bun run test:qa`, `bun run verify:docs`, `bun run verify:rows`,
   `node skills/dsh-qa/scripts/preset-conformance.ts --self-test`,
   `node scripts/verify-dist-fresh.ts`, `node scripts/verify-pack-closure.ts` (freshness read from
   the `expected-after-pack` list at the re-pack, never from its exit code — §4's bound), plus the
   real smoke cases (`dual-track-smoke`, `mcp-call`).
   - **LAST: the Docker real-machine lane, with `--require-docker` so it cannot skip silently** —
     `node scripts/docker-e2e.ts --mode source --require-docker` then `--mode oneclick
     --require-docker`. Run it AFTER the last write, and cite the stamps it writes.
   - **Release-checklist line (VENDOR_LOCK pairing rule):** `VENDOR_LOCK.json` lands in the SAME
     commit as every `skills/**` change that invalidates its `treeSha`; with the single-skills-writer
     rule (§9) that is exactly ONE re-pin per wave — verify the wave's single re-pin is present and
     that no `skills/**` change is committed without it.
3. Merge `--no-ff` to master with `release: vX.Y.Z …`; annotated tag `vX.Y.Z`.
4. Push master + tag; announce with evidence links.

---

## 12. Troubleshooting (known)

The full symptom → cause/fix table lives in **`agent-references/troubleshooting.md`** (on demand, not
injected; see the Reference Index). It is the former body of this section, moved verbatim 2026-09-17 by
the T-22 instruction-budget split and hash-verified under `evidence/gates/agents-budget/`. It covers the
ESM-restart trap, the fresh-`/tmp` and `nohup` rules, the single-`skills/**`-writer re-pin rule, the
`update_task` `status`/`attempt_id` contract, `--dump-config` vs a mounting boot, schema-union boot
failures, credential/sandbox traps, the codegraph daemon policy, the preset-plane row-drift class,
agent-teams dispatch defects, the failed-dependency pinning trap, the `inScope overlaps` validator and
profile-row loss after an unrelated install.

**Harness-owned frictions — CLOSED by a rule plus a helper** (user decision 2026-09-17). Each is DSH
behaviour or deliberate design that we do not fight; each is now "known, with a one-command fallback",
and the detail lives in `agent-references/troubleshooting.md`:

- **T-21 — no plugin-module hot reload.** ESM caches a module at session start, so an edit is invisible
  until `dsh` restarts. Ask instead of guessing: `node scripts/mpd-bg.ts reload-check <module-path>`
  → `RESTART-REQUIRED` / `FRESH` / `NO-LIVE-SESSION`.
- **T-23 — fresh `/tmp` per bash call + `bwrap --die-with-parent`.** Long work MUST be a managed
  background job (the bash tool's `run_in_background`), never `nohup`; start it through
  `node scripts/mpd-bg.ts run --log <workspace-path> -- <cmd>` so the output lands in a file.
- **T-24 — MCP children inherit fds.** Never pipe a long-lived `dsh`: `mpd-bg run` always hands the
  child a FILE as stdout+stderr, and `node scripts/mpd-bg.ts probe <pidfile>` is a kernel-only
  liveness check that cannot self-match a pattern.
- **T-26 — the file sandbox is workspace-write.** `node scripts/mpd-bg.ts check-write <path>` answers
  before a write is attempted; cross-area work needs a declared extra-write root.
- **T-43 — the workmate library lives under `HOME`.** QA/verification MUST boot with `HOME=<sandbox>`;
  the plugin refuses a mutation that would write the REAL `~/.mpd/workmate` (`403 real-home-refused`)
  unless `MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1` is set deliberately. A normal session is unaffected.
- **T-54 — a sandboxed profile copy must sit at the SAME directory depth** as the installed profile
  (the bundle dependency is a RELATIVE symlink of `..` segments); copy siblings at that depth.
- **T-55 — cite code by SYMBOL, never by line number** (a line pointer rots: one drifted from off-by-3
  to off-by-15 before a review caught it).

All seven are verified by `node scripts/mpd-bg.ts --self-test` (13 arms) plus the two sandbox cases in
`evidence/platform/harness-close/`.

---

## 13. Glossary

- DSH: DeepSeek Harness (host; cordis plugin architecture, web/headless profiles).
- bundle: npm package with `dsh.bundle.patch` patch layer (here: `mpd-bundle`).
- patch layer: id-targeted override or `insert:` list applied in order.
- preset: a named agent-plane composition declared as an ordinary plugin ROW. Harness 0.1.7-rc.2
  REPLACED the directory form (`preset.yml` + `agent.cordis.yml` served by
  `@deepseek-ai/dsh-agent-presets`, a package that no longer exists): the deployment default lives on
  `@deepseek-ai/dsh-agent-preset-registry` (`config.default`) and each preset is one
  `@deepseek-ai/dsh-agent-preset` row whose `config.plugins` carries the child entry list inline. This
  bundle declares `mpd` that way in `presets/mpd.patch.yml`, listed as the second entry of the
  manifest's `dsh.bundle.patch` array.
- roster: the specialist roster served by `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` /
  `mpd_role_persona`) as teammate instantiation templates for the OFFICIAL Agent Teams plugin
  (`spawn_teammate`, whose persona the captain takes from `mpd_role_persona`). The eleven members are
  addressed by NAME and described by what they do — Architect, Researcher, Planner, Deep Worker, Senior
  Engineer, Lead, Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The stable `id`
  (chain key, `personas/<id>.md`, workmate `meta.baseId`) is INTERNAL: accepted for compatibility,
  exposed by NO tool output, description, render, web route or GUI. The **read-only discipline is the exported deny list** —
  exactly seven names, identical in `mpd-roles-plugin` and `mpd-workmate-plugin` (asserted equal by
  `roles.test.ts`): `write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, `mcp__lsp__rename`. `bash` is denied on purpose (a shell can write files);
  `read`/`glob`/`grep` stay available. Enforced TWO ways that must keep agreeing: the one-shot path
  passes it as `toolFilter.deny` to `mpd_role_spawn`, and a tool GUARD denies the same seven names for a
  live Team teammate whose name normalises to a read-only roster member — the official `spawn_teammate`
  accepts no per-teammate tool filter. **Do NOT re-add
  `str_replace_editor` or `apply_patch`**: both
  were REMOVED because they are not registered in this profile — the harness validates the WHOLE list
  at spawn time and rejects the child when any single name is unknown, so one dead entry breaks every
  read-only spawn (an installed `dsh-tool-str-replace-editor` package or a `dsh-base` patch row is NOT
  proof of runtime registration, and `dsh --dump-config` composes rows without mounting them). Do not
  filter the list with `dsh.hasTool` either: it reads the global tool view, where `write`/`edit`/`bash`
  answer false, so filtering would silently DROP the entries that are the guarantee.
- team-model slot: one of the four configurable default model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` in `mpd.jsonc` / the `mpd` settings
  namespace, whose defaults are `deepseek-official` / `deepseek-v4-flash` at `max`/`high`/`high`, plus
  `deepseek-official` / `deepseek-v4-flash-vision-exp` at `high` for slot 4. Slot 1 routes
  Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/Plan Reviewer, slot 3 Deep
  Worker/Junior Engineer, slot 4 Vision Analyst (the vision member; the model here MUST accept image
  input). A slot that cannot be resolved — a
  missing service, a missing or incomplete slot, an unknown model, an unsupported effort — fails the
  corresponding spawn LOUDLY naming the member and the slot, writes no state, and NEVER clamps an
  effort. **Team teammates ARE routed, through a provider of this bundle's own (2026-09-27).** The slot
  applies to the mpd ONE-SHOT consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an
  explicit `agentOptions`, AND to an official `spawn_teammate` teammate: the harness — unlike its own
  TeamService — is not the limitation. `TeamService` forwards only `{ prompt, parent }`, but
  `SubagentContinuationManager.startContinuable` resolves `request.agentOptions` into
  provider/model/reasoningEffort and hands them to the PROVIDER, which is what constructs the run;
  the provider name is ROW CONFIG (`config.freshProvider`), not a tool argument. So
  `mpd-roster-provider-plugin` registers the `mpd-roster` provider — it delegates to the
  composition's own provider and applies the member's slot route — and the bundle points its
  `mpd-tool-agent-team` row's `freshProvider` at it. IDENTITY is the one thing the team service does
  not forward, so the routing rule is: **a teammate `description` that NAMES a roster member routes
  that member; one that does not inherits the Lead's route.** An incomplete slot fails the spawn
  loudly, naming the member and the slot. See `packages/mpd-roster-provider-plugin/README.md`.
- workmate: a durable, evolving agent instance in `~/.mpd/workmate/` created by `mpd-workmate-plugin`
  (`mpd_workmate_*`) from a roster BASE template with an independent name; it self-summarizes after each
  work (persona + independent memory, size-capped) and keeps a short note card. Reuse is via
  `mpd_workmate_match`; weak matches must NOT be forced — initialize a new workmate instead. The tool
  surface is `mpd_workmate_list` / `mpd_workmate_init` / `mpd_workmate_spawn` / `mpd_workmate_reflect` /
  `mpd_workmate_match` / `mpd_workmate_rename` / `mpd_workmate_delete`. **The directory name IS the instance
  key** (`meta.name` is only a display mirror), so a rename is a directory move and an interrupted one is
  harmless. `delete` is archive-first (`~/.mpd/workmate/.archive/<key>-<stamp>/`, no in-product restore
  — recover by hand with `mv`), permanent only with `purge: true` + `confirm === name`; both mutations
  are refused while the workmate is in use, and names are ASCII-only `[a-z0-9_-]`. A base is addressed by its functional NAME only (a
  roster id is refused with a names-only error), an auto-generated name derives from that functional
  name (`Deep Worker` → `deep-worker-1`), and `baseId` is internal provenance in `meta.json` that no
  tool output, web route or GUI ever exposes.
- mpd: our naming prefix (my-power-dsh).
- golden: graded benchmark task set in `tests/golden`.
