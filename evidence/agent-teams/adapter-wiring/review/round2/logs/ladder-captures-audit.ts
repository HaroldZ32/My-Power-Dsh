// Full audit: the CURRENT rule set (incl. the four extraction rules) over harness-compat.js,
// WITH and WITHOUT the LADDER_CAPTURES exemption, honouring region spans.
import { readFileSync } from 'node:fs'
const p = '/root/dshProj/my-power-dsh/packages/mpd-agent-teams-plugin/lib/harness-compat.js'
const RULES = [
  ["scoped-ctx.handout", /\bsetup\s*\(\s*([A-Za-z_$][\w$]*)\?*\.ctx\s*,/g, 1],
  ["scoped-ctx.seam", /([A-Za-z_$][\w$]*)\?*\.ctx\.(?:tools\??\.restrict|effect|on)\s*\(/g, 1],
  ["agents-lookup", /\.get\??\.\(\s*["']agents["']/g, 0],
  ["agent.turn-start", /([A-Za-z_$][\w$]*)\?*\.followup\s*\(/g, 1],
  ["agent.turn-cancel", /([A-Za-z_$][\w$]*)\?*\.cancel\s*\(/g, 1],
  ["agent.turn-steer", /([A-Za-z_$][\w$]*)\?*\.steer\s*\(/g, 1],
  ["agent.turn-inject", /([A-Za-z_$][\w$]*)\?*\.inject\s*\(/g, 1],
  ["subagents-runtime", /([A-Za-z_$][\w$]*)\?*\.subagents\b(?!\s*\??\.\s*(?:getProvider|list|startContinuable|interrupt|runtime)\b)/g, 1],
  ["events.on", /([A-Za-z_$][\w$]*)\?*\.on\s*\(/g, 1],
  ["facade.alias", /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b(?!\s*\??\.)/g, 0],
  ["facade.destructure", /(?:const|let|var)\s*\{[^}]*\}\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b/g, 0],
  ["facade.bracket", /ctx\s*\??\.?\s*\[\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect|get|inject)['"`]\s*\]/g, 0],
  ["facade.reflect", /Reflect\s*\.\s*get\s*\(\s*[^,()]+,\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect)['"`]/g, 0],
]
const NOEXEMPT = new Set(["facade.alias", "facade.destructure", "facade.bracket", "facade.reflect", "subagents-runtime"])
const FACADE = /(^|\.)ctx$/, POLICY = /^runtime$/, CAPTURES = /^(?:queue|prompt|legacy|send|followup)$/
const src = readFileSync(p, 'utf8').split('\n')
const spans = []; { const open = []
  for (let i = 0; i < src.length; i++) { if (/^\s*\/\/#region mpd-delta/.test(src[i])) open.push(i); if (/^\s*\/\/#endregion mpd-delta/.test(src[i])) spans.push([open.pop(), i]) } }
const inRegion = (i) => spans.some(([b, e]) => i >= b && i <= e)
let withEx = [], withoutEx = []
for (let i = 0; i < src.length; i++) {
  const line = src[i]; if (line.trim() === '' || line.trim().startsWith('//') || line.trim().startsWith('*')) continue
  for (const [seam, re, recv] of RULES) {
    const g = new RegExp(re.source, 'g'); let m
    while ((m = g.exec(line)) !== null) {
      const r = recv === 1 ? (m[1] ?? '') : ''
      if (!NOEXEMPT.has(seam) && FACADE.test(r)) continue
      const policy = POLICY.test(r) || (CAPTURES.test(r))
      if (!policy && !inRegion(i)) withoutEx.push(`${i + 1} ${seam} on "${r}" — ${line.trim().slice(0, 100)}`)
      if (!policy) withEx.push(`${i + 1} ${seam} on "${r}" — ${line.trim().slice(0, 100)}`)
      if (CAPTURES.test(r)) console.log(`LADDER_CAPTURES-eligible receiver: ${i + 1} ${seam} on "${r}" — ${line.trim().slice(0, 100)}`)
    }
  }
}
console.log(`findings WITHOUT the exemption (current rules, regions honoured): ${withoutEx.length}`)
for (const x of withoutEx) console.log('  ' + x)
console.log(`non-policy hits WITH the exemption (all should be inside regions or none): ${withEx.length}`)
for (const x of withEx) console.log('  ' + x)
