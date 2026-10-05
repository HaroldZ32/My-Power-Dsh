# mpd-tui-adapter-plugin

**English** | [中文](./README.zh-CN.md)

The bundle's **single contact surface with the DSH-TUI plane**. Every mpd plugin that needs a
`tui*` service, the harness command registry or the harness settings provider calls through this
adapter, so a dsh-tui release that renames or reshapes a seam is absorbed in this one package —
one file, one rebuild — instead of across thirteen.

Row id: `mpd-tui-adapter`. Service name: `mpdTui` (`ctx.get("mpdTui")`). Package:
`@mpd-dsh/tui-adapter`.

## Wrapped seams

The seam id table is `TUI_SEAMS` — the ONLY place in the bundle a DSH-TUI service name appears.
Consumers address a seam by its key (`scenes`, `status`, `pluginHost`, …), never by the id.

| Seam key | Service | Typed member | Registration |
|---|---|---|---|
| `scenes` | `tuiScenes` | `scenes()` | `registerScene(descriptor, identity?)` → handle with `openScene(id)` / `closeScene(id)`; `openScene(id)` / `closeScene(id)` on the adapter |
| `status` | `tuiStatus` | `status()` | `setStatus(key, text, identity?)`; `registerStatusView({key, render, intervalMs?, identity?, label?, onError?})` |
| `renderers` | `tuiRenderers` | `renderers()` | `registerRenderer(type, renderer, identity?)` |
| `settingsSections` | `tuiSettingsSections` | `settingsSections()` | `registerSettingsSection(sectionOrThunk, identity?)` |
| `shortcuts` | `tuiShortcuts` | `shortcuts()` | `registerShortcut(combo, {description, handler}, identity?)` |
| `dialogs` | `tuiDialogs` | `dialogs()` | request-based: `dialogs()` carries `select` / `confirm` / `input` |
| `commandTrees` | `tuiCommandTrees` | `commandTrees()` | `registerCommandTree(provider)` |
| `pluginHost` | `tuiPluginHost` | `pluginHost()` | `requestDecisionEvent(event, listener, options?)`; `grantsAllows(permission, scope, identity?)` |
| `toast` | `tuiToast` | `toast()` | bound and reported; no mpd surface registers one yet |
| `themes` | `tuiThemes` | `themes()` | bound and reported; read surface only |
| `pluginStorage` | `tuiPluginStorage` | `pluginStorage()` | bound and reported; read surface only |
| `messageObserver` | `tuiMessageObserver` | `messageObserver()` | bound and reported; read surface only |
| `effectLedger` | `tuiEffectLedger` | `effectLedger()` | MEASURED UNREACHABLE from a plugin activation on the probed build; bound and reported, never inferred from |
| `workspaces` | `tuiWorkspaces` | `workspaces()` | bound and reported; read surface only |
| `prompt` | `tuiPrompt` | `prompt()` | HOST-UNAVAILABLE on every measured build (`docs/tui.md` seam 2): the absence is reported, nothing is claimed |
| `commands` | `commands` | `commands()` | `registerCommand(definition)` |
| `settings` | `settings` | `settings()` | `registerSettingsNamespace(ns, schema, options?)` |

Beside the seam members the adapter exposes two readouts and two helpers:

- `capabilities()` → `{ seams: Record<TuiSeamKey, boolean>, bound, total }`, sampled at call time;
- `seamOutcomes()` → one `{id, state, detail?}` per seam key, in table order;
- `whenBound(key, setup)` → runs `setup(service, scope, handle)` when the seam binds (immediately
  when it already has) and hands the consumer the handle to `record({state, detail})` its own
  measured outcome on. This is the escape hatch for consumer-specific work — a loop over host
  facts, an asynchronous precondition, a readiness signal;
- `skipped(key, detail)` → the outcome of a seam the caller deliberately did not activate (a config
  switch), so the aggregate still names it.

Every registration returns a handle whose `outcome()` is `{id, state, detail?}`, using the
vocabulary this bundle already reports: `confirmed` (a host read-back proves it) · `requested` (the
host accepted the call, no read-back) · `available` (a request-based seam, nothing to register) ·
`absent` (never bound) · `refused` (the call threw, or the method is missing). Nothing is ever
reported as registered on the strength of a disposer's type.

## The binding discipline

Measured, not chosen (T4-INERT-1, `evidence/tui/plugin/20260915T054343Z/mount-instrumentation/`):
a plugin context reaches a DSH-TUI service it has INJECTED and nothing else. The adapter therefore:

- binds each seam with ONE deferred `ctx.inject([id], scoped => …)` **per seam** — never a batch,
  because cordis resolves a dependency list all-or-nothing and one absent optional seam would
  suppress every other seam in the batch;
- probes with `ctx.get(id, false)`, and the probe NEVER binds a seam by itself — except for
  `pluginHost`, which follows the HOST's own rule (soft probe first, deferred inject as fallback),
  and only when the context has an inject channel at all;
- queues a registration made before its seam binds and drains the queue at the bind, so a row that
  applies early still registers;
- hands every host handle to `scoped.effect(() => release(), label)` on the INJECTED scope, so an
  unload or a hot reload cannot leave a stale registration behind;
- passes the CONSUMER's context as the host's trailing `identity` argument wherever the host API
  takes one, so the effect ledger attributes the registration to the activating row;
- never fails a boot: a seam that never binds reports `absent` and contributes to ONE aggregate
  warning line. A web or headless composition, where none of these services exists, stays inert.

### The A2.2 gate (`test/no-direct-tui-access.test.ts`)

The seam closure is enforced, not documented: the gate scans `packages/mpd-*/src/**/*.ts` except
this package and fails naming file + line for any of the fifteen `tui*` ids in all three spellings —
`ctx.tuiScenes` (property, aliased receivers included), `ctx.get("tuiScenes")` /
`ctx.inject(["tuiScenes"])` / `onService(ctx, "tuiScenes")` (string) and any bare occurrence
(catch-all). Comments are stripped before matching, findings quote the ORIGINAL line, and every
non-`.ts` file under a scanned `src/` is printed in a loud NOT COVERED section instead of passing
silently. It ships `--self-test` over a seeded fixture tree (seven arms, five seeded violations).

### The HOST-INPUT contact — the ONE counted exception (2026-10-05)

The requirement was that `Ctrl+A` open MPD's merged panel (the host's own subagent rows plus the
dependency graph) in a workspace that holds a team. The host owns that key: `dashboard` is one of its
built-in actions (default `ctrl+a`), `Chat.js` consumes it before any plugin binding, and the three
contribution kinds (`workspace.provider`, `tui.settings-section`, `tui.scene`) cannot place content
inside the host's own `SubagentDashboard` — a Chat-local early return with fixed props. No seam
reaches that key.

This package therefore carries the ONE contact that does, and names it here instead of hiding it:

- `hostRootCandidates(env, home)` — the candidate roots of an INSTALLED host, most specific first:
  `MPD_DSH_TUI_HOST_ROOT` (the QA/test override), the module's own directory, the running `dsh-tui`
  bin (`process.argv[1]`), every `<DSH_HOME>/profiles/*/node_modules/@deepseek-harness-tui/dsh-tui`,
  `~/.dsh/profiles/*/…` and `~/.dsh-tui/profiles/*/…`. A candidate counts only when
  `<root>/lib/types/ui.js` exists.
- `probeHostInput(candidates)` — dynamic-imports that module by FILE URL and accepts it only when it
  exports a `useStdin` function; a package-SPECIFIER import cannot serve here, because the host's
  `exports` map has no `./lib/*` subpath.
- `hostInput()` on the adapter — the cached `{ useStdin }`, or `undefined` plus ONE diagnostic line.
  A host whose `ui.js` exists but carries no `useStdin` is reported as version SKEW, never as absent.

WHY THE FILE URL IS THE POINT: Node caches an ES module by its resolved URL, so importing
`<hostRoot>/lib/types/ui.js` this way hands back the SAME module instance the host itself uses, and
its `useStdin` reads the SAME React context object (`StdinContext`). A second copy of that module
would resolve to the context DEFAULT — an emitter that never receives a keystroke, and therefore a
takeover that silently never fires. The adapter does not leave that to chance: `readHostStdinValue()`
classifies one `useStdin()` result and REFUSES the context default (it requires the live provider's
own `internal_querier` marker), so a consumer that gets a refusal attaches nothing and logs ONE line
instead of arming on a dead bus. The PTY lane `skills/dsh-qa/scripts/tui-deps-ctrla.ts` then proves the
positive on a real terminal: it re-reads the adapter's own `host contact bound: <root>` line out of the
workspace log and requires that root to be the profile copy the lane itself launched.

The discipline around the contact: no DSH-TUI file is patched, vendored or written; a missing host,
an import error or a skewed module degrades to `hostInput() === undefined` with the takeover simply
ABSENT (`alt+a` still opens the panel); the contact lives in THIS package, so the A2.2 gate's scope is
unchanged; and the consumer contract is deliberately narrow — a mounted component calls `useStdin()`
and `prependListener("input", …)`, which is what makes the ordering deterministic (the host emits to
the listener list front-first, so the plugin sees the key before the host's own handler consumes it).

TWO MEASURED HOST CONSTRAINTS this contact obeys (dsh-tui 0.12.0, both established on a real PTY):

- **The identity a STATUS registration carries is the CALLING ACTIVATION, not the consumer's ctx.**
  The host's `assertCallerContext` refuses a `tuiStatus.registerView`/`set` whose identity belongs to
  another fiber, and the caller it sees is the service shadow bound to the adapter's injected scope.
  Every status registration therefore passes that bound `scope`; passing the consumer's ctx made the
  host refuse silently (the rich view never mounted, and the `mpd:` status line never rendered).
- **Only a SCENE render carries the live input kit.** `rememberHostKit()` stores the kit a scene
  component received in `props.ui`, and `hostInput()` prefers that remembered hook over the imported
  module's — because the imported one is a foreign instance whose `useStdin()` answers nothing on this
  host. `capabilities().hostInput` names which source armed, so QA can tell them apart. The practical
  consequence is one bootstrap: a take-over built on this contact works from the moment the session has
  rendered an MPD scene, and stays inert (host behaviour, nothing claimed) before that.

## The diagnostic file sink

A live DSH-TUI session OWNS the terminal: one write to fd 1 or fd 2 corrupts the rendered frame.
The adapter therefore writes its own boot lines to a FILE — `<workspace>/.mpd/logs/mpd-tui.log` —
and `createFileSink({root, name?, capBytes?})` is the sink the TUI plugin's own logger falls back to
when the host logger is absent. The sink appends, enforces its size cap by keeping the file's tail,
resolves its root per write (one host serves many sessions), and never throws. `DSH_TUI_DEBUG` still
gates `debug` lines.

## Why it exists

`packages/mpd-dsh-adapter-plugin` is the DSH plane's one contact surface. The DSH-TUI plane had
none: `packages/mpd-tui-plugin/src/**` spelled `tui*` service ids, the `commands` registry and the
`settings` provider inline, so a dsh-tui release could have reshaped a seam across thirteen files.
This package is that missing surface, shaped exactly like the DSH adapter: typed seam interface,
capability probe sampled at call time, warn-once degrade, `resolveTuiAdapter` /
`createLazyTuiAdapter`, and a single-provider row.

## Usage

```ts
// The mounted adapter (the normal case) or a row-private one (unit tests, standalone rows).
const tui = resolveTuiAdapter(ctx)

// Register: the handle reports what actually happened.
const handle = tui.registerScene({ id: "mpd-tui-board", title: "MPD board", component }, ctx)
handle.outcome()            // { id: "tuiScenes", state: "requested", detail: "mpd-tui-board requested …" }
handle.openScene("mpd-tui-board")

// Read the composition.
tui.capabilities().seams.scenes   // true when the deferred inject bound the service
tui.seamOutcomes()                // one outcome per seam key, in table order
```

A row that must also survive a transient "provider not ACTIVE yet" miss uses
`createLazyTuiAdapter(ctx, { label })`: it re-resolves `mpdTui` on every member read and warns ONCE
when it has to fall back to a row-private adapter.

## Config

`apply(ctx, config)` provides the service and writes the boot lines:

| Key | Meaning |
|---|---|
| `quiet` | `true` silences the adapter's own boot lines (the provider line and the `TUI_SEAMS=…` inventory) |
| `logRoot` | the diagnostic root — a string or a resolver; defaults to `DSH_WORKSPACE_ROOT`, else the process cwd |

The row declares `export const inject: string[] = []` on purpose: every seam is bound through a
deferred inject inside `apply`, so the row mounts in any composition order and in a web/headless
composition where none of these services exists.
