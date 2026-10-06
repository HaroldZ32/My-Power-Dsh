// The plan-approval executor's CALLER: `createPlanActions` must hand the harness tool the
// adapter's LIVE registry entry, by identity (finding H4).
//
// WHY THIS FILE EXISTS (measured defect: evidence/tui/team-surface-h3-fixed/20260930T104228Z,
// arm 2, H4): the plan scene's approve/discard path used to forward a FABRICATED
// `{ session: { id: sessionId } }`, and a real host refused it at the harness's own session
// store — `session "<id>" is not live in this store` — because a caller is authenticated by
// IDENTITY against the live store. So these arms assert identity (`toBe`) on the object the
// adapter forwards to `tools.execute`, and they assert that NO call happens at all when no
// live agent matches (the honest refusal replaces the fabricated one).
//
// The adapter here is REAL (`createDshAdapter` over a host double), so the assertion covers the
// wiring as well as this package: a clone would have to survive `executeTool` to pass.

import { describe, expect, test } from "bun:test"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index.js"
import { createPlanActions } from "../src/index"
import { createLog } from "../src/log"

/** A silent logger: these arms assert call identity and refusals, not log text. */
const log = createLog(undefined, "mpd-tui-plan-test", {})

/** One live registry entry, shaped as the harness serves it: `session` is the store's entry. */
interface LiveEntry {
  /** The shared session/agent id the registry keys an agent by. */
  id: string
  /** The session object the harness authenticates BY IDENTITY. */
  session?: { id: string }
}

/** One recorded `tools.execute` input, read field by field by the arms below. */
interface RecordedCall {
  /** The tool name the adapter asked the registry for. */
  name?: unknown
  /** The tool arguments, verbatim. */
  arguments?: unknown
  /** The calling agent the adapter forwarded verbatim — the subject of every arm here. */
  agent?: unknown
}

/**
 * Build a REAL adapter over a host double serving `agents` (the live registry) and `tools`.
 * @param entries - the live entries `list()` and `get()` both answer from.
 * @returns the adapter, plus every `tools.execute` input it forwarded, in call order.
 */
function hostWith(entries: readonly LiveEntry[]): { adapter: ReturnType<typeof createDshAdapter>; calls: RecordedCall[] } {
  /** Every execution the adapter forwarded to the harness tool registry. */
  const calls: RecordedCall[] = []
  // BOTH routes `liveAgent` can take are served from the SAME array, so an arm cannot pass one
  // route and silently fail the other.
  /** The live-session registry double. */
  const agents = {
    list: (): readonly LiveEntry[] => entries,
    get: (id: string): LiveEntry | undefined => entries.find((entry) => entry.id === id),
  }
  /** The tool runtime double: it records the exec and answers with a plain success value. */
  const tools = {
    get: (): unknown => ({}),
    execute: async (input: RecordedCall): Promise<{ value: unknown }> => {
      calls.push(input)
      return { value: { team_id: "mpd-1", status: "running", members: 1, tasks: 1 } }
    },
  }
  /** The adapter under test, over a host whose only services are the two above. */
  const adapter = createDshAdapter({ get: (name: string) => (name === "agents" ? agents : name === "tools" ? tools : undefined) })
  return { adapter, calls }
}

describe("plan actions speak as a LIVE registry agent (H4)", () => {
  test("approve forwards the adapter's OWN live agent object by identity, never a clone", async () => {
    /** The live entry the registry serves for the scene's session. */
    const entry: LiveEntry = { id: "s-live-1", session: { id: "s-live-1" } }
    /** The adapter under test and the calls it recorded. */
    const { adapter, calls } = hostWith([entry])
    /** The tool's verdict for one already-gated approval. */
    const result = await createPlanActions(adapter, log).approve({ teamId: "mpd-1", confirmation: "approve mpd-1", sessionId: "s-live-1" })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    // IDENTITY at both levels: the entry itself, and the session object inside it. A structural
    // stand-in passes NEITHER — and `{ session: { id } }` is exactly the stand-in the old code built.
    expect(calls[0].agent).toBe(entry)
    expect((calls[0].agent as LiveEntry).session).toBe(entry.session)
    expect(calls[0].agent).not.toEqual({ session: { id: "s-live-1" } })
    // The boundary call shape is unchanged: the same tool, the same gated arguments.
    expect(calls[0].name).toBe("agent_teams_plan")
    expect(calls[0].arguments).toEqual({ action: "approve", confirmation: "approve mpd-1" })
  })

  test("a live entry whose SESSION matches is the caller even when the registry keys it by another id", async () => {
    /** The live entry whose own id differs from the session id the TUI channel publishes. */
    const entry: LiveEntry = { id: "agent-7", session: { id: "s-live-2" } }
    /** The adapter under test and the calls it recorded. */
    const { adapter, calls } = hostWith([entry])
    /** The tool's verdict for this approval. */
    const result = await createPlanActions(adapter, log).approve({ teamId: "mpd-2", confirmation: "approve mpd-2", sessionId: "s-live-2" })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].agent).toBe(entry)
  })

  test("NO live agent for the session refuses honestly and never calls the tool", async () => {
    // The measured failure's shape: the pane held an id this registry does not serve. Fabricating a
    // caller for it is what the harness refused, so NOT calling at all is the honest answer.
    /** The adapter under test and the calls it recorded (expected: none). */
    const { adapter, calls } = hostWith([{ id: "other-session", session: { id: "other-session" } }])
    /** The refusal the pane renders. */
    const result = await createPlanActions(adapter, log).approve({ teamId: "mpd-3", confirmation: "approve mpd-3", sessionId: "s-gone" })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('session "s-gone"')
    expect(String(result.error)).toContain("not live")
    expect(String(result.error)).toContain("nothing was called")
    // THE DISCRIMINATOR: with the fabricated `{ session: { id } }` this count is 1, never 0.
    expect(calls).toHaveLength(0)
  })

  test("an empty live registry and no session id refuses instead of calling with no caller", async () => {
    /** The adapter under test and the calls it recorded (expected: none). */
    const { adapter, calls } = hostWith([])
    /** The refusal the pane renders. */
    const result = await createPlanActions(adapter, log).approve({ teamId: "mpd-4", confirmation: "approve mpd-4" })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("no live agent")
    expect(String(result.error)).toContain("nothing was called")
    expect(calls).toHaveLength(0)
  })

  test("the DISCARD path obeys the same rule (ONE executor serves both mutations)", async () => {
    /** The adapter under test and the calls it recorded (expected: none). */
    const { adapter, calls } = hostWith([{ id: "other-session", session: { id: "other-session" } }])
    /** The refusal the pane renders for a discard that cannot name a caller. */
    const result = await createPlanActions(adapter, log).discard({ sessionId: "s-gone" })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain("not live")
    expect(calls).toHaveLength(0)
  })

  test("with no session id the ONE live agent is the caller, and TWO are refused as ambiguous", async () => {
    /** The only live entry of the unambiguous composition. */
    const only: LiveEntry = { id: "s-only", session: { id: "s-only" } }
    /** The adapter under test and the calls it recorded. */
    const single = hostWith([only])
    /** The verdict for a discard with no session id and exactly one live agent. */
    const verdict = await createPlanActions(single.adapter, log).discard({})
    expect(verdict.ok).toBe(true)
    expect(single.calls).toHaveLength(1)
    expect(single.calls[0].agent).toBe(only)
    expect(single.calls[0].arguments).toEqual({ action: "delete" })
    // Two live agents and no id would be a GUESS at another session's staged plan, so it refuses.
    /** A second composition holding two live agents. */
    const two = hostWith([{ id: "a", session: { id: "a" } }, { id: "b", session: { id: "b" } }])
    /** The verdict for the same call in the ambiguous composition. */
    const ambiguous = await createPlanActions(two.adapter, log).discard({})
    expect(ambiguous.ok).toBe(false)
    expect(two.calls).toHaveLength(0)
  })

  test("the captain's session id is used when the scene published no session id (the scene's precedence)", async () => {
    /** The live entry keyed by the captain's session id. */
    const captain: LiveEntry = { id: "s-captain", session: { id: "s-captain" } }
    /** The adapter under test and the calls it recorded. */
    const { adapter, calls } = hostWith([captain])
    /** The tool's verdict for an approval that carries only the captain id. */
    const result = await createPlanActions(adapter, log).approve({ teamId: "mpd-6", confirmation: "approve mpd-6", captainSessionId: "s-captain" })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].agent).toBe(captain)
  })
})
