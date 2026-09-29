import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const R = process.cwd();
const out = {};

// t2: lifecycle-split discovery + candidate validation, re-derived from the plugin SOURCE
const manifest = readFileSync('packages/mpd-ext-plugin/src/manifest.ts', 'utf8');
out.t2 = {
  threeRoots: ['projectExtensions', 'userExtensions', 'bundleExtensionsRoot'].filter(n => manifest.includes(n)).length >= 2,
  bundleRootFromOwnLocation: /bundleRoot/.test(manifest) && /import\.meta\.url|fileURLToPath|dirname/.test(manifest),
  projectPerCall: /workspaceRoot\s*\(/.test(manifest),
  unknownKeyRejected: /descriptorKeys|unknown key/i.test(manifest),
};
// t3: bridge naming/rollback from source
const mcp = readFileSync('packages/mpd-ext-plugin/src/mcp.ts', 'utf8');
out.t3 = {
  twoPhaseSwap: /rollback|swap/i.test(mcp),
  zeroToolsOnCollision: /already registered by another tool|invalid/i.test(mcp),
  orphanReap: /kill|dispose|reap/i.test(mcp),
  connectAtApply: /connectTimeoutMs/.test(mcp),
};
// t4: the bundle patch row + install-profile rows + roster extension surface
const patch = readFileSync('packages/mpd-bundle/cordis.patch.yml', 'utf8');
out.t4 = {
  patchRow: /id:\s*mpd-ext\b/.test(patch),
  patchRowPath: /packages\/mpd-ext-plugin\/dist\/index\.js/.test(patch),
  installProfileRow: /mpd-ext/.test(readFileSync('scripts/install-profile.mjs', 'utf8')),
  rolesConsultService: /mpdExtensions/.test(readFileSync('packages/mpd-roles-plugin/src/index.ts', 'utf8')),
};
// t5: seam fix present
const idx = readFileSync('packages/mpd-ext-plugin/src/index.ts', 'utf8');
out.t5 = {
  requiredSeams: /REQUIRED_SEAMS\s*=\s*\[\s*"tools"\s*,\s*"skills"\s*\]/.test(idx),
  derivedSummary: /FATAL: only|tools registered/.test(idx),
};
// live evidence on disk: read t5's own result.json and re-check the load-bearing booleans
const lc = JSON.parse(readFileSync('evidence/extensions/extension-lifecycle/2026-09-14T17-44-41.821Z/result.json', 'utf8'));
out.t5.lifecycleEvidence = {
  ok: lc.ok, offeredExtTools: lc.steps.main.offeredExtTools, sawProjectId: lc.steps.main.sawProjectId,
  sawUserId: lc.steps.main.sawUserId, sawProjectRejection: lc.steps.main.sawProjectRejection,
  sawFlow: lc.steps.main.sawFlow, sawSkill: lc.steps.main.sawSkill, sawPersona: lc.steps.main.sawPersona,
  sawRoleChild: lc.steps.main.sawRoleChild, isolationOk: lc.steps.main.isolation?.ok, failureOk: lc.steps.failure?.ok,
  isolationArm: lc.steps.isolation?.steps ? Object.fromEntries(Object.entries(lc.steps.isolation.steps).filter(([k])=>k!=='ok').map(([k,v])=>[k,v.ok])) : (lc.steps.isolation?.ok ?? null),
  packed: lc.steps.packed ?? null,
};
const br = JSON.parse(readFileSync('evidence/extensions/extension-mcp-bridge/2026-09-14T17-45-12.656Z/result.json', 'utf8'));
out.t5.bridgeEvidence = {
  ok: br.ok, live: br.steps.live?.ok, dead: br.steps.dead?.ok, hang: br.steps.hang?.ok,
  schema: br.steps.schema?.ok, dup: br.steps.dup?.ok, containment: br.steps.containment?.ok,
  hangDurationMs: br.steps.hang?.durationMs, hangTimeoutMs: br.steps.hang?.connectTimeoutMs,
};
// raw session cross-check of the t5 lifecycle main run: the extension ids + markers in the CALL RESULTS
const rawDir = 'evidence/extensions/extension-lifecycle/2026-09-14T17-44-41.821Z/raw';
out.rawPresent = existsSync(rawDir) ? readdirSync(rawDir) : [];
out.t2.toolsRegisteredInDist = /registerTool/.test(readFileSync('packages/mpd-ext-plugin/dist/index.js','utf8'));
console.log(JSON.stringify(out, null, 1));
