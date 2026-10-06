// docker/ui/team-fixture-records.mts — the two mpd team boards the UI proof is graded on, as VALUES.
//
// PURE ON PURPOSE: no file is touched and no argument is read here, so the boards can be imported and
// asserted by a test (`packages/mpd-team-core-plugin/test/team-fixture-board.test.ts`) instead of being
// inspected through a screenshot. The CLI that writes them lives in team-fixture.mts beside this file.
//
// WHY IT IS ITS OWN FILE: the record has to express board shapes the shipping store would REFUSE to
// create (an absent blocker endpoint, a dependency cycle), so it cannot go through the store — and it
// is TypeScript because every file this repository owns is. `docker/ui/seed-team-fixture.sh` copies
// this file into the container and runs it there; nothing here is ever imported by product code.
//
// IT IS A FIXTURE AND IS DECLARED AS ONE. It hand-writes the shape `TeamRecord` /
// `TeamMemberRecord` / `TeamTaskRecord` declare in
// `packages/mpd-team-core-plugin/src/team-store.ts`, and it asserts NO product claim: the install path
// is proven by `scripts/docker-e2e.ts` and the tool path by the QA cases. What it buys is a board the
// GUI can be graded against instead of an empty state.
//
// TWO BOARD SHAPES (plan §3b):
//   normal     a six-task chain with a fan-in and a failed prerequisite: T1,T3 -> T4 -> T5 -> T6
//   malformed  the two shapes real data can carry and a naive renderer gets wrong:
//              * T3 is `blockedBy: ["T1","T9"]` and T9 is ABSENT from the board — the edge must NOT
//                be drawn, while the task still reads blocked (the store's own rule);
//              * T7 <-> T8 form a CYCLE, whose back-edge runs right-to-left in rank order, so a
//                riser computed as `child.rank - parent.rank` would go negative.
//
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The board shapes this fixture can write. */
export type FixtureBoard = "normal" | "malformed"

/** One roster member, in the record's own vocabulary. */
interface FixtureMember {
  /** mpd-minted short id. */
  id: string
  /** The display name the captain addresses. */
  name: string
  /** One-line role summary shown on the roster. */
  description: string
  /** The roster role label. */
  role: string
  /** `provider/model` the member's slot resolved to. */
  route: string
  /** The member's own state. */
  status: string
  /** ISO instant the member was staged. */
  spawnedAt: string
  /** The executor's own handle. */
  executorRef: string
}

/** One board task, in the record's own vocabulary (`blockedBy` already resolved to ids). */
interface FixtureTask {
  /** mpd-minted short id (`T1`), the id the graph draws. */
  id: string
  /** The task title. */
  subject: string
  /** The acceptance text. */
  description: string
  /** `requirement` | `work` | `review` | `repair` | `integration`. */
  kind: string
  /** The task's own state. */
  status: string
  /** Ids that must close before this one is ready — possibly naming a task NOT on this board. */
  blockedBy: string[]
  /** Paths the task is expected to touch. */
  writeScopes: string[]
  /** ISO instant the task was added. */
  createdAt: string
  /** ISO instant the task last changed. */
  updatedAt: string
  /** Monotonic per task. */
  revision: number
  /** The owning member's display name, when assigned. */
  owner?: string
  /** Claim counter. */
  attempt?: number
  /** Review round. */
  round?: number
  /** Review verdict. */
  verdict?: string
  /** The requirement clause the task serves. */
  coverageOf?: string
  /** The task a repair was opened from. */
  sourceTaskId?: string
}

/**
 * The whole record this fixture writes.
 *
 * EXPORTED because the CLI beside this file imports it as a named type: the split into a pure
 * board module and a CLI is what lets a test assert the boards, and the CLI still needs the shape
 * of the value it writes.
 */
export interface FixtureRecord {
  /** Format version the reader knows. */
  version: 1
  /** mpd team identity, also the file name. */
  teamId: string
  /** The team name the user reads. */
  name: string
  /** What the team is for. */
  description: string
  /** The Lead session this team belongs to — the key the sidebar's route resolves through. */
  leadSessionId: string
  /** Where the team is in its lifecycle. */
  phase: string
  /** ISO instant the record was created. */
  createdAt: string
  /** ISO instant the plan was approved. */
  approvedAt: string
  /** The roster. */
  members: FixtureMember[]
  /** The board. */
  tasks: FixtureTask[]
  /** The next member number to mint. */
  nextMemberNumber: number
  /** The next task number to mint. */
  nextTaskNumber: number
}

/** The instant every ISO field in the fixture carries (fixed, so two runs produce identical bytes). */
const INSTANT: string = "2026-10-05T22:30:00.000Z"
/** The one team id both boards use: a re-seed REPLACES the previous fixture rather than adding one. */
const TEAM_ID: string = "team-2026-10-05T22-30-00.000Z"

/**
 * Build one roster member.
 * @param id - the mpd member id.
 * @param name - the display name.
 * @param role - the roster role label.
 * @param route - `provider/model` the slot resolved to.
 * @param status - the member's own state.
 * @returns the member record.
 */
function member(id: string, name: string, role: string, route: string, status: string): FixtureMember {
  return { id, name, description: `${role} on this wave`, role, route, status, spawnedAt: INSTANT, executorRef: `teammate-${name}` }
}

/**
 * Build one board task. Only fields the panel actually reads are set, so a column nobody renders
 * cannot be mistaken for one the fixture forgot.
 * @param n - the task number; the id is `T<n>`.
 * @param subject - the task title.
 * @param kind - the task kind.
 * @param status - the task's own state.
 * @param blockedBy - the ids it waits on, already resolved.
 * @param extra - the optional fields (`owner`, `attempt`, `round`, `verdict`, …).
 * @returns the task record.
 */
function task(n: number, subject: string, kind: string, status: string, blockedBy: string[], extra: Partial<FixtureTask> = {}): FixtureTask {
  return {
    id: `T${n}`, subject, description: `Acceptance: ${subject}`, kind, status, blockedBy,
    writeScopes: [], createdAt: INSTANT, updatedAt: INSTANT, revision: 1, ...extra,
  }
}

/**
 * The normal board: a chain with a fan-in, a FAILED prerequisite (the OPT-1 case, where a task is
 * dispatchable only because a prerequisite gave up) and one member owning no task at all.
 * @returns the six tasks.
 */
function normalTasks(): FixtureTask[] {
  return [
    task(1, "Web: rebuild the team panel body on the payload projection", "requirement", "completed", [], { owner: "web-team-gui", coverageOf: "R1" }),
    task(2, "Web: restyle the settings card on the official design tokens", "work", "in_progress", [], { owner: "web-settings-card", coverageOf: "R2", attempt: 1 }),
    task(3, "TUI: /mpd-model pick-list over the live catalog", "work", "completed", [], { owner: "tui-model-i18n", coverageOf: "R3" }),
    task(4, "Review the integrated diff against the frozen contracts", "review", "failed", ["T1", "T3"], { owner: "ui-reviewer", round: 1, verdict: "fail" }),
    task(5, "Repair the findings the review raised", "repair", "pending", ["T4"], { owner: "web-team-gui", sourceTaskId: "T4" }),
    task(6, "Integrate: thread the translator, rebuild dists, capture evidence", "integration", "pending", ["T5"], {}),
  ]
}

/**
 * The malformed board: every task above PLUS the two shapes the panel must survive — a blocker id
 * that names no task on the board (`T9`), and a two-node cycle (`T7` <-> `T8`).
 * @returns the eight tasks.
 */
function malformedTasks(): FixtureTask[] {
  return [
    task(1, "Requirement: freeze the interfaces", "requirement", "completed", [], { owner: "lead" }),
    task(2, "Work: the first independent piece", "work", "completed", ["T1"], { owner: "web-team-gui" }),
    // T9 is not on this board: `blockingDependencies` still treats it as blocking (the task reads
    // `blocked`) while `taskDepths` drops it — so the edge to it must NOT be drawn.
    task(3, "Work: blocked by a task absent from this board", "work", "pending", ["T1", "T9"], { owner: "tui-model-i18n" }),
    task(4, "Review: depends on the absent-blocker task", "review", "pending", ["T3"], {}),
    task(5, "Repair: opened from the failed review", "repair", "pending", ["T4"], { owner: "web-settings-card", sourceTaskId: "T4" }),
    task(6, "Integration: waits on everything", "integration", "pending", ["T5"], {}),
    // The cycle: A waits on B and B waits on A. `taskDepths` resolves the revisited node to rank 0,
    // so one of these back-edges runs right-to-left and its riser must be clamped at zero.
    task(7, "Work: half of a dependency cycle", "work", "pending", ["T8"], { owner: "web-team-gui" }),
    task(8, "Work: the other half of the cycle", "work", "pending", ["T7"], { owner: "ui-reviewer" }),
  ]
}

/**
 * Assemble the record for one board shape.
 *
 * EXPORTED rather than private so `packages/mpd-team-core-plugin/test/team-fixture-board.test.ts` can
 * pin the two properties the whole R1 proof rests on — that the malformed board really carries an
 * absent blocker endpoint and a cycle — WITHOUT spawning this file as a subprocess. A fixture whose
 * defects are only ever observed through a screenshot is a fixture nobody can check.
 * @param board - which board to build.
 * @param sessionId - the Lead session the team is bound to.
 * @returns the record.
 */
export function buildRecord(board: FixtureBoard, sessionId: string): FixtureRecord {
  return {
    version: 1,
    teamId: TEAM_ID,
    name: board === "malformed" ? "malformed-board" : "webui-tui-i18n",
    description: board === "malformed" ? "Absent blocker endpoint + dependency cycle" : "Team GUI, rounded settings, TUI model menu, bilingual surfaces",
    leadSessionId: sessionId,
    phase: "active",
    createdAt: INSTANT,
    approvedAt: INSTANT,
    members: [
      member("M1", "lead", "Lead", "deepseek-official/deepseek-v4-pro", "running"),
      member("M2", "web-team-gui", "Senior Engineer", "deepseek-official/deepseek-flash", "running"),
      member("M3", "web-settings-card", "Senior Engineer", "deepseek-official/deepseek-flash", "inactive"),
      member("M4", "tui-model-i18n", "Senior Engineer", "deepseek-official/deepseek-flash", "inactive"),
      member("M5", "ui-reviewer", "Reviewer", "deepseek-official/deepseek-v4-pro", "inactive"),
    ],
    tasks: board === "malformed" ? malformedTasks() : normalTasks(),
    nextMemberNumber: 6,
    nextTaskNumber: 20,
  }
}
