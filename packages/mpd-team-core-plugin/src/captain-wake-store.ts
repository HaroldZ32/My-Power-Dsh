import { createHash, randomUUID } from "node:crypto"
import { linkSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { teamRoot } from "./team-store"

/** A durable condition evaluated only against the binding's board or mailbox. */
export type WakeCondition =
  | { readonly kind: "tasks"; readonly ids: readonly string[]; readonly mode: "all" | "any" }
  | { readonly kind: "mail"; readonly fromMember?: string; readonly after: string | null }

/** The original host session that owns a set of registrations. */
export interface WakeScope {
  /** The absolute workspace observed on the live session. */
  readonly workspace: string
  /** The exact session that can inspect, cancel or receive this wake. */
  readonly sessionId: string
}

/** One successful match as of evaluation, with identifiers only. */
export interface WakeMatch {
  /** Terminal status by requested task ID, when the condition is on the board. */
  readonly tasks?: Readonly<Record<string, "completed" | "failed" | "cancelled">>
  /** The first applicable durable mailbox message, when waiting for mail. */
  readonly messageId?: string
}

/** The immutable registration created before a turn can be submitted. */
export interface WakeRegistration {
  /** Correlation marker used in the public tool and host turn source. */
  readonly id: string
  /** The sequence number for this session's exclusive registration slot. */
  readonly sequence: number
  /** Authoritative board ID on the workspace. */
  readonly teamId: string
  /** The exact registering session, checked against the directory binding on reads. */
  readonly sessionId: string
  /** The predicate the captain chose. */
  readonly condition: WakeCondition
  /** A match seen at arm time requires no later turn. */
  readonly immediate?: WakeMatch
  /** UTC instant this registration was saved. */
  readonly armedAt: string
}

/** A single exclusive choice fences cancellation against host delivery. */
export type WakeDecision =
  | { readonly kind: "submit"; readonly match: WakeMatch }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly reason: string }

/** Host acceptance receipt, written only after the adapter returns. */
export interface WakeReceipt {
  /** True means the host accepted the next-turn submission. */
  readonly accepted: boolean
}

/** Obtain the filesystem error code without assuming all thrown values are errors. */
function errno(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined
}

/** Place receipts under the same workspace as the board, using a path-safe session key. */
function directory(scope: WakeScope): string {
  /** A collision-resistant key keeps arbitrary host session IDs out of paths. */
  const key = createHash("sha256").update(scope.sessionId).digest("hex")
  return join(teamRoot(scope.workspace), "wakes", key)
}

/** Read an absent file as undefined; a torn or otherwise invalid write must fail closed. */
function readOptional<T>(path: string): T | undefined {
  try {
    // These JSON records are private to this store. The path's identity is checked by the caller.
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch (error) {
    if (errno(error) === "ENOENT") return undefined
    throw error
  }
}

/** Reserve one file permanently; a concurrent writer can only observe the existing reservation. */
function writeExclusive(path: string, value: unknown): boolean {
  try {
    writeFileSync(path, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true })
    return true
  } catch (error) {
    if (errno(error) === "EEXIST") return false
    throw error
  }
}

/** The records in descending sequence, with history reads bounded by the caller. */
export function readWakeHistory(scope: WakeScope, limit: number): WakeRegistration[] {
  /** Directory entries are only considered when they name a positive sequence slot. */
  let entries: string[]
  try {
    entries = readdirSync(directory(scope))
  } catch (error) {
    if (errno(error) === "ENOENT") return []
    throw error
  }
  return entries.flatMap((file) => /^[1-9]\d*\.json$/u.test(file) ? [Number.parseInt(file, 10)] : [])
    .sort((a, b) => b - a).slice(0, limit).flatMap((sequence) => {
      /** Trust only a record that belongs to this path's original session and sequence. */
      const record = readOptional<WakeRegistration>(join(directory(scope), `${sequence}.json`))
      if (record === undefined || record.sessionId !== scope.sessionId || record.sequence !== sequence) {
        throw new Error(`invalid captain wake registration at sequence ${sequence}`)
      }
      return [record]
    })
}

/** Publish the next registration as a compare-and-set on its sequence slot. */
export function createWake(scope: WakeScope, sequence: number, input: Pick<WakeRegistration, "teamId" | "condition" | "immediate" | "armedAt">): WakeRegistration | undefined {
  mkdirSync(directory(scope), { recursive: true, mode: 0o700 })
  /** Every new registration gets its own correlation ID independent of the file layout. */
  const record: WakeRegistration = { ...input, id: randomUUID(), sequence, sessionId: scope.sessionId }
  return publishExclusive(scope, `${sequence}.json`, record) ? record : undefined
}

/** Write privately first so other processes never read a partially published fact. */
function publishExclusive(scope: WakeScope, name: string, value: unknown): boolean {
  /** The scratch file is unique and shares the destination filesystem. */
  const temporary = join(directory(scope), `${randomUUID()}.tmp`)
  if (!writeExclusive(temporary, value)) throw new Error("could not reserve a wake state scratch file")
  try {
    linkSync(temporary, join(directory(scope), name))
    return true
  } catch (error) {
    if (errno(error) === "EEXIST") return false
    throw error
  } finally {
    unlinkSync(temporary)
  }
}

/** Keep the first observation of a match even if the captain is busy or the row reloads. */
export function rememberWakeMatch(scope: WakeScope, record: WakeRegistration, match: WakeMatch): WakeMatch {
  return publishExclusive(scope, `${record.sequence}.ready`, match) ? match : readWakeMatch(scope, record) ?? match
}

/** Read a first match without confusing it with acceptance of a delivery. */
export function readWakeMatch(scope: WakeScope, record: WakeRegistration): WakeMatch | undefined {
  return readOptional<WakeMatch>(join(directory(scope), `${record.sequence}.ready`))
}

/** A write is confirmed only for the caller that won the exclusive decision file. */
export function decideWake(scope: WakeScope, record: WakeRegistration, decision: WakeDecision): boolean {
  return writeExclusive(join(directory(scope), `${record.sequence}.decision`), decision)
}

/** A missing decision means pending. A torn decision reserves the attempt without confirming it. */
export function readWakeDecision(scope: WakeScope, record: WakeRegistration): WakeDecision | "unknown" | undefined {
  try {
    /** The one result that won the exclusive decision slot. */
    const decision = readOptional<WakeDecision>(join(directory(scope), `${record.sequence}.decision`))
    if (decision === undefined || decision.kind === "submit" || decision.kind === "cancelled" || decision.kind === "failed") return decision
    return "unknown"
  } catch (error) {
    if (error instanceof SyntaxError) return "unknown"
    throw error
  }
}

/** Record the host return value separately from the exclusive submission decision. */
export function finishWake(scope: WakeScope, record: WakeRegistration, accepted: boolean): void {
  writeExclusive(join(directory(scope), `${record.sequence}.receipt`), { accepted })
}

/** Missing or torn acknowledgement leaves the decided delivery explicitly unknown. */
export function readWakeReceipt(scope: WakeScope, record: WakeRegistration): WakeReceipt | undefined {
  try {
    /** The host receipt counts only if it contains the actual boolean return. */
    const receipt = readOptional<WakeReceipt>(join(directory(scope), `${record.sequence}.receipt`))
    return typeof receipt?.accepted === "boolean" ? receipt : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}
