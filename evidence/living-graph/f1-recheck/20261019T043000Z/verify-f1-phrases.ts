// LANE E — narrow re-check of finding F1: the DAG mode line must name where the ranks ACTUALLY came
// from, in all three states the fix declares.
//
// THE ARM RENDERS THE REAL COMPONENT. `createDagPanelComponent` is mounted on a minimal React-shaped
// runtime and a duck-typed ui kit (the same two members `panelKit` proves: `Box` and `Text`), then the
// rendered tree's mode row is read as TEXT. The phrase is therefore the shipped component's own, not
// a string this probe believes it should print.
//
// THE STATES (from the fix's own type `DagRanksSource`):
//   derived-host — a served model whose report says DERIVED     → `derived (host)`
//   served-host  — a served model that ITSELF fell back         → `served depth (host fallback)`
//   local        — no model: the layout flag is the authority   → `derived` or `served depth`
//
// Run: bun evidence/living-graph/f1-recheck/<ts>/verify-f1-phrases.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import type { BoardTask, GraphModel } from "../../../../packages/mpd-graph-core/src/index.ts"
import { createDagPanelComponent } from "../../../../packages/mpd-tui-plugin/src/panel-dag.ts"
import { readScopedWorkflow } from "../../../../packages/mpd-tui-plugin/src/team-state.ts"
import type { TeamTaskRow, TeamWorkflow } from "../../../../packages/mpd-tui-plugin/src/team-state.ts"
import { MODEL, RECORD, SESSION, TEAM } from "./fixture.ts"

/** This run's own directory. */
const HERE = import.meta.dirname
/** A scratch workspace for the record the reader resolves. */
const WS = mkdtempSync(join(HERE, "ws-"))
mkdirSync(join(WS, ".mpd", "team", "teams"), { recursive: true })
writeFileSync(join(WS, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(RECORD, null, 1))

// ── A MINIMAL REACT-SHAPED RUNTIME (the same shape the panel's hooks require) ────────────────────
/** One element the runtime mints: its type, its props, and its children. */
interface Element {
  /** The component or host element the render produced. */
  type: unknown
  /** The props, children included. */
  props: Record<string, unknown>
}
/** A hook slot: state, ref or effect deps. */
interface Slot {
  /** The slot's value. */
  value?: unknown
  /** The serialized deps the effect/memo last ran with. */
  deps?: string
}
/** The hook slots, fixed-order for one component instance. */
const slots: Slot[] = []
/** Effects queued by the pass in flight. */
let queuedEffects: Array<() => unknown> = []
/** Cleanups registered by effects. */
const cleanups: Array<() => void> = []
/** The slot cursor for the pass in flight. */
let cursor = 0
/** Whether a state setter ran, which asks for another pass. */
let dirty = false

/** The React-shaped API the component uses. */
const ReactDouble = {
  createElement(type: unknown, props: Record<string, unknown> | null | undefined, ...children: unknown[]): Element {
    return { type, props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children } }
  },
  useState(initial: unknown): [unknown, (next: unknown) => void] {
    const index = cursor++
    if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? (initial as () => unknown)() : initial }
    const set = (next: unknown): void => {
      slots[index].value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slots[index].value) : next
      dirty = true
    }
    return [slots[index].value, set]
  },
  useRef(initial: unknown): { current: unknown } {
    const index = cursor++
    if (!(index in slots)) slots[index] = { value: { current: initial } }
    return slots[index].value as { current: unknown }
  },
  useEffect(fn: () => unknown, deps?: unknown): void {
    const index = cursor++
    const key = deps === undefined ? "none" : JSON.stringify(deps)
    if (slots[index]?.deps === key) return
    slots[index] = { value: slots[index]?.value, deps: key }
    queuedEffects.push(fn)
  },
  useMemo(factory: () => unknown, deps?: unknown): unknown {
    const index = cursor++
    const key = deps === undefined ? "none" : JSON.stringify(deps)
    if (slots[index]?.deps !== key) slots[index] = { value: factory(), deps: key }
    return slots[index].value
  },
  useCallback(fn: () => unknown, deps?: unknown): unknown {
    const index = cursor++
    const key = deps === undefined ? "none" : JSON.stringify(deps)
    if (slots[index]?.deps !== key) slots[index] = { value: fn, deps: key }
    return slots[index].value
  },
}

/** The host ui kit, with the two members `panelKit` proves as functions. */
const uiDouble = {
  // panelKit PROVES these two are functions; strings would fail the guard and the page would render null.
  Box: (props: Record<string, unknown>) => props,
  Text: (props: Record<string, unknown>) => props,
  ScrollBox: (props: Record<string, unknown>) => props,
  // The panel's ONLY geometry source. Without it the host defaults to no room and the drawing (and
  // therefore the mode line) is never rendered — measured on the first attempt of this arm.
  useTerminalSize: () => ({ columns: 120, rows: 40 }),
}
/** The host API surface the page reads; no keyboard, no badge persistence. */
const hostDouble = {
  snapshot: () => ({ sessionId: SESSION }),
  notify: () => {},
  clearBadge: () => {},
  onKey: () => {},
  toast: () => {},
}

// THE PANEL'S TICK IS AN INTERVAL; the mode line needs no tick, so the timer is recorded and never run.
/** The real interval, restored when the probe ends. */
const realSetInterval = globalThis.setInterval
/** The intervals the panel armed (none fires). */
const armedIntervals: number[] = []
globalThis.setInterval = ((fn: () => void, ms?: number) => {
  armedIntervals.push(ms ?? 0)
  return { fn, unref: () => {} } as unknown as ReturnType<typeof setInterval>
}) as typeof setInterval

/** Every plain-text leaf of a rendered subtree. */
function leavesOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node)
    return out
  }
  if (typeof node === "number") {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) leavesOf(child, out)
    return out
  }
  if (node !== null && typeof node === "object") {
    const element = node as Element
    if (element.props !== undefined) leavesOf(element.props.children, out)
  }
  return out
}

/**
 * Mount the real DAG page for one workflow and read its mode line.
 * @param workflow - the projection the page draws.
 * @returns the mode line's text, or a marker when it was not rendered.
 */
async function modeLineOf(workflow: TeamWorkflow): Promise<string> {
  // A FRESH COMPONENT PER STATE: the hook slots are a per-instance contract.
  slots.length = 0
  cleanups.length = 0
  queuedEffects = []
  dirty = false
  const component = createDagPanelComponent(() => workflow, { subscribeTeams: () => undefined }) as (props: Record<string, unknown>) => unknown
  let tree: unknown = null
  for (let pass = 0; pass < 8; pass += 1) {
    dirty = false
    cursor = 0
    tree = component({ React: ReactDouble, ui: uiDouble, host: hostDouble, focused: true, visible: true })
    const effects = queuedEffects
    queuedEffects = []
    for (const effect of effects) {
      const disposer = effect()
      if (typeof disposer === "function") cleanups.push(disposer as () => void)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (!dirty) break
  }
  for (const cleanup of cleanups.splice(0)) {
    try { cleanup() } catch { /* harness */ }
  }
  const lines = leavesOf(tree)
  // The mode line is the page's last status row; a render that produced nothing is a harness failure,
  // not a phrase verdict, so the marker names it distinctly.
  return lines.find((line) => /^view .* · \d+ tasks · ranks /.test(line)) ?? (lines.length === 0 ? "<empty render>" : `<mode line not rendered; ${lines.length} text leaves: ${lines.slice(0, 6).join(" | ")}>`)
}

/** A record whose board is two roots, used for the no-model and host-fallback states. */
const fallbackRecord = {
  ...RECORD,
  tasks: [
    { id: "T1", subject: "root", kind: "work", status: "pending", blockedBy: [], createdAt: RECORD.createdAt, updatedAt: RECORD.createdAt, revision: 1 },
    { id: "T2", subject: "deep", kind: "work", status: "pending", blockedBy: [], createdAt: RECORD.createdAt, updatedAt: RECORD.createdAt, revision: 1 },
  ],
}
writeFileSync(join(WS, ".mpd", "team", "teams", `${TEAM}.json`), JSON.stringify(fallbackRecord, null, 1))
/** The host-fallback model: no reference resolves and the served depths vary, so `ranksDerived` is false. */
const fallbackModel: GraphModel = buildModel({ board: [
  { id: "T1", subject: "root", status: "pending", blockedBy: [], depth: 0 },
  { id: "T2", subject: "deep", status: "pending", blockedBy: [], depth: 3 },
] as BoardTask[] })

/** The DERIVED-HOST state: the served model says its ranks were derived. */
const derivedHost = await modeLineOf(readScopedWorkflow({
  workspace: WS, sessionId: SESSION, holds: [],
  teams: { active: () => RECORD, graph: () => MODEL } as never,
  records: [RECORD], views: [],
}))
/** The SERVED-HOST state: the served model itself fell back to the served depth. */
const servedHost = await modeLineOf(readScopedWorkflow({
  workspace: WS, sessionId: SESSION, holds: [],
  teams: { active: () => fallbackRecord, graph: () => fallbackModel } as never,
  records: [fallbackRecord as never], views: [],
}))
/** The LOCAL state with a derivable board (no model): the layout's own flag is the authority. */
const localDerived = await modeLineOf(readScopedWorkflow({
  workspace: WS, sessionId: SESSION, holds: [],
  teams: { active: () => fallbackRecord } as never,
  records: [fallbackRecord as never], views: [],
}))
/** The LOCAL state with only served depths to go on: a hand-built projection whose depths vary and
 * whose references resolve nothing — the branch the shipped reader cannot reach because it recomputes
 * depths, exercised so the phrase itself is still proved. */
const localServedWorkflow: TeamWorkflow = {
  workspace: WS,
  members: [],
  tasks: [
    { id: "T1", subject: "root", status: "pending", visual: "open", dependencies: [], failedDependencies: [], depth: 0 },
    { id: "T2", subject: "deep", status: "pending", visual: "open", dependencies: [], failedDependencies: [], depth: 3 },
  ] as TeamTaskRow[],
  counts: { total: 2, completed: 0, inProgress: 0, pending: 2, claimed: 0, failed: 0, cancelled: 0, other: 0 },
  mail: { unread: null, captainInbox: [] },
  holds: [],
  problems: [],
}
/** The LOCAL-SERVED phrase. */
const localServed = await modeLineOf(localServedWorkflow)

globalThis.setInterval = realSetInterval

/** The measured result. */
const result = {
  probe: "f1-phrases",
  at: new Date().toISOString(),
  head: process.env.MPD_HEAD ?? "see result.json head",
  armedIntervals,
  observed: {
    "derived-host": { line: derivedHost, modelRanksDerived: MODEL.report.ranksDerived },
    "served-host": { line: servedHost, modelRanksDerived: fallbackModel.report.ranksDerived },
    "local-derived": { line: localDerived },
    "local-served": { line: localServed },
  },
  verdict: {
    derivedHostPhrase: derivedHost.endsWith("ranks derived (host)"),
    servedHostPhrase: servedHost.endsWith("ranks served depth (host fallback)"),
    localDerivedPhrase: localDerived.endsWith("ranks derived"),
    // The local-served branch: the layout's fallback flag must still print the fallback word.
    localServedPhrase: localServed.endsWith("ranks served depth"),
    // The core of F1: the phrase is now TRUE in every state it can name.
    phraseMatchesModelOnHostPath: derivedHost.endsWith("derived (host)") === (MODEL.report.ranksDerived === true) && servedHost.endsWith("served depth (host fallback)") === (fallbackModel.report.ranksDerived === false),
  },
}
writeFileSync(join(HERE, "f1-result.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify(result, null, 1))
