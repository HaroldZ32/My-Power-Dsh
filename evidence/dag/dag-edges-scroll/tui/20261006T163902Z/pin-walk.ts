// DIAGNOSTIC: reproduce the verifier's PTY pin walk (Down, Enter) against the real `dag` page component,
// and report whether the pinned detail body carries the ORIGINAL Chinese subject (clause C3).
import { createDagPanelComponent } from "../../packages/mpd-tui-plugin/src/panel-dag"

/** element shape the double builds. */
type El = { type: unknown; props: Record<string, unknown>; children: unknown[] }
const store = new Map<string, unknown>()
const pending: Array<{ key: string; value: unknown }> = []
let index = 0
const effects: Array<() => unknown> = []
const listeners: Array<(e: unknown) => void> = []
const React = {
  createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): El => ({ type, props: props ?? {}, children }),
  useState: (initial: unknown): [unknown, (n: unknown) => void] => {
    const key = `state:${index}`; index += 1
    if (!store.has(key)) store.set(key, initial)
    return [store.get(key), (n: unknown) => { store.set(key, n); pending.push({ key, value: n }) }]
  },
  useEffect: (e: () => unknown): void => { index += 1; effects.push(e) },
  useRef: (initial: unknown): { current: unknown } => {
    const key = `ref:${index}`; index += 1
    if (!store.has(key)) store.set(key, { current: initial })
    return store.get(key) as { current: unknown }
  },
}
const Text = (p: { children?: unknown }): El => ({ type: "Text", props: p as Record<string, unknown>, children: [p.children] })
const Box = (p: { children?: unknown }): El => ({ type: "Box", props: p as Record<string, unknown>, children: [p.children] })
const ui = { Box, Text, ScrollBox: Box, Divider: (): El => ({ type: "Text", props: {}, children: ["─"] }), useTerminalSize: () => ({ columns: 140, rows: 40 }), useAnimationTime: () => 0 }
const kit = {
  React, ui,
  reset: (): void => { index = 0; effects.length = 0; for (const u of pending) store.set(u.key, u.value) },
  runEffects: (): void => { for (const e of [...effects]) e() },
}
const host = { focused: true, visible: true, host: { onKey: (l: (e: unknown) => void) => { listeners.push(l); return () => {} }, notify: () => {}, clearBadge: () => {}, snapshot: () => ({}) } }

/** A REAL board whose subjects are Chinese, as the fixture is. */
const subjects = [
  "冻结验收契约与验收标准",
  "建立头部与进度条的双向滚轴",
  "绘制依赖图的连线与圆角节点盒",
  "修复被截断的成员路由中文对齐",
  "验证图内不得出现任何中文字符",
]
const tasks = subjects.map((s, i) => ({ id: `T${i + 1}`, subject: s, description: `验收说明：${s}——必须保持原样`, kind: "work", status: "pending", visual: i === 0 ? "completed" : "open", dependencies: i === 0 ? [] : [`T${i}`], failedDependencies: [], depth: i }))
const workflow = { workspace: "/tmp/x", team: { id: "team-1", name: "视觉波次", phase: "running", staged: true, runnable: true, links: 2 }, members: [], tasks, counts: { completed: 1, total: 5, inProgress: 0, pending: 4, claimed: 0, failed: 0, cancelled: 0, other: 0 }, problems: [], holds: [] }

const page = createDagPanelComponent(() => workflow as never) as (p: unknown) => unknown
const render = (): unknown => { kit.reset(); return page({ React, ui, host: host.host, focused: true, visible: true }) }
render()
kit.runEffects()
console.log("listeners:", listeners.length)

/** every character inside one node. */
const inline = (n: unknown): string => {
  if (n === null || n === undefined) return ""
  if (typeof n === "string" || typeof n === "number") return String(n)
  if (Array.isArray(n)) return n.map(inline).join("")
  const e = n as El
  return inline(e.props?.children) + inline(e.children)
}
/** all element keys, in walk order. */
const keysOf = (n: unknown, out: string[] = []): string[] => {
  if (n === null || n === undefined || typeof n !== "object") return out
  if (Array.isArray(n)) { for (const c of n) keysOf(c, out); return out }
  const e = n as El
  if (typeof e.props?.key === "string") out.push(e.props.key)
  keysOf(e.children, out)
  return out
}

// THE VERIFIER'S WALK: Down, Enter — four times.
for (let press = 0; press < 4; press += 1) {
  listeners[0]({ input: "", key: { downArrow: true }, preventDefault: (): void => {} })
  listeners[0]({ input: "", key: { return: true }, preventDefault: (): void => {} })
  const tree = render()
  const keys = keysOf(tree)
  const pinned = keys.filter((k) => k.startsWith("pin-"))
  const text = inline(tree)
  const chineseInChrome = subjects.filter((s) => text.includes(s))
  console.log(
    `press ${press + 1}: pinKeys=${pinned.length} [${pinned.slice(0, 2).join(",")}] chineseSubjectsPresent=${chineseInChrome.length} chineseInDetail=${keys.some((k) => k.startsWith("pin-")) && chineseInChrome.length > 0}`,
  )
}
