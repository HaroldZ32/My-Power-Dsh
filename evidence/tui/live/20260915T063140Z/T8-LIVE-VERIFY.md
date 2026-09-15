# t8 — live-lane verification (Reviewer, attempt 2)

Independent re-run of the TUI live lanes from a sandbox **I created myself**, plus a falsification of the
renderer gap using a second, independent plugin. Verdict: **verification performed — the repaired package
is LIVE and the panel RED reproduces**, with one lane defect (owner t7) and one host-side attribution.

- Sandbox root (mine, F9): `.mpd/recon/qa/t8-reviewer-20260915T063140Z` — created and installed by
  `raw/install-fresh-root.sh` (host 74 pkgs + bundle, both exit 0). t7's warm root `.mpd/recon/qa` was
  **not** used.
- Artifact pinned by digest: `packages/mpd-tui-plugin/dist/index.js`
  `sha256 5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f`, 98883 bytes.
- Raw material: `lanes/tui-mount/`, `lanes/tui-panels/`, `raw/` (install log, console logs, canary).

## What reproduced

| Lane | Result | Witness |
|---|---|---|
| `tui-mount` | **PASS** (exit 0) | bundles `[dsh-base, dsh-tui, @mpd-dsh/mpd]`; `mpd-tui` composed; keyed status line + counters in the captured pane; **zero** apply-crash signatures; preset `mpd` from the session record THIS run created (sandbox-keyed, `inherited: []`, `isolationOffenders: 0`) |
| `tui-panels` | **RED on exactly one surface** (exit 1) | 6/7 seams render: `tuiStatus`, `tuiCommandTrees`, `commands`, `tuiScenes`, `tuiSettingsSections`, `tuiDialogs`. `tuiRenderers` MISSING. Negative control `ok=false` as required |

The board scene really opened (`MPD board` in the pane), the `mpd-tui/board-opened` event is in the
durable store (1 occurrence), and the scene header itself reports **0 transcript row(s)** — so a seam that
renders nothing failed the lane, exactly as the contract requires. This is a genuine RED, not a vacuous
pass: the same engine reports the other six as rendered on the same captures.

## CORRECTION (appended after t8 was terminal)

**This section's earlier claim — "two independent plugins, same host path, no renderer row can be
produced in this composition" — is WRONG, and the correction is recorded in
`CORRECTION-renderer-causation.md`.** Summary: my canary registered only an ALREADY-SEEN type, and my
canary additionally had a `ctx.effect` form bug that unregistered its renderers at apply time. A
single-boot cross-run with the implementer's `probe9` (both probes mounted together) shows fresh types
**do** render while the seen type does not. The disposition is unchanged (renderer line NOT CLAIMED),
but the recorded cause and the scope of my earlier conclusion are corrected there.

## AC-7 — is the negative control the intended failure?

Yes. `lanes/tui-panels/negative/control.json` re-runs the lane's own assertion engine on the **same real
panes** with one impossible expectation (`/MPD-PANELS-CONTROL-CANNOT-APPEAR/`) and records
`rendered: false` on a **non-empty** pane (`sourceChars: 2222`). The demonstrated failure is therefore a
genuinely absent surface on a populated pane — not an unrelated error that merely reddened the run. The
offline `--self-test` covers the complementary direction (a missing scene, an absent dialog and an empty
command store are each rejected), and this run's own RED demonstrates the lane can fail on a real miss.

## t8-F2 — the renderer gap, falsified independently

The captain asked whether **any** renderer row can be produced in this host. Test: a canary plugin of mine,
composed only through the **sandbox profile's own patch layer** (never the repo), registering a renderer for
the same event type through the host's documented deferred-inject path.

```
apply entered
inject callback fired
tuiRenderers service reachable: object
register() returned function without throwing
```

…and yet, in the same run: `boardTitleRendered: true`, `statusLineRendered: true`,
**`canaryRowRendered: false`**, `ourRowRendered: false`.

So two independent plugins reach the service and call `register()` without a throw, the event is provably
present, the rest of the plugin surface renders — and no transcript row appears. Combined with the
installed runtime's own asymmetry (`channel.js:189` gives `tuiSettingsSections` a local fallback for
issue #557 while `:195` captures `tuiRenderers` once with none), the surface is **host-side**, and our
plugin is **not** the defaulter. I could not produce a row, so this does **not** flip back to us.

Honest limit: the host is read-only and exposes no registration read-back, so whether the captured runtime
is `undefined` at channel construction (H1) or the host never projects plugin registrations (H2) is
**UNVERIFIED** — both readings are host-side, and both are consistent with every observable above.
Relatedly, `register()` returning a function proves nothing by design (a refusal also returns a no-op
disposer) — the same T10-F1 lesson; our `src/renderers.ts` correctly reports `requested`, never `confirmed`.

## Supplementary arm (after t8 completed): resume/replay

The captain's suggested next step — exercise the **replay** projection on a session that *already* carries
the event, instead of appending it during a live boot — was run afterwards and is recorded here because
t8's task record is already terminal.

- Method: `raw/canary/replay-drive.mjs` + a PATH shim (`raw/canary/bin/dsh-tui`) that execs the real
  `dsh-tui --resume b003aeb8-495c-4ca0-9917-474626b9eef6` (a session from MY panels run that carries
  `mpd-tui/board-opened`), reusing the lane's own env + capture discipline.
- The resume **really happened**: no new session directory was created, and `b003aeb8`'s store was
  written at the replay run's time (14:42:52) — so this is not a silent "new session" fallback.
- Result (`raw/canary/replay.result.json`): chat screen reached, status line rendered,
  **`ourRowRendered: false`**, `canaryRowRendered: false`. Consistent with the live-append arm and the
  canary arm.
- Caveat, stated so the arm is not over-read: the resumed session carried no *other* projectable
  transcript content (its durable content is command records + the log-only event), so this arm has **no
  positive control** — it cannot show that a built-in row would have replayed. It therefore does not
  independently strengthen the host-side reading; it is one more observation that does **not** flip the
  finding back to this repo.

## Findings

| Id | Sev | Owner | Finding |
|---|---|---|---|
| T8-F1 | high | t7 | `tui-mount --sandbox-root <fresh> --install` — the lane's own advertised remedy — **exits 0 having installed nothing**: `gateTuiPrereqs` (`lib/tui-lane.mjs:370-377`, `process.exit(0)`) runs at `tui-mount.mjs:124` *before* the `--install` block at `:126`. A reviewer satisfying F9 gets a silent green with no evidence; this task had to install the profile itself. |
| T8-F2 | medium | host-side, disclosure t23/t5 | Renderer row not projected; reproduced and attributed (above). Surface stays NOT CLAIMED. |
| T8-F3 | low | nobody this wave | The host effect ledger carries **only** `command` records (36, all `pluginId: undeclared`), so it cannot witness seam registrations — do not cite it as one (false negative). |
| T8-F4 | info | captain (handled) | t23's prose said 98788 bytes; artifact and evidence both say 98883. Digest is authoritative. |

## Not verified (stated, with consequence)

- The host-internal cause (H1 vs H2) — read-only host, no read-back.
- A real **web-profile boot**: only a composition proxy (`verify-rows-parity` → 24 row ids, exit 0;
  `dump-config` → one `mpd-tui`, zero duplicate-entry-id markers). Per AGENTS §4 that is COMPOSITION ONLY.
- The admission lane was not re-run by me (scope was mount + panels), so t5-AC1 rests on t7's artifact.
- The 25-package ledger was structure-checked (25/25 rows carry `observations[]`) but its classifications
  were not re-derived from live runs.
