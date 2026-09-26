# t12 — correctness and risk review of `packages/mpd-tui-plugin`

**Verdict: PASS** (no blocker, no high finding). Five low findings, all diagnosis/cleanup-grade,
plus six verified non-findings recorded so a later reader does not re-file them.

Reviewed at the **latest** revision: `dist/index.js` sha256
`5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` (98883 B, mtime `06:23:20Z`) — the
digest my own t8 lanes measured. Manifest judgement is scoped to the digest measured at review time
(`84ed4a5d…`, t24 was editing it) — see `result.json`.

Gates run on this state: `bun test packages/mpd-tui-plugin` → **37 pass / 0 fail**, `bun run typecheck` → **exit 0**.

## The three acceptance questions, per seam

| Seam | Degrades when absent | Sanitized | Cleanup on unload |
|---|---|---|---|
| tuiStatus | yes (absent outcome, guarded publish, unref'd timer) | yes (`scalarText` per field) | yes — `effectOn` clears timer + releases key |
| tuiRenderers | yes (refused/requested, never confirmed) | yes — out and host-side | yes — `effectOn` owns each disposer |
| tuiSettingsSections | yes (refusal caught, section still declared) | n/a (static) | host-bound; see R2 |
| tuiScenes | yes (`open()` → false + debug) | yes (board lines via `scalarText`) | host-bound (`bindCallerEffect`) |
| tuiCommandTrees | yes (refused/requested) | yes (static strings) | host-bound |
| tuiShortcuts | yes (refused when `list()` shows none) | n/a | yes — `effectOn` |
| tuiDialogs | yes (`undefined` on cancel/timeout/absent) | yes (clamped labels/ids) | n/a (request/response) |
| commands (`/mpd`) | yes (error text returned, never thrown) | yes (`clamp`/`scalarText`) | **R2** |
| decisionEvents | yes (per-event absent/refused/requested) | yes (`shortReason` clamped) | yes — `effectOn` in all branches |

## Decision-event honesty (the one capability the host blocks)

- **No bypass**: the only `token` strings in `src/` and `test/` are comments stating admission is
  token-gated and unreachable and that the plugin never calls `admit`/`admitInternal` (`decisions.ts:5-7,21-22`).
- **One warning**: the NOT-ACTIVATED `log.warn` fires once per boot for the whole seam, not four times.
- **No activation claim anywhere**: `README.md:28,99`, `decisions.ts:1-3` and `dsh-plugin.json`'s
  `x-mpd-tui-surfaces.decisionEvents` ("built ready-but-not-activated, never faked") all agree. The
  `seam ACTIVE` log line is reachable only when `grants.allows() === true`.
- **t10-F1 CLOSED**: `confirmed` now keys on the host's grant facade, not on `typeof disposer`; the
  `() => false` sentinel is covered by a test as a NON-active outcome and the disposer is never called as a probe.

## Findings

| Id | Sev | Where | Problem (see `result.json` for the full text) |
|---|---|---|---|
| R1 | low | `decisions.ts:73` | `host.grants` getter read outside try/catch; on a host-state miss it throws, `onService` swallows it, and the seam keeps a **false** `absent / "tuiPluginHost was not injected"` outcome. Fix: guard the read, fall through to the honest `requested` branch. |
| R2 | low | `settings.ts:141`, `commands.ts:54` | The two harness-side registrations bind their effect to the SERVICE's ctx, so the plugin cannot release them: after unload/reload the namespace re-register THROWS ("already registered") and is reported `refused`. Fix: disclose, or probe-then-skip. |
| R3 | low | `index.ts:172` | `workspaceRootsAll()[0]` is order-dependent across multiple live sessions. Not reachable today (one session per TUI process) — my run proves it read the sandbox workspace, not the repo. |
| R4 | low | `types.ts:154` | `probeDecisionEvents()` declared but never called: an available second read-back for the decision seam is unused (`grants.allows` is still the strongest signal used). |
| R5 | low | `types.ts:142` | t10-F3 residual: `confirm()` typed `Promise<boolean \| undefined>` while the host always resolves a boolean — harmless widening, caller already treats `undefined` as cancel. |

## Verified non-findings (do not re-file)

- **"Discarded disposer = leak" is FALSE for the TUI seams**: the host binds the caller effect itself
  (`bindCallerEffect` in scenes, settings-sections, command-trees, shortcuts, status, renderers), so
  plugin-scoped registrations die with the activation. Our extra `effectOn` ownership is belt-and-braces.
- **T4-INERT-1 cannot silently return**: tests *model* the host — a ctx without `inject` registers
  nothing even when `get()` would answer, and a ctx with `inject` but no composed service registers
  nothing and throws nothing (29 → 37 tests with the repair).
- **Sanitization holds**: scalars only, C0/C1 (hence ANSI/CSI) stripped, whitespace collapsed,
  cell-clamped with wide-glyph awareness, bounded lines — and the host sanitizes again.
- **The package is read-only**: no `writeFileSync`/`appendFileSync`/`mkdirSync`/`rmSync`/`unlinkSync`
  anywhere in `src/`, so it can neither escape the workspace nor touch `~/.dsh`.
- **t10-F2 CLOSED** in `shortcuts.ts` (uses the `list()` read-back) and `renderers.ts` (reports
  `requested`, never "registered").
- **t10-F4 is a disclosure, not a defect**: `/mpd` is unattributed in the ledger because the mediated
  path needs an admitted Component and admission is `waiting_authorization`; the consequence is measured
  and written into the manifest.
