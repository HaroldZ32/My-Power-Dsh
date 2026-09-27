// mpd-ext-plugin discovery: three roots, two lifecycles.
//
//   <session workspace>/.mpd/extensions/*/mpd-ext.json   per call   skills + flows only
//   ~/.mpd/extensions/*/mpd-ext.json                     apply time skills, flows, mcp, roles
//   <bundle>/extensions/*/mpd-ext.json                   apply time skills, flows, mcp, roles
//
// The split is not cosmetic: `registerTool` has no session scope and `mpdConfig`
// cannot see a session's project layer at apply time, so a process-global
// registration CANNOT represent a per-session contribution. Discovering the
// project root once at apply from process.cwd() would leak the launcher's
// extensions into every session (and load the repo's real extensions into a QA
// sandbox) — so the project plane is resolved per call, from the calling
// session's workspace, and may contribute only the kinds that are re-read per
// call (skills + flows).
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MPD_EXT_CONTRACT, type MpdExtensionPlane } from "./sdk"
import {
  buildExtension,
  DEFAULT_EXTENSION_CONFIG,
  type DiscoveryResult,
  type ExtensionConfig,
  type RejectedExtension,
} from "./registry"
import { bundleRootOf, errorMessage as message } from "../../mpd-dsh-adapter-plugin/src/index"

/** The bundle package root: this file sits at <root>/packages/mpd-ext-plugin/{src,dist}/. */
export function bundleRoot(): string { return bundleRootOf(import.meta.url) }

/** Per-session project plane: <workspace>/.mpd/extensions. */
export function projectExtensionsDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".mpd", "extensions")
}

/**
 * Host-wide user plane: ~/.mpd/extensions.
 *
 * $HOME is preferred over os.homedir() on purpose: Bun caches homedir() at
 * process start, so an in-process sandbox (the QA pattern `HOME=<sandbox>` and
 * this package's own tests) would otherwise read the real home. Resolving per
 * call keeps the "HOME resolved per call" contract true and mirrors the
 * repository's existing `process.env.DSH_HOME || join(homedir(), ".dsh")` form.
 */
export function userExtensionsDir(): string {
  const home = typeof process.env.HOME === "string" && process.env.HOME.length > 0 ? process.env.HOME : homedir()
  return join(home, ".mpd", "extensions")
}

/** Host-wide bundle plane: <bundle>/extensions. */
export function bundleExtensionsDir(): string {
  return join(bundleRoot(), "extensions")
}

export interface DiscoverPlaneOptions {
  plane: MpdExtensionPlane
  dir: string
  /** Registry-metadata provider name the entries' flow candidates are validated against. */
  providerNameFor: (id: string, directory: string) => string
  warn: (message: string) => void
}


/**
 * Discover every `<dir>/<extension>/mpd-ext.json`. A broken manifest — invalid
 * JSON, a missing id, an unsupported apiVersion — becomes a REJECTED record
 * (surfaced by mpd_ext_list); it never throws and never stops the other
 * extensions in the same plane.
 */
export function discoverPlane(options: DiscoverPlaneOptions): DiscoveryResult {
  const result: DiscoveryResult = { plane: options.plane, dir: options.dir, entries: [], rejected: [], done: false }
  const reject = (record: RejectedExtension): void => {
    result.rejected.push(record)
    options.warn(`${record.id} (${record.source}) rejected: ${record.errors.map((error) => error.reason).join("; ")}`)
  }
  if (options.dir === "" || !existsSync(options.dir)) {
    result.done = true
    return result
  }
  let names: string[]
  try {
    names = readdirSync(options.dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    options.warn(`extension plane ${options.dir} unreadable: ${message(error)}`)
    result.done = true
    return result
  }
  for (const name of names) {
    const directory = join(options.dir, name)
    const manifestPath = join(directory, MPD_EXT_CONTRACT.manifestFile)
    if (!existsSync(manifestPath)) continue
    let raw: string
    try {
      raw = readFileSync(manifestPath, "utf8")
    } catch (error) {
      reject({
        id: name,
        plane: options.plane,
        origin: "directory",
        root: directory,
        source: manifestPath,
        errors: [{ item: MPD_EXT_CONTRACT.manifestFile, reason: `cannot read: ${message(error)}` }],
      })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      reject({
        id: name,
        plane: options.plane,
        origin: "directory",
        root: directory,
        source: manifestPath,
        errors: [{ item: MPD_EXT_CONTRACT.manifestFile, reason: `invalid JSON: ${message(error)}` }],
      })
      continue
    }
    const declaredId = (parsed as { id?: unknown } | null | undefined)?.id
    const id = typeof declaredId === "string" && declaredId.length > 0 ? declaredId : name
    const built = buildExtension({
      input: parsed,
      plane: options.plane,
      origin: "directory",
      root: directory,
      source: manifestPath,
      fallbackId: name,
      providerName: options.providerNameFor(id, directory),
    })
    if (built.entry !== undefined) result.entries.push(built.entry)
    else if (built.rejected !== undefined) reject(built.rejected)
  }
  result.done = true
  return result
}

/**
 * Ids declared by the per-call project plane. Used to honour precedence from the
 * apply-time providers too: an apply-time extension shadowed by a project
 * extension with the same id must stop emitting candidates (first wins).
 */
export function projectExtensionIds(workspaceRoot: string): Set<string> {
  const ids = new Set<string>()
  const dir = projectExtensionsDir(workspaceRoot)
  let names: string[]
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return ids
  }
  for (const name of names) {
    const manifestPath = join(dir, name, MPD_EXT_CONTRACT.manifestFile)
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as { id?: unknown } | null
      ids.add(typeof parsed?.id === "string" && parsed.id.length > 0 ? parsed.id : name)
    } catch {
      ids.add(name)
    }
  }
  return ids
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * Read `extensions.*` config lazily per use — never an apply-time snapshot.
 *
 * Declared limit (v1, not fixed): `mpdConfig` resolves `extensions.*` from its
 * PROCESS-LEVEL layer stack (`<process workspace>/.mpd/mpd.jsonc` +
 * `$DSH_HOME/mpd.jsonc`), so this config is NOT session-scoped and a
 * project-level `enable`/`disable` is not a per-session switch. We deliberately
 * do NOT call mpdConfig.reload(exec) to "fix" that: mutating the shared config
 * cache once per skill snapshot would make the provider's view and the tools'
 * view disagree, which is worse than a plainly documented limit. enable/disable
 * only ever filter what is SERVED; they never gate a registration.
 *
 * A missing or failing mpdConfig degrades to the documented defaults.
 */
export function extensionConfig(ctx: unknown): ExtensionConfig {
  let service: any
  try {
    service = typeof (ctx as { get?: unknown })?.get === "function" ? (ctx as any).get("mpdConfig") : undefined
  } catch {
    service = undefined
  }
  if (service === undefined || service === null || typeof service.get !== "function") return DEFAULT_EXTENSION_CONFIG
  const read = (key: string): unknown => {
    try { return service.get(key) } catch { return undefined }
  }
  const enable = read("extensions.enable")
  const disable = read("extensions.disable")
  const mcp = read("extensions.mcp")
  const mcpRecord = typeof mcp === "object" && mcp !== null && !Array.isArray(mcp) ? (mcp as Record<string, unknown>) : undefined
  return {
    enable: Array.isArray(enable) ? enable.filter((entry): entry is string => typeof entry === "string") : [],
    disable: Array.isArray(disable) ? disable.filter((entry): entry is string => typeof entry === "string") : [],
    mcp: {
      enabled: typeof mcpRecord?.enabled === "boolean" ? mcpRecord.enabled : true,
      connectTimeoutMs: positiveNumber(mcpRecord?.connectTimeoutMs) ?? MPD_EXT_CONTRACT.defaultConnectTimeoutMs,
      toolCallTimeoutMs: positiveNumber(mcpRecord?.toolCallTimeoutMs) ?? MPD_EXT_CONTRACT.defaultToolCallTimeoutMs,
    },
  }
}
