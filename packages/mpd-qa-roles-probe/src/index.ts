// QA-only roles+preset probe plugin: asserts the mpd main preset resolves and the
// mpdRoles roster answers with the full OMO roster (11 roles). Mounted ONLY by QA
// overlays (tests/overlays/roles-probe.yml template), never shipped in the bundle.
export const name = "mpd-dsh-qa-roles-probe"
export const inject = ["agentPresets"]
type Preset = { id: string; broken?: string }
type PresetsService = { list(): Promise<Preset[]>; resolve(id: string): Promise<Preset> }
type RolesService = { list(): Array<{ id: string }> }
const ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"]
export async function apply(ctx: { agentPresets: PresetsService; get?: (k: string) => any; [k: string]: unknown }): Promise<void> {
  let presetOk = false
  try {
    const preset = await ctx.agentPresets.resolve("mpd")
    presetOk = !preset.broken
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)))
  } catch (e: any) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e))
  }
  const roles = ctx.get?.("mpdRoles") as RolesService | undefined
  const ids = (roles?.list?.() ?? []).map((r) => r.id)
  console.log("[roles-probe] ROSTER=" + ids.join(","))
  const ok = presetOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id))
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}