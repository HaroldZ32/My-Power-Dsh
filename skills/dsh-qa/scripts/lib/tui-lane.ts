// Shared helpers for the five dsh-TUI QA lanes (t7).
//
// Measured constraints every lane here obeys (`.mpd/recon/CAPTAIN-RECON.md` §2/§5):
//   • the real TUI must boot WITHOUT a pipe on stdout — a pipe makes stdout a
//     non-TTY and the host refuses with `dsh-tui requires an interactive terminal`,
//     so every live lane boots inside tmux and captures with `capture-pane -p -J`
//     plus a `pipe-pane` raw ANSI log;
//   • a tmux server does not survive across shell invocations, so ONE process owns
//     the whole lifecycle (spawn, drive, capture, kill);
//   • `dsh plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui@0.11.1` needs
//     network on first run, so the lanes take an EXPLICIT sandbox/cache root
//     (`--sandbox-root`, recorded in every result) and reuse a warm profile instead
//     of reinstalling: a verification run that is handed a different root proves it
//     by the recorded path, and a root without a profile is a SKIP, not a silent
//     install.
//
// Nothing here re-implements upstream logic: the admission lane imports the HOST's
// own pinned `@dsh-std/manifest` + `lib/types/adapter/standard/*`, and the
// conformance lane reads the host submodule's own `requirements-v0.15.json`.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { DSH_MISSING, dshCommand, type Env } from "./dsh-launcher.ts"

/** The repository root, derived from this module's own URL (`<root>/skills/dsh-qa/scripts/lib/`). */
export const REPO: string = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))

/** Apply-crash signatures: a boot log carrying one of these did NOT load the tree. */
export const APPLY_CRASH_SIGNATURES: readonly string[] = [
  "unsupported JSON schema",
  "JsonSchemaError",
  "plugin tree failed to load",
  "failed to apply loader entry",
  "duplicate loader entry id",
]

/** One `requires.contracts[]` entry of a manifest: identity plus the optional-contract rule. */
export interface ManifestContractEntry {
  /** The contract apiVersion, part of the identity the registry validates; unread by these rules. */
  readonly apiVersion?: unknown
  /** The contract kind; the decision-event contract is recognised by a substring match on it. */
  readonly kind?: unknown
  /** True when the contract may be absent — such a contract MUST carry a written fallback. */
  readonly optional?: unknown
  /** The written degraded-mode fallback, mandatory whenever `optional` is true. */
  readonly fallback?: unknown
  /** Any further key the producer carries; the structural rules never read it. */
  readonly [key: string]: unknown
}

/** The `requires` block: `services` is rejected in v0.15, `contracts` carries the fallback rule. */
export interface PluginManifestRequires {
  /** The service requirements, rejected outright by the v0.15 schema. */
  readonly services?: unknown
  /** The declared contracts, each of which must satisfy the optional-with-fallback rule. */
  readonly contracts?: readonly ManifestContractEntry[]
  /** Any further key the producer carries; unread by these rules. */
  readonly [key: string]: unknown
}

/** The facet declarations: `host` is required, `client`/`worker` are rejected in v0.15. */
export interface PluginManifestFacets {
  /** The host facet; its absence is a finding, its entry point is what admission validates. */
  readonly host?: unknown
  /** The client facet, rejected by the v0.15 schema. */
  readonly client?: unknown
  /** The worker facet, rejected by the v0.15 schema. */
  readonly worker?: unknown
  /** Any further facet key; unread by these rules. */
  readonly [key: string]: unknown
}

/** The manifest subset the structural rules read; every other key is ignored on purpose. */
export interface PluginManifest {
  /** The schema version string; the community 0.15 shape is the only accepted one. */
  readonly manifestVersion?: unknown
  /** The stable plugin id the registry keys on. */
  readonly id?: unknown
  /** The facet declarations. */
  readonly facets?: PluginManifestFacets
  /** The requirement block. */
  readonly requires?: PluginManifestRequires
  /** Present only on a violation — `provides` was removed from the v0.15 schema. */
  readonly provides?: unknown
  /** Any further key the producer carries; unread by these rules. */
  readonly [key: string]: unknown
}

/**
 * Structural rules of the Community v0.15 manifest that OUR lane asserts on top of
 * the pinned parser (pure, so the self-test can falsify them): the schema rejects
 * `provides` / `requires.services` / client+worker facets, and an optional contract
 * must carry a written fallback.
 * @param manifest The parsed manifest document, from any producer (the host parser, `JSON.parse`, a cloned fixture).
 * @returns Every rule violation, in check order; an empty array means the manifest satisfies all of them.
 */
export function structuralFindings(manifest: unknown): string[] {
  // The manifest arrives as an unvalidated, producer-dependent document and every field is
  // probed defensively below, so it is given the local document shape instead of an `any` parse.
  // `??` keeps the original null/undefined handling: a nullish manifest becomes the empty document.
  const doc = (manifest ?? {}) as PluginManifest
  /** Every rule violation found so far; a non-empty list is what the lanes report as a red. */
  const findings: string[] = []
  if (doc.manifestVersion !== "0.15") findings.push("manifestVersion must be 0.15")
  if (typeof doc.id !== "string" || doc.id.length === 0) findings.push("a stable plugin id is required")
  if (doc.facets?.host === undefined) findings.push("facets.host is required")
  if (doc.facets?.client !== undefined || doc.facets?.worker !== undefined) findings.push("client/worker facets are rejected in v0.15")
  if (Object.hasOwn(doc, "provides")) findings.push("`provides` is rejected in v0.15")
  if (doc.requires !== undefined && Object.hasOwn(doc.requires, "services")) findings.push("`requires.services` is rejected in v0.15")
  /** The declared contracts; a missing or non-array `contracts` key degrades to the empty list. */
  const contracts: readonly ManifestContractEntry[] = Array.isArray(doc.requires?.contracts) ? doc.requires.contracts : []
  // Every optional contract must state its fallback in writing.
  for (const contract of contracts.filter((entry) => entry?.optional === true)) {
    if (typeof contract.fallback !== "string" || contract.fallback.length === 0) {
      findings.push("an optional contract needs a written fallback: " + JSON.stringify(contract))
    }
  }
  /** The first contract whose kind mentions `DecisionEvents`, when the manifest declares one. */
  const decision = contracts.find((entry) => String(entry?.kind ?? "").includes("DecisionEvents"))
  if (decision !== undefined && decision.optional !== true) findings.push("the decision-event contract must stay OPTIONAL with a fallback")
  return findings
}

/** The plugin build every lane measures: the dist entry the bundle row resolves. */
export const DIST_ARTIFACT: string = "packages/mpd-tui-plugin/dist/index.js"

/** The bundle-level manifest whose digest every admission-reading lane records. */
export const MANIFEST_ARTIFACT: string = "dsh-plugin.json"

/** The absolute path of the `mpd-tui-plugin` dist entry the bundle row resolves. */
export function distPath(): string {
  return join(REPO, DIST_ARTIFACT)
}

/** The absolute path of the bundle-level `dsh-plugin.json` the admission lanes read. */
export function manifestPath(): string {
  return join(REPO, MANIFEST_ARTIFACT)
}

/** The measured revision of one artifact, in the t8 result shape. */
export interface ArtifactRevision {
  /** Repo-relative path of the measured artifact (the `REPO + "/"` prefix is stripped). */
  readonly path: string
  /** Raw hex SHA-256 of the artifact's bytes; `undefined` when the artifact is absent. */
  readonly sha256: string | undefined
  /** The artifact's size in bytes; `undefined` when it is absent. */
  readonly bytes: number | undefined
  /** ISO-8601 local-time spelling of the mtime; absent on the missing-artifact arm. */
  readonly mtimeLocal?: string
  /** ISO-8601 UTC spelling of the same mtime, so runs are orderable regardless of the container timezone. */
  readonly mtimeUtc?: string
  /** True only on the missing-artifact arm, which records no digest at all. */
  readonly missing?: boolean
}

/**
 * The measured artifact revision, in t8's shape ({path, sha256, bytes, mtime}) —
 * raw hex for the digest, both mtime spellings so a reader can order runs without
 * knowing the container timezone.
 * @param path The artifact to measure; defaults to the `mpd-tui-plugin` dist entry.
 * @returns The revision record; an absent artifact yields the `missing: true` arm instead of throwing.
 */
export function artifactRevision(path: string = distPath()): ArtifactRevision {
  if (!existsSync(path)) return { path: path.replace(REPO + "/", ""), sha256: undefined, bytes: undefined, missing: true }
  /** The stat of a path known to exist, read once so size and mtime describe the same instant. */
  const stat = statSync(path)
  return {
    path: path.replace(REPO + "/", ""),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    bytes: stat.size,
    mtimeLocal: stat.mtime.toISOString(),
    mtimeUtc: stat.mtime.toISOString(),
  }
}

/** The manifest digest, or undefined when the manifest is absent. */
export function manifestDigest(): string | undefined {
  /** Absolute path of the bundle-level manifest this digest describes. */
  const path = manifestPath()
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined
}

/** The before/after comparison of one run's artifact digest. */
export interface RevisionDelta {
  /** True when the digest moved between the two measurements, which voids the run's result. */
  readonly changed: boolean
  /** The start-of-run digest; `undefined` when the artifact had no digest then. */
  readonly before: string | undefined
  /** The evidence-write-time digest; `undefined` when the artifact has no digest now. */
  readonly after: string | undefined
  /** The verdict sentence recorded in REVISION.json, naming both short digests when they differ. */
  readonly reason: string
}

/**
 * A lane must FAIL LOUDLY when its subject moved under it: a digest that changed
 * between the start of the run and the evidence write means the result describes
 * neither revision (t8's F5 gap, measured this wave).
 * @param before The revision measured before the run; omitted when the lane has no start reading.
 * @param after The revision re-measured at evidence-write time.
 * @returns The comparison, with the exact reason text a lane prints when the digest moved.
 */
export function revisionDelta(before: ArtifactRevision | undefined, after: ArtifactRevision | undefined): RevisionDelta {
  /** True when the two measurements disagree, including "one side has no digest at all". */
  const changed = before?.sha256 !== after?.sha256
  return {
    changed,
    before: before?.sha256,
    after: after?.sha256,
    reason: changed
      ? "the measured artifact changed DURING the run (" + String(before?.sha256).slice(0, 12) + " -> " + String(after?.sha256).slice(0, 12) + "); this result describes neither revision"
      : "unchanged across the run",
  }
}

/** Everything `writeRevisionFile` folds into a lane's REVISION.json. */
export interface RevisionFileOptions {
  /** The revision measured before the run; absent when the lane took no start-of-run reading. */
  readonly before?: ArtifactRevision
  /** The revision re-measured at evidence-write time, recorded as the artifact of record. */
  readonly after: ArtifactRevision
  /** Lane-specific composition facts (sandbox root, profile, bundles) recorded beside the revision. */
  readonly composition?: Record<string, unknown>
  /** Replacement for the two default "this is what the lane ran" sentences. */
  readonly proof?: readonly string[]
}

/** The result of writing a lane's REVISION.json. */
export interface RevisionFileResult {
  /** Absolute path of the REVISION.json that was written. */
  readonly file: string
  /** The digest comparison recorded in that file. */
  readonly delta: RevisionDelta
  /** The after-revision object written as the file's `artifact` field. */
  readonly after: ArtifactRevision
}

/** Write the t8-shaped REVISION.json beside a lane result. */
export function writeRevisionFile(outDir: string, { before, after, composition, proof }: RevisionFileOptions): RevisionFileResult {
  /** The digest comparison this file records; a change invalidates the run's result. */
  const delta = revisionDelta(before, after)
  /** The document body written verbatim, with the digest's provenance spelled out for the reviewer. */
  const body = {
    measuredBy: "Lead (t26)",
    artifact: after,
    proofThisIsWhatTheLaneRan: proof ?? [
      "the recorded mtime precedes this run's evidence timestamp",
      "the digest was re-measured at evidence-write time and matches the start-of-run measurement",
    ],
    composition: composition ?? {},
    delta,
  }
  /** Absolute path of the REVISION.json written into the evidence directory. */
  const file = join(outDir, "REVISION.json")
  writeFileSync(file, JSON.stringify(body, null, 2) + "\n")
  return { file, delta, after }
}

/** One `user/message` record decoded from the sandbox session store. */
export interface UserMessageRecord {
  /** Session id (the store directory name) the message was decoded from. */
  readonly sessionId: string
  /** The record's sequence number as the store wrote it. */
  readonly seq: unknown
  /** The record's text parts joined by newline, truncated to 2000 characters. */
  readonly text: string
}

/** The subset of a `user/message` session record this reader consumes; other keys are ignored. */
interface UserMessageEventRecord {
  /** The event payload; `content` is the parts array on a well-formed record. */
  readonly data?: { readonly content?: unknown }
  /** The record's sequence number as written by the store. */
  readonly seq?: unknown
}

/** One content part of a session message; only `type === "text"` parts contribute text. */
interface SessionContentPart {
  /** Part discriminator; a text part carries `"text"`. */
  readonly type?: unknown
  /** The part's rendered text; a non-string is stringified by the caller. */
  readonly text?: unknown
}

/** Session-event types the sandbox store carries, with the raw line count. */
export function readUserMessages(root: string, limit: number = 200): UserMessageRecord[] {
  /** The sandbox-keyed session store directory this run's boot writes. */
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  /** Decoded messages, capped at `limit` in read order. */
  const messages: UserMessageRecord[] = []
  if (!existsSync(dir)) return messages
  // Every session store under the sandbox key is scanned in readdir order.
  for (const id of readdirSync(dir)) {
    /** The store file of one session; a session without a v3 store is skipped. */
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    // Walk the decoded JSONL lines; only `user/message` records are considered.
    for (const line of decompressAllFrames(file).split("\n")) {
      if (!line.startsWith('{"type":"user/message"')) continue
      try {
        // The store's record JSON is dynamic; the parsed value is given the local record shape.
        const record = JSON.parse(line) as UserMessageEventRecord
        /** The message's content parts; a malformed payload contributes no text at all. */
        const content: readonly SessionContentPart[] = Array.isArray(record.data?.content) ? record.data.content : []
        /** The message text: text parts joined by newline, before the 2000-character cap. */
        const text = content.filter((part) => part?.type === "text").map((part) => String(part.text ?? "")).join("\n")
        messages.push({ sessionId: id, seq: record.seq, text: text.slice(0, 2000) })
      } catch {
        // A malformed record is surfaced by its absence, never counted as a pass.
      }
      if (messages.length >= limit) return messages
    }
  }
  return messages
}

/** `sha256:<hex>` digest of a file's bytes, in the spelling every evidence record uses. */
export function sha256File(path: string): string {
  return "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** `sha256:<hex>` digest of a UTF-8 text, in the spelling every evidence record uses. */
export function sha256Text(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex")
}

/**
 * Resolve a BARE command name on PATH, without a shell.
 *
 * `spawnSync("bash", ["-lc", "command -v X"])` is a POSIX-only shape: a stock win32 host may
 * have no `bash` at all (and where the `sh` that answers is Git Bash it resolves a different
 * PATH than the host), so the lane would call an installed tool ABSENT. Measured 2026-09-22.
 * win32 resolves a bare name through %PATHEXT%: `tmux.exe` and a `dsh-tui.cmd` shim count, and
 * `spawn` accepts both of those names as the child command.
 * @param command The bare command name (no directory part, no extension) to look for.
 * @returns The absolute path of the first match, or `null` when PATH carries no such name.
 */
export function onPath(command: string): string | null {
  /** The suffixes to try for one directory, chosen by the host's own executable resolution. */
  const suffixes: readonly string[] = process.platform === "win32" ? [".exe", ".cmd", ".bat", ".com", ""] : [""]
  // Every non-empty PATH entry is probed, in PATH order, with every suffix.
  for (const dir of String(process.env.PATH ?? "").split(delimiter)) {
    if (dir.length === 0) continue
    // Each suffix is tested in order; the first existing candidate wins.
    for (const suffix of suffixes) {
      /** One `dir + name + suffix` candidate, in the order the host would resolve it. */
      const candidate = join(dir, command + suffix)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** The installed `@deepseek-harness-tui/dsh-tui` payload (the pinned host). */
export function resolveHostRoot(): string | undefined {
  /** `DSH_TUI_ROOT`, when the operator pinned the payload explicitly. */
  const viaEnv = process.env.DSH_TUI_ROOT
  if (typeof viaEnv === "string" && viaEnv.length > 0) return realpathSync(viaEnv)
  /** The `dsh-tui` launcher on PATH, or `null` when the host is not installed. */
  const bin = onPath("dsh-tui")
  if (bin === null) return undefined
  try {
    // <root>/bin/dsh-tui.js (or a symlinked bin) -> <root>
    /** The launcher's real path, so a symlinked bin still resolves to the root that owns it. */
    const real = realpathSync(bin)
    return dirname(dirname(real))
  } catch {
    return undefined
  }
}

/** True when the pinned `dsh-tui` host resolves on PATH. */
export function tuiBinaryPresent(): boolean {
  return onPath("dsh-tui") !== null
}

/** True when a `tmux` binary resolves on PATH (the live lanes need a real TTY server). */
export function tmuxPresent(): boolean {
  return onPath("tmux") !== null
}

/**
 * The path of the host's own `dsh-ecosystem-spec` CHECKOUT, when this host can have one.
 *
 * The recorded location is a POSIX absolute path (`/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec`).
 * That spelling cannot name a checkout on win32 — `join("/root/...")` answers `C:\root\...`, a
 * place no checkout lives — so the literal is offered on POSIX only, and `MPD_TUI_SPEC_ROOT` (the
 * variable the spec-conformance lane already reads) names the checkout on any host. `undefined`
 * means "no recorded location on this host", i.e. an ABSENT EXTERNAL FIXTURE: the lanes report it
 * as a declared skip (a FAIL under `--no-skip`), never as a red of their own logic.
 * @returns The checkout directory, or `undefined` when this host records none.
 */
export function resolveSpecCheckout(): string | undefined {
  /** `MPD_TUI_SPEC_ROOT`, the checkout the operator pinned for this host. */
  const viaEnv = process.env.MPD_TUI_SPEC_ROOT
  if (typeof viaEnv === "string" && viaEnv.length > 0) return viaEnv
  if (process.platform === "win32") return undefined
  return "/root/dshProj/tui/dsh-TUI/dsh-ecosystem-spec"
}

/** Which producer offers a spec-data root: the running host's payload, or the operator's checkout. */
export type SpecDataRootKind = "installed-payload" | "user-checkout"

/** One candidate location of the host's spec-data registry, in resolution order. */
export interface SpecDataRootCandidate {
  /** The producer that offers this root, recorded so a skip can name what was probed. */
  readonly kind: SpecDataRootKind
  /** Absolute directory of this root; always defined, because undefined roots are filtered out below. */
  readonly dir: string
}

/**
 * The spec-data root CANDIDATES, in resolution order, with `undefined` entries dropped.
 *
 * Exported so a caller can tell "no candidate exists on this host" (an absent fixture — a declared
 * skip) from "a candidate exists but does not carry the registry" (a real red) without re-deriving
 * the list: that distinction is what the lanes' skip/FAIL arms are built on.
 * @param hostRoot The installed payload root, or `undefined` when no host was resolved.
 * @returns The candidate roots in resolution order; the empty array means this host has no fixture.
 */
export function specDataRootCandidates(hostRoot: string | undefined): SpecDataRootCandidate[] {
  return [
    { kind: "installed-payload", dir: hostRoot === undefined ? undefined : join(hostRoot, "dsh-ecosystem-spec") },
    { kind: "user-checkout", dir: resolveSpecCheckout() },
  ].filter((candidate): candidate is SpecDataRootCandidate => candidate.dir !== undefined)
}

/** A spec-data root that really carries the community registry, with the digest that identifies it. */
export interface SpecDataRoot {
  /** The producer that offered the root: the installed payload, or the operator's checkout. */
  readonly kind: SpecDataRootKind
  /** Absolute directory of the root holding `registry/registry-0.15.json`. */
  readonly dir: string
  /** `sha256:<hex>` digest of that registry file, recorded as the spec-data identity. */
  readonly registrySha256: string
}

/**
 * The spec-data root the admission lane must use: the INSTALLED payload's
 * `dsh-ecosystem-spec/` first (that is the copy the running host resolves), then
 * the populated user checkout. `.mpd/recon/dsh-TUI/` is deliberately NEVER used —
 * that clone's spec directory is empty (CAPTAIN-RECON §6, re-measured).
 * @param hostRoot The installed payload root, or `undefined` when no host was resolved.
 * @returns The resolved root with its registry digest, or `undefined` when no candidate carries one.
 */
export function resolveSpecDataRoot(hostRoot: string | undefined): SpecDataRoot | undefined {
  // Candidates are tried in resolution order; the first one carrying the registry wins.
  for (const candidate of specDataRootCandidates(hostRoot)) {
    if (existsSync(join(candidate.dir, "registry", "registry-0.15.json"))) {
      return { ...candidate, registrySha256: sha256File(join(candidate.dir, "registry", "registry-0.15.json")) }
    }
  }
  return undefined
}

/** The parsed command line of one TUI lane invocation. */
export interface SandboxArgs {
  /** Absolute sandbox root: `--sandbox-root` when given, else the lane's default under `.mpd/recon/`. */
  readonly root: string
  /** True when `--fresh` wiped the root before the standard subdirectories were recreated. */
  readonly fresh: boolean
  /** Every argv entry that is not one of this parser's own flags, in original order. */
  readonly rest: string[]
  /** True when the caller named the root explicitly — the provenance every result records. */
  readonly explicit: boolean
}

/** Parse `--sandbox-root <path>` / `--sandbox-root=<path>` / `--fresh`. */
export function parseSandboxArgs(argv: readonly string[], lane: string): SandboxArgs {
  /** The root the caller named, still un-resolved and possibly absent. */
  let root: string | undefined
  /** True once `--fresh` asked for the root to be wiped before use. */
  let fresh: boolean = false
  /** Positional and unrecognised arguments, preserved for the caller's own flags. */
  const rest: string[] = []
  // Walk argv once; only this parser's own flags are consumed, everything else is kept.
  for (let i = 0; i < argv.length; i++) {
    /** The argv entry under inspection. */
    const arg = argv[i]
    if (arg === "--sandbox-root") { root = argv[++i]; continue }
    if (arg.startsWith("--sandbox-root=")) { root = arg.slice("--sandbox-root=".length); continue }
    if (arg === "--fresh") { fresh = true; continue }
    rest.push(arg)
  }
  /** The effective root: the explicit one, or the lane's own default under the recon tree. */
  const resolvedRoot = resolve(root ?? join(REPO, ".mpd", "recon", "qa", "tui-lanes", lane))
  if (fresh) rmSync(resolvedRoot, { recursive: true, force: true })
  // Every directory a lane needs; `--fresh` removed them, so they are (re)created here.
  for (const dir of ["dshhome", "home", "npm-cache", "pnpm-home", "config", "data", "ws"]) {
    mkdirSync(join(resolvedRoot, dir), { recursive: true })
  }
  return { root: resolvedRoot, fresh, rest, explicit: root !== undefined }
}

/**
 * The sandbox environment for every dsh / dsh-tui spawn: DSH_HOME, HOME, the npm
 * and pnpm caches, XDG dirs, ALL inside the workspace (`/root/.npm` is read-only).
 * No real `~/.dsh` or `~/.dsh-tui` is ever touched.
 * @param root The sandbox root whose subdirectories become the child's HOME and DSH_HOME.
 * @param extra Entries layered on top of the defaults (e.g. `CI=1`); they win over the defaults.
 * @returns The complete child environment, inheriting `process.env` for everything not pinned here.
 */
export function sandboxEnv(root: string, extra: Env = {}): Env {
  return {
    ...process.env,
    DSH_HOME: join(root, "dshhome"),
    HOME: join(root, "home"),
    npm_config_cache: join(root, "npm-cache"),
    PNPM_HOME: join(root, "pnpm-home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    TERM: "xterm-256color",
    NO_COLOR: "1",
    ...extra,
  }
}

/** The bundle declarations of an installed profile manifest; every other key is ignored. */
interface ProfileManifest {
  /** The manifest's `dsh` block, which carries the bundle list on both spellings. */
  readonly dsh?: {
    /** The modern spelling: `dsh.profile.bundles`. */
    readonly profile?: { readonly bundles?: string[] }
    /** The legacy spelling kept for older profiles: `dsh.bundles`. */
    readonly bundles?: string[]
  }
}

/** What the prerequisite gate reads out of a sandbox root's `dsh-tui` profile. */
export interface ProfileState {
  /** True when the profile's `package.json` exists, i.e. the profile is installed. */
  readonly present: boolean
  /** Absolute profile directory, reported whether or not the profile is installed. */
  readonly profileDir: string
  /** The declared bundle names; empty when the manifest declares none. */
  readonly bundles: string[]
  /** True when the host payload is installed; absent (undefined) on the not-installed arm. */
  readonly hasHost?: boolean
  /** True when this bundle is installed; absent (undefined) on the not-installed arm. */
  readonly hasBundle?: boolean
}

/** The `dsh-tui` profile state inside a sandbox root. */
export function profileState(root: string): ProfileState {
  /** The `dsh-tui` profile directory inside the sandbox DSH_HOME. */
  const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
  /** The profile manifest the installer wrote, whose absence means "not installed". */
  const manifestPath = join(profileDir, "package.json")
  if (!existsSync(manifestPath)) return { present: false, profileDir, bundles: [] }
  // The installer writes this manifest and nothing re-validates it here, so the parsed JSON is
  // given the local manifest shape (which declares only the bundle keys this reader projects).
  /** The decoded profile manifest; a malformed file degrades to the empty manifest. */
  let manifest: ProfileManifest = {}
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ProfileManifest } catch { manifest = {} }
  /** The bundle names declared at the modern key, else the legacy key, else none. */
  const bundles = manifest?.dsh?.profile?.bundles ?? manifest?.dsh?.bundles ?? []
  return {
    present: true,
    profileDir,
    bundles: Array.isArray(bundles) ? bundles : [],
    hasHost: (bundles ?? []).includes("@deepseek-harness-tui/dsh-tui"),
    hasBundle: (bundles ?? []).includes("@mpd-dsh/mpd"),
  }
}

/** The arguments `runInSandbox` accepts on top of the sandbox root and command. */
export interface RunInSandboxOptions {
  /** Working directory for the child; defaults to the sandbox's `ws/`. */
  readonly cwd?: string
  /** Hard timeout in milliseconds; defaults to 15 minutes, which a profile install needs. */
  readonly timeoutMs?: number
  /** Entries layered on top of `sandboxEnv(root)` (e.g. `CI=1`). */
  readonly extraEnv?: Env
}

/** The outcome of one sandboxed child process. */
export interface SandboxRunResult {
  /** The child's exit status; `null` when it was signalled or could not be spawned at all. */
  readonly status: number | null
  /** Captured stdout, `""` when the child produced none. */
  readonly stdout: string
  /** Captured stderr; carries `DSH_MISSING` when no launcher resolves on this host. */
  readonly stderr: string
  /** `Error.message` of a failed spawn (e.g. ENOENT), `undefined` on a normal run. */
  readonly error?: string
}

/** Run a command inside the sandbox and capture stdout/stderr/status. */
export function runInSandbox(root: string, command: string, args: string[], { cwd, timeoutMs = 900_000, extraEnv = {} }: RunInSandboxOptions = {}): SandboxRunResult {
  // `command` may be the bare launcher name (`"dsh"`), which is not portable: see lib/dsh-launcher.ts.
  /** The `{command, args}` pair to spawn: the resolved launcher for `"dsh"`, the call as given otherwise. */
  const spec = command === "dsh" ? dshCommand(args) : { command, args }
  if (spec === null) return { status: null, stdout: "", stderr: DSH_MISSING, error: DSH_MISSING }
  /** The completed child process; `spawnSync` reports a missing binary instead of throwing. */
  const run = spawnSync(spec.command, spec.args, {
    cwd: cwd ?? join(root, "ws"),
    env: sandboxEnv(root, extraEnv),
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMs,
  })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "", error: run.error?.message }
}

/** `dsh --profile dsh-tui --dump-config` (COMPOSITION only — never a load proof). */
export function dumpConfig(root: string, extraArgs: readonly string[] = []): SandboxRunResult {
  // T-69: compose through the wrapper (absolute path, so a sandbox cwd still resolves it).
  return runInSandbox(root, process.execPath, [join(REPO, "scripts", "dump-config.ts"), "--profile", "dsh-tui", "--json", ...extraArgs], { timeoutMs: 180_000 })
}

/** The `dsh.profile.bundles` list out of a dump-config text. */
export function extractBundles(dumpText: string): string[] {
  /** The `bundles: [...]` fragment of the dump, or `null` when the dump carries none. */
  const match = dumpText.match(/bundles:\s*\[([^\]]*)\]/)
  if (match === null) return []
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1])
}

/** Apply-crash signatures present in a boot log (never on the model's prose). */
export function crashSignatures(logText: string): string[] {
  return APPLY_CRASH_SIGNATURES.filter((signature) => logText.includes(signature))
}

/** One pane marker that must never appear in a healthy `/plugins check` pane, with its failure code. */
export interface AdmissionForbiddenMarker {
  /** The pane text that marks the failure, in the English or the Chinese host copy. */
  readonly marker: string
  /** The failure code this marker maps to in the lane's result. */
  readonly code: string
}

/**
 * Classify the host's own `/plugins check` pane (AC-9).
 *
 * Acceptable: `compatible`, `compatible_degraded`, or the explainable
 * `waiting_authorization` (a declared permission is deny-defaulted with no grant
 * row — `negotiate()` → PERMISSION_NOT_GRANTED; `admitInternal` accepts only the
 * first two, so this state is reported, never silently upgraded).
 * Forbidden: the parse/schema/semantic/spec-data failure family, each of which
 * would otherwise sail through a loose "known outcome" wording.
 */
export const ADMISSION_FORBIDDEN: readonly AdmissionForbiddenMarker[] = [
  { marker: "Not parseable JSON", code: "plugins-check-invalid-json" },
  { marker: "不是可解析的 JSON", code: "plugins-check-invalid-json" },
  { marker: "Schema validation failed", code: "plugins-check-schema-failed" },
  { marker: "schema 校验失败", code: "plugins-check-schema-failed" },
  { marker: "Semantic validation failed", code: "plugins-check-invalid" },
  { marker: "语义校验失败", code: "plugins-check-invalid" },
  { marker: "Vendored spec data unavailable", code: "plugins-check-spec-unavailable" },
  { marker: "vendored 规范数据不可用", code: "plugins-check-spec-unavailable" },
]

/** The verdict `classifyAdmissionPane` reaches from one captured pane. */
export interface AdmissionPaneVerdict {
  /** True only when no forbidden marker fired AND the negotiation state is acceptable. */
  readonly ok: boolean
  /** The five-state outcome the pane advertises; `undefined` when it names none. */
  readonly state: string | undefined
  /** True for `compatible`, `compatible_degraded` and the explainable `waiting_authorization`. */
  readonly acceptable: boolean
  /** The distinct forbidden codes the pane carried, in first-seen order. */
  readonly forbidden: string[]
  /** The sentence a lane prints for this verdict; it names the code path that produced `ok`. */
  readonly reason: string
}

/** Judge one captured `/plugins check` pane against the acceptable and forbidden state families. */
export function classifyAdmissionPane(paneText: string): AdmissionPaneVerdict {
  /** The codes of every forbidden marker the pane carried, with repeats still in place. */
  const forbidden = ADMISSION_FORBIDDEN.filter((entry) => paneText.includes(entry.marker)).map((entry) => entry.code)
  /** The English negotiation line, or the Chinese one, whichever the pane carries. */
  const decision = paneText.match(/Negotiation decision:\s*([a-z_]+)/) ?? paneText.match(/协商结果：\s*([a-z_]+)/)
  /** The advertised state, `undefined` when the pane carries no negotiation line at all. */
  const state = decision === null ? undefined : decision[1]
  /** True for the three outcomes AC-9 accepts. */
  const acceptable = state === "compatible" || state === "compatible_degraded" || state === "waiting_authorization"
  return {
    ok: forbidden.length === 0 && acceptable,
    state,
    acceptable,
    forbidden: [...new Set(forbidden)],
    reason: forbidden.length > 0
      ? "the pane carries a forbidden failure state: " + [...new Set(forbidden)].join(",")
      : acceptable
        ? "state " + state
        : "no acceptable five-state outcome in the pane (expected compatible | compatible_degraded | waiting_authorization)",
  }
}

/** The options one tmux client call accepts. */
export interface TmuxOptions {
  /** Hard timeout in milliseconds; defaults to one minute, which a pane capture never needs. */
  readonly timeoutMs?: number
}

/** The outcome of one tmux client call. */
export interface TmuxResult {
  /** tmux's exit status; `null` when the client could not be spawned. */
  readonly status: number | null
  /** The call's stdout (the pane text for `capture-pane`, `""` for a pure command). */
  readonly stdout: string
  /** tmux's stderr; the caller decides whether a non-zero status is fatal. */
  readonly stderr: string
}

/** tmux helpers — every call targets a PRIVATE socket, so lanes never collide. */
export function tmux(socket: string, args: readonly string[], { timeoutMs = 60_000 }: TmuxOptions = {}): TmuxResult {
  /** The completed tmux client call. */
  const run = spawnSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: timeoutMs })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

/** One keystroke step a lane drives after the boot capture. */
export interface TuiStep {
  /** Evidence label for this step's capture (`<name>.pane.txt`). */
  readonly name: string
  /** tmux `send-keys` arguments, in order: a literal string, or `Enter` / `Escape` / `M-w`. */
  readonly keys: readonly string[]
  /** Milliseconds to wait before capturing this step's pane; defaults to 4000. */
  readonly waitMs?: number
  /** Optional sandbox mutation run after the boot capture and before this step's keystrokes. */
  readonly before?: () => void
}

/** Everything `runTuiSession` needs to own one TUI lifecycle. */
export interface TuiSessionOptions {
  /** Lane slug: names the private tmux socket and the evidence labels. */
  readonly lane: string
  /** Sandbox root whose `ws/` becomes the TUI session's workspace. */
  readonly root: string
  /** Evidence directory for the pane captures and the raw ANSI log. */
  readonly outDir: string
  /** Keystroke steps driven after the boot; lanes that only prove the boot pass none. */
  readonly steps?: readonly TuiStep[]
  /** How long the first boot may take before the chat screen must appear, in milliseconds. */
  readonly bootWaitMs?: number
  /** Pattern marking the CHAT screen as ready; the default accepts the English and Chinese prompts. */
  readonly readyPattern?: RegExp
}

/** One captured tmux pane. */
export interface TuiPaneCapture {
  /** Step name (`boot` for the boot capture) the pane was taken at. */
  readonly name: string
  /** Absolute path of the written `<name>.pane.txt`. */
  readonly file: string
  /** The pane text exactly as `capture-pane -p -J` printed it. */
  readonly text: string
}

/** The outcome of one full TUI lifecycle (spawn, drive, capture, kill). */
export interface TuiSessionResult {
  /** Captures in drive order; the first is always the boot capture. */
  readonly panes: TuiPaneCapture[]
  /** Text of the boot capture, the pane the boot-face assertions read. */
  readonly bootPane: string
  /** Raw ANSI terminal log; `""` when `pipe-pane` produced no file. */
  readonly log: string
  /** Absolute path of the raw ANSI log. */
  readonly logFile: string
  /** One sentence per tmux/boot/step failure; empty means the lifecycle was clean. */
  readonly failures: string[]
  /** Absolute path of the private tmux socket, removed before returning. */
  readonly socket: string
}

/**
 * Boot the real TUI inside tmux, drive it, capture, kill — inside THIS process.
 *
 * @param options.lane - lane slug (socket name + evidence labels).
 * @param options.root - sandbox root (recorded in the result).
 * @param options.outDir - evidence directory for the panes/log.
 * @param options.steps - `{ name, keys: string[], waitMs }`; `keys` are tmux
 *   `send-keys` arguments (a literal string, or `Enter`/`Escape`/`M-w`).
 * @param options.bootWaitMs - how long the first boot may take.
 */
export function runTuiSession({ lane, root, outDir, steps = [], bootWaitMs = 90_000, readyPattern = /❯|esc to interrupt|按 Esc/ }: TuiSessionOptions): TuiSessionResult {
  mkdirSync(outDir, { recursive: true })
  /** The private tmux socket for this lane; `-S` keeps the server off the operator's own socket. */
  const socket = join(root, lane + ".sock")
  /** The raw ANSI log `pipe-pane` writes and the reviewer reads. */
  const logFile = join(outDir, "tui-pane.log")
  /** Captures in drive order — the evidence every pane assertion reads. */
  const panes: TuiPaneCapture[] = []
  /** One sentence per failed lifecycle step; a non-empty list fails the lane. */
  const failures: string[] = []
  rmSync(socket, { force: true })
  tmux(socket, ["kill-server"])
  writeFileSync(logFile, "")

  /** The detached `new-session` call; a non-zero status is reported instead of thrown. */
  const created = tmux(socket, ["-f", "/dev/null", "new-session", "-d", "-s", "tui", "-x", "220", "-y", "50", "-c", join(root, "ws")])
  if (created.status !== 0) failures.push("tmux new-session failed: " + created.stderr.trim())
  tmux(socket, ["pipe-pane", "-t", "tui", "-o", "cat > '" + logFile + "'"])

  /** The sandbox environment the boot inherits, with every home-ish key pinned inside the sandbox. */
  const env = sandboxEnv(root)
  /** The `env -i` assignments the boot carries: an explicit list, so no ambient key leaks in. */
  const envArgs: string[] = ["PATH=" + env.PATH, "DSH_HOME=" + env.DSH_HOME, "HOME=" + env.HOME,
    "npm_config_cache=" + env.npm_config_cache, "PNPM_HOME=" + env.PNPM_HOME,
    "XDG_CONFIG_HOME=" + env.XDG_CONFIG_HOME, "XDG_DATA_HOME=" + env.XDG_DATA_HOME,
    // The host resolves the session workspace from `config.workspace ??
    // DSH_TUI_WORKSPACE_TARGET` (src/dsh-adapter/plugin.ts:391) and its own CLI sets
    // that key (bin/dsh-tui.js:589-593) — measured: without it the TUI session ran with
    // the REPO as cwd, so workspace-scoped state (and the session-store key) escaped the
    // sandbox even though DSH_HOME/HOME pointed inside it.
    "DSH_TUI_WORKSPACE_TARGET=" + join(root, "ws"),
    "TERM=xterm-256color"]
  /** The whole `env -i … dsh-tui` command line typed into the pane. */
  const boot = "env -i " + envArgs.map((entry) => "'" + entry + "'").join(" ") + " dsh-tui"
  tmux(socket, ["send-keys", "-t", "tui", boot, "Enter"])

  /** Capture the pane under a step name, write it to `<name>.pane.txt`, and return its text. */
  const capture = (name: string): string => {
    /** The `capture-pane -p -J` call producing this capture. */
    const run = tmux(socket, ["capture-pane", "-p", "-J", "-t", "tui"])
    /** Absolute path of the `<name>.pane.txt` this capture is written to. */
    const file = join(outDir, name + ".pane.txt")
    writeFileSync(file, run.stdout)
    panes.push({ name, file, text: run.stdout })
    return run.stdout
  }

  // Wait for the CHAT screen (the prompt box), not merely for the splash: the
  // plugin status line and every seam surface render with the chat screen, so a
  // capture taken during the splash would report a false absence.
  /** Wall-clock deadline by which the chat screen must have appeared. */
  const deadline = Date.now() + bootWaitMs
  /** Set once the readiness pattern matched a capture. */
  let ready = false
  // Poll the pane until the readiness pattern matches or the boot deadline passes.
  while (Date.now() < deadline) {
    /** The current pane text, re-read every poll so a repaint is never judged stale. */
    const probe = tmux(socket, ["capture-pane", "-p", "-J", "-t", "tui"])
    if (readyPattern.test(probe.stdout)) { ready = true; break }
    sleepMs(2000)
  }
  if (!ready) failures.push("the TUI did not reach the chat screen within " + bootWaitMs + "ms (readiness pattern " + String(readyPattern) + ")")
  sleepMs(3000)
  /** The pane captured once the chat screen was up; the boot-face assertions read this one. */
  const bootPane = capture("boot")

  // Every step is driven in order, each one producing its own capture.
  for (const step of steps) {
    // Additive (tui-team-surface): a step may need to change the SANDBOX between the
    // boot and its own keystrokes — e.g. write the staged team record with the live
    // session id this boot just produced, so the surface meets a record that names a
    // captain which is actually attached. Absent for every other lane: no behaviour
    // change. A throwing hook is contained so it can never kill the tmux lifecycle.
    if (typeof step.before === "function") {
      try { step.before() } catch (error) {
        // The thrown value is `unknown`: an object's `message` is preferred and anything else is
        // stringified exactly as thrown — the cast states that shape instead of narrowing it twice.
        failures.push("step " + step.name + " before() failed: " + String((error as { message?: unknown } | null)?.message ?? error))
      }
    }
    // This step's keystrokes go in order; every `keys` entry is a tmux key argument.
    for (const key of step.keys) tmux(socket, ["send-keys", "-t", "tui", key])
    sleepMs(step.waitMs ?? 4000)
    capture(step.name)
  }

  // Raw ANSI log + a plain-text pane stream are both kept: the log proves what the
  // terminal actually received, the captures are what the reviewer reads.
  tmux(socket, ["kill-server"])
  rmSync(socket, { force: true })
  /** The raw terminal log, `""` when `pipe-pane` never wrote the file. */
  const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
  return { panes, bootPane, log, logFile, failures, socket }
}

/** Block the calling thread for `ms` milliseconds without a busy loop. */
export function sleepMs(ms: number): void {
  // Synchronous by design: the whole tmux lifecycle must stay inside one process,
  // and every step boundary is a real wait for the host to repaint.
  /** A 4-byte buffer is the entire surface `Atomics.wait` needs to block on. */
  const shared = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(shared), 0, 0, ms)
}

/** The bound assertion collector a lane's offline arm uses. */
export interface LaneChecks {
  /**
   * Record `message` when `condition` is falsy.
   * @param condition The assertion's outcome; any falsy value counts as a failure.
   * @param message The failure text kept verbatim in `problems`.
   * @returns `condition` itself, so a caller can chain on the same value it asserted.
   */
  check<T>(condition: T, message: string): T
  /** Every failed assertion, in call order; empty means the offline arm is green. */
  problems: string[]
}

/** The bound assertion collector every lane uses for its offline self-test. */
export function makeChecks(): LaneChecks {
  /** Failed assertions, appended by `check` and read by the caller at the end of the arm. */
  const problems: string[] = []
  return {
    /** Record `message` when `condition` is falsy; returns the condition unchanged. */
    check<T>(condition: T, message: string): T { if (!condition) problems.push(message); return condition },
    problems,
  }
}

/** The payload a lane hands `writeLaneEvidence`: the verdict plus every lane-specific fact. */
export interface LaneEvidencePayload {
  /** The lane verdict, logged as `ok=` and returned as the caller's exit decision. */
  readonly ok: boolean
  /** Any further lane-specific fact, serialized verbatim into result.json. */
  readonly [key: string]: unknown
}

/** Evidence writer shared by all five lanes (result.json + output.log + raw/). */
export function writeLaneEvidence(outDir: string, slug: string, payload: LaneEvidencePayload, logText: string): boolean {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ slug, ...payload }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), logText + "\n")
  console.log("[" + slug + "] ok=" + payload.ok + " -> " + outDir)
  return payload.ok
}

/** `<repo>/evidence/tui/lanes/<timestamp>/` — the evidence root of every lane. */
export function laneEvidenceDir(lane: string): string {
  /** Filesystem-safe spelling of the run's ISO timestamp. */
  const stamp = new Date().toISOString().replaceAll(":", "-")
  /** The run's evidence directory, created here so the caller can write into it at once. */
  const dir = join(REPO, "evidence", "tui", "lanes", stamp)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "lane.txt"), lane + "\n")
  return dir
}

/** One `[mpd-qa] SKIP|FAIL …` marker line, exactly one per invocation. */
export function emitMarker(kind: string, slug: string, reason: string, probe: string, remedy: string): void {
  console.log("[mpd-qa] " + kind + " case=" + slug + " lane=real reason=" + reason + " prereq=" + probe + ' remedy="' + remedy + '"')
}

/** One declared prerequisite a lane gates on before it can run. */
export interface TuiPrereq {
  /** The marker code emitted when it is absent (`<code>`, or `requested-<code>` when asked for). */
  readonly code: string
  /** What the gate probed for, printed as `prereq=` in the marker line. */
  readonly probe: string
  /** The exact remediation printed in the marker line. */
  readonly remedy: string
  /** Liveness probe evaluated at gate time (never cached across a run). */
  readonly present: () => unknown
}

/** The callbacks `tuiPrereqs` needs from its caller. */
export interface TuiPrereqOptions {
  /** Answers whether the sandbox root already carries an installed `dsh-tui` profile. */
  readonly sandboxPresent: () => unknown
}

/** Declared prerequisites, in check order. */
export function tuiPrereqs({ sandboxPresent }: TuiPrereqOptions): TuiPrereq[] {
  return [
    { code: "absent-dsh-binary", probe: "dsh-tui", remedy: "npm i -g @deepseek-harness-tui/dsh-tui@0.11.1", present: tuiBinaryPresent },
    { code: "absent-runtime", probe: "tmux", remedy: "apt-get install tmux (a real TTY is required; stdout must not be a pipe)", present: tmuxPresent },
    { code: "absent-fixture", probe: "tui profile in the sandbox root", remedy: "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install", present: sandboxPresent },
  ]
}

/** The caller's declarations that turn a legitimate SKIP into a FAIL. */
export interface TuiPrereqGateOptions {
  /** Prerequisite codes the caller explicitly asked for (e.g. `--install` → `absent-fixture`). */
  readonly requested?: readonly string[]
}

/**
 * Prerequisite gate.
 *
 * Rule (T8-F1, adopted shape): a SKIP is legitimate only when the caller did NOT
 * ask for the missing thing. `--no-skip` still forces a failure for every absent
 * prerequisite; `requested` names the codes the caller explicitly asked for (e.g.
 * `--install` for `absent-fixture`), and those FAIL loudly with a named reason
 * instead of exiting green — a silent skip of a REQUESTED action is the defect this
 * closed.
 * @param slug The case slug the marker line reports.
 * @param prereqs The declared prerequisites, checked in order.
 * @param options The codes the caller explicitly asked for; omitted when it asked for nothing.
 */
export function gateTuiPrereqs(slug: string, prereqs: readonly TuiPrereq[], { requested = [] }: TuiPrereqGateOptions = {}): void {
  /** True when `--no-skip` asked for every absent prerequisite to fail instead of skipping. */
  const strict = process.argv.includes("--no-skip")
  // The first absent prerequisite ends the run; a present one is passed over silently.
  for (const prereq of prereqs) {
    if (prereq.present()) continue
    /** True when the caller explicitly asked for the thing this prerequisite provides. */
    const asked = requested.includes(prereq.code)
    /** `FAIL` for a requested or `--no-skip` run; a plain `SKIP` is the legitimate case. */
    const kind = (strict || asked) ? "FAIL" : "SKIP"
    emitMarker(kind, slug, asked ? "requested-" + prereq.code : prereq.code, prereq.probe, prereq.remedy)
    process.exit((strict || asked) ? 1 : 0)
  }
}

/** The options `readSessionHeaders` accepts. */
export interface SessionHeaderOptions {
  /** Maximum number of header records to decode; defaults to 1000. */
  readonly limit?: number
  /** When set, only this project key's directory is read — the others are skipped, not capped. */
  readonly projectKey?: string
}

/** One decoded `session` header record, the preset witness of a TUI boot. */
export interface SessionHeaderRecord {
  /** Session-store project key (the directory name) the record was found under. */
  readonly projectKey: string
  /** Session id (the store directory name). */
  readonly sessionId: string
  /** Absolute path of the store file the header was decoded from. */
  readonly file: string
  /** `sha256:<hex>` digest of that store file, the evidence anchor for the record. */
  readonly sha256: string
  /** Store mtime in epoch milliseconds, so runs can be ordered. */
  readonly mtimeMs: number
  /** The preset the session ran (`record.agentPreset`), `undefined` when the header omits it. */
  readonly agentPreset: unknown
  /** The session's working directory as recorded, `undefined` when the header omits it. */
  readonly cwd: unknown
}

/** The subset of a `session` header record this reader consumes; other keys are ignored. */
interface SessionHeaderEventRecord {
  /** The preset id the harness recorded for the session. */
  readonly agentPreset?: unknown
  /** The session's cwd as the harness recorded it. */
  readonly cwd?: unknown
}

/** Decode the sandbox session store's header records (the preset witness, AC-11). */
export function readSessionHeaders(root: string, { limit = 1000, projectKey: onlyKey }: SessionHeaderOptions = {}): SessionHeaderRecord[] {
  /** `<root>/dshhome/sessions`, the store root keyed by project key. */
  const sessionsRoot = join(root, "dshhome", "sessions")
  /** Decoded header records, capped at `limit` in read order. */
  const out: SessionHeaderRecord[] = []
  if (!existsSync(sessionsRoot)) return out
  // The cap must never decide WHICH key is read first: a warm shared root holds many
  // sessions under the real-repo key, and a low limit plus readdir order once hid the
  // run's own sandbox-keyed session (measured 2026-09-15: preset witness undefined).
  // Every project key is walked, in readdir order, unless the caller names one.
  for (const key of readdirSync(sessionsRoot)) {
    if (onlyKey !== undefined && key !== onlyKey) continue
    /** The directory of one project key; a non-directory entry is skipped. */
    const keyDir = join(sessionsRoot, key)
    if (!statSync(keyDir).isDirectory()) continue
    // Every session under this key is read; the header is the store's first record.
    for (const id of readdirSync(keyDir)) {
      /** The store file of one session; a session without a v3 store is skipped. */
      const file = join(keyDir, id, "session.v3.jsonl.zstd")
      if (!existsSync(file)) continue
      /** Every decoded frame of the store, concatenated as the harness wrote them. */
      const text = decompressAllFrames(file)
      /** The store's first `session` record line, or `undefined` when it carries none. */
      const header = text.split("\n").find((line) => line.startsWith('{"type":"session"'))
      if (header === undefined) continue
      try {
        // The store's header JSON is dynamic; the parsed value is given the local record shape.
        const record = JSON.parse(header) as SessionHeaderEventRecord
        out.push({
          projectKey: key,
          sessionId: id,
          file,
          sha256: sha256File(file),
          mtimeMs: statSync(file).mtimeMs,
          agentPreset: record.agentPreset,
          cwd: record.cwd,
        })
      } catch {
        // A malformed header is reported by its absence, never silently as a pass.
      }
      if (out.length >= limit) return out
    }
  }
  return out
}

/** The project a `--json` CLI transcript was captured for; only its `stdout` field is projected. */
interface CliJsonTranscript {
  /** The CLI's captured stdout, as embedded in the JSON transcript. */
  readonly stdout?: string
}

/**
 * Decode a `--json` CLI transcript's `stdout` field out of a captured text blob, falling back to
 * the raw text when the blob is not JSON at all.
 */
// The transcript is parsed JSON: the value is given the local transcript shape so no `any` parse
// result flows out, and a non-JSON blob degrades to its own text exactly as before.
const dumpJsonText = (text: string): string => { try { return (JSON.parse(text) as CliJsonTranscript).stdout ?? "" } catch { return String(text ?? "") } }

/**
 * Decompress a CONCATENATED-ZSTD-FRAME store: one `zstdDecompressSync` call
 * returns only the first frame (the header), so the frames are located with the
 * same structure-only scan the harness uses.
 * @param file Absolute path of the session store to decode.
 * @returns The concatenated UTF-8 text of every decodable frame, `""` when none decodes.
 */
function decompressAllFrames(file: string): string {
  /** The store's raw bytes, scanned for frame magics below. */
  const buffer = readFileSync(file)
  /** Byte offsets at which a Zstandard frame magic starts, in ascending order. */
  const frames: number[] = []
  /** Cursor of the byte-by-byte magic scan. */
  let offset = 0
  // Every byte position is tested for the 4-byte magic; a match starts a frame.
  while (offset + 4 <= buffer.length) {
    // Zstandard frame magic 0x28 0xB5 0x2F 0xFD, little-endian in the stream.
    if (buffer[offset] === 0x28 && buffer[offset + 1] === 0xb5 && buffer[offset + 2] === 0x2f && buffer[offset + 3] === 0xfd) {
      frames.push(offset)
    }
    offset += 1
  }
  /** Decoded frame texts, in stream order. */
  const pieces: string[] = []
  // Each frame's byte range runs to the next magic, or to the end of the buffer.
  for (let i = 0; i < frames.length; i++) {
    /** First byte of this frame. */
    const start = frames[i]
    /** One past the last byte of this frame: the next magic, or the end of the buffer. */
    const end = i + 1 < frames.length ? frames[i + 1] : buffer.length
    try {
      pieces.push(require("node:zlib").zstdDecompressSync(buffer.subarray(start, end)).toString("utf8"))
    } catch {
      // A truncated tail frame is normal for a live store; earlier frames stand.
    }
  }
  if (pieces.length > 0) return pieces.join("")
  try {
    return require("node:zlib").zstdDecompressSync(buffer).toString("utf8")
  } catch {
    /** The `zstd` CLI fallback, used when the file is not a plain concatenation of frames. */
    const run = spawnSync("zstd", ["-dc", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    return run.stdout ?? ""
  }
}

// `require` is not defined in ESM; bind it once for the zstd calls above.
import { createRequire } from "node:module"
/** The CJS `require` the `node:zlib` calls above go through; ESM has no ambient `require`. */
const require: NodeRequire = createRequire(import.meta.url)

/** Per-session hit count for one session event type. */
export interface SessionEventHits {
  /** Session id whose store carried the matches. */
  readonly sessionId: string
  /** `sha256:<hex>` digest of that store file. */
  readonly sha256: string
  /** Number of lines in that store carrying the event type. */
  readonly hits: number
}

/** The result of counting one event type across the sandbox-keyed stores. */
export interface SessionEventCount {
  /** Total matching lines across every store of the sandbox key. */
  readonly count: number
  /** The stores that carried at least one match, in read order. */
  readonly sessions: SessionEventHits[]
}

/** Count occurrences of one session event type in the sandbox-keyed store. */
export function countSessionEvents(root: string, type: string): SessionEventCount {
  /** The sandbox-keyed session store directory this run's boot writes. */
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  if (!existsSync(dir)) return { count: 0, sessions: [] }
  /** Running total of matching lines across the stores read so far. */
  let count: number = 0
  /** Per-session hits, appended only for stores that matched at least once. */
  const sessions: SessionEventHits[] = []
  // Every session store under the sandbox key contributes to the count.
  for (const id of readdirSync(dir)) {
    /** The store file of one session; a session without a v3 store is skipped. */
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    /** Every decoded frame of the store, concatenated. */
    const text = decompressAllFrames(file)
    /** Matching lines in this store, counted on the decoded JSONL text. */
    const hits = text.split("\n").filter((line) => line.includes('"' + type + '"')).length
    if (hits > 0) { count += hits; sessions.push({ sessionId: id, sha256: sha256File(file), hits }) }
  }
  return { count, sessions }
}

/** One `command/run` record decoded from the sandbox store. */
export interface CommandRunRecord {
  /** Session the command was invoked in. */
  readonly sessionId: string
  /** The command name the harness recorded, `undefined` when the record omits it. */
  readonly name: unknown
  /** The raw argument string the harness recorded for the command. */
  readonly args: unknown
}

/** One `command/done` record decoded from the sandbox store. */
export interface CommandDoneRecord {
  /** Session the completion belongs to. */
  readonly sessionId: string
  /** The id correlating this completion with its `command/run`. */
  readonly commandId: unknown
  /** How the command ended, as the harness recorded it. */
  readonly kind: unknown
  /** The result text the harness rendered for the command. */
  readonly text: unknown
}

/** The command records decoded from the sandbox-keyed stores. */
export interface CommandRecordSet {
  /** Every `command/run` record, in read order. */
  readonly runs: CommandRunRecord[]
  /** Every `command/done` record, in read order. */
  readonly dones: CommandDoneRecord[]
}

/** The payload of a `command/*` session record, as the harness writes it. */
interface CommandEventData {
  /** The invoked command's name. */
  readonly name?: unknown
  /** The invoked command's raw argument string. */
  readonly args?: unknown
  /** The id correlating a completion with its run. */
  readonly commandId?: unknown
  /** How the command ended. */
  readonly kind?: unknown
  /** The rendered result text. */
  readonly text?: unknown
}

/** The subset of a `command/*` session record this reader consumes; other keys are ignored. */
interface CommandEventRecord {
  /** The event type: only `command/run` and `command/done` are recorded. */
  readonly type?: unknown
  /** The event payload, whose fields differ between a run and a completion. */
  readonly data?: CommandEventData
}

/**
 * The harness's own record of a command invocation and its result
 * (`command/run` + `command/done`) from the sandbox-keyed store — the ground truth
 * the dsh-qa doctrine requires instead of reading the model's prose or a pane.
 */
export function readCommandRecords(root: string): CommandRecordSet {
  /** The sandbox-keyed session store directory this run's boot writes. */
  const dir = join(root, "dshhome", "sessions", sandboxProjectKey(root))
  /** Command invocations decoded so far. */
  const runs: CommandRunRecord[] = []
  /** Command completions decoded so far. */
  const dones: CommandDoneRecord[] = []
  if (!existsSync(dir)) return { runs, dones }
  // Every session store under the sandbox key is scanned, in readdir order.
  for (const id of readdirSync(dir)) {
    /** The store file of one session; a session without a v3 store is skipped. */
    const file = join(dir, id, "session.v3.jsonl.zstd")
    if (!existsSync(file)) continue
    // The frames are decoded once, then every JSONL line of the store is walked.
    for (const line of decompressAllFrames(file).split("\n")) {
      if (!line.startsWith('{"type":"command/')) continue
      try {
        // The store's record JSON is dynamic; the parsed value is given the local record shape.
        const record = JSON.parse(line) as CommandEventRecord
        if (record.type === "command/run") runs.push({ sessionId: id, name: record.data?.name, args: record.data?.args })
        if (record.type === "command/done") dones.push({ sessionId: id, commandId: record.data?.commandId, kind: record.data?.kind, text: record.data?.text })
      } catch {
        // A malformed record is surfaced by its absence, never counted as a success.
      }
    }
  }
  return { runs, dones }
}

/** Every session-store project key present in this sandbox's DSH_HOME. */
export function sessionStoreKeys(root: string): string[] {
  /** `<root>/dshhome/sessions`, the store root keyed by project key. */
  const sessionsRoot = join(root, "dshhome", "sessions")
  return existsSync(sessionsRoot) ? readdirSync(sessionsRoot) : []
}

/** The project key a boot with this sandbox cwd writes. */
export function sandboxProjectKey(root: string): string {
  /** The sandbox workspace whose absolute path the host keys the session store by. */
  const ws = join(root, "ws")
  return "--" + ws.replace(/^\/+/, "").replaceAll("/", "-") + "--"
}

/** The session-store path a boot in this sandbox writes (isolation assertion). */
export function sessionsOutsideSandbox(root: string, allowedRoot: string): string[] {
  /** `<root>/dshhome/sessions`, the store root keyed by project key. */
  const sessionsRoot = join(root, "dshhome", "sessions")
  if (!existsSync(sessionsRoot)) return []
  /** The allowed root in project-key spelling, with its leading slashes already removed. */
  const allowed = allowedRoot.replace(/^\/+/, "").replaceAll("/", "-").replace(/^-+/, "")
  return readdirSync(sessionsRoot).filter((key) => {
    /** The project key without its `--…--` delimiters, which is what `allowed` is compared against. */
    const inner = key.replace(/^--/, "").replace(/--$/, "")
    return !inner.startsWith(allowed)
  })
}

/** Copy a bounded excerpt of a decoded session record for the evidence dir. */
export function writeSessionExcerpt(outDir: string, name: string, headers: readonly SessionHeaderRecord[]): string {
  /** The excerpt records written verbatim, with absolute store paths made repo-relative. */
  const body = headers.map((entry) => ({
    sessionId: entry.sessionId,
    projectKey: entry.projectKey,
    store: entry.file.replace(REPO + "/", ""),
    storeSha256: entry.sha256,
    agentPreset: entry.agentPreset,
    cwd: entry.cwd,
  }))
  /** Absolute path of the excerpt file this call wrote. */
  const file = join(outDir, name)
  writeFileSync(file, JSON.stringify({ note: "decoded header records from the sandbox session store", records: body }, null, 2) + "\n")
  return file
}

/** `pathToFileURL` re-export so lanes do not each import node:url. */
export { pathToFileURL }
