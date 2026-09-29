// t9 positive CONTROL probe: proves that a tool value with an undefined-valued property IS
// rejected by the harness snapshot when executed through the adapter's executeTool path — i.e.
// that the green B3 result in t9-mount-probe.mjs is not vacuous. Two synthetic tools are
// registered and called in the SAME boot: one lossy (undefined property) and one clean (null).
export const name = "t9-lossless-control-probe"
export const inject = ["tools"]

const say = (k, v) => console.log("[t9-control] " + k + "=" + v)

export function apply(ctx) {
  setTimeout(async () => {
    try {
      const tools = (typeof ctx.get === "function" ? ctx.get("tools") : undefined) ?? ctx.tools
      const dsh = typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined
      if (!tools?.register || !dsh?.executeTool) { say("SETUP", "missing register/executeTool"); say("DONE", "ok"); return }
      // The adapter requires an output block; the harness snapshots the value BEFORE output-schema
      // validation, which is exactly the path under test here.
      const out = {
        schema: { type: "object", properties: { present: { type: "boolean" }, hidden: { oneOf: [{ type: "string" }, { type: "null" }] } } },
        render: (_a, v) => [{ type: "text", text: JSON.stringify(v) }],
      }
      tools.register({
        name: "t9_lossy_control",
        description: "t9 control: returns a result with an undefined-valued property",
        parameters: { type: "object", properties: {} },
        output: out,
        execute: async () => ({ present: true, hidden: undefined }),
      })
      tools.register({
        name: "t9_clean_control",
        description: "t9 control: returns a result whose optional key is null, never undefined",
        parameters: { type: "object", properties: {} },
        output: out,
        execute: async () => ({ present: true, hidden: null }),
      })
      const call = async (n) => { try { return await dsh.executeTool({ name: n, arguments: {}, callId: "t9-ctl-" + n }) } catch (e) { return { ok: false, isError: true, error: "throw:" + String(e?.message ?? e) } } }
      const lossy = await call("t9_lossy_control")
      say("LOSSY_OK", String(lossy?.ok))
      say("LOSSY_ISERROR", String(lossy?.isError))
      say("LOSSY_ERROR", String(lossy?.error ?? "").slice(0, 400))
      say("LOSSY_VALUE", JSON.stringify(lossy?.value ?? null))
      const clean = await call("t9_clean_control")
      say("CLEAN_OK", String(clean?.ok))
      say("CLEAN_ISERROR", String(clean?.isError))
      say("CLEAN_ERROR", String(clean?.error ?? "").slice(0, 400))
      say("CLEAN_VALUE", JSON.stringify(clean?.value ?? null))
      say("DONE", "ok")
    } catch (e) {
      say("FAIL", String(e?.message ?? e))
    }
  }, 8000)
}
