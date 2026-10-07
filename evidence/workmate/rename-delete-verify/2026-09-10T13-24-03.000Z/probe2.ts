// t6 focused probe #2: (a) captures the raw harness error for each of the two NEW tools,
// (b) re-checks the positives on the tool path (uses preserved across rename, reflect writes
// memory, renamedFrom survives reflect), and (c) runs a credential-free A/B control on the
// read-only deny list through the real child-composition path.
export const name = "mpd-t6-probe2"

export async function apply(ctx) {
  const out = { steps: [] }
  const step = (id, data) => out.steps.push({ id, ...data })
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined)
    ?? (await import("/root/dshProj/my-power-dsh/packages/mpd-dsh-adapter-plugin/dist/index.js")).createDshAdapter(ctx)

  const call = async (n, a) => {
    try { const r = await dsh.executeTool({ name: n, arguments: a }); return { ok: r.ok === true, error: r.error === undefined ? undefined : String(r.error), value: r.value } }
    catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }
  const deadline = Date.now() + 90000
  while (Date.now() < deadline && !(typeof dsh.hasTool === "function" && dsh.hasTool("mpd_workmate_init"))) await new Promise((r) => setTimeout(r, 500))
  const svc = typeof ctx.get === "function" ? ctx.get("mpdWorkmate") : undefined

  // ── (a)+(b) tool-path behaviour ───────────────────────────────────────────
  step("init", await call("mpd_workmate_init", { base: "hephaestus", name: "probe-a", note: "t6 probe2 fixture" }))
  const g0 = svc?.get?.("probe-a")
  step("service.get.after-init", { keys: g0 === undefined || g0 === null ? null : Object.keys(g0), name: g0?.name, uses: g0?.uses, createdAt: g0?.createdAt, renamedFrom: g0?.renamedFrom })

  step("rename.raw", await call("mpd_workmate_rename", { name: "probe-a", new_name: "probe-b" }))
  const g1 = svc?.get?.("probe-b")
  step("service.get.after-rename", { name: g1?.name, uses: g1?.uses, createdAt: g1?.createdAt, renamedFrom: g1?.renamedFrom, oldKey: svc?.get?.("probe-a") ?? null })

  step("reflect.raw", await call("mpd_workmate_reflect", { name: "probe-b", task: "t6 probe2", outcome: "reflect after rename" }))
  const g2 = svc?.get?.("probe-b")
  step("service.get.after-reflect", { name: g2?.name, uses: g2?.uses, createdAt: g2?.createdAt, renamedFrom: g2?.renamedFrom })

  step("delete.archive.raw", await call("mpd_workmate_delete", { name: "probe-b" }))

  step("init2", await call("mpd_workmate_init", { base: "hephaestus", name: "probe-c", note: "purge fixture" }))
  step("delete.purge.raw", await call("mpd_workmate_delete", { name: "probe-c", purge: true, confirm: "probe-c" }))
  step("delete.confirm-missing.raw", await call("mpd_workmate_delete", { name: "probe-c", purge: true }))

  // ── (c) deny-list A/B through the REAL child-composition path ─────────────
  let rolesDeny, wmDeny
  try {
    rolesDeny = (await import("/root/dshProj/my-power-dsh/packages/mpd-roles-plugin/dist/index.js")).READONLY_DENY
    wmDeny = (await import("/root/dshProj/my-power-dsh/packages/mpd-workmate-plugin/dist/index.js")).READONLY_DENY
  } catch (e) { step("deny.import-error", { error: String(e?.message ?? e) }) }
  step("deny.lists", { roles: rolesDeny, workmate: wmDeny })
  // Live-registry inclusion: `hasTool` reads the GLOBAL tool view, which is exactly the set
  // `tools.restrict()` validates a deny list against ("known global tools"). A name that is
  // absent here is a name that aborts every read-only spawn.
  if (typeof dsh.hasTool === "function") {
    const probeNames = [...new Set([...(rolesDeny ?? []), ...(wmDeny ?? [])])]
    step("deny.registry-inclusion", {
      live: Object.fromEntries(probeNames.map((n) => [n, dsh.hasTool(n)])),
      dead: { str_replace_editor: dsh.hasTool("str_replace_editor"), apply_patch: dsh.hasTool("apply_patch") },
      runCode: dsh.hasTool("run_code"),
      read: dsh.hasTool("read"), glob: dsh.hasTool("glob"), grep: dsh.hasTool("grep"),
    })
  }
  const spawnWith = async (label, deny) => {
    try {
      const r = await Promise.race([
        dsh.spawnAgent({ label, prompt: "Reply with OK.", provider: "deepseek-official", model: "deepseek-v4-pro", toolFilter: { deny } }),
        new Promise((res) => setTimeout(() => res({ output: "", stopReason: "t6-probe-timeout" }), 25000)),
      ])
      return { resolved: true, stopReason: r?.stopReason ?? null, output: String(r?.output ?? "").slice(0, 200) }
    } catch (e) { return { resolved: false, error: String(e?.message ?? e) } }
  }
  step("deny.A.roles-real", await spawnWith("t6-a-roles", rolesDeny ?? []))
  step("deny.B.roles-plus-dead-name", await spawnWith("t6-b-roles", [...(rolesDeny ?? []), "str_replace_editor"]))
  step("deny.C.workmate-real", await spawnWith("t6-c-wm", wmDeny ?? []))
  step("deny.D.workmate-plus-dead-name", await spawnWith("t6-d-wm", [...(wmDeny ?? []), "apply_patch"]))

  console.log("[t6-probe2] RESULT=" + JSON.stringify(out))
}
