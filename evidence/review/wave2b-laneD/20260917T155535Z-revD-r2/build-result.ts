// t39 review record builder: writes result.json (structured verdict + digests).
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const R = process.argv[2]
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16)
const j = {
  schema: "laneB/review-wave2b-laneD-r2/1",
  captured_at: new Date().toISOString(),
  reviewed_task: "t38",
  verdict: "pass",
  closed: {
    "R-D-F1": "blocker CLOSED - the five ex-crashing lanes run (4 PASS + mount-assert PASS in the runner; direct runs all 0/usage), zero 'REPO is not defined' in any log of my run, and my own independent scan finds 0 unbound of 113 join(REPO, sites in 18 files (the lane's arm: 288 sites/42-54 files, UNBOUND none)",
    "R-D-F2": "high CLOSED - two kept ten-lane runs with 10 case lines each and lanes/result.json complete:true lanes:10, plus MY OWN third run: 10 case lines, 8 PASS / 2 red (timeout under my 300 s budget; a boot-step flake)",
    "R-D-F3": "medium CLOSED - two new arms; driver --self-test 8/8 and live 8 arms/0 failed; the real-corpus falsifier is t38's (bound), the fixture red side reproduced",
    "R-D-F4": "low CLOSED - agent-teams-messaging named in t38 section 4 with its one-line reason; --only refuses an unknown case with exit 3",
    "R-D-F5": "verified - dumpJsonText in exactly 6 corpus files; T-69.json-stream green live",
  },
  observations: [
    "OBS-1 bundle-lifecycle: FAIL exit-1 at the boot step in my ten-lane run while composed is ok:true; PASSES standalone minutes later -> a residual heavy-boot flake, not the corpus edit. Carry-forward candidate.",
    "OBS-2 session-start-team: red in every run seen (timeout / exit-1) plus UNAVAILABLE absent-credentials in t38 run A; its deterministic compose step is ok:true in both kept runs; the red half is the stochastic live-LLM cell -> the declared selection's exit code is 1 whenever that cell lands red.",
    "OBS-3 the repair's record quotes no post-repair corpus hash list (the t18 list reproduces 6/14, the other 8 being the files the repair changed). The revision is still pinnable from my filed hash pass and the matching treeSha preview.",
  ],
  pinned_revision: {
    lf_treeSha: "5fbe9dbcd5c52c50a0148f9b2c14b07e6210f4b710e4d7060aeee94a8887b71a",
    fileCount: 324,
    matches_t38_preview: true,
    lock_untouched: true,
    repin_owed: "repin-vendor --check exit 1",
  },
  union_rule: { tree_entries: 14, distinct: 14, verdict: "UNION", witness: "mount-assert.mjs is named under two sections in the repair README; the reported count equals the tree's distinct count" },
  reproduced: {
    check_drift: "exit 0 - 46 discovered / 46 listed / 0 unlisted / 19 outside / required=10",
    driver_selftest: "exit 0 - 8/8 arms",
    driver_live: "exit 0 - 8 arms / 0 failed (T-69.raw-flag 233 files/0 prose/2 exceptions; T-69.call-site-binding 288 sites/42-54/UNBOUND none; T-89.dot-slash 0 offenders/208 prose/54 files; T-77 pair; T-80 54/2/0 + seeded mismatch exit 1; T-25 frames=2/naive first-frame-only; T-74 rule sentence; T-69.json-stream)",
    ten_lane_selection: "my own run: 10 case lines, 8 PASS / 2 red",
    single_writer_outside: "exactly ONE task holds a corpus pattern (t18, skills/**); no other 2b lane does",
    only_refusal: "exit 3 on an unknown case",
  },
  bounds: [
    "corpus is read-only for me: the real-corpus falsifier of the binding arm is t38's reading; I reproduced its fixture side + my own static scan",
    "session-start-team never completed under my 300 s budget (my reading is timeout + its kept per-step evidence)",
    "the corpus digest is a one-moment reading; any further edit re-opens the pin and the preview must be re-taken before the captain's --write",
    "this review judges lane D's repair only - other lanes' rows and the integration readings are not in it",
  ],
  digests: {},
}
for (const f of readdirSync(R).sort()) {
  const p = join(R, f)
  if (statSync(p).isFile() && f !== "result.json") j.digests[f] = sha(p)
}
writeFileSync(join(R, "result.json"), JSON.stringify(j, null, 2))
console.log("result.json written;", Object.keys(j.digests).length, "digests:", JSON.stringify(j.digests))
