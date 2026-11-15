// T6 supplementary arm: the documented `.mpd/mpd.jsonc` `worktree.*` overlay (via the composed
// `mpdConfig` service) must really reach the row: the FILE wins per key over the row config.
import { execFileSync } from "node:child_process"
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const DIST = "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh/packages/mpd-worktree-plugin/dist/index.js"
const root = mkdtempSync(join(tmpdir(), "t6-overlay-"))
execFileSync("git", ["-C", root, "init", "-q", "-b", "main"])
execFileSync("git", ["-C", root, "config", "user.email", "r@example.com"])
execFileSync("git", ["-C", root, "config", "user.name", "R"])
writeFileSync(join(root, ".gitignore"), ".mpd/\n")
writeFileSync(join(root, "a.txt"), "one\n")
execFileSync("git", ["-C", root, "add", "."])
execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"])
process.env.DSH_WORKSPACE_ROOT = root

const row = await import(pathToFileURL(DIST).href + "?v=" + Math.random())
const tools = new Map()
// The composed config service answers RAW dotted leaves, exactly as mpd-config's keyed read does.
const fileLeaves = { "worktree.dir": "custom-wt", "worktree.branchPrefix": "member/", "worktree.max": 1 }
const ctx = {
  get: (key) => {
    if (key === "tools") return { register: (def) => { tools.set(def.name, def); return () => {} } }
    if (key === "mpdConfig") return { get: (dotted) => fileLeaves[dotted] }
    return undefined
  },
  provide: () => {},
}
// The ROW config says the default dir and prefix; the FILE must win on both.
row.apply(ctx, { dir: "row-wt", branchPrefix: "row/" })
const created = await tools.get("mpd_worktree_create").execute({ name: "alice" }, {})
const okDir = created.path === join(root, "custom-wt", "alice") && existsSync(created.path)
const okBranch = created.branch === "member/alice"
// max: 1 from the file must cap the SECOND active worktree.
let capped = false
try { await tools.get("mpd_worktree_create").execute({ name: "bob" }, {}) } catch (error) { capped = /worktree\.max is 1/.test(String(error.message)) }
console.log(`ARM P24-mpdjsonc-overlay ${okDir && okBranch && capped ? "PASS" : "FAIL"} path=${created.path} branch=${created.branch} maxFromFile=${capped}`)
rmSync(root, { recursive: true, force: true })
if (!(okDir && okBranch && capped)) process.exit(1)
