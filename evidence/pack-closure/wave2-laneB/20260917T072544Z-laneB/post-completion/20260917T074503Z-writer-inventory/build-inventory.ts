// Derives the post-pack writer inventory from the gate's OWN output: every CONTENT-DRIFT-EXPECTED line
// already names path + source mtime + stamp + the anchor. Family attribution is an INFERENCE from the
// team's own inScope declarations (verified with agent_teams_path_owner for the four families below).
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const dir = process.argv[2]
const exitCode = Number(process.argv[3])
const log = readFileSync(dir + "/closure.log", "utf8")
const entries = log
  .split("\n")
  .filter((l) => l.includes("CONTENT-DRIFT-EXPECTED (expected"))
  .map((l) => ({
    path: l.match(/ - ([^:]+): source mtime/)[1],
    source_mtime: l.match(/source mtime ([0-9T:.Z-]+)/)[1],
    stamp: l.match(/artifact stamp ([0-9T:.Z-]+)/)[1],
  }))
const FAMILIES = [
  ["packages/mpd-agent-teams-plugin/", "lane A (t8, agent-teams-engineer) - path_owner verified"],
  ["skills/", "lane D (t11, qa-lane-engineer; the single skills writer) - path_owner verified"],
  ["agent-references/", "lane B3 (t19, docs-parity-engineer) - path_owner verified"],
  ["packages/mpd-team-watchdog-plugin/", "lane C (t10, watchdog-engineer) - path_owner verified"],
  ["docs/", "docs parity family (owner not queried for each path)"],
  ["packages/mpd-bundle-plugin/", "bundle client family (owner not queried)"],
  ["extensions/", "extensions family (owner not queried)"],
  ["presets/", "presets family (owner not queried)"],
]
const familyOf = (p) => FAMILIES.find(([prefix]) => p.startsWith(prefix))?.[1] ?? "(unattributed)"
const byFamily = {}
for (const entry of entries) (byFamily[familyOf(entry.path)] ??= []).push(entry)
const report = {
  schema: "laneB/post-completion-writer-inventory/1",
  captured_at: new Date().toISOString(),
  what: "every post-pack writer the closure gate's EXPECTED class names, derived from its own output - the inventory the captain asked for in the wave report",
  reading: {
    closure_exit: exitCode,
    expected_count: entries.length,
    content_line: (log.match(/content bytes: [^;]*/) ?? [null])[0],
    completeness_line: (log.match(/completeness: [^;]*/) ?? [null])[0],
    stamp: (log.match(/pack stamp ([0-9T:.Z-]+)/) ?? [null])[1],
  },
  families: Object.fromEntries(Object.entries(byFamily).map(([k, v]) => [k, { count: v.length, paths: v.map((e) => e.path), mtimes: v.map((e) => e.source_mtime) }])),
  entries,
}
writeFileSync(dir + "/writer-inventory.json", JSON.stringify(report, null, 2))
console.log(JSON.stringify({ closure_exit: exitCode, expected: entries.length, line: report.reading.content_line, families: Object.fromEntries(Object.entries(report.families).map(([k, v]) => [k, v.count])) }, null, 1))
