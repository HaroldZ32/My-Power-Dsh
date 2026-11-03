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
  tabs,
  text,
  textField,
  type DshGoCaps,
  type DshGoTone,
  type DshGoView,
} from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"
import { copyFor, type DshGoCopy } from "./dshgo-copy"
import type { PanelSnapshot } from "./dshgo-panel"

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
    subtitle: [task.owner === "" ? "—" : task.owner, task.kind, task.blockedBy === 0 ? "" : "blocked " + String(task.blockedBy)].filter((part) => part !== "").join(" · "),
    trailing: task.status,
    action: { id: "select", args: { task: task.id } },
  }
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
        { label: copy.tabsWorkbench[2], children: workmatesTab(snapshot, copy) },
        { label: copy.tabsWorkbench[3], children: memoryTab(snapshot, copy) },
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
    hero(copy.workbench, caption, [
      tiles(
        [
          { label: copy.metricReady, value: bind("counts.ready"), tone: "good" },
          { label: copy.metricActive, value: bind("counts.active"), tone: "info" },
          { label: copy.metricDone, value: bind("counts.done") },
          { label: copy.metricMembers, value: bind("counts.members") },
        ],
        2,
      ),
      progress(bind("counts.completion"), { label: copy.completion, tone: "good" }),
    ]),
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
 * The Workmates tab: the library, read-only — the panel never spawns or mutates an instance.
 * @param snapshot - the workbench snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function workmatesTab(snapshot: PanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The rows, one per instance, with its base and use count as the supporting line. */
  const rows = snapshot.workmates.map((mate) => ({ title: mate.name, subtitle: mate.base + " · " + String(mate.uses) + " " + copy.uses, trailing: mate.note }))
  return [
    // Literal on purpose: this tab is rebuilt when the user taps Refresh, and a `length` binding would
    // be an array path the bridge's own resolver does not walk.
    hero(copy.tabsWorkbench[2], copy.workmatesCaption, [tiles([{ label: copy.tabsWorkbench[2], value: snapshot.workmates.length }], 1)]),
    section(copy.tabsWorkbench[2], rows.length === 0 ? [empty(copy.emptyWorkmates)] : [list(rows)]),
    spacer({ size: "S" }),
    actions([{ label: copy.refresh, action: "refresh", icon: "refresh" }]),
  ]
}

/**
 * The Memory tab: the last entries of the workspace store and the reflection counters, read-only.
 * @param snapshot - the workbench snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function memoryTab(snapshot: PanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The memory half of the snapshot, or null when the store could not be read. */
  const memory = snapshot.memory
  if (memory === null) return [hero(copy.tabsWorkbench[3], copy.memoryCaption), empty(copy.emptyMemory)]
  /** The rows: kind and age as the supporting line. */
  const rows = memory.entries.map((entry) => ({ title: entry.description, subtitle: entry.kind + " · " + entry.age }))
  /** The reflection counters, read as a two-row table. */
  const reflection = keyValue([
    [copy.reflection, String(memory.reflections)],
    [copy.tabsWorkbench[3], String(memory.entries.length)],
  ])
  return [
    // Literal for the same reason as the workmates tile: an array `length` is not a binding path.
    hero(copy.tabsWorkbench[3], copy.memoryCaption, [tiles([{ label: copy.tabsWorkbench[3], value: memory.entries.length }], 1)]),
    section(copy.tabsWorkbench[3], rows.length === 0 ? [empty(copy.emptyMemory), reflection] : [list(rows), divider(), reflection]),
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
        { label: copy.tabsBoard[0], children: boardTab(snapshot, copy) },
        { label: copy.tabsBoard[1], children: membersTab(snapshot, copy) },
        { label: copy.tabsBoard[2], children: detailTab(snapshot, copy) },
        { label: copy.tabsBoard[3], children: watchdogTab(snapshot, copy) },
      ]),
    ],
  })
  return adaptView(view, caps)
}

/**
 * The Board tab: the team's counters and a tappable row per task.
 * @param snapshot - the team snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function boardTab(snapshot: TeamPanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The hero's supporting line: the team's name and its derived stage. */
  const caption = snapshot.team === null ? copy.emptyTeam[0] : snapshot.team.name + " · " + snapshot.team.status + " · " + snapshot.team.phase
  /** The tab's children. */
  const children: DshGoView[] = [
    hero(copy.board, caption, [
      tiles(
        [
          { label: copy.metricTasks, value: bind("counts.total") },
          { label: copy.metricActive, value: bind("counts.active"), tone: "info" },
          { label: copy.metricDone, value: bind("counts.done"), tone: "good" },
          { label: copy.metricBlocked, value: bind("counts.blocked"), tone: "warn" },
        ],
        2,
      ),
      progress(bind("counts.completion"), { label: copy.completion, tone: "good" }),
    ]),
  ]
  if (snapshot.team === null) {
    children.push(empty(copy.emptyTeam))
    return children
  }
  children.push(section(copy.boardCaption, snapshot.tasks.length === 0 ? [empty(copy.emptyBoard)] : [list(snapshot.tasks.map(taskRow))]))
  return children
}

/**
 * The Members tab: an initials badge, the name, the mode and the handoff word per member.
 * @param snapshot - the team snapshot.
 * @param copy - the copy record for the app's language.
 * @returns the tab's children, in reading order.
 */
function membersTab(snapshot: TeamPanelSnapshot, copy: DshGoCopy): DshGoView[] {
  /** The member rows, each a row of badge + name/mode + state word. */
  const rows = snapshot.members.map((member) =>
    row(
      [
        badge({ text: initialsOf(member.name), tone: "info" }),
        stack([text(member.name, { style: { maxLines: 1 } }), text(member.mode, { tone: "muted", style: { size: "caption", maxLines: 1 } })], { style: { gap: "S" } }),
        badge({ text: member.handoff === "" ? member.mode : member.handoff, tone: toneOf(member.handoff === "" ? member.mode : member.handoff) }),
      ],
      { style: { gap: "S", align: "center" } },
    ),
  )
  return [
    // Literal, like every other rebuilt-on-refresh tile: an array `length` is not a binding path the
    // bridge resolver walks, so a bound one would render as an em dash.
    hero(copy.tabsBoard[1], copy.membersCaption, [tiles([{ label: copy.metricMembers, value: snapshot.members.length }], 1)]),
    section(copy.membersCaption, rows.length === 0 ? [empty(copy.emptyMembers)] : rows),
  ]
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
      callout(copy.settleHint, { tone: "muted" }),
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
    hero(copy.tabsBoard[3], copy.watchdogCaption, [
      tiles([
        { label: copy.predicate, value: watchdog.predicate },
        { label: copy.tabsBoard[3], value: holdLine, tone: watchdog.held ? "warn" : "good" },
      ], 2),
    ]),
    section(copy.incidents, rows.length === 0 ? [empty(copy.emptyIncidents)] : [list(rows)]),
    // NO hold/resume button (repair T8/M3): the watchdog tools resolve their workspace from the
    // environment, not from this panel's session, so the tap could write to another store. Read-only.
    callout(copy.watchdogReadOnly, { tone: "muted" }),
  ]
}
