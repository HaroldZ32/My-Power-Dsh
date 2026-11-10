// T5 INDEPENDENT PROBE — drives the SHIPPED pure decision functions from the real workspace root.
// This file is reviewer evidence only; it is never imported by product code and it edits nothing.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { captainShellDecision } from "../../../../packages/mpd-roles-plugin/src/captain-shell.ts"
import { captainInvestigationDecision, captainReadablePath } from "../../../../packages/mpd-roles-plugin/src/captain-investigation.ts"
import { readTargetPath } from "../../../../packages/mpd-verify-plugin/src/law.ts"

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
function shell(command: string, topLevel: boolean = true, mode: "deny" | "allow" = "deny"): string | undefined {
  return captainShellDecision({ toolName: "bash", args: { command }, workspaceRoot: ROOT, pathExists, topLevel, mode })
}

/** The pure investigation decision for one tool call, as the captain's own top-level `mpd` session would get it. */
function invest(toolName: string, args: Record<string, unknown> | undefined, topLevel: boolean = true, mode: "deny" | "allow" = "deny"): string | undefined {
  return captainInvestigationDecision({ toolName, args, workspaceRoot: ROOT, topLevel, mode })
}

/** One shell line, flattened for the log. */
function flat(text: string | undefined): string {
  if (text === undefined) return "ALLOW"
  return "REFUSE :: " + text.replace(/\s+/gu, " ").slice(0, 150)
}

/** A row the probe expects to be refused. */
function expectRefused(command: string): void {
  const verdict = shell(command)
  console.log((verdict === undefined ? "MISMATCH(exp REFUSE) " : "ok-refused        ") + JSON.stringify(command) + " -> " + flat(verdict))
}

/** A row the probe expects to be allowed. */
function expectAllowed(command: string): void {
  const verdict = shell(command)
  console.log((verdict === undefined ? "ok-allowed        " : "MISMATCH(exp ALLOW) ") + JSON.stringify(command) + " -> " + flat(verdict))
}

/** A row the probe only observes (false-positive hunt); no expectation is asserted. */
function observe(command: string): void {
  console.log("observe           " + JSON.stringify(command) + " -> " + flat(shell(command)))
}

console.log("## B1 — contract §1 R1 spellings (expect REFUSE)")
for (const command of [
  "npm test",
  "npm run typecheck",
  "bun typecheck",
  "bun run --silent typecheck",
  "env FOO=1 bun run typecheck",
  "/usr/local/bin/bun test",
  "sudo -E bun test",
  "/usr/bin/bun test",
  "FOO=1 bun test",
  "command bun test",
  "nohup bun test",
  "time bun test",
  "sudo -u root bun test",
  "/usr/bin/env bun test",
  "npm run verify:gates",
  "npm run test:unit",
  "pnpm test",
  "pnpm run typecheck",
  "yarn test",
  "yarn run typecheck",
  "npx tsc",
  "npx jest",
  "npx vitest",
  "bun test --timeout 5000",
  "cd packages && bun test",
  "echo start; bun test",
  "git status | bun test",
]) expectRefused(command)

console.log("")
console.log("## B1 — anti-false-positive list (expect ALLOW)")
for (const command of [
  "git status",
  "ls",
  "ls -la docs",
  "mkdir -p x",
  "mkdir -p .mpd/tmp",
  "node -e '1+1'",
  "node -e \"1+1\"",
  "bun run format",
  "npm install",
  "cat docs/decisions.md",
  "echo \"bun test\"",
  "git log --stat",
  "git log --oneline -5",
  "git diff --stat",
  "git show HEAD:AGENTS.md",
  "mv a b",
  "echo hi | cat",
  "wc -l AGENTS.md",
  "head -20 CHANGELOG.md",
  "head -20 README.md",
  "rg TODO docs/",
  "sed -n '1,5p' docs/decisions.md",
  "cat README.md",
  "cat AGENTS.md",
  "find docs -name '*.md'",
  "grep -rn TODO docs/",
  "ag TODO docs/",
  "awk '{print}' docs/decisions.md",
  "tail -n 5 docs/decisions.md",
  "less docs/decisions.md",
  "nl docs/decisions.md",
  "git grep bun",
  "python3 -c 'print(1)'",
  "which bun",
  "pwd",
  "ls -la packages",
  "/usr/bin/env git status",
]) expectAllowed(command)

console.log("")
console.log("## B3 — contract §4 B3 arms (expected per the FROZEN TEXT)")
for (const command of [
  "cat packages/x.ts",
  "cat packages/mpd-roles-plugin/src/index.ts",
  "rg foo",
  "rg foo docs/",
  "sed -n '1,10p' docs/x.md",
  "cat docs/x.md",
  "git log -p",
  "echo hi | cat",
  "find . -name '*.ts'",
]) observe(command)

console.log("")
console.log("## B3 FALSE-POSITIVE HUNT — legitimate captain commands, observed only")
for (const command of [
  "git log --oneline | grep fix",
  "ls -la | grep md",
  "cat docs/decisions.md | grep TODO",
  "git status | head -3",
  "grep -E \"fix|feat\" docs/decisions.md",
  "grep -E 'TODO|FIXME' docs/decisions.md",
  "awk '/TODO|FIXME/' docs/decisions.md",
  "sed -n '/TODO/p' docs/decisions.md",
  "rg --files docs/",
  "rg --files -g '*.md' docs/",
  "grep -c TODO docs/decisions.md",
  "grep -rn TODO docs/ agent-references/",
  "find docs -name '*.md' -newer AGENTS.md",
  "head -c 200 docs/decisions.md",
  "cat \"docs/decisions.md\"",
  "cat package.json",
  "cat \"packages/mpd-roles-plugin/src/index.ts\"",
  "cat ./packages/mpd-roles-plugin/src/index.ts",
  "cat docs/../packages/mpd-roles-plugin/src/index.ts",
  "sed -i 's/TODO/TODO/g' packages/mpd-roles-plugin/src/index.ts",
  "sed -i.bak 's/TODO/TODO/g' docs/decisions.md",
  "cat docs/decisions.md > package.json",
  "cat docs/decisions.md > /tmp/t5-out.md",
  "cd packages/mpd-roles-plugin/src && cat captain-shell.ts",
  "cd packages && cat mpd-roles-plugin/src/index.ts",
  "bash -c 'bun test'",
  "sh -c 'npm test'",
  "env -u FOO bun test",
  "npm --prefix . test",
  "bun run --filter x test",
]) observe(command)

console.log("")
console.log("## B2 — investigation doors (expect REFUSE on source / ALLOW on docs)")
const source = "packages/mpd-roles-plugin/src/index.ts"
const docPath = "docs/decisions.md"
for (const [label, toolName, args] of [
  ["hashline source", "mpd_hashline_read", { path: source }],
  ["hashline docs", "mpd_hashline_read", { path: docPath }],
  ["hashline bare", "mpd_hashline_read", {}],
  ["hashline empty", "mpd_hashline_read", { path: "" }],
  ["codegraph bare", "mcp__codegraph__codegraph_explore", { query: "how does X work" }],
  ["ast search source", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [source] }],
  ["ast search docs", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/"] }],
  ["ast search src-second", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", source] }],
  ["ast search src-first", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [source, "docs/"] }],
  ["ast search empty", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [] }],
  ["ast search bare", "mcp__ast_grep__search", { pattern: "x", language: "typescript" }],
  ["ast search docs+42", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: ["docs/", 42] }],
  ["ast search 42", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [42] }],
  ["lsp find-def source", "mcp__lsp__find_definition", { file_path: source, line: 1, character: 1 }],
  ["lsp get-hover docs", "mcp__lsp__get_hover", { file_path: docPath, line: 1, character: 1 }],
  ["lsp symbols bare", "mcp__lsp__find_workspace_symbols", { query: "Captain" }],
  ["read source", "read", { path: source }],
  ["grep bare", "grep", { pattern: "TODO" }],
  ["glob bare", "glob", { pattern: "**/*.ts" }],
  ["glob docs", "glob", { pattern: "*.md", path: "docs/" }],
  ["member ast source", "mcp__ast_grep__search", { pattern: "x", language: "typescript", paths: [source] }],
  ["member hashline source", "mpd_hashline_read", { path: source }],
  ["allow hashline source", "mpd_hashline_read", { path: source }],
  ["lsp rename (write, not gated)", "mcp__lsp__rename_symbol", { file_path: source, new_name: "y" }],
] as const) {
  const topLevel = !label.startsWith("member")
  const mode = label.startsWith("allow") ? "allow" : "deny"
  const verdict = invest(toolName, args, topLevel, mode)
  console.log("B2 " + label + " -> " + flat(verdict))
}

console.log("")
console.log("## B2 — every lsp reader on a source file_path")
for (const toolName of [
  "mcp__lsp__find_definition",
  "mcp__lsp__get_hover",
  "mcp__lsp__find_references",
  "mcp__lsp__get_diagnostics",
  "mcp__lsp__find_consignment_placeholder",
  "mcp__lsp__find_implementation",
  "mcp__lsp__prepare_call_hierarchy",
  "mcp__lsp__get_incoming_calls",
  "mcp__lsp__get_outgoing_calls",
]) {
  if (toolName === "mcp__lsp__find_consignment_placeholder") continue
  const verdict = invest(toolName, { file_path: source, line: 1, character: 1 })
  console.log("B2 " + toolName + " -> " + flat(verdict))
}

console.log("")
console.log("## B2 — readTargetPath precedence (contract §7 amendment: existing shapes byte-identical)")
for (const [label, toolName, args] of [
  ["rewrite paths", "mcp__ast_grep__rewrite", { paths: ["packages/a.ts", "docs/b.md"] }],
  ["search paths", "mcp__ast_grep__search", { paths: ["packages/a.ts", "docs/b.md"] }],
  ["search docs-only", "mcp__ast_grep__search", { paths: ["docs/b.md"] }],
  ["search path-key", "mcp__ast_grep__search", { path: "docs/b.md" }],
  ["search empty-paths+path", "mcp__ast_grep__search", { paths: [], path: "docs/b.md" }],
  ["search nonarray-paths+path", "mcp__ast_grep__search", { paths: "docs/a.md", path: "docs/b.md" }],
  ["read path", "read", { path: "docs/a.md" }],
  ["read file_path", "read", { file_path: "docs/a.md" }],
  ["read filePath", "read", { filePath: "docs/a.md" }],
  ["read target", "read", { target: "docs/a.md" }],
  ["read bare", "read", {}],
  ["codegraph bare", "mcp__codegraph__codegraph_explore", { query: "x" }],
  ["rewrite path-key only", "mcp__ast_grep__rewrite", { path: "docs/b.md" }],
] as const) {
  console.log("readTargetPath " + label + " -> " + JSON.stringify(readTargetPath(toolName, args as Record<string, unknown>)))
}

console.log("")
console.log("## B2 — captainReadablePath band edges")
for (const raw of [
  "docs/decisions.md",
  "docs",
  ".mpd/mpd.jsonc",
  "evidence/guard",
  "agent-references/index.md",
  "packages/mpd-roles-plugin/src/index.ts",
  "packages",
  "scripts/verify-vendor.ts",
  "AGENTS.md",
  "packages/x/AGENTS.md",
  "docs/nested/AGENTS.md",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "LICENSE.md",
  "LICENSE-NOTICES.md",
  "package.json",
  "docs/../packages/x.ts",
  "../outside/AGENTS.md",
]) {
  console.log("band " + JSON.stringify(raw) + " -> " + String(captainReadablePath(ROOT, raw)))
}
