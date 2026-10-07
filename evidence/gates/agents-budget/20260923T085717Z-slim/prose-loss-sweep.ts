// PROSE-LOSS SWEEP — closes a MEASURED GAP in `preservation-audit.mjs`.
//
// That audit enumerates tokens (code spans, `T-<n>`, `§<n>`). It therefore CANNOT see a loss that is
// PROSE ONLY — e.g. the eleven role descriptions in the old §1 ("Architect (architecture review, deep
// debugging, self-review), …") are not code spans, so no token check could have caught their removal.
// This sweep asks the prose question instead:
//
//   for every SENTENCE of the old manual, does ANY 6-word run of it still occur (reflow-normalized,
//   case-folded) anywhere in the new manual?
//
// A sentence with zero surviving 6-word run was either DROPPED or fully rewritten. Both are legitimate
// outcomes for a compression, so the output is a TRIAGE LIST, not a verdict: each unmatched sentence is
// reported for a human/reviewer to accept or repair. The count is printed so the sweep's own limit is
// visible, and unmatched sentences are never silently folded into a pass.
//
// Usage: node prose-loss-sweep.mjs pre=<before-file> post=<after-file> [minWords=5] [limit=200]
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const i = a.indexOf("=");
  return [a.slice(0, i), a.slice(i + 1)];
}));
const pre = readFileSync(args.pre, "utf8");
const post = readFileSync(args.post, "utf8");
const MIN_WORDS = Number(args.minWords ?? 5);
const LIMIT = Number(args.limit ?? 200);

const normalize = (t) => t.replace(/\s+/g, " ").toLowerCase();
const SHINGLE = 6;

// MARKDOWN-EMPHASIS FLATTENING — the sweep's first run produced a measured false-positive class: the
// old text's `**bold**`/`` `code` `` markers differ from the new text's emphasis placement, so a rule
// that survived verbatim ("the docs gate does not discover that tree") still shingled differently.
// Both sides are flattened before shingling, so an emphasis change cannot masquerade as a loss.
const flatten = (t) => t.replace(/[*_`]/g, "");

// Sentences: split on a terminator followed by whitespace. Deliberately naive — a false split only
// shortens a unit, which can only make the sweep MORE aggressive, never quieter.
const sentences = (text) =>
  text
    .split(/\n\s*\n/)
    .flatMap((block) => block.split(/(?<=[.;:!?])\s+/))
    .map((s) => normalize(s).trim())
    .filter((s) => s.split(" ").length >= MIN_WORDS);

const shingles = (text) => {
  const words = normalize(flatten(text)).replace(/[^\p{L}\p{N} .,;:()/$<>|-]/gu, " ").split(" ").filter(Boolean);
  const set = new Set();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) set.add(words.slice(i, i + SHINGLE).join(" "));
  return set;
};

const postShingles = shingles(post);
const postFlatNorm = normalize(flatten(post));

const preUnits = sentences(pre);
const unmatched = [];
for (const unit of preUnits) {
  const words = normalize(flatten(unit)).replace(/[^\p{L}\p{N} .,;:()/$<>|-]/gu, " ").split(" ").filter(Boolean);
  let matched = false;
  for (let i = 0; i + SHINGLE <= words.length; i += 1) {
    if (postShingles.has(words.slice(i, i + SHINGLE).join(" "))) { matched = true; break; }
  }
  // A short unit (fewer than SHINGLE words) is matched by full-substring containment instead.
  if (!matched && words.length < SHINGLE) matched = postFlatNorm.includes(normalize(flatten(unit)));
  if (!matched) unmatched.push(unit);
}

const out = {
  preProseUnits: preUnits.length,
  postWordCount: normalize(post).split(" ").length,
  unmatchedCount: unmatched.length,
  shingleWords: SHINGLE,
  note: "TRIAGE LIST, not a verdict: a fully REWRITTEN sentence also lands here. Each entry is a claim that no 6-word run of the old sentence survives anywhere in the new manual.",
  unmatched: unmatched.slice(0, LIMIT),
  truncated: unmatched.length > LIMIT,
};
console.log(JSON.stringify(out, null, 2));
