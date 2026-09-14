// mpd-ext-plugin: the MPD extension interface (loader row id `mpd-ext`,
// cordis service `mpdExtensions`).
//
// What this row adds on top of the install-plane path (a package with its own
// `dsh.bundle.patch`, which already works with zero core changes):
//   1. ONE frozen contract (./sdk.ts) so every contributor declares
//      skills / flows / mcp / roles the same way, with the same validation,
//      namespacing and failure policy;
//   2. a data plane: a plain directory (`mpd-ext.json` + assets), discoverable
//      per project or per user — no packaging, no `dsh plugin add`;
//   3. flows — a declarative procedure rendered into a skill candidate (the
//      harness has no flow seam, so this adds none either);
//   4. (a later task) a runtime stdio MCP bridge for servers that must not
//      become a profile patch row.
//
// Nothing here throws out of apply, and no failure aborts another extension:
// every load problem is recorded per item and surfaced by the four tools.
//   mpd_ext_list / mpd_ext_show / mpd_flow_list / mpd_flow_show
// There is deliberately NO mpd_ext_reload in v1 — the honest reload is a
// restart (a plugin-module change is not hot-reloaded anyway).
import { createDshAdapter, type DshAdapter, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { MPD_EXT_API_VERSION, type MpdExtLoadError, type MpdExtensionPlane } from "./sdk"
import {
  buildExtension,
  effectiveEnabled,
  MpdExtensionRegistry,
  type DiscoveryResult,
  type ExtensionConfig,
  type ExtensionEntry,
  type ShadowRecord,
} from "./registry"
import {
  bundleExtensionsDir,
  discoverPlane,
  extensionConfig,
  projectExtensionIds,
  projectExtensionsDir,
  userExtensionsDir,
} from "./manifest"
import { allocateProviderName, createSkillProvider, type SkillDocumentEntry } from "./skills"
import { connectExtensionMcpServers, type McpBridge } from "./mcp"

export const name = "mpd-ext"
// THE seams this row REGISTERS THROUGH. They must be declared: in this harness
// `ctx.get("tools")` / `ctx.get("skills")` resolve only for a service the row
// injects, so with `inject: []` the adapter's `requireService` threw, the
// containment below swallowed it into a logger sink a headless boot never prints,
// and the four tools plus the skills provider were silently NEVER registered
// while the success line still claimed them (measured 2026-09-14 by a mounted
// boot: every other plugin's tools present, `mpd_ext_*`/`mpd_flow_*` absent,
// `mpd_ext_list` -> `unknown tool`). Every other row in this repo declares its
// own seams the same way: mpd-workmate ["tools","subagents"], mpd-bootstrap
// ["skills"], mpd-tools ["tools"]. The `mpdDsh` service (the adapter) stays LAZY
// via ctx.get() — only the seams this row registers through are dependencies.
export const REQUIRED_SEAMS = ["tools", "skills"] as const
export const inject: string[] = [...REQUIRED_SEAMS]

export interface MpdExtPluginConfig {
  /** Do not print the one-line apply summary. */
  quiet?: boolean
}

const ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { item: { type: "string" }, reason: { type: "string" } },
  required: ["item", "reason"],
} as const

const SHADOW_PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { plane: { type: "string" }, root: { type: "string" } },
  required: ["plane", "root"],
} as const

const SHADOW_RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { id: { type: "string" }, kept: SHADOW_PAIR_SCHEMA, shadowed: SHADOW_PAIR_SCHEMA },
  required: ["id", "kept", "shadowed"],
} as const

const STRING_ARRAY_SCHEMA = { type: "array", items: { type: "string" } } as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function text(content: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: content }]
}

/** The harness hands the skills plane its lookup options ({ cwd, signal, scope }). */
function cwdOf(options: unknown): string | undefined {
  const cwd = (options as { cwd?: unknown } | undefined)?.cwd
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

/** A view entry as the tools and consumers see it (effective enabled state applied). */
interface ExtensionView {
  id: string
  origin: string
  plane: string
  root: string
  source: string
  enabled: boolean
  descriptor: unknown
  contributions: { skills: number; flows: number; mcp: number; roles: number }
  errors: MpdExtLoadError[]
  pending: MpdExtLoadError[]
  resolvedRoots: { root: string; skills: string[]; flows: string[]; roles: string[] }
  skills: string[]
  flows: string[]
  roles: string[]
  mcp: Array<{ serverName: string; state: string; tools: string[]; stderrTail?: string }>
  flowDocs: ExtensionEntry["flowDocs"]
  flowEntries: SkillDocumentEntry[]
}

interface ExtensionViewSnapshot {
  extensions: ExtensionView[]
  shadowed: ShadowRecord[]
  rejected: ReturnType<MpdExtensionRegistry["rejected"]>
  warnings: string[]
  config: ExtensionConfig
}

function toView(entry: ExtensionEntry, config: ExtensionConfig): ExtensionView {
  const pending = entry.pending.map((error) => ({ ...error }))
  // mcp.enabled is honoured here (lazily, per call): a config-disabled MCP plane
  // is reported as such instead of silently looking "pending".
  if (!config.mcp.enabled && entry.descriptor.contributes.mcp.length > 0) {
    pending.push({
      item: "contributes.mcp",
      reason: `mcp contributions are disabled by config (extensions.mcp.enabled=false) — every declared server of "${entry.id}" stays disconnected`,
    })
  }
  return {
    id: entry.id,
    origin: entry.origin,
    plane: entry.plane,
    root: entry.root,
    source: entry.source,
    enabled: effectiveEnabled(entry, config),
    descriptor: entry.descriptor,
    contributions: { ...entry.contributions },
    errors: entry.errors.map((error) => ({ ...error })),
    pending,
    resolvedRoots: {
      root: entry.resolvedRoots.root,
      skills: [...entry.resolvedRoots.skills],
      flows: [...entry.resolvedRoots.flows],
      roles: [...entry.resolvedRoots.roles],
    },
    skills: [...entry.skills],
    flows: [...entry.flows],
    roles: [...entry.roles],
    mcp: entry.mcp.map((record) => ({ ...record, tools: [...record.tools] })),
    flowDocs: entry.flowDocs,
    flowEntries: entry.flowEntries,
  }
}

/**
 * Plugin entry point. Nothing may throw out of `apply` (a throwing apply takes
 * the whole plugin tree down), so the body is contained twice: this outer
 * guard, and per-seam try/catch around every registration inside.
 *
 * `apply` is explicitly `async` for the MCP bridge (plan §1.4 mcp, REV3): a lazy
 * connect is impossible because the raw tool names only exist after `tools/list`,
 * so the declared stdio servers connect here, in parallel and time-boxed, and
 * the first tool generation of each reachable server is published BEFORE
 * activation completes. The `async` keyword itself matters: cordis treats a
 * non-async prototype-bearing function as a constructor, whose returned promise
 * is not startup work (H/dsh-mcp-client/lib/index.js:762-770).
 */
export async function apply(ctx: any, config: MpdExtPluginConfig = {}): Promise<void> {
  try {
    await mount(ctx, config)
  } catch (error) {
    const line = "[mpd-ext] apply failed: " + message(error)
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(line)
      else console.log(line)
    } catch { /* logging must never fail provisioning */ }
  }
}

async function mount(ctx: any, config: MpdExtPluginConfig = {}): Promise<void> {
  // A failure must be visible in a HEADLESS boot: `ctx.logger.warn` has no sink
  // there (measured — it swallowed the total registration failure this section
  // exists to prevent), so every line is ALSO written to stdout.
  const warn = (line: string): void => {
    const text = "[mpd-ext] " + line
    try {
      console.log(text)
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(text)
    } catch { /* logging must never fail provisioning */ }
  }

  let dsh: DshAdapter
  try {
    dsh = (typeof ctx?.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  } catch (error) {
    warn("adapter unavailable, extension interface not mounted: " + message(error))
    return
  }

  // Seam self-check: the row declares `inject: ["tools","skills"]`, so a missing
  // seam here means the composition is wrong — say so LOUDLY and name the cause
  // instead of letting the per-tool registration failures speak for themselves.
  const seams = (() => {
    try { return dsh.capabilities() } catch { return undefined }
  })()
  if (seams !== undefined && (seams.toolsRegister !== true || seams.skillsProvider !== true)) {
    warn("FATAL: the harness seams this row registers through are unavailable"
      + " (toolsRegister=" + String(seams.toolsRegister) + ", skillsProvider=" + String(seams.skillsProvider) + ")"
      + " — the four tools and the skills provider will NOT be registered in this session."
      + " This row must declare inject: " + JSON.stringify([...REQUIRED_SEAMS]) + ".")
  }

  const registry = new MpdExtensionRegistry()
  const takenProviderNames = new Set<string>()
  const projectProviderName = allocateProviderName(takenProviderNames, "mpd-ext:project-plane")

  /**
   * Register the skill provider of ONE apply-time extension. Registration is
   * wrapped because a duplicate provider name THROWS in the harness: a failure
   * must degrade exactly one extension, never the plugin tree.
   *
   * The provider resolves everything per call: `extensions.enable/disable` is
   * read lazy from mpdConfig (never an apply-time snapshot) and an id shadowed
   * by the calling session's project plane stops emitting candidates.
   */
  const registeredProviderNames: string[] = []
  const registerEntryProvider = (entry: ExtensionEntry): boolean => {
    if (entry.skillEntries.length === 0 && entry.flowEntries.length === 0) return true
    try {
      const provider = createSkillProvider({
        name: entry.providerName,
        warn,
        // A candidate the provider had to skip is recorded on the owning
        // extension (deduplicated) so mpd_ext_list/mpd_ext_show report it too.
        onSkip: (reason) => {
          if (entry.errors.some((error) => error.item === "contributes.skills" && error.reason === reason)) return
          entry.errors.push({ item: "contributes.skills", reason })
        },
        entries: (listOptions) => {
          if (!effectiveEnabled(entry, extensionConfig(ctx))) return []
          const root = cwdOf(listOptions) ?? dsh.workspaceRoot()
          if (projectExtensionIds(root).has(entry.id)) return []
          return [...entry.skillEntries, ...entry.flowEntries]
        },
      })
      dsh.registerSkillProvider(() => provider)
      registeredProviderNames.push(entry.providerName)
      return true
    } catch (error) {
      entry.errors.push({ item: "contributes.skills", reason: "skill provider registration failed: " + message(error) })
      warn(`skill provider for "${entry.id}" not registered: ` + message(error))
      return false
    }
  }

  // ── apply-time planes (user + bundle): host-wide, may contribute all kinds ──
  const planes: Array<[MpdExtensionPlane, string]> = [
    ["user", userExtensionsDir()],
    ["bundle", bundleExtensionsDir()],
  ]
  /** The entries the registry KEPT — the only ones whose MCP servers may start. */
  const keptEntries: ExtensionEntry[] = []
  for (const [plane, dir] of planes) {
    try {
      const discovery = discoverPlane({ plane, dir, providerNameFor: (id) => allocateProviderName(takenProviderNames, "mpd-ext:" + id), warn })
      for (const entry of discovery.entries) {
        const added = registry.add(entry)
        if (added.ok) {
          registerEntryProvider(entry)
          keptEntries.push(entry)
        }
      }
      for (const rejected of discovery.rejected) registry.addRejected(rejected)
    } catch (error) {
      warn(`plane "${plane}" discovery failed: ` + message(error))
    }
  }

  // ── the per-call project plane ─────────────────────────────────────────────
  // One provider serves every project extension: registration is process-global
  // and cannot be scoped to a session, so the project plane is re-discovered
  // inside list()/get() from the caller's own cwd.
  try {
    const projectProvider = createSkillProvider({
      name: projectProviderName,
      warn,
      entries: (listOptions) => {
        const root = cwdOf(listOptions) ?? dsh.workspaceRoot()
        const discovery = discoverPlane({
          plane: "project",
          dir: projectExtensionsDir(root),
          providerNameFor: () => projectProviderName,
          warn,
        })
        const current = extensionConfig(ctx)
        const documents: SkillDocumentEntry[] = []
        for (const entry of discovery.entries) {
          if (!effectiveEnabled(entry, current)) continue
          documents.push(...entry.skillEntries, ...entry.flowEntries)
        }
        return documents
      },
    })
    dsh.registerSkillProvider(() => projectProvider)
    registeredProviderNames.push(projectProviderName)
  } catch (error) {
    warn("project-plane skill provider not registered: " + message(error))
  }

  /** Per-call view: the project plane is re-discovered from THIS call's workspace. */
  const snapshot = (exec?: unknown): ExtensionViewSnapshot => {
    const root = dsh.workspaceRoot(exec as DshToolExec | undefined)
    const dir = projectExtensionsDir(root)
    let discovery: DiscoveryResult = { plane: "project", dir, entries: [], rejected: [], done: true }
    try {
      discovery = discoverPlane({
        plane: "project",
        dir,
        providerNameFor: () => projectProviderName,
        warn,
      })
    } catch (error) {
      warn("project-plane discovery failed: " + message(error))
    }
    const current = extensionConfig(ctx)
    const merged = registry.view(discovery)
    const extensions = merged.entries.map((entry) => toView(entry, current))
    const warnings: string[] = []
    for (const record of merged.shadowed) {
      warnings.push(`extension "${record.id}" in the ${record.shadowed.plane} plane is shadowed by the ${record.kept.plane} plane (first wins)`)
    }
    for (const rejected of merged.rejected) {
      warnings.push(`extension "${rejected.id}" in the ${rejected.plane} plane was rejected: ${rejected.errors.map((error) => error.reason).join("; ")}`)
    }
    for (const view of extensions) {
      for (const pending of view.pending) warnings.push(`${view.id}: ${pending.reason}`)
    }
    return { extensions, shadowed: merged.shadowed, rejected: merged.rejected, warnings, config: current }
  }

  /**
   * The MCP bridge, assigned once activation is reached below. It is declared
   * here so a code-plane `register()` that happens AFTER this row applied can
   * still connect its declared servers (`adopt`, fire-and-forget by design).
   */
  let bridge: McpBridge | undefined

  /**
   * Code-plane registration: any plugin row may call
   * `ctx.get("mpdExtensions")?.register(descriptor, { root })` at its apply time.
   */
  const register = (descriptor: unknown, options: { root?: string; plane?: MpdExtensionPlane } = {}): { ok: boolean; id: string; errors: MpdExtLoadError[]; shadowed?: ShadowRecord } => {
    const root = typeof options?.root === "string" && options.root.length > 0 ? options.root : ""
    const plane: MpdExtensionPlane = options?.plane === "project" || options?.plane === "user" || options?.plane === "bundle" ? options.plane : "bundle"
    const declared = (descriptor as { id?: unknown } | undefined)?.id
    const id = typeof declared === "string" && declared.length > 0 ? declared : "unnamed"
    try {
      const built = buildExtension({
        input: descriptor,
        plane,
        origin: "plugin",
        root,
        source: "register()",
        fallbackId: id,
        providerName: allocateProviderName(takenProviderNames, "mpd-ext:" + id),
      })
      if (built.rejected !== undefined) {
        registry.addRejected(built.rejected)
        return { ok: false, id: built.rejected.id, errors: built.rejected.errors }
      }
      const entry = built.entry as ExtensionEntry
      const added = registry.add(entry)
      if (added.ok) {
        registerEntryProvider(entry)
        void bridge?.adopt(entry)
      }
      return { ok: added.ok, id: entry.id, errors: entry.errors, ...(added.shadowed === undefined ? {} : { shadowed: added.shadowed }) }
    } catch (error) {
      const errors = [{ item: "descriptor", reason: "registration failed: " + message(error) }]
      registry.addRejected({ id, plane, origin: "plugin", root, source: "register()", errors })
      return { ok: false, id, errors }
    }
  }

  const service = {
    apiVersion: MPD_EXT_API_VERSION,
    register,
    list: (options: { exec?: unknown } = {}) => snapshot(options?.exec),
    describe: (id: string, options: { exec?: unknown } = {}) => snapshot(options?.exec).extensions.find((entry) => entry.id === String(id ?? "")),
    flows: (options: { exec?: unknown } = {}) => snapshot(options?.exec).extensions.flatMap((entry) => entry.flowDocs.map((flow) => ({ extension: entry.id, enabled: entry.enabled, flow }))),
    flow: (id: string, options: { exec?: unknown } = {}) => {
      const wanted = String(id ?? "")
      for (const entry of snapshot(options?.exec).extensions) {
        const flow = entry.flowDocs.find((candidate) => candidate.id === wanted)
        if (flow !== undefined) return { extension: entry.id, enabled: entry.enabled, flow }
      }
      return undefined
    },
  }
  try {
    ctx.provide("mpdExtensions", service)
  } catch (error) {
    warn("ctx.provide(mpdExtensions) failed: " + message(error))
  }

  /** Registering a tool can throw (absent seam, duplicate name): contain it, but
   * count the outcome so the summary below can never claim a tool that is not
   * really registered. */
  const registeredToolNames: string[] = []
  const safeRegisterTool = (definition: any, onError: (line: string) => void): boolean => {
    try {
      dsh.registerTool(definition)
      registeredToolNames.push(definition.name)
      return true
    } catch (error) {
      onError(`tool "${definition?.name}" not registered: ` + message(error))
      return false
    }
  }
  /** The four tool names this row must register; the summary is checked against it. */
  const EXPECTED_TOOLS = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"]

  // ── tools ──────────────────────────────────────────────────────────────────

  const shadowsFor = (view: ExtensionViewSnapshot, entry: ExtensionView): ShadowRecord[] =>
    view.shadowed.filter((record) => record.kept.plane === entry.plane && record.kept.root === entry.root)

  const listValue = (view: ExtensionViewSnapshot): Record<string, unknown> => ({
    extensions: view.extensions.map((entry) => ({
      id: entry.id,
      origin: entry.origin,
      plane: entry.plane,
      root: entry.root,
      enabled: entry.enabled,
      contributions: { ...entry.contributions },
      // The contributed names are part of the report so a reader can see what is
      // USABLE, not only how many items were declared (a project-plane role is
      // counted 0 and listed here as excluded).
      skills: [...entry.skills],
      flows: [...entry.flows],
      roles: [...entry.roles],
      errors: entry.errors.map((error) => ({ item: error.item, reason: error.reason })),
      pending: entry.pending.map((error) => ({ item: error.item, reason: error.reason })),
      shadows: shadowsFor(view, entry).map((record) => ({ plane: record.shadowed.plane, root: record.shadowed.root })),
    })),
    shadowed: view.shadowed.map((record) => ({
      id: record.id,
      kept: { plane: record.kept.plane, root: record.kept.root },
      shadowed: { plane: record.shadowed.plane, root: record.shadowed.root },
    })),
    rejected: view.rejected.map((record) => ({
      id: record.id,
      plane: record.plane,
      root: record.root,
      source: record.source,
      errors: record.errors.map((error) => ({ item: error.item, reason: error.reason })),
    })),
    warnings: [...view.warnings],
  })

  safeRegisterTool({
    name: "mpd_ext_list",
    description:
      "List every MPD extension known to this host: its id, origin (plugin code or discovered directory), plane (project user bundle), root, effective enabled state, contribution counts, per-item load errors and pending kinds. Also reports shadowed duplicate ids (first wins, never fatal) and extensions rejected outright. There is no reload tool in v1: restart dsh to re-read plugin code.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          extensions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                origin: { type: "string" },
                plane: { type: "string" },
                root: { type: "string" },
                enabled: { type: "boolean" },
                contributions: {
                  type: "object",
                  additionalProperties: false,
                  properties: { skills: { type: "number" }, flows: { type: "number" }, mcp: { type: "number" }, roles: { type: "number" } },
                  required: ["skills", "flows", "mcp", "roles"],
                },
                skills: STRING_ARRAY_SCHEMA,
                flows: STRING_ARRAY_SCHEMA,
                roles: STRING_ARRAY_SCHEMA,
                errors: { type: "array", items: ERROR_SCHEMA },
                pending: { type: "array", items: ERROR_SCHEMA },
                shadows: { type: "array", items: SHADOW_PAIR_SCHEMA },
              },
              required: ["id", "origin", "plane", "root", "enabled", "contributions", "skills", "flows", "roles", "errors", "pending", "shadows"],
            },
          },
          shadowed: { type: "array", items: SHADOW_RECORD_SCHEMA },
          rejected: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                plane: { type: "string" },
                root: { type: "string" },
                source: { type: "string" },
                errors: { type: "array", items: ERROR_SCHEMA },
              },
              required: ["id", "plane", "root", "source", "errors"],
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
        required: ["extensions", "shadowed", "rejected", "warnings"],
      },
      render: (_args: unknown, value: any) => {
        const lines = [
          `mpd extensions: ${value.extensions.length} (${value.shadowed.length} shadowed, ${value.rejected.length} rejected)`,
        ]
        for (const entry of value.extensions) {
          lines.push(
            `- ${entry.id} [${entry.plane}/${entry.origin}] ${entry.enabled ? "enabled" : "disabled"}`
            + ` skills=${entry.contributions.skills} flows=${entry.contributions.flows} mcp=${entry.contributions.mcp} roles=${entry.contributions.roles}`
            + (entry.roles.length > 0 ? ` (roles: ${entry.roles.join(", ")})` : ""),
          )
          for (const error of entry.errors) lines.push(`    error ${error.item}: ${error.reason}`)
          for (const pending of entry.pending) lines.push(`    pending ${pending.item}: ${pending.reason}`)
          if (entry.shadows.length > 0) lines.push(`    shadows ${entry.shadows.map((shadow: any) => shadow.plane).join(", ")}`)
        }
        for (const rejected of value.rejected) lines.push(`! rejected ${rejected.id} (${rejected.plane}): ${rejected.errors.map((error: any) => error.reason).join("; ")}`)
        return text(lines.join("\n"))
      },
    },
    execute: async (_args: unknown, exec: unknown) => listValue(snapshot(exec)),
  }, warn)

  safeRegisterTool({
    name: "mpd_ext_show",
    description:
      "Show one MPD extension in full: descriptor, resolved asset roots, contributed skill/flow/role names, MCP server state and per-item errors. An unknown id reports the known ids.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "extension id (see mpd_ext_list)" } },
      required: ["id"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          origin: { type: "string" },
          plane: { type: "string" },
          root: { type: "string" },
          source: { type: "string" },
          enabled: { type: "boolean" },
          descriptor: { type: "object" },
          resolvedRoots: {
            type: "object",
            additionalProperties: false,
            properties: {
              root: { type: "string" },
              skills: STRING_ARRAY_SCHEMA,
              flows: STRING_ARRAY_SCHEMA,
              roles: STRING_ARRAY_SCHEMA,
            },
            required: ["root", "skills", "flows", "roles"],
          },
          skills: STRING_ARRAY_SCHEMA,
          flows: STRING_ARRAY_SCHEMA,
          roles: STRING_ARRAY_SCHEMA,
          mcp: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                serverName: { type: "string" },
                state: { type: "string" },
                tools: STRING_ARRAY_SCHEMA,
                stderrTail: { type: "string" },
              },
              required: ["serverName", "state", "tools"],
            },
          },
          errors: { type: "array", items: ERROR_SCHEMA },
          pending: { type: "array", items: ERROR_SCHEMA },
          shadows: { type: "array", items: SHADOW_PAIR_SCHEMA },
        },
        required: ["id", "origin", "plane", "root", "source", "enabled", "descriptor", "resolvedRoots", "skills", "flows", "roles", "mcp", "errors", "pending", "shadows"],
      },
      render: (_args: unknown, value: any) => {
        const lines = [
          `extension ${value.id} [${value.plane}/${value.origin}] ${value.enabled ? "enabled" : "disabled"}`,
          `root: ${value.root || "(none)"}`,
          `source: ${value.source}`,
          `skills: ${value.skills.length > 0 ? value.skills.join(", ") : "(none)"}`,
          `flows: ${value.flows.length > 0 ? value.flows.join(", ") : "(none)"}`,
          `roles: ${value.roles.length > 0 ? value.roles.join(", ") : "(none)"}`,
          `mcp: ${value.mcp.length > 0 ? value.mcp.map((server: any) => `${server.serverName}=${server.state}`).join(", ") : "(none)"}`,
        ]
        for (const error of value.errors) lines.push(`error ${error.item}: ${error.reason}`)
        for (const pending of value.pending) lines.push(`pending ${pending.item}: ${pending.reason}`)
        return text(lines.join("\n"))
      },
    },
    execute: async (args: { id?: unknown }, exec: unknown) => {
      const view = snapshot(exec)
      const id = String(args?.id ?? "")
      const entry = view.extensions.find((candidate) => candidate.id === id)
      if (entry === undefined) {
        const known = view.extensions.map((candidate) => candidate.id).sort().join(", ") || "(none)"
        throw new Error(`mpd_ext_show: unknown extension "${id}"; known ids: ${known}`)
      }
      return {
        id: entry.id,
        origin: entry.origin,
        plane: entry.plane,
        root: entry.root,
        source: entry.source,
        enabled: entry.enabled,
        descriptor: entry.descriptor,
        resolvedRoots: {
          root: entry.resolvedRoots.root,
          skills: [...entry.resolvedRoots.skills],
          flows: [...entry.resolvedRoots.flows],
          roles: [...entry.resolvedRoots.roles],
        },
        skills: [...entry.skills],
        flows: [...entry.flows],
        roles: [...entry.roles],
        mcp: entry.mcp.map((server) => ({
          serverName: server.serverName,
          state: server.state,
          tools: [...server.tools],
          ...(server.stderrTail === undefined || server.stderrTail.length === 0 ? {} : { stderrTail: server.stderrTail }),
        })),
        errors: entry.errors.map((error) => ({ item: error.item, reason: error.reason })),
        pending: entry.pending.map((error) => ({ item: error.item, reason: error.reason })),
        shadows: shadowsFor(view, entry).map((record) => ({ plane: record.shadowed.plane, root: record.shadowed.root })),
      }
    },
  }, warn)

  safeRegisterTool({
    name: "mpd_flow_list",
    description:
      "List every flow contributed by an enabled MPD extension (its id, title, whenToUse, step count and owning extension). A flow is a declarative procedure served as a skill candidate; v1 has no execution state machine.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          flows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                whenToUse: { type: "string" },
                stepCount: { type: "number" },
                extension: { type: "string" },
                loadable: { type: "boolean" },
              },
              required: ["id", "title", "whenToUse", "stepCount", "extension", "loadable"],
            },
          },
        },
        required: ["flows"],
      },
      render: (_args: unknown, value: any) =>
        text(value.flows.length === 0
          ? "no extension flows"
          : value.flows.map((flow: any) => `- ${flow.id} (${flow.extension}) ${flow.stepCount} steps${flow.loadable ? "" : " [not loadable]"}: ${flow.title}`).join("\n")),
    },
    execute: async (_args: unknown, exec: unknown) => {
      const view = snapshot(exec)
      const flows: Array<Record<string, unknown>> = []
      for (const entry of view.extensions) {
        if (!entry.enabled) continue
        for (const flow of entry.flowDocs) {
          flows.push({
            id: flow.id,
            title: flow.title,
            whenToUse: flow.whenToUse ?? "",
            stepCount: flow.steps.length,
            extension: entry.id,
            loadable: entry.flowEntries.some((candidate) => candidate.document.name === flow.id),
          })
        }
      }
      return { flows }
    },
  }, warn)

  safeRegisterTool({
    name: "mpd_flow_show",
    description:
      "Show one contributed flow in full: its description, whenToUse hint and every step with its optional tool hint and expected output. An unknown id reports the known ids.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "flow id (see mpd_flow_list)" } },
      required: ["id"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          whenToUse: { type: "string" },
          extension: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                tool: { type: "string" },
                output: { type: "string" },
              },
              required: ["title", "detail", "tool", "output"],
            },
          },
        },
        required: ["id", "title", "description", "whenToUse", "extension", "steps"],
      },
      render: (_args: unknown, value: any) =>
        text([
          `${value.title} (${value.id}, extension ${value.extension})`,
          value.description,
          ...(value.whenToUse ? [`when to use: ${value.whenToUse}`] : []),
          ...value.steps.map((step: any, index: number) =>
            `${index + 1}. ${step.title}${step.tool ? ` [tool: ${step.tool}]` : ""}${step.detail ? `\n   ${step.detail}` : ""}${step.output ? `\n   expected output: ${step.output}` : ""}`),
        ].join("\n")),
    },
    execute: async (args: { id?: unknown }, exec: unknown) => {
      const view = snapshot(exec)
      const wanted = String(args?.id ?? "")
      for (const entry of view.extensions) {
        const flow = entry.flowDocs.find((candidate) => candidate.id === wanted)
        if (flow === undefined) continue
        return {
          id: flow.id,
          title: flow.title,
          description: flow.description,
          whenToUse: flow.whenToUse ?? "",
          extension: entry.id,
          steps: flow.steps.map((step) => ({
            title: step.title,
            detail: step.detail ?? "",
            tool: step.tool ?? "",
            output: step.output ?? "",
          })),
        }
      }
      const known = view.extensions.flatMap((entry) => entry.flowDocs.map((flow) => flow.id)).sort().join(", ") || "(none)"
      throw new Error(`mpd_flow_show: unknown flow "${wanted}"; known ids: ${known}`)
    },
  }, warn)

  // ── the runtime stdio MCP bridge (connect-at-apply, never lazy) ─────────────
  // Every kept extension's declared servers connect here, in parallel and
  // time-boxed by connectTimeoutMs, so the first tool generation is published
  // BEFORE this apply resolves. Activation never rejects: a server that is
  // unreachable, hanging or immediately exiting is recorded on its extension
  // (state unavailable/failed + stderr tail) while every other server and
  // extension still activates.
  try {
    bridge = await connectExtensionMcpServers({
      dsh,
      entries: keptEntries,
      config: () => extensionConfig(ctx),
      warn,
    })
    const connected: McpBridge = bridge
    if (typeof ctx?.effect === "function") {
      ctx.effect(() => () => { void connected.dispose() }, "mpd-ext.mcp-bridge")
    }
  } catch (error) {
    warn("MCP bridge activation failed: " + message(error))
  }

  // The summary is DERIVED from what really registered: a boot that could not
  // register the tools must never read as a success (that is how the seam defect
  // stayed invisible: the old line named all four unconditionally).
  const missingTools = EXPECTED_TOOLS.filter((name) => !registeredToolNames.includes(name))
  if (missingTools.length > 0) {
    warn("FATAL: only " + registeredToolNames.length + "/" + EXPECTED_TOOLS.length + " tools registered (missing: "
      + missingTools.join(", ") + ") — the extension interface is NOT usable in this session;"
      + " the row declares inject: " + JSON.stringify([...REQUIRED_SEAMS]) + ", so check the harness seams above")
  } else if (config.quiet !== true) {
    console.log(
      "[mpd-ext] mpdExtensions provided (apiVersion " + MPD_EXT_API_VERSION + ")"
      + " | tools: " + registeredToolNames.join(", ")
      + " | skill providers: " + (registeredProviderNames.length === 0 ? "(none: no extension contributes skills or flows)" : registeredProviderNames.join(", "))
      + " | project plane: <session workspace>/.mpd/extensions (per call)",
    )
  }
}
