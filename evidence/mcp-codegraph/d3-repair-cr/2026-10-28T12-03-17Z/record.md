# Repair — CodeRabbit's three findings on the D-3 resolver (PR #76)

Task T8. The findings are quoted verbatim in `findings/coderabbit-pr76-quoted.txt` and are treated as
UNTRUSTED review data: every one was re-checked against the current code before anything was changed.
Each verdict below names the arm or test that now holds it.

| # | Severity | Finding | Verdict |
|---|---|---|---|
| 1 | Minor | Windows: probe `node.exe` **and** the app entry `lib/dist/bin/codegraph.js` | **FIXED** |
| 2 | Minor | The complete-install fixture creates only `bin/codegraph`, which is not the win32 launcher | **FIXED** |
| 3 | Major | Anchor the platform-bundle probe at the `.bin` link target | **FIXED** |

## 1 — win32 needs both files (FIXED)

Upstream's `npm-shim.js` (v1.5.0, the file the finding cites) resolves **both** `pkg + '/node.exe'` and
`pkg + '/lib/dist/bin/codegraph.js'` before it spawns the bundled app; a package carrying only one of
them cannot start. The probe asked for `node.exe` alone, so a half-installed Windows bundle would have
been accepted — the exact failure class this predicate exists to prevent (a pin that cannot serve).

`packages/mpd-mcp-shared/bin-resolve.ts` → `hasCodegraphPlatformBundle` now requires EVERY item of a
per-platform list to resolve:

- POSIX: `<pkg>/bin/codegraph` (unchanged, as the finding asked).
- win32: `<pkg>/node.exe` **and** `<pkg>/lib/dist/bin/codegraph.js`.

Proof (`packages/mpd-mcp-shared/bin-resolve.test.ts`, arm "win32 needs BOTH the runtime and the app
entry"): runtime only → `false`; app entry only → `false`; both → `true`. The specifier-grammar arm
asserts the exact order asked, so a future edit cannot silently drop one back to a single check.

**Bound:** there is no Windows host in this session, so the win32 branch is measured by those unit arms
plus the upstream behaviour the finding cites — not by a live Windows launcher start. The app entry's
presence in the published 1.5.0 layout IS measured on this host
(`…/@colbymchenry/codegraph-linux-x64/lib/dist/bin/codegraph.js`, 114680 B), which is the same file
path the shim resolves on win32.

## 2 — the fixture's launcher shape (FIXED)

The complete-install fixture created `bin/codegraph` unconditionally, so on a Windows host the
predicate would look for `node.exe`, find nothing, and the arm would fail there (the resolver asks a
platform-specific question; the fixture answered a POSIX one).

The test file now has one `platformLauncherFiles(platform)` / `touchPlatformLaunchers(dir, platform)`
pair — `["node.exe", "lib/dist/bin/codegraph.js"]` on win32, `["bin/codegraph"]` elsewhere — and BOTH the
complete-install state and the unhoisted-layout arm build their platform package through it. The arm is
therefore platform-correct on Linux, macOS and Windows from one fixture.

## 3 — anchor the probe at the `.bin` link target (FIXED)

`createRequire(resolve(shimPath))` starts at the **`.bin` directory**, not at what that link points to.
npm's hoisted layout hides the difference, but in the `nested`/`linked` unhoisted layouts the platform
package lives under the TARGET package's own `node_modules`, where an unanchored search never looks —
so a usable shim could be rejected, and with no later tier passing the resolver would return `null`
(a silent loss, which is the same class as the bug D-3 fixed, mirrored).

`hasCodegraphPlatformBundle` now anchors the search at `realpathIfPossible(shimPath)` (default
`fs.realpathSync`, injectable as `PlatformBundleOptions.anchor`). That is also the question the shim
itself asks: Node resolves a required module by its real path, so the shim's own `require.resolve` runs
from the real location regardless of how it was invoked.

Proof, two-sided:

- Unit arm "the `.bin` symlink is anchored at its REAL location (nested layout)": a temp tree whose
  `.bin/codegraph` links into `vendor/…/codegraph/npm-shim.js` and whose platform package sits under the
  target package's `node_modules` — default (anchored) → `true`; the SAME inputs with the identity
  anchor (`anchor: (p) => p`, i.e. search from `.bin`) → `false`. The arm is falsifiable in both
  directions, which is what the finding asked for.
- Function-level arm against a REAL unhoisted install (`arms/nested-anchor-function.txt`): a real
  1.5.0 `npm-shim.js` copied into `vendor/`, the real 281 MB platform bundle nested under it, and
  `node_modules/.bin/codegraph` symlinked to the shim → `anchored (default, realpath): true`,
  `unanchored (identity anchor): false`, with the link target printed.
- Capability preserved end to end in that layout: `arms/nested-d3.txt` and `arms/nested-repaired.txt`
  both answer `tools/list` with `codegraph_explore` (1 tool). **Which tier served was NOT attributed in
  those two runs** (the adopted chain has its own bundled/provisioned/PATH/download fallbacks), so they
  are recorded as "the capability still works in an unhoisted layout", never as proof of finding 3 — the
  proofs are the two arms above.

## Regression set (repaired launcher, `arms/`)

| Arm | Result |
|---|---|
| `armA-incomplete-pin` (shim without its platform bundle, pinned) | `TOOLS=0`, upstream's "no prebuilt bundle" message in the sink |
| `armB-complete-pin` (complete shim, pinned) | `TOOLS=1`, `codegraph_explore` |
| `armC-checkout-no-pin` (the real checkout tree, no env pin) | `TOOLS=1`, `codegraph_explore` |

## Fan-out (the shared resolver is inlined into three built launchers)

Rebuilt with the pinned toolchain from the repo root
(`.toolchain/node_modules/.bin/bun build <src> --target node --format esm --outfile <dist>`):
`packages/mpd-mcp-codegraph/dist/launch.js`, `packages/mpd-mcp-astgrep/dist/launch.js`,
`packages/mpd-mcp-astgrep/dist/cli.js`.

**This repair DOES change the two ast-grep targets — by exactly one line each**, unlike the D-3 change
which they absorbed byte-identically:

```
-import { existsSync, readFileSync } from "node:fs";
+import { existsSync, readFileSync, realpathSync } from "node:fs";
```

`realpathSync` is tree-shaken out of ast-grep's emitted code (ast-grep never calls the codegraph
predicate), so its behaviour is unchanged; only the shared module's import statement travels. Recorded
rather than glossed, because "byte-identical" was true last time and is not true now.

## Gates (logs in `gates/`, all exit 0)

| Gate | Observed |
|---|---|
| `bun test packages/mpd-mcp-shared` | 32 pass, 0 fail |
| `bun test packages/mpd-mcp-codegraph packages/mpd-mcp-astgrep` | 39 pass, 0 fail |
| `bun test packages/mpd-mcp-lsp packages/mpd-mcp-gitbash` | 33 pass, 0 fail |
| `bun test packages/mpd-dsh-adapter-plugin/test/cross-package-coupling-inventory.test.ts` | 2 pass, 0 fail |
| `bun run typecheck` | exit 0 |
| `bun run verify:comments` | PASS (479 files, 43597 declarations) |
| `bun run verify:docs` | PASS (pairs=52, dead=0) — both `packages/mpd-mcp-codegraph/README*.md` updated together |
| `node scripts/verify-dist-fresh.ts` | ok: 34/34 targets fresh (pinned bun 1.4.0) |

`verify:comments` caught one real defect of mine on the way: a curried arrow in the new arm had no
explicit return type (`bin-resolve.test.ts`, the `only(...)` helper). Fixed by typing the outer arrow,
then the gate is green — noted because a repair that hides its own rework is not auditable.

## Bounds

1. No Windows host: finding 1 is proved by unit arms + upstream's own two-file requirement, not by a
   Windows launcher start.
2. Which fallback tier served the two launcher-level unhoisted runs is not attributed (see above).
3. No Docker lane was run for this repair; the release sweep's `--mode source` run exercises the same
   resolver code path on the checkout tree.
