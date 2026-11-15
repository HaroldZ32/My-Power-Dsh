// T1 mount probe — a row that BOOTS inside the composition and writes down what the loaders did.
//
// WHY A ROW AND NOT A POST-MORTEM OF THE LOG: the deliverable is (a) the values the `!!js` guards
// see at evaluation time (`process.argv[1]`, `ctx.baseUrl`) and (b) which of the six team rows the
// LOADER actually left enabled/activated. Both are only observable from inside an activation.
//
// It is deliberately total: every read is guarded and the file is ALWAYS written, carrying the
// thrown message instead of the value, so a missing file means "the boot never reached this row"
// and a file with an `error` field means "this one read failed" - never a silent absence.

import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The package name the loader records for this row (literal, like every patch row name). */
export const name = "t1-probe";

/** No injected services: the probe must activate even in a composition with nothing else. */
export const inject = [];

/** The packages whose resolvability + version the report records, from both anchors. */
const PACKAGES = [
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-agent-team",
  "@deepseek-ai/dsh-experimental-agent-team",
  "@deepseek-ai/dsh-tool-agent-team",
  "@deepseek-ai/dsh-experimental-tool-agent-team",
  "@deepseek-ai/dsh-client-ui-agent-team",
  "@deepseek-ai/dsh-experimental-client-ui-agent-team",
];

/** Every DSH-TUI seam id the bundle knows, in the adapter's own table order. */
const SEAM_IDS = [
  "tuiScenes",
  "tuiStatus",
  "tuiRenderers",
  "tuiSettingsSections",
  "tuiShortcuts",
  "tuiDialogs",
  "tuiCommandTrees",
  "tuiPluginHost",
  "tuiToast",
  "tuiThemes",
  "tuiPluginStorage",
  "tuiMessageObserver",
  "tuiEffectLedger",
  "tuiWorkspaces",
  "tuiPanels",
  "tuiPrompt",
  "commands",
  "settings",
];

/**
 * @param fn The thunk to run.
 * @param fallback The value a throw answers with.
 * @returns The thunk's value, or the fallback.
 */
function attempt(fn, fallback) {
  try {
    return fn();
  } catch (error) {
    return fallback + " :: " + String(error && error.message ? error.message : error);
  }
}

/**
 * Resolve one package from one anchor and read its version.
 * @param anchor An absolute anchor path, or a file URL string (the loader's `baseUrl`).
 * @param id The package name to resolve.
 * @returns The resolution record.
 */
function probeFrom(anchor, id) {
  if (typeof anchor !== "string" || anchor === "") return { anchor: "", resolved: null, version: null, error: "no anchor" };
  try {
    const require = createRequire(anchor);
    const manifest = require.resolve(id + "/package.json");
    const doc = JSON.parse(readFileSync(manifest, "utf8"));
    return { anchor, resolved: manifest, version: typeof doc.version === "string" ? doc.version : null, error: null };
  } catch (error) {
    return { anchor, resolved: null, version: null, error: String(error && error.message ? error.message : error) };
  }
}

/**
 * @param ctx The plugin context.
 * @param out The absolute file path the report is written to.
 * @returns Nothing.
 */
export function apply(ctx, out) {
  const target = typeof out === "string" && out !== "" ? out : process.env.MPD_T1_PROBE_OUT;
  const report = {
    at: new Date().toISOString(),
    argv: process.argv.slice(0, 5),
    argv1: typeof process.argv[1] === "string" ? process.argv[1] : null,
    cwd: attempt(() => process.cwd(), null),
    env: {
      MPD_DSH_TEAM_ROWS: process.env.MPD_DSH_TEAM_ROWS ?? null,
      DSH_WORKSPACE_ROOT: process.env.DSH_WORKSPACE_ROOT ?? null,
      MPD_MCP_LOG_DIR: process.env.MPD_MCP_LOG_DIR ?? null,
    },
    baseUrl: attempt(() => ctx.baseUrl ?? null, null),
    baseUrlSources: {
      ctx: attempt(() => ctx.baseUrl ?? null, null),
      loaderCtx: attempt(() => ctx.loader?.ctx?.baseUrl ?? null, null),
      loaderCtxTree: attempt(() => ctx.loader?.entries?.()?.next?.()?.value?.parent?.tree?.ctx?.baseUrl ?? null, null),
    },
    probes: {},
    entries: [],
    services: {},
    seams: {},
  };

  for (const id of PACKAGES) {
    report.probes[id] = {
      fromArgv1: probeFrom(report.argv1, id),
      fromBaseUrl: probeFrom(report.baseUrl, id),
    };
  }

  try {
    const entries = typeof ctx.loader?.entries === "function" ? [...ctx.loader.entries()] : [];
    report.entries = entries.map((entry) => ({
      id: attempt(() => entry.options?.id ?? null, null),
      name: attempt(() => entry.options?.name ?? null, null),
      disabled: attempt(() => entry.disabled, null),
      active: attempt(() => entry.fiber !== undefined && entry.fiber !== null, null),
      config: attempt(() => (entry.options?.config === undefined ? null : JSON.parse(JSON.stringify(entry.options.config))), null),
    }));
  } catch (error) {
    report.entriesError = String(error && error.message ? error.message : error);
  }

  for (const service of [...SEAM_IDS, "agentTeams", "mpdTui", "mpdConfig"]) {
    report.services[service] = attempt(() => ctx.get(service, false) !== undefined && ctx.get(service, false) !== null, null);
  }
  for (const id of SEAM_IDS) {
    report.seams[id] = attempt(() => ctx.get(id, false) !== undefined && ctx.get(id, false) !== null, null);
  }

  report.agentTeamsSurface = attempt(() => {
    const surface = ctx.get("agentTeams", false);
    if (surface === undefined || surface === null) return null;
    return Object.keys(surface)
      .map((key) => key + ":" + typeof surface[key])
      .sort();
  }, null);

  report.mpdTuiCapabilities = attempt(() => {
    const adapter = ctx.get("mpdTui", false);
    if (adapter === undefined || adapter === null || typeof adapter.capabilities !== "function") return null;
    const caps = adapter.capabilities();
    return {
      seams: caps && typeof caps.seams === "object" ? caps.seams : null,
      hostContact: caps && caps.hostContact ? caps.hostContact : null,
    };
  }, null);
  // The adapter's OWN per-seam outcomes: the loudest independent evidence for the Ctrl+A claim, since
  // the takeover's version gate reads exactly `panelSeamBound()` before it may intercept the key.
  report.mpdTuiDetail = attempt(() => {
    const adapter = ctx.get("mpdTui", false);
    if (adapter === undefined || adapter === null) return null;
    return {
      panelSeamBound: typeof adapter.panelSeamBound === "function" ? adapter.panelSeamBound() : null,
      seamOutcomes: typeof adapter.seamOutcomes === "function" ? adapter.seamOutcomes().map((outcome) => ({ id: outcome.id, state: outcome.state, detail: outcome.detail ?? "" })) : null,
      panelEnableOutcome: typeof adapter.panelEnableOutcome === "function" ? adapter.panelEnableOutcome() : null,
    };
  }, null);

  const write = (file, withSettled) => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(withSettled ? { ...report, settled: true, settledAt: new Date().toISOString() } : report, null, 2) + String.fromCharCode(10));
      return true;
    } catch (error) {
      process.stderr.write("[t1-probe] could not write " + file + ": " + String(error && error.message ? error.message : error) + String.fromCharCode(10));
      return false;
    }
  };
  write(target, false);
  // Rows initialize CONCURRENTLY: at this row's apply a sibling row with injects may still be
  // pending, so the immediate report is not the settled picture. A short re-write gives the
  // runner a second, settled observation (activation order is not the report's subject).
  setTimeout(() => write(target.replace(/\.json$/, "") + ".settled.json", true), Number(process.env.MPD_T1_PROBE_SETTLE_MS ?? 5000));
}
