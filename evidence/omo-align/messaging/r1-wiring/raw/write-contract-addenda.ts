import { readFileSync, writeFileSync } from "node:fs"

const PATH = "evidence/omo-align/requirements/frozen-contract.json"
const raw = readFileSync(PATH, "utf8")
const contract = JSON.parse(raw)

// Pin-only discipline: nothing already in the contract is edited. The two new keys are
// appended at the end, so the frozen text above them stays byte-identical.
contract.interjectionExpiryBoundary = {
  addendum: "t53 boundary statement (R2-F4; the primitive and its TTL are UNCHANGED)",
  statement:
    "Expiry is evaluated at EVENTS, never by a timer: (1) a member IDLE EDGE (the scheduler tick inside kickMember), and (2) a SESSION START in the workspace (the sweep registered by installInterjectionExpirySweep).",
  consequence:
    "A dormant team — one nobody kicks and nobody opens again — resolves nothing and its requester is never told. That is a stated boundary of the design, not an unresolved row: no background clock exists, so the pre-t53 wording ('TTL 30 minutes') must not be read as wall-clock.",
  closedBy: "t53 added the session-start sweep, so the realistic dormancy case (the workspace is used again) DOES resolve past-due requests.",
  implementation: [
    "packages/mpd-agent-teams-plugin/lib/state.js — expireInterjectionsEverywhere(stateRoot, options)",
    "packages/mpd-agent-teams-plugin/lib/session-start.js — installInterjectionExpirySweep(ctx, resolved), installed unconditionally at the top of installSessionTeamPolicy so it also runs when sessionTeamPolicy.mode is off",
  ],
  test: "packages/mpd-agent-teams-plugin/test/t53-dormant-expiry.test.mjs (6 tests: past-due resolves with no kick; one ms before the deadline is left ALONE; absent/empty root is a no-op; the shipped hook runs it; a failing sweep degrades to a warning; the notice is an ordinary record)",
}

contract.openToolSurfaceEscalation = {
  addendum: "t53 escalation (R2-F1): a DESIGN decision for the user, deliberately NOT implemented here",
  question:
    "Which tool should expose enqueueInterjection / decideInterjection / clearMailboxToWatermark, and to whom is each authorized?",
  whyNotImplemented:
    "The frozen R1 intent names three distinct authorities — a member ASKS, the captain DECIDES, and the clear rule is 'captain may clear any mailbox; a member may clear only its own'. Choosing the tool names, the schemas and the authorization checks is a user-visible interface decision, so implementing it inside a repair round would be inventing the contract rather than satisfying it. t53 corrects the RECORD instead (see below).",
  currentTruth:
    "On the t53 revision these three primitives still have NO production caller: the dedup fold is wired, the interjection lane and the clear primitive are not. Nothing may be read as saying the lane is reachable.",
  recommendation:
    "One implementation slot wires a single tool pair — an ask/decide surface plus a bounded clear — with the captain-only decision and the self-only member clear enforced at the tool boundary, and a reachability assertion per primitive in test/**. Carry it as task t52.",
  recordCorrection: {
    what: "t49's completion payload and evidence/omo-align/messaging/r1-wiring/result.json both claimed 'R1 is now consumed at the tool boundary; no R1 criterion rests on an unreferenced export'.",
    why:
      "True only for the dedup fold; the same directory's dead-capability-findings.md documented the opposite minutes later, so the two files contradicted each other.",
    resolution:
      "result.json now carries an explicit SUPERSEDED block and findings.md / followup-round.md carry supersession headers; dead-capability-findings.md is marked the authoritative reading. A later reader cannot conclude the lane is reachable.",
  },
}
writeFileSync(PATH, JSON.stringify(contract, null, 2) + "\n")
console.log(JSON.stringify({ bytes: Buffer.byteLength(JSON.stringify(contract, null, 2) + "\n"), keys: Object.keys(contract).length }, null, 1))
