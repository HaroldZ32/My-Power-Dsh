// PRE-FLIGHT PROBE (t3, not the lane itself): can the REAL dsh-TUI host be driven
// headlessly in an isolated sandbox root that THIS task owns, so the plan-approval
// surface can be exercised by real keystrokes?
//
// It answers exactly three questions and prints them:
//   1. does a fresh lane root boot the real TUI after the warm dsh-tui profile is
//      seeded by symlink (no network install)?
//   2. does `/mpd plan` open the frozen `MPD plan approval` scene against a staged
//      team fixture written into the SANDBOX workspace?
//   3. what does the surface actually say when the phrase is typed and Ctrl+X pressed?
import { copyFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { REPO, runTuiSession, sandboxEnv } from "../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

const ROOT = join(REPO, ".mpd", "recon", "qa", "tui-lanes", "tui-team-surface-probe")
const WARM = join(REPO, ".mpd", "recon", "qa", "dshhome")
const OUT = join(REPO, "evidence", "tui", "team-surface-verify", "preboot-probe")
const TEAM_ID = "mpd-fixture-1"

rmSync(ROOT, { recursive: true, force: true })
for (const dir of ["dshhome", "dshhome/profiles", "home", "ws", "config", "data", "npm-cache", "pnpm-home"]) {
  mkdirSync(join(ROOT, dir), { recursive: true })
}
const warmProfile = join(WARM, "profiles", "dsh-tui")
symlinkSync(warmProfile, join(ROOT, "dshhome", "profiles", "dsh-tui"), "dir")
for (const file of [".credentials.yaml", "settings.yaml"]) {
  if (existsSync(join(WARM, file))) copyFileSync(join(WARM, file), join(ROOT, "dshhome", file))
}

const record = {
  id: TEAM_ID,
  name: "Fixture Team",
  description: "staged fixture for the t3 pre-flight probe",
  captainSessionId: "sess-fixture-captain",
  createdAt: Date.now() - 60_000,
  phase: "staged",
  planReviewState: "awaiting_review",
  members: [
    { id: "m1", name: "Architect", role: "architecture review", provider: "deepseek-official", model: "deepseek-v4-flash", status: "idle" },
    { id: "m2", name: "Senior Engineer", role: "primary implementation", provider: "deepseek-official", model: "deepseek-v4-flash", status: "idle" },
  ],
  tasks: [
    { id: "t1", kind: "requirements", subject: "freeze the contract", status: "completed", assignee: "Architect", attempt: 1, round: 1, verdict: "pass", dependencies: [] },
    { id: "t2", kind: "implementation", subject: "build it", status: "pending", assignee: "Senior Engineer", attempt: 0, round: 1, dependencies: ["t1"] },
  ],
}
const teamDir = join(ROOT, "ws", ".mpd", "team", TEAM_ID)
mkdirSync(join(teamDir, "inbox"), { recursive: true })
writeFileSync(join(teamDir, "team.json"), JSON.stringify(record, null, 2) + "\n")
writeFileSync(join(teamDir, "inbox", "captain.jsonl"), JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }) + "\n")

mkdirSync(OUT, { recursive: true })
const phrase = `approve ${TEAM_ID}`
const steps = [
  { name: "plan-open", keys: ["/mpd plan", "Enter"], waitMs: 9000 },
  { name: "phrase-typed", keys: [phrase], waitMs: 2500 },
  { name: "approve-attempt", keys: ["C-x"], waitMs: 9000 },
  { name: "after-esc", keys: ["Escape"], waitMs: 4000 },
]
const session = runTuiSession({ lane: "tui-team-surface-probe", root: ROOT, outDir: OUT, steps, bootWaitMs: 120_000 })

const report = {
  probe: "preboot",
  sandboxRoot: ROOT,
  profileSeededBy: "symlink -> " + warmProfile,
  env: { DSH_HOME: sandboxEnv(ROOT).DSH_HOME, HOME: sandboxEnv(ROOT).HOME },
  fixture: join(ROOT, "ws", ".mpd", "team", TEAM_ID, "team.json"),
  phrase,
  failures: session.failures,
  panes: session.panes.map((pane) => ({
    name: pane.name,
    chars: pane.text.length,
    lines: pane.text.split("\n").filter((line) => /MPD plan approval|confirm|required|approve|runnable|plan approval|staged|no staged|❯|error/i.test(line)).slice(0, 24),
  })),
}
writeFileSync(join(OUT, "probe.result.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 2))
