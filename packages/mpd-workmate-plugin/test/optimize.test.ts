// W3-C arm 2: `mpd_workmate_optimize` + `/workmate-optimize` (contract §4.6, requirement 4).
//
// WHAT THESE ARMS PROVE. A merge is only allowed between two instances that are the SAME specialty
// grown apart: same roster base, same readonly posture, neither archived, neither busy in a live team,
// and either a strong note match or substantial tag overlap. A merge PRESERVES the evolved record and
// ARCHIVES the source — never deletes, never purges — and a dry run writes nothing at all.
// Every case runs against a sandbox HOME (the library lives under HOME) and a sandbox cwd (the in-use
// gate scans `<cwd>/.mpd/team`), so neither the real library nor a real team record is touched.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MERGE_THRESHOLD, apply, optimizeWorkmates, planWorkmateMerges } from "../src/index.ts"

/** The sandbox this file's cases run inside, replaced per test. */
let sb: { home: string; cwd: string; restore: () => void }

/** Create a sandbox HOME and cwd, so neither the real library nor a real team record is touched. */
function sandbox(): { home: string; cwd: string; restore: () => void } {
  /** The sandbox home: the library root resolves under it. */
  const home = mkdtempSync(join(tmpdir(), "mpd-wm-optimize-home-"))
  /** The sandbox cwd: the in-use gate scans `<cwd>/.mpd/team`. */
  const cwd = mkdtempSync(join(tmpdir(), "mpd-wm-optimize-cwd-"))
  /** The HOME in force before this sandbox. */
  const prevHome = process.env.HOME
  /** The cwd in force before this sandbox. */
  const prevCwd = process.cwd()
  process.env.HOME = home
  process.chdir(cwd)
  return { home, cwd, restore: () => { process.env.HOME = prevHome; process.chdir(prevCwd) } }
}

beforeEach(() => { sb = sandbox() })
afterEach(() => { sb.restore(); rmSync(sb.home, { recursive: true, force: true }); rmSync(sb.cwd, { recursive: true, force: true }) })

/** The library root inside the current sandbox home. */
const root = (): string => join(process.env.HOME as string, ".mpd", "workmate")

/** One seeded instance's shape. */
interface Seed {
  /** The roster base it was copied from. */
  baseName?: string
  /** Whether the base is read-only. */
  readonly?: boolean
  /** How many times it has been used (the survivor's tiebreak). */
  uses?: number
  /** The persona body. */
  persona?: string
  /** The memory body, `## ` blocks. */
  memory?: string
  /** The note card the matcher scores. */
  note?: string
  /** When it was last updated; the listing sorts on it. */
  updatedAt?: string
  /** The names it has held before. */
  renamedFrom?: string[]
}

/**
 * Seed one instance directory exactly as `mpd_workmate_init` would leave it.
 * @param name - the instance key (the directory name).
 * @param seed - the fields this case needs; every one has a default.
 */
function seedInstance(name: string, seed: Seed = {}): void {
  /** The instance directory. */
  const dir = join(root(), name)
  mkdirSync(dir, { recursive: true })
  /** The metadata this instance carries. */
  const meta = {
    name,
    baseId: "hephaestus",
    baseName: seed.baseName ?? "Deep Worker",
    description: "autonomous goal-driven implementation",
    provider: "deepseek-official",
    model: "deepseek-v4-flash",
    readonly: seed.readonly ?? false,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: seed.updatedAt ?? "2026-11-02T00:00:00.000Z",
    uses: seed.uses ?? 0,
    lastTask: "ship the wave",
    renamedFrom: seed.renamedFrom ?? []
  }
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), (seed.persona ?? "You are the Deep Worker.") + "\n")
  writeFileSync(join(dir, "memory.md"), seed.memory === undefined ? "" : seed.memory + "\n")
  writeFileSync(join(dir, "note.md"), (seed.note ?? "Deep Worker-based workmate. Last task: ship the wave.") + "\n")
}

/** The instance directory names currently in the library, sorted. */
function libraryNames(): string[] {
  if (!existsSync(root())) return []
  return readdirSync(root(), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== ".archive").map((entry) => entry.name).sort()
}

/** The archive directory names currently under `.archive/`, sorted. */
function archiveNames(): string[] {
  /** The archive root; absent means nothing has ever been archived. */
  const archive = join(root(), ".archive")
  return existsSync(archive) ? readdirSync(archive).sort() : []
}

/**
 * Write one mpd-owned team record naming a member, so the in-use gate sees it.
 * @param member - the member NAME the record carries (a workmate key, on a bound seat).
 * @param status - the member's status; a settled member does not hold the workmate.
 */
function seedTeamMember(member: string, status: string = "running"): void {
  /** `<cwd>/.mpd/team/teams`, the layout an approved team leaves behind. */
  const dir = join(process.cwd(), ".mpd", "team", "teams")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "team-1.json"), JSON.stringify({
    version: 1,
    teamId: "team-1",
    name: "the live wave",
    leadSessionId: "sess-1",
    phase: "active",
    createdAt: "2026-11-02T00:00:00.000Z",
    members: [{ id: "M1", name: member, description: member, status, spawnedAt: "2026-11-02T00:00:00.000Z" }],
    tasks: []
  }, null, 2))
}

describe("mpd_workmate_optimize — the merge predicate", () => {
  test("(d) a workmate BUSY in a live team is never merged, and the pass says why", () => {
    seedInstance("oracle-1", { uses: 3, note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-2", { uses: 1, note: "reviews diffs for correctness and regression risk" })
    seedTeamMember("oracle-1")
    /** The decision table. */
    const plan = planWorkmateMerges()
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ from: "oracle-2", into: "oracle-1", mergeable: false, reason: "in-use" })
    // WITH confirm:true the gate still refuses, and NOTHING moves.
    /** What the confirmed call did. */
    const applied = optimizeWorkmates({ confirm: true })
    expect(applied.applied).toEqual([])
    expect(applied.skipped).toEqual([{ from: "oracle-2", into: "oracle-1", reason: "in-use" }])
    expect(libraryNames()).toEqual(["oracle-1", "oracle-2"])
    expect(archiveNames()).toEqual([])
  })

  test("(d2) a SETTLED member does not hold the workmate — the merge is allowed", () => {
    seedInstance("oracle-1", { uses: 3, note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-2", { uses: 1, note: "reviews diffs for correctness and regression risk" })
    seedTeamMember("oracle-1", "inactive")
    expect(planWorkmateMerges()[0]).toMatchObject({ mergeable: true })
  })

  test("a different base, a different readonly posture and a weak note all refuse the pair", () => {
    seedInstance("worker-1", { note: "implements the feature end to end with tests" })
    seedInstance("worker-2", { baseName: "Reviewer", note: "implements the feature end to end with tests" })
    seedInstance("worker-3", { readonly: true, note: "implements the feature end to end with tests" })
    /** The rows for one group at a time, since the grouping decides the proposals. */
    const plan = planWorkmateMerges({ pairs: [{ from: "worker-2", into: "worker-1" }, { from: "worker-3", into: "worker-1" }] })
    // The gate ORDER is base → readonly → archived → in-use → similarity, so the readonly pair
    // reports its readonly gate rather than the base gate it also fails.
    expect(plan.map((row) => row.reason)).toEqual(["base-mismatch", "readonly-mismatch"])
    // A SAME-BASE pair whose notes share nothing is not similar enough to merge.
    seedInstance("other-1", { note: "nothing in common with the other note card at all" })
    seedInstance("other-2", { note: "completely different vocabulary appears right here" })
    expect(planWorkmateMerges({ pairs: [{ from: "other-2", into: "other-1" }] })[0]).toMatchObject({ mergeable: false, reason: "not-similar" })
  })

  test("the auto rule collapses a fork into its MOST-USED instance", () => {
    seedInstance("oracle-1", { uses: 1, note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-2", { uses: 9, note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-3", { uses: 2, note: "reviews diffs for correctness and regression risk" })
    /** The proposals, which must all point at the most-used instance. */
    const plan = planWorkmateMerges()
    // Survivor order is (uses desc, name asc): oracle-2 keeps, then oracle-3, then oracle-1.
    expect(plan.map((row) => [row.from, row.into])).toEqual([["oracle-3", "oracle-2"], ["oracle-1", "oracle-2"]])
    expect(plan.every((row) => row.mergeable)).toBe(true)
    expect(plan[0]?.score).toBeGreaterThanOrEqual(MERGE_THRESHOLD)
  })
})

describe("the /workmate-optimize command", () => {
  test("no args prints the plan table and writes nothing; the word confirm applies it", () => {
    seedInstance("oracle-1", { uses: 3, note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-2", { uses: 1, note: "reviews diffs for correctness and regression risk" })
    /** The command definitions `apply` registered. */
    const definitions: any[] = []
    /** A minimal ctx: a commands seam that records definitions, the tool registrar and the effect host. */
    const ctx: any = {
      get: (service: string) => (service === "commands" ? { register: (definition: any) => { definitions.push(definition); return () => {} } } : undefined),
      tools: { register: (): void => {} },
      subagents: { start: async () => ({ result: { structured: {} } }) },
      provide: (): void => {},
      effect: (fn: any) => fn()
    }
    apply(ctx)
    /** The `/workmate-optimize` definition. */
    const command = definitions.find((definition) => definition.name === "workmate-optimize")
    expect(command).toBeTruthy()
    /** What the no-arg invocation answers. */
    const dry = command.handler({ rawInput: "", agent: { id: "agent-1" } })
    expect(dry.kind).toBe("success")
    expect(String(dry.text)).toContain("DRY RUN")
    expect(String(dry.text)).toContain("oracle-2 -> oracle-1")
    // The table is printed, and NOTHING moved.
    expect(libraryNames()).toEqual(["oracle-1", "oracle-2"])
    /** What the `confirm` invocation answers. */
    const applied = command.handler({ rawInput: "  confirm  ", agent: { id: "agent-1" } })
    expect(String(applied.text)).toContain("APPLIED")
    expect(libraryNames()).toEqual(["oracle-1"])
  })
})

describe("mpd_workmate_optimize — the merge itself", () => {
  test("(e) a DRY RUN writes nothing; confirm:true archives the source with a merge record", () => {
    seedInstance("oracle-1", { uses: 3, persona: "You review code.", memory: "## first lesson\nbe exact", note: "reviews diffs for correctness and regression risk" })
    seedInstance("oracle-2", { uses: 2, persona: "You review code, always with evidence.", memory: "## second lesson\ncite the line", note: "reviews diffs for correctness and regression risk" })
    /** The dry run's answer, with no confirm. */
    const dry = optimizeWorkmates()
    expect(dry.applied).toEqual([])
    expect(dry.plan).toHaveLength(1)
    // NOTHING was written: both directories are still there, no archive exists, the bytes are identical.
    expect(libraryNames()).toEqual(["oracle-1", "oracle-2"])
    expect(archiveNames()).toEqual([])
    expect(readFileSync(join(root(), "oracle-2", "persona.md"), "utf8")).toContain("always with evidence")
    // AN EXPLICIT dryRun WITH confirm STILL WRITES NOTHING — the dry flag wins.
    expect(optimizeWorkmates({ dryRun: true, confirm: true }).applied).toEqual([])
    expect(archiveNames()).toEqual([])
    /** The confirmed call, which applies the one mergeable pair. */
    const confirmed = optimizeWorkmates({ confirm: true })
    expect(confirmed.applied).toHaveLength(1)
    expect(confirmed.applied[0]).toMatchObject({ from: "oracle-2", into: "oracle-1" })
    // ARCHIVED, NOT DELETED: the source left the library and sits under `.archive/` with its bytes.
    expect(libraryNames()).toEqual(["oracle-1"])
    /** The archive directory this merge wrote. */
    const archived = confirmed.applied[0]!.archive
    expect(existsSync(join(archived, "meta.json"))).toBe(true)
    expect(existsSync(join(archived, "persona.md"))).toBe(true)
    /** The merge record the archive carries. */
    const record = JSON.parse(readFileSync(join(archived, "merge.json"), "utf8"))
    expect(record).toMatchObject({ version: 1, from: "oracle-2", into: "oracle-1" })
    expect(Array.isArray(record.memoryShas)).toBe(true)
    expect(String(record.personaSha)).toHaveLength(64)
    // THE PATH CANNOT PURGE: the optimize surface has no purge parameter at all, and the archived bytes
    // are outside the library, so `mpd_workmate_delete` cannot reach them either.
    expect(Object.keys(optimizeWorkmates({ confirm: true }))).toEqual(["plan", "applied", "skipped"])
  })

  test("(e2) the merge PRESERVES the evolved record: memory deduped, the longer persona, uses summed, history kept", () => {
    seedInstance("oracle-1", { uses: 3, persona: "Short persona.", memory: "## shared lesson\nsame bytes\n\n## target only\ntarget detail", note: "reviews diffs for correctness and regression risk", renamedFrom: ["old-a"] })
    seedInstance("oracle-2", { uses: 2, persona: "A considerably longer persona body that must win the merge.", memory: "## shared lesson\nsame bytes\n\n## source only\nsource detail", note: "reviews diffs for correctness and regression risk", renamedFrom: ["old-b"] })
    /** The applied merge. */
    const applied = optimizeWorkmates({ confirm: true })
    expect(applied.applied).toHaveLength(1)
    /** The survivor's metadata after the merge. */
    const meta = JSON.parse(readFileSync(join(root(), "oracle-1", "meta.json"), "utf8"))
    // Use counts are SUMMED and the source (and its own history) lands in `renamedFrom`.
    expect(meta.uses).toBe(5)
    expect(meta.renamedFrom).toEqual(["old-a", "oracle-2", "old-b"])
    /** The survivor's memory after the merge. */
    const memory = readFileSync(join(root(), "oracle-1", "memory.md"), "utf8")
    // The shared block appears ONCE (dedup by sha256) and both unique blocks survive.
    expect(memory.split("same bytes").length - 1).toBe(1)
    expect(memory).toContain("target detail")
    expect(memory).toContain("source detail")
    /** The survivor's persona after the merge. */
    const persona = readFileSync(join(root(), "oracle-1", "persona.md"), "utf8")
    // The LONGER persona won and carries exactly ONE merged-from line.
    expect(persona).toContain("A considerably longer persona body that must win the merge.")
    expect(persona).toContain("merged-from: oracle-2")
    expect(persona.split("merged-from:").length - 1).toBe(1)
    // THE MERGED PERSONA IS A VERSIONED WRITE (wave W4-A3): the survivor's record moved WITH the file, so
    // a later reader can diff the merge instead of trusting a hash that describes the pre-merge text.
    expect(meta.personaRevision).toBe(2)
    expect(readdirSync(join(root(), "oracle-1", "persona.versions")).sort()).toEqual(["1.md", "2.md"])
    // The note was REGENERATED: it still names the base and now records the survivor's own name.
    /** The survivor's note card after the merge. */
    const note = readFileSync(join(root(), "oracle-1", "note.md"), "utf8")
    expect(note).toContain('workmate "oracle-1"')
  })
})
