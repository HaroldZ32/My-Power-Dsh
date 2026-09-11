#!/usr/bin/env node
// t10 (Reviewer) own end-to-end `**` check + REAL wave-1 replay.
//
// The question t4 A1 poses is not "does the matcher accept a string" but "can a
// task declaring a directory-prefix pattern complete with a COMPLETE
// changedPaths". This drives the shipped lib's own classifyChangedPath (the
// function that decides whether a changed file is kept as in_scope) and then
// replays an archived wave-1 record whose declaration used a `/**` pattern.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { classifyChangedPath, pathMatchesScope, collectChangedPaths } from "/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/quality-gates.js"

const here = dirname(fileURLToPath(import.meta.url))
const checks = []
const check = (name, pass, detail) => {
  checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) })
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`)
}

// --- 1. directory-prefix declarations, end to end ---------------------------
const cases = [
  ["packages/foo/test/a.test.mjs", "packages/foo/test/**", "in_scope"],
  ["packages/foo/test/deep/case.ts", "packages/foo/test/**", "in_scope"],
  ["packages/mpd-verif-plugin/test/case_a.py", "packages/mpd-verif-plugin/test/**", "in_scope"],
  ["packages/foo/testx/a.mjs", "packages/foo/test/**", "undeclared"],
  ["src/a.md", "**/*.ts", "undeclared"],
  ["srcx/a.ts", "src/**", "undeclared"],
  ["packages/foo/src/a.ts", "packages/foo", "in_scope"],
  ["packages/foo-bar/a.ts", "packages/foo", "undeclared"],
]
const results = cases.map(([p, pat, want]) => {
  const got = classifyChangedPath(p, [pat], [])
  return { path: p, pattern: pat, want, got, ok: got === want }
})
check("classifyChangedPath: a `dir/**` declaration keeps every file beneath it (and the boundary controls still reject)",
  results.every((r) => r.ok), JSON.stringify(results.map((r) => `${r.ok ? "ok" : "BAD"} ${r.path} ~ ${r.pattern} -> ${r.got}`)))

// --- 2. REAL archived wave-1 replay ----------------------------------------
const archive = "/root/dshProj/my-power-dsh/.mpd/team/archive"
const replay = []
let replayAll = true
for (const team of existsSync(archive) ? readdirSync(archive) : []) {
  const p = join(archive, team, "team.json")
  if (!existsSync(p)) continue
  let doc
  try { doc = JSON.parse(readFileSync(p, "utf8")) } catch { continue }
  const tasks = Array.isArray(doc.tasks) ? doc.tasks : Object.values(doc.tasks ?? {})
  for (const t of tasks) {
    const inScope = t.inScope ?? []
    const globbed = inScope.filter((s) => /[*?]/.test(s))
    if (globbed.length === 0) continue
    const changed = t.changedPaths ?? t.output?.changedPaths ?? null
    if (!Array.isArray(changed) || changed.length === 0) continue
    const classified = changed.map((c) => ({ path: c, got: classifyChangedPath(c, inScope, t.outOfScope ?? []) }))
    const dropped = classified.filter((c) => c.got !== "in_scope")
    replay.push({
      team, task: t.id, status: t.status, globbed, changedCount: changed.length,
      inScopeCount: classified.filter((c) => c.got === "in_scope").length,
      dropped: dropped.slice(0, 5),
    })
    if (dropped.length > 0) replayAll = false
  }
}
const replayNote = replay.length === 0
  ? "no archived task carried both a glob declaration and recorded changedPaths — nothing to replay"
  : `${replay.length} archived task(s) with glob declarations replayed`
check("REAL wave-1 replay: every recorded changedPath of a glob-declaring task classifies as in_scope (the wave-1 defect would show as undeclared/dropped)",
  replay.length > 0 && replayAll, replayNote + " :: " + JSON.stringify(replay).slice(0, 700))

// --- 3. negative controls on the matcher itself -----------------------------
const negs = [
  ["srcx/a.ts", "src/**", false],
  ["src/a.md", "**/*.ts", false],
  ["lib/a.js.map", "lib/a.js", false],
]
check("matcher negative controls hold",
  negs.every(([p, pat, want]) => pathMatchesScope(p, pat) === want),
  JSON.stringify(negs.map(([p, pat, want]) => `${pathMatchesScope(p, pat) === want ? "ok" : "BAD"} ${p} ~ ${pat}`)))

void collectChangedPaths
const out = { task: "t10 own end-to-end ** check + real wave-1 replay", stamp: new Date().toISOString(), cases: results, replay, checks, allPass: checks.every((c) => c.pass) }
writeFileSync(join(here, "glob-e2e.result.json"), JSON.stringify(out, null, 2))
console.log("\n" + JSON.stringify({ allPass: out.allPass, replay }, null, 2))
process.exit(out.allPass ? 0 : 1)
