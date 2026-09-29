// t62 PRE-FLIGHT — the staged predicate's logic in a scratch module (NOT the product change).
// Faithful to the staged patch: realUserHome() reads /etc/passwd by effective uid first, accepts
// userInfo() only when it differs from HOME, and returns undefined (=> refuse) when undeterminable.
import { readFileSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { join, resolve, sep } from "node:path"

function realUserHome() {
  try {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined
    if (uid !== undefined) {
      const line = readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.split(":")[2] === String(uid))
      const home = line === undefined ? undefined : line.split(":")[5]
      if (home !== undefined && home !== "") return home
    }
  } catch { /* fall through */ }
  try {
    const api = userInfo().homedir
    if (api !== "" && resolve(api) !== resolve(process.env.HOME ?? api)) return api
  } catch { /* undeterminable */ }
  return undefined
}

export function assertMutationSandboxed(operation) {
  const dshHome = process.env.DSH_HOME
  if (dshHome === undefined || dshHome === "") return
  if (process.env.MPD_DSH_WORKMATE_ALLOW_REAL_HOME === "1") return
  const root = join(process.env.HOME || homedir(), ".mpd", "workmate")
  const home = process.env.HOME
  const realHome = realUserHome()
  const inside = (h) => root === h || root.startsWith(h.endsWith(sep) ? h : h + sep)
  if (home !== undefined && home !== "" && realHome !== undefined && resolve(home) !== resolve(realHome) && inside(resolve(home))) return
  const err = new Error("mpd_workmate: refusing to " + operation + " inside the REAL library " + root
    + " while DSH_HOME=" + dshHome + " marks an isolated/QA boot — set HOME=<sandbox> (T-43), or set MPD_DSH_WORKMATE_ALLOW_REAL_HOME=1 to override deliberately"
    + (realHome === undefined ? " (the real home could not be determined on this host)" : ""))
  err.status = 403; err.code = "real-home-refused"
  throw err
}
