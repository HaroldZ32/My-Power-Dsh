// THE TEAM DOOR: mpd is the SINGLE team front door, so the OFFICIAL team AUTHORING tools are refused at
// the tool boundary and every refusal teaches the mpd door.
//
// WHAT THESE ARMS PIN, in the order the requirement states them:
//   (a) each of the five official authoring tools is REFUSED, and the sentence names the tool AND the
//       mpd replacement (`agent_teams_plan`);
//   (b) the base harness rows this bundle's own plumbing depends on are RELEASED — the control that
//       proves the door costs no collateral (`send_message` is what the harness tells every continuable
//       child to call, `presets/mpd.patch.yml:332,335` mounts `list_agents`/`interrupt_agent`);
//   (c) a tool outside the team plane (`write`) is RELEASED;
//   (d) SCOPE: every agent is refused, another preset's TOP-LEVEL session included — the CONSERVATIVE
//       variant, deliberately NOT the delegation gate's preset bypass (see `src/team-door-guard.ts`'s
//       header for why that bypass does not transfer).
//
// THE DOOR IS DRIVEN THROUGH `apply`, never by importing the module: a black-box arm is the only one
// that can go RED before the implementation exists (an import of a file that is not written yet fails
// the whole file instead of failing the requirement), and it is what proves the row REGISTERS the guard
// rather than merely owning a function.
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"

/** One guard callback, as the adapter declares it (`DshAdapter.guardTool`). */
type ToolGuard = (exec: { name?: string; agent?: unknown }) => string | undefined

/** The five official AUTHORING tools the door refuses, case- and trim-exact and never by prefix. */
const REFUSED: readonly string[] = ["spawn_teammate", "team_task_create", "team_task_list", "team_task_get", "team_task_update"]

/** The base harness rows the door MUST release: the bundle's own plumbing calls them. */
const RELEASED: readonly string[] = ["send_message", "list_agents", "wait_agent", "interrupt_agent"]

/** The agent handle a guard reads: only the session header's preset and lineage facts matter here. */
interface GuardAgent {
  /** The harness's session record, whose `header` carries `agentPreset` and the delegation facts. */
  session: { header: Record<string, unknown> }
}

/** A top-level session of the `mpd` preset: the guard's ordinary caller. */
const MPD_TOP_LEVEL: GuardAgent = { session: { header: { agentPreset: "mpd" } } }

/** What one `apply` left behind, so an arm can drive the door the row really installed. */
interface Door {
  /** Every `tools.guard` callback the row registered, in registration order. */
  guards: ToolGuard[]
  /** How many times the registry's disposer was invoked, so the teardown arm can see the release. */
  released: { count: number }
  /** Run the row's `dispose` listeners, as a row reload or an unmount would. */
  teardown: () => void
}

/**
 * Apply the row against a stub adapter that CAPTURES the guard seam.
 *
 * The stub is a proxy whose unhandled properties answer a disposer-returning no-op — the same shape
 * `tool-surface.test.ts` uses — so a seam this file never exercises (the web route, the command, the
 * store reads) cannot crash the capture. `capabilities().toolsGuard` is TRUE because a door that
 * degrades itself away would pass every control arm for the wrong reason.
 */
function openDoor(): Door {
  /** The guards the row registers, captured in order. */
  const guards: ToolGuard[] = []
  /** The `on("dispose")` listeners the row arms. */
  const disposeListeners: Array<() => void> = []
  /** A shared counter object, because a closure counter could not be read back by an arm. */
  const released = { count: 0 }
  /** A disposer-returning no-op, standing in for every seam this file never exercises. */
  const noop = (): (() => void) => () => {}
  /** A proxy adapter: any unhandled property answers `noop`. The empty target is cast because the trap
   * must be free to answer `unknown` for any key. */
  const dsh = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_target, prop) => {
      if (prop === "capabilities") return () => ({ toolsGuard: true })
      if (prop === "guardTool") {
        return (guard: ToolGuard): (() => void) => {
          guards.push(guard)
          return () => { released.count += 1 }
        }
      }
      if (prop === "workspaceRoot") return () => mkdtempSync(join(tmpdir(), "mpd-door-"))
      return noop
    },
  })
  /** The minimal cordis context `apply` needs: the adapter lookup, the dispose arm and no-op effects. */
  const ctx = {
    get: (name: string) => (name === "mpdDsh" ? dsh : undefined),
    on: (event: string, listener: () => void): (() => void) => {
      if (event === "dispose") disposeListeners.push(listener)
      return () => {}
    },
    effect: (fn: () => unknown) => { try { return fn() ?? (() => {}) } catch { return () => {} } },
    provide: noop,
    inject: noop,
  }
  // The stub is a hand-built subset of the real context, so it is asserted to `never` rather than made
  // to satisfy whatever `Context` type the seam declares — the assertion is the stub's contract.
  apply(ctx as never)
  return { guards, released, teardown: () => { for (const listener of disposeListeners) listener() } }
}

/**
 * Every refusal the guards installed RIGHT NOW return for one call — an empty list means the call is
 * released.
 *
 * The list shape is what makes the CONTROL arms honest: they assert the empty list, so a composition
 * that installs no guard at all cannot fail them for the wrong reason (the arm that proves the door
 * exists is the registration arm), while a door that refused a plumbing row would redden them at once.
 */
function refusals(door: Door, name: string, agent: unknown): string[] {
  /** Every installed guard's raw answer for this call, before the sentences are separated out. */
  const answers: Array<string | undefined> = door.guards.map((guard) => guard({ name, agent }))
  return answers.filter((answer): answer is string => typeof answer === "string")
}

/** The door every refusal arm drives: one `apply`, so the five arms read the same registration. */
const gate = openDoor()

describe("(a) the five official authoring tools are refused", () => {
  for (const tool of REFUSED) {
    test("`" + tool + "` is refused, and the sentence names it and the mpd door", () => {
      /** Every refusal the installed guards returned for this name; the door produces exactly one. */
      const refused = refusals(gate, tool, MPD_TOP_LEVEL)
      expect(refused).toHaveLength(1)
      expect(refused[0]).toContain(tool)
      expect(refused[0]).toContain("agent_teams_plan")
    })
  }
})

describe("(b) the control: the bundle's own plumbing is released", () => {
  for (const tool of RELEASED) {
    test("`" + tool + "` is released — the door costs no collateral", () => {
      expect(refusals(gate, tool, MPD_TOP_LEVEL)).toEqual([])
    })
  }
})

describe("(c) a tool outside the team plane is released", () => {
  test("`write` is released, and so is every near miss of the five names", () => {
    // MATCHED ON THE WHOLE NAME: a trim/case-exact set, never a prefix — so a LONGER name that merely
    // starts with a refused one, a case variant, and the empty/absent name are all released.
    for (const name of ["write", "spawn_teammate_preview", "team_task_create_v2", "SPAWN_TEAMMATE", " spawn_teammate", ""]) {
      expect(refusals(gate, name, MPD_TOP_LEVEL)).toEqual([])
    }
    // A call that carries no name at all is a pass-through, not an outage.
    expect(gate.guards.every((guard) => guard({ agent: MPD_TOP_LEVEL }) === undefined)).toBe(true)
  })
})

describe("(d) scope: the CONSERVATIVE variant — every agent is refused", () => {
  test("a foreign preset's TOP-LEVEL session is refused, and a member session too", () => {
    /** A top-level session of the deployment default preset (the delegation gate's bypass case). */
    const foreignTopLevel: GuardAgent = { session: { header: { agentPreset: "cordis" } } }
    /** A recorded delegation child of the mpd preset. */
    const memberChild: GuardAgent = { session: { header: { agentPreset: "mpd", origin: "subagent", delegationDepth: 1 } } }
    /** A session whose header is missing entirely (headerless). */
    const headerless: GuardAgent = { session: { header: {} } }
    for (const agent of [foreignTopLevel, memberChild, headerless]) {
      expect(refusals(gate, "team_task_create", agent)).toHaveLength(1)
    }
  })
})

describe("the refusal is the product", () => {
  test("it is ONE paragraph naming the RECORD plane, the official board's missing guards and the verbs", () => {
    /** The sentence the door returns for an authoring call. */
    const sentence = refusals(gate, "spawn_teammate", MPD_TOP_LEVEL)[0] ?? ""
    // ONE paragraph: no line break for the reader to parse, no bare "denied" that teaches nothing.
    expect(sentence).not.toContain("\n")
    expect(sentence.toLowerCase()).not.toContain("denied")
    // WHAT THIS WORKSPACE'S TEAM PLANE IS, and why the official board is the wrong one to author on.
    expect(sentence).toContain("RECORD")
    expect(sentence).toContain("official board")
    // THE THREE GUARANTEES the official board does NOT carry (the measured reason for the door).
    expect(sentence).toContain("dependency answer")
    expect(sentence).toContain("write-scope")
    expect(sentence).toContain("claim readiness")
    // THE EXECUTABLE REPLACEMENT: author, drive, read — every verb spelled.
    expect(sentence).toContain("agent_teams_plan {action:\"add_member\"|\"create_task\"|\"approve\"}")
    expect(sentence).toContain("agent_teams_task {action:\"claim\"|\"complete\"|\"fail\"}")
    expect(sentence).toContain("agent_teams_plan {action:\"status\"}")
  })
})

describe("the registration is ONE guard, released on teardown", () => {
  test("exactly one guard is installed and the row's dispose runs the registry's disposer", () => {
    /** A second, independent `apply` so the teardown arm cannot disturb the arms above. */
    const reloadable = openDoor()
    expect(reloadable.guards.length).toBe(1)
    expect(reloadable.released.count).toBe(0)
    reloadable.teardown()
    expect(reloadable.released.count).toBe(1)
  })
})
