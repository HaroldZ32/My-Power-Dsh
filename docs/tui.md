# DSH-TUI edition

**English** | [中文](./tui.zh-CN.md)

This page describes the **DSH-TUI edition** of the my-power-dsh bundle: what it ships, how to
install it, what the per-package compatibility measurement found, and what it explicitly does
**not** claim. It targets `@deepseek-harness-tui/dsh-tui` **0.13.0** and its built-in admission
profile. 0.13.0 is the release that **adds the sidebar panel seam** — host row `dsh-tui-panels`,
export `@deepseek-harness-tui/dsh-tui/panels` — and that renames the host's own `dsh-ecosystem-spec/`
directory to `tui-profile/`; this edition adopted the new seam as its **fifteenth** `tui*` seam
(§3, §3.3). **The pin before it was 0.12.0, and that statement stays readable as history**: 0.12.0 is
the dsh-tui release whose peer ranges cover the whole band this bundle's pinned harness sits in — its
lists run through `0.1.7-rc.2`, `0.2.0-rc.1` and `0.2.0-rc.2`, where 0.11.2 stopped at `0.2.0-rc.1`
(0.10.1 and 0.10.2 stop at `0.1.5-rc.1`), so it was the first pin that could boot against the harness
this bundle targets; 0.13.0's own `peerDependencies` still end at `0.2.0-rc.2` (read from the
installed package). **The move touched every carrier in one wave**: the global package and the
`dsh-tui` profile, the distribution descriptor's `host-tui` ref (`dsh-distribution.json` now carries
`pkg:npm/@deepseek-harness-tui/dsh-tui@0.13.0`), and the QA host spec (`docker/tui-lane.sh`,
`docker/entrypoint.sh`, `skills/dsh-qa/scripts/tui-mount.ts`'s `TUI_HOST_SPEC` and
`skills/dsh-qa/scripts/install-dependencies.ts`'s remedy all default to `0.13.0`). The compatibility
work below was measured on 0.10.1 and is re-verified in the Docker end-to-end test
(`docker/tui-lane.sh`), which is the only place the TUI profile can be exercised end to end.

> **Read this first.** This repository has **not** published a conformance claim. The claim
> artifact of that ecosystem (`schemas/conformance-claim.schema.json`, `claimVersion` `"0.15"`,
> `specVersion` `"community-v0.15"`, an `evidenceLevel` of Declared/Parsed/Negotiated/Tested/
> Observed/Attested) is a separate, deliberate step that this edition does not take. Every
> statement below names the evidence level that actually backs it, and lane results that were
> still pending when this page was written are called **pending**, not "verified".

## 1. What the TUI edition is

| Artifact | Path | What it is |
|---|---|---|
| TUI surface package | `packages/mpd-tui-plugin/` | The TUI-native surfaces: the **sidebar team panel** (`src/panel.ts` — the primary entry point for the merged view on 0.13.0, §3.3), status line, `/settings` section, full-screen board scene, `/mpd` command tree, keyboard shortcuts, mediated dialogs, a transcript-renderer **registration the host does not project** (NOT-CLAIMED #10), and the decision-event seam built ready-but-not-activated. |
| Admission manifest | `dsh-plugin.json` (repo root) | ONE bundle-level Community v0.15 manifest for the whole bundle — a deliberate deviation (see §7). |
| Environment descriptor | `dsh-distribution.json` (repo root) | A `DistributionDescriptor` for the dsh-distribution meta-protocol (Draft). |
| TUI composition | `cordis.patch.yml` | Adds the `mpd-tui` row and the `dsh-tui` roster default so a TUI session starts on the **mpd** preset. |
| These docs | `docs/tui.md`, `docs/tui.zh-CN.md` | Human-facing description of the above. |

The web edition is untouched: the same bundle still installs into a web profile.

## 2. Install

```sh
dsh plugin --profile dsh-tui add /path/to/my-power-dsh
```

That single command is the whole install (plugin code, manifest, skills, MCP rows). There is no
per-package `dsh plugin add`, and the TUI package deliberately ships no `cordis.patch.yml` — a
second mount would duplicate a loader entry id, which the loader rejects outright.

Measured composition after that install (t5, `evidence/tui/composition/20260915T053445Z/`):
`dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-harness-tui/dsh-tui", "@mpd-dsh/mpd"]`
— this bundle is the **third** patch layer; the bundle patch contributes 24 rows; the live boot
logged **0** apply-crash signatures (`unsupported JSON schema`, `JsonSchemaError`, `plugin tree
failed to load`, `failed to apply loader entry`, `Error:`); no duplicate loader entry id.
**Backed at:** `Observed` (a recorded live dsh-TUI boot plus the host's own `--dump-config`).
`--dump-config` alone proves composition only — the crash-signature count comes from the live boot.

A TUI session defaults to the **mpd** preset, carried by the id-targeted `agent-preset-registry` row
(`default: mpd`) together with the `preset-mpd` row in `presets/mpd.patch.yml` (measured from a
captured session record, not from the patch text).

Requirement for any live lane: `dsh-tui` refuses to boot when stdout is not a TTY
(`dsh-tui requires an interactive terminal (stdout must be a TTY)`), so the QA lanes must drive the
real TUI inside tmux and capture panes; this boundary is why the TUI lanes are **not** part of
`bun run test:qa`'s self-test sweep.

## 3. TUI surfaces and their web counterparts

The bundle's former web-only faces have TUI **equivalents**, not parity:

| Web surface | TUI equivalent | Backed at |
|---|---|---|
| Agent Teams panel (conversation header) | the **`tuiPanels` sidebar panel** — the primary entry point on 0.13.0 (§3.3) — with the `tuiScenes` full-screen board as its FALLBACK, plus the `tuiStatus` keyed status line | registration + a host-ACCEPTED open measured on 0.13.0 — `evidence/tui/lanes/2026-10-06T10-27-53.571Z/` and `…/2026-10-06T10-28-57.807Z/`, where the id discovered from the host's own read-back is `act1:team`; the full-screen scene rendered in the 0.10.1-era live lane `evidence/tui/live/20260915T063140Z/result.json` (t8; 6 of 7 surfaces) |
| Workmate library tab | `tuiCommandTrees` (`/mpd …`) + `tuiDialogs` | same lane evidence |
| — | `tuiStatus` status line; the `tuiRenderers` transcript row is **not projected by the host** | status line rendered; renderer row **does not render** — see NOT-CLAIMED #10 |
| — | `tuiSettingsSections` (`/settings` section for the mpd.jsonc knobs) | rendered — same lane evidence; the section states the **bridge** to `<workspace>/.mpd/mpd.jsonc`, its restart caveat and the never-lost clause (§6.2), and the lane asserts that disclosure text (`allPatterns`) |
| — | `tuiShortcuts` | rendered — same lane evidence |
| Team workflow (roster with member phases, shared task board) | `mpd-tui-team` scene — `/mpd team` | the scene is registered by the TUI command tree (`packages/mpd-tui-plugin/src/command-trees.ts`); the surface contract and the evidence level of every row are in the parity ledger `docs/tui-parity.md` (§3.2 below for the openers) |
| — | `mpd-tui-plan` scene — `/mpd plan` | a TUI scene; the staged-plan APPROVAL semantics it was built around belonged to the retired vendored plugin and no longer exist (§3.2) |

Thirteen seams were in scope. Eight are built by this wave (settings sections, scenes, dialogs,
status, shortcuts, the renderer **registration**, the decision-event attempt, and the composition
row); five were already carried by the existing bundle (session events, skill packaging, theme
asset, system-prompt section, profile composition); **one (`tuiPrompt`) is host-unavailable and is
not claimed at all**; and **one (`tuiRenderers`) registers while the host projects no transcript
row, so its transcript line is not claimed either** — the same explicit treatment as `tuiPrompt`,
recorded as NOT-CLAIMED #10.

**The seam inventory is FIFTEEN `tui*` seams since 0.13.0, and `tuiPanels` is the one that is new.**
The adapter's single-source table (`TUI_SEAMS` in `packages/mpd-tui-adapter-plugin/src/index.ts`) now
carries the fourteen seams dsh-tui has exposed since 0.12.0 plus the sidebar panel registry 0.13.0
added — the count moved 14 → 15 in this wave — each bound, probed and degraded by the same discipline:
ONE deferred `ctx.inject([id], …)` per seam, `ctx.get(id, false)` as the probe, and a seam that never
binds reported `absent` instead of failing the boot. The "thirteen" paragraph above is the record of
the first wave's scope and stays as written.

### 3.1 The Web GUI settings UI (Settings → MPD)

The same 25 knobs — the original 13 plus the twelve `teamModels` slot leaves, the latter rendered as
dependent model + effort pickers — are editable in the Web GUI: **Settings → MPD**, its own top-level section of
the settings dialog — it no longer lives inside the Plugins tab. The section registers the way the
host's own sections do (`ctx.slots.inject("settings.section", …)` →
`ctx.slots.register({ name: "settings.section", id: "mpd", order: 20, label: () => t("nav"), locale, inject }, Section)`,
the shape measured from `dsh-client-ui-settings-models/lib/client.js:2936`): the settings shell
collects that list slot, sorts it by `order` and renders the active one, so `order: 20` places MPD
after `general` (0), `models` (10) and `plugins` (15) and moves no existing section. The section
renders the card as-is, declares no nested `children`, and a namespace with no registration renders
nothing — which is why the knobs were invisible before. Writes use the public
`ctx.settingsScope.bind({ namespace: 'mpd' }).mutate(ops, revision)` seam (nested paths; `unset` for
reset), and a non-writable scope renders read-only with the reason and never attempts a write. The
card's fields, labels and zh descriptions are asserted against the TUI section's descriptor by its own
test, so the two front doors cannot drift.

**Evidence level — witnessed:** the registration contract in the **built and served** client bytes
(`packages/mpd-bundle-plugin/client.js`; the lane re-hashes the artifact it judged and the evidence
records the size + sha256 before and after this move), the section's descriptor — id, order, label,
locale, no `children` — recorded by the **offline hook harness** when the registration is CALLED, the
card's field parity with the TUI descriptor in its own test suite, the module's behaviour — render,
scope write with the right path/value/revision, refusal of an invalid draft, and read-only rendering
with its reason — in the same harness, and the **write path end to end** through the host's own
authenticated settings API (`web-settings-bridge.ts` W1–W13).

**Evidence level — NOT witnessed here:** a **real browser render** (the host dispatching this key in a
live page) and a **click-driven save**. No browser binary exists in this environment; the lane records
`cardClaim.W3.witnessed === false` with the reason, and this page repeats that instead of implying
otherwise. To see it yourself: start `dsh web`, open the GUI, go to **Settings → MPD**, expect the
`mpd` section with the 25 knobs (the twelve team-model slots offer catalog-derived selections), change
one and Save — with exactly one live
session the workspace's `<workspace>/.mpd/mpd.jsonc` changes with comments intact; otherwise the bridge
refuses loudly (`no-live-session` / `ambiguous-multi-root`) and states that the value is not lost.

### 3.2 The team-workflow and plan surfaces (wave `tui-team-surface`)

The TUI command tree exposes `/mpd team`, `/mpd plan` and — since the 0.13.0 adaptation — `/mpd panel`
(`packages/mpd-tui-plugin/src/command-trees.ts` is the action list: `board`, `team`, `plan`,
`subagents`, `panel`, `workmates`, `status`), alongside the keyed status line and the board scene.

**The approval gate is BACK on the mpd plan plane, and this section states it plainly.** The first
implementation called the now-RETIRED vendored `agent-teams` tools (`agent_teams_approve`,
`agent_teams_delete`) against a durable `.mpd/team/team.json`, and the official Agent Teams plugin this
bundle mounts has **no staged plan and no approval step** — the Lead spawns a teammate with
`spawn_teammate` and opens its lane with `team_task_create`, and the shared board is the plan (see
`docs/user-guide.md` §6 and `docs/plan-0.1.7-adaptation.md` §3). But the staged plan itself is NOT
gone: THIS bundle owns it (`mpd-team-core`'s `agent_teams_plan`, kept under
`<workspace>/.mpd/team/`), and since W6 the TUI plan scene carries the approval gate again. Open it
with `/mpd plan`, type the EXACT phrase the pane serves (`approve plan-…`, from the same projection
the Web panel renders), press `Ctrl+X`; `Ctrl+D` twice within 10 s discards the staged plan, `Ctrl+R`
re-reads and `esc` goes back. The action is an `agent_teams_plan {action:"approve"|"delete"}` call, so
approval materialises the mpd record and raises its members through the NATIVE executor — no official
service needed. The caller rides the call by IDENTITY, resolved from the adapter's own live registry
(`liveAgent(sessionId)`, else a live entry whose own `session.id` matches, else the ONE live agent
when the scene carries no id); when none of those names a caller the pane REFUSES and calls nothing:
`session "<id>" is not live in this process — no live agent to speak as, so nothing was called`. NOT
claimed: that every host and every session resolves — the live hop on a real TUI host is not yet
falsified by the wave.

What is still true of the TUI package in this area: the package contains **no write primitive** —
every team mutation is a tool call it makes through the adapter, and `/mpd plan` is the one surface
that offers one, behind five barriers (a separate surface, the typed exact phrase, an echo that starts
empty, chord-only mutations, and single-flight with a re-read). `/mpd team` is the guaranteed entry
point to the team scene, and `alt+t` is a
best-effort shortcut to it. The limits the `tui-team-surface` wave recorded (the dependency-residual
limit and one unlocatable contract row label) stay OPEN in `docs/tui-parity.md` §4–§5 — read that
page before quoting a status from this one.

**The official Agent Teams plane cannot activate under the TUI host, so this bundle does not mount it
there (measured 2026-09-29, harness 0.2.0-rc.1 + `dsh-tui` 0.11.2; `docs/tui.md` §10 item 11). THE MPD
TEAM NO LONGER DEPENDS ON IT: since the team-plane split (W2) the team is its own record plus a NATIVE
executor over `ctx.subagents`, so a TUI session stages, dispatches and renders its team without the
official service ever mounting — §10 item 11 carries the boot line that states it.**
`@deepseek-ai/dsh-experimental-agent-team` registers its session projection through
`ctx.root.sessionProjections.register(...)`, and Cordis binds a service call to the CALLER's context,
so that `register()` runs on the composition's **root** context and creates its effect on the ROOT
fiber. The dsh-tui host refuses exactly that capability from a plugin activation
(`root.effect is unavailable from a plugin activation`,
`lib/types/dsh-adapter/host-access.js`; its `host-access.d.ts` states the reason — a root-bound effect
would outlive the plugin that asked for it), so `TeamService`'s constructor throws, the `agentTeams`
service never activates, and the tool row that injects it reports
`pending (waiting for service: agentTeams)` for the rest of the run. Nothing this bundle can set
changes that: the plugin's `Config` carries no projection toggle, the call is unconditional, and it
throws before any registration could be deduplicated — no config value, mount order or isolation
realm reaches it. The bundle patch therefore **disables the two rows that exist only to serve that
service** — `mpd-agent-team` and `mpd-tool-agent-team` — in any composition that mounts the dsh-tui
host, with one warning line naming the reason; the Web/headless plane is untouched (the guard reads
the composed entries and returns false when no dsh-tui host row is present, so the team plane there
is exactly what it was).

What a TUI session still has: the `/mpd team` scene, the `/mpd plan` scene and the status line render
from the team state they can read — with no Team service the OFFICIAL readout is empty and the status
line reads `team -`. The mpd team WORKFLOW rows stay mounted on purpose, because they are not the
official service: the file-backed actions of `agent_teams_plan` / `agent_teams_task` /
`agent_teams_mail` / `agent_teams_control` (`<workspace>/.mpd/team/`) keep working, and
`agent_teams_plan`'s own `approve` / `delete` ride the mpd record's NATIVE executor over
`ctx.subagents` rather than the official service. What the official service would still carry — its
own live readout, wait-for-change and teammate messaging — fails with the adapter naming the service it
could not resolve. A TUI session cannot spawn a teammate today through the official plane — that is the
limit, not a configuration mistake.

### 3.3 The sidebar panel seam — the primary entry point on 0.13.0, and its honest bound

`packages/mpd-tui-plugin/src/panel.ts` registers **ONE** right-sidebar panel through the new
`ctx.tuiPanels` seam, whose body is the **merged** view: the host's own curated subagent snapshot rows
first, then the MPD dependency DAG for the current workspace's team, drawn by the same projections the
full-screen merged scene uses. The descriptor is frozen: slug `team`, title `MPD`, `minColumns` 32,
`order` 10, and **no `compact`** — 0.13.0 validates and stores a descriptor's `compact` slot but does
not mount its render slot, so declaring one would claim a surface that cannot render. The final panel
id is **discovered from the host's own `list()` read-back**, never composed — measured `act1:team`,
the slug prefixed by the host with this activation's plugin id.

`alt+a` and the new **`/mpd panel`** subcommand both route through `tuiPanels.open()` while the seam is
bound. On **any** refusal — the one-open-per-plugin-per-5000 ms rate limit, an id the host no longer
owns, or no live panel consumer — they **fall back to the existing full-screen merged scene**
(`mpd-tui-subagents`) and the printed line names the surface actually reached; nothing on that path is
a silent no-op.

**Backed at `Observed`:** the registration, the id discovered from the host's read-back and the
host-ACCEPTED open, recorded by the 0.13.0 real-PTY lanes
(`evidence/tui/lanes/2026-10-06T10-27-53.571Z/` and `…/2026-10-06T10-28-57.807Z/`), each with its own
negative control red as required.

**BOUND — the panel BODY is not observable in a tmux pane capture on this host.** Measured: after
`/mpd panel` reported a host-ACCEPTED open, the 320×50 capture was **byte-identical** to the capture
taken immediately before it, and `alt+a` changed nothing at all. The lane therefore proves
**registration + `open()` + the discovered id, NOT a render** — the panel bar and the body are not
claimed — and the merge itself is asserted by the unit suites (`panel.test.ts` 16/0,
`subagent-scene.test.ts` 23/0 and `graph.test.ts` 25/0 on this revision), never by a capture. Every run
records this as `panelBodyBound`.

## 4. Admission and distribution artifacts

### 4.1 `dsh-plugin.json` (the host's own admission path)

One bundle-level manifest: `manifestVersion` `0.15`, id `com.mpd-dsh.mpd-tui`, a single host facet
whose entry is `packages/mpd-tui-plugin/dist/index.js`, **no** `provides`, **no**
`requires.services`, no client/worker facet, four default-deny decision-event permissions, and
`tui.dsh/v1alpha1#DecisionEvents` declared **only** as an optional requirement with a written
fallback. Measured on the host's own parser + projection + negotiation: the admission state is
`waiting_authorization` with `PERMISSION_NOT_GRANTED` for the four intercept permissions — one of
the five documented admission states, not a parse error. The live TUI's own
`/plugins check <abs path to dsh-plugin.json>` prints the same result and names our id.
**Backed at:** `Parsed` + `Negotiated` (host modules, plus a live `/plugins check`), with the
control experiments recorded (a manifest without the four permissions negotiates `compatible`;
a broken one reports a JSON parse error).

Admission states are the five-state projection
`compatible / compatible_degraded / waiting_authorization / rejected / unknown`.

One registration in this package deliberately stays outside the manifest projection — the `/mpd`
command, which goes through the harness `commands` service (see §6.4).

### 4.2 `dsh-distribution.json` (the dsh-distribution meta-protocol)

The descriptor's **filename is not mandated** by the protocol (`docs/getting-started.md:27`); this
repo uses the suggested `dsh-distribution.json`. It is a `DistributionDescriptor` at
`distribution.dsh.dev/v1alpha1` with identity `urn:dsh:distribution:mpd:my-power-dsh` and the real
bundle version from `package.json`, one `EnvironmentComposition` (8 components: the two DSH host
bundles, this bundle, its plugins, MCP servers, skills corpus, web client, and the TUI edition) and
one `ManagedLayout` (9 resources) covering the real data locations:

| Resource | Location (scheme) | ownership / portability / sensitivity |
|---|---|---|
| `workspace-config` | `dsh-workspace:.mpd/mpd.jsonc` | exclusive / portable / private |
| `workspace-state` | `dsh-workspace:.mpd` | exclusive / conditional / private |
| `codegraph-cache` | `dsh-workspace:.codegraph` | exclusive / nonportable / private |
| `workmate-library` | `dsh-home:.mpd/workmate` | shared / conditional / private |
| `workspace-extensions`, `user-extensions`, `bundle-extensions` | `dsh-workspace:.mpd/extensions`, `dsh-home:.mpd/extensions`, `dsh-bundle:extensions` | exclusive-shared-exclusive / portable / private-private-public |
| `bundle-install` | `dsh-profile:node_modules/@mpd-dsh/mpd` | exclusive / nonportable / public |
| `credentials` | `dsh-external:host-managed-credential-store` | external / external / secret |

The locations use the protocol's URI profile (shape-checked, never dereferenced by the protocol)
because the real roots span several roots — the session workspace, the user home, the installed
profile — and because the protocol's `relative-path` profile rejects a leading-dot segment such as
`.mpd`. The scheme prefixes are ours: `dsh-workspace:` (the session workspace), `dsh-home:` (the
user home), `dsh-bundle:` (the installed bundle), `dsh-profile:` (the DSH profile directory),
`dsh-external:` (storage the host manages and this bundle does not). No private machine path and no
secret value appears in the descriptor.

Honest boundaries of that descriptor:

- The protocol is **Draft** (`registry/protocols.json`), and its own README warns that passing
  format validation is **not** a data-safety certification.
- `EnvironmentLifecycle`, `EnvironmentPortability` and `EnvironmentDiscovery` are **omitted on
  purpose**: this bundle implements no versioned lifecycle operation and no
  clone/export/migrate capability, and it publishes no install-instance identity. Declaring them
  empty would be a structurally valid way of saying nothing.
- Its validation by the protocol's own conformance CLI is now delivered: the distribution lane
  (`t9`) copied the protocol repo into the sandbox, built it (`pnpm install --frozen-lockfile` and
  `pnpm build`, both exit 0) and ran the protocol copy's own `<protocol-repo>/packages/conformance/lib/cli.js dsh-distribution.json`
  (exit 0) — the descriptor is validated by the protocol's own tooling, not by a re-implementation
  (`evidence/tui/conformance/20260915T064521Z/03-distribution.log`). Passing that CLI still proves
  format/consistency only, never data safety. A local structural check against the protocol's schema
  files is also recorded in `evidence/tui/docs/20260915T060010Z/descriptor-check.json`.

## 5. Version strings: three different things

These strings are **not** interchangeable, and each belongs to one artifact:

| String | What it identifies | Where it is recorded |
|---|---|---|
| `tui-admission/0.15` | the **profile** version the host enforces | host `registry/registry-0.15.json` → `profileVersion` |
| `community-v0.15` | the **spec** version a claim declares | `schemas/conformance-claim.schema.json` → `specVersion` const (its `claimVersion` is the separate const `"0.15"`) |
| `dsh-tui-admission-v0.15` | the **requirement-suite** version | `conformance/requirements-v0.15.json` → `profileVersion` |

The normative target of this edition is **the host's built-in `tui-admission/0.15` profile at
revision `d28c267`** — the admission content vendored inside the installed
`@deepseek-harness-tui/dsh-tui` package. It is **not** "the current ecosystem standard": the
ecosystem's current main carries no TUI profile at all (`registry/profiles.json` is empty), so
nothing shipped here may be described as ecosystem-approved. The host's vendored admission content
was measured byte-identical to the archived v0.15 content (8 sampled files matching by sha256; the
live descriptor's DecisionEvents digest `sha256:56440dde1b00…` equals the file hash on both
sides), which is why there is no newer TUI profile to chase.

**Status vocabulary.** The ecosystem names statuses Draft / Experimental / Candidate / Stable /
Deprecated, and the mapping used here is exact: this edition is an **experimental adaptation** of
the bundle to the host's built-in profile; the specification content it targets is a community draft
(`community-v0.15`, currently carried as the host's built-in TUI admission policy); and the
**reference implementation** of the TUI surface seams is the host itself
(`@deepseek-harness-tui/dsh-tui`), not this bundle. Nothing in this repository is Stable, and
nothing is ecosystem-approved.

## 6. Known limitations

### 6.1 The decision-event seam is ready but NOT activated

`tui.dsh/v1alpha1#DecisionEvents` cannot be registered by a profile-installed plugin: at host
revision `b246411` the public `admit()` throws, `admitInternal` is gated by a module-private token,
and the exported production accessor has zero callers — so identity is never granted and the
registration is refused before any policy question. The plugin therefore attempts the mediated
registration for its four intercept points, treats the refusal as the expected outcome, warns
**once**, registers nothing, and never uses the test-only token or fakes an identity. **No
DECISION-EVENT input, rewind, session-switch or compact interception is claimed through this seam.**
(One key IS taken over since 2026-10-05, and by a different mechanism entirely: the host's built-in
`dashboard` action owns `Ctrl+A`, so `packages/mpd-tui-adapter-plugin` obtains the host's own
`useStdin` by file URL and a zero-row status view pre-empts that key on the host's input bus — see §7's
"Host input bus" row. It is a key re-point, not a decision-event subscription, and it fires only while
the workspace's team projection holds a team with at least one task. **Since 0.13.0 that contact is
VERSION-GATED**: on a host that offers the sidebar panel seam it stays INERT — `Ctrl+A` keeps the
host's own dashboard meaning and the merged view opens through `alt+a` / `/mpd panel` (§3.3) — and only
a host WITHOUT the seam keeps the pre-0.13.0 arming behaviour.) The manifest declares the seam as an
optional requirement with a fallback, and the upstream fix that would make admission reachable is
documented in the research record (`.mpd/recon/UPSTREAM-RESEARCH.md`).

Related: `trusted-in-process` is a **compatibility/audit label, not a security boundary**. A
SHA-256 digest proves byte identity only — never publisher identity.

### 6.2 The `/settings` section IS bridged to `<workspace>/.mpd/mpd.jsonc` — with a restart and two named skip cases

The section declares the real mpd.jsonc knobs (`hashline.maxDiffChars`, `commentChecker.autoCheck`,
`ulw.maxRounds`, `memory.vcs`, `team.stateDir`, `boulder.dir` and the twelve
`teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` leaves) under the harness settings namespace
`mpd`, and that namespace is **served by `packages/mpd-config-plugin`** (this package is a pure
consumer and registers only a guarded fallback when no config plugin is composed). What a save does
today:

**The base is a rule, not a lookup.** The serving package derives the namespace base itself
(`baseForNamespace()`, registered through the adapter)
under a cardinality rule:

| Live session roots | The namespace base |
|---|---|
| **exactly one** | that workspace's `<workspace>/.mpd/mpd.jsonc` — the normal path |
| **zero** | the **mount-time** (exec-less) root — `DSH_WORKSPACE_ROOT` or the process cwd — the only root that exists before any session does; an absent file there yields an **empty base**, i.e. effectively the schema defaults. Because `mpd-config`'s row position usually precedes any live session, this is the **normal boot path** |
| **more than one** | **no file base is invented**: `base: undefined`, reason `ambiguous-multi-root`, a warn naming every candidate, surfaced by `states()`. The namespace shows the schema defaults until exactly one workspace is live; a save in that state is REFUSED (below), so the ambiguity cannot reach disk |

**The base is fixed for the process lifetime** — the host exposes **no disposal handle** for a live
registration, and its own settings installers keep their base fixed the same way. That is exactly why
the shipped sentence is "takes effect for the mpd plugins **after a restart**": it is the honest
consequence, not a hedge. What the plugins actually use is the **resolved value** plus the config
layer's **per-call file reads**: the L1/L2 file layers are re-read on every resolution, so the
**per-workspace read-in still resolves each session's own file** even while the base is frozen. No
sentence on this page promises a live-refreshed base.

- **Read-in precedence** — L0 schema defaults < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 the settings user section**, which is authoritative at runtime; a
  later FILE edit **unsets** the overlapping settings leaf, so the file's new value wins again and
  neither direction silently loses.
- **Write-back** — owned by `packages/mpd-config-plugin` (never by this TUI package, which keeps its
  verified zero-write property). It triggers on the host's `settings/document-updated(ns, revision)`
  event filtered to `source === 'update'` (the raw-section event, so the deep-equal gate cannot drop a
  change) and writes the live session workspace's `<workspace>/.mpd/mpd.jsonc` under a lock plus a
  compare-and-swap on the raw bytes, a sibling temp file and an atomic rename. **Comments, key order and
  trailing commas survive**: a real boot rewrote `hashline.maxDiffChars` 20000 → 31415 in a JSONC file
  and the comment, the key order and the trailing comma were unchanged.
- **Workspace target** — the settings path carries no identity, so the target set is the **live session
  workspaces at event time**: exactly one ⇒ that file is written; **zero ⇒ `no-live-session`**; **more
  than one ⇒ `ambiguous-multi-root`**, with every candidate named. In both skip cases **no file is
  changed** and the edit is **not lost**: it is stored in the host-global settings document and the
  config layer applies it to every workspace immediately — only the FILE WRITE waits for exactly one
  live session. The TUI status line and the Web card both carry that clause.
- **Timing** — the mpd consumers capture their config at plugin `apply()` (`applies: 'restart'`), so a
  saved edit **takes effect for the plugins after a restart**; the on-screen hint says exactly that.
- **Degenerate targets are loud** — missing (created with a header comment), read-only (`denied` + path +
  errno, the settings edit still succeeds), concurrent (retry ×3 then `conflict`, the human's file left
  untouched), unparsable (`unparsable`, never repaired).

**Evidence level:** `Observed` — two real boots in the sandbox (ok: true) at
`evidence/mpd-bridge/implementation/20260915T080138Z/`, plus the lane
`skills/dsh-qa/scripts/tui-settings-bridge.ts` and the re-review PASS at
`evidence/mpd-bridge/review/REREVIEW-t49.md`. The PRE-bridge revision
(`packages/mpd-tui-plugin/dist/index.js` sha256 `5dce2563fd0e3b20…`) carried the old on-screen text
(`mpd.jsonc <key> — not bridged: a save here does not rewrite .mpd/mpd.jsonc`); that text and the
"named follow-up" framing are **no longer true** at the current revision
(`dist/index.js` sha256 `cf4b3813a344c9d5…`).

### 6.3 The packaged skill is an asset only

`packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` ships with the package but is **not** registered
by this row: the bundle's corpus is served from `<bundle>/skills` by `mpd-bootstrap` (18 skills).

### 6.4 The `/mpd` command uses the host's unattributed `commands` service

`packages/mpd-tui-plugin/src/commands.ts:53-60` registers `/mpd` on the harness `commands` service —
the surface the host advertises as the `commands.dsh/v1alpha1` contract — while the manifest declares
`contributes.commands: []`. Both statements are true at once, and the manifest's
`x-mpd-tui-surfaces.whyNoContribution` states the narrower, exact fact: this plugin "registers no
host Command through the Command capability". The manifest-mediated Command **contribution** surface
is a different path — the one that needs a contribution id (and, per the host registry,
`registry/permissions-0.1.json`, the `commands.invoke` permission). This package deliberately keeps
the harness `commands` service outside that projection and declares no contribution, so
`contributes.commands: []` is **truthful, not an omission**.

The consequence is measured and disclosed rather than hidden: the host's effect ledger attributes
this registration as `undeclared`, because the mediated (`tuiPluginHost.registerCommand`) path needs
an admitted Component and admission is `waiting_authorization` by design — this is t10's F4
disclosure, re-examined in `evidence/tui/review/t12/REVIEW.md:62` and `result.json:115`. `/mpd`
itself works: the live lane rendered the command and its command tree among the six of seven
surfaces (NOT-CLAIMED #10 covers the seventh). The alternative reading — declaring the command in
the manifest — would require a granted `commands.invoke` permission and an admission path a
profile-installed plugin cannot reach (§6.1), so it is not the chosen reading. Which reading the
ecosystem takes is stated in the delivery report.

### 6.5 Duplicate keys in `mpd.jsonc` — the settled rule

`JSON.parse` is last-wins, so a path declared more than once has exactly one observable value. The
bridge edits the durable projection with that in mind, and the rule is the captain's final table
(`evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md`):

| Operation | A path declared more than once | Why |
|---|---|---|
| **SET** | edit the **LAST** occurrence, succeed, and warn naming **every** occurrence line | the last occurrence is the only one `JSON.parse` can observe |
| **UNSET** (direct call or the `DELETE` sentinel) | remove **EVERY** occurrence of that exact path, in one descending-span pass | after an unset the key must be ABSENT: leaving an earlier occurrence would keep it effective in the file while the settings layer reports it unset — the silent divergence this bridge exists to remove |
| **refusal** | only unprovable spans, a duplicated **INTERMEDIATE** key (`ambiguous-intermediate`, both directions), an unparsable document, or a `read-only` target | in those cases the target span cannot be proven, so nothing is written and the reason is named |

The projection rationale, in one line: the file is the **durable projection** of the settings layer,
not an untouchable user original — which is why UNSET deletes all occurrences and SET only the one the
runtime reads.

### 6.6 Where state lives — the scopes and the cross-home boundary

The bridge spans four scopes, and naming them by mechanism is what makes the two front doors
predictable (`evidence/mpd-bridge/dual-path/REPORT.md`, finding D1):

| Scope | State | Shared when |
|---|---|---|
| **DSH-HOME** (`$DSH_HOME/settings.yaml` + user `mpd.jsonc`) | the host's settings document | both front doors live in the **same DSH home** |
| **workspace** (`<workspace>/.mpd/**`) | `mpd.jsonc` (the bridge's durable projection), `memory.json`, team/plan/boulder state | both doors run in the **same workspace** — by construction |
| **HOME** (`~/.mpd/workmate`) | the user's cross-project workmate library | same `HOME`, i.e. across profiles of one user; distinct for two users |
| **bundle** (`<bundle>/…`) | the `mpd` preset/roster and the skill corpus (served, not copied) | both doors **are the same install**, independent of any home |

**The boundary to know:** with ONE DSH home the settings document is shared, so a settings edit is
visible to both front doors at once. With SEPARATE DSH homes there are **two** settings documents —
`settings.yaml` is DSH-HOME-scoped — so an edit made in one door is **invisible as a settings VALUE**
to the other. The durable state still converges: the write-back target is the **workspace** file, and
both doors write that same `<workspace>/.mpd/mpd.jsonc`. In one sentence: *same DSH home ⇒ the settings
value is shared; separate homes ⇒ the settings values differ, but the workspace `<workspace>/.mpd/mpd.jsonc` still
converges.* This is the one place where the two doors can legitimately disagree on an inherited value.

## 7. Deliberate deviations from ecosystem convention

| Deviation | Value | Why it is deliberate |
|---|---|---|
| Package name | `@mpd-dsh/mpd-tui` | Keeps this bundle's namespace; the ecosystem uses its own naming. |
| Licence | SUL-1.0 (`LICENSE.md`) | Unchanged by this edition; no artifact claims a licence change. |
| Manifests | **ONE** bundle-level `dsh-plugin.json`, never 25 per-package manifests | The bundle installs as one unit; the manifest's host facet points at the one TUI plugin module. |
| Host input bus | ONE counted contact outside the seams, and since 0.13.0 a **VERSION-GATED** one: the adapter resolves the INSTALLED host root and dynamic-imports `<hostRoot>/lib/types/ui.js` **by file URL** to obtain the host's own `useStdin` — but only while the `tuiPanels` seam is **ABSENT** | `Ctrl+A` is a host built-in action that no contribution kind can reach, so on a pre-0.13.0 host the alternative was dropping the requirement. **The gate:** on a host that OFFERS the panel seam (0.13.0+) the contact stays **INERT** — `Ctrl+A` keeps the host's own dashboard meaning and the merged view opens through `alt+a` / `/mpd panel` (§3.3), which the 0.13.0 real-PTY lane measured (`evidence/tui/lanes/2026-10-06T10-28-57.807Z/`: the host's own dashboard opened, and `/mpd panel` proved the sidebar registration + accepted open); on a host WITHOUT the seam (0.12.0) the old behaviour is unchanged — the contact arms when `tui.dashboardKey` is on and the workspace's team projection holds a team with at least one task. `tui.dashboardKey` therefore stays in the config schema and the `/settings` row, documented as meaningful on OLD hosts only. The per-press rule lives in ONE function, `takeoverArmed` in `packages/mpd-tui-plugin/src/panel.ts` (the seam WINS over every config layer; only without the seam does the saved value, else the row config's floor, decide), and the adapter's `panelSeamBound()` is read PER PRESS, not only at apply time. **History (measured on 0.12.0, kept as the record it is):** that import is a FOREIGN instance whose `useStdin()` answers nothing, so the adapter also stores the live kit a SCENE render receives and prefers it — which is why the take-over arms after the session has rendered any MPD panel or scene, and stays inert before that. Two further host rules are obeyed inside the adapter: a status registration's identity must be the CALLING ACTIVATION (the injected scope), and no DSH-TUI file is written. **Bound:** no 0.12.0 PTY arm was obtained in this wave (§11.3), so the old-host arming path rests on unit arms rather than on a pane capture. |

## 8. Per-package compatibility ledger

Measured by the composition task (t5) against `@deepseek-harness-tui/dsh-tui` 0.10.1 with this
bundle as the third patch layer. Source of truth:
`evidence/tui/composition/20260915T053445Z/ledger.json` (generated 2026-09-15T05:54:03.989Z,
sha256 `a292c88b95c8cf1f0566fa8a13e3276e2447db44079834554bb7178686974bf3`); human summary in the
same directory's `ledger.md`; per-package observations, caveats and the raw artifacts
(`raw/tool-list.json`, `raw/tui-*.log`, `raw/dsh-tui-dump-config.txt`, …) sit beside them. The
classifications below are that measurement, reproduced verbatim; they are not re-derived here.

Counts: **usable 22 · inert 2 · web-only 1 · total 25**.

**A 0.1.7-rc.2 delta on this historical table:** the `mpd-agent-teams-plugin` row below records the
2026-09-15 measurement, when the vendored `agent-teams` body WAS mounted. It is now **retired from
the composition** (no loader row mounts it; its team tools and its sidebar panel are not
part of a shipped session), and the bundle mounts the three OFFICIAL Agent Teams packages instead
(`mpd-agent-team` / `mpd-tool-agent-team` / `mpd-ui-agent-team`). Read that one row as history, not
as a current capability.

| Package | Role | Class | Live witness |
|---|---|---|---|
| `mpd-bundle` | composition layer (the bundle patch itself) | usable | composed config rows incl. `mpd-tui` and the `agent-preset-registry` id-target; live boot with 0 crash signatures |
| `mpd-dsh-adapter-plugin` | single contact surface with the harness seams | usable | apply-time log line `[mpd-dsh-adapter] mpdDsh provided` |
| `mpd-config-plugin` | mpd.jsonc runtime config layer | usable | tools `mpd_config_get`, `mpd_config_reload` |
| `mpd-tools-plugin` | write guard / truncation / waterfall | usable | composed row `mpd-tools` with its config; owns no tool name |
| `mpd-modelchain-plugin` | model-chain resolution + workspace memory | usable | tool `mpd_modelchain_resolve` |
| `mpd-ext-plugin` | extension registry (skills/flows/roles/MCP) | usable | tools `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`, `mpd_flow_show` |
| `mpd-roles-plugin` | specialist roster | usable | tools `mpd_role_persona`, `mpd_role_spawn`, `mpd_roles_list` |
| `mpd-ulw-plugin` | ulw loop discipline | usable | tools `mpd_ultrawork`, `mpd_ulw` |
| `mpd-hashline-plugin` | anchored edit discipline | usable | 4 `mpd_hashline_*` tools |
| `mpd-boulder-plugin` | durable work ledger | usable | 6 `mpd_boulder_*` tools |
| `mpd-comment-checker-plugin` | comment/docstring detector (opt-in binary) | usable | tool `mpd_comment_check` |
| `mpd-codegraph-plugin` | codegraph project init + binary resolve | usable | apply-time `[mpd-codegraph] init status=marker …` |
| `mpd-memory-plugin` | git/svn-backed memory + reflection | usable | 7 `mpd_memory_*` tools |
| `mpd-workmate-plugin` | durable evolving agent library | usable | 7 `mpd_workmate_*` tools |
| `mpd-team-compact-plugin` | finished-team compaction | usable | tools `mpd_team_compact_run`, `mpd_team_compact_status` |
| `mpd-bootstrap-plugin` | serves the bundle's skills corpus (no home copy) | usable | apply-time `skill corpus served from <bundle>/skills` |
| `mpd-tui-plugin` | the TUI-native surface package (this edition) | usable | composed row `mpd-tui` → `@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js` |
| `mpd-agent-teams-plugin` | the vendored AgentTeams plugin (tools + Web panel) — **RETIRED from the composition in 0.1.7-rc.2; this row is the historical 2026-09-15 measurement** | usable then | 17 team tools |
| `mpd-mcp-astgrep` | ast-grep MCP server (stdio launcher) | usable | 3 `mcp__ast_grep__*` tools |
| `mpd-mcp-lsp` | LSP MCP server (stdio launcher) | usable | 8 `mcp__lsp__*` tools |
| `mpd-mcp-codegraph` | codegraph MCP server (stdio launcher) | usable | server alive in-process; 0 tools **in that sandbox** because the CodeGraph policy excludes a project path containing `.mpd` (a sandbox artifact, not a TUI limitation) |
| `mpd-mcp-gitbash` | git-bash MCP server (Windows-only upstream) | inert | row composed `disabled: true` under every profile |
| `mpd-mcp-shared` | shared binary resolver used by the MCP launchers | usable | support library, no row/tool of its own; witnessed by the MCP children that launched |
| `mpd-bundle-plugin` | bundle web-compat package (browser client + no-op main) | **web-only** | no TUI rendering face; TUI equivalents are the §3 surfaces |
| `mpd-qa-roles-probe` | QA-only probe package | inert | no row in the bundle patch (mounted only by a QA overlay) |

Caveats the ledger itself records: `packages/mpd-tui-plugin` was still being written when the
ledger was measured, and the ledger's recorded plugin digest is that revision
(`dist/index.js` sha256 `695f68c4858745cc…`). That artifact was rebuilt twice afterwards during this
wave, so the ledger's plugin hash is **history, never the delivered artifact**: the docs bind to the
delivered revision recorded in §11 and in
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md`, while the ledger's *composition*
observations stand. The seven seam surfaces' *rendering* is not this ledger's claim: it belongs to
the live lane, which rendered six of the seven (NOT-CLAIMED #10). No package was re-classified here
(AC-12 is t5's measurement, re-checked by t8).

## 9. Requirement evidence kinds

The admitted requirement suite fixes the evidence kind per requirement; the spec-conformance lane
(`t9`) has since run the pinned suite and recorded a per-requirement status plus artifact for all
seven rows, so no requirement row is left unstated — but the suite's own runner is blocked
(the vendored `dsh-std` submodule ships sources only, so `pinned-cli`/`pinned-suite` exit 1) and the
matrix was therefore evaluated with the pinned parser over the pinned inputs. That is a recorded
blocker, **not** a clean suite pass and **not** a conformance claim for this bundle:
`evidence/tui/conformance/20260915T064521Z/04-spec-conformance.log`.

The evidence kind each requirement fixes:

| Requirement | Evidence kind |
|---|---|
| `BASE-STD-001`, `TUI-PKG-001`, `TUI-PKG-002`, `TUI-PRIVATE-001`, `TUI-HOST-001`, `TUI-OBS-001` | `automated` |
| `TUI-TRUST-001` | `review` |

Two clauses limit what any of this may be turned into: verifying only a source repository, or
running only reference-implementation tests, is **not** sufficient to produce an artifact claim
(`TUI-DEP-001`), and `trusted-in-process` is a compatibility/audit label, not a security boundary
(`TUI-TRUST-001`). Compatibility decision, verification level and restrictions are kept in
separate sections on purpose.

## 10. NOT-CLAIMED

Nothing in this section is a working feature.

1. **decision-event seam** — blocked by host admission unreachability (§6.1). Ready but not
   activated; no interception is claimed THROUGH THAT SEAM. (The separate `Ctrl+A` key re-point of §7
   is not this seam and makes no decision-event claim.)
2. **Identity-gated services** — `storage.local`, `messages.observe` and the mediated
   `registerCommand` path need the same verified Component identity; the effect ledger therefore
   attributes our surface as `undeclared` today.
3. **web-only faces** — the workmate tab
   (`dsh.client.platform = web`) does not render in the TUI, and the official Agent Teams panel is a
   Web client surface as well. The TUI-native equivalents (§3) are
   not a pixel or feature-parity claim.
4. **Engine version skew** — the host prints
   `⚠ The dsh engine (0.1.5-rc.2) is newer than the 0.1.5-rc.1 this UI is validated against` and
   keeps running. Our verification runs against the installed `0.1.5-rc.2` engine, not the engine
   revision the UI was validated against. This page anchors no claim on the ecosystem's current
   state.
5. **Seam 2 (`tuiPrompt`)** — the host does not provide it; no claim.
6. **Host-internal gates are not our conformance** — the host's own `verify:plugin-*` suite
   validates the **host's** plugin subsystem; even a green run is not a conformance verdict on
   this bundle, and it may be blocked (the host checkout has no `node_modules`/`lib/`).
7. **The non-automated TTY boundary** — the TUI boots only with a real terminal on stdout, so the
   TUI lanes run under tmux and are excluded from the automated `bun run test:qa` sweep; the
   automated lanes cannot witness a TUI screen.
8. **No published conformance claim, and no data-safety certification** — descriptor validity is
   not a safety guarantee, and our lanes are not a certificate (`TUI-DEP-001`).
9. **The package-local skill asset and the deliberate deviations** — §6.3 and §7. (The
   `/settings` bridge stood here until the bridge wave; it is now a claimed, evidenced
   capability — `Observed`, two real boots — documented in §6.2 and recorded as superseded in
   §11.1.)
10. **The `tuiRenderers` transcript row is not projected by the host.** The plugin registers a
   renderer for its log-only `mpd-tui/board-opened` event and the event is provably in the durable
   store, but **no transcript row appears**, while the other six activation-gated surfaces render:
   `evidence/tui/live/20260915T063140Z/result.json` records `"tuiRenderers": false` (and
   `"sceneReportedTranscriptRows": 0`), and `T8-LIVE-VERIFY.md:19` records "6/7 seams render …
   `tuiRenderers` MISSING". The attribution is **host-side**, not this plugin's defaulter: two
   independent plugins reach the service and call `register()` without a throw on the same boot, and
   the installed runtime captures `tuiRenderers` once with no local fallback while giving
   `tuiSettingsSections` one. The honest limit: the host is read-only and exposes **no registration
   read-back**, so whether the captured runtime is `undefined` at channel construction (H1) or the
   host never projects plugin registrations (H2) is **UNVERIFIED** — both readings are host-side.
   `register()` returning a function proves nothing, because a refusal returns the same no-op
   disposer; that is why the package reports this seam as `requested`, never `confirmed`. A later
   single-boot cross-run reproduced that a *fresh* event type renders while this already-known one
   does not (`CORRECTION-renderer-causation.md` in the same evidence directory), which narrows the
   cause to the host's deny-list capture order instead of "no renderer row can be produced"; the
   disposition is unchanged. **Re-measured on 0.13.0 (2026-10-06): still MISSING** — the surfaces lane
   renders the other seven of its eight surfaces and reads `tuiRenderers=MISSING`
   (`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`), so the gap is unchanged by the 0.13.0 adaptation
   and remains the pre-existing structural gap already declared in `evidence/tui/EVIDENCE-INDEX.md`;
   the lane exits 1 on that required surface rather than weakening it to keep a green exit.
11. **A teammate CAN now be spawned in a TUI session — this item used to say it could not.** The
   official Agent Teams service still cannot activate under the dsh-tui host: the host refuses the
   root-fiber effect the plugin's own `ctx.root.sessionProjections.register(...)` creates, so
   `TeamService`'s constructor throws before the service exists (§3.2 carries the mechanism and the
   measurement). **What changed is that the mpd team no longer needs it.** Since the team-plane split
   (W2) the team runs on its own record (`mpd-team-core-plugin`, served as `mpdTeams`) and its own
   executor — `mpd-dsh-adapter`'s `TeamExecutor`, NATIVE by default over
   `ctx.subagents.startContinuable`, which reads nothing from the official plugin. The boot says so in
   as many words: `[mpd-team-core] team executor: native (native: the default backend — it needs
   nothing from the official plugin)`.
   The two official rows therefore stay disabled, and the guard is KEPT — but its justification is
   re-scoped rather than inherited: it no longer says "the team plane would be dead here" (untrue
   since W2) and it says "a row that cannot mount in this composition would print an activation error
   on every boot, and disabling it costs the TUI plane nothing" (true, and measurable — the team works
   either way). Evidence for the original defect:
   `evidence/tui/team-plane-not-mountable/20260929T083309Z/`.
   The `mpd-tui-team` scene, the plan scene and the status line render, and since W3 the scene draws
   the record's own **dependency graph** — rank columns, status colours, a focus chain, and a rail
   fallback when the terminal is too narrow for boxes.

## 11. Verification status of this page

**Revision binding.** Every statement below is bound to the delivered revision: `dsh-plugin.json`
sha256 `84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9` (identity pair
`@mpd-dsh/mpd` / version 0.9.1 / id `com.mpd-dsh.mpd-tui`) and its entry
`packages/mpd-tui-plugin/dist/index.js` sha256
`5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` (98883 bytes). The artifact was
rebuilt twice during the wave, so earlier digests are **history, not the current artifact**; the
step-by-step chain is recorded in
`evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md`. A citation of an earlier digest is never a
citation of the delivered artifact.

| Statement group | Level claimed here | Status / evidence |
|---|---|---|
| Install / triple layering / 24 rows / 0 crash signatures / mpd preset default | Observed | backed — t5 `evidence/tui/composition/20260915T053445Z/`, re-run by t8 (`evidence/tui/live/20260915T063140Z/lanes/tui-mount/`) and t9 (`…/conformance/20260915T064521Z/09-mount-boot.log`, `10-mount-boot-clean-root.log`) |
| Manifest parsed, projected, negotiated (`waiting_authorization`), live `/plugins check` | Parsed + Negotiated | backed — t9 `…/conformance/20260915T064521Z/01-admission-static.log` (manifest `84ed4a5d…`, entry `5dce2563…`) and `02-admission-live.log` |
| Per-package ledger | Observed (per package) | backed — `ledger.json` (t5); its structure re-checked by t8 |
| Plugin contract shape (no default export, cleanup, soft probes) | Tested (unit) | backed — `evidence/tui/plugin/20260915T054343Z/` (t4); 547 package tests pass (t9) |
| The seven activation-gated surfaces in a live TUI | Observed | **6 of 7 delivered** — `evidence/tui/live/20260915T063140Z/result.json` (`"tuiRenderers": false` → NOT-CLAIMED #10) |
| Admission / distribution / spec-conformance lanes | Parsed + Negotiated / Tested / Tested with a recorded blocker | backed — t9 `…/conformance/20260915T064521Z/01`–`04` (distribution: the protocol's own CLI exit 0, `fullyValidated=true`; spec suite: `pinned-cli`/`pinned-suite` exit 1 on the unbuilt vendored `dsh-std`, per-requirement matrix recorded) |
| Web profile still boots (regression) | — | **not verified** — only a composition proxy exists (R4: 24 row ids, exit 0; a clean-store TUI mount boot, exit 0). A real web-profile boot has not been run |
| Live-lane re-run from a clean sandbox | Observed | backed — t8 `…/live/20260915T063140Z/` (its own root, `inherited: []`, 0 isolation offenders) |
| R3 `bun run test:qa` | — | **fails by design** until the captain's single `VENDOR_LOCK` re-pin lands (t9 residual: skills corpus 307 files / `e510d8c5c6de` vs pinned 301 / `0dd4a6ee68e0`) |

The mapping from this bundle to the admitted requirement suite exists and the lane has now been
executed against the pinned inputs with a per-requirement status per row; the outstanding items are
the recorded spec-suite blocker, the web-profile boot, and the captain's single re-pin — none of
which this page turns into a pass.

### 11.1 Amendments after the bridge wave (t50, 2026-09-15)

The rows above are the records of the TUI-edition revision and stay as written. The settings-bridge
wave (t35–t50) moved two of the artifacts they name and closed one of their residuals, so the
following supersedes them. Every number below was re-measured with `sha256sum` / `stat -c %s` in the
same step that wrote this block — never derived, never remembered:

| Superseded statement | Was | Is (measured 2026-09-15, t50) |
|---|---|---|
| §11 revision binding, entry digest | `packages/mpd-tui-plugin/dist/index.js` sha256 `5dce2563…`, 98883 bytes | sha256 `cf4b3813a344c9d5…`, **105305 bytes** — the bridge wave reworded the `/settings` disclosure, so the package was rebuilt. `dsh-plugin.json` sha256 `84ed4a5d…` is unchanged (8088 bytes), and the two artifacts that wave adds are `packages/mpd-config-plugin/dist/index.js` sha256 `15733c1e…` (99868 bytes) and `packages/mpd-bundle-plugin/client.js` sha256 `dd9c8893…` (282453 bytes) |
| §11 R3 row | `bun run test:qa` "fails by design" until the captain's single `VENDOR_LOCK` re-pin lands | **PASSES** — the single re-pin landed (`VENDOR_LOCK.json` `assets/skills`: 307 files, treeSha `ba0c3922…`) and the suite reports all self-tests passed, exit 0 |
| NOT-CLAIMED #9 (it led with the `/settings` bridge) | "the `/settings` bridge, the package-local skill asset, and the deliberate deviations" | the **bridge is a claimed, evidenced capability** (§6.2, `Observed`, two real boots); #9 now covers the package-local skill asset and the deliberate deviations (§6.3, §7) |
| §3 settings row | "with the limitation in §6.2" | a bridged behaviour with a restart caveat and two named skip cases (§6.2), the duplicate-key rule (§6.5) and the Web card's evidence level (§3.1) |

The earlier statements were not rewritten — they are superseded here, in place, under this heading.

### 11.2 Amendment after the team-surface wave (t5, 2026-09-16)

The rows above stay as written for the revision they measured. This wave adds the two team surfaces
and re-measures what they touched:

| Superseded statement | Was | Is (measured 2026-09-16, t5) |
|---|---|---|
| §3 surface list | the board, the `/settings` section and the command tree were the whole TUI surface set | adds `mpd-tui-team` (`/mpd team`) and `mpd-tui-plan` (`/mpd plan`), plus two board rows `team-plan` / `team-hold` (§3.2) |
| §11 revision binding, entry digest | `packages/mpd-tui-plugin/dist/index.js` sha256 `cf4b3813…`, 105305 bytes | re-pinned by digest in `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/REVISION.json` — the delivered entry plus every source file this wave touched |
| §11 R3 row | `bun run test:qa` PASSES | **PASSES again** — the captain re-pinned `VENDOR_LOCK.json` `assets.skills` (319 files / treeSha `303e1631…`) together with the corpus change in one commit, and the verification task was retried green. Both the re-pin value and the sweep are in `evidence/tui/team-surface-integrate/2026-09-16T14-17-24.000Z/`; `docs/tui-parity.md` §7 repeats them |
| The parity question itself | the surface set was described per lane | answered row by row for every Web-edition surface in `docs/tui-parity.md` (+ zh-CN): status, reason, and the evidence level of each row |

### 11.3 Amendment after the DSH-TUI 0.13.0 adaptation wave (2026-10-06)

The rows above stay as written for the revision and the host they measured. This wave moved the target
host one release on and adopted the seam that release added, so the following supersedes them:

| Superseded statement | Was | Is (measured 2026-10-06) |
|---|---|---|
| This page's target host (§ preamble) | `@deepseek-harness-tui/dsh-tui` **0.12.0** and its built-in admission profile | **0.13.0** — the release that adds the sidebar panel seam (host row `dsh-tui-panels`, export `./panels`) and renames the host's `dsh-ecosystem-spec/` to `tui-profile/`. The 0.12.0 sentence stays above as history; the same wave moved the distribution pin (`dsh-distribution.json`'s `host-tui` ref) and the QA host spec (`docker/tui-lane.sh`, `docker/entrypoint.sh`, `skills/dsh-qa/scripts/tui-mount.ts`, `skills/dsh-qa/scripts/install-dependencies.ts`) |
| §3 seam inventory | fourteen `tui*` seams, i.e. the set dsh-tui has exposed since 0.12.0 | **fifteen** — `TUI_SEAMS.panels` (`tuiPanels`) is the addition, bound/probed/degraded like every other seam (§3) |
| §3 Agent Teams panel row | `tuiScenes` full-screen board + `tuiStatus` keyed status line | the **`tuiPanels` sidebar panel is the primary entry point** and the full-screen scene is its fallback, for both `alt+a` and the new `/mpd panel` (§3.3); the command action list is now `board`, `team`, `plan`, `subagents`, `panel`, `workmates`, `status` |
| §7 "Host input bus" row | the `Ctrl+A` host-input contact armed from 2026-10-05 whenever the workspace team had ≥1 task | **version-gated**: INERT on a host that offers the panel seam (0.13.0+), unchanged on a host without it (0.12.0); `tui.dashboardKey` is schema/`/settings`-retained and meaningful on old hosts only |
| §10 item #10 (`tuiRenderers`) | MISSING on the 0.10.1-era live lane (6 of 7 surfaces) | **still MISSING on 0.13.0** — the surfaces lane renders 7 of its 8 surfaces and exits 1 on this required one (`evidence/tui/lanes/2026-10-06T10-27-53.571Z/`); unchanged by this wave |

**The evidence of this wave, and its bounds — the bounds are part of the claim, not a footnote.**

- **Mount lane PASS** — `evidence/tui/lanes/2026-10-06T10-27-42.389Z/`: an `mpd` preset session on the
  0.13.0 host with our keyed status line, the counters, zero apply-crash signatures and
  `isolationOffenders=0`.
- **Surfaces lane** — `evidence/tui/lanes/2026-10-06T10-27-53.571Z/`: 7 of 8 surfaces rendered (status
  line, `/mpd` completion, the `/mpd workmates` command, the sidebar panel registration + open, the
  board scene, the `/settings` section with its disclosure, the managed dialog), with the negative
  control red as required — and exit **1** on the required `tuiRenderers` surface, which is the
  pre-existing gap above, not a regression of this wave.
- **`Ctrl+A` lane PASS** — `evidence/tui/lanes/2026-10-06T10-28-57.807Z/`: the host's own `Ctrl+A`
  dashboard opened (the legacy contact stayed INERT, as the version gate requires) and `/mpd panel`
  proved the sidebar registration + a host-ACCEPTED open. The full lane report, including the raw
  command lines and both negative controls, is
  `evidence/tui/lane-repair/013-20261006T102742Z/TUI-013-LANE-REPORT.md`.
- **BOUND (a) — the panel BODY is not pane-capturable on this host.** After a host-ACCEPTED open the
  320×50 capture was byte-identical to the one taken immediately before it, so this wave proves
  registration + `open()` + the id discovered from the host's `list()` read-back (`act1:team`) — **NOT
  a render**; §3.3 states it, and every run records it as `panelBodyBound`.
- **BOUND (b) — `tuiRenderers` is still MISSING** (a pre-existing structural gap already declared in
  `evidence/tui/EVIDENCE-INDEX.md`, not caused by this wave).
- **BOUND (c) — no 0.12.0 PTY arm was obtained.** A clean 0.12.0 sandbox needs `dsh plugin add`, which
  is blocked here by the read-only pnpm store lock (the fixture that exists is a MIXED-version
  composition and never reaches a chat screen), so the old-host arming path rests on unit arms:
  `takeoverArmed` in `packages/mpd-tui-plugin/test/panel.test.ts` (16 pass / 0 fail on this revision,
  including "the SEAM WINS: a bound panel seam forbids interception whatever the config layers say")
  and the legacy-host arm in `packages/mpd-tui-plugin/test/plugin.test.ts` — which **could not be
  loaded at all** here (`TypeError: require() async module … cosmokit/lib/index.ts is unsupported`, a
  pre-existing module-resolution error in the retired adopted plugin's vendored `_deps`), so that arm
  is **not** claimed as evidence.
