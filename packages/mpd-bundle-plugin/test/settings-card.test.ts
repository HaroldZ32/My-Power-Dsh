// t35 web card / w14 top-level section: the `mpd` settings UI in the Web Settings dialog.
//
// WHAT IS ASSERTED HERE: (a) the registration shape the host dispatches for a top-level SECTION —
// `{ name: "settings.section", id: "mpd", order, label, locale, inject }` behind
// `ctx.slots.inject`, exactly the pattern the host's own settings-models section uses — and the
// ABSENCE of the old keyed Plugins-tab item registration (w14 moved the section out of that tab);
// (b) the mount reaches the namespace through the harness's `configForms` service and is never a
// declared dependency — `settingsScope`, which this case used to pin, exists NOWHERE in harness
// 0.1.7-rc.2, and pinning a service that does not exist is how the section stayed silently absent
// (measured in docker/ui 2026-09-27: Settings rendered General/Models/Built-in plugins/Agent
// presets, no mpd entry, and no warning anywhere); (c) the form behaviour: it reads what the namespace reports, stages edits, writes
// `mutate(ops, revision)` with NESTED paths, and renders read-only with a reason when the scope
// says `writable === false`; (d) the isolation rules; (e) the eleven fields/labels/zh descriptions
// are IDENTICAL to the TUI section's, so the two front doors cannot drift.
//
// WHAT IS NOT ASSERTED: that a real browser renders the section or that a click produces the
// mutate. No browser binary exists in this environment; that claim is NOT-CLAIMED and the user sees
// it in their own GUI. The rendered-state assertions below run in the offline hook runtime, which is
// a different thing and is labelled as such. Since 2026-09-27 the rendered-state arms below ARE
// backed by a real browser run in docker/ui (screenshots + report.json), which is what caught the
// absent section in the first place.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript5"
import { callerScopedService, loadMpdClient, type CallerScopedService, type CardFace, type CardState, type ElementNode, type ElementProps, type HarnessOptions, type LoadedMpdClient, type SlotRegistration, type TreeChild, type TreeNode } from "./client-harness.ts"
// The ONE shared knob declaration, imported at RUNTIME for the parity test: the card MIRRORS it
// (it must not reference `SETTINGS_KNOBS`, which a QA gate pins against the built client), so the
// test — not the client — compares the two declarations element by element.
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SETTINGS_KNOBS, TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOT_IMPACT, teamModelLeafSentence, teamModelMembers, teamModelSlotHeading, teamModelSlotImpact } from "../../mpd-config-plugin/src/settings-schema"

/** Repository root, three directories above this test file. */
const REPO = join(import.meta.dir, "..", "..", "..")
/** The bundle package directory the card source and artifact live in. */
const PKG = join(REPO, "packages", "mpd-bundle-plugin")
/** The shipped combined client, read as text for the static pins. */
const ARTIFACT = readFileSync(join(PKG, "client.js"), "utf8")
/** The settings card's source, evaluated below and scanned by the static arms. */
const CARD_SOURCE = readFileSync(join(PKG, "src", "settings-card.ts"), "utf8")
/** The card module itself, plus the EN dictionary it renders rows through. */
// The card's source is TypeScript now and `eval` parses JavaScript, so the types are erased first
// with the repo's pinned transpiler (`typescript5`, the aliased typescript@5.9.3); the statement
// terminator the transpiler appends is removed before the expression is wrapped.
/** The card factory source with its type annotations erased. */
const CARD_JS = ts.transpileModule(CARD_SOURCE, {
  compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
}).outputText.trim().replace(/;\s*$/, "")
/** The card module itself, plus the EN dictionary it renders rows through. */
const CARD = (0, eval)("(" + CARD_JS + ")")((name: "react" | "locales") => ({ react: {}, locales: {} })[name] ?? {})
/** The four team-model slot keys the shared declaration declares. */
type SlotKey = keyof typeof TEAM_MODEL_SLOT_GROUPS
/** The card's English dictionary. */
const EN = CARD.dictionaries().en
/** The card's Chinese dictionary. */
const ZH = CARD.dictionaries().zh
/** The twelve slot rows of the card's mirrored declaration, in declaration order. */
const SLOT_ROW_FIELDS = CARD.FIELDS.filter((field: CardField) => field.path[0] === "teamModels")

/** One recorded scope mutation: the ops batch and the revision fence it carried. */
interface ScopeCall {
  /** The ops the card staged, each with its own path and value. */
  ops: Array<{ op: string; path: string[]; value?: unknown }>
  /** The revision the card expected to write against. */
  expected: unknown
}

/** The snapshot a settings scope reports to the card. */
interface ScopeSnapshot {
  /** The scope's status, e.g. ready or unavailable. */
  status: string
  /** The mode the scope resolved, host or memory. */
  mode: string
  /** Whether the scope accepts writes. */
  writable: boolean
  /** The revision a mutate must match. */
  revision: number | undefined
  /** The namespaced value tree the card renders. */
  value: unknown
  /** The user-layer slice of that tree. */
  user: unknown
}

/** The scope double: what it hands `bind`, plus the mutations it recorded. */
interface ScopeDouble {
  /** Bind the section's form; the descriptor must carry the `mpd` namespace. */
  bind: (spec: { namespace: string }) => {
    /** The snapshot the card renders from. */
    getSnapshot: () => ScopeSnapshot
    /** Subscribe to snapshot changes; the double records the listener. */
    subscribe: (listener: () => void) => () => boolean
    /** Record one staged batch and bump the revision. */
    mutate: (ops: Array<{ op: string; path: string[]; value?: unknown }>, expected: unknown) => Promise<void>
    /** Drop the form; the double has nothing to release. */
    dispose: () => void
  }
  /** Every mutation the card performed through this scope. */
  calls: ScopeCall[]
}

/** The registration descriptor a section slot receives, as the predicate inspects it. */
interface SectionDescriptor {
  /** The slot name the host dispatches on. */
  name?: string
  /** The entry id within the slot. */
  id?: string
  /** The sort order the host honours. */
  order?: number
  /** The label, literal or a thunk the host calls per locale. */
  label?: string | (() => string)
  /** The locale namespace the label resolves through. */
  locale?: string
  /** The retired keyed-item field, which must stay absent. */
  key?: unknown
  /** The face factory, which the predicate does not inspect. */
  inject?: () => unknown
  /** Any other descriptor field. */
  [field: string]: unknown
}

/** One mirrored card field, as the parity comparison reads it. */
interface CardField {
  /** The dotted path segments of the field. */
  path: string[]
  /** The English label the shared declaration carries for the same knob. */
  label: unknown
  /** The declared fallback options, when the field has any. */
  options?: unknown[]
  /** Any other field member. */
  [field: string]: unknown
}

/** One provider in a catalog fixture. */
interface CatalogGroup {
  /** The provider id the pickers submit. */
  id: string
  /** The provider's display name. */
  name: string
  /** The provider's models, when it advertises any. */
  models?: Array<Record<string, unknown>>
}

/** The resolver options one catalog fixture is built from. */
interface CatalogServiceOptions {
  /** The session id the fixture binds, defaulting to s1. */
  sessionId?: string
  /** Model an unbound session list, so no id resolves. */
  unbound?: boolean
  /** Make the directory resolver throw, as the live host does without a scope. */
  throwing?: boolean
}

/** The resolver options one caller-scoped catalog fixture is built from. */
interface CatalogScopedOptions {
  /** The dotted seams the resolver reads, defaulting to remote.session. */
  reads?: string[]
  /** The session id the fixture accepts, defaulting to s1. */
  sessionId?: string
}

/** A model-directory double: the store the card subscribes to and an optional loader. */
interface DirectoryDouble {
  /** The directory store the card reads and subscribes to. */
  store: {
    /** The current status and provider groups. */
    getSnapshot: () => { status: string; groups: CatalogGroup[] }
    /** Subscribe to store changes; the double notifies every listener. */
    subscribe: (listener: () => void) => () => unknown
  }
  /** Load the current groups, counting the call when the arm cares. */
  load?: () => Promise<{ groups: CatalogGroup[] }>
}

/** A mutable directory fixture: its store, its load counter and a live provider insert. */
interface MutableDirectory {
  /** The load counter, so an arm can prove the directory was really read. */
  state: { loads: number }
  /** The directory the host resolver hands the card. */
  directory: DirectoryDouble
  /** Add one provider and notify every subscriber, as the host store does. */
  addProvider: (provider: CatalogGroup) => void
}

/** One console line an arm captured. */
interface ConsoleLine {
  /** Which console method emitted it. */
  level: "warn" | "info"
  /** The arguments the page passed. */
  args: unknown[]
}

/** One caller-scoped catalog fixture: its service, its call counter and the host services. */
interface CallerScopedCatalog {
  /** The caller-scoped directory service. */
  service: CallerScopedService
  /** How many times the resolver method body actually ran. */
  calls: { directoryFor: number }
  /** The host services to mount as probe-invisible ones. */
  host: Record<string, unknown>
}

/** The object shape a superseded fixture assumed for the current session. */
interface SessionIdRecord {
  /** The session id under the assumed field name. */
  sessionId?: string
  /** The session id under the second assumed field name. */
  id?: string
}

/** A session-list snapshot in the measured shape: `current` is an id STRING. */
interface SessionSnapshot {
  /** The current session id, or a record in the assumed shape an arm feeds deliberately. */
  current?: string | SessionIdRecord | null
}

/** A settings scope with the host's measured surface, recording every write. */
/** A settings scope with the host's measured surface, recording every write. */
function fakeScope(snapshot: ScopeSnapshot, calls: ScopeCall[] = []): ScopeDouble {
  /** The revision the scope reports, bumped by each mutation. */
  let revision = snapshot.revision
  /** Snapshot subscribers the double would notify. */
  const listeners = new Set<() => void>()
  return {
    bind: (spec) => {
      // The card binds through the ENTRY id (`mpd-config`), and the form it gets back carries the
      // namespace. Both are asserted so a repoint cannot silently change either.
      expect(spec.namespace).toBe("mpd")
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        mutate: async (ops, expected) => {
          calls.push({ ops, expected })
          revision = (revision ?? 0) + 1
        },
        dispose: () => {},
      }
    },
    calls,
  }
}

/** The ready-scope snapshot every form arm starts from. */
const READY = {
  status: "ready",
  mode: "host",
  writable: true,
  revision: 7,
  value: { hashline: { maxDiffChars: 20000 }, ulw: { maxRounds: 6 } },
  user: { ulw: { maxRounds: 6 } },
}

/** Mount the section with a configForms service bound to one scope. */
function mountedCard(scope: ScopeDouble): { client: LoadedMpdClient; registration: SlotRegistration } {
  /** The client this mount built. */
  const client = loadMpdClient({ services: { configForms: { get: (entryId: string) => { expect(entryId).toBe("mpd-config"); return scope.bind({ namespace: "mpd" }) } } } })
  client.exports.apply(client.ctx)
  // The section registers exactly once when its namespace form resolves.
  const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")!
  return { client, registration }
}

/** Flatten an element tree, or any nested value, into its text. */
function textOf(tree: TreeNode): string {
  if (tree === null || tree === undefined) return ""
  if (typeof tree === "string" || typeof tree === "number") return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join(" ")
  return textOf(tree.props?.children)
}

/** The descriptor a top-level section must carry, as one predicate so a mutant can be judged. */
function sectionDescriptorProblems(definition: SectionDescriptor | null | undefined): string[] {
  /** Every problem the descriptor shows, in the order the predicate finds them. */
  const problems: string[] = []
  if (definition === undefined || definition === null) return ["no registration"]
  if (definition.name !== "settings.section") problems.push(`name=${String(definition.name)}`)
  if (definition.id !== "mpd") problems.push(`id=${String(definition.id)}`)
  if (typeof definition.order !== "number") problems.push(`order=${String(definition.order)}`)
  if (typeof definition.label !== "function") problems.push("label is not a function")
  else if (definition.label() !== "MPD") problems.push(`label()=${String(definition.label())}`)
  if (typeof definition.locale !== "string") problems.push("locale is not a string")
  if (definition.key !== undefined) problems.push("carries the retired keyed-item field `key`")
  return problems
}

/** The retired Plugins-tab registration shapes a text carries (empty when the move held). */
function pluginItemRegistrations(text: string): string[] {
  /** The retired registration shapes this text carries. */
  const found: string[] = []
  if (text.includes('slots.inject("settings.plugin.item"')) found.push("slots.inject(settings.plugin.item)")
  if (text.includes('slots.register({ name: "settings.plugin.item"')) found.push("slots.register(settings.plugin.item)")
  return found
}

describe("W2 (static): the BUILT and served client carries the SECTION registration", () => {
  test("the shipped client registers a settings.section with id 'mpd', an explicit order and a label", () => {
    expect(CARD_SOURCE).toContain(
      '{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },',
    )
    expect(ARTIFACT).toContain('const NS = "mpd"')
    expect(ARTIFACT).toContain('const SECTION_ID = "mpd"')
    expect(ARTIFACT).toContain("const SECTION_ORDER = 20")
    expect(ARTIFACT).toContain('const SECTION_SLOT = "settings.section"')
    expect(ARTIFACT).toContain("@mpd-dsh/settings-card")
  })

  test("the Plugins tab's keyed item registration is GONE from the built client (the user's request)", () => {
    expect(pluginItemRegistrations(ARTIFACT)).toEqual([])
    expect(ARTIFACT).not.toContain("settings.plugin.item")
    expect(CARD_SOURCE).not.toContain("settings.plugin.item")
  })

  test("NEGATIVE CONTROL: the absence predicate reddens the moment the retired registration returns", () => {
    /** The retired keyed-item shape behind `slots.inject`. */
    const injectForm = 'ctx.slots.inject("settings.plugin.item", function* () { yield ctx.slots.register({ name: "settings.plugin.item", key: "mpd" }, Card) })'
    /** The retired keyed-item shape behind `slots.register`. */
    const registerForm = 'ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: LOCALE_NS }, Card)'
    expect(pluginItemRegistrations(injectForm)).toEqual(["slots.inject(settings.plugin.item)", "slots.register(settings.plugin.item)"])
    expect(pluginItemRegistrations(registerForm)).toEqual(["slots.register(settings.plugin.item)"])
    expect(pluginItemRegistrations(ARTIFACT)).toEqual([])
  })

  test("the mount reaches configForms and the client still declares only the stable seams", () => {
    expect(ARTIFACT).toContain('ctx.inject(["configForms"]')
    expect(ARTIFACT).not.toContain('ctx.inject(["settingsScope"]')
    expect(ARTIFACT).toContain('const REQUIRED_SERVICES = ["slots", "locale"]')
    expect(ARTIFACT).not.toContain('REQUIRED_SERVICES = ["slots", "locale", "configForms"]')
  })

  test("the disclosure copy is the same sentence the TUI states, and no stale claim survives", () => {
    expect(CARD_SOURCE).toContain("a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s)")
    expect(CARD_SOURCE).toContain("after a restart")
    expect(CARD_SOURCE).toContain("never lost")
    expect(CARD_SOURCE).not.toContain("not bridged")
  })
})

describe("the registration only happens when the namespace form is available", () => {
  test("no configForms -> no entry, one warning-free degrade, no throw out of apply", () => {
    /** The client this arm mounts without the namespace form. */
    const client = loadMpdClient()
    expect(() => client.exports.apply(client.ctx)).not.toThrow()
    expect((client.calls.slotsRegistered ?? []).some((definition) => definition.name === "settings.section")).toBe(false)
    expect(client.calls.slots).toContain("settings.section")
    expect(client.calls.slots).not.toContain("settings.plugin.item")
  })

  test("configForms at apply -> one SECTION entry, and its descriptor passes the whole predicate", () => {
    /** The client and the section registration it produced. */
    const { registration } = mountedCard(fakeScope(READY))
    expect(sectionDescriptorProblems(registration)).toEqual([])
    expect(registration.name).toBe("settings.section")
    expect(registration.id).toBe("mpd")
    expect(registration.order).toBe(20)
    expect(registration.label()).toBe("MPD")
    expect(registration.children).toBeUndefined() // this section renders no nested slot
    expect(registration.key).toBeUndefined() // the retired keyed-item field is gone
    expect(typeof registration.locale).toBe("string")
    expect(typeof registration.inject).toBe("function")
    expect(typeof registration.component).toBe("function")
    // the inject face is the host's contract: one hook store + the four form actions
    const face = registration.inject()
    expect(typeof face.hooks?.mpdCard?.getSnapshot).toBe("function")
    for (const action of ["edit", "resetField", "save", "discard"]) expect(typeof face[action]).toBe("function")
  })

  test("NEGATIVE CONTROL: the descriptor predicate reddens on every mutant that matters", () => {
    /** A descriptor that passes every clause, for the mutants to drift. */
    const good = { name: "settings.section", id: "mpd", order: 20, label: () => "MPD", locale: "mpdSettings", inject: () => ({}) }
    expect(sectionDescriptorProblems(good)).toEqual([])
    expect(sectionDescriptorProblems({ ...good, order: undefined })).toContain("order=undefined")
    expect(sectionDescriptorProblems({ ...good, id: "plugins" })).toContain("id=plugins")
    expect(sectionDescriptorProblems({ ...good, label: "MPD" })).toContain("label is not a function")
    expect(sectionDescriptorProblems({ ...good, locale: undefined })).toContain("locale is not a string")
    expect(sectionDescriptorProblems({ ...good, key: "mpd" })).toContain("carries the retired keyed-item field `key`")
    expect(sectionDescriptorProblems(undefined)).toEqual(["no registration"])
  })

  test("a late-served configForms still mounts the section (provideService wakes the fiber)", () => {
    /** The client this arm mounts before the late service arrives. */
    const client = loadMpdClient()
    client.exports.apply(client.ctx)
    expect((client.calls.slotsRegistered ?? []).some((definition) => definition.name === "settings.section")).toBe(false)
    client.provideService("configForms", { get: (entryId: string) => { expect(entryId).toBe("mpd-config"); return fakeScope(READY).bind({ namespace: "mpd" }) } })
    /** The registration the late-served service produced. */
    const late = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
    expect(sectionDescriptorProblems(late)).toEqual([])
  })
})

describe("the card's form behaviour", () => {
  test("it renders what the namespace reports (values, overridden marker, disclosure) and nothing invented", async () => {
    /** This arm's client and section registration. */
    const { client, registration } = mountedCard(fakeScope(READY))
    /** The rendered section tree. */
    const tree = await client.hooks.render(registration.component, { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => key })
    /** The tree flattened and serialized, so the assertions can scan it. */
    const text = textOf(tree) + " " + JSON.stringify(tree)
    expect(text).toContain("hashline.maxDiffChars")
    expect(text).toContain("ulw.maxRounds")
    expect(text).toContain("20000")
    expect(text).toContain("6")
    expect(text).toContain("a save writes <workspace>/.mpd/mpd.jsonc")
    expect(text).toContain("save")
  })

  test("a save writes nested PATHS through scope.mutate with the revision fence", async () => {
    /** Every mutation this arm's scope recorded. */
    const calls: ScopeCall[] = []
    /** This arm's client and section registration. */
    const { registration } = mountedCard(fakeScope(READY, calls))
    /** The section's host-facing face. */
    const face = registration.inject()
    face.edit("hashline.maxDiffChars", "4096")
    face.edit("memory.vcs", "git")
    await face.save()
    expect(calls).toHaveLength(1)
    expect(calls[0].expected).toBe(7)
    expect(calls[0].ops.sort((a, b) => a.path.join(".").localeCompare(b.path.join(".")))).toEqual([
      { op: "set", path: ["hashline", "maxDiffChars"], value: 4096 },
      { op: "set", path: ["memory", "vcs"], value: "git" },
    ])
  })

  test("resetField asks for the file value (unset), and an invalid draft refuses to save", async () => {
    /** Every mutation this arm's scope recorded. */
    const calls: ScopeCall[] = []
    /** This arm's client and section registration. */
    const { registration } = mountedCard(fakeScope(READY, calls))
    /** The section's host-facing face. */
    const face = registration.inject()
    face.resetField("ulw.maxRounds")
    await face.save()
    expect(calls[0].ops).toEqual([{ op: "unset", path: ["ulw", "maxRounds"] }])

    /** Every mutation the read-only scope recorded, which must stay empty. */
    const calls2: ScopeCall[] = []
    /** The second arm's client, under its own read-only scope. */
    const { registration: second } = mountedCard(fakeScope(READY, calls2))
    /** The read-only section's host-facing face. */
    const face2 = second.inject()
    face2.edit("hashline.maxDiffChars", "not-a-number")
    await face2.save()
    expect(calls2).toEqual([]) // a draft that is not a value its field accepts carries NO write
    expect(face2.hooks.mpdCard.getSnapshot().invalid).toBe(true)
  })

  test("a read-only scope renders read-only with a reason and writes nothing", async () => {
    /** Every mutation this arm's read-only scope recorded. */
    const calls: ScopeCall[] = []
    /** This arm's client and section registration. */
    const { client, registration } = mountedCard(fakeScope({ status: "unavailable", mode: "memory", writable: false, revision: undefined, value: undefined, user: undefined }, calls))
    /** The section's host-facing face. */
    const face = registration.inject()
    /** The read-only state the card exposes to its component. */
    const state = face.hooks.mpdCard.getSnapshot()
    expect(state.writable).toBe(false)
    expect(state.mode).toBe("memory")
    face.edit("ulw.maxRounds", "9")
    /** The rendered section tree. */
    const tree = await client.hooks.render(registration.component, { useMpdCard: (selector) => selector(face.hooks.mpdCard.getSnapshot()), t: (key) => key })
    /** The tree flattened and serialized, so the assertions can scan it. */
    const text = textOf(tree) + " " + JSON.stringify(tree)
    expect(text).toContain("readOnly")
    expect(text).toContain("memoryMode")
    // the inputs are disabled, and a save through the face still goes nowhere (the HOST refuses it)
    await face.save()
    expect(calls).toHaveLength(0)
  })
})

describe("isolation and front-door parity", () => {
  test("web-client.js is the ONLY source that requires the card module, and the card does no I/O", () => {
    /** Every source file the package ships, in directory order. */
    const files = readdirSync(join(PKG, "src")).filter((name) => name.endsWith(".js") || name.endsWith(".ts"))
    /** The sources that require the card module. */
    const referencing = files.filter((name) => readFileSync(join(PKG, "src", name), "utf8").includes("@mpd-dsh/settings-card"))
    expect(referencing).toEqual(["web-client.ts"])
    for (const banned of ["writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync", "createWriteStream", "fetch(", "XMLHttpRequest", "localStorage"]) {
      expect(CARD_SOURCE).not.toContain(banned)
    }
    expect(existsSync(join(PKG, "src", "settings-card.ts"))).toBe(true)
    expect(readFileSync(join(REPO, "scripts", "build-mpd-client.ts"), "utf8")).toContain("@mpd-dsh/settings-card")
  })

  test("the card's twenty-six fields/labels/zh descriptions/options are IDENTICAL to the ONE shared declaration (no drift)", () => {
    // Both front doors read the same knob list — the TUI imports it, the card MIRRORS it — so this
    // compares the card against that single source at RUNTIME (the twelve team-model rows are built
    // from slot ids and labels in the declaration, which no source-text grep can follow).
    // Same erasure as the module-level load above: this arm re-evaluates the source to read the
    // declaration the card exports, so it needs the transpiled text too.
    const { FIELDS } = (0, eval)("(" + CARD_JS + ")")((name: "react" | "locales") => ({ react: {}, locales: {} })[name] ?? {})
    expect(Array.isArray(FIELDS)).toBe(true)
    // 26 = the shared list after the twelve team-model slot leaves joined it (13 scalar knobs + 12
    // leaves) plus the TUI surface's own `tui.dashboardKey` (the Ctrl+A takeover toggle); the
    // element-wise loop below is what makes this a no-drift pin, not a magic number.
    expect(FIELDS).toHaveLength(26)
    expect(SETTINGS_KNOBS).toHaveLength(26)
    expect(FIELDS.map((field: CardField) => field.path)).toEqual(SETTINGS_KNOBS.map((knob) => [...knob.path]))
    for (const [index, field] of FIELDS.entries()) {
      /** The shared declaration's knob at the same index. */
      const knob = SETTINGS_KNOBS[index]
      // A6: the FULL path array, never only its first two segments (the slot leaves are 3 deep).
      expect([...field.path]).toEqual([...knob.path])
      expect(field.label).toBe(knob.label)
      expect(field.zh).toBe(knob.zh)
      expect(field.kind).toBe(knob.kind)
      // the DECLARED fallback options are the parity surface (§1.3); the LIVE lists differ by design
      expect(field.options ?? []).toEqual([...(knob.options ?? [])])
      // w16: a knob that carries a semantics sentence must carry the SAME one as the shared hint
      if (field.semantics !== undefined) {
        expect(knob.hint).toContain(field.semantics)
        // ...and for the twelve slot leaves the human sentence is DECLARED on the knob in BOTH
        // locales (the card mirrors it); the two watchdog rows keep their raw sentence AS the
        // knob's hint, which is the shape they have always had.
        if (knob.semantics !== undefined) {
          expect(field.semantics).toBe(knob.semantics)
          expect(field.semanticsZh).toBe(knob.semanticsZh)
        } else {
          expect(knob.hint).toBe(field.semantics)
        }
      }
    }
    /** The twelve team-model slot rows of the mirrored declaration. */
    const slotRows = FIELDS.filter((field: CardField) => field.path[0] === "teamModels")
    expect(slotRows).toHaveLength(12)
    for (const row of slotRows) expect(row.kind).toBe("select")
    // and the TUI builds its section from that list rather than restating it
    const tuiSource = readFileSync(join(REPO, "packages", "mpd-tui-plugin", "src", "settings.ts"), "utf8")
    expect(tuiSource).toContain("SETTINGS_KNOBS.map(")
    expect(tuiSource).toContain('from "../../mpd-config-plugin/src/settings-schema"')
    // the card itself must never import the declaration (the client bytes may not carry the symbol)
    expect(CARD_SOURCE).not.toContain("SETTINGS_KNOBS")
    expect(ARTIFACT).not.toContain("SETTINGS_KNOBS")
  })

  test("NEGATIVE CONTROL: the parity pin reddens on a drifted label, a shortened path and a changed declared list", () => {
    /** The mirrored declaration the drift arms copy (from the same transpiled text as above). */
    const { FIELDS } = (0, eval)("(" + CARD_JS + ")")((name: "react" | "locales") => ({ react: {}, locales: {} })[name] ?? {})
    /** Copy the field list with one patched entry, so the pin can be reddened. */
    const drift = (index: number, patch: Record<string, unknown>): CardField[] => {
      /** The mutable copy the patch lands on. */
      const copy = FIELDS.map((field: CardField) => ({ ...field, path: [...field.path] }))
      Object.assign(copy[index], patch)
      return copy
    }
    /** Compare every field against the shared declaration, clause by clause. */
    const compare = (fields: CardField[]): boolean[][] => fields.map((field, index) => {
      /** The shared declaration's knob at the same index. */
      const knob = SETTINGS_KNOBS[index]
      return [JSON.stringify([...field.path]) === JSON.stringify([...knob.path]), field.label === knob.label, JSON.stringify(field.options ?? []) === JSON.stringify([...(knob.options ?? [])])]
    })
    /** The comparison of the untouched declaration, which must be clean. */
    const clean = compare(FIELDS)
    expect(clean.every((row) => row.every(Boolean))).toBe(true)
      /** The index of the last field, the one the mutants patch. */
    const last = FIELDS.length - 1
    expect(compare(drift(last, { label: "Slot 3 reasoning effort (drifted)" }))[last][1]).toBe(false)
    expect(compare(drift(last, { path: ["teamModels", "slot3"] }))[last][0]).toBe(false)
    expect(compare(drift(last, { options: ["high"] }))[last][2]).toBe(false)
  })

  test("every slot row LEADS with its group's human sentence, in BOTH locales, before its key", () => {
    expect(SLOT_ROW_FIELDS).toHaveLength(12)
    for (const field of SLOT_ROW_FIELDS) {
      /** The slot segment of this row's path. */
      const slot = field.path[1]
      /** The leaf segment of this row's path. */
      const leaf = field.path[2]
      /** The slot number the label and heading interpolate. */
      const index = Number(String(slot).slice(4))
      /** The declared member group this slot routes. */
      // The slot segment comes off a dynamic path, so the index needs the key union named.
      const group = TEAM_MODEL_SLOT_GROUPS[slot as SlotKey]
      // the label names the group in the language it is written in
      expect(field.label).toBe(`Slot ${index} ${String(leaf).replace("reasoningEffort", "reasoning effort")} (${group.en})`)
      expect(field.zh).toBe(`槽位 ${index} ${leaf === "reasoningEffort" ? "推理强度" : leaf === "provider" ? "提供商" : "模型"}（${group.zh}）`)
      // the sentence is the DECLARED one for THIS slot and leaf
      expect(field.semantics).toBe(teamModelLeafSentence(slot, leaf, "en"))
      expect(field.semanticsZh).toBe(teamModelLeafSentence(slot, leaf, "zh"))
      if (slot === "slot4") {
        // slot 4 states the image-input constraint INSTEAD of the shared-route sentence; the
        // declaration's own builders are the pin, and both locales name the member.
        expect(field.semantics).toContain("Vision Analyst")
        expect(field.semanticsZh).toContain("Vision Analyst")
        expect(String(field.semantics)).not.toContain("Architect")
      } else {
        // slots 1-3 interpolate their group name and member list into the shared templates
        expect(field.semantics).toContain(`the ${group.en} (${teamModelMembers(slot, "en")})`)
        expect(field.semanticsZh).toContain(`${group.zh}（${teamModelMembers(slot, "zh")}）`)
      }
      // the COMPOSED hint of each locale starts with that sentence and only then states the key
      const key = field.path.join(".")
      for (const [dictionary, sentence] of [[EN, field.semantics], [ZH, field.semanticsZh]]) {
        /** The composed hint of this locale, which must lead with the sentence. */
        const hint = dictionary[key + ".hint"]
        expect(hint.startsWith(sentence)).toBe(true)
        // the sentence, then the dotted key in parentheses — and NOT the surface's disclosure
        expect(hint).toBe(`${sentence} (mpd.jsonc ${key})`)
        expect(hint).not.toContain(BRIDGE_DISCLOSURE)
        expect(hint).not.toContain(BRIDGE_NOT_LOST)
      }
    }
    // a slot's sentence is GROUP-SPECIFIC: slot 2 speaks about its own members, never slot 1's.
    const slot2Provider = SLOT_ROW_FIELDS.find((field: CardField) => field.path.join(".") === "teamModels.slot2.provider")
    expect(slot2Provider.semantics).toContain("analysis members (Researcher, Explorer, Plan Reviewer)")
    expect(slot2Provider.semantics).not.toContain("Architect")
    expect(slot2Provider.semantics).toContain("Vision Analyst") // the vision member is slot 4's
    // the scalar rows keep their declared shape: a row with a human sentence leads with it, and a
    // row without one keeps the disclosure-only hint it always had (no invented copy).
    for (const field of CARD.FIELDS.filter((row: CardField) => row.path[0] !== "teamModels")) {
      /** The dotted key of this scalar row. */
      const key = field.path.join(".")
      /** The English hint the row renders. */
      const hint = EN[key + ".hint"]
      if (field.semantics === undefined) expect(hint.startsWith("mpd.jsonc " + key)).toBe(true)
      else expect(hint.startsWith(field.semantics)).toBe(true)
      expect(hint).toContain("mpd.jsonc " + key)
      // The disclosure lives ONCE on the surface, not in any row.
      expect(hint).not.toContain(BRIDGE_DISCLOSURE)
      expect(hint).not.toContain(BRIDGE_NOT_LOST)
    }
  })

  test("each slot's group heading and one-line impact are DECLARED, above the slot's own rows", () => {
    for (const slot of ["slot1", "slot2", "slot3", "slot4"] as SlotKey[]) {
      /** The slot number the heading interpolates. */
      const index = Number(slot.slice(4))
      expect(EN[`teamModels.${slot}.heading`]).toBe(teamModelSlotHeading(slot, "en"))
      expect(ZH[`teamModels.${slot}.heading`]).toBe(teamModelSlotHeading(slot, "zh"))
      expect(EN[`teamModels.${slot}.heading`]).toBe(`Slot ${index} — ${TEAM_MODEL_SLOT_GROUPS[slot].en} (${teamModelMembers(slot, "en")})`)
      expect(ZH[`teamModels.${slot}.heading`]).toBe(`槽位 ${index} —— ${TEAM_MODEL_SLOT_GROUPS[slot].zh}（${teamModelMembers(slot, "zh")}）`)
      // slots 1-3 share the impact; slot 4 has its own (image input), so the accessor is the pin.
      expect(EN[`teamModels.${slot}.impact`]).toBe(teamModelSlotImpact(slot, "en"))
      expect(ZH[`teamModels.${slot}.impact`]).toBe(teamModelSlotImpact(slot, "zh"))
    }
    // and slot 4 is NOT the shared sentence, in either locale
    expect(EN["teamModels.slot4.impact"]).not.toBe(TEAM_MODEL_SLOT_IMPACT.en)
    expect(EN["teamModels.slot4.impact"]).toContain("MUST accept image input")
    expect(ZH["teamModels.slot4.impact"]).toContain("本档的模型必须支持图像输入")
    expect(EN["teamModels.slot4.heading"]).toBe("Slot 4 — vision member (Vision Analyst)")
    expect(ZH["teamModels.slot4.heading"]).toBe("槽位 4 —— 视觉成员（Vision Analyst）")
  })
})

describe("the team-model slots render as DEPENDENT pickers fed by the live catalog (A5)", () => {
  /** A two-provider catalog in the host's own shape, with per-model reasoning efforts. */
  const CATALOG = [
    {
      id: "deepseek-official",
      name: "DeepSeek Official",
      models: [
        { id: "deepseek-v4-flash", name: "V4 Flash", reasoning: { efforts: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }], defaultEffort: "high" } },
        { id: "deepseek-v4-pro", name: "V4 Pro", reasoning: { efforts: [{ id: "high", name: "High" }, { id: "max", name: "Max" }] } },
      ],
    },
    { id: "other-provider", name: "Other", models: [{ id: "x-1", name: "X1" }] },
  ]

  /**
   * The host's client seams: `sessions.list` for the bound session, `modelDirectories` for the
   * catalog, and the `remote.session` seam the resolver READS on the accessing ctx (so the
   * injection resolves at all — the live host mounts all three).
   *
   * The sessions fixture is the MEASURED snapshot shape (`evidence/web-card-catalog/20260918T073000Z/`):
   * `{ ids, byId, current, phase, … }` with `current` the session ID **STRING**. The superseded
   * fixture modelled `{ current: { sessionId } }` — the ASSUMED shape — which is exactly why a green
   * suite never caught the real defect.
   */
  function catalogServices(groups: CatalogGroup[] = CATALOG, options: CatalogServiceOptions = {}): Record<string, unknown> {
    /** The session id the fixture binds. */
    const sessionId = options.sessionId ?? "s1"
    /** Whether the fixture models an unbound session list. */
    const unbound = options.unbound === true
    return {
      sessions: {
        list: {
          getSnapshot: () => ({
            ids: unbound ? [] : [sessionId],
            byId: unbound ? {} : { [sessionId]: { id: sessionId, blank: false } },
            current: unbound ? undefined : sessionId,
            phase: "ready",
          }),
        },
        scope: (id: string) => (unbound ? undefined : { id }),
        binding: (id: string) => (unbound ? undefined : { sessionId: id }),
      },
      "remote.session": {},
      modelDirectories: {
        directoryFor: (id: string) => {
          if (options.throwing === true) throw new Error(`ui-model-selection: session "${String(id)}" resolved no scope`)
          if (id !== sessionId) throw new Error("unknown session")
          return { store: { getSnapshot: () => ({ status: "ready", groups }) }, load: async () => ({ groups }) }
        },
      },
    }
  }

  /** Every element of one type in a rendered tree. */
  function elementsOf(tree: TreeNode, type: unknown, out: ElementNode[] = []): ElementNode[] {
    if (tree === null || tree === undefined || typeof tree !== "object") return out
    if (Array.isArray(tree)) {
      for (const entry of tree) elementsOf(entry, type, out)
      return out
    }
    if (tree.type === type) out.push(tree)
    elementsOf(tree.props?.children, type, out)
    return out
  }

  /** The control element of one field row (its rendered subtree carries the field key). */
  function controlOf(tree: TreeNode, key: string): ElementNode | undefined {
    /** The labelled row's controls, when the tree has one. */
    const controls = findLabelled(tree, key)
    return controls === undefined ? undefined : controls[0]
  }
  /** The controls of one labelled row, or undefined when the row is absent. */
  function findLabelled(tree: TreeNode, key: string): ElementNode[] | undefined {
    if (tree === null || tree === undefined || typeof tree !== "object") return undefined
    if (Array.isArray(tree)) {
      for (const entry of tree) {
        /** The labelled subtree, when this entry holds one. */
        const found = findLabelled(entry, key)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (tree.key === key) return [...elementsOf(tree, "select"), ...elementsOf(tree, "input")]
    return findLabelled(tree.props?.children, key)
  }

  /** The option values of a select, flattened across optgroups. */
  function optionValues(select: TreeNode): unknown[] {
    return elementsOf(select, "option").map((option) => option.props.value).filter((value) => value !== "")
  }
  /** The option-group labels of a select, in render order. */
  function optgroupLabels(select: TreeNode): unknown[] {
    return elementsOf(select, "optgroup").map((group) => group.props.label)
  }

  /** Mount the section over one scope and render it once. */
  function renderedTree(scope: ScopeDouble, services: Record<string, unknown>): Promise<{ tree: ElementNode; client: LoadedMpdClient; registration: SlotRegistration }> {
    /** The client this render mounts. */
    const client = loadMpdClient({ services: { configForms: { get: (entryId: string) => { expect(entryId).toBe("mpd-config"); return scope.bind({ namespace: "mpd" }) } }, ...services } })
    client.exports.apply(client.ctx)
    // The section registers exactly once when its namespace form resolves.
    const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")!
    return client.hooks.render(registration.component, { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => EN[key] ?? key }).then((tree) => ({ tree, client, registration }))
  }

/** The section value every slot arm starts from: one provider/model/effort triple. */
  const SLOT_SECTION = { hashline: { maxDiffChars: 20000 }, teamModels: { slot1: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" } } }
/** A ready scope carrying one section value. */
  const slotScope = (section: Record<string, unknown>): ScopeDouble => fakeScope({ status: "ready", mode: "host", writable: true, revision: 7, value: section, user: section })

  test("the model control lists the catalog's provider/model pairs, GROUPED by provider", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    /** The model control of the first slot. */
    const select = controlOf(tree, "teamModels.slot1.model")
    expect(select?.type).toBe("select")
    expect(optgroupLabels(select)).toEqual(["DeepSeek Official", "Other"])
    expect(optionValues(select)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro", "x-1"])
    /** The option labels, in render order. */
    const labels = elementsOf(select, "option").map((option) => option.props.children)
    expect(labels).toContain("V4 Pro")
    client.restore()
  })

  test("the provider control lists the catalog's provider ids with their display names", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    /** The provider control of the first slot. */
    const select = controlOf(tree, "teamModels.slot1.provider")
    expect(optionValues(select)).toEqual(["deepseek-official", "other-provider"])
    expect(elementsOf(select, "option").map((option) => option.props.children)).toContain("Other")
    client.restore()
  })

  test("the effort control offers the SELECTED model's own efforts, and changing the model re-derives them", async () => {
    /** The render of the pro-model section, whose efforts are read. */
    const pro = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    /** The effort control under the pro model. */
    const proSelect = controlOf(pro.tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(proSelect)).toEqual(["high", "max"]) // deepseek-v4-pro advertises exactly these
    pro.client.restore()

    /** The same section with the flash model selected. */
    const flashSection = { ...SLOT_SECTION, teamModels: { slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } } }
    /** The flash render, whose efforts must differ from the pro model's. */
    const flash = await renderedTree(slotScope(flashSection), catalogServices())
    /** The effort control under the flash model. */
    const flashSelect = controlOf(flash.tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(flashSelect)).toEqual(["off", "low", "high", "max"])
    expect(optionValues(flashSelect)).not.toEqual(optionValues(proSelect))
    flash.client.restore()
  })

  test("a model with no advertised efforts keeps the declared fallback list", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope({ ...SLOT_SECTION, teamModels: { slot1: { provider: "other-provider", model: "x-1" } } }), catalogServices())
    /** The effort control, which keeps the declared list. */
    const select = controlOf(tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(select)).toEqual(["off", "low", "high", "max"])
    client.restore()
  })

  test("NO slot field is ever a text input (a slot value is never typed)", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    for (const slot of ["slot1", "slot2", "slot3"]) {
      for (const leaf of ["provider", "model", "reasoningEffort"]) {
    /** Each slot leaf's control, which must be a select. */
        const control = controlOf(tree, `teamModels.${slot}.${leaf}`)
        expect(control?.type).toBe("select")
        expect(optionValues(control).length).toBeGreaterThan(0)
      }
    }
    client.restore()
  })

  test("DEGRADE: no catalog services -> the declared lists, and the section still renders", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), {})
    expect(controlOf(tree, "teamModels.slot1.model")?.type).toBe("select")
    expect(optionValues(controlOf(tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    expect(optionValues(controlOf(tree, "teamModels.slot1.reasoningEffort"))).toEqual(["off", "low", "high", "max"])
    expect(textOf(tree)).toContain("a save writes <workspace>/.mpd/mpd.jsonc")
    client.restore()
  })

  test("DEGRADE: an unbound session and a THROWING directoryFor keep the declared lists, no throw out of render", async () => {
    /** The render over an unbound session list. */
    const unbound = await renderedTree(slotScope(SLOT_SECTION), catalogServices(CATALOG, { unbound: true }))
    expect(optionValues(controlOf(unbound.tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    unbound.client.restore()

    /** The render over a resolver that throws. */
    const throwing = await renderedTree(slotScope(SLOT_SECTION), catalogServices(CATALOG, { throwing: true }))
    expect(optionValues(controlOf(throwing.tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official"])
    expect(textOf(throwing.tree)).toContain("Slot 1 provider")
    throwing.client.restore()
  })

  test("edits through the catalog-driven controls still write ONE mutate batch with the revision fence", async () => {
    /** Every mutation this arm's scope recorded. */
    const calls: ScopeCall[] = []
    /** This arm's client and section registration. */
    const { registration } = mountedCard(fakeScope(READY, calls))
    /** The section's host-facing face. */
    const face = registration.inject()
    face.edit("teamModels.slot1.model", "deepseek-v4-pro")
    face.edit("teamModels.slot1.reasoningEffort", "max")
    await face.save()
    expect(calls).toHaveLength(1)
    expect(calls[0].expected).toBe(7)
    expect(calls[0].ops).toEqual([
      { op: "set", path: ["teamModels", "slot1", "model"], value: "deepseek-v4-pro" },
      { op: "set", path: ["teamModels", "slot1", "reasoningEffort"], value: "max" },
    ])
  })

  test("the disclosure sentences are unchanged and still rendered with the new rows", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    /** The rendered section text, where the disclosure must appear once. */
    const text = textOf(tree)
    // The disclosure still REACHES the reader — once, at the top of the card, where the 25 rows no
    // longer repeat it (measured in a real browser: it buried every row's own sentence).
    expect(text).toContain(BRIDGE_DISCLOSURE)
    expect(text).toContain("this knob is read at plugin mount")
    expect(text).toContain("the file half is host-limited")
    expect(text).toContain(BRIDGE_NOT_LOST)
    expect(text).toContain("if no session is live, the save stays in settings")
    // ...and the ROWS do not.
    for (const field of SLOT_ROW_FIELDS) expect(hintOfRow(tree, field.path.join("."))).not.toContain(BRIDGE_DISCLOSURE)
    client.restore()
  })

  // ── The twelve slot rows sat in one undifferentiated block: nothing on screen said WHICH members a
  // slot routes, and each row's hint opened with the boilerplate disclosure, so the one sentence a
  // reader needs was the LAST thing in a 400-char line. Both are asserted on the rendered tree here.
  test("G-1: each slot renders its group heading + impact ABOVE its three rows, human sentence FIRST", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    // The children are a list at runtime; the recursive node type cannot index it uncast.
    const children = tree.props.children as ElementNode[]
    for (const slot of ["slot1", "slot2", "slot3", "slot4"] as SlotKey[]) {
      /** The slot's heading element. */
      const heading = children.find((child) => child?.props?.["data-mpd-slot-group"] === slot)
      /** The slot's impact line. */
      const impact = children.find((child) => child?.props?.["data-mpd-slot-impact"] === slot)
      expect(heading).toBeDefined()
      expect(impact).toBeDefined()
      /** Where the heading sits among the section's children. */
      const headingIndex = children.indexOf(heading!)
      /** Where the impact line sits, which must be below the heading. */
      const impactIndex = children.indexOf(impact!)
      /** Where the slot's provider row sits. */
      const firstRow = children.findIndex((child) => child?.key === `teamModels.${slot}.provider`)
      /** Where the slot's effort row sits. */
      const lastRow = children.findIndex((child) => child?.key === `teamModels.${slot}.reasoningEffort`)
      // the heading is above ALL THREE rows of ITS OWN slot, with the impact line under it
      expect(headingIndex).toBeLessThan(impactIndex)
      expect(impactIndex).toBeLessThan(firstRow)
      expect(impactIndex).toBeLessThan(lastRow)
      expect(textOf(heading)).toBe(EN[`teamModels.${slot}.heading`])
      expect(textOf(impact)).toBe(EN[`teamModels.${slot}.impact`])
      expect(textOf(heading)).toContain(TEAM_MODEL_SLOT_GROUPS[slot].en)
    }
    // and the headings/impacts do NOT disturb the catalog-status lines (both still data-attributed)
    expect(elementsOf(tree, "p").filter((element) => element.props?.["data-mpd-catalog-state"] !== undefined)).toHaveLength(2)
    client.restore()
  })

  test("G-2: the human sentence renders FIRST at readable size/opacity, the disclosure dimmer beneath", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    /** The provider row of slot 2. */
    const row = rowOf(tree, "teamModels.slot2.provider")
    expect(row).toBeDefined()
      /** The declared row behind that rendered row. */
    const field = SLOT_ROW_FIELDS.find((candidate: CardField) => candidate.path.join(".") === "teamModels.slot2.provider")
      /** The row's hint block, the second child. */
    const hintBlock = (row!.props.children as ElementNode[])[1]
      /** The human sentence span and the dim key pointer beneath it. */
    const [human, pointer] = hintBlock.props.children as ElementNode[]
    expect(human.props["data-mpd-row-human"]).toBe("teamModels.slot2.provider")
    expect(pointer.props["data-mpd-row-key"]).toBe("teamModels.slot2.provider")
    expect(textOf(human)).toBe(field.semantics)
    expect(textOf(human)).toContain("analysis members (Researcher, Explorer, Plan Reviewer)")
    expect(textOf(pointer)).toBe("mpd.jsonc teamModels.slot2.provider")
    // the ROW no longer carries the disclosure; the CARD does, once
    expect(textOf(pointer)).not.toContain(BRIDGE_DISCLOSURE)
    expect(textOf(tree)).toContain(BRIDGE_DISCLOSURE)
    // readable above, dimmer below — asserted on the styles, not on a screenshot
    expect(human.props.style!.fontSize).toBeGreaterThan(pointer.props.style!.fontSize)
    expect(human.props.style!.opacity).toBeGreaterThan(pointer.props.style!.opacity)
    // BOTH still reach the row's text, so the pre-existing hint assertions keep their subject
    expect(hintOfRow(tree, "teamModels.slot2.provider")).toContain(field.semantics)
    expect(hintOfRow(tree, "teamModels.slot2.provider")).toContain("mpd.jsonc teamModels.slot2.provider")
    // a disclosure-only scalar row keeps the SINGLE dim span it always had (no restyle, no copy)
    const scalarHint = (rowOf(tree, "hashline.maxDiffChars")!.props.children as ElementNode[])[1]
    expect(Array.isArray(scalarHint.props.children)).toBe(false)
    expect(textOf(scalarHint).startsWith("mpd.jsonc hashline.maxDiffChars")).toBe(true)
    client.restore()
  })

  test("NEGATIVE CONTROL: the heading/impact lookup is falsifiable (a wrong slot attr finds nothing)", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    // The children are a list at runtime; the recursive node type cannot search it uncast.
    const children = tree.props.children as ElementNode[]
    expect(children.find((child) => child?.props?.["data-mpd-slot-group"] === "slot5")).toBeUndefined()
    expect(children.find((child) => child?.props?.["data-mpd-slot-impact"] === "slot3")).toBeDefined()
    // …while slot 4 IS rendered, with the vision heading and its own impact line
    const slot4Heading = children.find((child) => child?.props?.["data-mpd-slot-group"] === "slot4")
      /** The slot 4 impact line. */
    const slot4Impact = children.find((child) => child?.props?.["data-mpd-slot-impact"] === "slot4")
    expect(textOf(slot4Heading)).toBe(EN["teamModels.slot4.heading"])
    expect(textOf(slot4Impact)).toBe(EN["teamModels.slot4.impact"])
    client.restore()
  })

  // ── The reproduced DEFECT: the catalog is a service another plugin's fiber provides, so it is
  // invisible to a bare `ctx.get` probe and reachable ONLY through `ctx.inject` (the measured rule
  // in src/web-client.js's header). The pre-fix card probed, got undefined, and silently rendered
  // its DECLARED option lists forever — one provider, four models, no way to see the rest.
  /** The catalog-status paragraph (data-attributed), so the state is assertable without a browser. */
  /** The data-attributed catalog-status paragraph, when the card rendered one. */
  function catalogStatus(tree: TreeNode): ElementProps {
    // Every rendered card carries the status paragraph, which each arm reads right after.
    return elementsOf(tree, "p").find((element) => element.props?.["data-mpd-catalog-state"] !== undefined)?.props!
  }

  /** A MUTABLE directory store: `addProvider` notifies subscribers the way the host's store does. */
  function mutableDirectory(initialGroups: CatalogGroup[]): MutableDirectory {
    /** The groups the store currently reports. */
    let groups: CatalogGroup[] = initialGroups
    /** Subscribers the live insert notifies. */
    const listeners = new Set<() => void>()
    /** The load counter this directory tracks. */
    const state = { loads: 0 }
    return {
      state,
      directory: {
        store: {
          getSnapshot: () => ({ status: "ready", groups }),
          // The unsubscribe's own value is unused here, so the double may return nothing.
          subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        },
        load: async () => { state.loads += 1; return { groups } },
      },
      /** Insert one provider and notify every subscriber, as the host store does. */
      addProvider(provider: CatalogGroup): void {
        groups = [...groups, provider]
        for (const listener of [...listeners]) listener()
      },
    }
  }

  /**
   * The MEASURED live list snapshot: `current` is the session ID STRING (the host's own
   * `followCurrent()` indexes `snapshot.byId[current]`), never `{ sessionId }`.
   */
  const SESSIONS = {
    list: { getSnapshot: () => ({ ids: ["s1"], byId: { s1: { id: "s1", blank: false } }, current: "s1", phase: "ready" }) },
    /** Mint a session scope for one id. */
    scope: (id: string) => ({ id }),
    /** Mint a session binding for one id. */
    binding: (id: string) => ({ sessionId: id }),
  }
  /**
   * The host's `remote.session` seam. The card's dynamic injection WAITS for it (caller scoping), so
   * every fixture that expects a LIVE catalog mounts it — the live host does (measured). Without it
   * the injection never fires and the card degrades to its declared lists, which is T-C's arm.
   */
  const REMOTE_SESSION = { "remote.session": {} }

  /**
   * Mount the section with services that ONLY an injection can see. A bare `ctx.get` probe is
   * asserted undefined in T-A, so the case cannot silently degrade into the old behaviour.
   */
  function injectedTree(scope: ScopeDouble, hiddenServices: Record<string, unknown>): Promise<{ tree: ElementNode; client: LoadedMpdClient; registration: SlotRegistration; props: ElementProps }> {
    /** The client this render mounts. */
    const client = loadMpdClient({ services: { configForms: { get: (entryId: string) => { expect(entryId).toBe("mpd-config"); return scope.bind({ namespace: "mpd" }) } } }, hiddenServices })
    client.exports.apply(client.ctx)
    // The section registers exactly once when its namespace form resolves.
    const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")!
    /** The props every render of the section receives. */
    const props: ElementProps = { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => EN[key] ?? key }
    return client.hooks.render(registration.component, props).then((tree) => ({ tree, client, registration, props }))
  }

  test("T-A: a PROBE-INVISIBLE catalog still feeds the pickers through ctx.inject (the defect)", async () => {
    /** The mutable catalog this arm inserts into. */
    const directory = mutableDirectory(CATALOG)
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: SESSIONS,
      ...REMOTE_SESSION,
      modelDirectories: { directoryFor: () => directory.directory },
    })
    // the defect's PREMISE, asserted: the probe the pre-fix card used answers undefined
    expect(client.ctx.get("modelDirectories")).toBeUndefined()
    /** The model control the catalog must feed. */
    const select = controlOf(tree, "teamModels.slot1.model")
    expect(select?.type).toBe("select")
    expect(optionValues(select)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro", "x-1"])
    expect(optgroupLabels(select)).toEqual(["DeepSeek Official", "Other"])
    expect(catalogStatus(tree)["data-mpd-catalog-state"]).toBe("live")
    expect(catalogStatus(tree)["data-mpd-catalog-providers"]).toBe("2")
    expect(directory.state.loads).toBeGreaterThan(0) // directory.load() actually fetched
    client.restore()
  })

  test("T-B: a directory-store mutation reaches the card with NO re-mount (live read, live re-projection)", async () => {
    /** The mutable catalog this arm inserts into. */
    const directory = mutableDirectory(CATALOG)
    /** This arm's client, registration, props and first tree. */
    const { tree, client, registration, props } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: SESSIONS,
      ...REMOTE_SESSION,
      modelDirectories: { directoryFor: () => directory.directory },
    })
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official", "other-provider"])
    /** The card's own hook store, which the live insert must re-project. */
    const cardStore = registration.inject().hooks.mpdCard
    expect(cardStore.getSnapshot().catalog).toMatchObject({ mode: "live", providers: 2, models: 3 })

    // The user gains a provider: the store notifies, and the CARD'S OWN store is re-projected —
    // no render, no re-mount, no rebuild. This is the push half of "read the list live".
    directory.addProvider({ id: "third-provider", name: "Third", models: [{ id: "z-9", name: "Z9" }] })
    expect(cardStore.getSnapshot().catalog).toMatchObject({ mode: "live", providers: 3, models: 4 })

    // The same mounted controller re-renders the new list (act = re-render, NOT a remount).
    const next = await client.hooks.act(registration.component, props)
    expect(optionValues(controlOf(next, "teamModels.slot1.provider"))).toEqual(["deepseek-official", "other-provider", "third-provider"])
    expect(optionValues(controlOf(next, "teamModels.slot1.model"))).toContain("z-9")
    expect(catalogStatus(next)["data-mpd-catalog-models"]).toBe("4")
    client.restore()
  })

  test("T-C: when inject never resolves the declared lists render AND the fallback state is VISIBLE", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {})
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official"])
    expect(optionValues(controlOf(tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    expect(textOf(tree)).toContain("declared fallback — live catalog unavailable")
    /** The catalog-status paragraph, which must report the fallback. */
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("fallback")
    expect(status["data-mpd-catalog-providers"]).toBe("0")
    expect(status["data-mpd-catalog-models"]).toBe("0")
    client.restore()
  })

  test("T-D: the SERVED client.js carries the inject acquisition and the fallback marker", () => {
    /** Whether the served bytes carry the inject-based acquisition. */
    const injectBased = (bytes: string): boolean => bytes.includes('ctx.inject(["modelDirectories", "sessions", "remote.session"]')
    expect(injectBased(ARTIFACT)).toBe(true)
    // The CALLER-SCOPED seam is what the live host's resolver reads on the ACCESSING ctx: without
    // it `directoryFor` throws `cannot get property "remote.session" without inject`.
    expect(ARTIFACT).toContain("remote.session")
    expect(ARTIFACT).toContain("declared fallback — live catalog unavailable")
    expect(ARTIFACT).toContain("data-mpd-catalog-state")
    expect(ARTIFACT).not.toContain("SETTINGS_KNOBS")
    // the retired bare probe is GONE from the served bytes (both card and team page)
    expect(ARTIFACT).not.toContain('ctx.get("modelDirectories")')
    // NEGATIVE CONTROL: the inject predicate reddens on pro<redacted>
    const preFix = 'const directories = ctx && typeof ctx.get === "function" ? ctx.get("modelDirectories") : undefined'
    expect(injectBased(preFix)).toBe(false)
    // NEGATIVE CONTROL for the caller-scoped half: the PRE-FIX inject list (no `remote.session`)
    // is not accepted by the predicate — the defect shape cannot pass this assertion.
    const callerBlind = 'ctx.inject(["modelDirectories", "sessions"], (scoped) => bind(scoped))'
    expect(injectBased(callerBlind)).toBe(false)
    expect(preFix.includes("declared fallback — live catalog unavailable")).toBe(false)
  })

  // ── THE CALLER-SCOPED DEFECT (measured in a real browser, evidence/web-card-catalog/): the
  // injection alone never reached the catalog because cordis services are CALLER-scoped — the
  // host resolver reads `this.ctx.remote.session` on the ACCESSING ctx, so a caller that injected
  // only `["modelDirectories","sessions"]` got `cannot get property "remote.session" without
  // inject` and silently rendered its declared fallback while the browser carried TWO providers.
  /** The host's live shape: 2 providers / 31 models (deepseek-official 4 + opencode-go 27). */
  const LIVE_CATALOG = [
    {
      id: "deepseek-official",
      name: "DeepSeek Official",
      models: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"].map((id) => ({ id, name: id })),
    },
    {
      id: "opencode-go",
      name: "opencode-go",
      models: Array.from({ length: 27 }, (_, index) => ({ id: "og-model-" + String(index + 1), name: "OpenCode " + String(index + 1) })),
    },
  ]

  /**
   * The host's model-directory resolver as a CALLER-SCOPED service: `directoryFor` reads the dotted
   * `remote.session` seam, so the harness REJECTS the call unless the resolving ctx declared it —
   * exactly the measured live failure. `reads` is overridable so a case can prove the degrade arm
   * with a seam no inject list can satisfy.
   */
  function callerScopedCatalog(groups: CatalogGroup[] = LIVE_CATALOG, options: CatalogScopedOptions = {}): CallerScopedCatalog {
    /** The dotted seams the resolver reads. */
    const reads = options.reads ?? ["remote.session"]
    /** The session id the resolver accepts. */
    const sessionId = options.sessionId ?? "s1"
    /** How often the resolver body actually ran. */
    const calls = { directoryFor: 0 }
    /** The caller-scoped directory service. */
    const service = callerScopedService({
      reads,
      methods: {
        directoryFor: (_callerCtx, id) => {
          calls.directoryFor += 1
          if (id !== sessionId) throw new Error("unknown session")
          return { store: { getSnapshot: () => ({ status: "ready", groups }) }, load: async () => ({ groups }) }
        },
      },
    })
    return { service, calls, host: { sessions: SESSIONS, ...REMOTE_SESSION, modelDirectories: service } }
  }

  test("T-E: the LIVE catalog is reached when — and only when — the caller-scoped chain is satisfied", async () => {
    /** This arm's resolver counter and host services. */
    const { calls, host } = callerScopedCatalog()
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), host)
    // The chain is declared at the CALL SITE: without `remote.session` the harness throws the
    // measured error and the method body never runs.
    expect(calls.directoryFor).toBe(1)
    /** The provider control the live catalog must feed. */
    const providerSelect = controlOf(tree, "teamModels.slot1.provider")
    expect(optionValues(providerSelect)).toEqual(["deepseek-official", "opencode-go"])
    /** The model control the live catalog must feed. */
    const modelSelect = controlOf(tree, "teamModels.slot1.model")
    expect(optgroupLabels(modelSelect)).toEqual(["DeepSeek Official", "opencode-go"])
    expect(optionValues(modelSelect)).toHaveLength(31)
    expect(optionValues(modelSelect)).toContain("og-model-27")
    /** The catalog-status paragraph of this render. */
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("live")
    expect(status["data-mpd-catalog-providers"]).toBe("2")
    expect(status["data-mpd-catalog-models"]).toBe("31")
    expect(textOf(tree)).toContain("live catalog — 2 providers · 31 models")
    client.restore()
  })

  test("T-F: an UNSATISFIABLE caller chain degrades VISIBLY, naming the rejected seam", async () => {
    // `remote.session` IS satisfied by the fix; this extra seam is not, and cannot be — so any
    // inject list at all is rejected and the card must still say so out loud instead of showing a
    // bare fallback.
    const { calls, host } = callerScopedCatalog(LIVE_CATALOG, { reads: ["remote.session", "testing.absent.seam"] })
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), host)
    expect(calls.directoryFor).toBe(0) // rejected before the method body, exactly like the live host
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official"])
    expect(optionValues(controlOf(tree, "teamModels.slot1.model"))).toHaveLength(4)
    /** The catalog-status paragraph, which must report the fallback. */
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("fallback")
    expect(status["data-mpd-catalog-providers"]).toBe("0")
    expect(status["data-mpd-catalog-models"]).toBe("0")
    /** The rendered section text, which must name the rejected seam. */
    const text = textOf(tree)
    expect(text).toContain("declared fallback — live catalog unavailable")
    // NEVER SILENT: the rendered reason names the rejected seam (the cause the old bare catch hid)
    expect(text).toContain('cannot get property "testing.absent.seam" without inject')
    client.restore()
  })

  // ── THE REAL SNAPSHOT SHAPE (measured in a real browser against the live host,
  // evidence/web-card-catalog/20260918T073000Z/): `current` is the session ID **STRING**.
  // The superseded lane injected `{ current: { sessionId } }` through the app's own store, so its
  // green proved that ITS OWN injection round-tripped — not that a real client populates `current`.
  test("T-G: the MEASURED list shape (`current` is a session ID STRING) reaches the LIVE catalog", async () => {
    /** The mutable catalog this arm reads. */
    const directory = mutableDirectory(LIVE_CATALOG)
    /** Every session id the resolver was asked for. */
    const asked: string[] = []
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: SESSIONS,
      ...REMOTE_SESSION,
      modelDirectories: { directoryFor: (id: string) => { asked.push(id); if (id !== "s1") throw new Error("unknown session"); return directory.directory } },
    })
    expect(asked).toContain("s1")
    /** The catalog-status paragraph of this render. */
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("live")
    expect(status["data-mpd-catalog-providers"]).toBe("2")
    expect(status["data-mpd-catalog-models"]).toBe("31")
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official", "opencode-go"])
    expect(textOf(tree)).toContain("live catalog — 2 providers · 31 models")
    client.restore()
  })

  test("T-G NEGATIVE CONTROL: the PRE-FIX object-only read answers undefined for the MEASURED shape", () => {
    // The exact superseded expression, evaluated against the real snapshot: a STRING carries neither
    // `.sessionId` nor `.id`, so it answered undefined and the card degraded with the very sentence
    // the user saw — "no session is bound" — while a session WAS current. The second line is the
    // ASSUMED shape the old fixture asserted, which is what made the old suite green.
    const preFix = (snapshot: SessionSnapshot): unknown => {
      // The arm feeds both shapes on purpose, so the read assumes the object shape the card assumed.
      const current = snapshot.current as SessionIdRecord | null | undefined
      if (current === undefined || current === null) return undefined
      return current.sessionId ?? current.id
    }
    expect(preFix({ current: "s1" })).toBeUndefined()
    expect(preFix({ current: { sessionId: "s1" } })).toBe("s1")
    // and the fixed read answers the id for BOTH shapes
    const fixed = (snapshot: SessionSnapshot): string | undefined => {
      /** The snapshot's current value, whichever shape this arm fed. */
      const current = snapshot.current
      if (typeof current === "string") return current.length === 0 ? undefined : current
      if (current !== null && typeof current === "object") return current.sessionId ?? current.id
      return undefined
    }
    expect(fixed({ current: "s1" })).toBe("s1")
    expect(fixed({ current: { sessionId: "s1" } })).toBe("s1")
  })

  test("T-H: with NO current session, a LISTED session that has BOTH scope and binding is bound", async () => {
    // The measured case: the settings dialog opens BEFORE any conversation, so `current` is undefined
    // while `ids` is populated. `eligible(id) = current === id || ids.includes(id)` mints a listed
    // id's scope on demand, and `directoryFor` accepts it (measured: status "ready", 2 groups / 31).
    const directory = mutableDirectory(LIVE_CATALOG)
    /** Every session id the resolver was asked for. */
    const asked: string[] = []
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: {
        list: { getSnapshot: () => ({ ids: ["blank-1", "s2"], byId: { "blank-1": { id: "blank-1", blank: true }, s2: { id: "s2", blank: false } }, current: undefined, phase: "ready" }) },
        scope: (id: string) => ({ id }),
        binding: (id: string) => ({ sessionId: id }),
      },
      ...REMOTE_SESSION,
      modelDirectories: { directoryFor: (id: string) => { asked.push(id); return directory.directory } },
    })
    // a NON-blank listed session is preferred over the placeholder row
    expect([...new Set(asked)]).toEqual(["s2"])
    expect(catalogStatus(tree)["data-mpd-catalog-state"]).toBe("live")
    expect(catalogStatus(tree)["data-mpd-catalog-models"]).toBe("31")
    client.restore()
  })

  test("T-H2: NO current session and NO resolvable listed session still NAMES the reason", async () => {
    /** This arm's rendered tree and client. */
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: {
        list: { getSnapshot: () => ({ ids: ["s1"], byId: { s1: { id: "s1" } }, current: undefined, phase: "ready" }) },
        scope: () => undefined,
        binding: () => undefined,
      },
      ...REMOTE_SESSION,
      modelDirectories: { directoryFor: () => { throw new Error("directoryFor must not be reached") } },
    })
    /** The catalog-status paragraph, which must report the fallback. */
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("fallback")
    expect(textOf(tree)).toContain("declared fallback — live catalog unavailable (no session is bound)")
    client.restore()
  })

  test("T-I: an ENUMERATING sessions list does not warn at boot; a READY list with no bindable session does", async () => {
    // MEASURED: the card starts with the plugin, so its injected callback fires during app BOOT —
    // before the session-list baseline arrives. Announcing that first "no session is bound" put a
    // `[mpd]` WARNING into every healthy boot. The suppression must be narrow: the moment the list is
    // READY and still offers no bindable session, the degrade is announced again.
    let notified: (() => void) | null = null
    /** The session-list phase the fixture reports. */
    let phase = "pending"
    /** The session list the card injects against. */
    const sessions = {
      list: {
        getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase }),
        subscribe: (listener: () => void) => { notified = listener; return () => { notified = null } },
      },
      scope: () => undefined,
      binding: () => undefined,
    }
    /** The console recorder this arm captures through. */
    const rec = recordConsole()
    try {
    /** This arm's rendered tree and client. */
      const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
        sessions,
        ...REMOTE_SESSION,
        modelDirectories: { directoryFor: () => { throw new Error("directoryFor must not be reached") } },
      })
      // the BOOT transient: the visible fallback renders, the console stays silent
      expect(catalogStatus(tree)["data-mpd-catalog-state"]).toBe("fallback")
      expect(textOf(tree)).toContain("no session is bound")
      expect(rec.lines).toHaveLength(0)
      // the list settles and still offers no bindable session -> NOW it is a degrade, and it is said
      phase = "ready"
      expect(typeof notified).toBe("function")
      notified!()
    /** The warning lines the arm captured. */
      const warned = rec.lines.filter((line) => line.level === "warn")
      expect(warned).toHaveLength(1)
      expect(warned[0].args[1]).toContain("no session is bound")
      expect(rec.lines.filter((line) => line.level === "info")).toHaveLength(0)
      client.restore()
    } finally {
      rec.restore()
    }
  })

  // ── A degraded read used to be missable: the card's own notice sat at the TOP of the section
  // while the three slot pickers sit at the BOTTOM, and the fallback path never reached the
  // console. Three surfaces are asserted here, one by one, plus the warn-once discipline.
  /** Record the catalog lifecycle's console lines in order; `restore()` puts the console back. */
  function recordConsole(): { lines: ConsoleLine[]; restore: () => void } {
    /** The console lines captured so far, in order. */
    const lines: ConsoleLine[] = []
    /** The real console.warn, put back before the assertions run. */
    const realWarn = console.warn
    /** The real console.info, put back before the assertions run. */
    const realInfo = console.info
    console.warn = (...args) => lines.push({ level: "warn", args })
    console.info = (...args) => lines.push({ level: "info", args })
    return { lines, restore: () => { console.warn = realWarn; console.info = realInfo } }
  }

  /** The row element carrying one field key (the labeled block holding the hint and the control). */
  function rowOf(tree: TreeNode, key: string): ElementNode | undefined {
    if (tree === null || tree === undefined || typeof tree !== "object") return undefined
    if (Array.isArray(tree)) {
      for (const entry of tree) {
        /** The row found under this entry, when it holds one. */
        const found = rowOf(entry, key)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (tree.key === key) return tree
    return rowOf(tree.props?.children, key)
  }

  /** One row's HINT text (the labeled block's second child). */
  function hintOfRow(tree: TreeNode, key: string): string {
    /** The row element the key resolves to. */
    const row = rowOf(tree, key)
    return row === undefined ? "" : textOf((row.props?.children as ElementNode[] | undefined)?.[1])
  }

  /** BOTH data-attributed catalog lines: the top notice and the slot-adjacent one. */
  function catalogLines(tree: TreeNode): ElementNode[] {
    return elementsOf(tree, "p").filter((element) => element.props?.["data-mpd-catalog-state"] !== undefined)
  }

/** Every slot row key, in slot order and leaf order. */
  const SLOT_ROW_KEYS = ["slot1", "slot2", "slot3", "slot4"].flatMap((slot) => ["provider", "model", "reasoningEffort"].map((leaf) => `teamModels.${slot}.${leaf}`))

  test("D-1: a REJECTED read warns the console ONCE and the same sentence renders at the slot rows", async () => {
    /** The session-list listener to notify by hand. */
    let notified: (() => void) | null = null
    /** The session list this arm notifies manually. */
    const sessions = { list: { getSnapshot: () => ({ ids: ["s1"], byId: { s1: { id: "s1", blank: false } }, current: "s1", phase: "ready" }), subscribe: (listener: () => void) => { notified = listener; return () => { notified = null } } } }
    /** The console recorder this arm captures through. */
    const rec = recordConsole()
    try {
    /** This arm's rendered tree and client. */
      const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
        sessions,
        ...REMOTE_SESSION,
        modelDirectories: { directoryFor: () => { throw new Error('ui-model-selection: session "s1" resolved no scope') } },
      })
    /** The warning lines the arm captured. */
      const warned = rec.lines.filter((line) => line.level === "warn")
      expect(warned).toHaveLength(1)
      expect(warned[0].args[0]).toBe("[mpd] model catalog:")
      expect(warned[0].args[1]).toContain("declared fallback — live catalog unavailable")
      expect(warned[0].args[1]).toContain("the host resolved no model directory for this session")
      expect(rec.lines.filter((line) => line.level === "info")).toHaveLength(0)
      // SUSTAINED fallback: two more session notifications re-read and re-publish the SAME state
      expect(typeof notified).toBe("function")
      notified!()
      notified!()
      expect(rec.lines.filter((line) => line.level === "warn")).toHaveLength(1)
      // the compact line renders in the FALLBACK state, between the thirteen rows and the twelve
      const rendered = catalogLines(tree)
      expect(rendered).toHaveLength(2)
      /** The slot-adjacent catalog line, when the card rendered one. */
      const slotLine = rendered.find((element) => element.props["data-mpd-catalog-notice"] === "slots")
      expect(slotLine).toBeDefined()
      expect(textOf(slotLine)).toContain("declared fallback — live catalog unavailable")
      // The children are a list at runtime; the recursive node type cannot index it uncast.
      const children = tree.props.children as ElementNode[]
      /** Where the slot-adjacent line sits among the section's children. */
      const slotLineIndex = children.indexOf(slotLine!)
      expect(slotLineIndex).toBeGreaterThan(children.findIndex((child) => child?.key === "hashline.maxDiffChars"))
      expect(slotLineIndex).toBeLessThan(children.findIndex((child) => child?.key === "teamModels.slot1.provider"))
      // the twelve slot rows carry the marker; a scalar row is untouched
      for (const key of SLOT_ROW_KEYS) expect(hintOfRow(tree, key)).toContain(" — declared fallback: ")
      expect(hintOfRow(tree, "hashline.maxDiffChars")).not.toContain("declared fallback")
      client.restore()
    } finally {
      rec.restore()
    }
  })

  test("D-2: a RESOLVED catalog emits the LIVE sentence once and leaves the slot hints untouched", async () => {
    /** The mutable catalog this arm degrades and re-arms. */
    const directory = mutableDirectory(CATALOG)
    /** The console recorder this arm captures through. */
    const rec = recordConsole()
    try {
    /** This arm's rendered tree and client. */
      const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
        sessions: SESSIONS,
        ...REMOTE_SESSION,
        modelDirectories: { directoryFor: () => directory.directory },
      })
    /** The info lines the arm captured. */
      const info = rec.lines.filter((line) => line.level === "info")
      expect(info).toHaveLength(1)
      expect(info[0].args[0]).toBe("[mpd] model catalog:")
      expect(info[0].args[1]).toBe("live catalog — 2 providers · 3 models")
      expect(rec.lines.filter((line) => line.level === "warn")).toHaveLength(0)
      // the slot-adjacent line renders in the LIVE state too, with the SAME sentence
      const rendered = catalogLines(tree)
      expect(rendered).toHaveLength(2)
    /** The slot-adjacent catalog line of this render. */
      const slotLine = rendered.find((element) => element.props["data-mpd-catalog-notice"] === "slots")
      expect(textOf(slotLine)).toBe("live catalog — 2 providers · 3 models")
      for (const key of SLOT_ROW_KEYS) expect(hintOfRow(tree, key)).not.toContain("declared fallback")
      client.restore()
    } finally {
      rec.restore()
    }
  })

  test("D-3: warn-once survives repeated publishes and RE-ARMS only after a return to live", async () => {
    /** The groups the store currently reports. */
    let groups: CatalogGroup[] = CATALOG
    /** Subscribers the manual publish notifies. */
    const listeners = new Set<() => void>()
    /** The directory double this arm mutates by hand. */
    const directory: DirectoryDouble = {
      store: { getSnapshot: () => ({ status: "ready", groups }), subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    }
    /** Install a new group list and notify every subscriber. */
    const setGroups = (next: CatalogGroup[]): void => {
      groups = next
      for (const listener of [...listeners]) listener()
    }
    /** The console recorder this arm captures through. */
    const rec = recordConsole()
    try {
    /** This arm's client. */
      const { client } = await injectedTree(slotScope(SLOT_SECTION), { sessions: SESSIONS, ...REMOTE_SESSION, modelDirectories: { directoryFor: () => directory } })
      expect(rec.lines.map((line) => line.level)).toEqual(["info"])
      setGroups([]) // the read DEGRADES: the directory reports no provider
      expect(rec.lines.map((line) => line.level)).toEqual(["info", "warn"])
      expect(rec.lines[1].args[1]).toBe("declared fallback — live catalog unavailable (the model directory for this session reports no provider)")
      setGroups([]) // the SAME state again, twice: never a second warning
      setGroups([])
      expect(rec.lines).toHaveLength(2)
      setGroups(CATALOG) // back to live: re-armed
      expect(rec.lines.map((line) => line.level)).toEqual(["info", "warn", "info"])
      setGroups([]) // degrades AGAIN: exactly one more warning
      expect(rec.lines.map((line) => line.level)).toEqual(["info", "warn", "info", "warn"])
      client.restore()
    } finally {
      rec.restore()
    }
  })
})
