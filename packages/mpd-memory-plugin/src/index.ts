

// C6 mpd-memory-plugin: git/svn-backed memory engine with a reflection state machine.
// mpd-owned code: the engine's semantics — markdown memory files with frontmatter (description/
// kind/aliases/read_only), a journal, and a step-count reflection reducer — are RE-EXPRESSED here
// from the DOCUMENTED BEHAVIOUR of the upstream project `memory-core` (base 8c57e46); no
// upstream source is translated. The upstream facts queue is NOT carried: the package README documents
// the layout slot but no tool reads, writes or counts it, so no status answer advertises one.
// HISTORY: an earlier draft of the reducer mirrored upstream's state-machine vocabulary
// (`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`,
// `completeTransition`); de-omo wave F replaced it with the vocabulary below and left a READ-ONLY
// compatibility path for records already persisted under those names.
// OURS, not upstream's: the svn backend and the VCS abstraction over git AND svn
// (memory.vcs: git | svn | both; `both` commits to each). Upstream `memory-core` is Git-only —
// its `GitMemoryRepo` has no svn counterpart.
// Paths: the WORKSPACE store is `<workspace>/.mpd/memory/agents/<slug>/{repo, runtime/...}`; the
// GLOBAL store (wave W3-D) is `<HOME>/.mpd/memory/{repo, runtime/{journal.jsonl, index.json}}`.
// THIS FILE owns the five tools and the reflection machine; the store layer lives in `store.ts` and
// the project-archive hook in `archive.ts`, so neither module has to import the other.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { DSH_SEAM_TOOLS, dshSeamInject, textBlock, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { MEMORY_READ_CARD, MEMORY_STATUS_CARD, MEMORY_WRITE_CARD } from "./dshgo-cards.ts"
import {
  agentPaths,
  appendJournalLine,
  assertMemoryMutationSandboxed,
  commitAll,
  ensureDirs,
  ensureGlobalDirs,
  ensureVcs,
  globalDirs,
  journalPath,
  normalizeLogEntry,
  parseFrontmatter,
  safeMemoryPath,
  scopeOf,
  type Config,
} from "./store"
import { installArchiveHook, type ArchiveCallContext, type TeamsServiceView } from "./archive"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-memory"
/** The tool registry the five `mpd_memory_*` tools are registered into, named by its adapter constant. */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of the row context this plugin reads: the tool registry, the service probe, the dispose event. */
type Ctx = {
  /** The harness tool registry, reached through the adapter. */
  tools: any
  /** The harness service probe, used for `mpdConfig` and `mpdTeams`; absent in a stand-alone unit test. */
  get?: (k: string) => any
  /** The context's own lifecycle event subscription, used to release this row's disposers. */
  on?: (event: string, cb: () => void) => unknown
}

/** Merge the row config with the mpdConfig runtime layer (mpd.jsonc wins per key). */
function mergedConfig(ctx: Ctx, config: Config): Config {
  /** The mounted runtime config service, when the composition has one. */
  const svc = ctx.get?.("mpdConfig") as { get: (k?: string) => any } | undefined
  if (!svc?.get) return config
  /** Dotted-key reader bound to the service; its answer is exactly what the service's own `get` returns. */
  const v = (k: string): ReturnType<NonNullable<typeof svc>["get"]> => svc.get(k)
  /** The configured VCS mode, accepted only when it names one of the three known modes. */
  const vcs = v("memory.vcs")
  return {
    ...config,
    vcs: vcs === "git" || vcs === "svn" || vcs === "both" ? vcs : config.vcs,
    dir: typeof v("memory.dir") === "string" ? v("memory.dir") : config.dir,
    agentSlug: typeof v("memory.agentSlug") === "string" ? v("memory.agentSlug") : config.agentSlug,
    reflectionEvery: typeof v("memory.reflectionEvery") === "number" ? v("memory.reflectionEvery") : config.reflectionEvery,
    // The GLOBAL store root override (wave W3-D); absent means `<HOME>/.mpd/memory`, resolved per call.
    globalDir: typeof v("memory.globalDir") === "string" ? v("memory.globalDir") : config.globalDir,
  }
}

/** One reflection claim: `due` while the completion is still owed, and `at` the instant it was raised or settled. */
type PendingReflection = { due: boolean; at: string }

/** The reflection state persisted at `<runtime>/reflection.json`: the write counter, the completion counter and the claim. */
type ReflectionState = {
  /** Every memory write recorded for this agent, ever. */
  steps: number
  /** How many reflections have been completed. */
  reflectionsCompleted: number
  /** Writes since the last completed reflection; crossing `reflectionEvery` raises a claim. */
  stepsSinceReflection: number
  /** The outstanding claim, or null when none is open. */
  pendingReflection: PendingReflection | null
  /** True from the threshold crossing until the completion that settles the claim. */
  triggered: boolean
}

/** The state of an agent that has never written: every counter zero and no claim outstanding. */
function initialState(): ReflectionState {
  return { steps: 0, reflectionsCompleted: 0, stepsSinceReflection: 0, pendingReflection: null, triggered: false }
}

/**
 * Put a parsed state record under the field names this package writes today.
 *
 * THE COMPATIBILITY BOUND: records persisted before de-omo wave F carry the earlier draft's names
 * (`reflected_completed_steps`, `steps_since_last_successful_reflection`, `reservation`) and real ones
 * exist on disk, so a legacy name is READ here and never written again — the next `writeReflection`
 * persists the current names only.
 *
 * @param raw - the parsed state file, of unknown shape because it may predate this vocabulary.
 * @returns the state under the current names; an unreadable record degrades to the initial state.
 */
function adoptLegacyState(raw: any): ReflectionState {
  /** The parsed record, or an empty stand-in when the file held a non-object. */
  const s: any = raw && typeof raw === "object" ? raw : {}
  /** The pre-wave-F claim object, mapped below when the current name is absent. */
  const legacyClaim = s.reservation
  return {
    steps: s.steps ?? 0,
    reflectionsCompleted: s.reflectionsCompleted ?? s.reflected_completed_steps ?? 0,
    stepsSinceReflection: s.stepsSinceReflection ?? s.steps_since_last_successful_reflection ?? 0,
    pendingReflection: s.pendingReflection !== undefined
      ? (s.pendingReflection ?? null)
      : legacyClaim == null || typeof legacyClaim !== "object"
        ? null
        : { due: legacyClaim.status === "pending", at: String(legacyClaim.at ?? "") },
    triggered: s.triggered ?? false
  }
}

/**
 * Register the five memory tools, the reflection state machine behind them and the ONE project-archive
 * hook listener (wave W3-D).
 *
 * @param ctx - the row context; the runtime config and team services are read here, the workspace root per call.
 * @param config - row overrides for the VCS mode, the workspace state dir, the slug, the reflection threshold and the global root.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin).
  const dsh: any = resolveDshAdapter(ctx)
  /** The effective config: the row's own keys, overlaid by the runtime config layer. */
  const cfg = mergedConfig(ctx, config)
  /** How many writes may pass between two reflections before the machine marks one due. */
  const reflectionEvery = cfg.reflectionEvery ?? 10
  /** Every disposer this row must release when the composition disposes (the archive hook's registration). */
  const disposers: Array<() => void> = []

  /** Path of the reflection state file inside the agent's runtime directory. */
  function statePath(d: any): string { return join(d.runtime, "reflection.json") }

  /** Read the reflection state, adopting a record persisted under the pre-wave-F names; a missing or unparseable file reads as the initial state, so the machine can always be driven. */
  function readReflection(d: any): ReflectionState {
    try { return adoptLegacyState(JSON.parse(readFileSync(statePath(d), "utf8"))) } catch { return initialState() }
  }
  /** Persist the reflection state, pretty-printed so a human can read the counters. */
  function writeReflection(d: any, s: any): void { writeFileSync(statePath(d), JSON.stringify(s, null, 2)) }

  /**
   * The mounted `mpdTeams` read service, probed on EVERY call so a late mount is honoured; `undefined`
   * when this composition has none, which the archive hook degrades on (one logged line, no write).
   *
   * @returns the service when it exposes the archive listing the hook needs, else `undefined`.
   */
  function teamsService(): TeamsServiceView | undefined {
    /** The service the row context exposes, when this composition mounts one. */
    const svc = ctx.get?.("mpdTeams")
    return svc !== undefined && svc !== null && typeof svc.archivedPlans === "function" ? svc as TeamsServiceView : undefined
  }

  /**
   * Build the per-call context the archive hook works from.
   *
   * @param exec - the observed tool execution, whose agent/workspace header names the workspace.
   * @returns the workspace, the effective config and the team service, resolved for THIS call.
   */
  function archiveContext(exec: unknown): ArchiveCallContext {
    return {
      // Resolved per call and never cached (AGENTS.md §6): a row must not pin a workspace root.
      workspace: dsh.workspaceRoot(exec),
      config: cfg,
      teams: teamsService(),
    }
  }

  dsh.registerTool({
    name: "mpd_memory_write",
    description: "Persist a memory entry (markdown file with frontmatter description/kind/aliases/read_only) into the VCS-backed memory store and commit. scope:\"workspace\" (default, this agent's store) or \"global\" (the shared ~/.mpd/memory store, guarded: a global write is refused when its root is not inside the sandbox $HOME of an isolated boot, and it never advances the per-agent reflection counter). A workspace write increments the reflection step counter; when the reflection threshold is crossed the result announces a reflection is due. kind: note | fact | reflection.",
    parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, kind: { type: "string", enum: ["note", "fact", "reflection"] }, tags: { type: "array", items: { type: "string" } }, readOnly: { type: "boolean" }, scope: { type: "string", enum: ["workspace", "global"], description: "Which store this entry belongs to; workspace is the default." } }, required: ["title", "content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { file: { type: "string" }, committedTo: { type: "array", items: { type: "string" } }, reflectionDue: { type: "boolean" }, vcs: { type: "string" }, errors: { type: "array", items: { type: "string" } }, scope: { type: "string" } }, required: ["file", "vcs"] }, render: (_a: unknown, v: any) => textBlock("memory written: " + v.file + " (vcs=" + v.vcs + " committed=" + v.committedTo.join(",") + " reflectionDue=" + v.reflectionDue + ")"), presentationMeta: MEMORY_WRITE_CARD },
    execute: async (args: any, exec: any) => {
      /** The store this call addresses; the default workspace keeps every existing caller's meaning. */
      const scope = scopeOf(args)
      /** The entry's file stem: the slugged title plus a base-36 timestamp, so equal titles never collide. */
      const name = String(args?.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) + "-" + Date.now().toString(36)
      /** The frontmatter record: description falls back to the title, kind to `note`, tags to an empty list. */
      const meta: any = { description: String(args?.description ?? args?.title ?? name), kind: String(args?.kind ?? "note"), tags: Array.isArray(args?.tags) ? args.tags : [] }
      if (args?.readOnly === true) meta.read_only = true
      // THE GLOBAL BRANCH: the shared store lives under the user's HOME — the one sanctioned
      // home-scoped state root — so this mutation is GUARDED, and it carries no agent slug layer.
      if (scope === "global") {
        // The T-43 guard runs BEFORE anything is created: a refused write must leave no directory behind.
        // Under a DSH_HOME-set boot the root must live INSIDE the sandbox $HOME.
        assertMemoryMutationSandboxed(globalDirs(cfg).root, "write a global memory entry")
        /** The shared store's directories, created on demand (the first global write bootstraps it). */
        const g = ensureGlobalDirs(cfg)
        ensureVcs(cfg, g)
        /** The global entry's frontmatter: the shared fields plus the scope this store gives the entry. */
        const globalMeta: any = { ...meta, scope: "global" }
        /** The entry's absolute path, containment-checked against the global memory directory. */
        const globalFile = safeMemoryPath(g.memoryDir, name + ".md")
        /** The serialized frontmatter block the file starts with. */
        const globalFront = "---\n" + JSON.stringify(globalMeta) + "\n---\n"
        writeFileSync(globalFile, globalFront + String(args?.content) + (String(args?.content).endsWith("\n") ? "" : "\n"))
        /** The error lines of the backends that failed to commit this entry; a commit failure never fails the write. */
        const globalErrs = commitAll(cfg, g, "memory: " + name + " (" + globalMeta.kind + ")")
        appendJournalLine(g, "write", { file: basename(globalFile), kind: globalMeta.kind, vcs: cfg.vcs ?? "git", scope: "global" })
        // A global write is NOT an agent step: reflection is per agent and stays workspace-scoped, so the
        // claim is READ (never advanced) from the workspace store's paths — computed WITHOUT creating
        // them, because a global write must not bootstrap the workspace store as a side effect.
        /** The workspace store's directories, computed only. */
        const wsDirs = agentPaths(cfg, dsh.workspaceRoot(exec))
        /** The workspace reflection state as it already stands. */
        const wsState = readReflection(wsDirs)
        return { file: globalFile, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: wsState.triggered === true || wsState.pendingReflection?.due === true, vcs: cfg.vcs ?? "git", errors: globalErrs, scope }
      }
      /** The agent's state directories, created on demand so a first write works in an empty workspace. */
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec))
      ensureVcs(cfg, d)
      /** The entry's absolute path, containment-checked against the memory directory. */
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      /** The serialized frontmatter block the file starts with. */
      const front = "---\n" + JSON.stringify(meta) + "\n---\n"
      writeFileSync(file, front + String(args?.content) + (String(args?.content).endsWith("\n") ? "" : "\n"))
      /** The error lines of the backends that failed to commit this entry; a commit failure never fails the write. */
      const errs = commitAll(cfg, d, "memory: " + name + " (" + meta.kind + ")")
      /** The reflection state after this write's step increment. */
      const ref = readReflection(d)
      ref.steps = (ref.steps ?? 0) + 1
      ref.stepsSinceReflection = (ref.stepsSinceReflection ?? 0) + 1
      if ((ref.stepsSinceReflection ?? 0) >= reflectionEvery) { ref.triggered = true; ref.pendingReflection = { due: true, at: new Date().toISOString() } }
      writeReflection(d, ref)
      appendJournalLine(d, "write", { file: basename(file), kind: meta.kind, vcs: cfg.vcs ?? "git" })
      return { file, committedTo: (cfg.vcs ?? "git") === "both" ? ["git", "svn"] : [cfg.vcs ?? "git"], reflectionDue: ref.triggered === true, vcs: cfg.vcs ?? "git", errors: errs, scope }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_read",
    description: "Read memory entries by optional kind filter and/or a substring query (matched against description/content/tags/aliases), PAGINATED: pass `offset` (default 0) and `limit` (default 20, max 50); the answer carries `count` (the TOTAL matched, not the page), `offset`, `returned` and `next_offset` (the next page's offset, or null at the end). Entries come back in a STABLE order: the entry FILE NAME ascending, so successive calls walk every match exactly once. scope:\"workspace\" (default) reads this agent's store, \"global\" the shared ~/.mpd/memory store; a global read never creates the store.",
    parameters: { type: "object", properties: { query: { type: "string" }, kind: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, description: "Page size; clamped to 1..50, default 20." }, offset: { type: "integer", minimum: 0, description: "Page start in the matched set; default 0. Pass the previous answer's next_offset to continue." }, scope: { type: "string", enum: ["workspace", "global"], description: "Which store to read; workspace is the default." } }, additionalProperties: false },
    output: { schema: { type: "object", properties: { entries: { type: "array", items: { type: "object" } }, count: { type: "integer" }, offset: { type: "integer" }, returned: { type: "integer" }, next_offset: { oneOf: [{ type: "integer" }, { type: "null" }] }, scope: { type: "string" } }, required: ["entries", "count"] }, render: (_a: unknown, v: any) => textBlock("memory entries: " + v.count + " total, offset=" + v.offset + " returned=" + v.returned + " next=" + (v.next_offset === null ? "end" : v.next_offset) + "\n" + v.entries.map((e: any) => "- [" + (e.kind ?? "note") + "] " + e.description + ": " + e.content.slice(0, 200)).join("\n")), presentationMeta: MEMORY_READ_CARD },
    execute: async (args: any, exec: any) => {
      /** The store this call addresses; the default workspace keeps every existing caller's meaning. */
      const scope = scopeOf(args)
      // A READ never creates the global store: making `~/.mpd/memory` on a read would be a HOME
      // mutation, and the shared guard deliberately covers mutations only. An absent global store
      // therefore answers an empty list instead of bootstrapping one.
      /** The entry directory this call reads. */
      const memoryDir = scope === "global" ? globalDirs(cfg).memoryDir : ensureDirs(cfg, dsh.workspaceRoot(exec)).memoryDir
      // THE ORDER IS PINNED HERE: ascending file name, a code-unit sort that never depends on directory
      // enumeration order. Every page is a slice of THIS list, so two calls with the same filters see the
      // same order and N successive pages reach each match exactly once.
      /** The entry filenames in the memory directory, sorted ascending; a missing directory reads as none. */
      const files = (existsSync(memoryDir) ? readdirSync(memoryDir).filter((f) => f.endsWith(".md")) : []).sort()
      /** The entries that pass both filters, in the pinned file-name order. */
      let entries: any[] = []
      /** The requested kind filter, or null when the caller wants every kind. */
      const kind = args?.kind ? String(args.kind) : null
      /** The requested substring query, lower-cased once for the per-entry comparison. */
      const query = args?.query ? String(args.query).toLowerCase() : null
      for (const f of files) {
        /** The entry's absolute path. */
        const p = join(memoryDir, f)
        /** The entry's frontmatter and body, split out of the file. */
        const { meta, body } = parseFrontmatter(p)
        /** The normalized record both filters below run against. */
        const e = normalizeLogEntry(meta, f, body)
        if (kind && e.kind !== kind) continue
        if (query) {
          /** The searchable text: description, content, tags and aliases folded into one lower-cased haystack. */
          const hay = (e.description + " " + e.content + " " + (e.tags ?? []).join(" ") + " " + (e.aliases ?? []).join(" ")).toLowerCase()
          if (!hay.includes(query)) continue
        }
        entries.push(e)
      }
      /** The page size actually applied: the caller's `limit`, clamped to 1..50 and defaulting to 20. */
      const limit = Math.min(Math.max(Number(args?.limit ?? 20) || 20, 1), 50)
      // The page start is TOTAL: a missing, negative, fractional or non-numeric offset floors to 0, so a
      // caller can never be refused a read by a bad offset — it just gets the first page.
      /** The page start actually applied: a non-negative floored integer, defaulting to 0. */
      const offset = Math.max(Math.floor(Number(args?.offset ?? 0)) || 0, 0)
      /** This page's entries, sliced out of the PINNED order above. */
      const page = entries.slice(offset, offset + limit)
      // `count` stays the TOTAL matched (the pre-pagination number), which is what makes `next_offset`
      // meaningful to a caller walking the set without re-deriving anything from prose.
      /** Where the next page starts, or null when this page reaches the end of the matched set. */
      const nextOffset = offset + page.length < entries.length ? offset + page.length : null
      return { entries: page, count: entries.length, offset, returned: page.length, next_offset: nextOffset, scope }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect",
    description: "Inspect the reflection state machine: trigger status, the pending claim and the step counters; returns the due hint when a reflection is owed. Crossing the step-count threshold raises the claim; `mpd_memory_reflect_complete` settles it.",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "object", properties: { state: { type: "object" }, due: { type: "boolean" } }, required: ["state", "due"] }, render: (_a: unknown, v: any) => textBlock("reflection state: " + JSON.stringify(v.state, null, 1) + (v.due ? "\nREFLECTION DUE" : "")) },
    execute: async (_args: any, exec: any) => {
      /** The agent's state directories, so a status read on a fresh workspace still answers the initial state. */
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec))
      /** The current reflection state, as persisted by the last write or completion. */
      const s = readReflection(d)
      return { state: s, due: s.triggered === true || s.pendingReflection?.due === true }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_reflect_complete",
    description: "Complete the reflection this agent owes: writes the reflection content as a memory entry (kind=reflection), advances reflectionsCompleted, resets stepsSinceReflection, settles the pending claim and commits.",
    parameters: { type: "object", properties: { content: { type: "string" }, title: { type: "string" } }, required: ["content"], additionalProperties: false },
    output: { schema: { type: "object", properties: { completed: { type: "boolean" }, file: { type: "string" } }, required: ["completed", "file"] }, render: (_a: unknown, v: any) => textBlock("reflection completed: " + (v.completed ? "yes" : "no") + " " + v.file) },
    execute: async (args: any, exec: any) => {
      /** The agent's state directories, created on demand so a reflection can complete in a fresh workspace. */
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec))
      /** The reflection state as persisted, and the value this transition mutates when it is legal. */
      const s = readReflection(d)
      // THE PRECONDITION: `mpd_memory_reflect` reports `due` under exactly this predicate. Without it a
      // completion ran with nothing owed: it wrote a reflection entry, bumped
      // `reflectionsCompleted`, zeroed `stepsSinceReflection` and stamped
      // `pendingReflection: {due:false}`, stranding the counters of a machine that never triggered.
      if (s.triggered !== true && s.pendingReflection?.due !== true) {
        // The message renders what the predicate above has already established: `triggered` is exactly
        // false here, so the only distinction left is "a claim exists but is settled" vs "no claim".
        throw new Error("mpd-memory: no reflection is due — refusing to complete (triggered=" + String(s.triggered) + ", pendingReflection=" + (s.pendingReflection?.due === false ? "settled" : "none") + ", stepsSinceReflection=" + String(s.stepsSinceReflection ?? 0) + "); call mpd_memory_reflect to inspect the state machine.")
      }
      ensureVcs(cfg, d)
      /** The reflection entry's file stem: a fixed prefix plus a base-36 timestamp. */
      const name = "reflection-" + Date.now().toString(36)
      /** The reflection entry's absolute path, containment-checked against the memory directory. */
      const file = safeMemoryPath(d.memoryDir, name + ".md")
      /** The reflection entry's frontmatter: the caller's title, or the generic `reflection`. */
      const meta = { description: String(args?.title ?? "reflection"), kind: "reflection" }
      writeFileSync(file, "---\n" + JSON.stringify(meta) + "\n---\n" + String(args?.content) + "\n")
      commitAll(cfg, d, "memory: reflection " + name)
      // The state read at the top of this call, advanced by one completed reflection: the claim is
      // settled and the step counter re-armed for the next threshold.
      s.reflectionsCompleted = (s.reflectionsCompleted ?? 0) + 1
      s.stepsSinceReflection = 0
      s.triggered = false
      s.pendingReflection = { due: false, at: new Date().toISOString() }
      writeReflection(d, s)
      appendJournalLine(d, "reflection", { file: basename(file) })
      return { completed: true, file }
    }
  })

  dsh.registerTool({
    name: "mpd_memory_status",
    description: "Show memory engine status: vcs mode, store root, entry count, journal line count, reflection counters. scope:\"workspace\" (default) reports this agent's store, \"global\" the shared ~/.mpd/memory store (whose reflection counters are still the agent's own, because reflection is workspace-scoped).",
    parameters: { type: "object", properties: { scope: { type: "string", enum: ["workspace", "global"], description: "Which store to report; workspace is the default." } } },
    output: { schema: { type: "object", properties: { vcs: { type: "string" }, root: { type: "string" }, entries: { type: "integer" }, journalLines: { type: "integer" }, reflection: { type: "object" }, scope: { type: "string" } }, required: ["vcs", "root", "entries"] }, render: (_a: unknown, v: any) => textBlock("memory status: vcs=" + v.vcs + " root=" + v.root + " entries=" + v.entries + " journal=" + v.journalLines + "\nreflection: " + JSON.stringify(v.reflection)), presentationMeta: MEMORY_STATUS_CARD },
    execute: async (args: any, exec: any) => {
      /** The store this call reports; the default workspace keeps every existing caller's meaning. */
      const scope = scopeOf(args)
      // The GLOBAL branch reports the shared store's own counts (COMPUTED, never created — a status
      // read must not bootstrap `~/.mpd/memory`) while the reflection machine stays the AGENT's: it
      // lives on the workspace store, so it is read from there without creating those directories.
      if (scope === "global") {
        /** The global store's computed directories (a status read creates nothing). */
        const g = globalDirs(cfg)
        /** The global entry filenames, counted but not read. */
        const globalFiles = existsSync(g.memoryDir) ? readdirSync(g.memoryDir).filter((f) => f.endsWith(".md")) : []
        /** Non-empty global journal lines; a missing journal counts as zero. */
        const globalJournalLines = existsSync(journalPath(g)) ? readFileSync(journalPath(g), "utf8").split("\n").filter(Boolean).length : 0
        /** The agent's own reflection state, read from the workspace paths without creating them. */
        const reflection = readReflection(agentPaths(cfg, dsh.workspaceRoot(exec)))
        return { vcs: cfg.vcs ?? "git", root: g.root, entries: globalFiles.length, journalLines: globalJournalLines, reflection, scope }
      }
      /** The agent's state directories; a fresh workspace reports zero entries rather than failing. */
      const d = ensureDirs(cfg, dsh.workspaceRoot(exec))
      /** The entry filenames in the memory directory, counted but not read. */
      const files = existsSync(d.memoryDir) ? readdirSync(d.memoryDir).filter((f) => f.endsWith(".md")) : []
      /** Non-empty journal lines, i.e. the number of recorded effects; a missing journal counts as zero. */
      const journalLines = existsSync(journalPath(d)) ? readFileSync(journalPath(d), "utf8").split("\n").filter(Boolean).length : 0
      return { vcs: cfg.vcs ?? "git", root: d.root, entries: files.length, journalLines, reflection: readReflection(d), scope }
    }
  })

  // ── the project-archive hook (wave W3-D, decision D6) ───────────────────────────────────────────
  // ONE observer on the post-execute waterfall. When a project closes, it records a deterministic
  // digest in the GLOBAL store; it never edits a tool result and never throws. The adapter contains a
  // throwing listener, but the post-listener contract is not documented by the adapter, so this row
  // contains itself too (one log line, `undefined` always).
  disposers.push(installArchiveHook(dsh, archiveContext))
  // Release the listener with the row. A no-op disposer (a composition with no event bus) is harmless.
  if (typeof ctx?.on === "function") ctx.on("dispose", () => { for (const dispose of disposers) { try { dispose() } catch { /* already gone */ } } })
}
