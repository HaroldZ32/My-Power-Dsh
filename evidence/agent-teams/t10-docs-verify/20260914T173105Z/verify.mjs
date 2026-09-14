// t10 verification: bilingual rule, link integrity and factual accuracy of the
// documentation set touched by the documentation tasks (t8 docs/extensions pair,
// t9 README + user-guide + index + architecture + development pairs, AGENTS.md rows).
//
// Read-only checker: it never writes to any doc. Run from the repo root:
//   node evidence/agent-teams/t10-docs-verify/20260914T173105Z/verify.mjs
//
// It emits one JSON object on stdout ({ checks, docs, findings }) and exits 0.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = process.cwd()
const PAIRS = [
  ['README.md', 'README.zh-CN.md'],
  ['docs/index.md', 'docs/index.zh-CN.md'],
  ['docs/user-guide.md', 'docs/user-guide.zh-CN.md'],
  ['docs/architecture.md', 'docs/architecture.zh-CN.md'],
  ['docs/development.md', 'docs/development.zh-CN.md'],
  ['docs/extensions.md', 'docs/extensions.zh-CN.md'],
]
const findings = []
const add = (id, severity, doc, line, problem, requiredFix) =>
  findings.push({ id, severity, doc, line, problem, requiredFix })

// ── (a) both languages exist + a language switch link directly under the title ──
const existence = []
for (const [en, zh] of PAIRS) {
  const enOk = existsSync(en)
  const zhOk = existsSync(zh)
  const head = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').slice(0, 5) : [])
  const enHead = head(en)
  const zhHead = head(zh)
  // title = first ATX heading; switch must be within the 4 lines after it
  const switchLine = (lines, needle) => {
    const title = lines.findIndex((l) => /^#\s/.test(l))
    if (title < 0) return -1
    for (let i = title + 1; i <= title + 4 && i < lines.length; i++) if (lines[i].includes(needle)) return i + 1
    return -1
  }
  const enSwitch = switchLine(enHead, '.zh-CN.md')
  const zhSwitch = switchLine(zhHead, '.md')
  const ok = enOk && zhOk && enSwitch > 0 && zhSwitch > 0
  existence.push({ en, zh, enExists: enOk, zhExists: zhOk, enSwitchLine: enSwitch, zhSwitchLine: zhSwitch, ok })
  if (!ok) add(`A-${en}`, 'blocker', en, 0, `bilingual existence/switch failed (enExists=${enOk} zhExists=${zhOk} enSwitch=${enSwitch} zhSwitch=${zhSwitch})`, 'restore the pair and the switch link under the title')
}

// ── (b) section-level parity (headings are block-scoped to skip fenced code) ──
function sections(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const secs = []
  let cur = { title: '(preamble)', line: 1, body: [] }
  let fence = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const m = /^(\s*)(```+|~~~+)/.exec(l)
    if (m) {
      if (fence === null) fence = m[2][0]
      else if (m[2][0] === fence) fence = null
    }
    if (fence === null && /^#{1,6}\s/.test(l)) {
      secs.push(cur)
      cur = { title: l.trim(), line: i + 1, body: [] }
    } else cur.body.push(l)
  }
  secs.push(cur)
  return secs.filter((s) => s.title !== '(preamble)' || s.body.some((l) => l.trim() !== ''))
}
const dens = (body) => ({
  nonEmpty: body.filter((l) => l.trim() !== '').length,
  tableRows: body.filter((l) => /^\s*\|/.test(l)).length,
  fenced: body.filter((l) => /^\s*```/.test(l)).length / 2,
  bullets: body.filter((l) => /^\s*[-*]\s/.test(l)).length,
  chars: body.join('\n').length,
})
const parity = []
for (const [en, zh] of PAIRS) {
  const a = sections(en)
  const b = sections(zh)
  const n = Math.min(a.length, b.length)
  const rows = []
  for (let i = 0; i < n; i++) {
    const A = dens(a[i].body)
    const B = dens(b[i].body)
    rows.push({ index: i, en: a[i].title, zh: b[i].title, enLine: a[i].line, zhLine: b[i].line, enDens: A, zhDens: B })
  }
  parity.push({ en, zh, enSections: a.length, zhSections: b.length, sameCount: a.length === b.length, rows })
  if (a.length !== b.length) add(`B-${en}`, 'blocker', en, 0, `section count differs: EN ${a.length} vs ZH ${b.length}`, 'add the missing section to the short version')
}

// ── (c) every relative link resolves from the file's own directory ──
const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const links = {}
let dead = 0
let total = 0
for (const [en, zh] of PAIRS) {
  for (const f of [en, zh]) {
    const lines = readFileSync(f, 'utf8').split('\n')
    const out = []
    for (let i = 0; i < lines.length; i++) {
      let m
      linkRe.lastIndex = 0
      while ((m = linkRe.exec(lines[i])) !== null) {
        const raw = m[1]
        total++
        if (/^(https?:|mailto:)/.test(raw)) { out.push({ raw, line: i + 1, status: 'external' }); continue }
        const hashless = raw.split('#')[0]
        let status = 'ok'
        let kind = 'file'
        if (hashless === '') {
          status = 'anchor-not-checked'
          kind = 'anchor'
        } else {
          const abs = resolve(dirname(f), decodeURIComponent(hashless))
          if (existsSync(abs)) kind = statSync(abs).isFile() ? 'file' : 'dir'
          else status = 'DEAD'
        }
        out.push({ raw, line: i + 1, status, kind })
        if (status === 'DEAD') {
          dead++
          add(`C-${f}-${i + 1}`, 'blocker', f, i + 1, `dead relative link "${raw}"`, 'fix the path or remove the link')
        }
      }
    }
    links[f] = out
  }
}

// ── (d) repo path + tool-name + package + config-key claims ──
const ALL = PAIRS.flat()
const repoPathRe = /(?:^|[\s(|`'[])((?:packages|scripts|extensions|presets|skills|docs|evidence|tests)\/[A-Za-z0-9_@./*-]+)/g
const pathClaims = []
for (const f of ALL) {
  const t = readFileSync(f, 'utf8')
  let m
  while ((m = repoPathRe.exec(t)) !== null) {
    const p = m[1].replace(/[.,;:)]+$/, '')
    if (p.includes('*') || p.endsWith('/')) continue
    pathClaims.push({ file: f, path: p, exists: existsSync(p) })
  }
}
// Non-claims: a brace glob and a prose phrase the extractor cannot tell from a path.
const NON_CLAIM = new Set(['docs/plan-', 'skills/flows'])
const missingPaths = pathClaims.filter((c) => !c.exists && !NON_CLAIM.has(c.path))
for (const m of missingPaths) add(`D-path-${m.file}-${m.path}`, 'high', m.file, 0, `repo path claim does not exist: ${m.path}`, 'fix the path or drop the claim')

// The four model-facing extension tools must exist; mpd_ext_reload must NOT.
const extTools = ['mpd_ext_list', 'mpd_ext_show', 'mpd_flow_list', 'mpd_flow_show']
const toolClaims = {}
for (const f of ALL) {
  const t = readFileSync(f, 'utf8')
  toolClaims[f] = Object.fromEntries(extTools.map((n) => [n, t.includes(n)]))
}
const registered = readFileSync('packages/mpd-ext-plugin/src/index.ts', 'utf8')
const reloadCut = !/name:\s*"mpd_ext_reload"/.test(registered)

// mpd.jsonc config keys: authoritative list is the mpd_config_get tool description.
const configDoc = readFileSync('packages/mpd-config-plugin/src/index.ts', 'utf8')
const consumed = /Consumed keys:([^"]*)/.exec(configDoc)?.[1] ?? ''
const consumedHas = (key) => consumed.includes(key)
const ug = readFileSync('docs/user-guide.md', 'utf8')
const ugLines = ug.split('\n')
const configTableRows = ugLines
  .map((l, i) => ({ l, i: i + 1 }))
  .filter(({ l }) => /^\|\s*`[a-zA-Z*.]/.test(l) && /mpd-|agent-teams/.test(l))
const badConfigRows = configTableRows.filter(({ l }) => {
  const key = /`([a-zA-Z0-9.*_-]+)`/.exec(l)?.[1] ?? ''
  const top = key.split('.')[0]
  return top === 'codegraph' && !consumedHas('codegraph')
})
for (const r of badConfigRows) add(`D-cfg-${r.i}`, 'medium', 'docs/user-guide.md', r.i, `config-table row claims an mpd.jsonc key that no plugin consumes: ${r.l.trim()}`, 'remove the row, or state that these are row/apply-time options (autoInit/binary/initTimeoutMs/cooldownMs), not mpd.jsonc keys')

// Package reference: every package named in docs/index.md must really be a package.
const idx = readFileSync('docs/index.md', 'utf8')
const pkgNames = [...idx.matchAll(/`(mpd-[a-z0-9-]+|mpd-mcp-[a-z0-9-]+)`/g)].map((m) => m[1])
const pkgCheck = [...new Set(pkgNames)].map((n) => ({
  name: n,
  dirExists: existsSync(`packages/${n}`),
  readmeExists: existsSync(`packages/${n}/README.md`),
}))
const dirsOnDisk = readdirSync('packages').filter((d) => d !== 'node_modules')
const notListed = dirsOnDisk.filter((d) => !idx.includes(d))

// ── post-repair re-checks (round 2, t15): pin each repaired claim in BOTH languages ──
const idxZh = readFileSync('docs/index.zh-CN.md', 'utf8')
const ugZh = readFileSync('docs/user-guide.zh-CN.md', 'utf8')
const FALSE_CFG_ROW = /^\|\s*`codegraph\.\*`\s*\|/m
const pluginSources = readdirSync('packages')
  .filter((d) => d !== 'node_modules')
  .map((d) => `packages/${d}/src/index.ts`)
  .filter((p) => existsSync(p))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n')
const f1 = {
  id: 'F1',
  falseRowGoneEn: !FALSE_CFG_ROW.test(ug),
  falseRowGoneZh: !FALSE_CFG_ROW.test(ugZh),
  realityNoteEn: /deliberately absent from this table[\s\S]{0,400}no plugin\s+reads a `codegraph\.\*` key through `mpd\.jsonc`/.test(ug) && /bundle-patch row/.test(ug),
  realityNoteZh: /刻意不在上表中[\s\S]{0,400}没有任何插件通过 `mpd\.jsonc` 读取\s*\n?`codegraph\.\*` 键/.test(ugZh),
  consumedKeyListOmitsCodegraph: !consumedHas('codegraph'),
  noPluginReadsIt: !/get\("codegraph/.test(pluginSources),
}
f1.ok = f1.falseRowGoneEn && f1.falseRowGoneZh && f1.realityNoteEn && f1.realityNoteZh && f1.consumedKeyListOmitsCodegraph && f1.noPluginReadsIt
if (!f1.ok) add('R2-F1', 'blocker', 'docs/user-guide.md', 0, `F1 re-check failed: ${JSON.stringify(f1)}`, 'remove the codegraph.* row in both languages and state the row-option reality')

const exceptionsStated = /two\s+stated exceptions|两处已明确说明的\s*\n?例外/.test(idx) && /two\s+stated exceptions|两处已明确说明的\s*\n?例外/.test(idxZh)
const f2 = {
  id: 'F2',
  universalClaimGoneEn: !/One README per package/.test(idx),
  universalClaimGoneZh: !/每个包在其 `README\.md`/.test(idxZh),
  exceptionsStatedEn: exceptionsStated,
  mcpSharedListedEn: idx.includes('mpd-mcp-shared'),
  mcpSharedListedZh: idxZh.includes('mpd-mcp-shared'),
  teamCompactReadmePair: existsSync('packages/mpd-team-compact-plugin/README.md') && existsSync('packages/mpd-team-compact-plugin/README.zh-CN.md'),
  exceptionsAreTrue: !existsSync('packages/mpd-mcp-shared/README.md') && !existsSync('packages/mpd-agent-teams-plugin/README.zh-CN.md'),
}
// every OTHER package must carry the bilingual pair, or the qualified sentence is still false
const readmeAudit = readdirSync('packages')
  .filter((d) => d !== 'node_modules')
  .map((d) => ({ name: d, en: existsSync(`packages/${d}/README.md`), zh: existsSync(`packages/${d}/README.zh-CN.md`) }))
const undocumentedException = readmeAudit.filter((p) => (!p.en || !p.zh) && p.name !== 'mpd-mcp-shared' && p.name !== 'mpd-agent-teams-plugin')
f2.ok = f2.universalClaimGoneEn && f2.universalClaimGoneZh && f2.exceptionsStatedEn && f2.mcpSharedListedEn && f2.mcpSharedListedZh && f2.teamCompactReadmePair && f2.exceptionsAreTrue && undocumentedException.length === 0
f2.readmeAudit = readmeAudit
f2.undocumentedException = undocumentedException.map((p) => p.name)
if (!f2.ok) add('R2-F2', 'blocker', 'docs/index.md', 0, `F2 re-check failed: ${JSON.stringify({ ...f2, readmeAudit: undefined })}`, 'qualify the sentence truthfully and/or add the missing README pair')

// ── (e) README relationship chapter: separate, after the capabilities, honest ──
const readmeLines = readFileSync('README.md', 'utf8').split('\n')
const lineOf = (re) => readmeLines.findIndex((l) => re.test(l)) + 1
const caps = lineOf(/^## Capabilities/)
const rel = lineOf(/^## Relationship to other projects/)
const lic = lineOf(/^## License/)
const relBody = readmeLines.slice(rel - 1, lic - 1).join('\n')
const relationship = {
  capabilitiesLine: caps,
  relationshipLine: rel,
  licenseLine: lic,
  isSeparateSection: rel > 0 && /^## Relationship to other projects/.test(readmeLines[rel - 1] ?? ''),
  afterCapabilities: rel > caps,
  beforeHeadline: rel > 4,
  namesCarried: /Carried from the upstream project/.test(relBody),
  namesAdopted: /Adopted outright/.test(relBody),
  namesOwn: /Written here/.test(relBody),
  citesPinnedCommit: /8c57e46/.test(relBody) && /v5\.0\.0-beta\.20/.test(relBody),
  citesMit: /MIT/.test(relBody) && /LICENSE-NOTICES\.md/.test(relBody),
  upstreamLabelInTitleOrFirstScreen: /oh-my-openagent|OMO/.test(readmeLines.slice(0, 5).join('\n')),
}

// ── (f) index hub lists the rewritten set ──
const hubTargets = ['docs/user-guide.md', 'docs/extensions.md', 'docs/architecture.md', 'docs/development.md', 'README.md', 'AGENTS.md']
const hub = { file: 'docs/index.md', lists: Object.fromEntries(hubTargets.map((t) => [t, idx.includes(t.replace('docs/', ''))])) }

const report = {
  generatedFrom: ROOT,
  pairs: PAIRS.map((p) => p.join(' vs ')),
  checks: {
    existence: { ok: existence.every((e) => e.ok), rows: existence },
    parity: { sameSectionCount: parity.every((p) => p.sameCount), rows: parity },
    links: { total, dead, perFile: Object.fromEntries(Object.entries(links).map(([f, ls]) => [f, { count: ls.length, dead: ls.filter((l) => l.status === 'DEAD').length, external: ls.filter((l) => l.status === 'external').length }])) },
    paths: { claims: pathClaims.length, missing: missingPaths.length, missingList: [...new Set(missingPaths.map((m) => `${m.file}: ${m.path}`))] },
    extTools: { required: extTools, perFile: toolClaims, reloadToolCut: reloadCut },
    configKeys: { consumedFrom: 'packages/mpd-config-plugin/src/index.ts mpd_config_get description', badRows: badConfigRows.map((r) => ({ line: r.i, text: r.l.trim() })) },
    packageReference: { entries: pkgCheck.filter((p) => p.name.startsWith('mpd-')), dirsOnDiskNotListed: notListed },
    relationship,
    hub,
    postRepair: { f1, f2 },
  },
  findings,
}
console.log(JSON.stringify(report, null, 1))
