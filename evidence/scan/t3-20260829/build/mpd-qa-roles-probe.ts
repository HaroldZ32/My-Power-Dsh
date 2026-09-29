// packages/mpd-qa-roles-probe/src/index.ts
var name = "mpd-dsh-qa-roles-probe";
var inject = ["agentPresets"];
var ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"];
async function apply(ctx) {
  let presetOk = false;
  try {
    const preset = await ctx.agentPresets.resolve("mpd");
    presetOk = !preset.broken;
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)));
  } catch (e) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e));
  }
  const roles = ctx.get?.("mpdRoles");
  const ids = (roles?.list?.() ?? []).map((r) => r.id);
  console.log("[roles-probe] ROSTER=" + ids.join(","));
  const ok = presetOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id));
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"));
  if (!ok)
    process.exitCode = 1;
}
export {
  name,
  inject,
  apply
};
