# t65 evidence — the TUI's zero-write invariant restored, behaviour unchanged

Task `t65` (w6b) moved **every** watchdog-store access behind the `mpdWatchdog` service so the TUI
package no longer links the watchdog's sidecar writers into its own build. The observable
notification behaviour is re-proven, unchanged. No git writes.

| File | What it shows |
|---|---|
| `t7.log` | The lane's own pure evaluator on the REBUILT dist: **arm ok = true**, all eight checks pass, `T7 — the TUI dist performs ZERO filesystem writes (offenders: [])`; and `grep -c` over the rebuilt dist prints **0**. |
| `probe-tui-frontdoor.mjs` / `probe.json` / `probe.stdout.log` | 9/9 checks: the held status line, the dialog request `[acknowledge, later]`, the watermark advancing **through the service** across TWO fresh processes, the `Later ⇒ no watermark` arm, and the absent-service arm. |
| `build.log` | Both rebuilds: TUI dist 115371 → 111398 bytes; watchdog dist 110774 → 113919 bytes. |
| `gates.log` | `bun test <both packages>` 108 pass / 0 fail · `bun test packages` 699 pass / 0 fail · `bun run typecheck` exit 0 · `bun run verify:docs` PASS · the watchdog apply lines showing `holdService=mpdWatchdog`. |
| `ws/` | The real store the probe seeded, acknowledged and then left one unread incident in (the `Later` arm). |
| `result.json` | The reproduction, the fix, digests, the T7 detail, the probe values and the honest limits. |

## Reproduction → fix

- **Before:** `grep -c` on the TUI dist = **4**; `evaluateTuiSurface` → `arm ok = false`, `FAIL T7
  offenders: ["writeFileSync","appendFileSync","mkdirSync","rmSync"]` — because `src/watchdog.ts`
  imported the watchdog's sidecar readers at runtime and bun inlined their writers.
- **Fix:** `HoldRegistry` gains `heldTeams(workspace)`, `unread(reader, workspace)`,
  `acknowledge(reader, upTo, workspace)` and `view(reader, workspace)` (synchronous, non-throwing,
  the write performed inside the owning package), published on `mpdWatchdog`; the TUI resolves that
  service at call time and keeps only `import type` for the record shapes.

## Absent-service path (stated exactly)

With no `mpdWatchdog` service the TUI does **not** throw at apply: the status line stays the plain
board line (no watchdog text), no replay dialog is offered, and `acknowledge()` returns
`{ ok: false, error: "the mpdWatchdog service is not mounted — the watchdog store was not written" }`
rather than pretending. The absence is warned once.

## Honest limits

- The interactive pane/keystroke leg is **NOT-CLAIMED** (no TTY could be driven here).
- `Later` (or never acknowledging) leaves the incident unread **by design** — asserted, not a bug.
- The **watchdog package's own dist had to be rebuilt** (it is what a real bundle row loads and where
  the new methods live). That path is outside this task's declared inScope; it is declared in the
  completion output for the captain.
- A fresh full dsh **host mount** was not re-run: the change is additive to the service object. The
  mount-level claim rests on the apply-level assertion in `gates.log` plus the existing boot logs
  (`evidence/team-watchdog/pause/20260915T164700Z/raw/driver.log`, `evidence/team-watchdog/plugin/20260915T162351Z/`).
