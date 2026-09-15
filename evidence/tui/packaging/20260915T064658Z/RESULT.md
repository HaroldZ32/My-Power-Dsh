# t25 — packed-tree asset closure repaired and verified (result)

Repair, Deep Worker attempt 2 (`4dcafde2-…`). inScope: `scripts/pack-mpd.mjs`, `evidence/tui/packaging/`.
Two coupled defects of one class — **the release step exits 0 while the packed tree is missing files a
mounted row needs at runtime** — both closed, both verified by running the real release step and a
real import check against the PACKED tree.

## 1. Provenance of the TUI-asset table (recorded under THIS task)

The per-package asset table in `cpAssets()` (copies `mpd-tui-plugin/{themes,skills}` and FAILS loudly
when a source directory is missing) was authored by this worker during the discovery pass and was an
**unowned edit**; it is now recorded under t25, and pack's own `cpDist()` blind spot is named in the
file (`cpDist()` ships `packages/<pkg>/dist` only, so a package's sibling asset dirs never ship,
which is invisible in a checkout install and invisible to R11, whose class check only looks at
`packages/<pkg>/dist/index.js`).

Verified by the real release step (`raw/pack-run.log`, exit 0) — the packed tree now contains:

```
packages/mpd-tui-plugin/dist/index.js
packages/mpd-tui-plugin/README.md
packages/mpd-tui-plugin/README.zh-CN.md
packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md
packages/mpd-tui-plugin/themes/mpd-tui.json
```

## 2. MCP launcher closure — closed across ALL MCP packages, not just the measured one

The old block hard-coded two launchers and copied only `launch.mjs`. It is replaced by a **closure
walk**: for every MCP package the patch mounts, a launcher's statically imported *relative* modules
are copied recursively, with a hard FAIL when a specifier does not resolve in the source tree, when
it escapes `packages/`, or when a mounted module is missing. Licence/notice files
(`LICENSE`, `NODE-RUNTIME-LICENSES.md`, `NOTICE`) travel with the package that vendors a binary, and
a **positive check against the patch text** asserts every `packages/<pkg>/{launch.mjs,dist/*.js}`
path a mounted row executes exists in the packed tree.

Measured instance closed: `packages/mpd-mcp-codegraph/launch.mjs:36` imports `./daemon-policy.mjs`,
which the packed tree lacked (`raw/pack-run.log` shows the same pack run now staging 1122 files vs
1118 before — `daemon-policy.mjs` + the three licence files). No MCP package has an unresolved
launcher import any more (checked exhaustively: `pieces with an unresolved launcher import: none`).

## 3. REAL import check against the PACKED tree (`raw/packed-import-check.log`)

| Command (exact) | Exit |
|---|---|
| `timeout 25 node --input-type=module -e "await import('<packed>/packages/mpd-mcp-astgrep/launch.mjs')" < /dev/null` | **0** |
| `timeout 25 node --input-type=module -e "await import('<packed>/packages/mpd-mcp-codegraph/launch.mjs')" < /dev/null` | **0** (emits only its intended in-process policy line) |

Second, deterministic layer (`raw/closure-and-licences.log`): resolving every packed launcher's
relative specifiers against the packed tree → `unresolved specifiers: 0`, exit 0.

**Falsifiability (`raw/negative-control-import.log`)** — the SAME command, same launcher, closure
broken exactly as it was pre-fix: complete closure → exit 0; after `rm daemon-policy.mjs` →
`ERR_MODULE_NOT_FOUND`, exit 1. So the check can fail; it is not vacuously green.
`raw/negative-control-guards.log` records that all five loud-FAIL branches are still present in the
script.

## 4. Licensing completeness

`LICENSE`, `NODE-RUNTIME-LICENSES.md`, `NOTICE` are all present in
`dist/mpd-package/packages/mpd-mcp-codegraph/` (`raw/packed-tree-listing.txt`,
`raw/closure-and-licences.log`).

## 5. Patch decoupling and gates

- `dist/mpd-package/cordis.patch.yml:301` still carries
  `name: '@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js'`; **0** absolute dev paths in the
  packed patch (`raw/patch-and-residue.log`).
- `node scripts/verify-rows-parity.mjs` → exit 0, `24 row ids match … mpd-tui …`.
- `raw/pack-run.log` records `node --check scripts/pack-mpd.mjs` (exit 0) and the pack run (exit 0).

## 6. Evidence, residue, scope

`raw/` holds: `pack-run.log`, `packed-tree-listing.txt`, `packed-import-check.log`,
`closure-and-licences.log`, `patch-and-residue.log`, `negative-control-import.log`,
`negative-control-guards.log`, `pack-mpd-diff.log` (4 hunks: the Lead's `PLUGIN_PKGS` entry at
`@@ -41,4`, the line-number shift at `@@ -6,5`, and this worker's two `cpAssets()` hunks at
`@@ -106` / `@@ -114`). `dist/mpd-package/` stays gitignored (`git check-ignore` confirms;
`git status --short dist` is empty), so the release step leaves no commit residue. Only the two
inScope paths were written; no `packages/`, `skills/` or other `scripts/` file was touched.

**Still not claimed by this task:** the packed patch's *content* correctness for rows this task did
not mount (e.g. whether the packed `dist/cli.js` builds are current) — out of t25's scope, and the
gates above only prove presence/decoupling.
