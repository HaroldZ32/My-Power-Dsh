// t44 independent driver. Parameterized by module path so the SAME assertions run against
// the shipped (fixed) module and against a reverted copy of the pre-fix module.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const arg = process.argv[2] ?? 'packages/mpd-agent-teams-plugin/lib/state.js'
const modulePath = resolve(process.cwd(), arg)
const state = await import(pathToFileURL(modulePath).href)
const { enqueueInterjection, readPendingInterjections, readMailbox, decideInterjection, expireInterjections, INTERJECTION_QUEUE, INTERJECTION_TTL_MS } = state

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 't44-'))
  const stateRoot = join(root, '.mpd', 'team')
  const TEAM = 't44'
  mkdirSync(join(stateRoot, TEAM, 'inbox'), { recursive: true })
  writeFileSync(join(stateRoot, TEAM, 'team.json'), JSON.stringify({ id: TEAM, name: 't44', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, phase: 'running', members: [], tasks: [] }))
  return { stateRoot, TEAM }
}
const out = { modulePath }

// (1) ORIGINAL FAILING CALL SHAPE from t38: NO content field at all
{
  const { stateRoot, TEAM } = fixture()
  let returned, thrown
  try { returned = await enqueueInterjection(stateRoot, TEAM, { id: 'ij-nc', from: 'Junior Engineer', summary: 'only a summary', reason: 'r', location: 'l', ts: 1_000 }) }
  catch (error) { thrown = String(error.message) }
  const pending = await readPendingInterjections(stateRoot, TEAM)
  let decideResult
  try { decideResult = (await decideInterjection(stateRoot, TEAM, 'ij-nc', 'approved', { now: 2_000 })).status } catch (error) { decideResult = 'THREW: ' + String(error.message).slice(0, 80) }
  out.originalFailingShape = {
    returnedStatus: returned?.status ?? null,
    threw: thrown ?? null,
    readableAsPending: pending.length,
    normalizedContent: pending[0]?.content ?? null,
    decideResult,
    invisibleRecordPath: (returned?.status === 'pending' && pending.length === 0),
  }
}

// (2) DECIDE's two error cases
{
  const { stateRoot, TEAM } = fixture()
  let absentError
  try { await decideInterjection(stateRoot, TEAM, 'nope', 'approved', { now: 1 }) } catch (error) { absentError = String(error.message) }
  writeFileSync(join(stateRoot, TEAM, 'inbox', INTERJECTION_QUEUE + '.jsonl'), JSON.stringify({ id: 'broken', from: 'Lead', to: INTERJECTION_QUEUE, kind: 'interjection-request', status: 'pending', ts: 1, expiresAt: 2 }) + '\n')
  const shapeFilteredOut = await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)
  let malformedError
  try { await decideInterjection(stateRoot, TEAM, 'broken', 'approved', { now: 3 }) } catch (error) { malformedError = String(error.message) }
  out.decideTwoCases = {
    absentError, malformedError,
    normalReaderSeesMalformed: shapeFilteredOut.length,
    distinguishable: typeof absentError === 'string' && typeof malformedError === 'string' && /MALFORMED/.test(malformedError) && !/MALFORMED/.test(absentError),
  }
}

// (3) identity fields are required and rejected loudly
{
  const { stateRoot, TEAM } = fixture()
  const errs = {}
  for (const [name, req] of [['id', { from: 'Lead', ts: 1 }], ['from', { id: 'x', ts: 1 }], ['ts', { id: 'x', from: 'Lead' }]]) {
    try { await enqueueInterjection(stateRoot, TEAM, req); errs[name] = 'NO ERROR' } catch (error) { errs[name] = String(error.message) }
  }
  out.requiredFields = { errors: errs, noHalfWrittenRecord: (await readPendingInterjections(stateRoot, TEAM)).length === 0 }
}

// (4) expiry with `from` preserved, on a normalized (content-less) request
{
  const { stateRoot, TEAM } = fixture()
  const ts = 5_000
  await enqueueInterjection(stateRoot, TEAM, { id: 'ij-ttl', from: 'Junior Engineer', reason: 'only reason', ts })
  const expired = await expireInterjections(stateRoot, TEAM, { now: ts + INTERJECTION_TTL_MS })
  const record = (await readMailbox(stateRoot, TEAM, INTERJECTION_QUEUE)).find((r) => r.id === 'ij-ttl')
  out.expiry = { expiredIds: expired, status: record?.status ?? null, fromPreserved: record?.from ?? null, stillPending: (await readPendingInterjections(stateRoot, TEAM)).length }
}

console.log(JSON.stringify(out, null, 2))
