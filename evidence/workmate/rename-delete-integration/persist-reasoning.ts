#!/usr/bin/env node
// t11 evidence helper: persist the reasoning artifacts for the integration record.
//
// The t11 acceptance requires the preserved contract, the t1 validation result and the t2
// traversal dossier to survive the session ON DISK under evidence/workmate/rename-delete-integration/
// <timestamp>/. The originals live in the live .mpd paths (agent-teams task records), which are
// mutable team state — this script reads them and writes FROZEN COPIES into the evidence dir, so
// the reasoning stays readable even after the team records change.
//
// Isolation: reads only; writes only inside evidence/workmate/rename-delete-integration/<ts>/.
// The SHA-256 of every source file is recorded so a reader can tell whether the live artifact moved
// after this snapshot.
//
// Usage: node evidence/workmate/rename-delete-integration/persist-reasoning.mjs [<timestamp-dir>]
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const ts = process.argv[2] || new Date().toISOString().replace(/[:.]/g, "-")
const outDir = join(repoRoot, "evidence", "workmate", "rename-delete-integration", ts)
mkdirSync(outDir, { recursive: true })

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

/** Copy one source file into the snapshot and return its provenance record. */
function snapshot(label, srcRel, outName) {
  const src = join(repoRoot, srcRel)
  if (!existsSync(src)) return { label, source: srcRel, present: false, note: "MISSING at snapshot time" }
  const bytes = readFileSync(src)
  writeFileSync(join(outDir, outName), bytes)
  return { label, source: srcRel, snapshot: outName, present: true, bytes: bytes.length, sha256: sha256(src) }
}

const sources = [
  snapshot("contract", ".mpd/plans/workmate-rename-delete-contract.md", "contract.md"),
  snapshot("t1-contract-validation", ".mpd/plans/workmate-rename-delete-contract.md", "contract-t1-validation.md"),
  snapshot("t2-traversal-dossier", ".mpd/team/workmate-rename-delete/team.json", "team-task-records.json"),
]

const manifest = {
  task: "t11 integration — persisted reasoning artifacts",
  persistedAt: new Date().toISOString(),
  note:
    "Frozen copies for the delivery record. The contract is the binding interface document (preserved by " +
    "the captain from the first team's t1 verdict=pass plus live corrections). The t2 dossier is the " +
    "Researcher's traversal record; both are also preserved in the agent-teams task records, whose task " +
    "outputs are embedded in team-task-records.json (the whole team.json, hence the t2 dossier, the t1 " +
    "validation record, the t6 verification result and every review's findings).",
  sources,
  truncatedOrMissing: sources.filter((s) => !s.present).map((s) => s.label),
}
writeFileSync(join(outDir, "reasoning-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
console.log("[persist-reasoning] wrote " + outDir)
for (const s of sources) console.log("  " + (s.present ? "OK  " : "MISS") + " " + s.label + " <- " + s.source + (s.bytes ? " (" + s.bytes + " bytes)" : ""))
