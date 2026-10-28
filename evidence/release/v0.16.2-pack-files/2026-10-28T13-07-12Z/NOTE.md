# v0.16.2 — packed `files` duplicate `cordis.patch.yml` (root cause + fix)

Branch: `release/v0.16.2` (tracks `origin/dev`). Packer: `scripts/pack-mpd.ts`.
Measured: 2026-10-28T13:07Z–13:09Z (UTC). Runner: `node` (packer + gates) and the PINNED
`.toolchain/node_modules/.bin/bun` 1.4.0 (`bun run …` scripts; PATH `bun` is 1.4.2).

## 1. Defect, reproduced from CURRENT source

The pre-existing artifact was packed 2026-10-28 20:10 (+08:00), i.e. AFTER the packer's own mtime
(2026-10-27 02:06) — so it was not stale. To remove all doubt the UNFIXED packer was re-run first
(`before-repack.log`, exit 0, 647 files staged) and the duplicate was still there:

```
before: files.length = 26
before: duplicates = [{ "path": "cordis.patch.yml", "count": 2, "indices": [8, 21] }]
```

## 2. Root cause

Root-cause symbol: **the `files` array literal in `writeManifest()`**, which assembles its value from
two independently derived contributors that were never required to be disjoint:

| # | Contributor | Source of truth | Emits |
|---|---|---|---|
| 1 | `patchTargets` (in `writeManifest()`) | root `package.json` → `dsh.bundle.patch` = `["./cordis.patch.yml","./presets/mpd.patch.yml"]` | `cordis.patch.yml`, `presets/mpd.patch.yml` |
| 2 | `ROOT_DECLARED.files` (in `declaredRootEntries()`) | root `package.json` → `files`, which declares the root-level entry `"cordis.patch.yml"` (no `/`, hence a ROOT FILE) | `cordis.patch.yml` **again** |

`cordis.patch.yml` therefore entered at index 8 (contributor 1) and index 21 (contributor 2).

`presets/mpd.patch.yml` escapes the same collision only by accident of SHAPE: it contains a `/`, so
`declaredRootEntries()` classifies it as neither a root file (branch `if (!entry.includes("/"))`) nor a
single-level pattern (branch `/^[^/]+\/\*\.[a-z0-9]+$/i`), and it arrives once — through
`patchTargets` alone.

The in-code comment that used to sit above the `patchTargets` spread asserted the opposite
("`cordis.patch.yml` is NOT listed separately — the main patch IS a `patchTargets` entry"). That was
true when `files` was a hand-kept list; T-35/T-70 later made `ROOT_DECLARED` feed the same array and
silently falsified it. The comment is corrected in this change.

**Why no gate caught it:** `verify:manifest` compiles the allowlist into glob matchers and asserts
admission (a duplicate admits the same path twice — still admitted), and `verify-pack-closure` compares
the artifact against its own required list and never inspects `files` for repeats. Both read the SET
semantics of `files`; neither reads its LENGTH. Cosmetic, exactly as the 0.16.1 changelog said.

## 3. Fix

`scripts/pack-mpd.ts` only (46 insertions, 4 deletions):

- NEW `dedupePackedFiles(entries: readonly string[]): string[]` — order-preserving, EXACT-STRING
  de-duplication, first occurrence wins, with a contract comment naming the two contributors above.
- `writeManifest()` now emits `files: dedupePackedFiles([ … ])`.
- The stale comment above the `patchTargets` spread is corrected.

`package.json`'s own `files` is untouched (the source of truth was never the problem).

**Why collapse instead of refusing:** both contributors share ONE intended role — admit the staged
patch file to the tarball — so this is a redundancy, not two conflicting roles for one path, and
collapsing cannot lose an admission. `files` has exactly one npm semantic, so a genuine two-role
conflict has no shape to inhabit in this derivation; a refusal branch was deliberately NOT invented.
Matching is exact-string only, so a wildcard (`packages/**`) is never treated as a duplicate of a
literal it happens to cover.

## 4. Before / after `files`

Before — 26 entries, `cordis.patch.yml` at **8** and **21**:

```
0  packages/**            9  presets/mpd.patch.yml   18 README.md
1  skills/**             10  AGENTS.md               19 README.zh-CN.md
2  presets/**            11  CHANGELOG.md            20 VENDOR_LOCK.json
3  extensions/**         12  CONTRIBUTING.md         21 cordis.patch.yml   <-- DUPLICATE
4  templates/**          13  CONTRIBUTING.zh-CN.md   22 dsh-distribution.json
5  docs/**               14  EXTENSIONS-FOR-AGENTS.md 23 dsh-plugin.json
6  agent-references/**   15  LICENSE-NOTICES.md      24 icon.svg
7  scripts/**            16  LICENSE.md              25 locale/*.json
8  cordis.patch.yml      17  PLAN.md
```

After — **25** entries, duplicate gone, `cordis.patch.yml` exactly once (index 8):

```
0  packages/**            9  presets/mpd.patch.yml   18 README.md
1  skills/**             10  AGENTS.md               19 README.zh-CN.md
2  presets/**            11  CHANGELOG.md            20 VENDOR_LOCK.json
3  extensions/**         12  CONTRIBUTING.md         21 dsh-distribution.json
4  templates/**          13  CONTRIBUTING.zh-CN.md   22 dsh-plugin.json
5  docs/**               14  EXTENSIONS-FOR-AGENTS.md 23 icon.svg
6  agent-references/**   15  LICENSE-NOTICES.md      24 locale/*.json
7  scripts/**            16  LICENSE.md
8  cordis.patch.yml      17  PLAN.md
```

Mechanical comparison (`after-files.json` vs `before-files.json`):

```
before length: 26   after length: 25
after duplicates: []
cordis.patch.yml count in after: 1
ADMISSIONS LOST:  []      ADMISSIONS ADDED: []
order preserved (dedupe-first-wins): true
```

Removing a repeated element from a set-union cannot change the union, and the gate agrees: `npm pack
--dry-run` still lists **1087** files (unchanged), 0 required paths absent.

Admission re-check (`required-paths-check.json`): 24/24 root-declared entries still admitted, both
patch targets present, `locale/*.json` still admits `en.json` + `zh.json` (both on disk in the
artifact), 19/19 required paths present — 0 absent. Packer staged the same **647** files before and
after, so no tarball content moved.

## 5. Gates (all run AFTER the fix and the re-pack)

| Gate | Command | Exit | Observed |
|---|---|---|---|
| Manifest | `.toolchain/node_modules/.bin/bun run verify:manifest` | **0** | `files-allowlist: 25 pattern(s); 0 required path(s) not admitted`; `packed-content: npm pack --dry-run lists 1087 file(s); 0 required path(s) absent`; `VERDICT: PASS` |
| Pack closure | `node scripts/verify-pack-closure.ts` | **0** | `627 file(s) compared, 627 identical, 0 drift`; completeness `523 present, 1 declared exemption(s), 0 absent`; `declared packages 30/30` |
| Dist fresh | `node scripts/verify-dist-fresh.ts` | **0** | `34/34 targets fresh (each rebuilt twice, byte-identical)`; toolchain `bun 1.4.0 from the repository toolchain` |
| Comments | `.toolchain/node_modules/.bin/bun run verify:comments` | **0** | `479 TypeScript file(s)`; `43600 declaration(s)`; `VERDICT: PASS` |
| Pack closure self-test (extra) | `node scripts/verify-pack-closure.ts --self-test` | **0** | `self-test PASS: 34/34 arms` (its fixtures mutate the packer source I edited, so this proves they still apply) |

Re-pack: `node scripts/pack-mpd.ts` → exit 0, `647 files (644: 631, 755: 16)`,
`staged 2 patch file(s): cordis.patch.yml, presets/mpd.patch.yml`.

## 6. What was NOT touched / bounds

- Only `scripts/pack-mpd.ts` is modified (`git status --untracked-files=no` → ` M scripts/pack-mpd.ts`).
  `package.json`, `dsh-plugin.json`, `dsh-distribution.json`, `docs/**`, `README*`, `AGENTS.md`,
  `CHANGELOG.md`, `skills/**`, `packages/**` — untouched. No git write command was run.
- `dist/mpd-package/**` was REGENERATED (gitignored derived output; confirmed by `git check-ignore`).
- No test file for the packer exists, so none was edited or added (the task allowed one "if one
  exists"). The dedupe is therefore proven by the re-pack + the admission diff above, not by a unit
  test. **This is the main residual bound.**
- The packer still prints its pre-existing NOTE that `ROOT_FILES` (the closure gate's presence anchor)
  omits 7 root files including `cordis.patch.yml`. That is a separate, pre-existing condition: the
  NOTE says the files ARE packed and only the gate's byte check skips them. Not in scope; unchanged.
- Version still reads `0.16.1` in all three carriers — the captain owns the 0.16.2 bump.
- Duplicate-ness of no path was left undetermined: the after-array contains zero repeats.
