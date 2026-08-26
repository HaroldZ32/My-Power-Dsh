// omo-codegraph: CodeGraph binary resolution + project initialization (mirrors the OMO original session-start discipline:
// exact-marker probing, atomic lock, failure cooldown capped at 15 min, 60 s tree timeout), and registers the omo-codegraph command for manual re-runs.
// Zero runtime dependencies; any failure is only logged and never crashes boot.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

export const name = "omo-codegraph"
export const inject = []

type Ctx = { get?(key: string): unknown; [k: string]: unknown }
type Config = { autoInit?: boolean; initTimeoutMs?: number; cooldownMs?: number }

function resolveBinary(config?: Config): string | null {
  const candidates = [
    config?.binary, process.env.OMO_CODEGRAPH_BIN, process.env.OMO_DSH_CODEGRAPH_BIN
  ].filter((s): s is string => !!s && s.length > 0)
  for (const c of candidates) if (existsSync(c)) return c
  for (const p of (process.env.PATH || "").split(":")) {
    const f = join(p, "codegraph")
    if (existsSync(f)) return f
  }
  return null
}

function cooldownFresh(cwd: string, cooldownMs: number): boolean {
  const stamp = join(cwd, ".codegraph", "init.cooldown")
  if (!existsSync(stamp)) return false
  try {
    const age = Date.now() - statSync(stamp).mtimeMs
    return age < cooldownMs
  } catch { return false }
}

function initProject(cwd: string, binary: string, timeoutMs: number): string {
  const marker = join(cwd, ".codegraph", "codegraph.db")
  if (existsSync(marker)) return "marker"
  const lock = join(cwd, ".codegraph", "init.lock")
  const lockDir = join(cwd, ".codegraph")
  try {
    mkdirSync(lockDir, { recursive: true })
    mkdirSync(lock, { recursive: false })
  } catch { return "locked" }
  try {
    const r = spawnSync(binary, ["init"], { cwd, timeout: timeoutMs, stdio: "ignore" })
    if (r.status === 0 && existsSync(marker)) return "ok"
    return r.status === 0 ? "fail-no-marker" : "fail"
  } finally {
    try { rmSync(lock, { recursive: true, force: true }) } catch { /* ignore */ }
    try { writeCooldown(join(cwd, ".codegraph"), "init.cooldown") } catch { /* ignore */ }
  }
}

import { writeFileSync } from "node:fs"
function writeCooldown(dir: string, file: string): void {
  try { writeFileSync(join(dir, file), String(Date.now())) } catch { /* ignore */ }
}

export function apply(ctx: Ctx, config: Config = {}): void {
  const autoInit = config.autoInit ?? true
  const timeoutMs = config.initTimeoutMs ?? 60_000
  const cooldownMs = config.cooldownMs ?? 15 * 60_000
  const cwd = process.env.OMO_CODEGRAPH_PROJECT_CWD || process.cwd()
  const binary = resolveBinary(config)
  let status: string
  if (!binary) { status = "no-binary" }
  else if (existsSync(join(cwd, ".codegraph", "codegraph.db"))) { status = "marker" }
  else if (!autoInit) { status = "auto-init-disabled" }
  else if (cooldownFresh(cwd, cooldownMs)) { status = "cooldown" }
  else { status = initProject(cwd, binary, timeoutMs) }
  console.log("[omo-codegraph] init status=" + status + " binary=" + (binary ?? "-") + " cwd=" + cwd)

  // Manual re-run command (registered only when a command registry is present)
  try {
    const commands = (ctx.get && ctx.get("commands")) as { register?: (d: Record<string, unknown>) => void } | undefined
    if (commands?.register) {
      commands.register({
        name: "omo-codegraph",
        description: "Initialize/re-run the CodeGraph index (.codegraph/codegraph.db)",
        handler: async () => {
          const b = resolveBinary(config)
          if (!b) return { success: false, error: "codegraph binary unavailable: install it or set OMO_CODEGRAPH_BIN" }
          const s = existsSync(join(cwd, ".codegraph", "codegraph.db")) ? "marker" : initProject(cwd, b, timeoutMs)
          return { success: s === "ok" || s === "marker", text: "omo-codegraph init: " + s }
        }
      })
    }
  } catch { /* ignore */ }
}
