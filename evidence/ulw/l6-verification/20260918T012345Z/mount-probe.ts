#!/usr/bin/env node
// L6 mount instrumentation (verification task t2, acceptance 4): a QA probe plugin
// mounted INSIDE a real headless boot (`dsh --patch <overlay>`) that records, from the
// LIVE registries, the facts the acceptance names:
//   (a) the `mpd-ulw` row's own registrations — its two TOOLS, read through the same
//       `tools.get(name)` the adapter's `hasTool` uses (a row whose apply never ran
//       registers neither tool, and a failed apply aborts the whole plugin tree);
//   (b) the command names the LIVE `commands` registry lists for this agent;
//   (c) the shape of the plugin registry it can observe (recorded defensively, never
//       gated on).
// It asserts NOTHING: the assertions live in mount-boot.mjs, which reads this record.
// `--dump-config` cannot replace this probe: it composes rows and never executes plugin
// code (AGENTS.md §4), so it can witness neither a registration nor an apply abort.
import { writeFileSync } from "node:fs"

export const name = "l6-mount-probe"

// The command registry is a harness seam; a QA PROBE may read it directly (the adapter
// rule binds plugin rows, not QA instrumentation) and `inject` makes the mount wait for
// the service instead of racing its registration.
export const inject = ["commands", "tools"]

export function apply(ctx, config = {}) {
  const outFile = config?.outFile
  if (typeof outFile !== "string" || outFile.length === 0) throw new Error("l6-mount-probe: config.outFile is required")
  const record = {
    at: new Date().toISOString(),
    probe: name,
    rows: null,
    tools: null,
    commands: null,
    registryShape: null,
    errors: [],
  }
  const flush = () => {
    try { writeFileSync(outFile, JSON.stringify(record, null, 2) + "\n") } catch (error) { record.errors.push("flush: " + String(error?.message ?? error)) }
  }
  let fired = false

  // `agent/pre-step` is a WATERFALL: await next() first and return its decision verbatim
  // (a bare value would REPLACE the step decision). The real work is deferred so the
  // probe can never delay or alter the step it was woken by.
  ctx.on("agent/pre-step", async (payload, next) => {
    const decision = typeof next === "function" ? await next() : undefined
    if (!fired) {
      fired = true
      setTimeout(() => { try { run(payload?.agent) } catch (error) { record.errors.push(String(error?.message ?? error)); flush() } }, 0)
    }
    return decision
  })

  function run(agent) {
    // (a) the mpd-ulw row's own registrations, through the adapter's own access path.
    const tools = typeof ctx.get === "function" ? ctx.get("tools") : undefined
    const toolLookup = (toolName) => {
      if (tools === undefined || tools === null || typeof tools.get !== "function") return null
      try { const found = tools.get(toolName); return found === undefined || found === null ? false : true } catch (error) { record.errors.push("tools.get(" + toolName + "): " + String(error?.message ?? error)); return null }
    }
    record.tools = {
      serviceMounted: tools !== undefined && tools !== null,
      hasLookup: typeof tools?.get === "function",
      mpd_ultrawork: toolLookup("mpd_ultrawork"),
      mpd_ulw: toolLookup("mpd_ulw"),
    }
    console.log("[l6-mount-probe] TOOLS=" + JSON.stringify(record.tools))
    flush()

    // (b) the live command registry listing for this agent.
    const commands = typeof ctx.get === "function" ? ctx.get("commands") : undefined
    if (commands === undefined || commands === null) {
      record.errors.push("the commands service is not mounted")
      flush()
      return
    }
    try {
      const descriptors = commands.list(agent)
      record.commands = {
        names: descriptors.map((descriptor) => descriptor?.name),
        descriptors: descriptors.map((descriptor) => ({
          name: descriptor?.name,
          description: descriptor?.description,
          hint: descriptor?.input?.hint ?? null,
        })),
      }
      console.log("[l6-mount-probe] LISTED=" + record.commands.names.join(","))
    } catch (error) {
      record.errors.push("list: " + String(error?.message ?? error))
    }
    flush()

    // (c) the observable plugin registry, recorded defensively (never gated on).
    try {
      const root = ctx.root ?? ctx
      const registry = root?.registry
      const shape = {
        hasRootRegistry: registry !== undefined && registry !== null,
        registryKeys: registry !== undefined && registry !== null ? Object.keys(registry).slice(0, 20) : [],
      }
      if (registry && registry.plugins && typeof registry.plugins[Symbol.iterator] === "function") {
        const names = []
        for (const entry of registry.plugins) {
          const pluginName = entry?.name ?? entry?.[0]?.name ?? entry?.options?.name
          if (typeof pluginName === "string") names.push(pluginName)
        }
        shape.pluginNames = names.slice(0, 200)
      }
      record.registryShape = shape
    } catch (error) {
      record.registryShape = { error: String(error?.message ?? error) }
    }
    flush()
  }
}
