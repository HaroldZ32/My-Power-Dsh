// L3 (t5) gate-advisory probe — INDEPENDENT evidence beside the bun test suite.
//
// What it proves (user clause 4 / plan D1, contract §4.1-§4.3):
//   1. routeDecision directions: simple -> none, SOFT trigger -> advise, explicit
//      `team:` / `!team` -> provision, mode auto -> provision, mode instruct -> instruct,
//      autoRoute off -> none, and the plan-artifact signal (D) -> advise.
//   2. The advisory notice: same marker, user role, fired signals named, "NO team was
//      staged", the on-demand staging path named, the solo half named, and NO mention of
//      automatic approval (clause-3 consistency).
//   3. installSessionTeamPolicy on a real (temp) workspace: the notice IS spliced into the
//      decision AND no team state is created anywhere under the state root.
// Run from the repo root: `node evidence/ulw/l3-gate-advisory/<ts>/probe.mjs`.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STARTUP_NOTICE_MARKER, advisoryNotice, installSessionTeamPolicy, routeDecision } from '../../../../packages/mpd-agent-teams-plugin/lib/session-start.js';
import { createMessage } from '../../../../packages/mpd-agent-teams-plugin/_deps/dsh-llm/lib/index.js';

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail });

const SIMPLE = 'Reply with exactly: hello-ok';
const SOFT = '1. Read the patch file\n2. Audit the gates\n3. Implement the change\n4. Verify the boot';

const workspace = mkdtempSync(join(tmpdir(), 'l3-gate-advisory-'));
mkdirSync(join(workspace, '.mpd', 'plans'), { recursive: true });
writeFileSync(join(workspace, '.mpd', 'plans', 'probe.md'), '# probe plan\n');

try {
    // 1. route directions ---------------------------------------------------------------
    const directions = [
        ['simple prompt -> none', { mode: 'off', autoRoute: true }, SIMPLE, '/nonexistent-ws', 'none'],
        ['SOFT trigger -> advise', { mode: 'off', autoRoute: true }, SOFT, '/nonexistent-ws', 'advise'],
        ['explicit team: -> provision', { mode: 'off', autoRoute: true }, 'team: do it', '/nonexistent-ws', 'provision'],
        ['explicit !team -> provision', { mode: 'off', autoRoute: true }, 'please !team handle it', '/nonexistent-ws', 'provision'],
        ['mode auto -> provision', { mode: 'auto' }, SIMPLE, '/nonexistent-ws', 'provision'],
        ['mode instruct -> instruct', { mode: 'instruct' }, SIMPLE, '/nonexistent-ws', 'instruct'],
        ['autoRoute off -> none', { mode: 'off', autoRoute: false }, SOFT, '/nonexistent-ws', 'none'],
        ['no user text -> none', { mode: 'off', autoRoute: true }, undefined, '/nonexistent-ws', 'none'],
        ['plan artifact (D) -> advise', { mode: 'off', autoRoute: true }, 'do the thing', workspace, 'advise'],
    ];
    const observed = [];
    for (const [name, policy, text, ws, expected] of directions) {
        const routed = await routeDecision(policy, text, ws);
        observed.push({ name, expected, action: routed.action, signals: routed.signals });
        check(name, routed.action === expected, `action=${routed.action} signals=${routed.signals.join('/')}`);
    }

    // 2. advisory notice ----------------------------------------------------------------
    const notice = advisoryNotice(['C'], { profile: 'mpd' });
    const text = notice.content[0].text;
    check('advisory is a user-role message', notice.role === 'user', `role=${notice.role}`);
    check('advisory keeps the startup marker', text.includes(STARTUP_NOTICE_MARKER), STARTUP_NOTICE_MARKER);
    check('advisory names the fired signals', text.includes('complexity signals C'), 'C');
    check('advisory states NO team was staged', text.includes('NO team was staged'), 'NO team was staged');
    check('advisory names the on-demand staging path', text.includes('agent_teams_create(approval="required", profile="mpd")'), 'agent_teams_create(approval="required", profile="mpd")');
    check('advisory names the solo half', text.includes('continue solo'), 'continue solo');
    check('advisory does not forbid automatic staging (clause 3)', !text.includes('approval="automatic"'), 'no approval="automatic"');
    check('advisory source reason', notice.source.reason === 'session-start-advisory', String(notice.source.reason));

    // 3. the shipped installer: notice in, nothing staged --------------------------------
    const listeners = [];
    const ctx = {
        on: (name, handler) => listeners.push({ name, handler }),
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    const stateDir = join('.mpd', 'team');
    installSessionTeamPolicy(ctx, { stateDir, sessionTeamPolicy: { mode: 'off', autoRoute: true, profile: 'mpd' } });
    check('installer registers exactly one pre-step listener', listeners.length === 1 && listeners[0].name === 'agent/pre-step', `${listeners.length} listener(s)`);
    const user = createMessage({ role: 'user', content: [{ type: 'text', text: SOFT }], source: { kind: 'user' } });
    const payload = { agent: { id: 'l3-probe-captain', session: { header: { cwd: workspace } } }, messages: [user] };
    const decision = await listeners[0].handler(payload, async () => ({ kind: 'enter', messages: [...payload.messages] }));
    check('decision carries claimed message + notice', decision.messages.length === 2, `${decision.messages.length} message(s)`);
    const injected = decision.messages[1];
    check('injected notice is the advisory', injected?.role === 'user' && injected?.content?.[0]?.text?.includes('NO team was staged'), injected?.content?.[0]?.text?.slice(0, 120));
    const teamIds = (() => {
        try {
            return readdirSync(join(workspace, stateDir)).filter((name) => name !== 'archive');
        }
        catch {
            return [];
        }
    })();
    check('NO team state was created', teamIds.length === 0, `state root entries: [${teamIds.join(', ')}]`);

    const ok = checks.every((entry) => entry.ok);
    console.log(JSON.stringify({ ok, checks, observed, workspace }, null, 2));
    process.exitCode = ok ? 0 : 1;
}
finally {
    rmSync(workspace, { recursive: true, force: true });
}
