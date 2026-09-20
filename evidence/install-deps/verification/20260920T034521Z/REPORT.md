# t5 — Independent verification of the install-dependency fix (Lead lane, attempt 1)

**Verdict: the fix is REPRODUCED.** A plain install of `@mpd-dsh/mpd` mounts, activates and really
serves the sidebar host **exactly once**, on every composition this lane built from the shipped
tree; the two RED/GREEN boundaries are shown; the dsh-tui and missing-package arms degrade instead
of dying; the five contract gates and the packer round-trip pass. Two MEDIUM robustness findings
(the guard's textual over-approximation) are reported to the captain, not repaired here.

This lane wrote **only** `evidence/install-deps/verification/**`. No source file, no author evidence
and no QA case was modified.

---

## 1. Settled revision (every verdict below is anchored to these bytes)

| file | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e` | 03:54:15Z → 03:55:10Z → 04:01:28Z → 04:02:18Z → 04:04:15Z → 04:13:53Z |
| `scripts/install-profile.mjs` | `1820242d3a9af2a8ad5d4949bb6b61ae53229e3d4cb5b237b1ad0b6ea9ec1dd6` | same instants |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` | same |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` | same |
| `bun.lock` | `92b9f18df2eb4d5f53c4f89e229b9021008a3e6be4d0fb2422513cbdf39aab7a` | same |
| `skills/dsh-qa/scripts/install-dependencies.mjs` | `108134dc4698af32c93e3ec716fb3444bf5950ce00ff098491b40f1a216a5a66` | same |
| `skills/dsh-qa/cases.json` | `646e16d2518d8f95d6efe3ffff641838f3ccd678da8211ce2af43cd79da8b381` | 04:13:53Z |
| `skills/dsh-qa/SKILL.md` | `8afc6a716321eeabe095c26bfcd565fb1c688de2fd466bd4fa19a9d500fb63a5` | 04:13:53Z |

**Sandwich:** hashes identical at the start pin, after a 50 s settle window, at the end of the
matrix (04:04:15Z), and after all gate work (04:13:53Z) — `start == end == postRun`, no file on the
pinned list moved while this lane measured. See `pin.json` and `result-final.json#hashDiscipline`.

**The tree DID move mid-run (disclosed, not hidden).** At 03:53:54Z a re-hash showed
`cordis.patch.yml` `6ab4df7e…` → `e70a179e…` and `install-profile.mjs` `98b29e10…` → `1820242d…`;
the first full matrix (timestamp 03:45:28Z–03:46:18Z pin) is therefore **kept as audit only**
(`arms/`, `result.json`) and was **re-run from scratch** on the settled revision into `arms-final/`
+ `result-final.json`. The observable symptom that triggered the check: arm A4 reported a guard
reason ("no enabled @deepseek-ai/dsh-host-webserver entry…") that the previously pinned patch text
did not contain. Details in `pin.json`.

---

## 2. What was run, and where the evidence lives

Verifier-owned harnesses (no author code re-read as proof):

| artifact | what it does |
|---|---|
| `t5-repro.mjs` | 11-arm matrix: COMPOSITION claim (`scripts/dump-config.mjs`, never cited as load proof) and LOAD claim (real boot, token-authorized HTTP; tmux TUI) as **separate objects** per arm |
| `t5-real-web.mjs` | boots the profile the CLI **actually wrote** (`dsh plugin --profile web add <repo>`), records the module-fallback materialization |
| `t5-client-module.mjs` | fetches the served client bundle with the HTML entity decoded |
| `t5-red.mjs` | controlled RED/GREEN pair: two staged bundle copies that differ **only** by the guard row |
| `logs/<arm>.boot.log`, `logs/<arm>.composed.txt`, `logs/A4-tui-plane.tui-raw.log` | durable copies (the /tmp sandboxes do not survive the process) |
| `gates/*.log` | the five contract commands + bonuses, with exit codes |

Sandboxes are always `DSH_HOME + HOME + cwd` under the arm's own root (`T5_SANDBOX_ROOT`, mostly a
private `/tmp`), never the real `~/.dsh`. Checked after the matrix: no boot wrote workspace-scoped
state (no `.mpd/{memory,boulder.json,hashline-files.json,plans,ulw}` or `.codegraph` writes;
`<sandbox>/dsh/sessions/` empty).

---

## 3. Acceptance 1 — the five compositions, reproduced independently

All measured on `e70a179e`. "served" = the index HTML carries `dsh-better-sidebar/client.js` in the
served client table **and** `GET /sidebar/api` is not 404 (the sidebar's own envelope answers).

| arm | bundles (order) | composition rows | guard line | `GET /sidebar/api` | served | fatal signatures |
|---|---|---|---|---|---|---|
| **A0-real-plugin-add** | profile starts `[base, web-app]`, then **real `dsh plugin --profile w add <repo>`** (exit 0) | 1 (`mpd-better-sidebar`) | `ENABLED` | **405** + `{"ok":false,"error":{"code":"method-error",…}}` | **true** | none |
| **A1-bundle-only** | `[base, web-app, mpd]` | 1 | `ENABLED` | **405** same envelope | **true** | none |
| **A2-aggregate-first** | `[base, web-app, aggregate, mpd]` | 2 (`web-ui-better-sidebar` literal-enabled, ours raw `!!js`) | `DISABLED` "bundle layer @linxin666/dsh-web-all already mounts it in its own patch" | **405** | **true** (aggregate owns it) | none |
| **A3-mpd-first-aggregate-after** | `[base, web-app, mpd, aggregate]` | 2 | `DISABLED` (same, order-independent) | **405** | **true** | none |
| **A4-tui-plane** | `[base, tui, mpd]`, real tmux `dsh-tui` boot | 1 | `DISABLED` "no enabled @deepseek-ai/dsh-host-webserver entry in this composition" | n/a (no web plane) | n/a | **none** (213 KB raw log) |
| **A5-package-absent** | `[base, web-app, mpd]`, hermetic copy stage with **no** `node_modules` on its chain and a sandbox root **off the checkout** | 1 | `DISABLED` "dsh-better-sidebar is not resolvable from the profile node_modules" | **404** | **false** | none — boot succeeds, degrades |

`A0` details (`arms-final/A0-real-plugin-add.json`): `dependencies` before `{}` → after
`{"@mpd-dsh/mpd":"link:/root/dshProj/my-power-dsh"}`; `dsh.profile.bundles` before
`[base, web-app]` → after `[base, web-app, mpd]`; after the boot `<profile>/node_modules` contains
`dsh-better-sidebar` (materialized through `.dsh-module-fallback` by the harness), which is exactly
what makes the guarded row resolvable.

**E2E arm (`arms-final/E2E-real-web-profile.json`)** — the EXACT shipped command, not a mock:
`dsh plugin --profile web add /root/dshProj/my-power-dsh` (exit 0) → boot of the profile it wrote →
guard `ENABLED`, route **405** with the sidebar envelope, served **true**, fallback materialized
**true**, zero fatal signatures.

**Browser half, corrected probe** (`arms-final/client-module-probe.json`): the combined URL the
index actually serves (`/plugins/??…,dsh-better-sidebar/client.js&rev=ca72e3112191`, entity decoded)
answers **200 / 12,361,294 bytes / sha256 a67aa5091565470894e111cedbf49c36381b918ac41f1cc422d2159f8a16e354**
with `carriesSidebarIdentity: true`. The **standalone** form
`/plugins/??dsh-better-sidebar/client.js&rev=<combined rev>` answers **404** — the rev must be the
entry's own rev (t2 recorded `…&rev=5d6dbe9fa63dd61f-52` → 200 / 870,764 B). This lane did **not**
reproduce the 870,764-byte standalone probe; see residual risk R3.

## 4. Acceptance 2/3 — the load claim never rests on `--dump-config`

Every "mounted/active/served" claim above rests on a **real boot and a real HTTP response**; the
composition claim is recorded separately in the same arm object and labelled
"COMPOSITION ONLY … NEVER cited as load evidence". The load evidence per web arm is the tuple
{guard line in the boot log, `GET /sidebar/api` status+body, `dsh-better-sidebar/client.js` in the
served client table}; for the TUI arm it is the tmux pane + 213 KB raw pipe log with **zero**
`did not activate` / `pending (waiting for service` / `failed to apply loader entry` /
`plugin(s) failed to load` / `duplicate prefix route` occurrences.

## 5. Acceptance 4 — the two RED/GREEN boundaries

* **Captain's pre-fix baseline** (`evidence/install-deps/red-baseline/20260920T030832Z/`): re-read by
  this lane — `result.json` records `better_sidebar_rows: 0` and `composed-config.txt` contains
  **0** occurrences of `dsh-better-sidebar`. Real, pre-fix, artifact-backed.
* **t3's own RED anchor**: re-ran `node skills/dsh-qa/scripts/install-dependencies.mjs --self-test`
  → **exit 0**, and its `result.json` carries `redBaseline` +
  `sidebarRowsAtRedBaseline` computed by re-parsing that pre-fix artifact (so arm 1's `rows >= 1`
  really can fail).
* **This lane's controlled pair** (`arms-final/R1-*.json`, `R2-*.json`, `red-green-final.log`):
  two staged bundle copies differing **only** by the guard row; the GREEN copy's patch is
  byte-identical to the shipped one (sha256 equal, asserted).
  * **RED** (guard row stripped, 4 lines removed at 162–165): composition **0 rows**, route **404**,
    served **false**, boot healthy.
  * **GREEN** (shipped bytes): composition **1 row**, guard **ENABLED**, route **405**, served
    **true**, boot healthy.
  * `boundaryProven: true`, `allChecksOk: true`. A green assertion that cannot be shown red is not
    evidence; this one is shown red by the same probes in the same run.

## 6. Acceptance 5 — dsh-tui: a REAL boot, not a skip

`A4-tui-plane`: tmux `dsh-tui` boot (220×50, raw `pipe-pane` log 213,420 B), guard line
`[mpd-better-sidebar] mount guard: DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry in
this composition`, zero fatal signatures, composition shows the row present but guarded. Prerequisites
present (tmux 3.4, `dsh-tui` 0.10.1, real dsh-tui profile mirrored) → **not a SKIP**.

## 7. Acceptance 6 — gates on the settled revision (all exit 0)

| command | exit | observed |
|---|---|---|
| `node scripts/verify-rows-parity.mjs` | 0 | 26 row ids match the patch insert list, incl. `mpd-better-sidebar` |
| `bun run verify:rows` | 0 | same, via the package script |
| `node scripts/verify-dist-fresh.mjs` | 0 | 20/20 targets fresh (rebuilt twice, byte-identical); 7 NOT COVERED printed |
| `bun run verify:docs` | 0 | `pairs=38 failed=0 violations=0 links=234 dead=0 — PASS` |
| `node scripts/verify-pack-closure.mjs` | 0 | 1186 files compared, **1186 identical, 0 drift, 0 expected-after-pack**; completeness 409 present / 1 declared exemption |
| `node scripts/pack-mpd.mjs` (round-trip) | 0 | **`dist/mpd-package/package.json` carries `dependencies: {"dsh-better-sidebar":"0.19.0-alpha.1"}`** (read from the artifact); the packed `cordis.patch.yml` carries `id: mpd-better-sidebar` + the guard expression |
| bonuses | 0 | `preset-conformance.mjs --self-test` (31 rows conform, parity 31/31), `install-profile.mjs --dry-run`, `install-dependencies.mjs --self-test` |

Raw logs: `gates/rows-installer-preset.log`, `gates/docs-final.log`, `gates/dist-fresh.log`,
`gates/pack.log`, `gates/pack-closure.log`, `gates/qa-case-selftest.log`.
`dist/mpd-package/**` is **gitignored** (`.gitignore:12`) — the packer round-trip changed no tracked file.

## 8. Acceptance 7 — findings reported as findings (nothing softened)

**F1 (MEDIUM, degradation-only). The guard's "another layer mounts it" predicate is a SUBSTRING test
over patch TEXT, so a layer that only *mentions* the package suppresses the mount.**

* `F3-decoy-comment-layer` (verifier-authored layer, bundled AFTER `@mpd-dsh/mpd`): its patch
  mentions `dsh-better-sidebar` **in a comment only** and inserts one row that is `disabled: true`.
  Measured: guard `DISABLED - bundle layer t5-decoy-comment already mounts it in its own patch`,
  `GET /sidebar/api → 404`, client **not** served, boot healthy — **the sidebar is lost although no
  layer mounts it**.
* `F4-decoy-disabled-row`: the foreign patch inserts a `dsh-better-sidebar` row that is explicitly
  `disabled: true`. Same measured outcome: guard DISABLED, route 404, not served.
* The same textual predicate now also scans `--patch` overlays and `$DSH_HOME/cordis.patch.yml`
  ("patch layer … already mounts it"), so the over-approximation class is wider than the layer loop.
* Evidence: `arms-final/F3-decoy-comment-layer.json`, `arms-final/F4-decoy-disabled-row.json`,
  `logs/F3-*.boot.log`, `logs/F4-*.boot.log`. Impact is a missing sidebar, never a dead boot.
  This lane did not repair anything (out of scope); the finding goes to the captain.

**F2 (probe, not a verdict). `[base, mpd, web-app]` does not boot — so it cannot be used to test the
web-plane predicate's forward-blindness.** `F5-web-layer-after`: composition exit 0 with 1 row, but
the boot dies with `plugin(s) failed to load` + `plugin tree failed to load`
(`assertEntriesLoaded`/`assertEntriesActivated` in the stack). The raw log carries **two** guard
lines — first `DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry…`, then
`ENABLED - web plane present…` — i.e. the `!!js` expression really is re-evaluated after the layer
order changes. Recorded as residual risk R2, not as a defect proven against a valid composition.

**F3 (claim not reproduced, low).** t2's standalone client-module probe (`200 / 870,764 B` at
`/plugins/??dsh-better-sidebar/client.js&rev=5d6dbe9fa63dd61f-52`) was **not** independently
reproduced: with the combined bundle's rev the same URL form answers 404. The combined URL the HTML
serves **is** 200 with the sidebar's module inside it (12,361,294 B, sha256 above), which is what the
browser loads. Closing command in R3.

**Verifier-side defects found and corrected in this lane (not bundle defects):** pass-1 harness
resolved the repo root one level too shallow (discarded, `DISCARDED-pass1-harness-bug.md`); the first
client-URL probe kept the HTML entity `&amp;` and read a 404; tmux panes are CRLF and the guard
regex missed the trailing `\r`; the RED/GREEN script `rm -rf`'d the stage it had just built
(composition exit 1, dead boot) — all four are fixed, and each fix is named in the code so the pair
cannot regress silently.

## 9. Acceptance 8 — residual risks this lane could NOT close (with the closing command)

* **R1 — the F1 over-approximation.** Closing test: a composition with a decoy layer that mentions
  the package without mounting it; the fix needs a structural predicate (parse the other patch's
  insert rows / read `disabled`) instead of a substring test.
  Run: `T5_RUN_DIR=<run> T5_ARMS_DIR=<run>/arms-final T5_SANDBOX_ROOT=/tmp/x node t5-repro.mjs --only F3-decoy-comment-layer,F4-decoy-disabled-row`
* **R2 — predicate 4 forward-blindness.** Closing test: a composition where the
  `@deepseek-ai/dsh-host-webserver` row is inserted by a layer AFTER `@mpd-dsh/mpd` while the rest of
  the bundle still boots. Not constructible from today's shipped layers (F5 shows why); a future
  host/bundle that reorders those rows would reopen it.
* **R3 — the standalone client-module URL.** Close with an entry-rev-aware probe, e.g. take the rev
  from the entry's own client table instead of the combined URL:
  `node t5-client-module.mjs real-web-final web 3585` after extending it to read the per-entry rev.
* **R4 — the packed artifact was built and read, never installed.** `dsh plugin --profile web add
  dist/mpd-package` + a boot was NOT run here (pnpm/registry reachability in this sandbox); the
  checkout install path *was* run (A0/E2E). Closing command:
  `DSH_HOME=<sandbox>/dsh HOME=<sandbox>/home dsh plugin --profile web add <repo>/dist/mpd-package`.
* **R5 — the aggregate arm uses the READY-INSTALLED `@linxin666/dsh-web-all@0.3.20`** mirrored from
  the real web profile (this sandbox cannot reach the registry); the composition it produces is real,
  its *installation* was not exercised.

## 10. Reproduce

```bash
RUN=evidence/install-deps/verification/20260920T034521Z
# T5_SANDBOX_ROOT is scratch space for the sandboxes (use any writable dir, e.g. /tmp/t5-scratch);
# it is NOT evidence — the durable artifacts are logs/, arms-final/, gates/.
T5_RUN_DIR=$PWD/$RUN T5_ARMS_DIR=$PWD/$RUN/arms-final T5_SUMMARY=$PWD/$RUN/result-final.json \
  T5_SANDBOX_ROOT=/tmp/t5-scratch node $RUN/t5-repro.mjs                    # 11-arm matrix
node $RUN/t5-red.mjs                                                       # controlled RED/GREEN pair
node $RUN/t5-real-web.mjs real-web-final                                   # boot the CLI-installed profile
node $RUN/t5-client-module.mjs real-web-final web 3585                     # served client bundle
```

## 11. Evidence hygiene (pruned before the commit)

The sandbox working trees this lane created (materialized DSH homes, `node_modules` mirrors, pnpm
caches, staged bundle copies, the pnpm registry metadata blob) were **deleted** from
`evidence/install-deps/verification/**` before completion: **97 MB / 3286 files → 1.6 MB / ~120
files**. What remains is durable: `REPORT.md`, `verification-summary.json`, `prune-check.json`,
`pin.json`, the per-arm JSONs, the boot logs / composed dumps under `logs/`, the gate logs under
`gates/`, the verifier harnesses and the small synthetic fixtures.

* **Citations repaired:** every dead sandbox path is either re-pointed at its durable copy
  (`logs/<arm>.boot.log`, extracted from the E2E sandbox before deletion) or marked
  `<pruned:sandbox>`; `prune-check.json` asserts `citationsIntoPrunedRootsRemaining: []` and
  `missingCitedDurablePaths: []` (`ok: true`).
* **One lost log, disclosed:** the `F5-web-layer-after` arm ran before log persistence existed, so
  its boot log is gone; its JSON keeps the measured facts (`logTail`, `guardLines`, `signatures`)
  and its citation is nulled with the original recorded in `bootLogMissing`.
* **Credentials:** no `.credentials.yaml`, `settings.yaml` copy, `.modules.yaml` or session log
  remains under this lane's evidence (verified by `find` after the prune); the credentials copies
  lived only inside the deleted sandboxes.
* **Tokens:** every ephemeral web-session token in a kept log/JSON was redacted to
  `token=<redacted>`; a final grep for `token=<value>` over the kept files returns nothing.

