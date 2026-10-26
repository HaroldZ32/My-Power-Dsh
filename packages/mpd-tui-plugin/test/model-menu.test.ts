// `/mpd-model` (R3) and the TUI bilingual surfaces (R4), keyed by AGENT.
//
// THIS FILE REVERSES THE 2026-10-23 DELETION LOCK ON PURPOSE (contract `agent-routes-per-agent.md`
// §9 / amendment 2 §4). The lock asserted that the menu "must not contain agentRoutes" and wrote
// `teamModels.<slot>`; the contract now makes the AGENT the unit of model configuration, so the
// assertions here are the mirror image: the chain is group → scope (whole group / one agent) →
// provider → model → reasoning effort, a whole-group write is CONFIRMED first and writes every
// member's own entry, a clear removes exactly one entry, and `teamModels` is written NOWHERE.
//
// The doubles MODEL THE HOST rather than being permissive, the same way `plugin.test.ts` does:
// the dialog double records every panel request and answers from a script, so a test can assert
// WHICH panels the chain opened, in which order, and — the rule the contract cares about most —
// that a cancel at any panel reached the host as NO write at all.
import { describe, expect, test } from "bun:test"
import {
  GROUP_SCOPE_ID,
  MODEL_NAMESPACE,
  actionPanelOptions,
  agentRouteText,
  confirmationLines,
  groupPanelOptions,
  hasStoredRoute,
  locateNamespace,
  openModelMenu,
  panelOptions,
  readStoredRoutes,
  routeKeyFor,
  routeTableOf,
  scopePanelOptions,
  storedAgentRoute,
} from "../src/model-menu"
import type { ModelMenuResult } from "../src/model-menu"
import { BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, agentRouteDisplay, teamModelOptionLists } from "../src/settings"
import type { AgentRouteDisplay, CatalogReadSeam } from "../src/settings"
import { MODEL_COMMAND, MODEL_COMMAND_DESCRIPTION, MODEL_COMMAND_DESCRIPTIONS } from "../src/command-trees"
import { ROSTER_AGENT_NAMES, TEAM_MODEL_SLOTS, TEAM_MODEL_SLOT_GROUPS } from "../../mpd-config-plugin/src/settings-schema"
import { resolveAgentRoute } from "../../mpd-config-plugin/src/index"
import { detectLocaleLang, readLangPref, resolveLang, bilingual, pick, substitute } from "../src/i18n"

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

/** One recorded confirmation request. */
interface ConfirmCall {
  /** The confirmation title (the question the host renders). */
  readonly title: string
  /** The confirmation body: the affected agents and their current routes. */
  readonly message: string | undefined
}

/** A dialog seam double: records every panel and answers from a script. */
interface DialogDouble {
  /** Every panel the chain opened, in call order. */
  readonly calls: PanelCall[]
  /** Every confirmation the chain asked for, in call order. */
  readonly confirms: ConfirmCall[]
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
 * @param confirmAnswers - the yes/no answer per confirmation; `undefined` models a dismissed dialog.
 * @returns the double: its call logs and the seam.
 */
function dialogDouble(
  answers: readonly (string | undefined)[],
  available: boolean = true,
  confirmAnswers: readonly (boolean | undefined)[] = [],
): DialogDouble {
  /** Every panel opened, in call order. */
  const calls: PanelCall[] = []
  /** Every confirmation opened, in call order. */
  const confirms: ConfirmCall[] = []
  /** This double's place in the answer script. */
  let index = 0
  /** This double's place in the confirmation script. */
  let confirmIndex = 0
  return {
    calls,
    confirms,
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
      /** Records the confirmation and settles the scripted answer. */
      async confirm(title: string, message?: string): Promise<boolean | undefined> {
        confirms.push({ title, message })
        /** This confirmation's scripted answer; a run past the end of the script dismisses it. */
        const answer = confirmAnswers[confirmIndex]
        confirmIndex += 1
        return answer
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

/** A minimal log double: the chain only ever writes INFO/DEBUG/WARN/ERROR lines through it. */
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

/** English, stated explicitly so an assertion never depends on the machine's locale. */
const EN = { env: { DSH_TUI_LANG: "en" } }

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

/**
 * A config-service double exposing the contract's typed agent-route answer.
 * @param answer - the per-agent answer the service gives.
 * @returns the minimal service slice `agentRouteDisplay` reads.
 */
function serviceDouble(answer: (member: string) => unknown): { agentRouteResolutionOf: (member: string) => unknown } {
  return { agentRouteResolutionOf: answer }
}

/**
 * A typed `ok` answer for one agent, used to build "already configured" fixtures.
 * @param provider - the provider id the route declares.
 * @param model - the model id the route declares.
 * @param effort - the reasoning effort, when the route declares one.
 * @returns the service's `ok` arm.
 */
function okAnswer(provider: string, model: string, effort?: string): { ok: true; agent: string; route: { provider: string; model: string; reasoningEffort?: string } } {
  return { ok: true, agent: "x", route: effort === undefined ? { provider, model } : { provider, model, reasoningEffort: effort } }
}

/**
 * The typed answers for a whole roster, all unconfigured — the "nothing is set yet" world.
 * @returns one `unconfigured` answer per roster agent.
 */
function allUnconfigured(): Record<string, AgentRouteDisplay> {
  /** The display map the panel helpers take. */
  const out: Record<string, AgentRouteDisplay> = {}
  for (const member of ROSTER_AGENT_NAMES) out[member] = { state: "unconfigured", missing: ["provider", "model"] }
  return out
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
    // The CI-shaped locale. `C.UTF-8` is a STATED locale, so it is not zh — it is en.
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

describe("R3 · the /mpd-model chain is keyed by AGENT (contract §6)", () => {
  // ── the panels, as pure projections ───────────────────────────────────────
  test("panel 1 labels each group, names its members and summarises their CURRENT routes", () => {
    /** The label-only English panel: four groups, in the declaration's order. */
    const bare = groupPanelOptions("en")
    expect(bare.map((option) => option.id)).toEqual([...TEAM_MODEL_SLOTS])
    expect(bare.map((option) => option.label)).toEqual([
      `1. ${TEAM_MODEL_SLOT_GROUPS.slot1.en}`,
      `2. ${TEAM_MODEL_SLOT_GROUPS.slot2.en}`,
      `3. ${TEAM_MODEL_SLOT_GROUPS.slot3.en}`,
      `4. ${TEAM_MODEL_SLOT_GROUPS.slot4.en}`,
    ])
    // Every member of the group is named on its own option, so a reader knows whom the bulk edit hits.
    for (const member of TEAM_MODEL_SLOT_GROUPS.slot2.members) expect(bare[1].description).toContain(member)
    // Contract §6.1: the compact summary is the configured COUNT plus the DISTINCT routes, and the
    // contract's own token when no member has one.
    /** One typed answer per roster agent: nothing is configured yet. */
    const nothing = allUnconfigured()
    /** The summary with no member configured. */
    const empty = groupPanelOptions("en", nothing)
    expect(empty[0].description).toContain(`0/${TEAM_MODEL_SLOT_GROUPS.slot1.members.length} configured`)
    expect(empty[0].description).toContain("<unconfigured>")
    /** The typed answers with the whole slot-1 group on ONE route. */
    const uniform: Record<string, AgentRouteDisplay> = { ...nothing }
    for (const member of TEAM_MODEL_SLOT_GROUPS.slot1.members) uniform[member] = { state: "ok", route: "prov-a / model-a1 / low", fallbacks: 0 }
    /** The summary with every member configured the same way. */
    const full = groupPanelOptions("en", uniform)
    expect(full[0].description).toContain(`${TEAM_MODEL_SLOT_GROUPS.slot1.members.length}/${TEAM_MODEL_SLOT_GROUPS.slot1.members.length} configured`)
    expect(full[0].description).toContain("prov-a / model-a1 / low")
    // The DISTINCT count: one route, so no `+N more distinct` marker appears.
    expect(full[0].description).not.toContain("more distinct")
  })

  test("panel 2 offers the WHOLE GROUP first, then exactly that group's agents", () => {
    /** The English scope panel for the analysis group. */
    const options = scopePanelOptions("en", "slot2", allUnconfigured())
    // Contract §6.2: the bulk edit or ONE agent of the picked group — nothing else is representable.
    expect(options.map((option) => option.id)).toEqual([GROUP_SCOPE_ID, ...TEAM_MODEL_SLOT_GROUPS.slot2.members])
    expect(options[0].label).toBe(`whole group (${TEAM_MODEL_SLOT_GROUPS.slot2.members.length} agents)`)
    expect(options[0].description).toContain("confirmed before anything is written")
    // Each agent option states its current route (see-before-you-edit), never a blank.
    for (const option of options.slice(1)) expect(option.description).toContain("<unconfigured>")
    // An agent OUTSIDE the picked group is unrepresentable, so a group write can never silently widen.
    expect(options.map((option) => option.id)).not.toContain("Architect")
  })

  test("the action panel offers set and clear, and the clear hint states the CONSEQUENCE", () => {
    /** The English action panel for one agent. */
    const options = actionPanelOptions("en", "Architect")
    expect(options.map((option) => option.id)).toEqual(["set", "clear"])
    // The clear branch names the entry it removes AND what a clear costs (contract §6.7). It states
    // the cost as a CONSEQUENCE: the error code and the refusal sentence belong to `mpd-config-plugin`.
    expect(options[1].label).toContain("agentRoutes.Architect")
    expect(options[1].description).toContain("agentRoutes.Architect")
    expect(options[1].description).toContain("REFUSED")
  })

  test("the confirmation lists EVERY affected agent with its current effective route", () => {
    /** The typed answers: one agent configured, the others unconfigured. */
    const displays: Record<string, AgentRouteDisplay> = { ...allUnconfigured() }
    displays.Researcher = { state: "ok", route: "prov-a / model-a1 / low", fallbacks: 2 }
    /** The confirmation body for the analysis group. */
    const message = confirmationLines("en", [...TEAM_MODEL_SLOT_GROUPS.slot2.members], displays)
    // The heading says the write OVERWRITES, and that the routes below are the CURRENT ones.
    expect(message).toContain("OVERWRITES")
    // Contract §6.6: every affected agent is listed by name, with its route or the contract's token.
    expect(message).toContain("Researcher: current: prov-a / model-a1 / low (+2 fallbacks)")
    expect(message).toContain("Explorer: current: <unconfigured>")
    expect(message).toContain("Plan Reviewer: current: <unconfigured>")
    // One line per agent plus the heading, so a long group stays readable.
    expect(message.split(String.fromCharCode(10))).toHaveLength(TEAM_MODEL_SLOT_GROUPS.slot2.members.length + 1)
  })

  test("the current-route sentence carries the CONTRACT's four states, never a throw", () => {
    expect(agentRouteText("en", { state: "ok", route: "p / m", fallbacks: 0 })).toBe("current: p / m")
    expect(agentRouteText("en", { state: "ok", route: "p / m", fallbacks: 3 })).toContain("(+3 fallbacks)")
    expect(agentRouteText("en", { state: "unconfigured", missing: ["a", "b"] })).toBe("current: <unconfigured>")
    expect(agentRouteText("en", { state: "invalid" })).toBe("current: <invalid>")
    expect(agentRouteText("en", { state: "unavailable" })).toBe("current: <unavailable>")
  })

  // ── the WRITE arms the contract enumerates (§9) ───────────────────────────
  test("a WHOLE-GROUP write saves exactly 3 leaves × N agents, after the required confirmation", async () => {
    /** The dialog double: group slot2, whole group, prov-a, model-a1, low — then confirm. */
    const dialogs = dialogDouble(["slot2", GROUP_SCOPE_ID, "prov-a", "model-a1", "low"], true, [true])
    /** The adapter double with a live catalog and no stored entry. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // FIVE select panels (group → scope → provider → model → effort), then the REQUIRED confirmation.
    expect(dialogs.calls.map((call) => call.ids)).toEqual([
      [...TEAM_MODEL_SLOTS],
      [GROUP_SCOPE_ID, ...TEAM_MODEL_SLOT_GROUPS.slot2.members],
      ["prov-a", "prov-b"],
      ["model-a1", "model-a2"],
      ["low"],
    ])
    expect(dialogs.confirms).toHaveLength(1)
    // The confirmation names the group and the affected COUNT, and lists every agent's current route.
    expect(dialogs.confirms[0].title).toContain(TEAM_MODEL_SLOT_GROUPS.slot2.en)
    expect(dialogs.confirms[0].title).toContain(String(TEAM_MODEL_SLOT_GROUPS.slot2.members.length))
    for (const member of TEAM_MODEL_SLOT_GROUPS.slot2.members) expect(dialogs.confirms[0].message).toContain(member)
    // ONE write, 3 leaves × N members, every path under that member's OWN `agentRoutes` entry.
    expect(adapter.writes).toHaveLength(1)
    expect(adapter.writes[0].namespace).toBe("mpd-config")
    /** The expected op list: three leaves for each member, in the group's order. */
    const expected: { op: string; path: string[]; value: unknown }[] = []
    for (const member of TEAM_MODEL_SLOT_GROUPS.slot2.members) {
      expected.push(
        { op: "set", path: ["agentRoutes", member, "provider"], value: "prov-a" },
        { op: "set", path: ["agentRoutes", member, "model"], value: "model-a1" },
        { op: "set", path: ["agentRoutes", member, "reasoningEffort"], value: "low" },
      )
    }
    expect(adapter.writes[0].ops).toEqual(expected)
    expect(adapter.writes[0].ops).toHaveLength(3 * TEAM_MODEL_SLOT_GROUPS.slot2.members.length)
    // The retired block is written NOWHERE, on any path of any op.
    for (const op of adapter.writes[0].ops) expect(op.path[0]).toBe("agentRoutes")
    // The outcome sentence names the group, the agent count and the leaf count.
    expect(textOf(result)).toContain(TEAM_MODEL_SLOT_GROUPS.slot2.en)
    expect(textOf(result)).toContain(`${String(TEAM_MODEL_SLOT_GROUPS.slot2.members.length)} agents`)
    expect(textOf(result)).toContain("3 leaves")
    // ... and carries the SAME disclosure the settings section carries.
    expect(textOf(result)).toContain(BRIDGE_DISCLOSURE)
    expect(textOf(result)).toContain(BRIDGE_NOT_LOST)
  })

  test("an INDIVIDUAL write saves exactly 3 leaves for that one agent, and no confirmation", async () => {
    /** The dialog double: slot1, Planner (no stored entry, so no action panel), then the leaves. */
    const dialogs = dialogDouble(["slot1", "Planner", "prov-a", "model-a2", "high"], true, [true])
    /** The adapter double with a live catalog and no stored entry. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // FIVE select panels (group, scope, provider, model, effort): no ACTION panel (nothing to clear)
    // and NO confirmation (one agent only).
    expect(dialogs.calls).toHaveLength(5)
    expect(dialogs.confirms).toHaveLength(0)
    // Contract §6: an individual write shows the TARGET AGENT on the final panel.
    expect(dialogs.calls[4].title).toContain("Planner")
    expect(adapter.writes).toHaveLength(1)
    expect(adapter.writes[0].namespace).toBe("mpd-config")
    expect(adapter.writes[0].ops).toEqual([
      { op: "set", path: ["agentRoutes", "Planner", "provider"], value: "prov-a" },
      { op: "set", path: ["agentRoutes", "Planner", "model"], value: "model-a2" },
      { op: "set", path: ["agentRoutes", "Planner", "reasoningEffort"], value: "high" },
    ])
    expect(textOf(result)).toContain("Planner")
    expect(textOf(result)).toContain(BRIDGE_DISCLOSURE)
  })

  test("a REFUSED confirmation writes NOTHING and says the write was not confirmed", async () => {
    /** The dialog double answering every panel, then refusing the confirmation. */
    const dialogs = dialogDouble(["slot2", GROUP_SCOPE_ID, "prov-a", "model-a1", "low"], true, [false])
    /** The adapter double: it must receive no write at all. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(adapter.writes).toHaveLength(0)
    expect(textOf(result)).toContain("not confirmed")
  })

  test("a DISMISSED confirmation is the same fact as a cancel: nothing is written", async () => {
    /** The dialog double whose confirmation settles `undefined` (Esc / Ctrl+C / timeout). */
    const dialogs = dialogDouble(["slot2", GROUP_SCOPE_ID, "prov-a", "model-a1", "low"], true, [undefined])
    /** The adapter double: it must receive no write at all. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(adapter.writes).toHaveLength(0)
    // `undefined` is NOT a confirmation: only a positive answer may reach the write.
    expect(dialogs.confirms).toHaveLength(1)
    expect(textOf(result)).toContain("not confirmed")
  })

  test("the CLEAR branch removes exactly one entry, and that entry only", async () => {
    /** The stored document: two configured agents, the one being cleared first. */
    const stored = {
      "mpd-config": { agentRoutes: { "Senior Engineer": { provider: "p1", model: "m1" }, Architect: { provider: "p2", model: "m2" } } },
    }
    /** The dialog double: slot1, Senior Engineer, then the clear action — no provider chain follows. */
    const dialogs = dialogDouble(["slot1", "Senior Engineer", "clear"], true, [])
    /** The adapter double whose document carries both entries. */
    const adapter = adapterDouble(CATALOG, { stored })
    /** The chain's outcome, rendered in English. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // The action panel is panel 3; the clear branch opens NO leaf panels (there is nothing to pick).
    expect(dialogs.calls.map((call) => call.ids)).toEqual([
      [...TEAM_MODEL_SLOTS],
      [GROUP_SCOPE_ID, ...TEAM_MODEL_SLOT_GROUPS.slot1.members],
      ["set", "clear"],
    ])
    // ONE write, ONE op: the whole `agentRoutes.<Agent>` entry, never a leaf and never a second entry.
    expect(adapter.writes).toHaveLength(1)
    expect(adapter.writes[0].ops).toHaveLength(1)
    expect(adapter.writes[0].ops[0]).toEqual({ op: "unset", path: ["agentRoutes", "Senior Engineer"] })
    expect(textOf(result)).toContain("cleared")
    expect(textOf(result)).toContain("agentRoutes.Senior Engineer")
    // THE RESOLVER'S VERDICT: ask the REAL resolver about the document after that single removal. The
    // cleared agent is `unconfigured` with both leaf paths, while the sibling keeps its route.
    /** The document after the chain's single removal. */
    const after = { agentRoutes: { Architect: { provider: "p2", model: "m2" } } }
    /** The cleared agent's typed answer. */
    const clearedRoute = resolveAgentRoute("Senior Engineer", after)
    expect(clearedRoute.ok).toBe(false)
    expect(clearedRoute.ok === false ? clearedRoute.reason : "").toBe("unconfigured")
    expect(clearedRoute.ok === false && clearedRoute.reason === "unconfigured" ? clearedRoute.missing : []).toEqual([
      "agentRoutes.Senior Engineer.provider",
      "agentRoutes.Senior Engineer.model",
    ])
    // The sibling entry is untouched: a clear removes ONE agent, not the table.
    expect(resolveAgentRoute("Architect", after).ok).toBe(true)
  })

  test("the clear branch keeps the DOCUMENT's own key spelling", async () => {
    // A hand-written file may spell a member differently (`SeniorEngineer`), and the roster lookup is
    // case- and separator-insensitive (contract §1), so the removal must address the key a READER
    // resolves instead of adding a second, dead spelling to the table.
    /** The stored document, whose key is not the canonical display name. */
    const stored = { "mpd-config": { agentRoutes: { SeniorEngineer: { provider: "p1", model: "m1" } } } }
    /** The dialog double: slot1, the agent, then the clear action. */
    const dialogs = dialogDouble(["slot1", "Senior Engineer", "clear"], true, [])
    /** The adapter double over that document. */
    const adapter = adapterDouble(CATALOG, { stored })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    expect(adapter.writes[0].ops[0]?.path).toEqual(["agentRoutes", "SeniorEngineer"])
  })

  test("an agent with NO stored entry skips the action panel; one WITH an entry gets it", async () => {
    // The action panel is offered only when the clear branch has something to remove; the set path is
    // the only meaningful act for an unconfigured agent, so its chain is one panel shorter.
    /** The stored document: Architect has an entry, Planner does not. */
    const stored = { "mpd-config": { agentRoutes: { Architect: { provider: "p", model: "m" } } } }
    /** The dialog double: Architect gets the action panel before the leaf panels. */
    const withEntry = dialogDouble(["slot1", "Architect", "set", "prov-a", "model-a1", "low"], true, [])
    /** Its adapter double. */
    const withAdapter = adapterDouble(CATALOG, { stored })
    /** The chain's outcome for the configured agent. */
    const configured = await openModelMenu(NO_TUI, LOG, { dialogs: withEntry.seam, adapter: withAdapter.seam, langInputs: EN })
    expect(configured.kind).toBe("success")
    expect(withEntry.calls[2].ids).toEqual(["set", "clear"])
    expect(withAdapter.writes[0].ops).toHaveLength(3)
    // The unconfigured agent's chain skips that panel entirely.
    /** The dialog double: Planner goes straight to the leaf panels. */
    const noEntry = dialogDouble(["slot1", "Planner", "prov-a", "model-a1", "low"], true, [])
    /** Its adapter double, over the same document. */
    const noAdapter = adapterDouble(CATALOG, { stored })
    /** The chain's outcome for the unconfigured agent. */
    const fresh = await openModelMenu(NO_TUI, LOG, { dialogs: noEntry.seam, adapter: noAdapter.seam, langInputs: EN })
    expect(fresh.kind).toBe("success")
    expect(noEntry.calls[2].ids).toEqual(["prov-a", "prov-b"])
    expect(noEntry.calls).toHaveLength(5)
  })

  // ── degradation, refusal and defensive arms ───────────────────────────────
  test("CANCEL at any SELECT panel ends the chain and writes NOTHING", async () => {
    // Six arms, one per select panel. The action-panel arm uses a configured agent, because that is
    // the only case in which the panel exists at all.
    /** The stored document the action-panel arm needs. */
    const stored = { "mpd-config": { agentRoutes: { Architect: { provider: "p", model: "m" } } } }
    /** One arm: its dialog double, the panel count it must have seen, and the English phrase it names. */
    const arms: readonly { dialogs: DialogDouble; panels: number; token: string }[] = [
      { dialogs: dialogDouble([undefined]), panels: 1, token: "group panel was cancelled" },
      { dialogs: dialogDouble(["slot1", undefined]), panels: 2, token: "scope panel was cancelled" },
      { dialogs: dialogDouble(["slot1", "Architect", undefined]), panels: 3, token: "action panel was cancelled" },
      { dialogs: dialogDouble(["slot1", "Planner", undefined]), panels: 3, token: "provider panel was cancelled" },
      { dialogs: dialogDouble(["slot1", "Planner", "prov-a", undefined]), panels: 4, token: "model panel was cancelled" },
      { dialogs: dialogDouble(["slot1", "Planner", "prov-a", "model-a1", undefined]), panels: 5, token: "reasoning-effort panel was cancelled" },
    ]
    for (const arm of arms) {
      /** A fresh adapter double per arm, so its write log is that arm's alone. */
      const adapter = adapterDouble(CATALOG, { stored })
      /** That arm's outcome. */
      const result = await openModelMenu(NO_TUI, LOG, { dialogs: arm.dialogs.seam, adapter: adapter.seam, langInputs: EN })
      expect(arm.dialogs.calls).toHaveLength(arm.panels)
      // THE RULE: no write happened on this path, at any panel.
      expect(adapter.writes).toHaveLength(0)
      expect(result.kind).toBe("error")
      expect(textOf(result)).toContain(arm.token)
    }
  })

  test("an UNBOUND dialogs seam ends the chain before any panel and writes nothing", async () => {
    /** The dialog double reporting an uncomposed seam. */
    const dialogs = dialogDouble([], false)
    /** The adapter double: it must receive no write. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(dialogs.calls).toHaveLength(0)
    expect(adapter.writes).toHaveLength(0)
    expect(textOf(result)).toContain("no dialogs seam")
  })

  test("an ABSENT catalog opens the panels over the declared fallback and says so", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot2", GROUP_SCOPE_ID, "prov-a", "model-a1", "low"], true, [true])
    /** The adapter double with no `llmCatalog` member at all. */
    const adapter = adapterDouble(CATALOG, { withCatalog: false })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // The panels still open, over the DECLARED list — never empty, and the outcome names the branch.
    expect(dialogs.calls[2].ids.length).toBeGreaterThan(0)
    expect(textOf(result)).toContain("the live model catalog is unavailable")
    expect(textOf(result)).toContain("no llmCatalog seam")
    // The write still lands: a degraded catalog must not block configuring an agent.
    expect(adapter.writes).toHaveLength(1)
  })

  test("a DEGRADED catalog is treated as no live read, and the outcome names the degradation", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "Planner", "prov-a", "model-a1", "low"], true, [])
    /** The adapter double whose catalog read came back degraded. */
    const adapter = adapterDouble({ ...CATALOG, degraded: true })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    expect(textOf(result)).toContain("the catalog read was incomplete")
  })

  test("a THROWING catalog read degrades instead of failing the command", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "Planner", "prov-a", "model-a1", "low"], true, [])
    /** The adapter double whose catalog read rejects. */
    const adapter = adapterDouble(Promise.reject(new Error("boom")))
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    expect(textOf(result)).toContain("boom")
  })

  test("panel 3 narrows to the picked provider's models; panel 4 to the picked model's efforts", () => {
    /** The section's option projection. */
    const lists = teamModelOptionLists(CATALOG as never)
    /** The projection after picking prov-a (two models). */
    const atProvider = panelOptions(lists, "prov-a", undefined, CATALOG)
    expect(atProvider.model.map((option) => option.value)).toEqual(["model-a1", "model-a2"])
    // After picking model-a2, the effort list is that model's own.
    const atModel = panelOptions(lists, "prov-a", "model-a2", CATALOG)
    expect(atModel.reasoningEffort.map((option) => option.value)).toEqual(["high"])
  })

  test("panel 3 is NEVER empty: a keyed provider with no models falls back to the union", () => {
    /** A catalog whose provider lists no models at all. */
    const sparse = { degraded: false, providers: [{ id: "prov-empty", models: [] }] }
    /** The section's option projection over that catalog. */
    const lists = teamModelOptionLists(sparse as never)
    // The provider is known but keyed empty: the union the settings row offers is the honest fallback.
    const options = panelOptions(lists, "prov-empty", undefined, sparse)
    expect(options.model.length).toBeGreaterThan(0)
  })

  test("a REFUSED write is reported with the host's own error, and never as success", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "Planner", "prov-a", "model-a1", "low"], true, [])
    /** The adapter double whose write is refused. */
    const adapter = adapterDouble(CATALOG, { write: { ok: false, error: "revision mismatch" } })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(textOf(result)).toContain("revision mismatch")
    expect(textOf(result)).not.toContain(BRIDGE_DISCLOSURE)
  })

  test("an adapter with no settings write seam is reported, not thrown", async () => {
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "Planner", "prov-a", "model-a1", "low"], true, [])
    /** The adapter double with no `settingsMutate` member. */
    const adapter = adapterDouble(CATALOG, { withMutate: false })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(textOf(result)).toContain("no settings write seam")
  })

  test("an unknown group id writes nothing and says which value was unknown", async () => {
    /** The dialog double answering an id no group carries. */
    const dialogs = dialogDouble(["slot9"], true, [])
    /** The adapter double: it must receive no write. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(adapter.writes).toHaveLength(0)
    expect(textOf(result)).toContain("slot9")
    // The chain stopped at panel 1: no further panel was opened.
    expect(dialogs.calls).toHaveLength(1)
  })

  test("an agent outside the picked group writes nothing and says which value was unknown", async () => {
    /** The dialog double whose scope answer is a real member of ANOTHER group. */
    const dialogs = dialogDouble(["slot2", "Architect"], true, [])
    /** The adapter double: it must receive no write. */
    const adapter = adapterDouble(CATALOG)
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(adapter.writes).toHaveLength(0)
    expect(textOf(result)).toContain("Architect")
    expect(dialogs.calls).toHaveLength(2)
  })

  test("an unknown action id writes nothing and says which value was unknown", async () => {
    /** The stored document, so the action panel is actually opened. */
    const stored = { "mpd-config": { agentRoutes: { Architect: { provider: "p", model: "m" } } } }
    /** The dialog double answering an action id no panel offers. */
    const dialogs = dialogDouble(["slot1", "Architect", "delete"], true, [])
    /** The adapter double: it must receive no write. */
    const adapter = adapterDouble(CATALOG, { stored })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("error")
    expect(adapter.writes).toHaveLength(0)
    expect(textOf(result)).toContain("delete")
  })

  test("a group write prefers the ENTRY namespace even when a LATER member is the stored one", async () => {
    // A group's members may be stored unevenly: the FIRST may be unconfigured while a later one is
    // stored, and the two namespaces may even both be in play. The write is ONE mutate call, so it must
    // land on the ENTRY namespace whenever ANY member is stored there — writing the legacy name instead
    // would add a dead duplicate of a member whose real entry the resolver reads from the entry.
    /** The split document: Researcher (first in slot 2) under the legacy name, Explorer under the entry. */
    const stored = {
      mpd: { agentRoutes: { Researcher: { provider: "legacy", model: "legacy-model" } } },
      "mpd-config": { agentRoutes: { Explorer: { provider: "entry", model: "entry-model" } } },
    }
    /** The dialog double answering a whole-group write of slot 2. */
    const dialogs = dialogDouble(["slot2", GROUP_SCOPE_ID, "prov-a", "model-a1", "low"], true, [true])
    /** The adapter double over that split document. */
    const adapter = adapterDouble(CATALOG, { stored, revision: 9 })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // The ENTRY wins because Explorer is stored there, and its stored key spelling is preserved.
    expect(adapter.writes[0].namespace).toBe("mpd-config")
    expect(adapter.writes[0].revision).toBe(9)
    expect(adapter.writes[0].ops.filter((op) => op.path[1] === "Explorer")).toHaveLength(3)
  })

  test("the revision fence comes from the namespace the write targets", async () => {
    // A write must carry the document's current revision, or a concurrent edit is silently clobbered.
    /** The stored value under the LEGACY namespace, with revision 7. */
    const stored = { mpd: { agentRoutes: { Planner: { provider: "p", model: "m" } } } }
    /** The dialog double answering every panel. */
    const dialogs = dialogDouble(["slot1", "Planner", "set", "prov-a", "model-a1", "low"], true, [])
    /** The adapter double over that document. */
    const adapter = adapterDouble(CATALOG, { stored, revision: 7 })
    /** The chain's outcome. */
    const result = await openModelMenu(NO_TUI, LOG, { dialogs: dialogs.seam, adapter: adapter.seam, langInputs: EN })
    expect(result.kind).toBe("success")
    // The stored entry (under `mpd`) picks the namespace, and its revision rides the write.
    expect(adapter.writes[0].namespace).toBe(MODEL_NAMESPACE)
    expect(adapter.writes[0].revision).toBe(7)
  })
})

describe("the agent-route table helpers read the DOCUMENT, not an invented shape", () => {
  test("routeTableOf finds the table at the root and under both host-document halves", () => {
    expect(routeTableOf({ agentRoutes: { Architect: { provider: "p" } } })).toEqual({ Architect: { provider: "p" } })
    // The host document nests the value under `user`; the read must not lose it there.
    expect(routeTableOf({ user: { agentRoutes: { Planner: { model: "m" } } } })).toEqual({ Planner: { model: "m" } })
    expect(routeTableOf({ value: { agentRoutes: { Lead: { model: "m" } } } })).toEqual({ Lead: { model: "m" } })
    // A value that carries no table, or no value at all, is an empty table — never a throw.
    expect(routeTableOf({ teamModels: {} })).toEqual({})
    expect(routeTableOf(undefined)).toEqual({})
  })

  test("storedAgentRoute keeps only the usable string leaves", () => {
    expect(storedAgentRoute({ agentRoutes: { Architect: { provider: "p", model: "m", reasoningEffort: "max" } } }, "Architect"))
      .toEqual({ provider: "p", model: "m", reasoningEffort: "max" })
    // The roster lookup is case- and separator-insensitive (contract §1).
    expect(storedAgentRoute({ agentRoutes: { SeniorEngineer: { provider: "p" } } }, "Senior Engineer")).toEqual({ provider: "p" })
    // A non-string leaf is not a stored value, and an absent entry is empty — never invented.
    expect(storedAgentRoute({ agentRoutes: { Architect: { provider: 7 } } }, "Architect")).toEqual({})
    expect(storedAgentRoute(undefined, "Architect")).toEqual({})
  })

  test("routeKeyFor answers the document's own spelling, else the canonical name", () => {
    expect(routeKeyFor({ SeniorEngineer: {} }, "Senior Engineer")).toBe("SeniorEngineer")
    expect(routeKeyFor({}, "Senior Engineer")).toBe("Senior Engineer")
    // An empty member name matches nothing and stays as given, never collapsing to the first key.
    expect(routeKeyFor({ Architect: {} }, "")).toBe("")
  })

  test("locateNamespace prefers the stored entry, else the config ENTRY the host can mutate", () => {
    /** An adapter whose entry namespace stores the agent. */
    const entryStored = adapterDouble(CATALOG, { stored: { "mpd-config": { agentRoutes: { Architect: { provider: "p" } } } }, revision: 3 })
    expect(locateNamespace(entryStored.seam, "Architect")).toEqual({
      namespace: "mpd-config",
      revision: 3,
      table: { Architect: { provider: "p" } },
    })
    /** An adapter whose agent is stored ONLY under the legacy namespace. */
    const legacyStored = adapterDouble(CATALOG, { stored: { mpd: { agentRoutes: { Architect: { provider: "p" } } } }, revision: 4 })
    expect(locateNamespace(legacyStored.seam, "Architect").namespace).toBe("mpd")
    // Nothing stored anywhere: the ENTRY is the fallback, because it is the only key the host mutates.
    const empty = adapterDouble(CATALOG, { revision: 5 })
    expect(locateNamespace(empty.seam, "Architect")).toEqual({ namespace: "mpd-config", revision: 5, table: {} })
  })

  test("hasStoredRoute answers a stored entry under EITHER namespace", () => {
    /** An adapter whose entry namespace stores the agent. */
    const entryStored = adapterDouble(CATALOG, { stored: { "mpd-config": { agentRoutes: { Architect: { provider: "p" } } } } })
    expect(hasStoredRoute(entryStored.seam, "Architect")).toBe(true)
    /** An adapter whose agent lives under the legacy namespace only. */
    const legacyStored = adapterDouble(CATALOG, { stored: { mpd: { agentRoutes: { Architect: { provider: "p" } } } } })
    expect(hasStoredRoute(legacyStored.seam, "Architect")).toBe(true)
    /** An adapter whose document carries no route for the agent. */
    const missing = adapterDouble(CATALOG, { stored: { "mpd-config": { agentRoutes: { Planner: { provider: "p" } } } } })
    expect(hasStoredRoute(missing.seam, "Architect")).toBe(false)
  })

  test("readStoredRoutes reads every roster agent from whichever namespace serves them", () => {
    /** The adapter double whose legacy namespace carries one agent. */
    const adapter = adapterDouble(CATALOG, { stored: { mpd: { agentRoutes: { "Vision Analyst": { model: "vision" } } } } })
    /** The per-agent read. */
    const stored = readStoredRoutes(adapter.seam)
    expect(stored["Vision Analyst"]).toEqual({ model: "vision" })
    expect(stored.Architect).toEqual({})
    // Every roster agent has a key, so a display never has to test for absence.
    expect(Object.keys(stored)).toHaveLength(ROSTER_AGENT_NAMES.length)
  })

  test("agentRouteDisplay narrows the REAL config-service union, never trusting a lookalike", () => {
    // The display is the seam between the config service's typed union (contract §2) and every panel.
    /** A service answering `ok`, `unconfigured`, `invalid` and `unrouted` respectively. */
    const service = serviceDouble((member: string): unknown => {
      if (member === "Architect") return okAnswer("p", "m", "max")
      if (member === "Planner") return { ok: false, reason: "unconfigured", agent: member, missing: ["agentRoutes.Planner.provider"] }
      if (member === "Researcher") return { ok: false, reason: "invalid", agent: member, problem: "agentRoutes.Researcher.model" }
      return { ok: false, reason: "unrouted" }
    })
    expect(agentRouteDisplay(service, "Architect")).toEqual({ state: "ok", route: "p / m / max", fallbacks: 0 })
    expect(agentRouteDisplay(service, "Planner")).toEqual({ state: "unconfigured", missing: ["agentRoutes.Planner.provider"] })
    expect(agentRouteDisplay(service, "Researcher")).toEqual({ state: "invalid" })
    // `unrouted` is an EXTENSION role's state, not an unconfigured agent: a display says unavailable.
    expect(agentRouteDisplay(service, "Explorer")).toEqual({ state: "unavailable" })
    // An absent service, or one with no typed read, degrades instead of throwing.
    expect(agentRouteDisplay(undefined, "Architect")).toEqual({ state: "unavailable" })
    expect(agentRouteDisplay({}, "Architect")).toEqual({ state: "unavailable" })
  })

  test("the command describes the NEW flow, in both languages", () => {
    expect(MODEL_COMMAND).toBe("mpd-model")
    // The palette line is USER-VISIBLE: it names the agent-keyed chain instead of the retired slot one.
    expect(MODEL_COMMAND_DESCRIPTIONS.en).toContain("group")
    expect(MODEL_COMMAND_DESCRIPTIONS.en).toContain("one agent")
    expect(MODEL_COMMAND_DESCRIPTIONS.en).toContain("confirmation")
    expect(MODEL_COMMAND_DESCRIPTIONS.zh).toContain("分组")
    expect(MODEL_COMMAND_DESCRIPTIONS.zh).toContain("单个代理")
    // The retired vocabulary must be gone from the one string a reader sees before opening the menu.
    for (const half of [MODEL_COMMAND_DESCRIPTIONS.en, MODEL_COMMAND_DESCRIPTIONS.zh]) {
      expect(half.toLowerCase()).not.toContain("slot")
      expect(half).not.toContain("槽位")
      expect(half).not.toContain("teamModels")
      expect(half).not.toContain("agentRoutes")
    }
    // The harness command registry stores ONE string; it is the en half, so the two cannot drift.
    expect(MODEL_COMMAND_DESCRIPTION).toBe(MODEL_COMMAND_DESCRIPTIONS.en)
  })
})

// ── CodeRabbit #14 (PR #62): the route sentence is CONFIGURATION and must be sanitized ───────────
describe("the agent's current-route sentence strips control characters (whitespace preserved)", () => {
  test("a control character in a provider/model id never reaches the dialog description", () => {
    /** A BEL character, as a hand-edited config could carry it. */
    const bel = String.fromCharCode(7)
    /** A NUL character, the other shape a hand-edited file can carry. */
    const nul = String.fromCharCode(0)
    /** An ESC character, the shape that would rewrite a terminal. */
    const esc = String.fromCharCode(27)
    /** The typed answer whose provider and model carry those characters. */
    const display = agentRouteDisplay(serviceDouble(() => ({
      ok: true,
      agent: "Architect",
      route: { provider: "pro" + bel + "v", model: "mo" + nul + "del", reasoningEffort: "hi" + esc + "gh" },
      fallbacks: [],
    })), "Architect")
    // The typed state survives; the CONTROL characters do not, and the " / " separators are intact.
    expect(display.state).toBe("ok")
    expect(display.state === "ok" ? display.route : "").toBe("pro v / mo del / hi gh")
    // The same sentence the panels render is the sanitized one.
    expect(agentRouteText("en", display)).toBe("current: pro v / mo del / hi gh")
  })
})
