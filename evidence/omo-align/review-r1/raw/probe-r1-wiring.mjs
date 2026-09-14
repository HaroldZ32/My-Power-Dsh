// t46 review (read-only, adversarial): falsify or confirm the R1 message-channel claims
// against the SHIPPED modules at the revision this review pins.
//
// Method notes:
//  * Every assertion below runs against packages/mpd-agent-teams-plugin/lib/*.js as they
//    exist on disk (hashes printed in the output), never against a re-implementation.
//  * The `deliverableUnread` predicate is NOT re-implemented: its body is extracted from
//    scheduler.js and re-instantiated with INTERJECTION_KIND bound, the same technique the
//    delivered QA case uses for the same predicate.
//  * Nothing outside evidence/omo-align/review-r1/** is written; scratch state lives in a
//    temp dir removed at the end.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..', '..')
const LIB = join(repo, 'packages', 'mpd-agent-teams-plugin', 'lib')
const STATE_JS = join(LIB, 'state.js')
const SCHEDULER_JS = join(LIB, 'scheduler.js')
const TOOLS_JS = join(LIB, 'tools.js')
const TEAM = 'review-team'

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const state = await import(pathToFileURL(STATE_JS).href)

const out = {
  schema: 'mpd-review-r1-probe/1',
  reviewer: 'Architect (t46, read-only)',
  anchoredFiles: Object.fromEntries([STATE_JS, SCHEDULER_JS, TOOLS_JS].map((p) => [p.replace(repo + '/', ''), {
    bytes: readFileSync(p).length,
    sha256: sha(p),
  }])),
}

// ---------------------------------------------------------------- 1. static wiring scan
// Which of the R1 primitives are reachable from the shipped runtime (tools/scheduler/members)?
const runtimeFiles = ['tools.js', 'scheduler.js', 'members.js', 'index.js', 'quality-gates.js', 'harness-compat.js']
const primitives = [
  'appendMailboxDeduped', 'clearMailboxToWatermark', 'readLiveMailbox',
  'enqueueInterjection', 'decideInterjection', 'expireInterjections',
  'readPendingInterjections', 'readInterjections',
]
const wiring = {}
for (const name of primitives) {
  const hits = []
  for (const file of runtimeFiles) {
    const text = readFileSync(join(LIB, file), 'utf8')
    text.split('\n').forEach((line, i) => {
      if (new RegExp(`\\b${name}\\b`).test(line)) hits.push(`${file}:${i + 1}`)
    })
  }
  // definition line in state.js, so the reader can subtract it
  const defLine = readFileSync(STATE_JS, 'utf8').split('\n')
    .findIndex((line) => new RegExp(`^(export )?(async )?function ${name}\\b`).test(line)) + 1
  wiring[name] = { definedAt: `state.js:${defLine}`, runtimeCallSites: hits }
}
out.staticWiring = wiring
out.staticWiringVerdict = Object.fromEntries(Object.entries(wiring).map(([k, v]) => [k, v.runtimeCallSites.length === 0 ? 'NO RUNTIME CALL SITE' : 'called']))

// the shipped send tool: which append does it use?
const toolsText = readFileSync(TOOLS_JS, 'utf8')
const toolsLines = toolsText.split('\n')
const sendToolStart = toolsLines.findIndex((l) => l.includes("name: 'agent_teams_send_message'")) + 1
out.sendToolAppendPath = {
  toolRegisteredAt: `tools.js:${sendToolStart}`,
  appendCallsInFile: toolsLines
    .map((l, i) => ({ line: i + 1, match: /await appendMailbox(\w*)\(/.exec(l)?.[1] ?? null }))
    .filter((e) => e.match !== null)
    .map((e) => `tools.js:${e.line} -> appendMailbox${e.match}`),
  importedFromState: /appendMailboxDeduped/.test(toolsText.split('\n').find((l) => l.startsWith('import {'))) ? 'Deduped IS imported' : 'Deduped is NOT imported',
}

// ------------------------------------------------- 2. dedup: shipped send path vs primitive
const dir = mkdtempSync(join(tmpdir(), 'mpd-review-r1-'))
const stateRoot = join(dir, '.mpd', 'team')
mkdirSync(join(stateRoot, TEAM, 'inbox'), { recursive: true })
const msg = (over = {}) => ({ id: `m-${Math.random().toString(16).slice(2)}`, from: 'Senior Engineer', to: 'captain', content: 'identical body', ts: 9_000_000, ...over })

// (a) what the shipped tool does: appendMailbox x3, identical key+window
for (let i = 0; i < 3; i += 1) await state.appendMailbox(stateRoot, TEAM, 'captain', msg())
const viaAppendMailbox = {
  unread: (await state.readUnreadMailbox(stateRoot, TEAM, 'captain')).length,
  records: (await state.readMailbox(stateRoot, TEAM, 'captain')).length,
}
// (b) what the primitive does in a fresh lane
for (let i = 0; i < 3; i += 1) await state.appendMailboxDeduped(stateRoot, TEAM, 'lead', msg({ to: 'lead', ts: 9_000_000 + i * 1000 }))
const viaDeduped = {
  unread: (await state.readUnreadMailbox(stateRoot, TEAM, 'lead')).length,
  records: (await state.readMailbox(stateRoot, TEAM, 'lead')).length,
  dupCount: (await state.readMailbox(stateRoot, TEAM, 'lead'))[0]?.dupCount,
}
out.dedup = {
  shippedSendPath_appendMailbox_x3: viaAppendMailbox,
  primitive_appendMailboxDeduped_x3: viaDeduped,
  reading: viaAppendMailbox.unread === 3 && viaDeduped.unread === 1
    ? 'the PRIMITIVE folds 3 sends to 1 delivery, but the SHIPPED SEND PATH (appendMailbox) still delivers 3'
    : 'unexpected shape - re-read',
}

// ------------------------------------------------- 3. tombstones on the scheduler unread path
const tombRoot = join(dir, '.mpd', 'team-tomb')
mkdirSync(join(tombRoot, TEAM, 'inbox'), { recursive: true })
for (let i = 0; i < 3; i += 1) await state.appendMailbox(tombRoot, TEAM, 'member-a', msg({ id: `t-${i}`, to: 'member-a', ts: 100 + i, content: `body-${i}` }))
const clearResult = await state.clearMailboxToWatermark(tombRoot, TEAM, 'member-a', 500, { now: 1_000_000 })
const unreadAfterClear = await state.readUnreadMailbox(tombRoot, TEAM, 'member-a')
const liveAfterClear = await state.readLiveMailbox(tombRoot, TEAM, 'member-a')

// rebuild deliverableUnread from the SHIPPED scheduler source (not re-implemented)
const schedText = readFileSync(SCHEDULER_JS, 'utf8')
const fnBody = /function deliverableUnread\(messages\)\s*\{([\s\S]*?)\n\}/.exec(schedText)?.[1]
const deliverableUnread = new Function('INTERJECTION_KIND', `return (messages) => {${fnBody}}`)(state.INTERJECTION_KIND)
const deliverable = deliverableUnread(unreadAfterClear)
out.tombstones = {
  clearedIds: clearResult.cleared,
  audit: clearResult.audit,
  sidecarBytes: readFileSync(clearResult.sidecar, 'utf8').length,
  unreadAfterClear: unreadAfterClear.map((m) => ({ id: m.id, content: m.content, kind: m.kind ?? null, tombstone: m.tombstone ?? false })),
  liveAfterClear: liveAfterClear.length,
  deliverableUnreadAfterClear: deliverable.length,
  predicateSource: fnBody?.trim(),
  reading: deliverable.length === 3
    ? 'AFTER A CLEAR the scheduler unread path still yields all 3 cleared rows (empty-content tombstones pass deliverableUnread), so the next idle edge would pack 3 empty prompts'
    : 'tombstones are excluded from the scheduler path - re-read',
}

// 3b: does the tombstone rewrite RESURRECT already-acknowledged records?
// `acknowledgeMailbox` marks a record read via `readAt`; `readUnreadMailbox` filters on
// `readAt === undefined`; the tombstone object written by the clear carries NO `readAt`.
const ackRoot = join(dir, '.mpd', 'team-ack')
mkdirSync(join(ackRoot, TEAM, 'inbox'), { recursive: true })
for (let i = 0; i < 2; i += 1) await state.appendMailbox(ackRoot, TEAM, 'member-b', msg({ id: `ack-${i}`, to: 'member-b', ts: 300 + i, content: `acked-${i}` }))
await state.acknowledgeMailbox(ackRoot, TEAM, 'member-b', ['ack-0', 'ack-1'])
const ackedUnread = (await state.readUnreadMailbox(ackRoot, TEAM, 'member-b')).length
await state.clearMailboxToWatermark(ackRoot, TEAM, 'member-b', 500, { now: 1_000_000 })
const resurrected = await state.readUnreadMailbox(ackRoot, TEAM, 'member-b')
out.tombstones.acknowledgedThenCleared = {
  unreadAfterAcknowledge: ackedUnread,
  unreadAfterClear: resurrected.length,
  deliverableAfterClear: deliverableUnread(resurrected).length,
  tombstoneFields: Object.keys(resurrected[0] ?? {}),
  reading: ackedUnread === 0 && resurrected.length === 2
    ? 'RESURRECTION CONFIRMED: the tombstone keeps id/from/to/ts but DROPS readAt, so records the recipient had already acknowledged come back as unread and pass the scheduler filter'
    : 'no resurrection observed - re-read',
}

// ------------------------------------------------- 4. V1 closure (independent reproduction)
const ijRoot = join(dir, '.mpd', 'team-ij')
mkdirSync(join(ijRoot, TEAM, 'inbox'), { recursive: true })
const enq = await state.enqueueInterjection(ijRoot, TEAM, {
  id: 'ij-nc', from: 'Junior Engineer', summary: 'only a summary', reason: 'R', location: 'L', ts: 2_000,
})
const pendingRead = await state.readPendingInterjections(ijRoot, TEAM)
const decided = await state.decideInterjection(ijRoot, TEAM, 'ij-nc', 'approved', { now: 3_000 })
let absentError = null
let malformedError = null
try { await state.decideInterjection(ijRoot, TEAM, 'nope', 'approved', { now: 4_000 }) } catch (e) { absentError = e.message }
writeFileSync(join(ijRoot, TEAM, 'inbox', `${state.INTERJECTION_QUEUE}.jsonl`),
  JSON.stringify({ id: 'broken', from: 'Lead', to: state.INTERJECTION_QUEUE, kind: state.INTERJECTION_KIND, status: 'pending', ts: 1, expiresAt: 2 }) + '\n')
try { await state.decideInterjection(ijRoot, TEAM, 'broken', 'approved', { now: 5_000 }) } catch (e) { malformedError = e.message }
// arbitrary decision string (robustness probe, NOT a declared requirement)
let arbitrary = null
try {
  await state.enqueueInterjection(ijRoot, TEAM, { id: 'ij-arb', from: 'Lead', summary: 'S', ts: 6_000 })
  arbitrary = (await state.decideInterjection(ijRoot, TEAM, 'ij-arb', 'banana', { now: 7_000 }))?.status ?? null
} catch (e) { arbitrary = `THREW: ${e.message}` }
out.v1Closure = {
  noContentEnqueue: { returnedStatus: enq.status, content: enq.content, readableAsPending: pendingRead.length, decideResult: decided?.status },
  absentError, malformedError, arbitraryDecisionStatus: arbitrary,
  reading: enq.status === 'pending' && pendingRead.length === 1 && /does not exist/.test(absentError ?? '') && /MALFORMED/.test(malformedError ?? '')
    ? 'V1 IS CLOSED on this revision: a content-less request is normalized, readable and decidable; an absent id and a malformed-but-present row raise two DIFFERENT errors'
    : 'V1 closure not reproduced - re-read',
}
// a decision string outside {approved,rejected} is persisted verbatim, which moves the row
// OUT of the pending view without making it approved or rejected
const pendingAfterBanana = await state.readPendingInterjections(ijRoot, TEAM)
let secondDecisionError = null
try { await state.decideInterjection(ijRoot, TEAM, 'ij-arb', 'approved', { now: 8_000 }) } catch (e) { secondDecisionError = e.message }
out.v1Closure.arbitraryDecisionConsequence = {
  pendingAfterArbitraryDecision: pendingAfterBanana.map((r) => `${r.id}:${r.status}`),
  secondDecisionError,
  reading: arbitrary === 'banana'
    ? 'decideInterjection persists ANY decision string as `status`: the row leaves the pending view (readPendingInterjections filters status===pending) while being neither approved nor rejected, and a later real decision is refused as "already banana". No tool layer exists to constrain the value.'
    : 'decision value is constrained - re-read',
}

// ------------------------------------------------- 5. TTL expiry reachability + notification
const ttlRoot = join(dir, '.mpd', 'team-ttl')
mkdirSync(join(ttlRoot, TEAM, 'inbox'), { recursive: true })
const ts = 8_000
await state.enqueueInterjection(ttlRoot, TEAM, { id: 'ij-ttl', from: 'Lead', reason: 'only a reason', ts })
const beforeTtl = await state.expireInterjections(ttlRoot, TEAM, { now: ts + 1000 })
const expiredIds = await state.expireInterjections(ttlRoot, TEAM, { now: ts + state.INTERJECTION_TTL_MS })
const ttlRecord = (await state.readMailbox(ttlRoot, TEAM, state.INTERJECTION_QUEUE)).find((r) => r.id === 'ij-ttl')
const requesterInboxAfterTtl = await state.readMailbox(ttlRoot, TEAM, 'Lead')
out.ttl = {
  expiredBeforeTtl: beforeTtl,
  expiredAtTtl: expiredIds,
  statusAfterTtl: ttlRecord?.status,
  fromPreserved: ttlRecord?.from,
  requesterInboxRecordsAfterTtl: requesterInboxAfterTtl.length,
  reading: requesterInboxAfterTtl.length === 0
    ? 'expiry flips the row to expired and preserves `from`, but NOTHING is written to the requester: there is no notification path, and expireInterjections has no caller in the shipped runtime'
    : 'a notification row exists - re-read',
}

rmSync(dir, { recursive: true, force: true })
out.scratchRemoved = true
console.log(JSON.stringify(out, null, 2))
