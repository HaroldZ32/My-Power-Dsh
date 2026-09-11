// t6 boot-time probe: exercises the workmate TOOLS and SERVICE from outside, inside a REAL
// fresh dsh boot (mounted through `dsh --patch`). No model step is involved: the probe calls
// the registered tools through the bundle's adapter and reads the mpdWorkmate service, which
// is exactly the surface the contract §C/§A4 describes. It prints one RESULT= line the driver
// parses.
export const name = "mpd-t6-probe"

export async function apply(ctx) {
  const out = { steps: [] }
  const step = (id, data) => out.steps.push({ id, ...data })

  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined)
    ?? (await import("/root/dshProj/my-power-dsh/packages/mpd-dsh-adapter-plugin/dist/index.js")).createDshAdapter(ctx)

  const call = async (n, a) => {
    try {
      const r = await dsh.executeTool({ name: n, arguments: a })
      return { ok: r.ok === true, error: r.error === undefined ? undefined : String(r.error), value: r.value }
    } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }

  // The loader applies rows concurrently; wait until this profile's workmate row has registered.
  const deadline = Date.now() + 90000
  let ready = false
  while (Date.now() < deadline) {
    if (typeof dsh.hasTool === "function" && dsh.hasTool("mpd_workmate_reflect")) { ready = true; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  step("probe.tools-registered", { ready, hasInit: typeof dsh.hasTool === "function" ? dsh.hasTool("mpd_workmate_init") : null, hasRename: typeof dsh.hasTool === "function" ? dsh.hasTool("mpd_workmate_rename") : null, hasDelete: typeof dsh.hasTool === "function" ? dsh.hasTool("mpd_workmate_delete") : null })
  if (!ready) { console.log("[t6-probe] RESULT=" + JSON.stringify(out)); return }

  const svc = typeof ctx.get === "function" ? ctx.get("mpdWorkmate") : undefined
  step("probe.service-present", { present: svc !== undefined, hasRename: typeof svc?.rename === "function", hasDelete: typeof svc?.delete === "function", hasGet: typeof svc?.get === "function", hasRead: typeof svc?.read === "function" })

  step("tool.init", await call("mpd_workmate_init", { base: "hephaestus", name: "probe-1", note: "t6 probe fixture" }))
  const before = svc?.get?.("probe-1")
  step("service.get.before", { name: before?.name, uses: before?.uses, createdAt: before?.createdAt, renamedFrom: before?.renamedFrom })

  step("tool.rename", await call("mpd_workmate_rename", { name: "probe-1", new_name: "probe-2" }))
  step("service.get.old-key-freed", { value: svc?.get?.("probe-1") ?? null })

  step("tool.reflect.after-rename", await call("mpd_workmate_reflect", { name: "probe-2", task: "t6 verification of reflect-after-rename", outcome: "renamedFrom must survive a reflect; old key stays dead" }))

  const after = svc?.get?.("probe-2")
  step("service.get.after-reflect", {
    name: after?.name,
    uses: after?.uses,
    createdAt: after?.createdAt,
    renamedFrom: after?.renamedFrom,
    memoryLen: typeof after?.memory === "string" ? after.memory.length : null,
    noteLen: typeof after?.note === "string" ? after.note.length : null,
  })
  step("service.get.stale-key-after-reflect", { value: svc?.get?.("probe-1") ?? null })

  step("tool.list", await call("mpd_workmate_list", {}))
  step("tool.delete.purge-without-confirm", await call("mpd_workmate_delete", { name: "probe-2", purge: true }))
  step("tool.delete.purge-with-confirm", await call("mpd_workmate_delete", { name: "probe-2", purge: true, confirm: "probe-2" }))
  step("tool.list.after-purge", await call("mpd_workmate_list", {}))
  step("service.get.after-purge", { value: svc?.get?.("probe-2") ?? null })

  console.log("[t6-probe] RESULT=" + JSON.stringify(out))
}
