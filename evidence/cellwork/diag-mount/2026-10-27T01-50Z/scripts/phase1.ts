// Phase 1: boot the REAL `dsh-tui` app against a COPY of the installed `dsh-tui` profile, in an
// isolated DSH_HOME + HOME + workspace, with NO --patch overlay. Assert the registration surface.
//
// Usage: bun .tmp-mount-check/phase1.ts <sandboxRoot> <outDir>
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  crashSignatures, provisionTuiHome, readSessionHeaders, runTuiSession, sandboxEnv, tmux,
} from "../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root: dshhome/ (DSH_HOME), home/ (HOME), ws/ (session workspace). */
const root: string = process.argv[2] ?? ""
/** Where every artifact of this run is written. */
const outDir: string = process.argv[3] ?? ""
if (root === "" || outDir === "") {
  console.error("usage: bun phase1.ts <sandboxRoot> <outDir>")
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })
/** Lines appended to the run log. */
const log: string[] = []
const say = (line: string): void => { log.push(line); console.log(line) }
const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex")

/** The installed profile copy under the sandbox DSH_HOME. */
const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
const patchFile = join(profileDir, "node_modules", "@mpd-dsh", "mpd", "cordis.patch.yml")
const cellworkModule = join(profileDir, "node_modules", "@mpd-dsh", "mpd", "packages", "mpd-cellwork-plugin", "dist", "index.js")

say("== sandbox ==")
say("root=" + root)
say("profileDir exists=" + String(existsSync(join(profileDir, "package.json"))))
say("bundle cordis.patch.yml sha256=" + sha256(patchFile))
say("cellwork module exists=" + String(existsSync(cellworkModule)) + " bytes=" + String(existsSync(cellworkModule) ? statSync(cellworkModule).size : -1))
/** The row block as the loader will read it. */
const patchLines = readFileSync(patchFile, "utf8").split("\n")
const at = patchLines.findIndex((line) => line.includes("- id: mpd-cellwork"))
say("cellwork row at cordis.patch.yml:" + String(at + 1))
for (let i = at; i < at + 3 && i < patchLines.length; i += 1) say("  " + String(i + 1) + ": " + patchLines[i])

/** The HOME fixtures, identical in VALUE to the real HOME (`preset: mpd`, onboarding completed). */
say("== HOME fixture ==")
const fixture = provisionTuiHome(root)
for (const file of fixture.evidence) say("wrote " + file + " preset=" + fixture.preset)

say("== boot ==")
/** The child env the boot carries (reported, not inferred). */
const env = sandboxEnv(root, { DEEPSEEK_API_KEY: "sk-diagnostic-stub" })
say("DSH_HOME=" + String(env.DSH_HOME) + " HOME=" + String(env.HOME))
say("DSH_TUI_NO_LAUNCHPAD=" + String(env.DSH_TUI_NO_LAUNCHPAD))

/** One tmux drive: boot, capture the chat screen, then open the slash-command palette. */
const session = runTuiSession({
  lane: "cellwork-diag",
  root,
  outDir,
  bootWaitMs: 120_000,
  steps: [{ name: "slash", keys: ["/"], waitMs: 4000 }, { name: "escape", keys: ["Escape"], waitMs: 1000 }],
})
say("boot failures=" + JSON.stringify(session.failures))
say("crashSignatures=" + JSON.stringify(crashSignatures(session.log)))
for (const pane of session.panes) say("pane " + pane.name + " -> " + pane.file)

/** The row log sinks each mpd row writes (R5: a row never prints). */
const sinkDir = join(root, "ws", ".mpd", "logs")
say("== log sinks: " + sinkDir + " ==")
if (existsSync(sinkDir)) {
  for (const name of readdirSync(sinkDir).sort()) {
    const file = join(sinkDir, name)
    say("--- " + name + " ---")
    say(readFileSync(file, "utf8").trimEnd())
  }
} else {
  say("ABSENT: no .mpd/logs directory under the sandbox workspace")
}

/** The decoded session headers (project keys inside the sandbox only). */
say("== session headers ==")
for (const header of readSessionHeaders(root)) {
  say(header.projectKey + "/" + header.sessionId + " agentPreset=" + JSON.stringify(header.agentPreset) + " cwd=" + JSON.stringify(header.cwd) + " " + header.file)
}

writeFileSync(join(outDir, "phase1.log"), log.join("\n") + "\n")
writeFileSync(join(outDir, "boot-ansi.log"), session.log)
writeFileSync(join(outDir, "phase1.result.json"), JSON.stringify({
  root, outDir, profileDir, patchSha256: sha256(patchFile), cellworkModuleBytes: statSync(cellworkModule).size,
  failures: session.failures, crashSignatures: crashSignatures(session.log), panes: session.panes.map((pane) => pane.file),
}, null, 2) + "\n")
