// D-08 / D-09 — the schema's defaults and its `memory.vcs` union must say what the SHIPPED rows do.
//
// Both defects are invisible to every other gate because nothing asserts the declaration:
//   · D-08 the schema defaulted `commentChecker.autoCheck` to TRUE while the row config this bundle
//     ships (`cordis.patch.yml`: `autoCheck: false`) and the comment-checker README's opt-in posture
//     both say OFF, so Settings rendered a DISABLED hook as ON;
//   · D-09 the union and the knob offered only `git | svn` while `ensureVcs` in mpd-memory-plugin
//     honours `both`, so a documented value could not be selected at all.
//
// The arms read the DECLARATION (the schemastery node tree the settings form renders from), not a
// resolved file layer: these defaults are exactly what the form shows when the user's file is silent.
import { describe, expect, test } from "bun:test"
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, BRIDGE_RESTART_LIMIT, BRIDGE_SECTION_NOTICE, SETTINGS_KNOBS, SettingsSchema } from "../src/settings-schema"

/** The node fields these arms read: the kind, the default, an object's children and a union's members. */
interface SchemaNode {
  /** The node's meta block — where `.default(...)` lands. */
  meta?: { default?: unknown }
  /** Object nodes: their declared children, by key. */
  dict?: Record<string, SchemaNode>
  /** The serialized form, which resolves a union's members to their kinds and values. */
  toJSON?: () => { refs?: Record<string, { type?: string; value?: unknown }> }
}

/** The schema as the raw node tree it is (a schemastery schema is callable, so the cast is stated here). */
const ROOT = SettingsSchema as unknown as SchemaNode

/**
 * Walk the declaration to one node.
 * @param path - the dotted knob path, e.g. `["commentChecker", "autoCheck"]`.
 * @returns the node, or undefined when the path is not declared.
 */
function nodeAt(path: readonly string[]): SchemaNode | undefined {
  /** The node reached so far; the walk stops when a step is missing. */
  let node: SchemaNode | undefined = ROOT
  for (const key of path) {
    node = node?.dict?.[key]
    if (node === undefined) return undefined
  }
  return node
}

/**
 * The literal values a union node accepts, in declaration order.
 * @param node - the union node.
 * @returns the values, or `[]` when the node is not a union of consts.
 */
function unionValues(node: SchemaNode | undefined): unknown[] {
  /** The serialized node, whose `refs` map holds every member by id. */
  const json = node?.toJSON?.()
  /** The member nodes the union lists, resolved through the same `refs` map. */
  const refs = json?.refs ?? {}
  return Object.values(refs)
    .filter((ref) => ref.type === "const")
    .map((ref) => ref.value)
}

describe("D-08 — the autoCheck default matches the shipped row", () => {
  test("the schema defaults commentChecker.autoCheck to FALSE", () => {
    // The row this bundle ships passes `autoCheck: false`, and the hook is documented as opt-in.
    expect(nodeAt(["commentChecker", "autoCheck"])?.meta?.default).toBe(false)
  })
})

describe("D-09 — memory.vcs accepts the mode the memory row honours", () => {
  test("the union declares git, svn AND both", () => {
    expect(unionValues(nodeAt(["memory", "vcs"]))).toEqual(["git", "svn", "both"])
  })

  test("the Settings knob offers the same three options", () => {
    /** The `memory.vcs` row of the ONE knob declaration. */
    const knob = SETTINGS_KNOBS.find((candidate) => candidate.path.join(".") === "memory.vcs")
    expect(knob?.kind).toBe("select")
    expect([...(knob?.options ?? [])]).toEqual(["git", "svn", "both"])
  })
})

/** The knobs a plugin CAPTURES at its own `apply()`, i.e. the groups that still need a boot. */
const MOUNT_CAPTURED = ["hashline.*", "commentChecker.*", "ulw.*", "memory.*", "boulder.dir", "goal.*"]

/** The knobs READ per use, i.e. the groups that reach the running process. */
const LIVE_GROUPS = ["teamModels.slot*", "modelchain.*", "watchdog.*", "team.stateDir", "team.gate", "team.sensitivity", "captain.investigation", "delegation.gate"]

describe("D-18 — the disclosure tells the SCOPED truth, and states BOTH halves", () => {
  test("the live half names every group that reads the config service per use", () => {
    for (const group of LIVE_GROUPS) expect(BRIDGE_DISCLOSURE).toContain(group)
    // The one-way toggle is stated as one-way: a saved false disables, a saved true cannot arm.
    expect(BRIDGE_DISCLOSURE).toContain("tui.dashboardKey is live ONE WAY")
    expect(BRIDGE_DISCLOSURE).toContain("cannot arm a takeover the row config disabled")
  })

  test("the exception half names every mount-captured group, so it cannot silently vanish", () => {
    // The gate is that AT LEAST ONE mount-captured name appears — pinned here per group so a
    // rewrite that drops the whole class (restoring the blanket claim) reddens.
    for (const group of MOUNT_CAPTURED) expect(BRIDGE_RESTART_LIMIT).toContain(group)
    expect(BRIDGE_RESTART_LIMIT).toContain("waits for the next dsh boot")
  })

  test("the section notice renders BOTH halves plus the not-lost clause, and never the blanket sentence", () => {
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_DISCLOSURE)
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_RESTART_LIMIT)
    expect(BRIDGE_SECTION_NOTICE).toContain(BRIDGE_NOT_LOST)
    // The disproved claim, as an ABSENCE: restoring it is the defect this item repaired.
    expect(BRIDGE_SECTION_NOTICE).not.toContain("takes effect in the RUNNING process — no restart")
  })
})
