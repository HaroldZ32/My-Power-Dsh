#!/usr/bin/env node
// t10 settle discipline: pin the hashes of every artifact this verdict rests on, wait the ~50 s
// settle window, re-hash, and record whether anything moved (a moving hash invalidates the verdict).
// Run with node. Writes hashes.json.
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(HERE, "../../../..")
const PATHS = [
  "packages/mpd-agent-teams-plugin/lib/tools.js",
  "packages/mpd-agent-teams-plugin/lib/session-start.js",
  "packages/mpd-agent-teams-plugin/lib/command.js",
  "packages/mpd-agent-teams-plugin/lib/profiles.js",
  "packages/mpd-agent-teams-plugin/lib/members.js",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
  "packages/mpd-workmate-plugin/src/index.ts",
  "packages/mpd-workmate-plugin/dist/index.js",
  "packages/mpd-bundle/cordis.patch.yml",
  "packages/mpd-bundle-plugin/client.js",
  "packages/mpd-config-plugin/src/settings-schema.ts",
  "packages/mpd-config-plugin/src/index.ts",
]
const hashOf = (rel) => createHash("sha256").update(readFileSync(join(repoRoot, rel))).digest("hex")

const t0 = Object.fromEntries(PATHS.map((rel) => [rel, hashOf(rel)]))
const t0At = new Date().toISOString()
console.log("[t10 settle] pinned " + PATHS.length + " artifact hashes at " + t0At + "; waiting 50 s ...")
await new Promise((resolvePromise) => setTimeout(resolvePromise, 50000))
const t1 = Object.fromEntries(PATHS.map((rel) => [rel, hashOf(rel)]))
const changed = PATHS.filter((rel) => t0[rel] !== t1[rel])
const result = { ok: changed.length === 0, t0At, t1At: new Date().toISOString(), settleMs: 50000, changed, t0, t1 }
writeFileSync(join(HERE, "hashes.json"), JSON.stringify(result, null, 2))
console.log("[t10 settle] changed=" + JSON.stringify(changed) + " -> ok=" + result.ok)
process.exit(result.ok ? 0 : 1)
