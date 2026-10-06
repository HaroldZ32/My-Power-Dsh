// THE DAG-VERIFY BOARD FIXTURE — the one board every capture of this lane is judged against.
//
// WHY THIS FILE EXISTS RATHER THAN A COPIED RECORD. Clauses C1/C3 of the frozen contract are about what
// happens when a task SUBJECT contains Chinese: the DRAWING must lose it, the pinned DETAIL must keep it.
// A fixture that inherited a ready-made board could not prove the fallback half of clause C4 at all, and
// the previous wave's sandbox board (`.mpd/team/teams/mpd-probe-team.json`) has no subject whose printable
// ASCII runs are EMPTY. This fixture therefore mixes, ON PURPOSE, the three subject shapes the rule must
// separate:
//
//   T1  mixed  — ASCII runs `REQ` only, so the label is a fragment of a longer Chinese subject;
//   T2  pure ASCII — the whole subject survives, which is what makes the drawing WIDE (the natural width
//       clause T1 depends on a board whose labels exceed a narrow panel);
//   T3  mixed  — ASCII runs `W2` / `termaid`;
//   T4  mixed  — ASCII runs `REV` / `PTY`;
//   T5  PURE CHINESE — zero printable ASCII runs, so clause C4's `#<ordinal>` fallback is the ONLY
//       legal label and the node must read `<glyph> <id> <KIND> #5`.
//
// The record's SHAPE is the engine's own: the keys are exactly the ones a real record carries (read off
// `.mpd/team/teams/team-20261006145331.json`), so the TUI's reader meets a record indistinguishable from
// a live one. Nothing here is a product claim; it is the INPUT the capture is about.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The team id this fixture writes; the only record the sandbox workspace may carry. */
export const FIXTURE_TEAM_ID = "team-dag-verify"

/** The team name the panel header prints. */
export const FIXTURE_TEAM_NAME = "dag-edges-scroll-verify"

/** One task of the fixture board, in the engine's own record shape. */
export interface FixtureTask {
  /** Board id (`T<n>`), which every `blockedBy` entry must name to resolve. */
  readonly id: string
  /** The task's subject — the string the DRAWING must reduce and the DETAIL must keep verbatim. */
  readonly subject: string
  /** What the drawing must render for this subject, so the capture can assert it. */
  readonly expectedLabel: string
  /** The ids of the tasks that block this one, in board order. */
  readonly blockedBy: readonly string[]
}

/** The board, in the order the surface is handed it (clause C4's ordinal is 1-based over this order). */
export const FIXTURE_TASKS: readonly FixtureTask[] = Object.freeze([
  {
    id: "T1",
    subject: "REQ · 冻结验收契约：DAG 曲线与 TUI 双向滚动",
    expectedLabel: "REQ",
    blockedBy: [],
  },
  {
    id: "T2",
    // SHORTENED TWICE on 2026-10-06, and the reason is measured rather than stylistic. FIRST: the original
    // subject composed to a 67-CELL label while the natural layout's declared cap is
    // `NATURAL_MAX_NODE_WIDTH = 64`, so `label + 3` clamped to 64, `labelOverflow` was true, and the panel
    // correctly refused a box and fell back to the rail — clause T9's safety net doing its job, not a defect.
    // SECOND: `widestLabelCells` measures the COMPOSED label (`<glyph> <id> <KIND> <text>`), so a 59-cell
    // TEXT still composed to ~68 and still tripped the net. The budget the text really has is roughly
    // `64 − 12`, and that is now the fixture's target. The drawing is still wider than a 44-cell panel,
    // which is exactly the state T1/T2 are about.
    subject: "W1 natural width and panning",
    expectedLabel: "W1 natural width and panning",
    blockedBy: ["T1"],
  },
  {
    id: "T3",
    subject: "W2 termaid rounded boxes",
    expectedLabel: "W2 termaid rounded boxes",
    blockedBy: ["T1"],
  },
  {
    id: "T4",
    subject: "REV — 独立验证：真实 PTY 与真实浏览器抓图",
    expectedLabel: "REV PTY",
    blockedBy: ["T2", "T3"],
  },
  {
    id: "T5",
    subject: "完全中文的任务标题：圆角盒与拐角渲染",
    expectedLabel: "#5",
    blockedBy: ["T4"],
  },
] as const)

/** Every subject of the fixture that carries at least one Chinese character, for the C3 detail check. */
export const CHINESE_SUBJECTS: readonly string[] = FIXTURE_TASKS
  .map((task) => task.subject)
  .filter((subject) => /[\u2e80-\u9fff\uff00-\uffef]/.test(subject))

/**
 * Build the team record the fixture writes.
 *
 * Kept pure and exported so the offline arm asserts the SHAPE (every blocker resolves to a board id, the
 * pure-CJK subject's ASCII-run set is really empty) rather than trusting the literal above.
 * @returns the record, in the engine's own key order.
 */
export function fixtureRecord(): Record<string, unknown> {
  /** One fixed stamp for every timestamps field, so two runs produce byte-identical records. */
  const stamp = "2026-10-06T14:56:33.000Z"
  return {
    version: 1,
    teamId: FIXTURE_TEAM_ID,
    name: FIXTURE_TEAM_NAME,
    description: "Wave dag-edges-scroll: curved WEB edges + TUI natural width and bidirectional panning; a REAL PTY capture fixture.",
    leadSessionId: "verify-lead",
    phase: "active",
    createdAt: stamp,
    approvedAt: stamp,
    nextMemberNumber: 2,
    nextTaskNumber: FIXTURE_TASKS.length + 1,
    members: [
      { id: "M1", name: "verify", description: "the captain's verification lane", status: "running", spawnedAt: stamp, executorRef: "verify-exec" },
    ],
    tasks: FIXTURE_TASKS.map((task) => ({
      id: task.id,
      subject: task.subject,
      description: "Task " + task.id + " of the dag-edges-scroll verification fixture. Its subject is the string under test.",
      kind: "work",
      status: task.id === "T1" ? "completed" : "pending",
      blockedBy: [...task.blockedBy],
      writeScopes: [],
      createdAt: stamp,
      updatedAt: stamp,
      revision: 1,
      owner: task.id === "T1" ? "verify" : "unassigned",
    })),
  }
}

/**
 * Seed the fixture board into a sandbox WORKSPACE's team store, replacing whatever was there.
 *
 * The team directory is emptied first ON PURPOSE: a leftover record (the previous wave's probe board) would
 * still be listed, and a capture could then be judged against a board this fixture never wrote.
 * @param workspace - the sandbox workspace root (the TUI session's own cwd).
 * @returns the absolute path of the record written.
 */
export function seedBoard(workspace: string): string {
  /** The workspace's team store, the only place the TUI's reader looks. */
  const teamsDir = join(workspace, ".mpd", "team", "teams")
  mkdirSync(teamsDir, { recursive: true })
  for (const entry of readdirSync(teamsDir)) {
    if (entry.endsWith(".json")) rmSync(join(teamsDir, entry), { force: true })
  }
  /** The record file this seeding writes. */
  const file = join(teamsDir, FIXTURE_TEAM_ID + ".json")
  writeFileSync(file, JSON.stringify(fixtureRecord(), null, 2) + "\n")
  return file
}

/**
 * The printable-ASCII runs of one subject, joined by a single space — clause C4's rule, implemented
 * here ONLY to check the fixture's own expectations (the surfaces compose their own label).
 * @param subject - the task subject under test.
 * @returns the label clause C4 prescribes, or `""` when the subject holds no printable ASCII.
 */
export function asciiRuns(subject: string): string {
  /** Every maximal run of printable ASCII, in order. */
  const runs = subject.match(/[\x20-\x7e]+/g) ?? []
  return runs.join(" ").replace(/\s+/g, " ").trim()
}
