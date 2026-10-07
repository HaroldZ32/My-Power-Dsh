// Diagnostics channel for the mpd TUI surfaces.
//
// TUI discipline (spec §质量与安全红线): a live TUI session OWNS the terminal — it renders on the
// alternate screen, and a stray write to fd 1 or fd 2 corrupts the frame. Every message therefore
// goes to the host logger, and the fallback is a FILE under `<workspace>/.mpd/logs/`, never stderr
// (requirement R5: MPD's terminal reporting used to turn the TUI window into a mess).
//
// The SINK comes from the seam adapter (`tui.diagnosticSink(...)`), which is also where the file
// primitives live: this package's built dist must carry no filesystem writer of its own (the QA
// lane pins that invariant on the built bytes), and a consumer has no business opening files — it
// asks the adapter for a sink.
//
// `DSH_TUI_DEBUG` still gates `debug`: without it a debug line is dropped even from the file,
// because the file is a record of what a user would otherwise have been told.
import type { DiagnosticSink, LoggerLike } from "./types.js"

/** The plugin's diagnostic sink: one method per host level, none of them writing to a terminal. */
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
 * @param sink - the FILE fallback, resolved lazily on the first line the host logger did not take.
 *   When omitted, a line the host logger refuses is DROPPED — the logger never falls back to a
 *   terminal fd, which is the whole point of requirement R5.
 * @returns a logger that never throws and never writes to a terminal.
 */
export function createLog(
  logger: LoggerLike | undefined,
  prefix: string,
  env: Record<string, string | undefined> = process.env,
  sink?: () => DiagnosticSink,
): Log {
  /** The file fallback, created at most once per logger. */
  let fallback: DiagnosticSink | undefined
  /** Delivers one message to the first sink that answers: the host logger, then the FILE sink. */
  const emit = (level: "info" | "warn" | "debug", message: string): void => {
    /** The exact line a sink receives, tagged so every diagnostic names its producer. */
    const text = `[${prefix}] ${message}`
    try {
      /** The host logger's method for this level, absent when the logger is partial. */
      const hostSink = logger?.[level]
      if (typeof hostSink === "function") {
        hostSink.call(logger, text)
        return
      }
    } catch {
      // A broken logger must never break apply or a render path.
    }
    if (level === "debug" && env.DSH_TUI_DEBUG === undefined) return
    if (sink === undefined) return
    try {
      fallback ??= sink()
      fallback.write(text)
    } catch {
      // A diagnostic sink is best-effort; dropping a line beats crashing a render.
    }
  }
  return {
    info: (message: string) => emit("info", message),
    warn: (message: string) => emit("warn", message),
    debug: (message: string) => emit("debug", message),
  }
}
