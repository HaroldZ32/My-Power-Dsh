// AC15 (contract §7) — the BYPASS INVENTORY.
//
// The facade routes a seam whenever the adopted code reads it off the plugin's OWN `ctx`. What the
// facade CANNOT fix is a seam reached on some OTHER receiver: `agent.ctx.*` (the raw scoped cordis
// ctx), the `ctx.get('agents')` service-lookup spelling, `invocation.agent.followup`,
// `captain.cancel`, or `ctx.subagents` used as the delivery RUNTIME object. Those are the bypasses,
// and this scanner is the falsifiable inventory of them:
//
//   RULE 1  every seam access whose receiver is NOT the plugin's own `ctx`-like binding must sit
//           inside an `//#region mpd-delta …` span (the six bridged adopted files), or in the
//           bridge module itself (the ONE module allowed to hold the raw fallback expressions);
//   RULE 2  the raw fallback column of the facade exists in the bridge module ONLY.
//
// A scanner that only looked for the string `ctx.` would be blind to exactly the class this test
// exists for, and a scanner that demanded "every seam access inside a region" would be false: the
// six bridged files still read `ctx.agents.get(...)` — that IS the facade — so the receiver, not
// the spelling, is what this test judges.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { MPD_DELTA_MARKERS, MPD_DELTAS } from "../lib/mpd-deltas.js"

const here = dirname(fileURLToPath(import.meta.url))
const libDir = join(here, "..", "lib")

/** The ten server files of the contract's §2.1 roll-up — snapshot.js is listed so its ZERO is measured. */
const SERVER_FILES = [
    "tools.js",
    "members.js",
    "scheduler.js",
    "index.js",
    "capabilities.js",
    "command.js",
    "session-start.js",
    "harness-compat.js",
    "snapshot.js",
    "events.js",
]
/** The mpd-owned bridge module: the ONE place a raw fallback expression may live. */
const BRIDGE_FILE = "mpd-adapter-ctx.js"

/** Remove line and block comments while respecting string/template literals. */
function stripComments(source) {
    let out = ""
    let inBlock = false
    let quote = ""
    for (let at = 0; at < source.length; at += 1) {
        const ch = source[at]
        const next = source[at + 1]
        if (inBlock) {
            if (ch === "*" && next === "/") {
                inBlock = false
                at += 1
            }
            else if (ch === "\n") out += "\n"
            continue
        }
        if (quote !== "") {
            out += ch
            if (ch === "\\") {
                out += next ?? ""
                at += 1
                continue
            }
            if (ch === quote) quote = ""
            continue
        }
        if (ch === "/" && next === "*") {
            inBlock = true
            at += 1
            continue
        }
        if (ch === "/" && next === "/") {
            while (at < source.length && source[at] !== "\n") at += 1
            out += "\n"
            continue
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch
            out += ch
            continue
        }
        out += ch
    }
    return out
}

/** Region spans of one file, tracked through MPD_DELTA_MARKERS (the registry's own spelling). */
function regionSpans(source) {
    const lines = source.split("\n")
    const spans = []
    const open = []
    const ids = []
    for (let index = 0; index < lines.length; index += 1) {
        const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[index])
        if (begin !== null) {
            // The marker the registry would WRITE for this id, not merely a lookalike.
            expect(lines[index].trim()).toBe(MPD_DELTA_MARKERS.begin(begin[1]))
            open.push({ id: begin[1], begin: index })
            ids.push(begin[1])
            continue
        }
        const end = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[index])
        if (end === null) continue
        expect(lines[index].trim()).toBe(MPD_DELTA_MARKERS.end(end[1]))
        const top = open.pop()
        expect(top?.id).toBe(end[1])
        spans.push([top.begin, index])
    }
    expect(open).toEqual([])
    return { spans, ids }
}

/**
 * The bypass classes — each one a seam the FACADE cannot cover, because it is not reached on the
 * plugin's own ctx-shaped binding. Everything else the adopted tree spells `ctx.<seam>` IS the
 * facade (the composition root reassigns `ctx` to it before any consumer runs), which is why those
 * sites are not listed here: a scanner that demanded a region around them would be false.
 */
const BYPASS_RULES = [
    // the harness's documented child-ctx handoff: `setup(childCtx, child)` — the ONE shape in which
    // a resolved `agent.ctx` is handed to a consumer (the callback parameter itself is the counted
    // `childCtx` residual below).
    { seam: "scoped-ctx.handout", re: /\bsetup\s*\(\s*([A-Za-z_$][\w$]*)\?*\.ctx\s*,/g, receiver: 1 },
    // the raw scoped ctx used as a scope: restrict / on / effect
    { seam: "scoped-ctx.seam", re: /([A-Za-z_$][\w$]*)\?*\.ctx\.(?:tools\??\.restrict|effect|on)\s*\(/g, receiver: 1 },
    // the service-lookup spelling of the agents seam
    { seam: "agents-lookup", re: /\.get\??\.\(\s*["']agents["']/g, receiver: 0 },
    // an Agent's turn engine reached on the Agent handle itself
    { seam: "agent.turn-start", re: /([A-Za-z_$][\w$]*)\?*\.followup\s*\(/g, receiver: 1 },
    { seam: "agent.turn-cancel", re: /([A-Za-z_$][\w$]*)\?*\.cancel\s*\(/g, receiver: 1 },
    // F2: the Agent's steer/inject seams. `ctx.inject(deps, cb)` is the CORDIS dependency seam and
    // is exempt by receiver — the Agent's `inject(message)` is the one that must be routed.
    { seam: "agent.turn-steer", re: /([A-Za-z_$][\w$]*)\?*\.steer\s*\(/g, receiver: 1 },
    { seam: "agent.turn-inject", re: /([A-Za-z_$][\w$]*)\?*\.inject\s*\(/g, receiver: 1 },
    // `subagents` used as a VALUE or through a member the facade does not promise. The facade's
    // `subagents` object is NOT the delivery runtime (it carries no `prompt`/`followup`/
    // `sendMessage`/`[HOST_PROMPT_QUEUE]`), so the ladder must be handed `subagentRuntimeOf(ctx)`.
    // NOTE: the facade exemption does NOT apply to this class — a `ctx.subagents` value use IS the
    // defect, which is exactly why tools.js:311 sat invisible to the contract's own roll-up.
    { seam: "subagents-runtime", re: /([A-Za-z_$][\w$]*)\?*\.subagents\b(?!\s*\??\.\s*(?:getProvider|list|startContinuable|interrupt|runtime)\b)/g, receiver: 1, facadeExempt: false },
    // `ctx.on` reached on something that is not the plugin's ctx-shaped binding
    { seam: "events.on", re: /([A-Za-z_$][\w$]*)\?*\.on\s*\(/g, receiver: 1 },
    // t23 item 3: spellings that HIDE the receiver. An alias, a destructure, a bracket read or
    // Reflect.get moves a facade member off the `ctx.` shape, so the facade exemption above can no
    // longer see it and a later `alias.get(id)` is invisible to a line-local scanner. The EXTRACTION
    // site is therefore the finding: it must sit inside a region, or not exist. The negative
    // lookahead keeps `const x = ctx.tools.register(def)` (a call THROUGH the facade) out of it.
    // `const a = ctx.agents` AND the shapes an earlier pass missed (t26 F4): a LATE assignment
    // (`let a; a = ctx.agents`) and a PARENTHESIZED receiver (`(ctx).agents`).
    { seam: "facade.alias", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*\(?\s*ctx\s*\)?\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b(?!\s*\??\.)/g, receiver: 0, facadeExempt: false },
    // t26 F4: the PASS-THROUGH method extracted into a binding (`const g = ctx.get; g('agents')`) —
    // a call is fine (`ctx.get("mpdDsh")`), the EXTRACTION loses the facade's receiver.
    { seam: "facade.get-extraction", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*\(?\s*ctx\s*\)?\??\s*\.\s*get\b(?!\s*\()/g, receiver: 0, facadeExempt: false },
    { seam: "facade.get-destructure", re: /(?:const|let|var)\s*\{[^}]*\bget\b[^}]*\}\s*=\s*\(?\s*ctx\s*\)?/g, receiver: 0, facadeExempt: false },
    // t26 F4: a SCOPED-ctx member extracted (`const t = agent.ctx.tools; t.restrict({…})`) — the
    // member call on the extracted binding is invisible to a line-local scanner, so the extraction
    // site is the finding. `X.ctx.member(` (a CALL) is left to the scoped-ctx.seam rule above.
    { seam: "scoped-ctx.extraction", re: /(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*ctx\s*\.\s*(?:tools|on|effect)\b(?!\s*\()/g, receiver: 0, facadeExempt: false },
    { seam: "scoped-ctx.destructure", re: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*[A-Za-z_$][\w$]*\s*\.\s*ctx\s*\.\s*(?:tools|on|effect)\b/g, receiver: 0, facadeExempt: false },
    { seam: "facade.destructure", re: /(?:const|let|var)\s*\{[^}]*\}\s*=\s*ctx\??\s*\.\s*(?:tools|agents|subagents|commands|systemPrompt|llm)\b/g, receiver: 0, facadeExempt: false },
    { seam: "facade.bracket", re: /ctx\s*\??\.?\s*\[\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect|get|inject)['"`]\s*\]/g, receiver: 0, facadeExempt: false },
    { seam: "facade.reflect", re: /Reflect\s*\.\s*get\s*\(\s*[^,()]+,\s*['"`](?:tools|agents|subagents|commands|systemPrompt|llm|on|effect)['"`]/g, receiver: 0, facadeExempt: false },
    // t23 item 4 (F4): the METHOD-EXTRACTION spelling — `X.get.call(X, id)`, `X.register.call(…)`,
    // `captain.followup.call(captain, msg)` — evades the `X.method(` rules above because `.call(`
    // replaces the call parenthesis. The ladder's own captures in harness-compat (D6/R2) are exempt
    // below; everything else must sit in a region.
    { seam: "seam.method-call", re: /([A-Za-z_$][\w$]*)\s*\.\s*(?:register|get|list|on|effect|restrict|startContinuable|interrupt|section|listModels|resolveCallConfig|followup|cancel|steer|inject|prompt|sendMessage)\s*\.\s*call\s*\(/g, receiver: 1 },
    // t26 F5: the BARE captured-method form (`prompt.call(runtime, …)`) — the shape LADDER_CAPTURES
    // exists for. Before this rule that exemption suppressed NOTHING (the reviewer's audit), so the
    // rule is what gives it a job: exempt inside harness-compat (the module that owns the ladder
    // policy, D6/R2), a finding in every other module. The lookbehind keeps the receiver-chained
    // `runtime.prompt.call(…)` on the rule above, so the two spellings stay distinguishable.
    { seam: "seam.captured-method-call", re: /(?<![.\w$])(queue|prompt|legacy|send|followup)\s*\.\s*call\s*\(/g, receiver: 1, facadeExempt: false },
]

/**
 * The five COUNTED residual lines of the host-handed child scope, addressed by IDENTITY (file +
 * trimmed text, T-55: a line number rots) — never by "this line mentions `childCtx`".
 */
const COUNTED_CHILD_CTX_LINES = [
    "members.js installContinuableMemberSetup(ctx, (childCtx, hostChild) => {",
    "members.js const child = hostChild ?? childCtx.agent;",
    "members.js const disposeFailure = childCtx.on('agent/error', async (payload) => {",
    "members.js const disposeSelection = installModelSelection(childCtx, selectionRef);",
    "members.js const disposeFallback = childCtx.on('agent/request-error', async (payload, next) => {",
]

/**
 * Per counted line, the ONE seam access the count covers. The five lines are SCANNED like every
 * other line (t23 item 3) — this map exempts exactly that access, so any ADDITIONAL seam reached on
 * a counted line, and any new line that mentions `childCtx` at all, is reported as a finding.
 */
const COUNTED_CHILD_CTX_ACCESSES = new Map([
    ["members.js const disposeFailure = childCtx.on('agent/error', async (payload) => {", "events.on"],
    ["members.js const disposeFallback = childCtx.on('agent/request-error', async (payload, next) => {", "events.on"],
])

/** A ctx-shaped binding: the plugin's own ctx aliases, never an Agent's scoped ctx. */
const FACADE_RECEIVER = /(^|\.)ctx$/
/** The receipts the ladder is allowed to read/patch on the RUNTIME it was handed (contract D6/R2). */
const LADDER_POLICY = /^runtime$/
/**
 * The ladder's own CAPTURED function names in `harness-compat.js` (`const prompt = runtime.prompt;`
 * and siblings): invoking one through `.call(runtime, …)` is the same D6/R2 policy the
 * `runtime.x(…)` spelling is, so the method-extraction rule must not read it as an evasion.
 */
const LADDER_CAPTURES = /^(?:queue|prompt|legacy|send|followup)$/

/**
 * Seam accesses on a NON-`ctx` receiver, split in two:
 *   - `findings` — a bypass that must be INSIDE an `mpd-delta` region (or the bridge module);
 *   - `residuals` — the declared, counted residual class: the scoped ctx the HOST hands the plugin's
 *     `setup(childCtx, child)` callback. `childCtx` is a callback parameter (the plugin never
 *     resolved it), `installModelSelection(childCtx, …)` hands it to a VENDORED host helper
 *     (`_deps/dsh-agent`, out of scope by D7), and on a legacy Alpha.2 host `childCtx` is not
 *     guaranteed to be `child.ctx`, so re-resolving it through `agentScope(agent)` could change the
 *     legacy path's behaviour. The count is asserted, so a NEW use of that parameter reddens.
 */
function inventory() {
    const findings = []
    const residuals = []
    for (const file of [...SERVER_FILES, BRIDGE_FILE]) {
        const source = readFileSync(join(libDir, file), "utf8")
        const { spans } = regionSpans(source)
        const inside = (index) => spans.some(([begin, end]) => index >= begin && index <= end)
        const lines = stripComments(source).split("\n")
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]
            if (line.trim() === "") continue
            const residualKey = `${file} ${line.trim().slice(0, 96)}`
            const countedLine = COUNTED_CHILD_CTX_LINES.includes(residualKey)
            const countedSeam = COUNTED_CHILD_CTX_ACCESSES.get(residualKey)
            if (countedLine) residuals.push(residualKey)
            if (!countedLine && /\bchildCtx\b/.test(line)) {
                // A NEW use of the host-handed ctx would otherwise hide inside the blanket identifier
                // skip this test used to have; it is a finding, never a silently grown residual.
                findings.push({ file, line: index + 1, seam: "childCtx.unregistered-use", receiver: "", text: line.trim().slice(0, 120) })
                continue
            }
            for (const rule of BYPASS_RULES) {
                const global = new RegExp(rule.re.source, "g")
                let match
                while ((match = global.exec(line)) !== null) {
                    const receiver = rule.receiver === 1 ? (match[1] ?? "") : ""
                    if (rule.facadeExempt !== false && FACADE_RECEIVER.test(receiver)) continue
                    if (file === "harness-compat.js" && (LADDER_POLICY.test(receiver) || LADDER_CAPTURES.test(receiver))) continue
                    // The counted access on a counted line IS the residual; anything else is a finding.
                    if (countedSeam !== undefined && rule.seam === countedSeam) continue
                    if (inside(index)) continue
                    findings.push({ file, line: index + 1, seam: rule.seam, receiver, text: line.trim().slice(0, 120) })
                }
            }
        }
    }
    return { findings, residuals }
}

/** Run the rule set over ONE in-memory line (no region spans), for the falsifiability arms below. */
function scanLineForRules(file, line) {
    const hits = []
    for (const rule of BYPASS_RULES) {
        const global = new RegExp(rule.re.source, "g")
        let match
        while ((match = global.exec(line)) !== null) {
            const receiver = rule.receiver === 1 ? (match[1] ?? "") : ""
            if (rule.facadeExempt !== false && FACADE_RECEIVER.test(receiver)) continue
            if (file === "harness-compat.js" && (LADDER_POLICY.test(receiver) || LADDER_CAPTURES.test(receiver))) continue
            hits.push(rule.seam)
        }
    }
    return hits
}

test("t23 item 3: the receiver-hiding spellings are CAUGHT — the new rules are not dead code", () => {
    // Each spelling must fire on its own; a rule that cannot fail is decoration, not a guard.
    const caught = [
        ["const agents = ctx.agents", "facade.alias"],
        ["const tools = ctx.tools;", "facade.alias"],
        ["const { get, list } = ctx.agents", "facade.destructure"],
        ["const { register } = ctx.tools", "facade.destructure"],
        ["ctx['agents'].get(id)", "facade.bracket"],
        ["ctx?.['tools'].register(def)", "facade.bracket"],
        ["Reflect.get(ctx, 'subagents')", "facade.reflect"],
        // F4: the method-EXTRACTION spelling (`get.call`) must fire too — that is the shape the
        // captain named, and it is what a `X.method(`-only rule set misses.
        ["ctx.agents.get.call(ctx.agents, id)", "seam.method-call"],
        ["ctx.tools.register.call(ctx.tools, definition)", "seam.method-call"],
        ["captain.followup.call(captain, message)", "seam.method-call"],
        ["invocation.agent.cancel.call(invocation.agent, cause, options)", "seam.method-call"],
        // t26 F4: the two newly named extraction shapes + the two spellings the review measured.
        ["const g = ctx.get; g('agents')", "facade.get-extraction"],
        ["const { get } = ctx", "facade.get-destructure"],
        ["let a; a = ctx.agents", "facade.alias"],
        ["const a = (ctx).agents", "facade.alias"],
        ["const t = agent.ctx.tools; t.restrict({})", "scoped-ctx.extraction"],
        ["const { restrict } = agent.ctx.tools", "scoped-ctx.destructure"],
    ]
    for (const [line, seam] of caught) expect(scanLineForRules("scheduler.js", line), line).toContain(seam)
    // NEGATIVE CONTROLS: a call THROUGH the facade is not an extraction, and a bare alias CALL is
    // invisible to a line-local scanner BY CONSTRUCTION — that is why the EXTRACTION site above is
    // what this guard covers, and why the extraction must live inside a region.
    expect(scanLineForRules("scheduler.js", "const x = ctx.tools.register(definition)")).toEqual([])
    expect(scanLineForRules("scheduler.js", "agents.get(id)")).toEqual([])
    expect(scanLineForRules("scheduler.js", "const captain = ctx.agents.get(sessionId)")).toEqual([])
    // …and the ladder's OWN receipts stay clean: `runtime.prompt.call(runtime, …)` (D6/R2 policy) and
    // its captured-function sibling inside harness-compat, which is where that policy lives.
    expect(scanLineForRules("harness-compat.js", "const receipt = await runtime.prompt.call(runtime, { requestId: randomUUID() })")).toEqual([])
    expect(scanLineForRules("harness-compat.js", "return queue.call(runtime, parent, childId, content, source, signal)")).toEqual([])
    expect(scanLineForRules("harness-compat.js", "return legacy.call(runtime, parent, childId, content, options)")).toEqual([])
    // t26 F5: the CAPTURED-function spelling the method-extraction rule anticipates, named exactly.
    expect(scanLineForRules("harness-compat.js", "return prompt.call(runtime, request, signal)")).toEqual([])
    expect(scanLineForRules("harness-compat.js", "return send.call(runtime, sender, targetId, content, options)")).toEqual([])
    // …and the documented pass-through idiom is NOT an extraction (a CALL, not a binding).
    expect(scanLineForRules("scheduler.js", "const dsh = (typeof ctx.get === \"function\" ? ctx.get(\"mpdDsh\") : undefined) ?? createDshAdapter(ctx)")).toEqual([])
    expect(scanLineForRules("scheduler.js", "const dsh = ctx.get(\"mpdDsh\")")).toEqual([])
    // The SAME spelling outside harness-compat is a finding — the exemption is module-scoped, not global.
    expect(scanLineForRules("members.js", "return runtime.prompt.call(runtime, request, signal)")).toEqual(["seam.method-call"])
    // …and the CAPTURED form is NOT exempt outside harness-compat either (the exemption is scoped to
    // the module that owns the ladder policy, never to the spelling) — this arm is what proves the
    // LADDER_CAPTURES exemption has a real job rather than suppressing nothing.
    expect(scanLineForRules("harness-compat.js", "return prompt.call(runtime, request, signal)")).toEqual([])
    expect(scanLineForRules("members.js", "return prompt.call(runtime, request, signal)")).toEqual(["seam.captured-method-call"])
    expect(scanLineForRules("members.js", "return legacy.call(runtime, parent, childId, content, options)")).toEqual(["seam.captured-method-call"])
})

test("AC15: no adopted server file reaches a harness seam on a receiver the facade cannot cover", () => {
    const { findings } = inventory()
    const report = findings.map((hit) => `${hit.file}:${hit.line} ${hit.seam} on "${hit.receiver}" — ${hit.text}`).join("\n")
    expect(findings, `unrouted seam access(es):\n${report}`).toEqual([])
})

test("AC15: the host-handed child scope is a COUNTED residual, never an unseen path", () => {
    const { residuals } = inventory()
    // The assertion is on the MEMBER USE, not on a line number: the class is counted (a new use of
    // the parameter reddens) while an edit above it cannot rot the test (T-55).
    expect(residuals).toEqual([
        "members.js installContinuableMemberSetup(ctx, (childCtx, hostChild) => {",
        "members.js const child = hostChild ?? childCtx.agent;",
        "members.js const disposeFailure = childCtx.on('agent/error', async (payload) => {",
        "members.js const disposeSelection = installModelSelection(childCtx, selectionRef);",
        "members.js const disposeFallback = childCtx.on('agent/request-error', async (payload, next) => {",
    ])
})

test("F2/AC15: the Class-B set is inventoried exactly, so it cannot grow silently", () => {
    // `whenIdle` is Class B by the captain's F2 ruling: a quiescence await on the live handle, not a
    // capability that changes the session. The inventory is exact, so a THIRD site reddens here.
    const whenIdle = []
    for (const file of SERVER_FILES) {
        const lines = stripComments(readFileSync(join(libDir, file), "utf8")).split("\n")
        for (const line of lines) if (/\.whenIdle\s*\(/.test(line)) whenIdle.push(`${file} ${line.trim()}`)
    }
    expect(whenIdle.sort()).toEqual([
        "members.js await child.whenIdle();",
        "tools.js await Promise.race([live.whenIdle(), aborted]);",
    ])
})

test("AC15: the bridge is the ONLY server module holding a raw-context fallback expression", () => {
    const rawFallbacks = ["targetCtx.tools.register(", "targetCtx.agents.get(", "targetCtx.agents.list(", "targetCtx.subagents.getProvider(",
        "targetCtx.subagents.startContinuable(", "targetCtx.subagents.interrupt(", "targetCtx.subagents", "targetCtx.commands.register(",
        "targetCtx.systemPrompt.section(", "targetCtx.llm.listModels(", "targetCtx.llm.resolveCallConfig(", "targetCtx.on(",
        "agent.followup(", "agent.cancel(", "ctx?.get?.('agents')"]
    const bridge = readFileSync(join(libDir, BRIDGE_FILE), "utf8")
    for (const expression of rawFallbacks) expect(bridge).toContain(expression)
    for (const file of SERVER_FILES) {
        const code = stripComments(readFileSync(join(libDir, file), "utf8"))
        for (const expression of rawFallbacks) {
            expect(code.includes(expression), `${file} carries the raw fallback "${expression}" outside the bridge`).toBe(false)
        }
    }
})

test("AC15: every region a server file carries is registered, and the six bridged files carry their frozen ids", () => {
    const registered = new Set(MPD_DELTAS.map((delta) => `${delta.file.split("/").pop()}::${delta.id}`))
    // Contract §5: the ids each bridged file must carry (a region may be repeated only in the
    // spelling sense — every id below is asserted present, never merely "some region exists").
    const FROZEN_REGIONS = {
        "index.js": ["mpd-delta adapter-facade-import", "mpd-delta adapter-facade-wiring",
            "mpd-delta adapter-steer-approval-notice"],
        "capabilities.js": ["mpd-delta adapter-agent-scope-import", "mpd-delta adapter-agent-scope"],
        "harness-compat.js": ["mpd-delta adapter-subagent-runtime-import", "mpd-delta adapter-subagent-runtime-install",
            "mpd-delta adapter-subagent-runtime-agent-scope", "mpd-delta adapter-subagent-runtime-agent-scope-setup",
            "mpd-delta adapter-subagent-runtime-agent-scope-request", "mpd-delta adapter-subagent-runtime-agent-scope-effect",
            "mpd-delta adapter-subagent-runtime-guard", "mpd-delta adapter-subagent-runtime-agents-lookup"],
        "members.js": ["mpd-delta adapter-delivery-runtime-import", "mpd-delta adapter-delivery-runtime",
            "mpd-delta adapter-steer-captain-report", "mpd-delta adapter-steer-captain-report-caller"],
        "command.js": ["mpd-delta adapter-command-turn-submit", "mpd-delta adapter-command-turn-submit-profile"],
        "tools.js": ["mpd-delta adapter-turn-submit", "mpd-delta adapter-cancel-halt", "mpd-delta adapter-cancel-feedback",
            "mpd-delta adapter-cancel-discard", "mpd-delta adapter-subagent-runtime-halt-drain",
            "mpd-delta adapter-steer-send-message-caller", "mpd-delta adapter-inject-staged-discard"],
    }
    for (const file of [...SERVER_FILES, BRIDGE_FILE]) {
        const { ids } = regionSpans(readFileSync(join(libDir, file), "utf8"))
        for (const id of ids) expect(registered.has(`${file}::${id}`), `${file}: region "${id}" is not in lib/mpd-deltas.js`).toBe(true)
    }
    for (const [file, required] of Object.entries(FROZEN_REGIONS)) {
        const { ids } = regionSpans(readFileSync(join(libDir, file), "utf8"))
        for (const id of required) expect(ids, `${file} is missing its frozen region "${id}"`).toContain(id)
    }
})
