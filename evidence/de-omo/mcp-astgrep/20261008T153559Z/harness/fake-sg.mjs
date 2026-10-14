#!/usr/bin/env node
// fake-sg.mjs — a stand-in ast-grep engine for the B1 differential proof.
//
// It records the argv of EVERY invocation (so the two servers' CLI translation can be compared
// byte-for-byte) and replays a canned, scenario-selected stdout/stderr/exit-code triple, so every
// branch of the payload assembly (matches, empty result, truncation, malformed stream, sg failure,
// rewrite apply, stale preview, rule-parse failure) can be exercised WITHOUT a real ast-grep binary,
// which is not installed on this machine.
//
// Scenarios come from FAKE_SG_SCENARIO; the argv log path comes from FAKE_SG_ARGV_LOG.
import { appendFileSync } from "node:fs"

/** argv handed to this fake engine, without the node executable and this script. */
const argv = process.argv.slice(2)
/** Path of the append-only argv log, one JSON line per invocation. */
const logPath = process.env.FAKE_SG_ARGV_LOG
/** Which canned answer to replay. */
const scenario = process.env.FAKE_SG_SCENARIO ?? "search-match"
/** Whether this invocation is the mutating pass (the only argv difference that matters). */
const applying = argv.includes("--update-all")

if (logPath) appendFileSync(logPath, JSON.stringify({ scenario, applying, argv }) + "\n")

if (argv.includes("--version")) {
  process.stdout.write("ast-grep 0.45.3\n")
  process.exit(0)
}

/** One match record with a single capture ($A) and a multi capture ($$$ARGS). */
const RECORD_A = {
  text: "foo(bar)",
  range: {
    byteOffset: { start: 10, end: 18 },
    start: { line: 2, column: 0 },
    end: { line: 2, column: 8 },
  },
  file: "src/a.ts",
  lines: "foo(bar)",
  charCount: { leading: 0, trailing: 0 },
  language: "TypeScript",
  metaVariables: {
    single: { A: { text: "bar", range: { byteOffset: { start: 14, end: 17 } } } },
    multi: { ARGS: [{ text: "bar", range: { byteOffset: { start: 14, end: 17 } } }] },
  },
  customField: 1,
}

/** A second match record, in another file, with no captures at all. */
const RECORD_B = {
  text: "baz()",
  range: {
    byteOffset: { start: 0, end: 5 },
    start: { line: 1, column: 0 },
    end: { line: 1, column: 5 },
  },
  file: "src/b.ts",
  lines: "baz()",
  charCount: { leading: 0, trailing: 0 },
  language: "TypeScript",
}

/** A scan match record: the rule facts live in the record, exactly as `sg scan --json` emits them. */
const SCAN_RECORD = {
  ...RECORD_A,
  replacement: "qux(bar)",
  replacementOffsets: { start: 10, end: 18 },
  ruleId: "no-foo",
  severity: "warning",
  note: "prefer qux",
  message: "foo is deprecated",
  labels: [{ style: "primary" }],
  metadata: { owner: "qa" },
}

/** One NDJSON line for a record. */
const line = (record) => JSON.stringify(record) + "\n"

/** Write the canned answer for this scenario and exit with its code. */
switch (scenario) {
  case "search-match":
  case "search-truncate":
    process.stdout.write(line(RECORD_A) + line(RECORD_B))
    process.exit(0)
    break
  case "search-none":
    process.exit(0)
    break
  case "sgerr":
    process.stderr.write("error: broken query\n")
    process.exit(2)
    break
  case "errornode":
    process.stdout.write(line(RECORD_A))
    process.stderr.write("Warning: Pattern contains an ERROR node\n")
    process.exit(0)
    break
  case "malformed":
    process.stdout.write("this is not json\n" + line(RECORD_A))
    process.exit(0)
    break
  case "garbage":
    process.stdout.write("this is not json\n")
    process.exit(0)
    break
  case "empty-stream":
    process.stderr.write("no parseable output\n")
    process.exit(0)
    break
  case "rewrite-dry":
  case "rewrite-apply":
  case "rewrite-stale":
    if (applying) {
      if (scenario === "rewrite-stale") process.exit(1)
      process.exit(0)
    }
    process.stdout.write(line({ ...RECORD_A, replacement: "qux($A)" }))
    process.exit(0)
    break
  case "scan-dry":
  case "scan-apply":
    if (applying) process.exit(0)
    process.stdout.write(line(SCAN_RECORD))
    process.exit(0)
    break
  case "scan-ruleparse":
    process.stderr.write("Cannot parse rule: bad yaml\n")
    process.exit(1)
    break
  case "scan-deprecated":
    process.stderr.write("warning: sg scan is deprecated in this configuration\n")
    process.stdout.write(line(SCAN_RECORD))
    process.exit(0)
    break
  default:
    process.stderr.write(`unknown FAKE_SG_SCENARIO: ${scenario}\n`)
    process.exit(3)
}
