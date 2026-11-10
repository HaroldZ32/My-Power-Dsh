// T5 DELTA RE-VERIFY PROBE — drives the SHIPPED pure decisions from the real workspace root.
// Reviewer evidence only: this file is never imported by product code and it edits nothing.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { captainShellDecision } from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"
import {
  captainInvestigationDecision,
  captainReadablePath,
} from "../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"

/** The workspace root the probe judges against: the checkout, exactly as the guarded session would. */
const ROOT: string = process.cwd()

/** Whether one token exists on disk, resolved against ROOT exactly like the installed shell guard. */
function pathExists(raw: string): boolean {
  try {
    if (raw === "") return false
    const absolute = raw.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(raw)
    return existsSync(absolute ? raw : join(ROOT, raw))
  } catch {
    return false
  }
}

/** The pure shell decision for one command, as the captain's own top-level `mpd` session would get it. */
function shell(command: string): string | undefined {
  return captainShellDecision({
    toolName: "bash",
    args: { command },
    workspaceRoot: ROOT,
    pathExists,
    topLevel: true,
    mode: "deny",
  })
}

/** The pure investigation decision for one tool call, as the captain's own top-level `mpd` session would get it. */
function invest(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
  return captainInvestigationDecision({ toolName, args, workspaceRoot: ROOT, topLevel: true, mode: "deny" })
}

/** One flattened verdict for the log. */
function flat(text: string | undefined): string {
  return text === undefined ? "ALLOWED" : "REFUSED"
}

/** One detail line with the refusal's opening clause, flattened. */
function detail(text: string | undefined): string {
  if (text === undefined) return ""
  return " :: " + text.replace(/\s+/gu, " ").slice(0, 220)
}

/** Counters for the summary. */
let total = 0
/** Rows whose observed verdict differs from the expectation the task states. */
let mismatched = 0

/** Assert one shell row against the expected verdict; print it either way. */
function expectShell(group: string, command: string, expected: "ALLOWED" | "REFUSED"): void {
  total += 1
  const verdict = shell(command)
  const observed = flat(verdict)
  const ok = observed === expected
  if (!ok) mismatched += 1
  console.log(
    (ok ? "OK  " : "MISMATCH ")
      + group.padEnd(6)
      + " exp=" + expected.padEnd(8)
      + " got=" + observed.padEnd(8)
      + " " + JSON.stringify(command)
      + detail(verdict),
  )
}

/** Assert one investigation row against the expected verdict; print it either way. */
function expectInvest(group: string, toolName: string, args: Record<string, unknown> | undefined, expected: "ALLOWED" | "REFUSED"): void {
  total += 1
  const verdict = invest(toolName, args)
  const observed = flat(verdict)
  const ok = observed === expected
  if (!ok) mismatched += 1
  console.log(
    (ok ? "OK  " : "MISMATCH ")
      + group.padEnd(6)
      + " exp=" + expected.padEnd(8)
      + " got=" + observed.padEnd(8)
      + " " + toolName + " " + JSON.stringify(args)
      + detail(verdict),
  )
}

/** Observe one shell row without asserting (false-positive hunt / declared-bound rows). */
function observeShell(group: string, command: string): void {
  const verdict = shell(command)
  console.log("OBSERVE " + group.padEnd(6) + " got=" + flat(verdict).padEnd(8) + " " + JSON.stringify(command) + detail(verdict))
}

console.log("## F1 — piped search verbs")
expectShell("F1", "git log --oneline | grep fix", "ALLOWED")
expectShell("F1", "ls -la | grep md", "ALLOWED")
expectShell("F1", "cat docs/decisions.md | grep TODO", "ALLOWED")
expectShell("F1", "cat docs/x | grep TODO packages/y.ts", "REFUSED")
expectShell("F1", "cat docs/decisions.md | grep TODO packages/mpd-roles-plugin/src/index.ts", "REFUSED")
expectShell("F1", "rg foo", "REFUSED")

console.log("")
console.log("## F2 — quote-aware splitting")
expectShell("F2", 'grep -E "fix|feat" docs/decisions.md', "ALLOWED")
expectShell("F2", "grep -E 'TODO|FIXME' docs/x", "ALLOWED")
expectShell("F2", 'grep -E "fix|feat" packages/mpd-roles-plugin/src/index.ts', "REFUSED")
{
  const refusal = String(shell('grep -E "fix|feat" packages/mpd-roles-plugin/src/index.ts') ?? "")
  const fullSegment = 'grep -E "fix|feat" packages/mpd-roles-plugin/src/index.ts'
  const truncated = 'grep -E "fix'
  console.log(
    "  F2 refusal-quote: fullSegment=" + String(refusal.includes(fullSegment))
      + " truncatedFragment=" + String(refusal.includes('"' + truncated + '"'))
      + " length=" + refusal.length,
  )
}

console.log("")
console.log("## F3 — cd tracking")
expectShell("F3", "cd packages && cat mpd-roles-plugin/src/index.ts", "REFUSED")
expectShell("F3", "cd packages && cd mpd-roles-plugin && cat src/index.ts", "REFUSED")
expectShell("F3", 'cd "$X" && cat packages/mpd-roles-plugin/src/index.ts', "REFUSED")
expectShell("F3", "cd $(pwd) && cat docs/decisions.md", "REFUSED")
expectShell("F3", "cd docs && cat decisions.md", "ALLOWED")
{
  const absoluteDoc = join(ROOT, "docs/decisions.md")
  const absoluteSource = join(ROOT, "packages/mpd-roles-plugin/src/index.ts")
  expectShell("F3", "cd packages && cat " + absoluteDoc, "ALLOWED")
  expectShell("F3", "cd docs && cat " + absoluteSource, "REFUSED")
}

console.log("")
console.log("## F4 — rg --files")
expectShell("F4", "rg --files docs/", "ALLOWED")
expectShell("F4", "rg --files", "REFUSED")
expectShell("F4", "rg --files packages/mpd-roles-plugin/src", "REFUSED")

console.log("")
console.log("## F5 — ast_grep_search paths every element")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["docs/", 42] }, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", { paths: [42, "docs/"] }, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["docs/", null] }, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["docs/", ""] }, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["docs/", "agent-references/"] }, "ALLOWED")
expectInvest("F5", "mcp__ast_grep__search", { paths: [] }, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", {}, "REFUSED")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["docs/"] }, "ALLOWED")
expectInvest("F5", "mcp__ast_grep__search", { paths: ["packages/mpd-roles-plugin/src/index.ts"] }, "REFUSED")
expectInvest("F5", "mcp__codegraph__codegraph_explore", { query: "x" }, "REFUSED")

console.log("")
console.log("## F6 — amended B3 arm + existence filter unchanged")
expectShell("F6", "cat packages/mpd-roles-plugin/src/index.ts", "REFUSED")
expectShell("F6", "cat packages/x.ts", "ALLOWED")
expectShell("F6", "rg foo docs/", "ALLOWED")
expectShell("F6", "sed -n '1,10p' docs/x.md", "ALLOWED")
expectShell("F6", "cat docs/x.md", "ALLOWED")
expectShell("F6", "git log -p", "ALLOWED")
expectShell("F6", "echo hi | cat", "ALLOWED")
expectShell("F6", "find . -name '*.ts'", "REFUSED")

console.log("")
console.log("## NITS — redirect targets stripped; sed -i is a write")
expectShell("NIT1", "cat docs/decisions.md > package.json", "ALLOWED")
expectShell("NIT1", "cat docs/decisions.md 2> packages/err.log", "ALLOWED")
expectShell("NIT1", "cat docs/decisions.md >out.txt", "ALLOWED")
expectShell("NIT2", "sed -i 's/a/b/' packages/mpd-roles-plugin/src/index.ts", "ALLOWED")
expectShell("NIT2", "sed -ni '1p' packages/mpd-roles-plugin/src/index.ts", "ALLOWED")
expectShell("NIT2", "sed --in-place 's/a/b/' packages/mpd-roles-plugin/src/index.ts", "ALLOWED")

console.log("")
console.log("## NEW WORK — substitution-aware whole-string pass, stdin exemption narrowed")
expectShell("NEW", "cat docs/decisions.md && ls packages", "ALLOWED")
expectShell("NEW", "cat docs/decisions.md && rm -rf node_modules", "ALLOWED")
expectShell("NEW", "echo $(cat packages/mpd-roles-plugin/src/index.ts)", "REFUSED")
expectShell("NEW", "echo `cat packages/x.ts`", "REFUSED")
expectShell("NEW", "echo $(cat docs/decisions.md)", "ALLOWED")
expectShell("NEW", 'echo "$(cat packages/mpd-roles-plugin/src/index.ts)"', "REFUSED")
expectShell("NEW", "git log | find", "REFUSED")
expectShell("NEW", "rg --files | head", "ALLOWED")
observeShell("NEW", "echo $(cat docs/decisions.md && ls packages)")
observeShell("NEW", "cat $(git rev-parse --show-toplevel)/packages/mpd-roles-plugin/src/index.ts")

console.log("")
console.log("## FALSE-POSITIVE SET — the captain's reasonable command set")
expectShell("FP", "git log --stat", "ALLOWED")
expectShell("FP", "git diff --stat", "ALLOWED")
expectShell("FP", "git status", "ALLOWED")
expectShell("FP", "git show HEAD:AGENTS.md", "ALLOWED")
expectShell("FP", "ls -la docs", "ALLOWED")
expectShell("FP", "ls packages", "ALLOWED")
expectShell("FP", "mkdir -p .mpd/tmp", "ALLOWED")
expectShell("FP", "mv a b", "ALLOWED")
expectShell("FP", "cat docs/decisions.md", "ALLOWED")
expectShell("FP", "cat docs/decisions.md && ls packages", "ALLOWED")
expectShell("FP", "sed -n '1,5p' docs/decisions.md", "ALLOWED")
expectShell("FP", "grep -rn TODO docs/", "ALLOWED")
expectShell("FP", "echo hi | cat", "ALLOWED")
expectShell("FP", "node -e '1+1'", "ALLOWED")
expectShell("FP", "wc -l AGENTS.md", "ALLOWED")
expectShell("FP", "head -20 CHANGELOG.md", "ALLOWED")
expectShell("FP", "rg TODO docs/", "ALLOWED")
expectShell("FP", "git log --oneline | grep fix", "ALLOWED")
expectShell("FP", "cat package.json", "REFUSED")

console.log("")
console.log("## FALSE-POSITIVE HUNT — extra reasonable captain commands (observed)")
for (const command of [
  "git diff docs/",
  "git show HEAD:CHANGELOG.md",
  "git show HEAD:package.json",
  "ls -la agent-references",
  "cat .mpd/plans/captain-recon-fence.md",
  "grep -n captain.shell .mpd/mpd.jsonc",
  "grep -rn captainShell agent-references/",
  "head -5 README.md",
  "cat CHANGELOG.md",
  "find docs -name '*.md'",
  "sed -n '1,10p' docs/decisions.md",
  "rg --files docs/",
  "wc -l docs/decisions.md",
  "diff docs/decisions.md docs/decisions.md",
  "sort docs/decisions.md",
  "jq . package.json",
  "git log --oneline -5",
  "git log -p -- docs/decisions.md",
]) observeShell("HUNT", command)

console.log("")
console.log("## BAND EDGES (captainReadablePath)")
for (const raw of [
  "CHANGELOG.md",
  "README.md",
  "AGENTS.md",
  "package.json",
  "docs/decisions.md",
  "packages/mpd-roles-plugin/src/index.ts",
  "docs/../packages/x.ts",
]) {
  console.log("band " + JSON.stringify(raw) + " -> " + String(captainReadablePath(ROOT, raw)))
}

console.log("")
console.log("SUMMARY total=" + total + " mismatched=" + mismatched)
