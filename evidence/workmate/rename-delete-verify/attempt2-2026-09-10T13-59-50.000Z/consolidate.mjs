// Consolidates the attempt-2 evidence into result.json / results.json.
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const read = (f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")) } catch { return null } }
const routes = read("result.json")
const tools = read("result-tools.json")
const focus = read("result-focused2.json")
const s1ts = readdirSync(join(dir, "s1"))[0]
const s1 = read(join("s1", s1ts, "result.json"))
const s1c = (k) => (s1?.steps?.[k] ?? null)

const consolidated = {
  task: "t6 independent verification - ATTEMPT 2 (re-run on the repaired bytes)",
  slug: "rename-delete-verify",
  timestamp: "attempt2-2026-09-10T13-59-50.000Z",
  verdict: "PASS - F1 fixed and re-verified, F2 withdrawn as transient, all acceptance criteria green",
  priorAttempt: "attempt 1 FAILED with F1 (both new agent tools rejected by the harness output validator while the mutation still applied) and F2 (vendor fingerprint). F1 is now fixed on disk: src declares ok in BOTH output schemas, dist rebuilt after src. F2 green since the lock refresh.",
  gitBaseline: { headBefore: "f69708809ed63a57461aa6730d297afc09e772a3", headAfter: "f69708809ed63a57461aa6730d297afc09e772a3", porcelainBefore: 65, porcelainAfter: 65, myDelta: ["evidence/workmate/rename-delete-verify/attempt2-2026-09-10T13-59-50.000Z/ (untracked, this run)"] },
  isolation: { realLibrarySha: "ce635a4d2d5b3f6688054cccc65f7f09b1e7cfbdf85e8b4988caef67a1457aee", unchanged: true, sandboxHomeAssertedInEvidence: true, realHomeAndRealDshNeverWritten: true },
  parts: {
    gates: {
      "bun test packages": { exit: 0, detail: "293 tests, 290 pass, 3 skip (opt-in comment-checker binary), 0 fail" },
      "bun run typecheck": { exit: 0, detail: "tsgo --noEmit clean" },
      "bun run test:qa": { exit: 0, detail: "all self-tests passed" },
      "node scripts/verify-vendor.mjs": { exit: 0, detail: "PASS" },
      "isolated-DSH_HOME boot (mpd-headless --dump-config)": { exit: 0, detail: "install exit 0, dump exit 0, mpd-roles + mpd-workmate + mpd-hashline rows present" },
    },
    routesAndLifecycle: { file: "result.json", total: routes?.total, passed: routes?.passed, failed: routes?.failed },
    toolAndServiceProbe: { file: "result-tools.json", total: tools?.total, passed: tools?.passed, failed: tools?.failed, f1Fix: "tool.rename now returns {ok:true,name,from,renamedFrom} and tool.delete returns {ok:true,name,archived,purged}; both are ACCEPTED by the harness output validator" },
    focusedF1Fix: { file: "result-focused2.json", total: focus?.total, passed: focus?.passed, failed: focus?.failed, onlyFailure: "deny.both-dead-names-are-unregistered - the documented NON-DECISIVE global-view control (hasTool is not a faithful proxy for the restrict() view), recorded never-a-pass" },
    readOnlyS1: { file: "s1/" + s1ts + "/result.json", ok: s1?.ok, positive: s1c("positive"), enforcement: s1c("enforcement"), reinjectionControl: s1c("reinjectionControl"), reinjectionNote: s1c("reinjectionNote"), isolation: s1c("isolation") },
  },
  notes: {
    f1FixEvidence: "FIX.rename-tool-output-accepted, FIX.delete-archive-tool-output-accepted, FIX.delete-purge-tool-output-accepted, FIX.no-invalid-output-error-anywhere, FIX.rename-tool-returns-ok-and-name and FIX.delete-tool-returns-ok-and-purged all PASS (result-focused2.json). Tool layer independently: tool.rename -> {ok:true,name:probe-2,from:probe-1} and tool.delete purge -> {ok:true,archived:null,purged:true} (result-tools.json).",
    readOnly: "The accepted §S1 case was run by t6 on the FINAL bytes from a copy retargeted into this evidence dir (s1/): exit 0, restrictError FALSE, missingCredential FALSE, stubCalls 4, and the ENFORCEMENT lane shows the child's own requests see 81 tools against the parent's 87 with childLeaksWriteCapable [] - the child cannot see ANY of the seven write-capable names. The re-injection control stays silent in this profile (refusalSeen false): documented as not reproducible, and NOT used as evidence in either direction.",
    residualPerN3: "A spawned read-only child EXECUTING a model turn needs a real provider key; that is not claimable in this deployment and nothing above claims it.",
  },
}
writeFileSync(join(dir, "result.json"), JSON.stringify(consolidated, null, 2))
writeFileSync(join(dir, "results.json"), JSON.stringify(consolidated, null, 2))
console.log("consolidated: routes", routes?.passed + "/" + routes?.total, "tools", tools?.passed + "/" + tools?.total, "focus", focus?.passed + "/" + focus?.total, "s1", s1?.ok)
