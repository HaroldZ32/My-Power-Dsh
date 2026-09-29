#!/usr/bin/env node
// T-67 evidence: the DECISIVE round trip the acceptance names — `(cd packages/<pkg> && bun run build)`
// followed by `node scripts/verify-dist-fresh.mjs --only packages/<pkg> --quiet` — plus the digest proof
// that the round trip is a no-op on the committed dist (it reproduces the SAME bytes, which is what the
// canonical form is for).
//
// MEASURED PREMISE, and why the scripts carry a cwd anchor: with the bare canonical command (no anchor)
// the round trip exits 1 — `FileNotFound opening root directory "packages/<pkg>/src"` — because `bun run`
// executes a package script with the PACKAGE directory as cwd. The anchor makes the same repo-root command
// runnable from either cwd; the built bytes are identical either way (both run from the repository root).
//
// The watchdog package is deliberately NOT round-tripped here: t10 (lane C) has in-flight edits in its
// `src/**`, so a build now would bake a half-edited source into the committed dist. Its dist is theirs to
// rebuild (message sent, and reported in REPORT.md §4).
//
// usage: node t67-round-trip.mjs      (run from the repository root)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const repo = process.cwd()
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)
const run = (cmd, args, cwd) => {
  try {
    return { exitCode: 0, output: execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }) }
  } catch (error) {
    return { exitCode: error.status ?? -1, output: String(error.stdout ?? "") + String(error.stderr ?? "") }
  }
}

const targets = [
  { pkg: "mpd-ext-plugin", dist: "packages/mpd-ext-plugin/dist/index.js" },
  { pkg: "mpd-tui-plugin", dist: "packages/mpd-tui-plugin/dist/index.js" },
]
const report = { schema: "laneB/t67-round-trip/1", captured_at: new Date().toISOString(), readings: [], not_run: [], ok: false }
for (const target of targets) {
  const distAbs = join(repo, target.dist)
  const before = sha(distAbs)
  const beforeMtime = new Date(statSync(distAbs).mtimeMs).toISOString()
  const build = run("bun", ["run", "build"], join(repo, "packages", target.pkg))
  const after = sha(distAbs)
  const verify = run(process.execPath, ["scripts/verify-dist-fresh.mjs", "--only", "packages/" + target.pkg, "--quiet"], repo)
  report.readings.push({
    arm: "(cd packages/" + target.pkg + " && bun run build) then verify-dist-fresh --only packages/" + target.pkg + " --quiet",
    build_exit: build.exitCode,
    build_tail: build.output.trim().split("\n").slice(-1)[0],
    dist_before: before,
    dist_after: after,
    dist_byte_identical: before === after,
    dist_mtime_before: beforeMtime,
    dist_mtime_after: new Date(statSync(distAbs).mtimeMs).toISOString(),
    verify_exit: verify.exitCode,
    verify_tail: verify.output.trim().split("\n").filter((l) => l.startsWith("[verify-dist-fresh]")).slice(-1)[0],
  })
}
for (const pkg of ["mpd-team-watchdog-plugin"]) {
  report.not_run.push({
    pkg,
    reason: "t10 (lane C) has in-flight src edits (src/engine.ts, src/machine.ts, src/actions.ts) — a build here would bake a half-edited source into the committed dist; that dist is lane C's to rebuild",
    src_mtimes: ["src/index.ts", "src/engine.ts", "src/machine.ts", "src/actions.ts"].map((f) => ({ path: "packages/" + pkg + "/" + f, mtime: new Date(statSync(join(repo, "packages", pkg, f)).mtimeMs).toISOString() })).filter((e) => existsSync(join(repo, e.path))),
    dist_mtime: new Date(statSync(join(repo, "packages", pkg, "dist", "index.js")).mtimeMs).toISOString(),
  })
}
report.ok = report.readings.every((r) => r.build_exit === 0 && r.dist_byte_identical === true && r.verify_exit === 0)
report.verdict = report.ok ? "BOTH ROUND TRIPS PASS AND REPRODUCE THE COMMITTED BYTES" : "AT LEAST ONE ROUND TRIP DID NOT PASS"
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
