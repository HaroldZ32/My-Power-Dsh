#!/usr/bin/env node
// T-88 (lane B's half) — the DEMONSTRATION that the derived surfaces are owned by the INTEGRATION task
// and by no lane. Read-only: it reads the live team record and prints per-task inScope, flagging any
// non-integration task whose inScope COVERS a derived surface (`packages/*/dist/**`, `dist/mpd-package/**`,
// `VENDOR_LOCK.json`, `.mpd/plans/**`), and asserting the integration task names them.
//
// The three routes the rule names are printed from the record itself: leave the shared gate red · rebuild
// undeclared and be REFUSED at completion · request the hop with the exact amendment text. Route 3 is the
// working one (2a's instance: t10/lane C was refused with "1 changed path(s) not covered by inScope:
// packages/mpd-team-watchdog-plugin/dist/index.js is undeclared" and the hop then landed).
//
// usage: node ./derived-surface-audit.mjs [--record <team.json>] [--self-test] [--json]
// exit 0 = the invariant holds (no lane covers a derived surface, the integration task declares them)
// exit 1 = a lane covers a derived surface (or the integration task is missing/does not declare them)
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DERIVED = ["packages/*/dist/**", "dist/mpd-package/**", "VENDOR_LOCK.json", ".mpd/plans/**"]
const DEFAULT_RECORD = ".mpd/team/friction-p2-wave/team.json"
const PREFIX = "[derived-surface-audit]"
const REFUSAL_SHAPE = "1 changed path(s) not covered by inScope: packages/mpd-team-watchdog-plugin/dist/index.js is undeclared"

/** Does `entry` (an inScope pattern) COVER the derived surface `surface`? Exact match, or a parent glob
 *  whose prefix contains the whole surface (a `packages/**` entry covers a descendant surface such as the
 *  per-package dist tree; NOTE the comment must never spell that pattern with its star-slash adjacency, or
 *  it terminates this comment - the same trap for any future edit here). */
function covers(entry, surface) {
  if (entry === surface) return true
  if (entry.endsWith("/**")) {
    const base = entry.slice(0, -3)
    if (surface === base || surface.startsWith(base + "/")) return true
    // a wildcard segment inside the base (`packages/*/dist/**`) — compare the stable head
    if (base.includes("*")) {
      const head = base.slice(0, base.indexOf("*"))
      const tail = base.slice(base.lastIndexOf("/") + 1)
      if (head.length > 0 && surface.startsWith(head) && surface.includes("/" + tail)) return true
    }
  }
  return false
}

function tasksOf(record) {
  return Array.isArray(record.tasks) ? record.tasks : Array.isArray(record.state?.tasks) ? record.state.tasks : []
}

function audit(record) {
  const tasks = tasksOf(record)
  const rows = []
  const laneViolations = []
  const integrationTasks = []
  for (const task of tasks) {
    const inScope = Array.isArray(task.inScope) ? task.inScope : []
    const covered = []
    for (const surface of DERIVED) for (const entry of inScope) if (covers(entry, surface)) covered.push({ surface, entry })
    const isIntegration = task.kind === "integration"
    rows.push({ id: task.id, kind: task.kind ?? null, status: task.status ?? null, assignee: task.assignee ?? null, inScope, coveredDerived: covered.map((c) => c.surface), isIntegration })
    if (isIntegration) integrationTasks.push({ id: task.id, covered: covered.map((c) => c.surface) })
    else if (covered.length > 0) laneViolations.push({ id: task.id, kind: task.kind ?? null, covered })
  }
  const surfacesNotDeclared = DERIVED.filter((surface) => !integrationTasks.some((t) => t.covered.includes(surface)))
  return { rows, laneViolations, integrationTasks, surfacesNotDeclared, ok: laneViolations.length === 0 && integrationTasks.length > 0 && surfacesNotDeclared.length === 0 }
}

function fixtureRecord() {
  return {
    schema: "fixture",
    tasks: [
      { id: "tX", kind: "implementation", status: "in_progress", assignee: "a-lane", inScope: ["skills/dsh-qa/**", "packages/*/dist/**"] },
      { id: "tY", kind: "integration", status: "pending", inScope: DERIVED },
    ],
    note: "NEG CONTROL fixture: a lane holds packages/*/dist/** - the shape the platform refuses at completion: " + REFUSAL_SHAPE,
  }
}

function report(result, json) {
  if (json) { console.log(JSON.stringify(result, null, 2)); return }
  console.log(PREFIX + " tasks read: " + result.rows.length)
  for (const row of result.rows) console.log(PREFIX + "   " + String(row.id).padEnd(5) + " " + String(row.kind).padEnd(14) + " " + String(row.status).padEnd(11) + " " + String(row.assignee ?? "-").padEnd(22) + " inScope=" + (row.inScope.join(", ") || "(none)"))
  console.log(PREFIX + " integration task(s) declaring derived surfaces: " + (result.integrationTasks.map((t) => t.id + " [" + t.covered.join(", ") + "]").join("; ") || "NONE"))
  if (result.surfacesNotDeclared.length > 0) console.error(PREFIX + " FAIL - the integration task does not declare: " + result.surfacesNotDeclared.join(", "))
  for (const v of result.laneViolations) console.error(PREFIX + " FAIL - lane task " + v.id + " (" + v.kind + ") covers derived surface(s): " + v.covered.map((c) => c.surface + " via " + c.entry).join(", "))
  if (result.ok) console.log(PREFIX + " ok: no lane covers a derived surface (" + DERIVED.join(", ") + "); the integration task declares them")
}

function selfTest() {
  const arms = []
  const arm = (name, ok, detail) => arms.push({ name, ok: Boolean(ok), detail })
  const scratch = mkdtempSync(join(tmpdir(), "mpd-derived-surface-"))
  try {
    const fixturePath = join(scratch, "fixture-team.json")
    writeFileSync(fixturePath, JSON.stringify(fixtureRecord(), null, 2))
    const fixture = audit(JSON.parse(readFileSync(fixturePath, "utf8")))
    arm("(a) fixture record with a lane holding packages/*/dist/** -> flagged, task named",
      fixture.ok === false && fixture.laneViolations.length === 1 && fixture.laneViolations[0].id === "tX",
      JSON.stringify(fixture.laneViolations))
    arm("(b) the fixture carries the platform's own refusal shape",
      readFileSync(fixturePath, "utf8").includes(REFUSAL_SHAPE) && fixture.laneViolations[0].covered.some((c) => c.surface === "packages/*/dist/**"),
      "refusal string present in the fixture + the surface named")
    const live = audit(JSON.parse(readFileSync(DEFAULT_RECORD, "utf8")))
    arm("(c) the LIVE record: no lane covers a derived surface", live.ok === true && live.laneViolations.length === 0,
      "integration=" + JSON.stringify(live.integrationTasks) + "; violations=" + JSON.stringify(live.laneViolations))
    arm("(d) the LIVE integration task declares all four derived surfaces",
      live.surfacesNotDeclared.length === 0,
      "not declared: " + JSON.stringify(live.surfacesNotDeclared))
    const noDerived = audit({ tasks: [{ id: "tZ", kind: "implementation", inScope: ["scripts/**"] }] })
    arm("(e) a record with NO integration task -> red (the surfaces must be declared somewhere)",
      noDerived.ok === false && noDerived.integrationTasks.length === 0,
      JSON.stringify(noDerived.integrationTasks))
  } catch (error) {
    arm("self-test harness", false, String(error?.stack ?? error))
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  for (const a of arms) console.log(PREFIX + " self-test " + (a.ok ? "PASS" : "FAIL") + " - " + a.name + " :: " + String(a.detail).slice(0, 200))
  const failed = arms.filter((a) => !a.ok).length
  console.log(PREFIX + " self-test " + (failed === 0 ? "PASS" : "FAIL") + ": " + (arms.length - failed) + "/" + arms.length + " arms")
  return failed === 0 ? 0 : 1
}

const argv = process.argv.slice(2)
if (argv.includes("--self-test")) process.exit(selfTest())
const recordPath = argv.includes("--record") ? argv[argv.indexOf("--record") + 1] : DEFAULT_RECORD
const result = audit(JSON.parse(readFileSync(recordPath, "utf8")))
report(result, argv.includes("--json"))
process.exit(result.ok ? 0 : 1)
