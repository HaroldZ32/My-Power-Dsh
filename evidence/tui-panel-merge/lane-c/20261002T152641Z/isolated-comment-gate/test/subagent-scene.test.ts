// The merged panel: the HOST's own subagent rows ABOVE the MPD team panel.
//
// HARNESS: the React/ui double and the row-aware text flattening below are the SAME ones
// `team-surface.test.ts` renders its scenes with (`makeKit`/`render`/`pressAndRender` there). That
// file exports no helpers, so this file carries the double verbatim rather than inventing a second,
// differently-behaved one: the two suites must agree on what "one drawn row" means, and the whole
// ordering contract is expressed in flattened rows.
//
// WHAT THIS SUITE TESTS, AND WHAT IT DOES NOT: the team side is INJECTED through the factory's
// `readWorkflow` parameter, so these arms test the SECTION COMPOSITION (order, empty states,
// defensive rendering, sanitization) and never the team reader — `team-surface.test.ts` and
// `team-record-source.test.ts` own the real `.mpd/team` reads.
import { describe, expect, test } from "bun:test"
import { createSubagentSceneComponent, subagentRows, subagentSectionRows } from "../src/subagent-scene"
import type { TeamWorkflow } from "../src/team-state"

// ── fixtures ────────────────────────────────────────────────────────────────

/** The live subagent the fixture channel carries: a continuable MPD teammate, running. */
const LIVE_ROW = {
  agentId: "agent-live",
  description: "TuiAdapter Engineer — Lane A",
  mode: "continuable",
  status: "running",
  startedAt: Date.UTC(2026, 9, 2, 15, 20, 9),
}

/** The settled subagent the fixture channel carries: a one-shot consult that ended. */
const DONE_ROW = {
  agentId: "agent-done",
  description: "Plan Reviewer",
  mode: "one-shot",
  status: "completed",
  startedAt: Date.UTC(2026, 9, 2, 15, 21, 0),
  completedAt: Date.UTC(2026, 9, 2, 15, 22, 30),
}

/**
 * A minimal readable team projection — the shape `readTeamWorkflow`/`readRecordWorkflow` produce.
 * @returns one team, one roster row, two tasks and one dependency edge.
 */
function workflowFixture(): TeamWorkflow {
  return {
    workspace: "/tmp/mpd-merged-fixture",
    team: { id: "team-20261002152009", name: "wave-2", phase: "active", staged: false, runnable: true, links: 1 },
    members: [{ name: "TuiAdapter Engineer", role: "Senior Engineer", status: "running", done: 1, total: 2, progress: 50, unread: null }],
    tasks: [
      { id: "T1", subject: "build the adapter", kind: "work", status: "completed", visual: "completed", dependencies: [], failedDependencies: [], depth: 0 },
      { id: "T2", subject: "migrate the plugin", kind: "work", status: "pending", visual: "blocked", dependencies: ["T1"], failedDependencies: [], depth: 1 },
    ],
    counts: { total: 2, completed: 1, inProgress: 0, pending: 1, claimed: 0, failed: 0, cancelled: 0, other: 0 },
    mail: { unread: null, captainInbox: [] },
    holds: [],
    problems: [],
  }
}

/**
 * A channel double shaped like the host's own (`channel.subagents`, `channel.version`,
 * `channel.subscribe`, and optionally `channel.subagentControl`).
 * @param subagents - the host's own array, verbatim.
 * @param control - the host's native control facade, when this arm exposes one.
 * @returns the channel double.
 */
function channelFixture(subagents: readonly unknown[], control?: unknown): Record<string, unknown> {
  return {
    version: 1,
    subscribe: () => () => {},
    subagents,
    ...(control === undefined ? {} : { subagentControl: control }),
  }
}

/** The component under test, with the team projection injected as the wiring does. */
function mergedComponent(): unknown {
  return createSubagentSceneComponent(() => workflowFixture())
}

// ── the React / ui double (the same one team-surface.test.ts uses) ───────────

/** A rendered element as the React double produces it. */
interface Element {
  /** The element type: a host component or a tag name. */
  type: unknown
  /** The element's props, with the double's defaults applied. */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one arm renders with. */
interface Kit {
  /** The React double the scene must use. */
  React: Record<string, unknown>
  /** The ui kit double the scene must use. */
  ui: Record<string, unknown>
  /** The channel the `render` helper hands the scene as `props.channel`. */
  channel?: unknown
  /** Captured `useInput` handlers, most recent last. */
  handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[]
  /** Resets one render pass: hook index 0 and no handlers. */
  begin(): void
  /** Runs the effects queued by the last render; true when any ran. */
  flush(): boolean
  /** Dispatches one key to the most recently registered handler. */
  press(input: string, key?: Record<string, unknown>): void
  /** Flattens a rendered tree into its text. */
  text(tree: unknown): string
  /** How many times a rendered scene called its own `close` — the scene's exit, counted. */
  closes: number
}

/**
 * A minimal host kit double: index-keyed hook state, effects that run AFTER the render, and
 * `useInput` handlers captured for key dispatch. `useSyncExternalStore` is swallowed because the
 * double renders on demand — the scene's own data read is what the assertions observe.
 * @param channel - the channel the rendered scene receives, when an arm wants one.
 * @returns the kit.
 */
function makeKit(channel?: unknown): Kit {
  /** Hook state and effects, keyed by hook position. */
  const store = new Map<string, unknown>()
  /** The captured input handlers. */
  const handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[] = []
  /** The hook counter of the current render pass. */
  let index = 0
  /** Effects queued by the current render, run by `flush`. */
  let pending: (() => unknown)[] = []
  /** The last tree `text` flattened. */
  let lastTree: unknown

  /** The React double: index-keyed hooks, effects deferred to `flush`. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This state cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? (initial as () => unknown)() : initial)
      return [
        store.get(key),
        (next: unknown) => {
          store.set(key, typeof next === "function" ? (next as (prev: unknown) => unknown)(store.get(key)) : next)
        },
      ]
    },
    useEffect: (fn: () => unknown): void => {
      /** This effect's key, derived from the hook position. */
      const key = `effect:${index}`
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
    useSyncExternalStore: (): void => {},
  }

  /** The Text component: identity plus the children it renders. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: identity plus the props it carries. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [] })
  /** The ui kit, with `useInput` capturing and a fixed terminal size. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    useInput: (handler: (input: string, key: Record<string, unknown> | undefined) => void): void => {
      handlers.push(handler)
    },
    useTerminalSize: (): { columns: number; rows: number } => ({ columns: 100, rows: 30 }),
  }

  return {
    React,
    ui,
    channel,
    handlers,
    /** The exit counter, incremented by the props every `render` hands a scene. */
    closes: 0,
    begin: () => {
      index = 0
      handlers.length = 0
    },
    flush: () => {
      /** The effects queued for this flush. */
      const list = pending
      pending = []
      for (const fn of list) fn()
      return list.length > 0
    },
    press: (input: string, key: Record<string, unknown> = {}) => {
      /** The most recently registered input handler. */
      const handler = handlers.at(-1)
      if (handler === undefined) throw new Error("no useInput handler was registered by the scene")
      handler(input, key)
    },
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
      /** Walk the tree one ROW at a time: a Box is a column, so each of its children is a line. */
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
  }
}

/**
 * Render the component until its effects settle.
 * @param kit - the host kit double.
 * @param component - the scene component.
 * @returns the flattened rendered text.
 */
function render(kit: Kit, component: unknown): string {
  /** The props the host would pass to a scene; `close` is COUNTED, so an exit is assertable. */
  const props = { React: kit.React, ui: kit.ui, close: () => { kit.closes += 1 }, channel: kit.channel }
  /** The last rendered tree. */
  let tree: unknown
  for (let pass = 0; pass < 5; pass += 1) {
    kit.begin()
    tree = (component as (props: unknown) => unknown)(props)
    if (!kit.flush()) break
  }
  return kit.text(tree)
}

/**
 * Re-render after a key press, so the assertions observe the post-key state — the host re-renders on
 * a state write and registers a FRESH `useInput` closure, which is what the next key must reach.
 * @param kit - the host kit double.
 * @param component - the scene component.
 * @param input - the input character the key press carries.
 * @param key - the key flags.
 * @returns the flattened rendered text after the re-render.
 */
function pressAndRender(kit: Kit, component: unknown, input: string, key: Record<string, unknown> = {}): string {
  kit.press(input, key)
  return render(kit, component)
}

// ── the ordering contract (the reason this scene exists) ────────────────────

describe("the merged panel puts the host's subagent rows ABOVE the MPD team panel", () => {
  test("every subagent row is drawn before the first team row", () => {
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([LIVE_ROW, DONE_ROW])), mergedComponent())
    /** Where the live subagent's row landed. */
    const liveAt = text.indexOf("TuiAdapter Engineer — Lane A")
    /** Where the settled subagent's row landed. */
    const doneAt = text.indexOf("Plan Reviewer")
    /** Where the team panel's own header row landed. */
    const teamAt = text.indexOf("team       wave-2 (team-20261002152009)")
    expect(liveAt).toBeGreaterThan(-1)
    expect(doneAt).toBeGreaterThan(-1)
    expect(teamAt).toBeGreaterThan(-1)
    expect(liveAt).toBeLessThan(doneAt)
    expect(doneAt).toBeLessThan(teamAt)
    // The roster, the task rows and the DAG all follow the host's own rows.
    expect(text.indexOf("roster")).toBeGreaterThan(teamAt)
    expect(text.indexOf("T2 [work] migrate the plugin")).toBeGreaterThan(teamAt)
    expect(text.indexOf("task dependency graph")).toBeGreaterThan(teamAt)
  })

  test("each row carries the host's own description, mode, status and start instant", () => {
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([LIVE_ROW, DONE_ROW])), mergedComponent())
    expect(text).toContain("🟡 TuiAdapter Engineer — Lane A · continuable · running · started 2026-10-02T15:20:09.000Z")
    // A settled row reports the REAL end instant the host gave it; no duration is invented.
    expect(text).toContain("🟢 Plan Reviewer · one-shot · completed · started 2026-10-02T15:21:00.000Z · ended 2026-10-02T15:22:30.000Z")
    expect(text).toContain("2 total · 1 running · 1 completed · 0 failed")
  })
})

// ── the empty and the absent ────────────────────────────────────────────────

describe("the merged panel degrades honestly", () => {
  test("an empty subagent list still renders the team panel, above it the host's own empty tone", () => {
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([])), mergedComponent())
    expect(text).toContain("subagents  0 total · 0 running · 0 completed · 0 failed")
    expect(text).toContain("⚪ No subagents in the current session")
    expect(text).toContain("Subagents appear here once the main agent starts Task delegations")
    expect(text).toContain("team       wave-2 (team-20261002152009)")
    expect(text.indexOf("No subagents in the current session")).toBeLessThan(text.indexOf("team       wave-2"))
  })

  test("a scene handed no channel at all still renders the team panel", () => {
    /** The rendered surface. */
    const text = render(makeKit(undefined), mergedComponent())
    expect(text).toContain("No subagents in the current session")
    expect(text).toContain("team       wave-2 (team-20261002152009)")
  })

  test("a missing team projection renders the team section's own unreadable line", () => {
    /** A component whose reader reports nothing readable. */
    const component = createSubagentSceneComponent(() => undefined)
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([LIVE_ROW])), component)
    expect(text).toContain("TuiAdapter Engineer — Lane A")
    expect(text).toContain("team state unreadable")
  })

  test("an unreadable status is drawn as unknown — never guessed into completed", () => {
    /** The projected rows. */
    const rows = subagentRows(channelFixture([{ agentId: "a-9", description: "discovered child", mode: "brand-new", status: "brand-new" }]))
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe("unknown")
    expect(rows[0].mode).toBe("unknown")
    expect(rows[0].live).toBe(false)
    expect(rows[0].failed).toBe(false)
    expect(rows[0].startedAt).toBeUndefined()
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([{ description: "discovered child", status: "brand-new" }])), mergedComponent())
    expect(text).toContain("⚪ discovered child · unknown · unknown")
  })
})

// ── the defensive rules ─────────────────────────────────────────────────────

describe("the merged panel never trusts the host's shapes", () => {
  test("an absent subagentControl does not throw, and the interrupt gesture says so", () => {
    /** The kit, with a LIVE row and no control facade. */
    const kit = makeKit(channelFixture([LIVE_ROW]))
    /** The component under test. */
    const component = mergedComponent()
    expect(render(kit, component)).toContain("🟡 TuiAdapter Engineer — Lane A")
    // The gesture is fired at the very handler the scene registered; the scene must not throw.
    kit.press("i")
    /** The surface after the gesture. */
    const after = render(kit, component)
    expect(after).toContain("interrupt: this composition exposes no subagent control")
    expect(after).toContain("team       wave-2 (team-20261002152009)")
  })

  test("the interrupt reaches the host's own control for a LIVE row only", () => {
    /** Every agent id the host double was asked to interrupt. */
    const interrupted: string[] = []
    /** The host's control facade double. */
    const control = {
      interrupt: (id: string): boolean => {
        interrupted.push(id)
        return true
      },
    }
    /** The kit, with a control facade present. */
    const kit = makeKit(channelFixture([LIVE_ROW, DONE_ROW], control))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    kit.press("i")
    expect(interrupted).toEqual(["agent-live"])
    expect(render(kit, component)).toContain("interrupt requested for TuiAdapter Engineer — Lane A")
    // Move the selection onto the SETTLED row: the gesture is refused, and the host is not called.
    // The re-render between the two presses is what the host does — and what gives the `i` press the
    // handler closure that sees the new selection.
    pressAndRender(kit, component, "", { downArrow: true })
    kit.press("i")
    expect(interrupted).toEqual(["agent-live"])
    expect(render(kit, component)).toContain("interrupt: Plan Reviewer is completed, not running")
  })

  test("a hostile description is sanitized before it reaches a row", () => {
    /** A description carrying C0/C1 control characters (a payload that would repaint the terminal). */
    const hostile = { agentId: "a-bad", description: "bad\u001b[31mred\u0007name\u009b", mode: "one-shot", status: "running", startedAt: 0 }
    /** The rendered surface. */
    const text = render(makeKit(channelFixture([hostile])), mergedComponent())
    expect(text).not.toContain("\u001b")
    expect(text).not.toContain("\u0007")
    expect(text).not.toContain("\u009b")
    // The control characters became spaces (never removed blindly), and the rest of the row is intact.
    expect(text).toContain("🟡 bad [31mred name")
    expect(text).toContain("one-shot · running · started 1970-01-01T00:00:00.000Z")
  })

  test("a non-scalar field is dropped rather than stringified onto the screen", () => {
    /** The rendered surface, for a row whose description is an object and whose instant is not a date. */
    const text = render(makeKit(channelFixture([{ agentId: "a-obj", description: { nested: true }, status: "running", startedAt: "not-a-number" }])), mergedComponent())
    expect(text).not.toContain("[object Object]")
    expect(text).toContain("(no description)")
    expect(text).not.toContain("started")
  })

  test("a channel missing every field it may carry degrades to the empty state", () => {
    /** A channel whose `subagents` is not an array and which exposes neither `version` nor `subscribe`. */
    const bareChannel = { subagents: "not-an-array" }
    /** The section the builder reports. */
    const section = subagentSectionRows(bareChannel)
    expect(section).toHaveLength(3)
    expect(section[0].text).toContain("0 total")
    /** The rendered surface must survive the same channel. */
    const text = render(makeKit(bareChannel), mergedComponent())
    expect(text).toContain("No subagents in the current session")
    expect(text).toContain("team       wave-2 (team-20261002152009)")
    // A channel that is not even an object is as hostile as a missing one, and is not a throw.
    expect(render(makeKit(42), mergedComponent())).toContain("No subagents in the current session")
    expect(subagentRows(null)).toEqual([])
  })
})
