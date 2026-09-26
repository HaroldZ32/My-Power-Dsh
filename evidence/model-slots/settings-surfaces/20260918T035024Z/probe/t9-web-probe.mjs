// QA-only probe for t9 (verification lane, settings surfaces). NOT shipped in the bundle:
// it is inserted into a sandbox boot by driver/t9-web-mount.mjs through a `--patch` overlay.
//
// It reads the SETTINGS surfaces of the three team-model slots from INSIDE a real bundled
// boot — the `mpdConfig` service, the host settings namespace descriptor, and the
// `mpd_config_get` tool payloads — and performs ONE mutate through the adapter's settings
// seam to prove the round-trip. Every observation is printed as a single `[t9-probe]
// T9_RESULT {json}` line; nothing is inferred from prose, and the probe NEVER throws out of
// apply (a throw would be an apply-crash signature).
//
// Plugin shape: pure ESM, `name` + `apply`, no default export (AGENTS.md §6). No harness
// service is touched directly — the adapter (`mpdDsh`) is the ONE contact surface.
export const name = "mpd-dsh-qa-settings-probe"
export const inject = []

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const emit = (line) => console.log("[t9-probe] " + line)

/** Bounded wait for a predicate; returns the last value seen. */
async function waitFor(fn, tries, everyMs) {
  let last
  for (let i = 0; i < tries; i += 1) {
    try { last = fn() } catch { last = undefined }
    if (last !== undefined && last !== null) return last
    await sleep(everyMs)
  }
  return last
}

export async function apply(ctx) {
  const out = {
    probe: "t9-web-probe",
    adapter: {},
    namespace: {},
    namespaceRaw: {},
    service: {},
    tool: {},
    mutate: {},
    afterUnset: {},
    errors: [],
    warnings: [],
  }
  try {
    // The loader applies rows concurrently: wait for the config row and for the settings
    // provider before reading anything (a read taken too early is a false negative).
    const config = await waitFor(() => ctx.get?.("mpdConfig"), 120, 250)
    const dsh = await waitFor(() => ctx.get?.("mpdDsh"), 120, 250)
    out.adapter = {
      found: dsh !== undefined,
      hasSettingsReader: typeof dsh?.settingsReader === "function",
      hasSettingsMutate: typeof dsh?.settingsMutate === "function",
      hasExecuteTool: typeof dsh?.executeTool === "function",
    }
    if (config === undefined) { out.errors.push("mpdConfig service never appeared"); emit("T9_RESULT " + JSON.stringify(out)); return }

    // The namespace is registered by mpd-config; wait until it is SERVED (describe() answers
    // with a revision) rather than reading the transient "not yet" state.
    const reader = await waitFor(() => {
      const candidate = dsh?.settingsReader?.("mpd")
      const described = candidate?.describe?.()
      return described?.revision !== undefined ? candidate : undefined
    }, 120, 250) ?? dsh?.settingsReader?.("mpd")

    const described = reader?.describe?.()
    const namespaceSlots = described?.value?.teamModels ?? null
    out.namespace = {
      revision: described?.revision ?? null,
      applies: described?.applies ?? null,
      topLevelKeys: Object.keys(described?.value ?? {}).sort(),
      teamModels: namespaceSlots,
      // the NINE registered knob paths, read off the SERVED namespace descriptor
      slotPaths: namespaceSlots === null ? null : Object.keys(namespaceSlots).flatMap((slot) => Object.keys(namespaceSlots[slot] ?? {}).map((leaf) => "teamModels." + slot + "." + leaf)).sort(),
    }
    const raw = reader?.get?.()
    out.namespaceRaw = {
      topLevelKeys: Object.keys(raw ?? {}).sort(),
      hasTeamModels: Object.prototype.hasOwnProperty.call(raw ?? {}, "teamModels"),
      teamModels: raw?.teamModels ?? null,
    }

    // ── the intended READ surfaces: keyed service reads + tool payloads ────────────────────
    out.service.rawNoKeyKeys = config.get === undefined ? null : Object.keys(config.get() ?? {}).sort()
    out.service.rawNoKeyHasTeamModels = Object.prototype.hasOwnProperty.call(config.get() ?? {}, "teamModels")
    out.service.keyedTeamModels = config.get("teamModels") ?? null
    for (const slot of ["slot1", "slot2", "slot3"]) out.service["keyed_" + slot] = config.get("teamModels." + slot) ?? null

    const call = async (args) => {
      try {
        const result = await dsh.executeTool({ name: "mpd_config_get", arguments: args })
        return { ok: result?.ok === true, isError: result?.isError === true, error: result?.error === undefined ? undefined : String(result.error), value: result?.value }
      } catch (error) {
        return { threw: String(error?.message ?? error) }
      }
    }
    out.tool.noKey = await call({})
    out.tool.keyedTeamModels = await call({ key: "teamModels" })
    out.tool.keyedSlot1 = await call({ key: "teamModels.slot1" })

    // ── the WRITE round-trip through the adapter's settings seam ───────────────────────────
    const before = reader?.describe?.()?.revision
    const mutateOps = [
      { op: "set", path: ["teamModels", "slot1", "provider"], value: "t9-probe-provider" },
      { op: "set", path: ["teamModels", "slot1", "model"], value: "t9-probe-model" },
      { op: "set", path: ["teamModels", "slot1", "reasoningEffort"], value: "low" },
    ]
    out.mutate.revisionBefore = before ?? null
    out.mutate.result = await dsh.settingsMutate("mpd", mutateOps, before)
    await sleep(600)
    out.mutate.namespaceAfter = reader?.describe?.()?.value?.teamModels?.slot1 ?? null
    out.mutate.toolAfter = (await call({ key: "teamModels.slot1" }))?.value ?? null
    out.mutate.serviceAfter = config.get("teamModels.slot1") ?? null
    // untouched slots must keep their defaults across the mutate
    out.mutate.slot2After = config.get("teamModels.slot2") ?? null
    out.mutate.slot3After = config.get("teamModels.slot3") ?? null

    // ── and back: unset the probe override so a later reader sees the schema default again ─
    const rev2 = reader?.describe?.()?.revision
    out.afterUnset.result = await dsh.settingsMutate("mpd", [
      { op: "unset", path: ["teamModels", "slot1", "provider"] },
      { op: "unset", path: ["teamModels", "slot1", "model"] },
      { op: "unset", path: ["teamModels", "slot1", "reasoningEffort"] },
    ], rev2)
    await sleep(600)
    out.afterUnset.toolAfter = (await call({ key: "teamModels.slot1" }))?.value ?? null
    out.afterUnset.serviceAfter = config.get("teamModels.slot1") ?? null
  } catch (error) {
    out.errors.push(String(error?.stack ?? error))
  }
  emit("T9_RESULT " + JSON.stringify(out))
}
