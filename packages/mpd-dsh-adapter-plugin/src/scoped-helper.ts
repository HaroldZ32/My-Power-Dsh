import { realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

/** Explicit, literal source paths the parent included in one helper assignment. */
export interface DshHelperFiles {
  /** The actual authorized checkout, independent of shared project state. */
  readonly checkout: string
  /** Relative file paths the child may read. */
  readonly read: readonly string[]
  /** Relative file paths the child may create or edit. */
  readonly write: readonly string[]
  /** The original assignment must still authorize the helper when it acts. */
  readonly current?: () => boolean
}

/** Identify an actual file target without granting scope through a symlink or state directory. */
export function helperTarget(checkout: string, value: string): string | undefined {
  try {
    /** Accept absolute aliases of the exact authorized checkout only after physical-root validation. */
    const root = realpathSync(checkout)
    /** Scope addresses use the same working directory as the actual child. */
    const path = resolve(root, value)
    /** The path compared to the literal helper declaration. */
    const local = relative(root, path)
    if (local === "" || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || local.split(sep).some((item) => item === ".mpd" || item === ".git")) return undefined
    /** A nonexistent file can still live below a symlink, so inspect each existing ancestor. */
    let probe = path
    while (probe !== root) {
      try {
        if (realpathSync(probe) !== probe) return undefined
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
      }
      probe = dirname(probe)
    }
    return local.split(sep).join("/")
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

/** Every offered helper tool is tied to an explicit path in its owning request. */
export function helperFileRefusal(scope: DshHelperFiles, name: unknown, args: unknown): string | undefined {
  if (name === "structured_output") return undefined
  if (scope.current?.() === false) return "The original assignment no longer authorizes this helper."
  /** Every offered file tool uses the same validated path parameter. */
  const path = typeof args === "object" && args !== null && "file_path" in args && typeof args.file_path === "string" ? helperTarget(scope.checkout, args.file_path) : undefined
  /** Read access includes the helper's explicitly writable files. */
  const allowed = path !== undefined && (name === "read" ? scope.read.includes(path) || scope.write.includes(path) : (name === "write" || name === "edit") && scope.write.includes(path))
  return allowed ? undefined : "This one-shot can use only the exact file tools and paths its owner delegated."
}
