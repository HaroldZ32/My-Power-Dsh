// mpd-worktree-plugin config: the row knobs, their documented defaults, and the OPTIONAL
// `<ws>/.mpd/mpd.jsonc` `worktree.*` override read through the composed `mpdConfig` service.
// Without that service the row config is authoritative (the documented row-config-only bound).

/** The row config as `cordis.patch.yml` hands it in; every key is optional and defaulted by {@link resolveConfig}. */
export type Config = {
  /** Kill switch: `false` registers no tools and provides no service (default true). */
  enabled?: boolean
  /** Worktree parent directory; a relative path resolves against the calling workspace (default `<ws>/.mpd/worktrees`). */
  dir?: string
  /** Repository the row operates on; the default is the workspace root, accepted only when it is a git repository. */
  repo?: string
  /** Base ref/commit a new worktree branch starts from; the default is the main checkout's current HEAD. */
  base?: string
  /** Prefix every default branch name carries (default `agent/`). */
  branchPrefix?: string
  /** Branches `mpd_worktree_merge` refuses as a target unless `force: true` (default `["master","dev"]`). */
  protectedBranches?: string[]
  /** Cap on simultaneously ACTIVE worktrees (default 32). */
  max?: number
}

/** The config with every row default applied; `dir`/`repo`/`base` stay undefined so their defaults can follow the CALLING workspace. */
export interface ResolvedConfig {
  /** Whether the row is switched on; `false` registers nothing. */
  enabled: boolean
  /** The configured worktree parent directory, or undefined for `<ws>/.mpd/worktrees`. */
  dir: string | undefined
  /** The configured repository, or undefined for the workspace root. */
  repo: string | undefined
  /** The configured base ref, or undefined for the main checkout's current HEAD. */
  base: string | undefined
  /** The branch prefix every default branch name carries. */
  branchPrefix: string
  /** Branches a merge refuses as a target unless forced. */
  protectedBranches: string[]
  /** The cap on simultaneously active worktrees. */
  max: number
}

/** The protected branches a merge refuses by default: the repository's release and integration lines. */
export const DEFAULT_PROTECTED_BRANCHES: readonly string[] = ["master", "dev"]

/** The prefix every default branch name carries (`agent/<name>`). */
export const DEFAULT_BRANCH_PREFIX = "agent/"

/** The default cap on simultaneously active worktrees. */
export const DEFAULT_MAX = 32

/**
 * Trims a string leaf and treats a blank value as absent.
 * @param value the candidate leaf, of unknown type because row config is unvalidated input.
 * @returns the trimmed string, or undefined when absent or blank.
 */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  /** The trimmed value, which is the shape every path and branch decision uses. */
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

/**
 * Applies the documented row defaults to a partial config.
 * @param config the row config handed to `apply`; every key is optional.
 * @returns the resolved config, with the workspace-relative keys left undefined when unset.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  /** The configured cap, floored to a positive integer so a corrupt value cannot disable creation. */
  const max = typeof config.max === "number" && Number.isFinite(config.max) && config.max > 0 ? Math.floor(config.max) : DEFAULT_MAX
  /** The configured branch prefix, or the default when absent or blank. */
  const prefix = nonEmpty(config.branchPrefix) ?? DEFAULT_BRANCH_PREFIX
  /** The configured protected list, filtered to real strings; absent keeps the default pair. */
  const protectedBranches = Array.isArray(config.protectedBranches)
    ? config.protectedBranches.filter((branch): branch is string => typeof branch === "string" && branch.trim() !== "")
    : [...DEFAULT_PROTECTED_BRANCHES]
  return {
    enabled: config.enabled !== false,
    dir: nonEmpty(config.dir),
    repo: nonEmpty(config.repo),
    base: nonEmpty(config.base),
    branchPrefix: prefix,
    protectedBranches,
    max,
  }
}

/**
 * Merges the workspace `.mpd/mpd.jsonc` `worktree.*` leaves over the row config (the file wins per key).
 *
 * The established helper is the composed `mpdConfig` service: its keyed read walks the RAW merged file
 * layers, so a `worktree` section answers without a declaration in `mpd-config`'s schema (the same
 * accepted pattern `mpd-hashline` uses for `hashline.*`). When the service is absent this row is
 * ROW-CONFIG-ONLY, which the README states as a bound rather than hiding as a fallback.
 * @param ctx the cordis context `apply` received; only its optional service lookup is read.
 * @param config the row config.
 * @returns the effective config.
 */
export function effectiveConfig(ctx: unknown, config: Config): ResolvedConfig {
  /** The composed config service, present only when `mpd-config-plugin` is mounted in this composition. */
  const service = (ctx as { get?: (key: string) => unknown } | undefined)?.get?.("mpdConfig") as { get: (key?: string) => unknown } | undefined
  if (service === undefined || typeof service.get !== "function") return resolveConfig(config)
  /** One dotted `worktree.*` leaf; the service declares no value type, so the answer stays unknown. */
  const leaf = (key: string): unknown => {
    try {
      return service.get("worktree." + key)
    } catch {
      return undefined
    }
  }
  /** The row config with the file leaves layered over it, one key at a time. */
  const merged: Config = {
    ...config,
    enabled: typeof leaf("enabled") === "boolean" ? (leaf("enabled") as boolean) : config.enabled,
    dir: typeof leaf("dir") === "string" ? (leaf("dir") as string) : config.dir,
    repo: typeof leaf("repo") === "string" ? (leaf("repo") as string) : config.repo,
    base: typeof leaf("base") === "string" ? (leaf("base") as string) : config.base,
    branchPrefix: typeof leaf("branchPrefix") === "string" ? (leaf("branchPrefix") as string) : config.branchPrefix,
    protectedBranches: Array.isArray(leaf("protectedBranches")) ? (leaf("protectedBranches") as string[]) : config.protectedBranches,
    max: typeof leaf("max") === "number" ? (leaf("max") as number) : config.max,
  }
  return resolveConfig(merged)
}
