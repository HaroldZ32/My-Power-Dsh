# DSH-TUI edition

**English** | [中文](./tui.zh-CN.md)

This page describes the **DSH-TUI edition** of the my-power-dsh bundle: what it ships, how to
install it, what the per-package compatibility measurement found, and what it explicitly does
**not** claim. It targets `@deepseek-harness-tui/dsh-tui` **0.17.0** and its built-in admission
profile — the first dsh-tui release whose declared peers admit DeepSeek Harness `0.2.1-rc.3`. §11.10
is this wave's amendment: it records the move, the unchanged seam inventory and the carriers it
touched. **The pin before it was 0.16.1, and that statement stays readable as history**: 0.16.1 is the
first dsh-tui release whose declared peer bands included harness `0.2.1-rc.2` (all 36 of its
`@deepseek-ai/dsh-*` peers listed it), and §11.8 is that wave's amendment.
**The pin before it was 0.14.0, and that statement stays readable as history**: 0.14.0 is
the release that adds the **Claude backend peer** (`@anthropic-ai/claude-agent-sdk` 0.3.287) and the
`ws` runtime dependency, an **eighth** builtin sidebar panel (`btw`) and a **carousel** `PanelBar`
that draws the active tab's title plus `○`/`●` dots and no longer paints a plugin's declared icon;
§11.6 is that wave's amendment, and it names the carriers that move touched.
**The pin before it was 0.13.0, and that statement stays readable as history**: 0.13.0 is the release
that **adds the sidebar panel seam** — host row `dsh-tui-panels`,
export `@deepseek-harness-tui/dsh-tui/panels` — and that renames the host's own `dsh-ecosystem-spec/`
directory to `tui-profile/`; this edition adopted the new seam as its **fifteenth** `tui*` seam
(§3, §3.3). **The pin before it was 0.12.0, and that statement stays readable as history**: 0.12.0 is
the dsh-tui release whose peer ranges cover the whole band this bundle's pinned harness sits in — its
lists run through `0.1.7-rc.2`, `0.2.0-rc.1` and `0.2.0-rc.2`, where 0.11.2 stopped at `0.2.0-rc.1`
(0.10.1 and 0.10.2 stop at `0.1.5-rc.1`), so it was the first pin that could boot against the harness
this bundle targets; 0.13.0's own `peerDependencies` still end at `0.2.0-rc.2` (read from the
installed package). **The move touched every carrier in one wave**: the global package and the
`dsh-tui` profile, the distribution descriptor's `host-tui` ref (`dsh-distribution.json` carried
`pkg:npm/@deepseek-harness-tui/dsh-tui@0.13.0` while 0.13.0 was the pin), and the QA host spec
(`docker/tui-lane.sh`, `docker/entrypoint.sh`, `skills/dsh-qa/scripts/tui-mount.ts`'s `TUI_HOST_SPEC`
and `skills/dsh-qa/scripts/install-dependencies.ts`'s remedy all defaulted to `0.13.0` then). **Both
those carriers moved again in the 0.14.0 and 0.16.1 waves: §11.8 — not this paragraph — states the
values in force today.** The compatibility
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
| TUI surface package | `packages/mpd-tui-plugin/` | The TUI-native surfaces: the **three sidebar pages** (`src/panel.ts` — title `MPD`, the primary entry point and, since the 0.14.0 wave, the rich DAG page itself, §3.3/§3.4 — `src/panel-workmate.ts`, and `src/panel-watchdog.ts` since the 2026-10-23 watchdog wave), status line, `/settings` section, full-screen scenes, `/mpd` command tree, keyboard shortcuts, mediated dialogs, a transcript-renderer **registration the host does not project** (NOT-CLAIMED #10), and the decision-event seam built ready-but-not-activated. |
| Admission manifest | `dsh-plugin.json` (repo root) | ONE bundle-level Community v0.15 manifest for the whole bundle — a deliberate deviation (see §7). |
| Environment descriptor | `dsh-distribution.json` (repo root) | A `DistributionDescriptor` for the dsh-distribution meta-protocol (Draft). |
| TUI composition | `cordis.patch.yml` + `presets/mpd.patch.yml` | Adds the `mpd-tui` row and registers the **mpd** preset additively; the deployment default stays the host's (`standard`), so a TUI session starts on `standard` until `mpd` is selected (§2). |
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
— this bundle is the **third** patch layer; the two-file bundle patch layer declares **36** rows
(35 in `cordis.patch.yml`, 1 in `presets/mpd.patch.yml` — the row count `bun run verify:rows`
prints); the live boot
logged **0** apply-crash signatures (`unsupported JSON schema`, `JsonSchemaError`, `plugin tree
failed to load`, `failed to apply loader entry`, `Error:`); no duplicate loader entry id.
**Backed at:** `Observed` (a recorded live dsh-TUI boot plus the host's own `--dump-config`).
`--dump-config` alone proves composition only — the crash-signature count comes from the live boot.

A TUI session resolves the HOST's default preset, not `mpd`: the row that holds the deployment
`default` is declared by a host layer (`agent-preset-registry` by `@deepseek-ai/dsh-web-app` on the web
plane, `dsh-tui-agent-preset-registry` by `@deepseek-harness-tui/dsh-tui` on the TUI plane), and this
bundle ships no id-target against either — `node scripts/verify-no-host-override.ts` fails the build on
any id-target whose id a host layer declares, and the two id-targets that used to carry
`config.default: mpd` were removed under the strict zero-override decision of 2026-10-02 (the removed
blocks are recorded in `cordis.patch.yml`). `mpd` is therefore available but OPT-IN: `/preset mpd` in
the TUI (the host's `presetPrefs.js` persists it to `~/.dsh-tui/agent-preset.json`), an explicit
`preset: mpd` on the host's `dsh-tui` row (or `DSH_TUI_PRESET=mpd`), the Web Settings
`selectedDefault`, or the one-command helper `node scripts/set-default-preset.ts --yes` (dry-run by
default). Every channel is documented, with its trade-offs, in
[`preset-default.md`](preset-default.md).

Requirement for any live lane: `dsh-tui` refuses to boot when stdout is not a TTY
(`dsh-tui requires an interactive terminal (stdout must be a TTY)`), so the QA lanes must drive the
real TUI inside tmux and capture panes; this boundary is why the TUI lanes are **not** part of
`bun run test:qa`'s self-test sweep.

## 3. TUI surfaces and their web counterparts

The bundle's former web-only faces have TUI **equivalents**, not parity:

| Web surface | TUI equivalent | Backed at |
|---|---|---|
| Agent Teams panel (conversation header) | the **`tuiPanels` sidebar panel** — the primary entry point (§3.3) — with the `tuiScenes` full-screen surfaces as its FALLBACK (the rich `mpd-tui-team` scene for the page's own `⤢`, the merged subagents scene for the routed open), plus the `tuiStatus` keyed status line | registration + a host-ACCEPTED open measured on 0.13.0 — `evidence/tui/lanes/2026-10-06T10-27-53.571Z/` and `…/2026-10-06T10-28-57.807Z/`, where the id discovered from the host's own read-back is `act1:team`; the full-screen scene rendered in the 0.10.1-era live lane `evidence/tui/live/20260915T063140Z/result.json` (t8; 6 of 7 surfaces) |
| Workmate library tab | `tuiCommandTrees` (`/mpd …`) + `tuiDialogs` | same lane evidence |
| — | `tuiStatus` status line; the `tuiRenderers` transcript row is **not projected by the host** | status line rendered; renderer row **does not render** — see NOT-CLAIMED #10 |
| — | `tuiSettingsSections` (`/settings` section for the mpd.jsonc knobs) | rendered — same lane evidence; the section states the **bridge** to `<workspace>/.mpd/mpd.jsonc`, the live-refresh truth for the model routes with a captured knob still waiting for a boot, and the never-lost clause (§6.2), and the lane asserts that disclosure text (`allPatterns`) |
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

**0.14.0 changes none of the fifteen.** The plugin-facing seam modules under the host's
`lib/types/dsh-adapter/` — `panels`, `scenes`, `status`, `renderers`, `settings-sections`,
`shortcuts`, `dialogs`, `command-trees`, `plugin-host`, `toast`, `themes`, `plugin-storage`,
`message-observer`, `effect-ledger`, `workspaces`, each `.js` + `.d.ts` — are **byte-identical**
between 0.13.0 and 0.14.0, there is no sixteenth seam, and the harness `peerDependencies` range is
unchanged (it still ends at `0.2.0-rc.2`), so `MPD_E2E_DSH_VERSION` does not move: **no adapter code
change was needed for the seam surface**. §11.6 records what 0.14.0 does change.

### 3.1 The Web GUI settings UI (Settings → MPD)

The same knobs the shared schema declares — the original 13, the twelve `teamModels` slot leaves
(rendered as dependent model + effort pickers) and the TUI surface's own switch — are editable in the
Web GUI. The thirty-three `agentRoutes` leaves are **gone** with the per-member override layer
(`.mpd/plans/slot-single-source.md` §3): neither the Web card nor the `/mpd-model` dialog shows a member
override table any more, a leftover block in an existing `.mpd/mpd.jsonc` is ignored and never rewritten,
and `/mpd-model` asks slot → provider → model → reasoning effort only, writing `teamModels.<slot>`.

**Settings → MPD** is its own top-level section of the settings dialog — it no longer lives inside the
Plugins tab. The section registers the way the
host's own sections do (`ctx.slots.inject("settings.section", …)` →
`ctx.slots.register({ name: "settings.section", id: "mpd", order: 20, label: () => t("nav"), locale, inject }, Section)`,
the shape measured from `dsh-client-ui-settings-models/lib/client.js:2936`): the settings shell
collects that list slot, sorts it by `order` and renders the active one, so `order: 20` places MPD
after `general` (0), `models` (10) and `plugins` (15) and moves no existing section. The section
renders the card as-is, declares no nested `children`, and a namespace with no registration renders
nothing — which is why the knobs were invisible before. Writes go through the harness's own config
form for the `mpd-config` entry document (`ctx.configForms.get("mpd-config")`), not a
`settingsScope` binding, and an unwritable form renders read-only with the reason and never attempts a
write. The card's fields, labels and zh descriptions are asserted against the TUI section's descriptor
by its own test, so the two front doors cannot drift.

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
`mpd` section with the schema's knobs (the team-model slots offer catalog-derived selections), change
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

### 3.3 The sidebar panel seam — the primary entry point, and its honest bound

`packages/mpd-tui-plugin/` registers **THREE** right-sidebar pages through the `ctx.tuiPanels` seam —
`src/panel.ts` (slug `team`, title `MPD`, one-cell icon `❖`, `order` 10) with the **rich merged** body
(the host's own curated subagent snapshot rows ABOVE the MPD dependency DAG for the calling session's
own team (§3.4), inside the DAG page's own frame, header + progress, legend, key-hint footer and
click-to-pin detail body), `src/panel-workmate.ts` (slug `workmate`, title `MPD workmate`, icon `⬢`, `order` 12,
described in §3.4) and — since the 2026-10-23 watchdog wave — `src/panel-watchdog.ts` (slug
`watchdog`, title `MPD watchdog`, icon `⚠`, `order` 13, `minColumns` 28). The watchdog page renders the
team watchdog's durable state: per team its **held state and phase**, the `mpd-tui` unread count and the
recent incidents (kind, relative age, team / task / attempt, cause with `ms`, hold outcome and ack
state), with `a` acknowledging up to the newest incident shown (advancing ONLY the `mpd-tui` watermark,
once per press), `r` refreshing and `↑↓` / `jk` (plus `PgUp`/`PgDn`/`Home`/`End`) scrolling. Its data
source is the `mpdWatchdog` service through this package's own front door — never the
`.mpd/team/watchdog/*.jsonl` files — so a missing service renders the explicit
`watchdog: not available` state, no incidents renders an explicit empty state, and no render path
throws. `/mpd watchdog` opens it through `openPanel(handle.id())`; the page has **no full-screen
fallback** (no scene draws the incident list), so an absent panel seam is REPORTED in one line instead
of being routed to a different surface. The page also raises its OWN badge (a hold is a `warning`, an
unread incident an `info`) from the apply-side attention surface, which re-takes it on a 5 s poll as
well as on every team-feed event — a hold is raised by the watchdog's own timer and touches no team
record, so the feed alone would never announce it. **The page this section used to describe — `src/panel-dag.ts`'s standalone
`dag` page — was RETIRED by the 0.14.0 wave and merged INTO the MPD panel** (the user's clause
「DAG页作为MPD面板」, recorded in §11.6): ONE descriptor, ONE slug and ONE ordered position collapsed out
of the two, and the DAG page's rendering is what the surviving slot renders. **Nothing a user can reach
became a dead end**: `/mpd dag` re-aims onto the MPD panel — the DAG page IS that panel — while
`/mpd panel`, `/mpd subagents` and `alt+a` already routed through the same slot (the legacy `Ctrl+A`
host-input contact is INERT on a host that offers this seam, and where it does arm — an old host — it
opens the merged subagents scene exactly as before).
All three pages are `apiVersion` 1, none declares **`compact`** — the host validates and stores a
descriptor's `compact` slot but does not mount its render slot, so declaring one would claim a surface
that cannot render — and all three ask for **`minColumns` 28**, the host's own floor. The final panel id is
**discovered from the host's own `list()` read-back**, never composed: `<pluginId>:<slug>`, measured on
the real host before the merge as `act1:team`, `act1:dag` and `act1:workmate`, where that plain loader row
the host prefixes carries no Component identity. The recorded set is what ACTUALLY registered, so it now
carries the three current ids — `team`, `workmate` and `watchdog` — and not the retired `dag` page.

**The reachability rule — the two host switches, which the bundle cannot set.** A registered page is not
a visible page. On the installed host the enable list lives in the host's OWN row config
(`dsh-tui.sidePanel.panels` — `todo,jobs,agents` on 0.13.0, and
`todo,jobs,agents,info,trajectory,workspace,btw,companion` on the 0.14.0 target, §11.6) and a
well-formed id no panel claims yet stays
in that list for a plugin that registers it later, while the sidebar itself starts CLOSED
(`sidePanel.open` default `false`). Both are host-owned, and a bundle patch row may never id-target a
host-owned row, so the remedy is user steps, documented and printed by the command itself:

1. add the page's final id in `/settings` → side panel → *Enabled panels* (the id is discoverable from
   the host's `/panel ` completion list, or from the line `/mpd panel` / `/mpd dag` / `/mpd workmate` /
   `/mpd watchdog` prints);
2. open the sidebar — `Ctrl+B` — or turn on *Side panel starts open*.

**The enable list also has to survive the host's own config re-apply, and it now does, two ways.** The
host appends a successfully registered id itself (`enablePanelIdInStore`), but MEASURED at about **+5.4 s**
the `dsh-tui` row re-applies its config through a `Fiber._reload`
(`applySidePanelPanels(config.sidePanel?.panels)`), so the append is transient and a stock profile ends up
with the three builtin tabs. (Note what the reset actually does: it restores **whatever the config says**,
which is `todo,jobs,agents` only while the user layer is unset — a profile whose list names the page ids
settles WITH those ids and without the builtins.) Two independent routes now hold the list:

* **bounded, in the plugin, and since the 0.14.0 wave FOLLOWING the host's own change feed** —
  `packages/mpd-tui-adapter-plugin`'s settle keeper re-asserts only the ids the host's own `list()`
  read-back produced, and only when the list names **NONE** of them: it appends the whole set after the
  user's list, never reorders a token, and **prunes exactly ONE class of token** — this bundle's OWN panel
  ids from an EARLIER boot. **Since repair round R1 (CodeRabbit PR #35) that class is recognised by
  PROVENANCE, never by a slug**: a token is prunable only when its FULL id is in the bounded history of
  registrations the panel-id record proves this bundle made in earlier boots, and it is not one of the ids
  live now (the keeper's `list()` read-back). The host renumbers the `<pluginId>` half on every boot, so
  those dead ids accumulate in the list while the host's `SidePanelColumn` keeps building a tab and a dot
  for each one with no panel behind it (the reported mismatch, D1); the prune is what removes them.
  **Nothing else is ever removed**: a host builtin and any id this bundle has never heard of come back
  byte-for-byte. The two limits the old slug rule had are both gone with it: a **foreign** panel that
  merely SHARES one of our slugs (the host can produce `act9:team` beside our `act7:team`) is not in our
  recorded history and is therefore never pruned, and a token whose page was **retired or renamed** IS in
  that history, so its orphaned tab is cleaned up like any other dead id. One bound remains and is named
  rather than hidden: a **foreign DEAD** id lingering in the list is not ours to clean, so it stays. The
  write is then **READ BACK**
  through the host's own reader and compared with the list the keeper intended; a store that did not carry
  the write settles as `refused` and names both lists, instead of reporting a success the sidebar does not
  have. A list naming **ANY** of ours is a configuration
  that has taken a position on the bundle — enabled in `/settings`, written by the script below, or a
  deliberate partial removal — and the keeper **stands down**, so it never puts back a page the user
  meant to drop. **Standing down does not protect a dead token (R1.3)**: when such a list also carries an
  id from the recorded history that is not live, the keeper **prunes that id first and appends nothing**,
  then stands down — the user's SELECTION is what is respected, and a token no panel can answer is not
  part of any selection. **The 0.14.0 wave replaced the bounded tick ladder with the host's OWN
  subscription**
  (`subscribeSidePanelPanels`, the live-setting store's change feed): the keeper now repairs a wipe the
  moment the host re-applies its config instead of losing the race after ~25 s, and the ladder survives
  only as the degrade path for a host that exposes no feed. The subscription is released with the
  injected scope (a hot reload leaves no listener), never throws on a host without the module, and the
  stand-down rule is unchanged: **our own write contains our ids, which is what ends it**. That is the
  adapter's SECOND host-internals contact, alongside the `Ctrl+A` `useStdin` reach (AGENTS.md §6 counts
  this class, so both are named in that file), and the ids it discovered are recorded to
  `<workspace>/.mpd/logs/mpd-tui-panels.json` — schema **3**, which adds the bounded `history` field
  (the last 32 past registration ids, newest last) that the provenance-owned prune reads; a record that
  cannot be proved contributes no history at all, so a polluted file cannot widen what may be deleted.
  Residual, named rather than hidden: removing **ALL** of
  ours on purpose leaves a list indistinguishable from a fresh profile's, so the set is re-added once per
  boot; separating those cases needs the configured value itself, i.e. a third host-internals contact,
  which is a §6 count decision this wave deliberately does not take;
* **never drops a builtin, and never overrules a list** — the row's `sidePanel.panels` REPLACES the
  host's default rather than extending it, so `scripts/mpd-tui-panels.ts` seeds an ABSENT leaf from the
  host's own current `DEFAULT_SIDE_PANEL_IDS` (read from the installed module; the run REFUSES rather
  than guessing "none" when that cannot be read) and leaves an EXISTING leaf BYTE-FOR-BYTE — including
  one that names none of the builtins, because "every builtin is missing" and "the user removed every
  builtin deliberately" are the same bytes. Putting missing builtins back is therefore an explicit act:
  `--restore-builtins` restores exactly what is missing, prints what it restored, and is a no-op on a
  healthy list;
* **durable, one command** — `node scripts/mpd-tui-panels.ts --apply` writes `dsh-tui.sidePanel.panels`
  into the
  profile's patch file, which IS the settings user layer (`dsh-config-editor`'s `documentPath` returns
  `profileContext.patchPath`; `dsh-app-boot` builds it as `<profileDir>/cordis.patch.yml`) — AND, since
  the 2026-10-16 amendment, into `~/.dsh-tui/settings.json`'s `values.sidePanel.panels`, the layer
  dsh-tui 0.15.0 reads FIRST (effective list `values.sidePanel?.panels ?? config.sidePanel?.panels`, so
  the settings document SHADOWS the patch; `--tui-settings <path>` points it at a fixture, an absent
  document keeps the run patch-only). The SAME computed list — one shared merge, seeded from the
  EFFECTIVE value — lands in BOTH layers, every guard unchanged, and the settings document is rewritten
  as JSON (2-space indent, trailing newline) preserving every other key including the one-time-import
  `imported` marker. Both readings
  come from the installed sources and the script refuses to write when it cannot prove the path; dry run
  by default, `--apply` to write, `.bak-<stamp>` kept per layer, only missing ids added **and the same stale-id
  prune applied** (one rule, restated in `scripts/mpd-tui-panels.ts` because a standalone Node entry point
  cannot import a bundled package's source — and since repair round R1 that rule is the PROVENANCE one:
  the script prunes a token only when the record's `history` proves the bundle registered it and this run
  does not enable it, so a foreign `act9:team` is never deleted). A run whose only change is the prune is
  a run, not a no-op.
  `--apply` also **reads the document back** after the atomic rename and compares the leaf with the CSV it
  intended — per layer, so a refused settings write can never be announced behind a landed patch write: a
  mismatch exits 1 and names the backup, so a write that did not land is never announced as a
  success. It writes the USER's
  profile patch and settings document and nothing in this repository, so it is not part of any gate sweep — the wave that has
  to re-pin the vendored skill corpus is the one that edits `skills/**`, whose `treeSha` in
  `VENDOR_LOCK.json` lands with exactly ONE re-pin in the same commit (AGENTS.md §9); this command never
  touches either.

**THE RECORD IS ONLY AS TRUSTWORTHY AS ITS PROVENANCE — and that was a MEASURED defect, not a worry.**
`.mpd/logs/mpd-tui-panels.json` was overwritten on 2026-10-08 with `act0:team,act0:dag,act0:workmate`,
ids the installed host cannot compose: its `pluginIdFor` fallback counter PRE-increments, so the first
bare activation is `act1` and `act0` is impossible in a real boot. A UNIT TEST run (whose panel-seam
double labels its registrations `act0`) had driven the real recorder, and the remedy script reads that
file to offer a write into the user's settings layer — so a test run could make the remedy name panels no
boot can ever serve. The 0.14.0 wave fixed the WRITE side: the record carries
`provenance {hostRoot, hostVersion, readBack, activation}` and the recorder REFUSES to build one it
cannot trace to an installed host package and a host read-back (measured: a full
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` run leaves the file's sha256
unchanged). **Repair round R1 (CodeRabbit PR #35) made that provenance load-bearing for the PRUNE too, and
grew the record to schema 3**: alongside `panelIds` it now carries `history` — the bounded list (last 32,
newest last) of ids this bundle provably registered in earlier boots, which is the ownership evidence both
writers prune by. The fold is read-side guarded as well: the previous record's history and its own ids are
carried forward only when that record passes the provenance rules, so a polluted file contributes NO
history instead of propagating ids a real boot cannot compose. A blank field counts as absent on BOTH
sides of the file. **The READER guards the same proof, so a polluted record cannot reach a user's profile
patch:** `scripts/mpd-tui-panels.ts` REFUSES — the dry run and `--apply` alike, exit 1 — a record that
carries no `provenance`, a blank `provenance.hostRoot`, a blank `provenance.hostVersion`, no
`provenance.readBack`, or the impossible
`provenance.activation === "act0"`, naming the field that failed and telling the reader to boot the TUI
once or to pass `--ids <a,b,c>`. A refused record contributes no past ids either, so it cannot widen the
prune. Measured on the polluted version-1 record: the dry run prints
``REFUSED: … it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)``
and exits 1, the record's sha256 is unchanged by the run, `--ids act1:team,act1:workmate` is accepted (the
escape still works), and the script's own `--self-test` passes with one arm per refusal shape plus a
well-formed record accepted. A dry run prints the ids it read, their file and the past ids the prune would
use, so the user sees what would be written before `--apply` writes anything.

Measured without them: the bar reads `‹ 待办 › ▸ ◆` and the host's live enable list is
`toggle, focus, zoom, todo, jobs, agents`. Measured with them, at 120 columns, on the THREE-page set this
wave replaced: the bar carried `‹ MPD ›`, `‹ MPD DAG ›` and `‹ MPD workmate ›` and the page body renders
(`evidence/tui/dag-port/verification/pty/frozen/`). **After the merge the bar carried TWO MPD tabs** —
`‹ MPD ›` and `‹ MPD workmate ›` — and both routes above still resolve (see §11.6 for the wave's own
record). **With the 2026-10-23 watchdog wave a third MPD tab can join them** (`‹ MPD watchdog ›`) once
the host's enable list names its discovered id; the two host switches above apply to it unchanged. The panel column exists only where the host splits — the same capture reports `split=false` at 80
and 48 columns, so no page can be visible there whatever the list says.

`alt+a`, **`/mpd panel`** and **`/mpd subagents`** route the MPD panel through `tuiPanels.open()` while
the seam is bound, **`/mpd dag`** re-aims onto that SAME panel (the DAG page is what it renders), and
**`/mpd workmate`** routes the workmate page, and **`/mpd watchdog`** routes the watchdog page — the one
page with no full-screen surface behind it, so a host without the panel seam gets the absence stated in
one line rather than a different surface pretending to be it. On **any** refusal — the one-open-per-plugin-per-5000 ms
rate limit, an id the host no longer owns, or no live panel consumer — each route falls back to a
full-screen surface and the printed line names the surface actually reached; nothing on that path is a
silent no-op. The fallbacks are per route and deliberately not one scene: the MPD panel's own `⤢` opens
the **rich team scene** (`mpd-tui-team` — frame, legend, the focused task's detail pane, key hints) so a
reader never falls from a rich page into a bare one, while the MPD panel's ROUTED fallback stays the
merged subagents scene (`mpd-tui-subagents`), which is the honest surface for the host's own rows.

**Backed at `Observed`:** the registration, the ids discovered from the host's read-back, and the
host-ACCEPTED open, recorded on a real PTY by
`evidence/tui/dag-port/verification/pty/frozen/` (the three MPD tabs of the PRE-merge set in the bar at
120 columns, with the `split=false` arms at 80/48) and by the earlier 0.13.0 lanes
(`evidence/tui/lanes/2026-10-06T10-27-53.571Z/` and `…/2026-10-06T10-28-57.807Z/`), each with its own
negative control red as required.

**BOUND — MPD cannot observe a RENDER, and says so.** The host's `tuiPanels.open()` returns `true` when
the request was DELIVERED, while its own `useSidePanel` silently DROPS a request whose id is not in the
enabled list; and the host's `TuiPanelEvent` set is `registered|unregistered|badge|error|disabled`
(`opened`/`focused` are an explicit host TODO). The plugin therefore prints only what it knows — *"the
host accepted {id}; if no panel appeared, add {id} to the panel list in /settings → side panel, then
press Ctrl+B (or turn on \"Side panel starts open\")"* — instead of claiming an open. The page BODIES
are asserted by the unit suites and by the pinned real-PTY capture, never by the plugin's own branch.

### 3.4 The MPD panel — the rich DAG page — and the workmate page

The MPD panel renders the CALLING SESSION's own team dependency DAG — never the workspace's latest one
(the session-scope bullet below) — with the host's curated subagent rows ABOVE the drawing, inside ONE
rich frame the pre-merge merged page could not afford: a bordered frame, a header naming the team and
its progress, the drawing, an explicit legend, a footer naming the keys it handles, a status badge and a
pinned detail body. (Until the 0.14.0 wave this was the standalone `dag` page beside a plainer merged
page; the two are ONE page now, §11.6.)

**This panel's `⤢` opens the rich team scene, not a bare one.** The page's own control calls the
`mpd-tui-team` scene — the same frame, legend, focused-task detail pane (the pin's full-screen form) and
key hints the page draws with — which is the user's clause 「全屏出来的MPD也要有这种富外观」 made
concrete. The host's own `⤢` is still unreachable for a plugin panel (§11.6's re-measured bound), so this
control is MPD's and it is declared on the page itself.

- **The drawing is THIS SESSION's team — the workspace's latest one is never substituted for it.** The
  defect the user reported (「我new了一个session，老session的DAG图还摆在那儿」) was that a surface picked
  the newest not-ended team of the WORKSPACE; it is fixed. Every surface that draws team state (this
  page, the team scene, the merged scene, the plan scene) reads its OWN session id — the page off
  `host.snapshot().sessionId`, the field it used to read and discard, the scenes off
  `props.channel.sessionId` — and resolves through `mpdTeams.active(workspace, sessionId)`, with the
  record's own `leadSessionId` as the degradation when the service exposes no `active`. The reader
  reports WHICH of THREE states it answered with (`TeamWorkflow.source.scope`), and the renderer draws
  that state rather than a guess: **`session`** — a session id was readable AND a team resolved for it,
  so that team's DAG and nothing else; **`none`** — a session id was readable and this session has NO
  team, drawn as the marker `no team in this session` plus how many teams the workspace holds, **never
  another session's board**; and **`workspace`** — NO session id was readable (an older host, a
  keypress-time read), which keeps the old workspace-principal rule but marks it `workspace-level`, so
  a reader can tell it is not necessarily their own board. Both markers are constants in
  `src/team-state.ts` (`NO_SESSION_TEAM_MARKER`, `WORKSPACE_SCOPE_MARKER`). The WEB tab was already
  session-scoped (`?sessionId=`) and lists the workspace's teams when the session has none; only the
  legacy `Ctrl+A` status view cannot be scoped — a status view receives no `host` and no `channel` — so
  it keeps the marked workspace-level behaviour by construction.
- **The surfaces update by PUSH, and the timers stay as the fallback.** Every surface that draws team
  state subscribes to the workspace's team feed — `mpdTeams.subscribe(workspace, listener)`, the
  substrate `mpd-team-core` also serves over the SSE route `/plugins/mpd-team/events` — and disposes it
  on unmount. Measured on a real dsh-tui 0.14.0 PTY: a record rewrite under an OPEN, untouched sidebar
  reached the terminal in **76–85 ms** across six trials
  (`evidence/tui/session-scope-and-push/2026-10-08T08-22-12Z/pty-latency/`) — a 0.14.0-era record. AT
  THAT MEASUREMENT the fallback tick was **1000 ms** (`DAG_PANEL_REFRESH_MS`), and six samples inside a
  9 ms band at ~80 ms is not tick sampling. The feed watches the teams directory, so a change made by
  this session's agent or by ANOTHER PROCESS is seen; the LIVE cadence is stated once, in §3.5 — one
  **2000 ms** tick on every MPD surface, the fallback for a composition without a feed. No `mpdTeams`
  row, no `subscribe`, or a throwing one costs the push and never the page.

- **Vertical and adaptive.** Rank is the VERTICAL axis (top→bottom) and every size is computed from the
  panel the host measured — there is no fixed pixel or cell constant deciding the layout, which was the
  user's explicit decision for this wave (纵向，但不要固定尺寸). `boxes`, `rail` and `list` are the
  three renderings (the rank-grouped `list` with progress bars had no caller before this page), and the
  page picks one from the width it was actually given rather than asking the host to widen the column.
- **Rank is DERIVED from the dependency graph, never trusted from a served `depth`.** A board whose
  blocker references resolve to nothing used to collapse into one silent column with no edges — the
  defect the user reported — so the drawing computes rank itself and reports which source drew it
  (`view … · ranks derived` versus `· ranks served`) and lists blocker references that name no task
  (`unresolved blockers: …`).
- **Six states, one palette.** `completed ✓ / running ◐ / failed ✗ / blocked ○ / cancelled ⊘ /
  open ○`, mapped to host theme keys in ONE table (`success`, `activity`, `error`, `warning`,
  `inactive`, `subtle`); the WEB view's hexes are kept as provenance, not as styling.
- **The legend is what disambiguates `blocked` from `open`**, which share the glyph `○` by design — the
  WEB reference has no legend at all. Clicking a task pins a detail body with ten facts
  (`id`, `kind`, `visual`, `verdict`, `failedBy`, `owner`, `attempt`, `round`, `blockedBy`,
  `dependents`), and `↑↓/jk`, `Enter`, `Esc` move, pin and unpin. **Hover is deliberately absent** — a
  terminal has no pointer-move and the user dropped it.
  **There is ONE state key now, and it is this legend's own (user requirement
  「删除TUI DAG界面的多余图例（目前有两行）」).** `panel-core.ts`'s `legendLinesFor` composes it from the
  frozen six-state contract (`DAG_STATE_TONES` + `DAG_TONE_GLYPH`) and names all six states, so
  `blocked` and `open` are told apart by the twin each entry carries; `graph.ts` carries no state key of
  its own — its own five-state key (`LEGEND_STATES` / `LEGEND_SHORT` / `LEGEND_KEY`) was DELETED with
  the redundant row, because it omitted `blocked` and printed under the contract's key it was the same
  legend a second time.
  **The accumulating-legend defect (user report 「越点越多直到撑爆屏幕」) was a duplicate React KEY, and it
  is fixed and pinned (§11.6).** The legend's rows were keyed `legend-${line.slice(0, 24)}`, and the
  drawing's own state-key line — the one deleted with the redundant row — and the legend's first
  wrapped line both started `✓ completed · ◐ running` — so two children shared one key, and React
  rendered the collided row once more on EVERY re-render. Measured on a mounted instance: **4 legend
  rows after mount, 7 after seven clicks**. The key is a position now, and the arm that keeps it fixed
  asserts the legend ROW COUNT is stable across N clicks rather than that a legend exists.
- **A node reads `<marker> <id>` and nothing else** (`✓ T3`, and `▶ T3` for the task in focus). The
  subject is NOT in the drawing; it is verbatim in the pinned detail body, where a Chinese sentence
  reads as a Chinese sentence instead of being squeezed into printable ASCII. Removing it is also what
  lets a rank of three nodes fit a 40-cell sidebar.
- **The box is the compact three-row form** (top border, content, bottom border) with the ROUNDED
  corners. One form per drawing, so two boxes in one rank can never have different heights.
- **Every blocker → dependent edge is drawn, at ANY rank distance.** A long edge is routed through a
  LANE — a column no box of the intervening ranks occupies, appended to the right of the drawing when
  every column inside it is taken — with one horizontal jog in the connector band below the blocker and
  one in the band above the dependent, so the run is continuous from the blocker's bottom border (`┬`)
  into the dependent's single `▼`. A fan-in still shows exactly ONE arrowhead per dependent, because
  every converging parent writes that one cell.
- **An EMPTY rank bucket consumes no rows.** A served rank ladder with holes in it (0, 2, 4 — what a
  host whose `depth` is a plan ordinal serves) is COMPACTED for the drawing, so two boxes that are one
  rank apart stand one connector band apart and no edge has to cross a rank that holds no box. The
  plan's own buckets keep their holes: `rankPlan`/`bucketRanks` are shared with the web plane, so the
  compaction lives in the drawing.
- **A click resolves through the drawing's own hit rectangle, COLUMN included.** Both boxes of a rank
  share one row band, so a row-only lookup pins the leftmost box of that rank — measured, and the
  reason a user clicking a task watched the highlight land on its neighbour. The pointer's own column
  (plus the current pan offset) selects the box; a click that lands on no box clears the pin.
- **The highlight is visible without colour.** With a pin held, the pinned task and every task on its
  upstream dependency chain render BOLD, and everything else renders in the muted tone AND with the
  host's `dimColor` flag — because the dark theme's `inactive` and `subtle` are close enough that a
  colour-only grey-out is invisible.
  **The CONNECTORS are never dimmed.** A box and its label may mute, but an off-chain line keeps the
  drawing's visible connector tone (`edge`, the `promptBorder` key) instead of `inactive` + `dimColor`:
  the two greys above read as one, which is how the user's lines "disappeared" a second time with a
  task pinned. The chain's own edges stay the loud `chain` tone.
- **Clicking the pinned task a second time opens that member's work page**: MPD's full-screen
  subagents scene, positioned on the detail view of the task's owner. The owner (`assignee`) is matched
  against the host's curated subagent rows; when nothing matches, MPD says so through the host's toast
  and the scene opens on its list — never a silent no-op.
- **Both scrollbars drag.** The vertical gutter and the horizontal rail scrub under a mouse drag
  through the SAME absolute track arithmetic a click uses (no grabbed-thumb offset). Click, wheel and
  keyboard gestures keep working; a host that ignores the drag props simply does not drag.
- **Each MPD page draws its own chrome: a distinct one-cell icon and a clickable `⤢`.** The TWO
  surviving icons are `❖` (the MPD panel, which used to declare NO icon and fall back to the letter `M`)
  and `⬢` (the workmate page, which used to wear `◆` — byte-identical to the host's own `agents` tab, so
  it was not a distinct symbol at all). The retired DAG page's `◈` is declared by nothing now. Each icon
  measures exactly one cell under both this
  bundle's `cellWidth` and the host's `stringWidth`, because the host REFUSES a registration whose icon
  is not one cell. **The icon is still REQUIRED and still declared even though 0.14.0's carousel
  `PanelBar` no longer paints it** (§11.6) — dropping it would turn a silent host change into a refused
  registration. The `⤢` opens that page's own full-screen scene, and it is MPD's own control
  because the host cannot draw one for a plugin panel — §11.5 records the measured reason and §11.6
  re-measures it on 0.14.0, and the
  real-terminal capture in `evidence/tui/dag-highlight/` shows the glyph on the page's title row.
- **OPT-1 (user decision, 2026-09-13): a FAILED dependency does NOT block its dependents.** They stay
  `open` and dispatchable, and the failure is reported BESIDE the state (`failedBy`), never folded into
  `blocked`.
- **The workmate page** renders the durable workmate library (`$HOME/.mpd/workmate/<key>/`) as its own
  page because that library is a per-USER shelf rather than a per-workspace team. It is read-only by
  construction (mutation stays in `mpd_workmate_*`), it contains every filesystem failure to a row or a
  field, it sorts newest-updated first — the same order `mpd_workmate_list` serves — and its empty state
  names the call that fills it (`mpd_workmate_init`).

**Bounds, stated as limits.** Not ported from the WEB view: hover, its pixel geometry (fixed `168px`
columns, `42px` nodes), CSS ellipsis, `overflow:auto`, native tooltips, DOM reads and `fetch` polling —
none has a terminal equivalent, so none is faked. The WEB DAG remains the semantic reference and was not
modified beyond the rank-derivation and edge-routing repairs its own legibility required.

### 3.5 Refresh cadence, repaint recovery and mouse input

**Every MPD TUI surface refreshes on a fixed 2-second tick.** The merged sidebar panel
(`DAG_PANEL_REFRESH_MS`), the workmate page (`WORKMATE_PANEL_REFRESH_MS`), the board/team scenes and
the subagents scene all use the same cadence; the sidebar panel used to be the only 1-second surface.
The TUI reads a **local, synchronous** projection (`readDashboardWorkflow`) — `mpd-tui-plugin` makes no
HTTP or `EventSource` call — so the tick is a **repaint self-heal** (a lost cell, a slow terminal, a
frame the host drew half of), never a data-fetch retry. A damaged frame repairs itself within two
seconds, and a panel is never left showing the moment it was opened.

**The sidebar draws the DAG whenever two node columns fit, and the WINDOW is what fits.** A boxed
drawing is chosen when the panel can show two node columns of it (`2 * nodeWidth + NODE_GAP`, the
`boxesFitWidth` test) or when the whole drawing already fits; a drawing WIDER or TALLER than the panel
is reached through the page's own horizontal pan and vertical scroll, whose position the footer names
(`col n/m`, and the row token above it). Only a panel too narrow for two node columns falls back — to
the dense list when the board carries more than `LIST_ROWS` tasks, otherwise to the rail — and the
full-screen team scene obeys the same rule. The whole-drawing fit rule this replaces (commit
`95c836b9`) traded the graph away for a fit: a 20-task board rendered `view rail` with no dependency
lines at all, and a short window dropped the lines from a 5-task board. A box that would straddle the
window's edge is drawn whole or not at all, the vertical bar's cell is reserved out of the content
width, and the page's title is drawn **once** (the title row, which also carries the `⤢` control).

**When the screen looks wrong:**

- **`Ctrl+L` forces a host repaint.** dsh-tui clears and redraws; use it when cells are missing after an
  SSH reconnect, a resize the host never saw, or a terminal that dropped a frame.
- **`r` recovers a full-screen graph.** The full-screen team scene clamps its vertical window at the
  last row, so `End` and a long wheel run stop at the bottom instead of sliding the drawing away; `r`
  re-reads the record and returns the window to the top, and `Home`/`g` returns without a re-read.
- **`DSH_TUI_DISABLE_MOUSE=1` disables the in-app click and selection handling ONLY.** On the pinned
  host dsh-tui 0.16.1 `lib/types/utils/fullscreen.js#isMouseClicksDisabled` feeds
  `App.js#handleMouseEvent`, which RETURNS before its click branch and leaves wheel scroll intact, while
  `AlternateScreen.js` enables mouse reporting unconditionally — so mouse REPORTING and WHEEL scrolling
  stay explicitly ACTIVE with the flag set, and it is not the remedy for a wheel the shell consumes
  (send that to the terminal / tmux / fullscreen lever instead, see the tmux bullet below). Keyboard
  gestures — the focus walk, the scroll keys, `Esc` to unpin, `⤢` to open the scene — keep working.
- **tmux:** keep the pane's size honest with `set -g aggressive-resize on`, and give the host a UTF-8
  terminfo with `set -g default-terminal 'tmux-256color'`. Outside tmux, `TERM` must name a UTF-8
  capable terminal (e.g. `xterm-256color`) and the locale must be UTF-8 (`LANG=…UTF-8`) or the CJK width
  measurement is wrong; the font must carry the box-drawing set this drawing uses (`╭ ╮ ╰ ╯ ─ │ ▼ ◐`) and
  the panel's own glyphs (`⤢ ❖ ⬢`), or the terminal substitutes a fallback box.
- **The sidebar's wheel is clamped to the panel.** The wheel is bound on the panel's frame as well as on
  its content, and the frame stops the event: a wheel over the title row, a border or the footer scrolls
  the panel and never the chat behind it.

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

### 6.2 The `/settings` section IS bridged — an entry save is host-persisted with NO workspace write; the legacy namespace write-back is named and dormant here

The section declares the real mpd.jsonc knobs (`hashline.maxDiffChars`, `commentChecker.autoCheck`,
`ulw.maxRounds`, `memory.vcs`, `team.stateDir`, `boulder.dir` and the twelve
`teamModels.slot{1,2,3,4}.{provider,model,reasoningEffort}` leaves) as this row's config, through the
harness's own form for the config ENTRY `mpd-config` (`packages/mpd-config-plugin` owns the entry; this
package is a pure consumer and registers only a guarded fallback when no config plugin is composed).
**TWO persistence paths exist, and only the dormant one writes your file:**

- **Entry-config save — what both front doors do on this harness.** The Web card and this section save
  `configForms.get("mpd-config")`; the entry document is the HOST's own store, so persistence is the
  host's. The saved override is the top config layer (L4, `readEntryConfig`) and
  `onSettingsDocumentUpdated(ENTRY_CONFIG_ID)` re-loads it in-process — **no restart** — and this path
  performs **NO `<workspace>/.mpd/mpd.jsonc` write**, deliberately: the document also carries the
  form's materialised defaults, so projecting them into your file would pollute it.
- **Legacy `mpd`-NAMESPACE write-back — dormant here.** `packages/mpd-config-plugin` still implements
  it (lock + compare-and-swap + sibling temp file + atomic rename, comments/key order/trailing commas
  preserved, with the two named skip cases). On the harness this bundle pins, `settingsRegister` is
  refused ("the namespace-registry model is RETIRED in this harness"), the bridge records that once,
  and its file write-back and override clearing stay **dormant**. Everything below — the base table, the
  write-back bullet and the workspace-target bullet — documents THAT path; it is not a promise about an
  entry save.

What a save does today (the entry path):

**The base is a rule, not a lookup — and it is the LEGACY namespace's base.** The serving package
derives the namespace base itself (`baseForNamespace()`, registered through the adapter)
under a cardinality rule:

| Live session roots | The namespace base |
|---|---|
| **exactly one** | that workspace's `<workspace>/.mpd/mpd.jsonc` — the normal path |
| **zero** | the **mount-time** (exec-less) root — `DSH_WORKSPACE_ROOT` or the process cwd — the only root that exists before any session does; an absent file there yields an **empty base**, i.e. effectively the schema defaults. Because `mpd-config`'s row position usually precedes any live session, this is the **normal boot path** |
| **more than one** | **no file base is invented**: `base: undefined`, reason `ambiguous-multi-root`, a warn naming every candidate, surfaced by `states()`. The namespace shows the schema defaults until exactly one workspace is live; a save in that state is REFUSED (below), so the ambiguity cannot reach disk |

**The base is fixed for the process lifetime** — the host exposes **no disposal handle** for a live
registration, and its own settings installers keep their base fixed the same way. A fixed base does
**not** make every saved knob wait for a restart, and the no-restart wording must not be read as
blanket: the config service is live (it re-resolves on every settings save and on a watched edit of
the project file), and each knob's answer depends on WHERE its consumer reads it. Read from the live
service per use — LIVE, no restart: `teamModels.slot*`, `modelchain.*`, `team.stateDir`,
`team.gate`, `team.sensitivity`, `captain.investigation`, `delegation.gate`; `watchdog.*` is live too,
but from the ROW's own read of `<workspace>/.mpd/mpd.jsonc` (it does not read the `mpd-config` entry, so
a FORM save does not reach it — user-guide §9.1); `tui.dashboardKey` is
live in BOTH directions while the `mpd-tui` ROW config left the Ctrl+A takeover enabled at mount (a
saved `false` and then a saved `true` both reach the per-press read), and ONE-WAY only when the ROW
config disabled the takeover (`dashboardKey: false`): that composition never registers the contact at
`apply()`, so a saved `true` cannot create one and a boot with the row config permitting it is what
does. Captured inside a row's own
`apply()` — RESTART, the captured value keeps until the next `dsh` boot: `hashline.*`,
`commentChecker.*`, `ulw.*`, `memory.*`, `boulder.dir`, `goal.*` and `extensions.*`. The bundle's own
hint constants state both halves — `BRIDGE_DISCLOSURE` (the live clause, naming the model routes) and
`BRIDGE_RESTART_LIMIT` (the bound) — and the **canonical per-knob table is
[`user-guide.md`](user-guide.md) §9.1**. What the plugins actually use is the **resolved value** plus
the config layer's **per-call file reads**: the L1/L2 file layers are re-read on every resolution, so
the **per-workspace read-in still resolves each session's own file** even while the base is frozen. No
sentence on this page promises a live-refreshed **base** — only a live-resolved **value**.

- **Read-in precedence** — L0 schema defaults < L1 `$DSH_HOME/mpd.jsonc` < L2
  `<workspace>/.mpd/mpd.jsonc` < **L3 the settings user section**, which is authoritative at runtime; a
  later FILE edit **unsets** the overlapping settings leaf, so the file's new value wins again and
  neither direction silently loses.
- **Write-back (legacy namespace path — DORMANT on this harness)** — owned by
  `packages/mpd-config-plugin` (never by this TUI package, which keeps its
  verified zero-write property). It triggers on the host's `settings/document-updated(ns, revision)`
  event filtered to `source === 'update'` (the raw-section event, so the deep-equal gate cannot drop a
  change) and writes the live session workspace's `<workspace>/.mpd/mpd.jsonc` under a lock plus a
  compare-and-swap on the raw bytes, a sibling temp file and an atomic rename. **Comments, key order and
  trailing commas survive**: a real boot rewrote `hashline.maxDiffChars` 20000 → 31415 in a JSONC file
  and the comment, the key order and the trailing comma were unchanged. None of this runs for an
  entry-config save (above).
- **Workspace target (legacy namespace path — DORMANT here)** — that path carries no identity, so the
  target set is the **live session
  workspaces at event time**: exactly one ⇒ that file is written; **zero ⇒ `no-live-session`**; **more
  than one ⇒ `ambiguous-multi-root`**, with every candidate named. In both skip cases **no file is
  changed** and the edit is **not lost**: it is stored in the host-global settings document and the
  config layer applies it to every workspace immediately — only the FILE WRITE waits for exactly one
  live session. The TUI status line and the Web card both carry that clause, where they mean the
  legacy path.
- **Timing** — the model-config consumers resolve through the live `mpdConfig` service per use
  (`mpd_modelchain_resolve` per call; slot routing at spawn), and the service re-resolves
  on every settings save and on a watched edit of the project file, so a saved edit **reaches the next
  resolve or spawn with no restart** (`mpd_config_reload` forces a re-read). Two different `applies`
  answers exist and must not be conflated: `BridgeReport.applies`
  (`packages/mpd-config-plugin/src/bridge.ts`) is typed `"live"` and records, per save, that the
  RESOLVED VALUE reaches the RUNNING process, while the NAMESPACE-level answer is `"restart"` on every
  surface that carries one — the service's own `states().applies` (D-18,
  `packages/mpd-config-plugin/src/index.ts`), `dsh.settingsRegister(…)` in `mpd-config`, and this
  package's `registerSettingsNamespace(…)` all answer/pass `restart` — because the namespace as a
  whole is not fully live: the knobs `BRIDGE_RESTART_LIMIT` names are captured inside their own
  `apply()`. The report's `live` therefore does NOT cover every consumer's behaviour, and the
  canonical per-knob table is the user guide's §9.1. The TUI section notice carries ALL THREE halves
  (`SECTION_NOTICE` = `BRIDGE_DISCLOSURE` + `BRIDGE_RESTART_LIMIT` + `BRIDGE_NOT_LOST`).
- **Degenerate targets are loud** — missing (created with a header comment), read-only (`denied` + path +
  errno, the settings edit still succeeds), concurrent (retry ×3 then `conflict`, the human's file left
  untouched), unparsable (`unparsable`, never repaired).

**One mpd.jsonc knob is read but NOT yet rendered in `/settings`: `tui.wheelInvert`.** It is a boolean,
default `false` (= today's behaviour), and it flips the wheel's vertical sign on every panel and scene this
bundle draws. The host derives a wheel event's `deltaY` from the terminal's own wheelup/wheeldown bits, so
which direction a wheel reports is a property of the terminal / multiplexer / OS and arrives reversed on
some installations; before this knob every wheel path applied the raw delta with its own fixed sign, and
there was no single place to correct and no user-facing answer. The value is read through the **same
`mpdConfig` service and the same layer stack** as every knob above: write
`{ "tui": { "wheelInvert": true } }` into `<workspace>/.mpd/mpd.jsonc`, or set the `mpd-tui` row's own
`wheelInvert: true`, which is the **floor** of the toggle (a saved leaf wins when it is a boolean; a junk
value can never arm it). The plugin reads the leaf **per wheel gesture** rather than sampling it at
mount, so a save through `/settings` **and** a FILE edit both reach it in the running process — the
config service re-resolves on a settings save and on a watched edit of the project file, and the L1/L2
layers are re-read on every resolution (above) — while a mount-time sample would have read `undefined`
on any boot where the deferred `mpdConfig` binding lands after this row applies. **Honest bound:** unlike `tui.dashboardKey` this leaf is
not yet carried by `SETTINGS_KNOBS` / `SettingsSchema` in
`packages/mpd-config-plugin/src/settings-schema.ts`, so it has **no row in the `/settings` form**; the file
layer works because `mpd-config`'s `loadConfig` returns the RAW merged layers and strips no undeclared key.
Declaring the leaf in that shared schema is the follow-up that adds the row — the read path above does not
change when it lands.

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
| **workspace** (`<workspace>/.mpd/**`) | `mpd.jsonc` (the configuration FILE every layer reads; an entry save does NOT write it — §6.2), `memory.json`, team/plan/boulder state | both doors run in the **same workspace** — by construction |
| **HOME** (`~/.mpd/workmate`) | the user's cross-project workmate library | same `HOME`, i.e. across profiles of one user; distinct for two users |
| **bundle** (`<bundle>/…`) | the `mpd` preset/roster and the skill corpus (served, not copied) | both doors **are the same install**, independent of any home |

**The boundary to know:** with ONE DSH home the settings document is shared, so a settings edit is
visible to both front doors at once. With SEPARATE DSH homes there are **two** settings documents —
`settings.yaml` is DSH-HOME-scoped — so an edit made in one door is **invisible as a settings VALUE**
to the other, and it does not converge through the workspace file either: on this harness an
entry-config save performs **no `<workspace>/.mpd/mpd.jsonc` write** (§6.2), so nothing syncs the two
doors automatically. The workspace `mpd.jsonc` changes when something writes it — a hand edit, or the
dormant legacy namespace write-back where a host still serves it. In one sentence: *same DSH home ⇒ the
settings value is shared; separate homes ⇒ the settings values differ and no save writes the workspace
file for you.* This is the one place where the two doors can legitimately disagree on an inherited value.

## 7. Deliberate deviations from ecosystem convention

One former deviation is CLOSED. The DSH-TUI ecosystem convention for third-party plugins includes an
**MIT** licence, and since the de-omo wave E licence swap this bundle carries that same MIT licence
(`LICENSE.md`, `Copyright (c) 2026 HaroldZ32`) — so the licence is no longer a deviation and is not
listed below. The deviations that remain are these.

| Deviation | Value | Why it is deliberate |
|---|---|---|
| Package name | `@mpd-dsh/mpd-tui` | Keeps this bundle's namespace; the ecosystem uses its own naming. |
| Manifests | **ONE** bundle-level `dsh-plugin.json`, never 25 per-package manifests | The bundle installs as one unit; the manifest's host facet points at the one TUI plugin module. |
| Host input bus | ONE counted contact outside the seams, and since 0.13.0 a **VERSION-GATED** one: the adapter resolves the INSTALLED host root and dynamic-imports `<hostRoot>/lib/types/ui.js` **by file URL** to obtain the host's own `useStdin`. **What the gate covers is INTERCEPTION, not that load**: the probe still runs in every composition (the 0.13.0 lane's own adapter log carries the `host contact bound: … (lib/types/ui.js)` line), and what is version-gated is how `Ctrl+A` is handled | `Ctrl+A` is a host built-in action that no contribution kind can reach, so on a pre-0.13.0 host the alternative was dropping the requirement. **The gate:** on a host that OFFERS the panel seam (0.13.0+) the contact stays **INERT** — `Ctrl+A` keeps the host's own dashboard meaning and the merged view opens through `alt+a` / `/mpd panel` (§3.3), which the 0.13.0 real-PTY lane measured (`evidence/tui/lanes/2026-10-06T10-28-57.807Z/`: the host's own dashboard opened, and `/mpd panel` proved the sidebar registration + accepted open); on a host WITHOUT the seam (0.12.0) the old behaviour is unchanged — the contact arms when `tui.dashboardKey` is on and the workspace's team projection holds a team with at least one task. `tui.dashboardKey` therefore stays in the config schema and the `/settings` row, documented as meaningful on OLD hosts only. The per-press rule lives in ONE function, `takeoverArmed` in `packages/mpd-tui-plugin/src/panel.ts` (the seam WINS over every config layer; only without the seam does the saved value, else the row config's floor, decide), and the adapter's `panelSeamBound()` is read PER PRESS, not only at apply time. **History (measured on 0.12.0, kept as the record it is):** that import is a FOREIGN instance whose `useStdin()` answers nothing, so the adapter also stores the live kit a SCENE render receives and prefers it — which is why the take-over arms after the session has rendered any MPD panel or scene, and stays inert before that. Two further host rules are obeyed inside the adapter: a status registration's identity must be the CALLING ACTIVATION (the injected scope), and no DSH-TUI file is written. **Bound:** no 0.12.0 PTY arm was obtained in this wave (§11.3), so the old-host arming path rests on unit arms rather than on a pane capture. |

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
| `mpd-bundle` | composition layer (the bundle patch itself) | usable | composed config rows incl. `mpd-tui`; live boot with 0 crash signatures. The `agent-preset-registry` id-target this row once recorded was REMOVED on 2026-10-02 under the strict zero-override decision — superseded by §2 |
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
| `mpd-mcp-lsp` | LSP MCP server (stdio launcher for the declared `cclsp` dependency) | usable | 12 `mcp__lsp__*` tools (cclsp's own names) |
| `mpd-mcp-codegraph` | codegraph MCP server (stdio launcher) | usable | server alive in-process; 0 tools **in that sandbox** because the CodeGraph policy excludes a project path containing `.mpd` (a sandbox artifact, not a TUI limitation) |
| `mpd-mcp-gitbash` | ONE launcher for the git toolbox and the raw shell runner (declared npm dependencies) | inert | rows `mcp-git` (28 `mcp__git__git_*` tools) and `mcp-shell` (`mcp__shell__run_process`) are both composed `disabled: true` under every profile |
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
| Install / triple layering / 36 rows / 0 crash signatures / mpd preset AVAILABLE (not the default) | Observed | the layering and crash-signature halves stand as measured at t5 `evidence/tui/composition/20260915T053445Z/`, re-run by t8 (`evidence/tui/live/20260915T063140Z/lanes/tui-mount/`) and t9 (`…/conformance/20260915T064521Z/09-mount-boot.log`, `10-mount-boot-clean-root.log`); the row count and the preset claim are SUPERSEDED by §2 — 36 rows (35 `cordis.patch.yml` + 1 `presets/mpd.patch.yml`), and the deployment default stays the host's |
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
| §3 settings row | "with the limitation in §6.2" | a bridged behaviour that is live for the model routes (a mount-captured knob still waits for a boot) with two named skip cases (§6.2), the duplicate-key rule (§6.5) and the Web card's evidence level (§3.1) |

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

### 11.4 Amendment after the dependency-DAG port wave (2026-10-06, later the same day)

The rows above stay as written for the revision and the host they measured. This wave ported the WEB
dependency view to the TUI sidebar and root-caused the invisible-panel report, so the following
supersedes them:

| Superseded statement | Was | Is (measured 2026-10-06) |
|---|---|---|
| §3.3 panel inventory | **ONE** sidebar panel (`team`), `minColumns` **32** | **THREE** pages — `team` (`order` 10), `dag` (`MPD DAG`, icon `◈`, `order` 11) and `workmate` (`MPD workmate`, icon `◆`, `order` 12) — **all `minColumns` 28**. The 32 was the defect: the host REPLACES a page's body with a `panel-too-narrow` notice whenever the panel column is narrower than the descriptor asks for, while its own split threshold puts that column at exactly 28, so a band of terminal widths existed in which the sidebar opened, the tab was drawn, and the user was shown a refusal notice instead of the graph |
| §3.3 entry points | `alt+a` and `/mpd panel` | plus **`/mpd dag`** and **`/mpd workmate`**, each routing to its own page through the same arbitration and each with its OWN full-screen fallback (`mpd-tui-subagents` for `dag`, the board for `workmate`) |
| §3.3 / §10 item #16 — "the panel body is not pane-capturable" | after a host-ACCEPTED `open()` the capture was byte-identical, so no render was claimed | the CAUSE is now known: the page was never in the host's enable list — the host's own `useSidePanel` DROPS a request whose id is not enabled, while `tuiPanels.open()` returns `true` on DELIVERY — and the sidebar starts closed. With `sidePanel.panels` carrying the page ids and the sidebar open, the 120-column capture shows the three MPD tabs and the body. The claim stays bounded: MPD still cannot observe a RENDER (the host's event set has no `opened`/`focused`), so the command's sentence states what it knows and names the remedy instead of claiming success |
| §3 DAG description (scenes only) | a depth-indented task list inside the scene | the DAG is its own page (§3.4) and rank is **DERIVED** from the dependency graph rather than trusted from a served `depth` — a board whose blocker references resolve to nothing used to draw one column and no edges while saying nothing — with unresolvable references reported and ONE tone table as the palette source |
| §1 surface inventory | panels, scenes and the status line as separate surfaces | the whole `mpd-tui` surface layer was restyled onto ONE visual system (R14), every surface reading the frozen tone/glyph/legend tables rather than carrying a private copy |

**Evidence of this wave** (all under `evidence/tui/dag-port/`): `requirements.md` — the frozen contract
plus its four amendments; `verification/pty/frozen/` — the frozen-revision real-PTY capture (the three
MPD tabs, the pin/unpin keys, and the width matrix with its `split=false` arms); `seam-guard/20261006T135423Z/`
— the wiring, the id discovery and the R26 wording; `panel-surface/20261006T140037Z/`, `dag-layout/`,
`visual/`, `team-feature-test/`, `web-dag/`; and `freeze/FROZEN-REVISION.md` — the revision hashes the
capture was taken against.

**Bounds (the bounds are part of the claim).** (a) MPD cannot observe a render (above): what it knows is
a composed id plus an accepted request. (b) The page ids are DYNAMIC (`<activationId>:<slug>`), so no
document may state `act1:dag` as a constant — discover them from the host's `/panel ` completion list or
from the printed command line. (c) At 80 and 48 columns the host does not split at all
(`split=false`), so no sidebar page can be visible there. (d) The DAG page's scrollbar has a KNOWN OPEN
DEFECT — an unbounded `PgDn` run can drive the window to zero rows because the scroll offset accumulates
across renders — so it is recorded, never advertised as flawless. (e) Browser-only behaviour (hover,
pixel geometry, CSS ellipsis, `overflow:auto`, native tooltips, DOM reads and `fetch` polling) is not
ported and not claimed.

### 11.5 Amendment after the DAG-highlight wave (2026-10-07)

The rows above stay as written for the revision and the host they measured. This wave fixes the DAG
page's click, shrinks its nodes and gives the three sidebar pages their own chrome, so the following
**supersedes** them — supersedes, not merely appends to, because two contradictory statements on one
page is worse than either alone:

| Superseded statement | Was | Is (measured 2026-10-07) |
|---|---|---|
| §3.4 — "Clicking a task pins a detail body with ten facts" | clicking a node pinned that node | **The click was COLUMN-BLIND.** `panel-dag.ts` resolved a pointer with `hits.find(c => index >= c.row && index <= c.rowEnd)` — rows only — while `GraphHit` already carried `col`/`colEnd` and `graph.ts` already exported `hitTest(view, row, col)`. Every box of a rank shares ONE row band, so a click always pinned the **leftmost** box of that rank; the Termaid-width change made a rank hold two or three boxes, and the leftmost is often panned out of view, so the `▶` and the blue chain landed on a task the user never pointed at. Measured headlessly before the fix: clicking the row that DRAWS `T3` rendered `[accentShimmer] │ ▶ T2 …` with `T3` left `[inactive]`. The click now resolves through the drawing's own hit rectangle with the pointer's column plus the pan offset; a click on no box CLEARS the pin |
| §3.4 — the node label | `<marker> <id> <KIND> <graph-safe subject>` | **`<marker> <id>`** — `✓ T3`, `▶ T3`. The subject is no longer in the drawing at all, which is what removes the 乱码 class the user reported (a Chinese subject squeezed through `graphSafeLabel` read as `#5`) and what lets a rank of three nodes fit a 40-cell sidebar. The subject and the description remain VERBATIM in the pinned detail body |
| §3.4 — the box form | a five-row box with two padding rows | **the compact THREE-row box** (top border, content, bottom border), rounded corners kept, one form per drawing |
| §3.4 — what a pin looks like | a tone change only (colour) | the pinned task and its upstream dependency chain render **BOLD**, and everything else carries the muted tone **AND** the host's `dimColor` flag — because `inactive` (`#8991A0`) against `subtle` (`#A6ADBA`) is nearly invisible in the dark theme. **MEASURED BOUND, stated rather than implied**: on the installed 0.13.0 the host resolves `dimColor` to `theme.inactive` — the same key `DAG_TONE_THEME.dim` already names — so the flag is a SEMANTIC channel and changes no pixel here; the visible non-colour separator is the BOLD on the focus and the chain. The grey-out itself is the real `subtle`→`inactive` step |
| §3.4 — the DAG page's scrollbars | one vertical gutter, click-to-jump; one horizontal rail, wheel/keyboard only | **both rails scrub under a mouse DRAG**, through the SAME absolute track arithmetic a click uses (`onDragStart`/`onDragMove`/`onDragEnd` with the host's own `localRow`/`localCol`), exactly as the host's `components/ScrollbarGutter.js` does. Click, wheel and keyboard keep working |
| §3.3 / §11.4 icon cell — `workmate` | icon `◆` U+25C6 | **`◆` is one of the host's OWN tab icons** (`agents`), so it was not a distinct symbol at all. The measured set is `MPD` = `❖` U+2756, `MPD DAG` = `◈` U+25C8, `MPD workmate` = `⬢` U+2B22, each one cell under both the plugin's `sanitize.cellWidth` and the host's `stringWidth` (the host REJECTS a registration whose icon is not exactly one cell) |
| §3.3 / §11.4 — the merged page's tab | title `MPD`, **no icon**, so the host drew the fallback letter `M` | the merged page declares `❖` and no longer falls back to a letter |
| §3.3 / §10 — a fullscreen control on the MPD pages | none | each MPD page draws **its own clickable `⤢`**, which opens that page's existing full-screen scene. It is MPD's own control and not the host's **because the host cannot draw one for a plugin panel**: dsh-tui 0.13.0's descriptor validator freezes a plugin definition with exactly `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component, compact}` — **no `capabilities`** — while `components/sidePanel/SidePanelColumn.js`'s `canExpand` reads `definition.capabilities?.fullscreen === true`, so the host's own `⤢` can never appear for MPD, and `Chat.js`'s `openPanelFullscreen` maps built-in panel ids only. Declaring `capabilities` would draw a button that does nothing, which this bundle does not ship |
| §3.4 — the closing bounds sentence, and §11.4 bound (d) | "the two failing `bun test ./packages` arms at the freeze are exactly those offset-accumulation arms"; the DAG scrollbar's unbounded-`PgDn` defect recorded as KNOWN OPEN | **stale and REMOVED.** The offset is held in a ref that is the single live authority and every read is clamped against the CURRENT render's sizes, so the accumulating-offset defect is fixed and the suite is green (measured this wave: `bun test packages` exit 0, 382 passing in the TUI package alone). The scrollbar's remaining bound is the one §3.4 still states honestly: MPD cannot observe a render |
| §3.4 — the DAG page's ten-fact detail body | pin/unpin only | plus: clicking an ALREADY-PINNED task opens that member's **work page** — MPD's full-screen `mpd-tui-subagents` scene positioned on the detail view of the task's owner, matched through the host's curated subagent rows. When the owner matches no row, the host toast says so and the scene opens on its list |

**Evidence of this wave** (all under `evidence/tui/dag-highlight/`): `20261007T120342Z/` — the PRE-fix
diagnosis, with the runnable `probe-click.ts`/`render.ts` instruments and the log that shows clicking
the row drawing `T3` pinning `T2`; the wave's post-fix run, the acceptance-instrument log, the real-PTY
capture and the gate logs land in a second stamped directory under the same slug.

**Bounds (the bounds are part of the claim).** (a) The pointer-coordinate **DELIVERY** path — whether
the terminal and the host actually hand `onClick`/`onDragStart` usable `localRow`/`localCol` to a row
`Box` inside a plugin sidebar panel — is **declared, not proven**: the headless arms prove the
RESOLUTION and a real-PTY capture proves the RENDER, and this page claims exactly that much. (b) A
host that ignores the drag props simply does not drag; no gesture is lost, because click, wheel and
keyboard stay bound. (c) The DAG drawing is unchanged in every other respect: the rank derivation, the
unresolved-blocker and cycle reporting, the arrowheads, the legend and the six-state palette are the
§11.4 ones. (d) The WEB dependency view was NOT touched by this wave.

### 11.6 Amendment after the DSH-TUI 0.14.0 adaptation wave (2026-10-08)

The rows above stay as written for the revision and the host they measured. This wave moved the target
host one release on, and **every plugin-facing seam came through the move unchanged**, so the
adaptation is a re-measurement of the host shape plus the sidebar's own page set and the full-screen
control. The following supersedes them:

| Superseded statement | Was | Is (measured 2026-10-08) |
|---|---|---|
| This page's target host (§ preamble) | `@deepseek-harness-tui/dsh-tui` **0.13.0** and its built-in admission profile | **0.14.0** (read from the installed package: `version` 0.14.0). The release's own additions: a **Claude backend peer** — `@anthropic-ai/claude-agent-sdk` at exactly `0.3.287`, the one peer the release adds — the **`ws` runtime dependency** (`^8.21.3`, absent at 0.13.0), an **eighth** builtin sidebar panel (`btw`) and the rewritten `PanelBar` below. `MPD_E2E_DSH_VERSION` does NOT move, because the harness peer range is unchanged |
| §3 seam inventory | fifteen `tui*` seams, the set dsh-tui has exposed since 0.13.0 | **still fifteen, and every one is byte-identical to 0.13.0** — the fifteen seam modules and their declarations under the host's `lib/types/dsh-adapter/` (`panels`, `scenes`, `status`, `renderers`, `settings-sections`, `shortcuts`, `dialogs`, `command-trees`, `plugin-host`, `toast`, `themes`, `plugin-storage`, `message-observer`, `effect-ledger`, `workspaces`, each `.js` + `.d.ts`) have not moved, there is no sixteenth seam, and the `peerDependencies` lists still end at `0.2.0-rc.2`. **No adapter code change was needed for the seam surface** |
| §3.3 — the enable list's default, and the arm that pins it | the host's default CSV is `todo,jobs,agents` (three builtins) | **`todo,jobs,agents,info,trajectory,workspace,btw,companion` — eight builtins; `btw` is the new one** (`DEFAULT_SIDE_PANEL_IDS`, read from the installed host's `lib/types/tuiDisplayPrefs.js`). The bundle's own test now asserts the **INVARIANT** instead of a three-id literal — the literal is what reddened when the host grew, while the file's premise is that it re-judges itself when the **installed** host changes. All THREE sub-assertions the clause names execute and are green: the default names builtins only and contains nothing of ours, every id in it passes the host's own `SIDE_PANEL_ID_PATTERN`, and the normalizer is **idempotent** over it — the idempotence carrier is the arm *"the host REWRITES the CSV from configuration, which is how a registered panel disappears"* in `packages/mpd-tui-plugin/test/panel-visibility.test.ts`, whose `const once = prefs.normalizeSidePanelPanels(prefs.DEFAULT_SIDE_PANEL_IDS)` is followed by `expect(prefs.normalizeSidePanelPanels(once)).toBe(once)`. **That assertion RUNS and PASSES inside that arm** — it is part of the 469-pass / 0-fail suite reading above, confirmed by a direct read of the file rather than inferred from the arm's title |
| §3.4 — the `⤢` control and the host's own one | each MPD page draws its own `⤢` because the host cannot draw one for a plugin panel | **re-measured on 0.14.0 and still true, as a bound rather than a wish**: `dsh-adapter/panels.js` still freezes a plugin definition to `{id, title, icon, order, minColumns, source, pluginId, mountPolicy, component, compact}` with **no `capabilities`**, while `components/sidePanel/SidePanelColumn.js`'s `canExpand` reads `activeEntry?.definition.capabilities?.fullscreen === true` — so the host's own `⤢` is unreachable for a plugin panel and `capabilities` stays undeclared (a dead button is not shipped). MPD's own control opens an MPD-registered full-screen surface with the page's SAME rich appearance (§3.4) |
| §3.4 — the legend under the drawing | a per-drawing block of legend lines | **the accumulating-legend defect is FIXED, and its cause is measured**: the legend's rows were keyed `legend-${line.slice(0, 24)}` and the drawing's state-key line and the legend's first wrapped line both started `✓ completed · ◐ running`, so two React children shared ONE key and the collided row was rendered again on every re-render (measured on a mounted instance: 4 legend rows after mount, 7 after seven clicks). The key is the row's position now, and the arm that keeps it green asserts the legend ROW COUNT is STABLE across N clicks |
| §3.3 / §7 — the pin carriers | the global package, the `dsh-tui` profile, the distribution ref and the QA host spec all named `0.13.0` | **`0.14.0` in this wave's carriers**: `docker/**` (both `MPD_E2E_TUI_VERSION` defaults in `docker-compose.yml`, the same key in `docker/ui/docker-compose.yml`, `docker/entrypoint.sh`'s `TUI_VERSION`, `docker/ui/entrypoint.sh`'s two `MPD_UI_TUI_VERSION` defaults, `docker/tui-lane.sh`'s `TUI_VERSION` and its `PREF_WRITER` probe string), the distribution descriptor's `host-tui` ref (`dsh-distribution.json` now carries `pkg:npm/@deepseek-harness-tui/dsh-tui@0.14.0`) and the seven QA carriers under `skills/dsh-qa/scripts/**` (`tui-mount.ts`'s `TUI_HOST_SPEC` and PREREQ lines, the PREREQ/remedy strings in `tui-panels.ts`, `tui-deps-ctrla.ts`, `tui-team-surface.ts` and `tui-admission.ts`, `lib/tui-lane.ts`, `install-dependencies.ts`), plus `scripts/mpd-tui-panels.ts`'s header prose, which now
names 0.14.0 as the release this bundle targets while the paragraph above it stays the 0.13.0
measurement it was. **TWO deliberate non-moves:** `MPD_E2E_DSH_VERSION` keeps its `0.2.0-rc.2` default, because the harness peer range did not change (F2's reading); and `dsh-plugin.json`'s `compat.hosts` stays at `@deepseek-harness-tui/dsh-tui@0.10.1` because the field records the **0.10.1 admission measurement** this bundle was admitted against — not the TUI edition it targets — so moving it would falsify a measurement rather than record a target |

**The two-panel sidebar (user clause 「把MPD与Workmate两个panel扔到侧边栏上去」).** The wave collapsed
three MPD pages into **TWO** — the rich page `team`/`MPD` (`❖`, order 10) and `workmate`/`MPD workmate`
(`⬢`, order 12) — both `minColumns` 28, both `apiVersion` 1, neither declaring `compact`. The standalone
`dag` page's REGISTRATION is gone: `src/panel-dag.ts`'s rendering is what the surviving slot renders (the
host's curated subagent rows above the drawing, inside the DAG page's own frame, header + progress,
legend, key-footer, badge and pin body), the separate merged renderer is deleted rather than kept beside
it, and the module's `◈` icon is declared by nothing. **Every user-visible entry point still resolves to a
live surface**, which is the clause's own test: `/mpd dag` re-aims onto the MPD panel's discovered id (the
fallback for that route is the rich team scene), `/mpd panel`, `/mpd subagents` and `alt+a` were already
routed through the same slot, `/mpd workmate` keeps its page, and the adapter's recorded id set is
DISCOVERED from what actually registered — so it carries the two surviving ids, never a composed three.

**The full-screen counterpart (user clause 「全屏出来的MPD也要有这种富外观」).** The MPD page's own `⤢`
opens the **rich team scene** (`mpd-tui-team`), not the merged subagents scene: the team scene draws the
same grammar the page draws with (frame, legend, the focused task's detail pane — the pin's full-screen
form — and the key hints), so the reader does not fall from a rich page into a bare one. The ROUTED
fallback of `/mpd panel` and `alt+a` stays the merged subagents scene (`mpd-tui-subagents`), because that
route's question is "which surface carries the host's rows" — the two are separate answers by design and
`registerPanelSurface` takes them as two options.

**The enable list now follows the host's own change feed.** The bounded tick ladder (six ticks over
~25 s, then stop for good) is replaced as the PRIMARY repair by the host's own
`subscribeSidePanelPanels` subscription on the live-setting store: a wipe is repaired as the host
re-applies its config instead of being lost after the ladder ends — which is the durable form of the
user's 「侧边栏挂掉了」. The ladder survives ONLY as the degrade path for a host that exposes no feed;
the subscription is released with the injected scope, never throws on a host without the module, and the
STAND-DOWN rule holds (**the moment the CSV names ANY of our ids, a configuration has taken a position on
this bundle and the keeper stops for good**, so a page the user removed on purpose is never
put back, and our own write ends the loop because it contains our ids) — with ONE addition from repair
round R1: a provably-dead past id sitting in that same list is pruned in a prune-only write BEFORE the
keeper stands down, and nothing is appended in that pass.

**The recorded panel-id set now carries PROVENANCE, because a test run poisoned it (measured).**
`.mpd/logs/mpd-tui-panels.json` was overwritten on 2026-10-08 with `act0:team,act0:dag,act0:workmate` —
ids the installed host cannot compose, since its `pluginIdFor` fallback counter pre-increments and the
first bare activation is `act1` — by a UNIT TEST run whose panel-seam double labels registrations `act0`.
The record is now schema version 3 (version 2 added `provenance`, version 3 the bounded `history`) and
carries `provenance {hostRoot, hostVersion, readBack, activation}`;
the recorder REFUSES to write a record it cannot trace to an installed host package and a host read-back,
and the `act0` shape is refused by name. Measured: a full
`bun test ./packages/mpd-tui-plugin ./packages/mpd-tui-adapter-plugin` run leaves the record's sha256
unchanged. **The same proof is guarded on the READ side**, so a polluted record can no longer reach a
user's profile patch: `scripts/mpd-tui-panels.ts` REFUSES (dry run and `--apply` alike, exit 1) a record
with no `provenance`, a blank `provenance.hostRoot` or `provenance.hostVersion`, no `provenance.readBack`,
or `provenance.activation === "act0"`, naming the failed field and pointing at `--ids <a,b,c>` — measured
on the polluted version-1 record: ``REFUSED: … it carries no `provenance` block …``, exit 1, the record's
sha256 unchanged, `--ids act1:team,act1:workmate` accepted, and the script's `--self-test` green with one
arm per refusal shape plus a well-formed record accepted. It is also the guard the PRUNE reads through, so
a refused record contributes no past ids at all (repair round R1). **The file ON DISK is still the
polluted version-1 record until a real boot of the host rewrites it** — which is precisely why the
remedy refuses it today, and why `--ids` is the documented escape.

**0.14.0's `PanelBar` no longer paints a plugin's icon, and that is a HOST fact rather than a bundle
change.** `components/sidePanel/PanelBar.js` is now a CAROUSEL: the ACTIVE tab's title is drawn centred
(`ActiveTitle` — bold, `wrap: "truncate-end"`), every other tab is a single `○` dot — `●` when the tab
carries a badge — placed by a computed pitch, and overflow is windowed. Measured on the installed tree:
`grep -c icon lib/types/components/sidePanel/PanelBar.js` is **0**. A descriptor's `icon` is still
REQUIRED by the host's validator and is still declared by every MPD page (an icon that is not exactly
one cell is a refusal); it is simply no longer painted. The collision set the bundle's icon arm reads
from the host's own `builtinPanels.js` therefore grew from seven icons to **eight** —
`≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`, the new one being `?` for `btw`.

**Evidence of this wave, and what each reading is worth.** The host readings above were taken from the
installed tree (`/root/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`, `version`
0.14.0) in the same step that wrote this block — `DEFAULT_SIDE_PANEL_IDS`, `SIDE_PANEL_ID_PATTERN`, the
frozen descriptor literal, `canExpand`'s source, `PanelBar.js`'s icon-free body and the eight
`builtinPanels.js` icons are read from those files rather than remembered. The seam byte-identity is the
wave's own comparison of the two installed trees. The legend defect is pinned by a MOUNTED-instance arm
that imports the host's real React/ink (`packages/mpd-tui-plugin/test/panel-legend-mount.test.ts`) and
walks the click sequence — the pre-fix row count walked `[4,5,5,5,6,6,6,7,7]` and the fixed code is `4`
at every step — and by the measured suite: `bun test ./packages/mpd-tui-plugin
./packages/mpd-tui-adapter-plugin` = **469 pass / 0 fail** (the frozen revision's reading: the pre-wave
454 grew to 469 — the restored 44-test file plus 15 new arms). REPO-WIDE, the wave's verification record
`rec-20261008T030715-f1a2ad` reads
**1632 pass / 3 skip / 2 fail** — the two reds are the DECLARED environment defects, against the
contract's pre-wave 1615 / 3 / 4 — and this page quotes that record rather than re-deriving it. The
record-integrity bound is measured the
same way: the file's sha256 before and after that suite run is **unchanged**. **The two readings of the
remedy are not in conflict — they are the same command before and after its own repair, and both are
kept here on purpose.** BEFORE the reader guard landed (measured 2026-10-08, earlier in this same wave)
a dry run of `node scripts/mpd-tui-panels.ts` against the polluted record PRINTED the `act0:*` ids it
would offer — that is the demonstration of the defect, and it is why the guard exists. AFTER that repair
it is the CURRENT, MEASURED behaviour that the same command prints
``REFUSED: … it carries no `provenance` block (a version-1 record, whose ids cannot be traced to a boot)
… or pass --ids <a,b,c>`` and exits 1 (see §3.3 and the provenance paragraph above); the pre-repair line
is history, not a description of the shipped script. The
sandbox and real-PTY lanes of this wave (mount, panels, surfaces, deps/`Ctrl+A`, team surface, admission)
are recorded under `evidence/tui/lanes/**`, and the Docker lane carries a NOTICE
rather than a pass on a rootful daemon — a SKIP is not a pass, and this page will not call it one.

**Bounds (the bounds are part of the claim).** (a) MPD still cannot observe a RENDER: the host's
`TuiPanelEvent` set is `registered|unregistered|badge|error|disabled` and `open()` answers DELIVERY, so
the plugin prints what it knows and the page bodies are asserted by unit arms and the pinned PTY
captures, never by the plugin's own branch. (b) The host's own `⤢` stays unreachable for a plugin panel
and `capabilities` therefore stays undeclared — a dead button is not shipped, and that is a bound rather
than a TODO. (c) The record's provenance is enforced on BOTH sides (the writer refuses an unprovable
record, and the reader refuses one by name), and `--ids` is the documented escape when a user knows the
ids. (d) The `PanelBar` change is a HOST fact: this page describes
what 0.14.0 does, and a future host that paints icons again is contradicted by no MPD claim — every
descriptor still declares one.

### 11.7 Amendment after the DSH-TUI 0.15.0 adaptation wave (2026-10-15)

The rows above stay as written for the revision and the host they measured. This wave moved the target
host one release on again (0.15.0, published 2026-10-13), and **every plugin-facing seam came through
unchanged for the second time** — the adaptation is a carrier move plus three user-mandated functional
clauses (the keeper re-spec, the decision-events grant flow, the 0-task DAG fix). The following
supersedes §11.6:

| Superseded statement | Was | Is (measured 2026-10-15) |
|---|---|---|
| This page's target host (§ preamble) | `@deepseek-harness-tui/dsh-tui` **0.14.0** | **0.15.0** (npm `latest`; the wave's frozen measurement basis is `evidence/tui/dsh-tui-015/host-diff/FACTS.md`, both tarballs unpacked beside it). Host-internal additions that need NO bundle reaction: new OPTIONAL harness peers (`@deepseek-ai/dsh-plugin-manager`, `dsh-app-boot`/`dsh-cmdline`/`dsh-http-proxy`/`dsh-launch-environment` pinned optional) and a `zod@^4.4.3` runtime dep. `MPD_E2E_DSH_VERSION` does NOT move — the harness peer range is unchanged (every `dsh-*` peer still ends at `0.2.0-rc.2`) |
| §3 seam inventory | fifteen `tui*` seams, byte-identical 0.13.0→0.14.0 | **still fifteen, additive-only**: `panels.d.ts` gains `applyConfiguredSidePanelPanels()` + `applySidePanelPanelsFromSettings()` (the host-side CSV merge helpers behind C2 below), `plugin-host.d.ts` gains `probeBackendAdmission()`; every other seam `.d.ts` is byte-identical, there is no sixteenth seam, and a raw-grep hit on `tuiChannel` is the KERNEL-CHANNEL protocol id, not a seam (no `Service` registers it, nothing to inject — stated in `agent-references/seam-adapters.md`). **That wave changed no adapter code — and this row measures the HOST files, not the agreement of OUR `Tui*Like` declarations with them (re-derived 2026-10-17: six disagreed; amendment below).** |
| §3.3 — the enable list's default | `todo,jobs,agents,info,trajectory,workspace,btw,companion` (eight builtins, 0.14.0) | **UNCHANGED on 0.15.0** — same `DEFAULT_SIDE_PANEL_IDS`, same eight builtin icons (`≡ ▸ ◆ ⓘ ∿ ⌗ ? ♥`), so the invariant arms stay green. The RULE beneath it changed: see the keeper row below |
| §11.6 — the `PanelBar` no longer paints an icon | `grep -c icon …/PanelBar.js` = 0 on 0.14.0; inactive tabs are `○`/`●` dots | **0.15.0 PAINTS ICONS AGAIN**: inactive tabs draw `tab.icon ?? <first character of the title> ?? '?'` plus the unread count (`tabLabel()` in the re-measured `PanelBar.js`). The bundle's declared one-cell icons (`❖` MPD, `⬢` workmate) are painted again; nothing in the bundle changed — every descriptor still declares exactly-one-cell icons, as the host's validator requires |
| §3.4 — the `⤢` bound | `dsh-adapter/panels.js` freezes plugin descriptors without `capabilities` → the host's own `⤢` is unreachable | **re-measured on 0.15.0 and still true**: `grep -c capabilities …/dsh-adapter/panels.js` = 0, `SidePanelColumn`'s `canExpand` still reads `definition.capabilities?.fullscreen === true`. MPD's own `⤢` control stays the one full-screen escape |
| §3.3 / §7 — the pin carriers | `0.14.0` in every carrier that names the release | **`0.15.0` in this wave's carriers**: `docker/**` (both `MPD_E2E_TUI_VERSION` defaults, `docker/ui/docker-compose.yml`, `docker/entrypoint.sh`'s `TUI_VERSION`, `docker/ui/entrypoint.sh`'s two `MPD_UI_TUI_VERSION` defaults, `docker/tui-lane.sh`), `dsh-distribution.json`'s `host-tui` ref (`pkg:npm/@deepseek-harness-tui/dsh-tui@0.15.0`), the seven QA carriers under `skills/dsh-qa/scripts/**`, `scripts/mpd-tui-panels.ts`'s header prose and both `docker/README*.md`. The non-moves stand: `MPD_E2E_DSH_VERSION` stays `0.2.0-rc.2`; `dsh-plugin.json`'s `compat.hosts` stays `@deepseek-harness-tui/dsh-tui@0.10.1` (the admission measurement, not the target); the registry's `0.15` version string stays (ecosystem-spec number, the repo's known false-positive) |
| §11.6 — the enable-list keeper | FEED-FIRST on every host: `subscribeSidePanelPanels` repairs a config-mirror wipe, the ladder is the degrade, the stand-down rule holds | **RE-SPECED (C2, user-mandated): on a host that self-heals — every `>= 0.15.0` — the keeper JOINS the native self-heal and STANDS DOWN; on older hosts the 0.14 behaviour is preserved byte-for-byte.** The 2026-10-16 amendment (`fix/sidebar-015-keeper-migration`) carves the ONE write exception — the stale-default migration, evaluated before the stand-down and re-checked by the belt on every feed event; see the two keeper paragraphs below |

**AMENDED 2026-10-17 — byte identity of the HOST files is NOT member-shape agreement of OUR
declarations.** The "no adapter seam change" conclusion above compared the host's own `.d.ts` modules
across releases; it never compared the `Tui*Like` interfaces in
`packages/mpd-tui-adapter-plugin/src/index.ts` against those modules. Re-derived against the installed
0.15.0 declaration tree, SIX of them disagreed and are corrected in this wave. No behaviour claim rides
on the six — nothing in the bundle calls their members; they are bound, probed and reported only:

| Seam | Declared before | 0.15.0 declaration (re-derived) |
|---|---|---|
| `tuiToast` | `push(message, {level})` → `Disposer \| undefined` | `show(text: string \| number \| boolean, {color?, timeoutMs?})` → `boolean` |
| `tuiThemes` | `register(name: string, theme)` plus `current?()` | `register(descriptor: TuiThemeDescriptor, identity?)` → disposer; NO plugin-facing read (`getSnapshot`/`resolve` are host-only) |
| `tuiPluginStorage` | flat `get(key)` / `set(key, value)` | `open(pluginCtx)` → async `{ get({key}), set({key,value}), delete({key}) }` |
| `tuiMessageObserver` | `subscribe(listener)` | `subscribe(pluginCtx, listener, { scope })` — the scope is REQUIRED |
| `tuiEffectLedger` | `entries?()` | `record(entry, identity?)` → void (nothing on the plugin face lists the journal) |
| `tuiWorkspaces` | `list?()` → `string[]` | `list(currentCwd, signal?)` → `Promise<TuiWorkspaceTarget[]>` plus `register(provider)` |

Three further corrections in the same wave. **`closeScene(id)`** guarded on `close(id) === true`, and
0.15.0's `close()` takes no id and returns void — so it answered `false` on EVERY 0.15.0 build. It now
calls the void `close()` only when the host's own `active` read names the requested id (a blind
`close()` would close whichever scene is active and still report success for an id that was never open),
and the seam declares `close(): void` plus the `active` read. **`tuiPrompt`** is marked a PHANTOM seam
(`PHANTOM_SEAM_KEYS`): a grep of every dsh-tui `lib/**` through 0.15.0 finds no such service, so
`seamOutcomes()` now reports `phantom seam: no measured dsh-tui build declares this service` instead of
a composition gap. And `plugin-host.d.ts`'s `probeBackendAdmission()` is declared on `TuiPluginHostLike`
as a deliberately UNCONSUMED member, so the Backend contribution family is visible without inventing a
consumer.

What this amendment does NOT claim: no real-machine boot was taken in this wave (it is a source-baseline
correction — the host is not run), the six shapes are compared against the installed `.d.ts`
DECLARATIONS only, and the seam set itself is unchanged (fifteen, no sixteenth).

**The host now self-heals the sidebar enable CSV, and the keeper stands down to it (C2).** Measured on
the 0.15.0 tree: `TuiPanelRuntime.register()` feeds `registeredPanelIds` through
`enablePanelIdInStore`; the boot/mirror apply `applyConfiguredSidePanelPanels(config.sidePanel?.panels)`
**unions registered ids back** unless they were explicitly removed; a `/settings` live edit runs through
`applySidePanelPanelsFromSettings`, which records removals session-wide (`removedPanelIds`); the only
CSV writer left is that settings-apply hop. MPD's answer: the enable-list keeper detects the host
version through the adapter's already-proven `readHostPackageVersion` (the value the probe stamps as
`hostVersion` on the SAME probe answer the keeper decides from — no new host contact), and on a
`>= 0.15.0` reading it **stands down before any write path: it never arms the feed, never walks the
ladder, and writes nothing but the ONE exception the next paragraph carves out — everywhere else it
cannot race the host's own union or re-add a panel the user explicitly removed**. One line in the
adapter's log says so (`standing down on host 0.15.0 — the host self-heals the sidebar enable CSV, so
this keeper never writes it again (the stale-default migration aside)`), and an observe-only belt subscribes the store's own feed to log whether the
host union actually kept our ids — a behaviour assertion whose only write is the same ONE exception.
An empty, unparseable or `< 0.15.0` version keeps the full 0.14 keeper (feed-first, the bounded ladder,
the stand-down rule, the prune-only dead-id pass) byte-for-byte — the gate can only ever stand the
keeper DOWN on a version it could actually read.

**The stale-default migration is the ONE write exception to the `>= 0.15.0` stand-down (2026-10-16,
`fix/sidebar-015-keeper-migration`).** The stand-down above had swallowed the T1 migration: the gate
returned from the tick before `decide` — the only caller of the merge — while the host's own self-heal
unions only REGISTERED PLUGIN ids, so a 0.13.0-era user layer pinning `todo,jobs,agents` (the one
`KNOWN_STALE_PANEL_DEFAULTS` entry) kept five builtins out of the sidebar and was healed by no one on
0.15.0. The keeper therefore evaluates the SAME T1 predicate BEFORE the gate returns: when the live
list with our ids removed is EXACTLY the known stale default AND the probed host default is readable
AND the two differ AND at least one id of ours is registered, it writes the host's current default ∪
our ids (host order first, ours appended in registration order — the same merge T1 specifies) and THEN
stands down to the host union. Every other case on a `>= 0.15.0` host — a deliberate custom list, the
current default, an unreadable host default (its ONE degrade line), nothing registered — writes
nothing, exactly as C2 specifies. The belt re-checks the same predicate on EVERY feed event (a
`/settings` save or the host's one-time import hop can re-present the pin mid-session) and re-migrates
when it fires; the migration is self-terminating, because its own write leaves the residue equal to the
host's current default, so the very next event stands down. The pre-0.15.0 behaviour is byte-identical,
and the adapter suite carries the seven new arms that pin all of this.

**AMENDED 2026-10-20 — on a host that OWNS the enable list (`>= 0.16.1`) the adapter is READ-ONLY.** 0.16.1's
`TuiPanelRuntime.register()` enables a panel on registration, `dispose()` removes it, and both the boot and the
settings apply union every registered id back — so there is no enable-list state left for this bundle to author,
and any write would be a second writer racing the host's own merge (the incident class the two paragraphs above
belong to). `hostOwnsPanelCsv` gates a separate `standDownOwnedByHost` path; the version comparison the two gates
share is `hostVersionAtLeast`, extracted so their floors cannot drift. On that path the ladder is cancelled, no
feed and no belt are installed, **not even the stale-default migration runs**, and one line says so
(`standing down READ-ONLY on host 0.16.1 …`). The 0.15.x path keeps the S1 migration byte-for-byte — the 0.16.0
arm pins that boundary — and the discovered ids still reach the diagnostic record through the same `onChange`
hook, because the record is a diagnostic and not a write to the host. `node scripts/mpd-tui-panels.ts --apply`
remains the manual way a user repairs a stale user layer on any host.

**The panel's badge and its one auto-open are published from APPLY, not from the page (G2, 2026-10-20).** dsh-tui
mounts a plugin panel only while it is the ACTIVE page of its column, so a page-side badge can only ever decorate
a page the user is already looking at. `packages/mpd-tui-plugin/src/panel-attention.ts` now owns the host-side
`tuiPanels.badge(id, …)` call and the one-shot `tuiPanels.open(id)`: both are armed through `whenBound("panels")`
— a composition without the seam registers nothing — and driven by the same `mpdTeams` feed the pages subscribe
to. The auto-open fires at most ONCE per process and is **edge-triggered**: it sees a team APPEAR (a pass with no live
team followed by one with a live team), so a boot with an existing team — and any later status change on that
team — opens nothing. It latches on a refusal because the host rate-limits `open()` per plugin (one
per 5 s), and is governed by the new `panelAutoOpen` row knob (default `true`). The trigger is
WORKSPACE-scoped — the feed carries no session id — so a trigger from another session makes the page draw its own
`no team in this session` marker rather than a wrong board. `/mpd status` gained the matching deployment line
(`panels: team=… workmate=… · seam bound · keeper …`) because the host-assigned panel ids are the one fact neither
a user nor a document can derive.

**The repair script now repairs BOTH user layers, and the second is new.** dsh-tui 0.15.0 keeps its own
user settings at `~/.dsh-tui/settings.json` and resolves the effective list as
`values.sidePanel?.panels ?? config.sidePanel?.panels` — the settings layer SHADOWS the profile patch,
and its one-time import hop (blocked from re-importing by the `imported.from` marker) had pinned the
same stale list into the shadowing layer (measured 2026-10-16 on this machine; both layers were
repaired by hand at the time, `.bak-sidebar-20261016` backups beside each). `node
scripts/mpd-tui-panels.ts --apply` therefore now applies the SAME computed list to
`values.sidePanel.panels` AND to the profile patch leaf — one shared merge code path, seeded from the
EFFECTIVE list (the settings key when present, the patch leaf otherwise), every guard unchanged: an
existing position is preserved, `--restore-builtins` is still the only explicit builtin restore, and
only provably-dead recorded act ids are pruned. The settings document is rewritten as JSON with a
2-space indent and a trailing newline, preserving every other key including the `imported` marker;
`--tui-settings <path>` points the layer at a fixture for tests and QA; an absent document leaves the
run patch-only, byte-identical to before this layer existed. The dry run and the apply output report
BOTH layers separately, each write keeps its own `.bak-<stamp>` backup and is read back, and the
script's `--self-test` carries the new settings-layer arms.

**The decision-events grant flow, user-facing (C3').** The decision seam this page has carried as
ready-but-not-activated since §6.1 is now ACTIVATABLE through the host's own documented grant flow, and
the four `session.*.intercept` declarations in `dsh-plugin.json` (`tui/input`, `tui/rewind-prompt`,
`tui/session-switch`, `tui/compact`) are exactly what it grants. **How to grant**: write the host's own
`<DATA_DIR>/extension-grants.json` (under `~/.dsh-tui`) with a row keyed `com.mpd-dsh.mpd-tui` naming
the four permissions at their scopes — exactly the hint the host's own `/plugins` pane prints —
{"grants":{"com.mpd-dsh.mpd-tui":[{"name":"session.input.intercept","scope":"tui/input"},…]}}. **What it
enables**: admission flips from `waiting_authorization` to `compatible`, the component identity binds
(the effect ledger attributes `com.mpd-dsh.mpd-tui` instead of `undeclared`), and the four decision
subscriptions activate — input, rewind-prompt, session-switch and compact interception, the surfaces
§6.1 describes. **Security posture**: the file is fail-CLOSED — a legacy bare-string rule never
authorizes, a malformed file reads as EMPTY tables (corrupt ≠ absent), the host re-reads it per
operation and polls (admission retries every 200 ms for ~20 s, so a grant present at boot or within the
window flips admission without a restart; after a settled refusal a reload is needed); revoking the row
disables the interception again. Without a grant nothing changes: the written fallback in
`dsh-plugin.json`'s DecisionEvents requirement holds and the bundle stays fully usable.

**A live team with ZERO tasks renders as a team, not as "no team" (C6, the user-reported defect).**
`dagPageOf` used to discard a resolved team's identity the moment its board was empty, so a live
six-member team painted one dim "no team in this workspace" line. The projection now keeps the page
whenever the record's `team` head resolved (`tasks: []` is legal; the honest no-team projection still
renders the empty states), and the MPD panel's 0-task render draws the header facts (team, phase,
`tasks 0/0`, members) plus a one-line roster in the scene's own discipline plus the hint that names the
call which fills the board — for the session's own team and for the marked workspace fallback alike.

**Team dispatch now says why it refused (C7, one user-visible sentence).** The team plane's dispatch
pass refuses cross-team pairings and write-task-on-read-only-member pairings in the pure decision, and
the refusal sentences are user-visible in the dispatch report (`refused a CROSS-TEAM pairing: task …
belongs to … while member … belongs to …`; a guard-passed owner is reported as `was passed over by a
dispatch guard (…)`), so a skipped task always carries its reason instead of silently falling back.

**Declined adoption candidates (user-declined after two converging Researcher evaluations — recorded so
no later wave re-litigates them).** Every new 0.15.0 capability is host-internal or diagnostic-only:
`probeBackendAdmission()` — callable on a bound `tuiPluginHost`, but it diagnoses a Backend contribution
family this bundle does not ship and whose install chain is not wired upstream (declined); the
`backend-v1alpha1` Backend family — deferred non-goal; `plugin-completions`, `plugin-declaration`,
`plugin-manager`, `entry-slot`, `session-seed`, `session-list-metadata`, `tui-settings`, `fresh-agent` —
host-internal subsystems, not plugin-facing seams. The admission registry's changed
`registry-0.15.json` and the new `backend-v1alpha1` contract make the `tui-admission` lane re-run
load-bearing for this wave.

**Evidence of this wave, and what each reading is worth.** The host readings above come from the wave's
frozen measurement basis (`evidence/tui/dsh-tui-015/host-diff/FACTS.md`, with both npm tarballs
unpacked at `a/` 0.14.0 and `b/` 0.15.0 beside it — the seam additive-only diff, the union/removal
mechanics, the `PanelBar` icon re-measure and the unchanged defaults are read from those trees, not
remembered). The unit band at the code-revision of this section reads: `bun test
packages/mpd-tui-adapter-plugin` = **74 pass / 0 fail** (five new C2 arms: the version predicate table,
the writes-nothing arm with the observe-only belt, the /settings-removal-stays arm, the explicit-0.14
repair arm, the absent-version legacy arm) and `bun test packages/mpd-tui-plugin` = **482 pass / 0
fail** (three new C6 arms; the version-aware split of the "host re-applies the configured CSV" arm).
The sandbox lanes on the installed 0.15.0 host, the real-PTY arms and the Docker dual-mode lane are the
wave's verification record under `evidence/tui/**` — this section quotes the host-diff and unit
readings it was written against and does not pre-claim lane numbers; a SKIP is never a pass.

**Bounds (the bounds are part of the claim).** (a) The keeper stand-down rests on the host's own
self-heal being present — a host that reports `>= 0.15.0` but lost the union helpers would leave MPD
panels enable-list-less, and the observe-only belt's one line is the visible symptom to look for. The
stale-default exception adds its own stated bound: a user who deliberately configures EXACTLY the known
stale list on a host whose current default differs is indistinguishable from the stale pin and is
migrated once — the same bound T1 already carried, now reaching 0.15.0 through the tick and the belt. (b)
The grant flow's liveness numbers (per-operation re-read, 200 ms ×100 retries) are the host's measured
behaviour, not a bundle promise; revocation semantics are the host's. (c) The `PanelBar` icon return is
a HOST fact re-measured on 0.15.0: a future host that stops painting icons again contradicts no MPD
claim — every descriptor still declares one. (d) The C6 live-PTY eyeball is a named manual observation
(the captain's own session is the repro); the unit arms carry the regression weight.

### 11.8 Amendment after the DSH-TUI 0.16.1 adaptation wave (2026-10-18)

0.16.1 is the first dsh-tui release whose declared peers admit harness `0.2.1-rc.2`: all 36
`@deepseek-ai/dsh-*` peers carry that band (e.g. `dsh-agent: … || 0.2.0-rc.2 || 0.2.1-rc.2`,
`dsh-app-boot: 0.2.0-rc.2 || 0.2.1-rc.2`), while 0.15.0 enumerated the same family only up to
`0.2.0-rc.2` — which is why `dsh plugin --profile dsh-tui add dsh-tui@0.15.0` was refused on a 0.2.1
profile. The target moves to **0.16.1**; the following supersedes §11.7 where it disagrees:

| Superseded statement | Was | Is (measured 2026-10-18) |
|---|---|---|
| This page's target host (§ preamble) | **0.14.0** | **0.16.1** |
| §3 seam inventory | fifteen `tui*` seams, unchanged 0.13.0→0.15.0 | **still fifteen, and 0.16.1 breaks nothing in the adapter**: the same six `Tui*Like` shapes, `close(): void` + `active.id`, `tuiPanels`, `tuiPrompt` still a phantom, and `lib/types/ui.js` still exports `useStdin`; the only addition is the `EFFECT_LEDGER_NAME` const, which neither the adapter nor the bundle declares or consumes. No adapter code change was needed |
| §3.3 / §7 — the pin carriers and `MPD_E2E_DSH_VERSION` | `0.15.0` carriers; `MPD_E2E_DSH_VERSION` stayed `0.2.0-rc.2` | **`0.16.1` carriers and harness `0.2.1-rc.2`**: both Docker lanes (`MPD_E2E_TUI_VERSION`, `MPD_E2E_DSH_VERSION`), `dsh-distribution.json`'s `host-tui` ref (`…@0.16.1`) and `dsh-plugin.json`'s `compat.hosts` (`…@0.16.1`, moved off the stale `0.10.1`). `MPD_E2E_DSH_VERSION` now defaults to `0.2.1-rc.2` because the host's peer band admits it |

The TUI lane uses the configured `TUI_VERSION` (default `0.16.1`) and `MPD_E2E_DSH_VERSION` (default
`0.2.1-rc.2`) pins. It records `tui.hostInstall`, `tui.pluginAddHost`, `tui.pluginAddBundle` and
`tui.compose`; when the selected host's peer range excludes the harness, the host's
`dsh plugin --profile dsh-tui add <host>` is refused, `tui.pluginAddHost` is `false`, and the lane ends
red — it does NOT inspect peer ranges and does NOT record a `tui.hostPeerBound` row.

### 11.9 Amendment after the watchdog-panel wave (2026-10-23)

This wave gives the team watchdog a first-class TUI surface and finishes the model-settings cleanup:

| Subject | Before | After |
|---|---|---|
| §3.3 panel inventory | TWO sidebar pages (`team`, `workmate`) | **THREE** — `team` (`order` 10), `workmate` (`order` 12) and **`watchdog`** (`MPD watchdog`, icon `⚠`, `order` 13, `minColumns` 28). Registered from `src/panel-watchdog.ts` through the row's own `tuiPanels` seam; its own row-config knob is `watchdog` (default on) |
| Watchdog visibility | a status-line notice, one acknowledge dialog per attach, and a `HELD` row inside the board/team/subagents scenes | the **panel** (per-team held state and phase, the `mpd-tui` unread count, the incident list with kind, relative age, team/task/attempt, cause with `ms`, hold outcome and ack state; `a`/`r`/scroll keys), its **own tab badge** (hold = `warning`, unread = `info`, re-taken on a 5 s poll) and **`/mpd watchdog`** |
| `/mpd-model` | slot → **scope** → provider → model → effort, with a member-override and a clear branch (`agentRoutes`) | slot → provider → model → effort; an unconfigured slot reads `<unconfigured>` from the config service's typed `slotResolutionOf`, an older composition `<unavailable>`; **no** member branch and **no** `agentRoutes` write |
| The DAG renderer decision | implicit (“it is a character grid”) | recorded in [`tui-dag-renderer.md`](./tui-dag-renderer.md): notcurses is **not viable**, the host `ui.Image` path is a bounded, non-interactive raster with a mandatory cell fallback, the reference `dsh-blender-plugin` ships no graphics code — so the DAG stays a character grid this wave and a self-built renderer is deferred |

**Honest bounds.** The evidence for this wave is the package's own suite (including the new
`test/panel-watchdog.test.ts` arms) plus the repository gates; **no live PTY capture of the watchdog page
was taken** — the contract's minimum rung (a mounted boot that registers the panel and the command) is
what the plugin-contract arm proves, and the page's content is proven through the host-kit double. The
`ui.Image` inventory in the decision record is read from the installed host's own type declarations
(0.16.1), not from a rendered image.

### 11.10 Amendment after the DSH-TUI 0.17.0 adaptation wave (2026-10-25)

This wave moves the pin pair to the host re-certified against it, and changes no plugin source:

| Subject | Before | After |
|---|---|---|
| This page's target host (§ preamble) | **0.16.1** | **0.17.0** — the first dsh-tui release whose declared peer bands admit harness `0.2.1-rc.3`: 36 of its 39 `@deepseek-ai/dsh-*` peers append the `0.2.1-rc.3` band, which no 0.16.1 peer list carries (read from the published 0.17.0 tarball) |
| §3 seam inventory | fifteen `tui*` seams, unchanged 0.13.0→0.16.1 | **still fifteen, and 0.17.0 breaks nothing in the adapter**: the fifteen seam declarations under `lib/types/dsh-adapter/` are byte-identical, `dsh-adapter/plugin-host.d.ts` and `adapter/standard/negotiate.d.ts` are byte-identical, and `tui-profile/registry/registry-0.15.json` plus every shipped contract file are byte-identical — so the admission profile stays **v0.15** and `manifestVersion`/`$schema` do NOT move. The real 0.17.0 additions are additive or outside this path: panel kit components `Markdown`/`CodeBlock` (`panels.d.ts`), the two host panel-CSV helpers consolidated into `tuiDisplayPrefs.applySidePanelPanels`, a Windows notification channel and a new `cli/` tree |
| §3.3 / §7 — the pin carriers and `MPD_E2E_DSH_VERSION` | `0.16.1` carriers, harness `0.2.1-rc.2` | **`0.17.0` carriers and harness `0.2.1-rc.3`**: both Docker lanes (`MPD_E2E_TUI_VERSION`, `MPD_E2E_DSH_VERSION`), the UI stack (`MPD_UI_TUI_VERSION`, `MPD_UI_DSH_VERSION`), `dsh-distribution.json`'s `host-tui` ref (`…@0.17.0`), `dsh-plugin.json`'s `compat.hosts` (`…@0.17.0`), the QA host spec in `skills/dsh-qa/scripts/tui-mount.ts` and every `npm i -g @deepseek-harness-tui/dsh-tui@…` PREREQ remedy. The harness pin itself lives in `package.json`'s three `@deepseek-ai/dsh-experimental-*` dependencies (`0.2.1-rc.3`) |
| The adapter's version gates | `PANEL_CSV_HOST_OWNED_SINCE = "0.16.1"`, `PANEL_CSV_SELF_HEAL_SINCE = "0.15.0"`, the `hostVersion` fixtures `0.14.0/0.15.0/0.16.0/0.17.0` | **unchanged** — they encode WHEN the host changed behaviour, never which host is current, so a blanket version replace would corrupt them |
| "on dsh-tui >= 0.16.1 …" range statements (§6.2 and the user guide) | a gate threshold | **unchanged** — a range, not a target version |

**Honest bounds.** No live PTY capture was taken for this wave: it is a pin-and-documents wave whose own
evidence is the release-tag sweep, the three-carrier coherence check and the repository gates. The
Docker real-machine lanes carry the new defaults, and running them is the release sweep's step (§4 of
the repository manual), not this wave's.
