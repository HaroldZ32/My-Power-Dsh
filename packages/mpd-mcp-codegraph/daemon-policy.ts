// CodeGraph shared-daemon policy for the mpd MCP launcher.
//
// WHY THIS EXISTS (measured 2026-09-14): the adopted CodeGraph MCP server runs a
// per-project-root SHARED DAEMON (`<projectRoot>/.codegraph/daemon.{sock,pid}`, one
// engine shared by every session) and proxies tool calls to it; when that daemon
// goes away mid-session it degrades gracefully and says so:
//
//   [CodeGraph MCP] Shared daemon connection lost; serving this session in-process (degraded), re-serving 0 in-flight request(s).
//
// That line is not an error (upstream #662: nothing in flight is lost, the session
// keeps working from its own engine), but in this deployment the daemon is lost for
// reasons the SESSION cannot control:
//
//   * upstream reaps a daemon that has had no traffic for 30 minutes even while a
//     client is still connected (`DEFAULT_MAX_IDLE_MS`, daemon.js — the #692
//     backstop), so any session idle longer than that drops to in-process and logs
//     the line once;
//   * a `codegraph daemon` stop (the CLI picker) SIGTERMs it;
//   * the rendezvous itself is pid-liveness based: the lockfile holds a pid and the
//     next boot asks `process.kill(pid, 0)` whether it is alive. Inside a PID
//     namespace (a sandboxed boot — every QA case, and any dsh launched from one)
//     that pid does not exist, so a LIVE daemon's lock is judged stale, its socket
//     and pidfile are swept, and each boot spawns its own daemon for the same root.
//
// Serving one engine per session is exactly what the degraded path already does, so
// the bundle makes it the DEFAULT and removes the whole class: no shared daemon, no
// lock/socket rendezvous, no sweep race, no "connection lost" line. The on-disk index
// (`<projectRoot>/.codegraph/codegraph.db`) is still shared between sessions — only
// the engine/watcher is per session.
//
// Knobs (env, both kept deliberately small):
//   MPD_CODEGRAPH_DAEMON=1   restore upstream's shared daemon (one engine per root)
//   MPD_CODEGRAPH_DAEMON=0   force in-process serving (the default; explicit is fine)
//   CODEGRAPH_NO_DAEMON=1    upstream's own opt-out — respected, never overridden
//
// The env the child actually reads is built by the vendored bridge
// (`buildCodegraphChildEnv`), whose runtime allowlist already carries
// `CODEGRAPH_NO_DAEMON`, so setting it here reaches the server. `MPD_CODEGRAPH_DAEMON`
// is ours (the `MPD_*` namespace is the bundle's) and is consumed only here.

/** The bundle's own knob: `1` restores upstream's shared daemon, `0` asks for in-process serving. */
export const POLICY_ENV = "MPD_CODEGRAPH_DAEMON"
/** Upstream's own opt-out key, forwarded to the child by the vendored bridge's env allowlist. */
export const NO_DAEMON_ENV = "CODEGRAPH_NO_DAEMON"

/** Spellings that select the shared daemon. */
const TRUTHY = new Set(["1", "true", "on", "yes", "daemon", "shared"])
/** Spellings that select in-process serving. */
const FALSY = new Set(["0", "false", "off", "no", "in-process", "inprocess", "direct"])

/**
 * One env bag: the launcher's live `process.env`, or a fixture standing in for it.
 * A key that is absent or empty is "unset"; both cases are read through this shape.
 */
export type DaemonEnv = Record<string, string | undefined>

/** The pure decision for one child, before anything is written into a live env. */
export interface DaemonPolicy {
  /** `true` means the launcher pins `CODEGRAPH_NO_DAEMON=1`; `false` leaves the daemon path enabled. */
  noDaemon: boolean
  /** Why this outcome was chosen, in one human-readable sentence (goes to stderr). */
  reason: string
  /** Non-empty only when the caller asked for something that cannot be honoured. */
  warning: string
}

/** The policy after it has been applied to a live env, plus the single line it asked to print. */
export interface AppliedDaemonPolicy extends DaemonPolicy {
  /** Whether this call had to mutate the env (a redundant pin reports `false`). */
  changed: boolean
  /** The one stderr line the launcher prints, or `""` when nothing had to change. */
  notice: string
}

/** The launcher's optional diagnostics sink; absent means "decide silently". */
export interface DaemonLogOptions {
  /** Receives the single notice line when the policy produced one. */
  log?: (line: string) => void
}

/** Parse one env value: true (shared daemon), false (in-process), null (unset), undefined (invalid). */
export function parseDaemonSetting(raw: unknown): boolean | null | undefined {
  /** The spelling actually compared: trimmed and lower-cased, so `ON` and `on` agree. */
  const value = String(raw ?? "").trim().toLowerCase()
  if (value === "") return null
  if (TRUTHY.has(value)) return true
  if (FALSY.has(value)) return false
  return undefined
}

/**
 * Pure decision: what to do with the shared daemon for this child.
 * Returns `{ noDaemon, reason, warning }` — `noDaemon: true` means the launcher pins
 * `CODEGRAPH_NO_DAEMON=1`, `false` means it leaves the daemon path enabled.
 */
export function resolveDaemonPolicy(env: DaemonEnv = {}): DaemonPolicy {
  /** Our own knob, as the three-way parse reports it. */
  const setting = parseDaemonSetting(env[POLICY_ENV])
  /** Upstream's opt-out, which outranks our knob whenever it is explicitly set to 1. */
  const upstream = parseDaemonSetting(env[NO_DAEMON_ENV])
  if (upstream === true) {
    return {
      noDaemon: true,
      reason: NO_DAEMON_ENV + "=1 is set: upstream's own opt-out is respected (in-process serving)",
      warning: setting === true ? POLICY_ENV + "=1 cannot override an explicit " + NO_DAEMON_ENV + "=1" : "",
    }
  }
  if (setting === undefined) {
    return {
      noDaemon: true,
      reason: POLICY_ENV + " has an unrecognized value " + JSON.stringify(String(env[POLICY_ENV]))
        + " — falling back to the default (in-process); use 1 for the shared daemon or 0 for in-process",
      warning: POLICY_ENV + "=" + String(env[POLICY_ENV]) + " is not a recognized value",
    }
  }
  if (setting === true) {
    return { noDaemon: false, reason: POLICY_ENV + "=1: upstream's shared daemon is enabled explicitly", warning: "" }
  }
  if (setting === false) {
    return { noDaemon: true, reason: POLICY_ENV + "=" + String(env[POLICY_ENV]) + ": in-process serving requested explicitly", warning: "" }
  }
  return {
    noDaemon: true,
    reason: "default: one engine per session (the shared daemon's lockfile arbitration is unreliable in"
      + " sandboxed/namespaced hosts and upstream reaps it after 30 idle minutes, which is what logged"
      + " \"Shared daemon connection lost … serving this session in-process\"; set " + POLICY_ENV + "=1 to share one daemon per project root)",
    warning: "",
  }
}

/**
 * Apply the policy to a live env object (the launcher's `process.env`) and return
 * `{ changed, noDaemon, reason, warning, notice }` — `notice` is the single stderr
 * line the launcher prints, or "" when nothing had to change.
 */
export function applyDaemonPolicy(env: DaemonEnv, { log }: DaemonLogOptions = {}): AppliedDaemonPolicy {
  /** The decision this call applies; it is computed before the env is touched. */
  const policy = resolveDaemonPolicy(env)
  /** Whether the pin had to be written (false when the env already carried it). */
  let changed = false
  if (policy.noDaemon && env[NO_DAEMON_ENV] !== "1") {
    env[NO_DAEMON_ENV] = "1"
    changed = true
  }
  /** The line to print: empty means "nothing changed and nothing to warn about". */
  const notice = changed || policy.warning
    ? "[mpd-mcp-codegraph] " + (policy.warning ? policy.warning + "; " : "")
      + (policy.noDaemon ? "serving codegraph in-process (no shared daemon): " + policy.reason : policy.reason)
    : ""
  if (notice && typeof log === "function") log(notice)
  return { ...policy, changed, notice }
}
