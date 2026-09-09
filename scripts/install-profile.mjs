#!/usr/bin/env node
// One-shot installer: install the my-power-dsh capabilities into the local DeepSeek Harness.
// By default --dry-run only prints the plan; --yes writes to disk; --dsh-home overrides the target (for isolated QA); --self-test runs the offline self-test.
// Target artifacts:
//   1) $DSH_HOME/profiles/mpd/{package.json,dsh.profile,cordis.patch.yml} (separate profiles for base + web-app)
//   2) $DSH_HOME/cordis.patch.yml (plugin rows with local absolute paths: llm dual track / skills / MCP / mpd-codegraph)
//   3) $DSH_HOME/.agent-presets/mpd-* (presets -> auto-scanned from the user root)
//   4) .toolchain (network install of ast-grep + codegraph when missing)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function parseArgs(argv) {
  const o = { profile: "mpd", yes: false, dshHome: null, selfTest: false, skipToolchain: false, agentTeams: true, commentChecker: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--yes") o.yes = true
    else if (a === "--dry-run") o.yes = false
    else if (a === "--self-test") o.selfTest = true
    else if (a === "--skip-toolchain") o.skipToolchain = true
    else if (a === "--with-agent-teams") o.agentTeams = true
    else if (a === "--without-agent-teams") o.agentTeams = false
    else if (a === "--with-comment-checker") o.commentChecker = true
    else if (a === "--dsh-home") o.dshHome = argv[++i]
    else if (a === "--profile") o.profile = argv[++i]
  }
  return o
}

// Extract the agent-teams row's `profiles:` YAML block from the bundle patch
// verbatim (starting at the `profiles:` key, ending at the next line indented
// shallower than the key). The block is later re-indented to the row's config
// level by renderRow, so both install flows ship byte-identical roster config.
function extractAgentTeamsProfiles(patchText) {
  const lines = patchText.split("\n")
  const idx = lines.findIndex((l) => /^ {8}profiles:\s*$/.test(l))
  if (idx < 0) throw new Error("bundle patch agent-teams row has no profiles: block (packages/mpd-bundle/cordis.patch.yml)")
  const base = 8
  const out = []
  for (let i = idx; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === "") { out.push(""); continue }
    const ind = l.match(/^ */)[0].length
    if (ind < base) break
    out.push(l)
  }
  if (!out.some((l) => l.includes("taskPlanning: captain"))) throw new Error("extracted profiles block missing taskPlanning: captain")
  return { base, lines: out }
}

function buildPlan(o) {
  const dshHome = o.dshHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh")
  const isHeadless = o.profile === "mpd-headless"
  const bundle0 = "@deepseek-ai/dsh-base"
  const bundle1 = isHeadless ? "@deepseek-ai/dsh-headless" : "@deepseek-ai/dsh-web-app"
  const p = (r) => join(repoRoot, r)
  const presetsDir = p("packages/mpd-bootstrap-plugin/presets")
  const astCli = p(".toolchain/node_modules/.bin/sg")
  const cgCli = p(".toolchain/node_modules/.bin/codegraph")
  const rows = [
    // Web-compat self-row (mirrors the bundle patch's mpd-web-compat): makes an
    // entry named EXACTLY '@mpd-dsh/mpd' (the loader entry name client-modules
    // scans) resolve to the bundle plugin's own no-op main. The name must be the
    // bare package specifier — client-modules resolves `<name>/package.json` off
    // the profile baseUrl and requires the package to declare `dsh.client` +
    // `exports["./client"]`; install writes a resolvable @mpd-dsh/mpd shim into
    // the profile's node_modules (see main()), so the web client mounts in
    // legacy installs exactly as it does in the packed bundle flow.
    {
      id: "mpd-web-compat", name: "@mpd-dsh/mpd",
      config: {}
    },
    // NOTE: no root skill-filesystem row — the mpd-* presets already declare it
    // (agent-plane, tool rows are preset-plane responsibility since 49b1288), and
    // adding it here duplicates the loader entry id and fails every real boot.
    {
      id: "mcp-astgrep", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "ast_grep", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-astgrep/dist/cli.js")],
        env: existsSync(astCli) ? { MPD_AST_GREP_SG_PATH: astCli } : undefined, toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-gitbash", name: "@deepseek-ai/dsh-mcp-client", disabled: true,
      config: { serverName: "git_bash", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-gitbash/dist/cli.js")], toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-lsp", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "lsp", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-lsp/dist/cli.js"), "mcp"], toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-codegraph", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "codegraph", transport: "stdio", command: "node", args: [p("packages/mpd-mcp-codegraph/dist/serve.js")],
        env: existsSync(cgCli) ? { MPD_CODEGRAPH_BIN: cgCli } : undefined, toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-context7", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "context7", transport: "streamable-http", url: "https://mcp.context7.com/mcp", toolCallTimeoutMs: 60000 }
    },
    {
      id: "mcp-grepapp", name: "@deepseek-ai/dsh-mcp-client",
      config: { serverName: "grep_app", transport: "streamable-http", url: "https://mcp.grep.app", toolCallTimeoutMs: 60000 }
    },
    {
      id: "mpd-codegraph", name: p("packages/mpd-codegraph-plugin/dist/index.js"),
      config: { autoInit: true, initTimeoutMs: 60000, binary: cgCli }
    },
    {
      id: "mpd-tools", name: p("packages/mpd-tools-plugin/dist/index.js"),
      config: { writeGuard: true, truncateMaxBytes: 8192 }
    },
    {
      id: "mpd-modelchain", name: p("packages/mpd-modelchain-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-ulw", name: p("packages/mpd-ulw-plugin/dist/index.js"),
      config: { maxRounds: 3 }
    },
    {
      id: "mpd-hashline", name: p("packages/mpd-hashline-plugin/dist/index.js"),
      config: { guardEditTools: true }
    },
    {
      id: "mpd-boulder", name: p("packages/mpd-boulder-plugin/dist/index.js"),
      config: {}
    },
    {
      // The bundle's single contact surface with the harness seams: every row
      // below calls through it (see packages/mpd-dsh-adapter-plugin/README.md).
      id: "mpd-dsh-adapter", name: p("packages/mpd-dsh-adapter-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-config", name: p("packages/mpd-config-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-comment-checker", name: p("packages/mpd-comment-checker-plugin/dist/index.js"),
      config: { autoCheck: false }
    },
    {
      id: "mpd-memory", name: p("packages/mpd-memory-plugin/dist/index.js"),
      config: { vcs: "git" }
    },
    {
      id: "mpd-roles", name: p("packages/mpd-roles-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-workmate", name: p("packages/mpd-workmate-plugin/dist/index.js"),
      config: {}
    },
    {
      id: "mpd-bootstrap", name: p("packages/mpd-bootstrap-plugin/dist/index.js"),
      config: {}
    }
  ]
  // The agent-teams row must register the SAME `profiles.mpd` roster as the
  // bundle patch (packages/mpd-bundle/cordis.patch.yml) — otherwise
  // `--profile mpd` for /agent-teams is unresolvable under a legacy install.
  // The profile YAML block is extracted VERBATIM from the bundle patch (single
  // source of truth; no transcription drift between the two install flows).
  const bundlePatch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  const profiles = extractAgentTeamsProfiles(bundlePatch)
  const agentTeamsRow = {
    id: "agent-teams", name: p("packages/mpd-agent-teams-plugin/lib/index.js"),
    config: { stateDir: ".mpd/team", memberProvider: "spawn", memberMaxDepth: 1, maxMembers: 16,
      // SESSION-START TEAM RULE: mechanically enforce a team per mpd session
      // (mirrors the bundle patch; see packages/mpd-agent-teams-plugin/lib/session-start.js).
      sessionTeamPolicy: { mode: "auto", profile: "mpd", presets: ["mpd"], name: "MPD Default", approval: "required" } },
    configYaml: profiles
  }
  if (o.agentTeams !== false) rows.push(agentTeamsRow)
  return {
    dshHome, isHeadless, bundle0, bundle1, rows, presetsDir,
    profileDir: join(dshHome, "profiles", o.profile),
    homePatch: join(dshHome, "cordis.patch.yml"),
    userPresets: join(dshHome, ".agent-presets"),
    needsToolchain: !existsSync(astCli) || !existsSync(cgCli),
    agentTeams: o.agentTeams !== false,
    agentTeamsRow
  }
}

// Id-target contract (AGENTS.md §8): rows whose id ALREADY EXISTS in the target
// home patch are emitted as id-target overrides (replacing the whole stock row),
// new rows are emitted under `- insert:`. The target home patch is read at
// install time so re-running the installer never duplicates loader entry ids.
function readExistingIds(homePatch) {
  if (!existsSync(homePatch)) return new Set()
  const t = readFileSync(homePatch, "utf8")
  const ids = new Set()
  // top-level rows appear at column 0 ("- id: X"); insert rows at column 4
  // ("    - id: X"); nested config ids are deeper and are not row ids.
  for (const m of t.matchAll(/^(?: {0,4})- id: ["']?([A-Za-z0-9_.-]+)["']?\s*$/gm)) ids.add(m[1])
  return ids
}

function renderRow(r, indent) {
  const body = []
  body.push(indent + "- id: " + r.id)
  body.push(indent + "  name: " + JSON.stringify(r.name))
  if (r.disabled !== undefined) body.push(indent + "  disabled: " + JSON.stringify(r.disabled))
  const hasConfig = r.config && Object.keys(r.config).length > 0
  if (hasConfig) body.push(indent + "  config:")
  if (hasConfig) {
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
  // verbatim YAML block (the agent-teams `profiles:` roster from the bundle
  // patch), re-indented to this row's config-children level
  if (r.configYaml) {
    if (!hasConfig) body.push(indent + "  config:")
    const shift = r.configYaml.base - (indent.length + 4)
    for (const raw of r.configYaml.lines) {
      if (raw.trim() === "") { body.push(""); continue }
      body.push(raw.slice(shift))
    }
  }
  return body.join("\n")
}

function renderPatch(rows, existingIds) {
  const existing = rows.filter((r) => existingIds.has(r.id))
  const inserts = rows.filter((r) => !existingIds.has(r.id))
  const parts = []
  if (existing.length) parts.push(existing.map((r) => renderRow(r, "")).join("\n"))
  if (inserts.length) parts.push("- insert:\n" + inserts.map((r) => renderRow(r, "  ")).join("\n"))
  return parts.join("\n\n")
}

function selfTest() {
  const plan = buildPlan({ profile: "mpd", yes: false, dshHome: join(homedir(), ".mpd-not-real"), agentTeams: true })
  if (plan.homePatch !== join(plan.dshHome, "cordis.patch.yml")) { console.error("[install-profile self-test] FAIL: path model"); process.exit(1) }
  const rows = plan.rows.map((r) => r.id)
  if (!rows.includes("mcp-astgrep") || !rows.includes("mpd-codegraph") || !rows.includes("agent-teams")) { console.error("[install-profile self-test] FAIL: row set"); process.exit(1) }
  if (!rows.includes("mcp-context7") || !rows.includes("mcp-grepapp")) { console.error("[install-profile self-test] FAIL: mcp-context7/mcp-grepapp rows"); process.exit(1) }
  for (const mcp of ["mcp-astgrep", "mcp-gitbash", "mcp-lsp", "mcp-codegraph"]) {
    const r = plan.rows.find((x) => x.id === mcp)
    if (!r || r.config.toolCallTimeoutMs !== 60000) { console.error("[install-profile self-test] FAIL: " + mcp + " toolCallTimeoutMs"); process.exit(1) }
  }
  if (!rows.includes("agent-teams") || plan.agentTeamsRow.config.stateDir !== ".mpd/team") { console.error("[install-profile self-test] FAIL: agent-teams row/override"); process.exit(1) }
  // session-start team policy must ship in the agent-teams row config
  const policy = plan.agentTeamsRow.config.sessionTeamPolicy
  if (!policy || policy.mode !== "auto" || policy.profile !== "mpd" || !Array.isArray(policy.presets) || !policy.presets.includes("mpd")) { console.error("[install-profile self-test] FAIL: agent-teams sessionTeamPolicy"); process.exit(1) }
  if (!rows.includes("mpd-hashline")) { console.error("[install-profile self-test] FAIL: mpd-hashline row"); process.exit(1) }
  if (!rows.includes("mpd-roles") || !rows.includes("mpd-workmate") || !rows.includes("mpd-bootstrap")) { console.error("[install-profile self-test] FAIL: mpd-roles/workmate/bootstrap rows"); process.exit(1) }
  if (!plan.agentTeamsRow.name.includes("packages/mpd-agent-teams-plugin/lib/index.js")) { console.error("[install-profile self-test] FAIL: agent-teams main-code path"); process.exit(1) }
  // web-compat entry name must be exactly the bare bundle specifier (client-modules
  // contract) — never an absolute path
  const webCompat = plan.rows.find((r) => r.id === "mpd-web-compat")
  if (!webCompat || webCompat.name !== "@mpd-dsh/mpd") { console.error("[install-profile self-test] FAIL: web-compat entry name (want '@mpd-dsh/mpd', got " + (webCompat && webCompat.name) + ")"); process.exit(1) }
  // agent-teams row must carry the bundle's profiles.mpd roster verbatim
  if (!plan.agentTeamsRow.configYaml || !plan.agentTeamsRow.configYaml.lines.some((l) => l.includes("taskPlanning: captain"))) { console.error("[install-profile self-test] FAIL: agent-teams profiles.mpd missing"); process.exit(1) }
  // id-target contract: rows already present in the target home patch render as
  // id-target overrides (not inserts); fresh rows render under `- insert:`
  // (under .qa-reloc/ — a gitignored scratch root, so failure residue never commits)
  const tmp = join(repoRoot, ".qa-reloc", "installer-selftest")
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(tmp, "cordis.patch.yml"), "- id: mcp-astgrep\n  name: old\n- id: mpd-tools\n  name: old\n")
  try {
    const p2 = buildPlan({ profile: "mpd", yes: false, dshHome: tmp, agentTeams: true })
    const existing = readExistingIds(p2.homePatch)
    if (!existing.has("mcp-astgrep") || !existing.has("mpd-tools") || existing.has("mpd-ulw")) { console.error("[install-profile self-test] FAIL: existing-id scan"); process.exit(1) }
    const patch = renderPatch(p2.rows, existing)
    if (!/^- id: mcp-astgrep\b/m.test(patch) || !/^- insert:[\s\S]*^ {2}- id: mpd-ulw\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: id-target render (existing rows must not be inserts)"); process.exit(1) }
    if (/- insert:[\s\S]*^ {0,2}- id: mcp-astgrep\b/m.test(patch)) { console.error("[install-profile self-test] FAIL: existing row rendered as insert"); process.exit(1) }
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
  console.log("[install-profile self-test] ok: path model + row set + agent-teams main-code path + profiles.mpd + web-compat entry + id-target render verified")
}

function main() {
  // ONE npm install for ALL toolchain packages: separate --no-save installs prune
  const o = parseArgs(process.argv.slice(2))
  if (o.selfTest) { selfTest(); return }
  const plan = buildPlan(o)
  const existingIds = readExistingIds(plan.homePatch)
  const patchText = renderPatch(plan.rows, existingIds)
  console.log("[install-profile] dshHome=" + plan.dshHome + " profile=" + o.profile + " write=" + o.yes)
  console.log("[install-profile] profileDir=" + plan.profileDir)
  console.log("[install-profile] homePatch=" + plan.homePatch)
  console.log("[install-profile] presets -> " + join(plan.userPresets, "mpd-*"))
  console.log("[install-profile] toolchain missing=" + plan.needsToolchain + " (use --skip-toolchain to skip)")
  console.log("[install-profile] rows about to be written to home patch: " + plan.rows.length + " (id-target=" + plan.rows.filter((r) => existingIds.has(r.id)).length + ", insert=" + plan.rows.filter((r) => !existingIds.has(r.id)).length + ")")
  console.log(patchText)
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
  // Single-pass home patch: the agent-teams row is a plain path row now (the adopted
  // plugin is first-class main code with its own _deps closure), so the old npm-install
  // + two-pass override dance is obsolete. Rows whose id already exists in the target
  // patch are written as id-target overrides (AGENTS.md §8 contract).
  writeFileSync(plan.homePatch, patchText + "\n")
  // Web-compat shim: make '@mpd-dsh/mpd' resolvable off the profile baseUrl. The
  // loader entry name and client-modules' `<name>/package.json` lookup both anchor
  // at the profile dir, so the shim must live in the profile's node_modules; it
  // mirrors the packed bundle's own package.json (dsh.client web + exports["./client"]).
  const shimDir = join(plan.profileDir, "node_modules", "@mpd-dsh", "mpd")
  mkdirSync(shimDir, { recursive: true })
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js"), join(shimDir, "index.js"))
  cpSync(join(repoRoot, "packages", "mpd-bundle-plugin", "client.js"), join(shimDir, "client.js"))
  writeFileSync(join(shimDir, "package.json"), JSON.stringify({
    name: "@mpd-dsh/mpd", version: rootPkg.version, private: true, type: "module",
    main: "./index.js",
    exports: { ".": "./index.js", "./client": "./client.js", "./package.json": "./package.json" },
    dsh: { client: { inject: [], platform: "web" } }
  }, null, 2) + "\n")
  // copy presets
  const ids = readdirSync(plan.presetsDir).filter((d) => d === "mpd" || d.startsWith("mpd-"))
  for (const id of ids) cpSync(join(plan.presetsDir, id), join(plan.userPresets, id), { recursive: true })
  console.log("[install-profile] wrote profile/ home patch/ presets(" + ids.length + ") + web-compat shim @mpd-dsh/mpd")
  // ONE npm install for ALL toolchain packages: separate --no-save installs prune
  // each other (npm deletes packages absent from the single command).
  const toolchainPkgs = ["@ast-grep/cli", "@colbymchenry/codegraph@1.5.0"]
  if (o.commentChecker) toolchainPkgs.push("@code-yeongyu/comment-checker@0.8.0")
  if ((plan.needsToolchain || o.commentChecker) && !o.skipToolchain) {
    console.log("[install-profile] installing toolchain (" + toolchainPkgs.join(" + ") + ")...")
    const r = spawnSync("npm", ["install", "--prefix", join(repoRoot, ".toolchain"), "--no-save", "--no-audit", "--no-fund", "--cache", join(repoRoot, ".toolchain/.npm-cache"), ...toolchainPkgs], { stdio: "inherit" })
    if (r.status !== 0) { console.error("[install-profile] toolchain install failed; try --skip-toolchain and install manually"); process.exitCode = 1; return }
  }
  console.log("[install-profile] done. Start with: dsh --profile " + o.profile + "   (the web preset selector will show the mpd preset)")
}

main()
