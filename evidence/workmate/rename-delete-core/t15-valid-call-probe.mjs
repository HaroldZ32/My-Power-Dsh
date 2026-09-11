// Reviewer probe for t6-F1 / t15: drive the NEW agent tools with VALID inputs through the harness's
// real output validator on a real boot. My t12 mount proof called `mpd_workmate_delete` with an
// INVALID name, which is refused before any value is produced — so the output validator never ran and
// the `additionalProperties: false` defect (tool returned `ok` while the schema did not declare it)
// stayed invisible. This probe closes exactly that gap: every mutation call below SUCCEEDS, so each
// result must pass the validator, and any "returned invalid output" text is a failure of the repair.
// Dependency-free plain JS: the host imports this file directly, so it must not import TypeScript.
export const name = "mpd-qa-valid-call-probe"
export const inject = ["tools"]

export function apply(ctx) {
  setTimeout(async () => {
    const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
    const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
    const call = async (name, args, id) => {
      const raw = dsh && typeof dsh.executeTool === "function"
        ? await dsh.executeTool({ name, arguments: args, callId: "probe-" + id })
        : { ok: false, error: "adapter unavailable" }
      const errorText = String(raw?.error ?? raw?.raw?.error?.message ?? "")
      const invalid = /returned invalid output|is not a declared property|additionalProperties/.test(errorText)
      const value = raw?.value ?? raw?.raw?.value
      console.log("[valid-call] " + id + " " + name + " ok=" + String(raw?.ok) +
        (errorText ? " error=" + JSON.stringify(errorText.slice(0, 200)) : "") +
        " INVALID_OUTPUT=" + String(invalid))
      return { id, name, ok: raw?.ok === true, invalid, value }
    }
    try {
      const calls = []
      calls.push(await call("mpd_workmate_init", { base: "hephaestus", name: "probe-wm-1" }, "init1"))
      calls.push(await call("mpd_workmate_rename", { name: "probe-wm-1", new_name: "probe-wm-2" }, "rename"))
      const listAfterRename = await call("mpd_workmate_list", {}, "list1")
      const names = (listAfterRename.value?.workmates ?? []).map((w) => w.name)
      console.log("[valid-call] RENAME_LANDED=" + String(names.includes("probe-wm-2") && !names.includes("probe-wm-1")) + " names=" + JSON.stringify(names))
      calls.push(await call("mpd_workmate_delete", { name: "probe-wm-2" }, "delete-archive"))
      calls.push(await call("mpd_workmate_init", { base: "hephaestus", name: "probe-wm-3" }, "init2"))
      calls.push(await call("mpd_workmate_delete", { name: "probe-wm-3", purge: true, confirm: "probe-wm-3" }, "delete-purge"))
      const listAfter = await call("mpd_workmate_list", {}, "list2")
      console.log("[valid-call] FINAL names=" + JSON.stringify((listAfter.value?.workmates ?? []).map((w) => w.name)))
      const byId = Object.fromEntries(calls.map((c) => [c.id, c]))
      console.log("[valid-call] RENAME_OK=" + String(byId.rename?.ok === true))
      console.log("[valid-call] DELETE_ARCHIVE_OK=" + String(byId["delete-archive"]?.ok === true))
      console.log("[valid-call] DELETE_PURGE_OK=" + String(byId["delete-purge"]?.ok === true))
      console.log("[valid-call] INVALID_OUTPUT_ERRORS=" + calls.filter((c) => c.invalid).length)
      console.log("[valid-call] DONE")
    } catch (e) {
      console.log("[valid-call] FAIL=" + String(e?.message ?? e))
    }
  }, 8000)
}
