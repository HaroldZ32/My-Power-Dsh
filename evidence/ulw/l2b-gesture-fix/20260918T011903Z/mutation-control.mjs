#!/usr/bin/env node
// t15 mutation control: prove the new unit test is FALSIFIABLE.
//
// `apply` rewrites `claimGesture` in the plugin source back to the RETIRED behaviour — it
// claims the LAST user-role message carrying text and matches the gesture against that one
// (the t15 defect) — and the suite must then go RED on the real-composition-shape test.
// `restore` puts the verified fixed bytes back, and the caller must confirm the sha256 is
// unchanged. Nothing else is touched; the script refuses to run when its anchor is absent.
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const REPO = "/root/dshProj/my-power-dsh"
const TARGET = join(REPO, "packages", "mpd-ulw-plugin", "src", "index.ts")
const SNAPSHOT = join(REPO, "evidence", "ulw", "l2b-gesture-fix", "20260918T011903Z", "index.ts.fixed")

const FIXED = [
  "  if (!Array.isArray(messages)) return undefined",
  "  for (const message of messages) {",
  "    if (message?.role !== \"user\") continue",
  "    const text = messageText(message)",
  "    if (text === undefined) continue",
  "    const match = GESTURE_PATTERN.exec(text.trim())",
  "    if (match !== null) return { message, text, match }",
  "  }",
  "  return undefined",
].join("\n")

const RETIRED = [
  "  if (!Array.isArray(messages)) return undefined",
  "  for (let index = messages.length - 1; index >= 0; index -= 1) {",
  "    const message = messages[index]",
  "    if (message?.role !== \"user\") continue",
  "    const text = messageText(message)",
  "    if (text === undefined) continue",
  "    const match = GESTURE_PATTERN.exec(text.trim())",
  "    return match === null ? undefined : { message, text, match }",
  "  }",
  "  return undefined",
].join("\n")

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

const mode = process.argv[2]
if (mode === "apply") {
  const source = readFileSync(TARGET, "utf8")
  if (!source.includes(FIXED)) {
    console.error("MUTATION ANCHOR ABSENT — refusing to mutate (the fixed scan is not in the file)")
    process.exit(2)
  }
  writeFileSync(TARGET, source.replace(FIXED, RETIRED))
  console.log("mutation applied: claimGesture claims the LAST user-role text only (retired t15 behaviour)")
  console.log("sha256 now " + sha256(readFileSync(TARGET, "utf8")))
} else if (mode === "restore") {
  copyFileSync(SNAPSHOT, TARGET)
  const restored = readFileSync(TARGET, "utf8")
  console.log("restored from " + SNAPSHOT)
  console.log("sha256 now " + sha256(restored))
} else {
  console.error("usage: mutation-control.mjs apply|restore")
  process.exit(2)
}
