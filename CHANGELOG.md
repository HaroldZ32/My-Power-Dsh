# Changelog

Human-readable release notes for **my-power-dsh** (`@mpd-dsh/mpd`). Newest first, one section per
released version, the changes grouped by kind (`Added`, `Changed`, `Fixed`, `Removed`). This file is
English-only and is NOT part of the bilingual docs band (AGENTS.md Language policy polices `docs/**`,
`packages/*/README.md`, `extensions/**`, `templates/**` and the root `README`).

Further reading:

- [`README.md`](./README.md) — what the bundle is, and how to install it;
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — development setup, gates and the git model;
- [`docs/index.md`](./docs/index.md) — the documentation hub;
- [Releases](https://github.com/HaroldZ32/My-Power-Dsh/releases) — the annotated tags, newest first;
- [`VENDOR_LOCK.json`](./VENDOR_LOCK.json) — the pinned upstream baseline each release is measured
  against.

## v0.15.0 — the guard split: reconnaissance and delegation delegated again, a mechanical session gate, a stateless TUI panel, and the `cordis-dev` skill

Minor release over v0.14.0, and the one that finishes the 2026-10-17 guard ruling properly. That wave
restored the long persona prompt but withdrew all three mechanical guards with it; the measured
consequence was a captain that did every search itself while the roster and team surfaces went unused.
The 2026-10-20 ruling SPLITS the bundle: the two DECISIONAL guards come back, the session-start gate
ships `mechanical` again, and the verification law's write guard (`verify.mode`) STAYS withdrawn, so the
captain keeps writing code directly while a DIFFERENT agent records the verdict. The same release fixes
a seeded-fork qualification defect in that gate, hardens the investigation guard's error boundary, makes
the TUI sidebar deployment stateless on dsh-tui ≥ 0.16.1 with a panel attention badge, and teaches the
`cordis-dev` skill to load itself. Frozen contracts: `.mpd/plans/restore-guard-discipline.md` and
`.mpd/plans/release-v0.15.0.md`; evidence is under `evidence/roles/captain-scope/`,
`evidence/audit/v0.15.0-fixes/`, `evidence/tui/panel-deploy-stateless/` and
`evidence/release/v0.15.0/`.

**Changed — the guard split (user ruling 2026-10-20).**

- **The captain's investigation guard is back.** `installCaptainInvestigationGuard` refuses `read` /
  `grep` / `glob` on a SOURCE path for the `mpd` preset's top-level session; the documentation band stays
  readable, and the knob is `captain.investigation` (`deny` default | `allow`). Classification happens
  BEFORE the first tool call, and the persona now says so instead of leaving the rule to be discovered.
- **The delegation gate is back, and preset-scoped.** `installDelegationGate` refuses the harness's
  generic spawn tools `subagent`, `subagent_fork` and `workflow`, naming the sanctioned routes
  (`mpd_role_spawn`, the workmate library, Agent Teams); the knob is `delegation.gate` (`deny` default |
  `captain` | `allow`). `tools.guard` is process-wide, so the rule is scoped by what the `mpd` preset
  MEANS: a top-level session of another preset — the deployment default `cordis` included — is
  RELEASED, while the `mpd` captain and every member/child session stay bound whatever preset they run.
  The `mpd-roles` row's own `captain.investigation` / `delegation.gate` config values are honored again
  (a fallback bug had silently ignored them).
- **`team.gate` ships `mechanical` again.** `resolveGateMode(undefined)` answers `mechanical`, and the
  `mpd-roles` row's `gate: "off"` pin is removed so the code default governs. The boot line reads
  `captainInvestigation=deny delegationGate=deny … sessionGate=mechanical`, and the one withdrawn knob
  reports `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)` — never a mode.
- **Persona, written to avoid a wall.** The `mpd` preset opens with a READ DISCIPLINE block: classify the
  path before the first call, the documentation band is yours, source paths are delegated, do not spend
  a call checking whether the guard refuses, and never route around it with `bash cat`/`rg`. A new
  PROJECT SHAPE paragraph tells the captain to load `cordis-dev` before the first edit, gate run or
  diagnosis in a plugin-shaped workspace. Writes stay direct.
- **QA cases are re-purposed, not deleted.** `delegation-gate.ts` returns to the DENIAL assertions,
  `captain-full-tools.ts` is renamed and rewritten as `captain-scope.ts` (boot-line tokens, the shipped
  apply site, persona arms, the headless bound stated), and `session-start-team.ts` follows the
  mechanical default.

**Added — the TUI sidebar panel: attention badge, auto-open, stateless deployment.**

- `panel-attention.ts` publishes the panel's `tuiPanels.badge` and its one auto-open from APPLY, never
  from a page: dsh-tui mounts a plugin panel only while it is the active page, so a page-side badge could
  only decorate the page the user was already looking at. The surface arms through `whenBound("panels")`
  (a composition without the seam registers nothing) and is driven by the same `mpdTeams` feed the pages
  read. The badge counts only the DISPLAYED team's watchdog holds, and the first publish after arming
  includes the null case, which is what clears a stale badge.
- The auto-open fires at most ONCE per process, on the NOT-LIVE → LIVE edge of a team (booting into a
  workspace that already has a team opens nothing), retries a host refusal on the next state change,
  never retries a host that exposes no badge member, shares its one-shot latch across panel-seam
  re-binds, and is governed by the new `panelAutoOpen` row knob (default `true`).
- **On dsh-tui ≥ 0.16.1 the deployment is stateless.** `hostOwnsPanelCsv` gates a READ-ONLY stand-down:
  the ladder is cancelled, no feed and no belt are installed, and even the stale-default migration is
  skipped, because that host's registry enables a panel on registration, removes it on dispose and
  unions registered ids back on every apply. 0.15.x keeps the self-heal path with its ONE migration
  write; below 0.15 the feed-first keeper is unchanged, and both version floors share one comparison.
- `/mpd status` gained a panel-deployment line naming the host-assigned panel ids, the seam state and the
  keeper's verdict — the `<pluginId>` half of a panel id is the one fact no document can derive.

**Added — `cordis-dev` loads itself.**

- `skills/cordis-dev/SKILL.md` leads its front-matter description with the auto-load rule and the
  detection list, and a new "Load on detection" section states every signal (`cordis.patch.yml` or
  `presets/*.patch.yml`, a manifest carrying `dsh.bundle` / `dsh.client`, `dsh-plugin.json`, a
  `packages/*/src/index.ts` exporting `apply`, an `extensions/*` manifest, `mpd.jsonc` /
  `.mpd/plans/**`), the presence-only one-line check, and the NEGATIVE case (no signal means skip it and
  say so rather than applying bundle rules to a non-plugin project). Detection parses manifests for a
  real `dsh.bundle` / `dsh.client` entry, so a project that merely DEPENDS on a package named `dsh` no
  longer matches.

**Fixed — the session gate, the guards and the TUI badge (audit of dev @ 5a62e936).**

- `sessionQualifies` now composes `sessionRank`, so a seeded-fork top-level session receives the
  mechanical session-start gate and origin/depth children do not. The previous preset-name heuristic
  misclassified the fork (T-92); unit and QA contract arms cover all four cases.
- The captain-investigation guard passes a call through on an INTERNAL error with one warning instead of
  failing an unrelated tool call.
- The staging notice is self-consistent when staging returns no plan id: it now says the shell cannot be
  approved and tells the captain not to try, instead of contradicting itself. The QA case's plan-id
  parser accepts the current `plan-<17 digits>-<4-char tag>-<3-char counter>` format (it had parsed the
  previous 14-digit form and gone blind), and `session-gate.ts` emits a row warning when
  `staged && planId === ""`, so a staging call that produced no id cannot read as healthy.

**Fixed — QA and evidence repairs from the same audit.**

- `bundle-lifecycle` pins `XDG_RUNTIME_DIR` and the npm caches inside its sandbox and repairs three stale
  assertions; the real lane is green again instead of passing on a stale fixture.
- The delegation-gate live arm proves `delegationGate=allow` on its released side and pins
  `agentPreset=none` in the row log, so a release cannot be confused with a missing guard.
- A `mechanical-default` side seeds NO `team.gate` and asserts `sessionGate=mechanical` plus the full
  staging contract (one notice naming a plan id, one staged slot, zero team records, `staged=1` with the
  same id), with the key's absence proved rather than assumed.
- The boulder claim cites current green evidence, and the Docker TUI lane pins `panelAutoOpen: false` in
  its profile's user layer so its pre-key control capture measures what it claims whatever the fixture
  timing.

**Changed — documentation and UI refresh.**

- The README pair carries the v0.15.0 badge and current-release line, and the capability list names
  `cordis-dev`; the user-guide pair documents the restored guards and the delegation gate's preset scope
  in §6, corrects "seven write tools" to **eight** (the canonical deny list includes `bash`), and §7 now
  names `tuiPanels` as the primary Agent Teams surface plus the attention badge, `panelAutoOpen` and the
  stateless ≥ 0.16.1 deployment.
- The `tui.md` pair's preamble target is REWRITTEN to dsh-tui **0.16.1** and points at §11.8 (the 0.14.0
  narrative is kept as history rather than bare-swapped), §11.8's "Was" cell is corrected, and both
  `packages/mpd-tui-plugin/README` halves read "adapted to 0.16.1".
- The design pair drops `mode: hard` from the `mpd-verify` config column — the guard is withdrawn and the
  key is diagnostic only — while every `mpd-tools` `writeGuard` mention stays (a different, still-shipping
  guard).
- The release also refreshes the documentation images and the three hand-authored SVGs; that capture
  work is owned by the UI-refresh lane and is recorded under `evidence/release/v0.15.0/ui-capture/`.

## v0.14.0 — DeepSeek Harness 0.2.1-rc.2 + dsh-tui 0.16.1, one shared plan→graph model, and a real-team acceptance lane

Minor release over v0.13.2, and a **BREAKING** one. The bundle now targets DeepSeek Harness
**0.2.1-rc.2** and dsh-tui **0.16.1**; the plan→graph model is computed once in the host plane and drawn
by both surfaces; and the 2026-10-10/11 guard ceremony is withdrawn, so the top-level agent holds its
tool pack directly again. A real two-member team now builds and tests a small project through the Web
composer and the TUI PTY in the Docker acceptance lane. Frozen contracts:
`.mpd/plans/harness-021-rollback.md` and `.mpd/plans/living-graph.md`; evidence is under
`evidence/harness-0.2.1/`, `evidence/living-graph/`, `evidence/docker/client-install/` and
`evidence/release/v0.14.0/`.

**Changed — the harness seam (0.2.1-rc.2).**

- The continuable spawn path is re-implemented on the 0.2.1 subagent seam (`startActivation` +
  `waitForChildren`); the removed `startContinuable` / `start` branches are gone, so a 0.2.1
  composition resolves a live member again instead of calling one the host REMOVED. The roster provider's
  advertised capability set is corrected to the four the 0.2.1 row really accepts (`agentOptions`,
  `agentPreset`, `outputSchema`, `depthLimit` — the retired `persona` / `toolFilter` are gone), and the dead `@deepseek-ai/dsh-invariants` pins under
  `packages/mpd-schemastery/harness/*/package.json` are dropped.

**Changed — preset / row parity.**

- The `mpd` preset follows the 0.2.1 `standard` row set: `time-context`, `tool-schedule` and the
  disabled `tool-plugin-manager` / `tool-plugin-market` are added, `tool-ralph` / `tool-subagent-codex` /
  `tool-subagent-claude-code` are retired, both `tool-subagent` rows drop `backgroundMode`,
  `mpd-agent-team` drops `maxPendingMessagesPerMember` (the key the 0.2.1 schema no longer declares), and the
  preset's persona prose is trimmed (below).

**Added — one shared plan→graph model (`packages/mpd-graph-core`).**

- `packages/mpd-graph-core` is the ONE implementation of the tolerant plan-markdown parser, the
  board+plan merge with its six-case report, the rank derivation moved VERBATIM out of the TUI, and one
  debounced watcher. It is a library — no cordis row, no patch entry, no dependency — and both planes
  inline it through `bun build`.
- The model is computed ONCE in the host plane: `mpd-team-core-plugin` resolves the plan with the
  core's own `resolvePlanFile`, calls `buildModel({ board, plan })`, caches per TEAM against the change
  feed's revision, and publishes the result on BOTH projections — the `mpdTeams` service
  (`graph(workspaceRoot, teamId?)`) and the `/plugins/mpd-team/state` payload (`model` +
  `tasks[].rank`, additive). The web client now derives NOTHING: its inline walk is deleted and it
  renders the served ranks, edges and ghosts, degrading to `depth` only when no model arrives. The TUI
  renders the same served model.
- Ghosts are real pictures: a node the plan declares and the board does not is drawn
  (`planned: true`, `visual: "planned"`) on both planes, and plan-only edges are drawn too. Plan-file
  edits now reach the existing change feed (`feed.notify(workspace)`), so one watcher and one channel
  refresh both surfaces instead of two independent rank derivations drifting apart.
- New gate `scripts/verify-graph-model.ts` (`bun run verify:graph`) with a hand-written oracle, a
  hard-coded golden fixture, `--fixture` / `--board --plan` / `--emit`, and a `--seed-wrong-edge`
  negative control that exits 1 naming the edge (`--self-test` 8/8). The TUI's DAG page names its rank
  provenance in three states: `derived (host)` · `served depth (host fallback)` · `local`.

**Added — a real-team acceptance lane (Web composer + TUI PTY).**

- `MPD_E2E_TEAM_PROJECT=1` makes a real two-member team build a small tested project through each
  UI's own input path: the browser lane types the prompt into the Web composer, the TUI lane types the
  same prompt into the tmux PTY. Each stages a two-member / two-task plan (T2 blocked by T1), approves,
  dispatches, waits, re-dispatches and closes both rows while the members write and test
  `team-project-web/` / `team-project-tui/`.
- `docker/lib/team-project-verdict.ts` reads the record by name + `--since` and requires every member
  raised, a resolvable dependency edge, completed tasks credited to team members, project files
  written during the step, and both the team's own test and a verifier-owned
  `sum(2, 3) === 5` assertion. It ships a 10-arm offline `--self-test`.
- `ui.teamBoard` binds to the id of the record THIS turn wrote, and the browser's live session is
  carried into the verdict. A team run must RECORD its 18 verdict rows (`missingOrNull`), so a verdict
  that never ran cannot pass by writing nothing; `--no-browser` is refused in team mode.

**Removed — the 2026-10-10/11 guard ceremony (user ruling 2026-10-17).**

- The top-level `mpd` agent holds its whole tool pack DIRECTLY again: `read`, `write`, `edit`,
  `bash`, `grep`, `glob` and `subagent` are callable with no loop armed, and steering comes from the
  persona prompt instead of hooks. The `mpd-roles` row no longer installs the captain-investigation
  guard, the delegation gate or the verification law's write guard; its boot line keeps one token per
  withdrawn capability and reports `absent` plus the reason and the knob
  (`verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)`, likewise for
  `captain.investigation` and `delegation.gate`) — never a mode.
- The roster's read-only discipline (the eight-name deny list) and the `ask_user_question` boundary
  backstop REMAIN installed. The roster, team, verify, memory, boulder and ULW surfaces stay shipped and
  callable; they stop being mandatory.
- `team.gate` becomes OPT-IN: `resolveGateMode` now defaults to `off` (an absent key AND every unknown
  value), so the session-start gate stages nothing unless a config layer explicitly asks for
  `mechanical`.
- **Honest consequence, stated rather than implied:** removing `installVerifyGuard` also removed the
  mechanical single-git-writer denial for member sessions. That rule is PROSE from this wave on — its
  enforcement is the dispatch contract (members edit files and run gates, the captain commits) plus
  review. The `mpd_verify_*` tools and their record validator still ship and still refuse an unsupported
  PASS; the verifier seat's ENVELOPE is prose too, and the seat's blindness is no longer observed (the
  observation log was fed by the withdrawn hook).
- QA cases that asserted the old denials are RE-PURPOSED to assert the new behaviour with the reason
  written in them, never silently deleted: `skills/dsh-qa/scripts/verify-law.ts`,
  `skills/dsh-qa/scripts/delegation-gate.ts`, `skills/dsh-qa/scripts/session-start-team.ts`, the
  `mpd-ulw-plugin` gate arms, and the NEW `skills/dsh-qa/scripts/captain-full-tools.ts` (its boot-line
  arm is the discriminating evidence; its read/write/bash witness is labelled CORROBORATIVE because a
  one-shot headless boot composes no agent preset). Two stale probes were retired with their reasons on
  disk (`packages/mpd-roles-plugin/test/RETIRED-PROBES.md`,
  `packages/mpd-verify-plugin/qa/RETIRED.md`).

**Fixed — the DSH-TUI adapter declarations.**

- Six `Tui*Like` shapes now agree with the installed 0.15.0 `.d.ts` (`tuiToast`, `tuiThemes`,
  `tuiPluginStorage`, `tuiMessageObserver`, `tuiEffectLedger`, `tuiWorkspaces`), `closeScene(id)` no
  longer guards on a return value the 0.15.0 `close(): void` never produces, `probeBackendAdmission()` is
  a declared member, and `tuiPrompt` is marked PHANTOM by the adapter's `PHANTOM_SEAM_KEYS` table
  instead of reading as merely absent. The target then moved to dsh-tui **0.16.1** (the
  harness-0.2.1 release): a declaration-level comparison against 0.15.0 found nothing breaking for the
  adapter — the same fifteen `tui*` seams, the same six shapes, `close(): void` + `active.id`, the
  `tuiPanels` seam, and `tuiPrompt` still a phantom — so the pins were the whole change. The pins moved
  in eight files (both Docker lanes, the UI stack, `dsh-distribution.json`'s `host-tui` ref and
  `dsh-plugin.json`'s `compat.hosts`, stale at `0.10.1`).

**Fixed — the team plane and the live rows.**

- The team web routes resolve the workspace from the SESSION the request names (new adapter
  `workspaceRootForSession`, backed by the agent registry) instead of the dsh process cwd, which had
  made the panel render “No team in this workspace yet” beside a completed board.
- A task claimed under a member's EXECUTOR HANDLE is credited to that member in the core progress
  reader, the dispatch idle pool and the TUI projection, so a busy member no longer sits in the idle
  pool and member cards no longer read `0/0`.
- A nested failure line no longer ends the reply wait while the lead keeps working: team turns settle
  only on the final DONE (or a credential bound), with a tail capture for long transcripts. A headless
  live turn after `approve` is now bounded instead of hanging forever, and team mode keeps the headless
  arm on a single-tool probe.
- Docker live-row grading separates SKIPPED live rows from a refused run, scopes the credential-free
  WEB check to the non-live reason, and grades real WEB and TUI turns for prompt-variable failures.
- The packer ships `packages/mpd-graph-core/dist` (`INLINED_PKGS`), closing the pack-closure gap.

**Changed — docs.**

- AGENTS.md §5 rules 2/4/5 and `§13`'s verifier term describe the restored contract; the captain's
  reserved-set long form in `agent-references/verification-flow.md` is rewritten as "the captain's tool
  pack" with the withdrawn behaviour recorded as WITHDRAWN; the glossary's delegation-gate and
  verifier-envelope entries carry the same status; `seam-adapters.md` points at `PHANTOM_SEAM_KEYS`;
  `docs/feature-audit.md` (both languages) records that the host removed its `tool-ralph` row from the
  0.2.1 `standard` preset. The `dsh-liangshen` attribution sentences are GONE from both halves of every
  bilingual pair that carried them.
- The living-graph wave documents the shared model in `packages/mpd-graph-core/README.md` (EN +
  zh-CN); the team lane documents `MPD_E2E_TEAM_PROJECT`, its 18 verdict rows and the evidence paths
  in both `docker/README*.md`; and the TUI target, the seam inventory and the pin carriers are kept in
  `docs/tui.md` (EN + zh-CN).

## v0.13.2 — a patch: the npm trusted-publishing lane and the dsh-tui 0.15.0 sidebar migration re-arm

Patch release over v0.13.1: releases now stage to npm through trusted publishing, the stale-default
sidebar migration is re-armed on dsh-tui >= 0.15.0 with the CodeRabbit PR #44 repair round on top, and
the v0.13.0 / v0.13.1 release notes are recorded under `evidence/tui/dsh-tui-015/`.

**Added — CI / release automation.**

- **Releases stage to npm through trusted publishing.** `.github/workflows/publish.yml` (`228df957`)
  publishes `@mpd-dsh/mpd` releases from CI via OIDC trusted publishing instead of a long-lived token;
  the probe, spec census and gate sweep are recorded under `evidence/tui/dsh-tui-015/npm-publish/`.

**Changed — docs / evidence.**

- The published GitHub Release notes for v0.13.0 and v0.13.1 are recorded bilingual and evidence-linked
  (`evidence/tui/dsh-tui-015/RELEASE-v0.13.0.md` and `RELEASE-v0.13.1.md`) (`e7f04bc1`).

**Fixed — the TUI sidebar migration.**

- **The stale-default sidebar migration is re-armed on dsh-tui >= 0.15.0.** `47bd0c80` restores the
  migration that rewrites a stale persisted default on the 0.15.0 host, and `fa7e37ea` lands the
  CodeRabbit PR #44 repair round (five findings) on top; the migration suite
  `packages/mpd-tui-adapter-plugin/test/panel-enable-migration.test.ts` covers both.

## v0.13.1 — the review pass: team-plane authorization, docker lane honesty, and the QA install path

Patch release answering all fifteen CodeRabbit findings on the v0.13.0 PR (#42), blind-verified PASS at
the fix revision (`rec-20261015T071509-834da8`). Triage and lane reports:
`evidence/tui/dsh-tui-015/coderabbit/`.

**Fixed — security / authorization (four Major, CWE-862 / CWE-863 plus two integrity defects).**

- **The live append verbs now require Lead authorization.** `agent_teams_plan`'s `add_member` and
  `create_task` append to a LIVE approved record only for the team's Lead; a roster member's attempt is
  refused with a reason and leaves the record byte-unchanged (the review's literal
  `recordNamesLead(sessionId, …lineage)` patch would have stayed bypassable through the lineage shape —
  the shipped guard narrows the ancestry, and an arm proves that shape is refused).
- **Lineage no longer identifies a roster member.** A member whose `parentSession` is the Lead can no
  longer inherit the Lead's close override; a forked/resumed captain still heals, and a delegation child
  is still refused.
- **The mailbox summary is scoped by team identity.** `send` stamps the resolved `teamId` on each mail
  record and the summary filters on that stamp, instead of member ids/names that repeat across teams
  (every team mints `M1`, `M2`, …); unstamped legacy rows are excluded from `scope:"team"` and reported
  as a count.
- **The archive/reap rule is keyed by the record's own `planId`**, stamped at approval, instead of
  Lead + name — a discarded retry plan can no longer reap a LIVE team. Records that predate the field
  are never archive-reaped (stated migration rule).

**Fixed — the Docker lane's own honesty.**

- `BROWSER_INSTALL` is reset before the mirror retry, so a SUCCESSFUL retry is no longer reported as
  unavailable (the retry used to keep the first attempt's exit code).
- The reply verdict subtracts the pre-send capture, so a STALE failure panel can no longer bind a
  credential bound before the current turn renders; two self-test arms pin both directions.
- Step 01b's tarball probe falls back to the mirror's metadata AND tarball before settling, so a
  registry whose metadata answers while its tarballs blackhole no longer passes the probe and stalls
  the install.
- The owed-cases step's budget story is stated with the shipped numbers (warm-cache 70.8–113.1 s over
  three green runs, the case's 1800 s install budget, the runner's 2400 s per-case ceiling).

**Fixed — the QA lane's staged install.**

- The `mcp-call` case installs the staged pack NON-LINKED (`--install-links` plus `--legacy-peer-deps`,
  the peer semantics a real profile has): a linked `file:` dependency never materialized the pack's OWN
  closure, so the ast-grep launcher resolved neither `@ast-grep/cli` nor `cclsp`. Both arms now share
  one warm npm cache (measured 70.8–113.1 s, from 1037 s cold) and the lane passes.
- Six smaller findings in the TUI QA cases (stale headers, an unrestored negative control, a stale pane
  width, fresh-session preference, dependency version gating) are fixed.

**Reported, not fixed here — a host-side product finding.** Any profile whose `node_modules` carries a
second copy of the harness core is boot-fatal through a duplicate `send_message` tool registration,
because `@deepseek-ai/dsh-scope` keys scopes by a module-local `Symbol`. Reproduced with the stack at
`evidence/tui/dsh-tui-015/coderabbit/skills3/collision/`; the lane avoids it by keeping peer
auto-install off, which is what a real dsh profile does.

**Bounds.** The five NITs the verifying seat recorded (an evidence-prose miscount, two QA self-test
summary/arm-name clarity items, the `agent_teams_mail` tool description not yet naming the team scope,
and a coverage note on the boot-fatal peer configuration) are recorded as follow-up candidates rather
than edited after the verdict, so the verified revision is the merged revision.

## v0.13.0 — two host adaptations and a leaner captain: dsh-tui 0.15.0, live team surfaces, the MIT re-source, the win32 band, and the keeper that knows when to stand down

This entry covers the FULL delta since v0.12.0 (user-mandated): two DSH-TUI adaptation waves (0.14.0
then 0.15.0), the de-vendor/re-source chapter, the delegation and question-guard hardware, the win32
compatibility band, the live team surfaces, the model-route repairs, and this wave's three functional
clauses (the keeper re-spec, the decision-events grant flow, the 0-task DAG fix) plus the team
dispatch guards.

**Changed — the DSH-TUI edition moved two host releases, and both were carrier moves plus
user-visible repairs.**

- **Adapted to `@deepseek-harness-tui/dsh-tui` 0.14.0, then 0.15.0.** Both moves left the fifteen
  plugin-facing `ctx.tui*` seams untouched (0.14.0: byte-identical; 0.15.0: additive-only `.d.ts`
  declarations — `applyConfiguredSidePanelPanels`/`applySidePanelPanelsFromSettings` on `panels`,
  `probeBackendAdmission` on `plugin-host`), so neither needed an adapter seam change. 0.14.0 brought
  the eighth builtin panel (`btw`) and a carousel `PanelBar` that stopped painting icons; **0.15.0
  paints icons again** (an inactive tab draws `tab.icon ?? <title's first character> ?? '?'` plus the
  unread count — re-measured, see `docs/tui.md` §11.7). The version pin moved in every carrier both
  times (`docker/**`, `dsh-distribution.json`'s `host-tui` ref, the seven QA carriers, the remedy
  header, both `docker/README*`); `MPD_E2E_DSH_VERSION` never moved (the harness peer range is
  unchanged), and `dsh-plugin.json`'s `compat.hosts` keeps the 0.10.1 admission measurement.
- **The sidebar collapsed to TWO MPD pages** (0.14.0 wave, user clauses 「DAG页作为MPD面板」 and
  「把MPD与Workmate两个panel扔到侧边栏上去」): the rich `MPD` page (`❖`, the host's curated subagent
  rows above the DAG page's own frame) and `MPD workmate` (`⬢`); the standalone `dag` page's
  registration is gone with no route, picker entry or `⤢` left as a dead end, and the page's own `⤢`
  opens the RICH team scene. The two pages later gained **independent on/off switches** and then
  **`/settings` CHECKBOXES** bridged to `<workspace>/.mpd/mpd.jsonc`.
- **The enable-list keeper evolved twice.** The 0.14.0 wave made it FEED-FIRST (the host's own
  `subscribeSidePanelPanels` subscription repairs a config-mirror wipe as it happens; the bounded
  ladder survives as the degrade path; a provably-dead past id is pruned in a prune-only write before
  the stand-down). **This wave re-specs it onto the host's native self-heal (C2, user-mandated)**:
  from 0.15.0 the host itself unions registered ids back into the enable CSV and records explicit
  `/settings` removals session-wide, so the keeper now detects the host version through the adapter's
  `readHostPackageVersion` and on `>= 0.15.0` **stands down before any write path — no feed, no
  ladder, zero writes**, with one log line and an observe-only belt that watches the first host apply;
  an empty, unparseable or older version keeps the 0.14 behaviour byte-for-byte.
- **The recorded panel-id set carries PROVENANCE on both sides** (a unit-test run had poisoned it with
  impossible `act0:*` ids): the recorder refuses a record it cannot trace to an installed host package
  and a read-back, and `scripts/mpd-tui-panels.ts` refuses a provenance-less record by name, never
  drops the host's builtins, never guesses a residual, and restores only what the user asked for.
- **The corpus, the personas and the cores are OURS now (the MIT re-source + de-vendor waves).** The
  served skill corpus is re-sourced from the same author's `lazycodex` under MIT; the 11 roster
  personas are re-sourced from permissively licensed public agent prompts; the last vendored cores and
  MCP servers are replaced — `ast-grep` is our own MCP server, the language-server bootstrap for ~40
  languages is restored as our code, the remaining servers are declared npm dependencies behind thin
  launchers — and the vendored `agent-teams` body is deleted outright (harness 0.1.7's official Agent
  Teams plugin replaced it). The repository is **MIT** (`LICENSE.md`, `LICENSE-NOTICES.md` carries the
  per-component declarations), and `VENDOR_LOCK.json` now fingerprints the bytes this repository SHIPS
  (historical provenance recorded, never re-fetched).
- **The model-route plumbing.** The saved `teamModels` route reaches the one-shot spawn paths; **a
  model that declares no reasoning effort is sent none** instead of failing; the model config
  **live-refreshes in-process** and a per-agent route table (`agentRoutes`) landed with it.
- **A team with ZERO tasks renders as a team (C6, the user-reported defect).** `dagPageOf` used to
  discard a resolved team's identity the moment its board was empty, so a live six-member team painted
  one dim "no team" line; the MPD panel now draws the header facts, a one-line roster and the
  `agent_teams_plan` hint for every resolved team, session-scoped and workspace-fallback alike.

**Added.**

- **Live team surfaces.** `mpd-team-core` publishes team changes (subscribe + SSE); the Web team view
  follows the feed; the TUI draws **THIS session's** team live (session scoping with the three-state
  honesty rule — `no team in this session`, the marked `workspace-level` fallback — and the change
  feed as the re-render). The Docker lane accepts a caller-supplied live prompt, and a nightly
  key-less real-machine CI lane runs the acceptance grading.
- **Delegation became hardware.** A mechanical gate denies bare `subagent`/`subagent_fork`/`workflow`
  for the sessions a knob covers; the captain predicate recognises the SEEDED FORK (the user's own
  session is the captain, never a preset name); read-only spawns tolerate harness-rejected deny names
  (pruning exactly the names the harness reports unknown, one logged retry); and reconnaissance is
  DELEGATED from the captain (source reads are an Explorer/Researcher job).
- **The `ask_user_question` guard.** A pre-dispatch guard plus a prompt-construction rule plus an
  occurrence audit: every question item carries a non-empty id and a non-empty options array whose
  every entry carries a label — no free-text question reaches the panel.
- **Team dispatch guards (C7, this wave).** The team plane's dispatch pass refuses cross-team pairings
  and write-task-on-read-only-member pairings in the pure decision, and the refusal sentences are
  user-visible in the dispatch report (`refused a CROSS-TEAM pairing: …`, `was passed over by a
  dispatch guard (…)`) — a skipped task always carries its reason. Pinned by
  `packages/mpd-team-core-plugin/test/dispatch-guard.test.ts`.
- **The decision-events grant flow, documented and activatable (C3', this wave).** The four
  `session.*.intercept` declarations in `dsh-plugin.json` map one-to-one onto the host's
  `~/.dsh-tui/extension-grants.json` grant rows; `docs/tui.md` §11.7 documents how to grant, what it
  enables and the fail-closed posture (a malformed file reads as empty, a legacy bare-string rule
  never authorizes, admission re-reads per operation).
- **Restored capabilities that the vendored era lost**: the four-lane review panel skill
  (`review-work`), the hashline conservative fuzzy-repair pass (our own implementation), and the
  language-server bootstrap above.
- **Windows-first polish**: PowerShell twins for the `data-scientist` and `programming` skill scripts,
  a shell-portable `evidence:mount`, `tmpdir()` fixtures instead of hard-coded `/tmp` paths, and
  long-path-safe evidence naming.
- `@dsh-std/sdk` is a declared dependency (documented adapter-dsh self-install), and the distribution
  READMEs point at `dsh-distribution.json`.

**Fixed.**

- **The win32 band (19 arms, one production defect).** Every ESM import in the swept band hands the
  loader a file URL; the MCP launchers stop passing absolute Windows paths to `node`; the side-panel
  remedy runs on win32; doc-path spelling stays POSIX with backslashes preserved; checkout forces LF
  so the byte gates hold; the sidebar lane runs on Windows.
- **Sidebar defects**: the accumulating-legend defect (two React children shared one key, rendering
  one extra legend row per click — the key is the row's position now); the dots/scroll/panels
  lifecycle; the stale `sidePanel` pin heals and the MPD panel's sections are labelled; wheel
  direction has ONE normalisation point behind the `tui.wheelInvert` knob.
- **Captain scope**: the captain's behavioural rules are scoped to the `mpd` preset (a seeded fork
  with a different preset no longer inherits them by name), and the closed-hypothesis bullet respects
  the reconnaissance guard.
- **QA honesty**: the evidence reader decodes session-store v4 and honours `isError`; the model stub
  speaks DeepSeek Messages; the acceptance lane's rows became measurements with working negative
  controls, stages the pinned toolchain, and its registry selection actually takes effect.

**Removed.**

- The vendored `agent-teams` body (with its adapter facade, counted bypass inventory and `mpd-delta`
  registry), the vendored MCP servers, the SUL-annotated cores, and the pre-vendoring snapshot trees
  — nothing in the live tree reads, copies or fingerprints anything outside this repository.
- The **Security Policy** and every reference to it (the private-reporting guidance that points at
  GitHub's Security tab stays), and the tautological rank tests in the delegation-gate suite.

**Evidence.** This wave's host measurements are frozen at
[`evidence/tui/dsh-tui-015/host-diff/`](./evidence/tui/dsh-tui-015/host-diff/) (`FACTS.md` is the
committed record; the two npm tarballs it measures are third-party bytes and are NOT committed — its
header carries the download and unpack commands that reproduce `a/` (0.14.0) and `b/` (0.15.0) beside
it); the unit band at the docs revision reads 74 pass / 0 fail
(`packages/mpd-tui-adapter-plugin`) and 482 pass / 0 fail (`packages/mpd-tui-plugin`); the sandbox
lanes and the Docker dual-mode lane land under `evidence/tui/**` with the release sweep. Per-wave
records for the merged intermediate waves live under `evidence/**` where each PR cited them.

## v0.12.0 — the product page, and one bundle on two surfaces

### `README.md` becomes a product page, and the manual moves to the user guide

**Changed.**

- **The root README is rebuilt as a product page** in the shape the `dsh-tui` project's README uses:
  a language switch, three short paragraphs, a hero capture of the running product, `Features`,
  `Install`, `Quick start`, `Usage`, **`Status and known limitations`**, the documentation index, and
  the provenance/license sections. It was 68 524 B of manual; it is 18 429 B, and the long form lives
  where a long form belongs — [`docs/user-guide.md`](./docs/user-guide.md) (57 770 B, with its
  `zh-CN` twin), which already existed and is why **no `docs/manual.md` was created**: a second copy
  would have been a third overlapping document. `README.zh-CN.md` is the zh-CN twin and is updated
  in the SAME change, as the language policy requires.
- **No section of the old manual was lost.** Every `##`-level section of the pre-wave README maps to
  an existing home — a RETAINED section of the new page, or a named section of the user guide, the
  design document or the parity ledger. The per-section table is
  [`evidence/docs/readme-0.12.0/README-section-map.md`](./evidence/docs/readme-0.12.0/README-section-map.md),
  and the three pieces that existed nowhere else were given a home in this wave: the **MCP
  literal-call recipes** (user guide §13.11, new), the **two symptom rows** for a missing
  `comment-checker` binary and a silent CodeGraph (user guide §11), and the **roster sizing
  guidance** (user guide §4).
- **The dual-surface story is the spine of both files.** A `Web | TUI` comparison table sits in the
  top half of the page: one row per concrete surface — the team roster, the task graph, the watchdog
  banner, plan approval, the workmate library, the settings card, the terminal status line — with the
  Web column, the TUI column, and a parity column. **Every parity claim is one the existing ledger
  already records**, and the rows that are *not* at parity are the ledger's own open deviations,
  named in the table rather than smoothed over. [`docs/tui-parity.md`](./docs/tui-parity.md) stays
  the authority; the README now points at it in the sentence right under the table.
- Long-form content is reachable from the README through `docs/user-guide.md`, `docs/index.md`, the
  design document and the parity ledger; the sections the README used to carry that had no other home
  were moved into `docs/user-guide.md` rather than dropped (see *Content preservation* below).

**Added.**

- **A real screenshot set, captured on a real machine and cropped to THIS bundle's surfaces.** The
  README's images are produced by the Docker UI lane under [`docker/ui/`](./docker/ui/):
  - the **Web** tiles by headless Chromium driving the real app, captured as tight crops around the
    bundle's own Team view, settings card, preset card and plugin row rather than as full-window
    frames of the harness chrome;
  - the **DSH-TUI** tiles by rasterizing the **ANSI byte stream the real TUI emitted on a real PTY**
    (`tmux capture-pane -e`, which carries the TUI's own colours) at the character grid tmux computed
    — previously the TUI was only ever captured as plain text, and the repository shipped **zero**
    terminal images;
  - a paired **hero** composite showing the same bundle on both surfaces side by side;
  - both sets in **English and zh-CN**, so the Chinese README does not show an English app.
- **The images have a stated provenance**, not just a directory: see
  [`evidence/docs/readme-0.12.0/image-provenance.md`](./evidence/docs/readme-0.12.0/image-provenance.md).
  It records the exact method, the fixture that makes every surface render populated, and — stated
  rather than implied — that the terminal tiles' PAGE BACKGROUND is the lane's choice because the TUI
  deliberately never paints one; every foreground colour comes from the byte stream.
  It also records three dead ends a future lane must not re-pay for: this image's X server accepts a
  connection and never answers (`import`, `xwd` and `xdpyinfo` all return exit 124 with zero bytes);
  `xterm -sb 0` is invalid (`-sb` is a boolean, so the `0` becomes the shell argument); and
  `pkill -f <pattern>` self-matches the calling shell.
- `docker/ui/` gains the capture steps that produce the set, so the images are REPRODUCIBLE from the
  tree instead of being hand-taken artifacts. The lane stays an INSPECTION harness: it holds the two
  surfaces open and asserts nothing about the product.

**Fixed — a marker that was not unique to its surface.** The terminal capture gates every scene on a
marker read out of the live pane. The marker first chosen for the team scene — the fixture's team
name — is ALSO printed by the chat screen's keyed status line, so one capture fired on the chat
screen and produced an image of the wrong surface. The shipped tiles were each confirmed by looking
at them; the lesson (a readiness marker must be unique to the surface it gates) is recorded in the
lane's own comments so the next lane inherits it rather than rediscovering it.

**Fixed — a Docker-lane assertion that had been stale for four hours, found by this wave's release
sweep.** `node scripts/docker-e2e.ts --mode source --require-docker` failed 2 of its 94 assertions
(`tui.teamGraphContent` and the abort it caused). It is **not** this wave's doing: the same two arms
fail identically when the same lane is run against the PRE-wave commit, and the mechanism is that
commit `6fdfc012` (12:39 UTC) froze clause AC1 — every node reads `<marker> <id>` and nothing else,
with the subject moved into the pinned detail body — while the lane still asserted the OLD drawing
shape. The last green lane run was 10:58 UTC; nobody re-ran it in between. The arm is repaired to
assert what the contract now says, and strengthened while it was open: the expected ids are read out
of the RECORD the lane itself wrote rather than hard-coded, each id must appear as a NODE LABEL
(which a detail row cannot satisfy), and the record's own subject is asserted where AC1 moved it.
The differential experiment, and the two plausible environment hypotheses it falsifies, are recorded
in [`evidence/docker/lane-staleness/tui-teamGraphContent.md`](./evidence/docker/lane-staleness/tui-teamGraphContent.md).

**A second, WORSE defect found in the same file: an assertion that proved nothing.**
`tui.teamGraphDrawn` claimed to prove the DAG boxes were drawn, but it matched the square corners
`┌ ┐ └ ┘` — and the boxes have been ROUNDED (`╭ ╮ ╰ ╯`) since the same wave. Measured on the lane's
own pane: the square corners appear exactly ONCE each, on the scene FRAME, while the rounded ones
appear three times each, one set per box. So the arm passed on frame chrome and **stayed green with
every box deleted**. It now counts the rounded corners against the record's own task count. The
vacuity is demonstrated rather than asserted: on one pane with the `T2` box removed, the new arm
answers `false` (`corners=╭2 ╮2 ╰2 ╯2 tasksFromRecord=3`) while the OLD arm on that same pane still
answers `true` — and three further mutations (frame-only, a record with one more task than the pane
draws, a pane re-drawn with the pre-wave square corners) flip the new arm while leaving the old one
green. Both graph arms now read their expected values out of the record the lane writes, and both
report measured values (`corners=╭3 ╮3 ╰3 ╯3 tasksFromRecord=3`; `ids=T1,T2,T3 fromRecord=3
labelsExpected=3 missing=[none] pinnedFocus=T1 detail=[T1 · requirement · freeze the contract]`)
instead of the literal strings they used to carry.

**Removed.**

- **The five full-window `docs/assets/images/web-ui-*.png` captures are gone** (476 KB). The new set
  supersedes them: each of the five showed the harness chrome around the part that mattered, and the
  product page now shows the bundle's own surfaces, cropped. Nothing is lost — the raw full-window
  frames stay tracked under `docker/ui/out/shots/` and the deleted files remain in this file's own
  git history. `assets/images/` is a CURATED set documented by `docs/index.md`, so leaving five
  files no table described was rot rather than a safety net.

**Declared bounds (named, not silent).**

- The Web tiles are Chromium at a fixed viewport; a different browser size lays out differently. The
  terminal tiles are one terminal emulator's rendering of the same bytes. The claim is the **facts on
  screen**, not pixel identity — and the README says so in its own *Status and known limitations*.
- The three authored SVG diagrams (`architecture`, `ulw-loop`, `team-lifecycle`) no longer sit in the
  README; they remain in this repository, are still rendered by `docs/index.md`, and are linked from
  the README's documentation index through the documents that own them.

### The vendored `dsh-agent-teams` body is DELETED, and what still ships has moved

**Removed.**

- **`packages/mpd-agent-teams-plugin/**` — 768 files, `_deps/` included — is GONE.** The body had
  already been retired from the composition in 0.1.7 (no loader row mounted it); this wave removes the
  code. Nothing in the tree reads, imports, patches, fingerprints or copies it any more: the whole
  `_deps/` runtime closure, the `agent_teams_*` tools, the prebuilt client sources under `lib/client/`,
  the `self-fix-tests/` suite and the delta registry (`agent-references/agent-teams-deltas.md`) went
  with it, together with the three scripts that existed only to vendor, patch and reclaim it
  (`scripts/vendor-agent-teams.ts`, `scripts/patch-agent-teams-fixes.ts`,
  `scripts/patch-agent-teams-client.ts`, plus `scripts/reclaim-staged-teams.ts` and the ambient shim
  `scripts/lib/vendored-agent-teams.d.ts`).

**Added.**

- **`packages/mpd-schemastery/` — the mpd-owned home of the two pieces the shipped product still
  uses.** `lib/` carries the schemastery validator (the `Config` schema of four SHIPPED plugins), its
  `cosmokit` dependency and the type declarations — including the GLOBAL `Schemastery<T>` interface
  `export const Config: Schemastery<Config>` relies on, which is why the package ships a manifest with
  `exports.types`. `harness/` carries the six DSH framework modules (`cordis`, `dsh-tools`, `dsh-llm`,
  `dsh-session`, `dsh-scope`, `dsh-timeout`) that four TEST files drive directly — they need a real
  dispatcher and a real harness validator, not a double. The eight-file closure is self-contained: no
  network, no new npm dependency, and `cordis`-family `devDependencies` were refused because
  `verify-plugin-manifest` forbids them by name. Both upstream MIT notices are reproduced in
  `packages/mpd-schemastery/LICENSE`.
- **`packages/mpd-bundle-plugin/adopted/agent-teams-client.js`** — the adopted browser bundle (the
  0.1.14 build) and its source map, moved to the bundle package that embeds them. The committed
  `packages/mpd-bundle-plugin/client.js` was rebuilt from the new path and differs from the previous
  bytes by exactly one line and twelve bytes (the `sourceMappingURL` now names the relocated file).
- `docs/independence.md` §5, the pinned-debt entry, is **CLOSED** with the measurement that closed it.

**Changed.**

- The migrated surfaces were re-pointed in the same commit as the deletion: `tsconfig.json` (the
  adopted-suite `exclude` entries are gone), `bun.lock` (one workspace entry swapped),
  `scripts/{pack-mpd,verify-pack-closure,verify-dist-fresh,verify-docs-parity,verify-comment-coverage,install-profile,build-mpd-client}.ts`,
  `docker/**`, the cross-package coupling inventory, the no-terminal-writes band and the watchdog test
  suite.
- `package.json`'s description now reads *upstream reference … historical, no synchronisation owed*.

**Declared bounds (named, not silent).**

- The `verify-docs-parity` derived-value rule (delta range + region count) and its `EXEMPT_PROVENANCE`
  map are VACUOUS in the live tree — they are exercised only by the gate's own `--self-test` fixtures,
  and every run PRINTS that fact instead of passing silently.
- The `mpd-team-watchdog-plugin` fault-injection fixture
  (`test/fixtures/inject.ts`) was deleted with the body it drove; the QA cases reading it are retired by
  the wave's `skills/**` writer.
- The workmate persona-injection hook lived in the deleted body's `memberPersona()`; automatic
  injection into team members no longer fires (see `packages/mpd-workmate-plugin/README.md`).

### DSH-TUI 0.13.0: the sidebar panel seam, and a `Ctrl+A` that is now version-gated

**Changed.**

- **The DSH-TUI edition is adapted to `@deepseek-harness-tui/dsh-tui` 0.13.0, and the adapter adopted
  the release's new sidebar panel seam as the FIFTEENTH `tui*` seam.** 0.13.0 adds `ctx.tuiPanels` (host
  row `dsh-tui-panels`, export `@deepseek-harness-tui/dsh-tui/panels`) and renames the host's own
  `dsh-ecosystem-spec/` directory to `tui-profile/`; the move touched every carrier in one wave — the
  global package and the `dsh-tui` profile, the distribution pin (`dsh-distribution.json`'s `host-tui`
  ref is `pkg:npm/@deepseek-harness-tui/dsh-tui@0.13.0` now) and the QA host spec (`docker/tui-lane.sh`,
  `docker/entrypoint.sh`, `skills/dsh-qa/scripts/tui-mount.ts`'s `TUI_HOST_SPEC`,
  `skills/dsh-qa/scripts/install-dependencies.ts`'s remedy, all defaulting to `0.13.0`).
  `TUI_SEAMS.panels` is bound, probed and degraded like every other seam, and
  `packages/mpd-tui-plugin/src/panel.ts` registers ONE right-sidebar panel whose body is the MERGED view
  — the host's curated subagent snapshot rows first, then the MPD dependency DAG — under a FROZEN
  descriptor: slug `team`, title `MPD`, `minColumns` 32, `order` 10, and **no** `compact`, because
  0.13.0 validates and stores a descriptor's `compact` slot but does not mount its render slot, so
  declaring one would claim a surface that cannot render. The final panel id is DISCOVERED from the
  host's own `list()` read-back (measured `act1:team`), never composed. `alt+a` and the new `/mpd panel`
  subcommand route through `tuiPanels.open()` while the seam is bound and FALL BACK to the existing
  full-screen merged scene (`mpd-tui-subagents`) on any refusal — the one-open-per-plugin-per-5000 ms
  rate limit, an id the host no longer owns, or no live panel consumer — never a silent no-op. The
  legacy `Ctrl+A` host-input takeover is now VERSION-GATED: on a host that offers the panel seam it
  stays INERT and `Ctrl+A` keeps the host's own dashboard meaning, while a host WITHOUT the seam keeps
  the old arming rule (`tui.dashboardKey` on and the workspace team holding ≥1 task); `tui.dashboardKey`
  stays in the config schema and the `/settings` row, documented as meaningful on OLD hosts only.
  `docs/tui.md` and `docs/tui.zh-CN.md` carry all of it in both languages — including a new §11.3
  amendment, with the 0.12.0-era sentences kept readable as history rather than silently rewritten.
  Real-PTY evidence on 0.13.0: mount lane PASS (`evidence/tui/lanes/2026-10-06T10-27-42.389Z/`), the
  surfaces lane with 7 of its 8 surfaces rendered — status line, `/mpd` completion, the `/mpd workmates`
  command, the sidebar panel registration + open, the board scene, the `/settings` section with its
  disclosure, and the managed dialog — with its negative control red as required
  (`…/2026-10-06T10-27-53.571Z/`), and the `Ctrl+A` lane PASS (`…/2026-10-06T10-28-57.807Z/`); the full
  lane report is `evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`. **The bounds are
  stated, not glossed:** (a) the panel's BODY is not observable in a tmux pane capture on this host — a
  320×50 capture was byte-identical before and after a host-ACCEPTED open, so the lane proves
  registration + `open()` + the discovered id, NOT a render (recorded as `panelBodyBound`); (b)
  `tuiRenderers` is still MISSING — the surfaces lane exits 1 on that required surface — a pre-existing
  structural gap already declared in `evidence/tui/EVIDENCE-INDEX.md`, not caused by this wave; (c) no
  0.12.0 PTY arm was obtained in this wave (a clean 0.12.0 sandbox needs `dsh plugin add`, blocked here
  by the read-only pnpm store lock, and the fixture that exists is a mixed-version composition that
  never reaches a chat screen), so the old-host arming path rests on unit arms — `takeoverArmed` in
  `packages/mpd-tui-plugin/test/panel.test.ts` (16 pass / 0 fail on this revision) together with BOTH
  version-gate arms in `packages/mpd-tui-plugin/test/plugin.test.ts` ("the contact stays INERT" and
  "the contact arms", green in the canonical per-package run `bun test packages/mpd-tui-plugin` =
  220 pass / 0 fail; only the explicit FILE-filtered form cannot load them, on a pre-existing vendored
  `_deps` module-resolution error in the retired adopted plugin).

**Changed.**

- **The session-start complexity gate's contract is written down where the model reads it.** The gate
  has been MECHANICAL since the plan plane landed: a trigger STAGES an APPROVABLE PLAN SHELL through
  the `agent_teams_plan` tool (0 members, 0 tasks) and injects ONE notice naming the returned plan id —
  NOTHING is spawned and the plan is INERT until the captain extends it (`add_member` / `create_task`)
  and approves it — while `team.gate` in `mpd.jsonc` selects `mechanical` (the default) | `advisory` |
  `off`. The shipped `mpd` preset, `AGENTS.md` §1, the `mpd-roles-plugin` README pair and the
  `mpd_config_get` consumed-keys list all still described the retired advisory-only behaviour; they now
  state the mechanical contract, the advisory fallback (the ONE notice then says `NO team was staged`),
  and the notice marker `[AgentTeams] Session-start team rule`. The sentence that an explicit `team:` /
  `!team` request was merely "routed to team mode" is gone — such a request now stages the shell too
  (signal A) and has its marker CONSUMED from the goal text. A new drift guard in
  `packages/mpd-roles-plugin/test/team-plane.test.ts` pins that preset text, so the prompt and the
  implementation can no longer diverge silently.
- **Signal D reads an ACTIVE boulder, not a plan file.** The retired probe ("some `.mpd/plans/*.md`
  exists") measurably fired in EVERY session of this workspace, because one plan file outlives the work
  that produced it. D now means an ACTIVE boulder work for the workspace (`status: "active"` in
  `.mpd/boulder.json`), and a plan FILE alone is not a signal.

**Fixed.**

- **The TUI plan scene's approval path is documented as PRESENT again.** The pane has carried the
  typed-phrase gate since W6 — type the exact phrase the pane serves (`approve plan-…`) and press
  `Ctrl+X`, `Ctrl+D` twice within 10 s to discard, `Ctrl+R` to re-read — and it now really acts: the
  action is an `agent_teams_plan {action:"approve"|"delete"}` call carrying the LIVE agent resolved
  from the adapter's own registry (`liveAgent(sessionId)`, else a live entry whose own `session.id`
  matches, else the ONE live agent when the scene carries no id). A caller that cannot be resolved
  REFUSES before calling anything; the live hop on a real TUI host is not yet falsified.
  `packages/mpd-tui-plugin/README.md`, `docs/tui.md` and their `*.zh-CN.md` twins said the approval
  flow was gone; they now state what is true, refusal path included.
- **`docs/design.md` no longer counts `dsh-better-sidebar` among the bundle's runtime
  `dependencies`.** It is an optional peer (+ a `devDependency`) the bundle deliberately does not
  install, and its ABSENCE is a normal, intended composition. Without it the SAME two bodies register
  into the harness's own right sidebar (the Team tab — which lists the WORKSPACE's teams for a session
  that has none — and the Workmate library), and that is the surface which must work; the old text
  promised one warning and "no surface outside the sidebar".

### DSH-TUI 0.14.0: fifteen unchanged seams, an eight-builtin panel bar, and a sidebar that carries two MPD pages

**Changed.**

- **The DSH-TUI edition is adapted to `@deepseek-harness-tui/dsh-tui` 0.14.0, and the adaptation needed
  NO adapter code change for the seam surface.** MEASURED on the installed tree: the fifteen
  plugin-facing `ctx.tui*` seam modules and their declarations under the host's
  `lib/types/dsh-adapter/` (`panels`, `scenes`, `status`, `renderers`, `settings-sections`,
  `shortcuts`, `dialogs`, `command-trees`, `plugin-host`, `toast`, `themes`, `plugin-storage`,
  `message-observer`, `effect-ledger`, `workspaces`, each `.js` + `.d.ts`) are **byte-identical** to
  0.13.0, there is no sixteenth seam, and the harness `peerDependencies` lists still end at
  `0.2.0-rc.2` — so `MPD_E2E_DSH_VERSION` does not move. The release's OWN additions are named because
  a reader meets them on the host: the **Claude backend peer** (`@anthropic-ai/claude-agent-sdk`
  0.3.287, the one peer the release adds), the **`ws` runtime dependency** (`^8.21.3`, absent at
  0.13.0), an **eighth** builtin sidebar panel (`btw`) and the rewritten `PanelBar` below.
- **The host's default enable CSV grew from three builtins to eight, and the bundle's own test now
  pins the INVARIANT rather than a literal.** `DEFAULT_SIDE_PANEL_IDS` is
  `todo,jobs,agents,info,trajectory,workspace,btw,companion` on the installed 0.14.0
  (`lib/types/tuiDisplayPrefs.js`), where 0.13.0 carried `todo,jobs,agents`. The two arms that pinned
  the three-id literal — and therefore reddened when the HOST grew — now assert what the clause is
  for: nothing of ours appears in that default, and every id in it passes the host's own
  `SIDE_PANEL_ID_PATTERN`. The file's premise is that it re-judges itself when the installed host
  changes, so a new literal (old or new) would reintroduce the same defect. Measured on this revision:
  `bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` = **469 pass / 0 fail**, and
  repo-wide the wave's verification record `rec-20261008T030715-f1a2ad` reads **1632 pass / 3 skip /
  2 fail** — the two reds are the declared environment defects, down from the contract's pre-wave
  1615 / 3 / 4.
- **`PanelBar` no longer paints a plugin's declared icon — a HOST fact, and the bundle's icon arm
  follows it.** `components/sidePanel/PanelBar.js` is a carousel on 0.14.0: the active tab's title is
  centred, every other tab is one `○` (`●` with a badge) dot placed by a computed pitch, and the file
  carries no `icon` reference at all (`grep -c icon …/PanelBar.js` = **0**). An `icon` is still
  REQUIRED by the host's validator and still declared by every MPD descriptor (an icon that is not
  exactly one cell is a refusal); it is simply no longer drawn. The collision set read from the host's
  own `builtinPanels.js` is now **eight** icons — `≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`, the new one being `?` for `btw`.
- **The `⤢` bound is re-measured on 0.14.0 and still holds.** `dsh-adapter/panels.js` still freezes a
  plugin definition to `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component,
  compact}` with **no `capabilities`**, while `components/sidePanel/SidePanelColumn.js`'s `canExpand`
  reads `activeEntry?.definition.capabilities?.fullscreen === true`, so the host's own `⤢` remains
  unreachable for a plugin panel and `capabilities` stays undeclared — a dead button is not shipped.
  MPD's own control is what opens its full-screen surface, and that surface carries the page's same
  rich appearance.
- **The 0.14.0 pin moved on every carrier that names the release, in one wave**: `docker/**` (both
  `MPD_E2E_TUI_VERSION` defaults in `docker-compose.yml`, the same key in `docker/ui/docker-compose.yml`,
  `docker/entrypoint.sh`'s `TUI_VERSION`, `docker/ui/entrypoint.sh`'s two `MPD_UI_TUI_VERSION` defaults,
  `docker/tui-lane.sh`'s `TUI_VERSION` and its `PREF_WRITER` probe string), the distribution
  descriptor's `host-tui` ref (`dsh-distribution.json` is
  `pkg:npm/@deepseek-harness-tui/dsh-tui@0.14.0` now) and the seven QA carriers under
  `skills/dsh-qa/scripts/**`. **Two carriers deliberately did NOT move**: `MPD_E2E_DSH_VERSION` keeps its
  `0.2.0-rc.2` default, because the harness peer range is unchanged; and `dsh-plugin.json`'s
  `compat.hosts` stays at `@deepseek-harness-tui/dsh-tui@0.10.1`, because that field records the
  **0.10.1 admission measurement** the bundle was admitted against — not the TUI edition it targets — so
  moving it would falsify a measurement instead of recording a target.
- **The sidebar carries TWO MPD pages — `MPD` and `MPD workmate` — because the rich DAG page and the
  plain merged page collapsed into one.** The user's clause 「将原先的MPD Panel和MPD DAG Panel合并，把MPD与
  Workmate两个panel扔到侧边栏上去」/「DAG页作为MPD面板」 is met by ONE surviving registration:
  `panel.ts`'s slot (slug `team`, title `MPD`, one-cell icon `❖`, `order` 10, `minColumns` 28, no
  `compact`) now RENDERS `panel-dag.ts`'s rich body — bordered frame, header + progress, legend,
  key-hint footer, click-to-pin detail body, three layouts, badge — with the host's curated subagent
  rows drawn ABOVE the drawing inside that same frame, and the separate plain merged renderer is deleted
  rather than kept beside it. The standalone `dag` registration is RETIRED (its `◈` icon is declared by
  nothing now). **No user-visible entry point became a dead end**, which is the clause's own test:
  `/mpd dag` re-aims onto the MPD panel's discovered id, `/mpd panel` / `/mpd subagents` / `alt+a`
  already routed through that slot, `/mpd workmate` keeps its page, and the adapter's recorded id set is
  DISCOVERED from what actually registered — two ids, never a composed three.
- **The full-screen MPD surface is as rich as the page it comes from** (user clause 「试着适配一下全屏
  按钮，还有全屏出来的MPD也要有这种富外观」). The page's own `⤢` opens the rich team scene
  (`mpd-tui-team` — frame, legend, focused-task detail pane, key hints) instead of the merged subagents
  scene, while the ROUTED fallback of `/mpd panel` and `alt+a` stays `mpd-tui-subagents`, the surface
  that carries the host's own rows. `registerPanelSurface` takes them as two separate options, because
  they answer two different questions.
- **The sidebar's enable-list keeper is FEED-FIRST, and the panel-id record now carries PROVENANCE.**
  The keeper installs the host's own `subscribeSidePanelPanels` subscription (released with the injected
  scope, degrades where the host has no such module), so a config re-apply that wipes the CSV is
  repaired as it happens instead of being lost when the bounded ladder ended — the durable form of
  「看起来侧边栏挂掉了」. The stand-down rule is unchanged: a list naming ANY of our ids means a
  configuration has taken a position on this bundle and the keeper stops for good, and our own write
  contains our ids, so it cannot loop. `.mpd/logs/mpd-tui-panels.json` is schema version 2 with
  `provenance {hostRoot, hostVersion, readBack, activation}`, and the recorder REFUSES to write a record
  it cannot trace to an installed host package and a host read-back — MEASURED because a unit test run
  had overwritten the real record with the impossible `act0:*` ids (the installed host's `pluginIdFor`
  fallback counter pre-increments, so the first bare activation is `act1`). **The READ side enforces the
  same proof**, so a polluted record cannot reach a user's profile patch:
  `node scripts/mpd-tui-panels.ts` REFUSES (dry run and `--apply` alike, exit 1) a record carrying no
  `provenance`, a blank `provenance.hostVersion`, no `provenance.readBack`, or
  `provenance.activation === "act0"`, names the field that failed, and points at `--ids a,b,c` as the
  escape. Measured against the polluted version-1 record: `REFUSED …`, exit 1, the record's sha256
  unchanged by the run, `--ids act1:team,act1:workmate` accepted, and `--self-test` green with one arm
  per refusal shape plus a well-formed version-2 record accepted.

**Fixed.**

- **The accumulating legend (`越点越多直到撑爆屏幕`) was a duplicate React key, and it is genuinely
  fixed.** The legend's rows were keyed `legend-${line.slice(0, 24)}`, and the drawing's own state-key
  line and the legend's first wrapped line both begin `✓ completed · ◐ running` — two children sharing
  ONE key, which made React render the collided row again on EVERY re-render. Measured on a mounted
  instance (the host's own React/ink, the pattern the panel suite already uses): the legend row count
  walked `[4,5,5,5,6,6,6,7,7]` across eight clicks, and it is `[4,4,4,4,4,4,4,4,4]` after the fix. The key
  is the row's position now — the same rule applied to the DAG page's detail rows and the workmate
  page's problem rows, which had the same content-derived-key shape — and the new arm keeps the fix
  honest by asserting the legend ROW COUNT is STABLE across N clicks: a re-render of a MOUNTED instance,
  not a direct call of the component function, which is why the pre-existing suite could not see the
  defect at all.

## v0.11.6 — the gate's own comments, and the manual's budget

**Fixed.**

- **The two doc comments the version-coherence rewrite dropped are restored**
  (`checkVersionCoherence`, `checkPackaging` in `scripts/verify-plugin-manifest.ts`). `bun run
  verify:comments` reddened on them on the release line; this patch is what puts the green gate back on
  the default branch.
- `AGENTS.md` is back inside the loader's instruction budget after the version-carrier rule pushed it
  104 bytes past the cap (meaning only: the injected copy was truncated at the tail).

## v0.11.5 — the release version lives in three files, and the gate knows it

**Fixed.**

- **Both shipping descriptors carry the manifest's version again.** `dsh-plugin.json` (the DSH plugin
  descriptor) and `dsh-distribution.json` (the distribution descriptor the TUI case asserts against)
  were still pinned at `0.11.1` after the v0.11.2–v0.11.4 bumps, so `bun run test:qa` reddened inside
  `tui-distribution.ts` on a release that was otherwise complete — the coupling was real and undocumented.

**Added.**

- **`verify-plugin-manifest` now checks version coherence** — one result per carrier, with the
  descriptor's own key path (`version` or `distribution.version`) — plus a sixth `--self-test` arm whose
  control is the real manifest, so bumping `package.json` alone is red in EVERY gate sweep instead of
  three steps later inside a QA case.

## v0.11.4 — the live-install lane judges the command it actually runs

**Fixed.**

- **The one-click lane accepts the `github:` shorthand it drives.** With v0.11.3's fix the live install
  succeeded and the run still failed on one assertion of ours: `install.profileDep` recognised only the
  `git+…` URL pnpm rewrites a spec into, while the lane runs
  `github:HaroldZ32/My-Power-Dsh` — the shorthand the README prints. The arm now accepts both shapes,
  and the driver's offline `--self-test` pins that it does.

**Verified.** The live lane on a clean `ubuntu:24.04`, installing
`github:HaroldZ32/My-Power-Dsh` from the released default branch:
**44 passed / 0 failed**, rows activating, tools registering, the TUI booting on a real PTY and
`agentPreset=mpd` in the harness's own session store.

## v0.11.3 — the one-command install actually completes

**Fixed.**

- **The self-referential dependency is gone.** `dependencies` declared
  `"@mpd-dsh/mpd": "github:HaroldZ32/My-Power-Dsh"`, so a git-hosted install resolved the bundle as a
  dependency OF ITSELF and pnpm 11 refused it (`ERR_PNPM_EXOTIC_SUBDEP … not allowed in subdependencies
  when blockExoticSubdeps is enabled`). Nothing resolves the bundle by name from inside the repository
  (the `@mpd-dsh/mpd` hits in `scripts/` are module-loader id strings), and Node's self-reference
  feature still resolves `@mpd-dsh/mpd/package.json` through the manifest's own name + `exports`.
  Measured after the fix: checkout lane 42 passed / 0 failed, scratch-git one-click lane green, and the
  live `github:` lane green on the released default branch.

## v0.11.2 — a TypeScript plugin, and a verification flow that ends in a real container

**Added.**

- **The Docker real-machine lane is the LAST step of the verification flow** (`bun run verify:docker`,
  `node scripts/docker-e2e.ts`), and it is written into `AGENTS.md` §4/§11 with its skip policy: a
  machine with no **rootless** Docker prints a notice and SKIPS (exit 0, the steps above still had to
  pass), `--allow-rootful-docker` opts a rootful daemon in, and `--require-docker` turns any skip into
  exit 3 for a release sweep. `--spec <install-spec>` drives any spec, including the live `github:` one.
- **The mounting contract is a binding rule** (`AGENTS.md` §2 + §8): a row reaches the harness ONLY
  through `cordis.patch.yml` + the profile mechanism — an independent package the profile references,
  never a DSH source edit, never a hand-written profile, never a row pushed into `<DSH_HOME>`.
- `agent-references/verification-flow.md` carries the ordered flow on demand, so the manual stays inside
  its instruction budget.

**Fixed.**

- **The literal one-command GitHub install now works.** `dsh plugin --profile web add
  github:HaroldZ32/My-Power-Dsh` failed on a clean `ubuntu:24.04` with `ERR_PNPM_IGNORED_BUILDS`; two
  independent causes were measured and closed: a stray untracked `pnpm-workspace.yaml` at the repo root
  carried pnpm's own `allowBuilds` template into the build context (its class is now excluded by
  `docker/Dockerfile.dockerignore`, asserted by the entrypoint's `copy.contextFiltered` and by four new
  `--self-test` arms), and `github:` resolves the repository's DEFAULT BRANCH — it served `master` while
  the build-script-free closure sat on `dev`, so this release is what puts that closure on the default
  branch.
- The TypeScript conversion's own reds: the two source-text `eval` arms in the bundle-plugin tests now
  erase types with the pinned transpiler, and the stale `mountSidebarPages(ctx, teamPage)` source pin
  matches the claim instead of one spelling of its argument.


### A canonical TypeScript plugin, installable in one command

**Changed.**

- **JavaScript is gone from the source tree.** 158 hand-written `.js`/`.mjs` files — every repository
  script and gate, all 54 QA cases, the docker probes, the extension template and example servers, and
  the package test suites — are now `.ts`, executed directly by Node (`node <file>.ts`, type stripping;
  the manifest states `engines.node: ">=22.18"`). Four trees stay JavaScript ON PURPOSE and are named in
  `AGENTS.md` §6: build products (`packages/*/dist/**` and the generated
  `skills/visual-qa/scripts/visual-qa.mjs`), adopted upstream bytes (`packages/mpd-agent-teams-plugin/lib/**`
  and `_deps/**`), and fixture DATA (`skills/ultimate-browsing/engine/templates/*.js`,
  `tests/golden/fixtures/math.js`). Two exceptions to the source rule are deliberate and adjacent to
  those: `skills/programming/scripts/typescript/check-no-excuse-rules.ts` resolves the CALLER project's
  TypeScript 7 API, so the repository's own TypeScript devDependency is declared under the alias
  `typescript5` and never shadows it.
- **Strict typing across the whole source set.** The root `tsconfig.json` now covers `scripts/**`,
  `skills/*/scripts/**`, `docker/**`, `tests/**`, `templates/**`, `extensions/**` and every
  `packages/*/test/**` tree, and `bun run typecheck` (`tsgo --noEmit`) exits 0 with zero diagnostics —
  the conversion of the test trees alone surfaced and closed 84 pre-existing fixture diagnostics.
- **Every declaration documented, and enforced.** `scripts/verify-comment-coverage.ts`
  (`bun run verify:comments`) is a TypeScript-AST gate: a precise comment must sit immediately above
  every declaration in that set, and every named function must write down its parameter and return
  types. It measured **8,376 violations and now measures zero**; inline callbacks, structural
  type-literal members and statements are out of family on purpose, and the report says so.
- **The two install-time rules became a standing gate.** `scripts/verify-plugin-manifest.ts`
  (`bun run verify:manifest`) refuses `cordis` in `dependencies` / `peerDependencies` /
  `optionalDependencies` — by name, and the optional field is NOT an exemption — and refuses any
  `preinstall` / `install` / `postinstall` / `prepare` script name. It also asserts the packaging
  contract the one-command install rests on (declared patch files exist, every row module path resolves,
  the `files` allowlist admits every runtime path, the frozen `evidence/` tree is excluded, and npm's own
  `npm pack --dry-run` list carries them). Both gates are members of `bun run verify:gates` and of the
  new `.github/workflows/gates.yml`, which runs on Node 24 + Bun.
- **The package is publish-ready.** A `files` allowlist takes the packed tarball from **100.9 MB to
  7.6 MB** (879 → 1134 files of source and build output; the 291 MB frozen `evidence/` tree is out),
  `icon.svg` plus `locale/{en,zh}.json` provide the plugin-inventory display metadata, the manifest
  carries repository/homepage/bugs/licence/`engines`/`publishConfig`, and `npm publish --dry-run`
  completes. There is no lifecycle script and no `cordis` dependency, so installing the package runs no
  code from it.
- **One-command install from the published package, verified on a bare `ubuntu:24.04`.** The dependency
  closure was made build-script-free, because pnpm 11 refuses an install whose dependencies have
  unapproved build scripts (`ERR_PNPM_IGNORED_BUILDS`): `dsh-better-sidebar` became an optional PEER
  dependency (still a `devDependency`, so the checkout keeps it; its row already disables itself when the
  host is absent), and the two binary tooling packages left the closure (`@ast-grep/cli`,
  `@code-yeongyu/comment-checker` — their launchers resolve from `PATH`/`.toolchain` and report an
  actionable error otherwise). `docker/docker-compose.yml` now declares an `mpd-oneclick` service beside
  `mpd-client`, and `node scripts/docker-e2e.ts --mode oneclick` runs the user's path end to end:
  `dsh plugin --profile web add git+file://…` (the local stand-in for
  `github:HaroldZ32/My-Power-Dsh`), the allowlist check on the INSTALLED tree, byte identity of the
  shipped `dist/` against the source tree's build, the mounting boot, the preset session and the
  isolation assertions.

**Fixed.**

- `skills/dsh-qa/scripts/wave2b-lane-d.ts` used `require("node:zlib")` inside an ES module, so its
  two-frame zstd arm threw before it could assert anything; the import is now an ESM import and the case
  passes 8/8 arms.
- `skills/lsp-setup/scripts/verify-lsp.ts` used a constructor parameter property, which Node's
  strip-only TypeScript mode REJECTS (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), and 22 relative specifiers
  across `skills/visual-qa/scripts/**` and `skills/lsp-setup/scripts/**` omitted their extension, so
  `node <file>.ts` could not resolve them. Both are now erasable-syntax/extension-clean and run under
  Node as well as Bun.
- `docker/tui-lane.sh`'s session-store probe imported `skills/dsh-qa/scripts/lib/session-evidence.ts`,
  which the wave renamed; the TUI lane's preset assertion and its exit verdict were red for that reason
  alone and are green now.
- `scripts/check-citations.ts` accepted only `.mjs` driver files, so its live header scan would have
  found ZERO drivers and passed vacuously after the conversion; the accepted spellings are `.ts` and
  `.mjs`, and the wrong-extension audit is now measured against a separate list.


### One implementation per repeated decision

A consolidation pass with no intended behaviour change. What proves that is not the diff but the
sweep around it: the same unit suite, the same static gates and the same user-facing QA lanes, run
before and after, with the one pre-existing red (`bundle-lifecycle`'s live probe) reproduced
identically on a pristine `HEAD` snapshot.

**Changed.**

- **Pure helpers have one home.** `packages/mpd-dsh-adapter-plugin/src/shared.ts` holds `isRecord`,
  `errorMessage` and `bundleRootOf`, re-exported from the adapter entry. Nine
  identical `message()` bodies, four `isRecord()` bodies and five bundle-root resolutions were
  deleted from the rows that carried them.
- **One adapter resolution.** `resolveDshAdapter(ctx)` replaces the eager
  `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` expression that sixteen rows spelled inline;
  `createLazyDshAdapter(ctx, { label })` stays the choice for a row that must also survive a
  transient "provider not ACTIVE yet" miss.
- **One skill-frontmatter parser.** `packages/mpd-ext-plugin/src/skill-frontmatter.ts` is the single
  implementation of the corpus YAML subset, consumed by the extension skill plane AND by
  `mpd-bootstrap`'s bundle-corpus provider, which loses its ~140-line copy of it.
- **Shared script primitives.** `scripts/lib/repo.ts` (`repoRootFrom`, `readJson`) replaces ten
  hand-written root walks and twenty-eight hand-written JSON reads across the gate/helper scripts.
  The vendored-corpus fingerprint helpers stay duplicated on purpose: `scripts/repin-vendor.ts`
  re-checks its mirror against `scripts/verify-vendor.ts`'s own bytes.

**Fixed.**

- The documentation citations that the moved lines rotted are repaired, and
  `node scripts/check-citations.ts` is green (25/25) where it was 21/25 — including four anchors
  that were already dead before this pass.

### An open-source front door, and captures of the shipped surfaces

**Added.**

- **The repository now reads as a project.** `CONTRIBUTING.md` (setup, build and test commands, the
  gates, the git model) and `SECURITY.md` (how to report privately) join the root set, each with its
  `*.zh-CN.md` twin, and `.github/` carries the docs-parity workflow, a pull-request template, and
  bug-report and feature-request issue templates.
- **Three diagrams and a real documentation hub.** `docs/assets/images/` holds the authored
  `architecture.svg`, `ulw-loop.svg` and `team-lifecycle.svg`; `docs/index.md` is rebuilt as a hub
  with separate reading paths for users, extension authors, contributors and agents.
- **Six captures of the running app** (`docker/ui/`): first run, home, installed plugins, the MPD
  settings section, agent presets and the team panel — taken inside the container, against the bundle
  installed by the real client flow. Five of them are referenced from the README, its zh-CN twin and
  the hub, and the checks behind them are recorded with the run: the `mpd` preset selected, the MPD
  section rendered, a session created with `agentPreset: "mpd"`, the team panel showing its roster,
  and no console or page error.

**Changed.**

- **`README.md` is a product page** — badges, a table of contents, a features table, install and
  quick start, configuration and an FAQ — with `README.zh-CN.md` updated in the same change, as the
  language policy requires. `CHANGELOG.md` gains the same further-reading set.
- **The packer ships the five new root documents** (`ROOT_FILES` in `scripts/pack-mpd.ts`), so the
  README's relative links resolve inside the packed artifact as well as in the checkout.

**Fixed.**

- **The UI capture lane's chromium guard keyed on the wrong thing.** It tested for the playwright
  package directory, so a rebuilt image with a recycled volume skipped the install and the capture
  died with `headless_shell: error while loading shared libraries: libglib-2.0.so.0`; it now keys on
  the shared library itself.

### Evidence files a lane regenerates stay out of the repository

`evidence/**/scratch-pack*/` joins the two sibling `scratch-*` rules: the dsh-qa extension lane
stages a full packed tree under its own evidence directory, and three runs of it added ~40 MB across
~3,700 files that one `node scripts/pack-mpd.ts --out <dir>` reproduces. The lane's own record —
`result.json`, `output.log` and `raw/` — is committed as before, and the earlier waves' already
tracked `scratch-pack` paths stay, forward-only.

## v0.11.1 — mailbox unread

v0.11.0 shipped with this capability listed as a bound: "the official inbox exposes no read state".
That was true of the TEAM SERVICE and false of the HARNESS, so it is implemented instead of documented
away.

**Added.**

- **`agent_teams_mailbox`** — how many messages are WAITING for this agent. The count is the harness's
  own arithmetic, not an estimate: the agent inbox emits `agent/inbox/inserted` when a message enters,
  `agent/inbox/claimed` when the loop takes it and `agent/inbox/discarded` when it is dropped, and
  `inserted − claimed − discarded` is "waiting, not yet taken". `watch: true` attaches the counter to
  the calling agent (idempotent). The count clamps at zero, because a counter attached to an
  already-running session may have missed claims it never saw.
- **`subscribeAgentEvents`** on the adapter — the generic form of `registerAgentPreStep`'s agent-scoped
  registration. The three inbox events are SCOPED (their `dsh-scope` subject resolver is
  `args[0]["agent"]`), so a listener on a row's ctx is filtered out of their dispatch; this seam
  registers on the agent's own scope and never lets a throwing observer break that dispatch.

**Fixed.**

- The team tools' boot line derived neither number: it printed `tools=10` while the plane had grown,
  and then a literal breakdown that said "13 tools" when there were 14.

## v0.11.0 — the team workflow, per-member routing, and a settings surface that reads

The official Agent Teams plugin owns the team RUNTIME and nothing else. This release adds the WORKFLOW
around it, the routing it cannot express, and the GUI/settings work that a Docker view of both shipped
surfaces drove.

**Added — the team workflow (`mpd-team-tools-plugin`).**

- **Staged plan + approval.** `agent_teams_create` / `_add_member` / `_create_task` / `_edit_plan`
  stage a plan; `agent_teams_approve` EXECUTES it — spawns every member through `spawn_teammate`, posts
  every task to the official board, resolves `blocked_by` from planned subjects to posted ids and
  `owner` from staged names to spawned ids, and names where it stopped if it did. `dry_run` reports
  without creating. Nothing is spawned before approval.
- **Task contracts.** `agent_teams_claim_task` claims on the board AND freezes the task's meaning with
  a monotonic `attempt` counter; `agent_teams_task_contract` reads it back. The counter is why the
  sidecar exists: the board's `revision` moves for every mutation, so it cannot stand in for an attempt.
- **Halt / resume.** A hold that stops new dispatch and leaves the team and its members alive —
  deliberately not an ending. `agent_teams_delete` is the ending, and it ARCHIVES.
- **Dispatch.** `agent_teams_dispatch` pairs each READY task with an IDLE member, sends the task, and
  RECORDS the pairing, so a second pass cannot hand the same task to a second teammate (a message is
  not a ledger). Ledger entries for tasks deleted or completed out of band are pruned first, so a
  member is never left busy forever. `agent_teams_dispatch_release` frees one pairing.
- `agent_teams_status` prints the sidecar beside the official roster and board, and `/agent-teams
  <what the team is for>` stages a plan from the current goal.

**Added — per-member model routing (`mpd-roster-provider-plugin`).**

`spawn_teammate` used to inherit the Lead's route: the official TeamService forwards only
`{ prompt, parent }`. The harness itself is not the limitation — `SubagentContinuationManager`
resolves `request.agentOptions` and hands them to the PROVIDER, which constructs the run, and the
provider NAME is row config (`config.freshProvider`). This bundle therefore registers `mpd-roster`, a
provider that delegates to the composition's own and applies the member's `teamModels` slot route, and
points its `mpd-tool-agent-team` row at it. The teammate stays a real, continuable official teammate:
no fork, no contract change. A teammate `description` that NAMES a roster member routes that member;
one that does not inherits the Lead's route — the descriptor label is the only identity channel the
team service forwards. An incomplete slot fails the spawn loudly, naming the member and the slot.

**Added — the team GUI in the harness's own right sidebar (`mpd-bundle-plugin`).**

A Team tab registered through `ctx.sidebarRightTabs`, rendering the Lead session's `agentTeam`
projection: completion, `N of M running · ready · blocked`, members with role and phase, and tasks with
owner and blockers. It lands in the sidebar the harness already ships, so it appears wherever the
harness does.

**Fixed — the settings surface, on BOTH front doors.**

- The MPD section now RENDERS and READS. Harness 0.1.7-rc.2 replaced the namespace registry with the
  Cordis patch editor, so the knobs are declared as the `mpd-config` row's own `Config` with volatile
  flags, and both front doors address the ENTRY (`mpd-config`) rather than a namespace name. Measured:
  20000 / true / 6 / git / .mpd/team in the Web dialog and in the TUI.
- An edit actually REACHES the plugins: the row config is merged as the layer above the files, with
  the routing keys stripped.
- The repeated per-row disclosure is stated ONCE per surface, so eight rows fit where five did.
- The sidebar host mounts on a checkout install. `dsh-better-sidebar` was not resolvable from a
  `link:` profile, so the bundle contributed no sidebar GUI at all; the bundle now reaches its own copy
  through `mpd-better-sidebar-host`.
- The watchdog's three `agent/*` subscriptions and the bootstrap's `fs/observed` go through the
  adapter, and the D6 gate covers event NAMES.

**Fixed — the TUI edition.** A `dsh-tui` profile is now part of the Docker client test, which boots
the real TUI on a tmux PTY and reads the created session's preset from the harness's own store.

## v0.10.2 — TUI preset default, adapter event seams, TUI end-to-end lane

**Fixed.**

- **A `dsh-tui` profile defaulted every session to a preset its composition does not declare.** The
  harness moved preset selection to a registry row and this bundle targeted the web plane's
  `agent-preset-registry` — but `dsh-tui` mints its OWN scoped row (`dsh-tui-agent-preset-registry`,
  stock `default: standard`), and a TUI profile composes no `dsh-web-app` layer, so the web target is
  skipped there while nothing declares `standard`. A second id-target on the scoped TUI row restores
  user decision D10. The QA pin moves to `@deepseek-harness-tui/dsh-tui@0.11.1`, the first release
  whose peer ranges include `0.1.7-rc.2`.
- **Two harness-event subscriptions bypassed the adapter** — `mpd-team-watchdog-plugin`'s
  `agent/pre-step` / `agent/session-start` / `agent/turn-stopping` and `mpd-bootstrap-plugin`'s
  `fs/observed`, all on a raw ctx while neighbouring subscriptions already used `dsh.onEvent`. Both
  are rebased, and the D6 gate gained an event-name rule family so the class cannot return.
- A patch COMMENT that named `disabled: !!js` could displace the real scalar in
  `sidebar-guard-profile-dir.test.ts` and kill the run in `JSON.parse`; the finder now accepts only
  a candidate that really parses.

**Added.**

- The DSH-TUI edition is now exercised END TO END in the Docker client test
  (`docker/tui-lane.sh`): it installs the TUI host, installs this bundle into the `dsh-tui` profile as
  the third patch layer, boots the REAL TUI on a real tmux PTY, and reads the preset the created
  session ACTUALLY ran from the harness's own session store — `agentPreset: "mpd"`. 11 assertions,
  reported as `passed=42 failed=0 null=1` by the driver.

## v0.10.1 — session-start gate delivery, producer-owned message source

**Fixed.**

- **The session-start complexity gate was MOUNTED but NEVER FIRED.** Three root causes, each measured
  on a real boot: (a) `agent/pre-step` is dispatched through the AGENT's scope carrier and `dsh-scope`
  drops a listener registered on a row's ctx, so the handler was never invoked; (b) the harness splices
  its own user-role runtime-context turn onto the pre-step decision, so the gate judged that snapshot
  instead of the goal; (c) the injected notice used the retired `{kind:"plugin"}` message source, which
  harness 0.1.7's format-v4 gate REFUSES — the injection killed the boot. The gate now registers one
  listener per qualifying agent in that agent's own scope through a new adapter seam
  (`registerAgentPreStep`), reads the goal from the payload's raw claimed list, and names its own
  message producer. The frozen properties are unchanged: advisory only, the marker
  `[AgentTeams] Session-start team rule`, the predicate A/B/C/D, mpd-preset scope, settle once,
  contained failure.
- **`/ulw` used the same fatal message source.** A lane-wide grep prompted by the first fix found
  `mpd-ulw-plugin` emitting `{kind:"plugin"}` for its activation directive; it now uses a
  producer-owned kind, and the adapter's doc comment no longer teaches the retired spelling.

**Tests.**

- `skills/dsh-qa/scripts/session-start-team.ts` now splits its live verdict into named
  sub-assertions and asserts the boot's own session-store key plus the row's `sessionGate=advisory`
  report, so "the gate was never mounted" and "the gate is mounted and did not fire" are different
  readings with different owners. Its earlier green was partly vacuous on 3 of 6 sides; that is fixed,
  and it now passes with `simpleNotices [0,0,0]`, `softNotices [1,1]`, `explicitNotices [1]`, every
  triggered side staging nothing.
- A regression test drives the gate through the REAL adapter with the REAL payload shape — no `agent`
  field — which is the test whose absence let this ship.

## v0.10.0 — DeepSeek Harness 0.1.7-rc.2 adaptation, official Agent Teams, Docker client test

**Breaking changes (harness 0.1.7-rc.2).**

- **The preset model was replaced.** `@deepseek-ai/dsh-agent-presets` no longer exists: the deployment
  default now lives on `@deepseek-ai/dsh-agent-preset-registry`, and a preset is an ordinary plugin
  ROW (`@deepseek-ai/dsh-agent-preset`) whose `config.plugins` carries the child entry list inline.
  The `mpd` preset is therefore declared by `presets/mpd.patch.yml` (row `preset-mpd`), the bundle
  id-targets `agent-preset-registry` to `{ default: mpd }`, and the manifest's `dsh.bundle.patch`
  became an ARRAY of two patch files. The retired directory form
  (`presets/mpd/{preset.yml,agent.cordis.yml}`) is gone; `@deepseek-ai/dsh-workflow-worker-thread`
  went with it and the preset now declares `workflow-ptc`, matching the shipped `standard` preset.
- **Agent Teams became an official plugin set.** The bundle now mounts
  `@deepseek-ai/dsh-experimental-agent-team` (+ `-tool-agent-team`, `-client-ui-agent-team`) and the
  model-facing interface is `spawn_teammate` / `send_message` / `list_agents` / `wait_agent` /
  `interrupt_agent` / `team_task_*`. The vendored third-party body
  (`packages/mpd-agent-teams-plugin`, its `agent_teams_*` tools, its `.mpd/team` record and its Web
  activity panel) is RETIRED from the composition and kept in the tree for one release as a declared
  follow-up deletion.
- **Every agent-team interaction goes through `mpd-dsh-adapter`.** The adapter gained a team plane
  (`teamService` / `teamMembership` / `teamListMembers` / `teamListTasks` / `teamCreateTask` /
  `teamGetTask` / `teamUpdateTask` / `teamSendMessage` / `teamSpawnTeammate` / `teamInterrupt` /
  `teamWaitForChange` / `teamLiveTeams` / `registerSubagentProvider`), and a new gate
  (`packages/mpd-dsh-adapter-plugin/test/no-direct-team-access.test.ts`) fails on a direct
  `ctx.agentTeams` / `subagents.startContinuable` reference anywhere outside the adapter.

**Capability bound.** `TeamService.spawnTeammate` forwards only `{ prompt, parent }` to
`ctx.subagents.startContinuable`, so a teammate created by `spawn_teammate` inherits the Lead's model
route: per-teammate model routing is impossible on the official plugin. The `teamModels.slot*` settings
keep applying to the one-shot consult paths (`mpd_role_spawn`, `mpd_workmate_spawn`), which pass an
explicit route. The roster's mechanical read-only discipline is preserved by a tool guard, and the
session-start complexity gate is re-implemented on the official seams by `mpd-roles-plugin`.

**Added.**

- A Docker end-to-end client test: `docker/Dockerfile` (ubuntu:24.04) + `docker/docker-compose.yml` +
  `docker/entrypoint.sh`, driven by `node scripts/docker-e2e.ts`, which installs Node 24, bun and
  `@deepseek-ai/dsh@0.1.7-rc.2` into a clean Ubuntu 24.04 machine, runs the real
  `dsh plugin --profile web add .`, and asserts a mounting boot plus a `session/create` preset mount.
  See `docker/README.md` for what it proves and what it does not.
- `docs/plan-0.1.7-adaptation.md` — the adoption record: measured baseline, the harness changes, the
  decisions, the lanes, and the retired assertions.

**Fixed.**

- `mpd-bootstrap-plugin`'s legacy home-copy cleanup recognised only the retired directory spelling of
  a bundle preset, so a stamped `$DSH_HOME/.agent-presets/mpd` copy survived a boot that was supposed
  to remove it. Both spellings are now recognised.
- `buildToolchain` is recorded as the bun actually used (`bun@1.4.0`) and every committed `dist/` was
  rebuilt from the canonical repo-root command, so `verify-dist-fresh` is green again.

## Earlier releases

Untagged history for 0.1.x … 0.9.1 lives in the git log and in the process records under `docs/`.
