// T7 ARM: a REAL tool-card result in the HARNESS session log.
//
// One headless dsh session in an isolated DSH_HOME + sandbox HOME is asked to call ONE mpd_* tool;
// the harness's own session store is then decoded FRAME BY FRAME (concatenated zstd) and the
// `tool/result` record is searched for `meta["dsh-go/view"]`. The verdict rests on the record, never
// on the model's prose (AGENTS.md §7). The card is judged v1-legal and inside the toolCard budget
// (8 KiB / 40 nodes / depth 6), then handed to the dsh-Go app checker with `--budget toolCard`.
//
// Everything this script writes stays under its own evidence directory; the sandbox is thrown away.
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { dshCommand, type Env } from "../../../../skills/dsh-qa/scripts/lib/dsh-launcher.ts"
import { readSessionEvents } from "../../../../skills/dsh-qa/scripts/lib/session-evidence.ts"
import { credentialEnv, seedSandboxCredentials } from "../../../../skills/dsh-qa/scripts/lib/credentials.ts"
import { BUDGETS, V2_ONLY_COMPONENTS, measureView } from "../../../../packages/mpd-dsh-adapter-plugin/src/dshgo-view.ts"

/** This script's own directory, where every artifact lands. */
const HERE = dirname(fileURLToPath(import.meta.url))
/** The repository root: four directories above this evidence file. */
const REPO = dirname(dirname(dirname(dirname(HERE))))
/** The pinned app-side checker the card is handed to. */
const CHECKER = join(REPO, ".mpd", "recon", "dsh-go", "sdk", "plugin-kit", "bin", "check.mjs")
/** The key the app reads inside a tool result's `meta`. */
const VIEW_KEY = "dsh-go/view"
/** The prompt: one read-only mpd tool, no other tool, so the evidence is deterministic. */
const PROMPT = "Call the tool mpd_memory_status exactly once with no arguments. Do not call any other tool. Then reply with the single word DONE."

/** One record found by the deep search, with the JSON path that carries the view. */
interface ViewHit {
  /** Dot/bracket path inside the record where the key was found. */
  readonly path: string
  /** The view tree the key carries. */
  readonly view: Record<string, unknown>
  /** The raw record's `type`, so a reader can tell a tool/result from anything else. */
  readonly recordType: string
}

/**
 * Finds every object carrying `dsh-go/view` in a record, recording the path it sat at.
 * @param value the value to walk
 * @param path the path of `value` inside the record
 * @param out the accumulator
 */
function findViews(value: unknown, path: string, out: ViewHit[], recordType: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findViews(item, `${path}[${index}]`, out, recordType))
    return
  }
  if (typeof value !== "object" || value === null) return
  const record = value as Record<string, unknown>
  const carried = record[VIEW_KEY]
  if (typeof carried === "object" && carried !== null && !Array.isArray(carried)) {
    out.push({ path: `${path}[${JSON.stringify(VIEW_KEY)}]`, view: carried as Record<string, unknown>, recordType })
  }
  for (const [key, child] of Object.entries(record)) findViews(child, `${path}.${key}`, out, recordType)
}

/**
 * Walks a card view and reports the v1 rules a card must satisfy.
 * @param view the card tree
 * @returns the violations, empty when the card is v1-legal
 */
function v1Violations(view: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`))
      return
    }
    if (typeof node !== "object" || node === null) return
    const record = node as Record<string, unknown>
    const type = typeof record.type === "string" ? record.type : ""
    if (V2_ONLY_COMPONENTS.includes(type)) out.push(`${path}: v2-only component ${type}`)
    if ("accent" in record) out.push(`${path}: v1 card carries accent`)
    if ("style" in record) out.push(`${path}: v1 card carries style`)
    if (type === "text" && (typeof record.text !== "string" || record.text.trim() === "")) out.push(`${path}: empty text`)
    for (const key of ["children", "items"]) {
      const list = record[key]
      if (Array.isArray(list)) list.forEach((item, index) => walk(item, `${path}.${key}[${index}]`))
    }
  }
  walk(view, "view")
  if (typeof view.title !== "string" || view.title === "") out.push("view: the card root has no title")
  return out
}

/** The child environment paired with the sandbox home and the resolved credential. */
const sandbox = mkdtempSync(join(tmpdir(), "mpd-t7-card-"))
/** The throwaway DSH_HOME the headless session boots in. */
const dshHome = join(sandbox, "dsh-home")
mkdirSync(join(dshHome, ".agent-presets"), { recursive: true })
mkdirSync(join(sandbox, "home"), { recursive: true })
/** The sandbox workspace: its own session-store key, so no real workspace state is touched. */
const ws = join(sandbox, "ws")
mkdirSync(ws, { recursive: true })
const result: Record<string, unknown> = { arm: "tool-card", startedAt: new Date().toISOString(), sandbox }
const fail = (reason: string): never => {
  result["ok"] = false
  result["reason"] = reason
  writeFileSync(join(HERE, "result.json"), `${JSON.stringify(result, null, 2)}\n`)
  process.stderr.write(`[t7-toolcard] FAIL: ${reason}\n`)
  process.exit(1)
  throw new Error(reason)
}

// 1) Seed the sandbox exactly as the QA discipline requires: credentials ONCE, settings when present.
const creds = join(homedir(), ".dsh", ".credentials.yaml")
if (!existsSync(creds)) fail("no ~/.dsh/.credentials.yaml to seed the sandbox from")
const seeded = seedSandboxCredentials(dshHome, { credentialsFile: creds })
result["credentials"] = { seeded: seeded.seeded === true, keyName: seeded.keyName }
const settings = join(homedir(), ".dsh", "settings.yaml")
if (existsSync(settings)) cpSync(settings, join(dshHome, "settings.yaml"))
result["settingsCopied"] = existsSync(join(dshHome, "settings.yaml"))
const env: Env = credentialEnv({ ...process.env, DSH_HOME: dshHome, HOME: join(sandbox, "home") })

// 2) Install the bundle rows into the sandbox profile (the same install every QA lane runs).
const install = spawnSync(process.execPath, [join(REPO, "scripts", "install-profile.ts"), "--yes", "--dsh-home", dshHome, "--profile", "mpd-headless", "--skip-toolchain"], { env, cwd: ws, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 600000 })
result["install"] = { exit: install.status, tail: `${install.stdout ?? ""}${install.stderr ?? ""}`.slice(-1200) }
if (install.status !== 0) fail(`install-profile exited ${String(install.status)}`)

// 3) One headless session. stdio goes to FILES (T-24: a piped dsh can hang on inherited fds).
const spec = dshCommand(["--profile", "mpd-headless", PROMPT], env)
if (spec === null) fail("no dsh launcher on PATH")
const runLog = join(HERE, "session.log")
const fd = openSync(runLog, "w")
let runStatus: number | null = null
try {
  const run = spawnSync(spec.command, spec.args, { env, cwd: ws, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000, stdio: ["ignore", fd, fd] })
  runStatus = run.status
} finally {
  closeSync(fd)
}
result["session"] = { exit: runStatus, log: "session.log" }

// 4) Decode the harness's store for THIS workspace, frame by frame, and keep the raw tool records.
const events = readSessionEvents(dshHome, { workspace: ws })
const toolRecords = events.records.filter((record) => record["type"] === "tool/call" || record["type"] === "tool/result")
writeFileSync(join(HERE, "records.json"), `${JSON.stringify(toolRecords, null, 2)}\n`)
result["records"] = { total: events.records.length, toolRecords: toolRecords.length, file: "records.json" }
if (toolRecords.length === 0) fail("the session log carries no tool records at all")

// 5) Find every `dsh-go/view` in a tool/result record, with the path that carries it.
const hits: ViewHit[] = []
for (const record of toolRecords) {
  if (record["type"] !== "tool/result") continue
  findViews(record, "$", hits, String(record["type"] ?? ""))
}
result["hits"] = hits.map((hit) => ({ path: hit.path, recordType: hit.recordType }))
if (hits.length === 0) fail("no tool/result record carries meta[\"dsh-go/view\"]")

// 6) Judge the FIRST card: v1-legality, the toolCard budget, and the app checker.
const chosen = hits[0]
const view = chosen.view
writeFileSync(join(HERE, "card.json"), `${JSON.stringify(view, null, 2)}\n`)
const measured = measureView(view)
const budget = BUDGETS.toolCard
const violations = v1Violations(view)
const checker = spawnSync(process.execPath, [CHECKER, "-", "--budget", "toolCard"], { input: JSON.stringify(view), encoding: "utf8", timeout: 120000 })
result["card"] = {
  path: chosen.path,
  bytes: measured.bytes,
  nodes: measured.nodes,
  depth: measured.depth,
  budget,
  withinBudget: measured.bytes <= budget.bytes && measured.nodes <= budget.nodes && measured.depth <= budget.depth,
  v1Violations: violations,
  checkerExit: checker.status,
  checkerOutput: `${checker.stdout ?? ""}${checker.stderr ?? ""}`.trim(),
}
const ok = result["card"] as Record<string, unknown>
if (ok["withinBudget"] !== true) fail(`the card exceeds the toolCard budget: ${JSON.stringify(measured)}`)
if (violations.length > 0) fail(`the card is not v1-legal: ${violations.join("; ")}`)
if (checker.status !== 0) fail(`the app checker refused the card (exit ${String(checker.status)})`)

result["ok"] = true
result["finishedAt"] = new Date().toISOString()
writeFileSync(join(HERE, "result.json"), `${JSON.stringify(result, null, 2)}\n`)
process.stdout.write(`[t7-toolcard] PASS: ${String(measured.bytes)} B / ${String(measured.nodes)} nodes / depth ${String(measured.depth)} at ${chosen.path}\n`)
