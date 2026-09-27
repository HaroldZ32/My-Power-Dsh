// Container-side probe: why is `mpd-config` not in `settings.describe()`? Distinguish the three
// possible reasons — not in the editor's configuration(), no schema on the fiber runtime, or no
// volatile node in that schema.
export const name = "mpd-settings-probe"
export const inject = ["settings"]
export function apply(ctx) {
  const runtimeOf = (row) => row?.entry?.fiber?.runtime?.Config
  setTimeout(async () => {
    try {
      const settings = ctx.get("settings")
      const editor = settings.ownerContext?.configEditor
      const configuration = typeof editor?.configuration === "function" ? editor.configuration() : []
      const ids = configuration.map((row) => row?.entry?.id)
      const mpdIds = ids.filter((id) => typeof id === "string" && id.toLowerCase().includes("mpd"))
      console.log("[settings-probe] configuration=" + configuration.length + " mpdRows=" + mpdIds.slice(0, 8).join(",") + " sample=" + ids.slice(0, 6).join(","))
      const mine = configuration.find((row) => String(row?.entry?.id ?? "").endsWith("mpd-config"))
      console.log("[settings-probe] mpd-config in configuration: " + (mine === undefined ? "NO" : "YES"))
      if (mine !== undefined) {
        const runtime = mine.entry?.fiber?.runtime
        const schema = runtime?.Config
        console.log("[settings-probe] runtime.Config: " + (schema === undefined ? "ABSENT" : "present, meta.volatile=" + String(schema.meta?.volatile) + " toJSON=" + String(typeof schema.toJSON)))
        console.log("[settings-probe] fiber state: " + String(mine.entry?.fiber?.state))
      }
      try {
        const mod = await import("file:///src/packages/mpd-config-plugin/dist/index.js")
        console.log("[settings-probe] identity: runtime.Config === module.Config ? " + String(runtimeOf(mine) === mod.Config) + " | module meta.volatile=" + String(mod.Config?.meta?.volatile) + " | module apply.Config===Config: " + String(mod.apply?.Config === mod.Config))
      } catch (error) {
        console.log("[settings-probe] import compare failed: " + String(error?.message ?? error).slice(0, 160))
      }
      const described = settings.describe()
      console.log("[settings-probe] describe=" + (Array.isArray(described) ? described.length : "n/a") + " has=" + (Array.isArray(described) && described.some((row) => row?.ns === "mpd-config")))
    } catch (error) {
      console.log("[settings-probe] failed: " + String(error?.stack ?? error?.message ?? error).slice(0, 300))
    }
    process.exit(0)
  }, 1500)
}
