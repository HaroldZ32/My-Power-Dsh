import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"
import { cellDir } from "./state"
import type { WorkerTask } from "./worker-pressure-authority"

/** One successful, meaningful tool response in native session history. */
export interface UsefulHistory {
  /** Native session event sequence strictly beyond the prior completed maintenance. */
  readonly seq: number
  /** Actual serialized successful tool result bytes, excluding schema and prompt size. */
  readonly bytes: number
}

/** A resolved epoch is an immutable baseline, whether the native engine compacted or refused. */
interface EpochResult {
  /** Host history sequence that the earlier engine operation consumed. */
  readonly seq: number
  /** Occupancy immediately after that attempt, or the unchanged observed occupancy on refusal. */
  readonly used: number
  /** A changed or unknown model window cannot authorize another epoch. */
  readonly window: number
}

/** Stable paths are derived from the original authenticated assignment, not task revision. */
export type PressureAssignment = Pick<WorkerTask, "workspace" | "cellId" | "attemptKey" | "teamId" | "sessionId" | "taskId" | "attempt" | "revision">

/** Directory and durable filename prefix for one board attempt. */
function address(task: PressureAssignment): { directory: string; prefix: string } {
  return { directory: join(cellDir(task.workspace, task.cellId), "pressure"), prefix: createHash("sha256").update(task.attemptKey).digest("hex") }
}

/** One at-most-once reservation, including after a same-session cold resume. */
export function reservePressureEpoch(task: PressureAssignment, observed?: { used: number; window: number; useful: UsefulHistory | undefined }): string | undefined {
  /** Epoch zero retains the original durable file name and compatibility semantics. */
  const { directory, prefix } = address(task)
  mkdirSync(directory, { recursive: true })
  /** Every period begins with the epoch zero marker. Later generations use their native boundary. */
  const markers = readdirSync(directory).filter((name) => name === `${prefix}.json` || (name.startsWith(`${prefix}-`) && /^\d+\.json$/.test(name.slice(prefix.length + 1))))
  /** The earlier resolved receipt is the only basis for another period of maintenance. */
  const previous = markers.sort((left, right) => Number(right.slice(prefix.length + 1, -5)) - Number(left.slice(prefix.length + 1, -5)))[0]
  /** Without a resolved previous epoch, repeated or interrupted maintenance stays spent. */
  const prior = previous === undefined ? undefined : readResult(join(directory, previous))
  if (previous !== undefined && (prior === undefined || observed === undefined || observed.useful === undefined || observed.useful.seq <= prior.seq || observed.useful.bytes < 2048 || observed.window !== prior.window || observed.used - prior.used < 4096)) return undefined
  /** Two local processes encountering the same past boundary can never both reserve its successor. */
  const marker = join(directory, prior === undefined ? `${prefix}.json` : `${prefix}-${prior.seq}.json`)
  try {
    writeFileSync(marker, JSON.stringify({ teamId: task.teamId, sessionId: task.sessionId, taskId: task.taskId, attempt: task.attempt, revision: task.revision }) + "\n", { flag: "wx", mode: 0o600 })
    return marker
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return undefined
    throw error
  }
}

/** A malformed or interrupted persisted result cannot be used as a new baseline. */
function readResult(marker: string): EpochResult | undefined {
  try {
    /** The receipt is a small validated snapshot, independent of JSONL journal history. */
    const value: unknown = JSON.parse(readFileSync(`${marker}.result`, "utf8"))
    if (typeof value !== "object" || value === null || !("seq" in value) || !("used" in value) || !("window" in value)) return undefined
    if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq) || typeof value.used !== "number" || !Number.isFinite(value.used) || typeof value.window !== "number" || !Number.isFinite(value.window) || value.window <= 0) return undefined
    return { seq: value.seq, used: value.used, window: value.window }
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return undefined
    throw error
  }
}

/** Publish one reusable post-maintenance baseline after the native operation settles. */
export function finishPressureEpoch(marker: string, result: EpochResult): void {
  /** The complete receipt is visible atomically in the same directory. */
  const temporary = join(marker, "..", `${basename(marker)}-${randomUUID()}.tmp`)
  writeFileSync(temporary, JSON.stringify(result) + "\n", { mode: 0o600 })
  try { renameSync(temporary, `${marker}.result`) } finally { rmSync(temporary, { force: true }) }
}