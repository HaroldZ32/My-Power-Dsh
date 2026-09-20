# DISCARDED pass — harness bug (verifier's own), not a finding about the fix

**Run dir:** `evidence/install-deps/verification/20260920T034229Z/` (pass 1)
**Status:** INVALID for any claim about the bundle. Kept only for audit.

## What went wrong

The verifier harness resolved the bundle root one directory too shallow:

```
const REPO = resolve(HERE, "../../..")     // WRONG -> <repo>/evidence
const REPO = resolve(HERE, "../../../..")  // correct -> <repo>
```

HERE is `evidence/install-deps/verification/<ts>`, i.e. **four** levels below the repo root.

## Measured consequence (pass-1 `arms/A0-real-plugin-add.json`)

* `dsh plugin --profile w add <repo>/evidence` recorded `dependencies: {"evidence": "link:…/evidence"}`
  — `<repo>/evidence` has no `package.json`, so no bundle manifest was added at all;
* `dsh.profile.bundles` stayed `[base, web-app]` — the mpd bundle was never a layer;
* composition `rows = 0`, `GET /sidebar/api -> 404`, no sidebar client served, boot healthy.

That is a faithful measurement of *a profile with no mpd bundle in it* — which is exactly what the
bug produced — and therefore says **nothing** about the fix. It is not a RED result either: the
captain's real pre-fix baseline (`evidence/install-deps/red-baseline/20260920T030832Z/`) is the RED
anchor.

## Repair

Both verifier scripts now resolve FOUR levels and ASSERT the resolved root is the bundle manifest:

```
if (manifest.name !== "@mpd-dsh/mpd") throw new Error("REPO does not resolve to the @mpd-dsh/mpd bundle root")
```

Pass 2 was run in a fresh directory (`verification/<ts>/`, timestamp recorded in `result.json`).
