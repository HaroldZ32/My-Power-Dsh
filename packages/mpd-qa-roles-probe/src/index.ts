// QA-only preset+roster+skill-catalog probe plugin: asserts the mpd main preset
// resolves, the mpdRoles roster answers with the full specialist roster (11 roles), and
// the bundle's skill corpus is served by the skill registry (count + one loaded
// skill + its resource base). Mounted ONLY by QA overlays (tests/overlays/
// roles-probe.yml template), never shipped in the bundle.
// Harness seams (preset roster, skill registry) are read through the bundle's
// shared adapter, so the probe exercises the same surface the plugins do.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

export const name = "mpd-dsh-qa-roles-probe"
// `tools` is a REQUIRED dependency of the registration instrumentation below: an
// agent-scoped cordis ctx throws on any property not in `inject`, so reading
// `ctx.tools` without declaring it reports `cannot get property "tools" without inject`
// (measured, t52 mount proof) and the instrumentation silently reports nothing useful.
export const inject = ["agentPresets", "tools"]
type RolesService = { list(): Array<{ id: string; name?: string }>; get?(key: string): { id: string } | null }
const ROSTER_IDS = ["oracle", "librarian", "prometheus", "hephaestus", "sisyphus", "sisyphus-junior", "atlas", "explore", "metis", "momus", "multimodal-looker"]
/**
 * Preset-resolve poll budget (ms) and step (ms) — the 0.1.7-rc.2 row model.
 *
 * MEASURED 2026-09-27 (`bundle-lifecycle`): this probe answered
 * `PRESET_MPD=fail:Unknown agent preset: mpd` while the preset itself really mounted and
 * every other boot sub-assertion was green. The deployment default is
 * `agent-preset-registry`'s `config.default` and the preset is the
 * `@deepseek-ai/dsh-agent-preset` row whose `config.id` matches, so `resolve("mpd")` reads
 * the registry's LIVE definition map — and that map is populated when the `preset-mpd`
 * ROW APPLIES, which the loader does CONCURRENTLY with this overlay-inserted probe row. A
 * single immediate read therefore races the row it is asking about; a SHORT bounded poll is
 * the same idiom the tool-registration instrumentation below already uses. The budget stays
 * small on purpose: this probe runs inside a boot the QA case kills once HTTP answers.
 */
const PRESET_RESOLVE_BUDGET_MS = 2000
const PRESET_RESOLVE_STEP_MS = 100
/** The registry's own not-found signal; any other failure is real and is rethrown at once. */
const PRESET_NOT_FOUND = /agent-preset\/not-found|Unknown agent preset/i
/** Budget (ms) for each tool-registration poll below (see the note at its loop). */
const TOOL_POLL_BUDGET_MS = 600
/** One corpus skill the probe loads to prove the provider serves real bodies. */
const FIXTURE_SKILL = "svn-master"
/**
 * NAMED corpus fixtures that must appear in the served listing. The probe asserts
 * presence of these stable, load-bearing cases instead of a bare corpus floor: the
 * extraction removed three `rtl-*` skill trees (22 -> 19 served), and a hard-coded
 * count would either break on every corpus change or silently stop meaning anything.
 */
const FIXTURE_SKILLS = ["ast-grep", "dsh-qa", "git-master", "programming", "svn-master"]

/**
 * WHERE the mpd preset is served from, in the row model.
 *
 * The retired directory preset resolved to a `path` + `trust` on its own record; a row
 * preset has neither, because it is DECLARED inline by the bundle's preset patch. The
 * honest answer to the same question is therefore the patch file that declares the row,
 * derived from this probe's OWN location (the probe is served out of the installed bundle,
 * so `<bundle>/presets/<name>.patch.yml` is the artifact a relocation moves). `trust` names
 * the declaring plane: `bundle` (shipped by the installed package) rather than the retired
 * `system`/`user` root vocabulary.
 */
export function presetPatchPath(): { path: string; trust: string } {
  // FOUR levels up: this module is served as `<bundle>/packages/mpd-qa-roles-probe/dist/index.js`
  // in BOTH layouts (a checkout install links the repo, a packed install copies the same tree).
  const bundleRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
  const patch = join(bundleRoot, "presets", "mpd.patch.yml")
  // Only a path this probe can SEE is reported: a layout that moved the patch (a re-pack
  // that renames it) answers `unknown` instead of a plausible-looking fiction.
  return existsSync(patch) ? { path: patch, trust: "bundle" } : { path: "unknown", trust: "unknown" }
}

/**
 * Resolve the live preset, retrying ONLY the registry's not-found answer inside a bounded
 * budget (see {@link PRESET_RESOLVE_BUDGET_MS}). Returns the resolved record plus how many
 * attempts it took, so the boot log can show the race instead of hiding it.
 */
export async function resolveLivePreset(
  dsh: { resolvePreset(id: string): Promise<{ id: string; path?: string; trust?: string; broken?: string }> },
  id: string,
): Promise<{ preset: { id: string; path?: string; trust?: string; broken?: string }; attempts: number }> {
  const deadline = Date.now() + PRESET_RESOLVE_BUDGET_MS
  let attempts = 0
  for (;;) {
    attempts += 1
    try {
      return { preset: await dsh.resolvePreset(id), attempts }
    } catch (error) {
      const message = String((error as { message?: unknown })?.message ?? error)
      if (!PRESET_NOT_FOUND.test(message) || Date.now() + PRESET_RESOLVE_STEP_MS > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, PRESET_RESOLVE_STEP_MS))
    }
  }
}

export async function apply(ctx: { agentPresets: unknown; get?: (k: string) => any; [k: string]: unknown }): Promise<void> {
  const dsh = (typeof ctx.get === "function" ? ctx.get("mpdDsh") : undefined) ?? createDshAdapter(ctx)
  let presetOk = false
  try {
    // BOUNDED POLL, not a single read: the row registers concurrently with this probe (see
    // the constants above). Only the registry's not-found answer is retried.
    const { preset, attempts } = await resolveLivePreset(dsh, "mpd")
    presetOk = !preset.broken
    console.log("[roles-probe] PRESET_MPD=" + (presetOk ? "ok" : "broken:" + String(preset.broken)))
    console.log("[roles-probe] PRESET_RESOLVE_POLLS=" + attempts + " id=" + String(preset.id))
    // PRESET_PATH proves WHERE the preset is served from: in the row model that is the
    // bundle patch that DECLARES it (the probe derives it from its own installed location).
    const served = presetPatchPath()
    console.log("[roles-probe] PRESET_PATH=" + String(preset.path ?? served.path) + " trust=" + String(preset.trust ?? served.trust))
  } catch (e: any) {
    console.log("[roles-probe] PRESET_MPD=fail:" + String(e?.message ?? e))
  }
  // Adapter capability snapshot taken at USE time (the loader applies rows
  // concurrently, so only a later read reflects the whole tree).
  const caps = dsh.capabilities()
  const present = Object.entries(caps).filter(([, value]) => value === true).map(([key]) => key)
  const absent = Object.entries(caps).filter(([, value]) => value === false).map(([key]) => key)
  console.log("[roles-probe] ADAPTER_SEAMS=" + (present.join(",") || "none") + (absent.length === 0 ? "" : " ABSENT=" + absent.join(",")))
  // Internal tool invocation through the adapter (the path mpd-verif's wave
  // hooks use): a registered mpd tool must answer through the normalized call.
  let toolCallOk = false
  try {
    const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
    console.log("[roles-probe] ADAPTER_TOOL_CALL=" + (call.ok ? "ok" : "fail:" + String(call.error)))
    toolCallOk = call.ok === true
  } catch (e: any) {
    console.log("[roles-probe] ADAPTER_TOOL_CALL=fail:" + String(e?.message ?? e))
  }
  const roles = ctx.get?.("mpdRoles") as RolesService | undefined
  const ids = (roles?.list?.() ?? []).map((r) => r.id)
  console.log("[roles-probe] ROSTER=" + ids.join(","))
  // Name-vocabulary instrumentation: the roster's NORMAL names are the addressing
  // vocabulary every consumer shares with team mode, so the live boot proves BOTH that
  // the names are served and that a name resolves to its own stable id through the
  // service (the same resolution mpd_role_spawn / mpd_workmate_init / the modelchain
  // resolver use). A name that stopped resolving would show up here as "Name!=id".
  const byName = ids.map((id) => {
    const name = String(((roles?.list?.() ?? []).find((r) => r.id === id) as { name?: string } | undefined)?.name ?? "")
    const resolved = roles?.get?.(name) as { id?: string } | undefined
    return resolved?.id === id ? name : name + "!=" + String(resolved?.id)
  })
  console.log("[roles-probe] ROSTER_NAMES=" + byName.join(","))
  // REGISTRATION INSTRUMENTATION for the AgentTeams tool surface. `--dump-config` only
  // COMPOSES rows and never executes plugin code (AGENTS.md §4), so it cannot witness a
  // registered tool; this reads the live registry from inside the mounted boot instead.
  // The probe is QA-only tooling and may touch the seam directly, exactly as it already
  // does for `agentPresets` above.
  const LIVE_TOOLS = [
    "agent_teams_interject_request",
    "agent_teams_interject_decide",
    "agent_teams_mailbox_clear",
    "agent_teams_send_message",
    "agent_teams_update_task",
    "mpd_team_compact_run",
    "mpd_team_compact_status",
  ]
  try {
    const tools = (ctx as { tools?: { get?: (n: string) => unknown; has?: (n: string) => boolean } }).tools
    const seen = (name: string): boolean => {
      if (tools === undefined) return false
      if (typeof tools.get === "function") return tools.get(name) !== undefined
      if (typeof tools.has === "function") return tools.has(name)
      return false
    }
    // The loader applies rows concurrently, so a sibling plugin may not have registered
    // its tools yet when this probe runs. Poll briefly instead of racing: a single
    // immediate read would make this instrumentation flaky and therefore useless.
    // The budget is deliberately SHORT: three of these loops run in sequence, a long one
    // makes the probe stall a boot that would otherwise finish (measured: a 15 s loop per
    // check kept the whole boot log at 8 lines), and MEASURED 2026-09-27 the QA boot kills
    // the app ~3.5 s after HTTP answers — a probe still polling then never prints its
    // verdict, which is what the boot gate reads. 600 ms is ~6x the registration latency
    // this instrumentation exists to absorb and keeps the verdict inside the window.
    const deadline = Date.now() + TOOL_POLL_BUDGET_MS
    while (Date.now() < deadline && !LIVE_TOOLS.every(seen)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const present = LIVE_TOOLS.filter(seen)
    const missing = LIVE_TOOLS.filter((name) => !seen(name))
    console.log("[roles-probe] AGENT_TEAMS_TOOLS=" + present.length + "/" + LIVE_TOOLS.length
      + (missing.length > 0 ? " MISSING=" + missing.join(",") : ""))
    console.log("[roles-probe] AGENT_TEAMS_NEW_TOOLS_OK=" + (missing.length === 0))
  } catch (e: any) {
    console.log("[roles-probe] AGENT_TEAMS_TOOLS=fail:" + String(e?.message ?? e))
  }
  // The compaction row's TOOL names, printed separately: the AgentTeams set above is a
  // standing assertion, and folding a second feature into it would make one missing name
  // ambiguous about WHICH feature regressed.
  const COMPACT_TOOLS = ["mpd_team_compact_run", "mpd_team_compact_status"]
  try {
    const tools = (ctx as { tools?: { get?: (n: string) => unknown; has?: (n: string) => boolean } }).tools
    const seenTool = (name: string): boolean => {
      if (tools === undefined) return false
      if (typeof tools.get === "function") return tools.get(name) !== undefined
      if (typeof tools.has === "function") return tools.has(name)
      return false
    }
    const deadline = Date.now() + TOOL_POLL_BUDGET_MS
    while (Date.now() < deadline && !COMPACT_TOOLS.every(seenTool)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const missing = COMPACT_TOOLS.filter((name) => !seenTool(name))
    console.log("[roles-probe] TEAM_COMPACT_TOOLS=" + (COMPACT_TOOLS.length - missing.length) + "/" + COMPACT_TOOLS.length
      + (missing.length > 0 ? " MISSING=" + missing.join(",") : ""))
  } catch (e: any) {
    console.log("[roles-probe] TEAM_COMPACT_TOOLS=fail:" + String(e?.message ?? e))
  }
  // PARAMETER SCHEMA instrumentation — the model-facing half of a tool definition.
  //
  // MEASURED DEFECT (2026-09-14): `mpd_team_compact_run` declared a BARE property map
  // (`parameters: { team_id: {…} }`) where an object-rooted JSON Schema belongs. The
  // adapter forwards `parameters` VERBATIM (it only defaults a schema when the field is
  // absent), and the harness's raw `register()` path does NOT validate parameters
  // (unlike `defineTool`, which compiles a property map into `type: "object"`), so the
  // bare map reached the provider and EVERY model request of a session mounting the row
  // was rejected with:
  //   Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema
  //   of 'type: "object"', got 'type: null'
  // Neither `--dump-config` (composition only, AGENTS.md §4) nor a source-level unit test
  // can witness that — only the LIVE registry knows what was registered. So read the
  // model-facing projection (`tools.schemas()`) and require an object root for every tool
  // of this bundle's own namespaces: a future plugin cannot ship this class silently.
  let paramSchemasOk = true
  const ownNamespace = /^(mpd_|agent_teams_)/
  const describeType = (t: unknown): string => t === undefined ? "null" : JSON.stringify(t)
  try {
    const tools = (ctx as {
      tools?: {
        schemas?: () => Array<{ name?: unknown; parameters?: { type?: unknown } }>
        get?: (n: string) => { name?: unknown; parameters?: { type?: unknown } } | undefined
      }
    }).tools
    // Primary source is the model-facing projection; the fallback covers a tools
    // service that exposes only get(), using the names this probe already polls.
    const own = typeof tools?.schemas === "function"
      ? tools.schemas().filter((s) => ownNamespace.test(String(s?.name)))
      : [...LIVE_TOOLS, ...COMPACT_TOOLS]
        .map((n) => tools?.get?.(n))
        .filter((s): s is { name?: unknown; parameters?: { type?: unknown } } => s !== undefined)
        .filter((s) => ownNamespace.test(String(s?.name)))
    const bad = own.filter((s) => s?.parameters?.type !== "object")
    console.log("[roles-probe] TOOL_PARAM_SCHEMAS=" + (own.length - bad.length) + "/" + own.length
      + (bad.length > 0 ? " BAD=" + bad.map((s) => String(s?.name) + ":type=" + describeType(s?.parameters?.type)).join(",") : ""))
    paramSchemasOk = own.length > 0 && bad.length === 0
  } catch (e: any) {
    console.log("[roles-probe] TOOL_PARAM_SCHEMAS=fail:" + String(e?.message ?? e))
    paramSchemasOk = false
  }
  // NOTE: the new adapter seam flags are already printed by this probe's own direct
  // capabilities() call (ADAPTER_SEAMS / ABSENT). Reading them from ctx.get("mpdDsh")
  // here answered `undefined` in a measured QA boot, which would have put a misleading
  // line in the evidence, so the direct call stays the single source.
  // Skill catalog: the corpus must be served by the bundle provider, and one
  // fixture skill must load with a resource base (relative references resolve).
  let catalogOk = false
  try {
    const summaries = await dsh.listSkills()
    const bundled = summaries.filter((summary: any) => summary.source === "bundled")
    const servedNames = new Set(summaries.map((summary: any) => String(summary.name)))
    const missingFixtures = FIXTURE_SKILLS.filter((name) => !servedNames.has(name))
    console.log("[roles-probe] SKILLS=" + summaries.length + " BUNDLED=" + bundled.length
      + " SKILL_FIXTURES=" + (FIXTURE_SKILLS.length - missingFixtures.length) + "/" + FIXTURE_SKILLS.length
      + (missingFixtures.length > 0 ? " MISSING=" + missingFixtures.join(",") : "")
      // A bare count is not diagnosable: when a served skill does NOT come from the
      // bundle, name it (measured need 2026-09-14: "SKILLS=24 BUNDLED=18" told the
      // reader nothing about WHICH six, so the gate failure could not be attributed).
      + (summaries.length === bundled.length ? "" : " NON_BUNDLED=" + summaries.filter((summary: any) => summary.source !== "bundled").map((summary: any) => String(summary.name) + ":" + String(summary.source)).join(",")))
    const fixture = (await dsh.loadSkill(FIXTURE_SKILL)) as { name?: string; content?: string; resourceBase?: { path?: string } } | undefined
    const base = fixture?.resourceBase?.path ?? "unknown"
    const bytes = fixture?.content?.length ?? 0
    console.log("[roles-probe] SKILL_FIXTURE=" + (fixture === undefined ? "missing" : "ok") + " name=" + String(fixture?.name ?? "-") + " base=" + base + " bytes=" + String(bytes))
    // Three independent failure channels, so the boot gate can really go red:
    //   1. EVERY served skill must come from the bundle (no $DSH_HOME copy, no partial serve);
    //   2. every named fixture must be present in the served listing;
    //   3. the loaded fixture must return a real body (>100 bytes).
    catalogOk = fixture !== undefined && bytes > 100
      && summaries.length === bundled.length
      && missingFixtures.length === 0
  } catch (e: any) {
    console.log("[roles-probe] SKILLS=fail:" + String(e?.message ?? e))
  }
  const ok = presetOk && toolCallOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id)) && catalogOk && paramSchemasOk
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}
