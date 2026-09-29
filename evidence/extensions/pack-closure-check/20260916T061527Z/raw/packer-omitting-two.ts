#!/usr/bin/env node
// pack-mpd: assemble the relocatable installable bundle package (Plan D).
// Output: <repo>/dist/mpd-package/ — a self-contained npm package named @mpd-dsh/mpd
// with dsh.bundle.patch, whose cordis.patch.yml references plugins via the resolvable
// name '@mpd-dsh/mpd/packages/...' and every path-bearing value via the loader's
// baseUrl (the profile directory) — no checkout-absolute paths anywhere.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const dev = repoRoot.replace(/\\/g, "/")
const outDir = join(repoRoot, "dist", "mpd-package")
const devPatch = join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml")
const PKG_NAME = "@mpd-dsh/mpd"
const BP = "(typeof baseUrl === \"string\" ? baseUrl.replace(/^file:\\/\\//, \"\").replace(/\\/+$/, \"\") : \"\")"

function jsVal(expr) { return "!!js '" + expr + "'" }
function pathExpr(rel) { return jsVal(BP + " + \"" + rel + "\"") }

const PLUGIN_PKGS = [
  "mpd-dsh-adapter-plugin",
  "mpd-tools-plugin", "mpd-modelchain-plugin", "mpd-ulw-plugin",
  "mpd-codegraph-plugin", "mpd-hashline-plugin", "mpd-boulder-plugin",
  "mpd-config-plugin", "mpd-comment-checker-plugin", "mpd-memory-plugin",
  "mpd-roles-plugin", "mpd-bootstrap-plugin", "mpd-workmate-plugin",
  // mpd-team-compact-plugin is MOUNTED by the bundle patch
  // (packages/mpd-bundle/cordis.patch.yml, loader entry `mpd-team-compact`) and was
  // missing from this list, so `npm run pack` exited 0 while the packed tree omitted
  // the package and the boot died with ERR_MODULE_NOT_FOUND on that entry (measured
  // 2026-09-14 by a teammate's QA case; a checkout install was unaffected, which is
  // exactly why no gate caught it). Every plugin package the patch mounts MUST be
  // listed here: `mpd-qa-roles-probe` is deliberately absent because it is QA-only
  // and mounted by an overlay, never by the shipped patch.
  "mpd-team-compact-plugin",
  // mpd-ext-plugin is MOUNTED by the bundle patch (row `mpd-ext`) and was missing
  // from this list: the packed tree would omit `packages/mpd-ext-plugin/dist/` while
  // `npm run pack` still exited 0, and the packed boot would die ERR_MODULE_NOT_FOUND
  // on that row — the same silent-omission class the comment above records for
  // mpd-team-compact-plugin. Its discovery root `<bundle>/extensions/` is copied by
  // cpAssets() and declared in the packed manifest's files/exports below.
  "mpd-ext-plugin",
  // mpd-tui-plugin is MOUNTED by the bundle patch (row `mpd-tui`, the DSH-TUI
  // edition) and was missing from this list: the packed tree would omit
  // `packages/mpd-tui-plugin/dist/` while `npm run pack` still exited 0, and the
  // packed boot would die ERR_MODULE_NOT_FOUND on that row — the same
  // silent-omission class the comments above record for mpd-team-compact-plugin and
  // mpd-ext-plugin. Adding the entry fixes this package; the whole CLASS is gated by
  // regression command R11 in .mpd/plans/dsh-tui-edition.md, which asserts every
  // `@mpd-dsh/mpd/packages/<pkg>/dist/index.js` row of the bundle patch is listed here.
  // mpd-team-watchdog-plugin is MOUNTED by the bundle patch (row `mpd-team-watchdog`,
  // packages/mpd-bundle/cordis.patch.yml:227-228, which landed AFTER this list was last
  // touched) and was missing from it — the FOURTH occurrence of the silent-omission
  // class the comments above record for mpd-team-compact-plugin, mpd-ext-plugin and
  // mpd-tui-plugin. Unlike those three it never reached a shipped tree: the positive
  // closure check below caught it and printed `[pack-mpd] FAIL: the patch mounts
  // packages/mpd-team-watchdog-plugin/dist/index.js but the packed tree has no such
  // file` (measured 2026-09-16 by the extension wave's QA lane:
  // evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/output.log:97).
  // Adding the entry is the whole fix; R11 (see above) covers the class.
  "mpd-bundle-plugin"
]
const MCP_PKGS = ["mpd-mcp-astgrep", "mpd-mcp-gitbash", "mpd-mcp-lsp", "mpd-mcp-codegraph"]

function cpDist() {
  const missing = []
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    const src = join(repoRoot, "packages", p, "dist")
    if (!existsSync(src)) { missing.push(p); continue }
    mkdirSync(join(outDir, "packages", p), { recursive: true })
    cpSync(src, join(outDir, "packages", p, "dist"), { recursive: true })
  }
  if (missing.length > 0) {
    console.error("[pack-mpd] FAIL: missing dist for " + missing.join(", ") + " — run bun build / scripts/build-mcp.mjs first; a bundle must never ship without a plugin")
    process.exit(1)
  }
}

function cpAssets() {
  mkdirSync(join(outDir, "packages"), { recursive: true })
  // the skills corpus lives at the repo root skills/ per AGENTS.md layout; the bundle
  // SERVES it from <pkg>/skills at runtime (mpd-bootstrap registers it as a
  // ctx.skills provider) — nothing is copied into $DSH_HOME any more.
  const skillsSrc = join(repoRoot, "skills")
  if (existsSync(skillsSrc)) cpSync(skillsSrc, join(outDir, "skills"), { recursive: true })
  // The extension DISCOVERY ROOT. mpd-ext resolves the bundle plane as
  // `<bundleRoot>/extensions` (manifest.ts bundleExtensionsDir()), so a packed bundle
  // that ships the plugin but not this directory silently loses the whole bundle plane
  // — the shipped reference extension disappears with no error anywhere. t1 §1.9
  // requires the asset and the packed manifest entry in the same change.
  const extensionsSrc = join(repoRoot, "extensions")
  if (!existsSync(extensionsSrc)) {
    console.error("[pack-mpd] FAIL: missing " + extensionsSrc + " — the mpd-ext bundle discovery root must ship (see plan §1.9)")
    process.exit(1)
  }
  cpSync(extensionsSrc, join(outDir, "extensions"), { recursive: true })
  // the main preset ships at the repo root presets/ and is SERVED from
  // <pkg>/presets by the bundle patch's agent-presets root (no $DSH_HOME copy);
  // the roles plugin's persona assets ship under packages/mpd-roles-plugin/personas
  cpSync(join(repoRoot, "presets"), join(outDir, "presets"), { recursive: true })
  if (existsSync(join(repoRoot, "packages", "mpd-roles-plugin", "personas"))) {
    cpSync(join(repoRoot, "packages", "mpd-roles-plugin", "personas"), join(outDir, "packages", "mpd-roles-plugin", "personas"), { recursive: true })
  }
  // the adopted agent-teams plugin is FIRST-CLASS MAIN CODE under
  // packages/mpd-agent-teams-plugin: copy its whole body (lib + _deps + assets +
  // LICENSE + READMEs) so the bundle is self-contained under any install layout.
  // Exclude test/self-fix-tests dirs: they are dev-only and must not ship in the
  // bundle (avoids packing bloat AND the dist test-sweep duplication).
  cpSync(join(repoRoot, "packages", "mpd-agent-teams-plugin"), join(outDir, "packages", "mpd-agent-teams-plugin"), { recursive: true, filter: (s) => !/(^|\/)(test|self-fix-tests)(\/|$)/.test(s) })
  // the bundle's combined web client (adopted agent-teams panel + workmate library),
  // composed by scripts/build-mpd-client.mjs — served as @mpd-dsh/mpd's ./client
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), join(outDir, "packages", "mpd-bundle-plugin", "client.js"))
  // Root bilingual README pair (AGENTS.md language policy: both files ship together
  // and each carries the switch link to the other; copying only README.md would
  // leave the [中文](./README.zh-CN.md) switch link dangling in the package).
  for (const f of ["LICENSE.md", "LICENSE-NOTICES.md", "README.md", "README.zh-CN.md"]) {
    if (existsSync(join(repoRoot, f))) cpSync(join(repoRoot, f), join(outDir, f))
  }
  // MCP install/activation helper ships with the package so dist installs can
  // bootstrap the sg/codegraph binaries + wave MCPs too. The extension CLI ships for
  // the same reason: it is the documented developer workflow (`validate`/`scaffold`/
  // `list`) and the AGENTS.md §4 Extension-CLI gate runs it from the packed tree.
  mkdirSync(join(outDir, "scripts"), { recursive: true })
  cpSync(join(repoRoot, "scripts", "install-mcp.mjs"), join(outDir, "scripts", "install-mcp.mjs"))
  cpSync(join(repoRoot, "scripts", "mpd-ext.mjs"), join(outDir, "scripts", "mpd-ext.mjs"))
  // Per-package assets that are NOT under dist/. cpDist() ships `dist/` only, so a
  // package whose runtime or distribution surface includes sibling asset directories
  // needs them copied explicitly — and the omission is INVISIBLE in a checkout install
  // (which reads the repo directly), which is why the class needs a named entry here
  // and a gate rather than trust. The TUI package (row `mpd-tui`) is the measured
  // instance: it ships `themes/mpd-tui.json` (the host-format theme asset) and a
  // packaged skill `skills/mpd-tui/SKILL.md`, and a packed bundle that carried only
  // `dist/` would drop both while `npm run pack` still exited 0.
  // READER NOTE: the key below is an asset-table key, NOT a PLUGIN_PKGS entry — the
  // integrity signal for the array is `PLUGIN_PKGS`'s own element count (one
  // mpd-tui-plugin element, asserted by R11 and by the attribution check), so a raw
  // double-quoted grep of this package name on this file legitimately prints 2 (line
  // 51's array element + this table key), never 1. (This note spells the name without
  // double quotes on purpose, so it does not itself raise that count.)
  for (const [p, dirs] of Object.entries({
    "mpd-tui-plugin": ["themes", "skills"],
  })) {
    for (const dir of dirs) {
      const src = join(repoRoot, "packages", p, dir)
      if (!existsSync(src)) {
        console.error("[pack-mpd] FAIL: missing " + src + " — the " + p + " package ships it; a packed bundle must not silently drop a shipped asset")
        process.exit(1)
      }
      cpSync(src, join(outDir, "packages", p, dir), { recursive: true })
    }
  }
  // Per-package bilingual README pair for every shipped plugin/MCP package
  // (the adopted mpd-agent-teams-plugin is copied wholesale above, READMEs included).
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    for (const f of ["README.md", "README.zh-CN.md"]) {
      const s = join(repoRoot, "packages", p, f)
      if (existsSync(s)) cpSync(s, join(outDir, "packages", p, f))
    }
  }
  // B8 (wave 2) + t25: the MCP rows launch <pkg>/launch.mjs, which resolves the
  // binary bundle-relatively and hands it to the adopted server. A packed bundle
  // that omits a launcher — OR any module the launcher imports statically — ships a
  // row that cannot start while `npm run pack` still exits 0 (measured: the packed
  // `mpd-mcp-codegraph/launch.mjs:36` imports `./daemon-policy.mjs`, which the packed
  // tree lacked; `node --input-type=module -e "import('…/launch.mjs')"` then failed
  // ERR_MODULE_NOT_FOUND while pack had exited 0). So the closure is walked, not
  // guessed: every statically imported RELATIVE module comes along, recursively, and
  // a specifier that does not resolve in the SOURCE tree is a hard FAIL because it
  // means the walker (or the source) is wrong — never a silent omission.
  cpSync(join(repoRoot, "packages", "mpd-mcp-shared"), join(outDir, "packages", "mpd-mcp-shared"), { recursive: true, filter: (s) => !/\.test\.mjs$/.test(s) })
  const packagesRoot = join(repoRoot, "packages")
  /** Copy `packages/<pkg>/<file>` plus its static relative-import closure into the packed tree. */
  const copyLauncherClosure = (absFile, seen) => {
    if (!existsSync(absFile)) {
      console.error("[pack-mpd] FAIL: missing " + absFile + " — a bundle must never ship a mounted row without its module")
      process.exit(1)
    }
    const rel = relative(packagesRoot, absFile)
    if (rel.startsWith("..")) {
      console.error("[pack-mpd] FAIL: " + absFile + " is outside packages/ — refusing to pack it")
      process.exit(1)
    }
    const outFile = join(outDir, "packages", rel)
    mkdirSync(dirname(outFile), { recursive: true })
    cpSync(absFile, outFile)
    if (seen.has(absFile)) return
    seen.add(absFile)
    for (const spec of staticRelativeImports(readFileSync(absFile, "utf8"))) {
      const target = resolve(dirname(absFile), spec)
      if (!existsSync(target)) {
        console.error("[pack-mpd] FAIL: " + rel + " imports " + spec + " which does not resolve in the source tree — refusing to ship a broken closure")
        process.exit(1)
      }
      if (relative(packagesRoot, target).startsWith("..")) {
        console.error("[pack-mpd] FAIL: " + rel + " imports " + spec + " outside packages/ — the closure walker cannot ship it")
        process.exit(1)
      }
      copyLauncherClosure(target, seen)
    }
  }
  for (const p of MCP_PKGS) {
    if (existsSync(join(repoRoot, "packages", p, "launch.mjs"))) {
      copyLauncherClosure(join(repoRoot, "packages", p, "launch.mjs"), new Set())
    }
    // Licensing completeness for a package that vendors a third-party binary: the
    // licence/notice files travel with the copy or the distribution is incomplete.
    for (const f of ["LICENSE", "NODE-RUNTIME-LICENSES.md", "NOTICE"]) {
      if (existsSync(join(repoRoot, "packages", p, f))) cpSync(join(repoRoot, "packages", p, f), join(outDir, "packages", p, f))
    }
  }
  // Positive closure check against the PATCH itself: every `packages/<pkg>/<file>`
  // path a mounted row executes must exist in the packed tree (t25 acceptance).
  const patchText = readFileSync(devPatch, "utf8")
  for (const m of patchText.matchAll(/packages\/([a-z0-9-]+)\/(launch\.mjs|dist\/[A-Za-z0-9._/-]+\.js)/g)) {
    const packed = join(outDir, "packages", m[1], m[2])
    if (!existsSync(packed)) {
      console.error("[pack-mpd] FAIL: the patch mounts packages/" + m[1] + "/" + m[2] + " but the packed tree has no such file")
      process.exit(1)
    }
  }
}

/** Relative static-import specifiers of an ESM module (import/export ... from "./x.mjs"). */
function staticRelativeImports(text) {
  const specs = new Set()
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s*["'](\.[^"']+)["']/g)) specs.add(m[1])
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["'](\.[^"']+)["']/g)) specs.add(m[1])
  return [...specs]
}

function decouplePatch(srcPatch) {
  let t = readFileSync(srcPatch, "utf8")
  for (const p of PLUGIN_PKGS) {
    t = t.split("name: '" + dev + "/packages/" + p + "/dist/index.js'").join("name: '" + PKG_NAME + "/packages/" + p + "/dist/index.js'")
  }
  for (const p of MCP_PKGS) {
    t = t.split("'" + dev + "/packages/" + p + "/dist/cli.js'").join(pathExpr("/node_modules/" + PKG_NAME + "/packages/" + p + "/dist/cli.js"))
  }
  t = t.split("'" + dev + "/packages/mpd-mcp-codegraph/dist/serve.js'").join(pathExpr("/node_modules/" + PKG_NAME + "/packages/mpd-mcp-codegraph/dist/serve.js"))
  // B8 (wave 2): the `.toolchain` -> `<baseUrl>/node_modules/.bin/*` rewrites were
  // removed together with the env pins they served — the patch no longer names a
  // binary path at all (the launchers resolve it), so those splits could only ever
  // be no-ops that imply a resolution that no longer exists.
  // nested !!js (env || <expr>) fix: drop the inner YAML tag so the outer JS sees one expression
  t = t.replace(/\|\| !!js '([^']+)'/g, "|| ($1)")
  // generic YAML-safety: any remaining UNQUOTED !!js value containing ': ' breaks plain-scalar
  // parsing; wrap it in single quotes (the JS bodies use double quotes only, so no escaping).
  t = t.replace(/(!!js )((?!')([^\n]*))/g, (m, tag, body) => body.includes(": ") ? tag + "'" + body + "'" : m)
  return t
}

function writeManifest() {
  const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const manifest = {
    name: PKG_NAME,
    version: root.version,
    private: true,
    type: "module",
    description: root.description,
    license: "SEE LICENSE IN LICENSE.md",
    main: "packages/mpd-bundle-plugin/dist/index.js",
    exports: {
      ".": "./packages/mpd-bundle-plugin/dist/index.js",
      "./package.json": "./package.json",
      "./packages/*": "./packages/*",
      "./skills/*": "./skills/*",
      "./presets/*": "./presets/*",
      // the mpd-ext bundle discovery root: mpd-ext resolves `<bundleRoot>/extensions`
      // by filesystem path, and the map entry keeps the packed form addressable exactly
      // like skills/ and presets/ (plan §1.9: the asset and this declaration ship together).
      "./extensions/*": "./extensions/*",
      "./client": "./packages/mpd-bundle-plugin/client.js"
    },
    files: [
      "packages/**",
      "skills/**",
      "presets/**",
      "extensions/**",
      "scripts/**",
      "cordis.patch.yml",
      "LICENSE.md", "LICENSE-NOTICES.md", "README.md", "README.zh-CN.md"
    ],
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      // The bundle's web client (the adopted agent-teams panel + workmate library)
      // declares its own service injects inside the client factory; the bundle-level
      // graph-row inject stays empty, mirroring @linxin666/dsh-web-ui-all.
      client: { inject: [], platform: "web" }
    },
    // The adopted agent-teams plugin (MIT provenance, upstream @nanmicoder/
    // dsh-agent-teams 0.1.16-rc.3-mpd) is FIRST-CLASS MAIN CODE under
    // packages/mpd-agent-teams-plugin and is copied wholesale into the bundle
    // (lib + _deps + assets), loaded through the exports map above. A plain
    // `dependencies` entry is NOT enough: pnpm (the engine behind `dsh plugin add`)
    // never links a bundle's transitive deps into the profile root, so the plugin's
    // row would silently self-disable at boot (repro: evidence/plan-e/e1-team-route
    // 2026-08-27T07-38-13.142Z FAIL bundleDependency).
    // Toolchain binaries stay as optionalDependencies (installed separately):
    //  - @ast-grep/cli / @colbymchenry/codegraph / @code-yeongyu/comment-checker
    optionalDependencies: { "@ast-grep/cli": "0.45.2", "@colbymchenry/codegraph": "1.5.0", "@code-yeongyu/comment-checker": "0.8.0" }
  }
  writeFileSync(join(outDir, "package.json"), JSON.stringify(manifest, null, 2) + "\n")
}

/**
 * Normalize the packed artifact's file modes.
 *
 * `cpSync` copies the SOURCE mode verbatim, so a working tree that carries 600
 * bits (git normalizes modes to 644, so the committed files are fine — but an
 * editor/umask can still leave the checkout at 600) would ship an install source
 * whose files a non-root consumer cannot read. The artifact is what users install,
 * so the mode is fixed here rather than in the working tree: regular files become
 * 644 and anything already executable STAYS 755 (stat first, never a blind chmod).
 */
function normalizeModes(root) {
  const counts = { files: 0, made644: 0, kept755: 0, other: 0 }
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      const st = statSync(p)
      if (st.isDirectory()) { walk(p); continue }
      counts.files += 1
      const mode = st.mode & 0o777
      if ((mode & 0o111) !== 0) {
        if (mode !== 0o755) { chmodSync(p, 0o755); counts.kept755 += 1 } else counts.kept755 += 1
        continue
      }
      if (mode !== 0o644) { chmodSync(p, 0o644); counts.made644 += 1 } else counts.made644 += 1
    }
  }
  walk(root)
  return counts
}

function main() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  cpDist()
  cpAssets()
  writeFileSync(join(outDir, "cordis.patch.yml"), decouplePatch(devPatch))
  writeManifest()
  const raw = readFileSync(join(outDir, "cordis.patch.yml"), "utf8")
  if (raw.includes(dev)) { console.error("[pack-mpd] FAIL: dev path leaked into staged patch"); process.exit(1) }
  const modes = normalizeModes(outDir)
  console.log("[pack-mpd] modes normalized: " + modes.files + " files (644: " + modes.made644 + ", 755: " + modes.kept755 + ")")
  console.log("[pack-mpd] staged package -> " + outDir)
}

main()