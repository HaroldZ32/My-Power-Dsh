import { locateProject, withProjectLock } from "./project-store"

/** Serialize the synchronous read, compare-and-set and write for admitted project task mutations. */
export function withProjectTaskWrite<T>(workspace: string, operation: () => T): T {
  /** Calls arrive with the board's already-authorized workspace, independent of the checkout used for files. */
  const location = locateProject(workspace)
  // Legacy standalone boards keep their existing synchronous execution without creating a project.
  return location.record === undefined ? operation() : withProjectLock(location, operation)
}
