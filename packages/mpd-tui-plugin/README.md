# mpd-tui — DSH-TUI surfaces for `@mpd-dsh/mpd`

[中文](./README.zh-CN.md)

`packages/mpd-tui-plugin` gives the `@mpd-dsh/mpd` bundle a TUI-native face. It
is a single Cordis plugin row (`mpd-tui`) whose module specifier is owned by the
bundle patch:

```text
@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js
```

There is **no `cordis.patch.yml` inside this package on purpose**: the bundle
patch (`cordis.patch.yml`) owns the row, and a second mount
would duplicate a loader entry id (the loader rejects duplicates outright).

## What it provides

| Seam | Host service | What the user gets |
|---|---|---|
| Status line | `ctx.tuiStatus` | one keyed `mpd` contribution above the prompt: `mpd: team … · boulder … · plans … · workmates …` |
| Transcript renderers | `ctx.tuiRenderers` | the bundle's log-only session events (`agent-teams/*`, `mpd-tui/board-opened`) as plain text rows, live and on replay |
| Settings section | `ctx.tuiSettingsSections` | the mpd.jsonc knobs — the original 13 plus the twelve `teamModels` slot leaves (25 in all), the slot leaves rendered as **catalog-driven selections** — declared as editable `/settings` fields, **bridged** to `<workspace>/.mpd/mpd.jsonc` (a save writes the file; the plugin behaviour needs a restart); every field hint says so on screen (see NOT CLAIMED #2) |
| Full-screen board | `ctx.tuiScenes` | team + task ledger, boulder work ledger, plans, workmate library; two extra rows for a routed team: `team-plan …` (staged only) and `team-hold held (…)` (only while a watchdog hold lasts) |
| Team workflow scene | `ctx.tuiScenes` | `mpd-tui-team` — open with `/mpd team`, or `a` while the board is open: team id/name/phase, plan-review state, the watchdog hold, the roster (role/model/status/progress/current task) and the task DAG (kind/status/assignee/attempt/round/verdict/deps, depth-indented, `failed-dep=` marked) plus the mailbox tail |
| Plan scene (READ-ONLY, 0.1.7) | `ctx.tuiScenes` | `mpd-tui-plan` — open with `/mpd plan`. It renders the live board and states that no approval flow exists on the official Agent Teams plane; the retired type-the-phrase / `Ctrl+X` approval and the `Ctrl+D` discard are gone with the tools that served them (`agent_teams_approve`, `agent_teams_delete` are registered by no row) |
| Command tree | `ctx.tuiCommandTrees` | `/mpd board`, `/mpd team`, `/mpd plan`, `/mpd status`, `/mpd workmates` completion |
| Shortcuts | `ctx.tuiShortcuts` | `alt+m` board · `alt+a` the subagents + team panel · `alt+t` team workflow · `alt+w` workmate picker · `alt+r` refresh the status line |
| Merged panel | `ctx.tuiScenes` | `mpd-tui-subagents` — the host's own subagent rows (with its running/completed/failed counts), the team body, and the task DAG whose every drawn edge ends in a directional `▼` with a legend under it: open with `alt+a`, or with **`Ctrl+A`** whenever the workspace holds a team (the take-over below). `enter` opens the selected subagent's detail, `i` interrupts the selected live run, a click selects a row |
| `Ctrl+A` take-over | a `ctx.tuiStatus` view + the adapter's host-input contact | `Ctrl+A` opens the merged panel instead of the host's own dashboard while the team projection holds a team with at least one task; with no team — or on a host whose input bus the adapter cannot reach — the key behaves exactly as before (`tui.dashboardKey`, default `true`; see NOT CLAIMED 7-9) |
| Dialogs | `ctx.tuiDialogs` | the mediated workmate picker (`select`) |
| Decision events | `tuiPluginHost.subscribeDecision` | attempted, expected to be refused, **not activated** (see below) |

Supporting surfaces (not one of the seven seams): the `/mpd` command on the
harness command registry, the `mpd` settings namespace registration, and the
log-only `mpd-tui/board-opened` session record.

### The dependency graph: arrows, the legend and the `Ctrl+A` take-over

`src/graph.ts` draws the board three ways and picks the widest one the terminal fits: `boxes` (a layered
DAG whose vertical axis is the longest dependency path, so a chain reads top to bottom), `rail` (an
indented forest for a narrow terminal) and `list` (a rank-grouped table for a very dense board). Every
DRAWN dependency edge ends in a directional arrowhead — `▼` in `boxes`, `▸` in `rail` — pointing INTO the
dependent, and a fan-in of several blockers still shows exactly ONE arrow: the merged entry is written as
text rather than as a junction, because no direction bit can say "…and the dependency points into this
box". Both callers (the team scene and the merged panel) render `legendLines(width)` directly under the
drawing; it names both marks, the five state glyphs (read from the same table the drawing paints) and the
focus marker, and it drops a sentence rather than cutting one when the terminal is narrow.

`Ctrl+A` opens the merged panel — the host's own subagent rows with their counts, the team body and that
DAG — whenever the workspace's team projection holds a team with at least one task. The host's built-in
`dashboard` action owns that key and no contribution kind can reach its component, so the adapter loads
the host's own `useStdin` (see `packages/mpd-tui-adapter-plugin`) and a zero-row status view prepends a
listener that consumes the key first. With no team the listener touches nothing, and every failure — an
unreachable host module, a version-skewed one, the `tui.dashboardKey` knob off — degrades to exactly
today's behaviour. `skills/dsh-qa/scripts/tui-deps-ctrla.ts` proves both arms (and the settings-screen
control) on a real PTY.

ONE HOST CONSTRAINT, stated because it changes what you see: the live input context is only ever handed
to a SCENE render, so the take-over arms itself from the first MPD panel or scene you open in a session
(`alt+a`, `alt+t`, `alt+m`, `/mpd board`, …). Before that — and on any host that answers a plugin's own
import with a foreign module instance — the hook attaches nothing and `Ctrl+A` opens the host dashboard
exactly as it does without this bundle. Opening the panel once is enough for the rest of the session.

### Team-model slot fields are catalog-driven selections

The twelve `teamModels` leaves (`slot{1,2,3,4}.{provider,model,reasoningEffort}`) are
declared `select` fields. The host renders a `select` by CYCLING a **frozen** option
list (there is no pick-list dialog), so their options are computed **at registration**
from the model catalog the adapter reports — `mpdDsh.llmCatalog()`, the additive seam
documented by `packages/mpd-dsh-adapter-plugin`:

- **provider** options = the catalog's provider ids (label = the provider name);
- **model** options = the union of every provider's model ids (labels = model names);
- **reasoning effort** options = the union of every model's effort ids (labels = effort
  names).

Every value is the raw id the settings document stores (so `deepseek-official` /
`deepseek-v4-flash` / `max` stay the vocabulary the config layer reads). When the
catalog is unavailable or **degraded** (`{ providers: [], degraded: true }` — also the
shape an adapter build without the seam produces), each field falls back to the
declared `TEAM_MODEL_FALLBACK_OPTIONS` of the shared schema: a slot field is therefore
never registered with an empty list and never requires typing. Because the catalog read
is async and the host freezes the list at register time, the section registration is
deferred by one microtask chain while the catalog is read (the host registry's own
late-registration seam); a reader without the seam registers synchronously with the
declared lists. The branch that produced the options is logged on every registration:
`settings section mpd slot options: provider=live(N)|declared(N) model=… reasoningEffort=… catalog=live|degraded|unavailable`.

The board is the TUI-native equivalent of the web-only surfaces (agent-teams
sidebar, workmate tab). It reads state — it never writes:
- the OFFICIAL Agent Teams readout (`dsh.teamLiveTeams()`, through the adapter — 0.1.7:
  the retired `.mpd/team/<teamId>/team.json` is gone, and a SOLO session is not shown as a team)
- `<workspace>/.mpd/boulder.json`
- `<workspace>/.mpd/plans/*.md`
- `$HOME/.mpd/workmate/<key>/meta.json` (the durable workmate library)

Every path is resolved per call under the **calling session's workspace**
(`packages/mpd-dsh-adapter-plugin`'s `workspaceRoot` / `workspaceRootsAll`),
never the dsh process cwd.

The read-only rule is not a policy statement here, it is a property of the built
bytes: the package contains no write primitive. 0.1.7 made it STRONGER: the two plan
actions used to be tool calls through the adapter (`agent_teams_approve`,
`agent_teams_delete`), and both tools are RETIRED with no official replacement, so the
plan scene can no longer mutate anything at all — every refusal says exactly that.

**Where each Web-edition surface stands against its TUI counterpart** is answered
row by row in `docs/tui-parity.md` (+ `docs/tui-parity.zh-CN.md`): status, reason
and evidence level per surface, with the still-open deviations recorded rather than
smoothed over. Read it before quoting a parity claim from this file.

## Static assets

- `themes/mpd-tui.json` — a dark TUI theme (a partial colour override). The
  theme seam is a static asset by design: copy the file into
  `~/.dsh-tui/themes/` to make it selectable. This row does **not** install it.
- `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` — an asset only; see "What is NOT claimed" #4.

## Plugin contract

- pure ESM, `.js` suffixes on relative imports;
- `name` / `Config` (type) / `Config` (schemastery schema) / `apply`, **no
  default export**;
- every config key defaulted in both the schema and the resolver;
- cleanup owned by `ctx.effect`;
- every optional service probed with `ctx.get(id, false)` and degraded with a
  diagnostic — `apply` never throws when a service is absent, so the row is
  inert in a web composition and live in a `dsh-tui` composition.

Harness seams (tools, skills, agent registry, subagents) are not touched here:
they go through `packages/mpd-dsh-adapter-plugin`. The `tui*` services,
`ctx.commands` and `ctx.settings` are host services consumed directly with a
soft probe, which is the host's documented idiom.

### Config keys

| Key | Default | Effect |
|---|---|---|
| `statusLine` | `true` | publish the keyed status contribution |
| `statusIntervalMs` | `3000` | refresh cadence; `0` keeps it manual (`alt+r`, `/mpd status`) |
| `renderers` | `true` | register the transcript renderers |
| `settingsSection` | `true` | declare the `/settings` section (and the `mpd` namespace) |
| `scene` | `true` | register the board scene |
| `commandTrees` | `true` | register the `/mpd` completion tree |
| `commands` | `true` | register the `/mpd` command (the board's opening path) |
| `shortcuts` | `true` | register the key bindings |
| `dashboardKey` | `true` | arm the `Ctrl+A` take-over: with a team in the workspace `Ctrl+A` opens the merged panel, and with no team (or with this off) the key keeps the host's own meaning. UNLIKE every other knob here it is read PER KEYPRESS through the config layer, so a `/settings` save applies without a restart. The take-over itself arms once the host has handed this session its live input kit — i.e. after any MPD scene or panel render (NOT CLAIMED 12) |
| `dialogs` | `true` | enable the mediated dialog facade |
| `sessionEvents` | `true` | append the log-only `mpd-tui/board-opened` record, and only after the event type is verified known to a reachable `dsh-session` copy |
| `decisionEvents` | `true` | attempt the mediated decision-event registration (expected: refused) |
| `logPrefix` | `"mpd-tui"` | diagnostic tag |

### Diagnostics

`stdout` stays silent (a TUI frame owns it): diagnostics go to `ctx.logger`, and
only when no logger exists to `stderr`, with `debug` gated behind
`DSH_TUI_DEBUG`. One aggregate line is logged per boot:

```text
[mpd-tui] mpd TUI surfaces: tuiStatus, tuiScenes, tuiDialogs, tuiRenderers, tuiSettingsSections, tuiCommandTrees, tuiShortcuts, commands · skipped: …
[mpd-tui] no DSH-TUI service is composed in this profile (web composition?): every mpd TUI surface was skipped
```

## What is NOT claimed

1. **The decision-event seam (`tui.dsh/v1alpha1#DecisionEvents`) is built ready
   but NOT activated.** For a profile-installed plugin, admission is
   token-gated and unreachable (`src/dsh-adapter/plugin-host.ts` at host
   revision `b246411`: the public `admit()` throws, `admitInternal` needs an
   unexported token, `getHostAdmission*` has no production caller), so the
   identity assertion throws before any policy question. The plugin therefore
   attempts the mediated registration for the four intercept points
   (`tui/input`, `tui/rewind-prompt`, `tui/session-switch`, `tui/compact`),
   treats the refusal as the expected outcome, warns **once**, and registers
   nothing. It never calls `admit`/`admitInternal`, never uses the test-only
   token, and never fakes an identity. **No input, rewind, session-switch or
   compact interception is claimed.**
2. **The `/settings` section IS bridged to `<workspace>/.mpd/mpd.jsonc`, and the behaviour
   change needs a restart.** The fields declare the real mpd.jsonc knobs
   (`hashline.maxDiffChars`, `commentChecker.autoCheck`, `ulw.maxRounds`,
   `memory.vcs`, `team.stateDir`, `boulder.dir`) and edit them under the harness
   settings namespace `mpd`. That namespace is **served by
   `packages/mpd-config-plugin`** (design §10.1), which registers it with a
   `base`, so both front doors display the file's real values instead of the
   schema defaults; this plugin is a pure consumer and only registers as a
   guarded **fallback** when a composition has no config plugin. The base follows
   a **cardinality rule**: one live root ⇒ that workspace's `<workspace>/.mpd/mpd.jsonc`;
   zero roots ⇒ the mount-time (exec-less) root, an absent file there giving an
   empty base (schema defaults) — the normal boot path, since this row usually
   precedes any live session; more than one root ⇒ **no file base is invented**
   (`base: undefined`, `ambiguous-multi-root`, every candidate warned and surfaced
   by `states()`), so the namespace shows schema defaults until exactly one
   workspace is live. The base is **fixed for the process lifetime** (the host
   exposes no disposal handle for a live registration) — the honest reason the
   sentence below says "after a restart" — while the **resolved value** and the
   config layer's **per-call file reads** are what the plugins actually use. A saved edit is written back into the live session
   workspace's `<workspace>/.mpd/mpd.jsonc` with comments and key order preserved, and the
   config layer applies it to every workspace immediately. **The plugin
   BEHAVIOUR change needs a restart** for every knob in this section, because the
   mpd consumers capture their config at `apply()` — stated in the same words on
   screen: every field hint names its mpd.jsonc key and carries `a save writes
   <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect
   for the mpd plugins after a restart (this knob is read at plugin mount)`,
   followed by the clause that a settings-only save is never a lost save. The twelve
   team-model slot hints LEAD with the knob's own human sentence — the group the
   slot routes (`槽位 2 提供商（分析型成员）` / `Slot 2 provider (analysis members)`)
   and what configuring it does — and only then state the key and that disclosure. The
   write-back **refuses** (loudly, writing no file) when the target is ambiguous
   — no live session (`no-live-session`), several live workspaces
   (`ambiguous-multi-root`, every candidate named), a read-only/unparsable/
   conflicting file — while the settings value still applies; the status line
   carries the matching runtime notice. Not claimed: a specific front door's
   rendering (the Web card's browser render is verified by the user in their GUI).
3. **Web-only surfaces have no TUI rendering face.** The agent-teams sidebar and
   the workmate tab (`dsh.client.platform = web`) do not render in the TUI. The
   board, the status line and the dialogs are equivalents — not a pixel or
   feature parity claim. The web profile is untouched.
4. **The packaged skill is an asset only.** `packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md` ships with
   the package, but the bundle's corpus is served from `<bundle>/skills` by
   `mpd-bootstrap`; this package-local copy is not registered by this row.
5. **Engine version skew.** The host prints that the dsh engine is newer than
   the UI revision it was validated against; verification runs against the
   installed engine, not that revision.
6. **Host-internal gates are not our conformance.** The host's own
   `verify:plugin-*` suite validates the host's plugin subsystem; even a green
   run would not be a conformance verdict on this plugin.
7. **The `Ctrl+A` take-over is a KEY RE-POINT, not a merge into the host's dashboard.** No host file
   is patched and the host's own dashboard rendering is not extended: the panel you land on is
   `mpd-tui-subagents`, which renders the host's `channel.subagents` rows itself. While a team holds
   at least one task, `Ctrl+A` no longer opens the host dashboard at all — turn `tui.dashboardKey`
   off to get the host's behaviour back.
8. **It keys off the KEY, not off the host's current `dashboard` binding.** If you remap that action
   in `/settings`, `Ctrl+A` still opens the merged panel while a team exists: the hook watches the
   host's default combo. Nothing is remapped for you and the host's own binding table is untouched.
9. **It fires on the plain chat screen only.** The hook rides a status-view component, and every
   exclusive host surface (a dialog, `/settings`, the session tree, the supervisor, a plugin scene,
   the host dashboard itself) unmounts it — the `tui-deps-ctrla` lane's settings arm proves that on a
   real pane, rather than inferring it from the host's branch order.
10. **Cross-rank dependency edges are not drawn in the `boxes` view.** A task whose blocker sits two
    or more ranks up shows no connector for that blocker (pre-existing layout rule: only the rank
    immediately above is wired). The `rail` view names the extras inline (`⇠ T4+T6`).
11. **A merged entry's arrowhead takes the DEPENDENT's tone, not the edge's.** One cell cannot carry
    several parents' tones, so a dimmed edge can end in an arrowhead drawn in the child's own colour.
12. **The `Ctrl+A` take-over ARMS once the host has handed MPD its own ui kit** — i.e. after any MPD
    scene or panel has rendered in the session (`alt+a`, `alt+t`, `alt+m`, `/mpd board`) — because the
    host module a plugin can resolve by file URL is NOT the instance the running host renders with
    (measured on dsh-tui 0.12.0: that import's `useStdin()` answers nothing, while the kit a scene
    receives returns the live context). Until then the contact falls back to that module and `Ctrl+A`
    keeps its current behaviour. Nothing is claimed about a host whose kit never arrives.

## Build and test

```sh
bun build packages/mpd-tui-plugin/src/index.ts --target node --format esm \
  --outfile packages/mpd-tui-plugin/dist/index.js
bun test packages/mpd-tui-plugin
bun run typecheck
```

`dist/index.js` is built with the repo's own toolchain (bun, no network step) and
is self-contained: the only external imports it needs are Node builtins. The
`Config` schema comes from the schemastery copy the bundle already vendors at
`packages/mpd-agent-teams-plugin/_deps/schemastery` — this package declares no
dependency of its own. That vendored copy is the one relative specifier that
names a package directory (resolved through its own `package.json`, which
carries both `exports.import` and `types`); every relative **file** import in
`src/` carries its explicit extension (`.js`), and the built bundle inlines the
vendored copy so the shipped artifact has no relative specifier at all.

## License

Unchanged: the repository license (`LICENSE.md`, SUL-1.0). This package claims no
license change.
