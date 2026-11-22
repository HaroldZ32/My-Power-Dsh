// T4 static lane — cross-checks the verify:gates aggregate cannot make.
// Reads only committed HEAD bytes (git show), never the network.
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const R = (cmd) => execSync(cmd, { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const out = []
const say = (s) => { out.push(s); console.log(s) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const HEAD = R('git rev-parse --short HEAD').trim()
const BASE = 'e3f36a99'
say(`[cross] head=${HEAD} base=${BASE}`)
// A. three-way TUI band
const rootBand = J('dsh-plugin.json').compat.hosts
const pkgBand = J('packages/mpd-tui-plugin/dsh-plugin.json').compat.hosts
const specBand = J('specs/tui-hosts.json').hosts
const identical = eq(rootBand, pkgBand) && eq(rootBand, specBand)
const sorted = [rootBand, pkgBand, specBand].every((a) => eq(a, [...a].sort()))
say(`[cross] A.band-identical=${identical ? 'PASS' : 'FAIL'} band=[${rootBand.join(', ')}]`)
say(`[cross] A.band-sorted=${sorted ? 'PASS' : 'FAIL'} (ascending lexicographic)`)
say(`[cross] A.band-target-present=${rootBand.includes('@deepseek-harness-tui/dsh-tui@0.20.2') ? 'PASS' : 'FAIL'} band-size=${rootBand.length}`)
// B. three version carriers
const pkgV = J('package.json').version
const pluginV = J('dsh-plugin.json').version
const distV = J('dsh-distribution.json').distribution.version
say(`[cross] B.carriers=${[pkgV, pluginV, distV].join('/')} ${pkgV === '0.21.0' && pluginV === '0.21.0' && distV === '0.21.0' ? 'PASS' : 'FAIL'}`)
// C. engines unchanged vs base
const basePkg = JSON.parse(R(`git show ${BASE}:package.json`))
const headPkg = J('package.json')
say(`[cross] C.engines.dsh head="${headPkg.engines.dsh}" base="${basePkg.engines.dsh}" ${headPkg.engines.dsh === basePkg.engines.dsh ? 'PASS-unchanged' : 'FAIL-MOVED'}`)
say(`[cross] C.engines.node head="${headPkg.engines.node}" base="${basePkg.engines.node}" ${headPkg.engines.node === basePkg.engines.node ? 'PASS-unchanged' : 'FAIL-MOVED'}`)
// D. distribution refs
const comps = J('dsh-distribution.json').protocols
  .flatMap((p) => (p.spec && Array.isArray(p.spec.components) ? p.spec.components : []))
const byId = Object.fromEntries(comps.map((c) => [c.id, c.ref]))
say(`[cross] D.host-base=${byId['host-base']} ${byId['host-base'] === 'pkg:npm/@deepseek-ai/dsh-base@0.2.2-rc.5' ? 'PASS' : 'FAIL'}`)
say(`[cross] D.host-tui=${byId['host-tui']} ${byId['host-tui'] === 'pkg:npm/@deepseek-harness-tui/dsh-tui@0.20.2' ? 'PASS' : 'FAIL'}`)
// E. old-pin scan over TRACKED files
const files = R('git ls-files')
  .split('\n')
  .filter(
    (f) =>
      f &&
      fs.existsSync(f) &&
      !f.startsWith('evidence/') &&
      !f.startsWith('docker/ui/out/') &&
      !/\.(png|jpg|jpeg|gif|webp|ico|zip|tgz|woff2?|mp4|pdf)$/i.test(f),
  )
const hits = []
for (const f of files) {
  if (/\.(png|jpg|jpeg|gif|webp|ico|zip|tgz|woff2?)$/i.test(f)) continue
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { continue }
  text.split('\n').forEach((line, i) => {
    if (/0\.2\.2-rc\.3|0\.20\.1\b/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 180)}`)
  })
}
say(`[cross] E.old-pin scan: ${hits.length} line(s) in tracked files (evidence/** is untracked and out of the scan)`)
hits.forEach((h) => say(`[cross] E.hit ${h}`))
// F. bilingual pairs changed by this wave
const changed = R(`git show --name-only --pretty=format: ${HEAD}`).split('\n').filter(Boolean)
const enDocs = changed.filter((f) => f.endsWith('.md') && !f.endsWith('.zh-CN.md') && f !== 'CHANGELOG.md' && f !== 'AGENTS.md')
let pairFail = 0
for (const en of enDocs) {
  const zh = en.replace(/\.md$/, '.zh-CN.md')
  const base = en.split('/').pop().replace(/\.md$/, '')
  if (!fs.existsSync(zh)) { say(`[cross] F.pair MISSING ${zh}`); pairFail++; continue }
  const enText = fs.readFileSync(en, 'utf8')
  const zhText = fs.readFileSync(zh, 'utf8')
  const enDot = enText.includes(`[中文](./${base}.zh-CN.md)`)
  const enBare = enText.includes(`[中文](${base}.zh-CN.md)`)
  const zhDot = zhText.includes(`[English](./${base}.md)`)
  const zhBare = zhText.includes(`[English](${base}.md)`)
  const enLink = enDot || enBare
  const zhLink = zhDot || zhBare
  const cjk = (zhText.match(/[\u4e00-\u9fff]/g) || []).length
  const ok = enLink && zhLink && cjk > 200
  if (!ok) pairFail++
  const form = (dot, bare) => (dot ? './form' : bare ? 'bare-form' : 'NO')
  say(`[cross] F.pair ${en} <-> ${zh} en-switch=${form(enDot, enBare)} zh-switch=${form(zhDot, zhBare)} cjk=${cjk} ${ok ? 'PASS' : 'FAIL'}`)
}
say(`[cross] F.bilingual-pairs=${enDocs.length} failures=${pairFail} ${pairFail === 0 ? 'PASS' : 'FAIL'}`)
// G. AGENTS.md instruction budget
const agentsBytes = Buffer.byteLength(R(`git show ${HEAD}:AGENTS.md`), 'utf8')
say(`[cross] G.AGENTS.md bytes=${agentsBytes} budget=65536 margin=${65536 - agentsBytes} ${agentsBytes < 65536 ? 'PASS' : 'FAIL'}`)
console.log(`[cross] RESULT: ${pairFail === 0 && identical && sorted ? 'PASS' : 'FAIL'}`)
