// The DURABLE one-time seed marker (contract §10 + the captain's F3): a workspace seeded once
// records `<ws>/.mpd/model-config-seed.json` and is NEVER seeded again — a user who deletes the
// block on purpose keeps it deleted, the marker is never overwritten, and a catalog that cannot
// answer writes neither the block nor the marker (one log line per process).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply, SEED_MARKER_FILE, seedMarkerFor, seedTeamModelsOnce, stripJsonc } from "../src/index"

/** Temp paths created by this file's fixtures, drained in `afterEach` so no run leaks state. */
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
  delete process.env.DSH_WORKSPACE_ROOT
})

/** One workspace fixture: the root, its project file and the marker path. */
interface Fixture {
  /** The workspace root. */
  root: string
  /** The project file the seed writes (`<root>/.mpd/mpd.jsonc`). */
  file: string
  /** The durable marker the seed creates (`<root>/.mpd/model-config-seed.json`). */
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

describe("seedMarkerFor — the durable marker's path", () => {
  test("it lives beside the project file's directory, named model-config-seed.json", () => {
    expect(SEED_MARKER_FILE).toBe("model-config-seed.json")
    expect(seedMarkerFor("/x/ws")).toBe("/x/ws/.mpd/model-config-seed.json")
  })
})

describe("seedTeamModelsOnce — the four durable-seed properties (F3)", () => {
  test("PROPERTY 1: a workspace that already DECLARES the block is never seeded and gets no marker", () => {
    /** A workspace whose file already carries a user-configured block. */
    const { file, marker } = workspace()
    /** The exact bytes the attempt must leave untouched. */
    const original = `{\n  "teamModels": { "slot2": { "model": "mine" } }\n}\n`
    writeFileSync(file, original)
    // A usable catalog is offered and STILL nothing happens: the declared block is the first guard.
    expect(seedTeamModelsOnce(file, marker, CATALOG)).toEqual({ status: "declared" })
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(existsSync(marker)).toBe(false)
  })

  test("PROPERTY 2: a MARKED workspace whose block was deleted on purpose is never re-seeded", () => {
    /** A workspace seeded once: the marker exists, the block does not. */
    const { file, marker } = workspace()
    writeFileSync(file, `{\n  "ulw": { "maxRounds": 3 }\n}\n`)
    writeFileSync(marker, `{\n  "seededAt": "2026-10-22T00:00:00.000Z",\n  "provider": "p",\n  "model": "m"\n}\n`)
    /** The file's bytes before the attempt, compared after it. */
    const before = readFileSync(file, "utf8")
    /** The marker's bytes before the attempt, proving it is never overwritten. */
    const markerBefore = readFileSync(marker, "utf8")
    // The user deleted the block deliberately; the seed must respect that, catalog or no catalog.
    expect(seedTeamModelsOnce(file, marker, CATALOG)).toEqual({ status: "marked" })
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(readFileSync(marker, "utf8")).toBe(markerBefore)
  })

  test("PROPERTY 3: a successful seed writes the block AND creates the marker with `wx`, once", () => {
    /** A fresh, unconfigured workspace. */
    const { file, marker } = workspace()
    // The first attempt seeds and marks.
    expect(seedTeamModelsOnce(file, marker, CATALOG)).toMatchObject({ status: "seeded", route: { provider: "deepseek-official", model: "deepseek-flash" } })
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).teamModels.slot1).toMatchObject({ provider: "deepseek-official", model: "deepseek-flash", reasoningEffort: "max" })
    expect(existsSync(marker)).toBe(true)
    /** The marker's own record of the seeded route. */
    const recorded = JSON.parse(readFileSync(marker, "utf8"))
    expect(recorded).toMatchObject({ provider: "deepseek-official", model: "deepseek-flash" })
    expect(typeof recorded.seededAt).toBe("string")
    // The second attempt is a no-op: the marker wins, and it is never overwritten.
    /** The marker's bytes after the first seed. */
    const markerBytes = readFileSync(marker, "utf8")
    expect(seedTeamModelsOnce(file, marker, CATALOG)).toEqual({ status: "marked" })
    expect(readFileSync(marker, "utf8")).toBe(markerBytes)
  })

  test("PROPERTY 4: an unavailable catalog writes NEITHER the block NOR the marker", () => {
    /** A fresh workspace whose catalog offers no flash-family model. */
    const { file, marker } = workspace()
    expect(seedTeamModelsOnce(file, marker, { providers: [] })).toMatchObject({ status: "no-catalog" })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
    // The same with NO catalog at all (a missing seam).
    expect(seedTeamModelsOnce(file, marker, undefined)).toMatchObject({ status: "no-catalog" })
    expect(existsSync(file)).toBe(false)
    expect(existsSync(marker)).toBe(false)
  })

  test("an unparsable file is refused untouched and unmarked", () => {
    /** A workspace whose file no JSONC reader accepts. */
    const { file, marker } = workspace()
    /** The broken bytes that must survive verbatim. */
    const broken = `{ "ulw": `
    writeFileSync(file, broken)
    expect(seedTeamModelsOnce(file, marker, CATALOG)).toMatchObject({ status: "unreadable" })
    expect(readFileSync(file, "utf8")).toBe(broken)
    expect(existsSync(marker)).toBe(false)
  })
})

/** The harness the mount-level arms use: the REAL row over an `llm` service double. */
interface Mounted {
  /** The `mpdConfig` service the row provided. */
  service: any
  /** Every `logger.warn` line the row emitted, in order. */
  logs: string[]
  /** How many times the catalog's `listProviders` was called. */
  catalogReads: () => number
}

/**
 * Mount the config row over a real adapter whose `ctx.llm` answers (or fails) the catalog read.
 * @param root - the workspace root the row resolves.
 * @param home - the isolated `DSH_HOME`.
 * @param catalog - the providers the llm double lists, or `"throw"` to make the read reject.
 * @returns the service, the captured log lines and the catalog-read counter.
 */
function mount(root: string, home: string, catalog: { id: string; models: string[] }[] | "throw"): Mounted {
  process.env.DSH_HOME = home
  process.env.DSH_WORKSPACE_ROOT = root
  /** Every tool the row registered. */
  const tools: any[] = []
  /** The service the row provided. */
  let service: any = null
  /** The lines the row logged through `ctx.logger.warn`. */
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
  /** The permissive cordis ctx: tools, the llm service and the logger the row writes through. */
  const ctx: any = {
    tools: { register: (t: any): void => { tools.push(t) } },
    provide: (_n: string, v: any): void => { service = v },
    get: (n: string): unknown => (n === "llm" ? llm : undefined),
    logger: { warn: (message: string): void => { logs.push(String(message)) } },
  }
  apply(ctx, {})
  return { service, logs, catalogReads: () => reads }
}

/** Wait for the fire-and-forget seed attempt to settle (it awaits one catalog read). */
async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("the mounted row: ONE log line per process, and the marker beats the file state", () => {
  test("a fresh workspace seeds ONCE: exactly one seed line, a marker, and no second seed on reload", async () => {
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
    expect(JSON.parse(stripJsonc(readFileSync(file, "utf8"))).teamModels.slot4).toBeDefined()
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

  test("a DELIBERATE deletion after a seed is never undone by the next mount (F3)", async () => {
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
    /** The second mount, which must leave the user's deletion alone. */
    const second = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(readFileSync(file, "utf8")).toBe(deleted)
    expect(second.logs.filter((line) => line.includes("seeded"))).toHaveLength(0)
  })

  test("a workspace that already declares the block never spends a catalog read", async () => {
    /** A workspace configured by the user. */
    const { root, file } = workspace()
    writeFileSync(file, `{\n  "teamModels": { "slot1": { "provider": "p", "model": "m" } }\n}\n`)
    /** The isolated home. */
    const home = join(root, "..", "home")
    mkdirSync(home, { recursive: true })
    /** The mounted row whose catalog counter is the subject. */
    const h = mount(root, home, [{ id: "deepseek-official", models: ["deepseek-flash"] }])
    await settled()
    expect(h.logs.filter((line) => line.includes("seeded"))).toHaveLength(0)
    // The marker protocol never even reads the catalog for a configured workspace.
    expect(h.catalogReads()).toBe(0)
  })

  test("an unavailable catalog writes NOTHING, leaves NO marker, and says so ONCE per process", async () => {
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
})
