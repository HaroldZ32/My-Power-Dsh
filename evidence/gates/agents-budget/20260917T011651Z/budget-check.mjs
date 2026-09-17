// T-22 instruction-budget check: calls the INSTALLED harness's own workspace-instruction renderer
// (@deepseek-ai/dsh-agent-instructions, the module that produced the live session's
// "truncated AGENTS.md from 78283 to 65143 bytes" notice) with the same 65,536-byte budget.
//
// Falsifiable in BOTH directions:
//   * a file over the budget MUST render a non-empty `truncated` record (RED),
//   * a file under the budget MUST render `truncated: []` / `omitted: []` (GREEN).
//
// Usage: bun <this file> label=/abs/path/or/relative.md [label2=...]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MODULE =
  "/root/.nvm/versions/node/v24.16.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/lib/index.js";
const { renderWorkspaceContext } = await import(MODULE);

const MAX_BYTES = Number(process.env.BUDGET_BYTES ?? 65536);
const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: bun budget-check.mjs label=path [label=path ...]");
  process.exit(2);
}

const results = [];
for (const target of targets) {
  const eq = target.indexOf("=");
  const label = target.slice(0, eq);
  const path = target.slice(eq + 1);
  const content = readFileSync(path, "utf8");
  const rendered = renderWorkspaceContext(
    [{ absolutePath: resolve(path), displayPath: "AGENTS.md", content }],
    { maxBytes: MAX_BYTES, replacePreviousBaseline: false },
  );
  const renderedBytes = Buffer.byteLength(rendered.text, "utf8");
  const truncated = rendered.truncated.length > 0 || rendered.omitted.length > 0;
  results.push({
    label,
    path: resolve(path),
    sourceBytes: Buffer.byteLength(content, "utf8"),
    renderedBytes,
    underBudget: renderedBytes <= MAX_BYTES,
    truncated,
    omitted: rendered.omitted.map((file) => file.displayPath),
    truncatedRecords: rendered.truncated,
    verdict: truncated ? "RED (truncated)" : "GREEN (full content injected)",
  });
}

const out = { maxBytes: MAX_BYTES, renderer: MODULE, results };
console.log(JSON.stringify(out, null, 2));
process.exit(0);
