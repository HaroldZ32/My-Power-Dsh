#!/usr/bin/env node
// Redact DSH web-server access tokens from the wave's evidence tree, IN PLACE.
//
// WHY: AGENTS.md §10 forbids secret material in committed evidence. A web boot prints an
// access token into its log (`?<KEY>=<43-char secret>`), and the wave's evidence carries those
// logs (boot logs, arm results, served indexes). The tokens are ephemeral and local, but they
// are still credentials and must not enter the repository.
//
// IN-PLACE, never delete: every redaction keeps the file, its line count and its line
// structure, replacing only the SECRET VALUE with `token[redacted:Nch]`. A citation into a
// redacted file therefore still resolves, and a reader still sees that a token was present.
//
// THE MARKER ITSELF MUST NOT RE-TRIP THE SCAN: the replacement carries no `<KEY>=` literal, so
// a re-scan (`grep -rl '<KEY>='`) can no longer match a file merely because it was already
// redacted, and the legacy marker (`<KEY>=<redacted:Nch>`) is normalized to the same form here.
// The pattern is assembled from KEY so that THIS FILE — which is itself inside the scanned tree
// and quotes the pattern — cannot poison its own re-scan either.
//
// SYMLINKS: the walker uses `lstatSync`, reports every symlink and never follows one (following
// can leave the tree or loop). 0 symlinks exist outside the prune dirs today.
//
// SCOPE: the whole evidence dir of the wave, minus the sandbox trees that are pruned
// before the commit anyway (node_modules / cache / sandboxes).
//
// USAGE: node evidence/install-deps/integration/redact-tokens.mjs [--write]
//        (default is a DRY RUN that prints what it would change and re-hashes nothing)
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(dirname(dirname(HERE)))
const EVIDENCE = join(REPO, "evidence", "install-deps")
const WRITE = process.argv.includes("--write")

/** Sandbox trees are pruned before the commit; redacting them would be busywork. */
const SKIP_DIRS = new Set(["node_modules", "cache", "sandboxes", ".git"])
/** The access-token query key: the secret is this key, `=`, and 20+ URL-safe characters. */
const KEY = "token"
const ASSIGNMENT = KEY + "="
const TOKEN = new RegExp(ASSIGNMENT + "([A-Za-z0-9_-]{20,})", "g")
/**
 * The marker this pass leaves behind never contains the `<KEY>=` literal itself, so a re-scan for
 * token material cannot match a file merely because it was already redacted — the legacy marker
 * did exactly that. The legacy form is normalized here.
 */
const LEGACY_MARKER = new RegExp(ASSIGNMENT + "<redacted:(\\d+)ch>", "g")
/** The replacement marker: it names the redaction WITHOUT carrying the `<KEY>=` literal. */
const markerFor = (length) => "token[redacted:" + length + "ch]"
const symlinks = []

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const path = join(dir, entry)
    // lstat, never stat: a symlink inside the evidence tree must be REPORTED, never followed
    // (following one can leave the tree or loop). 0 symlinks exist outside the prune dirs today.
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      symlinks.push(relative(REPO, path))
      continue
    }
    if (stat.isDirectory()) yield* walk(path)
    else if (stat.isFile()) yield path
  }
}

let files = 0
let changed = 0
let tokens = 0
const touched = []
for (const path of walk(EVIDENCE)) {
  files += 1
  let text
  try {
    text = readFileSync(path, "utf8")
  } catch {
    continue
  }
  if (!text.includes(ASSIGNMENT)) continue
  let count = 0
  let redacted = text.replace(TOKEN, (_match, secret) => {
    count += 1
    return markerFor(secret.length)
  })
  redacted = redacted.replace(LEGACY_MARKER, (_match, length) => {
    count += 1
    return markerFor(length)
  })
  if (count === 0) continue
  changed += 1
  tokens += count
  touched.push(`${relative(REPO, path)} (${count})`)
  if (WRITE && redacted !== text) writeFileSync(path, redacted)
}

for (const line of touched) console.log(`[redact] ${WRITE ? "WROTE " : "would redact "}${line}`)
if (symlinks.length > 0) console.log(`[redact] symlink(s) skipped, never followed: ${symlinks.join(", ")}`)
console.log(
  `[redact] ${WRITE ? "redacted" : "would redact"} ${tokens} token value(s) in ${changed} of ${files} file(s)` +
    (WRITE ? "" : " — DRY RUN, nothing written (pass --write)"),
)
