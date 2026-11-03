// BUILD EVERY TREE THE TWO PANELS PUBLISH, MEASURE IT, LINT IT, AND WRITE IT FOR THE APP CHECKER.
//
// This is the evidence producer for contract §6.1(c) and §7.3: the checker cannot see a LIVE tree from
// the declared static files, so each built tree (v2 and its v1 fallback) is written here and piped to
// `check.mjs -` by the shell that runs this file. It also records the measured bytes / nodes / depth per
// panel per caps branch, which is what the lane report quotes.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { lintDesign, measureView, BUDGETS, fitsBudget, type DshGoView } from "../../../../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import { buildMpdView } from "../../../../packages/mpd-bundle-plugin/src/dshgo-views.ts"
import { buildTeamView, type TeamPanelSnapshot } from "../../../../packages/mpd-bundle-plugin/src/dshgo-views.ts"
import type { PanelSnapshot } from "../../../../packages/mpd-bundle-plugin/src/dshgo-panel.ts"

/** The output directory this script writes into: the evidence directory that holds it. */
const OUT = import.meta.dir

/** A fully populated workbench snapshot, so no tab is trivially empty. */
const workbench: PanelSnapshot = {
  team: { id: "team-1", name: "Drive surface", status: "approved", phase: "active", members: 2, tasks: 3 },
  plan: { ready: true, members: 2, tasks: 3 },
  question: { id: "q1", question: "Pick one of the two release lanes so the wave can continue", options: [{ label: "main" }, { label: "dev" }, { label: "edge" }] },
  readyTasks: [{ id: "T1", title: "Ship the panel", subtitle: "work · Lead" }],
  counts: { ready: 1, active: 1, done: 1, total: 3, completion: 33, members: 2 },
  alert: "A plan is staged and waits for approval",
  workmates: [{ name: "deep-worker-1", base: "Deep Worker", uses: 4, note: "carries the D1 lane" }],
  memory: { entries: [{ kind: "fact", description: "the kit writes accent app", age: "2h" }], reflections: 3, steps: 4 },
}

/** A fully populated team snapshot. */
const team: TeamPanelSnapshot = {
  team: { id: "team-1", name: "Drive surface", status: "approved", phase: "active" },
  tasks: [
    { id: "T1", subject: "Adapt the view kit", owner: "Deep Worker", status: "in_progress", kind: "work", blockedBy: 0, description: "Build the v2 kit and its fallback.", dependencies: "", verdict: "" },
    { id: "T2", subject: "Migrate the panels", owner: "Senior Engineer", status: "pending", kind: "work", blockedBy: 1, description: "Two panels, four tabs each.", dependencies: "T1", verdict: "PASS" },
  ],
  counts: { total: 2, done: 0, active: 1, blocked: 1, completion: 0 },
  members: [
    { name: "Deep Worker", mode: "running", handoff: "" },
    { name: "Senior Engineer", mode: "idle", handoff: "handoff ready" },
  ],
  selected: { id: "T1", subject: "Adapt the view kit", owner: "Deep Worker", status: "in_progress", kind: "work", blockedBy: 0, description: "Build the v2 kit and its fallback.", dependencies: "", verdict: "" },
  watchdog: { predicate: "channel", held: true, reason: "silence", taskId: "T2", incidents: [{ at: "2026-11-02T20:00:00Z", kind: "silence", detail: "T2 was silent past the bound" }] },
}

/** An app that speaks view v2. */
const V2 = { app: "1.0.9", locale: "en" }

/** An app below the v2 floor. */
const V1 = { app: "1.0.8", locale: "en" }

/** One tree to write, measure and lint. */
interface Case {
  /** The file stem the JSON is written to. */
  name: string
  /** The tree itself. */
  view: DshGoView
  /** The lint mode that applies to it. */
  version: 1 | 2
}

/** The four trees the two panels publish. */
const cases: Case[] = [
  { name: "mpd-v2", view: buildMpdView(workbench, V2), version: 2 },
  { name: "mpd-v1-fallback", view: buildMpdView(workbench, V1), version: 1 },
  { name: "mpd-team-v2", view: buildTeamView(team, V2), version: 2 },
  { name: "mpd-team-v1-fallback", view: buildTeamView(team, V1), version: 1 },
]

/** The measurements, keyed by case name; this is the file the report quotes. */
const measured: Record<string, unknown> = {}

for (const one of cases) {
  /** The tree's three app units. */
  const size = measureView(one.view)
  /** The design-lint findings for this tree in its own version mode. */
  const findings = lintDesign(one.view, { version: one.version })
  measured[one.name] = {
    bytes: size.bytes,
    nodes: size.nodes,
    depth: size.depth,
    budget: BUDGETS.panel,
    fitsBudget: fitsBudget(one.view, "panel"),
    lintMode: one.version,
    findings,
  }
  writeFileSync(join(OUT, one.name + ".json"), JSON.stringify(one.view, null, 2) + "\n")
}

writeFileSync(join(OUT, "measure.json"), JSON.stringify(measured, null, 2) + "\n")
console.log(JSON.stringify(measured, null, 2))
for (const [name, value] of Object.entries(measured)) {
  /** The findings array this case recorded. */
  const findings = (value as { findings: unknown[] }).findings
  if (findings.length > 0) throw new Error(name + " has " + String(findings.length) + " design findings")
}
