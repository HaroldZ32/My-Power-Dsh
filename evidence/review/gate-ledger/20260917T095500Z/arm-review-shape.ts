#!/usr/bin/env node
// REVIEWER'S OWN ARM (code-reviewer, 2b): does the no-code exit lane A measured for a REPAIR task
// also hold for the shape MY seat uses — kind='review' with a verdict? Imported IN PLACE (never a copy).
const MODULE = new URL('../../../../packages/mpd-agent-teams-plugin/lib/quality-gates.js', import.meta.url)
const { evaluateQualityCompletion, taskKindOf } = await import(MODULE.href)
console.log(`MODULE ${MODULE.pathname}`)

const ACCEPTANCE = ['A1 the surface presents one mechanism', 'A2 the pin can redden']
const PASSED = ACCEPTANCE.map((criterion) => ({ criterion, status: 'passed' }))
const FAILING = [{ id: 'R-1', severity: 'low', problem: 'p', requiredFix: 'f' }]
const review = (extra = {}) => ({
  id: 'tR', kind: 'review', status: 'in_progress', acceptance: ACCEPTANCE, verify: [],
  inScope: ['evidence/review/**'], outOfScope: [], reviewedTaskId: 'tX', ...extra,
})

const cases = [
  ['A review, verify=[], commandsRun OMITTED, verdict=pass        (the no-code shape, omitted list)',
    review(), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED }],
  ['B review, verify=[], commandsRun=[], verdict=pass             (explicit empty list)',
    review(), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED, commandsRun: [] }],
  ['C review, verify=[1 cmd], command FAILED, verdict=pass        (control: must FAIL the task)',
    review({ verify: ['bun test x'] }), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED, commandsRun: [{ command: 'bun test x', status: 'failed' }] }],
  ['D review, verify=[1 cmd], command PASSED, verdict=pass        (control: must complete)',
    review({ verify: ['bun test x'] }), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED, commandsRun: [{ command: 'bun test x', status: 'passed' }] }],
  ['E review, verify=[], commandsRun=[], NO verdict               (must refuse: review needs a verdict)',
    review(), { status: 'completed', acceptanceResults: PASSED, commandsRun: [] }],
  ['F review, verify=[], commandsRun=[], verdict=needs_revision + findings (must FAIL the task)',
    review(), { status: 'completed', verdict: 'needs_revision', acceptanceResults: PASSED, commandsRun: [], findings: FAILING }],
  ['G review, verify=[], commandsRun=[], verdict=pass, NO acceptanceResults (must refuse)',
    review(), { status: 'completed', verdict: 'pass', commandsRun: [] }],
]

// The KIND MATRIX: lane A measured the repair shape; the remaining quality kinds decide whether the
// "zero verify commands" refusal is a property of the gate or of the repair kind alone.
const other = (kind) => ({
  id: 'tK', kind, status: 'in_progress', acceptance: ACCEPTANCE, verify: [],
  inScope: ['packages/mpd-agent-teams-plugin/lib/**'], outOfScope: [],
})
for (const kind of ['implementation', 'repair', 'verification', 'integration', 'requirements', 'plan']) {
  const base = other(kind), upd = { status: 'completed', acceptanceResults: PASSED, verdict: 'pass', changedPaths: ['packages/mpd-agent-teams-plugin/lib/state.js'] }
  const a = evaluateQualityCompletion(structuredClone(base), structuredClone(upd))
  const b = evaluateQualityCompletion(structuredClone(base), { ...structuredClone(upd), commandsRun: [] })
  const c = evaluateQualityCompletion(structuredClone(base), { ...structuredClone(upd), commandsRun: [{ command: 'x', status: 'failed' }] })
  cases.push([`H[${kind}] verify=[], commandsRun OMITTED / [] / one FAILED  (kind matrix)`, base, { status: 'completed', acceptanceResults: PASSED, verdict: 'pass', changedPaths: ['packages/mpd-agent-teams-plugin/lib/state.js'], __matrix: [a, b, c] }])
}

for (const [label, task, update] of cases) {
  let r
  if (update.__matrix) {
    console.log(`${label}\n    kindOf=${taskKindOf(task)}`)
    console.log(`      omitted -> ${JSON.stringify(update.__matrix[0])}`)
    console.log(`      []      -> ${JSON.stringify(update.__matrix[1])}`)
    console.log(`      1 FAILED-> ${JSON.stringify(update.__matrix[2])}`)
    continue
  }
  try { r = evaluateQualityCompletion(structuredClone(task), structuredClone(update)) } catch (e) { r = { threw: String(e.message).slice(0, 160) } }
  console.log(`${label}\n    kindOf=${taskKindOf(task)} -> ${JSON.stringify(r)}`)
}
