#!/usr/bin/env node
// Case mount-assert: under an isolated DSH_HOME, use real dsh --dump-config to assert the plugin rows are mounted.
// --self-test is the offline self-test (fixture text, no network, no real API).
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { credentialEnv } from "./lib/credentials.ts"

/** The wrapper's `--json` envelope: the composer output this case asserts on rides in `stdout`. */
interface DumpEnvelope {
  /** The composer's stdout, absent when the wrapper reported none. */
  readonly stdout?: string
}

/**
 * @param text The wrapper's raw `--json` stdout.
 * @returns The captured composer stdout, or the raw text when it does not parse as JSON.
 */
const dumpJsonText = (text: string): string => {
  try {
    // The envelope is a JSON document this lane does not own; the cast names the single field it reads.
    return (JSON.parse(text) as DumpEnvelope).stdout ?? ""
  } catch {
    return String(text ?? "")
  }
}
// scripts/<domain>/<slug>/<file> -> repo root
/** The repository root, derived from this script's own URL (four directories up). */
const repoRoot: string = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
/** The offline fixture patch the presence/absence detection is proven on (never a real dump). */
const FIXTURE = `# == base
- id: llm
  name: '@deepseek-ai/dsh-llm'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
`

/** What one assertion pass found: whether it held, and which expectations it could not match. */
interface ExpectationResult {
  /** True when every expected substring is present in the searched text. */
  ok: boolean
  /** The expected substrings that are missing, in expectation order. */
  missing: string[]
}

/**
 * @param text The text to search (a composer dump, or the fixture).
 * @param expectations The substrings that must all be present.
 * @returns Whether every expectation matched, plus the ones that did not.
 */
function assertExpectations(text: string, expectations: readonly string[]): ExpectationResult {
  // The expected substrings the text does not contain, in the order they were given.
  const missing = expectations.filter((e) => !text.includes(e))
  return { ok: missing.length === 0, missing }
}

/** The offline self-test: presence AND absence detection must both hold on the fixture. */
function selfTest(): void {
  // The fixture searched for a row it declares, which must be reported present.
  const present = assertExpectations(FIXTURE, ["name: '@deepseek-ai/dsh-llm'"])
  // The fixture searched for a row it does NOT declare, which must be reported absent.
  const absent = assertExpectations(FIXTURE, ["name: '@deepseek-ai/dsh-llm-deepseek'"])
  if (!present.ok) { console.error("[mount-assert self-test] FAIL: presence detection broken:", present.missing); process.exit(1) }
  if (absent.ok) { console.error("[mount-assert self-test] FAIL: absence detection broken"); process.exit(1) }
  console.log("[mount-assert self-test] ok: presence/absence detection verified on fixture")
}

/** Run the real composer in a throwaway DSH_HOME and assert the `--expect` substrings against its dump. */
function main(): void {
  // The raw command-line arguments, in the order the caller passed them.
  const args = process.argv.slice(2)
  if (args.includes("--self-test")) { selfTest(); return }
  // The expected row substrings collected from `--expect`/`--expect=` arguments, in call order.
  const expect: string[] = []
  for (let i = 0; i < args.length; i++) {
    // The argument at the current cursor, inspected for the two --expect spellings.
    const a = args[i]
    if (a.startsWith("--expect=")) expect.push(a.slice("--expect=".length))
    else if (a === "--expect" && i + 1 < args.length) expect.push(args[++i])
  }
  if (expect.length === 0) { console.error("usage: mount-assert.ts --expect=<substring> [--expect=...] | --self-test"); process.exit(2) }

  // The throwaway DSH_HOME the composer child is isolated in (never the real ~/.dsh).
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dsh-qa-"))
  // The caller's environment plus that sandbox home, with the credential key folded in.
  const env = credentialEnv({ ...process.env, DSH_HOME: sandbox  })
  // `DSH_HOME` is optional in the env record, yet the line above always sets it to the sandbox.
  if (!(env.DSH_HOME as string).startsWith(sandbox)) { console.error("[mount-assert] isolation assertion failed: DSH_HOME does not point to the temp directory"); process.exit(1) }

  // T-69: the sanctioned composer is the wrapper (its banner goes to stderr under --json).
  const run = spawnSync(process.execPath, [join(repoRoot, "scripts", "dump-config.ts"), "--profile", "headless", "--json"], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) {
    console.error("[mount-assert] dsh --dump-config failed:", run.stderr?.slice(0, 2000))
    process.exit(1)
  }
  // The composer's own stdout, unwrapped from the wrapper's JSON envelope.
  const dump = dumpJsonText(run.stdout)
  // The verdict of the expectations against that dump.
  const result = assertExpectations(dump, expect)

  // The timestamped evidence directory this run records into.
  const outDir = join(repoRoot, "evidence", "dsh-qa", "mount-assert", new Date().toISOString().replaceAll(":", "-"))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ ok: result.ok, missing: result.missing, expectations: expect, dshHomeSandbox: true, dumpBytes: dump.length }, null, 2))
  writeFileSync(join(outDir, "dump.txt"), dump)
  console.log("[mount-assert] evidence ->", outDir)
  if (!result.ok) { console.error("[mount-assert] FAIL missing:", result.missing); process.exit(1) }
  console.log("[mount-assert] PASS:", expect.length, "expectation(s) satisfied")
  rmSync(sandbox, { recursive: true, force: true })
}

main()
