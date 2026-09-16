// r2 — the ROTATION consequence of the shared heartbeat file, measured in both directions.
//
// PROCESS NOTE (disclosed, not hidden): my first post-fix re-run of the earlier script overwrote
// the file that held the PRE-fix capture, so that capture no longer exists on disk. Rather than
// present a mislabelled file, the removed rule is modelled here EXPLICITLY: same 13-line input,
// same "keep the last N turn-starts of the FILE" rule the code used before this repair. The fixed
// behaviour is measured by CALLING the real `rotateHeartbeats`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..", "..")
const { rotateHeartbeats, readHeartbeats } = await import(join(REPO, "packages/mpd-team-watchdog-plugin/src/store.ts"))
const { heartbeatPath } = await import(join(REPO, "packages/mpd-team-watchdog-plugin/src/paths.ts"))
const WS = join(HERE, "ws-rotation")
const STATE_DIR = join(".mpd", "team")
const NAME = "Architect"
const KEEP = 3
const lines = [JSON.stringify({ kind: "step", at: 1_000, member: NAME, memberKey: NAME, teamId: "team-beta", taskId: "t1", attemptId: "att-1", turnId: "b", workspace: WS })]
for (let generation = 0; generation < 4; generation += 1) {
  for (const [kind, at] of [["turn-start", 10_000 + generation * 100], ["step", 10_050 + generation * 100], ["turn-end", 10_099 + generation * 100]]) {
    lines.push(JSON.stringify({ kind, at, member: NAME, memberKey: NAME, teamId: "team-alpha", taskId: "t1", attemptId: "att-1", turnId: "a" + generation, workspace: WS }))
  }
}
const teamBeta = (entries) => entries.filter((line) => { try { return JSON.parse(line).teamId === "team-beta" } catch { return false } }).length

// (a) THE REMOVED RULE, MODELLED: the last KEEP turn-starts across the WHOLE file.
function removedRule(fileLines, keep) {
  const starts = fileLines.map((line, index) => ({ index, kind: JSON.parse(line).kind })).filter((entry) => entry.kind === "turn-start").map((entry) => entry.index)
  if (starts.length <= keep) return fileLines
  return fileLines.slice(starts[starts.length - keep])
}
const modelled = removedRule(lines, KEEP)

// (b) THE CURRENT RULE, CALLED: `rotateHeartbeats` groups by the stamp's own team.
rmSync(WS, { recursive: true, force: true })
const path = heartbeatPath(WS, STATE_DIR, NAME)
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, lines.join("\n") + "\n")
const rotated = rotateHeartbeats(WS, STATE_DIR, NAME, KEEP)
const currentLines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "")

const verdict = {
  input: { lines: lines.length, teamBetaStamps: teamBeta(lines) },
  removedRuleModelled: {
    note: "a MODEL of the rule this repair replaced (global keep-last-N turn-starts) — NOT the old code",
    kept: modelled.length,
    teamBetaStampsKept: teamBeta(modelled),
    evictsTheOtherTeamsEvidence: teamBeta(modelled) === 0,
  },
  currentRuleCalled: {
    note: "the REAL `rotateHeartbeats` from src/store.ts — per-team groups",
    rotated: rotated.rotated,
    kept: currentLines.length,
    teamBetaStampsKept: teamBeta(currentLines),
    teamAlphaGenerations: currentLines.filter((line) => JSON.parse(line).teamId === "team-alpha" && JSON.parse(line).kind === "turn-start").length,
    preservesTheOtherTeamsEvidence: teamBeta(currentLines) === teamBeta(lines),
  },
}
writeFileSync(join(HERE, "rotation.json"), JSON.stringify(verdict, null, 2) + "\n")
console.log(JSON.stringify(verdict, null, 2))
process.exit(verdict.removedRuleModelled.evictsTheOtherTeamsEvidence && verdict.currentRuleCalled.preservesTheOtherTeamsEvidence && verdict.currentRuleCalled.teamAlphaGenerations === KEEP ? 0 : 1)
