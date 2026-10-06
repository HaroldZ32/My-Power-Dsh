// THE SIDEBAR PANEL (dsh-tui 0.13.0) — the seam, the frozen descriptor, the merged body and the
// routing that decides between the panel and the existing full-screen scene.
//
// HARNESS. Unlike the scene suites, these arms drive the REAL seam adapter
// (`createTuiAdapter` from `packages/mpd-tui-adapter-plugin`) over a ctx DOUBLE, because the facts
// under test are the adapter's own: the descriptor reaches the host through it, the final id is
// discovered from the host's `list()` read-back, and `panelSeamBound()` is the adapter's binding
// state — a hand-written adapter stub would assert the stub instead of the contract.
//
// The ctx double MODELS THE HOST (the same discipline `plugin.test.ts` states for its own fakes):
//   * a service is NOT reachable through `ctx.get` — only through the injected scope, which is the
//     measured behaviour that made an inject-free registration invisible;
//   * `ctx.inject([id], cb)` runs `cb` exactly when that service is composed, and the injected scope
//     resolves it — so deleting the service from the map is what makes the seam genuinely unbound;
//   * the panel registry composes its ids as `act<N>:<slug>`, the host's own fallback form, so an arm
//     can prove the id was READ BACK rather than composed here.
//
// The React/ui double is the one `subagent-scene.test.ts` renders its scenes with: hook state keyed
// by position, effects queued, and a row-aware flattening. It is carried verbatim rather than
// re-invented so the two suites agree on what "one drawn row" means.
import { describe, expect, test } from "bun:test"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index.js"
import { createLog } from "../src/log"
import { createPanelComponent, PANEL_DESCRIPTOR_FROZEN, PANEL_MIN_COLUMNS, PANEL_ORDER, PANEL_SLUG, PANEL_TITLE, panelStatusLine, registerPanelSurface, takeoverArmed } from "../src/panel"
import { pick, TUI_TEXT, t } from "../src/i18n"
import type { TeamWorkflow } from "../src/team-state"

// ── fixtures ────────────────────────────────────────────────────────────────

/** The live subagent the fixture host reports: a continuable MPD teammate, running. */
const LIVE_ROW = {
  agentId: "agent-live",
  description: "Panel Engineer",
  status: "running",
  mode: "continuable",
  startedAt: Date.UTC(2026, 9, 6, 15, 20, 9),
}

/** The settled subagent the fixture host reports: a one-shot consult that ended. */
const DONE_ROW = {
  agentId: "agent-done",
  description: "Plan Reviewer",
  status: "completed",
  mode: "one-shot",
  startedAt: Date.UTC(2026, 9, 6, 15, 21, 0),
  completedAt: Date.UTC(2026, 9, 6, 15, 22, 30),
}

/**
 * A minimal readable team projection — the shape `readTeamWorkflow`/`readRecordWorkflow` produce.
 * @returns one team with two tasks and one dependency edge.
 */
function workflowFixture(): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-panel-fixture",
    team: { id: "team-20261006152009", name: "wave-3", phase: "active", staged: false, runnable: true, links: 1 },
    members: [{ name: "Panel Engineer", role: "Senior Engineer", status: "running", done: 1, total: 2, progress: 50, unread: null }],
    tasks: [
      { id: "T1", subject: "build the panel", kind: "work", status: "completed", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
      { id: "T2", subject: "migrate the plugin", kind: "work", status: "pending", visual: "blocked", dependencies: ["T1"], failedDependencies: [], depth: 1 },
    ],
    counts: { total: 2, completed: 1, inProgress: 0, pending: 1, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/** One host-registered panel row, as the host's own `list()` read-back serves it. */
interface PanelRow {
  /** The final id the host composed. */
  id: string
  /** The title the host stored. */
  title: string
  /** The row's source; `plugin` for every plugin-registered panel. */
  source: string
}

/** The panel registry double: the host's own registration log, read-back and open/refusal answers. */
interface PanelRegistryDouble {
  /** Every descriptor the host received, in registration order (the raw object, not a projection). */
  registered: Record<string, unknown>[]
  /** The host's read-back: only the calling activation's panels. */
  list(): readonly PanelRow[]
  /** Registers one panel under the host's composed id. */
  register(descriptor: Record<string, unknown>): () => void
  /** Opens one panel id; an arm overrides this to model a refusal. */
  open(id: string): boolean
}

/**
 * The RAW descriptors a host double received, read through the registry its `register` recorded into.
 *
 * The double's declared field is typed `Record<string, unknown>` on purpose: the arms assert the
 * descriptor's own fields (`apiVersion`, `compact`, `component`), which a narrow interface would
 * force them to restate instead of checking what the host actually got.
 * @param host - the host double.
 * @returns the recorded descriptors, in registration order.
 */
function rawDescriptors(host: HostDouble): Record<string, unknown>[] {
  return host.panels?.registered ?? []
}

/** The host double one arm drives the adapter and the panel surface against. */
interface HostDouble {
  /** The context handed to `createTuiAdapter` / `registerPanelSurface`. */
  ctx: Record<string, any>
  /** The panel registry double, or undefined for a pre-0.13.0 host. */
  panels: PanelRegistryDouble | undefined
  /** Every service id the ctx was asked to read through `get`. */
  probes: string[]
  /** The dependency list of every `inject` call made against this ctx. */
  injections: string[][]
}

/**
 * Build a host double whose injected scopes are the only way to reach a service.
 * @param options - whether this host composes the panel seam, the activation name it prefixes ids
 *   with, and how its registry answers.
 * @returns the context, the registry and the recorded probes.
 */
function hostDouble(options: { panels?: boolean; activation?: string; registry?: Partial<PanelRegistryDouble> } = {}): HostDouble {
  /** Every service id probed through `get`. */
  const probes: string[] = []
  /** Every `inject` call's dependency list. */
  const injections: string[][] = []
  /** The rows the host's own `list()` serves. */
  const rows: PanelRow[] = []
  /** The activation name the host prefixes every composed id with (its own unpredictable half). */
  const activation = options.activation ?? "act0"
  /** The panel registry double, built only when this host composes the seam. */
  const registry: PanelRegistryDouble | undefined = options.panels === false
    ? undefined
    : {
        /** The RAW descriptors the host received, in registration order. */
        registered: [],
        /** The host's read-back: only the calling activation's panels. */
        list: () => rows,
        /** Records one registration and composes its id the way the host does. */
        register(descriptor: Record<string, unknown>): () => void {
          // The RAW descriptor is recorded — the arms assert its own fields (`apiVersion`,
          // `minColumns`, `compact`, the component) against what the host really received.
          /** The descriptor, recorded as the host received it. */
          const received = descriptor as { id: string; title: string }
          registry?.registered.push(descriptor)
          rows.push({ id: `${activation}:${received.id}`, title: received.title, source: "plugin" })
          return () => {}
        },
        open: () => true,
        ...options.registry,
      }

  /** Builds one context object; every injected scope gets its own. */
  const build = (): Record<string, any> => {
    /** The context under construction. */
    const ctx: Record<string, any> = {
      /** Inject-free visibility, as the real host has: no service is reachable here. */
      get(name: string, strict?: boolean): undefined {
        probes.push(name)
        void strict
        return undefined
      },
      /** Runs the cleanup immediately, as the host's fiber ownership would. */
      effect(callback: () => () => void): Record<string, never> {
        callback()
        return {}
      },
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    }
    ctx.inject = (dependencies: readonly string[], callback: (scoped: Record<string, any>) => void) => {
      injections.push([...dependencies])
      /** The injected scope, whose `get` resolves the mounted services. */
      const scoped = build()
      scoped.get = (name: string) => (name === "tuiPanels" ? registry : undefined)
      if (registry !== undefined && dependencies.includes("tuiPanels")) callback(scoped)
      return {}
    }
    return ctx
  }
  return { ctx: build(), panels: registry, probes, injections }
}

/** The log double the panel surface writes through. */
function logDouble(): ReturnType<typeof createLog> {
  return createLog(undefined, "mpd-tui")
}

/** The deps one registration needs; `openMergedScene` counts the fallback opens. */
function panelDeps(overrides: { openMergedScene?: () => boolean } = {}): { opened: number; deps: Parameters<typeof registerPanelSurface>[1] } {
  /** How many times the fallback scene path was asked to open. */
  const counter = { opened: 0 }
  return {
    /** How many times the fallback scene path was asked to open so far. */
    get opened(): number {
      return counter.opened
    },
    deps: {
      enabled: true,
      readWorkflow: () => workflowFixture(),
      openMergedScene: () => {
        counter.opened += 1
        return overrides.openMergedScene === undefined ? true : overrides.openMergedScene()
      },
      log: logDouble(),
    },
  }
}

// ── the React / ui double (the same one subagent-scene.test.ts uses) ─────────

/** A rendered element as the React double produces it. */
interface Element {
  /** The element type: a host component or a tag name. */
  type: unknown
  /** The element's props, with the double's defaults applied. */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one arm renders the panel with. */
interface Kit {
  /** The React double the panel must use. */
  React: Record<string, unknown>
  /** The ui kit double the panel must use. */
  ui: Record<string, unknown>
  /** Flattens a rendered tree into its text. */
  text(tree: unknown): string
  /** The last tree `text` flattened. */
  last(): unknown
}

/**
 * A minimal host kit double: index-keyed hook state and a row-aware flattening.
 * @param columns - the width the kit's `useTerminalSize` reports (the panel's ONLY geometry source).
 * @returns the kit.
 */
function makeKit(columns: number = 34): Kit {
  /** Hook state, keyed by hook position. */
  const store = new Map<string, unknown>()
  /** The hook counter of the current render pass. */
  let index = 0
  /** The last tree `text` flattened, so props stay assertable. */
  let lastTree: unknown

  /** The React double: index-keyed hooks. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This state cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, initial)
      return [store.get(key), (next: unknown) => store.set(key, next)]
    },
    useEffect: (): void => {
      index += 1
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
  }

  // The three component doubles below IDENTIFY their name in `type` (so a test can assert WHICH host
  // component drew a row) and carry their children the way React does — as `children` on the element
  // — so the flattening walks the tree exactly as the scene suite's double does.
  /** The Text component: identity plus the children it renders. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: the host's column, flattening as one row per child. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The ScrollBox component: the host's scrolling column, a column to the flattening too. */
  const ScrollBox = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Divider component: a one-cell rule. */
  const Divider = (): Element => ({ type: "Text", props: {}, children: ["─"] })
  /** The ui kit, with a fixed panel size. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    ScrollBox,
    Divider,
    useTerminalSize: (): { columns: number; rows: number } => ({ columns, rows: 30 }),
  }

  return {
    React,
    ui,
    text: (tree: unknown): string => {
      lastTree = tree
      /** The rendered lines. */
      const out: string[] = []
      /** Every character inside one node, spans joined with nothing. */
      const inline = (node: unknown): string => {
        if (node === null || node === undefined) return ""
        if (typeof node === "string") return node
        if (typeof node === "number") return String(node)
        if (Array.isArray(node)) return node.map(inline).join("")
        /** This node as an element, the only shape left after the guards. */
        const element = node as Element
        return inline(element.props?.children) + inline(element.children ?? [])
      }
      /** Walks the tree one ROW at a time: a Box is a column, so each of its children is a line. */
      const rows = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) {
          for (const child of node) rows(child)
          return
        }
        if (typeof node === "string" || typeof node === "number") {
          out.push(String(node))
          return
        }
        /** This node as an element. */
        const element = node as Element
        if (element.type === "Box") {
          for (const child of element.children ?? []) rows(child)
          return
        }
        out.push(inline(node))
      }
      rows(tree)
      return out.join("\n")
    },
    last: () => lastTree,
  }
}

/**
 * The row texts of a rendered tree, in DRAW order.
 *
 * The panel's body is a column of `ui.Text` rows (the DAG's own rows wrap further Text spans inside
 * one outer Text), so the ORDER of the sections is read off the element tree rather than from a
 * flattened string — a flattening that joins every row with a newline cannot be asked where one row
 * sits relative to another.
 * @param tree - the rendered tree.
 * @returns one string per drawn row, in render order.
 */
function drawnRowTexts(tree: unknown): string[] {
  /** The rows, in draw order. */
  const out: string[] = []
  /** Every character inside one node, nested spans joined with nothing. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element, the only shape left after the guards. */
    const element = node as Element
    return inline(element.props?.children) + inline(element.children ?? [])
  }
  /** Walks the tree one ROW at a time: an element that renders a column contributes its children. */
  const rows = (node: unknown): void => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) rows(child)
      return
    }
    if (typeof node === "string" || typeof node === "number") {
      out.push(String(node))
      return
    }
    /** This node as an element. */
    const element = node as Element
    if (element.type === "Box") {
      for (const child of element.props?.children as unknown[] ?? element.children ?? []) rows(child)
      return
    }
    // A nested Text (the DAG wraps its own coloured spans in one outer Text) renders a COLUMN of
    // children in the host's kit, so a nested child list is walked, not joined: joining it would make
    // the order assertions below unanswerable.
    const children = element.children ?? []
    if (children.length > 0 && typeof children[0] === "object" && children[0] !== null) {
      for (const child of children) rows(child)
      return
    }
    out.push(inline(node))
  }
  rows(tree)
  return out
}

// ── the frozen descriptor + the discovered id ────────────────────────────────
describe("the panel registration (frozen descriptor, discovered id)", () => {
  test("registers ONE panel with the frozen descriptor and the host's own read-back id", () => {
    /** A host that composes the panel seam. */
    const host = hostDouble()
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, panelDeps().deps)
    /** The raw descriptor the host's `register` received, read straight off the recording registry. */
    const descriptor = rawDescriptors(host)[0]
    expect(rawDescriptors(host)).toHaveLength(1)
    expect(descriptor?.apiVersion).toBe(1)
    expect(descriptor?.id).toBe("team")
    expect(descriptor?.title).toBe("MPD")
    expect(descriptor?.minColumns).toBe(32)
    expect(descriptor?.order).toBe(10)
    // No icon (the host demands exactly one display cell) and — deliberately — NO `compact`: the
    // 0.13.0 host validates and stores that slot but does NOT mount its render slot, so declaring one
    // would claim a surface that cannot render.
    expect(descriptor?.icon).toBeUndefined()
    expect(descriptor?.compact).toBeUndefined()
    expect(typeof descriptor?.component).toBe("function")
    // The module-level frozen constants agree with what the host received.
    expect(PANEL_DESCRIPTOR_FROZEN).toEqual({ apiVersion: 1, id: PANEL_SLUG, title: PANEL_TITLE, minColumns: PANEL_MIN_COLUMNS, order: PANEL_ORDER })
    // THE ID IS THE HOST'S, DISCOVERED from its own `list()` read-back — never composed here.
    expect(surface.id()).toBe("act0:team")
    expect(surface.registered()).toBe(true)
    expect(surface.outcome().state).toBe("confirmed")
  })

  test("the final id is READ BACK, not composed from the slug", () => {
    // A host whose activation prefix is nothing like this package's name: a locally composed
    // `<pluginId>:<slug>` would produce `mpd-tui:team` and fail here.
    /** A host whose registry names its activation `act7` (the host's own unpredictable half). */
    const host = hostDouble({ activation: "act7" })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, panelDeps().deps)
    expect(surface.id()).toBe("act7:team")
    // The registration confirmed through that read-back, and the id is NOT the locally derived form.
    expect(surface.outcome().state).toBe("confirmed")
    expect(surface.id()).not.toBe(`mpd-tui:${PANEL_SLUG}`)
  })

  test("a host with no panel seam degrades to absent and still reports an honest outcome", () => {
    /** A pre-0.13.0 host: the panel service is not composed at all. */
    const host = hostDouble({ panels: false })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, panelDeps().deps)
    expect(tui.panelSeamBound()).toBe(false)
    expect(surface.id()).toBeUndefined()
    expect(surface.registered()).toBe(false)
    expect(surface.outcome().state).toBe("absent")
  })

  test("the surface can be switched off entirely by its own config", () => {
    /** A host that composes the panel seam. */
    const host = hostDouble()
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The registered surface, with the knob off. */
    const surface = registerPanelSurface(tui as never, { ...panelDeps().deps, enabled: false })
    expect(host.panels?.registered).toHaveLength(0)
    expect(surface.panel).toBeUndefined()
    expect(surface.id()).toBeUndefined()
    /** The skip's own record: absent, naming the knob. */
    const skipped = surface.outcome()
    expect(skipped.state).toBe("absent")
    expect(String(skipped.detail)).toContain("panel: false")
  })
})

// ── the status sentence, in BOTH languages ─────────────────────────────────

describe("the `/mpd panel` status sentence is bilingual", () => {
  test("every panel sentence exists in en AND zh, and carries its placeholders", () => {
    // The wave's rule: every user-visible string has an `en` and a `zh` entry in `i18n.ts`, which is
    // also the ONLY place they may live. The three sentences cover the three outcomes a routed open
    // can produce; each placeholder must survive both languages.
    for (const key of ["panel.opened", "panel.fallback", "panel.refused", "panel.unavailable"] as const) {
      /** The bilingual pair, read off the dictionary the resolver uses. */
      const pair = TUI_TEXT[key]
      expect(pair.en.length).toBeGreaterThan(0)
      expect(pair.zh.length).toBeGreaterThan(0)
      // Real Chinese content, not a copy of the English sentence.
      expect(pair.zh).not.toBe(pair.en)
      expect(pair.zh).toMatch(/[\u4e00-\u9fff]/u)
    }
    // Both placeholder-bearing sentences substitute the discovered id in each language.
    for (const lang of ["en", "zh"] as const) {
      /** The resolution inputs that pin the language, so nothing reads the process locale. */
      const inputs = { env: { DSH_TUI_LANG: lang }, home: "/nonexistent-mpd-panel-home", readFile: () => "{}" }
      expect(t("panel.opened", { id: "act0:team" }, inputs)).toContain("act0:team")
      expect(t("panel.fallback", { id: "act0:team" }, inputs)).toContain("act0:team")
      // The two placeholder-free sentences must not carry a stray `{id}`.
      expect(t("panel.unavailable", undefined, inputs)).not.toContain("{")
      expect(t("panel.refused", undefined, inputs)).not.toContain("{")
      expect(pick(TUI_TEXT["panel.opened"], lang)).toBe(TUI_TEXT["panel.opened"][lang])
    }
    // The resolved sentence (process state) is always one of the two declared halves, with the id
    // substituted — never a third, untranslated string.
    /** The id the sentence must carry. */
    const id = "act0:team"
    /** The two declared halves with the placeholder substituted. */
    const expected = [
      TUI_TEXT["panel.opened"].en.replace("{id}", id),
      TUI_TEXT["panel.opened"].zh.replace("{id}", id),
    ]
    expect(expected).toContain(panelStatusLine("opened", id))
  })
})

// ── the routing: panel, scene, and the refusal fallback ─────────────────────
// S7: a host that BINDS the seam and REFUSES the descriptor is not "a host with no panel seam".
describe("the routed open on a REFUSING host (S7)", () => {
  test("a bound seam that refused the descriptor reports `refused`, and the line says refused", () => {
    /** A host that composes the panel seam but accepts nothing: `register` returns no new id. */
    const host = hostDouble({ registry: { register: () => () => {}, list: () => [] } })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The scene tracker, so the arm can prove the scene still opens as the surface. */
    const tracker = panelDeps()
    /** The registered surface, whose registration the host turned down. */
    const surface = registerPanelSurface(tui as never, tracker.deps)
    // The SEAM IS BOUND — this is not a pre-0.13.0 host — and the handle reports the refusal.
    expect(tui.panelSeamBound()).toBe(true)
    expect(surface.outcome().state).toBe("refused")
    expect(surface.id()).toBeUndefined()
    /** How the routed open ended. */
    const routed = surface.openOrScene()
    // THE PIN: the refusal is its own outcome, never folded into "this host exposes no panel seam".
    expect(routed.outcome).toBe("refused")
    expect(routed.sceneOpened).toBe(true)
    expect(tracker.opened).toBe(1)
    /** The `/mpd panel` sentence, in the active language. */
    const line = panelStatusLine(routed.outcome, surface.id())
    expect(line).toBe(t("panel.refused"))
    expect(line).not.toBe(t("panel.unavailable"))
    expect(line).not.toContain("{")
  })

  test("NEGATIVE CONTROL: a genuinely absent seam still reads `unavailable`", () => {
    /** A pre-0.13.0 host: the panel service is not composed at all. */
    const host = hostDouble({ panels: false })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The registered surface, whose seam never binds. */
    const surface = registerPanelSurface(tui as never, panelDeps().deps)
    expect(tui.panelSeamBound()).toBe(false)
    expect(surface.openOrScene().outcome).toBe("unavailable")
    expect(panelStatusLine("unavailable", undefined)).toBe(t("panel.unavailable"))
  })
})

describe("the merged-view routing (panel vs full-screen scene)", () => {
  test("with the seam bound and an id discovered, the PANEL opens and the scene does not", () => {
    /** A host that composes the panel seam and accepts the open. */
    const host = hostDouble()
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The open counter for the fallback path. */
    const tracker = panelDeps()
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, tracker.deps)
    /** How the routed open ended. */
    const routed = surface.openOrScene()
    expect(routed.outcome).toBe("opened")
    expect(routed.sceneOpened).toBe(false)
    expect(tracker.opened).toBe(0)
    expect(surface.id()).toBe("act0:team")
  })

  test("with NO seam bound, the full-screen scene opens and no panel is asked", () => {
    /** A pre-0.13.0 host. */
    const host = hostDouble({ panels: false })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The open counter for the fallback path. */
    const tracker = panelDeps()
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, tracker.deps)
    /** How the routed open ended. */
    const routed = surface.openOrScene()
    expect(routed.outcome).toBe("unavailable")
    // THE SCENE IS THE SURFACE, and its own answer is carried through (not assumed true).
    expect(routed.sceneOpened).toBe(true)
    expect(tracker.opened).toBe(1)
  })

  test("an `opened() === false` refusal FALLS BACK to the scene — never a silent no-op", () => {
    /** A host whose registry accepts the registration but refuses every open. */
    const host = hostDouble({ registry: { open: () => false } })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** The open counter for the fallback path. */
    const tracker = panelDeps()
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, tracker.deps)
    /** How the routed open ended. */
    const routed = surface.openOrScene()
    expect(routed.outcome).toBe("fallback")
    expect(routed.sceneOpened).toBe(true)
    expect(tracker.opened).toBe(1)
    // The user is told which surface they are looking at.
    expect(panelStatusLine(routed.outcome, surface.id())).toContain("act0:team")
  })

  test("a bare host without the seam reports the scene path honestly, and a refusing scene is not a success", () => {
    /** A pre-0.13.0 host. */
    const host = hostDouble({ panels: false })
    /** The real adapter over that host. */
    const tui = createTuiAdapter(host.ctx as never)
    /** A composition whose scene seam is missing too. */
    const tracker = panelDeps({ openMergedScene: () => false })
    /** The registered surface. */
    const surface = registerPanelSurface(tui as never, tracker.deps)
    /** How the routed open ended. */
    const routed = surface.openOrScene()
    expect(routed.outcome).toBe("unavailable")
    expect(routed.sceneOpened).toBe(false)
  })
})

// ── the panel body: BOTH sections, from the props' own kit ──────────────────

describe("the panel component (both sections, props kit only)", () => {
  test("renders the host's subagent rows FIRST and the MPD dependency DAG below them", () => {
    /** The host kit double. */
    const kit = makeKit()
    /** The component under test, with the team projection injected as the wiring does. */
    const component = createPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** The rendered tree. */
    const tree = component({
      React: kit.React,
      ui: kit.ui,
      host: { snapshot: () => ({ subagents: [LIVE_ROW, DONE_ROW] }) },
    })
    /** The row texts, in DRAW order — read off the element tree, so the order is exact. */
    const drawOrder = drawnRowTexts(tree)
    /** The index of the first drawn row containing a needle; -1 when no row does. */
    const indexOfRow = (needle: string): number => drawOrder.findIndex((line) => line.includes(needle))
    /** The flattened text, joined across rows for the containment assertions. */
    const text = kit.text(tree)
    // SECTION (a): the host's curated snapshot rows, through the SAME projection the scene uses.
    expect(indexOfRow("subagents  2 total · 1 running · 1 completed · 0 failed")).toBe(0)
    expect(indexOfRow("🟡 1 running · 🟢 1 completed · 🔴 0 failed")).toBe(1)
    expect(indexOfRow("🟡 Panel Engineer · continuable · running")).toBe(2)
    expect(indexOfRow("🟢 Plan Reviewer · one-shot · completed")).toBe(3)
    // SECTION (b): the MPD DAG, drawn for the width the props' `useTerminalSize()` reported.
    expect(indexOfRow("task dependency graph")).toBeGreaterThan(3)
    expect(indexOfRow("│ ✓ T1 WRK build the panel")).toBeGreaterThan(indexOfRow("task dependency graph"))
    expect(indexOfRow("│ ○ T2 WRK migrate the plugin")).toBeGreaterThan(indexOfRow("task dependency graph"))
    expect(text).toContain("blocker → dependent")
    // The divider separates the two sources.
    expect(text).toContain("─")
    // THE ORDER (frozen clause R3): the host's curated rows come FIRST, the MPD DAG below them — no
    // host row may appear after the DAG's own header.
    expect(indexOfRow("subagents  2 total")).toBeLessThan(indexOfRow("task dependency graph"))
    expect(indexOfRow("🟡 Panel Engineer")).toBeLessThan(indexOfRow("task dependency graph"))
    expect(indexOfRow("🟢 Plan Reviewer")).toBeLessThan(indexOfRow("task dependency graph"))
    // The DAG is drawn for the width the PANEL measured and never wider: every box row fits the
    // budget the props' own `useTerminalSize()` reported.
    /** The drawn box rows of this render. */
    const boxRows = drawOrder.filter((row) => /^[┌│└]/.test(row))
    expect(boxRows.length).toBeGreaterThan(3)
    for (const row of boxRows) expect(row.length).toBeLessThanOrEqual(34)
    // …and the GEOMETRY IS THE PANEL'S OWN: the host's `useTerminalSize` is the only width source a
    // panel has, so the same fixture rendered in a NARROW panel draws a narrower box than this one —
    // a hard-coded scene width could not do that.
    /** A second kit whose panel measures a narrow sidebar. */
    const narrow = makeKit(20)
    /** The same component rendered through it. */
    const narrowTree = component({ React: narrow.React, ui: narrow.ui, host: { snapshot: () => ({ subagents: [LIVE_ROW, DONE_ROW] }) } })
    /** The narrower render's box rows. */
    const narrowBoxRows = drawnRowTexts(narrowTree).filter((row) => /^[┌│└]/.test(row))
    expect(narrowBoxRows[0].length).toBeLessThan(boxRows[0].length)
    for (const row of narrowBoxRows) expect(row.length).toBeLessThanOrEqual(20)
  })

  test("renders the host's empty state instead of inventing rows, and says when there is no team", () => {
    /** The host kit double. */
    const kit = makeKit()
    /** The component under test, with NO team projection (an empty workspace). */
    const component = createPanelComponent(() => undefined) as (props: unknown) => unknown
    /** The rendered tree for a snapshot with no subagents. */
    const text = kit.text(component({ React: kit.React, ui: kit.ui, host: { snapshot: () => ({ subagents: [] }) } }))
    expect(text).toContain("No subagents in the current session")
    expect(text).toContain("task dependency graph: no team in this workspace")
  })

  test("survives a hostile host: no React, no kit, no snapshot — and never throws", () => {
    /** The component under test. */
    const component = createPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    // No props at all, and a props object whose members are unusable: both render null rather than
    // take the host's render down (the reconciler's error boundary would contain a throw, but the
    // surface would be lost).
    expect(component(undefined)).toBeNull()
    expect(component({})).toBeNull()
    expect(component({ React: {}, ui: {} })).toBeNull()
    /** The host kit double. */
    const kit = makeKit()
    // A `snapshot()` that throws costs the subagent section, never the panel.
    expect(() => kit.text(component({ React: kit.React, ui: kit.ui, host: { snapshot: () => { throw new Error("host state unreadable") } } }))).not.toThrow()
    /** A throwing workflow reader must not take the render down either. */
    const reader = createPanelComponent(() => { throw new Error("team unreadable") }) as (props: unknown) => unknown
    /** The rendered text of that hostile composition: the host's rows survive, the DAG says why not. */
    const text = kit.text(reader({ React: kit.React, ui: kit.ui, host: { snapshot: () => ({ subagents: [LIVE_ROW] }) } }))
    expect(text).toContain("Panel Engineer")
    expect(text).toContain("no team in this workspace")
  })

  test("uses ONLY the props' own React and ui kit (the single-React rule)", () => {
    // The panel is handed a kit whose components are distinguishable from any module-level import:
    // every element the component builds must be one of THESE functions.
    /** The host kit double. */
    const kit = makeKit()
    /** The component under test. */
    const component = createPanelComponent(() => workflowFixture()) as (props: unknown) => unknown
    /** The rendered tree. */
    const tree = component({ React: kit.React, ui: kit.ui, host: { snapshot: () => ({ subagents: [LIVE_ROW] }) } })
    /** The distinct element types the tree is built from. */
    const types = new Set<unknown>()
    /** Collects the element types of one node's subtree. */
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node !== "object") return
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      /** This node as an element. */
      const element = node as Element
      types.add(element.type)
      walk(element.props?.children)
      walk(element.children)
    }
    walk(tree)
    for (const type of types) {
      // Every type is one of the props kit's own components (Text/Box/ScrollBox are functions;
      // Divider is the function the kit exposes as well). A module-level React import would appear
      // here as a foreign function.
      expect([kit.ui.Text, kit.ui.Box, kit.ui.ScrollBox, kit.ui.Divider]).toContain(type)
    }
  })
})

describe("the legacy Ctrl+A arming rule (frozen R4/R5)", () => {
  test("the SEAM WINS: a bound panel seam forbids interception whatever the config layers say", () => {
    // This is the case the per-press read exists for: the seam can bind AFTER the row applied, and the
    // very next press must already pass through to the host's own dashboard.
    expect(takeoverArmed(true, true, true)).toBe(false)
    expect(takeoverArmed(true, false, false)).toBe(false)
    expect(takeoverArmed(true, undefined, true)).toBe(false)
  })

  test("without the seam the SAVED knob outranks the row config's floor", () => {
    // The /settings row is the live layer; the row config is only the floor beneath it.
    expect(takeoverArmed(false, false, true)).toBe(false)
    expect(takeoverArmed(false, true, false)).toBe(true)
  })

  test("without the seam and without a saved value the row config decides", () => {
    expect(takeoverArmed(false, undefined, true)).toBe(true)
    expect(takeoverArmed(false, undefined, false)).toBe(false)
  })
})
