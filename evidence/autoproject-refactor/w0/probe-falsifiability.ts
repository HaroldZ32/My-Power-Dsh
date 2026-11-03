// R-W0 reviewer probe B — does the new pin's discriminating arm catch the PRE-FIX defect (the
// homedir/$HOME tautology)? A faithful port of the pre-fix predicate is run against the same arms.
// READ-ONLY: no filesystem mutation. Run with: bun probe-falsifiability.ts <sandbox>
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

/** Repository root, derived from this probe's own location. */
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
/** The new shared predicate under test. */
const newMod: any = await import(join(rootDir, "packages", "mpd-dsh-adapter-plugin", "src", "index.ts"))
/** The sandbox HOME this probe boots against (argv[2]). */
const sandbox: string = process.argv[2]!

/** A faithful port of the PRE-FIX predicate: realHome comes from $HOME, the defect the pin must catch. */
function preFix(root: string, operation: string): void {
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined || dshHome === "") return
  if (process.env.MPD_DSH_WORKMATE_ALLOW_REAL_HOME === "1") return
  const home = process.env.HOME
  const realHome = process.env.HOME || homedir()
  const inside = (h: string): boolean => root === h || root.startsWith(h.endsWith(sep) ? h : h + sep)
  if (home !== undefined && home !== "" && resolve(home) !== resolve(realHome) && inside(resolve(home))) return
  const e: any = new Error("refusing to " + operation)
  e.status = 403
  e.code = "real-home-refused"
  throw e
}
/** Reduce one guard run to its observable outcome. */
function run(fn: () => void): string { try { fn(); return "ALLOWED" } catch (e: any) { return `REFUSED:${e.status}:${e.code}` } }

process.env.HOME = sandbox
process.env.DSH_HOME = sandbox
delete process.env.MPD_DSH_WORKMATE_ALLOW_REAL_HOME
/** The root arm (a) names: the sandbox's own library. */
const rootA = join(sandbox, ".mpd", "workmate")
const prefA = run(() => preFix(rootA, "rename a workmate"))
const newA = run(() => newMod.assertHomeMutationSandboxed({ root: rootA, operation: "rename a workmate", label: "mpd_workmate", allowEnv: "MPD_DSH_WORKMATE_ALLOW_REAL_HOME" }))
/** The real home, as the shared guard determines it. */
const real: string | undefined = newMod.realUserHome()
/** The root arm (b) names: the real library. */
const rootB = join(real ?? sandbox, ".mpd", "workmate")
const prefB = run(() => preFix(rootB, "rename a workmate"))
const newB = run(() => newMod.assertHomeMutationSandboxed({ root: rootB, operation: "rename a workmate", label: "mpd_workmate", allowEnv: "MPD_DSH_WORKMATE_ALLOW_REAL_HOME" }))
console.log(`arm(a) sandbox-allowed  : PRE-FIX=${prefA}  NEW=${newA}  ${prefA !== newA ? "DISCRIMINATES" : "does not discriminate"}`)
console.log(`arm(b) real-home-refused: PRE-FIX=${prefB}  NEW=${newB}  ${prefB !== newB ? "DISCRIMINATES" : "does not discriminate"}`)
