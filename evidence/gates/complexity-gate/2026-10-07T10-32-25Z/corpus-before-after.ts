// The corpus table BEFORE vs AFTER, driven over BOTH source images with the case's own frozen sets.
// The before-image is `git show cae00e5a:<src>` (the wave's branch point), written beside this file.
import { pathToFileURL } from "node:url"
import { CJK_COMPLEX_PROMPTS, CJK_SIMPLE_PROMPTS, EXPLICIT_PROMPTS, SIMPLE_PROMPTS, SOFT_COMPLEX_PROMPTS } from "../../../../skills/dsh-qa/scripts/session-start-team.ts"

/** One gate module image, as this comparison drives it. */
type GateImage = {
  readonly consumeExplicitFlag: (text: string) => { flagged: boolean; text: string }
  readonly evaluateComplexityGate: (text: string, input?: { explicitFlag?: boolean }) => { trigger: boolean; signals: string[] }
}
const before = (await import(pathToFileURL(new URL("./complexity-gate-pre-wave.ts", import.meta.url).pathname).href)) as GateImage
const after = (await import("../../../../packages/mpd-roles-plugin/src/complexity-gate.ts")) as GateImage
const sets: Array<[string, readonly string[], boolean]> = [
  ["simple", SIMPLE_PROMPTS, false],
  ["soft-complex", SOFT_COMPLEX_PROMPTS, true],
  ["explicit", EXPLICIT_PROMPTS, true],
  ["cjk-positive", CJK_COMPLEX_PROMPTS, true],
  ["cjk-negative", CJK_SIMPLE_PROMPTS, false],
]
/** One image's verdict line for one case, driven the way the WIRING drives it. */
const verdictOf = (gate: GateImage, label: string, prompt: string): string => {
  const consumed = label === "explicit" ? gate.consumeExplicitFlag(prompt) : { flagged: false, text: prompt }
  const v = gate.evaluateComplexityGate(consumed.text, { explicitFlag: consumed.flagged })
  return String(v.trigger) + " " + JSON.stringify(v.signals)
}
console.log("case".padEnd(14) + "han".padStart(4) + "  before(pre-wave)         after(working tree)     want")
for (const [label, prompts, want] of sets) {
  for (const prompt of prompts) {
    const han = (prompt.match(/\p{Script=Han}/gu) ?? []).length
    const b = verdictOf(before, label, prompt)
    const a = verdictOf(after, label, prompt)
    console.log(label.padEnd(14) + String(han).padStart(4) + "  " + b.padEnd(24) + " " + a.padEnd(23) + " trigger=" + String(want) + "  " + JSON.stringify(prompt.slice(0, 40)))
  }
}
