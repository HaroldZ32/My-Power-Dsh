// t5 coverage probe: which files the extended gate actually resolves links in, and which classes it
// ignores. The scanner + band helpers are extracted VERBATIM out of scripts/verify-docs-parity.mjs
// (single-line sources copied by regex — no hand-retyping, so the probe cannot drift from the gate),
// then exercised on a throwaway fixture and on the real band list.
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "/root/dshProj/my-power-dsh/scripts/verify-docs-parity.mjs";
const text = readFileSync(SRC, "utf8");
const src = (sym) => {
  // A `const` helper is a one-liner; a `function` helper is captured with its whole body (the file
  // closes them at column 0, so a non-greedy slice to the next top-level `}` is exact).
  const one = text.match(new RegExp(`^const ${sym}\\b.*$`, "m"));
  if (one) return one[0];
  const fn = text.match(new RegExp(`^function ${sym}\\b[\\s\\S]*?^\\}`, "m"));
  if (fn) return fn[0];
  throw new Error(`cannot extract ${sym}`);
};

const LINK_INLINE = src("LINK_INLINE");
const LINK_SCHEME = src("LINK_SCHEME");
const linkTargetsBody = src("linkTargets");
const probe = `
${LINK_INLINE}
${LINK_SCHEME}
${linkTargetsBody}
const CASES = {
  "resolves: ./, bare, ../, nested": "[a](./x.md) [b](y.md) [c](../z.md) [d](sub/deep/y.md)",
  "fragment stripped, file still resolved": "[a](./x.md#section) [b](#anchor) [c](#)",
  "ignored: external schemes": "[a](https://e.invalid/x) [b](http://e.invalid) [c](mailto:me@e.invalid) [d](tel:+1) [e](data:text/plain,hi) [f](//host/x)",
  "ignored: code spans and fences": "\\\`[decoy](./nope.md)\\\`\\n\\n\\\`\\\`\\\`\\n[fenced](./also-nope.md)\\n\\\`\\\`\\\`\\n\\n[real](./x.md)",
  "ignored: title-only and empty": "[a]( \\"title\\" ) [b]() [c]()",
  "angle form and title": "[a](<./x.md>) [b](./x.md \\"the title\\")",
  "absolute-path target (root-relative!)": "[a](/docs/index.md) [b](/AGENTS.md)",
  "reference-style definition NOT scanned": "[a][ref]\\n\\n[ref]: ./x.md",
  "autolink NOT scanned": "<https://e.invalid/x> <mailto:x@e.invalid>",
};
const out = {};
for (const [k, v] of Object.entries(CASES)) out[k] = linkTargets(v).map((t) => t.target);
console.log(JSON.stringify(out, null, 2));
`;
const r = spawnSync("node", ["--input-type=module", "-e", probe], { encoding: "utf8", cwd: "/root/dshProj/my-power-dsh" });
console.log(r.stdout || r.stderr);
