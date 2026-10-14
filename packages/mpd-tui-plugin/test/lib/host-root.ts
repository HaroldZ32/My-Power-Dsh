// The installed DSH-TUI package root, resolved PORTABLY for every host-backed sidebar arm.
//
// WHY THIS EXISTS (WIN32 DEFECT, REPRODUCED 2026-10-12). Every host-backed panel arm in this
// repository used to resolve the host root the same POSIX-only way:
//
//   Bun.which("dsh-tui") -> `readlink -f` -> dirname(dirname(real))
//
// which assumes the POSIX install layout `<root>/bin/dsh-tui.js` behind a symlink. On win32 the
// launcher is a shim — `%APPDATA%\npm\dsh-tui.ps1` / `dsh-tui.cmd` — so `dirname(dirname(shim))` is
// `%APPDATA%\Roaming`, and `join(HOST, "lib", "types", "tuiDisplayPrefs.js")` became
// `C:\Users\<u>\AppData\Roaming\lib\types\tuiDisplayPrefs.js`. MEASURED on this machine:
// `bun test packages/mpd-tui-plugin/test/panel-visibility.test.ts` exited 1 with `0 pass` and
// `error: Cannot find module '...\Roaming\lib\types\tuiDisplayPrefs.js'`. The whole host-backed
// sidebar lane was therefore DEAD on Windows — and a dead lane cannot redden on a Windows
// regression, which is exactly the state the Windows sidebar defect was reported from.
//
// The resolution validates a candidate by the host files it must carry, and tries in order:
//   1. the POSIX symlink resolution (`readlink -f`), which is what a pnpm/npm install ON POSIX needs
//      (its global bin lives outside any `node_modules` an upward walk from `/usr/local/bin` reaches);
//   2. a walk UP from the launcher's own directory looking for `node_modules/@deepseek-harness-tui/dsh-tui`
//      — the shape a win32 shim in the global prefix and a POSIX `node_modules/.bin` shim both resolve
//      through.
// An unresolvable launcher THROWS, naming every path it tried: a skip would be a vacuous pass on the
// one clause these arms exist for.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

/** The host package path below a `node_modules` root. */
const HOST_PACKAGE_SEGMENTS: readonly string[] = ["@deepseek-harness-tui", "dsh-tui"]

/** A file every usable host package carries: the probe a candidate must pass to be accepted. */
const HOST_PROBE_FILE = join("lib", "types", "tuiDisplayPrefs.js")

/** How many directories the upward walk from the launcher may climb before giving up. */
const HOST_WALK_LEVELS = 8

/**
 * Whether one candidate directory really is an installed `@deepseek-harness-tui/dsh-tui` package.
 * @param dir - the candidate package root.
 * @returns true when the host's display-preferences module is present below it.
 */
function isHostPackage(dir: string): boolean {
  return existsSync(join(dir, HOST_PROBE_FILE))
}

/**
 * The installed host package root behind one `dsh-tui` launcher path.
 * @param launcher - the launcher `Bun.which("dsh-tui")` answered, shim or symlink.
 * @returns the host package's absolute root directory.
 * @throws when neither resolution finds a candidate carrying the host's own files.
 */
export function installedHostRoot(launcher: string): string {
  /** Every candidate root, in probe order: the symlink target first, then the upward walk. */
  const candidates: string[] = []
  // 1. The POSIX symlink resolution. A platform without `readlink` (or a shim that is not a link)
  //    simply contributes nothing here — the walk below still covers the install.
  try {
    /** The launcher's real path, or an empty string when this platform cannot resolve one. */
    const real = Bun.spawnSync(["readlink", "-f", launcher]).stdout.toString().trim()
    if (real !== "") candidates.push(dirname(dirname(real)))
  } catch {
    // No `readlink` on this platform: the upward walk is the remaining resolution.
  }
  // 2. The upward walk from the launcher's own directory: `<prefix>/node_modules/@deepseek-harness-tui/dsh-tui`.
  /** The directory this walk is at, moved one level up per iteration. */
  let dir = dirname(launcher)
  for (let level = 0; level < HOST_WALK_LEVELS; level += 1) {
    candidates.push(join(dir, "node_modules", ...HOST_PACKAGE_SEGMENTS))
    /** The parent directory; equal to `dir` at the filesystem root, which ends the walk. */
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  /** Every candidate that was tried and rejected, for the throw's message. */
  const tried: string[] = []
  for (const candidate of candidates) {
    if (isHostPackage(candidate)) return candidate
    tried.push(candidate)
  }
  throw new Error(`dsh-tui launcher ${launcher}: no @deepseek-harness-tui/dsh-tui package carrying ${HOST_PROBE_FILE} at ${tried.join(", ")}`)
}
