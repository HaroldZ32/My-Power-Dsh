// Config-behaviour tests: S2 acceptance (c) — the generated config appears ONLY when the user has
// none, and an existing `<workspace>/cclsp.json` is left BYTE-UNTOUCHED.
//
// Both halves are asserted against the real functions the launcher calls (`ensureConfigPath`,
// `buildConfigDocument`, `probeExecutable`), driven through an INJECTED environment object and an
// injected executable probe, so no language server is ever spawned and no real workspace is written.
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { GENERATED_CONFIG_RELATIVE_PATH, buildConfigDocument, ensureConfigPath, probeExecutable } from "../src/cclsp-config.ts"
import type { CclspConfigDocument, ConfigOutcome } from "../src/cclsp-config.ts"
import { LANGUAGE_SERVERS } from "../src/server-catalog.ts"
import type { LanguageServerEntry } from "../src/server-catalog.ts"

/** Scratch workspace roots created by the cases below, removed when each case ends. */
const scratchRoots: string[] = []

afterEach((): void => {
  while (scratchRoots.length > 0) {
    /** The root this iteration removes; the array is non-empty by the loop condition. */
    const root: string | undefined = scratchRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

/**
 * Create a scratch workspace root.
 *
 * @returns the absolute path of the new empty root, registered for cleanup.
 */
function scratchWorkspace(): string {
  /** The new root, under the platform temp directory. */
  const root: string = mkdtempSync(join(tmpdir(), "mpd-lsp-config-"))
  scratchRoots.push(root)
  return root
}

/**
 * The sha256 of a file's bytes: "untouched" is asserted as a byte fact, never as a claim.
 *
 * @param path the file to digest.
 * @returns the hex digest of its content.
 */
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/** The document builder used by the generation cases: one row, and a marker on the builder call. */
interface BuilderProbe {
  /** How many times the builder ran; the user-config cases assert this stays 0. */
  calls: number
  /** The builder itself, in the shape `ensureConfigPath` expects. */
  build: (root: string) => () => CclspConfigDocument
}

/**
 * A builder that records its own invocation, so "the user's file was honoured" can be asserted as
 * "the generator never ran" rather than as "the output happened to match".
 *
 * @returns the probe: its call counter and the factory the cases pass to `ensureConfigPath`.
 */
function recordingBuilder(): BuilderProbe {
  /** The probe object mutated by the builder below. */
  const probe: BuilderProbe = {
    calls: 0,
    build: (root: string): (() => CclspConfigDocument) =>
      (): CclspConfigDocument => {
        probe.calls += 1
        return { servers: [{ extensions: ["ts"], command: ["node", "server.js", "--stdio"], rootDir: root }] }
      }
  }
  return probe
}

/**
 * A synthetic catalog row derived from the shipped one, so the assembler cases do not depend on rows
 * the matrix has not delivered yet.
 *
 * @param patch the fields that make the row the case's subject.
 * @returns a well-formed entry.
 */
function syntheticRow(patch: Partial<LanguageServerEntry>): LanguageServerEntry {
  return { ...LANGUAGE_SERVERS[0], ...patch }
}

describe("ensureConfigPath generates only when the user has none", () => {
  test("writes <root>/.mpd/lsp/cclsp.json and publishes it", () => {
    /** A workspace with no config of any kind. */
    const root: string = scratchWorkspace()
    /** The environment object this case owns; the real process env is never touched. */
    const env: NodeJS.ProcessEnv = {}
    /** The builder probe, which must run exactly once here. */
    const probe: BuilderProbe = recordingBuilder()
    /** What the resolution decided. */
    const outcome: ConfigOutcome = ensureConfigPath({ root, env, build: probe.build(root) })

    expect(outcome.source).toBe("generated")
    expect(outcome.path).toBe(join(root, GENERATED_CONFIG_RELATIVE_PATH))
    expect(outcome.wrote).toBe(true)
    expect(outcome.serverCount).toBe(1)
    expect(probe.calls).toBe(1)
    expect(env.CCLSP_CONFIG_PATH).toBe(join(root, GENERATED_CONFIG_RELATIVE_PATH))
    /** The document on disk, parsed back so the assertions are about bytes cclsp could read. */
    const document: CclspConfigDocument = JSON.parse(readFileSync(outcome.path as string, "utf8"))
    expect(document.servers.length).toBe(1)
    expect(document.servers[0].rootDir).toBe(root)
    expect(document.servers[0].extensions).toEqual(["ts"])
  })

  test("rewrites nothing when its bytes would not change", () => {
    /** A workspace with no config of any kind. */
    const root: string = scratchWorkspace()
    /** The environment object the FIRST resolution owns. */
    const env: NodeJS.ProcessEnv = {}
    /** A FRESH environment for the second resolution: within one process the first call has already
     *  published the path, so a re-run that must re-decide belongs to a new process, as a boot is. */
    const nextEnv: NodeJS.ProcessEnv = {}
    /** The builder probe shared by both resolutions. */
    const probe: BuilderProbe = recordingBuilder()
    /** The first resolution, which writes the file. */
    const first: ConfigOutcome = ensureConfigPath({ root, env, build: probe.build(root) })
    /** The generated file's path, known good after the first resolution. */
    const path: string = first.path as string
    /** The file's bytes and modification instant before the second resolution. */
    const before: { readonly digest: string; readonly mtimeMs: number } = { digest: sha256(path), mtimeMs: statSync(path).mtimeMs }

    /** The second resolution, which must find the stored bytes already correct. */
    const second: ConfigOutcome = ensureConfigPath({ root, env: nextEnv, build: probe.build(root) })

    expect(second.source).toBe("generated")
    expect(second.wrote).toBe(false)
    expect(second.path).toBe(path)
    expect(sha256(path)).toBe(before.digest)
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs)
  })

  test("leaves an existing <root>/cclsp.json BYTE-UNTOUCHED and never generates", () => {
    /** A workspace whose user maintains a config by hand. */
    const root: string = scratchWorkspace()
    /** The user's own file. */
    const userFile: string = join(root, "cclsp.json")
    /** The user's exact bytes, deliberately not in this launcher's own shape. */
    const userBytes: string = '{ "servers": [ { "extensions": ["rs"], "command": ["/opt/rust-analyzer"] } ] }\n'
    writeFileSync(userFile, userBytes)
    /** The digest of those bytes before the resolution. */
    const before: string = sha256(userFile)
    /** The environment object this case owns. */
    const env: NodeJS.ProcessEnv = {}
    /** The builder probe, which must NOT run: the user's file is authoritative. */
    const probe: BuilderProbe = recordingBuilder()
    /** What the resolution decided. */
    const outcome: ConfigOutcome = ensureConfigPath({ root, env, build: probe.build(root) })

    expect(outcome.source).toBe("workspace")
    expect(outcome.path).toBe(userFile)
    expect(outcome.wrote).toBe(false)
    expect(probe.calls).toBe(0)
    expect(env.CCLSP_CONFIG_PATH).toBe(userFile)
    expect(sha256(userFile)).toBe(before)
    expect(readFileSync(userFile, "utf8")).toBe(userBytes)
    expect(existsSync(join(root, ".mpd"))).toBe(false)
  })

  test("reports a user file that already exists BEFORE the caller-set environment variable", () => {
    /** A workspace with a hand-maintained config. */
    const root: string = scratchWorkspace()
    writeFileSync(join(root, "cclsp.json"), "{}\n")
    /** An environment that already names a config: the caller's choice wins over the workspace file. */
    const env: NodeJS.ProcessEnv = { CCLSP_CONFIG_PATH: "/somewhere/else/cclsp.json" }
    /** The builder probe, which must not run. */
    const probe: BuilderProbe = recordingBuilder()
    /** What the resolution decided. */
    const outcome: ConfigOutcome = ensureConfigPath({ root, env, build: probe.build(root) })

    expect(outcome.source).toBe("env")
    expect(outcome.path).toBe("/somewhere/else/cclsp.json")
    expect(outcome.wrote).toBe(false)
    expect(probe.calls).toBe(0)
    expect(env.CCLSP_CONFIG_PATH).toBe("/somewhere/else/cclsp.json")
  })
})

describe("buildConfigDocument", () => {
  test("puts the TS/JS row first and includes a catalog row only when its executable resolves", () => {
    /** A workspace root standing in for the real one. */
    const root: string = scratchWorkspace()
    /** A catalog with one installed server and one that is not installed. */
    const catalog: readonly LanguageServerEntry[] = [
      LANGUAGE_SERVERS[0],
      syntheticRow({ language: "go", displayName: "Go", server: "gopls", extensions: ["go"], command: ["gopls"] }),
      syntheticRow({ language: "rust", displayName: "Rust", server: "rust-analyzer", extensions: ["rs"], command: ["rust-analyzer"] })
    ]
    /** The probe: only `gopls` exists on this imaginary machine. */
    const probe: (name: string) => string | null = (name: string): string | null => (name === "gopls" ? "/usr/local/bin/gopls" : null)
    /** The assembled document. */
    const document: CclspConfigDocument = buildConfigDocument({ root, catalog, probe, typescriptCommand: ["/usr/bin/node", "/bundle/tsserver.js", "--stdio"] })

    expect(document.servers.length).toBe(2)
    expect(document.servers[0].command).toEqual(["/usr/bin/node", "/bundle/tsserver.js", "--stdio"])
    expect(document.servers[0].extensions).toEqual(LANGUAGE_SERVERS[0].extensions)
    expect(document.servers[1].command).toEqual(["/usr/local/bin/gopls"])
    expect(document.servers[1].extensions).toEqual(["go"])
    for (const server of document.servers) expect(server.rootDir).toBe(root)
  })

  test("omits the TS/JS row when the bundled server could not be located", () => {
    /** A workspace root standing in for the real one. */
    const root: string = scratchWorkspace()
    /** The assembled document with no TS/JS argv. */
    const document: CclspConfigDocument = buildConfigDocument({ root, catalog: LANGUAGE_SERVERS, probe: (): string | null => null, typescriptCommand: null })
    expect(document.servers).toEqual([])
  })

  test("merges two languages served by ONE binary into a single row", () => {
    /** A workspace root standing in for the real one. */
    const root: string = scratchWorkspace()
    /** A catalog whose two rows resolve to the same argv, as a cataloged-per-language table does. */
    const catalog: readonly LanguageServerEntry[] = [
      LANGUAGE_SERVERS[0],
      syntheticRow({ language: "c", displayName: "C", server: "clangd", extensions: ["c", "h"], command: ["clangd", "--background-index"] }),
      syntheticRow({ language: "cpp", displayName: "C++", server: "clangd", extensions: ["cpp", "hpp"], command: ["clangd", "--background-index"] })
    ]
    /** A probe that finds the one shared binary. */
    const probe: (name: string) => string | null = (name: string): string | null => (name === "clangd" ? "/usr/bin/clangd" : null)

    /** The assembled document. */
    const document: CclspConfigDocument = buildConfigDocument({ root, catalog, probe, typescriptCommand: ["/usr/bin/node", "/bundle/tsserver.js", "--stdio"] })

    // Two catalog rows, ONE process: cclsp keys a running server by its config, so a second row for
    // the same argv would spawn a second clangd.
    expect(document.servers.length).toBe(2)
    expect(document.servers[1].command).toEqual(["/usr/bin/clangd", "--background-index"])
    expect(document.servers[1].extensions).toEqual(["c", "h", "cpp", "hpp"])
  })

  test("writes rows cclsp can read: three keys, BARE extensions", () => {
    /** A workspace root standing in for the real one. */
    const root: string = scratchWorkspace()
    /** The assembled document. */
    const document: CclspConfigDocument = buildConfigDocument({ root, typescriptCommand: ["/usr/bin/node", "/bundle/tsserver.js", "--stdio"] })
    expect(document.servers.length).toBeGreaterThan(0)
    for (const server of document.servers) {
      expect(Object.keys(server).sort()).toEqual(["command", "extensions", "rootDir"])
      for (const extension of server.extensions) expect(extension.startsWith(".")).toBe(false)
    }
  })
})

describe("probeExecutable", () => {
  test("prefers the workspace's own node_modules/.bin and returns an absolute path", () => {
    /** A workspace root standing in for an install with a local server. */
    const root: string = scratchWorkspace()
    /** The package's bin directory, where a locally installed server lands. */
    const binDir: string = join(root, "node_modules", ".bin")
    mkdirSync(binDir, { recursive: true })
    /** The local server, made runnable. */
    const local: string = join(binDir, "mpd-probe-local")
    writeFileSync(local, "#!/bin/sh\nexit 0\n")
    chmodSync(local, 0o755)

    expect(probeExecutable("mpd-probe-local", root)).toBe(local)
  })

  test("rejects a candidate that is not executable, and reports an absent one as null", () => {
    /** A workspace root holding an inert file under the bin directory. */
    const root: string = scratchWorkspace()
    /** The package's bin directory. */
    const binDir: string = join(root, "node_modules", ".bin")
    mkdirSync(binDir, { recursive: true })
    /** A file that exists but cannot be started. */
    const inert: string = join(binDir, "mpd-probe-inert")
    writeFileSync(inert, "not a program\n")
    chmodSync(inert, 0o644)

    expect(probeExecutable("mpd-probe-inert", root)).toBeNull()
    expect(probeExecutable("mpd-probe-definitely-absent", root)).toBeNull()
  })

  test("accepts an absolute path that exists", () => {
    /** A workspace root, unrelated to the absolute path under test. */
    const root: string = scratchWorkspace()
    /** An absolute executable outside the workspace's bin directory. */
    const explicit: string = join(root, "server")
    writeFileSync(explicit, "#!/bin/sh\nexit 0\n")
    chmodSync(explicit, 0o755)

    expect(probeExecutable(explicit, root)).toBe(explicit)
  })
})
