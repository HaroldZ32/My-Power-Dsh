/** Exact path segments reserved for local state and developer dependencies. */
const PRIVATE_SEGMENTS: ReadonlySet<string> = new Set([
  ".mpd", ".mpd-dsh", ".dsh", ".codegraph", ".npm-cache", ".toolchain", ".dsh-go-kit", ".bun-tmp",
  ".research", ".sim_build", ".git-home", ".tmp-cache", ".cg-qa", "_deps", "node_modules",
  "__pycache__", ".credentials.yaml",
])

/** Directory name families used by local QA, review tools, and virtual environments. */
const PRIVATE_PREFIXES = [".review-tmp", ".qa-", ".tmp-", ".venv"] as const

/** npm exclusions for the generated manifest, following its public inclusion patterns. */
export const PACK_PRIVATE_EXCLUDES: readonly string[] = [
  ...Array.from(PRIVATE_SEGMENTS, (name: string): string => `!**/${name}`),
  ...PRIVATE_PREFIXES.map((prefix): string => `!**/${prefix}*`),
]

/** Test a relative path at any depth, including paths passed to the copy filter before traversal. */
export function isPrivatePackPath(path: string): boolean {
  return path.split(/[/\\]/).some((segment): boolean =>
    PRIVATE_SEGMENTS.has(segment) || PRIVATE_PREFIXES.some((prefix): boolean => segment.startsWith(prefix)),
  )
}
