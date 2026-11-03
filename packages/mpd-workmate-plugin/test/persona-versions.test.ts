// THE VERSIONED-PERSONA CONTRACT (wave W4-A3).
//
// A workmate's persona evolves, and the roster BASE template it was copied from evolves INDEPENDENTLY.
// Without a recorded baseline the second kind of change is invisible; without a CAS guard two writers
// silently clobber each other. These arms pin both halves, and every one of them drives the SHIPPED
// tools through a sandbox HOME, so nothing here can pass while the behaviour is absent:
//
//   (a) a STALE `baseRevision` is refused and the on-disk persona is byte-identical afterwards;
//   (b) a matching write bumps the revision and writes EXACTLY one new version file;
//   (c) a birth from base X reports `defaultUpdated:false`, and the same instance reports `true` with a
//       non-zero `baseDriftLines` once the BASE template changes;
//   (d) a legacy instance (no fields) backfills on its next write instead of failing;
//   (e) persona version filenames never collide, even when a hand-restored directory already holds one.
import { test, expect } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index.ts"

/** The Deep Worker base template: write-capable, with the persona every arm starts from. */
const BASE_X = "You are the Deep Worker. Execute goals end-to-end with tools and verify every change."
/** The REWRITTEN base template: what a later roster revision of the same base looks like. */
const BASE_Y = "You are the Deep Worker, now scoped to verified refactors.\nReport every measurement.\nNever edit tests to make a change pass."

/** The tool-registration and service handles one arm drives. */
interface Harness {
  /** Every tool the row registered, in registration order. */
  tools: any[]
  /** The services the row published. */
  provided: Record<string, any>
  /** The minimal exec context the tools read. */
  exec: { agent: { id: string }; signal: AbortSignal }
  /** The sandbox HOME the library lives under. */
  home: string
  /** Change the BASE template's persona, the way a roster edit or a plugin upgrade would. */
  setBase: (persona: string) => void
  /** Look one registered tool up by name. */
  byName: (name: string) => any
}

/**
 * Build one fake cordis context whose roster answers a MUTABLE base persona.
 *
 * The mutability is the point: drift is about the BASE moving after the instance was born, which a
 * frozen fixture could never express.
 *
 * @param persona - the base persona the roster answers with FIRST.
 * @returns the handles one arm drives.
 */
function makeHarness(persona: string = BASE_X): Harness {
  /** The scratch home every path resolves under, so the real library is never touched. */
  const home = mkdtempSync(join(tmpdir(), "mpd-wm-persona-"))
  process.env.HOME = home
  /** The base persona the fake roster currently reports. */
  let basePersona = persona
  /** The one base template this roster serves, with the persona swapped per call. */
  const base = (): Record<string, unknown> => ({
    id: "hephaestus", name: "Deep Worker", description: "autonomous goal-driven implementation",
    readonly: false, chain: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }], persona: basePersona,
  })
  /** Every tool descriptor the row registered. */
  const tools: any[] = []
  /** The services the row published through `ctx.provide`. */
  const provided: Record<string, any> = {}
  /** The fake host context: only the seams this row injects. */
  const ctx: any = {
    get: (k: string) => (k === "mpdRoles" ? { list: () => [base()], get: () => base() } : undefined),
    tools: { register: (d: any): void => { tools.push(d) } },
    subagents: { start: async (): Promise<unknown> => ({ result: { structured: { name: "x", summary: "s" } } }) },
    provide: (n: string, v: any): void => { provided[n] = v },
  }
  apply(ctx)
  return {
    tools,
    provided,
    exec: { agent: { id: "agent-1" }, signal: new AbortController().signal },
    home,
    setBase: (next: string): void => { basePersona = next },
    byName: (n: string): any => tools.find((t) => t.name === n),
  }
}

/**
 * The instance directory of one workmate inside a sandbox home.
 *
 * @param home - the sandbox HOME.
 * @param name - the instance key.
 * @returns the absolute instance directory.
 */
function inst(home: string, name: string): string {
  return join(home, ".mpd", "workmate", name)
}

/**
 * Read one instance's `meta.json`.
 *
 * @param home - the sandbox HOME.
 * @param name - the instance key.
 * @returns the parsed metadata, untyped on purpose (the arm asserts individual fields).
 */
function metaOf(home: string, name: string): any {
  return JSON.parse(readFileSync(join(inst(home, name), "meta.json"), "utf8"))
}

/**
 * The persona version files present for one instance, sorted.
 *
 * @param home - the sandbox HOME.
 * @param name - the instance key.
 * @returns the version file names, or an empty list when the directory does not exist.
 */
function versionsOf(home: string, name: string): string[] {
  /** The version directory, absent for an instance that predates the feature. */
  const dir = join(inst(home, name), "persona.versions")
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

/**
 * The sha256 of one text, the same digest the row records.
 *
 * @param text - the text to hash.
 * @returns the lowercase hex digest.
 */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

test("(a) a STALE baseRevision is refused, and the on-disk persona is byte-identical afterwards", async () => {
  // The harness and one instance born at revision 1.
  const h = makeHarness()
  await h.byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, h.exec)
  /** The persona file's exact bytes before the refused write. */
  const before = readFileSync(join(inst(h.home, "alice"), "persona.md"))
  /** The metadata before the refused write. */
  const metaBefore = metaOf(h.home, "alice")
  expect(metaBefore.personaRevision).toBe(1)
  // The CAS refusal: the draft was based on a revision this instance never reached.
  const refused = await h.byName("mpd_workmate_persona_set").execute({ name: "alice", persona: "a whole new identity", baseRevision: 99 }, h.exec)
  expect(refused.updated).toBe(false)
  expect(String(refused.refused)).toContain("stale baseRevision")
  // The two numbers a caller needs to rebase travel WITH the refusal.
  expect(refused.currentRevision).toBe(1)
  expect(refused.currentPersonaChars).toBe(String(before).length - 1)
  // NOTHING was written: not the persona, not the metadata, not a version file.
  expect(readFileSync(join(inst(h.home, "alice"), "persona.md")).equals(before)).toBe(true)
  expect(metaOf(h.home, "alice").personaRevision).toBe(1)
  expect(versionsOf(h.home, "alice")).toEqual(["1.md"])
  // A missing or non-integer token is the same refusal, not a crash.
  const noToken = await h.byName("mpd_workmate_persona_set").execute({ name: "alice", persona: "x", baseRevision: "one" }, h.exec)
  expect(noToken.updated).toBe(false)
})

test("(b) a matching write bumps the revision and writes EXACTLY one new version file", async () => {
  // The harness and one instance born at revision 1.
  const h = makeHarness()
  await h.byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, h.exec)
  // The accepted write, based on the revision mpd_workmate_list reports.
  const list = await h.byName("mpd_workmate_list").execute({}, h.exec)
  /** The revision the library advertises for alice. */
  const advertised = list.workmates.find((w: any) => w.name === "alice").personaRevision
  expect(advertised).toBe(1)
  /** The accepted write's result. */
  const written = await h.byName("mpd_workmate_persona_set").execute({ name: "alice", persona: "REWRITTEN persona", baseRevision: advertised }, h.exec)
  expect(written.updated).toBe(true)
  expect(written.revision).toBe(2)
  // EXACTLY one new version file, and the persona bytes are the new text.
  expect(versionsOf(h.home, "alice")).toEqual(["1.md", "2.md"])
  expect(readFileSync(join(inst(h.home, "alice"), "persona.md"), "utf8").trim()).toBe("REWRITTEN persona")
  expect(readFileSync(join(inst(h.home, "alice"), "persona.versions", "2.md"), "utf8").trim()).toBe("REWRITTEN persona")
  // The metadata triple moved together: revision, hash, and the (unchanged) base baseline.
  const meta = metaOf(h.home, "alice")
  expect(meta.personaRevision).toBe(2)
  expect(meta.personaHash).toBe(sha256("REWRITTEN persona"))
  expect(meta.baseRevision).toBe(sha256(BASE_X))
  expect(written.personaHash).toBe(meta.personaHash)
  // A second accepted write (based on 2) reaches 3 — the counter is monotone, never reused.
  const again = await h.byName("mpd_workmate_persona_set").execute({ name: "alice", persona: "THIRD persona", baseRevision: 2 }, h.exec)
  expect(again.revision).toBe(3)
  expect(versionsOf(h.home, "alice")).toEqual(["1.md", "2.md", "3.md"])
})

test("(c) default drift: false at birth, true with a non-zero line count after the BASE moves", async () => {
  // The harness, one instance born from base X.
  const h = makeHarness(BASE_X)
  await h.byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, h.exec)
  // At birth the base IS the baseline: no drift, and the comparison really was made.
  const atBirth = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "alice")
  expect(atBirth.defaultUpdated).toBe(false)
  expect(atBirth.baseDriftLines).toBe(0)
  expect(atBirth.baseDriftUnknown).toBe(false)
  expect(String(atBirth.note)).not.toContain("defaultUpdated")
  // The BASE template moves (a roster edit / a bundle upgrade): X's single line is replaced by three,
  // which is ONE deletion plus THREE insertions — the line-diff count, not the line count.
  h.setBase(BASE_Y)
  /** The same row once the base template moved. */
  const drifted = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "alice")
  expect(drifted.defaultUpdated).toBe(true)
  expect(drifted.baseDriftLines).toBe(4)
  expect(drifted.baseRevision).toBe(sha256(BASE_X))
  // THE NOTE CARD carries both fields the contract names, in the field spelling a reader scans for.
  expect(String(drifted.note)).toContain("defaultUpdated=true")
  expect(String(drifted.note)).toContain("baseDriftLines=4")
  // A reflect PERSISTS that marked note card, and a re-render never stacks a second marker.
  await h.byName("mpd_workmate_reflect").execute({ name: "alice", task: "t", outcome: "o" }, h.exec)
  /** The note card file a reflect persists. */
  const card = readFileSync(join(inst(h.home, "alice"), "note.md"), "utf8")
  expect(card).toContain("defaultUpdated=true")
  expect(card.split("defaultUpdated=true").length - 1).toBe(1)
  /** The row a SECOND list renders, which must not stack a second marker. */
  const rerender = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "alice")
  expect(String(rerender.note).split("defaultUpdated=true").length - 1).toBe(1)
  // The BASE moving back to X clears the verdict rather than leaving a stale marker behind.
  h.setBase(BASE_X)
  /** The row once the base is back to its birth text. */
  const settled = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "alice")
  expect(settled.defaultUpdated).toBe(false)
  expect(String(settled.note)).not.toContain("defaultUpdated")
})

test("(d) a legacy instance backfills on the next write instead of failing", async () => {
  // A hand-made PRE-WAVE instance: metadata with none of the persona fields, plus a persona and a note.
  const h = makeHarness(BASE_X)
  /** The legacy instance directory. */
  const dir = inst(h.home, "legacy")
  mkdirSync(dir, { recursive: true })
  /** The legacy metadata, written the way the previous release wrote it. */
  const legacyMeta = { name: "legacy", baseId: "hephaestus", baseName: "Deep Worker", description: "autonomous goal-driven implementation", provider: "deepseek-official", model: "deepseek-v4-flash", readonly: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", uses: 0, lastTask: null, renamedFrom: [] }
  writeFileSync(join(dir, "meta.json"), JSON.stringify(legacyMeta, null, 2) + "\n")
  writeFileSync(join(dir, "persona.md"), "LEGACY persona text\n")
  writeFileSync(join(dir, "memory.md"), "")
  writeFileSync(join(dir, "note.md"), "legacy note\n")
  // A READ of the legacy instance is honest rather than broken: the effective revision is 1 and the
  // baseline is UNKNOWN (there is nothing recorded to compare against yet).
  const before = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "legacy")
  expect(before.personaRevision).toBe(1)
  expect(before.baseDriftUnknown).toBe(true)
  expect(before.defaultUpdated).toBe(false)
  // The first WRITE backfills: the current text becomes revision 1 on disk and the baseline is recorded
  // from the base the instance now provably descends from.
  await h.byName("mpd_workmate_reflect").execute({ name: "legacy", task: "t", outcome: "o", persona_delta: "prefer measured claims" }, h.exec)
  /** The backfilled metadata. */
  const meta = metaOf(h.home, "legacy")
  expect(meta.personaRevision).toBe(2)
  expect(meta.personaHash).toBe(sha256(readFileSync(join(dir, "persona.md"), "utf8").trim()))
  expect(meta.baseRevision).toBe(sha256(BASE_X))
  expect(existsSync(join(dir, "persona.base.md"))).toBe(true)
  expect(versionsOf(h.home, "legacy")).toEqual(["1.md", "2.md"])
  // Revision 1 is the LEGACY text (backfilled verbatim), revision 2 is the merged text.
  expect(readFileSync(join(dir, "persona.versions", "1.md"), "utf8").trim()).toBe("LEGACY persona text")
  expect(readFileSync(join(dir, "persona.versions", "2.md"), "utf8")).toContain("prefer measured claims")
  // From here the drift comparison works, because a baseline exists.
  h.setBase(BASE_Y)
  /** The legacy row once a baseline exists AND the base has moved. */
  const after = (await h.byName("mpd_workmate_list").execute({}, h.exec)).workmates.find((w: any) => w.name === "legacy")
  expect(after.baseDriftUnknown).toBe(false)
  expect(after.defaultUpdated).toBe(true)
  expect(after.baseDriftLines).toBeGreaterThan(0)
})

test("(e) persona version filenames never collide, even over a hand-restored history", async () => {
  // The harness and one instance at revision 1.
  const h = makeHarness()
  await h.byName("mpd_workmate_init").execute({ base: "Deep Worker", name: "alice" }, h.exec)
  /** The instance's version directory. */
  const versions = join(inst(h.home, "alice"), "persona.versions")
  // A HAND-RESTORED directory whose counter fell behind its files: 2.md already exists, and its bytes
  // are history that must survive.
  writeFileSync(join(versions, "2.md"), "RESTORED history for revision 2\n")
  /** The write that had to skip the occupied revision number. */
  const written = await h.byName("mpd_workmate_persona_set").execute({ name: "alice", persona: "FRESH persona", baseRevision: 1 }, h.exec)
  // The write SKIPPED the occupied number instead of overwriting it.
  expect(written.revision).toBe(3)
  expect(readFileSync(join(versions, "2.md"), "utf8").trim()).toBe("RESTORED history for revision 2")
  expect(readFileSync(join(versions, "3.md"), "utf8").trim()).toBe("FRESH persona")
  expect(new Set(versionsOf(h.home, "alice")).size).toBe(versionsOf(h.home, "alice").length)
  expect(metaOf(h.home, "alice").personaRevision).toBe(3)
})
