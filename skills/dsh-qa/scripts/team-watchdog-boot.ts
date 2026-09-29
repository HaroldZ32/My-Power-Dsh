#!/usr/bin/env node
// Case team-watchdog-boot — the REAL-dsh boot lane for the team watchdog.
//
// WHY THIS LANE EXISTS (the wave's most severe defect, measured 2026-09-16): the watchdog's
// `agent/pre-step` listener was written `(payload) => this.stamp("step", …)`. `agent/pre-step`
// is a CORDIS WATERFALL: a listener that returns without calling `next()` VETOES the rest of the
// chain and its own return value BECOMES the step decision. The stamp (an object with no
// `messages`) replaced `{kind:'enter', messages}`, so EVERY turn of EVERY mpd session in the
// process died ≈120 ms after `turn/start`, before the model call, with
// `Cannot read properties of undefined (reading 'map'|'findLastIndex'|'length')`.
//
// Every other `team-watchdog-*.ts` lane drives the BUILT MODULES in-process and never spawns a
// real `dsh`, so no lane exercised a harness turn with the row mounted. This one does: it boots
// a REAL dev-web dsh in a sandbox (bundles base + web-app + the bundle under test), creates a
// session on `agentPreset: "mpd"`, sends one prompt, and reads the verdict from the HARNESS's own
// session log (the concatenated-zstd store, via `lib/session-evidence.ts` — never from prose).
//
// THREE OUTCOMES, distinguished and asserted (never narrated):
//   * `completed`   — at least one turn/end with an assistant message: the full round trip works.
//   * `model-error` — a turn/end whose reason is a MODEL-level error (missing credential, provider
//                     failure). The turn REACHED the model call, so the pre-step veto is gone:
//                     PASSED FOR THIS INVARIANT, and explicitly NOT a completed turn.
//   * `veto`        — a turn/end carrying the veto signature: FAIL. This is the defect.
//   * `no-turn`     — no turn/end at all: FAIL (the machinery did not survive the row, or the
//                     prompt never reached the loop).
//
// HEAVY: the real run spawns `dsh` and makes a live model call (tens of seconds). Only the offline
// `--self-test` is part of the swept `bun run test:qa`; the real run is a deliberate, manual case.
//
// Usage:
//   bun skills/dsh-qa/scripts/team-watchdog-boot.ts --self-test     # offline, fast, no dsh
//   bun skills/dsh-qa/scripts/team-watchdog-boot.ts [--out <dir>]   # REAL boot (heavy)
// Evidence -> evidence/team-watchdog/boot/<timestamp>/{result.json,output.log,raw/boot.log}
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { createServer } from "node:net"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { decodeSessionLog } from "./lib/session-evidence.ts"
import { exitOnRefusal, refuseOverwrite } from "./lib/immutable-output.ts"
import { DSH_MISSING, dshCommand } from "./lib/dsh-launcher.ts"
import type { LaneCheck, LaneVerdict } from "./lib/watchdog-lane.ts"

/** This script's own directory, from which the repository root is derived. */
const HERE: string = dirname(fileURLToPath(import.meta.url))
/** The repository root, three directories above `skills/dsh-qa/scripts`. */
const REPO: string = resolve(HERE, "..", "..", "..")
/** The lane slug, used to name the evidence directory and to prefix every printed line. */
const SLUG: string = "team-watchdog-boot"
/** The row's own apply line (watchdog package §index.ts `warn(...)`). */
const ROW_MARKER: RegExp = /\[mpd-team-watchdog\] applied:\s*enabled=(\w+).*disposers=(\d+)\s*holdService=(\w+)/
/** The defect's signature, as the harness recorded it. */
const VETO: RegExp = /Cannot read properties of undefined \(reading '(map|findLastIndex|length)'\)/
/** Model-level failures that still prove the turn reached the model call. */
const MODEL_ERROR: RegExp = /MISSING_CREDENTIAL|no API key|provider route|ECONNREFUSED|ETIMEDOUT|fetch failed|rate limit|insufficient/i
/** The one prompt this lane sends; a completed turn must carry its exact echo. */
const PROMPT: string = "Reply with exactly: watchdog-pre-step-ok"
/** Wall-clock sleep, used for the token/settle deadlines (the lane never waits on a stream). */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One JSON-RPC response the sandbox host answered: the status plus the raw body. */
interface RpcResponse {
  /** The HTTP status the host answered with. */
  readonly status: number
  /** The raw response body, from which the requested fields are read. */
  readonly body: string
}

/** One serving of our own client entry, as the GUI-activation leg fetched it. */
interface ClientRouteReading {
  /** The served entry URL that answered, or `undefined` while none has. */
  url: string | undefined
  /** The HTTP status of the most recent fetch of that URL, or `null` before any fetch. */
  status: number | null
  /** The body's length in bytes; the SHORTEST 200 response wins (that is the un-combined entry). */
  bytes: number
  /** The served body itself, from which the tab-id and bridge markers are read. */
  body: string
  /** The fetch failure text when the served client could not be read at all. */
  error?: string
  /** The HTTP status of the served index page. */
  indexStatus?: number
  /** How many client URLs the index advertised. */
  discovered?: number
  /** Every client URL the index advertised (truncated when persisted). */
  discoveredUrls?: string[]
  /** The advertised URLs whose decoded path names our own `@mpd-dsh/mpd` entry. */
  ours?: string[]
}

/** The user's own composition as this lane mirrored it into the sandbox. */
interface CompositionReading {
  /** Every bundle name the user's web profile runs, in manifest order. */
  readonly declared: readonly string[]
  /** The entries symlinked into the sandbox profile, each recorded with its source. */
  readonly mirrored: readonly string[]
  /** The entries the user's profile does not resolve — recorded, never silently dropped. */
  readonly unresolved: readonly string[]
}

/** Everything this lane decides from: the boot log plus the harness's own session store. */
interface BootObservation {
  /** The watchdog row's apply line, trimmed, or `""` when the boot printed none. */
  readonly rowLine: string
  /** The preset the session was created on, or `null` when the host reported none. */
  readonly preset: string | null
  /** Whether `session/create` answered `"ok":true`. */
  readonly createOk: boolean
  /** Whether `session/prompt` answered `"accepted":true`. */
  readonly promptAccepted: boolean
  /** The credential/settings file names the sandbox home actually received. */
  readonly copied: string[]
  /** Whether `settings.yaml` was among them (the live-LLM prerequisite). */
  readonly settingsPresent: boolean
  /** The terminal-only activation-failure line, or `undefined` when the boot printed none. */
  readonly activationLine: string | undefined
  /** The served-client reading of the GUI-activation leg. */
  readonly clientRoute: ClientRouteReading
  /** The user composition the boot mirrored. */
  readonly composition: CompositionReading
  /** Every `turn/end` line of every session log under the sandbox home. */
  readonly turnEnds: string[]
  /** Every `assistant/message` line of every session log under the sandbox home. */
  readonly assistantMessages: string[]
}

/** The boot lane's verdict: the shared verdict shape plus the outcome it was derived from. */
interface BootVerdict extends LaneVerdict {
  /** Exactly one of `completed`, `model-error`, `veto`, `no-turn`. */
  readonly outcome: string
  /** The one-line reason printed beside the outcome. */
  readonly reason: string
}

/** The sandbox one real boot runs in: its temp dirs, what was copied and the child env. */
interface Sandbox {
  /** The sandbox root (a fresh `mkdtemp` under the OS temp dir). */
  readonly sandbox: string
  /** The sandbox `DSH_HOME` the child is pointed at. */
  readonly home: string
  /** The workspace the session is created on, so no state lands in the repository's own `.mpd`. */
  readonly ws: string
  /** The credential/settings file names copied out of the real home. */
  readonly copied: string[]
  /** The user composition as the sandbox mirrors it. */
  readonly composition: CompositionReading
  /** The environment the dsh child is spawned with (sandbox `DSH_HOME` + sandbox `HOME`). */
  readonly env: Record<string, string | undefined>
}

/** A pre-step decision as the vendored waterfall composes it. */
interface WaterfallDecision {
  /** The decision kind: `enter` for the fallback, whatever a vetoing listener returned. */
  readonly kind?: unknown
  /** The messages the fallback carries; a vetoing stamp carries none. */
  readonly messages?: unknown
}

/** An `agent/pre-step` listener, in the shape the vendored waterfall invokes it. */
type PreStepListener = (payload: unknown, next: () => WaterfallDecision) => unknown

/** The sliver of the vendored cordis context the waterfall control drives. */
interface CordisContext {
  /**
   * @param event The event name to subscribe to.
   * @param listener The listener the waterfall must compose.
   * @returns The disposer the real context returns (unused here).
   */
  on(event: string, listener: PreStepListener): () => void
  /**
   * @param ctx The context the waterfall runs on.
   * @param event The event name.
   * @param args The payload plus every listener/hook the chain composes.
   * @returns The composed decision.
   */
  waterfall(ctx: CordisContext, event: string, ...args: unknown[]): WaterfallDecision | undefined
}

/** The vendored cordis surface this control needs (loaded by a runtime path, hence asserted). */
interface CordisModule {
  /** The context class `new` builds the waterfall on. */
  Context: new () => CordisContext
}

/**
 * The text of a thrown value's `message`, exactly as `String(error?.message ?? error)` produced it.
 * @param error The thrown value.
 * @returns The `message` when the value carries one, else the value itself stringified.
 */
function errorMessage(error: unknown): string {
  // A thrown object's `message` member. The cast is unavoidable: `typeof` narrows only to
  // `object`, and whether the member exists can only be probed at runtime.
  const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined
  return String(message ?? error)
}

/**
 * The crash text for a thrown value, exactly as `String(error?.stack ?? error)` produced it.
 * @param error The thrown value.
 * @returns The `stack` when the value carries one, else the value itself stringified.
 */
function crashText(error: unknown): string {
  // A thrown object's `stack` member; a primitive has none, so the value itself is used.
  const stack = typeof error === "object" && error !== null ? (error as { stack?: unknown }).stack : undefined
  return String(stack ?? error)
}

/**
 * The `result.value` member of one of this lane's JSON-RPC envelopes.
 * @param body The raw response body the host returned.
 * @returns The value object, or `undefined` when the body carries none.
 */
function rpcValue(body: string): Record<string, unknown> | undefined {
  // The parsed envelope; a body that is not JSON is treated as carrying no value.
  const parsed: unknown = (() => { try { return JSON.parse(body) } catch { return undefined } })()
  if (typeof parsed !== "object" || parsed === null) return undefined
  // The envelope's `result` member, which an error response omits.
  const result: unknown = (parsed as Record<string, unknown>).result
  if (typeof result !== "object" || result === null) return undefined
  // The envelope's `result.value` member, where the RPC's payload lives.
  const value: unknown = (result as Record<string, unknown>).value
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined
}

// ─────────────────────────────── the evaluator (pure) ───────────────────────────────
/**
 * Everything this lane decides comes from the boot log + the harness's session log.
 *
 * @param observed - `{ rowLine, preset, createOk, promptAccepted, turnEnds, assistantMessages, copied }`.
 * @returns `{ ok, outcome, reason, checks }`.
 */
export function evaluate(observed: BootObservation): BootVerdict {
  // One assertion per invariant, in the order the report prints them.
  const checks: LaneCheck[] = []
  /**
   * Record one assertion.
   * @param id The stable check id (B1..B12).
   * @param ok Whether the assertion held.
   * @param detail The reading printed beside it.
   */
  const add = (id: string, ok: unknown, detail: unknown): void => { checks.push({ id, ok: Boolean(ok), detail: String(detail) }) }

  // The watchdog row's apply line as a regex match, or `null` when the boot printed none.
  const row = ROW_MARKER.exec(String(observed.rowLine ?? ""))
  add("B1", row !== null && row[1] === "true" && Number(row[2]) >= 1 && row[3] === "mpdWatchdog",
    "the watchdog row APPLIED in the real boot (" + (row === null ? "no apply line found" : JSON.stringify({ enabled: row[1], disposers: Number(row[2]), holdService: row[3] })) + ")")
  add("B2", observed.preset === "mpd", "the session was created on agentPreset mpd (" + JSON.stringify(observed.preset) + ")")
  add("B3", observed.createOk === true && observed.promptAccepted === true,
    "session/create and session/prompt were both accepted (" + JSON.stringify({ create: observed.createOk, prompt: observed.promptAccepted }) + ")")
  add("B4", Array.isArray(observed.copied) && observed.copied.includes("settings.yaml") === (observed.settingsPresent === true),
    "the sandbox home received BOTH `.credentials.yaml` and `settings.yaml` when present (" + JSON.stringify(observed.copied) + ")")

  // Every turn/end line, or an empty list when the observation carries none.
  const turnEnds: string[] = Array.isArray(observed.turnEnds) ? observed.turnEnds : []
  // Those turn/end lines that carry the pre-step veto signature.
  const vetoLines: string[] = turnEnds.filter((line) => VETO.test(String(line)))
  add("B5", turnEnds.length >= 1, "the harness's own session log recorded at least one turn/end (" + turnEnds.length + " turn/end line(s))")
  add("B6", vetoLines.length === 0,
    vetoLines.length === 0 ? "NO turn/end carries the pre-step veto signature (map/findLastIndex/length)" : "VETO: " + String(vetoLines[0]).slice(0, 240))

  // The classified outcome, one of `no-turn` / `veto` / `completed` / `model-error`.
  let outcome: string = "no-turn"
  // The reason printed beside it, refined by the branch that classifies the outcome.
  let reason: string = "no turn/end was recorded — the machinery did not survive the row, or the prompt never reached the loop"
  if (turnEnds.length >= 1) {
    if (vetoLines.length > 0) {
      outcome = "veto"
      // `vetoLines` was filtered BY this regex, so the match cannot be null here.
      reason = VETO.exec(String(vetoLines[0]))![0]
    } else if ((observed.assistantMessages ?? []).length >= 1) {
      outcome = "completed"
      reason = "a turn/end plus an assistant message: the full round trip works"
    } else {
      // The model-level error text of every error turn/end, empty strings dropped.
      const errored: string[] = turnEnds.map((line) => /"reason":\{"kind":"error","error":\{"message":"([^"]*)"/.exec(String(line))?.[1] ?? "").filter((text) => text !== "")
      // The first error text that reads as a MODEL-level failure rather than the veto.
      const modelLevel: string | undefined = errored.find((text) => MODEL_ERROR.test(text))
      if (modelLevel !== undefined) {
        outcome = "model-error"
        reason = "the turn reached the MODEL call and failed there (not at pre-step): " + modelLevel.slice(0, 200)
      } else {
        outcome = "no-turn"
        reason = errored.length > 0 ? "an UNCLASSIFIED error turn/end (neither the veto nor a model-level failure): " + errored[0].slice(0, 200) : "turn/end recorded with neither an assistant message nor a recognisable reason"
      }
    }
  }
  add("B7", outcome === "completed" || outcome === "model-error",
    outcome === "completed" ? "outcome=completed — the full round trip is witnessed"
      : outcome === "model-error" ? "outcome=model-error — PASSED FOR THIS INVARIANT (the pre-step veto is gone; the turn reached the model call) and explicitly NOT a completed turn: " + reason.slice(0, 160)
        : "outcome=" + outcome + " — " + reason.slice(0, 200))

  // ── GUI ACTIVATION (r5): the blind spot that let a user-visible symptom ship ──
  // The operator's terminal is where a client-entry activation failure shows up; the browser
  // console the user was told to check stays EMPTY. So this lane fails on the terminal-only
  // signatures and asserts the activation from the SERVED client instead.
  const activationLine = observed.activationLine
  add("B8", activationLine === undefined,
    activationLine === undefined ? "no client-entry activation failure signature in the real boot log (did not activate / pending (waiting for service / failed to apply loader entry / a client-modules error naming @mpd-dsh/mpd)"
      : "ACTIVATION FAILURE in the boot log: " + String(activationLine).slice(0, 240))
  add("B9", observed.clientRoute?.status === 200 && observed.clientRoute?.url !== undefined,
    "the host SERVED our client for the @mpd-dsh/mpd entry (HTTP " + String(observed.clientRoute?.status) + " on " + String(observed.clientRoute?.url) + ", " + String(observed.clientRoute?.bytes) + " bytes)")
  // The served client bytes the tab-id and bridge markers are asserted against.
  const served: string = String(observed.clientRoute?.body ?? "")
  add("B10", served.includes('TEAM_TAB_ID = "mpd-agent-teams"') && served.includes("mpd-workmate"),
    "the served bytes carry BOTH tab ids we register (mpd-agent-teams: " + String(served.includes('TEAM_TAB_ID = "mpd-agent-teams"')) + ", mpd-workmate: " + String(served.includes("mpd-workmate")) + ")")
  add("B11", served.includes("//#region mpd-export-bridge") && served.includes('id: "@mpd-dsh/team-page"'),
    "the served bytes carry the adopted export bridge AND the sidebar page module")
  add("B12", Array.isArray(observed.composition?.declared) && observed.composition.declared.includes("@mpd-dsh/mpd") && observed.composition.declared.includes("dsh-better-sidebar") && (observed.composition.mirrored ?? []).length >= 2,
    "the boot ran in the USER'S composition, mirrored as far as the sandbox allows (declared: " + JSON.stringify(observed.composition?.declared) + "; mirrored: " + JSON.stringify(observed.composition?.mirrored) + "; unresolved: " + JSON.stringify(observed.composition?.unresolved) + ")")
  return { ok: checks.every((check) => check.ok), outcome, reason, checks }
}

// ─────────────────────────────── the real run (heavy) ───────────────────────────────
/**
 * A free loopback TCP port, so the sandbox dsh cannot collide with one already running.
 * @returns The port the OS assigned, or `0` when it reported none.
 */
function freePort(): Promise<number> {
  return new Promise<number>((resolvePort: (port: number) => void, reject: (reason?: unknown) => void) => {
    // A throwaway listener: binding to port 0 makes the OS pick a free port.
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      // The bound address; a string (a pipe path) cannot occur for an explicit TCP bind.
      const address = probe.address()
      probe.close(() => resolvePort(typeof address === "object" && address !== null ? address.port : 0))
    })
  })
}

/** The bundles the USER's own web profile runs (read from their `~/.dsh/profiles/web/package.json`). */
const USER_PROFILE = join(homedir(), ".dsh", "profiles", "web")
/** The user profile's own `node_modules`, where every co-installed bundle must resolve. */
const USER_PROFILE_MODULES = join(USER_PROFILE, "node_modules")
/** Our entry keeps the checkout link; the rest are mirrored by symlink when resolvable. */
const COMPOSITION: readonly string[] = [
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@linxin666/dsh-web-all",
  "dshmarket",
  "dsh-cost-meter",
  "nowledge-mem-deepseek-harness",
  "dsh-better-sidebar",
  "@mpd-dsh/mpd",
]

/**
 * Build the sandbox the real boot runs in: a temp DSH home with the user's composition mirrored
 * into it, plus the credentials the harness needs.
 * @returns The sandbox paths, what was copied, the composition mirror and the child env.
 */
function makeSandbox(): Sandbox {
  // The sandbox root: a fresh temp directory, so no run can see another run's state.
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-wdboot-"))
  // The sandbox `DSH_HOME` the child is pointed at.
  const home = join(sandbox, "home")
  // The profile directory inside the sandbox home (`--profile w`).
  const profile = join(home, "profiles", "w")
  // The sandbox `HOME`, so skill roots and the profile cannot leak out of the real home.
  const userHome = join(sandbox, "userhome")
  mkdirSync(join(profile, "node_modules"), { recursive: true })
  mkdirSync(userHome, { recursive: true })
  // The credential/settings file names that were actually copied into the sandbox.
  const copied: string[] = []
  for (const name of [".credentials.yaml", ".anonymous-user-id", "settings.yaml"]) {
    // The real home's copy of this file, which is copied only when it exists.
    const src = join(homedir(), ".dsh", name)
    if (existsSync(src)) { cpSync(src, join(home, name)); copied.push(name) }
  }
  // THE USER'S COMPOSITION, mirrored: every co-installed bundle is symlinked into the sandbox
  // profile when the user's own profile resolves it (a symlink's realpath keeps ITS deps
  // resolvable from the real profile), and each one is recorded as mirrored or unresolved —
  // never silently dropped. Our own entry is always the CHECKOUT link.
  /** The bundle names mirrored into the sandbox profile, each with its resolved source. */
  const mirrored: string[] = []
  /** The bundle names the user's own profile does not resolve, recorded rather than dropped. */
  const unresolved: string[] = []
  for (const name of COMPOSITION) {
    // Where the bundle must appear inside the sandbox profile's `node_modules`.
    const target = join(profile, "node_modules", name)
    mkdirSync(dirname(target), { recursive: true })
    if (name === "@mpd-dsh/mpd") {
      symlinkSync(REPO, target, "junction")
      mirrored.push(name + " -> " + REPO + " (checkout)")
      continue
    }
    // The bundle's real location in the user's own profile; `existsSync` decides if it resolves.
    const source = join(USER_PROFILE_MODULES, name)
    if (!existsSync(source)) { unresolved.push(name + " (not resolved in " + USER_PROFILE + ")"); continue }
    try {
      symlinkSync(source, target, "junction")
      mirrored.push(name + " -> " + source)
    } catch (error) {
      // A symlink the OS refuses is recorded as unresolved; it never takes the lane down.
      unresolved.push(name + " (" + errorMessage(error) + ")")
    }
  }
  writeFileSync(join(profile, "package.json"), JSON.stringify({
    name: "dsh-profile-w", private: true, dependencies: {},
    // The bundle ORDER mirrors the user's manifest (ours last, as theirs is).
    dsh: { profile: { bundles: COMPOSITION } },
  }, null, 2))
  // The workspace the session is created on, so state never lands in the repository's own `.mpd`.
  const ws = join(sandbox, "ws")
  mkdirSync(ws, { recursive: true })
  return { sandbox, home, ws, copied, composition: { declared: COMPOSITION, mirrored, unresolved }, env: { ...process.env, DSH_HOME: home, HOME: userHome } }
}

/** Every turn/end + assistant/message line of every session log under one sandbox home. */
function readSessionLines(home: string): string[] {
  // Every matching line, in the order the session directories are read.
  const lines: string[] = []
  // The harness's session store root inside the sandbox home.
  const root = join(home, "sessions")
  if (!existsSync(root)) return lines
  for (const key of readdirSync(root)) {
    for (const id of readdirSync(join(root, key))) {
      // The one session's own directory.
      const dir = join(root, key, id)
      // The log file names inside it; an unreadable directory contributes none.
      let names: string[] = []
      try { names = readdirSync(dir) } catch { continue }
      for (const name of names) {
        if (!/^session\..*jsonl(\.zstd)?$/.test(name)) continue
        try {
          for (const line of decodeSessionLog(join(dir, name)).text.split("\n")) {
            if (line.includes('"turn/end"') || line.includes('"assistant/message"')) lines.push(line)
          }
        } catch { /* a session log that cannot be decoded is reported by the turn count */ }
      }
    }
  }
  return lines
}

/**
 * The REAL boot: spawn a sandbox dsh, create an mpd session, prompt it, and read the verdict
 * from the harness's own session log.
 * @param argv The process argv, scanned for `--out`.
 * @returns The process exit code (0 for a PASS).
 */
async function runReal(argv: readonly string[]): Promise<number> {
  // The position of `--out` in argv, or -1 when the caller named no target.
  const at = argv.indexOf("--out")
  // The filesystem-safe UTC stamp that names the default evidence directory.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  // The evidence directory: the caller's `--out`, else a fresh timestamped default.
  const dir = at >= 0 && argv[at + 1] ? resolve(argv[at + 1]) : join(REPO, "evidence/team-watchdog/boot", stamp)
  // T-83: the evidence target is IMMUTABLE BY DEFAULT — a caller-supplied --out that already exists
  // is refused instead of being rewritten (the T-63/T-76 class: a re-run must never overwrite a record).
  try {
    refuseOverwrite(dir, { label: "evidence directory", remedy: "pass a new --out <dir>, or omit --out for a fresh timestamped directory (T-53)" })
  } catch (error) {
    exitOnRefusal(error, "[" + SLUG + "]")
  }
  mkdirSync(join(dir, "raw"), { recursive: true })
  // The isolated sandbox the real dsh boots in.
  const s = makeSandbox()
  // The loopback port the sandbox dsh serves on.
  const port = await freePort()
  // The file the child's stdout+stderr are redirected to (a FILE, never a pipe: T-24).
  const logPath = join(dir, "raw", "boot.log")
  // The open descriptor handed to the child for both streams.
  const fd = openSync(logPath, "w")
  // The launcher plus argv for the sandbox dsh, or `null` when no launcher resolves.
  const childSpec = dshCommand(["--profile", "w", "--port", String(port), "--no-open"], s.env)
  if (childSpec === null) throw new Error(DSH_MISSING)
  // The real dsh child, whose whole output lands in `boot.log`.
  const child = spawn(childSpec.command, childSpec.args, { env: s.env, cwd: s.ws, stdio: ["ignore", fd, fd] })
  /** @returns The boot log's current text, or `""` while it cannot be read yet. */
  const readLog = (): string => { try { return readFileSync(logPath, "utf8") } catch { return "" } }
  // Every line this lane printed, kept for output.log.
  const captured: string[] = []
  /**
   * Print one line, keeping it for the evidence file.
   * @param text The line body, prefixed with the lane slug.
   */
  const out = (text: string): void => {
    // The printed line, prefixed so a reader can grep this lane's run.
    const line = "[" + SLUG + "] " + text
    captured.push(line)
    console.log(line)
  }

  // The host's session token, scraped from the boot log's own URL line.
  let token: string = ""
  // The session cookie the host set when the token URL was exchanged.
  let cookie: string = ""
  // The instant the token wait gives up (90 s: a cold dsh boot takes tens of seconds).
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await sleep(1200)
    // The token the boot log has printed by now, if it has printed one.
    const match = /token=([A-Za-z0-9_-]+)/.exec(readLog())
    if (match) token = match[1]
    if (token === "") continue
    try {
      // The token-exchange response, whose Set-Cookie the RPC calls must carry.
      const auth = await fetch(`http://127.0.0.1:${port}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(6000) })
      cookie = (auth.headers.getSetCookie?.() ?? []).map((value) => String(value).split(";")[0]).join("; ") || cookie
      break
    } catch { /* retry until the deadline */ }
  }
  /**
   * One JSON-RPC call against the sandbox host.
   * @param method The RPC method name.
   * @param payload The RPC payload.
   * @param timeout The request timeout in milliseconds.
   * @returns The HTTP status plus the raw response body.
   */
  const rpc = async (method: string, payload: unknown, timeout: number = 60_000): Promise<RpcResponse> => {
    // The host's response to this call.
    const res = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ type: "client-request", rpcId: randomUUID(), method, payload }),
      signal: AbortSignal.timeout(timeout),
    })
    return { status: res.status, body: await res.text() }
  }

  // The `session/create` response, from which the preset and the session id are read.
  const created = await rpc("session/create", { args: { request: { cwd: s.ws, agentPreset: "mpd" } } })
  // The session id the host created, or `""` when the call produced none.
  const sessionId: string = (() => {
    try {
      // The session id the host reported; a non-string value cannot occur for this field.
      const reported = rpcValue(created.body)?.sessionId
      return typeof reported === "string" ? reported : ""
    } catch { return "" }
  })()
  // The preset the session was actually created on, or `null` when neither source names one.
  const preset: string | null = (() => {
    try {
      // The RPC value object, absent when the host answered without one.
      const value = rpcValue(created.body)
      // The preset the host reported; a non-string value cannot occur for this field.
      const reported = value?.agentPreset
      if (typeof reported === "string") return reported
      return /"agentPreset":"([^"]+)"/.exec(created.body)?.[1] ?? null
    } catch { return null }
  })()
  // The `session/prompt` response, or `null` when no session was created to prompt.
  const prompt: RpcResponse | null = sessionId === "" ? null : await rpc("session/prompt", { args: { request: { requestId: randomUUID(), sessionId, mode: "queue", content: [{ type: "text", text: PROMPT }] } } })
  out("boot=" + String(/dsh web: http[^\s]*/.exec(readLog())?.[0]?.replace(/token=.*/, "token=<redacted>")) + " session=" + (sessionId === "" ? "NONE" : sessionId) + " preset=" + String(preset))

  // Let the turn settle (a live model call takes seconds; the veto fires in ~120 ms).
  // The session-log lines read back so far, refreshed on every settle poll.
  let lines: string[] = []
  // The instant the settle wait gives up.
  const settle = Date.now() + 150_000
  while (Date.now() < settle) {
    await sleep(3000)
    lines = readSessionLines(s.home)
    if (lines.some((line) => line.includes('"turn/end"'))) break
  }
  // ── GUI ACTIVATION: serve our client and read the terminal-only failure signatures ──
  // The browser console the user was told to check stays EMPTY when client-modules skips our
  // entry; only the operator's terminal records it. So: fetch the served index, find OUR
  // entry's client URL, fetch it with the host cookie, and re-read the boot log afterwards.
  /** The served-client reading this leg fills in; `body` stays `""` until a 200 answers. */
  const clientRoute: ClientRouteReading = { url: undefined, status: null, bytes: 0, body: "", error: undefined, discoveredUrls: [] }
  try {
    // The served index page, which advertises every client bundle URL.
    const index = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(20_000) })
    // The index HTML, persisted verbatim as raw evidence.
    const html = await index.text()
    writeFileSync(join(dir, "raw", "index.html"), html, "utf8")
    // Every client URL the index advertises, de-duplicated.
    const urls: string[] = [...new Set([...html.matchAll(/\/plugins\/[^\s"'<>\\]*client\.js[^\s"'<>\\]*/g)].map((match) => match[0]))]
    // The advertised URLs whose decoded path names OUR entry (a combined entry lists several).
    const own: string[] = urls.filter((url) => decodeURIComponent(url).includes("@mpd-dsh/mpd")).sort((left, right) => Number(left.includes(",@")) - Number(right.includes(",@")))
    clientRoute.indexStatus = index.status
    clientRoute.discovered = urls.length
    clientRoute.discoveredUrls = urls
    clientRoute.ours = own
    for (const url of own) {
      // One candidate entry's response.
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(20_000) })
      // That response's body, whose markers are asserted below.
      const body = await response.text()
      if (response.status !== 200) { clientRoute.url = url; clientRoute.status = response.status; clientRoute.bytes = body.length; continue }
      if (clientRoute.url === undefined || body.length < clientRoute.bytes) {
        clientRoute.url = url
        clientRoute.status = response.status
        clientRoute.bytes = body.length
        clientRoute.body = body
      }
      if (!url.includes(",@")) break
    }
    out("gui: index=" + String(index.status) + " clientUrls=" + urls.length + " ours=" + own.length + " served=" + String(clientRoute.url) + " status=" + String(clientRoute.status) + " bytes=" + String(clientRoute.bytes))
  } catch (error) {
    clientRoute.error = errorMessage(error)
    out("gui: the served client could not be fetched: " + clientRoute.error)
  }
  // The terminal-only failure signatures (read AFTER the client was requested).
  const bootText = readLog()
  /** The terminal-only failure patterns, each one a client-entry activation failure. */
  const ACTIVATION_FAILURES: readonly RegExp[] = [
    /did not activate/i,
    /pending \(waiting for service/i,
    /failed to apply loader entry/i,
  ]
  // The first boot-log line carrying an activation-failure signature, or `undefined`.
  const activationLine = bootText.split("\n").find((line) => ACTIVATION_FAILURES.some((pattern) => pattern.test(line)) || (/client-modules/i.test(line) && /@mpd-dsh\/mpd/.test(line)))
  writeFileSync(join(dir, "raw", "gui-activation.json"), JSON.stringify({
    indexStatus: clientRoute.indexStatus, discoveredClientUrls: clientRoute.discovered,
    discoveredUrls: (clientRoute.discoveredUrls ?? []).slice(0, 20), ourUrls: clientRoute.ours ?? [],
    fetchError: clientRoute.error ?? null,
    ourEntryUrl: clientRoute.url, status: clientRoute.status, bytes: clientRoute.bytes,
    carriesTeamTabId: clientRoute.body.includes('TEAM_TAB_ID = "mpd-agent-teams"'),
    carriesWorkmateTabId: clientRoute.body.includes("mpd-workmate"),
    carriesBridge: clientRoute.body.includes("//#region mpd-export-bridge"),
    carriesTeamPageModule: clientRoute.body.includes('id: "@mpd-dsh/team-page"'),
    activationFailureLine: activationLine ?? null,
    composition: s.composition,
  }, null, 2) + "\n", "utf8")

  child.kill("SIGKILL")
  await sleep(400)

  // Everything the verdict reads, assembled from the boot log, the RPC receipts and the store.
  const observed: BootObservation = {
    rowLine: (bootText.split("\n").find((line) => line.includes("[mpd-team-watchdog] applied:")) ?? "").trim(),
    preset,
    createOk: created.body.includes('"ok":true'),
    promptAccepted: prompt !== null && prompt.body.includes('"accepted":true'),
    copied: s.copied,
    settingsPresent: s.copied.includes("settings.yaml"),
    activationLine,
    clientRoute,
    composition: s.composition,
    turnEnds: lines.filter((line) => line.includes('"turn/end"')),
    assistantMessages: lines.filter((line) => line.includes('"assistant/message"')),
  }
  // The verdict over that observation.
  const verdict = evaluate(observed)
  // The persisted result: the observation (long fields truncated) plus the verdict.
  const result = {
    task: "the watchdog's row mounted in a REAL dsh does not veto the turn machinery (pre-step waterfall)",
    lane: SLUG,
    heavy: true,
    workspace: s.ws,
    dshHome: s.home,
    copiedFiles: s.copied,
    composition: s.composition,
    observed: {
      ...observed,
      clientRoute: { url: observed.clientRoute.url, status: observed.clientRoute.status, bytes: observed.clientRoute.bytes, indexStatus: observed.clientRoute.indexStatus, discovered: observed.clientRoute.discovered, error: observed.clientRoute.error, body: "(omitted: " + observed.clientRoute.body.length + " bytes; see raw/gui-activation.json)" },
      turnEnds: observed.turnEnds.slice(-3).map((line) => line.slice(0, 400)),
      assistantMessages: observed.assistantMessages.slice(-1).map((line) => line.slice(0, 400)),
    },
    outcome: verdict.outcome,
    reason: verdict.reason,
    checks: verdict.checks,
    ok: verdict.ok,
    notClaimed: [
      "This lane witnesses the INVARIANT (the row mounts and the turn machinery survives it). A `model-error` outcome (e.g. MISSING_CREDENTIAL — measured in this sandbox while the task was written) proves the turn reached the model call but is NOT a completed turn.",
      "No genuine provider wedge is claimed; this lane drives one normal prompt, not a wedge.",
      "THE CEILING (r5): no browser exists in this environment, so `registerTab` EXECUTION against the real sidebar cannot be witnessed end-to-end. What IS asserted: (a) the client entry activated — none of the terminal-only failure signatures (did not activate / pending (waiting for service / failed to apply loader entry / a client-modules error naming @mpd-dsh/mpd) appear in the boot log; (b) the host SERVED our client for the @mpd-dsh/mpd entry (HTTP 200); (c) the served bytes carry BOTH tab ids and the adopted bridge. Whether the sidebar then RENDERS the tabs stays outside this lane.",
      "The mirrored composition is as far as the sandbox allows: a user bundle that the user's own profile does not resolve is recorded as `unresolved` in the composition and never silently dropped.",
    ],
  }
  out("outcome=" + verdict.outcome + " verdict=" + (verdict.ok ? "PASS" : "FAIL") + " — " + verdict.reason.slice(0, 200))
  for (const check of verdict.checks) out("  " + (check.ok ? "ok  " : "FAIL") + " " + check.id + ": " + String(check.detail).slice(0, 200))
  out("evidence: " + dir)
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n")
  writeFileSync(join(dir, "output.log"), captured.join("\n") + "\n")
  return verdict.ok ? 0 : 1
}

// ─────────────────────────────── the offline self-test ───────────────────────────────
/**
 * The self-test carries TWO controls:
 *   1. the REAL vendored cordis waterfall, driven with the RETIRED shape
 *      (`(payload) => stamp` — no `next()`): the composed decision must BE the listener's return
 *      value, i.e. the veto is real on the implementation the harness ships. The same waterfall
 *      with the FIXED shape (`return next()`) must compose the fallback decision instead.
 *   2. the lane's own verdict: a synthesized veto turn/end must FAIL (outcome `veto`), a completed
 *      turn must PASS (`completed`), a model-level error must PASS for the invariant
 *      (`model-error`), and an empty log must FAIL (`no-turn`).
 */
export async function selfTest(): Promise<boolean> {
  // One control per assertion family, printed in the order below.
  const checks: LaneCheck[] = []
  /**
   * Record one control.
   * @param id The stable control id (C1..C17).
   * @param ok Whether the control held.
   * @param detail The reading printed beside it.
   */
  const add = (id: string, ok: unknown, detail: unknown): void => { checks.push({ id, ok: Boolean(ok), detail: String(detail) }) }

  // The served-bytes fixture: both tab ids and the adopted export bridge, as the host serves them.
  const SERVED = "window.__ModuleLoader__.load({ id: \"@mpd-dsh/team-page\", factory: … });\nvar TEAM_TAB_ID = \"mpd-agent-teams\"; var SIDEBAR_TAB_ID = \"mpd-workmate\"; //#region mpd-export-bridge"
  // The composition fixture: the user's declared bundles, two of them mirrored.
  const COMPOSITION: CompositionReading = { declared: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@linxin666/dsh-web-all", "dshmarket", "dsh-cost-meter", "nowledge-mem-deepseek-harness", "dsh-better-sidebar", "@mpd-dsh/mpd"], mirrored: ["@linxin666/dsh-web-all -> /real/node_modules/@linxin666/dsh-web-all", "@mpd-dsh/mpd -> /repo (checkout)"], unresolved: [] }
  // The healthy observation every control starts from: a clean boot with a served 200.
  const clean: BootObservation = { rowLine: "[mpd-team-watchdog] applied: enabled=true warnSilenceMs=90000 tickIntervalMs=15000 warnStreakToEscalate=3 actionOnEscalate=pause stateDir=.mpd/team disposers=5 holdService=mpdWatchdog hydratedHolds=0", preset: "mpd", createOk: true, promptAccepted: true, copied: [".credentials.yaml", "settings.yaml"], settingsPresent: true, turnEnds: [], assistantMessages: [], activationLine: undefined, clientRoute: { url: "/plugins/@mpd-dsh/mpd/client.js", status: 200, bytes: SERVED.length, body: SERVED }, composition: COMPOSITION }
  // A completed round trip: one turn/end plus an assistant message.
  const completed = { ...clean, turnEnds: ['{"type":"turn/end","data":{"turn":1,"reason":{"kind":"complete"}}}'], assistantMessages: ['{"type":"assistant/message","data":{"text":"watchdog-pre-step-ok"}}'] }
  // A MODEL-level failure: the turn reached the model call and failed there.
  const modelError = { ...clean, turnEnds: ['{"type":"turn/end","data":{"turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key for provider route \\"deepseek-official\\"; code: MISSING_CREDENTIAL","code":"MISSING_CREDENTIAL"}}}}'] }
  // The pre-step veto: the defect's own signature, recorded in a turn/end.
  const veto = { ...clean, turnEnds: ['{"type":"turn/end","seq":5559,"data":{"turn":113,"reason":{"kind":"error","error":{"message":"Cannot read properties of undefined (reading \'map\')","code":"UNKNOWN"}}}}'] }
  // The empty-log control: no turn/end at all.
  const noTurn = clean

  add("C1", evaluate(completed).ok && evaluate(completed).outcome === "completed", "a completed turn passes as `completed`")
  add("C2", evaluate(modelError).ok && evaluate(modelError).outcome === "model-error", "a MODEL-level error passes as `model-error` (the turn reached the model call)")
  // The verdict on the veto control, which must FAIL as `veto`.
  const vetoVerdict = evaluate(veto)
  add("C3", vetoVerdict.ok === false && vetoVerdict.outcome === "veto", "the veto signature FAILS as `veto` (" + vetoVerdict.outcome + ")")
  // The verdict on the empty-log control, which must FAIL as `no-turn`.
  const noTurnVerdict = evaluate(noTurn)
  add("C4", noTurnVerdict.ok === false && noTurnVerdict.outcome === "no-turn", "an empty session log FAILS as `no-turn`")
  add("C5", evaluate({ ...clean, rowLine: "no apply line" }).ok === false, "a boot without the row's apply line FAILS")
  add("C6", evaluate({ ...completed, preset: "standard" }).ok === false, "a session not created on `mpd` FAILS")

  // ── the r5 GUI-activation controls: each new assertion must be able to go RED ──
  // The clean GUI control, which must pass every activation assertion.
  const guiGreen = evaluate({ ...completed, activationLine: undefined })
  add("C10", guiGreen.ok === true, "the GUI-activation checks pass on a clean boot (served 200, both tab ids, bridge, mirrored composition)")
  // The `did not activate` control: a terminal-only client-entry failure.
  const didNotActivate = evaluate({ ...completed, activationLine: "web boot: 1 entry did not activate (client-modules: @mpd-dsh/mpd)" })
  // The `!` on every lookup below is justified: the evaluator unconditionally emits B8..B12, so a
  // control's check always exists and the lookup can never be `undefined`.
  add("C11", didNotActivate.ok === false && didNotActivate.checks.find((check) => check.id === "B8")!.ok === false,
    "a boot log carrying `did not activate` REDDENS B8 (" + JSON.stringify(didNotActivate.checks.filter((check) => !check.ok).map((check) => check.id)) + ")")
  // The `pending (waiting for service` control: a client entry stuck behind a missing service.
  const pending = evaluate({ ...completed, activationLine: "@mpd-dsh/mpd: pending (waiting for service: betterSidebar)" })
  add("C12", pending.ok === false && pending.checks.find((check) => check.id === "B8")!.ok === false, "a `pending (waiting for service` line REDDENS B8")
  // The `failed to apply loader entry` control: a row the loader could not apply.
  const loaderFailure = evaluate({ ...completed, activationLine: "failed to apply loader entry mpd-web-compat (@mpd-dsh/mpd)" })
  add("C13", loaderFailure.ok === false && loaderFailure.checks.find((check) => check.id === "B8")!.ok === false, "a `failed to apply loader entry` line REDDENS B8")
  // The 404 control: the client route did not serve our entry.
  const route404 = evaluate({ ...completed, clientRoute: { url: "/plugins/@mpd-dsh/mpd/client.js", status: 404, bytes: 0, body: "" } })
  add("C14", route404.ok === false && route404.checks.find((check) => check.id === "B9")!.ok === false, "a client route that 404s REDDENS B9")
  // The missing-workmate-tab control: the served bytes carry only one of the two tab ids.
  const missingWorkmate = evaluate({ ...completed, clientRoute: { url: "/plugins/@mpd-dsh/mpd/client.js", status: 200, bytes: 10, body: 'TEAM_TAB_ID = "mpd-agent-teams"' } })
  add("C15", missingWorkmate.ok === false && missingWorkmate.checks.find((check) => check.id === "B10")!.ok === false, "served bytes missing the workmate tab id REDDEN B10")
  // The missing-bridge control: the served bytes carry the tab ids but no export bridge.
  const noBridge = evaluate({ ...completed, clientRoute: { url: "/plugins/@mpd-dsh/mpd/client.js", status: 200, bytes: 10, body: 'TEAM_TAB_ID = "mpd-agent-teams"; mpd-workmate' } })
  add("C16", noBridge.ok === false && noBridge.checks.find((check) => check.id === "B11")!.ok === false, "served bytes without the export bridge REDDEN B11")
  // The empty-composition control: a boot outside the user's own composition.
  const emptyComposition = evaluate({ ...completed, composition: { declared: ["@mpd-dsh/mpd"], mirrored: [], unresolved: [] } })
  add("C17", emptyComposition.ok === false && emptyComposition.checks.find((check) => check.id === "B12")!.ok === false, "a boot outside the user's composition REDDENS B12")

  // The real cordis waterfall: the retired shape must veto, the fixed shape must not.
  try {
    // The vendored cordis lib, loaded by ABSOLUTE PATH. The cast is unavoidable: the specifier
    // is a runtime path static analysis cannot resolve, so its surface is asserted here instead.
    const cordis = await import(join(REPO, "packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.ts")) as CordisModule
    // The fallback decision a composed waterfall must produce when no listener vetoes.
    const FALLBACK = { kind: "enter", messages: ["claimed-user-message"] }
    /**
     * Drive one listener through the REAL vendored waterfall.
     * @param listener The `agent/pre-step` listener under test.
     * @returns The decision the waterfall composed.
     */
    const runWaterfall = (listener: PreStepListener): WaterfallDecision | undefined => {
      // A vendored context carrying exactly the listener under test.
      const ctx = new cordis.Context()
      ctx.on("agent/pre-step", listener)
      // The vendored shape (measured in packages/mpd-agent-teams-plugin/test/pre-step-waterfall.test.ts):
      // the LAST argument is the innermost `next`, so it is a thunk returning the fallback decision.
      return ctx.waterfall(ctx, "agent/pre-step", { turn: 1 }, () => ({ ...FALLBACK }))
    }
    // The RETIRED shape: a listener that returns a stamp without calling `next()`.
    const retired = runWaterfall(() => ({ kind: "step", at: 1 }))
    // The FIXED shape: a listener that stamps and then returns `next()`'s decision.
    const fixed = runWaterfall((_payload, next) => {
      // The stamp the fixed listener writes before composing `next()`.
      const stamp = { kind: "step", at: 2 }
      void stamp
      return next()
    })
    add("C7", retired?.kind === "step" && retired?.messages === undefined,
      "the vendored cordis REALLY vetoes on the retired shape: the listener's return value became the decision (" + JSON.stringify(retired) + ")")
    add("C8", fixed?.kind === "enter" && Array.isArray(fixed?.messages),
      "the fixed shape (`return next()`) composes the fallback decision unchanged (" + JSON.stringify(fixed) + ")")
    checks.push({ id: "C9", ok: true, detail: "the cordis control ran against the REAL vendored implementation at packages/mpd-agent-teams-plugin/_deps/cordis/lib/index.ts" })
  } catch (error) {
    checks.push({ id: "C7", ok: false, detail: "the cordis waterfall control could not run: " + errorMessage(error) })
  }

  // Whether every control held, which is the self-test's whole verdict.
  const ok = checks.every((check) => check.ok)
  for (const check of checks) console.log("[self-test] " + (check.ok ? "ok  " : "FAIL") + " " + check.id + ": " + check.detail)
  console.log("[self-test] " + (ok ? "PASS" : "FAIL") + " — " + SLUG + " (" + checks.length + " checks, " + checks.filter((check) => !check.ok).length + " failed)")
  return ok
}

// The argv this process was invoked with, minus the node binary and the script path.
const argv = process.argv.slice(2)
if (argv.includes("--self-test")) {
  process.exit((await selfTest()) ? 0 : 1)
}
try {
  process.exit(await runReal(argv))
} catch (error) {
  console.error("[" + SLUG + "] CRASH: " + crashText(error))
  process.exit(1)
}
