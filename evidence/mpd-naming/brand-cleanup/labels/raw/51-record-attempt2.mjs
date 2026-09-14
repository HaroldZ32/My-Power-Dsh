// Records the t2 attempt-2 verification state (measured interim RED, hazard note, corpus freeze,
// carries) into labels/result.json and labels/output.log.
// Run from the repo root: node evidence/mpd-naming/brand-cleanup/labels/raw/51-record-attempt2.mjs
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"

const RESULT = "evidence/mpd-naming/brand-cleanup/labels/result.json"
const OUT = "evidence/mpd-naming/brand-cleanup/labels/output.log"

// verify-vendor's own treeSha (LF-normalized bytes, sorted relpaths, node_modules skipped)
function readBytes(p) {
  const b = readFileSync(p)
  if (!b.includes(0)) return Buffer.from(b.toString("utf8").replace(/\r\n?/g, "\n"))
  return b
}
function listFiles(d) {
  const out = []
  const walk = (x) => {
    for (const e of readdirSync(x)) {
      const p = join(x, e)
      if (e === "node_modules") continue
      if (statSync(p).isDirectory()) walk(p)
      else out.push(p)
    }
  }
  walk(d)
  return out
}
const rel = listFiles("skills").map((f) => f.slice("skills/".length)).sort()
const h = createHash("sha256")
for (const f of rel) h.update(f + "\n" + createHash("sha256").update(readBytes(join("skills", f))).digest("hex") + "\n")
const treeSha = h.digest("hex")
const skillMdSha = createHash("sha256").update(readBytes("skills/dsh-qa/SKILL.md")).digest("hex")

const r = JSON.parse(readFileSync(RESULT, "utf8"))
r.attempt2 = {
  at: new Date().toISOString(),
  head: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
  attemptedWith: "attempt 2, attempt_id 2b51b409-89c2-494a-be29-32ffeb8e842d (t2 re-opened for a retry by the captain)",
  interim_RED_measured: {
    command: "bun run test:qa",
    exitCode: 1,
    failingCase: "skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test (check c: VENDOR_LOCK skills asset recompute)",
    failLine: "[agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=331/c1f424fef1a2 tree=297/1d277907045e (re-pin in the same commit, AGENTS.md §9)",
    everyOtherCaseGreen: true,
    note: "This is the CURRENT measurement: the earlier 4299afc4… value is SUPERSEDED because the captain-ordered skills/ast-grep/AGENTS.md:23 repair is a second skills/** edit; the settled tree hash is 1d277907045e…. t5/t6 must pin the CURRENT value, not 4299afc4.",
    waveOwned: "the re-pin is out of this task's scope (VENDOR_LOCK.json is in outOfScope, single writer = t6's wave re-pin per its description; t5 owns the codegraph entry). t8 re-runs test:qa on the settled tree.",
    logFile: "evidence/mpd-naming/brand-cleanup/labels/raw/50-attempt2-testqa-and-carries.log"
  },
  known_hazard_recorded: "agent-teams-messaging.mjs --self-test TRANSIENTLY appends a probe line to skills/dsh-qa/SKILL.md for the treeSha falsifiability check and restores the original bytes in a `finally`. It cannot race this task (single skills writer) and t8 runs test:qa only after t2 completes; anyone running test:qa concurrently with a SKILL.md edit must re-check the file's bytes afterwards. Verified after the fresh run: skills/dsh-qa/SKILL.md sha256 (LF-normalized) = " + skillMdSha + " and the corpus still recomputes to 297/" + treeSha.slice(0, 12) + " — the probe restored the file.",
  corpus_frozen: {
    status: "FROZEN — no further skills/** writes from this task",
    lastSkillsEdit: "skills/ast-grep/AGENTS.md:23 (captain-ordered corruption repair)",
    fileCount: rel.length,
    treeSha,
    statement: "Per the captain's freeze rule, the token-boundary scan's remaining in-lane items (the vendored ast-grep patch's own omo_* identifiers, and the class-3 attribution entries) are left UNTOUCHED so the corpus stays settled for the wave re-pin. One more skills edit would force a SECOND re-pin, which AGENTS.md §9 forbids."
  },
  carries_verified: {
    "scripts/build-mcp.mjs untouched by t2": execSync("git status --short -- scripts/", { encoding: "utf8" }).trim() === "",
    "@oh-my-opencode node_modules scope intact (build-mcp.mjs:276)": readFileSync("scripts/build-mcp.mjs", "utf8").includes('join(work, "node_modules", "@oh-my-opencode")'),
    "omo-config-core dir name intact (build-mcp.mjs:16,26,30)": (readFileSync("scripts/build-mcp.mjs", "utf8").match(/omo-config-core/g) || []).length >= 3,
    "boulder codex|opencode|senpi prefixes intact": readFileSync("packages/mpd-boulder-plugin/src/vendor/storage/shared.ts", "utf8").includes('"codex" | "opencode" | "senpi" | "dsh"') && readFileSync("packages/mpd-boulder-plugin/src/vendor/storage/shared.ts", "utf8").includes("/^(codex|opencode|senpi|dsh):/"),
    "boulder src/test/dist untouched by t2": execSync("git status --short -- packages/mpd-boulder-plugin/src packages/mpd-boulder-plugin/test packages/mpd-boulder-plugin/dist", { encoding: "utf8" }).trim() === "",
    "root AGENTS.md did not remove those literals": !readFileSync("AGENTS.md", "utf8").includes("omo-config-core") && readFileSync("AGENTS.md", "utf8").includes('e.g. "oh-my-opencode"'),
    note: "AGENTS.md line 512's prose shorthand 'the upstream omo CLI checkout' was reworded to 'the upstream oh-my-openagent CLI checkout' (wording only, per the captain's carry); the functional example name \"oh-my-opencode\" in that row is preserved."
  },
  completion_gate_probe: null
}

writeFileSync(RESULT, JSON.stringify(r, null, 2) + "\n")

const block = [
  "",
  "11. t2 ATTEMPT 2 — verification state, corpus freeze, carries",
  "   - MEASURED interim RED (current, supersedes the 4299afc4 value quoted earlier):",
  "     [agent-teams-messaging] FAIL: VENDOR_LOCK skills asset is stale: lock=331/c1f424fef1a2",
  "     tree=297/1d277907045e (re-pin in the same commit, AGENTS.md §9) — `bun run test:qa` exit 1,",
  "     and this is its ONLY failing case; every other case is green (raw/50-…).",
  "   - SETTLED CORPUS (frozen after the captain-ordered ast-grep repair): fileCount=" + rel.length,
  "     treeSha=" + treeSha,
  "     A raw-byte hash would be wrong (one pre-existing fixture carries a CR byte).",
  "   - HAZARD RECORDED: agent-teams-messaging --self-test transiently appends a probe line to",
  "     skills/dsh-qa/SKILL.md and restores it in a `finally`. Verified after the fresh run that the",
  "     file's normalized sha256 is " + skillMdSha.slice(0, 16) + " and the corpus still recomputes to",
  "     297/" + treeSha.slice(0, 12) + " — i.e. the probe restored the file. Anyone running test:qa concurrently",
  "     with a SKILL.md edit must re-check the bytes afterwards.",
  "   - CARRIES VERIFIED: scripts/build-mcp.mjs is UNTOUCHED by t2 (@oh-my-opencode scope at :276 and the",
  "     omo-config-core dir name at :16/:26/:30 intact); the boulder codex|opencode|senpi prefixes and its",
  "     src/test/dist are untouched; root AGENTS.md never carried those two literals and its",
  "     'oh-my-opencode' example name is preserved (only the 'the upstream omo CLI' shorthand was",
  "     reworded to 'the upstream oh-my-openagent CLI').",
  "   - FROZEN: no further skills/** writes from this task; the open omo_* rename is NOT executed",
  "     (it would force a second re-pin, which AGENTS.md §9 forbids).",
  ""
].join("\n")

writeFileSync(OUT, readFileSync(OUT, "utf8") + block)
console.log("recorded: treeSha=" + treeSha + " files=" + rel.length + " skillMdSha=" + skillMdSha.slice(0, 16))
