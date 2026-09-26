// The `mpd` settings namespace: ONE source for its schema, its knob metadata and the disclosure
// both front doors state.
//
// §10.1 places the REGISTRATION in this package (it is the only module that can supply the
// file-derived `base`); the TUI package keeps a guarded fallback for compositions without this
// plugin. Both therefore read the schema and the field list from HERE, so the two front doors
// cannot drift and the thirteen knobs stay one declaration.
import z from "../../mpd-agent-teams-plugin/_deps/schemastery"

/** The settings namespace the section and the Web card both edit. */
export const SETTINGS_NS = "mpd"

/**
 * The mpd.jsonc knob schema (mirrors the keys `packages/mpd-config-plugin` consumes). The
 * defaults here are the design's L0 layer; the file-derived values arrive as the namespace `base`.
 */
export const SettingsSchema = z.object({
  hashline: z.object({ maxDiffChars: z.number().default(20000) }),
  commentChecker: z.object({ autoCheck: z.boolean().default(true) }),
  ulw: z.object({ maxRounds: z.number().default(6) }),
  memory: z.object({ vcs: z.union([z.const("git"), z.const("svn")]).default("git") }),
  team: z.object({ stateDir: z.string().default(".mpd/team") }),
  boulder: z.object({ dir: z.string().default(".mpd") }),
  // The watchdog block is the §3 defaults table of the frozen contract and MUST stay byte-equal in
  // value to `packages/mpd-team-watchdog-plugin/src/machine.ts` `WATCHDOG_DEFAULTS` and to the
  // `mpd-team-watchdog` row config in `packages/mpd-bundle/cordis.patch.yml` — those are the three
  // declaration layers, and the T-18 cross-layer check reads them side by side. `warnSilenceMs`
  // moved 90 s -> 10 min and `actionOnEscalate` defaults to `warn-only` because the redesign's
  // predicate (not wall-clock silence) owns the WARN, and a hold must not latch by default;
  // `holdTtlMs` is the T-17 bound that auto-releases a hold (`0` disables the expiry).
  watchdog: z.object({
    enabled: z.boolean().default(true),
    warnSilenceMs: z.number().default(600000),
    tickIntervalMs: z.number().default(15000),
    warnStreakToEscalate: z.number().default(6),
    actionOnEscalate: z.union([z.const("pause"), z.const("warn-only")]).default("warn-only"),
    toolInFlightMaxMs: z.number().default(900000),
    holdTtlMs: z.number().default(900000),
  }),
})

/** The two-part disclosure every surface must be able to show (§D.2, and the "not lost" clause). */
export const BRIDGE_DISCLOSURE = "a save writes <workspace>/.mpd/mpd.jsonc for the live session workspace(s) and takes effect for the mpd plugins after a restart (this knob is read at plugin mount) — it applies at the next dsh boot, because the file-derived base is fixed for the running process's lifetime"

/**
 * The HOST LIMITATION half of the truth (T-18), stated where the user meets it rather than papered
 * over: the file-derived base is captured at plugin mount and stays fixed for the process lifetime,
 * so a hand edit of `.mpd/mpd.jsonc` (or of any file-backed value) can never reach the running
 * process — only the next `dsh` boot reads it. The settings document is the only path that can
 * reach a RUNNING plugin, and only where that plugin subscribes to the host's settings-document
 * update (the watchdog engine does, `engine.ts` `onSettingsDocumentUpdated`); nothing in this
 * change proves that seam is exposed on the installed host, so the sentence stays true by being
 * conditional instead of claiming a live reload the wave did not measure.
 */
export const BRIDGE_RESTART_LIMIT =
  "the file half is host-limited: a .mpd/mpd.jsonc edit is read once at plugin mount and stays fixed for the running process, so it applies at the next dsh boot and never mid-process; only a change made through this settings document can reach a running plugin, and only where the plugin subscribes to the host's settings-document update"

/**
 * The sentence that keeps a settings-only save from reading as a LOST save (captain's ruling 1):
 * the value lives in the host-global settings document and the read-in layer applies it to every
 * workspace's resolved config immediately, so a refusal is a persistence delay, never data loss.
 */
export const BRIDGE_NOT_LOST =
  "the value is never lost: it is stored in the host settings document and the config layer applies it to every workspace immediately — only the file write waits for exactly one live session"

/** The runtime notice for a save that had no live session workspace to write (§D.2 row 2). */
export const BRIDGE_NO_WORKSPACE_NOTICE = "saved to settings — not yet written to any .mpd/mpd.jsonc (no live session)"

/** The runtime notice for a save with several live roots: settings-only, per the refusal rule. */
export const BRIDGE_AMBIGUOUS_NOTICE = "saved to settings — not written to any file: several live workspaces, so the target is ambiguous (see the log for the candidates)"

/** One knob: the decoded settings path plus the labels both front doors render. */
export interface SettingsKnob {
  readonly path: readonly string[]
  readonly label: string
  readonly zh: string
  readonly kind: "number" | "boolean" | "select" | "text"
  readonly options?: readonly string[]
  /**
   * One sentence of SEMANTICS for a knob whose effect is not self-evident from its label
   * (w16). A front door renders it next to the row when it has room for a second line; the
   * label/zh above stay short because they are the row's title.
   */
  readonly hint?: string
}

/** The thirteen knobs, in display order. */
export const SETTINGS_KNOBS: readonly SettingsKnob[] = [
  { path: ["hashline", "maxDiffChars"], label: "Inline diff limit", zh: "行内 diff 上限", kind: "number" },
  { path: ["commentChecker", "autoCheck"], label: "Comment checker", zh: "注释检查", kind: "boolean" },
  { path: ["ulw", "maxRounds"], label: "Ultrawork rounds", zh: "Ultrawork 轮数", kind: "number" },
  { path: ["memory", "vcs"], label: "Memory backend", zh: "记忆后端", kind: "select", options: ["git", "svn"] },
  { path: ["team", "stateDir"], label: "Team state directory", zh: "团队状态目录", kind: "text" },
  { path: ["boulder", "dir"], label: "Boulder directory", zh: "Boulder 目录", kind: "text" },
  { path: ["watchdog", "enabled"], label: "Watchdog enabled", zh: "看门狗启用", kind: "boolean" },
  { path: ["watchdog", "warnSilenceMs"], label: "Silence warning threshold (ms)", zh: "静默告警阈值（毫秒）", kind: "number" },
  { path: ["watchdog", "tickIntervalMs"], label: "Watchdog tick interval (ms)", zh: "看门狗轮询间隔（毫秒）", kind: "number" },
  { path: ["watchdog", "warnStreakToEscalate"], label: "Warn streak before escalation", zh: "升级前连续告警次数", kind: "number" },
  { path: ["watchdog", "actionOnEscalate"], label: "Action on escalation", zh: "升级时的动作", kind: "select", options: ["pause", "warn-only"] },
  { path: ["watchdog", "toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", hint: "how long ONE tool call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a `tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables the bound" },
  { path: ["watchdog", "holdTtlMs"], label: "Hold TTL (ms, 0 = no expiry)", zh: "暂停持有有效期（毫秒，0 表示不设有效期）", kind: "number", hint: "how long a watchdog hold may stay latched before it auto-releases: past this bound the hold releases itself and changes ZERO team bytes, and activity newer than the hold releases it sooner — `0` disables the expiry" },
]
