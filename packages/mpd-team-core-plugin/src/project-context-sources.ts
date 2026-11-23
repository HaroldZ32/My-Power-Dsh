import { createHash } from "node:crypto"
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type { ContextFragment, ContextStructure } from "./project-context-view"

/** Bind exact file reads to the caller's checkout and refuse metadata paths and globs. */
function pathWithin(root: string, path: string): string | undefined {
  if (path.length > 110 || isAbsolute(path) || /[\u0000-\u001f*?{}[\]]/u.test(path)) return undefined
  /** Treat either platform's separators as delimiters before rejecting hidden and escaping segments. */
  const segments = path.split(/[\\/]/u)
  if (segments.some((segment) => segment === "" || segment.startsWith(".") || segment.includes(":"))) return undefined
  /** Resolve the declared file without following a link out of the assigned checkout. */
  const target = resolve(root, path)
  /** A lexical check complements the real path comparison at the read boundary. */
  const local = relative(root, target)
  return local !== "" && local !== ".." && !local.startsWith(".." + sep) && !isAbsolute(local) && realpathSync(target) === target ? target : undefined
}

/** The bytes observed at a stable regular file path and their decodable text. */
interface SourceRead {
  /** Exact bytes before decoding. */
  readonly bytes: Buffer
  /** Decoded non-binary content. */
  readonly text: string
}

/** Read one stable, bounded regular file; an absent, unreadable, replaced or binary source is a miss. */
function readSource(root: string, path: string, limit: number, full: boolean): SourceRead | undefined {
  try {
    /** Hidden and symlinked scopes are kept out of automatic prompt projection. */
    const target = pathWithin(root, path)
    if (target === undefined || !lstatSync(target).isFile()) return undefined
    /** A final-component link or FIFO replacement cannot redirect or block the read. */
    const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      /** Opened inode and revision facts before reading the content. */
      const before = fstatSync(fd, { bigint: true })
      if (!before.isFile() || before.size === 0n || (full && before.size > BigInt(limit))) return undefined
      /** The read cannot allocate beyond the requested cap. */
      const buffer = Buffer.alloc(limit)
      /** The exact returned prefix, without scratch padding. */
      const bytes = buffer.subarray(0, readSync(fd, buffer, 0, limit, 0))
      /** Reconfirm the same pathname and inode revision after the read. */
      const after = lstatSync(target, { bigint: true })
      if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || (full && BigInt(bytes.length) !== after.size) || realpathSync(target) !== target || bytes.includes(0)) return undefined
      /** A clipped UTF-8 prefix may end before the final character, but earlier binary data is rejected. */
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: BigInt(bytes.length) < after.size })
      return { bytes, text }
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

/** Derive module/interface labels from a bounded actual package manifest, with its exact byte hash. */
export function readContextStructure(root: string): ContextStructure | undefined {
  /** The project manifest is metadata only; arbitrary source content never enters this summary. */
  const source = readSource(root, "package.json", 16 * 1024, true)
  if (source === undefined) return undefined
  try {
    /** Only known manifest metadata participates in the summary. */
    const manifest: unknown = JSON.parse(source.text)
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return undefined
    /** Selected actual package or module interface keys. */
    const fields: string[] = []
    if ("name" in manifest && typeof manifest.name === "string") fields.push(`name=${manifest.name.slice(0, 64)}`)
    if ("type" in manifest && (manifest.type === "module" || manifest.type === "commonjs")) fields.push(`type=${manifest.type}`)
    if ("exports" in manifest && typeof manifest.exports === "object" && manifest.exports !== null && !Array.isArray(manifest.exports)) {
      /** Export subpaths identify actual package interfaces, without reading their targets. */
      const keys = Object.keys(manifest.exports).filter((key) => key.startsWith(".")).slice(0, 4).map((key) => key.slice(0, 36))
      if (keys.length > 0) fields.push(`exports=${keys.join(", ")}`)
    } else if ("exports" in manifest && typeof manifest.exports === "string") fields.push("exports=.")
    if (fields.length === 0) return undefined
    return { path: "package.json", summary: fields.join("; "), sha256: createHash("sha256").update(source.bytes).digest("hex") }
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Select one short slice from an exact declared file in a worker's actual checkout. */
export function readContextFragment(root: string, scopes: readonly string[]): ContextFragment | undefined {
  for (const path of scopes.slice(0, 8)) {
    /** The first safe regular text file in declared order supplies the fragment. */
    const source = readSource(root, path, 440, false)
    if (source === undefined || source.text.trim() === "") continue
    return { path, bytes: source.bytes.length, prefixSha256: createHash("sha256").update(source.bytes).digest("hex"), text: source.text }
  }
  return undefined
}
