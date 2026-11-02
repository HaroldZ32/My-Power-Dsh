// R-W3D reviewer probe B — the T-43 guard arms for the GLOBAL memory root, PURE (guard only, no write).
import { assertMemoryMutationSandboxed, globalRoot } from "../../../packages/mpd-memory-plugin/src/store.ts"

/** The sandbox this probe was launched with (argv[2]). */
const sandbox = process.argv[2]!
/** The real user home, passed by the caller so this probe never derives it from HOME. */
const real = process.env.REAL_HOME!
/** Run one arm: point HOME/DSH_HOME, then ask the guard about the root it would derive. */
const arm = (label: string, home: string | undefined): void => {
  if (home === undefined) delete process.env.HOME; else process.env.HOME = home
  process.env.DSH_HOME = sandbox
  try { assertMemoryMutationSandboxed(globalRoot({}), "x"); console.log(label, "-> ALLOWED root=" + globalRoot({})) }
  catch (e: any) { console.log(label, "-> REFUSED", e?.code, JSON.stringify(String(e?.message).slice(0, 70))) }
}
arm("sandbox HOME ", sandbox)
arm("real HOME    ", real)
arm("HOME unset   ", undefined)
process.env.HOME = sandbox
delete process.env.DSH_HOME
try { assertMemoryMutationSandboxed(globalRoot({}), "x"); console.log("normal session -> ALLOWED (guard no-ops)") } catch { console.log("normal session -> REFUSED (unexpected)") }
