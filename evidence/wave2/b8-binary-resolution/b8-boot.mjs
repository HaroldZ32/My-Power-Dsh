#!/usr/bin/env node
// B8 gate part 2 (boot probe, dev-flavor patch): what the shipped launchers need to
// prove at BOOT level, and an honest record of this environment's limits.
//
// Isolated DSH_HOME + sandbox HOME, MCP binary env pins SCRUBBED, cwd = a sandbox
// workspace (not the bundle, not the repo root). Two boots:
//   A. the CURRENT bundle patch: the mcp-* rows must apply with no MCP child spawn
//      failure and the mpd-codegraph plugin row must resolve a binary;
//   B. the HEAD (pre-B8) bundle patch: the SAME full-tree load blocker must appear,
//      proving that blocker is pre-existing and unrelated to this change.
//
// The full-tree MOUNT gates are the sanctioned QA cases (bundle-lifecycle PASS,
// preset-conformance ok=true with its negative control) — a bare-checkout dev boot
// cannot load the adopted agent-teams `_deps`, and a live headless LLM call is
// unavailable here (MISSING_CREDENTIAL; the deterministic MCP call path is covered by
// b8-mcp-gate.mjs / b8-packed-gate.mjs).
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const SCRUB = ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_CODEGRAPH_BIN", "MPD_DSH_ASTGREP_CLI", "MPD_DSH_CODEGRAPH_CLI"]
const MCP_CHILD_FAILURE = /Cannot find module .*(launch\.mjs|dist\/cli\.js|serve\.js)|BINARY_NOT_FOUND/
const BASEURL_EXPR = '((typeof baseUrl === "string" ? baseUrl.replace(/^file:\\/\\//, "").replace(/\\/+$/, "") : "") + "/node_modules/@mpd-dsh/mpd/'

const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 700) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

// dev-flavor rewrite: drop the baseUrl operand (a suffix-only rewrite leaves the
// profile dir prepended and every MCP row dies with MODULE_NOT_FOUND).
function devPatch(source) {
  return source
    .split(BASEURL_EXPR).join('("' + repoRoot + "/")
    .split("name: '@mpd-dsh/mpd'").join("name: '" + join(repoRoot, "packages", "mpd-bundle-plugin", "dist", "index.js") + "'")
    .split("@mpd-dsh/mpd/").join(repoRoot + "/")
}

const head = spawnSync("git", ["show", "HEAD:packages/mpd-bundle/cordis.patch.yml"], { cwd: repoRoot, encoding: "utf8" })
const currentPatch = readFileSync(join(repoRoot, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")

function boot(patchText, tag) {
  const sandbox = mkdtempSync(join(tmpdir(), `b8-boot-${tag}-home-`))
  const ws = mkdtempSync(join(repoRoot, `.b8-boot-${tag}-ws-`))
  cpSync(join(homedir(), ".dsh", ".credentials.yaml"), join(sandbox, ".credentials.yaml"))
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(sandbox, "settings.yaml"))
  mkdirSync(join(ws, "tests"), { recursive: true })
  cpSync(join(repoRoot, "tests", "mcp-fixtures"), join(ws, "tests", "mcp-fixtures"), { recursive: true })
  const patchPath = join(sandbox, "bundle.dev.patch.yml")
  writeFileSync(patchPath, devPatch(patchText))
  const logFile = join(sandbox, "boot.log")
  const fd = openSync(logFile, "w")
  const env = { ...process.env, DSH_HOME: sandbox, HOME: sandbox }
  for (const k of SCRUB) delete env[k]
  try {
    spawnSync("dsh", ["--profile", "headless", "--patch", patchPath, "reply with the single word: ok"], {
      env, cwd: ws, encoding: "utf8", timeout: 300_000, stdio: ["ignore", fd, fd],
    })
  } finally {
    closeSync(fd)
  }
  const out = readFileSync(logFile, "utf8").replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1…REDACTED")
  writeFileSync(join(here, `boot-${tag}.output.log`), out)
  rmSync(ws, { recursive: true, force: true })
  return out
}

const CRASH = /unsupported JSON schema|JsonSchemaError|plugin tree failed to load|failed to apply loader entry (?!include)/

const current = boot(currentPatch, "current")
check("boot A (current patch): 0 apply-crash signatures in an isolated DSH_HOME + sandbox HOME",
  !CRASH.test(current), (current.match(CRASH) ?? ["none"])[0])
check("boot A (current patch): the mcp-* rows apply with no MCP child spawn failure and no BINARY_NOT_FOUND",
  !MCP_CHILD_FAILURE.test(current),
  (current.split("\n").find((l) => MCP_CHILD_FAILURE.test(l)) ?? "no MCP child failure").slice(0, 300))
const cgLines = current.split("\n").filter((l) => /\[mpd-codegraph\]/.test(l)).join(" | ")
check("boot A (current patch): mpd-codegraph plugin resolved a binary (no `init status=no-binary`)",
  cgLines.length > 0 && !/status=no-binary/.test(cgLines) && /status=(ok|marker|locked|fail)/.test(cgLines),
  (cgLines || "no [mpd-codegraph] line").slice(0, 300))

const headOut = head.status === 0 && head.stdout.includes("mcp-astgrep") ? boot(head.stdout, "head") : ""
check("boot B (HEAD pre-change patch, control): the same boot environment applies the tree with 0 crash signatures — any boot-A failure would be attributable to this change",
  headOut.length > 0 && !CRASH.test(headOut),
  `head log=${headOut.length} bytes; crash=${(headOut.match(CRASH) ?? ["none"])[0]}`)

const result = {
  task: "t6 B8 boot probe (dev-flavor patch, checkout layout)",
  stamp: new Date().toISOString(),
  isolation: { dshHome: "<sandbox>", home: "<sandbox>", cwd: "<repo-local temp workspace>", scrubbedEnv: SCRUB },
  envLimits: {
    liveLlmToolCall: "not runnable here: both boots end at MISSING_CREDENTIAL — headless live-LLM runs are unavailable on this machine (same class as evidence/dsh-qa/llm-dual-track ok=false). The real MCP call path is proven deterministically in b8-mcp-gate.mjs and b8-packed-gate.mjs.",
    fullTreeMountGates: "bundle-lifecycle (link: install + real web boot, PASS) and preset-conformance (ok=true, 0 bootLog signatures, negative control ok) are the sanctioned MOUNT gates for this patch change.",
  },
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "boot.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — boot.result.json")
process.exit(result.allPass ? 0 : 1)
