#!/usr/bin/env node
// t11 post-completion staged-tree assertions (the packed-proof method t7 prescribed).
//
// The packed INSTALL via `dsh plugin add` cannot complete on this host (pnpm store:
// [ERR_SQLITE_ERROR]; measured twice by t7). This script therefore proves the packed
// GREEN by ASSERTING THE STAGED TREE that `node scripts/pack-mpd.mjs` just wrote, and
// it records the install block explicitly instead of claiming an install it cannot run.
//
// It also re-states the BEFORE state t7 measured precisely, so the RED->GREEN delta is
// in one place.
//
// Usage: node evidence/release/v0.9.0-integration/<ts>/packed-tree-assertions.mjs
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../..")
const packed = join(repo, "dist", "mpd-package")

const checks = []
const check = (label, ok, detail = "") => checks.push({ label, ok, detail })
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const rel = (p) => p.slice(repo.length + 1)

// 1) the three things the omission class silently dropped
for (const p of [
  "packages/mpd-ext-plugin/dist/index.js",
  "packages/mpd-ext-plugin/dist/sdk.js",
]) {
  check(`staged ${p}`, existsSync(join(packed, p)))
}
check("staged extensions/mpd-ext-example/mpd-ext.json", existsSync(join(packed, "extensions/mpd-ext-example/mpd-ext.json")))
check("staged extensions/mpd-ext-example/server.mjs", existsSync(join(packed, "extensions/mpd-ext-example/server.mjs")))
check("staged scripts/mpd-ext.mjs", existsSync(join(packed, "scripts/mpd-ext.mjs")))

// 2) the rebuilt dists are byte-identical to the source-built ones (dist matches src)
for (const p of ["packages/mpd-ext-plugin/dist/index.js", "packages/mpd-ext-plugin/dist/sdk.js", "packages/mpd-roles-plugin/dist/index.js"]) {
  const a = join(repo, p), b = join(packed, p)
  const same = existsSync(a) && existsSync(b) && sha(a) === sha(b)
  check(`packed ${p} equals the repo dist byte-for-byte`, same, same ? sha(b).slice(0, 16) : "")
}

// 3) the packed manifest declares the asset and the row is still in the packed patch
const manifest = JSON.parse(readFileSync(join(packed, "package.json"), "utf8"))
check("packed manifest version is 0.9.0", manifest.version === "0.9.0", manifest.version)
check("packed manifest files covers extensions/**", (manifest.files ?? []).includes("extensions/**"))
check("packed manifest exports covers ./extensions/*", (manifest.exports ?? {})["./extensions/*"] === "./extensions/*")
check("packed manifest files covers scripts/**", (manifest.files ?? []).includes("scripts/**"))
const patch = readFileSync(join(packed, "cordis.patch.yml"), "utf8")
check("packed patch still carries the mpd-ext row", /-\s*id:\s*mpd-ext/.test(patch))
check("packed patch points the row at the packed name", patch.includes("'@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/index.js'"))
check("packed patch has zero dev-path leaks", !patch.includes(repo), "")
check("packed patch rewrote no absolute dev path for the ext plugin", !new RegExp(`${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/packages/mpd-ext-plugin`).test(patch))

// 4) the shipped reference extension is a real extension (manifest + its MCP server)
const exampleManifest = JSON.parse(readFileSync(join(packed, "extensions/mpd-ext-example/mpd-ext.json"), "utf8"))
check("example manifest is apiVersion 1", exampleManifest.apiVersion === 1, String(exampleManifest.apiVersion))
check("example manifest is DISABLED by default", exampleManifest.enabled === false, String(exampleManifest.enabled))
check("example contributes all four kinds", ["skills", "flows", "mcp", "roles"].every((k) => (exampleManifest.contributes ?? {})[k] !== undefined))

// 5) the file count the packer reported (1107) matches the staged tree
let count = 0
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else count += 1
  }
}
walk(packed)
check("staged file count is 1107", count === 1107, String(count))

const failed = checks.filter((c) => !c.ok)
const report = {
  proof: "STAGED-TREE assertions after node scripts/pack-mpd.mjs (packed GREEN by construction)",
  why_not_install: "`dsh plugin add <packed-dir>` cannot complete on this host: pnpm fails with `[ERR_SQLITE_ERROR] unable to open database file`, reproduced by t7's owner with HOME=/root and with a sandbox HOME — environmental, not the packed tree. t7 recorded it in evidence/extensions/t7-verify/20260914T174828Z/result.json. This task did NOT attempt pnpm again (captain's instruction) and instead ran a real packed INSTALL through the npm path: skills/dsh-qa/scripts/relocate-smoke.mjs --no-skip = PASS (install ok, no dev-path leak, relocated live boot ok, zero home copies).",
  before_state_measured_by_t7: {
    source: "evidence/extensions/t7-verify/20260914T174828Z/result.json",
    red: "pack-mpd.mjs exits 0 while the staged tree has NEITHER packages/mpd-ext-plugin/ NOR extensions/, while the staged patch still declares the mpd-ext row — the silent-exit-0 class",
    staged_files_then: 1095,
    packed_manifest_files_exports_then: "named neither extensions/** nor ./extensions/*",
  },
  after_state_measured_now: {
    staged_files: count,
    green: "packages/mpd-ext-plugin/{dist/index.js,dist/sdk.js}, extensions/mpd-ext-example/{mpd-ext.json,server.mjs}, scripts/mpd-ext.mjs all staged; packed manifest files/exports cover the asset; the packed patch keeps the mpd-ext row in packed-name form with zero dev-path leaks",
  },
  checks,
  passed: failed.length === 0,
}
console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) {
  console.error(`[packed-tree-assertions] FAIL: ${failed.length} check(s) failed: ${failed.map((c) => c.label).join("; ")}`)
  process.exit(1)
}
console.error(`[packed-tree-assertions] PASS: ${checks.length}/${checks.length} checks`)
