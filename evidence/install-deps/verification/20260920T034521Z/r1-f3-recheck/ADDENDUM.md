# t5 follow-up — independent re-test of the R1 class (captain steering, 2026-09-20)

**Trigger:** captain steering — review round 1 (t6) returned `needs_revision` with a HIGH finding: the
guard's duplicate-mount clause read only `dsh.profile.bundles` layers, so a sidebar row in the
profile's own `<profileDir>/cordis.patch.yml` left our guard at ENABLED and the boot died with
`webserver: duplicate prefix route "/sidebar/api"`. The steering asked for an INDEPENDENT
reproduction, anchored to the hash this lane measured, "green or red".

**Answer: the class is REAL (independently reproduced red) and it is CLOSED at the revision this
lane measured (`e70a179e…`).**

## 1. The pair (both arms booted by this lane's own harness, `t5-r1-f3.mjs`)

Composition in both arms: profile `w`, `dsh.profile.bundles = [base, web-app, mpd]`, plus a PROFILE
patch layer mounting the sidebar host:

```yaml
- insert:
    - id: p1-profile-sidebar
      name: 'dsh-better-sidebar'
```

| arm | bundle under test | guard line | composition rows | `GET /sidebar/api` | served | boot |
|---|---|---|---|---|---|---|
| **P1 LIVE** | the shipped tree, `packages/mpd-bundle/cordis.patch.yml` = **`e70a179e1ed13c5e4fa9926fb89fda9de4e17c1935aac1d517b37fa0b7b4b28e`**, read 04:17:25Z → 04:17:40Z (equal) | `DISABLED - patch layer <profileDir>/cordis.patch.yml already mounts it` | 2 (`mpd-better-sidebar` guarded, `p1-profile-sidebar` mounting) | **405**, body `{"ok":false,"error":{"code":"method-error",…}}` | **true** | healthy, **0** fatal signatures, **0** duplicate-route lines |
| **P2 CONTROL** | a FROZEN staged copy of the same revision with the patch-layer clause textually removed — `packages/mpd-bundle/cordis.patch.yml` = `c1051f2728ed2563dae0b798ff68d1d9ed0a3be46419332611c219d1c90abfc9` | `ENABLED - web plane present and no other layer mounts dsh-better-sidebar` | 2 (both mounting) | never served | never served | **DEAD** |

Exact line from `r1-f3-recheck/logs/P2-pre-repair-staged-copy.boot.log`:

```
Error: dsh: plugin tree failed to load: failed to apply loader entry p1-profile-sidebar (dsh-better-sidebar): webserver: duplicate prefix route "/sidebar/api"
Error: webserver: duplicate prefix route "/sidebar/api"
```

`r1-f3-recheck/summary.json`: `boundaryProven: true` (re-derived from the persisted arms, see §4).
So P1's green is not vacuous — the same probes see the pre-repair guard die.

## 2. Attribution (the captain's requirement: never a green from a superseded revision)

* **P1 measured `e70a179e…`, not the current tree.** Its own start/end reads bracket the boot:
  `patchAtStart` 04:17:25Z = `e70a179e…`, `patchAtEnd` 04:17:40Z = `e70a179e…`,
  `livePatchMovedDuringArm: false`.
* **The tree then moved again.** Live patch hashes observed by this lane:
  `e70a179e…` (my t5 pin, 03:54–04:13Z) → `7c7e36b8…` (first seen 04:19:43Z) → `1b316b68…`
  (04:21:08Z, 04:21:35Z); `scripts/install-profile.mjs`: `1820242d…` → `2809ccfc…`.
  That is repair t14 landing (the row-aware predicate).
* **Therefore:** the verdict "R1 closed" belongs to `e70a179e…` ONLY. Nothing in this addendum
  says anything about `7c7e36b8…` / `1b316b68…`; a final verification on the FROZEN post-t14
  revision is still required (see §5).
* P2 is a frozen copy by construction, so its red stays valid regardless of the live tree.

## 3. Citation correction

The steering cites `evidence/install-deps/captain-cross-check/20260920T035736Z-f3-repro/`; that path
does not resolve. The artifact that exists (and that I read for cross-reference ONLY — my arms are
built from my own fixtures) is
`evidence/install-deps/captain-cross-check/20260920T034916Z-f3-repro/`
(`profile-cordis.patch.yml` with the `user-sidebar-probe` row, `boot.log` guard ENABLED,
`boot-after-repair.log` guard DISABLED, `result.json`, `source-hashes-after-repair.txt`).
Flagged because an artifact path is the durable anchor and a dead path cannot be re-anchored.

## 4. Verifier-side defect found and fixed in this follow-up

`t5-r1-f3.mjs` first computed `boundaryProven` by comparing `signatures.hits` (which carries MARKER
strings such as `duplicate prefix route`) against a KEY name (`duplicatePrefixRoute`) → the flag read
`false` while both measured facts held. Fixed in the script and re-derived with
`node t5-r1-f3.mjs --resummarize` (no reboot; the frozen copies and measured hashes keep their
meaning). Recorded here so the correction is auditable.

## 5. What is still open (and what this lane can run the moment it is assigned)

1. **Frozen post-t14 revision**: re-run the full t5 matrix (A0–A5, F1–F4, E2E, R1/R2) + this R1-class
   pair on the settled hash. My harnesses take `T5_RUN_DIR/T5_ARMS_DIR/T5_SUMMARY/T5_SANDBOX_ROOT`,
   so the re-run lands in a fresh directory with its own pins.
2. **F1 (my earlier finding) is the very class t14 repairs**: the decoy arms must be re-measured —
   `F3-decoy-comment-layer` should no longer suppress the mount (a comment is not a mount) and
   `F4-decoy-disabled-row` should suppress it ONLY if the new predicate really reads a mount.
   Commands: `node t5-repro.mjs --only F3-decoy-comment-layer,F4-decoy-disabled-row` (+ the full set).
3. Gates must be re-run on the frozen revision (rows, dist-fresh, docs, pack-closure, packer).
