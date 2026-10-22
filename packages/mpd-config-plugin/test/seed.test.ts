// The ONE-TIME file seed of the team-model slots (contract `.mpd/plans/slot-single-source.md` §10):
// "Initial config is FILE initialization, not a runtime default". The seed runs ONCE per workspace
// from the user's OWN configured providers (read through the live LLM catalog), writes nothing when
// the catalog is unavailable, and never rewrites an existing block or a user edit.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildSeedBlock, chooseSeedRoute, seedTeamModelsFile, stripJsonc } from "../src/index"

/** Temp paths created by this file's fixtures, drained in `afterEach` so no run leaks state. */
const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * Create one throwaway directory holding a project file path (the file itself is NOT created).
 * @returns the directory and the project-file path inside it.
 */
function fixture(): { dir: string; file: string } {
  /** Unique throwaway directory, so two cases can never share one file. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-slot-seed-"))
  temps.push(dir)
  // The `.mpd` directory the project file lives in; the FILE itself stays absent until a seed writes it.
  mkdirSync(join(dir, ".mpd"), { recursive: true })
  return { dir, file: join(dir, ".mpd", "mpd.jsonc") }
}

describe("chooseSeedRoute — the flash-family model from the LIVE catalog (contract §10)", () => {
  test("an exact `deepseek-flash` listing wins over every looser flash match, and names its provider", () => {
    // Two providers list flash models; the exact id sits on the second one and must still win.
    const catalog = {
      providers: [
        { id: "gateway", models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-flash-vision-exp" }] },
        { id: "deepseek-official", models: [{ id: "deepseek-flash" }] },
      ],
    }
    expect(chooseSeedRoute(catalog)).toEqual({ provider: "deepseek-official", model: "deepseek-flash" })
  })

  test("without an exact id, the first `*flash*` listing is the close match", () => {
    /** A catalog whose only flash-family entry is a LOOSE id, on the second provider. */
    const catalog = {
      providers: [
        { id: "gateway", models: [{ id: "gpt-x" }] },
        { id: "deepseek-official", models: [{ id: "deepseek-v4.1-flash" }] },
      ],
    }
    expect(chooseSeedRoute(catalog)).toEqual({ provider: "deepseek-official", model: "deepseek-v4.1-flash" })
  })

  test("no flash-family model, an empty catalog or no catalog at all yields NOTHING (never a guess)", () => {
    expect(chooseSeedRoute(undefined)).toBeUndefined()
    expect(chooseSeedRoute({})).toBeUndefined()
    expect(chooseSeedRoute({ providers: [] })).toBeUndefined()
    expect(chooseSeedRoute({ providers: [{ id: "gateway", models: [{ id: "gpt-x" }] }] })).toBeUndefined()
    // A malformed provider/model entry is skipped, never used as a route.
    expect(chooseSeedRoute({ providers: [{ id: 7, models: [{ id: "deepseek-flash" }] }, { id: "p", models: [{ id: "" }] }] })).toBeUndefined()
  })
})

describe("buildSeedBlock — one route, slot1 at max and slots 2-4 at high", () => {
  test("the four slots carry the SAME provider/model, with the declared efforts", () => {
    expect(buildSeedBlock({ provider: "p", model: "m" })).toEqual({
      slot1: { provider: "p", model: "m", reasoningEffort: "max" },
      slot2: { provider: "p", model: "m", reasoningEffort: "high" },
      slot3: { provider: "p", model: "m", reasoningEffort: "high" },
      slot4: { provider: "p", model: "m", reasoningEffort: "high" },
    })
  })
})

describe("seedTeamModelsFile — writes once, never rewrites, never loses a byte", () => {
  test("a workspace with NO file gets one, holding the four seeded slots", () => {
    /** Fresh fixture whose project file does not exist yet. */
    const { file } = fixture()
    expect(seedTeamModelsFile(file, { provider: "p", model: "m" })).toEqual({ outcome: "seeded" })
    // The file is valid JSONC and carries the four slots with the declared efforts.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ teamModels: buildSeedBlock({ provider: "p", model: "m" }) })
    // Idempotence: a second seed sees the block and writes NOTHING (byte-identical).
    /** The bytes the first seed wrote, compared after the second call. */
    const afterFirst = readFileSync(file, "utf8")
    expect(seedTeamModelsFile(file, { provider: "p", model: "m" })).toEqual({ outcome: "declared" })
    expect(readFileSync(file, "utf8")).toBe(afterFirst)
  })

  test("an existing file WITHOUT teamModels is seeded in place, every other byte preserved", () => {
    /** Fixture holding a commented, trailing-comma document to prove the splice is surgical. */
    const { file } = fixture()
    /** The human-written bytes the seed must leave untouched (comments included). */
    const original = `{\n  // the user's own knob\n  "ulw": { "maxRounds": 3 },\n}\n`
    writeFileSync(file, original)
    expect(seedTeamModelsFile(file, { provider: "p", model: "m" })).toEqual({ outcome: "seeded" })
    /** The seeded text, which must still carry the user's comment and trailing comma. */
    const text = readFileSync(file, "utf8")
    expect(text).toContain("// the user's own knob")
    expect(text).toContain('"maxRounds": 3 },')
    expect(JSON.parse(stripJsonc(text))).toEqual({ ulw: { maxRounds: 3 }, teamModels: buildSeedBlock({ provider: "p", model: "m" }) })
  })

  test("a file that ALREADY declares teamModels — even partially — is left byte-identical", () => {
    /** Fixture whose block declares ONE leaf, the state the seed must never overwrite. */
    const { file } = fixture()
    /** The exact bytes of a user edit that a second write would destroy. */
    const original = `{\n  "teamModels": { "slot2": { "model": "mine" } }\n}\n`
    writeFileSync(file, original)
    expect(seedTeamModelsFile(file, { provider: "p", model: "m" })).toEqual({ outcome: "declared" })
    expect(readFileSync(file, "utf8")).toBe(original)
    // An EMPTY block is a user edit too: the seed does not interpret it as "unset".
    /** Fixture whose block is explicitly empty. */
    const { file: emptyFile } = fixture()
    /** The exact bytes of the empty-but-declared block. */
    const emptyOriginal = `{\n  "teamModels": {}\n}\n`
    writeFileSync(emptyFile, emptyOriginal)
    expect(seedTeamModelsFile(emptyFile, { provider: "p", model: "m" })).toEqual({ outcome: "declared" })
    expect(readFileSync(emptyFile, "utf8")).toBe(emptyOriginal)
  })

  test("an unparsable file is refused untouched (never repaired by a seed)", () => {
    /** Fixture holding a document no JSONC reader accepts. */
    const { file } = fixture()
    /** The broken bytes that must survive the attempt verbatim. */
    const broken = `{ "ulw": `
    writeFileSync(file, broken)
    /** The refusal, whose outcome is `unreadable` and whose detail names the parse failure. */
    const result = seedTeamModelsFile(file, { provider: "p", model: "m" })
    expect(result.outcome).toBe("unreadable")
    expect(readFileSync(file, "utf8")).toBe(broken)
  })
})
