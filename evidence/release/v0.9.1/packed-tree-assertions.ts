#!/usr/bin/env node
// v0.9.1 release assertions on the STAGED packed tree.
//
// `dsh plugin add dist/mpd-package` cannot complete on this host (pnpm store:
// [ERR_SQLITE_ERROR], measured in the v0.9.0 wave), so the packed proof is a set of
// assertions on the tree `node scripts/pack-mpd.mjs` just wrote — plus the honest note
// that the install was not run here. What is NEW in v0.9.1 is that the packed bytes must
// carry the defect fixes, not just the v0.9.0 features: a stale dist would ship the
// pre-fix behaviour while every source test stays green.
//
// Usage: node evidence/release/v0.9.1/packed-tree-assertions.mjs
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")
const packed = join(repo, "dist", "mpd-package")

const checks = []
const check = (label, ok, detail = "") => checks.push({ label, ok, detail })
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")
const read = (rel) => readFileSync(join(packed, rel), "utf8")

// 1) the packed manifest is the released version and still declares the v0.9.0 assets
const manifest = JSON.parse(read("package.json"))
check("packed manifest version is 0.9.1", manifest.version === "0.9.1", manifest.version)
check("packed manifest files covers extensions/**", (manifest.files ?? []).includes("extensions/**"))
check("packed manifest exports covers ./extensions/*", (manifest.exports ?? {})["./extensions/*"] === "./extensions/*")
check("packed manifest exports covers ./packages/*", (manifest.exports ?? {})["./packages/*"] === "./packages/*")

// 2) every shipped dist is byte-identical to the repo dist (a stale dist ships old behaviour)
for (const p of [
  "packages/mpd-ext-plugin/dist/index.js",
  "packages/mpd-ext-plugin/dist/sdk.js",
  "packages/mpd-roles-plugin/dist/index.js",
  "packages/mpd-agent-teams-plugin/lib/scheduler.js",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
]) {
  const same = existsSync(join(packed, p)) && sha(join(repo, p)) === sha(join(packed, p))
  check(`packed ${p} equals the repo bytes`, same, same ? sha(join(packed, p)).slice(0, 16) : "MISSING or DIFFERENT")
}

// 3) the FIXES are inside the packed bytes (the whole point of this release)
const extDist = read("packages/mpd-ext-plugin/dist/index.js")
check("F1 packed: the tool is kept and only the schema is dropped", extDist.includes("registered WITHOUT structuredContent"))
check("F2 packed: a non-object inputSchema root is normalized", extDist.includes("properties: { value: schema }") || extDist.includes("value: schema"))
check("F3 packed: an incomplete observation is returned on a failed enumeration", extDist.includes("complete: false"))
check("F4 packed: the catalog-backed serving report ships", extDist.includes("skillServing") && extDist.includes("notServed"))
check("F4 packed: the collision note prefix ships", extDist.includes("skill surface: "))
check("F5 packed: no process-cwd fallback in the provider paths", !extDist.includes("cwdOf(listOptions) ?? dsh.workspaceRoot()"))
check("F6 packed: descriptor env values are redacted", extDist.includes("<redacted>"))
check("F7 packed: the effective-enabled predicate is passed into the view", extDist.includes("isEnabled:"))
const sched = read("packages/mpd-agent-teams-plugin/lib/scheduler.js")
check("POOL packed: the capability guard ships", sched.includes("nextCapableTask") && sched.includes("taskCapabilityGap"))
const registry = read("packages/mpd-agent-teams-plugin/lib/mpd-deltas.js")
check("POOL packed: both regions are registered", registry.includes("mpd-delta pool-capability-guard") && registry.includes("mpd-delta pool-capability-select"))

// 4) the packed DOCS carry the corrected policy (both languages)
const en = read("packages/mpd-ext-plugin/README.md")
const zh = read("packages/mpd-ext-plugin/README.zh-CN.md")
check("packed EN README states the serving check", en.includes("notServed"))
check("packed ZH README states the serving check", zh.includes("notServed"))
check("packed EN README no longer says the tool is dropped", !en.includes("drops that one tool loudly"))

// 5) the packed patch is still dev-path free and carries the row
const patch = read("cordis.patch.yml")
check("packed patch carries the mpd-ext row", /-\s*id:\s*mpd-ext/.test(patch))
check("packed patch has zero dev-path leaks", !patch.includes(repo))

const failed = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.label}${c.detail === "" ? "" : ` (${c.detail})`}`)
console.log(`\n[packed-tree-assertions] ${checks.length - failed.length}/${checks.length} ok`)
console.log("[packed-tree-assertions] INSTALL: not run on this host (pnpm store [ERR_SQLITE_ERROR], carried over from v0.9.0) — these assertions are the packed proof")
const result = { wave: "v0.9.1", packed, checks, failed: failed.map((c) => c.label), installRun: false }
console.log(JSON.stringify(result, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
