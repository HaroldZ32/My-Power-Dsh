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

/** The actionable sentence a lane reports when no launcher resolves - never a raw ENOENT. */
export const DSH_MISSING = "no dsh launcher on PATH: install the harness (`npm install -g @deepseek-ai/dsh`) or put its bin directory on PATH"

/**
 * PATH-resolved `dsh` launcher, in-process and without a shell.
 * @param {Record<string,string|undefined>} [env] @param {string} [platform] @returns {string} "" when absent
 */
export function resolveDshLauncher(env = process.env, platform = process.platform) {
  return resolveOnPath("dsh", env, platform)
}

/** The PATH scan behind every bare name this module resolves, `dsh` included. */
export function resolveOnPath(name, env = process.env, platform = process.platform) {
  // `.cmd` first on win32: it is the shape Node can run through the interpreter, and npm writes it
  // beside the extensionless POSIX shim (which is a `#!/bin/sh` script Windows cannot execute).
  const names = platform === "win32" ? [name + ".cmd", name + ".exe", name + ".bat", name] : [name]
  for (const dir of String(env.PATH ?? "").split(platform === "win32" ? ";" : ":")) {
    if (dir === "") continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return ""
}

/**
 * The interpreter a `.cmd`/`.bat` launcher needs, as an ABSOLUTE path: a minimal child env carries
 * neither ComSpec nor System32 on PATH, and a bare `cmd.exe` then answers ENOENT.
 * @param {Record<string,string|undefined>} [env] @returns {string}
 */
export function commandInterpreter(env = process.env) {
  if (typeof env.ComSpec === "string" && env.ComSpec.length > 0) return env.ComSpec
  const root = env.SystemRoot ?? env.windir ?? "C:\\Windows"
  return join(root, "System32", "cmd.exe")
}

/**
 * The {command, args} pair to spawn for `dsh`.
 * @param {string[]} args @param {Record<string,string|undefined>} [env] @returns {{command:string, args:string[]}|null}
 */
/**
 * The harness package that owns a resolved launcher, when its layout is resolvable.
 * @param {string} launcher @returns {string} "" when it cannot be located
 */
function harnessRootNear(launcher) {
  try {
    const resolver = createRequire(join(dirname(launcher), "resolve.cjs"))
    return dirname(resolver.resolve("@deepseek-ai/dsh/package.json"))
  } catch { /* fall through to the layout walk */ }
  let dir = dirname(launcher)
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, "node_modules", "@deepseek-ai", "dsh")
    if (existsSync(join(candidate, "lib", "bin.js"))) return candidate
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
 * @param {string[]} args @param {Record<string,string|undefined>} [env]
 * @returns {{command:string, args:string[]}|null}
 */
export function dshAppSpec(args, env = process.env) {
  const launcher = resolveDshLauncher(env)
  if (launcher === "") return null
  const root = harnessRootNear(launcher)
  if (root !== "") {
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
 * @param {string} command @param {string[]} args @param {Record<string,string|undefined>} [env]
 * @returns {{command:string, args:string[]}}
 */
export function spawnSpec(command, args, env = process.env) {
  const resolved = resolveOnPath(command, env)
  if (resolved === "") return { command, args: [...args] }
  return commandFor(resolved, args, env)
}

/** The {command, args} pair for a RESOLVED path: a `.cmd`/`.bat` goes through the interpreter. */
export function commandFor(path, args, env = process.env) {
  if (/\.(cmd|bat)$/i.test(path)) return { command: commandInterpreter(env), args: ["/d", "/c", path, ...args] }
  return { command: path, args: [...args] }
}

/** The `dsh` pair, or null when nothing resolves (a lane reports DSH_MISSING then). */
export function dshCommand(args, env = process.env) {
  const launcher = resolveDshLauncher(env)
  if (launcher === "") return null
  return commandFor(launcher, args, env)
}