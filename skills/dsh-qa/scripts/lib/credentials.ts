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
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

/** A child-process environment: the `process.env` shape, where any key may be absent. */
export type Env = Record<string, string | undefined>

/** One resolution tier's outcome, recorded so a refusal can name every place that was tried. */
export interface CredentialTierAttempt {
  /** Which tier was tried: `environment`, `credentials-file` or `shell-profile`. */
  readonly tier: string
  /** Where it looked (a key name, a file path, or `file:line`), never a secret value. */
  readonly detail: string
  /** What happened: `hit`, `absent`, `unreadable`, `unset`, or a longer explanation. */
  readonly outcome: string
}

/** A credential resolution that FOUND a secret; `value` is the only member that carries one. */
export interface CredentialHit {
  /** Always `true`, which is what makes the union below discriminated and narrowable. */
  readonly present: true
  /** The provider id the key belongs to. */
  readonly provider: string
  /** The environment-variable name the provider's key uses. */
  readonly keyName: string
  /** The secret itself. Never printed or persisted; only `length` may be. */
  readonly value: string
  /** Which tier produced the secret. */
  readonly source: string
  /** The file a hit came from, or `null` for the environment tier. */
  readonly file: string | null
  /** The 1-based line of the hit inside `file`, or `null` when not applicable. */
  readonly line: number | null
  /** The secret's LENGTH only — safe to print and to persist as evidence. */
  readonly length: number
  /** Always `null` on a hit; the reason exists only on a miss. */
  readonly reason: null
  /** Every tier that was tried, in resolution order. */
  readonly tried: CredentialTierAttempt[]
}

/** A credential resolution that found NOTHING; it carries no secret material at all. */
export interface CredentialMiss {
  /** Always `false`, which is what makes the union below discriminated and narrowable. */
  readonly present: false
  /** The provider id whose key was wanted. */
  readonly provider: string
  /** The environment-variable name that was looked for. */
  readonly keyName: string
  /** Always `null`: a miss resolved no secret. */
  readonly value: null
  /** Always `null`: a miss has no producing tier. */
  readonly source: null
  /** Always `null`: a miss read no file. */
  readonly file: null
  /** Always `null`: a miss has no hit line. */
  readonly line: null
  /** Always `0`: a miss resolved nothing to measure. */
  readonly length: number
  /** The machine-readable refusal reason (`absent-credentials`). */
  readonly reason: string
  /** Every tier that was tried, in resolution order. */
  readonly tried: CredentialTierAttempt[]
}

/**
 * The full outcome of a credential resolution, discriminated on `present` so a caller that has
 * guarded on it narrows `value` to a `string` without a cast.
 */
export type CredentialResolution = CredentialHit | CredentialMiss

/** The evidence-safe projection of a resolution: presence, source, location and length only. */
export interface CredentialDescriptor {
  /** The provider id the key belongs to. */
  readonly provider: string
  /** The environment-variable name the provider's key uses. */
  readonly keyName: string
  /** Whether a usable secret was found. */
  readonly present: boolean
  /** Which tier produced the secret, or `null`. */
  readonly source: string | null
  /** The file a hit came from, or `null`. */
  readonly file: string | null
  /** The 1-based line of the hit inside `file`, or `null`. */
  readonly line: number | null
  /** The secret's LENGTH only. */
  readonly length: number
  /** The machine-readable refusal reason, or `null` on a hit. */
  readonly reason: string | null
  /** Every tier that was tried, in resolution order. */
  readonly tried: CredentialTierAttempt[]
}

/**
 * Anything `credentialDescriptor` can project: a full resolution, or a value that already carries
 * the descriptor's fields (the seeding outcome, which projects a second time for its own report).
 */
export type CredentialDescriptorSource = CredentialDescriptor | CredentialResolution

/** Optional inputs shared by the resolver, the two delivery routes and the refusal marker. */
export interface CredentialOptions {
  /** Provider id whose key is wanted; defaults to `deepseek`. */
  readonly provider?: string
  /** Environment consulted for tier 1. */
  readonly env?: Env
  /** Home directory consulted for tier 3 and for the default store path. */
  readonly home?: string
  /** `DSH_HOME` whose `.credentials.yaml` is tier 2. */
  readonly dshHome?: string
  /** Explicit credentials-file path, overriding the `DSH_HOME`-derived one. */
  readonly credentialsFile?: string
  /** Profile file names probed by tier 3, in order. */
  readonly profileFiles?: readonly string[]
  /** Skip tier 2 entirely (used by fixtures that must not read a store). */
  readonly skipFile?: boolean
  /** Skip tier 3 entirely (used by fixtures that must not read a shell profile). */
  readonly skipProfile?: boolean
  /** A pre-computed resolution, so a caller resolves once and delivers twice. */
  readonly resolution?: CredentialResolution
  /** Explicit settings file copied by `seedSandboxCredentials`, overriding `~/.dsh/settings.yaml`. */
  readonly settingsFile?: string
}

/** What a sandbox credential seeding actually wrote, so a lane can record it as evidence. */
export interface SandboxSeedingOutcome extends CredentialDescriptor {
  /** Which of the three seeding actions landed. */
  readonly wrote: {
    /** Whether the declared store was copied into the sandbox. */
    readonly storeCopied: boolean
    /** Whether the sandbox received a `settings.yaml` beside the store. */
    readonly settingsCopied: boolean
    /** Whether the resolved key was merged into the sandbox's own `refs:` mapping. */
    readonly refsMerged: boolean
  }
}

/** The provider id to environment-variable name map, for the three providers the lanes use. */
export const PROVIDER_KEY_NAME: Readonly<Record<string, string>> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
}

/** The shell profile files tier 3 probes, in the order the harness's own docs list them. */
const PROFILE_FILES: readonly string[] = [".bashrc", ".profile", ".bash_profile", ".zshrc"]
/** The argv flags that turn a missing credential from a SKIP into a hard FAIL. */
const STRICT_FLAGS: readonly string[] = ["--no-skip", "--require-pack"]
/** The machine-readable refusal reason a miss reports. */
const REASON: string = "absent-credentials"

/**
 * The environment-variable name for a provider id: the declared map entry, or the provider id
 * upper-cased with every non-alphanumeric run collapsed to one underscore.
 * @param provider The provider id.
 * @returns The environment-variable name its key is expected under.
 */
function keyNameFor(provider: string): string {
  return PROVIDER_KEY_NAME[provider] ?? provider.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
}

/**
 * Strip one layer of shell quotes; `undefined` when the value needs expansion we cannot evaluate.
 * @param raw The raw right-hand side of a `KEY=...` assignment.
 * @returns The literal value, or `undefined` when it is empty or needs shell expansion.
 */
function shellScalar(raw: string): string | undefined {
  // The assignment's value with surrounding whitespace removed.
  const trimmed = raw.trim()
  if (trimmed === "") return undefined
  // One layer of matching single or double quotes removed, when present.
  const unquoted = /^"(.*)"$/.test(trimmed) ? trimmed.slice(1, -1) : /^'(.*)'$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed
  if (unquoted === "" || unquoted.includes("$") || unquoted.includes("`")) return undefined
  return unquoted
}

/**
 * Tier 3: the exported keys of the shell profile, read as text (never sourced, never executed).
 * @param keyName The environment-variable name to look for.
 * @param home The home directory holding the profile files.
 * @param tried The tier-attempt log to append to.
 * @param profileFiles The profile file names to probe, in order.
 * @returns The literal value and its location, or `undefined` when no profile carries one.
 */
function fromShellProfile(keyName: string, home: string, tried: CredentialTierAttempt[], profileFiles: readonly string[]): { value: string; source: string; file: string; line: number } | undefined {
  for (const name of profileFiles) {
    // The candidate profile file inside the given home.
    const file = join(home, name)
    if (!existsSync(file)) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "absent" })
      continue
    }
    // The profile's bytes, read as text so it can never execute.
    let text: string
    try {
      text = readFileSync(file, "utf8")
    } catch {
      tried.push({ tier: "shell-profile", detail: file, outcome: "unreadable" })
      continue
    }
    // The assignment line for this key, with the `export` prefix optional.
    const pattern = new RegExp("^[ \\t]*(?:export[ \\t]+)?" + keyName + "[ \\t]*=[ \\t]*(.+)$", "m")
    // The first assignment match, if the profile declares one at all.
    const match = pattern.exec(text)
    if (!match) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "no " + keyName + " export" })
      continue
    }
    // The assignment's value, or `undefined` when it is not a literal.
    const value = shellScalar(match[1])
    if (value === undefined) {
      tried.push({ tier: "shell-profile", detail: file, outcome: "found but not a literal value (quotes/expansion)" })
      continue
    }
    // The 1-based line the assignment sits on, derived from the match offset.
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
 * @param keyName The environment-variable name to look for.
 * @param provider The provider id, matched against a record's id line.
 * @param file The credentials-file path, or a falsy value when none was declared.
 * @param tried The tier-attempt log to append to.
 * @returns The literal value and its location, or `undefined` when the document carries none.
 */
function fromCredentialsFile(keyName: string, provider: string, file: string | undefined, tried: CredentialTierAttempt[]): { value: string; source: string; file: string; line: number | null } | undefined {
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    tried.push({ tier: "credentials-file", detail: file ?? "(none)", outcome: "absent" })
    return undefined
  }
  // The document's bytes, read as text.
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    tried.push({ tier: "credentials-file", detail: file, outcome: "unreadable" })
    return undefined
  }
  /** One scalar read through the shell-quoting rules, shared by every document shape. */
  const bare = (raw: string): string | undefined => shellScalar(raw)
  // The FLAT layout: a top-level `KEY: value` pair with no `refs:` wrapper.
  const flat = new RegExp("^[ \\t]{0,2}" + keyName + ":[ \\t]*(.+)$", "m").exec(text)
  if (flat) {
    // The flat assignment's value, or `undefined` when it is not a literal.
    const value = bare(flat[1])
    if (value !== undefined) {
      // The 1-based line the flat pair sits on.
      const line = text.slice(0, flat.index).split(/\r?\n/).length
      tried.push({ tier: "credentials-file", detail: file + ":" + line + " (flat layout)", outcome: "hit" })
      return { value, source: "credentials-file", file, line }
    }
  }
  // The bare `refs:` line that opens the block mapping the harness reads.
  const refsSection = /^refs:[ \t]*$/m.exec(text)
  if (refsSection) {
    // Everything after the `refs:` line, where the mapping's entries live.
    const after = text.slice(refsSection.index + refsSection[0].length)
    // The key's entry line inside that mapping, if present.
    const refLine = new RegExp("^[ \\t]+" + keyName + ":[ \\t]*(.+)$", "m").exec(after)
    if (refLine) {
      // The entry's value, or `undefined` when it is not a literal.
      const value = bare(refLine[1])
      if (value !== undefined) {
        // The 1-based line of the entry, counted from the start of the document.
        const line = text.slice(0, refsSection.index).split(/\r?\n/).length + after.slice(0, refLine.index).split(/\r?\n/).length
        tried.push({ tier: "credentials-file", detail: file + ":" + line + " (refs)", outcome: "hit" })
        return { value, source: "credentials-file", file, line }
      }
    }
  }
  // The provider id lower-cased, matched case-insensitively against record id lines.
  const providerWord = provider.toLowerCase()
  // The document split into top-level record blocks, one per two-space-indented key.
  const recordBlocks = text.split(/^ {2}(?=[A-Za-z0-9._@/-]+:[ \t]*$)/m)
  // Whether a provider-scoped `api-key` record was seen at all, so a miss can say so.
  let sawRecord = false
  for (const block of recordBlocks) {
    // Records are keyed `<scope>/<id>` (e.g. `llm/deepseek-official`), so the provider is matched
    // against the ID LINE — never against a value-bearing line.
    const idLine = block.split(/\r?\n/, 1)[0]
    if (!new RegExp("^[ \\t]*[A-Za-z0-9._@/-]*" + providerWord, "i").test(idLine)) continue
    if (!/kind:[ \t]*"?'?api-key/.test(block)) continue
    sawRecord = true
    // The record's `key:` line, which carries the secret scalar.
    const keyLine = /key:[ \t]*(.+)$/m.exec(block)
    if (!keyLine) continue
    // The record's key value, or `undefined` when it is not a literal.
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
 * @param options Resolution knobs; every one is optional and defaults to the live process.
 * @returns The resolution, whose `value` is the only secret-bearing member.
 */
export function resolveProviderCredential(options: CredentialOptions = {}): CredentialResolution {
  // The provider whose key is wanted.
  const provider = options.provider ?? "deepseek"
  // The environment tier 1 reads.
  const env = options.env ?? process.env
  // The home directory tier 3 reads.
  const home = options.home ?? homedir()
  // The environment-variable name the provider's key uses.
  const keyName = keyNameFor(provider)
  // The `DSH_HOME` whose `.credentials.yaml` is tier 2.
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(home, ".dsh")
  // The credentials document tier 2 reads.
  const credentialsFile = options.credentialsFile ?? join(dshHome, ".credentials.yaml")
  // The profile file names tier 3 probes.
  const profileFiles = options.profileFiles ?? PROFILE_FILES
  // The tier-attempt log every branch below appends to.
  const tried: CredentialTierAttempt[] = []
  if (typeof env[keyName] === "string" && env[keyName].length > 0) {
    tried.push({ tier: "environment", detail: keyName, outcome: "hit" })
    return { present: true, provider, keyName, value: env[keyName], source: "environment", file: null, line: null, length: env[keyName].length, reason: null, tried }
  }
  tried.push({ tier: "environment", detail: keyName, outcome: "unset" })
  // The tier-2 hit, or `undefined` when the document carries no usable value.
  const fromFile = options.skipFile ? undefined : fromCredentialsFile(keyName, provider, credentialsFile, tried)
  if (fromFile) {
    return { present: true, provider, keyName, value: fromFile.value, source: fromFile.source, file: fromFile.file, line: fromFile.line, length: fromFile.value.length, reason: null, tried }
  }
  // The tier-3 hit, or `undefined` when no shell profile declares a literal.
  const fromProfile = options.skipProfile ? undefined : fromShellProfile(keyName, home, tried, profileFiles)
  if (fromProfile) {
    return { present: true, provider, keyName, value: fromProfile.value, source: fromProfile.source, file: fromProfile.file, line: fromProfile.line, length: fromProfile.value.length, reason: null, tried }
  }
  return { present: false, provider, keyName, value: null, source: null, file: null, line: null, length: 0, reason: REASON, tried }
}

/**
 * The evidence-safe view: presence, source, location and LENGTH. Never the value.
 * @param resolution The resolution to project.
 * @returns The descriptor, which carries no secret material.
 */
export function credentialDescriptor(resolution: CredentialDescriptorSource): CredentialDescriptor {
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

/**
 * Tier 1 delivery: a child environment that carries the key (the harness's winning route).
 * @param baseEnv The environment to extend.
 * @param options Resolution knobs, or a pre-computed `resolution`.
 * @returns A new environment that carries the key when one resolved, else a copy of `baseEnv`.
 */
export function credentialEnv(baseEnv: Env = process.env, options: CredentialOptions = {}): Env {
  // The resolution to deliver, computed here unless the caller already has one.
  const resolution = options.resolution ?? resolveProviderCredential(options)
  if (!resolution.present) return { ...baseEnv }
  return { ...baseEnv, [resolution.keyName]: resolution.value }
}

// The harness's credential store asserts OWNER-ONLY readability and refuses the row otherwise
// (measured: `credentials-local: <file> is readable beyond its owner (mode 644); run "chmod 600 …"`,
// which broke the whole web boot). Every write below therefore lands at 0600.
/** The owner-only file mode every sandbox credential write lands at. */
const STORE_MODE: number = 0o600

/**
 * Tier 2 delivery: copy the declared store and settings into the sandbox, and make sure the
 * sandbox's OWN store carries the key in the `refs:` mapping the harness reads — so a boot that
 * does not inherit the lane's environment still resolves it. Returns a value-free descriptor.
 * @param sandboxDir The sandbox directory to seed (normally the sandbox `DSH_HOME`).
 * @param options Resolution knobs, source overrides and an optional pre-computed resolution.
 * @returns The value-free descriptor plus which seeding actions landed.
 */
export function seedSandboxCredentials(sandboxDir: string, options: CredentialOptions = {}): SandboxSeedingOutcome {
  // The home directory the default store path derives from.
  const home = options.home ?? homedir()
  // The environment the default `DSH_HOME` derives from.
  const env = options.env ?? process.env
  // The `DSH_HOME` the default credentials document lives in.
  const dshHome = options.dshHome ?? env.DSH_HOME ?? join(home, ".dsh")
  // The declared credentials document to copy.
  const source = options.credentialsFile ?? join(dshHome, ".credentials.yaml")
  // The declared settings document to copy beside it (the live-LLM prerequisite, AGENTS.md §7).
  const settings = options.settingsFile ?? join(home, ".dsh", "settings.yaml")
  // The resolution whose key is merged into the sandbox's own store.
  const resolution = options.resolution ?? resolveProviderCredential({ ...options, home, env })
  mkdirSync(sandboxDir, { recursive: true })
  // The sandbox's own credentials document, the harness actually reads.
  const target = join(sandboxDir, ".credentials.yaml")
  // Which seeding actions actually landed, so a lane can record it.
  const wrote = { storeCopied: false, settingsCopied: false, refsMerged: false }
  if (existsSync(source)) {
    // The declared document's bytes, or `""` when it cannot be read.
    let text: string
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
    // The sandbox document as it stands before the refs entry is merged in.
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
 * @param text The existing document bytes (may be empty).
 * @param keyName The environment-variable name to write.
 * @param value The secret value to write, JSON-quoted so any character survives the YAML scalar.
 * @returns The rewritten document.
 * @throws When the document's `refs:` form cannot be edited safely.
 */
export function mergeRefsEntry(text: string, keyName: string, value: string): string {
  // The JSON-quoted scalar, which is a valid YAML double-quoted scalar for every value.
  const quoted = JSON.stringify(value)
  // The two-space-indented block entry appended under a `refs:` line.
  const entry = "  " + keyName + ": " + quoted
  if (text.trim() === "") return "version: 1\nrefs:\n" + entry + "\n"
  // The document's first top-level `refs:` line, whatever shape follows it.
  const refsLine = /^refs:[ \t]*(.*)$/m.exec(text)
  // Whether the document declares `version:`, which rules out the FLAT layout.
  const hasVersion = /^version:[ \t]*\S/m.test(text)
  if (refsLine) {
    // Whatever follows `refs:` on that line, with surrounding whitespace removed.
    const tail = refsLine[1].trim()
    if (tail === "") {
      // Everything up to and including the `refs:` line.
      const before = text.slice(0, refsLine.index + refsLine[0].length)
      // Everything after the `refs:` line, where the block mapping's entries live.
      const after = text.slice(refsLine.index + refsLine[0].length)
      // The document's following lines, so the entry can be spliced after the last mapping line.
      const lines = after.split(/\r?\n/)
      // Index of the last indented content line, or -1 when the mapping is empty.
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
      // The rebuilt inline mapping, carrying the old entries plus the new one.
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

/** The inputs of the SKIP/FAIL refusal marker. */
export interface MissingCredentialMarkerOptions {
  /** The case slug the marker names, so a sweep's log says which case skipped. */
  readonly caseSlug: string
  /** The miss the marker explains; only its key name and provider are read. */
  readonly resolution: Pick<CredentialResolution, "keyName" | "provider">
  /** The lane id the marker names. */
  readonly lane?: string
  /** The argv to test for the strict flags; defaults to the live process argv. */
  readonly argv?: readonly string[]
}

/**
 * The canonical SKIP/FAIL marker from SKILL.md, so a lane refuses loudly instead of silently.
 * @param options The case slug, the resolution and the argv that selects SKIP or FAIL.
 * @returns The single marker line to print.
 */
export function missingCredentialMarker({ caseSlug, resolution, argv = process.argv.slice(2), lane = "real" }: MissingCredentialMarkerOptions): string {
  // Whether a strict flag turns the skip into a hard failure.
  const strict = argv.some((arg) => STRICT_FLAGS.includes(arg))
  // The prerequisite sentence the marker quotes.
  const prereq = resolution.keyName + " (provider credential for the " + resolution.provider + " route)"
  // The remedy sentence the marker quotes, naming both sanctioned delivery routes.
  const remedy = "export " + resolution.keyName + " in the launching shell, or add `refs: " + resolution.keyName + ": <value>` to ~/.dsh/.credentials.yaml"
  return "[mpd-qa] " + (strict ? "FAIL" : "SKIP") + " case=" + caseSlug + " lane=" + lane + " reason=" + REASON + " prereq=\"" + prereq + "\" remedy=\"" + remedy + "\""
}

/**
 * Print the marker and return the exit code the lane must use (0 = skipped, 1 = strict failure).
 * @param options The case slug, the resolution and the argv that selects SKIP or FAIL.
 * @returns The exit code the caller passes to `process.exit`.
 */
export function refuseWithoutCredential(options: MissingCredentialMarkerOptions): number {
  // The single marker line, which carries no secret material.
  const line = missingCredentialMarker(options)
  console.log(line)
  return line.includes("FAIL") ? 1 : 0
}

/** The offline self-test: every tier, both delivery routes and the refusal marker on fixtures. */
function selfTest(): void {
  /** The assertion labels that failed, printed together so one run reports every break. */
  const failures: string[] = []
  /** Record one failed self-test assertion with its optional detail. */
  const check = (label: string, ok: boolean, detail?: string): void => {
    if (!ok) failures.push(label + (detail === undefined ? "" : ": " + detail))
  }
  // `os.tmpdir()` is the portable answer (`$TMPDIR`/`/tmp` on POSIX, `%TEMP%` on win32): the
  // hard-coded POSIX fallback resolved to `C:\tmp` on Windows, which need not exist.
  const tmp = join(process.env.TMPDIR ?? tmpdir(), "mpd-cred-selftest-" + process.pid)
  mkdirSync(tmp, { recursive: true })
  // The fake home directory tier 3 probes.
  const profile = join(tmp, "profile")
  // The fake `DSH_HOME` holding the fixture credentials document.
  const store = join(tmp, "store")
  mkdirSync(profile, { recursive: true })
  mkdirSync(store, { recursive: true })
  // The fixture credentials document every document-shape case rewrites.
  const credFile = join(store, ".credentials.yaml")
  // The environment-variable name under test.
  const KEY = "DEEPSEEK_API_KEY"
  // The fixture secret, which must never appear in a descriptor or a marker.
  const SECRET = "sk-fixture-NOT-A-REAL-KEY-0001"

  // 1) environment wins over every lower tier
  writeFileSync(credFile, "version: 1\nrefs:\n  DEEPSEEK_API_KEY: " + JSON.stringify("from-file") + "\n")
  writeFileSync(join(profile, ".bashrc"), "export " + KEY + "=" + JSON.stringify("from-profile") + "\n")
  // The tier-1 hit that must outrank the file and the profile both.
  const tierEnv = resolveProviderCredential({ env: { [KEY]: "from-env" }, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("environment must win", tierEnv.source === "environment" && tierEnv.value === "from-env", JSON.stringify(credentialDescriptor(tierEnv)))

  // 2) the store's `refs:` mapping when the environment has nothing
  // The tier-2 hit read from a `refs:` block mapping.
  const tierFile = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [] })
  check("refs section must resolve", tierFile.source === "credentials-file" && tierFile.value === "from-file", JSON.stringify(credentialDescriptor(tierFile)))

  // 3) a records store whose api-key entry names the provider
  writeFileSync(credFile, 'version: 1\nrecords:\n  llm/deepseek-official:\n    kind: "api-key"\n    key: ' + JSON.stringify("from-record") + "\n")
  // The tier-2 hit read from a provider-scoped `records:` api-key entry.
  const tierRecord = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [] })
  check("records api-key must resolve for the provider", tierRecord.value === "from-record", JSON.stringify(credentialDescriptor(tierRecord)))

  // 4) the shell profile, quoted and unquoted, with the export prefix optional
  writeFileSync(credFile, "version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload: {}\n")
  writeFileSync(join(profile, ".bashrc"), "# comment\n" + KEY + "=" + SECRET + "\n")
  // The tier-3 hit read from an unquoted shell-profile assignment.
  const tierProfile = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("shell profile must resolve an unquoted export", tierProfile.source === "shell-profile" && tierProfile.value === SECRET, JSON.stringify(credentialDescriptor(tierProfile)))
  check("the profile tier must report the line", tierProfile.line === 2, "line=" + tierProfile.line)

  // 5) an expansion is not a literal: refused, with the reason on the record
  writeFileSync(join(profile, ".bashrc"), "export " + KEY + '="$OTHER_PLACE"\n')
  // The tier-3 miss caused by a `$`-expansion, which must not be treated as a literal.
  const tierExpansion = resolveProviderCredential({ env: {}, home: profile, credentialsFile: credFile, profileFiles: [".bashrc"] })
  check("a $-expansion must not be treated as a literal", tierExpansion.present === false, JSON.stringify(credentialDescriptor(tierExpansion)))

  // 6) nothing anywhere: absent, reason documented, and NO value anywhere in the descriptor
  // The all-tiers-miss resolution, whose descriptor must stay value-free.
  const absent = resolveProviderCredential({ env: {}, home: join(tmp, "empty-home"), credentialsFile: join(tmp, "empty-home", ".credentials.yaml"), profileFiles: [".bashrc"] })
  check("nothing resolvable must be absent", absent.present === false && absent.reason === "absent-credentials")
  check("the descriptor must carry no value", !JSON.stringify(credentialDescriptor(absent)).includes("sk-"), JSON.stringify(credentialDescriptor(absent)))

  // 7) the refuse-loudly marker: SKIP by default, FAIL under the strict flags, always the reason
  // The default (non-strict) marker, which must read SKIP.
  const markerLoose = missingCredentialMarker({ caseSlug: "fixture-case", resolution: absent, argv: [] })
  // The strict marker, which must read FAIL for the same miss.
  const markerStrict = missingCredentialMarker({ caseSlug: "fixture-case", resolution: absent, argv: ["--no-skip"] })
  check("default marker is SKIP", /^\[mpd-qa\] SKIP case=fixture-case lane=real reason=absent-credentials prereq="/.test(markerLoose), markerLoose)
  check("strict marker is FAIL", /^\[mpd-qa\] FAIL case=fixture-case lane=real reason=absent-credentials prereq="/.test(markerStrict), markerStrict)
  check("the marker names the key", markerLoose.includes(KEY))
  check("the marker never carries a value", !markerLoose.includes(SECRET) && !markerStrict.includes(SECRET))

  // 8) environment delivery
  // The route-1 child environment, which must carry the key beside the inherited PATH.
  const delivered = credentialEnv({ PATH: "/usr/bin" }, { resolution: { present: true, provider: "deepseek", keyName: KEY, value: SECRET, source: "shell-profile", file: null, line: null, length: SECRET.length, reason: null, tried: [] } })
  check("credentialEnv must inject the key", delivered[KEY] === SECRET && delivered.PATH === "/usr/bin")
  // The route-1 child environment of a miss, which must invent no key.
  const deliveredAbsent = credentialEnv({ PATH: "/usr/bin" }, { resolution: absent })
  check("credentialEnv without a credential must not invent one", deliveredAbsent[KEY] === undefined)

  // 9) store delivery: the sandbox copy carries the key under `refs:` (both document shapes)
  // The sandbox seeded from a document that carries a `records:` block only.
  const sandboxA = join(tmp, "sandbox-a")
  // The seeding outcome of the first sandbox, whose descriptor must stay value-free.
  const seededA = seedSandboxCredentials(sandboxA, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  // The sandbox document as written, read back for the byte-level assertions below.
  const seededTextA = readFileSync(join(sandboxA, ".credentials.yaml"), "utf8")
  check("the sandbox store must exist", existsSync(join(sandboxA, ".credentials.yaml")))
  check("the sandbox store must keep the copied entries", seededTextA.includes("client-connection/browser-session"))
  check("the sandbox store must carry the key under refs", new RegExp("^refs:$", "m").test(seededTextA) && seededTextA.includes("  " + KEY + ": " + JSON.stringify(SECRET)), seededTextA.replace(JSON.stringify(SECRET), "<value>"))
  check("the seed descriptor keeps the value out", !JSON.stringify(credentialDescriptor(seededA)).includes(SECRET.slice(0, 10)))
  // The harness REFUSES a store readable beyond its owner (measured: mode 644 killed a whole web
  // boot), so the sandbox store must land owner-only on every seeding path.
  check("the seeded store must be owner-only (0600)", (statSync(join(sandboxA, ".credentials.yaml")).mode & 0o777) === 0o600, "mode=" + (statSync(join(sandboxA, ".credentials.yaml")).mode & 0o777).toString(8))
  // The second sandbox, seeded from a document that ALREADY carries a `refs:` block.
  const sandboxB = join(tmp, "sandbox-b")
  writeFileSync(credFile, "version: 1\nrefs:\n  OTHER_KEY: " + JSON.stringify("other") + "\n\nrecords:\n  x/y:\n    kind: grant\n    payload: {}\n")
  seedSandboxCredentials(sandboxB, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  // The second sandbox document, which must carry exactly ONE `refs:` section.
  const seededTextB = readFileSync(join(sandboxB, ".credentials.yaml"), "utf8")
  check("an existing refs section must be appended to, not duplicated", (seededTextB.match(/^refs:$/gm) ?? []).length === 1 && seededTextB.includes("  OTHER_KEY:") && seededTextB.includes("  " + KEY + ":"), seededTextB.replace(JSON.stringify(SECRET), "<value>"))
  check("the records section must survive the merge", seededTextB.includes("records:") && seededTextB.includes("kind: grant"))
  check("a merged existing store stays owner-only", (statSync(join(sandboxB, ".credentials.yaml")).mode & 0o777) === 0o600, "mode=" + (statSync(join(sandboxB, ".credentials.yaml")).mode & 0o777).toString(8))
  // The third sandbox, seeded from a recognized FLAT-layout document.
  const sandboxC = join(tmp, "sandbox-c")
  writeFileSync(credFile, KEY + ": " + JSON.stringify(SECRET) + "\n")
  seedSandboxCredentials(sandboxC, { env: {}, home: join(tmp, "empty-home"), credentialsFile: credFile, settingsFile: join(tmp, "no-settings.yaml"), resolution: { ...absent, present: true, source: "shell-profile", value: SECRET, length: SECRET.length, reason: null } })
  check("a flat layout gets a flat entry", readFileSync(join(sandboxC, ".credentials.yaml"), "utf8").includes(KEY + ": "), "sandbox-c")

  // 10) the resolution tier that a lane reports must never print the value
  // The serialized descriptor of the profile hit, which must carry only its length.
  const printable = JSON.stringify(credentialDescriptor(tierProfile))
  check("descriptor leaks no value", !printable.includes(SECRET) && printable.includes(String(SECRET.length)))

  if (failures.length > 0) {
    console.error("[credentials self-test] FAIL:")
    for (const failure of failures) console.error("  - " + failure)
    process.exit(1)
  }
  console.log("[credentials self-test] ok: env > credentials-file (refs/flat/records) > shell-profile resolution, literal-only parsing, value-free descriptors, SKIP/FAIL refusal markers and both delivery routes verified on fixtures")
}

// The `.ts` name is what this module is called on disk after the wave's conversion, so the
// entry-module guard tests for it rather than for the retired `.mjs` spelling.
/** Whether this module is the process entry point (`--self-test` runs only then). */
const invokedDirectly = process.argv[1] !== undefined && process.argv[1].endsWith("credentials.ts")
if (invokedDirectly) {
  if (process.argv.includes("--self-test")) selfTest()
  else console.log("[credentials] resolution helper: " + credentialDescriptor(resolveProviderCredential()).present + " resolvable provider credential; use --self-test")
}
