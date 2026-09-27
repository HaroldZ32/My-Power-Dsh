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
- W3, W4: not started in code.

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
