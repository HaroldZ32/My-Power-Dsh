# Evidence — the TUI watchdog panel wave (2026-10-22T16:52:39Z)

Lane: T4 (Deep Worker). Contracts: `.mpd/plans/watchdog-tui-panel.md` (primary) and
`.mpd/plans/slot-single-source.md` §3 (the `/mpd-model` cleanup). Revision: `8213ebc7` on `dev`
(no git write from this lane; the captain commits).

## What this lane delivered

1. **A third sidebar page** — `packages/mpd-tui-plugin/src/panel-watchdog.ts`, descriptor
   `watchdog` / `MPD watchdog` / icon `⚠` / `order` 13 / `minColumns` 28, registered through the
   adapter's `registerPanel`. It shows, per team, the held state and phase; the `mpd-tui` unread
   count; and the unread incidents with kind, relative age, team/task/attempt, cause + `ms`, hold
   outcome and ack state. Keys: `a` acknowledges up to the newest shown incident (advancing ONLY
   the `mpd-tui` watermark, once per press), `r` refreshes, `↑↓`/`jk` and
   `PgUp`/`PgDn`/`Home`/`End` scroll. Data comes ONLY from the `mpdWatchdog` service through the
   package's own front door — never the store files. No service ⇒ `watchdog: not available`.
2. **`/mpd watchdog`** — opens the page through `openPanel(handle.id())`; the page has no
   full-screen fallback, so an absent seam is reported in one line and nothing throws.
3. **Its own attention badge** — `panel-attention.ts` publishes a second badge to the watchdog
   page's id (hold = `warning`, unread = `info`, count = sum) and re-takes it on a 5 s unref'd
   poll as well as on every team-feed event (a hold is raised by the watchdog's own timer and
   touches no team record).
4. **`/mpd-model` cleanup** — the scope panel, the clear branch, `TARGET_*`, `readRouteTables`,
   `memberRouteText` and `targetPanelOptions` are DELETED. The dialog asks slot → provider →
   model → effort and writes `teamModels.<slot>` only. The slot options show the config service's
   typed `slotResolutionOf` answer (`<unconfigured>` / `<invalid>` / `<unavailable>` / the route),
   narrowed from the REAL union (`status`, not a lookalike) — a leftover `agentRoutes` block is
   neither read nor rewritten, and the `/settings` summary no longer prints it.
5. **Docs** — `docs/tui.md` + `docs/tui.zh-CN.md` (§3.3 inventory, reachability, `/mpd-model`
   cleanup, new §11.9) and the bilingual decision record `docs/tui-dag-renderer.md` +
   `docs/tui-dag-renderer.zh-CN.md`; both package READMEs updated.

## Gates (logs in this directory)

| Command | Exit | Observed |
|---|---|---|
| `.toolchain/node_modules/.bin/bun test packages/mpd-tui-plugin` | **0** | 553 pass / 0 fail, 22 files |
| `node_modules/.bin/tsgo --noEmit` | **0** | clean |
| `node scripts/verify-docs-parity.ts` | **0** | pairs=50 failed=0 violations=0 links=445 dead=0 — PASS |
| `node scripts/verify-comment-coverage.ts` | **1** | 4 violations, NONE in `packages/mpd-tui-plugin` (slots-lane files) |
| the two seat gates (`no-direct-tui-access`, `no-terminal-writes`) | **0** | 5 pass / 0 fail |

## Proof rung and bounds

Reached: **unit/integration through doubles** — a host-kit React double (hooks, effects, rendered
rows), a `TuiAdapter` double and the plugin-contract composition arm that proves the row registers
all three panels and the `/mpd watchdog` command in ONE apply.

NOT reached, stated honestly: **no live PTY render**. The host loads `packages/*/dist/index.js`,
`dist` is the captain's deliverable by contract, and rebuilding it is outside this lane's scope —
so a live boot would have exercised the old bytes. The next step is the captain's: rebuild the
package with the pinned toolchain, restart `dsh-tui`, and capture `/mpd watchdog` (the page, the
tab badge, `a` advancing the watermark).

Also unproven: the real host's admission of a third page (the ≤4 budget is documented, not
measured here); the phase of a held team that is not the projected team prints `?` (the service
carries no per-team phase); the production poll cadence (proven with a 20 ms period in the arm).

## Out-of-scope findings

* `agent-references/seam-adapters.md` still says “The sidebar carries TWO pages, not three” — false
  now, and outside this lane's write scope.
* `verify:comments` is red on four files in the slots lane; listed in `comments.log`, not edited.
