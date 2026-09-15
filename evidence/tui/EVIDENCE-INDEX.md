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
