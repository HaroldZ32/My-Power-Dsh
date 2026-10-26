// The ONE-TIME file initialization of the per-agent routes (contract `.mpd/plans/agent-routes-per-agent.md`
// §5): "Initial config is FILE initialization, not a runtime default". The seed runs ONCE per workspace
// from the user's OWN configured providers (read through the live LLM catalog), writes NOTHING to
// `teamModels` any more, and never rewrites an existing `agentRoutes` block or a user edit.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  agentRouteEntriesFromTeamModels,
  buildAgentRoutesSeedBlock,
  chooseSeedRoute,
  hasLegacyTeamModels,
  seedAgentRoutesFile,
  stripJsonc,
} from "../src/index"
import { ROSTER_AGENT_NAMES } from "../src/settings-schema"

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
  const dir = mkdtempSync(join(tmpdir(), "mpd-agent-route-seed-"))
  temps.push(dir)
  // The `.mpd` directory the project file lives in; the FILE itself stays absent until a seed writes it.
  mkdirSync(join(dir, ".mpd"), { recursive: true })
  return { dir, file: join(dir, ".mpd", "mpd.jsonc") }
}

describe("chooseSeedRoute — the flash-family model from the LIVE catalog (contract §5)", () => {
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

describe("buildAgentRoutesSeedBlock — ONE route for all eleven agents, slot-1 group at max and the rest at high", () => {
  test("every roster agent gets an entry; the effort split follows the display groups", () => {
    /** The eleven entries one catalog route seeds. */
    const block = buildAgentRoutesSeedBlock({ provider: "p", model: "m" })
    // EXACTLY the eleven roster names — no slot object, no free-typed key.
    expect(Object.keys(block)).toEqual([...ROSTER_AGENT_NAMES])
    expect(block.Architect).toEqual({ provider: "p", model: "m", reasoningEffort: "max" })
    expect(block["Senior Engineer"]).toEqual({ provider: "p", model: "m", reasoningEffort: "max" })
    expect(block.Researcher).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
    expect(block["Deep Worker"]).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
    expect(block["Vision Analyst"]).toEqual({ provider: "p", model: "m", reasoningEffort: "high" })
  })
})

describe("agentRouteEntriesFromTeamModels — the legacy block materialized (contract §5)", () => {
  test("each agent inherits its group's route: provider/model/effort and the group's own fallbacks", () => {
    /** The eleven entries the legacy block materializes. */
    const entries = agentRouteEntriesFromTeamModels({
      slot1: { provider: "heavy-p", model: "heavy-m", reasoningEffort: "max", fallbacks: [{ provider: "bp", model: "bm" }] },
      slot4: { provider: "vision-p", model: "vision-m" },
    })
    // ALL eleven members are materialized, in the roster's own order.
    expect(Object.keys(entries)).toEqual([...ROSTER_AGENT_NAMES])
    expect(entries.Architect).toEqual({ provider: "heavy-p", model: "heavy-m", reasoningEffort: "max", fallbacks: [{ provider: "bp", model: "bm" }] })
    expect(entries["Vision Analyst"]).toEqual({ provider: "vision-p", model: "vision-m" })
    // A group the legacy block never declares contributes NO leaf (an empty entry, not a default).
    expect(entries.Researcher).toEqual({})
    expect(entries["Deep Worker"]).toEqual({})
  })

  test("a malformed legacy leaf is skipped, never copied as junk", () => {
    /** The eleven entries the legacy block materializes. */
    const entries = agentRouteEntriesFromTeamModels({ slot2: { provider: 7, model: "m", reasoningEffort: "low", fallbacks: "nope" } })
    expect(entries.Researcher).toEqual({ model: "m", reasoningEffort: "low" })
    expect(entries.Explorer).toEqual({ model: "m", reasoningEffort: "low" })
    expect(entries["Plan Reviewer"]).toEqual({ model: "m", reasoningEffort: "low" })
  })

  test("`hasLegacyTeamModels` triggers on at least ONE declared slot, never on an absent/empty block", () => {
    expect(hasLegacyTeamModels(undefined)).toBe(false)
    expect(hasLegacyTeamModels(null)).toBe(false)
    expect(hasLegacyTeamModels({})).toBe(false)
    expect(hasLegacyTeamModels({ slot1: {} })).toBe(true)
    expect(hasLegacyTeamModels({ slot4: { provider: "p", model: "m" } })).toBe(true)
  })
})

describe("seedAgentRoutesFile — writes once, never rewrites, never loses a byte", () => {
  test("a workspace with NO file gets one, holding the eleven seeded entries", () => {
    /** Fresh fixture whose project file does not exist yet. */
    const { file } = fixture()
    /** The eleven entries this case writes and compares. */
    const entries = buildAgentRoutesSeedBlock({ provider: "p", model: "m" })
    expect(seedAgentRoutesFile(file, entries)).toEqual({ outcome: "seeded" })
    // The file is valid JSONC and carries the agentRoutes table with the declared efforts.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ agentRoutes: entries })
    expect(JSON.parse(readFileSync(file, "utf8")).teamModels).toBeUndefined()
    // Idempotence: a second seed sees the block and writes NOTHING (byte-identical).
    /** The bytes the first seed wrote, compared after the second call. */
    const afterFirst = readFileSync(file, "utf8")
    expect(seedAgentRoutesFile(file, entries)).toEqual({ outcome: "declared" })
    expect(readFileSync(file, "utf8")).toBe(afterFirst)
  })

  test("an existing file WITHOUT agentRoutes is seeded in place, every other byte preserved", () => {
    /** Fixture holding a commented, trailing-comma document to prove the splice is surgical. */
    const { file } = fixture()
    /** The human-written bytes the seed must leave untouched (comments included). */
    const original = `{\n  // the user's own knob\n  "ulw": { "maxRounds": 3 },\n}\n`
    writeFileSync(file, original)
    /** The eleven entries this case writes and compares. */
    const entries = buildAgentRoutesSeedBlock({ provider: "p", model: "m" })
    expect(seedAgentRoutesFile(file, entries)).toEqual({ outcome: "seeded" })
    /** The seeded text, which must still carry the user's comment and trailing comma. */
    const text = readFileSync(file, "utf8")
    expect(text).toContain("// the user's own knob")
    expect(text).toContain('"maxRounds": 3 },')
    expect(JSON.parse(stripJsonc(text))).toEqual({ ulw: { maxRounds: 3 }, agentRoutes: entries })
  })

  test("a file that ALREADY declares agentRoutes — even partially — is left byte-identical", () => {
    /** Fixture whose block declares ONE entry, the state the seed must never overwrite. */
    const { file } = fixture()
    /** The exact bytes of a user edit that a second write would destroy. */
    const original = `{\n  "agentRoutes": { "Deep Worker": { "model": "mine" } }\n}\n`
    writeFileSync(file, original)
    expect(seedAgentRoutesFile(file, buildAgentRoutesSeedBlock({ provider: "p", model: "m" }))).toEqual({ outcome: "declared" })
    expect(readFileSync(file, "utf8")).toBe(original)
    // An EMPTY block is a user edit too: the writer does not interpret it as "unset".
    /** Fixture whose block is explicitly empty. */
    const { file: emptyFile } = fixture()
    /** The exact bytes of the empty-but-declared block. */
    const emptyOriginal = `{\n  "agentRoutes": {}\n}\n`
    writeFileSync(emptyFile, emptyOriginal)
    expect(seedAgentRoutesFile(emptyFile, buildAgentRoutesSeedBlock({ provider: "p", model: "m" }))).toEqual({ outcome: "declared" })
    expect(readFileSync(emptyFile, "utf8")).toBe(emptyOriginal)
  })

  test("an unparsable file is refused untouched (never repaired by a seed)", () => {
    /** Fixture holding a document no JSONC reader accepts. */
    const { file } = fixture()
    /** The broken bytes that must survive the attempt verbatim. */
    const broken = `{ "ulw": `
    writeFileSync(file, broken)
    /** The refusal, whose outcome is `unreadable` and whose detail names the parse failure. */
    const result = seedAgentRoutesFile(file, buildAgentRoutesSeedBlock({ provider: "p", model: "m" }))
    expect(result.outcome).toBe("unreadable")
    expect(readFileSync(file, "utf8")).toBe(broken)
  })
})
