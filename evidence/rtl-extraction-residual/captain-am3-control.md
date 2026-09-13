# Captain verification — the AM3 control that the X8 sweep did not run

**Author**: captain · **Date**: 2026-09-13 · **Pin**: HEAD `32ae54dd` (branch `dev`) ·
**Subject**: `skills/dsh-qa/scripts/team-route-rewire.mjs` (x2 v2 AM3: a present-but-broken
prerequisite is always a FAIL)

## 1. Why this file exists

The X8 verification gate (t33) failed itself deliberately: all ten standing gates were green, but
four obligations were not independently discharged — one of them being the AM1–AM7 anti-mask
matrix **including the present-but-broken-pack control**. The Reviewer stated plainly that its
sweep replicated only the pack-*present* side. Rather than leave that gap in the ledger, the
captain ran the control directly. It found a real defect.

## 2. The defect (measured, both cases)

Method: `dist/mpd-package` replaced by a directory containing only `package.json` with the text
`name: broken` (i.e. PRESENT but not a usable bundle), then each case's `--self-test` run.

| case | exit | markers | verdict |
|---|---|---|---|
| `relocate-smoke.mjs --self-test` | **1** | 0 SKIP | correct (its staged-pack path-clean assertion fires) |
| `team-route-rewire.mjs --self-test` | **0** | 0 SKIP | **DEFECT — false green on a broken pack** |

The rewire case printed `[team-route-rewire self-test] ok: 12 checks + staged bundle present`. Root
cause: its check list contained **no pack assertion at all** — the "staged bundle present" claim in
the success line rested on the same bare `existsSync(dist/mpd-package/package.json)` that the skip
gate uses, and the real `dsh plugin add` lane that would actually consume the pack lives in
`runReal()` (which `--self-test` never runs). The assertion was therefore vacuous: the word
"present" did all the work, and "usable" was never tested. This is the wave's own
"cannot-fail" family, in the one place where the offline lane genuinely cannot run the real flow.

## 3. The fix

`team-route-rewire.mjs` gained `packUsable()`, which runs inside `selfTest()` at the position where
the vacuous claim stood, and asserts what an offline lane honestly can:

- `package.json` parses as JSON;
- its `name` is `@mpd-dsh/mpd` (the identity the bundle patch rows resolve against);
- `dist/mpd-package/cordis.patch.yml` exists AND carries the `mpd-web-compat` row (the client entry
  the bundle needs);
- `dist/mpd-package/packages/mpd-bundle-plugin/client.js` exists.

The success line now reads `ok: 13 checks; staged pack usable` (was `12 checks + staged bundle
present`), and a failure prints the specific reason before the check-list FAIL line.

## 4. Proof of the fix (both directions, child-process exit codes)

```
# broken pack (the previously-false-green input)
$ bun skills/dsh-qa/scripts/team-route-rewire.mjs --self-test
exit=1
[team-route-rewire] staged pack unusable: package.json is not valid JSON: JSON Parse error: Unexpected identifier "name"
[team-route-rewire self-test] FAIL: staged pack present and usable (AM3)

# real pack (regression direction)
$ bun skills/dsh-qa/scripts/team-route-rewire.mjs --self-test
[team-route-rewire self-test] ok: 13 checks; staged pack usable
exit=0
```

`dist/mpd-package` was restored byte-identically after every aside/seed step:
`package.json` sha256 `f8c94451d01e3156…` (unchanged from the value the X7 lane recorded).

## 5. Consequence for the corpus pin

This edit is a `skills/**` change, so it invalidated the corpus `treeSha` and required one more
re-pin — per AGENTS.md §9/§11 the re-pin rides in the same commit as the change:

- two-case state `36afa7e2…` (superseded) → three-case state `bb52bff419…` (superseded) →
  **final `afe718251965a933b6a15b40bbe6ebf2e5222996fecb48b05fc8e770e390fcad`**, `fileCount 328`.
- `node scripts/verify-vendor.mjs` → **PASS, exit 0** (`asset OK: skills 328 files`).

**A measurement error of my own, recorded because it is instructive:** I first recomputed the
`treeSha` with the right file set and the right per-file hashing but the WRONG aggregation order
(walking to absolute paths and hashing in walk order instead of the gate's relative-path sort
before joining). The gate caught it (`FAIL - asset skills treeSha mismatch`) rather than accepting
a plausible-looking value. The gate's own rule, quoted from `scripts/verify-vendor.mjs:106-114`:
`files2 = files.map(f => f.slice(dir.length + 1)).sort()`, then per file
`h.update(f + "\n" + sha256(readBytes(join(dir, f))) + "\n")`. Lesson worth keeping: **recompute a
fingerprint with the gate's own algorithm or not at all** — a hand-rolled variant produces a
different but equally authoritative-looking hex string.

## 6. Status of the four X8 gaps after this note

| X8 obligation | status |
|---|---|
| X7 fresh-clone lane (3 SKIP lines) | **verified by the captain**: pack absent → `bun run test:qa` exit 0 with exactly 3 canonical SKIP markers; pack present → exit 0, 0 SKIP |
| X7 AM1–AM7 matrix incl. broken-pack control | **discharged by this note** (broken pack → exit 1 in every case; the rewire defect it exposed is fixed and re-proven) |
| X6 EN/zh sentence-by-sentence 1:1 | verified at the level of the zero-grep + the ten-file apply table in `x6-declaration/report.md`; a full per-sentence map remains the Reviewer's stronger form and is NOT claimed here |
| X4 end-to-end guard run | pure-function proof (7/7) stands; the real-rebuild path is exercised by the build/gate runs, and a real rebuild needs the upstream checkout — NOT claimed as an end-to-end run |
| t27 `bun install --frozen-lockfile` | **re-measured by the captain**: exit 0 (`Checked 31 installs across 48 packages (no changes)`); the read-only-tempdir limitation and its workspace-scoped workaround are in the X5 report |
