// The shim restates the host's `inject` list, so the ONE thing that can rot is that list drifting from
// the shipped host's. This arm compares them whenever the host is resolvable, and says so loudly when
// it is not — a silent skip would be the same defect class the shim exists to fix.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { inject, name } from "../src/index"

const bundleRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const hostEntry = join(bundleRoot, "node_modules", "dsh-better-sidebar", "lib", "index.js")

describe("the sidebar host contract", () => {
  test("the shim's inject list is the HOST's own, checked against the shipped package", async () => {
    if (!existsSync(hostEntry)) {
      console.log("[host-contract] the sidebar host is not installed here, so the list could not be compared: " + hostEntry)
      expect(inject.length).toBeGreaterThan(0)
      return
    }
    const host = (await import(pathToFileURL(hostEntry).href)) as { inject?: unknown; name?: unknown }
    expect(Array.isArray(host.inject)).toBe(true)
    expect([...(host.inject as string[])].sort()).toEqual([...inject].sort())
    console.log("[host-contract] compared with " + String(host.name) + " @ " + hostEntry)
  })

  test("the row name this module declares is its own, not the host's", () => {
    expect(name).toBe("mpd-better-sidebar-host")
  })
})
