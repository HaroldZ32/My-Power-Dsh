// The DURABLE, VERSIONED one-time initialization marker (contract §5 + amendment 2 §1): every
// workspace records `<ws>/.mpd/model-config-seed.json` carrying `{"version": 2}` and is NEVER
// initialized again once that marker exists. The CONTENT matters, not mere presence: v0.15.4/v0.15.5
// already shipped an UNVERSIONED marker, so a returning workspace whose config still holds
// `teamModels.slotN` must still be migrated instead of being stranded with eleven unconfigured
// agents. Priority inside one run: agentRoutes declared anywhere => upgrade the marker only;
// else teamModels present => materialize eleven entries; else seed eleven from the catalog.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  apply,
  SEED_MARKER_FILE,
  SEED_MARKER_VERSION,
  seedAgentRoutesOnce,
  seedMarkerFor,
  seedMarkerVersionOf,
  stripJsonc,
} from "../src/index"
import { ROSTER_AGENT_NAMES } from "../src/settings-schema"

/** Temp paths created by this file's fixtures, drained in `afterEach` so no run leaks state. */
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
  delete process.env.DSH_WORKSPACE_ROOT
})

/** One workspace fixture: the root, its project file and the marker path. */
interface Fixture {
  /** The workspace root, the parent whose `.mpd` directory holds the project file. */
  root: string
  /** The project file the initialization writes (`<root>/.mpd/mpd.jsonc`). */
  file: string
  /** The durable marker the initialization creates (`<root>/.mpd/model-config-seed.json`). */
  marker: string
}

/**
 * Create one throwaway workspace with an empty `.mpd` directory.
 * @returns the workspace paths the arms below write to.
 */
function workspace(): Fixture {
  /** Unique throwaway directory, so two cases can never share one workspace. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-seed-marker-"))
  temps.push(dir)
  /** The workspace subdirectory (the seed never writes at the temp root). */
  const root = join(dir, "ws")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc"), marker: join(root, ".mpd", SEED_MARKER_FILE) }
}

/** A catalog that positively lists one exact `deepseek-flash`. */
const CATALOG = { providers: [{ id: "deepseek-official", models: [{ id: "deepseek-flash" }] }] }

/** The eleven entries a catalog seed writes: `deepseek-flash`, slot-1 group `max`, the rest `high`. */
function seededEntries(): Record<string, { provider: string; model: string; reasoningEffort: string }> {
  /** The entries, keyed by the roster's own display names. */
  const entries: Record<string, { provider: string; model: string; reasoningEffort: string }> = {}
  for (const agent of ROSTER_AGENT_NAMES) {
    entries[agent] = { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: agent === "Architect" || agent === "Planner" || agent === "Reviewer" || agent === "Lead" || agent === "Senior Engineer" ? "max" : "high" }
  }
  return entries
}

describe("seedMarkerFor / SEED_MARKER_VERSION — the durable marker's path and schema version", () => {
  test("it lives beside the project file's directory, named model-config-seed.json, at version 2", () => {
    expect(SEED_MARKER_FILE).toBe("model-config-seed.json")
    expect(SEED_MARKER_VERSION).toBe(2)
    expect(seedMarkerFor("/x/ws")).toBe("/x/ws/.mpd/model-config-seed.json")
  })
})

describe("seedAgentRoutesOnce — the versioned one-time protocol (amendment 2 §1)", () => {
  test("a version-2 MARKER wins first: nothing is re-seeded, nothing rewritten", () => {
    /** A workspace initialized once: the v2 marker exists, the block does not. */
    const { file, marker } = workspace()
    writeFileSync(file, `{\n  "ulw": { "maxRounds": 3 }\n}\n`)
    writeFileSync(marker, `{\n  "version": 2,\n  "source": "catalog"\n}\n`)
    /** The file's bytes before the attempt, compared after it. */
    const before = readFileSync(file, "utf8")
    /** The marker's bytes before the attempt, proving it is never rewritten. */
    const markerBefore = readFileSync(marker, "utf8")
    // The user deleted the block deliberately; the seed must respect that, catalog or no catalog.
    expect(seedAgentRoutesOnce(file, marker, CATALOG)).toEqual({ status: "marked" })
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(readFileSync(marker, "utf8")).toBe(markerBefore)
  })

  test("PRIORITY 1: agentRoutes declared in any layer => upgrade the MARKER only, never the file", () => {
    /** A workspace explicitly configured by its owner, with a v1 (unversioned) marker. */
    const { file, marker } = workspace()
    /** The user's own bytes, which the upgrade must not touch. */
    const original = `{\n  "agentRoutes": { "Architect": { "provider": "p", "model": "m" } }\n}\n`
    writeFileSync(file, original)
    writeFileSync(marker, `{\n  "seededAt": "2026-10-20T00:00:00.000Z"\n}\n`)
    expect(seedAgentRoutesOnce(file, marker, CATALOG, { agentRoutesDeclared: true })).toEqual({ status: "upgraded" })
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
  })

  test("PRIORITY 2: a legacy teamModels block is MATERIALIZED into eleven entries, then marked v2", () => {
    /** A fresh workspace whose config declares one legacy group route. */
    const { file, marker } = workspace()
    expect(seedAgentRoutesOnce(file, marker, undefined, {
      legacyTeamModels: { slot1: { provider: "heavy-p", model: "heavy-m", reasoningEffort: "max" }, slot2: { provider: "b", model: "bm", fallbacks: [{ provider: "fb", model: "fm" }] } },
    })).toEqual({ status: "migrated", entries: 11 })
    /** The written document, parsed for the assertions below. */
    const written = JSON.parse(stripJsonc(readFileSync(file, "utf8")))
    // ALL eleven entries, and NO teamModels block written by this bundle.
    expect(Object.keys(written.agentRoutes)).toEqual([...ROSTER_AGENT_NAMES])
    expect(written.teamModels).toBeUndefined()
    expect(written.agentRoutes.Architect).toEqual({ provider: "heavy-p", model: "heavy-m", reasoningEffort: "max" })
    expect(written.agentRoutes.Researcher).toEqual({ provider: "b", model: "bm", fallbacks: [{ provider: "fb", model: "fm" }] })
    // The groups the legacy block never declares get an EMPTY entry (declared, still unconfigured).
    expect(written.agentRoutes["Deep Worker"]).toEqual({})
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    /** The bytes the migration wrote, compared after the second run. */
    const afterFirst = readFileSync(file, "utf8")
    expect(seedAgentRoutesOnce(file, marker, CATALOG)).toEqual({ status: "marked" })
    expect(readFileSync(file, "utf8")).toBe(afterFirst)
  })

  test("THE v0.15.x STRANDING CASE: an UNVERSIONED marker does NOT block the migration", () => {
    /** A workspace that booted v0.15.5: the marker exists WITHOUT a version, the config has slots. */
    const { file, marker } = workspace()
    writeFileSync(marker, `{\n  "seededAt": "2026-10-24T00:00:00.000Z",\n  "provider": "deepseek-official",\n  "model": "deepseek-flash"\n}\n`)
    writeFileSync(file, `{\n  "teamModels": { "slot1": { "provider": "slot-p", "model": "slot-m" } }\n}\n`)
    // The marker cannot prove a version, so the run STILL owes an attempt: the legacy block migrates.
    expect(seedMarkerVersionOf(marker)).toBeUndefined()
    expect(seedAgentRoutesOnce(file, marker, undefined, { legacyTeamModels: { slot1: { provider: "slot-p", model: "slot-m" } } }))
      .toEqual({ status: "migrated", entries: 11 })
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).agentRoutes.Architect).toEqual({ provider: "slot-p", model: "slot-m" })
    // The marker is UPGRADED in place to version 2 — the returned workspace is not stranded.
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
  })

  test("an UNPARSABLE marker is treated as ABSENT: the migration still runs once and writes v2", () => {
    /** A workspace whose marker file was corrupted, while the config still holds the legacy block. */
    const { file, marker } = workspace()
    writeFileSync(marker, `not-json-at-all`)
    writeFileSync(file, `{\n  "teamModels": { "slot4": { "provider": "vision-p", "model": "vision-m" } }\n}\n`)
    // A marker that cannot prove a version must never block the run (amendment 2 §1).
    expect(seedMarkerVersionOf(marker)).toBeUndefined()
    expect(seedAgentRoutesOnce(file, marker, undefined, { legacyTeamModels: { slot4: { provider: "vision-p", model: "vision-m" } } }))
      .toEqual({ status: "migrated", entries: 11 })
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).agentRoutes["Vision Analyst"]).toEqual({ provider: "vision-p", model: "vision-m" })
    // The corrupt marker is REPLACED by a parseable version-2 record, so the run is not repeated.
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    expect(seedAgentRoutesOnce(file, marker, CATALOG)).toEqual({ status: "marked" })
  })

  test("PRIORITY 3: a fresh workspace seeds eleven entries from the catalog and marks v2", () => {
    /** A fresh, unconfigured workspace. */
    const { file, marker } = workspace()
    expect(seedAgentRoutesOnce(file, marker, CATALOG)).toEqual({
      status: "seeded",
      route: { provider: "deepseek-official", model: "deepseek-flash" },
      entries: 11,
    })
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8")))).toEqual({ agentRoutes: seededEntries() })
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
  })

  test("an UNAVAILABLE catalog writes NEITHER entries NOR a marker, so a later attempt can still seed", () => {
    /** A fresh workspace whose catalog offers no flash-family model. */
    const { file, marker } = workspace()
    expect(seedAgentRoutesOnce(file, marker, { providers: [] })).toMatchObject({ status: "no-catalog" })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
    // The same with NO catalog at all (a missing seam).
    expect(seedAgentRoutesOnce(file, marker, undefined)).toMatchObject({ status: "no-catalog" })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
  })

  test("an unparsable project file is refused untouched and unmarked", () => {
    /** A workspace whose file no JSONC reader accepts. */
    const { file, marker } = workspace()
    /** The broken bytes that must survive the attempt verbatim. */
    const broken = `{ "ulw": `
    writeFileSync(file, broken)
    expect(seedAgentRoutesOnce(file, marker, CATALOG)).toMatchObject({ status: "unreadable" })
    expect(readFileSync(file, "utf8")).toBe(broken)
    expect(existsSync(marker)).toBe(false)
  })
})

/** The harness the mount-level arms use: the REAL row over an `llm` service double. */
interface Mounted {
  /** The `mpdConfig` service the row provided. */
  service: any
  /** Every log line the row emitted, in order. */
  logs: string[]
  /** How many times the catalog's `listProviders` was called. */
  catalogReads: () => number
}

/**
 * Mount the config row over a real adapter whose `ctx.llm` answers (or fails) the catalog read.
 *
 * `roots` models the LIVE session registry (`ctx.get("agents")`): the initialization attempts exactly
 * the roots it lists (the exec-less fallback root is never seeded), while `DSH_WORKSPACE_ROOT` only
 * supplies the fallback the row itself resolves.
 * @param root - the fallback workspace root (`DSH_WORKSPACE_ROOT`).
 * @param home - the isolated `DSH_HOME`.
 * @param catalog - the providers the llm double lists, or `"throw"` to make the read reject.
 * @param roots - the LIVE workspace roots; defaults to `[root]`.
 * @param rowConfig - the row config (L4 layer) this mount receives.
 * @returns the service, the captured log lines and the catalog-read counter.
 */
function mount(root: string, home: string, catalog: { id: string; models: string[] }[] | "throw", roots: string[] = [root], rowConfig: Record<string, unknown> = {}): Mounted {
  process.env.DSH_HOME = home
  process.env.DSH_WORKSPACE_ROOT = root
  /** Every tool the row registered. */
  const tools: any[] = []
  /** The service the row provided. */
  let service: any = null
  /** The lines the row logged. */
  const logs: string[] = []
  /** How many catalog reads the double served. */
  let reads = 0
  /** The llm service double the adapter's `llmCatalog()` projects. */
  const llm = {
    listProviders: async () => {
      reads += 1
      if (catalog === "throw") throw new Error("catalog down")
      return catalog.map((p) => ({ id: p.id }))
    },
    listModels: async (provider: string) => (catalog === "throw" ? [] : (catalog.find((p) => p.id === provider)?.models ?? []).map((id) => ({ id }))),
    resolveModelInfo: async (_provider: string, model: string) => ({ id: model, reasoning: { efforts: [{ id: "max" }, { id: "high" }] } }),
  }
  /** The live-session registry double the adapter reads its workspace roots from. */
  const agents = { list: (): unknown[] => roots.map((cwd) => ({ session: { header: { cwd } } })) }
  /** The permissive cordis ctx: tools, the llm service, the live roots and the logger. */
  const ctx: any = {
    tools: { register: (t: any): void => { tools.push(t) } },
    provide: (_n: string, v: any): void => { service = v },
    get: (n: string): unknown => (n === "llm" ? llm : n === "agents" ? agents : undefined),
    logger: { warn: (message: string): void => { logs.push(String(message)) } },
  }
  apply(ctx, rowConfig as Parameters<typeof apply>[1])
  return { service, logs, catalogReads: () => reads }
}

/** Wait for the fire-and-forget initialization attempt to settle (it awaits one catalog read). */
async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("the mounted row: ONE log line per root, and the version-2 marker beats the file state", () => {
  test("a fresh workspace initializes ONCE: one line, eleven entries, a v2 marker, no second run", async () => {
    /** A fresh workspace plus an isolated home. */
    const { root, file, marker } = workspace()
    /** The home dir the row resolves its user layer under. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose llm double lists an exact deepseek-flash. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    /** The seed lines the row emitted. */
    const seedLines = (): string[] => h.logs.filter((line) => line.includes("seeded"))
    expect(seedLines()).toHaveLength(1)
    expect(seedLines()[0]).toContain(marker)
    expect(existsSync(marker)).toBe(true)
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).agentRoutes["Vision Analyst"]).toBeDefined()
    // A reload re-reads the config; the seed is NOT attempted again (marker) and nothing is logged.
    h.service.reload({ agent: { session: { header: { cwd: root } } } })
    h.service.reload({ agent: { session: { header: { cwd: root } } } })
    await settled()
    expect(seedLines()).toHaveLength(1)
    // A SECOND MOUNT on the same workspace (a redeploy in the same process) is silent too.
    /** A second row over the same workspace, whose catalog would happily seed again. */
    const second = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(second.logs.filter((line) => line.includes("seeded"))).toHaveLength(0)
  })

  test("a DELIBERATE deletion after a seed is never undone by the next mount (a v2 marker)", async () => {
    /** A workspace that gets seeded by the first mount. */
    const { root, file, marker } = workspace()
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(existsSync(marker)).toBe(true)
    // The user deletes the block ON PURPOSE, keeping everything else in the file.
    const deleted = `{\n  "ulw": { "maxRounds": 3 }\n}\n`
    writeFileSync(file, deleted)
    /** The same workspace mounted again: the marker must stop the second seed. */
    const second = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(readFileSync(file, "utf8")).toBe(deleted)
    expect(second.logs.filter((line) => line.includes("seeded"))).toHaveLength(0)
  })

  test("a workspace that already declares agentRoutes spends NO catalog read; its marker is upgraded", async () => {
    /** A workspace configured by the user. */
    const { root, file, marker } = workspace()
    writeFileSync(file, `{\n  "agentRoutes": { "Architect": { "provider": "p", "model": "m" } }\n}\n`)
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose catalog counter is the subject. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(h.logs.filter((line) => line.includes("seeded"))).toHaveLength(0)
    // The marker protocol never even reads the catalog for a configured workspace...
    expect(h.catalogReads()).toBe(0)
    // ...and it still records the version-2 marker (the "only upgrade the marker" priority).
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
  })

  test("a PROJECT-FILE teamModels block MIGRATES at mount: eleven entries, one line naming the legacy source, no catalog", async () => {
    /** A workspace whose project file still holds the retired slot tree. */
    const { root, file, marker } = workspace()
    /** The user's legacy bytes, which must keep their teamModels block untouched. */
    const legacy = `{\n  "teamModels": { "slot1": { "provider": "slot-p", "model": "slot-m", "reasoningEffort": "max" } }\n}\n`
    writeFileSync(file, legacy)
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose catalog must NOT be consulted for a migration. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    /** The migration line the row emitted. */
    const migrated = h.logs.filter((line) => line.includes("migrated the legacy teamModels block"))
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toContain(file)
    expect(migrated[0]).toContain(marker)
    expect(h.catalogReads()).toBe(0)
    /** The written document: the eleven entries beside the untouched legacy block. */
    const written = JSON.parse(stripJsonc(readFileSync(file, "utf8")))
    expect(Object.keys(written.agentRoutes)).toEqual([...ROSTER_AGENT_NAMES])
    expect(written.agentRoutes.Architect).toEqual({ provider: "slot-p", model: "slot-m", reasoningEffort: "max" })
    // The legacy block is NEVER rewritten by this bundle.
    expect(written.teamModels).toEqual({ slot1: { provider: "slot-p", model: "slot-m", reasoningEffort: "max" } })
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    // The reload after the write means the seeded entries resolve immediately.
    expect(h.service.agentRouteOf("Architect")).toEqual({ provider: "slot-p", model: "slot-m", reasoningEffort: "max" })
  })

  test("a USER-LAYER teamModels block also MIGRATES into the project file (the reversal of the retired arm)", async () => {
    /** A fresh live workspace with no project file. */
    const { root, file, marker } = workspace()
    /** The isolated home whose USER layer declares the legacy block. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The user-layer file whose legacy block the migration must name. */
    const userFile = join(home, "mpd.jsonc")
    writeFileSync(userFile, `{\n  "teamModels": { "slot1": { "provider": "user-p", "model": "user-m" } }\n}\n`)
    /** The mounted row whose live root is the workspace. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    // The EFFECTIVE config declares the legacy block in ANY layer, so it migrates — the old arm
    // asserted the opposite and is deliberately reversed (contract §5 + amendment 2 §1).
    expect(existsSync(file)).toBe(true)
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).agentRoutes.Architect).toEqual({ provider: "user-p", model: "user-m" })
    // The line names the LAYER the block came from.
    const migrated = h.logs.filter((line) => line.includes("migrated the legacy teamModels block"))
    expect(migrated).toHaveLength(1)
    expect(migrated[0]).toContain(userFile)
  })

  test("a ROW-KNOB-LAYER (L4) teamModels declaration migrates too", async () => {
    /** A fresh live workspace with no project file. */
    const { root, file, marker } = workspace()
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose OWN config (L4) declares the legacy block. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }], [root], { teamModels: { slot1: { provider: "row-p", model: "row-m" } } })
    await settled()
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).agentRoutes.Architect).toEqual({ provider: "row-p", model: "row-m" })
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    expect(h.logs.filter((line) => line.includes("the row config"))).toHaveLength(1)
  })

  test("an unavailable catalog writes NOTHING, leaves NO marker, and says so ONCE per root", async () => {
    /** A fresh workspace and an empty home. */
    const { root, file, marker } = workspace()
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose catalog read rejects. */
    const h = mount(root, home, "throw")
    await settled()
    /** The "nothing was written" lines. */
    const unavailable = (): string[] => h.logs.filter((line) => line.includes("nothing was written"))
    expect(unavailable()).toHaveLength(1)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
    // A reload retries (the catalog may mount later) but never repeats the line.
    h.service.reload({ agent: { session: { header: { cwd: root } } } })
    await settled()
    expect(unavailable()).toHaveLength(1)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
  })

  test("an unparsable project file writes nothing and says so once", async () => {
    /** A workspace whose file no JSONC reader accepts. */
    const { root, file, marker } = workspace()
    /** The broken bytes that must survive verbatim. */
    const broken = `{ "ulw": `
    writeFileSync(file, broken)
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose project file cannot be parsed. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(readFileSync(file, "utf8")).toBe(broken)
    expect(existsSync(marker)).toBe(false)
    expect(h.logs.filter((line) => line.includes("does not parse"))).toHaveLength(1)
    expect(h.catalogReads()).toBe(0)
  })
})

describe("the initialization is PER ROOT and reloads its own write", () => {
  test("TWO live roots get their own file, marker and line — one shared catalog read", async () => {
    /** The first live workspace. */
    const a = workspace()
    /** The second live workspace, fully independent of the first. */
    const b = workspace()
    /** One isolated home shared by both roots (the user layer is process-wide by design). */
    const home = join(a.root, "..", "home")
    mkdirSync(home, { recursive: true })
    // The fallback root is A, and the registry lists BOTH: both must be initialized, neither twice.
    /** The mounted row over the two live roots. */
    const h = mount(a.root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }], [a.root, b.root])
    await settled()
    for (const fixture of [a, b]) {
      expect(existsSync(fixture.file)).toBe(true)
      expect(seedMarkerVersionOf(fixture.marker)).toBe(SEED_MARKER_VERSION)
      expect(JSON.parse(stripJsonc(readFileSync(fixture.file, "utf8"))).agentRoutes.Researcher).toBeDefined()
    }
    // ONE line per root, and the batch paid for exactly ONE catalog read.
    /** The seed lines the row emitted. */
    const seedLines = (): string[] => h.logs.filter((line) => line.includes("seeded"))
    expect(seedLines()).toHaveLength(2)
    expect(seedLines()[0]).toContain(a.marker)
    expect(seedLines()[1]).toContain(b.marker)
    expect(h.catalogReads()).toBe(1)
  })

  test("the exec-less FALLBACK root is never seeded; with NO live root the first reload seeds", async () => {
    /** The fallback root: what the row resolves with no exec, and what must stay untouched. */
    const fallback = workspace()
    /** One isolated home. */
    const home = join(fallback.root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose registry is EMPTY. */
    const h = mount(fallback.root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }], [])
    await settled()
    // A process started outside a workspace must never write `<cwd>/.mpd/mpd.jsonc`.
    expect(existsSync(fallback.file)).toBe(false)
    expect(existsSync(fallback.marker)).toBe(false)
    expect(h.catalogReads()).toBe(0)
    // The first session's reload performs the ONE attempt for that root.
    h.service.reload({ agent: { session: { header: { cwd: fallback.root } } } })
    await settled()
    expect(existsSync(fallback.file)).toBe(true)
    expect(seedMarkerVersionOf(fallback.marker)).toBe(SEED_MARKER_VERSION)
    expect(h.logs.filter((line) => line.includes("seeded"))).toHaveLength(1)
  })

  test("the seeded entries RESOLVE without an explicit reload (the write reloads its root)", async () => {
    /** A bare workspace with NO `.mpd` directory: the mount read and the watcher both see nothing. */
    const dir = mkdtempSync(join(tmpdir(), "mpd-seed-noreload-"))
    temps.push(dir)
    /** The live workspace root, created WITHOUT `.mpd`. */
    const root = join(dir, "ws")
    mkdirSync(root, { recursive: true })
    /** The project file the initialization must create. */
    const file = join(root, ".mpd", "mpd.jsonc")
    /** The marker it must create beside it. */
    const marker = join(root, ".mpd", SEED_MARKER_FILE)
    /** The isolated home. */
    const home = join(dir, "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose live root is this bare workspace. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(existsSync(file)).toBe(true)
    expect(seedMarkerVersionOf(marker)).toBe(SEED_MARKER_VERSION)
    // THE POINT: the row's own resolved state is NOT one generation behind — no reload call here.
    expect(h.service.agentRouteResolutionOf("Architect")).toMatchObject({ ok: true, route: { provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" } })
    expect(h.service.agentRouteOf("Vision Analyst")).toEqual({ provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "high" })
  })
})
