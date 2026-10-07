// Reviewer t9: adversarial probe of the AC15 scanner's rules (copied verbatim from
// packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs) against synthetic lines a
// REAL bypass would use. Measures the SCANNER's power, not the tree (the tree was grepped separately).
const BYPASS_RULES = [
  { seam: "scoped-ctx.handout", re: /\bsetup\s*\(\s*([A-Za-z_$][\w$]*)\?*\.ctx\s*,/g, receiver: 1 },
  { seam: "scoped-ctx.seam", re: /([A-Za-z_$][\w$]*)\?*\.ctx\.(?:tools\??\.restrict|effect|on)\s*\(/g, receiver: 1 },
  { seam: "agents-lookup", re: /\.get\??\.\(\s*["']agents["']/g, receiver: 0 },
  { seam: "agent.turn-start", re: /([A-Za-z_$][\w$]*)\?*\.followup\s*\(/g, receiver: 1 },
  { seam: "agent.turn-cancel", re: /([A-Za-z_$][\w$]*)\?*\.cancel\s*\(/g, receiver: 1 },
  { seam: "agent.turn-steer", re: /([A-Za-z_$][\w$]*)\?*\.steer\s*\(/g, receiver: 1 },
  { seam: "agent.turn-inject", re: /([A-Za-z_$][\w$]*)\?*\.inject\s*\(/g, receiver: 1 },
  { seam: "subagents-runtime", re: /([A-Za-z_$][\w$]*)\?*\.subagents\b(?!\s*\??\.\s*(?:getProvider|list|startContinuable|interrupt|runtime)\b)/g, receiver: 1, facadeExempt: false },
  { seam: "events.on", re: /([A-Za-z_$][\w$]*)\?*\.on\s*\(/g, receiver: 1 },
]
const FACADE_RECEIVER = /(^|\.)ctx$/
const LADDER_POLICY = /^runtime$/
function scanLine(line, file = "any.js") {
  if (/\bchildCtx\b/.test(line)) return ["<SKIPPED: line mentions childCtx>"]
  const hits = []
  for (const rule of BYPASS_RULES) {
    const g = new RegExp(rule.re.source, "g"); let m
    while ((m = g.exec(line)) !== null) {
      const receiver = rule.receiver === 1 ? (m[1] ?? "") : ""
      if (rule.facadeExempt !== false && FACADE_RECEIVER.test(receiver)) continue
      if (file === "harness-compat.js" && LADDER_POLICY.test(receiver)) continue
      hits.push(`${rule.seam}(receiver=${receiver})`)
    }
  }
  return hits
}
const probes = [
  ["alias of the scoped ctx (decl)", "const scoped = agent.ctx;"],
  ["alias used (evades)", "scoped.tools.restrict({ deny: [] });"],
  ["destructured on() (evades)", "const { on } = agent.ctx;"],
  ["destructured use (evades)", "on('agent/error', handler);"],
  ["bracket member (evades)", "agent.ctx['tools'].restrict({ deny: [] });"],
  ["Reflect.get (evades)", "Reflect.get(ctx, 'agents').get(id);"],
  ["get via .call (evades)", "ctx.get.call(ctx, 'agents');"],
  ["bypass hidden on a childCtx line (SKIPPED)", "const d = installModelSelection(childCtx, agent.ctx.on('agent/error', h));"],
  ["plain scoped ctx on() (DETECTED)", "agent.ctx.on('agent/error', h);"],
  ["captain.followup (DETECTED)", "captain.followup(msg);"],
  ["facade ctx.on (correctly exempt)", "ctx.on('agent/pre-step', h);"],
  ["ctx.subagents value use (DETECTED)", "const rt = ctx.subagents;"],
  ["ctx.subagents.runtime() (correctly exempt)", "ctx.subagents.runtime();"],
]
console.log("# AC15 scanner power probe (rules copied verbatim from the test)")
for (const [label, line] of probes) console.log(`${label.padEnd(46)} -> ${JSON.stringify(scanLine(line))}`)
