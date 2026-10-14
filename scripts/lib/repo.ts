// Shared primitives for the repository's own scripts.
//
// WHY THIS FILE EXISTS: every gate/helper script starts by locating the repository root,
// and before this module ten of them each spelled the same two-level `dirname` walk
// (`const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))`) — plus two more
// that wrote the same thing as `join(dirname(...), "..")`. Twenty-eight call sites across
// fourteen scripts also spelled `JSON.parse(readFileSync(...))` by hand. Both are the same
// decision made over and over: one definition means the root is resolved identically
// everywhere and a script moved one directory deeper cannot silently resolve to the wrong
// root or read a file with a half-stated encoding.
//
// WHAT DELIBERATELY DOES NOT LIVE HERE: the vendored-corpus fingerprint helpers. The ONE rule that
// decides which files an asset ships (tracked-file enumeration with a filesystem-walk fallback) and
// the LF-normalizing reader live in the SIBLING module `scripts/lib/asset-files.ts`, imported by BOTH
// `scripts/verify-vendor.ts` and `scripts/repin-vendor.ts`, because two private copies of that rule
// are exactly what let the two sides drift (measured 2026-10-09: the working-tree walk pinned a
// 373-file corpus while CI counted 371, so the lock could never reproduce). The TREE FOLD stays
// mirrored in `scripts/repin-vendor.ts` on purpose and is re-checked against the authority's own bytes
// (`assertAuthorityShape()`, token lists `AUTHORITY_MARKERS` / `SHARED_TOKENS` / `AUTHORITY_TOKENS`), so
// the mirror keeps a falsifiable guard; each script's flag table and exit-code map stay local too,
// because those are per-command contracts rather than shared logic. What belongs HERE is only the
// primitive every script needs whatever its subject: the repository root and one JSON reading shape.
import { readFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

/** The repository root, derived from a script that lives in `<root>/scripts/`. */
export function repoRootFrom(moduleUrl: string | URL): string {
  return dirname(dirname(fileURLToPath(moduleUrl)))
}

/**
 * Parse one JSON file (UTF-8). The single reading shape the scripts share.
 *
 * `T` is the caller's declaration of the document's shape: the compiler cannot know what a
 * file on disk holds, so the caller names the interface it expects (or narrows the returned
 * `unknown` itself). The one cast below is that boundary and nothing more.
 */
export function readJson<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T
}
