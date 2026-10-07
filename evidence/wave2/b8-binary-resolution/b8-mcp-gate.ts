#!/usr/bin/env node
// B8 gate part 1 (deterministic, no LLM): drive the two SHIPPED launchers as real
// MCP servers from a cwd that contains neither node_modules nor .toolchain, and
// pin the falsifiability with the two env-pin negative controls from t1 §5.
//
// Run: node evidence/wave2/b8-binary-resolution/b8-mcp-gate.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { probe } from "./mcp-probe.ts"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..", "..", "..")
const AST_LAUNCH = join(repoRoot, "packages", "mpd-mcp-astgrep", "launch.mjs")
const CG_LAUNCH = join(repoRoot, "packages", "mpd-mcp-codegraph", "launch.mjs")
const FIXTURE = join(repoRoot, "tests", "mcp-fixtures", "sample.c")

// cwd must be a directory with no node_modules/.toolchain (proves the resolution is
// bundle-relative, not cwd-relative) and, for codegraph, not /tmp and without an
// `.mpd` path segment (the upstream exclusion policy).
const cwd = mkdtempSync(join(repoRoot, ".b8-gate-cwd-"))
const home = mkdtempSync(join(tmpdir(), "b8-gate-home-"))
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 600) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${String(detail).slice(0, 240)}`)
}

function env(scrub, extra = {}) {
  const e = { ...process.env, HOME: home, ...extra }
  for (const k of scrub) delete e[k]
  return e
}

try {
  // 1. ast-grep: real search through the shipped launcher, no env pin.
  const astEnv = env(["MPD_AST_GREP_SG_PATH", "MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI"])
  const r1 = await probe(AST_LAUNCH, "search", { pattern: "return 0", language: "c", paths: [FIXTURE] }, { cwd, env: astEnv })
  const r1text = r1.result?.text ?? ""
  check("ast-grep launcher: real mcp search returns a real match (no env pin, cwd outside the bundle)",
    r1.ok && /"totalMatches":1/.test(r1text) && r1text.includes("return 0;"),
    `ok=${r1.ok} tools=${JSON.stringify(r1.tools)} text=${r1text.slice(0, 200)}`)

  // 2. ast-grep negative control: a wrong env pin wins and the adopted chain fails.
  const r2 = await probe(AST_LAUNCH, "search", { pattern: "return 0", language: "c", paths: [FIXTURE] },
    { cwd, env: env(["MPD_AST_GREP_BIN_DIR", "MPD_DSH_ASTGREP_CLI"], { MPD_AST_GREP_SG_PATH: "/nonexistent/sg" }) })
  const r2text = r2.result?.text ?? ""
  check("ast-grep negative control: MPD_AST_GREP_SG_PATH=/nonexistent/sg -> BINARY_NOT_FOUND (launcher must not override a caller pin)",
    r2.result?.isError === true && r2text.includes("BINARY_NOT_FOUND"),
    `isError=${r2.result?.isError} text=${r2text.slice(0, 220)}`)

  // 3. codegraph: real tools/list + a real explore call through the shipped launcher.
  const cgEnv = env(["MPD_CODEGRAPH_BIN", "MPD_DSH_CODEGRAPH_CLI"])
  const r3 = await probe(CG_LAUNCH, "--list", undefined, { cwd, env: cgEnv })
  check("codegraph launcher: real tool surface (not the 'skipped' stub)",
    r3.ok && (r3.tools ?? []).includes("codegraph_explore") && !/skipped/.test(r3.stderr ?? ""),
    `ok=${r3.ok} tools=${JSON.stringify(r3.tools)} stderr=${r3.stderr}`)
  writeFileSync(join(cwd, "util.ts"), "export function norm(x: number) { return x < 0 ? 0 : x }\n")
  const r4 = await probe(CG_LAUNCH, "codegraph_explore", { query: "norm" }, { cwd, env: cgEnv })
  check("codegraph launcher: real codegraph_explore answers with content",
    r4.ok && /Exploration: norm/.test(r4.result?.text ?? ""),
    `ok=${r4.ok} text=${String(r4.result?.text ?? "").slice(0, 160)}`)

  // 4. codegraph negative control: a wrong env pin disables the adopted fallback chain.
  const r5 = await probe(CG_LAUNCH, "--list", undefined,
    { cwd, env: env(["MPD_DSH_CODEGRAPH_CLI"], { MPD_CODEGRAPH_BIN: "/nonexistent/codegraph" }) })
  check("codegraph negative control: MPD_CODEGRAPH_BIN=/nonexistent/codegraph -> unavailable/skipped, never a live tool surface",
    (r5.tools ?? []).length === 0 && /skipped|unavailable/i.test((r5.stderr ?? "") + JSON.stringify(r5.error ?? "")),
    `tools=${JSON.stringify(r5.tools)} stderr=${r5.stderr} error=${r5.error}`)
} catch (e) {
  check("gate crashed", false, String(e))
} finally {
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
}

const result = {
  task: "t6 B8 deterministic MCP gate",
  stamp: new Date().toISOString(),
  layout: "checkout (link:)",
  launchers: { astGrep: AST_LAUNCH, codegraph: CG_LAUNCH },
  checks,
  allPass: checks.every((c) => c.pass),
}
mkdirSync(here, { recursive: true })
writeFileSync(join(here, "mcp-gate.result.json"), JSON.stringify(result, null, 2))
console.log("\n" + (result.allPass ? "PASS" : "FAIL") + " — mcp-gate.result.json")
process.exit(result.allPass ? 0 : 1)
