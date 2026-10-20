// THE SESSION → WORKSPACE LOOKUP: presence decides, absence refuses.
//
// WHY THIS FILE EXISTS (CodeRabbit round 4 on PR #48): the team web routes resolve a workspace from
// the session id the request names. A session the registry holds but which was created without
// `meta.cwd` (a fork that preserved the omission) used to answer `undefined`, so a valid session's
// team routes could only throw. A matched session now follows the HOST's own precedence; an id no
// live agent holds still answers `undefined`, which is what lets the route refuse instead of reading
// another workspace.
import { afterEach, describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import { workspaceRootForSessionOf } from "../src/index"

/** The environment override the host itself honours, restored after every arm. */
const ENV_KEY = "DSH_WORKSPACE_ROOT"
/** The value this file set, or undefined when it changed nothing. */
let previous: string | undefined

afterEach(() => {
  if (previous === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = previous
  previous = undefined
})

/** A registry double over a fixed agent list. */
function registryOf(rows: readonly unknown[]): { list: () => readonly unknown[] } {
  return { list: () => rows }
}

/** One live agent with an explicit session cwd. */
function agentWithCwd(id: string, cwd: string): unknown {
  return { session: { id, header: { cwd } } }
}

describe("workspaceRootForSessionOf", () => {
  test("a matched session resolves its own cwd", () => {
    expect(workspaceRootForSessionOf(registryOf([agentWithCwd("s1", "/ws/one")]), "s1")).toBe(resolve("/ws/one"))
  })

  test("a matched session WITHOUT a cwd follows the host precedence, never undefined", () => {
    // The defect this pins: a cwd-less live session (a fork that omitted meta.cwd) is still a VALID
    // session, so its team routes must not be forced into a 500 by the resolver.
    expect(workspaceRootForSessionOf(registryOf([{ session: { id: "fork", header: {} } }]), "fork")).toBe(resolve(process.cwd()))
    previous = process.env[ENV_KEY]
    process.env[ENV_KEY] = "/ws/override"
    expect(workspaceRootForSessionOf(registryOf([{ session: { id: "fork", header: {} } }]), "fork")).toBe(resolve("/ws/override"))
  })

  test("an UNMATCHED id answers undefined, so the caller can refuse", () => {
    expect(workspaceRootForSessionOf(registryOf([agentWithCwd("s1", "/ws/one")]), "s2")).toBeUndefined()
    expect(workspaceRootForSessionOf(registryOf([agentWithCwd("s1", "/ws/one")]), "")).toBeUndefined()
    expect(workspaceRootForSessionOf(undefined, "s1")).toBeUndefined()
    expect(workspaceRootForSessionOf({}, "s1")).toBeUndefined()
  })
})
