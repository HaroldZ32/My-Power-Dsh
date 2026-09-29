// QA-only MOUNT probe (B4 / t4): proves the mpd-hashline row APPLIED in a real boot and that the
// LIVE registered `mpd_hashline_edit` parameter schema is the fixed one — read from the running tool
// registry, never from the source files — plus a real mpd_hashline_read + two real mpd_hashline_edit
// calls (one carrying `lines` as a string, one as an array of strings).
// Mounted by an overlay patch (see mount-proof.sh). Plain JS on purpose: the host imports this file
// directly, so it must not import TypeScript.
export const name = "mpd-qa-hashline-mount-probe"
export const inject = ["tools"]

const HASHLINE_TOOLS = [
  "mpd_hashline_read",
  "mpd_hashline_edit",
  "mpd_hashline_format",
  "mpd_hashline_restore",
]

const anchorsOf = (view) =>
  String(view).split("\n").filter((l) => l.includes("|")).map((l) => l.slice(0, l.indexOf("|")))

export function apply(ctx) {
  // Defer: the loader applies rows concurrently, so reading the registry immediately would race the
  // rows still registering. A short settle window makes the read deterministic.
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      const def = (n) => {
        try {
          if (typeof tools?.get === "function") return tools.get(n)
          return undefined
        } catch {
          return undefined
        }
      }
      const has = (n) => {
        try {
          return dsh && typeof dsh.hasTool === "function" ? dsh.hasTool(n) : def(n) !== undefined
        } catch {
          return false
        }
      }

      const present = HASHLINE_TOOLS.filter(has)
      console.log("[hashline-probe] HASHLINE_TOOLS_PRESENT=" + present.length + "/" + HASHLINE_TOOLS.length)
      console.log("[hashline-probe] HASHLINE_TOOLS=" + HASHLINE_TOOLS.map((n) => n + ":" + (has(n) ? "ok" : "MISSING")).join(","))

      // The LIVE schema of the booted row — the artifact under test, not the source tree.
      const liveEdit = def("mpd_hashline_edit")
      const liveParams = JSON.stringify(liveEdit?.parameters ?? {})
      const linesNode = liveEdit?.parameters?.properties?.edits?.items?.properties?.lines
      console.log("[hashline-probe] LIVE_PARAMS_BYTES=" + liveParams.length)
      console.log("[hashline-probe] LIVE_SCHEMA_TYPE_ARRAY=" + (/"type"\s*:\s*\[/.test(liveParams) ? "PRESENT" : "absent"))
      console.log("[hashline-probe] LIVE_LINES_NODE=" + JSON.stringify(linesNode))

      if (!dsh || typeof dsh.executeTool !== "function") {
        console.log("[hashline-probe] ADAPTER=missing (cannot make real tool calls)")
        console.log("[hashline-probe] DONE")
        return
      }

      const fs = await import("node:fs")
      const os = await import("node:os")
      const nodePath = await import("node:path")
      const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "mpd-hashline-probe-"))
      const file = nodePath.join(dir, "sample.txt")
      fs.writeFileSync(file, "alpha\nbeta\ngamma\n")

      const read = await dsh.executeTool({ name: "mpd_hashline_read", arguments: { path: file }, callId: "hashline-probe-read" })
      const view = String(read?.value?.view ?? "")
      console.log("[hashline-probe] READ=" + (read?.ok ? "ok" : "fail:" + String(read?.error)) + " lines=" + String(read?.value?.lines ?? "-"))
      const a1 = anchorsOf(view)

      // 1) `lines` as a single STRING
      const e1 = await dsh.executeTool({
        name: "mpd_hashline_edit",
        arguments: { path: file, edits: [{ op: "replace", pos: a1[1], lines: "BETA" }] },
        callId: "hashline-probe-edit-string",
      })
      console.log("[hashline-probe] EDIT_LINES_STRING=" + (e1?.ok ? "ok" : "fail:" + String(e1?.error)) + " lines=" + String(e1?.value?.lines ?? "-"))

      // 2) `lines` as an ARRAY of strings
      const read2 = await dsh.executeTool({ name: "mpd_hashline_read", arguments: { path: file }, callId: "hashline-probe-read2" })
      const a2 = anchorsOf(String(read2?.value?.view ?? ""))
      const e2 = await dsh.executeTool({
        name: "mpd_hashline_edit",
        arguments: { path: file, edits: [{ op: "replace", pos: a2[2], lines: ["GAMMA-1", "GAMMA-2"] }] },
        callId: "hashline-probe-edit-array",
      })
      console.log("[hashline-probe] EDIT_LINES_ARRAY=" + (e2?.ok ? "ok" : "fail:" + String(e2?.error)) + " lines=" + String(e2?.value?.lines ?? "-"))

      console.log("[hashline-probe] FINAL_CONTENT=" + JSON.stringify(fs.readFileSync(file, "utf8")))
      console.log("[hashline-probe] DONE")
    } catch (e) {
      console.log("[hashline-probe] FAIL=" + String(e?.message ?? e))
    }
  }, 8000)
}
