#!/usr/bin/env node
// The ONE credential resolver for the dsh-qa lanes (T-58).
//
// Measured problem this fixes: the host HAS the key (`/root/.bashrc:129` exports
// `DEEPSEEK_API_KEY`) but a non-interactive shell — `bash -c` AND `bash -lc` — does not inherit
// it, and `~/.dsh/.credentials.yaml` is a RECORDS store with no deepseek entry. So every lane that
// boots a live provider booted WITHOUT a credential and died in an inner step, which read as a lane
// failure while the real cause was a missing prerequisite.
//
// Resolution order (each tier is tried positively; the first hit wins) — it mirrors the harness's
// own `@deepseek-ai/dsh-credentials-local` layering, whose docstring states the inherited process
// environment wins, then the provider-managed store, then the `.env` fallbacks:
//
//   1. environment            the inherited process env, e.g. an exported DEEPSEEK_API_KEY
//   2. credentials file       `$DSH_HOME/.credentials.yaml` (or ~/.dsh/.credentials.yaml):
//                             `refs:` (POSIX-identifier key -> secret string), a recognized FLAT
//                             layout (`DEEPSEEK_API_KEY: <secret>`), or a `records:` entry of
//                             `kind: api-key` whose id names the provider
//   3. shell profile          `export DEEPSEEK_API_KEY=…` in ~/.bashrc, ~/.profile, ~/.bash_profile
//                             or ~/.zshrc
//
// What a lane does with a resolution:
//   const resolution = resolveProviderCredential()
//   const env = credentialEnv({ ...process.env, DSH_HOME: sandbox })      // route 1 (env wins)
//   seedSandboxCredentials(sandbox, { resolution })                       // route 2 (store refs)
//   if (!resolution.present) process.exit(refuseWithoutCredential({ caseSlug, resolution }))
//
// Never a secret in a log: only `credentialDescriptor()` (presence, source, file, line, LENGTH —
// never the value) may reach stdout or an evidence file, and the value is written only into the
// ephemeral sandbox store or a child environment.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const PROVIDER_KEY_NAME = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
}

const PROFILE_FILES = [".bashrc", ".profile", ".bash_profile", ".zshrc"]
const STRICT_FLAGS = ["--no-skip", "--require-pack"]
const REASON = "absent-credentials"

function keyNameFor(provider) {
  return PROVIDER_KEY_NAME[provider] ?? provider.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
}

/** Strip one layer of shell quotes; `undefined` when the value needs expansion we cannot evaluate. */
function shellScalar(raw) {
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  const unquoted = /^"(.*)"$/.test(trimmed) ? trimmed.slice(1, -1) : /^'(.*)'$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed
  if (unquoted === "" || unquoted.includes("$") || unquoted.includes("`")) return undefined
  return unquoted
}

/** Tier 3: the exported keys of the shell profile, read as text (never sourced, never executed). */
function fromShellProfile(keyName, home, tried, profileFiles) {
  for (const name of profileFiles) {
    const file = join(home, name)
    if (!existsSync(file)) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "absent" })
      continue
    }
    let text
    try {
      text = readFileSync(file, "utf8")
    } catch {
      tried.push({ tier: "shell-profile", detail: file, outcome: "unreadable" })
      continue
    }
    const pattern = new RegExp("^[ \\t]*(?:export[ \\t]+)?" + keyName + "[ \\t]*=[ \\t]*(.+)$", "m")
    const match = pattern.exec(text)
    if (!match) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "no " + keyName + " export" })
      continue
    }
    const value = shellScalar(match[1])
    if (value === undefined) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "found but not a literal value (quotes/expansion)" })
      continue
    }
    const line = text.slice(0, match.index).split(/\r?\n/).length
    tried.push({ tier: "shell-profile", detail: file + ":" + line, outcome: "hit" })
    return { value, source: "shell-profile", file, line }
  }
  return undefined
}

/**
 * Tier 2: the declared credentials document. The harness accepts a `refs:` mapping of
 * POSIX-identifier keys to secret strings, an equivalent FLAT layout (a document that is nothing
 * but such pairs), and a `records:` mapping whose `kind: api-key` entries carry a `key` string.
 */
function fromCredentialsFile(keyName, provider, file, tried) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    tried.push({ tier: "credentials-file", detail: file ?? "(none)", outcome: "absent" })
    return undefined
  }
  let text
  try {
    text = readFileSync(file, "utf8")
  } catch {
    tried.push({ tier: "credentials-file", detail: file, outcome: "unreadable" })
    return undefined
  }
  const bare = (raw) => shellScalar(raw)
  const flat = new RegExp("^[ \\t]{0,2}" + keyName + ":[ \\t]*(.+)$", "m").exec(text)
  if (flat) {
    const value = bare(flat[1])
    if (value !== undefined) {
      const line = text.slice(0, flat.index).split(/\r?\n/).length
      tried.push({ tier: "credentials-file", detail: file + ":" + line + " (flat layout)", outcome: "hit" })
      return { value, source: "credentials-file", file, line }
    }
  }
  const refsSection = /^refs:[ \t]*$/m.exec(text)
  if (refsSection) {
    const after = text.slice(refsSection.index + refsSection[0].length)
    const refLine = new RegExp("^[ \\t]+" + keyName + ":[ \\t]*(.+)$", "m").exec(after)
    if (refLine) {
      const value = bare(refLine[1])
      if (value !== undefined) {
        const line = text.slice(0, refsSection.index).split(/\r?\n/).length + after.slice(0, refLine.index).split(/\r?\n/).length
        tried.push({ tier: "credentials-file", detail: file + ":" + line + " (refs)", outcome: "hit" })
        return { value, source: "credentials-file", file, line }
      }
    }
  }
  const providerWord = provider.toLowerCase()
  const recordBlocks = text.split(/^ {2}(?=[A-Za-z0-9._@/-]+:[ \t]*$)/m)
  let sawRecord = false
  for (const block of recordBlocks) {
    // Records are keyed `<scope>/<id>` (e.g. `llm/deepseek-official`), so the provider is matched
    // against the ID LINE — never against a value-bearing line.
    const idLine = block.split(/\r?\n/, 1)[0]
    if (!new RegExp("^[ \\t]*[A-Za-z0-9._@/-]*" + providerWord, "i").test(idLine)) continue
    if (!/kind:[ \t]*"?'?api-key/.test(block)) continue
    sawRecord = true
    const keyLine = /key:[ \t]*(.+)$/m.exec(block)
    if (!keyLine) continue
    const value = bare(keyLine[1])
    if (value === undefined) continue
    tried.push({ tier: "credentials-file", detail: file + " (records api-key, provider-scoped)", outcome: "hit" })
    return { value, source: "credentials-file", file, line: null }
  }
  tried.push({ tier: "credentials-file", detail: file, outcome: sawRecord ? "provider api-key record present but carries no usable key value" : "present but carries no " + keyName + " entry" })
  return undefined
}

/**
 * Resolve the provider credential from the declared places. Never throws for a missing credential:
 * the caller decides whether that is a refusal (see `refuseWithoutCredential`).
 */
export function resolveProviderCredential(options = {}) {
  const provider = options.provider ?? "deepseek"
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const keyName = keyNameFor(provider)
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(home, ".dsh")
  const credentialsFile = options.credentialsFile ?? join(dshHome, ".credentials.yaml")
  const profileFiles = options.profileFiles ?? PROFILE_FILES
  const tried = []
  if (typeof env[keyName] === "string" && env[keyName].length > 0) {
    tried.push({ tier: "environment", detail: keyName, outcome: "hit" })
    return { present: true, provider, keyName, value: env[keyName], source: "environment", file: null, line: null, length: env[keyName].length, reason: null, tried }
  }
  tried.push({ tier: "environment", detail: keyName, outcome: "unset" })
  const fromFile = options.skipFile ? undefined : fromCredentialsFile(keyName, provider, credentialsFile, tried)
  if (fromFile) {
    return { present: true, provider, keyName, value: fromFile.value, source: fromFile.source, file: fromFile.file, line: fromFile.line, length: fromFile.value.length, reason: null, tried }
  }
  const fromProfile = options.skipProfile ? undefined : fromShellProfile(keyName, home, tried, profileFiles)
  if (fromProfile) {
    return { present: true, provider, keyName, value: fromProfile.value, source: fromProfile.source, file: fromProfile.file, line: fromProfile.line, length: fromProfile.value.length, reason: null, tried }
  }
  return { present: false, provider, keyName, value: null, source: null, file: null, line: null, length: 0, reason: REASON, tried }
}

/** The evidence-safe view: presence, source, location and LENGTH. Never the value. */
export function credentialDescriptor(resolution) {
  return {
    provider: resolution.provider,
    keyName: resolution.keyName,
    present: resolution.present,
    source: resolution.source,
    file: resolution.file,
    line: resolution.line,
    length: resolution.length,
    reason: resolution.reason,
    tried: resolution.tried,
  }
}

/** Tier 1 delivery: a child environment that carries the key (the harness's winning route). */
export function credentialEnv(baseEnv = process.env, options = {}) {
  const resolution = options.resolution ?? resolveProviderCredential(options)
  if (!resolution.present) return { ...baseEnv }
  return { ...baseEnv, [resolution.keyName]: resolution.value }
}

// The harness's credential store asserts OWNER-ONLY readability and refuses the row otherwise
// (measured: `credentials-local: <file> is readable beyond its owner (mode 644); run "chmod 600 …"`,
// which broke the whole web boot). Every write below therefore lands at 0600.
const STORE_MODE = 0o600

/**
 * Tier 2 delivery: copy the declared store and settings into the sandbox, and make sure the
 * sandbox's OWN store carries the key in the `refs:` mapping the harness reads — so a boot that
 * does not inherit the lane's environment still resolves it. Returns a value-free descriptor.
 */
export function seedSandboxCredentials(sandboxDir, options = {}) {
  const home = options.home ?? homedir()
  const env = options.env ?? process.env
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(home, ".dsh")
  const source = options.credentialsFile ?? join(dshHome, ".credentials.yaml")
  const settings = options.settingsFile ?? join(home, ".dsh", "settings.yaml")
  const resolution = options.resolution ?? resolveProviderCredential({ ...options, home, env })
  mkdirSync(sandboxDir, { recursive: true })
  const target = join(sandboxDir, ".credentials.yaml")
  const wrote = { storeCopied: false, settingsCopied: false, refsMerged: false }
  if (existsSync(source)) {
    let text
    try {
      text = readFileSync(source, "utf8")
    } catch {
      text = ""
    }
    if (text !== "") {
      writeFileSync(target, text, { mode: STORE_MODE })
      wrote.storeCopied = true
    }
  }
  if (resolution.present && resolution.source !== "credentials-file") {
    const existing = existsSync(target) ? readFileSync(target, "utf8") : ""
    writeFileSync(target, mergeRefsEntry(existing, resolution.keyName, resolution.value), { mode: STORE_MODE })
    wrote.refsMerged = true
  }
  if (wrote.storeCopied || wrote.refsMerged) {
    // `writeFileSync`'s mode is masked by the process umask and is ignored on an existing file, so
    // the owner-only mode is enforced explicitly on every path.
    chmodSync(target, STORE_MODE)
  }
  if (existsSync(settings)) {
    writeFileSync(join(sandboxDir, "settings.yaml"), readFileSync(settings))
    wrote.settingsCopied = true
  }
  return { ...credentialDescriptor(resolution), wrote }
}

/**
 * Put `KEY: <value>` into the document's `refs:` mapping: into an existing `refs:` section, into a
 * recognized FLAT layout, or as a new `refs:` section on a document that has none (the harness
 * rejects an unknown TOP-LEVEL key, so the entry must live under `refs:`).
 *
 * The `refs:` section is matched for EVERY shape, because a SECOND top-level `refs:` is a
 * DUPLICATE_KEY that aborts the whole plugin tree at boot. Measured: an INLINE mapping
 * (`refs: {}`) slipped past the bare-line-only match, the flat-layout branch was skipped because
 * the document has `version:`, and the fallthrough appended a second block.
 *
 * Handled: a bare `refs:` line (block form), and a SINGLE-LINE inline mapping (`refs: {}`,
 * `refs: { K: "v" }`) — the existing inner text is preserved verbatim and the new entry is
 * appended INSIDE the braces. NOT handled, and REFUSED LOUDLY rather than corrupted: a multi-line
 * flow mapping (`refs: {` … `}` on a later line), or any other non-mapping `refs:` value
 * (alias/scalar/list/comment) — a documented refusal beats a silent duplicate key or data loss.
 */
export function mergeRefsEntry(text, keyName, value) {
  const quoted = JSON.stringify(value)
  const entry = "  " + keyName + ": " + quoted
  if (text.trim() === "") return "version: 1\nrefs:\n" + entry + "\n"
  const refsLine = /^refs:[ \t]*(.*)$/m.exec(text)
  const hasVersion = /^version:[ \t]*\S/m.test(text)
  if (refsLine) {
    const tail = refsLine[1].trim()
    if (tail === "") {
      const before = text.slice(0, refsLine.index + refsLine[0].length)
      const after = text.slice(refsLine.index + refsLine[0].length)
      const lines = after.split(/\r?\n/)
      let lastContent = -1
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "") continue
        if (/^[ \t]/.test(lines[i])) lastContent = i
        else break
      }
      lines.splice(lastContent + 1, 0, entry)
      return before + lines.join("\n")
    }
    if (tail.startsWith("{") && tail.endsWith("}")) {
      // INLINE mapping on ONE line: append inside the braces, so every pre-existing entry (and its
      // exact spelling) survives byte-for-byte. A trailing comma is dropped first, or the appended
      // pair would follow an empty one.
      const inner = tail.slice(1, -1).trim().replace(/,[ \t]*$/, "")
      const merged = inner === "" ? "{" + keyName + ": " + quoted + "}" : "{" + inner + ", " + keyName + ": " + quoted + "}"
      return text.slice(0, refsLine.index) + "refs: " + merged + text.slice(refsLine.index + refsLine[0].length)
    }
    throw new Error("[mpd-qa] credentials merge: the staged .credentials.yaml carries a `refs:` form this merger cannot edit safely ("
      + (tail.startsWith("{") ? "a multi-line inline mapping" : "a non-mapping value")
      + ") — refusing instead of appending a second top-level `refs:` (a DUPLICATE_KEY that aborts the boot); make `refs:` an empty mapping (`refs: {}`) or a block (`refs:`) and re-run")
  }
  if (!hasVersion && /^[ \t]*[A-Za-z_][A-Za-z0-9_]*:[ \t]*\S/m.test(text)) {
    // A recognized FLAT layout: the harness itself migrates it, so keep the flat shape.
    return text.replace(/\s*$/, "\n") + keyName + ": " + quoted + "\n"
  }
  return text.replace(/\s*$/, "\n") + "refs:\n" + entry + "\n"
}

/** The canonical SKIP/FAIL marker from SKILL.md, so a lane refuses loudly instead of silently. */
export function missingCredentialMarker({ caseSlug, resolution, argv = process.argv.slice(2), lane = "real" }) {
  const strict = argv.some((arg) => STRICT_FLAGS.includes(arg))
  const prereq = resolution.keyName + " (provider credential for the " + resolution.provider + " route)"
  const remedy = "export " + resolution.keyName + " in the launching shell, or add `refs: " + resolution.keyName + ": <value>` to ~/.dsh/.credentials.yaml"
  return "[mpd-qa] " + (strict ? "FAIL" : "SKIP") + " case=" + caseSlug + " lane=" + lane + " reason=" + REASON + " prereq=\"" + prereq + "\" remedy=\"" + remedy + "\""
}

/** Print the marker and return the exit code the lane must use (0 = skipped, 1 = strict failure). */
export function refuseWithoutCredential(options) {
  const line = missingCredentialMarker(options)
  console.log(line)
  return line.includes("FAIL") ? 1 : 0
}

function selfTest() {
  const failures = []
  const check = (label, ok, detail) => {
    if (!ok) failures.push(label + (detail === undefined ? "" : ": " + detail))
  }
  const tmp = join(process.env.TMPDIR ?? "/tmp", "mpd-cred-selftest-" + process.pid)
  mkdirSync(tmp, { recursive: true })
  const profile = join(tmp, "profile")
  const store = join(tmp, "store")
  mkdirSync(profile, { recursive: true })
  mkdirSync(store, { recursive: true })
  const credFile = join(store, ".credentials.yaml")
  const KEY = "DEEPSEEK_API_KEY"
  const SECRET = "sk-fixture-NOT-A-REAL-KEY-0001"

  // 1) environment wins over every lower tier
  writeFileSync(credFile, "version: 1\nrefs:\n  DEEPSEEK_API_KEY: " + JSON.stringify("from-file") + "\n")
  writeFileSync(join(profile, ".bashrc"), "export " + KEY + "=" + JSON.stringify("from-profile") + "\n")
  const tierEnv = resolveProviderCredential({ env: { [KEY]: "from-env" }, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("environment must win", tierEnv.source === "environment" && tierEnv.value === "from-env", JSON.stringify(credentialDescriptor(tierEnv)))

  // 2) the store's `refs:` mapping when the environment has nothing
  const tierFile = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [] })
  check("refs section must resolve", tierFile.source === "credentials-file" && tierFile.value === "from-file", JSON.stringify(credentialDescriptor(tierFile)))

  // 3) a records store whose api-key entry names the provider
  writeFileSync(credFile, 'version: 1\nrecords:\n  llm/deepseek-official:\n    kind: "api-key"\n    key: ' + JSON.stringify("from-record") + "\n")
  const tierRecord = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [] })
  check("records api-key must resolve for the provider", tierRecord.value === "from-record", JSON.stringify(credentialDescriptor(tierRecord)))

  // 4) the shell profile, quoted and unquoted, with the export prefix optional
  writeFileSync(credFile, "version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload: {}\n")
  writeFileSync(join(profile, ".bashrc"), "# comment\n" + KEY + "=" + SECRET + "\n")
  const tierProfile = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("shell profile must resolve an unquoted export", tierProfile.source === "shell-profile" && tierProfile.value === SECRET, JSON.stringify(credentialDescriptor(tierProfile)))
  check("the profile tier must report the line", tierProfile.line === 2, "line=" + tierProfile.line)

  // 5) an expansion is not a literal: refused, with the reason on the record
  writeFileSync(join(profile, ".bashrc"), "export " + KEY + '="$OTHER_PLACE"\n')
  const tierExpansion = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("a $-expansion must not be treated as a literal", tierExpansion.present === false, JSON.stringify(credentialDescriptor(tierExpansion)))

  // 6) nothing anywhere: absent, reason documented, and NO value anywhere in the descriptor
  const absent = resolveProviderCredential({ env: {}, home: join(tmp, "empty-home"), credentialsFile: join(tmp, "empty-home", ".credentials.yaml"), profileFiles: [".bashrc"] })
  check("nothing resolvable must be absent", absent.present === false && absent.reason === "absent-credentials")
  check("the descriptor must carry no value", !JSON.stringify(credentialDescriptor(absent)).includes("sk-"), JSON.stringify(credentialDescriptor(absent)))

  // 7) the refuse-loudly marker: SKIP by default, FAIL under the strict flags, always the reason
  const markerLoose = missingCredentialMarker({ caseSlug: "fixture-case", resolution: absent, argv: [] })
  const markerStrict = missingCredentialMarker({ caseSlug: "fixture-case", resolution: absent, argv: ["--no-skip"] })
  check("default marker is SKIP", /^\[mpd-qa\] SKIP case=fixture-case lane=real reason=absent-credentials prereq="/.test(markerLoose), markerLoose)
  check("strict marker is FAIL", /^\[mpd-qa\] FAIL case=fixture-case lane=real reason=absent-credentials prereq="/.test(markerStrict), markerStrict)
  check("the marker names the key", markerLoose.includes(KEY))
  check("the marker never carries a value", !markerLoose.includes(SECRET) && !markerStrict.includes(SECRET))

  // 8) environment delivery
  const delivered = credentialEnv({ PATH: "/usr/bin" }, { resolution: { present: true, provider: "deepseek", keyName: KEY, value: SECRET, source: "shell-profile", file: null, line: null, length: SECRET.length, reason: null, tried: [] } })
  check("credentialEnv must inject the key", delivered[KEY] === SECRET && delivered.PATH === "/usr/bin")
  const deliveredAbsent = credentialEnv({ PATH: "/usr/bin" }, { resolution: absent })
  check("credentialEnv without a credential must not invent one", deliveredAbsent[KEY] === undefined)

  // 9) store delivery: the sandbox copy carries the key under `refs:` (both document shapes)
  const sandboxA = join(tmp, "sandbox-a")
  const seededA = seedSandboxCredentials(sandboxA, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  const seededTextA = readFileSync(join(sandboxA, ".credentials.yaml"), "utf8")
  check("the sandbox store must exist", existsSync(join(sandboxA, ".credentials.yaml")))
  check("the sandbox store must keep the copied entries", seededTextA.includes("client-connection/browser-session"))
  check("the sandbox store must carry the key under refs", new RegExp("^refs:$", "m").test(seededTextA) && seededTextA.includes("  " + KEY + ": " + JSON.stringify(SECRET)), seededTextA.replace(JSON.stringify(SECRET), "<value>"))
  check("the seed descriptor keeps the value out", !JSON.stringify(credentialDescriptor(seededA)).includes(SECRET.slice(0, 10)))
  // The harness REFUSES a store readable beyond its owner (measured: mode 644 killed a whole web
  // boot), so the sandbox store must land owner-only on every seeding path.
  check("the seeded store must be owner-only (0600)", (statSync(join(sandboxA, ".credentials.yaml")).mode & 0o777) === 0o600, "mode=" + (statSync(join(sandboxA, ".credentials.yaml")).mode & 0o777).toString(8))
  const sandboxB = join(tmp, "sandbox-b")
  writeFileSync(credFile, "version: 1\nrefs:\n  OTHER_KEY: " + JSON.stringify("other") + "\n\nrecords:\n  x/y:\n    kind: grant\n    payload: {}\n")
  seedSandboxCredentials(sandboxB, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  const seededTextB = readFileSync(join(sandboxB, ".credentials.yaml"), "utf8")
  check("an existing refs section must be appended to, not duplicated", (seededTextB.match(/^refs:$/gm) ?? []).length === 1 && seededTextB.includes("  OTHER_KEY:") && seededTextB.includes("  " + KEY + ":"), seededTextB.replace(JSON.stringify(SECRET), "<value>"))
  check("the records section must survive the merge", seededTextB.includes("records:") && seededTextB.includes("kind: grant"))
  check("a merged existing store stays owner-only", (statSync(join(sandboxB, ".credentials.yaml")).mode & 0o777) === 0o600, "mode=" + (statSync(join(sandboxB, ".credentials.yaml")).mode & 0o777).toString(8))
  const sandboxC = join(tmp, "sandbox-c")
  writeFileSync(credFile, KEY + ": " + JSON.stringify(SECRET) + "\n")
  seedSandboxCredentials(sandboxC, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  check("a flat layout gets a flat entry", readFileSync(join(sandboxC, ".credentials.yaml"), "utf8").includes(KEY + ": "), "sandbox-c")

  // 10) the resolution tier that a lane reports must never print the value
  const printable = JSON.stringify(credentialDescriptor(tierProfile))
  check("descriptor leaks no value", !printable.includes(SECRET) && printable.includes(String(SECRET.length)))

  if (failures.length > 0) {
    console.error("[credentials self-test] FAIL:")
    for (const failure of failures) console.error("  - " + failure)
    process.exit(1)
  }
  console.log("[credentials self-test] ok: env > credentials-file (refs/flat/records) > shell-profile resolution, literal-only parsing, value-free descriptors, SKIP/FAIL refusal markers and both delivery routes verified on fixtures")
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("credentials.mjs")
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest()
  else console.log("[credentials] resolution helper: " + credentialDescriptor(resolveProviderCredential()).present + " resolvable provider credential; use --self-test")
}
