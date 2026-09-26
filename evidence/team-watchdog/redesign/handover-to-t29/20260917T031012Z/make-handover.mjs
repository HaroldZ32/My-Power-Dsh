// Generator for the t29 source-material handover (author -> independent verifier).
// Material only: nothing here may be cited as an acceptance reading for t29.
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "../../../../..")
const sha = (p) => createHash("sha256").update(readFileSync(join(REPO, p))).digest("hex")
const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim()

const FILES = [
  "packages/mpd-team-watchdog-plugin/src/machine.ts",
  "packages/mpd-team-watchdog-plugin/src/engine.ts",
  "packages/mpd-team-watchdog-plugin/src/channel.ts",
  "packages/mpd-team-watchdog-plugin/src/team.ts",
  "packages/mpd-agent-teams-plugin/lib/tools.js",
]
const hashes = Object.fromEntries(FILES.map((p) => [p, sha(p)]))
const at = new Date().toISOString()

const report = {
  kind: "handover-source-material",
  NOT_A_VERDICT: true,
  for_task: "t29 (verification of lane A) - verifier of record: packaging-engineer, blocked on t24",
  from: "watchdog-engineer, author of the lane-A implementations under verification (t8, t13)",
  why_this_is_not_evidence_for_t29:
    "the author cannot supply the verdict (self-approval); nothing here may be cited as an acceptance reading for t29. Re-run every driver on settled hashes and record your own numbers.",
  created_at: at,
  revision: { head: git(["rev-parse", "HEAD"]), branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) },
  frozen_hashes_at_handoff_material_only: hashes,
  red_baseline: {
    worktree: ".mpd/red-baseline",
    note: "the drivers drive BOTH trees, each with its OWN modules, identical scenario, injected clock; the core result asserts redMatchesContract {machine:true, engine:true, tools:true} against the contract frozen at HEAD 75018a1",
  },
  inventory: [
    {
      path: "evidence/team-watchdog/redesign/core/20260917T013000Z/rows-driver.mjs",
      proves: "section 9 rows (a)(b)(d): per-row RED fail / GREEN pass",
      decisive: "DRIVER RESULT: PASS - every row fails RED and passes GREEN on settled hashes",
      rerun: "node evidence/team-watchdog/redesign/core/20260917T013000Z/rows-driver.mjs",
      readings: { settleMs: 50000, settled: true, redMatchesContract: "machine/engine/tools all true", greenMatchesContract: "all false (i.e. NOT the contract baseline)", ok: true },
    },
    {
      path: "evidence/team-watchdog/redesign/core/20260917T012445Z/boot/",
      proves: "a REAL mounted boot (isolated DSH_HOME + sandbox HOME, real dsh, agentPreset mpd): the row applies, the fold subscription installs, no apply-crash signature",
      decisive:
        "[mpd-team-watchdog] applied: enabled=true warnSilenceMs=600000 tickIntervalMs=15000 warnStreakToEscalate=6 actionOnEscalate=warn-only ... holdTtlMs=900000 predicate=channel enrichment=on | ok B1 {\"enabled\":\"true\",\"disposers\":8,\"holdService\":\"mpdWatchdog\"}",
      rerun:
        "skills/dsh-qa/scripts/team-watchdog-boot.mjs with --out pointed INSIDE your own evidence dir (the case is read-only otherwise); NOTE outcome=model-error is expected without credentials and counts only for the boot invariant, never as a completed turn",
    },
    {
      path: "evidence/team-watchdog/redesign/holds/20260917T020000Z/rows-bf-driver.mjs",
      proves: "section 9 rows (b) and (f): a dependency-blocked team and a previous-generation-stamp team are never holdable",
      decisive: "DRIVER RESULT: PASS - every row fails RED and passes GREEN on settled hashes",
      rerun: "node evidence/team-watchdog/redesign/holds/20260917T020000Z/rows-bf-driver.mjs",
    },
    {
      path: "evidence/team-watchdog/redesign/config/20260917T011345Z/cross-layer-defaults.mjs",
      proves: "the three declaration layers (machine.ts, mpd-config-plugin settings-schema.ts, mpd-bundle cordis.patch.yml) agree on the knob values, with a negative-control root shipped beside it",
      rerun: "node evidence/team-watchdog/redesign/config/20260917T011345Z/cross-layer-defaults.mjs",
    },
    {
      path: "evidence/team-watchdog/redesign/core/SUMMARY.md + evidence/team-watchdog/redesign/holds/SUMMARY.md",
      proves: "the two lane indexes: per-row tables, gate readings, the RED/GREEN pair for every row, and the frozen-hash boundary note",
    },
  ],
  gaps_the_verifier_must_cover_themselves: [
    {
      t29_clause: "section 9(2) the D2 in-process proof over the REAL adopted tools (hold present -> claim_task/update_task succeed, deliveriesWhileHeld === 0)",
      status:
        "NOT FOUND on disk under evidence/team-watchdog/redesign/** at this revision. A grep for deliveriesWhileHeld hits only 2026-09-15/16 evidence that PREDATES the redesign (long-tool-false-positive, live/20260915T171438Z, lanes/20260915T170553Z) - do NOT inherit those.",
    },
    {
      t29_clause: "section 9(3) the replay of the 85 recorded incidents (.mpd/team/watchdog/incidents.jsonl) with the count of the historical escalations the new predicate would have produced",
      status: "only MENTIONED in the two SUMMARY.md files at handoff; no dedicated replay artifact found. The verifier must produce the replay and its count.",
    },
    {
      t29_clause: "the rate claim bound (one live run window cannot prove the absence of false positives)",
      status: "the verifier must state their own window and its limits; the lane files carry per-row injected-clock readings, not a live rate claim.",
    },
  ],
  bound:
    "everything above is source material quoted from the author's evidence, correct at the revision and moment stamped here. Any writer to the five lane-A sources, the watchdog dist bundle or the adopted lib invalidates the fingerprints; re-measure before judging.",
}
writeFileSync(join(HERE, "result.json"), JSON.stringify(report, null, 2) + "\n")

const lines = [
  "t29 SOURCE MATERIAL handed over by the lane-A author (watchdog-engineer). This is NOT a verdict and must not be cited as an acceptance reading for t29.",
  `revision: ${report.revision.head} (${report.revision.branch}) at ${at}`,
  "",
  "RE-RUNNABLE DRIVERS (each drives BOTH trees: .mpd/red-baseline and the working tree, with an injected clock):",
  "  node evidence/team-watchdog/redesign/core/20260917T013000Z/rows-driver.mjs         # section 9 rows (a)(b)(d)",
  "  node evidence/team-watchdog/redesign/holds/20260917T020000Z/rows-bf-driver.mjs     # section 9 rows (b)(f)",
  "  node evidence/team-watchdog/redesign/config/20260917T011345Z/cross-layer-defaults.mjs  # three-layer knob agreement + negative control",
  "  skills/dsh-qa/scripts/team-watchdog-boot.mjs --out <your own evidence dir>         # real mounted boot (isolated DSH_HOME + sandbox HOME)",
  "",
  "SETTLED-HASH READINGS FROM THE AUTHOR'S RUNS (re-measure; do not inherit):",
  "  core:  settleMs=50000 settled=true redMatchesContract={machine:true,engine:true,tools:true} greenMatchesContract={machine:false,engine:false,tools:false} ok=true",
  "  holds row (b): RED '91000:warn, 181000:warn, 271000:escalate + hold on disk'  vs  GREEN 'every tick empty, no hold, dependencyParked=4, fold a1: OUTSTANDING'",
  "  holds row (f): RED '1000:warn, 2000:warn, 3000:escalate + hold on disk'       vs  GREEN 'every tick empty, no hold, neverStarted=1'",
  "",
  "FROZEN HASHES AT HANDOFF (material only):",
  ...FILES.map((p) => `  ${hashes[p]}  ${p}`),
  "",
  "GAPS THE VERIFIER MUST CLOSE THEMSELVES (found absent, not assumed present):",
  "  1. D2 in-process proof over the real adopted tools (deliveriesWhileHeld === 0) - not under redesign/**; older hits predate the redesign.",
  "  2. the 85-incident replay + the count of historical escalations the new predicate would produce - no dedicated artifact.",
  "  3. a live-rate bound - state your own window.",
  "",
  "BOUND: any writer to the five lane-A sources / the watchdog dist / the adopted lib invalidates the fingerprints; re-measure before judging.",
]
writeFileSync(join(HERE, "output.log"), lines.join("\n") + "\n")
console.log("wrote", join(HERE, "result.json"))
for (const p of FILES) console.log(" ", hashes[p].slice(0, 16), p)
