# mpd-tui — DSH-TUI surfaces for `@mpd-dsh/mpd`

[中文](./README.zh-CN.md)

`packages/mpd-tui-plugin` gives the `@mpd-dsh/mpd` bundle a TUI-native face. It
is a single Cordis plugin row (`mpd-tui`) whose module specifier is owned by the
bundle patch:

```text
@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js
```

There is **no `cordis.patch.yml` inside this package on purpose**: the bundle
patch (`packages/mpd-bundle/cordis.patch.yml`) owns the row, and a second mount
would duplicate a loader entry id (the loader rejects duplicates outright).

## What it provides

| Seam | Host service | What the user gets |
|---|---|---|
| Status line | `ctx.tuiStatus` | one keyed `mpd` contribution above the prompt: `mpd: team … · boulder … · plans … · workmates …` |
| Transcript renderers | `ctx.tuiRenderers` | the bundle's log-only session events (`agent-teams/*`, `mpd-tui/board-opened`) as plain text rows, live and on replay |
| Settings section | `ctx.tuiSettingsSections` | the mpd.jsonc knobs declared as editable `/settings` fields — **not bridged** to the file; every field hint says so on screen (see NOT CLAIMED #2) |
| Full-screen board | `ctx.tuiScenes` | team + task ledger, boulder work ledger, plans, workmate library |
| Command tree | `ctx.tuiCommandTrees` | `/mpd board`, `/mpd status`, `/mpd workmates` completion |
| Shortcuts | `ctx.tuiShortcuts` | `alt+m` board · `alt+w` workmate picker · `alt+r` refresh the status line |
| Dialogs | `ctx.tuiDialogs` | the mediated workmate picker (`select`) |
| Decision events | `tuiPluginHost.subscribeDecision` | attempted, expected to be refused, **not activated** (see below) |

Supporting surfaces (not one of the seven seams): the `/mpd` command on the
harness command registry, the `mpd` settings namespace registration, and the
log-only `mpd-tui/board-opened` session record.

The board is the TUI-native equivalent of the web-only surfaces (agent-teams
sidebar, workmate tab, bundle floater). It reads state — it never writes:
- `<workspace>/.mpd/team/<teamId>/team.json` (newest record wins)
- `<workspace>/.mpd/boulder.json`
- `<workspace>/.mpd/plans/*.md`
- `$HOME/.mpd/workmate/<key>/meta.json` (the durable workmate library)

Every path is resolved per call under the **calling session's workspace**
(`packages/mpd-dsh-adapter-plugin`'s `workspaceRoot` / `workspaceRootsAll`),
never the dsh process cwd.

## Static assets

- `themes/mpd-tui.json` — a dark TUI theme (a partial colour override). The
  theme seam is a static asset by design: copy the file into
  `~/.dsh-tui/themes/` to make it selectable. This row does **not** install it.
- `skills/mpd-tui/SKILL.md` — an asset only; see "What is NOT claimed" #4.

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
2. **The `/settings` section is not bridged to `.mpd/mpd.jsonc`.** The fields
   declare the real mpd.jsonc knobs (`hashline.maxDiffChars`,
   `commentChecker.autoCheck`, `ulw.maxRounds`, `memory.vcs`, `team.stateDir`,
   `boulder.dir`), and the section edits them under the harness settings
   namespace `mpd` (registered by this plugin so the screen does not render it as
   unavailable). The mpd plugins read `.mpd/mpd.jsonc` through
   `packages/mpd-config-plugin`, **not** the harness settings document: a saved
   edit persists in the settings document and does **not** rewrite
   `.mpd/mpd.jsonc`. **This is stated on screen, not only here**: every field
   hint reads `mpd.jsonc <key> — not bridged: a save here does not rewrite
   .mpd/mpd.jsonc`. The bridge is the NAMED follow-up `mpd-settings-bridge`
   (writing the project/user JSONC from a settings section), not a shipped
   behaviour.
3. **Web-only surfaces have no TUI rendering face.** The agent-teams sidebar,
   the workmate tab and the bundle floater (`dsh.client.platform = web`) do not
   render in the TUI. The board, the status line and the dialogs are equivalents
   — not a pixel or feature parity claim. The web profile is untouched.
4. **The packaged skill is an asset only.** `skills/mpd-tui/SKILL.md` ships with
   the package, but the bundle's corpus is served from `<bundle>/skills` by
   `mpd-bootstrap`; this package-local copy is not registered by this row.
5. **Engine version skew.** The host prints that the dsh engine is newer than
   the UI revision it was validated against; verification runs against the
   installed engine, not that revision.
6. **Host-internal gates are not our conformance.** The host's own
   `verify:plugin-*` suite validates the host's plugin subsystem; even a green
   run would not be a conformance verdict on this plugin.

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
