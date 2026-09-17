// t30 (reviewer, round 2) — the DANGEROUS DIRECTION for the t29 repair:
//   (1) R5/R6: does the normalised NAME match ever ACCEPT a wrong item? (a widened exemption is the
//       shape that buys a green by weakening the guarantee)
//   (2) R3: does the cycle reader MISS a reachable cycle, or FALSELY report a legitimate graph?
const MOD = new URL('../../../packages/mpd-agent-teams-plugin/lib/', import.meta.url)
const qg = await import(new URL('quality-gates.js', MOD).href)
const st = await import(new URL('state.js', MOD).href)
const { evaluateQualityCompletion } = qg
const { unresolvedDependencies, unresolvedDependencyNote } = st

let bad = 0
const chk = (label, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'BAD '} ${label}${detail ? '  :: ' + detail : ''}`)
  if (!cond) bad += 1
}
const J = (v, n = 200) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, n)

// ---------------------------------------------------------------- (1) R5/R6 name matching
const NINE = Array.from({ length: 9 }, (_, i) => `item-${i + 1}`)
const implTask = (acceptance) => ({ id: 'r', kind: 'implementation', status: 'in_progress', acceptance, verify: [], inScope: ['evidence/**'], outOfScope: [], changedPaths: ['evidence/a.md'] })
/** required acceptance and provided criteria are SEPARATE on purpose (round 1's harness lesson). */
const run87 = (required, provided, statuses) => evaluateQualityCompletion(
  structuredClone(implTask(required)),
  { status: 'completed', acceptanceResults: provided.map((c, i) => ({ criterion: c, status: statuses?.[i] ?? 'passed' })), commandsRun: [], changedPaths: ['evidence/a.md'] },
)
console.log('--- R6 acceptance names (required vs provided kept separate) ---')
const ok9 = run87(NINE, NINE)
chk('the nine-item payload still completes', ok9.ok === true, J(ok9))
const wrong9 = run87(NINE, [...NINE.slice(0, 8), 'item-9-UNDER-A-DIFFERENT-NAME'])
chk('a WRONG 9th name (right count) is REFUSED', wrong9.ok === false, J(wrong9))
chk('...and the refusal NAMES the near-miss', /nearest provided|UNDER-A-DIFFERENT-NAME/u.test(String(wrong9.error)), J(wrong9.error, 240))
chk('case paraphrase (ITEM-9) is ACCEPTED — declared tolerance', run87(NINE, [...NINE.slice(0, 8), 'ITEM-9']).ok === true)
chk('trailing punctuation (item-9.) is ACCEPTED — declared tolerance', run87(NINE, [...NINE.slice(0, 8), 'item-9.']).ok === true)
chk('whitespace paraphrase (" item-9 ") is ACCEPTED — declared tolerance', run87(NINE, [...NINE.slice(0, 8), ' item-9 ']).ok === true)
chk('INTERNAL punctuation (item9) is REFUSED — not the same string', run87(NINE, [...NINE.slice(0, 8), 'item9']).ok === false)
chk('a duplicated provided name cannot cover two required names', run87(['a', 'A'], ['a']).ok === false, J(run87(['a', 'A'], ['a'])))
chk('two required, ONE provided entry: refused', run87(['a', 'b'], ['a']).ok === false, J(run87(['a', 'b'], ['a'])))
chk('the same name twice provided for two distinct required: refused', run87(['a', 'b'], ['a', 'a']).ok === false, J(run87(['a', 'b'], ['a', 'a'])))
console.log('   one item unpaid ->', J(run87(NINE, NINE, NINE.map((_, i) => (i === 8 ? 'failed' : 'passed'))).error, 240))

// ---------------------------------------------------------------- (2) R5 verify-command matching
const verTask = (verify) => ({ id: 'r84', kind: 'verification', status: 'in_progress', acceptance: ['A1'], verify, inScope: ['evidence/**'], outOfScope: [] })
const run84 = (verify, cmds) => evaluateQualityCompletion(structuredClone(verTask(verify)), { status: 'completed', acceptanceResults: [{ criterion: 'A1', status: 'passed' }], commandsRun: cmds })
console.log('--- R5 verify commands ---')
const wrongReported = run84(['bun run x'], [{ command: 'A COMPLETELY DIFFERENT COMMAND', status: 'reported', reason: 'r' }])
chk("round 1's hole: a WRONG-named `reported` entry is now REFUSED", wrongReported.ok === false, J(wrongReported))
chk('the legitimate labelled red still completes', run84(['bun run x'], [{ command: 'bun run x', status: 'reported', reason: 'r' }]).ok === true)
chk('a case paraphrase of the command is ACCEPTED (declared tolerance)', run84(['bun run x'], [{ command: 'BUN RUN X', status: 'passed' }]).ok === true)
const wrongPassed = run84(['bun run x'], [{ command: 'other', status: 'passed' }])
chk('a wrong-named PASSED entry is REFUSED too', wrongPassed.ok === false, J(wrongPassed))
const failedStill = run84(['bun run x'], [{ command: 'bun run x', status: 'failed' }])
chk('a FAILED command still fails the task', failedStill.ok === false && failedStill.requiredStatus === 'failed', J(failedStill))
chk('an omitted commandsRun is still refused', evaluateQualityCompletion(structuredClone(verTask(['bun run x'])), { status: 'completed', acceptanceResults: [{ criterion: 'A1', status: 'passed' }] }).ok === false)

// ---------------------------------------------------------------- (3) R3 cycle topology
console.log('--- R3 cycles ---')
const T = (id, deps, status = 'pending') => ({ id, status, dependencies: deps })
const linear = [T('t1', []), T('t2', ['t1'])]
chk('LINEAR chain: no cycle reported', unresolvedDependencies(linear, ['t1']).length === 0, J(unresolvedDependencies(linear, ['t1'])))
const two = [T('c1', ['c2']), T('c2', ['c1'])]
chk('2-cycle members are NAMED', unresolvedDependencies(two, ['c2']).length === 2, J(unresolvedDependencies(two, ['c2'])))
chk('the note prints the cycle AS ITSELF', /cycle /u.test(String(unresolvedDependencyNote(two[1], two))), J(unresolvedDependencyNote(two[1], two)))
const three = [T('a', ['b']), T('b', ['c']), T('c', ['a'])]
chk('3-cycle is reported', unresolvedDependencies(three, ['a']).length === 3, J(unresolvedDependencies(three, ['a'])))
chk('SELF-dependency is a cycle', unresolvedDependencies([T('s', ['s'])], ['s']).length > 0, J(unresolvedDependencies([T('s', ['s'])], ['s'])))
const diamond = [T('a', ['b', 'c']), T('b', ['d']), T('c', ['d']), T('d', [])]
chk('DIAMOND is NOT a cycle (no false positive)', unresolvedDependencies(diamond, ['b', 'c']).length === 0, J(unresolvedDependencies(diamond, ['b', 'c'])))
const phantom = [T('t2', ['t1', 't-phantom']), T('t1', [])]
chk('a phantom id is still named', unresolvedDependencies(phantom, phantom[0].dependencies).includes('t-phantom'))
const transit = [T('T', ['A']), T('A', ['B']), T('B', ['C']), T('C', ['B'])]
chk("a cycle THROUGH a direct dependency is named (A's own view)", unresolvedDependencies(transit, ['A']).length > 0, J(unresolvedDependencies(transit, ['A'])))
console.log(`   T's view (deps=['A'], whose subtree deadlocks B<->C): ${J(unresolvedDependencies(transit, ['A']))}  note=${J(unresolvedDependencyNote(transit[0], transit))}`)

console.log(`\nADVERSARIAL FAILURES: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
