// `/mpd-model` (R3) and the TUI bilingual surfaces (R4).
//
// The doubles MODEL THE HOST rather than being permissive, the same way `plugin.test.ts` does:
// the dialog double records every panel request and answers from a script, so a test can assert
// WHICH panels the chain opened, in which order, and — the rule the contract cares about most —
// that a cancel at any panel reached the host as NO write at all.
import { describe, expect, test } from "bun:test"
import { openModelMenu, panelOptions, readStoredSlots, slotPanelOptions, storedSlot, locateNamespace, MODEL_NAMESPACE } from "../src/model-menu"
import type { ModelMenuResult } from "../src/model-menu"
import type { CatalogReadSeam } from "../src/settings"
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, teamModelOptionLists } from "../src/settings"
import { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTIONS } from "../src/command-trees"
import { TEAM_MODEL_FALLBACK_OPTIONS, TEAM_MODEL_SLOT_GROUPS, TEAM_MODEL_SLOTS } from "../../mpd-config-plugin/src/settings-schema"
import { detectLocaleLang, readLangPref, resolveLang, bilingual, pick, substitute } from "../src/i18n"
import type { LangInputs } from "../src/i18n"

/** One recorded dialog request. */
interface PanelCall {
  /** The dialog title the chain asked the host for. */
  readonly title: string
  /** The option ids, in the order the host would render them. */
  readonly ids: string[]
  /** The option labels, in the same order. */
  readonly labels: string[]
  /** The option descriptions, in the same order. */
  readonly descriptions: (string | undefined)[]
}

/** A dialog seam double: records every panel and answers from a script. */
interface DialogDouble {
  /** Every panel the chain opened, in call order. */
  readonly calls: PanelCall[]
  /** The seam itself, shaped as `createDialogs()` returns it. */
  readonly seam: {
    available(): boolean
    outcome(): { id: string; state: "available" }
    select(title: string, options: readonly { id: string; label: string; description?: string }[], timeoutMs?: number): Promise<string | undefined>
    confirm(title: string, message?: string): Promise<boolean | undefined>
  }
}

/**
 * Build a dialog double that answers each panel from `answers`, in call order.
 * @param answers - the option id per panel; `undefined` models a cancel (Esc / Ctrl+C / timeout).
 * @param available - whether the seam is composed at all.
 * @returns the double: its call log and the seam.
 */
function dialogDouble(answers: readonly (string | undefined)[], available: boolean = true): DialogDouble {
  /** Every panel opened, in call order. */
  const calls: PanelCall[] = []
  /** This double's place in the answer script. */
  let index = 0
  return {
    calls,
    seam: {
      /** Whether a picker can be offered at all. */
      available: (): boolean => available,
      /** The measured outcome, as the aggregate line reports it. */
      outcome: () => ({ id: "tuiDialogs", state: "available" as const }),
      /** Records the panel and settles the scripted answer. */
      async select(
        title: string,
        options: readonly { id: string; label: string; description?: string }[],
      ): Promise<string | undefined> {
        calls.push({
          title,
          ids: options.map((option) => option.id),
          labels: options.map((option) => option.label),
          descriptions: options.map((option) => option.description),
        })
        /** This panel's scripted answer; a run past the end of the script cancels. */
        const answer = answers[index]
        index += 1
        return answer
      },
      /** No yes/no dialog is part of this chain. */
      async confirm(_title: string, _message?: string): Promise<boolean | undefined> {
        return undefined
      },
    },
  }
}

/** One write the adapter's mutate seam received. */
interface WriteCall {
  /** The namespace the ops targeted. */
  readonly namespace: string
  /** The ops, verbatim. */
  readonly ops: readonly { op: string; path: readonly string[]; value?: unknown }[]
  /** The expected-revision fence the chain supplied. */
  readonly revision: number | undefined
}

/** A catalog/settings seam double that records reads and the write. */
interface AdapterDouble {
  /** The seam handed to the chain. */
  readonly seam: CatalogReadSeam
  /** Every write the chain performed, in call order. */
  readonly writes: WriteCall[]
}

/**
 * Build a catalog/settings seam double.
 * @param catalog - what `llmCatalog()` answers (a value, or a thrower).
 * @param options - the rest of the seam: the stored values, the revision, the write's verdict.
 * @returns the double: the seam and its write log.
 */
function adapterDouble(
  catalog: unknown,
  options: {
    stored?: Record<string, unknown>
    revision?: number
    write?: { ok: true } | { ok: false; error: string }
    withMutate?: boolean
    withReader?: boolean
    withCatalog?: boolean
  } = {},
): AdapterDouble {
  /** Every write this double received. */
  const writes: WriteCall[] = []
  /** The seam, assembled from the requested members only. */
  const seam: CatalogReadSeam = {
    ...(options.withCatalog === false ? {} : { llmCatalog: async (): Promise<never> => catalog as never }),
    ...(options.withReader === false
      ? {}
      : {
          settingsReader: (namespace: string) => ({
            /** This namespace's value from the fixture. */
            get: (): unknown => options.stored?.[namespace],
            /** The descriptor the revision fence comes from. */
            describe: () => ({ revision: options.revision }),
          }),
        }),
    ...(options.withMutate === false
      ? {}
      : {
          settingsMutate: async (namespace: string, ops: readonly { op: "set" | "unset"; path: readonly string[]; value?: unknown }[], revision?: number) => {
            writes.push({ namespace, ops, revision })
            return options.write ?? { ok: true as const }
          },
        }),
  }
  return { seam, writes }
}

/** A minimal log double: the chain only ever writes INFO/DEBUG/ERROR lines through it. */
const LOG = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
} as never

/** The `tui` argument the chain needs; it resolves no seam of its own once the doubles are given. */
const NO_TUI = {} as never

/** The text of one command result; an empty string for the success case with no output. */
const textOf = (result: ModelMenuResult): string => (result.text === undefined ? "" : result.text)

/** A provider-first catalog with two providers, so "narrowed vs union" is observable. */
const CATALOG = {
  degraded: false,
  providers: [
    {
      id: "prov-a",
      name: "Provider A",
      models: [
        { id: "model-a1", name: "Model A1", efforts: [{ id: "low", name: "low" }] },
        { id: "model-a2", name: "Model A2", efforts: [{ id: "high", name: "high" }] },
      ],
    },
    { id: "prov-b", name: "Provider B", models: [{ id: "model-b1", name: "Model B1", efforts: [{ id: "max", name: "max" }] }] },
  ],
}

describe("R4: the TUI language resolution follows the HOST's own chain", () => {
  /** A reader that answers the given text for any path, i.e. a present preference file. */
  const fileReader = (text: string): (() => string) => (): string => text

  test("step 1: DSH_TUI_LANG wins over the file and the locale", () => {
    expect(resolveLang({ env: { DSH_TUI_LANG: "en", LANG: "zh_CN.UTF-8" }, readFile: fileReader('{"lang":"zh"}') })).toBe("en")
    expect(resolveLang({ env: { DSH_TUI_LANG: "zh", LANG: "en_US.UTF-8" }, readFile: fileReader('{"lang":"en"}') })).toBe("zh")
  })

  test("step 1: an INVALID DSH_TUI_LANG falls through to the file, not to the locale", () => {
    expect(resolveLang({ env: { DSH_TUI_LANG: "fr", LANG: "en_US.UTF-8" }, readFile: fileReader('{"lang":"zh"}') })).toBe("zh")
  })

  test("step 2: the persisted ~/.dsh-tui/lang.json choice is read, and outranks the locale", () => {
    expect(resolveLang({ env: { LANG: "en_US.UTF-8" }, readFile: fileReader('{"lang":"zh"}') })).toBe("zh")
    expect(resolveLang({ env: { LANG: "zh_CN.UTF-8" }, readFile: fileReader('{ "lang" : "en" }') })).toBe("en")
  })

  test("step 2: an absent, unreadable or malformed preference file falls through", () => {
    /** A reader that throws, i.e. the file does not exist. */
    const missing = (): string => {
      throw new Error("ENOENT")
    }
    expect(resolveLang({ env: { LANG: "en_US.UTF-8" }, readFile: missing })).toBe("en")
    expect(resolveLang({ env: { LANG: "zh_CN.UTF-8" }, readFile: fileReader("not json") })).toBe("zh")
    expect(resolveLang({ env: { LANG: "en_US.UTF-8" }, readFile: fileReader('{"lang":"fr"}') })).toBe("en")
    expect(readLangPref({ readFile: missing })).toBeUndefined()
  })

  test("step 3: the locale guess — zh prefix is zh, ANY other stated locale is en, empty falls through", () => {
    expect(detectLocaleLang({ LC_ALL: "zh_CN.UTF-8" })).toBe("zh")
    expect(detectLocaleLang({ LANG: "en_US.UTF-8" })).toBe("en")
    // A locale we do not ship is en, never zh: a German user must not get a Chinese UI.
    expect(detectLocaleLang({ LANG: "de_DE.UTF-8" })).toBe("en")
    // `||` semantics: an EMPTY LC_ALL means "unset" and falls through to the next variable.
    expect(detectLocaleLang({ LC_ALL: "", LANG: "zh_CN.UTF-8" })).toBe("zh")
    expect(detectLocaleLang({ LC_MESSAGES: "zh_TW.UTF-8", LANG: "en_US.UTF-8" })).toBe("zh")
    // A3: the CI-shaped locale. `C.UTF-8` is a STATED locale, so it is not zh — it is en, and a
    // resolver mapping "not zh ⇒ zh" would disagree with the host in exactly this environment.
    expect(detectLocaleLang({ LANG: "C.UTF-8" })).toBe("en")
    expect(detectLocaleLang({ LC_ALL: "C" })).toBe("en")
    expect(detectLocaleLang({ LANG: "POSIX" })).toBe("en")
  })

  test("step 4: NO locale stated at all keeps the host's zh default", () => {
    expect(detectLocaleLang({})).toBe("zh")
    // `readLangPref` reads the file SYNCHRONOUSLY, so the "file does not exist" double throws
    // synchronously too — that is the fs.readFileSync failure mode, not a rejected promise.
    /** A reader whose file is not there. */
    const missing = (): string => {
      throw new Error("ENOENT")
    }
    expect(resolveLang({ env: {}, readFile: missing })).toBe("zh")
  })

  test("the dictionary resolves AT USE: the same pair renders in the language the caller resolves", () => {
    /** One pair, rendered through each language. */
    const pair = { zh: "MPD 面板", en: "MPD board" }
    expect(pick(pair, "zh")).toBe("MPD 面板")
    expect(pick(pair, "en")).toBe("MPD board")
    // `bilingual` re-resolves every call, so two calls with different inputs cannot share a cache.
    expect(bilingual(pair, { env: { DSH_TUI_LANG: "en" } })).toBe("MPD board")
    expect(bilingual(pair, { env: { DSH_TUI_LANG: "zh" } })).toBe("MPD 面板")
  })

  test("placeholders are filled after the language is chosen", () => {
    expect(substitute("{n} unread incidents", { n: "3" })).toBe("3 unread incidents")
    expect(substitute("no placeholder", { n: "3" })).toBe("no placeholder")
    expect(substitute("{a}{a}", { a: "x" })).toBe("xx")
  })
})

describe("R3: the /mpd-model pick-list chain", () => {
  test("panel 1 labels each slot with its member group, in the resolved language", () => {
    /** The English panel. */
    const en = slotPanelOptions("en")
    expect(en.map((option) => option.id)).toEqual([...TEAM_MODEL_SLOTS])
    expect(en.map((option) => option.label)).toEqual([
      `1. ${TEAM_MODEL_SLOT_GROUPS.slot1.en}`,
      `2. ${TEAM_MODEL_SLOT_GROUPS.slot2.en}`,
      `3. ${TEAM_MODEL_SLOT_GROUPS.slot3.en}`,
      `4. ${TEAM_MODEL_SLOT_GROUPS.slot4.en}`,
    ])
    /** The Chinese panel: the same ids, the zh group names. */
    const zh = slotPanelOptions("zh")
    expect(zh.map((option) => option.id)).toEqual(en.map((option) => option.id))
    expect(zh[0].label).toBe(`1. ${TEAM_MODEL_SLOT_GROUPS.slot1.zh}`)
    expect(zh[3].label).toBe(`4. ${TEAM_MODEL_SLOT_GROUPS.slot4.zh}`)
  })

  test("the four panels open in order slot → provider → model → effort, and settle their ids", async () => {
    /** The dialog double: slot1, prov-a, model-a2, high. */
    const dialogs = dialogDouble(["slot1", "prov-a", "model-a2", "high"])
    /** The adapter double with a live catalog. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("success")
    // The panel ORDER is the contract, so assert it by ids rather than by title text.
    expect(dialogs.calls.map((call) => call.ids)).toEqual([
      [...TEAM_MODEL_SLOTS],
      ["prov-a", "prov-b"],
      ["model-a1", "model-a2"],
      ["high"],
    ])
    // The write is the ONLY one, and it addresses the picked slot's three leaves.
    expect(adapter.writes).toHaveLength(1)
    // The write targets the config ENTRY, which is the only key the host can mutate (see the
    // namespace-default arm below for the measured reason).
    expect(adapter.writes[0].namespace).toBe("mpd-config")
    expect(adapter.writes[0].ops).toEqual([
      { op: "set", path: ["teamModels", "slot1", "provider"], value: "prov-a" },
      { op: "set", path: ["teamModels", "slot1", "model"], value: "model-a2" },
      { op: "set", path: ["teamModels", "slot1", "reasoningEffort"], value: "high" },
    ])
  })

  test("panel 3 narrows to the picked provider's models; panel 4 to the picked model's efforts", () => {
    /** The section's own projection of the catalog. */
    const lists = teamModelOptionLists(CATALOG as never)
    expect(panelOptions(lists, "prov-b", undefined, CATALOG).model.map((option) => option.value)).toEqual(["model-b1"])
    expect(panelOptions(lists, "prov-a", "model-a1", CATALOG).reasoningEffort.map((option) => option.value)).toEqual(["low"])
    expect(panelOptions(lists, "prov-a", "model-a2", CATALOG).reasoningEffort.map((option) => option.value)).toEqual(["high"])
  })

  test("panel 3 is NEVER empty: a keyed provider with no models falls back to the union", () => {
    /** A catalog whose provider B lists no models at all. */
    const sparse = { degraded: false, providers: [{ id: "prov-a", name: "Provider A", models: [] }, { id: "prov-b", name: "Provider B", models: [{ id: "model-b1", efforts: [] }] }] }
    /** The section's projection of that catalog. */
    const lists = teamModelOptionLists(sparse as never)
    // The slot rows already offer the union, so the menu must not offer LESS than the rows do.
    expect(panelOptions(lists, "prov-a", undefined, sparse).model).toEqual(lists.model)
    expect(panelOptions(lists, "prov-a", "model-b1", sparse).reasoningEffort).toEqual(lists.reasoningEffort)
    expect(panelOptions(lists, "prov-a", undefined, sparse).model.length).toBeGreaterThan(0)
    expect(panelOptions(lists, "prov-a", "model-b1", sparse).reasoningEffort.length).toBeGreaterThan(0)
  })

  test("an ABSENT catalog opens the panels over the declared fallback and says so", async () => {
    /** The dialog double: slot2, the declared provider, the declared model, the declared effort. */
    const dialogs = dialogDouble(["slot2", "deepseek-official", "deepseek-v4-flash", "high"])
    /** The adapter double with NO catalog seam at all. */
    const adapter = adapterDouble(undefined, { withCatalog: false })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("success")
    // The panels still opened, over the DECLARED fallback (never an empty list).
    expect(dialogs.calls[1].ids).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS.provider])
    expect(dialogs.calls[2].ids).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS.model])
    expect(dialogs.calls[3].ids).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS.reasoningEffort])
    // ...and the outcome NAMES the degradation instead of claiming a live catalog.
    expect(textOf(result)).toContain("llmCatalog")
  })

  test("a DEGRADED catalog is treated as no read, and the outcome names the degradation", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "deepseek-official", "deepseek-v4-flash", "max"])
    /** The adapter double whose catalog reports `degraded`. */
    const adapter = adapterDouble({ degraded: true, providers: [{ id: "prov-a", models: [{ id: "model-a1", efforts: [] }] }] })
    /** The chain's outcome, with the language pinned so the asserted sentence is explicit. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: { env: { DSH_TUI_LANG: "zh" } } })
    expect(result.kind).toBe("success")
    expect(dialogs.calls[1].ids).toEqual([...TEAM_MODEL_FALLBACK_OPTIONS.provider])
    expect(textOf(result)).toContain("读取不完整")
    // ...and the SAME arm in en says the same thing in English: the sentence is the pair, not one
    // hard-coded string.
    /** The English run of the same degraded chain. */
    const dialogsEn = dialogDouble(["slot1", "deepseek-official", "deepseek-v4-flash", "max"])
    /** The outcome of that English run. */
    const englishRun = await openModelMenu(NO_TUI, LOG, { dialogs: dialogsEn.seam, adapter: adapterDouble({ degraded: true }).seam, langInputs: { env: { DSH_TUI_LANG: "en" } } })
    expect(textOf(englishRun)).toContain("the catalog read was incomplete")
  })

  test("a THROWING catalog read degrades instead of failing the command", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "deepseek-official", "deepseek-v4-flash", "max"])
    /** The adapter double whose catalog read throws. */
    const adapter = adapterDouble(undefined, {})
    /** The seam with the throwing read, kept explicit so the arm is unambiguous. */
    const throwing: CatalogReadSeam = { ...adapter.seam, llmCatalog: async () => Promise.reject(new Error("boom")) as never }
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: throwing })
    expect(result.kind).toBe("success")
    expect(textOf(result)).toContain("boom")
  })

  test("CANCEL at any panel ends the chain and writes NOTHING", async () => {
    // Four arms, one per panel: the chain stops at the panel that was cancelled.
    /** The slot cancel. */
    const atSlot = dialogDouble([undefined])
    /** The provider cancel. */
    const atProvider = dialogDouble(["slot1", undefined])
    /** The model cancel. */
    const atModel = dialogDouble(["slot1", "prov-a", undefined])
    /** The effort cancel. */
    const atEffort = dialogDouble(["slot1", "prov-a", "model-a1", undefined])
    /** One arm: its dialog double, the panel count it must have seen, and the word its sentence carries. */
    const arms: readonly { dialogs: DialogDouble; panels: number; token: string }[] = [
      { dialogs: atSlot, panels: 1, token: "槽位" },
      { dialogs: atProvider, panels: 2, token: "提供商" },
      { dialogs: atModel, panels: 3, token: "模型" },
      { dialogs: atEffort, panels: 4, token: "推理强度" },
    ]
    for (const arm of arms) {
      /** A fresh adapter double per arm, so its write log is that arm's alone. */
      const adapter = adapterDouble(CATALOG)
      /** That arm's outcome, rendered in zh so the token above is stable. */
      const result = await openModelMenu(NO_TUI, LOG, { dialogs: arm.dialogs.seam, adapter: adapter.seam, langInputs: { env: { DSH_TUI_LANG: "zh" } } })
      expect(arm.dialogs.calls).toHaveLength(arm.panels)
      // THE RULE: no write happened on this path, at any panel.
      expect(adapter.writes).toHaveLength(0)
      expect(result.kind).toBe("error")
      expect(textOf(result)).toContain(arm.token)
    }
  })

  test("an UNBOUND dialogs seam ends the chain before any panel and writes nothing", async () => {
    /** A dialog double that reports itself unavailable. */
    const dialogs = dialogDouble([], false)
    /** The adapter double, whose write log must stay empty. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("error")
    expect(dialogs.calls).toHaveLength(0)
    expect(adapter.writes).toHaveLength(0)
  })

  test("a REFUSED write is reported with the host's own error, and never as success", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "prov-a", "model-a1", "low"])
    /** The adapter double whose mutation is refused by the host. */
    const adapter = adapterDouble(CATALOG, { write: { ok: false, error: "revision conflict" } })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("error")
    expect(textOf(result)).toContain("revision conflict")
  })

  test("an adapter with no settings write seam is reported, not thrown", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "prov-a", "model-a1", "low"])
    /** The adapter double with a catalog but no mutate member. */
    const adapter = adapterDouble(CATALOG, { withMutate: false })
    /** The chain's outcome, with the language pinned so the asserted sentence is explicit. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: { env: { DSH_TUI_LANG: "zh" } } })
    expect(result.kind).toBe("error")
    expect(textOf(result)).toContain("没有可写的设置接缝")
  })

  test("an unknown slot id writes nothing and says which value was unknown", async () => {
    /** The dialog double whose slot panel answers a value outside the four slots. */
    const dialogs = dialogDouble(["slot9"])
    /** The adapter double, whose write log must stay empty. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("error")
    expect(textOf(result)).toContain("slot9")
    expect(adapter.writes).toHaveLength(0)
  })

  test("the success sentence carries the SAME disclosure the section carries", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot3", "prov-a", "model-a1", "low"])
    /** The adapter double with a live catalog. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam })
    expect(result.kind).toBe("success")
    // Contract §4.6: the menu states the bridge truth and the never-lost clause, byte-for-byte the
    // constants the /settings section states — a menu that claimed a live effect would be the
    // exact failure the disclosure exists to prevent.
    expect(textOf(result)).toContain(BRIDGE_DISCLOSURE)
    expect(textOf(result)).toContain(BRIDGE_NOT_LOST)
    expect(textOf(result)).toContain("slot3")
  })

  test("the revision fence comes from the namespace the write targets", async () => {
    // The slot already lives in the ENTRY config, so that is where the write goes...
    /** The adapter double whose entry config already carries slot1. */
    const entry = adapterDouble(CATALOG, {
      stored: { "mpd-config": { teamModels: { slot1: { provider: "prov-a", model: "model-a1", reasoningEffort: "low" } } } },
      revision: 7,
    })
    /** Where the chain decided to write. */
    const located = locateNamespace(entry.seam, "slot1")
    expect(located).toEqual({ namespace: "mpd-config", revision: 7 })
    // ...and an UNSET slot ALSO defaults to the entry, because that is the only key the host can
    // mutate: `dsh-settings` resolves a mutate key against its descriptor list (keyed by profile entry
    // id) and throws `Plugin entry "<ns>" is no longer configurable` otherwise, while `"mpd"` is a
    // namespace this bundle registers and never a profile entry. Falling back to the legacy name would
    // make the default path a guaranteed refusal.
    /** The adapter double whose namespaces hold nothing. */
    const empty = adapterDouble(CATALOG, { revision: 3 })
    expect(locateNamespace(empty.seam, "slot1")).toEqual({ namespace: "mpd-config", revision: 3 })
    // A slot that genuinely lives under the LEGACY name still wins: that is where the live value is,
    // and writing the entry instead would persist a second copy no reader resolves.
    /** The adapter double whose legacy namespace carries slot1. */
    const legacy = adapterDouble(CATALOG, {
      stored: { mpd: { teamModels: { slot1: { provider: "prov-a" } } } },
      revision: 9,
    })
    expect(locateNamespace(legacy.seam, "slot1")).toEqual({ namespace: MODEL_NAMESPACE, revision: 9 })
  })

  test("the DEFAULT contract's stored values are readable from either settings shape", () => {
    expect(storedSlot({ teamModels: { slot1: { provider: "p", model: "m", reasoningEffort: "high" } } }, "slot1")).toEqual({
      provider: "p",
      model: "m",
      reasoningEffort: "high",
    })
    // The host document nests the value under `user`; the read must not lose it there.
    expect(storedSlot({ user: { teamModels: { slot2: { provider: "p2" } } } }, "slot2")).toEqual({ provider: "p2" })
    expect(storedSlot({ teamModels: { slot1: { provider: 7 } } }, "slot1")).toEqual({})
    expect(storedSlot(undefined, "slot1")).toEqual({})
  })

  test("readStoredSlots reads every slot from whichever namespace serves them", () => {
    /** The adapter double whose legacy namespace carries one slot. */
    const adapter = adapterDouble(CATALOG, { stored: { mpd: { teamModels: { slot4: { model: "vision" } } } } })
    /** The per-slot read. */
    const stored = readStoredSlots(adapter.seam)
    expect(stored.slot4).toEqual({ model: "vision" })
    expect(stored.slot1).toEqual({})
  })

  test("the command is registered with BOTH languages and a fallback description", () => {
    expect(MODEL_COMMAND).toBe("mpd-model")
    expect(MODEL_COMMAND_DESCRIPTIONS.zh).toBeString()
    expect(MODEL_COMMAND_DESCRIPTIONS.zh.length).toBeGreaterThan(0)
    expect(MODEL_COMMAND_DESCRIPTIONS.en).toBeString()
    // The harness command registry stores ONE string; it is the en half, so the two cannot drift.
    expect(MODEL_COMMAND_DESCRIPTIONS.en.length).toBeGreaterThan(0)
  })
})
