// Diagnostics channel for the mpd TUI surfaces.
//
// TUI discipline (spec §质量与安全红线): stdout stays SILENT while a TUI session
// is live — a plugin that console.log()s corrupts the rendered frame. Every
// message therefore goes to the host logger, and the fallback is stderr, only
// when the operator asked for it with DSH_TUI_DEBUG.
import type { LoggerLike } from "./types.js"

/** The plugin's diagnostic sink: one method per host level, none of them writing to stdout. */
export interface Log {
  /** Records a normal surface event; always emitted when a sink exists. */
  info(message: string): void
  /** Records a degradation or a refusal; always emitted when a sink exists. */
  warn(message: string): void
  /** Records a wiring detail, emitted only when `DSH_TUI_DEBUG` is set (or a host logger exists). */
  debug(message: string): void
}

/**
 * Build the plugin logger.
 * @param logger - the host logger (`ctx.logger`), when present.
 * @param prefix - the `[tag]` prefixed to every message.
 * @param env - environment override (testing).
 * @returns a logger that never throws and never writes to stdout.
 */
export function createLog(logger: LoggerLike | undefined, prefix: string, env: Record<string, string | undefined> = process.env): Log {
  /** Delivers one message to the first sink that answers: the host logger, then stderr. */
  const emit = (level: "info" | "warn" | "debug", message: string): void => {
    /** The exact line a sink receives, tagged so every diagnostic names its producer. */
    const text = `[${prefix}] ${message}`
    try {
      /** The host logger's method for this level, absent when the logger is partial. */
      const sink = logger?.[level]
      if (typeof sink === "function") {
        sink.call(logger, text)
        return
      }
    } catch {
      // A broken logger must never break apply or a render path.
    }
    if (level === "debug" && env.DSH_TUI_DEBUG === undefined) return
    try {
      process.stderr.write(`${text}\n`)
    } catch {
      // stderr closed: drop the line rather than throw.
    }
  }
  return {
    info: (message: string) => emit("info", message),
    warn: (message: string) => emit("warn", message),
    debug: (message: string) => emit("debug", message),
  }
}
