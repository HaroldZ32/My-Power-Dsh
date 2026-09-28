#!/usr/bin/env node
// Case extension-template: the SHIPPED authoring template, mounted and used, on a
// REAL boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. the template itself — `templates/mpd-extension/` (7 files, all four kinds) —
//      copied by the developer CLI (`bun scripts/mpd-ext.ts scaffold <name> --dir
//      <host plane> --with-mcp`) into a SANDBOX host plane, never into the checkout.
//      The template ships `enabled: false` on purpose (it must never be discovered
//      from the repo), so this case flips ONLY the sandbox copy's flag and records
//      that step; the repo template is never touched.
//   2. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd). The model step is answered by the
//      shared local OpenAI-shaped stub (extension-isolation.ts), so the tool calls
//      are really executed by the session and need no provider credential.
//   3. every claim is read from the HARNESS's own session log
//      (`lib/session-evidence.ts`: `tool/call` + non-error `tool/result`) — never
//      from the model's prose. The one exception is the offered-tool list, which is
//      read from the stub's own request trace AND the session log's tool list.
//
// FOUR KINDS, ONE COPY (the template's whole promise)
//   skill  — `skill` answers with the copy's own SKILL.md (the rewritten heading)
//   flow   — `mpd_flow_show <id>` answers with the copy's flow, whose step names the
//            copy's own skill (so the id rewrite is proven, not assumed)
//   role   — `mpd_role_persona` answers with the copy's persona AND `mpd_role_spawn`
//            really starts a child (the stub answers it)
//   mcp    — the copy's own stdio server publishes `mcp__<name>__describe_extension`,
//            which is called with a NON-ERROR result carrying the copy's manifest
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
// PREREQ: absent-fixture templates/mpd-extension/mpd-ext.json "restore the shipped authoring template (templates/mpd-extension/)"
//
// --self-test is offline (temp dirs + the CLI only): the template loads with all
// four kinds, the scaffold emits the four-kind copy this case boots, the derived
// names this case asserts still match the CLI's own rewrite, and the case-table
// row for this lane exists. Evidence ->
// evidence/extensions/extension-template/<ts>/{result.json,output.log}.
import { spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  REPO, binaryPresent, bootSession, callsOf, crashSignatures, createSandbox, cleanup, gatePrereqs, installProfile,
  isolationStep, keepRawSession, makeStubModel, sessionEvidence, timestamp, toolResultsByCallId, useStubRoute,
  writeEvidence,
} from "./extension-isolation.ts"
import type { ExtensionSandbox } from "./extension-isolation.ts"

/** The case slug: names the evidence directory and the self-test's log prefix. */
export const SLUG: string = "extension-template"

/**
 * The shipped template directory (`templates/mpd-extension`) — also where the placeholder id is read
 * from, never hard-coded twice.
 */
const TEMPLATE_DIR = join(REPO, "templates", "mpd-extension")
/** The developer CLI, a repo source and therefore a `.ts` specifier. */
const CLI = join(REPO, "scripts", "mpd-ext.ts")

/** The name this case scaffolds into the sandbox host plane. */
const EXT_NAME = "qa-template"
/** The scaffolded copy's id, which the CLI rewrites from the template's placeholder. */
const EXT_ID = EXT_NAME
/** The copy's skill name, asserted from the `skill` tool's own result. */
const SKILL_NAME = EXT_NAME + "-skill"
/** The copy's flow id, asserted from the `mpd_flow_show` result. */
const FLOW_ID = EXT_NAME + "-flow"
/** The copy's role name, asserted from the persona and spawn results. */
const ROLE_NAME = EXT_NAME + " reviewer"
/** The copy's MCP server name, the `<name>` segment of its public tool name. */
const MCP_SERVER = EXT_NAME
/** `mcp__<serverName>__<rawName>`; the harness hash branch does not fire on this name. */
const MCP_TOOL = "mcp__" + MCP_SERVER + "__describe_extension"
/** The marker the spawned role child must answer with, proving the child turn really ran. */
const CHILD_MARKER = "QA-TEMPLATE-CHILD"
/** The copy's persona path, relative to the extension root. */
const PERSONA_FILE = "personas/" + EXT_NAME + "-reviewer.md"

/** The `contributes.mcp` entry of an extension descriptor, as much of it as this case reads. */
interface McpContribution {
  /** The MCP server name the bridge publishes that server's tools under. */
  serverName?: string
}

/** The `contributes.roles` entry of an extension descriptor, as much of it as this case reads. */
interface RoleContribution {
  /** The role name `mpd_role_persona` / `mpd_role_spawn` address. */
  name?: string
  /** The role's persona file, relative to the extension root. */
  persona?: string
}

/** The contribution blocks of an extension descriptor; only the keys this case asserts on are named. */
interface ExtensionContributes {
  /** The MCP servers the extension contributes (allowed in the user plane only). */
  mcp?: McpContribution[]
  /** The roles the extension contributes (allowed in the user plane only). */
  roles?: RoleContribution[]
}

/** A parsed extension descriptor: the fields this case rewrites and asserts on. */
interface ExtensionDescriptor {
  /** The descriptor's declared id, which the CLI rewrites to the scaffolded name. */
  id?: string
  /** Whether the extension is discoverable; the shipped template sets this to `false` on purpose. */
  enabled?: boolean
  /** The descriptor's contribution blocks; the CLI validates the document before any arm reads it. */
  contributes: ExtensionContributes
}

/** The scaffold's failure: the CLI did not emit a manifest at the expected root. */
interface ScaffoldFailure {
  /** Discriminant: the copy is not usable. */
  ok: false
  /** The CLI's own child-process result, kept for its stderr. */
  run: SpawnSyncReturns<string>
  /** The root the copy would have been written to. */
  root: string
  /** Always false: the flag is only flipped once a manifest exists. */
  enabled: false
  /** No descriptor was parsed on this path. */
  manifest?: ExtensionDescriptor
}

/** The scaffold's success: the copy exists and its `enabled` flag was flipped. */
interface ScaffoldSuccess {
  /** Discriminant: the copy is usable. */
  ok: true
  /** The CLI's own child-process result. */
  run: SpawnSyncReturns<string>
  /** The copy's root directory under the host plane. */
  root: string
  /** True: this case flips ONLY the sandbox copy's flag, never the repo template's. */
  enabled: true
  /** The copy's parsed descriptor, with `enabled` now true. */
  manifest: ExtensionDescriptor
}

/** Either the scaffold produced a usable copy, or it failed with the CLI's own output. */
type ScaffoldResult = ScaffoldFailure | ScaffoldSuccess

/** The CLI spawn options a caller may override; the command, encoding and timeout are fixed. */
interface CliRunOptions {
  /** Overrides the working directory the CLI runs in. */
  cwd?: string
  /** Overrides how long the CLI may run, in milliseconds. */
  timeout?: number
}

/** What the template arm receives: the sandbox, the evidence dir and the run's log sink. */
interface ArmContext {
  /** The temp sandbox the copy is scaffolded into and the session is booted from. */
  box: ExtensionSandbox
  /** The evidence directory this run writes its raw session copy into. */
  outDir: string
  /** The shared log lines the arm appends its truncated boot output to. */
  logs: string[]
}

/**
 * One arm's recorded verdict. Every arm sets `ok` — `runReal` ANDs exactly that across the arms — and
 * adds its own evidence fields, which land verbatim in `result.json`.
 */
interface ArmStep {
  /** Whether the arm passed; `runReal` ANDs these into the case verdict. */
  ok: boolean
  /** Any further arm-specific evidence field the arm records for the audit trail. */
  [key: string]: unknown
}

/**
 * One entry of the arm bag: an arm's own verdict record, or the sandbox-isolation verdict stored in it
 * verbatim. The union is needed because that verdict is a closed interface the SHARED helper owns, and
 * an interface with no index signature cannot join the open record above — both members carry `ok`.
 */
type ArmStepValue = ArmStep | ReturnType<typeof isolationStep>

/**
 * The shared helper's failure sink, mirrored locally: `extension-isolation.ts` keeps `fail` private to
 * itself, so this module's three T-56 guards would otherwise name an undeclared identifier. Reporting
 * the same `[extension-isolation] FAIL:` line keeps those guards' output identical to the helper's.
 * @param message The failure text to report.
 * @returns Never: the process exits non-zero.
 */
function fail(message: string): never {
  console.error("[extension-isolation] FAIL: " + message)
  process.exit(1)
}

/**
 * The shipped template's descriptor.
 * @returns The template's parsed `mpd-ext.json`.
 */
function templateManifest(): ExtensionDescriptor {
  // `JSON.parse` is typed `any` by the TS lib; the descriptor interface above states the shape this case
  // reads, and the CLI validates the very same document before any arm uses it.
  return JSON.parse(readFileSync(join(TEMPLATE_DIR, "mpd-ext.json"), "utf8"))
}

/**
 * The template's placeholder id (its own manifest `id`), the CLI's rewrite token.
 * @returns The template's own id, or `""` when its manifest declares none.
 */
function templateToken(): string {
  return String(templateManifest().id ?? "")
}

/** The product's own public-tool-name formula, cached after the first successful load (T-56). */
let productPublicToolName: ((serverName: string, rawName: string) => string) | null = null

/**
 * T-56: the public tool-name formula lives in the PRODUCT
 * (`packages/mpd-ext-plugin/src/mcp-client.ts#publicToolName`) — this case must never keep its own
 * copy of it (the copy it used to carry had a placeholder hash branch, so it could only ever agree
 * with the product on a lossless name). Loaded LAZILY on purpose: a module-level import of a `.ts`
 * module would crash before the case's prerequisite gate could skip, and the import needs a runtime
 * with TypeScript type stripping (node >= 22.6 / bun).
 * @returns The product's `publicToolName` function, imported from its own source module.
 */
async function loadPublicToolName(): Promise<(serverName: string, rawName: string) => string> {
  if (productPublicToolName) return productPublicToolName
  /** The product module that owns the formula. */
  const source = join(REPO, "packages", "mpd-ext-plugin", "src", "mcp-client.ts")
  if (!existsSync(source)) fail("T-56: the product's mcp-client.ts is missing: " + source)
  /** The imported product module; only its exported formula is read. */
  let module: { publicToolName?: (serverName: string, rawName: string) => string }
  try {
    // A dynamic `import()` of a computed specifier is typed `any` by the language, so the cast
    // re-attaches the one export this case reads; narrowing is impossible on a runtime-only shape.
    module = (await import(pathToFileURL(source).href)) as { publicToolName?: (serverName: string, rawName: string) => string }
  } catch (error) {
    // `catch` binds `unknown` under `strict`: only a value that really carries a `message` contributes
    // one, and anything else falls back to its string form — the choice the original expression made.
    /** The import failure text, which the T-56 guard reports. */
    const detail = typeof error === "object" && error !== null && "message" in error && error.message
      ? String(error.message)
      : String(error)
    fail("T-56: cannot import the product's publicToolName from " + source + " (a runtime with TypeScript type stripping is required): " + detail)
  }
  if (typeof module.publicToolName !== "function") fail("T-56: " + source + " no longer exports publicToolName")
  productPublicToolName = module.publicToolName
  return productPublicToolName
}

/**
 * Run the developer CLI (bun: it imports the TypeScript sources directly).
 * @param args The CLI arguments, after the script path.
 * @param options Spawn overrides; the command, encoding and timeout are fixed.
 * @returns The CLI's child-process result, with its streams decoded as UTF-8 text.
 */
function runCli(args: string[], options: CliRunOptions = {}): SpawnSyncReturns<string> {
  return spawnSync("bun", [CLI, ...args], { encoding: "utf8", timeout: 300000, cwd: REPO, ...options })
}

/**
 * Scaffold a named copy of the shipped template into `parentDir` and return the
 * facts this case asserts on. The ONLY write to the copy is the `enabled` flip
 * (the shipped template is disabled by design); everything else is the CLI's own
 * output, which the self-test compares against this case's expectations.
 * @param parentDir The plane directory the copy is scaffolded into.
 * @returns The CLI verdict, the copy's root and (on success) its parsed, enabled descriptor.
 */
function scaffoldCopy(parentDir: string): ScaffoldResult {
  /** The CLI's scaffold result for this copy. */
  const run = runCli(["scaffold", EXT_NAME, "--dir", parentDir, "--with-mcp"])
  /** The copy's root directory, named after the scaffolded extension. */
  const root = join(parentDir, EXT_NAME)
  /** The copy's manifest, whose presence is the scaffold's success signal. */
  const manifestPath = join(root, "mpd-ext.json")
  if (run.status !== 0 || !existsSync(manifestPath)) return { ok: false, run, root, enabled: false }
  /** The copy's parsed descriptor, about to have its one recorded field flipped. */
  const manifest: ExtensionDescriptor = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest.enabled = true
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  return { ok: true, run, root, enabled: true, manifest }
}

/**
 * A recursive file listing (relative paths, sorted) — the copy's shape, recorded.
 * @param root The directory to list; an absent root lists as empty.
 * @returns POSIX-spelled relpaths of every regular file under `root`, sorted per directory.
 */
function treeOf(root: string): string[] {
  /** The accumulated POSIX-spelled relpaths, in walk order. */
  const out: string[] = []
  /** Depth-first walk: directories recurse, regular files are recorded. */
  const walk = (dir: string): void => {
    // Sorted per directory, so the recorded listing is stable across runs.
    for (const entry of readdirSync(dir).sort()) {
      /** The entry's joined path, classified by `statSync` below. */
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      // POSIX-spelled relpaths: the expected assets below are written with "/" (the manifest's own
      // vocabulary), so a native separator would make every entry fail to match on Windows.
      else out.push(path.slice(root.length + 1).split(sep).join("/"))
    }
  }
  if (existsSync(root)) walk(root)
  return out
}

/**
 * The offline self-test: the shipped template and its disabled flag, the scaffolded four-kind copy and
 * every derived name the live arm asserts, the product's own tool-name formula, and the case-table row.
 * @returns A promise that settles after the run has exited non-zero on any failed assertion.
 */
async function selfTest(): Promise<void> {
  /** Every failed assertion, printed together so one run reports the whole picture. */
  const problems: string[] = []
  /** Records one failed assertion; the collected list decides the final exit code. */
  const check = (condition: boolean, message: string): void => { if (!condition) problems.push(message) }

  // 1) the shipped template exists, loads, and carries all four kinds.
  check(existsSync(join(TEMPLATE_DIR, "mpd-ext.json")), "the shipped template (templates/mpd-extension/mpd-ext.json) is missing")
  check(existsSync(CLI), "the developer CLI (scripts/mpd-ext.ts) is missing — the scaffold step cannot run")
  /** The CLI's verdict on the shipped template, which it must accept. */
  const templateValidation = runCli(["validate", TEMPLATE_DIR])
  check(templateValidation.status === 0, "the CLI must accept the shipped template (exit " + templateValidation.status + "): " + String(templateValidation.stderr ?? "").slice(0, 200))
  check(String(templateValidation.stdout ?? "").includes("1 skill(s), 1 flow(s), 1 role(s), 1 mcp server(s)"), "the template must declare all four contribution kinds")

  // 2) the template ships DISABLED: this case's enable step is therefore a real,
  //    recorded mutation of the SANDBOX copy, not a no-op.
  check(templateManifest().enabled === false, "the template must ship enabled:false (it must never be discovered straight from the repo)")

  // 3) the CLI emits the four-kind copy THIS case boots, and its derived names are
  //    the ones this case asserts (a CLI rename would otherwise make every live
  //    assertion below fail for the wrong reason).
  /** The temp dir the scaffold is driven into; removed in the `finally` below. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-template-selftest-"))
  try {
    /** The scaffolded copy's outcome inside the temp dir. */
    const scaffolded = scaffoldCopy(sandbox)
    check(scaffolded.ok, "scaffold --with-mcp failed in the self-test: " + String(scaffolded.run?.stderr ?? "").slice(0, 200))
    if (scaffolded.ok) {
      /** The CLI's verdict on its own four-kind copy. */
      const copyValidation = runCli(["validate", scaffolded.root])
      check(copyValidation.status === 0, "the CLI must accept its own four-kind copy (exit " + copyValidation.status + ")")
      check(scaffolded.manifest.id === EXT_ID, "the copy's id must be " + EXT_ID + " (got " + String(scaffolded.manifest.id) + ")")
      check(String(scaffolded.manifest.contributes.mcp?.[0]?.serverName) === MCP_SERVER, "the copy's mcp serverName must be rewritten to " + MCP_SERVER)
      check(String(scaffolded.manifest.contributes.roles?.[0]?.name) === ROLE_NAME, "the copy's role name must be " + ROLE_NAME + " (got " + String(scaffolded.manifest.contributes.roles?.[0]?.name) + ")")
      check(String(scaffolded.manifest.contributes.roles?.[0]?.persona) === PERSONA_FILE, "the copy's persona path must be " + PERSONA_FILE)
      /** The copy's file listing, which must carry every expected asset. */
      const tree = treeOf(scaffolded.root)
      // Each expected asset must be present, pair by pair with what it proves.
      for (const [asset, what] of [
        ["mpd-ext.json", "the manifest"],
        ["skills/" + SKILL_NAME + "/SKILL.md", "the skill asset"],
        ["flows/" + FLOW_ID + ".json", "the flow asset"],
        [PERSONA_FILE, "the role persona"],
        ["server.ts", "the stdio server"],
      ]) {
        check(tree.includes(asset), "the copy is missing " + what + " (" + asset + "); have: " + tree.join(", "))
      }
      // The skill heading and the flow's own cross-reference are the two markers the
      // LIVE arm reads out of tool results, so they are pinned here.
      /** The copy's SKILL.md text, whose heading the live arm reads back. */
      const skillMd = readFileSync(join(scaffolded.root, "skills", SKILL_NAME, "SKILL.md"), "utf8")
      check(skillMd.includes("# " + SKILL_NAME), "the copy's SKILL.md must carry the heading # " + SKILL_NAME)
      check(skillMd.includes("The " + EXT_NAME + " extension's first skill"), "the copy's SKILL.md description must carry the rewritten name")
      /** The copy's flow document, whose id and skill cross-reference are pinned here. */
      const flow: { id?: string } = JSON.parse(readFileSync(join(scaffolded.root, "flows", FLOW_ID + ".json"), "utf8"))
      check(flow.id === FLOW_ID, "the copy's flow id must be " + FLOW_ID)
      check(JSON.stringify(flow).includes(SKILL_NAME), "the copy's flow must reference " + SKILL_NAME + " (the id rewrite inside the document)")
      /** The copy's persona text, which must name the copy's own role. */
      const persona = readFileSync(join(scaffolded.root, PERSONA_FILE), "utf8")
      // The template's prose wraps, so the sentence check is whitespace-normalized.
      /** The persona with every whitespace run collapsed, so a wrapped sentence still matches. */
      const personaFlat = persona.replace(/\s+/g, " ")
      check(persona.includes(ROLE_NAME), "the copy's persona must name " + ROLE_NAME)
      check(personaFlat.includes("read-only role contributed by the " + EXT_NAME + " extension"), "the copy's persona must carry the rewritten extension id")
      check(scaffolded.enabled === true, "the self-test copy must be enabled for the live arm")
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }

  // 4) the expected public MCP tool name is the PRODUCT's own formula output (T-56: imported from
  //    mcp-client.ts, never re-implemented here) — a name that needed the hash branch would make
  //    this case assert a name the bridge never publishes.
  /** The product's own formula, loaded from its source module. */
  const productFormula = await loadPublicToolName()
  /** The name the product's formula derives for this case's server and raw name. */
  const expectedToolName = productFormula(MCP_SERVER, "describe_extension")
  check(expectedToolName === MCP_TOOL, "the expected MCP tool name changed: " + expectedToolName)
  /** This file's own source, scanned so the case can never re-implement the product's formula. */
  const ownSource = readFileSync(join(REPO, "skills", "dsh-qa", "scripts", "extension-template.ts"), "utf8")
  // Built by concatenation so this check's own needle cannot appear in the file it scans.
  check(!ownSource.includes("function public" + "ToolName("), "T-56: the case must not re-implement the product's publicToolName")
  check(ownSource.includes('"src", "mcp-client.ts"'), "T-56: the case must load the formula from the product's mcp-client.ts")
  /** The template's stdio server source, which must still report its contributed kinds. */
  const serverSource = readFileSync(join(TEMPLATE_DIR, "server.ts"), "utf8")
  check(serverSource.includes("kinds: KINDS.filter("), "the template's server no longer reports its contributed kinds")
  // The `enabled` clause is matched by SHAPE so the claim survives a rename of the local holding
  // the parsed manifest: a needle pinned to one identifier would redden on a rename that changes
  // nothing about what the server reports, while the assertion still requires a boolean derived
  // from that manifest's own `enabled` field beside the server's own `root`.
  check(serverSource.includes("root: HERE") && /enabled:\s*\w+\.enabled === true/.test(serverSource), "the template's server no longer reports its own root/enabled flag")

  // 5) the case catalog is the index of record: this lane must be a row in
  //    SKILL.md and must be named there by its exact script path.
  /** The case catalog, which must name this lane and the shared helper by their script paths. */
  const skillDoc = readFileSync(join(REPO, "skills", "dsh-qa", "SKILL.md"), "utf8")
  check(/\|\s*extension-template\s*\|/.test(skillDoc), "SKILL.md has no case-table row for extension-template")
  check(skillDoc.includes("scripts/extension-template.ts"), "SKILL.md does not name scripts/extension-template.ts")
  check(skillDoc.includes("scripts/extension-isolation.ts"), "SKILL.md no longer names the shared extension helper")

  // 6) the boot really composes the row this case drives.
  /** The bundle patch as text: the mpd-ext row must be declared there. */
  const patch = readFileSync(join(REPO, "packages", "mpd-bundle", "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")

  if (problems.length > 0) {
    // Every collected failure is printed, so one run reports the whole picture.
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: shipped template loads with all four kinds + ships disabled + scaffold emits the four-kind copy this case boots (ids, flow cross-reference, persona and MCP name pinned) + SKILL.md row present")
}

/**
 * The real case: gate the prerequisites, scaffold the template into the sandbox host plane, then boot
 * ONE real session and assert all four kinds from the harness's own session log.
 * @returns A promise that settles after the process exits with the combined arm verdict.
 */
async function runReal(): Promise<void> {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
    { code: "absent-fixture", probe: "templates/mpd-extension/mpd-ext.json", remedy: "restore the shipped authoring template (templates/mpd-extension/)", present: () => existsSync(join(TEMPLATE_DIR, "mpd-ext.json")) },
  ] })
  /** The run's timestamp, which names its evidence directory. */
  const ts = timestamp()
  /** The evidence directory this run writes `result.json` and `output.log` into. */
  const outDir = join(REPO, "evidence", "extensions", SLUG, ts)
  mkdirSync(outDir, { recursive: true })
  /** The temp sandbox: DSH_HOME, sandbox HOME, session cwd and the decoy directory. */
  const box = createSandbox(SLUG)
  /** The shared log lines every arm appends its transcript to. */
  const logs: string[] = []
  /** Per-arm verdicts; the case verdict is the AND over all of them. */
  const steps: Record<string, ArmStepValue> = {}
  do {
    /** The sandbox profile install, which composes the rows from THIS checkout. */
    const inst = await installProfile({ sandbox: box.sandbox, dshHome: box.dshHome, env: box.env })
    steps.install = { ok: inst.status === 0, exit: inst.status, tail: inst.out.slice(-400) }
    logs.push("=== install ===\n" + inst.out.slice(-2000))
    if (!steps.install.ok) break

    // 1) scaffold the template copy into the SANDBOX host plane (user plane: the
    //    only plane allowed to contribute mcp/roles), then enable it.
    /** The sandbox HOME's user-plane extension root the copy is written into. */
    const hostPlane = join(box.runHome, ".mpd", "extensions")
    mkdirSync(hostPlane, { recursive: true })
    /** The scaffolded copy's outcome in the sandbox host plane. */
    const scaffolded = scaffoldCopy(hostPlane)
    /** The copy's file listing, or an empty list when the scaffold failed. */
    const tree = scaffolded.ok ? treeOf(scaffolded.root) : []
    steps.scaffold = {
      ok: scaffolded.ok && scaffolded.enabled === true && tree.length >= 7,
      exit: scaffolded.run?.status ?? -1,
      root: scaffolded.root,
      templateId: templateToken(),
      templateEnabledFlagInRepo: templateManifest().enabled,
      sandboxEnabledFlag: scaffolded.manifest?.enabled ?? null,
      copyFiles: tree,
      cliStdout: String(scaffolded.run?.stdout ?? "").trim().slice(0, 400),
      note: "the repo template is never modified: the copy is written into the sandbox HOME plane and only its `enabled` flag is flipped (the template ships enabled:false so it can never be discovered from the repo)",
    }
    logs.push("=== scaffold ===\n" + String(scaffolded.run?.stdout ?? "") + String(scaffolded.run?.stderr ?? ""))
    if (!steps.scaffold.ok) break

    // 2) ONE real boot exercising all four kinds of the copy.
    /** The ordered tool calls the stub drives the session through, then its closing text. */
    const script = [
      { tool: "mpd_ext_list", args: {} },
      { tool: "skill", args: { name: SKILL_NAME } },
      { tool: "mpd_flow_show", args: { id: FLOW_ID } },
      { tool: "mpd_role_persona", args: { role: ROLE_NAME } },
      { tool: "mpd_role_spawn", args: { role: ROLE_NAME, task: "Reply with exactly " + CHILD_MARKER } },
      { tool: MCP_TOOL, args: {} },
      { text: "extension-template-done" },
    ]
    /** The local OpenAI-shaped stub that answers every model step of this session. */
    const stub = makeStubModel({
      script,
      childMarker: CHILD_MARKER,
      childAnswer: CHILD_MARKER + "-OK",
      childScript: [{ tool: "structured_output", args: { role: ROLE_NAME, summary: CHILD_MARKER + "-OK", recommendation: "none", details: "extension-template QA", evidence: [SKILL_NAME] } }],
      label: "template",
    })
    /** The stub's listening port, patched into the sandbox home so the session routes to it. */
    const port = await stub.listen()
    useStubRoute(box.dshHome, port)
    /** The one real headless session, whose model steps the stub answers. */
    const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Use the scaffolded extension: list it, load its skill, show its flow, read its role persona, spawn that role once, then call its MCP tool.", stub })
    /** The tool names every assertion below is keyed on, in the order the script calls them. */
    const names = ["mpd_ext_list", "skill", "mpd_flow_show", "mpd_role_persona", "mpd_role_spawn", MCP_TOOL]
    /** The harness-recorded evidence of this session: store, offered names and per-name calls. */
    const evidence = sessionEvidence(box.dshHome, box.ws, names)
    await stub.close()
    keepRawSession(outDir, "template", evidence.store)
    logs.push("=== template arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))

    // Every assertion is bound to ITS OWN call result (a joined text would let one
    // call's output satisfy another call's claim).
    /** Every call result, keyed by harness call id. */
    const results = toolResultsByCallId(evidence.store)
    /** The text of one tool's FIRST recorded call result, or `""` when it never ran. */
    const textOf = (name: string): string => {
      /** The first recorded call of that tool, absent when the tool was never called. */
      const call = callsOf(evidence.store, name)[0]
      return call === undefined ? "" : (results.get(call.callId)?.text ?? "")
    }
    /** Every tool name any stub request offered, across the whole session. */
    const offered = new Set(stub.trace.flatMap((entry) => entry.offeredTools))
    /** Every tool name the recorded request headers listed. */
    const headerTools = new Set(evidence.names)
    /** Whether the MCP tool was offered by BOTH the stub's trace and the request header. */
    const mcpOffered = offered.has(MCP_TOOL) && headerTools.has(MCP_TOOL)
    /** The copy's MCP tool call as the harness recorded it. */
    const mcpCall = evidence.calls[MCP_TOOL]
    /** The copy's manifest, pretty-printed for the evidence head. */
    const manifestJson = JSON.stringify(scaffolded.manifest, null, 2)

    steps.skill = {
      ok: run.status === 0 && evidence.calls.skill?.succeeded === true && textOf("skill").includes("# " + SKILL_NAME),
      called: Boolean(evidence.calls.skill?.called),
      succeeded: Boolean(evidence.calls.skill?.succeeded),
      sawHeading: textOf("skill").includes("# " + SKILL_NAME),
      resultHead: textOf("skill").slice(0, 200),
    }
    steps.flow = {
      ok: run.status === 0 && evidence.calls.mpd_flow_show?.succeeded === true
        && textOf("mpd_flow_show").includes(FLOW_ID)
        && textOf("mpd_flow_show").includes(SKILL_NAME),
      called: Boolean(evidence.calls.mpd_flow_show?.called),
      succeeded: Boolean(evidence.calls.mpd_flow_show?.succeeded),
      sawFlowId: textOf("mpd_flow_show").includes(FLOW_ID),
      sawSkillCrossReference: textOf("mpd_flow_show").includes(SKILL_NAME),
      resultHead: textOf("mpd_flow_show").slice(0, 240),
    }
    steps.role = {
      ok: run.status === 0 && evidence.calls.mpd_role_persona?.succeeded === true
        && evidence.calls.mpd_role_spawn?.succeeded === true
        && textOf("mpd_role_persona").includes(ROLE_NAME)
        && textOf("mpd_role_persona").includes(EXT_NAME + " extension")
        && textOf("mpd_role_spawn").includes(CHILD_MARKER + "-OK"),
      personaCalled: Boolean(evidence.calls.mpd_role_persona?.called),
      personaSucceeded: Boolean(evidence.calls.mpd_role_persona?.succeeded),
      spawnCalled: Boolean(evidence.calls.mpd_role_spawn?.called),
      spawnSucceeded: Boolean(evidence.calls.mpd_role_spawn?.succeeded),
      sawRoleName: textOf("mpd_role_persona").includes(ROLE_NAME),
      childAnswered: textOf("mpd_role_spawn").includes(CHILD_MARKER + "-OK"),
      personaHead: textOf("mpd_role_persona").slice(0, 200),
    }
    steps.mcp = {
      // The copy's OWN stdio server (`server.ts`) reports what the RUNNING host
      // sees: its id, its own root on disk, its enabled flag and all four kinds.
      // The result is read from the session log's non-error `tool/result`.
      ok: run.status === 0 && mcpOffered && mcpCall?.succeeded === true
        && textOf(MCP_TOOL).includes('"id": "' + EXT_ID + '"')
        && textOf(MCP_TOOL).includes(scaffolded.root)
        && textOf(MCP_TOOL).includes('"enabled": true')
        && ["skills", "flows", "mcp", "roles"].every((kind) => textOf(MCP_TOOL).includes('"' + kind + '"')),
      tool: MCP_TOOL,
      offeredInRequest: offered.has(MCP_TOOL),
      offeredInHeader: headerTools.has(MCP_TOOL),
      called: Boolean(mcpCall?.called),
      succeeded: Boolean(mcpCall?.succeeded),
      servedManifest: textOf(MCP_TOOL).includes('"id": "' + EXT_ID + '"'),
      servedOwnRoot: textOf(MCP_TOOL).includes(scaffolded.root),
      servedFourKinds: ["skills", "flows", "mcp", "roles"].every((kind) => textOf(MCP_TOOL).includes('"' + kind + '"')),
      resultHead: textOf(MCP_TOOL).slice(0, 400),
      manifestHead: manifestJson.slice(0, 200),
    }
    steps.listed = {
      ok: run.status === 0 && evidence.calls.mpd_ext_list?.succeeded === true && textOf("mpd_ext_list").includes(EXT_ID),
      sawCopy: textOf("mpd_ext_list").includes(EXT_ID),
      resultHead: textOf("mpd_ext_list").slice(0, 300),
    }
    steps.containment = {
      ok: run.status === 0 && crashSignatures(run.out).length === 0,
      exit: run.status,
      durationMs: run.durationMs,
      crashSignatures: crashSignatures(run.out),
      offeredTemplateTools: [...offered].filter((name) => name.startsWith("mcp__" + MCP_SERVER + "__")),
      isolation: isolationStep(box.dshHome, box.sandbox, SLUG),
    }
  } while (false)
  steps.isolationFinal = isolationStep(box.dshHome, box.sandbox, SLUG)
  /** The case verdict: every arm (and the final isolation check) must have passed. */
  const ok = Object.values(steps).every((step) => step.ok === true)
  writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    subject: "templates/mpd-extension copied by `bun scripts/mpd-ext.ts scaffold " + EXT_NAME + " --with-mcp` into the sandbox host plane",
    arms: "scaffold (the copy, its file tree and the recorded enabled flip) | skill (the `skill` tool answers with the copy's SKILL.md) | flow (mpd_flow_show answers with the copy's flow, cross-referencing the copy's skill) | role (mpd_role_persona answers AND mpd_role_spawn really starts a child) | mcp (the copy's own stdio server publishes " + MCP_TOOL + " and answers a real call) | containment (no apply-crash signature, session + workspace isolation)",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await selfTest()
  else await runReal()
}
