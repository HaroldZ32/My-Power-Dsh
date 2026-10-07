// t50 review (round 2, read-only, adversarial): verify what t49's repair actually changed on
// the SHIPPED modules at the revision this review pins, and what it did not.
//
// A/B method for the new repost: the pre-t49 module is materialized from HEAD (the repair is
// an uncommitted working-tree change) into a temp package copy and imported side by side.
// Scratch state lives in a temp dir; nothing outside evidence/omo-align/review-r2/** is written.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..', '..')
const PKG = join(repo, 'packages', 'mpd-agent-teams-plugin')
const STATE_JS = join(PKG, 'lib', 'state.js')
const TEAM = 'review2-team'

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const state = await import(pathToFileURL(STATE_JS).href)

const out = {
  schema: 'mpd-review-r2-probe/1',
  reviewer: 'Architect (t50, read-only)',
  anchoredFiles: {
    'packages/mpd-agent-teams-plugin/lib/state.js': { bytes: readFileSync(STATE_JS).length, sha256: sha(STATE_JS) },
  },
}

const dir = mkdtempSync(join(tmpdir(), 'mpd-review2-'))
const mk = (name) => {
  const root = join(dir, name, '.mpd', 'team')
  mkdirSync(join(root, TEAM, 'inbox'), { recursive: true })
  return root
}
const msg = (over = {}) => ({ id: `m-${Math.random().toString(16).slice(2)}`, from: 'Senior Engineer', to: 'captain', content: 'identical body', ts: 9_000_000, ...over })

// ------------------------------------------------- 1. `_folded` is transient, never persisted
{
  const root = mk('fold')
  const base = msg({ ts: 5_000_000 })
  const first = await state.appendMailboxDeduped(root, TEAM, 'captain', { ...base, id: 'rec-1' })
  const second = await state.appendMailboxDeduped(root, TEAM, 'captain', { ...base, id: 'rec-2', ts: base.ts + 1000 })
  const rawText = readFileSync(join(root, TEAM, 'inbox', 'captain.jsonl'), 'utf8')
  const rawRows = rawText.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  out.foldedMarker = {
    firstFolded: first.folded,
    secondFolded: second.folded,
    returnedMarkerOnFold: second.message._folded === true,
    rows: rawRows.length,
    rawRowKeys: Object.keys(rawRows[0]),
    markerPersisted: rawText.includes('_folded'),
    dupCount: rawRows[0].dupCount,
    reading: second.message._folded === true && !rawText.includes('_folded') && rawRows.length === 1
      ? 'TRANSIENT CONFIRMED: the marker is returned to the caller and never written; one surviving row, dupCount incremented'
      : 'the marker leaked or the fold changed shape - re-read',
  }
}

// ------------------------------------------------- 2. a fold cannot re-open an ACKNOWLEDGED record
{
  const root = mk('ackfold')
  const base = msg({ id: 'ack-1', ts: 6_000_000, to: 'member-a' })
  await state.appendMailbox(root, TEAM, 'member-a', base)
  await state.acknowledgeMailbox(root, TEAM, 'member-a', ['ack-1'])
  const unreadBefore = (await state.readUnreadMailbox(root, TEAM, 'member-a')).length
  await state.appendMailboxDeduped(root, TEAM, 'member-a', { ...base, id: 'ack-2', ts: base.ts + 500 })
  const after = await state.readMailbox(root, TEAM, 'member-a')
  out.acknowledgedThenFolded = {
    unreadBefore,
    rows: after.length,
    dupCount: after[0].dupCount,
    readAtPreserved: after[0].readAt !== undefined,
    unreadAfter: (await state.readUnreadMailbox(root, TEAM, 'member-a')).length,
    reading: after.length === 1 && after[0].readAt !== undefined && (await state.readUnreadMailbox(root, TEAM, 'member-a')).length === 0
      ? 'the fold preserves readAt, so an acknowledged record cannot be re-opened by a duplicate send (round-1 F-3 mechanism closed for this path)'
      : 'an acknowledged record was re-opened - re-read',
  }
}

// ------------------------------------------------- 3. clear keeps read markers; nothing becomes deliverable
{
  const root = mk('clear')
  for (let i = 0; i < 3; i += 1) await state.appendMailbox(root, TEAM, 'member-b', msg({ id: `c-${i}`, to: 'member-b', ts: 300 + i, content: `body-${i}` }))
  await state.acknowledgeMailbox(root, TEAM, 'member-b', ['c-0', 'c-1', 'c-2'])
  const unreadAcked = (await state.readUnreadMailbox(root, TEAM, 'member-b')).length
  const cleared = await state.clearMailboxToWatermark(root, TEAM, 'member-b', 500, { now: 1_000_000 })
  const rows = await state.readMailbox(root, TEAM, 'member-b')
  out.clearAfterAck = {
    unreadBeforeClear: unreadAcked,
    clearedIds: cleared.cleared,
    tombstoneKeys: Object.keys(rows[0] ?? {}),
    readAtPreserved: rows.every((r) => r.readAt !== undefined),
    unreadAfterClear: (await state.readUnreadMailbox(root, TEAM, 'member-b')).length,
    liveAfterClear: (await state.readLiveMailbox(root, TEAM, 'member-b')).length,
    sidecarBytes: readFileSync(cleared.sidecar, 'utf8').length,
    reading: rows.length === 3 && rows.every((r) => r.tombstone === true) && (await state.readUnreadMailbox(root, TEAM, 'member-b')).length === 0
      ? 'ROUND-1 F-3 CLOSED: tombstones keep readAt and are not unread; a clear can no longer resurrect acknowledged records'
      : 'resurrection still possible - re-read',
  }
}

// ------------------------------------------------- 4. expiry notifies the requester
{
  const root = mk('ttl')
  const ts = 8_000
  await state.enqueueInterjection(root, TEAM, { id: 'ij-ttl', from: 'Lead', reason: 'only a reason', ts })
  const beforeTtl = await state.expireInterjections(root, TEAM, { now: ts + 1000 })
  const expired = await state.expireInterjections(root, TEAM, { now: ts + state.INTERJECTION_TTL_MS })
  const queueRow = (await state.readMailbox(root, TEAM, state.INTERJECTION_QUEUE)).find((r) => r.id === 'ij-ttl')
  const notices = await state.readMailbox(root, TEAM, 'Lead')
  out.expiryNotice = {
    expiredBeforeTtl: beforeTtl,
    expiredAtTtl: expired,
    status: queueRow?.status,
    requesterInbox: notices.map((n) => ({ id: n.id, from: n.from, to: n.to, kind: n.kind ?? null, mentionsExpiry: /EXPIRED/.test(n.content) })),
    reading: expired.length === 1 && queueRow?.status === 'expired' && notices.length === 1 && notices[0].kind === undefined && /EXPIRED/.test(notices[0].content)
      ? 'ROUND-1 F-2 CLOSED: expiry flips the row to expired AND appends ONE ordinary notice (no interjection kind) to the requester'
      : 'no notice or wrong shape - re-read',
  }
}

// ------------------------------------------------- 5. closed decision vocabulary + the new repost
{
  const root = mk('decide')
  await state.enqueueInterjection(root, TEAM, { id: 'ij-ok', from: 'Junior Engineer', content: 'body-after-approval', ts: 2_000 })
  await state.enqueueInterjection(root, TEAM, { id: 'ij-bad', from: 'Lead', reason: 'r', ts: 2_000 })
  let badError = null
  try { await state.decideInterjection(root, TEAM, 'ij-bad', 'banana', { now: 3_000 }) } catch (e) { badError = e.message }
  const queueBefore = await state.readMailbox(root, TEAM, state.INTERJECTION_QUEUE)
  const approved = await state.decideInterjection(root, TEAM, 'ij-ok', 'approved', { now: 4_000 })
  const requesterInbox = await state.readMailbox(root, TEAM, 'Junior Engineer')
  let secondError = null
  try { await state.decideInterjection(root, TEAM, 'ij-ok', 'approved', { now: 5_000 }) } catch (e) { secondError = e.message }
  out.decision = {
    arbitraryDecision: { error: badError, statusStayedPending: queueBefore.find((r) => r.id === 'ij-bad')?.status },
    approvedStatus: approved?.status,
    reposted: requesterInbox.map((n) => ({ id: n.id, to: n.to, kind: n.kind ?? null, content: n.content.slice(0, 60) })),
    secondDecisionError: secondError,
    reading: /allowed values are: approved, rejected/.test(badError ?? '') && queueBefore.find((r) => r.id === 'ij-bad')?.status === 'pending' && requesterInbox.length === 1 && requesterInbox[0].id === 'ij-ok-delivery'
      ? 'ROUND-1 F-4 CLOSED (closed vocabulary, the bad row stays pending) and the approved body IS re-posted once as an ordinary record id "<ij>-delivery"'
      : 'unexpected decision shape - re-read',
  }
}

// ------------------------------------------------- 5b. V1 field contract must survive the repair
{
  const root = mk('v1')
  const enq = await state.enqueueInterjection(root, TEAM, { id: 'v1-nc', from: 'Junior Engineer', summary: 'only a summary', reason: 'R', location: 'L', ts: 2_000 })
  const pending = await state.readPendingInterjections(root, TEAM)
  const decided = await state.decideInterjection(root, TEAM, 'v1-nc', 'approved', { now: 3_000 })
  let absent = null
  let malformed = null
  let missingField = null
  try { await state.decideInterjection(root, TEAM, 'nope', 'approved', { now: 4_000 }) } catch (e) { absent = e.message }
  writeFileSync(join(root, TEAM, 'inbox', `${state.INTERJECTION_QUEUE}.jsonl`),
    JSON.stringify({ id: 'broken', from: 'Lead', to: state.INTERJECTION_QUEUE, kind: state.INTERJECTION_KIND, status: 'pending', ts: 1, expiresAt: 2 }) + '\n')
  try { await state.decideInterjection(root, TEAM, 'broken', 'approved', { now: 5_000 }) } catch (e) { malformed = e.message }
  try { await state.enqueueInterjection(root, TEAM, { from: 'Lead', ts: 1 }) } catch (e) { missingField = e.message }
  out.v1FieldContract = {
    normalizedContent: enq.content,
    returnedStatus: enq.status,
    readableAsPending: pending.length,
    decideResult: decided?.status,
    absentError: absent,
    malformedError: (malformed ?? '').slice(0, 80),
    missingFieldError: missingField,
    reading: enq.content === 'only a summary' && pending.length === 1 && /does not exist/.test(absent ?? '') && /MALFORMED/.test(malformed ?? '') && /missing required field "id"/.test(missingField ?? '')
      ? 'V1 FIELD CONTRACT HOLDS on the settled revision (normalization, readable, MALFORMED vs ABSENT, named required-field rejection)'
      : 'V1 contract regressed - re-read',
  }
}

// ------------------------------------------------- 6. A/B: is the repost NEW in t49?
{
  const tmp = mkdtempSync(join(tmpdir(), 'mpd-review2-ab-'))
  mkdirSync(join(tmp, 'pkg'), { recursive: true })
  cpSync(join(PKG, 'lib'), join(tmp, 'pkg', 'lib'), { recursive: true })
  symlinkSync(join(PKG, '_deps'), join(tmp, 'pkg', '_deps'))
  const headState = execFileSync('git', ['show', '7379e28:packages/mpd-agent-teams-plugin/lib/state.js'], { cwd: repo, maxBuffer: 32 * 1024 * 1024 })
  writeFileSync(join(tmp, 'pkg', 'lib', 'state.js'), headState)
  const oldState = await import(pathToFileURL(join(tmp, 'pkg', 'lib', 'state.js')).href)
  const rootOld = mk('ab-old')
  await oldState.enqueueInterjection(rootOld, TEAM, { id: 'ij-ab', from: 'Lead', reason: 'r', ts: 1_000 })
  await oldState.decideInterjection(rootOld, TEAM, 'ij-ab', 'approved', { now: 2_000 })
  const oldInbox = await oldState.readMailbox(rootOld, TEAM, 'Lead')
  const rootNew = mk('ab-new')
  await state.enqueueInterjection(rootNew, TEAM, { id: 'ij-ab', from: 'Lead', reason: 'r', ts: 1_000 })
  await state.decideInterjection(rootNew, TEAM, 'ij-ab', 'approved', { now: 2_000 })
  const newInbox = await state.readMailbox(rootNew, TEAM, 'Lead')
  out.repostAB = {
    preRepairRevision: '7379e28', preRepairState: { bytes: headState.length, sha256: createHash('sha256').update(headState).digest('hex') },
    preT49RequesterInboxAfterApproval: oldInbox.length,
    shippedRequesterInboxAfterApproval: newInbox.length,
    reading: oldInbox.length === 0 && newInbox.length === 1
      ? 'the pre-t49 module (7379e28, the pre-repair tip) does NOT re-post on approval while the shipped module does, so the repost is NEW in t49 and the delivered QA case (which writes its own "ij-1-delivery") was written against the older shape'
      : 'unexpected A/B shape - re-read',
  }
  rmSync(tmp, { recursive: true, force: true })
}

rmSync(dir, { recursive: true, force: true })
out.scratchRemoved = true
console.log(JSON.stringify(out, null, 2))
