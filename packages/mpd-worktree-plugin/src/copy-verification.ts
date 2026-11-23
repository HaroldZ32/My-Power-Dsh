import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { directoryId, pathExists } from "./copy-git.ts"
import { objectOf, type CopyRecord } from "./copy-store.ts"
import { WorktreeError } from "./ops.ts"

/** A record ID may select one regular ledger file, never an arbitrary path. */
const RECORD_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/

/** Read the durable verification envelope without accepting a symlink or alternate ledger root. */
function readProof(dir: string, id: string): Record<string, unknown> {
  /** The file is owned by the existing verification plane. */
  const path = join(dir, `${id}.json`)
  if (!pathExists(path) || !lstatSync(path).isFile()) {
    throw new WorktreeError("copy-verification", "the verification record must exist as a regular file")
  }
  return objectOf(JSON.parse(readFileSync(path, "utf8")))
}

/** Require an independent PASS for this assignment and this exact submitted Git commit. */
export function verifyCopyCandidate(root: string, copy: CopyRecord, id: string): void {
  if (!RECORD_ID.test(id) || copy.candidate === undefined || copy.submittedAt === undefined) {
    throw new WorktreeError("copy-verification", "submit a candidate and provide its verification record id")
  }
  /** Only the project's canonical MPD ledger can attest to an integration. */
  const dir = join(root, ".mpd", "verify", "records")
  if (!pathExists(dir)) throw new WorktreeError("copy-verification", "the project has no recorded verification")
  directoryId(dir)
  /** The law's recorded PASS, with a verifier-declared candidate binding. */
  const record = readProof(dir, id)
  /** Notes bind the verification to a commit in a specific request. */
  const binding = `git-copy:${copy.id}:${copy.candidate}`
  /** Only a gate that completed successfully can support the candidate PASS. */
  const gates = Array.isArray(record.gateEvidence) ? record.gateEvidence.map(objectOf) : []
  if (record.version !== 1 || record.recordId !== id || record.workspace !== root || record.taskId !== copy.taskId ||
      record.writerId !== copy.writerSession || typeof record.verifierId !== "string" || !record.verifierId ||
      record.verifierId === copy.writerSession || record.verdict !== "PASS" || objectOf(record.basis).kind !== "blind" ||
      typeof record.loopId !== "string" || !record.loopId || typeof record.createdAt !== "string" ||
      !(Date.parse(record.createdAt) >= Date.parse(copy.submittedAt)) || !Array.isArray(record.sources) || !record.sources.length ||
      !gates.some((gate) => gate.exit === 0 && typeof gate.evidenceId === "string" && gate.evidenceId !== "") || !Array.isArray(record.notes) || !record.notes.includes(binding)) {
    throw new WorktreeError("copy-verification", `an independent PASS after submission must name the assigned writer, task and ${binding}`)
  }
  /** Match the opened loop too, so an overridden task or writer on a verdict cannot pass. */
  const loopId = record.loopId
  if (!RECORD_ID.test(loopId)) throw new WorktreeError("copy-verification", "invalid verification loop ID")
  /** The canonical loop file holds the authority behind the verdict. */
  const loops = join(root, ".mpd", "verify", "loops")
  directoryId(loops)
  /** Match the recorded bound verifier, writer and project on the same loop. */
  const loop = readProof(loops, loopId)
  if (loop.version !== 1 || loop.loopId !== loopId || loop.workspace !== root || loop.taskId !== copy.taskId ||
      objectOf(loop.writer).id !== copy.writerSession || objectOf(loop.verifier).id !== record.verifierId || objectOf(loop.writer).kind !== "delegate") {
    throw new WorktreeError("copy-verification", "the verification loop must bind the project, task, writer and independent verifier")
  }
  for (const file of readdirSync(dir)) {
    /** A later recorded FAIL for the same loop supersedes the selected PASS. */
    const otherId = file.slice(0, -5)
    if (!file.endsWith(".json") || otherId === id || !RECORD_ID.test(otherId)) continue
    /** Avoid consulting any candidate-selected storage path. */
    const other = readProof(dir, otherId)
    if (other.loopId === record.loopId && other.verdict === "FAIL" && typeof other.createdAt === "string" &&
        Date.parse(other.createdAt) >= Date.parse(record.createdAt)) {
      throw new WorktreeError("copy-verification", "the verification loop has a later FAIL")
    }
  }
}
