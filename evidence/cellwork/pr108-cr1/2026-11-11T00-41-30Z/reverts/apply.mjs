// Reproducible revert/restore driver for the PR #108 round-1 evidence.
//
// Each finding directory holds a `spec.json` naming the target file, the baseline sha256 of the FIXED
// file, and one or more {before, after} text-file pairs. `apply` replaces each `before` block (which must
// occur EXACTLY once) with its `after` block; `restore` copies the byte-exact snapshot taken before the
// first apply. Nothing here touches git.
//
// Usage: node apply.mjs <finding-dir> apply|restore|check
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

/** The sha256 of one file's bytes. */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** Abort with a message and a non-zero exit. */
function fail(message) {
  process.stderr.write("FAIL: " + message + "\n")
  process.exit(2)
}

/** The finding directory and the action it was invoked with. */
const [dir, action] = process.argv.slice(2)
if (dir === undefined || outOfRange(action)) fail("usage: node apply.mjs <finding-dir> apply|restore|check")

/** Whether the action is one this driver implements. */
function outOfRange(value) {
  return value !== "apply" && value !== "restore" && value !== "check"
}

/** The checked-in spec for this finding. */
const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"))
/** The file the revert targets, relative to the repository root this script is run from. */
const target = spec.file
/** The byte-exact copy of the FIXED file, taken before the first revert. */
const snapshot = join(dir, "fixed.snapshot")

if (action === "check") {
  process.stdout.write(JSON.stringify({ id: spec.id, file: target, sha256: sha256(target) }) + "\n")
  process.exit(0)
}

if (action === "apply") {
  if (!existsSync(snapshot)) copyFileSync(target, snapshot)
  /** The bytes this revert started from; a non-baseline hash means someone else edited the tree. */
  const before = sha256(target)
  if (before !== spec.expectedSha256) fail("target does not match the recorded baseline sha256: " + before)
  if (sha256(snapshot) !== spec.expectedSha256) fail("snapshot does not match the recorded baseline sha256")
  let content = readFileSync(target, "utf8")
  for (const hunk of spec.hunks) {
    /** The FIXED text this hunk removes. */
    const needle = readFileSync(join(dir, hunk.before), "utf8")
    /** The PRE-FIX text it restores (empty = delete the block). */
    const replacement = readFileSync(join(dir, hunk.after), "utf8")
    /** How many times the fixed block occurs; anything but 1 makes the revert ambiguous. */
    const occurrences = content.split(needle).length - 1
    if (occurrences !== 1) fail(hunk.before + " occurs " + occurrences + " times in " + target + " (expected 1)")
    content = content.replace(needle, () => replacement)
  }
  writeFileSync(target, content)
  process.stdout.write(JSON.stringify({ id: spec.id, action: "apply", file: target, sha256_before: before, sha256_after: sha256(target) }) + "\n")
  process.exit(0)
}

// restore: the snapshot is the authority, so the bytes come back exactly as they were.
if (!existsSync(snapshot)) fail("no fixed.snapshot for " + spec.id + " — nothing to restore")
copyFileSync(snapshot, target)
/** The restored hash, asserted against the baseline the spec froze. */
const restored = sha256(target)
if (restored !== spec.expectedSha256) fail("restored file does not match the baseline sha256: " + restored)
process.stdout.write(JSON.stringify({ id: spec.id, action: "restore", file: target, sha256_after: restored }) + "\n")
