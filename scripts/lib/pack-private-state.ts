/** Exact path segments reserved for local state and developer dependencies. */
const PRIVATE_SEGMENTS: ReadonlySet<string> = new Set([
  ".mpd", ".mpd-dsh", ".dsh", ".codegraph", ".npm-cache", ".toolchain", ".dsh-go-kit", ".bun-tmp",
  ".research", ".sim_build", ".git-home", ".tmp-cache", ".cg-qa", "_deps", "node_modules",
  "__pycache__", ".credentials.yaml",
])

/** Directory name families used by local QA, review tools, and virtual environments. */
const PRIVATE_PREFIXES = [".review-tmp", ".qa-", ".tmp-", ".venv"] as const

/** Operator references that may exist locally under the shipped skills tree. */
const PRIVATE_PATHS: ReadonlySet<string> = new Set([
  "skills/frontend/references/design/ambience-skill.md",
  "skills/frontend/references/design/component-catalogs.md",
])

/** npm exclusions, following the public inclusion patterns. */
export const PACK_PRIVATE_EXCLUDES: readonly string[] = [
  ...Array.from(PRIVATE_SEGMENTS, (name: string): string => `!**/${name}`),
  ...PRIVATE_PREFIXES.map((prefix): string => `!**/${prefix}*`),
  ...Array.from(PRIVATE_PATHS, (path): string => `!${path}`),
]

/**
 * Identify private paths before the packer copies or traverses them.
 * @param path Package-relative path in native or npm spelling.
 * @returns Whether the path is reserved for local use.
 */
export function isPrivatePackPath(path: string): boolean {
  /** Segments in native or npm path spelling. */
  const segments = path.split(/[/\\]/)
  return PRIVATE_PATHS.has(segments.join("/")) || segments.some((segment): boolean =>
    PRIVATE_SEGMENTS.has(segment) || PRIVATE_PREFIXES.some((prefix): boolean => segment.startsWith(prefix)),
  )
}
