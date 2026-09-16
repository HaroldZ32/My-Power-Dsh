// t35 web card / w14 top-level section: the `mpd` settings UI in the Web Settings dialog.
//
// WHAT IS ASSERTED HERE: (a) the registration shape the host dispatches for a top-level SECTION —
// `{ name: "settings.section", id: "mpd", order, label, locale, inject }` behind
// `ctx.slots.inject`, exactly the pattern the host's own settings-models section uses — and the
// ABSENCE of the old keyed Plugins-tab item registration (w14 moved the section out of that tab);
// (b) the mount is DEFERRED through `ctx.inject(["settingsScope"])` and never a declared
// dependency; (c) the form behaviour: it reads what the namespace reports, stages edits, writes
// `mutate(ops, revision)` with NESTED paths, and renders read-only with a reason when the scope
// says `writable === false`; (d) the isolation rules; (e) the eleven fields/labels/zh descriptions
// are IDENTICAL to the TUI section's, so the two front doors cannot drift.
//
// WHAT IS NOT ASSERTED: that a real browser renders the section or that a click produces the
// mutate. No browser binary exists in this environment; that claim is NOT-CLAIMED and the user sees
// it in their own GUI. The rendered-state assertions below run in the offline hook runtime, which is
// a different thing and is labelled as such.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { loadMpdClient } from "./client-harness.mjs"

const REPO = join(import.meta.dir, "..", "..", "..")
const PKG = join(REPO, "packages", "mpd-bundle-plugin")
const ARTIFACT = readFileSync(join(PKG, "client.js"), "utf8")
const CARD_SOURCE = readFileSync(join(PKG, "src", "settings-card.js"), "utf8")

/** A settings scope with the host's measured surface, recording every write. */
function fakeScope(snapshot, calls = []) {
  let revision = snapshot.revision
  const listeners = new Set()
  return {
    bind: (spec) => {
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

const READY = {
  status: "ready",
  mode: "host",
  writable: true,
  revision: 7,
  value: { hashline: { maxDiffChars: 20000 }, ulw: { maxRounds: 6 } },
  user: { ulw: { maxRounds: 6 } },
}

function mountedCard(scope) {
  const client = loadMpdClient({ services: { settingsScope: scope } })
  client.exports.apply(client.ctx)
  const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
  return { client, registration }
}

function textOf(tree) {
  if (tree === null || tree === undefined) return ""
  if (typeof tree === "string" || typeof tree === "number") return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join(" ")
  return textOf(tree.props?.children)
}

/** The descriptor a top-level section must carry, as one predicate so a mutant can be judged. */
function sectionDescriptorProblems(definition) {
  const problems = []
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
function pluginItemRegistrations(text) {
  const found = []
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
    const injectForm = 'ctx.slots.inject("settings.plugin.item", function* () { yield ctx.slots.register({ name: "settings.plugin.item", key: "mpd" }, Card) })'
    const registerForm = 'ctx.slots.register({ name: "settings.plugin.item", key: NS, locale: LOCALE_NS }, Card)'
    expect(pluginItemRegistrations(injectForm)).toEqual(["slots.inject(settings.plugin.item)", "slots.register(settings.plugin.item)"])
    expect(pluginItemRegistrations(registerForm)).toEqual(["slots.register(settings.plugin.item)"])
    expect(pluginItemRegistrations(ARTIFACT)).toEqual([])
  })

  test("the mount is DEFERRED (ctx.inject) and the client still declares only the stable seams", () => {
    expect(ARTIFACT).toContain('ctx.inject(["settingsScope"]')
    expect(ARTIFACT).toContain('const REQUIRED_SERVICES = ["slots", "locale"]')
    expect(ARTIFACT).not.toContain('REQUIRED_SERVICES = ["slots", "locale", "settingsScope"]')
  })

  test("the disclosure copy is the same sentence the TUI states, and no stale claim survives", () => {
    expect(CARD_SOURCE).toContain("a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s)")
    expect(CARD_SOURCE).toContain("after a restart")
    expect(CARD_SOURCE).toContain("never lost")
    expect(CARD_SOURCE).not.toContain("not bridged")
  })
})

describe("the registration only happens when the settings scope is served", () => {
  test("no settingsScope -> no entry, one warning-free degrade, no throw out of apply", () => {
    const client = loadMpdClient()
    expect(() => client.exports.apply(client.ctx)).not.toThrow()
    expect((client.calls.slotsRegistered ?? []).some((definition) => definition.name === "settings.section")).toBe(false)
    expect(client.calls.slots).toContain("settings.section")
    expect(client.calls.slots).not.toContain("settings.plugin.item")
  })

  test("settingsScope at apply -> one SECTION entry, and its descriptor passes the whole predicate", () => {
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
    const good = { name: "settings.section", id: "mpd", order: 20, label: () => "MPD", locale: "mpdSettings", inject: () => ({}) }
    expect(sectionDescriptorProblems(good)).toEqual([])
    expect(sectionDescriptorProblems({ ...good, order: undefined })).toContain("order=undefined")
    expect(sectionDescriptorProblems({ ...good, id: "plugins" })).toContain("id=plugins")
    expect(sectionDescriptorProblems({ ...good, label: "MPD" })).toContain("label is not a function")
    expect(sectionDescriptorProblems({ ...good, locale: undefined })).toContain("locale is not a string")
    expect(sectionDescriptorProblems({ ...good, key: "mpd" })).toContain("carries the retired keyed-item field `key`")
    expect(sectionDescriptorProblems(undefined)).toEqual(["no registration"])
  })

  test("a late-served settingsScope still mounts the section (provideService wakes the fiber)", () => {
    const client = loadMpdClient()
    client.exports.apply(client.ctx)
    expect((client.calls.slotsRegistered ?? []).some((definition) => definition.name === "settings.section")).toBe(false)
    client.provideService("settingsScope", fakeScope(READY))
    const late = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
    expect(sectionDescriptorProblems(late)).toEqual([])
  })
})

describe("the card's form behaviour", () => {
  test("it renders what the namespace reports (values, overridden marker, disclosure) and nothing invented", async () => {
    const { client, registration } = mountedCard(fakeScope(READY))
    const tree = await client.hooks.render(registration.component, { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => key })
    const text = textOf(tree) + " " + JSON.stringify(tree)
    expect(text).toContain("hashline.maxDiffChars")
    expect(text).toContain("ulw.maxRounds")
    expect(text).toContain("20000")
    expect(text).toContain("6")
    expect(text).toContain("a save writes <workspace>/.mpd/mpd.jsonc")
    expect(text).toContain("save")
  })

  test("a save writes nested PATHS through scope.mutate with the revision fence", async () => {
    const calls = []
    const { registration } = mountedCard(fakeScope(READY, calls))
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
    const calls = []
    const { registration } = mountedCard(fakeScope(READY, calls))
    const face = registration.inject()
    face.resetField("ulw.maxRounds")
    await face.save()
    expect(calls[0].ops).toEqual([{ op: "unset", path: ["ulw", "maxRounds"] }])

    const calls2 = []
    const { registration: second } = mountedCard(fakeScope(READY, calls2))
    const face2 = second.inject()
    face2.edit("hashline.maxDiffChars", "not-a-number")
    await face2.save()
    expect(calls2).toEqual([]) // a draft that is not a value its field accepts carries NO write
    expect(face2.hooks.mpdCard.getSnapshot().invalid).toBe(true)
  })

  test("a read-only scope renders read-only with a reason and writes nothing", async () => {
    const calls = []
    const { client, registration } = mountedCard(fakeScope({ status: "unavailable", mode: "memory", writable: false, revision: undefined, value: undefined, user: undefined }, calls))
    const face = registration.inject()
    const state = face.hooks.mpdCard.getSnapshot()
    expect(state.writable).toBe(false)
    expect(state.mode).toBe("memory")
    face.edit("ulw.maxRounds", "9")
    const tree = await client.hooks.render(registration.component, { useMpdCard: (selector) => selector(face.hooks.mpdCard.getSnapshot()), t: (key) => key })
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
    const files = readdirSync(join(PKG, "src")).filter((name) => name.endsWith(".js") || name.endsWith(".ts"))
    const referencing = files.filter((name) => readFileSync(join(PKG, "src", name), "utf8").includes("@mpd-dsh/settings-card"))
    expect(referencing).toEqual(["web-client.js"])
    for (const banned of ["writeFileSync", "appendFileSync", "mkdirSync", "unlinkSync", "createWriteStream", "fetch(", "XMLHttpRequest", "localStorage"]) {
      expect(CARD_SOURCE).not.toContain(banned)
    }
    expect(existsSync(join(PKG, "src", "settings-card.js"))).toBe(true)
    expect(readFileSync(join(REPO, "scripts", "build-mpd-client.mjs"), "utf8")).toContain("@mpd-dsh/settings-card")
  })

  test("the card's twelve fields/labels/zh descriptions are IDENTICAL to the ONE shared declaration (no drift)", () => {
    // Both front doors now read the knob list from `packages/mpd-config-plugin/src/settings-schema.ts`
    // (the TUI imports it; the card mirrors it), so this compares the card against that single source.
    const shared = readFileSync(join(REPO, "packages", "mpd-config-plugin", "src", "settings-schema.ts"), "utf8")
    const { FIELDS } = (0, eval)("(" + CARD_SOURCE + ")")((name) => ({ react: {}, locales: {} })[name] ?? {})
    expect(Array.isArray(FIELDS)).toBe(true)
    expect(FIELDS).toHaveLength(12)
    for (const field of FIELDS) {
      expect(shared).toContain(`path: ["${field.path[0]}", "${field.path[1]}"]`)
      expect(shared).toContain(`label: "${field.label}"`)
      expect(shared).toContain(`zh: "${field.zh}"`)
      // w16: a knob that carries a semantics sentence must carry the SAME one in the shared
      // declaration, so the second line a user reads cannot drift from the schema.
      if (field.semantics !== undefined) expect(shared).toContain(`hint: "${field.semantics}"`)
    }
    // and the TUI builds its section from that list rather than restating it
    const tuiSource = readFileSync(join(REPO, "packages", "mpd-tui-plugin", "src", "settings.ts"), "utf8")
    expect(tuiSource).toContain("SETTINGS_KNOBS.map(")
    expect(tuiSource).toContain('from "../../mpd-config-plugin/src/settings-schema"')
  })
})
