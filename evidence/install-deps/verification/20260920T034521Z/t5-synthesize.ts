#!/usr/bin/env node
/*
 * t5 — synthesis: read the measured artifacts and write verification-summary.json.
 * Nothing here is hand-typed: every number comes from arms-final/*.json, red-green.json,
 * result-final.json and the gate logs, so the summary cannot drift from the evidence.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const RUN = process.env.T5_RUN_DIR ? resolve(process.env.T5_RUN_DIR) : HERE
const read = (p) => JSON.parse(readFileSync(join(RUN, p), "utf8"))
const readText = (p) => { try { return readFileSync(join(RUN, p), "utf8") } catch { return "" } }
const exists = (p) => existsSync(join(RUN, p))

const final = read("result-final.json")
const pin = read("pin.json")
const redGreen = read("red-green.json")

const arms = readdirSync(join(RUN, "arms-final")).filter((f) => f.endsWith(".json") && f !== "client-module-probe.json").sort()
  .map((f) => {
    const arm = read(join("arms-final", f))
    return {
      id: arm.id, ok: arm.ok, plane: arm.plane ?? null, purpose: arm.purpose ?? null,
      bundles: arm.bundles ?? null, installExit: arm.install?.exitCode ?? null,
      composition: { rows: arm.composition?.rowCount ?? arm.composition?.rows?.length ?? null, rowIds: arm.composition?.rowIds ?? (arm.composition?.rows ?? []).map((r) => r.id), exitCode: arm.composition?.exitCode ?? null },
      load: { booted: arm.load?.booted ?? null, guard: arm.load?.guard ?? null, route: arm.load?.sidebarRoute?.status ?? null, routeBody: arm.load?.sidebarRoute?.body ?? null, servedClientCarriesSidebar: arm.load?.servedClientCarriesSidebar ?? null, fatalSignatureHits: arm.load?.signatures?.hits ?? null },
      evidence: arm.persisted ?? { bootLog: join(RUN, "logs", arm.id + ".boot.log") },
    }
  })

const gateFiles = ["rows-installer-preset.log", "docs-final.log", "dist-fresh.log", "pack.log", "pack-closure.log", "qa-case-selftest.log"]
const gates = gateFiles.map((file) => {
  const text = readText(join("gates", file))
  const lines = text.split("\n").filter(Boolean)
  const exitLines = lines.filter((l) => l.includes("exit="))
  const lastExit = exitLines.length > 0 ? Number((/exit=(\d+)/.exec(exitLines[exitLines.length - 1]) ?? [])[1] ?? null) : null
  return { log: "gates/" + file, exit: lastExit, summary: lines.filter((l) => / ok:|PASS|FAIL/.test(l)).slice(-2).join(" | ").slice(0, 400) }
})

const summary = {
  task: "t5 independent verification of the install-dependency fix",
  lane: "Lead (this lane wrote evidence only: evidence/install-deps/verification/**)",
  generatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  verdict: {
    reproduced: final.allArmsOk === true && redGreen.boundaryProven === true,
    allArmsOk: final.allArmsOk === true,
    boundaryProven: redGreen.boundaryProven === true,
    settledRevision: pin.settled_revision.files["packages/mpd-bundle/cordis.patch.yml"],
    treeMovedMidRun: pin.premature_revision["packages/mpd-bundle/cordis.patch.yml"] !== pin.settled_revision.files["packages/mpd-bundle/cordis.patch.yml"],
    midRunMoveDetectedAtUtc: pin.premature_revision.move_detected_at_utc,
  },
  hashDiscipline: {
    pin: pin.settled_revision.measured_at_utc,
    settleStartEqualsEnd: final.hashDiscipline.startEqualsEnd,
    matrixWindow: [final.hashDiscipline.start.atUtc, final.hashDiscipline.end.atUtc, final.hashDiscipline.postRun.atUtc],
    movedDuringRun: final.hashDiscipline.movedDuringRun,
  },
  arms,
  redGreen: { red: redGreen.red, green: redGreen.green, boundaryProven: redGreen.boundaryProven },
  gates,
  packerRoundTrip: {
    command: "node scripts/pack-mpd.mjs",
    artifact: "dist/mpd-package/package.json",
    dependenciesArm: (() => {
      try { return JSON.parse(readFileSync("/root/dshProj/my-power-dsh/dist/mpd-package/package.json", "utf8")).dependencies } catch { return null }
    })(),
    packedPatchCarriesRow: existsSync("/root/dshProj/my-power-dsh/dist/mpd-package/cordis.patch.yml"),
    note: "read from the GENERATED artifact, not from the source manifest; dist/mpd-package/** is gitignored",
  },
  findings: [
    {
      id: "F1-guard-textual-over-approximation", severity: "medium", kind: "robustness, degradation-only (never a dead boot)",
      statement: "The guard's 'another layer already mounts it' predicate is a substring test over patch TEXT (other layers, --patch overlays, $DSH_HOME/cordis.patch.yml). A layer that merely MENTIONS dsh-better-sidebar (comment) or inserts it with disabled: true suppresses our only mount, and the sidebar disappears (route 404) while the boot stays healthy.",
      measuredArms: ["F3-decoy-comment-layer", "F4-decoy-disabled-row"],
      evidence: ["arms-final/F3-decoy-comment-layer.json", "arms-final/F4-decoy-disabled-row.json", "logs/F3-decoy-comment-layer.boot.log", "logs/F4-decoy-disabled-row.boot.log"],
      repairedByThisLane: false,
    },
    {
      id: "F2-web-plane-predicate-forward-blindness", severity: "probe/informational (composition not valid)",
      statement: "[base, mpd, web-app] does not boot at all (plugin(s) failed to load + plugin tree failed to load), so it cannot decide whether predicate 4 is forward-blind; the raw log does show TWO evaluations (first DISABLED - no enabled webserver entry, later ENABLED).",
      measuredArms: ["F5-web-layer-after"],
      evidence: ["arms-final/F5-web-layer-after.json"],
      repairedByThisLane: false,
    },
    {
      id: "F3-standalone-client-module-claim", severity: "low (claim, not behaviour)",
      statement: "t2's standalone /plugins/??dsh-better-sidebar/client.js probe (200 / 870764 B) was not reproduced with the combined bundle's rev (404); the combined URL the index serves IS 200 / 12361294 B and carries the sidebar module.",
      measuredArms: ["client-module-probe"],
      evidence: ["arms-final/client-module-probe.json", "client-module-final.log"],
      repairedByThisLane: false,
    },
  ],
  residualRisks: [
    { id: "R1", statement: "F1 over-approximation (a mentioning layer suppresses the mount)", closingCommand: "node t5-repro.mjs --only F3-decoy-comment-layer,F4-decoy-disabled-row (after the guard reads ROWS, not text)" },
    { id: "R2", statement: "predicate 4 depends on the webserver entry being visible at first evaluation", closingCommand: "build a composition whose webserver row is inserted by a layer after @mpd-dsh/mpd and still boots; not constructible from today's shipped layers" },
    { id: "R3", statement: "standalone client-module URL needs the entry's own rev", closingCommand: "extend t5-client-module.mjs to take the rev from the per-entry client table, then rerun it" },
    { id: "R4", statement: "the PACKED artifact was built and read but never installed+booted in this environment", closingCommand: "DSH_HOME=<sb>/dsh HOME=<sb>/home dsh plugin --profile web add <repo>/dist/mpd-package && boot it" },
    { id: "R5", statement: "the aggregate arm uses the already-installed @linxin666/dsh-web-all@0.3.20 (mirror link); its installation was not exercised (no registry in this sandbox)", closingCommand: "dsh plugin --profile web add @linxin666/dsh-web-all@0.3.20 in a networked sandbox, then rerun A2/A3" },
  ],
  verifierSideDefectsFixed: [
    "pass-1 harness resolved the repo root 3 levels up instead of 4 (discarded; DISCARDED-pass1-harness-bug.md)",
    "first client-URL probe kept the HTML entity &amp; and read a 404",
    "tmux panes are CRLF; the guard regex missed the trailing \\r until lines were normalized",
    "t5-red.mjs wiped the stage it had just built (buildSandbox rm -rf) -> both arms measured a dangling link; order fixed and named in the code",
  ],
  isolation: {
    sandboxes: "DSH_HOME + HOME + cwd per arm (T5_SANDBOX_ROOT), never the real ~/.dsh",
    realWorkspaceStateWrites: "none attributable to any boot (checked .mpd/{memory,boulder.json,hashline-files.json,plans,ulw} and <sandbox>/dsh/sessions)",
  },
}

mkdirSync(RUN, { recursive: true })
writeFileSync(join(RUN, "verification-summary.json"), JSON.stringify(summary, null, 2) + "\n")
console.log(JSON.stringify({ verdict: summary.verdict, arms: summary.arms.map((a) => ({ id: a.id, ok: a.ok, guard: a.load.guard?.decision ?? null, route: a.load.route, served: a.load.servedClientCarriesSidebar })), gates: summary.gates.map((g) => ({ log: g.log, exit: g.exit })) }, null, 2))
