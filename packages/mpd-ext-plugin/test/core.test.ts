// Core tests for the MPD extension interface (mpd-ext-plugin).
//
// Every assertion here is behavioural: descriptors are validated, extensions are
// discovered from real temporary directories, the skill provider is actually
// invoked, and every tool result is checked against its own output schema with a
// local mirror of the harness subset validator (results ARE validated by the
// harness at runtime — `createSuccessResult` -> `validateJsonSchemaValue` — so a
// schema that does not describe the emitted value is a real defect).
//
// The user plane is always sandboxed by pointing HOME at a temp directory. The
// BUNDLE plane is the repository's own <bundle>/extensions, so no assertion here
// depends on the total extension count: each one selects by plane or by id.
import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { apply, inject, REQUIRED_SEAMS } from "../src/index.ts"
import { MPD_EXT_API_VERSION, MPD_EXT_CONTRACT } from "../src/sdk.ts"
import { buildExtension, effectiveEnabled, MpdExtensionRegistry, validateDescriptor } from "../src/registry.ts"
import { allocateProviderName, candidateViolation, createSkillProvider, SKILL_NAME } from "../src/skills.ts"
import { parseFlowDocument, renderFlowSkill } from "../src/flows.ts"
import { discoverPlane, extensionConfig, projectExtensionsDir, userExtensionsDir } from "../src/manifest.ts"
// The ROSTER's own resolver, imported by the TEST only: the parity test at the bottom
// of this file asks the real thing what it exposes/refuses and requires this package's
// report to match it, so the two surfaces cannot drift apart silently.
import { extensionRoles } from "../../mpd-roles-plugin/src/index.ts"

// ── sandbox ─────────────────────────────────────────────────────────────────

// Sandbox directories created by makeDir; afterEach removes each one best-effort.
const created: string[] = []
// The caller's HOME, captured once so afterEach can restore or delete what the suite overwrote.
const originalHome = process.env.HOME
// The caller's DSH_WORKSPACE_ROOT, restored for the same reason: no case may leak it into the next.
const originalWorkspace = process.env.DSH_WORKSPACE_ROOT
/**
 * Disposers collected from every fake ctx this file builds (`ctx.effect`), run BEFORE the
 * sandbox directories are removed.
 *
 * Why this is not optional on Windows: when a test lets the MCP bridge CONNECT (the default
 * `extensions.mcp.enabled`), `apply` spawns the declared server and registers its teardown
 * through `ctx.effect`. A fake ctx without `effect` (the pre-fix shape) left that child alive
 * for the whole run, and a live child on Windows holds the inherited directory handle of the
 * sandbox under `$HOME/.mpd/extensions/**` — so `rmSync` answered `EBUSY` for the FULL process
 * lifetime (measured: still EBUSY after 20 x 250 ms of retries, green the moment the run
 * exited). Retries can never fix a handle the run itself keeps open; disposing first can.
 */
const effects: Array<() => unknown> = []

/** Create a temp directory under the OS temp root, registered in `created`; `prefix` names the case that needs it. */
function makeDir(prefix: string): string {
  // The new directory; `tmpdir()` is consulted rather than a literal /tmp because TMPDIR may redirect it.
  const dir = mkdtempSync(join(tmpdir(), prefix))
  created.push(dir)
  return dir
}

beforeEach(() => {
  process.env.HOME = makeDir("mpd-ext-home-")
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  if (originalWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
  else process.env.DSH_WORKSPACE_ROOT = originalWorkspace
  // `apply` is async and these cases deliberately do NOT await it (they assert the PRE-connect
  // report), so a declared MCP server can still be spawning when the sandbox is torn down. Let the
  // pending continuation reach `ctx.effect` first, then dispose what it registered.
  await new Promise((resolve) => setTimeout(resolve, 0))
  for (const dispose of effects.splice(0)) {
    try { await dispose() } catch { /* a teardown failure must not fail the suite */ }
  }
  // Removal is BEST-EFFORT, and deliberately so on Windows: an MCP server runs with `cwd` set to
  // its extension root (`mcp.ts` resolves the descriptor's `cwd` against that root), and Windows
  // refuses to delete a directory that is a live process's working directory — the sandbox then
  // answers EBUSY until that child dies, which for a case that never awaited `apply` is when the
  // run exits. Retrying with a YIELD between attempts (rmSync's own maxRetries spin synchronously
  // and never let the child's exit be delivered) covers the ordinary case; a sandbox the run still
  // holds is left to the OS rather than failing an assertion that has nothing to do with it.
  for (const dir of created.splice(0)) {
    for (let attempt = 0; ; attempt++) {
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); break }
      catch {
        if (attempt >= 20 || !existsSync(dir)) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  }
})

// ── fixtures ────────────────────────────────────────────────────────────────

/** A minimal VALID skill document: a name in the skill-name grammar plus the non-empty description the contract requires. */
const GOOD_SKILL = `---
name: style-check
description: "Check style against the in-house rules."
---

# style-check

Run the style checks.
`

/** A second valid skill, used wherever two distinct names must coexist (rank and shadowing cases). */
const SECOND_SKILL = `---
name: lint-mcp
description: "Lint sources with the bundled linter."
---

# lint-mcp

Lint the design.
`

/** Deliberately INVALID: the empty `description` must make the provider skip and warn, never emit a candidate. */
const EMPTY_DESCRIPTION_SKILL = `---
name: broken-style
description: ""
---

# broken-style
`

/** A valid flow document: kebab-case id inside the skill-name grammar, one step with a `tool` hint, one with an `output`. */
const GOOD_FLOW = {
  id: "change-review",
  title: "Change review",
  description: "Review a change before it lands.",
  whenToUse: "Use when a change needs review.",
  steps: [
    { title: "Read the module", detail: "Open the module top-to-bottom.", tool: "read" },
    { title: "Summarize risks", output: "A list of ranked risks." },
  ],
}

/** Assets `writeExtension` materializes beside the manifest: skills by directory name, flows by file name, personas by root-relative path. */
interface Fixture {
  /** Skill directory name to the SKILL.md body written into it (frontmatter included, since the fixture supplies the whole text). */
  skills?: Record<string, string>
  /** Flow file name to its JSON body; a STRING value is written verbatim so a malformed document can be injected. */
  flows?: Record<string, unknown | string>
  /** Root-relative persona path to its text; an empty string models the unreadable-persona refusal. */
  personas?: Record<string, string>
}

/** Write `<baseDir>/<id>/mpd-ext.json` plus the fixture's assets and return that directory; a string manifest is written verbatim so broken JSON can be exercised. */
function writeExtension(baseDir: string, id: string, manifest: unknown, fixture: Fixture = {}): string {
  // The extension's own directory, which is also the root every declared asset path resolves against.
  const dir = join(baseDir, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, MPD_EXT_CONTRACT.manifestFile), typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2) + "\n")
  for (const [name, content] of Object.entries(fixture.skills ?? {})) {
    mkdirSync(join(dir, "skills", name), { recursive: true })
    writeFileSync(join(dir, "skills", name, "SKILL.md"), content)
  }
  for (const [name, content] of Object.entries(fixture.flows ?? {})) {
    mkdirSync(join(dir, "flows"), { recursive: true })
    writeFileSync(join(dir, "flows", name), typeof content === "string" ? content : JSON.stringify(content, null, 2))
  }
  for (const [name, content] of Object.entries(fixture.personas ?? {})) {
    // The asset's absolute path; `dirname` creates any intermediate directory a nested fixture key names.
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

/** A descriptor that validates for `id`: apiVersion fixed to the contract's own version, with `contributes` and `extra` spread last so a case can override or add keys. */
function extensionManifest(id: string, contributes: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { apiVersion: MPD_EXT_API_VERSION, id, description: `The ${id} extension`, contributes, ...extra }
}

// ── a fake ctx with the harness seams the adapter resolves ──────────────────

/** The fake ctx one case builds, together with the registrations it captured while `apply` ran. */
interface FakeCtx {
  /** The object handed to `apply`: a hand-rolled ctx exposing only the seams the adapter resolves. */
  ctx: any
  /** Tool definitions passed to `ctx.tools.register`, in registration order. */
  registered: any[]
  /** Provider factories passed to `ctx.skills.registerProvider`, in registration order. */
  providers: any[]
  /** Values stored through `ctx.provide`, keyed by service name (the cases read `mpdExtensions`). */
  provided: Record<string, any>
}

/** Build a fake ctx; `config` is what `ctx.get("mpdConfig")` answers with, and undefined models the service being absent. */
function makeCtx(config?: any): FakeCtx {
  // Tool definitions collected by the fake `tools.register`, handed back as `registered`.
  const registered: any[] = []
  // Provider factories collected by the fake `skills.registerProvider`, handed back as `providers`.
  const providers: any[] = []
  // Service values collected by the fake `provide`, handed back as `provided`.
  const provided: Record<string, any> = {}
  // The ctx itself; `any` on purpose so a case can replace one single seam without stubbing the whole surface.
  const ctx: any = {
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    get: (key: string) => (key === "mpdConfig" ? config : undefined),
    provide: (key: string, value: any) => { provided[key] = value },
    /**
     * The teardown seam the harness owns: `apply` registers the MCP bridge's `dispose` here, so a
     * ctx that omits `effect` leaks every spawned server for the run (see `effects` above).
     */
    // `setup` returns the DISPOSER (`ctx.effect(() => () => …)`), so its result is what `effects` collects.
    effect: (setup: () => () => unknown) => { effects.push(setup()); return () => {} },
    tools: {
      register: (definition: any) => { registered.push(definition); return () => {} },
      guard: () => () => {},
      get: () => undefined,
      execute: async () => ({}),
    },
    skills: {
      registerProvider: (create: any) => { providers.push(create); return () => {} },
      /**
       * A faithful MICRO-CATALOG, not a stub: it asks every registered provider and
       * keeps ONE winner per name by rank, then registration order — the harness's own
       * in-layer rule (`compareIndexedCandidates` + `collectLayer`). The tools' serving
       * check (F4) is therefore exercised against real merge behaviour, and an
       * observation's `complete` flag is honoured the way the harness honours it.
       */
      list: async (options?: unknown) => {
        // Every candidate seen, tagged with its provider and the two tie-breakers the harness applies after rank.
        const collected: Array<{ candidate: any; providerName: string; providerOrder: number; localOrder: number }> = []
        // Registration order of the provider currently being asked; it decides the tie after rank.
        let providerOrder = 0
        for (const create of providers) {
          // The instance built from this factory; the micro-catalog asks each provider it was given.
          const provider = create({ invalidate: () => {} })
          // The provider's raw observation: either an array (implicitly complete) or a {candidates, complete} object.
          const output = await provider.list(options)
          // The candidates it reported; a non-array observation contributes none but keeps its completeness flag.
          const candidates = Array.isArray(output) ? output : output?.candidates ?? []
          // Position inside this provider's own list, the last tie-breaker after registration order.
          let localOrder = 0
          for (const candidate of candidates) {
            collected.push({ candidate, providerName: provider.name, providerOrder, localOrder })
            localOrder += 1
          }
          providerOrder += 1
        }
        collected.sort((left, right) =>
          (left.candidate.rank ?? 300) - (right.candidate.rank ?? 300)
          || left.providerOrder - right.providerOrder
          || left.localOrder - right.localOrder)
        // One winner per candidate name, resolved after the sort so the LOWEST rank wins.
        const winners = new Map<string, any>()
        for (const entry of collected) {
          if (!winners.has(entry.candidate.name)) winners.set(entry.candidate.name, entry.candidate)
        }
        return [...winners.values()].map((candidate) => ({
          name: candidate.name,
          description: candidate.description,
          source: candidate.source,
          provider: candidate.provider,
        }))
      },
    },
  }
  return { ctx, registered, providers, provided }
}

/** Read a provider observation the way the HARNESS reads it (an array means complete). */
function observed(observation: unknown): { candidates: any[]; complete: boolean } {
  if (Array.isArray(observation)) return { candidates: observation, complete: true }
  // The non-array observation shape; only `candidates` and `complete` are read, and a null is tolerated.
  const value = observation as { candidates?: any[]; complete?: boolean } | null
  return { candidates: value?.candidates ?? [], complete: value?.complete === true }
}

/** The candidate names of one provider call, with the observation's completeness. */
async function observedNames(provider: any, options?: unknown): Promise<{ names: string[]; complete: boolean }> {
  // The provider's observation, normalized to the {candidates, complete} pair the harness reads.
  const observation = observed(await provider.list(options))
  return { names: observation.candidates.map((candidate) => candidate.name), complete: observation.complete }
}

/** The minimal `exec` a tool call needs: the calling session's workspace, which is how the project plane resolves. */
function execFor(workspace: string): any {
  return { agent: { session: { header: { cwd: workspace } } } }
}

/** Look a registered tool up by name; a missing name throws rather than letting a case assert against undefined. */
function toolOf(registered: any[], toolName: string): any {
  // The matching definition; the throw above is the only way out of this function.
  const definition = registered.find((candidate) => candidate.name === toolName)
  if (definition === undefined) throw new Error(`tool ${toolName} was not registered`)
  return definition
}

/** The provider registered under `providerName`; a miss throws and lists the names that WERE registered. */
function providerNamed(providers: any[], providerName: string): any {
  for (const create of providers) {
    // The instance for this factory, matched only by the name it declares.
    const provider = create({ invalidate: () => {} })
    if (provider?.name === providerName) return provider
  }
  // Every registered provider name, so the failure says what was actually available.
  const names = providers.map((create) => create({}).name).join(", ")
  throw new Error(`provider ${providerName} was not registered (have: ${names})`)
}

/** The project-plane subset of `mpd_ext_list`'s entries, which is what a per-call re-read has to isolate. */
function projectEntriesOf(listed: any): any[] {
  return listed.extensions.filter((entry: any) => entry.plane === "project")
}

// ── a local mirror of the harness schema subset (register time + value time) ─

/** The CONSTRAINT keywords of the subset this mirror enforces; any other key is reported as outside the subset. */
const CONSTRAINT_KEYWORDS = new Set(["type", "oneOf", "properties", "required", "additionalProperties", "items", "enum", "const"])
/** Annotation keywords allowed alongside them: they never constrain a value. */
const ANNOTATION_KEYWORDS = new Set(["description", "title", "default", "examples"])
/** The single `type` strings the subset accepts; anything else is outside it. */
const SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"]

/** Throw when `schema` uses anything outside the harness's enforced subset; `path` names the offending location in the message. */
function assertSchemaSubset(schema: any, path: string = "schema"): void {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`${path} must be a schema object`)
  if (Object.hasOwn(schema, "type")) {
    if (typeof schema.type !== "string") throw new Error(`${path}.type must be a single string`)
    if (!SCHEMA_TYPES.includes(schema.type)) throw new Error(`${path}.type "${schema.type}" is outside the subset`)
  }
  for (const key of Object.keys(schema)) {
    if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) throw new Error(`${path}.${key} is outside the enforced subset`)
  }
  if (Object.hasOwn(schema, "required")) {
    // The declared properties; a schema without them still has to satisfy the `required` rule below.
    const properties = schema.properties ?? {}
    for (const name of schema.required) if (!Object.hasOwn(properties, name)) throw new Error(`${path}.required names "${name}" which is not in properties`)
  }
  if (Object.hasOwn(schema, "additionalProperties") && typeof schema.additionalProperties !== "boolean") throw new Error(`${path}.additionalProperties must be a boolean`)
  for (const [key, child] of Object.entries(schema.properties ?? {})) assertSchemaSubset(child, `${path}.properties.${key}`)
  if (schema.items !== undefined) assertSchemaSubset(schema.items, `${path}.items`)
}

/** The value-time violations of `value` against `schema`: one human-readable line per failing node, with `path` locating it. */
function validateValue(schema: any, value: any, path: string = "value"): string[] {
  // The declared type; a schema without one returns no violations at all.
  const type = schema.type
  if (type === undefined) return []
  switch (type) {
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return [`"${path}" must be an object`]
      // Violations accumulated at this object level, one line per missing or invalid property.
      const violations: string[] = []
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key) || value[key] === undefined) violations.push(`missing required property "${path}.${key}"`)
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.hasOwn(value, key) && value[key] !== undefined) violations.push(...validateValue(child, value[key], `${path}.${key}`))
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties ?? {}, key)) violations.push(`"${path}.${key}" is not a declared property`)
      }
      return violations
    }
    case "array":
      if (!Array.isArray(value)) return [`"${path}" must be an array`]
      return value.flatMap((entry, index) => (schema.items === undefined ? [] : validateValue(schema.items, entry, `${path}[${index}]`)))
    case "string": return typeof value === "string" ? [] : [`"${path}" must be a string`]
    case "number": return typeof value === "number" && Number.isFinite(value) ? [] : [`"${path}" must be a finite number`]
    case "integer": return typeof value === "number" && Number.isInteger(value) ? [] : [`"${path}" must be an integer`]
    case "boolean": return typeof value === "boolean" ? [] : [`"${path}" must be a boolean`]
    case "null": return value === null ? [] : [`"${path}" must be null`]
    default: throw new Error(`unknown schema type ${type}`)
  }
}

/** Call a tool and assert its emitted value satisfies its own declared schema. */async function callTool(registered: any[], toolName: string, args: unknown, workspace: string): Promise<any> {
  // The tool's own definition, so the emitted value is checked against ITS declared schema.
  const definition = toolOf(registered, toolName)
  // The value the tool returned; asserted and rendered below before the case sees it.
  const value = await definition.execute(args, execFor(workspace))
  expect(validateValue(definition.output.schema, value)).toEqual([])
  expect(typeof definition.output.render).toBe("function")
  expect(definition.output.render(args, value).length).toBeGreaterThan(0)
  return value
}

// ── the service and the four tools ──────────────────────────────────────────

test("apply registers exactly the four tools, no reload, and provides the mpdExtensions service", () => {
  // The fake ctx plus the two seam captures this case asserts on (providers is not read here).
  const { ctx, registered, provided } = makeCtx()
  apply(ctx, { quiet: true })
  // The registered tool names, sorted so the assertion does not depend on registration order.
  const names = registered.map((definition) => definition.name).sort()
  expect(names).toEqual(["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"])
  expect(names).not.toContain("mpd_ext_reload")
  // SEAM REGRESSION (2026-09-14): this used to assert `[]`, which PINNED the defect
  // — with no declared seams, ctx.get("tools")/get("skills") are undefined for the
  // row, the registrations fail inside the containment, and a real boot registered
  // NONE of the tools. The row must declare the seams it registers through.
  // t16 strengthened the pin: the literal list catches a revert to [], and the
  // REQUIRED_SEAMS equality catches a silently NARROWED declaration; `toBeGreaterThan(0)`
  // makes the "declares nothing" shape fail even if both lists were emptied together.
  expect(inject).toEqual(["tools", "skills"])
  expect([...inject]).toEqual([...REQUIRED_SEAMS])
  expect(inject.length).toBeGreaterThan(0)
  expect(provided.mpdExtensions.apiVersion).toBe(MPD_EXT_API_VERSION)
  for (const method of ["register", "list", "describe"]) expect(typeof provided.mpdExtensions[method]).toBe("function")
  for (const definition of registered) {
    expect(definition.parameters.type).toBe("object")
    assertSchemaSubset(definition.parameters, `${definition.name}.parameters`)
    assertSchemaSubset(definition.output.schema, `${definition.name}.output`)
    expect(typeof definition.output.render).toBe("function")
  }
})

/**
 * Containment under the AUTHORIZED seam declaration (t5 authorized it, t16 adapted this test to
 * what it implies). Three things are pinned, all at least as strong as the count it used to make:
 *
 *  (1) The DECLARATION is the mechanism that keeps the row from being silently inert: a row that
 *      declares `inject` stays PENDING in the loader — `apply` is not reached — until every
 *      declared service is present, so the pre-fix failure mode (applied everywhere, both seams
 *      already torn down, four tools absent while the success line still claimed them) cannot
 *      recur. `inject: []` fails the equality in the previous test and here.
 *  (2) Even if apply IS forced against a harness that never delivers the seams, the row does not
 *      swallow: it reports the interface as NOT usable and names the declaration it carries,
 *      instead of printing a success line. (Before the fix it printed
 *      "mpdExtensions provided | tools: …" and registered nothing.)
 *  (3) Against a hostile harness whose seams exist but THROW, containment still holds: `apply`
 *      never throws, the service is still provided, every failure is reported per item, and the
 *      summary line says the interface is NOT usable.
 */
test("apply contains a hostile harness: a throwing tool or skill seam never escapes apply", () => {
  // (1) The declaration covers exactly the seams this row registers through.
  expect([...inject]).toEqual([...REQUIRED_SEAMS])
  expect(new Set(inject)).toEqual(new Set(["tools", "skills"]))
  expect(inject.length).toBeGreaterThan(0)

  // (2) Absent seams, apply forced directly: loud, never a success claim.
  const bareWarnings: string[] = []
  // A ctx with NO usable seam: `get` answers undefined, so the declaration check must fire.
  const bare: any = { logger: { warn: (line: string) => bareWarnings.push(line) }, get: () => undefined, provide: () => {} }
  expect(() => apply(bare, { quiet: true })).not.toThrow()
  expect(bareWarnings.some((line) => line.includes("FATAL: the harness seams this row registers through are unavailable"))).toBe(true)
  expect(bareWarnings.some((line) => line.includes('This row must declare inject: ["tools","skills"]'))).toBe(true)
  expect(bareWarnings.some((line) => line.includes("the extension interface is NOT usable in this session"))).toBe(true)
  expect(bareWarnings.some((line) => line.includes("mpdExtensions provided"))).toBe(false)

  // (3) Present but throwing seams: containment + the same loud summary.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "hostile", extensionManifest("hostile", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // Service values this hostile ctx was given through `provide`.
  const provided: Record<string, any> = {}
  // Every `logger.warn` line, so the assertions read the REPORTED text rather than a boolean.
  const warnings: string[] = []
  // A ctx whose tools and skills seams EXIST but throw, modelling a hostile harness.
  const ctx: any = {
    logger: { warn: (line: string) => warnings.push(line) },
    get: () => undefined,
    provide: (key: string, value: any) => { provided[key] = value },
    tools: { register: () => { throw new Error("tools seam gone") } },
    skills: { registerProvider: () => { throw new Error("skills seam gone") } },
  }
  expect(() => apply(ctx, { quiet: true })).not.toThrow()
  expect(provided.mpdExtensions.apiVersion).toBe(MPD_EXT_API_VERSION)
  // Casing-insensitive on purpose: what is pinned is that the failure is REPORTED, not which
  // revision's wording carries it (the pre-fix build reported nothing at all here).
  expect(warnings.some((line) => /skill provider for "hostile" not registered/i.test(line))).toBe(true)
  expect(warnings.filter((line) => /not registered/i.test(line)).length).toBeGreaterThanOrEqual(5)
  // …and the row ends by saying the interface is unusable, naming the declaration it carries,
  // so a session can never mistake this state for a healthy one.
  expect(warnings.some((line) => line.includes("FATAL: only 0/4 tools registered"))).toBe(true)
  expect(warnings.some((line) => line.includes('the row declares inject: ["tools","skills"]'))).toBe(true)
})

test("the four tools emit values that satisfy their own output schemas", async () => {
  // The workspace whose project plane carries the fixture extension.
  const workspace = makeDir("mpd-ext-ws-")
  writeExtension(projectExtensionsDir(workspace), "authoring-flows", extensionManifest("authoring-flows", {
    skills: [{ root: "skills" }],
    flows: [{ dir: "flows" }],
    mcp: [{ serverName: "lint-mcp", transport: "stdio", command: "node" }],
    roles: [{ name: "Code Reviewer", persona: "reviewer.md" }],
  }), {
    skills: { "style-check": GOOD_SKILL },
    flows: { "change-review.json": GOOD_FLOW },
    personas: { "reviewer.md": "You review a change." },
  })
  // The fake ctx and the tools `apply` registered; the provider capture is unused here.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })

  // mpd_ext_list over that workspace, where the project-plane fixture must appear.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // mpd_ext_show for the same extension: the per-item view a model reads.
  const shown = await callTool(registered, "mpd_ext_show", { id: "authoring-flows" }, workspace)
  // mpd_flow_list, whose one entry must be loadable.
  const flows = await callTool(registered, "mpd_flow_list", {}, workspace)
  // mpd_flow_show, carrying the full procedure of that flow.
  const flow = await callTool(registered, "mpd_flow_show", { id: "change-review" }, workspace)

  // The fixture's entry in the list, selected by id rather than by position.
  const ext = listed.extensions.find((entry: any) => entry.id === "authoring-flows")
  expect(ext.plane).toBe("project")
  expect(ext.contributions.skills).toBe(1)
  expect(ext.contributions.flows).toBe(1)
  // A project manifest may contribute skills and flows ONLY: mcp and roles are
  // rejected per item with the stated reason and contribute nothing.
  expect(ext.contributions.mcp).toBe(0)
  expect(ext.contributions.roles).toBe(0)
  expect(ext.errors.find((error: any) => error.item === "contributes.mcp[0]")?.reason).toBe(MPD_EXT_CONTRACT.projectRejectionReason)
  expect(shown.skills).toEqual(["style-check"])
  expect(shown.flows).toEqual(["change-review"])
  expect(shown.mcp).toEqual([])
  expect(flows.flows.find((entry: any) => entry.id === "change-review").loadable).toBe(true)
  expect(flow.steps.length).toBe(2)
  expect(flow.steps[0].tool).toBe("read")
  expect(flow.steps[1].output).toBe("A list of ranked risks.")

  // The project plane is re-read per call: another workspace sees nothing.
  const elsewhere = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-other-"))
  expect(projectEntriesOf(elsewhere)).toEqual([])
})

test("mpd_ext_show and mpd_flow_show report an unknown id as an error naming the known ids", async () => {
  // The workspace whose project plane is empty on purpose; the fixture lives in the user plane.
  const workspace = makeDir("mpd-ext-ws-")
  // The fake ctx and the tools `apply` registered.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  await expect(callTool(registered, "mpd_ext_show", { id: "nope" }, workspace)).rejects.toThrow(/unknown extension "nope"; known ids/)
  await expect(callTool(registered, "mpd_flow_show", { id: "nope" }, workspace)).rejects.toThrow(/unknown flow "nope"; known ids/)
})

// ── descriptor validation ───────────────────────────────────────────────────

test("descriptor validation rejects unknown keys, bad apiVersion, missing id, escapes and bad rank", () => {
  // A descriptor whose apiVersion is not the contract's 1: refused WHOLESALE, so nothing else is interpreted.
  const badVersion = validateDescriptor({ apiVersion: 2, id: "ext" })
  expect(badVersion.rejected).toBe(true)
  expect(badVersion.errors.some((error) => error.item === "apiVersion")).toBe(true)

  // A descriptor with no id at all; also refused wholesale.
  const missingId = validateDescriptor({ apiVersion: 1 })
  expect(missingId.rejected).toBe(true)
  expect(missingId.errors.some((error) => error.item === "id")).toBe(true)

  expect(validateDescriptor("nope").rejected).toBe(true)

  // RULE 0: unknown keys anywhere are loud and recorded — including the registry
  // metadata fields (origin/plane) an author must not supply.
  const unknownKeys = validateDescriptor({ apiVersion: 1, id: "ext", title: "x", origin: "plugin", plane: "user" })
  expect(unknownKeys.rejected).toBe(false)
  // The item paths the validator recorded, so a reader sees WHICH keys were refused.
  const items = unknownKeys.errors.map((error) => error.item)
  expect(items).toContain("descriptor.title")
  expect(items).toContain("descriptor.origin")
  expect(items).toContain("descriptor.plane")

  // Three per-item refusals at once: two escaping roots and a non-finite rank.
  const escaping = validateDescriptor({
    apiVersion: 1,
    id: "ext",
    contributes: { skills: [{ root: "../outside" }, { root: "/absolute" }], flows: [{ dir: "flows", rank: Number.NaN }] },
  })
  expect(escaping.rejected).toBe(false)
  expect(escaping.descriptor?.contributes.skills).toEqual([])
  expect(escaping.descriptor?.contributes.flows).toEqual([])
  // The refusal reasons joined one per line, so a single substring assertion covers all three.
  const reasons = escaping.errors.map((error) => `${error.item}:${error.reason}`).join("\n")
  expect(reasons).toContain("contributes.skills[0].root")
  expect(reasons).toContain("contributes.skills[1].root")
  expect(reasons).toContain("contributes.flows[0].rank")
})

test("role provider/model must be paired and persona must stay inside the root", () => {
  // The validation result for a role that supplies a provider but no model.
  const result = validateDescriptor({
    apiVersion: 1,
    id: "ext",
    contributes: { roles: [{ name: "R", persona: "p.md", provider: "deepseek-official" }] },
  })
  expect(result.descriptor?.contributes.roles).toEqual([])
  expect(result.errors.some((error) => error.reason.includes("provider and model must be supplied together"))).toBe(true)
})

test("effectiveEnabled follows disable > enable > descriptor", () => {
  // A built entry whose descriptor enables it, before any config override.
  const built = buildExtension({
    input: { apiVersion: 1, id: "ext", enabled: true, contributes: {} },
    plane: "user",
    origin: "directory",
    root: "",
    source: "test",
    fallbackId: "ext",
    providerName: "mpd-ext:ext",
  })
  // The built registry entry; present rather than undefined because the descriptor is valid.
  const entry = built.entry!
  // A base config with neither list populated, so each override below is the only difference.
  const base = { enable: [], disable: [], mcp: { enabled: true, connectTimeoutMs: 1, toolCallTimeoutMs: 1 } }
  expect(effectiveEnabled(entry, base)).toBe(true)
  expect(effectiveEnabled(entry, { ...base, disable: ["ext"] })).toBe(false)
  expect(effectiveEnabled(entry, { ...base, disable: ["ext"], enable: ["ext"] })).toBe(false)
  expect(effectiveEnabled(entry, { ...base, enable: ["ext"] })).toBe(true)
})

// ── discovery, precedence, rejection ────────────────────────────────────────

test("discovery precedence is project > user > bundle and shadowing is recorded, never fatal", async () => {
  // The user-plane root under the sandboxed HOME; this is the host-wide `~/.mpd/extensions`.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "shared", extensionManifest("shared", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The workspace that ALSO carries a `shared` extension, which must shadow the user one.
  const workspace = makeDir("mpd-ext-ws-")
  writeExtension(projectExtensionsDir(workspace), "shared", extensionManifest("shared", { skills: [{ root: "skills" }] }), { skills: { "lint-mcp": SECOND_SKILL } })

  // The fake ctx plus the tool and provider captures this case needs.
  const { ctx, registered, providers } = makeCtx()
  apply(ctx, { quiet: true })
  expect(userExtensionsDir()).toBe(userRoot)

  // The apply-time provider of the shadowed user extension emits nothing while a
  // project extension with the same id is present...
  const userProvider = providerNamed(providers, "mpd-ext:shared")
  expect(await userProvider.list({ cwd: workspace })).toEqual({ candidates: [], complete: true })
  // ...and emits again from a workspace without the shadowing extension.
  expect((await observedNames(userProvider, { cwd: makeDir("mpd-ext-ws-") })).names).toEqual(["style-check"])

  // The registry view keeps the project entry and records the shadow pair.
  const registry = new MpdExtensionRegistry()
  // The user-plane discovery for the shadowed id, added to the registry first.
  const discovery = discoverPlane({ plane: "user", dir: userExtensionsDir(), providerNameFor: () => "mpd-ext:shared", warn: () => {} })
  registry.add(discovery.entries[0])
  // The project-plane discovery; the merge must keep THIS entry and record the other as shadowed.
  const projectDiscovery = discoverPlane({ plane: "project", dir: projectExtensionsDir(workspace), providerNameFor: () => "mpd-ext:project-plane", warn: () => {} })
  // The merged view: project first, with the shadow pair recorded rather than dropped.
  const merged = registry.view(projectDiscovery)
  expect(merged.entries.map((entry) => entry.plane)).toEqual(["project"])
  expect(merged.shadowed.length).toBe(1)
  expect(merged.shadowed[0].kept.plane).toBe("project")
  expect(merged.shadowed[0].shadowed.plane).toBe("user")

  // ...and the tool reports it instead of failing.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The surviving `shared` entry as the tool reports it, taken from the project plane.
  const shared = projectEntriesOf(listed).find((entry: any) => entry.id === "shared")
  expect(shared).toBeDefined()
  expect(listed.shadowed.some((record: any) => record.id === "shared" && record.kept.plane === "project")).toBe(true)
  expect(listed.warnings.some((line: string) => line.includes("shadowed"))).toBe(true)
})

test("a malformed manifest is reported per item and never aborts apply or another extension", async () => {
  // The workspace whose project plane holds four manifests, one broken per failure class.
  const workspace = makeDir("mpd-ext-ws-")
  // The project-plane root all four extensions are written into.
  const root = projectExtensionsDir(workspace)
  writeExtension(root, "bad-json", "{ not json")
  writeExtension(root, "bad-version", extensionManifest("bad-version", {}, { apiVersion: 9 }))
  writeExtension(root, "no-id", { apiVersion: 1, contributes: {} })
  writeExtension(root, "good-one", extensionManifest("good-one", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })

  // The fake ctx and the tools `apply` registered.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The report; a broken sibling must not remove the good entry or abort apply.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  expect(projectEntriesOf(listed).map((entry: any) => entry.id)).toEqual(["good-one"])
  expect(listed.rejected.map((entry: any) => entry.id).sort()).toEqual(["bad-json", "bad-version", "no-id"])
  expect(listed.warnings.some((line: string) => line.includes("rejected"))).toBe(true)
})

test("the project plane is re-read per call and never leaks across workspaces", async () => {
  // The only workspace that carries an extension.
  const workspaceA = makeDir("mpd-ext-a-")
  // A second workspace with an EMPTY project plane, which must not see workspaceA's entry.
  const workspaceB = makeDir("mpd-ext-b-")
  writeExtension(projectExtensionsDir(workspaceA), "only-a", extensionManifest("only-a", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the tools `apply` registered.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The listing for workspaceA, where the extension must appear.
  const inA = await callTool(registered, "mpd_ext_list", {}, workspaceA)
  // The listing for workspaceB, which must report no project entries.
  const inB = await callTool(registered, "mpd_ext_list", {}, workspaceB)
  expect(projectEntriesOf(inA).map((entry: any) => entry.id)).toEqual(["only-a"])
  expect(projectEntriesOf(inB)).toEqual([])
})

// ── the skills plane ────────────────────────────────────────────────────────

test("skill candidates are pre-validated: a bad candidate is skipped, warned and never emitted", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "mixed", extensionManifest("mixed", { skills: [{ root: "skills" }] }), {
    skills: { "style-check": GOOD_SKILL, "lint-mcp": SECOND_SKILL, "broken-style": EMPTY_DESCRIPTION_SKILL },
  })
  // The fake ctx and the provider factories it collected.
  const { ctx, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The extension's own provider, addressed by the name that was allocated for it.
  const provider = providerNamed(providers, "mpd-ext:mixed")
  // The candidates it emits; the invalid one must be ABSENT, not merely flagged.
  const candidates = observed(await provider.list({ cwd: makeDir("mpd-ext-ws-") })).candidates
  expect(candidates.map((candidate: any) => candidate.name).sort()).toEqual(["lint-mcp", "style-check"])
  for (const candidate of candidates) {
    expect(candidateViolation(candidate, "mpd-ext:mixed")).toBeUndefined()
    expect(candidate.provider).toBe("mpd-ext:mixed")
    expect(Number.isFinite(candidate.rank)).toBe(true)
    expect(SKILL_NAME.test(candidate.name)).toBe(true)
  }
  expect(await provider.get(candidates[0], { cwd: makeDir("mpd-ext-ws-") })).toBeDefined()
})

test("the provider pre-validates at emit time too, and reports the skip to the owner", async () => {
  // The skip reasons the provider reported to its owner.
  const skipped: string[] = []
  // A provider whose only candidate has an empty description, so list() must drop it.
  const provider = createSkillProvider({
    name: "mpd-ext:emit",
    warn: () => {},
    onSkip: (reason) => skipped.push(reason),
    entries: () => [
      {
        document: { name: "broken", description: "", invocation: { modelInvocable: true, userInvocable: true }, content: "x" },
        locator: {},
        source: "test",
        rank: 300,
      },
    ],
  })
  expect(await provider.list({})).toEqual({ candidates: [], complete: true })
  expect(skipped.some((reason) => reason.includes("empty description"))).toBe(true)
})

test("a loaded candidate is recorded on the extension when its items are unusable", () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  // The extension directory, which is also the root its declared skill path resolves against.
  const dir = writeExtension(userRoot, "mixed", extensionManifest("mixed", { skills: [{ root: "skills" }] }), {
    skills: { "style-check": GOOD_SKILL, "broken-style": EMPTY_DESCRIPTION_SKILL },
  })
  // The build result for a manifest read back from disk, exercising the path the CLI's validate uses.
  const built = buildExtension({
    input: JSON.parse(readFileSync(join(dir, MPD_EXT_CONTRACT.manifestFile), "utf8")),
    plane: "user",
    origin: "directory",
    root: dir,
    source: dir,
    fallbackId: "mixed",
    providerName: "mpd-ext:mixed",
  })
  expect(built.entry?.skills).toEqual(["style-check"])
  expect(built.entry?.errors.some((error) => error.item.includes("broken-style") && error.reason.includes("description"))).toBe(true)
})

test("the project-plane skill provider resolves per call from provider.list({ cwd })", async () => {
  // The workspace whose project plane contributes one flow.
  const workspaceA = makeDir("mpd-ext-a-")
  // A workspace with no project extension, so a per-call resolver must answer differently.
  const workspaceB = makeDir("mpd-ext-b-")
  writeExtension(projectExtensionsDir(workspaceA), "proj", extensionManifest("proj", { flows: [{ dir: "flows" }] }), { flows: { "change-review.json": GOOD_FLOW } })
  // The fake ctx and the provider factories it collected.
  const { ctx, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The single project-plane provider shared by every workspace.
  const provider = providerNamed(providers, "mpd-ext:project-plane")
  // Its candidates for workspaceA: exactly the contributed flow.
  const inA = observed(await provider.list({ cwd: workspaceA })).candidates
  expect(inA.map((candidate: any) => candidate.name)).toEqual(["change-review"])
  expect(inA[0].provider).toBe("mpd-ext:project-plane")
  expect(await provider.list({ cwd: workspaceB })).toEqual({ candidates: [], complete: true })
  // get() serves the rendered flow document, re-validated against its candidate.
  const definition = await provider.get(inA[0], { cwd: workspaceA })
  expect(definition.name).toBe("change-review")
  expect(definition.content).toContain("## Steps")
  expect(definition.provider).toBe("mpd-ext:project-plane")
})

test("a skill provider never throws out of list()/get() when discovery fails", async () => {
  // A provider whose enumeration throws, modelling a transient filesystem failure.
  const provider = createSkillProvider({
    name: "mpd-ext:boom",
    warn: () => {},
    entries: () => { throw new Error("disk on fire") },
  })
  // F3: an enumeration failure must be reported as an INCOMPLETE observation. An
  // ARRAY would be read as `{candidates:[], complete:true}` and CACHED per
  // (cwd, scope, revision) by the harness, so one transient filesystem failure would
  // hide this provider's skills for the rest of the session
  // (H/dsh-skill/lib/index.js:414-426 + collect()'s cache write).
  expect(await provider.list({})).toEqual({ candidates: [], complete: false })
  expect(await provider.get({ name: "x" }, {})).toBeUndefined()
  // A second provider over the same name whose entries hold a non-object item.
  const nonObject = createSkillProvider({ name: "mpd-ext:boom", warn: () => {}, entries: () => [null as any] })
  // A per-candidate data problem is permanent until the files change, so that
  // observation stays COMPLETE (only the enumeration failing is transient).
  expect(await nonObject.list({})).toEqual({ candidates: [], complete: true })
})

test("provider names are unique by construction", () => {
  // Names already allocated; the allocator must suffix every repeat.
  const taken = new Set<string>()
  expect(allocateProviderName(taken, "mpd-ext:style")).toBe("mpd-ext:style")
  expect(allocateProviderName(taken, "mpd-ext:style")).toBe("mpd-ext:style-2")
  expect(allocateProviderName(taken, "mpd-ext:style")).toBe("mpd-ext:style-3")
  expect(taken.size).toBe(3)
})

// ── the flows plane ─────────────────────────────────────────────────────────

test("flows render into skill candidates and a flow id outside the skill grammar is rejected loudly", () => {
  // A doubled dash is outside the skill-name grammar a flow id must satisfy.
  const bad = parseFlowDocument({ ...GOOD_FLOW, id: "a--b" }, "flows/bad.json")
  expect(bad.flow).toBeUndefined()
  expect(bad.errors.some((error) => error.reason.includes("skill-name grammar"))).toBe(true)

  // An extra top-level key, which the flow contract refuses per document.
  const unknownKey = parseFlowDocument({ ...GOOD_FLOW, extra: true }, "flows/extra.json")
  expect(unknownKey.flow).toBeUndefined()
  expect(unknownKey.errors.some((error) => error.reason.includes('unknown flow key "extra"'))).toBe(true)

  // No `steps` at all, where the contract requires a non-empty array.
  const noSteps = parseFlowDocument({ id: "x", title: "t", description: "d" }, "flows/nosteps.json")
  expect(noSteps.errors.some((error) => error.reason.includes("non-empty array"))).toBe(true)

  // The rendered skill document, which must read as a procedure a model can follow.
  const rendered = renderFlowSkill(GOOD_FLOW as any)
  expect(rendered).toContain("# Change review")
  expect(rendered).toContain("## Steps")
  expect(rendered).toContain("`read`")
})

test("a broken flow file is skipped and recorded while its siblings keep working", () => {
  // The workspace whose project plane holds three flow files, two of them broken.
  const workspace = makeDir("mpd-ext-ws-")
  writeExtension(projectExtensionsDir(workspace), "flows-mixed", extensionManifest("flows-mixed", { flows: [{ dir: "flows" }] }), {
    flows: { "good.json": GOOD_FLOW, "bad-id.json": { ...GOOD_FLOW, id: "bad--id" }, "bad-json.json": "{ oops" },
  })
  // The project-plane discovery; a broken sibling must not hide the good flow.
  const discovery = discoverPlane({ plane: "project", dir: projectExtensionsDir(workspace), providerNameFor: () => "mpd-ext:project-plane", warn: () => {} })
  // The one usable entry this fixture contributes.
  const entry = discovery.entries[0]
  expect(entry.flows).toEqual(["change-review"])
  expect(entry.flowEntries.length).toBe(1)
  expect(entry.errors.filter((error) => error.item.includes("bad-")).length).toBe(2)
})

// ── config is read lazily ───────────────────────────────────────────────────

test("config is read lazily per use: disable/enable are honoured after apply", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "toggled", extensionManifest("toggled", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The mutable config state the fake mpdConfig answers from; cases change it AFTER apply.
  const state: any = { "extensions.disable": [], "extensions.enable": [], "extensions.mcp": { enabled: true, connectTimeoutMs: 1234, toolCallTimeoutMs: 5678 } }
  // A fake mpdConfig whose `get` reads that live state, which is what makes laziness observable.
  const config = { get: (key: string) => state[key], reload: () => {}, states: () => ({ files: [], errors: [] }) }
  // The fake ctx wired to it, plus the tool and provider captures.
  const { ctx, registered, providers } = makeCtx(config)
  apply(ctx, { quiet: true })
  // The extension's provider, which must re-read the config on every call.
  const provider = providerNamed(providers, "mpd-ext:toggled")
  // The workspace every tool call in this case names.
  const workspace = makeDir("mpd-ext-ws-")
  // The extension's effective enabled flag as the tool reports it right now.
  const enabledOf = async (): Promise<boolean> =>
    (await callTool(registered, "mpd_ext_list", {}, workspace)).extensions.find((entry: any) => entry.id === "toggled").enabled

  expect(observed(await provider.list({ cwd: workspace })).candidates.length).toBe(1)
  expect(await enabledOf()).toBe(true)

  // The value changes AFTER apply: nothing was captured at apply time.
  state["extensions.disable"] = ["toggled"]
  expect(await provider.list({ cwd: workspace })).toEqual({ candidates: [], complete: true })
  expect(await enabledOf()).toBe(false)

  // disable wins over enable
  state["extensions.enable"] = ["toggled"]
  expect(await enabledOf()).toBe(false)

  state["extensions.disable"] = []
  expect(await enabledOf()).toBe(true)
})

test("extensionConfig reads every extensions.* key lazily from mpdConfig (declared process-level limit)", () => {
  // The config state the fake mpdConfig answers from.
  const state: any = {
    "extensions.enable": ["a"],
    "extensions.disable": ["b"],
    "extensions.mcp": { enabled: false, connectTimeoutMs: 2500, toolCallTimeoutMs: 9999 },
  }
  // How many times mpdConfig.reload was called; the declared v1 limit says never.
  let reloads = 0
  // A fake mpdConfig that counts reload calls, which is the assertion below.
  const config = { get: (key: string) => state[key], reload: () => { reloads += 1 }, states: () => ({ files: [], errors: [] }) }
  expect(extensionConfig(makeCtx(config).ctx)).toEqual({
    enable: ["a"],
    disable: ["b"],
    mcp: { enabled: false, connectTimeoutMs: 2500, toolCallTimeoutMs: 9999 },
  })
  // The declared v1 limit: `extensions.*` is PROCESS-LEVEL, so we never call
  // mpdConfig.reload(exec) — mutating the shared cache once per skill snapshot
  // would make the provider's view and the tools' view disagree.
  expect(reloads).toBe(0)
  // The config resolved with NO mpdConfig service, which must fall back to the contract's defaults.
  const fallback = extensionConfig(makeCtx(undefined).ctx)
  expect(fallback.enable).toEqual([])
  expect(fallback.disable).toEqual([])
  expect(fallback.mcp.enabled).toBe(true)
  expect(fallback.mcp.connectTimeoutMs).toBe(MPD_EXT_CONTRACT.defaultConnectTimeoutMs)
  expect(fallback.mcp.toolCallTimeoutMs).toBe(MPD_EXT_CONTRACT.defaultToolCallTimeoutMs)
})

test("mcp.enabled=false is honoured per call and surfaced instead of silently pending", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "with-mcp", extensionManifest("with-mcp", {
    mcp: [{ serverName: "srv", transport: "stdio", command: "node", connectTimeoutMs: 500, toolCallTimeoutMs: 700 }],
  }))
  // The config state; the case flips `extensions.mcp.enabled` between calls.
  const state: any = { "extensions.mcp": { enabled: true } }
  // A fake mpdConfig over that state.
  const config = { get: (key: string) => state[key], reload: () => {}, states: () => ({ files: [], errors: [] }) }
  // The fake ctx wired to it, plus the tool capture.
  const { ctx, registered } = makeCtx(config)
  apply(ctx, { quiet: true })
  // The extension's pending list as the tool reports it under the CURRENT config.
  const pendingOf = async (): Promise<any[]> =>
    (await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))).extensions.find((entry: any) => entry.id === "with-mcp").pending

  // Pending items while MCP is enabled: the declared timeouts must be reported, not just noted.
  const enabled = await pendingOf()
  expect(enabled.some((item: any) => item.item === "contributes.mcp[0]" && item.reason.includes("connectTimeoutMs=500"))).toBe(true)
  expect(enabled.some((item: any) => item.item === "contributes.mcp[0]" && item.reason.includes("toolCallTimeoutMs=700"))).toBe(true)

  state["extensions.mcp"] = { enabled: false }
  // Pending items after mcp.enabled=false: one item for the kind, carrying that reason.
  const disabled = await pendingOf()
  expect(disabled.some((item: any) => item.item === "contributes.mcp" && item.reason.includes("extensions.mcp.enabled=false"))).toBe(true)
})

test("a missing mpdConfig degrades to the documented defaults", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "plain", extensionManifest("plain", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // A ctx with no mpdConfig service at all, so the documented defaults must apply.
  const { ctx, registered } = makeCtx(undefined)
  apply(ctx, { quiet: true })
  // The report; the extension must be enabled by the descriptor default alone.
  const listed = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))
  expect(listed.extensions.find((entry: any) => entry.id === "plain").enabled).toBe(true)
})

// ── the code plane ──────────────────────────────────────────────────────────

test("the code plane registers through ctx.get(\"mpdExtensions\") and shares the same validation", async () => {
  // The workspace this run names; the code plane registers a path inside it.
  const workspace = makeDir("mpd-ext-ws-")
  // The extension root an author would pass to register(); every asset path resolves against it.
  const root = join(workspace, "code-ext")
  mkdirSync(join(root, "skills", "code-style"), { recursive: true })
  writeFileSync(join(root, "skills", "code-style", "SKILL.md"), GOOD_SKILL)
  // The fake ctx plus all four captures: this case reads the service, the tools and the providers.
  const { ctx, registered, provided, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The service object `apply` provided, used the way a second plugin would use it.
  const service = provided.mpdExtensions

  // The code-plane registration result: ok, with no per-item errors.
  const result = service.register({ apiVersion: 1, id: "code-ext", contributes: { skills: [{ root: "skills" }] } }, { root })
  expect(result.ok).toBe(true)
  expect(result.errors).toEqual([])
  expect(providers.map((create) => create({}).name)).toContain("mpd-ext:code-ext")

  // The tool-side view of the same registration.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The registered entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "code-ext")
  expect(entry.plane).toBe("bundle")
  expect(entry.origin).toBe("plugin")

  // A descriptor without a root cannot resolve assets: the item is recorded.
  const noRoot = service.register({ apiVersion: 1, id: "no-root", contributes: { skills: [{ root: "skills" }] } })
  expect(noRoot.ok).toBe(true)
  expect(noRoot.errors.some((error: any) => error.reason.includes("extension root is required"))).toBe(true)

  // A duplicate id is first-wins and recorded, never fatal.
  const duplicate = service.register({ apiVersion: 1, id: "code-ext" }, { root })
  expect(duplicate.ok).toBe(false)
  expect(duplicate.shadowed?.id).toBe("code-ext")

  // An uninterpretable descriptor is rejected wholesale, still without throwing.
  const bad = service.register({ apiVersion: 4, id: "code-ext-2" })
  expect(bad.ok).toBe(false)
  expect(bad.errors.some((error: any) => error.item === "apiVersion")).toBe(true)
})

test("describe() answers the frozen descriptor shape for a known extension", () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "shape", extensionManifest("shape", { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] }), {
    skills: { "style-check": GOOD_SKILL },
    flows: { "change-review.json": GOOD_FLOW },
  })
  // The fake ctx and the service capture; only describe() is exercised here.
  const { ctx, provided } = makeCtx()
  apply(ctx, { quiet: true })
  // The frozen describe() answer a consumer plugin would receive.
  const described = provided.mpdExtensions.describe("shape")
  expect(described.id).toBe("shape")
  expect(described.enabled).toBe(true)
  expect(Object.keys(described.descriptor).sort()).toEqual(["apiVersion", "contributes", "description", "enabled", "id"])
  expect(described.descriptor.apiVersion).toBe(1)
  expect(described.descriptor.contributes.skills[0].rank).toBe(MPD_EXT_CONTRACT.defaultRank)
  expect(described.descriptor.contributes.flows[0].rank).toBe(MPD_EXT_CONTRACT.defaultRank)
  expect(described.skills).toEqual(["style-check"])
  expect(described.flows).toEqual(["change-review"])
})

// ── failure isolation and declared-but-pending kinds ────────────────────────

test("one broken extension of each kind leaves the good ones working", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "broken-skills", extensionManifest("broken-skills", { skills: [{ root: "missing-dir" }, { root: "skills" }] }), {
    skills: { "style-check": EMPTY_DESCRIPTION_SKILL },
  })
  writeExtension(userRoot, "broken-roles", extensionManifest("broken-roles", { roles: [{ name: "R", persona: "persona.md" }] }))
  writeExtension(userRoot, "broken-mcp", extensionManifest("broken-mcp", { mcp: [{ serverName: "bad name", transport: "stdio", command: "" }] }))
  writeExtension(userRoot, "healthy", extensionManifest("healthy", { skills: [{ root: "skills" }] }), { skills: { "lint-mcp": SECOND_SKILL } })

  // The fake ctx plus the tool and provider captures.
  const { ctx, providers, registered } = makeCtx()
  apply(ctx, { quiet: true })
  expect(registered.map((definition) => definition.name).sort()).toEqual(["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show"])
  // The one healthy extension's provider, which a broken sibling per kind must leave intact.
  const healthy = providerNamed(providers, "mpd-ext:healthy")
  expect((await observedNames(healthy, {})).names).toEqual(["lint-mcp"])

  // The report each broken kind is asserted against.
  const listed = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))
  // Look one extension up by id, since discovery order is not what is under test.
  const find = (id: string): any => listed.extensions.find((entry: any) => entry.id === id)
  expect(find("broken-skills").errors.length).toBeGreaterThan(0)
  expect(find("broken-roles").errors.some((error: any) => error.reason.includes("does not exist"))).toBe(true)
  expect(find("broken-mcp").errors.length).toBeGreaterThan(0)
  expect(find("healthy").contributions.skills).toBe(1)
})

test("mcp is pending until the bridge connects it, while roles are NEVER pending (t14/F3)", async () => {
  // The user-plane root under the sandboxed HOME.
  const userRoot = join(process.env.HOME as string, ".mpd", "extensions")
  writeExtension(userRoot, "declare-all", extensionManifest("declare-all", {
    mcp: [{ serverName: "lint-mcp", transport: "stdio", command: "node" }],
    roles: [{ name: "Code Reviewer", persona: "reviewer.md" }],
  }), { personas: { "reviewer.md": "You review a change." } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool call names; the entry itself lives in the user plane.
  const workspace = makeDir("mpd-ext-ws-")
  // The report, where mcp is pending while roles are exposed per call.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "declare-all")
  // mcp: the runtime bridge owns this line (the declared server is not connected).
  expect(entry.contributions.mcp).toBe(1)
  expect(entry.pending.some((item: any) => item.item === "contributes.mcp[0]" && item.reason.startsWith("pending:"))).toBe(true)
  // roles: exposed per call by mpd-roles-plugin, so there is nothing pending here.
  expect(entry.pending.some((item: any) => item.item === "contributes.roles")).toBe(false)
  expect(entry.contributions.roles).toBe(1)
  // The single-extension view, whose pending list must omit the roles item too.
  const shown = await callTool(registered, "mpd_ext_show", { id: "declare-all" }, workspace)
  expect(shown.roles).toEqual(["Code Reviewer"])
  expect(shown.pending.some((item: any) => item.item === "contributes.roles")).toBe(false)
  expect(listed.warnings.some((line: string) => line.includes("pending:"))).toBe(true)
})

// ── t14: the roles report describes the CURRENT system ──────────────────────
//
// Two measured reporting defects (t14/F3, t14/F4):
//   F3  the roles contribution emitted a 'pending' line claiming extension roles
//       were "declared here, not yet exposed through mpd_roles_list" — false in
//       every running session since the roster resolves them per call.
//   F4  a role the roster REFUSES (base-name collision, cross-extension
//       collision, unreadable persona) was still reported as a usable
//       contribution, so mpd_ext_* and mpd_roles_list disagreed about it.
//
// The parity test at the end is the real guarantee: it asks the ROSTER's own
// resolver what it exposes and refuses, and requires this package's report to
// match — including every reason string.

/** The user-plane discovery root under the sandboxed HOME, i.e. `~/.mpd/extensions`. */
const userExtensionsRoot = (): string => join(process.env.HOME as string, ".mpd", "extensions")

/**
 * The refusal marker, declared HERE rather than imported: the whole point of these
 * tests is that they run against the PRE-fix code too (to measure RED), so they may
 * only use symbols both revisions export. The string itself is the observable
 * surface, and a changed export breaks these assertions anyway.
 */
const REFUSED_PREFIX = "refused: "

/** The refusal reasons one reported entry carries, with the marker stripped. */
function refusalNotes(entry: any): string[] {
  return entry.errors
    .map((error: any) => String(error.reason))
    // Annotated because `entry` is `any`, so no contextual type reaches this callback.
    .filter((reason: string) => reason.startsWith(REFUSED_PREFIX))
    // Same reason as the filter above: the receiver is `any`, so the parameter needs its type written down.
    .map((reason: string) => reason.slice(REFUSED_PREFIX.length))
}

/** Build a registry entry from a descriptor alone, modelling the CLI's `validate` path with no view and no activation. */
function builtEntry(id: string, contributes: Record<string, unknown>, root: string): any {
  // The build result; the case asserts on `.entry`, which is present for a valid descriptor.
  const built = buildExtension({
    input: extensionManifest(id, contributes),
    plane: "user",
    origin: "directory",
    root,
    source: "test",
    fallbackId: id,
    providerName: `mpd-ext:${id}`,
  })
  return built.entry
}

test("t14/F3: a live roles contribution reports no pending item and no 'not yet exposed' claim", async () => {
  writeExtension(userExtensionsRoot(), "live-roles", extensionManifest("live-roles", {
    roles: [{ name: "Code Reviewer", persona: "reviewer.md" }],
  }), { personas: { "reviewer.md": "You review a change." } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool calls in this case name.
  const workspace = makeDir("mpd-ext-ws-")

  // The report; a live role must produce no pending item and no refusal.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "live-roles")
  expect(entry.contributions.roles).toBe(1)
  expect(entry.pending.some((item: any) => item.item === "contributes.roles")).toBe(false)
  expect(refusalNotes(entry)).toEqual([])

  // The single-extension view, which must carry the same absence of a roles pending item.
  const shown = await callTool(registered, "mpd_ext_show", { id: "live-roles" }, workspace)
  expect(shown.roles).toEqual(["Code Reviewer"])
  expect(shown.resolvedRoots.roles).toHaveLength(1)
  expect(shown.pending.some((item: any) => item.item === "contributes.roles")).toBe(false)

  // The exact sentence the old line carried must be gone from every surface.
  for (const value of [listed, shown]) {
    expect(JSON.stringify(value)).not.toContain("not yet exposed through mpd_roles_list")
    expect(JSON.stringify(value)).not.toContain("is resolved per call by mpd-roles-plugin (t4)")
  }
})

test("t14/F4: a role colliding with a BASE roster name is refused with the roster's reason, in both paths", async () => {
  // `architect` is the base roster's Architect: the roster's name key is
  // case-insensitive, so this collides — and the base always wins.
  const root = writeExtension(userExtensionsRoot(), "base-collision", extensionManifest("base-collision", {
    roles: [{ name: "architect", persona: "reviewer.md" }],
  }), { personas: { "reviewer.md": "You review a change." } })

  // The dev CLI's `validate` path builds an entry with NO view (no activation), so
  // the refusal must be decided at build time too.
  const direct = builtEntry("base-collision", { roles: [{ name: "architect", persona: "reviewer.md" }] }, root)
  expect(refusalNotes(direct)).toEqual([
    'role name "architect" (contributes.roles[0] of extension "base-collision") is already taken by the base roster — this extension role is not exposed',
  ])
  expect(direct.roles).toEqual([])
  expect(direct.contributions.roles).toBe(0)

  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool calls in this case name.
  const workspace = makeDir("mpd-ext-ws-")
  // The report, which must agree with the build-time refusal asserted above.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "base-collision")
  expect(entry.contributions.roles).toBe(0)
  expect(refusalNotes(entry)).toHaveLength(1)
  expect(refusalNotes(entry)[0]).toContain("already taken by the base roster")
  // The single-extension view of the same run.
  const shown = await callTool(registered, "mpd_ext_show", { id: "base-collision" }, workspace)
  expect(shown.roles).toEqual([])
  expect(shown.resolvedRoots.roles).toEqual([])
})

test("t14/F4: an unreadable OR empty persona is refused, and the empty case is no longer accepted", async () => {
  writeExtension(userExtensionsRoot(), "persona-broken", extensionManifest("persona-broken", {
    roles: [
      { name: "Missing Persona", persona: "nope.md" },
      { name: "Empty Persona", persona: "empty.md" },
    ],
  }), { personas: { "empty.md": "" } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool calls in this case name.
  const workspace = makeDir("mpd-ext-ws-")
  // The report; BOTH broken role items must be refused.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "persona-broken")

  expect(entry.contributions.roles).toBe(0)
  expect(refusalNotes(entry)).toHaveLength(2)
  for (const reason of refusalNotes(entry)) expect(reason.startsWith("persona file is not readable: ")).toBe(true)
  // The plain load errors survive alongside the refusal (one line per broken asset).
  expect(entry.errors.some((error: any) => error.reason.includes("does not exist"))).toBe(true)
  expect(entry.errors.some((error: any) => error.reason.includes("persona file is empty"))).toBe(true)
  // The single-extension view, where no role survives the refusals.
  const shown = await callTool(registered, "mpd_ext_show", { id: "persona-broken" }, workspace)
  expect(shown.roles).toEqual([])
})

test("t14/F4: a CROSS-extension name collision refuses the LATER extension and names the holder", async () => {
  // Discovery order is the sorted directory name, and the roster walks that same
  // order: `alpha-owner` wins, `zeta-clone` is refused.
  writeExtension(userExtensionsRoot(), "alpha-owner", extensionManifest("alpha-owner", {
    roles: [{ name: "Shared Role", persona: "p.md" }],
  }), { personas: { "p.md": "owner" } })
  writeExtension(userExtensionsRoot(), "zeta-clone", extensionManifest("zeta-clone", {
    roles: [{ name: "Shared Role", persona: "p.md" }],
  }), { personas: { "p.md": "clone" } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool calls name; both extensions live in the USER plane.
  const workspace = makeDir("mpd-ext-ws-")
  // The report both sides of the collision are read from.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The extension discovery saw first, which keeps the contested name.
  const owner = listed.extensions.find((candidate: any) => candidate.id === "alpha-owner")
  // The later extension, which must be refused and must name the holder.
  const clone = listed.extensions.find((candidate: any) => candidate.id === "zeta-clone")

  expect(owner.contributions.roles).toBe(1)
  expect(refusalNotes(owner)).toEqual([])
  expect(clone.contributions.roles).toBe(0)
  expect(refusalNotes(clone)).toEqual([
    'role name "Shared Role" (contributes.roles[0] of extension "zeta-clone") is already taken by extension "alpha-owner" — this extension role is not exposed',
  ])
  // The single-extension view of the refused side.
  const shown = await callTool(registered, "mpd_ext_show", { id: "zeta-clone" }, workspace)
  expect(shown.roles).toEqual([])
})

test("t14: a disabled extension's declared roles are reported as not exposed, never as usable", async () => {
  writeExtension(userExtensionsRoot(), "roles-off", extensionManifest("roles-off", {
    roles: [{ name: "Off Role", persona: "p.md" }],
  }, { enabled: false }), { personas: { "p.md": "off" } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool calls in this case name.
  const workspace = makeDir("mpd-ext-ws-")
  // The report for a descriptor-disabled extension.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The disabled fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "roles-off")
  expect(entry.contributions.roles).toBe(0)
  // Its pending roles item; a disabled extension must still EXPLAIN the absence.
  const pending = entry.pending.find((item: any) => item.item === "contributes.roles")
  expect(pending).toBeDefined()
  expect(pending.reason).toContain("disabled")
  expect(pending.reason).not.toContain("not yet exposed through mpd_roles_list")
  // The single-extension view, which must agree that nothing is exposed.
  const shown = await callTool(registered, "mpd_ext_show", { id: "roles-off" }, workspace)
  expect(shown.roles).toEqual([])
  expect(shown.enabled).toBe(false)
})

test("t14: refusal notes are idempotent — repeated calls neither duplicate nor lose them", async () => {
  writeExtension(userExtensionsRoot(), "repeat-refusal", extensionManifest("repeat-refusal", {
    roles: [{ name: "Researcher", persona: "p.md" }],
  }), { personas: { "p.md": "reviewer" } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace all three calls in this case name.
  const workspace = makeDir("mpd-ext-ws-")
  // The first listing, which is the baseline the repeated calls are compared against.
  const first = await callTool(registered, "mpd_ext_list", {}, workspace)
  // A second identical listing: the notes must be re-derived, not accumulated.
  const second = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The single-extension view, which must carry the identical notes.
  const third = await callTool(registered, "mpd_ext_show", { id: "repeat-refusal" }, workspace)
  // Reach one listing's fixture entry, so all three surfaces are read the same way.
  const forEach = (value: any): any => value.extensions.find((candidate: any) => candidate.id === "repeat-refusal")
  expect(refusalNotes(forEach(first))).toHaveLength(1)
  expect(refusalNotes(forEach(second))).toEqual(refusalNotes(forEach(first)))
  expect(forEach(second).errors.length).toBe(forEach(first).errors.length)
  expect(refusalNotes(third)).toEqual(refusalNotes(forEach(first)))
})

test("t14: the ext report and the ROSTER agree about every role (parity, measured against the resolver)", async () => {
  // One healthy role, plus one role per refusal class.
  writeExtension(userExtensionsRoot(), "alpha-owner", extensionManifest("alpha-owner", {
    roles: [
      { name: "Code Reviewer", persona: "ok.md" },
      { name: "Architect", persona: "ok.md" },
      { name: "Roster Clone", persona: "missing.md" },
    ],
  }), { personas: { "ok.md": "healthy" } })
  writeExtension(userExtensionsRoot(), "zeta-clone", extensionManifest("zeta-clone", {
    roles: [{ name: "Code Reviewer", persona: "ok.md" }],
  }), { personas: { "ok.md": "clone" } })

  // The fake ctx, the tools it registered and the service the roster resolver reads.
  const { ctx, registered, provided } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace both surfaces are asked about.
  const workspace = makeDir("mpd-ext-ws-")
  // The exec object the roster resolver resolves the project plane through.
  const exec = execFor(workspace)
  // This package's own report for that workspace.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)

  // What the ROSTER itself resolves for this same call.
  // Cast: this fake ctx deliberately stubs only `get` — the roster resolver reads nothing else here, and the
  // cast is the only way to hand a partial fake to a signature that demands the full ctx type.
  const rosterCtx = { get: (key: string) => (key === "mpdExtensions" ? provided.mpdExtensions : undefined) } as unknown as Parameters<typeof extensionRoles>[0]
  // What mpd-roles-plugin's own resolver answers for the same call: the independent side of the parity check.
  const resolved = extensionRoles(rosterCtx, exec, () => {})

  // (1) Every refusal the roster makes is reported here, with the identical reason:
  //     a base-roster name collision, a cross-extension collision, and an
  //     unreadable persona — the three classes the roster can refuse.
  const mine = listed.extensions.flatMap((entry: any) => refusalNotes(entry)).sort()
  // The roster's refusal reasons, sorted so the comparison does not depend on either side's order.
  const theirs = resolved.refused.map((refusal: any) => refusal.reason).sort()
  expect(mine).toEqual(theirs)
  expect(theirs).toHaveLength(3)
  expect(theirs.some((reason: string) => reason.includes("already taken by the base roster"))).toBe(true)
  expect(theirs.some((reason: string) => reason.includes('already taken by extension "alpha-owner"'))).toBe(true)
  expect(theirs.some((reason: string) => reason.startsWith("persona file is not readable: "))).toBe(true)

  // (2) The names each surface says are usable are the same names.
  const myUsable = provided.mpdExtensions
    .list({ exec })
    .extensions.flatMap((entry: any) => entry.roles)
    .sort()
  expect(myUsable).toEqual(resolved.roles.map((role: any) => role.name).sort())
  expect(myUsable).toContain("Code Reviewer")

  // (3) The base-name rule uses the roster's OWN name key: case-, space-, hyphen- and
  //     underscore-insensitive, so every spelling of a base name collides — pinned
  //     behaviourally just below.
})

test("t14: every spelling of a base roster name collides (case- and separator-insensitive)", async () => {
  // The roster keys names by stripping every non-alphanumeric character and lowering
  // the case, so all of these are the base role "Deep Worker".
  writeExtension(userExtensionsRoot(), "key-shapes", extensionManifest("key-shapes", {
    roles: [
      { name: "deep-worker", persona: "p.md" },
      { name: "DEEP WORKER", persona: "p.md" },
      { name: "DeepWorker", persona: "p.md" },
    ],
  }), { personas: { "p.md": "worker" } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The workspace the tool call in this case names.
  const workspace = makeDir("mpd-ext-ws-")
  // The report for three different spellings of one base-roster name.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The fixture's entry; all three of its roles must be refused.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "key-shapes")
  expect(entry.contributions.roles).toBe(0)
  expect(refusalNotes(entry)).toHaveLength(3)
  for (const reason of refusalNotes(entry)) expect(reason).toContain("already taken by the base roster")
})

test("discoverPlane never throws for a missing root", () => {
  // The discovery over a root that does not exist, which must degrade to an empty result.
  const result = discoverPlane({ plane: "user", dir: join(makeDir("mpd-ext-none-"), "does-not-exist"), providerNameFor: () => "x", warn: () => {} })
  expect(result.entries).toEqual([])
  expect(result.rejected).toEqual([])
  expect(result.done).toBe(true)
  expect(existsSync(process.env.HOME as string)).toBe(true)
})

/**
 * t16 regression: a PROJECT-plane extension's role must not reach the roster.
 *
 * The frozen contract rejects a project manifest's `roles` item (tool and provider
 * registration is process-global, so it cannot be scoped to a session) and this package
 * reports that rejection — but the roster's own resolver used to expose the role anyway,
 * so the two surfaces disagreed about what is usable. This test drives BOTH surfaces on
 * ONE fixture and requires them to agree: nothing usable on either side, and the SAME
 * reason sentence on both.
 */
test("t16: the ext report and the ROSTER agree about a PROJECT-plane role (nothing usable, same reason)", async () => {
  // The workspace whose project plane declares a role, which the contract refuses.
  const workspace = makeDir("mpd-ext-ws-")
  writeExtension(projectExtensionsDir(workspace), "proj-roles", extensionManifest("proj-roles", {
    // A valid, readable role item — nothing about it is malformed; the PLANE is the only reason
    // it may not be contributed.
    roles: [{ name: "Project Reviewer", persona: "p.md" }],
  }), { personas: { "p.md": "project-plane reviewer" } })

  // The fake ctx, the tools it registered and the service the roster resolver reads.
  const { ctx, registered, provided } = makeCtx()
  apply(ctx, { quiet: true })
  // The exec object both surfaces resolve the project plane through.
  const exec = execFor(workspace)
  // This package's report for that project-plane role.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)

  // (1) This package's report: the item is rejected by the contract and NOTHING is exposed.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "proj-roles")
  expect(entry.plane).toBe("project")
  expect(entry.contributions.roles).toBe(0)
  expect(entry.roles).toEqual([])
  expect(entry.errors.some((error: any) =>
    error.item === "contributes.roles[0]" && error.reason === MPD_EXT_CONTRACT.projectRejectionReason)).toBe(true)

  // (2) The ROSTER's own resolver, on the same call: it exposes no role either…
  // Cast: this fake ctx deliberately stubs only `get` — the roster resolver reads nothing else here, and the
  // cast is the only way to hand a partial fake to a signature that demands the full ctx type.
  const rosterCtx = { get: (key: string) => (key === "mpdExtensions" ? provided.mpdExtensions : undefined) } as unknown as Parameters<typeof extensionRoles>[0]
  // The roster's own answer for the SAME call, which must expose no role either.
  const resolved = extensionRoles(rosterCtx, exec, () => {})
  expect(resolved.roles.map((role: any) => role.name)).not.toContain("Project Reviewer")
  expect(resolved.roles.filter((role: any) => role.extension === "proj-roles")).toEqual([])

  // …and it records WHY, with the contract's own sentence, so mpd_roles_list and
  // mpd_ext_list say the same thing instead of one of them silently listing the role.
  const refusal = resolved.refused.find((line: any) => line.extension === "proj-roles")
  expect(refusal?.name).toBe("Project Reviewer")
  expect(refusal?.reason).toBe(MPD_EXT_CONTRACT.projectRejectionReason)
})

// ── release findings F4/F5/F6/F7 (v0.9.1) ───────────────────────────────────
//
// Every test below reproduces a finding the v0.9.0 adversarial review recorded with
// `file:line`, and each one FAILS against the pre-fix code (the fix's RED is stated
// in the comment so a future reader can re-measure instead of trusting this file).

/** The marker each cross-extension skill-surface note carries, so a reader can tell it from an ordinary load error. */
const SKILL_SURFACE_PREFIX = "skill surface: "

/** The skill-surface notes one reported entry carries, with the marker stripped. */
function skillSurfaceNotes(entry: any): string[] {
  return entry.errors
    .map((error: any) => String(error.reason))
    // Annotated because `entry` is `any`, so no contextual type reaches this callback.
    .filter((reason: string) => reason.startsWith(SKILL_SURFACE_PREFIX))
    // Same reason as the filter above: the receiver is `any`, so the parameter needs its type written down.
    .map((reason: string) => reason.slice(SKILL_SURFACE_PREFIX.length))
}

test("F4: a same-name skill claimed by two extensions is reported on the loser WITH the winner and both ranks", async () => {
  // No `onSkip` and no cross-extension skill annotation pre-fix: `mpd_ext_list` listed
  // BOTH extensions as contributing `style-check` while the harness serves exactly one.
  writeExtension(userExtensionsRoot(), "alpha-owner", extensionManifest("alpha-owner", { skills: [{ root: "skills", rank: 100 }] }), { skills: { "style-check": GOOD_SKILL } })
  writeExtension(userExtensionsRoot(), "zeta-clone", extensionManifest("zeta-clone", { skills: [{ root: "skills", rank: 600 }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The report both claiming extensions are read from.
  const listed = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))
  // The lower-ranked claimant, which the harness serves.
  const owner = listed.extensions.find((candidate: any) => candidate.id === "alpha-owner")
  // The higher-ranked claimant, which must name the winner and both ranks.
  const clone = listed.extensions.find((candidate: any) => candidate.id === "zeta-clone")

  // The winner carries no note…
  expect(skillSurfaceNotes(owner)).toEqual([])
  // …the loser names the winner AND the ranks that decided it.
  expect(skillSurfaceNotes(clone)).toEqual([
    '"style-check" (rank 600) is also claimed by extension "alpha-owner" (rank 100), which the harness serves instead — the lowest rank wins and the other candidate is dropped with a warning',
  ])
  // The same fact from the catalog side: one entry really serves the name.
  expect(owner.skillServing.checked).toBe(true)
  expect(owner.skillServing.served).toEqual(["style-check"])
  expect(clone.skillServing.served).toEqual([])
  expect(clone.skillServing.notServed).toEqual(["style-check"])
  // The note is re-derived per call, so a second report neither duplicates nor loses it.
  const again = await callTool(registered, "mpd_ext_show", { id: "zeta-clone" }, makeDir("mpd-ext-ws-"))
  expect(skillSurfaceNotes(again)).toEqual(skillSurfaceNotes(clone))
})

test("F4: a claim the catalog resolves to a NON-extension provider is reported as not served", async () => {
  // The registry can only see extension-vs-extension collisions. A name lost to the
  // skill corpus (or a user skills root) is decided inside ctx.skills, so the tool asks
  // the catalog — without that, this entry's claim was indistinguishable from reality.
  writeExtension(userExtensionsRoot(), "shadowed", extensionManifest("shadowed", { skills: [{ root: "skills", rank: 500 }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the tool capture; the corpus provider is registered BEFORE apply.
  const { ctx, registered } = makeCtx()
  ctx.skills.registerProvider(() => ({
    name: "corpus",
    list: () => [{
      name: "style-check",
      description: "the corpus copy",
      invocation: { modelInvocable: true, userInvocable: true },
      source: "corpus",
      provider: "corpus",
      rank: 100,
      locator: {},
    }],
  }))
  apply(ctx, { quiet: true })
  // The report, whose serving check must consult the catalog the corpus provider joined.
  const listed = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))
  // The fixture's entry, selected by id.
  const entry = listed.extensions.find((candidate: any) => candidate.id === "shadowed")

  expect(entry.skillServing.checked).toBe(true)
  expect(entry.skillServing.served).toEqual([])
  expect(entry.skillServing.notServed).toEqual(["style-check"])
  expect(entry.skillServing.detail[0].provider).toBe("corpus")
  expect(entry.skillServing.detail[0].note).toContain('served by provider "corpus"')
  // …and this collision is exactly the one the registry CANNOT see, which is why the
  // catalog check exists: no `skill surface:` note here.
  expect(skillSurfaceNotes(entry)).toEqual([])
  // The rendered text a model reads must not silently claim the skill either.
  const rendered = toolOf(registered, "mpd_ext_list").output.render({}, listed)[0].text
  expect(rendered).toContain("not served: style-check")
})

test("F4: a duplicate project-plane skill name is attributed to the PROJECT entry that claims it", async () => {
  // The project provider had no `onSkip` at all, so a candidate it dropped was a
  // `console.warn` nobody could see and `mpd_ext_list` still claimed both entries.
  const workspace = makeDir("mpd-ext-ws-")
  // The project-plane root both extensions are written into.
  const dir = projectExtensionsDir(workspace)
  writeExtension(dir, "proj-a", extensionManifest("proj-a", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  writeExtension(dir, "proj-b", extensionManifest("proj-b", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The report for a duplicate skill name inside ONE provider.
  const listed = await callTool(registered, "mpd_ext_list", {}, workspace)
  // The first claimant, which the catalog must name as the one really serving the skill.
  const a = listed.extensions.find((candidate: any) => candidate.id === "proj-a")
  // The second claimant, which must carry the same duplicate note.
  const b = listed.extensions.find((candidate: any) => candidate.id === "proj-b")

  // The exact note the provider reports; BOTH entries are required to carry it.
  const note = 'duplicate name "style-check" inside provider "mpd-ext:project-plane"'
  expect(a.errors.some((error: any) => error.reason === note)).toBe(true)
  expect(b.errors.some((error: any) => error.reason === note)).toBe(true)
  // The catalog says which one really serves it, which is the fact that matters.
  const served = [a, b].filter((entry: any) => entry.skillServing.served.includes("style-check"))
  expect(served.map((entry: any) => entry.id)).toEqual(["proj-a"])
})

test("F5: a provider call with NO cwd serves nothing from the project plane (never process.cwd())", async () => {
  // Pre-fix the fallback was `dsh.workspaceRoot()` -> DSH_WORKSPACE_ROOT -> process.cwd(),
  // so a caller that named no workspace was served another project's extensions.
  const workspace = makeDir("mpd-ext-cwd-")
  writeExtension(projectExtensionsDir(workspace), "only-project", extensionManifest("only-project", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the provider factories it collected.
  const { ctx, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The shared project-plane provider every tool call resolves against.
  const provider = providerNamed(providers, "mpd-ext:project-plane")
  // The env value this case overrides, kept so the finally block can restore it.
  const saved = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = workspace
  try {
    expect(await provider.list({})).toEqual({ candidates: [], complete: true })
    expect(await provider.list(undefined)).toEqual({ candidates: [], complete: true })
    expect(await provider.list({ cwd: "" })).toEqual({ candidates: [], complete: true })
    // The caller's OWN workspace still resolves — the fix removes a guess, not the plane.
    expect((await observedNames(provider, { cwd: workspace })).names).toEqual(["style-check"])
  } finally {
    if (saved === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = saved
  }
})

test("F5: a host-wide extension is still served when the caller names no workspace", async () => {
  // The shadow guard needs a workspace; with none it must FAIL TOWARDS SERVING the
  // host-wide extension, never towards hiding it (the opposite error is worse).
  writeExtension(userExtensionsRoot(), "host-wide", extensionManifest("host-wide", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the provider factories it collected.
  const { ctx, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The USER-plane provider, whose shadow guard must fail towards SERVING it.
  const provider = providerNamed(providers, "mpd-ext:host-wide")
  expect((await observedNames(provider, {})).names).toEqual(["style-check"])
  // With a workspace that has NO same-id project extension it is served there too.
  expect((await observedNames(provider, { cwd: makeDir("mpd-ext-ws-") })).names).toEqual(["style-check"])
})

test("F6: mpd_ext_show redacts author-declared env VALUES in the echoed descriptor", async () => {
  // The descriptor echo reached the session log and the model's context verbatim, and
  // `contributes.mcp[].env` is exactly where an author's API key goes.
  writeExtension(userExtensionsRoot(), "with-env", extensionManifest("with-env", {
    mcp: [{ serverName: "envserver", transport: "stdio", command: "node", args: ["-e", "process.exit(1)"], env: { API_KEY: "sk-super-secret-value", PLAIN: "visible-value" } }],
  }, { enabled: false }))
  // The fake ctx and the tool capture.
  const { ctx, registered } = makeCtx()
  apply(ctx, { quiet: true })
  // The single-extension view, which echoes the descriptor back into the model's context.
  const shown = await callTool(registered, "mpd_ext_show", { id: "with-env" }, makeDir("mpd-ext-ws-"))
  expect(JSON.stringify(shown)).not.toContain("sk-super-secret-value")
  expect(JSON.stringify(shown)).not.toContain("visible-value")
  // The echoed MCP item; its KEYS stay visible, its env VALUES must be masked.
  const server = shown.descriptor.contributes.mcp[0]
  // The KEYS are the interface and stay visible; only the values are masked.
  expect(Object.keys(server.env).sort()).toEqual(["API_KEY", "PLAIN"])
  expect(server.env.API_KEY).toBe("<redacted>")
  expect(server.env.PLAIN).toBe("<redacted>")
  // An extension without an env block is echoed untouched.
  const descriptor = shown.descriptor as any
  expect(descriptor.id).toBe("with-env")
})

test("F7: a CONFIG-disabled extension claims no role name, so the next claimant is exposed", async () => {
  // Pre-fix the claim map only knew the DESCRIPTOR `enabled` flag, so a config-disabled
  // extension was still treated as claiming "Shared Role" and the later extension was
  // reported refused while the roster would have exposed it.
  writeExtension(userExtensionsRoot(), "alpha-off", extensionManifest("alpha-off", { roles: [{ name: "Shared Role", persona: "p.md" }] }), { personas: { "p.md": "off" } })
  writeExtension(userExtensionsRoot(), "beta-on", extensionManifest("beta-on", { roles: [{ name: "Shared Role", persona: "p.md" }] }), { personas: { "p.md": "on" } })
  // The config that disables the FIRST claimant, so its role name must be free again.
  const state: any = { "extensions.disable": ["alpha-off"], "extensions.enable": [] }
  // A fake mpdConfig over that state.
  const config = { get: (key: string) => state[key], reload: () => {}, states: () => ({ files: [], errors: [] }) }
  // The fake ctx wired to it, plus the tool and service captures.
  const { ctx, registered, provided } = makeCtx(config)
  apply(ctx, { quiet: true })
  // The report both claimants are read from.
  const listed = await callTool(registered, "mpd_ext_list", {}, makeDir("mpd-ext-ws-"))
  // The config-disabled extension, which must claim no role name.
  const off = listed.extensions.find((candidate: any) => candidate.id === "alpha-off")
  // The later claimant, which must therefore be exposed.
  const on = listed.extensions.find((candidate: any) => candidate.id === "beta-on")

  expect(off.enabled).toBe(false)
  expect(refusalNotes(on)).toEqual([])
  expect(on.contributions.roles).toBe(1)
  expect(on.roles).toEqual(["Shared Role"])
  expect(off.contributions.roles).toBe(0)
  // The disabled side's pending roles item, which must state the config reason.
  const pending = off.pending.find((item: any) => item.item === "contributes.roles")
  expect(pending.reason).toContain("disabled by config")
  expect(pending.reason).toContain("Shared Role".slice(0, 0) + "none of its 1 declared role(s) is resolved")

  // The ROSTER agrees: it exposes the name from the live extension only.
  // Cast: this fake ctx deliberately stubs only `get` — the roster resolver reads nothing else here, and the
  // cast is the only way to hand a partial fake to a signature that demands the full ctx type.
  const rosterCtx = { get: (key: string) => (key === "mpdExtensions" ? provided.mpdExtensions : undefined) } as unknown as Parameters<typeof extensionRoles>[0]
  // The roster's own answer for a FRESH workspace, where only the live extension can hold the name.
  const resolved = extensionRoles(rosterCtx, execFor(makeDir("mpd-ext-ws-")), () => {})
  // The one role carrying the contested name, filtered out of the roster's list.
  const shared = resolved.roles.filter((role: any) => role.name === "Shared Role")
  expect(shared.map((role: any) => role.extension)).toEqual(["beta-on"])
})

test("F3: an enumeration failure is reported as an INCOMPLETE observation, never a cacheable empty catalog", async () => {
  // The harness reads an ARRAY as `{candidates:[], complete:true}` and CACHES it per
  // (cwd, scope, revision) — so one transient failure used to hide a provider's skills
  // for the rest of the session (H/dsh-skill/lib/index.js:414-426 + collect()).
  // Pinned HERE, at the provider contract, because the two index-level providers cannot
  // fail their enumeration any more (see the F5 test below): the shape is what protects
  // any future enumerator, and it is the shape the harness reads.
  const provider = createSkillProvider({
    name: "mpd-ext:transient",
    warn: () => {},
    entries: () => { throw new Error("ENOENT: the skills root vanished mid-scan") },
  })
  expect(observed(await provider.list({ cwd: "/somewhere" }))).toEqual({ candidates: [], complete: false })
  // A per-candidate DATA problem is permanent until the files change, so that
  // observation stays complete: only a failed enumeration is transient.
  const dataProblem = createSkillProvider({
    name: "mpd-ext:data",
    warn: () => {},
    entries: () => [{ document: { name: "broken", description: "", invocation: { modelInvocable: true, userInvocable: true }, content: "x" }, locator: {}, source: "t", rank: 300 }],
  })
  expect(observed(await dataProblem.list({}))).toEqual({ candidates: [], complete: true })
})

test("F5: with no cwd a host-wide extension is SERVED, not silently shadowed by a guessed workspace", async () => {
  // The apply-time provider's project-shadow guard needs the CALLER's workspace.
  // Pre-fix it fell back to `dsh.workspaceRoot()` (DSH_WORKSPACE_ROOT, then
  // process.cwd()), so with the env pointing at a workspace that HAS a same-id
  // project extension the guard fired and the host-wide extension emitted NOTHING —
  // a host-wide capability hidden by a workspace the caller never named.
  const workspace = makeDir("mpd-ext-shadow-")
  writeExtension(projectExtensionsDir(workspace), "shared", extensionManifest("shared", { skills: [{ root: "skills" }] }), { skills: { "lint-mcp": SECOND_SKILL } })
  writeExtension(userExtensionsRoot(), "shared", extensionManifest("shared", { skills: [{ root: "skills" }] }), { skills: { "style-check": GOOD_SKILL } })
  // The fake ctx and the provider factories it collected.
  const { ctx, providers } = makeCtx()
  apply(ctx, { quiet: true })
  // The USER-plane provider for the shadowed id.
  const provider = providerNamed(providers, "mpd-ext:shared")
  // The env value this case overrides, kept so the finally block can restore it.
  const savedWorkspace = process.env.DSH_WORKSPACE_ROOT
  process.env.DSH_WORKSPACE_ROOT = workspace
  try {
    // No cwd: the guard cannot be evaluated, so it is SKIPPED — serving host-wide
    // content is the safe direction; hiding it is not.
    expect((await observedNames(provider, {})).names).toEqual(["style-check"])
    // With the caller's own workspace the guard DOES run and the project plane wins.
    expect(await provider.list({ cwd: workspace })).toEqual({ candidates: [], complete: true })
    // …and a workspace without that project extension serves it again.
    expect((await observedNames(provider, { cwd: makeDir("mpd-ext-other-") })).names).toEqual(["style-check"])
  } finally {
    if (savedWorkspace === undefined) delete process.env.DSH_WORKSPACE_ROOT
    else process.env.DSH_WORKSPACE_ROOT = savedWorkspace
  }
})
