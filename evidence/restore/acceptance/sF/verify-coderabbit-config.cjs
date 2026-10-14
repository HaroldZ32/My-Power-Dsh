/**
 * verify-coderabbit-config.cjs — evidence script for the `.coderabbit.yaml` wave.
 *
 * WHY THIS EXISTS
 * A CodeRabbit config fails SILENTLY: an unknown or malformed key can make CodeRabbit ignore
 * the file (or a whole section) without an error anywhere. Two mechanical checks are therefore
 * run against artefacts, never against memory:
 *   1. JSON-Schema validation with ajv in draft-2020-12 mode against CodeRabbit's PUBLISHED
 *      schema (evidence/restore/acceptance/sF/research/coderabbit-schema.v2.json).
 *   2. A key-existence walk: every object key written in the YAML must exist as a property in
 *      that schema at the same position. The schema does NOT set additionalProperties:false on
 *      the nested objects (reviews, reviews.tools, ...), so check 1 alone would let a typo like
 *      `yamllit:` pass. This walk is what closes that hole.
 *   3. A glob check over THIS repository's real tracked file list: the path_filters must exclude
 *      what the wave claims and keep everything else eligible, and each path_instructions entry
 *      must actually match files that exist.
 *
 * It is a VERIFICATION script, not a gate of the repository; it changes nothing.
 *
 * Run (needs ajv + minimatch resolvable through NODE_PATH):
 *   NODE_PATH=<dir with node_modules> node evidence/restore/acceptance/sF/verify-coderabbit-config.cjs <repo-root>
 *
 * Exit codes: 0 = every assertion held; 1 = at least one assertion failed (details on stdout).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------------------
// Tiny assertion harness: every check prints one line, and the worst outcome sets the exit.
// ---------------------------------------------------------------------------------------

/** Collected assertion results, printed in the summary at the end of the run. */
const results = [];

/**
 * Record one check.
 * @param {string} name Human-readable check name.
 * @param {boolean} ok Whether the check held.
 * @param {string} detail Evidence line quoted in the report.
 * @returns {boolean} The same `ok`, so callers can chain.
 */
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ::  ' + detail : ''}`);
  return ok;
}

/**
 * Split a CodeRabbit path-filter entry into its polarity and its glob.
 * @param {string} entry A pattern such as `!evidence/**` or `src/**`.
 * @returns {{exclude: boolean, pattern: string}} Polarity and the bare glob.
 */
function parseFilter(entry) {
  return entry.startsWith('!')
    ? { exclude: true, pattern: entry.slice(1) }
    : { exclude: false, pattern: entry };
}

/**
 * Decide whether a repository-relative path is inside the review scope.
 * Implements the documented precedence: exclusions win; a positive include restricts scope to
 * the files it matches; with no include at all every non-excluded path stays eligible.
 * @param {string} filePath Repository-relative POSIX path.
 * @param {{exclude: boolean, pattern: string}[]} filters Parsed path filter entries.
 * @param {(p: string, g: string) => boolean} mm Glob matcher (minimatch).
 * @returns {boolean} True when the path is eligible for review.
 */
function inScope(filePath, filters, mm) {
  if (filters.some((f) => f.exclude && mm(filePath, f.pattern))) return false;
  const includes = filters.filter((f) => !f.exclude);
  if (includes.length === 0) return true;
  return includes.some((f) => mm(filePath, f.pattern));
}

/**
 * Assert that every key written in the YAML exists in the schema at the same position.
 * @param {unknown} node The YAML value being walked.
 * @param {object} schema The schema node describing it.
 * @param {string} at Dotted position, for the message.
 * @param {string[]} missing Sink collecting positions that have no schema property.
 */
function walkKeys(node, schema, at, missing) {
  if (node === null || typeof node !== 'object') return;
  const props = (schema && schema.properties) || null;
  for (const [key, value] of Object.entries(node)) {
    const child = props ? props[key] : undefined;
    if (!child) {
      missing.push(`${at}${at ? '.' : ''}${key}`);
      continue;
    }
    if (Array.isArray(value)) {
      const item = child.items || {};
      value.forEach((entry, i) => walkKeys(entry, item, `${at}${at ? '.' : ''}${key}[${i}]`, missing));
    } else {
      walkKeys(value, child, `${at}${at ? '.' : ''}${key}`, missing);
    }
  }
}

const repo = process.argv[2] || process.cwd();
const here = __dirname;
const configPath = path.join(repo, '.coderabbit.yaml');
const schemaPath = path.join(here, 'research', 'coderabbit-schema.v2.json');

// ---------------------------------------------------------------------------------------
// 0. Parse the config. PyYAML was used for the wave's own parse; here the YAML is read with
//    Bun.YAML.parse so the check runs inside the same runtime as the rest of the tooling.
// ---------------------------------------------------------------------------------------
if (typeof Bun === 'undefined' || !Bun.YAML) {
  console.error('FATAL: run this script with bun (Bun.YAML.parse is the parser).');
  process.exit(2);
}
const config = Bun.YAML.parse(fs.readFileSync(configPath, 'utf8'));
check('config parses as YAML', config !== null && typeof config === 'object',
  `top-level keys: ${Object.keys(config).join(', ')}`);

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// ---------------------------------------------------------------------------------------
// 1. JSON-Schema validation (ajv, draft 2020-12).
// ---------------------------------------------------------------------------------------
let ajvOk = true;
try {
  const Ajv2020Module = require('ajv/dist/2020');
  const Ajv2020 = Ajv2020Module.default || Ajv2020Module;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  ajvOk = validate(config);
  const errs = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
  check('validates against the published JSON schema (ajv, draft 2020-12)', ajvOk,
    ajvOk ? 'no errors' : errs);
} catch (error) {
  check('validates against the published JSON schema (ajv, draft 2020-12)', false,
    `ajv unavailable or threw: ${error.message}`);
  ajvOk = false;
}

// ---------------------------------------------------------------------------------------
// 2. Key-existence walk — the check that catches a typo the schema's permissive nested
//    objects would otherwise swallow.
// ---------------------------------------------------------------------------------------
const missing = [];
walkKeys(config, schema, '', missing);
check('every key in the YAML exists in the published schema', missing.length === 0,
  missing.length === 0 ? 'no unknown keys' : `UNKNOWN: ${missing.join(', ')}`);

// ---------------------------------------------------------------------------------------
// 3. Glob checks over the real tracked file list.
// ---------------------------------------------------------------------------------------
const minimatchModule = require('minimatch');
const mm = minimatchModule.minimatch;
// maxBuffer is raised deliberately: this repository tracks ~24k paths, most of them deep
// evidence paths, and `git ls-files` overflows node's 1 MiB default with ENOBUFS.
const tracked = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  .split('\n').filter(Boolean);

const filters = config.reviews.path_filters.map(parseFilter);
const scope = tracked.filter((f) => inScope(f, filters, mm));
const out = new Set(tracked.filter((f) => !inScope(f, filters, mm)));

/**
 * Count tracked files under a directory prefix.
 * @param {string} prefix Repository-relative directory prefix such as `evidence/`.
 * @returns {number} Number of tracked files under it.
 */
const countUnder = (prefix) => tracked.filter((f) => f.startsWith(prefix)).length;
const excludedUnder = (prefix) => [...out].filter((f) => f.startsWith(prefix)).length;

check('evidence/** is fully excluded', excludedUnder('evidence/') === countUnder('evidence/'),
  `${excludedUnder('evidence/')}/${countUnder('evidence/')} tracked files excluded`);
{
  const escapees = scope.filter((f) => f.startsWith('evidence/'));
  if (escapees.length) console.log(`   evidence escapees: ${escapees.slice(0, 5).join(', ')}${escapees.length > 5 ? ` (+${escapees.length - 5} more)` : ''}`);
}
check('packages/*/dist/** is excluded',
  out.has('packages/mpd-config-plugin/dist/index.js'),
  `packages/mpd-config-plugin/dist/index.js in scope? ${scope.includes('packages/mpd-config-plugin/dist/index.js')}`);
check('VENDOR_LOCK.json is excluded', out.has('VENDOR_LOCK.json'), 'VENDOR_LOCK.json');
check('.mpd/** has no tracked files (runtime state)', countUnder('.mpd/') === 0,
  `${countUnder('.mpd/')} tracked files under .mpd/`);

// Trees that MUST stay reviewable. Each is discovered from the real tracked list, not
// hard-coded, and the assertion is "every tracked file under it is eligible" — which also
// covers the dot-segment paths under packages/*/src and skills/** that a careless global
// dot-exclusion would have swallowed.
for (const [label, glob, wantMin] of [
  ['skills/**', 'skills/**', 300],
  ['packages/*/src/**', 'packages/*/src/**', 100],
  ['packages/*/test/**', 'packages/*/test/**', 100],
  ['docker/**', 'docker/**', 50],
  ['docs/**', 'docs/**', 50],
  ['scripts/**', 'scripts/**', 10],
  ['.github/workflows/**', '.github/workflows/**', 2],
  ['extensions/**', 'extensions/**', 1],
  ['templates/**', 'templates/**', 1],
]) {
  const files = tracked.filter((f) => mm(f, glob));
  const eligible = files.filter((f) => scope.includes(f)).length;
  check(`${label} stays fully in review scope`,
    files.length >= wantMin && eligible === files.length,
    `${eligible}/${files.length} tracked files eligible (floor ${wantMin})`);
}

console.log(`\nSCOPE: ${scope.length} of ${tracked.length} tracked files eligible; ${out.size} excluded`);
console.log(`  top excluded trees: evidence/=${excludedUnder('evidence/')}, packages/*/dist=${[...out].filter((f) => /^packages\/[^/]+\/dist\//.test(f)).length}`);

// ---------------------------------------------------------------------------------------
// 4. Each path_instructions entry must bind to files that actually exist.
// ---------------------------------------------------------------------------------------
const expected = [
  ['packages/*/src/**', 'packages/mpd-config-plugin/src/index.ts', 'AGENTS.md'],
  ['skills/**', 'skills/dsh-qa/SKILL.md', 'docs/index.md'],
  ['{docs/**,README*.md,packages/*/README*.md,extensions/**/README*.md,templates/**/README*.md}', 'docs/index.md', 'AGENTS.md'],
  ['{docker/**,scripts/docker-e2e.ts,.github/workflows/**}', 'docker/Dockerfile', 'docs/index.md'],
];

config.reviews.path_instructions.forEach((entry, index) => {
  const matched = tracked.filter((f) => mm(f, entry.path));
  const [wantPath, wantFile, wantAbsent] = expected[index] || [];
  check(`path_instructions[${index}] glob matches real files`, matched.length > 0,
    `path="${entry.path}" -> ${matched.length} tracked files, e.g. ${matched.slice(0, 2).join(', ')}`);
  if (wantFile) {
    check(`path_instructions[${index}] binds ${wantFile}`, mm(wantFile, entry.path),
      `pattern=${entry.path}`);
  }
  if (wantAbsent) {
    check(`path_instructions[${index}] does NOT bind ${wantAbsent}`, !mm(wantAbsent, entry.path),
      `pattern=${entry.path}`);
  }
});

// The docs band must cover every tree the verify:docs gate discovers, and the manual itself
// must stay out of it (agent-facing, English-only by policy).
const docsEntry = config.reviews.path_instructions[2].path;
for (const p of ['docs/index.md', 'docs/deep/nested/doc.md', 'README.md', 'README.zh-CN.md',
  'packages/mpd-config-plugin/README.md', 'extensions/mpd-ext-example/README.md',
  'templates/x/README.md']) {
  check(`docs band covers ${p}`, mm(p, docsEntry), `pattern=${docsEntry}`);
}

// ---------------------------------------------------------------------------------------
// 5. Tool keys and their enabled flags must exist in the schema's tool registry.
// ---------------------------------------------------------------------------------------
const toolNames = Object.keys(schema.properties.reviews.properties.tools.properties);
for (const [tool, value] of Object.entries(config.reviews.tools)) {
  const known = toolNames.includes(tool);
  check(`tool "${tool}" exists in the schema registry (${toolNames.length} tools)`, known,
    known ? `enabled=${value.enabled}` : `NOT A KNOWN TOOL KEY`);
}

// ---------------------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
if (failed.length) {
  console.log('FAILED:');
  failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
}
process.exit(failed.length === 0 ? 0 : 1);
