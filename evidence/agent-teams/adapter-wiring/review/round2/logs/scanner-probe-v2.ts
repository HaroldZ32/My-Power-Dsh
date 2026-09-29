// t24: adversarial probe of the HARDENED scanner's rules (copied verbatim from the t23 test).
// Purpose: enumerate which receiver-hiding shapes are now CAUGHT and which still EVADE.
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
  { seam: "facade.alias", re: /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b(?!\s*\??\.)/g, receiver: 0, facadeExempt: false },
  { seam: "facade.destructure", re: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b/g, receiver: 0, facadeExempt: false },
  { seam: "facade.bracket", re: /ctx\s*\??\.?\s*\[\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect|get|inject)['"`]\s*\]/g, receiver: 0, facadeExempt: false },
  { seam: "facade.reflect", re: /Reflect\s*\.\s*get\s*\(\s*[^,()]+,\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect)['"`]/g, receiver: 0, facadeExempt: false },
]
const FACADE_RECEIVER = /(^|\.)ctx$/
const LADDER_POLICY = /^runtime$/
function scanLine(file, line) {
  const hits = []
  for (const rule of BYPASS_RULES) {
    const g = new RegExp(rule.re.source, "g"); let m
    while ((m = g.exec(line)) !== null) {
      const receiver = rule.receiver === 1 ? (m[1] ?? "") : ""
      if (rule.facadeExempt !== false && FACADE_RECEIVER.test(receiver)) continue
      if (file === "harness-compat.js" && LADDER_POLICY.test(receiver)) continue
      hits.push(rule.seam)
    }
  }
  return hits
}
const probes = [
  ["alias decl (CAUGHT)", "const agents = ctx.agents"],
  ["alias decl, semicolon (CAUGHT)", "const tools = ctx.tools;"],
  ["destructure (CAUGHT)", "const { get, list } = ctx.agents"],
  ["bracket read (CAUGHT)", "ctx['agents'].get(id)"],
  ["optional bracket (CAUGHT)", "ctx?.['tools'].register(def)"],
  ["Reflect.get (CAUGHT)", "Reflect.get(ctx, 'subagents')"],
  ["GAP: late assignment", "let a; a = ctx.agents;"],
  ["GAP: parenthesized receiver", "const a = (ctx).agents"],
  ["GAP: facade get() extraction", "const g = ctx.get; g('agents')"],
  ["GAP: bracket get extraction", "const g = ctx['get']; g('agents')"],
  ["GAP: scoped-ctx member extraction", "const t = agent.ctx.tools;"],
  ["GAP: scoped-ctx alias then use", "const s = agent.ctx; s.on('x', h);"],
  ["GAP: alias of a function param", "function f(c) { const a = c.agents; a.get(id); }"],
  ["caught: raw scoped ctx on()", "agent.ctx.on('agent/error', h);"],
  ["caught: subagents value use", "const rt = ctx.subagents;"],
  ["caught: captain.followup", "captain.followup(msg);"],
  ["clean: call through the facade", "const x = ctx.tools.register(definition)"],
  ["clean: bare alias call (by construction)", "agents.get(id)"],
]
console.log("# hardened-scanner probe (t24) — rules copied verbatim from the t23 test")
for (const [label, line] of probes) console.log(`${label.padEnd(42)} -> ${JSON.stringify(scanLine("scheduler.js", line))}`)
