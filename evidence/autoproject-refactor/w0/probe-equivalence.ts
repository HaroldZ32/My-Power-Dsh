// R-W0 reviewer probe A — differential behaviour of the shipped workmate guard (dist) vs the new
// shared guard (adapter src), each fed the SAME root the workmate row computes. READ-ONLY: it compares
// paths and never creates, reads or writes anything under a home. Run with: bun probe-equivalence.ts <sandbox>
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** Repository root, derived from this probe's own location (`<root>/evidence/autoproject-refactor/w0/`). */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
/** The OLD private guard as shipped (the workmate package's committed dist). */
const OLD = join(root, "packages", "mpd-workmate-plugin", "dist", "index.js")
/** The NEW shared predicate (the adapter's source). */
const NEW = join(root, "packages", "mpd-dsh-adapter-plugin", "src", "index.ts")
const oldMod: any = await import(OLD)
const newMod: any = await import(NEW)
/** The sandbox HOME this probe boots against (argv[2]). */
const sandbox: string = process.argv[2]!
/** The real user home, as the shared guard determines it. */
const real: string | undefined = newMod.realUserHome()

/** The three env keys every arm re-points. */
const KEYS = ["HOME", "DSH_HOME", "MPD_DSH_WORKMATE_ALLOW_REAL_HOME"] as const
/** One environment arm. */
const arms: { id: string; env: Record<string, string | undefined> }[] = [
  { id: "normal-session", env: { DSH_HOME: undefined, HOME: sandbox } },
  { id: "sandbox-boot", env: { DSH_HOME: sandbox, HOME: sandbox } },
  { id: "real-home-boot", env: { DSH_HOME: sandbox, HOME: real ?? "/nonexistent-real" } },
  { id: "home-unset", env: { DSH_HOME: sandbox, HOME: undefined } },
  { id: "override", env: { DSH_HOME: sandbox, HOME: real ?? "/nonexistent-real", MPD_DSH_WORKMATE_ALLOW_REAL_HOME: "1" } },
  { id: "home-sibling-prefix", env: { DSH_HOME: sandbox, HOME: sandbox + "-sibling" } },
  { id: "dsh-home-empty", env: { DSH_HOME: "", HOME: real ?? "/nonexistent-real" } },
]
/** The values the keys held before this probe touched them. */
const saved: Record<string, string | undefined> = {}
for (const key of KEYS) saved[key] = process.env[key]
/** Point the process at one arm's environment. */
function apply(env: Record<string, string | undefined>): void {
  for (const key of KEYS) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key] }
}
/** Run one guard and reduce what happened to a comparable value. */
function outcome(fn: () => void): { ok: boolean; msg?: string; code?: string; status?: number } {
  try { fn(); return { ok: true } } catch (e: any) { return { ok: false, msg: String(e?.message), code: String(e?.code), status: e?.status } }
}
/** Arms whose OLD and NEW outcome differ (0 = equivalent). */
let mismatches = 0
for (const arm of arms) {
  apply(arm.env)
  /** The root the workmate row computes, fed identically to both guards. */
  const rootPath = join(process.env.HOME || homedir(), ".mpd", "workmate")
  const oldOut = outcome(() => oldMod.assertMutationSandboxed("rename a workmate"))
  const newOut = outcome(() => newMod.assertHomeMutationSandboxed({ root: rootPath, operation: "rename a workmate", label: "mpd_workmate", allowEnv: "MPD_DSH_WORKMATE_ALLOW_REAL_HOME" }))
  const same = oldOut.ok === newOut.ok && oldOut.code === newOut.code && oldOut.status === newOut.status && oldOut.msg === newOut.msg
  if (!same) mismatches++
  console.log(`${same ? "SAME" : "DIFF"} ${arm.id} root=${rootPath} old=${JSON.stringify(oldOut)} new=${JSON.stringify(newOut)}`)
}
for (const key of KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] }
console.log(mismatches === 0 ? "EQUIVALENT (0 mismatches)" : `MISMATCHES ${mismatches}`)
