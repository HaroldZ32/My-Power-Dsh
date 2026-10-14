// W-d evidence (lane W). §2.5's build-time derivation was NOT implemented — the captain's decision,
// because `dag-theme.ts` records its web hexes as deliberate PROVENANCE and the web view is the
// semantic reference for that table. This arm therefore MEASURES the duplicate that remains: the six
// states, their glyphs and their web hex fallbacks, side by side, so a future drift is visible in the
// record instead of being discovered on a screenshot.
import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Repository root, overridable as argv[2]. */
const root = process.argv[2] ?? process.cwd()
/** The TUI DAG contract, read as text (the file another lane owns; this arm only reads it). */
const theme = readFileSync(join(root, "packages/mpd-tui-plugin/src/dag-theme.ts"), "utf8")
/** The web view the browser actually runs, read as text. */
const view = readFileSync(join(root, "packages/mpd-bundle-plugin/src/team-view.ts"), "utf8")

/** Every `key: "value"` pair of one object literal, in source order. */
function pairs(text: string): Record<string, string> {
  /** The extracted pairs. */
  const out: Record<string, string> = {}
  for (const match of text.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*"([^"]*)"/g)) out[match[1]] = match[2]
  return out
}

/** The text of one named object/array literal, from the `=` that opens it to the closing brace. */
function literal(source: string, declaration: string): string {
  /** Where the declaration itself starts. */
  const at = source.indexOf(declaration)
  if (at === -1) throw new Error("not found: " + declaration)
  /** Where its assigned value starts; the TYPE between the two may carry brackets of its own. */
  const assigns = source.indexOf("=", at)
  if (assigns === -1) throw new Error("no assignment after: " + declaration)
  /** The first opener after the assignment, which is the literal's own. */
  const open = source.slice(assigns).search(/[[{]/)
  if (open === -1) throw new Error("no literal after: " + declaration)
  /** The opener character, so the closer is known. */
  const opener = source.slice(assigns)[open]
  /** The closer that ends this literal. */
  const closer = opener === "{" ? "}" : "]"
  /** The body, braces excluded. */
  const start = assigns + open + 1
  return source.slice(start, source.indexOf(closer, start))
}

/** The six state names, in the contract's own order. */
const states = literal(theme, "export const DAG_STATE_TONES").split(",").map((entry) => entry.trim().replace(/^"|"$/g, "")).filter((entry) => entry !== "")
/** The contract's glyph per state. */
const contractGlyphs = pairs(literal(theme, "export const DAG_TONE_GLYPH"))
/** The contract's web hex per state (recorded as provenance, not styling). */
const contractHexes = pairs(literal(theme, "export const DAG_TONE_WEB_HEX"))
/** The web view's own glyph table. */
const webGlyphs = pairs(literal(view, "const GLYPH: Record<string, string>"))
/** The web view's own tone table, whose fallback hex is the value compared below. */
const webTones = pairs(literal(view, "const TONE: Record<string, string>"))

/** One state's row: what each side says, and whether they agree. */
const rows = states.map((state) => {
  /** The hex the web tone carries as its `var(...)` fallback. */
  const webHex = (webTones[state] ?? "").match(/,\s*(#[0-9a-fA-F]{3,8})\)/)?.[1] ?? ""
  return {
    state,
    glyph: { contract: contractGlyphs[state] ?? null, web: webGlyphs[state] ?? null, agree: contractGlyphs[state] === webGlyphs[state] },
    hex: { contract: contractHexes[state] ?? null, web: webHex === "" ? null : webHex, agree: contractHexes[state] === webHex },
    webTone: webTones[state] ?? null,
  }
})

/** The verdict: every compared cell agrees, and no state is missing on either side. */
const drift = rows.filter((row) => !row.glyph.agree || !row.hex.agree)
console.log(JSON.stringify({
  arm: "W-d",
  implemented: false,
  declaredBound: "team-view.ts keeps its own TONE/GLYPH literals; no build-time derivation from dag-theme.ts",
  states,
  rows,
  drift: drift.map((row) => row.state),
  agree: drift.length === 0 && rows.length === states.length && states.length === 6,
}, null, 2))
