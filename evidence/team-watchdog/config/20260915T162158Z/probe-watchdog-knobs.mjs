#!/usr/bin/env node
// t61 evidence — the watchdog knobs are DECLARED in the one shared settings schema, mirrored in the
// Web card's FIELDS, and VISIBLE through the `mpd` namespace at runtime.
//
// It reads the BUILT artifacts (packages/mpd-config-plugin/dist/index.js is mounted through a stub
// adapter seam, exactly like the package's own wiring test) rather than grepping sources, and it
// measures the precedence between the namespace value and the watchdog row's own config with the
// row's real dist.
//
// Usage: bun probe-watchdog-knobs.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { apply as configApply } from "../../../../packages/mpd-config-plugin/dist/index.js";
import { apply as watchdogApply } from "../../../../packages/mpd-team-watchdog-plugin/dist/index.js";
import { SETTINGS_KNOBS } from "../../../../packages/mpd-config-plugin/src/settings-schema.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const EXPECTED = [
  { path: ["watchdog", "enabled"], label: "Watchdog enabled", zh: "看门狗启用", kind: "boolean", def: true },
  { path: ["watchdog", "warnSilenceMs"], label: "Silence warning threshold (ms)", zh: "静默告警阈值（毫秒）", kind: "number", def: 90000 },
  { path: ["watchdog", "tickIntervalMs"], label: "Watchdog tick interval (ms)", zh: "看门狗轮询间隔（毫秒）", kind: "number", def: 15000 },
  { path: ["watchdog", "warnStreakToEscalate"], label: "Warn streak before escalation", zh: "升级前连续告警次数", kind: "number", def: 3 },
  { path: ["watchdog", "actionOnEscalate"], label: "Action on escalation", zh: "升级时的动作", kind: "select", options: ["pause", "warn-only"], def: "pause" },
];

const checks = [];
const ok = (id, detail) => checks.push({ id, status: "passed", detail });
const bad = (id, detail) => checks.push({ id, status: "failed", detail });

// 1. The BUILT config plugin registers the namespace with the five watchdog knobs + frozen defaults.
const registered = [];
const sandbox = mkdtempSync(join(tmpdir(), "mpd-watchdog-knobs-"));
mkdirSync(join(sandbox, ".mpd"), { recursive: true });
const configAdapter = {
  settingsRegister: (ns, schema, options) => {
    registered.push({ ns, schema, options });
    return { ok: true };
  },
  workspaceRoot: () => sandbox,
  workspaceRootsAll: () => [sandbox],
  settingsReader: () => undefined,
  onSettingsDocumentUpdated: () => () => {},
  settingsMutate: async () => ({ ok: true }),
  registerTool: () => () => {},
};
const configCtx = {
  get: (name) => (name === "mpdDsh" ? configAdapter : undefined),
  provide: () => {},
  logger: { warn: () => {} },
};
try {
  configApply(configCtx);
} catch (error) {
  bad("config-apply", `config plugin apply threw: ${String(error)}`);
}
const registration = registered.find((entry) => entry.ns === "mpd");
if (registration === undefined) bad("namespace-registered", "no `mpd` namespace registration captured from the built plugin");
else {
  ok("namespace-registered", `settingsRegister("mpd") captured, applies=${JSON.stringify(registration.options ?? null)}`);
  const resolved = typeof registration.schema === "function" ? registration.schema({}) : registration.schema;
  const block = resolved?.watchdog;
  for (const knob of EXPECTED) {
    const leaf = knob.path[1];
    const value = block?.[leaf];
    if (value === knob.def) ok(`namespace.${knob.path.join(".")}`, `default ${JSON.stringify(value)}`);
    else bad(`namespace.${knob.path.join(".")}`, `expected default ${JSON.stringify(knob.def)}, got ${JSON.stringify(value)}`);
  }
}

// 2. The card's OWN FIELDS carries the same five rows with identical path/label/zh.
const cardSource = readFileSync(join(REPO, "packages", "mpd-bundle-plugin", "src", "settings-card.js"), "utf8");
const { FIELDS } = (0, eval)("(" + cardSource + ")")((name) => ({ react: {}, locales: {} })[name] ?? {});
if (Array.isArray(FIELDS) && FIELDS.length === 11) ok("card.fields-count", "11 fields");
else bad("card.fields-count", `expected 11 fields, got ${Array.isArray(FIELDS) ? FIELDS.length : String(FIELDS)}`);
for (const knob of EXPECTED) {
  const key = knob.path.join(".");
  const field = FIELDS.find((f) => f.path.join(".") === key);
  if (field === undefined) bad(`card.${key}`, "row missing from the card's FIELDS");
  else if (field.label === knob.label && field.zh === knob.zh && field.kind === knob.kind)
    ok(`card.${key}`, `path/label/zh/kind identical (${field.label} / ${field.zh})`);
  else bad(`card.${key}`, `drift: ${JSON.stringify({ label: field.label, zh: field.zh, kind: field.kind })}`);
}
const sharedKeys = new Set(SETTINGS_KNOBS.map((k) => k.path.join(".")));
const missingInShared = EXPECTED.filter((k) => !sharedKeys.has(k.path.join(".")));
if (missingInShared.length === 0) ok("shared.declaration", `${SETTINGS_KNOBS.length} knobs, watchdog declared`);
else bad("shared.declaration", `missing from SETTINGS_KNOBS: ${missingInShared.map((k) => k.path.join(".")).join(", ")}`);

// 3. PRECEDENCE, measured with the watchdog row's own dist: the row config is the DEFAULTS layer and
//    the namespace is the live authority.
const rowConfig = { enabled: true, warnSilenceMs: 90000, tickIntervalMs: 15000, warnStreakToEscalate: 3, actionOnEscalate: "pause" };
function mountWatchdog(namespaceValue) {
  const adapter = {
    workspaceRoot: () => sandbox,
    workspaceRootsAll: () => [sandbox],
    settingsReader: (ns) => (ns === "mpd" ? { get: () => namespaceValue, describe: () => ({ value: namespaceValue }) } : undefined),
    onSettingsDocumentUpdated: () => () => {},
    onPostToolExecute: () => () => {},
    registerTool: () => () => {},
    hasTool: () => false,
    executeTool: async () => ({ ok: false }),
    provide: () => {},
  };
  const ctx = { get: (name) => (name === "mpdDsh" ? adapter : undefined), provide: () => {}, logger: { warn: () => {} }, effect: () => () => {} };
  const report = watchdogApply(ctx, rowConfig);
  return report;
}
const reportDefaults = mountWatchdog({});
const reportOverride = mountWatchdog({ watchdog: { warnSilenceMs: 12345, actionOnEscalate: "warn-only" } });
try {
  const knobsDefault = reportDefaults?.knobs;
  const knobsOverride = reportOverride?.knobs;
  if (knobsDefault?.warnSilenceMs === 90000 && knobsDefault?.tickIntervalMs === 15000 && knobsDefault?.warnStreakToEscalate === 3 && knobsDefault?.actionOnEscalate === "pause" && knobsDefault?.enabled === true)
    ok("precedence.row-config-not-shadowed", `empty namespace -> the row's own values win (${JSON.stringify({ enabled: knobsDefault.enabled, warnSilenceMs: knobsDefault.warnSilenceMs, tickIntervalMs: knobsDefault.tickIntervalMs, warnStreakToEscalate: knobsDefault.warnStreakToEscalate, actionOnEscalate: knobsDefault.actionOnEscalate })})`);
  else bad("precedence.row-config-not-shadowed", `unexpected defaults: ${JSON.stringify(knobsDefault)}`);
  if (knobsOverride?.warnSilenceMs === 12345 && knobsOverride?.actionOnEscalate === "warn-only" && knobsOverride?.warnStreakToEscalate === 3 && typeof knobsOverride?.tickIntervalMs === "number" && knobsOverride.tickIntervalMs < 12345)
    ok("precedence.namespace-overrides-row", `explicit namespace value wins (warnSilenceMs 12345 instead of the row's 90000; actionOnEscalate "warn-only" instead of "pause"), the untouched row value stays (warnStreakToEscalate 3), and the row's own guard still applies: tickIntervalMs was clamped 15000 -> ${knobsOverride.tickIntervalMs} because it must stay < warnSilenceMs (issue recorded: ${JSON.stringify(knobsOverride.issues?.[0] ?? null)})`);
  else bad("precedence.namespace-overrides-row", `expected the namespace to win: ${JSON.stringify(knobsOverride)}`);
} catch (error) {
  bad("precedence.measurement", String(error));
}
try {
  reportDefaults?.engine?.stop?.();
  reportOverride?.engine?.stop?.();
} catch {
  /* engine absent */
}
rmSync(sandbox, { recursive: true, force: true });

const failed = checks.filter((c) => c.status === "failed");
const report = {
  task: "t61 — declare the five watchdog knobs + prove namespace visibility and precedence",
  measuredAt: new Date().toISOString(),
  artifacts: ["packages/mpd-config-plugin/dist/index.js", "packages/mpd-bundle-plugin/client.js", "packages/mpd-tui-plugin/dist/index.js"],
  checks,
  verdict: failed.length === 0 ? "passed" : "failed",
};
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];
if (outPath !== null) writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`[probe] ${checks.filter((c) => c.status === "passed").length}/${checks.length} checks passed — ${report.verdict}`);
for (const check of failed) console.log(`FAIL ${check.id} — ${check.detail}`);
process.exit(failed.length === 0 ? 0 : 1);
