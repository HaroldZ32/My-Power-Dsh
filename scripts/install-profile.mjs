#!/usr/bin/env node
// One-shot installer: install the my-power-dsh capabilities into the local DeepSeek Harness.
// By default --dry-run only prints the plan; --yes writes to disk; --dsh-home overrides the target (for isolated QA); --self-test runs the offline self-test.
// Target artifacts:
//   1) $DSH_HOME/profiles/omo/{package.json,dsh.profile,cordis.patch.yml} (separate profiles for base + web-app)
//   2) $DSH_HOME/cordis.patch.yml (plugin rows with local absolute paths: llm dual track / skills / MCP / omo-codegraph)
//   3) $DSH_HOME/.agent-presets/omo-* (4 presets -> auto-scanned from the user root)
//   4) .toolchain (network install of ast-grep + codegraph when missing)
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function parseArgs(argv) {
  const o = { profile: "omo", yes: false, dshHome: null, selfTest: false, skipToolchain: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--yes") o.yes = true
    else if (a === "--dry-run") o.yes = false
    else if (a === "--self-test") o.selfTest = true
    else if (a === "--skip-toolchain") o.skipToolchain = true
    else if (a === "--dsh-home") o.dshHome = argv[++i]
    else if (a === "--profile") o.profile = argv[++i]
  }
  return o
}

function buildPlan(o) {
  const dshHome = o.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const isHeadless = o.profile === "omo-headless"
  const bundle0 = "@deepseek-ai/dsh-base"
  const bundle1 = isHeadless ? "@deepseek-ai/dsh-headless" : "@deepseek-ai/dsh-web-app"
  const p = (r) => join(repoRoot, r)
  const skillsDir = p("packages/omo-skills-plugin/skills")
  const presetsDir = p("packages/omo-presets-plugin/presets")
  const astCli = p(".toolchain/node_modules/.bin/ast-grep")
  const cgCli = p(".toolchain/node_modules/.bin/codegraph")
  const rows = [
    {
      id: "llm-deepseek", name: "@deepseek-ai/dsh-llm-deepseek",
      config: { apiKeyEnv: "DEEPSEEK_API_KEY", thinking: "enabled", reasoningEffort: "high", maxTokens: 256000 }
    },
    {
      id: "llm-pi-ai", name: "@deepseek-ai/dsh-llm-pi-ai",
      config: { providers: { deepseek: { apiKeyEnv: "DEEPSEEK_API_KEY" } } }
    },
    { id: "agent-default-model", name: "@deepseek-ai/dsh-agent-default-model", config: { provider: "deepseek-official", model: "deepseek-v4-flash" } },
    {
      id: "skill-filesystem", name: "@deepseek-ai/dsh-skill-filesystem", disabled: false,
      config: { includeDefaultRoots: true, customSkillDirs: [skillsDir] }
    },
    {
      id: "mcp-astgrep", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "ast_grep", transport: "stdio", command: "node", args: [p("packages/omo-mcp-astgrep/dist/cli.js")],
        env: existsSync(astCli) ? { OMO_AST_GREP_SG_PATH: astCli } : undefined }
    },
    {
      id: "mcp-gitbash", name: "@deepseek-ai/dsh-mcp-client", disabled: true,
      config: { serverName: "git_bash", transport: "stdio", command: "node", args: [p("packages/omo-mcp-gitbash/dist/cli.js")] }
    },
    {
      id: "mcp-lsp", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "lsp", transport: "stdio", command: "node", args: [p("packages/omo-mcp-lsp/dist/cli.js"), "mcp"] }
    },
    {
      id: "mcp-codegraph", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "codegraph", transport: "stdio", command: "node", args: [p("packages/omo-mcp-codegraph/dist/serve.js")],
        env: existsSync(cgCli) ? { OMO_CODEGRAPH_BIN: cgCli } : undefined }
    },
    {
      id: "omo-codegraph", name: p("packages/omo-codegraph-plugin/dist/index.js"),
      config: { autoInit: true, initTimeoutMs: 60000, binary: cgCli }
    },
    {
      id: "omo-tools", name: p("packages/omo-tools-plugin/dist/index.js"),
      config: { writeGuard: true, truncateMaxBytes: 8192 }
    },
    {
      id: "omo-modelchain", name: p("packages/omo-modelchain-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "omo-ulw", name: p("packages/omo-ulw-plugin/dist/index.js"),
      config: { maxRounds: 3 }
    },
    {
      id: "omo-team", name: p("packages/omo-team-plugin/dist/index.js"),
      config: {}
    }
  ]
  return {
    dshHome, isHeadless, bundle0, bundle1, rows, skillsDir, presetsDir,
    profileDir: join(dshHome, "profiles", o.profile),
    homePatch: join(dshHome, "cordis.patch.yml"),
    userPresets: join(dshHome, ".agent-presets"),
    needsToolchain: !existsSync(astCli) || !existsSync(cgCli)
  }
}

const EXISTING_IDS = new Set(["llm-deepseek", "llm-pi-ai", "agent-default-model", "skill-filesystem"])

function renderRow(r, indent) {
  const body = []
  body.push(indent + "- id: " + r.id)
  body.push(indent + "  name: " + JSON.stringify(r.name))
  if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))
  if (r.config) body.push(indent + "  config:")
  if (r.config) {
    for (const [k, v] of Object.entries(r.config)) {
      if (v === undefined) continue
      if (Array.isArray(v)) {
        body.push(indent + "    " + k + ":")
        for (const item of v) body.push(indent + "      - " + JSON.stringify(item))
      } else if (typeof v === "object") {
        body.push(indent + "    " + k + ":")
        for (const [k2, v2] of Object.entries(v)) body.push(indent + "      " + k2 + ": " + JSON.stringify(v2))
      } else {
        body.push(indent + "    " + k + ": " + JSON.stringify(v))
      }
    }
  }
  return body.join("\n")
}

function renderPatch(rows) {
  const existing = rows.filter((r) => EXISTING_IDS.has(r.id))
  const inserts = rows.filter((r) => !EXISTING_IDS.has(r.id))
  const parts = []
  if (existing.length) parts.push(existing.map((r) => renderRow(r, "")).join("\n"))
  if (inserts.length) parts.push("- insert:\n" + inserts.map((r) => renderRow(r, "  ")).join("\n"))
  return parts.join("\n\n")
}

function selfTest() {
  const plan = buildPlan({ profile: "omo", yes: false, dshHome: join(homedir(), ".omo-dsh-not-real") })
  if (plan.homePatch !== join(plan.dshHome, "cordis.patch.yml")) { console.error("[install-profile self-test] FAIL: path model"); process.exit(1) }
  const rows = plan.rows.map((r) => r.id)
  if (!rows.includes("mcp-astgrep") || !rows.includes("omo-codegraph") || !rows.includes("skill-filesystem")) { console.error("[install-profile self-test] FAIL: row set"); process.exit(1) }
  console.log("[install-profile self-test] ok: path model + row set verified")
}

function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.selfTest) { selfTest(); return }
  const plan = buildPlan(o)
  console.log("[install-profile] dshHome=" + plan.dshHome + " profile=" + o.profile + " write=" + o.yes)
  console.log("[install-profile] profileDir=" + plan.profileDir)
  console.log("[install-profile] homePatch=" + plan.homePatch)
  console.log("[install-profile] presets -> " + join(plan.userPresets, "omo-*"))
  console.log("[install-profile] toolchain missing=" + plan.needsToolchain + " (use --skip-toolchain to skip)")
  console.log("[install-profile] rows about to be written to home patch: " + plan.rows.length)
  console.log(renderPatch(plan.rows))
  if (!o.yes) { console.log("[install-profile] DRY-RUN done (nothing written); add --yes to actually install, and --dsh-home to override the target"); return }

  mkdirSync(plan.profileDir, { recursive: true })
  mkdirSync(plan.userPresets, { recursive: true })
  // profile manifest (bundles use only what ships with DSH; all capabilities go through the home patch)
  writeFileSync(join(plan.profileDir, "package.json"), JSON.stringify({
    name: "dsh-profile-" + o.profile, private: true,
    dependencies: {},
    dsh: { profile: { bundles: [plan.bundle0, plan.bundle1] } }
  }, null, 2) + "\n")
  writeFileSync(join(plan.profileDir, "cordis.patch.yml"), "[]\n")
  writeFileSync(plan.homePatch, renderPatch(plan.rows) + "\n")
  // copy presets
  const ids = readdirSync(plan.presetsDir).filter((d) => d.startsWith("omo-"))
  for (const id of ids) cpSync(join(plan.presetsDir, id), join(plan.userPresets, id), { recursive: true })
  console.log("[install-profile] wrote profile/ home patch/ presets(" + ids.length + ")")
  if (plan.needsToolchain && !o.skipToolchain) {
    console.log("[install-profile] installing toolchain (@ast-grep/cli + @colbymchenry/codegraph@1.5.0)...")
    const r = spawnSync("npm", ["install", "--prefix", join(repoRoot, ".toolchain"), "--no-save", "--cache", join(repoRoot, ".toolchain/.npm-cache"), "@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"], { stdio: "inherit" })
    if (r.status !== 0) { console.error("[install-profile] toolchain install failed; try --skip-toolchain and install manually"); process.exitCode = 1; return }
  }
  console.log("[install-profile] done. Start with: dsh --profile " + o.profile + "   (the web preset selector will show the omo-* presets)")
}

main()
