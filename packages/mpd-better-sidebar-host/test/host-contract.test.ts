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
