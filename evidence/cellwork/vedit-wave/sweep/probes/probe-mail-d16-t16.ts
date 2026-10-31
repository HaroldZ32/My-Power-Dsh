// T9 SWEEP PROBE 1 — T16 (a failed `wake`-record append) and the D16 family (team-scoped bound).
//
// Run: .toolchain/node_modules/.bin/bun evidence/cellwork/vedit-wave/sweep/probes/probe-mail-d16-t16.ts
// Scratch workspaces live under mktemp (R9); only this probe's LOG lands under evidence/.
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendCellMail,
  cellMailPath,
  deliverCellMail,
  foldCellMail,
  readCellMail,
  unreadFor,
  wakeFailures,
} from "../../../../../packages/mpd-cellwork-plugin/src/mail.ts"
import {
  appendRecord,
  fold,
  markDelivered,
  markRead,
  readMailbox,
  scopeToTeam,
  send,
  summarise,
  undeliveredOf,
  unreadOf,
} from "../../../../../packages/mpd-team-core-plugin/src/mailbox-store.ts"

/** One checklist result line, collected for the summary. */
const results: Array<{ id: string; ok: boolean; detail: string }> = []

/**
 * Record one sweep verdict.
 * @param id - the checklist id.
 * @param ok - whether it passed.
 * @param detail - the observed value.
 */
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail })
  console.log((ok ? "PASS" : "FAIL") + " " + id + " — " + detail)
}

/** A fresh temp workspace under the OS temp root (R9). */
function tempWorkspace(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mpd-sweep1-" + tag + "-"))
  if (dir === "/home/haroldzhao/MyProj/DshProj/My-Power-Dsh") throw new Error("refusing to use the checkout root as a probe workspace")
  return dir
}

/** Whether this process can actually be denied a write by a read-only file (a root runner cannot). */
const CAN_DENY = typeof process.getuid === "function" && process.getuid() !== 0

// ===================================================================================================
// T16 — a wake is reported sent only when the transport accepted it AND its `wake` record landed.
// ===================================================================================================
{
  const ws = tempWorkspace("t16-record")
  const cellId = "cell-t16"
  const at = "2026-10-31T06:00:00.000Z"
  const path = cellMailPath(ws, cellId)
  /** The order the three delivery steps ran in. */
  const order: string[] = []
  const delivery = await deliverCellMail({
    appendSend: () => { order.push("send"); return appendCellMail(ws, cellId, { t: "send", id: "m1", cellId, from: "captain", to: "cell-planner", subject: "s", body: "b", at, wakeSent: false }) },
    attemptWake: async () => {
      order.push("wake-attempt")
      // ONLY the wake-record append fails: the send row is already on disk, and the FILE (not the
      // directory) is made read-only during the async attempt, so EACCES hits the second append.
      if (CAN_DENY) chmodSync(path, 0o444)
      return { sent: true }
    },
    appendWake: (outcome) => { order.push("wake-record"); return appendCellMail(ws, cellId, { t: "wake", id: "m1", sent: outcome.sent, at }) },
  })
  const records = readCellMail(ws, cellId)
  const folded = foldCellMail(records)
  const unread = unreadFor(folded, ["cell-planner"])
  const failed = wakeFailures(folded)
  const reason = String(delivery.wakeReason ?? "")
  check("T16/record-failure",
    CAN_DENY && delivery.landed === true && delivery.wakeSent === false
      && reason.includes("record could not be written") && !reason.includes("transport refused")
      && JSON.stringify(records.map((record) => record.t)) === '["send"]'
      && folded.length === 1 && folded[0].wakeSent === false && folded[0].read === false
      && unread.length === 1 && failed.length === 1
      && JSON.stringify(order) === '["send","wake-attempt","wake-record"]',
    JSON.stringify({ canDeny: CAN_DENY, landed: delivery.landed, wakeSent: delivery.wakeSent, wakeReason: reason.slice(0, 220), rawLogTypes: records.map((record) => record.t), folded: folded.map((message) => ({ id: message.id, wakeSent: message.wakeSent, read: message.read })), unread: unread.length, wakeFailures: failed.length, order }))
  if (CAN_DENY) chmodSync(path, 0o644)

  // TRANSPORT FAILURE: the wake record LANDS and carries the transport's refusal — the two failures
  // must be distinguishable in the answer's text.
  const ws2 = tempWorkspace("t16-transport")
  const transportDelivery = await deliverCellMail({
    appendSend: () => appendCellMail(ws2, cellId, { t: "send", id: "m2", cellId, from: "captain", to: "cell-planner", subject: "s", body: "b", at, wakeSent: false }),
    attemptWake: async () => ({ sent: false, reason: "the transport refused it: member is inactive" }),
    appendWake: (outcome) => appendCellMail(ws2, cellId, { t: "wake", id: "m2", sent: outcome.sent, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }), at }),
  })
  const transportFolded = foldCellMail(readCellMail(ws2, cellId))
  const transportReason = String(transportDelivery.wakeReason ?? "")
  check("T16/transport-failure",
    transportDelivery.landed === true && transportDelivery.wakeSent === false
      && transportReason.includes("transport") && transportReason !== reason
      && transportFolded.length === 1 && transportFolded[0].wakeSent === false && transportFolded[0].read === false,
    JSON.stringify({ wakeSent: transportDelivery.wakeSent, wakeReason: transportReason, recordFailureReason: reason.slice(0, 80), distinguishable: transportReason !== reason, folded: transportFolded.map((message) => ({ wakeSent: message.wakeSent, read: message.read })) }))

  // D6 ORDERING + the send-append failure path (unchanged): nothing is woken for a row that never landed.
  const ws3 = tempWorkspace("t16-sendfail")
  /** The steps of the failed-send arm. */
  const failedOrder: string[] = []
  const sendFailed = await deliverCellMail({
    appendSend: () => { failedOrder.push("send"); return false },
    attemptWake: async () => { failedOrder.push("wake-attempt"); return { sent: true } },
    appendWake: () => { failedOrder.push("wake-record"); return true },
  })
  check("D6/durable-first",
    sendFailed.landed === false && sendFailed.wakeSent === false
      && String(sendFailed.wakeReason ?? "").includes("durable")
      && JSON.stringify(failedOrder) === '["send"]' && !existsSync(cellMailPath(ws3, cellId)),
    JSON.stringify({ landed: sendFailed.landed, wakeSent: sendFailed.wakeSent, wakeReason: sendFailed.wakeReason, order: failedOrder, logExists: existsSync(cellMailPath(ws3, cellId)) }))

  rmSync(ws, { recursive: true, force: true })
  rmSync(ws2, { recursive: true, force: true })
  rmSync(ws3, { recursive: true, force: true })
}

// ===================================================================================================
// D16 / D16b — the bound and the unread fold are TEAM-SCOPED and share the outstanding predicate.
// ===================================================================================================
{
  const ws = tempWorkspace("d16")
  const at = "2026-10-31T06:00:00.000Z"
  /** One `send` record in the shape the mailbox log stores. */
  const rec = (id: string, teamId?: string) => ({ t: "send" as const, id, fromId: "M2", fromName: "Member B", toId: "M1", toName: "Member A", subject: "job " + id, body: "b", at, ...(teamId === undefined ? {} : { teamId }) })
  for (let index = 1; index <= 8; index += 1) appendRecord(ws, rec("A" + String(index), "team-A"))
  for (let index = 1; index <= 8; index += 1) appendRecord(ws, rec("B" + String(index), "team-B"))
  for (let index = 1; index <= 5; index += 1) appendRecord(ws, rec("L" + String(index)))

  /** The send input used by every bound arm; the bound is the value the tool passes. */
  const sendInput = { fromId: "M2", fromName: "Member B", toId: "M1", toName: "Member A", subject: "next", body: "b", memberIds: ["M1", "M2"], teamId: "team-A", maxUndelivered: 8 }
  const state = readMailbox(ws)
  const scoped = scopeToTeam(state, "team-A")
  check("D16/scope",
    scoped.messages.length === 8 && undeliveredOf(scoped, "M1").length === 8
      && !scoped.messages.some((message) => message.teamId !== "team-A")
      && scopeToTeam(state, undefined).messages.length === 21,
    JSON.stringify({ scopedRows: scoped.messages.length, undelivered: undeliveredOf(scoped, "M1").length, wholeFold: scopeToTeam(state, undefined).messages.length, retiredTeamRows: state.messages.filter((message) => message.teamId === "team-B").length, legacyRows: state.messages.filter((message) => message.teamId === undefined).length }))

  const full = send(ws, sendInput, new Date(at))
  check("D16/bound-refusal", full.ok === false && full.reason === "backlog-full",
    JSON.stringify(full.ok === false ? { reason: full.reason, detail: full.detail.slice(0, 160) } : full))

  markRead(ws, ["A1"], new Date(at))
  const afterAck = send(ws, sendInput, new Date(at))
  check("D16/ack-frees", afterAck.ok === true,
    "one ack frees exactly one slot: send ok=" + String(afterAck.ok) + (afterAck.ok ? "" : " reason=" + String(afterAck.reason)))

  markDelivered(ws, ["A2"], new Date(at))
  const afterDelivery = send(ws, sendInput, new Date(at))
  check("D16/delivery-frees", afterDelivery.ok === true,
    "one delivery frees exactly one slot: send ok=" + String(afterDelivery.ok) + (afterDelivery.ok ? "" : " reason=" + String(afterDelivery.reason)))

  // A workspace where team-A has exactly 7 outstanding and the legacy rows would overflow the bound if
  // they counted at all: the send is accepted, so an unstamped row counts for nobody.
  const ws2 = tempWorkspace("d16-legacy")
  for (let index = 1; index <= 7; index += 1) appendRecord(ws2, rec("A" + String(index), "team-A"))
  for (let index = 1; index <= 5; index += 1) appendRecord(ws2, rec("L" + String(index)))
  const legacySend = send(ws2, sendInput, new Date(at))
  check("D16/legacy-excluded", legacySend.ok === true,
    "5 unstamped rows do not count against a team's bound (7 outstanding + send accepted): " + JSON.stringify(legacySend.ok === true ? { id: legacySend.message.id, teamId: legacySend.message.teamId } : { reason: legacySend.reason, detail: legacySend.detail }))
  rmSync(ws2, { recursive: true, force: true })

  // The summary's `undelivered` column is the SAME predicate, team-scoped.
  const scopedNow = scopeToTeam(readMailbox(ws), "team-A")
  const summary = summarise(scopedNow).find((row) => row.memberId === "M1")
  const expectedOutstanding = undeliveredOf(scopedNow, "M1").length
  check("D16/summary-predicate", summary !== undefined && summary.undelivered === expectedOutstanding,
    JSON.stringify({ summaryUndelivered: summary?.undelivered, predicateCount: expectedOutstanding, unread: summary?.unread, total: summary?.total }))

  // D16b: the unread fold is TEAM-scoped, so a retired team's M1 rows are not this team's unread mail.
  const unread = unreadOf(scopeToTeam(readMailbox(ws), "team-A"), "M1")
  check("D16b/unread-scoped",
    unread.length > 0 && unread.every((message) => message.teamId === "team-A") && !unread.some((message) => message.id.startsWith("B") || message.id.startsWith("L")),
    JSON.stringify({ unread: unread.length, ids: unread.slice(0, 3).map((message) => message.id), teams: [...new Set(unread.map((message) => message.teamId))] }))
  rmSync(ws, { recursive: true, force: true })
}

// D16c (self `unread` resolves the roster member id) lives in the team-core mail TOOL handler, which
// needs a harness session; it is verified by inspecting the handler and by the lane's own pr42 test,
// and is marked as inspection in the sweep document rather than claimed as probed here.

const failed = results.filter((row) => !row.ok)
console.log("SUMMARY " + JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.map((row) => row.id) }))
process.exit(failed.length === 0 ? 0 : 1)
