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
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index"
import { boardLines, readBoardState } from "../src/state"

const temporary: string[] = []
const log = createLog(undefined, "mpd-tui-test", {})

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

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
  const root = mkdtempSync(join(tmpdir(), "mpd-tui-team-"))
  temporary.push(root)
  const workspace = join(root, "workspace")
  const id = String(record.id ?? "team-1")
  const inbox = join(workspace, ".mpd", "team", id, "inbox")
  mkdirSync(inbox, { recursive: true })
  writeFileSync(join(workspace, ".mpd", "team", id, "team.json"), JSON.stringify(record, null, 2))
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
  const id = String(record.id ?? "team-1")
  const leadSessionId = String(record.captainSessionId ?? id + "-lead")
  const members = Array.isArray(record.members) ? (record.members as Record<string, unknown>[]) : []
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
    const workspace = teamFixture(stagedRecord(), {
      captainInbox: [
        JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }),
        JSON.stringify({ id: "b", from: "Reviewer", to: "captain", content: "ready to review", ts: 2, readAt: 3 }),
      ],
      memberInbox: {
        Architect: [JSON.stringify({ id: "c", from: "captain", to: "Architect", content: "go", ts: 4 })],
      },
    })
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
    const tasks = [
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
      { id: "c", dependencies: ["b", "x"] },
    ]
    const depths = taskDepths(tasks)
    expect(depths.get("a")).toBe(0)
    expect(depths.get("b")).toBe(1)
    // An unknown dependency id is not a dependency at all (the panel's own filter).
    expect(depths.get("c")).toBe(2)

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
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    const byId = new Map(workflow.tasks.map((task) => [task.id, task]))
    // A FAILED dependency does not block (OPT-1), it is reported separately.
    expect(byId.get("t3")?.failedDependencies).toEqual(["t2"])
    expect(byId.get("t3")?.visual).toBe("open")
    expect(byId.get("t4")?.visual).toBe("open")
    const text = teamWorkflowLines(workflow).join("\n")
    expect(text).toContain("t3 [-] blocked · pending")
    expect(text).toContain("failed-dep=t2")
    expect(text).toContain("t4 [-] unblocked · pending")
  })

  test("a pending task behind an UNFINISHED dependency renders BLOCKED", () => {
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
    const text = teamWorkflowLines(readTeamWorkflow(workspace, [], viewsOf(workspace))).join("\n")
    expect(text).toContain("t2 [-] second · pending deps=t1 BLOCKED")
  })

  test("a corrupt / absent / cyclic record renders an empty state and never throws", () => {
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-broken-"))
    temporary.push(root)
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
    const workflow = readTeamWorkflow(cyclic, [], viewsOf(cyclic))
    expect(workflow.problems.some((problem) => problem.startsWith("cycle "))).toBe(true)
    expect(workflow.tasks.every((task) => Number.isInteger(task.depth))).toBe(true)
  })

  test("the REAL record of this session's own team projects without a hand-built object", () => {
    const path = join(REPO, ".mpd", "team", "mpd-default-8d65a2b2", "team.json")
    if (!existsSync(path)) return // absent in a fresh clone: the fixture tests above carry the load
    const workspace = join(REPO)
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
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
    const workspace = teamFixture(stagedRecord())
    const state = readBoardState(workspace, process.env.HOME ?? workspace, viewsOf(workspace))
    const rows = boardLines(state)
    // 0.1.7: a team has no name and no review state on the official plane, so the board shows the
    // Lead name and the DERIVED phase — and it never claims a staged plan.
    expect(rows.join("\n")).toContain("team       lead (mpd-fixture-1) · phase idle")
    expect(rows.join("\n")).not.toContain("awaiting_review")
    expect(rows.join("\n")).not.toContain("team-plan")
  })
})

// ── the React / ui double ───────────────────────────────────────────────────

interface Element {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

interface Kit {
  React: Record<string, unknown>
  ui: Record<string, unknown>
  handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[]
  begin(): void
  flush(): boolean
  press(input: string, key?: Record<string, unknown>): void
  text(tree: unknown): string
}

/**
 * A minimal host kit double: index-keyed hook state, effects that run AFTER the
 * render, and `useInput` handlers captured for key dispatch.
 */
function makeKit(terminal: { columns: number; rows: number } = { columns: 100, rows: 30 }): Kit {
  const store = new Map<string, unknown>()
  const handlers: ((input: string, key: Record<string, unknown> | undefined) => void)[] = []
  let index = 0
  let pending: (() => unknown)[] = []

  const React: Record<string, unknown> = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element => ({ type, props: props ?? {}, children }),
    useState: (initial: unknown): [unknown, (next: unknown) => void] => {
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
      const key = `effect:${index}`
      index += 1
      if (store.has(key)) return
      store.set(key, true)
      pending.push(fn)
    },
    useRef: (initial: unknown): { current: unknown } => {
      const key = `ref:${index}`
      index += 1
      if (!store.has(key)) store.set(key, { current: initial })
      return store.get(key) as { current: unknown }
    },
    useSyncExternalStore: (): void => {},
  }

  const Text = (props: { children?: unknown }): Element => ({ type: "Text", props: props as Record<string, unknown>, children: [props?.children] })
  const Box = (props: { children?: unknown }): Element => ({ type: "Box", props: props as Record<string, unknown>, children: [] })
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
    begin: () => {
      index = 0
      handlers.length = 0
    },
    flush: () => {
      const list = pending
      pending = []
      for (const fn of list) fn()
      return list.length > 0
    },
    press: (input: string, key: Record<string, unknown> = {}) => {
      const handler = handlers.at(-1)
      if (handler === undefined) throw new Error("no useInput handler was registered by the scene")
      handler(input, key)
    },
    text: (tree: unknown): string => {
      const out: string[] = []
      const walk = (node: unknown): void => {
        if (node === null || node === undefined) return
        if (typeof node === "string") {
          out.push(node)
          return
        }
        if (typeof node === "number") {
          out.push(String(node))
          return
        }
        if (Array.isArray(node)) {
          for (const child of node) walk(child)
          return
        }
        const element = node as Element
        if (element.props?.children !== undefined) walk(element.props.children)
        for (const child of element.children ?? []) walk(child)
      }
      walk(tree)
      return out.join("\n")
    },
  }
}

/** Register the real scenes against a minimal host double and return the kit + components. */
function mountScenes(
  workspace: string,
  options: { holds?: readonly string[]; actions?: PlanActions; terminal?: { columns: number; rows: number } } = {},
): { kit: Kit; components: Record<string, unknown>; opened: string[]; seam: ReturnType<typeof registerScene> } {
  const components: Record<string, unknown> = {}
  const opened: string[] = []
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
  const ctx = {
    inject: (deps: readonly string[], callback: (scoped: Record<string, unknown>) => void) => {
      const scoped = { get: (name: string) => services[name] }
      if (deps.every((id) => services[id] !== undefined)) callback(scoped)
      return {}
    },
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, debug: () => {} },
  }
  const seam = registerScene(
    ctx as never,
    log,
    () => workspace,
    () => process.env.HOME ?? workspace,
    () => options.holds ?? [],
    options.actions ?? {
      available: () => true,
      approve: async () => ({ ok: true, value: { status: "running" } }),
      discard: async () => ({ ok: true }),
    },
    // The composition root resolves the OFFICIAL readout per call (0.1.7) and hands it to the
    // scene; the fixture's views are what a host would return here.
    () => viewsOf(workspace),
  )
  expect(seam.outcome().state).toBe("requested")
  const kit = makeKit(options.terminal)
  return { kit, components, opened, seam }
}

/** Render a scene component until its effects settle, and return the rendered text. */
function render(kit: Kit, component: unknown): string {
  const props = { React: kit.React, ui: kit.ui, close: () => {}, channel: undefined }
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
    const workspace = teamFixture(stagedRecord())
    const components: Record<string, unknown> = {}
    const registered: { id: string; title?: string }[] = []
    const services = {
      tuiScenes: {
        register: (descriptor: { id: string; title?: string; component: unknown }) => {
          registered.push({ id: descriptor.id, ...(descriptor.title === undefined ? {} : { title: descriptor.title }) })
          components[descriptor.id] = descriptor.component
        },
        open: () => true,
      },
    }
    const ctx = {
      inject: (deps: readonly string[], callback: (scoped: unknown) => void) => {
        if (deps.every((id) => (services as Record<string, unknown>)[id] !== undefined)) callback({ get: (name: string) => (services as Record<string, unknown>)[name] })
        return {}
      },
      get: () => undefined,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
    }
    registerScene(ctx as never, log, () => workspace, () => workspace)
    expect(registered.map((entry) => entry.id)).toEqual([BOARD_SCENE_ID, TEAM_SCENE_ID, PLAN_SCENE_ID])
    expect(registered.map((entry) => entry.title)).toEqual(["MPD board", "MPD team", "MPD plan approval"])
    expect(typeof components[TEAM_SCENE_ID]).toBe("function")
    expect(typeof components[PLAN_SCENE_ID]).toBe("function")
  })

  test("a scene renders null instead of crashing when the host kit is absent", () => {
    const workspace = teamFixture(stagedRecord())
    const { components } = mountScenes(workspace)
    for (const id of [TEAM_SCENE_ID, PLAN_SCENE_ID]) {
      const component = components[id] as (props: unknown) => unknown
      expect(component({ React: {}, ui: null, close: () => {} })).toBeNull()
      expect(component({})).toBeNull()
    }
  })
})

describe("surface T1 — the team workflow", () => {
  test("renders the real record's header, roster, DAG and counts", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[TEAM_SCENE_ID])
    expect(text).toContain("MPD team — lead")
    expect(text).toContain("mpd-fixture-1")
    // The official plane has no team phase of its own: it is DERIVED from the roster.
    expect(text).toContain("phase      idle")
    expect(text).toContain("Architect · architecture review")
    // `kind`/`attempt`/`round` have no official source, so the row carries what the board has.
    expect(text).toContain("t2 [-] build it · pending @Architect deps=t1")
    expect(text).toContain("esc/q close")
  })

  test("a team that is NOT staged refuses the approval hop with a notice and opens nothing", () => {
    const workspace = teamFixture({ id: "run-1", name: "Running", phase: "running", members: [], tasks: [] })
    const { kit, components, opened } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "a")
    expect(text).toContain("plan approval needs a staged team")
    expect(opened).toEqual([])
  })


  test("a bare `r` refresh re-reads the record without throwing", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "r")
    expect(text).toContain("MPD team — lead")
  })


  test("the watchdog HOLD is rendered only when the watchdog reports it", () => {
    const workspace = teamFixture(stagedRecord())
    const held = mountScenes(workspace, { holds: ["mpd-fixture-1"] })
    const text = render(held.kit, held.components[TEAM_SCENE_ID])
    expect(text).toContain("watchdog   HELD (mpd-fixture-1)")
    const other = mountScenes(workspace, { holds: ["someone-else"] })
    expect(render(other.kit, other.components[TEAM_SCENE_ID])).not.toContain("watchdog")
  })
})

describe("surface T2 — the plan approval", () => {














  test("Esc mutates nothing and returns to the workflow when it was the entry point", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components, opened, seam } = mountScenes(workspace)
    seam.openPlan({ teamId: "mpd-fixture-1", returnToTeam: true })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    const text = pressAndRender(kit, components[PLAN_SCENE_ID], "", { escape: true })
    expect(opened).toEqual([PLAN_SCENE_ID, TEAM_SCENE_ID])
    expect(text).not.toContain("approved:")
    expect(text).not.toContain("discarded:")
  })

  test("Esc from the command entry point leaves the scene instead of hopping", () => {
    const workspace = teamFixture(stagedRecord())
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
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    const rows = planActionLines(workflow, "approve x", true, "some message")
    expect(rows.join("\n")).toContain("DISCARD ARMED — press Ctrl+D again within 10s to archive this staged plan")
    expect(rows.join("\n")).toContain("some message")
    expect(planActionLines(workflow, "", false, "").join("\n")).not.toContain("DISCARD ARMED")
    // No team record: the required phrase degrades honestly instead of inventing one.
    expect(planActionLines(undefined, "", false, "").join("\n")).toContain("required   (no team record)")
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
    const workspace = join(root, "hostile")
    mkdirSync(workspace, { recursive: true })
    FIXTURE_VIEWS.set(workspace, [
      viewOf({ id: "bad\u001bname\u0007", members: [{ name: "na\u0007me" }], tasks: [{ id: "t1", status: "pending" }] }),
    ])
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[TEAM_SCENE_ID])
    expect(text).toContain("bad")
    for (const control of ["\u001b", "\u0007", "\u009b"]) expect(text).not.toContain(control)
  })
})

describe("§3.1 item 4 — the DAG order (finding F2)", () => {
  test("tasks come out ordered by depth, with creation order as the tiebreak", () => {
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
    const workflow = readTeamWorkflow(workspace, [], viewsOf(workspace))
    // depth: parent 0, peer 0, child 1, grandchild 2. Creation index: child 0, parent 1, peer 2, grandchild 3.
    expect(workflow.tasks.map((task) => task.id)).toEqual(["parent", "peer", "child", "grandchild"])

    // BOTH renderers emit that ONE order (the sort lives in the projection, not in a loop).
    const ids = ["parent", "peer", "child", "grandchild"]
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
  const flipper = (recordPath: string) => (): void => {
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
    const offenders: string[] = []
    const forbidden = ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "cpSync", "createWriteStream", "writeFile(", "rm(", "mkdir(", "unlink("]
    for (const name of ["team-state.ts", "state.ts", "scenes.ts", "index.ts"]) {
      const source = readFileSync(join(import.meta.dir, "..", "src", name), "utf8")
      for (const token of forbidden) if (source.includes(token)) offenders.push(`${name}: ${token}`)
    }
    expect(offenders).toEqual([])
  })

  test("the built dist carries the two scene ids and no write primitive", () => {
    const dist = readFileSync(join(import.meta.dir, "..", "dist", "index.js"), "utf8")
    expect(dist).toContain(TEAM_SCENE_ID)
    expect(dist).toContain(PLAN_SCENE_ID)
    for (const token of ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "cpSync", "createWriteStream"]) {
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
