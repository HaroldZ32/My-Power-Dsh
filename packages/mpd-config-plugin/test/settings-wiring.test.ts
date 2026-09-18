// Wiring tests for the settings→mpd.jsonc bridge inside the `mpd-config` row
// (design §1/§2/§6/§A.1/§10.3; captain ruling 1: the namespace is registered by
// mpd-tui-plugin, this row only reads/writes through the adapter seam).
//
// The harness below is the ADAPTER SEAM, not a fake harness service: the row must
// never touch `ctx.settings` itself, so injecting a stub `mpdDsh` service proves both
// the wiring and the boundary.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { apply } from "../src/index"
import { TEAM_MODEL_SLOT_DEFAULTS } from "../src/settings-schema"

const temps: string[] = []
function sandbox(): { root: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-"))
  temps.push(dir)
  const root = join(dir, "ws")
  mkdirSync(join(root, ".mpd"), { recursive: true })
  return { root, file: join(root, ".mpd", "mpd.jsonc") }
}

/**
 * The fake adapter's MOUNT-TIME fallback root: an explicit empty fixture, never
 * `process.cwd()`. A checkout that has its own `.mpd/mpd.jsonc` (this repo does) must not
 * become an implicit fixture — that coupling is what made the U15 "no live root" case and
 * the ZERO-live-roots base case fail by cwd (T-57). Bare temp dir, no `.mpd` at all, which
 * is exactly the "no file there" premise those two cases need.
 */
function mountRootFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-mount-"))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.MPD_DSH_TUI_SETTINGS_BRIDGE
})

interface HarnessOptions {
  roots?: string[]
  /** Explicit mount-time fallback root; defaults to a fresh empty fixture (never `process.cwd()`). */
  mountRoot?: string
  user?: any
  revision?: number
  settingsAvailable?: boolean
  fileContent?: string
}

function harness(options: HarnessOptions = {}) {
  const roots = options.roots ?? []
  const mountRoot = options.mountRoot ?? mountRootFixture()
  const registered: any[] = []
  const logs: string[] = []
  const mutates: Array<{ ns: string; ops: any[]; expected?: number }> = []
  const provided: Record<string, any> = {}
  let userSection = options.user
  let revision = options.revision ?? 1
  let listener: ((revision?: number, source?: string) => void) | undefined
  const registrations: Array<{ ns: string; schema: unknown; options?: { base?: any; applies?: string } }> = []
  let registrationError: string | undefined
  const adapter = {
    settingsRegister: (ns: string, schema: unknown, options?: { base?: any; applies?: string }) => {
      registrations.push({ ns, schema, options })
      return registrationError === undefined ? { ok: true } : { ok: false, error: registrationError }
    },
    workspaceRoot: (exec?: any) => exec?.agent?.session?.header?.cwd ?? roots[0] ?? mountRoot,
    workspaceRootsAll: () => [...roots],
    settingsReader: (ns: string) =>
      options.settingsAvailable === false || ns !== "mpd"
        ? undefined
        : {
            get: () => userSection,
            describe: () => ({ value: userSection, revision, user: userSection, base: {}, applies: "restart" }),
          },
    onSettingsDocumentUpdated: (_ns: string, l: (revision?: number, source?: string) => void) => {
      listener = l
      return () => { listener = undefined }
    },
    settingsMutate: async (ns: string, ops: any[], expected?: number) => {
      mutates.push({ ns, ops, expected })
      // emulate the provider's own document update so a later read sees it
      for (const op of ops) {
        if (op.op === "unset") {
          const [head, ...rest] = op.path
          if (rest.length === 0) { const next = { ...(userSection ?? {}) }; delete next[head]; userSection = next; continue }
          const next = { ...(userSection ?? {}) }
          let cursor = next
          for (const part of op.path.slice(0, -1)) { const child = { ...(cursor[part] ?? {}) }; cursor[part] = child; cursor = child }
          delete cursor[op.path[op.path.length - 1]]
          userSection = next
        } else {
          const next = { ...(userSection ?? {}) }
          let cursor: any = next
          for (const part of op.path.slice(0, -1)) { const child = { ...(cursor[part] ?? {}) }; cursor[part] = child; cursor = child }
          cursor[op.path[op.path.length - 1]] = op.value
          userSection = next
        }
      }
      revision += 1
      // the host emits the raw-section change from inside write() — model it, so the tests
      // exercise the real re-read path (and the loop gates) rather than a quiet mutation
      listener?.(revision, "update")
      return { ok: true }
    },
    registerTool: (definition: any) => { registered.push(definition); return () => { registered.splice(registered.indexOf(definition), 1) } },
  }
  const ctx: any = {
    get: (serviceName: string) => (serviceName === "mpdDsh" ? adapter : undefined),
    provide: (serviceName: string, value: any) => { provided[serviceName] = value },
    logger: { warn: (message: string) => { logs.push(String(message)) } },
  }
  return {
    ctx,
    mountRoot,
    registered,
    logs,
    mutates,
    registrations,
    failRegistration: (error: string) => { registrationError = error },
    provided,
    emit: (source?: string) => { revision += 1; listener?.(revision, source) },
    setUser: (section: any) => { userSection = section },
    getUser: () => userSection,
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  }
}

function bridgeLines(logs: string[]): any[] {
  return logs.filter((line) => line.startsWith("[mpd-config] settings bridge")).map((line) => {
    const at = line.indexOf("{")
    return at === -1 ? { message: line } : { ...JSON.parse(line.slice(at)), message: line }
  })
}

describe("namespace ownership (design §10.1): THIS package registers, with the file-derived base", () => {
  test("one registration, applies:'restart', and the base is the FILE layer — never the resolved value", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  // file layer\n  "ulw": { "maxRounds": 3 },\n  "hashline": { "maxDiffChars": 111 },\n}\n`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } } })
    apply(h.ctx)
    expect(h.registrations).toHaveLength(1)
    expect(h.registrations[0].ns).toBe("mpd")
    expect(h.registrations[0].options?.applies).toBe("restart")
    // the base carries the FILE values (L1+L2), so a front door can mark an override and reset
    // back to the file's value; the settings-layer value (9) is the user section, not the base
    expect(h.registrations[0].options?.base).toEqual({ ulw: { maxRounds: 3 }, hashline: { maxDiffChars: 111 } })
    expect(h.provided.mpdConfig.states().settings.registration).toBe("registered")
    expect(h.provided.mpdConfig.states().settings.baseFromFiles).toBe(true)
    expect(h.provided.mpdConfig.states().settings.baseReason).toBe("one-live-root")
  })

  test("a refused registration names the host's reason and leaves the TUI fallback to own it", () => {
    const { root } = sandbox()
    const h = harness({ roots: [root] })
    h.failRegistration('settings namespace "mpd" is already registered')
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().settings.registration).toBe('settings namespace "mpd" is already registered')
    expect(h.logs.some((line) => line.includes("the TUI fallback owns it now"))).toBe(true)
  })

  test("A3 'not a lost edit': with N roots refused, the READ-IN still resolves the new value for every workspace", () => {
    const a = sandbox()
    const b = sandbox()
    writeFileSync(a.file, `{ "ulw": { "maxRounds": 3 } }`)
    writeFileSync(b.file, `{ "ulw": { "maxRounds": 4 } }`)
    const h = harness({ roots: [a.root, b.root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(h.provided.mpdConfig.states().writeback.skipped).toBe("ambiguous-multi-root")
    // no file was written …
    expect(readFileSync(a.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(readFileSync(b.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 4 } }`)
    // … and the host-global settings layer applies to EVERY workspace's resolved config, so the
    // edit is delayed in persistence, never lost (captain ruling 1)
    expect(h.provided.mpdConfig.reload({ agent: { session: { header: { cwd: a.root } } } })?.ulw?.maxRounds).toBe(11)
    expect(h.provided.mpdConfig.reload({ agent: { session: { header: { cwd: b.root } } } })?.ulw?.maxRounds).toBe(11)
  })
})

describe("read-in precedence (design §1.1/§10.4, U12)", () => {
  test("L3 outranks the file layers, and a missing L3 key falls back to the file", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  // keep me\n  "ulw": { "maxRounds": 3 },\n  "hashline": { "maxDiffChars": 111 },\n}\n`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } } })
    apply(h.ctx)
    const service = h.provided.mpdConfig
    expect(service.get("ulw.maxRounds")).toBe(9) // L3 wins
    expect(service.get("hashline.maxDiffChars")).toBe(111) // L2 survives underneath
    const settingsState = service.states().settings
    expect(settingsState).toMatchObject({ namespace: "mpd", serviceReady: true, served: true, applied: true })
    expect(settingsState.revision).toBeGreaterThanOrEqual(1)
  })

  test("the in-namespace marker never becomes config and never reaches the file", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  "ulw": { "maxRounds": 3 },\n}\n`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 }, bridge: { migratedRevision: 4 } } })
    apply(h.ctx)
    expect(h.provided.mpdConfig.get("bridge")).toBeUndefined()
    expect(h.provided.mpdConfig.get()).toEqual({ ulw: { maxRounds: 9 } })
    expect(h.provided.mpdConfig.states().applies).toBe("restart") // U17
  })

  test("with the namespace unserved the file layers still resolve (degraded, not fatal)", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 4 } }`)
    const h = harness({ roots: [root], settingsAvailable: false })
    apply(h.ctx)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(4)
    expect(h.provided.mpdConfig.states().settings.served).toBe(false)
    // the registration line is the ONLY log: the seams this harness provides are all present
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0]).toContain('registered the "mpd" namespace with the file-derived base')
  })
})

describe("the write-back target rules (design §A.1/§10.5)", () => {
  test("U1/A2: one live root — a front-door edit rewrites exactly that file, comments intact", async () => {
    const { root, file } = sandbox()
    const original = `{\n  // human comment\n  "ulw": { "maxRounds": 3 },\n}\n`
    writeFileSync(file, original)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(original.replace("3", "11"))
    expect(readFileSync(file, "utf8")).toContain("// human comment")
    const report = h.provided.mpdConfig.states().writeback
    expect(report.writtenTo).toEqual([file])
    expect(report.results[0].outcome).toBe("written")
    expect(report.applies).toBe("restart")
    expect(report.source).toBe("update")
    expect(bridgeLines(h.logs).at(-1)?.message).toContain("WROTE")
  })

  test("U13: zero live roots writes NOTHING anywhere and says so", () => {
    const h = harness({ roots: [], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    const report = h.provided.mpdConfig.states().writeback
    expect(report.skipped).toBe("no-live-session")
    expect(report.writtenTo).toEqual([])
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(11) // the settings layer still took effect
    expect(h.logs.some((line) => line.includes("not yet written to any .mpd/mpd.jsonc"))).toBe(true)
  })

  test("U14 must-fail-on-fanout: two live roots REFUSE, name both, and touch no file", () => {
    const a = sandbox()
    const b = sandbox()
    writeFileSync(a.file, `{ "ulw": { "maxRounds": 3 } }`)
    writeFileSync(b.file, `{ "ulw": { "maxRounds": 3 } }`)
    const h = harness({ roots: [a.root, b.root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    const report = h.provided.mpdConfig.states().writeback
    expect(report.skipped).toBe("ambiguous-multi-root")
    expect(report.writtenTo).toEqual([])
    expect(report.candidates).toEqual([a.root, b.root])
    expect(report.results).toEqual([])
    expect(readFileSync(a.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(readFileSync(b.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    const loud = h.logs.find((line) => line.includes("ambiguous"))
    expect(loud).toContain(a.root)
    expect(loud).toContain(b.root)
    expect(loud).toContain("NOT written to any file")
  })

  test("A6 negative control: the switch disables the FILE write only, never the value", () => {
    const { root, file } = sandbox()
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx, { settingsBridge: { writeBack: false } })
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(h.provided.mpdConfig.states().writeback.skipped).toBe("disabled")
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(11)
    expect(h.logs.some((line) => line.includes("write-back is DISABLED"))).toBe(true)
  })

  test("the design's flat key (`writeBack:false`) disables it too, and both spellings are reported", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx, { writeBack: false })
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(h.provided.mpdConfig.states().writeback.skipped).toBe("disabled")
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(11)
    expect(h.provided.mpdConfig.states().settings.writeBackEnabled).toBe(false)
  })

  test("the env lever disables it too (MPD_DSH_TUI_SETTINGS_BRIDGE=off)", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    process.env.MPD_DSH_TUI_SETTINGS_BRIDGE = "off"
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(h.provided.mpdConfig.states().writeback.skipped).toBe("disabled")
  })

  test("a provider reload is a READ-IN only: it never echoes into a file write", () => {
    const { root, file } = sandbox()
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 42 } })
    h.emit("provider")
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(h.provided.mpdConfig.states().writeback).toBeNull()
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42) // still the read-in value
  })

  test("a raw-section change with NO new leaf writes nothing (the loop gate)", () => {
    const { root, file } = sandbox()
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.emit("update") // same section, new revision
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(h.provided.mpdConfig.states().writeback).toBeNull()
  })
})

describe("migration (design §6, U15)", () => {
  test("a pre-seeded user section migrates into the file once and records the marker", async () => {
    const { root, file } = sandbox()
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } }, revision: 4 })
    apply(h.ctx)
    await h.settle()
    const text = readFileSync(file, "utf8")
    expect(JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""))).toEqual({ ulw: { maxRounds: 9 } })
    expect(text.startsWith("// mpd.jsonc — written by the mpd settings bridge (")).toBe(true)
    // the marker names the revision the section has once the marker write lands (rev 4 -> 5)
    expect(h.mutates).toEqual([{ ns: "mpd", ops: [{ op: "set", path: ["bridge", "migratedRevision"], value: 5 }], expected: 4 }])
    expect(h.provided.mpdConfig.states().migration).toBe("migrated")
  })

  test("idempotence: a second boot at the recorded revision writes nothing", async () => {
    const { root, file } = sandbox()
    const header = `// mpd.jsonc — written by the mpd settings bridge (2026-09-15T00:00:00.000Z)\n// Comments and key order are preserved: the bridge rewrites only the values it is asked to change.\n`
    writeFileSync(file, header + `{\n  "ulw": {\n    "maxRounds": 9,\n  },\n}\n`)
    const before = readFileSync(file, "utf8")
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 }, bridge: { migratedRevision: 4 } }, revision: 4 })
    apply(h.ctx)
    await h.settle()
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(h.mutates).toEqual([])
    expect(h.provided.mpdConfig.states().migration).toBe("already-migrated")
  })

  test("with no live root the migration is DEFERRED and nothing is written to the mount-time fallback root", async () => {
    const mount = mountRootFixture()
    const h = harness({ roots: [], mountRoot: mount, user: { ulw: { maxRounds: 9 } }, revision: 2 })
    apply(h.ctx)
    await h.settle()
    expect(h.provided.mpdConfig.states().migration).toBe("deferred-no-workspace")
    expect(h.mutates).toEqual([])
    // The premise is asserted against the harness's OWN resolved root — an explicit empty
    // fixture, never `process.cwd()` — so the developer's own `.mpd/mpd.jsonc` cannot
    // falsify it (T-57: this assertion used to read `join(process.cwd(), ".mpd", "mpd.jsonc")`).
    expect(h.mountRoot).toBe(mount)
    expect(h.mountRoot).not.toBe(process.cwd())
    expect(existsSync(join(h.mountRoot, ".mpd", "mpd.jsonc"))).toBe(false)
    expect(h.logs.some((line) => line.includes("migration deferred"))).toBe(true)
  })

  test("two live roots defer the migration with the ambiguous reason, not a guess", async () => {
    const a = sandbox()
    const b = sandbox()
    const h = harness({ roots: [a.root, b.root], user: { ulw: { maxRounds: 9 } }, revision: 2 })
    apply(h.ctx)
    await h.settle()
    expect(h.provided.mpdConfig.states().migration).toBe("deferred-ambiguous-multi-root")
    expect(existsSync(a.file)).toBe(false)
    expect(existsSync(b.file)).toBe(false)
  })

  test("a refusing target aborts the migration loudly and leaves the document alone", async () => {
    const { root, file } = sandbox()
    writeFileSync(file, '{ "ulw": }') // unparsable
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } }, revision: 2 })
    apply(h.ctx)
    await h.settle()
    expect(h.provided.mpdConfig.states().migration).toBe("writeback-failed")
    expect(readFileSync(file, "utf8")).toBe('{ "ulw": }')
    expect(h.mutates).toEqual([])
    expect(h.logs.some((line) => line.includes("migration did NOT complete"))).toBe(true)
  })
})

describe("the §1.2 clearing rule (a fresh FILE edit wins over a stale override)", () => {
  test("a file value the bridge recorded is unset from the user section under the revision fence", async () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } }, revision: 4 })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 6 } })
    h.emit("update") // the bridge records the file value it wrote (6)
    expect(readFileSync(file, "utf8")).toContain("6")
    // now a HUMAN edits the file directly, without touching the settings document …
    writeFileSync(file, `{ "ulw": { "maxRounds": 99 } }`)
    // … and the layer re-reads (the watcher/reload path) — the override must be cleared
    h.provided.mpdConfig.reload()
    await h.settle()
    expect(h.provided.mpdConfig.states().cleared).toEqual(["ulw.maxRounds"])
    const unset = h.mutates.find((call) => call.ops[0].op === "unset")
    expect(unset?.ops).toEqual([{ op: "unset", path: ["ulw", "maxRounds"] }])
    expect(h.logs.some((line) => line.includes("a file edit won"))).toBe(true)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(99) // the USER SECTION is gone; the file is now the authority
    expect(readFileSync(file, "utf8")).toContain("99")
  })
})


describe("the file-derived base under the captain's cardinality rule (§10.1 + ruling)", () => {
  test("ONE live root: the base is that workspace's file (a file value that differs from the schema default)", () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "hashline": { "maxDiffChars": 35000 } }`)
    const h = harness({ roots: [root] })
    apply(h.ctx)
    expect(h.registrations[0].options?.base).toEqual({ hashline: { maxDiffChars: 35000 } })
    expect(h.provided.mpdConfig.states().settings.baseReason).toBe("one-live-root")
    expect(h.provided.mpdConfig.get("hashline.maxDiffChars")).toBe(35000) // not the schema default 20000
  })

  test("ZERO live roots: the mount-time root is used, and no file there means an empty base (schema defaults)", () => {
    const mount = mountRootFixture()
    const h = harness({ roots: [], mountRoot: mount })
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().settings.baseReason).toBe("mount-time-root")
    // "no file THERE" is asserted on the explicit fixture root the adapter resolved to, so
    // this case cannot silently read the checkout's own `.mpd/mpd.jsonc` (T-57: the mount-time
    // root used to be `process.cwd()`, which made the base non-empty in this repo).
    expect(h.mountRoot).toBe(mount)
    expect(existsSync(join(h.mountRoot, ".mpd", "mpd.jsonc"))).toBe(false)
    expect(h.registrations[0].options?.base).toEqual({})
  })

  test("N live roots: NO base is invented, the ambiguity is surfaced, and the schema defaults stand", () => {
    const a = sandbox()
    const b = sandbox()
    writeFileSync(a.file, `{ "hashline": { "maxDiffChars": 35000 } }`)
    writeFileSync(b.file, `{ "hashline": { "maxDiffChars": 12345 } }`)
    const h = harness({ roots: [a.root, b.root] })
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().settings.baseReason).toBe("ambiguous-multi-root")
    expect(h.provided.mpdConfig.states().settings.baseFromFiles).toBe(false)
    expect(h.provided.mpdConfig.states().settings.baseCandidates).toEqual([a.root, b.root])
    expect(h.registrations[0].options?.base).toBeUndefined()
    // The NAMESPACE carrying no base is the ruling's point. The config layer's READ-IN is per
    // workspace (each session resolves its own file), which is the correct multi-session behaviour:
    expect(h.provided.mpdConfig.reload({ agent: { session: { header: { cwd: a.root } } } })?.hashline?.maxDiffChars).toBe(35000)
    expect(h.provided.mpdConfig.reload({ agent: { session: { header: { cwd: b.root } } } })?.hashline?.maxDiffChars).toBe(12345)
    const loud = h.logs.find((line) => line.includes("the namespace base is NOT derived from a file"))
    expect(loud).toContain(a.root)
    expect(loud).toContain(b.root)
  })
})

describe("the team-model slots are a READ-path projection only (A2)", () => {
  test("a fully absent .mpd/mpd.jsonc still resolves the three slot defaults", async () => {
    // No `.mpd` directory at all: the workspace has no file for the layer to read.
    const bare = mkdtempSync(join(tmpdir(), "mpd-wiring-bare-"))
    temps.push(bare)
    const h = harness({ roots: [bare] })
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().files).toEqual([])
    expect(h.provided.mpdConfig.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(h.provided.mpdConfig.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    // … and the tool consumer sees the same resolved view.
    const get = h.registered.find((tool: any) => tool.name === "mpd_config_get")
    const payload = await get.execute({})
    expect(payload.config.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    await h.settle()
  })

  test("NEGATIVE CONTROL: an unrelated settings-document save never injects a teamModels block into the file", async () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    // A save of an UNRELATED knob through the settings document: the bridge writes that leaf and
    // only that leaf, because its delta comes from the settings document, never from the resolved
    // config — so the materialised slot defaults cannot leak into the workspace file.
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    await h.settle()
    const text = readFileSync(file, "utf8")
    expect(text).toContain('"maxRounds": 11')
    expect(text).not.toContain("teamModels")
    expect(JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""))).toEqual({ ulw: { maxRounds: 11 } })
    expect(h.provided.mpdConfig.states().writeback.writtenTo).toEqual([file])
    // the READ path still answers with the slots, materialised and never written back
    expect(h.provided.mpdConfig.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(h.provided.mpdConfig.get()).not.toHaveProperty("teamModels")
  })

  test("a slot leaf SAVED through the settings document is what lands in the file (the slots stay editable)", async () => {
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 3 }, teamModels: { slot2: { model: "deepseek-v4-pro" } } })
    h.emit("update")
    await h.settle()
    expect(JSON.parse(readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, ""))).toEqual({
      ulw: { maxRounds: 3 },
      teamModels: { slot2: { model: "deepseek-v4-pro" } },
    })
    expect(h.provided.mpdConfig.get("teamModels.slot2")).toEqual({ provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "high" })
    expect(h.provided.mpdConfig.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
  })
})
