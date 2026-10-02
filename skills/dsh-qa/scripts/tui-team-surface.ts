#!/usr/bin/env bun
// Case tui-team-surface: prove the TUI team-workflow + plan-approval surfaces
//
// CLAIM SET (T-80): this driver CLAIMS the assertion keys A1–A8 and A10 — the same keys its own
// `add("A…")` calls produce below. A claimed-but-unasserted key, or a produced-but-unclaimed one,
// is a defect the corpus arm reports with this path and the key.
// (`packages/mpd-tui-plugin`, frozen contract `.mpd/plans/tui-team-surface.md`)
// GATE A REAL MUTATION on a real host, and that the gate can be seen to fail.
//
// Two arms, both driven against a REAL staged-team record written to disk (never a
// hand-built object) inside an isolated sandbox:
//
//   ARM 1 — the bundle's own wiring, no TTY.  The lane calls the plugin's REAL
//     `apply()` from the built dist with a host double, takes the `mpd-tui-plan`
//     component the plugin registered, renders it, and types the frozen phrase one
//     keystroke at a time.  The mutation leaves through the REAL
//     `mpd-dsh-adapter-plugin` instance (`createDshAdapter`), so the recorded
//     harness-boundary call is the bundle's own code path, not a stand-in for it.
//
//   ARM 2 — the REAL dsh-TUI host in tmux, driven by real keystrokes, with the
//     staged record in the SANDBOX workspace.  The record is the truth source: an
//     approval that the pane claims but the file does not show is a FAIL, and so is
//     a file change the pane denies.
//
// THE NEGATIVE CONTROL (required, and it must REDDEN): the SAME drive is re-run with
// the confirmation step bypassed (empty echo / another team's id / a cancelled
// confirmation).  The lane's own `assertApprovalHappened` must FAIL on those runs —
// the red run is written to `negative-control/` and to the lane output.  A control
// that cannot fail proves nothing, so the control also asserts that the observation
// DISCRIMINATES: true exactly where the phrase was typed, false where it was not.
//
// NOT-CLAIMED is emitted verbatim in `result.json` (see NOT_CLAIMED below): the
// boundary in arm 1 is a recording double, so arm 1 proves the GATE and the adapter
// forwarding, never that the adopted runtime executed.
//
// PREREQ: absent-dsh-binary dsh-tui "npm i -g @deepseek-harness-tui/dsh-tui@0.12.0"
// PREREQ: absent-runtime tmux "install tmux; the TUI requires a real TTY"
// PREREQ: absent-fixture tui profile in the sandbox root "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install"
//
// Usage:
//   bun skills/dsh-qa/scripts/tui-team-surface.ts --self-test
//   bun skills/dsh-qa/scripts/tui-team-surface.ts [--sandbox-root <dir>] [--no-skip] [--profile-source <warm dshhome>]
// Evidence -> evidence/tui/team-surface-verify/<timestamp>/{result.json,output.log,raw/,negative-control/,panes/}
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  REPO, artifactRevision, emitMarker, gateTuiPrereqs, makeChecks, parseSandboxArgs, profileState,
  readSessionHeaders, runTuiSession,
} from "./lib/tui-lane.ts"
import type { TuiPrereq, TuiStep } from "./lib/tui-lane.ts"

/** The case slug: names the evidence dir, the tmux socket and every marker/output line. */
export const SLUG: string = "tui-team-surface"
/** The task id this lane reports in its result payload. */
export const TASK: string = "t3"
/** The scene ids and titles frozen by the contract (§3.1/§3.2). */
export const PLAN_SCENE: TuiScene = { id: "mpd-tui-plan", title: "MPD plan approval" }
/** The second frozen scene of the pair: its registration is asserted alongside the plan scene's. */
export const TEAM_SCENE: TuiScene = { id: "mpd-tui-team", title: "MPD team" }
// THE TOOL NAME MOVED WITH THE SPLIT (W6). These named the RETIRED vendored plugin's tools, and after
// the split the approval rides `mpd-team-core`'s own `agent_teams_plan` — one tool with an `action`
// enum, not a tool per verb. The boundary double below answers THIS name, so a stale constant here
// made `available()` answer false and the surface refuse before any call could be observed.
/** The tool both plan mutations ride, through its `action` argument (§6.1). */
export const APPROVE_TOOL: string = "agent_teams_plan"
/** The discard mutation rides the SAME tool, so the boundary records it under one name. */
export const DISCARD_TOOL: string = "agent_teams_plan"
/** The frozen confirmation phrase is built from the record's OWN id (§4.1). */
export const TEAM_ID: string = "mpd-fixture-1"
/** The display name the surface renders beside the id; A4 reads it off the rendered line. */
export const TEAM_NAME: string = "Fixture Team"
/** The captain session the fixture names by default; arm 2 rewrites it to the attached one. */
export const CAPTAIN_ID: string = "fixture-captain-session"
/** The instruction line the surface must always render verbatim (§3.2). */
// The instruction names the PHRASE since W6. It used to say "the exact team id", and that wording went
// with the record-derived gate: the shared projection builds the phrase from the PRE-approval identity,
// which is what the surface has when the gate asks. The frozen contract §3.2 fixed the INSTRUCTION
// LINE, so the constant moves with the line rather than the line being bent to keep the constant.
export const INSTRUCTION: string = "approval needs the exact phrase typed below, then Ctrl+X"

/** Absolute path of the built plugin dist the arm-1 mount imports. */
export const TUI_DIST: string = join(REPO, "packages", "mpd-tui-plugin", "dist", "index.js")
/** Absolute path of the built adapter dist whose REAL factory answers the boundary calls. */
export const ADAPTER_DIST: string = join(REPO, "packages", "mpd-dsh-adapter-plugin", "dist", "index.js")
/**
 * The TEAM CORE plugin, whose REAL `apply()` publishes `mpdTeams`.
 *
 * MOUNTING THIS IS THE POINT (user directive: both sides share the infrastructure). A case-local
 * double that read `teams/<id>.json` and `staging/<sessionId>.json` would be a SECOND implementation
 * of the store's read — free to drift from the one every shipped surface uses, which is exactly what
 * the shared projection exists to prevent.
 */
export const CORE_DIST: string = join(REPO, "packages", "mpd-team-core-plugin", "dist", "index.js")
/** Evidence root of this lane; each run writes `<root>/<timestamp>/`. */
export const EVIDENCE_ROOT: string = join(REPO, "evidence", "tui", "team-surface-verify")

/** A scene descriptor a lane passes to the `tuiScenes` double's `register()`. */
export interface TuiScene {
  /** The scene id the plugin registers under (frozen by the contract §3.1/§3.2). */
  readonly id: string
  /** The human-readable title the surface renders for this scene. */
  readonly title: string
}

// Only the seams this case needs are enabled: the scene + the two entry-point
// registries. Everything else (status line, renderers, settings, shortcuts, dialogs,
// session/decision events) is switched off so the double stays small and honest.
/** The seam switches handed to the plugin's `apply()`: the scene and the two entry registries only. */
const SCENE_CONFIG: Record<string, boolean> = {
  scene: true,
  commands: true,
  commandTrees: true,
  statusLine: false,
  renderers: false,
  settingsSection: false,
  shortcuts: false,
  dialogs: false,
  sessionEvents: false,
  decisionEvents: false,
}

/**
 * What this case does NOT claim. Emitted verbatim in `result.json` so a reader
 * cannot mistake a double for a runtime.
 */
export const NOT_CLAIMED: readonly string[] = [
  "ARM 1 does not execute the adopted agent_teams_approve runtime: the harness tool registry is a RECORDING DOUBLE that captures the boundary call (name, arguments, callId, agent) and answers the fixture's own counts. Arm 1 proves the in-scene confirmation GATE, the adapter forwarding of exec.agent, and that the scene reports the tool's own structured result — never that a team was approved by arm 1.",
  "ARM 1 does not drive a real TTY: it renders the registered scene component with a host double (React/ui kit, effects after render, hooks index-keyed). Real keystrokes in a real host are arm 2's claim.",
  "ARM 2 runs the real host with a REAL captain: the fixture's `captainSessionId` is set to the live session id the sandbox boot just produced, so the adopted `requireFreshCaptainTeam` check passes and the approval executes for real. It does NOT claim that this works when the record names a session that is not attached — that case was measured separately (evidence/tui/team-surface-verify/preboot-probe/: the pane refuses loudly with `the captain session <id> is not attached in this process` and the record is untouched).",
  "NO VISIBLE-VERDICT CLAIM, and this one is a MEASURED DEVIATION, not a lane limitation: when an approval COMMITS, the lane claims the RECORD flip and the pane's post-commit state — never that the frozen §4.5 verdict line was rendered. It was NOT rendered (finding F1 below): after the post-call re-read the record is no longer staged, the action block is dropped and the user sees the precondition-failure state instead.",
  "The captain model is not claimed to react to a TUI approval (contract §6.3 / NOT-CLAIMED #T3): the lane asserts the tool's own result and the record, not a subsequent model turn.",
  "No parity claim: equal facts, not equal layout/styling/geometry/localization (contract §7.1).",
  "`alt+t` is not exercised: it is best-effort by contract (§5.3).",
]

// ── pure pieces (all falsifiable from the self-test) ────────────────────────

/** One member row of the staged fixture record, shaped as the plugin's own writer spells it. */
interface StagedMember {
  /** The member's stable id inside the record. */
  readonly id: string
  /** The member's display name, matched against the task assignees. */
  readonly name: string
  /** What this member is responsible for, as the surface renders it. */
  readonly role: string
  /** The provider the member is routed to. */
  readonly provider: string
  /** The model the member is routed to. */
  readonly model: string
  /** Join instant in epoch milliseconds — re-validated by the adopted runtime's own coercion. */
  readonly joinedAt: number
  /** The member's live status as the scenario has it (`idle` for the whole drive). */
  readonly status: string
}

/** One task row of the staged fixture record; `t2` depends on `t1`, which makes the graph runnable. */
interface StagedTask {
  /** The task's id inside the record. */
  readonly id: string
  /** The task kind (`requirements` | `implementation`), as the workflow stages it. */
  readonly kind: string
  /** The task's subject line, rendered by the surface. */
  readonly subject: string
  /** The task's status; `t1` is already completed when the drive starts. */
  readonly status: string
  /** The member name the task is assigned to. */
  readonly assignee: string
  /** Attempt counter, part of the adopted runtime's durable record contract. */
  readonly attempt: number
  /** Round counter, part of the same contract. */
  readonly round: number
  /** The review verdict, present only on an already-reviewed task. */
  readonly verdict?: string
  /** Ids this task depends on; the surface refuses to run a task with an unmet dependency. */
  readonly dependencies: readonly string[]
  /** Creation instant in epoch milliseconds. */
  readonly createdAt: number
  /** Last-update instant in epoch milliseconds. */
  readonly updatedAt: number
}

/**
 * The staged team record this case writes to disk. Shaped like a record the plugin
 * itself writes — the TUI projection reads it back through its own reader, and the
 * ADOPTED runtime re-validates it at its durable boundary (`coerceTeamState` →
 * `isTeamState`: `taskSeq`, member `joinedAt`, task `createdAt`/`updatedAt`), so a
 * hand-written record that skipped those fields would be rejected there and the
 * real approval path would never be reached.
 */
interface StagedTeamRecord {
  /** The team id; the confirmation phrase is built from it, so it is the record's identity. */
  readonly id: string
  /** The team's display name. */
  readonly name: string
  /** Free-text description, recorded so the fixture is not mistaken for a real team. */
  readonly description: string
  /** The captain session the record names; a committing approval requires a FRESH attached one. */
  readonly captainSessionId: string
  /** Creation instant in epoch milliseconds; must precede the member join instants. */
  readonly createdAt: number
  /** The record phase: `staged` is what the plan surface acts on, `running` is post-approval. */
  readonly phase: string
  /** The plan-review state; the adopted runtime DELETES it when an approval commits. */
  readonly planReviewState?: string
  /** Next task sequence number the adopted runtime validates at its durable boundary. */
  readonly taskSeq: number
  /** The staged roster. */
  readonly members: readonly StagedMember[]
  /** The staged task graph. */
  readonly tasks: readonly StagedTask[]
}

/** The overridable fields of the fixture record; every one defaults to a frozen contract value. */
export interface StagedRecordOptions {
  /** The team id — also the confirmation phrase's second word; defaults to `TEAM_ID`. */
  readonly id?: string
  /** The captain session the record names; arm 2 rewrites it to the session the boot produced. */
  readonly captainSessionId?: string
  /** The team's display name; defaults to `TEAM_NAME`. */
  readonly name?: string
}

/** sha256 of a file's bytes. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * The staged team record this case writes to disk. Shaped like a record the plugin
 * itself writes — the TUI projection reads it back through its own reader, and the
 * ADOPTED runtime re-validates it at its durable boundary (`coerceTeamState` →
 * `isTeamState`: `taskSeq`, member `joinedAt`, task `createdAt`/`updatedAt`), so a
 * hand-written record that skipped those fields would be rejected there and the
 * real approval path would never be reached.
 * @param options.id - the team id (the confirmation phrase is built from it).
 * @param options.captainSessionId - the captain session the record names.
 * @param options.name - the team's display name, rendered beside the id.
 * @returns The record, with row timestamps offset behind the instant it was built at.
 */
export function stagedRecord({ id = TEAM_ID, captainSessionId = CAPTAIN_ID, name = TEAM_NAME }: StagedRecordOptions = {}): StagedTeamRecord {
  /** The instant the fixture is built at; every row timestamp is an offset behind it. */
  const now = Date.now()
  return {
    id,
    name,
    description: "staged fixture written by the tui-team-surface lane",
    captainSessionId,
    createdAt: now - 60_000,
    phase: "staged",
    planReviewState: "awaiting_review",
    taskSeq: 2,
    members: [
      { id: "m1", name: "Architect", role: "architecture review", provider: "deepseek-official", model: "deepseek-v4-flash", joinedAt: now - 55_000, status: "idle" },
      { id: "m2", name: "Senior Engineer", role: "primary implementation", provider: "deepseek-official", model: "deepseek-v4-flash", joinedAt: now - 54_000, status: "idle" },
    ],
    tasks: [
      { id: "t1", kind: "requirements", subject: "freeze the contract", status: "completed", assignee: "Architect", attempt: 1, round: 1, verdict: "pass", dependencies: [], createdAt: now - 50_000, updatedAt: now - 49_000 },
      { id: "t2", kind: "implementation", subject: "build it", status: "pending", assignee: "Senior Engineer", attempt: 0, round: 1, dependencies: ["t1"], createdAt: now - 48_000, updatedAt: now - 48_000 },
    ],
  }
}

/**
 * The confirmation phrase the contract builds from the record's OWN id (§4.1).
 * @param id The team id the phrase must name; defaults to the fixture's own id.
 * @returns The exact string the user must type before the Ctrl+X chord.
 */
export function approvalPhrase(id: string = TEAM_ID): string {
  return "approve " + id
}

/** Where a written team fixture lives, with the digest that witnesses "the TUI never writes it". */
export interface TeamFixture {
  /** Directory of the record (`<ws>/.mpd/team/<id>`). */
  readonly dir: string
  /** Absolute path of the written `team.json`. */
  readonly file: string
  /** Raw hex SHA-256 of that file at write time; re-measured after the drives as the A9 witness. */
  readonly sha256: string
}

/** The overridable options of `writeTeamFixture`. */
export interface WriteTeamFixtureOptions {
  /** Also write a one-row captain inbox, so the surface meets a record that carries mail; defaults to true. */
  readonly mailbox?: boolean
}

/**
 * Write one team record (and an inbox row) under the SANDBOX workspace.
 * @param workspace The sandbox workspace the `.mpd/team/<id>/` tree is created under.
 * @param record The record to serialize as `team.json`.
 * @param options.mailbox - also write the captain's one-row inbox; defaults to true.
 * @returns the record dir, the file, and the file's digest (the "no write" witness).
 */
export function writeTeamFixture(workspace: string, record: StagedTeamRecord, { mailbox = true }: WriteTeamFixtureOptions = {}): TeamFixture {
  // ── THE POST-SPLIT LAYOUT (fixed 2026-09-30) ────────────────────────────────
  // This wrote the RETIRED directory form, `<ws>/.mpd/team/<id>/team.json`. The team-plane split
  // moved the record to `<ws>/.mpd/team/teams/<teamId>.json` plus the index
  // `<ws>/.mpd/team/teams.json`, so the surface read NOTHING and rendered
  // `MPD plan approval — (none)` — and A4–A8, B2, B3, H1, H3 and H4 all failed as a CASCADE from
  // that one cause. No unit arm could see it: the arms build fixtures through the STORE.
  /** The teams directory the record lives in. */
  const teamsDir = join(workspace, ".mpd", "team", "teams")
  mkdirSync(join(teamsDir, "inbox"), { recursive: true })
  /** The record file, named by its OWN id as the store names it. */
  const file = join(teamsDir, String(record.id) + ".json")
  writeFileSync(file, JSON.stringify(teamRecordFrom(record), null, 2) + "\n")
  // The INDEX is what `activeTeamId` reads; a record without one is a team no session is bound to.
  writeFileSync(join(workspace, ".mpd", "team", "teams.json"), JSON.stringify({ version: 1, active: { [record.captainSessionId]: record.id } }, null, 2) + "\n")
  if (mailbox) {
    writeFileSync(join(teamsDir, "inbox", "captain.jsonl"), JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }) + "\n")
  }
  return { dir: teamsDir, file, sha256: sha256File(file) }
}

/** An ISO instant from one the fixture records as epoch milliseconds. */
const isoOf = (ms: number): string => new Date(Number.isFinite(ms) ? ms : 0).toISOString()

/**
 * Translate the case's own record shape into the STORE's `TeamRecord`.
 *
 * The case's `StagedTeamRecord` predates the split and names its fields its own way
 * (`id`/`captainSessionId`/`taskSeq`); the store is what the surface actually reads, so the fixture
 * must speak the store's language rather than a lookalike of it. Every union value is mapped
 * EXPLICITLY, because a silently mistyped status is a state the surface would render as `open`.
 * @param record The case's record.
 * @returns the record as `.mpd/team/teams/<id>.json` carries it.
 */
function teamRecordFrom(record: StagedTeamRecord): Record<string, unknown> {
  /** The store's own status vocabulary; the case's `running` phase is the store's `active`. */
  const phase = record.phase === "staged" ? "staged" : record.phase === "running" ? "active" : record.phase === "ended" ? "ended" : "idle"
  /** The task status the store knows, defaulting to `pending` for anything else. */
  const statusOf = (value: string): string =>
    value === "in_progress" || value === "completed" || value === "failed" || value === "cancelled" || value === "claimed" ? value : "pending"
  /** The task kind the store knows, defaulting to `work`. */
  const kindOf = (value: string): string =>
    value === "requirement" || value === "review" || value === "repair" || value === "integration" ? value : "work"
  return {
    version: 1,
    teamId: String(record.id),
    name: record.name,
    description: record.description,
    leadSessionId: record.captainSessionId,
    phase,
    createdAt: isoOf(record.createdAt),
    // THE TUI DERIVES `staged` FROM `approvedAt`, NOT FROM `phase` (`team-state.ts`: `staged:
    // record.approvedAt === undefined`). A fixture that set only the phase therefore read as STAGED
    // whatever it said — which is why the `non-staged-record` control could not produce the empty
    // state it exists for. A record past staging HAS an approval instant, so this states it.
    ...(phase === "staged" ? {} : { approvedAt: isoOf(record.createdAt) }),
    members: record.members.map((member, index) => ({
      id: member.id,
      name: member.name,
      description: member.role,
      ...(member.role === "" ? {} : { role: member.role }),
      ...(member.provider === "" && member.model === "" ? {} : { route: member.provider + "/" + member.model }),
      status: member.status === "running" || member.status === "failed" || member.status === "inactive" ? member.status : "inactive",
      spawnedAt: isoOf(member.joinedAt),
      // Order is the store's own numbering; a member without one reads as unnumbered rather than 0.
      ...(index === 0 ? {} : {}),
    })),
    tasks: record.tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      description: task.subject,
      kind: kindOf(task.kind),
      status: statusOf(task.status),
      blockedBy: [...task.dependencies],
      writeScopes: [],
      ...(task.assignee === "" ? {} : { owner: task.assignee }),
      attempt: task.attempt,
      round: task.round,
      ...(task.verdict === undefined ? {} : { verdict: task.verdict }),
      createdAt: isoOf(task.createdAt),
      updatedAt: isoOf(task.updatedAt),
      revision: 1,
    })),
    nextMemberNumber: record.members.length + 1,
    nextTaskNumber: Math.max(record.taskSeq, record.tasks.length + 1),
  }
}

/**
 * Remove the staged plan of one session, so a control can present a workspace with none.
 *
 * The counterpart of {@link stagePlanFixture}: a control that means "nothing is awaiting approval" has
 * to CLEAR the plan, because the record's phase no longer decides usability on its own.
 * @param workspace The sandbox workspace.
 * @param sessionId The session whose plan is dropped.
 * @returns whether a plan file was there to remove.
 */
export function clearPlanFixture(workspace: string, sessionId: string): boolean {
  /** The plan file the surface would have read. */
  const file = join(workspace, ".mpd", "team", "staging", sessionId + ".json")
  if (!existsSync(file)) return false
  rmSync(file, { force: true })
  return true
}

/**
 * The PRE-approval identity of a staged plan, derived from the record the case builds.
 *
 * ONE derivation, used by both the fixture that writes the plan and the step that types the phrase: a
 * second spelling of the plan id would make the gate and the fixture disagree, and the case would then
 * fail for a reason that has nothing to do with the surface.
 * @param record The case's staged record.
 * @returns the plan id (`plan-<instant>`).
 */
export function planIdOf(record: StagedTeamRecord): string {
  return "plan-" + isoOf(record.createdAt).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

/**
 * Stage a PLAN for one session, in the layout the shared projection reads.
 *
 * WHY THE RECORD ALONE IS NOT ENOUGH (W6): the plan surface is usable through the SHARED projection,
 * and a plan is keyed by SESSION — `.mpd/team/staging/<sessionId>.json`. The team record is
 * materialised AT approval, so before one there is no record, and a fixture that wrote only a record
 * would leave the surface showing its empty state in exactly the state it exists for.
 * @param workspace The sandbox workspace.
 * @param sessionId The LIVE session the surface will read with, discovered after the boot.
 * @param record The case's staged record, whose members and tasks become the plan's.
 * @returns the staged plan's file and its own identity.
 */
export function stagePlanFixture(workspace: string, sessionId: string, record: StagedTeamRecord): { file: string; planId: string } {
  /** The staging directory, one JSON file per session as the store writes it. */
  const stagingDir = join(workspace, ".mpd", "team", "staging")
  mkdirSync(stagingDir, { recursive: true })
  /** The plan's own identity: the PRE-approval name, and the phrase the gate demands. */
  const planId = planIdOf(record)
  /** The staged plan, in the store's own shape. */
  const plan = {
    version: 1,
    planId,
    sessionId,
    name: record.name,
    description: record.description,
    approval: "required",
    members: record.members.map((member) => ({ name: member.name, description: member.role === "" ? member.name : member.role, prompt: member.role === "" ? member.name : member.role, ...(member.role === "" ? {} : { role: member.role }) })),
    tasks: record.tasks.map((task) => ({ subject: task.subject, description: task.subject, blockedBy: [...task.dependencies], ...(task.assignee === "" ? {} : { owner: task.assignee }) })),
    stagedAt: isoOf(record.createdAt),
  }
  /** Where the plan is written; the surface resolves it by session id. */
  const file = join(stagingDir, sessionId + ".json")
  writeFileSync(file, JSON.stringify(plan, null, 2) + "\n")
  return { file, planId }
}

/** The lines of a rendered surface this case judges, already trimmed for the pane's own padding. */
export interface SurfaceFacts {
  /** The `MPD plan approval …` title line, or `""` when the surface rendered none. */
  readonly titleLine: string
  /** The `team …` line naming the record, or `""`. */
  readonly teamLine: string
  /** The verbatim §3.2 instruction line, or `""`. */
  readonly instruction: string
  /** The `required …` line naming the phrase to type, or `""`. */
  readonly requiredLine: string
  /** The required phrase with its `required ` prefix removed. */
  readonly requiredPhrase: string
  /** The whole `confirm …` line, trailing whitespace trimmed. */
  readonly echoLine: string
  /** The confirmation echo with its `confirm` prefix removed — empty when nothing was typed. */
  readonly confirmEcho: string
  /** The `runnable …` line, or `""`. */
  readonly runnableLine: string
  /** The LAST verdict/refusal line, or `""` when the surface rendered none. */
  readonly message: string
  /** The §3.2 empty-state line, `""` when the surface rendered a record instead. */
  readonly emptyState: string
}

/**
 * The lines a reader cares about out of a rendered surface (pure, so the
 * self-test can falsify the parser with a synthetic render).
 * @param text The rendered surface text, as `renderScene` or a captured pane produced it.
 * @returns The projected facts; absent lines degrade to `""` rather than throwing.
 */
export function surfaceFacts(text: string): SurfaceFacts {
  // Only LEADING whitespace is stripped: a real pane pads rows to the terminal
  // width, and the confirmation echo must be read exactly (a trailing-space strip
  // is applied to the echo alone, never to the line before the prefix is matched).
  /** The rendered rows, with each row's leading pane padding removed. */
  const lines = String(text ?? "").split("\n").map((line) => line.trimStart())
  /** Strip a line's trailing whitespace; the pane pads rows to the terminal width. */
  const clean = (line: string): string => line.replace(/\s+$/, "")
  /** The first line matching `predicate`, cleaned, or `""` when none matches. */
  const pick = (predicate: (line: string) => boolean): string => clean(lines.find(predicate) ?? "")
  /** The whole `confirm …` line, which carries the typed echo the drive reads. */
  const confirmLine = clean(lines.find((line) => line.startsWith("confirm ")) ?? "")
  return {
    titleLine: pick((line) => line.startsWith("MPD plan approval")),
    teamLine: pick((line) => /^team\s/.test(line)),
    instruction: pick((line) => line === INSTRUCTION),
    requiredLine: pick((line) => line.startsWith("required ")),
    requiredPhrase: pick((line) => line.startsWith("required ")).replace(/^required\s+/, ""),
    echoLine: confirmLine,
    confirmEcho: clean(confirmLine.replace(/^confirm\s*/, "")),
    runnableLine: pick((line) => line.startsWith("runnable ")),
    message: clean(lines.filter((line) => /^approved:|^approve failed:|^confirmation does not match|^discarded:|^discard failed:/.test(line)).at(-1) ?? ""),
    emptyState: pick((line) => line.startsWith("no staged plan for team")),
  }
}

/** One harness-boundary tool call the recording registry captured. */
export interface BoundaryCall {
  /** The tool name the adapter forwarded. */
  readonly name?: string
  /** The call's arguments; only the confirmation phrase is read back out of them. */
  readonly arguments?: {
    /** The phrase the surface typed, which the adopted gate compares against the record's id. */
    readonly confirmation?: string
  }
  /**
   * The calling agent the adapter forwarded from `exec.agent`.
   *
   * ALL THREE SPELLINGS, because the product's own `sessionIdOf` tries them in order:
   * `agent.session.id`, then a flattened `agent.sessionId`, then `agent.id`. A surface that
   * legitimately presents a session (the TUI scene acts for the session it belongs to) would look
   * like "no caller" to a reader that knew only the third.
   */
  readonly agent?: {
    /** The nested session, which is how a surface-initiated call presents its caller. */
    readonly session?: { readonly id?: string }
    /** A flattened session field, for a caller that carries it that way. */
    readonly sessionId?: string
    /** The agent's own id, matched against the record's captain session. */
    readonly id?: string
  }
  /** The correlation id the harness assigned to the call. */
  readonly callId?: string
}

/** One approve call projected to the four facts the A7 assertion checks. */
export interface ApprovalAttempt {
  /** The tool name the boundary recorded. */
  readonly name: string | undefined
  /** The confirmation text the call carried, matched against the record's own phrase. */
  readonly confirmation: string | undefined
  /** The calling agent's id, matched against the record's captain session id. */
  readonly agentId: string | undefined
  /** True when the call carried a non-empty id, i.e. the boundary call can be correlated. */
  readonly callIdPresent: boolean
}

/** What one drive is reduced to: the rendered bytes, the parsed facts and the boundary log. */
export interface Observation {
  /** The rendered bytes the judgement was made from: every claim quotes this. */
  readonly text: string
  /** The parsed lines of that render. */
  readonly facts: SurfaceFacts
  /** The exact phrase this run typed. */
  readonly phrase: string
  /** The boundary calls handed to this observation, in call order. */
  readonly boundaryCalls: readonly BoundaryCall[]
  /** The subset of those calls that named the approve tool. */
  readonly approveCalls: readonly BoundaryCall[]
  /** One projected record per approve call, in call order. */
  readonly approvalAttempts: ApprovalAttempt[]
  /** True ONLY on a real harness-boundary call; pane text alone can never set it. */
  readonly approvalHappened: boolean
}

/** The options one `observe` reduction accepts. */
export interface ObserveOptions {
  /** The rendered surface text the facts are parsed from. */
  readonly text: string
  /** The boundary calls this run produced, or `undefined` when the run recorded none. */
  readonly boundaryCalls?: readonly BoundaryCall[]
}

/**
 * Reduce one drive to the observable facts.
 *
 * `approvalHappened` is true ONLY on a real call at the harness boundary: the pane
 * text alone can never set it.
 * @param options.text - the rendered surface text.
 * @param options.boundaryCalls - the boundary calls this run produced.
 * @param phrase - the phrase this run typed; defaults to the record's own approval phrase.
 * @returns The observation, with every approve call projected and the boundary verdict set.
 */
export function observe({ text, boundaryCalls }: ObserveOptions, phrase: string = approvalPhrase()): Observation {
  /** The parsed lines of the rendered surface. */
  const facts = surfaceFacts(text)
  /** The boundary calls that named the approve tool, in call order. */
  const approveCalls = (boundaryCalls ?? []).filter((call) => call?.name === APPROVE_TOOL)
  return {
    // The rendered bytes the judgement was made from: every claim quotes this.
    text: String(text ?? ""),
    facts,
    phrase,
    boundaryCalls: boundaryCalls ?? [],
    approveCalls,
    approvalAttempts: approveCalls.map((call) => ({
      name: call.name,
      confirmation: call.arguments?.confirmation,
      // THE CALLER'S IDENTITY, read with the SAME precedence the tool itself uses
      // (`sessionIdOf`: `agent.session.id` ?? `agent.sessionId` ?? `agent.id`). Reading only `.id`
      // made this arm report "no caller" about a call that carried the session the tool had just
      // resolved its workspace from — the observation disagreed with the product about what a caller
      // even IS.
      agentId: call.agent?.session?.id ?? call.agent?.sessionId ?? call.agent?.id,
      callIdPresent: typeof call.callId === "string" && call.callId.length > 0,
    })),
    approvalHappened: approveCalls.length > 0,
  }
}

/** The verdict `assertApprovalHappened` reaches: whether the boundary recorded the call, and why. */
export interface ApprovalAssertion {
  /** True only when at least one approve-tool call reached the harness boundary. */
  readonly pass: boolean
  /** The evidence sentence naming the call count, or naming its absence. */
  readonly reason: string
}

/**
 * The assertion the negative control must be able to REDDEN.
 *
 * This is the lane's own check: "an approval happened". It is deliberately a
 * standalone function so the control run evaluates the SAME code as the green run.
 * @param observation The reduced observation of one drive.
 * @returns The assertion verdict; `pass` is false whenever no approve call was recorded.
 */
export function assertApprovalHappened(observation: Observation): ApprovalAssertion {
  if (observation?.approvalHappened !== true) {
    return { pass: false, reason: "no call to " + APPROVE_TOOL + " reached the harness boundary (calls=" + (observation?.approveCalls?.length ?? 0) + ")" }
  }
  return { pass: true, reason: "the harness boundary recorded " + observation.approveCalls.length + " call(s) to " + APPROVE_TOOL }
}

// ── the host double (React/ui kit) ─────────────────────────────────────────

/** The terminal size the kit reports; the scene lays its surface out against it. */
export interface TerminalSize {
  /** Terminal width in columns. */
  readonly columns: number
  /** Terminal height in rows. */
  readonly rows: number
}

/** The props bag the double carries through an element; only `children` is ever walked. */
export interface KitProps {
  /** The element's children, read back by `Text` and by the tree walker. */
  readonly children?: unknown
  /** Any further prop the scene passes; the double never inspects it. */
  readonly [key: string]: unknown
}

/** One element of the double's tree, in the shape the kit's own components produce. */
export interface KitNode {
  /** The element type: `"Text"`/`"Box"` for the kit's components, the caller's tag otherwise. */
  readonly type: unknown
  /** The element's props, `undefined` when the caller passed none. */
  readonly props?: KitProps
  /** The children captured by `createElement`. */
  readonly children?: unknown[]
}

/** The key descriptor a captured `useInput` handler receives; only the flags the drive sets. */
export interface KitKey {
  /** True for the Ctrl+X chord that submits the typed confirmation phrase. */
  readonly ctrl?: boolean
  /** True for the Escape that cancels the confirmation step. */
  readonly escape?: boolean
  /** Any further key flag the scene reads; the double passes it through untouched. */
  readonly [key: string]: unknown
}

/** The React surface the scene component consumes from the double. */
export interface KitReact {
  /** Build an element node; `props` defaults to the empty bag. */
  readonly createElement: (type: unknown, props?: KitProps, ...children: unknown[]) => KitNode
  /** Index-keyed state slot: the reconciler's hook-order contract, modelled rather than assumed. */
  readonly useState: (initial: unknown) => [unknown, (next: unknown) => void]
  /** Queue an effect for the next `flush()`, so effects run AFTER the render that requested them. */
  readonly useEffect: (fn: () => void) => void
  /** Index-keyed ref slot; the same object survives every render at the same hook position. */
  readonly useRef: (initial: unknown) => { current: unknown }
  /** A no-op subscription hook: the double never wires an external store. */
  readonly useSyncExternalStore: () => void
}

/** The terminal UI kit the scene component consumes from the double. */
export interface KitUi {
  /** The box component; its children stay empty, matching the double's render shape. */
  readonly Box: (props?: KitProps) => KitNode
  /** The text component; its single child is the props' own `children`. */
  readonly Text: (props?: KitProps) => KitNode
  /** Capture the scene's input handler so `press` can drive it; the LAST one registered wins. */
  readonly useInput: (handler: (input: string, key: KitKey) => void) => void
  /** Report the terminal size the scene lays out against. */
  readonly useTerminalSize: () => TerminalSize
}

/** The host kit double `makeKit` returns: the React/ui surfaces plus the drive primitives. */
export interface HostKit {
  /** The React surface handed to the scene component. */
  readonly React: KitReact
  /** The terminal UI kit handed to the scene component. */
  readonly ui: KitUi
  /** The captured `useInput` handlers, newest last; `press` drives the newest. */
  readonly handlers: ((input: string, key: KitKey) => void)[]
  /** Reset the hook index and drop captured handlers, as a fresh mount does. */
  readonly begin: () => void
  /** Run the effects queued during the last render; true when at least one ran. */
  readonly flush: () => boolean
  /** Drive the newest captured `useInput` handler; throws when the scene registered none. */
  readonly press: (input: string, key?: KitKey) => void
  /** Flatten a rendered tree to the newline-joined text the pane assertions parse. */
  readonly text: (tree: unknown) => string
}

/**
 * A host kit double that models the host instead of being permissive: hooks are
 * index-keyed across renders (the reconciler's hook-order contract), effects run
 * AFTER the render, and `useInput` handlers are captured so a key can be pressed.
 * @param terminal The terminal size the scene lays out against; defaults to the drive's 216x48 pane.
 * @returns The kit, with the React/ui surfaces and the begin/flush/press/text drive primitives.
 */
export function makeKit(terminal: TerminalSize = { columns: 216, rows: 48 }): HostKit {
  /** The hook store, keyed by `<kind>:<hook index>` so the order of hooks is what identifies a slot. */
  const store: Map<string, unknown> = new Map()
  /** Every `useInput` handler the scene registered, newest last. */
  const handlers: ((input: string, key: KitKey) => void)[] = []
  /** The current hook position, reset by `begin()` so each render replays the same hook order. */
  let index = 0
  /** Effects queued during the current render, run by the next `flush()`. */
  let pending: (() => void)[] = []
  /** The React surface handed to the scene component. */
  const React: KitReact = {
    createElement: (type: unknown, props?: KitProps, ...children: unknown[]): KitNode => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** The hook slot key for this position in the render's hook order. */
      const key = "state:" + index
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? initial() : initial)
      return [store.get(key), (next: unknown) => store.set(key, typeof next === "function" ? next(store.get(key)) : next)]
    },
    useEffect: (fn: () => void): void => {
      /** The hook slot key for this effect's position in the render's hook order. */
      const key = "effect:" + index
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** The hook slot key for this ref's position in the render's hook order. */
      const key = "ref:" + index
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      // The stored slot is the ref object this hook position created; the cast states that
      // invariant because a `Map<string, unknown>` read cannot recover it.
      return store.get(key) as { current: unknown }
    },
    useSyncExternalStore: (): void => {},
  }
  /** The text component double: one child, the props' own `children` value. */
  const Text = (props?: KitProps): KitNode => ({ type: "Text", props, children: [props?.children] })
  /** The box component double: it carries props through but renders no children of its own. */
  const Box = (props?: KitProps): KitNode => ({ type: "Box", props, children: [] })
  /** The terminal UI kit handed to the scene component. */
  const ui: KitUi = {
    Box,
    Text,
    useInput: (handler: (input: string, key: KitKey) => void): void => { handlers.push(handler) },
    useTerminalSize: (): TerminalSize => terminal,
  }
  return {
    React,
    ui,
    handlers,
    begin: (): void => { index = 0; handlers.length = 0 },
    flush: (): boolean => {
      /** The effects queued by the render that just ran, drained before this call returns. */
      const list = pending;
      pending = [];
      for (const fn of list) fn();
      return list.length > 0
    },
    press: (input: string, key: KitKey = {}): void => {
      /** The newest captured handler — the scene re-registers on every render, so this is the live one. */
      const handler = handlers.at(-1)
      if (handler === undefined) throw new Error("no useInput handler was registered by the scene")
      handler(input, key)
    },
    text: (tree: unknown): string => {
      /** The string leaves collected in render order. */
      const out: string[] = []
      /** Walk one node of the rendered tree, collecting its string leaves in render order. */
      const walk = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return }
        if (Array.isArray(node)) { for (const child of node) walk(child); return }
        // The remaining node is the double's own element shape; `unknown` cannot be narrowed to it,
        // so the cast states the shape this walker reads (erased at runtime, no new statement). The
        // guard proves `props` is defined, which `!` states without adding a branch.
        if ((node as KitNode).props?.children !== undefined) walk((node as KitNode).props!.children)
        for (const child of (node as KitNode).children ?? []) walk(child)
      }
      walk(tree)
      return out.join("\n")
    },
  }
}

/** A registered scene component: the host kit props go in, a tree (or `null`) comes out. */
export type SceneComponent = (props: Record<string, unknown>) => unknown

/**
 * Render a scene component until its effects settle.
 * @param kit The host kit double the component renders against.
 * @param component The registered scene component to drive.
 * @param props The extra props merged over the kit surfaces.
 * @returns The flattened text of the last render, after up to six effect passes.
 */
export function renderScene(kit: HostKit, component: SceneComponent, props: Record<string, unknown>): string {
  /** The tree of the most recent render; `undefined` only if the loop body somehow never ran. */
  let tree: unknown
  for (let pass = 0; pass < 6; pass += 1) {
    kit.begin()
    tree = component({ React: kit.React, ui: kit.ui, close: () => {}, ...props })
    if (!kit.flush()) break
  }
  return kit.text(tree)
}

// ── arm 1: the bundle's own wiring, driven by captured keystrokes ───────────

/** The scoped-context double handed to an `inject()` callback: the same service lookup as `ctx`. */
export interface ScopedContextDouble {
  /** Resolve one registered service by id; `undefined` when the double never registered it. */
  readonly get: (id: string) => unknown
}

/** The cordis-context double the plugin's REAL `apply()` is mounted with. */
export interface ContextDouble {
  /** Resolve one registered service by id; `undefined` when the double never registered it. */
  readonly get: (id: string) => unknown
  /** Run `callback` once every named dependency is registered; records a failed prepare instead of throwing. */
  readonly inject: (deps: readonly string[], callback: (scoped: ScopedContextDouble) => void) => Record<string, unknown>
  /** Register a never-fired event listener; the double records nothing and disposes nothing. */
  readonly on: () => { dispose: () => void }
  /** Run a scoped effect immediately; a throwing effect is contained because a disposed scope owns none. */
  readonly effect: (fn: () => void) => void
  /** Publish one service, so a REAL plugin row can expose its seam to the next row mounted. */
  readonly provide: (id: string, value: unknown) => unknown
  /** The plugin's logger seam, with every level a no-op so the mount stays quiet. */
  readonly logger: {
    /** Swallow an info line. */
    readonly info: () => void
    /** Swallow a warning line. */
    readonly warn: () => void
    /** Swallow a debug line. */
    readonly debug: () => void
    /** Swallow an error line. */
    readonly error: () => void
  }
}

/** One agent the `agents` seam double reports, in the shape the plugin's own lookup reads. */
export interface AgentDouble {
  /** The agent id the boundary call's `exec.agent.id` is matched against. */
  readonly id: string
  /** The agent's session facts; the header cwd is the workspace the record resolves against. */
  readonly session: {
    /** The session header the plugin reads the workspace out of. */
    readonly header: {
      /** Absolute workspace the agent's session runs in. */
      readonly cwd: string
    }
  }
}

/** One command descriptor the `commands` seam double records; only its name is projected. */
export interface CommandDescriptor {
  /** The command name; a descriptor without one is recorded as `"?"`. */
  readonly name?: string
}

/** One scene registration the plugin made through the `tuiScenes` seam double. */
export interface SceneRegistration {
  /** The scene id the plugin registered under. */
  readonly id: string
  /** The scene title the plugin registered. */
  readonly title: string
  /** The scene component the plugin registered, driven by `renderScene`. */
  readonly component: SceneComponent
}

/** The structured result the recording `tools.execute` double answers with (the fixture's own counts). */
export interface RecordedToolResult {
  /** The team status the scene renders after a committed approval. */
  readonly status: string
  /** The team id the call confirmed, echoed back so the scene's message can be matched. */
  readonly team_id: string
  /** The member count of the fixture. */
  readonly members: number
  /** The task count of the fixture. */
  readonly tasks: number
}

/** The result `mountBundle` returns: the registrations, the boundary log and the scene pair. */
export interface MountedBundle {
  /** What `apply()` returned; `unknown` because the plugin's return shape is not this lane's contract. */
  readonly report: unknown
  /** The `apply()` failure message, `undefined` on a clean mount. */
  readonly applyError: string | undefined
  /** One line per `inject()` prepare that threw while the plugin mounted. */
  readonly installErrors: string[]
  /** Every scene the plugin registered, in registration order. */
  readonly sceneRegistrations: SceneRegistration[]
  /** The names of every command the plugin registered. */
  readonly commandRegistrations: string[]
  /** Every harness-boundary tool call the recording registry captured, in call order. */
  readonly boundaryCalls: BoundaryCall[]
  /** The registered plan scene, `undefined` only when the plugin failed to register it (A1's red). */
  readonly plan: SceneRegistration | undefined
  /** The registered team scene, the second half of the §3.2 scene pair. */
  readonly team: SceneRegistration | undefined
  /** The adapter module the mount loaded, so the caller can prove which instance answered. */
  readonly adapter: unknown
}

/** The options `mountBundle` accepts: the sandbox roots plus the fixture's own counts. */
export interface MountBundleOptions {
  /** The sandbox workspace whose `.mpd/team/` record the mounted surface reads. */
  readonly workspace: string
  /** The sandbox HOME the mount was given; unused by the doubles, kept for call-shape parity. */
  readonly home: string
  /** Member count the recording tool result answers with; defaults to the fixture's 2. */
  readonly members?: number
  /** Task count the recording tool result answers with; defaults to the fixture's 2. */
  readonly tasks?: number
}

/** The adapter module surface this lane calls: the bundle's REAL harness-boundary factory. */
interface AdapterModule {
  /** Build the adapter instance the plugin resolves as `mpdDsh`, over the recording host double. */
  readonly createDshAdapter: (ctx: ContextDouble) => unknown
}

/** The built plugin module surface this lane calls: its REAL `apply()`. */
interface TuiPluginModule {
  /** Mount the plugin against the host double; returns the plugin's own report (unread here). */
  readonly apply: (ctx: ContextDouble, config: Record<string, boolean>) => unknown
}

/**
 * Mount the REAL built plugin through its REAL `apply()` with a host double and a
 * recording harness tool registry, and return what it registered.
 * @param options.workspace - the sandbox workspace the mounted surfaces read state from.
 * @param options.home - the sandbox HOME the mount is told about.
 * @param options.members - member count the recording tool result answers with.
 * @param options.tasks - task count the recording tool result answers with.
 * @returns The mount facts: registrations, the boundary log, both scene components and the adapter.
 */
export async function mountBundle({ workspace, home, members = 2, tasks = 2 }: MountBundleOptions): Promise<MountedBundle> {
  /** The service doubles the mounted plugin resolves through `ctx.get(id)`, keyed by seam name. */
  const services: Record<string, unknown> = {}
  /** Every scene the plugin registered, in registration order. */
  const sceneRegistrations: SceneRegistration[] = []
  /** The names of every command the plugin registered. */
  const commandRegistrations: string[] = []
  /** Every harness-boundary tool call the recording registry captured. */
  const boundaryCalls: BoundaryCall[] = []
  /** One line per `inject()` prepare that threw while the plugin mounted. */
  const installErrors: string[] = []
  /** The agent the `agents` double reports, so `exec.agent` resolves to the fixture captain. */
  const agents: AgentDouble[] = [{ id: CAPTAIN_ID, session: { header: { cwd: workspace } } }]

  /** The cordis context double the plugin's real `apply()` is mounted with. */
  const ctx: ContextDouble = {
    get: (id: string): unknown => services[id],
    inject: (deps: readonly string[], callback: (scoped: ScopedContextDouble) => void): Record<string, unknown> => {
      try {
        if (deps.every((dep) => services[dep] !== undefined)) callback({ get: (id: string): unknown => services[id] })
      } catch (error) {
        // The thrown value is `unknown`: the cast states the Error-ish shape whose message is logged.
        installErrors.push("inject(" + deps.join(",") + "): " + String((error as { message?: unknown })?.message ?? error))
      }
      return {}
    },
    on: (): { dispose: () => void } => ({
      /** Release the subscription; the double registered nothing, so this is a no-op. */
      dispose(): void {}
    }),
    effect: (fn: () => void): void => { try { fn() } catch { /* a disposed scope owns no effects */ } },
    // `provide` writes into the SAME bag `get` reads, which is what lets the real core row publish
    // `mpdTeams` and the real TUI row find it — the two rows composed here as they are in a boot.
    provide: (id: string, value: unknown): unknown => { services[id] = value; return value },
    logger: { info: (): void => {}, warn: (): void => {}, debug: (): void => {}, error: (): void => {} },
  }

  services.tuiScenes = {
    register: (descriptor: SceneRegistration): void => { sceneRegistrations.push({ id: descriptor.id, title: descriptor.title, component: descriptor.component }) },
    open: (): boolean => true,
  }
  services.commands = { register: (descriptor: CommandDescriptor): void => { commandRegistrations.push(descriptor?.name ?? "?") }, list: (): unknown[] => [] }
  services.tuiCommandTrees = { register: (): Record<string, unknown> => ({}), list: (): unknown[] => [] }
  services.agents = { list: (): AgentDouble[] => agents, get: (id: string): AgentDouble | undefined => agents.find((agent) => agent.id === id) }
  services.tools = {
    get: (name: string): { name: string } | undefined => (name === APPROVE_TOOL || name === DISCARD_TOOL ? { name } : undefined),
    execute: async (exec: BoundaryCall): Promise<{ value: RecordedToolResult }> => {
      boundaryCalls.push(exec)
      return { value: { status: "running", team_id: exec?.arguments?.confirmation?.replace(/^approve\s+/, "") ?? TEAM_ID, members, tasks } }
    },
  }
  /** The adapter module the mount loaded, whose REAL factory is the bundle's own boundary code path. */
  const adapter: AdapterModule = (await import(pathToFileURL(ADAPTER_DIST).href))
  services.mpdDsh = adapter.createDshAdapter(ctx)

  /** The built TUI plugin module, mounted below through its REAL `apply()`. */
  // THE CORE ROW FIRST, so `mpdTeams` exists before the TUI row looks for it. Its REAL `apply()` is
  // what publishes the service — the same call a boot makes — so the offline surface reads through the
  // one implementation rather than a case-local lookalike.
  if (services.mpdTeams === undefined) {
    try {
      /** The core plugin module, mounted for its service publication. */
      const core = (await import(pathToFileURL(CORE_DIST).href)) as { apply?: (ctx: unknown) => void }
      core.apply?.(ctx)
    } catch (error) {
      installErrors.push("core apply: " + String((error as { message?: unknown })?.message ?? error))
    }
  }
  /** The built TUI plugin module, mounted below through its REAL `apply()`. */
  const tui: TuiPluginModule = await import(pathToFileURL(TUI_DIST).href)
  /** What `apply()` returned, `undefined` when it threw. */
  let report: unknown
  /** The `apply()` failure message, `undefined` on a clean mount. */
  let applyError: string | undefined
  try {
    report = tui.apply(ctx, SCENE_CONFIG)
  } catch (error) {
    // The thrown value is `unknown`: the cast states the Error-ish shape whose message is recorded.
    applyError = String((error as { message?: unknown })?.message ?? error)
  }
  /** The registrations keyed by scene id, so `plan`/`team` are the plugin's OWN entries. */
  const byId: Map<string, SceneRegistration> = new Map(sceneRegistrations.map((entry): [string, SceneRegistration] => [entry.id, entry]))
  return {
    report,
    applyError,
    installErrors,
    sceneRegistrations,
    commandRegistrations,
    boundaryCalls,
    plan: byId.get(PLAN_SCENE.id),
    team: byId.get(TEAM_SCENE.id),
    adapter,
  }
}

/** The scenario phase a drive runs; `mode` is the ONLY difference between the green run and the reds. */
export type DriveMode = "typed" | "empty" | "wrong-id" | "cancelled"

/** What one drive observed: the echo at entry, the pre-chord render and the post-chord render. */
export interface DriveRun {
  /** The scenario phase this run drove. */
  readonly mode: DriveMode
  /** The confirmation echo read BEFORE any keystroke (must be empty — no prefill). */
  readonly atEntry: string
  /** The render immediately before the Ctrl+X chord, the one that must carry the typed echo. */
  readonly beforeChord: string
  /** The render after the chord and the async settle, where the verdict or refusal is read. */
  readonly afterChord: string
}

/** The options one confirmation drive accepts. */
export interface DriveOptions {
  /** The host kit double whose captured handler is pressed. */
  readonly kit: HostKit
  /** The registered plan scene component to render. */
  readonly component: SceneComponent
  /** The scenario phase; only `typed`/`cancelled` type the phrase, only `cancelled` escapes. */
  readonly mode: DriveMode
  /** The phrase typed keystroke by keystroke; defaults to the record's own approval phrase. */
  readonly phrase?: string
  /** The live session the host hands the scene on its channel; the staged plan is keyed by it. */
  readonly sessionId?: string
}

/**
 * Drive one confirmation scenario through the registered plan surface.
 * `mode` is the ONLY difference between the runs, so the control is a true re-run.
 * @param options.kit - the host kit double to press keys on.
 * @param options.component - the registered plan scene component.
 * @param options.mode - the scenario phase.
 * @param phrase - the phrase to type; the wrong-id red overrides it with another team's.
 * @param sessionId - the LIVE session the host hands the scene on its channel; the plan is keyed by it.
 * @returns The echo at entry, the render before the chord and the render after it settled.
 */
export async function drive({ kit, component, mode, phrase = approvalPhrase(), sessionId = CAPTAIN_ID }: DriveOptions): Promise<DriveRun> {
  // THE CHANNEL IS THE SESSION. A staged plan is session-scoped and the scene reads the id off its own
  // live channel, so a drive that passes no channel leaves the surface with no key to read a plan with
  // — which is precisely what made this arm report an empty phrase before the split's own wiring moved
  // the plan behind a session.
  /** The extra props the surface is rendered with. */
  const props: Record<string, unknown> = { channel: { sessionId } }
  /** The current rendered surface text. */
  let text = renderScene(kit, component, props)
  /** The confirmation echo as read before any keystroke, which must be empty (no prefill). */
  const atEntry = surfaceFacts(text).confirmEcho
  if (mode === "typed" || mode === "cancelled") {
    for (const character of phrase) {
      renderScene(kit, component, props)
      kit.press(character, {})
    }
    text = renderScene(kit, component, props)
  }
  if (mode === "cancelled") {
    kit.press("", { escape: true })
    text = renderScene(kit, component, props)
  }
  /** The render immediately before the chord, which must already carry the typed echo. */
  const beforeChord = text
  kit.press("x", { ctrl: true })
  // A REAL timer, never `Atomics.wait`: the tool call is an async chain, and a
  // blocking wait would let it settle only after the render that checks it.
  await new Promise((resolve) => setTimeout(resolve, 60))
  text = renderScene(kit, component, props)
  return { mode, atEntry, beforeChord, afterChord: text }
}

/** One assertion row of an arm: its stable claim key, the verdict and the evidence note. */
export interface CheckItem {
  /** The claim key (A1–A10 / H1–H6) the note is evidence for. */
  readonly id: string
  /** True only when the assertion held; every other value is a red. */
  readonly ok: boolean
  /** The one-line evidence sentence printed into the run log. */
  readonly note: string
  /** Any extra lane-specific field the arm attaches to this row. */
  readonly [key: string]: unknown
}

/** One bypassed run: its scenario id, the observation it produced and the raw drive path. */
export interface BypassRun {
  /** The scenario phase that was driven (`empty` | `wrong-id` | `cancelled`). */
  readonly mode: DriveMode
  /** The reduced observation the shared approval assertion is evaluated on. */
  readonly observation: Observation
  /** The raw renders of this run, kept so every red can be re-read from bytes. */
  readonly path: DriveRun
}

/** The per-run recording bookkeeping the bypassed drives keep. */
interface BypassScratch {
  /** The call log this scratch was opened with (the original's own scratch field). */
  readonly boundaryCalls: BoundaryCall[]
  /** The scenario id this scratch belongs to. */
  readonly name: string
  /** The slice of boundary calls this run produced, filled in after the drive. */
  calls?: BoundaryCall[]
  /** The raw renders of this run, filled in after the drive. */
  path?: DriveRun
}

/** One empty-state arm's setup: the scenario name and the sandbox mutation it performs. */
export interface EmptyStateCase {
  /** The arm's scenario name, recorded in the result. */
  readonly name: string
  /** Create the workspace state this arm measures; a no-op for the absent-record arm. */
  readonly setup: (workspace: string) => void
}

/** One empty-state arm's outcome: what it rendered, and whether the render threw. */
export interface EmptyStateArm {
  /** The arm's scenario name (`malformed-record` | `non-staged-record` | `absent-record`). */
  readonly name: string
  /** The thrown message, `undefined` when the render threw nothing (which is the pass). */
  readonly threw: string | undefined
  /** The parsed surface facts, `undefined` when the render threw before producing any text. */
  readonly facts?: SurfaceFacts
}

/** The negative control written to `negative-control/`, with the discriminator that gives it force. */
export interface NegativeControl {
  /** The declared reading of the control run. */
  readonly note: string
  /** What the control MUST report (`fail`) for the green run to mean anything. */
  readonly expected: string
  /** What it actually reported. */
  readonly observed: string
  /** The green run's assertion outcome and evidence message. */
  readonly green: {
    /** The phase the green run drove. */
    readonly mode: string
    /** The green assertion's verdict. */
    readonly pass: boolean
    /** The green assertion's evidence sentence. */
    readonly reason: string
    /** The message line the green surface rendered. */
    readonly message: string
  }
  /** Every bypassed run's assertion outcome, so a per-mode red is readable. */
  readonly reds: {
    /** The phase this red drove. */
    readonly mode: DriveMode
    /** The red assertion's verdict, which must be false. */
    readonly pass: boolean
    /** The red assertion's evidence sentence. */
    readonly reason: string
    /** The message line the red surface rendered. */
    readonly message: string
  }[]
  /** True only when the observation is true for the green run and false for every red. */
  readonly discriminatingPower: boolean
}

/** What arm 1 produced: its assertion rows, the mount, the drives and the negative control. */
export interface BoundaryArmResult {
  /** Every assertion row of arm 1, including the A9 row `real()` appends afterwards. */
  readonly items: CheckItem[]
  /** The mount facts (registrations, boundary log, both scene components). */
  readonly mounted: MountedBundle
  /** The green drive's reduced observation. */
  readonly green: Observation
  /** The three bypassed drives' reduced observations. */
  readonly reds: {
    /** The phase this red drove. */
    readonly mode: DriveMode
    /** The reduced observation of this red. */
    readonly observation: Observation
  }[]
  /** The empty-state arms (malformed / non-staged / absent). */
  readonly emptyArms: EmptyStateArm[]
  /** The negative control written under `negative-control/`. */
  readonly control: NegativeControl
}

/** The options `armBoundary` accepts. */
export interface BoundaryArmOptions {
  /** The sandbox workspace the staged fixture is written into. */
  readonly workspace: string
  /** The sandbox HOME passed through to `mountBundle`. */
  readonly home: string
  /** Evidence directory the raw surfaces and the negative control are written into. */
  readonly outDir: string
  /** The staged plan's own id, which is the phrase the approval gate demands. */
  readonly planId: string
}

/**
 * Arm 1: one green drive plus the three bypassed drives.
 * @param options.workspace - the sandbox workspace holding the staged fixture.
 * @param options.home - the sandbox HOME handed to the mount.
 * @param options.outDir - evidence directory the negative control is written into.
 * @returns The assertion rows, the mount, the green/red observations and the control record.
 */
export async function armBoundary({ workspace, home, outDir, planId }: BoundaryArmOptions): Promise<BoundaryArmResult> {
  /** The mounted plugin: its real `apply()` over the recording host double. */
  const mounted = await mountBundle({ workspace, home })
  /** Every assertion row of this arm, in assertion order. */
  const items: CheckItem[] = []
  /** Append one assertion row; `ok` is coerced to a real boolean so a red is never merely truthy. */
  const add = (id: string, ok: unknown, note: string, extra: Record<string, unknown> = {}): number => items.push({ id, ok: ok === true, note, ...extra })
  add("A1-apply", mounted.applyError === undefined && mounted.plan !== undefined,
    mounted.applyError === undefined
      ? "the REAL plugin apply() registered " + mounted.sceneRegistrations.map((entry) => entry.id).join(",")
      : "apply() threw: " + mounted.applyError)
  add("A2-plan-scene", mounted.plan?.id === PLAN_SCENE.id && mounted.plan?.title === PLAN_SCENE.title,
    "registered scene " + JSON.stringify(mounted.plan?.id) + " title " + JSON.stringify(mounted.plan?.title))
  add("A3-entry-points", mounted.commandRegistrations.length > 0,
    "command registrations: " + JSON.stringify(mounted.commandRegistrations))

  /** The kit the green drive presses keys on. */
  const kit = makeKit()
  // A1 above asserts the plan scene registered; `!` states that invariant to the checker without
  // adding a runtime branch the original code did not have.
  // THE GREEN DRIVE TYPES THE PLAN'S PHRASE, because that is what the gate now demands: the shared
  // projection builds it from the PRE-approval identity, and the team id is not knowable at the moment
  // the gate asks. A drive still typing the team id would fail the gate for a reason that has nothing
  // to do with the surface.
  // THE GATE'S PHRASE NAMES THE PLAN. Since W6 the shared projection builds it from the PRE-approval
  // identity, so every assertion below compares against THIS string — the one the surface was served.
  // They used to compare against `approvalPhrase()` (the TEAM id), which made A6 reject the very string
  // it should have accepted: the echo it received WAS the phrase.
  /** The exact phrase the approval gate demands, as the shared projection serves it. */
  const plannedPhrase = approvalPhrase(planId)
  /** The happy-path drive: the phrase typed in full, which is the only run that may approve. */
  const green = await drive({ kit, component: mounted.plan!.component, mode: "typed", phrase: plannedPhrase })
  /** The green drive reduced to its observable facts. */
  const greenObs = observe({ text: green.afterChord, boundaryCalls: mounted.boundaryCalls })
  /** The parsed lines of the green render after the chord. */
  const greenTitle = surfaceFacts(green.afterChord)

  add("A4-real-fixture-read", green.afterChord.includes(TEAM_NAME) && greenTitle.teamLine.includes(TEAM_ID),
    "the surface rendered the record on disk: " + greenTitle.teamLine)
  add("A5-confirm-step-requested",
    greenTitle.instruction === INSTRUCTION && greenTitle.requiredPhrase === plannedPhrase && green.atEntry === "",
    "verbatim instruction present, required phrase " + JSON.stringify(greenTitle.requiredPhrase) + ", echo at entry " + JSON.stringify(green.atEntry))
  add("A6-echo-carries-phrase", surfaceFacts(green.beforeChord).confirmEcho === plannedPhrase,
    "the echo after typing is " + JSON.stringify(surfaceFacts(green.beforeChord).confirmEcho))

  /** The lane's own approval assertion on the green run. */
  const greenAssertion = assertApprovalHappened(greenObs)
  /** The first (and only) approve call the green run recorded, or `undefined` on a red. */
  const attempt = greenObs.approvalAttempts[0]
  add("A7-approval-attempt", greenAssertion.pass &&
    attempt?.name === APPROVE_TOOL &&
    attempt?.confirmation === plannedPhrase &&
    attempt?.agentId === CAPTAIN_ID &&
    attempt?.callIdPresent === true,
    "boundary call " + JSON.stringify(attempt) + " (" + greenAssertion.reason + ")")
  // The tool reports the identity IT approved, which is the PLAN's — the team record does not exist
  // until this call commits, so a message naming the team id would be naming something not yet made.
  add("A8-tool-result-rendered",
    greenObs.facts.message.startsWith("approved: " + planId + " running"),
    "the scene rendered the tool's own structured result: " + JSON.stringify(greenObs.facts.message))

  // The three bypassed runs. Each MUST report no approval at the boundary.
  /** Every bypassed run, with its observation and its raw renders. */
  const reds: BypassRun[] = []
  // The three bypassed runs carry literal scenario ids; the annotation is type-level only, so the
  // loop still iterates the same three strings in the same order.
  for (const mode of ["empty", "wrong-id", "cancelled"] as DriveMode[]) {
    /** This run's own call log (the per-run recording boundary this red reads). */
    const calls: BoundaryCall[] = []
    /** A fresh kit, so no captured handler survives from the green drive. */
    const kit2 = makeKit()
    /** The per-run bookkeeping object the original keeps beside the drive. */
    const sub: BypassScratch = { boundaryCalls: calls, name: mode }
    /** The phrase this run types; the wrong-id red types another team's id. */
    // The RED runs type something that is NOT this plan's phrase: the empty string, another plan's, or
    // nothing at all. Both must be judged against the SAME string the green run typed, or the control
    // stops being a control.
    const phrase = mode === "wrong-id" ? approvalPhrase("plan-some-other-plan") : plannedPhrase
    // A per-run recording boundary: the same component, a fresh call log.
    /** How many boundary calls the mount had recorded before this run started. */
    const original = mounted.boundaryCalls.length
    /** The raw renders of this bypassed drive. */
    const run = await drive({ kit: kit2, component: mounted.plan!.component, mode: mode === "wrong-id" ? "typed" : mode, phrase })
    sub.calls = mounted.boundaryCalls.slice(original)
    sub.path = run
    reds.push({ mode, observation: observe({ text: run.afterChord, boundaryCalls: sub.calls }), path: run })
  }
  /** Each red reduced to its assertion verdict plus the message line it rendered. */
  const redAssertions = reds.map((entry) => ({ mode: entry.mode, ...assertApprovalHappened(entry.observation), message: entry.observation.facts.message }))
  add("B1-bypassed-runs-refuse",
    redAssertions.every((entry) => entry.pass === false),
    "every bypassed run failed the approval assertion (the required red): " + JSON.stringify(redAssertions.map((entry) => ({ mode: entry.mode, pass: entry.pass, message: entry.message }))))
  add("B2-gate-is-what-refused",
    reds.every((entry) => entry.observation.facts.message === "confirmation does not match this team"),
    "each bypassed run rendered the phrase-gate refusal: " + JSON.stringify(reds.map((entry) => entry.observation.facts.message)))
  add("B3-observation-discriminates",
    greenObs.approvalHappened === true && reds.every((entry) => entry.observation.approvalHappened === false),
    "approvalHappened true with the phrase typed, false in all " + reds.length + " bypassed runs")

  // The empty-state arm (contract §3.2 precondition): a malformed, a non-staged and
  // an absent record must render the empty state instead of throwing. Each runs in
  // its OWN sandbox workspace, so the healthy fixture is never the thing measured.
  /** The three empty-state arms' outcomes, in drive order. */
  const emptyArms: EmptyStateArm[] = []
  /** The three malformed/non-staged/absent scenarios, each mutating its own workspace. */
  const emptyCases: EmptyStateCase[] = [
    {
      name: "malformed-record",
      setup: (ws: string): void => {
        /** The record directory the malformed bytes are written into. */
        // The POST-SPLIT path. A control that corrupts a file the surface no longer reads proves
        // nothing — which is exactly how this arm passed while the real fixture was unreadable.
        const dir = join(ws, ".mpd", "team", "teams")
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, TEAM_ID + ".json"), "{ this is not JSON at all")
      },
    },
    {
      name: "non-staged-record",
      setup: (ws: string): void => {
        writeTeamFixture(ws, { ...stagedRecord(), phase: "running" })
        // AND CLEAR THE PLAN, which is the half W6 made load-bearing: the surface is usable when a
        // STAGED PLAN exists, whatever the record's phase says, because the record is materialised AT
        // approval and the plan is what exists before one. Changing only the phase left a plan the
        // surface could still act on, so this control no longer produced the empty state it exists for.
        clearPlanFixture(ws, CAPTAIN_ID)
      },
    },
    { name: "absent-record", setup: (): void => {} },
  ]
  for (const entry of emptyCases) {
    /** This arm's OWN sandbox workspace, beside the healthy one, so the fixture is never reused. */
    const ws = join(dirname(workspace), "ws-" + entry.name)
    mkdirSync(ws, { recursive: true })
    entry.setup(ws)
    /** The thrown message of this arm's render, `undefined` when the render threw nothing. */
    let threw: string | undefined
    /** The parsed surface facts of this arm's render, `undefined` when the render threw first. */
    let facts: SurfaceFacts | undefined
    try {
      /** The mount of this arm's own workspace, so the record it reads is this arm's record. */
      const mount = await mountBundle({ workspace: ws, home })
      // A1's invariant carries over: the mount either registered the plan scene or threw above.
      facts = surfaceFacts(renderScene(makeKit(), mount.plan!.component, {}))
    } catch (error) {
      // The thrown value is `unknown`: the cast states the Error-ish shape whose message is recorded.
      threw = String((error as { message?: unknown })?.message ?? error)
    }
    // The original reads `facts` unconditionally after the try, which is safe because the arm is
    // already a red through `threw` whenever the render did not produce any text.
    emptyArms.push({ name: entry.name, threw, facts })
  }
  add("A10-empty-state-no-throw",
    emptyArms.every((entry) => entry.threw === undefined && entry.facts!.emptyState.startsWith("no staged plan for team")),
    "malformed / non-staged / absent records each rendered the empty state and threw nothing: " +
    JSON.stringify(emptyArms.map((entry) => ({ name: entry.name, threw: entry.threw, emptyState: entry.facts!.emptyState, title: entry.facts!.titleLine }))))

  mkdirSync(join(outDir, "negative-control"), { recursive: true })
  /** The negative control: the same drive and assertion with the confirmation step bypassed. */
  const control: NegativeControl = {
    note: "the SAME drive and the SAME assertion (`assertApprovalHappened`) with the confirmation step bypassed — this run MUST fail",
    expected: "fail",
    observed: redAssertions.every((entry) => entry.pass === false) ? "fail" : "pass",
    green: { mode: "typed", pass: greenAssertion.pass, reason: greenAssertion.reason, message: greenObs.facts.message },
    reds: redAssertions,
    discriminatingPower: greenObs.approvalHappened === true && reds.every((entry) => entry.observation.approvalHappened === false),
  }
  writeFileSync(join(outDir, "negative-control", "control.json"), JSON.stringify(control, null, 2) + "\n")
  writeFileSync(join(outDir, "negative-control", "control.log"),
    "GREEN run (phrase typed):     pass=" + greenAssertion.pass + " " + greenAssertion.reason + "\n" +
    "  message: " + greenObs.facts.message + "\n" +
    reds.map((entry) => "RED run (" + entry.mode + "):          pass=" + String(assertApprovalHappened(entry.observation).pass) + " " +
      assertApprovalHappened(entry.observation).reason + "\n  message: " + entry.observation.facts.message).join("\n") + "\n")

  return { items, mounted, green: greenObs, reds: reds.map((entry) => ({ mode: entry.mode, observation: entry.observation })), emptyArms, control }
}

// ── arm 2: the real host ───────────────────────────────────────────────────

/**
 * The live session id the sandbox host created for this workspace (or undefined).
 * @param root The sandbox root whose `dshhome/sessions` store is read.
 * @param workspace The absolute workspace the boot ran in; only its sessions are considered.
 * @returns The newest matching session id, or `undefined` when the boot recorded none.
 */
export function liveSessionId(root: string, workspace: string): string | undefined {
  /** Every session header record whose recorded cwd is this workspace. */
  const headers = readSessionHeaders(root).filter((entry) => entry.cwd === workspace)
  if (headers.length === 0) return undefined
  return headers.sort((a, b) => b.mtimeMs - a.mtimeMs)[0].sessionId
}

/** The outcome of seeding a sandbox `dsh-tui` profile from a warm root. */
export interface SeedProfileResult {
  /** The source root used (repo-relative when it is inside the repo), `undefined` when none was found. */
  readonly source: string | undefined
  /** True when a symlink was just created; false when the profile was already present or none was found. */
  readonly seeded: boolean
}

/**
 * Seed the sandbox profile from a WARM dsh-tui profile (symlink; no network install)
 * and copy the credential/settings files the sandbox needs.
 * @param root The sandbox root whose `dshhome/` receives the profile link and the copied files.
 * @param log Line sink for the seeding sentence.
 * @param explicitSource A caller-named warm dshhome, or `undefined` to probe the default candidates.
 * @returns which warm root was used, and whether the profile is now present.
 */
export function seedProfile(root: string, log: (line: string) => void, explicitSource: string | undefined): SeedProfileResult {
  /** The `dsh-tui` profile directory the sandbox host will read. */
  const profileDir = join(root, "dshhome", "profiles", "dsh-tui")
  if (existsSync(join(profileDir, "package.json"))) return { source: "already-present", seeded: false }
  for (const candidate of profileSourceCandidates(explicitSource)) {
    /** The candidate's own installed `dsh-tui` profile. */
    const source = join(candidate, "profiles", "dsh-tui")
    if (!existsSync(join(source, "package.json"))) continue
    mkdirSync(join(root, "dshhome", "profiles"), { recursive: true })
    rmSync(profileDir, { recursive: true, force: true })
    symlinkSync(source, profileDir, "junction")
    for (const file of [".credentials.yaml", "settings.yaml"]) {
      /** The candidate's copy of that file. */
      const from = join(candidate, file)
      /** Where the sandbox copy must land inside the sandbox DSH_HOME. */
      const to = join(root, "dshhome", file)
      if (existsSync(from) && !existsSync(to)) copyFileSync(from, to)
    }
    log("host: dsh-tui profile seeded from " + source.replace(REPO + "/", "") + " (symlink, no install)")
    return { source: source.replace(REPO + "/", ""), seeded: true }
  }
  return { source: undefined, seeded: false }
}

/**
 * The warm dsh-home roots this lane may seed a sandbox profile from, in order.
 * @param explicitSource The caller's `--profile-source`, which replaces the default probe list.
 * @returns The candidate roots, in the order they are probed.
 */
export function profileSourceCandidates(explicitSource: string | undefined): string[] {
  return explicitSource === undefined
    ? [join(REPO, ".mpd", "recon", "qa", "dshhome"), join(REPO, ".mpd", "recon", "t9-clean", "dshhome")]
    : [explicitSource]
}

/**
 * Is a `dsh-tui` profile reachable for this root — already installed, or seedable?
 * @param root The sandbox root whose own profile is checked first.
 * @param explicitSource The caller's warm root, which replaces the default probe list.
 * @returns True when the sandbox already carries the profile or a candidate can supply it.
 */
export function profileReachable(root: string, explicitSource: string | undefined): boolean {
  if (existsSync(join(root, "dshhome", "profiles", "dsh-tui", "package.json"))) return true
  return profileSourceCandidates(explicitSource).some((candidate) => existsSync(join(candidate, "profiles", "dsh-tui", "package.json")))
}

/**
 * Is an executable on PATH? (a POSITIVE probe — the gate never catches a failure).
 * @param name The bare command name to resolve.
 * @returns True only when `which` found it AND printed a non-empty path.
 */
export function binaryOnPath(name: string): boolean {
  /** The `which` probe; a missing command is reported by its status, never thrown. */
  const probe = spawnSync("which", [name], { encoding: "utf8", timeout: 10_000 })
  return probe.status === 0 && String(probe.stdout ?? "").trim() !== ""
}

/**
 * The declared prerequisites of the REAL lane, in check order (the skill's grammar:
 * `[mpd-qa] SKIP|FAIL` must be the FIRST stdout line, so this gate runs before any
 * output and a skip is never followed by a PASS).
 * @param root The sandbox root whose `dsh-tui` profile the fixture prerequisite probes.
 * @param explicitSource The caller's warm root, used by the same prerequisite.
 * @returns The three prerequisites, each with a positive probe and its remedy text.
 */
export function hostPrereqs(root: string, explicitSource: string | undefined): TuiPrereq[] {
  return [
    { code: "absent-dsh-binary", probe: "dsh-tui", remedy: "npm i -g @deepseek-harness-tui/dsh-tui@0.12.0", present: () => binaryOnPath("dsh-tui") },
    { code: "absent-runtime", probe: "tmux", remedy: "apt-get install tmux (a real TTY is required; stdout must not be a pipe)", present: () => binaryOnPath("tmux") },
    { code: "absent-fixture", probe: "a dsh-tui profile in the sandbox root (or a warm source to seed one from)", remedy: "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install", present: () => profileReachable(root, explicitSource) },
  ]
}

/** A defect the lane measured but does not repair (packages/ is out of this lane's scope). */
export interface Finding {
  /** The stable finding id (e.g. `F1-approval-verdict-not-visible`). */
  readonly id: string
  /** The severity the lane assigned. */
  readonly severity: string
  /** The measured problem, in full. */
  readonly problem: string
  /** The repair the owner is asked to make. */
  readonly requiredFix: string
  /** The evidence files the finding is read from. */
  readonly evidence: string
}

/** Arm 2's skipped shape: no `dsh-tui` profile was reachable in the sandbox root. */
export interface HostArmSkipped {
  /** Always true on this arm. */
  readonly skipped: true
  /** The one-line reason the lane logs and marks SKIP on. */
  readonly reason: string
  /** How the sandbox profile was obtained. */
  readonly seeded: SeedProfileResult
  /** The three profile facts the skip was decided from. */
  readonly profileState: {
    /** True when the profile's `package.json` exists. */
    readonly present: boolean
    /** True when the host payload is installed, `undefined` on the not-installed arm. */
    readonly hasHost: boolean | undefined
    /** True when this bundle is installed, `undefined` on the not-installed arm. */
    readonly hasBundle: boolean | undefined
  }
  /** Never present on the skip arm: a skip produces no assertion rows. */
  readonly items?: never
  /** Never present on the skip arm: a skip measures no record. */
  readonly findings?: never
}

/** Arm 2's measured shape: the pane-vs-record judgement, its rows and the findings. */
export interface HostArmMeasured {
  /** Always false on this arm (the driver ran). */
  readonly skipped: false
  /** How the sandbox profile was obtained. */
  readonly seeded: SeedProfileResult
  /** The sandbox root the host booted in. */
  readonly sandboxRoot: string
  /** The workspace whose `.mpd/team/` record the drive mutated. */
  readonly workspace: string
  /** The driven steps, as recorded in the result. */
  readonly steps: {
    /** The step label the pane capture is named after. */
    readonly name: string
    /** The tmux `send-keys` arguments this step sent. */
    readonly keys: readonly string[]
    /** Milliseconds waited before this step's capture. */
    readonly waitMs: number | undefined
  }[]
  /** One sentence per tmux/boot/step failure; empty means the lifecycle was clean. */
  readonly failures: string[]
  /** The four record fields the judgement is made from, `undefined` when no record exists. */
  readonly record: {
    /** The record phase after the drive. */
    readonly phase: string | undefined
    /** The commit instant, present only when an approval committed. */
    readonly approvedAt: number | undefined
    /** The captain session the record names. */
    readonly captainSessionId: string | undefined
    /** The plan-review state, absent after a committing approval. */
    readonly planReviewState: string | undefined
  } | undefined
  /** True only when the record carries the adopted runtime's own approval signature. */
  readonly recordSignature: boolean
  /** The classified outcome, naming which layer spoke. */
  readonly outcome: string
  /** The outcome lines the classification was computed from. */
  readonly outcomeLines: {
    /** The `approved: …` line the pane rendered, or `""`. */
    readonly approved: string
    /** The `approve failed: …` line the pane rendered, or `""`. */
    readonly refusal: string
    /** True when the refusal came from the plugin's OWN pre-gates, not the adopted runtime. */
    readonly preGateRefusal: boolean
    /** True when the pane shows the post-commit empty state. */
    readonly postCommitEmptyState: boolean
  }
  /** Findings the lane measured but does not repair. */
  readonly findings: Finding[]
  /** One projected capture per driven step. */
  readonly panes: {
    /** The step label this capture was taken at. */
    readonly name: string
    /** The capture's character count, recorded so a truncated pane is visible. */
    readonly chars: number
    /** The parsed facts of this capture. */
    readonly facts: SurfaceFacts
  }[]
  /** Every assertion row of arm 2. */
  readonly items: CheckItem[]
}

/** The two arms `armHost` can report: the declared skip, or the measured judgement. */
export type HostArmResult = HostArmSkipped | HostArmMeasured

/** The options `armHost` accepts. */
export interface HostArmOptions {
  /** Sandbox root the real TUI boots in. */
  readonly root: string
  /** Evidence directory for the pane captures. */
  readonly outDir: string
  /** Line sink for the host arm's progress sentences. */
  readonly log: (line: string) => void
  /** A warm dshhome to seed the sandbox profile from, or `undefined` for the default candidates. */
  readonly profileSource: string | undefined
}

/** The subset of a persisted team record this lane inspects after the arm-2 drive. */
interface PersistedTeamRecord {
  /** The record phase; the adopted runtime flips it `staged` → `running` on approval. */
  readonly phase?: string
  /** Commit instant written only by the adopted `approveStagedTeam`, in epoch milliseconds. */
  readonly approvedAt?: number
  /** The captain session the record names, re-read to prove the pane did not invent it. */
  readonly captainSessionId?: string
  /** Deleted by a committing approval — the record half of the approval signature. */
  readonly planReviewState?: string
}

/**
 * Arm 2: boot the real TUI, drive the real keystrokes, and judge pane against record.
 * @param options.root - the sandbox root the host boots in.
 * @param options.outDir - evidence directory for the pane captures.
 * @param options.log - line sink for the progress sentences.
 * @param options.profileSource - the warm root the sandbox profile is seeded from.
 * @returns The skip arm when no profile is reachable, else the measured judgement and its rows.
 */
export async function armHost({ root, outDir, log, profileSource }: HostArmOptions): Promise<HostArmResult> {
  /** The workspace whose `.mpd/team/` record the drive mutates. */
  const workspace = join(root, "ws")
  mkdirSync(workspace, { recursive: true })
  /** How the sandbox profile was obtained, recorded either way. */
  const seeded = seedProfile(root, log, profileSource)
  /** The sandbox `dsh-tui` profile facts the arm is decided from. */
  const state = profileState(root)
  /** True only when the profile is installed AND carries both the host and this bundle. */
  const present = state.present && state.hasHost && state.hasBundle
  if (!present) {
    return {
      skipped: true,
      reason: "no dsh-tui profile in the sandbox root (" + root.replace(REPO + "/", "") + ")",
      seeded,
      profileState: { present: state.present, hasHost: state.hasHost, hasBundle: state.hasBundle },
    }
  }

  // The record exists BEFORE the surface opens, so the scene reads it from disk.
  // ONE RECORD FOR THE WHOLE ARM. `stagedRecord()` stamps `createdAt: Date.now() - 60_000`, so calling
  // it twice yields two different plan ids — and a pre-written record and a later-staged plan that
  // disagree about the identity the gate demands.
  /** The one record every step of this arm describes; its `createdAt` fixes the plan id. */
  const baseRecord = stagedRecord()
  writeTeamFixture(workspace, { ...baseRecord, captainSessionId: "sess-not-yet-attached" })
  // THE PHRASE NAMES THE PLAN, not the team: the shared projection builds it from the PRE-approval
  // identity, because at the moment the gate asks there is no team id to demand. It is computed HERE,
  // from the one record, because the steps array below captures it BY VALUE — a version assigned in a
  // step's `before` hook would arrive too late, and the drive would type the previous phrase. Measured:
  // the pane echoed `approve mpd-fixture-1` while the gate demanded `approve plan-…`, and the surface
  // refused with `confirmation does not match this team` — correctly.
  /** The exact phrase the gate demands, fixed by the one record's `createdAt`. */
  const phrase = approvalPhrase(planIdOf(baseRecord))
  /** The driven steps, in order; the picker dialog is driven LAST and in its own capture. */
  const steps: TuiStep[] = [
    {
      name: "plan-open",
      before: (): void => {
        /** The live session id the boot produced for the sandbox workspace. */
        const id = liveSessionId(root, workspace)
        /** The one record, re-stamped with the live session the boot produced. */
        const staged = { ...baseRecord, captainSessionId: id ?? "unresolved-live-session" }
        /** The fixture re-written with that live session as its captain. */
        const fixture = writeTeamFixture(workspace, staged)
        log("host: fixture captainSessionId := " + JSON.stringify(id ?? null) + " (record " + fixture.sha256.slice(0, 12) + ")")
        // THE PLAN HALF, staged here because a plan is keyed by SESSION and the session id only exists
        // once the boot has created one. The record alone is not enough: it is materialised AT
        // approval, so a surface reading only records shows its empty state over a plan awaiting a
        // decision — which is the defect this case was written to catch.
        if (id !== undefined) {
          /** The staged plan; its id is `planIdOf(staged)`, which IS the phrase this arm types. */
          const stagedPlan = stagePlanFixture(workspace, id, staged)
          log("host: staged plan " + stagedPlan.planId + " for session " + id + " (phrase " + phrase + ")")
        }
      },
      keys: ["/mpd plan", "Enter"],
      waitMs: 9000,
    },
    { name: "phrase-typed", keys: [phrase], waitMs: 2500 },
    { name: "approve-attempt", keys: ["C-x"], waitMs: 9000 },
    // The picker dialog is driven LAST and in its own capture: a managed select owns
    // the keyboard while it is up, so a dialog opened before the approval drive could
    // swallow the command (measured: `/mpd plan` landed in the open picker and the
    // BOARD opened instead of the plan surface). The approval drive must never depend
    // on dialog interaction.
    { name: "scene-closed", keys: ["Escape"], waitMs: 3000 },
    { name: "picker-open", keys: ["/mpd", "Enter"], waitMs: 7000 },
  ]
  /** The one real TUI lifecycle: boot, drive every step, capture each pane, kill the server. */
  const session = runTuiSession({ lane: SLUG, root, outDir: join(outDir, "panes"), steps, bootWaitMs: 120_000 })
  for (const failure of session.failures) log("host: tmux " + failure)
  /** Read one captured pane's text by step name, `""` when that step produced no capture. */
  const pane = (name: string): string => session.panes.find((entry) => entry.name === name)?.text ?? ""
  /** Absolute path of the record the drive mutates — the truth source of this arm. */
  // The POST-SPLIT record path. Reading the retired one made H4/H5 report `phase=undefined` about a
  // record that WAS on disk — the read, not the surface, was wrong.
  const recordFile = join(workspace, ".mpd", "team", "teams", TEAM_ID + ".json")
  // The record is re-read from disk: the parsed JSON is dynamic, so it is given the local record
  // shape (the fields this lane judges) instead of flowing out as an `any` parse result.
  /** The record as it stands after the drive, `undefined` when the file does not exist. */
  const record: PersistedTeamRecord | undefined = existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")) : undefined
  /** The approval-attempt pane, the capture the record is judged against. */
  const approvedPane = pane("approve-attempt")
  /** The pane's refusal line, or `""` when it rendered none. */
  const refusalLine = approvedPane.split("\n").map((line) => line.trim()).find((line) => line.startsWith("approve failed:")) ?? ""
  /** The pane's approval line, or `""` when it rendered none. */
  const approvedLine = approvedPane.split("\n").map((line) => line.trim()).find((line) => line.startsWith("approved:")) ?? ""
  /** The parsed facts of the approval-attempt pane. */
  const paneFacts = surfaceFacts(approvedPane)
  // The plugin's OWN pre-gates refuse before any tool runs; the adopted runtime is
  // the only source of a validator/authorization message. Which one spoke is the
  // difference between "the seam chain was reached" and "the composer said no".
  /** True when the refusal came from the plugin's own pre-gates rather than the adopted runtime. */
  const preGateRefusal = /is not registered in this composition|is not attached in this process|no live session is attached/.test(refusalLine)
  /** True when the refusal came from the adopted runtime, i.e. the seam chain really was reached. */
  const refusalFromAdoptedRuntime = refusalLine !== "" && !preGateRefusal
  // THE RECORD IS THE TRUTH SOURCE. Only the adopted `approveStagedTeam` writes this
  // signature: phase "running" + `approvedAt` + `planReviewState` DELETED. A pane can
  // lie; this cannot be produced by the TUI package (no write primitive).
  /** True when the record carries the adopted runtime's approval signature. */
  const recordApproved = record?.phase === "running" && typeof record?.approvedAt === "number"
  /** The stricter half of the signature: a committing approval also DELETES `planReviewState`. */
  const recordSignature = recordApproved && record?.planReviewState === undefined
  /** True when the pane shows the post-commit empty state, i.e. the surface re-read a running record. */
  const postCommitEmptyState = recordApproved && paneFacts.emptyState !== ""
  /** Which layer spoke, classified so H4/H4b/H5 can quote it. */
  const outcomeClass = recordApproved
    ? (approvedLine === "" ? "approved-by-the-adopted-runtime/verdict-NOT-visible-after-commit" : "approved-by-the-adopted-runtime/verdict-visible")
    : refusalFromAdoptedRuntime
      ? "refused-by-the-adopted-runtime"
      : refusalLine !== ""
        ? "refused-by-the-plugin-pre-gate"
        : "no-outcome-line"

  /** Every finding this arm measured; the lane reports them and never repairs them. */
  const findings: Finding[] = []
  if (recordApproved && approvedLine === "") {
    findings.push({
      id: "F1-approval-verdict-not-visible",
      severity: "medium",
      problem: "The approval COMMITTED for real (record: phase staged→running, approvedAt set, planReviewState DELETED) but the surface never rendered the frozen §4.5 verdict line `approved: <teamId> running · members <n> · tasks <n>`: the approve path sets that message, then its `finally` re-reads the record — which is no longer staged — so `usable` is false and the whole action block (the only place the message is rendered) is dropped. What the user sees after a SUCCESSFUL approval is `MPD plan approval — no staged plan for team mpd-fixture-1 (phase running)` + `esc back`, which reads as 'nothing to approve' rather than 'approved'. §4.5 row 1 and §4.2 barrier 5 ('after it settles the record is re-read and the verdict is rendered') both promise the verdict.",
      requiredFix: "Render the last verdict (or a one-line `approved: <id> running · members <n> · tasks <n>` banner) in the non-usable branch of the plan scene, so a committed approval is confirmed on screen. Owner: t2 (packages/mpd-tui-plugin/src/scenes.ts, out of this lane's scope).",
      evidence: "panes/approve-attempt.pane.txt (only the post-commit empty state) vs the record flip in result.json arm2.record",
    })
  }

  /** Every assertion row of this arm, in assertion order. */
  const items: CheckItem[] = []
  /** Append one assertion row; `ok` is coerced to a real boolean so a red is never merely truthy. */
  const add = (id: string, ok: unknown, note: string, extra: Record<string, unknown> = {}): number => items.push({ id, ok: ok === true, note, ...extra })
  add("H1-host-renders-surface", /MPD plan approval/.test(pane("plan-open")) && pane("plan-open").includes(TEAM_ID),
    "the real host rendered the plan surface for the sandbox record: " + (pane("plan-open").split("\n").map((l) => l.trim()).find((l) => l.startsWith("MPD plan approval")) ?? "(no title line)"))
  add("H2-host-dialog-request", /Plan/.test(pane("picker-open")) && /review and approve a staged plan/.test(pane("picker-open")),
    "the bare /mpd managed dialog listed the Plan entry: " + (pane("picker-open").split("\n").map((l) => l.trim()).filter((l) => /Plan|approve a staged plan/.test(l)).slice(0, 3).join(" | ") || "(nothing)"))
  add("H3-host-confirm-step", pane("plan-open").includes(INSTRUCTION) && pane("phrase-typed").includes("confirm    " + phrase),
    "the host rendered the confirmation step and echoed the typed phrase")
  add("H4-real-mutation-via-the-adopted-runtime", recordSignature,
    recordApproved
      ? "the RECORD was committed by the adopted runtime (phase=" + JSON.stringify(record?.phase) + ", approvedAt=" + record?.approvedAt + ", planReviewState=" + JSON.stringify(record?.planReviewState) + " DELETED — a signature only approveStagedTeam writes); pane outcome: " + outcomeClass
      : "no approval committed: phase=" + JSON.stringify(record?.phase) + " approvedAt=" + JSON.stringify(record?.approvedAt) + "; pane outcome: " + outcomeClass)
  add("H4b-outcome-reported-honestly",
    recordApproved ? refusalLine === "" : (refusalLine !== "" || postCommitEmptyState === false),
    recordApproved
      ? "the pane did not deny an approval that committed (verdict line " + JSON.stringify(approvedLine) + ", post-commit empty state " + String(postCommitEmptyState) + ")"
      : "no approval committed and the pane said so: " + JSON.stringify(refusalLine || paneFacts.emptyState))
  add("H5-pane-and-record-agree",
    recordApproved
      ? (approvedLine !== "" || postCommitEmptyState) && refusalLine === ""
      : approvedLine === "",
    "pane claims approved=" + String(approvedLine !== "") + ", refusal=" + String(refusalLine !== "") + ", post-commit empty state=" + String(postCommitEmptyState) + "; record phase=" + JSON.stringify(record?.phase) + " approvedAt=" + JSON.stringify(record?.approvedAt))
  add("H6-real-keystroke-drive", session.panes.length >= steps.length,
    "tmux captured " + session.panes.length + " panes for " + steps.length + " driven steps (real keystrokes)")

  return {
    skipped: false,
    seeded,
    sandboxRoot: root,
    workspace,
    steps: steps.map((entry) => ({ name: entry.name, keys: entry.keys, waitMs: entry.waitMs })),
    failures: session.failures,
    record: record === undefined ? undefined : { phase: record.phase, approvedAt: record.approvedAt, captainSessionId: record.captainSessionId, planReviewState: record.planReviewState },
    recordSignature,
    outcome: outcomeClass,
    outcomeLines: { approved: approvedLine, refusal: refusalLine, preGateRefusal, postCommitEmptyState },
    findings,
    panes: session.panes.map((entry) => ({
      name: entry.name,
      chars: entry.text.length,
      facts: surfaceFacts(entry.text),
    })),
    items,
  }
}

// ── the lane entry points ──────────────────────────────────────────────────

/** The offline arm: the fixture, the parser, the assertion's two-sidedness and the dist invariants. */
function selfTest(): void {
  /** The bound assertion collector and its failure list; empty at the end means the arm is green. */
  const { check, problems } = makeChecks()

  /** The fixture record as the lane builds it, before any override. */
  const record = stagedRecord()
  check(record.phase === "staged" && record.planReviewState === "awaiting_review", "the fixture must be a staged record")
  check(record.members.length === 2 && record.tasks.length === 2, "the fixture must carry a runnable roster and graph")
  check(approvalPhrase() === "approve mpd-fixture-1", "the phrase is built from the record id")

  /** The host kit double the parser and the assertion are falsified against. */
  const kit = makeKit()
  check(typeof kit.React.createElement === "function" && typeof kit.ui.useInput === "function", "the host double must model React + the ui kit")
  kit.ui.useInput(() => {})
  check(kit.handlers.length === 1, "useInput handlers must be captured so a key can be pressed")
  check(renderScene(makeKit(), () => null, {}) === "", "a component without the host kit renders an empty tree instead of throwing")

  // The parser, against a synthetic render.
  /** A synthetic render carrying every line the parser projects. */
  const rendered = [
    "MPD plan approval — Fixture Team",
    "team       Fixture Team (mpd-fixture-1) · phase staged · review awaiting_review",
    INSTRUCTION,
    "confirm    ",
    "required   approve mpd-fixture-1",
    "runnable   yes",
  ].join("\n")
  /** The parsed facts of that synthetic render. */
  const facts = surfaceFacts(rendered)
  check(facts.instruction === INSTRUCTION, "the parser must find the verbatim instruction line")
  check(facts.requiredPhrase === "approve mpd-fixture-1", "the parser must read the required phrase")
  check(facts.confirmEcho === "", "the entry echo must read as EMPTY (no prefill)")
  check(surfaceFacts(rendered.replace("confirm    ", "confirm    approve mpd-fixture-1")).confirmEcho === "approve mpd-fixture-1", "the parser must read a typed echo")

  // The assertion the control relies on must be falsifiable BOTH ways.
  /** An observation with one recorded boundary call, which must satisfy the assertion. */
  const greenObs = observe({ text: rendered, boundaryCalls: [{ name: APPROVE_TOOL, arguments: { confirmation: approvalPhrase() }, agent: { id: CAPTAIN_ID }, callId: "c1" }] })
  /** The same render with an EMPTY boundary log, which must fail the assertion. */
  const redObs = observe({ text: rendered.replace("confirm    approve", "confirm    x"), boundaryCalls: [] })
  check(assertApprovalHappened(greenObs).pass === true, "a boundary call must satisfy the approval assertion")
  check(assertApprovalHappened(redObs).pass === false, "an EMPTY boundary must fail the approval assertion (this is the red the control needs)")
  check(greenObs.approvalAttempts[0].agentId === CAPTAIN_ID, "the observation must carry the calling agent's identity")
  check(greenObs.approvalAttempts[0].confirmation === approvalPhrase(), "the observation must carry the exact confirmation text")

  // A purely vacuous observation must NOT be able to pass: text alone never counts.
  check(observe({ text: rendered.replace("confirm    ", "confirm    approve mpd-fixture-1"), boundaryCalls: [] }).approvalHappened === false,
    "pane text alone must never set approvalHappened")

  // The dist really carries the two scene ids, and the package never writes state.
  /** The built plugin dist's bytes, read so the two scene ids can be asserted present. */
  const dist = readFileSync(TUI_DIST, "utf8")
  check(dist.includes(PLAN_SCENE.id) && dist.includes(TEAM_SCENE.id), "the built dist must carry both scene ids")
  check(!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|cpSync|createWriteStream/.test(dist), "the built dist must carry no filesystem write primitive")
  check(existsSync(ADAPTER_DIST), "the adapter dist must be built")

  // The real lane's prerequisite gate: declared in check order, positively probed, and
  // it must report a root with no profile and no warm source as `absent-fixture`.
  /** The prerequisites a resolved sandbox root declares, in check order. */
  const prereqs = hostPrereqs(join(REPO, ".mpd", "recon", "qa", "tui-lanes", "tui-team-surface"), undefined)
  check(prereqs.map((entry) => entry.code).join(",") === "absent-dsh-binary,absent-runtime,absent-fixture",
    "the real lane must declare its three prerequisites in check order")
  check(prereqs.every((entry) => typeof entry.present === "function" && typeof entry.remedy === "string"),
    "every prerequisite must carry a positive probe and a remedy")
  /** The same declarations for a root that cannot exist and a warm source that cannot exist. */
  const bare = hostPrereqs(join(REPO, "no-such-root"), "/nonexistent-warm-source")
  // The declaration list is fixed; `!` states that the fixture prerequisite is present in it,
  // which is exactly what the line above asserts.
  check(bare.find((entry) => entry.code === "absent-fixture")!.present() === false,
    "a root with no profile and no warm source must report absent-fixture")
  check(binaryOnPath("definitely-not-a-binary-xyz") === false && typeof binaryOnPath("node") === "boolean",
    "the PATH probe must be positive-only")

  /** Absolute path of the skill's case table, which must list this lane. */
  const skill = join(REPO, "skills", "dsh-qa", "SKILL.md")
  check(existsSync(skill) && readFileSync(skill, "utf8").includes("| " + SLUG + " |"), "the case table must list " + SLUG)

  if (problems.length > 0) {
    console.error("[" + SLUG + " self-test] FAIL: " + problems.length + " check(s)")
    for (const problem of problems) console.error("  - " + problem)
    process.exit(1)
  }
  console.log("[" + SLUG + " self-test] ok: fixture, parser, assertion falsifiability and the dist invariants all hold")
}

/** One measured path's digest, recorded before and after the run as the non-interference witness. */
export interface PathDigest {
  /** Repo-relative path of the measured file (the `REPO + "/"` prefix stripped). */
  readonly path: string
  /** Raw hex SHA-256 of the file, `undefined` when it does not exist. */
  readonly sha256: string | undefined
}

/** The revision comparison this lane records; a change voids the run's result. */
export interface LocalRevisionDelta {
  /** True when the dist digest moved between the start of the run and the evidence write. */
  readonly changed: boolean
  /** The one-line reason, logged when the digest moved. */
  readonly reason: string
  /** The start-of-run digest, present only on the changed arm. */
  readonly before?: string | undefined
  /** The evidence-write digest, present only on the changed arm. */
  readonly after?: string | undefined
}

/** The live arm: arm 1 plus the real host drive, written out as this lane's evidence directory. */
async function real(): Promise<void> {
  /** Every argument after the script path, so the parser and the flags see the same list. */
  const argv = process.argv.slice(2)
  /** Where `--profile-source` was named, or -1 when the caller left it to the default candidates. */
  const sourceIndex = argv.indexOf("--profile-source")
  /** The caller's warm dshhome, or `undefined` for the lane's own probe list. */
  const profileSource = sourceIndex === -1 ? undefined : argv[sourceIndex + 1]
  /** The resolved sandbox root the whole run happens inside. */
  const { root } = parseSandboxArgs(argv, SLUG)
  // THE PREREQUISITE GATE RUNS FIRST AND PRINTS FIRST: the skill's marker grammar
  // requires exactly one `[mpd-qa] SKIP|FAIL` line, as the FIRST stdout line of the
  // case, and a skipped case must never be followed by a PASS — so nothing at all is
  // emitted (and no evidence directory is created) before this gate clears.
  gateTuiPrereqs(SLUG, hostPrereqs(root, profileSource))
  /** Filesystem-safe spelling of this run's ISO timestamp. */
  const stamp = new Date().toISOString().replaceAll(":", "-")
  /** This run's evidence directory. */
  const outDir = join(EVIDENCE_ROOT, stamp)
  mkdirSync(join(outDir, "raw"), { recursive: true })
  /** Every progress line, joined and written as `output.log` at the end. */
  const log: string[] = []
  /** Append one line to the log and echo it with the lane prefix. */
  const say = (line: string): void => { log.push(line); console.log("[" + SLUG + "] " + line) }
  /** The dist revision before the run, re-measured at evidence-write time. */
  const revisionBefore = artifactRevision()
  // HARD non-interference assertions: the frozen contract and the vendor lock must be
  // byte-identical after the run. The workspace's OWN live team record is NOT one of
  // them: this lane runs inside a live team, so that file legitimately mutates while
  // the lane works (attempts, verdicts, mailbox). It is recorded as an OBSERVATION,
  // and the lane never writes it — proven by the fixture digest (A9) and by the built
  // package carrying no write primitive.
  /** Paths that must be byte-identical after the run, or the run is void. */
  const hardPaths: readonly string[] = [join(REPO, ".mpd", "plans", "tui-team-surface.md"), join(REPO, "VENDOR_LOCK.json")]
  /** Paths recorded as OBSERVATIONS only, because a live team mutates its own record. */
  const observedPaths: readonly string[] = [join(REPO, ".mpd", "team", "mpd-default-8d65a2b2", "team.json")]
  /** Digest a path list, so the caller can compare a before/after pair field by field. */
  const digest = (paths: readonly string[]): PathDigest[] => paths.map((path) => ({ path: path.replace(REPO + "/", ""), sha256: existsSync(path) ? sha256File(path) : undefined }))
  /** The protected paths' digests before the run. */
  const protectedBefore = digest(hardPaths)
  /** The observed path's digest before the run. */
  const observedBefore = digest(observedPaths)

  /** The workspace the staged fixture and arm 1 both run against. */
  const workspace = root.endsWith("/ws") ? root : join(root, "ws")
  mkdirSync(workspace, { recursive: true })
  /** The record every arm describes; arm 1's captain session is the one its channel presents. */
  const staged = stagedRecord()
  /** The staged fixture and the digest that witnesses the TUI never writes it. */
  const fixture = writeTeamFixture(workspace, staged)
  say("fixture written to " + fixture.file.replace(REPO + "/", "") + " (sha256 " + fixture.sha256.slice(0, 12) + ")")
  // THE PLAN HALF FOR ARM 1, keyed to the SAME session its channel presents. Without it the offline
  // surface has no plan to approve and reports an empty phrase — not because it is broken, but because
  // the plan is session-scoped and nothing had staged one for that session.
  /** The staged plan arm 1's surface reads, and the phrase its gate demands. */
  const plan = stagePlanFixture(workspace, staged.captainSessionId, staged)
  say("plan " + plan.planId + " staged for session " + staged.captainSessionId)

  /** What arm 1 registered, drove and refused. */
  const arm1 = await armBoundary({ workspace, home: join(root, "home"), outDir, planId: plan.planId })
  for (const item of arm1.items) say("arm1 " + item.id + " " + (item.ok ? "ok" : "FAIL") + " — " + item.note)
  // The TUI must not write team state: the fixture digest is the witness.
  /** The fixture's digest after every drive in arm 1. */
  const fixtureAfter = sha256File(fixture.file)
  /** True when the drives left the fixture byte-identical, i.e. the TUI wrote no state. */
  const noWrite = fixtureAfter === fixture.sha256
  arm1.items.push({ id: "A9-no-write-primitive-in-own-code", ok: noWrite, note: "the fixture file is unchanged after every drive (sha256 " + fixtureAfter.slice(0, 12) + ")" })
  say("arm1 A9-no-write-primitive-in-own-code " + (noWrite ? "ok" : "FAIL") + " — fixture sha256 " + (noWrite ? "unchanged" : "CHANGED"))

  writeFileSync(join(outDir, "raw", "arm1-surfaces.json"), JSON.stringify({
    registered: arm1.mounted.sceneRegistrations.map((entry) => ({ id: entry.id, title: entry.title })),
    commands: arm1.mounted.commandRegistrations,
    applyError: arm1.mounted.applyError,
    installErrors: arm1.mounted.installErrors,
    green: { message: arm1.green.facts.message, attempts: arm1.green.approvalAttempts, facts: arm1.green.facts },
    reds: arm1.reds.map((entry) => ({ mode: entry.mode, message: entry.observation.facts.message, attempts: entry.observation.approvalAttempts, facts: entry.observation.facts })),
    emptyArms: arm1.emptyArms,
  }, null, 2) + "\n")
  // The RAW rendered surfaces: the notes quote them, so the bytes behind every
  // arm-1 claim are on disk.
  writeFileSync(join(outDir, "raw", "arm1-green.txt"), arm1.green.text + "\n")
  for (const entry of arm1.reds) {
    writeFileSync(join(outDir, "raw", "arm1-red-" + entry.mode + ".txt"), entry.observation.text + "\n")
  }

  /** What the real host drive measured: its rows, the record flip and any finding. */
  const arm2 = await armHost({ root, outDir, log: say, profileSource })
  if (arm2.skipped) say("arm2 SKIPPED — " + arm2.reason)
  else for (const item of arm2.items) say("arm2 " + item.id + " " + (item.ok ? "ok" : "FAIL") + " — " + item.note)
  // A finding is REPORTED, never hidden and never auto-fixed (packages/ is out of this
  // lane's scope). It does not fail the lane: the lane's subject is whether the gate
  // holds and whether the mutation really happens, and it does.
  /** Every finding this run measured; empty on the skip arm. */
  const findings: Finding[] = arm2.skipped === true ? [] : (arm2.findings ?? [])
  for (const finding of findings) {
    say("FINDING " + finding.id + " severity=" + finding.severity + " — " + finding.problem + " REQUIRED FIX: " + finding.requiredFix)
  }
  writeFileSync(join(outDir, "raw", "findings.json"), JSON.stringify({
    note: findings.length === 0 ? "no findings from this lane's own evidence" : "findings measured by the lane; the owner repairs, this lane does not",
    findings,
  }, null, 2) + "\n")

  /** The protected paths' digests after the run. */
  const protectedAfter = digest(hardPaths)
  /** The observed path's digest after the run. */
  const observedAfter = digest(observedPaths)
  /** The protected paths whose bytes moved, which voids the run. */
  const interfered = protectedBefore.filter((entry, index) => entry.sha256 !== protectedAfter[index].sha256)
    .map((entry) => entry.path)
  /** The observed paths whose bytes moved, which is legitimate for a live team record. */
  const observedChanged = observedBefore.filter((entry, index) => entry.sha256 !== observedAfter[index].sha256)
    .map((entry) => entry.path)
  say("non-interference: contract + VENDOR_LOCK unchanged=" + String(interfered.length === 0) + (interfered.length > 0 ? " CHANGED: " + interfered.join(",") : ""))
  say("observation: the workspace's OWN live team record changed during the run=" + String(observedChanged.length > 0) +
    (observedChanged.length > 0 ? " (" + observedChanged.join(",") + ") — this lane runs INSIDE a live team, so its own record legitimately mutates; the lane never writes it (A9 + no write primitive in the built package)" : ""))

  /** The dist revision at evidence-write time, compared with the start-of-run reading. */
  const revisionAfter = artifactRevision()
  /** The revision comparison recorded in the result; a change means the run describes no revision. */
  const revisionDelta: LocalRevisionDelta = revisionBefore.sha256 === revisionAfter.sha256
    ? { changed: false, reason: "the dist did not move during the run" }
    : { changed: true, reason: "the dist changed mid-run: results describe neither revision", before: revisionBefore.sha256, after: revisionAfter.sha256 }
  if (revisionDelta.changed) say("REVISION DRIFT: " + revisionDelta.reason)

  /** True when every arm-1 assertion held. */
  const arm1Ok = arm1.items.every((item) => item.ok === true)
  /** True when the host arm was skipped, or every one of its assertions held. */
  const arm2Ok = arm2.skipped === true || arm2.items.every((item) => item.ok === true)
  /** True when the caller asked for a missing fixture to FAIL rather than skip. */
  const strict = process.argv.includes("--no-skip")
  /** True when the host arm was skipped, which the strict flag turns into a failure. */
  const skippedHost = arm2.skipped === true
  /** The lane verdict: both arms green, no revision drift and no protected byte moved. */
  const ok = arm1Ok && arm2Ok && !revisionDelta.changed && interfered.length === 0 && !(skippedHost && strict)

  /** The result payload written as `result.json`, with NOT-CLAIMED emitted verbatim. */
  const payload = {
    task: TASK,
    ok,
    laneScript: {
      path: "skills/dsh-qa/scripts/tui-team-surface.ts",
      sha256: sha256File(fileURLToPath(import.meta.url)),
      note: "the digest of the lane that produced this result, so the verdict can be tied to the exact bytes that measured it",
    },
    revision: revisionAfter,
    revisionDelta,
    sandboxRoot: root.replace(REPO + "/", ""),
    sandboxNote: "QA scratch under the lane's standard root (AGENTS.md §7: workspace state must be sandboxed; .mpd/ is gitignored so no credential or scratch byte can be committed). The frozen contract and VENDOR_LOCK.json are hard-asserted unchanged; the workspace's own LIVE team record legitimately mutates while this lane runs and is recorded as an observation only.",
    protectedPaths: { before: protectedBefore, after: protectedAfter, changed: interfered },
    observedPaths: { note: "the lane runs INSIDE a live team, so this record mutates as the team works; the lane never writes it", before: observedBefore, after: observedAfter, changed: observedChanged },
    fixture: { file: fixture.file.replace(REPO + "/", ""), sha256Before: fixture.sha256, sha256After: fixtureAfter, unchanged: noWrite },
    arm1: {
      items: arm1.items,
      registered: arm1.mounted.sceneRegistrations.map((entry) => ({ id: entry.id, title: entry.title })),
      emptyStateArms: arm1.emptyArms.map((entry) => ({ name: entry.name, threw: entry.threw, emptyState: entry.facts!.emptyState, title: entry.facts!.titleLine })),
      boundaryCalls: arm1.green.approvalAttempts,
    },
    arm2,
    negativeControl: arm1.control,
    findings,
    notClaimed: NOT_CLAIMED,
    confirmStepInterpretation: "The frozen contract has NO host dialog for approve (§3.2/§4.2): the confirmation step is the in-scene echo + exact phrase + Ctrl+X chord. `confirm dialog request` is therefore asserted as that step (instruction line, required phrase, EMPTY echo at entry) plus the REAL managed dialog of the bare `/mpd` picker that carries the Plan entry (arm 2, H2).",
  }
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ slug: SLUG, ...payload }, null, 2) + "\n")
  writeFileSync(join(outDir, "output.log"), log.join("\n") + "\n")

  if (skippedHost) {
    emitMarker(strict ? "FAIL" : "SKIP", SLUG, "absent-fixture", "tui profile in the sandbox root", "bun skills/dsh-qa/scripts/tui-mount.ts --sandbox-root <root> --install")
  }
  console.log("[" + SLUG + "] " + (ok ? "PASS" : "FAIL") + " -> " + outDir.replace(REPO + "/", ""))
  if (!ok) {
    /** Every assertion row that did not hold, printed so a red names itself. */
    const failed = [...arm1.items, ...(arm2.items ?? [])].filter((item) => item.ok !== true)
    console.error("[" + SLUG + "] FAIL: " + JSON.stringify(failed).slice(0, 1500))
    process.exit(1)
  }
  console.log("[" + SLUG + "] PASS: arm1 gate+adapter green, negative control red as required, arm2=" + (skippedHost ? "SKIPPED" : arm2.outcome))
  // The scene's 2000 ms refresh interval is real: exit explicitly so a live handle
  // cannot hold the process open after the verdict is written.
  process.exit(0)
}

/** True only when this module is the process entry point, never when it is imported. */
const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest()
  else real().catch((error) => {
    // The rejection reason is `unknown`: the cast states the Error-ish shape whose stack is printed.
    console.error("[" + SLUG + "] FAIL: " + String((error as { stack?: unknown })?.stack ?? error))
    process.exit(1)
  })
}
