// T26 PROBE 2 — CR#8 (a consult is a LEAF: depth floor on both spawn surfaces, the leaf deny in every
// child's scope, and the cellwork VERIFIER's no-delegation arm), plus the cellwork_recon exclusion.
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/bde2/probe-leaf-cr.ts
import {
  LEAF_SPAWN_DENY as ROLE_LEAF_DENY,
  READONLY_DENY as ROLE_READONLY_DENY,
  consultDepthRefusal as roleConsultDepthRefusal,
  spawnMaxDepthOf as roleSpawnMaxDepthOf,
} from "../../../../packages/mpd-roles-plugin/src/index.ts"
import {
  LEAF_SPAWN_DENY as WORKMATE_LEAF_DENY,
  READONLY_DENY as WORKMATE_READONLY_DENY,
  consultDepthRefusal as workmateConsultDepthRefusal,
  spawnMaxDepthOf as workmateSpawnMaxDepthOf,
} from "../../../../packages/mpd-workmate-plugin/src/index.ts"
import {
  VERIFIER_DENY_TOOLS,
  VERIFIER_NO_DELEGATION,
  cellworkGuardDecision,
  verifierDelegationRefusal,
  verifierRefusal,
} from "../../../../packages/mpd-cellwork-plugin/src/guard.ts"

/** One review result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one review verdict.
 * @param id - the review item id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** One agent handle carrying a session header. */
function agent(header: Record<string, unknown>): unknown {
  return { session: { header } }
}

// ===================================================================================================
// CR#8 layer 2 — the depth floor: depth 0 and 1 stay open, depth >= 2 is refused on BOTH surfaces.
// ===================================================================================================
{
  const headers: Array<Record<string, unknown>> = [
    {}, { delegationDepth: 0 }, { delegationDepth: 1 }, { origin: "subagent" },
    { delegationDepth: 2 }, { delegationDepth: 3 }, { origin: "subagent", delegationDepth: 2 },
  ]
  const role = headers.map((header) => roleConsultDepthRefusal(agent(header)))
  const workmate = headers.map((header) => workmateConsultDepthRefusal(agent(header)))
  const opened = [0, 1, 2, 3].every((index) => role[index] === undefined && workmate[index] === undefined)
  const refused = [4, 5, 6].every((index) => typeof role[index] === "string" && typeof workmate[index] === "string")
  const textsEqual = JSON.stringify(role) === JSON.stringify(workmate)
  const teaching = typeof role[4] === "string" && role[4].includes("LEAF") && role[4].includes("delegation depth 2") && role[4].includes("hand the question UP")
  check("CR8/depth-floor", opened && refused && textsEqual && teaching,
    JSON.stringify({ depths: headers.map((header, index) => [JSON.stringify(header), role[index] === undefined ? "open" : "refused"]) , workmateSame: textsEqual, teaching, sample: typeof role[4] === "string" ? role[4].slice(0, 200) : role[4] }))

  // The cap is still depth + 1 for the callers the floor leaves open.
  const caps = [0, 1, 2].map((depth) => ({ depth, role: roleSpawnMaxDepthOf(agent({ delegationDepth: depth })), workmate: workmateSpawnMaxDepthOf(agent({ delegationDepth: depth })) }))
  check("CR8/cap-parity", caps.every((row) => row.role === row.depth + 1 && row.workmate === row.role),
    JSON.stringify(caps))

  // The two deny lists: READONLY_DENY unchanged at exactly 8 names (bash included); LEAF_SPAWN_DENY = both
  // bundle spawn tools, identical in both rows.
  check("CR8/deny-lists",
    ROLE_READONLY_DENY.length === 8 && JSON.stringify(ROLE_READONLY_DENY) === JSON.stringify(WORKMATE_READONLY_DENY)
      && ROLE_READONLY_DENY.includes("bash")
      && JSON.stringify(ROLE_LEAF_DENY) === '["mpd_role_spawn","mpd_workmate_spawn"]'
      && JSON.stringify(ROLE_LEAF_DENY) === JSON.stringify(WORKMATE_LEAF_DENY),
    JSON.stringify({ readonly: ROLE_READONLY_DENY, readonlyCount: ROLE_READONLY_DENY.length, roleLeaf: ROLE_LEAF_DENY, workmateLeaf: WORKMATE_LEAF_DENY }))
}

// ===================================================================================================
// CR#8's exclusion — `cellwork_recon` is NOT refused by the depth floor; it stays bounded by depthMax.
// ===================================================================================================
{
  const subcaptain = cellworkGuardDecision({ cellId: "cell-1", name: "sub-captain", mode: "subcaptain" }, "cellwork_recon")
  const planner = cellworkGuardDecision({ cellId: "cell-1", name: "cell-planner", mode: "member" }, "cellwork_recon")
  const depthTwoSub = cellworkGuardDecision({ cellId: "cell-1", name: "sub-captain", mode: "subcaptain" }, "cellwork_recon", { args: {}, workspaceRoot: "/ws" })
  check("CR8/recon-exclusion", subcaptain === undefined && planner === undefined && depthTwoSub === undefined,
    JSON.stringify({ subcaptain, planner, depthTwoSub }))
}

// ===================================================================================================
// CR#8 second half — the VERIFIER seat may not delegate; nothing else about its surface changed.
// ===================================================================================================
{
  const seat = { cellId: "cell-1", name: "verifier-1", mode: "verifier" as const }
  const decision = (tool: string): string | undefined => cellworkGuardDecision(seat, tool)
  const roleSpawn = decision("mpd_role_spawn")
  const workmateSpawn = decision("mpd_workmate_spawn")
  const write = decision("write")
  const bash = decision("bash")
  const allowed = ["read", "grep", "glob", "bash", "mpd_verify_open", "mpd_verify_escape", "mpd_verify_seat", "mpd_verify_evidence", "mpd_verify_record", "mpd_roles_list", "mpd_workmate_list", "mpd_workmate_match"]
  const allowedClean = allowed.filter((tool) => decision(tool) !== undefined)
  const plainMember = { cellId: "cell-1", name: "Alice", mode: "member" as const }
  const memberSpawn = cellworkGuardDecision(plainMember, "mpd_role_spawn")
  const memberWorkmate = cellworkGuardDecision(plainMember, "mpd_workmate_spawn")
  const delegating = typeof roleSpawn === "string" && roleSpawn.includes("NEVER DELEGATES") && roleSpawn.includes("FAIL bounces")
  const distinct = typeof write === "string" && roleSpawn !== write && roleSpawn !== verifierRefusal("mpd_role_spawn") && roleSpawn === verifierDelegationRefusal("mpd_role_spawn")
  check("CR8/verifier-no-delegation",
    delegating && distinct && typeof workmateSpawn === "string" && bash === undefined && allowedClean.length === 0
      && memberSpawn === undefined && memberWorkmate === undefined
      && VERIFIER_NO_DELEGATION.length === 2 && VERIFIER_DENY_TOOLS.length === 7 && !VERIFIER_DENY_TOOLS.includes("bash"),
    JSON.stringify({ roleSpawn: String(roleSpawn).slice(0, 170), workmateRefused: typeof workmateSpawn === "string", writeRefusedButDistinct: distinct, allowedClean, memberUnaffected: memberSpawn === undefined && memberWorkmate === undefined, verifierWriteList: VERIFIER_DENY_TOOLS, noDelegationList: VERIFIER_NO_DELEGATION, bashAllowed: bash === undefined }))
}

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
