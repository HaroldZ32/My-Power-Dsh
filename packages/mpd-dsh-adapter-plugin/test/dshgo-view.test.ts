// The DSH Go view kit: builders emit the app's legal shape, the measurement matches the app's three
// budgets, `toolCard()` never ships a card a v1 app cannot draw, and `adaptView()` produces a
// legible v1 fallback (sections, badges and grids keep their words; decoration disappears).
//
// Every arm here is a fact the pinned 1.0.9 checker reports on the same shapes, so a regression in
// the kit reddens here before it reaches a panel.
import { describe, expect, test } from "bun:test"
import {
  BUDGETS,
  actions,
  adaptView,
  avatar,
  badge,
  bind,
  callout,
  chart,
  countViewNodes,
  divider,
  emptyState,
  fitsBudget,
  form,
  grid,
  keyValue,
  lintDesign,
  list,
  measureView,
  metric,
  panelView,
  progress,
  row,
  select,
  spacer,
  stack,
  steps,
  table,
  tabs,
  tag,
  text,
  textField,
  timeline,
  toggle,
  toolCard,
  viewDepth,
  style,
  VIEW_KEY,
} from "../src/dshgo-view.ts"

/** The app's v2 caps as the bridge reports them at 1.0.9. */
const V2_CAPS = { app: "1.0.9", locale: "zh", components: ["stack", "row", "text", "metric", "tabs", "grid", "badge", "tag", "avatar", "timeline", "divider", "spacer", "emptyState", "form", "textField", "select", "toggle"] }

/** Every object key in a tree, so a stripped key can be proven absent anywhere. */
function keysIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const child of value) keysIn(child, out)
    return out
  }
  if (typeof value !== "object" || value === null) return out
  for (const [key, child] of Object.entries(value)) {
    out.push(key)
    keysIn(child, out)
  }
  return out
}

/** Every component name in a tree. */
function componentNames(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const child of value) componentNames(child, out)
    return out
  }
  if (typeof value !== "object" || value === null) return out
  /** The node's own fields, read as an open record. */
  const record = value as Record<string, unknown>
  if (typeof record.type === "string") out.push(record.type)
  for (const child of Object.values(record)) componentNames(child, out)
  return out
}

/** A representative panel: hero, metric grid, member row, task table and an action row. */
function samplePanel(): Record<string, unknown> {
  return panelView({
    children: [tabs([
      {
        label: "总览",
        children: [
          stack([
            text("团队", { style: { size: "title", weight: "bold" } }),
            text("3 就绪 · 1 进行", { tone: "muted", style: { size: "caption" } }),
            grid([metric({ label: "就绪", value: 3 }), metric({ label: "进行", value: 1 })], { columns: 2 }),
            row([
              badge({ text: "DW", tone: "info" }),
              text("Deep Worker"),
            ], { style: { gap: "S", align: "center" } }),
            divider(),
            spacer({ size: "S" }),
            table({ columns: ["任务", "负责人"], rows: [["D1", "Deep Worker"]] }),
            progress(4, { max: 7, label: "已完成", tone: "good" }),
            callout("需要审批", { tone: "warn" }),
            steps([{ label: "计划", status: "done" }, { label: "执行", status: "current" }]),
          ], { style: { card: "tinted", padding: "M", gap: "S" } }),
        ],
      },
      {
        label: "问题",
        children: [
          stack([
            text("问题", { style: { size: "title", weight: "bold" } }),
            text("等你回答的问题", { tone: "muted", style: { size: "caption" } }),
          ], { style: { card: "tinted", padding: "M", gap: "S" } }),
          emptyState({ title: "还没有停下来的问题", message: "有成员需要你回答时，问题会出现在这里。" }),
        ],
      },
    ])],
  })
}

describe("builders emit the app's legal shapes", () => {
  test("the panel root is a v2 stack with accent app", () => {
    /** A minimal panel. */
    const view = panelView({ children: [text("x")] })
    expect(view.v).toBe(2)
    expect(view.accent).toBe("app")
    expect(view.type).toBe("stack")
    expect(view.style).toEqual({ gap: "M" })
  })

  test("bind prefixes data once and never twice", () => {
    expect(bind("session.ready")).toEqual({ $: "data.session.ready" })
    expect(bind("data.session.ready")).toEqual({ $: "data.session.ready" })
    expect(bind("data")).toEqual({ $: "data" })
    expect(bind("data[0]")).toEqual({ $: "data[0]" })
  })

  test("tabs are declared as items with a label per section", () => {
    /** One tab with one child. */
    const view = tabs([{ label: "总览", children: [text("a")] }])
    expect(view).toEqual({ type: "tabs", items: [{ label: "总览", children: [{ type: "text", text: "a" }] }] })
  })

  test("an empty tab is refused instead of emitting an empty stack", () => {
    expect(() => tabs([{ label: "空", children: [] }])).toThrow(/empty section/)
    expect(() => tabs([])).toThrow(/at least one section/)
    expect(() => tabs([{ label: "", children: [text("a")] }])).toThrow(/label/)
  })

  test("grid takes its own integer columns and refuses a container style", () => {
    /** One metric tile. */
    const tile = metric({ label: "就绪", value: 3 })
    expect(grid([tile], { columns: 2 })).toEqual({ type: "grid", columns: 2, children: [tile] })
    /** The spec's old mistake, passed through a cast so the runtime guard is what is tested. */
    const smuggled = { columns: "equal" } as unknown as Parameters<typeof grid>[1]
    expect(() => grid([tile], smuggled)).toThrow(/1–4/)
    /** A style object on the grid is the exact drift the amendment forbids. */
    const styled = { style: { columns: "equal" } } as unknown as Parameters<typeof grid>[1]
    expect(() => grid([tile], styled)).toThrow(/does not take "style"/)
    expect(() => grid([tile], { columns: 5 as 2 })).toThrow(/1–4/)
  })

  test("emptyState takes message and rejects the silently-ignored text", () => {
    expect(emptyState({ title: "空", message: "一句话" })).toEqual({ type: "emptyState", title: "空", message: "一句话" })
    /** The spec's old spelling, cast so the guard is the tested surface. */
    const wrong = { title: "空", text: "一句话" } as unknown as Parameters<typeof emptyState>[0]
    expect(() => emptyState(wrong)).toThrow(/never "text"/)
  })

  test("avatar is the image node and needs a real source", () => {
    expect(avatar({ src: "asset:icons/a.png", alt: "A" })).toEqual({ type: "avatar", src: "asset:icons/a.png", alt: "A" })
    expect(() => avatar({ src: "https://example.test/a.png" })).toThrow(/asset:/)
  })

  test("status badges carry a word and a tone", () => {
    expect(badge({ text: "进行中", tone: "info" })).toEqual({ type: "badge", text: "进行中", tone: "info" })
    expect(tag({ text: "D1", tone: "muted" })).toEqual({ type: "tag", text: "D1", tone: "muted" })
  })

  test("divider and spacer take no children", () => {
    expect(divider()).toEqual({ type: "divider" })
    expect(spacer({ size: "S" })).toEqual({ type: "spacer", size: "S" })
    expect(Object.keys(divider())).not.toContain("children")
  })

  test("inputs and the remaining builders keep the app's props", () => {
    expect(textField({ label: "答案", bind: "answers.one" })).toEqual({ type: "textField", label: "答案", bind: "answers.one" })
    expect(select({ label: "模式", options: [{ label: "快", value: "fast" }] }).type).toBe("select")
    expect(toggle({ label: "开启", value: true }).type).toBe("toggle")
    expect(form({ children: [textField({ label: "答案" })], submit: "answer" }).type).toBe("form")
    expect(timeline([{ label: "步骤", children: [text("细节")] }]).type).toBe("timeline")
    expect(keyValue([["名称", "值"]]).type).toBe("keyValue")
    expect(list([{ title: "行" }]).type).toBe("list")
    expect(chart({ categories: ["a"], series: [{ values: [1, 2] }] }).type).toBe("chart")
  })
})

describe("the open lists are capped at the app's own maximum", () => {
  test("actions, list rows and stack children", () => {
    /** Four buttons, the app's maximum. */
    const four = Array.from({ length: 4 }, (_, index) => ({ label: String(index), action: "x" }))
    expect(actions(four).type).toBe("actions")
    expect(() => actions([...four, { label: "5", action: "x" }])).toThrow(/at most 4/)
    expect(() => list(Array.from({ length: 51 }, () => ({ title: "x" })))).toThrow(/at most 50/)
    expect(() => stack(Array.from({ length: 33 }, () => text("x")))).toThrow(/at most 32/)
    expect(() => steps(Array.from({ length: 13 }, () => ({ label: "x" })))).toThrow(/at most 12/)
  })

  test("table columns and rows", () => {
    expect(table({ columns: ["a"], rows: [["1"]] }).type).toBe("table")
    expect(() => table({ columns: Array.from({ length: 9 }, () => "c"), rows: [] })).toThrow(/at most 8/)
    expect(() => table({ columns: ["a"], rows: Array.from({ length: 51 }, () => ["1"]) })).toThrow(/at most 50/)
    expect(() => table({ columns: ["a"], rows: [["1", "2"]] })).toThrow(/at most 1/)
  })
})

describe("style() is the closed, theme-following set", () => {
  test("the legal tokens pass through", () => {
    expect(style({ card: "tinted", padding: "M", gap: "S", align: "center", dividers: true, size: "title", weight: "bold", maxLines: 3, color: "accent" }))
      .toEqual({ card: "tinted", padding: "M", gap: "S", align: "center", dividers: true, size: "title", weight: "bold", maxLines: 3, color: "accent" })
  })

  test("a named colour or hex cannot be expressed", () => {
    expect(() => style({ color: "teal" } as never)).toThrow(/accent/)
    expect(() => style({ color: "#1a2b3c" } as never)).toThrow(/accent/)
    expect(() => style({ color: "muted" } as never)).toThrow(/accent/)
  })

  test("spacing is S/M/L and rejects numbers", () => {
    expect(() => style({ padding: 8 } as never)).toThrow(/S \/ M \/ L/)
    expect(() => style({ gap: "XL" } as never)).toThrow(/S \/ M \/ L/)
  })

  test("decoration the app does not execute is refused", () => {
    expect(() => style({ radius: 12 } as never)).toThrow(/does not know the key/)
    expect(() => style({ width: 100 } as never)).toThrow(/does not know the key/)
    expect(() => style({ maxLines: 0 })).toThrow(/1–20/)
    expect(() => style({ card: "glass" } as never)).toThrow(/plain/)
    expect(() => style({ columns: "two" } as never)).toThrow(/equal/)
    expect(style({ columns: "equal" })).toEqual({ columns: "equal" })
    expect(style({ columns: [1, 2] })).toEqual({ columns: [1, 2] })
  })
})

describe("panelView enforces the panel rules", () => {
  test("a second primary action is refused", () => {
    /** One primary button. */
    const primary = actions([{ label: "审批", action: "approve", primary: true }])
    expect(panelView({ children: [primary] }).v).toBe(2)
    /** A second primary anywhere in the tree is the §7.2 rule-8 breach. */
    const second = actions([{ label: "派活", action: "dispatch", primary: true }])
    expect(() => panelView({ children: [primary, second] })).toThrow(/at most ONE/)
  })
})

describe("measurement matches the app's three units", () => {
  test("nodes and depth count component nesting with the root at 1", () => {
    /** stack → text, grid → metric. */
    const view = stack([text("a"), grid([metric({ label: "k", value: 1 })], { columns: 2 })])
    expect(countViewNodes(view)).toBe(4)
    expect(viewDepth(view)).toBe(3)
    expect(measureView(view).nodes).toBe(4)
    expect(measureView(view).depth).toBe(3)
  })

  test("bytes are the UTF-8 JSON size", () => {
    /** A tree with a multi-byte character. */
    const view = text("团")
    expect(measureView(view).bytes).toBe(new TextEncoder().encode(JSON.stringify(view)).length)
    expect(measureView(view).bytes).toBeGreaterThan(JSON.stringify(view).length - 1)
  })

  test("fitsBudget is the three-number check", () => {
    expect(fitsBudget(stack([text("a")]), "panel")).toBe(true)
    expect(BUDGETS.toolCard.nodes).toBe(40)
    expect(BUDGETS.panel.bytes).toBe(32768)
    expect(BUDGETS.strip.depth).toBe(3)
    /** 67 nodes (two 32-child stacks and their parents) exceed the tool card's budget on their own. */
    const wide = stack([stack(Array.from({ length: 32 }, () => text("x"))), stack(Array.from({ length: 32 }, () => text("x")))])
    expect(fitsBudget(wide, "toolCard")).toBe(false)
    expect(fitsBudget(wide, "panel")).toBe(true)
    expect(fitsBudget(text("x"), "strip")).toBe(true)
  })
})

describe("toolCard never ships a card a v1 app cannot draw", () => {
  test("a good card carries the view under the protocol key", () => {
    /** A minimal card builder. */
    const build = toolCard(() => stack([metric({ label: "任务", value: 3 })], { title: "看板" }))
    /** What the tool's presentationMeta returns. */
    const meta = build({}, {})
    expect(Object.keys(meta)).toEqual([VIEW_KEY])
    expect(measureView(meta[VIEW_KEY] as Record<string, unknown>).depth).toBe(2)
  })

  test("an over-budget card degrades to an empty object", () => {
    /** A card with 67 nodes (two 32-child stacks and their parents). */
    const build = toolCard(() => stack([stack(Array.from({ length: 32 }, () => text("x"))), stack(Array.from({ length: 32 }, () => text("x")))]))
    expect(build({}, {})).toEqual({})
    /** A card whose JSON is over 8 KiB. */
    const huge = toolCard(() => text("x".repeat(9000)))
    expect(huge({}, {})).toEqual({})
  })

  test("a builder error, a v2 root, a v2 component, a binding or an accent all degrade", () => {
    expect(toolCard(() => { throw new Error("boom") })({}, {})).toEqual({})
    expect(toolCard(() => ({ v: 2, type: "stack", children: [] }))({}, {})).toEqual({})
    expect(toolCard(() => ({ type: "badge", text: "x" }))({}, {})).toEqual({})
    expect(toolCard(() => text(bind("session.ready")))({}, {})).toEqual({})
    expect(toolCard(() => ({ type: "stack", accent: "app", children: [] }))({}, {})).toEqual({})
  })

  test("the builder's own arguments and value reach it unchanged", () => {
    /** The arguments and value the tool call carried. */
    const build = toolCard((args: { id: string }, value: { count: number }) => metric({ label: args.id, value: value.count }))
    expect(build({ id: "T1" }, { count: 7 })).toEqual({ [VIEW_KEY]: { type: "metric", label: "T1", value: 7 } })
  })
})

describe("adaptView produces a legible v1 fallback", () => {
  test("a 1.0.9 app keeps the v2 tree untouched", () => {
    /** The sample panel, adapted for a v2 app. */
    const view = samplePanel()
    expect(adaptView(view, V2_CAPS)).toEqual(view)
  })

  test("an older app gets sections, lists and words, with no decoration", () => {
    /** The sample panel, adapted for a 1.0.8 app. */
    const adapted = adaptView(samplePanel(), { app: "1.0.8" })
    expect(adapted.v).toBe(1)
    expect(adapted.accent).toBeUndefined()
    expect(keysIn(adapted)).not.toContain("style")
    expect(keysIn(adapted)).not.toContain("accent")
    /** No v2-only component name survives. */
    for (const name of componentNames(adapted)) {
      expect(["stack", "row", "text", "metric", "list", "table", "progress", "callout", "steps"]).toContain(name)
    }
    /** The tab label survives as a text node, and the empty-state copy survives too. */
    expect(JSON.stringify(adapted)).toContain("总览")
    expect(JSON.stringify(adapted)).toContain("还没有停下来的问题")
    expect(JSON.stringify(adapted)).toContain("有成员需要你回答时")
  })

  test("divider and spacer are dropped, not converted", () => {
    /** A tree whose only v2 decorations are the two space nodes. */
    const adapted = adaptView(stack([text("a"), divider(), spacer({ size: "S" }), text("b")]), { app: "1.0.8" })
    expect(componentNames(adapted)).toEqual(["stack", "text", "text"])
  })

  test("grid becomes a list and timeline becomes steps", () => {
    /** A grid of two metrics next to a timeline. */
    const view = stack([
      grid([metric({ label: "就绪", value: 3 }), metric({ label: "进行", value: 1 })], { columns: 2 }),
      timeline([{ label: "计划", children: [text("细节")] }]),
    ])
    /** The v1 fallback. */
    const adapted = adaptView(view, { app: "1.0.8" })
    expect(componentNames(adapted)).toEqual(["stack", "list", "steps"])
    expect(JSON.stringify(adapted)).toContain("就绪")
    expect(JSON.stringify(adapted)).toContain("细节")
  })

  test("badge, tag and avatar become text, and emptyState becomes its copy", () => {
    /** Every word-carrying v2 node. */
    const view = stack([
      badge({ text: "进行中", tone: "info" }),
      tag({ text: "D1" }),
      avatar({ src: "asset:icons/a.png", alt: "DW" }),
      emptyState({ title: "空", message: "一句话" }),
    ])
    /** The v1 fallback. */
    const adapted = adaptView(view, { app: "1.0.8" })
    expect(componentNames(adapted)).toEqual(["stack", "text", "text", "text", "text"])
    expect(JSON.stringify(adapted)).toContain("进行中")
    expect(JSON.stringify(adapted)).toContain("一句话")
  })

  test("a 1.0.9 app missing one component degrades only that one, keeping styles", () => {
    /** The app's list without `tabs`. */
    const caps = { app: "1.0.9", components: V2_CAPS.components.filter((name) => name !== "tabs") }
    /** One tab whose section is a tinted card. */
    const view = panelView({ children: [tabs([{ label: "总览", children: [stack([text("a")], { style: { card: "tinted" } })] }])] })
    /** The partial fallback. */
    const adapted = adaptView(view, caps)
    expect(adapted.v).toBe(2)
    expect(adapted.accent).toBe("app")
    expect(componentNames(adapted)).toEqual(["stack", "stack", "text", "stack", "text"])
    expect(JSON.stringify(adapted)).toContain('"card":"tinted"')
  })

  test("an unknown app version reads as older", () => {
    expect(adaptView(panelView({ children: [text("x")] }), null).v).toBe(1)
    expect(adaptView(panelView({ children: [text("x")] }), { app: "unknown" }).v).toBe(1)
    expect(adaptView(panelView({ children: [text("x")] }), { app: "1.0.9" }).v).toBe(2)
  })

  test("is idempotent and never mutates its input", () => {
    /** The original tree, serialized for the mutation check. */
    const original = samplePanel()
    /** What the input looked like before the call. */
    const before = JSON.stringify(original)
    /** The first downgrade. */
    const once = adaptView(original, { app: "1.0.8" })
    expect(JSON.stringify(original)).toBe(before)
    expect(adaptView(once, { app: "1.0.8" })).toEqual(once)
    expect(adaptView(adaptView(original, V2_CAPS), V2_CAPS)).toEqual(adaptView(original, V2_CAPS))
  })
})

/** The first node of a given component name, or undefined. */
function findNode(view: unknown, type: string): Record<string, unknown> | undefined {
  if (Array.isArray(view)) {
    for (const child of view) {
      /** A match inside this child, when there is one. */
      const hit = findNode(child, type)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (typeof view !== "object" || view === null) return undefined
  /** The candidate object, read as an open record. */
  const record = view as Record<string, unknown>
  if (record.type === type) return record
  return findNode(Object.values(record), type)
}

describe("lintDesign is the gate the app checker cannot be", () => {
  test("the kit-built panel and its v1 fallback are both clean", () => {
    /** The built v2 panel. */
    const panel = samplePanel()
    expect(lintDesign(panel, { version: 2 })).toEqual([])
    /** Its v1 fallback. */
    const fallback = adaptView(panel, { app: "1.0.8" })
    expect(lintDesign(fallback, { version: 1 })).toEqual([])
  })

  test("panelView makes a named or hex accent unrepresentable", () => {
    /** The only accent a panel can carry. */
    const accent = panelView({ children: [text("x")] }).accent
    expect(accent).toBe("app")
    expect(lintDesign({ type: "stack", accent: "teal" })).toContainEqual(expect.objectContaining({ rule: "colour-named" }))
    expect(lintDesign({ type: "stack", accent: "#112233" })).toContainEqual(expect.objectContaining({ rule: "colour-hex" }))
  })

  test("the v2 bans", () => {
    expect(lintDesign({ type: "stack", style: { padding: 8 } })).toContainEqual(expect.objectContaining({ rule: "style-spacing" }))
    expect(lintDesign({ type: "stack", style: { gap: "XL" } })).toContainEqual(expect.objectContaining({ rule: "style-spacing" }))
    expect(lintDesign({ type: "text", text: "x", style: { color: "teal" } })).toContainEqual(expect.objectContaining({ rule: "style-colour" }))
    expect(lintDesign({ type: "stack", style: { radius: 12 } })).toContainEqual(expect.objectContaining({ rule: "style-decoration" }))
    expect(lintDesign({ type: "stack", style: { opacity: 0.5 } })).toContainEqual(expect.objectContaining({ rule: "style-decoration" }))
    expect(lintDesign({ type: "spacer", size: 8 })).toContainEqual(expect.objectContaining({ rule: "size-numeric" }))
    expect(lintDesign({ type: "tabs", children: [] })).toContainEqual(expect.objectContaining({ rule: "tabs-children" }))
    expect(lintDesign({ type: "emptyState", title: "空", text: "一句话" })).toContainEqual(expect.objectContaining({ rule: "emptyState-text" }))
    expect(lintDesign({ type: "grid", columns: 2, style: { columns: "equal" }, children: [] })).toContainEqual(expect.objectContaining({ rule: "grid-style" }))
    expect(lintDesign({ type: "avatar", alt: "DW" })).toContainEqual(expect.objectContaining({ rule: "avatar-src" }))
    expect(lintDesign({ type: "badge", tone: "info" })).toContainEqual(expect.objectContaining({ rule: "status-word" }))
  })

  test("more than one primary action is a finding (the app checker passes it)", () => {
    /** Two primary buttons in one view. */
    const view = { type: "stack", children: [actions([{ label: "a", action: "a", primary: true }]), actions([{ label: "b", action: "b", primary: true }])] }
    expect(lintDesign(view)).toContainEqual(expect.objectContaining({ rule: "primary-count" }))
  })

  test("the positive rules: hero, tiled metrics, empty tabs, bounded text", () => {
    expect(lintDesign({ type: "stack", children: [text("no hero")] })).toContainEqual(expect.objectContaining({ rule: "hero-count" }))
    expect(lintDesign({ type: "stack", children: [{ type: "metric", label: "loose", value: 1 }] })).toContainEqual(expect.objectContaining({ rule: "metric-parent" }))
    /** A tab with only prose and a hero but no data-bearing child. */
    const proseTab = panelView({ children: [tabs([{ label: "说明", children: [stack([text("说明")], { style: { card: "tinted" } })] }])] })
    expect(lintDesign(proseTab)).toContainEqual(expect.objectContaining({ rule: "empty-tab" }))
    /** A tab whose data arrives through a binding is exempt from the empty-tab rule. */
    const boundTab = panelView({ children: [tabs([{ label: "绑定", children: [stack([text(bind("team.name"))], { style: { card: "tinted" } })] }])] })
    expect(lintDesign(boundTab).some((finding) => finding.rule === "empty-tab")).toBe(false)
    expect(lintDesign({ type: "stack", children: [text("x".repeat(121))] })).toContainEqual(expect.objectContaining({ rule: "text-maxlines" }))
    expect(lintDesign({ type: "stack", children: [text({ $: "data.x" })] })).toContainEqual(expect.objectContaining({ rule: "text-maxlines" }))
    /** The binding SHAPE is what is tested, never a `data.` prefix. */
    expect(lintDesign({ type: "stack", children: [text({ $: "ctx.path" })] })).toContainEqual(expect.objectContaining({ rule: "text-maxlines" }))
  })

  test("version 1 asserts the static-fallback contract", () => {
    expect(lintDesign({ type: "stack", children: [{ type: "badge", text: "x" }] }, { version: 1 })).toContainEqual(expect.objectContaining({ rule: "v1-component" }))
    expect(lintDesign({ type: "stack", children: [{ type: "mystery" }] }, { version: 1 })).toContainEqual(expect.objectContaining({ rule: "v1-unknown-component" }))
    expect(lintDesign({ type: "stack", style: { gap: "M" }, children: [text("x")] }, { version: 1 })).toContainEqual(expect.objectContaining({ rule: "v1-decoration" }))
    expect(lintDesign({ type: "stack", accent: "app", children: [text("x")] }, { version: 1 })).toContainEqual(expect.objectContaining({ rule: "v1-decoration" }))
    expect(lintDesign({ type: "stack", children: [{ type: "text", text: "" }] }, { version: 1 })).toContainEqual(expect.objectContaining({ rule: "v1-text" }))
  })
})

describe("H2: the v1 fallback keeps every metric's number", () => {
  test("labels and values survive the grid downgrade", () => {
    /** A hero holding a two-tile metric grid. */
    const view = panelView({
      children: [stack([grid([metric({ label: "Ready", value: 3 }), metric({ label: "Active", value: 1, caption: "in flight" })], { columns: 2 })], { style: { card: "tinted" } })],
    })
    /** The v1 fallback. */
    const fallback = adaptView(view, { app: "1.0.8" })
    /** The list that replaced the grid. */
    const listNode = findNode(fallback, "list")
    expect(listNode?.items).toEqual([
      { title: "Ready", trailing: 3 },
      { title: "Active", trailing: 1, subtitle: "in flight" },
    ])
    /** And the words survive anywhere in the serialized fallback. */
    const text = JSON.stringify(fallback)
    for (const word of ["Ready", "Active", "3", "1", "in flight"]) expect(text).toContain(word)
  })
})
