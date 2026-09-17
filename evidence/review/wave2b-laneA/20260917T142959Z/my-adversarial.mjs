// t19 (reviewer, independent) — the DANGEROUS DIRECTION for the three rows lane A reports CLOSED.
// Written from the frozen acceptance's own wording, NOT from the lane's arm.mjs: its arms test the
// cases the author chose; these test the ones an author has a motive not to choose.
const MOD = new URL('../../../../packages/mpd-agent-teams-plugin/lib/', import.meta.url)
const qg = await import(new URL('quality-gates.js', MOD).href)
const st = await import(new URL('state.js', MOD).href)
const { evaluateQualityCompletion, isCommandResult } = qg
const { dependencyStates, unresolvedDependencies, unresolvedDependencyNote } = st

let bad = 0
const chk = (label, cond, detail = '') => {
  const ok = !!cond
  console.log(`${ok ? 'OK  ' : 'BAD '} ${label}${detail ? '  :: ' + detail : ''}`)
  if (!ok) bad += 1
}
const J = (v, n = 150) => JSON.stringify(v).slice(0, n)

// ---------------------------------------------------------------- T-84: is `reported` a BYPASS?
const task84 = (verify) => ({ id: 'x84', kind: 'verification', status: 'in_progress', acceptance: ['A1'], verify, inScope: ['evidence/**'], outOfScope: [] })
const pay84 = (cmds) => (cmds === undefined
  ? { status: 'completed', acceptanceResults: [{ criterion: 'A1', status: 'passed' }] }
  : { status: 'completed', acceptanceResults: [{ criterion: 'A1', status: 'passed' }], commandsRun: cmds })

const mism = evaluateQualityCompletion(task84(['bun run x']), pay84([{ command: 'A COMPLETELY DIFFERENT COMMAND', status: 'reported', reason: 'r' }]))
chk('T-84/A: a `reported` entry for a NON-verified command is REFUSED', mism.ok === false, J(mism))

const two = evaluateQualityCompletion(task84(['cA', 'cB']), pay84([{ command: 'cA', status: 'passed' }, { command: 'cB', status: 'reported', reason: 'r' }]))
chk('T-84/B: passed + reported covers TWO verify commands (the legitimate path)', two.ok === true, J(two, 110))

const omitted = evaluateQualityCompletion(task84(['bun run x']), pay84(undefined))
chk('T-84/C: OMITTED commandsRun is still refused', omitted.ok === false, J(omitted))

const blank = evaluateQualityCompletion(task84(['bun run x']), pay84([{ command: 'bun run x', status: 'reported', reason: '   ' }]))
console.log('   T-84/D: blank reason      =>', J(blank, 150), '| isCommandResult=', isCommandResult({ command: 'bun run x', status: 'reported', reason: '   ' }))

const emptyArr = evaluateQualityCompletion(task84(['bun run x']), pay84([]))
console.log('   T-84/E: empty commandsRun =>', J(emptyArr, 150))

const failedStatus = evaluateQualityCompletion(task84(['bun run x']), pay84([{ command: 'bun run x', status: 'failed' }]))
chk('T-84/F: a FAILED command still fails the task', failedStatus.ok === false && failedStatus.requiredStatus === 'failed', J(failedStatus, 110))

// ---------------------------------------------------------------- T-87: names the item AND the count?
const NINE = Array.from({ length: 9 }, (_, i) => `item-${i + 1}`)
const task87 = { id: 'x87', kind: 'implementation', status: 'in_progress', acceptance: NINE, verify: [], inScope: ['evidence/**'], outOfScope: [], changedPaths: ['evidence/a.md'] }
const pay87 = (items, statuses) => ({ status: 'completed', acceptanceResults: items.map((c, i) => ({ criterion: c, status: statuses?.[i] ?? 'passed' })), commandsRun: [], changedPaths: ['evidence/a.md'] })

const wrongName = evaluateQualityCompletion(structuredClone(task87), pay87([...NINE.slice(0, 8), 'item-9-WRONG']))
chk('T-87/A: a WRONG item (not merely missing) is refused', wrongName.ok === false, String(wrongName.error).slice(0, 170))

const unpaid = evaluateQualityCompletion(structuredClone(task87), pay87(NINE, NINE.map((_, i) => (i === 8 ? 'failed' : 'passed'))))
console.log('   T-87/B: one item UNPAID     =>', String(unpaid.error ?? J(unpaid)).slice(0, 170))

// ---------------------------------------------------------------- T-64: the acceptance names a CYCLE
const cyc = [{ id: 't1', status: 'pending', dependencies: ['t2'] }, { id: 't2', status: 'pending', dependencies: ['t1'] }]
const cycIds = unresolvedDependencies(cyc, ['t2'])
chk('T-64/A: a CYCLE is named by unresolvedDependencies (acceptance OBSERVABLE: "or a cycle")', cycIds.length > 0, `returned ${J(cycIds)}`)
const cycNote = String(unresolvedDependencyNote(cyc[0], cyc))
chk('T-64/B: the status note NAMES the deadlock', /t1|t2/.test(cycNote), `note=${J(cycNote, 60)}`)
console.log('   T-64/C: dependencyStates(cyclic t1) =>', J(dependencyStates(cyc, cyc[0].dependencies), 120))

const phantom = [{ id: 't1', status: 'completed', dependencies: [] }, { id: 't2', status: 'pending', dependencies: ['t1', 't-phantom'] }]
chk('T-64/D: the phantom id IS named (the half the lane verified)', unresolvedDependencies(phantom, phantom[1].dependencies).includes('t-phantom'))

console.log(`\nADVERSARIAL FAILURES: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
