// t18 repro harness: drive the watchdog fixture's `pause-preserves-halt-control` leg — the case the
// bridge lane used to measure the defect — and print its outcome. The leg calls the REAL
// `haltTeamWork` (imported from the adopted lib, never stubbed), which reaches the harness seam as
// `input.ctx.cancelAgentTurn(...)`; a hand-built RAW ctx does not carry that surface, so the leg
// throws until the fixture hands it the plugin's own facade.
//
// Run: node evidence/agent-teams/fixture-repair/<stamp>/probe-pause-halt-control.mjs
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const { runCase } = await import(join(REPO, "packages", "mpd-team-watchdog-plugin", "test", "fixtures", "inject.mjs"))

const root = mkdtempSync(join(tmpdir(), "t18-probe-"))
try {
  const result = await runCase("pause-preserves-halt-control", { print: false, root })
  const threw = result.observation?.threw
  console.log("[pause-preserves-halt-control] " + (threw === undefined ? "case completed" : "case threw: " + threw))
  console.log("leg ok: " + result.ok)
  console.log("observation: " + JSON.stringify(result.observation))
  process.exitCode = result.ok ? 0 : 1
}
finally {
  rmSync(root, { recursive: true, force: true })
}
