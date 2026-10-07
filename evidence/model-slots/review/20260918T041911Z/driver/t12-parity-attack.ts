// t12 (Reviewer) — INDEPENDENT parity/settings attack (A1/A2/A3/A4/A6), written by the review lane.
//
// It re-derives the claims from the SOURCES and the BUILT BYTES rather than re-running an
// implementation lane's suite:
//   * the ONE declaration: 22 knobs, order, kinds, declared options, hint contents (A3);
//   * the schema defaults and the declared fallback lists (A1);
//   * the card MIRROR (FIELDS) element-wise against the declaration (A6), and the fact that neither
//     the card source nor the BUILT client.js references SETTINGS_KNOBS (A6);
//   * the disclosure literals the card hardcodes are byte-identical to the declaration's (drift pin);
//   * the BUILT client.js carries the nine `select` slot rows (A5's served-bytes half);
//   * the BUILT tui dist carries the slot machinery and the A4 branch marker.
//
// Run: bun evidence/model-slots/review/<ts>/driver/t12-parity-attack.mjs
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  BRIDGE_DISCLOSURE, BRIDGE_NOT_LOST, SETTINGS_KNOBS, SETTINGS_NS, SettingsSchema,
  TEAM_MODEL_FALLBACK_OPTIONS, TEAM_MODEL_SLOT_DEFAULTS, TEAM_MODEL_SLOTS,
} from "../../../../../packages/mpd-config-plugin/src/settings-schema.ts"
import { SETTINGS_FIELDS } from "../../../../../packages/mpd-tui-plugin/src/settings.ts"

const REPO = join(import.meta.dir, "..", "..", "..", "..", "..")
const CARD_SOURCE = readFileSync(join(REPO, "packages", "mpd-bundle-plugin", "src", "settings-card.js"), "utf8")
const CLIENT = readFileSync(join(REPO, "packages", "mpd-bundle-plugin", "client.js"), "utf8")
const TUI_DIST = readFileSync(join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js"), "utf8")
const CARD = (0, eval)("(" + CARD_SOURCE + ")")((name) => ({ react: {}, locales: {} })[name] ?? {})
const FIELDS = CARD.FIELDS

const checks = []
const record = (id, ok, detail, extra = {}) => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail), ...extra })
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`)
}

// A1 — schema shape + defaults
const slotKeys = Object.keys(SettingsSchema.dict?.teamModels?.dict ?? {})
record("A1-schema-carries-three-slots",
  SETTINGS_NS === "mpd" && JSON.stringify(slotKeys) === JSON.stringify([...TEAM_MODEL_SLOTS])
  && JSON.stringify(TEAM_MODEL_SLOT_DEFAULTS) === JSON.stringify(materialisedDefaults()),
  `slots=${JSON.stringify(slotKeys)} defaults=${JSON.stringify(materialisedDefaults())}`)
function materialisedDefaults() {
  const pick = (slot, leaf) => SettingsSchema.dict.teamModels.dict[slot].dict[leaf].meta?.default
  return Object.fromEntries(TEAM_MODEL_SLOTS.map((s) => [s, { provider: pick(s, "provider"), model: pick(s, "model"), reasoningEffort: pick(s, "reasoningEffort") }]))
}

// A3 — the nine knobs, in order, kind/options/hint
const slotKnobs = SETTINGS_KNOBS.filter((k) => k.path[0] === "teamModels")
const expectedOrder = TEAM_MODEL_SLOTS.flatMap((slot) => ["provider", "model", "reasoningEffort"].map((leaf) => `teamModels.${slot}.${leaf}`))
record("A3-exactly-nine-slot-knobs-in-order",
  SETTINGS_KNOBS.length === 22 && slotKnobs.length === 9 && JSON.stringify(slotKnobs.map((k) => k.path.join("."))) === JSON.stringify(expectedOrder),
  `knobs=${SETTINGS_KNOBS.length} slots=${slotKnobs.length}`)
record("A3-every-slot-knob-is-select-with-nonempty-declared-options",
  slotKnobs.every((k) => k.kind === "select" && Array.isArray(k.options) && k.options.length > 0 && k.path.length === 3),
  JSON.stringify(slotKnobs.map((k) => [k.path.join("."), k.kind, k.options?.length])))
record("A3-hints-carry-dotted-key+disclosure+not-lost",
  slotKnobs.every((k) => typeof k.hint === "string" && k.hint.includes(`mpd.jsonc ${k.path.join(".")}`) && k.hint.includes(BRIDGE_DISCLOSURE) && k.hint.includes(BRIDGE_NOT_LOST)),
  slotKnobs[0].hint)
record("A3-declared-lists-are-the-frozen-fallback-lists",
  JSON.stringify(slotKnobs.find((k) => k.path[2] === "provider").options) === JSON.stringify(TEAM_MODEL_FALLBACK_OPTIONS.provider)
  && JSON.stringify(slotKnobs.find((k) => k.path[2] === "model").options) === JSON.stringify(TEAM_MODEL_FALLBACK_OPTIONS.model)
  && JSON.stringify(slotKnobs.find((k) => k.path[2] === "reasoningEffort").options) === JSON.stringify(TEAM_MODEL_FALLBACK_OPTIONS.reasoningEffort),
  JSON.stringify(TEAM_MODEL_FALLBACK_OPTIONS))

// A6 — the card mirror, element-wise
const drifted = []
for (const [index, field] of FIELDS.entries()) {
  const knob = SETTINGS_KNOBS[index]
  if (knob === undefined) { drifted.push(`${index}:card-only`); continue }
  if (JSON.stringify(field.path) !== JSON.stringify([...knob.path])) drifted.push(`${index}:path`)
  if (field.label !== knob.label) drifted.push(`${index}:label`)
  if (field.zh !== knob.zh) drifted.push(`${index}:zh`)
  if (field.kind !== knob.kind) drifted.push(`${index}:kind`)
  if (JSON.stringify(field.options ?? []) !== JSON.stringify([...(knob.options ?? [])])) drifted.push(`${index}:options`)
}
record("A6-card-mirror-element-wise-equal", FIELDS.length === 22 && drifted.length === 0, drifted.length ? drifted.join(",") : "22/22 rows agree on path+label+zh+kind+declared options")
record("A6-web-client-does-not-reference-the-declaration", !CARD_SOURCE.includes("SETTINGS_KNOBS") && !CLIENT.includes("SETTINGS_KNOBS"), "checked src/settings-card.js and BUILT client.js")

// the card's hardcoded disclosure literals must not drift from the ONE declaration
record("A6-card-disclosure-literals-identical", CARD_SOURCE.includes(JSON.stringify(BRIDGE_DISCLOSURE)) && CARD_SOURCE.includes(JSON.stringify(BRIDGE_NOT_LOST)) && CARD_SOURCE.includes(JSON.stringify(requireString("BRIDGE_RESTART_LIMIT"))),
  "card source quotes the declaration's BRIDGE_DISCLOSURE + BRIDGE_NOT_LOST + BRIDGE_RESTART_LIMIT verbatim")
function requireString(name) {
  const m = new RegExp(`export const ${name} =\\s*\\n?\\s*"([\\s\\S]*?)"\\n`, "m").exec(readFileSync(join(REPO, "packages", "mpd-config-plugin", "src", "settings-schema.ts"), "utf8"))
  return m?.[1] ?? "__missing__"
}

// A4/A5 — built bytes
const slotRowRe = /\{ path: \["teamModels", ?"slot[123]", ?"(?:provider|model|reasoningEffort)"\][^}]*kind: "select"/g
record("A5-built-client-carries-nine-select-slot-rows", (CLIENT.match(slotRowRe) ?? []).length === 9, `select rows=${(CLIENT.match(slotRowRe) ?? []).length}`)
record("A4-built-tui-carries-slot-machinery",
  TUI_DIST.includes("TEAM_MODEL_SLOTS") && TUI_DIST.includes("teamModelOptionLists") && TUI_DIST.includes("slot options: provider="),
  `TEAM_MODEL_SLOTS=${TUI_DIST.includes("TEAM_MODEL_SLOTS")} teamModelOptionLists=${TUI_DIST.includes("teamModelOptionLists")} branch-line=${TUI_DIST.includes("slot options: provider=")}`)

// the TUI declared fields: the nine slot leaves are select with non-empty declared options
const tuiSlot = SETTINGS_FIELDS.filter((f) => f.path[0] === "teamModels")
record("A4-tui-declared-slot-fields-are-select",
  SETTINGS_FIELDS.length === 22 && tuiSlot.length === 9 && tuiSlot.every((f) => f.kind === "select" && Array.isArray(f.options) && f.options.length > 0),
  `tuiFields=${SETTINGS_FIELDS.length} slotFields=${tuiSlot.length}`)
record("A4-tui-hints-carry-key-and-disclosure", SETTINGS_FIELDS.every((f) => typeof f.hint === "string" && f.hint.includes("mpd.jsonc " + f.path.join(".")) && f.hint.includes(BRIDGE_DISCLOSURE) && f.hint.includes(BRIDGE_NOT_LOST)),
  SETTINGS_FIELDS[13].hint)

const failed = checks.filter((c) => !c.ok)
const payload = { task: "t12", driver: "t12-parity-attack.mjs", verifiedAt: new Date().toISOString(), checks, failed: failed.map((c) => c.id) }
writeFileSync(join(import.meta.dir, "..", "t12-parity-attack.json"), JSON.stringify(payload, null, 2) + "\n")
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed${failed.length ? " — FAILED: " + failed.map((c) => c.id).join(", ") : ""}`)
if (failed.length > 0) process.exit(1)
