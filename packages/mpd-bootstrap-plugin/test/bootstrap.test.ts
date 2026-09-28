// mpd-bootstrap unit tests: the bundle-served skill corpus (no home copy) and
// the legacy home-copy migration. Real corpus where it matters, temp fixtures
// for the frontmatter subset and the cleanup ownership rules.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { apply } from "../src/index"

// Repository root: this test file lives at <root>/packages/mpd-bootstrap-plugin/test/, so four levels up from its own URL.
const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
// The shipped corpus the row serves BY REFERENCE; the provider cases read the real thing, not a fixture.
const realCorpus = join(repoRoot, "skills")

/** The slice of the provider contract these cases drive — `name`, `list()` and `get()` — so a registration is provable without restating the harness shape. */
type Provider = { name: string; list: () => Promise<any[]>; get: (candidate: any) => Promise<any> }

/** Apply the row against a fake ctx and return what it registered: the provider, the warnings it routed to the logger, and its `fs/observed` listeners. */
function harness(config: Record<string, unknown> = {}): { provider: Provider; warnings: string[]; observed: Array<(...args: any[]) => void> } {
  // Set by the fake registry below when the row registers its provider.
  let provider: Provider | undefined
  // Messages the row sent through ctx.logger.warn (skipped or invalid corpus entries).
  const warnings: string[] = []
  // Listeners the row subscribed through ctx.on for the fs/observed invalidation.
  const observed: Array<(...args: any[]) => void> = []
  // Minimal ctx: the skills registry seam, a logger, and the event bus the row subscribes on.
  const ctx = {
    skills: {
      registerProvider: (create: (control: { invalidate: () => void }) => Provider) => {
        provider = create({ invalidate: () => {} })
      },
    },
    logger: { warn: (message: string) => { warnings.push(message) } },
    on: (event: string, fn: (...args: any[]) => void) => { if (event === "fs/observed") observed.push(fn) },
  }
  // The cleanup stays OFF unless a case asks for it, so a provider case can never touch a home.
  apply(ctx as any, { skipLegacyCleanup: true, ...config })
  if (provider === undefined) throw new Error("apply registered no provider")
  return { provider, warnings, observed }
}

/** Materialize a fixture corpus under the OS temp dir: `files` maps a corpus-relative path to its body, and the returned root is what the row is pointed at. */
function tempCorpus(files: Record<string, string>): string {
  // Fresh temp root per call, so no fixture can see another case's files.
  const root = mkdtempSync(join(tmpdir(), "mpd-corpus-"))
  for (const [rel, body] of Object.entries(files)) {
    // Absolute path of one fixture file to create, parents included.
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
  return root
}

/** Build a SKILL.md body from a frontmatter block; the default body keeps the cases that only care about frontmatter short. */
const skillFile = (frontmatter: string, body: string = "# Skill\n\nDo the thing.\n"): string => `---\n${frontmatter}\n---\n\n${body}`

// Sandbox homes created by this file, drained in afterEach so no case leaves a temp home behind (the real ~/.dsh is never touched).
const homes: string[] = []
/** Create a throwaway home and register it for cleanup; callers point DSH_HOME at it before applying the row. */
function sandboxHome(): string {
  // The temp directory standing in for $DSH_HOME in this case.
  const home = mkdtempSync(join(tmpdir(), "mpd-home-"))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop() as string, { recursive: true, force: true })
})

describe("bundle skill corpus provider", () => {
  test("serves every shipped skill as a bundled-rank candidate", async () => {
    // The provider the row registered into the fake registry.
    const { provider } = harness()
    expect(provider.name).toBe("mpd-bundle")
    // Candidates reported for the real corpus; the assertion is a FLOOR, so adding a skill cannot redden it.
    const candidates = await provider.list()
    // 18 = the shipped corpus AFTER the RTL skill trees were extracted out of
    // this repository (they are no longer served by this bundle) and the
    // cross-agent session-finder skill was removed by the DSH-only cleanup.
    expect(candidates.length).toBeGreaterThanOrEqual(18)
    // Candidate names, sorted, so the expectations do not depend on readdir order.
    const names = candidates.map((candidate) => candidate.name).sort()
    for (const expected of ["ast-grep", "dsh-qa", "svn-master"]) {
      expect(names).toContain(expected)
    }
    for (const candidate of candidates) {
      expect(candidate.rank).toBe(600)
      expect(candidate.source).toBe("bundled")
      expect(candidate.provider).toBe("mpd-bundle")
      expect(typeof candidate.description).toBe("string")
      expect(candidate.description.length).toBeGreaterThan(0)
      expect(candidate.resourceBase.kind).toBe("directory")
      expect(existsSync(candidate.locator.path)).toBe(true)
      expect(candidate.path).toBe(candidate.locator.path)
    }
  })

  test("get() loads the skill body and keeps the resource base", async () => {
    // Independent provider for this case: each harness() call wires a fresh registry.
    const { provider } = harness()
    // The corpus candidates to pick dsh-qa out of.
    const candidates = await provider.list()
    // The dsh-qa candidate, whose directory resource base get() must preserve.
    const target = candidates.find((candidate) => candidate.name === "dsh-qa")
    expect(target).toBeDefined()
    // Definition loaded from the locator get() was handed.
    const definition = await provider.get(target)
    expect(definition.name).toBe("dsh-qa")
    expect(definition.source).toBe("bundled")
    expect(definition.content.length).toBeGreaterThan(100)
    expect(definition.resourceBase).toEqual({ kind: "directory", path: join(realCorpus, "dsh-qa") })
  })

  test("frontmatter subset: quoted, folded, nested metadata and invocation policy", async () => {
    // Fixture corpus covering the subset: quoting, folding, nested metadata, both invocation flags, a rejected name, a missing description, a legacy key and a non-markdown file.
    const root = tempCorpus({
      "quoted/SKILL.md": skillFile('name: quoted\ndescription: "a: b, \\"quoted\\" value"\nmetadata:\n  short-description: short one'),
      "folded/SKILL.md": skillFile("name: folded\ndescription: >-\n  first line\n  second line"),
      "single/SKILL.md": skillFile("name: single\ndescription: 'it''s fine'\nuser-invocable: false"),
      "no-model/SKILL.md": skillFile("name: no-model\ndescription: hidden from the model\ndisable-model-invocation: true"),
      "flat-skill.md": skillFile("name: flat-skill\ndescription: flat file skill"),
      "Bad-Name/SKILL.md": skillFile("name: Bad-Name\ndescription: rejected name"),
      "no-desc/SKILL.md": skillFile("name: no-desc"),
      "legacy/SKILL.md": skillFile("name: legacy\ndescription: legacy key\ndisableModelInvocation: true"),
      "notes.txt": "ignored\n",
    })
    // Provider over the fixture corpus, plus the warnings raised for its rejected entries.
    const { provider, warnings } = harness({ skillsDir: root })
    // Every candidate the fixture corpus yields.
    const candidates = await provider.list()
    // Candidates keyed by name; the rejected entries must be absent from the keys.
    const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]))
    expect([...byName.keys()].sort()).toEqual(["flat-skill", "folded", "no-model", "quoted", "single"])
    expect(byName.get("quoted")?.description).toBe('a: b, "quoted" value')
    expect(byName.get("quoted")?.metadata).toEqual({ "short-description": "short one" })
    expect(byName.get("folded")?.description).toBe("first line second line")
    expect(byName.get("single")?.description).toBe("it's fine")
    expect(byName.get("single")?.invocation.userInvocable).toBe(false)
    expect(byName.get("no-model")?.invocation.modelInvocable).toBe(false)
    expect(byName.get("flat-skill")?.resourceBase.path).toBe(root)
    expect(warnings.some((message) => message.includes("invalid skill name"))).toBe(true)
    expect(warnings.some((message) => message.includes("requires name and description"))).toBe(true)
    expect(warnings.some((message) => message.includes("unsupported"))).toBe(true)
  })

  test("registers an fs/observed invalidator scoped to the corpus", () => {
    // The fs/observed listeners the row registered: exactly one is expected.
    const { observed } = harness()
    expect(observed.length).toBe(1)
    // Counts invalidation calls, so a read or an out-of-corpus path can be proven NOT to invalidate.
    let invalidated = 0
    // Second ctx whose invalidator counts instead of doing nothing.
    const ctx = {
      skills: { registerProvider: (create: (control: { invalidate: () => void }) => Provider) => create({ invalidate: () => { invalidated += 1 } }) },
      logger: { warn: () => {} },
      on: (event: string, fn: (...args: any[]) => void) => { if (event === "fs/observed") observed.push(fn) },
    }
    apply(ctx as any, { skipLegacyCleanup: true })
    // The listener the apply() above registered (the last one observed).
    const listener = observed[observed.length - 1]
    listener({ displayPath: join(realCorpus, "dsh-qa", "SKILL.md") }, undefined, { name: "edit" })
    expect(invalidated).toBe(1)
    listener({ displayPath: "/somewhere/else/SKILL.md" }, undefined, { name: "edit" })
    listener({ displayPath: join(realCorpus, "dsh-qa", "SKILL.md") }, undefined, { name: "read" })
    expect(invalidated).toBe(1)
  })
})

describe("legacy home-copy migration", () => {
  test("removes only stamped bundle copies and leaves user content alone", () => {
    // Sandbox home for this case; DSH_HOME is pointed at it and restored in finally.
    const home = sandboxHome()
    // Saved DSH_HOME value, restored in finally so the mutation cannot leak into another test.
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      mkdirSync(join(home, "skills", "dsh-qa"), { recursive: true })
      writeFileSync(join(home, "skills", "dsh-qa", "SKILL.md"), skillFile("name: dsh-qa\ndescription: legacy copy"))
      mkdirSync(join(home, "skills", "my-own"), { recursive: true })
      writeFileSync(join(home, "skills", "my-own", "SKILL.md"), skillFile("name: my-own\ndescription: user skill"))
      writeFileSync(join(home, "skills", ".mpd-skills-version"), "0.2.6")
      mkdirSync(join(home, ".agent-presets", "mpd"), { recursive: true })
      writeFileSync(join(home, ".agent-presets", "mpd", "preset.yml"), "name: mpd\n")
      mkdirSync(join(home, ".agent-presets", "mine"), { recursive: true })
      writeFileSync(join(home, ".agent-presets", "mine", "preset.yml"), "name: mine\n")
      writeFileSync(join(home, ".agent-presets", ".mpd-presets-version"), "0.2.6")
      harness({ skillsDir: realCorpus, skipLegacyCleanup: false })
      expect(existsSync(join(home, "skills", "dsh-qa"))).toBe(false)
      expect(existsSync(join(home, "skills", "my-own", "SKILL.md"))).toBe(true)
      expect(existsSync(join(home, ".agent-presets", "mpd"))).toBe(false)
      expect(existsSync(join(home, ".agent-presets", "mine", "preset.yml"))).toBe(true)
      expect(existsSync(join(home, ".agent-presets", ".mpd-presets-version"))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  test("never touches an unstamped home (legacy installer copies survive)", () => {
    // Sandbox home for this case; the row must read it and change nothing here.
    const home = sandboxHome()
    // Saved DSH_HOME value, restored in finally so the unstamped state cannot leak into another test.
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      mkdirSync(join(home, "skills", "dsh-qa"), { recursive: true })
      writeFileSync(join(home, "skills", "dsh-qa", "SKILL.md"), skillFile("name: dsh-qa\ndescription: installer copy"))
      mkdirSync(join(home, ".agent-presets", "mpd"), { recursive: true })
      harness({ skillsDir: realCorpus, skipLegacyCleanup: false })
      expect(existsSync(join(home, "skills", "dsh-qa", "SKILL.md"))).toBe(true)
      expect(existsSync(join(home, ".agent-presets", "mpd"))).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
