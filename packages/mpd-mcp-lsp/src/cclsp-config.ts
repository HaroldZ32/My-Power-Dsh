// cclsp config assembly — the pure half of the launcher, kept out of `launch.ts` so it is testable.
//
// `launch.ts` has import-time side effects on purpose (it takes the terminal writers away before any
// dependency loads), so nothing in this file may touch the process: the environment is PASSED IN, the
// executable probe is INJECTABLE, and the document is built from a catalog the caller supplies. That
// is what lets a test assert the two behaviours the S2 contract names without spawning a language
// server: the generated file appears only when the user has no config, and an existing
// `<workspace>/cclsp.json` is never opened, let alone rewritten.
//
// The document shape is cclsp 0.7.0's own (MIT): `{servers:[{extensions,command,rootDir,
// restartInterval?,initializationOptions?}]}`, with BARE extensions and `command[0]` handed straight
// to `spawn`. `command[0]` may be absolute, and these rows use the absolute path the probe found so a
// server installed into the workspace's `node_modules/.bin` is reachable without a PATH change.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import type { LanguageServerEntry } from "./server-catalog.ts"
import { LANGUAGE_SERVERS } from "./server-catalog.ts"

/** Where the generated config lives, relative to the workspace root; never in the user's home. */
export const GENERATED_CONFIG_RELATIVE_PATH: string = ".mpd/lsp/cclsp.json"

/** The extensions the TS/JS row claims when the catalog carries no `typescript` entry at all. */
const FALLBACK_TYPESCRIPT_EXTENSIONS: readonly string[] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]

/** One `servers[]` row of a cclsp config, in the shape cclsp 0.7.0 reads. */
export interface CclspServerConfig {
  /** The file extensions this row answers for, BARE (no leading dot). */
  readonly extensions: readonly string[]
  /** The argv cclsp spawns; `command[0]` goes straight to `spawn`, so an absolute path is fine. */
  readonly command: readonly string[]
  /** The directory the server is started in and the root its answers are scoped to. */
  readonly rootDir: string
}

/** A cclsp config document; cclsp accepts an empty `servers` list and then reports per request. */
export interface CclspConfigDocument {
  /** One row per language server the bootstrap could wire. */
  readonly servers: readonly CclspServerConfig[]
}

/** How the config path was decided; `unavailable` means nothing could be supplied at all. */
export type ConfigSource = "env" | "workspace" | "generated" | "unavailable"

/** What `ensureConfigPath` did, so the caller can log it and a test can assert on it. */
export interface ConfigOutcome {
  /** The config path now in `CCLSP_CONFIG_PATH`, or null when nothing could be supplied. */
  readonly path: string | null
  /** Which of the four resolution routes decided the path. */
  readonly source: ConfigSource
  /** How many servers the GENERATED document carries (0 for every other source). */
  readonly serverCount: number
  /** Whether the generated file was actually written (the read-only and byte-identical cases are false). */
  readonly wrote: boolean
}

/** How to build a config document: every input the assembly needs, with the real ones as defaults. */
export interface ConfigBuildOptions {
  /** Absolute workspace root; every row's `rootDir`, and the anchor of the local `node_modules/.bin` probe. */
  readonly root: string
  /** The catalog to build from; defaults to the shipped one. */
  readonly catalog?: readonly LanguageServerEntry[]
  /** The executable probe; defaults to the real `<root>/node_modules/.bin` + `PATH` scan. */
  readonly probe?: (name: string) => string | null
  /** The TS/JS argv, or null when the bundled language server cannot be located. */
  readonly typescriptCommand?: readonly string[] | null
}

/** What `ensureConfigPath` needs: where, which environment to publish into, and how to build. */
export interface EnsureConfigOptions {
  /** Absolute workspace root to look in and to write under. */
  readonly root: string
  /** The environment the resolved path is published into (the launcher passes `process.env`). */
  readonly env: NodeJS.ProcessEnv
  /** Builds the document, called only when a generated config is the resolution. */
  readonly build: () => CclspConfigDocument
}

/**
 * Whether a path exists as an executable regular file.
 *
 * The win32 arm accepts any regular file: the runnable form there is a `.cmd`/`.exe` shim whose name
 * differs from the package's, so a mode-bit test would reject every candidate. That is a declared
 * bound — on win32 the probe is name-based and may accept a shim it cannot actually start.
 *
 * @param path the candidate path, absolute or relative to the process cwd.
 * @returns true when the path is a regular file this platform would consider runnable.
 */
function isExecutableFile(path: string): boolean {
  try {
    /** The candidate's metadata; a missing path throws and is handled below. */
    const stats = statSync(path)
    if (!stats.isFile()) return false
    if (process.platform === "win32") return true
    return (stats.mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * Find the executable a catalog row names, preferring the workspace's own install.
 *
 * Order: an ALREADY-PATH-SHAPED name is tested as given; then `<root>/node_modules/.bin/<name>`; then
 * every `PATH` entry in order. The first hit wins, so a workspace-local server shadows a global one.
 *
 * @param name the executable name (`gopls`) or an explicit path.
 * @param root the workspace root whose `node_modules/.bin` is probed first.
 * @returns the absolute path of the executable, or null when nothing matched.
 */
export function probeExecutable(name: string, root: string): string | null {
  /** The name with surrounding whitespace removed; an empty name can never resolve. */
  const trimmed: string = name.trim()
  if (trimmed.length === 0) return null
  if (isAbsolute(trimmed) || trimmed.includes("/")) {
    return isExecutableFile(trimmed) ? trimmed : null
  }
  /** The workspace-local install, which cclsp can only reach through an absolute path. */
  const local: string = join(root, "node_modules", ".bin", trimmed)
  if (isExecutableFile(local)) return local
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir.trim().length === 0) continue
    /** One PATH candidate for this name. */
    const candidate: string = join(dir, trimmed)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

/**
 * Assemble a cclsp config document from the catalog.
 *
 * The TS/JS row comes FIRST and unconditionally when `typescriptCommand` is supplied (it is the one
 * server the bundle itself carries). Every other catalog row is included only when its executable
 * actually resolves, and then `command[0]` is replaced by the resolved absolute path. A row whose
 * server is not installed is left OUT rather than pointed at a binary that is not there: cclsp starts
 * a server lazily, per extension, so an unrouted extension fails with cclsp's own message instead of
 * a spawn error, and installing the server is what wires it in on the next boot.
 *
 * Rows that resolve to the SAME argv are merged into one config row carrying the union of their
 * extensions, because cclsp keys a running server by its config: two rows would mean two processes of
 * one binary. The catalog may therefore list a language per row (one licence, one caveat each) without
 * the generated config paying for it twice.
 *
 * @param options the root, the catalog, the probe and the TS/JS argv.
 * @returns the document to serialize; `servers` may be empty when nothing resolves.
 */
export function buildConfigDocument(options: ConfigBuildOptions): CclspConfigDocument {
  /** The catalog to describe; the shipped one unless a caller overrides it. */
  const catalog: readonly LanguageServerEntry[] = options.catalog ?? LANGUAGE_SERVERS
  /** The executable probe, bound to this workspace root when the caller supplied none. */
  const probe: (name: string) => string | null = options.probe ?? ((name: string): string | null => probeExecutable(name, options.root))
  /** The rows assembled so far, in output order. */
  const servers: CclspServerConfig[] = []
  /** The catalog's TS/JS row, which also supplies the generated row's extensions. */
  const typescriptRow: LanguageServerEntry | undefined = catalog.find((entry: LanguageServerEntry): boolean => entry.language === "typescript")

  if (options.typescriptCommand !== undefined && options.typescriptCommand !== null) {
    servers.push({
      extensions: typescriptRow?.extensions ?? FALLBACK_TYPESCRIPT_EXTENSIONS,
      command: options.typescriptCommand,
      rootDir: options.root
    })
  }

  /** Assembled rows by their argv, so a second language served by the same binary merges into the
   *  first row instead of starting a second process. */
  const byCommand: Map<string, { extensions: string[]; command: readonly string[]; rootDir: string }> = new Map()

  for (const entry of catalog) {
    if (entry.language === "typescript") continue
    /** The absolute path of this row's executable, or null when it is not installed. */
    const resolved: string | null = probe(entry.command[0])
    if (resolved === null) continue
    /** This row's argv with the probed executable in the spawn position. */
    const command: readonly string[] = [resolved, ...entry.command.slice(1)]
    /** The identity two rows share when they start the same binary the same way. */
    const key: string = JSON.stringify(command)
    /** The row already assembled for this argv, if this is the second language to use it. */
    const existing = byCommand.get(key)
    if (existing === undefined) {
      /** The merged row for this argv, registered so a later language can join it. */
      const row = { extensions: [...entry.extensions], command, rootDir: options.root }
      byCommand.set(key, row)
      servers.push(row)
      continue
    }
    for (const extension of entry.extensions) {
      if (!existing.extensions.includes(extension)) existing.extensions.push(extension)
    }
  }

  return { servers }
}

/**
 * Point cclsp at a config file, generating one only when nothing else supplies it.
 *
 * Resolution order, and the FIRST hit wins: the caller's `CCLSP_CONFIG_PATH`, then a `cclsp.json` in
 * the workspace root, then the generated `<root>/.mpd/lsp/cclsp.json`. The workspace-root file is
 * AUTHORITATIVE: it is detected with `existsSync` and never even read, so a user's bytes cannot be
 * touched by this function. The generated file is rewritten only when its bytes would change, so a
 * session does not churn it on every boot.
 *
 * @param options the workspace root, the environment to publish into, and the document builder.
 * @returns what was decided; `source: "unavailable"` when the write failed, which is not fatal here —
 *   cclsp then reports its own actionable error instead of the row dying.
 */
export function ensureConfigPath(options: EnsureConfigOptions): ConfigOutcome {
  /** The caller's own config, which is never second-guessed. */
  const configured: string = (options.env.CCLSP_CONFIG_PATH ?? "").trim()
  if (configured.length > 0) {
    return { path: configured, source: "env", serverCount: 0, wrote: false }
  }
  /** The workspace-root config a user maintains by hand. */
  const projectConfig: string = join(options.root, "cclsp.json")
  if (existsSync(projectConfig)) {
    options.env.CCLSP_CONFIG_PATH = projectConfig
    return { path: projectConfig, source: "workspace", serverCount: 0, wrote: false }
  }
  /** The generated config's path, under workspace-scoped state and never in the user's home. */
  const generated: string = join(options.root, GENERATED_CONFIG_RELATIVE_PATH)
  try {
    /** The document to publish, serialized once so the change check and the write agree. */
    const document: CclspConfigDocument = options.build()
    /** The exact bytes stored on a write. */
    const body: string = JSON.stringify(document, null, 2) + "\n"
    /** The existing bytes, or null when the file is absent or unreadable. */
    let existing: string | null
    try {
      existing = readFileSync(generated, "utf8")
    } catch {
      existing = null
    }
    /** Whether the stored bytes differ from the document, which is the only reason to write. */
    const stale: boolean = existing !== body
    if (stale) {
      mkdirSync(join(options.root, ".mpd", "lsp"), { recursive: true })
      writeFileSync(generated, body)
    }
    options.env.CCLSP_CONFIG_PATH = generated
    return { path: generated, source: "generated", serverCount: document.servers.length, wrote: stale }
  } catch {
    return { path: null, source: "unavailable", serverCount: 0, wrote: false }
  }
}
