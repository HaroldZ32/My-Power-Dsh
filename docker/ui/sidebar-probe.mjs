// Container-side probe: does the sidebar HOST service exist in this composition?
export const name = "mpd-ui-sidebar-probe"
export function apply(ctx) {
  const names = ["betterSidebar", "sidebar", "webSidebar"]
  const found = names.filter((n) => { try { return ctx.get(n, false) !== undefined } catch { return false } })
  let entries = []
  try { entries = [...ctx.loader.entries()].map((e) => e.options?.id + ":" + String(e.options?.name).slice(0, 60)) } catch { /* no loader */ }
  console.log("[ui-probe] sidebarServices=" + (found.length ? found.join(",") : "NONE") +
    " | betterSidebarEntry=" + (entries.filter((e) => /sidebar/i.test(e)).join(" ") || "none"))
  setTimeout(() => process.exit(0), 400)
}
