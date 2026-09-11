#!/usr/bin/env node
// B8 gate part 3 (deterministic, packed layout): the packed bundle must SHIP the
// launchers (the new failure mode t1 §5 item 4 names), and from an INSTALLED tree
// (`<profile>/node_modules/@mpd-dsh/mpd/...`) the resolver must pick the
// createRequire tier (packed optionalDependency) instead of the checkout
// `.toolchain` tier — then answer a real MCP call.
//
// Run after `node scripts/pack-mpd.mjs`:
//   node evidence/wave2/b8-binary-resolution/b8-packed-gate.mjs
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { probe } from "./mcp-probe.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const staged = join(repoRoot, "dist", "mpd-package")
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 700) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

const sandbox = mkdtempSync(join(tmpdir(), "b8-packed-"))
let cwd
try {
  // 1. the staged package ships the launchers + the shared resolver.
  const shipped = [
    join(staged, "packages", "mpd-mcp-astgrep", "launch.mjs"),
    join(staged, "packages", "mpd-mcp-codegraph", "launch.mjs"),
    join(staged, "packages", "mpd-mcp-shared", "bin-resolve.mjs"),
  ]
  check("packed bundle ships both launchers + the shared resolver",
    shipped.every((p) => existsSync(p)),
    shipped.map((p) => `${p.replace(repoRoot + "/", "")}=${existsSync(p)}`).join(" "))

  // 2. REAL packed install: npm pack the staged bundle, then install the TARBALL into
  // a sandbox profile. A `file:<dir>` dependency is symlinked and its
  // optionalDependencies are NOT installed (same as pnpm link:), so only the tarball
  // exercises the hoisted packed layout (`<profile>/node_modules/@ast-grep/cli`, …).
  const profileDir = join(sandbox, "profiles", "b8-packed")
  mkdirSync(profileDir, { recursive: true })
  const packDir = join(sandbox, "pack")
  mkdirSync(packDir, { recursive: true })
  const npmEnv = { ...process.env, npm_config_cache: join(sandbox, "npm-cache"), npm_config_logs_dir: join(sandbox, "npm-logs") }
  const packed = spawnSync("npm", ["pack", "--pack-destination", packDir], { cwd: staged, env: npmEnv, encoding: "utf8", timeout: 300_000 })
  const tgz = packed.status === 0 ? (readdirSync(packDir).find((f) => f.endsWith(".tgz")) ?? null) : null
  check("packed bundle: npm pack succeeds and the tarball ships the launchers",
    Boolean(tgz), `exit=${packed.status} tgz=${tgz ?? "none"} ${(packed.stderr ?? "").slice(0, 200)}`)
  writeFileSync(join(profileDir, "package.json"), JSON.stringify({ name: "dsh-profile-b8-packed", private: true, dependencies: { ["@mpd-dsh/mpd"]: "file:" + join(packDir, tgz ?? "missing.tgz") } }, null, 2) + "\n")
  const inst = spawnSync("npm", ["install", "--prefix", profileDir, "--no-audit", "--no-fund"], {
    env: npmEnv, encoding: "utf8", timeout: 900_000, maxBuffer: 32 * 1024 * 1024,
  })
  if (inst.status !== 0) {
    check("packed npm install", false, (inst.stdout ?? "") + (inst.stderr ?? ""))
    throw new Error("packed install failed")
  }
  const installed = join(profileDir, "node_modules", "@mpd-dsh", "mpd")
  const astLaunch = join(installed, "packages", "mpd-mcp-astgrep", "launch.mjs")
  const cgLaunch = join(installed, "packages", "mpd-mcp-codegraph", "launch.mjs")
  check("packed install: bundle + launchers present under node_modules/@mpd-dsh/mpd",
    existsSync(astLaunch) && existsSync(cgLaunch), `${astLaunch} exists=${existsSync(astLaunch)}`)

  // 3. resolver tier: from the installed launcher, which tier wins?
  const resolveDump = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { resolveAstGrepBinary, resolveCodegraphBinary } from ${JSON.stringify("file://" + join(installed, "packages", "mpd-mcp-shared", "bin-resolve.mjs"))}
const a = resolveAstGrepBinary(${JSON.stringify("file://" + astLaunch)})
const c = resolveCodegraphBinary(${JSON.stringify("file://" + cgLaunch)})
console.log(JSON.stringify({ astGrep: a, codegraph: c }))
`], { encoding: "utf8", timeout: 60_000 })
  const resolved = JSON.parse((resolveDump.stdout ?? "{}").trim() || "{}")
  check("packed layout: ast-grep resolves through createRequire (packed optionalDependency), not the checkout toolchain",
    resolved.astGrep?.source === "require" && /@ast-grep[\\/]cli/.test(resolved.astGrep?.binary ?? ""),
    JSON.stringify(resolved.astGrep))
  check("packed layout: codegraph resolves through createRequire (packed optionalDependency)",
    resolved.codegraph?.source === "require" && /@colbymchenry[\\/]codegraph/.test(resolved.codegraph?.binary ?? ""),
    JSON.stringify(resolved.codegraph))

  // 4. real MCP calls through the INSTALLED launchers, no env pins.
  cwd = mkdtempSync(join(repoRoot, ".b8-packed-cwd-"))
  const env = { ...process.env, HOME: sandbox }
  for (const k of ["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI", "MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI"]) delete env[k]
  const r1 = await probe(astLaunch, "search", { pattern: "return 0", language: "c", paths: [join(repoRoot, "tests", "mcp-fixtures", "sample.c")] }, { cwd, env })
  check("packed layout: real ast-grep search through the installed launcher returns a real match",
    r1.ok && /"totalMatches":1/.test(r1.result?.text ?? ""), `ok=${r1.ok} text=${String(r1.result?.text ?? "").slice(0, 200)}`)
  const r2 = await probe(cgLaunch, "--list", undefined, { cwd, env })
  check("packed layout: codegraph launcher serves the real tool surface",
    r2.ok && (r2.tools ?? []).includes("codegraph_explore") && !/skipped/.test(r2.stderr ?? ""),
    `tools=${JSON.stringify(r2.tools)} stderr=${r2.stderr}`)

  // 5. negative control still holds in the packed layout.
  const r3 = await probe(astLaunch, "search", { pattern: "return 0", language: "c", paths: [join(repoRoot, "tests", "mcp-fixtures", "sample.c")] },
    { cwd, env: { ...env, MPD_AST_GREP_SG_PATH: "/nonexistent/sg" } })
  check("packed layout negative control: a wrong caller pin still yields BINARY_NOT_FOUND",
    r3.result?.isError === true && /BINARY_NOT_FOUND/.test(r3.result?.text ?? ""), String(r3.result?.text ?? "").slice(0, 200))
} catch (e) {
  check("packed gate crashed", false, String(e))
} finally {
  if (cwd) rmSync(cwd, { recursive: true, force: true })
  rmSync(sandbox, { recursive: true, force: true })
}

const result = {
  task: "t6 B8 deterministic MCP gate — packed layout",
  stamp: new Date().toISOString(),
  layout: "packed (dist/mpd-package installed with npm into a sandbox profile)",
  checks,
  allPass: checks.every((c) => c.pass),
}
writeFileSync(join(here, "packed-gate.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — packed-gate.result.json")
process.exit(result.allPass ? 0 : 1)
