// T-22 move audit: proves the split neither dropped nor rewrote content.
//
// Every line of the PRE-split AGENTS.md belongs to exactly one contiguous segment; each segment is
// located byte-identically in the POST-split tree — either in the (now smaller) AGENTS.md core, or
// in the on-demand reference file it moved to. The only permitted transformation is the removal of
// the 2-space list-continuation indent from the §6 delta block (recorded per segment).
//
// Usage: bun <this file> <pre-split AGENTS.md> <post-split AGENTS.md> <repo root>
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const [prePath, postPath, rootArg] = process.argv.slice(2);
const root = resolve(rootArg ?? ".");
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const pre = readFileSync(prePath, "utf8");
const post = readFileSync(postPath, "utf8");
const preLines = pre.split("\n");
const lineCount = preLines.length;

const refs = {
  troubleshooting: readFileSync(resolve(root, "agent-references/troubleshooting.md"), "utf8"),
  deltas: readFileSync(resolve(root, "agent-references/agent-teams-deltas.md"), "utf8"),
};

// 1-based inclusive line ranges of the pre-split file, decided from the file's own headings.
const SEGMENTS = [
  { range: [1, 25], dest: "AGENTS.md core (§title + Language policy)", transform: "none" },
  { range: [26, 26], dest: "AGENTS.md core (blank separator)", transform: "none" },
  { range: [27, 160], dest: "AGENTS.md core (§1–§3 up to the layout tail)", transform: "none" },
  { range: [161, 268], dest: "AGENTS.md core (§3 tail + §4 + §5 + §6 head)", transform: "none" },
  { range: [269, 322], dest: "agent-references/agent-teams-deltas.md (MOVED)", transform: "-2 leading spaces (list continuation indent)" },
  { range: [323, 518], dest: "AGENTS.md core (§6 tail + §7–§11)", transform: "none" },
  { range: [519, 570], dest: "agent-references/troubleshooting.md (MOVED)", transform: "none" },
  { range: [571, lineCount], dest: "AGENTS.md core (§12 tail + §13)", transform: "none" },
];

const findings = [];
let coverageOk = true;
let cursor = 1;
const audit = [];

for (const seg of SEGMENTS) {
  const [a, b] = seg.range;
  if (a !== cursor) {
    coverageOk = false;
    findings.push(`line-range gap/overlap: expected ${cursor}, segment starts at ${a}`);
  }
  cursor = b + 1;
  const raw = preLines.slice(a - 1, b).join("\n");
  const transformed = seg.transform === "none" ? raw : raw.replace(/^ {2}/gm, "");
  const container = seg.dest.startsWith("agent-references/")
    ? refs[seg.dest.includes("troubleshooting") ? "troubleshooting" : "deltas"]
    : post;
  const found = container.includes(transformed);
  if (!found) findings.push(`segment ${a}-${b} NOT found byte-identically in ${seg.dest}`);
  audit.push({
    lines: `${a}-${b}`,
    lineCount: b - a + 1,
    bytes: Buffer.byteLength(raw, "utf8"),
    dest: seg.dest,
    transform: seg.transform,
    sha256_pre_segment: sha(raw),
    sha256_dest_match: found ? sha(transformed) : null,
    found,
  });
}
if (cursor !== lineCount + 1) {
  coverageOk = false;
  findings.push(`coverage ends at ${cursor - 1}, file has ${lineCount} lines`);
}

// The moved bodies must NOT survive inside the shrunken core (otherwise the manual would duplicate
// reference material and the byte saving would be illusory).
const deltaMoved = preLines.slice(268, 322).join("\n").replace(/^ {2}/gm, "");
const troubleshootingMarker = "| Symptom | Cause / fix |";
const duplicatesInCore = {
  delta_block_still_in_AGENTS_md: post.includes(deltaMoved),
  troubleshooting_table_still_in_AGENTS_md: post.includes(troubleshootingMarker),
};

// Insertions the split introduced into the core, each named here so the diff is auditable.
const requiredInsertions = [
  { what: "Reference Index heading", needle: "## Reference Index (on-demand)" },
  { what: "§6 delta-registry pointer", needle: "**The adopted-plugin delta registry lives in `agent-references/agent-teams-deltas.md`**" },
  { what: "§12 troubleshooting pointer", needle: "agent-references/troubleshooting.md" },
  { what: "§3 layout entry", needle: "├── agent-references/" },
  { what: "gates table kept", needle: "| Gate | Command | When |" },
  { what: "single-git-writer rule kept", needle: "ONE git writer per working tree — binding." },
  { what: "captain's standing rules kept", needle: "**The captain's standing rules (user-set, 2026-09-16)**" },
  { what: "plugin-authoring seams kept", needle: "**Harness seams go through `mpd-dsh-adapter` — binding.**" },
  { what: "delta-registry binding rules kept", needle: "regenerate it with `--write-registry`, never" },
];
const insertions = requiredInsertions.map((item) => ({ ...item, present: post.includes(item.needle) }));
for (const item of insertions) if (!item.present) findings.push(`required core content missing: ${item.what}`);

const sectionHeadings = (text) => [...text.matchAll(/^## .*$/gm)].map((m) => m[0]);
const numbered = (heads) => heads.filter((h) => /^## \d+\./.test(h));

const result = {
  pre: { path: resolve(prePath), bytes: Buffer.byteLength(pre, "utf8"), lines: lineCount },
  post: { path: resolve(postPath), bytes: Buffer.byteLength(post, "utf8"), lines: post.split("\n").length },
  savedBytes: Buffer.byteLength(pre, "utf8") - Buffer.byteLength(post, "utf8"),
  budget: 65536,
  postHeadroomBytes: 65536 - Buffer.byteLength(post, "utf8"),
  coverageOk,
  findings,
  movedBytes: audit.filter((s) => s.dest.includes("MOVED")).reduce((sum, s) => sum + s.bytes, 0),
  sectionHeadingsPre: sectionHeadings(pre),
  sectionHeadingsPost: sectionHeadings(post),
  numberedSectionsPost: numbered(sectionHeadings(post)),
  duplicatesInCore,
  insertions,
  segments: audit,
  verdict: coverageOk && findings.length === 0 ? "PASS (no rule dropped; every segment located)" : "FAIL",
};
console.log(JSON.stringify(result, null, 2));
process.exit(result.verdict.startsWith("PASS") ? 0 : 1);
