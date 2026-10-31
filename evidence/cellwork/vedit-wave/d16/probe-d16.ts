// R1's OWN black-box probe for defect D16 (team mailbox undelivered bound), independent of the
// lane's test arms: it drives the mailbox STORE exactly as `agent_teams_mail` does (send ->
// markDelivered/markRead) and prints one line per frozen-contract acceptance item.
//
// Temp workspace only: `mkdtemp` under the OS temp dir, never this repository's `.mpd/team`.
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  markDelivered,
  markRead,
  readMailbox,
  send,
  summarise,
  scopeToTeam,
  type SendInput,
} from "../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** Clock base shared by every probe arm, so log order is deterministic. */
const NOW = new Date("2026-10-31T05:00:00.000Z")

/** One clock offset from NOW, in minutes. */
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000)

/** The live roster an `agent_teams_mail` send validates its recipient against. */
const ROSTER = ["M1", "M2", "M3", "M4"]

/** A well-formed send input; `teamId` is the stamp `agent_teams_mail` passes from the resolved team. */
const msg = (over: Record<string, unknown> = {}): SendInput => ({
  fromId: "captain",
  fromName: "captain",
  toId: "M4",
  toName: "M4",
  subject: "s",
  body: "b",
  memberIds: ROSTER,
  ...over,
})

/** Results of every arm, so the exit code reports how many contract items failed. */
const failures: string[] = []

/** Record one arm's outcome and print it. */
function arm(id: string, ok: boolean, detail: string): void {
  if (!ok) failures.push(id)
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`)
}

/** A fresh temp workspace for one arm; the caller removes it when the arm is done. */
const box = (): string => mkdtempSync(join(tmpdir(), "r1-d16-"))

// ── A. A RETIRED team's 8 undelivered rows must not refuse a FRESH team's own M4 ──────────────
{
  const ws = box()
  for (let i = 0; i < 8; i += 1) {
    const r = send(ws, msg({ teamId: "team-retired", subject: `old${i}` }), later(i))
    if (!r.ok) throw new Error(`fixture send failed: ${r.detail}`)
  }
  /** Unscoped count, i.e. the pre-fix predicate, which is what refused the live send. */
  const unscoped = readMailbox(ws).messages.filter((m) => m.toId === "M4" && m.deliveredAt === undefined).length
  const fresh = send(ws, msg({ teamId: "team-fresh", subject: "new0" }), later(9))
  arm("A1 retired backlog ignored by the bound", fresh.ok, `unscoped(prefix)=${unscoped}, fresh send ok=${fresh.ok}${fresh.ok ? "" : ` detail=${fresh.detail}`}`)
  arm("A2 retired rows are still real rows", unscoped === 8, `unscoped undelivered for M4 = ${unscoped} (fixture = 8)`)
  // The send row itself must carry the fresh team's stamp, or the next generation would be unpinnable.
  const stamped = readMailbox(ws).messages.find((m) => m.subject === "new0")?.teamId
  arm("A3 a send stamps the teamId onto its row", stamped === "team-fresh", `stored teamId=${String(stamped)}`)
  rmSync(ws, { recursive: true, force: true })
}

// ── B. 8 undelivered rows in the CURRENT team must refuse the 9th, with the same sentence ────
{
  const ws = box()
  for (let i = 0; i < 8; i += 1) {
    const r = send(ws, msg({ teamId: "team-current", subject: `cur${i}` }), later(i))
    if (!r.ok) throw new Error(`fixture send failed: ${r.detail}`)
  }
  const ninth = send(ws, msg({ teamId: "team-current", subject: "ninth" }), later(9))
  /** The exact refusal text the live call produced. */
  const expected = `"M4" already has 8 undelivered message(s) (bound 8) — it is not keeping up`
  arm("B1 the 9th send in the current team refuses", !ninth.ok && ninth.reason === "backlog-full", `ok=${ninth.ok}${ninth.ok ? "" : ` reason=${ninth.reason}`}`)
  arm("B2 refusal sentence and bound value 8 unchanged", !ninth.ok && ninth.detail === expected, `detail=${ninth.ok ? "<no refusal>" : ninth.detail}`)
  arm("B3 the bound still counts only this member", readMailbox(ws).messages.filter((m) => m.toId === "M4" && m.deliveredAt === undefined).length === 8, `undelivered(M4)=${readMailbox(ws).messages.filter((m) => m.toId === "M4" && m.deliveredAt === undefined).length}`)
  rmSync(ws, { recursive: true, force: true })
}

// ── C. read/ack of ONE current-team undelivered row must free exactly one slot ────────────────
{
  const ws = box()
  for (let i = 0; i < 8; i += 1) {
    const r = send(ws, msg({ teamId: "team-current", subject: `cur${i}` }), later(i))
    if (!r.ok) throw new Error(`fixture send failed: ${r.detail}`)
  }
  const before = send(ws, msg({ teamId: "team-current", subject: "blocked" }), later(9))
  /** The oldest current-team row, acknowledged exactly as `agent_teams_mail {action:"read"}` does. */
  const target = readMailbox(ws).messages.find((m) => m.subject === "cur0")
  if (target === undefined) throw new Error("fixture message missing")
  const moved = markRead(ws, [target.id], later(10))
  const after = send(ws, msg({ teamId: "team-current", subject: "after-read" }), later(11))
  arm("C1 read/ack frees exactly one slot", before.ok === false && moved.length === 1 && after.ok, `before.ok=${before.ok}, moved=${moved.length}, afterReadSend.ok=${after.ok}${after.ok ? "" : ` detail=${after.detail}`}`)
  /** What the ack actually changed, so the gap is attributable rather than guessed. */
  const folded = readMailbox(ws).messages.find((m) => m.id === target.id)
  arm("C2 an ack records readAt and leaves deliveredAt untouched", folded?.readAt !== undefined && folded?.deliveredAt === undefined, `readAt=${String(folded?.readAt)}, deliveredAt=${String(folded?.deliveredAt)}`)
  // Control: DELIVERY does free one slot, so the bound itself is not simply inert.
  const target2 = readMailbox(ws).messages.find((m) => m.subject === "cur1")
  if (target2 === undefined) throw new Error("fixture message missing (cur1)")
  markDelivered(ws, [target2.id], later(12))
  const afterDelivery = send(ws, msg({ teamId: "team-current", subject: "after-delivery" }), later(13))
  arm("C3 delivery frees exactly one slot (control)", afterDelivery.ok, `afterDelivery.ok=${afterDelivery.ok}${afterDelivery.ok ? "" : ` detail=${afterDelivery.detail}`}`)
  rmSync(ws, { recursive: true, force: true })
}

// ── D. An UNSTAMPED legacy row belongs to no current team and is NOT counted ───────────────────
{
  const ws = box()
  // No teamId at all: a row written before team stamping existed.
  const legacy = send(ws, msg({ maxUndelivered: 1, subject: "legacy" }), later(0))
  if (!legacy.ok) throw new Error(`fixture send failed: ${legacy.detail}`)
  const first = send(ws, msg({ teamId: "team-a", maxUndelivered: 1, subject: "first" }), later(1))
  arm("D1 an unstamped row blocks no team (bound)", first.ok, `first ok=${first.ok}${first.ok ? "" : ` detail=${first.detail}`}`)
  const second = send(ws, msg({ teamId: "team-a", maxUndelivered: 1, subject: "second" }), later(2))
  arm("D2 the team's own row still fills its bound", !second.ok, `second ok=${second.ok}${second.ok ? "" : ` reason=${second.reason}`}`)
  rmSync(ws, { recursive: true, force: true })
}

// ── E. summary and the bound agree about WHICH rows count (per member) ────────────────────────
{
  const ws = box()
  for (let i = 0; i < 3; i += 1) {
    send(ws, msg({ teamId: "team-current", subject: `a${i}` }), later(i))
    send(ws, msg({ teamId: "team-other", subject: `b${i}` }), later(i))
  }
  // An unstamped row: counted by neither team-scoped answer.
  send(ws, msg({ subject: "legacy-unstamped" }), later(3))
  /** What the send bound's own predicate counts for the current team. */
  const boundCount = readMailbox(ws).messages.filter((m) => m.toId === "M4" && m.deliveredAt === undefined && m.teamId === "team-current").length
  /** What `summary` (team scope) reports for the same member. */
  const summaryCount = summarise(scopeToTeam(readMailbox(ws), "team-current")).find((row) => row.memberId === "M4")?.undelivered
  arm("E1 summary and bound agree per member", boundCount === summaryCount && boundCount === 3, `bound=${boundCount}, summary=${String(summaryCount)}, expected=3`)
  /** The unscoped callers keep the whole fold (the documented fallback). */
  const unscopedCount = summarise(scopeToTeam(readMailbox(ws), undefined)).find((row) => row.memberId === "M4")?.undelivered
  arm("E2 no-team caller keeps the unscoped fold", unscopedCount === 7, `unscoped=${String(unscopedCount)}, expected=7 (3 current + 3 other + 1 unstamped)`)
  rmSync(ws, { recursive: true, force: true })
}

// ── F. Delivery semantics unchanged: deliver != read, and delivery does not ack ───────────────
{
  const ws = box()
  const sent = send(ws, msg({ teamId: "team-current" }), NOW)
  if (!sent.ok) throw new Error(`fixture send failed: ${sent.detail}`)
  markDelivered(ws, [sent.message.id], later(1))
  /** The message after delivery. */
  const delivered = readMailbox(ws).messages.find((m) => m.id === sent.message.id)
  arm("F1 delivery does not acknowledge (readAt stays absent)", delivered?.deliveredAt !== undefined && delivered?.readAt === undefined, `deliveredAt=${String(delivered?.deliveredAt)}, readAt=${String(delivered?.readAt)}`)
  markRead(ws, [sent.message.id], later(2))
  /** The message after the ack. */
  const acked = readMailbox(ws).messages.find((m) => m.id === sent.message.id)
  arm("F2 an ack does not fabricate delivery (deliveredAt preserved)", acked?.deliveredAt !== undefined && acked?.readAt !== undefined, `deliveredAt=${String(acked?.deliveredAt)}, readAt=${String(acked?.readAt)}`)
  rmSync(ws, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? "ALL ARMS PASS" : `FAILED ARMS: ${failures.join(", ")}`}`)
process.exit(failures.length === 0 ? 0 : 1)
