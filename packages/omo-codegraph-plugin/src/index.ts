// omo-codegraph：CodeGraph 二进制解析 + 项目初始化（镜像 OMO 原版 session-start 纪律：
// exact-marker 探测、原子锁、失败冷却 15min 封顶、60s 树超时），并注册 omo-codegraph 命令供手动重跑。
// 零运行时依赖；任何失败只记日志，绝不崩溃 boot。
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

  // 手动重跑命令（有命令注册表才注册）
  try {
    const commands = (ctx.get && ctx.get("commands")) as { register?: (d: Record<string, unknown>) => void } | undefined
    if (commands?.register) {
      commands.register({
        name: "omo-codegraph",
        description: "初始化/重跑 CodeGraph 索引（.codegraph/codegraph.db）",
        handler: async () => {
          const b = resolveBinary(config)
          if (!b) return { success: false, error: "codegraph 二进制不可用：安装或设置 OMO_CODEGRAPH_BIN" }
          const s = existsSync(join(cwd, ".codegraph", "codegraph.db")) ? "marker" : initProject(cwd, b, timeoutMs)
          return { success: s === "ok" || s === "marker", text: "omo-codegraph init: " + s }
        }
      })
    }
  } catch { /* ignore */ }
}
