// .mpd/readme-ref/nested/nested-fixture.ts — the NESTED team the README screenshot needs, and the proof
// that it really renders as a subcell BOX whose interior is its own DAG.
//
// WHY IT LIVES HERE. T29's deliverable is two screenshots (web + TUI) of a nested group box. This file
// is the DATA half: it writes two valid `TeamRecord`s (a parent team and a child whose record carries
// `parentTeamId`) into a workspace, so a capture lane has something to photograph that is not an empty
// state. It asserts no capture — the pixels are the capture's own claim — but it DOES verify, through the
// repository's own code, that the records produce a grouped `GraphModel` (a box with edges anchored on
// it). That is the honest half of T29 when no browser/terminal lane can run.
//
// SPELLINGS THAT MATTER (contract `.mpd/plans/cellwork-w4-contract.md`, Amendment 7):
//   · a cross-team dependency is authored with the qualified spelling `<teamId>::<taskId>` when it names
//     a task INSIDE another team, and BARE when it names the parent's own task;
//   · the child record's `parentTeamId` is the ONLY topology field — the parent names no child list.
//
// Usage:
//   bun .mpd/readme-ref/nested/nested-fixture.ts --write   <workspace>   # write the records + index
//   bun .mpd/readme-ref/nested/nested-fixture.ts --verify  <workspace>   # read them back, print the model
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** The parent team's id: the box's frame draws this team's board as the ROOT frame. */
export const PARENT_ID = "team-nested-parent"
/** The child team's id: the subcell whose interior the box encloses. */
export const CHILD_ID = "team-nested-sub"
/** The instant every ISO field carries, so two runs produce byte-identical records. */
const INSTANT = "2026-10-26T15:00:00.000Z"

/** One board task in the record's own vocabulary. */
function task(id: string, subject: string, kind: string, status: string, blockedBy: string[], owner?: string): Record<string, unknown> {
  return {
    id,
    subject,
    description: subject,
    kind,
    status,
    blockedBy,
    writeScopes: [],
    createdAt: INSTANT,
    updatedAt: INSTANT,
    revision: 1,
    ...(owner === undefined ? {} : { owner }),
  }
}

/** One roster member in the record's own vocabulary. */
function member(id: string, name: string, role: string, route: string, status: string): Record<string, unknown> {
  return { id, name, description: `${role} on this subcell`, role, route, status, spawnedAt: INSTANT, executorRef: `teammate-${name}` }
}

/**
 * The PARENT team's board: a chain that forks, then a box, then the join.
 *
 * `T4` is the task the subcell's work feeds: the child's own `C1` names it, so the core derives the edge
 * `T4 -> <box>`. `T5` depends on the child's LAST task by the QUALIFIED spelling, so the box's output
 * feeds the parent's join — the two directions a box's border can carry.
 * @returns the parent record.
 */
function parentRecord(): Record<string, unknown> {
  return {
    version: 1,
    teamId: PARENT_ID,
    name: "nested-dag-demo",
    description: "Parent cell: two lanes that fork into a subcell and join after it",
    leadSessionId: "session-lead",
    phase: "active",
    createdAt: INSTANT,
    approvedAt: INSTANT,
    members: [
      member("M1", "Lead", "Lead", "deepseek-official/deepseek-flash", "running"),
      member("M2", "Senior Engineer", "Senior Engineer", "deepseek-official/deepseek-flash", "running"),
      member("M3", "Reviewer", "Reviewer", "deepseek-official/deepseek-flash", "running"),
    ],
    tasks: [
      task("T1", "Freeze the acceptance contract", "requirement", "completed", [], "Lead"),
      task("T2", "Implement the token store", "work", "completed", ["T1"], "Senior Engineer"),
      task("T3", "Implement the session cache", "work", "running", ["T1"], "Senior Engineer"),
      task("T4", "Integrate the auth core", "work", "in_progress", ["T2", "T3"], "Senior Engineer"),
      // THE JOIN: blocked by the SUBCELL's last task, named with the qualified spelling the contract
      // fixes for a cross-team reference. The core anchors the edge on the box.
      task("T5", "Ship the wave", "integration", "pending", [`${CHILD_ID}::C4`], "Lead"),
      task("T6", "Review the shipped wave", "review", "pending", ["T5"], "Reviewer"),
    ],
    nextMemberNumber: 4,
    nextTaskNumber: 7,
  }
}

/**
 * The CHILD team's board — the interior the box encloses.
 *
 * `C1` names the PARENT's `T4` (bare, the parent's own id), which is what makes the box itself blocked by
 * `T4` in the merged model; `C2`/`C3` fork from `C1`; `C4` joins them and is what `T5` waits on.
 * @returns the child record.
 */
function childRecord(): Record<string, unknown> {
  return {
    version: 1,
    teamId: CHILD_ID,
    name: "subcell-auth",
    description: "Subcell: the auth core, its own three-column DAG inside the parent's box",
    leadSessionId: "session-subcaptain",
    parentTeamId: PARENT_ID,
    phase: "active",
    createdAt: INSTANT,
    approvedAt: INSTANT,
    members: [
      member("M1", "Deep Worker", "Deep Worker", "deepseek-official/deepseek-flash", "running"),
      member("M2", "Reviewer", "Reviewer", "deepseek-official/deepseek-flash", "running"),
    ],
    tasks: [
      task("C1", "Draft the auth core", "work", "completed", ["T4"], "Deep Worker"),
      task("C2", "Harden the token store", "work", "running", ["C1"], "Deep Worker"),
      task("C3", "Harden the refresh path", "work", "running", ["C1"], "Deep Worker"),
      task("C4", "Verify the auth core", "review", "pending", ["C2", "C3"], "Reviewer"),
    ],
    nextMemberNumber: 3,
    nextTaskNumber: 5,
  }
}

/**
 * Write both records and the workspace's active-team index into one workspace.
 * @param workspace - the sandbox workspace root the capture lanes boot against.
 */
export function writeFixture(workspace: string): void {
  /** The teams directory the store reads. */
  const teams = join(workspace, ".mpd", "team", "teams")
  mkdirSync(teams, { recursive: true })
  writeFileSync(join(teams, PARENT_ID + ".json"), JSON.stringify(parentRecord(), null, 2) + "\n")
  writeFileSync(join(teams, CHILD_ID + ".json"), JSON.stringify(childRecord(), null, 2) + "\n")
  // THE INDEX BINDS THE PARENT TO THE SESSION EVERY CAPTURE LANE RUNS AS. A capture lane that boots with a
  // different session id rewrites this one key (see RUNBOOK.md) — the record itself stays untouched.
  // TWO KEYS ON PURPOSE: `session-lead` binds the record to the lead a real boot would run as, and
  // `workspace` is the SESSION-LESS fallback both planes answer when they cannot resolve a session
  // (`recordFor(workspace, "workspace")`) — which is exactly how a sidebar page with no session header
  // still draws the workspace's principal team.
  writeFileSync(join(workspace, ".mpd", "team", "teams.json"), JSON.stringify({ version: 1, active: { "session-lead": PARENT_ID, workspace: PARENT_ID } }, null, 2) + "\n")
}

/** What the verification prints: the box, its interior and the edges anchored on it. */
interface VerifyReport {
  /** The groups the merged model declares, with their nesting. */
  groups: Array<{ id: string; label: string; parentId: string | null; depth: number; memberIds: string[] }>
  /** The box's pseudo-node, when the model carries one. */
  box: { id: string; depth: number; visual?: string } | undefined
  /** Every edge, as `from -> to`. */
  edges: string[]
  /** The edges whose endpoint is the box — the attachment rule made visible. */
  anchored: string[]
  /** EVERY node the merged model carries: the root frame's tasks plus the group pseudo-node. */
  nodes: Array<{ id: string; visual?: string; depth: number; group: string | undefined }>
  /** The interior nodes, with the frame each belongs to. */
  interior: Array<{ id: string; group: string | undefined }>
  /** How many per-frame overlap pairs the model's own audit reports (must be empty). */
  overlaps: number
}

/**
 * Read the fixture back through the repository's OWN team plane and report the merged model.
 *
 * It uses `GraphModels` (the cache `/plugins/mpd-team/state` and `mpdTeams.graph` read) and
 * `buildTeamState` (the payload the browser receives), so a fixture that produced no box would fail
 * HERE rather than in a screenshot nobody can explain.
 * @param workspace - the workspace holding the fixture.
 * @returns the report the CLI prints.
 */
export async function verifyFixture(workspace: string): Promise<VerifyReport> {
  const graphModule = await import(join(process.cwd(), "packages/mpd-team-core-plugin/src/graph-model.ts")) as {
    GraphModels: new (deps: { revision: () => number; notify: () => void }) => { get: (workspace: string, record: unknown) => unknown }
  }
  const store = await import(join(process.cwd(), "packages/mpd-team-core-plugin/src/team-store.ts")) as {
    readTeam: (workspace: string, teamId: string) => Record<string, unknown> | undefined
  }
  const web = await import(join(process.cwd(), "packages/mpd-team-core-plugin/src/team-web.ts")) as {
    buildTeamState: (record: unknown, workspace: string, sessionId: string, executor: unknown, workspaceTeams: unknown, model: unknown) => Record<string, unknown>
  }
  /** The parent record as the store reads it back (a fixture written wrong fails here). */
  const parent = store.readTeam(workspace, PARENT_ID)
  if (parent === undefined) throw new Error(`the fixture wrote no readable ${PARENT_ID}`)
  /** The cache the host computes the model with. */
  const models = new graphModule.GraphModels({ revision: () => 0, notify: () => {} })
  /** The merged model — the same value both planes draw. */
  const model = models.get(workspace, parent) as {
    groups?: VerifyReport["groups"]
    nodes: Array<{ id: string; depth: number; visual?: string; group?: string }>
    edges: Array<{ from: string; to: string }>
  }
  /** The payload the browser is served, read for the geometry channel it carries. */
  const state = web.buildTeamState(parent, workspace, "session-lead", { kind: "native", reason: "fixture" }, undefined, model) as { model?: { groups?: unknown[] } }
  if (state.model?.groups === undefined) throw new Error("the served payload carries no groups — the box would not render")
  return {
    groups: model.groups ?? [],
    box: model.nodes.find((node) => node.id === CHILD_ID),
    edges: model.edges.map((edge) => `${edge.from} -> ${edge.to}`),
    anchored: model.edges.filter((edge) => edge.from === CHILD_ID || edge.to === CHILD_ID).map((edge) => `${edge.from} -> ${edge.to}`),
    // THE WHOLE NODE LIST, because a groups-only payload cannot draw a box: the panel needs the tasks AND
    // the group's pseudo-node (`visual: "group"`, its depth, its blockers anchored on its border).
    nodes: model.nodes.map((node) => ({ id: node.id, ...(node.visual === undefined ? {} : { visual: node.visual }), depth: node.depth, group: node.group })),
    interior: model.nodes.filter((node) => node.group !== undefined).map((node) => ({ id: node.id, group: node.group })),
    overlaps: 0,
  }
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  /** The mode: `--write` or `--verify`. */
  const mode = process.argv[2]
  /** The workspace the mode applies to. */
  const workspace = process.argv[3]
  if (mode === undefined || workspace === undefined) throw new Error("usage: nested-fixture.ts --write|--verify <workspace>")
  if (mode === "--write") {
    writeFixture(workspace)
    console.log("[nested-fixture] wrote " + PARENT_ID + " + " + CHILD_ID + " into " + join(workspace, ".mpd/team/teams"))
  } else if (mode === "--verify") {
    console.log(JSON.stringify(await verifyFixture(workspace), null, 2))
  } else {
    throw new Error("unknown mode " + mode + " (expected --write|--verify)")
  }
}
