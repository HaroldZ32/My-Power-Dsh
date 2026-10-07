// mpd-verify-plugin — the ROW of the verification law.
//
// WHAT IT OWNS: the durable ledger under `<workspace>/.mpd/verify/`, the process-local runtime (the
// observation log, the escape allowances, the counted diagnosis reads), the five `mpd_verify_*` tools and
// the boot marker that closes the `pre-plugin` exemption. What it does NOT own: the GUARD, which is
// installed by the `mpd-roles` row (`installVerifyGuard`, beside its read-only guard) because that row is
// already the one place a `guardTool` install lives — but the guard is DECIDED by the pure functions in
// `law.ts` and reads its state from the `mpdVerify` service this row publishes.
//
// WHY A SERVICE AND NOT A MODULE SINGLETON: `bun build` INLINES every imported module, so a module-level
// object imported by two packages becomes two objects — the roles row's guard would read an escape
// allowance this row never wrote. The service is resolved PER CALL, which also means the roles row may
// apply first (it does: `mpd-roles` sits above `mpd-verify` in the patch).
//
// DEGRADATION, never a boot failure: with no `tools.guard` seam the law degrades to bookkeeping and the
// boot line says `verifyGate=absent`; with no tool registry the tools are not registered and the line
// says so. The row never throws out of `apply`.
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { DshAdapter } from "../../mpd-dsh-adapter-plugin/src/index"
import { DSH_SEAM_TOOLS, createLazyDshAdapter, dshSeamInject, rowLogLine } from "../../mpd-dsh-adapter-plugin/src/index"
import { VERIFY_SERVICE } from "./service.ts"
import { resolvePositiveInt, resolveVerifyMode } from "./law.ts"
import { createVerifyRuntime, installDelegationObserver } from "./observe.ts"
import type { VerifyRuntime } from "./observe.ts"
import { DEFAULT_GATE_TIMEOUT_MS, DEFAULT_LOOP_TTL_MS, registerVerifyTools, writeBootMarker } from "./tools.ts"
import { readLoops, verifyRoot } from "./ledger.ts"

/** The cordis plugin name, matched against this row's id in the bundle patch. */
export const name = "mpd-verify"

/** The seams this row needs declared: the tool registry (registration and the capability probe). */
export const inject = dshSeamInject(DSH_SEAM_TOOLS)

/** The slice of a cordis context this row uses. */
type Ctx = {
  /** The tool registry seam. */
  tools: unknown
  /** Publish a service other rows resolve. */
  provide: (id: string, value: unknown, check?: unknown) => void
  /** Read another service; the config layer is read through it. */
  get?: (key: string, strict?: boolean) => unknown
  [key: string]: unknown
}

/**
 * The row config, mirroring the RAW `verify.*` keys of `.mpd/mpd.jsonc`.
 *
 * These knobs are deliberately NOT part of the `mpd` settings schema — the pinned `SETTINGS_KNOBS` count
 * must not move for a law that reads its own switches, and the settings UI surfacing them is a declared
 * non-goal of this wave.
 */
type Config = {
  /** `hard` (default) denies, `advisory` records, `off` disables the guard. */
  mode?: unknown
  /** How many writes one escape buys. */
  escapeUses?: unknown
  /** A loop's lifetime in milliseconds. */
  loopTtlMs?: unknown
  /** A gate's timeout in milliseconds. */
  gateTimeoutMs?: unknown
}

/**
 * Apply the row.
 *
 * @param ctx - the cordis context (the tool seam, `provide`, and the config service).
 * @param config - the row's own config, the fallback for every `verify.*` key.
 */
export function apply(ctx: Ctx, config: Config = {}): void {
  /** One-line reporter that also reaches the boot log, so a degradation is visible rather than implied. */
  const log = (line: string): void => { try { rowLogLine("mpd-verify", "[mpd-verify] " + line) } catch { /* logging never fails a boot */ } }

  /** The adapter, resolved lazily so the row survives a provider that is not ACTIVE yet. */
  const dsh = createLazyDshAdapter(ctx, { label: "mpd-verify" }) as DshAdapter

  /**
   * One `verify.*` knob, resolved PER CALL: the mounted config layer first (so a `.mpd/mpd.jsonc` edit is
   * picked up live, T-18), this row's own config second, `undefined` last so the default applies.
   */
  const configValue = (key: string): unknown => {
    /** The live config service, absent until the `mpd-config` row has applied. */
    const live = ((): { get?: (k: string) => unknown } | undefined => {
      try { return ctx.get?.("mpdConfig", false) as { get?: (k: string) => unknown } | undefined } catch { return undefined }
    })()
    /** The layer's answer, which wins whenever the key is really declared there. */
    const fromLayer = ((): unknown => { try { return live?.get?.(key) } catch { return undefined } })()
    if (fromLayer !== undefined) return fromLayer
    return (config as Record<string, unknown>)[key.slice("verify.".length)]
  }

  /** The process-local runtime: observations, escape allowances and counted diagnosis reads. */
  const runtime: VerifyRuntime = createVerifyRuntime({
    dsh,
    warn: (line) => log("warning: " + line),
    configValue,
    defaultEscapeUses: 1,
    loopTtlMs: resolvePositiveInt(configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS),
  })

  // THE SERVICE, published before anything else so the roles-row guard can resolve it on its first call
  // (that row applies first and resolves the law per call, never at apply time).
  try {
    ctx.provide(VERIFY_SERVICE, runtime)
  } catch (error) {
    log("could not publish the " + VERIFY_SERVICE + " service (" + (error instanceof Error ? error.message : String(error)) + ") — the guard will read an empty law")
  }

  /** The outcome fields the boot line reports, so a mount lane asserts the wiring instead of guessing. */
  const outcome: string[] = []

  // THE DELEGATION OBSERVER. Observe-only by construction (the adapter discards a listener's return
  // value), so this can arm a loop without ever altering the call it watched.
  try {
    installDelegationObserver(dsh, {
      runtime,
      loopTtlMs: resolvePositiveInt(configValue("verify.loopTtlMs"), DEFAULT_LOOP_TTL_MS),
      warn: (line) => log("warning: " + line),
    })
    outcome.push("delegationObserver=installed")
  } catch {
    outcome.push("delegationObserver=absent")
  }

  // THE FIVE TOOLS. Registered through the adapter's `registerTools`, so a partial surface is impossible.
  try {
    registerVerifyTools(dsh as Pick<DshAdapter, "registerTools">, {
      runtime,
      configValue,
      dsh,
      log: (line) => log(line),
    })
    outcome.push("tools=5")
  } catch (error) {
    outcome.push("tools=absent")
    log("the verification tools could not be registered (" + (error instanceof Error ? error.message : String(error)) + ")")
  }

  /** The mode in force, reported on the boot line so a mount lane can see what it is asserting. */
  const mode = resolveVerifyMode(configValue("verify.mode"))
  outcome.push("mode=" + mode)
  outcome.push("guard=" + (dsh.capabilities().toolsGuard === true ? "seam-present" : "no-guard-seam"))

  // THE BOOT MARKER, and it is LOAD-BEARING: a `pre-plugin` verification record is admissible only while
  // its `createdAt` precedes this instant, so the exemption closes itself the moment the law is live in a
  // workspace. It is written ONLY when the guard seam really exists — a composition that cannot enforce
  // anything must not close an exemption it will never use.
  /** The instant this row installed, reported on the boot line and stamped into the marker. */
  const installedAt = new Date().toISOString()
  if (dsh.capabilities().toolsGuard === true) {
    try {
      /** The boot-time workspace root. A session's own root is marked lazily by the tools that use it. */
      const root = dsh.workspaceRoot()
      if (root !== "" && writeBootMarker(root, installedAt)) outcome.push("bootMarker=written")
      else outcome.push("bootMarker=unwritten")
    } catch {
      outcome.push("bootMarker=unwritten")
    }
  } else {
    outcome.push("bootMarker=skipped")
  }

  /** The loops already of record for the boot workspace, so the line reports a real number. */
  let loopCount = 0
  try { loopCount = readLoops(dsh.workspaceRoot()).length } catch { loopCount = 0 }
  log("verifyGate=" + (dsh.capabilities().toolsGuard === true ? "installed" : "absent")
    + " loops=" + loopCount + " installedAt=" + installedAt + " " + outcome.join(" "))
}

/**
 * Whether a workspace already carries the law's boot marker.
 *
 * Exported because the guard, the tools and a mount lane all need to answer it, and one spelling of the
 * path is what keeps them agreeing.
 *
 * @param workspace - the workspace root.
 * @returns true when `<workspace>/.mpd/verify/boot.json` exists.
 */
export function hasBootMarker(workspace: string): boolean {
  return existsSync(join(verifyRoot(workspace), "boot.json"))
}
