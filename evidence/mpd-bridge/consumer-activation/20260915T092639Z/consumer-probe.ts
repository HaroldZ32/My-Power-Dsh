#!/usr/bin/env node
// t42 consumer probe — the DETERMINISTIC consumer-side observation.
//
// WHY THIS SHAPE: this environment has no model credential (`.credentials.yaml` carries only a
// browser-session record; `settings.yaml` has no provider keys), so a model-driven tool call inside
// a live host boot is impossible here. The consumer link is therefore observed by applying the REAL
// built plugin modules the host loads (`mpd-config-plugin/dist` then `mpd-hashline-plugin/dist`,
// the host's own row order) against the REAL sandbox workspace files, and invoking the REAL
// registered tool. The plugin's value is captured at APPLY time (`mergedConfig` → the closure
// constant), which is exactly why a restart is required — and this probe can hold one instance
// across an external file change to prove that timing claim.
//
// Usage: node consumer-probe.mjs --ws <workspace> --target <file> --json <out.json> [--hold <trigger>]
//   no --hold  → apply, observe, exit          (one "process lifetime")
//   --hold     → apply, observe, wait for <trigger>, then re-read the config layer and re-invoke
//                the SAME instance, then exit  (the no-restart negative control)
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const arg = (key) => { const at = argv.indexOf(key); return at === -1 ? undefined : argv[at + 1] }
const ws = arg("--ws"); const target = arg("--target"); const out = arg("--json"); const hold = arg("--hold")
if (ws === undefined || target === undefined || out === undefined) {
  console.error("usage: consumer-probe.mjs --ws <ws> --target <file> --json <out> [--hold <trigger>]")
  process.exit(2)
}
process.env.DSH_WORKSPACE_ROOT = ws

const REPO = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
const settingsFile = join(ws, ".mpd", "mpd.jsonc")
const fileValueOf = () => {
  try {
    const match = /"maxDiffChars"\s*:\s*(\d+)/.exec(readFileSync(settingsFile, "utf8"))
    return match === null ? null : Number(match[1])
  } catch { return null }
}

// A faithful minimal harness ctx: the adapter resolves through `ctx.get("tools")` for registration
// and provides its own services through `ctx.provide`. Everything else is absent on purpose, so the
// plugins degrade exactly as they do in a composition without those seams.
const registered = []
const services = {}
const toolsService = { register(definition) { registered.push(definition); return () => {} } }
const ctx = {
  get: (id) => (id === "tools" ? toolsService : services[id]),
  provide: (name, value) => { services[name] = value },
  on: () => {},
  effect: (fn) => { const disposer = fn(); return () => { try { disposer?.() } catch { /* teardown */ } } },
}

const steps = []
const record = (phase, extra = {}) => {
  const entry = {
    phase,
    pid: process.pid,
    // WHAT THE CONSUMER CAPTURED AT APPLY TIME and what it does with it: the diff the real
    // `mpd_hashline_edit` tool returns is sliced to the value this instance read when it mounted.
    consumerDiffLength: null,
    fileValue: fileValueOf(),
    configLayerValue: typeof services.mpdConfig?.get === "function" ? services.mpdConfig.get("hashline.maxDiffChars") : null,
    ...extra,
  }
  steps.push(entry)
  return entry
}

try {
  const configModule = await import(join(REPO, "packages/mpd-config-plugin/dist/index.js"))
  const hashlineModule = await import(join(REPO, "packages/mpd-hashline-plugin/dist/index.js"))
  configModule.apply(ctx, {})       // the host's row order: config first, consumer second
  hashlineModule.apply(ctx, {})
  const tool = (name) => registered.find((definition) => definition.name === name)
  const invoke = async (name, args) => tool(name).execute(args, {})

  const pristine = Array.from({ length: 40 }, (_, i) => "line " + String(i + 1)).join("\n") + "\n"
  const observe = async (phase) => {
    // Reset the fixture first: every observation must measure the truncation of a NON-EMPTY diff,
    // otherwise a second edit of the same content returns an empty diff and proves nothing.
    writeFileSync(target, pristine)
    const view = await invoke("mpd_hashline_read", { path: target })
    const anchor = String(view.view).split("\n")[0].split("|")[0]
    const edited = await invoke("mpd_hashline_edit", {
      path: target,
      edits: [{ op: "replace", pos: anchor, lines: "consumer observation " + "x".repeat(400) }],
    })
    return record(phase, { consumerDiffLength: String(edited.diff ?? "").length, diffHead: String(edited.diff ?? "").slice(0, 40) })
  }

  const flush = () => writeFileSync(out, JSON.stringify({ ws, target, mode: hold === undefined ? "once" : "hold", steps }, null, 2) + "\n")
  record("apply", { registeredTools: registered.map((definition) => definition.name) })
  flush()
  await observe("first-observation")
  flush()

  if (hold !== undefined) {
    const deadline = Date.now() + 240000
    while (Date.now() < deadline && !existsSync(hold)) await new Promise((r) => setTimeout(r, 500))
    if (!existsSync(hold)) { record("hold-timeout"); }
    else {
      // The external change happened (settings write + bridge write-back). Re-read the config layer
      // — it must now serve the NEW value — and re-invoke the SAME consumer instance, whose captured
      // value must still be the OLD one. That difference IS the "restart is required" claim.
      try { await services.mpdConfig.reload?.() } catch { /* reload is best-effort */ }
      record("after-external-change-same-process")
      flush()
      await observe("same-process-re-invocation")
      flush()
    }
  }
  writeFileSync(out, JSON.stringify({ ws, target, mode: hold === undefined ? "once" : "hold", steps }, null, 2) + "\n")
  console.log(JSON.stringify({ ok: true, mode: hold === undefined ? "once" : "hold", steps }, null, 2))
} catch (error) {
  record("error", { error: String(error?.stack ?? error) })
  writeFileSync(out, JSON.stringify({ ws, target, mode: hold === undefined ? "once" : "hold", steps, ok: false }, null, 2) + "\n")
  console.error(String(error?.stack ?? error))
  process.exit(1)
}
