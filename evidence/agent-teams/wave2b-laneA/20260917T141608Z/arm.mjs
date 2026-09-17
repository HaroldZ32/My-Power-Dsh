// Wave-2b lane A — the row arms for T-87 / T-84 / T-64, run against the REAL modules in place.
// Written BEFORE the fix, so the first run is the RED side of every control (§5: a driver with
// no red side is not an instrument).
const MOD = new URL('../../../../packages/mpd-agent-teams-plugin/lib/', import.meta.url);
const qg = await import(new URL('quality-gates.js', MOD).href);
const st = await import(new URL('state.js', MOD).href);
const { evaluateQualityCompletion, isCommandResult } = qg;
const { dependencyStates, unresolvedDependencies, unresolvedDependencyNote } = st;
const reader = async (name) => (typeof (name) === 'function');

let red = 0;
const line = (row, side, text) => console.log(`[${row}] ${side}: ${text}`);
const expect = (row, side, cond, text) => { const ok = !!cond; console.log(`  ${ok ? 'PASS' : 'FAIL'} [${row}/${side}] ${text}`); if (!ok) red += 1; };

// ---------------------------------------------------------------- T-87
// The contract stores NINE acceptance items; the display path joined 4+5 into EIGHT, so a
// payload built from the display omits one. The refusal must NAME the unmatched item + the count.
const NINE = Array.from({ length: 9 }, (_, i) => `item-${i + 1}`);
const EIGHT = NINE.slice(0, 8); // the display's join drops the ninth
const task87 = { id: 'x87', kind: 'implementation', status: 'in_progress', acceptance: NINE, verify: [], inScope: ['evidence/**'], outOfScope: [], changedPaths: ['evidence/a.md'] };
const payload = (items) => ({ status: 'completed', acceptanceResults: items.map((criterion) => ({ criterion, status: 'passed' })), commandsRun: [], changedPaths: ['evidence/a.md'] });
{
  const ok = evaluateQualityCompletion(structuredClone(task87), payload(NINE));
  line('T-87', 'green', JSON.stringify(ok).slice(0, 120));
  expect('T-87', 'green', ok.ok === true, 'a NINE-item payload built from the CURRENT contract completes');
  const bad = evaluateQualityCompletion(structuredClone(task87), payload(EIGHT));
  line('T-87', 'red', String(bad.error));
  expect('T-87', 'red', bad.ok === false, 'the EIGHT-item payload is refused');
  expect('T-87', 'red', /item-9/u.test(String(bad.error)), 'the refusal NAMES the unmatched item (item-9)');
  expect('T-87', 'red', /9/u.test(String(bad.error)) && /(8|1)/u.test(String(bad.error)), 'the refusal NAMES a count (9 required)');
}

// ---------------------------------------------------------------- T-84
// A reported red must be expressible WITHOUT a failed command, and a failed command must still fail.
const task84 = { id: 'x84', kind: 'verification', status: 'in_progress', acceptance: ['A1'], verify: ['bun run x'], inScope: ['evidence/**'], outOfScope: [] };
{
  const reported = { status: 'completed', acceptanceResults: [{ criterion: 'A1', status: 'passed' }], commandsRun: [{ command: 'bun run x', status: 'reported', reason: 'T-89 discovery surface: red reported, out of this lane scope' }] };
  const ok = evaluateQualityCompletion(structuredClone(task84), structuredClone(reported));
  line('T-84', 'green', JSON.stringify(ok).slice(0, 140));
  expect('T-84', 'green', ok.ok === true, 'a LABELLED reported red completes the task (no failed command)');
  expect('T-84', 'green', isCommandResult(reported.commandsRun[0]) === true, 'the recorded entry validates as a command result');
  const unlabelled = { ...reported, commandsRun: [{ command: 'bun run x', status: 'reported' }] };
  expect('T-84', 'red', isCommandResult(unlabelled.commandsRun[0]) === false, 'a reported entry WITHOUT a reason is refused');
  const failed = { ...reported, commandsRun: [{ command: 'bun run x', status: 'failed' }] };
  const refused = evaluateQualityCompletion(structuredClone(task84), structuredClone(failed));
  line('T-84', 'red', JSON.stringify(refused).slice(0, 120));
  expect('T-84', 'red', refused.ok === false && refused.requiredStatus === 'failed', 'a genuinely FAILED command still fails the task');
}

// ---------------------------------------------------------------- T-64
// A dependency naming no task must be reported AS ITSELF (the id), not folded into blocked/parked.
const tasks64 = [{ id: 't1', status: 'completed', dependencies: [] }, { id: 't2', status: 'pending', dependencies: ['t1', 't99-phantom'] }];
{
  const states = dependencyStates(tasks64, tasks64[1].dependencies);
  line('T-64', 'green', JSON.stringify(states));
  expect('T-64', 'green', states.blocking.includes('t99-phantom'), 'a phantom dependency still BLOCKS (nothing satisfied it - the two-bucket shape is unchanged)');
  expect('T-64', 'green', typeof unresolvedDependencies === 'function' && unresolvedDependencies(tasks64, tasks64[1].dependencies).includes('t99-phantom'), 'the exported reader names it');
  expect('T-64', 'green', typeof unresolvedDependencyNote === 'function' && /t99-phantom/u.test(String(unresolvedDependencyNote(tasks64[1], tasks64))), 'the status note names the id in its output');
  expect('T-64', 'red', !states.blocking.includes('t1'), 'a LIVE satisfied dependency is not reported as blocking (the legitimate state is not erased)');
}

// ---------------------------------------------------------------- T-64 (cycle arm; t29 / R3)
// The acceptance's OBSERVABLE names a dependency cycle alongside the phantom id: a 2-cycle among
// PENDING tasks can never be satisfied by ANY completion, so its members must be named as a cycle
// rather than read as an ordinary park. Seeded here as the row's RED side.
const cycle64 = [{ id: 'c1', status: 'pending', dependencies: ['c2'] }, { id: 'c2', status: 'pending', dependencies: ['c1'] }];
{
  const states = dependencyStates(cycle64, cycle64[0].dependencies);
  line('T-64', 'cycle', JSON.stringify(states));
  // A typeof guard, so the PRE-FIX side reports FAILs instead of crashing on a missing export.
  const noteOf = (task, tasks) => (typeof unresolvedDependencyNote === 'function' ? String(unresolvedDependencyNote(task, tasks)) : '');
  const note = noteOf(cycle64[0], cycle64);
  expect('T-64', 'cycle', states.blocking.includes('c2'), 'a cyclic dependency still BLOCKS (the parked state stays honest)');
  expect('T-64', 'cycle', typeof unresolvedDependencies === 'function' && unresolvedDependencies(cycle64, cycle64[0].dependencies).includes('c2'), 'the exported reader names the cyclic id (nothing can satisfy it)');
  expect('T-64', 'cycle', /c2/u.test(note), 'the status note names the cycle MEMBER');
  expect('T-64', 'cycle', /cycle/u.test(note), 'the note reports the cycle AS ITSELF (the word + its path)');
  expect('T-64', 'cycle', /c1\s*(?:\u2192|->)\s*c2/u.test(note) || /c2\s*(?:\u2192|->)\s*c1/u.test(note), 'the note prints the cycle PATH, not a bare id list');
  // NEGATIVE CONTROL: the same shape WITHOUT a cycle (a satisfied linear chain) is NOT called a cycle.
  const linear = [{ id: 'l1', status: 'completed', dependencies: [] }, { id: 'l2', status: 'pending', dependencies: ['l1'] }];
  expect('T-64', 'cycle-red', !/cycle/u.test(noteOf(linear[1], linear)), 'a SATISFIED linear chain is not reported as a cycle (the control)');
}

console.log(`\nRED-SIDE FAILURES: ${red}`);
process.exit(red === 0 ? 0 : 1);
