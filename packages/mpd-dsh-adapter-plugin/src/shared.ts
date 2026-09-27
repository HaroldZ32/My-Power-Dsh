// Shared, harness-free helpers for the mpd plugin rows.
//
// WHY THIS FILE EXISTS: every row needs the same four one-line utilities (a record
// guard, an Error#message reader, and the two bundle-root resolutions), and before
// this module each row carried its own COPY — nine identical `message()` bodies,
// four `isRecord()` bodies and five `bundleRoot()` bodies across the tree. A copy
// per row is how one row silently drifts (a nested-map check that also accepts an
// array, a root resolution one directory short); one implementation is checkable.
//
// WHAT DOES NOT BELONG HERE: anything that touches a harness seam. Those live in
// `./index.ts`, which is still THE one contact surface (AGENTS.md §6). This module
// imports Node built-ins only and never reads `ctx`, so importing it can never pull
// a seam, a service lookup or a side effect into a row.
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

/** A plain JSON-ish object: not null, not an array, not a primitive. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** `Error#message` for anything thrown, without ever throwing on a non-Error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The bundle root for a module that lives at `<bundle>/packages/<pkg>/{src,dist}/<file>`.
 *
 * Location-derived on purpose (no package-name resolution): it answers the checkout
 * root in a `link:` install and the installed package root in a packed install, and
 * it keeps answering correctly after `bun build`, because every entry is bundled to
 * the same `<pkg>/dist/<entry>.js` depth it was authored at.
 */
export function bundleRootOf(moduleUrl: string): string {
  return dirname(dirname(dirname(dirname(fileURLToPath(moduleUrl)))))
}
