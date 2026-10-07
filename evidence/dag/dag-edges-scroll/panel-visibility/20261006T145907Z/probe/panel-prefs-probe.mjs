// EVIDENCE-SIDE probe: read the INSTALLED host's live side-panel state out of its own modules.
//
// WHY THIS EXISTS. The defect under investigation is a TRANSITION — the host appends a plugin panel
// id to the side-panel CSV on a successful `tuiPanels.register()`, and something later rewrites that
// CSV back to a configured list. A pane capture shows the OUTCOME (which tabs are painted) but not
// the transition, and the host exposes no lens for it. This module is that lens: it is injected with
// `NODE_OPTIONS=--import <file url>` so it runs INSIDE the host's own process, dynamically imports
// the host's `lib/types/tuiDisplayPrefs.js` BY FILE URL (so Node's ESM cache hands back the SAME
// module instance, never a second copy with its own store), and records every change plus a poll.
//
// Plain `.mjs` on purpose: it is loaded by `--import` in the host's own Node process, which strips no
// types — a TypeScript annotation here is a `SyntaxError` at import time (MEASURED, and it took the
// whole boot down: `Missing initializer in const declaration`).
//
// It is deliberately inert unless BOTH `MPD_PANEL_PROBE_LOG` and `MPD_PANEL_PROBE_PREFS` are set, it
// never throws, and it writes nothing but its own append-only log — a probe must not be able to
// change the thing it measures.
import { appendFileSync } from "node:fs"

/** The append-only log this probe writes; absent means the probe stays completely inert. */
const LOG = process.env.MPD_PANEL_PROBE_LOG
/** Absolute file URL of the host's `tuiDisplayPrefs.js`, the module owning the live panel CSV. */
const PREFS = process.env.MPD_PANEL_PROBE_PREFS
/** Absolute file URL of the host's `components/sidePanel/PanelStore.js`, the panel registry. */
const STORE = process.env.MPD_PANEL_PROBE_STORE

if (LOG !== undefined && PREFS !== undefined) {
  /** Wall-clock origin of this process, so every line carries a relative offset too. */
  const t0 = Date.now()
  /**
   * Append one probe line; a failing write must never disturb the host.
   * @param {string} kind - the record kind (`ARM`, `CSV`, `CHANGE`, `REG`, `ERR`).
   * @param {string} text - the payload, printed verbatim.
   */
  const write = (kind, text) => {
    try {
      appendFileSync(LOG, `${new Date().toISOString()} +${String(Date.now() - t0)}ms pid=${String(process.pid)} ${kind} ${text}\n`)
    } catch {
      // An unwritable log is not the host's problem.
    }
  }
  /**
   * One panel-registry snapshot, as `<id>@<source>` rows.
   * @param {{ panelStore?: { list?: () => unknown[] } }} store - the host's panel-registry module.
   * @returns the snapshot, comma-joined.
   */
  const snapshot = store => (store.panelStore?.list?.() ?? [])
    .map(entry => `${String(entry?.definition?.id)}@${String(entry?.definition?.source)}`)
    .join(",")

  write("ARM", `argv=${process.argv.slice(0, 2).join(" ")}`)
  try {
    /** The host's display-preferences module; the SAME instance the host itself holds. */
    const prefs = await import(PREFS)
    write("EXP", `panelExports=${Object.keys(prefs).filter(key => /panel/i.test(key)).sort().join(",")}`)
    write("CSV", `initial ${String(prefs.getSidePanelPanels())}`)
    // The listener takes NO argument (`createLiveSetting.apply` calls `listener()`), so the value is
    // re-read from the store on every notification — reading it from a parameter would always be
    // `undefined` and would make every change invisible.
    // The stack at the moment of the write is what NAMES the rewriter: the CSV is a module-level
    // store with no owner, so `applySidePanelPanels` is the only witness and its CALLER is the
    // finding. Frames are trimmed to the first eight that are not this probe's own.
    prefs.subscribeSidePanelPanels(() => {
      write("CHANGE", String(prefs.getSidePanelPanels()))
      try {
        const frames = String(new Error().stack ?? "").split("\n").slice(1)
          .filter(line => !line.includes("panel-prefs-probe.mjs")).slice(0, 8)
        for (const frame of frames) write("STACK", frame.trim())
      } catch {
        // A missing stack is not worth a failure; the CHANGE line above already landed.
      }
    })
    /** The poll timer; `unref()` keeps the probe from holding the host's process open. */
    const timer = setInterval(() => {
      try {
        write("CSV", `poll ${String(prefs.getSidePanelPanels())}`)
      } catch (error) {
        write("ERR", `poll ${String(error?.message ?? error)}`)
      }
    }, 250)
    timer.unref()
    if (STORE !== undefined) {
      try {
        /** The host's panel registry; its `list()` is the host's own record of what registered. */
        const store = await import(STORE)
        write("REG", `initial ${snapshot(store)}`)
        /** The registry poll timer; slower than the CSV poll because registrations settle early. */
        const regTimer = setInterval(() => {
          try {
            write("REG", `poll ${snapshot(store)}`)
          } catch (error) {
            write("ERR", `store ${String(error?.message ?? error)}`)
          }
        }, 500)
        regTimer.unref()
      } catch (error) {
        write("ERR", `store ${String(error?.message ?? error)}`)
      }
    }
  } catch (error) {
    write("ERR", `prefs ${String(error?.message ?? error)}`)
  }
}
