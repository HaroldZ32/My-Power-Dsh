#!/usr/bin/env bun
// Shared engine for the two settings-bridge lanes:
//   • `web-settings-bridge.ts` — the WEB arm: the HOST's own authenticated API (303 +
//     launch-token cookie, then the `settings/mutate(ns, ops, revision)` call any web
//     surface emits), on a real boot;
//   • `tui-settings-bridge.ts`   — the TUI arm: the built TUI bytes, the §D.2 hint
//     disclosure and the §D.2 `no-live-session` RUNTIME NOTICE on the status line.
// Both arms prove the same subject: the `mpd` settings namespace really drives
// `<workspace>/.mpd/mpd.jsonc` (t34 design §1/§2/§A.1/§D; t35 acceptance A1-A4/A6).
// No lane here drives TUI KEYSTROKES (tui-panels owns that) and none renders the WEB surface
// (this client mounts its own top-level `settings.section`; the pre-move Plugins-tab CARD was cut
// by the user), because no browser exists in this environment.
//
// CLAIM SET (T-80): this driver CLAIMS the assertion keys A1–A5 — the same keys its own
// `add("A…")` calls produce below. A claimed-but-unasserted key, or a produced-but-unclaimed one,
// is a defect the corpus arm reports with this path and the key.
//
// WHAT THIS LANE DRIVES, stated exactly: the host's own `settings/mutate` RPC over the
// gateway (the SAME wire call the web section and the TUI section emit), against a REAL boot of
// the bundle in an isolated DSH_HOME + sandbox HOME + sandbox WORKSPACE. It does NOT send
// TUI keystrokes (a keystroke drive needs a TTY; tui-panels owns that surface and this lane
// only asserts the reworded disclosure is in the built TUI bytes) and it does NOT render
// the web settings SECTION (no browser exists here — its rendered state is NOT-CLAIMED); the
// SECTION's registration shape is asserted against the BUILT client bytes instead (W2a-W2f).
//
// Falsifiers this lane must be able to catch (design §9.3 F1/F2/F4/F5, plus the disabled
// negative control of §10.2):
//   F1 the file is unchanged after a front-door edit the RPC accepted;
//   F2 the file changed but a comment / the key order was lost, or the file stopped parsing;
//   F4 with zero live roots some file was written anyway (a guessed workspace);
//   F5 with two live roots any file was written instead of the `ambiguous-multi-root` refusal;
//   A6 the write-back switch (`writeBack: false`, the design's key; `settingsBridge.writeBack`
//      is also honoured) did not disable the FILE write
//      while the settings value still landed.
//
// NEGATIVE CONTROLS (recorded, all required): (1) the switch-off boot must show the file
// byte-identical while the mutate still succeeds — if that assertion cannot fail, the lane is
// void; (2) the assertion engine is re-run with an injected fault against the SAME artifacts
// (`negative/control.json`) and must go red; (3) the W2 section-shape checks are re-run with the
// PRE-MOVE `settings.plugin.item` card registration re-injected into the REAL built client bytes
// (`raw/card-shape-control.json`) and W2a/W2b must go red — a mutation that does not land is
// recorded as VOID and fails the run.
//
// PREREQ: absent-dsh-binary dsh "npm i -g @deepseek-ai/dsh (or run inside a checkout install)"
// PREREQ: absent-bundle-dist packages/mpd-config-plugin/dist/index.js "bun build packages/mpd-config-plugin/src/index.ts --target node --format esm --outfile packages/mpd-config-plugin/dist/index.js"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-settings-bridge.ts --self-test
//   bun skills/dsh-qa/scripts/tui-settings-bridge.ts [--out <dir>] [--keep]
// Evidence -> evidence/mpd-bridge/settings-bridge-lane/<timestamp>/{result.json,output.log,raw/}
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, symlinkSync, writeFileSync, cpSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { sandboxWorkspace, assertSessionsSandboxed } from "./workspace-isolation.ts"
import { DSH_MISSING, dshCommand, type Env } from "./dsh-launcher.ts"

/** The repository root, derived from this file's own URL (`<root>/skills/dsh-qa/scripts/lib/`). */
const REPO: string = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))))
/** Lane slug used in evidence paths, RPC ids and failure banners. */
export const LANE_SLUG: string = "settings-bridge"
/** Slug of the WEB arm (`web-settings-bridge.ts`), which owns its own evidence directory. */
export const WEB_ARM_SLUG: string = "web-settings-bridge"
/** Slug of the TUI arm (`tui-settings-bridge.ts`), which owns its own evidence directory. */
export const TUI_ARM_SLUG: string = "tui-settings-bridge"
/** The `MPD_QA_SETTINGS_BRIDGE_PORT` override, or `undefined` when the lane must find a free port itself. */
const PORT_OVERRIDE: number | undefined = process.env.MPD_QA_SETTINGS_BRIDGE_PORT === undefined ? undefined : Number(process.env.MPD_QA_SETTINGS_BRIDGE_PORT)
/** The settings namespace under test: the `mpd` namespace the config plugin registers. */
export const NS: string = "mpd"
/** The leaf path the lane rewrites inside the namespace: `hashline.maxDiffChars`. */
export const KNOB: readonly string[] = ["hashline", "maxDiffChars"]
/** The value the write arm sets: a number no schema default uses, so a change is unambiguous. */
const VALUE_WRITE: number = 31415
/** The value the ambiguous arm sets, kept distinct from `VALUE_WRITE` so a fan-out stays visible. */
const VALUE_AMBIGUOUS: number = 27182
/** The fixture's FILE value — the captain's falsifying number: it is NOT the schema default (20000),
 *  so a namespace whose base reports 35000 can only have derived it from `<workspace>/.mpd/mpd.jsonc`
 *  (t39 acceptance 4). */
export const VALUE_INITIAL: number = 35000

/** A JSON object of the host's own shape (an RPC envelope, a namespace descriptor, a report line). */
export type JsonRecord = Record<string, unknown>

/**
 * Find one namespace descriptor anywhere in a describe response. The RPC envelope's nesting is the
 * HOST's business (measured: `settings/mutate` answers `{ok, value:<descriptor>}`), so the lane
 * searches structurally instead of assuming a shape — and records the observed envelope keys.
 * @param payload - the parsed RPC result to search, of the host's own shape.
 * @param ns - the namespace name a candidate node must carry in its own `ns` field.
 * @returns the matching node as a JSON record, or `undefined` when no node names that namespace.
 */
function findNamespaceDescriptor(payload: unknown, ns: string): JsonRecord | undefined {
  // The nodes already visited, so a shared or cyclic object cannot loop the walk forever.
  const seen: Set<object> = new Set()
  // The depth-first work list, seeded with the whole payload; only objects are ever pushed.
  const stack: unknown[] = [payload]
  while (stack.length > 0) {
    // The node under inspection: `undefined` only if the stack emptied since the length test.
    const node = stack.pop()
    if (node === null || node === undefined || typeof node !== "object" || seen.has(node)) continue
    seen.add(node)
    if (Array.isArray(node)) {
      // A JSON array's elements are unknown until each is narrowed, so the view is `unknown[]`
      // (letting the element type infer here would leak `any` into the push below).
      const items: readonly unknown[] = node
      // One candidate per element; a scalar element can never be a namespace descriptor.
      for (const item of items) if (item !== null && typeof item === "object") stack.push(item)
      continue
    }
    // The node as a plain JSON record: an arbitrary envelope has no declared key names, so its
    // fields are read dynamically (a cast, because narrowing cannot invent those names).
    const record = node as JsonRecord
    if (String(record.ns ?? "") === ns) return record
    // One candidate per field value; a scalar field value can never be a namespace descriptor.
    for (const value of Object.values(record)) if (value !== null && typeof value === "object") stack.push(value)
  }
  return undefined
}

/**
 * Minimal JSONC read for the lane's own two-surface agreement check (comments + trailing commas).
 * @param text - the file text to strip and parse.
 * @returns the parsed JSON value; callers narrow it themselves, because `JSON.parse` keeps the
 * host file's own shape.
 */
function readJsoncLike(text: string): unknown {
  // The input with block comments, line comments and trailing commas removed: JSONC minus JSON.
  const stripped = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/,(\s*[}\]])/g, "$1")
  return JSON.parse(stripped)
}

/**
 * The fixture: comments, a trailing comma and a non-alphabetical order — all must survive.
 * @param value - the `hashline.maxDiffChars` value the fixture carries.
 * @returns the fixture's file text (JSONC, trailing newline included).
 */
export function fixture(value: number): string {
  return `{\n  // human comment: must survive the write-back\n  "hashline": {\n    "maxDiffChars": ${value},\n  },\n  "ulw": { "maxRounds": 6 },\n}\n`
}

/**
 * A file with a DUPLICATED leaf key, so the lane can witness the settled duplicate-key ruling.
 * @param value - the second `ulw.maxRounds` value, which must win over the first one.
 * @returns the fixture's file text (JSONC, trailing newline included).
 */
function duplicateFixture(value: number): string {
  return `{\n  "ulw": {\n    "maxRounds": 3,\n    "maxRounds": ${value},\n  },\n}\n`
}

/** The one report line shape the bridge emits, so a lane asserts on structure, not prose. */
export interface BridgeReport {
  /** The line's text from the `[mpd-config] settings bridge` marker on, trimmed. */
  readonly message: string
  /** The JSON object the line carried, or `null` when it carried none or did not parse. */
  readonly parsed: JsonRecord | null
}

/**
 * Extract every bridge report a boot log carries, one entry per matching line.
 * @param logText - the full boot log text.
 * @returns the reports in log order; a prose-only line carries `parsed: null`.
 */
export function bridgeReports(logText: string): BridgeReport[] {
  // One entry per matching line, in log order.
  const reports: BridgeReport[] = []
  // One log line at a time, so a report can only come from a line that names the bridge.
  for (const line of String(logText).split("\n")) {
    // Where the bridge marker starts on this line, or -1 when the line is unrelated.
    const at = line.indexOf("[mpd-config] settings bridge")
    if (at === -1) continue
    // Where the structured JSON begins after the marker, or -1 for a prose-only line.
    const brace = line.indexOf("{", at)
    if (brace === -1) {
      reports.push({ message: line.slice(at).trim(), parsed: null })
      continue
    }
    // The parsed JSON this line carried, `null` while it parses and after a parse failure.
    let parsed: JsonRecord | null = null
    try {
      parsed = JSON.parse(line.slice(brace))
    } catch {
      parsed = null
    }
    reports.push({ message: line.slice(at).trim(), parsed })
  }
  return reports
}

/** One assertion result: the stable check id, its outcome and the one-line evidence sentence. */
export interface LaneCheck {
  /** The stable check id the lane's reports and negative controls name (e.g. `W2`, `A4`, `T7`). */
  readonly id: string
  /** Whether the assertion held for the artifact under judgement. */
  readonly ok: boolean
  /** The human detail line printed with the check (it never carries a failure's cause). */
  readonly detail: string
}

/** One judge's verdict: its checks plus the aggregate `checks.length > 0 && every(ok)` rule. */
export interface LaneVerdict {
  /** Whether the run is green: at least one check ran and every check held. */
  readonly ok: boolean
  /** The checks the judge produced, in the order it produced them. */
  readonly checks: readonly LaneCheck[]
}

/** One RPC outcome reduced to the values the assertion engine judges (a mutate or a describe call). */
export interface MutateOutcome {
  /** Whether the front door accepted the call: HTTP 200, no protocol error, no transport failure. */
  ok: boolean
  /** The human detail a check message prints when the call did not succeed. */
  detail: string
  /** The namespace's RESOLVED value at the KNOB leaf — the L3 layer `mpd-config` merges. */
  resolved?: unknown
  /** The settings USER section's value at the KNOB leaf (the layer the RPC itself wrote). */
  user?: unknown
  /** The namespace revision the host reported, when it reported one. */
  revision?: unknown
  /** The namespace's BASE value at the KNOB leaf: the FILE-derived value (§10.1). */
  base?: unknown
}

/** One measured file pair of the ambiguous arm: its bytes before the mutate and after it. */
export interface BridgeFilePair {
  /** The file's bytes when the arm read them before the mutate. */
  before: string
  /** The file's bytes when the arm read them after the mutate (compared with `before`). */
  after: string
}

/**
 * One boot's measured facts, as the assertion engine consumes them. WHICH fields are present is
 * the mode's business: `write` carries the descriptor plus both file reads, `disabled` the two
 * reads, `ambiguous` the root list plus one pair per root, `static` only the built TUI text.
 */
export interface BridgeObserved {
  /** The arm whose checks must run: `write`, `disabled`, `ambiguous` or `static`. */
  readonly mode: string
  /** The front-door outcome of the mutate (absent for `static`, which drives nothing). */
  readonly mutate?: MutateOutcome
  /** The settings value the mutate was expected to land (the fixture's write value). */
  readonly expectedValue?: number
  /** The fixture's FILE value before the run: what the namespace BASE must report (§10.1). */
  readonly initialValue?: number
  /** The value read back through the AUTHORITATIVE surface (`settings/describe`). */
  readonly describedValue?: unknown
  /** The base that same describe surface reported, kept for the evidence file. */
  readonly describedBase?: unknown
  /** The target file's bytes before the mutate. */
  readonly fileBefore?: string
  /** The target file's bytes after the mutate (compared with `fileBefore`). */
  readonly fileAfter?: string
  /** The full boot log text the bridge report lines are extracted from. */
  readonly log?: string
  /** The live roots the ambiguous arm measured, one per session workspace. */
  readonly roots?: readonly string[]
  /** The measured file pairs of the ambiguous arm, one per live root. */
  readonly files?: readonly BridgeFilePair[]
  /** The built TUI bytes the `static` mode judges (the shipped disclosure and notice). */
  readonly tuiDist?: string
}

/**
 * The assertion engine. Pure: it judges artifacts (the RPC result, the file bytes before and
 * after, the boot log) and returns one result per check, so the self-test can falsify it.
 * @param observed - one boot's measured facts.
 * @returns per-check results and the overall verdict.
 */
export function evaluateBridge(observed: BridgeObserved): LaneVerdict {
  // One entry per check, in the order the checks below produce them.
  const checks: LaneCheck[] = []
  // Record one check: `ok` is coerced, `detail` stringified, so a judge cannot push a non-boolean.
  const add = (id: string, ok: boolean, detail: string): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  // The mode under judgement, read once so every block below tests the same value.
  const mode = observed.mode
  // Whether the front door accepted the write (the write/disabled/ambiguous modes).
  const mutateOk = observed.mutate?.ok === true
  // The bridge's own report lines, extracted from whatever log text the boot produced.
  const reports = bridgeReports(observed.log ?? "")
  // Only the lines whose JSON parsed: a prose-only line carries nothing structured to assert on.
  const structured: readonly JsonRecord[] = reports.map((report) => report.parsed).filter((parsed): parsed is JsonRecord => parsed !== null)
  // Whether the target file's bytes differ before and after the mutate (F1's falsifier).
  const fileChanged = observed.fileBefore !== observed.fileAfter

  if (mode === "write") {
    add("W1", mutateOk, "the front door accepted the settings write (" + (observed.mutate?.detail ?? "no detail") + ")")
    add("W2", fileChanged, "the live workspace's .mpd/mpd.jsonc changed after the accepted write")
    // The file's parsed value, `null` while it parses and after a parse failure.
    let parsed: unknown = null
    try {
      parsed = JSON.parse(String(observed.fileAfter).replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"))
    } catch (error) {
      parsed = null
    }
    // The value at the KNOB leaf, walked through a record view: the accumulator is JSON-derived,
    // so a cast is the only way to index it with the dynamic key (no declared shape exists here).
    const value = KNOB.reduce<unknown>((acc, part) => (acc == null ? undefined : (acc as JsonRecord)[part]), parsed)
    add("W3", value === observed.expectedValue, "the written value is " + observed.expectedValue + " (read back " + JSON.stringify(value) + ")")
    add("W4", String(observed.fileAfter).includes("// human comment: must survive the write-back"), "the human comment survived (F2)")
    add("W5", String(observed.fileAfter).includes('"ulw": { "maxRounds": 6 }') && String(observed.fileAfter).indexOf('"hashline"') < String(observed.fileAfter).indexOf('"ulw"'), "key order was not rewritten (F2)")
    add("W6", String(observed.fileAfter).includes(String(observed.initialValue)) === false, "the previous value is gone from the edited span")
    // The first report that names at least one written file (the structured half of the log).
    const wrote = structured.find((report) => Array.isArray(report.writtenTo) && report.writtenTo.length > 0)
    add("W7", wrote !== undefined, "the boot log carries a bridge report naming the file it wrote (F1: silence would hide a dead bridge)")
    add("W8", structured.some((report) => report.source === "update"), "the write-back was triggered by an `update`, not a provider echo (design §2.1)")
    add("W9", structured.every((report) => report.applies === "restart"), "every report carries applies:'restart' (design §D.1 honesty)")
    // The documented `writtenTo` field viewed as the path list it is: a cast, because a JSON
    // field of unknown type cannot be indexed as an array by narrowing alone.
    add("W10", (((wrote?.writtenTo) as readonly unknown[] | undefined) ?? []).some((file) => String(file).includes(".mpd/mpd.jsonc")), "the report names a .mpd/mpd.jsonc path")
    // OBSERVATION 3 (the plugin's resolved value changed): the host answered the write with a
    // descriptor whose RESOLVED value — the layer `mpd-config` merges as L3 and every mpd plugin
    // reads — is the written value, and whose raw user section carries it too.
    add("W11", observed.mutate?.resolved === observed.expectedValue, "the RESOLVED namespace value the mpd config layer merges changed to " + observed.expectedValue + " (descriptor value = " + JSON.stringify(observed.mutate?.resolved) + ")")
    add("W12", observed.mutate?.user === observed.expectedValue, "the settings USER section (the L3 layer) carries the written value (" + JSON.stringify(observed.mutate?.user) + ")")
    // §10.1: THIS is why `mpd-config` owns the registration — the namespace serves the FILE-DERIVED
    // base, so a front door shows the real inherited value instead of a schema default (the fixture's
    // file value differs from the schema default on purpose).
    // AGREEMENT (W14/W15): the namespace's resolved value (the settings surface) must equal the
    // value the durable file carries, read INDEPENDENTLY through the minimal JSONC reader below.
    // W15 names the authoritative read-back surface (`settings/describe`), so a reviewer can see
    // WHICH surface the resolved value came from.
    // The same value read INDEPENDENTLY through the minimal JSONC reader, so one parse bug cannot
    // make the two surfaces agree by construction.
    const fileValueAtRead: unknown = ((): unknown => {
      try {
        // The file's JSONC viewed as a record, so the two-key walk below can be written at all
        // (a cast: the reader's result is deliberately untyped).
        const parsed = readJsoncLike(String(observed.fileAfter)) as JsonRecord
        return (parsed?.hashline as JsonRecord | undefined)?.maxDiffChars
      } catch {
        return undefined
      }
    })()
    add("W15", observed.describedValue === observed.expectedValue,
      "the AUTHORITATIVE read surface (settings/describe) agrees: its resolved value is " + observed.expectedValue + " (read " + JSON.stringify(observed.describedValue) + ")")
    add("W14", fileValueAtRead === observed.expectedValue && observed.mutate?.resolved === observed.expectedValue,
      "the TWO SURFACES AGREE: the settings namespace's resolved value (" + JSON.stringify(observed.mutate?.resolved) + ") equals the value the file on disk carries (" + JSON.stringify(fileValueAtRead) + ")")
    add("W13", observed.mutate?.base === observed.initialValue, "the namespace's BASE is the FILE value " + String(observed.initialValue) + " (" + JSON.stringify(observed.mutate?.base) + "), not the schema default 20000 — §10.1's reason for mpd-config owning the registration, and the falsifier t39 asks for")
  }

  if (mode === "disabled") {
    add("D1", mutateOk, "the settings write still succeeded with the write-back disabled (" + (observed.mutate?.detail ?? "no detail") + ")")
    add("D2", !fileChanged, "the file is BYTE-IDENTICAL with `writeBack: false` composed from a patch layer (A6 negative control)")
    add("D3", structured.some((report) => report.skipped === "disabled"), "the bridge reported skipped:'disabled'")
    add("D4", !reports.some((report) => report.message.includes("not bridged")), "no surface claims the section is unbridged any more")
  }

  if (mode === "ambiguous") {
    add("A1", mutateOk, "the settings write succeeded with two live roots (" + (observed.mutate?.detail ?? "no detail") + ")")
    // The measured pairs viewed as a list: the cast keeps an absent list a runtime failure,
    // exactly as before, instead of silently judging an empty one green.
    add("A2", (observed.files as readonly BridgeFilePair[]).every((entry) => entry.before === entry.after), "NO file changed with two live roots (F5 must-fail-on-fanout)")
    // The bridge's structured refusal, when it reported one.
    const refused = structured.find((report) => report.skipped === "ambiguous-multi-root")
    add("A3", refused !== undefined, "the bridge reported skipped:'ambiguous-multi-root'")
    // The refusal's candidate list as strings, so a match cannot depend on value identity; the
    // cast views the JSON field as the array the bridge documents.
    const named = (((refused?.candidates) as readonly unknown[] | undefined) ?? []).map((entry) => String(entry))
    // Both candidate assertions read the SAME root list; the casts preserve the original failure
    // mode for an absent list rather than substituting an empty one.
    add("A4", (observed.roots as readonly string[]).every((root) => named.includes(root)), "the structured refusal names EVERY candidate root, not a guess (" + JSON.stringify(named) + ")")
    add("A5", (observed.roots as readonly string[]).every((root) => String(observed.log).includes(root)), "the human-readable diagnostic names every candidate too")
  }

  if (mode === "static") {
    // The built TUI bytes, empty when the caller measured none.
    const dist = String(observed.tuiDist ?? "")
    add("S1", dist.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the built TUI bytes carry the bridge disclosure")
    add("S2", dist.includes("after a restart"), "the built TUI bytes carry the restart half of the disclosure")
    add("S3", !dist.includes("not bridged: a save here does not rewrite"), "the old 'not bridged' claim is DELETED from the built TUI bytes")
  }

  return { ok: checks.length > 0 && checks.every((check) => check.ok), checks }
}

// ─────────────────────────────── real run plumbing ───────────────────────────────

/** Sleep helper: the lane polls a boot's log and its files on a wall-clock cadence. */
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A FREE port, so a leftover listener can never turn this lane's real assertions into a
 * confusing `ECONNREFUSED` cascade. MEASURED: a fixed port produced exactly that — the boot
 * died with `EADDRINUSE` while the lane reported "the front door rejected the write".
 * @returns the override port when one is set, else a port the OS just reported as free.
 */
async function freePort(): Promise<number> {
  if (PORT_OVERRIDE !== undefined) return PORT_OVERRIDE
  return await new Promise<number>((resolve, reject) => {
    // A throwaway listener whose only job is to have the OS report a free port.
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      // The bound address; a string only for a pipe or unix socket, never for this TCP probe.
      const address = probe.address()
      // The OS-assigned port, or 0 for an address that carries none.
      const port = typeof address === "object" && address !== null ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** One isolated boot's paths, its extra loader args and the environment its child inherits. */
interface Sandbox {
  /** The sandbox root: the profile tree and the workspaces live under it. */
  sandbox: string
  /** `DSH_HOME` for the boot — never the real home (the builder asserts that). */
  home: string
  /** `HOME` for the boot — never the real home (skill roots leak through HOME). */
  userHome: string
  /** The `dsh --profile w` directory the bundle is symlinked into. */
  profile: string
  /** The extra loader arguments (`--patch <overlay>`), empty unless the scenario composes one. */
  patches: string[]
  /** The child environment: sandboxed `DSH_HOME`/`HOME` plus the mount-root override when set. */
  env: Env
}

/**
 * A fresh sandbox under the OS temp dir, named for its scenario.
 * @param tag - the scenario tag (`main`, `disabled`, …) the temp directory names itself after.
 * @param mountRoot - the workspace the exec-less mount-time root is pinned to, when there is one.
 * @returns the sandbox paths, the extra patch args and the child environment.
 */
function makeSandbox(tag: string, mountRoot?: string): Sandbox {
  return makeSandboxIn(mkdtempSync(join(tmpdir(), "mpd-settings-bridge-" + tag + "-")), tag, mountRoot)
}

/**
 * Build the sandbox INSIDE a caller-chosen skeleton: the web arm needs its two live roots to share
 * one temp parent, and the disabled control needs the write-back-off patch layer.
 * @param sandbox - the sandbox root directory, already created by the caller.
 * @param tag - the scenario tag; `disabled` composes the write-back-off overlay.
 * @param mountRoot - the workspace `DSH_WORKSPACE_ROOT` is pinned to, `undefined` to leave it unset.
 * @returns the sandbox paths, the profile, the extra `--patch` args and the child environment.
 */
function makeSandboxIn(sandbox: string, tag: string, mountRoot?: string): Sandbox {
  // The sandbox `DSH_HOME`: the profile and the session store live under it.
  const home = join(sandbox, "home")
  // The sandbox `HOME` — skill roots leak through HOME, so it must never be the real one.
  const userHome = join(sandbox, "userhome")
  // The profile directory the bundle is linked into (`dsh --profile w`).
  const profile = join(home, "profiles", "w")
  mkdirSync(join(profile, "node_modules", "@mpd-dsh"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  // The REAL credentials file, copied once into the sandbox when it exists.
  const creds = join(homedir(), ".dsh", ".credentials.yaml")
  if (existsSync(creds)) cpSync(creds, join(home, ".credentials.yaml"))
  // The REAL settings file (gateway-provider chains live there), copied when present.
  const settings = join(homedir(), ".dsh", "settings.yaml")
  if (existsSync(settings)) cpSync(settings, join(home, "settings.yaml"))
  symlinkSync(REPO, join(profile, "node_modules", "@mpd-dsh", "mpd"), "junction")
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {}, dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@mpd-dsh/mpd"] } },
  }, null, 2))
  // The extra loader args: only the `disabled` scenario adds an id-targeted patch layer.
  const patches: string[] = []
  if (tag === "disabled") {
    // The A6 lever, composed from THIS layer: the same row the bundle ships, with the
    // write-back switched off. An id-targeted patch UPDATES the row (never duplicates it).
    // The overlay file carrying the `writeBack: false` override for the `mpd-config` row.
    const overlay = join(sandbox, "control-writeback-off.yml")
    writeFileSync(overlay, [
      "- id: mpd-config",
      "  name: '@mpd-dsh/mpd/packages/mpd-config-plugin/dist/index.js'",
      "  config:",
      "    # the design's flat key (§10.2 lever 1); `settingsBridge.writeBack` is also honoured",
      "    writeBack: false",
      "",
    ].join("\n"))
    patches.push("--patch", overlay)
  }
  if (home.startsWith(join(homedir(), ".dsh"))) throw new Error("isolation assertion: DSH_HOME points at the real home")
  // `DSH_WORKSPACE_ROOT` is the documented OPERATOR/QA override for the exec-less root — the
  // adapter's precedence is session cwd > this env > process.cwd(). A plugin row must NEVER set it
  // (AGENTS.md §6); a lane pinning the mount-time root so the file-derived base is witnessable is
  // exactly the sanctioned use, and the real-run note records the limitation it works around:
  // without it, the mount-time root is the process cwd, which no session workspace equals yet.
  // The child environment: sandboxed DSH_HOME + HOME, plus the mount-root override when given.
  const env: Env = { ...process.env, DSH_HOME: home, HOME: userHome, ...(mountRoot === undefined ? {} : { DSH_WORKSPACE_ROOT: mountRoot }) }
  return { sandbox, home, userHome, profile, patches, env }
}

/** One sandbox workspace and the fixture file the write-back must edit inside it. */
interface WorkspaceFixture {
  /** The absolute workspace path the session is created in. */
  ws: string
  /** The absolute `<workspace>/.mpd/mpd.jsonc` the write-back must edit. */
  file: string
}

/**
 * Create one sandbox WORKSPACE holding the fixture file the write-back must edit.
 * @param sandbox - the sandbox the workspace belongs to.
 * @param name - the workspace directory name under the sandbox.
 * @param value - the fixture's initial `hashline.maxDiffChars` value.
 * @returns the workspace path and the fixture file's path.
 */
function workspace(sandbox: Sandbox, name: string, value: number = VALUE_INITIAL): WorkspaceFixture {
  // The workspace directory, created through the shared isolation helper the sessions key on.
  const ws = sandboxWorkspace(sandbox.sandbox, name)
  mkdirSync(join(ws, ".mpd"), { recursive: true })
  // The durable settings file the bridge must rewrite.
  const file = join(ws, ".mpd", "mpd.jsonc")
  writeFileSync(file, fixture(value))
  return { ws, file }
}

/** A booted child, its log reader and the launch credentials the RPC calls reuse. */
interface BootHandle {
  /** The child process, stopped by `stop` once the arm is done with it. */
  child: ChildProcess
  /** Read the boot log as it stands (empty until the child writes its first line). */
  readLog: () => string
  /** The launch token scraped from the log, or `""` when the boot never printed one. */
  token: string
  /** The launch-token cookie the authenticate redirect set, or `""` when it never did. */
  cookie: string
}

/**
 * Boot the bundle in a sandbox and wait until its authenticated root answers.
 * @param sandbox - the sandbox to boot; its `env` becomes the child's environment.
 * @param logPath - the file the child's stdout AND stderr are redirected to (never a pipe).
 * @param port - the port the web app must listen on.
 * @returns the child, its log reader and the launch cookie the RPC calls reuse.
 */
async function boot(sandbox: Sandbox, logPath: string, port: number): Promise<BootHandle> {
  // The inherited log descriptor: stdout AND stderr go to one file, never a pipe (T-24).
  const fd = openSync(logPath, "w")
  // The {command, args} spec for `dsh`, or null when no launcher resolves on this host.
  const childSpec = dshCommand(["--profile", "w", ...sandbox.patches, "--port", String(port), "--no-open"], sandbox.env)
  if (childSpec === null) throw new Error(DSH_MISSING)
  // The boot child itself, with a sandbox cwd so no workspace state can leak into the repo.
  const child = spawn(childSpec.command, childSpec.args, {
    env: sandbox.env, cwd: sandbox.sandbox, stdio: ["ignore", fd, fd],
  })
  // Read the boot log as it stands; a file the child has not created yet reads as empty.
  const readLog = (): string => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  // The launch token scraped from the log's `token=…` line, empty until the boot prints it.
  let token = ""
  // The launch-token cookie the authorize redirect sets, empty until the root answers.
  let cookie = ""
  // The wall-clock deadline for the whole wait loop, two minutes from here.
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await sleep(1500)
    // An early death (a taken port, a bad profile) must be reported as ITSELF, never as a
    // wall of failed front-door assertions.
    const started = readLog()
    if (/EADDRINUSE/.test(started)) throw new Error("the boot could not listen on 127.0.0.1:" + String(port) + " (EADDRINUSE) — another process holds the port; the lane picked " + String(port) + " as free")
    if (child.exitCode !== null && child.exitCode !== undefined && token === "") {
      throw new Error("the boot exited early with code " + String(child.exitCode) + " before serving; log tail: " + started.split("\n").slice(-6).join(" | "))
    }
    // The `token=…` match in the current log, absent until the boot prints it.
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match !== null) token = match[1]
    if (token === "") continue
    try {
      // The authenticate redirect whose Set-Cookie carries the launch cookie.
      const authorize = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(8000) })
      cookie = (authorize.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ") || cookie
      // The same root WITH the cookie: a 200 proves the cookie authorizes the API.
      const root = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie === "" ? {} : { cookie }, signal: AbortSignal.timeout(8000) })
      if (cookie !== "" && root.status === 200) break
    } catch { /* not serving yet */ }
  }
  return { child, readLog, token, cookie }
}

/** The four things a lane ever reads off an RPC answer, each `null` when the answer lacked it. */
interface RpcOutcome {
  /** The HTTP status; 0 when the request never reached the host (a transport failure). */
  status: number
  /** The envelope's `result` payload, or `null` when the answer carried none. */
  result: unknown
  /** The envelope's protocol error, or `null` when the call succeeded. */
  error: unknown
  /** The transport failure the lane synthesised, or `null` when the request was answered. */
  transport: unknown
}

/**
 * One host RPC over the authenticated web API — the same wire call the web section and the TUI
 * section emit. A transport failure is a RESULT, not a throw: the checks report it.
 * @param port - the port the sandboxed web app listens on.
 * @param cookie - the launch cookie, or `""` when the boot never authorized.
 * @param method - the `namespace/verb` method name (`settings/mutate`).
 * @param args - the payload's `args`, of that method's own shape.
 * @param timeout - the abort timeout in milliseconds.
 * @returns status, result, protocol error and transport error, each `null` when absent.
 */
async function rpc(port: number, cookie: string, method: string, args: unknown, timeout: number = 30000): Promise<RpcOutcome> {
  // The per-call correlation id, unique enough for a lane that issues a handful of calls.
  const rpcId = LANE_SLUG + "-" + method.replace("/", "-") + "-" + String(Date.now())
  // The POST reduced to `{status, json}`: a transport failure answers like a status-0 reply.
  const response = await fetch(`http://127.0.0.1:${port}/api/${method.split("/")[0]}/${method.split("/")[1]}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId, method, payload: { args } }),
    signal: AbortSignal.timeout(timeout),
  }).catch((error: unknown) => {
    // The thrown value viewed as the error-like record this detail reads; strict mode makes a
    // rejection `unknown`, and no shape is declared for one (a cast for that reason alone).
    const failure = error as { readonly cause?: { readonly code?: unknown }, readonly message?: unknown } | null | undefined
    return { status: 0, json: async () => ({ transport: String(failure?.cause?.code ?? failure?.message ?? error) }) }
  })
  // The host's own envelope, or an empty object when the body did not parse as JSON.
  const envelope: JsonRecord = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

/**
 * Create one session in a sandbox workspace, through the same authenticated API.
 * @param port - the port the sandboxed web app listens on.
 * @param cookie - the launch cookie, or `""` when the boot never authorized.
 * @param cwd - the SANDBOX workspace the session must run in (never the real repository).
 * @returns status, result, protocol error and transport error, each `null` when absent.
 */
async function createSession(port: number, cookie: string, cwd: string): Promise<RpcOutcome> {
  // The session-create POST reduced to `{status, json}`, so a transport failure reads as status 0.
  const response = await fetch(`http://127.0.0.1:${port}/api/session/create`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie === "" ? {} : { cookie }) },
    body: JSON.stringify({ type: "client-request", rpcId: LANE_SLUG + "-session-" + String(Date.now()), method: "session/create", payload: { args: { request: { cwd, agentPreset: "mpd" } } } }),
    signal: AbortSignal.timeout(90000),
  }).catch((error: unknown) => {
    // The thrown value viewed as the error-like record this detail reads; strict mode makes a
    // rejection `unknown`, and no shape is declared for one (a cast for that reason alone).
    const failure = error as { readonly cause?: { readonly code?: unknown }, readonly message?: unknown } | null | undefined
    return { status: 0, json: async () => ({ transport: String(failure?.cause?.code ?? failure?.message ?? error) }) }
  })
  // The host's own envelope, or an empty object when the body did not parse as JSON.
  const envelope: JsonRecord = await response.json().catch(() => ({}))
  return { status: response.status, result: envelope?.result ?? null, error: envelope?.error ?? null, transport: envelope?.transport ?? null }
}

/**
 * Stop a boot: SIGTERM, a grace period, then SIGKILL. A child that is already gone is not an error.
 * @param child - the boot child to stop.
 */
async function stop(child: ChildProcess): Promise<void> {
  try { child.kill("SIGTERM") } catch { /* already gone */ }
  await sleep(2000)
  try { child.kill("SIGKILL") } catch { /* already gone */ }
}

/**
 * Strip the launch token out of any text bound for an evidence file.
 * @param text - the text to redact.
 * @returns the text with every `token=…` replaced by `token=<redacted>`.
 */
function redact(text: string): string {
  return String(text).replace(/token=[A-Za-z0-9_-]+/g, "token=<redacted>")
}

/**
 * One boot's mutate, reduced to what the engine judges. The host's own descriptor is kept
 * because it is the RESOLVED namespace value — exactly what the mpd config layer merges as
 * its L3 layer, i.e. the value a plugin reads.
 * @param response - the RPC answer to reduce.
 * @param expectedValue - the value the arm wrote (kept so the signature stays symmetric with the
 * judge's expectation).
 * @returns the reduced outcome the assertion engine judges.
 */
function mutateOutcome(response: RpcOutcome, expectedValue: number): MutateOutcome {
  // The RPC envelope is `{ok, value:<namespace descriptor>}` (MEASURED against the host's
  // settings controller); the descriptor is what carries `value`/`user`/`revision`.
  // The envelope as a record: the host's own nesting has no declared type here, so the descriptor
  // is reached through a record view (a cast, since narrowing cannot invent the host's shape).
  const envelope = response?.result as JsonRecord | null | undefined
  // The descriptor the envelope wraps, or the envelope itself when it IS the descriptor.
  const descriptor = (envelope?.value ?? envelope ?? null) as JsonRecord | null
  // The revision the descriptor reported, or `null` when it reported none.
  const revision = descriptor?.revision ?? null
  // The RESOLVED value at the KNOB leaf; the JSON-derived accumulator is indexed through a record
  // view (a cast, because the path is dynamic and no declared shape exists for the descriptor).
  const resolved = KNOB.reduce<unknown>((acc, part) => (acc === null || acc === undefined ? undefined : (acc as JsonRecord)[part]), descriptor?.value)
  // The BASE value at the KNOB leaf — the FILE-derived value the namespace serves (§10.1).
  const base = KNOB.reduce<unknown>((acc, part) => (acc === null || acc === undefined ? undefined : (acc as JsonRecord)[part]), descriptor?.base)
  // The USER section's value at the KNOB leaf — the layer the RPC itself wrote.
  const user = KNOB.reduce<unknown>((acc, part) => (acc === null || acc === undefined ? undefined : (acc as JsonRecord)[part]), descriptor?.user)
  return {
    ok: response?.status === 200 && response?.error === null && response?.transport === null,
    // The lane's own transport field is a string or `null` (a request that never reached the host);
    // the cast restores that type, because every envelope field is `unknown` by design.
    detail: (response?.transport as string | null | undefined) ?? (response?.error === null || response?.error === undefined ? "status " + String(response?.status) + " revision " + String(revision) + " resolved " + JSON.stringify(resolved) : JSON.stringify(response.error)),
    resolved,
    user,
    revision,
    base,
  }
}

/** What the TUI-bytes judge measures: the built dist, the TUI source and the notice sentence. */
export interface TuiSurfaceObserved {
  /** The BUILT TUI bytes the disclosure and notice claims are read from. */
  readonly dist?: string
  /** The TUI source text the one-source-of-truth notice claim is read from. */
  readonly src?: string
  /** The notice sentence the built bytes must carry; defaults to the shipped `TUI_NOTICE`. */
  readonly notice?: string
}

/** The §D.2 runtime notice the TUI prints when a settings save has no live session to write to. */
export const TUI_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/**
 * Judge the TUI surface from the built bytes alone (pure, so the self-test can falsify it).
 * @param observed - the built dist text, the source text and the notice sentence.
 * @returns per-check results and the overall verdict.
 */
export function evaluateTuiSurface(observed: TuiSurfaceObserved): LaneVerdict {
  // The built dist text, empty when the caller measured none.
  const dist = String(observed.dist ?? "")
  // The TUI source text the notice's one-source-of-truth claim is checked against.
  const src = String(observed.src ?? "")
  // The notice sentence under test, defaulting to the shipped constant.
  const notice = String(observed.notice ?? TUI_NOTICE)
  // One entry per check, in the order the checks below produce them.
  const checks: LaneCheck[] = []
  // Record one check: `ok` is coerced, `detail` stringified, so a judge cannot push a non-boolean.
  const add = (id: string, ok: boolean, detail: string): number => checks.push({ id, ok: Boolean(ok), detail: String(detail) })
  add("T1", dist.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the built bytes carry the bridge+restart disclosure")
  add("T2", dist.includes("after a restart"), "the built bytes carry the restart half of the disclosure")
  add("T3", !dist.includes("not bridged: a save here does not rewrite"), "the old 'not bridged' claim is DELETED from the built bytes")
  add("T4", dist.includes(notice), "the built bytes carry the §D.2 no-live-session runtime notice")
  add("T5", dist.includes("NO_LIVE_SESSION_NOTICE") && dist.includes("statusLine("), "the notice is WIRED into the status-line composition, not merely defined")
  add("T6", src.includes(notice), "the notice is a single exported constant in the source (one source of truth)")
  add("T8", dist.includes("never lost") && dist.includes("applies it to every workspace immediately"), "the hint carries the \"never lost\" clause (a settings-only save is not a lost save)")
  // The filesystem-writing APIs the TUI dist must NOT contain (the zero-write invariant).
  const writeApis: readonly string[] = ["writeFileSync", "appendFileSync", "mkdirSync", "cpSync", "rmSync", "unlinkSync", "createWriteStream"]
  // The APIs actually present in the built bytes; a non-empty list reddens T7.
  const offenders = writeApis.filter((api) => dist.includes(api))
  add("T7", offenders.length === 0, "the TUI dist performs ZERO filesystem writes (offenders: " + JSON.stringify(offenders) + ")")
  return { ok: checks.every((check) => check.ok), checks }
}

/** The identity fields every evidence record carries; `writeEvidence` serializes them as JSON. */
export interface EvidenceBase {
  /** The lane slug the evidence directory is named after. */
  slug: string
  /** One sentence naming what this arm drives, for a reader of `result.json`. */
  arm: string
  /** When the run started, ISO-8601 UTC. */
  startedAt: string
  /** The repository root the arm measured (absolute). */
  repo: string
  /** The absolute evidence directory the record and its raw artifacts are written to. */
  outDir: string
}

/** What a TUI-arm run records: the surface it drove, the built-bytes verdict and the paths. */
export interface TuiArmEvidence extends EvidenceBase {
  /** What this arm does and does NOT drive, so the claim cannot be read as broader. */
  surface: {
    /** The artifacts and code paths this arm actually drives. */
    drives: string
    /** Why the keystroke surface is not driven here (a keystroke drive needs a real TTY). */
    tuiKeystrokes: string
    /** Why the rendered web card is not witnessed here (no browser exists in this environment). */
    webCardRendered: string
  }
  /** Whether the arm is green; absent until the arm has judged its artifacts. */
  ok?: boolean
  /** The PREREQ or limitation notes the evidence file carries. */
  notes?: string[]
  /** The checks the built-bytes judge produced, in its own order. */
  checks?: readonly LaneCheck[]
  /** The built TUI artifact, relative to the repository root. */
  distPath?: string
  /** The run's wall-clock duration in milliseconds. */
  elapsedMs?: number
}

/**
 * The TUI arm: what can be witnessed about the TUI half WITHOUT a keystroke drive.
 *   1. the built TUI bytes carry the bridge+restart disclosure and NOT the old claim;
 *   2. the built TUI bytes carry the §D.2 `no-live-session` runtime notice AND the code that
 *      publishes it on the status line (the notice must be reachable, not just defined);
 *   3. the TUI package still performs zero filesystem writes (the invariant the captain
 *      re-checks), read from the built bytes so a source-only claim cannot pass.
 * NOT driven here: TUI keystrokes (`tui-panels` owns that surface) and any rendered card
 * (the card was cut; no browser exists). Both are recorded as NOT-CLAIMED in the result.
 * @param argv - the CLI arguments (`--out <dir>`).
 * @returns the exit code.
 */
export async function runTuiArm(argv: string[]): Promise<number> {
  // Where `--out` sits in the argument vector, or -1 when the caller named no directory.
  const outIndex = argv.indexOf("--out")
  // The evidence directory: the caller's `--out` value, else the arm's own slug under the repo.
  const outDir = outIndex === -1 ? join(REPO, "evidence", "mpd-bridge", TUI_ARM_SLUG, timestamp()) : argv[outIndex + 1]
  // The lane's stdout lines, kept so the evidence file carries the run verbatim.
  const lines: string[] = []
  // Print a line and record it for the evidence file in one step.
  const say = (message: string): void => { lines.push(message); console.log(message) }
  // The wall-clock start, so the evidence records the run's duration.
  const started = Date.now()
  // The built TUI artifact whose bytes are judged (a build product, never a source file).
  const distPath = join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")
  // The evidence record, filled in as the arm progresses.
  const result: TuiArmEvidence = {
    slug: TUI_ARM_SLUG,
    arm: "tui (built bytes: the hint disclosure, the §D.2 runtime notice, zero-write)",
    startedAt: new Date().toISOString(), repo: REPO, outDir,
    surface: {
      drives: "the built TUI bytes + the status-line notice path; NOT TUI keystrokes (tui-panels owns that)",
      tuiKeystrokes: "not-run: a keystroke drive needs a real TTY",
      webCardRendered: "NOT-CLAIMED: the card was cut by the user and no browser exists here",
    },
  }
  if (!existsSync(distPath)) {
    result.ok = false
    result.notes = ["PREREQ absent: packages/mpd-tui-plugin/dist/index.js (build it first)"]
    writeEvidence(outDir, result, lines.join("\n"))
    console.error("[" + TUI_ARM_SLUG + "] SKIP: missing TUI dist build")
    return 2
  }
  // The TUI source file the notice constant must live in (already TypeScript, hence `state.ts`).
  const srcFile = join(REPO, "packages", "mpd-tui-plugin", "src", "state.ts")
  // The pure judgement of the built bytes, the source bytes and the notice sentence.
  const verdict = evaluateTuiSurface({
    dist: readFileSync(distPath, "utf8"),
    src: existsSync(srcFile) ? readFileSync(srcFile, "utf8") : "",
    notice: TUI_NOTICE,
  })
  // The checks, kept in the evidence record so a reviewer reads the same list the lane printed.
  const checks = verdict.checks
  result.checks = checks
  result.ok = checks.every((check) => check.ok)
  result.distPath = relative(REPO, distPath)
  result.elapsedMs = Date.now() - started
  result.notes = [
    "This arm proves the TUI SURFACE (words on screen + the notice path + the zero-write invariant).",
    "It does NOT prove a keystroke edit in /settings (tui-panels drives keystrokes with a real TTY) and it does NOT render a card.",
    "The write path itself is proven by `web-settings-bridge.ts` (the host's own authenticated API), which is the same settings/mutate the TUI section emits.",
  ]
  writeEvidence(outDir, result, lines.join("\n"))
  say("[" + TUI_ARM_SLUG + "] " + checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  say("[" + TUI_ARM_SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " -> " + relative(REPO, outDir))
  return result.ok ? 0 : 1
}

// ──────────────────── the SHIPPED web registration shape (W2) ────────────────────

/**
 * The descriptor the built client hands to the host's `settings.section` LIST slot: the slot name,
 * this section's stable id, its explicit order and the locale namespace its labels resolve through.
 */
const SECTION_DESCRIPTOR = /\{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: \(\) => dicts\.en\.nav, locale: LOCALE_NS, inject: \(\) => controller\.inject\(\) \}/

/**
 * Judge the web registration from the BUILT client bytes (pure, so the self-test and the lane's own
 * negative control can falsify it). The SHIPPED shape is this client's OWN top-level
 * `settings.section` LIST slot — `id "mpd"`, `order 20`, locale `mpdSettings` — because w14/t83 moved
 * the knobs off the Plugins tab's per-namespace `settings.plugin.item` CARD into their own section.
 * The bytes are read from the built/served artifact (the bundle serves `exports["./client"]`), never
 * from a source string, because the built bytes are what a browser actually loads.
 * @param clientBytes - the BUILT client text (`packages/mpd-bundle-plugin/client.js`).
 * @param cardSource - the registration's source text (the disclosure cross-check).
 * @returns per-check results and the overall verdict.
 */
export function evaluateSettingsSectionShape(clientBytes: string | undefined, cardSource: string | undefined): LaneVerdict {
  // The built client bytes, empty when the caller measured none.
  const bytes = String(clientBytes ?? "")
  // The registration's source text, used for the disclosure cross-check only.
  const src = String(cardSource ?? "")
  // Read one `const NAME = value` line out of the built bytes, trimmed for comparison.
  const constant = (name: string): string | undefined => {
    // The first assignment of `name` in the bytes, or null when the client never declares it.
    const match = new RegExp("const " + name + " = ([^\\n]+)").exec(bytes)
    return match === null ? undefined : match[1].trim().replace(/[;,]\s*$/, "")
  }
  // The built client's slot constant value, or `undefined` when it lacks the declaration.
  const slot = constant("SECTION_SLOT")
  // The built client's section-id constant value, or `undefined` when it lacks the declaration.
  const id = constant("SECTION_ID")
  // The built client's section-order constant value, or `undefined` when it lacks the declaration.
  const order = constant("SECTION_ORDER")
  // The built client's locale-namespace constant value, or `undefined` when it lacks it.
  const locale = constant("LOCALE_NS")
  // One entry per check, in the order the checks below produce them.
  const checks: LaneCheck[] = []
  // Record one check: `ok` is coerced, `detail` stringified, so a judge cannot push a non-boolean.
  const add = (checkId: string, ok: boolean, detail: string): number => checks.push({ id: checkId, ok: Boolean(ok), detail: String(detail) })
  add("W2a", bytes.includes("ctx.slots.inject(SECTION_SLOT, function* () {") && SECTION_DESCRIPTOR.test(bytes), "the BUILT client injects the `settings.section` LIST slot and registers the shipped descriptor (name/id/order/label/locale/inject)")
  add("W2b", slot === '"settings.section"' && id === '"mpd"' && order === "20" && locale === '"mpdSettings"', "the built client names the slot " + String(slot) + " with id " + String(id) + ", order " + String(order) + ", locale " + String(locale) + ' (want "settings.section" / "mpd" / 20 / "mpdSettings")')
  add("W2c", bytes.includes('ctx.inject(["settingsScope"]'), "the section's mount is DEFERRED through ctx.inject (never a declared dependency)")
  add("W2d", bytes.includes('const REQUIRED_SERVICES = ["slots", "locale"]') && !bytes.includes('REQUIRED_SERVICES = ["slots", "locale", "settingsScope"]'), "the client still declares only the stable seams")
  add("W2e", src.includes("a save writes <workspace>/.mpd/mpd.jsonc"), "the section's copy is the same disclosure the TUI states")
  add("W2f", !bytes.includes("settings.plugin.item"), "the PRE-MOVE `settings.plugin.item` card slot is ABSENT from the built client (the move to its own section is complete)")
  return { ok: checks.every((check) => check.ok), checks }
}

// ─────────────────────────────── evidence helpers ───────────────────────────────

/**
 * The evidence-directory stamp: ISO-8601 UTC with the punctuation removed, so names sort by time.
 * @returns the timestamp string (`20260928T231455Z`).
 */
function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

/**
 * Write one run's evidence: the record, the lane's own output and the `raw/` directory.
 * @param dir - the evidence directory to create.
 * @param result - the record serialized as `result.json`.
 * @param stdout - the lane's own output, stored as `output.log`.
 * @returns the same directory, so the caller can print a relative path to it.
 */
function writeEvidence(dir: string, result: EvidenceBase, stdout: string): string {
  mkdirSync(join(dir, "raw"), { recursive: true })
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(dir, "output.log"), stdout + "\n")
  return dir
}

// ─────────────────────────────── self-test ───────────────────────────────

/** The mutable fields a bridge-fault injector rewrites on its deep copy of one green artifact. */
interface MutableBridgeObservation {
  /** The mode of the observation the copy came from, so the copy stays judgeable by the engine. */
  mode: string
  /** The front-door outcome the copy carries; a fault may overwrite `resolved`, `user` or `base`. */
  mutate: MutateOutcome
  /** The settings value the copy's mutate was expected to land. */
  expectedValue: number
  /** The file bytes before the mutate, which a fault can assign back to `fileAfter`. */
  fileBefore: string
  /** The file bytes after the mutate — the field most faults rewrite. */
  fileAfter: string
  /** The boot log a fault may truncate or rewrite. */
  log: string
  /** The value the describe surface reported, which a fault can make disagree. */
  describedValue: unknown
  /** The per-root file pairs a fault can change one half of. */
  files: BridgeFilePair[]
  /** The built TUI bytes the `static` mode judges. */
  tuiDist: string
}

/** One injected web-arm fault: the check it must flip, its green source, its mutation, its label. */
type BridgeFault = readonly [id: string, greenName: string, inject: (copy: MutableBridgeObservation) => void, label: string]

/** The mutable fields a TUI-surface fault injector rewrites on its deep copy of the green surface. */
interface MutableTuiObservation {
  /** The built bytes the judge scans. */
  dist: string
  /** The TUI source text the notice-constant check scans. */
  src: string
  /** The notice sentence the built bytes must carry. */
  notice: string
}

/** One injected TUI-surface fault: the check it must flip, its mutation and its label. */
type TuiFault = readonly [id: string, inject: (copy: MutableTuiObservation) => void, label: string]

/** The mutable text pair a built-client shape fault injector rewrites. */
interface MutableClientShape {
  /** The built client bytes the registration checks scan. */
  client: string
  /** The registration's source text the disclosure cross-check scans. */
  cardSource: string
}

/** One injected built-client shape fault: the check it must flip, its mutation and its label. */
type ShapeFault = readonly [id: string, inject: (copy: MutableClientShape) => void, label: string]

/**
 * Falsify every pure judge with its own injected faults, and pass the synthetic green artifacts.
 * @param arm - which arm's slug the banner names (`web` by default, `tui` from the TUI arm).
 * @returns never: it exits the process with 0 (every fault caught) or 1 (a fault stayed invisible).
 */
export function selfTest(arm: string = "web"): void {
  // The accumulated failures; any entry makes the process exit 1.
  const problems: string[] = []
  // The synthetic GREEN artifacts, one per mode, that every injected fault starts from.
  const green: Record<string, BridgeObserved> = {
    write: {
      mode: "write",
      mutate: { ok: true, detail: "status 200 revision 3", resolved: VALUE_WRITE, user: VALUE_WRITE, base: VALUE_INITIAL },
      expectedValue: VALUE_WRITE,
      initialValue: VALUE_INITIAL,
      describedValue: VALUE_WRITE,
      describedBase: VALUE_INITIAL,
      fileBefore: fixture(VALUE_INITIAL),
      fileAfter: fixture(VALUE_WRITE),
      log: 'x\n[mpd-config] settings bridge WROTE: {"writtenTo":["/ws/.mpd/mpd.jsonc"],"skipped":null,"candidates":[],"results":[{"root":"/ws","file":"/ws/.mpd/mpd.jsonc","outcome":"written"}],"applies":"restart","source":"update","revision":3}\n',
    },
    disabled: {
      mode: "disabled",
      mutate: { ok: true, detail: "status 200 revision 4" },
      fileBefore: fixture(VALUE_INITIAL),
      fileAfter: fixture(VALUE_INITIAL),
      log: '[mpd-config] settings bridge: write-back is DISABLED by config (settingsBridge.writeBack=false or MPD_DSH_TUI_SETTINGS_BRIDGE=off) — the settings value took effect, no file was written.\n[mpd-config] settings bridge DISABLED: {"writtenTo":[],"skipped":"disabled","candidates":[],"results":[],"applies":"restart","source":"update","revision":4}\n',
    },
    ambiguous: {
      mode: "ambiguous",
      mutate: { ok: true, detail: "status 200 revision 5" },
      roots: ["/ws1", "/ws2"],
      files: [{ before: fixture(VALUE_WRITE), after: fixture(VALUE_WRITE) }, { before: fixture(VALUE_INITIAL), after: fixture(VALUE_INITIAL) }],
      log: '[mpd-config] settings bridge: saved to settings — NOT written to any file: 2 live workspaces, so the target is ambiguous. Candidates: /ws1, /ws2. Keep one session live, or edit that workspace\'s .mpd/mpd.jsonc directly.\n[mpd-config] settings bridge ambiguous-multi-root: {"writtenTo":[],"skipped":"ambiguous-multi-root","candidates":["/ws1","/ws2"],"results":[],"applies":"restart","source":"update","revision":5}\n',
    },
    static: { mode: "static", tuiDist: "var BRIDGE_DISCLOSURE = \"a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount)\";" },
  }
  // One green artifact per mode, in the object's own insertion order.
  for (const [name, observed] of Object.entries(green)) {
    // The verdict the synthetic green artifact must pass.
    const verdict = evaluateBridge(observed)
    if (!verdict.ok) problems.push("self-test: the synthetic GREEN " + name + " observation must pass, failed: " + JSON.stringify(verdict.checks.filter((check) => !check.ok)))
  }
  // The web-arm faults: the check id each must flip, the green artifact it starts from, its
  // mutation and its label; a fault the judge cannot see fails the self-test.
  const faults: readonly BridgeFault[] = [
    ["W2", "write", (copy) => { copy.fileAfter = copy.fileBefore }, "an unchanged file after an accepted write (F1)"],
    ["W4", "write", (copy) => { copy.fileAfter = copy.fileAfter.replace("// human comment: must survive the write-back", "// gone") }, "a lost comment (F2)"],
    ["W7", "write", (copy) => { copy.log = "no bridge report here at all" }, "a boot log with no bridge report"],
    ["W8", "write", (copy) => { copy.log = copy.log.replace('"source":"update"', '"source":"provider"') }, "a provider echo doing the write-back"],
    ["W9", "write", (copy) => { copy.log = copy.log.replace('"applies":"restart"', '"applies":"immediate"') }, "a wrong applies timing"],
    ["W11", "write", (copy) => { copy.mutate.resolved = 20000 }, "a resolved value the config layer never saw (the file changed but the value did not)"],
    ["W12", "write", (copy) => { copy.mutate.user = undefined }, "an empty user section (nothing for the L3 layer to merge)"],
    ["W15", "write", (copy) => { copy.describedValue = 20000 }, "a describe surface that disagrees with the written value"],
    ["W14", "write", (copy) => { copy.fileAfter = copy.fileAfter.replace(String(copy.expectedValue), "1") }, "a file whose value disagrees with the namespace (the two-surface agreement check)"],
    ["W13", "write", (copy) => { copy.mutate.base = 20000 }, "a base carrying the schema default instead of the file value (§10.1's whole point)"],
    ["D2", "disabled", (copy) => { copy.fileAfter = fixture(VALUE_WRITE) }, "the disabled switch writing anyway (A6)"],
    ["D3", "disabled", (copy) => { copy.log = "no report" }, "a disabled run with no report"],
    ["A2", "ambiguous", (copy) => { copy.files[1].after = fixture(VALUE_AMBIGUOUS) }, "a fan-out to the second root (F5)"],
    ["A3", "ambiguous", (copy) => { copy.log = "no report" }, "an ambiguous run with no refusal report"],
    ["A4", "ambiguous", (copy) => { copy.log = copy.log.replaceAll('"/ws2"', '"/ws-x"') }, "a structured refusal that omits a candidate"],
    ["A5", "ambiguous", (copy) => { copy.log = copy.log.replaceAll("/ws2", "/ws-x") }, "a diagnostic that does not name every candidate"],
    ["S3", "static", (copy) => { copy.tuiDist = "not bridged: a save here does not rewrite .mpd/mpd.jsonc" }, "the stale 'not bridged' claim in the built TUI bytes"],
    ["S1", "static", (copy) => { copy.tuiDist = "nothing to see" }, "a built TUI without the bridge disclosure"],
  ]
  // One fault at a time, each starting from its own deep copy of a green artifact.
  for (const [id, name, inject, label] of faults) {
    // A DEEP copy, so one fault cannot contaminate the next.
    const copy: MutableBridgeObservation = JSON.parse(JSON.stringify(green[name]))
    inject(copy)
    // The verdict of the mutated copy, which must be red AND have flipped `id`.
    const verdict = evaluateBridge(copy)
    // The single check the fault was aimed at, absent when the judge stopped producing it.
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected fault is INVISIBLE to the lane — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected fault left the overall verdict GREEN — " + label)
  }
  // The TUI arm's pure evaluator, falsified with its own injected faults.
  // The synthetic GREEN TUI surface: the built bytes carrying every required sentence.
  const greenTui: TuiSurfaceObserved = { dist: "NO_LIVE_SESSION_NOTICE " + TUI_NOTICE + " a save writes <workspace>/.mpd/mpd.jsonc after a restart never lost applies it to every workspace immediately statusLine( ", src: TUI_NOTICE, notice: TUI_NOTICE }
  // The verdict the synthetic green TUI surface must pass.
  const tuiVerdict = evaluateTuiSurface(greenTui)
  if (!tuiVerdict.ok) problems.push("self-test: the synthetic GREEN TUI surface must pass, failed: " + JSON.stringify(tuiVerdict.checks.filter((check) => !check.ok)))
  // The TUI-arm faults: the check id each must flip, its mutation and its label.
  const tuiFaults: readonly TuiFault[] = [
    ["T1", (copy) => { copy.dist = copy.dist.replace("a save writes <workspace>/.mpd/mpd.jsonc", "nothing") }, "a dist without the disclosure"],
    ["T3", (copy) => { copy.dist = copy.dist + " not bridged: a save here does not rewrite" }, "the stale claim back in the dist"],
    ["T4", (copy) => { copy.dist = copy.dist.replace(TUI_NOTICE, "") }, "a dist without the §D.2 notice"],
    ["T5", (copy) => { copy.dist = copy.dist.replace("statusLine(", "") }, "a notice that is defined but never wired into the status line"],
    ["T6", (copy) => { copy.src = "" }, "a source without the notice constant"],
    ["T7", (copy) => { copy.dist = copy.dist + " writeFileSync(" }, "a TUI dist that writes to the filesystem"],
    ["T8", (copy) => { copy.dist = copy.dist.replace("never lost", "lost") }, "a hint without the never-lost clause"],
  ]
  // One fault at a time, each starting from its own deep copy of the green TUI surface.
  for (const [id, inject, label] of tuiFaults) {
    // A DEEP copy, so one fault cannot contaminate the next.
    const copy: MutableTuiObservation = JSON.parse(JSON.stringify(greenTui))
    inject(copy)
    // The verdict of the mutated copy, which must be red AND have flipped `id`.
    const verdict = evaluateTuiSurface(copy)
    // The single check the fault was aimed at, absent when the judge stopped producing it.
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected TUI fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected TUI fault is INVISIBLE — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected TUI fault left the verdict GREEN — " + label)
  }
  // The W2 arm's own evaluator, falsified against a synthetic GREEN built-client fixture: every
  // injected fault must flip its own check. W2a/W2b are the two checks that were stale (they read
  // the PRE-MOVE `settings.plugin.item` card shape); W2f is the absence half of the same claim.
  // The synthetic GREEN built client: the four constants, the slot injection and the descriptor.
  const greenClient = [
    'const LOCALE_NS = "mpdSettings"',
    'const SECTION_SLOT = "settings.section"',
    'const SECTION_ID = "mpd"',
    'const SECTION_ORDER = 20',
    "ctx.slots.inject(SECTION_SLOT, function* () {",
    "{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },",
    'ctx.inject(["settingsScope"], (scoped) => {',
    'const REQUIRED_SERVICES = ["slots", "locale"]',
  ].join("\n")
  // The section's own disclosure text, as the shipped registration carries it.
  const greenCardSource = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s)"
  // The verdict the synthetic green built-client shape must pass.
  const greenShape = evaluateSettingsSectionShape(greenClient, greenCardSource)
  if (!greenShape.ok) problems.push("self-test: the synthetic GREEN built-client shape must pass, failed: " + JSON.stringify(greenShape.checks.filter((check) => !check.ok)))
  // The built-client faults: the check id each must flip, its mutation and its label.
  const shapeFaults: readonly ShapeFault[] = [
    ["W2a", (copy) => { copy.client = copy.client.replace("{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() },", "{ name: SECTION_SLOT, key: NS, locale: LOCALE_NS, inject: () => controller.inject() },") }, "the PRE-MOVE card descriptor instead of the settings.section one"],
    ["W2b", (copy) => { copy.client = copy.client.replace('const SECTION_SLOT = "settings.section"', 'const SECTION_SLOT = "settings.plugin.item"') }, "a client whose slot is the pre-move `settings.plugin.item`"],
    ["W2b", (copy) => { copy.client = copy.client.replace("const SECTION_ORDER = 20", "const SECTION_ORDER = 15") }, "a client that names the wrong section order"],
    ["W2f", (copy) => { copy.client = copy.client + '\nctx.slots.register({ name: "settings.plugin.item", key: NS }, Card)' }, "the pre-move card slot back in the built client"],
  ]
  // One fault at a time, each starting from a FRESH text pair of the green client.
  for (const [id, inject, label] of shapeFaults) {
    // The mutable text pair the injector rewrites.
    const copy = { client: greenClient, cardSource: greenCardSource }
    inject(copy)
    // The verdict of the mutated pair, which must be red AND have flipped `id`.
    const verdict = evaluateSettingsSectionShape(copy.client, copy.cardSource)
    // The single check the fault was aimed at, absent when the judge stopped producing it.
    const check = verdict.checks.find((entry) => entry.id === id)
    if (check === undefined) problems.push("self-test: injected client-shape fault " + label + " has no check " + id)
    else if (check.ok) problems.push("self-test: injected client-shape fault is INVISIBLE — " + label + " did not flip " + id)
    if (verdict.ok) problems.push("self-test: injected client-shape fault left the verdict GREEN — " + label)
  }
  // The slug the failure banner and the closing line name.
  const armSlug = arm === "tui" ? TUI_ARM_SLUG : WEB_ARM_SLUG
  if (problems.length > 0) {
    console.error("[" + armSlug + " self-test] FAIL:")
    // One line per failure, so the log names every fault the judges could not see.
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + armSlug + " self-test] ok: " + String(faults.length) + " web-arm + " + String(tuiFaults.length) + " TUI-arm + " + String(shapeFaults.length) + " client-shape injected faults each flip their own check; all three synthetic green artifacts pass")
  process.exit(0)
}

// ─────────────────────────────── the real run ───────────────────────────────

/** What a web-arm run records about its own isolation: the sandbox roots it booted in. */
export interface WebArmIsolation {
  /** The sandbox `DSH_HOME` the boots used; optional because the record literal starts empty. */
  dshHome?: string
  /** The sandbox `HOME` the boots used (never the real home). */
  home?: string
  /** The sandbox root the profile and the workspaces live under. */
  sandbox?: string
  /** Whether the session-store isolation assertion held; set once the main boot is stopped. */
  sessionsSandboxed?: boolean
}

/** What a web-arm run claims its surface drives, stated so the claim cannot be read as broader. */
export interface WebArmSurface {
  /** The wire call this arm actually drives (the host's own authenticated RPC). */
  drives: string
  /** Why the keystroke surface is not driven here (a keystroke drive needs a real TTY). */
  tuiKeystrokes: string
  /** Why the rendered web surface is not witnessed here (no browser exists here). */
  webCardRendered: string
  /** The built TUI artifact the static checks scan, recorded once the arm knows it. */
  tuiDistScanned?: string
}

/** The recorded W2 pre-move-card control: what was mutated, what flipped and whether it landed. */
export interface SectionShapeControl {
  /** One sentence naming the mutation this control injects. */
  control: string
  /** Whether the injection changed the real built bytes; a control that did not land is VOID. */
  mutationLanded: boolean
  /** The check ids the control requires to redden. */
  flippedChecks: readonly string[]
  /** Whether those checks reddened (true) or the control is void (false). */
  verdictGoesRed: boolean
  /** The green reading's checks, kept so a reviewer compares both readings. */
  greenChecks: readonly LaneCheck[]
  /** The mutated reading's checks, kept so a reviewer compares both readings. */
  redChecks: readonly LaneCheck[]
}

/** The negative controls a web-arm run records; each field is filled in when its control runs. */
export interface WebArmControls {
  /** The W2 built-client control, recorded once the pre-move shape has been re-injected. */
  sectionShape?: SectionShapeControl
  /** One sentence naming the injected engine fault, recorded with that fault's verdict. */
  injectedFault?: string
  /** Whether the injected engine fault turned the verdict red. */
  verdictGoesRed?: boolean
  /** The checks of the injected-fault run. */
  checks?: readonly LaneCheck[]
}

/** The W2/W3 section claims a web-arm run records. */
export interface WebArmSectionClaim {
  /** The built-client registration claim: the shape, its checks and the artifact fingerprint. */
  readonly W2: {
    /** Whether every W2 check held on the real built bytes. */
    readonly witnessed: boolean
    /** The SHIPPED registration shape the checks assert, in one sentence. */
    readonly shape: string
    /** The W2 checks as measured. */
    readonly checks: readonly LaneCheck[]
    /** The fingerprint of the artifact those checks read. */
    readonly artifact: {
      /** The artifact's repository-relative path. */
      readonly path: string
      /** The artifact's size in bytes. */
      readonly bytes: number
      /** The artifact's sha256, so a reviewer can pin the bytes that were judged. */
      readonly sha256: string
    }
  }
  /** The rendered-surface claim, recorded NOT-CLAIMED because no browser exists here. */
  readonly W3: {
    /** Always false in this environment: the render check is the user's own GUI. */
    readonly witnessed: boolean
    /** The claim text, stating why it is not claimed. */
    readonly claim: string
  }
}

/** The complete evidence record a web-arm run writes as `result.json`. */
export interface WebArmEvidence extends EvidenceBase {
  /** The sandbox roots the run booted in. */
  isolation: WebArmIsolation
  /** The per-scenario boot measurements, keyed by scenario (`write`, `ambiguous`, `disabled`). */
  boots: Record<string, unknown>
  /** The per-mode verdicts, keyed by mode. */
  verdicts: Record<string, LaneVerdict>
  /** The recorded negative controls. */
  controls: WebArmControls
  /** The W2/W3 section claims, recorded once the built client has been read. */
  sectionClaim?: WebArmSectionClaim
  /** The measured ports, keyed by scenario, recorded once the first boot has a port. */
  ports?: Record<string, number>
  /** The run's honesty notes: what it proves and what it does not. */
  notes: string[]
  /** What the run drove and what it did not. */
  surface: WebArmSurface
  /** Whether the whole run is green; set once every verdict and control has been read. */
  ok?: boolean
  /** The run's wall-clock duration in milliseconds. */
  elapsedMs?: number
}

/**
 * The web arm's real run: two boots (the write/ambiguity arm and the A6 disabled control), the W2
 * built-client control and the recorded injected-fault control, all in isolated sandboxes.
 * @param argv - the CLI arguments (`--out <dir>`, `--keep`).
 * @returns the exit code: 2 when a PREREQ artifact is missing, 1 when a verdict is red, else 0.
 */
export async function runWebArm(argv: string[]): Promise<number> {
  // Where `--out` sits in the argument vector, or -1 when the caller named no directory.
  const outIndex = argv.indexOf("--out")
  // The evidence directory: the caller's `--out` value, else the arm's own slug under the repo.
  const outDir = outIndex === -1 ? join(REPO, "evidence", "mpd-bridge", WEB_ARM_SLUG, timestamp()) : argv[outIndex + 1]
  // Whether the sandbox skeletons are KEPT for a follow-up look (default: removed at the end).
  const keep = argv.includes("--keep")
  // The lane's stdout lines, kept so the evidence file carries the run verbatim.
  const lines: string[] = []
  // Print a line and record it for the evidence file in one step.
  const say = (message: string): void => { lines.push(message); console.log(message) }
  // The wall-clock start, so the evidence records the run's duration.
  const started = Date.now()
  // The evidence record, filled in as the run progresses.
  const result: WebArmEvidence = {
    slug: WEB_ARM_SLUG, arm: "web (the HOST's own authenticated API: launch-token cookie + settings/mutate)",
    startedAt: new Date().toISOString(), repo: REPO, outDir,
    isolation: {}, boots: {}, verdicts: {}, controls: {}, notes: [], surface: {
      drives: "the host's own settings/mutate RPC (the same wire call the card and the TUI section emit)",
      tuiKeystrokes: "not-run: a keystroke drive needs a real TTY; tui-panels owns that surface",
      webCardRendered: "NOT-CLAIMED: no browser binary exists in this environment — the user's own GUI is the render check",
    },
  }

  if (!existsSync(join(REPO, "packages", "mpd-config-plugin", "dist", "index.js"))) {
    result.notes.push("PREREQ absent: packages/mpd-config-plugin/dist/index.js (build it first)")
    writeEvidence(outDir, result, lines.join("\n"))
    console.error("[" + LANE_SLUG + "] SKIP: missing dist build")
    return 2
  }
  result.surface.tuiDistScanned = "packages/mpd-tui-plugin/dist/index.js"
  // W2 — the settings SECTION's registration in the BUILT and SERVED client (the bundle serves
  // exports["./client"]). The shape asserted is the SHIPPED one: this client's own top-level
  // `settings.section` LIST slot (`id "mpd"`, `order 20`, locale `mpdSettings`).
  // The BUILT client the bundle serves through `exports["./client"]` (a build product).
  const clientPath = join(REPO, "packages", "mpd-bundle-plugin", "client.js")
  // The registration's own source file, read for the disclosure cross-check; this wave renames
  // the package's `src/*.js` sources to `.ts`, so the path names the converted source.
  const cardSourcePath = join(REPO, "packages", "mpd-bundle-plugin", "src", "settings-card.ts")
  // The built client bytes, empty when the artifact has not been built yet.
  const clientBytes = existsSync(clientPath) ? readFileSync(clientPath, "utf8") : ""
  // The registration source text, empty when that source file is absent.
  const cardSource = existsSync(cardSourcePath) ? readFileSync(cardSourcePath, "utf8") : ""
  // The W2 checks as measured on the REAL built bytes (the control's green reading).
  const w2Checks = evaluateSettingsSectionShape(clientBytes, cardSource).checks
  // THE NEGATIVE CONTROL for W2: re-inject the PRE-MOVE card shape into the REAL built bytes and
  // require the SAME checks to redden. A control whose mutation does not land is VOID, so the
  // replacement is asserted to have changed the bytes (else the whole verdict fails below).
  // The built bytes with the PRE-MOVE card registration re-injected (the mutated reading).
  const preMoveBytes = clientBytes
    .replace('const SECTION_SLOT = "settings.section"', 'const SECTION_SLOT = "settings.plugin.item"')
    .replace("{ name: SECTION_SLOT, id: SECTION_ID, order: SECTION_ORDER, label: () => dicts.en.nav, locale: LOCALE_NS, inject: () => controller.inject() }", "{ name: SECTION_SLOT, key: NS, locale: LOCALE_NS, inject: () => controller.inject() }")
  // The mutated reading's checks; W2a and W2b must redden here.
  const preMoveChecks = evaluateSettingsSectionShape(preMoveBytes, cardSource).checks
  // Whether the injection actually changed the bytes: a mutation that does not land is VOID.
  const controlMoved = preMoveBytes !== clientBytes
  // The two checks the control requires to flip from ok to not-ok.
  const flipped: readonly string[] = ["W2a", "W2b"]
  // The control's own verdict: the mutation landed AND both checks changed sides.
  const controlReddened = controlMoved && flipped.every((checkId) => w2Checks.find((check) => check.id === checkId)?.ok === true && preMoveChecks.find((check) => check.id === checkId)?.ok === false)
  // The W2 control object, named once: the run's final verdict and the raw control file read it
  // after `result.controls` has been re-assigned, where the optional field would read `undefined`.
  const sectionShapeControl: SectionShapeControl = {
    control: "the PRE-MOVE `settings.plugin.item` card registration re-injected into the REAL built client bytes (the defect this lane was red on)",
    mutationLanded: controlMoved,
    flippedChecks: flipped,
    verdictGoesRed: controlReddened,
    greenChecks: w2Checks,
    redChecks: preMoveChecks,
  }
  result.controls.sectionShape = sectionShapeControl
  say("[negative control/card-shape] pre-move card shape re-injected into the built client -> " + (controlReddened ? "W2a/W2b red as required" : "CONTROL VOID (did not redden)") + " mutationLanded=" + String(controlMoved))

  // W3 is NOT witnessed: no browser exists here. Recorded, never implied.
  result.sectionClaim = {
    W2: { witnessed: w2Checks.every((check) => check.ok), shape: "the client's own top-level `settings.section` LIST slot (id \"mpd\", order 20, locale \"mpdSettings\")", checks: w2Checks, artifact: { path: "packages/mpd-bundle-plugin/client.js", bytes: Buffer.byteLength(clientBytes), sha256: createHash("sha256").update(clientBytes).digest("hex") } },
    W3: { witnessed: false, claim: "NOT-CLAIMED: no browser binary exists in this environment, so the rendered settings SECTION and a click that produces the mutate are the user's own GUI check" },
  }
  say("[card] " + w2Checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" ") + " | W3 NOT-CLAIMED (no browser)")
  // The built TUI bytes the static checks scan, empty when the TUI has not been built.
  const tuiDist = existsSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")) ? readFileSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"), "utf8") : ""
  // The static checks over those bytes: the shipped disclosure present, the stale claim absent.
  const staticVerdict = evaluateBridge({ mode: "static", tuiDist })
  result.verdicts.static = staticVerdict
  say("[static] " + staticVerdict.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))

  // ── boot 1: one live root (write) then two live roots (refusal) ──
  // The shared temp parent the arm's own two live roots live under.
  const mainSkeleton = mkdtempSync(join(tmpdir(), "mpd-settings-bridge-root-"))
  // The main sandbox: no patch layer, so the SHIPPED write-back path is the one under test.
  const main = makeSandboxIn(mainSkeleton, "main")
  result.isolation = { dshHome: main.home, home: main.userHome, sandbox: main.sandbox }
  // The FIRST live root: the workspace the write arm's session runs in.
  const one = workspace(main, "ws-one")
  // The SECOND live root: created now so the ambiguity arm only has to add its session.
  const two = workspace(main, "ws-two")
  // pin the mount-time root to the workspace the lane will create its session in
  main.env.DSH_WORKSPACE_ROOT = one.ws
  // The main boot's log file, inside the evidence directory's raw half.
  const logMain = join(outDir, "raw", "boot-main.log")
  mkdirSync(join(outDir, "raw"), { recursive: true })
  // A currently-free port for the main boot (a fixed port is what produced EADDRINUSE before).
  const PORT_MAIN = await freePort()
  result.ports = { main: PORT_MAIN }
  say("[boot] main: " + main.sandbox + " (port " + String(PORT_MAIN) + ")")
  // The main boot, awaited until its authenticated root answers.
  const mainBoot = await boot(main, logMain, PORT_MAIN)
  say("[boot] cookie=" + (mainBoot.cookie === "" ? "NONE" : "present") + " log=" + relative(REPO, logMain))

  // The session that makes `one.ws` a LIVE root for the bridge.
  const sessionOne = await createSession(PORT_MAIN, mainBoot.cookie, one.ws)
  say("[session] one: status=" + String(sessionOne.status) + " transport=" + String(sessionOne.transport ?? "none"))
  await sleep(3000)

  // The target file's bytes before the accepted write (compared with `afterWrite`).
  const beforeWrite = readFileSync(one.file, "utf8")
  // The front-door write of VALUE_WRITE at the KNOB path, over the host's own RPC.
  const mutateOne = await rpc(PORT_MAIN, mainBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_WRITE }] })
  say("[mutate] one root: status=" + String(mutateOne.status) + " " + JSON.stringify(mutateOne.error ?? mutateOne.result ?? mutateOne.transport ?? {}))
  await sleep(2500)
  // The same file's bytes after the mutate settled (the sleep above is that settle window).
  const afterWrite = readFileSync(one.file, "utf8")
  // ── THE AUTHORITATIVE READ-BACK SURFACE, named and exercised directly ──
  // `settings/describe` is the namespace's own read surface — the same one the Web card and the TUI
  // screen go through; the mutation response is derived from it. Reading it explicitly means a
  // reviewer can see WHICH surface the resolved value came from, and W14/W15 assert it AGREES with
  // the durable file.
  // The authoritative read-back surface's answer, read explicitly rather than inferred.
  const describeCall = await rpc(PORT_MAIN, mainBoot.cookie, "settings/describe", {})
  // The `mpd` namespace descriptor inside that answer, wherever the host nested it.
  const mpdDescriptor = findNamespaceDescriptor(describeCall.result, NS)
  // A one-token description of the answer's own shape, recorded so a reviewer sees the envelope.
  // The last branch sees a non-array, non-null JSON value, so it is viewed as a record to list its
  // keys (a cast; the original expression's shape is preserved exactly).
  const describeShape = describeCall.result === null || describeCall.result === undefined ? "null" : (Array.isArray(describeCall.result) ? "array[" + String(describeCall.result.length) + "]" : Object.keys(describeCall.result as JsonRecord).join(","))
  // The resolved value the describe surface reported, walked through the KNOB path; the
  // JSON-derived accumulator is indexed through a record view (a cast, as no shape is declared).
  const described = KNOB.reduce<unknown>((acc, part) => (acc === null || acc === undefined ? undefined : (acc as JsonRecord)[part]), mpdDescriptor?.value)
  say("[read-back] settings/describe: status=" + String(describeCall.status) + " envelope=" + describeShape + " ns=" + String(mpdDescriptor?.ns ?? "MISSING") + " resolved=" + JSON.stringify(described) + " base=" + JSON.stringify(mpdDescriptor?.base))
  // This boot's measured facts, in exactly the shape the assertion engine judges.
  const writeObserved: BridgeObserved = {
    describedValue: described,
    describedBase: mpdDescriptor?.base,
    mode: "write",
    mutate: mutateOutcome(mutateOne, VALUE_WRITE),
    expectedValue: VALUE_WRITE,
    initialValue: VALUE_INITIAL,
    fileBefore: beforeWrite,
    fileAfter: afterWrite,
    log: mainBoot.readLog(),
  }
  result.boots.write = { file: one.file, value: VALUE_WRITE, initialValue: VALUE_INITIAL, fileBefore: beforeWrite, fileAfter: afterWrite, mutate: mutateOne.result, describeStatus: describeCall.status, describeEnvelope: describeShape, describeNamespace: mpdDescriptor?.ns }
  result.verdicts.write = evaluateBridge(writeObserved)
  say("[write] " + result.verdicts.write.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))

  // second live root -> the target becomes ambiguous and NOTHING may be written
  const sessionTwo = await createSession(PORT_MAIN, mainBoot.cookie, two.ws)
  say("[session] two: status=" + String(sessionTwo.status) + " transport=" + String(sessionTwo.transport ?? "none"))
  await sleep(3000)
  // The FIRST root's file bytes before the ambiguous mutate, so A2 can prove no write landed.
  const oneBefore = readFileSync(one.file, "utf8")
  // The SECOND root's file bytes before the same mutate, measured for the same A2 comparison.
  const twoBefore = readFileSync(two.file, "utf8")
  // The mutate issued while TWO roots are live: it must be refused with both candidates named.
  const mutateTwo = await rpc(PORT_MAIN, mainBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_AMBIGUOUS }] })
  say("[mutate] two roots: status=" + String(mutateTwo.status) + " " + JSON.stringify(mutateTwo.error ?? mutateTwo.transport ?? "ok"))
  await sleep(2500)
  // The second measurement's facts: two live roots, one measured file pair each.
  const ambiguousObserved: BridgeObserved = {
    mode: "ambiguous",
    mutate: mutateOutcome(mutateTwo, VALUE_AMBIGUOUS),
    roots: [one.ws, two.ws],
    files: [{ before: oneBefore, after: readFileSync(one.file, "utf8") }, { before: twoBefore, after: readFileSync(two.file, "utf8") }],
    log: mainBoot.readLog(),
  }
  result.boots.ambiguous = { roots: [one.ws, two.ws], files: ambiguousObserved.files, mutate: mutateTwo.result }
  result.verdicts.ambiguous = evaluateBridge(ambiguousObserved)
  say("[ambiguous] " + result.verdicts.ambiguous.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  await stop(mainBoot.child)
  writeFileSync(join(outDir, "raw", "boot-main.log"), redact(mainBoot.readLog()))
  try {
    assertSessionsSandboxed(main.home, main.sandbox, { label: LANE_SLUG })
    result.isolation.sessionsSandboxed = true
  } catch (error) {
    result.isolation.sessionsSandboxed = false
    // A thrown value is `unknown` under strict mode; it is viewed as an error-like record so a
    // plain-object throw still reports its own `.message`, exactly as that expression did before.
    const failure = error as { readonly message?: unknown } | null | undefined
    result.notes.push("workspace isolation assertion failed: " + String(failure?.message ?? error))
  }

  // ── boot 2: the A6 negative control (write-back disabled from the composition) ──
  // The A6 control's sandbox: the write-back is switched off by a composed patch layer.
  const control = makeSandbox("disabled")
  // The control's own live root, carrying the same fixture the write arm uses.
  const controlWs = workspace(control, "ws-one")
  // The control boot's log file, inside the evidence directory's raw half.
  const logControl = join(outDir, "raw", "boot-disabled.log")
  // A currently-free port for the control boot.
  const PORT_CONTROL = await freePort()
  result.ports.control = PORT_CONTROL
  say("[boot] disabled control: " + control.sandbox + " (port " + String(PORT_CONTROL) + ")")
  // The control boot, awaited until its authenticated root answers.
  const controlBoot = await boot(control, logControl, PORT_CONTROL)
  // The session that makes the control's workspace a live root.
  const controlSession = await createSession(PORT_CONTROL, controlBoot.cookie, controlWs.ws)
  say("[session] disabled control: status=" + String(controlSession.status) + " transport=" + String(controlSession.transport ?? "none"))
  await sleep(3000)
  // The control file's bytes before the write (A6 requires they never change).
  const controlBefore = readFileSync(controlWs.file, "utf8")
  // The same front-door write, which must SUCCEED while the file stays byte-identical.
  const mutateControl = await rpc(PORT_CONTROL, controlBoot.cookie, "settings/mutate", { ns: NS, ops: [{ op: "set", path: KNOB, value: VALUE_WRITE }] })
  say("[mutate] disabled control: status=" + String(mutateControl.status) + " " + JSON.stringify(mutateControl.error ?? mutateControl.transport ?? "ok"))
  await sleep(2500)
  // The control file's bytes after the mutate settled (compared with `controlBefore`).
  const controlAfter = readFileSync(controlWs.file, "utf8")
  result.boots.disabled = { file: controlWs.file, fileBefore: controlBefore, fileAfter: controlAfter, mutate: mutateControl.result }
  result.verdicts.disabled = evaluateBridge({ mode: "disabled", mutate: mutateOutcome(mutateControl, VALUE_WRITE), fileBefore: controlBefore, fileAfter: controlAfter, log: controlBoot.readLog() })
  say("[disabled] " + result.verdicts.disabled.checks.map((check) => check.id + (check.ok ? "=ok" : "=FAIL")).join(" "))
  await stop(controlBoot.child)
  writeFileSync(join(outDir, "raw", "boot-disabled.log"), redact(controlBoot.readLog()))

  // ── the recorded negative control: the engine must go RED on an injected fault ──
  // A deep copy of the ambiguous reading, mutated below into the recorded injected fault.
  const controlCopy: MutableBridgeObservation = JSON.parse(JSON.stringify(ambiguousObserved))
  controlCopy.files[1].after = fixture(VALUE_AMBIGUOUS)
  // The mutated copy's verdict, which must be RED: a green control would be a void control.
  const controlVerdict = evaluateBridge(controlCopy)
  result.controls = {
    ...result.controls,
    injectedFault: "the second live root's file changed (a fan-out)",
    verdictGoesRed: controlVerdict.ok === false,
    checks: controlVerdict.checks,
  }
  say("[negative control] injected fan-out fault -> verdict " + (controlVerdict.ok ? "GREEN (INVALID)" : "red as required"))

  // Every verdict of the run plus the static one, aggregated into the run's own answer.
  const allVerdicts = [result.verdicts.write, result.verdicts.ambiguous, result.verdicts.disabled, staticVerdict]
  result.ok = allVerdicts.every((verdict) => verdict.ok) && w2Checks.every((check) => check.ok) && result.controls.verdictGoesRed === true && sectionShapeControl.verdictGoesRed === true && result.isolation.sessionsSandboxed === true
  result.elapsedMs = Date.now() - started
  result.notes.push("A green run proves: the front door accepted the write, the ONE live workspace file changed with comments/order intact, the log reported writtenTo + applies:'restart', two live roots refused with both candidates and wrote nothing, and the writeBack:false composition left the file byte-identical.")
  result.notes.push("It does NOT prove: the TUI keystroke path (not driven here — no TTY) or the RENDERED web surface (no browser; W3 NOT-CLAIMED). It DOES prove W2: the built/served client mounts its own top-level `settings.section` LIST slot (id \"mpd\", order 20, locale \"mpdSettings\") for namespace `mpd`, with the mount deferred behind ctx.inject, and the pre-move `settings.plugin.item` card slot is GONE.")
  result.notes.push("The W2 checks carry their own measured negative control: the PRE-MOVE card registration is re-injected into the REAL built bytes and W2a/W2b must redden (controls.sectionShape.redChecks); a mutation that does not land is recorded as void and fails the run.")
  // The RAW lane stdout and the raw control reading, next to result.json + output.log.
  writeFileSync(join(outDir, "raw", "lane-output.txt"), lines.join("\n") + "\n")
  writeFileSync(join(outDir, "raw", "card-shape-control.json"), JSON.stringify({ control: sectionShapeControl.control, mutationLanded: sectionShapeControl.mutationLanded, flippedChecks: sectionShapeControl.flippedChecks, greenChecks: sectionShapeControl.greenChecks, redChecks: sectionShapeControl.redChecks }, null, 2) + "\n")
  writeEvidence(outDir, result, lines.join("\n"))
  say("[" + LANE_SLUG + "] " + (result.ok ? "PASS" : "FAIL") + " -> " + relative(REPO, outDir))
  if (!keep) {
    // One sandbox skeleton per boot; each is removed unless `--keep` asked for it.
    for (const dir of [main.sandbox, control.sandbox]) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
    }
  }
  return result.ok ? 0 : 1
}
