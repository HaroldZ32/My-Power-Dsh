// QA-only preset+roster+skill-catalog probe plugin: asserts the mpd main preset
// resolves, the mpdRoles roster answers with the full OMO roster (11 roles), and
// the bundle's skill corpus is served by the skill registry (count + one loaded
// skill + its resource base). Mounted ONLY by QA overlays (tests/overlays/
// roles-probe.yml template), never shipped in the bundle.
export const name = "mpd-dsh-qa-roles-probe"
export const inject = ["agentPresets"]
type Preset = { id: string; broken?: string; path?: string; trust?: string }
type PresetsService = { list(): Promise<Preset[]>; resolve(id: string): Promise<Preset> }
type RolesService = { list(): Array<{ id: string }> }
type SkillSummary = { name: string; source?: string; provider?: string; resourceBase?: { kind: string; path?: string } }
type SkillsService = { list(options?: { cwd?: string }): Promise<SkillSummary[]>; get(name: string, options?: { cwd?: string }): Promise<{ name: string; content: string; resourceBase?: { path?: string } } | undefined> }
const ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"]
/** One corpus skill the probe loads to prove the provider serves real bodies. */
const FIXTURE_SKILL = "svn-master"
export async function apply(ctx: { agentPresets: PresetsService; get?: (k: string) => any; [k: string]: unknown }): Promise<void> {
  let presetOk = false
  try {
    const preset = await ctx.agentPresets.resolve("mpd")
    presetOk = !preset.broken
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)))
    // PRESET_PATH proves WHERE the preset is served from (bundle dir vs home copy).
    console.log("[roles-probe] PRESET_PATH=" + String(preset.path ?? "unknown") + " trust=" + String(preset.trust ?? "unknown"))
  } catch (e: any) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e))
  }
  const roles = ctx.get?.("mpdRoles") as RolesService | undefined
  const ids = (roles?.list?.() ?? []).map((r) => r.id)
  console.log("[roles-probe] ROSTER=" + ids.join(","))
  // Skill catalog: the corpus must be served by the bundle provider, and one
  // fixture skill must load with a resource base (relative references resolve).
  const skills = ctx.get?.("skills") as SkillsService | undefined
  let catalogOk = false
  if (skills === undefined) {
    console.log("[roles-probe] SKILLS=no-registry")
  } else {
    try {
      const summaries = await skills.list({})
      const bundled = summaries.filter((s) => s.source === "bundled")
      console.log("[roles-probe] SKILLS=" + summaries.length + " BUNDLED=" + bundled.length)
      const fixture = await skills.get(FIXTURE_SKILL, {})
      const base = fixture?.resourceBase?.path ?? "unknown"
      console.log("[roles-probe] SKILL_FIXTURE=" + (fixture === undefined ? "missing" : "ok") + " name=" + String(fixture?.name ?? "-") + " base=" + base + " bytes=" + String(fixture?.content?.length ?? 0))
      catalogOk = fixture !== undefined && fixture.content.length > 100 && bundled.length >= 20
    } catch (e: any) {
      console.log("[roles-probe] SKILLS=fail:" + String(e?.message ?? e))
    }
  }
  const ok = presetOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id)) && catalogOk
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}
