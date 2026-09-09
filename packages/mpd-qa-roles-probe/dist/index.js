// packages/mpd-qa-roles-probe/src/index.ts
var name = "mpd-dsh-qa-roles-probe";
var inject = ["agentPresets"];
var ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"];
var FIXTURE_SKILL = "svn-master";
async function apply(ctx) {
  let presetOk = false;
  try {
    const preset = await ctx.agentPresets.resolve("mpd");
    presetOk = !preset.broken;
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)));
    console.log("[roles-probe] PRESET_PATH=" + String(preset.path ?? "unknown") + " trust=" + String(preset.trust ?? "unknown"));
  } catch (e) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e));
  }
  const roles = ctx.get?.("mpdRoles");
  const ids = (roles?.list?.() ?? []).map((r) => r.id);
  console.log("[roles-probe] ROSTER=" + ids.join(","));
  const skills = ctx.get?.("skills");
  let catalogOk = false;
  if (skills === undefined) {
    console.log("[roles-probe] SKILLS=no-registry");
  } else {
    try {
      const summaries = await skills.list({});
      const bundled = summaries.filter((s) => s.source === "bundled");
      console.log("[roles-probe] SKILLS=" + summaries.length + " BUNDLED=" + bundled.length);
      const fixture = await skills.get(FIXTURE_SKILL, {});
      const base = fixture?.resourceBase?.path ?? "unknown";
      console.log("[roles-probe] SKILL_FIXTURE=" + (fixture === undefined ? "missing" : "ok") + " name=" + String(fixture?.name ?? "-") + " base=" + base + " bytes=" + String(fixture?.content?.length ?? 0));
      catalogOk = fixture !== undefined && fixture.content.length > 100 && bundled.length >= 20;
    } catch (e) {
      console.log("[roles-probe] SKILLS=fail:" + String(e?.message ?? e));
    }
  }
  const ok = presetOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id)) && catalogOk;
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"));
  if (!ok)
    process.exitCode = 1;
}
export {
  name,
  inject,
  apply
};
