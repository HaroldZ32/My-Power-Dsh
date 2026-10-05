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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createSubagentSceneComponent,
  subagentDetailFacts,
  subagentDetailRows,
  subagentRows,
  subagentSectionRows,
  teamGraphView,
} from "../src/subagent-scene"
import { legendLines } from "../src/graph"
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
 * A subagent carrying EVERY fact the detail view can draw — the "nothing is omitted" arm's entry.
 *
 * It is shaped exactly like the host's own `SubagentState` (`dsh-tui` 0.12.0,
 * `adapter/ports/channel-view`): the detail view may draw these fields and nothing else.
 */
const DETAIL_ROW = {
  agentId: "agent-detail",
  description: "Panel Engineer",
  mode: "continuable",
  status: "completed",
  provider: "deepseek",
  model: "deepseek-flash",
  startedAt: Date.UTC(2026, 9, 2, 15, 20, 9),
  endedAt: Date.UTC(2026, 9, 2, 15, 22, 30),
  tokens: { input: 120, output: 340, total: 460 },
  toolCalls: [{ name: "read" }, { name: "bash" }, { name: "edit" }],
  outputEvents: [{ text: "line one" }, { text: "line two" }, { text: "line three" }],
}

/** The same row while its run is STILL LIVE — the arm that interrupts it from inside the detail. */
const LIVE_DETAIL_ROW = {
  agentId: "agent-live-detail",
  description: "Live Engineer",
  mode: "continuable",
  status: "running",
  provider: "deepseek",
  model: "deepseek-flash",
  startedAt: Date.UTC(2026, 9, 2, 15, 20, 9),
  tokens: { input: 10, output: 20 },
  toolCalls: [{ name: "read" }],
  outputEvents: [{ text: "working" }],
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
  /** The last tree `text` flattened — the drawn elements, so props (a click handler) are assertable. */
  last(): unknown
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
    last: () => lastTree,
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

// ── the drawn tree (props the flattened text cannot show) ───────────────────

/**
 * Visit every element of a rendered tree, parents before children — the double's own shape.
 * @param node - the tree (or one element/child list of it), of unknown shape.
 * @param visit - called once per element, in draw order.
 * @returns nothing; the walk is for its side effects.
 */
function walkElements(node: unknown, visit: (element: Element) => void): void {
  if (node === null || node === undefined || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visit)
    return
  }
  /** This node as an element — every rendered node is one. */
  const element = node as Element
  visit(element)
  for (const child of element.children ?? []) walkElements(child, visit)
}

/**
 * The React keys of one rendered tree, in draw order.
 * @param tree - the tree the kit last flattened.
 * @returns the string keys of every element that carries one, in draw order.
 */
function drawnKeys(tree: unknown): string[] {
  /** The keys seen so far, in draw order. */
  const keys: string[] = []
  walkElements(tree, (element) => {
    if (typeof element.props?.key === "string") keys.push(element.props.key)
  })
  return keys
}

/**
 * One drawn element by its React key.
 * @param tree - the tree the kit last flattened.
 * @param key - the key to look for.
 * @returns the element, or undefined when this render drew no such node.
 */
function elementByKey(tree: unknown, key: string): Element | undefined {
  /** The element found, when the walk reaches it. */
  let found: Element | undefined
  walkElements(tree, (element) => {
    if (found === undefined && element.props?.key === key) found = element
  })
  return found
}

/**
 * Every CLICKABLE drawn row of one render, in draw order.
 *
 * A clickable row is exactly a subagent row: the scene wraps those in a `Box` carrying `onClick`
 * (a `Text` cannot take one), so this walk is also the assertion that the header, the counts row
 * and the empty state are NOT click targets.
 * @param tree - the tree the kit last flattened.
 * @returns each row's React key and whether its own text element is drawn selected (bold).
 */
function clickableRows(tree: unknown): Array<{ key: string; selected: boolean }> {
  /** The clickable rows, in draw order. */
  const rows: Array<{ key: string; selected: boolean }> = []
  walkElements(tree, (element) => {
    if (typeof element.props?.onClick !== "function" || typeof element.props?.key !== "string") return
    /** The row's own text element; its `bold` flag is the selection, made visible in props. */
    const label = (element.children ?? [])[0] as Element | undefined
    rows.push({ key: element.props.key, selected: label?.props?.bold === true })
  })
  return rows
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

// ── the host dashboard's summary row (parity item 1) ────────────────────────

describe("the merged panel carries the host dashboard's summary row", () => {
  test("the counts row tallies the host's own statuses, and an unknown one is not a completion", () => {
    /** One row per state this file knows, plus one it does NOT know. */
    const rows = [
      LIVE_ROW,
      DONE_ROW,
      { agentId: "a-fail", description: "Failed run", mode: "one-shot", status: "failed", startedAt: 0 },
      { agentId: "a-odd", description: "Odd run", status: "paused" },
    ]
    /** The rendered surface. */
    const text = render(makeKit(channelFixture(rows)), mergedComponent())
    expect(text).toContain("4 total · 1 running · 1 completed · 1 failed")
    expect(text).toContain("🟡 1 running · 🟢 1 completed · 🔴 1 failed")
    // The unrecognized status stays `unknown`: it is drawn as such, and counted as NO completion.
    expect(text).toContain("⚪ Odd run · unknown · unknown")
    expect(text).not.toContain("2 completed")
  })

  test("a cancelled run is counted as failed, exactly as the host's own card draws it", () => {
    /** The rendered surface for one cancelled row. */
    const text = render(makeKit(channelFixture([{ agentId: "a-cancel", description: "Cancelled run", status: "cancelled" }])), mergedComponent())
    // The counts row is asserted WHOLE: the team section prints its own, unrelated tallies.
    expect(text).toContain("🟡 0 running · 🟢 0 completed · 🔴 1 failed")
    expect(text).toContain("🔴 Cancelled run · unknown · cancelled")
  })
})

// ── the detail view (parity item 2) ─────────────────────────────────────────

describe("ENTER opens a detail view of the selected subagent", () => {
  test("a `super`-modified return does NOT open the detail view (the host's own guard)", () => {
    /** The kit with one fully-populated subagent. */
    const kit = makeKit(channelFixture([DETAIL_ROW]))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    // Cmd+Enter arrives as `super` on kitty-CSI-u / xterm-modifyOtherKeys terminals, and the host's
    // own dashboard REFUSES it — a mode that opened here would be a parity bug, not a bonus. The
    // detail's own footer is the mode marker, so the assertion cannot be satisfied by the list's text.
    /** The surface after Cmd+Enter. */
    const afterSuper = pressAndRender(kit, component, "", { return: true, super: true })
    expect(afterSuper).not.toContain("esc/backspace/q back to the list")
    expect(afterSuper).toContain("enter detail")
    // CONTROL: the same fixture with a plain Enter DOES open it, so the arm above is not passing
    // because the detail view is unreachable at all.
    expect(pressAndRender(kit, component, "", { return: true })).toContain("esc/backspace/q back to the list")
  })

  test("a raw CRLF chunk opens the detail view, and a PASTED one does not", () => {
    /** The kit with one fully-populated subagent. */
    const kit = makeKit(channelFixture([DETAIL_ROW]))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    // Windows ConPTY's fallback carries no `return` flag: the CHUNK is the key, and the host accepts
    // any run of line breaks — so `"\r\n"` must open the detail view rather than fall on the floor.
    expect(pressAndRender(kit, component, "\r\n", {})).toContain("esc/backspace/q back to the list")
    // Back to the list, then the SAME bytes as a bracketed paste: content, never a key press.
    pressAndRender(kit, component, "", { escape: true })
    /** The surface after a pasted CRLF chunk. */
    const pasted = pressAndRender(kit, component, "\r\n", { isPasted: true })
    expect(pasted).not.toContain("esc/backspace/q back to the list")
    expect(pasted).toContain("enter detail")
  })

  test("the detail draws every fact the host reported and steps back without closing the scene", () => {
    /** The kit with one fully-populated subagent. */
    const kit = makeKit(channelFixture([DETAIL_ROW]))
    /** The component under test. */
    const component = mergedComponent()
    expect(render(kit, component)).toContain("subagents  1 total · 0 running · 1 completed · 0 failed")
    /** The detail surface ENTER draws. */
    const detail = pressAndRender(kit, component, "", { return: true })
    expect(detail).toContain("Panel Engineer")
    expect(detail).toContain("status      completed")
    expect(detail).toContain("mode        continuable")
    expect(detail).toContain("model       deepseek-flash")
    expect(detail).toContain("provider    deepseek")
    expect(detail).toContain("started     2026-10-02T15:20:09.000Z")
    expect(detail).toContain("ended       2026-10-02T15:22:30.000Z")
    expect(detail).toContain("tokens      in 120 · out 340 · total 460")
    expect(detail).toContain("tool calls  3 · read, bash, edit")
    expect(detail).toContain("output      3 line(s)")
    expect(detail).toContain("  line three")
    // The two LIST sections are gone while the detail owns the body, and the mode says which keys
    // answer to it — `esc` included, which must step back rather than close the scene.
    expect(detail).not.toContain("task dependency graph")
    expect(detail).toContain("esc/backspace/q back to the list")
    expect(pressAndRender(kit, component, "", { escape: true })).toContain("task dependency graph")
    expect(kit.closes).toBe(0)
    // Backspace and q do the same, and only the LIST's q is the exit.
    pressAndRender(kit, component, "", { return: true })
    expect(pressAndRender(kit, component, "\u007f", { backspace: true })).toContain("task dependency graph")
    expect(kit.closes).toBe(0)
    pressAndRender(kit, component, "", { return: true })
    expect(pressAndRender(kit, component, "q")).toContain("task dependency graph")
    expect(kit.closes).toBe(0)
    pressAndRender(kit, component, "q")
    expect(kit.closes).toBe(1)
  })

  test("the projection omits what the host did not report — no instant, no bucket, no duration", () => {
    /** A row whose run the host has barely described. */
    const bare = { agentId: "a-bare", description: "Bare", status: "running" }
    /** Its projection. */
    const facts = subagentDetailFacts(bare)
    expect(facts).toBeDefined()
    expect(facts?.row.startedAt).toBeUndefined()
    expect(facts?.row.endedAt).toBeUndefined()
    expect(facts?.tokens).toEqual({})
    expect(facts?.toolCallCount).toBeUndefined()
    expect(facts?.outputLines).toBeUndefined()
    expect(subagentDetailRows(facts!, 0).map((row) => row.text)).toEqual(["Bare", "status      running", "mode        unknown"])
    // A PARTIAL bucket keeps only the buckets the host filled…
    /** The same row with one token bucket and one instant. */
    const partial = subagentDetailFacts({ ...bare, tokens: { input: 7 }, endedAt: Date.UTC(2026, 9, 2, 15, 22, 30) })
    expect(partial?.tokens).toEqual({ input: 7 })
    /** Its drawn body. */
    const partialLines = subagentDetailRows(partial!, 0).map((row) => row.text)
    expect(partialLines).toContain("tokens      in 7")
    expect(partialLines).toContain("ended       2026-10-02T15:22:30.000Z")
    expect(partialLines.some((line) => line.includes("out "))).toBe(false)
    expect(partialLines.some((line) => line.includes("total"))).toBe(false)
    // …and NO duration is derived from the two instants the host did report.
    expect(partialLines.some((line) => /duration|elapsed/.test(line))).toBe(false)
    // An entry that is not an object has nothing to show at all.
    expect(subagentDetailFacts(null)).toBeUndefined()
    expect(subagentDetailFacts("agent-detail")).toBeUndefined()
  })

  test("the output tail pages with ↑/↓ and never invents a line", () => {
    /** A run with 20 output lines — longer than one detail window. */
    const chatty = {
      agentId: "agent-chatty",
      description: "Chatty",
      status: "running",
      startedAt: Date.UTC(2026, 9, 2, 15, 0, 0),
      outputEvents: Array.from({ length: 20 }, (_unused, index) => ({ text: `out-${String(index + 1).padStart(2, "0")}` })),
    }
    /** The kit with that run. */
    const kit = makeKit(channelFixture([chatty]))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    /** The detail surface, showing the NEWEST tail of the output. */
    const detail = pressAndRender(kit, component, "", { return: true })
    expect(detail).toContain("output      20 line(s)")
    expect(detail).toContain("out-20")
    expect(detail).not.toContain("out-01")
    /** The window the panel reports for itself, so the arms below need no window constant. */
    const shown = /showing (\d+)-(\d+) of 20/.exec(detail)
    expect(shown).not.toBeNull()
    /** The first window's oldest line index. */
    const start = Number(shown?.[1])
    /** The first window's newest line index. */
    const end = Number(shown?.[2])
    expect(end).toBe(20)
    /** The window's size, stable at every offset. */
    const size = end - start + 1
    // One ↑ walks the window back by exactly one line, and one ↓ walks it forward again.
    /** The surface after one scroll back. */
    const up = pressAndRender(kit, component, "", { upArrow: true })
    expect(up).toContain(`showing ${start - 1}-${end - 1} of 20`)
    expect(up).toContain("out-19")
    expect(pressAndRender(kit, component, "", { downArrow: true })).toContain(`showing ${start}-${end} of 20`)
    // Scrolling past the oldest line CLAMPS there: the first line the host wrote is reachable…
    /** The last surface the scroll-back loop drew, i.e. the clamped one. */
    let oldest = ""
    for (let press = 0; press < 25; press += 1) oldest = pressAndRender(kit, component, "", { upArrow: true })
    expect(oldest).toContain(`showing 1-${size} of 20`)
    expect(oldest).toContain("out-01")
    // …and scrolling past the newest clamps back onto it, with the newest line still the tail.
    /** The last surface the scroll-forward loop drew, i.e. the clamped one. */
    let newest = ""
    for (let press = 0; press < 25; press += 1) newest = pressAndRender(kit, component, "", { downArrow: true })
    expect(newest).toContain(`showing ${20 - size + 1}-20 of 20`)
    expect(newest).toContain("out-20")
  })

  test("the interrupt gesture keeps working, on the DETAIL's own row", () => {
    /** Every agent id the host double was asked to interrupt. */
    const interrupted: string[] = []
    /** The host's control facade double. */
    const control = {
      interrupt: (id: string): boolean => {
        interrupted.push(id)
        return true
      },
    }
    /** The kit with a live row and a settled one. */
    const kit = makeKit(channelFixture([LIVE_DETAIL_ROW, DONE_ROW], control))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    /** The detail surface for the first (live) row. */
    const detail = pressAndRender(kit, component, "", { return: true })
    expect(detail).toContain("Live Engineer")
    /** The same surface after the gesture. */
    const after = pressAndRender(kit, component, "i")
    expect(interrupted).toEqual(["agent-live-detail"])
    expect(after).toContain("interrupt requested for Live Engineer")
    // Still the detail, and still on the row the gesture acted on.
    expect(after).toContain("tokens      in 10 · out 20")
  })

  test("a selected entry that leaves the channel degrades to a notice, never a throw", () => {
    /** The host's own array, kept so this arm can remove the row the detail was opened on. */
    const subagents = [DETAIL_ROW]
    /** The kit over it. */
    const kit = makeKit(channelFixture(subagents))
    /** The component under test. */
    const component = mergedComponent()
    render(kit, component)
    expect(pressAndRender(kit, component, "", { return: true })).toContain("tokens      in 120 · out 340 · total 460")
    // The row disappears between two renders — what a settled child or a channel reset does.
    subagents.length = 0
    /** The surface the next render draws. */
    const after = render(kit, component)
    expect(after).toContain("details: that subagent is no longer in the channel")
    expect(after).toContain("No subagents in the current session")
    // And the scene answers keys as a LIST again: `q` is the exit, because the mode is gone.
    kit.press("q")
    render(kit, component)
    expect(kit.closes).toBe(1)
  })
})

// ── the pointer (parity item 3) ─────────────────────────────────────────────

describe("a click selects what the arrow keys would have selected", () => {
  test("clicking a row's own Box sets the selection, and only a subagent row is clickable", () => {
    /** The keyboard path: one `↓` from the top selects the second row. */
    const keyboardKit = makeKit(channelFixture([LIVE_ROW, DONE_ROW]))
    /** The keyboard arm's component. */
    const keyboardComponent = mergedComponent()
    render(keyboardKit, keyboardComponent)
    pressAndRender(keyboardKit, keyboardComponent, "", { downArrow: true })
    /** What the keyboard selected, as the drawn rows' emphasis. */
    const byKeyboard = clickableRows(keyboardKit.last())
    // Exactly the two subagent rows are click targets: the header, the counts row and the team
    // section carry no handler, so a click can never "select" a row that does not exist.
    expect(byKeyboard).toHaveLength(2)
    expect(byKeyboard.map((row) => row.selected)).toEqual([false, true])
    /** The pointer path, from the SAME starting state and with no key pressed at all. */
    const pointerKit = makeKit(channelFixture([LIVE_ROW, DONE_ROW]))
    /** The pointer arm's component. */
    const pointerComponent = mergedComponent()
    render(pointerKit, pointerComponent)
    // Nothing is pressed in this arm: the selection is the scene's own default (the first row).
    expect(clickableRows(pointerKit.last()).map((row) => row.selected)).toEqual([true, false])
    /** The second row's own Box, found by the key THIS render drew. */
    const second = elementByKey(pointerKit.last(), clickableRows(pointerKit.last())[1].key)
    expect(typeof second?.props?.onClick).toBe("function")
    ;(second?.props?.onClick as (() => void) | undefined)?.()
    render(pointerKit, pointerComponent)
    // EXACTLY the keyboard's result: the same rows in the same order, selected the same way.
    expect(clickableRows(pointerKit.last())).toEqual(byKeyboard)
  })
})

// ── the legend (parity item 5) ──────────────────────────────────────────────

describe("the merged panel draws the graph legend under its DAG", () => {
  test("the legend sits directly under the DAG, in the width the graph was laid out for", () => {
    /** The kit with one host row and the fixture team. */
    const kit = makeKit(channelFixture([LIVE_ROW]))
    /** The rendered surface. */
    const text = render(kit, mergedComponent())
    /** The keys this render drew, in draw order. */
    const keys = drawnKeys(kit.last())
    /** The DAG the merged panel lays out for the measured 100 columns. */
    const graph = teamGraphView(workflowFixture(), 100)
    expect(graph).toBeDefined()
    /** How many rows that DAG has, so the drawing itself is pinned beside the legend. */
    const graphRows = graph?.lines.length ?? 0
    expect(graphRows).toBeGreaterThan(0)
    expect(keys.filter((key) => /^graph-\d+$/.test(key))).toHaveLength(graphRows)
    /** The legend the frozen interface returns for the same width — lane W1 owns its content. */
    const legend = legendLines(100)
    expect(keys.filter((key) => /^legend-\d+$/.test(key))).toHaveLength(legend.length)
    for (const line of legend) expect(text).toContain(line)
    if (legend.length > 0) {
      // DIRECTLY UNDER THE DAG: the first legend row is drawn after the last graph row, and it is
      // dimmed — a legend explains the drawing, it never competes with it.
      /** Where the first legend row sits in draw order. */
      const firstLegend = keys.findIndex((key) => /^legend-\d+$/.test(key))
      /** Where the last DAG row sits in draw order. */
      const lastGraph = keys.reduce((at, key, index) => (/^graph-\d+$/.test(key) ? index : at), -1)
      expect(firstLegend).toBeGreaterThan(lastGraph)
      expect(elementByKey(kit.last(), "legend-0")?.props?.dimColor).toBe(true)
    }
  })

  test("both scenes consume the frozen legend interface with their own width budget", () => {
    // The CONTENT of the legend belongs to `graph.ts` and may legitimately be empty while that work
    // lands, so the WIRING is pinned here: both scenes call the frozen interface with the width their
    // own DAG was laid out for, and the merged panel draws it under the DAG it just drew.
    /** The merged panel's source. */
    const merged = readFileSync(join(import.meta.dir, "..", "src", "subagent-scene.ts"), "utf8")
    /** The team scene's source. */
    const team = readFileSync(join(import.meta.dir, "..", "src", "scenes.ts"), "utf8")
    expect(merged).toContain("legendLines(measured.cols)")
    expect(team).toContain("legendLines(graphWidth)")
  })
})
