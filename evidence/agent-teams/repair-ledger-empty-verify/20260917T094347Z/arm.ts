// LANE A arm — a quality-kind task whose contract declares ZERO verify commands.
// Measures the REAL module (imported in place, never a copy):
//   packages/mpd-agent-teams-plugin/lib/quality-gates.js :: evaluateQualityCompletion
const MODULE = new URL('../../../../packages/mpd-agent-teams-plugin/lib/quality-gates.js', import.meta.url);
const { evaluateQualityCompletion } = await import(MODULE.href);
console.log(`MODULE ${MODULE.pathname} (resolved from this script, not from cwd)\n`);

const SCOPE = 'evidence/planning/friction-p2-wave-2b-plan/20260917T0945Z-wave-2b-plan.md';
const ACCEPTANCE = ['A1 the amendment is on disk', 'A2 every changed path is in scope'];
const PASSED = ACCEPTANCE.map((criterion) => ({ criterion, status: 'passed' }));
const CHANGED = [SCOPE];

const task = (verify) => ({
  id: 't3', kind: 'repair', status: 'in_progress',
  acceptance: ACCEPTANCE, verify,
  inScope: ['evidence/planning/**'], outOfScope: [],
  findings: [{ id: 'T3-GATE-1', severity: 'blocker', problem: 'p', requiredFix: 'f' }],
  sourceTaskId: 't2', sourceFindingIds: ['PLAN-F-1'],
});

const cases = [
  ['A  verify=[]      + commandsRun OMITTED   (the t3 shape)',
    task([]), { status: 'completed', acceptanceResults: PASSED, changedPaths: CHANGED }],
  ['B  verify=[]      + commandsRun=[]        (same shape, explicit empty list)',
    task([]), { status: 'completed', acceptanceResults: PASSED, commandsRun: [], changedPaths: CHANGED }],
  ['C  verify=[1 cmd] + commandsRun OMITTED   (control: the message SHOULD be about a command)',
    task(['bun run verify:docs']), { status: 'completed', acceptanceResults: PASSED, changedPaths: CHANGED }],
  ['D  verify=[1 cmd] + that command FAILED   (control: must fail the task)',
    task(['bun run verify:docs']), { status: 'completed', acceptanceResults: PASSED, changedPaths: CHANGED,
      commandsRun: [{ command: 'bun run verify:docs', status: 'failed' }] }],
  ['E  verify=[1 cmd] + that command PASSED   (control: must complete)',
    task(['bun run verify:docs']), { status: 'completed', acceptanceResults: PASSED, changedPaths: CHANGED,
      commandsRun: [{ command: 'bun run verify:docs', status: 'passed' }] }],
];

for (const [label, t, u] of cases) {
  const r = evaluateQualityCompletion(structuredClone(t), structuredClone(u));
  console.log(`${label}\n    -> ${JSON.stringify(r)}`);
}
