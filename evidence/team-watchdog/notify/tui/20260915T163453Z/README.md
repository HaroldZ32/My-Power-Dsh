# t64 evidence — the TUI front door for the team watchdog

Task `t64` (w6) delivers the TUI side of the watchdog: a held team holds a **row on the status line**
while the condition lasts, a **dialog** carries the notice with an acknowledge action, and a user who
was not watching is **informed on the next start** through the durable unread replay, which the
acknowledge retires. No git writes.

| File | What it shows |
|---|---|
| `probe-tui-frontdoor.mjs` / `probe.json` / `probe.stdout.log` | 6/6 checks on REAL modules and TWO FRESH bun processes: a fresh process reads the seed (`unread [1000, 2000]`), the status publisher emits a line containing the notice, the dialog request carries the notice text + `acknowledge`, and a second fresh process reads `unread []` with the watermark bytes `{"mpd-tui": 2000}`. |
| `build.log` | The rebuild: 106479 → 115371 bytes, sha256 `81266559…` → `72c55f34…`. |
| `gates.log` | `bun test packages/mpd-tui-plugin` (52 pass / 0 fail, 415 expects), `bun run typecheck` exit 0, `bun run verify:docs` PASS, `tui-panels --self-test` exit 0, `tui-settings-bridge --self-test` exit 0, the zero-write grep on `src/watchdog.ts` (no write API) and the adopted-code check. |
| `ws/` | The real store the probe seeded and then acknowledged: `watchdog/hold/…`, `incidents.jsonl`, `read-watermark.json`. |
| `result.json` | The implementation map, digests, probe values, the honest fallback and the NOT-CLAIMED pane leg. |

## The three legs

1. **Notice composed into the rendered status line.** `src/watchdog.ts` reads the durable store and
   `src/index.ts` composes its text into the SAME `tuiStatus.set(...)` value as the settings-bridge
   notice. Measured line while held:
   `mpd: team - · plans 0 · workmates 0 · notes 1 · watchdog: held mpd-default-1 · 2 unread incidents`;
   after the team is resumed and the incidents are acknowledged the line is the plain board line
   again. The front door is built BEFORE the status seam so the first publish already carries it.
2. **Dialog + acknowledge.** The replay dialog's title carries the notice text and the options are
   `[acknowledge, later]`; choosing `acknowledge` advances the per-reader watermark through the
   owning package's `ackIncidents` and the file on disk becomes `{"mpd-tui": 2000}`.
3. **Process boundary.** Two FRESH `bun` processes read the store from disk: the first sees
   `unread [1000, 2000]`, the second (after the acknowledge) sees `unread []` — the flag is read from
   disk, never from an in-process cache.

## Honest limits (recorded, not hidden)

- **Interactive pane / keystroke leg: NOT-CLAIMED.** No TTY/tmux pane could be attached from this
  session, so the pane leg is not reported as passed. The assertions are made on the value the status
  publisher emits and on the dialog request the host was handed.
- **Without an acknowledge the replay is permanent re-display BY DESIGN** (design §5.3): choosing
  `Later` leaves the incident unread, so it reappears on every start. That is asserted by the
  `choosing Later keeps the incident unread` test, not described as a bug.
- **Write discipline:** `src/watchdog.ts` performs no filesystem write (grep in `gates.log`); the only
  mutation is the watermark, written by the watchdog package's own `ackIncidents`.
- **Adopted code untouched:** nothing under `packages/mpd-agent-teams-plugin/**` was changed by this
  task (w7 owns the wave's single delta-registry re-run).
