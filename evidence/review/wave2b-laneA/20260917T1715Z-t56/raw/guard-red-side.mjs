// t56 — F1's DURABLE half, driven first-party on a SCRATCH repo copy of the SHIPPED code (unmodified):
// 1. the faithful copy is GREEN at 119; 2. re-nesting the region there (the defect's exact shape, marker
// count unchanged) must be REFUSED — `--write-registry` by the stack guard, `--check` by the drift it causes.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
const REPO = "/root/dshProj/my-power-dsh"
const ROOT = "/tmp/t56-scratch-repo"
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, "scripts"), { recursive: true })
mkdirSync(join(ROOT, "packages", "mpd-agent-teams-plugin"), { recursive: true })
mkdirSync(join(ROOT, "agent-references"), { recursive: true })
cpSync(join(REPO, "scripts", "patch-agent-teams-fixes.mjs"), join(ROOT, "scripts", "patch-agent-teams-fixes.mjs"))
cpSync(join(REPO, "packages", "mpd-agent-teams-plugin", "lib"), join(ROOT, "packages", "mpd-agent-teams-plugin", "lib"), { recursive: true })
cpSync(join(REPO, "agent-references", "agent-teams-deltas.md"), join(ROOT, "agent-references", "agent-teams-deltas.md"))
const run = (args) => {
  try {
    return { exit: 0, out: execFileSync(process.execPath, [join(ROOT, "scripts", "patch-agent-teams-fixes.mjs"), ...args], { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }) }
  } catch (error) {
    return { exit: error.status ?? "spawn-error", out: `${error.stdout ?? ""}${error.stderr ?? ""}` }
  }
}
const green = run(["--check"])
const file = join(ROOT, "packages", "mpd-agent-teams-plugin", "lib", "session-start.js")
const text = readFileSync(file, "utf8")
const fromA = "//#endregion mpd-delta session-start-gate\n//#region mpd-delta plan-format-seed"
const fromB = "//#endregion mpd-delta plan-format-seed\n//#region mpd-delta interjection-expiry-session-start"
if (text.split(fromA).length - 1 !== 1 || text.split(fromB).length - 1 !== 1) throw new Error("re-nest anchors not unique")
writeFileSync(file, text
  .replace(fromA, "//#region mpd-delta plan-format-seed")
  .replace(fromB, "//#endregion mpd-delta plan-format-seed\n//#endregion mpd-delta session-start-gate\n//#region mpd-delta interjection-expiry-session-start"))
const writeRegistry = run(["--write-registry"])
const checkRed = run(["--check"])
const nested = (out) => out.split("\n").filter((l) => l.includes("NESTED")).slice(0, 1)
console.log(JSON.stringify({
  step1_greenOnFaithfulCopy: { exit: green.exit, line: green.out.trim().split("\n").pop() },
  step2_writeRegistryOnRenested: { exit: writeRegistry.exit, refusal: nested(writeRegistry.out), tail: writeRegistry.out.trim().split("\n").slice(-1) },
  step3_checkOnRenested: { exit: checkRed.exit, tail: checkRed.out.trim().split("\n").slice(-1) },
  verdict: green.exit === 0 && writeRegistry.exit !== 0 && nested(writeRegistry.out).length === 1 && checkRed.exit !== 0 ? "PASS — the shipped guard REFUSES the nesting by name and span, and the drift is caught too" : "FAIL — not as claimed",
}, null, 2))
rmSync(ROOT, { recursive: true, force: true })
