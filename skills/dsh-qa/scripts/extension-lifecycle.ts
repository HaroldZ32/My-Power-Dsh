#!/usr/bin/env node
// Case extension-lifecycle: the MPD extension interface, end to end, on a REAL
// mounted boot in isolation.
//
// WHAT CARRIES THE PROOF
//   1. a REAL `dsh` process (mpd-headless rows composed from THIS checkout,
//      sandboxed DSH_HOME + HOME + session cwd). The model step is answered by a
//      local OpenAI-shaped stub (see extension-isolation.ts), so the tool calls
//      are really executed by the session and need no provider credential.
//   2. every claim is read from the HARNESS's own session log
//      (`lib/session-evidence.ts`: `tool/call` + non-error `tool/result`, and
//      `request/header.header.tools[]` for the offered tool list) — never from
//      the model's prose.
//   3. the data plane is exercised the way an author uses it: a directory with
//      `mpd-ext.json` dropped into `<sandbox-ws>/.mpd/extensions/`, discovered
//      PER CALL, plus a user-plane extension for the kinds the project plane is
//      forbidden to contribute (roles; `mcp`/`roles` there are rejected per item
//      by design — C14).
//
// ARMS
//   main            — the project extension is LISTED, its flow is discoverable
//                     and loadable, its skill is served through the catalog, and
//                     the user-plane extension's role answers mpd_role_persona
//                     AND really spawns (the stub answers the child).
//   failure         — one deliberately broken extension of each kind sits next to
//                     a healthy one: the boot stays green, the session still
//                     completes a turn (the malformed skill candidates must not
//                     break the pre-step), and every broken item is REPORTED
//                     per item. The extension CLI is used as an independent
//                     oracle over the same directories.
//   isolation       — two sessions on ONE host root, different cwds, plus a
//                     two-sided control (a decoy extension in the LAUNCHER cwd is
//                     visible to no session; the same decoy IS listed when a
//                     session's own cwd is that directory).
//   packed          — packs into a SCRATCH out-dir and asserts the packed tree is
//                     CLOSED: `PLUGIN_PKGS` carries `mpd-ext-plugin`
//                     (scripts/pack-mpd.ts:42), `cpAssets()` copies
//                     `<bundle>/extensions/` (scripts/pack-mpd.ts:93-98) and the
//                     packed patch carries the `mpd-ext` row. The arm's `ok` is
//                     the pure predicate `packedStateOk()` — FALSE when the row,
//                     the plugin or the discovery root is missing, so a green
//                     exit can never accompany a red packed state. Because the
//                     archived RED this lane once recorded was a property of that
//                     older tree (not of this case), the predicate is proven
//                     falsifiable on every run by a NEGATIVE CONTROL over fixture
//                     packed trees (closed vs. each asset removed), recorded in
//                     result.json and re-run in --self-test.
//                     T-85: the arm NEVER writes the canonical `dist/mpd-package`.
//                     The rule it implements is "the artifact has exactly ONE
//                     writer at a time". Route, in order of preference:
//                     (1) the packer's own sanctioned `--out <dir>` flag
//                     (`scripts/pack-mpd.ts`, whose own docstring says that flag
//                     exists FOR this lane change); (2) the t70 scratch-COPY
//                     fallback, used only when the packer source carries no `--out`
//                     (copy + exactly two rewritten path constants + a REFUSAL on
//                     a drifted packer). The route actually taken is recorded in
//                     result.json, and the canonical artifact's content STAMP is
//                     read before and after the arm and must be identical, so a
//                     lane run that moved the delivered artifact could not report
//                     green.
//
// PREREQ: absent-dsh-binary dsh "install DeepSeek Harness (dsh) on PATH"
// PREREQ: absent-runtime packages/mpd-ext-plugin/dist/index.js "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js"
//
// --self-test is offline: descriptor-contract fixtures (including the code-plane
// NaN rank that JSON cannot express), the CLI negative control, the stub
// protocol, and the composed-row/CLI wiring. Evidence ->
// evidence/extensions/extension-lifecycle/<ts>/{result.json,output.log}.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  FLOW_JSON, PERSONA_MD, REPO, SKILL_MD, binaryPresent, bootSession, callsOf, crashSignatures, createSandbox,
  cleanup, gatePrereqs, installProfile, isolationArm, isolationStep, keepRawSession, manifest, makeStubModel,
  runAsync, sessionEvidence, timestamp, toolResultsByCallId, useStubRoute, writeEvidence, writeExtension,
} from "./extension-isolation.ts"
import type { ExtensionSandbox, RunResult } from "./extension-isolation.ts"

/** The case slug: names the evidence directory and the self-test's log prefix. */
export const SLUG: string = "extension-lifecycle"

/** The project-plane extension id, dropped into `<session-cwd>/.mpd/extensions/` by the main arm. */
const PROJ_ID: string = "qa-ext-proj"
/** The user-plane extension id, written into the sandbox HOME plane (the only plane allowed roles/mcp). */
const USER_ID: string = "qa-ext-user"
/** The id of the healthy extension the failure arm parks beside the deliberately broken ones. */
const HEALTHY_ID: string = "qa-ext-healthy"
/** The skill name the main arm loads through the `skill` tool. */
const SKILL_NAME: string = "qa-ext-skill"
/** The flow id the main arm shows through `mpd_flow_show`. */
const FLOW_ID: string = "qa-ext-flow"
/** The user-plane role the main arm reads with `mpd_role_persona` and then really spawns. */
const ROLE_NAME: string = "QA Extension Reviewer"
/** The marker only the user-plane persona file carries, so a persona answer is attributable to it. */
const PERSONA_MARKER: string = "QA-MARKER-PERSONA-USER"
/** The marker only the project-plane SKILL.md carries, so the served skill text is attributable. */
const SKILL_MARKER: string = "QA-MARKER-SKILL-PROJ"
/** The marker only the project-plane flow document carries, read back from the flow tool result. */
const FLOW_MARKER: string = "QA-MARKER-FLOW-PROJ"
/** The marker the spawned role child must answer with, proving the child turn really ran. */
const ROLE_CHILD_MARKER: string = "QA-CHILD-MARKER-ROLE"
/** The per-item reason the product emits when the PROJECT plane contributes roles or mcp (C14). */
const PROJECT_REJECTION: string = "project-level extensions may contribute skills and flows only"

/** The shape a packed tree's three on-disk facts are kept in, so the predicate and its driver agree. */
interface PackedTreeFacts {
  /** Whether the tree's `cordis.patch.yml` declares the `mpd-ext` row. */
  hasRow: boolean
  /** Whether the tree carries the `packages/mpd-ext-plugin` package directory. */
  hasPlugin: boolean
  /** Whether the tree carries the `extensions/` discovery root. */
  hasExtensions: boolean
}

/** One fixture tree's facts plus the packed-tree predicate's verdict for that tree. */
interface PackedFixtureTree extends PackedTreeFacts {
  /** The predicate's verdict: true only for a fully closed fixture tree. */
  ok: boolean
}

/** The predicate's complete input: the three tree facts plus the packer's own exit status. */
interface PackedStateFacts extends PackedTreeFacts {
  /** The packer's exit status, or null when the packer never ran (a refused route). */
  packExit: number | null
}

/** Which facts a fixture packed tree should carry; the defaults describe a fully CLOSED tree. */
interface PackedFixtureOptions {
  /** Whether the fixture's patch should declare the `mpd-ext` row. */
  row?: boolean
  /** Whether the fixture should ship the mpd-ext-plugin package directory. */
  plugin?: boolean
  /** Whether the fixture should ship the `extensions/` discovery root. */
  extensions?: boolean
}

/** The packed-tree negative driver's verdict, recorded in evidence and asserted by both callers. */
interface PackedNegativeResult {
  /** True only when the closed fixture passes and EVERY broken fixture fails. */
  falsifiable: boolean
  /** True only when a non-zero packer exit fails the same predicate (the fourth fact). */
  packerExitGated: boolean
  /** Fixture tree name -> its facts and the predicate's verdict for it. */
  trees: Record<string, PackedFixtureTree>
}

/** T-85's cheap, deterministic stamp of the canonical packed artifact. */
interface CanonicalArtifactStamp {
  /** Whether the canonical packed tree exists on disk at all. */
  present: boolean
  /** The root the stamp was taken of, echoed so a reader can recompute it. */
  root: string
  /** Number of regular files in the tree; directories are traversed but never counted. */
  files: number
  /** sha256 of the packed manifest, or null when the tree is absent. */
  manifestSha256: string | null
  /** sha256 of the packed patch, or null when the tree is absent. */
  patchSha256: string | null
}

/** The two constants of the real packer that the scratch-COPY route rewrites. */
interface PackerPatchTargets {
  /** The literal to substitute for the packer's `repoRoot` constant. */
  repo: string
  /** The literal to substitute for the packer's `outDir` constant. */
  out: string
}

/** A successful packer patch: every anchor matched exactly once and was rewritten. */
interface PackerPatchSuccess {
  /** Discriminant: nothing was refused. */
  refused: false
  /** The 0-based line indexes that were rewritten, in anchor order. */
  patched: number[]
  /** The anchor names the patch knows about, in rewrite order. */
  anchors: string[]
  /** The rewritten source text. */
  text: string
}

/** A refused packer patch: the source drifted, so it is reported instead of silently patched. */
interface PackerPatchRefusal {
  /** Discriminant: the patch was refused. */
  refused: true
  /** The loud reason, naming the anchor and how many lines it matched. */
  reason: string
  /** The anchor names the patch knows about, in rewrite order. */
  anchors: string[]
  /** Absent on the refusal path: the original returns no rewritten text when it refuses. */
  text?: string
}

/** Either the two anchors were rewritten, or the drifted packer was refused. */
type PackerPatchResult = PackerPatchSuccess | PackerPatchRefusal

/** The route a scratch pack takes, decided from the packer's OWN source. */
type PackRoute = "flag" | "copy"

/** The provenance fields every scratch-pack exit reports, whichever route ran. */
interface ScratchPackProvenance {
  /** The scratch staging root created under the arm's evidence dir. */
  scratchRoot: string
  /** sha256 prefix of the live packer source this run read and decided on. */
  packerSha256: string
  /** The route taken; the copy-route SUCCESS path omits it, exactly as the original returned it. */
  route?: PackRoute
  /** Whether the live packer exposes its own `--out` flag; also omitted on the copy-route success path. */
  packerSupportsOut?: boolean
  /** Path of the generated scratch packer copy; only the copy route ever writes one. */
  scratchPacker?: string
  /** sha256 prefix of the patched scratch source; only the copy route ever patches one. */
  patchedSha256?: string
  /** The loud refusal reason; the refusal exit is the only one that carries it. */
  reason?: string
}

/** The copy route's refusal: the packer source drifted, so nothing was packed. */
interface ScratchPackRefusal extends ScratchPackProvenance {
  /** Discriminant: the route refused to pack. */
  refused: true
}

/** A route that packed: the real packer child and the scratch out-dir it wrote. */
interface ScratchPackSuccess extends ScratchPackProvenance {
  /** Discriminant: the route did pack. */
  refused: false
  /** The real packer child process that produced the scratch tree. */
  run: RunResult
  /** The scratch out-dir the packer wrote, i.e. `<scratchRoot>/mpd-package`. */
  packedRoot: string
}

/** Either the scratch pack ran, or the copy route refused a drifted packer. */
type ScratchPackOutcome = ScratchPackSuccess | ScratchPackRefusal

/** What a sandbox-driven arm receives: the sandbox, the evidence dir and the run's log sink. */
interface ArmContext {
  /** The temp sandbox the arm writes extensions into and boots its session from. */
  box: ExtensionSandbox
  /** The evidence directory this run writes its raw session copies into. */
  outDir: string
  /** The shared log lines the arm appends its truncated boot output to. */
  logs: string[]
}

/** What the packed arm receives: it needs no sandbox, only the evidence dir and the log sink. */
interface PackedArmContext {
  /** The evidence directory the scratch pack and its transcript are staged under. */
  outDir: string
  /** The shared log lines the arm appends its scratch-pack transcript to. */
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

/** The two members of a built plugin entry that the seam regression check calls. */
interface PluginEntryModule {
  /** The seam names the row declares; validated with `Array.isArray` before it is read. */
  inject?: unknown
  /** The cordis apply function the loader calls with the row context and its config. */
  apply: (ctx: unknown, config: unknown) => unknown
}

/** The row's own warn channel: present in the hostile ctx, and never the only place a failure may land. */
interface HostileLogger {
  /** A warn sink that records nothing, so the check reads stdout alone. */
  warn: () => void
}

/** A HOSTILE cordis ctx: the seam services are not plain properties and `get()` resolves nothing. */
interface HostileRowContext {
  /** The row's logger, present and inert. */
  logger: HostileLogger
  /** The seam lookup, which resolves nothing — the composition that used to fail with no visible line. */
  get: () => undefined
  /** The provide seam, present and inert. */
  provide: () => void
}

/** One targeted mutation of the built artifact: the exact anchor line and its replacement. */
interface ArtifactMutation {
  /** Human-readable name, also sanitized into the mutant copy's file name. */
  name: string
  /** The exact source line the mutant must contain; a miss is reported, never skipped. */
  from: string
  /** The replacement line that must make the seam check go RED. */
  to: string
}

/**
 * The regression test that WOULD HAVE CAUGHT the seam defect (measured
 * 2026-09-14): the built row must DECLARE the seams it registers through, and a
 * boot whose seams are unavailable must be LOUD on stdout and must never print
 * the success summary. Both halves fail on the pre-fix artifact (`inject: []`
 * plus an unconditional success line) and pass on the fixed one, so this is a
 * real falsifiable check rather than a re-statement of the fix.
 * @param artifactPath The built entry to check; defaults to the shipped plugin dist.
 * @returns `undefined` when the artifact behaves, else the one-line failure reason.
 */
async function seamRegressionCheck(artifactPath?: string): Promise<string | undefined> {
  /** The built entry under test: the caller's mutant copy, or the shipped plugin dist. */
  const distPath = artifactPath ?? join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")
  if (!existsSync(distPath)) return "the built plugin dist is missing: " + distPath
  /**
   * The imported entry, narrowed to the two members this check reads. A dynamic `import()` of a
   * computed specifier is typed `any` by the language, so the cast re-attaches the row's own
   * contract here — narrowing is impossible on a value whose shape is only known at runtime.
   */
  const dist = (await import(pathToFileURL(distPath).href + "?v=" + Date.now())) as PluginEntryModule
  if (!Array.isArray(dist.inject) || !dist.inject.includes("tools") || !dist.inject.includes("skills")) {
    return "the built row must declare the seams it registers through (inject must include tools and skills; got " + JSON.stringify(dist.inject) + ")"
  }
  /** Everything the row writes to stdout while applying, captured for the two signature tests. */
  const captured: string[] = []
  /** The real console sink, restored on every exit path so the capture cannot leak out of this check. */
  const originalLog = console.log
  console.log = (...args: unknown[]): void => { captured.push(args.map((part) => String(part)).join(" ")) }
  try {
    // HOSTILE ctx: the services are NOT plain properties and get() resolves
    // nothing — the exact composition that used to fail with no visible line.
    /** The row context the entry is applied with: every seam present but useless. */
    const ctx: HostileRowContext = { logger: { warn: (): void => {} }, get: (): undefined => undefined, provide: (): void => {} }
    await dist.apply(ctx, {})
  } catch (error) {
    console.log = originalLog
    // `catch` binds `unknown` under `strict`: the thrown value's own truthy `message` is preferred, and
    // anything else falls back to its string form — the same choice the original expression made.
    /** The failure text embedded in the returned reason. */
    const detail = typeof error === "object" && error !== null && "message" in error && error.message
      ? String(error.message)
      : String(error)
    return "apply threw out of the row (it must contain every failure): " + detail
  } finally {
    console.log = originalLog
  }
  /** Everything the row printed while applying, joined for the signature tests. */
  const text = captured.join("\n")
  if (!/FATAL/.test(text)) return "an unavailable seam must be reported LOUDLY on stdout, not only through ctx.logger.warn"
  if (/mpdExtensions provided/.test(text)) return "the success summary must never be printed when the four tools did not register"
  return undefined
}

/**
 * The offline self-test: the composed row, the descriptor contract (including the code-plane NaN rank
 * a JSON manifest cannot express), the CLI oracle, the seam regression plus its two mutants, and the
 * packed predicate's negative control — all without booting `dsh`.
 * @returns A promise that settles after the run has exited non-zero on any failed assertion.
 */
async function selfTest(): Promise<void> {
  /** Every failed assertion, printed together so one run reports the whole picture. */
  const problems: string[] = []
  /** Records one failed assertion; the collected list decides the final exit code. */
  const check = (condition: boolean, message: string): void => { if (!condition) problems.push(message) }

  // 1) the bundle really composes the row this case boots.
  /** The bundle patch as text: the mpd-ext row must be declared there. */
  const patch = readFileSync(join(REPO, "cordis.patch.yml"), "utf8")
  check(/- id: mpd-ext\b/.test(patch), "the bundle patch does not carry the mpd-ext row")
  check(patch.includes("packages/mpd-ext-plugin/dist/index.js"), "the mpd-ext row does not point at the plugin dist")
  /** The installer source, which must write the same row the bundle patch declares. */
  const installer = readFileSync(join(REPO, "scripts", "install-profile.ts"), "utf8")
  check(installer.includes('"mpd-ext"'), "install-profile.ts does not write the mpd-ext row")

  // 2) the descriptor contract rejects what this case's failure arm relies on,
  //    including the code-plane `rank: NaN` that a JSON manifest cannot express.
  /** The runtime validator's source, which the probe below reads through a file:// URL. */
  const registry = join(REPO, "packages", "mpd-ext-plugin", "src", "registry.ts")
  check(existsSync(registry), "the runtime validator source is missing")
  if (existsSync(registry)) {
    /** The bun probe's result: it drives the validator with the four malformed descriptors. */
    const result = spawnSync("bun", ["-e", [
      // pathToFileURL, not the raw path: a bare absolute Windows path inside the `-e` SOURCE is
      // mangled by JS string escapes before bun ever sees it (measured: `C:\MyDoc\...` became
      // `C:MyDocDshProj...`, so the probe imported nothing and all four arms read as failures). A
      // file:// URL carries no backslashes and is the same specifier on every platform.
      'import { validateDescriptor } from "' + pathToFileURL(registry).href + '"',
      'const bad = validateDescriptor({ apiVersion: 1, id: "x", contributes: { skills: [{ root: "skills", rank: Number.NaN }], flows: [{ dir: "../escape" }] } })',
      'const version = validateDescriptor({ apiVersion: 9, id: "x" })',
      'const noId = validateDescriptor({ apiVersion: 1 })',
      'console.log(JSON.stringify({ skills: bad.descriptor?.contributes.skills.length, flows: bad.descriptor?.contributes.flows.length, reasons: bad.errors.map((e) => e.item), versionRejected: version.rejected, noIdRejected: noId.rejected }))',
    ].join("; ")], { encoding: "utf8", timeout: 120000 })
    check(result.status === 0, "the validator probe failed: " + (result.stderr ?? "").slice(0, 200))
    /** The probe's JSON verdict; stays empty when the probe printed nothing parseable. */
    let parsed: Record<string, unknown> = {}
    try { parsed = JSON.parse((result.stdout ?? "").trim()) } catch { /* reported below */ }
    check(parsed.skills === 0, "a NaN rank must reject the skills item")
    check(parsed.flows === 0, "an escaping flows dir must reject the flows item")
    check(parsed.versionRejected === true, "apiVersion 9 must reject the descriptor")
    check(parsed.noIdRejected === true, "a missing id must reject the descriptor")
  }

  // 3) the extension developer CLI is a working independent oracle.
  /** The extension developer CLI (a repo source, hence the `.ts` specifier). */
  const cli = join(REPO, "scripts", "mpd-ext.ts")
  check(existsSync(cli), "the extension developer CLI (scripts/mpd-ext.ts) is missing")
  if (existsSync(cli)) {
    /** The CLI's verdict on the shipped example extension, which it must accept. */
    const okRun = spawnSync("bun", [cli, "validate", join(REPO, "extensions", "mpd-ext-example")], { encoding: "utf8", timeout: 120000 })
    check(okRun.status === 0, "the CLI must accept the shipped example (exit " + okRun.status + ")")
  }

  // 4) the fixtures this case writes are contract-shaped, and the skill fixture
  //    is a servable candidate (non-empty description).
  /** The project-plane descriptor fixture the main arm writes. */
  const projectManifest = manifest(PROJ_ID, { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] })
  check(projectManifest.apiVersion === 1, "the fixture manifest must declare apiVersion 1")
  check(FLOW_JSON(FLOW_ID, "QA flow", FLOW_MARKER).id === FLOW_ID, "the flow fixture must carry the requested id")
  check(FLOW_JSON(FLOW_ID, "QA flow", FLOW_MARKER).steps.length > 0, "the flow fixture must carry steps")
  check(SKILL_MD(SKILL_NAME, SKILL_MARKER).includes(SKILL_MARKER), "the skill fixture must carry its marker")
  check(/description: ".+"/.test(SKILL_MD(SKILL_NAME, SKILL_MARKER)), "the skill fixture must declare a non-empty description")

  // 5) the regression test for the seam defect (declared seams + loud failure +
  //    no false success claim), proven FALSIFIABLE: the same check must go RED on
  //    a mutated copy of the built artifact (the pre-fix `inject: []`, and a
  //    forced success branch). A check that cannot fail proves nothing.
  /** The seam check's verdict on the shipped artifact; `undefined` means it passed. */
  const seamProblem = await seamRegressionCheck()
  check(seamProblem === undefined, String(seamProblem))

  /** The built bundle text the two mutant copies are cut from. */
  const distSource = readFileSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js"), "utf8")
  /** The two targeted mutations, one per half of the defect this check guards. */
  const mutations: ArtifactMutation[] = [
    { name: "pre-fix inject", from: "var inject = [...REQUIRED_SEAMS];", to: "var inject = [];" },
    { name: "forced success branch", from: "if (missingTools.length > 0) {", to: "if (false) {" },
  ]
  /** Temp dir holding the mutant copies; removed in the `finally` below. */
  const mutateDir = mkdtempSync(join(tmpdir(), "mpd-ext-mutant-"))
  try {
    // Each mutation must still carry its anchor, and must then make the seam check go RED.
    for (const mutation of mutations) {
      if (!distSource.includes(mutation.from)) {
        check(false, "mutation anchor missing from the bundle (" + mutation.name + "): " + mutation.from)
        continue
      }
      /** The mutant copy: the anchor replaced, written under a name derived from the mutation. */
      const mutantPath = join(mutateDir, mutation.name.replace(/[^a-z0-9]+/gi, "-") + ".mjs")
      writeFileSync(mutantPath, distSource.replace(mutation.from, mutation.to))
      /** The seam check's verdict on the mutant, which must be non-undefined (RED). */
      const red = await seamRegressionCheck(mutantPath)
      check(red !== undefined, "the seam check must go RED on the "+ mutation.name + " mutant, but it passed")
    }
  } finally {
    rmSync(mutateDir, { recursive: true, force: true })
  }

  // 6) F9 FALSIFIABILITY (offline, temp dirs only): the packed-tree predicate the
  //    real arm gates on must be FALSE for every broken fixture tree — otherwise
  //    "the packed tree is closed" would be a claim no tree could contradict.
  /** The packed predicate's negative-control verdict over the four fixture trees. */
  const negative = packedNegativeDriver()
  check(negative.falsifiable, "the packed predicate is not falsifiable: " + JSON.stringify(negative.trees))
  check(negative.packerExitGated, "a non-zero packer exit must fail the packed predicate")
  check(negative.trees.closed.ok === true && Object.keys(negative.trees).length === 4, "the negative driver must build one closed tree and three broken ones")

  // 7) T-85 FALSIFIABILITY (offline): the ROUTE CHOICE must react to the packer's own source, and the
  //    copy fallback must rewrite exactly two anchors and REFUSE a drifted packer. Driven over synthetic
  //    sources ON PURPOSE: asserting against the LIVE packer's shape reddened this lane the moment the
  //    packer legitimately changed (measured 2026-09-17, when `--out` landed and this arm threw).
  /** A scratch out-dir the patcher fixtures point at; nothing is ever packed into it. */
  const scratchFixture = join(tmpdir(), "mpd-scratch-pack-fixture")
  /** A synthetic packer source that exposes the sanctioned `--out` flag. */
  const withOutFlag = ['const flag = argv.indexOf("--out")', "const outDir = OUT.dir", ""].join("\n")
  /** A synthetic pre-flag packer source carrying exactly the two anchors the copy route rewrites. */
  const legacyTwoAnchors = [
    "const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))",
    'const outDir = join(repoRoot, "dist", "mpd-package")',
    "",
  ].join("\n")
  check(choosePackRoute(withOutFlag) === "flag", "a packer exposing --out must route through the sanctioned flag")
  check(choosePackRoute(legacyTwoAnchors) === "copy", "a packer WITHOUT --out must fall back to the scratch COPY route")
  /** The copy route's verdict over the synthetic legacy source. */
  const patchedLegacy = patchPackerSource(legacyTwoAnchors, { repo: REPO, out: scratchFixture })
  check(patchedLegacy.refused === false && patchedLegacy.patched.length === 2, "the copy route must rewrite exactly two anchors: " + JSON.stringify(patchedLegacy))
  // The narrowing inside the check above does not persist into these separate statements, and an `as`
  // would be a lie at read time; `!` is erased, so the runtime expression stays the original one.
  check(patchedLegacy.text!.includes(JSON.stringify(scratchFixture)), "the patched copy must point at the scratch out-dir")
  check(!patchedLegacy.text!.includes('join(repoRoot, "dist", "mpd-package")'), "the patched copy must no longer point at the canonical dist/mpd-package")
  /** The same legacy source with its `outDir` anchor drifted, to prove the refusal path. */
  const driftedPackerSource = legacyTwoAnchors.replace(/^const outDir = .*$/m, "const outDir = join(repoRoot, 'somewhere', 'else')")
  /** The copy route's verdict over the drifted source, which must refuse it. */
  const patchedDrifted = patchPackerSource(driftedPackerSource, { repo: REPO, out: scratchFixture })
  check(patchedDrifted.refused === true && /outDir/.test(patchedDrifted.reason), "a drifted packer must be REFUSED, never patched: " + JSON.stringify(patchedDrifted))
  /** A packer source carrying neither anchor, which the patcher must refuse as well. */
  const anchorlessPacker = patchPackerSource("// a packer that carries neither anchor\n", { repo: REPO, out: scratchFixture })
  check(anchorlessPacker.refused === true, "a packer source with no anchors must be refused")
  // The LIVE packer is READ and RECORDED, never asserted: a packer change must not redden this lane.
  console.log("[self-test] live packer route = " + choosePackRoute(readFileSync(PACKER, "utf8")) + " (recorded, not asserted)")

  if (problems.length > 0) {
    // Every collected failure is printed, so one run reports the whole picture.
    for (const problem of problems) console.error("[" + SLUG + " self-test] FAIL: " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: composed row + validator rejections (incl. NaN rank via the code plane) + CLI oracle + seam regression (inject declared, failure LOUD, no false success) + packed predicate falsifiable (closed vs. three broken fixture trees) + T-85 scratch-pack patcher (two anchors rewritten, a drifted packer REFUSED) + fixtures verified")
}

// ── arms ────────────────────────────────────────────────────────────────────

/**
 * The main arm: drop a project-plane and a user-plane extension, boot ONE real session and assert each
 * kind from the harness's own session log.
 * @param context The sandbox, the evidence dir and the shared log sink.
 * @returns The arm's verdict and the per-call evidence recorded in result.json.
 */
async function mainArm({ box, outDir, logs }: ArmContext): Promise<ArmStep> {
  /** The project-plane extension root: `<session-cwd>/.mpd/extensions`, discovered PER CALL. */
  const projectSkills = join(box.ws, ".mpd", "extensions")
  writeExtension(projectSkills, PROJ_ID, manifest(PROJ_ID, {
    skills: [{ root: "skills" }],
    flows: [{ dir: "flows" }],
    // Both kinds below are ILLEGAL in the project plane (process-global
    // registration cannot be scoped to a session): they must be rejected per
    // item with the stated reason and contribute nothing.
    mcp: [{ serverName: "qa_proj_mcp", transport: "stdio", command: "node" }],
    roles: [{ name: "QA Project Role", persona: "persona.md" }],
  }), {
    skills: { [SKILL_NAME]: SKILL_MD(SKILL_NAME, SKILL_MARKER) },
    flows: { [FLOW_ID + ".json"]: FLOW_JSON(FLOW_ID, "QA extension flow", FLOW_MARKER) },
    files: { "persona.md": PERSONA_MD("PROJ") },
  })
  writeExtension(join(box.runHome, ".mpd", "extensions"), USER_ID, manifest(USER_ID, {
    skills: [{ root: "skills" }],
    roles: [{ name: ROLE_NAME, description: "QA extension role", readonly: true, persona: "persona.md" }],
  }), {
    skills: { "qa-ext-user-skill": SKILL_MD("qa-ext-user-skill", "USER") },
    files: { "persona.md": PERSONA_MD(PERSONA_MARKER) },
  })

  /** The ordered tool calls the stub drives the session through, then its closing text. */
  const script = [
    { tool: "mpd_ext_list", args: {} },
    { tool: "mpd_ext_show", args: { id: PROJ_ID } },
    { tool: "mpd_flow_list", args: {} },
    { tool: "mpd_flow_show", args: { id: FLOW_ID } },
    { tool: "skill", args: { name: SKILL_NAME } },
    { tool: "mpd_role_persona", args: { role: ROLE_NAME } },
    { tool: "mpd_role_spawn", args: { role: ROLE_NAME, task: "Reply with exactly " + ROLE_CHILD_MARKER } },
    { text: "lifecycle-main-done" },
  ]
  // A spawned role child must report through the harness's `structured_output`
  // tool (the subagent driver attaches it), so the stub drives that call — an
  // empty summary would otherwise look like a successful spawn with no child turn.
  /** The local OpenAI-shaped stub that answers every model step of this session. */
  const stub = makeStubModel({
    script,
    childMarker: ROLE_CHILD_MARKER,
    childAnswer: ROLE_CHILD_MARKER + "-OK",
    childScript: [{ tool: "structured_output", args: { role: ROLE_NAME, summary: ROLE_CHILD_MARKER + "-OK", recommendation: "none", details: "extension-lifecycle QA", evidence: ["mpd_role_spawn"] } }],
    label: "lifecycle-main",
  })
  /** The stub's listening port, patched into the sandbox home so the session routes to it. */
  const port = await stub.listen()
  useStubRoute(box.dshHome, port)
  /** The one real headless session, whose model steps the stub answers. */
  const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "Run the extension inspection calls in order, then report what you saw.", stub })
  /** The tool names every assertion below is keyed on, in the order the script calls them. */
  const names = ["mpd_ext_list", "mpd_ext_show", "mpd_flow_list", "mpd_flow_show", "skill", "mpd_role_persona", "mpd_role_spawn"]
  /** The harness-recorded evidence of this session: store, offered names and per-name calls. */
  const evidence = sessionEvidence(box.dshHome, box.ws, names)
  await stub.close()
  keepRawSession(outDir, "main", evidence.store)
  logs.push("=== main arm (exit " + run.status + ", " + run.durationMs + "ms) ===\n" + run.out.slice(-6000))
  // Bind every assertion to ITS OWN call result: `findToolCall().resultText` joins
  // the results of every call of that tool name, which would let one call's text
  // satisfy another call's assertion.
  /** Every call result, keyed by harness call id. */
  const results = toolResultsByCallId(evidence.store)
  /** The text of one tool's FIRST recorded call result, or `""` when it never ran. */
  const text = (name: string): string => {
    /** The first recorded call of that tool, absent when the tool was never called. */
    const call = callsOf(evidence.store, name)[0]
    return call === undefined ? "" : (results.get(call.callId)?.text ?? "")
  }
  /** The tool names the session's own request header offered, from the stub's trace. */
  const offered = stub.trace[0]?.offeredTools ?? []
  return {
    ok: run.status === 0
      && names.every((name) => evidence.calls[name]?.succeeded === true)
      && text("mpd_ext_list").includes(PROJ_ID)
      && text("mpd_ext_list").includes(USER_ID)
      && text("mpd_ext_list").includes(PROJECT_REJECTION)
      && text("mpd_flow_show").includes(FLOW_MARKER)
      && text("skill").includes(SKILL_MARKER)
      && text("mpd_role_persona").includes(PERSONA_MARKER)
      && text("mpd_role_spawn").includes(ROLE_CHILD_MARKER + "-OK"),
    exit: run.status,
    durationMs: run.durationMs,
    offeredExtTools: offered.filter((name) => name.startsWith("mpd_ext_") || name.startsWith("mpd_flow_")),
    recordedTools: names.filter((name) => evidence.names.includes(name)),
    calls: Object.fromEntries(names.map((name) => [name, {
      succeeded: Boolean(evidence.calls[name]?.succeeded),
      reason: evidence.calls[name]?.reason ?? "",
      resultHead: text(name).slice(0, 240),
    }])),
    sawProjectId: text("mpd_ext_list").includes(PROJ_ID),
    sawUserId: text("mpd_ext_list").includes(USER_ID),
    sawProjectRejection: text("mpd_ext_list").includes(PROJECT_REJECTION),
    sawFlow: text("mpd_flow_show").includes(FLOW_MARKER),
    sawSkill: text("skill").includes(SKILL_MARKER),
    sawPersona: text("mpd_role_persona").includes(PERSONA_MARKER),
    sawRoleChild: text("mpd_role_spawn").includes(ROLE_CHILD_MARKER + "-OK"),
    crashSignatures: crashSignatures(run.out),
    isolation: isolationStep(box.dshHome, box.sandbox, SLUG + ":main"),
  }
}

/**
 * The failure arm: park one deliberately broken extension of each kind beside a healthy one and prove
 * that the boot stays green, the session completes its turn, and every broken item is reported per item.
 * @param context The sandbox, the evidence dir and the shared log sink.
 * @returns The arm's verdict plus the CLI oracle's per-extension exits.
 */
async function failureArm({ box, outDir, logs }: ArmContext): Promise<ArmStep> {
  /** The project-plane extension root every broken extension is written into. */
  const root = join(box.ws, ".mpd", "extensions")
  writeExtension(root, "qa-bad-json", "{ this is not json")
  writeExtension(root, "qa-bad-version", { apiVersion: 9, id: "qa-bad-version", contributes: {} })
  writeExtension(root, "qa-bad-skill", manifest("qa-bad-skill", { skills: [{ root: "skills" }], flows: [{ dir: "flows", rank: "300" }] }), {
    skills: {
      "qa-good-sibling": SKILL_MD("qa-good-sibling", "SIBLING"),
      "qa-broken-empty": SKILL_MD("qa-broken-empty", "BROKEN", ""),
      "QA-BAD-NAME": SKILL_MD("QA-BAD-NAME", "BROKEN"),
    },
  })
  writeExtension(root, "qa-bad-asset", manifest("qa-bad-asset", { skills: [{ root: "../escape" }] }))
  writeExtension(root, HEALTHY_ID, manifest(HEALTHY_ID, { skills: [{ root: "skills" }], flows: [{ dir: "flows" }] }), {
    skills: { "qa-ext-healthy-skill": SKILL_MD("qa-ext-healthy-skill", "HEALTHY") },
    flows: { "qa-ext-healthy-flow.json": FLOW_JSON("qa-ext-healthy-flow", "Healthy flow", "HEALTHY-FLOW") },
  })
  writeExtension(root, "qa-project-host-kinds", manifest("qa-project-host-kinds", {
    skills: [{ root: "skills" }],
    mcp: [{ serverName: "qa_proj_only", transport: "stdio", command: "node" }],
    roles: [{ name: "QA Project Only", persona: "persona.md" }],
  }), { skills: { "qa-project-host-kind-skill": SKILL_MD("qa-project-host-kind-skill", "PROJHOST") }, files: { "persona.md": PERSONA_MD("PROJONLY") } })

  /** The local OpenAI-shaped stub answering the failure arm's own session. */
  const stub = makeStubModel({
    script: [
      { tool: "mpd_ext_list", args: {} },
      { tool: "mpd_flow_list", args: {} },
      { tool: "mpd_flow_show", args: { id: "qa-ext-healthy-flow" } },
      { text: "lifecycle-failure-done" },
    ],
    label: "lifecycle-failure",
  })
  /** The stub's listening port, patched into the sandbox home so the session routes to it. */
  const port = await stub.listen()
  useStubRoute(box.dshHome, port)
  /** The one real session of this arm. */
  const run = await bootSession({ slug: SLUG, env: box.env, cwd: box.ws, prompt: "List the extensions, the flows and show the healthy flow.", stub })
  /** The harness-recorded evidence of this session. */
  const evidence = sessionEvidence(box.dshHome, box.ws, ["mpd_ext_list", "mpd_flow_list", "mpd_flow_show"])
  await stub.close()
  keepRawSession(outDir, "failure", evidence.store)
  logs.push("=== failure arm (exit " + run.status + ") ===\n" + run.out.slice(-6000))
  /** The listing the session received, which must name every broken item. */
  const listed = evidence.calls.mpd_ext_list?.resultText ?? ""

  // The CLI is an independent oracle over the SAME directories: it must accept
  // the healthy extension and reject each broken one per item.
  /** The extension developer CLI, used as the oracle over the same directories. */
  const cli = join(REPO, "scripts", "mpd-ext.ts")
  /** Per-extension CLI verdicts: exit status plus the last two output lines. */
  const cliChecks: Record<string, { exit: number | null; tail: string }> = {}
  // Each broken extension must exit 1 and the healthy one must exit 0.
  for (const id of ["qa-bad-json", "qa-bad-version", "qa-bad-skill", "qa-bad-asset", HEALTHY_ID]) {
    /** The CLI's verdict on one extension directory. */
    const result = spawnSync("bun", [cli, "validate", join(root, id)], { encoding: "utf8", timeout: 120000 })
    cliChecks[id] = { exit: result.status, tail: ((result.stderr ?? "") + (result.stdout ?? "")).trim().split("\n").slice(-2).join(" | ").slice(0, 200) }
  }
  return {
    ok: run.status === 0
      && Boolean(evidence.calls.mpd_ext_list?.succeeded)
      && Boolean(evidence.calls.mpd_flow_list?.succeeded)
      && Boolean(evidence.calls.mpd_flow_show?.succeeded)
      && listed.includes(HEALTHY_ID)
      && evidence.calls.mpd_flow_show.resultText.includes("HEALTHY-FLOW")
      && listed.includes("qa-bad-version")
      && listed.includes("rejected")
      && listed.includes(PROJECT_REJECTION)
      && cliChecks[HEALTHY_ID].exit === 0
      && ["qa-bad-json", "qa-bad-version", "qa-bad-skill", "qa-bad-asset"].every((id) => cliChecks[id].exit === 1),
    exit: run.status,
    sessionCompleted: run.status === 0,
    listedHealthy: listed.includes(HEALTHY_ID),
    flowToolStillWorks: evidence.calls.mpd_flow_show?.resultText.includes("HEALTHY-FLOW") ?? false,
    reportedProjectRejection: listed.includes(PROJECT_REJECTION),
    reportedRejections: ["qa-bad-json", "qa-bad-version"].filter((id) => listed.includes(id)),
    cliChecks,
    crashSignatures: crashSignatures(run.out),
    resultHead: listed.slice(0, 600),
    isolation: isolationStep(box.dshHome, box.sandbox, SLUG + ":failure"),
  }
}

/** The real packer (a repo source, hence the `.ts` specifier) the scratch arm drives. */
const PACKER = join(REPO, "scripts", "pack-mpd.ts")
/** The canonical packed artifact this lane must never write; it is only stamped. */
const CANONICAL_PACKED = join(REPO, "dist", "mpd-package")

/**
 * sha256 of a text or byte blob, the same digest shape the QA lanes use elsewhere.
 * @param text The text or bytes to digest.
 * @returns The lowercase hex digest.
 */
function digest(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex")
}

/**
 * sha256 of a file's bytes, or null when the file is absent.
 * @param path The file to digest.
 * @returns The lowercase hex digest, or null when nothing is at `path`.
 */
function fileSha(path: string): string | null {
  return existsSync(path) ? digest(readFileSync(path)) : null
}

/**
 * T-85: a cheap, deterministic STAMP of the canonical packed artifact — the file count plus the two
 * files that define the packed tree. A reader can recompute it without trusting this lane, which is
 * what makes "the lane did not move the delivered artifact" checkable instead of asserted.
 * @param root The packed tree to stamp; defaults to the canonical `dist/mpd-package`.
 * @returns The presence flag, the file count and the two defining file digests.
 */
export function canonicalArtifactStamp(root: string = CANONICAL_PACKED): CanonicalArtifactStamp {
  if (!existsSync(root)) return { present: false, root, files: 0, manifestSha256: null, patchSha256: null }
  /** Regular files seen so far; directories are traversed but never counted. */
  let files = 0
  /** Depth-first walk that counts every regular file under one directory. */
  const walk = (dir: string): void => {
    // Every entry is classified by its dirent, so a symlinked directory is not followed twice.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else files += 1
    }
  }
  walk(root)
  return {
    present: true,
    root,
    files,
    manifestSha256: fileSha(join(root, "package.json")),
    patchSha256: fileSha(join(root, "cordis.patch.yml")),
  }
}

/**
 * T-85 / t70 `scratch-pack.mjs` pattern: rewrite EXACTLY the two path constants of the real packer
 * (`repoRoot`, `outDir`) and REFUSE when either anchor does not match exactly once — a drifted packer
 * fails loudly instead of silently packing from something else. Pure (no IO), so --self-test drives it
 * over the real source and a deliberately drifted one.
 * @param source The packer source to rewrite.
 * @param targets The two literals to substitute for `repoRoot` and `outDir`.
 * @returns Either the rewritten text with its patched line indexes, or the refusal reason.
 */
export function patchPackerSource(source: string, { repo, out }: PackerPatchTargets): PackerPatchResult {
  /** The two constants to rewrite, each with an exact single-line anchor and its replacement. */
  const anchors = [
    { name: "repoRoot", re: /^const repoRoot = dirname\(dirname\(fileURLToPath\(import\.meta\.url\)\)\)$/, replacement: "const repoRoot = " + JSON.stringify(repo) },
    { name: "outDir", re: /^const outDir = join\(repoRoot, "dist", "mpd-package"\)$/, replacement: "const outDir = " + JSON.stringify(out) },
  ]
  /** The source split into lines, so each anchor can be matched per line. */
  const lines = source.split("\n")
  /** The 0-based line indexes that were rewritten, in anchor order. */
  const patched: number[] = []
  // Both anchors must match, so a partial patch can never be mistaken for a complete one.
  for (const anchor of anchors) {
    /** Line indexes whose text matches this anchor, in file order. */
    const hits = lines.map((line, index) => (anchor.re.test(line) ? index : -1)).filter((index) => index >= 0)
    if (hits.length !== 1) {
      return {
        refused: true,
        reason: "anchor `" + anchor.name + "` matched " + hits.length + " line(s), expected exactly 1 — refusing to patch a packer that has drifted",
        anchors: anchors.map((entry) => entry.name),
      }
    }
    patched.push(hits[0])
    lines[hits[0]] = anchor.replacement
  }
  return { refused: false, patched, anchors: anchors.map((entry) => entry.name), text: lines.join("\n") }
}

/**
 * T-85 route choice — PREFERENCE ORDER, decided from the packer's OWN source so the lane cannot
 * silently keep staging into a canonical dir: the sanctioned `--out <dir>` flag when the packer
 * exposes it, else the t70 scratch-COPY fallback. Pure, so --self-test drives it both ways.
 * @param source The packer source to inspect.
 * @returns `"flag"` when the packer exposes `--out`, else `"copy"`.
 */
export function choosePackRoute(source: string): PackRoute {
  return /indexOf\("--out"\)/.test(source) ? "flag" : "copy"
}

/**
 * Run the REAL packer against a SCRATCH out-dir. The canonical `dist/mpd-package` is never a target:
 * route (1) is the packer's own `--out <dir>`; route (2) is the t70 copy, used only when the flag is
 * absent. The route taken is recorded in the arm's result.
 * @param context The evidence dir to stage the scratch tree under and the shared log sink.
 * @returns The route's outcome: the child run and packed root, or the copy route's refusal.
 */
async function scratchPack({ outDir, logs }: PackedArmContext): Promise<ScratchPackOutcome> {
  /** The live packer source, which decides the route AND is what the copy route patches. */
  const source = readFileSync(PACKER, "utf8")
  /** The scratch staging root inside the evidence dir; never the canonical artifact. */
  const scratchRoot = join(outDir, "scratch-pack")
  /** The scratch out-dir the packer is told to write. */
  const scratchOut = join(scratchRoot, "mpd-package")
  mkdirSync(scratchRoot, { recursive: true })
  /** The route this run takes, decided from the packer's own source. */
  const route = choosePackRoute(source)
  if (route === "flag") {
    /** The real packer run against the sanctioned scratch out-dir. */
    const run = await runAsync(process.execPath, [PACKER, "--out", scratchOut], { cwd: REPO, timeoutMs: 900000 })
    logs.push("=== scratch pack via the sanctioned --out flag (exit " + run.status + ", out-dir " + scratchOut + ") ===\n" + run.out.slice(-3000))
    return { refused: false, route, run, packedRoot: scratchOut, scratchRoot, packerSha256: digest(source).slice(0, 16), packerSupportsOut: true }
  }
  /** The copy route's verdict over the live packer source. */
  const patched = patchPackerSource(source, { repo: REPO, out: scratchOut })
  if (patched.refused) {
    logs.push("=== scratch pack REFUSED (copy route) ===\n" + patched.reason)
    return { refused: true, route, reason: patched.reason, scratchRoot, packerSha256: digest(source).slice(0, 16), packerSupportsOut: false }
  }
  /** The generated scratch packer copy this route runs (a runtime artifact, hence the `.mjs` name). */
  const scratchPacker = join(scratchRoot, "pack-mpd.scratch.mjs")
  writeFileSync(scratchPacker, patched.text)
  /** The copy route's real packer run. */
  const run = await runAsync(process.execPath, [scratchPacker], { cwd: REPO, timeoutMs: 900000 })
  logs.push("=== scratch pack via the copy fallback (exit " + run.status + ", out-dir " + scratchOut + ") ===\n" + run.out.slice(-3000))
  logs.push("=== scratch packer provenance ===\nrepoRoot+outDir rewritten only; other lines byte-identical ("
    + (patched.text.split("\n").length - 2) + " of " + patched.text.split("\n").length + " lines unchanged); packer sha "
    + digest(source).slice(0, 16) + " -> patched sha " + digest(patched.text).slice(0, 16))
  return {
    refused: false,
    run,
    packedRoot: scratchOut,
    scratchRoot,
    scratchPacker,
    packerSha256: digest(source).slice(0, 16),
    patchedSha256: digest(patched.text).slice(0, 16),
  }
}

/**
 * The packed arm: pack into a scratch dir, gate on the pure packed-tree predicate, drive the predicate's
 * negative control, and prove the canonical artifact was not moved.
 * @param context The evidence dir to stage the scratch pack under and the shared log sink.
 * @returns The arm's verdict plus the route, the stamps and the negative control.
 */
async function packedArm({ outDir, logs }: PackedArmContext): Promise<ArmStep> {
  /** The canonical artifact's stamp before the arm, to prove the arm did not move it. */
  const canonicalBefore = canonicalArtifactStamp()
  /** What the scratch-pack route actually did. */
  const scratch = await scratchPack({ outDir, logs })
  /** The scratch packed root, or null when the route refused to pack at all. */
  const packed = scratch.refused ? null : scratch.packedRoot
  /** The three on-disk facts of the scratch tree; all false when nothing was packed. */
  const facts: PackedTreeFacts = packed === null ? { hasRow: false, hasPlugin: false, hasExtensions: false } : packedStateOf(packed)
  /** The fixture-tree negative control over the SAME predicate the verdict is gated on. */
  const negative = packedNegativeDriver()
  /** The canonical artifact's stamp after the arm. */
  const canonicalAfter = canonicalArtifactStamp()
  /** Whether the canonical artifact is byte-for-byte where it was before the arm. */
  const canonicalUnmoved = JSON.stringify(canonicalBefore) === JSON.stringify(canonicalAfter)
  logs.push("=== packed negative control (fixture trees) ===\n" + JSON.stringify(negative.trees, null, 2))
  logs.push("=== canonical artifact stamp (before/after) ===\n" + JSON.stringify({ canonicalBefore, canonicalAfter, canonicalUnmoved }, null, 2))
  /** The packer's exit status, or null when the route never ran a packer. */
  const packExit = scratch.refused ? null : scratch.run.status
  return {
    ok: scratch.refused === false
      && packedStateOk({ packExit, hasRow: facts.hasRow, hasPlugin: facts.hasPlugin, hasExtensions: facts.hasExtensions })
      && negative.falsifiable
      && canonicalUnmoved,
    route: (scratch.route === "flag"
      ? "sanctioned `--out <dir>` flag on scripts/pack-mpd.ts (the packer's own documented route for this lane change): no copy, no rewritten constant"
      : "t70 scratch-COPY fallback (the packer source carries no `--out`): copy + rewrite repoRoot+outDir only + refuse a drifted packer"),
    packerSupportsOut: scratch.packerSupportsOut,
    packExit,
    packedRoot: packed,
    scratch: {
      root: scratch.scratchRoot,
      packer: scratch.scratchPacker ?? null,
      packerSha256: scratch.packerSha256,
      patchedSha256: scratch.patchedSha256 ?? null,
      refused: scratch.refused,
      reason: scratch.reason ?? null,
    },
    canonical: {
      before: canonicalBefore,
      after: canonicalAfter,
      unmoved: canonicalUnmoved,
      rule: "the artifact has exactly ONE writer at a time (T-85): this lane is not a writer for dist/mpd-package, and a movement across the arm would be visible here",
    },
    rows: { mpdExtRowInPackedPatch: facts.hasRow },
    assets: { pluginDist: facts.hasPlugin, extensionsAsset: facts.hasExtensions },
    // The predicate above is the gate: FALSIFIABLE by construction, because the
    // same function is driven over fixture trees that each miss one fact.
    negativeControl: negative,
    status: facts.hasRow && facts.hasPlugin && facts.hasExtensions
      ? "GREEN (the SCRATCH packed tree carries the mpd-ext row, the plugin and the extensions/ discovery root)"
      : "RED (the scratch packed tree is missing the mpd-ext row, the plugin and/or the extensions/ discovery root — scripts/pack-mpd.ts must never exit 0 for such a tree, and this case now exits 1 with it)",
    note: "the packed arms read and write a SCRATCH tree under this run's evidence dir; the canonical dist/mpd-package is only stamped (read), never written, by this case",
    packTail: scratch.refused ? scratch.reason : scratch.run.out.trim().split("\n").slice(-3).join(" | ").slice(0, 300),
  }
}

// ── packed-tree contract + its negative driver ──────────────────────────────

/**
 * The packed-tree contract as a PURE predicate (F9): a packed tree is closed only
 * when the packer exited 0 AND the packed patch carries the `mpd-ext` row AND the
 * plugin package AND the `<bundle>/extensions/` discovery root are both present.
 *
 * It is a function of facts, never of this case's expectation: the archived `ok`
 * used to be `... && (hasPlugin && hasExtensions ? true : red)`, which was TRUE in
 * BOTH states, so exit 0 could accompany a red packed tree. Exported so the
 * negative driver below (and the offline `--self-test`) can falsify it directly.
 * @param facts The packer's exit status plus the three facts read from one tree.
 * @returns True only for a tree the packer closed completely and exited 0 on.
 */
export function packedStateOk({ packExit, hasRow, hasPlugin, hasExtensions }: PackedStateFacts): boolean {
  return packExit === 0 && hasRow === true && hasPlugin === true && hasExtensions === true
}

/**
 * The three facts the predicate reads, derived from ONE tree on disk.
 * @param root The packed tree to read.
 * @returns Whether the row, the plugin package and the discovery root are present.
 */
export function packedStateOf(root: string): PackedTreeFacts {
  /** The packed patch inside the tree under test. */
  const patchPath = join(root, "cordis.patch.yml")
  /** Whether that patch exists and declares the `mpd-ext` row. */
  const hasRow = existsSync(patchPath) && /- id: mpd-ext\b/.test(readFileSync(patchPath, "utf8"))
  return {
    hasRow,
    hasPlugin: existsSync(join(root, "packages", "mpd-ext-plugin")),
    hasExtensions: existsSync(join(root, "extensions")),
  }
}

/**
 * NEGATIVE DRIVER: build fixture packed trees in a temp dir — one CLOSED tree and
 * one per missing fact (no plugin package, no `extensions/` root, no `mpd-ext`
 * row) — and drive the SAME predicate the real arm uses over each. `falsifiable`
 * is true only when the closed tree passes and EVERY broken tree fails, so the
 * real arm's green cannot be a predicate that is true regardless of the tree.
 * Called from the real packed arm AND from `--self-test` (offline, temp dirs only).
 * @returns The falsifiability verdicts, the packer-exit gate and the per-tree facts.
 */
export function packedNegativeDriver(): PackedNegativeResult {
  /** The temp dir the four fixture trees are built in; removed in the `finally` below. */
  const root = mkdtempSync(join(tmpdir(), "mpd-packed-fixture-"))
  /** Fixture tree name -> its facts and the predicate's verdict, filled by the loop below. */
  const trees: Record<string, PackedFixtureTree> = {}
  try {
    /** Builds ONE fixture tree with the requested facts missing; returns its directory. */
    const build = (name: string, { row = true, plugin = true, extensions = true }: PackedFixtureOptions = {}): string => {
      /** The fixture tree's own directory under the temp root. */
      const dir = join(root, name)
      mkdirSync(dir, { recursive: true })
      /** The patch's row line: the mpd-ext row when requested, else an unrelated row. */
      const line = row
        ? "    - id: mpd-ext\n      name: '@mpd-dsh/mpd/packages/mpd-ext-plugin/dist/index.js'\n"
        : "    - id: mpd-tools\n      name: '@mpd-dsh/mpd/packages/mpd-tools-plugin/dist/index.js'\n"
      writeFileSync(join(dir, "cordis.patch.yml"), "- insert:\n" + line)
      if (plugin) mkdirSync(join(dir, "packages", "mpd-ext-plugin", "dist"), { recursive: true })
      if (extensions) mkdirSync(join(dir, "extensions"), { recursive: true })
      return dir
    }
    /** The four fixture trees: one closed control and one per missing fact. */
    const fixtures = {
      closed: build("closed"),
      "no-plugin-package": build("no-plugin-package", { plugin: false }),
      "no-extensions-root": build("no-extensions-root", { extensions: false }),
      "no-mpd-ext-row": build("no-mpd-ext-row", { row: false }),
    }
    // Every fixture tree is read back from disk and judged by the SAME predicate the arm gates on.
    for (const [name, dir] of Object.entries(fixtures)) {
      /** The tree's own facts, read from the layout that was just written. */
      const facts = packedStateOf(dir)
      trees[name] = { ...facts, ok: packedStateOk({ packExit: 0, ...facts }) }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  /** The three fixtures that must each make the predicate fail. */
  const broken = ["no-plugin-package", "no-extensions-root", "no-mpd-ext-row"]
  return {
    falsifiable: trees.closed?.ok === true && broken.every((name) => trees[name]?.ok === false),
    // A packer that exited non-zero must also fail the predicate (the fourth fact).
    packerExitGated: packedStateOk({ packExit: 1, hasRow: true, hasPlugin: true, hasExtensions: true }) === false,
    trees,
  }
}

/**
 * The real case: gate the prerequisites, install the sandbox profile, then run every arm and write the
 * evidence. Per AGENTS.md §7 the work never touches the real `~/.dsh`.
 * @returns A promise that settles after the process exits with the combined arm verdict.
 */
async function runReal(): Promise<void> {
  gatePrereqs({ slug: SLUG, prereqs: [
    { code: "absent-dsh-binary", probe: "dsh", remedy: "install DeepSeek Harness (dsh) on PATH", present: () => binaryPresent("dsh") },
    { code: "absent-runtime", probe: "packages/mpd-ext-plugin/dist/index.js", remedy: "bun build packages/mpd-ext-plugin/src/index.ts --target node --format esm --outfile packages/mpd-ext-plugin/dist/index.js", present: () => existsSync(join(REPO, "packages", "mpd-ext-plugin", "dist", "index.js")) },
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
    steps.main = await mainArm({ box, outDir, logs })
    steps.failure = await failureArm({ box, outDir, logs })
    /** The multi-session isolation arm's own steps plus its logs. */
    const iso = await isolationArm({ slug: SLUG, sandbox: box.sandbox, dshHome: box.dshHome, env: box.env, decoy: box.decoy, outDir })
    steps.isolation = { ok: iso.steps.ok, sessions: iso.steps }
    logs.push(...iso.logs)
    steps.packed = await packedArm({ outDir, logs })
  } while (false)
  steps.isolationFinal = isolationStep(box.dshHome, box.sandbox, SLUG)
  /** The case verdict: every arm (and the final isolation check) must have passed. */
  const ok = Object.values(steps).every((step) => step.ok === true)
  /** The evidence writer's own verdict, which mirrors `ok`. */
  const wrote = writeEvidence(outDir, SLUG, {
    ok,
    sandbox: box.sandbox,
    arms: "main (mount + list + flow + skill + role persona/spawn) | failure (broken of each kind beside a healthy one, CLI oracle) | isolation (two sessions, one host, decoy control) | packed (a SCRATCH pack — the canonical dist/mpd-package is never written by this lane, its stamp is asserted unmoved)",
    rankLadder: "100 project-dsh < 200 project-agents < 250 runtime < 300 ours < 400 user-dsh < 500 user-agents < 600 bundled; lower wins inside a layer, nearest layer wins outright",
    steps,
  }, logs.join("\n\n"))
  cleanup(box.sandbox)
  process.exit(ok ? 0 : 1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) await selfTest()
  else await runReal()
}
