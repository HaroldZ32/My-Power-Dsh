import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, statSync } from "node:fs"

const FILES = [
  "packages/mpd-agent-teams-plugin/lib/state.js",
  "packages/mpd-agent-teams-plugin/lib/scheduler.js",
  "packages/mpd-agent-teams-plugin/lib/tools.js",
  "packages/mpd-agent-teams-plugin/lib/session-start.js",
  "packages/mpd-agent-teams-plugin/lib/mpd-deltas.js",
  "packages/mpd-agent-teams-plugin/test/r1-message-channel.test.mjs",
  "packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs",
  "packages/mpd-agent-teams-plugin/test/t53-dormant-expiry.test.mjs",
  "evidence/omo-align/requirements/frozen-contract.json",
]

const files = {}
for (const path of FILES) {
  const bytes = readFileSync(path)
  files[path] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: statSync(path).size }
}

const payload = {
  schema: "mpd/evidence/pins@1",
  task: "t53",
  round: "repair-round-3",
  whatThisIs:
    "The authoritative file pins for the R1/R3 wave, measured on the t53 WORKING TREE. It supersedes the pins in r1-wiring/result.json (t49), which were taken one revision earlier and named a test-file hash that no longer existed.",
  whyItMatters:
    "R2-F3: a third party comparing hashes must not be sent to a revision that does not exist. These pins name this task's revision and state the caveat that the captain's commit follows.",
  caveat:
    "Measured BEFORE the captain commits t53 (AGENTS.md 5: teammates never run git writes). The test files below are already committed; state.js / session-start.js / mpd-deltas.js are the t53 working-tree bytes the captain still has to commit.",
  supersessionChain: {
    "packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs": [
      { revision: "7379e28 + t49 attempt 1", sha256_prefix: "44acbc827a486546", note: "the value t49's record pinned: 179 lines, pre-task-count" },
      { revision: "50e6497 (committed by the captain after t49 went terminal)", sha256_prefix: "410185dc970b15c4", note: "added the shipped-path delivery call-count test; t49's recorded pin was left one revision behind" },
      { revision: "as of t53", sha256_prefix: "410185dc970b15c4", note: "the SAME bytes as 50e6497 — t53 added its new tests in a separate file, so this pin is correct and current", supersedes: "the 7379e28 entry above" },
    ],
  },
  t49PinCorrection: {
    file: "packages/mpd-agent-teams-plugin/test/t49-send-dedup-wiring.test.mjs",
    recordedIn: "evidence/omo-align/messaging/r1-wiring/result.json (settledFiles)",
    recordedValue: { sha256_prefix: "44acbc827a486546", lines: 179, suite: "177 pass" },
    actualAtThatRevision: { sha256_prefix: "410185dc970b15c4", bytes: 13029, suite: "178 pass" },
    verdict: "SUPERSEDED — the recorded test-file pin and test count are stale; every lib pin in that record still matches.",
  },
  files,
}
writeFileSync("evidence/omo-align/messaging/r1-wiring/settled-pins.json", JSON.stringify(payload, null, 2) + "\n")
console.log(JSON.stringify({ written: "evidence/omo-align/messaging/r1-wiring/settled-pins.json", files: Object.keys(files).length }, null, 1))
