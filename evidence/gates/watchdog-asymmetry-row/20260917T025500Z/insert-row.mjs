// t42 evidence driver: insert the watchdog §1 rule-3 asymmetry row into
// agent-references/troubleshooting.md as EXACTLY ONE table row, after the existing
// long-tool-call watchdog row (its sibling case), and report the before/after
// byte counts + sha256 so the change is provable without reading the diff.
//
// Usage: node insert-row.mjs <repo-root>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const target = join(root, "agent-references/troubleshooting.md");
const rowPath = join(root, "evidence/gates/watchdog-asymmetry-row/20260917T025500Z/row.md");
const ANCHOR_PREFIX = "| a healthy team is paused ~90 s after a member starts a long tool call";

const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const before = readFileSync(target, "utf8");
const row = readFileSync(rowPath, "utf8").replace(/\n$/, "");
if (row.includes("\n")) throw new Error("the row file must hold exactly one line");

const lines = before.split("\n");
const anchors = lines.map((line, index) => (line.startsWith(ANCHOR_PREFIX) ? index : -1)).filter((index) => index >= 0);
if (anchors.length !== 1) throw new Error(`expected exactly 1 anchor line, found ${anchors.length}`);

const at = anchors[0] + 1;
const after = [...lines.slice(0, at), row, ...lines.slice(at)].join("\n");
writeFileSync(target, after);

const out = {
  target,
  anchorLine: anchors[0] + 1,
  insertedAtLine: at + 1,
  linesBefore: lines.length,
  linesAfter: before.split("\n").length + 1,
  bytesBefore: Buffer.byteLength(before, "utf8"),
  bytesAfter: Buffer.byteLength(after, "utf8"),
  sha256Before: sha(before),
  sha256After: sha(after),
  row,
};
console.log(JSON.stringify(out, null, 2));
