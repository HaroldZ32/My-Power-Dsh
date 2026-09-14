// The CodeGraph shared-daemon policy (packages/mpd-mcp-codegraph/daemon-policy.mjs)
// and the two cross-file invariants the launcher depends on. The negative controls
// matter more than the happy path: the policy exists to REMOVE a whole class of
// confusing degradation, so a silent regression to "always share the daemon" (or a
// re-vendored bridge that stops forwarding the opt-out) must fail here loudly.
import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { applyDaemonPolicy, parseDaemonSetting, resolveDaemonPolicy, NO_DAEMON_ENV, POLICY_ENV } from "../daemon-policy.mjs"

const pkgDir = join(import.meta.dir, "..")

test("parseDaemonSetting: truthy, falsy, unset and invalid stay distinguishable", () => {
  for (const raw of ["1", "true", "ON", "yes", "daemon", "shared"]) expect(parseDaemonSetting(raw), raw).toBe(true)
  for (const raw of ["0", "false", "Off", "no", "in-process", "direct"]) expect(parseDaemonSetting(raw), raw).toBe(false)
  expect(parseDaemonSetting("")).toBeNull()
  expect(parseDaemonSetting(undefined)).toBeNull()
  expect(parseDaemonSetting("maybe")).toBeUndefined()
})

test("default (no env): serve in-process, and the reason names the measured failure", () => {
  const policy = resolveDaemonPolicy({})
  expect(policy.noDaemon).toBe(true)
  expect(policy.reason).toContain("Shared daemon connection lost")
  expect(policy.reason).toContain(POLICY_ENV + "=1")
})

test("MPD_CODEGRAPH_DAEMON=1 keeps upstream's shared daemon (no opt-out pinned)", () => {
  const policy = resolveDaemonPolicy({ [POLICY_ENV]: "1" })
  expect(policy.noDaemon).toBe(false)
  const env = { [POLICY_ENV]: "1" }
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(applied.noDaemon).toBe(false)
  expect(applied.changed).toBe(false)
  expect(env[NO_DAEMON_ENV]).toBeUndefined()
})

test("MPD_CODEGRAPH_DAEMON=0 pins the opt-out explicitly", () => {
  const env = { [POLICY_ENV]: "0" }
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(applied.noDaemon).toBe(true)
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(applied.changed).toBe(true)
  expect(applied.reason).toContain("explicitly")
})

test("an explicit CODEGRAPH_NO_DAEMON=1 is respected and never overridden", () => {
  const conflict = resolveDaemonPolicy({ [NO_DAEMON_ENV]: "1", [POLICY_ENV]: "1" })
  expect(conflict.noDaemon).toBe(true)
  expect(conflict.warning).toContain("cannot override")
  const env = { [NO_DAEMON_ENV]: "1", [POLICY_ENV]: "1" }
  const applied = applyDaemonPolicy(env, { log: () => {} })
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(applied.changed).toBe(false) // already where we want it: no redundant notice
})

test("an unrecognized value warns and falls back to the safe default", () => {
  const env = { [POLICY_ENV]: "yes-please" }
  const lines = []
  const applied = applyDaemonPolicy(env, { log: (l) => lines.push(l) })
  expect(applied.noDaemon).toBe(true)
  expect(applied.warning).toContain("not a recognized value")
  expect(env[NO_DAEMON_ENV]).toBe("1")
  expect(lines.length).toBe(1)
  expect(lines[0]).toContain("[mpd-mcp-codegraph]")
})

test("the default emits exactly ONE informational line (never stdout)", () => {
  const env = {}
  const lines = []
  applyDaemonPolicy(env, { log: (l) => lines.push(l) })
  expect(lines.length).toBe(1)
  expect(lines[0]).toContain("in-process")
})

/**
 * Ordering invariant: the policy must run BEFORE the vendored bridge is imported —
 * `buildCodegraphChildEnv` freezes the child env from this process's env when
 * serve.js loads, so a pin applied afterwards reaches nothing.
 */
test("launch.mjs applies the policy before importing the vendored serve.js", () => {
  const src = readFileSync(join(pkgDir, "launch.mjs"), "utf8")
  const policyAt = src.indexOf("applyDaemonPolicy(")
  const importAt = src.indexOf('import("./dist/serve.js")')
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
  const serve = readFileSync(join(pkgDir, "dist", "serve.js"), "utf8")
  expect(serve).toContain("CODEGRAPH_NO_DAEMON")
  const allowlist = serve.slice(serve.indexOf("SAFE_CODEGRAPH_RUNTIME_ENV_KEYS"))
  expect(allowlist.slice(0, 600)).toContain("CODEGRAPH_NO_DAEMON")
})
