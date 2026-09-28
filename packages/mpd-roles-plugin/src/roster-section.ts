// The roster as TEAMMATE TEMPLATES for the OFFICIAL Agent Teams plugin (AGENTS.md §13).
//
// The retired vendored plugin carried the roster as profile member templates in the bundle
// patch; the official plugin has no profile concept, so the roster reaches the Lead through
// an AGENT-SCOPED system-prompt section instead. Agent scope is the point: the section is
// contributed to the mpd preset's OWN sessions (a top-level session, never a teammate's or
// another preset's), which the host-plane `registerPromptSection` could not express.
//
// The text is deliberately compact — a model pays for it every turn — and it states the
// MEASURED bound of the official teammate path (plan §3): `spawn_teammate` forwards only
// `{prompt, parent}` to `ctx.subagents.startContinuable`, so a teammate inherits the Lead's
// model route and cannot take a persona/tool-filter argument. The roster's `teamModels`
// slots therefore stay on the one-shot consult path, and the section says so rather than
// promising a route the harness cannot deliver.
import type { DshAdapter, DshPromptSection } from "../../mpd-dsh-adapter-plugin/src/index"
import { sessionQualifies } from "./session-gate.ts"

/** Section name (unique within an agent scope; the harness throws on a duplicate). */
export const ROSTER_SECTION_NAME = "mpd:roster"
/**
 * Section order. The harness's own `TEAM_POLICY` is 600 (`dsh-system-prompt`
 * `SECTION_ORDERS`), so the roster lands immediately after the official team policy.
 */
export const ROSTER_SECTION_ORDER = 605

/** One roster member as the section renders it. */
export interface SectionRosterMember {
  /** The functional name a teammate is addressed by. */
  name: string
  /** The role's own one-line description, condensed by `functionOf` for the section text. */
  description: string
  /** True when the section must mark this member as read-only. */
  readonly: boolean
}

/** The leading role-noun is already the member's name, so the "X: " prefix is dropped. */
function functionOf(description: string): string {
  /** The raw description, stringified so a non-string cannot break the render. */
  const text = String(description ?? "")
  /** The description minus its leading role-noun prefix, when it carries one. */
  const afterColon = text.includes(": ") ? text.slice(text.indexOf(": ") + 2) : text
  return afterColon.replace(/\s*\(([^()]*)\)/g, ", $1").replace(/\.+\s*$/, "").replace(/,\s*,/g, ",").trim()
}

/**
 * The section text: one line per member (name, what it does, whether it is read-only) plus
 * ONE line naming how a teammate is instantiated and where its persona text comes from.
 */
export function rosterSectionText(members: readonly SectionRosterMember[]): string {
  /** One rendered bullet per member: name, write posture and what it does. */
  const lines = members.map((member) => "- " + member.name + (member.readonly ? " [read-only]" : " [writes]") + " — " + functionOf(member.description))
  return [
    "## MPD specialist roster",
    "The specialists this deployment stages as teammates, addressed by NAME:",
    ...lines,
    "Create one with `spawn_teammate` (name = the member name, description = its responsibility, prompt = the persona text from `mpd_role_persona`); `team_task_create` opens its lane on the shared board. A teammate inherits YOUR model route and cannot take a model or tool filter, so the `teamModels` slots apply to the one-shot `mpd_role_spawn` only; a read-only member's write tools are denied by the roster guard.",
  ].join("\n")
}

/** What installing the section needs: the roster, the qualifying presets and the two reporters. */
export interface RosterSectionOptions {
  /** The roster as the section renders it. */
  members: readonly SectionRosterMember[]
  /** Presets whose top-level sessions receive the section (default: `["mpd"]`). */
  presets?: readonly string[]
  /** One-line reporter for a degradation; the install never throws. */
  warn: (line: string) => void
  /**
   * ONE line per successful registration — the boot-log SIGNATURE a mount lane asserts to
   * prove the section is live in a real session rather than merely installed at apply time
   * (no agent exists yet when a row applies). Defaults to silence.
   */
  log?: (line: string) => void
  /** `on`-style subscription used by tests to drive `agent/created` / `agent/disposed`. */
  onEvent?: (event: string, handler: (...args: unknown[]) => unknown) => (() => void) | undefined
}

/** The install outcome: how many scopes carry the section and how to release each. */
export interface RosterSectionInstall {
  /** Always true: the install degrades per agent rather than failing as a whole. */
  installed: boolean
  /** How many agent scopes carry the section right now. */
  registered: number
  /** The disposer per registered agent (idempotent). */
  disposers: Map<unknown, () => void>
}

/**
 * Register the roster section in every QUALIFYING live agent scope, and in every one that
 * appears later (`agent/created`), tearing it down on `agent/disposed`.
 *
 * Never throws: a scope that refuses the section (a missing agent-scoped `systemPrompt`, a
 * duplicate name) degrades with ONE warning per agent and the rest of the boot is untouched.
 */
export function installRosterSection(
  dsh: Pick<DshAdapter, "agentPromptSection" | "liveAgents" | "onEvent">,
  options: RosterSectionOptions,
): RosterSectionInstall {
  /** The presets whose top-level sessions qualify; `mpd` unless the row overrides it. */
  const presets = options.presets ?? ["mpd"]
  /** One disposer per registered agent scope, keyed by the agent itself. */
  const disposers = new Map<unknown, () => void>()
  /** The section text, rendered ONCE and shared by every scope. */
  const text = rosterSectionText(options.members)
  /** Emit a boot-log line without letting a throwing logger take the roster down. */
  const report = (line: string): void => {
    try {
      options.log?.(line)
    } catch { /* logging must never take the roster down */ }
  }
  /** Contribute the section to ONE agent scope and record its disposer. */
  const register = (agent: unknown): void => {
    try {
      if (agent === undefined || agent === null || disposers.has(agent)) return
      if (!sessionQualifies(agent, presets)) return
      /** The prompt section handed to the adapter for this agent. */
      const section: DshPromptSection = { name: ROSTER_SECTION_NAME, order: ROSTER_SECTION_ORDER, text }
      /** The scope's own disposer, or a no-op when it returned none. */
      const dispose = dsh.agentPromptSection(agent, section)
      disposers.set(agent, typeof dispose === "function" ? dispose : () => { /* no-op */ })
      /** The preset this agent's session was created under, quoted in the registration signature. */
      const preset = (agent as { session?: { header?: { agentPreset?: unknown } } } | undefined)?.session?.header?.agentPreset
      // The REGISTRATION SIGNATURE (see `log` above): the agent id + the preset whose
      // session got the section, so an integration boot asserts `agentPreset=mpd` on it.
      report('roster section registered for agent "' + String((agent as { id?: unknown } | undefined)?.id ?? "?")
        + '" agentPreset=' + (preset === undefined ? "none" : String(preset))
        + " — " + ROSTER_SECTION_NAME + " order=" + ROSTER_SECTION_ORDER)
    } catch (error) {
      options.warn("roster section not registered for agent \"" + String((agent as { id?: unknown } | undefined)?.id ?? "?")
        + "\" (" + (error instanceof Error ? error.message : String(error)) + ")")
    }
  }
  /** Tear the section down for ONE disposed agent scope. */
  const release = (agent: unknown): void => {
    /** This agent's disposer, or undefined when it never carried the section. */
    const dispose = disposers.get(agent)
    if (dispose === undefined) return
    disposers.delete(agent)
    try {
      dispose()
    } catch { /* a failed teardown must not break agent disposal */ }
  }
  for (const agent of dsh.liveAgents()) register(agent)
  /** Subscribe through the injected seam when there is one, else through the adapter. */
  const subscribe = (event: string, handler: (...args: unknown[]) => unknown): void => {
    try {
      if (options.onEvent !== undefined) {
        options.onEvent(event, handler)
        return
      }
      dsh.onEvent(event, handler)
    } catch {
      // A missing event bus leaves the LIVE registration above in place — the section is
      // still served to every session that exists now, and the degrade stays silent
      // because the roster itself is unaffected.
    }
  }
  subscribe("agent/created", (payload: unknown) => {
    register((payload as { agent?: unknown } | undefined)?.agent ?? payload)
    return undefined
  })
  subscribe("agent/disposed", (payload: unknown) => {
    release((payload as { agent?: unknown } | undefined)?.agent ?? payload)
    return undefined
  })
  return { installed: true, registered: disposers.size, disposers }
}
