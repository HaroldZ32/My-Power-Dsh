// Instruction-budget check for the AGENTS.md slim — the INSTALLED harness's own workspace-instruction
// renderer, with the same 65,536-byte cap the live session uses.
//
// WHY A NEW COPY: the wave-1 instrument (`20260917T011651Z/budget-check.mjs`) hard-codes a Linux nvm
// module path (/root/.nvm/...) that does not exist on this win32 host. This copy resolves the SAME
// module from the installed dsh package; the renderer, the cap and the verdict shape are unchanged, so
// the two instruments are comparable.
//
// Falsifiable in BOTH directions — the run asserts BOTH:
//   * the slimmed manual MUST render with `truncated: []` (GREEN)            <- the claim under test
//   * the archived oversized control MUST render a truncated record (RED)    <- the negative control
//
// Usage: node budget-check.mjs post=<path> control=<path> [extra=label=path ...]
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CANDIDATES = [
  process.env.DSH_AGENT_INSTRUCTIONS_MODULE,
  join(process.env.APPDATA ?? "", "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules",
    "@deepseek-ai", "dsh-agent-instructions", "lib", "index.js"),
].filter(Boolean);
const MODULE = CANDIDATES.find((p) => existsSync(p));
if (MODULE === undefined) {
  console.error(`renderer not found; tried:\n  ${CANDIDATES.join("\n  ")}`);
  process.exit(2);
}
const { renderWorkspaceContext } = await import(pathToFileURL(MODULE).href);

const MAX_BYTES = Number(process.env.BUDGET_BYTES ?? 65536);
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node budget-check.mjs post=<path> control=<path>");
  process.exit(2);
}

const results = [];
for (const target of args) {
  const eq = target.indexOf("=");
  const label = target.slice(0, eq);
  const path = target.slice(eq + 1);
  const content = readFileSync(path, "utf8");
  const rendered = renderWorkspaceContext(
    [{ absolutePath: resolve(path), displayPath: "AGENTS.md", content }],
    { maxBytes: MAX_BYTES, replacePreviousBaseline: false },
  );
  const truncated = rendered.truncated.length > 0 || rendered.omitted.length > 0;
  results.push({
    label,
    path: resolve(path),
    sourceBytes: Buffer.byteLength(content, "utf8"),
    renderedBytes: Buffer.byteLength(rendered.text, "utf8"),
    truncated,
    omitted: rendered.omitted.map((file) => file.displayPath),
    truncatedRecords: rendered.truncated,
    verdict: truncated ? "RED (truncated)" : "GREEN (full content injected)",
  });
}

const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
const out = { maxBytes: MAX_BYTES, renderer: MODULE, results };

// The assertions, named so a reader can falsify them independently of the printed JSON.
const checks = {
  post_renders_full_content:
    byLabel.post !== undefined && byLabel.post.truncated === false,
  post_under_budget:
    byLabel.post !== undefined && byLabel.post.renderedBytes <= MAX_BYTES,
  negative_control_is_red:
    byLabel.control !== undefined && byLabel.control.truncated === true,
};
const failed = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name);
out.checks = checks;
out.verdict = failed.length === 0 ? "PASS" : "FAIL";
out.failedChecks = failed;
console.log(JSON.stringify(out, null, 2));
process.exit(failed.length === 0 ? 0 : 1);
