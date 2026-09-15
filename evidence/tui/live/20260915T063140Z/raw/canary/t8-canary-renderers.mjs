// t8/t12 causal canary (Reviewer) — settle the renderer gap with ONE boot.
//
// The corrected host rule (Senior Engineer, retracting the channel-capture-once
// attribution): `dsh-adapter/renderers.ts` snapshots
// BUILTIN_SESSION_EVENT_TYPES = new Set(KNOWN_SESSION_EVENT_TYPES) at MODULE LOAD
// and REFUSES a renderer for any type in that snapshot ("built-in event types keep
// their own projection"). Our plugin ADDS its type to KNOWN_SESSION_EVENT_TYPES so
// the session can persist it — hence the suspicion that our type lands in the
// snapshot and every registration for it is refused.
//
// My earlier canary registered only for the ALREADY-SEEN type `mpd-tui/board-opened`,
// so under the corrected rule it could not distinguish "refused because known" from
// "this host cannot project a renderer at all". This canary fixes that: in ONE boot
// it registers renderers for BOTH a never-before-used type and the seen type, then
// appends BOTH events through a real session (via its own command, the same path the
// plugin uses), and renders unmistakable titles.
//
// Outcomes: (i) fresh renders + seen does not -> corrected rule holds;
//           (ii) neither renders -> earlier reading plus a new variable;
//           (iii) both render -> the probes were confounded.
import { appendFileSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export const name = "t8-canary-renderers"

// Hardcoded because the lane helper boots the TUI through `env -i` with a fixed key
// list, so an extra env var cannot be smuggled in. The stamp keeps this type
// never-before-used across boots.
const STAMP = "0710"
// The single variable under test: a type ADDED to KNOWN_SESSION_EVENT_TYPES (exactly
// what our plugin must do for iron rule 2) versus one left OUT of it.
const KNOWN_TYPE = `t8probe/known-${STAMP}`
const PLAIN_TYPE = `t8probe/plain-${STAMP}`

const TRACE = join(process.env.HOME ?? "/tmp", "t8-canary-trace.log")
function trace(message) {
  try {
    appendFileSync(TRACE, message + "\n")
  } catch {
    // Diagnostic only; never let it change the measured outcome.
  }
}

/** Make a type known to every reachable dsh-session copy (iron rule 2), then verify. */
function registerKnownType(type) {
  let verified = false
  const anchors = []
  try {
    anchors.push(fileURLToPath(import.meta.url))
  } catch {}
  if (typeof process.argv[1] === "string") anchors.push(process.argv[1])
  const homes = []
  if (typeof process.env.DSH_HOME === "string") homes.push(process.env.DSH_HOME)
  homes.push(join(process.env.HOME ?? "", ".dsh"), join(process.env.HOME ?? "", ".dsh-tui"))
  for (const home of homes) {
    try {
      for (const entry of readdirSync(join(home, "profiles"), { withFileTypes: true })) {
        if (entry.isDirectory()) anchors.push(join(home, "profiles", entry.name, "package.json"))
      }
    } catch {}
  }
  for (const anchor of new Set(anchors)) {
    try {
      const mod = createRequire(anchor)("@deepseek-ai/dsh-session")
      const set = mod?.KNOWN_SESSION_EVENT_TYPES
      if (!(set instanceof Set)) continue
      try {
        if (!set.has(type)) set.add(type)
      } catch {}
      if (set.has(type) === true) verified = true
    } catch {}
  }
  return verified
}

export function apply(ctx) {
  trace(`apply entered stamp=${STAMP} known=${KNOWN_TYPE} plain=${PLAIN_TYPE}`)
  const log = (message) => {
    trace(message)
    try {
      ctx.logger.info("[t8-canary] " + message)
    } catch {}
  }

  // 1) Register BOTH renderers through the host's documented deferred form.
  try {
    ctx.inject(["tuiRenderers"], (scoped) => {
      trace("inject callback fired")
      try {
        const service = scoped.get("tuiRenderers", false) ?? scoped.tuiRenderers
        if (service === undefined || typeof service.register !== "function") {
          log("tuiRenderers not reachable from the injected scope")
          return
        }
        const d1 = service.register(KNOWN_TYPE, () => ({
          title: `T8-KNOWN-ROW-${STAMP}`,
          lines: ["known-set type rendered"],
        }))
        const d2 = service.register(PLAIN_TYPE, () => ({
          title: `T8-PLAIN-ROW-${STAMP}`,
          lines: ["never-registered type rendered"],
        }))
        // HOW I BROKE MY OWN FIRST CANARY: cordis `ctx.effect(fn)` invokes fn
        // IMMEDIATELY and uses its RETURN value as the disposer. Writing the
        // disposer CALLS in the body therefore unregistered both renderers at
        // apply time — which is why the first cross run showed no row for either
        // type while the implementer's probe rendered its fresh types in the SAME
        // boot. The callback must RETURN the cleanup, as our plugin's effectOn does.
        if (typeof scoped.effect === "function") {
          scoped.effect(() => () => {
            try { d1?.() } catch {}
            try { d2?.() } catch {}
          }, "t8-canary renderers")
        }
        trace(`register(fresh)=${typeof d1} register(seen)=${typeof d2} (a refusal also returns a no-op)`)
      } catch (error) {
        log("renderer registration threw: " + String(error?.message ?? error))
      }
    })
  } catch (error) {
    log("ctx.inject unavailable: " + String(error?.message ?? error))
  }

  // 2) A command that APPENDS both events through a real session — the same
  //    invocation.agent.session path the plugin's /mpd board uses.
  try {
    ctx.inject(["commands"], (scoped) => {
      try {
        const commands = scoped.get("commands", false) ?? scoped.commands
        if (commands === undefined || typeof commands.register !== "function") {
          log("commands not reachable")
          return
        }
        const verified = registerKnownType(KNOWN_TYPE)
        trace(`${KNOWN_TYPE} added to the known set: ${verified}; ${PLAIN_TYPE} deliberately NOT added`)
        commands.register({
          name: "t8probe",
          description: "t8 causal canary: append a fresh-type and a seen-type event",
          handler: (invocation) => {
            const session = invocation?.agent?.session
            let known = "no-session"
            let plain = "no-session"
            try {
              if (typeof session?.append === "function") {
                session.append(KNOWN_TYPE, { stamp: STAMP })
                known = "appended"
              }
            } catch (error) {
              known = "threw: " + String(error?.message ?? error)
            }
            try {
              if (typeof session?.append === "function") {
                session.append(PLAIN_TYPE, { stamp: STAMP })
                plain = "appended"
              }
            } catch (error) {
              plain = "threw: " + String(error?.message ?? error)
            }
            trace(`t8probe handler: known=${known} plain=${plain}`)
            return { kind: "success", text: `t8probe known=${known} plain=${plain}` }
          },
        })
        trace("t8probe command registered")
      } catch (error) {
        log("command registration threw: " + String(error?.message ?? error))
      }
    })
  } catch (error) {
    log("commands inject unavailable: " + String(error?.message ?? error))
  }
}
