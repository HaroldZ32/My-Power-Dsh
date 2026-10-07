// wave-3 (t9) driver 4k — the orphan rows across ALL 12 registered regions.
//
// t7's binding precision: no silent deletion is reproducible; the failure the repair
// closes is the ROW and its DIAGNOSIS, not a data-loss path. This driver measures that
// statement directly instead of asserting it:
//   precondition — no block body TAIL equals its own beforeContext (the coincidence that
//                  would let a dropped-orphan heal silently relocate instead of refusing);
//   R3 (begin present + end absent + body drifted) — every region refuses, names the
//                  region AND the begin marker's line with the remedy, file byte-untouched;
//   R5 (end present + begin absent + nothing survived) — every region drops the orphan
//                  end line and heals byte-identically.
// The live tree is never touched (each case runs in its own /tmp root).
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..")
const { MPD_DELTAS } = await import(join(repo, "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"))
const { applyAgentTeamsFixes } = await import(join(repo, "scripts/patch-agent-teams-fixes.mjs"))

const LIB = ["quality-gates.js", "tools.js", "mpd-deltas.js"]
const beginLine = (id) => `//#region ${id} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)`
const endLine = (id) => `//#endregion ${id}`

const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "mpd-w3-orphan-rows-"))
  mkdirSync(join(root, "packages/mpd-agent-teams-plugin/lib"), { recursive: true })
  for (const file of LIB)
    cpSync(join(repo, "packages/mpd-agent-teams-plugin/lib", file), join(root, "packages/mpd-agent-teams-plugin/lib", file))
  return root
}

const tailCollisions = MPD_DELTAS.filter((delta) => {
  const body = delta.block.split("\n").slice(1, -1)
  return body.slice(-delta.beforeContext.length).join("\n") === delta.beforeContext.join("\n")
}).map((delta) => delta.id)

const rows = []
for (const delta of MPD_DELTAS) {
  const name = delta.file.split("/").pop()
  {
    const root = scratch()
    try {
      const path = join(root, delta.file)
      const lines = readFileSync(path, "utf8").split("\n")
      const begin = lines.findIndex((line) => line.trim() === beginLine(delta.id))
      const end = lines.findIndex((line) => line.trim() === endLine(delta.id))
      lines.splice(end, 1)
      lines[begin + 1] = `${lines[begin + 1]} // drifted`
      writeFileSync(path, lines.join("\n"))
      const mutated = readFileSync(path, "utf8")
      let message = ""
      try {
        applyAgentTeamsFixes({ root, write: true })
      }
      catch (error) {
        message = String(error.message)
      }
      rows.push({
        id: delta.id,
        file: name,
        row: "R3",
        refused: message.includes("NOT the registered block"),
        namesRegion: message.includes(delta.id),
        namesLine: message.includes(`begin marker at line ${begin + 1}`),
        namesRemedy: message.includes("--write-registry"),
        untouched: readFileSync(path, "utf8") === mutated,
      })
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
  {
    const root = scratch()
    try {
      const path = join(root, delta.file)
      const canonical = readFileSync(path, "utf8")
      const lines = readFileSync(path, "utf8").split("\n")
      const begin = lines.findIndex((line) => line.trim() === beginLine(delta.id))
      const end = lines.findIndex((line) => line.trim() === endLine(delta.id))
      lines.splice(begin, end - begin)
      writeFileSync(path, lines.join("\n"))
      let status = ""
      try {
        status = applyAgentTeamsFixes({ root, write: true }).status
      }
      catch (error) {
        status = `ERROR: ${String(error.message).slice(0, 120)}`
      }
      rows.push({ id: delta.id, file: name, row: "R5", status, byteIdentical: readFileSync(path, "utf8") === canonical })
    }
    finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

const r3 = rows.filter((row) => row.row === "R3")
const r5 = rows.filter((row) => row.row === "R5")
const result = {
  driver: "check4k-orphan-rows-all-regions",
  regions: MPD_DELTAS.length,
  precondition_bodyTailEqualsBeforeContext: tailCollisions,
  r3: {
    total: r3.length,
    refused: r3.filter((row) => row.refused).length,
    namesRegion: r3.filter((row) => row.namesRegion).length,
    namesLine: r3.filter((row) => row.namesLine).length,
    namesRemedy: r3.filter((row) => row.namesRemedy).length,
    untouched: r3.filter((row) => row.untouched).length,
  },
  r5: {
    total: r5.length,
    applied: r5.filter((row) => row.status === "applied").length,
    byteIdentical: r5.filter((row) => row.byteIdentical).length,
  },
  note: "no silent deletion is reproducible: R3 refuses without writing (file byte-untouched) in every region, and the precondition shows the silent-relocation coincidence does not exist",
}
result.passed = tailCollisions.length === 0
  && r3.length === MPD_DELTAS.length && r3.every((row) => row.refused && row.namesRegion && row.namesLine && row.namesRemedy && row.untouched)
  && r5.length === MPD_DELTAS.length && r5.every((row) => row.status === "applied" && row.byteIdentical)
console.log(JSON.stringify(result, null, 2))
if (!result.passed)
  process.exitCode = 1
