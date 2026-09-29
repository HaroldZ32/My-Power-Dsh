// w14 / t83 QA driver — record what the offline hook harness observes when the BUILT
// bundle client applies: the `settings.section` registration (registration CALLED, not a
// string search), its descriptor, the inject face, the eleven rendered knob rows, and the
// artifact's own bytes. Writes one JSON record; no assertion library, exit code only.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadMpdClient } from "/root/dshProj/my-power-dsh/packages/mpd-bundle-plugin/test/client-harness.mjs";

const REPO = "/root/dshProj/my-power-dsh";
const PKG = join(REPO, "packages", "mpd-bundle-plugin");
const OUT = join(REPO, "evidence", "mpd-settings-section", "20260916T021349Z", "descriptor-probe.result.json");

const artifactText = readFileSync(join(PKG, "client.js"), "utf8");
const cardSource = readFileSync(join(PKG, "src", "settings-card.js"), "utf8");

const READY = {
  status: "ready",
  mode: "host",
  writable: true,
  revision: 7,
  value: { hashline: { maxDiffChars: 20000 }, ulw: { maxRounds: 6 } },
  user: { ulw: { maxRounds: 6 } },
};

function fakeScope(snapshot, calls = []) {
  let revision = snapshot.revision;
  return {
    bind: (spec) => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      mutate: async (ops, expected) => { calls.push({ ops, expected }); revision = (revision ?? 0) + 1; },
      dispose: () => {},
    }),
    calls,
    boundNamespace: calls,
    spec: undefined,
  };
}

const writes = [];
const scope = fakeScope(READY, writes);
const client = loadMpdClient({ services: { settingsScope: scope } });
client.exports.apply(client.ctx);

const registrations = client.calls.slotsRegistered ?? [];
const section = registrations.find((definition) => definition.name === "settings.section");
const face = section?.inject ? section.inject() : undefined;

// Every string in the rendered tree that is one of the shared knob paths.
const FIELDS = (0, eval)("(" + cardSource + ")")((name) => ({ react: {}, locales: {} })[name] ?? {}).FIELDS;
const tree = section === undefined
  ? null
  : await client.hooks.render(section.component, {
      useMpdCard: (selector) => selector(face.hooks.mpdCard.getSnapshot()),
      t: (key) => key,
    });
const strings = [];
(function walk(node) {
  if (node === null || node === undefined) return;
  if (typeof node === "string" || typeof node === "number") { strings.push(String(node)); return; }
  if (Array.isArray(node)) { for (const child of node) walk(child); return; }
  if (Array.isArray(node.props?.children)) { for (const child of node.props.children) walk(child); return; }
  walk(node.props?.children);
})(tree);
const renderedKnobPaths = FIELDS.map((field) => field.path.join(".")).filter((path) => strings.includes(path));

const result = {
  what: "t83/w14 — the Web Settings dialog's own top-level MPD section, as the offline hook harness observes it",
  artifact: {
    path: "packages/mpd-bundle-plugin/client.js",
    bytes: Buffer.byteLength(artifactText),
    sha256: createHash("sha256").update(artifactText).digest("hex"),
  },
  registration_called: section !== undefined,
  slot_injected: client.calls.slots ?? [],
  registration_count: registrations.length,
  section_descriptor: section === undefined ? null : {
    name: section.name,
    id: section.id,
    order: section.order,
    label_is_function: typeof section.label === "function",
    label: typeof section.label === "function" ? section.label() : null,
    locale: section.locale,
    has_children: "children" in section,
    has_retired_key: "key" in section,
    component_type: typeof section.component,
    inject_type: typeof section.inject,
  },
  inject_face: face === undefined ? null : {
    hook_store_keys: Object.keys(face.hooks ?? {}),
    getSnapshot_type: typeof face.hooks?.mpdCard?.getSnapshot,
    actions: ["edit", "resetField", "save", "discard"].filter((name) => typeof face[name] === "function"),
  },
  retired_plugin_item_registration: {
    in_artifact: artifactText.includes("settings.plugin.item"),
    in_card_source: cardSource.includes("settings.plugin.item"),
    occurrences_in_artifact: artifactText.split("settings.plugin.item").length - 1,
  },
  knobs: { declared: FIELDS.map((field) => field.path.join(".")), rendered_rows: renderedKnobPaths, rendered_count: renderedKnobPaths.length },
  scope_writes_during_mount_and_render: writes,
  not_claimed: [
    "a real browser render of the section in the settings dialog (no browser binary in this environment)",
    "a click-driven save through the GUI",
  ],
};

writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

const faults = [];
if (result.registration_called !== true) faults.push("the harness never saw the section registration");
if (result.section_descriptor?.id !== "mpd") faults.push("id is not mpd");
if (typeof result.section_descriptor?.order !== "number") faults.push("no explicit order");
if (result.section_descriptor?.label !== "MPD") faults.push("label() is not MPD");
if (result.section_descriptor?.has_children !== false) faults.push("the section declares nested children");
if (result.section_descriptor?.has_retired_key !== false) faults.push("the retired keyed-item field is back");
if (result.retired_plugin_item_registration.in_artifact !== false) faults.push("the retired Plugins-tab registration is in the built client");
if (result.retired_plugin_item_registration.in_card_source !== false) faults.push("the retired Plugins-tab registration is in the card source");
if (result.knobs.rendered_count !== FIELDS.length) faults.push(`rendered ${result.knobs.rendered_count} of ${FIELDS.length} knob rows`);
if (result.scope_writes_during_mount_and_render.length !== 0) faults.push("mounting/rendering wrote through the scope");
if (faults.length > 0) { console.error("PROBE-FAIL " + JSON.stringify(faults)); process.exit(1); }
console.log("PROBE-OK");
