// The row Config is what makes the mpd knobs editable in BOTH settings front doors, and the flag it
// depends on is easy to get wrong in a way nothing else notices.
//
// MEASURED (2026-09-27, real boot in docker/ui): with the flag missing, `settings.describe()` listed
// 18 entries — all harness-owned — and `include:mpd-config` was NOT among them, while the row itself
// was active (fiber state 2) and `runtime.Config` was present. The cause was a guard: a schemastery
// node is a FUNCTION (`Schema.prototype = Object.create(Function.prototype)`), so a `typeof !==
// "object"` check returned early for every node and marked nothing.
import { describe, expect, test } from "bun:test"
import { Config } from "../src/index"
import { markVolatile } from "../src/settings-schema"

describe("the row Config", () => {
  test("it marks EVERY node volatile, including the ones a function-blind walk would skip", () => {
    markVolatile(Config)
    // `Config` viewed as the raw schemastery node tree the marking walk mutates in place.
    const schema = Config as unknown as { meta?: { volatile?: boolean }; dict?: Record<string, { meta?: { volatile?: boolean } }> }
    expect(schema.meta?.volatile).toBe(true)
    for (const key of ["hashline", "commentChecker", "ulw", "memory", "team", "boulder", "teamModels", "watchdog"]) {
      expect(schema.dict?.[key]?.meta?.volatile).toBe(true)
    }
    // the nested slot leaves too: the settings form reaches them through `dict`
    expect((schema.dict?.teamModels as any)?.dict?.slot1?.meta?.volatile).toBe(true)
  })

  test("it is a schema the loader accepts: toJSON, and the standard-schema validator", () => {
    expect(typeof (Config as any).toJSON).toBe("function")
    expect((Config as any)["~standard"]).toBeDefined()
    // the file-path keys the plugin already read stay declared
    const keys = Object.keys((Config as any).dict ?? {})
    for (const key of ["projectFile", "userFile", "writeBack", "settingsBridge"]) expect(keys).toContain(key)
  })

  test("the marking is IDEMPOTENT — apply() re-marks the same tree on every boot", () => {
    markVolatile(Config)
    markVolatile(Config)
    expect((Config as any).meta?.volatile).toBe(true)
    expect((Config as any).dict?.hashline?.meta?.volatile).toBe(true)
  })
})

describe("the row config is an EFFECTIVE layer", () => {
  test("a knob edited in Settings reaches the plugins, and outranks the files", async () => {
    // The form writes the ROW CONFIG. Without this layer an edit would render, accept, and change
    // NOTHING — the worst of the three outcomes, because it looks like it worked.
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs")
    // Sandbox helpers imported inside the case that owns the temp tree, not at module scope.
    const { tmpdir } = await import("node:os")
    // Path join for the box's `.mpd` directory and for its home twin.
    const { join } = await import("node:path")
    // The workspace box: the only root this config load is allowed to see.
    const box = mkdtempSync(join(tmpdir(), "mpd-row-layer-"))
    mkdirSync(join(box, ".mpd"), { recursive: true })
    writeFileSync(join(box, ".mpd", "mpd.jsonc"), JSON.stringify({ ulw: { maxRounds: 4 }, watchdog: { enabled: false, warnStreakToEscalate: 9 } }))
    // The ambient DSH_HOME this case overrides, restored in the finally block below.
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(box, "home")
    try {
      // Imported only after DSH_HOME points at the sandbox, so a module-scope read cannot see the caller's.
      const { loadConfig } = await import("../src/index")
      // The resolved config: the row layer's knob on top of the file's untouched siblings.
      const out = loadConfig({ ulw: { maxRounds: 7 } } as never, box)
      // the row layer WINS over the file for the knob it carries...
      expect(out.config.ulw.maxRounds).toBe(7)
      // ...and touches nothing it does not carry
      expect(out.config.watchdog.enabled).toBe(false)
      expect(out.config.watchdog.warnStreakToEscalate).toBe(9)
      expect(out.files.some((file: string) => file.endsWith("mpd.jsonc"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  test("the ROUTING keys never leak into the effective config", async () => {
    // Sandbox filesystem helpers, imported locally so this case owns its own temp tree.
    const { mkdtempSync, mkdirSync } = await import("node:fs")
    // Temp-root helper for this case's sandbox box.
    const { tmpdir } = await import("node:os")
    // Path join for the box's `.mpd` directory.
    const { join } = await import("node:path")
    // The workspace box whose project file the row config below names explicitly.
    const box = mkdtempSync(join(tmpdir(), "mpd-row-routing-"))
    mkdirSync(join(box, ".mpd"), { recursive: true })
    // The ambient DSH_HOME this case overrides, restored in the finally block below.
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(box, "home")
    try {
      // Loaded here, after DSH_HOME is redirected, so the module cannot resolve the caller's home.
      const { loadConfig } = await import("../src/index")
      // A load whose row config carries ONLY routing keys — none may reach the effective config.
      const out = loadConfig({ projectFile: join(box, ".mpd", "mpd.jsonc"), userFile: join(box, "u.jsonc"), writeBack: false, settingsBridge: { writeBack: false } } as never, box)
      for (const key of ["projectFile", "userFile", "writeBack", "settingsBridge"]) expect(out.config[key]).toBeUndefined()
      expect(out.config.ulw).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
