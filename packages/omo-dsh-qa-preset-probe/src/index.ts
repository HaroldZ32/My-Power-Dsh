// QA-only preset 探针插件（诊断版）：列出/解析 omo 预设 + 打印 roots。
export const name = "omo-dsh-qa-preset-probe"
export const inject = ["agentPresets"]
type Preset = { id: string; broken?: string }
type PresetsService = { list(): Promise<Preset[]>; resolve(id: string): Promise<Preset>; roots: unknown[] }
export async function apply(ctx: { agentPresets: PresetsService; [key: string]: unknown }): Promise<void> {
  console.log("[preset-probe] ROOTS=" + JSON.stringify(ctx.agentPresets.roots))
  const list = await ctx.agentPresets.list()
  console.log("[preset-probe] LIST=" + list.map((p) => p.id + (p.broken ? "(broken)" : "")).join(","))
  const ids = ["omo-oracle", "omo-librarian", "omo-prometheus", "omo-hephaestus"]
  const resolved: Record<string, boolean> = {}
  for (const id of ids) {
    try { resolved[id] = !(await ctx.agentPresets.resolve(id)).broken } catch { resolved[id] = false }
  }
  console.log("[preset-probe] RESOLVED=" + JSON.stringify(resolved))
  const ok = ids.every((id) => resolved[id])
  console.log("[preset-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}
