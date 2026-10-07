// t9 VERIFIER-WRITTEN mount probe (independent of evidence/hashline/** and evidence/fix/**).
// It is mounted into a REAL boot with `--patch` and makes real tool calls through the adapter:
//   B3  -> mpd_verif_backends for iverilog, verilator, all, vcs
//   B4  -> live registry schema for mpd_hashline_edit + real read/edit with `lines` string and array
//   B5  -> real mpd_comment_check on comment-bearing and comment-clean input
// The row is plain ESM JS on purpose: the host imports this file directly.
export const name = "t9-mount-probe"
export const inject = ["tools"]

const say = (k, v) => console.log("[t9-probe] " + k + "=" + v)

// Deep scan for undefined-valued properties (what the harness "lossless JSON" snapshot rejects)
// and for sparse array slots.
function undefinedPaths(v, path, out) {
  if (v === undefined) { out.push(path); return out }
  if (v === null) return out
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) out.push(path + "[" + i + "]<hole>")
      else undefinedPaths(v[i], path + "[" + i + "]", out)
    }
    return out
  }
  if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) out.push(path + "." + k)
      else undefinedPaths(v[k], path + "." + k, out)
    }
  }
  return out
}

export function apply(ctx) {
  // The loader applies rows concurrently; a settle window makes the registry read deterministic.
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const def = (n) => { try { return typeof tools?.get === "function" ? tools.get(n) : undefined } catch { return undefined } }
      const want = ["mpd_verif_backends", "mpd_comment_check", "mpd_hashline_read", "mpd_hashline_edit"]
      say("TOOLS", want.map((n) => n + ":" + (def(n) ? "ok" : "MISSING")).join(","))
      say("ADAPTER_EXECUTE_TOOL", dsh && typeof dsh.executeTool === "function" ? "ok" : "missing")
      if (!dsh || typeof dsh.executeTool !== "function") { say("DONE", "no adapter"); return }

      const call = async (name, args, callId) => {
        try { return await dsh.executeTool({ name, arguments: args, callId }) }
        catch (e) { return { ok: false, isError: true, error: "throw:" + String(e?.message ?? e) } }
      }
      const brief = (r) => "ok=" + String(r?.ok) + " isError=" + String(r?.isError) + " error=" + String(r?.error ?? "").slice(0, 160)

      // ---------- B3 ----------
      for (const sel of ["iverilog", "verilator", "all", "vcs"]) {
        const r = await call("mpd_verif_backends", { backend: sel }, "t9-b3-" + sel)
        const value = r?.value
        const undef = value === undefined ? ["<no value>"] : undefinedPaths(value, "value", [])
        const probes = Array.isArray(value?.backends) ? value.backends : []
        const shapes = probes.map((b) => b.backend + "{" + ["source=" + b.source, "present=" + b.present, "version=" + JSON.stringify(b.version), "licenseHint=" + JSON.stringify(b.licenseHint), "bin=" + b.binary].join(",") + "}")
        say("B3_" + sel.toUpperCase(), brief(r) + " count=" + probes.length + " undef=" + JSON.stringify(undef))
        say("B3_" + sel.toUpperCase() + "_SHAPE", shapes.join(" | "))
      }

      // ---------- B4 ----------
      const liveEdit = def("mpd_hashline_edit")
      const liveParams = JSON.stringify(liveEdit?.parameters ?? {})
      say("B4_LIVE_PARAMS_BYTES", liveParams.length)
      say("B4_LIVE_TYPE_ARRAY", /"type"\s*:\s*\[/.test(liveParams) ? "PRESENT" : "absent")
      say("B4_LIVE_LINES_NODE", JSON.stringify(liveEdit?.parameters?.properties?.edits?.items?.properties?.lines ?? null))
      const liveUndef = undefinedPaths(liveEdit?.parameters, "parameters", [])
      say("B4_LIVE_PARAMS_UNDEF_PATHS", JSON.stringify(liveUndef))

      const fs = await import("node:fs")
      const os = await import("node:os")
      const p = await import("node:path")
      const dir = fs.mkdtempSync(p.join(os.tmpdir(), "t9-probe-"))
      const file = p.join(dir, "sample.txt")
      fs.writeFileSync(file, "alpha\nbeta\ngamma\n")
      const anchors = (view) => String(view).split("\n").filter((l) => l.includes("|")).map((l) => l.slice(0, l.indexOf("|")))
      const rd = await call("mpd_hashline_read", { path: file }, "t9-b4-read")
      say("B4_READ", brief(rd) + " lines=" + String(rd?.value?.lines ?? "-"))
      const a1 = anchors(rd?.value?.view)
      const e1 = await call("mpd_hashline_edit", { path: file, edits: [{ op: "replace", pos: a1[1], lines: "BETA" }] }, "t9-b4-edit-string")
      say("B4_EDIT_LINES_STRING", brief(e1) + " lines=" + String(e1?.value?.lines ?? "-"))
      const rd2 = await call("mpd_hashline_read", { path: file }, "t9-b4-read2")
      const a2 = anchors(rd2?.value?.view)
      const e2 = await call("mpd_hashline_edit", { path: file, edits: [{ op: "replace", pos: a2[2], lines: ["GAMMA-1", "GAMMA-2"] }] }, "t9-b4-edit-array")
      say("B4_EDIT_LINES_ARRAY", brief(e2) + " lines=" + String(e2?.value?.lines ?? "-"))
      say("B4_FINAL_CONTENT", JSON.stringify(fs.readFileSync(file, "utf8")))

      // ---------- B5 ----------
      const cPath = p.join(dir, "comment_bearing.js")
      const cleanPath = p.join(dir, "clean.js")
      fs.writeFileSync(cPath, "// a comment\nlet x = 1\n")
      fs.writeFileSync(cleanPath, "let x = 1\nconst y = 2\n")
      const c1 = await call("mpd_comment_check", { files: [{ path: cPath, content: "// a comment\nlet x = 1\n" }, { path: cleanPath, content: "let x = 1\nconst y = 2\n" }] }, "t9-b5-comment")
      say("B5_MAIN", brief(c1))
      say("B5_MAIN_VALUE", JSON.stringify(c1?.value ?? null).slice(0, 1200))
      const c2 = await call("mpd_comment_check", { files: [{ path: "on-disk.js" }] }, "t9-b5-viadisk")
      say("B5_ONDISK_NO_CONTENT", brief(c2) + " value=" + JSON.stringify(c2?.value ?? null).slice(0, 400))

      say("DONE", "ok")
    } catch (e) {
      say("FAIL", String(e?.message ?? e))
    }
  }, 9000)
}
