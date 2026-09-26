// t29 repair arms — the RED side of findings R5 / R6 / R7 (R3's red side lives in the row driver,
// `evidence/agent-teams/wave2b-laneA/20260917T141608Z/arm.mjs`, whose T-64 cycle arm is the pair
// `arm-cycle-before.out.txt` / `arm-cycle-after.out.txt`).
//
// Run BOTH ways: against the reverted (HEAD) lib — where every "green" arm below must FAIL — and
// against the worktree. Paths are relative to this file, so the same bytes run in either mirror.
const MOD = new URL('../../../../packages/mpd-agent-teams-plugin/lib/', import.meta.url);
const qg = await import(new URL('quality-gates.js', MOD).href);
const tools = await import(new URL('tools.js', MOD).href);

let red = 0;
const expect = (row, side, cond, text) => { const ok = !!cond; console.log(`  ${ok ? 'PASS' : 'FAIL'} [${row}/${side}] ${text}`); if (!ok) red += 1; };

const base = { inScope: ['evidence/**'], outOfScope: [], changedPaths: ['evidence/a.md'] };
const task84 = { ...base, id: 'x84', kind: 'verification', status: 'in_progress', acceptance: ['A1'], verify: ['bun run x'] };
const task84two = { ...task84, id: 'x84b', verify: ['bun run x', 'bun run y'] };
const NINE = Array.from({ length: 9 }, (_, i) => `item-${i + 1}`);
const task87 = { ...base, id: 'x87', kind: 'implementation', status: 'in_progress', acceptance: NINE, verify: [] };
const pass = (criterion) => ({ criterion, status: 'passed' });

// ── R5: a `reported` entry whose COMMAND does not name the required command must not cover it ──
{
    const wrongCommand = {
        status: 'completed',
        acceptanceResults: [pass('A1')],
        commandsRun: [{ command: 'SOME OTHER COMMAND', status: 'reported', reason: 'red by design' }],
        changedPaths: ['evidence/a.md'],
    };
    const refused = qg.evaluateQualityCompletion(structuredClone(task84), structuredClone(wrongCommand));
    console.log(`[R5] refused: ${JSON.stringify(refused).slice(0, 200)}`);
    expect('R5', 'green', refused.ok === false, 'a right-COUNT payload whose command is a DIFFERENT NAME no longer covers the required command');
    expect('R5', 'green', /SOME OTHER COMMAND|nearest provided/u.test(String(refused.error ?? '')), 'the refusal NAMES the near-miss');
    // the legitimate pair still covers, and a genuinely FAILED command still fails (the untouched pins)
    const legit = {
        status: 'completed',
        acceptanceResults: [pass('A1')],
        commandsRun: [{ command: 'bun run x', status: 'passed' }, { command: 'bun run y', status: 'reported', reason: 'known red, reported' }],
        changedPaths: ['evidence/a.md'],
    };
    expect('R5', 'control', qg.evaluateQualityCompletion(structuredClone(task84two), structuredClone(legit)).ok === true, 'the legitimate passed+reported pair still covers both commands');
    const failed = { ...legit, commandsRun: [{ command: 'bun run x', status: 'failed' }, { command: 'bun run y', status: 'reported', reason: 'r' }] };
    const refusedFailed = qg.evaluateQualityCompletion(structuredClone(task84two), structuredClone(failed));
    expect('R5', 'control', refusedFailed.ok === false && refusedFailed.requiredStatus === 'failed', 'a genuinely FAILED command still fails the task');
}

// ── R6: a same-COUNT payload whose ninth item carries a DIFFERENT NAME must be refused ──────────
{
    const wrongName = {
        status: 'completed',
        acceptanceResults: NINE.map((criterion, index) => pass(index === 8 ? 'item-9-UNDER-A-DIFFERENT-NAME' : criterion)),
        commandsRun: [],
        changedPaths: ['evidence/a.md'],
    };
    const refused = qg.evaluateQualityCompletion(structuredClone(task87), structuredClone(wrongName));
    console.log(`[R6] refused: ${JSON.stringify(refused).slice(0, 200)}`);
    expect('R6', 'green', refused.ok === false, 'a wrong-NAMED ninth item of the right COUNT is refused (the count-only reading is withdrawn)');
    expect('R6', 'green', /item-9-UNDER-A-DIFFERENT-NAME|nearest provided/u.test(String(refused.error ?? '')), 'the refusal NAMES the near-miss');
    // the paraphrase tolerance the fallback existed for STILL holds (case + surrounding whitespace)
    const paraphrase = {
        ...wrongName,
        acceptanceResults: NINE.map((criterion, index) => pass(index === 0 ? `  ${criterion.toUpperCase()}  ` : criterion)),
    };
    expect('R6', 'control', qg.evaluateQualityCompletion(structuredClone(task87), structuredClone(paraphrase)).ok === true, 'a paraphrase (case + whitespace) still passes');
    // and the exact-name path is untouched
    expect('R6', 'control', qg.evaluateQualityCompletion(structuredClone(task87), structuredClone({ ...wrongName, acceptanceResults: NINE.map(pass) })).ok === true, 'the exact-name payload still completes');
}

// ── R7: the model-facing description must name the third status and its required label ─────────
{
    const registry = new Map();
    tools.registerAgentTeamsTools({
        tools: { register: (definition) => registry.set(definition.name, definition) },
        agents: { get: () => undefined, list: () => [] },
        subagents: { prompt: async () => ({ messageId: 'm' }), followup: () => {}, sendMessage: () => {} },
        effect: () => () => undefined,
        on: () => () => undefined,
        logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        get: () => undefined,
    }, { stateDir: '.mpd/team' });
    const description = String(registry.get('agent_teams_update_task')?.parameters?.properties?.commandsRun?.description ?? '');
    console.log(`[R7] description: ${description.slice(0, 160)}`);
    expect('R7', 'green', description.includes('reported'), 'the commandsRun description names the `reported` status');
    expect('R7', 'green', /reason/u.test(description), 'the description names the required `reason` label');
}

console.log(`\nRED-SIDE FAILURES: ${red}`);
process.exit(red === 0 ? 0 : 1);
