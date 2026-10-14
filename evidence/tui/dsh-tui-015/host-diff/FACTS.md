# FACTS — measured dsh-tui 0.14.0 → 0.15.0 delta (captain measurement, 2026-10-15)

**Reproduce the host payloads** (they are third-party bytes, gitignored, not committed): download both
tarballs from the registry mirror and unpack them beside this file as `a/` (0.14.0) and `b/` (0.15.0):
`curl -sL -o 014.tgz https://registry.npmmirror.com/@deepseek-harness-tui/dsh-tui/-/dsh-tui-0.14.0.tgz`
and the same for `0.15.0`, then `mkdir a b && tar xzf 014.tgz -C a && tar xzf 150.tgz -C b`. Every
`a/…` / `b/…` path this file cites resolves inside those two trees.

Method: downloaded both npm tarballs from registry.npmmirror.com into this directory (`014.tgz`,
`150.tgz`), unpacked to `a/` (0.14.0) and `b/` (0.15.0), diffed the plugin-facing surface.
0.15.0 was published 2026-10-13T14:17:59.450Z; npm `latest` = 0.15.0.

| Fact | Measurement |
|---|---|
| The `ctx.tui*` service-id set | **IDENTICAL**: exactly **15 mounted plugin-facing services** in both versions — `tuiCommandTrees tuiDialogs tuiEffectLedger tuiMessageObserver tuiPanels tuiPluginHost tuiPluginStorage tuiRenderers tuiScenes tuiSettingsSections tuiShortcuts tuiStatus tuiThemes tuiToast tuiWorkspaces` (each registered by a `Service` subclass in `lib/types/dsh-adapter/*.js`). **No 16th seam.** A raw text grep also finds `tuiChannel`, but that is the KERNEL-CHANNEL PROTOCOL id (probe-evidence labels in `adapter/upstream/channel-driver.js` + the `tui-profile/protocols/tui-channel.*` capability definition) — no `Service` registers it, no Context augmentation exists, and a plugin has nothing to inject. Excluded from the plugin-seam count (Researcher double-check, two independent evaluations concur). |
| Seam declaration changes | **Additive only.** `panels.d.ts`: +`applyConfiguredSidePanelPanels()` +`applySidePanelPanelsFromSettings()` (host-side CSV merge helpers; comment: registered panel ids are merged back to the tail unless explicitly removed, and boot settings must NOT go through the settings path). `plugin-host.d.ts`: +`probeBackendAdmission()` (read-only Backend-family admission probe, W-2). All other seam `.d.ts` byte-identical. |
| Harness peer range | Unchanged — every `dsh-*` peer still ends at `0.2.0-rc.2` → **`MPD_E2E_DSH_VERSION` does NOT move** (0.2.0-rc.2). New OPTIONAL peers: `@deepseek-ai/dsh-plugin-manager@0.2.0-rc.2`; `dsh-app-boot`/`dsh-cmdline`/`dsh-http-proxy`/`dsh-launch-environment` now pinned `0.2.0-rc.2` and marked optional (`dsh-home-paths` stays a RANGE `^0.1.0-rc.6 || … || 0.2.0-rc.2`). New runtime dep: `zod@^4.4.3`. |
| Builtin sidebar defaults | `DEFAULT_SIDE_PANEL_IDS = 'todo,jobs,agents,info,trajectory,workspace,btw,companion'` — **UNCHANGED** → the panel-visibility invariant tests should stay green. |
| Panel descriptor freeze | `capabilities` still absent from `dsh-adapter/panels.js` (grep count 0) → the ⤢ fullscreen residual still holds; no host-drawn fullscreen for plugin panels. |
| Counted contacts intact | `lib/types/ui.js` exists with `useStdin` (the Ctrl+A contact path); `subscribeSidePanelPanels` present in `lib/types/tuiDisplayPrefs.js` + `lib/types/components/sidePanel/useSidePanel.js` (the keeper's feed). |
| Admission profile | `tui-profile/registry/registry-0.15.json` CHANGED; NEW contract `registry/contracts/backend-v1alpha1.json` (the Backend contribution family). The registry VERSION stays `0.15` (the ecosystem-spec number, unrelated to the dsh-tui 0.15.0 release — the repo's known false-positive). |
| New host subsystems (NOT plugin-facing seams) | `admission-loader`, `backend-admission/-contribution/-registry`, `backends.generated`, `entry-slot`, `fresh-agent`, `host-contract`/`host-dsh`/`host-entry`, `lite-profile`, `plugin-completions`, `plugin-declaration`, `plugin-manager`, `process-exit`, `root-dispose`, `session-list-metadata`, `session-seed`, `tui-settings` modules under `lib/types/dsh-adapter/`; `index.d.ts` relaxes the embedder `backend` field to plain `string`. |
| **PanelBar icon painting (ADDED 2026-10-14 post-freeze, measured during Lane D)** | **0.15.0 PAINTS plugin icons again.** The 0.14 reading (carousel, `grep -c icon PanelBar.js` = 0, dots) is SUPERSEDED: 0.15.0's `tabLabel()` draws `tab.icon ?? <first title char> ?? '?'` + the unread dot — `a/` has 0 icon lines, `b/` has 15. Our `❖`/`⬢` are back on the bar with ZERO bundle changes. The field stays REQUIRED and declared; the 0.14 sentence stays readable as history (`docs/tui.md` §11.7 + the CHANGELOG carry both). |

## Consequence for the wave

The 0.15.0 adaptation is a **carrier move + verification** wave (the 0.14.0 shape), NOT an
adapter-code wave: same 15 plugin-facing seams, additive-only declarations, unchanged panel
defaults, unchanged harness peer range. **Adoption evaluation (two independent Researcher passes,
convergent): every new 0.15.0 capability is host-internal or diagnostic-only — no adoption target.**
`probeBackendAdmission()` is genuinely callable from a bound `tuiPluginHost` (real method on
`TuiPluginHostRuntime`, read-only, guarded) but diagnoses a Backend family we do not ship
(the third-party install chain is not wired upstream) — declined. `requirePluginCaller` is
functionally byte-identical a↔b, so our `waiting_authorization` / undeclared-but-working posture
carries; `tuiDisplayPrefs.js` (the keeper's counted contact) is byte-identical; `ui.js`'s `useStdin`
intact. The open risks are (1) **R1: the host now self-heals the panel CSV on every config apply AND
records explicit /settings removals session-wide (`removedPanelIds`)** — a user who removes BOTH MPD
panels via /settings produces a CSV our feed-first keeper reads as a WIPE and repairs, re-adding
explicitly-removed panels (the 0.14 declared residual now contradicts host-recorded intent; the
helpers are host-internal so the keeper cannot read the removal record) — and (2) the Docker lane's
container-side network (the 0.14 wave's declared residual). The changed `registry-0.15.json` + the
new admission-loader (reads our package-root `dsh-plugin.json`) make the `tui-admission` lane
re-run load-bearing.
