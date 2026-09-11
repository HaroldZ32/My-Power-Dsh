// mpd-verif environment resolution.
// Backend binaries: MPD_DSH_VERIF_<BACKEND> env wins, PATH fallback (never vendored).
// Venv: <workspace>/.venv-rtl default or MPD_DSH_VERIF_VENV (iron rule — workspace-local only).
// Work state: <workspace>/.mpd/verif or MPD_DSH_VERIF_WORK. Never touches ~/.dsh.
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { workspaceRootOf } from "../../mpd-dsh-adapter-plugin/src/index"

export const BACKEND_IDS = ["iverilog", "verilator", "vcs"] as const
export type BackendId = (typeof BACKEND_IDS)[number]

export const BACKEND_BIN: Record<BackendId, string> = {
  iverilog: "iverilog",
  verilator: "verilator",
  vcs: "vcs",
}

export const BACKEND_ENV: Record<BackendId, string> = {
  iverilog: "MPD_DSH_VERIF_IVERILOG",
  verilator: "MPD_DSH_VERIF_VERILATOR",
  vcs: "MPD_DSH_VERIF_VCS",
}

export interface VerifPaths {
  workspace: string
  venv: string
  work: string
}

// The workspace root is owned by the ONE resolution in mpd-dsh-adapter
// (session header cwd -> DSH_WORKSPACE_ROOT -> process.cwd()); this module only
// forwards the calling call's `exec` so every verif root follows the CALLING
// SESSION's workspace. Module-level caching is forbidden: one host serves many
// sessions with different workspaces.
export function workspaceRoot(exec?: any): string {
  return resolve(workspaceRootOf(exec))
}

export function venvPath(override?: string, exec?: any): string {
  return resolve(override || process.env.MPD_DSH_VERIF_VENV || join(workspaceRoot(exec), ".venv-rtl"))
}

export function workDir(exec?: any): string {
  return resolve(process.env.MPD_DSH_VERIF_WORK || join(workspaceRoot(exec), ".mpd", "verif"))
}

export function paths(overrideVenv?: string, exec?: any): VerifPaths {
  return { workspace: workspaceRoot(exec), venv: venvPath(overrideVenv, exec), work: workDir(exec) }
}

// Binary resolution: explicit env override wins even when the file is missing
// (so QA can assert the exact path the tool will attempt); PATH fallback scans
// each entry for the plain binary name.
export function resolveBackendBinary(backend: BackendId): { binary: string; source: "env" | "path" } | null {
  const envVal = process.env[BACKEND_ENV[backend]]
  if (envVal && envVal.trim().length > 0) return { binary: resolve(envVal.trim()), source: "env" }
  const bin = BACKEND_BIN[backend]
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0) continue
    const f = join(dir, bin)
    if (existsSync(f)) return { binary: f, source: "path" }
  }
  return null
}

// Deterministic timestamp-shaped slug for per-case work dirs (sortable).
export function runStamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

// gen-tb-skill methodology (structure only, no code reuse): seed base is the
// run date so seeds are reproducible per regression calendar day.
export function dateSeedBase(now = new Date()): number {
  const p = (n: number, w = 2) => String(n).padStart(w, "0")
  return Number(`${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`)
}