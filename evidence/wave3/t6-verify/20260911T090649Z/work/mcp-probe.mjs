// t6 (Reviewer) QA-only probe: at boot, call the ast-grep MCP tool through the
// shared adapter and print a machine-readable marker. Mounted only by the t6
// verification overlay, never shipped. This answers the question "do the MCP
// tools answer in a real boot whose rows were resolved by the dev-flavor patch?"
// WITHOUT needing a model credential: the call goes through the same adapter
// surface a plugin/tool call uses (executeTool), while the MCP child was spawned
// by the real dsh-mcp-client row from the patch under test.
const FIXTURE = process.env.T6_FIXTURE
const TOOL = "mcp__ast_grep__search"

export const name = "t6-mcp-probe"

export async function apply(ctx) {
  const adapter = await import(
    "/root/dshProj/my-power-dsh/packages/mpd-dsh-adapter-plugin/dist/index.js"
  )
  const dsh =
    (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ??
    adapter.createDshAdapter(ctx)
  const has = typeof dsh.hasTool === "function" ? dsh.hasTool(TOOL) : "no-hasTool"
  console.log("[t6-mcp-probe] HAS_TOOL=" + String(has) + " fixture=" + String(FIXTURE))
  let last = "not-attempted"
  for (let i = 0; i < 60; i++) {
    try {
      const call = await dsh.executeTool({
        name: TOOL,
        arguments: { pattern: "return 0", language: "c", paths: [FIXTURE] },
      })
      if (call && call.ok === true) {
        const text = JSON.stringify(call.value ?? call).slice(0, 600)
        console.log("[t6-mcp-probe] MCP_TOOL_CALL=ok attempt=" + i + " value=" + text)
        return
      }
      last = "not-ok:" + JSON.stringify(call?.error ?? call).slice(0, 400)
    } catch (e) {
      last = "throw:" + String(e?.message ?? e).slice(0, 400)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log("[t6-mcp-probe] MCP_TOOL_CALL=fail last=" + last)
  process.exitCode = 1
}
