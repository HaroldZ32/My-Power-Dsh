// t13 consistency check — does the repaired patch comment describe the SHIPPED gate?
//
// Cross-reads the two sides so a reviewer does not have to trust the prose:
//   A. packages/mpd-bundle/cordis.patch.yml      (the comment under repair)
//   B. packages/mpd-agent-teams-plugin/lib/session-start.js (the shipped behaviour, t5)
// Read-only. Run from the repo root: node evidence/ulw/l3b-patch-comment/<ts>/consistency-check.mjs
import { readFileSync } from 'node:fs';

const patch = readFileSync('packages/mpd-bundle/cordis.patch.yml', 'utf8');
const code = readFileSync('packages/mpd-agent-teams-plugin/lib/session-start.js', 'utf8');

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: ok === true, detail });

// --- the comment block under repair (between the gate header and sessionTeamPolicy) ---------
const start = patch.indexOf('# SESSION-START TEAM GATE');
const end = patch.indexOf('sessionTeamPolicy:', start);
const comment = patch.slice(start, end);
check('the gate comment block was found', start >= 0 && end > start, `${comment.split('\n').length} comment lines`);

// 1. advisory half, matching `advisoryNotice` in the code
check('comment: soft trigger is ADVISORY', /A triggered SOFT signal is ADVISORY/.test(comment), 'A triggered SOFT signal is ADVISORY');
check('comment: no team state is created', /NOTHING is staged \(no team state\s*\n?\s*#?\s*is created\)/.test(comment) || comment.includes('NOTHING is staged (no team state'), 'NOTHING is staged (no team state is created)');
check('comment: states no team was staged', comment.includes('states that no team was staged'), 'states that no team was staged');
check('comment: names the on-demand staging call', comment.includes('agent_teams_create(approval="required"'), 'agent_teams_create(approval="required"');
check('comment: names profile="mpd"', comment.includes('profile="mpd"'), 'profile="mpd"');
check('comment: names the solo half', comment.includes('continue solo and say so'), 'continue solo and say so');

// 2. predicate half, matching the code's frozen trigger
check('comment: frozen predicate', comment.includes('explicit flag OR (matchedSignals >= 1)'), 'explicit flag OR (matchedSignals >= 1)');
check('comment: >= 2 wording is gone', !/\(\s*matchedSignals >= 2\s*\)/.test(comment), 'no (matchedSignals >= 2)');
check('code: frozen predicate kept', code.includes('input.explicitFlag === true || signals.length >= 1'), 'input.explicitFlag === true || signals.length >= 1');

// 3. explicit-request half + legacy modes
check('comment: explicit request still provisions', /explicit `team:` \/ `!team`\s*\n#?\s*request still PROVISIONS/.test(comment) || comment.includes('request still PROVISIONS'), 'request still PROVISIONS');
check('comment: mode=auto opt-in kept', comment.includes('mode=auto keeps the legacy unconditional provisioning'), 'mode=auto keeps the legacy unconditional provisioning');
check('comment: mode=instruct kept', comment.includes('mode=instruct keeps the legacy instruction notice'), 'mode=instruct keeps the legacy instruction notice');

// 4. the code side names the same things the comment promises
check('code: advisoryNotice exists and is exported', /export function advisoryNotice/.test(code), 'export function advisoryNotice');
check('code: advisory notice says NO team was staged', code.includes('NO team was staged'), 'NO team was staged');
check('code: advisory notice names the same call', code.includes('agent_teams_create(approval="required", profile='), 'agent_teams_create(approval="required", profile=');
check('code: advisory notice names the solo half', code.includes('continue solo'), 'continue solo');

const ok = checks.every((entry) => entry.ok);
console.log(JSON.stringify({ ok, checks }, null, 2));
process.exitCode = ok ? 0 : 1;
