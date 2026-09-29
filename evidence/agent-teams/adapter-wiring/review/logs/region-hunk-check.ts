// Reviewer (t9): every changed line of the six bridged adopted files must sit INSIDE an mpd-delta region.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const root = '/root/dshProj/my-power-dsh'
const lib = root + '/packages/mpd-agent-teams-plugin/lib'
const files = ['index.js','capabilities.js','harness-compat.js','members.js','command.js','tools.js']
const spansOf = (src) => { const lines=src.split('\n'); const spans=[]; const open=[]
  for (let i=0;i<lines.length;i++){ const b=/^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[i])
    if (b){ open.push({id:b[1],begin:i}); continue }
    const e=/^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[i]); if (e){ const t=open.pop(); spans.push([t.begin,i,t.id]) } }
  return spans }
let total=0, outside=0
for (const f of files) {
  const spans = spansOf(readFileSync(lib+'/'+f,'utf8'))
  const diff = execFileSync('git',['diff','-U0','--',`packages/mpd-agent-teams-plugin/lib/${f}`],{cwd:root,encoding:'utf8'})
  const hunks=[...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(m=>[+m[1], +(m[2]??1)])
  const inside=(line)=>spans.some(([b,e])=>line-1>=b && line-1<=e)
  const bad=[]
  for (const [start,len] of hunks){ if (len===0){ if(!inside(start)) bad.push(`del@${start}`); continue }
    for (let l=start;l<start+len;l++) if(!inside(l)) bad.push(`L${l}`) }
  total+=hunks.length; outside+=bad.length
  console.log(`${f}: regions=${spans.length} hunks=${hunks.length} changed-lines-outside-regions=${bad.length} ${bad.slice(0,8).join(' ')}`)
}
console.log(`TOTAL hunks=${total} outside=${outside} -> ${outside===0?'DELTA-DISCIPLINE OK':'VIOLATION'}`)
