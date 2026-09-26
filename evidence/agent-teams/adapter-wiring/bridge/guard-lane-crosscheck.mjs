// READ-ONLY cross-check for the guard lane (task t6): does ITS OWN create-class predicate accept
// the bridge entry THIS lane left behind, and does its reconstruction reproduce the landed file?
//
// This lane (t5) never edits scripts/patch-agent-teams-fixes.mjs — the missing-file create/check
// behaviour belongs solely to the guard lane. What this lane OWNS is the premise: one registry entry
// for lib/mpd-adapter-ctx.js, the single-region layout with one non-region skeleton line on each
// side, and beforeContext + block + afterContext + "\n" === the file bytes.
//
// Run: node evidence/agent-teams/adapter-wiring/bridge/guard-lane-crosscheck.mjs
import { readFileSync } from "node:fs"
import { MPD_DELTAS } from "../../../../packages/mpd-agent-teams-plugin/lib/mpd-deltas.js"
import { createClassBase, reconstructCreateClassFile } from "../../../../scripts/patch-agent-teams-fixes.mjs"

const repoFile = "packages/mpd-agent-teams-plugin/lib/mpd-adapter-ctx.js"
const repoRoot = new URL("../../../../", import.meta.url).pathname
const entries = MPD_DELTAS.filter((delta) => delta.file === repoFile)
console.log("entries for", repoFile + ":", entries.length)
console.log('createClassBase("mpd-adapter-ctx.js"):', createClassBase("mpd-adapter-ctx.js"))
console.log('createClassBase("mpd-deltas.js") (must be undefined):', createClassBase("mpd-deltas.js"))
const rebuilt = reconstructCreateClassFile(entries[0])
const raw = readFileSync(repoRoot + repoFile, "utf8")
console.log("guard-lane reconstruction byte-identical to the landed file:", rebuilt === raw)
console.log("reconstructed bytes:", rebuilt === undefined ? "undefined" : rebuilt.length, "| file bytes:", raw.length)
process.exit(rebuilt === raw ? 0 : 1)
