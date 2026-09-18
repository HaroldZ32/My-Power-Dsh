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
// The ONE shared knob declaration, imported at RUNTIME for the parity test: the card MIRRORS it
// (it must not reference `SETTINGS_KNOBS`, which a QA gate pins against the built client), so the
// test — not the client — compares the two declarations element by element.
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SETTINGS_KNOBS } from "../../mpd-config-plugin/src/settings-schema"

const REPO = join(import.meta.dir, "..", "..", "..")
const PKG = join(REPO, "packages", "mpd-bundle-plugin")
const ARTIFACT = readFileSync(join(PKG, "client.js"), "utf8")
const CARD_SOURCE = readFileSync(join(PKG, "src", "settings-card.js"), "utf8")
/** The card module itself, plus the EN dictionary it renders rows through. */
const CARD = (0, eval)("(" + CARD_SOURCE + ")")((name) => ({ react: {}, locales: {} })[name] ?? {})
const EN = CARD.dictionaries().en

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

  test("the card's twenty-two fields/labels/zh descriptions/options are IDENTICAL to the ONE shared declaration (no drift)", () => {
    // Both front doors read the same knob list — the TUI imports it, the card MIRRORS it — so this
    // compares the card against that single source at RUNTIME (the nine team-model rows are built
    // from slot ids and labels in the declaration, which no source-text grep can follow).
    const { FIELDS } = (0, eval)("(" + CARD_SOURCE + ")")((name) => ({ react: {}, locales: {} })[name] ?? {})
    expect(Array.isArray(FIELDS)).toBe(true)
    // 22 = the shared list after the nine team-model slot leaves joined it (13 scalar knobs + 9
    // leaves); the element-wise loop below is what makes this a no-drift pin, not a magic number.
    expect(FIELDS).toHaveLength(22)
    expect(SETTINGS_KNOBS).toHaveLength(22)
    expect(FIELDS.map((field) => field.path)).toEqual(SETTINGS_KNOBS.map((knob) => [...knob.path]))
    for (const [index, field] of FIELDS.entries()) {
      const knob = SETTINGS_KNOBS[index]
      // A6: the FULL path array, never only its first two segments (the slot leaves are 3 deep).
      expect([...field.path]).toEqual([...knob.path])
      expect(field.label).toBe(knob.label)
      expect(field.zh).toBe(knob.zh)
      expect(field.kind).toBe(knob.kind)
      // the DECLARED fallback options are the parity surface (§1.3); the LIVE lists differ by design
      expect(field.options ?? []).toEqual([...(knob.options ?? [])])
      // w16: a knob that carries a semantics sentence must carry the SAME one as the shared hint
      if (field.semantics !== undefined) expect(knob.hint).toContain(field.semantics)
    }
    const slotRows = FIELDS.filter((field) => field.path[0] === "teamModels")
    expect(slotRows).toHaveLength(9)
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
    const { FIELDS } = (0, eval)("(" + CARD_SOURCE + ")")((name) => ({ react: {}, locales: {} })[name] ?? {})
    const drift = (index, patch) => {
      const copy = FIELDS.map((field) => ({ ...field, path: [...field.path] }))
      Object.assign(copy[index], patch)
      return copy
    }
    const compare = (fields) => fields.map((field, index) => {
      const knob = SETTINGS_KNOBS[index]
      return [JSON.stringify([...field.path]) === JSON.stringify([...knob.path]), field.label === knob.label, JSON.stringify(field.options ?? []) === JSON.stringify([...(knob.options ?? [])])]
    })
    const clean = compare(FIELDS)
    expect(clean.every((row) => row.every(Boolean))).toBe(true)
    const last = FIELDS.length - 1
    expect(compare(drift(last, { label: "Slot 3 reasoning effort (drifted)" }))[last][1]).toBe(false)
    expect(compare(drift(last, { path: ["teamModels", "slot3"] }))[last][0]).toBe(false)
    expect(compare(drift(last, { options: ["high"] }))[last][2]).toBe(false)
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

  /** The host's client seams: `sessions.list` for the bound session, `modelDirectories` for the catalog. */
  function catalogServices(groups = CATALOG, options = {}) {
    const sessionId = options.sessionId ?? "s1"
    return {
      sessions: { list: { getSnapshot: () => ({ current: options.unbound === true ? undefined : { sessionId } }) } },
      modelDirectories: {
        directoryFor: (id) => {
          if (options.throwing === true) throw new Error(`ui-model-selection: session "${String(id)}" resolved no scope`)
          if (id !== sessionId) throw new Error("unknown session")
          return { store: { getSnapshot: () => ({ status: "ready", groups }) }, load: async () => ({ groups }) }
        },
      },
    }
  }

  /** Every element of one type in a rendered tree. */
  function elementsOf(tree, type, out = []) {
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
  function controlOf(tree, key) {
    const controls = findLabelled(tree, key)
    return controls === undefined ? undefined : controls[0]
  }
  function findLabelled(tree, key) {
    if (tree === null || tree === undefined || typeof tree !== "object") return undefined
    if (Array.isArray(tree)) {
      for (const entry of tree) {
        const found = findLabelled(entry, key)
        if (found !== undefined) return found
      }
      return undefined
    }
    if (tree.key === key) return [...elementsOf(tree, "select"), ...elementsOf(tree, "input")]
    return findLabelled(tree.props?.children, key)
  }

  /** The option values of a select, flattened across optgroups. */
  function optionValues(select) {
    return elementsOf(select, "option").map((option) => option.props.value).filter((value) => value !== "")
  }
  function optgroupLabels(select) {
    return elementsOf(select, "optgroup").map((group) => group.props.label)
  }

  function renderedTree(scope, services) {
    const client = loadMpdClient({ services: { settingsScope: scope, ...services } })
    client.exports.apply(client.ctx)
    const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
    return client.hooks.render(registration.component, { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => EN[key] ?? key }).then((tree) => ({ tree, client, registration }))
  }

  const SLOT_SECTION = { hashline: { maxDiffChars: 20000 }, teamModels: { slot1: { provider: "deepseek-official", model: "deepseek-v4-pro", reasoningEffort: "max" } } }
  const slotScope = (section) => fakeScope({ status: "ready", mode: "host", writable: true, revision: 7, value: section, user: section })

  test("the model control lists the catalog's provider/model pairs, GROUPED by provider", async () => {
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    const select = controlOf(tree, "teamModels.slot1.model")
    expect(select?.type).toBe("select")
    expect(optgroupLabels(select)).toEqual(["DeepSeek Official", "Other"])
    expect(optionValues(select)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro", "x-1"])
    const labels = elementsOf(select, "option").map((option) => option.props.children)
    expect(labels).toContain("V4 Pro")
    client.restore()
  })

  test("the provider control lists the catalog's provider ids with their display names", async () => {
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    const select = controlOf(tree, "teamModels.slot1.provider")
    expect(optionValues(select)).toEqual(["deepseek-official", "other-provider"])
    expect(elementsOf(select, "option").map((option) => option.props.children)).toContain("Other")
    client.restore()
  })

  test("the effort control offers the SELECTED model's own efforts, and changing the model re-derives them", async () => {
    const pro = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    const proSelect = controlOf(pro.tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(proSelect)).toEqual(["high", "max"]) // deepseek-v4-pro advertises exactly these
    pro.client.restore()

    const flashSection = { ...SLOT_SECTION, teamModels: { slot1: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } } }
    const flash = await renderedTree(slotScope(flashSection), catalogServices())
    const flashSelect = controlOf(flash.tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(flashSelect)).toEqual(["off", "low", "high", "max"])
    expect(optionValues(flashSelect)).not.toEqual(optionValues(proSelect))
    flash.client.restore()
  })

  test("a model with no advertised efforts keeps the declared fallback list", async () => {
    const { tree, client } = await renderedTree(slotScope({ ...SLOT_SECTION, teamModels: { slot1: { provider: "other-provider", model: "x-1" } } }), catalogServices())
    const select = controlOf(tree, "teamModels.slot1.reasoningEffort")
    expect(optionValues(select)).toEqual(["off", "low", "high", "max"])
    client.restore()
  })

  test("NO slot field is ever a text input (a slot value is never typed)", async () => {
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    for (const slot of ["slot1", "slot2", "slot3"]) {
      for (const leaf of ["provider", "model", "reasoningEffort"]) {
        const control = controlOf(tree, `teamModels.${slot}.${leaf}`)
        expect(control?.type).toBe("select")
        expect(optionValues(control).length).toBeGreaterThan(0)
      }
    }
    client.restore()
  })

  test("DEGRADE: no catalog services -> the declared lists, and the section still renders", async () => {
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), {})
    expect(controlOf(tree, "teamModels.slot1.model")?.type).toBe("select")
    expect(optionValues(controlOf(tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    expect(optionValues(controlOf(tree, "teamModels.slot1.reasoningEffort"))).toEqual(["off", "low", "high", "max"])
    expect(textOf(tree)).toContain("a save writes <workspace>/.mpd/mpd.jsonc")
    client.restore()
  })

  test("DEGRADE: an unbound session and a THROWING directoryFor keep the declared lists, no throw out of render", async () => {
    const unbound = await renderedTree(slotScope(SLOT_SECTION), catalogServices(CATALOG, { unbound: true }))
    expect(optionValues(controlOf(unbound.tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    unbound.client.restore()

    const throwing = await renderedTree(slotScope(SLOT_SECTION), catalogServices(CATALOG, { throwing: true }))
    expect(optionValues(controlOf(throwing.tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official"])
    expect(textOf(throwing.tree)).toContain("Slot 1 provider")
    throwing.client.restore()
  })

  test("edits through the catalog-driven controls still write ONE mutate batch with the revision fence", async () => {
    const calls = []
    const { registration } = mountedCard(fakeScope(READY, calls))
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
    const { tree, client } = await renderedTree(slotScope(SLOT_SECTION), catalogServices())
    const text = textOf(tree)
    expect(text).toContain(BRIDGE_DISCLOSURE)
    expect(text).toContain("this knob is read at plugin mount")
    expect(text).toContain("the file half is host-limited")
    expect(text).toContain(BRIDGE_NOT_LOST)
    expect(text).toContain("if no session is live, the save stays in settings")
    client.restore()
  })

  // ── The reproduced DEFECT: the catalog is a service another plugin's fiber provides, so it is
  // invisible to a bare `ctx.get` probe and reachable ONLY through `ctx.inject` (the measured rule
  // in src/web-client.js's header). The pre-fix card probed, got undefined, and silently rendered
  // its DECLARED option lists forever — one provider, four models, no way to see the rest.
  /** The catalog-status paragraph (data-attributed), so the state is assertable without a browser. */
  function catalogStatus(tree) {
    return elementsOf(tree, "p").find((element) => element.props?.["data-mpd-catalog-state"] !== undefined)?.props
  }

  /** A MUTABLE directory store: `addProvider` notifies subscribers the way the host's store does. */
  function mutableDirectory(initialGroups) {
    let groups = initialGroups
    const listeners = new Set()
    const state = { loads: 0 }
    return {
      state,
      directory: {
        store: {
          getSnapshot: () => ({ status: "ready", groups }),
          subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        },
        load: async () => { state.loads += 1; return { groups } },
      },
      addProvider(provider) {
        groups = [...groups, provider]
        for (const listener of [...listeners]) listener()
      },
    }
  }

  const SESSIONS = { list: { getSnapshot: () => ({ current: { sessionId: "s1" } }) } }

  /**
   * Mount the section with services that ONLY an injection can see. A bare `ctx.get` probe is
   * asserted undefined in T-A, so the case cannot silently degrade into the old behaviour.
   */
  function injectedTree(scope, hiddenServices) {
    const client = loadMpdClient({ services: { settingsScope: scope }, hiddenServices })
    client.exports.apply(client.ctx)
    const registration = (client.calls.slotsRegistered ?? []).find((definition) => definition.name === "settings.section")
    const props = { useMpdCard: (selector) => selector(registration.inject().hooks.mpdCard.getSnapshot()), t: (key) => EN[key] ?? key }
    return client.hooks.render(registration.component, props).then((tree) => ({ tree, client, registration, props }))
  }

  test("T-A: a PROBE-INVISIBLE catalog still feeds the pickers through ctx.inject (the defect)", async () => {
    const directory = mutableDirectory(CATALOG)
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: SESSIONS,
      modelDirectories: { directoryFor: () => directory.directory },
    })
    // the defect's PREMISE, asserted: the probe the pre-fix card used answers undefined
    expect(client.ctx.get("modelDirectories")).toBeUndefined()
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
    const directory = mutableDirectory(CATALOG)
    const { tree, client, registration, props } = await injectedTree(slotScope(SLOT_SECTION), {
      sessions: SESSIONS,
      modelDirectories: { directoryFor: () => directory.directory },
    })
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official", "other-provider"])
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
    const { tree, client } = await injectedTree(slotScope(SLOT_SECTION), {})
    expect(optionValues(controlOf(tree, "teamModels.slot1.provider"))).toEqual(["deepseek-official"])
    expect(optionValues(controlOf(tree, "teamModels.slot1.model"))).toEqual(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro", "deepseek-flash"])
    expect(textOf(tree)).toContain("declared fallback — live catalog unavailable")
    const status = catalogStatus(tree)
    expect(status["data-mpd-catalog-state"]).toBe("fallback")
    expect(status["data-mpd-catalog-providers"]).toBe("0")
    expect(status["data-mpd-catalog-models"]).toBe("0")
    client.restore()
  })

  test("T-D: the SERVED client.js carries the inject acquisition and the fallback marker", () => {
    const injectBased = (bytes) => bytes.includes('ctx.inject(["modelDirectories", "sessions"]')
    expect(injectBased(ARTIFACT)).toBe(true)
    expect(ARTIFACT).toContain("declared fallback — live catalog unavailable")
    expect(ARTIFACT).toContain("data-mpd-catalog-state")
    expect(ARTIFACT).not.toContain("SETTINGS_KNOBS")
    // the retired bare probe is GONE from the served bytes (both card and team page)
    expect(ARTIFACT).not.toContain('ctx.get("modelDirectories")')
    // NEGATIVE CONTROL: the inject predicate reddens on probe-only bytes
    const preFix = 'const directories = ctx && typeof ctx.get === "function" ? ctx.get("modelDirectories") : undefined'
    expect(injectBased(preFix)).toBe(false)
    expect(preFix.includes("declared fallback — live catalog unavailable")).toBe(false)
  })
})
