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
import { join, resolve } from "node:path"
import { apply } from "../src/index"
import { TEAM_MODEL_SLOT_DEFAULTS } from "../src/settings-schema"

/** Temp paths created by this file's fixtures, drained by the shared `afterEach` so no run leaks state. */
const temps: string[] = []
/** Build one isolated workspace: its root, and the `.mpd/mpd.jsonc` path under it (not created here). */
function sandbox(): { root: string; file: string } {
  /** Unique throwaway directory; `mkdtempSync` is what keeps two fixtures from colliding. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-"))
  temps.push(dir)
  /** The workspace subdirectory: the file path is derived from it, so a case never writes at the temp root. */
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
  /** Fresh bare temp directory with no `.mpd` of its own, so "no file there" is a real premise. */
  const dir = mkdtempSync(join(tmpdir(), "mpd-wiring-mount-"))
  temps.push(dir)
  return dir
}
// Every fixture directory is removed after each case, and the bridge env lever is unset so one
// case's `MPD_DSH_TUI_SETTINGS_BRIDGE` cannot leak into the next.
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.MPD_DSH_TUI_SETTINGS_BRIDGE
})

/** How long a watcher case waits for the 150ms debounce plus the reload it triggers. */
const WATCH_SETTLE_MS = 400

/**
 * Yield for `ms` milliseconds, so a watcher's debounce and its async reload can run.
 * @param ms - the wall-clock budget to give the row's timer.
 * @returns a promise that settles after that budget.
 */
function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

/** The knobs a wiring case may set on the fake adapter before the row is applied. */
interface HarnessOptions {
  /** Live session workspaces the adapter reports; the cardinality drives the write target and the base. */
  roots?: string[]
  /** Explicit mount-time fallback root; defaults to a fresh empty fixture (never `process.cwd()`). */
  mountRoot?: string
  /** The `bridge`-stripped settings user section (L3), i.e. what the front door last saved. */
  user?: any
  /** Revision the host reports for that section; the migration marker is fenced against it. */
  revision?: number
  /** `false` makes `settingsReader("mpd")` answer `undefined`, the degraded no-namespace case. */
  settingsAvailable?: boolean
  /** Pre-existing text of the workspace `mpd.jsonc`, when a case needs a file with content. */
  fileContent?: string
}

/**
 * The ADAPTER-SEAM test double: it records what the row registers, serves the workspace/settings
 * seams, and hands the row an `mpdDsh` service, so a failure names the seam the row actually used.
 * Its state is mutable per case (`setUser`, `emit`, `failRegistration`), and the two payloads whose
 * shape only the row's own `apply()` decides (`registered`, `provided`) stay `any`.
 */
function harness(options: HarnessOptions = {}): {
  /** The cordis context handed to `apply`: `get("mpdDsh")` serves the adapter below. */
  ctx: Parameters<typeof apply>[0]
  /** The mount-time root the adapter resolved to, asserted against the fixture the case created. */
  mountRoot: string
  /** Tool definitions the row registered, so a case can execute a tool without a live harness. */
  registered: any[]
  /** Everything the row logged, in order; `bridgeLines` parses the structured bridge entries. */
  logs: string[]
  /** Every `settingsMutate` call the row made, with the revision fence it passed. */
  mutates: { ns: string; ops: any[]; expected?: number }[]
  /** Every namespace registration the row made, with its base and `applies` hint. */
  registrations: { ns: string; schema: unknown; options?: { base?: unknown; applies?: string } }[]
  /** Makes the next `settingsRegister` answer `{ ok: false, error }`, the already-registered case. */
  failRegistration: (error: string) => void
  /** Services the row provided, keyed by name (`mpdConfig` is the one under test). */
  provided: Record<string, any>
  /** Replays the host's document event: bump the revision, then notify the row's listener. */
  emit: (source?: string) => void
  /** Replaces the raw settings section the reader serves — the front door's save. */
  setUser: (section: any) => void
  /** The current raw section, so a case can assert what the bridge left behind. */
  getUser: () => unknown
  /** Disposers the row registered through `ctx.effect`, with the label it registered them under. */
  effects: { label: string | undefined; dispose: () => void }[]
  /** Dispose everything the row registered in its own scope, i.e. what an unload does. */
  unload: () => void
  /** Yields to the macrotask queue so the row's async migration/settle work runs before assertions. */
  settle: () => Promise<void>
} {
  /** Live workspaces the adapter reports; empty means no session has a workspace to write into. */
  const roots = options.roots ?? []
  /** Workspace the adapter falls back to with no live session: the mount-time root, or the fixture. */
  const mountRoot = options.mountRoot ?? mountRootFixture()
  /** Tool definitions captured by the `registerTool` stub, so a case can call `mpd_config_get`. */
  const registered: any[] = []
  /** Every log line the row emitted, in order; cases assert on specific messages in here. */
  const logs: string[] = []
  /** `settingsMutate` calls in order, so the migration marker write can be pinned exactly. */
  const mutates: Array<{ ns: string; ops: any[]; expected?: number }> = []
  /** Services the row provided through the context stub (`mpdConfig` is the one under test). */
  const provided: Record<string, any> = {}
  /** Disposers the row registered through `ctx.effect`, in registration order. */
  const effects: { label: string | undefined; dispose: () => void }[] = []
  /** The raw settings section the reader serves; a case mutates it to emulate a front-door save. */
  let userSection = options.user
  /** Current revision of that section, bumped by every save so the row's fence can be observed. */
  let revision = options.revision ?? 1
  /** The row's `settings/document-updated` listener, i.e. the seam under test; cleared on unload. */
  let listener: ((revision?: number, source?: string) => void) | undefined
  /** `settingsRegister` calls in order: namespace, schema and options (base + `applies`). */
  const registrations: Array<{ ns: string; schema: unknown; options?: { base?: any; applies?: string } }> = []
  /** When set, the next registration is REFUSED with this host reason instead of succeeding. */
  let registrationError: string | undefined
  /** The fake `mpdDsh` service: each member mirrors one adapter seam the row is allowed to call. */
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
          /** Head of the op's path, i.e. the top-level key whose whole subtree an empty tail removes. */
          const [head, ...rest] = op.path
          if (rest.length === 0) {
            /** Shallow copy so the removed-key case never mutates the section the reader captured. */
            const next = { ...(userSection ?? {}) }
            delete next[head]
            userSection = next
            continue
          }
          /** Copy of the section being rebuilt, so a nested removal does not mutate the captured one. */
          const next = { ...(userSection ?? {}) }
          /** Cursor walking the copied chain; each level is replaced by a copy before descending. */
          let cursor = next
          for (const part of op.path.slice(0, -1)) {
            /** Copied child of the current level, so the host's own object identity is never touched. */
            const child = { ...(cursor[part] ?? {}) }
            cursor[part] = child
            cursor = child
          }
          delete cursor[op.path[op.path.length - 1]]
          userSection = next
        } else {
          /** Copy of the section being rebuilt, so a nested set does not mutate the captured one. */
          const next = { ...(userSection ?? {}) }
          /** Cursor walking the copied chain; each level is replaced by a copy before descending. */
          let cursor: any = next
          for (const part of op.path.slice(0, -1)) {
            /** Copied child of the current level, so the host's own object identity is never touched. */
            const child = { ...(cursor[part] ?? {}) }
            cursor[part] = child
            cursor = child
          }
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
    /** Captures a tool definition and returns the matching unregister handle. */
    registerTool: (definition: any) => { registered.push(definition); return () => { registered.splice(registered.indexOf(definition), 1) } },
  }
  /** The context `apply` receives; untyped because the double implements only the seams the row uses. */
  const ctx: any = {
    get: (serviceName: string) => (serviceName === "mpdDsh" ? adapter : undefined),
    provide: (serviceName: string, value: any) => { provided[serviceName] = value },
    logger: { warn: (message: string) => { logs.push(String(message)) } },
    // The row's OWN scope. A disposer returned here runs on unload (cordis' own effect contract),
    // which is what the watcher-lifetime case drives.
    effect: (callback: () => unknown, label?: string) => {
      /** Whatever the callback registered: a disposer when it returned one. */
      const disposer = callback()
      if (typeof disposer === "function") effects.push({ label, dispose: disposer as () => void })
      return typeof disposer === "function" ? disposer : () => { /* nothing to dispose */ }
    },
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
    effects,
    unload: () => { for (const registered of effects.splice(0)) registered.dispose() },
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  }
}

/** The structured half of every `[mpd-config] settings bridge` log line, newest last. */
function bridgeLines(logs: string[]): any[] {
  return logs.filter((line) => line.startsWith("[mpd-config] settings bridge")).map((line) => {
    /** Index of the line's opening brace, i.e. where the bridge's JSON payload starts. */
    const at = line.indexOf("{")
    return at === -1 ? { message: line } : { ...JSON.parse(line.slice(at)), message: line }
  })
}

describe("namespace ownership (design §10.1): THIS package registers, with the file-derived base", () => {
  test("one registration, applies:'restart', and the base is the FILE layer — never the resolved value", () => {
    /** Workspace fixture whose FILE carries both layers' values, to be distinguished from L3. */
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  // file layer\n  "ulw": { "maxRounds": 3 },\n  "hashline": { "maxDiffChars": 111 },\n}\n`)
    /** Fake adapter whose user section overrides only `ulw.maxRounds`, so the base may not use it. */
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
    /** Workspace fixture; only its root is needed, since this case never writes a file. */
    const { root } = sandbox()
    /** Fake adapter set up to REFUSE the namespace registration on the next `apply`. */
    const h = harness({ roots: [root] })
    h.failRegistration('settings namespace "mpd" is already registered')
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().settings.registration).toBe('settings namespace "mpd" is already registered')
    // MEASURED (2026-09-27): no harness composes a namespace registry any more, so the line this
    // arm used to pin ("the TUI fallback owns it now") described a handover that no longer happens.
    // What matters now is that a refused registration is still REPORTED, and says where the values
    // actually come from: this row's own Config, served under the entry id.
    expect(h.logs.some((line) => line.includes("namespace-registry model is RETIRED"))).toBe(true)
    expect(h.logs.some((line) => line.includes('entry "mpd-config"'))).toBe(true)
  })

  test("A3 'not a lost edit': with N roots refused, the READ-IN still resolves the new value for every workspace", () => {
    /** First live workspace, whose file the read-in must resolve to the settings value. */
    const a = sandbox()
    /** Second live workspace, with a DIFFERENT file value, so a wrong pick would be visible. */
    const b = sandbox()
    writeFileSync(a.file, `{ "ulw": { "maxRounds": 3 } }`)
    writeFileSync(b.file, `{ "ulw": { "maxRounds": 4 } }`)
    /** Fake adapter reporting both workspaces, the case where the WRITE is refused. */
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
    /** Workspace fixture whose file supplies the value L3 must outrank. */
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  // keep me\n  "ulw": { "maxRounds": 3 },\n  "hashline": { "maxDiffChars": 111 },\n}\n`)
    /** Fake adapter whose user section carries the winning `ulw.maxRounds` value. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } } })
    apply(h.ctx)
    /** The `mpdConfig` service the row provided, read through the seam consumers use. */
    const service = h.provided.mpdConfig
    expect(service.get("ulw.maxRounds")).toBe(9) // L3 wins
    expect(service.get("hashline.maxDiffChars")).toBe(111) // L2 survives underneath
    /** The settings half of `states()`, which reports the namespace's health and revision. */
    const settingsState = service.states().settings
    expect(settingsState).toMatchObject({ namespace: "mpd", serviceReady: true, served: true, applied: true })
    expect(settingsState.revision).toBeGreaterThanOrEqual(1)
  })

  test("the in-namespace marker never becomes config and never reaches the file", () => {
    /** Workspace fixture: the live root, and the `.mpd/mpd.jsonc` the layer reads. */
    const { root, file } = sandbox()
    writeFileSync(file, `{\n  "ulw": { "maxRounds": 3 },\n}\n`)
    /** Fake adapter with the user section seeded, so the marker case starts from a real save. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 }, bridge: { migratedRevision: 4 } } })
    apply(h.ctx)
    expect(h.provided.mpdConfig.get("bridge")).toBeUndefined()
    expect(h.provided.mpdConfig.get()).toEqual({ ulw: { maxRounds: 9 } })
    expect(h.provided.mpdConfig.states().applies).toBe("restart") // U17
  })

  test("with the namespace unserved the file layers still resolve (degraded, not fatal)", () => {
    /** Workspace fixture whose file carries a value the degraded read must still find. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 4 } }`)
    /** Fake adapter with the `mpd` namespace UNSERVED, so only the file layers can answer. */
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
    /** Sole live workspace, whose file the save must rewrite in place. */
    const { root, file } = sandbox()
    /** Exact pre-save text, compared afterwards to prove only the edited value moved. */
    const original = `{\n  // human comment\n  "ulw": { "maxRounds": 3 },\n}\n`
    writeFileSync(file, original)
    /** Fake adapter whose user section mirrors the file, so the save is a real change of that leaf. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(original.replace("3", "11"))
    expect(readFileSync(file, "utf8")).toContain("// human comment")
    /** The bridge's own report for that save, i.e. what it claims it did and where. */
    const report = h.provided.mpdConfig.states().writeback
    expect(report.writtenTo).toEqual([file])
    expect(report.results[0].outcome).toBe("written")
    expect(report.applies).toBe("restart")
    expect(report.source).toBe("update")
    expect(bridgeLines(h.logs).at(-1)?.message).toContain("WROTE")
  })

  test("U13: zero live roots writes NOTHING anywhere and says so", () => {
    /** Fake adapter with NO live session, so the save has no workspace to target. */
    const h = harness({ roots: [], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    /** The report for a save with nowhere to write; it must name that reason, not invent a target. */
    const report = h.provided.mpdConfig.states().writeback
    expect(report.skipped).toBe("no-live-session")
    expect(report.writtenTo).toEqual([])
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(11) // the settings layer still took effect
    expect(h.logs.some((line) => line.includes("not yet written to any .mpd/mpd.jsonc"))).toBe(true)
  })

  test("U14 must-fail-on-fanout: two live roots REFUSE, name both, and touch no file", () => {
    /** First of two live workspaces, both of which a fan-out write would have to touch. */
    const a = sandbox()
    /** Second live workspace, with a different file value than `a` so a wrong pick is visible. */
    const b = sandbox()
    writeFileSync(a.file, `{ "ulw": { "maxRounds": 3 } }`)
    writeFileSync(b.file, `{ "ulw": { "maxRounds": 3 } }`)
    /** Fake adapter reporting BOTH workspaces live, the ambiguous-target case. */
    const h = harness({ roots: [a.root, b.root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    /** The refusal report; it must name both candidates and claim no write. */
    const report = h.provided.mpdConfig.states().writeback
    expect(report.skipped).toBe("ambiguous-multi-root")
    expect(report.writtenTo).toEqual([])
    expect(report.candidates).toEqual([a.root, b.root])
    expect(report.results).toEqual([])
    expect(readFileSync(a.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(readFileSync(b.file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    /** The ambiguous-target log line, which must name both workspaces a human may choose from. */
    const loud = h.logs.find((line) => line.includes("ambiguous"))
    expect(loud).toContain(a.root)
    expect(loud).toContain(b.root)
    expect(loud).toContain("NOT written to any file")
  })

  // S1: ONE target resolver. The row config's `projectFile` is a documented knob, so the write
  // must land on the SAME file the read resolves — never on the `<root>/.mpd/mpd.jsonc` default.
  test("S1: with a `projectFile` override the WRITE target equals the READ target", () => {
    /** The sole live workspace; its default file is the path the pre-fix bridge wrote instead. */
    const { root, file: defaultFile } = sandbox()
    /** The file the row config names — deliberately NOT the default target of this root. */
    const override = resolve(join(root, "custom", "mpd.jsonc"))
    mkdirSync(join(root, "custom"), { recursive: true })
    writeFileSync(override, `{ "ulw": { "maxRounds": 3 } }`)
    /** Both files start at the pre-save value, so a wrong target is visible as a changed byte. */
    writeFileSync(defaultFile, `{ "ulw": { "maxRounds": 3 } }`)
    /** The fake adapter with the override-bearing row config and one live root. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx, { projectFile: override })
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    /** The bridge's own report: the file it claims it wrote. */
    const report = h.provided.mpdConfig.states().writeback
    // THE PIN: the write target is the configured file, identical to what `loadConfig` reads.
    expect(report.writtenTo).toEqual([override])
    expect(readFileSync(override, "utf8")).toContain("11")
    // ...and the default path is byte-untouched: the pre-fix bridge wrote (and would CREATE) it.
    expect(readFileSync(defaultFile, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
  })

  test("A6 negative control: the switch disables the FILE write only, never the value", () => {
    /** Sole live workspace, whose file must stay byte-identical while the switch is off. */
    const { root, file } = sandbox()
    /** Pre-save text, compared afterwards to prove the disabled write touched nothing. */
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    /** Fake adapter for a one-root save, applied with the nested `settingsBridge.writeBack` switch off. */
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
    /** Sole live workspace, whose file must stay byte-identical while the switch is off. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    /** Fake adapter for a one-root save, applied with the FLAT `writeBack` spelling. */
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
    /** Sole live workspace, whose file must stay byte-identical while the env lever is off. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    process.env.MPD_DSH_TUI_SETTINGS_BRIDGE = "off"
    /** Fake adapter for a one-root save, with the disable coming from the environment only. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    expect(readFileSync(file, "utf8")).toBe(`{ "ulw": { "maxRounds": 3 } }`)
    expect(h.provided.mpdConfig.states().writeback.skipped).toBe("disabled")
  })

  test("a provider reload is a READ-IN only: it never echoes into a file write", () => {
    /** Sole live workspace, which a provider-sourced event must NOT rewrite. */
    const { root, file } = sandbox()
    /** Pre-event text, compared afterwards to prove the read-in stayed a read. */
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    /** Fake adapter for a one-root save, driven with `provider` as the event source. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.setUser({ ulw: { maxRounds: 42 } })
    h.emit("provider")
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(h.provided.mpdConfig.states().writeback).toBeNull()
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42) // still the read-in value
  })

  test("a raw-section change with NO new leaf writes nothing (the loop gate)", () => {
    /** Sole live workspace, whose file must stay byte-identical when no leaf changed. */
    const { root, file } = sandbox()
    /** Pre-event text, compared afterwards to prove the unchanged section wrote nothing. */
    const original = `{ "ulw": { "maxRounds": 3 } }`
    writeFileSync(file, original)
    /** Fake adapter whose user section ALREADY mirrors the file, so a new revision adds no leaf. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    h.emit("update") // same section, new revision
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(h.provided.mpdConfig.states().writeback).toBeNull()
  })
})

// S5: the fs watcher is a ROW-SCOPE resource. An unload must dispose it, timer included — the
// pre-fix code stored its disposer in a map nobody drained, so the watch outlived the row.
describe("the project-file watcher's lifetime (S5)", () => {
  test("an unload closes the watcher: a later file edit no longer reloads the config", async () => {
    /** Sole live workspace, whose project file the watcher observes. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    // L3 carries a key the FILE does not, so the value read below can only have come from the
    // file — i.e. from a reload the WATCHER performed, never from a settings-layer echo.
    /** Fake adapter whose save establishes the watcher through a real write-back. */
    const h = harness({ roots: [root], user: { boulder: { maxRounds: 0 } } })
    apply(h.ctx)
    h.setUser({ boulder: { maxRounds: 1 } })
    h.emit("update") // the write-back is what calls watchRoot(root)
    // POSITIVE CONTROL: while the row is mounted, a direct file edit IS observed (150ms debounce).
    writeFileSync(file, `{ "ulw": { "maxRounds": 42 }, "boulder": { "maxRounds": 1 } }`)
    await wait(WATCH_SETTLE_MS)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42)
    // THE UNLOAD: every disposer the row registered in its OWN scope runs, as cordis does on teardown.
    h.unload()
    writeFileSync(file, `{ "ulw": { "maxRounds": 77 }, "boulder": { "maxRounds": 1 } }`)
    await wait(WATCH_SETTLE_MS)
    // With the watcher closed and its debounce timer cleared, nothing reloads: the resolved value
    // still carries what the mounted row last read. (Pre-fix: 77, because the watcher survived.)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(42)
  })
})

describe("migration (design §6, U15)", () => {
  test("a pre-seeded user section migrates into the file once and records the marker", async () => {
    /** Sole live workspace that receives the migrated section. */
    const { root, file } = sandbox()
    /** Fake adapter whose pre-seeded section carries a value the migration must persist. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 } }, revision: 4 })
    apply(h.ctx)
    await h.settle()
    /** The migrated document, whose JSON half and header are asserted separately below. */
    const text = readFileSync(file, "utf8")
    expect(JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""))).toEqual({ ulw: { maxRounds: 9 } })
    expect(text.startsWith("// mpd.jsonc — written by the mpd settings bridge (")).toBe(true)
    // the marker names the revision the section has once the marker write lands (rev 4 -> 5)
    expect(h.mutates).toEqual([{ ns: "mpd", ops: [{ op: "set", path: ["bridge", "migratedRevision"], value: 5 }], expected: 4 }])
    expect(h.provided.mpdConfig.states().migration).toBe("migrated")
  })

  test("idempotence: a second boot at the recorded revision writes nothing", async () => {
    /** Sole live workspace, already migrated by an earlier boot. */
    const { root, file } = sandbox()
    /** The exact header the bridge writes when it creates a document, replayed byte for byte. */
    const header = `// mpd.jsonc — written by the mpd settings bridge (2026-09-15T00:00:00.000Z)\n// Comments and key order are preserved: the bridge rewrites only the values it is asked to change.\n`
    writeFileSync(file, header + `{\n  "ulw": {\n    "maxRounds": 9,\n  },\n}\n`)
    /** The pre-boot text, compared afterwards to prove the second boot wrote nothing at all. */
    const before = readFileSync(file, "utf8")
    /** Fake adapter reporting the recorded revision and marker, i.e. a second boot of the same state. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 9 }, bridge: { migratedRevision: 4 } }, revision: 4 })
    apply(h.ctx)
    await h.settle()
    expect(readFileSync(file, "utf8")).toBe(before)
    expect(h.mutates).toEqual([])
    expect(h.provided.mpdConfig.states().migration).toBe("already-migrated")
  })

  test("with no live root the migration is DEFERRED and nothing is written to the mount-time fallback root", async () => {
    /** The explicit mount-time root, which the migration must leave untouched. */
    const mount = mountRootFixture()
    /** Fake adapter with NO live root, so the migration can only be deferred. */
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
    /** First of two live workspaces, between which the migration target would be ambiguous. */
    const a = sandbox()
    /** Second live workspace; neither file may be created while the target is ambiguous. */
    const b = sandbox()
    /** Fake adapter reporting both roots as live for a migration that must be deferred. */
    const h = harness({ roots: [a.root, b.root], user: { ulw: { maxRounds: 9 } }, revision: 2 })
    apply(h.ctx)
    await h.settle()
    expect(h.provided.mpdConfig.states().migration).toBe("deferred-ambiguous-multi-root")
    expect(existsSync(a.file)).toBe(false)
    expect(existsSync(b.file)).toBe(false)
  })

  test("a refusing target aborts the migration loudly and leaves the document alone", async () => {
    /** Sole live workspace whose existing file is deliberately unparsable. */
    const { root, file } = sandbox()
    writeFileSync(file, '{ "ulw": }') // unparsable
    /** Fake adapter carrying a section to migrate, so the failure is the target's, not an empty one. */
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
    /** Sole live workspace, whose file the human edit below rewrites behind the settings document. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    /** Fake adapter whose section starts equal to the file and whose revision fence is 4. */
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
    /** The `unset` mutation among the recorded ones, i.e. the clear this rule exists to perform. */
    const unset = h.mutates.find((call) => call.ops[0].op === "unset")
    expect(unset?.ops).toEqual([{ op: "unset", path: ["ulw", "maxRounds"] }])
    expect(h.logs.some((line) => line.includes("a file edit won"))).toBe(true)
    expect(h.provided.mpdConfig.get("ulw.maxRounds")).toBe(99) // the USER SECTION is gone; the file is now the authority
    expect(readFileSync(file, "utf8")).toContain("99")
  })
})


describe("the file-derived base under the captain's cardinality rule (§10.1 + ruling)", () => {
  test("ONE live root: the base is that workspace's file (a file value that differs from the schema default)", () => {
    /** Sole live workspace, whose file value differs from the schema default and pins the base. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "hashline": { "maxDiffChars": 35000 } }`)
    /** Fake adapter with one live root and NO user section, so the file alone forms the base. */
    const h = harness({ roots: [root] })
    apply(h.ctx)
    expect(h.registrations[0].options?.base).toEqual({ hashline: { maxDiffChars: 35000 } })
    expect(h.provided.mpdConfig.states().settings.baseReason).toBe("one-live-root")
    expect(h.provided.mpdConfig.get("hashline.maxDiffChars")).toBe(35000) // not the schema default 20000
  })

  test("ZERO live roots: the mount-time root is used, and no file there means an empty base (schema defaults)", () => {
    /** The explicit mount-time root, which the empty base must be derived from. */
    const mount = mountRootFixture()
    /** Fake adapter with NO live root, so the base falls back to the mount-time root. */
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
    /** First live workspace, whose own file value must still answer its own sessions' reads. */
    const a = sandbox()
    /** Second live workspace, with a different file value, so a single shared base would be wrong. */
    const b = sandbox()
    writeFileSync(a.file, `{ "hashline": { "maxDiffChars": 35000 } }`)
    writeFileSync(b.file, `{ "hashline": { "maxDiffChars": 12345 } }`)
    /** Fake adapter reporting both roots live, the ambiguity that forbids inventing a base. */
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
    /** The log line naming every candidate when no single file base could be derived. */
    const loud = h.logs.find((line) => line.includes("the namespace base is NOT derived from a file"))
    expect(loud).toContain(a.root)
    expect(loud).toContain(b.root)
  })
})

describe("the team-model slots are a READ-path projection only (A2)", () => {
  test("a fully absent .mpd/mpd.jsonc still resolves the three slot defaults", async () => {
    // No `.mpd` directory at all: the workspace has no file for the layer to read.
    /** Bare workspace with no `.mpd` directory at all; `mkdtempSync` guarantees it exists and is empty. */
    const bare = mkdtempSync(join(tmpdir(), "mpd-wiring-bare-"))
    temps.push(bare)
    /** Fake adapter whose only live root holds no config file, the materialisation case. */
    const h = harness({ roots: [bare] })
    apply(h.ctx)
    expect(h.provided.mpdConfig.states().files).toEqual([])
    expect(h.provided.mpdConfig.get("teamModels")).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    expect(h.provided.mpdConfig.get("teamModels.slot1")).toEqual(TEAM_MODEL_SLOT_DEFAULTS.slot1)
    // … and the tool consumer sees the same resolved view.
    /** The `mpd_config_get` tool the row registered, executed below as a consumer would. */
    const get = h.registered.find((tool: any) => tool.name === "mpd_config_get")
    /** That tool's answer for a key-less call, which must carry the materialised slots. */
    const payload = await get.execute({})
    expect(payload.config.teamModels).toEqual(TEAM_MODEL_SLOT_DEFAULTS)
    await h.settle()
  })

  test("NEGATIVE CONTROL: an unrelated settings-document save never injects a teamModels block into the file", async () => {
    /** Sole live workspace that receives the unrelated knob's new value. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    /** Fake adapter whose save below changes a knob the slots do not depend on. */
    const h = harness({ roots: [root], user: { ulw: { maxRounds: 3 } } })
    apply(h.ctx)
    // A save of an UNRELATED knob through the settings document: the bridge writes that leaf and
    // only that leaf, because its delta comes from the settings document, never from the resolved
    // config — so the materialised slot defaults cannot leak into the workspace file.
    h.setUser({ ulw: { maxRounds: 11 } })
    h.emit("update")
    await h.settle()
    /** The written file, whose whole text is inspected for any trace of the slot defaults. */
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
    /** Sole live workspace that receives the saved slot leaf. */
    const { root, file } = sandbox()
    writeFileSync(file, `{ "ulw": { "maxRounds": 3 } }`)
    /** Fake adapter whose save below carries one slot leaf, which the file must then hold. */
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
