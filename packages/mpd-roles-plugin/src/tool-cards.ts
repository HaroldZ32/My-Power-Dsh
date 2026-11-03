// THE dsh-Go TOOL CARDS for this package's two roster tools.
//
// WHY PURE BUILDERS AND NOT INLINE CLOSURES: the lane's unit test must be able to run the SAME tree a
// live registration hands the app, so `toolCard()` wraps exactly the function the test calls. A tool
// card is a CHAT-LOG entry rendered by apps that may predate view v2, so every builder here stays
// inside v1: `stack` root with a title, then metrics, keyValue, tables and short text — no bindings
// (a card has no data model), no actions (a card has no action channel) and no `style` key at all
// (the v1 lint bans decoration outright). `toolCard()` is still the net: an over-budget tree, a v2
// component or a builder throw degrades to `{}` and the app draws its generic tool row.
import { keyValue, metric, stack, table, text, type DshGoView } from "../../mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** How many characters a table cell keeps before the card clips it. */
const CELL_LIMIT = 60

/** True for a JSON object — never an array — the shape every card field is read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The array at `key` when it really is one, otherwise an empty array a card can iterate. */
function arrayAt(source: Record<string, unknown>, key: string): unknown[] {
  /** The field as it arrived, narrowed by the array test. */
  const found = source[key]
  return Array.isArray(found) ? found : []
}

/** A single-line string of at most `limit` characters, or undefined when there are no words to draw. */
function words(value: unknown, limit: number = 200): string | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined
  /** The value flattened to one line, because a card field is a line and never a paragraph break. */
  const flat = String(value).replace(/\s+/g, " ").trim()
  if (flat === "") return undefined
  return flat.length <= limit ? flat : `${flat.slice(0, Math.max(0, limit - 1))}…`
}

/** A finite number, or undefined — the only numeric shape a metric value carries. */
function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** One table cell: the value as a short line, and an em dash where the answer carries nothing. */
function cell(value: unknown, limit: number = CELL_LIMIT): string {
  return words(value, limit) ?? "—"
}

/** One roster row: the name a caller addresses, its route, and whether it may write. */
function roleRow(row: unknown): readonly string[] {
  /** The role, read as a record because the roster answer is open JSON at the tool boundary. */
  const role = isRecord(row) ? row : {}
  /** The provider and model as one route, or just the model when the provider is absent. */
  const route = words(role.provider, 24) === undefined
    ? cell(role.model, 40)
    : `${cell(role.provider, 24)}/${cell(role.model, 40)}`
  return [cell(role.name, 24), route, role.readonly === true ? "read-only" : "writes"]
}

/** One refused extension row: what it is and why the roster dropped it. */
function refusedRow(row: unknown): readonly string[] {
  /** The refusal, read as a record for the same reason as {@link roleRow}. */
  const refusal = isRecord(row) ? row : {}
  return [cell(refusal.name, 24), cell(refusal.extension, 20), cell(refusal.reason, 60)]
}

/**
 * The `mpd_roles_list` card: the roster this call sees, plus any extension role it had to refuse.
 * @param args - the call's arguments, unused by this card (the roster answer is the whole subject).
 * @param value - the tool's answer.
 * @returns a v1 card tree, or null when the answer lists no role at all.
 */
export function rolesListCard(args: unknown, value: unknown): DshGoView | null {
  /** The call's arguments, kept for the shared builder signature and otherwise unread. */
  void args
  /** The tool's answer, read as a record because a tool value need not be one. */
  const answer = isRecord(value) ? value : {}
  /** The listed roles and the extensions the surface refused to list. */
  const roles = arrayAt(answer, "roles")
  /** The extension roles the surface refused to list, with the reason it refused them. */
  const refused = arrayAt(answer, "refused")
  /** The count the tool reported, falling back to the rows actually drawn. */
  const count = numberOf(answer.count) ?? roles.length
  /** The card's children: one count metric, then the roster and any refusal table. */
  const children: DshGoView[] = [metric({ label: "roles", value: count })]
  if (roles.length > 0) children.push(table({ columns: ["name", "route", "access"], rows: roles.slice(0, 12).map(roleRow) }))
  if (refused.length > 0) children.push(table({ columns: ["name", "extension", "reason"], rows: refused.slice(0, 6).map(refusedRow) }))
  return stack(children, { title: "roster" })
}

/**
 * The `mpd_role_spawn` card: which specialist answered, and the bounded report it returned.
 * @param args - the call's arguments, unused by this card (the report is the whole subject).
 * @param value - the tool's answer.
 * @returns a v1 card tree, or null when the answer names no role at all.
 */
export function roleSpawnCard(args: unknown, value: unknown): DshGoView | null {
  /** The call's arguments, kept for the shared builder signature and otherwise unread. */
  void args
  /** The tool's answer, read as a record because a tool value need not be one. */
  const answer = isRecord(value) ? value : {}
  /** The specialist that answered and its terminal state. */
  const role = words(answer.role, 40)
  if (role === undefined) return null
  /** The report's one-word status, which the app colours green only when the consult completed. */
  const status = words(answer.status, 20) ?? "complete"
  /** The evidence the consult cited, drawn as its own short table. */
  const evidence = arrayAt(answer, "evidence")
  /** The stop reason, drawn as a fact so a truncated report never reads as a clean one. */
  const facts: Array<readonly [string, string | number]> = []
  if (words(answer.stopReason, 120) !== undefined) facts.push(["stop reason", words(answer.stopReason, 120) ?? ""])
  if (evidence.length > 0) facts.push(["evidence", evidence.length])
  /** The card's children: the two identity metrics, the report sections, then the evidence rows. */
  const children: DshGoView[] = [
    metric({ label: "role", value: role }),
    metric({ label: "status", value: status, tone: status === "complete" ? "good" : "warn" }),
  ]
  /** The report's summary, clipped so the card stays a card rather than the whole transcript. */
  const summary = words(answer.summary, 700)
  if (summary !== undefined) children.push(text(summary))
  /** The consult's recommendation, when it made one. */
  const recommendation = words(answer.recommendation, 300)
  if (recommendation !== undefined) children.push(text(recommendation))
  /** The bounded detail body, clipped harder than the summary because it is the longest field. */
  const details = words(answer.details, 900)
  if (details !== undefined) children.push(text(details))
  if (facts.length > 0) children.push(keyValue(facts))
  if (evidence.length > 0) children.push(table({ columns: ["evidence"], rows: evidence.slice(0, 8).map((item: unknown) => [cell(item, 80)]) }))
  return stack(children, { title: `role · ${role}` })
}
