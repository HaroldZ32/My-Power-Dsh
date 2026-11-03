// THE TWO NATIVE PANELS' VIEW TREES, BUILT FROM THE KIT AND THE §7 VISUAL CONTRACT.
//
// WHY A SEPARATE MODULE: a panel's READ model (services, files, service probes) and its PRESENTATION are
// different concerns with different failure modes. This file is pure — it takes an already-read model
// and returns a view tree — so the design can be linted, measured and unit-tested without a service
// registry, and the readers in `dshgo-panel.ts` / `dshgo-team-panel.ts` never build JSON by hand.
//
// THE DESIGN RULES ARE THE KIT'S, NOT THIS FILE'S. Every node goes through a kit builder, the root is
// `panelView()` (which writes `v: 2` and `accent: "app"`), and each tab carries exactly ONE `tinted`
// hero, a `surface` section for its data, tiled metrics inside a `grid`, a designed empty state, and at
// most one `primary` action. `adaptView` produces the v1 fallback, so every caller gets both trees from
// ONE function and the fallback cannot drift from the v2 tree it was derived from.
import {
  actions,
  adaptView,
  badge,
  bind,
  callout,
  chart,
  divider,
  emptyState,
  form,
  grid,
  keyValue,
  list,
  metric,
  panelView,
  progress,
  row,
  spacer,
  stack,
  steps,
  tabs,
  text,
  textField,
  type DshGoCaps,
  type DshGoListItem,
  type DshGoTone,
  type DshGoView,
} from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import { copyFor, type DshGoCopy } from "./dshgo-copy.ts"
import { graphLinesOf, graphNeedsFold, graphStepsOf, layerGraphOf } from "./dshgo-graph.ts"
import type { PanelSnapshot } from "./dshgo-panel.ts"

/** One task row of the team board, as the team panel renders it. */
export interface TeamPanelTask {
  /** The board row id (`T1`, `T2`, …); the selection action carries it. */
  readonly id: string
  /** The task's subject line, already clipped for display. */
  readonly subject: string
  /** The member the row is paired with, or an empty string when nobody owns it. */
  readonly owner: string
  /** The row's status word (`pending`, `in_progress`, `completed`, …). */
  readonly status: string
  /** The row's kind (`work`, `review`, `repair`, …). */
  readonly kind: string
  /** How many rows block this one. */
  readonly blockedBy: number
  /** The task's acceptance text, clipped to a bounded number of characters. */
  readonly description: string
  /** The ids that block this row, joined for display; empty when it is a root. */
  readonly dependencies: string
  /** The recorded verdict (`PASS`, `FAIL`), or an empty string when none was recorded. */
  readonly verdict: string
}

/** One member of the team, as the members tab renders it. */
export interface TeamPanelMember {
  /** The member's board name. */
  readonly name: string
  /** The member's live mode or seat state (`running`, `idle`, `handoff`, …). */
  readonly mode: string
  /** The handoff state when the member is in its handoff window; empty otherwise. */
  readonly handoff: string
}

/** The watchdog's contribution to the team panel: the predicate in force, the hold and the incidents. */
export interface TeamWatchdogSnapshot {
  /** The predicate the watchdog is running (`channel`, `heartbeat`, or `absent`). */
  readonly predicate: string
  /** Whether a preserving hold is recorded for this team. */
  readonly held: boolean
  /** The hold's recorded reason, or an empty string when the team is not held. */
  readonly reason: string
  /** The task whose silence raised the hold, or an empty string when none was named. */
  readonly taskId: string
  /** The most recent incidents, newest first, already clipped to five. */
  readonly incidents: ReadonlyArray<{ readonly at: string; readonly kind: string; readonly detail: string }>
}

/** Everything the `mpd-team` panel renders, in one narrowed shape: ids, names, counts and no paths. */
export interface TeamPanelSnapshot {
  /** The active team's identity, or null when this conversation owns none. */
  readonly team: { readonly id: string; readonly name: string; readonly status: string; readonly phase: string } | null
  /** The board's rows, capped at the app's fifty-row table/list limit. */
  readonly tasks: readonly TeamPanelTask[]
  /** Derived counters the hero tiles read. */
  readonly counts: { readonly total: number; readonly done: number; readonly active: number; readonly blocked: number; readonly completion: number }
  /** The roster, capped at {@link TEAM_PANEL_MAX_MEMBERS}. */
  readonly members: readonly TeamPanelMember[]
  /** The task the detail tab shows, or null when the board is empty. */
  readonly selected: TeamPanelTask | null
  /** The watchdog state for this team. */
  readonly watchdog: TeamWatchdogSnapshot
}

/** How many member rows the members tab draws; each row is six nodes, so the panel budget caps it. */
export const TEAM_PANEL_MAX_MEMBERS = 6

/** How many incident rows the watchdog tab draws. */
export const TEAM_PANEL_MAX_INCIDENTS = 5

/** One tab's worth of children, so a section list can be assembled in reading order. */
type TabChildren = readonly DshGoView[]

/**
 * The v2 COLLAPSIBLE node: one labelled fold around the children.
 *
 * The kit has no builder for it (its vocabulary stops at the panel components it can validate), so the
 * two nodes this file hand-rolls are the v2 fold and the v2 code block — both verified against the app's
 * own parser (`dsh_ui_plugin_controls_model.dart`: `collapsible` reads `label` + `children`, `codeBlock`
 * reads `code` + `language`). `adaptView` degrades both, so a tree built for v2 stays legal for an app
 * that turns out not to speak it.
 * @param label - the fold's header text.
 * @param children - the content revealed when the fold is open.
 * @returns the collapsible node.
 */
function fold(label: string, children: readonly DshGoView[]): DshGoView {
  return { type: "collapsible", label, children }
}

/**
 * The v2 MONOSPACE block: the graph's lines, rendered in the app's code style.
 *
 * NO `language`, deliberately: the app always draws the block's header strip, and the language text sits
 * at its content edge — so `language: "text"` rendered a pointless "text" chip beside the Copy control.
 * The field is optional, and omitting it leaves the strip with just the copy affordance.
 * @param code - the text to render, one line per row.
 * @returns the codeBlock node.
 */
function codeBlock(code: string): DshGoView {
  return { type: "codeBlock", code }
}

/**
 * Whether the app on the other end speaks view v2 (the same floor `adaptView` uses).
 * @param caps - what the app reported, or nothing when it reported nothing.
 * @returns true only for 1.0.9 and up; an unknown version reads as older.
 */
function speaksV2(caps: DshGoCaps | null | undefined): boolean {
  if (typeof caps?.app !== "string") return false
  /** The version's numeric parts, missing ones reading as 0. */
  const [major = 0, minor = 0, patch = 0] = caps.app.split(".").map((part) => Number.parseInt(part, 10) || 0)
  return major > 1 || (major === 1 && (minor > 0 || patch >= 9))
}

/**
 * The hero card every tab opens with: a `tinted` material carrying the tab's title, caption and tiles.
 * @param title - the tab's own title, at the app's title size and bold weight.
 * @param caption - one line of supporting text, muted and clipped to one line.
 * @param extras - the metric grid and progress the tab wants under its caption.
 * @returns the `tinted` hero stack; exactly one of these exists per tab.
 */
function hero(title: string, caption: string, extras: readonly DshGoView[] = []): DshGoView {
  return stack(
    [
      text(title, { style: { size: "title", weight: "bold", maxLines: 1 } }),
      text(caption, { tone: "muted", style: { size: "caption", maxLines: 1 } }),
      ...extras,
    ],
    { style: { card: "tinted", padding: "M", gap: "S" } },
  )
}

/**
 * A `surface` section: a header line, a rule and the content the caller passes.
 * @param title - the group header, at subtitle size and semibold weight.
 * @param children - the group's content; at least one node, usually a list, a table or an empty state.
 * @returns the surface stack.
 */
function section(title: string, children: TabChildren): DshGoView {
  return stack(
    [text(title, { style: { size: "subtitle", weight: "semibold", maxLines: 1 } }), divider(), ...children],
    { style: { card: "surface", padding: "M", gap: "S" } },
  )
}

/**
 * The metric tiles of a tab, always inside a v2 grid (§7.2 rule 4).
 * @param entries - the label/value pairs, in reading order.
 * @param columns - the grid's own column count, 1–4.
 * @returns the grid node.
 */
function tiles(entries: ReadonlyArray<{ label: string; value: string | number | { $: string }; tone?: DshGoTone }>, columns: 1 | 2 | 3 | 4): DshGoView {
  return grid(entries.map((entry) => metric({ label: entry.label, value: entry.value, ...(entry.tone === undefined ? {} : { tone: entry.tone }) })), { columns })
}

/**
 * A designed empty state, never a blank tab (§7.2 rule 7).
 * @param copy - the two-line copy: a short title and one sentence, in the app's language.
 * @returns the emptyState node.
 */
function empty(copy: readonly [string, string]): DshGoView {
  return emptyState({ title: copy[0], message: copy[1] })
}

/**
 * A board row's list entry, carrying the action that selects it.
 * @param task - the task the row renders.
 * @returns the list item the app draws, with a chevron because it is tappable.
 */
function taskRow(task: TeamPanelTask): { title: string; subtitle: string; trailing: string; action: { id: string; args: { task: string } } } {
  return {
    title: task.id + " " + task.subject,
    // DENSER ROW (repair T12): the kind left the subtitle (the Detail tab carries it) and the status
    // became a short word, so the subject keeps the width the trailing column used to take.
    subtitle: [task.owner === "" ? "—" : task.owner, task.blockedBy === 0 ? "" : "blocked " + String(task.blockedBy)].filter((part) => part !== "").join(" · "),
    trailing: statusWordOf(task.status),
    action: { id: "select", args: { task: task.id } },
  }
}

/**
 * The per-member work chart: one bar per member, the board rows they own.
 *
 * BORROWED FROM THE APP'S OWN EXAMPLES (`examples/plugins/<name>/lib/view.js`): a `chart` sits right after the
 * hero numbers, carries a `caption` saying what it counts, and keeps to a couple of series. Here it is one
 * bar series over the roster, which is what makes a lopsided board visible at a glance.
 * @param snapshot - the team snapshot (its roster and its tasks).
 * @param copy - the copy record for the app's language.
 * @returns the chart node, or null when the team has no members to chart.
 */
function memberChartOf(snapshot: TeamPanelSnapshot, copy: DshGoCopy): DshGoView | null {
  if (snapshot.members.length === 0) return null
  /** How many board rows each member owns, in roster order. */
  const values = snapshot.members.map((member) => snapshot.tasks.filter((task) => task.owner === member.name).length)
  return chart({
    kind: "bar",
    categories: snapshot.members.map((member) => member.name),
    series: [{ name: copy.memberChartSeries, values }],
    caption: copy.memberChartCaption,
  })
}

/**
 * The compact status word a board row's trailing column shows.
 *
 * At phone width the trailing column competes with the subject for the same pixels: `in_progress` alone
 * cost the title about eight characters, so the machine words are spelled as the short human ones and
 * anything unknown is clipped to the same budget.
 * @param status - the board row's raw status.
 * @returns a word of at most eight characters.
 */
function statusWordOf(status: string): string {
  /** The status, lower-cased so the mapping is spelling-insensitive. */
  const word = status.toLowerCase()
  if (word === "in_progress" || word === "running" || word === "active") return "active"
  if (word === "completed" || word === "done") return "done"
  if (word === "pending") return "todo"
  if (word === "cancelled") return "cancelled"
  return word.length <= 8 ? word : word.slice(0, 8)
}

/**
 * The initials a member badge carries: at most two words, upper-cased.
 * @param name - the member's board name.

 * @returns the badge's word, never empty (an unnamed seat falls back to `?`).
 */
function initialsOf(name: string): string {
  /** The name's words, with the punctuation the roster's names may carry. */
  const words = name.split(/[^A-Za-z0-9\u4e00-\u9fff]+/).filter((word) => word !== "")
  if (words.length === 0) return "?"
  /** The first letter of the first two words, upper-cased. */
  const letters = words.slice(0, 2).map((word) => word.slice(0, 1).toUpperCase()).join("")
  return letters === "" ? "?" : letters
}

/**
 * A tone for a status word, so a badge's colour carries the same meaning as its text.
 * @param status - the raw status or mode string.
 * @returns the semantic tone the badge should use.
 */
function toneOf(status: string): DshGoTone {
  /** The status, lower-cased so the comparisons are spelling-insensitive. */
  const word = status.toLowerCase()
  if (word === "done" || word === "completed" || word === "passed" || word === "idle") return "good"
  if (word === "failed" || word === "fence" || word === "fenced" || word === "blocked") return "bad"
  if (word === "in_progress" || word === "running" || word === "active" || word === "handoff") return "info"
  if (word === "pending" || word === "staged") return "warn"
  return "muted"
}

/**
 * Build the `mpd` panel: four v2 tabs over the workbench snapshot, adapted for the app on the other end.
 * @param snapshot - the live read of the team, plan, question, workmates and memory.
 * @param caps - what the app can draw; absent reads as an older app and yields the v1 fallback.
 * @returns the complete view tree the bridge renders.
 */
export function buildMpdView(snapshot: PanelSnapshot, caps?: DshGoCaps | null): DshGoView {
  /** The copy record for the app's language, chosen once per build. */
  const copy = copyFor(caps)
  /** The v2 tree before the fallback rewrite: one `tabs` node carrying the four tabs. */
  const view = panelView({
    children: [
      tabs([
        { label: copy.tabsWorkbench[0], children: overviewTab(snapshot, copy) },
        { label: copy.tabsWorkbench[1], children: questionsTab(snapshot, copy) },
        { label: copy.tabsWorkbench[2], children: libraryTab(snapshot, copy) },
      ]),
    ],
  })
  return adaptView(view, caps)
}

/**
 * The Overview tab: the hero tiles, the ready rows and the one primary action the state allows.
 * @param snapshot - the workbench snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function overviewTab(snapshot: PanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The hero's supporting line, assembled from the counters the tiles show. */
  const caption = [String(snapshot.counts.ready) + " " + copy.metricReady, String(snapshot.counts.active) + " " + copy.metricActive, String(snapshot.team?.members ?? 0) + " " + copy.metricMembers].join(" · ")
  /** The buttons this state allows: approve only for a staged plan, dispatch only with ready rows. */
  const buttons: Array<{ label: string; action: string; icon?: string; primary?: boolean }> = []
  if (snapshot.plan?.ready === true) buttons.push({ label: copy.approve, action: "approve", icon: "check", primary: true })
  if (snapshot.counts.ready > 0) buttons.push({ label: copy.dispatch, action: "dispatch", icon: "send" })
  buttons.push({ label: copy.refresh, action: "refresh", icon: "refresh" })
  /** The tab's children. */
  const children: DshGoView[] = [
    hero(copy.workbench, caption, [progress(bind("counts.completion"), { label: copy.completion, tone: "good" })]),
    // THE TILES SIT OUTSIDE THE CARD (repair T18). The app computes a grid's column count itself:
    //     n = min(cells, columns); while (n > 1 && (width - 8*(n-1))/n < 136 * textScale) n--
    // Inside a padded hero the content box is ~300 px, which drops under that threshold and stacks the
    // grid into ONE column whatever `columns` says. At the panel's own width the same two cells clear
    // it, so the tiles are the tab's first full-width element instead of the hero's last.
    tiles(
      [
        { label: copy.metricReady, value: bind("counts.ready"), tone: "good" },
        { label: copy.metricActive, value: bind("counts.active"), tone: "info" },
      ],
      2,
    ),
  ]
  if (snapshot.alert !== null) children.push(callout(snapshot.alert, { tone: "warn" }))
  children.push(
    section(
      copy.readyHeading,
      snapshot.readyTasks.length === 0
        ? [empty(copy.emptyReady)]
        : [list(snapshot.readyTasks.map((task) => ({ title: task.title, subtitle: task.subtitle })))],
    ),
  )
  children.push(spacer({ size: "S" }), actions(buttons))
  return children
}

/**
 * The Questions tab: the FIRST parked question only (bounded, as before), its options and a custom answer.
 * @param snapshot - the workbench snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function questionsTab(snapshot: PanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The hero, shared by both the parked and the empty branch. */
  const head = hero(copy.tabsWorkbench[1], copy.questionsCaption)
  /** The question this tab renders, or null when nothing is parked. */
  const question = snapshot.question
  if (question === null) return [head, empty(copy.emptyQuestion)]
  /** The option buttons: one per option, capped at the per-node button budget. */
  const options = question.options.slice(0, 4).map((option, index) => ({ label: option.label, action: "answer:" + String(index) }))
  /** The tab's content: the parked text, its options and the free-text escape hatch. */
  const content: DshGoView[] = [callout(bind("question.question"), { tone: "info" })]
  if (options.length > 0) content.push(actions(options))
  content.push(
    form({
      // The app requires an input binding to be a FULL `data.` path (measured: checker
      // `输入绑定必须是 data 下的字段路径`), so the prefix is spelled here rather than left to the kit.
      children: [textField({ label: copy.customAnswer, bind: "data.customAnswer", placeholder: copy.customAnswer })],
      submit: "answer-custom",
      submitLabel: copy.submit,
    }),
  )
  if (question.options.length > 4) content.push(text(copy.moreOptions, { tone: "muted", style: { size: "caption", maxLines: 2 } }))
  return [head, section(copy.tabsWorkbench[1], content)]
}

/**
 * The Library tab: the workmate list and the memory list, both read-only.
 *
 * THEY SHARE A TAB because four tabs cannot fit a phone-width strip (measured on the app's tab bar:
 * `n = min(4, labels)` while `width / n >= 80`, and the content box is under 320 px), and because the
 * two lists are the same KIND of thing — local state this panel only reads. ONE `tinted` hero opens
 * the tab; the two lists are separate `surface` sections under it.
 * @param snapshot - the workbench snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function libraryTab(snapshot: PanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The workmate rows, one per instance, with its base and use count as the supporting line. */
  const mates = snapshot.workmates.map((mate) => ({ title: mate.name, subtitle: mate.base + " · " + String(mate.uses) + " " + copy.uses, trailing: mate.note }))
  /** The memory half of the snapshot, or null when the store could not be read. */
  const memory = snapshot.memory
  /** The memory rows: kind and age as the supporting line. */
  const entries = memory === null ? [] : memory.entries.map((entry) => ({ title: entry.description, subtitle: entry.kind + " · " + entry.age }))
  /** The reflection counters, read as a two-row table. */
  const reflection = memory === null
    ? []
    : [keyValue([[copy.reflection, String(memory.reflections)], [copy.memoryHeading, String(memory.entries.length)]])]
  return [
    hero(copy.tabsWorkbench[2], copy.libraryCaption),
    section(copy.agentsHeading, mates.length === 0 ? [empty(copy.emptyWorkmates)] : [list(mates)]),
    section(copy.memoryHeading, entries.length === 0 ? [empty(copy.emptyMemory), ...reflection] : [list(entries), divider(), ...reflection]),
    spacer({ size: "S" }),
    actions([{ label: copy.refresh, action: "refresh", icon: "refresh" }]),
  ]
}

/**
 * Build the `mpd-team` panel: four v2 tabs over the team board, adapted for the app on the other end.
 * @param snapshot - the live read of the team, its board, its roster, the selection and the watchdog.
 * @param caps - what the app can draw; absent reads as an older app and yields the v1 fallback.
 * @returns the complete view tree the bridge renders.
 */
export function buildTeamView(snapshot: TeamPanelSnapshot, caps?: DshGoCaps | null): DshGoView {
  /** The copy record for the app's language, chosen once per build. */
  const copy = copyFor(caps)
  /** The v2 tree before the fallback rewrite: one `tabs` node carrying the four tabs. */
  const view = panelView({
    children: [
      tabs([
        { label: copy.tabsBoard[0], children: boardTab(snapshot, copy, speaksV2(caps)) },
        { label: copy.tabsBoard[1], children: detailTab(snapshot, copy) },
        { label: copy.tabsBoard[2], children: watchdogTab(snapshot, copy) },
      ]),
    ],
  })
  return adaptView(view, caps)
}

/**
 * The Board tab: the team's counters, a tappable row per task, the dependency graph and the roster.
 * @param snapshot - the team snapshot.
 * @param copy - the copy record for the app's language.
 * @param v2 - whether the app speaks view v2, which decides the graph's shape (fold + code block vs steps).
 * @returns the tab's children, in reading order.
 */
function boardTab(snapshot: TeamPanelSnapshot, copy: DshGoCopy, v2: boolean): DshGoView[] {
  /** The hero's supporting line: the team's name and its derived stage. */
  const caption = snapshot.team === null
    ? copy.emptyTeam[0]
    : snapshot.team.name + " · " + String(snapshot.counts.total) + " " + copy.metricTasks + " · " + String(snapshot.counts.blocked) + " " + copy.metricBlocked
  /** The tab's children. */
  const children: DshGoView[] = [
    hero(copy.board, caption, [progress(bind("counts.completion"), { label: copy.completion, tone: "good" })]),
    // Outside the card for the same measured reason as the workbench tiles (see `overviewTab`): the
    // grid keeps two columns only at the panel's own width.
    tiles(
      [
        { label: copy.metricActive, value: bind("counts.active"), tone: "info" },
        { label: copy.metricDone, value: bind("counts.done"), tone: "good" },
      ],
      2,
    ),
  ]
  if (snapshot.team === null) {
    children.push(empty(copy.emptyTeam))
    return children
  }
  children.push(section(copy.boardCaption, snapshot.tasks.length === 0 ? [empty(copy.emptyBoard)] : [list(snapshot.tasks.map(taskRow))]))
  // THE DEPENDENCY GRAPH (task T20): the same board, laid out in dependency layers. v2 gets a fold
  // around a monospace block; an older app gets one `steps` entry per layer, because `codeBlock` and
  // `collapsible` are v2-only components.
  // THE PER-MEMBER CHART (task T21): the examples' discipline — a bar chart right after the numbers,
  // with a caption that says what it counts.
  /** The chart node, or null when there is no roster to chart. */
  const chartNode = memberChartOf(snapshot, copy)
  if (chartNode !== null) children.push(section(copy.memberChartHeading, [chartNode]))
  /** The layered layout, computed once for whichever shape is emitted. */
  const layers = layerGraphOf(snapshot.tasks)
  /** The monospace block the v2 branch renders. */
  const block = codeBlock(graphLinesOf(layers).join("\n"))
  // A fold around two lines is noise: only a block that would push the board off the first phone screen
  // is hidden behind one (see `graphNeedsFold`).
  children.push(section(copy.graphHeading, v2 ? (graphNeedsFold(layers) ? [fold(copy.graphHeading, [block])] : [block]) : [steps(graphStepsOf(layers))]))
  // THE ROSTER MOVED HERE (repair T18): three tabs cannot hold separate Board/Members/Detail/Watch
  // surfaces, and the roster belongs beside the board it staffs.
  children.push(section(copy.membersCaption, snapshot.members.length === 0 ? [empty(copy.emptyMembers)] : [list(snapshot.members.map(memberLine))]))
  return children
}

/**
 * One member, as a SINGLE list row: `DW · Deep Worker` with the state word at the end.
 *
 * WHY NOT A `row` OF BADGE + NAME + BADGE (repair T19): the app's `_RowView` decides how many children
 * share a line from each child's MINIMUM width — metric 96, progress 140, text/badge 160, nested
 * layout/list 200 — and lays out `floor((width + gap) / (need + gap))` columns. At phone width
 * (~300 px, gap 8) a row of badge + stack + badge has `need = 200`, so it gets ONE column and the
 * member renders as three stacked fragments. A list row cannot wrap that way: it is one item, and with
 * the state as `trailing` it is one visual line.
 * @param member - the member to draw.
 * @returns the list item the roster renders.
 */
function memberLine(member: TeamPanelMember): DshGoListItem {
  /** The state word this member shows: its handoff state when it has one, else its mode. */
  const word = member.handoff === "" ? member.mode : member.handoff
  return { title: initialsOf(member.name) + " · " + member.name, trailing: word, tone: toneOf(word) }
}

/**
 * The Detail tab: the selected task's identity, its contract and the buttons that settle or clear it.
 * @param snapshot - the team snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function detailTab(snapshot: TeamPanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The task this tab renders, or null when the board holds none. */
  const task = snapshot.selected
  /** The hero, shared by both branches. */
  const head = hero(copy.tabsBoard[2], task === null ? copy.emptyDetail[0] : task.id + " " + task.subject)
  if (task === null) return [head, empty(copy.emptyDetail)]
  /** The field rows: everything the contract carries except the free text. */
  const fields = keyValue([
    [copy.owner, task.owner === "" ? "—" : task.owner],
    [copy.status, task.status],
    [copy.kind, task.kind],
    [copy.dependencies, task.dependencies === "" ? "—" : task.dependencies],
    [copy.verdict, task.verdict === "" ? "—" : task.verdict],
  ])
  return [
    head,
    section(copy.detailCaption, [
      text(task.description === "" ? "—" : task.description, { tone: "muted", style: { maxLines: 4 } }),
      divider(),
      fields,
      // NO settle buttons (repair T8/H1): a panel tap is anonymous, so `agent_teams_task` refuses every
      // owned row from here. The control is gone and the copy says where the action does live.
      // No tone: the app's callout accepts only info/good/warn/bad (measured: `未知 tone "muted"`), and a
      // neutral hint should not borrow a semantic colour.
      callout(copy.settleHint),
      actions([{ label: copy.back, action: "back", icon: "expand" }]),
    ]),
  ]
}

/**
 * The Watchdog tab: the predicate in force, the hold, the last incidents and the one hold button that applies.
 * @param snapshot - the team snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function watchdogTab(snapshot: TeamPanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The watchdog state this tab renders. */
  const watchdog = snapshot.watchdog
  /** The hold line: the state word plus the reason it was raised. */
  const holdLine = watchdog.held ? copy.held + (watchdog.reason === "" ? "" : " · " + watchdog.reason) : copy.notHeld
  /** The incident rows, one per recorded incident. */
  const rows = watchdog.incidents.map((incident) => ({ title: incident.kind, subtitle: incident.at, trailing: incident.detail }))
  return [
    hero(copy.tabsBoard[2], copy.watchdogCaption),
    // The tiles sit OUTSIDE the card here too: the predicate and the state must share a row on a
    // phone, and only the panel's own width clears the app's grid threshold (see `overviewTab`).
    tiles([
      { label: copy.predicate, value: watchdog.predicate },
      { label: copy.tabsBoard[2], value: holdLine, tone: watchdog.held ? "warn" : "good" },
    ], 2),
    section(copy.incidents, rows.length === 0 ? [empty(copy.emptyIncidents)] : [list(rows)]),
    // NO hold/resume button (repair T8/M3): the watchdog tools resolve their workspace from the
    // environment, not from this panel's session, so the tap could write to another store. Read-only.
    callout(copy.watchdogReadOnly),
  ]
}
