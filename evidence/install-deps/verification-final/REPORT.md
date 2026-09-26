# t17 — FINAL independent verification on the frozen post-repair revision

**Verdict: GREEN — 15/15 arms on the frozen revision `1b316b68` (patch) / `2809ccfc` (installer), with
the two decoy arms that motivated repair t14 re-measured in BOTH directions, a negative control that
still dies, the permanent QA case green (5/5 arms), and every gate re-run.**

## 1. The revision this result speaks for — and what it does NOT

| file | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `1b316b68850fbe3958b16088ac723abcd50faabd178668de7ed6044811107e8f` | 04:28:55Z → 04:33:43Z → 04:34:33Z → 04:46:37Z |
| `scripts/install-profile.mjs` | `2809ccfc23b37fd9f8eff73d0feb689397fc92c7c958aec93d39045049affc67` | same instants |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` | same |
| `package.json` / `bun.lock` | `64e97977…` / `92b9f18d…` | same |
| `skills/dsh-qa/scripts/install-dependencies.mjs` | `108134dc4698af32c93e3ec716fb3444bf5950ce00ff098491b40f1a216a5a66` | same |
| `skills/dsh-qa/cases.json` / `SKILL.md` | `646e16d2…` / `8afc6a71…` | 04:46:37Z |

**Sandwich:** identical at the start read, after the 50 s settle window, at the end of the matrix and
at the post-gate re-read — the tree did NOT move during this verification
(`result.json#hashDiscipline.unchangedThroughRun: true`).

**Plainly: nothing in this document speaks for an earlier revision.** The green at
`e70a179e…/1820242d…` belongs to `e70a179e` ONLY and lives in the t5 record
(`evidence/install-deps/verification/20260920T034521Z/`), which stays untouched as the audit record
of the pre-t14 revision. This root (`evidence/install-deps/verification-final/`) is the verdict for
`1b316b68…/2809ccfc…`.

## 2. The arm matrix (15 arms, all real boots, own sandboxes; composition ≠ load)

`result.json`; per-arm records `arms/*.json`; durable boot logs/dumps `logs/*`.

| arm | bundles / composition | guard decision line | route | served | fatal sig. |
|---|---|---|---|---|---|
| **A0-real-plugin-add** profile starts `[base, web-app]`, **real `dsh plugin --profile web add <repo>`** (exit 0) | 1 row | `ENABLED - web plane present and no other layer mounts dsh-better-sidebar` | 405 | true | 0 |
| **A1-bundle-only** `[base, web-app, mpd]` | 1 row | `ENABLED` | 405 | true | 0 |
| **A2-aggregate-first** `[base, web-app, agg, mpd]` | 2 rows | `DISABLED - bundle layer @linxin666/dsh-web-all already mounts it in its own patch` | 405 | true | 0 |
| **A3-mpd-first-aggregate-after** `[base, web-app, mpd, agg]` | 2 rows | `DISABLED` (same, order-independent) | 405 | true | 0 |
| **A4-tui-plane** `[base, tui, mpd]` | 1 row | `DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry in this composition` | n/a | n/a | 0 |
| **A5-package-absent** hermetic copy, sandbox off the checkout | 1 row | `DISABLED - dsh-better-sidebar is not resolvable from the profile node_modules` | 404 | false | 0 |
| **P1-profile-patch-mounts** + `<profileDir>/cordis.patch.yml` row | 2 rows | `DISABLED - patch layer <profileDir>/cordis.patch.yml already mounts it` | 405 | true | 0 |
| **P2-dshhome-patch-mounts** + `$DSH_HOME/cordis.patch.yml` row | 2 rows | `DISABLED - patch layer <DSH_HOME>/cordis.patch.yml already mounts it` | 405 | true | 0 |
| **P3-patch-overlay-space-mounts** `--patch <file>` | 2 rows | `DISABLED - patch layer <overlay> already mounts it` | 405 | true | 0 |
| **P4-patch-overlay-equals-mounts** `--patch=<file>` | 2 rows | `DISABLED` (same spelling recognised) | 405 | true | 0 |
| **C1-pre-repair-patch-layer-control** frozen copy with the patch-layer clause removed | 2 rows | `ENABLED - web plane present and no other layer mounts dsh-better-sidebar` | dead | — | `duplicate prefix route` (+ `entryApplyFailed`, `pluginTreeFailed`) |
| **D1-decoy-comment-only** (t14's reason to exist) | 1 row | **`ENABLED`** | 405 | **true** | 0 |
| **D2-decoy-disabled-row** (`disabled: true`) | 2 rows | **`ENABLED`** | 405 | **true** | 0 |
| **D3-foreign-genuine-mount** | 2 rows | `DISABLED - bundle layer t17-foreign-mount already mounts it in its own patch` | 405 | true | 0 |
| **E1-foreign-flow-style-mount** (adversarial) | 2 rows | `DISABLED - bundle layer t17-flow-style already mounts it in its own patch` | 405 | true | 0 |

### The decoy re-measurement (the point of the repair)

* **D1**: a foreign layer that only MENTIONS `dsh-better-sidebar` in a comment — the pre-repair guard
  suppressed our mount here (t5 `F3-decoy-comment-layer`, guard `DISABLED`, route 404, sidebar lost,
  measured at `e70a179e`); on the frozen revision the same fixture yields **guard `ENABLED`, route
  405, sidebar served, 0 fatal signatures**.
* **D2**: a foreign row carrying a literal `disabled: true` — pre-repair it also suppressed the mount
  (t5 `F4-decoy-disabled-row`); now **`ENABLED` + served**, i.e. the predicate reads a real MOUNT.
* **D3**: a foreign row that genuinely mounts it must still suppress — **`DISABLED` + served**.
* **E1**: an extra adversarial probe this lane added: the same mount written in **flow style**
  (`- { id: …, name: 'dsh-better-sidebar' }`) — **`DISABLED` + served**, so the row-aware parser is
  not limited to indented block style.
* **C1 control**: with the patch-layer clause textually removed from a frozen copy, the same
  composition (profile patch mounts it) dies with
  `plugin tree failed to load: failed to apply loader entry t17-profile-sidebar (dsh-better-sidebar): webserver: duplicate prefix route "/sidebar/api"`.
  The repaired green is therefore red-able by the same probes.

## 3. Permanent QA case (frozen revision)

* `node skills/dsh-qa/scripts/install-dependencies.mjs --self-test` → **exit 0** (`gates/light-gates.log`).
* REAL run → **PASS, `ok=true arms=5 skipped=0`**, evidence
  `evidence/install-deps/qa-case/2026-09-20T04-43-31.096Z/{result.json, output.log, boot-*.log, dump-*.txt, tui-tui-plane}`;
  console log `gates/qa-case-real.log`. Arms: `bundle-only`, `aggregate-first`,
  `mpd-first-aggregate-after`, `tui-plane`, `package-absent` — all true, no skips.
  (The case writes its own conventional evidence directory; this lane did not modify the case.)

## 4. Gates on the frozen revision (raw logs in `gates/`)

| command | exit | observed |
|---|---|---|
| `node scripts/verify-rows-parity.mjs` | 0 | 26 row ids match the patch insert list, incl. `mpd-better-sidebar` |
| `bun run verify:rows` | 0 | same |
| `node scripts/verify-dist-fresh.mjs` | 0 | `20/20 targets fresh (each rebuilt twice, byte-identical)` |
| `bun run verify:docs` | 0 | `pairs=38 failed=0 violations=0 links=234 dead=0 — PASS` |
| `node scripts/verify-pack-closure.mjs` | 0 | 1186 files compared, 1186 identical, **0 drift, 0 expected-after-pack**; completeness 409 present / 1 declared exemption |
| `node scripts/install-profile.mjs --dry-run` | 0 | installer dry-run clean |
| `node scripts/pack-mpd.mjs` (round-trip) | 0 | generated `dist/mpd-package/package.json` carries `{"dsh-better-sidebar":"0.19.0-alpha.1"}`; packed `cordis.patch.yml` carries `id: mpd-better-sidebar` |

## 5. Inherited claims (explicitly NOT re-measured here) and SKIPs

* **Inherited, not re-measured:** the t5 controlled RED/GREEN pair for the guard-row boundary
  (`verification/20260920T034521Z/red-green.json`, measured at `e70a179e`); the t5 R1-class pair
  (`r1-f3-recheck/`, measured at `e70a179e`); t2's standalone client-module probe
  (`200 / 870,764 B`) which this lane has never reproduced (see R3 below); t3's case-RED anchor
  (only its `--self-test`, which re-parses the captain's pre-fix artifact, was re-run here).
* **SKIPs: none.** Every arm in the contract's list was executed; no arm was reported as a pass
  without a boot. The two `--patch` arms required the flag to precede `--port`/`--no-open` and the
  `dump-config` wrapper to receive it after `--` (harness-side, see §6).

## 6. Verifier-side defects found and fixed in this lane (disclosed)

1. `REPO` resolved one level too shallow for the new root — caught by the harness's own assertion
   before any arm ran (t5 pass 1 measured the cost of that mistake).
2. `--patch` after `--port`/`--no-open` reaches the surface parser: `error: unknown option '--patch'`.
   Correct order measured: `dsh --profile <p> --patch <file> --port N --no-open` (and
   `scripts/dump-config.mjs … --json -- --patch <file>` for the wrapper).
3. The C1 control needs the declared dependency RESOLVABLE (unlike A5, which must not have it), or the
   guard disables on its first predicate and the duplicate-mount boundary is unreachable.
4. Control-arm encoding: a negative control inverts the health expectations (`booted=false` + the
   duplicate-route signature are the PASS), so it is exempt from the generic booted/no-signature
   checks; the summary was re-derived from the persisted arms (`--resummarize`) rather than by
   rebooting.

## 7. Hygiene (`hygiene.json`, ok=true)

63 files / 938 KB; sandboxes live under `T5_SANDBOX_ROOT` (`/tmp`), never in this tree; **no**
`node_modules`/`cache`/`dsh`/sandbox directories, **no** `.credentials.yaml`/`settings.yaml`/session
store, and no ephemeral web token — every `token=<value>` in a kept log/JSON is `token=<redacted>`
(the `token=` occurrences inside the `.mjs` harnesses are regex/URL templates, i.e. code).

## 8. Residual risks this lane could NOT close (with the closing probe)

* **R1 — a foreign mount whose NAME is not spelled literally.** The row-aware predicate recognises
  indented and flow-style rows and honours a literal `disabled: true`, but a mount expressed through
  a YAML anchor/alias or a `!!js` `name:` expression would not be recognised → our row stays ENABLED →
  duplicate prefix route → dead boot. Closing probe: a foreign layer with
  `name: !!js "'dsh-' + 'better-sidebar'"` (and an anchor/alias variant) run as one more arm.
* **R2 — predicate 4's forward-blindness** (a webserver entry inserted after our row): measured only
  as a probe in t5 (`F5`), still unproven against a composition that boots. Closing probe: a layer
  that inserts `@deepseek-ai/dsh-host-webserver` AFTER `@mpd-dsh/mpd` while the rest still boots.
* **R3 — the standalone client-module URL** (`/plugins/??dsh-better-sidebar/client.js`): t2 measured
  200/870,764 B with the entry's own rev; this lane has reproduced only the combined served bundle
  (200 / 12,361,294 B at `e70a179e`). Closing probe: extend the client probe to read the per-entry rev.
* **R4 — the PACKED artifact was built and read, never installed+booted** in this environment.
  Closing command: `DSH_HOME=<sb>/dsh HOME=<sb>/home dsh plugin --profile web add <repo>/dist/mpd-package`.
* **R5 — the aggregate arm mirrors the already-installed `@linxin666/dsh-web-all@0.3.20`** (no registry
  in this sandbox); its installation is not exercised. Closing command: install it in a networked
  sandbox, then re-run A2/A3.

## 9. Reproduce

```bash
RUN=evidence/install-deps/verification-final
T5_RUN_DIR=$PWD/$RUN T5_ARMS_DIR=$PWD/$RUN/arms T5_SUMMARY=$PWD/$RUN/result.json \
  T5_SANDBOX_ROOT=/tmp/t17-scratch node $RUN/t17-repro.mjs        # 15-arm matrix (scratch dir = sandboxes)
node skills/dsh-qa/scripts/install-dependencies.mjs --self-test   # permanent case, offline
node skills/dsh-qa/scripts/install-dependencies.mjs               # permanent case, real run
```
