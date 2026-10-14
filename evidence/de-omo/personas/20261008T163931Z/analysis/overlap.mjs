// Longest common contiguous word run (case/whitespace-normalised) between a persona text and a
// reference text. A long shared run would indicate copied prose rather than an adaptation.
import { readFileSync } from "node:fs"
/** Normalise prose to comparable lowercase word tokens. */
const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
/** Length of the longest contiguous run of words present in both sequences. */
function longestRun(a, b) {
  const set = new Set()
  for (let i = 0; i < b.length; i++) for (let j = i + 1; j <= Math.min(i + 24, b.length); j++) set.add(b.slice(i, j).join(" "))
  let best = 0, bestText = ""
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j <= Math.min(i + 24, a.length); j++) {
    const gram = a.slice(i, j).join(" ")
    if (set.has(gram) && j - i > best) { best = j - i; bestText = gram }
  }
  return { best, bestText }
}
const [personaPath, ...refs] = process.argv.slice(2)
const persona = words(readFileSync(personaPath, "utf8"))
for (const ref of refs) {
  const r = longestRun(persona, words(readFileSync(ref, "utf8")))
  console.log(`${personaPath} vs ${ref}: longest shared word run = ${r.best} (${JSON.stringify(r.bestText)})`)
}
