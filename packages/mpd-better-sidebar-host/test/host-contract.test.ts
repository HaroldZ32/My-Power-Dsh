// The shim restates the host's `inject` list MINUS the Web runtime seam it now PROBES, so the ONE
// thing that can rot is that restated list drifting from the shipped host's. This arm compares them
// whenever the host is resolvable, and says so loudly when it is not — a silent skip would be the same
// defect class the shim exists to fix.
//
// The seam arms below pin the DEFECT the probe removes (measured 2026-10-17): harness 0.2.1-rc.2
// provides `webApp` ({getAdvertisedUrl}) where 0.2.0-rc.2 provided `webRuntime`
// ({lanAddresses, trustedHosts}), and the pinned host reads `ctx.webRuntime.trustedHosts`. An injected
// `webRuntime` therefore left the row pending forever on 0.2.1 — these arms require the probe to arm
// ONLY the member it can really find, and to say why when it cannot.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { apply, DSH_SEAM_WEB_APP, inject, name, probeSidebarSeam } from "../src/index"

/** The bundle root, three levels above `<pkg>/test/`. */
const bundleRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
/** The host entry a checkout install puts under the bundle's own node_modules. */
const hostEntry = join(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")

describe("the sidebar host contract", () => {
  test("the shim injects the HOST's own list MINUS the probed Web runtime seam", async () => {
    if (!existsSync(hostEntry)) {
      console.log("[host-contract] the sidebar host is not installed here, so the list could not be compared: " + hostEntry)
      expect(inject.length).toBeGreaterThan(0)
      return
    }
    /** The shipped host module, whose declared inject list the shim restates. */
    const host = (await import(pathToFileURL(hostEntry).href)) as { inject?: unknown; name?: unknown }
    expect(Array.isArray(host.inject)).toBe(true)
    /**
     * The host's list minus `webRuntime`.
     *
     * `webRuntime` is the 0.2.0-generation name the row now PROBES instead of injecting: injecting it
     * is what made the row wait forever on harness 0.2.1-rc.2, which provides no such service.
     */
    const expected = (host.inject as string[]).filter((id: string): boolean => id !== "webRuntime")
    expect([...expected].sort()).toEqual([...inject].sort())
    expect(inject).not.toContain("webRuntime")
    console.log("[host-contract] compared with " + String(host.name) + " @ " + hostEntry)
  })

  test("the row name this module declares is its own, not the host's", () => {
    expect(name).toBe("mpd-better-sidebar-host")
  })
})

describe("the Web runtime seam probe (0.2.1 renamed webRuntime -> webApp)", () => {
  /**
   * A row-context double whose soft read answers from one service map.
   * @param services - the services this composition "provides".
   * @returns the context surface the probe needs.
   */
  function contextWith(services: Record<string, unknown>): { get(service: string, strict?: boolean): unknown } {
    return {
      /** The soft read: the map's entry, undefined for anything else. */
      get: (service: string): unknown => services[service],
    }
  }

  test("0.2.0: webRuntime with trustedHosts ARMS the host, and the line names the member", () => {
    /** The probe's verdict for the 0.2.0 service shape. */
    const decision = probeSidebarSeam(contextWith({ webRuntime: { lanAddresses: [], trustedHosts: ["10.0.0.7"] } }))
    expect(decision.armed).toBe("webRuntime")
    if (decision.armed !== "webRuntime") return
    expect(decision.service.trustedHosts).toEqual(["10.0.0.7"])
    expect(decision.detail).toContain("webRuntime=present with trustedHosts(1)")
    expect(decision.detail).toContain("webApp=absent")
  })

  test("0.2.1: webApp alone (getAdvertisedUrl) does NOT arm, and the reason says the member is missing", () => {
    /** The probe's verdict for the measured 0.2.1 service shape. */
    const decision = probeSidebarSeam(contextWith({ [DSH_SEAM_WEB_APP]: { getAdvertisedUrl: (): string => "http://127.0.0.1:3000/" } }))
    expect(decision.armed).toBe("none")
    if (decision.armed !== "none") return
    expect(decision.reason).toBe("web-app-without-member")
    expect(decision.detail).toContain("webApp=present without trustedHosts")
    expect(decision.detail).toContain("getAdvertisedUrl")
  })

  test("neither service: absent, and the disabled line would name BOTH candidates", () => {
    /** The probe's verdict on a composition that provides neither service. */
    const decision = probeSidebarSeam(contextWith({}))
    expect(decision.armed).toBe("none")
    if (decision.armed !== "none") return
    expect(decision.reason).toBe("absent")
    expect(decision.detail).toContain("webApp=absent")
    expect(decision.detail).toContain("webRuntime=absent")
  })

  test("a webApp that DID carry the member is reported, NEVER silently aliased onto webRuntime", () => {
    /** The probe's verdict for a hypothetical newer webApp that carries the member. */
    const decision = probeSidebarSeam(contextWith({ [DSH_SEAM_WEB_APP]: { trustedHosts: ["gw.example"] } }))
    expect(decision.armed).toBe("none")
    if (decision.armed !== "none") return
    expect(decision.reason).toBe("web-app-under-another-name")
    expect(decision.detail).toContain("ctx.webRuntime by name")
  })

  test("both provided: the 0.2.0 name is armed, because that is the default the pinned host reads", () => {
    /** The probe's verdict when a proxy composition provides both generations. */
    const decision = probeSidebarSeam(contextWith({
      [DSH_SEAM_WEB_APP]: { getAdvertisedUrl: (): string => "http://127.0.0.1:3000/" },
      webRuntime: { trustedHosts: [] },
    }))
    expect(decision.armed).toBe("webRuntime")
    if (decision.armed !== "webRuntime") return
    expect(decision.detail).toContain("webApp=present without trustedHosts")
    expect(decision.detail).toContain("webRuntime=present with trustedHosts(0)")
  })

  test("apply SELF-DISABLES instead of waiting when no Web runtime service exists", async () => {
    /** The scratch workspace the row's diagnostic file sink writes under, so the test owns it. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-sidebar-seam-"))
    /** The environment key the sink resolves its root from, saved so the test restores it. */
    const previousRoot = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** Every line the row's logger emitted. */
      const lines: string[] = []
      await apply(
        {
          get: (): unknown => undefined,
          logger: { warn: (message: unknown): void => { lines.push(String(message)) } },
        },
        {},
      )
      // ONE line, and it is the self-disable: the host was never imported and no sidebar was claimed.
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("[mpd-better-sidebar] disabled:")
      expect(lines[0]).toContain("reason=absent")
    } finally {
      if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousRoot
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe("ARMED is not MOUNTED — a deployment line never claims more than happened", () => {
  test("an armed decision whose injected callback NEVER fires claims no mount", async () => {
    // THE DEFECT THIS LOCKS (measured review finding): the `seam armed` line fired BEFORE the
    // deferred `ctx.inject(...)` callback ran, so a callback that never fired — or a host `apply`
    // that threw — left a log saying the seam was armed with no sidebar behind it.
    /** The scratch workspace the row's file sink writes under, so the test owns it. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-sidebar-armed-"))
    /** The environment key the sink resolves its root from, restored in `finally`. */
    const previousRoot = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** Every line the row logged, at either level. */
      const lines: string[] = []
      await apply(
        {
          // The OLD name carrying `trustedHosts` is what arms the seam.
          get: (id: string): unknown => (id === "webRuntime" ? { trustedHosts: ["a", "b"] } : undefined),
          logger: {
            warn: (message: unknown): void => { lines.push(String(message)) },
            info: (message: unknown): void => { lines.push(String(message)) },
          },
          // The callback is HANDED OVER AND NEVER INVOKED: the never-fires case.
          inject: (): void => { /* never calls back */ },
        } as never,
        {},
      )
      /** The one armed line this boot wrote. */
      const armed = lines.filter((line) => line.includes("seam ARMED"))
      expect(armed).toHaveLength(1)
      // The wording says DECISION, so an operator cannot read it as a mounted sidebar.
      expect(armed[0]).toContain("decision only")
      // ...and nothing claims a mount, because nothing mounted.
      expect(lines.some((line) => line.includes("seam MOUNTED"))).toBe(false)
    } finally {
      if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousRoot
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("a MOUNT that FAILS reports seam NOT mounted specifically, never an either/or", async () => {
    // The negative twin, kept SEPARATE from the success arm: an assertion accepting "MOUNTED or NOT
    // mounted" would pass forever and prove nothing about the distinction.
    /** The scratch workspace for the sink, restored in `finally`. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-sidebar-mount-fail-"))
    /** The environment key the sink resolves its root from. */
    const previousRoot = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** Every line the row logged, at either level. */
      const lines: string[] = []
      await apply(
        {
          get: (id: string): unknown => (id === "webRuntime" ? { trustedHosts: ["a"] } : undefined),
          logger: {
            warn: (message: unknown): void => { lines.push(String(message)) },
            info: (message: unknown): void => { lines.push(String(message)) },
          },
          // The callback FIRES, but the scoped ctx cannot satisfy the host (no inject / effect /
          // webRuntime), so the host's own apply throws and the mount really fails.
          inject: (_seams: readonly string[], callback: (scoped: unknown) => void): void => {
            callback({
              get: (): unknown => undefined,
              logger: {
                warn: (...args: unknown[]): void => { lines.push(String(args[0])) },
                info: (...args: unknown[]): void => { lines.push(String(args[0])) },
              },
            })
          },
        } as never,
        {},
      )
      // The mount is started with `void mountHost(...)`, so its outcome settles on a later turn.
      await new Promise((resolve) => setTimeout(resolve, 250))
      // FAILURE, asserted AS failure — not "one of the two outcomes happened".
      expect(lines.some((line) => line.includes("seam NOT mounted"))).toBe(true)
      expect(lines.some((line) => line.includes("seam MOUNTED"))).toBe(false)
    } finally {
      if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousRoot
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("a MOUNT that SUCCEEDS reports seam MOUNTED — the positive half of the distinction", async () => {
    // THE ARM THIS EXISTS FOR (review finding): the split was only proven on the failure side, so an
    // implementation that never emitted `seam MOUNTED` at all would still pass. This runs the REAL
    // host against a scoped ctx it can genuinely satisfy, and asserts the SUCCESS spelling.
    /** The scratch workspace for the sink, restored in `finally`. */
    const workspace = mkdtempSync(join(tmpdir(), "mpd-sidebar-mounted-"))
    /** The environment key the sink resolves its root from. */
    const previousRoot = process.env.DSH_WORKSPACE_ROOT
    process.env.DSH_WORKSPACE_ROOT = workspace
    try {
      /** Every line the row logged, at either level. */
      const lines: string[] = []
      /** The scoped ctx the host is mounted into: a REAL `webRuntime.trustedHosts` plus the members
       *  the pinned host reaches for, which is what makes its apply RESOLVE rather than throw. */
      const scoped: Record<string, unknown> = {
        webRuntime: { trustedHosts: ["localhost"] },
        webServer: { route: (): (() => void) => () => { /* route owned by the host */ }, get: (): (() => void) => () => { /* route owned */ } },
        sessions: { list: (): unknown[] => [], get: (): unknown => undefined },
        tools: { register: (): (() => void) => () => { /* tool owned by the host */ }, get: (): unknown => undefined },
        logger: {
          info: (message: unknown): void => { lines.push(String(message)) },
          warn: (message: unknown): void => { lines.push(String(message)) },
        },
        get: (id: string): unknown => scoped[id],
        // Deferred seams the host itself opens stay inert here; the mount does not depend on them.
        inject: (): void => { /* never calls back */ },
        effect: (fn: () => unknown): (() => void) => { try { fn() } catch { /* effect body is best-effort */ } return () => { /* scope owns it */ } },
        on: (): (() => void) => () => { /* scope owns it */ },
        fiber: {},
      }
      await apply(
        {
          get: (id: string): unknown => (id === "webRuntime" ? scoped.webRuntime : undefined),
          logger: scoped.logger as Record<string, unknown>,
          inject: (_seams: readonly string[], callback: (s: unknown) => void): void => { callback(scoped) },
        } as never,
        {},
      )
      // Same floating-mount wait as the failure arm.
      await new Promise((resolve) => setTimeout(resolve, 250))
      // SUCCESS, asserted by its OWN spelling.
      expect(lines.some((line) => line.includes("seam MOUNTED: the sidebar host applied inside the injected scope"))).toBe(true)
      expect(lines.some((line) => line.includes("seam NOT mounted"))).toBe(false)
      // The decision line stays a decision even on the happy path.
      /** The armed lines this boot wrote. */
      const armed = lines.filter((line) => line.includes("seam ARMED"))
      expect(armed).toHaveLength(1)
      expect(armed[0]).toContain("decision only")
    } finally {
      if (previousRoot === undefined) delete process.env.DSH_WORKSPACE_ROOT
      else process.env.DSH_WORKSPACE_ROOT = previousRoot
      rmSync(workspace, { recursive: true, force: true })
    }
  })

})
