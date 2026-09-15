# t61 evidence — the five watchdog knobs are declared AND visible

Task `t61` (w4) declared the five `watchdog.*` knobs in the ONE shared settings declaration and in
the Web card's own `FIELDS`, rebuilt the three artifacts and proved runtime visibility. No git
writes; `packages/mpd-team-watchdog-plugin/**`, `packages/mpd-agent-teams-plugin/**`,
`packages/mpd-tui-plugin/src/**`, `skills/**`, `docs/**` and `VENDOR_LOCK.json` were not touched.

| File | What it shows |
|---|---|
| `probe-watchdog-knobs.mjs` / `probe.json` / `probe.stdout.log` | 15/15 checks, exit 0. Mounts the BUILT `packages/mpd-config-plugin/dist/index.js` through a stub `mpdDsh` seam and reads the registered `mpd` schema — the five knobs with their frozen defaults. Then loads the card's own source, verifies all five rows against the shared declaration (path/label/zh/kind identical, 11 fields), and finally mounts the BUILT `packages/mpd-team-watchdog-plugin/dist/index.js` to MEASURE the precedence between the namespace value and the row config. |
| `builds.log` | The three build commands with exports and the resulting byte sizes. |
| `gates.log` | `bun run typecheck`, the three package suites (178 pass / 0 fail), `bun run verify:docs` (34 pairs, 0 failed) and `tui-settings-bridge --self-test`, plus the `build-mpd-client.mjs` idempotence pair (identical bytes and sha256). |
| `result.json` | The declaration map, rebuilt artifacts with bytes, the test-count changes, the precedence measurement and the gate exits. |

## Source changes (declaration only)

- `packages/mpd-config-plugin/src/settings-schema.ts`: `SettingsSchema` gains the `watchdog` object
  (defaults `enabled: true`, `warnSilenceMs: 90000`, `tickIntervalMs: 15000`,
  `warnStreakToEscalate: 3`, `actionOnEscalate: "pause"`) and `SETTINGS_KNOBS` gains the five
  mirrored rows.
- `packages/mpd-bundle-plugin/src/settings-card.js`: `FIELDS` gains the same five rows.
- `packages/mpd-tui-plugin/src/settings.ts` is untouched — the TUI section still derives via
  `SETTINGS_KNOBS.map(...)`; only its test's field count changed (6 → 11), as did the card test's.

## Measured precedence (the row config is DEFAULTS, the namespace is the authority)

1. Empty namespace + the row's own five values ⇒ the knobs equal the ROW values (nothing shadowed).
2. Namespace `{ watchdog: { warnSilenceMs: 12345, actionOnEscalate: "warn-only" } }` ⇒
   `warnSilenceMs` 12345 (over the row's 90000) and `actionOnEscalate` `warn-only` (over `pause`),
   while the untouched `warnStreakToEscalate` stays at the row's 3 — and the row's own guard still
   applies: `tickIntervalMs` was clamped 15000 → 4115 because it must stay below `warnSilenceMs`
   (the clamp is recorded as an issue in the probe output).
