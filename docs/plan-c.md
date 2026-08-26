# Plan C — Closing the audited gaps

Status: **COMPLETE (2026-08-26)** — all items landed; evidence under `evidence/plan-c/`.

| Item | Status | Evidence |
|---|---|---|
| C1 team+visualization | ✅ adopted dsh-agent-teams 0.1.13 (MIT notice, stateDir .mpd/team) | c1-team (compose + live team run + archive + web /state route) |
| C2 ultrawork engine v2 | ✅ waves/gates/ledger/hyperplan + mpd_ulw alias | c2-ultrawork + deterministic engine tests |
| C3 hashline | ✅ read/edit/format/restore + guard | plan-c-smoke + unit tests |
| C4 comment-checker | ✅ opt-in binary (00 autoCheck off) | unit tests (binary present) + plan-c-smoke |
| C5 boulder | ✅ .mpd/boulder.json + tasks/timers/plan progress | plan-c-smoke + unit tests |
| C6 memory git+svn+reflection | ✅ VCS abstraction (git live, svn fake-CLI wiring) | c6-memory + unit tests |
| C7 minimal mpd.json | ✅ JSONC layer + mpdConfig service + tools | plan-c-smoke + unit tests |
| C8 vision e2e | ✅ fixture PNG + official vision API grounded answer | c8-vision |
| D-C9 model-core depth | skipped by user decision (DeepSeek-only) | — |

Delivered on `dev` (bae2792); master at v0.1.0 awaiting v0.2.0 release sign-off.

## 0. Decision record (user-approved)

| Id | Item | Decision | Basis |
|---|---|---|---|
| D-C1 | Team mode + visualization | Adopt `@nanmicoder/dsh-agent-teams@0.1.13` as a third-party bundle dependency; vendor namespace `agent_teams_*` retained as an intentional exception; `stateDir` overridden to `.mpd/team`; MIT notice added | Reference repo rides official DSH seams (continuable subagents, mailbox, task DAG panel, archive); forking would require a React/tsdown client toolchain we do not own |
| D-C2 | ultrawork depth | Upgrade `mpd_ulw` into a fixed-policy orchestration engine (waves, gates, verifiers, ledger) | Ultrawork is a fixed discipline, not a per-call script: native workflow = model-authored JS every run; goal-round-driver = same-session only, no independent evaluator; ralph = policy locked, cannot carry gates |
| D-C3 | hashline | Port now: vendor `hashline-core` (pure TS, deps: npm `diff` only) as `mpd-hashline-plugin` | Hash-anchored edit discipline + autocorrect fits the DSH edit guard seam |
| D-C4 | comment-checker | Port as opt-in plugin; `@code-yeongyu/comment-checker` (MIT, tree-sitter native binary) installed into .toolchain on demand | ~255 MB unpacked binary; default off, `--with-comment-checker` installer flag |
| D-C5 | boulder | Port this round: vendor `boulder-state` as `mpd-boulder-plugin` (`.mpd/boulder.json`, `dsh:` session prefix) | Pure TS, no deps, effort S; gives ulw/team a durable work ledger + plan checklist parsing |
| D-C6 | memory | Port this round: git backing AND a NEW svn backing (user requirement: both VCS are needed); reflection state machine included | IC-design environment uses SVN; `memory-core` is harness-neutral (M effort); svn 1.14.5 installable via apt in the QA sandbox |
| D-C7 | config layer | Minimal `mpd.json` (JSONC, project+user merge, no migration engine) | Bundle patch stays the composition truth; mpd.json feeds plugin runtime config only |
| D-C8 | vision | End-to-end image pipeline test (fixture + multimodal-looker route) | Small, unconditional |
| D-C9 | model-core depth | Skipped (user decision) | DeepSeek-only usage (official vs unofficial API); the 2-3 entry chains in mpd_modelchain_resolve already cover it |

## 1. Waves

- **Wave A**: C1 (team+visualization), C3 (hashline), C5 (boulder), C7 (mpd.json), C8 (vision e2e).
- **Wave B**: C2 (ultrawork engine), C4 (comment-checker).
- **Wave C**: C6 (memory git+svn).

Each item = one `feature/<slug>` branch from `dev`, atomic commits, dsh-qa evidence, merge `--no-ff` to `dev`, push to Gitee. v0.2.0 release after all waves + user sign-off.

## 2. Item plans

### C1 — Team & visualization (adopt dsh-agent-teams)

Deliverables:
- `scripts/install-profile.mjs`: add the plugin via the official `dsh plugin --profile <name> add @nanmicoder/dsh-agent-teams@0.1.13` (managed DSH_HOME), then home patch config override:
  ```yaml
  - id: agent-teams
    config:
      stateDir: .mpd/team
      memberProvider: spawn
      memberMaxDepth: 1
  ```
- `LICENSE-NOTICES.md`: full MIT entry — `Copyright (c) 2026 程序员阿江(Relakkes)` + license text + repo URL; retain their LICENSE at `third-party/dsh-agent-teams/LICENSE`.
- `AGENTS.md`: naming addendum — self-written = `mpd_*`; adopted third-party plugins keep vendor ids (`agent-teams`, context7, grep_app precedent).
- Docs: `mpd_team_spawn/status` stay as lightweight one-shot tools; `agent-teams` is the full team protocol (supersession note in docs/feature-audit.md).

QA (`skills/dsh-qa/scripts/agent-teams-adopt.mjs` + `--self-test`, isolated DSH_HOME with copied credentials):
- compose: `dsh --dump-config` shows the `agent-teams` row with `stateDir: .mpd/team`;
- live headless run: "use AgentTeams: create team of 2 members, one task with a dependency, run to completion, report status" → assert `.mpd/team/<id>/team.json` + `inbox/*.jsonl` exist and task terminal;
- web route smoke: boot `dsh web` as a managed background job, `curl /plugins/dsh-agent-teams/state` → 200 JSON; panel mount seam (`shell.overlay`) already confirmed present in the installed dsh-client-ui-layout.

Evidence: `evidence/plan-c/c1-team/<ts>/`.

### C2 — Ultrawork engine (mpd-ulw v2)

Policy (fixed, no model-authored scripts; adapted from upstream ultrawork directive):
- `mpd_ultrawork(objective, {tier?, maxRounds?, hyperplan?})`: rounds = fresh spawn children; structured handoff (`REPORT_SCHEMA` extended with wave/criteria/evidence).
- Discovery waves: first wave = one eval cell, independent lookups parallel; every bounded wave of ≥2 independent ops concurrent with disjoint write scopes; stop after 2 fruitless exploration waves.
- Per-criterion loop: PIN → RED → GREEN → SURFACE → CLEAN until all criteria PASS.
- Plan gate: planner (mpd-prometheus persona) writes `.mpd/plans/<slug>.md`; momus/metis-role reviews require a plan file with `review_required`.
- Verification gate (triggered when plan exists AND tier=heavy or strict review): mpd-momus reviewer child, read-only, max 2 re-reviews, unconditional approval.
- Final quality gate: mpd-momus-gate reviewer; stamps `.mpd/ulw/<id>/ledger.jsonl` per lane (code quality, hands-on QA, goal verification).
- Subagent barrier: no done/final answer while children are non-terminal.
- Hyperplan gate wave (optional): 5 hostile reviewers (unspecified-low/high, deep, ultrabrain, artistry personas) × ≤3 critique rounds → insight bundle → planner.
- Edit discipline hooks: hashline guard (C3) + comment-checker (C4) invoked in execute-verify when enabled.

Deliverables: `packages/mpd-ulw-plugin` v2 (engine/gates/ledger); skill `mpd-ultrawork` (adapted directive, English) and `mpd-ulw-plan` (upstream ulw-plan translated to DSH tool names).

QA: `--self-test` for state machine + ledger; one bounded live run (small task: assert plan file + ledger rows + evidence file). Effort M (~700 LOC + skills).

### C3 — Hashline plugin

Deliverables: `packages/mpd-hashline-plugin` — vendored `hashline-core` (upstream commit 8c57e46; VENDOR_LOCK.json updated; SUL-1.0 fork terms cover it); tool `mpd_hashline_edit({path, edits[]})` over `applyHashlineEditsWithReport`; post-execute guard (`tools/post-execute`) verifying hashline anchors after edit/str_replace_editor when `config.guardEditTools: true` (mismatch reported to the model, no silent auto-fix; autocorrect available via the tool).

QA: `--self-test` fixtures (format → edit → verify anchors, guard smoke). Effort S.

### C4 — Comment-checker plugin (opt-in)

Deliverables: `packages/mpd-comment-checker-plugin` — vendored parser subset (comment-checker-core, SUL fork terms); tool `mpd_comment_check({paths[]})` spawning the binary (resolution: `MPD_DSH_COMMENT_CHECKER_BIN` → `.toolchain/node_modules/@code-yeongyu/comment-checker/bin/<binary>`); opt-in post-edit hook (`config.autoCheck: false` default). Installer flag `--with-comment-checker` (documented ~255 MB unpacked cost). LICENSE-NOTICES: MIT entry (repo: github.com/code-yeongyu/go-claude-code-comment-checker).

QA: binary probe + run on files with/without comments; exit semantics (0 clean / 2 hasComments) asserted. Effort S-M.

### C5 — Boulder plugin

Deliverables: `packages/mpd-boulder-plugin` — vendored `boulder-state` adapted: `.mpd/boulder.json`, session prefix `dsh:`; tools `mpd_boulder_status / create_work / complete_work / start_task / end_task / plan_progress` (thin wrappers over the storage API); plan checklist parser (TODOs + Final Verification Wave).

QA: `--self-test` state transitions; live work/task/timer/plan-progress run. Effort S.

### C6 — Memory engine (git + svn + reflection)

Scope (subset of upstream memory-core): memfs (frontmatter md, path confinement), NEW vcs abstraction with git backend (vendored git.ts/porcelain) and NEW svn backend (`svnadmin create` file:// repo, checkout, add/commit/update/log via svn CLI), journal (transcript.jsonl + state.json + lock), reflection state machine (step-count/compaction/manual triggers, priority, reservations, snapshot finalization), facts queue (versioned JSONL + cursor), memory tools `mpd_memory_* (create/str_replace/insert/delete/rename/update_description/apply_patch)`, compile injection (self/memory/projection), identity (auto project-derived).

- Home: `.mpd/memory`; `memory.vcs: git | svn | both` (`both` = dual-mirror commit; svn repo `file://` under `.mpd/memory/svn-repo` or external URL via config).
- Deferred (wave 2): soul/people/reminders/seeds/mirror push sync/search.

QA: sandbox installs subversion 1.14.5 via apt (available in the mirror); smoke both backends (create → edit → commit; `git log` and `svn log` both show versions); reflection trigger after N steps; facts consume. Graceful skip when `svn` is missing (git still works) with install hint. Effort L (largest item).

### C7 — Minimal mpd.json

Deliverables: `packages/mpd-config-plugin` — JSONC loader (project `.mpd/mpd.jsonc` + user `$DSH_HOME/mpd.jsonc`, deep merge, prototype-pollution sanitize); minimal schema (`memory.vcs`, `team.stateDir`, `hashline.enabled/guardEditTools`, `commentChecker.autoCheck/bin`, `modelchain` overrides, `boulder.dir`, `ulw.maxRounds`); no migration engine; `ctx.mpdConfig` service consumed by the other mpd plugins at apply. Boundary documented: bundle patch = composition truth, mpd.json = runtime config only, no row mutations.

QA: loader merge tests + config-bridge smoke. Effort S-M.

### C8 — Vision e2e

QA-only: generate a local image fixture (waveform/schematic PNG), run the multimodal-looker route live against it, assert an image-grounded answer; evidence captured. Effort XS.

## 3. Cross-cutting

- Licensing: LICENSE-NOTICES.md gains dsh-agent-teams (MIT) and @code-yeongyu/comment-checker (MIT) entries; vendored upstream OMO code stays under the SUL-1.0 fork terms; npm `diff` (BSD-3-Clause) noted if bundled with hashline.
- Naming: self-written `mpd_*`; adopted third-party keeps vendor names (AGENTS.md addendum).
- QA: every item ships a dsh-qa script with `--self-test`; live evidence under `evidence/plan-c/<slug>/<ts>/`; isolated DSH_HOME only, real `~/.dsh` never touched.
- Branches: `feature/c1-team` … `feature/c8-vision-e2e`; merge `--no-ff` to `dev`; push Gitee (per-command header, no persisted token); master untouched until v0.2.0.
- Out of scope (decided): model-core depth (D-C9), omo.json full port, team fork+rename, tmux-based team viz (superseded by the web activity panel).
