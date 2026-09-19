// Reviewer t9 — INDEPENDENT closure census. Not the wave's scanner: this walks every server file and
// classifies EVERY harness-seam receiver, then judges non-facade receivers against region spans and
// the documented counted/Class-B sets.
import { readFileSync } from 'node:fs'
const lib = '/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib'
const FILES = ['tools.js','members.js','scheduler.js','index.js','capabilities.js','command.js','session-start.js','harness-compat.js','snapshot.js','events.js','profiles.js','quality-gates.js','state.js','web-routes.js','tool-names.js','types.js','event-types.js','mpd-adapter-ctx.js']
// receiver.<member> spellings of the seams the contract routes. `get('agents')` is matched separately.
const SEAM = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.(tools|agents|subagents|commands|systemPrompt|llm)\??\.?([A-Za-z_$][\w$]*)?/g
const EVENTS = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.on\s*\(/g
const AGENTTURN = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.(followup|steer|inject)\s*\(/g
const CANCEL = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.cancel\s*\(/g
const AGENTSLOOKUP = /([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.get\??\.\(\s*['"]agents['"]/g
const SCOPEDCTX = /([A-Za-z_$][\w$]*)\??\.ctx\??\.(tools|on|effect)/g
const spansOf = (src) => { const lines=src.split('\n'); const spans=[]; const open=[]
  for (let i=0;i<lines.length;i++){ const b=/^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[i]); if(b){open.push(i);continue}
    const e=/^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[i]); if(e){spans.push([open.pop(),i])} } return spans }
const facade = (r) => /(^|\.)ctx$/.test(r)
let findings = [], counted = []
for (const file of FILES) {
  let src; try { src = readFileSync(`${lib}/${file}`,'utf8') } catch { continue }
  const spans = spansOf(src); const inRegion = (i) => spans.some(([b,e]) => i>=b && i<=e)
  const lines = src.split('\n')
  const push = (kind, r, i) => {
    const ctxLine = /\bchildCtx\b/.test(lines[i])
    const where = ctxLine ? 'counted-childCtx-residual' : (file==='mpd-adapter-ctx.js' ? 'bridge-fallback-column' : (inRegion(i) ? 'inside-mpd-delta-region' : (facade(r) ? 'FACADE(ctx)' : 'UNROUTED')))
    const rec = { file, line: i+1, kind, receiver: r, where, text: lines[i].trim().slice(0,110) }
    if (where === 'UNROUTED') findings.push(rec); else counted.push(rec)
  }
  for (let i=0;i<lines.length;i++) {
    const line = lines[i]; if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue
    for (const [re, kind] of [[SEAM,'seam-member'],[EVENTS,'events.on'],[AGENTTURN,'agent-turn'],[CANCEL,'agent.cancel'],[AGENTSLOOKUP,'agents-lookup'],[SCOPEDCTX,'scoped-ctx']]) {
      const g = new RegExp(re.source,'g'); let m
      while ((m = g.exec(line)) !== null) {
        const r = m[1] ?? ''
        if (r === '' || /^(const|let|var|if|else|return|await|typeof|new|function|export|import)$/.test(r)) continue
        push(kind, r, i)
      }
    }
  }
}
console.log(`# independent closure census — ${FILES.length} server files inspected`)
console.log(`classified sites: ${counted.length}   UNROUTED: ${findings.length}`)
const byWhere = {}; for (const c of counted) byWhere[c.where] = (byWhere[c.where]??0)+1
console.log('classification counts:', JSON.stringify(byWhere, null, 1))
console.log('\n# the counted childCtx residual lines (must be exactly the 5 members.js lines the test asserts)')
for (const c of counted.filter(x=>x.where==='counted-childCtx-residual')) console.log(`  ${c.file}:${c.line} ${c.text}`)
console.log('\n# non-facade sites INSIDE regions, per file (permitted by RULE 1: the facade cannot cover them)')
const inReg = counted.filter(x=>x.where==='inside-mpd-delta-region')
for (const f of [...new Set(inReg.map(x=>x.file))]) console.log(`  ${f}: ${inReg.filter(x=>x.file===f).length}`)
console.log('\n# UNROUTED sites (a receiver the facade cannot cover, outside any region)')
for (const f of findings) console.log(`  ${f.file}:${f.line} ${f.kind} on "${f.receiver}" — ${f.text}`)
if (findings.length === 0) console.log('  (none — the closure holds on the bytes inspected)')
