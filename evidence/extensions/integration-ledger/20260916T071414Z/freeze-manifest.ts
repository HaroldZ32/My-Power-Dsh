#!/usr/bin/env node
// t17 freeze helper: digest every path in the working-tree change set.
// A file → sha256 + bytes. A directory → a tree digest over "relpath sha256" lines, sorted
// (the same aggregation VENDOR_LOCK.json uses for the skills corpus), plus its file count and bytes.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
function findRepo(start) {
  let dir = start
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, "package.json")
    if (existsSync(candidate)) {
      try {
        if (JSON.parse(readFileSync(candidate, "utf8")).name === "@mpd-dsh/mpd") return dir
      } catch {}
    }
    const parent = resolve(dir, "..")
    if (parent === dir) break
    dir = parent
  }
  throw new Error("repo not found")
}
const REPO = findRepo(HERE)
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex")

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(child))
    else if (entry.isFile()) out.push(child)
  }
  return out
}

function describe(relpath) {
  const absolute = join(REPO, relpath)
  if (!existsSync(absolute)) return { path: relpath, missing: true }
  const stats = statSync(absolute)
  if (stats.isFile()) {
    const body = readFileSync(absolute)
    return { path: relpath, kind: "file", bytes: body.length, sha256: sha256(body) }
  }
  const files = walk(absolute).sort()
  const lines = []
  let bytes = 0
  for (const file of files) {
    const body = readFileSync(file)
    bytes += body.length
    lines.push(`${relative(absolute, file).split("\\").join("/")} ${sha256(body)}`)
  }
  return { path: relpath.replace(/\/$/, "") + "/", kind: "dir", fileCount: files.length, bytes, treeSha256: sha256(lines.join("\n") + "\n") }
}

const status = execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).trimEnd().split("\n").filter(Boolean)
const changed = status.map((line) => ({ state: line.slice(0, 2).trim(), path: line.slice(3).trim() }))
const manifest = {
  task: "t17",
  frozenAtUtc: new Date().toISOString(),
  branch: execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(),
  changeSet: changed.map((entry) => `${entry.state} ${entry.path}`),
  digests: changed.map((entry) => ({ state: entry.state, ...describe(entry.path) })),
}
writeFileSync(join(HERE, "freeze-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
process.stdout.write(`freeze manifest: branch ${manifest.branch} HEAD ${manifest.head}, ${manifest.changeSet.length} changed path(s)\n\n`)
for (const entry of manifest.digests) {
  const digest = entry.kind === "dir" ? `tree ${entry.treeSha256} (${entry.fileCount} files, ${entry.bytes} B)` : `${entry.sha256} (${entry.bytes} B)`
  process.stdout.write(`${entry.state.padEnd(2)} ${entry.path.padEnd(64)} ${digest}\n`)
}
