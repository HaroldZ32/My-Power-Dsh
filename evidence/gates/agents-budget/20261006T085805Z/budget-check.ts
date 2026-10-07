// Instruction-budget check for the 2026-10-06 AGENTS.md split — the INSTALLED harness's own
// workspace-instruction renderer, with the SAME 65,536-byte cap the live session uses.
//
// WHY A THIRD COPY: wave 1's instrument hard-coded a Linux nvm path that does not exist on this host,
// and wave 2's used a `renderWorkspaceContext` export this installed build does not have. THIS copy
// resolves the module from the installed dsh package on the CURRENT host and calls the export the
// installed build actually ships (`renderAgentInstructions`, whose marker text is exactly the
// "truncated AGENTS.md from N to M bytes" line a live session prints), so the instrument and the
// session agree by construction.
//
// Falsifiable in BOTH directions — the run asserts BOTH:
//   * the SPLIT manual MUST render with `truncated: []` and `omitted: []` (GREEN)  <- claim under test
//   * the PRE-SPLIT copy MUST render a truncated record (RED)                      <- negative control
//
// Usage: node budget-check.ts post=<path> control=<path>
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Candidate locations of the installed renderer, most specific first. */
const CANDIDATES = [
  process.env.DSH_AGENT_INSTRUCTIONS_MODULE,
  "/home/haroldzhao/.nvm/versions/node/v24.21.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-instructions/lib/index.js",
].filter((p): p is string => typeof p === "string" && p.length > 0);

const MODULE = CANDIDATES.find((p) => existsSync(p));
if (MODULE === undefined) {
  console.error(`renderer not found; tried:\n  ${CANDIDATES.join("\n  ")}`);
  process.exit(2);
}
const renderer = (await import(pathToFileURL(MODULE).href)) as {
  renderAgentInstructions: (
    files: { absolutePath: string; displayPath: string; content: string }[],
    options: { maxBytes: number; replacePreviousBaseline?: boolean },
  ) => { text: string; omitted: unknown[]; truncated: unknown[] };
};

/** The harness cap this session runs with. */
const MAX_BYTES = Number(process.env.BUDGET_BYTES ?? 65536);
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node budget-check.ts post=<path> control=<path>");
  process.exit(2);
}

/** One rendered reading per labelled input path. */
const results = args.map((target: string) => {
  const eq = target.indexOf("=");
  const label = target.slice(0, eq);
  const path = target.slice(eq + 1);
  const raw = readFileSync(path, "utf8");
  const content = raw.replace(/\r\n/g, "\n");
  const rendered = renderer.renderAgentInstructions(
    [{ absolutePath: resolve(path), displayPath: "AGENTS.md", content }],
    { maxBytes: MAX_BYTES, replacePreviousBaseline: false },
  );
  const truncated = rendered.truncated.length > 0 || rendered.omitted.length > 0;
  return {
    label,
    path: resolve(path),
    eolAsRead: raw.includes("\r\n") ? "crlf" : "lf",
    sourceBytes: Buffer.byteLength(content, "utf8"),
    renderedBytes: Buffer.byteLength(rendered.text, "utf8"),
    truncated,
    truncatedRecords: rendered.truncated,
    verdict: truncated ? "RED (truncated)" : "GREEN (full content injected)",
  };
});

const byLabel: Record<string, (typeof results)[number] | undefined> = Object.fromEntries(
  results.map((r) => [r.label, r]),
);
const checks = {
  post_renders_full_content: byLabel.post !== undefined && byLabel.post.truncated === false,
  post_under_budget: byLabel.post !== undefined && byLabel.post.renderedBytes <= MAX_BYTES,
  post_eol_is_lf: byLabel.post !== undefined && byLabel.post.eolAsRead === "lf",
  negative_control_is_red: byLabel.control !== undefined && byLabel.control.truncated === true,
};
const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);
console.log(
  JSON.stringify(
    {
      maxBytes: MAX_BYTES,
      renderer: MODULE,
      results,
      checks,
      verdict: failed.length === 0 ? "PASS" : "FAIL",
      failedChecks: failed,
    },
    null,
    2,
  ),
);
process.exit(failed.length === 0 ? 0 : 1);
