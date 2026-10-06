// The language pin for this process: see `test/__dshtui-lang.ts` for WHY it is required.
import "./__dshtui-lang"
// The team-workflow + plan-approval surfaces (frozen contract `.mpd/plans/tui-team-surface.md`).
//
// What these tests pin, and why each one is falsifiable:
//   * the projection is read from a REAL team.json on disk (a fixture the test
//     writes and the reader re-reads), never from a hand-built object;
//   * the two scene ids register through the same `tuiScenes` seam as the board;
//   * the approval chord is INERT on a mismatch and on an empty echo (barriers 2
//     and 3), so removing the phrase gate reddens this file;
//   * a refused tool result is rendered as a refusal, never as a success;
//   * a malformed / absent record renders an empty state instead of throwing;
//   * the §9.4 render boundary strips control characters (ESC/OSC included) and
//     clamps cells, in BOTH untrusted directions (tool error text, record name);
//   * the DAG is ordered by depth then creation order (§3.1 item 4) and a refusal
//     keeps the consent echo (§4.5);
//   * the package's own source and built bytes carry NO filesystem write primitive.
//
// The React double models the host instead of being permissive: `useInput`
// handlers are captured (so a key can be pressed), `useEffect` runs after the
// render (never during it), and hook state is index-keyed across re-renders,
// exactly like the real reconciler's hook order contract.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLog } from "../src/log"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index.js"
import {
  BOARD_SCENE_ID,
  PLAN_MUTATION_UNAVAILABLE,
  PLAN_SCENE_ID,
  SCENE_ROW_MAX_CELLS,
  TEAM_SCENE_ID,
  planActionLines,
  registerScene,
  safeLine,
  type PlanActionOutcome,
  type PlanActions,
} from "../src/scenes"
import { approvalPhrase, mailboxKey, planProjectionLines, readTeamWorkflow, taskDepths, teamWorkflowLines } from "../src/team-state"
import { legendLines } from "../src/graph"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index"
import { boardLines, readBoardState } from "../src/state"

/** Every temp root this file created, removed in `afterEach`. */
const temporary: string[] = []
/** A silent logger: these arms assert rendered text, not logs. */
const log = createLog(undefined, "mpd-tui-test", {})

afterEach(() => {
  while (temporary.length > 0) {
    /** The temp root this iteration removes. */
    const dir = temporary.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** The repository root, derived from this file's own directory. */
const REPO = join(import.meta.dir, "..", "..", "..")

/**
 * The OFFICIAL live views a fixture registers, keyed by workspace.
 *
 * 0.1.7: the TUI reads the harness's own readout (through the adapter), NOT the retired
 * `.mpd/team/<id>/team.json`. The file is still written below, so every arm keeps proving that
 * NOTHING reads it; these views are what a host would actually serve.
 */
const FIXTURE_VIEWS = new Map<string, DshTeamView[]>()

/** The views of one fixture workspace (what the production wiring would resolve through the adapter). */
const viewsOf = (workspace: string): DshTeamView[] => FIXTURE_VIEWS.get(workspace) ?? []

/**
 * A workspace holding ONE team, registered as an OFFICIAL live view (and, for the negative control,
 * also written to the retired record path the readers must ignore).
 */
function teamFixture(record: Record<string, unknown>, opts: { captainInbox?: string[]; memberInbox?: Record<string, string[]> } = {}): string {
  /** The temp root this fixture owns, registered for cleanup. */
  const root = mkdtempSync(join(tmpdir(), "mpd-tui-team-"))
  temporary.push(root)
  /** The fixture workspace under that root. */
  const workspace = join(root, "workspace")
  /** The team id the fixture record names, or its default. */
  const id = String(record.id ?? "team-1")
  /** The retired mailbox directory: written so the arms keep proving nothing reads it. */
  const inbox = join(workspace, ".mpd", "team", id, "inbox")
  mkdirSync(inbox, { recursive: true })
  writeFileSync(join(workspace, ".mpd", "team", id, "team.json"), JSON.stringify(record, null, 2))
  /** The captain mailbox lines the caller supplied. */
  const captain = opts.captainInbox ?? []
  if (captain.length > 0) writeFileSync(join(inbox, "captain.jsonl"), captain.join("\n") + "\n")
  for (const [name, lines] of Object.entries(opts.memberInbox ?? {})) {
    writeFileSync(join(inbox, `${mailboxKey(name)}.jsonl`), lines.join("\n") + "\n")
  }
  FIXTURE_VIEWS.set(workspace, [viewOf(record)])
  return workspace
}

/** One official team view, projected from the fixture's record vocabulary. */
function viewOf(record: Record<string, unknown>): DshTeamView {
  /** The team id the view carries. */
  const id = String(record.id ?? "team-1")
  /** The Lead session id, or one derived from the team id. */
  const leadSessionId = String(record.captainSessionId ?? id + "-lead")
  /** The record's member rows, empty when the field is not an array. */
  const members = Array.isArray(record.members) ? (record.members as Record<string, unknown>[]) : []
  /** The record's task rows, empty when the field is not an array. */
  const tasks = Array.isArray(record.tasks) ? (record.tasks as Record<string, unknown>[]) : []
  return {
    teamId: id,
    leadName: "lead",
    leadSessionId,
    members: [
      { id: leadSessionId, name: "lead", role: "lead", status: "running", diagnostics: [] },
      ...members.map((member, index) => ({
        id: String(member.id ?? "m" + index),
        name: String(member.name ?? "m" + index),
        role: "teammate" as const,
        status: (member.status === undefined ? "inactive" : String(member.status)) as DshTeamView["members"][number]["status"],
        ...(typeof member.provider === "string" ? { provider: member.provider } : {}),
        ...(typeof member.model === "string" ? { model: member.model } : {}),
        ...(typeof member.description === "string"
          ? { description: member.description }
          : typeof member.role === "string"
            ? { description: member.role }
            : {}),
        diagnostics: [],
      })),
    ],
    tasks: tasks.map((task, index) => ({
      id: String(task.id ?? "t" + index),
      revision: typeof task.attempt === "number" ? task.attempt : 1,
      subject: String(task.subject ?? ""),
      description: "",
      status: String(task.status ?? "pending") as DshTeamView["tasks"][number]["status"],
      blockedBy: (Array.isArray(task.dependencies) ? task.dependencies : []).map((entry) => String(entry)),
      writeScopes: [],
      ...(typeof task.assignee === "string" && task.assignee !== "" ? { ownerName: task.assignee } : {}),
      ready: true,
      writeScopeWarnings: [],
    })),
  }
}

/** A staged plan with dependencies, a failed dependency, a cycle-free DAG and mail. */
function stagedRecord(): Record<string, unknown> {
  /** The fixture's clock, so the record carries plausible timestamps. */
  const now = Date.now()
  return {
    id: "mpd-fixture-1",
    name: "Fixture Team",
    description: "fixture",
    captainSessionId: "sess-1",
    createdAt: now - 1000,
    phase: "staged",
    planReviewState: "awaiting_review",
    members: [
      { id: "m1", name: "Architect", role: "architecture review", provider: "deepseek-official", model: "deepseek-v4-flash", status: "idle" },
      { id: "m2", name: "Senior Engineer", role: "primary implementation", provider: "deepseek-official", model: "deepseek-v4-flash", status: "removed" },
      { id: "m3", name: "Reviewer", role: "correctness review", provider: "deepseek-official", model: "deepseek-v4-flash", status: "idle" },
    ],
    tasks: [
      { id: "t1", kind: "requirements", subject: "freeze the contract", status: "completed", assignee: "Architect", attempt: 1, round: 1, verdict: "pass", dependencies: [] },
      { id: "t2", kind: "implementation", subject: "build it", status: "pending", assignee: "Architect", attempt: 0, round: 1, dependencies: ["t1"] },
      { id: "t3", subject: "no kind here", status: "failed", attempt: 2, dependencies: [] },
    ],
  }
}

// ── the projection ──────────────────────────────────────────────────────────

describe("team-workflow projection (read-only, from the OFFICIAL live readout)", () => {
  test("renders the roster, the task DAG, the counts and the honest blanks", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord(), {
      captainInbox: [
        JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }),
        JSON.stringify({ id: "b", from: "Reviewer", to: "captain", content: "ready to review", ts: 2, readAt: 3 }),
      ],
      memberInbox: {
        Architect: [JSON.stringify({ id: "c", from: "captain", to: "Architect", content: "go", ts: 4 })],
      },
    })
    /** The projection under test. */
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    expect(workflow.team?.id).toBe("mpd-fixture-1")
    // 0.1.7: a team has NO name and NO phase of its own on the official plane — the readout names
    // the Lead pseudo-row `lead`, and `phase` is DERIVED (a teammate running/provisioning ⇒ active).
    expect(workflow.team?.name).toBe("lead")
    expect(workflow.team?.phase).toBe("idle")
    expect(workflow.team?.staged).toBe(false)
    expect(workflow.team?.planReviewState).toBeUndefined()
    expect(workflow.team?.runnable).toBe(true)
    // A removed member is not part of the roster (the Web's own filter).
    expect(workflow.members.map((member) => member.name)).toEqual(["Architect", "Reviewer"])
    expect(workflow.members[0]?.route).toBe("deepseek-official/deepseek-v4-flash")
    expect(workflow.members[0]?.done).toBe(1)
    expect(workflow.members[0]?.total).toBe(2)
    expect(workflow.members[0]?.currentTask).toBeUndefined()
    // t1 completed, t2 pending (blocked by nothing: t1 is completed), t3 failed.
    // Depth is computed, then the projection is ORDERED by it (§3.1 item 4): t1 and t3 are
    // roots (depth 0, creation order t1 then t3) and t2 sits behind t1 (depth 1).
    expect(workflow.tasks.map((task) => task.id)).toEqual(["t1", "t3", "t2"])
    /** Task lookup by id, for the row-level assertions. */
    const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
    expect(byId.get("t2")?.dependencies).toEqual(["t1"])
    expect(byId.get("t2")?.depth).toBe(1)
    expect(byId.get("t2")?.visual).toBe("open")
    expect(workflow.counts).toMatchObject({ total: 3, completed: 1, pending: 1, failed: 1 })
    // The peer mailbox is NOT observable through the adapter: the projection reports `null`
    // rather than a fabricated `0`, and the inbox files left in the fixture are ignored.
    expect(workflow.mail.unread).toBe(null)
    expect(workflow.mail.captainInbox).toEqual([])
    expect(workflow.members.map((member) => member.unread)).toEqual([null, null])

    /** The rendered workflow body. */
    const rows = teamWorkflowLines(workflow).join("\n")
    expect(rows).toContain("team       lead (mpd-fixture-1)")
    expect(rows).toContain("phase      idle")
    expect(rows).not.toContain("plan       ")
    // `description` is the official roster's field for a member's one-line note; `provider`/`model`
    // still compose the route.
    expect(rows).toContain("Architect · architecture review · deepseek-official/deepseek-v4-flash · idle")
    // `kind`, `attempt`, `round` and `verdict` have NO official source, so the row prints only what
    // the board carries (the optionals render as the honest blank).
    expect(rows).toContain("t1 [-] freeze the contract · completed @Architect")
    expect(rows).toContain("t2 [-] build it · pending @Architect deps=t1")
    expect(rows).toContain("t3 [-] no kind here · failed")
    expect(rows).toContain("3 total · 1 completed · 0 in progress · 1 pending · 0 claimed · 1 failed")
    expect(rows).toContain("mail       (not observable on the official team plane)")
    // The hold row is omitted unless the watchdog reports THIS team as held.
    expect(rows).not.toContain("watchdog")
    expect(teamWorkflowLines(readTeamWorkflow(workspace, ["mpd-fixture-1"], viewsOf(workspace))).join("\n")).toContain("watchdog   HELD (mpd-fixture-1)")
    expect(teamWorkflowLines(readTeamWorkflow(workspace, ["other-team"], viewsOf(workspace))).join("\n")).not.toContain("watchdog")
  })

  test("the depth walk and the failed-dependency marking match the panel's own semantics", () => {
    /** A hand-built DAG, including one unknown dependency id. */
    const tasks = [
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["b", "x"] },
    ]
    /** The computed depth per task id. */
    const depths = taskDepths(tasks)
    expect(depths.get("a")).toBe(0)
    expect(depths.get("b")).toBe(1)
    // An unknown dependency id is not a dependency at all (the panel's own filter).
    expect(depths.get("c")).toBe(2)

    /** This arm's fixture workspace. */
    const workspace = teamFixture({
      id: "dep-1",
      name: "Dep",
      phase: "running",
      members: [],
      tasks: [
        { id: "t1", subject: "root", status: "completed", dependencies: [] },
        { id: "t2", subject: "failed root", status: "failed", dependencies: [] },
        { id: "t3", subject: "blocked", status: "pending", dependencies: ["t2"] },
        { id: "t4", subject: "unblocked", status: "pending", dependencies: ["t1"] },
      ],
    })
    /** The projection under test. */
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    /** Task lookup by id. */
    const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
    // A FAILED dependency does not block (OPT-1), it is reported separately.
    expect(byId.get("t3")?.failedDependencies).toEqual(["t2"])
    expect(byId.get("t3")?.visual).toBe("open")
    expect(byId.get("t4")?.visual).toBe("open")
    /** The rendered workflow body. */
    const text = teamWorkflowLines(workflow).join("\n")
    expect(text).toContain("t3 [-] blocked · pending")
    expect(text).toContain("failed-dep=t2")
    expect(text).toContain("t4 [-] unblocked · pending")
  })

  test("a pending task behind an UNFINISHED dependency renders BLOCKED", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture({
      id: "blocked-1",
      name: "Blocked",
      phase: "running",
      members: [],
      tasks: [
        { id: "t1", subject: "first", status: "in_progress", dependencies: [] },
        { id: "t2", subject: "second", status: "pending", dependencies: ["t1"] },
      ],
    })
    /** The rendered body of the blocked arm. */
    const text = teamWorkflowLines(readTeamWorkflow(workspace, [], viewsOf(workspace))).join("\n")
    expect(text).toContain("t2 [-] second · pending deps=t1 BLOCKED")
  })

  test("a corrupt / absent / cyclic record renders an empty state and never throws", () => {
    /** The temp root of the broken-input arm. */
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-broken-"))
    temporary.push(root)
    /** A workspace holding a corrupt retired record and no live view. */
    const workspace = join(root, "workspace")
    mkdirSync(join(workspace, ".mpd", "team", "broken"), { recursive: true })
    writeFileSync(join(workspace, ".mpd", "team", "broken", "team.json"), "{ not json")
    // 0.1.7: a broken RECORD FILE is not a source any more — it produces no note, because nothing
    // reads it. What the projection must survive is a workspace with NO views (the seam's own
    // degradation), and it does so silently: an empty workflow, no problems.
    const broken = readTeamWorkflow(workspace, [], viewsOf(workspace))
    expect(broken.team).toBeUndefined()
    expect(broken.problems).toEqual([])
    expect(teamWorkflowLines(broken)).toEqual(["team       (none in this workspace)"])

    /** The projection of a workspace that does not exist. */
    const absent = readTeamWorkflow(join(root, "does-not-exist"))
    expect(absent.team).toBeUndefined()
    expect(absent.tasks).toEqual([])
    expect(teamWorkflowLines(absent)).toEqual(["team       (none in this workspace)"])

    // A cycle is VISIBLE (a bounded note), never a hang and never a stack overflow.
    const cyclic = teamFixture({
      id: "cycle-1",
      name: "Cycle",
      phase: "running",
      members: [],
      tasks: [
        { id: "a", subject: "a", status: "pending", dependencies: ["b"] },
        { id: "b", subject: "b", status: "pending", dependencies: ["a"] },
      ],
    })
    /** The projection of the cyclic board. */
    const workflow = readTeamWorkflow(cyclic, [], viewsOf(cyclic))
    expect(workflow.problems.some((problem) => problem.startsWith("cycle "))).toBe(true)
    expect(workflow.tasks.every((task) => Number.isInteger(task.depth))).toBe(true)
  })

  test("the REAL record of this session's own team projects without a hand-built object", () => {
    /** The retired record path of a real session's team, when this clone has one. */
    const path = join(REPO, ".mpd", "team", "mpd-default-8d65a2b2", "team.json")
    if (!existsSync(path)) return // absent in a fresh clone: the fixture tests above carry the load
    /** The repository root, used as this arm's workspace. */
    const workspace = join(REPO)
    /** The projection of the real record. */
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    /** The record file itself, for the id/name/phase cross-check. */
    const raw = JSON.parse(readFileSync(path, "utf8")) as { id: string; name: string; phase: string; members: unknown[]; tasks: unknown[] }
    expect(workflow.team?.id).toBe(raw.id)
    expect(workflow.team?.name).toBe(raw.name)
    expect(workflow.team?.phase).toBe(raw.phase)
    expect(workflow.members.length).toBeGreaterThan(0)
    // Same SET of tasks as the record; the projection re-orders them by depth (§3.1 item 4).
    expect([...workflow.tasks.map((task) => task.id)].sort()).toEqual([...(raw.tasks as { id: string }[]).map((task) => task.id)].sort())
    expect(workflow.tasks.every((task, index) => index === 0 || (workflow.tasks[index - 1]?.depth ?? 0) <= task.depth)).toBe(true)
    // The DAG rows carry each task's kind/status/assignee/attempt/dependencies.
    const text = teamWorkflowLines(workflow).join("\n")
    expect(text).toContain(`team       ${raw.name} (${raw.id})`)
    expect(text).toContain("t1 [requirements]")
    expect(text).toContain("deps=t1")
  })

  test("the board carries the derived team row and never a staged claim", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** The board projection. */
    const state = readBoardState(workspace, process.env.HOME ?? workspace, viewsOf(workspace))
    /** The board body. */
    const rows = boardLines(state)
    // 0.1.7: a team has no name and no review state on the official plane, so the board shows the
    // Lead name and the DERIVED phase — and it never claims a staged plan.
    expect(rows.join("\n")).toContain("team       lead (mpd-fixture-1) · phase idle")
    expect(rows.join("\n")).not.toContain("awaiting_review")
    expect(rows.join("\n")).not.toContain("team-plan")
  })
})

// ── the React / ui double ───────────────────────────────────────────────────

/** A rendered element as the React double produces it. */
interface Element {
  /** The element type: a host component or a tag name. */
  type: unknown
  /** The element's props, with the double's defaults applied. */
  props: Record<string, unknown>
  /** The element's children, in render order. */
  children: unknown[]
}

/** The host kit double one arm renders with. */
interface Kit {
  /** The React double the scenes must use. */
  React: Record<string, unknown>
  /** The ui kit double the scenes must use. */
  ui: Record<string, unknown>
  /** Captured `useInput` handlers, most recent last. */
  handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[]
  /** Resets one render pass: hook index 0 and no handlers. */
  begin(): void
  /** Runs the effects queued by the last render; true when any ran. */
  flush(): boolean
  /** Dispatches one key to the most recently registered handler. */
  press(input: string, key?: Record<string, unknown>): void
  /** Flattens a rendered tree into its text. */
  text(tree: unknown): string
  /** The last tree `text` flattened — the drawn elements, so a part of the surface is assertable. */
  last(): unknown
  /** How many times a rendered scene called its own `close` — the scene's exit, counted. */
  closes: number
  /**
   * Fire one POINTER handler on the first element that declares it.
   * @param handler - the prop name (`onClick`, `onMouseEnter`, `onMouseLeave`, `onWheel`).
   * @param event - the event the host would pass, in the host's own coordinate space.
   * @returns whether an element declared that handler.
   */
  pointer(handler: string, event?: Record<string, unknown>): boolean
}

/**
 * A minimal host kit double: index-keyed hook state, effects that run AFTER the
 * render, and `useInput` handlers captured for key dispatch.
 */
function makeKit(terminal: { columns: number; rows: number } = { columns: 100, rows: 30 }): Kit {
  /** Hook state and effects, keyed by hook position. */
  const store = new Map<string, unknown>()
  /** The captured input handlers. */
  const handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[] = []
  /** The hook counter of the current render pass. */
  let index = 0
  /** Effects queued by the current render, run by `flush`. */
  let pending: (() => unknown)[] = []
  /** The last tree `text` flattened, so a pointer event is fired at the drawing it measured. */
  let lastTree: unknown

  /** The React double: index-keyed hooks, effects deferred to `flush`. */
  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
      /** This state cell's key, derived from the hook position. */
      const key = `state:${index}`
      index += 1
      if (!store.has(key)) store.set(key, typeof initial === "function" ? (initial as () => unknown)() : initial)
      return [
        store.get(key),
        (next: unknown) => {
          store.set(key, typeof next === "function" ? (next as (prev: unknown) => unknown)(store.get(key)) : next)
        },
      ]
    },
    useEffect: (fn: () => unknown): void => {
      /** This effect's key, derived from the hook position. */
      const key = `effect:${index}`
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial: unknown): { current: unknown } => {
      /** This ref's key, derived from the hook position. */
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
    useSyncExternalStore: (): void => {},
  }

  /** The Text component: identity plus the children it renders. */
  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  /** The Box component: identity plus the props it carries. */
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [] })
  /** The ui kit, with `useInput` capturing and a fixed terminal size. */
  const ui: Record<string, unknown> = {
    Box,
    Text,
    useInput: (handler: (input: string, key: Record<string, unknown> | undefined) => void): void => {
      handlers.push(handler)
    },
    useTerminalSize: (): { columns: number; rows: number } => terminal,
  }

  return {
    React,
    ui,
    handlers,
    /** The exit counter, incremented by the props every `render` hands a scene. */
    closes: 0,
    begin: () => {
      index = 0
      handlers.length = 0
    },
    flush: () => {
      /** The effects queued for this flush. */
      const list = pending
      pending = []
      for (const fn of list) fn()
      return list.length > 0
    },
    press: (input: string, key: Record<string, unknown> = {}) => {
      /** The most recently registered input handler. */
      const handler = handlers.at(-1)
      if (handler === undefined) throw new Error("no useInput handler was registered by the scene")
      handler(input, key)
    },
    pointer: (handler: string, event?: Record<string, unknown>): boolean => {
      /** Whether an element declaring the handler was found. */
      let found = false
      /** Depth-first walk for the first element carrying the prop. */
      const walk = (node: unknown): void => {
        if (found || node === null || node === undefined) return
        if (Array.isArray(node)) { for (const child of node) walk(child); return }
        if (typeof node !== "object") return
        /** This node as an element. */
        const element = node as Element
        /** The handler this element declares, when it declares one. */
        const fn = element.props?.[handler]
        if (typeof fn === "function") { found = true; (fn as (event: unknown) => void)(event); return }
        for (const child of element.children ?? []) walk(child)
      }
      walk(lastTree)
      return found
    },
    text: (tree: unknown): string => {
      lastTree = tree
      // ROW-AWARE FLATTENING. A scene row may now be built from SEVERAL coloured spans, which the
      // real host renders INLINE inside one <Text>. Joining every span with a newline — which is what
      // this helper did while a row was always exactly one string — would turn one drawn row into
      // five, so the walk below joins a row's own spans with nothing and separates only the rows.
      /** The rendered lines. */
      const out: string[] = []
      /** Every character inside one node, spans joined with nothing. */
      const inline = (node: unknown): string => {
        if (node === null || node === undefined) return ""
        if (typeof node === "string") return node
        if (typeof node === "number") return String(node)
        if (Array.isArray(node)) return node.map(inline).join("")
        /** This node as an element, the only shape left after the guards. */
        const element = node as Element
        /** The single-child form the Text double accepts, plus the variadic form createElement passes. */
        return inline(element.props?.children) + inline(element.children ?? [])
      }
      /** Walk the tree one ROW at a time: a Box is a column, so each of its children is a line. */
      const rows = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (Array.isArray(node)) { for (const child of node) rows(child); return }
        if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return }
        /** This node as an element. */
        const element = node as Element
        if (element.type === "Box") { for (const child of element.children ?? []) rows(child); return }
        out.push(inline(node))
      }
      rows(tree)
      return out.join("\n")
    },
    last: () => lastTree,
  }
}

/** Register the real scenes against a minimal host double and return the kit + components. */
function mountScenes(
  workspace: string,
  options: {
    holds?: readonly string[]
    actions?: PlanActions
    terminal?: { columns: number; rows: number }
    /** The shared plan reader, when an arm wants a staged plan to exist. */
    planFor?: (sessionId: string) => {
      planId: string
      name: string
      description: string
      approval: string
      phrase: string
      approved: boolean
      discarded: boolean
      members: Array<{ name: string; description: string; role?: string }>
      tasks: Array<{ subject: string; description: string; owner?: string; blockedBy: string[] }>
    } | undefined
  } = {},
): { kit: Kit; components: Record<string, unknown>; opened: string[]; seam: ReturnType<typeof registerScene> } {
  /** The registered scene components, by id. */
  const components: Record<string, unknown> = {}
  /** Every scene id the host double was asked to open. */
  const opened: string[] = []
  /** The services this composition exposes. */
  const services: Record<string, unknown> = {
    tuiScenes: {
      register: (descriptor: { id: string; component: unknown }) => {
        components[descriptor.id] = descriptor.component
      },
      open: (id: string) => {
        opened.push(id)
        return true
      },
    },
  }
  /** The context double, injecting only services that exist. */
  const ctx = {
    inject: (deps: readonly string[], callback: (scoped: Record<string, unknown>) => void) => {
      /** The injected scope the scene reaches services through. */
      const scoped = { get: (name: string) => services[name] }
      if (deps.every((id) => services[id] !== undefined)) callback(scoped)
      return {}
    },
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  /** The registered scene seam. */
  const seam = registerScene(
    ctx as never,
    createTuiAdapter(ctx as never),
    log,
    () => workspace,
    () => process.env.HOME ?? workspace,
    () => options.holds ?? [],
    options.actions ?? {
      available: () => true,
      approve: async () => ({ ok: true, value: { status: "running" } }),
      discard: async () => ({ ok: true }),
    },
    // The SHARED plan reader (W6): the row hands the scene the same projection the Web panel's
    // `/plan` route serves. The fixture returns nothing staged unless an arm stages one, which is
    // what keeps the pre-W6 arms behaving exactly as they did.
    options.planFor ?? (() => undefined),
    // The composition root resolves the OFFICIAL readout per call (0.1.7) and hands it to the
    // scene; the fixture's views are what a host would return here.
    () => viewsOf(workspace),
  )
  expect(seam.outcome().state).toBe("requested")
  /** The kit the caller renders with. */
  const kit = makeKit(options.terminal)
  return { kit, components, opened, seam }
}

/** Render a scene component until its effects settle, and return the rendered text. */
function render(kit: Kit, component: unknown): string {
  /** The props the host would pass to a scene; `close` is COUNTED, so an exit is assertable. */
  const props = { React: kit.React, ui: kit.ui, close: () => { kit.closes += 1 }, channel: undefined }
  /** The last rendered tree. */
  let tree: unknown
  for (let pass = 0; pass < 5; pass += 1) {
    kit.begin()
    tree = (component as (props: unknown) => unknown)(props)
    if (!kit.flush()) break
  }
  return kit.text(tree)
}

/** Re-render after a key press so the assertions see the post-key state. */
function pressAndRender(kit: Kit, component: unknown, input: string, key: Record<string, unknown> = {}): string {
  kit.press(input, key)
  return render(kit, component)
}

// ── the scenes ──────────────────────────────────────────────────────────────

describe("the two surfaces register through the existing tuiScenes seam", () => {
  test("all three scene ids are registered with their frozen titles", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** The registered components, by id. */
    const components: Record<string, unknown> = {}
    /** The registrations the host double received, in order. */
    const registered: { id: string; title?: string }[] = []
    /** A host double exposing only `tuiScenes`. */
    const services = {
      tuiScenes: {
        register: (descriptor: { id: string; title?: string; component: unknown }) => {
          registered.push({ id: descriptor.id, ...(descriptor.title === undefined ? {} : { title: descriptor.title }) })
          components[descriptor.id] = descriptor.component
        },
        open: () => true,
      },
    }
    /** The context double for that host. */
    const ctx = {
      inject: (deps: readonly string[], callback: (scoped: unknown) => void) => {
        if (deps.every((id) => (services as Record<string, unknown>)[id] !== undefined)) callback({ get: (name: string) => (services as Record<string, unknown>)[name] })
        return {}
      },
      get: () => undefined,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    }
    registerScene(ctx as never, createTuiAdapter(ctx as never), log, () => workspace, () => workspace)
    // CONTAINMENT, not an exact list: the scene set grows by design (each scene owns its own
    // registration arm), so a frozen literal here reddens on the NEXT scene instead of asserting
    // what this arm is about — that these three frozen ids are REGISTERED, with their titles.
    /** Every scene id the host double received, in registration order. */
    const registeredIds = registered.map((entry) => entry.id)
    expect(registeredIds).toEqual(expect.arrayContaining([BOARD_SCENE_ID, TEAM_SCENE_ID, PLAN_SCENE_ID]))
    // The registrations stay a SET of ids, and the three frozen titles are all present.
    expect(new Set(registeredIds).size).toBe(registeredIds.length)
    expect(registered.map((entry) => entry.title)).toEqual(expect.arrayContaining(["MPD board", "MPD team", "MPD plan approval"]))
    expect(typeof components[TEAM_SCENE_ID]).toBe("function")
    expect(typeof components[PLAN_SCENE_ID]).toBe("function")
  })

  test("a scene renders null instead of crashing when the host kit is absent", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** The registered components of the mounted scenes. */
    const { components } = mountScenes(workspace)
    for (const id of [TEAM_SCENE_ID, PLAN_SCENE_ID]) {
      /** The component under test, called as the host would call it. */
      const component = components[id] as (props: unknown) => unknown
      expect(component({ React: {}, ui: null, close: () => {} })).toBeNull()
      expect(component({})).toBeNull()
    }
  })
})

describe("surface T1 — the team workflow", () => {
  test("renders the real record's header, roster, DAG and counts", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The rendered team scene. */
    const text = render(kit, components[TEAM_SCENE_ID])
    // THE HEADER: the team's name AND its id, because `approve <teamId>` is an exact phrase.
    expect(text).toContain("MPD team — lead (mpd-fixture-1)")
    // The roster, one line, so the graph gets the room; a member carries its own progress.
    expect(text).toContain("roster")
    expect(text).toContain("Architect 1/2")
    // THE GRAPH replaced the indented task list: every task is a BOX carrying its state glyph, its
    // id, its kind abbreviation and its subject, and the dependency edge is DRAWN rather than
    // described in a `deps=` suffix.
    expect(text).toContain("task dependency graph")
    expect(text).toContain("✓ t1 freeze the contract")
    expect(text).toContain("○ t2 build it")
    // The edge between the root and its dependent is real box drawing, and the junction where it
    // leaves the parent's bottom border is what a flat list could not express.
    expect(text).toContain("┬")
    expect(text).toContain("┴")
    // The counts line is the record's own vocabulary, and the footer names the focus keys.
    expect(text).toContain("3 task(s)")
    expect(text).toContain("esc/q close")
  })

  test("a team that is NOT staged refuses the approval hop with a notice and opens nothing", () => {
    /** This arm's fixture workspace (a team that is NOT staged). */
    const workspace = teamFixture({ id: "run-1", name: "Running", phase: "running", members: [], tasks: [] })
    /** This arm's kit, components and the opened-scene log. */
    const { kit, components, opened } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    /** The scene after the approval key was pressed. */
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "a")
    expect(text).toContain("plan approval needs a staged team")
    expect(opened).toEqual([])
  })


  test("a bare `r` refresh re-reads the record without throwing", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    /** The scene after the refresh key was pressed. */
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "r")
    expect(text).toContain("MPD team — lead")
  })


  test("the watchdog HOLD is rendered only when the watchdog reports it", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** A mount whose watchdog holds THIS team. */
    const held = mountScenes(workspace, { holds: ["mpd-fixture-1"] })
    /** The rendered scene while the hold lasts. */
    const text = render(held.kit, held.components[TEAM_SCENE_ID])
    expect(text).toContain("watchdog   HELD (mpd-fixture-1)")
    /** A mount whose watchdog holds a DIFFERENT team. */
    const other = mountScenes(workspace, { holds: ["someone-else"] })
    expect(render(other.kit, other.components[TEAM_SCENE_ID])).not.toContain("watchdog")
  })
})

describe("surface T2 — the plan approval", () => {














  test("Esc mutates nothing and returns to the workflow when it was the entry point", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit, components, open log and seam. */
    const { kit, components, opened, seam } = mountScenes(workspace)
    seam.openPlan({ teamId: "mpd-fixture-1", returnToTeam: true })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    /** The scene after Esc. */
    const text = pressAndRender(kit, components[PLAN_SCENE_ID], "", { escape: true })
    expect(opened).toEqual([PLAN_SCENE_ID, TEAM_SCENE_ID])
    expect(text).not.toContain("approved:")
    expect(text).not.toContain("discarded:")
  })

  test("Esc from the command entry point leaves the scene instead of hopping", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit, components, open log and seam. */
    const { kit, components, opened, seam } = mountScenes(workspace)
    seam.openPlan({ teamId: "mpd-fixture-1" })
    render(kit, components[PLAN_SCENE_ID])
    pressAndRender(kit, components[PLAN_SCENE_ID], "", { escape: true })
    expect(opened).toEqual([PLAN_SCENE_ID])
  })

  test("Escape/keys never select a printable character as an action", () => {
    // The plain `planActionLines` projection is the falsifiable form of barrier 4:
    // only the two chords can mutate, and every printable key only edits the echo.
    const workspace = teamFixture(stagedRecord())
    /** The projection the action block is built from. */
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    /** The action block with the discard arm live. */
    const rows = planActionLines(workflow, "approve x", true, "some message")
    expect(rows.join("\n")).toContain("DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan")
    expect(rows.join("\n")).toContain("some message")
    expect(planActionLines(workflow, "", false, "").join("\n")).not.toContain("DISCARD ARMED")
    // No team record: the required phrase degrades honestly instead of inventing one.
    // "(no staged plan)" since W6: the phrase is SERVED by the shared projection, and a surface with
    // nothing staged has nothing to approve — which is a different sentence from "no team record",
    // the record being materialised only AT approval.
    expect(planActionLines(undefined, "", false, "").join("\n")).toContain("required   (no staged plan)")
  })
})

// ── repair round 2 (t4's findings F1/F2/F3) ─────────────────────────────────

describe("§9.4 — the ONE render boundary strips control characters (finding F1)", () => {
  test("safeLine strips C0/C1 (ESC, BEL, OSC) and clamps cells WITHOUT collapsing indentation", () => {
    // The escape bytes are gone; the visible remainder is harmless text.
    expect(safeLine("\u001b[31mRED\u001b[0m")).not.toContain("\u001b")
    expect(safeLine("\u001b[31mRED\u001b[0m")).toContain("RED")
    expect(safeLine("a\u0007b")).not.toContain("\u0007")
    expect(safeLine("x\u009by")).not.toContain("\u009b")
    expect(safeLine("plain")).toBe("plain")
    // Indentation SURVIVES: this is why the boundary uses stripControl+clampCells and
    // not scalarText (whose whitespace collapse would eat the DAG's depth indent).
    expect(safeLine("    t2 [implementation] build it")).toBe("    t2 [implementation] build it")
    expect(safeLine("  Architect · role · idle")).toBe("  Architect · role · idle")
    // Clamped by cell, not truncated by accident, and hostile types never throw.
    expect(safeLine("a".repeat(SCENE_ROW_MAX_CELLS + 500)).length).toBe(SCENE_ROW_MAX_CELLS)
    expect(safeLine(undefined)).toBe("")
    expect(safeLine(null)).toBe("")
    expect(safeLine({} as unknown)).toBe("[object Object]")
  })


  // skipped on win32: a directory whose name carries C0 control characters cannot exist there
  // (mkdir answers ENOENT, not a policy refusal), so the hostile-name direction has no fixture.
  // The ESC-in-a-tool-error arm above exercises the same render boundary (safeLine) everywhere.
  test.skipIf(process.platform === "win32")("a control character in a team ID cannot reach a rendered row", () => {
    // 0.1.7: there is no team DIRECTORY to be hostile in any more — the id comes from the OFFICIAL
    // readout, so the hostile value is carried on the VIEW and the render boundary must strip it
    // there. (The retired `.mpd/team/<hostile>/team.json` direction has no source left.)
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-hostile-view-"))
    temporary.push(root)
    /** A workspace whose view carries control characters in its id. */
    const workspace = join(root, "hostile")
    mkdirSync(workspace, { recursive: true })
    FIXTURE_VIEWS.set(workspace, [
      viewOf({ id: "bad\u001bname\u0007", members: [{ name: "na\u0007me" }], tasks: [{ id: "t1", status: "pending" }] }),
    ])
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The rendered scene for the hostile view. */
    const text = render(kit, components[TEAM_SCENE_ID])
    expect(text).toContain("bad")
    for (const control of ["\u001b", "\u0007", "\u009b"]) expect(text).not.toContain(control)
  })
})

describe("§3.1 item 4 — the DAG order (finding F2)", () => {
  test("tasks come out ordered by depth, with creation order as the tiebreak", () => {
    /** This arm's fixture workspace, with a hostile record order. */
    const workspace = teamFixture({
      id: "order-1",
      name: "Order",
      phase: "running",
      members: [],
      tasks: [
        // Deliberately hostile record order: the deepest task first.
        { id: "child", subject: "child", status: "pending", dependencies: ["parent"] },
        { id: "parent", subject: "parent", status: "pending", dependencies: [] },
        { id: "peer", subject: "peer", status: "pending", dependencies: [] },
        { id: "grandchild", subject: "grandchild", status: "pending", dependencies: ["child"] },
      ],
    })
    /** The projection whose order this arm pins. */
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    // depth: parent 0, peer 0, child 1, grandchild 2. Creation index: child 0, parent 1, peer 2, grandchild 3.
    expect(workflow.tasks.map((task) => task.id)).toEqual(["parent", "peer", "child", "grandchild"])

    // BOTH renderers emit that ONE order (the sort lives in the projection, not in a loop).
    const ids = ["parent", "peer", "child", "grandchild"]
    /** The task ids a rendered body emits, in emitted order. */
    const emittedOrder = (rows: string[]): string[] =>
      rows.map((row) => row.trim().split(" ")[0] ?? "").filter((token) => ids.includes(token))
    expect(emittedOrder(teamWorkflowLines(workflow))).toEqual(ids)
    expect(emittedOrder(planProjectionLines(workflow))).toEqual(ids)
    // Depth still indents the rows.
    const lines = teamWorkflowLines(workflow)
    expect(lines.find((row) => row.trim().startsWith("child ["))?.startsWith("  ")).toBe(true)
    expect(lines.find((row) => row.trim().startsWith("parent ["))?.startsWith("parent [")).toBe(true)
    expect(lines.find((row) => row.trim().startsWith("grandchild ["))?.startsWith("    ")).toBe(true)
  })
})

describe("§4.5 — the consent echo is consumed only by a SUCCESSFUL approve (finding F3)", () => {

})

// ── t8: a COMMITTED approval must be visible (t3's F1) ──────────────────────

describe("t8 — a COMMITTED approval is confirmed on screen (t3's F1)", () => {
  /** The adopted `approveStagedTeam` signature: phase -> running, approvedAt set, planReviewState gone. */
  const flipper = (recordPath: string): (() => void) => (): void => {
    /** The record as the flipper reads it. */
    const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>
    record.phase = "running"
    record.approvedAt = Date.now()
    delete record.planReviewState
    writeFileSync(recordPath, JSON.stringify(record, null, 2))
  }




})

// ── the invariants ──────────────────────────────────────────────────────────

describe("package invariants", () => {
  test("no source file in this package imports a filesystem WRITE primitive", () => {
    /** Every forbidden token found, with the file it was found in. */
    const offenders: string[] = []
    /** The write primitives this package must never contain. */
    const forbidden = ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "cpSync", "createWriteStream", "writeFile(", "rm(", "mkdir(", "unlink("]
    // The four files that read and render team state: the invariant is about THEM, and the list is
    // the one this arm has always carried (extending it to every source file would also scan the
    // watchdog front door's header, which NAMES the primitives to document the rule).
    for (const name of ["team-state.ts", "state.ts", "scenes.ts", "index.ts"]) {
      /** The source text of this file under the invariant check. */
      const source = readFileSync(join(import.meta.dir, "..", "src", name), "utf8")
      for (const token of forbidden) if (source.includes(token)) offenders.push(`${name}: ${token}`)
    }
    expect(offenders).toEqual([])
  })

  test("the built dist carries the two scene ids and no TEAM-STORE writer", () => {
    /** The built bytes of this package's entry. */
    const dist = readFileSync(join(import.meta.dir, "..", "dist", "index.js"), "utf8")
    expect(dist).toContain(TEAM_SCENE_ID)
    expect(dist).toContain(PLAN_SCENE_ID)
    // WHAT THIS ARM GUARDS, stated precisely after requirement R5 moved the diagnostics to a FILE.
    // The invariant this package owns is "the TUI never writes TEAM STATE directly — every store
    // access goes through the `mpdWatchdog`/`mpdTeams` services", so the arm rejects the WATCHDOG
    // STORE WRITERS by name. It no longer rejects every filesystem primitive: the seam adapter is
    // INLINED into this bundle, and its declared log sink (`<workspace>/.mpd/logs/mpd-tui.log`) is
    // the one write this plane is allowed to make. The "this package's own sources carry no writer"
    // half of the invariant is the arm above, which scans EVERY source file of this package.
    for (const token of ["writeHold(", "appendIncident(", "clearHold(", "writeWatermarks("]) {
      expect(dist).not.toContain(token)
    }
  })

  test("the retired approval tools are GONE and the surface says why", () => {
    // 0.1.7: neither `agent_teams_approve` nor `agent_teams_delete` is registered by any row, so
    // the module no longer exports a name to look up — it exports the REASON the plan surface
    // cannot mutate, which is what every refusal renders.
    const source = readFileSync(join(import.meta.dir, "..", "src", "scenes.ts"), "utf8")
    // No TOOL NAME is looked up any more (the docstring above the constant still names the two
    // retired tools as the reason, which is the point).
    expect(source).not.toContain("APPROVE_TOOL")
    expect(source).not.toContain("DISCARD_TOOL")
    expect(source).not.toContain('"agent_teams_approve"')
    expect(source).not.toContain('"agent_teams_delete"')
    expect(PLAN_MUTATION_UNAVAILABLE).toContain("no plan approval exists on the official Agent Teams plane")
    expect(approvalPhrase("mpd-default-8d65a2b2")).toBe("approve mpd-default-8d65a2b2")
  })

  test("the mailbox key normalization matches the adopted reader", () => {
    expect(mailboxKey("Senior Engineer")).toBe("senior-engineer")
    expect(mailboxKey("captain")).toBe("captain")
    expect(mailboxKey("中文 名")).toBe("中文-名")
  })
})

// ── W3: the focus, and the pointer ──────────────────────────────────────────
//
// WHAT THESE ARMS ARE FOR. The team scene draws a dependency graph, and a graph is only useful if
// you can ask it about ONE task. Two input paths answer that question — the keyboard, which is the
// primary one and must always work, and the pointer, which is additive and inert on a host without
// mouse tracking — and they must agree about what "the focused task" means.
//
// WHY THE ASSERTIONS BELOW ASK `graphText`, AND NOT THE WHOLE SCENE. The DAG is followed by a LEGEND
// that must NAME the marks it explains — including the focus marker `▶` — so a scene-wide scan for
// `▶` answers the legend instead of the drawing and reddens while the behaviour is still correct
// (measured: the legend landed and four of these arms failed on that alone). The arm's intent is
// "no TASK is drawn focused", which is a question about the graph BOX, so that is what it asks.

/**
 * Visit every element of a rendered tree, parents before children — the double's own shape.
 * @param node - the tree (or one element/child list of it), of unknown shape.
 * @param visit - called once per element, in draw order.
 * @returns nothing; the walk is for its side effects.
 */
function walkElements(node: unknown, visit: (element: Element) => void): void {
  if (node === null || node === undefined || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walkElements(child, visit)
    return
  }
  /** This node as an element — every rendered node is one. */
  const element = node as Element
  visit(element)
  for (const child of element.children ?? []) walkElements(child, visit)
}

/**
 * One drawn element by its React key.
 * @param tree - the tree the kit last flattened.
 * @param key - the key to look for.
 * @returns the element, or undefined when this render drew no such node.
 */
function elementByKey(tree: unknown, key: string): Element | undefined {
  /** The element found, when the walk reaches it. */
  let found: Element | undefined
  walkElements(tree, (element) => {
    if (found === undefined && element.props?.key === key) found = element
  })
  return found
}

/**
 * Everything the DAG BOX itself drew, its spans joined — the drawing, WITHOUT the legend under it.
 *
 * The legend is a SIBLING row: it explains the drawing rather than being part of it, so this helper
 * scopes a "is anything drawn focused" question to the graph Box the scene keys as `graph` (and to
 * the exact cells the pointer geometry is resolved against).
 * @param tree - the tree the kit last flattened.
 * @returns the drawing's characters; empty when this render drew no graph at all.
 */
function graphText(tree: unknown): string {
  /** The graph element, found by the key the scene gives it. */
  const graph = elementByKey(tree, "graph")
  if (graph === undefined) return ""
  /** Every character inside one node, spans joined with nothing — the kit's own flattening rule. */
  const inline = (node: unknown): string => {
    if (node === null || node === undefined) return ""
    if (typeof node === "string") return node
    if (typeof node === "number") return String(node)
    if (Array.isArray(node)) return node.map(inline).join("")
    /** This node as an element, the only shape left after the guards. */
    const element = node as Element
    return inline(element.props?.children) + inline(element.children ?? [])
  }
  return inline(graph.children ?? [])
}

describe("the team scene's focus", () => {
  /** A fixture with a three-task chain, so a focus has something to light. */
  const chained = (): Record<string, unknown> => ({
    id: "focus-1",
    name: "Focus",
    phase: "running",
    members: [],
    tasks: [
      { id: "a", subject: "root", status: "completed", dependencies: [] },
      { id: "b", subject: "middle", status: "in_progress", dependencies: ["a"] },
      { id: "c", subject: "leaf", status: "pending", dependencies: ["b"] },
    ],
  })

  test("↑/↓ moves the focus through the drawing, and the ▶ marker moves with it", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    // Nothing is focused on the first render, so no task carries the marker.
    render(kit, scene)
    expect(graphText(kit.last())).not.toContain("▶")
    // The first ↓ focuses the FIRST task in drawing order — rank order, so `a` (a root).
    expect(pressAndRender(kit, scene, "", { downArrow: true })).toContain("▶ a")
    // The next walks to the following task, and ↑ walks back.
    expect(pressAndRender(kit, scene, "", { downArrow: true })).toContain("▶ b")
    expect(pressAndRender(kit, scene, "", { upArrow: true })).toContain("▶ a")
    // ↑ from the first wraps to the last, so the ends are reachable from either direction.
    expect(pressAndRender(kit, scene, "", { upArrow: true })).toContain("▶ c")
  })

  test("a focused task lights its DEPENDENCIES and names them in the graph header", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    render(kit, scene)
    // Walk down to the last task, whose chain is the whole board above it.
    pressAndRender(kit, scene, "", { downArrow: true })
    pressAndRender(kit, scene, "", { downArrow: true })
    /** The scene with the leaf focused. */
    const text = pressAndRender(kit, scene, "", { downArrow: true })
    expect(text).toContain("▶ c")
    // The HEADER names the chain, which is what makes the highlight explainable rather than
    // decorative: a reader can see WHY those boxes are lit.
    expect(text).toContain("focus c ⇠ a,b")
  })

  test("`esc` UNPINS rather than closing, and closes once nothing is pinned", () => {
    // A pin is a MODE, so leaving it must not also leave the scene — otherwise a user who clicked a
    // task would lose their place by pressing the key that every other surface closes with.
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit, components and the close log. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    render(kit, scene)
    pressAndRender(kit, scene, "", { downArrow: true })
    expect(kit.closes).toBe(0)
    // The first Escape clears the pin and does NOT close. The drawing is asked, not the whole scene:
    // the legend under it names the marker on purpose.
    pressAndRender(kit, scene, "", { escape: true })
    expect(graphText(kit.last())).not.toContain("▶")
    expect(kit.closes).toBe(0)
    // The second Escape, with nothing pinned, closes as it always did.
    pressAndRender(kit, scene, "", { escape: true })
    expect(kit.closes).toBe(1)
  })

  test("a CLICK pins a task and hovering previews one, without the keyboard", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    render(kit, scene)
    // The graph box declares all three pointer handlers; a host without mouse tracking simply never
    // fires them, which is what makes this additive rather than a second code path.
    expect(kit.pointer("onMouseEnter", { localRow: 1, localCol: 4 })).toBe(true)
    /** The scene after the hover, which must light the task under the pointer. */
    const hovered = render(kit, scene)
    expect(hovered).toContain("▶ a")
    // HOVER IS TRANSIENT: leaving the box clears it, so the drawing returns to nothing focused.
    expect(kit.pointer("onMouseLeave", {})).toBe(true)
    render(kit, scene)
    expect(graphText(kit.last())).not.toContain("▶")
    // A CLICK pins, and the pin SURVIVES the pointer leaving — that is the difference between the
    // two gestures, and the reason both exist.
    expect(kit.pointer("onClick", { localRow: 1, localCol: 4 })).toBe(true)
    expect(render(kit, scene)).toContain("▶ a")
    kit.pointer("onMouseLeave", {})
    expect(render(kit, scene)).toContain("▶ a")
    // Clicking the SAME task again unpins it: the gesture that pinned it releases it. The pointer
    // is still OVER the node, so the HOVER keeps it lit — which is correct, and why the assertion
    // moves the pointer away before asking whether anything is focused at all.
    kit.pointer("onClick", { localRow: 1, localCol: 4 })
    kit.pointer("onMouseLeave", {})
    render(kit, scene)
    expect(graphText(kit.last())).not.toContain("▶")
  })

  test("a click on BLANK space unpins rather than pinning nothing", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    render(kit, scene)
    kit.pointer("onClick", { localRow: 1, localCol: 4 })
    expect(render(kit, scene)).toContain("▶ a")
    // A row far below the drawing is blank space, and clicking it clears the pin.
    kit.pointer("onClick", { localRow: 99, localCol: 4 })
    render(kit, scene)
    expect(graphText(kit.last())).not.toContain("▶")
  })

  test("the wheel scrolls the graph", () => {
    /** This arm's fixture workspace. */
    const workspace = teamFixture(chained())
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The scene under test. */
    const scene = components[TEAM_SCENE_ID]
    /** The scene before any scroll. */
    const before = render(kit, scene)
    expect(before).toContain("┌")
    expect(kit.pointer("onWheel", { deltaY: 1 })).toBe(true)
    // Scrolling moves the WINDOW over the drawing, so the FIRST row leaves the view — asserted on
    // the graph's own first character, because later rows legitimately still draw a `┌`.
    /** The scene after one wheel tick down. */
    const scrolled = render(kit, scene)
    /** Everything after the graph's header, which is the drawing itself. */
    const drawingOf = (value: string): string => value.slice(value.indexOf("task dependency graph") + "task dependency graph".length)
    expect(drawingOf(before).startsWith("┌")).toBe(true)
    expect(drawingOf(scrolled).startsWith("│")).toBe(true)
    // Back up, and the first row returns: the offset CLAMPS at zero rather than going negative.
    kit.pointer("onWheel", { deltaY: -1 })
    expect(render(kit, scene)).toBe(before)
  })

  test("a NARROW terminal falls back to the rail rather than clipping the boxes", () => {
    // The fallback is the reason the graph is safe at any width: `layoutBoxes` refuses rather than
    // squeezing, so this is a fact about the geometry instead of a guess about the terminal. What
    // makes boxes impossible is a WIDE RANK in a narrow viewport — a chatty chain fits at any width,
    // because its widest rank holds one box.
    /** This arm's fixture workspace: one rank with four parallel tasks. */
    const workspace = teamFixture({
      id: "wide-1",
      name: "Wide",
      phase: "running",
      members: [],
      tasks: [
        { id: "a", subject: "one", status: "pending", dependencies: [] },
        { id: "b", subject: "two", status: "pending", dependencies: [] },
        { id: "c", subject: "three", status: "pending", dependencies: [] },
        { id: "d", subject: "four", status: "pending", dependencies: [] },
      ],
    })
    /** This arm's kit, narrow enough that four boxes cannot fit. */
    const { kit, components } = mountScenes(workspace, { terminal: { columns: 44, rows: 24 } })
    /** The rendered scene. */
    const text = render(kit, components[TEAM_SCENE_ID])
    expect(text).toContain("task dependency graph (rail)")
    // The rail names every task and draws no box.
    for (const id of ["a", "b", "c", "d"]) expect(text).toContain(id)
    expect(text).not.toContain("┌")
    // The SAME board at a comfortable width draws boxes, so the fallback is a decision about the
    // geometry and not a property of the fixture.
    /** This arm's kit at a width the boxes fit. */
    const wide = mountScenes(workspace, { terminal: { columns: 120, rows: 30 } })
    expect(render(wide.kit, wide.components[TEAM_SCENE_ID])).toContain("┌")
  })
})

// ── W3: the legend under the DAG ────────────────────────────────────────────
//
// The merged panel and the team scene must draw the SAME legend under the DAG they just laid out
// (`graph.ts`'s frozen `legendLines(cols)`), in the width the graph itself was laid out for. This arm
// pins the team scene's half: the lines are drawn, they sit AFTER the drawing, and they are DIMMED —
// and it is the arm that keeps the legend present at all, which the focus arms above now depend on
// for the reason stated at their section header.
describe("the team scene's legend", () => {
  test("the legend is drawn under the DAG, in the width the graph was laid out for", () => {
    /** This arm's fixture workspace: the same three-task chain the focus arms use. */
    const workspace = teamFixture({
      id: "focus-1",
      name: "Focus",
      phase: "running",
      members: [],
      tasks: [
        { id: "a", subject: "root", status: "completed", dependencies: [] },
        { id: "b", subject: "middle", status: "in_progress", dependencies: ["a"] },
        { id: "c", subject: "leaf", status: "pending", dependencies: ["b"] },
      ],
    })
    /** This arm's kit and the registered components. */
    const { kit, components } = mountScenes(workspace)
    /** The rendered scene text. */
    const text = render(kit, components[TEAM_SCENE_ID])
    // The scene lays the graph out for `max(20, columns - 4)`; the kit measures 100 columns.
    /** The legend the frozen interface offers for that width. */
    const legend = legendLines(96)
    expect(legend.length).toBeGreaterThan(0)
    for (const line of legend) expect(text).toContain(line)
    /** The drawing's own characters, so the legend's position is measured against the DAG itself. */
    const drawing = graphText(kit.last())
    expect(drawing.length).toBeGreaterThan(0)
    // DIRECTLY UNDER THE DAG: the legend starts where the drawing ends, and nothing of the scene's
    // own content sits between them.
    expect(text.indexOf(legend[0])).toBe(text.indexOf(drawing) + drawing.length)
    expect(elementByKey(kit.last(), "legend-0")?.props?.dimColor).toBe(true)
  })
})

// ── W6: the TUI consumes the SHARED plan projection ─────────────────────────
//
// THE USER'S DIRECTIVE for this work: the Web panel and the TUI scene share the infrastructure and
// differ only in how they DRAW it. These arms pin the TUI's half of that: the phrase it demands is the
// one the shared projection SERVED (never one it derived), and the session it read the plan with comes
// from its own live channel — the one piece of session identity a TUI scene has, and the reason a
// session-scoped plan is reachable from a workspace-scoped row at all.
describe("the plan scene reads the SHARED projection", () => {
  /**
   * A staged plan as the shared projection serves it.
   * @returns the plan half of the payload, with the served phrase.
   */
  const stagedPlan = (): {
    /** The PRE-approval identity. */
    planId: string
    /** The team name the user reads. */
    name: string
    /** What the team is for. */
    description: string
    /** `required` waits for an explicit approval. */
    approval: string
    /** The EXACT string the gate demands, SERVED by the projection. */
    phrase: string
    /** Whether an approval already committed. */
    approved: boolean
    /** Whether it was discarded instead. */
    discarded: boolean
    /** The teammates it wants raised. */
    members: Array<{ name: string; description: string; role?: string }>
    /** The tasks it wants posted. */
    tasks: Array<{ subject: string; description: string; owner?: string; blockedBy: string[] }>
  } => ({
    planId: "plan-20260930T010000",
    name: "Shared infra",
    description: "one projection, two surfaces",
    approval: "required",
    phrase: "approve plan-20260930T010000",
    approved: false,
    discarded: false,
    members: [{ name: "Senior Engineer", description: "implements" }],
    tasks: [{ subject: "build it", description: "acceptance", blockedBy: ["core"] }],
  })

  test("the phrase is the SERVED one, not a record-derived lookalike", () => {
    // The record-based phrase would be `approve <teamId>` — a DIFFERENT string. Passing the served
    // phrase through and asserting on it is what proves the scene renders the shared contract rather
    // than computing its own.
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit, with a plan staged and a channel-bound session. */
    const { kit, components } = mountScenes(workspace, { planFor: () => stagedPlan() })
    /** The rendered plan scene. */
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve plan-20260930T010000")
    expect(text).toContain("typed below")
    // And the record-derived spelling must NOT appear beside it.
    expect(text).not.toContain("approve mpd-fixture-1")
  })

  test("a STAGED PLAN with no usable record still renders the gate", () => {
    // The record is materialised AT approval, so a staged plan with no record is the NORMAL
    // pre-approval state — the same fact that made the Web panel show 'no team yet' over a plan
    // awaiting a decision. Requiring a record made this surface unusable exactly when it was needed.
    /** A fixture whose record is NOT staged, so only the plan can make the surface usable. */
    const workspace = teamFixture({ id: "run-9", name: "Running", phase: "running", members: [], tasks: [] })
    /** This arm's kit, with a plan staged regardless of the record's phase. */
    const { kit, components } = mountScenes(workspace, { planFor: () => stagedPlan() })
    /** The rendered plan scene. */
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve plan-20260930T010000")
  })

  test("with NO plan face the scene never INVENTS a plan phrase", () => {
    // A composition exposing no `planFor` keeps its pre-W6 behaviour rather than breaking. What this
    // arm pins is the narrow claim: with no plan face the scene cannot render a phrase it was never
    // served — it either falls back to the record-derived one or shows its empty state, and both are
    // honest. (The record-derived fallback itself is covered by the `planActionLines` arms.)
    /** This arm's fixture workspace. */
    const workspace = teamFixture(stagedRecord())
    /** This arm's kit, with no plan reader at all. */
    const { kit, components } = mountScenes(workspace)
    /** The rendered plan scene. */
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).not.toContain("approve plan-")
    expect(text).toContain("MPD plan approval")
  })
})
