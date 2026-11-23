import { randomUUID } from "node:crypto"
import { linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { canonicalPath, missingPath, projectCheckout } from "./project-checkout"
import { decodeStagedPlan, stagingPath, type StagedPlan } from "./plan-store"
import { locateProject, ProjectAdmissionError, withProjectLock, type ProjectLocation } from "./project-store"
import { listTeams } from "./team-store"

/** One exact owner stage and the path from which approval will consume it. */
export interface ProjectStage {
  /** Physical checkout holding the draft, or the selected default when it does not exist. */
  readonly workspace: string
  /** A readable stage whose persisted session exactly matches the trusted caller. */
  readonly plan?: StagedPlan
}

/** Every matching copy, including identical bytes left by interrupted adoption. */
interface StageLookup extends ProjectStage {
  /** Absolute file paths in the currently authorized checkout family. */
  readonly matchingPaths: readonly string[]
  /** Original bytes corresponding to the parsed owner-and-version snapshot. */
  readonly bytes?: Buffer
}

/** An existing ancestor must resolve within the physical checkout before a stage can be read or written. */
function assertInside(workspace: string, path: string): void {
  /** Walk missing leaves until an existing path can prove containment. */
  let current = path
  while (true) {
    try {
      /** Git worktree aliases are resolved at the checkout boundary; descendants cannot escape it. */
      const fromRoot = relative(workspace, realpathSync(current))
      if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new ProjectAdmissionError("staging path escapes its registered checkout")
      return
    } catch (error) {
      if (!missingPath(error) || current === workspace) throw error
      current = dirname(current)
    }
  }
}

/** A missing slot grants no authority; a planted link must never be followed into another project. */
function stagePresent(path: string): boolean {
  try {
    if (!lstatSync(path).isFile()) throw new ProjectAdmissionError("staged plan is not a regular file")
    return true
  } catch (error) {
    if (missingPath(error)) return false
    throw error
  }
}

/** Search only the exact trusted session key in verified linked checkouts. */
function lookupStage(location: ProjectLocation, workspace: string, sessionId: string): StageLookup {
  /** The project root is preferred for new stages and completion of interrupted adoption. */
  const defaultRoot = location.record?.projectRoot ?? canonicalPath(workspace)
  /** Put the canonical destination first without widening the authorized root set. */
  const roots = sessionId === "" || sessionId === "workspace" ? [defaultRoot] : [...new Set([defaultRoot, ...location.roots])]
  /** Collect only owner-matched drafts; identical duplicates can be retired after a crash. */
  const found: Array<{ root: string; path: string; plan: StagedPlan; bytes: Buffer }> = []
  for (const root of roots) {
    /** Each candidate is the single file derived from the session id, never a draft listing. */
    const path = stagingPath(root, sessionId)
    if (!stagePresent(path)) continue
    if (root !== defaultRoot) {
      /** Git can list a stale pathname now occupied by an independent repository. */
      const checked = projectCheckout(root)
      if (checked?.primaryRoot !== location.primaryRoot || checked.checkoutRoot !== root) continue
    }
    /** Read the same complete bytes used for ownership and duplicate checks. */
    let bytes: Buffer
    try {
      assertInside(root, path)
      bytes = readFileSync(path)
    } catch (error) {
      if (missingPath(error)) continue
      throw error
    }
    /** The owner inside the record defeats filesystem id normalization collisions. */
    const plan = decodeStagedPlan(bytes.toString("utf8"))
    if (plan === undefined) throw new ProjectAdmissionError("the original staged plan could not be read")
    if (plan.sessionId !== sessionId) throw new ProjectAdmissionError("staged plan belongs to another session")
    found.push({ root, path, plan, bytes })
  }
  /** The canonical candidate wins only when every duplicate is byte-identical. */
  const first = found[0]
  if (first === undefined) return { workspace: defaultRoot, matchingPaths: [] }
  if (found.some((entry) => !entry.bytes.equals(first.bytes))) {
    throw new ProjectAdmissionError(`conflicting staged plans for the same session (${[...new Set(found.map((entry) => entry.plan.planId))].join(", ")}); no draft was overwritten`)
  }
  return { workspace: first.root, plan: first.plan, bytes: first.bytes, matchingPaths: found.map((entry) => entry.path) }
}

/** A status call forwards to the owner stage without changing either project's files. */
export function readProjectStage(workspace: string, sessionId: string): ProjectStage {
  /** Retry an absent snapshot once in case publication crossed between looking at the two roots. */
  const first = lookupStage(locateProject(workspace), workspace, sessionId)
  return first.plan === undefined ? lookupStage(locateProject(workspace), workspace, sessionId) : first
}

/** Finish removal of equal copies only after an exclusive destination publication. */
function retireCopies(lookup: StageLookup, destination: string): void {
  for (const path of lookup.matchingPaths) if (path !== destination) rmSync(path, { force: true })
}

/** A stage mutation uses the same inter-process critical section as approval. */
export function withProjectStage<T>(workspace: string, sessionId: string, mutate: (stage: ProjectStage) => T, replacePaused: boolean = false): T {
  /** The staged-plan path cannot enlist an admission lock outside the declared Git root. */
  const project = locateProject(workspace)
  assertInside(project.primaryRoot, join(project.primaryRoot, ".mpd", "project-team"))
  return withProjectLock(project, (location) => {
    /** Re-resolve staging from the winner's current project root without discarding the losing draft. */
    const lookup = lookupStage(location, workspace, sessionId)
    /** No edit may supersede the frozen plan after its board was published but spawn is still in progress. */
    const active = lookup.plan === undefined ? undefined : listTeams(location.record?.projectRoot ?? workspace).find((board) => board.planId === lookup.plan?.planId && board.leadSessionId === sessionId && (lookup.plan?.activation !== undefined || board.approvedAt === undefined) && board.endedAt === undefined && board.phase !== "ended")
    /** Only an explicit replacement may supersede a recorded pause with no opening child. */
    const paused = replacePaused && lookup.plan?.activation?.stoppedAt !== undefined && !active?.members.some((member) => member.status === "provisioning")
    if (active !== undefined && !paused) throw new ProjectAdmissionError(`plan ${active.planId} is frozen by approval of board ${active.teamId}`)
    /** Complete a previous byte-identical adoption before this mutation can make versions differ. */
    const destination = stagingPath(lookup.workspace, sessionId)
    assertInside(lookup.workspace, destination)
    retireCopies(lookup, destination)
    return mutate(lookup)
  })
}

/** Freeze and adopt the original stage while admission still holds the project lock. */
export function adoptProjectStage(location: ProjectLocation, target: string, expected: StagedPlan): void {
  /** A concurrent caller may have edited or replaced the staged plan during asynchronous route lookup. */
  const lookup = lookupStage(location, target, expected.sessionId)
  if (lookup.plan === undefined || lookup.bytes === undefined || JSON.stringify(lookup.plan) !== JSON.stringify(expected)) throw new ProjectAdmissionError(`plan ${expected.planId} changed before approval; retry against the current draft`)
  /** The exact original bytes are adopted, including historical plan fields a future build may need. */
  const origin = stagingPath(lookup.workspace, expected.sessionId)
  /** The canonical slot is reserved independently of the origin's filesystem. */
  const destination = stagingPath(target, expected.sessionId)
  assertInside(target, destination)
  if (origin !== destination) {
    mkdirSync(dirname(destination), { recursive: true })
    /** Copy to a unique same-filesystem temp, then link with O_EXCL semantics to publish complete bytes. */
    const temp = `${destination}.${randomUUID()}.adopt`
    try {
      writeFileSync(temp, lookup.bytes, { flag: "wx", mode: 0o600 })
      linkSync(temp, destination)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") throw new ProjectAdmissionError("the canonical staging slot changed during adoption; no draft was overwritten")
      throw error
    } finally {
      rmSync(temp, { force: true })
    }
  }
  retireCopies(lookup, destination)
}
