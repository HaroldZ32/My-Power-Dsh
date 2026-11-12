// Path, slug and workspace-boundary rules for the mpd-worktree row.
//
// D2 is the rule this file exists to enforce: a member's sandbox fence is the PARENT workspace, so a
// worktree outside that root is unwritable by the member. Every path decision therefore ends in
// {@link isUnderRoot}, and the refusal quotes D2 instead of a bare "invalid path".
import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

/** The name grammar `mpd_worktree_create` accepts for a new worktree. */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/

/**
 * Whether a caller-supplied name is a legal worktree name.
 * @param name the candidate name.
 * @returns true when it matches {@link NAME_PATTERN}.
 */
export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name)
}

/**
 * Canonicalises a path that may not exist yet: the deepest EXISTING ancestor is realpath-resolved and
 * the missing tail is re-appended unchanged, so a symlinked ancestor cannot smuggle the target out of
 * the workspace. Resolving only the literal string would let `<ws>/.mpd/worktrees` be a symlink to
 * `/tmp` and pass a naive prefix check.
 * @param target the path to canonicalise.
 * @returns the canonical absolute path.
 */
export function canonicalPath(target: string): string {
  /** The absolute form, so every later join and comparison works on one shape. */
  let probe = resolve(target)
  /** The missing tail segments, outermost last, re-appended in order after the real ancestor. */
  const tail: string[] = []
  while (!existsSync(probe)) {
    /** The parent of the current probe; a root probe is its own parent, which ends the walk. */
    const parent = dirname(probe)
    if (parent === probe) return resolve(target)
    tail.unshift(basename(probe))
    probe = parent
  }
  /** The real path of the deepest existing ancestor. */
  const real = realpathSync(probe)
  return tail.length === 0 ? real : join(real, ...tail)
}

/**
 * Whether `target` is the workspace root or sits under it — the D2 boundary.
 * @param root the workspace root.
 * @param target the candidate worktree path.
 * @returns true when the canonical target is the root itself or one of its descendants.
 */
export function isUnderRoot(root: string, target: string): boolean {
  /** The canonical workspace root, computed per answer because a workspace can be re-pointed. */
  const base = canonicalPath(root)
  /** The canonical candidate path. */
  const path = canonicalPath(target)
  /** The candidate relative to the root; "" is the root itself and ".." is outside. */
  const rel = relative(base, path)
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
}

/**
 * Converts a display name (a team id or a roster member name such as "Senior Engineer") into the
 * single path/branch segment the D2/D3 layout uses.
 * @param raw the display name.
 * @returns a lowercase `[a-z0-9._-]` segment that always starts with an alphanumeric character.
 */
export function slugify(raw: string): string {
  /** Lowercase, every illegal run collapsed to one dash, a legal first character, no trailing dash. */
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 80)
  return slug === "" ? "member" : slug
}
