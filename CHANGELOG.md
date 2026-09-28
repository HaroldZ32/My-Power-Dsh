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
