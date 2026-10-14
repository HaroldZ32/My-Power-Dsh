// Triage experiment (READ-ONLY outside the sandbox): does a `dsh-tui` boot materialize its harness
// session store, and does `/mpd board` — the ONE command in this composition that APPENDS a session
// event (`mpd-tui/board-opened`, `packages/mpd-tui-plugin/src/commands.ts#runAction`) — decide it?
//
// Two arms on the SAME warm sandbox root, each boot driven with the same settle step:
//   arm A: `/mpd panel` only        (the tui-deps-ctrla drive shape)
//   arm B: `/mpd panel` + `/mpd board` (the tui-panels drive shape)
// The witness is the harness's OWN session store: a session directory that did not exist before the
// boot, and the `command/run` records inside it.
//
// Usage (repo root): bun evidence/tui/dsh-tui-015/triage-reds/probe-store-materialization.ts [sandbox-root]
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { parseSandboxArgs, readCommandRecords, runTuiSession, sandboxSessionIds, type TuiStep } from "../../../../skills/dsh-qa/scripts/lib/tui-lane.ts"

/** The sandbox root to boot in; the frozen driver's root by default. */
const root = process.argv[2] ?? ".mpd/recon/qa/tui-lanes/tui-015"
/** Where this experiment's panes go, so no lane's evidence directory is touched. */
const outRoot = join("evidence", "tui", "dsh-tui-015", "triage-reds", "probe")
/** The driver's own argument parsing, so the sandbox layout is byte-identical to a lane's. */
const parsed = parseSandboxArgs(["--sandbox-root", root], "triage-probe")
console.log("sandbox root:", parsed.root)

for (const arm of [
  { name: "A-panel-only", lane: "pA", steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 }] as TuiStep[] },
  { name: "B-panel-then-board", lane: "pB", steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 }, { name: "board-command", keys: ["/mpd board", "Enter"], waitMs: 8000 }] as TuiStep[] },
  // Arm C drives the ONE command of this composition that APPENDS a session event
  // (`/mpd board` → `mpd-tui/board-opened`), FIRST, so nothing can swallow the keystrokes.
  { name: "C-board-first", lane: "pC", steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "board-command", keys: ["/mpd board", "Enter"], waitMs: 9000 }] as TuiStep[] },
  // Arm D is the control: a command that PRINTS and appends nothing (`/mpd status`).
  { name: "D-status-only", lane: "pD", steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "status-command", keys: ["/mpd status", "Enter"], waitMs: 7000 }] as TuiStep[] },
  // Arm E validates the EXACT lane edit this triage hands to the skills writer: materialize the store
  // with `/mpd board` first (closing its scene), then drive `/mpd panel` — the panel pair must land in
  // the SAME store, which is what the store arm reads.
  { name: "E-board-then-panel", lane: "pE", steps: [{ name: "settle", keys: ["Escape"], waitMs: 3000 }, { name: "board-command", keys: ["/mpd board", "Enter"], waitMs: 9000 }, { name: "close-board", keys: ["Escape"], waitMs: 3000 }, { name: "panel-command", keys: ["/mpd panel", "Enter"], waitMs: 7000 }] as TuiStep[] },
]) {
  // The lane id is kept SHORT: the tmux socket path embeds it, and a long one trips the
  // 108-byte unix-socket limit (measured in the first run of this probe).
  if (process.argv[3] !== undefined && process.argv[3] !== arm.name) continue
  /** The session ids present before this arm's boot: the delta is what THIS boot created. */
  const before = new Set(sandboxSessionIds(parsed.root))
  /** This arm's evidence directory. */
  const outDir = join(outRoot, arm.name)
  mkdirSync(outDir, { recursive: true })
  const session = runTuiSession({ lane: arm.lane, root: parsed.root, outDir, steps: arm.steps, bootWaitMs: 120_000 })
  /** The session directories this arm's boot added. */
  const created = sandboxSessionIds(parsed.root).filter((id) => !before.has(id))
  /** The harness's command records for those new sessions only. */
  const records = readCommandRecords(parsed.root)
  const runs = records.runs.filter((run) => run.sessionId !== undefined && created.includes(run.sessionId))
  console.log("--- arm", arm.name)
  console.log("    lifecycle failures:", session.failures.length === 0 ? "(none)" : session.failures.join(" | "))
  console.log("    NEW session dirs:", created.length === 0 ? "(none)" : created.join(", "))
  console.log("    command/run records in those dirs:", JSON.stringify(runs))
}
