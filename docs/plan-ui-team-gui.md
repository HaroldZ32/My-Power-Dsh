# Plan: team-feature restoration, sidebar GUI, and UI optimisation

Process record (AGENTS.md §3: `docs/plan-*.md` is exempt from the bilingual rule). English-only.

## 1. The rule for this wave

**Observe, then change.** No UI verdict in this wave comes from reading component source, from
`--dump-config`, or from a DOM dump. Every claim below was measured on a rendered page or on a real
boot, and the tool that produced it is committed (`docker/ui/**`).

## 2. The observation environment (committed)

`docker/ui/docker-compose.yml` brings up ONE long-lived container holding BOTH surfaces open:

- the Web GUI, bound to loopback **inside** the container and carried to the host by a `socat` relay
  on the published port (`127.0.0.1:3081`). The harness REFUSES `--host 0.0.0.0` on purpose ("it would
  expose remote code execution to the network"), and that refusal is NOT worked around by weakening
  the harness — the relay is the container's own decision, and the app's browser-trust fence is told
  the relay's authority via `--trusted-host`.
- the TUI inside `tmux` (`docker exec ui-ui-1 tmux -S /data/tui.sock capture-pane -p`).

`docker/ui/capture.mjs` drives the container's OWN headless Chromium (Playwright) against the GUI and
writes PNGs plus a JSON report (visible text, the control list, console errors, failed requests) to
`docker/ui/out/shots/`. Measured on a working run: 6 steps, `sessionCreate.status = 200`,
`agentPreset: "mpd"`, no console errors, and the first-run modals dismissed by the script.

## 3. What the first real scan found

### F1 — the bundle contributes NO sidebar GUI on a checkout install (blocker)

Measured, three independent ways in one container:

- the profile's `node_modules` contains **only** `@mpd-dsh` — `dsh-better-sidebar` is NOT there, even
  though the bundle declares it as a dependency and the package exists at
  `<bundle>/node_modules/dsh-better-sidebar`;
- the boot log says `[mpd-better-sidebar] mount guard: DISABLED - dsh-better-sidebar is not resolvable
  from the profile node_modules`;
- the rendered page's navigation has exactly `New Session / Plugins / Workspaces / Settings` — none of
  the bundle's tabs, and no way to reach team state or the workmate library from the UI.

Cause: the documented "declare it, and `healProfileModuleFallback` materializes the closure" mechanism
does not fire for a `link:` install, which is exactly what `dsh plugin add .` produces.
`pnpm` links the bundle and does NOT install the linked package's own dependencies.

A test proved an absolute path DOES resolve as a row name (the entry materialised as
`file:///src/node_modules/dsh-better-sidebar/lib/index.js`), so a bundle-relative row is a viable
repair — but the better answer is F2.

### F2 — the harness has an OFFICIAL right-sidebar tab registry

`@deepseek-ai/dsh-client-ui-sidebar-right` owns "one docking surface per session … the navigation
controller `ctx.sidebarRight`, the tab-type registry `ctx.sidebarRightTabs`, and the Tab domain", and
the harness's own Files / Terminal / Browser / Document-preview tabs are built on it. Its slot seats
include `sidebar.right.pane.tab`, `sidebar.right.toggle` and `sidebar.right.tab.menu.item`.

That is where this bundle's GUI belongs, and it removes the third-party host from the critical path
entirely. The current `dsh-better-sidebar` page is then an OPTIONAL host, not the only way in.

### F3 — the first-run flow stacks gates that hide everything

Rendered, in order: the "Internal Testing Notice" modal, then "Add an API key to get started", and a
session created through `session/create` with `cwd=/data/ws` does NOT appear under Sessions until that
directory is registered as a Workspace. None of the three is this bundle's to change; the capture
driver learns to clear them so the review below them is possible.

## 4. Work plan

| # | Item | Notes |
|---|---|---|
| W1 | Team functionality restored on the official plugin, with the retired plugin as the reference | the capability list in `docs/plan-0.1.7-adaptation.md` §8 is the checklist: staged plan + approval, dispatch, task contracts/attempt, halt/resume, archive, mailbox unread, per-member model routing, `/agent-teams` command |
| W2 | Team + workmate GUI registered in the HARNESS's right sidebar (`ctx.sidebarRightTabs`) | F2; the third-party host becomes optional |
| W3 | `dsh-better-sidebar` row repaired bundle-relatively so the sidebar does not depend on a profile-level install | F1; keeps the packed layout working too |
| W4 | UI optimisation from the scan: settings, team task progress, watchdog panel, TUI panels | only after W2 makes the surfaces reachable |
| W5 | One release, at the end, whose notes describe the CHANGES | the user's explicit instruction: no per-round releases, no "what was asked" narration |

## 5. Status

- Observation environment: DONE and committed (`docker/ui/**`, screenshots under `docker/ui/out/shots/`).
- F1/F2/F3: measured, recorded here.
- W2 first slice: **DONE and VERIFIED ON SCREEN**. `packages/mpd-bundle-plugin/src/team-sidebar.js`
  supplies the view; `src/web-client.js` registers it from the bundle's ONE applied client module.
  The tab renders in the harness's own right sidebar with the real projection:
  `Team · Team progress · 0/0 done · MEMBERS (1) · lead [lead] · TASKS (0) · No shared task yet.`,
  no console errors (`docker/ui/out/shots/04-sidebar.png`).

  Three measured facts that shaped it, each a real failure first:
  1. **A sibling `__ModuleLoader__.load` block is NOT applied.** Registering from a separate
     `@mpd-dsh/team-sidebar` module loaded the code and rendered nothing — the client-module
     registry APPLIES the entry's own module (`@mpd-dsh/mpd`), so the registration lives there.
  2. **The guide entry names a `commandId`, not an `open` callback**, its `title`/`description` are
     locale-bound FUNCTIONS, and the command behind it is a client SHORTCUT — taken from the
     shipped `@deepseek-ai/dsh-client-ui-sidebar-browser` definition, which is the working example.
  3. **An undeclared service read takes the whole entry down**: touching `ctx.sidebarRightTabs`
     without it in `inject` produced `web boot: 1 entry did not activate — @mpd-dsh/mpd: failed` and
     the app rendered "Failed to load plugins". The services are reached through
     `ctx.inject(["sidebarRightTabs","sidebarRight"], …)`, so an mpd bundle in a composition with
     no right sidebar still activates.
- W1 first slice: `packages/mpd-team-tools-plugin` — the team WORKFLOW the official plugin does not
  ship, as a sidecar under `<workspace>/.mpd/team/`: **staged plan + approval** (`agent_teams_create`
  / `_add_member` / `_create_task` / `_edit_plan` / `_approve` / `_delete`), **task contracts with a
  monotonic attempt counter** (`agent_teams_claim_task` / `_task_contract`), **halt/resume**, and a
  read-only `agent_teams_status` that prints the sidecar BESIDE the official roster and board. Plus
  the `/agent-teams` command. 13 arms drive the state machine without a ctx; row `mpd-team-tools`
  mounted, dist built, packer + installer + row parity green.
  NOT yet done in W1: the dispatch/scheduler loop, mailbox unread (the official inbox exposes no
  read state, so inventing one would misreport it), and per-member model routing (blocked on the
  user's decision).
### F4 — the mpd SETTINGS section never appears, and now the cause is exact

Rendered evidence: the Settings dialog shows `General / Models / Built-in plugins / Agent presets`
and no `MPD` entry (screenshot `05-settings.png`, re-taken after the fix below).

Two distinct causes, one fixed and one not:

- **Fixed:** the card mounted through `require("@mpd-dsh/settings-card")`, a SIBLING
  `__ModuleLoader__.load` block the real loader's require map cannot serve — the same class as F1.
  `scripts/build-mpd-client.mjs` now splices the card's own factory body into `@mpd-dsh/mpd` (the
  module the registry APPLIES) behind an IIFE, and `loadSettingsCard()` prefers it while keeping the
  `require` path as the offline harness's fallback. The boot log no longer carries
  `settings card module failed to load`.
- **NOT fixed, and the reason the section is still absent:** the card registers its CONTENT inside
  `ctx.inject(["settingsScope"], …)`, and **`settingsScope` exists nowhere in the installed harness
  0.1.7-rc.2** (a repo-wide grep over every `@deepseek-ai/*` client bundle returns nothing). The
  inject callback therefore never fires: no section, and — because that path logs nothing — no
  warning either. The slot name is right (`settings.section` is what the harness's own sections
  use); the SERVICE is gone.

  **FIXED in the same wave, and verified on screen:** the service name was the whole of it.
  `ctx.configForms.get(ns)` hands back a `ConfigFormController` with the SAME shape the card already
  used (`getSnapshot`, `subscribe`, `set`, `mutate`, `unset`), so the card is untouched and only its
  host object moved — and the mount stays DEFERRED through `ctx.inject(["configForms"], …)`, which is
  what the harness's own sections do, because the service comes from another plugin's fiber and a
  one-shot probe would race it. The Settings dialog now renders
  `General / Models / Built-in plugins / Agent presets / MPD` (`05-settings.png`), and the offline
  arms were migrated with it: the fixture had modelled `settingsScope.bind({namespace})`, i.e. the
  test pinned the SAME dead service the code did — which is how the absence stayed green.

### W4 progress (verified on screen)

- The Team tab now states what a captain acts on: `1 of 1 running · 0 ready · 0 blocked` beside the
  completion bar, read from the same projection (`ready` / `blockedBy` were already on the board).
- Both empty states name the tool that fills them instead of saying "none yet".
- `src/team-sidebar.js` was DELETED: its body had been hand-spliced into `web-client.js` and the two
  copies could drift. One source now, in the module that is actually applied.

### The UI stack is self-sufficient

`down -v` empties the named volume, and the capture then died on `ERR_MODULE_NOT_FOUND` while the
reviewer read the PREVIOUS run's screenshots — a stale-evidence trap, not a UI bug. The entrypoint now
installs the capture tooling into the volume itself and copies `capture.mjs` / `run-capture.sh` in from
the image, so a rebuilt stack can always look at itself.

### F5 — the TUI's MPD settings section shows every knob as `（未设置）`

Rendered evidence (`tmux capture-pane` on the container's real TUI, 2026-09-27):

```
╭─ MPD 插件包 (mpd) ───────────────────────────── [命名空间未注册] ╮
│ ❯ 行内 diff 上限                                    （未设置） │
│   注释检查                                          （未设置） │
…all 25 rows…
```

The section RENDERS (so `mpd-tui-plugin`'s seam works) but its namespace is not registered, so every
value reads unset and nothing is writable. Both surfaces log
`[mpd-config] settings bridge: could not register the "mpd" namespace (…)`.

**The cause, measured rather than inferred.** Two sentences had been ONE — "settings service is
unavailable" — for a service that is ABSENT and for one that is PRESENT but cannot register. Split
them and the dsh-tui profile answers immediately:

```
the settings service is present but exposes no register()
(keys: ctx,name,ownerContext,revisions,closed,scheduled,presentations)
```

So in the TUI profile the deferred inject fires at once, a `settings` SERVICE exists, and it is not a
registration-capable provider. `mpd-tui-plugin`'s guarded fallback then SKIPS with
`configPluginPresent(ctx)` true — its premise being "mpd-config owns the registration" — and nobody
registers anything. The fallback's premise is false exactly when the owner cannot register.

NEXT STEP, named: find what registers a settings namespace in a `dsh-tui` composition (the service
above answers `describe()`/`get()` — a read surface; `mpd-tui-plugin` already types a
`SettingsProviderLike` with `describe`/`get`/`register`, so the registration path exists somewhere),
then either point the bridge at it or let the fallback take over when the owner's attempt FAILS
rather than when the owner is merely present.

Also recorded while chasing it: an adapter-side diagnostic now says WHICH path ran
(`deferred inject available/ABSENT`), because the two paths fail with the same downstream sentence.
- W4 next: the MPD section's own page is captured by `05b-mpd-section` now (the nav entry proves the
  REGISTRATION, the page proves the card renders its rows — different claims); the TUI panels still
  need the same treatment.

### How the UI became reachable (solved, keep it)

1. A session created through `session/create` does NOT appear under Sessions until its cwd is a
   registered **Workspace**, and the UI's add-workspace path opens a NATIVE directory picker.
   The store is plain JSON at `<DSH_HOME>/storages/workspace.json`, and the controller projects
   `{id, path, title, sessionIds, createdAt, updatedAt}` — `docker/ui/run-capture.sh` seeds that
   record, which is a UI FIXTURE, not a product claim.
2. The first-run gates (testing notice, then "Add an API key") RE-APPEAR after a reload and their
   overlay swallows clicks; the driver clears them immediately before each click that matters.
3. Open the panel by the EXACT control name `Open right sidebar`: a loose `/sidebar/i` matches
   "Collapse sidebar" first and collapses the LEFT rail instead (measured, screenshot 04).
