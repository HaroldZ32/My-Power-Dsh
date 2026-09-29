// t38 INDEPENDENT counter-examples against the SHIPPED R1 primitives (no reuse of the t36 case).
// Ordering is explicit: every reading is taken at the point it is asserted, and the
// engine caveats a caller-shape requirement live in the report, not hidden in the harness.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendMailboxDeduped, clearMailboxToWatermark, readMailbox, readUnreadMailbox,
  readLiveMailbox, INTERJECTION_KIND, INTERJECTION_QUEUE, enqueueInterjection,
  readPendingInterjections, expireInterjections, decideInterjection, createMessage, readInterjections,
} from '../../../../packages/mpd-agent-teams-plugin/lib/state.ts'

const out = {}
const freshTeam = (name) => {
  const root = mkdtempSync(join(tmpdir(), 't38-' + name + '-'))
  const stateRoot = join(root, '.mpd', 'team')
  const TEAM = 't38'
  mkdirSync(join(stateRoot, TEAM, 'inbox'), { recursive: true })
  writeFileSync(join(stateRoot, TEAM, 'team.json'), JSON.stringify({ id: TEAM, name, captainSessionId: 'cap', createdAt: 1, taskSeq: 0, phase: 'running', members: [{ id: 'm1', name: 'Junior Engineer', role: 'engineer', status: 'idle', joinedAt: 1 }], tasks: [] }))
  return { root, stateRoot, TEAM }
}

// shipped predicate text from scheduler.js (module-private) executed as-is
const schedSrc = readFileSync(new URL('../../../../packages/mpd-agent-teams-plugin/lib/scheduler.js', import.meta.url), 'utf8')
const predSrc = schedSrc.match(/function deliverableUnread\(messages\)\s*\{[\s\S]*?\n\}/)
if (!predSrc) { console.error('FAIL: deliverableUnread not found in shipped scheduler'); process.exit(1) }
const deliverableUnread = new Function('INTERJECTION_KIND', `return (${predSrc[0].replace('function deliverableUnread', 'function')})`)(INTERJECTION_KIND)
out.predicateExtractedFromShippedScheduler = predSrc[0].split('\n')[0].trim()

// ---------- 1) DEDUP ----------
{
  const { stateRoot, TEAM } = freshTeam('dedup')
  const same = (ts) => ({ ...createMessage('captain', 'junior-engineer', 'identical body'), ts })
  const a = await appendMailboxDeduped(stateRoot, TEAM, 'junior-engineer', same(10_000), { windowMs: 60_000 })
  const b = await appendMailboxDeduped(stateRoot, TEAM, 'junior-engineer', same(11_000), { windowMs: 60_000 })
  const c = await appendMailboxDeduped(stateRoot, TEAM, 'junior-engineer', same(12_000), { windowMs: 60_000 })
  const MSGS1 = await readMailbox(stateRoot, TEAM, 'junior-engineer')
  const UNREAD1 = await readUnreadMailbox(stateRoot, TEAM, 'junior-engineer')
  // negative 1: same content, different FROM
  const otherFrom = await appendMailboxDeduped(stateRoot, TEAM, 'junior-engineer', { ...createMessage('Lead', 'junior-engineer', 'identical body'), ts: 13_000 }, { windowMs: 60_000 })
  // negative 2: same content, different TO
  const otherTo = await appendMailboxDeduped(stateRoot, TEAM, 'captain', { ...createMessage('captain', 'captain', 'identical body'), ts: 14_000 }, { windowMs: 60_000 })
  // negative 3: same key, OUTSIDE the window
  const outWindow = await appendMailboxDeduped(stateRoot, TEAM, 'junior-engineer', same(999_999), { windowMs: 60_000 })
  const MSGS2 = await readMailbox(stateRoot, TEAM, 'junior-engineer')
  out.dedup = {
    positive: { sends: 3, folded: [a.folded, b.folded, c.folded], recordsAfterTripleSend: MSGS1.length, dupCountOnRecord: MSGS1[0]?.dupCount, unreadAfterTripleSend: UNREAD1.length },
    negative_differentFrom_folded: otherFrom.folded,
    negative_differentTo_folded: otherTo.folded,
    negative_outOfWindow_folded: outWindow.folded,
    recordsAfterNegatives: MSGS2.length,
    contents: MSGS2.map((m) => m.content),
  }
}

// ---------- 2) CLEAR TO WATERMARK ----------
{
  const { stateRoot, TEAM } = freshTeam('clear')
  const CAP = 'captain'
  for (const label of ['alpha', 'beta', 'gamma']) await appendMailboxDeduped(stateRoot, TEAM, CAP, { ...createMessage('Lead', CAP, 'payload-' + label), ts: 500 }, { windowMs: 60_000 })
  const afterAppend = await readMailbox(stateRoot, TEAM, CAP)
  const manifest = await clearMailboxToWatermark(stateRoot, TEAM, CAP, 500, { now: 999 })
  const livePath = join(stateRoot, TEAM, 'inbox', CAP + '.jsonl')
  const liveRaw = existsSync(livePath) ? readFileSync(livePath, 'utf8') : ''
  const sidecarRaw = manifest.sidecar !== undefined && existsSync(manifest.sidecar) ? readFileSync(manifest.sidecar, 'utf8') : ''
  const live = liveRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const side = sidecarRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const liveUnread = await readLiveMailbox(stateRoot, TEAM, CAP)
  out.clear = {
    appendedRecords: afterAppend.length,
    clearedCount: manifest.cleared.length,
    auditKind: manifest.audit?.kind,
    auditClearedCount: manifest.audit?.clearedCount,
    sidecarFile: manifest.sidecar ? manifest.sidecar.split('/').slice(-1)[0] : null,
    sidecarLineCount: side.length,
    sidecarRecoversPayloadVerbatim: side.map((r) => r.content).sort(),
    liveAfterClear: { recordCount: live.length, idsSurvive: live.map((r) => r.id).length, tombstones: live.filter((r) => r.tombstone === true).length, liveContentEmptied: live.filter((r) => r.tombstone === true).every((r) => r.content === ''), anyPayloadLeftLive: live.some((r) => typeof r.content === 'string' && r.content.startsWith('payload-')) },
    liveUnreadAfterClear: liveUnread.length,
  }
}

// ---------- 3) INTERJECTION: hand-placed pending request in an ORDINARY inbox ----------
{
  const { stateRoot, TEAM } = freshTeam('interjection')
  const CAP = 'captain'
  const req = await enqueueInterjection(stateRoot, TEAM, { id: 'ij-1', from: 'Junior Engineer', to: INTERJECTION_QUEUE, content: 'request body', summary: 'let me touch lib/x', reason: 'blocked on scope', location: 'lib/x', ts: 1_000 })
  const queuePendingAtEnqueue = await readPendingInterjections(stateRoot, TEAM)
  const queueAllAtEnqueue = await readInterjections(stateRoot, TEAM)
  // hand-craft: the SAME pending request written into the captain's ORDINARY inbox
  await appendMailboxDeduped(stateRoot, TEAM, CAP, { ...createMessage('Junior Engineer', CAP, 'request body'), ts: 1_000, kind: INTERJECTION_KIND, status: 'pending' }, { windowMs: 60_000 })
  const capUnread = await readUnreadMailbox(stateRoot, TEAM, CAP)
  const capDeliverable = deliverableUnread(capUnread)
  // MY negative control: break the kind on that very record -> the predicate must let it through
  const kindBroken = capUnread.map((m) => (m.kind === INTERJECTION_KIND ? { ...m, kind: 'message' } : m))
  const deliverableWhenKindBroken = deliverableUnread(kindBroken)
  // approval alone must not auto-deliver the request-shaped record
  const decided = await decideInterjection(stateRoot, TEAM, req.id, 'approved', { now: 2_000 })
  const capUnreadAfterApproval = await readUnreadMailbox(stateRoot, TEAM, CAP)
  const stillGatedAfterApproval = deliverableUnread(capUnreadAfterApproval)
  // TTL: expiry only touches the dedicated queue lane
  const expired = await expireInterjections(stateRoot, TEAM, { now: 9_999_999 })
  const queueAll = await readInterjections(stateRoot, TEAM)
  out.interjection = {
    enqueued: { returnedStatus: req.status, pendingInQueueAtEnqueue: queuePendingAtEnqueue.length, laneRecordCount: queueAllAtEnqueue.length, laneId: queueAllAtEnqueue[0]?.id, laneKind: queueAllAtEnqueue[0]?.kind },
    handPlaced: { ordinaryInboxUnread: capUnread.length, kinds: capUnread.map((m) => m.kind ?? 'message'), deliverableAfterFilter: capDeliverable.length, deliverableIdsAreOnlyPlainMessages: capDeliverable.every((m) => m.kind !== INTERJECTION_KIND) },
    negative_kindBroken_deliverable: deliverableWhenKindBroken.length,
    approval: { decidedStatus: decided.status, stillGated: stillGatedAfterApproval.length, requestShapeNeverAutoDelivered: stillGatedAfterApproval.every((m) => m.kind !== INTERJECTION_KIND) },
    ttl: { expiredIds: expired, laneStatusesAfter: queueAll.map((r) => r.status), fromPreserved: queueAll.every((r) => typeof r.from === 'string' && r.from.length > 0) },
  }
}

// ---------- 4) caller-shape caveat, measured ----------
{
  const { stateRoot, TEAM } = freshTeam('shape')
  const withoutContent = await enqueueInterjection(stateRoot, TEAM, { id: 'ij-nc', from: 'Junior Engineer', summary: 's', reason: 'r', location: 'l', ts: 1_000 })
  const pending = await readPendingInterjections(stateRoot, TEAM)
  const withContent = await enqueueInterjection(stateRoot, TEAM, { id: 'ij-wc', from: 'Junior Engineer', content: 'body', summary: 's', reason: 'r', location: 'l', ts: 1_000 })
  const pending2 = await readPendingInterjections(stateRoot, TEAM)
  let decideError = 'no error'
  try { await decideInterjection(stateRoot, TEAM, 'ij-nc', 'approved', { now: 2_000 }) } catch (error) { decideError = String(error.message) }
  out.callerShape = {
    requestWithoutContent: { returnedStatus: withoutContent.status, readableAsPending: pending.length, decideResult: decideError },
    requestWithContent: { returnedStatus: withContent.status, readableAsPending: pending2.length },
  }
}

console.log(JSON.stringify(out, null, 2))
