# Seam adapters — the two contact surfaces a plugin row may use

Agent-facing reference (English-only by the bundle's language policy; `verify:docs` does not discover
this tree). `AGENTS.md` §6 carries the binding one-line rule and points here for the detail.

## Why two adapters exist

A host release that renames or reshapes a seam must be absorbed in ONE place per plane. This bundle
therefore has exactly two contact surfaces:

NOTE ON WORDING (measured by the wave's reviewer): the rule is about ACCESS, not about the word. Eight
files under `packages/mpd-tui-plugin/src` still spell a seam id in a COMMENT (their header documents
which seam they route through, e.g. `// Seam 8 — ctx.tuiScenes`); the gate strips comments before
matching, deliberately, because those headers are what makes the adapter route auditable. A claim of
the form "no file names a seam" is therefore false as written; the true claim is "no file outside the
adapter ACCESSES a seam".

| Plane | Package | Row / service | What it owns |
|---|---|---|---|
| DSH (harness) | `packages/mpd-dsh-adapter-plugin` | row `mpd-dsh-adapter`, service `mpdDsh` | `ctx.tools`, `ctx.subagents`, `ctx.skills`, `ctx.agentPresets`, `ctx.commands`, `ctx.systemPrompt`, `ctx.on`, `ctx.loader`, the LLM catalog, settings, the team plane (`TeamExecutor`) |
| DSH-TUI (terminal front door) | `packages/mpd-tui-adapter-plugin` | row `mpd-tui-adapter`, service `mpdTui` | the fifteen `ctx.tui*` services dsh-tui 0.13.0 exposes (the fourteen available since 0.12.0, plus `tuiPanels`), plus `tuiPrompt` and the `commands`/`settings` services it brokers |

Resolve them with `resolveDshAdapter(ctx)` / `createLazyDshAdapter(ctx, { label })` and
`resolveTuiAdapter(ctx)` / `createLazyTuiAdapter(ctx, { label })`; each falls back to a row-private
`create*Adapter` so a package stays usable in a unit test with a host double.

## The TUI plane, in detail (dsh-tui 0.12.0 → 0.13.0)

The plugin-facing seams are exactly: `tuiScenes`, `tuiStatus`, `tuiRenderers`, `tuiSettingsSections`,
`tuiShortcuts`, `tuiDialogs`, `tuiCommandTrees`, `tuiPluginHost`, `tuiToast`, `tuiThemes`,
`tuiPluginStorage`, `tuiMessageObserver`, `tuiEffectLedger`, `tuiWorkspaces` (plus `tuiPrompt`, which
nothing in this installation provides) — and, ADDED BY 0.13.0, **`tuiPanels`**, the sidebar panel
registry. The wave `dsh-tui-013-adaptation` adopted it as the fifteenth seam: the descriptor's
`apiVersion` must be exactly 1, its `id` is a single lowercase slug the host prefixes with the calling
activation's plugin id, `component`/`compact` are the two render slots (0.13.0 VALIDATES and STORES
`compact` but does not mount its render slot, so this bundle declares `component` only), the budget is
≤4 panels per plugin and ≤32 globally, and `open()` is rate-limited to one per plugin per 5000 ms and
returns `false` without consuming the window when no live panel consumer exists. **The final id is
DISCOVERED, never composed**: the plugin-id half comes from a Component identity our plain loader row
does not carry, so the host falls back to a per-activation `act<N>` name — measured on the real host as
`act1:team`, which is exactly why `TuiAdapter.registerPanel()` reads the id back from the host's own
`list()` instead of building the string here.

BINDING DISCIPLINE — measured, not assumed:

- The BINDER is ONE deferred `ctx.inject([id], scoped => …)` PER SEAM. Cordis's batched `inject(deps,
  cb)` is all-or-nothing per call, so batching would let one absent optional seam suppress the others;
  a probe-then-register plugin registers nothing in a real boot (T4-INERT-1).
- The PROBE is `ctx.get(id, false)` (never a property read: `ctx.tuiScenes` throws without inject).
  Probes feed the report; they never bind.
- A seam that never binds reports `absent` plus ONE line and never takes the boot down — a web/headless
  composition stays inert.
- Registrations belong to the INJECTED scope's fiber (`scoped.effect(() => release(), label)`), so
  unloading the adapter row revokes them.
- `tuiPluginHost` follows the host's own rule: soft-probe first (`ctx.get('tuiPluginHost', false)`),
  deferred inject as the fallback. A probe-bind has no injected scope, so its effect ownership falls
  back to the adapter row's ctx — the same accepted residual the DSH adapter documents as R1.
- Re-export the dsh-tui prop/channel TYPES from the adapter, so a scene component's contract has one
  statement.

### The ONE contact that is not a seam: the host input bus (2026-10-05)

`Ctrl+A` is a built-in HOST action (`dashboard`, default `ctrl+a`); `Chat.js` consumes it before any
plugin binding, and the contribution kinds (`workspace.provider`, `tui.settings-section`, `tui.scene`)
cannot place content inside the host's own `SubagentDashboard` (a Chat-local early return with fixed
props). The user requirement "Ctrl+A opens MPD's panel + dependency graph" therefore needed a contact
OUTSIDE the seams (fifteen as of 0.13.0, fourteen when the contact was written), and it is declared
here rather than hidden:

- The adapter resolves the INSTALLED host root (`MPD_DSH_TUI_HOST_ROOT`, its own module dir,
  `process.argv[1]`, `<DSH_HOME>/profiles/*/node_modules/@deepseek-harness-tui/dsh-tui`, `~/.dsh`,
  `~/.dsh-tui`) and dynamic-imports `<root>/lib/types/ui.js` by FILE URL — a package-specifier import
  is refused by the host's `exports` map (no `./lib/*` subpath) — accepting it only when it exports
  `useStdin`. The result is cached and exposed as `hostInput()`.
- The FILE URL is what makes it correct: Node caches an ES module by resolved URL, so the returned
  `useStdin` is supposed to read the SAME `StdinContext` the host's own `Chat.js` reads. MEASURED on
  dsh-tui 0.12.0 (real PTY, `evidence/tui/lanes/`): that import is a FOREIGN module instance whose
  `useStdin()` answers NOTHING, while the kit the host hands a SCENE (`props.ui.useStdin()`) returns the
  live context. The adapter therefore also stores the first scene kit (`rememberHostKit`) and prefers
  it, and `capabilities().hostInput` names which source armed. Consequence, documented rather than
  hidden: the take-over arms after the session has rendered any MPD scene and stays inert before that.
- Two further host rules the contact obeys, both learned by measurement: a STATUS registration's
  identity must be the CALLING ACTIVATION (the injected scope the service shadow was reached through —
  the consumer's ctx is refused by `assertCallerContext`, which is also why the `mpd:` status line
  never rendered before this fix), and the `readHostStdinValue()` canary still refuses the context
  DEFAULT, so a wrong instance attaches nothing and logs ONE line instead of arming on a dead bus.
- The consumer is a ZERO-ROW status view (`ctx.tuiStatus.registerView`, maxRows 1) whose component
  calls `useStdin()` and `prependListener("input", …)`, then opens `mpd-tui-subagents` on `ctrl+a`
  only when the workspace's team projection has a team with ≥1 task and the `/settings` toggle is on.
  `prependListener` is the ordering guarantee (the host emits front-first and stops at
  `stopImmediatePropagation`), which is what makes the takeover deterministic rather than a race.
- Discipline: no DSH-TUI file is patched, vendored or written; every failure (no candidate, unreadable
  candidate, import error, version-skewed `ui.js` without `useStdin`) degrades to `hostInput() ===
  undefined` plus ONE diagnostic line, and the takeover is simply absent — `alt+a` still opens the
  panel. The A2.2 gate's scope is unchanged: the contact lives inside `mpd-tui-adapter-plugin`.

### The contact is VERSION-GATED (0.13.0 and later keep it inert)

The contact exists for exactly ONE host generation: a dsh-tui WITHOUT a sanctioned way to open MPD's
own panel, where intercepting `Ctrl+A` was the user's clause. 0.13.0 ships that way (`tuiPanels`), so
the rule is now:

- the ARBITER is `TuiAdapter.panelSeamBound()`, read at apply AND again per press (`takeoverArmed()` in
  `packages/mpd-tui-plugin/src/panel.ts`) — the second read is not redundant, because the adapter binds
  the seam through a DEFERRED inject and a binding that lands after our row applied must still disarm
  the contact;
- on a host that OFFERS the seam the APPLY-TIME test normally keeps the contact out of the session
  entirely, reporting one `skipped` outcome naming the reason — and when the seam binds LATER (it is
  bound through a deferred inject, so a binding can land after this row applied), the contact IS
  registered (a zero-row status view plus its prepended input listener) and is disarmed per press by
  `takeoverArmed()` instead. Both shapes keep `Ctrl+A` on the host's own dashboard, and `alt+a` /
  `/mpd panel` route through `tuiPanels.open()`. The per-press read is therefore NOT dead code: it is
  the half that covers the late binding, and deleting it would break the gate for that case;
- on a host WITHOUT the seam (0.12.0) the old behaviour stands unchanged: the contact arms under
  `tui.dashboardKey` + a team with ≥1 task, and `alt+a` opens the full-screen merged scene.

MEASURED on the real 0.13.0 host (PTY lane `tui-deps-ctrla`, `evidence/tui/lanes/`): "the host's Ctrl+A
stayed INERT (its own dashboard opened) and `/mpd panel` proved the sidebar registration + accepted
open". The 0.12.0 leg has NO PTY proof in this wave — the sandboxed 0.12.0 profile could not be built
here (a clean one needs `dsh plugin add`, which the read-only pnpm store lock refuses) — so it rests on
the unit arms (`packages/mpd-tui-plugin/test/panel.test.ts` `takeoverArmed`, `plugin.test.ts` the
legacy-host arm). That bound is stated, never glossed.

## R5 — no MPD diagnostic may reach the terminal

An MPD plugin, MCP server or spawned child must never write to fd 1 or fd 2 while a TUI session is
live: dsh's terminal IS the Ink alternate screen, and a stray line corrupts the frame.

- The adapter owns the file sink: `<workspace>/.mpd/logs/<name>.log`, size-capped with a single `.1`
  rotation, never throwing, never falling back to a terminal (an unwritable root drops into a bounded
  ring instead).
- The TUI plugin's logger chain is host `ctx.logger` → the adapter's file sink → drop. It never uses
  `process.stderr`.
- `packages/mpd-mcp-shared/log-sink.ts` installs the same sink at the TOP of every MPD MCP launcher,
  before the adopted server module is imported. Measured reason: the harness builds each stdio MCP row
  as `new StdioClientTransport({ command, args, env, cwd })` with NO `stderr` option, and the MCP SDK
  then spawns the child with `stdio: ["pipe","pipe","this._serverParams.stderr ?? "inherit"]` — so an
  MCP server's fd 2 IS dsh's fd 2.
- Every MPD-spawned child gets file-or-pipe stdio. Never `inherit`.
- KNOWN RESIDUAL: the vendored `packages/mpd-mcp-codegraph/dist/serve.js` bridge spawns the real
  codegraph CLI with a hardcoded `stdio: ["pipe","pipe","inherit"]`, and the grandchild writes
  `[CodeGraph MCP] …` lines straight to fd 2 — bytes that pass through no JS of ours. The launcher
  closes the class where it can (descriptor re-bind); where it cannot, the honest fix is a harness-side
  `stderr: "pipe"` in `mcp-client`'s `createTransport` (upstream request).

## Build fan-out — an adapter edit invalidates every dependent dist

`bun build` INLINES each imported module into its consumer's bundle, so there is no shared module
identity across packages: editing `packages/mpd-dsh-adapter-plugin/src/index.ts` (or the TUI adapter)
changes the emitted bytes of every package that imports it. Measured on 2026-10-02: an adapter-only
edit left **12 of 24 dist targets STALE**, and rebuilding exactly the 11 dependents restored 24/24.

Rule for a lane that edits an adapter: after the edit, rebuild EVERY package whose `src` imports it —
grep for the import rather than guessing — with the PINNED toolchain
`.toolchain/node_modules/.bin/bun build packages/<pkg>/src/index.ts --target node --format esm
--outfile packages/<pkg>/dist/index.js` (repo root, path-qualified args). The repository pins
`bun@1.4.0` (`package.json#buildToolchain`, the CI's `bun-version`); a dist built by another bun
compares STALE because the injected helper preamble differs. `node scripts/verify-dist-fresh.ts`
prefers the local toolchain when it agrees with the pin, and is the authority on what is fresh.

The same fan-out applies to the DIST TESTS: a package whose test captured `console.*` output must be
updated when its rows move to a log file, because the assertion has to read
`<workspace>/.mpd/logs/<row>.log` instead of a console spy.

## Enforcement (the gates that keep a new touch out)

| Gate | Fails on |
|---|---|
| `packages/mpd-tui-adapter-plugin/test/no-direct-tui-access.test.ts` | a NEW direct `tui*` touch outside the adapter, in all three spellings (property, quoted id, aliased receiver), over the whole source band; `--self-test` seeds a violation |
| `packages/mpd-dsh-adapter-plugin/test/no-terminal-writes.test.ts` | a NEW `console.*` / `process.stdout.write` / `process.stderr.write` in an MPD runtime path; prints its declared out-of-band set loudly (browser-side client factories, human-run CLI scripts, the MCP protocol's own stdout writer) |
| `packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | a NEW cross-package / retired-body / `globalThis` coupling beyond the frozen, identity-keyed inventory (which can only shrink) |
| `node scripts/verify-no-host-override.ts` | a shipped patch row that id-targets a row a host layer declares |

## The third contact surface (declared, not yet adapted)

`packages/mpd-bundle-plugin` (the web client) still touches host/web-plane services directly:
`betterSidebar`, `sidebarRightTabs`/`sidebarRight`, `shortcuts`, `locale`, `configForms`,
`modelDirectories`, `sessions`. That is the WEB plane's contact surface, frozen today as a counted
inventory; it needs its own adapter before the "one adapter per plane" rule is claimed for the web
plane. Do not widen it meanwhile.

## The panel question (PARTLY ANSWERED by 0.13.0)

dsh-tui 0.12.0 offered NO supported way to render inside or below its subagent dashboard
(`TuiSceneDescriptor` is `{ id, title, component }`; the dashboard is an early-return full-screen swap
in `screens/Chat.js` with only `{ subagents, onClose, onSelect }` props; the three contribution kinds
are `workspace.provider`, `tui.settings-section`, `tui.scene`). MPD therefore renders its own scene
whose TOP section is the host's own `channel.subagents` feed (the same source `Ctrl+A` shows — MPD
teammates are real continuable subagents, so the data-level merge already exists) and whose lower
section is the team DAG. That scene is STILL the fallback surface and the only merged view on a host
with no panel seam.

**What 0.13.0 changed (wave `dsh-tui-013-adaptation`).** The release ships `ctx.tuiPanels`, so the same
merge now lives in a RIGHT-SIDEBAR panel: `packages/mpd-tui-plugin/src/panel.ts` registers ONE panel
(`id` slug `team`, title `MPD`, `minColumns` 32, `order` 10, NO `compact` — 0.13.0 stores that slot but
does not mount it) whose body is the host's curated `host.snapshot().subagents` rows FIRST and the MPD
dependency DAG below, reusing `subagent-scene.ts` + `graph.ts` rather than re-rendering them. `alt+a`
and `/mpd panel` route through `tuiPanels.open()` whenever the seam is bound and a discovered id
exists, and FALL BACK to the full-screen scene on any refusal (rate limit, an id the host no longer
owns, or no live panel consumer) — never a silent no-op. Because the panel seam exists, the Ctrl+A
host-input contact is version-gated OFF (see above), which is the outcome the upstream ask was for.

**What is NOT granted, and is measured rather than assumed.** The seam is a sidebar panel: it still
cannot enter or extend the host's own subagent dashboard, so the dashboard itself is untouched. And the
panel's BODY is not observable in a tmux pane capture on this host — the lane
(`skills/dsh-qa/scripts/tui-panels.ts`) captured a byte-identical pane before and after a host-ACCEPTED
open, so it proves the registration (the host's own `list()` read-back yields the discovered id
`act1:team`), the descriptor acceptance and `open()`, and it states plainly that it does not prove a
render. The remaining ask — a dashboard row hook or a section contribution kind — is still drafted in
`agent-references/upstream-dsh-tui-seam-request.md`.
