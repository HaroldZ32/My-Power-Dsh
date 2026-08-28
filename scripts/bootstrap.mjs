#!/usr/bin/env node
// P0 bootstrap: preflight checks + vendor verification; from P1 expand to initialize an isolated DSH_HOME from profiles/* templates.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const step = (msg) => console.log("[bootstrap] " + msg)
let failed = false

for (const [bin, args] of [["node", ["--version"]], ["bun", ["--version"]], ["git", ["--version"]], ["dsh", ["--version"]]]) {
  const r = spawnSync(bin, args, { encoding: "utf8" })
  if (r.status !== 0) { console.error("[bootstrap] missing " + bin); failed = true }
  else step(bin + " " + r.stdout.trim())
}

const verify = spawnSync("node", [join(repoRoot, "scripts", "verify-vendor.mjs")], { stdio: "inherit" })
if (verify.status !== 0) failed = true

for (const d of ["packages/mpd-bundle", "packages/mpd-bootstrap-plugin", "packages/mpd-roles-plugin"]) {
  if (!existsSync(join(repoRoot, d))) { console.warn("[bootstrap] missing: " + d); failed = true }
}

if (failed) { console.error("[bootstrap] FAIL"); process.exit(1) }
step("PASS - preflight and vendor baseline checks passed (set MPD_UPSTREAM_ROOT if the the upstream checkout is not at repoRoot/../../..)")
