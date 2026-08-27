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
  "mpd-tools-plugin", "mpd-modelchain-plugin", "mpd-ulw-plugin", "mpd-team-plugin",
  "mpd-codegraph-plugin", "mpd-hashline-plugin", "mpd-boulder-plugin",
  "mpd-config-plugin", "mpd-comment-checker-plugin", "mpd-memory-plugin",
  "mpd-bootstrap-plugin"
]
const MCP_PKGS = ["mpd-mcp-astgrep", "mpd-mcp-gitbash", "mpd-mcp-lsp", "mpd-mcp-codegraph"]

function cpDist() {
  for (const p of [...PLUGIN_PKGS, ...MCP_PKGS]) {
    const src = join(repoRoot, "packages", p, "dist")
    if (!existsSync(src)) continue
    mkdirSync(join(outDir, "packages", p), { recursive: true })
    cpSync(src, join(outDir, "packages", p, "dist"), { recursive: true })
  }
}

function cpAssets() {
  mkdirSync(join(outDir, "packages"), { recursive: true })
  // skill corpus lives at the repo root skills/ per AGENTS.md layout; the
  // mpd-bootstrap plugin copies it to $DSH_HOME/skills at boot (version-stamped)
  const skillsSrc = join(repoRoot, "skills")
  if (existsSync(skillsSrc)) cpSync(skillsSrc, join(outDir, "skills"), { recursive: true })
  cpSync(join(repoRoot, "packages", "mpd-presets-plugin", "presets"), join(outDir, "presets"), { recursive: true })
  cpSync(join(repoRoot, "third-party"), join(outDir, "third-party"), { recursive: true })
  for (const f of ["LICENSE.md", "LICENSE-NOTICES.md", "README.md"]) {
    if (existsSync(join(repoRoot, f))) cpSync(join(repoRoot, f), join(outDir, f))
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
  t = t.split("'" + dev + "/packages/mpd-skills-plugin/skills'").join(pathExpr("/node_modules/" + PKG_NAME + "/packages/mpd-skills-plugin/skills"))
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
    main: "packages/mpd-bootstrap-plugin/dist/index.js",
    exports: {
      "./package.json": "./package.json",
      "./packages/*": "./packages/*",
      "./skills/*": "./skills/*",
      "./presets/*": "./presets/*"
    },
    files: [
      "packages/**",
      "skills/**",
      "presets/**",
      "third-party/**",
      "cordis.patch.yml",
      "LICENSE.md", "LICENSE-NOTICES.md", "README.md"
    ],
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    dependencies: { "@nanmicoder/dsh-agent-teams": "^0.1.13" },
    // Third-party packages used unmodified are DECLARED, never copied:
    //  - @nanmicoder/dsh-agent-teams (adopted team plugin, MIT) -> dependencies
    //  - @ast-grep/cli / @colbymchenry/codegraph : toolchain binaries -> optionalDependencies
    //  - @code-yeongyu/comment-checker : native binary (~51MB) -> optionalDependencies
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