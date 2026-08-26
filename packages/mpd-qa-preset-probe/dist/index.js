// src/index.ts
var name = "mpd-dsh-qa-preset-probe";
var inject = ["agentPresets"];
async function apply(ctx) {
  console.log("[preset-probe] ROOTS=" + JSON.stringify(ctx.agentPresets.roots));
  const list = await ctx.agentPresets.list();
  console.log("[preset-probe] LIST=" + list.map((p) => p.id + (p.broken ? "(broken)" : "")).join(","));
  const ids = ["mpd-oracle", "mpd-librarian", "mpd-prometheus", "mpd-hephaestus"];
  const resolved = {};
  for (const id of ids) {
    try {
      resolved[id] = !(await ctx.agentPresets.resolve(id)).broken;
    } catch {
      resolved[id] = false;
    }
  }
  console.log("[preset-probe] RESOLVED=" + JSON.stringify(resolved));
  const ok = ids.every((id) => resolved[id]);
  console.log("[preset-probe] " + (ok ? "PASS" : "FAIL"));
  if (!ok)
    process.exitCode = 1;
}
export {
  apply,
  inject,
  name
};
