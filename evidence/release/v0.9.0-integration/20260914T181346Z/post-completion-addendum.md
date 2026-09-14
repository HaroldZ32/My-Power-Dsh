# t11 post-completion addendum — packed proof, host block, and status of the three items

Written after t11 reached `completed` (attempt 9), in answer to the captain's guidance that arrived
afterwards. The completed record (`result.json`, `output.log`, `release-checklist.md`) is unchanged;
this file adds the packed-proof method t7 prescribed plus the host-block record. No git command was run.

## 1. The three guidance items — status against the CURRENT tree (measured, not recalled)

| Item | Status | Measurement |
|---|---|---|
| (3) `package.json` — three names + two CLI statements | **ALREADY DONE in this task** (the captain's note that it is "fully open" describes the state before my edit) | `version: 0.9.0`; `exports["./extensions/*"]` present; `test:qa:all` contains `extension-isolation`, `extension-lifecycle`, `extension-mcp-bridge` **and** `bun scripts/mpd-ext.mjs --self-test` + `validate extensions/mpd-ext-example`; `test:qa` carries both CLI statements too. package.json sha256 `92a40bffbf6475cceda982ebc5c020dcf8d0a2d36f71069d92e5df93fa174b8e` (unchanged since completion) |
| `VENDOR_LOCK.json` skills re-pin | **ALREADY DONE** | `fileCount 301` / `treeSha 0dd4a6ee68e0a11499f2b502873016d066cface6b59036147bca066433b4b576`; lock sha256 `82ad164cbf55f4228f183efcad6adf67b01fe810ab41a37c27907db52b514f5b`; `verify-vendor` exit 0. Recomputed at edit time with the gate's own algorithm; the four changed corpus paths are `skills/dsh-qa/SKILL.md` + the three `extension-*.mjs`. Must ride the same commit as the `skills/**` change |
| `AGENTS.md:277` "40 regions" -> 46 | **ALREADY FIXED on disk** (not by me — I had left it because AGENTS.md is in this task's `outOfScope`) | line 277 now reads `The live registry is **46** regions across **9** adopted files`; `grep -c '40\*\* regions'` = 0 |

## 2. Packed GREEN — asserted on the staged tree (the method t7 prescribed)

`node scripts/pack-mpd.mjs` was re-run on the current tree (exit 0, `1107 files`, 644:1095 / 755:12),
then `packed-tree-assertions.mjs` asserted the staged artifact:

```
[packed-tree-assertions] PASS: 20/20 checks
```

Full machine-readable report: `packed-tree-assertions.log` (JSON). What it pins:

- `packages/mpd-ext-plugin/dist/index.js` and `dist/sdk.js` staged;
- `extensions/mpd-ext-example/mpd-ext.json` + `server.mjs` staged;
- `scripts/mpd-ext.mjs` staged;
- every staged dist is **byte-identical** to the repo's rebuilt dist (`mpd-ext` index+sdk, `mpd-roles` index);
- packed manifest `version 0.9.0`, `files` contains `extensions/**` and `scripts/**`, `exports` contains `./extensions/*`;
- the packed patch still carries the `mpd-ext` row, points it at the packed name
  `'@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/index.js'`, and has **zero dev-path leaks**;
- the shipped example manifest declares `apiVersion 1`, `enabled: false` and all four contribution kinds;
- staged file count == 1107 == the count the packer reported.

## 3. The packed INSTALL on this host — blocked-by-host, recorded exactly

`dsh plugin add <packed-dir>` cannot complete here: pnpm fails with

```
[ERR_SQLITE_ERROR] unable to open database file
```

Measured by t7's owner twice (with `HOME=/root` and with a sandbox `HOME`), recorded verbatim in
`evidence/extensions/t7-verify/20260914T174828Z/result.json`:

> `dsh plugin add <packed-dir>` cannot complete on this verification host: pnpm fails with
> `[ERR_SQLITE_ERROR] unable to open database file`, reproduced with HOME=/root as well as a sandbox
> HOME, so the failure is environmental and NOT attributable to the packed tree.

Per the captain's instruction this task did **not** attempt pnpm again. It did, however, run a real
packed **install + boot** through the npm path that the repo's own QA case uses:
`bun skills/dsh-qa/scripts/relocate-smoke.mjs --no-skip` → **PASS** (the staged package is copied to an
unrelated location, npm-installed into an isolated profile, dump-config shows no dev-path leak and the
`@mpd-dsh/mpd` rows, and a relocated headless boot serves its preset root + skill corpus by reference
with zero writes into the harness home). Log: `relocate-smoke.log`; the case's own evidence:
`evidence/plan-d/relocate/2026-09-14T18-13-53.970Z/{result.json,output.log}`.

So the honest statement is: **packed GREEN by staged-tree assertion AND by a real npm-path install+relocated
boot; the pnpm-path install (`dsh plugin add`) is blocked by this host's pnpm store, not by the artifact.**

## 4. The RED (before-state), as measured by t7

Carried from `evidence/extensions/t7-verify/20260914T174828Z/result.json`:

> `pack-mpd` exits 0 and stages `dist/mpd-package` (1095 files), but the packed tree does NOT carry the
> plugin or the asset: `packages/mpd-ext-plugin/` is absent (0 matching dirs), `extensions/` does not
> exist, and the packed package.json `files`/`exports` name neither. The staged patch does declare the
> `mpd-ext` row.

That is the silent-exit-0 class this task closed: **before** 1095 files and neither the package nor the
asset nor the manifest entries, **after** 1107 files with all of them asserted (section 2).

## 5. Still not verified here (unchanged from the checklist)

Every git action (captain only), the Gitee push (no token read), `bun run test:qa:all` (real-lane +
live provider; its composition was verified and the wave's real boots are t5/t7 evidence),
`bundle-lifecycle` re-run, Web GUI, cross-platform.
