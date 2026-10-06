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
import { rowLogLine, DSH_SEAM_SKILLS, DSH_SEAM_TOOLS, createLazyDshAdapter, dshAdapterIdentity, errorMessage as message, type AdapterIdentity, type DshAdapter, type DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
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

/** The loader row id this plugin registers under (`mpd-ext` in the bundle patch). */
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
// The two names come from the adapter's constants, and the build keeps this line's
// `[...REQUIRED_SEAMS]` spelling below: `skills/dsh-qa/scripts/extension-lifecycle.ts`
// mutates that exact text in the built bundle for its pre-fix negative control (T-55:
// the anchor is the built LINE, so the spelling here is load-bearing, not stylistic).
export const REQUIRED_SEAMS = [DSH_SEAM_TOOLS, DSH_SEAM_SKILLS] as const
// The cordis dependency list: the declared seams above, spread so the two
// declarations can never drift apart.
export const inject: string[] = [...REQUIRED_SEAMS]

/**
 * CANONICAL NOTE — how a row reaches the ONE shared adapter, and what a miss means.
 * This is the ONE place that describes it; the sites THIS FIX touched CROSS-REFERENCE it
 * instead of half-repeating it — mpd-roles (`packages/mpd-roles-plugin/src/index.ts`, its
 * identity comment) and the bundle patch's row-order bullet
 * (`cordis.patch.yml`).
 * RESIDUAL, recorded honestly: the OTHER rows that still inline
 * `ctx.get("mpdDsh") ?? createDshAdapter(ctx)` (the rest of the mpd plugin rows) resolve
 * EAGERLY at apply and stay silent about it; they are OUTSIDE this fix's scope — only mpd-ext
 * and mpd-roles use the shared lazy resolver today, and each of those rows would need its own
 * scoped change with its own mount proof (AGENTS.md §12).
 *
 * T-50 — WHY EAGER RESOLUTION WAS WRONG. `ctx.get("mpdDsh")` read ONCE at apply turns a
 * TRANSIENT miss into a session-long wrong answer: the loader applies sibling rows
 * CONCURRENTLY and cordis answers `undefined` — never a throw — for a provider whose fiber is
 * not ACTIVE, so even a correctly ordered tree can miss. The row then builds a SECOND adapter
 * beside the tree's and keeps it for the whole session, which BYPASSES the mounted adapter (the
 * one-contact-surface rule, AGENTS.md §6): it does NOT inherit the adapter ROW's config
 * (`defaultTimeoutMs`, declared by `createDshAdapter(…, { defaultTimeoutMs })`, so tool calls
 * silently run on the built-in default) and it carries its OWN per-instance caches (the
 * per-agent compaction-engine memo, `engineCache`). It does NOT double the tree's
 * guard/waterfall registrations: those are registered THROUGH the harness seams, so they still
 * happen exactly once each.
 *
 * THE FIX — `createLazyDshAdapter(ctx, …)` resolves on EVERY use and caches ONLY a successful
 * STRICT read, and it distinguishes the two miss modes with a non-strict read:
 *   · registered but not yet ACTIVE → warned ONCE per row as "provider not yet active", served
 *     by a temporary adapter, and picked up automatically the moment the fiber activates: NO
 *     row-order change is needed for that transient miss;
 *   · not provided in this composition → the ROW ORDER really is the fix (this row must sit
 *     BELOW `mpd-dsh-adapter`), and only then does that hint appear.
 * The assertable identity is read at SURFACE time with `dshAdapterIdentity(ctx)`, never cached
 * at apply: `mounted:mpdDsh` / `pending:provider-not-active` / `fallback:createDshAdapter` land
 * on the apply-time boot line and on the `adapterIdentity` field of the `mpdExtensions` service.
 * The healthy mounted path emits NO warning.
 * HONEST BOUND (T-50): six consecutive clean boots on the correctly ordered tree never opened
 * this window (t24, 6/6 `adapterIdentity=mounted:mpdDsh`, zero fallback lines), so the change is
 * justified by the CODE PATH — the loader's concurrent sibling apply plus cordis's non-ACTIVE
 * `undefined` — and pinned by unit tests that drive the window against the vendored cordis
 * (`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts`), never by an observed failure.
 * (Pointers here are by SYMBOL, never by line: the line numbers this note used to cite had
 * drifted by 15-17 lines — T-55.)
 */
export {
  ADAPTER_IDENTITY_FALLBACK,
  ADAPTER_IDENTITY_MOUNTED,
  ADAPTER_IDENTITY_PENDING,
} from "../../mpd-dsh-adapter-plugin/src/index"

/** Row config of `mpd-ext`: `quiet` is the only knob, and it silences the success line only. */
export interface MpdExtPluginConfig {
  /** Do not print the one-line apply summary. */
  quiet?: boolean
}

/** Schema of one `{ item, reason }` load problem, reused by both tools' error lists. */
const ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { item: { type: "string" }, reason: { type: "string" } },
  required: ["item", "reason"],
} as const

/** Schema of one `{ plane, root }` locator inside a shadow record. */
const SHADOW_PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { plane: { type: "string" }, root: { type: "string" } },
  required: ["plane", "root"],
} as const

/** Schema of one shadow record: the id plus the WINNER and LOSER locators. */
const SHADOW_RECORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { id: { type: "string" }, kept: SHADOW_PAIR_SCHEMA, shadowed: SHADOW_PAIR_SCHEMA },
  required: ["id", "kept", "shadowed"],
} as const

/** Schema of a plain string list (skill, flow, role or MCP-tool names). */
const STRING_ARRAY_SCHEMA = { type: "array", items: { type: "string" } } as const


/** Wrap one string as the harness text-block list a tool `render` must return. */
function text(content: string): { type: "text"; text: string }[] {
  return [{ type: "text", text: content }]
}

/** The harness hands the skills plane its lookup options ({ cwd, signal, scope }). */
function cwdOf(options: unknown): string | undefined {
  // The caller's workspace when the harness supplied one; a non-string or empty
  // cwd counts as ABSENT, and absent means "no project plane for this caller".
  const cwd = (options as { cwd?: unknown } | undefined)?.cwd
  return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined
}

/** A view entry as the tools and consumers see it (effective enabled state applied). */
interface ExtensionView {
  /** The validated descriptor `id` (a kept entry always carries one; the grammar demands it). */
  id: string
  /** Where the entry came from: a discovered directory or a plugin row's `register()`. */
  origin: string
  /** The discovery root it was found in: `project`, `user` or `bundle`. */
  plane: string
  /** Absolute extension root every asset reference was resolved against. */
  root: string
  /** The manifest path (data plane) or `register()` (code plane) — the second half of the serving identity. */
  source: string
  /** Effective enabled state: the descriptor default with `extensions.enable`/`disable` applied. */
  enabled: boolean
  /** The normalized descriptor (defaults applied, unknown keys already refused); a tool echo redacts it. */
  descriptor: unknown
  /** The provider name this extension's skill candidates carry (the serving identity). */
  providerName: string
  /** Per-kind counts as built: skills/flows loaded, roles USABLE locally, and mcp 0 in the project plane. */
  contributions: { skills: number; flows: number; mcp: number; roles: number }
  /** Per-item load problems; a non-empty list leaves the rest of the extension usable. */
  errors: MpdExtLoadError[]
  /** Declared contributions that are not live yet, each with the one reason it is not. */
  pending: MpdExtLoadError[]
  /** Assets this entry RESOLVED, not a liveness report: the root, the declared skills/flows directories, and each locally usable role's persona file. */
  resolvedRoots: { root: string; skills: string[]; flows: string[]; roles: string[] }
  /** Every skill name the loaded skill entries carry, a CLAIM only — whether the catalog serves it is reported per name. */
  skills: string[]
  /** Every flow id this extension claims; a flow is served as a skill candidate, so both share one namespace. */
  flows: string[]
  /** Role names the ROSTER currently exposes for this extension — a refused role never appears here. */
  roles: string[]
  /** Declared MCP servers with their live state and bounded stderr tail. */
  mcp: Array<{ serverName: string; state: string; tools: string[]; stderrTail?: string }>
  /** Parsed flow documents, as the two flow tools report them. */
  flowDocs: ExtensionEntry["flowDocs"]
  /** The same flows in the skill-candidate shape the provider serves. */
  flowEntries: SkillDocumentEntry[]
}

/** One `snapshot()` result: the merged view plus everything the tools report beside it. */
interface ExtensionViewSnapshot {
  /** Merged entries in serving order (the per-call project plane first), effective state applied. */
  extensions: ExtensionView[]
  /** Every duplicate id: the winning and the losing locator of each collision. */
  shadowed: ShadowRecord[]
  /** Wholesale refusals (bad apiVersion/id, unparseable manifest) with their per-item errors. */
  rejected: ReturnType<MpdExtensionRegistry["rejected"]>
  /** One readable line per shadowing, rejection or pending kind — the flat `warnings` field. */
  warnings: string[]
  /** The config read for THIS call, kept so the report can explain effective state and its lazy read. */
  config: ExtensionConfig
}

/** Project one registry entry into the tool-facing view, with effective state and private copies of every list. */
function toView(entry: ExtensionEntry, config: ExtensionConfig): ExtensionView {
  // Copied so the config-disabled note pushed below cannot mutate the registry entry.
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
    providerName: entry.providerName,
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
 * is not startup work (H/dsh-mcp-client/lib/index.ts:762-770).
 */
export async function apply(ctx: any, config: MpdExtPluginConfig = {}): Promise<void> {
  try {
    await mount(ctx, config)
  } catch (error) {
    // The failure line, routed through the logger when one exists and through
    // console.log otherwise (a headless boot's logger.warn has no sink).
    const line = "[mpd-ext] apply failed: " + message(error)
    try {
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(line)
      else rowLogLine("mpd-ext", line)
    } catch { /* logging must never fail provisioning */ }
  }
}

/** The real apply body, split out so `apply`'s single catch contains every failure it can raise. */
async function mount(ctx: any, config: MpdExtPluginConfig = {}): Promise<void> {
  // A failure must be visible in a HEADLESS boot: `ctx.logger.warn` has no sink
  // there (measured — it swallowed the total registration failure this section
  // exists to prevent), so every line is ALSO written to stdout.
  const warn = (line: string): void => {
    // Prefixed once, so every diagnostic is attributable to this row in a shared boot log.
    const text = "[mpd-ext] " + line
    try {
      rowLogLine("mpd-ext", text)
      if (ctx?.logger && typeof ctx.logger.warn === "function") ctx.logger.warn(text)
    } catch { /* logging must never fail provisioning */ }
  }

  // The one adapter handle this function routes every seam call through; resolved
  // lazily per use (T-50), never captured once at apply.
  let dsh: DshAdapter
  try {
    // LAZY (T-50): NOTHING is resolved here. The facade probes `mpdDsh` on every use and caches
    // only a successful STRICT read, so a sibling row's provider that is still starting can no
    // longer hand this row a private adapter for the session (see the CANONICAL NOTE above). The
    // one-line warning, when it fires, comes from the shared resolver with the honest wording.
    dsh = createLazyDshAdapter(ctx, { label: "mpd-ext", warn })
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

  // The apply-time registry (user + bundle planes); the per-call project plane is
  // merged in front of it by `snapshot()` below, never added here.
  const registry = new MpdExtensionRegistry()
  // Provider names already handed out, so a later plane's extension can never take
  // a name an earlier one already registered (a duplicate name THROWS in the harness).
  const takenProviderNames = new Set<string>()
  // The ONE provider name the per-call project plane serves under, allocated before
  // any extension so no extension name can collide with it.
  const projectProviderName = allocateProviderName(takenProviderNames, "mpd-ext:project-plane")

  // Names of the providers whose registration really succeeded, in registration
  // order — the apply summary reports these, never the names it intended to use.
  const registeredProviderNames: string[] = []
  /**
   * Register the skill provider of ONE apply-time extension. Registration is
   * wrapped because a duplicate provider name THROWS in the harness: a failure
   * must degrade exactly one extension, never the plugin tree.
   *
   * The provider resolves everything per call: `extensions.enable/disable` is
   * read lazy from mpdConfig (never an apply-time snapshot) and an id shadowed
   * by the calling session's project plane stops emitting candidates.
   */
  const registerEntryProvider = (entry: ExtensionEntry): boolean => {
    if (entry.skillEntries.length === 0 && entry.flowEntries.length === 0) return true
    try {
      // Name, skip recording and per-call entry resolution: the harness calls
      // list()/get() with the CALLER's own lookup options, so nothing is cached here.
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
          // The project-shadow guard needs the CALLER's workspace. With no cwd it
          // cannot be evaluated — and a guess (`dsh.workspaceRoot()` -> process.cwd())
          // can only HIDE a host-wide extension that really is served, so the guard
          // is skipped instead: hiding live content is the worse failure (F5).
          const root = cwdOf(listOptions)
          if (root !== undefined && projectExtensionIds(root).has(entry.id)) return []
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
      // One plane's discovery result; a plane that throws is warned about and
      // skipped, so it can never take the other plane down with it.
      const discovery = discoverPlane({ plane, dir, providerNameFor: (id) => allocateProviderName(takenProviderNames, "mpd-ext:" + id), warn })
      for (const entry of discovery.entries) {
        // `ok:false` means an earlier plane already kept this id (first wins): a
        // shadowed entry gets no provider and no MCP server, only a report entry.
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

  // Workspace dir of the project-plane call currently in flight, so the provider's
  // onSkip callback can key its note without a per-call closure of its own.
  let projectClaimDir: string | undefined

  // ── the per-call project plane ─────────────────────────────────────────────
  // One provider serves every project extension: registration is process-global
  // and cannot be scoped to a session, so the project plane is re-discovered
  // inside list()/get() from the caller's own cwd.
  //
  // ATTRIBUTION (F4): the project provider needs the same `onSkip` record the
  // apply-time providers have, or a skipped project candidate is a warning nobody
  // can see and `mpd_ext_list` keeps claiming a skill that is not served.
  //
  // The provider discovers its OWN entry objects per call, so a note pushed there
  // would die with that call; skips are therefore keyed by `(workspace dir,
  // candidate name)` and attached to the matching entry by `snapshot()` below.
  // `*` is the whole-plane key (an enumeration failure has no candidate name).
  const projectSkillSkips = new Map<string, string>()
  // Cap on the retained skip notes: at the cap the map is cleared wholesale rather
  // than grown, so a full map loses older notes and never correctness.
  const PROJECT_SKIP_MAX = 128
  // Record one skip under `(workspace dir, candidate name)`; the caller supplies
  // `*` as the whole-plane key when an enumeration failure has no candidate name.
  const recordProjectSkip = (dir: string, name: string | undefined, reason: string): void => {
    if (projectSkillSkips.size >= PROJECT_SKIP_MAX) projectSkillSkips.clear()
    projectSkillSkips.set(`${dir}\u0000${name ?? "*"}`, reason)
  }
  try {
    // The per-call project provider. Registration is process-global and cannot be
    // scoped to a session, so one provider serves every session's project plane,
    // discovered from the CALLER's own cwd on each call.
    const projectProvider = createSkillProvider({
      name: projectProviderName,
      warn,
      onSkip: (reason, name) => {
        // Read at skip time, never captured at registration: one provider serves
        // every session, so the dir is only valid while a call is in flight.
        const dir = projectClaimDir
        if (dir !== undefined) recordProjectSkip(dir, name, reason)
      },
      entries: (listOptions) => {
        // F5: no `?? dsh.workspaceRoot()` here. That fallback reaches
        // `DSH_WORKSPACE_ROOT` and then `process.cwd()`, i.e. the launcher's
        // directory — in a one-host/many-sessions process another project's
        // extensions would be served into this session's catalog. An unknown cwd
        // means this caller HAS no project plane (per-call discovery, contract §3).
        const root = cwdOf(listOptions)
        projectClaimDir = root === undefined ? undefined : projectExtensionsDir(root)
        if (root === undefined) return []
        // Re-discovered per call: the project plane is whatever this caller's
        // workspace holds at this moment, so a mid-session edit is visible without a restart.
        const discovery = discoverPlane({
          plane: "project",
          dir: projectExtensionsDir(root),
          providerNameFor: () => projectProviderName,
          warn,
        })
        // Config read per call, so enable/disable take effect without an apply-time snapshot.
        const current = extensionConfig(ctx)
        // Only enabled entries contribute candidates: a config-disabled extension serves nothing.
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
    // The CALLER's workspace for this call (session cwd outranks $DSH_WORKSPACE_ROOT
    // outranks process.cwd()); never cached in a module const across calls.
    const root = dsh.workspaceRoot(exec as DshToolExec | undefined)
    // <workspace>/.mpd/extensions — the project plane of this very call.
    const dir = projectExtensionsDir(root)
    // Optimistic default: an enumeration failure must leave the other planes
    // visible (an empty project plane) instead of throwing out of the tool call.
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
    // Read once for this call and shared by every entry; `extensions.*` is
    // process-level (declared v1 limit), so there is no per-session variant to re-read.
    const current = extensionConfig(ctx)
    // Attribute the skips the project provider recorded for THIS workspace: its
    // per-call entry objects are gone by now, so the note is matched back by
    // `(workspace dir, candidate name)` — `*` is the whole-plane key (F4).
    for (const entry of discovery.entries) {
      for (const document of [...entry.skillEntries, ...entry.flowEntries]) {
        // The note keyed by this candidate's name, or the whole-plane key `*` an
        // enumeration failure recorded; the per-candidate key wins when both exist.
        const reason = projectSkillSkips.get(`${dir}\u0000${document.document.name}`) ?? projectSkillSkips.get(`${dir}\u0000*`)
        if (reason === undefined) continue
        if (entry.errors.some((error) => error.reason === reason)) continue
        entry.errors.push({ item: "contributes.skills", reason })
      }
    }
    // Registry entries with the per-call project plane merged in FRONT (first wins);
    // both cross-extension surfaces (roles, skill names) are re-derived in this view.
    const merged = registry.view(discovery, { isEnabled: (entry) => effectiveEnabled(entry, current) })
    // The merged entries in serving order, each projected into the tool-facing view.
    const extensions = merged.entries.map((entry) => toView(entry, current))
    // Shadowing, rejection and pending reasons, flattened into the `warnings` field.
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
    // The extension root: "" when the caller passed none, which buildExtension
    // reports as an error for any declared skill/flow asset (nothing to resolve against).
    const root = typeof options?.root === "string" && options.root.length > 0 ? options.root : ""
    // Default `bundle`: a code-plane registration is host-wide unless it says otherwise.
    const plane: MpdExtensionPlane = options?.plane === "project" || options?.plane === "user" || options?.plane === "bundle" ? options.plane : "bundle"
    // The author's own id, when it is a usable string, so a refused registration is
    // still reported under the id its author meant.
    const declared = (descriptor as { id?: unknown } | undefined)?.id
    // Fallback id for a descriptor that declared none or a non-string: the record
    // needs a stable label even though the descriptor itself is refused.
    const id = typeof declared === "string" && declared.length > 0 ? declared : "unnamed"
    try {
      // Validate + resolve in one call; a refusal comes back as `rejected`, never as a throw.
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
      // `built.entry` exists exactly when the descriptor passed validation.
      const entry = built.entry as ExtensionEntry
      // A duplicate id is shadowed here (first wins): reported, but it gets neither
      // a skill provider nor an MCP bridge.
      const added = registry.add(entry)
      if (added.ok) {
        registerEntryProvider(entry)
        void bridge?.adopt(entry)
      }
      return { ok: added.ok, id: entry.id, errors: entry.errors, ...(added.shadowed === undefined ? {} : { shadowed: added.shadowed }) }
    } catch (error) {
      // A throw here means the whole descriptor could not be interpreted, so the
      // failure is recorded at `descriptor` level rather than on a single item.
      const errors = [{ item: "descriptor", reason: "registration failed: " + message(error) }]
      registry.addRejected({ id, plane, origin: "plugin", root, source: "register()", errors })
      return { ok: false, id, errors }
    }
  }

  // The `mpdExtensions` service: the code-plane registration entry point plus the
  // four read surfaces every tool is built on (all resolved per call).
  const service = {
    apiVersion: MPD_EXT_API_VERSION,
    /** Which adapter branch THIS read reaches — read at surface time, never cached at apply (T-50). */
    get adapterIdentity(): AdapterIdentity {
      return dshAdapterIdentity(ctx)
    },
    register,
    list: (options: { exec?: unknown } = {}) => snapshot(options?.exec),
    describe: (id: string, options: { exec?: unknown } = {}) => snapshot(options?.exec).extensions.find((entry) => entry.id === String(id ?? "")),
    flows: (options: { exec?: unknown } = {}) => snapshot(options?.exec).extensions.flatMap((entry) => entry.flowDocs.map((flow) => ({ extension: entry.id, enabled: entry.enabled, flow }))),
    flow: (id: string, options: { exec?: unknown } = {}) => {
      // The id as a caller would spell it; a missing or non-string id becomes the
      // empty string, which no flow id can equal.
      const wanted = String(id ?? "")
      for (const entry of snapshot(options?.exec).extensions) {
        // First match in serving order wins — the same rule the registry applies to ids.
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

  // Names of the tools whose registration really succeeded, in registration order;
  // the apply summary is derived from this list, never from what was intended.
  const registeredToolNames: string[] = []
  /** Registering a tool can throw (absent seam, duplicate name): contain it, but
   * count the outcome so the summary below can never claim a tool that is not
   * really registered. */
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

  // The duplicates THIS entry wins against, for its `shadows` field: a record is
  // matched by its KEPT (winner) locator, never by the loser's.
  const shadowsFor = (view: ExtensionViewSnapshot, entry: ExtensionView): ShadowRecord[] =>
    view.shadowed.filter((record) => record.kept.plane === entry.plane && record.kept.root === entry.root)

  /**
   * What the harness's OWN catalog says about the names this view claims (F4).
   *
   * The registry can only see collisions between two extensions; a name that loses
   * to the skill corpus, to a user skills root or to a sibling provider is decided
   * inside `ctx.skills`, so the only honest answer is to ask it — `list()` returns
   * the merged winning summaries, each carrying the `provider` that serves it
   * (H/dsh-skill/lib/index.ts:224-226, 491-501). This runs in the TOOL path on
   * purpose: calling the catalog from inside our own provider would recurse
   * (`snapshot()` -> `provider.list()` -> `snapshot()`).
   *
   * A catalog read that fails is reported as `checked:false`, never as "not served":
   * an unverifiable claim and a disproved one are different facts.
   */
  const skillCatalog = async (exec: unknown): Promise<{ checked: boolean; reason: string; holders: Map<string, { provider: string; source: string }> }> => {
    try {
      // This CALL's workspace: the catalog is a per-workspace read, so no cached root.
      const root = dsh.workspaceRoot(exec as DshToolExec | undefined)
      // The harness's merged winning summaries — the only honest source for "what is served".
      const summaries = await dsh.listSkills({ cwd: root })
      // First summary per name wins, mirroring the catalog's own precedence.
      const holders = new Map<string, { provider: string; source: string }>()
      for (const summary of summaries) {
        // A summary without a usable name cannot be matched to a claim, so it is skipped.
        const name = summary?.name
        if (typeof name !== "string" || holders.has(name)) continue
        holders.set(name, {
          provider: typeof summary.provider === "string" ? summary.provider : "",
          source: typeof summary.source === "string" ? summary.source : "",
        })
      }
      return { checked: true, reason: "", holders }
    } catch (error) {
      return { checked: false, reason: message(error), holders: new Map() }
    }
  }

  /**
   * The serving report for ONE view entry, against the catalog read once per call.
   *
   * The identity test is the `(provider, source)` pair, not the provider name alone:
   * every project-plane extension shares ONE provider (`mpd-ext:project-plane`), so the
   * name alone cannot tell two project entries apart — and their `source` (the manifest
   * each candidate came from) can.
   */
  const skillServingFor = (
    entry: ExtensionView,
    catalog: { checked: boolean; reason: string; holders: Map<string, { provider: string; source: string }> },
  ): Record<string, unknown> => {
    // Every name this entry claims: skills first, then flows (a flow is served as a skill candidate).
    const claimed = [...entry.skills, ...entry.flows]
    // Claimed names the catalog resolves back to this entry's exact (provider, source) pair.
    const served: string[] = []
    // Claimed names resolved elsewhere or absent — reported as facts, never as an error.
    const notServed: string[] = []
    // The per-name evidence behind both lists: who holds the name and the one-line reason.
    const detail: Array<{ name: string; served: boolean; provider: string; source: string; note: string }> = []
    for (const name of claimed) {
      // Absent means the name is not in the catalog at all — shadowed by a
      // non-extension provider, or this extension is not serving it right now.
      const holder = catalog.holders.get(name)
      if (!catalog.checked) {
        detail.push({ name, served: false, provider: "", source: "", note: `not verified: the harness catalog could not be read (${catalog.reason})` })
        continue
      }
      // Identity is the (provider, source) PAIR, not the provider alone: one
      // project-plane provider serves many extensions, so their sources separate them.
      const mine = holder !== undefined && holder.provider === entry.providerName && holder.source === entry.source
      if (mine) {
        served.push(name)
        detail.push({ name, served: true, provider: holder.provider, source: holder.source, note: "" })
        continue
      }
      notServed.push(name)
      detail.push({
        name,
        served: false,
        provider: holder?.provider ?? "",
        source: holder?.source ?? "",
        note: holder === undefined
          ? "not in the current catalog (the name may lose to another provider, or the extension may be disabled)"
          : holder.provider === entry.providerName
            ? `served by another extension under the same provider "${entry.providerName}" (source ${holder.source})`
            : `served by provider "${holder.provider}" instead of "${entry.providerName}"`,
      })
    }
    return { checked: catalog.checked, reason: catalog.reason, served, notServed, detail }
  }

  // The `skillServing` object schema both tools declare: the checked flag, the
  // failure reason and the per-name detail list that backs `served`/`notServed`.
  const SKILL_SERVING_SCHEMA = {
    type: "object",
    additionalProperties: false,
    properties: {
      checked: { type: "boolean", description: "true when the harness skill catalog was readable; false means the claims below are NOT verified" },
      reason: { type: "string" },
      served: STRING_ARRAY_SCHEMA,
      notServed: STRING_ARRAY_SCHEMA,
      detail: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, served: { type: "boolean" }, provider: { type: "string" }, source: { type: "string" }, note: { type: "string" } },
          required: ["name", "served", "provider", "source", "note"],
        },
      },
    },
    required: ["checked", "reason", "served", "notServed", "detail"],
  } as const

  /**
   * The descriptor as a tool may echo it (F6): the author-declared `env` VALUES of
   * every MCP server are redacted, because a tool result lands in a session log and
   * in the model's context — and a manifest env block is exactly where an API key
   * goes. The KEYS stay visible (they are the interface), the count stays visible.
   */
  const redactedDescriptor = (entry: ExtensionView): Record<string, unknown> => {
    // `contributes.mcp[].env` is the only descriptor field that can carry a
    // secret, so it is the only part this echo rewrites.
    const descriptor = entry.descriptor as { contributes?: { mcp?: unknown[] } } | undefined
    // A non-array or empty mcp block has nothing to redact, so the descriptor is
    // returned exactly as the author wrote it.
    const servers = descriptor?.contributes?.mcp
    if (!Array.isArray(servers) || servers.length === 0) return entry.descriptor as Record<string, unknown>
    return {
      ...(entry.descriptor as Record<string, unknown>),
      contributes: {
        ...(descriptor?.contributes as Record<string, unknown>),
        mcp: servers.map((server) => {
          // A server item that is not an object has no env block to redact and is echoed unchanged.
          const record = server as Record<string, unknown>
          // Only an object env is a key/value map; anything else is passed through untouched.
          const env = record.env
          if (env === undefined || env === null || typeof env !== "object") return record
          // The KEYS stay visible (they are the interface a caller needs); only values are masked.
          const keys = Object.keys(env as Record<string, unknown>)
          return { ...record, env: Object.fromEntries(keys.map((key) => [key, "<redacted>"])) }
        }),
      },
    }
  }

  // Shape one snapshot into the `mpd_ext_list` value: the per-extension report
  // plus the shadow, rejection and warning lists the schema above requires.
  const listValue = (view: ExtensionViewSnapshot, catalog: Awaited<ReturnType<typeof skillCatalog>>): Record<string, unknown> => ({
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
      // …and whether the catalog really serves them: a claimed name that the
      // harness resolves to another provider is reported, not asserted (F4).
      skillServing: skillServingFor(entry, catalog),
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
                skillServing: SKILL_SERVING_SCHEMA,
                errors: { type: "array", items: ERROR_SCHEMA },
                pending: { type: "array", items: ERROR_SCHEMA },
                shadows: { type: "array", items: SHADOW_PAIR_SCHEMA },
              },
              required: ["id", "origin", "plane", "root", "enabled", "contributions", "skills", "flows", "roles", "skillServing", "errors", "pending", "shadows"],
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
        // Header first, then one block per extension; a host with zero extensions
        // still reports its three counts, so an empty list is readable as such.
        const lines = [
          `mpd extensions: ${value.extensions.length} (${value.shadowed.length} shadowed, ${value.rejected.length} rejected)`,
        ]
        for (const entry of value.extensions) {
          lines.push(
            `- ${entry.id} [${entry.plane}/${entry.origin}] ${entry.enabled ? "enabled" : "disabled"}`
            + ` skills=${entry.contributions.skills} flows=${entry.contributions.flows} mcp=${entry.contributions.mcp} roles=${entry.contributions.roles}`
            + (entry.roles.length > 0 ? ` (roles: ${entry.roles.join(", ")})` : ""),
          )
          // A claimed name the harness resolves elsewhere is REPORTED, never
          // asserted as usable (F4): the serving fact, not the declaration.
          if (entry.skillServing.checked !== true) {
            lines.push(`    skill serving UNVERIFIED: ${entry.skillServing.reason}`)
          } else if (entry.skillServing.notServed.length > 0) {
            lines.push(`    not served: ${entry.skillServing.notServed.join(", ")}`)
          }
          for (const error of entry.errors) lines.push(`    error ${error.item}: ${error.reason}`)
          for (const pending of entry.pending) lines.push(`    pending ${pending.item}: ${pending.reason}`)
          if (entry.shadows.length > 0) lines.push(`    shadows ${entry.shadows.map((shadow: any) => shadow.plane).join(", ")}`)
        }
        for (const rejected of value.rejected) lines.push(`! rejected ${rejected.id} (${rejected.plane}): ${rejected.errors.map((error: any) => error.reason).join("; ")}`)
        return text(lines.join("\n"))
      },
    },
    execute: async (_args: unknown, exec: unknown) => {
      // The catalog is read BEFORE the view: asking the harness runs our own providers,
      // which is where a project-plane skip is recorded, so the report a caller gets
      // includes the skips of the very call it made (F4).
      const catalog = await skillCatalog(exec)
      return listValue(snapshot(exec), catalog)
    },
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
          skillServing: SKILL_SERVING_SCHEMA,
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
        required: ["id", "origin", "plane", "root", "source", "enabled", "descriptor", "resolvedRoots", "skills", "flows", "roles", "skillServing", "mcp", "errors", "pending", "shadows"],
      },
      render: (_args: unknown, value: any) => {
        // Identity lines first (id, root, source, declared names, server states);
        // the catalog-verified serving report follows only when it was readable.
        const lines = [
          `extension ${value.id} [${value.plane}/${value.origin}] ${value.enabled ? "enabled" : "disabled"}`,
          `root: ${value.root || "(none)"}`,
          `source: ${value.source}`,
          `skills: ${value.skills.length > 0 ? value.skills.join(", ") : "(none)"}`,
          `flows: ${value.flows.length > 0 ? value.flows.join(", ") : "(none)"}`,
          `roles: ${value.roles.length > 0 ? value.roles.join(", ") : "(none)"}`,
          `mcp: ${value.mcp.length > 0 ? value.mcp.map((server: any) => `${server.serverName}=${server.state}`).join(", ") : "(none)"}`,
        ]
        if (value.skillServing.checked !== true) {
          lines.push(`skill serving UNVERIFIED: ${value.skillServing.reason}`)
        } else {
          lines.push(`served skills: ${value.skillServing.served.length > 0 ? value.skillServing.served.join(", ") : "(none)"}`)
          for (const detail of value.skillServing.detail) {
            if (detail.served === true) continue
            lines.push(`not served: ${detail.name} — ${detail.note}`)
          }
        }
        for (const error of value.errors) lines.push(`error ${error.item}: ${error.reason}`)
        for (const pending of value.pending) lines.push(`pending ${pending.item}: ${pending.reason}`)
        return text(lines.join("\n"))
      },
    },
    execute: async (args: { id?: unknown }, exec: unknown) => {
      // One snapshot for the whole call: the project plane is re-discovered for
      // THIS workspace, and the id is resolved against that merged view only.
      const view = snapshot(exec)
      // A missing or non-string id becomes the empty string, which no id grammar allows.
      const id = String(args?.id ?? "")
      // First entry with this id: the view is already in serving order (first wins).
      const entry = view.extensions.find((candidate) => candidate.id === id)
      if (entry === undefined) {
        // Sorted, so an error message is stable across calls and readable in a diff.
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
        // Redacted on purpose (F6): a tool result reaches the session log and the
        // model's context, and `contributes.mcp[].env` is where an author's API key
        // lives. Keys stay, values become `<redacted>`.
        descriptor: redactedDescriptor(entry),
        resolvedRoots: {
          root: entry.resolvedRoots.root,
          skills: [...entry.resolvedRoots.skills],
          flows: [...entry.resolvedRoots.flows],
          roles: [...entry.resolvedRoots.roles],
        },
        skills: [...entry.skills],
        flows: [...entry.flows],
        roles: [...entry.roles],
        skillServing: skillServingFor(entry, await skillCatalog(exec)),
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
      // One snapshot for the whole call; only ENABLED extensions contribute flows.
      const view = snapshot(exec)
      // Accumulated explicitly because the value schema requires `flows` even when empty.
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
      // One snapshot for the whole call; the id is looked up across every
      // extension's flow docs, in serving order.
      const view = snapshot(exec)
      // The id as the caller spelled it; a missing id becomes the empty string and matches nothing.
      const wanted = String(args?.id ?? "")
      for (const entry of view.extensions) {
        // First match in serving order wins — the same rule the registry applies to ids.
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
      // Only reached when no extension contributes this flow: the error names every
      // known flow id, sorted so the message is stable.
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
    // Non-optional alias: narrows the optional `bridge` once, so the disposer
    // closure below captures a definitely-assigned value instead of re-reading a `let`.
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
    rowLogLine("mpd-ext", 
      "[mpd-ext] mpdExtensions provided (apiVersion " + MPD_EXT_API_VERSION + ")"
      + " | adapterIdentity=" + dshAdapterIdentity(ctx)
      + " | tools: " + registeredToolNames.join(", ")
      + " | skill providers: " + (registeredProviderNames.length === 0 ? "(none: no extension contributes skills or flows)" : registeredProviderNames.join(", "))
      + " | project plane: <session workspace>/.mpd/extensions (per call)",
    )
  }
}
