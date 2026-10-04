// The CodeGraph shared-daemon policy (packages/mpd-mcp-codegraph/daemon-policy.ts)
// and the two cross-file invariants the launcher depends on. The negative controls
// matter more than the happy path: the policy exists to REMOVE a whole class of
// confusing degradation, so a silent regression to "always share the daemon" (or a
// re-vendored bridge that stops forwarding the opt-out) must fail here loudly.
//
// Typing note: this case drives the policy with hand-built env bags and asserts a non-null
// resolution before reading its fields; the `!` non-null assertions below are the type-level
// expression of those assertions and are erased at runtime.
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyDaemonPolicy, parseDaemonSetting, resolveDaemonPolicy, NO_DAEMON_ENV, POLICY_ENV } from "../daemon-policy.ts"
import type { DaemonEnv } from "../daemon-policy.ts"

/** The package directory, so the source-invariant cases below read the shipped launcher. */
const pkgDir = join(import.meta.dir, "..")

test("parseDaemonSetting: truthy, falsy, unset and invalid stay distinguishable", () => {
  for (const raw of ["1", "true", "ON", "yes", "daemon", "shared"]) expect(parseDaemonSetting(raw), raw).toBe(true)
  for (const raw of ["0", "false", "Off", "no", "in-process", "direct"]) expect(parseDaemonSetting(raw), raw).toBe(false)
  expect(parseDaemonSetting("")).toBeNull()
  expect(parseDaemonSetting(undefined)).toBeNull()
  expect(parseDaemonSetting("maybe")).toBeUndefined()
})

test("default (no env): serve in-process, and the reason names the measured failure", () => {
  /** The decision for an env that sets no knob at all. */
  const policy = resolveDaemonPolicy({})
  expect(policy.noDaemon).toBe(true)
  expect(policy.reason).toContain("Shared daemon connection lost")
  expect(policy.reason).toContain(POLICY_ENV + "=1")
})

test("MPD_CODEGRAPH_DAEMON=1 keeps upstream's shared daemon (no opt-out pinned)", () => {
  /** The decision for an explicit opt-in. */
  const policy = resolveDaemonPolicy({ [POLICY_ENV]: "1" })
  expect(policy.noDaemon).toBe(false)
  /** A live env bag the policy may mutate. */
  const env: DaemonEnv = { [POLICY_ENV]: "1" }
  /** The policy applied to that bag. */
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(applied.noDaemon).toBe(false)
  expect(applied.changed).toBe(false)
  expect(env[NO_DAEMON_ENV]).toBeUndefined()
})

test("MPD_CODEGRAPH_DAEMON=0 pins the opt-out explicitly", () => {
  /** A live env bag the policy may mutate. */
  const env: DaemonEnv = { [POLICY_ENV]: "0" }
  /** The policy applied to that bag. */
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(applied.noDaemon).toBe(true)
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(applied.changed).toBe(true)
  expect(applied.reason).toContain("explicitly")
})

test("an explicit CODEGRAPH_NO_DAEMON=1 is respected and never overridden", () => {
  /** The decision for the contradictory pair, where upstream's opt-out must win. */
  const conflict = resolveDaemonPolicy({ [NO_DAEMON_ENV]: "1", [POLICY_ENV]: "1" })
  expect(conflict.noDaemon).toBe(true)
  expect(conflict.warning).toContain("cannot override")
  /** A live env bag that already carries the pin. */
  const env: DaemonEnv = { [NO_DAEMON_ENV]: "1", [POLICY_ENV]: "1" }
  /** The policy applied to that bag. */
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(applied.changed).toBe(false) // already where we want it: no redundant notice
})

test("an unrecognized value warns and falls back to the safe default", () => {
  /** A live env bag carrying a value the policy cannot classify. */
  const env: DaemonEnv = { [POLICY_ENV]: "yes-please" }
  /** Every notice line the policy asked to print. */
  const lines: string[] = []
  /** The policy applied to that bag. */
  const applied = applyDaemonPolicy(env, { log: (l) => lines.push(l) })
  expect(applied.noDaemon).toBe(true)
  expect(applied.warning).toContain("not a recognized value")
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(lines.length).toBe(1)
  expect(lines[0]).toContain("[mpd-mcp-codegraph]")
})

test("the default emits exactly ONE informational line (never stdout)", () => {
  /** A live env bag with no knob set (the shipped default). */
  const env: DaemonEnv = {}
  /** Every notice line the policy asked to print. */
  const lines: string[] = []
  applyDaemonPolicy(env, { log: (l) => lines.push(l) })
  expect(lines.length).toBe(1)
  expect(lines[0]).toContain("in-process")
})

/**
 * Ordering invariant: the policy must run BEFORE the vendored bridge is imported —
 * `buildCodegraphChildEnv` freezes the child env from this process's env when
 * serve.js loads, so a pin applied afterwards reaches nothing.
 */
test("launch.ts applies the policy before importing the vendored serve.js", () => {
  /** The shipped launcher's source text, which the ordering is asserted on. */
  const src = readFileSync(join(pkgDir, "src", "launch.ts"), "utf8")
  /** Where the daemon policy is applied. */
  const policyAt = src.indexOf("applyDaemonPolicy(")
  /** Where the adopted server module is imported, through the runtime-resolved constant name. */
  const importAt = src.indexOf("import(ADOPTED_SERVE_ENTRY)")
  expect(policyAt).toBeGreaterThan(-1)
  expect(importAt).toBeGreaterThan(-1)
  expect(policyAt).toBeLessThan(importAt)
})

/**
 * Forwarding invariant: the pinned key only works because the vendored bridge's
 * child-env allowlist carries it. A re-vendored dist that drops the key would
 * silently re-enable the shared daemon — this is the guard that catches it.
 */
test("the vendored bridge forwards CODEGRAPH_NO_DAEMON to the child env", () => {
  /** The adopted server's built source, whose env allowlist is the contract asserted here. */
  const serve = readFileSync(join(pkgDir, "dist", "serve.js"), "utf8")
  expect(serve).toContain("CODEGRAPH_NO_DAEMON")
  /** The allowlist declaration and its first 600 characters, where the key must appear. */
  const allowlist = serve.slice(serve.indexOf("SAFE_CODEGRAPH_RUNTIME_ENV_KEYS"))
  expect(allowlist.slice(0, 600)).toContain("CODEGRAPH_NO_DAEMON")
})
