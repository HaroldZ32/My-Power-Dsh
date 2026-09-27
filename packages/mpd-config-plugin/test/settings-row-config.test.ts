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
