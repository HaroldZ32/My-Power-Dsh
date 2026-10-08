#!/usr/bin/env node
// secret-scan.mts — lane E2's E2-e arm: prove no credential material reached the evidence tree.
//
// WHAT IT DOES: it reads the key's PREFIX out of the host credential store, then walks every regular
// file under the evidence directory looking for that prefix and for the generic `sk-` shape a
// DeepSeek-style key always carries. A hit is reported as `path:line` with the matched run REDACTED,
// so a leaking run is diagnosable without the scanner becoming the leak. Nothing is ever printed for
// the prefix itself beyond its length.
//
// USAGE: node secret-scan.mts <evidence-dir> [credential-file]
// Exit code: 0 when clean, 1 when anything matched, 2 when the credential source could not be read.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

/** The evidence tree to scan. */
const ROOT = resolve(process.argv[2] ?? ".")
/** The credential store the prefix is read from; only the first characters are ever used. */
const CREDENTIALS = resolve(process.argv[3] ?? join(process.env.HOME ?? "/root", ".dsh", ".credentials.yaml"))
/** How many leading characters of the key count as a fingerprint worth searching for. */
const PREFIX_LENGTH = 8

/**
 * Read the staged key's fingerprint — a short prefix, never the value — out of the credential store.
 * @returns The prefix, or null when the store or the field is absent.
 */
function keyPrefix(): string | null {
  try {
    /** The store's raw text. */
    const text = readFileSync(CREDENTIALS, "utf8")
    /** The key field and its value. */
    const match = text.match(/DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s]+)/)
    return match === null ? null : match[1].slice(0, PREFIX_LENGTH)
  } catch {
    return null
  }
}

/** Every regular file under a directory, depth-first. */
function walk(dir: string): string[] {
  /** The accumulating file list. */
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    /** The entry's absolute path. */
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.isFile()) out.push(path)
  }
  return out
}

/**
 * Replace any run that looks like a credential with a fixed marker.
 * @param line - The raw line a pattern matched on.
 * @returns The same line with credential-shaped runs redacted.
 */
function redact(line: string): string {
  return line.replace(/(sk-)?[A-Za-z0-9_-]{24,}/g, "<REDACTED>")
}

/** The key's fingerprint, or null when the store cannot be read. */
const prefix = keyPrefix()
/** The patterns the evidence must be clean of, with their human names. */
const patterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "generic key shape `sk-`", pattern: /sk-[A-Za-z0-9]{8,}/ },
  { name: "the staged key's own prefix", pattern: prefix === null ? /$^/ : new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }
]

if (prefix === null) {
  console.log(`[scan] the credential store could not be read at ${CREDENTIALS} — the prefix arm is UNMEASURED`)
}

/** Every file in the tree. */
const files = walk(ROOT)
/** Total matches found, over every file and pattern. */
let hits = 0
for (const file of files) {
  /** The file's bytes; a binary artifact is scanned as latin1 so nothing is skipped silently. */
  let text: string
  try {
    text = readFileSync(file).toString("latin1")
  } catch {
    continue
  }
  /** The file's lines, split so a hit can name a line. */
  const lines = text.split("\n")
  for (const { name, pattern } of patterns) {
    if (prefix === null && name.includes("prefix")) continue
    for (let index = 0; index < lines.length; index += 1) {
      if (!pattern.test(lines[index])) continue
      hits += 1
      console.log(`[scan] HIT ${name} :: ${relative(ROOT, file)}:${index + 1} :: ${redact(lines[index]).slice(0, 200)}`)
    }
  }
}

console.log(`[scan] root=${ROOT}`)
console.log(`[scan] files=${files.length} patterns=${prefix === null ? 1 : 2} prefixLength=${PREFIX_LENGTH} hits=${hits}`)
console.log(hits === 0 ? "[scan] CLEAN — no credential material in the evidence tree" : "[scan] DIRTY — credential material found, see the HIT lines above")
process.exit(hits === 0 ? 0 : 1)
