// Negative-control helper (B9 evidence only; lives in gitignored .qa-reloc/).
// Removes the mpd-verif row block that scripts/install-profile.mjs declares, so
// scripts/verify-rows-parity.mjs can be shown to fail and name the missing id.
import { readFileSync, writeFileSync } from "node:fs"

const p = "scripts/install-profile.mjs"
const lines = readFileSync(p, "utf8").split("\n")
const MARKER = "    // B9: mirror the bundle patch's row verbatim (same id, entry and empty config)"
const start = lines.findIndex((l) => l === MARKER)
if (start < 0) throw new Error("B9 marker line not found")
let end = -1
for (let i = start; i < lines.length; i++) if (lines[i] === "    }") { end = i; break }
if (end < 0) throw new Error("verif row closing brace not found")
lines[start - 1] = lines[start - 1].replace(/,$/, "")
lines.splice(start, end - start + 1)
writeFileSync(p, lines.join("\n"))
console.log("[negctl] removed installer lines " + (start + 1) + ".." + (end + 1) + " (the mpd-verif row)")
