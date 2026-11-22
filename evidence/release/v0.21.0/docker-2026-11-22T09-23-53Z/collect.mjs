// LANE T5 collector: read one run's console transcript, locate the evidence directory the driver
// printed, copy its JSON verdicts beside the transcript, and write meta.json. Never reads or prints
// the credential. Reads only the run directory it is given.
import fs from "node:fs"
import path from "node:path"

const REPO = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
const [, , dir, rcStr, slug, argsStr] = process.argv
const rc = Number(rcStr)
const consoleText = fs.readFileSync(path.join(dir, "console.out"), "utf8")
const caseSlug = slug.includes("oneclick") ? "client-install-oneclick" : "client-install"

const printed = [...consoleText.matchAll(/^\[driver\] evidence -> (.+)$/gm)].map((m) => m[1].trim())
const printedPath = printed.length > 0 ? printed[printed.length - 1] : null
let evid = null
if (printedPath !== null) evid = path.isAbsolute(printedPath) ? printedPath : path.join(REPO, printedPath)
if (evid === null) {
  const root = path.join(REPO, "evidence", "docker", caseSlug)
  try {
    const before = new Set((fs.readFileSync(path.join(dir, "before-evidence-dirs.txt"), "utf8") || "").split("\n").filter(Boolean))
    const now = fs.readdirSync(root).filter((d) => !before.has(d)).sort()
    if (now.length > 0) evid = path.join(root, now[now.length - 1])
    else {
      const all = fs.readdirSync(root).sort()
      if (all.length > 0) evid = path.join(root, all[all.length - 1])
    }
  } catch {
    evid = null
  }
}

const meta = {
  run: (path.basename(dir).match(/^run-(\d+)-/) || [null, null])[1] === null ? null : Number(path.basename(dir).match(/^run-(\d+)-/)[1]),
  slug,
  args: argsStr,
  exitCode: rc,
  printedEvidencePath: printedPath,
  evidenceDir: evid === null ? null : path.relative(REPO, evid),
  dockerMode: (consoleText.match(/^\[driver\] docker mode: .*$/m) || [null])[0],
  skipped: /^\[driver\] SKIP/m.test(consoleText),
  verdictLine: (consoleText.match(/^\[driver\] ok=.*$/m) || [null])[0],
  unmeasured: [...consoleText.matchAll(/^\[driver\] UNMEASURED (.+?) —/gm)].map((m) => m[1].trim()),
  missing: [...consoleText.matchAll(/^\[driver\] MISSING (.+?) —/gm)].map((m) => m[1].trim()),
  stdoutFailures: [...consoleText.matchAll(/^\[driver\] FAIL (.+?) —/gm)].map((m) => m[1].trim()),
  result: null,
  driver: null,
  harnessVersion: null,
  harnessExpected: null,
  tuiVersion: null,
  tuiBin: null,
  pins: null,
  proof: null,
  userSurface: null,
  failures: [],
  nulls: [],
}

/** Pick a named assertion row as a compact verdict witness. */
const pick = (assertions, name) => {
  const row = assertions.find((a) => a.name === name)
  return row === undefined ? { name, ok: null, reason: "row absent", raw: "" } : { name, ok: row.ok, reason: row.reason ?? "", raw: row.raw ?? "" }
}

if (evid !== null) {
  for (const name of ["result.json", "driver.json"]) {
    const src = path.join(evid, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, name))
      meta[name === "result.json" ? "result" : "driver"] = name
    }
  }
  const resultPath = path.join(evid, "result.json")
  if (fs.existsSync(resultPath)) {
    const body = JSON.parse(fs.readFileSync(resultPath, "utf8"))
    const assertions = body.assertions ?? []
    meta.ok = body.ok
    meta.complete = body.complete
    meta.summary = body.summary ?? null
    meta.harnessVersion = body.harness?.installed ?? body.facts?.harnessVersion ?? null
    meta.harnessExpected = body.harness?.expected ?? body.facts?.harnessVersionExpected ?? null
    meta.pins = body.facts?.pins ?? null
    const tuiRow = assertions.find((a) => a.name === "tui.hostInstall")
    if (tuiRow) {
      const m = String(tuiRow.raw ?? "").match(/version=(\S+)/)
      meta.tuiVersion = m ? m[1] : null
      const b = String(tuiRow.raw ?? "").match(/bin=(\S+)/)
      meta.tuiBin = b ? b[1] : null
    }
    const us = assertions.filter((a) => a.name.startsWith("userSurface."))
    const rows = us.filter((a) => a.name.startsWith("userSurface.row."))
    const boundTrue = new Set(us.filter((a) => a.name.startsWith("userSurface.bound.") && a.ok === true).map((a) => a.name.slice("userSurface.bound.".length)))
    const rowNulls = rows.filter((a) => a.ok === null)
    meta.userSurface = {
      total: us.length,
      trueCount: us.filter((a) => a.ok === true).length,
      falseCount: us.filter((a) => a.ok === false).length,
      nullCount: us.filter((a) => a.ok === null).length,
      rowCount: rows.length,
      rowTrue: rows.filter((a) => a.ok === true).length,
      rowNullExcused: rowNulls.filter((a) => boundTrue.has(a.name.slice("userSurface.row.".length))).length,
      rowNullUnexcused: rowNulls.filter((a) => !boundTrue.has(a.name.slice("userSurface.row.".length))).map((a) => a.name),
      boundTrueCount: boundTrue.size,
      probe: pick(assertions, "userSurface.probe"),
      rowsEnumerated: pick(assertions, "userSurface.rowsEnumerated"),
      rowsWitness: pick(assertions, "userSurface.rowsWitness"),
      rowsDeclaredBound: pick(assertions, "userSurface.rowsDeclaredBound"),
      negativeControl: pick(assertions, "userSurface.negativeControl"),
    }
    meta.proof = {
      install: ["install.exit", "install.profileDep", "install.installedTree", "install.buildScripts"].map((n) => pick(assertions, n)),
      mount: ["compose.mpdRows", "compose.presetRow", "boot.mpdTools", "boot.presetMount", "boot.sessionGateListener", "boot.servesHttp", "boot.agentTeamTools", "tui.hostInstall", "tui.boot", "tui.presetPreference", "tui.presetRow", "tui.sessionPreset"].map((n) => pick(assertions, n)),
      oneclick: ["oneclick.scratchRepo", "oneclick.requiredPaths", "oneclick.filesAllowlist", "oneclick.distByteIdentical"].map((n) => pick(assertions, n)),
      pack: ["pack.present", "pack.licenceCoherence", "pack.declarationCoherence", "pack.staticCoherence", "pack.distFreshRebuild", "pack.distFreshRebuildControl"].map((n) => pick(assertions, n)),
      live: assertions.filter((a) => a.name.startsWith("live.")).map((a) => ({ name: a.name, ok: a.ok, raw: a.raw ?? "" })),
    }
    meta.failures = assertions.filter((a) => a.ok === false).map((a) => ({ name: a.name, reason: a.reason ?? null, raw: a.raw ?? null }))
    meta.nulls = assertions.filter((a) => a.ok === null).map((a) => a.name)
    meta.assertionCount = assertions.length
  }
  const driverPath = path.join(evid, "driver.json")
  if (fs.existsSync(driverPath)) {
    const d = JSON.parse(fs.readFileSync(driverPath, "utf8"))
    meta.driverExitCode = d.exitCode
    meta.containerExit = d.containerExit
    meta.liveRequested = d.liveRequested
    meta.browserEnabled = d.browserEnabled
    meta.requiredPrefixes = d.requiredPrefixes
    meta.excludedRequired = d.excludedRequired
    meta.driverUnmeasured = d.unmeasured
    meta.teamRowsMissing = d.teamRowsMissing
    meta.steps = d.steps
    meta.imageMiB = d.imageMiB
    meta.startedAt = d.startedAt
    meta.finishedAt = d.finishedAt
    meta.durationMinutes = Math.round(((Date.parse(d.finishedAt) - Date.parse(d.startedAt)) / 60000) * 10) / 10
  }
}

fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
console.log(`run ${meta.run} (${slug}) exit=${rc} evidence=${meta.evidenceDir ?? "<none>"} harness=${meta.harnessVersion ?? "<none>"} tui=${meta.tuiVersion ?? "<none>"} failures=${meta.failures.length} nulls=${meta.nulls.length} userSurfaceTrue=${meta.userSurface?.trueCount ?? "<none>"}`)
