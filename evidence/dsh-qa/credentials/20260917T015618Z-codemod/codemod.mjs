#!/usr/bin/env node
// t17 codemod (DRY-RUN by default): route every lane's credential handling through the ONE
// resolver, `skills/dsh-qa/scripts/lib/credentials.mjs`.
//
// Two uniform rewrites, both of which are exact-line replacements (a line that does not match the
// documented shape is left alone and reported as untouched):
//   1. `cpSync(creds, join(<target>, ".credentials.yaml"))` (optionally under an existsSync guard)
//      -> `seedSandboxCredentials(<target>, { credentialsFile: creds })`
//      Only copies whose SOURCE is the real home's store are rewritten; a copy FROM another sandbox
//      home (e.g. session-start-team's side/control homes) stays a plain copy, because the source
//      has already been seeded by the site above it.
//   2. `const env = { ...process.env, <rest> }` -> `const env = credentialEnv({ ...process.env, <rest> })`
//      i.e. the child boot inherits the credential through the harness's WINNING route (the
//      inherited environment) instead of booting without one.
//
// Usage: node codemod.mjs <repoRoot> [--write]
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const repoRoot = process.argv[2] ?? process.cwd()
const WRITE = process.argv.includes("--write")
const scriptsDir = join(repoRoot, "skills/dsh-qa/scripts")
const COPY_RE = /^([ \t]*)(?:if \(existsSync\((creds|credentials)\)\) )?cpSync\((creds|credentials), join\(([A-Za-z0-9_$]+), (?:\.dsh, )?"\.credentials\.yaml"\)\)[ \t]*$/gm
const ENV_RE = /^([ \t]*)const env = \{ \.\.\.process\.env, (.+)\}[ \t]*$/gm

let files = 0
let copies = 0
let envs = 0
for (const file of readdirSync(scriptsDir).filter((name) => name.endsWith(".mjs")).sort()) {
  const path = join(scriptsDir, file)
  const original = readFileSync(path, "utf8")
  let text = original
  const used = new Set()
  const actions = []
  text = text.replace(COPY_RE, (_line, indent, _guard, source, target) => {
    used.add("seedSandboxCredentials")
    copies++
    const nested = _line.includes(', ".dsh", ".credentials.yaml")')
    const into = nested ? "join(" + target + ', ".dsh")' : target
    actions.push("seed " + into + " <- " + source)
    return indent + "seedSandboxCredentials(" + into + ", { credentialsFile: " + source + " })"
  })
  text = text.replace(ENV_RE, (_line, indent, rest) => {
    used.add("credentialEnv")
    envs++
    actions.push("credentialEnv")
    return indent + "const env = credentialEnv({ ...process.env, " + rest + " })"
  })
  if (used.size === 0) continue
  if (!text.includes('from "./lib/credentials.mjs"')) {
    const names = [...used].sort().join(", ")
    const lines = text.split("\n")
    let lastImport = -1
    for (let i = 0; i < lines.length; i++) if (/^import .* from ".*"$/.test(lines[i])) lastImport = i
    if (lastImport === -1) throw new Error(file + ": no import block to attach the resolver import to")
    lines.splice(lastImport + 1, 0, 'import { ' + names + ' } from "./lib/credentials.mjs"')
    text = lines.join("\n")
    actions.push("import " + names)
  }
  files++
  console.log((WRITE ? "WRITE " : "PLAN  ") + file + " :: " + actions.join(" | "))
  if (WRITE && text !== original) writeFileSync(path, text)
}
console.log((WRITE ? "applied" : "plan") + ": " + files + " file(s), " + copies + " credential copy site(s), " + envs + " child-environment site(s)")
