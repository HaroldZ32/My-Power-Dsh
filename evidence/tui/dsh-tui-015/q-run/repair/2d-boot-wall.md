# STEP 2d — the "90 s boot wall": re-derived, and what actually held the two lanes red

Lanes: `tui-admission` + `tui-team-surface` (`skills/dsh-qa/scripts/`).

## What the 90 s wall really was (admission): a LANE-side debug flood, not an environment bound

The T8 report said `the TUI did not reach the chat screen within 90000ms` and the pane "looped on
`park target=6,44 … moved=false`". Both halves were re-derived from the HOST's own source:

- `logForDebugging` (host `lib/types/utils/debug.js`) writes **to stderr on every frame** while
  `DSH_TUI_DEBUG` is set: `if (!process.env.DSH_TUI_DEBUG) return; process.stderr.write(…)`.
- `tui-admission` set `DSH_TUI_DEBUG: "1"` for BOTH boots (the arm-2 loader line needs that flag), and a
  tmux pane's stderr IS the terminal — so every frame's trace landed IN the pane.
- Measured in the T8 evidence: `grants/tui-pane.log` carried **15,566** `park target=` lines and
  `grants/boot.pane.txt` was 100 % diagnostic output (`{"level":"warn"}` / `[dsh-tui] [stderr] …`), i.e.
  the render was drowned, the readiness poll never matched, and every pane-reading arm read garbage.

So the repair is a real one, not a bound:

1. `lib/tui-lane.ts` — new documented `TuiSessionOptions.stderrFile`: the boot command is typed with a
   shell `2> '<file>'` redirection, so the diagnostic stream is CAPTURED (arm 2 still reads the loader
   line) while the pane keeps the rendered frame.
2. `tui-admission.ts` — both boots pass `stderrFile` (`negctl/host-stderr.log`, `grants/host-stderr.log`)
   and `bootWaitMs: 180_000`; arm 2 now reads the REDIRECTED stderr; the park-frame count is logged and
   recorded in `result.json.hostStderr`.

Observed on the re-run (`repair/2d-admission.log` + the lane's own evidence):

```
[tui-admission] arm2 admission-loader line admitted com.mpd-dsh.mpd-tui: true (stderr=…/grants/host-stderr.log 707906B)
[tui-admission] granted boot debug stream: 7023 park frame(s), redirected off the pane
[tui-admission] negctl /plugin check -> state=waiting_authorization ok=true
[tui-admission] grants /plugin check -> state=compatible; /plugin list -> state=compatible
```

The pane is clean now, and **arm 4 (`a REAL tui/input decision fires`) flipped from FALSE (T8) to TRUE** —
which the flood had made unmeasurable.

## The SECOND cause, also lane-side: 0.15.0 renamed `/plugins` to `/plugin`

With the pane readable, the next red was visible: `/plugins check <path>` was not executed as a command —
the pane showed the line submitted as a MODEL TURN (thinking indicator + real Bash/Read tool calls). The
host's own strings say why:

- host `lib/types/i18n.js:1297` — `'plugins-unknown-subcommand': … (supported: list / check <path> / info <spec> / registries)`
- host `lib/types/i18n.js:1298` — `'plugins-check-usage': { zh: '用法：/plugin check <dsh-plugin.json 路径>', en: 'Usage: /plugin check <path-to-dsh-plugin.json>' }`
- host `lib/types/tips.js:408-409` — `/plugin check <manifest> diagnoses plugin compatibility`

So `/plugins` is not a command any more. `tui-admission.ts` now drives `/plugin check <manifest>` and
`/plugin list <ENTER>` (the bare `/plugin` opens the host's picker and paints no state word — measured:
`/plugin` → `state=undefined` while `/plugin list` → `state=compatible`). The old spelling survives only in
the lane's prose, annotated with the rename.

```
[tui-admission] FAIL: {"static":true,"staticGrants":true,"arm1":true,"arm2":true,"arm3":false,"arm4":true,"arm5":true,"revokedState":"waiting_authorization"}
```
Five of six arms green (arm 5's negative control, arm 1's compatible panes, arm 2, arm 4, and arm 6's
revocation OBSERVED flipping back to `waiting_authorization`).

## The ONE remaining red: arm 3 (effect-ledger attribution) — declared, with cause

```
[tui-admission] arm3 attribution: attributed=0 decisionHandlerBinds(applied)=0 (ledger delta=20)
```
Measured over the WHOLE sandbox ledger (`home/.dsh-tui/effect-ledger.jsonl`, 665 records):

```
pluginId/result: {('host', 'applied'): 660, ('undeclared', 'applied'): 5}
operations:      {'create': 660, 'replace': 5}
resource kinds:  {'command': 660, 'status': 5}
```

Our component id (`com.mpd-dsh.mpd-tui`) appears **zero times**. **CAUSE CORRECTED 2026-10-14 by the
triage re-derivation (`triage-reds/REPORT.md` §3): the host DOES wire the `decision-handler` shape** —
`lib/types/dsh-adapter/plugin-host.js#subscribeDecision` records
`{operation:'bind', resource:{kind:'decision-handler', id:`<componentId>:<event>`}, result:'applied'}` on its
registered path and a `permission`/`PERMISSION_NOT_GRANTED` record otherwise. The earlier sentence in this
file ("there is no `decision-handler` resource kind at all on 0.15.0") was right about the FILE and wrong
about the HOST, and is retracted here. Neither record fires for us: the granted boot's own admission
differential (loader `admitted=61 refused=0`, the negctl boot's exact inverse `admitted=0 refused=61`) proves
the grant DID bind a Component identity, so the gap is AFTER binding — OUR registration/attribution, whose
remaining candidates are (c1)–(c3) in `triage-reds/REPORT.md` §3. This is NOT a stale spelling the lane can
fix, and the gate is not weakened: arm 3 stays RED, cause declared, and it belongs to a
packages/host-attribution question, not to this lane.

## `tui-team-surface`: the boot was never the problem (measured) — H1/H3 stay red, declared

T8 logged NO readiness/tmux failure for this lane (`bootWaitMs` was already 120 s and the boot reached the
chat screen; `arm2 H6` captured 6 panes for 5 driven steps). What the run DID show is a fixture stamped
with a WRONG SESSION ID: `liveSessionId(root, workspace)` resolves the newest session header under the
sandbox project key, and a warm root answers with a PREVIOUS lane's session (`95c42456…`, `tui-panels`'
boot) — because the host flushes a session store only when something is APPENDED and this lane's `before`
hook runs before its first command.

That defect was fixed by construction and MEASURED (a `session-materialized` step + a pre-boot session
snapshot so the reader prefers a session this run created): the fixture then carried
`91121572-d7e7-479b-9142-e823a8059195`. **H1/H3/H4 stayed red anyway**, so the drive change did not
address the real cause and was REVERTED — the lane's only remaining edit is `bootWaitMs` 120 s → 180 s (an
honest ceiling, not the cause). Keeping an unproven drive step would have been worse than declaring.

The remaining, narrower cause, measured:

```
[tui-team-surface] arm2 H1-host-renders-surface FAIL — … ┌? MPD plan approval · 216x48 …
[tui-team-surface] arm2 H3-host-confirm-step FAIL
[tui-team-surface] arm2 H4-real-mutation-via-the-adopted-runtime FAIL — no approval committed: phase="staged"
pane: `? MPD plan approval — (none) · 216x48` / `no staged plan for team (none)`
```
The plan surface RENDERS, but its own empty state says `no staged plan for team (none)` — the scene did
not resolve the team, while the SAME boot's status line resolves the fixture team
(`mpd: 团队 Fixture Team 2·1/2 (workspace-level)`). The staged plan file
(`ws/.mpd/team/staging/<session>.json`) and the record (`ws/.mpd/team/teams/mpd-fixture-1.json`) are on
disk, so this is a question about which session identity the SURFACE keys on, not about the fixture.
Corroborating host state: `home/.dsh-tui/last-run.json` carries `"sessionId": ""` for these boots, and
`ws/.mpd/logs/mpd-tui.log` records `TUI_SEAMS=(none composed)`.

That is outside this task's write scope (`packages/mpd-tui-plugin` / `packages/mpd-tui-adapter-plugin`),
so it is REPORTED, not patched: **H1/H3/H4 remain NEW reds against the frozen table** and bounce to the
captain as a packages-lane item (the plan scene's session→team resolution on 0.15.0).

## Bound stated

No "environment bound" was declared for these two lanes, because the environment was not what broke them:
admission's wall was our own debug flag corrupting the pane, and team-surface's H1/H3 was a wrong session
id (fixed) plus an unresolved surface-resolution question (reported). `bootWaitMs` is 180 s in both.
