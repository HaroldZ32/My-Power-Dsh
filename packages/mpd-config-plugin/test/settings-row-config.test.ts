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
    /** The ambient DSH_HOME this case overrides, restored in the finally block below. */
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
    /** The ambient DSH_HOME this case overrides, restored in the finally block below. */
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

describe("boulder.dir — the L4 escape that defeated it", () => {
  /**
   * Resolve `boulder.dir` EXACTLY as a boot does, and report the value `mpdConfig.get` would answer.
   *
   * The chain is the real one, in the real order: the loader applies the row schema (materialising
   * schema defaults into the row options) → `loadConfig` merges the file layers and then the row knobs
   * LAST → `mpdConfig.get(key)` walks the dot path. An arm that called `loadConfig` directly would
   * miss the schema's own defaults, which is precisely the layer that caused the defect.
   * @param rowOptions - the row options a boot would pass (usually `{}`, i.e. nothing configured).
   * @param box - the workspace whose `.mpd/mpd.jsonc` is the project layer.
   * @param settingsSection - the legacy L3 section to apply, when the arm is about a stored form value.
   * @returns the resolved value, or undefined when the key is absent from the resolved config.
   */
  async function resolvedBoulderDir(rowOptions: Record<string, unknown>, box: string, settingsSection?: unknown): Promise<unknown> {
    // The modules are imported INSIDE the arm: `loadConfig` reads DSH_HOME at call time, and
    // `Config` must be the same schema instance the loader would apply.
    const { loadConfig } = await import("../src/index")
    /** The row schema applied to the raw options, which is what the loader hands the plugin. */
    const { Config } = await import("../src/index")
    /** The row options a real boot resolves: schema defaults materialised, nothing user-set. */
    const rowConfig = (Config as unknown as (raw: unknown) => Record<string, unknown>)(rowOptions)
    /** The merged config the service resolves a key against. */
    const state = loadConfig(rowConfig as never, box, settingsSection)
    // The dot-path walk `mpdConfig.get(key)` performs.
    return "boulder" in state.config ? (state.config.boulder as { dir?: unknown }).dir : undefined
  }

  test("UNSET resolves to undefined — not the retired `.mpd` default (the escape is closed)", async () => {
    // MEASURED BEFORE THE FIX: this answered `".mpd"` in every real boot, which both consumers then
    // treated as a state ROOT — producing `<ws>/.mpd/.mpd/boulder.json`.
    /** Sandbox filesystem helpers, imported locally so this case owns its own temp tree. */
    const { mkdtempSync, mkdirSync } = await import("node:fs")
    /** Temp-root helper for this case's sandbox box. */
    const { tmpdir } = await import("node:os")
    /** Path join for the box's `.mpd` directory. */
    const { join } = await import("node:path")
    /** The sandbox workspace whose config is being resolved. */
    const box = mkdtempSync(join(tmpdir(), "mpd-boulder-dir-"))
    mkdirSync(join(box, ".mpd"), { recursive: true })
    /** The ambient DSH_HOME this case overrides, restored in the finally block below. */
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(box, "home")
    try {
      // The schema must not materialise a value: `{}` is the honest answer for "unset".
      expect(await resolvedBoulderDir({}, box)).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  test("a PROJECT file value WINS for the first time — the L4 escape is gone", async () => {
    // MEASURED BEFORE THE FIX: `{"boulder":{"dir":"."}}` in `.mpd/mpd.jsonc` STILL resolved to `.mpd`,
    // because the schema default rode the row-knob layer, which is applied LAST. The row layer now
    // carries the knob only when a user really set it, so the file is the authority it claims to be.
    /** Sandbox filesystem helpers, imported locally so this case owns its own temp tree. */
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs")
    /** Temp-root helper for this case's sandbox box. */
    const { tmpdir } = await import("node:os")
    /** Path join for the box's `.mpd` directory. */
    const { join } = await import("node:path")
    /** The sandbox workspace holding the project file. */
    const box = mkdtempSync(join(tmpdir(), "mpd-boulder-dir-file-"))
    mkdirSync(join(box, ".mpd"), { recursive: true })
    writeFileSync(join(box, ".mpd", "mpd.jsonc"), JSON.stringify({ boulder: { dir: "/srv/boulder-state" } }))
    /** The ambient DSH_HOME this case overrides, restored in the finally block below. */
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(box, "home")
    try {
      expect(await resolvedBoulderDir({}, box)).toBe("/srv/boulder-state")
      // And an explicit ROW value still outranks the file, which is the layer's whole purpose.
      expect(await resolvedBoulderDir({ boulder: { dir: "/row/wins" } }, box)).toBe("/row/wins")
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  test("the schema still DECLARES the knob, so both settings front doors keep rendering it", async () => {
    // The absence of a DEFAULT must not become the absence of the FIELD: a leaf dropped from the
    // schema would silently remove the row from both settings surfaces (the harness lists an entry by
    // its volatile schema node, and the local knob list is derived from the same dict).
    const { Config } = await import("../src/index")
    /** The `boulder` node as the settings form reads it. */
    const node = (Config as any).dict?.boulder
    expect(node).toBeDefined()
    expect(node?.meta?.volatile).toBe(true)
    expect(Object.keys(node?.dict ?? {})).toEqual(["dir"])
    // The descriptor carries NO default, and the assertion reads the WHOLE serialized node rather
    // than a pinned `uid`: a future `.default("…")` on this leaf would reintroduce the defect
    // invisibly, while a schema-uid change is not a defect at all.
    /** The leaf's serialized descriptor, searched for any default rather than a fixed ref index. */
    const serialized = JSON.stringify(node?.dict?.dir?.toJSON?.() ?? {})
    expect(serialized).not.toContain('"default"')
  })
})
