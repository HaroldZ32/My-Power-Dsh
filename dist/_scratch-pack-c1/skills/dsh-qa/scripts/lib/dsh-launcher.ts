// Shared launcher resolution for every QA lane that has to RUN `dsh`.
//
// WHY A SHARED MODULE: a bare `spawn("dsh", ...)` is not portable. npm installs the launcher on
// win32 as a shim triple (`dsh`, `dsh.cmd`, `dsh.ps1`), and a `.cmd` cannot be exec'd directly
// without a shell. Measured 2026-09-22 under node 24: `spawn("dsh", ["--profile","w", ...])`
// answered `Error: spawn dsh ENOENT` as an unhandled 'error' event, which took the whole
// preset-conformance lane down instead of its own boot step, while the same call under bun
// resolved the shim itself - so the lane's verdict depended on WHICH runtime started it.
//
// Every lane therefore asks THIS module for the {command, args} pair instead of naming `dsh`:
//   const spec = dshCommand(["--profile", "w", ...], env)
//   if (spec === null) fail(DSH_MISSING)
//   spawn(spec.command, spec.args, { env, ... })
// On POSIX the resolved launcher is the same `dsh` PATH would have found, so nothing changes there.
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

/** A child-process environment: the `process.env` shape, where any key may be absent. */
export type Env = Record<string, string | undefined>

/** The `{command, args}` pair a lane hands to `spawn`/`spawnSync` for one resolvable executable. */
export interface CommandSpec {
  /** The executable to spawn: a resolved absolute path, or the interpreter for a `.cmd` shim. */
  readonly command: string
  /** The argument vector, with the shim path already inserted after `/d /c` when one is needed. */
  readonly args: string[]
}

/** The actionable sentence a lane reports when no launcher resolves - never a raw ENOENT. */
export const DSH_MISSING: string = "no dsh launcher on PATH: install the harness (`npm install -g @deepseek-ai/dsh`) or put its bin directory on PATH"

/**
 * PATH-resolved `dsh` launcher, in-process and without a shell.
 * @param env The environment whose PATH is scanned.
 * @param platform The platform whose shim naming applies.
 * @returns The absolute launcher path, or `""` when absent.
 */
export function resolveDshLauncher(env: Env = process.env, platform: string = process.platform): string {
  return resolveOnPath("dsh", env, platform)
}

/**
 * The PATH scan behind every bare name this module resolves, `dsh` included.
 * @param name The bare command name to resolve.
 * @param env The environment whose PATH is scanned.
 * @param platform The platform whose shim naming applies.
 * @returns The absolute executable path, or `""` when nothing on PATH matches.
 */
export function resolveOnPath(name: string, env: Env = process.env, platform: string = process.platform): string {
  // `.cmd` first on win32: it is the shape Node can run through the interpreter, and npm writes it
  // beside the extensionless POSIX shim (which is a `#!/bin/sh` script Windows cannot execute).
  const names: readonly string[] = platform === "win32" ? [name + ".cmd", name + ".exe", name + ".bat", name] : [name]
  for (const dir of String(env.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
    if (dir === "") continue
    for (const name of names) {
      // The PATH entry joined with one shim name, accepted as soon as it exists.
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return ""
}

/**
 * The interpreter a `.cmd`/`.bat` launcher needs, as an ABSOLUTE path: a minimal child env carries
 * neither ComSpec nor System32 on PATH, and a bare `cmd.exe` then answers ENOENT.
 * @param env The environment whose ComSpec/SystemRoot is consulted.
 * @returns The absolute path of the command interpreter to run the shim with.
 */
export function commandInterpreter(env: Env = process.env): string {
  if (typeof env.ComSpec === "string" && env.ComSpec.length > 0) return env.ComSpec
  // The Windows directory root, defaulted so the result is always an absolute path.
  const root = env.SystemRoot ?? env.windir ?? "C:\\Windows"
  return join(root, "System32", "cmd.exe")
}

/**
 * The harness package that owns a resolved launcher, when its layout is resolvable.
 * @param launcher Absolute path of the resolved `dsh` launcher.
 * @returns The absolute harness package root, or `""` when it cannot be located.
 */
function harnessRootNear(launcher: string): string {
  try {
    // A `require` anchored beside the launcher, so the harness's OWN resolution chain is asked.
    const resolver = createRequire(join(dirname(launcher), "resolve.cjs"))
    return dirname(resolver.resolve("@deepseek-ai/dsh/package.json"))
  } catch { /* fall through to the layout walk */ }
  // The directory the layout walk is currently probing, starting beside the launcher.
  let dir = dirname(launcher)
  for (let depth = 0; depth < 6; depth += 1) {
    // The `node_modules/@deepseek-ai/dsh` candidate at this walk depth.
    const candidate = join(dir, "node_modules", "@deepseek-ai", "dsh")
    if (existsSync(join(candidate, "lib", "bin.js"))) return candidate
    // The next directory up; equal to `dir` at the filesystem root, which ends the walk.
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return ""
}

/**
 * The spec for the LONG-LIVED app form of the launcher (`dsh --profile w ...`).
 *
 * WHY NOT ALWAYS THE INTERPRETER: a `.cmd` launcher runs the app as a CHILD of cmd.exe, so killing
 * the spawned process leaves the app running and holding its port - measured 2026-09-22, when the
 * next boot in the same lane died with EADDRINUSE and a Windows tree kill is not available to every
 * caller. Running the harness's own `lib/bin.js` with THIS node makes the app a direct child that
 * `child.kill()` disposes of. The interpreter stays the fallback for layouts that do not offer it.
 * @param args The harness argument vector, without the executable.
 * @param env The environment whose PATH is scanned.
 * @returns The spec to spawn, or `null` when no launcher resolves.
 */
export function dshAppSpec(args: string[], env: Env = process.env): CommandSpec | null {
  // The PATH-resolved launcher, or `""` when the harness is not installed.
  const launcher = resolveDshLauncher(env)
  if (launcher === "") return null
  // The harness package root beside the launcher, or `""` for a layout the walk cannot resolve.
  const root = harnessRootNear(launcher)
  if (root !== "") {
    // The harness's own app entry point, run with THIS node so the app is a direct child.
    const entry = join(root, "lib", "bin.js")
    if (existsSync(entry)) return { command: process.execPath, args: [entry, ...args] }
  }
  return commandFor(launcher, args, env)
}

/**
 * The {command, args} pair for ANY bare command name, resolved without a shell.
 *
 * A lane that shells out to a tool inherits the same win32 shim problem `dsh` has: `pnpm` is a
 * `.cmd` here too (measured 2026-09-22: `spawnSync("pnpm", ["--version"])` answers ENOENT under
 * node while `pnpm.cmd` sits on PATH). An absent name keeps the PLAIN spawn, so a fixture that
 * expects ENOENT still observes it.
 * @param command The bare command name to resolve.
 * @param args The argument vector, without the executable.
 * @param env The environment whose PATH is scanned.
 * @returns The spec to spawn; the bare name is preserved when nothing resolves.
 */
export function spawnSpec(command: string, args: string[], env: Env = process.env): CommandSpec {
  // The PATH-resolved path of the bare name, or `""` when nothing matches.
  const resolved = resolveOnPath(command, env)
  if (resolved === "") return { command, args: [...args] }
  return commandFor(resolved, args, env)
}

/**
 * The {command, args} pair for a RESOLVED path: a `.cmd`/`.bat` goes through the interpreter.
 * @param path Absolute path of the resolved executable.
 * @param args The argument vector, without the executable.
 * @param env The environment the interpreter is resolved from.
 * @returns The spec to spawn.
 */
export function commandFor(path: string, args: string[], env: Env = process.env): CommandSpec {
  if (/\.(cmd|bat)$/i.test(path)) return { command: commandInterpreter(env), args: ["/d", "/c", path, ...args] }
  return { command: path, args: [...args] }
}

/**
 * The `dsh` pair, or null when nothing resolves (a lane reports DSH_MISSING then).
 * @param args The harness argument vector, without the executable.
 * @param env The environment whose PATH is scanned.
 * @returns The spec to spawn, or `null` when no launcher resolves.
 */
export function dshCommand(args: string[], env: Env = process.env): CommandSpec | null {
  // The PATH-resolved launcher, or `""` when the harness is not installed.
  const launcher = resolveDshLauncher(env)
  if (launcher === "") return null
  return commandFor(launcher, args, env)
}
