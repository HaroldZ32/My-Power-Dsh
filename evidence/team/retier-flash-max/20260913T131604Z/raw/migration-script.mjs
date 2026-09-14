// One-shot retiering migration: move the 5 ex-pro MPD team members to the
// flash tier with the max reasoning effort, in BOTH configuration surfaces
//   A: packages/mpd-bundle/cordis.patch.yml        (the `mpd` team profile members)
//   B: packages/mpd-roles-plugin/src/roles.data.ts (the one-shot roster chains)
// Each edit is scoped to its own entry and must match exactly once, so drift in
// either file aborts the whole run instead of half-applying it.
import { readFileSync, writeFileSync } from "node:fs"

const EX_PRO = ["Architect", "Planner", "Reviewer", "Lead", "Senior Engineer"]
const PRO = "deepseek-v4-pro"
const FLASH = "deepseek-v4-flash"

/** Replace the first occurrence of `from` with `to`, asserting an exact count. */
function swap(text, from, to, label) {
  const count = text.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: anchor found ${count} times (expected exactly 1): ${JSON.stringify(from)}`)
  return text.replace(from, to)
}

/** The slice of `text` covering one entry: from `start` to the next `boundary` (or EOF). */
function entrySlice(text, start, boundary, label) {
  const from = text.indexOf(start)
  if (from < 0) throw new Error(`${label}: entry anchor not found: ${JSON.stringify(start)}`)
  if (text.indexOf(start, from + 1) >= 0) throw new Error(`${label}: entry anchor is not unique: ${JSON.stringify(start)}`)
  const next = text.indexOf(boundary, from + start.length)
  return { from, to: next < 0 ? text.length : next }
}

// A: the `mpd` team profile members
const patchPath = "packages/mpd-bundle/cordis.patch.yml"
let a = readFileSync(patchPath, "utf8")
const aAlreadyDone = !a.includes(PRO) && a.includes("reasoning_effort: max")
if (!aAlreadyDone) for (const name of EX_PRO) {
  const start = `              - name: ${name}\n`
  const boundary = `              - name: `
  const { from, to } = entrySlice(a, start, boundary, `A/${name}`)
  let block = a.slice(from, to)
  block = swap(block, `                model: ${PRO}\n`, `                model: ${FLASH}\n`, `A/${name} model`)
  block = swap(block, `                role:`, `                reasoning_effort: max\n                role:`, `A/${name} effort`)
  a = a.slice(0, from) + block + a.slice(to)
}
if (!aAlreadyDone) a = swap(
  a,
  `                model: deepseek-v4-flash\n                fallback: { provider: deepseek-official, model: ${PRO} }`,
  `                model: deepseek-v4-flash\n                fallback: { provider: deepseek-official, model: ${FLASH} }`,
  "A/Plan Reviewer fallback",
)
if (!aAlreadyDone) a = swap(
  a,
  `            # unchanged (flash tier for Researcher/Explorer/Deep Worker/Junior\n            # Engineer, pro tier for Plan Reviewer).`,
  `            # tiers: every member is flash — the five that used to default to\n            # the pro tier (Architect/Planner/Reviewer/Lead/Senior Engineer)\n            # carry an explicit reasoning_effort: max, the highest effort this\n            # deployment exposes (off/low/high/max).`,
  "A/tier comment",
)
if (a.includes(PRO)) throw new Error("A: a pro-tier reference survived the retier")
if (!aAlreadyDone) writeFileSync(patchPath, a)
else console.log("A: already retiered — no write")
// idempotency guard end

// B: the one-shot roster chains
const rolesPath = "packages/mpd-roles-plugin/src/roles.data.ts"
let b = readFileSync(rolesPath, "utf8")
for (const name of EX_PRO) {
  const start = `    "name": "${name}",`
  const boundary = `    "name": "`
  const { from, to } = entrySlice(b, start, boundary, `B/${name}`)
  const body = b.slice(from, to)
  const chainFrom = body.indexOf('"chain": [')
  if (chainFrom < 0) throw new Error(`B/${name}: chain not found inside the entry`)
  const chainTo = body.indexOf("]", chainFrom) + 1
  if (chainTo <= chainFrom) throw new Error(`B/${name}: chain terminator not found`)
  const chain = swap(body.slice(chainFrom, chainTo), `{ "provider": "deepseek-official", "model": "${PRO}" }`, `{ "provider": "deepseek-official", "model": "${FLASH}" }`, `B/${name} primary`)
  b = b.slice(0, from) + body.slice(0, chainFrom) + chain + body.slice(chainTo) + b.slice(to)
}
// The only legitimate surviving pro reference is Plan Reviewer's FALLBACK tier
// (the roster analogue of the team profile's fallback, which was retiered too).
const survivors = b.split("\n").filter((line) => line.includes(PRO))
if (survivors.length !== 1 || !b.includes(`{ "provider": "deepseek-official", "model": "${PRO}" }`)) {
  survivors.forEach((line, i) => console.log("SURVIVOR " + i + ": " + line))
  throw new Error(`B: expected exactly one surviving pro reference (Plan Reviewer fallback), found ${survivors.length}`)
}
writeFileSync(rolesPath, b)

console.log(`retier ok: ${EX_PRO.length} members -> ${FLASH} (effort max where the surface carries it)`)
