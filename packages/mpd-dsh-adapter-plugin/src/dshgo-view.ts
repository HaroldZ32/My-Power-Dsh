// The DSH Go view kit: the ONE place this bundle builds native view trees for the dsh-Go app —
// panels, composer strips and tool cards.
//
// WHY THIS FILE EXISTS: `@dsh-go/plugin-kit` is private and unpublished (wave contract §2), so the
// helpers this bundle needs are re-implemented here. It is PURE by contract: no ctx, no I/O, no
// imports. Every builder produces plain JSON the bridge forwards verbatim, and the three budgets,
// the measurement and the v1 fallback live here so the adapter row and every plugin lane agree.
//
// THE THREE RULES THIS FILE MAKES HARD TO BREAK (contract §7.2):
//   1. A panel view follows the user's theme: `panelView()` always writes `accent: "app"`, and
//      `style()` refuses every colour but `"accent"` — a named colour or `#RRGGBB` cannot be
//      expressed through it, and long text uses the semantic `tone` instead.
//   2. Decoration is the APP's: no radius, width, height, opacity, gradient or shadow is accepted,
//      and spacing is only S / M / L (a numeric padding or gap throws).
//   3. A tool card stays v1: `toolCard()` drops a v2 root, a v2-only component, a data binding or a
//      panel accent rather than shipping a card an older app cannot draw.
//
// MEASUREMENT matches the app: `nodes` counts every `{ type }` component reachable through
// `children` and through `items[].children` (sections), `depth` counts component nesting with the
// root at 1, and `bytes` is the UTF-8 size of the JSON text — the same three numbers the bridge's
// own `BUDGETS` table enforces.

/** A view tree as the bridge receives it: plain JSON, a `type`-tagged root, open component props. */
export type DshGoView = Record<string, unknown>

/** A value read from a panel's pushed data model: `{ "$": "data.session.cost" }`. */
export interface DshGoBinding {
  /** The `data.…` path the bridge resolves before rendering. */
  readonly $: string
}

/** What the app on the other end can draw, as every view/data function receives it. */
export interface DshGoCaps {
  /** The app version (`"1.0.9"` and up speaks view v2). */
  app?: string
  /** The app's locale tag, used for hand-written labels. */
  locale?: string
  /** Component names the app draws; absent means the v1 catalog is assumed. */
  components?: string[]
  /** Slots the app shows; absent means the four protocol-v1 surfaces. */
  surfaces?: string[]
}

/** The semantic colour a node carries INSTEAD of a named colour (theme-following by contract). */
export type DshGoTone = "good" | "warn" | "bad" | "info" | "muted"

/** The app's font-size steps; numeric pixel sizes are not accepted by the protocol. */
export type DshGoTextSize = "display" | "title" | "subtitle" | "body" | "caption" | "mono"

/** The app's font weights, as the protocol names them. */
export type DshGoTextWeight = "regular" | "medium" | "semibold" | "bold"

/** Horizontal text alignment for a text-style node. */
export type DshGoAlign = "start" | "center" | "end"

/** The app's three spacing steps: S = 8 dp, M = 12 dp, L = 16 dp. */
export type DshGoSpacing = "S" | "M" | "L"

/** The app's container materials; `tinted` is the theme-colour frame the design leans on. */
export type DshGoCard = "plain" | "surface" | "tinted" | "outlined"

/** The three view budgets the app enforces, keyed exactly as the bridge keys them. */
export type DshGoBudgetName = "toolCard" | "panel" | "strip"

/** One budget: JSON bytes, component nodes and component nesting. */
export interface DshGoBudget {
  /** Maximum UTF-8 bytes of the view's JSON text. */
  readonly bytes: number
  /** Maximum number of `{ type }` component nodes. */
  readonly nodes: number
  /** Maximum component nesting, the root counting as 1. */
  readonly depth: number
}

/** The measured size of a view tree, in the app's own three units. */
export interface DshGoMeasurement {
  /** UTF-8 bytes of `JSON.stringify(view)`. */
  readonly bytes: number
  /** Number of `{ type }` component nodes. */
  readonly nodes: number
  /** Deepest component nesting, the root counting as 1 (0 for a tree with no node). */
  readonly depth: number
}

/**
 * The view-v2 style tokens this kit writes, restricted to the closed set the app executes.
 *
 * Only `stack` / `row` honour `card`, `padding`, `gap`, `columns` and `dividers`; only `text`,
 * `metric` and `callout` honour `size`, `weight`, `color` and `maxLines`. Every value here is
 * theme-derived: `color` accepts ONLY `"accent"`, so a named colour or `#RRGGBB` is unrepresentable.
 */
export interface DshGoStyle {
  /** The container material; `tinted` blends the theme colour over the content background. */
  card?: DshGoCard
  /** Requested padding on all four sides, S / M / L only. */
  padding?: DshGoSpacing
  /** Gap between children, S / M / L only. */
  gap?: DshGoSpacing
  /** Cross-axis alignment of a stack (horizontal) or a row (vertical). */
  align?: DshGoAlign
  /** Column layout of a row: `"equal"`, or 1–8 integer weights of 1–12 each. */
  columns?: "equal" | readonly number[]
  /** Draw a rule between a stack's items and between a row's columns. */
  dividers?: boolean
  /** Font-size step (text-style nodes only). */
  size?: DshGoTextSize
  /** Font weight (text-style nodes only). */
  weight?: DshGoTextWeight
  /** Foreground colour; ONLY `"accent"`, so the text follows the user's theme. */
  color?: "accent"
  /** Maximum rendered lines, 1–20 (text-style nodes only). */
  maxLines?: number
}

/** The root-level input of {@link panelView}: the tabs (usually one) and the root gap. */
export interface DshGoPanelInput {
  /** The root's children, normally a single `tabs` node. */
  readonly children: readonly DshGoView[]
  /** Root style; the legal keys are `gap`, `padding` and `align` (card material at the root is not used). */
  style?: DshGoStyle
}

/** The title a layout node may carry; the bridge renders it above the children. */
export interface DshGoLayoutProps {
  /** One-line section title. */
  title?: string
  /** The node's container style (stack / row only). */
  style?: DshGoStyle
}

/** Props shared by the text-style nodes this kit exposes. */
export interface DshGoTextProps {
  /** Semantic colour, the theme-following way to emphasise or mute. */
  tone?: DshGoTone
  /** Text style: size, weight, align, maxLines, and `color: "accent"`. */
  style?: DshGoStyle
}

/** One key number, optionally with a caption and a trend line. */
export interface DshGoMetricProps {
  /** The metric's name, shown small above the value. */
  readonly label: string | number | DshGoBinding
  /** The value, rendered at the metric's large size. */
  readonly value: string | number | DshGoBinding
  /** Semantic colour of the value. */
  readonly tone?: DshGoTone
  /** One-line explanation under the value. */
  readonly caption?: string
  /** Text style of the value (size, weight). */
  readonly style?: DshGoStyle
}

/** A chart's categories and series; the app clips at 60 points and 6 series. */
export interface DshGoChartProps {
  /** Chart shape; `bar` by default. */
  readonly kind?: "bar" | "hbar" | "line" | "donut"
  /** Category labels along the axis. */
  readonly categories: readonly string[]
  /** One series per line or bar set. */
  readonly series: readonly ({ readonly name?: string; readonly values: readonly number[] } | DshGoBinding)[]
  /** Unit appended to the values. */
  readonly unit?: string
  /** One-line explanation under the chart. */
  readonly caption?: string
}

/** One table column: a plain label, or a label plus its alignment. */
export interface DshGoTableColumn {
  /** The column's header text. */
  readonly label: string
  /** Cell alignment; `start` by default. */
  readonly align?: DshGoAlign
}

/** A table's columns and rows; the app clips at 50 rows and 8 columns. */
export interface DshGoTableProps {
  /** Column headers, in display order. */
  readonly columns: readonly (string | DshGoTableColumn)[]
  /** Row cells, one value per column. */
  readonly rows: readonly (readonly (string | number)[])[]
}

/** One list row: a title and optional supporting text. */
export interface DshGoListItem {
  /** The row's primary text. */
  readonly title: string | number | DshGoBinding
  /** Secondary text under the title. */
  readonly subtitle?: string
  /** Trailing text at the row's end. */
  readonly trailing?: string | number
  /** A whitelisted icon name shown before the title. */
  readonly icon?: string
  /** Semantic colour of the row. */
  readonly tone?: DshGoTone
  /**
   * The action a tap on this row invokes.
   *
   * Measured in the app's `docs/plugins/actions.md`: a row WITHOUT `action` is inert, and a row with
   * one gets a chevron and calls that handler with `value` carrying the action's `args`. The row form
   * is the only way a panel can select a row (a `table` row is not tappable).
   */
  readonly action?: DshGoActionRef
}

/** The action a button or row tap invokes: a plugin action id, or an id plus its arguments. */
export type DshGoActionRef = string | { readonly id: string; readonly args?: Record<string, unknown> }

/** One button in an `actions` row. */
export interface DshGoActionItem {
  /** The button's text. */
  readonly label: string
  /** The plugin action the tap invokes. */
  readonly action: DshGoActionRef
  /** A whitelisted icon name. */
  readonly icon?: string
  /** Mark the row's one primary button; the app downgrades it to an outlined button and logs it. */
  readonly primary?: boolean
}

/** One step of a `steps` node. */
export interface DshGoStep {
  /** The step's text. */
  readonly label: string
  /** Where the step stands in the sequence. */
  readonly status?: "done" | "current" | "todo" | "failed"
  /** One line of detail under the label. */
  readonly detail?: string
}

/** One section of a `tabs` / `timeline` node: a label and the section's own children. */
export interface DshGoSection {
  /** The tab label or the timeline entry's title. */
  readonly label: string | DshGoBinding
  /** The section's content; at least one child, so an empty tab is impossible. */
  readonly children: readonly DshGoView[]
}

/** The one-line model a `strip` emits. */
export interface DshGoStripValue {
  /** The line's text, clipped by the app to 24 characters. */
  readonly text: string
  /** A whitelisted icon name shown before the text. */
  readonly icon?: string
  /** Semantic colour of the line. */
  readonly tone?: DshGoTone
}

/** A grid's own layout: the app's container property, NOT a style key (style is stack/row only). */
export interface DshGoGridProps {
  /** Equal columns, 1–4; two turns metric tiles into a readable tile block. */
  readonly columns?: 1 | 2 | 3 | 4
  /** Optional label above the grid. */
  readonly label?: string
}

/** A form's fields and its submit action. */
export interface DshGoFormProps {
  /** The input nodes the form wraps. */
  readonly children: readonly DshGoView[]
  /** The action id the bridge invokes with the collected values. */
  readonly submit?: string
  /** The submit button's text. */
  readonly submitLabel?: string
}

/** A text input's label and current value. */
export interface DshGoInputProps {
  /** The field's label; the app requires one on every input. */
  readonly label: string
  /** The current value, when the field is not bound. */
  readonly value?: string
  /** The `data.…` path the field reads and writes, making it editable. */
  readonly bind?: string
  /** Placeholder text shown while the field is empty. */
  readonly placeholder?: string
}

/** A select's label and its options (at most 24, per the protocol's input limits). */
export interface DshGoSelectProps {
  /** The field's label. */
  readonly label: string
  /** The option rows offered. */
  readonly options: readonly { readonly label: string; readonly value: string }[]
  /** The currently selected value, when the field is not bound. */
  readonly value?: string
  /** The `data.…` path the field reads and writes. */
  readonly bind?: string
}

/** A toggle's label and its current state. */
export interface DshGoToggleProps {
  /** The field's label. */
  readonly label: string
  /** The current state, when the field is not bound. */
  readonly value?: boolean
  /** The `data.…` path the field reads and writes. */
  readonly bind?: string
}

/** The designed empty look: a title, one sentence, and at most one button. */
export interface DshGoEmptyStateProps {
  /** A short title (the app clips it to 40 characters). */
  readonly title: string
  /** One sentence saying what will appear here (clipped to 120 characters). */
  readonly message?: string
  /** A whitelisted icon name. */
  readonly icon?: string
  /** One optional button under the copy. */
  readonly action?: { readonly label: string; readonly action: DshGoActionRef; readonly icon?: string }
}

/**
 * An avatar node: `src` plus `alt` only.
 *
 * Measured in the app's `docs/plugins/inputs.md`: `avatar` is a fixed 48 dp square with an icon
 * fallback and NO caption, so `caption` / `aspect` are absent here — a prop the app ignores is a
 * silent lie to the panel author.
 */
export interface DshGoAvatarProps {
  /** The picture source: `asset:<path>` in the plugin, or a `data:image/…` URL. */
  readonly src: string
  /** Alternative text; also the v1 fallback the downgrade keeps. */
  readonly alt?: string
}

/** A badge or tag: the status word, plus the tone that colours it. */
export interface DshGoBadgeProps {
  /** The word the badge carries (status is never colour-only). */
  readonly text: string
  /** Semantic colour. */
  readonly tone?: DshGoTone
}

/** The 16 component names of view format v1. */
export const V1_COMPONENTS: readonly string[] = Object.freeze([
  "stack", "row", "text", "metric", "chart", "compare", "steps", "callout", "options", "confirm",
  "list", "keyValue", "progress", "table", "actions", "image",
])

/** The component names view v2 adds; an older app draws a placeholder for every one of them. */
export const V2_ONLY_COMPONENTS: readonly string[] = Object.freeze([
  "textField", "number", "stepper", "toggle", "slider", "select", "segmented", "chips", "date",
  "time", "rating", "form", "tabs", "collapsible", "accordion", "carousel", "timeline", "grid",
  "badge", "tag", "avatar", "codeBlock", "divider", "spacer", "emptyState", "gallery",
])

/** The key the dsh-Go app reads inside a tool result's `meta`. */
export const VIEW_KEY = "dsh-go/view"

/**
 * The three budgets the app enforces on a view tree, byte-for-byte the bridge's own table.
 *
 * Over a budget the app drops the WHOLE block, so `toolCard()` and the panel lanes measure before
 * publishing; `fitsBudget()` is the one check both use.
 */
export const BUDGETS: {
  readonly toolCard: DshGoBudget
  readonly panel: DshGoBudget
  readonly strip: DshGoBudget
} = Object.freeze({
  toolCard: Object.freeze({ bytes: 8192, nodes: 40, depth: 6 }),
  panel: Object.freeze({ bytes: 32768, nodes: 120, depth: 8 }),
  strip: Object.freeze({ bytes: 2048, nodes: 8, depth: 3 }),
})

/** The v2-only names {@link adaptView} knows a v1 stand-in for; every other one stays a placeholder. */
const FALLBACK_COMPONENTS: readonly string[] = V2_ONLY_COMPONENTS

/** True for a plain JSON object (not an array, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True for a `{ "$": "data.…" }` binding, the one-key shape the protocol defines. */
function isBinding(value: unknown): value is DshGoBinding {
  if (!isRecord(value)) return false
/** The keys of the candidate; a binding carries exactly one. */
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === "$" && typeof value.$ === "string"
}

/** True for a component node: a plain object whose `type` is a string. */
function isNode(value: unknown): value is DshGoView {
  return isRecord(value) && typeof value.type === "string"
}

/** Throw a `RangeError` naming the builder and what it refused. */
function refuse(builder: string, detail: string): never {
  throw new RangeError(`dsh-go view: ${builder} ${detail}`)
}

/** Refuse a prop a builder does not take, so a silently-ignored key is loud instead. */
function rejectExtra(builder: string, props: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(props)) {
    if (!allowed.includes(key)) refuse(builder, `does not take "${key}" (accepted: ${allowed.join(" / ")})`)
  }
}

/** Assert one closed value set, returning the narrowed value. */
function choice<T extends string>(builder: string, field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    refuse(builder, `needs ${field} to be one of ${allowed.join(" / ")}, got ${JSON.stringify(value)}`)
  }
  return value as T
}

/** Assert an array is an array and within the app's maximum length. */
function assertList<T>(builder: string, field: string, value: readonly T[], max: number): readonly T[] {
  if (!Array.isArray(value)) refuse(builder, `needs ${field} to be an array`)
  if (value.length > max) refuse(builder, `accepts at most ${max} ${field}, got ${value.length}`)
  return value
}

/** Assert a list of component children across EVERY component type; the protocol's absolute maximum. */
const MAX_CHILDREN = 32

/** The build helper every builder funnels through: `type` plus defined props, nothing dropped silently. */
function node(type: string, props: Record<string, unknown>): DshGoView {
/** The node being assembled: `type` first, then the props the caller set. */
  const out: Record<string, unknown> = { type }
  for (const [key, value] of Object.entries(props)) if (value !== undefined) out[key] = value
  return out
}

/**
 * A data binding into the view's pushed model.
 *
 * The protocol requires the path to start with `data`, so a caller may pass `"session.cost"`; the
 * prefix is added once and never doubled.
 * @param path - the model path, with or without the leading `data`.
 * @returns the binding node the bridge resolves.
 */
export function bind(path: string): DshGoBinding {
/** The caller's path, coerced once so a non-string never reaches the pattern. */
  const spelled = String(path)
  return { $: spelled === "data" || spelled.startsWith("data.") || spelled.startsWith("data[") ? spelled : `data.${spelled}` }
}

/**
 * Validate and copy style tokens.
 *
 * Unknown keys, a numeric padding/gap, an out-of-range `maxLines` and every colour but `"accent"`
 * are REFUSED rather than forwarded: the app would silently drop them, which is exactly the kind of
 * drift the visual contract forbids.
 * @param input - the style tokens to validate.
 * @returns a fresh plain object carrying only the defined tokens.
 */
export function style(input: DshGoStyle): DshGoStyle {
/** Every style key the app executes; anything else is refused below. */
  const known = ["card", "padding", "gap", "align", "columns", "dividers", "size", "weight", "color", "maxLines"]
  for (const key of Object.keys(input)) {
    if (!known.includes(key)) refuse("style", `does not know the key "${key}" (decoration is the app's)`)
  }
/** The validated style, carrying only the tokens the caller actually set. */
  const out: DshGoStyle = {}
  if (input.card !== undefined) out.card = choice<DshGoCard>("style", "card", input.card, ["plain", "surface", "tinted", "outlined"])
  if (input.padding !== undefined) out.padding = choice<DshGoSpacing>("style", "padding", input.padding, ["S", "M", "L"])
  if (input.gap !== undefined) out.gap = choice<DshGoSpacing>("style", "gap", input.gap, ["S", "M", "L"])
  if (input.align !== undefined) out.align = choice<DshGoAlign>("style", "align", input.align, ["start", "center", "end"])
  if (input.dividers !== undefined) {
    if (typeof input.dividers !== "boolean") refuse("style", "needs dividers to be a boolean")
    out.dividers = input.dividers
  }
  if (input.size !== undefined) out.size = choice<DshGoTextSize>("style", "size", input.size, ["display", "title", "subtitle", "body", "caption", "mono"])
  if (input.weight !== undefined) out.weight = choice<DshGoTextWeight>("style", "weight", input.weight, ["regular", "medium", "semibold", "bold"])
  if (input.maxLines !== undefined) {
    if (!Number.isInteger(input.maxLines) || input.maxLines < 1 || input.maxLines > 20) {
      refuse("style", "needs maxLines to be an integer 1–20")
    }
    out.maxLines = input.maxLines
  }
  if (input.color !== undefined) out.color = choice<"accent">("style", "color", input.color, ["accent"])
  if (input.columns !== undefined) {
    if (input.columns === "equal") out.columns = "equal"
    else if (Array.isArray(input.columns) && input.columns.length > 0 && input.columns.length <= 8
      && input.columns.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 12)) {
      out.columns = [...input.columns]
    } else refuse("style", 'needs columns to be "equal" or 1–8 integer weights of 1–12')
  }
  return out
}

/** Wrap a style object for a node, or `undefined` when none was given. */
function styleOf(input: DshGoStyle | undefined): DshGoStyle | undefined {
  return input === undefined ? undefined : style(input)
}

/**
 * The panel root: a v2 stack carrying `accent: "app"` and the tabs.
 *
 * The accent is written HERE and nowhere else, which is what makes a named colour or `#RRGGBB`
 * accent unrepresentable through this kit (contract §7.2 rule 1). At most one primary action is
 * allowed across the whole tree, because the app downgrades a second one and logs a diagnostic.
 * @param input - the root's children and optional root style.
 * @returns the complete view tree a panel publishes.
 */
export function panelView(input: DshGoPanelInput): DshGoView {
  assertList("panelView", "children", input.children, MAX_CHILDREN)
  if (input.children.length === 0) refuse("panelView", "needs at least one child")
/** The root style: the caller's tokens, or the panel default gap. */
  const root = styleOf(input.style) ?? { gap: "M" }
/** The complete root node; `accent: "app"` is written here and nowhere else. */
  const view = node("stack", { v: 2, accent: "app", style: root, children: input.children })
  if (countPrimaryActions(view) > 1) {
    refuse("panelView", 'allows at most ONE action with style "primary" per view (contract §7.2 rule 8)')
  }
  return view
}

/** Count the `style: "primary"` action items anywhere in a tree. */
function countPrimaryActions(view: DshGoView): number {
/** How many buttons claim the single primary slot. */
  let primaries = 0
  for (const found of componentNodes(view)) {
/** The candidate item list of an `actions` node. */
    const items = found.node.items
    if (found.node.type !== "actions" || !Array.isArray(items)) continue
    for (const item of items) {
      if (isRecord(item) && item.style === "primary") primaries += 1
    }
  }
  return primaries
}

/** Every component node in a tree, depth first, with the depth the app parses it at (root = 1). */
/** The depth this node is parsed at, the root counting as 1. */
function* componentNodes(view: unknown, depth: number = 1): Generator<{ node: DshGoView; depth: number }> {
  if (!isNode(view)) return
  yield { node: view, depth }
  for (const child of childrenOf(view)) yield* componentNodes(child, depth + 1)
}

/** The component children of a node: its `children`, then each section's `children`. */
function childrenOf(node: DshGoView): unknown[] {
/** The children collected from this node. */
  const out: unknown[] = []
  if (Array.isArray(node.children)) out.push(...node.children)
  if (Array.isArray(node.items)) {
    for (const item of node.items) if (isRecord(item) && Array.isArray(item.children)) out.push(...item.children)
  }
  return out
}

/**
 * A vertical stack.
 * @param children - the children, at most 32 (the protocol's absolute maximum).
 * @param props - an optional title and container style.
 * @returns the stack node.
 */
export function stack(children: readonly DshGoView[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("stack", "children", children, MAX_CHILDREN)
  return node("stack", { children, title: props.title, style: styleOf(props.style) })
}

/**
 * A horizontal row that wraps on narrow screens.
 * @param children - the children, at most 32.
 * @param props - an optional title and container style (`columns` is a row lever).
 * @returns the row node.
 */
export function row(children: readonly DshGoView[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("row", "children", children, MAX_CHILDREN)
  return node("row", { children, title: props.title, style: styleOf(props.style) })
}

/**
 * A paragraph of text.
 * @param value - the words, a number, or a binding.
 * @param props - an optional semantic tone and text style.
 * @returns the text node.
 */
export function text(value: string | number | boolean | DshGoBinding, props: DshGoTextProps = {}): DshGoView {
  return node("text", { text: value, tone: props.tone, style: styleOf(props.style) })
}

/**
 * One key number.
 * @param props - the required label and value, plus tone, caption and text style.
 * @returns the metric node.
 */
export function metric(props: DshGoMetricProps): DshGoView {
  return node("metric", { label: props.label, value: props.value, tone: props.tone, caption: props.caption, style: styleOf(props.style) })
}

/**
 * A chart.
 * @param props - categories, at most 6 series of at most 60 points each.
 * @returns the chart node.
 */
export function chart(props: DshGoChartProps): DshGoView {
/** The series, capped at the app's six. */
  const series = assertList("chart", "series", props.series, 6)
  for (const one of series) {
    if (isBinding(one)) continue
    assertList("chart", "series values", one.values, 60)
  }
  return node("chart", { kind: props.kind, categories: props.categories, series, unit: props.unit, caption: props.caption })
}

/**
 * A table, the cheapest way to show a column set.
 * @param props - at most 8 columns and 50 rows.
 * @returns the table node.
 */
export function table(props: DshGoTableProps): DshGoView {
  assertList("table", "columns", props.columns, 8)
/** The rows, capped at the app's fifty. */
  const rows = assertList("table", "rows", props.rows, 50)
  for (const cells of rows) assertList("table", "row cells", cells, props.columns.length)
  return node("table", { columns: props.columns, rows })
}

/**
 * Name … value pairs.
 * @param items - the pairs, at most 24.
 * @param props - an optional title and container style.
 * @returns the keyValue node.
 */
export function keyValue(items: readonly (readonly [string, string | number])[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("keyValue", "items", items, 24)
  return node("keyValue", { items, title: props.title, style: styleOf(props.style) })
}

/**
 * Rows of text, the list form the app draws natively.
 * @param items - the rows, at most 50.
 * @param props - an optional title and container style.
 * @returns the list node.
 */
export function list(items: readonly DshGoListItem[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("list", "items", items, 50)
  return node("list", { items, title: props.title, style: styleOf(props.style) })
}

/**
 * A progress bar.
 * @param value - the current value, in the same unit as `max`.
 * @param props - label, caption, maximum (100 by default), tone and text style.
 * @returns the progress node.
 */
export function progress(value: number | DshGoBinding, props: { label?: string; caption?: string; max?: number; tone?: DshGoTone; style?: DshGoStyle } = {}): DshGoView {
  return node("progress", { value, max: props.max, label: props.label, caption: props.caption, tone: props.tone, style: styleOf(props.style) })
}

/**
 * A notice.
 * @param value - the notice text, or a binding.
 * @param props - an optional semantic tone and text style.
 * @returns the callout node.
 */
export function callout(value: string | DshGoBinding, props: DshGoTextProps = {}): DshGoView {
  return node("callout", { text: value, tone: props.tone, style: styleOf(props.style) })
}

/**
 * A step sequence.
 * @param items - the steps, at most 12.
 * @param props - an optional title and container style.
 * @returns the steps node.
 */
export function steps(items: readonly DshGoStep[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("steps", "items", items, 12)
  return node("steps", { items, title: props.title, style: styleOf(props.style) })
}

/**
 * A row of buttons.
 * @param items - the buttons, at most 4.
 * @param props - an optional title and container style.
 * @returns the actions node.
 */
export function actions(items: readonly DshGoActionItem[], props: DshGoLayoutProps = {}): DshGoView {
  assertList("actions", "items", items, 4)
/** The action rows, with the primary flag spelled the way the app reads it. */
  const rendered = items.map((item) => ({
    label: item.label,
    action: item.action,
    icon: item.icon,
    ...(item.primary === true ? { style: "primary" } : {}),
  }))
  return node("actions", { items: rendered, title: props.title, style: styleOf(props.style) })
}

/** Assert a section list: every section needs a label and at least one child, so no tab is empty. */
function sections(builder: string, items: readonly DshGoSection[]): void {
  assertList(builder, "items", items, 24)
  if (items.length === 0) refuse(builder, "needs at least one section")
  for (const section of items) {
    if (section.label === undefined || section.label === "") refuse(builder, "needs every section to carry a label")
    assertList(builder, "section children", section.children, MAX_CHILDREN)
    if (section.children.length === 0) refuse(builder, "refuses an empty section — use emptyState as its only child")
  }
}

/**
 * Tabbed sections (`{ type: "tabs", items: [{ label, children }] }` — the app's shape).
 * @param items - the sections, at most 24, each with a label and at least one child.
 * @returns the tabs node.
 */
export function tabs(items: readonly DshGoSection[]): DshGoView {
  sections("tabs", items)
  return node("tabs", { items })
}

/**
 * A timeline of sections; the v1 fallback renders the same sections as steps.
 * @param items - the sections, at most 24, each with a label and at least one child.
 * @returns the timeline node.
 */
export function timeline(items: readonly DshGoSection[]): DshGoView {
  sections("timeline", items)
  return node("timeline", { items })
}

/**
 * A grid of equal cells; the app's grid takes its own `columns` prop, never a style key.
 * @param children - the cells, at most 32.
 * @param props - 1–4 equal columns (two turns metric tiles into a tile block) and an optional label.
 * @returns the grid node.
 */
export function grid(children: readonly DshGoView[], props: DshGoGridProps = {}): DshGoView {
  assertList("grid", "children", children, MAX_CHILDREN)
  rejectExtra("grid", props as unknown as Record<string, unknown>, ["columns", "label"])
  if (props.columns !== undefined) {
    if (![1, 2, 3, 4].includes(props.columns)) refuse("grid", "needs columns to be 1–4")
  }
  return node("grid", { children, columns: props.columns, label: props.label })
}

/**
 * A form: the input children plus the action its submit button fires.
 * @param props - the fields, at most 32, and the optional submit id and label.
 * @returns the form node.
 */
export function form(props: DshGoFormProps): DshGoView {
  assertList("form", "children", props.children, 32)
  return node("form", { children: props.children, submit: props.submit, submitLabel: props.submitLabel })
}

/**
 * A single-line text input (v2).
 * @param props - the required label and optional value, binding path and placeholder.
 * @returns the textField node.
 */
export function textField(props: DshGoInputProps): DshGoView {
  return node("textField", { label: props.label, value: props.value, bind: props.bind, placeholder: props.placeholder })
}

/**
 * A select input (v2).
 * @param props - the label, at most 24 options, and optional value and binding path.
 * @returns the select node.
 */
export function select(props: DshGoSelectProps): DshGoView {
  assertList("select", "options", props.options, 24)
  return node("select", { label: props.label, options: props.options, value: props.value, bind: props.bind })
}

/**
 * A toggle input (v2).
 * @param props - the required label and optional value and binding path.
 * @returns the toggle node.
 */
export function toggle(props: DshGoToggleProps): DshGoView {
  return node("toggle", { label: props.label, value: props.value, bind: props.bind })
}

/**
 * The app's designed empty look, never a blank tab.
 * @param props - the required title, one optional message, an icon and at most one button.
 * @returns the emptyState node.
 */
export function emptyState(props: DshGoEmptyStateProps): DshGoView {
/** The raw props, so a key the declared type omits still reaches the guard. */
  const fields = props as unknown as Record<string, unknown>
  if (fields.text !== undefined) refuse("emptyState", 'takes "message", never "text" (the app ignores text silently)')
  rejectExtra("emptyState", fields, ["title", "message", "icon", "action"])
  return node("emptyState", { title: props.title, message: props.message, icon: props.icon, action: props.action })
}

/**
 * An avatar picture (the app's image shape, so `src` is required).
 *
 * A pair of initials cannot be an avatar: the node is an IMAGE, and the app accepts only
 * `asset:<path>` or a `data:image/…` URL. Render initials as a `badge` and keep the avatar for a
 * real picture — the mismatch is loud here rather than a grey placeholder in the app.
 * @param props - the required source, plus alt text, a caption and an aspect ratio.
 * @returns the avatar node.
 */
export function avatar(props: DshGoAvatarProps): DshGoView {
/** The source string the app will read. */
  const src = String(props.src)
  if (!src.startsWith("asset:") && !src.startsWith("data:image/")) {
    refuse("avatar", "needs src to be asset:<path> or a data:image/… URL (the app accepts no other source)")
  }
  return node("avatar", { src, alt: props.alt })
}

/**
 * A status badge: a WORD plus its tone, never colour alone.
 * @param props - the required text and an optional tone.
 * @returns the badge node.
 */
export function badge(props: DshGoBadgeProps): DshGoView {
  return node("badge", { text: props.text, tone: props.tone })
}

/**
 * A tag — the same node as {@link badge}, kept as the design vocabulary's second spelling.
 * @param props - the required text and an optional tone.
 * @returns the tag node.
 */
export function tag(props: DshGoBadgeProps): DshGoView {
  return node("tag", { text: props.text, tone: props.tone })
}

/**
 * A horizontal rule between groups.
 *
 * The app's `divider` takes NO props at all (measured: `docs/plugins/inputs.md`), so this builder
 * has no parameter — an unknown prop would be silently ignored, which is the drift the visual
 * contract forbids.
 * @returns the divider node; it accepts no children by construction.
 */
export function divider(): DshGoView {
  return node("divider", {})
}

/**
 * Breathing room before an action row.
 *
 * NOTE THE DIFFERENT SCALE: a spacer's S / M / L is 8 / 16 / 24 dp — twice the steps of the
 * container `padding`/`gap` scale (8 / 12 / 16). They are two separate app scales, so do not read
 * one as the other.
 * @param props - the optional space the node reserves (S / M / L, 8/16/24 dp).
 * @returns the spacer node; it accepts no children by construction.
 */
export function spacer(props: { size?: DshGoSpacing } = {}): DshGoView {
  return node("spacer", { size: props.size })
}

/**
 * Count the component nodes of a view, the way the app counts them.
 * @param view - the tree to measure.
 * @returns the number of `{ type }` nodes reachable through `children` and `items[].children`.
 */
export function countViewNodes(view: DshGoView): number {
/** Running count of component nodes. */
  let nodes = 0
  for (const _found of componentNodes(view)) nodes += 1
  return nodes
}

/**
 * Measure the component nesting of a view, the way the app measures it.
 * @param view - the tree to measure.
 * @returns the deepest nesting, the root counting as 1 (0 when the tree has no node).
 */
export function viewDepth(view: DshGoView): number {
/** Deepest component nesting found so far. */
  let depth = 0
  for (const found of componentNodes(view)) depth = Math.max(depth, found.depth)
  return depth
}

/**
 * Measure a view in the app's three units.
 * @param view - the tree to measure.
 * @returns its JSON bytes, component-node count and component depth.
 */
export function measureView(view: DshGoView): DshGoMeasurement {
/** The view's JSON text, the unit the app's byte budget uses. */
  const encoded = JSON.stringify(view)
/** UTF-8 size of that text; 0 for a tree with no JSON form. */
  const bytes = encoded === undefined ? 0 : new TextEncoder().encode(encoded).length
  return { bytes, nodes: countViewNodes(view), depth: viewDepth(view) }
}

/**
 * Whether a view fits one budget.
 * @param view - the tree to test.
 * @param budget - a budget name from {@link BUDGETS} or a budget object.
 * @returns true when bytes, nodes AND depth are all within it.
 */
export function fitsBudget(view: DshGoView, budget: DshGoBudgetName | DshGoBudget): boolean {
/** The budget the caller named, or the one they passed. */
  const target = typeof budget === "string" ? BUDGETS[budget] : budget
/** The view's own numbers, measured once. */
  const measured = measureView(view)
  return measured.bytes <= target.bytes && measured.nodes <= target.nodes && measured.depth <= target.depth
}

/** One design finding: where it is, which §7.2 ban it broke, and what to write instead. */
export interface DshGoFinding {
  /** A JSON-path-like pointer into the view (for example `view.children[0].style.color`). */
  readonly path: string
  /** The rule id, stable enough to grep a report for. */
  readonly rule: string
  /** One line naming the offending value and the legal alternative. */
  readonly message: string
}

/** The app's named palette; a panel must not use these — `tone` and `accent: "app"` are the levers. */
const NAMED_COLOURS: readonly string[] = Object.freeze([
  "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink", "gray",
])

/** A six-digit sRGB literal: the app accepts it, but it does not follow the user's theme. */
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/

/** The keys whose value the app reads as a colour. */
const COLOUR_KEYS: readonly string[] = Object.freeze(["accent", "color", "background"])

/** Style keys the app does not execute; writing one is a silent no-op the checker only notes. */
const BANNED_STYLE_KEYS: readonly string[] = Object.freeze([
  "radius", "borderRadius", "position", "left", "right", "top", "bottom", "width", "height",
  "fontSize", "lineHeight", "fontFamily", "opacity", "gradient", "transform", "zIndex", "elevation", "shadow",
])

/** The container spacing steps the app executes. */
const SPACING_STEPS: readonly string[] = Object.freeze(["S", "M", "L"])

/** The components that carry data, exactly the set contract §7.3 enumerates. */
const DATA_COMPONENTS: readonly string[] = Object.freeze([
  "metric", "table", "keyValue", "list", "chart", "progress", "steps", "compare", "timeline", "options", "codeBlock", "gallery", "image",
])

/** True for a value carrying the BINDING SHAPE (a `$` key), whatever else it also carries. */
function looksBound(value: unknown): boolean {
  return isRecord(value) && typeof value.$ === "string"
}

/** Every component node of a subtree (children and section children), depth first. */
function* subtreeNodes(value: unknown): Generator<DshGoView> {
  if (Array.isArray(value)) {
    for (const child of value) yield* subtreeNodes(child)
    return
  }
  if (!isNode(value)) return
  yield value
  for (const child of childrenOf(value)) yield* subtreeNodes(child)
}

/** True when a node carries the design's HERO material. */
function isTintedHero(node: DshGoView): boolean {
  return isRecord(node.style) && node.style.card === "tinted"
}

/** The first tabbed container of a tree, or null when the view is not organised in tabs. */
function firstTabs(view: DshGoView): DshGoView | null {
  for (const node of subtreeNodes(view)) {
    if (node.type === "tabs" && Array.isArray(node.items)) return node
  }
  return null
}

/** True when a badge's or row's text carries a word (a binding counts: the word arrives at render). */
function hasWord(value: unknown): boolean {
  if (typeof value === "string") return value.trim() !== ""
  return isBinding(value)
}

/** Lint one `style` object against the closed set the app executes. */
function lintStyle(style: Record<string, unknown>, path: string, findings: DshGoFinding[]): void {
  for (const key of Object.keys(style)) {
    /** This token's own path in the report. */
    const at = `${path}.${key}`
    /** The token's value, read as unknown because a view is open JSON. */
    const value = style[key]
    if (key === "color" && value !== "accent") {
      findings.push({ path: at, rule: "style-colour", message: 'style.color takes only "accent"; use the node prop tone for muted and warning text' })
    }
    if ((key === "padding" || key === "gap") && (typeof value !== "string" || !SPACING_STEPS.includes(value))) {
      findings.push({ path: at, rule: "style-spacing", message: "spacing is S / M / L only; a numeric size is not executed" })
    }
    if (key === "size" && typeof value === "number") {
      findings.push({ path: at, rule: "size-numeric", message: "sizes are named steps (title / body / …), never numbers" })
    }
    if (BANNED_STYLE_KEYS.includes(key)) {
      findings.push({ path: at, rule: "style-decoration", message: `"${key}" is the app's to decide (radius, size, opacity, gradient, shadow, positioning)` })
    }
  }
}

/**
 * Lint a view against the §7.2 design contract.
 *
 * The app checker is NECESSARY BUT NOT SUFFICIENT: it exits 0 while a view carries numeric padding,
 * a named colour or two `style:"primary"` actions, because those degrade instead of failing. This
 * function is the static gate the panel lanes and `scripts/verify-dshgo-views.ts` run.
 *
 * TWO MODES:
 *   version 2 (default) — a PANEL tree: the bans (hex colours anywhere, named palette colours under
 *     a colour key, numeric spacing/sizes, the reserved decoration keys, more than one primary
 *     action, `tabs` written as `children`, `emptyState` written as `text`, a `grid` carrying a
 *     container style, an `avatar` without `src`, a badge/tag with no word) PLUS the positive rules:
 *     exactly one `tinted` hero per tab (per tree when the view is not tabbed), every `metric`
 *     inside a `grid`, a data-less tab carrying an `emptyState`, and long or bound `text` setting
 *     `maxLines`.
 *   version 1 — a STATIC FALLBACK (decoration already stripped, so the colour and spacing bans are
 *     vacuous): no v2-only component survives, no `style`/`accent` key survives, and every `text`
 *     carries non-empty words.
 * @param view - the tree to lint.
 * @param options - `version: 1` for the static-fallback mode, `version: 2` (default) for a panel.
 * @returns every finding, in tree order; an empty array means the contract holds.
 */
export function lintDesign(view: DshGoView, options: { version?: 1 | 2 } = {}): DshGoFinding[] {
  if ((options.version ?? 2) === 1) return lintV1(view)
  /** Everything found so far. */
  const findings: DshGoFinding[] = []
  /** How many buttons claim the single primary slot. */
  let primaries = 0
  /** Walk one value, reporting the bans that apply at its own path. */
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }
    if (!isRecord(value)) return
    /** Whether this object IS a `style` object, whose tokens `lintStyle` reports precisely. */
    const insideStyle = path.endsWith(".style")
    if (!insideStyle) {
      for (const [key, child] of Object.entries(value)) {
        /** This field's own path in the report. */
        const at = `${path}.${key}`
        if (typeof child === "string" && HEX_COLOUR.test(child)) {
          findings.push({ path: at, rule: "colour-hex", message: 'a #RRGGBB value does not follow the theme; use a tone or accent "app"' })
        } else if (typeof child === "string" && COLOUR_KEYS.includes(key) && NAMED_COLOURS.includes(child)) {
          findings.push({ path: at, rule: "colour-named", message: `the named colour "${child}" does not follow the user's theme; use a tone or accent "app"` })
        } else if (key === "size" && typeof child === "number") {
          findings.push({ path: at, rule: "size-numeric", message: "sizes are named steps (title / body / …), never numbers" })
        }
      }
    }
    if (value.type === "tabs" && value.children !== undefined) {
      findings.push({ path: `${path}.children`, rule: "tabs-children", message: "tabs declare sections as items: [{ label, children }], never children" })
    }
    if (value.type === "emptyState" && value.text !== undefined) {
      findings.push({ path: `${path}.text`, rule: "emptyState-text", message: "emptyState takes message; text is silently ignored by the app" })
    }
    if (value.type === "grid" && value.style !== undefined) {
      findings.push({ path: `${path}.style`, rule: "grid-style", message: "container style is stack/row only; a grid takes its own columns (1–4)" })
    }
    if (value.type === "avatar" && value.src === undefined) {
      findings.push({ path, rule: "avatar-src", message: "avatar is the image node and needs src (asset:<path> or a data:image/… URL)" })
    }
    if ((value.type === "badge" || value.type === "tag") && !hasWord(value.text)) {
      findings.push({ path, rule: "status-word", message: "status is never colour-only: the badge must carry a word" })
    }
    if (isRecord(value.style)) lintStyle(value.style, `${path}.style`, findings)
    if (value.type === "actions" && Array.isArray(value.items)) {
      for (const item of value.items) if (isRecord(item) && item.style === "primary") primaries += 1
    }
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "object" && child !== null) visit(child, `${path}.${key}`)
    }
  }
  visit(view, "view")
  if (primaries > 1) {
    findings.push({ path: "view", rule: "primary-count", message: `${primaries} actions claim style "primary"; the app downgrades all but one (contract §7.2 rule 8)` })
  }
  lintPositive(view, findings)
  return findings
}

/** The positive §7.2 rules (version 2 only): a hero, tiled metrics, designed empty tabs, bounded text. */
function lintPositive(view: DshGoView, findings: DshGoFinding[]): void {
  /** Walk one component node with its parent's type and its own path. */
  const walk = (node: DshGoView, parent: string | null, path: string): void => {
    if (node.type === "metric" && parent !== "grid") {
      findings.push({ path, rule: "metric-parent", message: "metrics live in a v2 grid, never loose in a stack or row (contract §7.2 rule 4)" })
    }
    if (node.type === "text") {
      /** The node's words: a literal string or a data binding. */
      const body = node.text
      /** Whether the text declares a line bound. */
      const bounded = isRecord(node.style) && typeof node.style.maxLines === "number"
      if (!bounded && ((typeof body === "string" && body.length > 120) || looksBound(body))) {
        findings.push({ path, rule: "text-maxlines", message: "free text that can run long (over 120 chars or bound) must set style.maxLines (contract §7.2 rule 9)" })
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => { if (isNode(child)) walk(child, String(node.type), `${path}.children[${index}]`) })
    }
    if (Array.isArray(node.items)) {
      node.items.forEach((item, index) => {
        if (!isRecord(item) || !Array.isArray(item.children)) return
        item.children.forEach((child, childIndex) => { if (isNode(child)) walk(child, String(node.type), `${path}.items[${index}].children[${childIndex}]`) })
      })
    }
  }
  walk(view, null, "view")
  /** The tabbed container that owns the design, when the panel is organised in tabs. */
  const tabs = firstTabs(view)
  if (tabs === null) {
    /** Every tinted node in a non-tabbed panel. */
    const heroes = [...subtreeNodes(view)].filter(isTintedHero).length
    if (heroes !== 1) {
      findings.push({ path: "view", rule: "hero-count", message: `a panel has exactly one "tinted" hero; found ${heroes} (contract §7.2 rule 2)` })
    }
    return
  }
  /** The tabbed container's sections. */
  const sections = Array.isArray(tabs.items) ? tabs.items : []
  sections.forEach((section, index) => {
    /** Every component node inside this tab. */
    const nodes = isRecord(section) ? [...subtreeNodes(section.children)] : []
    /** How many tinted heroes the tab carries. */
    const heroes = nodes.filter(isTintedHero).length
    if (heroes !== 1) {
      findings.push({ path: `view.items[${index}]`, rule: "hero-count", message: `each tab has exactly one "tinted" hero; found ${heroes} (contract §7.2 rule 2)` })
    }
    /** A binding anywhere in the tab means data arrives at render time, so the lint cannot judge it. */
    const bound = isRecord(section) && hasBinding(section)
    if (!bound && !nodes.some((node) => DATA_COMPONENTS.includes(String(node.type))) && !nodes.some((node) => node.type === "emptyState")) {
      findings.push({ path: `view.items[${index}]`, rule: "empty-tab", message: "a tab with no data-bearing child is a designed emptyState, never a blank tab (contract §7.2 rule 7)" })
    }
  })
}

/** The version-1 (static fallback) assertions: v1 components, no decoration, real words. */
function lintV1(view: DshGoView): DshGoFinding[] {
  /** Everything found so far. */
  const findings: DshGoFinding[] = []
  /** Walk one value, reporting the fallback contract at its own path. */
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`))
      return
    }
    if (!isRecord(value)) return
    for (const [key, child] of Object.entries(value)) {
      /** This field's own path in the report. */
      const at = `${path}.${key}`
      if (key === "style" || key === "accent") {
        findings.push({ path: at, rule: "v1-decoration", message: "the v1 fallback carries no style and no accent" })
      } else if (typeof child === "object" && child !== null) {
        visit(child, at)
      }
    }
    if (typeof value.type !== "string") return
    if (V2_ONLY_COMPONENTS.includes(value.type)) {
      findings.push({ path, rule: "v1-component", message: `"${value.type}" is a v2-only component; the fallback must stay v1` })
    } else if (!V1_COMPONENTS.includes(value.type)) {
      findings.push({ path, rule: "v1-unknown-component", message: `"${value.type}" is not a v1 component` })
    }
    if (value.type === "text" && (typeof value.text !== "string" || value.text.trim() === "")) {
      findings.push({ path, rule: "v1-text", message: "every v1 text carries non-empty words" })
    }
  }
  visit(view, "view")
  return findings
}

/** Round-trip a value through JSON, dropping what has no JSON form (functions, cycles, BigInt). */
function losslessJson(value: unknown): unknown {
  try {
/** The value's JSON text, or undefined when it has no JSON form. */
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : JSON.parse(encoded)
  } catch {
    return undefined
  }
}

/** True when any value in the tree is a `{ "$": … }` binding. */
function hasBinding(value: unknown): boolean {
  if (isBinding(value)) return true
  if (Array.isArray(value)) return value.some(hasBinding)
  if (isRecord(value)) return Object.values(value).some(hasBinding)
  return false
}

/** True when any component node in the tree carries a v2-only name. */
function hasV2Component(value: unknown): boolean {
  for (const found of componentNodes(value)) {
    if ((V2_ONLY_COMPONENTS as readonly string[]).includes(found.node.type as string)) return true
  }
  return false
}

/**
 * Wrap a view builder for a tool's `output.presentationMeta`.
 *
 * NEVER throws and never ships a card the app cannot draw: a builder error, a non-JSON value, a v2
 * root, a v2-only component, a data binding (a card has no data model), a panel accent (cards are
 * v1 and carry none) or a view over 8 KiB / 40 nodes / depth 6 all degrade to `{}` — the app then
 * renders its generic tool row. On success the card is `{ "dsh-go/view": view }`.
 * @param build - the builder, receiving the tool arguments and the tool's value.
 * @returns the `presentationMeta` function the tool definition carries.
 */
export function toolCard<A, V>(build: (args: A, value: V) => DshGoView | null | undefined): (args: A, value: V) => Record<string, unknown> {
  return (args: A, value: V): Record<string, unknown> => {
    try {
/** The builder's value, round-tripped through JSON. */
      const built = losslessJson(build(args, value))
      if (!isNode(built)) return {}
/** The view after the JSON round trip, which also drops functions and undefined. */
      const view = built
      if (view.accent !== undefined) return {}
      if (view.v === 2 || hasV2Component(view)) return {}
      if (hasBinding(view)) return {}
      if (!fitsBudget(view, "toolCard")) return {}
      return { [VIEW_KEY]: view }
    } catch {
      return {}
    }
  }
}

/** Whether the app reports at least the given version; an unknown version reads as older. */
function appAtLeast(app: unknown, minimum: string): boolean {
  if (typeof app !== "string") return false
/** A leading `major.minor.patch`; anything after it is not read. */
  const pattern = /^(\d+)\.(\d+)\.(\d+)/
/** The app's own three numbers. */
  const have = pattern.exec(app)
/** The floor's three numbers. */
  const want = pattern.exec(minimum)
  if (have === null || want === null) return false
  for (let part = 1; part <= 3; part += 1) {
/** The app's component at this position. */
    const mine = Number(have[part])
/** The floor's component at this position. */
    const target = Number(want[part])
    if (mine !== target) return mine > target
  }
  return true
}

/** Remove every `style` and `accent` key from a tree, returning new objects (the input is untouched). */
function stripDecoration(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDecoration)
  if (!isRecord(value)) return value
/** The copy without decoration; the input object is untouched. */
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === "style" || key === "accent") continue
    out[key] = stripDecoration(child)
  }
  return out
}

/** The words a node carries, for a list row that replaces it in the v1 fallback. */
function wordsOf(value: unknown): string | number {
  if (typeof value === "string" || typeof value === "number") return value
  if (!isRecord(value)) return ""
  for (const key of ["text", "label", "title", "alt", "caption", "value", "src", "type"]) {
/** A field that may carry the node's words. */
    const candidate = value[key]
    if (typeof candidate === "string" || typeof candidate === "number") return candidate
  }
  return ""
}

/** A label/value pair's value as v1 text, keeping a binding intact (the list row must keep it). */
function valueText(value: unknown): string | number | DshGoBinding {
  if (isBinding(value)) return value
  return wordsOf({ text: value })
}

/** The v1 stand-in for one v2 node: a replacement tree, or null when the node simply disappears. */
function fallbackFor(node: DshGoView, visit: (value: unknown) => DshGoView | null): DshGoView | null {
/** The component name this stand-in is chosen for. */
  const type = node.type
  if (type === "tabs" || type === "accordion" || type === "carousel") {
    /** The sections this container declares. */
    const entries = Array.isArray(node.items) ? node.items : []
    /** The stand-in stack's children, heading included. */
    const children: DshGoView[] = []
    for (const entry of entries) {
      if (!isRecord(entry)) continue
      /** One section's own children, already downgraded. */
      const kids: DshGoView[] = []
      if (Array.isArray(entry.children)) {
        for (const child of entry.children) {
          /** One section child, already downgraded. */
          const adapted = visit(child)
          if (adapted !== null) kids.push(adapted)
        }
      }
      // The label is the section heading; a first child that already carries the same words must
      // not print it a second time (measured on a kit-built §7 panel).
      /** The first child, which may already print the section label. */
      const first = kids[0]
      if (typeof entry.label === "string" && isRecord(first)) {
        if (first.type === "text" && first.text === entry.label) kids.shift()
        else if (first.title === entry.label) {
          /** A copy of that child with the duplicated heading removed. */
          const withoutTitle = { ...first }
          delete withoutTitle.title
          kids[0] = withoutTitle
        }
      }
      if (entry.label !== undefined) children.push({ type: "text", text: entry.label })
      children.push(...kids)
    }
    return { type: "stack", children }
  }
  if (type === "form" || type === "collapsible") {
/** The stack's children: every child that survives the downgrade. */
    const children: DshGoView[] = []
    for (const child of Array.isArray(node.children) ? node.children : []) {
/** One child, already downgraded. */
      const adapted = visit(child)
      if (adapted !== null) children.push(adapted)
    }
    return { type: "stack", children }
  }
  if (type === "grid") {
    /** The list rows that replace the grid's cells. */
    const items: Record<string, unknown>[] = []
    for (const child of Array.isArray(node.children) ? node.children : []) {
      /** One cell, already downgraded. */
      const adapted = visit(child)
      if (adapted === null) continue
      if (adapted.type === "metric") {
        /** A metric row: the label as the title, the NUMBER as the trailing value (rule 10). */
        const row: Record<string, unknown> = { title: adapted.label, trailing: valueText(adapted.value) }
        if (adapted.caption !== undefined) row.subtitle = adapted.caption
        items.push(row)
        continue
      }
      /** The words that become the row's title. */
      const title = wordsOf(adapted)
      /** A subtitle, when the downgraded cell carries one. */
      const subtitle = isRecord(adapted) && adapted.subtitle !== undefined ? adapted.subtitle : undefined
      items.push(subtitle === undefined ? { title } : { title, subtitle })
    }
    return { type: "list", items }
  }
  if (type === "timeline") {
/** The steps that replace the timeline's entries. */
    const items: Record<string, unknown>[] = []
    for (const entry of Array.isArray(node.items) ? node.items : []) {
      if (!isRecord(entry)) continue
/** The entry's child text, joined into the step's detail. */
      const words: string[] = []
      for (const child of Array.isArray(entry.children) ? entry.children : []) {
/** One entry child, already downgraded. */
        const adapted = visit(child)
        if (adapted === null) continue
/** That child's words, if it has any. */
        const text = String(wordsOf(adapted))
        if (text !== "") words.push(text)
      }
      items.push(words.length === 0 ? { label: String(wordsOf(entry)) } : { label: String(wordsOf(entry)), detail: words.join(" · ") })
    }
    return { type: "steps", items }
  }
  if (type === "badge" || type === "tag") return { type: "text", text: node.text }
  if (type === "avatar") return { type: "text", text: node.alt ?? node.caption ?? node.src }
  if (type === "emptyState") {
/** The copy that survives: the title, then the message when present. */
    const parts = [node.title, node.message].filter((part) => part !== undefined && part !== "").map((part) => String(part))
    return { type: "text", text: parts.join("\n") }
  }
  if (type === "codeBlock") return { type: "text", text: node.code }
  if (type === "textField" || type === "number" || type === "stepper" || type === "toggle" || type === "slider"
    || type === "select" || type === "segmented" || type === "chips" || type === "date" || type === "time" || type === "rating") {
/** The input's label text. */
    const label = wordsOf({ text: node.label })
/** The input's current value as text; empty when unset. */
    const value = node.value === undefined ? "" : String(wordsOf({ text: node.value }))
    return { type: "text", text: value === "" ? String(label) : `${String(label)}: ${value}` }
  }
  if (type === "gallery") {
/** The pictures the gallery's items become. */
    const children: DshGoView[] = []
    for (const entry of Array.isArray(node.items) ? node.items : []) {
      if (!isRecord(entry) || entry.src === undefined) continue
      children.push({ type: "image", src: entry.src, alt: entry.alt, caption: entry.caption })
    }
    return { type: "stack", children }
  }
  return null
}

/**
 * Downgrade a v2 view for the app on the other end.
 *
 * When `caps.app` is below 1.0.9 (or unknown, matching the SDK's own `appAtLeast`), the WHOLE tree
 * becomes v1: every v2 component is replaced by its older stand-in, every `style`/`accent` key is
 * removed and the root `v` becomes 1. When the app does speak v2 but its `caps.components` list
 * omits a name, only that component is replaced and styles are kept. Idempotent in both paths.
 * @param view - the tree to adapt; it is never mutated.
 * @param caps - what the app reports, or null when it told us nothing.
 * @returns a new tree the app can draw.
 */
export function adaptView(view: DshGoView, caps: DshGoCaps | null | undefined): DshGoView {
/** Whether the app speaks view v2 at all; an unknown version reads as older. */
  const v2 = appAtLeast(caps?.app, "1.0.9")
/** The app's component list, when it sent one. */
  const components = Array.isArray(caps?.components) ? caps.components : undefined
/** Whether this app draws one component name. */
  const draws = (type: unknown): boolean => {
    if (typeof type !== "string" || !FALLBACK_COMPONENTS.includes(type)) return true
    if (!v2) return false
    return components === undefined || components.includes(type)
  }
/** Downgrade one node without mutating it; null drops the node. */
  const visit = (value: unknown): DshGoView | null => {
    if (!isNode(value)) return null
/** The node as it will be emitted, before its children are visited. */
    let current: DshGoView = value
    if (!draws(current.type)) {
/** The stand-in for a component this app cannot draw. */
      const replaced = fallbackFor(current, visit)
      if (replaced === null) return null
      if (current.title !== undefined && replaced.title === undefined) replaced.title = current.title
      current = replaced
    }
/** A copy, so neither the input nor a stand-in is mutated. */
    const next: DshGoView = { ...current }
    if (Array.isArray(current.children)) {
      next.children = current.children.map(visit).filter((child): child is DshGoView => child !== null)
    }
    if (Array.isArray(current.items)) {
      next.items = current.items.map((item) => {
        if (!isRecord(item) || !Array.isArray(item.children)) return item
        return { ...item, children: item.children.map(visit).filter((child): child is DshGoView => child !== null) }
      })
    }
    return next
  }
/** The whole tree after the walk; null only when the root itself drops. */
  const adapted = visit(view)
  if (adapted === null) return v2 ? view : { type: "text", text: "" }
  if (v2) return adapted
/** The v1 tree: every style and accent removed. */
  const stripped = stripDecoration(adapted) as DshGoView
  return { ...stripped, v: 1 }
}

