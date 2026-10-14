# pack-manifest divergence — fix + pack-time arm (wave tui-015, adaptation)

**Subject:** `scripts/pack-mpd.ts` (the only source file this task changed) — sha256
`abd215c07490b3e94ae9f908a6267d8569cc9b016baa323fa3299eee0f64c2ea` (see `artifacts-sha.txt`).
**Defect:** `writeManifest()` emitted a hand-written `optionalDependencies` LITERAL that dropped three
npm packages the ROOT manifest declares and shipped rows' launchers resolve — `cclsp` (mcp-lsp),
`@cyanheads/git-mcp-server` (mcp-git) and `mcp-server-commands` (mcp-shell) — so a packed install started
the mcp-lsp row with ZERO tools. Class-(a) packaging finding, evidence-backed in `../oneclick-reds/`:
`raw/pack-vs-root-manifest.txt` (the three packages declared by the root, absent from the pack) and
`raw/local-run-matrix.json` — `H_tool_name_diff_source_vs_oneclick` reads `source_tool_count: 107`,
`oneclick_tool_count: 95`, and `only_in_source` is exactly the 12 `mcp__lsp__*` names;
`C_pre_fix_oneclick_condition_mcpCall` reads `recordedToolCount: 95, hasLsp: false, lspDependency: null`.

## 1. What changed

1. **The packed dependency fields are DERIVED, never re-typed.**
   `optionalDependencies` is now `{ ...root.optionalDependencies, ...PACK_ONLY_OPTIONAL_DEPENDENCIES }`,
   and `dependencies` is the packer's own explicit policy table `PACK_THIRD_PARTY_DEPENDENCIES`. Every
   key that legitimately differs is a NAMED, COMMENTED table entry — the packer can now only ADD to the
   root's declaration, never silently replace it. (Both tables carry their rationale in the source;
   `manifest-comparison.txt` lists every differing key and why.)

2. **A pack-time arm, `verifyLauncherDependencies(manifest)`, inside the packer.** Two closures:
   * **A — anti-rot:** every launcher module path a staged patch layer names
     (`packages/<pkg>/dist/launch.js`) must have an entry in the packer's `LAUNCHER_DEPENDENCIES` table.
     A new MCP row cannot ship with undeclared npm needs.
   * **B — the defect class:** every npm package those launchers resolve must be present in the packed
     manifest's `dependencies` ∪ `optionalDependencies`.
   It refuses a vacuous PASS (zero launchers found = FAIL "this arm is BLIND, not green").

**WHY THE PACKER, and not `verify-pack-closure.ts` / `verify-plugin-manifest.ts`:** the subject is the
DECLARATION the installer reads, and the packer is the only place that knows what it just wrote. Both
gates read the ROOT manifest and the packed TREE (`--pack` runs `npm pack --dry-run` against
`<repo>/package.json`); neither reads `dist/mpd-package/package.json`, and the closure gate's own header
classes that file as GENERATED. A dependency-set assertion belongs where the set is produced, so it runs
on every pack (including `--out` scratch packs) instead of only when a gate is invoked.
**Why a table and not a scan of the launchers:** the launchers ask for their packages INDIRECTLY
(`resolveDependencyEntry(import.meta.url, DEPENDENCY, …)`, a `SERVERS` table keyed by the row's argv word,
the shared bin-resolve tiers), so a text/AST scan cannot separate a declared dependency from a
deliberately-undeclared SUB-dependency (`typescript-language-server` arrives inside `cclsp` and must never
be declared). The table is the declaration; closure A is what stops it rotting.

## 2. Red/green controls (the arm can FAIL)

`bash controls.sh` — mutates ONE input, runs the REAL packer, restores the input, asserts the restore by
sha256 (`inputs-sha-before.txt` == `inputs-sha-after.txt`). No gate or test was edited to obtain a pass.

| Control | Mutation (`control-*.mutation.diff`) | Observed |
|---|---|---|
| **C1** `control-C1-red-cclsp-not-declared.log` | drop `cclsp` from the ROOT manifest's `optionalDependencies` (the defect class) | `exit=1` — `FAIL: the shipped row launcher packages/mpd-mcp-lsp/dist/launch.js resolves cclsp at start-up, but the packed manifest declares it in neither dependencies nor optionalDependencies …` |
| **C2** `control-C2-red-pack-only-key-dropped.log` | drop `"@ast-grep/cli": "0.45.2"` from `PACK_ONLY_OPTIONAL_DEPENDENCIES` | `exit=1` — same message for `@ast-grep/cli` via `packages/mpd-mcp-astgrep/dist/launch.js` (the policy overlay is load-bearing) |
| **C3** `control-C3-red-launcher-unknown.log` | drop the `mpd-mcp-codegraph` row from `LAUNCHER_DEPENDENCIES` | `exit=1` — `FAIL: the staged patch layers mount packages/mpd-mcp-codegraph/dist/launch.js and LAUNCHER_DEPENDENCIES has no entry for it` (closure A) |
| **GREEN** `control-green-none.log` (= `pack.log`) | none | `exit=0` — `[pack-mpd] launcher dependencies: 4 shipped launcher(s) resolve 5 npm package(s), every one declared in the packed manifest` |

## 3. Re-pack + gates (final revision, all logs in this directory)

| Command | Exit | Observed |
|---|---|---|
| `node scripts/pack-mpd.ts` (`pack.log`) | 0 | 618 files staged (644: 602, 755: 16); `launcher dependencies: 4 shipped launcher(s) resolve 5 npm package(s), every one declared` |
| `node scripts/verify-pack-closure.ts` (`verify-pack-closure.log`) | 0 | 23 `dist/index.js` rows + 4 mcp rows resolve; 24 `PLUGIN_PKGS` + 4 `MCP_PKGS` present; 475 asset files; **content bytes 606 compared / 606 identical / 0 drift / 0 expected-after-pack**; completeness 507 declared / 506 present / 1 declared exemption / 0 absent; **pack stamp `2026-10-14T16:07:50.348Z`** |
| `node scripts/verify-pack-closure.ts --self-test` (`verify-pack-closure-selftest.log`) | 0 | `self-test PASS: 34/34 arms` (the gate this task cites still passes its own fixtures, negative controls included) |
| `bun run verify:manifest` (`verify-manifest.log`) | 0 | `VERDICT: PASS` — 9 declared dependency names, 25 `files` patterns, `npm pack --dry-run` lists 982 files, 0 required paths absent |
| `node scripts/verify-comment-coverage.ts` (`verify-comments.log`) | 0 | `VERDICT: PASS` — 403 files, 35658 declarations |
| `bun run typecheck` (`typecheck.log`) | 0 | `tsgo --noEmit` clean |
| BEFORE, for contrast: `git show HEAD:scripts/pack-mpd.ts` → `node scripts/_tmp-before-pack-mpd.ts --out dist/_scratch-pack-before` (`before-pack.log`, packer sha in `before-packer-sha.txt`) | 0 | reproduces the buggy manifest: `optionalDependencies` = the 3-key literal |

**Before/after, the three dropped packages** (`manifest-before.json` / `manifest-after.json` /
`manifest-comparison.txt`):

```
BEFORE optionalDependencies = @ast-grep/cli 0.45.2, @colbymchenry/codegraph 1.5.0, @code-yeongyu/comment-checker 0.8.0
AFTER  optionalDependencies = @colbymchenry/codegraph 1.5.0, cclsp 0.7.0, @cyanheads/git-mcp-server 2.15.3,
                              mcp-server-commands 0.8.2, @ast-grep/cli 0.45.2, @code-yeongyu/comment-checker 0.8.0
```

## 4. Honest bounds — what is NOT proven here

* **No re-install was run.** This is a declaration fix; the runtime proof (the mcp-lsp row's 12 tools
  actually registering in a packed install) is the Docker oneclick lane, which this task did NOT run
  (the captain's lane, and `verify:docker` needs a rootless daemon). The arm proves the DECLARATION, not
  that npm resolves it in a consumer profile. Note that the wave's own `E_post_fix_*` reading
  (`recordedToolCount: 107, hasLsp: true`) was produced by the QA lane staging `cclsp` into a SANDBOX
  pack copy — it does not measure this packer change on the canonical artifact.
* **The arm reads the packed patch TEXT**, so "shipped row" means "a patch layer staged by this packer
  names that launcher", not "a row the loader will mount" — a `disabled: true` row counts on purpose
  (mcp-git/mcp-shell are `disabled: true` and the user enables them with `disabled: false`).
* **`inputs-sha-*.txt` prove the controls restored their inputs**, not that the working tree is clean of
  other waves' edits (`skills/dsh-qa/**` and other `evidence/**` were already dirty when this task
  started and were not touched here).
* **A FAIL aborts mid-pack**, so a red run has already re-staged its `--out` target. The canonical
  `dist/mpd-package/` is only trustworthy when the packer exits 0 (all controls used scratch `--out`
  directories; the six scratch trees — C1/C2/C3, the arm smoke run, the first hand-run control and
  `dist/_scratch-pack-before` — were removed afterwards).
* The arm asserts against `dependencies` + `optionalDependencies` only — the two fields the packed
  manifest writes. A future declaration through `peerDependencies` would not be seen.

## 5. Evidence index

`pack-mpd.diff` (the whole change) · `controls.sh` (the repro driver) · `control-C{1,2,3}-red-*.log` +
`.mutation.diff` (red) · `control-green-none.log` / `pack.log` (green) · `pack.log`,
`verify-pack-closure.log`, `verify-pack-closure-selftest.log`, `verify-manifest.log`,
`verify-comments.log`, `typecheck.log` · `before-pack.log`, `before-packer-sha.txt`,
`manifest-before.json`, `manifest-after.json`, `manifest-comparison.txt` · `inputs-sha-*.txt`,
`artifacts-sha.txt`.
