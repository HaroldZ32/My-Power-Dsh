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
- **The PULL REQUEST description is human-facing**: it follows the same bilingual rule (EN + 简体中文 in
  ONE description, English first). See §5.
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
  `docs/ulw-deepseek-optimization.md`, `docs/tui-edition-report.md`). The adopted third-party docs kept
  verbatim as provenance were removed with the vendored body on 2026-10-07, so every remaining human-facing
  doc is policed; the upstream acknowledgements live in `LICENSE-NOTICES.md`.

## Reference Index (on-demand)

The manual's bulk reference material lives in `agent-references/` — **agent-facing, English-only**
files (`verify:docs` does not discover this tree). They are deliberately NOT named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the loader never injects them: **open them on demand** when a
pointer here or in a section sends you there. `§1`–`§13` stay in place, so every `§N` citation from
code, scripts and docs still resolves. The register is `agent-references/index.md`.

| File | Holds | Open it when |
|---|---|---|
| `agent-references/troubleshooting.md` | the full symptom → cause/fix table (the former body of §12, moved verbatim 2026-09-17 by the T-22 instruction-budget split) | a boot, gate, tool or team behaviour is wrong — look the symptom up before inventing a fix |
| `agent-references/verification-flow.md` | the ordered verification flow behind §4/§11 — AND the former §4 body verbatim (the full gate table with every per-row measurement): what each gate is worth, why the Docker lane is the LAST step, and the measured rootless / skip / `--require-docker` policy | you run a verification pass, or a Docker step skipped and you need to know why |
| `agent-references/seam-adapters.md` | the TWO contact surfaces in detail (§6): the harness adapter and the DSH-TUI adapter, the fifteen `tui*` seams (the fourteen dsh-tui has exposed since 0.12.0, plus the `tuiPanels` sidebar registry 0.13.0 added) with their binder/probe/degrade discipline, the R5 "no terminal writes" rule and its gates, the declared WEB-plane residual, and the upstream panel-seam ask (ANSWERED for the sidebar by 0.13.0, still open for the dashboard) | you touch a `ctx.tui*` seam, an MPD log sink, an MCP launcher's stdio, or you are about to add a THIRD contact surface |
| `agent-references/overview-and-provenance.md` | the full §1 body: what the bundle carries from upstream, the adopted-then-retired agent-teams body, the declared-dependency mount mechanism, the ULW/GOAL detail and the session-start gate's softer signals | you need the provenance or the composition history behind §1 before restating it |
| `agent-references/plugin-authoring.md` | the full §6 body: the two adapter surfaces in detail, the counted host-setup bypass and the R1–R5 residuals, the delta-registry mechanics, the tool/guard/waterfall/subagent API signatures and the state-resolution rules | you author or debug a plugin row, touch a seam, or need an exact adapter signature |
| `agent-references/qa-discipline.md` | the full §7 body: the triple-isolation rationale, the live-case session-log decode trap, the durable-anchor (T-90) calibration bound and the preset/row conformance failure modes | you set up a QA lane, read a session store, or a conformance case reddens without a cause |
| `agent-references/installer-and-profiles.md` | the full §8 body: the one-command install in detail, the build-script-free dependency closure, the packed-artifact layout and the legacy `install-profile.ts` flow | you change `files`/`dsh.*`, a patch row or an install path |
| `agent-references/glossary.md` | the full §13 body: every glossary term (DSH, bundle, patch layer, preset and the 0.1.7 preset-form change, mpd, golden) plus the long forms of the roster/workmate/slot definitions | a term's long form or history is needed |

---

## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **From upstream**: the roster, the
model-chain vocabulary and the roster's stable ids, plus a pinned capability baseline —
`code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded in `VENDOR_LOCK.json` as
HISTORICAL provenance) whose 11 specialists ship as adapted teammate templates and workmate BASE
templates. **That upstream is a REFERENCE, not a dependency**: nothing in this tree reads, copies,
patches, fingerprints or audits its sources, nothing needs a checkout of it, and no gate fails when it is
unreachable — the pin is a record of where the adaptation came from. **Ours**: the DSH plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream spec
parity (see `docs/feature-audit.md`) is an engineering reference, not an identity label — describe this
repository by what it ships, never by what it is not. License: SUL-1.0 (`LICENSE.md`), inherited from
upstream; attribution is declared in `README.md` and `LICENSE-NOTICES.md`. The full composition and
provenance narrative is in `agent-references/overview-and-provenance.md`.

- **Naming.** Our prefix is **`mpd`** (packages, plugin ids, tool names `mpd_*`, preset id `mpd`, env
  keys `MPD_DSH_*`, state dir `.mpd`). Two deliberate exceptions: DSH plugin names
  (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the host's API and are
  never renamed, and **Adopted plugins keep their plugin ids and tool names** (the `context7`/`grep_app`
  remote MCP rows follow the same rule); the two vendored binary-resolution env keys
  (`MPD_AST_GREP_SG_PATH`, `MPD_CODEGRAPH_BIN`) are read by upstream vendored code and never renamed.
- **Roster.** The 11 specialists are teammate instantiation templates — NOT presets — addressed by NAME,
  never by their internal stable `id`. One-shot consult goes through `mpd-roles-plugin`; team work uses
  the **official Agent Teams plugin** (this bundle's `mpd-agent-team` / `mpd-tool-agent-team` /
  `mpd-ui-agent-team` rows); durable instances come from the **workmate library**
  (`mpd-workmate-plugin`). §13 defines roster, stable id, workmate and team-model slot precisely — read
  §13 before touching any of them.
- **THE TEAM RECORD IS OURS (team-plane split, 2026-09-30).** `mpd-team-core-plugin` owns the team
  (roster, board, DAG, `kind`/`attempt`/`round`/`verdict`) in `.mpd/team/teams/<id>.json`, served as
  **`mpdTeams`** and over the host route `/plugins/mpd-team/state`; `mpd-dsh-adapter` mediates the ONE
  execution seam, **`TeamExecutor`**, whose **native** backend (over `ctx.subagents.startContinuable`)
  is the DEFAULT and the official `dsh.team*` calls the FALLBACK. No mpd surface reads
  `dsh.teamLiveTeams()` any more. See `docs/plan-team-plane-split.md`.
- **The vendored `agent-teams` body is RETIRED (2026-09-27) AND REMOVED (2026-10-07)**: harness
  0.1.7-rc.2's official Agent Teams plugin replaced it, no loader row ever mounted it after the
  retirement, and the de-vendor wave deleted the tree outright. Its `agent_teams_*` tools, its
  `<workspace>/.mpd/team` record and its `mpd-delta` registry are NOT part of any shipped session, and
  no file here reads, copies, patches or fingerprints anything outside this repository. What SURVIVED
  the deletion was relocated into mpd-owned homes as our own code: the schemastery validator now lives
  in `packages/mpd-schemastery/**` (four shipped plugins import it) and the prebuilt browser client
  bundle in the web package, with the upstream MIT acknowledgement carried in `LICENSE-NOTICES.md`.
- **A dependency a bundle DECLARES is mounted by a row that needs it**: the three official Agent Teams
  packages are declared in `dependencies` and materialized by `dsh-app-boot`'s
  `healProfileModuleFallback` before the loader runs.
- **The persisted GOAL and ULW.** `mpd-goal-plugin` bridges the harness goal domain (`mpd_goal_status` /
  `mpd_goal_anchor` / `mpd_goal_finish` plus the `goal.*` auto-anchor contract); a run that ends
  `max-rounds` deliberately LEAVES ITS GOAL ARMED — the handoff to the harness's round driver — and goal
  mutations go through the harness goal TOOLS, never `ctx.goals`. `mpd-ulw-plugin` (C2 ultrawork v2)
  answers `/ulw <objective>` and `/ultrawork <objective>` by submitting the ULW activation directive as
  the invoking agent's OWN next user turn, so the run actually starts. Detail and evidence:
  `agent-references/overview-and-provenance.md`.
- **The session-start complexity gate is MECHANICAL — it stages an APPROVABLE PLAN SHELL, never a
  team.** The frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)` runs at the session's
  first pre-step and the notice keeps the marker `[AgentTeams] Session-start team rule`; on a trigger the
  gate STAGES a 0-member, 0-task plan shell through the `agent_teams_plan` tool and injects ONE notice
  naming the returned plan id — NOTHING is spawned, and the shell is INERT until the captain extends it
  (`add_member` / `create_task`) and approves it with `agent_teams_plan {action:"approve"}`. An explicit
  `team:` / `!team` request ALSO stages the shell (signal A) and has its marker CONSUMED from the goal
  text. `team.gate` in `mpd.jsonc` selects `mechanical` (the default) | `advisory` | `off`: without the
  tool mounted, or under `advisory`, the ONE notice is advisory and says `NO team was staged`, and the
  captain stages a team itself when the work warrants one — or continues solo and says so. Signal D is an
  ACTIVE boulder work for this workspace (`status: "active"` in `.mpd/boulder.json`) — a plan FILE alone
  is NOT a signal (repaired 2026-10-07). Softer signals and the retired path:
  `agent-references/overview-and-provenance.md`.
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
5. **Fingerprinted bytes, historical identity.** The assets this repository SHIPS are verified by their
   own fingerprints — a corrupted one still reddens — while the upstream identity behind them is
   PROVENANCE, a record of where an adaptation came from, never a dependency to re-fetch, re-sync or
   audit. We don't chase upstream, and we no longer need it to exist.
6. **Minimal diffs.** Prefer the smallest change that satisfies the requirement; no speculative refactors.

---

## 3. Repository Layout

```
mpd-dsh/
├── AGENTS.md                     # this manual
├── README.md / README.zh-CN.md   # public overview, bilingual pair (inheritance declared in README)
├── PLAN.md                       # port plan (Track A/B)
├── LICENSE.md / LICENSE-NOTICES.md
├── VENDOR_LOCK.json              # vendored asset fingerprints (+ the upstream recorded as a _note historical reference)
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
│   ├── mpd-verify-plugin/        # THE VERIFICATION LAW (§5): the ledger under .mpd/verify/, the five
│   │                             #   mpd_verify_* tools, the record validator and the receipt probe
│   ├── mpd-workmate-plugin/      # durable evolving agent library (~/.mpd/workmate)
│   ├── mpd-ulw-plugin/           # C2 ultrawork v2 engine: mpd_ultrawork + /ulw, /ultrawork
│   ├── mpd-mcp-astgrep / mpd-mcp-codegraph / mpd-mcp-gitbash / mpd-mcp-lsp / mpd-mcp-shared /
│   │                             # the MCP servers: AST search, code graph, git-bash, LSP, shared libs
│   ├── mpd-tools-plugin/         # B1: write guard, output truncation, edit-error recovery
│   ├── mpd-hashline-plugin/      # C3: anchored edit discipline (vendored hashline-core)
│   ├── mpd-boulder-plugin/       # C5: durable work ledger (vendored boulder-state); anchors a goal
│   ├── mpd-goal-plugin/          # C8: the persisted-GOAL bridge — mpd_goal_* + the `mpdGoal` service
│   │                             #   ULW/boulder auto-anchor from (`goal.*`, the anchors sidecar)
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
│   ├── mpd-tui-adapter-plugin/   # THE MPD<->DSH-TUI contact surface (`mpdTui`): the ONE file that may
│   │                             #   name a `ctx.tui*` seam, plus the R5 file log sink
│   ├── mpd-tui-plugin/           # the DSH-TUI edition's surface package (never names a `ctx.tui*` seam)
│   ├── mpd-bundle-plugin/        # bundle web-compat: the @mpd-dsh/mpd no-op main + the combined web client
│   └── mpd-qa-roles-probe/       # QA-only probe: mpd preset resolve + mpdRoles roster
├── extensions/                   # <bundle>/extensions/*/mpd-ext.json + the DISABLED mpd-ext-example
├── skills/                       # dsh-qa + our own cordis-dev + 16 ported upstream skills + svn-master
│                                 #   (SERVED by reference; cordis-dev adapts the harness's 创造模式 skills)
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

**Instruction budget (binding):** this manual is INJECTED into every session and the budget is
**65536 bytes**; a longer file is silently TRUNCATED, so a section past the cut stops binding unnoticed
(measured 2026-10-07: 65923 → `truncated … to 65244`, losing most of §13). This manual measured **64996 bytes** on 2026-10-07 —
only 540 B of margin, which is NOT headroom. The rule is therefore MOVE-FIRST: before adding to this
file, move a LONG FORM of comparable or larger size into `agent-references/` and leave a SHORT definition
**plus an exact pointer** — never drop the term — then re-measure and restore a margin above **2 KB**
(target **≤ 63.5 KiB / 65024 B**). A truncated manual is one whose tail silently stops binding, and a
reader cannot tell.

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts`; the corpus re-pin is DERIVED — `node scripts/repin-vendor.ts` (dry-run by default, `--check` asserts, `--write` applies; it REFUSES the repository's own `VENDOR_LOCK.json` without `--i-know-this-is-the-captains-step`, so a wave cannot re-pin mid-flight) — and lands in the commit that invalidated the `treeSha` (§9/§11). **The gate's subject is now the bytes this repo SHIPS**: it verifies the asset fingerprints and needs no upstream checkout, no network and no `.mpd-dsh/upstream`; every identity assertion that used to be part of its exit code is GONE (de-vendor wave, 2026-10-07), and a corrupted fingerprint still FAILS | any baseline/asset change; before release |
| **Verification law (STANDING)** | `mpd_verify_evidence {kind:"gate"}` runs the FIXED table (`gates`, `tests`, `typecheck`, `docs`, `manifest`, `comments`, `rows`, `vendor`, `dist`, `pack`) and `mpd_verify_record` REFUSES a PASS with no documents, no gate evidence, a forged evidence id or a same-agent verifier. Boot-level falsifier: `node skills/dsh-qa/scripts/verify-law.ts` (`--self-test` offline; otherwise the mounted-row boot — denial, the `verify.mode=off` control, the `docs/**` allowance) | any change under the law (§5), and every release sweep |
| Dist freshness | `node scripts/verify-dist-fresh.ts` (deterministic rebuild-and-diff of every `packages/*/src` entry against its committed `dist/`; unmatched `dist/` files print in a loud NOT COVERED section; the canonical REBUILD command — repo root, path-qualified args — and the package-directory trap are named in §6's Build line) | any `packages/*/src` or `dist/` change; before release |
| Row/parity | `bun run verify:rows` + `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | any bundle-patch / preset / overlay / row change |
| Pack closure | `node scripts/verify-pack-closure.ts` (completeness + the byte identity of files whose sources did not move; `--self-test` is the fixture-driven arm; `--pack-stamp <t>` re-anchors the comparison for a reviewer mutating a copy) | any pack, any post-pack writer, and the release sweep (§11) |
| Tests | `bun test` (per package) + `bun run typecheck` (root) | every plugin change |
| QA self-tests | `bun run test:qa` (all `--self-test`) | every plugin/QA-script change |
| QA real cases | `node skills/dsh-qa/scripts/<case>.ts` | runtime-behavior changes |
| Installer | `node scripts/install-profile.ts --dry-run` | any bundle-patch/installer change |
| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.ts`; ships `--self-test` with a negative control; recursive under `docs/`, `extensions/**/README.md` and `templates/**/README.md`; fails on a zh-only doc or an undocumented package) | any human-facing doc change (`README*.md`, `docs/**`, `packages/*/README*.md`, `extensions/**`, `templates/**`); before release |
| **Plugin manifest (STANDING — user-mandated)** | `bun run verify:manifest` (= `node scripts/verify-plugin-manifest.ts --pack`): **no `cordis`** in any dependency field (by NAME; the optional field is NOT an exemption), no `preinstall`/`install`/`postinstall`/`prepare` script NAME, VERSION COHERENCE (`dsh-plugin.json` + `dsh-distribution.json` carry `package.json`'s version), plus the packaging contract a one-command install rests on (declared patch files exist, every row module path resolves, the `files` allowlist admits every runtime path, `evidence/` stays out, and **npm's own `npm pack --dry-run` list carries them**) | every manifest/patch/row/file-layout/version change, and EVERY release sweep |
| **Declaration comments (STANDING — user-mandated)** | `bun run verify:comments` (= `node scripts/verify-comment-coverage.ts`): a TypeScript-AST check (never a line scan) that every declaration in its source set has a precise comment above it, and that every NAMED function writes down its parameter and return types | any source edit, and EVERY release sweep |
| No host override | `node scripts/verify-no-host-override.ts`: fails when ANY shipped patch row id-targets an id a host layer declares; refuses a vacuous PASS; `--self-test` 6 arms + a live seed | any bundle-patch row edit, and EVERY release sweep |
| Manual paths | `node scripts/verify-manual-paths.ts` (T-66: a path-shaped token this manual spells in a code span is AUDITED only when its first segment is an entry at the repo root; a non-root-anchored or non-literal token is counted in its own bucket and NEVER fails the run — so it catches a wrong ROOT-relative path, not a wrong package-relative spelling; the DECLARED anticipatory class and its rot guard print apart from the audited subjects) | any edit to this manual |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `bun scripts/mpd-ext.ts validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension MUST exit 1 with per-item errors) | any extension-interface/manifest/CLI change |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (host rows) and `node skills/dsh-qa/scripts/preset-conformance.ts` (the `mpd` preset's standing mount + every harness-owned row config; its negative control proves the assertion is falsifiable), or the `full-profile-boot.sh` / `mount-proof.sh` pattern with registration instrumentation | any patch change, any preset/row change, and REQUIRED for any tool-schema change |
| Composition only | `node scripts/dump-config.ts --profile <p>` (repo wrapper around the raw harness flag: prints the composition-only banner in its own output and propagates the child's exit code) | whenever a row/preset composition question is asked |
| **Docker real-machine (LAST step)** | `bun run verify:docker` (`node scripts/docker-e2e.ts`; `--mode source` = checkout, `--mode oneclick` = the PUBLISHED package, `--spec <install-spec>` = any spec including the live `github:` one). Builds a real `ubuntu:24.04` and asserts the INSTALL then the MOUNT (rows activating, tools registering, the TUI on a real PTY, `agentPreset=mpd`) — never merely "exit 0". **A machine without a ROOTLESS Docker PRINTS A NOTICE AND SKIPS (exit 0)**: rootless runs, rootful skips unless `--allow-rootful-docker`, an absent daemon skips, `--require-docker` makes any skip exit 3. A SKIP is not a pass — the steps ABOVE it carry the wave | every release sweep, and any install/mount-path change (`files`/`dsh.*`, a patch row, `docker/**`) |

The full former §4 body — the same table with its long per-row measurements and reasoning — is in
`agent-references/verification-flow.md`.

**The pack-closure bound (T-91):** a green `node scripts/verify-pack-closure.ts` certifies COMPLETENESS
plus the BYTE IDENTITY of every file whose source did not move; **freshness is NOT what the exit code
says** — it is read from the `expected-after-pack` list at the re-pack (T-26's discriminator: TIMESTAMP
ORDER). The gate's `--self-test` fixture arms are the operative evidence, not a grep for this paragraph.

`--dump-config` is NOT a gate: it COMPOSES rows and never executes plugin code, so a schema/apply abort
is invisible to it. Measured: it exited 0 with the `mpd-workmate` row present while the same profile's
real boot could not load the tree (`evidence/workmate/rename-delete-core/20260910T132303Z-mount/`).
**It proves COMPOSITION ONLY — never a plugin load.** Every instruction that sends a reader to the flag
goes through the repo wrapper `node scripts/dump-config.ts` (T-31), which prints that warning itself;
only passages that CONTRAST the flag keep the raw spelling on purpose.

No evidence on disk for a gate = the change is not complete. Merge to dev only after the relevant gates
pass and their evidence is committed with the change.

`bun run verify:gates` is the fast aggregate over the static gates (vendor, dist freshness, row parity,
doc pairs, preset conformance) — one command for a patch/preset edit and the release sweep — and it
expects a CLEAN tree: a dirty `skills/**` corpus reddens the vendor gate until the wave's single re-pin
lands (§9/§11).

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
- **Every change lands through a BRANCH + a PULL REQUEST — binding (user-set, 2026-10-06).** Nothing is
  committed straight to `dev` or `master`: cut a `feature/<slug>` or `fix/<slug>` branch, commit the wave
  there, push it, and open a PR against `dev`. **A PR DESCRIPTION IS BILINGUAL**: it carries BOTH an
  English body and a 简体中文 body, English first, as two sections of ONE description (`## English` then
  `## 简体中文`) — the same pair discipline the human-facing docs follow, applied to the review surface.
  A single-language PR description is not ready for review. Every PR body states, in both languages:
  what changed, the measured evidence (paths under `evidence/`), the gates run WITH their observed
  results, and the honest bounds — never a claim the evidence does not carry.
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
  4. **A-writes/B-verifies is MECHANICAL — the main agent does not write code, and it does not verify
     its own work.** The workspace's TOP-LEVEL `mpd` agent may not `write`/`edit` a code path unless a
     delegation+verification loop is armed (`mpd_verify_open {writer:"self", verifier:"<another
     agent>"}`), and every such write is COUNTED; the normal path is to hand the scope to a
     write-capable member. Code is verified by a DIFFERENT agent that works from the frozen contract
     and the docs — **never from the implementation** — with the verdict recorded BEFORE any
     implementation read; only a recorded FAIL unlocks implementation reading, for diagnosis, counted.
     A PASS with no cited documents or no gate evidence is REFUSED by the record validator, and a FAIL
     bounces the work back to a writer as a `kind=repair` task rather than being quietly fixed. Where
     the law cannot be mechanical (a composition with no `tools.guard` seam), the bound is STATED —
     the boot line says `verifyGate=absent` — never implied. The tool surface is one row,
     `mpd-verify-plugin`: `mpd_verify_open` / `_escape` / `_seat` / `_evidence` / `_record`, and the
     envelope denies a bound verifier the shell, the source-returning tools and every board mutation.
     **Two sentences this rule REPLACES**: "execute directly when it does not [help to delegate]" is no
     longer an option for code, and "verify everything a subagent claims yourself" is no longer how the
     main agent closes work — a claim is closed by a DIFFERENT agent's recorded verdict, and the main
     agent's own reading of a result is INTEGRATION, which is not verification.
  5. **The board has terminal verbs, and dispatch honours the declared owner.** `agent_teams_task`
     carries `complete`/`fail` (owner-only, optional `note`, optional `expected_revision`
     compare-and-set; a FAIL releases its dependents per OPT-1) — without them a dependency edge could
     never be satisfied and the DAG could not advance. `agent_teams_dispatch` pairs a ready task with
     its DECLARED owner when that member is free, and falls back to roster order ONLY with the reason
     reported on the pairing. A git WRITE command (`commit`, `add`, `rm`, `mv`, `checkout`, `switch`,
     `restore`, `reset`, `stash`, `merge`, `branch`, `rebase`, `tag`, `cherry-pick`, `revert`, `clean`,
     `apply`, `am`, `update-index`, `worktree`, `init`, `clone`) is denied for any session that is NOT
     the top-level captain — rule 1 above is now MECHANICAL for member sessions too, with the same
     honest bound: the matcher reads a command STRING, so an obfuscated invocation can evade it. It is
     a speed bump that makes the rule real for ordinary use, not a sandbox.

---

## 6. Plugin Authoring Guide

Structure per plugin package: `src/index.ts` (cordis `name`/`inject`/`apply`), `packages/<pkg>/dist/index.js`
(bun build), `README.md`, optional `package.json` with `@mpd-dsh/<name>` naming. **The full former §6 body
— the two adapter surfaces in detail, the adopted-plugin residual analysis, the delta-registry mechanics
and every adapter API signature — is in `agent-references/plugin-authoring.md`.**

- **Harness seams go through `mpd-dsh-adapter` — binding.** No plugin row may touch a harness service
  directly (`ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`, `ctx.commands`, `ctx.llm`);
  `packages/mpd-dsh-adapter-plugin` is the ONE file allowed to, so a harness release that renames or
  reshapes a seam is absorbed there instead of across every plugin. Resolve it with
  `const dsh = resolveDshAdapter(ctx)` (the mounted `mpdDsh` instance, or a row-private `createDshAdapter`
  so the plugin stays standalone in unit tests) — or `createLazyDshAdapter(ctx, { label })` when the row
  must also survive a transient "provider not ACTIVE yet" miss; the SEAM surface stays `src/index.ts`.
- **DSH-TUI seams go through `mpd-tui-adapter` — binding, the SAME rule on the second plane.** No file
  outside `packages/mpd-tui-adapter-plugin` may name a `ctx.tui*` service, nor the `commands`/`settings`
  services that plane uses; resolve it with `resolveTuiAdapter(ctx)` / `createLazyTuiAdapter(ctx,
  { label })`, binder = ONE deferred `ctx.inject([id], …)` PER SEAM, probe = `ctx.get(id, false)`, and a
  seam that never binds degrades to `absent` rather than failing the boot. Two gates pin it:
  `no-direct-tui-access` and `no-terminal-writes`. Full contract, the fifteen seams and the declared
  WEB-plane residual: `agent-references/seam-adapters.md`. **ONE DSH-TUI contact is NOT a seam, is
  COUNTED, and lives in that same adapter (2026-10-05)**: the host's `dashboard` (`Ctrl+A`) `useStdin`,
  reached by dynamic-importing `<root>/lib/types/ui.js` by file URL. Since 0.13.0 it is VERSION-GATED:
  the contact arms only while the `tuiPanels` seam is ABSENT (a pre-0.13.0 host), and on a host that
  offers the seam it stays inert — Ctrl+A keeps the host dashboard meaning and the merged view opens
  through `alt+a` / `/mpd panel`. Route any future host-internals
  need through this same adapter — never a second contact site.
- **A patch row NEVER id-targets a host-owned row — binding** (`node scripts/verify-no-host-override.ts`,
  §4). The deployment default preset is the USER's to choose, not the bundle's: `docs/preset-default.md`
  and `node scripts/set-default-preset.ts`.
- **There is NO adopted third-party plugin body any more — the de-vendor wave (2026-10-07) ended that
  chapter.** The vendored `dsh-agent-teams` tree, its adapter facade, its counted bypass inventory, its
  six bridged files, its five named residuals (R1–R5) and its `mpd-delta` registry were all deleted with
  the body. What remains is OUR code: the schemastery validator is `packages/mpd-schemastery/**`, the
  prebuilt browser client lives in the web package, and every shipped plugin — including every future
  one — reaches the harness through `mpd-dsh-adapter-plugin` (§6's binding seam rule). A historical
  account of the adopted era is in `agent-references/plugin-authoring.md`; nothing in the live tree
  depends on it.
- **State**: workspace-scoped only (`.mpd/` under the **calling session's workspace**, never the dsh
  process cwd); never write `~/.dsh` from a plugin. Every plugin resolves that root through the ONE
  adapter helper — `dsh.workspaceRoot(exec)` with precedence **session header cwd →
  `DSH_WORKSPACE_ROOT` → `process.cwd()`** — plus `dsh.workspaceRootsAll()` (the union of live session
  cwds, `[]` when the agent registry is absent) for agentless surfaces such as web routes — because one
  host serves many sessions with different workspaces. Resolve it PER CALL: never cache the root in a
  module-level const, never `chdir`, and never set `DSH_WORKSPACE_ROOT` from a row. An explicit
  row/config override (`boulder.dir`, `hashline.registryFile`, `memory.dir`, `ulw.planDir`,
  `config.projectFile`, `MPD_DSH_VERIF_VENV|WORK`) still wins over all of them. Evidence:
  `evidence/session-workspace-root/b1-resolution/`. Sanctioned exceptions: (1) the bundle writes NOTHING
  to the home any more — `mpd-bootstrap` serves `<bundle>/skills` by reference and the patch roots
  `agent-presets` at `<bundle>/presets` (§8); (2) the **workmate library** lives under the user's HOME
  (`~/.mpd/workmate`, §13) and QA must boot with `HOME=<sandbox>`; (3) **`mpd-codegraph`** keeps its
  index in `.codegraph/` under the workspace.
- **TypeScript is the only source language, run directly by Node — binding.** Every file this repository
  owns is `.ts` and runs as `node <file>.ts` (type stripping; `engines.node` states the floor). Four
  rules: **erasable syntax only** (no `enum`, `namespace`, parameter properties or decorators); **every
  relative specifier carries the explicit `.ts` extension**; `import type` for type-only imports; no
  `tsconfig`-`paths` mapping. `packages/*/src` differs in FORM only (`bun build` → `dist/*.js`,
  extensionless specifiers), and a genuine CommonJS module is spelled `.cts`. The ONLY JavaScript left is
  32 files, for a MEASURED reason (a shipped bundle sits under `node_modules`, where Node refuses to
  strip types) — the list is in `agent-references/troubleshooting.md` (last row). The converted ADOPTED
  body carries `@ts-nocheck` and its suite is out of the type program (`tsconfig.json`).
- **Every declaration is documented and every named function is fully typed — binding, enforced by
  §4's `verify:comments`.** A comment states the contract, unit, invariant or reason — never a
  restatement of the name; a local inside a function body counts as a declaration. Types are precise:
  `unknown` plus narrowing instead of `any`, an existing interface/type reused instead of a structural
  clone, and a cast only where narrowing is impossible, with a comment saying why.
- **Build — from the REPO ROOT, with path-qualified args**: `bun build
  packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`
  (a multi-entry package repeats it per entry, e.g. `packages/mpd-ext-plugin/src/sdk.ts` →
  `packages/mpd-ext-plugin/dist/sdk.js`). The canonical form matters (T-67): `bun build` writes every
  bundled module's path RELATIVE TO CWD into the artifact's path comments, and
  `node scripts/verify-dist-fresh.ts` reproduces THESE bytes — so a build run from a PACKAGE directory
  is flagged STALE even though it looks sanctioned. **BUILD WITH THE PINNED TOOLCHAIN, not the `bun` on
  your PATH** — this is a MEASURED trap (2026-10-07, T16): `package.json`'s `buildToolchain` pins
  `bun@1.4.0`, which lives at `.toolchain/node_modules/.bin/bun`, while a PATH `bun` on this machine is
  `1.4.2`; the SAME canonical command produced **24 of 30 targets STALE under 1.4.2 and 30/30 fresh under
  the pinned binary**, because a bun minor rewrites the injected helper preamble and
  `node scripts/verify-dist-fresh.ts` prefers the pinned binary SILENTLY — so a human following this line
  literally would ship a stale tree and only the gate would say so. Use
  `.toolchain/node_modules/.bin/bun build packages/<pkg>/src/index.ts --target node --format esm
  --outfile packages/<pkg>/dist/index.js`, or read the rebuild command the gate itself prints. Zero
  runtime deps preferred (type-only imports).
  **An ADAPTER edit fans out**: `bun build` INLINES every imported module, so touching
  `packages/{mpd-dsh,mpd-tui}-adapter-plugin/src` changes the emitted bytes of every package that
  imports it (measured: one adapter edit left 12 of 24 dist targets STALE). Rebuild each dependent with
  the pinned toolchain — see `agent-references/seam-adapters.md`.
- **Load/test**: a bundle row lives in the bundle, never ALSO in a QA overlay while it is already in the
  bundle — the loader rejects duplicate entry ids. QA boots a checkout through the dev-flavor rewrite
  (`devPatch()` in `skills/dsh-qa/scripts/preset-register.ts`).
- **Docstrings/comments**: English only.

---

## 7. QA Discipline (mirrors upstream, adapted)

**The full former §7 body — the isolation rationale, the session-log decode trap, the T-90 calibration
bound and the conformance failure modes — is in `agent-references/qa-discipline.md`.**

- Skill: `skills/dsh-qa` (SKILL.md + case scripts + references). Every script ships `--self-test`.
- **Isolation is THREE things, not one.** (a) `DSH_HOME=<mktemp>`: credentials copied ONCE into the
  sandbox, the sandbox path asserted, the real `~/.dsh` never read or written; env prereqs (sg/codegraph)
  copied only when present. (b) `HOME=<sandbox>` — skill roots leak through HOME (the provider's user
  roots are `<DSH_HOME>/skills` and `<agentsHome>/skills`, `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`;
  measured 2026-09-14: `SKILLS=24 BUNDLED=18` → FAIL). (c) A SANDBOXED WORKSPACE: `DSH_HOME`/`HOME` do
  NOT isolate workspace state, because every workspace root resolves from the session workspace
  (`dsh.workspaceRoot(exec)`), so every dsh spawn carries an explicit sandbox cwd
  (`sandboxWorkspace(sandbox)` from `skills/dsh-qa/scripts/lib/workspace-isolation.ts`) and each live
  case asserts no
  `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists (`assertSessionsSandboxed`). Without it an
  "isolated" boot writes real `<repo>/.mpd/team/*` records and the `.mpd/` state the in-use gate scans.
- Live-LLM cases must ALSO copy `settings.yaml` when present: homes whose keys come from gateway
  providers (`llm-pi-ai` providers — opencode-go/scnet) configure the chain there, and without it
  headless falls back to the base `deepseek-official` route → `MISSING_CREDENTIAL`.
- **Provability: assert a REAL tool result, never just "it ran".** For composition-only questions the
  subject is `--dump-config` rows — but that proves COMPOSITION ONLY and never a plugin load (§4): it
  does not execute plugin code, so it cannot witness an apply/schema abort. Anything about plugin
  BEHAVIOUR (a tool registered, a route answering, a schema accepted) needs a boot that MOUNTS the rows
  in an isolated `DSH_HOME` with registration instrumentation, or a real tool call.
- **A live case proves a tool call from the HARNESS's session log, never from the model's prose**
  (`skills/dsh-qa/scripts/lib/session-evidence.ts`). `tool/call.data.name` + a non-error `tool/result` is
  tool evidence; `request/header.data.header.tools[]` is tool-list evidence. Asserting a tool NAME
  against the model's ANSWER is wrong in BOTH directions — both measured (`codegraph-smoke`,
  `evidence/dsh-qa/codegraph/`). The store is a CONCATENATED-ZSTD-FRAME container, so decode frame by
  frame (a naive single `zstdDecompressSync` sees the header frame only and reports "no tool call").
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- **Durable anchors (T-90): an ARTIFACT PATH is the anchor — a mailbox id is not a link.** A line
  pointer rots by an EDIT (T-55) and a mailbox id rots by a MAILBOX CLEARING, so the artifact is the
  primary anchor, the relay is secondary, and the id is provenance, not an anchor; a seat that must cite
  an EXCHANGE copies the quoted bytes into its own artifact. This is a CLASS rule, not a pattern hunt.
- **Derived surfaces are declared at PLAN time (T-88): `packages/*/dist/**`, `dist/mpd-package/**`,
  `VENDOR_LOCK.json` and `.mpd/plans/**` belong to the INTEGRATION task's `inScope` at CREATION.** A
  LANE must not declare a `dist/**` pattern for itself (the platform's `inScope overlaps` validator
  refuses exactly that, measured): pre-declare the derived path on the task whose edits redden it, and
  request a mid-wave escape as a HOP — exact amendment text in ONE message, no work attached.
- **Preset/row conformance against the INSTALLED harness** (`preset-conformance`, required for any
  preset/patch/overlay change): a row config is validated with the installed plugin's own schemastery
  `Config`, because that is what the loader runs, and the `mpd` preset's row set is pinned against the
  installed `standard` preset (a missing row is a capability every mpd session loses). `--dump-config`
  and every `--self-test` that never creates a session are blind to this class — only a real mount is
  not.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- **Verify on SETTLED hashes, and quote a hash WITH its measurement moment.** Pin the revision by hash,
  re-check it after a short settle window (wave 2 used 50 s), then run the contract, anchoring every
  verdict to the hashes you measured; state the UTC instant each hash was read (second precision) and
  sandwich a verifier's read — hash → work → re-hash, start == end after the settle window.
- Shell caveat: long-lived MCP children hold inherited fds — run dsh with stdio to FILES (`spawnSync`
  with `stdio: ['ignore', fd, fd]`) or background + log-file redirection, never pipes.

---

## 8. Installer & Profiles

**The full former §8 body — the one-command install in detail, the build-script-free dependency closure,
the packed-artifact layout and the legacy flow's measurements — is in
`agent-references/installer-and-profiles.md`.**

### The mounting contract — BINDING (user-set)

**A row reaches the harness ONLY through `cordis.patch.yml` + the profile mechanism.** Concretely:
(a) the deliverable is an INDEPENDENT PACKAGE (`@mpd-dsh/mpd`) whose `dsh.bundle.patch` array names its
patch layers — this bundle's `cordis.patch.yml` (host rows) and `presets/mpd.patch.yml` (the `mpd` preset
as an ordinary row); (b) the profile mechanism is the only way in: `dsh plugin --profile <p> add <spec>`
installs the package, `reconcile` validates that the patch files load and appends the package name to
`dsh.profile.bundles`, and the rows resolve from `<profile>/node_modules`; (c) this repository NEVER
edits DSH sources, NEVER writes a profile by hand and NEVER pushes a row into `<DSH_HOME>` (the retired
escape hatches — a home `cordis.patch.yml`, a copied `skills/` tree, a preset directory — are dev/QA
flows or removed outright); (d) uninstall is the mirror image, one command, leaving no residue except the
user's own `~/.mpd/workmate`. A capability that arrives by any other route is a defect, not a shortcut —
`verify-plugin-manifest --pack` plus the Docker lane hold this line.

### Primary flow: ONE command, no extra step

- **The USER-facing install is ONE command against the PUBLISHED package — no clone, no build:**
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` (or `… add @mpd-dsh/mpd` once it is on the
  registry). pnpm packs it through the manifest's **`files` allowlist**, then `reconcile` reads the
  installed package's `dsh.bundle.patch` files, validates that they load, and appends the package name to
  `dsh.profile.bundles` — that pair is what makes the mount travel through `cordis.patch.yml` + the
  profile mechanism and NOTHING else. Proof: the live lane (`node scripts/docker-e2e.ts --mode oneclick
  --spec github:HaroldZ32/My-Power-Dsh`) on a bare `ubuntu:24.04`.
- **A plain `github:<owner>/<repo>` spec resolves the repository's DEFAULT BRANCH** (measured 2026-09-28:
  it served `master` while the wave sat on `dev`, so the install ran OLD code). An installable wave is
  RELEASED to the default branch (§11); a dev install must name the ref
  (`github:<owner>/<repo>#dev`).
- **`cd <repo> && dsh plugin --profile web add .`** is the whole install from a CHECKOUT. The repo root IS
  the bundle package: `package.json` is named `@mpd-dsh/mpd` and declares `dsh.bundle.patch` (an ARRAY:
  `./cordis.patch.yml` then `./presets/mpd.patch.yml`), `dsh.client` (`platform: web`), the `exports` map
  the rows resolve through (`./packages/*`, `./skills/*`, `./presets/*` and the `client` subpath) and the
  toolchain `optionalDependencies`. `dsh plugin remove @mpd-dsh/mpd` is the one-command uninstall.
- **The published dependency closure is BUILD-SCRIPT-FREE on purpose**: pnpm 11 hard-exits on unapproved
  dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`) and the CLI `dsh plugin add` has no approval
  channel, so `dsh-better-sidebar` is an optional PEER + a `devDependency` (its `node-pty` postinstall is
  the offending script; its row's mount guard disables it when absent) and `@ast-grep/cli` +
  `@code-yeongyu/comment-checker` left `optionalDependencies`.
- Every path-bearing patch value resolves through the loader's `baseUrl` (the profile directory), so the
  same patch works for a checkout install and for a packed install. The `mpd` preset and the skill corpus
  are SERVED by reference (the `preset-mpd` row → the inline plugin list, `mpd-bootstrap` →
  `<bundle>/skills`) — no home copy, so uninstall leaves no residue.
- **`node scripts/pack-mpd.ts` (alias `npm run pack`) is the RELEASE step, not an install step**: it
  assembles the relocatable `dist/mpd-package/` (tarball installs: `dsh plugin --profile web add
  dist/mpd-package`); a checkout install never needs it.
- **After a code change:** rebuild the touched package's `dist/` (`bun build …`) and restart dsh — a
  `link:` install reads the checkout directly. Re-pack only when the distribution artifact must be
  refreshed, and bump `package.json` version for releases.

### Dev/QA flow (legacy): `scripts/install-profile.ts`

- `node scripts/install-profile.ts --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
  Default is `--dry-run`: print, never write; `--dsh-home` enables isolated QA installs. It writes the
  home `cordis.patch.yml` with absolute paths (existing rows id-targeted, new rows via `insert:`) and
  presets → `$DSH_HOME/.agent-presets/`. Superseded by the packed bundle for user installs.
- Never run the installer against the real home from a QA context; that is what `--dsh-home` is for.

---

## 9. Vendor & Baseline

- `VENDOR_LOCK.json`: upstream commit/version/stats recorded as HISTORICAL provenance, plus per-asset
  `fileCount` + `sha256` (single file) or `treeSha` (dir, sorted relpath + per-file sha256). **The
  FINGERPRINTS are blocking; the identity half is a record.** Since the de-vendor wave (2026-10-07)
  nothing reads, copies, patches or audits the upstream repositories, so the gate needs no checkout and
  no network, and the MCP servers' sources are snapshotted in-repo (`vendor/mcp-src/**`) as a build-time
  input — a PACKED install ships the built `dist/` and not the ability to rebuild it from source, which
  is a declared bound rather than an omission.
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

**The full glossary — every term with its long form, plus the 0.1.7 preset-form change — is in
`agent-references/glossary.md`.** The three definitions this section is CITED for (roster, team-model
slot, workmate) stay here.

- **roster**: the specialist roster served by `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` /
  `mpd_role_persona`) as teammate instantiation templates for the OFFICIAL Agent Teams plugin
  (`spawn_teammate`, whose persona the captain takes from `mpd_role_persona`). The eleven members are
  addressed by NAME: Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer,
  Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The stable `id` is INTERNAL — exposed by NO
  tool output, render, web route or GUI. The **read-only discipline is the exported deny list**, exactly
  seven names, identical in `mpd-roles-plugin` and `mpd-workmate-plugin` (asserted by `roles.test.ts`):
  `write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`,
  `mcp__lsp__rename` (a shell writes files, so `bash` stays denied; `read`/`glob`/`grep` stay available).
  **Do NOT re-add `str_replace_editor` / `apply_patch`, and do not filter the list with `dsh.hasTool`** —
  the harness validates the WHOLE list at spawn time, so one dead entry breaks every read-only spawn.
  Full form, including the two enforcement surfaces: `agent-references/glossary.md`.
- **team-model slot**: one of the FOUR configurable default model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` in `mpd.jsonc` / the `mpd` settings
  namespace. Slot 1 routes Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/
  Plan Reviewer, slot 3 Deep Worker/Junior Engineer, slot 4 Vision Analyst (the vision member — its model
  MUST accept image input). A slot that cannot be resolved fails the spawn LOUDLY, naming the member and
  the slot, writes no state and NEVER clamps an effort. Slots apply to the ONE-SHOT paths AND to an
  official `spawn_teammate` (routed through `mpd-roster-provider-plugin`); because the team service does
  not forward identity, **a teammate `description` that NAMES a roster member routes that member — one
  that does not inherits the Lead's route**. **Long form — the default models, the effort defaults and the
  routing history: `agent-references/glossary.md`.**
- **verifier's envelope**: the tool and path boundary a BOUND VERIFIER SEAT works inside, enforced by the
  same `guardTool` install as the captain's write rule (`packages/mpd-roles-plugin/src/verify-guard.ts`,
  decided by the pure functions in `packages/mpd-verify-plugin/src/law.ts`). A seat is bound with
  `mpd_verify_seat`; from then on it may not call the shell, the source-returning tools or any board
  mutation (`mpd_verify_*` excepted — those ARE its job), its reads are path-scoped to the frozen docs and
  the documentation band while it is BLIND (a bare path argument is refused), its writes are confined to
  `.mpd/verify/**`, and a recorded FAIL unlocks implementation reading for DIAGNOSIS, COUNTED. Blindness is
  PROVEN by the plugin's own observation log, never asserted. **Long form — the full tool lists, the
  scoping rules and the ratchet: `agent-references/glossary.md` ("verifier's envelope").**
- **workmate**: a durable, evolving agent instance in `~/.mpd/workmate/` created by `mpd-workmate-plugin`
  (`mpd_workmate_*`) from a roster BASE template with an independent name; it self-summarizes after each
  work (persona + independent memory, size-capped) and keeps a short note card. Reuse is via
  `mpd_workmate_match`; weak matches must NOT be forced — initialize a new workmate instead. Two rules a
  caller must know: **the directory name IS the instance key** (`meta.name` is only a display mirror), and
  `delete` is ARCHIVE-FIRST (permanent only with `purge: true` + `confirm === name`), with both mutations
  refused while the workmate is in use. A base is addressed by its functional NAME only; `baseId` is
  internal provenance no tool output, web route or GUI ever exposes. **Long form — the full tool surface,
  the archive path and the naming rules: `agent-references/glossary.md`.**
