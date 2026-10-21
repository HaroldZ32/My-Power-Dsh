# AGENTS.md — my-power-dsh Repository Manual

This document is the binding operating manual for this repository. It is read by both humans and
agents. Where this document and habit disagree, this document wins. Agent-facing content in this
repository is English-only (see Language Policy).

**This manual is harness-agnostic.** Most of it — the git model, the gates, the plugin rules, the QA
discipline, the release process — binds any agent working in this tree, whatever harness runs it. Only
the passages that name a `mpd_*` tool, the `mpd` preset or DSH-wide state describe behaviour of THIS
bundle, and each of those says so. An agent without those tools still owes every rule in §4, §5, §6, §9
and §11.

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
  LINKING file's own directory, a ROOT-relative `/`-spelled one against the REPO ROOT, a `#fragment` is
  stripped first, a directory counts, and external URLs, in-page anchors and code spans are ignored.
  A zh-CN doc with no EN twin, a non-exempt package with no README and an unresolved target are
  violations.
- **Classification is DECLARED, not directory-sensitive**: a `*.md` carrying `<!-- docs-parity: doc -->`
  is a doc wherever it lives, so a misplaced doc reddens instead of escaping. A file kept VERBATIM as
  provenance is exempt from the link check (its dead targets print as EXEMPT); in a packed copy with no
  root `AGENTS.md` an unresolved target is a NOTE (T-75).
- **The agent-facing band is deliberately OUT of that discovery.** `agent-references/**` is
  agent-facing content, so it is English-only and ships no `*.zh-CN.md` twin; the docs gate does not
  discover that tree (T-28). An English-only agent document belongs OUTSIDE `docs/` — never inside a
  band whose every `*.md` is policed.
- **A lone file exempts ITSELF, not by a hand-maintained list**: a doc carrying
  `<!-- docs-parity: exempt <reason> -->` is reported with that reason, and the same doc without the
  marker is a normal policed file (T-30). The policy classes named BY GLOB (`docs/plan-*.md`) stay a
  declared pattern, and the two ANTICIPATORY paths (`docs/adder4.md`, `docs/cnt8.md`) print as their own
  class, so an exemption for a missing file cannot rot silently.
- Process records exempt from the bilingual requirement (see §3): internal QA/golden reference docs;
  plan files (`docs/decisions.md`); prior-phase reports (`docs/bline-report.md`, `docs/omo-parity-gap.md`,
  `docs/review-p0-p3.md`, `docs/track-a-report.md`, `docs/ulw-deepseek-optimization.md`,
  `docs/tui-edition-report.md`). Every remaining human-facing doc is policed; the upstream
  acknowledgements live in `LICENSE-NOTICES.md`.

## Reference Index (on-demand)

The manual's bulk reference material lives in `agent-references/` — **agent-facing, English-only**
files (`verify:docs` does not discover this tree). They are deliberately NOT named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the loader never injects them: **open them on demand** when a
pointer here or in a section sends you there. `§1`–`§13` stay in place, so every `§N` citation from
code, scripts and docs still resolves. The register is `agent-references/index.md`.

| File | Holds | Open it when |
|---|---|---|
| `agent-references/troubleshooting.md` | the full symptom → cause/fix table (the former body of §12, moved verbatim 2026-09-17 by the T-22 instruction-budget split) | a boot, gate, tool or team behaviour is wrong — look the symptom up before inventing a fix |
| `agent-references/repository-layout.md` | the map of §3: every root entry, every `packages/<dir>` and what each one owns (moved VERBATIM 2026-10-08) | you need to know where a file, a package or a gate lives |
| `agent-references/verification-flow.md` | the ordered verification flow behind §4/§11 — AND the former §4 body verbatim (the full gate table with every per-row measurement), the Docker-lane policy, and "§5 rule 2 — the captain's tool pack" | you run a verification pass, or a Docker step skipped |
| `agent-references/seam-adapters.md` | §6's two contact surfaces: the harness adapter and the DSH-TUI adapter, the fifteen `tui*` seams with their binder/probe/degrade discipline, the R5 rule and its gates, the WEB-plane residual | you touch a `ctx.tui*` seam, an MPD log sink, an MCP launcher's stdio, or add a THIRD contact surface |
| `agent-references/overview-and-provenance.md` | the full §1 body: what the bundle carries from upstream, the retired agent-teams body, the declared-dependency mount mechanism, the ULW/GOAL detail and the gate's softer signals | you need the provenance or composition history before restating it |
| `agent-references/plugin-authoring.md` | the full §6 body: the adapter surfaces, the counted host-setup bypass, the R1–R5 residuals, the tool/guard/waterfall/subagent API signatures and the state-resolution rules | you author or debug a plugin row or need an exact adapter signature |
| `agent-references/qa-discipline.md` | the full §7 body: the triple-isolation rationale, the session-log decode trap, the T-90 calibration bound and the conformance failure modes | you set up a QA lane or a conformance case reddens without a cause |
| `agent-references/installer-and-profiles.md` | the full §8 body: the one-command install, the build-script-free dependency closure, the packed layout and the legacy `install-profile.ts` flow | you change `files`/`dsh.*`, a patch row or an install path |
| `agent-references/glossary.md` | the full §13 body: every glossary term (DSH, bundle, patch layer, preset and the 0.1.7 preset-form change, mpd, golden) plus the long forms of roster/workmate/slot/verifier's-envelope | a term's long form or history is needed |
| `agent-references/context-discipline.md` | HOW to work cheaply in this repository: the instruction budget and MOVE-FIRST, output hygiene for spawns/gates/`gh api`, session and handoff discipline, evidence-and-measurement rules | you are starting a wave, about to edit this manual, or the session is running out of context |

---

## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **From upstream**: the roster's names and
stable ids, the model-chain vocabulary and a pinned capability baseline —
`code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded in `VENDOR_LOCK.json` as
HISTORICAL provenance). **That upstream is a REFERENCE, not a dependency**: nothing in this tree reads,
copies, patches, fingerprints or audits its sources, nothing needs a checkout, and no gate fails when it
is unreachable. **Ours**: the DSH plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream
spec parity (`docs/feature-audit.md`) is an engineering reference, not an identity label. The skill
corpus is MIT (re-sourced from `lazycodex`), the 11 persona texts were re-sourced from permissively
licensed public agent prompts, and the vendored cores, MCP servers and adopted agent-teams body were
replaced or deleted. License: **MIT** (`LICENSE.md`); third-party components keep their own licences in
`LICENSE-NOTICES.md`. Composition and provenance narrative:
`agent-references/overview-and-provenance.md`.

- **Naming.** Our prefix is **`mpd`** (packages, plugin ids, tool names `mpd_*`, preset id `mpd`, env
  keys `MPD_DSH_*`, state dir `.mpd`). Three deliberate exceptions: DSH plugin names
  (`@deepseek-ai/dsh-llm-deepseek`, `dsh-llm-pi-ai`, `dsh-mcp-client`, …) are the host's API and are
  never renamed; **adopted plugins keep their plugin ids and tool names** (the `context7`/`grep_app`
  remote MCP rows follow the same rule); and the two vendored env keys (`MPD_AST_GREP_SG_PATH`,
  `MPD_CODEGRAPH_BIN`) are read by upstream vendored code.
- **Roster.** The 11 specialists are teammate instantiation templates — NOT presets — addressed by NAME,
  never by their internal stable `id` (§13). Single-call consult: `mpd-roles-plugin` (one bounded
  delegation, one report; the harness keeps the child CONTINUABLE — listed `inactive`, resumable with
  `send_message`); team work: the **official Agent Teams plugin**; durable, evolving instances: the
  **workmate library** (`mpd_workmate_spawn` — the same spawn mechanics, plus persona/memory).
- **THE TEAM RECORD IS OURS (team-plane split, 2026-09-30).** `mpd-team-core-plugin` owns the team
  (roster, board, DAG, `kind`/`attempt`/`round`/`verdict`) in `.mpd/team/teams/<id>.json`, served as
  `mpdTeams` and over `/plugins/mpd-team/state`; `mpd-dsh-adapter` mediates the ONE execution seam,
  **`TeamExecutor`** — its native backend (the `startActivation` seam on 0.2.1+, the retired
  `startContinuable` below it) is the DEFAULT, and the official `dsh.team*` calls are the FALLBACK. NO
  mpd surface treats `dsh.teamLiveTeams()` as truth: the RECORD is authoritative everywhere, and the
  official call remains only the contained FALLBACK for a composition that runs the official executor
  (the team-compact read, the TUI team state and the watchdog).
- **The vendored `agent-teams` body is RETIRED (2026-09-27) AND REMOVED (2026-10-07)** — harness
  0.1.7-rc.2's official Agent Teams plugin replaced it and the de-vendor wave deleted the tree, so its
  `agent_teams_*` tools and its `mpd-delta` registry belong to no shipped session.
  `packages/mpd-schemastery/**` and the prebuilt browser client bundle SURVIVED as our own code.
- **A dependency a bundle DECLARES is mounted by a row that needs it** — the official Agent Teams
  packages are declared in `dependencies` and materialized by `dsh-app-boot`'s
  `healProfileModuleFallback` before the loader runs.
- **The persisted GOAL and ULW.** `mpd-goal-plugin` bridges the harness goal domain (`mpd_goal_status` /
  `mpd_goal_anchor` / `mpd_goal_finish` plus the `goal.*` auto-anchor contract); a run that ends
  `max-rounds` deliberately LEAVES ITS GOAL ARMED, and goal mutations go through the harness goal TOOLS,
  never `ctx.goals`. `mpd-ulw-plugin` answers `/ulw` and `/ultrawork` by submitting the ULW activation
  directive as the invoking agent's OWN next user turn, so the run actually starts.
- **The session-start complexity gate ships ON (default `mechanical`) — it stages an APPROVABLE PLAN
  SHELL, never a team.** The frozen predicate `trigger = explicit flag OR (matchedSignals >= 1)` runs at
  the session's first pre-step under the marker `[AgentTeams] Session-start team rule`; on a trigger the
  gate stages a 0-member, 0-task plan shell through `agent_teams_plan`, which is INERT until the captain
  extends it (`add_member` / `create_task`) and approves it. An explicit `team:` / `!team` request also
  stages the shell (signal A) and has its marker CONSUMED from the goal text. `team.gate` in `mpd.jsonc`
  selects `mechanical` (**the default again since the 2026-10-20 restore**) | `advisory` | `off`; with the
  tool unmounted or under `advisory` the ONE notice says `NO team was staged` and the captain stages a team itself when the work
  warrants one — or continues solo and says so. Signal D is an ACTIVE boulder work for this workspace
  (`status: "active"` in `<workspace>/.mpd/boulder.json`, gitignored RUNTIME STATE); a plan FILE alone is
  NOT a signal. Softer signals and the retired path: `agent-references/overview-and-provenance.md`.
- **The ONLY shipped preset is `mpd`** — the main working agent — which also carries the
  project-instruction convention: every session MUST attempt to read `AGENT.md` (falling back to
  `AGENTS.md`, then `CLAUDE.md`) via `dsh-agent-instructions`.

---

## 2. Principles

1. **The agent is the worker.** Everything here optimizes for an agent that reads the repo cold and
   behaves correctly: explicit conventions, executable gates, evidence on disk.
2. **Plugin form.** Every delivered capability is a DSH cordis plugin (self-written) or an official
   plugin instance configured in the bundle patch. No logic in profiles, scripts, or the user home.
   **Mounting is by `cordis.patch.yml` + the profile mechanism and NOTHING else — binding** (§8): this
   repository is an independent PACKAGE the profile references; it never injects rows into the harness,
   never edits DSH sources, and never writes the home by hand.
3. **Evidence without evidence is incomplete.** A change without QA evidence is not done.
4. **Isolation.** QA never touches the real `~/.dsh`. Everything boots in a temp DSH_HOME.
5. **Fingerprinted bytes, historical identity.** The assets this repository SHIPS are verified by their
   own fingerprints — a corrupted one still reddens — while the upstream identity behind them is
   PROVENANCE, never a dependency to re-fetch, re-sync or audit.
6. **Minimal diffs.** Prefer the smallest change that satisfies the requirement; no speculative refactors.

---

## 3. Repository Layout

**The full map — every root entry, every package directory and what each one owns — is in
`agent-references/repository-layout.md` (on demand; moved there VERBATIM on 2026-10-08 by the
instruction-budget split).** The root IS the bundle package `@mpd-dsh/mpd`: `package.json` carries
`dsh.bundle.patch` (the patch ARRAY) and `dsh.client`, `cordis.patch.yml` is the host-plane patch layer,
`presets/` holds the `mpd` preset row, `packages/` holds one plugin package per directory, `skills/` is
the served skill corpus, `scripts/` holds the gates / packer / installer, `templates/` and `extensions/`
are the author-facing scaffolds and the extension root, and `docs/` / `agent-references/` / `evidence/`
are the human-facing docs, the on-demand agent reference and the QA records.

Each `packages/<pkg>/README.md` holds that plugin's own contract — this tree is a map, not a
specification.

**Instruction budget (binding):** this manual is INJECTED into every session and the budget is
**65536 bytes** (`agent-instructions.config.maxBytes` in `presets/mpd.patch.yml`); a longer file is
silently TRUNCATED, so a section past the cut stops binding unnoticed. The rule is **MOVE-FIRST**: before
adding to this file, move a LONG FORM of comparable or larger size into `agent-references/` and leave a
SHORT definition **plus an exact pointer** — never drop the term — then re-measure. Keep a margin of at least
**2 KB** below the cut (the historical target was **≤ 63.5 KiB / 65024 B**). A truncated manual is one whose tail silently stops binding,
and a reader cannot tell. Measured re-baselines: 2026-10-07 **65923 → 65244** (truncated), 2026-10-08
**60456**, the harness-021 rollback **62650**, and the 2026-10-20 context diet — whose measured sizes are
recorded in `agent-references/context-discipline.md`.

---

## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts`; the corpus re-pin is DERIVED — `node scripts/repin-vendor.ts` (dry-run by default, `--check` asserts, `--write` applies; it REFUSES the repository's own `VENDOR_LOCK.json` without `--i-know-this-is-the-captains-step`) — and lands in the commit that invalidated the `treeSha` (§9/§11). Its subject is the bytes this repo SHIPS: asset fingerprints, no upstream checkout, no network; a corrupted fingerprint still FAILS | any baseline/asset change; before release |
| **Verification law (STANDING)** | `mpd_verify_evidence {kind:"gate"}` runs the FIXED table (`gates`, `tests`, `typecheck`, `docs`, `manifest`, `comments`, `rows`, `vendor`, `dist`, `pack`) and `mpd_verify_record` REFUSES a PASS with no documents, no gate evidence, a forged evidence id or a same-agent verifier — the guarantee lives in those TOOLS, not in a hook (2026-10-17 ruling; §5 rule 4). Boot-level falsifier: `node skills/dsh-qa/scripts/verify-law.ts` (its `--self-test` runs offline; the boot line reports `verifyGate=absent reason=…`) | any change under the law (§5), and every release sweep |
| Dist freshness | `node scripts/verify-dist-fresh.ts` (deterministic rebuild-and-diff of every `packages/*/src` entry against its committed `dist/`; unmatched `dist/` files print in a loud NOT COVERED section; the canonical REBUILD command and the package-directory trap are in §6) | any `packages/*/src` or `dist/` change; before release |
| Row/parity | `bun run verify:rows` + `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | any bundle-patch / preset / overlay / row change |
| Pack closure | `node scripts/verify-pack-closure.ts` (completeness + byte identity of files whose sources did not move; `--self-test` is the fixture-driven arm; `--pack-stamp <t>` re-anchors the comparison) | any pack, any post-pack writer, and the release sweep (§11) |
| Tests | `bun test` (per package) + `bun run typecheck` (root) | every plugin change |
| QA self-tests | `bun run test:qa` (all `--self-test`) | every plugin/QA-script change |
| QA real cases | `node skills/dsh-qa/scripts/<case>.ts` | runtime-behavior changes |
| Installer | `node scripts/install-profile.ts --dry-run` | any bundle-patch/installer change |
| Doc pairs | `bun run verify:docs` (`scripts/verify-docs-parity.ts`; `--self-test` with a negative control; fails on a zh-only doc or an undocumented package) | any human-facing doc change (`README*.md`, `docs/**`, `packages/*/README*.md`, `extensions/**`, `templates/**`); before release |
| **Plugin manifest (STANDING — user-mandated)** | `bun run verify:manifest` (= `node scripts/verify-plugin-manifest.ts --pack`): **no `cordis`** in any dependency field (by NAME; the optional field is NOT an exemption), no `preinstall`/`install`/`postinstall`/`prepare` script NAME, VERSION COHERENCE (`dsh-plugin.json` + `dsh-distribution.json` carry `package.json`'s version), plus the packaging contract a one-command install rests on (declared patch files exist, every row module path resolves, `files` admits every runtime path, `evidence/` stays out, `npm pack --dry-run` carries them) | every manifest/patch/row/file-layout/version change, and EVERY release sweep |
| **Declaration comments (STANDING — user-mandated)** | `bun run verify:comments` (= `node scripts/verify-comment-coverage.ts`): a TypeScript-AST check (never a line scan) that every declaration in its source set has a precise comment above it, and that every NAMED function writes down its parameter and return types | any source edit, and EVERY release sweep |
| No host override | `node scripts/verify-no-host-override.ts`: fails when ANY shipped patch row id-targets an id a host layer declares; refuses a vacuous PASS; `--self-test` 6 arms + a live seed | any bundle-patch row edit, and EVERY release sweep |
| Manual paths | `node scripts/verify-manual-paths.ts` (T-66: a path-shaped token this manual spells in a code span is AUDITED only when its first segment is an entry at the repo root; a non-root-anchored or non-literal token is counted in its own bucket and NEVER fails — so it catches a wrong ROOT-relative path, not a wrong package-relative spelling) | any edit to this manual |
| Extension CLI | `bun scripts/mpd-ext.ts --self-test` + `bun scripts/mpd-ext.ts validate extensions/mpd-ext-example` (exit 0; a deliberately broken extension MUST exit 1 with per-item errors) | any extension-interface/manifest/CLI change |
| Boot check (MOUNT) | a boot that really applies the rows in an isolated `DSH_HOME` + sandbox `HOME` — e.g. `bun skills/dsh-qa/scripts/bundle-lifecycle.ts` (host rows) and `node skills/dsh-qa/scripts/preset-conformance.ts` (the `mpd` preset's standing mount + every harness-owned row config; its negative control proves the assertion is falsifiable) | any patch change, any preset/row change, and REQUIRED for any tool-schema change |
| Composition only | `node scripts/dump-config.ts --profile <p>` (repo wrapper around the raw harness flag: prints the composition-only banner itself and propagates the child's exit code) | whenever a row/preset composition question is asked |
| **Docker real-machine (LAST step)** | `bun run verify:docker` (`node scripts/docker-e2e.ts`; `--mode source` = checkout, `--mode oneclick` = the PUBLISHED package, `--spec <install-spec>` = any spec including the live `github:` one). Builds a real `ubuntu:24.04` and asserts the INSTALL then the MOUNT (rows activating, tools registering, the TUI on a real PTY, `agentPreset=mpd`). **A machine without a ROOTLESS Docker PRINTS A NOTICE AND SKIPS (exit 0)**: rootless runs, rootful skips unless `--allow-rootful-docker`, an absent daemon skips, `--require-docker` makes any skip exit 3. A SKIP is not a pass | every release sweep, and any install/mount-path change (`files`/`dsh.*`, a patch row, `docker/**`) |

The full former §4 body — the same table with its long per-row measurements and reasoning, and why the
Docker lane is LAST — is in `agent-references/verification-flow.md`.

**The pack-closure bound (T-91):** a green `node scripts/verify-pack-closure.ts` certifies COMPLETENESS
plus the BYTE IDENTITY of every file whose source did not move; **freshness is NOT what the exit code
says** — it is read from the `expected-after-pack` list at the re-pack (T-26's discriminator: TIMESTAMP
ORDER). The gate's `--self-test` fixture arms are the operative evidence.

`--dump-config` is NOT a gate: it COMPOSES rows and never executes plugin code, so a schema/apply abort
is invisible to it (measured: it exited 0 with the `mpd-workmate` row present while the same profile's
real boot could not load the tree). **It proves COMPOSITION ONLY — never a plugin load.** Every
instruction that sends a reader to the flag goes through the repo wrapper `node scripts/dump-config.ts`
(T-31), which prints that warning itself.

No evidence on disk for a gate = the change is not complete. Merge to dev only after the relevant gates
pass and their evidence is committed with the change.

`bun run verify:gates` is the fast aggregate over the static gates — **nine members: vendor, dist
freshness, row parity, doc pairs, preset conformance, plugin manifest, comment coverage, graph model,
workflows** — one command for a patch/preset edit and the release sweep — and it
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
  race on the single `.git/HEAD`. Measured (2026-09-14): a member's `reset HEAD~1` landed on `dev`,
  moving the tip back one commit (the reflog held every step; recovery cost a forensics pass). A
  teammate NEVER runs `commit`/`add`/`checkout`/`switch`/`reset`/`stash`/`merge`/`branch`/`rebase`/`tag`;
  it edits files, runs gates and writes evidence, and the **captain alone** commits and branches — or the
  captain serializes ONE delegated writer and freezes everyone else first. Read-only
  `status`/`log`/`diff`/`show`/`grep` stay open to all. Tag `backup/<branch>-<sha>` before any
  history-writing step.
  **WHO THE CAPTAIN IS:** the workspace's **top-level session** (no parent session, delegation depth
  `0`) — NOT a preset name. The predicate (`sessionIsTopLevel` in `complexity-gate.ts`) classifies a
  session; the git-write rule itself is a CONTRACT, not a matcher. The preset-keyed variant that made the
  captain branch unreachable here is `T-92` in `agent-references/troubleshooting.md`.
- **Every change lands through a BRANCH + a PULL REQUEST — binding (user-set, 2026-10-06).** Nothing is
  committed straight to `dev` or `master`: cut a `feature/<slug>` or `fix/<slug>` branch, commit the wave
  there, push it, and open a PR against `dev`. **A PR DESCRIPTION IS BILINGUAL**: an English body and a
  简体中文 body, English first, as two sections of ONE description (`## English` then `## 简体中文`). Every
  PR body states, in both languages: what changed, the measured evidence (paths under `evidence/`), the
  gates run WITH their observed results, and the honest bounds — never a claim the evidence does not
  carry. A single-language PR description is not ready for review.
- **Wait for CodeRabbit before merging — binding (user-set, 2026-10-20).** A PR is not mergeable while
  its CodeRabbit review is `in progress`: wait for COMPLETION, reconcile every inline finding as
  FIXED / STALE / STILL-VALID with file:line evidence, and record that reconciliation in the PR. CI
  green plus an independent verifier is NOT a substitute; a pending review is never a pass. If the bot is
  stuck, state the pending state in the PR and wait for the user's decision.
- **Attribution cannot come from the author field.** A shared checkout writes every commit under ONE
  configured identity, so attribute by task ownership + content + reflog ORDER, never by `%an`.
- **The captain's standing rules (user-set, 2026-09-16)** — instructions, not suggestions:
  1. **Archive the team as soon as its wave is merged.** One team that keeps accumulating is what
     inflates the session's context and erases the wave boundary (measured: one team reached **86 tasks
     across four waves**, after which one wave's seven fixes read as unrelated chores). Keep ONE team per
     wave, and end it when the wave lands.
  2. **Dispatch by WORKLOAD SIZE — size picks the EXECUTOR, it never decides "do it myself".** Team mode
     is NOT a precondition for using specialists: outside a team the MPD-native path is always available
     — `mpd_role_spawn` for a single-call specialist consult and the workmate library (`mpd_workmate_*`) for an
     instance that accumulates across sessions. A small mechanical change goes to a Junior Engineer, a
     bounded independent piece to a Senior Engineer or Deep Worker, an evidence question to a Researcher
     or Explorer, a verdict to a Reviewer. The captain executes only what must not be delegated by rule —
     committing (single git writer), contract amendments, plan/roster shaping, releasing a watchdog hold,
     and the final integration. **RECONNAISSANCE IS DELEGATED, AGAIN MECHANICALLY (user ruling
     2026-10-20):** on the `mpd` preset's top-level session the captain's `read`/`grep`/`glob` are
     REFUSED on SOURCE paths (`captain.investigation: "deny"`; the documentation band stays readable),
     and the harness's generic spawn tools (`subagent`, `subagent_fork`, `workflow`) are REFUSED
     (`delegation.gate: "deny"`), so delegation goes through `mpd_role_spawn`, the workmate library or
     Agent Teams. **THE WRITE PATH IS NOT GATED:** `write`/`edit`/`bash` stay available and the verification law's
     write guard (`verify.mode`) remains WITHDRAWN; WHO executes a change is decided by size (this very
     rule), and a DIFFERENT agent records the verdict. **Full token-by-token account of the boot line and the remaining
     withdrawn knob: `agent-references/verification-flow.md`, "§5 rule 2 — the captain's tool pack".**
  3. **Keep requirement / task / review SEPARATE.** A dispatched piece of work gets a requirement task
     (the frozen acceptance contract), a work task and a review task rather than one lumped
     implementation task; finding-driven work uses `kind=repair` + `sourceTaskId`/`sourceFindingIds`, and
     `coverageOf` names the user clause a task serves.
  4. **A-writes/B-verifies is the RECOMMENDED discipline; its MECHANICAL form is withdrawn.** The
     top-level `mpd` agent MAY `write`/`edit` a code path directly and NO loop needs arming (the
     2026-10-17 ruling removed the write guard; the 2026-10-20 restore did NOT bring it back — only the
     reconnaissance and delegation guards). The normal path is still to hand the scope to a write-capable
     member. Code is verified by a DIFFERENT agent that works from the frozen contract and the docs —
     **never from the implementation** — with the verdict recorded BEFORE any implementation read; only a
     recorded FAIL justifies implementation reading, for diagnosis. A PASS with no cited documents or no
     gate evidence is REFUSED, and a FAIL bounces the work back to a writer as a `kind=repair` task. That
     REFUSAL guarantee lives in the five `mpd_verify_*` TOOLS and their validator, not in an installed
     hook — and it reaches the RECORD only: neither the tools nor anything else OBSERVE the read order or a
     seat's blindness, so an unproven basis is UNVERIFIED, never established.
     **Long form: `agent-references/verification-flow.md`, "§5 rule 2 — the captain's tool pack".**
  5. **The board has terminal verbs, and dispatch honours the declared owner.** `agent_teams_task`
     carries `complete`/`fail` (owner-only, optional `note`, optional `expected_revision`
     compare-and-set; a FAIL releases its dependents per OPT-1). `agent_teams_dispatch` pairs a ready task
     with its DECLARED owner when that member is free, and falls back to roster order ONLY with the
     reason reported. **ONE git writer per working tree — the binding bullet earlier in this section — is PROSE since
     2026-10-17:** the
     mechanical denial of git write commands for member sessions lived in the withdrawn
     `installVerifyGuard` hook (`commit`, `add`, `rm`, `mv`, `checkout`, `switch`, `restore`, `reset`,
     `stash`, `merge`, `branch`, `rebase`, `tag`, `cherry-pick`, `revert`, `clean`, `apply`, `am`,
     `update-index`, `worktree`, `init`, `clone` are listed here as the RULE, not as a matcher that still
     runs); the rule is unchanged and binding, and its enforcement is the dispatch
     contract — members edit files and run gates, the captain commits — plus review. A session is a child
     only when the harness RECORDED a subagent origin or a delegation depth ≥ 1, so the user's own
     session (`parentSession` + `isSeeded`, depth `0`, no `origin: "subagent"`) is the CAPTAIN.

---

## 6. Plugin Authoring Guide

Structure per plugin package: `src/index.ts` (cordis `name`/`inject`/`apply`),
`packages/<pkg>/dist/index.js` (bun build), `README.md`, optional `package.json` with `@mpd-dsh/<name>`
naming. **The full former §6 body — the two adapter surfaces in detail, the adopted-plugin residual
analysis, the delta-registry mechanics and every adapter API signature — is in
`agent-references/plugin-authoring.md`.**

- **Harness seams go through `mpd-dsh-adapter` — binding.** No plugin row may touch a harness service
  directly (`ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`, `ctx.commands`, `ctx.llm`);
  `packages/mpd-dsh-adapter-plugin` is the ONE file allowed to, so a harness release that renames a seam
  is absorbed there instead of across every plugin. Resolve it with `const dsh =
  resolveDshAdapter(ctx)` (the mounted `mpdDsh` instance, or a row-private `createDshAdapter` so the
  plugin stays standalone in unit tests) — or `createLazyDshAdapter(ctx, { label })` when the row must
  also survive a transient "provider not ACTIVE yet" miss; the SEAM surface stays `src/index.ts`.
- **DSH-TUI seams go through `mpd-tui-adapter` — binding, the SAME rule on the second plane.** No file
  outside `packages/mpd-tui-adapter-plugin` may name a `ctx.tui*` service, nor the `commands`/`settings`
  services that plane uses; resolve it with `resolveTuiAdapter(ctx)` / `createLazyTuiAdapter(ctx, {
  label })`, binder = ONE deferred `ctx.inject([id], …)` PER SEAM, probe = `ctx.get(id, false)`, and a
  seam that never binds degrades to `absent` rather than failing the boot. Two gates pin it:
  `no-direct-tui-access` and `no-terminal-writes`. **ONE DSH-TUI contact is NOT a seam, is COUNTED, and
  lives in that same adapter (2026-10-05)**: the host's `dashboard` (`Ctrl+A`) `useStdin`, reached by
  dynamic-importing `<root>/lib/types/ui.js` by file URL. Since 0.13.0 it is VERSION-GATED: the contact
  arms only while the `tuiPanels` seam is ABSENT, and on a host that offers the seam it stays inert —
  Ctrl+A keeps the host meaning and the merged view opens through `alt+a` / `/mpd panel`. Route any future
  host-internals need through this same adapter — never a second contact site. The fifteen seams and the
  declared WEB-plane residual: `agent-references/seam-adapters.md`.
- **A patch row NEVER id-targets a host-owned row — binding** (`node scripts/verify-no-host-override.ts`,
  §4). The deployment default preset is the USER's to choose, not the bundle's: `docs/preset-default.md`
  and `node scripts/set-default-preset.ts`.
- **There is NO adopted third-party plugin body any more — the de-vendor wave (2026-10-07) ended that
  chapter.** The vendored `dsh-agent-teams` tree, its adapter facade, its counted bypass inventory, its
  six bridged files, its five named residuals (R1–R5) and its `mpd-delta` registry were deleted with the
  body. What remains is OUR code: the schemastery validator is `packages/mpd-schemastery/**`, the
  prebuilt browser client lives in the web package, and every shipped plugin — including every future
  one — reaches the harness through `mpd-dsh-adapter-plugin`. The historical account is in
  `agent-references/plugin-authoring.md`; nothing in the live tree depends on it.
- **State**: workspace-scoped only (`.mpd/` under the **calling session's workspace**, never the dsh
  process cwd); never write `~/.dsh` from a plugin. Every plugin resolves that root through the ONE
  adapter helper — `dsh.workspaceRoot(exec)` with precedence **session header cwd →
  `DSH_WORKSPACE_ROOT` → `process.cwd()`** — plus `dsh.workspaceRootsAll()` (the union of live session
  cwds, `[]` when the agent registry is absent) for agentless surfaces such as web routes. Resolve it
  PER CALL: never cache the root in a module-level const, never `chdir`, and never set
  `DSH_WORKSPACE_ROOT` from a row. An explicit row/config override (`boulder.dir`,
  `hashline.registryFile`, `memory.dir`, `ulw.planDir`, `config.projectFile`,
  `MPD_DSH_VERIF_VENV|WORK`) still wins. Sanctioned exceptions: (1) the bundle writes NOTHING to the home
  any more — `mpd-bootstrap` serves `<bundle>/skills` by reference and the patch roots `agent-presets` at
  `<bundle>/presets` (§8); (2) the **workmate library** lives under the user's HOME (`~/.mpd/workmate`,
  §13) and QA must boot with `HOME=<sandbox>`; (3) **`mpd-codegraph`** keeps its index in `.codegraph/`
  under the workspace.
- **TypeScript is the only source language, run directly by Node — binding.** Every file this repository
  owns is `.ts` and runs as `node <file>.ts` (type stripping; `engines.node` states the floor). Four
  rules: **erasable syntax only** (no `enum`, `namespace`, parameter properties or decorators); **every
  relative specifier carries the explicit `.ts` extension**; `import type` for type-only imports; no
  `tsconfig`-`paths` mapping. `packages/*/src` differs in FORM only (`bun build` → `dist/*.js`,
  extensionless specifiers), and a genuine CommonJS module is spelled `.cts`. The ONLY JavaScript left is
  **57 files**, for a MEASURED reason (a shipped bundle sits under `node_modules`, where Node refuses to
  strip types): 33 `packages/*/dist/**` build artifacts, 2 browser bundles and 22 vendored skill-corpus
  files — the list is in `agent-references/troubleshooting.md`.
- **Every declaration is documented and every named function is fully typed — binding, enforced by §4's
  `verify:comments`.** A comment states the contract, unit, invariant or reason — never a restatement of
  the name; a local inside a function body counts as a declaration. Types are precise: `unknown` plus
  narrowing instead of `any`, an existing interface reused instead of a structural clone, and a cast only
  where narrowing is impossible, with a comment saying why.
- **Build — from the REPO ROOT, with path-qualified args**: `bun build
  packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js`
  (a multi-entry package repeats it per entry). **BUILD WITH THE PINNED TOOLCHAIN, not the `bun` on your
  PATH** — this is a MEASURED trap (2026-10-07, T16): `package.json`'s `buildToolchain` pins `bun@1.4.0`
  at `.toolchain/node_modules/.bin/bun`, while a PATH `bun` here is `1.4.2`; the SAME canonical command
  produced **24 of 30 targets STALE under 1.4.2 and 30/30 fresh under the pinned binary**. Use
  `.toolchain/node_modules/.bin/bun build packages/<pkg>/src/index.ts --target node --format esm
  --outfile packages/<pkg>/dist/index.js`, or the one the gate prints; a build run from a PACKAGE
  directory is flagged STALE even though it looks sanctioned. Zero runtime deps preferred (type-only
  imports). **An ADAPTER edit fans out**: `bun build` INLINES every imported module, so touching `packages/{mpd-dsh,mpd-tui}-adapter-plugin/src` changes the emitted bytes
  of every package that imports it (measured: one adapter edit left 12 of 24 dist targets STALE) —
  rebuild each dependent with the pinned toolchain.
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
  sandbox, the sandbox path asserted, the real `~/.dsh` never read or written. (b) `HOME=<sandbox>` —
  skill roots leak through HOME (measured 2026-09-14: `SKILLS=24 BUNDLED=18` → FAIL). (c) A SANDBOXED
  WORKSPACE: every dsh spawn carries an explicit sandbox cwd (`sandboxWorkspace(sandbox)` from
  `skills/dsh-qa/scripts/lib/workspace-isolation.ts`) and each live case asserts no
  `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists (`assertSessionsSandboxed`) — without it an
  "isolated" boot writes real `.mpd/team/*` records into the repo. Live-LLM cases must ALSO copy
  `settings.yaml` when present (gateway providers configure the chain there; otherwise headless falls
  back to `deepseek-official` → `MISSING_CREDENTIAL`).
- **Provability: assert a REAL tool result, never just "it ran".** For composition-only questions the
  subject is `--dump-config` rows — which proves COMPOSITION ONLY and never a plugin load (§4). Anything
  about plugin BEHAVIOUR (a tool registered, a route answering, a schema accepted) needs a boot that
  MOUNTS the rows in an isolated `DSH_HOME` with registration instrumentation, or a real tool call.
- **A live case proves a tool call from the HARNESS's session log, never from the model's prose**
  (`skills/dsh-qa/scripts/lib/session-evidence.ts`): `tool/call.data.name` + a non-error `tool/result` is
  tool evidence; `request/header.data.header.tools[]` is tool-list evidence. Asserting a tool NAME
  against the model's ANSWER is wrong in BOTH directions (both measured). The store is a
  CONCATENATED-ZSTD-FRAME container, so decode frame by frame.
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- **Durable anchors (T-90): an ARTIFACT PATH is the anchor — a mailbox id is not a link.** A line
  pointer rots by an EDIT (T-55), a mailbox id by a MAILBOX CLEARING; a seat citing an EXCHANGE copies
  the quoted bytes into its own artifact. Long form: `agent-references/qa-discipline.md`.
- **Derived surfaces are declared at PLAN time (T-88): `packages/*/dist/**`, `dist/mpd-package/**`,
  `VENDOR_LOCK.json` and `.mpd/plans/**` belong to the INTEGRATION task's `inScope` at CREATION.** A LANE
  must not declare a `dist/**` pattern for itself (the platform's `inScope overlaps` validator refuses
  exactly that): pre-declare the derived path on the task whose edits redden it.
- **Preset/row conformance against the INSTALLED harness** (`preset-conformance`, required for any
  preset/patch/overlay change): a row config is validated with the installed plugin's own schemastery
  `Config`, because that is what the loader runs, and the `mpd` preset's row set is pinned against the
  installed `standard` preset (a missing row is a capability every mpd session loses). `--dump-config`
  and every `--self-test` that never creates a session are blind to this class — only a real mount is
  not.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- **Verify on SETTLED hashes, and quote a hash WITH its measurement moment.** Pin the revision by hash,
  re-check it after a short settle window (wave 2 used 50 s), then run the contract, anchoring every
  verdict to the hashes you measured; state the UTC instant each hash was read and sandwich a verifier's
  read — hash → work → re-hash, start == end after the settle window.
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
flows or removed outright); (d) uninstall is the mirror image, one command, leaving no residue except the user's own `~/.mpd/workmate`. A
capability that arrives by any other route is a defect — `verify-plugin-manifest --pack` plus the Docker
lane hold this line.

### Primary flow: ONE command, no extra step

- **The USER-facing install is ONE command against the PUBLISHED package — no clone, no build:**
  `dsh plugin --profile web add github:HaroldZ32/My-Power-Dsh` (or `… add @mpd-dsh/mpd` once it is on the
  registry). pnpm packs it through the manifest's **`files` allowlist**, then `reconcile` reads the
  installed package's `dsh.bundle.patch` files, validates that they load, and appends the package name to
  `dsh.profile.bundles`. Proof: the live lane `node scripts/docker-e2e.ts --mode oneclick --spec
  github:HaroldZ32/My-Power-Dsh` on a bare `ubuntu:24.04`.
- **A plain `github:<owner>/<repo>` spec resolves the repository's DEFAULT BRANCH** (measured 2026-09-28:
  it served `master` while the wave sat on `dev`, so the install ran OLD code). An installable wave is
  RELEASED to the default branch (§11); a dev install must name the ref (`github:<owner>/<repo>#dev`).
- **`cd <repo> && dsh plugin --profile web add .`** is the whole install from a CHECKOUT. The repo root IS
  the bundle package: `package.json` is named `@mpd-dsh/mpd` and declares `dsh.bundle.patch` (an ARRAY:
  `./cordis.patch.yml` then `./presets/mpd.patch.yml`), `dsh.client` (`platform: web`), the `exports` map
  the rows resolve through, and the toolchain `optionalDependencies`. `dsh plugin --profile web remove @mpd-dsh/mpd`
  is the one-command uninstall.
- **The published dependency closure is BUILD-SCRIPT-FREE on purpose**: pnpm 11 hard-exits on unapproved
  dependency build scripts (`ERR_PNPM_IGNORED_BUILDS`) and `dsh plugin add` has no approval channel, so
  `dsh-better-sidebar` is an optional PEER + a `devDependency` (the transitive `node-pty` postinstall
  that OLDER releases pulled is the historical reason; 0.24.1 no longer depends on node-pty, measured
  2026-10-02 — its row's mount guard disables it when absent) and `@ast-grep/cli` +
  `@code-yeongyu/comment-checker` left `optionalDependencies`.
- Every path-bearing patch value resolves through the loader's `baseUrl` (the profile directory), so the
  same patch works for a checkout install and for a packed install. The `mpd` preset and the skill corpus
  are SERVED by reference (`preset-mpd` → the inline plugin list, `mpd-bootstrap` → `<bundle>/skills`) —
  no home copy, so uninstall leaves no residue.
- **`node scripts/pack-mpd.ts` (alias `npm run pack`) is the RELEASE step, not an install step**: it
  assembles the relocatable `dist/mpd-package/` (tarball installs: `dsh plugin --profile web add
  dist/mpd-package`); a checkout install never needs it.
- **After a code change:** rebuild the touched package's `dist/` and restart dsh — a `link:` install
  reads the checkout directly. Re-pack only when the distribution artifact must be refreshed, and bump
  `package.json` version for releases.

### Dev/QA flow (legacy): `scripts/install-profile.ts`

- `node scripts/install-profile.ts --yes [--profile mpd|mpd-headless] [--dsh-home X] [--skip-toolchain]`.
  Default is `--dry-run`: print, never write; `--dsh-home` enables isolated QA installs. It writes the
  home `cordis.patch.yml` with absolute paths and presets → `$DSH_HOME/.agent-presets/`. Superseded by
  the packed bundle for user installs.
- Never run the installer against the real home from a QA context; that is what `--dsh-home` is for.

---

## 9. Vendor & Baseline

- `VENDOR_LOCK.json`: upstream commit/version/stats recorded as HISTORICAL provenance, plus per-asset
  `fileCount` + `sha256` (single file) or `treeSha` (dir, sorted relpath + per-file sha256). **The
  FINGERPRINTS are blocking; the identity half is a record.** Since the de-vendor wave (2026-10-07)
  nothing reads, copies, patches or audits the upstream repositories, so the gate needs no checkout and
  no network. **Nor is anything built from an in-repo snapshot any more** (wave B2, 2026-10-08): the MCP
  servers are our own code or DECLARED npm dependencies started by thin launchers.
- Update policy: never chase upstream; a baseline change requires a deliberate branch + evidence.
- Vendored skill corpus: refresh as whole-dir replacements from upstream, keep provenance links.
- **`skills/**` has ONE writer per wave (single-skills-writer rule).** Every `skills/**` edit invalidates
  the corpus `treeSha` in `VENDOR_LOCK.json`, and the re-pin must land in the SAME commit as the change
  that invalidated it (§11). Two writers therefore force two coupled commits, a mid-wave re-pin, and a
  `verify-vendor` failure on anyone who commits in between. Serialize all `skills/**` edits of a wave
  through a single writer and re-pin exactly once.

---

## 10. Security & Privacy

- Credentials: only ever copied into an ephemeral QA sandbox; never committed, logged, or echoed.
- Evidence logs must not contain secret material (api key values, tokens).
- License: MIT (LICENSE.md, Copyright (c) 2026 HaroldZ32); third-party components keep their own
  licences (LICENSE-NOTICES.md).

---

## 11. Release Process

1. From dev: `git checkout -b release/vX.Y.Z`; bump the version in ALL THREE carriers —
   `package.json`, `dsh-plugin.json`, `dsh-distribution.json` (`verify:manifest` reddens on any
   mismatch) — plus the changelog note.
2. Full gate sweep, each command named exactly: `bun run verify:vendor` (after the wave's single `node
   scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` re-pin when `skills/**` changed),
   `bun test packages` (a repo-root `bun test` also scans the historical `evidence/**` fixtures and
   reddens on them), `bun run typecheck`, `bun run test:qa`, `bun run verify:docs`, `bun run verify:rows`,
   `node skills/dsh-qa/scripts/preset-conformance.ts --self-test`, `node scripts/verify-dist-fresh.ts`,
   `node scripts/verify-pack-closure.ts` (freshness read from the `expected-after-pack` list at the
   re-pack, never from its exit code — §4's bound), plus the real smoke cases (`dual-track-smoke`,
   `mcp-call`). `bun run verify:gates` covers the nine static members (vendor, dist freshness, row
   parity, doc pairs, preset conformance, plugin manifest, comment coverage, graph model, workflows).
   `node scripts/verify-no-host-override.ts` is NOT a member of that aggregate and is REQUIRED for EVERY
   release sweep; `node scripts/verify-manual-paths.ts` is REQUIRED whenever `AGENTS.md` changed.
   - **LAST: the Docker real-machine lane — `--live` with `DEEPSEEK_API_KEY` exported, and
     `--require-docker` so it cannot skip silently** — `node scripts/docker-e2e.ts --mode source
     --require-docker --live` then `--mode oneclick --require-docker --live`. Run it AFTER the last
     write, and cite the stamps it writes. `--live` WITHOUT a key in the environment is a hard exit 3
     BEFORE the build, and a credential-free browser-enabled run records `ui.replyRendered` as a DECLARED
     BOUND that the required-arm gate turns into exit 3 by design — the credential-free spelling is
     `--no-browser` (exit 0, every `ui.*` NULL, NOT release evidence).
   - **Release-checklist line (VENDOR_LOCK pairing rule):** `VENDOR_LOCK.json` lands in the SAME commit
     as every `skills/**` change that invalidates its `treeSha`; with the single-skills-writer rule (§9)
     that is exactly ONE re-pin per wave — verify the wave's single re-pin is present and that no
     `skills/**` change is committed without it.
3. Merge `--no-ff` to master with `release: vX.Y.Z …`; annotated tag `vX.Y.Z`.
4. Push master + tag; announce with evidence links.

---

## 12. Troubleshooting (known)

The full symptom → cause/fix table lives in **`agent-references/troubleshooting.md`** (on demand, not
injected; see the Reference Index). It is the former body of this section, moved verbatim 2026-09-17 by
the T-22 instruction-budget split and hash-verified under `evidence/gates/agents-budget/`. It covers the
ESM-restart trap, the fresh-`/tmp` and `nohup` rules, the single-`skills/**`-writer re-pin rule, the
`update_task` contract, `--dump-config` vs a mounting boot, schema-union boot failures, credential/sandbox
traps, the codegraph daemon policy, the preset-plane row-drift class, agent-teams dispatch defects, the
failed-dependency pinning trap, the `inScope overlaps` validator, profile-row loss after an unrelated
install.

**Harness-owned frictions — CLOSED by a rule plus a helper** (user decision 2026-09-17). Each is DSH
behaviour we do not fight; the detail and the measurements are in `agent-references/troubleshooting.md`.

- **T-21** no plugin-module hot reload -> ask with `node scripts/mpd-bg.ts reload-check <module-path>`.
- **T-23** fresh `/tmp` per bash call + `bwrap --die-with-parent` -> long work is a managed background
  job (`run_in_background`), started through `node scripts/mpd-bg.ts run --log <file> -- <cmd>`.
- **T-24** MCP children inherit fds -> never pipe a long-lived `dsh`; probe liveness with
  `node scripts/mpd-bg.ts probe <pidfile>`.
- **T-26** the file sandbox is workspace-write -> `node scripts/mpd-bg.ts check-write <path>` first.
- **T-43** the workmate library lives under `HOME` -> QA must boot with `HOME=<sandbox>`.
- **T-54** a sandboxed profile copy sits at the SAME directory depth as the installed profile.
- **T-55** cite code by SYMBOL, never by line number.
- **T-92** `sessionQualifies` must not decide "is this the captain" by PRESET NAME (see §5).

T-21/T-23/T-24/T-26 are verified by `node scripts/mpd-bg.ts --self-test` (13 arms); T-43 by the
harness-close guard cases in `evidence/platform/harness-close/`; T-54 and T-55 are documentation rules,
not mechanically checked.

---

## 13. Glossary

**The full glossary — every term with its long form, plus the 0.1.7 preset-form change — is in
`agent-references/glossary.md`.** The three definitions this section is CITED for (roster, team-model
slot, workmate) stay here, with the verifier's envelope.

- **roster**: the specialist roster served by `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` /
  `mpd_role_persona`) as teammate instantiation templates for the OFFICIAL Agent Teams plugin. The eleven
  members are addressed by NAME: Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead,
  Explorer, Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The stable `id` is INTERNAL —
  refused as TOOL INPUT and exposed by NO tool output, render, web route or GUI. The **read-only
  discipline is the exported deny list**, exactly eight names, identical in `mpd-roles-plugin` and
  `mpd-workmate-plugin` (asserted by `roles.test.ts`): `write`, `edit`, `mpd_hashline_edit`, `bash`,
  `mcp__ast_grep__rewrite`, `mcp__ast_grep__scan`, `mcp__lsp__rename_symbol`,
  `mcp__lsp__rename_symbol_strict`. **Do NOT re-add `str_replace_editor` / `apply_patch`, and do not
  filter the list with `dsh.hasTool`** — the harness validates the WHOLE list at spawn time, so one dead
  entry breaks every read-only spawn; since 2026-10-10 that validation is TOLERATED instead of fatal
  (`restrictToolsTolerant` prunes the names the harness reports as unknown, with exactly ONE logged
  retry). Full form, including the two enforcement surfaces: `agent-references/glossary.md`.
- **team-model slot**: one of the FOUR configurable default model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` in `mpd.jsonc` / the `mpd` settings
  namespace. Slot 1 routes Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/
  Plan Reviewer, slot 3 Deep Worker/Junior Engineer, slot 4 Vision Analyst (its model MUST accept image
  input). A slot that cannot be resolved fails the spawn LOUDLY, writes no state and NEVER clamps an
  effort; a slot whose model declares NO reasoning efforts is sent none (`withSupportedEffort` drops the
  keyword, logging it). Slots apply to the single-call consult paths AND to an official `spawn_teammate` (routed
  through `mpd-roster-provider-plugin`); because the team service does not forward identity, **a
  teammate `description` that NAMES a roster member routes that member — any other teammate runs on the
  route of the session that staged it (the captain's in a top-level spawn, the Lead's in a team-lead
  spawn), and prompt text cannot change a route**. Long form: `agent-references/glossary.md`.
- **verifier's envelope**: the tool and path boundary a BOUND VERIFIER SEAT works inside. A seat is bound
  with `mpd_verify_seat`; the boundary it is meant to keep — no shell, no source-returning tools, no
  board mutation (`mpd_verify_*` excepted), reads path-scoped to the frozen docs AND the documentation
  band while it is BLIND (a bare path argument refused), and a recorded FAIL unlocking implementation
  reading for DIAGNOSIS — is **PROSE since 2026-10-17**: the hook that ENFORCED it (`installVerifyGuard`) was withdrawn, so a seat is BOOKKEEPING now, recorded and
  auditable, not mechanically fenced. Blindness is no longer OBSERVED, so treat an unproven basis as
  UNVERIFIED rather than established. **Long form: `agent-references/glossary.md`.**
- **workmate**: a durable, evolving agent instance in `~/.mpd/workmate/` created by `mpd-workmate-plugin`
  (`mpd_workmate_*`) from a roster BASE template with an independent name; it self-summarizes after each
  work (persona + independent memory, size-capped) and keeps a short note card. Reuse is via
  `mpd_workmate_match`; weak matches must NOT be forced. Two rules a caller must know: **the directory
  name IS the instance key** (`meta.name` is only a display mirror), and `delete` is ARCHIVE-FIRST
  (permanent only with `purge: true` + `confirm === name`), with both mutations refused while the workmate
  is in use. A base is addressed by its functional NAME only; `baseId` is internal provenance no tool
  output, web route or GUI ever exposes. Long form: `agent-references/glossary.md`.
