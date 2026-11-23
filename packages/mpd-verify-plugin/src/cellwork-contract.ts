import { readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type { DshToolExec } from "../../mpd-dsh-adapter-plugin/src/index"
import { readJson, readLoops, sha256File, writeLoop, type VerifyLoop } from "./ledger.ts"

/** Contract path is independent of the verifier's actual gate and source workspace. */
export interface CellworkContractFreeze {
  /** The absolute verified producer contract; the runtime reads its bytes from this exact path. */
  path: string
  /** The owning project, authenticated when the original captain opens the loop. */
  projectId: string
  /** Omitted while the producer is appending the native loop id to its contract. */
  sha256?: string
}

/** Paths and authenticated ownership required to open or seal a canonical project record. */
interface ContractCall {
  /** The actual calling workspace, which still owns the gate table and verification ledger. */
  readonly workspace: string
  /** Native session key for the cell captain. */
  readonly sessionId: string
}

/** One validated Cellwork file related to the caller's active project and cell. */
export function authorizedCellworkContract(service: unknown, site: ContractCall, input: string): CellworkContractFreeze | undefined {
  if (!isAbsolute(input) || typeof service !== "object" || service === null || !("resolveSeat" in service) || typeof service.resolveSeat !== "function") return undefined
  /** Only an authenticated seat may refer to the canonical project state from a nested checkout. */
  const binding: unknown = service.resolveSeat({ checkoutRoot: site.workspace, sessionId: site.sessionId })
  if (typeof binding !== "object" || binding === null || !("kind" in binding) || binding.kind !== "member" || !("projectRoot" in binding) || typeof binding.projectRoot !== "string" || !("projectId" in binding) || typeof binding.projectId !== "string") return undefined
  try {
    /** Both the shape and actual real path must identify this cell's registered contract directory. */
    const path = resolve(input)
    /** Each segment is checked before any depth-dependent file lookup. */
    const [state, plane, cellId, documents, filename, ...rest] = relative(binding.projectRoot, path).split(sep)
    if (state !== ".mpd" || plane !== "cellwork" || !/^cell-[\w.-]+$/.test(cellId ?? "") || documents !== "contracts" || !/^[\w.-]+(?:@r[1-9]\d*)?\.md$/.test(filename ?? "") || rest.length > 0) return undefined
    if (realpathSync(path) !== path || !statSync(path).isFile()) return undefined
    /** The originating caller must be the captain of the exact live cell, including a nested subcaptain. */
    const cell = readJson<{ captainSessionId?: unknown; phase?: unknown }>(resolve(binding.projectRoot, ".mpd", "cellwork", cellId, "state.json"))
    return cell?.captainSessionId === site.sessionId && cell.phase !== "stopped" ? { path, projectId: binding.projectId } : undefined
  } catch (error) {
    if (error instanceof Error) return undefined
    throw error
  }
}

/** Every new sealed verdict and seat checks the same original, non-redirected bytes. */
export function cellworkContractDigest(contract: CellworkContractFreeze): string {
  try {
    return realpathSync(contract.path) === contract.path && statSync(contract.path).isFile() ? sha256File(contract.path) : ""
  } catch (error) {
    if (error instanceof Error) return ""
    throw error
  }
}

/** Surface the precise state of a canonical contract before a seat or verdict can proceed. */
export function checkCellworkContract(loop: VerifyLoop): { reason: string; detail: string } | undefined {
  /** Historical unsealed relative loops retain their existing behavior. */
  const contract = loop.cellworkContract
  if (contract === undefined) return undefined
  if (!contract.sha256) return { reason: "frozen-contract-unsealed", detail: "the originating cell has not sealed its producer contract yet" }
  /** An empty fingerprint is missing input, never an admissible sealed record. */
  const actual = cellworkContractDigest(contract)
  if (actual === "") return { reason: "frozen-contract-missing", detail: `cannot read sealed producer contract ${contract.path}` }
  if (actual !== contract.sha256) return { reason: "frozen-contract-drift", detail: `the sealed producer contract changed (${contract.path})` }
  return undefined
}

/** Complete the producer's internal two-phase open after the actual loop id has been written. */
export function sealCellworkContract(site: ContractCall, loopId: string): { sha256: string } | { refused: string } {
  /** The caller cannot seal a different session's loop, or substitute another document. */
  const loop = readLoops(site.workspace).find((candidate) => candidate.loopId === loopId)
  /** The pre-authorized path is the only input the sealing operation accepts. */
  const pending = loop?.cellworkContract
  if (loop === undefined || pending === undefined || loop.sessionId !== site.sessionId || loop.status !== "armed") return { refused: "no pending Cellwork contract for this originating session and loop" }
  if (pending.sha256 !== undefined) {
    /** Replaying a sealed loop cannot re-freeze altered bytes. */
    const refusal = checkCellworkContract(loop)
    return refusal === undefined ? { sha256: pending.sha256 } : { refused: refusal.detail }
  }
  /** Verify the exact final file contains the native loop id, rather than freezing a placeholder. */
  const sha256 = cellworkContractDigest(pending)
  if (sha256 === "") return { refused: "cannot read the original prepared Cellwork contract" }
  try {
    if (!readFileSync(pending.path, "utf8").includes(`mpd_verify_seat {loop_id:"${loopId}"}`) || cellworkContractDigest(pending) !== sha256) return { refused: "the prepared contract does not stably name its actual new verification loop" }
  } catch (error) {
    if (error instanceof Error) return { refused: error.message }
    throw error
  }
  return writeLoop(site.workspace, { ...loop, cellworkContract: { ...pending, sha256 } }) ? { sha256 } : { refused: "could not persist the sealed Cellwork contract" }
}

/** Preserve legacy file layouts while exposing interrupted unsealed publication to Cellwork. */
export function cellworkContractPending(site: ContractCall, path: string): boolean {
  return readLoops(site.workspace).some((loop) => loop.sessionId === site.sessionId && loop.cellworkContract?.path === path && loop.cellworkContract.sha256 === undefined && loop.status === "armed")
}

/** Turn a runtime tool caller into the originating session for the internal service. */
export type CellworkSeal = (exec: DshToolExec, loopId: string) => { sha256: string } | { refused: string }
