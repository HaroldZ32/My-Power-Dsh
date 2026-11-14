// T1 — the ONE shared `!!js` generation predicate for the six team rows (contract D4).
//
// WHAT THIS FILE OWNS: the exact guard TEXT that goes into the patch rows. It is a template string
// (not a function) because the frozen deliverable is text: T2 pastes `renderGuard("old")` /
// `renderGuard("new")` verbatim into `cordis.patch.yml` and `scripts/install-profile.ts`, and this
// file is also what the unit probe evaluates. One source, no hand-copy drift.
//
// CONSTRAINTS the text obeys (all measured, see evidence output.log):
//   * It is a YAML DOUBLE-QUOTED scalar downstream: it must contain NO `"` and NO BACKSLASH.
//     Hence `String.fromCharCode(10)` for a newline and NO `\d` style regex.
//   * `!!js` is evaluated as `new Function("ctx","expr","with (ctx) { return eval(expr) }")` inside
//     `cordis-plugin-loader` (`evaluate`, used by `Entry._resolveDisabled`). So `baseUrl` is a bare
//     binding off `ctx`, `process`/`globalThis` are globals, `require`/`createRequire`/`__dirname` are
//     NOT in scope — resolution is restored through `process.getBuiltinModule("node:module")`.
//   * It NEVER throws: the outer catch returns `true` (conservative DISABLE, D4).
//   * ONE log line per process per decision: `globalThis.__mpdTeamRows` is the dedup ledger, so the
//     six rows (x their mount-decision re-evaluations) cannot flood the file.
//   * Ambiguity (no readable signal, or a presence check that sees BOTH families / NEITHER) =>
//     generation `ambiguous` => BOTH sets disabled.

/** The marker the renderer substitutes; no other occurrence exists in the body. */
const SIDE = "__SIDE__";

/**
 * The generation probe + the disable decision for ONE side, as the whole `disabled:` expression.
 *
 * Probe order (D4, literal): (1) nearest `@deepseek-ai/dsh/package.json` above `process.argv[1]`
 * (with a realpath retry, because a symlinked launcher would otherwise walk the wrong tree);
 * (2) resolution from `baseUrl` via `createRequire`; (3) package-family presence (old vs new only).
 * The FIRST readable signal wins, in that order — a later step is never consulted over an earlier one.
 */
export const GENERATION_BODY = `(() => { try {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  const os = process.getBuiltinModule('node:os');
  const read = (file) => { try { const doc = JSON.parse(fs.readFileSync(file, 'utf8')); return doc !== null && typeof doc === 'object' && doc.name === '@deepseek-ai/dsh' && typeof doc.version === 'string' ? doc : null } catch (e) { return null } };
  const harness = (start) => { try { let dir = start; for (let depth = 0; depth < 8; depth += 1) { const found = read(path.join(dir, 'package.json')) || read(path.join(dir, '@deepseek-ai', 'dsh', 'package.json')) || read(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')); if (found !== null) return found; const up = path.dirname(dir); if (up === dir) break; dir = up } } catch (e) {} return null };
  const generationOf = (version) => { if (typeof version !== 'string' || version === '') return ''; const parts = version.replace(/^v/, '').split('-'); const nums = parts[0].split('.').map(Number); if (nums.length < 3 || !isFinite(nums[0]) || !isFinite(nums[1]) || !isFinite(nums[2])) return ''; if (nums[0] !== 0) return nums[0] > 0 ? 'new' : 'old'; if (nums[1] !== 2) return nums[1] > 2 ? 'new' : 'old'; if (nums[2] !== 2) return nums[2] > 2 ? 'new' : 'old'; const pre = typeof parts[1] === 'string' ? parts[1] : ''; if (pre === '') return 'new'; const rc = pre.split('.'); if (rc[0] !== 'rc') return 'new'; const n = Number(rc[1]); return isFinite(n) && n < 2 ? 'old' : 'new' };
  const argv1 = typeof process.argv[1] === 'string' ? process.argv[1] : '';
  const realpath = (file) => { try { return fs.realpathSync(file) } catch (e) { return file } };
  const nearArgv = argv1 === '' ? null : (harness(path.dirname(argv1)) || harness(path.dirname(realpath(argv1))));
  const baseUrl = typeof ctx.baseUrl === 'string' ? ctx.baseUrl : '';
  const ancher = (anchor) => { try { return process.getBuiltinModule('node:module').createRequire(anchor) } catch (e) { return null } };
  let nearBase = null;
  if (nearArgv === null && baseUrl !== '') { try { const r = ancher(baseUrl); const file = r === null ? '' : r.resolve('@deepseek-ai/dsh/package.json'); nearBase = file === '' ? null : read(file) } catch (e) {} }
  let presence = '';
  if (nearArgv === null && nearBase === null && baseUrl !== '') { const r = ancher(baseUrl); const has = (name) => { try { const file = r === null ? '' : r.resolve(name + '/package.json'); return file !== '' } catch (e) { return false } }; const fresh = has('@deepseek-ai/dsh-agent-team'); const legacy = has('@deepseek-ai/dsh-experimental-agent-team'); presence = fresh && !legacy ? 'new' : (legacy && !fresh ? 'old' : (fresh || legacy ? 'both' : 'neither')) }
  const byArgv = nearArgv === null ? '' : generationOf(nearArgv.version);
  const byBase = nearBase === null ? '' : generationOf(nearBase.version);
  const presenceGen = presence === 'new' || presence === 'old' ? presence : '';
  let generation = byArgv !== '' ? byArgv : (byBase !== '' ? byBase : presenceGen);
  let source = byArgv !== '' ? 'argv1' : (byBase !== '' ? 'baseUrl' : (presenceGen !== '' ? 'presence' : 'none'));
  const override = typeof process.env.MPD_DSH_TEAM_ROWS === 'string' ? process.env.MPD_DSH_TEAM_ROWS.trim() : '';
  if (override === 'old' || override === 'new' || override === 'off') { generation = override === 'off' ? '' : override; source = 'override' }
  if (generation === '') generation = 'ambiguous';
  const side = ${SIDE};
  const disabled = side === 'old' ? generation !== 'old' : generation !== 'new';
  try { const ledger = globalThis.__mpdTeamRows; const marks = ledger !== null && typeof ledger === 'object' ? ledger : (globalThis.__mpdTeamRows = {}); const key = generation + '|' + source; if (marks[key] !== 1) { marks[key] = 1; const line = '[mpd-team-rows] generation=' + generation + ' source=' + source + ' argv1=' + (argv1 === '' ? '<unset>' : argv1) + ' harness=' + (nearArgv === null ? '<unreadable>' : nearArgv.version) + ' baseUrl=' + (baseUrl === '' ? '<unset>' : baseUrl) + ' baseUrlHarness=' + (nearBase === null ? '<unresolved>' : nearBase.version) + ' presence=' + (presence === '' ? '<not-read>' : presence) + ' oldRows=' + (generation === 'old' ? 'enabled' : 'disabled') + ' newRows=' + (generation === 'new' ? 'enabled' : 'disabled') + ' override=' + (override === '' ? '<unset>' : override); const roots = [process.env.MPD_MCP_LOG_DIR, process.env.DSH_WORKSPACE_ROOT, process.cwd(), os.tmpdir()]; for (let i = 0; i < roots.length; i += 1) { const root = roots[i]; if (typeof root !== 'string' || root.trim() === '') continue; try { const dir = path.join(root, '.mpd', 'logs'); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'mpd-patch-guards.log'), line + String.fromCharCode(10)); break } catch (e) {} } } } catch (e) {}
  return disabled;
} catch (e) { return true } })()`;

/**
 * Render the whole `disabled:` expression for one row side.
 * @param side `old` for the three legacy rows, `new` for the three rc.2 rows.
 * @returns The expression text, safe to place inside a YAML double-quoted scalar.
 */
export function renderGuard(side) {
  if (side !== "old" && side !== "new") throw new Error("renderGuard: side must be old or new");
  // The body above is FORMATTED for a human reader; the SHIPPED form is one line, because the whole
  // expression becomes a YAML double-quoted scalar and a newline inside it truncates the scalar
  // (measured: `yaml` reported `Missing closing "quote`). Collapsing runs of whitespace to one space
  // is safe here: no string literal in the body carries a double space, and the body holds no `//`
  // comment that a join could swallow. The unit probe evaluates THIS text, not the template.
  const text = GENERATION_BODY.replaceAll(SIDE, "'" + side + "'").replace(/\s+/g, " ");
  if (text.includes("\n") || text.includes("//")) throw new Error("renderGuard: the shipped text must stay one line and comment-free");
  return text;
}

/**
 * Compose a rows-1-2 guard: the shipped TUI-plane clause preserved VERBATIM, OR-ed with the
 * generation decision. The TUI clause keeps its own posture (a throw there is NO hit, exactly as
 * today, because a false disable would drop the team plane from a working Web profile); the
 * generation half keeps D4's posture (any throw => disabled).
 * @param tuiClause The existing `!!js` body of that row, as shipped today.
 * @param side The generation side this row serves.
 * @returns The composed expression text.
 */
export function composeTuiAndGeneration(tuiClause, side) {
  return "(() => { try { return (" + tuiClause + ") ? true : (" + renderGuard(side) + ") } catch (e) { return true } })()";
}

/** Characters that would break the downstream YAML double-quoted scalar. */
export const YAML_HAZARDS = ['"', "\\", String.fromCharCode(10)];

/**
 * Assert the rendered text is safe for a YAML double-quoted scalar and parses as one expression.
 * @param text The expression text to check.
 * @returns The reason it is unsafe, or `""` when it is clean.
 */
export function hazardOf(text) {
  for (const bad of YAML_HAZARDS) if (text.includes(bad)) return "contains " + JSON.stringify(bad);
  try {
    // Parse-only: never called. A syntax error here would take a real boot down.
    new Function("ctx", "return " + text);
  } catch (error) {
    return "does not parse: " + String(error && error.message ? error.message : error);
  }
  return "";
}

/**
 * Read a row's CURRENT `!!js` `disabled:` text out of the shipped patch, unchanged, so the rows-1-2
 * composition reuses the shipped TUI-plane clause byte for byte instead of re-typing it.
 * @param patchText The whole `cordis.patch.yml` text.
 * @param rowId The row id whose clause is wanted.
 * @returns The expression text between the surrounding double quotes.
 */
export function readTuiClause(patchText, rowId) {
  const lines = patchText.split(String.fromCharCode(10));
  const at = lines.findIndex((line) => line.trim() === "- id: " + rowId);
  if (at < 0) throw new Error("readTuiClause: row not found: " + rowId);
  for (let i = at + 1; i < Math.min(at + 10, lines.length); i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("- id: ")) break;
    if (line.startsWith("disabled: !!js ")) {
      const first = line.indexOf('"');
      const last = line.lastIndexOf('"');
      if (first < 0 || last <= first) throw new Error("readTuiClause: unquoted clause on " + rowId);
      return line.slice(first + 1, last);
    }
  }
  throw new Error("readTuiClause: no !!js disabled on " + rowId);
}
