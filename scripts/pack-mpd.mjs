#!/usr/bin/env node
// pack-mpd: assemble the relocatable installable bundle package (Plan D).
// Output: <repo>/dist/mpd-package/ — a self-contained npm package named @mpd-dsh/mpd
// with dsh.bundle.patch, whose cordis.patch.yml references plugins via the resolvable
// name '@mpd-dsh/mpd/packages/...' and every path-bearing value via the loader's
// baseUrl (the profile directory) — no checkout-absolute paths anywhere.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
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
  "mpd-tools-plugin", "mpd-modelchain-plugin", "mpd-ulw-plugin",
  "mpd-codegraph-plugin", "mpd-hashline-plugin", "mpd-boulder-plugin",
  "mpd-config-plugin", "mpd-comment-checker-plugin", "mpd-memory-plugin",
  "mpd-roles-plugin", "mpd-bootstrap-plugin", "mpd-workmate-plugin",
  "mpd-verif-plugin", "mpd-bundle-plugin"
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
  // skill corpus lives at the repo root skills/ per AGENTS.md layout; the bundle
  // SERVES it from <pkg>/skills at runtime (mpd-bootstrap registers it as a
  // ctx.skills provider) — nothing is copied into $DSH_HOME any more.
  const skillsSrc = join(repoRoot, "skills")
  if (existsSync(skillsSrc)) cpSync(skillsSrc, join(outDir, "skills"), { recursive: true })
  // the main preset ships in mpd-bootstrap-plugin/presets and is SERVED from
  // <pkg>/presets by the bundle patch's agent-presets root (no $DSH_HOME copy);
  // the roles plugin's persona assets ship under packages/mpd-roles-plugin/personas
  cpSync(join(repoRoot, "packages", "mpd-bootstrap-plugin", "presets"), join(outDir, "presets"), { recursive: true })
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
  // bootstrap the sg/codegraph/verible/slang binaries + wave MCPs too.
  mkdirSync(join(outDir, "scripts"), { recursive: true })
  cpSync(join(repoRoot, "scripts", "install-mcp.mjs"), join(outDir, "scripts", "install-mcp.mjs"))
  // Per-package bilingual README pair for every shipped plugin/MCP package
  // (the adopted mpd-agent-teams-plugin is copied wholesale above, READMEs included).
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    for (const f of ["README.md", "README.zh-CN.md"]) {
      const s = join(repoRoot, "packages", p, f)
      if (existsSync(s)) cpSync(s, join(outDir, "packages", p, f))
    }
  }
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
  t = t.split("'" + dev + "/.toolchain/node_modules/.bin/sg'").join(pathExpr("/node_modules/.bin/sg"))
  t = t.split("'" + dev + "/.toolchain/node_modules/.bin/codegraph'").join(pathExpr("/node_modules/.bin/codegraph"))
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
      "./client": "./packages/mpd-bundle-plugin/client.js"
    },
    files: [
      "packages/**",
      "skills/**",
      "presets/**",
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
    // dsh-agent-teams 0.1.14) is FIRST-CLASS MAIN CODE under
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

function main() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  cpDist()
  cpAssets()
  writeFileSync(join(outDir, "cordis.patch.yml"), decouplePatch(devPatch))
  writeManifest()
  const raw = readFileSync(join(outDir, "cordis.patch.yml"), "utf8")
  if (raw.includes(dev)) { console.error("[pack-mpd] FAIL: dev path leaked into staged patch"); process.exit(1) }
  console.log("[pack-mpd] staged package -> " + outDir)
}

main()