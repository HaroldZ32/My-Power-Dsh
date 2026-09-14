// t14 round 2 — F6 independent unit proof (no boot needed): the agentless path is composed of
// workspaceRootsAll() (adapter) + busyTeams(key, roots) (workmate). Both are exercised directly.
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { workspaceRootOf, workspaceRootsOf } from "../../../packages/mpd-dsh-adapter-plugin/src/index"
import { busyTeams } from "../../../packages/mpd-workmate-plugin/src/index"

const REPO = "/root/dshProj/my-power-dsh"
const A = join(REPO, ".t14-f6-a")
const B = join(REPO, ".t14-f6-b")
const say = (k: string, v: unknown) => console.log("[t14-f6] " + k + "=" + JSON.stringify(v))

function fixture(root: string, teamId: string, members: string[]) {
  mkdirSync(join(root, ".mpd", "team", teamId), { recursive: true })
  writeFileSync(join(root, ".mpd", "team", teamId, "team.json"), JSON.stringify({ id: teamId, members: members.map((name) => ({ name })) }))
}
rmSync(A, { recursive: true, force: true }); rmSync(B, { recursive: true, force: true })
fixture(A, "team-a", ["t14wm"])
fixture(B, "team-b", ["t14wm", "other"])

const agentA = { session: { header: { cwd: A } } }
const agentB = { session: { header: { cwd: B } } }

// adapter: union of live session roots
say("workspaceRootsOf_two_sessions_dedup", workspaceRootsOf({ list: () => [agentA, agentB, agentA, {}] }))
say("workspaceRootsOf_no_registry", workspaceRootsOf(undefined))
say("workspaceRootsOf_non_list", workspaceRootsOf({}))
say("workspaceRootOf_session_precedence", workspaceRootOf({ agent: agentA }))

// workmate: the gate over an explicit root list (what agentlessRoots feeds the service)
say("busyTeams_union[A,B]", busyTeams("t14wm", [A, B]))
say("busyTeams_only_B", busyTeams("t14wm", [B]))
say("busyTeams_unrelated_key", busyTeams("other", [A, B]))
say("busyTeams_no_roots_falls_back_to_host_cwd", busyTeams("t14wm", []))

// the service uses the union when no explicit roots are given (code path under inspection)
import { readFileSync } from "node:fs"
const wm = readFileSync(join(REPO, "packages", "mpd-workmate-plugin", "src", "index.ts"), "utf8")
say("service_rename_uses_agentlessRoots", /rename: \(name: string, newName: string, roots\?: string\[\]\) => renameWorkmate\(name, newName, roots \?\? agentlessRoots\(dsh\)\)/.test(wm))
say("service_delete_uses_agentlessRoots", /delete: \(name: string, purge = false, confirm = "", roots\?: string\[\]\) => deleteWorkmate\(name, purge, confirm, roots \?\? agentlessRoots\(dsh\)\)/.test(wm))
say("tool_path_passes_session_root_only", /renameWorkmate\(args\?\.name, args\?\.new_name, \[dsh\.workspaceRoot\(exec\)\]\)/.test(wm))

rmSync(A, { recursive: true, force: true }); rmSync(B, { recursive: true, force: true })
say("cleanup", (!existsSync(A) && !existsSync(B)) ? "removed" : "STILL_PRESENT")
