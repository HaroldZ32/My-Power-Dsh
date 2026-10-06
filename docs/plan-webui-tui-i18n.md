# Plan: team GUI, rounded settings, TUI model menu, and bilingual surfaces

Process record (AGENTS.md §3: `docs/plan-*.md` is exempt from the bilingual rule). English-only.

This file is the **DESIGN CONTRACT** for the wave. Every lane builds against it; a lane that needs
it changed asks the captain, and the captain amends it here in the same breath. It records what was
MEASURED on the installed harness before any UI code was written, so the tokens and seams below are
citations, not taste.

## 1. The user's four requirements, restated as acceptance

| # | Requirement (user's words) | Acceptance |
|---|---|---|
| R1 | 团队依赖与成员有一个完整的 GUI 显示（类似 dsh-agent-teams） | The harness right sidebar Team tab renders every member of the team **and** the task dependency graph: rank columns by `depth`, a drawn edge per `blockedBy`, a hover focus chain, and a task detail body. "完整照做，但成员卡的 UI 不必那么花哨" — the reference's ELEMENTS, none of its raster mascots. |
| R2 | MPD 的设置菜单参考 DSH 官方设置做成圆角化界面 | Every control in the MPD settings card uses the harness's own design tokens (below), so it is indistinguishable in rhythm and radius from `General / Models / Built-in plugins / Agent presets` sitting beside it. |
| R3 | TUI 做完整的选择式模型设置菜单 | A `/mpd-model` command that opens a real pick-list (arrow keys + Enter) over the LIVE model catalog: slot → provider → model → reasoning effort, writing through the settings entry. |
| R4 | 所有的 TUI/WEB 界面都要做成中英文双语 | Every user-visible string on both surfaces resolves to zh or en from the active language. |

## 2. The design tokens (MEASURED, not invented)

Read from the installed harness's own primitives —
`/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/`,
files `settings-form/fields.module.css`, `settings-form/SettingsForm.module.css`, `Button.module.css`,
`Switch.module.css`. The MPD card currently hardcodes `borderRadius: 8` and renders raw browser
`<input>`/`<select>`; that is the whole of R2's gap.

**Radius scale** — `--dsw-radius-xs` · `--dsw-radius-sm` · `--dsw-radius-md` · `--dsw-radius-lg`
(the harness body also carries a global *superellipse*; capsules opt out with `corner-shape: round`).

**Colour / label aliases** — `--dsw-alias-label-primary` · `-secondary` · `-tertiary` ·
`--dsw-alias-bg-layer-1|3|4` · `--dsw-alias-border-l1|l2|l3|l4` ·
`--dsw-alias-interactive-bg-hover` / `-active` · `--dsw-alias-button-primary-fill` / `-hover` ·
`--dsw-alias-brand-primary` · `--dsw-alias-state-success-primary` · `-warn-primary` · `-error-primary` ·
`-business-primary` · `--dsw-focus-ring-width` / `--dsw-focus-ring-color` ·
`--dsw-elevation-panel` / `--dsw-elevation-prominent` (and `--dsw-elevation-stroke-color`).

**Field rhythm (the official `fields.module.css` verbatim intent):**

| Element | Contract |
|---|---|
| field | `display:flex; flex-direction:column; gap:6px; padding:12px 0` |
| field separator | `border-top: 0.5px solid var(--dsw-alias-border-l2)` on every field but the first |
| label | `font-size:13px; font-weight:500; line-height:1.5; color:var(--dsw-alias-label-primary)` |
| hint | `font-size:12px; line-height:1.5; color:var(--dsw-alias-label-tertiary)` |
| control (input/select) | `height:34px; padding:0 12px; border:0.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-3); font-size:13px` |
| control focus | `outline:none; border-color:var(--dsw-alias-state-business-primary)` |
| control disabled | `color:var(--dsw-alias-label-tertiary)` |
| form footer | `display:flex; align-items:center; gap:8px; padding-top:16px` |
| save button | `border-radius:var(--dsw-radius-md); padding:5px 14px; font-size:13px; background:var(--dsw-alias-label-primary); color:var(--dsw-alias-bg-layer-3)` |
| reset link | `font-size:12px; color:var(--dsw-alias-label-secondary)`, hover → `label-primary` |
| focus ring | `outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset:1px` |
| button | `border-radius:var(--dsw-radius-md); height:36px (md) / 28px (sm); font-size:14px / 12px; padding:0 14px / 0 10px` |
| switch | track `36×20; border-radius:999px; corner-shape:round`; on → `--dsw-alias-brand-primary`; thumb `16px circle`, `transition: transform 120ms ease` |

**Fallback discipline (BINDING).** The harness page may not define a given alias in every theme, so an
inline style reads it WITH the pre-existing fallback that token already has in this bundle
(`var(--x, #hex)`). A bare `var(--dsw-…)` that resolves to nothing renders a transparent control —
the current card pairs every token with a literal for exactly that reason, and that pairing survives.

**No emoji as icons** (the bundle's own rule). The existing vocabulary is text glyphs + CSS shapes:
`●` status dot, `✓ ◐ ✗ ○ ⊘` state glyph, `‹ ›` as the native select's own affordance, `⇠` for an
incoming dependency edge, `→` for an outgoing one, `@` for an owner. No new image asset is added.

## 3. R1 — the team GUI contract

**Where it renders.** `packages/mpd-bundle-plugin/src/team-view.ts` (`createTeamView`) is the ONE body
both sidebar hosts render, and the ONE place the GUI changes. It reads two of this bundle's own routes:
`/plugins/mpd-team/state` and `/plugins/mpd-team/plan` (`TEAM_STATE_PATH`, `TEAM_PLAN_PATH`). A third
route, `TEAM_MAIL_PATH` (`/plugins/mpd-team/mail`), is already registered and serves the mailbox fold —
it is in scope for the per-member "unread" figure.

**The four panels, top to bottom** (the reference's `AgentTeamsCard` structure, measured from
`packages/mpd-agent-teams-plugin/assets/ui.png`):

1. **HEADER** — team `name`, `phase` chip, `approvedAt` when set, and the workspace basename. Plus the
   team-level figures the reference shows: complete/total, and the running/waiting/delivered triple
   that `counts` already carries (`running`, `ready`, `completed`).
2. **PROGRESS BAR** — one bar, `completed / total`, drawn with `--dsw-radius-sm` and a
   `--dsw-alias-state-success-primary` fill over `--dsw-alias-bg-layer-4`.
3. **MEMBERS** — one card per member, PLAIN (user's ruling: "不必那么花哨"): a status dot, the display
   name, the `role` chip, the `route` (`provider/model`) in tertiary text, the member's CURRENT task
   (`current`) truncated, and its `done/total` fraction right-aligned. No raster avatar, no per-member
   mascot, no animated state art. Colour comes from the state, never from decoration.
4. **TASK DEPENDENCIES (the DAG)** — the part that does not exist today:
   - one column per `depth` rank (the payload's `depth` is already the longest dependency path, so the
     columns are correct without re-deriving a layout);
   - one node per task: `id`, the `kind` abbreviation (`REQ/WRK/REV/FIX/INT` — the vocabulary
     `team-view.ts#KIND` already declares), the state glyph, and the subject truncated;
   - one **drawn edge** per `blockedBy` entry that names a task on this board. Horizontal lead-in,
     vertical riser, horizontal lead-in — plain absolutely-positioned divs, no SVG, no measuring pass,
     so the drawing cannot disagree with the data. `rank(child) > rank(parent)` always holds for a
     well-formed board, so the riser never crosses a column;
   - `cycles` non-empty ⇒ the entry is reported, never hidden (the payload already carries the cycle).
   - **HOVER FOCUS CHAIN** — hovering a node tints its transitive ancestors and descendants and dims
     the rest, which is what the reference's "悬停高亮依赖链 · 点击固定" does. Implemented with the
     node's own `onMouseEnter`/`onMouseLeave` only; no document-level listener, no layout effect.
5. **TASK DETAIL** — clicking a node pins it (the reference's "点击固定") and renders a detail body
   under the graph: subject, kind, status, owner, `attempt`, `round`, `verdict`, the blockers
   (`⇠ T1, T2`) and the dependents (tasks whose `blockedBy` names this one), and the frozen acceptance
   contract when `TEAM_TASK_PATH` serves one for this id.

### 3a. THE MACHINE-READABLE HOOKS (BINDING — the capture driver asserts on these, not on prose)

Hover and click cannot be witnessed by a screenshot alone, and the driver must not guess at class
names. The view therefore carries these attributes, and they are the ONLY contract between the view
and `docker/ui/capture.mts` (an attribute whose name drifts makes the proof fail loudly rather than
silently pass):

| Attribute | On | Carries |
|---|---|---|
| `data-mpd-team-tab` | the view's root element | the team id, or empty when no team |
| `data-mpd-graph` | the graph container | `ranks=<n>` and `edges=<n>` — the rendered counts |
| `data-mpd-rank` | each rank column | the rank number |
| `data-mpd-node` | each task node | the task id (`T1`) |
| `data-mpd-edge` | each drawn edge | `<child><-<parent>` (`T2<-T1`) |
| `data-mpd-detail` | the pinned detail body | the pinned task id; ABSENT while nothing is pinned |
| `data-mpd-focus` | the graph container | `chain` while a hover chain is active with ≥1 related node, `none` otherwise |

### 3b. BOARD ROBUSTNESS (BINDING — the payload can carry both, so both are rendered, not assumed)

- **A `blockedBy` id that names NO task on the board draws NO edge.** The payload serves `blockedBy`
  raw while `taskDepths` drops unknown ids, so an endpoint-less edge is reachable in real data; the
  node is still reported `blocked` (the store's own rule) but nothing is drawn to nowhere. The
  `data-mpd-graph` `edges=` count is the number of edges actually DRAWN, which is the payload's own
  `links` semantics.
- **A cycle is clamped, never computed backwards.** The store's `taskDepths` resolves a revisited node
  to rank 0, so a back-edge can point right-to-left; its riser width is `Math.max(0, …)` and a
  negative or NaN length is impossible by construction, with the cycle itself reported (never hidden).
- **An empty team, an empty board, and a member with `total: 0` each keep their existing rendered
  shape** — the plan branch and the `No shared task yet — the captain posts them with
  team_task_create.` sentence stay byte-for-byte, and a `0/0` member renders as a fraction with no
  percentage.

**An empty state names the call that fills it.** `TASKS (0)` reads
`No shared task yet — the captain posts them with team_task_create.` and that sentence STAYS.

**No backend work is required for R1.** `TeamWebTask` already carries `id, subject, kind, status,
visual, owner, attempt, round, verdict, blockedBy, failedBy, depth`, `TeamWebState` carries
`counts, members, cycles, executor, problems`, and `TeamWebMember` carries `id, name, role, status,
done, total, current, route`. A lane that wants a NEW field asks the captain; a client-side DERIVATION
from these fields is preferred, because the projection is `buildTeamState` in
`packages/mpd-team-core-plugin/src/team-web.ts` and both the TUI and the Web read it.

## 4. R3 — the TUI model menu contract

**MEASURED, so the design cannot drift from the host:** the plugin already has the seam.
`packages/mpd-tui-plugin/src/dialogs.ts#createDialogs` wraps
`TuiAdapter.dialogs()` → seam `tuiDialogs`, and `select({title, options})` parks a host modal that
focuses a windowed list (↑/↓), settles the option **id** on Enter, and cancels on Esc/Ctrl+C. The
plugin already uses it for the `/mpd` picker, the `alt+w` workmate picker and the watchdog dialog.

**The command.** `/mpd-model` — one async handler, registered with the others in
`packages/mpd-tui-plugin/src/commands.ts` and completed by `command-trees.ts`:

1. read the live catalog through the SAME reader `settings.ts#resolveCatalogReader` uses
   (`tui.llmCatalog()` → `DshLlmCatalog`), so the menu and the settings rows cannot disagree;
2. panel 1 = the slot (`1..4`, each labelled with its member group — heavy / analysis / execution /
   vision, the labels `mpd-config-plugin/src/settings-schema.ts` already declares);
3. panel 2 = the provider (catalog provider ids, label = the catalog name);
4. panel 3 = the model (the union of that provider's models when the catalog is keyed, else the
   union of all — never an empty list);
5. panel 4 = the reasoning effort (the union of the chosen model's efforts);
6. **write** through the same path the section writes with (the settings entry `mpd-config`), then
   report the outcome with the SAME disclosure the section carries (`BRIDGE_DISCLOSURE`,
   `BRIDGE_NOT_LOST`) — a menu that silently changed nothing, or claimed a live effect, is the exact
   failure the disclosure exists to prevent.

**Degradation is explicit.** An unbound dialogs seam, an absent/degraded catalog, a cancelled panel
(`undefined`) and a refused write each end the chain with ONE sentence naming which of them happened.
Cancel at any panel writes nothing.

## 5. R4 — the language strategy (MEASURED, and it is NOT symmetric)

The two planes localize DIFFERENTLY, and the difference is a fact about the installed hosts:

**Web: the host owns the language, and the client already uses it.** The client locale registry is
reached through `ctx.locale.bind(ns)` / `ctx.locale.register(ns, {zh, en})`. Four namespaces are
already registered with BOTH dictionaries (`mpdSettings`, `mpdTeamSidebar`, `mpdWorkmate`,
`mpdAgentTeams`), and the harness's own UI resolves them per render, so a language switch is live.

**TUI: the host exposes NO language seam to plugins.** `TUI_SEAMS` names fifteen `tui*` services and
none is i18n/lang, and `lib/types/api.d.ts` does not re-export `i18n.d.ts`. What the host DOES offer
is per-contribution localized FIELDS, which it resolves with its own active language:
`TuiCommandTreeProvider.descriptions`, `TuiSettingsSection.descriptions`,
`TuiSettingsField.descriptions` / `.hintDescriptions`, `TuiSettingsFieldOption.descriptions`.
**Those fields are the primary mechanism and must always carry both `zh` and `en` — the host then
follows `/lang` for free.** What they cannot cover: a scene `title`, a shortcut `description` and a
status entry's `text` have no localized field in the installed host types.

**CORRECTION (measured 2026-10-05, and it replaces an earlier claim in this document): a plugin
command's own description CANNOT be localized, and `LocalCommand.descriptions` is UNREACHABLE.**
`dsh-commands`' `normalizeDefinition` rebuilds every definition as
`{definitionId?, name, description, input?, recordInput?, handler}` and DROPS unknown fields, so a
`descriptions` field handed to a command registration never survives to the registry. The string a
user sees in the slash menu comes from the command TREE node, whose `descriptions` DOES reach the
renderer. So: localize the command-TREE entry, and treat a command's own `description` as
English-base text that the host's own `tOr('cmd-desc-<name>', description)` fallback covers — never
as an R4 gap, and never as something a lane should fight the harness over.

**CORRECTION 2 (measured 2026-10-05): a `zh`-only map is the HOST'S OWN pattern, not a defect.**
The harness's shipped settings definitions pass `hintDescriptions: { zh: … }` with the English living
in the base `label`/`hint`, and `localizedDescription` resolves `descriptions[lang] ?? <English
base>`. Adding a redundant `en` twin to 26 fields whose English is already the base is noise. The
REAL R4 gaps on this plane are: (i) surfaces with no localized field at all — scene titles, shortcut
descriptions, status text and the plugin's own literals; (ii) `hintDescriptions` never being used, so
the 26 hints stay English while the rest of the screen is Chinese; (iii) a command-tree root whose
English base must be verified to render as English rather than as a raw key.

For those uncovered strings MPD resolves the language itself, reusing the HOST'S OWN chain, read from
the host's shipped implementation (`lib/types/i18n.js#resolveStartupLang`, `#readLangPref`,
`#detectLocaleLang`):

| Order | Source | Read by MPD as |
|---|---|---|
| 1 | `DSH_TUI_LANG` (`en`/`zh`) — pinned at process start, wins over everything | `process.env.DSH_TUI_LANG` |
| 2 | the persisted `/lang` choice in `~/.dsh-tui/lang.json` (`{ "lang": "en" }`) | a file read |
| 3 | the OS locale guess | `LC_ALL` / `LC_MESSAGES` / `LANG`; see the rule below |
| 4 | `zh` (the host's own default) | constant |

**THE LOCALE RULE, EXACTLY (a divergence here is a defect, not a detail).** The host reads
`process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || ''` with `||` and not `??`, so an
EMPTY variable is treated as unset and falls through to the next one; it then splits on `.`, lowercases,
and returns `zh` only when the prefix starts with `zh` — **otherwise `en`**, and `zh` only when the
whole chain is empty. So `C.UTF-8` maps to **en**, not zh. A resolver that maps "not zh" to `zh`
disagrees with the host on any CI-ish locale, which is exactly the environment a lane's own tests run
in. MPD must reproduce this rule verbatim, and its tests must pin the `C.UTF-8 ⇒ en` case.

**BINDING limits, stated rather than papered over:**

- MPD's own resolution is evaluated **at use**, so it follows a restart and the next render/command
  after a `/lang` switch — it is not a per-frame subscription, and no surface may claim one.
- The host-resolved contribution fields (`descriptions`) follow `/lang` natively and are preferred
  wherever a field exists. A string that HAS such a field is never routed through MPD's own lookup.
- `~/.dsh-tui` is an absolute path under the user's HOME and is READ ONLY, never written: MPD owns no
  language preference of its own, and `/lang` stays the single switch. (Not `DSH_HOME`: the host's
  preference directory is resolved from the home directory, which is why QA must set `HOME`.)

**Every lane with a UI surface owns its own dictionary module.** `packages/mpd-tui-plugin/src/i18n.ts`
(TUI) and the Web dictionaries in `mpd-bundle-plugin/src/**` are separate files in separate packages —
no shared file, so no lane can conflict on one.

## 6. Work split (write scopes are DISJOINT; overlap is a defect)

| Lane | Owner | Write scope | Deliverable |
|---|---|---|---|
| L1 | Senior Engineer (web-team) | `packages/mpd-bundle-plugin/src/team-view.ts` | R1: the four panels + the DAG + the focus chain + the detail body, bilingual through the `mpdTeamSidebar` dictionary |
| L2 | Senior Engineer (web-settings) | `packages/mpd-bundle-plugin/src/settings-card.ts` (+ its `web-client.ts` registration line ONLY when strictly required, announced to the captain) | R2: the card rebuilt on the token table in §2; R4 for the card |
| L3 | Senior Engineer (tui) | `packages/mpd-tui-plugin/src/**` | R3: `/mpd-model` + pick-list chain; R4: `i18n.ts` + both-language contribution fields + the uncovered strings |

**Why the captain holds `web-client.ts` and the server route.** L1 and L2 both touch
`packages/mpd-bundle-plugin/src/web-client.ts` if they each redesign their registration; the captains'
rule is one writer per file, so `web-client.ts` and the `mpdTeamSidebar` dictionary's registration
site are amended by the captain between lanes. `packages/mpd-team-core-plugin/src/**` is read-only for
this wave: R1 needs no new field.

## 7. What proves it (per AGENTS.md §4/§7)

- static: `bun test packages`, `bun run typecheck`, `bun run verify:comments`, `verify:rows`,
  `verify:dist-fresh` (dists REBUILT), `verify:docs` after the doc pairs land;
- a real boot that MOUNTS the rows in an isolated `DSH_HOME` + sandbox `HOME` + sandbox workspace;
- **R1/R2 visually, on the real machine**: `docker compose -f docker/ui/docker-compose.yml up -d
  --build`, then `docker/ui/capture.mts` against the container's own headless Chromium, with the
  screenshots read back and the report's console errors checked;
- **R3 on the container's real TUI** via `tmux capture-pane`, with the pick-list panels driven.

A lane's own green test is not the wave's proof: the captain re-runs the gates and reads the
screenshots. A capture that predates the change it claims to verify is a stale-evidence defect
(measured in this repository before) — every screenshot is checked against the run's timestamp.

## 8. Status (updated as the wave lands)

| Item | State |
|---|---|
| Contract written from MEASURED tokens/seams | DONE (`docs/plan-webui-tui-i18n.md`, this file) |
| §3a state attributes + §3b board robustness | ADDED after the pre-review proved hover and click are otherwise unwitnessable |
| §5 corrections (command description unlocalizable; `zh`-only is the host's pattern; the exact locale rule) | ADDED after the pre-review measured them |
| `docker/ui/capture.mts`: step `07-team-graph-interaction` (real mouse hover + click) and the `data-mpd-*` assertions | DONE |
| `docker/ui/capture.mts`: the settings BINDING proof (`input.value`, because `innerText` cannot see it) | DONE |
| `docker/ui/team-fixture.mts` + `seed-team-fixture.sh` (`normal` and `malformed` boards) | DONE; the malformed board derives `cycles: ["T7","T8"]`, `links: 7` and a real right-to-left cycle edge through the shipping `buildTeamState` |
| Adapter `hintDescriptions` widening (L3's stop-and-ask, approved) | DONE (captain-owned; the dist fan-out is rebuilt once at integration) |
| L1 team GUI / L2 settings card / L3 TUI menu + bilingual | lanes DONE (reports + tests below) |
| Adapter `hintDescriptions` widening + `/mpd-model` write target corrected to the config ENTRY | DONE (captain; the host resolves a mutate key against its descriptor list keyed by profile entry id, so the lane's legacy-namespace fallback could only ever be refused) |
| web-client translator threading + the 35-key `mpdTeamSidebar` dictionary (en+zh, key-identical) | DONE |
| Single pinned-toolchain dist rebuild (`bun@1.4.0` from `.toolchain`, NOT the system 1.4.2 — a different bun minor rewrites the emitted bytes and the gate reddens on all 29 targets) | DONE, `verify-dist-fresh` 29/29 fresh |
| Static gates | `bun test packages` 1524 pass / 0 fail; `verify:comments` PASS; `verify:rows` 33 ids; `verify:docs` PASS; `typecheck` clean in every file this wave touched |
| **R2 VERIFIED ON SCREEN** | `evidence/webui-tui-i18n/integration/shots/04-settings-mpd.png` — the MPD section renders rounded 34px controls, hairline field separators and tertiary hints, consistent with the official sections beside it, and the two bound fields read `20000` / `true` from the seeded `.mpd/mpd.jsonc` (`report.json` → `mpdBindingProbe {diffLimit:"20000", autoCheck:"true", controls:28}`) |
| **R1 VERIFIED ON SCREEN, and the layout asserted** | `06-team-panel.png` + `07-team-graph-hover.png` in `evidence/webui-tui-i18n/integration/shots/`, with `report.json` carrying the machine-readable half: `data-mpd-graph="ranks=4 edges=4"`, nodes `T1..T6`, edges `T4<-T1, T4<-T3, T5<-T4, T6<-T5`, `teamFocusWhileHovered="chain"` → `teamFocusAfterLeave="none"`, and `teamDetailAfterClick="T6"` |
| **R3 VERIFIED ON THE TUI** | the four panels render in the container's live TUI (`MPD 模型槽位 → MPD 提供商 → MPD 模型 → MPD 推理强度`) and the chosen route LANDS: `/data/dsh-tui/profiles/dsh-tui/cordis.patch.yml` gained `teamModels.slot3 {provider: deepseek-official, model: deepseek-flash, reasoningEffort: off}` — the exact values the walk selected |

### 8a. R1 — CLOSED, and how the blocker was actually broken

**The blocker was session SELECTION, not the panel.** The Web app renders a session of its own
choosing rather than the one a driver creates through the RPC, so a board seeded for the created id
never reached the panel on screen: the view fetched `/plugins/mpd-team/state?sessionId=<id>` for a
session nobody had seeded, got `team:null`, and correctly drew its empty state. Three earlier attempts
failed for three DIFFERENT reasons, each measured and each recorded in the tooling's own comments
(`docker exec -e NAME` delivered an empty string; `.ts` under `/data` is CommonJS; `page.evaluate(async
fn)` is not evaluated in the page in this playwright build).

**What closed it.** Two changes, neither of them a product change:

1. **The view reads the session from the host's own DOM marker when the props do not carry one.**
   `team-view.ts#sessionIdFromPane` falls back to `[data-sidebar-right-session]` — the attribute the
   right sidebar itself publishes on the pane. This is a MEASURED host behaviour, not a guess: the
   sidebar renders a tab body with an EMPTY props object (`renderSlot(seat, {}, …)`), and its session
   markers are SIBLINGS of the pane rather than ancestors of the body, so neither the props nor a
   parent walk can reach them. Without this the panel could never address the session it is displayed
   for on this harness build.
2. **The driver seeds every session the app's own store holds**, right after it creates its own —
   `capture.mts#listSessions` enumerates `<DSH_HOME>/sessions/*/*` and `seedBoard` binds the board to
   each. That removes the guess completely, and it is cheap because the fixture is idempotent.

**The layout is now asserted, not eyeballed.** A screenshot shows that something is drawn; it cannot
show whether two node boxes COLLIDE. `report.teamNodeBoxes` records every node's measured viewport box
and `checks.teamGraphNodesDoNotOverlap` fails on any intersecting pair. Measured on the shipped build:
`T1/T2/T3` at `x=897` rows `574/626/678`, `T4/T5/T6` at `x=1065/1233/1401` row `574`, **0 overlaps** —
a 168px column pitch with 52px rows, so the two edges that appear to pass near a node in the PNG are
clearly outside its box.

### 8b. Defects this wave found and fixed in its OWN tooling

| Defect | Where | Why it mattered |
|---|---|---|
| `command -v node` guarded an install of bun/pnpm/dsh/tmux | `docker/ui/entrypoint.sh` | the shared E2E image ships node but not the rest, so the guard skipped the whole install and the container booted "healthy" with 63 bytes of Web log |
| the toolchain lives in a NAMED volume, so a rebuilt image does not replace it | `docker/ui/entrypoint.sh` | `/data/capture.ts` survived the rename and the runner kept invoking it; the stale name is now removed explicitly |
| `.ts` executed from `/data` is CommonJS | `capture.mts`, `team-fixture*.mts` | `import` outside a module; `.mts` is ESM regardless of any package.json |
| a payload in an env var | `seed-team-fixture.sh` | `docker exec -e NAME` (inheriting form) delivered empty, writing zero-byte fixtures |
| a nested-quoted heredoc splitting two base64 blobs | `seed-team-fixture.sh` | the mangled `awk` program failed as "a part did not arrive" |
| `page.evaluate(async fn)` runs outside the page | `capture.mts` | `document is not defined`; the two pre-existing collectors are sync and now so are these |
| the eval'd collector read `globalThis.document` | `capture.mts` | `undefined`; the bare `document` global is what the page exposes |
| `innerText` cannot witness an `<input>` value | `capture.mts` | the R2 binding claim was structurally unprovable; `mpdControlsBound` reads `input.value` |
| the fixture was imported for its side effect | `team-fixture.mts` | an import ran the CLI and `exit(2)` |
| the graph's hover/click had no machine-readable hook | `team-view.ts` (L1, contract §3a) | no screenshot can witness a hover |
| Integration (translator threading, single dist rebuild, doc pairs) | pending |
| Reviewer pass on the integrated diff | UNPROVEN — the reviewer reported its PRE-review (5 items, 2 contract defects caught and fixed) but its post-integration pass was not run before this wave stopped. Its `task-8` is unclaimed and the tree it would have read is frozen below. |
| Docker Web capture | DONE for the settings half; R1 partial (see §8a). Stack torn down after the run. |
| tmux TUI `/mpd-model` capture | **DONE** — see the R3 row above; the walk was driven with `tmux send-keys` against the live container TUI and the resulting patch file is the proof. |
| Commit | NOT MADE. The captain is the single git writer and the USER has not asked for a commit, so the tree is left uncommitted on `dev` with everything green. |

### 8c. The tree this wave leaves, verified at the moment of stopping

- `bun test packages` → **1527 tests, 1524 pass, 3 skip, 0 fail**.
- `node scripts/verify-dist-fresh.ts` → **29/29 targets fresh** (rebuilt with the PINNED `bun@1.4.0`
  from `.toolchain`, not the system 1.4.2 — a different bun minor rewrites the emitted bytes and the
  gate reddens on every target).
- `bun run verify:comments` → PASS. `bun run verify:rows` → 33 ids. `bun run verify:docs` → PASS.
- `bun run typecheck` → the ONLY remaining diagnostics are four pre-existing ones in
  `skills/programming/scripts/typescript/check-no-excuse-rules.ts`, untouched by this wave (`git status`
  confirms the file is unmodified).
- `packages/mpd-tui-adapter-plugin` (the `no-direct-tui-access` gate) + `no-terminal-writes` → 34 pass.
- The macOS/`chromium` capture artifacts are copied to
  `evidence/webui-tui-i18n/integration/shots/`; the rebuild log is beside them.

**Pre-existing defect recorded while pairing the board (not this wave's):** the retired vendored
plugin's `agent_teams_dispatch` refuses with `no team record in this workspace` because it looks for
the legacy `<ws>/.mpd/team/<teamId>/team.json` layout that `mpd-team-core-plugin` replaced with
`.mpd/team/teams/<teamId>.json`. Shared-board pairing therefore has no working automatic path: the
captain pairs by message. Fixing that surface is a separate wave; it is named here so a reader does
not mistake it for a regression this change introduced.
