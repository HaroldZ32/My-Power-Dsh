# BLOCKING FINDING — the shipped mpd-tui row is INERT in a real dsh-TUI boot

Measured by Senior Engineer, 2026-09-15, in the captain's warm sandbox
(`.mpd/recon/qa/`: `dshhome/` profile with `@deepseek-harness-tui/dsh-tui@0.10.1`
+ this bundle linked, `home/` sandbox HOME), via real `dsh-tui` boots inside tmux
(one process per run, `pipe-pane` raw capture, kill-server at the end).

## What was observed

1. First boot (unmodified package, `mpd-tui` row composed — `dsh --profile dsh-tui
   --dump-config` line 629 shows it): the boot log carries **no** `[mpd-tui]`
   line, the status line has **no** `mpd:` contribution, and typing `/mpd status`
   was **sent to the model** (`turn error · llm-deepseek: no API key …`) instead
   of being handled by the command — i.e. `commands.register('mpd')` never
   happened. Artifacts: `first-boot-pane-boot.txt`, `first-boot-pane-status.txt`,
   `first-boot-raw.log`.
2. Instrumented mount (`probe-no-inject.mjs`, mounted in the PROFILE patch —
   sandbox only, restored afterwards): a row applied **without `inject`** sees
   every service as absent:

   | service | `ctx.get(id, false)` | `ctx.get(id)` (strict) |
   |---|---|---|
   | `commands`, `settings`, `tuiStatus`, `tuiRenderers`, `tuiSettingsSections`, `tuiScenes`, `tuiCommandTrees`, `tuiShortcuts`, `tuiDialogs`, `tuiPluginHost`, `agents`, `skills` | **absent** | absent |
   | `mpdDsh` | object | absent |

   Raw: `report-no-inject.json`. `ctx.effect` and `ctx.logger` exist.
3. Instrumented mount #2 (`probe-with-inject.mjs`): with the cordis **deferred**
   form, every service is reachable and the registrations really take effect:

   - `ctx.inject([id], (scoped) => …)` fired for all ten ids and
     `scoped.get(id, false)` reported `object` for each (`report-with-inject.json`);
   - inside the callback `scoped.commands.register(...)` → `ok`;
     `scoped.tuiScenes.register(...)` → `ok`; `scoped.tuiStatus.set(...)` → `ok`;
   - the captured pane shows the contribution rendered:
     `  probe2 live` in the status area (`t4-probe2-run-2-pane.txt`).
   - `export const inject = ["commands"]` (the blocking form) also makes
     `commands` visible at apply, but `tuiStatus`/`tuiPluginHost` stay absent —
     the blocking form cannot serve optional seams.

## Root cause

`packages/mpd-tui-plugin/src/*` uses `ctx.get('<service>', false)` at apply time
and registers through the returned object. In this harness a service is only
reachable from a plugin whose context has *injected* it: for an inject-free row
`ctx.get(id, false)` returns `undefined` (it does not throw — it is silently
absent). So the plugin took its "service not composed" branch for all seven
seams, the decision seam and the command, and did nothing. Unit tests passed
because the fake ctx returned the service from `get` unconditionally, which does
not model the host.

**Consequence:** AC-4 (panels/live rendering) and the `/mpd`-based parts of
AC-6 cannot pass with the artifact as shipped, and `evidence/.../result.json`
criterion 3 is only true for the fake ctx, not for the real host. The completed
t4 record therefore needs an amendment/repair, not a silent reinterpretation.

## Required fix (host-context change, all inside `packages/mpd-tui-plugin/`)

Replace "probe then register" with the host's documented optional-seam form, one
`ctx.inject(['<id>'], (scoped) => { … })` per service, registering through the
scoped context and owning cleanup with `scoped.effect(...)`:

- `tuiStatus` → `ctx.inject(['tuiStatus'], (s) => s.tuiStatus.set('mpd', …))`
- `tuiRenderers`, `tuiSettingsSections`, `tuiScenes`, `tuiCommandTrees`,
  `tuiShortcuts`, `tuiDialogs`, `settings` (namespace registration),
  `commands` (the `/mpd` command) → same form
- decision seam → `ctx.inject(['tuiPluginHost'], (s) => attempt subscribeDecision)`
- keep: never throw, warn once (aggregate), disclose the refusal, no
  `cordis.patch.yml`, no `dsh.bundle` key, everything else unchanged
- keep the web/headless degrade: a service that never appears simply never runs
  the callback (no pending entry, no crash)

Optional: an apply-time `ctx.get(id, false)` availability *report* stays
meaningful only for services the row itself injects; the aggregate diagnostic
should be emitted from the injected callbacks instead.

## What is NOT claimed here

This note does not change any task status. It records a measured defect in the
t4 artifact and the fix shape; the repair must be an authorized task (t4
amendment or a new repair task) because t4 is terminal.
