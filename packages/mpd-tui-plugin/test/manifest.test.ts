// The two `dsh-plugin.json` declarations this repository ships: ONE plugin identity for TWO packaging
// shapes (the bundle a profile installs, and the TUI package itself). These arms are the drift guard:
// if either file changes identity, version, permission surface, requirement set or facet entry
// independently, the pair stops describing one plugin and this suite says so.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from this test's own URL (`<root>/packages/mpd-tui-plugin/test/`). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url))

/** A host facet declaration, as the Community v0.15 manifest carries it. */
interface Facet {
  /** The module path, relative to the manifest's package root (no `..`). */
  readonly entry?: string
  /** The facet API version (`v1alpha1`). */
  readonly apiVersion?: string
}

/** The slice of a Community v0.15 manifest this suite compares. */
interface Manifest {
  /** Absolute schema URI. */
  readonly $schema?: string
  /** The manifest protocol version (`0.15`). */
  readonly manifestVersion?: string
  /** The stable plugin identity shared by both declarations. */
  readonly id?: string
  /** The display name. */
  readonly name?: string
  /** The package version this declaration describes. */
  readonly version?: string
  /** Host/client/worker facets; v0.15 allows the host facet only. */
  readonly facets?: { readonly host?: Facet; readonly client?: unknown; readonly worker?: unknown }
  /** Required and optional protocol references. */
  readonly requires?: { readonly contracts?: readonly Record<string, unknown>[]; readonly services?: unknown }
  /** The minimal permission surface. */
  readonly permissions?: readonly Record<string, unknown>[]
  /** The contribution block. */
  readonly contributes?: { readonly commands?: readonly unknown[] }
  /** The event subscriptions. */
  readonly subscriptions?: readonly unknown[]
  /** The licence id. */
  readonly license?: string
  /** Services this plugin provides; must be absent at v0.15. */
  readonly provides?: unknown
}

/** Read and parse one JSON file of this repository. */
function readJson(relative: string): Manifest {
  return JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as Manifest
}

/** The bundle-level declaration a profile install reads. */
const BUNDLE = readJson("dsh-plugin.json")

/** The package-level declaration TUI-PKG-001 asks of the TUI package itself. */
const PACKAGE = readJson("packages/mpd-tui-plugin/dsh-plugin.json")

/** The root package.json's version. */
const BUNDLE_VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version?: string }).version

/** The TUI package's own version. */
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(ROOT, "packages/mpd-tui-plugin/package.json"), "utf8")) as { version?: string }).version

describe("one identity, two declarations", () => {
  test("id, licence, facet apiVersion and requirement set agree", () => {
    expect(PACKAGE.id).toBe(BUNDLE.id)
    expect(PACKAGE.license).toBe(BUNDLE.license)
    expect(PACKAGE.license).toBe("MIT")
    expect(PACKAGE.facets?.host?.apiVersion).toBe(BUNDLE.facets?.host?.apiVersion)
    expect(PACKAGE.requires?.contracts).toEqual(BUNDLE.requires?.contracts)
  })

  test("each version follows its own package.json", () => {
    expect(BUNDLE.version).toBe(BUNDLE_VERSION)
    expect(PACKAGE.version).toBe(PACKAGE_VERSION)
  })

  test("the hard gate: no permission is requested by either declaration", () => {
    expect(BUNDLE.permissions).toEqual([])
    expect(PACKAGE.permissions).toEqual([])
    expect(BUNDLE.contributes?.commands).toEqual([])
    expect(PACKAGE.contributes?.commands).toEqual([])
  })

  test("both manifests are Community v0.15 and declare only a host facet", () => {
    for (const manifest of [BUNDLE, PACKAGE]) {
      expect(manifest.manifestVersion).toBe("0.15")
      expect(String(manifest.$schema)).toMatch(/^https?:\/\//)
      expect(manifest.facets?.host).toBeDefined()
      expect(manifest.facets?.client).toBeUndefined()
      expect(manifest.facets?.worker).toBeUndefined()
      expect(manifest.provides).toBeUndefined()
      expect(manifest.requires?.services).toBeUndefined()
      expect(Array.isArray(manifest.subscriptions)).toBe(true)
    }
  })
})

describe("each facet entry resolves inside its own package", () => {
  test("the root entry is relative to the bundle and exists", () => {
    /** The bundle-level entry path. */
    const entry = String(BUNDLE.facets?.host?.entry ?? "")
    expect(entry.startsWith("..")).toBe(false)
    expect(existsSync(join(ROOT, entry))).toBe(true)
  })

  test("the package entry is relative to the package and exists", () => {
    /** The package-level entry path. */
    const entry = String(PACKAGE.facets?.host?.entry ?? "")
    expect(entry.startsWith("..")).toBe(false)
    expect(existsSync(join(ROOT, "packages/mpd-tui-plugin", entry))).toBe(true)
  })
})
