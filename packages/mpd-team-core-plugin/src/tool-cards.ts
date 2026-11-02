// THE dsh-Go TOOL CARDS for this package's three team tools.
//
// WHY PURE BUILDERS AND NOT INLINE CLOSURES: the lane's unit test must be able to run the SAME tree a
// live registration hands the app, so `toolCard()` wraps exactly the function the test calls. A tool
// card is a CHAT-LOG entry rendered by apps that may predate view v2, so every builder here stays
// inside v1: `stack` root with a title, then metrics, keyValue, tables and short text — no bindings
// (a card has no data model), no actions (a card has no action channel) and no `style` key at all
// (the v1 lint bans decoration outright). `toolCard()` is still the net: an over-budget tree, a v2
// component or a builder throw degrades to `{}` and the app draws its generic tool row.
import { keyValue, metric, stack, table, text, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** How many characters a table cell or a keyValue value keeps before the card clips it. */
const CELL_LIMIT = 60

/** True for a JSON object — never an array — the shape every card field is read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The object at `key`, or an EMPTY one, so a missing answer branch reads as absent instead of throwing. */
function recordAt(source: Record<string, unknown>, key: string): Record<string, unknown> {
  /** The field as it arrived, narrowed by the record guard. */
  const found = source[key]
  return isRecord(found) ? found : {}
}

/** The array at `key` when it really is one, otherwise an empty array a card can iterate. */
function arrayAt(source: Record<string, unknown>, key: string): unknown[] {
  /** The field as it arrived, narrowed by the array test. */
  const found = source[key]
  return Array.isArray(found) ? found : []
}

/** The first candidate carrying rows — the precedence a card reads its roster and board in. */
function firstRows(candidates: readonly unknown[][]): unknown[] {
  for (const candidate of candidates) if (candidate.length > 0) return candidate
  return []
}

/** A single-line string of at most `limit` characters, or undefined when there are no words to draw. */
function words(value: unknown, limit: number = 200): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined
  /** The value flattened to one line, because a card field is a line and never a paragraph break. */
  const flat = String(value).replace(/\s+/g, " ").trim()
  if (flat === "") return undefined
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`
}

/** A finite number, or undefined — the only numeric shape a metric value or a revision fact carries. */
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** One table cell: the value as a short line, and an em dash where the answer carries nothing. */
function cell(value: unknown, limit: number = CELL_LIMIT): string {
  return words(value, limit) ?? "—"
}

/** One `name → value` fact on the keyValue node, skipped when the answer does not carry it. */
function addFact(facts: Array<readonly [string, string | number]>, name: string, value: unknown): void {
  /** The fact's drawn value: a number stays a number, everything else becomes a short line. */
  const shown = numberOf(value) ?? words(value, 120)
  if (shown !== undefined && facts.length < 24) facts.push([name, shown])
}

/** One board row as the four columns the card always draws. */
function taskRow(row: unknown): readonly string[] {
  /** The row, read as a record because the board answer is open JSON at the tool boundary. */
  const task = isRecord(row) ? row : {}
  return [cell(task.id, 12), cell(task.subject, 48), cell(task.status, 12), cell(task.owner, 24)]
}

/** One roster row: the name, the role label and the member's own state. */
function memberRow(row: unknown): readonly string[] {
  /** The member, read as a record for the same reason as {@link taskRow}. */
  const member = isRecord(row) ? row : {}
  return [cell(member.name, 24), cell(member.status, 12), cell(member.role, 24)]
}

/** One related row: just the id and the subject, the two columns the task card has room for. */
function relatedRow(row: unknown): readonly string[] {
  /** The related row, read as a record for the same reason as {@link taskRow}. */
  const related = isRecord(row) ? row : {}
  return [cell(related.id ?? related, 12), cell(related.subject, 48)]
}

/**
 * The `agent_teams_plan` card: the staged plan, the live team or the archive the call just touched.
 * @param args - the call's arguments, read for its action only.
 * @param value - the tool's answer, in any of the tool's branches.
 * @returns a v1 card tree, or null when the answer carries nothing worth a card.
 */
export function agentTeamsPlanCard(args: unknown, value: unknown): DshGoView | null {
  /** The call's arguments, read as a record because a tool argument need not be one. */
  const call = isRecord(args) ? args : {}
  /** The tool's answer, read as a record for the same reason. */
  const answer = isRecord(value) ? value : {}
  /** The action this call took, which is also the card's subtitle. */
  const action = words(call.action, 24) ?? "status"
  /** The staged plan, the live record and the approval's creation report: every row source there is. */
  const plan = recordAt(answer, "plan")
  /** The live team record, present once a plan was approved. */
  const team = recordAt(answer, "team")
  /** The approval's own creation report, present only on the `approve` branch. */
  const created = recordAt(answer, "created")
  /** The roster and the board, in the precedence the live record gives first. */
  const members = firstRows([arrayAt(team, "members"), arrayAt(answer, "members"), arrayAt(plan, "members"), arrayAt(created, "members")])
  /** The board rows, from the same four sources and in the same precedence. */
  const tasks = firstRows([arrayAt(team, "tasks"), arrayAt(answer, "tasks"), arrayAt(plan, "tasks"), arrayAt(created, "tasks")])
  /** The board's own summary counts, present only on the `status` branch. */
  const summary = recordAt(answer, "summary")
  /** The name → value facts the card draws under the two count metrics. */
  const facts: Array<readonly [string, string | number]> = []
  addFact(facts, "plan", plan.planId)
  addFact(facts, "approval", plan.approval)
  addFact(facts, "team", team.teamId)
  addFact(facts, "total", summary.total)
  addFact(facts, "completed", summary.completed)
  addFact(facts, "running", summary.running)
  addFact(facts, "ready", summary.ready)
  addFact(facts, "appended", answer.appended)
  addFact(facts, "archived to", answer.archivedTo)
  addFact(facts, "stopped at", answer.stoppedAt)
  /** The card's children: counts first, then the facts, the description and the two boards. */
  const children: DshGoView[] = [
    metric({ label: "members", value: members.length }),
    metric({ label: "tasks", value: tasks.length }),
  ]
  if (facts.length > 0) children.push(keyValue(facts))
  /** The team's one-line purpose, clipped so the card stays a summary. */
  const description = words(plan.description, 200)
  if (description !== undefined) children.push(text(description))
  if (tasks.length > 0) children.push(table({ columns: ["id", "subject", "status", "owner"], rows: tasks.slice(0, 12).map(taskRow) }))
  if (members.length > 0) children.push(table({ columns: ["name", "status", "role"], rows: members.slice(0, 8).map(memberRow) }))
  return stack(children, { title: `plan · ${action}` })
}

/**
 * The `agent_teams_task` card: the row a board action touched, or this seat's own occupancy.
 * @param args - the call's arguments, read for its action only.
 * @param value - the tool's answer, in any of the tool's branches.
 * @returns a v1 card tree, or null when the answer carries nothing worth a card.
 */
export function agentTeamsTaskCard(args: unknown, value: unknown): DshGoView | null {
  /** The call's arguments, read as a record because a tool argument need not be one. */
  const call = isRecord(args) ? args : {}
  /** The tool's answer, read as a record for the same reason. */
  const answer = isRecord(value) ? value : {}
  /** The action this call took, which is also the card's subtitle. */
  const action = words(call.action, 24) ?? "claim"
  /** The row the answer names, whether as the board's own task or the claimed contract. */
  const task = recordAt(answer, "task")
  /** The frozen claim contract, present only on the `claim`/`contract` branches. */
  const contract = recordAt(answer, "contract")
  /** Whether this answer is the `context` branch, whose numbers are the seat's own occupancy. */
  const occupancy = answer.provenance !== undefined
  /** The name → value facts the card draws below the metrics. */
  const facts: Array<readonly [string, string | number]> = []
  addFact(facts, "task", answer.taskId ?? task.id ?? contract.taskId)
  addFact(facts, "status", answer.status ?? task.status)
  addFact(facts, "closed by", answer.closedBy)
  addFact(facts, "attempt", answer.attempt ?? contract.attempt)
  addFact(facts, "revision", answer.revision)
  addFact(facts, "released", answer.released)
  addFact(facts, "note", answer.note ?? task.note)
  addFact(facts, "file", answer.path)
  addFact(facts, "member", answer.member)
  addFact(facts, "mode", answer.mode)
  addFact(facts, "provenance", answer.provenance)
  addFact(facts, "fenced", answer.fenced)
  addFact(facts, "refused", answer.refused)
  /** The card's children: occupancy counts first, then the facts and the dependent rows. */
  const children: DshGoView[] = []
  if (occupancy) {
    children.push(metric({ label: "used", value: numberOf(answer.usedTokens) ?? "?" }))
    children.push(metric({ label: "window", value: numberOf(answer.windowTokens) ?? "no window" }))
  }
  if (facts.length > 0) children.push(keyValue(facts))
  /** The rows that were appended or that wait on this one, whichever the branch reports. */
  const related = firstRows([arrayAt(answer, "dependents"), arrayAt(answer, "added")])
  if (related.length > 0) children.push(table({ columns: ["task", "subject"], rows: related.slice(0, 12).map(relatedRow) }))
  /** The dependency references this board could not resolve, named rather than dropped. */
  const unresolved = arrayAt(answer, "unresolved")
  if (unresolved.length > 0) children.push(table({ columns: ["reference"], rows: unresolved.slice(0, 8).map((item: unknown) => [cell(item)]) }))
  if (children.length === 0) return null
  return stack(children, { title: `task · ${action}` })
}

/**
 * The `agent_teams_dispatch` card: what one dispatch pass paired, skipped, handed over or released.
 * @param args - the call's arguments, read for its action only.
 * @param value - the tool's answer, in any of the tool's branches.
 * @returns a v1 card tree, or null when the answer carries nothing worth a card.
 */
export function agentTeamsDispatchCard(args: unknown, value: unknown): DshGoView | null {
  /** The call's arguments, read as a record because a tool argument need not be one. */
  const call = isRecord(args) ? args : {}
  /** The tool's answer, read as a record for the same reason. */
  const answer = isRecord(value) ? value : {}
  /** The action this call took, which is also the card's subtitle. */
  const action = words(call.action, 24) ?? "run"
  /** The three row sets a pass reports, each empty when its branch did not run. */
  const pairs = arrayAt(answer, "pairs")
  /** The ready tasks the pass left pending, with the reason it did. */
  const skipped = arrayAt(answer, "skipped")
  /** The rows a `reassign` handed to another member, delivered or not. */
  const reassigned = arrayAt(answer, "reassigned")
  /** The name → value facts the card draws under the three counts. */
  const facts: Array<readonly [string, string | number]> = []
  addFact(facts, "released", answer.released)
  addFact(facts, "task", answer.taskId)
  addFact(facts, "status", answer.status)
  addFact(facts, "revision", answer.revision)
  addFact(facts, "halted", answer.halted)
  addFact(facts, "hold read", answer.holdRead)
  addFact(facts, "refused", answer.refused)
  addFact(facts, "reaped", arrayAt(answer, "reaped").length)
  addFact(facts, "forgotten", arrayAt(answer, "forgotten").length)
  /** The card's children: the three counts first, then the facts and the three row sets. */
  const children: DshGoView[] = []
  if (pairs.length > 0 || skipped.length > 0 || reassigned.length > 0) {
    children.push(metric({ label: "paired", value: pairs.length }))
    children.push(metric({ label: "skipped", value: skipped.length }))
    children.push(metric({ label: "handed over", value: reassigned.length }))
  }
  if (facts.length > 0) children.push(keyValue(facts))
  if (pairs.length > 0) children.push(table({ columns: ["subject", "member", "note"], rows: pairs.slice(0, 12).map(pairRow) }))
  if (skipped.length > 0) children.push(table({ columns: ["subject", "reason"], rows: skipped.slice(0, 8).map(skippedRow) }))
  if (reassigned.length > 0) children.push(table({ columns: ["task", "owner", "delivered"], rows: reassigned.slice(0, 8).map(handoverRow) }))
  if (children.length === 0) return null
  return stack(children, { title: `dispatch · ${action}` })
}

/** One dispatch pairing: the task's subject, the member that took it, and the pass's own note. */
function pairRow(row: unknown): readonly string[] {
  /** The pairing, read as a record because the ledger row is open JSON at the tool boundary. */
  const pair = isRecord(row) ? row : {}
  return [cell(pair.subject, 48), cell(pair.memberName, 24), cell(pair.note, 48)]
}

/** One skipped row: what was skipped, and the reason the pass gave instead of pairing it. */
function skippedRow(row: unknown): readonly string[] {
  /** The skip, read as a record for the same reason as {@link pairRow}. */
  const skip = isRecord(row) ? row : {}
  return [cell(skip.subject, 48), cell(skip.reason, 60)]
}

/** One hand-over: the row, its new owner, and whether delivery actually reached that owner. */
function handoverRow(row: unknown): readonly string[] {
  /** The hand-over, read as a record for the same reason as {@link pairRow}. */
  const handover = isRecord(row) ? row : {}
  return [cell(handover.taskId, 12), cell(handover.owner, 24), handover.delivered === true ? "yes" : "NOT delivered"]
}
