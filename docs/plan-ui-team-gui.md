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
- W2 first slice: `packages/mpd-bundle-plugin/src/team-sidebar.js` registers a PAGE type in the
  HARNESS's right sidebar (`ctx.sidebarRightTabs` + the `sidebar.right.pane.tab` seat) and renders the
  Lead Session's `agentTeam` projection as a team-progress view. Composed into the bundle client by
  `scripts/build-mpd-client.mjs` (client.js grew to 318151 bytes, parses, 3 references).
  **RENDER NOT YET VERIFIED** — see the blocker below.
- W1, W3, W4: not started in code.

### The verification blocker, named exactly

The tab cannot be seen yet because the container's browser cannot reach a session with a team:

1. a session created through `session/create` with `cwd=/data/ws` does NOT appear under Sessions
   until `/data/ws` is a registered **Workspace**;
2. the UI's own add-workspace path opens a native directory picker, which a headless run cannot drive;
3. the client service is `ctx.workspaces.create(input)`, a Remote — not reachable from outside the app,
   and the persisted store (`<DSH_HOME>/storages/workspace.json`) is `{global:{workspaceIds:[]},
   tables:{workspaces:{}}}` with a record shape not yet confirmed.

Next step, in order: confirm the workspace record shape (or the Remote's HTTP route) → seed `/data/ws`
→ open the session → open the right sidebar → capture, and only THEN judge the tab. Until that
happens this file claims nothing about how the tab looks.
