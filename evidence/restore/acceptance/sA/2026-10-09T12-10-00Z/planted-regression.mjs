// Planted-regression falsifier for the S-A lane: apply ONE mutation to the frozen source, run the
// self-tests it must redden, then RESTORE the exact bytes from a backup and prove the restore with
// sha256. Nothing here edits a gate or a test to obtain a pass — the mutations live for one child
// process and the tree is hash-verified identical afterwards.
//
// Usage: node planted-regression.mjs <repoRoot> <stampDir> <p1|p2>
//   p1 — the reader ignores the v4 message-level `isError` (the silent-wrong-answer defect)
//   p2 — the tool-call frame loses its top-level `type` (the retired OpenAI streaming object)
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Repository root, first argument.
const repoRoot = process.argv[2]
// Evidence stamp directory, second argument.
const stampDir = process.argv[3]
// Which planted regression to apply, third argument.
const mode = process.argv[4]
// Where the pristine bytes are parked for the duration of the mutation.
const backupDir = join(stampDir, "planted-backups")
mkdirSync(backupDir, { recursive: true })

/** The sha256 of one file's bytes, so a restore is PROVEN rather than asserted. */
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")

// The file this mode mutates, and the self-tests it must redden.
const target = mode === "p1" ? join(repoRoot, "skills/dsh-qa/scripts/lib/session-evidence.ts") : join(repoRoot, "skills/dsh-qa/scripts/lib/messages-sse.ts")
// The self-tests run against the mutated tree, in order.
const probes = mode === "p1"
  ? [join(repoRoot, "skills/dsh-qa/scripts/lib/session-evidence.ts")]
  : [
    join(repoRoot, "skills/dsh-qa/scripts/lib/messages-sse.ts"),
    join(repoRoot, "skills/dsh-qa/scripts/readonly-deny.ts"),
    join(repoRoot, "skills/dsh-qa/scripts/software-smoke.ts"),
  ]

/** Run one `--self-test` and report its exit code plus the last non-empty output line. */
function selfTest(file) {
  try {
    const out = execFileSync(process.execPath, [file, "--self-test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    const lines = out.trim().split("\n")
    return { exit: 0, line: lines[lines.length - 1] }
  } catch (error) {
    const text = String(error.stdout ?? "") + String(error.stderr ?? "")
    const lines = text.trim().split("\n").filter((l) => l.length > 0)
    return { exit: error.status ?? -1, line: lines.length > 0 ? lines[lines.length - 1] : "(no output)" }
  }
}

// The pristine bytes, saved before anything is written.
const backup = join(backupDir, target.split("/").pop())
copyFileSync(target, backup)
// The hash the restore must reproduce.
const before = sha256(target)
console.log("### planted regression " + mode + " on " + target)
console.log("pristine sha256=" + before)

// The source text this mode rewrites, and the exact replacement it applies.
const source = readFileSync(target, "utf8")
// The needle/replacement pair, asserted UNIQUE so a mutation can never land on the wrong site.
const [needle, replacement] = mode === "p1"
  ? [
    '      isError: fieldOf(message, "isError") === true,',
    "      isError: false, // PLANTED REGRESSION: the v4 flag is ignored",
  ]
  : [
    '{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name, input: {} } },',
    '{ object: "chat.completion.chunk", index: 0, content_block: { type: "tool_use", id, name, input: {} } }, // PLANTED REGRESSION: no top-level `type`',
  ]
// How many times the needle occurs; anything but 1 aborts the experiment instead of guessing.
const occurrences = source.split(needle).length - 1
if (occurrences !== 1) {
  console.log("ABORT: the mutation needle occurs " + occurrences + " times, expected exactly 1")
  process.exit(2)
}
writeFileSync(target, source.replace(needle, replacement))
console.log("mutated sha256=" + sha256(target))
console.log("")
for (const probe of probes) {
  const result = selfTest(probe)
  console.log("MUTATED  " + probe.replace(repoRoot + "/", "") + " --self-test -> EXIT=" + result.exit)
  console.log("         " + result.line.slice(0, 300))
}
console.log("")

// The restore is UNCONDITIONAL: the pristine bytes go back whatever the probes reported.
copyFileSync(backup, target)
// The hash re-read after the restore, which must equal the pristine one.
const after = sha256(target)
console.log("restored sha256=" + after)
console.log("RESTORE " + (after === before ? "PROVEN (sha256 identical)" : "FAILED — the tree is NOT pristine"))
// The same self-test re-run on the restored bytes, so the mutation is shown to be the ONLY variable.
for (const probe of probes) {
  const result = selfTest(probe)
  console.log("RESTORED " + probe.replace(repoRoot + "/", "") + " --self-test -> EXIT=" + result.exit)
}
if (after !== before) process.exit(3)
