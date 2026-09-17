# FINDING (t9 post-completion): the expected class does not cover the pre-existing ROOT-FILES byte rule

**Status: reported, NOT fixed** — t9 is terminal, so the change belongs to a `repair` task (the captain's
call, one writer at a time). This file is the diagnosis + the exact minimal fix + the arm.

## The red, measured (2026-09-17T07:49Z)

`node scripts/verify-pack-closure.mjs` → **exit 1**, one violation:

```
ROOT-FILE - the packed EXTENSIONS-FOR-AGENTS.md differs byte-wise from /root/dshProj/my-power-dsh/EXTENSIONS-FOR-AGENTS.md - the artifact would ship bytes no reading was taken on
```

- source: mtime `2026-09-17T07:43:40Z`, sha `a7e57dec8e8017b5`, 15,636 B; artifact: sha `5d935524b7db27ea`, 15,660 B; artifact stamp `2026-09-17T05:19:48Z`.
- writer: **t25** (lane B2, citation-checker-engineer, T-72 carry-forward — `path_owner` read), which landed at 07:43:40Z, i.e. AFTER the pack.
- the other readings are healthy: `content bytes: 1180 compared, 1160 identical, 0 drift, 20 expected-after-pack`; `completeness: 406 compared, 405 present, 1 exemption, 0 absent`.
- the original red that motivated this note cleared on its own: repo-wide `verify-dist-fresh` is exit 0 (20/20 fresh) after lane C rebuilt its dist at 07:40:20Z.

## Why this is a gap in the deliverable, not a correct red

The captain's ruling (frozen in t9's acceptance) is: *byte rules against the REAL artifact; a mid-wave drift
caused by a writer landing after the artifact's stamp is reported as an EXPECTED, PROVENANCE-NAMED reading,
never a silent pass*. My implementation routes the CONTENT sweeps (the six `ROOT_ASSET_DIRS` trees and
`packages/**`) through that classifier — but the **pre-existing** rule 5b (`REQUIRED_ROOT_FILES`,
`readFileSync(...).equals(...)`, the very idiom the acceptance told the lane to reuse) still hard-reddens for a
post-pack writer. Net effect today: the closure gate is RED for a legitimate in-flight state, the red carries
no provenance, and every lane whose verify names this gate (mine included) goes red mid-wave — the exact
outcome the ruling exists to prevent.

## The minimal fix (one writer, one change)

1. In `checkPackedHalf`, keep rule 5b's **existence** half (a packed root file that is missing stays a hard
   `ROOT-FILE` finding) and let the **byte** half be owned by `checkContentHalf` — the one place that holds
   the artifact stamp and the classification.
2. Add a third sweep to `checkContentHalf`, next to the trees and `packages/**`:
   `for (const file of REQUIRED_ROOT_FILES) if (existsSync(join(packed,file)) && existsSync(join(sourceRoot,file))) compareBytes(file, src, art, ROOT_FILE_KIND)`
   — i.e. `compareBytes` gains a `kind` parameter (`CONTENT_KIND` for the sweeps it already covers,
   `ROOT_FILE_KIND` for the named root files), so the existing arm assertions and the ROOT-FILE vocabulary
   survive while the EXPECTED class starts applying.
3. Self-test: the existing packed-root-file arms keep passing unchanged (the mutation is on the packed side
   while the source is older → still a hard finding). Add ONE arm for the closed gap: backdate the fixture
   packed tree, then write the fixture SOURCE root file → expect **exit 0 + a `CONTENT-DRIFT-EXPECTED` line
   naming it**, exactly the shape of the existing arm 17 (post-pack source writer) but for a root file.

Expected effect on the live tree: the `EXTENSIONS-FOR-AGENTS.md` violation becomes a provenance-named
EXPECTED reading (writer t25's file, its mtime, the stamp, the anchor) and the gate returns to exit 0 with
`0 drift` — while a reading taken on a root file that is NOT explained by a post-pack writer still reddens.
