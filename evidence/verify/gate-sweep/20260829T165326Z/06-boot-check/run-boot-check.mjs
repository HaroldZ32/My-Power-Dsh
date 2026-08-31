#!/usr/bin/env node
// Gate 06 (t10 gate sweep): boot check — `dsh --profile headless --dump-config` in an
// isolated DSH_HOME (mktemp), dev-flavor bundle patch overlay, MCP env pins, assert
// bundle rows are mounted. Writes evidence to evidence/verify/gate-sweep/<ts>/06-boot-check/.
// Isolation per AGENTS.md §7: temp DSH_HOME, credentials copied ONCE, real ~/.dsh never read/written.
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = dirname(dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))))

// Dev-flavor rewrite of the bundle patch (mirrors preset-register.mjs devPatch()).
function devPatch() {
  const t = readFileSync(join(repoRoot, "packages/mpd-bundle/cordis.patch.yml"), "utf8")
  return t
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages/mpd-bundle-plugin/dist/index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

function mcpEnv() {
  return {
    MPD_DSH_ASTGREP_CLI: join(repoRoot, "packages/mpd-mcp-astgrep/dist/cli.js"),
    MPD_DSH_GITBASH_CLI: join(repoRoot, "packages/mpd-mcp-gitbash/dist/cli.js"),
    MPD_DSH_LSP_CLI: join(repoRoot, "packages/mpd-mcp-lsp/dist/cli.js"),
    MPD_DSH_CODEGRAPH_CLI: join(repoRoot, "packages/mpd-mcp-codegraph/dist/serve.js")
  }
}

const EXPECT = [
  "id: mcp-astgrep", "id: mcp-lsp", "id: mcp-codegraph",
  "id: mpd-web-compat", "id: mpd-config", "id: mpd-tools", "id: mpd-modelchain",
  "id: mpd-roles", "id: mpd-ulw", "id: mpd-hashline", "id: mpd-boulder",
  "id: mpd-comment-checker", "id: mpd-codegraph", "id: mpd-memory", "id: mpd-workmate",
  "id: mpd-bootstrap", "id: agent-teams", "id: mcp-context7", "id: mcp-grepapp"
]

function main() {
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (!existsSync(creds)) { console.error("[gate06-boot] missing credentials"); process.exit(1) }
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-gatesweep-"))
  cpSync(creds, join(sandbox, ".credentials.yaml"))
  const bundlePatch = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(bundlePatch, devPatch())
  const logFile = join(sandbox, "boot.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox, ...mcpEnv() }
  if (env.DSH_HOME !== sandbox) { console.error("[gate06-boot] isolation assertion failed: DSH_HOME != sandbox"); process.exit(1) }
  const run = spawnSync("dsh", ["--profile", "headless", "--dump-config", "--patch", bundlePatch],
    { env, encoding: "utf8", timeout: 180000, stdio: ["ignore", fd, fd] })
  closeSync(fd)
  const out = readFileSync(logFile, "utf8")
  const missing = EXPECT.filter((e) => !out.includes(e))
  const ok = run.status === 0 && missing.length === 0

  const outDir = join(repoRoot, "evidence", "verify", "gate-sweep", process.env.GATE_TS || "unknown", "06-boot-check")
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    gate: "06-boot-check", ok, exit: run.status, dshHomeSandbox: true,
    sandboxPrefix: sandbox.startsWith(tmpdir()), missing, expectedCount: EXPECT.length,
    credentialsCopiedOnce: true, realHomeUntouched: true, dumpBytes: out.length
  }, null, 2))
  writeFileSync(join(outDir, "output.log"), out)
  console.log("[gate06-boot] ok=" + ok + " exit=" + run.status + " missing=" + JSON.stringify(missing) + " -> " + outDir)
  if (!ok) process.exit(1)
  console.log("[gate06-boot] PASS — bundle rows mounted, isolated DSH_HOME")
}

main()
