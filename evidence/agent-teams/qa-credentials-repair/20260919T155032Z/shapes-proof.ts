// t22 proof: `mergeRefsEntry` must NEVER emit a second top-level `refs:` key (a DUPLICATE_KEY that
// aborts the whole plugin tree at boot), for every shape it accepts — and must refuse loudly for the
// forms its hand-rolled text surgery cannot edit safely (a documented partial fix, never data loss).
//
// SECRET-FREE: this script uses SYNTHETIC key names and literal placeholder values only. It never
// reads ~/.dsh/.credentials.yaml and never prints a real credential value.
//
// Run: node evidence/agent-teams/qa-credentials-repair/<stamp>/shapes-proof.mjs   (exit 0 == all pass)
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..", "..", "..")
const { mergeRefsEntry } = await import(join(REPO, "skills", "dsh-qa", "scripts", "lib", "credentials.mjs"))

const KEY = "SYNTHETIC_KEY"
const VAL = "REDACTED-VALUE"
const REFUSAL = /refusing instead of appending a second top-level `refs:`/
const count = (text) => (text.match(/^refs:/gm) ?? []).length
const failures = []
function check(label, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + label + (detail === undefined ? "" : "  [" + detail + "]"))
  if (!ok) failures.push(label)
}

// (i) BARE `refs:` line (the shape that already worked) — block insertion, existing entry kept.
const bare = 'version: 1\nrecords:\n  provider-a:\n    apiKey: "REDACTED"\nrefs:\n  EXISTING: "kept"\n'
const bareOut = mergeRefsEntry(bare, KEY, VAL)
check("(i) bare refs: -> exactly ONE top-level refs", count(bareOut) === 1, "refs=" + count(bareOut))
check("(i) pre-existing block entry preserved verbatim", bareOut.includes('  EXISTING: "kept"'))
check("(i) new entry inserted into the block", bareOut.includes("  " + KEY + ": " + JSON.stringify(VAL)))

// (ii-a) INLINE EMPTY mapping — the operator's real shape, the one that broke.
const inlineEmpty = 'version: 1\nrecords:\n  provider-a:\n    apiKey: "REDACTED"\nrefs: {}\n'
const inlineEmptyOut = mergeRefsEntry(inlineEmpty, KEY, VAL)
check("(ii-a) refs: {} -> exactly ONE top-level refs", count(inlineEmptyOut) === 1, "refs=" + count(inlineEmptyOut))
check("(ii-a) new entry lands INSIDE the braces", inlineEmptyOut.includes("refs: {" + KEY + ": " + JSON.stringify(VAL) + "}"))
check("(ii-a) surrounding document preserved byte-for-byte",
  inlineEmptyOut.startsWith('version: 1\nrecords:\n  provider-a:\n    apiKey: "REDACTED"\n'))

// (ii-b) INLINE NON-EMPTY mapping — every existing entry must survive verbatim.
const inlineFilled = 'version: 1\nrefs: { KEEP_ME: "verbatim-value", OTHER: "x" }\n'
const inlineFilledOut = mergeRefsEntry(inlineFilled, KEY, VAL)
check("(ii-b) refs: { K: v } -> exactly ONE top-level refs", count(inlineFilledOut) === 1, "refs=" + count(inlineFilledOut))
check("(ii-b) existing inner text preserved VERBATIM", inlineFilledOut.includes('KEEP_ME: "verbatim-value", OTHER: "x"'))
check("(ii-b) new entry appended inside the braces", inlineFilledOut.includes(", " + KEY + ": " + JSON.stringify(VAL) + "}"))

// (ii-c) INLINE mapping with a trailing comma (valid YAML flow style).
const inlineComma = 'version: 1\nrefs: { A: "1", }\n'
const inlineCommaOut = mergeRefsEntry(inlineComma, KEY, VAL)
check("(ii-c) trailing comma tolerated, exactly ONE refs", count(inlineCommaOut) === 1 && inlineCommaOut.includes('{A: "1", ' + KEY + ":"),
 inlineCommaOut.trim().split("\n").pop())

// (iii) NO `refs:` at all — a new block is appended, still exactly one.
const none = 'version: 1\nrecords:\n  provider-a:\n    apiKey: "REDACTED"\n'
const noneOut = mergeRefsEntry(none, KEY, VAL)
check("(iii) no refs: -> exactly ONE appended refs block", count(noneOut) === 1, "refs=" + count(noneOut))
check("(iii) appended as a block with the new entry", noneOut.includes("refs:\n  " + KEY + ": " + JSON.stringify(VAL)))

// (iv) FLAT layout (no `version:`) still keeps the flat shape — unchanged behaviour. NOTE: the
// recognized flat key spelling is `[A-Za-z_][A-Za-z0-9_]*` (no hyphen) — a PRE-EXISTING rule of
// this merger, byte-identical to HEAD and deliberately not touched by this fix.
const flatOut = mergeRefsEntry('OPENCODE_GO_API_KEY: "REDACTED"\n', KEY, VAL)
check("(iv) flat layout stays flat (no refs block introduced)",
  !/^refs:/m.test(flatOut) && flatOut.includes(KEY + ": " + JSON.stringify(VAL)), flatOut.trim().split("\n").join(" | "))

// (v) DOCUMENTED BOUNDARY: forms the surgery cannot edit safely are REFUSED, never duplicated.
for (const [label, doc] of [
  ["multi-line flow mapping", 'version: 1\nrefs: {\n  A: "1"\n}\n'],
  ["alias/scalar value", "version: 1\nrefs: *some-anchor\n"],
]) {
  let refused = false
  try {
    mergeRefsEntry(doc, KEY, VAL)
  } catch (error) {
    refused = REFUSAL.test(String(error && error.message))
  }
  check("(v) " + label + " refused loudly (no duplicate key emitted)", refused)
}

// (vi) IDEMPOTENCE: a second merge on an already-merged document still yields exactly one `refs:`.
const twice = mergeRefsEntry(inlineEmptyOut, "SECOND_KEY", VAL)
check("(vi) second merge keeps ONE refs and both keys", count(twice) === 1 && twice.includes(KEY) && twice.includes("SECOND_KEY"))

console.log(failures.length === 0
  ? "[shapes-proof] ALL SHAPES PASS (bare / inline-empty / inline-filled / none / flat / refusals / idempotence)"
  : "[shapes-proof] FAILURES: " + failures.join(" | "))
process.exit(failures.length === 0 ? 0 : 1)
