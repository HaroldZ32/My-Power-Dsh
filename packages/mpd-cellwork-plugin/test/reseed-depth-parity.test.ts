// THE THIRD COPY OF THE DEPTH DERIVATION, PINNED TO THE FIRST (repair R3.5).
//
// WHY. `reseedMaxDepthOf` (this package) re-derives what `spawnMaxDepthOf` (`mpd-roles`) and its
// workmate twin already derive: the agent-nesting cap a child is forwarded is its live parent's recorded
// delegation depth plus one, a session recorded as `origin: "subagent"` without a depth reads as depth 1,
// and anything else reads as depth 0. The three copies exist on purpose — a runtime import between these
// rows would add an edge to the frozen cross-package coupling inventory — so THIS FILE is what fails the
// moment one copy drifts from the others. The workmate package carries the same arm against the same
// helper; this is the cellwork half.
//
// TEST-ONLY COUPLING: the import of `mpd-roles-plugin/src/index.ts` is a test-side comparison, never a
// shipped dependency (`packages/mpd-cellwork-plugin/dist` contains no reference to that row).
import { describe, expect, test } from "bun:test"
import { reseedMaxDepthOf } from "../src/protocol-core.ts"
import { spawnMaxDepthOf } from "../../mpd-roles-plugin/src/index.ts"

/** The live-agent parameter `reseedMaxDepthOf` reads — derived, so the helper cannot drift silently. */
type LiveAgent = Parameters<typeof reseedMaxDepthOf>[0]

/**
 * One synthetic live Agent carrying a session header.
 *
 * The cast is unavoidable: the adapter types a live Agent's `session` as opaque (only the header fields
 * below are consulted), so a fixture can only be handed over structurally.
 * @param header - the header the case wants, or `undefined` for a session that carries none.
 * @returns the handle both helpers read.
 */
function liveAgent(header: Record<string, unknown> | null | undefined): LiveAgent {
  return (header === undefined ? { session: {} } : { session: { header } }) as unknown as LiveAgent
}

describe("R3.5: the reseed's depth derivation agrees with the roster's spawn rule", () => {
  test("every header shape answers the SAME cap from both helpers", () => {
    /** The shapes the contract names, each with the cap the rule derives. */
    const shapes: Array<{ name: string; header: Record<string, unknown> | null | undefined; depth: number }> = [
      // A recorded depth of 1 or more answers depth + 1, numeric strings included.
      { name: "depth 1", header: { delegationDepth: 1 }, depth: 2 },
      { name: "depth 3", header: { delegationDepth: 3 }, depth: 4 },
      { name: "depth \"2\"", header: { delegationDepth: "2" }, depth: 3 },
      // A depth BELOW 1 is not a depth: the session reads as top-level (or as a child when it says so).
      { name: "depth 0", header: { delegationDepth: 0 }, depth: 1 },
      { name: "depth -1", header: { delegationDepth: -1 }, depth: 1 },
      { name: "depth NaN", header: { delegationDepth: "not a number" }, depth: 1 },
      // `origin: "subagent"` without a depth is a CHILD: depth 1, whose child lands at depth 2.
      { name: "origin subagent", header: { origin: "subagent" }, depth: 2 },
      { name: "origin subagent + depth 0", header: { origin: "subagent", delegationDepth: 0 }, depth: 2 },
      { name: "another origin", header: { origin: "user" }, depth: 1 },
      // Headerless: an empty header, a null header and no session at all are all depth 0.
      { name: "empty header", header: {}, depth: 1 },
      { name: "null header", header: null, depth: 1 },
      { name: "no session", header: undefined, depth: 1 },
    ]
    for (const shape of shapes) {
      // BOTH HALVES ARE ASSERTED: the rule, and that the two copies of it agree on this very header.
      expect({ shape: shape.name, depth: reseedMaxDepthOf(liveAgent(shape.header)) }).toEqual({ shape: shape.name, depth: shape.depth })
      expect({ shape: shape.name, depth: spawnMaxDepthOf({ session: { header: shape.header } }) }).toEqual({ shape: shape.name, depth: reseedMaxDepthOf(liveAgent(shape.header)) })
    }
  })

  test("an agent with no session at all answers the same cap from both helpers", () => {
    // The one shape the two signatures spell differently: `spawnMaxDepthOf` accepts `unknown` (it is
    // called with a raw dispatch), while `reseedMaxDepthOf` is typed to a live Agent and reads its
    // `session` field. A session-less handle is the common boundary, so it is pinned HERE.
    expect(reseedMaxDepthOf(liveAgent(undefined))).toBe(1)
    expect(spawnMaxDepthOf({})).toBe(1)
    expect(spawnMaxDepthOf(undefined)).toBe(1)
  })
})
