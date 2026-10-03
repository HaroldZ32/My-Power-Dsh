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
| DSH-TUI (terminal front door) | `packages/mpd-tui-adapter-plugin` | row `mpd-tui-adapter`, service `mpdTui` | the fourteen `ctx.tui*` services dsh-tui 0.12.0 exposes, plus `tuiPrompt` and the `commands`/`settings` services it brokers |

Resolve them with `resolveDshAdapter(ctx)` / `createLazyDshAdapter(ctx, { label })` and
`resolveTuiAdapter(ctx)` / `createLazyTuiAdapter(ctx, { label })`; each falls back to a row-private
`create*Adapter` so a package stays usable in a unit test with a host double.

## The TUI plane, in detail (dsh-tui 0.12.0)

The plugin-facing seams are exactly: `tuiScenes`, `tuiStatus`, `tuiRenderers`, `tuiSettingsSections`,
`tuiShortcuts`, `tuiDialogs`, `tuiCommandTrees`, `tuiPluginHost`, `tuiToast`, `tuiThemes`,
`tuiPluginStorage`, `tuiMessageObserver`, `tuiEffectLedger`, `tuiWorkspaces` (plus `tuiPrompt`, which
nothing in this installation provides).

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

## The panel question (why the team panel is a scene)

dsh-tui 0.12.0 offers NO supported way to render inside or below its subagent dashboard
(`TuiSceneDescriptor` is `{ id, title, component }`; the dashboard is an early-return full-screen swap
in `screens/Chat.js` with only `{ subagents, onClose, onSelect }` props; the three contribution kinds
are `workspace.provider`, `tui.settings-section`, `tui.scene`). MPD therefore renders its own scene
whose TOP section is the host's own `channel.subagents` feed (the same source `Ctrl+A` shows — MPD
teammates are real continuable subagents, so the data-level merge already exists) and whose lower
section is the team DAG; it opens on MPD's own combo (`alt+a`), and `Ctrl+A` is never bound.

The upstream ask that would make the merge literal — a panel/section contribution kind, a
`TuiSceneDescriptor.slot`, or an exported dashboard row hook — is drafted in
`agent-references/upstream-dsh-tui-seam-request.md`. Upstream `main` already carries an unreleased
`ctx.tuiPanels`, but it is a RIGHT-SIDEBAR panel and still cannot enter the dashboard.
