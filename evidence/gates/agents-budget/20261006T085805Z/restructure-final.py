#!/usr/bin/env python3
"""Instruction-budget restructure of AGENTS.md (2026-10-06).

METHOD (so the move is auditable, not asserted):
  * every moved body is extracted VERBATIM from AGENTS.md by line range and appended to its
    `agent-references/<topic>.md` destination under a provenance header;
  * the destination file is then asserted to CONTAIN the moved block byte-for-byte (sha256 recorded),
    so "no text was deleted" is a measurement, not a claim;
  * AGENTS.md keeps every `## N. <Title>` heading, in order and with unchanged numbers, and each
    anchor keeps the binding rules its `§N` citations lean on (the compact text below). The compact
    text is deliberately TERSE: it names the rule and points at the reference file for the detail.

Run from the repo root:  python3 evidence/gates/agents-budget/<ts>/restructure.py
"""
from __future__ import annotations

import hashlib
import pathlib
import sys

ROOT = pathlib.Path("/home/haroldzhao/MyProj/DshProj/My-Power-Dsh")
MANUAL = ROOT / "AGENTS.md"
TS = "20261006T085805Z"
EVID_REL = f"evidence/gates/agents-budget/{TS}"

PROVENANCE = (
    "Provenance: moved from `AGENTS.md` {title} on 2026-10-06 by the instruction-budget split (the\n"
    "manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already\n"
    "over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are\n"
    "recorded in `" + EVID_REL + "/result.json`. `AGENTS.md` {short} carries the BINDING rules and points\n"
    "here for the full body; where the two differ, the manual wins.\n"
)

HEADER = """# {title}

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

{provenance}
## The former {short} body (verbatim)

"""


def sha256(text: str) -> str:
    """Hex sha256 of one UTF-8 string, so a moved block can be compared across files."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def block(lines: list[str], start: int, end: int) -> str:
    """Extract an inclusive 1-based line range as text, asserting the range is inside the file."""
    assert 1 <= start <= end <= len(lines), f"bad range {start}-{end} for {len(lines)} lines"
    return "".join(lines[start - 1:end])


S1_NEW = """## 1. Overview & Provenance

**my-power-dsh** is a DeepSeek Harness (DSH) plugin bundle. **From upstream**: the roster, the
model-chain vocabulary and the roster's stable ids, plus a pinned capability baseline —
`code-yeongyu/oh-my-openagent` (base commit `8c57e46`, v5.0.0-beta.20, recorded in `VENDOR_LOCK.json`,
never chased per §9) whose 11 specialists ship as adapted teammate templates and workmate BASE
templates. **Ours**: the DSH plumbing, the plugin set, the `mpd` preset and the QA suite. Upstream spec
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
- **The vendored `agent-teams` body is RETIRED from the composition (2026-09-27)**: retained at
  `packages/mpd-agent-teams-plugin` but mounted by NO loader row, so its `agent_teams_*` tools and its
  `<workspace>/.mpd/team` record are NOT part of a shipped session — harness 0.1.7-rc.2's official Agent
  Teams plugin replaced it. Deleting the code is a declared follow-up (the D6 gate and §6's counted
  residual still cover it), not an oversight.
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

"""

S4_NEW = """## 4. Gates (binding)

| Gate | Command | When |
|---|---|---|
| Vendor | `node scripts/verify-vendor.ts`; the corpus re-pin is DERIVED — `node scripts/repin-vendor.ts` (dry-run by default, `--check` asserts, `--write` applies; it REFUSES the repository's own `VENDOR_LOCK.json` without `--i-know-this-is-the-captains-step`, so a wave cannot re-pin mid-flight) — and lands in the commit that invalidated the `treeSha` (§9/§11) | any baseline/asset change; before release |
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

"""

S6_NEW = """## 6. Plugin Authoring Guide

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
  `no-direct-tui-access` and `no-terminal-writes`. Full contract, the fourteen seams and the declared
  WEB-plane residual: `agent-references/seam-adapters.md`. **ONE DSH-TUI contact is NOT a seam, is
  COUNTED, and lives in that same adapter (2026-10-05)**: the host's `dashboard` (`Ctrl+A`) `useStdin`,
  reached by dynamic-importing `<root>/lib/types/ui.js` by file URL. Route any future host-internals
  need through this same adapter — never a second contact site.
- **A patch row NEVER id-targets a host-owned row — binding** (`node scripts/verify-no-host-override.ts`,
  §4). The deployment default preset is the USER's to choose, not the bundle's: `docs/preset-default.md`
  and `node scripts/set-default-preset.ts`.
- **The adopted-plugin exception is CLOSED (2026-09-19), and its residuals stay NAMED.** Its SIX bridged
  files route through the facade `lib/mpd-adapter-ctx.ts` (an mpd-OWNED module, healed byte-faithfully
  from the registry). **One bypass is COUNTED, never routed:** the ctx the HOST hands
  `setup(childCtx, child)` stays DIRECT on its **5 counted lines** in `lib/members.ts`, pinned by
  `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.ts` (plus the two `whenIdle`
  Class-B sites), so a NEW use reddens instead of hiding. **Five further residuals stay NAMED**: (R1)
  adapter-mediated registrations belong to the ADAPTER row's fiber — a plugin-only unload would not
  revoke them (T-21); (R2) the retired-member delivery guard still PATCHES `subagentRuntime()`'s object
  (delivery in the plugin, RESOLUTION in the adapter); (R3) `lib/client.js` is OUT OF SCOPE, guarded by
  `scripts/patch-agent-teams-client.ts`; (R4) `liveAgent`/`liveAgents`/`onEvent` swallow-and-degrade,
  deliberately; (R5) the count sentence in `agent-references/agent-teams-deltas.md` keeps its exact
  wording (the docs gate's regex is FIXED) while only its numbers move. Detail:
  `agent-references/plugin-authoring.md`.
- **The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`** (on demand, not
  injected): the A1–D42 table, the registry mechanics, the region count and the wave-2 driver-script
  warning. Two rules bind: (a) the registry is **derived** — regenerate with `--write-registry`, never
  hand-edit an entry; (b) the **REPLACEMENT-shaped** deltas (D13/D14/D21/D22) do **not** self-heal after a
  human re-materialize — the applier REFUSES loudly, file byte-untouched. Everything else — including
  every future mpd plugin — goes through the adapter.
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
  is flagged STALE even though it looks sanctioned. Zero runtime deps preferred (type-only imports).
  **An ADAPTER edit fans out**: `bun build` INLINES every imported module, so touching
  `packages/{mpd-dsh,mpd-tui}-adapter-plugin/src` changes the emitted bytes of every package that
  imports it (measured: one adapter edit left 12 of 24 dist targets STALE). Rebuild each dependent with
  the pinned toolchain — see `agent-references/seam-adapters.md`.
- **Load/test**: a bundle row lives in the bundle, never ALSO in a QA overlay while it is already in the
  bundle — the loader rejects duplicate entry ids. QA boots a checkout through the dev-flavor rewrite
  (`devPatch()` in `skills/dsh-qa/scripts/preset-register.ts`).
- **Docstrings/comments**: English only.

"""

S7_NEW = """## 7. QA Discipline (mirrors upstream, adapted)

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

"""

S8_NEW = """## 8. Installer & Profiles

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

"""

S13_NEW = """## 13. Glossary

**The full glossary — every term with its long form, plus the 0.1.7 preset-form change — is in
`agent-references/glossary.md`.** The three definitions this section is CITED for (roster, team-model
slot, workmate) stay here.

- **roster**: the specialist roster served by `mpd-roles-plugin` (`mpd_roles_list` / `mpd_role_spawn` /
  `mpd_role_persona`) as teammate instantiation templates for the OFFICIAL Agent Teams plugin
  (`spawn_teammate`, whose persona the captain takes from `mpd_role_persona`). The eleven members are
  addressed by NAME — Architect, Researcher, Planner, Deep Worker, Senior Engineer, Lead, Explorer,
  Reviewer, Plan Reviewer, Vision Analyst, Junior Engineer. The stable `id` (chain key,
  `personas/<id>.md`, workmate `meta.baseId`) is INTERNAL: accepted for compatibility, exposed by NO
  tool output, description, render, web route or GUI. The **read-only discipline is the exported deny
  list** — exactly seven names, identical in `mpd-roles-plugin` and `mpd-workmate-plugin` (asserted
  equal by `roles.test.ts`): `write`, `edit`, `mpd_hashline_edit`, `bash`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`, `mcp__lsp__rename`. `bash` is denied on purpose (a shell can write files);
  `read`/`glob`/`grep` stay available. Enforced TWO ways that must keep agreeing:
  the one-shot path passes it as `toolFilter.deny` to `mpd_role_spawn`, and a tool GUARD denies the same
  seven names for a live Team teammate whose name normalises to a read-only roster member (the official
  `spawn_teammate` accepts no per-teammate tool filter). **Do NOT re-add `str_replace_editor` /
  `apply_patch`, and do not filter the list with `dsh.hasTool`**: the harness validates the WHOLE list at
  spawn time, so one dead entry breaks every read-only spawn. Detail: `agent-references/glossary.md`.
- **team-model slot**: one of the four configurable default model routes of the ROSTER members —
  `teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` in `mpd.jsonc` / the `mpd` settings
  namespace, whose defaults are `deepseek-official` / `deepseek-v4-flash` at `max`/`high`/`high`, plus
  `deepseek-official` / `deepseek-v4-flash-vision-exp` at `high` for slot 4. Slot 1 routes
  Architect/Planner/Reviewer/Lead/Senior Engineer, slot 2 Researcher/Explorer/Plan Reviewer, slot 3 Deep
  Worker/Junior Engineer, slot 4 Vision Analyst (the vision member; the model here MUST accept image
  input). A slot that cannot be resolved — a missing service, a missing or incomplete slot, an unknown
  model, an unsupported effort — fails the corresponding spawn LOUDLY naming the member and the slot,
  writes no state, and NEVER clamps an effort. **Team teammates ARE routed (2026-09-27), through
  `mpd-roster-provider-plugin`'s `mpd-roster` provider, wired into the `mpd-tool-agent-team` row as
  `config.freshProvider`** — the slot applies to the ONE-SHOT paths (`mpd_role_spawn`,
  `mpd_workmate_spawn`) AND to an official `spawn_teammate`. IDENTITY is the one thing the team service
  does not forward, so the routing rule is: **a teammate `description` that NAMES a roster member routes
  that member; one that does not inherits the Lead's route.**
- **workmate**: a durable, evolving agent instance in `~/.mpd/workmate/` created by `mpd-workmate-plugin`
  (`mpd_workmate_*`) from a roster BASE template with an independent name; it self-summarizes after each
  work (persona + independent memory, size-capped) and keeps a short note card. Reuse is via
  `mpd_workmate_match`; weak matches must NOT be forced — initialize a new workmate instead. The tool
  surface is `mpd_workmate_list` / `mpd_workmate_init` / `mpd_workmate_spawn` / `mpd_workmate_reflect` /
  `mpd_workmate_match` / `mpd_workmate_rename` / `mpd_workmate_delete`. **The directory name IS the
  instance key** (`meta.name` is only a display mirror). `delete` is archive-first (no in-product
  restore; permanent only with `purge: true` + `confirm === name`); both mutations are refused while the
  workmate is in use, and names are ASCII-only `[a-z0-9_-]`. A base is addressed by its functional NAME
  only, an auto-generated name derives from it (`Deep Worker` → `deep-worker-1`), and `baseId` is
  internal provenance in `meta.json` that no tool output, web route or GUI ever exposes.
"""


def main() -> int:
    """Apply every move + every in-place edit, then print the measurement summary."""
    original = MANUAL.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)
    before_bytes = len(original.encode("utf-8"))

    # (destination, title, anchor-label, provenance-title, (start,end) of the moved block, replacement)
    sections: list[tuple[str, str, str, str, tuple[int, int], str]] = [
        ("agent-references/overview-and-provenance.md",
         "Overview & provenance (the full former §1 body)",
         "§1", '§1 ("Overview & Provenance")', (61, 161), S1_NEW),
        ("APPEND:agent-references/verification-flow.md",
         "The former §4 body (verbatim): the full gate table with every per-row measurement",
         "§4", '§4 ("Gates (binding)")', (246, 289), S4_NEW),
        ("agent-references/plugin-authoring.md",
         "Plugin authoring (the full former §6 body)",
         "§6", '§6 ("Plugin Authoring Guide")', (337, 491), S6_NEW),
        ("agent-references/qa-discipline.md",
         "QA discipline (the full former §7 body)",
         "§7", '§7 ("QA Discipline (mirrors upstream, adapted)")', (494, 565), S7_NEW),
        ("agent-references/installer-and-profiles.md",
         "Installer & profiles (the full former §8 body)",
         "§8", '§8 ("Installer & Profiles")', (568, 640), S8_NEW),
        ("agent-references/glossary.md",
         "Glossary (the full former §13 body)",
         "§13", '§13 ("Glossary")', (729, 798), S13_NEW),
    ]

    written: list[dict[str, object]] = []
    for dest_rel, title, short, prov_title, (start, end), _ in sections:
        moved = block(lines, start, end)
        append = dest_rel.startswith("APPEND:")
        target = dest_rel.split(":", 1)[1] if append else dest_rel
        header = (
            f"\n---\n\n## {title}\n\n"
            + PROVENANCE.format(title=prov_title, short=short)
            + "\n"
            if append
            else HEADER.format(
                title=title,
                short=short,
                provenance=PROVENANCE.format(title=prov_title, short=short),
            )
        )
        dest = ROOT / target
        if not append and dest.exists():
            raise SystemExit(f"refusing to overwrite existing reference file: {target}")
        prior = dest.read_text(encoding="utf-8") if append else ""
        dest.write_text(prior + header + moved, encoding="utf-8")
        confirmed = dest.read_text(encoding="utf-8")
        assert moved in confirmed, f"verbatim preservation FAILED for {target}"
        written.append({
            "path": target,
            "mode": "appended" if append else "created",
            "file_bytes_after": len(confirmed.encode("utf-8")),
            "moved_source_lines": f"{start}-{end}",
            "moved_bytes": len(moved.encode("utf-8")),
            "moved_lines": moved.count("\n"),
            "moved_sha256": sha256(moved),
            "moved_verbatim_in_destination": True,
        })

    # Rebuild AGENTS.md from the END so earlier line numbers stay valid.
    out = original
    for _, _, _, _, (start, end), replacement in sorted(sections, key=lambda s: s[4][0], reverse=True):
        moved = block(lines, start, end)
        assert out.count(moved) == 1, f"block {start}-{end} is not unique in AGENTS.md"
        out = out.replace(moved, replacement)

    # ── TASK 1: the branch + PR policy (EXACT text supplied by the Lead) ────────────────────────
    pr_bullet = (
        "- **Every change lands through a BRANCH + a PULL REQUEST — binding (user-set, 2026-10-06).** Nothing is\n"
        "  committed straight to `dev` or `master`: cut a `feature/<slug>` or `fix/<slug>` branch, commit the wave\n"
        "  there, push it, and open a PR against `dev`. **A PR DESCRIPTION IS BILINGUAL**: it carries BOTH an\n"
        "  English body and a 简体中文 body, English first, as two sections of ONE description (`## English` then\n"
        "  `## 简体中文`) — the same pair discipline the human-facing docs follow, applied to the review surface.\n"
        "  A single-language PR description is not ready for review. Every PR body states, in both languages:\n"
        "  what changed, the measured evidence (paths under `evidence/`), the gates run WITH their observed\n"
        "  results, and the honest bounds — never a claim the evidence does not carry.\n"
    )
    lang_bullet = (
        "- **The PULL REQUEST description is human-facing**: it follows the same bilingual rule (EN + 简体中文 in\n"
        "  ONE description, English first). See §5.\n"
    )
    anchors = (
        ("§5 one-git-writer bullet",
         "  stay open to all. Tag `backup/<branch>-<sha>` before any history-writing step.\n", pr_bullet),
        ("Language policy bilingual-docs bullet",
         "  A change to one updates BOTH in the same commit.\n", lang_bullet),
    )
    for name, anchor, insert in anchors:
        assert out.count(anchor) == 1, f"anchor not unique: {name}"
        out = out.replace(anchor, anchor + insert)

    # ── Reference Index rows for the new files ──────────────────────────────────────────────────
    index_rows = (
        "| `agent-references/overview-and-provenance.md` | the full §1 body: what the bundle carries from upstream, the adopted-then-retired agent-teams body, the declared-dependency mount mechanism, the ULW/GOAL detail and the session-start gate's softer signals | you need the provenance or the composition history behind §1 before restating it |\n"
        "| `agent-references/plugin-authoring.md` | the full §6 body: the two adapter surfaces in detail, the counted host-setup bypass and the R1–R5 residuals, the delta-registry mechanics, the tool/guard/waterfall/subagent API signatures and the state-resolution rules | you author or debug a plugin row, touch a seam, or need an exact adapter signature |\n"
        "| `agent-references/qa-discipline.md` | the full §7 body: the triple-isolation rationale, the live-case session-log decode trap, the durable-anchor (T-90) calibration bound and the preset/row conformance failure modes | you set up a QA lane, read a session store, or a conformance case reddens without a cause |\n"
        "| `agent-references/installer-and-profiles.md` | the full §8 body: the one-command install in detail, the build-script-free dependency closure, the packed-artifact layout and the legacy `install-profile.ts` flow | you change `files`/`dsh.*`, a patch row or an install path |\n"
        "| `agent-references/glossary.md` | the full §13 body: every glossary term (DSH, bundle, patch layer, preset and the 0.1.7 preset-form change, mpd, golden) plus the long forms of the roster/workmate/slot definitions | a term's long form or history is needed |\n"
    )
    anchor_row = "| `agent-references/seam-adapters.md`"
    row_end = out.index("\n", out.index("|\n", out.index(anchor_row))) + 1
    out = out[:row_end] + index_rows + out[row_end:]

    # The existing verification-flow row now also carries the former §4 body.
    old_flow_row = ("| `agent-references/verification-flow.md` | the ordered verification flow behind §4/§11: "
                    "what each gate is worth, why the Docker lane is the LAST step, and the measured rootless "
                    "/ skip / `--require-docker` policy |")
    new_flow_row = ("| `agent-references/verification-flow.md` | the ordered verification flow behind §4/§11 — "
                    "AND the former §4 body verbatim (the full gate table with every per-row measurement): what "
                    "each gate is worth, why the Docker lane is the LAST step, and the measured rootless / skip "
                    "/ `--require-docker` policy |")
    assert out.count(old_flow_row) == 1, "verification-flow index row not found"
    out = out.replace(old_flow_row, new_flow_row)

    MANUAL.write_text(out, encoding="utf-8")
    after_bytes = len(out.encode("utf-8"))

    print(f"before_bytes={before_bytes} after_bytes={after_bytes} delta={after_bytes - before_bytes}")
    for row in written:
        print(f"  {row['path']} [{row['mode']}]: moved {row['moved_bytes']} B "
              f"(lines {row['moved_source_lines']}) -> file now {row['file_bytes_after']} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
