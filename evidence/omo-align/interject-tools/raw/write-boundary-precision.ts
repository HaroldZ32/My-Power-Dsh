import { readFileSync, writeFileSync } from "node:fs"

const PATH = "evidence/omo-align/requirements/frozen-contract.json"
const before = JSON.parse(readFileSync(PATH, "utf8"))
const contract = JSON.parse(readFileSync(PATH, "utf8"))

// Pin-only EDIT of one addendum key this task owns: nothing above it is touched, and the
// edit is verified below by comparing every OTHER key byte-for-byte.
contract.interjectionExpiryBoundary.statement =
  "Expiry is evaluated at EVENTS, never by a timer: (1) a member IDLE EDGE (the scheduler tick inside kickMember), and (2) the FIRST agent/pre-step of a session in the workspace (the sweep registered by installInterjectionExpirySweep, guarded per agent so it runs ONCE per session — agent/pre-step itself fires on every step, so the guard is what makes this statement true of the code)."
contract.interjectionExpiryBoundary.triggerPrecision =
  "installInterjectionExpirySweep registers on agent/pre-step with { global: true, prepend: true } and returns early once the calling agent id is in its per-agent settled set. It is installed from the COMPOSITION ROOT (lib/index.js, region mpd-delta interjection-expiry-registration), NOT from inside installSessionTeamPolicy — that function returns early when sessionTeamPolicy.mode is off, which would have gated dormancy resolution behind auto-routing. Verified by test/t52-root-registration.test.mjs (apply() with the policy OFF still resolves a past-due request) and test/t53-dormant-expiry.test.mjs (once per session, and a second session sweeps again)."
contract.interjectionExpiryBoundary.implementation = [
  "packages/mpd-agent-teams-plugin/lib/state.js — expireInterjectionsEverywhere(stateRoot, options): sweeps every team directory under one state root, best-effort per team, ENOENT root is a no-op",
  "packages/mpd-agent-teams-plugin/lib/session-start.js — installInterjectionExpirySweep(ctx, resolved): owns its agent/pre-step listener and its per-agent once-per-session guard",
  "packages/mpd-agent-teams-plugin/lib/index.js — the REGISTRATION lives in the composition root (region mpd-delta interjection-expiry-registration) so it runs for every session regardless of sessionTeamPolicy.mode",
]

const changed = []
for (const key of Object.keys(before)) {
  if (JSON.stringify(before[key]) !== JSON.stringify(contract[key])) changed.push(key)
}
const added = Object.keys(contract).filter((key) => before[key] === undefined)
if (changed.length !== 1 || changed[0] !== "interjectionExpiryBoundary") {
  console.error(`[contract] REFUSING to write: unexpected key drift -> ${changed.join(", ")}`)
  process.exit(1)
}
writeFileSync(PATH, JSON.stringify(contract, null, 2) + "\n")
console.log(JSON.stringify({ changedKeys: changed, addedKeys: added, bytes: Buffer.byteLength(JSON.stringify(contract, null, 2) + "\n") }, null, 1))
