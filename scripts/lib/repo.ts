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
// WHAT DELIBERATELY DOES NOT LIVE HERE: the vendored-corpus fingerprint helpers
// (`readBytes` / `listFiles` / the tree fold). `scripts/repin-vendor.mjs` MIRRORS the
// algorithm in `scripts/verify-vendor.mjs` and re-checks that mirror against the
// authority's own bytes (`assertAuthorityShape()`, token list `AUTHORITY_TOKENS`), so
// hoisting those bodies into a shared module would break the check that exists to keep
// the two implementations from drifting. That duplication is a contract, not an
// oversight — and the same reasoning keeps each script's flag table and exit-code map
// local, because those are per-command contracts rather than shared logic.
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
