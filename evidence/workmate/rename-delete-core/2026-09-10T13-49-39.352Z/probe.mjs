// t15 boot-time probe: drives the three mutation tool calls that the schema defect rejected —
// mpd_workmate_rename, mpd_workmate_delete (archive) and mpd_workmate_delete (purge) — through a
// REAL fresh dsh boot, i.e. through the harness tool runtime and ITS output validator. No model step
// is involved: the probe runs at boot, which is what makes this half credential-free.
//
// It reports, per call, exactly what `dsh.executeTool` answered: the error string the harness
// produced (the defect: `tool "…" returned invalid output: "value.ok" is not a declared property`)
// and the value the tool returned, plus the library state afterwards. The driver asserts on the
// RESULT= line and on the sandbox filesystem.
export const name = "mpd-t15-output-schema-probe"

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
  const deadline = Date.now() + 120000
  let ready = false
  while (Date.now() < deadline) {
    if (typeof dsh.hasTool === "function" && dsh.hasTool("mpd_workmate_reflect")) { ready = true; break }
    await new Promise((r) => setTimeout(r, 500))
  }
  step("probe.tools-registered", {
    ready,
    hasRename: typeof dsh.hasTool === "function" ? dsh.hasTool("mpd_workmate_rename") : null,
    hasDelete: typeof dsh.hasTool === "function" ? dsh.hasTool("mpd_workmate_delete") : null,
  })
  if (!ready) { console.log("[t15-probe] RESULT=" + JSON.stringify(out)); return }

  const svc = typeof ctx.get === "function" ? ctx.get("mpdWorkmate") : undefined

  step("tool.init", await call("mpd_workmate_init", { base: "hephaestus", name: "t15-probe", note: "t15 output-schema fixture" }))

  // ── 1) rename: the call whose success used to be reported as a failure ────────────────────────
  const rename = await call("mpd_workmate_rename", { name: "t15-probe", new_name: "t15-probe-2" })
  step("tool.rename", rename)
  step("state.after-rename", { oldKey: svc?.get?.("t15-probe") ?? null, newKeyExists: svc?.get?.("t15-probe-2") ? true : false })

  // The cost of the defect, measured: an agent that believes the call FAILED retries the name it was
  // told failed, and the retry must answer "no workmate named" — because the first call succeeded
  // silently. (The retry is the same call, so it also reports invalid output: a second defect sample.)
  step("tool.rename.retry-after-reported-failure", await call("mpd_workmate_rename", { name: "t15-probe", new_name: "t15-probe-3" }))

  // The retry answers differently per phase, so the archive target is whatever now exists:
  //   after the fix the retry is a SUCCESS (probe-3), before the fix it errors and probe-2 remains.
  const liveKey = svc?.list?.().map((w) => w.name).find((n) => n.startsWith("t15-probe")) ?? null
  step("state.live-key", { liveKey })

  // ── 2) delete, ARCHIVE path (D1 default) ──────────────────────────────────────────────────────
  const archived = await call("mpd_workmate_delete", { name: liveKey })
  step("tool.delete.archive", archived)
  step("state.after-archive", { get: svc?.get?.(liveKey) ?? null, listContains: (svc?.list?.() ?? []).some((w) => w.name === liveKey) })

  // ── 3) delete, PURGE path (explicit confirm === name) ─────────────────────────────────────────
  step("tool.init.purge-fixture", await call("mpd_workmate_init", { base: "hephaestus", name: "t15-purge", note: "t15 purge fixture" }))
  const purged = await call("mpd_workmate_delete", { name: "t15-purge", purge: true, confirm: "t15-purge" })
  step("tool.delete.purge", purged)
  step("state.after-purge", { get: svc?.get?.("t15-purge") ?? null, listContains: (svc?.list?.() ?? []).some((w) => w.name === "t15-purge") })

  console.log("[t15-probe] RESULT=" + JSON.stringify(out))
}
