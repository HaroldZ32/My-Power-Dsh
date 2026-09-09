// QA-only preset+roster+skill-catalog probe plugin: asserts the mpd main preset
// resolves, the mpdRoles roster answers with the full OMO roster (11 roles), and
// the bundle's skill corpus is served by the skill registry (count + one loaded
// skill + its resource base). Mounted ONLY by QA overlays (tests/overlays/
// roles-probe.yml template), never shipped in the bundle.
// Harness seams (preset roster, skill registry) are read through the bundle's
// shared adapter, so the probe exercises the same surface the plugins do.
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-dsh-qa-roles-probe"
export const inject = ["agentPresets"]
type RolesService = { list(): Array<{ id: string }> }
const ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"]
/** One corpus skill the probe loads to prove the provider serves real bodies. */
const FIXTURE_SKILL = "svn-master"
export async function apply(ctx: { agentPresets: unknown; get?: (k: string) => any; [k: string]: unknown }): Promise<void> {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  let presetOk = false
  try {
    const preset = await dsh.resolvePreset("mpd")
    presetOk = !preset.broken
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)))
    // PRESET_PATH proves WHERE the preset is served from (bundle dir vs home copy).
    console.log("[roles-probe] PRESET_PATH=" + String(preset.path ?? "unknown") + " trust=" + String(preset.trust ?? "unknown"))
  } catch (e: any) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e))
  }
  // Adapter capability snapshot taken at USE time (the loader applies rows
  // concurrently, so only a later read reflects the whole tree).
  const caps = dsh.capabilities()
  const present = Object.entries(caps).filter(([, value]) => value === true).map(([key]) => key)
  const absent = Object.entries(caps).filter(([, value]) => value === false).map(([key]) => key)
  console.log("[roles-probe] ADAPTER_SEAMS=" + (present.join(",") || "none") + (absent.length === 0 ? "" : " ABSENT=" + absent.join(",")))
  // Internal tool invocation through the adapter (the path mpd-verif's wave
  // hooks use): a registered mpd tool must answer through the normalized call.
  let toolCallOk = false
  try {
    const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
    console.log("[roles-probe] ADAPTER_TOOL_CALL=" + (call.ok ? "ok" : "fail:" + String(call.error)))
    toolCallOk = call.ok === true
  } catch (e: any) {
    console.log("[roles-probe] ADAPTER_TOOL_CALL=fail:" + String(e?.message ?? e))
  }
  const roles = ctx.get?.("mpdRoles") as RolesService | undefined
  const ids = (roles?.list?.() ?? []).map((r) => r.id)
  console.log("[roles-probe] ROSTER=" + ids.join(","))
  // Skill catalog: the corpus must be served by the bundle provider, and one
  // fixture skill must load with a resource base (relative references resolve).
  let catalogOk = false
  try {
    const summaries = await dsh.listSkills()
    const bundled = summaries.filter((summary: any) => summary.source === "bundled")
    console.log("[roles-probe] SKILLS=" + summaries.length + " BUNDLED=" + bundled.length)
    const fixture = (await dsh.loadSkill(FIXTURE_SKILL)) as { name?: string; content?: string; resourceBase?: { path?: string } } | undefined
    const base = fixture?.resourceBase?.path ?? "unknown"
    const bytes = fixture?.content?.length ?? 0
    console.log("[roles-probe] SKILL_FIXTURE=" + (fixture === undefined ? "missing" : "ok") + " name=" + String(fixture?.name ?? "-") + " base=" + base + " bytes=" + String(bytes))
    catalogOk = fixture !== undefined && bytes > 100 && bundled.length >= 20
  } catch (e: any) {
    console.log("[roles-probe] SKILLS=fail:" + String(e?.message ?? e))
  }
  const ok = presetOk && toolCallOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id)) && catalogOk
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}
