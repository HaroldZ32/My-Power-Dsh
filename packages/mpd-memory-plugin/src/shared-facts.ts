import { mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { exactMemoryKey, hasFsCode, memoryKeyPart, previewText, ProjectMemoryError, publishMemory } from "./project-scope.ts"
import { appendJournalLine, commitAll, ensureStoreDirs, parseFrontmatter, type CommitReceipt, type Config, type StoreDirs } from "./store"

/** One persisted shared project fact and the provenance needed to decide whether it applies. */
interface SharedFact {
  /** Exact case-sensitive lookup key. */
  readonly key: string
  /** Human-readable title of this revision. */
  readonly description: string
  /** Shared memory admits verified or attributed claims with explicit provenance. */
  readonly kind: "fact"
  /** Evidence or interface reference supplied by the publishing member. */
  readonly source: string
  /** Exact version, task, or interface label under which this claim applies. */
  readonly appliesTo: string
  /** Monotonically increasing revision for this key, starting at 1. */
  readonly revision: number
  /** Prior revision explicitly acknowledged by the writer. */
  readonly supersedes: number | null
  /** Authenticated durable roster member who published this revision. */
  readonly author: string
  /** The time the written record was constructed, in ISO 8601 UTC. */
  readonly recordedAt: string
}

/** Validate a required text field without allowing its rendered metadata to grow unbounded. */
function field(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ProjectMemoryError(name + " must be nonblank single-line text of at most " + max + " characters")
  }
  return value
}

/** Shared reads and revision preconditions accept only positive safe integer revisions. */
function revisionOf(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new ProjectMemoryError(name + " must be a positive safe integer")
  }
  return value
}

/** Canonical full-width decimal name, where lexical order equals revision order. */
function revisionFile(revision: number): string {
  return String(revision).padStart(16, "0") + ".md"
}

/** Find the current immutable revision for this exact key with no fallback to another collection. */
function latestRevision(dir: string): number {
  try {
    /** Each publication is one immutable regular file. Ignore unrelated files and links. */
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[0-9]{16}\.md$/u.test(entry.name))
      .map((entry) => entry.name).sort()
    /** The highest file name is the only active revision. */
    const latest = names.at(-1)
    if (latest === undefined) return 0
    return revisionOf(Number(latest.slice(0, -3)), "stored revision") ?? 0
  } catch (error) {
    if (hasFsCode(error, "ENOENT")) return 0
    throw error
  }
}

/** Publish a sourced fact only when the writer acknowledges the current revision of its exact key. */
export function writeSharedFact(config: Config, d: StoreDirs, author: string, args: Readonly<Record<string, unknown>>): CommitReceipt & {
  file: string; scope: "shared"; vcs: string; reflectionDue: false; revision: number
} {
  /** One exact key, used only through its digest as a directory component. */
  const key = exactMemoryKey(args.key)
  /** Introduction is allowed only for a key with no revision, otherwise the caller names the predecessor. */
  const supersedes = revisionOf(args.supersedes, "supersedes")
  if (args.kind !== undefined && args.kind !== "fact") throw new ProjectMemoryError("shared memory accepts only kind fact")
  if (typeof args.content !== "string" || args.content.trim() === "") throw new ProjectMemoryError("shared fact content is required")
  /** The immutable file history for this exact key. */
  const dir = join(d.memoryDir, memoryKeyPart(key))
  /** A conflict leaves the current fact untouched, even if two different processes checked it. */
  const current = latestRevision(dir)
  if ((supersedes ?? 0) !== current || current === Number.MAX_SAFE_INTEGER) {
    throw new ProjectMemoryError("shared fact revision conflict: current revision is " + (current || "absent"))
  }
  /** Complete revision metadata, with actor supplied only by the project identity service. */
  const fact: SharedFact = {
    key, description: field(args.description ?? args.title, "title", 160), kind: "fact",
    source: field(args.source, "source", 256), appliesTo: field(args.appliesTo, "appliesTo", 160),
    revision: current + 1, supersedes: supersedes ?? null, author, recordedAt: new Date().toISOString(),
  }
  ensureStoreDirs(d)
  mkdirSync(dir, { recursive: true })
  /** The immutable fact revision, staged outside the VCS work tree until it is complete. */
  const file = join(dir, revisionFile(fact.revision))
  publishMemory(file, "---\n" + JSON.stringify(fact) + "\n---\n" + args.content, true, d.runtime)
  /** Each backend's status stays visible as in the existing memory write tool. */
  const receipt = commitAll(config, d, file, "memory: project fact " + memoryKeyPart(key).slice(0, 12) + " r" + fact.revision)
  appendJournalLine(d, "shared-fact", { key, revision: fact.revision, supersedes: fact.supersedes, author })
  /** Active VCS mode, with the corresponding backend names. */
  const vcs = config.vcs ?? "git"
  return { file, scope: "shared", vcs, ...receipt, reflectionDue: false, revision: fact.revision }
}

/** Read status describes why a shared fact is usable or why its content was withheld. */
export type FactValidity = "current" | "missing" | "superseded" | "not-applicable" | "revision-mismatch"

/** A current sourced revision as returned by the normal memory read path. */
type SharedFactPreview = SharedFact & { readonly content: string; readonly truncated: boolean }

/** One exact shared recall never serves historical or nonmatching content as current guidance. */
export function readSharedFact(d: StoreDirs, args: Readonly<Record<string, unknown>>): {
  scope: "shared"; validity: FactValidity; revision?: number; entries: readonly SharedFactPreview[];
  count: number; offset: 0; returned: number; next_offset: null
} {
  /** The exact key and the optional expected revision or applicability. */
  const key = exactMemoryKey(args.key)
  /** An absent revision requests the current fact. */
  const expected = revisionOf(args.revision, "revision")
  /** An absent applicability leaves the stored applicability visible so the caller can compare it. */
  const appliesTo = args.appliesTo === undefined ? undefined : field(args.appliesTo, "appliesTo", 160)
  /** Each key keeps a separate history, so lookup never scans unrelated facts. */
  const dir = join(d.memoryDir, memoryKeyPart(key))
  /** The newest revision visible at the start of this read. */
  const current = latestRevision(dir)
  /** Common page shape accepted by the existing memory result renderer. */
  const empty = { scope: "shared" as const, entries: [], count: 0, offset: 0 as const, returned: 0, next_offset: null }
  if (current === 0) return { ...empty, validity: "missing" }
  if (expected !== undefined && expected !== current) {
    return { ...empty, validity: expected < current ? "superseded" : "revision-mismatch", revision: current }
  }
  /** Current record only, read by its immutable file name. */
  const { meta, body } = parseFrontmatter(join(dir, revisionFile(current)))
  if (meta?.key !== key || meta.kind !== "fact" || meta.revision !== current || meta.supersedes !== (current === 1 ? null : current - 1)) {
    throw new ProjectMemoryError("shared fact revision metadata is invalid")
  }
  /** Only valid metadata fields may flow into the tool response. */
  const fact: SharedFact = {
    key, kind: "fact", revision: current, supersedes: current === 1 ? null : current - 1,
    description: field(meta.description, "stored title", 160), source: field(meta.source, "stored source", 256),
    appliesTo: field(meta.appliesTo, "stored applicability", 160), author: field(meta.author, "stored author", 120),
    recordedAt: field(meta.recordedAt, "stored time", 40),
  }
  if (appliesTo !== undefined && fact.appliesTo !== appliesTo) return { ...empty, validity: "not-applicable", revision: current }
  /** A preview preserves the source metadata and signals omitted text. */
  const content = previewText(body, 768)
  return { ...empty, validity: "current", revision: current, count: 1, returned: 1, entries: [{ ...fact, content, truncated: content.length !== body.length }] }
}
