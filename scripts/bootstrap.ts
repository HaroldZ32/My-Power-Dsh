#!/usr/bin/env node
// P0 bootstrap: preflight checks + vendor verification; from P1 expand to initialize an isolated DSH_HOME from profiles/* templates.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { repoRootFrom } from "./lib/repo.ts"

/** The repository root, derived from this bootstrap script's own URL (`<root>/scripts/bootstrap.ts`). */
const repoRoot: string = repoRootFrom(import.meta.url)
/** Print one `[bootstrap]`-prefixed progress line. */
const step = (msg: string): void => console.log("[bootstrap] " + msg)
/** Whether any preflight or vendor check has failed; the exit code is derived from it at the end. */
let failed: boolean = false

/** The four tools the preflight probes, each with the argument that prints its version. */
const REQUIRED_BINS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["node", ["--version"]],
  ["bun", ["--version"]],
  ["git", ["--version"]],
  ["dsh", ["--version"]],
]
for (const [bin, args] of REQUIRED_BINS) {
  /** The probe's result; a non-zero status (or a spawn error) means the tool is missing. */
  const r = spawnSync(bin, args, { encoding: "utf8" })
  if (r.status !== 0) { console.error("[bootstrap] missing " + bin); failed = true }
  else step(bin + " " + r.stdout.trim())
}

/** The vendor gate's result: any non-zero status fails the bootstrap (stdio is inherited). */
const verify = spawnSync("node", [join(repoRoot, "scripts", "verify-vendor.ts")], { stdio: "inherit" })
if (verify.status !== 0) failed = true

// Entry directory name of each package the bootstrap requires to exist.
for (const d of ["packages/mpd-bundle", "packages/mpd-bootstrap-plugin", "packages/mpd-roles-plugin"]) {
  if (!existsSync(join(repoRoot, d))) { console.warn("[bootstrap] missing: " + d); failed = true }
}

if (failed) { console.error("[bootstrap] FAIL"); process.exit(1) }
step("PASS - preflight and shipped-asset checks passed (the vendor gate checks VENDOR_LOCK.json fingerprints only; no upstream checkout is resolved or needed)")
