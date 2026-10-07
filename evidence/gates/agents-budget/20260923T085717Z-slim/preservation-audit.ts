// PRESERVATION AUDIT for the AGENTS.md slim.
//
// T-22's `move-audit.mjs` could demand BYTE-IDENTITY per segment because that wave only MOVED text.
// This change COMPRESSES text, so byte-identity is not the right instrument. This audit asks the two
// questions that a compression must still answer:
//
//   (1) MACHINE CONTRACTS + BINDING RULES: does every contract another artifact depends on, and every
//       binding rule of the manual, still appear VERBATIM? A missing needle FAILS the run.
//   (2) TOKEN LOSS: every code-span token, `T-<n>` id and `§<n>` reference the OLD manual carried is
//       looked up in the NEW manual; a token that left the manual is then looked up in
//       `agent-references/*.md`. It is reported as `moved` (the on-demand reference still carries it)
//       or `DROPPED (review)` (it survives nowhere), and the DROPPED list fails the run so a silent
//       prose deletion cannot pass. Tokens are DATA here: the report is a discovery heuristic with a
//       printed count, never a claim that an absence is harmless.
//
// Usage: node preservation-audit.mjs pre=<before-file> post=<after-file> [root=<repo>]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf("=");
  return [a.slice(0, i), a.slice(i + 1)];
}));
const root = resolve(args.root ?? ".");
const prePath = resolve(args.pre ?? "");
const postPath = resolve(args.post ?? "");
if (!existsSync(prePath) || !existsSync(postPath)) {
  console.error("usage: node preservation-audit.mjs pre=<file> post=<file> [root=<repo>]");
  process.exit(2);
}
const pre = readFileSync(prePath, "utf8");
const post = readFileSync(postPath, "utf8");

// REFLOW NORMALIZATION — a compression legitimately re-wraps lines, so a rule must be compared as its
// WORDS, not as its byte layout. Both the needles and the looked-up text are whitespace-collapsed
// first: `regenerate it with `--write-registry`, never` and a backticked token split across a line
// break are the two false-positive classes this closes (measured on the first run of this instrument:
// 2 of 34 needles and 2 of 38 "lost" tokens were wrap artifacts, with the words present 100% intact).
// The instrument still reports the token census from the LITERAL text, so a real loss cannot hide.
const reflow = (text) => text.replace(/\s+/g, " ");
const postReflow = reflow(post);

// ─── (1) the contracts that must survive verbatim ────────────────────────────────────────────────
// Each needle is a CONTRACT, and the consumer that would break is named beside it.
const CONTRACTS = [
  ["adopted-namespace-exception", "Adopted plugins keep their plugin ids and tool names", "skills/dsh-qa/scripts/agent-teams-adopt.mjs asserts this exact substring"],
  ["delta-range-pointer", "A1–D42", "scripts/verify-docs-parity.mjs derives A1–D<n> from the registry table and reddens a stale site"],
  ["reference-index-heading", "## Reference Index (on-demand)", "the on-demand band's only in-manual entry point"],
  ["single-git-writer", "ONE git writer per working tree — binding.", "the captain's git-serialization rule"],
  ["captain-standing-rules", "**The captain's standing rules (user-set, 2026-09-16)**", "user-set standing rules"],
  ["adapter-binding-rule", "**Harness seams go through `mpd-dsh-adapter` — binding.**", "the one-contact-surface rule (§6)"],
  ["adapter-resolve-idiom", "ctx.get(\"mpdDsh\")", "the resolve idiom every plugin copies"],
  ["adapter-closure-closed", "The adopted-plugin exception is CLOSED", "the closure claim + its counted residual"],
  ["counted-residual-5-lines", "5 counted lines", "test/adapter-bypass-inventory.test.mjs asserts exactly those lines"],
  ["delta-registry-derived", "regenerate it with `--write-registry`, never", "the registry is derived, never hand-edited"],
  ["replacement-shaped-refusal", "REPLACEMENT-shaped", "the applier's refusal class after a human re-materialize"],
  ["readonly-deny-list", "read-only discipline is the exported deny list", "the seven-name deny list the roster exports"],
  ["deny-name-str-replace-editor", "str_replace_editor", "the DO-NOT-RE-ADD rule for the deny list"],
  ["regional-region-count-warning", "numbers move", "R5: the FIXED docs regex on the deltas doc"],
  ["pack-closure-bound", "expected-after-pack", "the freshness discriminator of the closure gate"],
  ["dump-config-composition-only", "COMPOSITION ONLY", "the composition-vs-load rule (§4/§7)"],
  ["lang-policy-exempt-marker", "docs-parity: exempt", "the in-file exemption the docs gate derives"],
  ["anticipatory-adder4", "docs/adder4.md", "the declared ANTICIPATORY class (rot guard)"],
  ["anticipatory-cnt8", "docs/cnt8.md", "the declared ANTICIPATORY class (rot guard)"],
  ["plan-glob-class", "docs/plan-*.md", "the docs gate's declared GLOB exemption class"],
  ["state-root-precedence", "session header cwd", "the workspace-root precedence every plugin must honor"],
  ["env-key-sg", "MPD_AST_GREP_SG_PATH", "read by upstream vendored code — never renamed"],
  ["env-key-codegraph", "MPD_CODEGRAPH_BIN", "read by upstream vendored code — never renamed"],
  ["env-key-workmate-home", "MPD_DSH_WORKMATE_ALLOW_REAL_HOME", "the deliberate real-home escape hatch (T-43)"],
  ["t88-derived-surfaces", "T-88", "derived surfaces declared at plan time"],
  ["t90-durable-anchors", "T-90", "the artifact-path anchor rule"],
  ["t91-pack-closure", "T-91", "the pack-closure bound"],
  ["t66-manual-paths", "verify-manual-paths", "the gate that audits THIS manual"],
  ["t22-troubleshooting-pointer", "agent-references/troubleshooting.md", "the moved §12 body"],
  ["t22-deltas-pointer", "agent-references/agent-teams-deltas.md", "the moved §6 delta registry"],
  ["gates-table", "| Gate | Command | When |", "the binding gate table"],
  ["principles-heading", "## 2. Principles", "the six principles"],
  ["tools-api", "dsh.registerTool(", "the tool registration contract"],
  ["workspace-root-helper", "dsh.workspaceRoot(exec)", "the ONE state-root helper"],
];
const contractRows = CONTRACTS.map(([id, needle, why]) => ({
  id, needle, why,
  present: postReflow.includes(reflow(needle)),      // the contract, compared reflow-insensitively
  presentLiteral: post.includes(needle),             // reported apart: a wrap-only difference is visible
}));

// ─── (2) the §N headings ──────────────────────────────────────────────────────────────────────────
const numbered = (text) => [...text.matchAll(/^## (\d+)\. (.*)$/gm)].map((m) => ({ n: Number(m[1]), title: m[2] }));
const preSections = numbered(pre);
const postSections = numbered(post);
const postNs = new Set(postSections.map((s) => s.n));
const missingSections = preSections.filter((s) => !postNs.has(s.n)).map((s) => `§${s.n} ${s.title}`);

// ─── (3) token loss ───────────────────────────────────────────────────────────────────────────────
// Candidate tokens: code spans, `T-<n>` ids and `§<n>` references. Only tokens with ≥2 non-space
// characters are considered; any token is DATA and a hit is a discovery, not a verdict.
const tokensOf = (text) => {
  const found = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) found.add(m[1].trim());
  for (const m of text.matchAll(/\bT-\d+[a-z]?\b/g)) found.add(m[0]);
  for (const m of text.matchAll(/§\d+(?:[–-]§?\d+)?/g)) found.add(m[0]);
  return [...found].filter((t) => t.replace(/\s+/g, "").length >= 2);
};

const refDir = join(root, "agent-references");
const refFiles = existsSync(refDir)
  ? readdirSync(refDir).filter((f) => f.endsWith(".md")).map((f) => ({ rel: `agent-references/${f}`, text: readFileSync(join(refDir, f), "utf8") }))
  : [];

// TRIAGE LEDGER — a token that left the manual must be either MOVED (still carried by an on-demand
// reference) or ACCEPTED here, each with a reason a reviewer can challenge. A token that is neither
// still FAILS the run, so this ledger records the decision instead of silencing it. Every entry below
// names what SURVIVES in the slimmer manual; none of them drops a rule.
const ACCEPTED_DROPS = {
  "--root-dshProj-my-power-dsh--": "illustrative sample of the session-dir key; the rule it illustrates (assertSessionsSandboxed) stays in the same sentence",
  "…T14-45-59.644Z": "the second of two timestamped dirs for the false-red reading; the case name and the case-family dir `evidence/dsh-qa/codegraph/` are still cited",
  "./<path>": "the link-resolution rule is kept in words: a `./`- or `../`-spelled target resolves from the LINKING file's own directory",
  "../<path>": "same rule as `./<path>` (kept in words)",
  "/<path>": "same rule as `./<path>` (kept in words: a ROOT-relative `/`-spelled one resolves against the REPO ROOT)",
  "/mcp__…/": "the concrete assertion example; the rule it illustrates (asserting a tool NAME against the model's ANSWER is wrong in BOTH directions) is kept",
  "<bundle>/packages/mpd-ext-plugin/dist/validator.js": "§3 tree comment; the ext package README holds the contract and §3 now states the tree is a map, not a specification",
  "<workspace>/.mpd/team-compact/<teamId>/": "§3 tree comment (same map rule as above)",
  "<workspace>/.mpd/team/watchdog/": "§3 tree comment (same map rule as above)",
  "mcp__<server>__<raw>": "§3 tree comment; the naming-parity rule lives in the ext package README",
  "mpdExtensions": "§3 tree comment (same map rule)",
  "ctx.tui*": "§3 tree comment (same map rule)",
  "skillServing": "§3 tree comment (same map rule)",
  "1 changed path(s) not covered by inScope: …/dist/index.js is undeclared": "shortened to the message prefix `1 changed path(s) not covered by inScope`; the refusal it quotes and the rule it taught (T-88) are both kept",
  "docs/agent/**": "the register's literal suggestion; the binding rule it corrected (an English-only agent document belongs OUTSIDE docs/) is kept",
  "evidence/dsh-qa/codegraph/2026-09-14T08-56-10.102Z": "replaced by the case-FAMILY dir `evidence/dsh-qa/codegraph/`, which exists and still anchors the reading",
  "hephaestus": "illustrative roster id; the rule (a roster id is refused with a names-only error) is kept",
  "renamedFrom": "the rename semantics are kept (the directory name IS the instance key, which is what makes a rename a directory move); the field name lives in the workmate README",
  "rewriteFile": "the operative behaviour is kept (it rewrites bare import specifiers in place); the function name lives in the script",
  "cancelAgentTurn": "adapter seam method; the manual keeps the `agentTurn*`/`subagent*` family names and names `packages/mpd-dsh-adapter-plugin` as the ONE surface that defines them",
  "injectAgentMessage": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "interruptAgent": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "startAgentTurn": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "startContinuableAgent": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "steerAgentTurn": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "subagentProvider": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "subagentProviders": "adapter seam method (same family decision as `cancelAgentTurn`)",
  "WORKMATE_TOOLS": "RESTORED in the same pass as part of the §4 mounting-boot anchor (see the `--dump-config` paragraph)",
  "…/20260910T132303Z-mount/mount-proof.result.json": "IMPROVED, not lost: the elided spelling was replaced by the FULL path `evidence/workmate/rename-delete-core/20260910T132303Z-mount/mount-proof.result.json`, which is what makes the citation auditable by verify-manual-paths (an elision is only an under-report bucket there)",
  "re-anchors the comparison for a reviewer mutating a COPY). The closure gate's own": "NOT a token: a MIS-PAIRED code span created by line-wrapping in the OLD file (the opening backtick of `` `--pack-stamp `` sat at a line end, so the span ran to the NEXT backtick). The sentence's words are fully present in the new manual; only the backtick pairing changed, which is why it cannot be found as a string",
};

const preTokens = tokensOf(pre);
const lost = preTokens.filter((t) => !postReflow.includes(reflow(t)));
const lostRows = lost.map((token) => {
  const carriers = refFiles.filter((f) => f.text.includes(token)).map((f) => f.rel);
  if (carriers.length > 0) return { token, status: "moved", inReferences: carriers, reason: "still carried by the on-demand reference(s) listed" };
  const accepted = ACCEPTED_DROPS[token];
  return accepted === undefined
    ? { token, status: "DROPPED (review)", inReferences: [], reason: "not in the manual, not in the references, not in the triage ledger" }
    : { token, status: "accepted", inReferences: [], reason: accepted };
});
const dropped = lostRows.filter((r) => r.status === "DROPPED (review)");

// ─── verdict ──────────────────────────────────────────────────────────────────────────────────────
const results = {
  pre: { path: prePath, bytes: Buffer.byteLength(pre, "utf8"), lines: pre.split("\n").length },
  post: { path: postPath, bytes: Buffer.byteLength(post, "utf8"), lines: post.split("\n").length },
  savedBytes: Buffer.byteLength(pre, "utf8") - Buffer.byteLength(post, "utf8"),
  savedPercent: Number((100 * (Buffer.byteLength(pre, "utf8") - Buffer.byteLength(post, "utf8")) / Buffer.byteLength(pre, "utf8")).toFixed(1)),
  budget: 65536,
  postHeadroomBytes: 65536 - Buffer.byteLength(post, "utf8"),
  numberedSectionsPre: preSections.length,
  numberedSectionsPost: postSections.length,
  missingSections,
  contracts: contractRows,
  contractsMissing: contractRows.filter((c) => !c.present).map((c) => c.id),
  contractsPresentOnlyAfterReflow: contractRows.filter((c) => c.present && !c.presentLiteral).map((c) => c.id),
  tokenCensus: {
    preDistinct: preTokens.length,
    leftTheManual: lost.length,
    movedToReferences: lostRows.filter((r) => r.status === "moved").length,
    acceptedWithReason: lostRows.filter((r) => r.status === "accepted").length,
    dropped: dropped.length,
  },
  tokenLoss: lostRows.sort((a, b) => a.status.localeCompare(b.status) || a.token.localeCompare(b.token)),
};
const failed = [];
if (missingSections.length > 0) failed.push("missing numbered section(s)");
if (results.contractsMissing.length > 0) failed.push("missing contract needle(s)");
if (dropped.length > 0) failed.push("token(s) lost from both the manual and the references");
results.failedChecks = failed;
results.verdict = failed.length === 0 ? "PASS" : "FAIL";
console.log(JSON.stringify(results, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
