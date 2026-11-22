import { statSync, watch, type FSWatcher } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { projectExtensionsDir } from "./manifest"

/** Stable subset of the harness's registration control, optional on older hosts. */
export interface ProjectSkillControl {
  /** Scope ends when this exact provider registration is disposed. */
  readonly signal?: AbortSignal
  /** Discard completed host catalogs after a filesystem notification. */
  readonly invalidate?: () => void
}

/** Watch observed project extension roots, including creation or replacement of a missing root. */
export function projectSkillWatcher(control: ProjectSkillControl | undefined, warn: (message: string) => void): (cwd: string) => void {
  /** Older provider factories can keep their per-lookup discovery behavior. */
  const { signal, invalidate } = control ?? {}
  if (!signal || !invalidate || signal.aborted) return () => {}
  /** Each observed workspace keeps one watch per existing level of its extension path. */
  const workspaces = new Map<string, FSWatcher[]>()
  signal.addEventListener("abort", () => {
    for (const watchers of workspaces.values()) for (const watcher of watchers) watcher.close()
    workspaces.clear()
  }, { once: true })

  /** Re-arm the small set of watches when the directory hierarchy itself moves. */
  const observe = (cwd: string): void => {
    if (signal.aborted || workspaces.has(cwd)) return
    /** Watch ancestor entries without scanning unrelated workspace subtrees. */
    const root = projectExtensionsDir(cwd)
    /** Parent of the extension root, watched for the creation of `extensions`. */
    const mpd = dirname(root)
    /** One workspace's watches are closed as a group on replacement or teardown. */
    const watchers: FSWatcher[] = []
    workspaces.set(cwd, watchers)
    /** Stop listening to the old inode when the observed paths are replaced. */
    const stop = (): void => {
      if (workspaces.get(cwd) !== watchers) return
      workspaces.delete(cwd)
      for (const watcher of watchers) watcher.close()
    }
    for (const [path, child] of [[cwd, ".mpd"], [mpd, "extensions"], [root, undefined]] as const) {
      try {
        if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) continue
        /** Recursive only below the extension root to catch manifest, skill, and flow changes. */
        const watcher = watch(path, { recursive: child === undefined, persistent: false }, (_event, filename) => {
          if (signal.aborted || workspaces.get(cwd) !== watchers) return
          if (child !== undefined) {
            if (filename !== null && filename !== child) return
            stop()
            observe(cwd)
          }
          invalidate()
        })
        watchers.push(watcher)
        watcher.on("error", (error) => {
          if (workspaces.get(cwd) !== watchers) return
          stop()
          warn(`project extension watch failed for ${path}: ${error.message}`)
          invalidate()
        })
      } catch (error) {
        warn(`project extension watch unavailable for ${path}: ${String(error)}`)
      }
    }
  }
  return (cwd: string): void => { observe(resolve(cwd)) }
}
