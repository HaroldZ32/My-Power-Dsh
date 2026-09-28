// mpd-codegraph: CodeGraph binary resolution + project initialization (mirrors the upstream original session-start discipline:
// exact-marker probing, atomic lock, failure cooldown capped at 15 min, 60 s tree timeout), and registers the mpd-codegraph command for manual re-runs.
// Zero runtime dependencies; any failure is only logged and never crashes boot.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bundleRootOf, resolveDshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"

/** The plugin id the bundle row mounts this module under. */
export const name = "mpd-codegraph"
/** No declared dependencies: the plugin applies against zero harness services and only logs a status line. */
export const inject = []

/** The slice of the row context this plugin reads: only the service lookup the adapter resolves through. */
type Ctx = { get?(key: string): unknown; [k: string]: unknown }
/** The row's config: the auto-init switch, the init timeout, the failure cooldown and an explicit binary override. */
type Config = { autoInit?: boolean; initTimeoutMs?: number; cooldownMs?: number; binary?: string }
// The one seam this plugin needs from the adapter: the workspace plane. Typed
// structurally so the plugin still builds/behaves standalone in unit tests.
type WorkspacePlane = { workspaceRoot(exec?: { agent?: unknown }): string }
// The adapter surface this plugin actually uses: the workspace plane plus the
// command seam (AGENTS.md §6: a plugin never touches the harness command
// registry directly, and the adapter degrades to a no-op when it is absent).
type AdapterSeams = WorkspacePlane & {
  registerCommand(definition: { name: string; description: string; handler: (invocation: CommandInvocation) => unknown }): () => void
}
// The harness command handler receives {commandId, agent, rawInput, attachments, signal};
// only `agent` matters here (it is what workspaceRoot reads for the session cwd).
type CommandInvocation = { agent?: unknown }

// The bundle root: this plugin's dist is <bundle>/packages/mpd-codegraph-plugin/dist/index.js,
// which resolves to the checkout in a `link:` install and to the installed
// package root in a packed install. Bundle-relative, never a hard-coded repo path.
function bundleRoot(): string { return bundleRootOf(import.meta.url) }

/** The `codegraph` executable shipped inside the npm package, or null when that package cannot be resolved from here. */
function packageCodegraphPath(): string | null {
  try {
    /** A `require` bound to this module, used only to resolve the optional package's entry path. */
    const req = createRequire(import.meta.url)
    /** The resolved path of the package's own `package.json`, from which its install directory is derived. */
    const p = req.resolve("@colbymchenry/codegraph/package.json")
    /** That manifest, read to learn which file its `bin` entry names. */
    const binEntry = JSON.parse(readFileSync(join(dirname(p), "package.json"), "utf8"))
    /** The manifest's bin target: a plain string, the `codegraph` key of a bin map, or the conventional name. */
    const bin = typeof binEntry.bin === "string" ? binEntry.bin : (binEntry.bin?.codegraph ?? "codegraph")
    return join(dirname(p), bin)
  } catch { return null }
}

// B8 (wave 2): the checkout layout installs the toolchain under
// <bundle>/.toolchain (scripts/install-mcp.ts / install-profile.ts); pnpm never
// hoists a `link:` dependency's optionalDependencies into the profile, so the
// createRequire tier above cannot see them there. Mirrors mpd-comment-checker.
function toolchainCodegraphPath(): string | null {
  /** The toolchain's own `codegraph` shim, installed beside the bundle by the repo's installer scripts. */
  const p = join(bundleRoot(), ".toolchain", "node_modules", ".bin", "codegraph")
  return existsSync(p) ? p : null
}

/** Resolve the codegraph executable: config override, env override, package bin, toolchain shim, then PATH. */
function resolveBinary(config?: Config): string | null {
  /** The explicit overrides, highest priority first; blanks are dropped so an empty env var is not a candidate. */
  const candidates = [
    config?.binary, process.env.MPD_CODEGRAPH_BIN ?? process.env.MPD_DSH_CODEGRAPH_BIN
  ].filter((s): s is string => !!s && s.length > 0)
  for (const c of candidates) if (existsSync(c)) return c
  /** The executable the optional npm package ships, when that package is installed here. */
  const pkgBin = packageCodegraphPath()
  if (pkgBin && existsSync(pkgBin)) return pkgBin
  /** The checkout-local toolchain shim, which is where a `link:` install keeps the binary. */
  const toolchain = toolchainCodegraphPath()
  if (toolchain) return toolchain
  for (const p of (process.env.PATH || "").split(":")) {
    /** One PATH entry's `codegraph`, accepted only when it really exists. */
    const f = join(p, "codegraph")
    if (existsSync(f)) return f
  }
  return null
}

// O-1 (wave 3): codegraph is the ONE workspace consumer that resolves at APPLY
// time, before any session exists, so it cannot take a tool exec and goes through
// the adapter's workspace plane instead of a bare `process.cwd()` chain. Order,
// highest first:
//   1. `MPD_CODEGRAPH_PROJECT_CWD` / `MPD_DSH_CODEGRAPH_PROJECT_CWD` — explicit
//      override. It is ALSO the adopted MCP child's project-cwd env (serve.js
//      projectCwd precedence: MPD_CODEGRAPH_PROJECT_CWD -> session-start cwd ->
//      PWD), and the child's env is frozen when the row spawns it, so this stays
//      the documented escape hatch for the child;
//   2. `dsh.workspaceRoot(exec)` — the calling session's workspace when a
//      command invocation supplies one; its exec-less form (apply time) resolves
//      DSH_WORKSPACE_ROOT -> process.cwd(), which is why the operator/QA override
//      is what makes an exec-less consumer session-correct;
//   3. `process.cwd()` — the adapter's own last tier (boot, unit tests).
function resolveProjectRoot(dsh: WorkspacePlane, exec?: CommandInvocation): string {
  /** The explicit project-cwd override, trimmed; an empty string means no override was configured. */
  const override = (process.env.MPD_CODEGRAPH_PROJECT_CWD ?? process.env.MPD_DSH_CODEGRAPH_PROJECT_CWD ?? "").trim()
  if (override.length > 0) return resolve(override)
  return resolve(dsh.workspaceRoot(exec))
}

/** Whether the last failed init is still inside the cooldown window, i.e. whether a retry must be skipped. */
function cooldownFresh(cwd: string, cooldownMs: number): boolean {
  /** The cooldown stamp, whose mtime records when the last init attempt finished. */
  const stamp = join(cwd, ".codegraph", "init.cooldown")
  if (!existsSync(stamp)) return false
  try {
    /** How long ago that attempt was stamped, in milliseconds. */
    const age = Date.now() - statSync(stamp).mtimeMs
    return age < cooldownMs
  } catch { return false }
}

/** Run `codegraph init` in a project, guarded by a marker check, an atomic lock directory and a cooldown stamp. */
function initProject(cwd: string, binary: string, timeoutMs: number): string {
  /** The index file whose presence means the project is already initialized. */
  const marker = join(cwd, ".codegraph", "codegraph.db")
  if (existsSync(marker)) return "marker"
  /** The lock directory: `mkdir` is atomic, so whoever creates it owns this init. */
  const lock = join(cwd, ".codegraph", "init.lock")
  /** The `.codegraph` directory that must exist before the lock can be created inside it. */
  const lockDir = join(cwd, ".codegraph")
  try {
    mkdirSync(lockDir, { recursive: true })
    mkdirSync(lock, { recursive: false })
  } catch { return "locked" }
  try {
    /** The init child's result; success additionally requires the marker to exist afterwards. */
    const r = spawnSync(binary, ["init"], { cwd, timeout: timeoutMs, stdio: "ignore" })
    if (r.status === 0 && existsSync(marker)) return "ok"
    return r.status === 0 ? "fail-no-marker" : "fail"
  } finally {
    try { rmSync(lock, { recursive: true, force: true }) } catch { /* ignore */ }
    try { writeCooldown(join(cwd, ".codegraph"), "init.cooldown") } catch { /* ignore */ }
  }
}

/** Stamp the given cooldown file with the current time; an unwritable target is deliberately ignored. */
function writeCooldown(dir: string, file: string): void {
  try { writeFileSync(join(dir, file), String(Date.now())) } catch { /* ignore */ }
}

/**
 * Resolve the project root and the codegraph binary, initialize the index when the row allows it, and
 * register the `/mpd-codegraph` command for manual re-runs.
 *
 * @param ctx - the row context; the adapter resolves the workspace plane and the command seam from it.
 * @param config - row overrides for auto-init, the init timeout, the cooldown and the binary.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  // Every harness seam goes through the shared adapter (see packages/mpd-dsh-adapter-plugin):
  // the mounted instance when present, the standalone fallback otherwise.
  const dsh = resolveDshAdapter(ctx) as AdapterSeams
  /** Whether apply-time initialization runs at all; a row may disable it and use the command instead. */
  const autoInit = config.autoInit ?? true
  /** How long one `codegraph init` may run before it is killed. */
  const timeoutMs = config.initTimeoutMs ?? 60_000
  /** How long a failed init suppresses the next attempt, so a broken binary cannot retry on every boot. */
  const cooldownMs = config.cooldownMs ?? 15 * 60_000
  /** The project root this apply-time pass resolves; the command handler re-resolves its own per call. */
  const cwd = resolveProjectRoot(dsh)
  /** The resolved binary, or null when no tier found one. */
  const binary = resolveBinary(config)
  /** The single status word this pass logs, and the only thing that distinguishes the paths below. */
  let status: string
  /** The user's home directory, compared against the root so a session started in `~` skips indexing it. */
  const home = resolve(homedir())
  if (!binary) { status = "no-binary" }
  else if (existsSync(join(cwd, ".codegraph", "codegraph.db"))) { status = "marker" }
  else if (!autoInit) { status = "auto-init-disabled" }
  else if (resolve(cwd) === home) { status = "skipped-home" }
  else if (cooldownFresh(cwd, cooldownMs)) { status = "cooldown" }
  else { status = initProject(cwd, binary, timeoutMs) }
  console.log("[mpd-codegraph] init status=" + status + " binary=" + (binary ?? "-") + " cwd=" + cwd + (status === "skipped-home" ? " (workspace is the user home; start a session inside a project dir, or set MPD_DSH_CODEGRAPH_PROJECT_CWD, or run /mpd-codegraph there)" : ""))

  // Manual re-run command, registered THROUGH THE ADAPTER (AGENTS.md §6: no plugin
  // touches `ctx.commands` / `ctx.get("commands")` directly). The adapter returns a
  // no-op disposer when the composition has no command registry, so this stays a
  // harmless no-op there instead of a swallowed error.
  // O-1: this is the CALL-TIME consumer — it re-resolves the root per invocation
  // through `dsh.workspaceRoot(invocation)`, so a session whose workspace differs
  // from the dsh process cwd re-runs against its OWN project. The handler returns
  // the harness CommandResult shape (`{kind}`), which dsh-commands validates
  // (dsh-commands/lib/index.js `normalizeResult`); the older `{success,error}`
  // shape would have been rejected as "must return a CommandResult".
  dsh.registerCommand({
    name: "mpd-codegraph",
    description: "Initialize/re-run the CodeGraph index (.codegraph/codegraph.db)",
    handler: async (invocation: CommandInvocation) => {
      /** The binary resolved for THIS invocation, so one installed after apply is still picked up. */
      const b = resolveBinary(config)
      if (!b) return { kind: "error", text: "codegraph binary unavailable: install it or set MPD_DSH_CODEGRAPH_BIN" }
      /** The project root of this invocation's session, resolved per call rather than cached at apply. */
      const target = resolveProjectRoot(dsh, invocation)
      /** This invocation's outcome: an existing marker short-circuits the init entirely. */
      const s = existsSync(join(target, ".codegraph", "codegraph.db")) ? "marker" : initProject(target, b, timeoutMs)
      return { kind: s === "ok" || s === "marker" ? "success" : "error", text: "mpd-codegraph init: " + s + " (" + target + ")" }
    },
  })
}
