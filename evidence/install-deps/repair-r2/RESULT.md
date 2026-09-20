# t11 — repair round 2: the sidebar guard covers every patch layer the loader composes

**Author:** Deep Worker (team `mpd-install-deps`, task `t11`, attempt 2, `attempt_id`
`bc41cc3a-5d3c-4836-bcbc-16adc0aa5d1c`). **Kind:** repair (round 2), driven by the t6 review
(`evidence/install-deps/review/RESULT.md`, verdict `needs_revision`).
**Verdict:** R1 (high), R3, R4, R2 and R5 CLOSED; the guard's measured properties kept; all named
gates green; the nine-composition boot ledger green and the fatal mode reproduced RED by a negative
control that differs from the green arm ONLY in the guard body under test.

## 0. The revision (sha256 + the UTC instant each was read)

| path | sha256 | read at (UTC) |
|---|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e` | 2026-09-20T03:57:05Z → 04:00:5xZ |
| `scripts/install-profile.mjs` | `1820242d3a9af2a8ad5d4949bb6b61ae53229e3d4cb5b237b1ad0b6ea9ec1dd6` | same |
| `scripts/pack-mpd.mjs` | `52b4245dc46e8f3f1de87b7f16ac0adda11370fb5606a420d9ea97b7836cdb07` (unchanged) | same |
| `package.json` | `64e9797767e086db02428946fa9c4764786695f493fe9c14352b065a099a634f` (unchanged) | same |
| `bun.lock` | `92b9f18df2eb4d5f53c4f89e229b9021008a3e6be4d0fb2422513cbdf39aab7a` (unchanged) | same |
| `README.md` / `README.zh-CN.md` | `5a604ac4aba50dbdb4405f733cefdeee6f6a721e480f54667b7e715642859979` / `b23074346172c970242509f4b69872a06e053af80a00fd6d369dda76e700b8ba` | same |
| `docs/design.md` / `docs/design.zh-CN.md` | `d447f5509398c66dc40f0421bfd61207581059d7c95e0ea956f90eb8dbea4d5d` / `f3ac2def127f1a03f7ef7f77af12b24d56987fed7f1e43f23d26ad2c27bca8f5` | same |
| `evidence/install-deps/implementation/README.md` | `bb23090838faf5a76a45c86787a09098476117d8244b7633c2286b499d6f1fe9` | same |

**Hash sandwich:** `hashes.start.txt` (03:57:05Z) → all the work below → `hashes.end.txt` after a
50 s settle window; the two files are byte-identical (`diff` clean, `SANDWICH OK`), so every result
here is anchored to ONE settled revision.

## 1. The guard (the single body carried into both carriers)

| property | value |
|---|---|
| guard body | `guard.source.txt` — 3367 bytes, sha256 `e0429ff54f8eaca1cd371e49925a32d91233850126ebd8afc66bbb601f40aeb6` |
| carrier 1 | `packages/mpd-bundle/cordis.patch.yml` row `mpd-better-sidebar`, `disabled: !!js "<json>"` (the row line is 3390 bytes) |
| carrier 2 | `scripts/install-profile.mjs` `const SIDEBAR_GUARD = "<json>"` — asserted byte-equal by `--self-test` |
| carrier 3 | the PACKED patch: `pack carries the exact scalar: true` (§4) |

Decisions the guard can now emit (one line per distinct decision, stable prefix
`[mpd-better-sidebar] mount guard: `; every throw returns DISABLED):

| clause | decision / reason |
|---|---|
| 1 | `DISABLED - dsh-better-sidebar is not resolvable from the profile node_modules` |
| 2 | `DISABLED - dsh-better-sidebar is itself a declared bundle layer` |
| 3 | `DISABLED - bundle layer <name> already mounts it in its own patch` (self-exclusion by IDENTITY: the layer whose `package.json` name is `@mpd-dsh/mpd` is skipped — R4) |
| 4 | `DISABLED - patch layer <path> already mounts it` — `<profileDir>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml` (`<profileDir>/../../cordis.patch.yml`), and every `--patch` overlay recovered from `process.argv` (`--patch X` and `--patch=X`, repeatable) — R1 |
| 5 | `DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry in this composition` (fail-closed: raw `options.disabled` must be absent or literally `false`; the `@deepseek-ai/dsh-web-app` layer OR is GONE — R3) |
| 6 | `ENABLED - web plane present and no other layer mounts dsh-better-sidebar` |

Over-approximation is stated in the row comment: a layer that merely MENTIONS the package disables
the row, because a false disable costs the sidebar while a false enable kills the boot with
`webserver: duplicate route`.

## 2. Findings closed

* **R1 (high) — CLOSED, both halves.** The layer scan of clause 4 reads all three extra layer sources
  AND the `--patch` overlays from `process.argv` (§1). **Proven by real boots**, not by argument: the
  ledger's `profile-layer-mount`, `home-layer-mount`, `overlay-mount` and `overlay-equals-mount`
  arms each put an UNGUARDED sidebar row (foreign id) into exactly one of those layers; in every one
  of them this bundle's row DISABLES, the boot is healthy (0 fatal signatures) and the sidebar is
  served exactly once. The **negative control** (`f3-negative-control.mjs`) boots the same shape with
  the PRE-repair guard text banked by the review (`evidence/install-deps/review/guard.raw.txt`):
  `duplicatePrefixRoute: true`, `failedToApplyLoaderEntry: true`, no token → the F3 fatal mode is
  real and reachable, and the ONLY difference between RED and GREEN is the guard body.
* **R3 (low) — CLOSED.** Clause 5 is the entry test alone, fail-closed on the raw node; measured in
  the `dsh-tui` arm (`DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry in this composition`)
  and in the author's earlier probe that a `!!js`-disabled webserver row no longer counts as present.
* **R4 (low) — CLOSED.** Self-exclusion is `other.name === '@mpd-dsh/mpd'`; the
  `text.indexOf('mpd-better-sidebar')` substring test is gone. A foreign layer that mounts the
  package AND mentions our id is now detected (that combination is exercised by the negative-control
  overlay, whose text mentions the package and mounts it).
* **R2 (medium) — CLOSED, both languages.** `README.md` / `README.zh-CN.md` (the `mpd-better-sidebar`
  table row) and `docs/design.md` §4 / `docs/design.zh-CN.md` now name exactly the layers the guard
  reads (bundle patches, `<profileDir>/cordis.patch.yml`, `$DSH_HOME/cordis.patch.yml`, `--patch`
  overlays in both spellings), the fail-closed web clause, and the deliberate
  over-approximation toward DISABLED. `bun run verify:docs` green (38 pairs, 0 violations).
* **R5 (low) — CLOSED.** `evidence/install-deps/implementation/README.md` §2 now labels each half by
  evidence class: the pnpm half **[STRUCTURAL, not measured here]** (with the verification lane's
  real-install log cited: `evidence/install-deps/verification/20260920T034229Z/real-install/plugin-add.log`,
  `exit=0 end 2026-09-20T03:42:36Z` — which still had **no `result.json`** when this repair was
  written, so the bound is stated plainly), the `healProfileModuleFallback` half **[MEASURED]**, the
  packed-install path **[NOT MEASURED HERE]**, plus the §3 decision-line list and the §6 bounds
  updated to the repaired guard.
* **R6 (pre-existing, not fixed by this change)** — recorded, unchanged: the legacy installer mirrors
  the same row id and `applyEntryPatches` has no duplicate-id check, so a profile carrying BOTH the
  legacy home patch and the bundle layer has two entries with one id. This holds for all 26 mirrored
  ids and is explicitly out of this repair's acceptance.

## 3. The ledger — nine REAL compositions (`ledger.mjs`)

`evidence/install-deps/repair-r2/runs/2026-09-20T03-57-10.615Z/result.json` (`ok: true`), each
composition a hand-built isolated profile (`DSH_HOME` + `HOME` + workspace cwd inside a mktemp root)
with a REAL mounting boot; composition claim and load claim recorded separately.

| # | composition | fatal mode it targets | guard decision | fatal signatures | sidebar |
|---|---|---|---|---|---|
| 1 | bundle-only web | (the user clause) | ENABLED | 0 | served exactly once |
| 2 | aggregate-first | F3 duplicate mount | DISABLED (bundle layer) | 0 | served exactly once |
| 3 | aggregate-after | F3 (forward-blind order) | DISABLED (bundle layer) | 0 | served exactly once |
| 4 | profile-layer mount (`<profileDir>/cordis.patch.yml`) | **F3 (R1)** | DISABLED (patch layer) | 0 | served exactly once |
| 5 | HOME-layer mount (`$DSH_HOME/cordis.patch.yml`) | **F3 (R1)** | DISABLED (patch layer) | 0 | served exactly once |
| 6 | overlay mount (`--patch X`) | **F3 (R1)** | DISABLED (patch layer) | 0 | served exactly once |
| 7 | overlay mount (`--patch=X`) | **F3 (R1)** | DISABLED (patch layer) | 0 | served exactly once |
| 8 | dsh-tui plane | F2 pending entry | DISABLED (no enabled webserver entry) | 0 | no sidebar |
| 9 | package-absent (hermetic staged bundle) | F1 unresolvable | DISABLED (not resolvable) | 0 | no sidebar |

Fatal-signature set: `duplicate prefix route`, `plugin(s) failed to load`, `did not activate`,
`pending (waiting for service`, `failed to apply loader entry`. Every arm's `composition` claim is a
`scripts/dump-config.mjs` run (with the overlay args forwarded for arms 6/7, so the composed tree
really shows both rows) and every `load` claim is a token-authorized HTTP boot (`/`, `/sidebar/api`).

**Negative control** (`runs/2026-09-20T03-56-36.462Z/negative-control/result.json`, `ok: true`):
`duplicatePrefixRoute: true`, `failedToApplyLoaderEntry: true`, `tokenPrinted: false`.

**Case cross-check:** the permanent QA case (`skills/dsh-qa/scripts/install-dependencies.mjs`, t3)
was re-run on this revision — 5/5 arms PASS, TUI arm reading the new fail-closed line
(`DISABLED - no enabled @deepseek-ai/dsh-host-webserver entry in this composition`). Its evidence was
relocated inside this task's scope: `qa-case-rerun/2026-09-20T03-59-54.395Z/` (+ sha256 list).

## 4. Gates (all on the settled revision)

| command | exit | evidence |
|---|---|---|
| `node scripts/install-profile.mjs --self-test` | 0 | guard byte-parity with the patch asserted by the test |
| `node scripts/verify-rows-parity.mjs` | 0 | 26 row ids match the bundle patch insert list |
| `bun run verify:rows` | 0 | same check through the package script |
| `node scripts/verify-dist-fresh.mjs` | 0 | `20/20 targets fresh (each rebuilt twice, byte-identical)` |
| `bun run verify:docs` | 0 | `pairs=38 failed=0 violations=0 … PASS` |
| `node scripts/pack-mpd.mjs --out evidence/install-deps/repair-r2/pack` | 0 | packed patch carries the exact guard scalar (`true`), packed `dependencies` arm == source `{"dsh-better-sidebar":"0.19.0-alpha.1"}`; the two artifacts that carry those claims are kept at `pack-verified/{cordis.patch.yml,package.json}` (+ `pack-verified-sha256.txt`; the packed patch is byte-identical to the source patch, `e70a179e…`), and the 19 MB staging tree was removed to keep the evidence lean |
| `node evidence/install-deps/repair-r2/ledger.mjs` | 0 | `ok=true compositions=9` |
| `node evidence/install-deps/repair-r2/f3-negative-control.mjs` | 0 | RED reproduced (`duplicatePrefixRoute: true`) |
| `node skills/dsh-qa/scripts/install-dependencies.mjs` | 0 | `ok=true arms=5 skipped=0` |

The canonical `dist/mpd-package/` was NOT touched: the re-pack used `--out` into this evidence dir.

## 5. Bounds of the repair (what is still outside the guard)

1. A layer that mounts the sidebar from CODE rather than a patch is not visible to a declaration
   scan; the loader's `duplicate prefix route` still fails loudly (pre-existing ecosystem behaviour).
2. A `--patch` spelling that is neither `--patch X` nor `--patch=X` cannot be recovered from
   `process.argv`; both sanctioned spellings are measured here.
3. Extraction of the guard into `lib/` (testable code) was left alone: the acceptance fixes the guard
   in place, and moving it would change the packed bytes and the installer parity.
4. R6 (legacy installer row-id mirroring) is recorded, not fixed — out of this repair's acceptance.

## 6. Scope

Changed source: `packages/mpd-bundle/cordis.patch.yml`, `scripts/install-profile.mjs`,
`README.md`, `README.zh-CN.md`, `docs/design.md`, `docs/design.zh-CN.md`,
`evidence/install-deps/implementation/README.md`. Everything else written by this task lives under
`evidence/install-deps/repair-r2/**`. No `skills/**` file was edited (the QA case was RUN, and its
byproduct evidence was relocated into this scope); `scripts/pack-mpd.mjs`, `package.json` and
`bun.lock` are unchanged from the revision t2 landed (hashes unchanged in §0).
