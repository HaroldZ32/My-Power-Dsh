// LANE A arm (EXTENSION, 2026-09-17T09:52Z) — the KIND MATRIX for the completion ledger.
// Second seat: code-reviewer independently measured this shape in
// evidence/review/gate-ledger/20260917T095500Z/arm-full.out. This file re-derives it from the
// REAL module so both readings can be compared line by line.
const MODULE = new URL('../../../../packages/mpd-agent-teams-plugin/lib/quality-gates.js', import.meta.url);
const { evaluateQualityCompletion } = await import(MODULE.href);
const { TASK_KINDS } = await import(new URL('../../../../packages/mpd-agent-teams-plugin/lib/types.js', import.meta.url).href);
console.log(`MODULE ${MODULE.pathname}\nKINDS  ${TASK_KINDS.join(', ')}\n`);

const SCOPE = 'evidence/planning/friction-p2-wave-2b-plan/20260917T0945Z-wave-2b-plan.md';
const ACCEPTANCE = ['A1 the amendment is on disk', 'A2 every changed path is in scope'];
const PASSED = ACCEPTANCE.map((criterion) => ({ criterion, status: 'passed' }));
const task = (kind, verify) => ({
  id: 'x', kind, status: 'in_progress', acceptance: ACCEPTANCE, verify,
  inScope: ['evidence/planning/**'], outOfScope: [],
  findings: [{ id: 'F1', severity: 'blocker', problem: 'p', requiredFix: 'f' }],
});
const base = (verify) => ({ status: 'completed', acceptanceResults: PASSED, changedPaths: [SCOPE] });
const run = (kind, verify, extra = {}) => {
  const r = evaluateQualityCompletion(task(kind, verify), { ...base(verify), ...extra });
  return r.ok ? 'OK' : `REFUSED: ${r.error}${r.requiredStatus ? ' [requiredStatus=' + r.requiredStatus + ']' : ''}`;
};

console.log('== 1) verify=[] + commandsRun OMITTED ==');
for (const k of TASK_KINDS) console.log(`  ${k.padEnd(15)} ${run(k, [])}`);
console.log('\n== 2) verify=[] + commandsRun: [] ==');
for (const k of TASK_KINDS) console.log(`  ${k.padEnd(15)} ${run(k, [], { commandsRun: [] })}`);
console.log('\n== 3) verify=[one real command] + that command FAILED ==');
for (const k of TASK_KINDS) console.log(`  ${k.padEnd(15)} ${run(k, ['bun run verify:docs'], { commandsRun: [{ command: 'bun run verify:docs', status: 'failed' }] })}`);
console.log('\n== 4) kind=review verdict semantics ==');
for (const v of [undefined, 'needs_revision', 'pass']) {
  const u = { ...base([]), ...(v ? { verdict: v, findings: v === 'needs_revision' ? [{ id: 'F1', severity: 'low', problem: 'p', requiredFix: 'f' }] : [] } : {}) };
  const r = evaluateQualityCompletion(task('review', []), u);
  console.log(`  verdict=${String(v).padEnd(15)} ${r.ok ? 'OK' : `REFUSED: ${r.error}`}`);
}
console.log('\n== 5) the value `plan` is NOT a kind — it exercises the non-ledger path like `work` ==');
console.log(`  plan            ${run('plan', [])}`);
console.log(`  work            ${run('work', [])}`);
