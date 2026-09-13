// mpd-bootstrap unit tests: the bundle-served skill corpus (no home copy) and
// the legacy home-copy migration. Real corpus where it matters, temp fixtures
// for the frontmatter subset and the cleanup ownership rules.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { apply } from "../src/index"

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const realCorpus = join(repoRoot, "skills")

type Provider = { name: string; list: () => Promise<any[]>; get: (candidate: any) => Promise<any> }

function harness(config: Record<string, unknown> = {}): { provider: Provider; warnings: string[]; observed: Array<(...args: any[]) => void> } {
  let provider: Provider | undefined
  const warnings: string[] = []
  const observed: Array<(...args: any[]) => void> = []
  const ctx = {
    skills: {
      registerProvider: (create: (control: { invalidate: () => void }) => Provider) => {
        provider = create({ invalidate: () => {} })
      },
    },
    logger: { warn: (message: string) => { warnings.push(message) } },
    on: (event: string, fn: (...args: any[]) => void) => { if (event === "fs/observed") observed.push(fn) },
  }
  apply(ctx as any, { skipLegacyCleanup: true, ...config })
  if (provider === undefined) throw new Error("apply registered no provider")
  return { provider, warnings, observed }
}

function tempCorpus(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "mpd-corpus-"))
  for (const [rel, body] of Object.entries(files)) {
    const target = join(root, rel)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, body)
  }
  return root
}

const skillFile = (frontmatter: string, body = "# Skill\n\nDo the thing.\n") => `---\n${frontmatter}\n---\n\n${body}`

const homes: string[] = []
function sandboxHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mpd-home-"))
  homes.push(home)
  return home
}

afterEach(() => {
  while (homes.length > 0) rmSync(homes.pop() as string, { recursive: true, force: true })
})

describe("bundle skill corpus provider", () => {
  test("serves every shipped skill as a bundled-rank candidate", async () => {
    const { provider } = harness()
    expect(provider.name).toBe("mpd-bundle")
    const candidates = await provider.list()
    // 19 = the shipped corpus AFTER the RTL skill trees were extracted out of
    // this repository (they are no longer served by this bundle).
    expect(candidates.length).toBeGreaterThanOrEqual(19)
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
    const { provider } = harness()
    const candidates = await provider.list()
    const target = candidates.find((candidate) => candidate.name === "dsh-qa")
    expect(target).toBeDefined()
    const definition = await provider.get(target)
    expect(definition.name).toBe("dsh-qa")
    expect(definition.source).toBe("bundled")
    expect(definition.content.length).toBeGreaterThan(100)
    expect(definition.resourceBase).toEqual({ kind: "directory", path: join(realCorpus, "dsh-qa") })
  })

  test("frontmatter subset: quoted, folded, nested metadata and invocation policy", async () => {
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
    const { provider, warnings } = harness({ skillsDir: root })
    const candidates = await provider.list()
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
    const { observed } = harness()
    expect(observed.length).toBe(1)
    let invalidated = 0
    const ctx = {
      skills: { registerProvider: (create: (control: { invalidate: () => void }) => Provider) => create({ invalidate: () => { invalidated += 1 } }) },
      logger: { warn: () => {} },
      on: (event: string, fn: (...args: any[]) => void) => { if (event === "fs/observed") observed.push(fn) },
    }
    apply(ctx as any, { skipLegacyCleanup: true })
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
    const home = sandboxHome()
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
    const home = sandboxHome()
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
