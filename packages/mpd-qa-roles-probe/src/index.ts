// QA-only preset+roster+skill-catalog probe plugin: asserts the mpd main preset
// resolves, the mpdRoles roster answers with the full specialist roster (11 roles), and
// the bundle's skill corpus is served by the skill registry (bundle-only count, every
// named fixture served, one loaded fixture body, no retired `ulw-*` name, and every
// RENAMED `autoproject-*` skill loaded by name with a resource base under `skills/<name>`).
// Mounted ONLY by QA overlays (tests/overlays/
// roles-probe.yml template), never shipped in the bundle.
// Harness seams (preset roster, skill registry) are read through the bundle's
// shared adapter, so the probe exercises the same surface the plugins do.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DSH_SEAM_AGENT_PRESETS, DSH_SEAM_TOOLS, dshSeamInject, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

// The cordis plugin's own name (loader registry/diagnostics). NOT the row id: the QA overlay
// inserts this probe as `roles-probe` (tests/overlays/roles-probe.yml), so a boot log naming
// THIS string names the module, not the mounted entry.
export const name = "mpd-dsh-qa-roles-probe"
// `tools` is a REQUIRED dependency of the registration instrumentation below: an
// agent-scoped cordis ctx throws on any property not in `inject`, so reading
// `ctx.tools` without declaring it reports `cannot get property "tools" without inject`
// (measured, t52 mount proof) and the instrumentation silently reports nothing useful.
// The names come from the adapter's ONE seam vocabulary (`dshSeamInject`), so a harness rename
// lands there instead of in this declaration; the runtime strings are unchanged.
export const inject = dshSeamInject(DSH_SEAM_AGENT_PRESETS, DSH_SEAM_TOOLS)
/** The part of the `mpdRoles` service this probe reads: `list()` is the roster, `get(key)` the
 *  key-to-role resolution. `get` stays OPTIONAL so a service that cannot resolve a key still
 *  prints its roster and fails the name assertion, instead of taking the probe down. */
type RolesService = { list(): Array<{ id: string; name?: string }>; get?(key: string): { id: string } | null }
// The 11 stable roster ids — INTERNAL vocabulary (AGENTS.md §13): the `mpdRoles` service hands
// them to plugins, while the model-facing `mpd_roles_list` tool projects NAMES only. They are a
// membership fingerprint here: the probe asserts the COUNT plus set membership, never order, so a
// roster reorder is not a regression.
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
// Delay between preset-resolve attempts, in ms — the poll's granularity, not a total. The loop
// retries only while ANOTHER full sleep still fits inside the budget above, so a late-populating
// registry row is observed within one step of its population and the poll never overruns the
// budget by a whole step.
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
 * The three `autoproject-*` entries pin the PR #94 rename: they fail the probe if a
 * renamed workflow stops being served, so the rename cannot silently regress.
 */
const FIXTURE_SKILLS = ["ast-grep", "dsh-qa", "git-master", "programming", "svn-master", "autoproject-plan", "autoproject-execute", "autoproject-research"]
/**
 * The RETIRED skill-family spelling: `ulw-*` / `ultrawork*`, case-insensitive. PR #94 renamed the
 * family to `autoproject-*`, so a served name still matching this pattern means an old tree is on
 * the provider's path; the catalog guard below fails the probe and NAMES every offending entry
 * instead of only lowering the served count.
 */
const RETIRED_SKILL_NAME = /^ulw[-_]|^ultrawork/i
/**
 * The three skills PR #94 RENAMED (`ulw-plan` / `ulw-execute` / `ulw-research` -> `autoproject-*`).
 * They are asserted from TWO different questions: their PRESENCE in the served listing is part of
 * `FIXTURE_SKILLS` above, and each one must also LOAD by name with a real body and a resource base
 * under the corpus (`SKILL_LOAD`, PASS channel 6). A rename that only reached the directory names
 * passes the first question and fails the second, which is exactly what the PR #94 reviewer asked
 * for evidence of.
 */
const RENAMED_SKILLS = ["autoproject-plan", "autoproject-execute", "autoproject-research"]

/**
 * The bundle root this probe is served from — FOUR levels up from this module, which resolves to
 * `<bundle>/packages/mpd-qa-roles-probe/dist/index.js` in BOTH layouts (a checkout install links
 * the repo, a packed install copies the same tree). It is the ONE answer to "where is this bundle":
 * the preset-path derivation and the renamed-skill base assertion below both read it, so the two
 * cannot drift apart.
 */
function bundleRoot(): string {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
}

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
  // The SECOND patch layer of the manifest's `dsh.bundle.patch` array: the file that DECLARES the
  // `mpd` preset row, and therefore what serves the preset in the row model.
  const patch = join(bundleRoot(), "presets", "mpd.patch.yml")
  // Only a path this probe can SEE is reported: a layout that moved the patch (a re-pack
  // that renames it) answers `unknown` instead of a plausible-looking fiction.
  return existsSync(patch) ? { path: patch, trust: "bundle" } : { path: "unknown", trust: "unknown" }
}

/**
 * The slice of a loaded skill record this probe reads: the body the registry served and the
 * resource base relative references resolve against. Declared ONCE and used by both the fixture
 * line and the renamed-skill assertions, so the two cannot read different shapes.
 */
type LoadedSkill = { name?: string; content?: string; resourceBase?: { path?: string } }

/**
 * Whether `candidate` is `expected` itself or sits UNDER it — the containment test the renamed
 * skills' resource bases are held to. Separators are normalized to `/` and a trailing separator is
 * dropped first, so a Windows path, a POSIX path and a base naming a file inside the directory
 * (`<dir>/SKILL.md`) all answer the same question; a SIBLING whose name merely shares the prefix
 * (`.../autoproject-plan-old`) does not.
 */
function pathUnder(candidate: string, expected: string): boolean {
  /** The comparison form of one path: forward slashes, no trailing separator. */
  const normalize = (p: string): string => p.split("\\").join("/").replace(/\/+$/, "")
  /** The candidate in comparison form. */
  const c = normalize(candidate)
  /** The expected directory in comparison form. */
  const e = normalize(expected)
  return c === e || c.startsWith(e + "/")
}

/**
 * The absolute `skills/<name>` directory a renamed skill's resource base must sit under.
 *
 * The corpus root is taken from the FIXTURE skill — the root that provably served a real body in
 * THIS boot — and the probe's own `<bundle>/skills` is PREFERRED whenever the fixture came from it,
 * so the ordinary checkout/packed boot pins the base to THIS repo's `skills/<name>`. The fallback
 * covers the one layout where the probe module and the served corpus live in different roots (the
 * `relocate-smoke` lane mounts the checkout's probe against a relocated pack's corpus): the same
 * containment assertion then pins the base to the corpus the fixture load came from, which that
 * lane separately asserts is the relocated pack.
 */
function expectedSkillBase(fixtureBase: string, skillName: string): string {
  /** This bundle's own corpus root, the authority for a boot served out of this checkout. */
  const probeSkills = join(bundleRoot(), "skills")
  if (fixtureBase === "") return join(probeSkills, skillName)
  /** The corpus root the fixture was served from: this bundle's, or else the fixture's own parent. */
  const corpusRoot = pathUnder(fixtureBase, probeSkills) ? probeSkills : dirname(fixtureBase)
  return join(corpusRoot, skillName)
}

/**
 * Why a renamed skill's load result FAILS its assertion, or `""` when it passes. The reason is one
 * TOKEN (no whitespace), so the `SKILL_LOAD=fail` line stays greppable: `absent` (listed but not
 * loadable), `short-body:<n>` (fewer than 101 bytes, i.e. a stub), `base-absent` (the provider
 * reported no resource base) or `base-outside:<path>` (a base that is not under the corpus's
 * `skills/<name>`, e.g. a stale copy served from somewhere else).
 */
function skillLoadReason(loaded: LoadedSkill | undefined, expectedBase: string): string {
  if (loaded === undefined) return "absent"
  /** The served body's length in UTF-16 code units, the probe's `bytes=` measurement. */
  const bodyBytes = loaded.content?.length ?? 0
  if (bodyBytes <= 100) return "short-body:" + String(bodyBytes)
  /** The reported resource base, `""` when the provider answered none. */
  const base = String(loaded.resourceBase?.path ?? "")
  if (base === "") return "base-absent"
  return pathUnder(base, expectedBase) ? "" : "base-outside:" + base
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
  // Absolute deadline in ms since the Unix epoch, measured from the FIRST attempt: it bounds the
  // retry SCHEDULE (a retry starts only while another step still fits inside it), not the wall time
  // of a single in-flight resolve — `resolvePreset` carries no signal and is never aborted.
  const deadline = Date.now() + PRESET_RESOLVE_BUDGET_MS
  // Attempts made so far; returned as `attempts` and printed as PRESET_RESOLVE_POLLS, so an
  // absorbed race stays visible in the evidence instead of reading as a first-try success.
  let attempts = 0
  for (;;) {
    attempts += 1
    try {
      return { preset: await dsh.resolvePreset(id), attempts }
    } catch (error) {
      // The thrown value's TEXT, because the retry decision is a regex match on it: the registry's
      // not-found answer arrives as a plain Error message, and a non-object throw is stringified
      // rather than dropped, so it still reaches the `fail:` log line below.
      const message = String((error as { message?: unknown })?.message ?? error)
      if (!PRESET_NOT_FOUND.test(message) || Date.now() + PRESET_RESOLVE_STEP_MS > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, PRESET_RESOLVE_STEP_MS))
    }
  }
}

/**
 * Probe entry point: runs every boot assertion once (only the two bounded polls retry), prints one
 * greppable `<SUBJECT>=value` line per subject, and sets `process.exitCode = 1` on FAIL — that
 * verdict line is what the mounting QA case reads (`bundle-lifecycle` greps `roles-probe] PASS|FAIL`).
 */
export async function apply(ctx: { agentPresets: unknown; get?: (k: string) => any; [k: string]: unknown }): Promise<void> {
  // The bundle's shared adapter (AGENTS.md §6): the preset resolve, the skill catalog and the
  // internal tool call all go through it, so the probe exercises the same ONE contact surface the
  // plugins do. It is the MOUNTED `mpdDsh` when that row is ACTIVE, and a row-private adapter over
  // this ctx otherwise.
  const dsh: any = resolveDshAdapter(ctx)
  // PASS channel 1 — the live preset: true when the registry answered a record the host did not
  // mark `broken`. A `fail:` line leaves it false, so the run goes red rather than printing
  // nothing.
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
  // Names of the flags that answered TRUE, printed as ADAPTER_SEAMS; `bundle-lifecycle` greps this
  // line for the seam flags it asserts, so the ordering is the adapter's own declaration order.
  const present = Object.entries(caps).filter(([, value]) => value === true).map(([key]) => key)
  // Names of the flags that answered FALSE, printed as an `ABSENT=` suffix: a degraded seam must be
  // visible by NAME, not inferred from a shorter present list.
  const absent = Object.entries(caps).filter(([, value]) => value === false).map(([key]) => key)
  console.log("[roles-probe] ADAPTER_SEAMS=" + (present.join(",") || "none") + (absent.length === 0 ? "" : " ABSENT=" + absent.join(",")))
  // Internal tool invocation through the adapter (the path mpd-verif's wave
  // hooks use): a registered mpd tool must answer through the normalized call.
  let toolCallOk = false
  try {
    // The adapter-normalized call result: `ok` is what PASS channel 2 reads and `error` is what the
    // log prints, so a registered mpd tool answering through the normalized call is provable.
    const call = await dsh.executeTool({ name: "mpd_config_get", arguments: {} })
    console.log("[roles-probe] ADAPTER_TOOL_CALL=" + (call.ok ? "ok" : "fail:" + String(call.error)))
    toolCallOk = call.ok === true
  } catch (e: any) {
    console.log("[roles-probe] ADAPTER_TOOL_CALL=fail:" + String(e?.message ?? e))
  }
  // The roster service as THIS boot serves it; undefined when the row is not mounted, in which case
  // the roster lines print empty and the verdict fails on the roster count.
  const roles = ctx.get?.("mpdRoles") as RolesService | undefined
  // The roster's stable ids in service order — the membership fingerprint compared against
  // ROSTER_IDS by COUNT and set membership, never by order.
  const ids = (roles?.list?.() ?? []).map((r) => r.id)
  console.log("[roles-probe] ROSTER=" + ids.join(","))
  // Name-vocabulary instrumentation: the roster's NORMAL names are the addressing
  // vocabulary every consumer shares with team mode, so the live boot proves BOTH that
  // the names are served and that a name resolves to its own stable id through the
  // service (the same resolution mpd_role_spawn / mpd_workmate_init / the modelchain
  // resolver use). A name that stopped resolving would show up here as "Name!=id".
  const byName = ids.map((id) => {
    // The role's NORMAL (addressing) name — the vocabulary team mode shares with every consumer —
    // or "" when the service returned a row without one.
    const name = String(((roles?.list?.() ?? []).find((r) => r.id === id) as { name?: string } | undefined)?.name ?? "")
    // What `get(name)` answers for that name: the same role when the name resolves (the service
    // accepts an id, an alias or a name spelling), so a broken name vocabulary prints `Name!=id`
    // instead of passing silently.
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
    // The live tool registry read from the RAW `ctx.tools` seam: the adapter projects presence
    // (`hasTool`), execution and a raw runtime handle, but no model-facing definition or schema view,
    // and this instrumentation needs the registry itself — which is why `tools` is in `inject` above.
    const tools = (ctx as { tools?: { get?: (n: string) => unknown; has?: (n: string) => boolean } }).tools
    // Is one tool NAME registered? `get()` is the registry's own lookup, `has()` the fallback, and a
    // missing seam answers false for every name instead of throwing.
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
    // The standing names the registry answered for — the numerator of AGENT_TEAMS_TOOLS.
    const present = LIVE_TOOLS.filter(seen)
    // The names still unregistered when the poll expired; an EMPTY list here is exactly what
    // `AGENT_TEAMS_NEW_TOOLS_OK=true` means, so the boolean has one subject.
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
    // A SECOND read of the same raw registry seam: the compaction row applies on its own timeline,
    // so reusing the AgentTeams block's result would couple one subject's verdict to another's poll.
    const tools = (ctx as { tools?: { get?: (n: string) => unknown; has?: (n: string) => boolean } }).tools
    // Per-name presence probe for the compaction set — a closure of its own, so a stale presence
    // result can never leak between the two features.
    const seenTool = (name: string): boolean => {
      if (tools === undefined) return false
      if (typeof tools.get === "function") return tools.get(name) !== undefined
      if (typeof tools.has === "function") return tools.has(name)
      return false
    }
    // A deadline of its own (ms since the Unix epoch): each poll gets a FULL TOOL_POLL_BUDGET_MS,
    // so the two blocks never share one budget.
    const deadline = Date.now() + TOOL_POLL_BUDGET_MS
    while (Date.now() < deadline && !COMPACT_TOOLS.every(seenTool)) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    // The compaction names not registered inside the budget; the TEAM_COMPACT_TOOLS numerator is
    // derived from it as `total - missing`.
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
  // Matches this bundle's OWN tool namespaces only: a third-party tool's schema is never asserted
  // here, so a foreign schema style cannot turn the QA boot red.
  const ownNamespace = /^(mpd_|agent_teams_)/
  // Renders a schema `type` for the BAD= list, `null` for an absent one, so a bad entry reads
  // `name:type=null` — the same signal the 2026-09-14 harness rejection named (`got 'type: null'`).
  const describeType = (t: unknown): string => t === undefined ? "null" : JSON.stringify(t)
  try {
    // The registry read for the SCHEMA projection: `schemas()` is the model-facing view (the one the
    // 2026-09-14 defect reached), `get()` the fallback for a service that exposes only lookups.
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
    // Own-namespace tools whose declared ROOT type is not `object` — the exact class that made every
    // model request of a session mounting the row fail on 2026-09-14.
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
  // PASS channel 6 — every renamed `autoproject-*` skill loads by name with a real body and a
  // resource base under the corpus. Separate from `catalogOk` (which asks what is LISTED) so a red
  // boot names the question that failed; it starts false, so a throw earlier in the block cannot
  // silently leave it green.
  let skillLoadsOk = false
  try {
    // The served skill listing; its LENGTH is the SKILLS= count the skill-catalog case greps, so the
    // count comes from the registry rather than from a corpus path on disk.
    const summaries = await dsh.listSkills()
    // The subset served by the BUNDLE provider — asserted below to be the WHOLE listing, so a
    // leftover home-root copy or a partial serve reddens instead of silently inflating the count.
    const bundled = summaries.filter((summary: any) => summary.source === "bundled")
    // Served names as a Set, so the named-fixture check costs one lookup per fixture instead of one
    // scan of the whole listing per fixture. The element type is SPELLED OUT: `listSkills()` is an
    // `any`-typed seam here, so `new Set(<any>)` infers `Set<unknown>` and the retired-name filter
    // below then fails the root `tsgo --noEmit` with TS2345 (a type-only fix — no emitted bytes).
    const servedNames = new Set<string>(summaries.map((summary: any) => String(summary.name)))
    // The named fixtures ABSENT from the served listing; an empty array is PASS channel 4's second
    // clause and the MISSING= suffix names whichever fixture regressed.
    const missingFixtures = FIXTURE_SKILLS.filter((name) => !servedNames.has(name))
    // Served names that still carry the RETIRED family spelling; an empty array is PASS channel 4's
    // fourth clause and the NAMES= suffix below names every offender when a stale tree is served.
    const retiredNames = [...servedNames].filter((name) => RETIRED_SKILL_NAME.test(name))
    console.log("[roles-probe] SKILLS=" + summaries.length + " BUNDLED=" + bundled.length
      + " SKILL_FIXTURES=" + (FIXTURE_SKILLS.length - missingFixtures.length) + "/" + FIXTURE_SKILLS.length
      + (missingFixtures.length > 0 ? " MISSING=" + missingFixtures.join(",") : "")
      // A bare count is not diagnosable: when a served skill does NOT come from the
      // bundle, name it (measured need 2026-09-14: "SKILLS=24 BUNDLED=18" told the
      // reader nothing about WHICH six, so the gate failure could not be attributed).
      + (summaries.length === bundled.length ? "" : " NON_BUNDLED=" + summaries.filter((summary: any) => summary.source !== "bundled").map((summary: any) => String(summary.name) + ":" + String(summary.source)).join(",")))
    // The retired-name guard's OWN line, so the boot log records the absence of `ulw-*` /
    // `ultrawork*` names as a fact instead of an inference from the counts above; NAMES= pinpoints
    // the stale tree when one is still served.
    console.log("[roles-probe] SKILL_RETIRED=" + retiredNames.length
      + (retiredNames.length > 0 ? " NAMES=" + retiredNames.join(",") : ""))
    // The loaded fixture skill: loading it proves the provider serves a real BODY and reports a
    // resource base for relative references. `undefined` — listed but not loadable — fails PASS.
    const fixture = (await dsh.loadSkill(FIXTURE_SKILL)) as LoadedSkill | undefined
    // The fixture's resource base path, `unknown` when it has none — reported for DIAGNOSIS only: it
    // is NOT one of the PASS conditions below, so a missing base alone does not redden the run.
    const base = fixture?.resourceBase?.path ?? "unknown"
    // The fixture body's length in UTF-16 code units (printed under the `bytes=` label) — PASS
    // channel 4 requires it to exceed 100, i.e. a real body rather than an empty stub.
    const bytes = fixture?.content?.length ?? 0
    console.log("[roles-probe] SKILL_FIXTURE=" + (fixture === undefined ? "missing" : "ok") + " name=" + String(fixture?.name ?? "-") + " base=" + base + " bytes=" + String(bytes))
    // PASS channel 6 — the three RENAMED skills must LOAD BY NAME, not merely appear in the catalog:
    // a listing entry only says a directory is served, while a body over 100 bytes plus a resource
    // base under the corpus's `skills/<name>` says the skill is actually usable. This is the PR #94
    // reviewer's finding — a rename proven by a listing alone is not proven. The loads are caught
    // PER SKILL so one broken rename cannot suppress the other two lines, the `SKILLS=` line or the
    // `SKILL_FIXTURE=` line that the other QA cases parse.
    /** The renamed skills whose load assertion failed; an empty array is this channel's PASS. */
    const failedLoads: string[] = []
    for (const skillName of RENAMED_SKILLS) {
      try {
        // The loaded record for THIS name; `undefined` means the provider lists it but cannot serve
        // a body — the `absent` failure this channel exists to catch.
        const loaded = (await dsh.loadSkill(skillName)) as LoadedSkill | undefined
        // The resource base the provider reported, `""` when it reported none; printed on the OK
        // line so the evidence records WHERE the body came from, exactly like the fixture line.
        const loadedBase = String(loaded?.resourceBase?.path ?? "")
        // Why this skill fails its assertion, `""` when it passes (see `skillLoadReason`).
        const reason = skillLoadReason(loaded, expectedSkillBase(String(fixture?.resourceBase?.path ?? ""), skillName))
        if (reason === "") {
          console.log("[roles-probe] SKILL_LOAD=ok name=" + skillName + " base=" + loadedBase + " bytes=" + String(loaded?.content?.length ?? 0))
        } else {
          // The failure line NAMES the skill and the reason token, so the offender is attributable
          // from the boot log alone instead of by reverse-engineering a count.
          console.log("[roles-probe] SKILL_LOAD=fail name=" + skillName + " reason=" + reason)
          failedLoads.push(skillName)
        }
      } catch (error) {
        // A THROW is a load failure like any other, absorbed per skill: its text is flattened to
        // one token so the line stays greppable, and truncated so a long message cannot flood the
        // boot log.
        const message = String((error as { message?: unknown })?.message ?? error).replace(/\s+/g, "_").slice(0, 160)
        console.log("[roles-probe] SKILL_LOAD=fail name=" + skillName + " reason=error:" + message)
        failedLoads.push(skillName)
      }
    }
    skillLoadsOk = failedLoads.length === 0
    // Four independent failure channels, so the boot gate can really go red:
    //   1. EVERY served skill must come from the bundle (no $DSH_HOME copy, no partial serve);
    //   2. every named fixture must be present in the served listing;
    //   3. the loaded fixture must return a real body (>100 bytes);
    //   4. NO served name may still carry the retired `ulw-*` / `ultrawork*` spelling.
    catalogOk = fixture !== undefined && bytes > 100
      && summaries.length === bundled.length
      && missingFixtures.length === 0
      && retiredNames.length === 0
  } catch (e: any) {
    console.log("[roles-probe] SKILLS=fail:" + String(e?.message ?? e))
  }
  // The AND of every PASS channel: (1) the live preset resolve, (2) the adapter tool call, (3) the
  // roster count plus set membership, (4) the skill catalog — bundle-only listing, every named
  // fixture served, a real fixture body, (5) object-rooted parameter schemas for this bundle's own
  // tools, (6) every RENAMED `autoproject-*` skill loads by name with a real body and a resource
  // base under the corpus. One false channel fails the boot, and the per-subject lines above say
  // WHICH.
  const ok = presetOk && toolCallOk && ids.length === ROSTER_IDS.length && ROSTER_IDS.every((id) => ids.includes(id)) && catalogOk && paramSchemasOk && skillLoadsOk
  console.log("[roles-probe] " + (ok ? "PASS" : "FAIL"))
  if (!ok) process.exitCode = 1
}
