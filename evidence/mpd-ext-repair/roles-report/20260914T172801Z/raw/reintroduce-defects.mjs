#!/usr/bin/env bun
// Re-introduce the TWO t14 defects at their exact sites in a COPY of the fixed
// registry.ts, so the new regression cases can be measured against the pre-fix
// BEHAVIOUR (the package is untracked, so there is no git revision to check out;
// `dist/index.js` — measured separately — is the shipped pre-fix artifact).
//
// Usage: bun reintroduce-defects.mjs <fixed-registry.ts> <out.ts>
// Every substitution is asserted: a miss aborts loudly instead of writing a file
// that only looks reverted.
import { readFileSync, writeFileSync } from "node:fs"

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error("usage: reintroduce-defects.mjs <fixed> <out>")
let text = readFileSync(input, "utf8")

/** Exact replacement, asserted to occur exactly once. */
function replace(from, to, label) {
  const count = text.split(from).length - 1
  if (count !== 1) throw new Error(`defect site "${label}" matched ${count} times (expected 1)`)
  text = text.replace(from, to)
}

// F3 — the stale roles "pending" note: the pre-fix build pushed it for every
// extension declaring roles, regardless of the roster resolving them per call.
replace(
  `  // Roles are NEVER pending here (t14/F3): mpd-roles-plugin exposes extension roles`,
  `  if (descriptor.contributes.roles.length > 0 && !projectOnly) {
    pending.push({
      item: "contributes.roles",
      reason: "pending: extension roles are resolved per call by mpd-roles-plugin (t4) — declared here, not yet exposed through mpd_roles_list",
    })
  }

  // Roles are NEVER pending here (t14/F3): mpd-roles-plugin exposes extension roles`,
  "F3 stale pending note",
)

// F4 — refused roles listed as usable: the pre-fix build listed every declared
// role name and never asked what the roster would do with it.
replace(
  `    const refuse = (reason: string): void => {
      roleCandidates.push({ index, item: label, name: item.name, persona, usable: false, reason })
      errors.push({ item: label, reason: ROLE_REFUSAL_PREFIX + reason })
    }`,
  `    const refuse = (reason: string): void => {
      roleCandidates.push({ index, item: label, name: item.name, persona, usable: true, reason })
    }`,
  "F4 refusals downgraded to usable",
)

// F4 — and the whole-view annotation (the only place a cross-extension collision is
// decided) did not exist.
replace("    annotateRoleSurfaces(entries)\n", "", "F4 annotation disabled")

writeFileSync(output, text)
console.log(`[reintroduce-defects] wrote ${output} (${text.length} bytes)`)
