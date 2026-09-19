// t27: adversarial probe of the t26 scanner rule set (rules copied VERBATIM from the test).
// Confirms the round-2 F4 gaps are closed and looks for anything new that evades.
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
  { seam: "facade.alias", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*\(?\s*ctx\s*\)?\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b(?!\s*\??\.)/g, receiver: 0, facadeExempt: false },
  { seam: "facade.get-extraction", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*\(?\s*ctx\s*\)?\??\s*\.\s*get\b(?!\s*\()/g, receiver: 0, facadeExempt: false },
  { seam: "facade.get-destructure", re: /(?:const|let|var)\s*\{[^}]*\bget\b[^}]*\}\s*=\s*\(?\s*ctx\s*\)?/g, receiver: 0, facadeExempt: false },
  { seam: "scoped-ctx.extraction", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*ctx\s*\.\s*(?:tools|on|effect)\b(?!\s*\()/g, receiver: 0, facadeExempt: false },
  { seam: "scoped-ctx.destructure", re: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*ctx\s*\.\s*(?:tools|on|effect)\b/g, receiver: 0, facadeExempt: false },
  { seam: "facade.destructure", re: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b/g, receiver: 0, facadeExempt: false },
  { seam: "facade.bracket", re: /ctx\s*\??\.?\s*\[\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect|get|inject)['"`]\s*\]/g, receiver: 0, facadeExempt: false },
  { seam: "facade.reflect", re: /Reflect\s*\.\s*get\s*\(\s*[^,()]+,\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect)['"`]/g, receiver: 0, facadeExempt: false },
  { seam: "seam.method-call", re: /([A-Za-z_$][\w$]*)\s*\.\s*(?:register|get|list|on|effect|restrict|startContinuable|interrupt|section|listModels|resolveCallConfig|followup|cancel|steer|inject|prompt|sendMessage)\s*\.\s*call\s*\(/g, receiver: 1 },
  { seam: "seam.captured-method-call", re: /(?<![.\w$])(queue|prompt|legacy|send|followup)\s*\.\s*call\s*\(/g, receiver: 1, facadeExempt: false },
]
const FACADE_RECEIVER = /(^|\.)ctx$/
const LADDER_POLICY = /^runtime$/
const LADDER_CAPTURES = /^(?:queue|prompt|legacy|send|followup)$/
function scanLine(file, line) {
  const hits = []
  for (const rule of BYPASS_RULES) {
    const g = new RegExp(rule.re.source, "g"); let m
    while ((m = g.exec(line)) !== null) {
      const receiver = rule.receiver === 1 ? (m[1] ?? "") : ""
      if (rule.facadeExempt !== false && FACADE_RECEIVER.test(receiver)) continue
      if (file === "harness-compat.js" && (LADDER_POLICY.test(receiver) || LADDER_CAPTURES.test(receiver))) continue
      hits.push(rule.seam)
    }
  }
  return hits
}
const probes = [
  // round-2 F4 gaps — every one must now be CAUGHT
  ["F4: late assignment", "let a; a = ctx.agents;"],
  ["F4: parenthesized receiver", "const a = (ctx).agents"],
  ["F4: ctx.get extraction", "const g = ctx.get; g('agents')"],
  ["F4: scoped-ctx member extraction", "const t = agent.ctx.tools;"],
  ["F4: scoped-ctx destructure", "const { tools } = agent.ctx"],
  ["F4: param alias (still inherent)", "function f(c) { const a = c.agents; a.get(id); }"],
  // t26 F5 — the captured-method rule
  ["F5: captured call outside harness-compat", "return prompt.call(runtime, request, signal)"],
  ["F5: captured legacy.call in members.js", "return legacy.call(runtime, parent, childId, content, options)"],
  ["F5: receiver-chained runtime.prompt(...)", "runtime.prompt(request, signal)"],
  // negative controls — must stay CLEAN
  ["clean: documented ctx.get('mpdDsh') call", 'const dsh = ctx.get("mpdDsh", true)'],
  ["clean: facade call ctx.get('agents').get", "const captain = ctx.agents.get(sessionId)"],
  ["clean: bare alias call", "agents.get(id)"],
  ["clean: runtime capture declaration", "const prompt = runtime.prompt;"],
]
console.log("# t27 probe of the t26 scanner rules")
for (const [label, line] of probes) console.log(`${label.padEnd(46)} -> ${JSON.stringify(scanLine("members.js", line))}`)
console.log("\n# harness-compat.js exemption check (same captured line, the ladder's own module):")
console.log("prompt.call(runtime, request, signal) ->", JSON.stringify(scanLine("harness-compat.js", "return prompt.call(runtime, request, signal)")))
