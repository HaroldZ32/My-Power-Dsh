export const name = "mpd-t8-carrier-probe"
export async function apply(ctx) {
  const fs = process.getBuiltinModule("node:fs")
  const out = process.env.CARRIER_PROBE_OUT
  const log = (o) => fs.appendFileSync(out, JSON.stringify(o) + "\n")
  const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
  if (!dsh) { log({ error: "mpdDsh service unavailable" }); return }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  await sleep(1500)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rtl = await dsh.executeTool({ name: "agent_teams_create", arguments: { name: "carrier-probe-rtl", description: "t8 carrier mount proof (rtl-ip)", profile: "rtl-ip", approval: "required" } })
    log({ attempt, profile: "rtl-ip", ok: rtl.ok === true, error: rtl.error ?? null, members: rtl.value?.members?.length ?? null, returnedProfile: rtl.value?.profile ?? null })
    if (rtl.ok === true || String(rtl.error ?? "").includes("unknown AgentTeams profile")) break
    await sleep(500)
  }
  const mpd = await dsh.executeTool({ name: "agent_teams_create", arguments: { name: "carrier-probe-mpd", description: "t8 carrier mount proof (mpd)", profile: "mpd", approval: "required" } })
  log({ profile: "mpd", ok: mpd.ok === true, error: mpd.error ?? null, members: mpd.value?.members?.length ?? null, returnedProfile: mpd.value?.profile ?? null })
  fs.writeFileSync(out + ".done", "1")
}
