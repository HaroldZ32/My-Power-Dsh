# Packaging consequence of the `mpd-tui` row — verified by running pack

Ordered by the captain's correction message: `scripts/pack-mpd.mjs` is this worker's file alone;
the composition change and its packaging consequence must land as one change. This pass therefore
(i) verified the `PLUGIN_PKGS` entry, (ii) found and fixed the SECOND consequence nobody had
covered — the package's non-`dist` assets — and (iii) audited the whole packed tree for the same
defect class, which turned up one further, PRE-EXISTING, measured defect that is **not** part of
this change.

## 1. `PLUGIN_PKGS` — verified present (not written by me)

`scripts/pack-mpd.mjs:51` lists `"mpd-tui-plugin"` with the class comment. It was already there when
this pass started (added by the plan-amendment writer the earlier message credits); I did not add
it and I have not rewritten that entry. `R11` (the class gate) exits 0:
`R11 ok: 16 patch rows present in pack-mpd PLUGIN_PKGS` (`…/20260915T061519Z/raw/gate-AB.log`).

## 2. FIXED HERE — the package's non-`dist` assets were still dropped

`cpDist()` ships `packages/<pkg>/dist` only, so `themes/` and `skills/` never reached the packed
tree. That is invisible in a checkout install (which reads the repo directly), which is exactly why
this class needs a named entry — and `R11` cannot see it, because R11 only checks
`packages/<pkg>/dist/index.js` rows.

Fix (in `cpAssets()`, following the file's existing per-package-asset convention — the same shape as
the `mpd-roles-plugin/personas` and `mpd-agent-teams-plugin` copies): a small table copies
`mpd-tui-plugin/{themes,skills}` and **fails loudly** if either source directory is missing, so a
future rename cannot silently re-open the hole. `raw/pack-mpd-diff-and-decoupling.log` carries the
diff.

Verified by running the real release step (`node scripts/pack-mpd.mjs`, exit 0 —
`raw/pack-run.log`); the packed tree now contains (`raw/packed-tree-tui-plugin.txt`):

```
dist/mpd-package/packages/mpd-tui-plugin/dist/index.js
dist/mpd-package/packages/mpd-tui-plugin/README.md
dist/mpd-package/packages/mpd-tui-plugin/README.zh-CN.md
dist/mpd-package/packages/mpd-tui-plugin/skills/mpd-tui/SKILL.md
dist/mpd-package/packages/mpd-tui-plugin/themes/mpd-tui.json
```

The packed patch still decouples correctly: `dist/mpd-package/cordis.patch.yml:294-295` carries the
`mpd-tui` row as `name: '@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js'`, with **0** absolute
dev paths anywhere in the packed patch (`raw/pack-mpd-diff-and-decoupling.log`).
`dist/mpd-package/` is gitignored, so the release step leaves no commit residue.

## 3. FOUND HERE, NOT FIXED — a pre-existing defect of the same class (needs an owner)

The packed tree is missing `packages/mpd-mcp-codegraph/daemon-policy.mjs`, which the launcher the
bundle patch actually runs imports statically:

```
launch.mjs:36  import { applyDaemonPolicy } from "./daemon-policy.mjs"
```

Measured on the freshly packed tree (`raw/packed-codegraph-launcher-import.log`):

```
IMPORT FAILED: ERR_MODULE_NOT_FOUND Cannot find module
  '…/dist/mpd-package/packages/mpd-mcp-codegraph/daemon-policy.mjs'
  imported from '…/dist/mpd-package/packages/mpd-mcp-codegraph/launch.mjs'
```

Consequence: in a **packed** install the `mcp-codegraph` row cannot start, while
`node scripts/pack-mpd.mjs` still exits 0 — the exact failure mode `pack-mpd.mjs`'s own comments
record for `mpd-team-compact-plugin`/`mpd-ext-plugin`. Same entry, also not shipping:
`packages/mpd-mcp-codegraph/{LICENSE,NODE-RUNTIME-LICENSES.md,NOTICE}` (a licensing-completeness
gap for a package that vendors a third-party binary; lower severity than the import failure).

The one-line shape that would close it, inside the existing `cpAssets()` MCP copy loop:

```js
cpSync(join(repoRoot, "packages", p, "launch.mjs"), join(outDir, "packages", p, "launch.mjs"))
// + daemon-policy.mjs (+ the LICENSE/NOTICE pair) for mpd-mcp-codegraph
```

I did **not** apply it: `mpd-mcp-codegraph` is not part of this composition change, and un-owned
edits are how this team produced its earlier races. Reported for an owner instead.

## 4. Audited and BY DESIGN (so nobody re-chases them)

`raw/packed-vs-source-assets.txt` is the full packed-vs-source asset diff. Besides the two items
above, everything it lists is intentional:

- **per-package `package.json`** — absent for every plugin package in the packed tree; rows resolve
  through the ROOT packed manifest's `"./packages/*"` export, and the root declares
  `"type": "module"`, so no sub-package manifest is needed.
- **`packages/mpd-bundle/{cordis.patch.yml,README*.md}`** — the patch ships as
  `<outDir>/cordis.patch.yml` and the root README pair ships at `<outDir>/`, by design.
- **`packages/mpd-qa-roles-probe/**`** — QA-only, mounted by an overlay, deliberately never shipped.
- **`packages/mpd-mcp-shared/bin-resolve.test.mjs`** — deliberately filtered dev test.
- **`packages/mpd-mcp-lsp/overlay/**`** — build-time input only (`scripts/build-mcp.mjs:34`), not a
  runtime asset.

## 5. Gates re-run in this pass

| Gate | Result |
|---|---|
| `node scripts/pack-mpd.mjs` (the release step; nothing else runs it) | exit 0, packed tree verified (`raw/pack-run.log`) |
| `node scripts/verify-rows-parity.mjs` | exit 0, 24 ids (`…/20260915T061519Z/raw/gate-rows-parity.log`) |
| R11 (`PLUGIN_PKGS` class gate) | exit 0, 16 patch rows present (`…/20260915T061519Z/raw/gate-AB.log`) |
