const MODULE = new URL('../../../../packages/mpd-agent-teams-plugin/lib/quality-gates.js', import.meta.url)
const { evaluateQualityCompletion, taskKindOf } = await import(MODULE.href)
const AC = ['A1']; const PASSED = [{ criterion: 'A1', status: 'passed' }]
for (const kind of ['review', 'requirements', 'work', 'plan']) {
  const t = { id: 'tP', kind, status: 'in_progress', acceptance: AC, verify: [], inScope: ['evidence/**'], outOfScope: [] }
  const withVerdict = evaluateQualityCompletion(structuredClone(t), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED, commandsRun: [] })
  const noVerdict = evaluateQualityCompletion(structuredClone(t), { status: 'completed', acceptanceResults: PASSED, commandsRun: [] })
  const failedCmd = evaluateQualityCompletion(structuredClone(t), { status: 'completed', verdict: 'pass', acceptanceResults: PASSED, commandsRun: [{ command: 'x', status: 'failed' }] })
  console.log(`${kind.padEnd(14)} kindOf=${String(taskKindOf(t)).padEnd(14)} withVerdict=${JSON.stringify(withVerdict)} noVerdict=${JSON.stringify(noVerdict)} failedCmd=${JSON.stringify(failedCmd)}`)
}
