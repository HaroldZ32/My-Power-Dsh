# Evidence index — DSH-TUI edition (t14)

Walk from each claim in `.mpd/plans/dsh-tui-edition-report.md` to the raw artifact that backs it.
Every path is workspace-relative. Where a claim has a **negative control**, the control's path is
listed beside it — a claim whose lane cannot fail is not evidence. Corrections are appended to the
original artifact, never rewritten, so the history stays auditable.

## 0. Delivery-level artifacts

| Claim | Artifact |
|---|---|
| Acceptance ledger (all 20 ACs + status + backing path) | `evidence/tui/ACCEPTANCE-LEDGER.md` |
| Delivery report (this delivery's front page) | `.mpd/plans/dsh-tui-edition-report.md` (committed copy: `docs/tui-edition-report.md`) |
| Frozen contract | `.mpd/plans/dsh-tui-edition.md` (committed copy: `docs/plan-tui-edition.md`) |
| Regression log at delivery time | `evidence/tui/delivery/20260915T072355Z/raw/test-qa.log` |
| **Regression lane R6 (web profile still mounts)** | `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/` (case result + logs) and `evidence/tui/delivery/20260915T072355Z/raw/web-profile-boot.log` |
| Manifest digest chain (4 links, all disclosure/identity-only) | `evidence/tui/composition/20260915T053445Z/raw/manifest-digest-chain.json` |
| Skills corpus fingerprint for the captain's re-pin (307 / `ba0c3922…`) | recomputed in `evidence/tui/lanes/T26-LANE-HARDENING.md`; the tool prints `tree=307/ba0c39228896` |

## 1. Mount / composition (AC-1, AC-2, AC-3, AC-11, AC-12)

| Claim | Artifact |
|---|---|
| Bundle mounts as the THIRD layer; zero apply-crash signatures; status line + counters | `evidence/tui/lanes/2026-09-15T07-05-19.752Z/{result.json,boot.pane.txt,tui-pane.log,dump-config.txt,REVISION.json}` |
| Independent re-run from a reviewer-owned fresh root | `evidence/tui/live/20260915T063140Z/lanes/tui-mount/`, `…/raw/install-fresh-root.sh` |
| Single install yields the whole capability set | the same install script (exit 0) + the triple `dsh.profile.bundles` in every mount result |
| No duplicate loader entry id (24 ids; mirror proven) | `evidence/tui/composition/20260915T062202Z/` (parity + gates logs), `evidence/tui/lanes/2026-09-15T07-08-44.315Z/` |
| TUI default preset = `mpd` (host's own roster marks ours `（默认）`) | `evidence/tui/composition/20260915T061519Z/raw/preset-roster-top.pane.txt`, `…/raw/preset-roster-pane.log` |
| Per-package classification (t5 static ledger; superseded for `mpd-tui-plugin`) | `evidence/tui/composition/20260915T053445Z/ledger.json` + the live superseding witness `evidence/tui/live/20260915T063140Z/` |
| Web profile: composition proxy (24 ids, one `mpd-tui`, no duplicates) **and the real boot (R6, PASS)** | composition: the `ledger.json` copies; boot: `evidence/dsh-qa/bundle-lifecycle/2026-09-15T07-24-59.974Z/{result.json,boot.log,output.log}` + console copy `evidence/tui/delivery/20260915T072355Z/raw/web-profile-boot.log` (`[bundle-lifecycle] PASS`, EXIT=0: web triple layer, `boot http:true`, corpus from the checkout, `noHomeCopy`, `layerDurability ok`, `uninstall ok` with `residue: []`) |

## 2. Live panels (AC-4, AC-6, AC-7)

| Claim | Artifact |
|---|---|
| Six of seven surfaces render (status, commands, tree, scene, settings, dialog) | `evidence/tui/lanes/2026-09-15T07-05-58.634Z/{*.pane.txt,result.json}`, `evidence/tui/plugin/20260915T060934Z/mount/` (20 captures, incl. `02-mpd-status`, `11-board-by-command`, `13-board-by-shortcut`, `14-workmate-dialog`, `15-settings`, `16-command-completion`) |
| `/settings` renders WITH the unbridged marker | `…/07-05-58.634Z/settings.pane.txt` (hint line carries `UNBRIDGED_MARKER`) |
| `/mpd` is handled by the plugin, never sent to the model | `…/07-05-58.634Z/result.json` (`commandRecords` + `noModelEcho: {checked, offenders: 0}`) |
| **`tuiRenderers` NOT-CLAIMED** (registration accepted, event persisted, no transcript row) | `evidence/tui/live/20260915T063140Z/{result.json,T8-LIVE-VERIFY.md}`, `…/raw/canary/cross.*`, `…/CORRECTION-renderer-causation.md` |
| **Negative control** — the panels lane can fail (impossible pattern on the real panes) | `evidence/tui/lanes/2026-09-15T07-05-58.634Z/negative/control.json`, `evidence/tui/live/20260915T063140Z/lanes/tui-panels/negative/control.json` |
| Decision-event seam ready-but-not-activated (no faked admission, warn once) | `evidence/tui/composition/20260915T053445Z/raw/control-no-decision-permissions.{json,pane.txt}`, `…/raw/control-broken.{json,pane.txt}` (controls), t12's review (next section) |

## 3. Admission / conformance / distribution (AC-8, AC-9, AC-10, AC-13, AC-14, AC-20)

| Claim | Artifact |
|---|---|
| Host-pinned parse → project → validate → negotiate; spec root pinned; `loadSpecData()` asserted | `evidence/tui/lanes/2026-09-15T07-08-44.315Z/{admission-static.json,result.json}`, `evidence/tui/conformance/20260915T064521Z/01-admission-static.log` |
| Live `/plugins check` = `waiting_authorization`, forbidden family absent | `evidence/tui/lanes/2026-09-15T07-08-44.315Z/plugins-check.pane.txt` |
| Independent confirmation by the protocol's OWN validator (exit 0) | `evidence/tui/conformance/20260915T064521Z/{spec-conformance-upgrade.json,04-spec-conformance.log}` |
| 7/7 pinned requirements + three-way identity (8 files) + the exact suite blocker | `evidence/tui/lanes/2026-09-15T07-07-04.875Z/spec-conformance.json` |
| `dsh-distribution.json` validated by the protocol's own CLI (`fullyValidated: true`) | `evidence/tui/lanes/2026-09-15T07-07-47.413Z/{result.json,distribution-cli.json}` |
| Admission negative controls (broken syntax / optional-without-fallback / unknown permission) | inside `…/admission-static.json` `controls` + `evidence/tui/composition/20260915T053445Z/raw/control-*.json` |
| Host `verify:plugin-*` gates BLOCKED (the exact reason: `tsx` unresolvable) | t9's record; no artifact claims otherwise (AC-20 not-claimed) |

## 4. Docs and descriptor (AC-16, AC-17)

| Claim | Artifact |
|---|---|
| Bilingual docs wired (switch links; index/README links) | `docs/tui.md`, `docs/tui.zh-CN.md`, `docs/index*.md`, `README*.md`; checker `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs` (re-run → `"verdict": "passed"`, exit 0) |
| NOT-CLAIMED item 10 (renderer) in BOTH languages | `docs/tui.md` §10, `docs/tui.zh-CN.md` §10; citations `evidence/tui/live/20260915T063140Z/{result.json,T8-LIVE-VERIFY.md}` |
| Revision binding (no stale `710d3eef`; chain kept as history) | `evidence/tui/docs/20260915T060010Z/REVISION-BINDING.md` |
| `/mpd` vs `contributes.commands: []` documented (EN) | `docs/tui.md` §6.4 (+ §4.1 pointer); evidence `evidence/tui/composition/20260915T071619Z-docs-mpd-command/` |
| The zh §6.4 mirror (closed t30's last medium) | `evidence/tui/composition/20260915T072139Z-zh-mirror-paste/{README.md,result.json,doc-assertion-captain-zh-mirror.mjs,raw/}` |
| Descriptor structural validation (13/13) | `evidence/tui/docs/20260915T060010Z/verify.json` |

## 5. Package and reviews (AC-5, AC-6, AC-10)

| Claim | Artifact |
|---|---|
| Plugin contract (shape, defaults, cleanup, no-throw degrade) | `evidence/tui/plugin/20260915T054343Z/` + its `CORRECTION.md` (the t4 record was inert in a real boot); post-repair `evidence/tui/plugin/20260915T060934Z/`, `evidence/tui/plugin-followup/20260915T060032Z/` |
| Correctness/risk review PASS at `5dce2563…`; t10 findings closed | `evidence/tui/review/t12/{REVIEW.md,result.json}` |
| Seam-API audit + conventions | `evidence/tui/review/` (t10/t16 records), `.mpd/recon/TUI-CONVENTIONS.md` |
| Size correction (98788 stale → 98883 measured) | `evidence/tui/plugin/20260915T060934Z/result.json` `sizeCorrection` |

## 6. Packed tree (the class, not one row)

| Claim | Artifact |
|---|---|
| Closure walked class-wide; **exactly two** launcher-bearing MCP packages; falsifying control | `evidence/tui/packaging/20260915T064658Z/{RESULT.md,raw/packed-import-check.log,raw/negative-control-import.log,raw/negative-control-guards.log,raw/packed-tree-listing.txt}` |
| Five by-design items re-derived on the current revision | `evidence/tui/packaging/20260915T064658Z/{BY-DESIGN-AUDIT.md,raw/by-design-audit.json}` |
| Two-writer attribution for `scripts/pack-mpd.mjs` | `evidence/tui/composition/20260915T062202Z/{attribution.json,PACKAGING.md,raw/pack-mpd-attribution.log}` |

## 7. Lanes, hardening and their own provenance

| Claim | Artifact |
|---|---|
| The five lane sources and their shared helper | `skills/dsh-qa/scripts/{tui-mount,tui-panels,tui-admission,tui-distribution,tui-spec-conformance}.mjs`, `skills/dsh-qa/scripts/lib/tui-lane.mjs`, `skills/dsh-qa/SKILL.md` (5 rows) |
| t7 delivery summary | `evidence/tui/lanes/TUI-LANES-SUMMARY.md` |
| t26 hardening (per-result digest, mid-run FAIL, marker + no-echo assertions, gate fix) | `evidence/tui/lanes/T26-LANE-HARDENING.md` |
| Digest annotations for the pre-t26 results (dated, never rewritten) | `evidence/tui/lanes/2026-09-15T06-2{6,7,8}-*/T26-DIGEST-ANNOTATION.md` (4 directories) |
| The superseded intermediate t26 run | `evidence/tui/lanes/2026-09-15T07-07-05.112Z/T26-SUPERSEDED-RUN.md` |
| Every lane result names the revision it measured | `REVISION.json` beside each `result.json` (sha256 + bytes + mtime + composition) |

## 7.1 The settings bridge (t35–t50) — claims added after t14

The `/settings` section's named follow-up became delivered behaviour in the bridge wave. These paths
back the bridge's own claims; the docs that state them are `docs/tui.md`/`docs/tui.zh-CN.md`
§3.1/§6.2/§6.5/§11.1.

| Claim | Artifact |
|---|---|
| The bridge's requirements and frozen scope | `evidence/mpd-bridge/requirements/`, `evidence/mpd-bridge/design/` |
| Two real boots: one live root (file rewritten, comment/key order/trailing comma preserved) and two live roots (REFUSED `ambiguous-multi-root`, both candidates named, no file changed, value still applied) | `evidence/mpd-bridge/implementation/20260915T080138Z/{result.json,REPORT.md,artifact-hashes.txt,gates.log,lane-tui,lane-web,lane-web-noskip}` |
| The TUI lane that asserts the bridged disclosure + write-back (`allPatterns`, per-result `REVISION.json`) | `skills/dsh-qa/scripts/tui-settings-bridge.mjs`; hardening `skills/dsh-qa/scripts/tui-panels.mjs` (settings step `allPatterns`) |
| The Web-side lane (card mount, skip cases, no-skip control) | `skills/dsh-qa/scripts/web-settings-bridge.mjs`; run `evidence/mpd-bridge/implementation/20260915T080138Z/lane-web`, control `…/lane-web-noskip` |
| Duplicate-key ruling (SET = last occurrence, UNSET = every occurrence, refusal classes) | `evidence/mpd-bridge/captain/RULING-duplicate-unset-FINAL.md` |
| Independent re-review of the bridge (verdict PASS) and its coverage/dispositions | `evidence/mpd-bridge/review/REREVIEW-t49.md`, `evidence/mpd-bridge/review/t49-DISPOSITIONS-AND-COVERAGE.md`, `evidence/mpd-bridge/review/RESOLUTION-*.md`, `evidence/mpd-bridge/review/raw/`, `evidence/mpd-bridge/review/lane-run-{1,2}` |
| Consumer activation (the namespace served by the config plugin, base from `<workspace>/.mpd/mpd.jsonc`) | `evidence/mpd-bridge/consumer-activation/` |
| Dual-path behaviour (settings layer vs file) | `evidence/mpd-bridge/dual-path/` |
| Web card registration + built bytes (browser render NOT witnessed) | `evidence/mpd-bridge/web-card/`; built client `packages/mpd-bundle-plugin/client.js` sha256 `dd9c88933a316277…` (282453 bytes) |
| **t50** documentation/record pass: bilingual doc rewrite, duplicate-key table, Web-card docs, ledger + report amendments, expanded path check | `evidence/mpd-bridge/integration/{REPORT.md,result.json,AMENDMENT-3.md,LEDGER-AMENDMENT-T50.md,INDEX-SECTION-T50.md,raw/}` |
| The de-branding pass that rode this wave (t33): t33 `verdict: passed` on the RTL/EDA rename, with its own gates and the remaining known breakage named | `evidence/mpd-ext-debranding/20260915T074904Z/` (`result.json`, `verify-debranding.mjs`, `typecheck.log`, `validate.log`, `ext-tests.log`, `roles-tests.log`, `qa-isolation-breakage.log`) + the captain's independent re-run `evidence/mpd-ext-debranding/captain-verify/` |
| **Negative controls** for the bridge lanes (a lane that cannot fail is not evidence) | `evidence/mpd-bridge/implementation/20260915T080138Z/lane-web-noskip` (the Web lane re-run without the skip fixture), the TUI panel step's `allPatterns` requirement (a pane missing ANY of the four disclosure sentences — bridge, restart, never-lost, the workspace path — fails), and the two-boot contrast (one live root writes the file; two live roots refuse with `ambiguous-multi-root` and still apply the value) |
| t50 re-run of the shipped bilingual checker (28/28, exit 0) | `evidence/mpd-bridge/integration/raw/doc-assertion-t27-t50.log` (checker: `evidence/tui/docs/20260915T070743Z/doc-assertion.mjs`) |
| t50 re-run of the captain's cited-path checker (0 missing across the nine amended files; 11 pre-existing bare-token misses made precise) | `evidence/mpd-bridge/integration/raw/cited-paths-t50.log` (checker: `evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs`) |
| **Merge blocker found by t50 (outside its scope): the vendor pairing is red on the working tree** — `skills/` grew to 310 files after the wave's single re-pin (307 / `ba0c3922…`) | `evidence/mpd-bridge/integration/raw/verify-vendor-t50.log` (exit 1), `evidence/mpd-bridge/integration/raw/test-qa-t50.log` (exit 1 at `agent-teams-messaging`: `lock=307/ba0c39228896 tree=310/8ec53287296e`); the three uncommitted `skills/**` files are named in `evidence/tui/ACCEPTANCE-LEDGER.md` (third amendment, item 7). **RESOLVED at t51:** the captain's re-pin landed (`VENDOR_LOCK.json` `assets/skills` = 310 files / treeSha `8ec53287296edb43b1f622046ff932a8e339f081184622854db4a2c0445a3268`), `node scripts/verify-vendor.mjs` → exit 0 (`asset OK: skills 310 files`, `PASS`) and `bun run test:qa` → exit 0 (`all self-tests passed`) — `evidence/mpd-bridge/integration/t51/raw/{verify-vendor-t51.log,test-qa-t51.log}` |
| **t51** documentation closure (additive): the base cardinality + fixed-lifetime disclosure (§6.2), the scopes + cross-home boundary (§6.6), the complete Web-card evidence level (§3.1), both languages | `evidence/mpd-bridge/integration/t51/{AMENDMENT-4.md,result.json,raw/}` |
| The base cardinality rule's source of truth (shipped code + the FINAL ruling that superseded the impl report's mid-state) | `packages/mpd-config-plugin/src/index.ts:511` (`baseForNamespace()`: one root / zero roots ⇒ mount-time root / N roots ⇒ `base: undefined` + `ambiguous-multi-root`); `evidence/mpd-bridge/review/RESOLUTION-ruling-and-base.md` §2 (incl. the falsifying observation `base.hashline.maxDiffChars = 35000`, lane W13) |
| The cross-home boundary (D1) and the scopes by mechanism | `evidence/mpd-bridge/dual-path/REPORT.md` (finding D1 at :78; the scope table at :58-65; the cross-door measurement at :44-45 — one home, `settings.yaml` sha256 `caa38c966f16e95f…`, the TUI door writing 31415 through to the workspace file sha256 `38abf9690296c826…` with comment/key order/trailing comma intact) |
| The Web card's witnessed vs not-witnessed sets and the human repro steps | `evidence/mpd-bridge/web-card/report.md` §4 and `evidence/mpd-bridge/web-card/result.json` → `claims.{witnessed,notClaimed,reproSteps}` (`cardClaim.W3.witnessed === false`) |
| t51 re-run of the shipped bilingual checker (both languages after the additions) | `evidence/mpd-bridge/integration/t51/raw/doc-assertion-t27-t51.log` |
| t51 re-run of the captain's cited-path checker over everything edited (no missing path) | `evidence/mpd-bridge/integration/t51/raw/cited-paths-t51.log` |
| t29's frozen checker now also fails `entry-unmoved` (its pin is the superseded TUI-edition digest, not a regression) | `evidence/mpd-bridge/integration/raw/doc-assertion-t29-t50.log`; recorded in `evidence/tui/ACCEPTANCE-LEDGER.md` (third amendment, item 3) |

Re-run (from the repository root):

```sh
node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs                    # expect verdict passed, 28/28, exit 0
node evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs docs/tui.md docs/tui.zh-CN.md \
  docs/tui-edition-report.md evidence/tui/ACCEPTANCE-LEDGER.md evidence/tui/EVIDENCE-INDEX.md \
  packages/mpd-tui-plugin/README.md packages/mpd-tui-plugin/README.zh-CN.md \
  packages/mpd-config-plugin/README.md packages/mpd-config-plugin/README.zh-CN.md
bun skills/dsh-qa/scripts/tui-settings-bridge.mjs --sandbox-root <root>      # needs a real TTY (tmux)
node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs                     # t51: same checker, after the §6.2/§6.6/§3.1 additions
node evidence/tui/delivery/20260915T072355Z/cited-paths-exist.mjs <edited files>  # t51: 0 missing
```

## 8. How to re-run what this index cites

```sh
# the five lanes (a fresh --sandbox-root proves independence; --install needs the network once)
bun skills/dsh-qa/scripts/tui-mount.mjs        --sandbox-root <root> [--install]
bun skills/dsh-qa/scripts/tui-panels.mjs       --sandbox-root <root>
bun skills/dsh-qa/scripts/tui-admission.mjs    --sandbox-root <root>
bun skills/dsh-qa/scripts/tui-distribution.mjs --sandbox-root <root>
bun skills/dsh-qa/scripts/tui-spec-conformance.mjs --sandbox-root <root>
# gates
bun run typecheck && bun test packages && node scripts/verify-rows-parity.mjs
node skills/dsh-qa/scripts/preset-conformance.mjs
node evidence/tui/docs/20260915T070743Z/doc-assertion.mjs
```

A claim whose command cannot run in a given environment must be reported as blocked with the exact
reason (as AC-20 is here) — never omitted, never approximated. A claim whose evidence arrives later is
upgraded in place with an amendment note rather than left under-stated (as AC-15 was, once R6 passed).

---

## 9. AMENDMENT 2026-10-06 — the 0.13.0 adaptation wave's real-PTY lanes (lane E, plan item 5)

This section is APPENDED; nothing above was rewritten. The host moved `0.12.0 → 0.13.0`, the lanes in
§2 were made 0.13.0-aware and language-robust, and three of the claims above were re-measured on the
new host. The full report, the raw invocation logs and the 0.12.0 bound are in
`evidence/tui/lane-repair/013-20261006T102742Z/` (`TUI-013-LANE-REPORT.md`, `raw/*.log`,
`raw/tui-012/*`).

| Claim | Artifact / observed result |
|---|---|
| `tui-mount` PASS on 0.13.0 (triple layer, status line, counters, `agentPreset=mpd`, `isolationOffenders=0`) | `evidence/tui/lanes/2026-10-06T10-27-42.389Z/` — `[tui-mount] PASS: third layer mounted, 12 session record(s) decoded, zero apply-crash signatures` (exit 0) |
| `tui-panels` — **7 of 8 surfaces render**, including the NEW `tuiPanels` registration arm (`id=act1:team`) | `evidence/tui/lanes/2026-10-06T10-27-53.571Z/` — `tuiStatus=rendered tuiCommandTrees=rendered commands=rendered tuiPanels=rendered tuiScenes=rendered tuiRenderers=MISSING tuiSettingsSections=rendered tuiDialogs=rendered` (exit 1, on `tuiRenderers` alone) |
| `tui-deps-ctrla` PASS — the Ctrl+A expectation FLIPPED on 0.13.0 (contact inert, host dashboard) and `/mpd panel` proves the sidebar registration | `evidence/tui/lanes/2026-10-06T10-28-57.807Z/` — `[tui-deps-ctrla] PASS: the host's Ctrl+A stayed INERT (its own dashboard opened) and /mpd panel proved the sidebar registration + accepted open` (exit 0) |
| The status-line and settings assertions now match the plugin's OWN localized strings; the settings pane was widened 220→320 columns so the four-clause disclosure is asserted verbatim | same `tui-mount` / `tui-panels` artifacts; the 220-column truncation measurement is described in the report §2.3 |
| **`tuiRenderers` stays NOT-CLAIMED** — now with the corrected three-way cross-check (`appended, NOT projected`: store count 4, Channel rows 0) | `…/10-27-53.571Z/result.json` (`rendererCrossCheck`), plus the pre-existing cause record `evidence/tui/live/20260915T063140Z/CORRECTION-renderer-causation.md` |
| **BOUND: no PTY proof of the pre-0.13.0 arming path** (the `.mpd/recon/tui-012` fixture never reaches a chat screen) | `evidence/tui/lane-repair/013-20261006T102742Z/raw/tui-012/attempt{1,2,3}-*.log`; the leg rests on `panel.test.ts` (16/0), `dashboard-key.test.ts` (11/0), `adapter-hosts.test.ts` (30/0) |
