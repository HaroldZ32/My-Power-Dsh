// t46 review (read-only, adversarial): measure the R3 verb-table harmonisation's ACTUAL
// behavioural delta — old table vs shipped table — on the frozen calibration prompts, the
// 20 real prompts used by the false-positive measurement, and two constructed boundary
// counterexamples. Also transcribes both shipped tables and compares them to the frozen
// contract's harmonizedVerbTables.
//
// A/B method (same shape as the V1 falsifiability recipe): the PRE-R3 module is materialized
// from the named commit into a temp package copy, imported side by side with the shipped
// module, and the copy is deleted at the end — evidence keeps no stale product copy.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..', '..', '..')
const PKG = join(repo, 'packages', 'mpd-agent-teams-plugin')
const SHIPPED = join(PKG, 'lib', 'session-start.js')
const PRE_R3_COMMIT = 'facb2de^' // the commit that landed R1+R3 is facb2de; its parent is pre-R3
const CONTRACT = join(repo, 'evidence', 'omo-align', 'requirements', 'frozen-contract.json')

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const contract = JSON.parse(readFileSync(CONTRACT, 'utf8'))

const out = {
  schema: 'mpd-review-r3-ab/1',
  reviewer: 'Architect (t46, read-only)',
  anchoredFiles: {
    'packages/mpd-agent-teams-plugin/lib/session-start.js': { bytes: readFileSync(SHIPPED).length, sha256: sha(SHIPPED) },
    'evidence/omo-align/requirements/frozen-contract.json': { bytes: readFileSync(CONTRACT).length, sha256: sha(CONTRACT) },
  },
  preR3Commit: PRE_R3_COMMIT,
}

// ------------------------------------------------------------------ materialize the A side
const tmp = mkdtempSync(join(tmpdir(), 'mpd-review-r3-'))
mkdirSync(join(tmp, 'pkg'), { recursive: true })
cpSync(join(PKG, 'lib'), join(tmp, 'pkg', 'lib'), { recursive: true })
symlinkSync(join(PKG, '_deps'), join(tmp, 'pkg', '_deps'))
const oldSource = execFileSync('git', ['show', `${PRE_R3_COMMIT}:packages/mpd-agent-teams-plugin/lib/session-start.js`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 })
writeFileSync(join(tmp, 'pkg', 'lib', 'session-start.js'), oldSource)
out.preR3File = { bytes: oldSource.length, sha256: createHash('sha256').update(oldSource).digest('hex') }

const oldMod = await import(pathToFileURL(join(tmp, 'pkg', 'lib', 'session-start.js')).href)
const newMod = await import(pathToFileURL(SHIPPED).href)

// ------------------------------------------------------------------ verb sets + verbatim
const strings = (pattern) => {
  // `\b` is a zero-width assertion, not part of a verb: strip it before tokenizing, or the
  // tokenizer swallows the `b` into the following verb ("audit" -> "baudit").
  const cleaned = pattern.source.replace(/\\b/g, '|')
  return [...new Set([...cleaned.matchAll(/[A-Za-z][A-Za-z-]*|[\u4e00-\u9fff]{2}/gu)].map((m) => m[0].toLowerCase()))]
    .filter((v) => v.length >= 2)
}
const en = (list) => list.filter((v) => /^[a-z]/.test(v)).sort()
const cjk = (list) => list.filter((v) => !/^[a-z]/.test(v)).sort()
const CONJUNCTIONS = ['and', 'then', 'also']
const shown = (mod) => ({
  C2_ACTION_VERB_PATTERN: en(strings(mod.ACTION_VERB_PATTERN)),
  C2_cjk: cjk(strings(mod.ACTION_VERB_PATTERN)),
  C3_CLAUSE_ACTION_PATTERN: en(strings(mod.CLAUSE_ACTION_PATTERN)),
  // C3 also carries the optional conjunction alternatives; they are not verbs, so the
  // verb-set comparison excludes them and reports them separately.
  C3_verbs_only: en(strings(mod.CLAUSE_ACTION_PATTERN)).filter((v) => !CONJUNCTIONS.includes(v)),
  C3_conjunctions: en(strings(mod.CLAUSE_ACTION_PATTERN)).filter((v) => CONJUNCTIONS.includes(v)),
  C3_cjk: cjk(strings(mod.CLAUSE_ACTION_PATTERN)),
})
const before = shown(oldMod)
const after = shown(newMod)
const contractTables = contract.complexityGate.signals.C_enumeratedSteps.harmonizedVerbTables
const eqSet = (a, b) => a.length === b.length && a.every((v) => b.includes(v))
out.verbTables = {
  preR3: before,
  shipped: after,
  addedToC2: { en: after.C2_ACTION_VERB_PATTERN.filter((v) => !before.C2_ACTION_VERB_PATTERN.includes(v)), cjk: after.C2_cjk.filter((v) => !before.C2_cjk.includes(v)) },
  addedToC3: { en: after.C3_CLAUSE_ACTION_PATTERN.filter((v) => !before.C3_CLAUSE_ACTION_PATTERN.includes(v)), cjk: after.C3_cjk.filter((v) => !before.C3_cjk.includes(v)) },
  removedFromC2: { en: before.C2_ACTION_VERB_PATTERN.filter((v) => !after.C2_ACTION_VERB_PATTERN.includes(v)), cjk: before.C2_cjk.filter((v) => !after.C2_cjk.includes(v)) },
  removedFromC3: { en: before.C3_CLAUSE_ACTION_PATTERN.filter((v) => !after.C3_CLAUSE_ACTION_PATTERN.includes(v)), cjk: before.C3_cjk.filter((v) => !after.C3_cjk.includes(v)) },
  monotonicity: null,
  contractVerbatim: {
    englishMatchesShipped: eqSet(contractTables.shippedEnglish.slice().sort(), after.C2_ACTION_VERB_PATTERN),
    cjkMatchesShipped: eqSet(contractTables.shippedCjk.slice().sort(), after.C2_cjk),
    C2EqualsC3_english: eqSet(after.C2_ACTION_VERB_PATTERN, after.C3_verbs_only),
    C3conjunctions: after.C3_conjunctions,
    C2EqualsC3_cjk: eqSet(after.C2_cjk, after.C3_cjk),
    contractC2DetectList: (contract.complexityGate.signals.C_enumeratedSteps.detect.match(/C2 distinct action verbs \(([^)]*)\)/) ?? [])[1]?.split('|') ?? null,
    triggerLine_old: readFileSync(join(tmp, 'pkg', 'lib', 'session-start.js'), 'utf8').split('\n').filter((l) => /\btrigger =/.test(l)).map((l) => l.trim()),
    triggerLine_new: readFileSync(SHIPPED, 'utf8').split('\n').filter((l) => /\btrigger =/.test(l)).map((l) => l.trim()),
    C1DetectString: (contract.complexityGate.signals.C_enumeratedSteps.detect.match(/C1 enumerated lines \(([^)]*)\)/) ?? [])[1] ?? null,
    C1ShippedSource: newMod.ENUMERATED_LINE_PATTERN.source,
  },
}
const noRemovals = ['addedToC2', 'addedToC3'].every((k) => true)
  && ['removedFromC2', 'removedFromC3'].every((k) => out.verbTables[k].en.length === 0 && out.verbTables[k].cjk.length === 0)
out.verbTables.monotonicity = noRemovals
  ? 'MONOTONE: every pre-R3 verb survives in the harmonized table (no removals), so the R3 signal set can only GROW on a fixed text -> the change can add triggers, never remove them'
  : 'NOT monotone - re-read'

// ------------------------------------------------------------------ prompt set
const rows = readFileSync(join(repo, 'evidence', 'omo-parity-rate', 'raw', 'prompts.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
const prompts = [
  ...Object.entries(contract.complexityGate.testPrompts).filter(([k]) => k === 'simple' || k === 'complex')
    .flatMap(([k, list]) => list.map((p, i) => ({ id: `frozen-${k}-${i + 1}`, text: p, stratum: k }))),
  ...rows.map((r) => ({ id: r.id, text: r.prompt, stratum: `real-${r.stratum}` })),
  { id: 'COUNTEREXAMPLE-EN', text: 'Audit the ledger, build the package, verify the output.', stratum: 'constructed' },
  { id: 'COUNTEREXAMPLE-CJK', text: '重构这个模块, 迁移到新接口, 审计日志.', stratum: 'constructed' },
  { id: 'KNOWN-ACCEPTED', text: 'Check the test, build the package, verify the output.', stratum: 'constructed' },
]
out.comparison = prompts.map((p) => {
  const o = oldMod.evaluateComplexityGate(p.text)
  const n = newMod.evaluateComplexityGate(p.text)
  return { id: p.id, stratum: p.stratum, old: { trigger: o.trigger, signals: o.signals }, new: { trigger: n.trigger, signals: n.signals }, flipped: o.trigger !== n.trigger }
})
out.summary = {
  total: out.comparison.length,
  flips: out.comparison.filter((r) => r.flipped).map((r) => r.id),
  real20: { total: out.comparison.filter((r) => r.stratum.startsWith('real')).length, flips: out.comparison.filter((r) => r.stratum.startsWith('real') && r.flipped).length, triggersNew: out.comparison.filter((r) => r.stratum.startsWith('real') && r.new.trigger).length },
  frozen6: out.comparison.filter((r) => r.stratum === 'simple' || r.stratum === 'complex').map((r) => `${r.id}:${r.old.trigger}->${r.new.trigger}`),
}

rmSync(tmp, { recursive: true, force: true })
out.tempCopyRemoved = true
console.log(JSON.stringify(out, null, 2))
