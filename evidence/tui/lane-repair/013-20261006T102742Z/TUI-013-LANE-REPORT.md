# DSH-TUI 0.13.0 QA lanes — lane E (real-PTY verification) report

Wave: `dsh-tui-013-adaptation`, plan item 5.
Write scope of this lane: `skills/dsh-qa/scripts/**`, `evidence/tui/**` (nothing under `packages/**`,
`cordis.patch.yml` or any `dist/**` was touched).
Sandbox fixture of record: `.mpd/recon/tui-013` (built by the captain, reused unchanged).
Host of record: `@deepseek-harness-tui/dsh-tui@0.13.0`, read from the LAUNCHED profile payload
(`.mpd/recon/tui-013/dshhome/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`).

---

## 1. The commands, and what each one observed

All three were run from the repo root, on the frozen revision of this lane's scripts.

| # | Command | Exit | Observed result line | Lane evidence dir |
|---|---|---|---|---|
| 1 | `DSH_TUI_NO_LAUNCHPAD=1 bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root .mpd/recon/tui-013` | **0** | `[tui-mount] statusLine=true counters=true crashes=[]` … `[tui-mount] preset=mpd session=1653b690-… isolationOffenders=0` … `[tui-mount] PASS: third layer mounted, 12 session record(s) decoded, zero apply-crash signatures` | `evidence/tui/lanes/2026-10-06T10-27-42.389Z/` |
| 2 | `DSH_TUI_NO_LAUNCHPAD=1 bun skills/dsh-qa/scripts/tui-panels.ts --sandbox-root .mpd/recon/tui-013` | **1** | `[tui-panels] surfaces: tuiStatus=rendered tuiCommandTrees=rendered commands=rendered tuiPanels=rendered tuiScenes=rendered tuiRenderers=MISSING tuiSettingsSections=rendered tuiDialogs=rendered` … `[tui-panels] panel registration id=act1:team ok=true` … `[tui-panels] negative control ok=false (must be false)` | `evidence/tui/lanes/2026-10-06T10-27-53.571Z/` |
| 3 | `DSH_TUI_NO_LAUNCHPAD=1 bun skills/dsh-qa/scripts/tui-deps-ctrla.ts --sandbox-root .mpd/recon/tui-013` | **0** | `[tui-deps-ctrla] panel seam: host 0.13.0 declares the dsh-tui-panels row and ships lib/types/dsh-adapter/panels.js — the panel seam is PRESENT, so the Ctrl+A contact must stay inert` … `[tui-deps-ctrla] store arm: ok=true id=act1:team` … `[tui-deps-ctrla] PASS: the host's Ctrl+A stayed INERT (its own dashboard opened) and /mpd panel proved the sidebar registration + accepted open` | `evidence/tui/lanes/2026-10-06T10-28-57.807Z/` |

Raw stdout+stderr of each invocation is kept verbatim under `raw/{tui-mount,tui-panels,tui-deps-ctrla}.log`
beside this file; `raw/commands.txt` records the exact command lines and exit statuses.

Offline arms (`--self-test`) for all three scripts are green on the same revision:

```
[tui-mount self-test] ok: layering, crash-scan, boot-face and isolation predicates are two-sided
[tui-panels self-test] ok: 8 surfaces asserted, negative controls fail as required
[tui-deps-ctrla self-test] ok: 4 legacy + 3 seam-present arms asserted; the arrow, the takeover, the flip, the store pair and the contact controls all fail as required
```

Each real run also carries its OWN negative control, recorded in the run:
`tui-panels` → `<dir>/negative/control.json` (`control.ok=false`, required);
`tui-deps-ctrla` → `<dir>/negative/control.json` (`writeControl` returns red as required);
`tui-mount` → the offline arm's two-sided predicates plus the in-run isolation delta
(`isolationOffenders=0`).

---

## 2. What was changed in the lane scripts, and the measured cause each change answers

### 2.1 `skills/dsh-qa/scripts/lib/tui-lane.ts`

| Change | Cause it answers |
|---|---|
| `discoverSessionStore(dir)` (new) replaces the hard-coded `session.v3.jsonl.zstd` in `readUserMessages`, `countSessionEvents` and `readCommandRecords` (and is reused by `readSessionHeaders`, which already discovered the version) | **THE single mechanical cause of two of the five stale findings.** The harness on this host writes `session.v4.jsonl.zstd`; three readers pinned `v3` and therefore reported "no records at all". BEFORE, read from this lane's own pre-fix result (`evidence/tui/lanes/2026-10-06T10-07-14.251Z/result.json`): `commandRecords = {"dones": [], "runs": []}`, `rendererCrossCheck.eventsInSandboxStore = 0`, `noModelEcho.checked = 0` (a VACUOUS pass over an empty read). AFTER, from the final run's result: `runs = [{commandId:"cmd-…",name:"mpd",args:" workmates"} …]`, `dones = [{commandId,kind:"success",text:"mpd workmates（1）：qa-tui-probe"} …]`, `eventsInSandboxStore = 4`, `noModelEcho.checked = 0 offenders = 0` over the one session THIS run created. (An intermediate probe that used a RELATIVE sandbox root read 0 records; that is a probe artifact — `sandboxProjectKey` is built from the RESOLVED workspace path — and it is not cited as a before/after reading.) |
| `CommandRunRecord.commandId` is now projected | The two halves of a command can be CORRELATED (`command/run` ↔ `command/done`), which is what the new structural store proof asserts. |
| `sandboxEnv` sets `DSH_TUI_NO_LAUNCHPAD=1` by default and `runTuiSession` forwards it through its explicit `env -i` list | The 0.13.0 LAUNCHPAD gate. An unread env key is inert on a pre-0.13.0 host, so this is safe on both. The value the boot carries is recorded in each result (`launchpadGate` in `tui-mount`). |
| `provisionTuiHome(root)` (new) | The lane's own FIXTURE step: `<sandbox HOME>/.dsh-tui/onboarding.json = {"completed":true,"version":1}` (first-run wizard) and `agent-preset.json = {"preset":"mpd"}` (the sanctioned preference channel; without it the session runs the host default `standard` and no MPD surface mounts). A fresh sandbox now needs no hand-holding. |
| `hostPanelSeam(profileDir)` (new) | The VERSION BRANCH. Two independent readings from the LAUNCHED payload: the host's own bundle patch declares the `dsh-tui-panels` row AND `lib/types/dsh-adapter/panels.js` exists. One reading alone is not enough (a leftover module with no row is a stale sibling — pinned by a self-test negative control). |
| `TuiSessionOptions.{paneWidth,paneHeight,bootCommand}` (new) | 320-column pane (settings truncation) and the downgraded-fixture launcher (see §4). Defaults preserve the previous behaviour exactly. |
| `sandboxSessionIds(root)` (new) | Lets a lane scope a store read to the sessions IT created, so a warm root cannot redden a run on a neighbour's record nor make a check pass with `checked: 0`. |

### 2.2 `skills/dsh-qa/scripts/tui-mount.ts`

* Status line: the English-only `/mpd:\s+team /` became `STATUS_LINE = /mpd:\s+(?:team|团队)/`, matched against
  the plugin's OWN dictionary — `packages/mpd-tui-plugin/src/i18n.ts` keys `status.teamRow`
  (`团队 {name} …` / `team {name} …`) and `status.teamNone` (`团队 -` / `team -`), composed by
  `statusLine()` in `packages/mpd-tui-plugin/src/state.ts` as `` `mpd: ${parts.join(" · ")}` ``.
  Counters accept `Tools|工具` and `Skills|技能` (unchanged behaviour, factored into `COUNTERS`).
  Self-test now carries a zh arm that must PASS and a zh pane without the keyed line that must FAIL.
* The fixture step and the launchpad key are recorded in the result (`homeFixture`, `launchpadGate`).

**Observed effect**: `statusLine=true` where the previous run on this same fixture measured
`rendered: false, missingPatterns: ["/mpd:\\s+team /"]` against a pane that carried
`mpd: 团队 Fixture Team 2·1/2 · 计划 0 · workmate 1`.

### 2.3 `skills/dsh-qa/scripts/tui-panels.ts`

* `tuiStatus` uses the same localized `STATUS_LINE`.
* **The stray-slash defect (a real lane defect, found by this run).** The `tuiCommandTrees` step typed
  `/mpd ` and then five `BSpace`; the completion popup consumes the first one, so a `/` survived and the
  next step produced `//mpd workmates`. The harness adjudicated that as CHAT TEXT: the store of the
  2026-10-06T10-07 run carries `user/message "//mpd workmates"` plus the MODEL's own
  `Mpd_workmate_list` tool call, and NO `command/run` for workmates. That poisoned the whole run (the
  polluted transcript pushed the projected board row out of view, and `tuiDialogs` passed on the
  MODEL's prose — a false green). Fixed: the post keys are now `["Escape", 12×BSpace]` (over-erase).
  **The lane's `findModelEcho` check, which read 0 records and therefore passed vacuously on 2026-10-06T10-07,
  now reads the real session and reports `checked=0 offenders=0` on a run where every slash line was
  adjudicated as a command.**
* `commands`: the ASCII-only `/mpd workmates \(/` became `/mpd workmates[（(]/` (the Chinese rendering
  uses the FULL-WIDTH parenthesis), and the row now ALSO requires a structural proof:
  `command/run {name:"mpd", args:/workmates/}` plus the `command/done` correlated by `commandId` with
  `kind === "success"`. A done record with no run, a run with no done, or a non-success kind each redden
  the row by name (`missingProof`).
* `tuiSettingsSections`: **the pane was WIDENED to 320 columns** and all four frozen clauses stay
  asserted VERBATIM. Widening was chosen over weakening the expectation: a truncation-tolerant
  "prefix + marker" form would let a regression that dropped the `never lost` clause through, whereas
  the widened pane proves the clause is painted. Measured (`.qa-tui-probe/width-out/`, pre-fix probe):
  at 220 columns the hint line is cut with `…` before the border; at 320 columns the SAME boot paints a
  315-character line ending `… the value is never lost… ─╮`.
* NEW surface `tuiPanels` (store-backed, 8th row), step `/mpd panel`, pattern `PANEL_OPENED`
  (`packages/mpd-tui-plugin/src/i18n.ts` key `panel.opened`), structural proof
  `command/run {name:"mpd", args:/panel/}` + `command/done kind=success`. The row is placed with the
  other plain-chat command steps, BEFORE `/settings` and the managed dialog: with it last, the host
  had already handed the keyboard to the dialog and the run recorded no `panel` invocation at all
  (measured 2026-10-06T10-18-52 — the intermediate run in `evidence/tui/lanes/`).
* `findModelEcho` takes a session scope, so a warm root's neighbour cannot redden the run.
* The renderer cross-check reports a THREE-WAY, falsifiable interpretation (`appended and projected` /
  `appended but NOT projected` / `never appended`) read from the raw observations.

### 2.4 `skills/dsh-qa/scripts/tui-deps-ctrla.ts`

* `armsFor(seamPresent)` — the version-conditional expectation.
  * **Seam PRESENT (0.13.0)**: both Ctrl+A arms must capture the HOST's own dashboard
    (`子代理面板|Subagent Dashboard`) and must NOT capture MPD's merged panel. `alt+a` is no longer
    driven (it routes to the same invisible sidebar); `/mpd panel` is driven instead and judged by a
    NEW store arm (`evaluateStoreArms` — pure, self-tested).
  * **Seam ABSENT (pre-0.13.0)**: the four legacy arms stand unchanged (baseline scene with the drawn
    arrow, the takeover, the host arm, the settings arm) — `LEGACY_ARMS`.
* The contact-root assertion is unchanged and still required (`hostContactVerdict` against the launched
  profile copy). Observed: `bound to the launched profile copy: …/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui`.
* Offline arms added: the FLIP's own negative control (an armed contact on a seam host must redden, and
  it must redden on the forbidden panel title), a Ctrl+A that opened nothing, the store pair's four
  mutants (no run / no done / error kind / refused open) plus the no-seam sentence, and the version
  probe's stale-sibling control.

---

## 3. The new R2/R3 panel assertion — what is PROVEN and what is BOUND

**Proven (store-backed, falsifiable).** `[tui-deps-ctrla] store arm: ok=true id=act1:team` and
`[tui-panels] panel registration id=act1:team ok=true`, from the harness's own records of
`/mpd panel`:

```
command/run  {"commandId":"cmd-…-2","name":"mpd","args":" panel"}
command/done {"commandId":"cmd-…-2","kind":"success",
              "text":"mpd 侧栏面板：已打开（act1:team）"}
```

That sentence is printed ONLY for the `opened` outcome (`panelStatusLine()` in
`packages/mpd-tui-plugin/src/panel.ts`, strings `panel.opened` / `panel.fallback` /
`panel.unavailable` in `i18n.ts`), which requires all three of: the seam BOUND, the host's own
`list()` read-back produced an id, and `open(id)` returned `true`. The two other outcomes have their
own sentences and are asserted as FORBIDDEN by the same arm, so a refusal or a no-seam host cannot
satisfy it. `open()` returning `false` (the 5000 ms rate limit, or no live panel consumer) is
therefore not read as a registration failure — it reddens as `panel.fallback`, and the arm's label
says so.

**BOUND — the panel BODY is not observable in a pane capture on this host.** MEASURED: after
`/mpd panel` reported a host-ACCEPTED open, the 320×50 capture was **byte-identical** to the capture
taken immediately before it (both 3413 characters; equal after trailing-whitespace normalisation —
`.qa-tui-probe/panel-out/{panel-cmd,alt-a}.pane.txt`). `alt+a` changed nothing at all, and
`/mpd subagents` routes through the same `openMergedPanel()` so it opens the same invisible sidebar.
The chat screen's visible area on this host is the splash art plus the prompt, with an empty transcript
region. **Consequence for the wave: on 0.13.0 there is NO pane-capturable MPD dependency view, so the
`ARROW_CELL`/`DAG_HEADER` pane arms are asserted only on a host WITHOUT the seam, and no claim is made
that the panel bar or the panel body renders.** The merge itself (R3) is therefore proven at the
registration + accepted-open level and by `packages/mpd-tui-plugin/test/subagent-scene.test.ts` /
`graph.test.ts` (both green), never by a PTY capture. This is recorded in every run as
`panelBodyBound`.

---

## 4. The 0.12.0 regression arm (frozen R5) — the fixture does NOT come up, and why

Three focused attempts against the existing `.mpd/recon/tui-012` fixture, raw logs kept verbatim under
`raw/tui-012/`.

| # | Boot | Observable failure |
|---|---|---|
| 1 | the installed launcher (`dsh-tui` from PATH, 0.13.0) with `DSH_HOME=.mpd/recon/tui-012/dshhome` | `[dsh-tui] cannot start: the profile runs v0.12.0 but this launcher is v0.13.0.` / `dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.13.0` — exit 1, pane never paints (2883-byte `attempt1-installed-launcher-refusal.log`). The launcher is a DELEGATING launcher with a version gate; `--version` resolves the sandbox profile happily, the BOOT refuses. |
| 2 | the old host's OWN `bin/dsh-tui.js` from the swapped-in 0.12.0 payload (`raw/tui-012/attempt2-…`) | The gate passes, but the loader never reaches a chat screen: `dsh: warning: 2 entries did not activate` / `dsh-tui-panels (@deepseek-harness-tui/dsh-tui/panels): failed to import` / `dsh-tui (@deepseek-harness-tui/dsh-tui): pending (waiting for service: tuiPanels)`. The host's own main row waits forever for a service the 0.12.0 payload cannot provide. |
| 3 | same, with the profile manifest's declared dependency changed `0.13.0` → `0.12.0` | Byte-identical failure to attempt 2 (`raw/tui-012/attempt3-…`). The manifest was restored afterwards; the declared version is `0.13.0` again. |

**Diagnosis (measured, not inferred):** no file under the `.mpd/recon/tui-012` profile declares the
`dsh-tui-panels` row (`grep -rln dsh-tui-panels` over the whole profile tree returns nothing), the
shipped 0.12.0 `package.json` has no `./panels` export, and `dsh --profile dsh-tui --dump-config`
against that `DSH_HOME` composes no such row — yet the 0.13.0-only row is the one that fails to import
while module resolution points at the 0.12.0 payload. The fixture is therefore a **mixed-version
composition**, not a clean 0.12.0 host, and the failure is in the host launcher/loader path, not in
this bundle. Making it boot honestly needs a clean 0.12.0 profile (its own `cordis.patch.yml`, its own
`node_modules` closure, no 0.13.0 remnants) — `dsh plugin --profile dsh-tui add
@deepseek-harness-tui/dsh-tui@0.12.0` is the honest way to build one, and that command fails here on
the read-only pnpm store lock the captain already recorded.

**BOUND, stated plainly: there is NO PTY proof of the old-host arming path.** That path rests on the
unit-level gate tests, run on this revision:

* `bun test ./packages/mpd-tui-plugin/test/panel.test.ts` → **16 pass / 0 fail**, including
  `the legacy Ctrl+A arming rule (frozen R4/R5) > the SEAM WINS: a bound panel seam forbids interception
  whatever the config layers say`, `… > without the seam the SAVED knob outranks the row config's floor`,
  `… > without the seam and without a saved value the row config decides`.
* `bun test ./packages/mpd-tui-plugin/test/dashboard-key.test.ts` → **11 pass / 0 fail** (the Ctrl+A
  decision arms: consumed with a team, pass-through otherwise).
* `bun test ./packages/mpd-tui-adapter-plugin/test/adapter-hosts.test.ts` → **30 pass / 0 fail**
  (seam binding shapes, queued registration drained at the bind, absent-seam degradation).
* **Not runnable here:** `bun test ./packages/mpd-tui-plugin/test/plugin.test.ts` fails to even LOAD
  with `TypeError: require() async module ".../packages/mpd-agent-teams-plugin/_deps/cosmokit/lib/index.ts"
  is unsupported` (0 pass / 1 fail / 1 error). This is a pre-existing module-resolution error in the
  retired adopted plugin's vendored `_deps`, unrelated to this lane (no file under `packages/**` was
  touched), so the legacy-host arm inside `plugin.test.ts` is NOT claimed as evidence.
* Every other file of the `mpd-tui-plugin` suite is green: `dashboard-key 11/0`, `graph 25/0`,
  `model-menu 25/0`, `panel 16/0`, `plan-actions-live-agent 7/0`, `state 16/0`, `subagent-scene 23/0`,
  `team-record-source 7/0`, `team-surface 33/0`, `two-plugin-ownership 4/0`, `watchdog-frontdoor 10/0`;
  `mpd-tui-adapter-plugin`: `adapter-hosts 30/0`, `no-direct-tui-access 2/0`.

---

## 5. Findings for the captain (SOURCE-level; NOT fixed here, by instruction)

### F1 — CORRECTION to measured fact #5: `command/done.data.text` IS recorded on 0.13.0

The captain's item 5 generalised from `/mpd board`, whose completion is a bare
`{"commandId":"cmd-…","kind":"success"}`. That is true for a SCENE-OPENING action, which returns
`{kind:"success"}` with no text. A command that RETURNS text does record it. Measured on this harness:

```
/mpd workmates → command/done {"kind":"success","text":"mpd workmates（1）：qa-tui-probe"}
/mpd panel     → command/done {"kind":"success","text":"mpd 侧栏面板：已打开（act1:team）"}
/mpd board     → command/done {"kind":"success"}                      // no text, by design
```

The real cause of the lane's `commands=MISSING` was therefore TWO bugs, both now fixed: the
`session.v3` filename (no records read at all) and the stray `/` (the command never ran). The new
store assertion keeps the text pattern AND adds the structural run+done pair, so it is robust either
way and never vacuous.

### F2 — `tuiRenderers`: the append works, the projection does not (pre-existing, cause already recorded)

`[tui-panels] board-opened events in the sandbox store=4 scene-reported transcript rows=0`, and the
captured transcript is empty. **This is not a 0.13.0 regression and not a lane bug.** The repository
already records the cause in `evidence/tui/live/20260915T063140Z/CORRECTION-renderer-causation.md`:
the host's renderer seam denies a transcript row for any session-event type that entered
`KNOWN_SESSION_EVENT_TYPES` BEFORE the host captures that set when it evaluates `renderers.js`; a
BUNDLE-shipped plugin adds its type during apply (iron rule 2, so the session stays resumable), so
**iron rule 2 and a rendered row are mutually exclusive for a bundle row by construction**, and the
same measurement is listed as `tuiRenderers NOT-CLAIMED` in `evidence/tui/EVIDENCE-INDEX.md`. The lane
KEEPS the surface required and therefore exits 1 on it: weakening a required surface to make a lane
green is exactly the vacuous pass the discipline forbids. If the captain prefers the delivery-time
form, the one-line change is to declare this single row NOT-CLAIMED (excluded from the verdict, still
recorded with its cross-check) — that is a captain decision, not a lane one.

### F3 — the panel seam is proven at registration/open level only (see §3)

`ctx.tuiPanels` on 0.13.0 gives no pane-visible body, and `panel.open()` is rate-limited to one per
plugin per 5000 ms, so a lane that pressed `/mpd panel` twice in one boot would read the second press
as `panel.fallback`. The lanes press it once per boot.

---

## 6. Bound ledger (every limit of this lane's evidence)

| Bound | What it means |
|---|---|
| No PTY proof of the pre-0.13.0 arming path | `.mpd/recon/tui-012` is a mixed-version composition that never reaches a chat screen (§4). The R5 leg rests on the unit gate tests. |
| Panel body not pane-capturable on 0.13.0 | Registration + accepted open are proven; the panel bar/body are NOT claimed (§3). |
| `tuiRenderers` unresolved | Required and RED, cause recorded pre-existing (§5 F2). |
| `plugin.test.ts` not runnable | Pre-existing `cosmokit` `_deps` module-resolution error; not this lane's, and its legacy-host arm is not claimed. |
| Warm shared fixture | Both store-backed lanes scope their reads to the sessions THIS run created (`sandboxSessionIds` delta); the runs above show one new session each and `isolationOffenders=0` in `tui-mount`. |
| `evidence/tui/lanes/` is append-only | Every run above wrote a NEW timestamped directory; no historical artifact was rewritten. |

---

## 7. Regression checks and the corpus consequence

### 7.1 Every lane that shares `lib/tui-lane.ts` re-ran green

`tui-mount`, `tui-panels`, `tui-deps-ctrla`, `tui-admission`, `tui-distribution`,
`tui-spec-conformance`, `tui-settings-bridge`, `tui-team-surface` — each `--self-test` exits 0 on the
edited shared library. `ulw-command.ts` also reads session command records but declares its OWN record
types, so the added `CommandRunRecord.commandId` field cannot couple to it (verified by reading the
file and running its self-test, green).

### 7.2 `bun run test:qa` — 4 of 48 cases fail, NONE of them this lane's

```
[test:qa] FAILED: agent-teams-messaging.ts (exit 1)
[test:qa] FAILED: bundle-lifecycle.ts (exit 1)
[test:qa] FAILED: extension-lifecycle.ts (exit 1)
[test:qa] FAILED: preset-register.ts (exit 1)
[test:qa] FAIL - 4 of 48 case(s) failed
```

* **`agent-teams-messaging` — EXPECTED, and it is the wave's corpus consequence:**
  `VENDOR_LOCK skills asset is stale: lock=334/ed49ac826932 tree=334/5e5490dccc3b (re-pin in the same
  commit, AGENTS.md §9)`. ANY `skills/**` change invalidates the corpus `treeSha`, and this wave has
  several writers under `skills/` (`tui-admission.ts`, `tui-team-surface.ts`, `install-dependencies.ts`
  are dirty in the shared tree from other seats, beside this lane's four files). The fingerprint above
  is what the gate printed on the CURRENT tree and MUST be re-measured at the wave's single re-pin,
  because it moves with every remaining `skills/**` edit. §9's single-writer rule applies: one re-pin,
  in the same commit as the last `skills/**` change. (Note: `node scripts/verify-vendor.ts` cannot run
  on this machine at all — `upstream checkout not found at /home/haroldzhao` — so the corpus number
  above is the one `agent-teams-messaging` derives locally.)
* **`bundle-lifecycle`** (`self-test: the agent-preset-registry id-target (default: mpd) is missing from
  the bundle patch`), **`extension-lifecycle`** (`an unavailable seam must be reported LOUDLY on
  stdout`), **`preset-register`** (`devFlavor MCP operand is not the checkout-absolute
  mpd-mcp-gitbash/dist/cli.js`) — independent of this lane: measured, none of the four failing scripts
  references the TUI lanes at all (`grep -c "tui-lane\|tui-mount\|tui-panels\|tui-deps-ctrla"` returns
  0 for each), each reports its own domain assertion rather than a module-load error, and the shared
  tree carries other seats' edits under `packages/**`, `cordis.patch.yml` and `docs/**` that are the
  plausible cause. They are reported here so the captain's final sweep does not read them as this
  lane's regressions.

### 7.3 Scope check (`git status --porcelain`)

This lane wrote ONLY: `skills/dsh-qa/scripts/{lib/tui-lane.ts,tui-mount.ts,tui-panels.ts,tui-deps-ctrla.ts}`
and `evidence/tui/**`. Nothing under `packages/**`, `cordis.patch.yml`, `presets/**` or any `dist/**`
was touched — every `packages/**` path that is dirty in the shared tree belongs to another seat.
`.qa-tui-probe/` (the measurement scratch root) was removed; the `.mpd/recon/**` fixtures are gitignored.
