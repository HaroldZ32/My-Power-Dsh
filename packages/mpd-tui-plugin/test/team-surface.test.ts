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
  APPROVE_TOOL,
  BOARD_SCENE_ID,
  DISCARD_TOOL,
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

/** A workspace holding ONE team record, written to disk and read back by the reader. */
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
  return workspace
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

describe("team-workflow projection (read-only, from a real record on disk)", () => {
  test("renders the staged roster, the task DAG, counts and mail from the file", () => {
    const workspace = teamFixture(stagedRecord(), {
      captainInbox: [
        JSON.stringify({ id: "a", from: "Architect", to: "captain", content: "contract frozen", ts: 1 }),
        JSON.stringify({ id: "b", from: "Reviewer", to: "captain", content: "ready to review", ts: 2, readAt: 3 }),
      ],
      memberInbox: {
        Architect: [JSON.stringify({ id: "c", from: "captain", to: "Architect", content: "go", ts: 4 })],
      },
    })
    const workflow = readTeamWorkflow(workspace)
    expect(workflow.team?.id).toBe("mpd-fixture-1")
    expect(workflow.team?.name).toBe("Fixture Team")
    expect(workflow.team?.phase).toBe("staged")
    expect(workflow.team?.staged).toBe(true)
    expect(workflow.team?.planReviewState).toBe("awaiting_review")
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
    // Only the UNREAD captain row counts (id b is read).
    expect(workflow.mail.unread).toBe(2)
    expect(workflow.mail.captainInbox.map((row) => row.from)).toEqual(["Architect", "Reviewer"])

    const rows = teamWorkflowLines(workflow).join("\n")
    expect(rows).toContain("team       Fixture Team (mpd-fixture-1)")
    expect(rows).toContain("phase      staged")
    expect(rows).toContain("plan       awaiting_review")
    expect(rows).toContain("Architect · architecture review · deepseek-official/deepseek-v4-flash · idle")
    expect(rows).toContain("t1 [requirements] freeze the contract · completed @Architect attempt 1 r1 verdict pass")
    expect(rows).toContain("t2 [implementation] build it · pending @Architect attempt 0 r1 deps=t1")
    // The optional `kind` is rendered as `-` when the record omits it.
    expect(rows).toContain("t3 [-] no kind here · failed attempt 2")
    expect(rows).toContain("3 total · 1 completed · 0 in progress · 1 pending · 0 claimed · 1 failed")
    expect(rows).toContain("mail       2 unread")
    // The hold row is omitted unless the watchdog reports THIS team as held.
    expect(rows).not.toContain("watchdog")
    expect(teamWorkflowLines(readTeamWorkflow(workspace, ["mpd-fixture-1"])).join("\n")).toContain("watchdog   HELD (mpd-fixture-1)")
    expect(teamWorkflowLines(readTeamWorkflow(workspace, ["other-team"])).join("\n")).not.toContain("watchdog")
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
    const workflow = readTeamWorkflow(workspace)
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
    const text = teamWorkflowLines(readTeamWorkflow(workspace)).join("\n")
    expect(text).toContain("t2 [-] second · pending deps=t1 BLOCKED")
  })

  test("a corrupt / absent / cyclic record renders an empty state and never throws", () => {
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-broken-"))
    temporary.push(root)
    const workspace = join(root, "workspace")
    mkdirSync(join(workspace, ".mpd", "team", "broken"), { recursive: true })
    writeFileSync(join(workspace, ".mpd", "team", "broken", "team.json"), "{ not json")
    const broken = readTeamWorkflow(workspace)
    expect(broken.team).toBeUndefined()
    expect(broken.problems.join(" ")).toContain("invalid JSON")
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
    const workflow = readTeamWorkflow(cyclic)
    expect(workflow.problems.some((problem) => problem.startsWith("cycle "))).toBe(true)
    expect(workflow.tasks.every((task) => Number.isInteger(task.depth))).toBe(true)
  })

  test("the REAL record of this session's own team projects without a hand-built object", () => {
    const path = join(REPO, ".mpd", "team", "mpd-default-8d65a2b2", "team.json")
    if (!existsSync(path)) return // absent in a fresh clone: the fixture tests above carry the load
    const workspace = join(REPO)
    const workflow = readTeamWorkflow(workspace)
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

  test("the board gains exactly the two T3 rows", () => {
    const workspace = teamFixture(stagedRecord())
    const state = readBoardState(workspace, process.env.HOME ?? workspace)
    const rows = boardLines(state)
    expect(rows).toContain("team-plan  awaiting_review")
    expect(rows).not.toContain("team-hold  held (mpd-fixture-1)")
    expect(boardLines(state, ["mpd-fixture-1"])).toContain("team-hold  held (mpd-fixture-1)")
    // A running team shows no team-plan row.
    const running = teamFixture({ id: "run-1", name: "Run", phase: "running", members: [], tasks: [] })
    expect(boardLines(readBoardState(running, running)).some((row) => row.startsWith("team-plan"))).toBe(false)
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
    expect(text).toContain("MPD team — Fixture Team")
    expect(text).toContain("mpd-fixture-1")
    expect(text).toContain("phase      staged")
    expect(text).toContain("Architect · architecture review")
    expect(text).toContain("t2 [implementation] build it · pending @Architect attempt 0 r1 deps=t1")
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

  test("a staged team opens the plan surface and `p` reaches the board", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components, opened } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    pressAndRender(kit, components[TEAM_SCENE_ID], "a")
    pressAndRender(kit, components[TEAM_SCENE_ID], "p")
    expect(opened).toContain(PLAN_SCENE_ID)
    expect(opened).toContain(BOARD_SCENE_ID)
  })

  test("a bare `r` refresh re-reads the record without throwing", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[TEAM_SCENE_ID])
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "r")
    expect(text).toContain("MPD team — Fixture Team")
  })

  test("N3 — Ctrl+X in the WORKFLOW scene does nothing (the key does not exist there)", async () => {
    const workspace = teamFixture(stagedRecord())
    const calls: unknown[] = []
    const actions: PlanActions = {
      available: () => true,
      approve: async (input) => {
        calls.push(input)
        return { ok: true }
      },
      discard: async () => {
        calls.push("discard")
        return { ok: true }
      },
    }
    const { kit, components, opened } = mountScenes(workspace, { actions })
    render(kit, components[TEAM_SCENE_ID])
    const text = pressAndRender(kit, components[TEAM_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    expect(calls).toEqual([])
    expect(opened).toEqual([])
    expect(text).toContain("MPD team — Fixture Team")
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
  test("shows the staged plan, the action block and an EMPTY confirmation echo", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("MPD plan approval — Fixture Team")
    expect(text).toContain("phase staged · review awaiting_review")
    expect(text).toContain("members    2 · tasks 3 · links 1")
    expect(text).toContain("runnable   yes")
    expect(text).toContain("edits      none")
    expect(text).toContain("approval needs the exact team id typed below, then Ctrl+X")
    expect(text).toContain("confirm    \n")
    expect(text).toContain("required   approve mpd-fixture-1")
    expect(text).toContain("to change this plan: press Esc and tell the captain what to change in the chat")
  })

  test("the precondition failure states the phase and offers only Esc", () => {
    const workspace = teamFixture({ id: "run-1", name: "Running", phase: "running", members: [], tasks: [] })
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("no staged plan for team run-1 (phase running)")
    expect(text).not.toContain("confirm")
    expect(text).not.toContain("approve ")
  })

  test("the precondition failure is READ-ONLY: no chord can mutate a non-staged team", async () => {
    // A team that is merely RUNNING must never be archivable from the approval surface:
    // the frozen §3.2 precondition accepts only Esc.
    const workspace = teamFixture({ id: "run-1", name: "Running", phase: "running", members: [], tasks: [] })
    const calls: unknown[] = []
    const actions: PlanActions = {
      available: () => true,
      approve: async (input) => {
        calls.push(input)
        return { ok: true }
      },
      discard: async () => {
        calls.push("discard")
        return { ok: true }
      },
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "a")
    await Bun.sleep(0)
    expect(calls).toEqual([])
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).not.toContain("DISCARD ARMED")
    expect(text).not.toContain("approved:")
  })

  test("N2 — Ctrl+X with an EMPTY echo performs no tool call", async () => {
    const workspace = teamFixture(stagedRecord())
    const calls: unknown[] = []
    const actions: PlanActions = {
      available: () => true,
      approve: async (input) => {
        calls.push(input)
        return { ok: true, value: { status: "running" } }
      },
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    const text = pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    expect(calls).toHaveLength(0)
    expect(text).toContain("confirmation does not match this team")
  })

  test("N1 — the phrase for a DIFFERENT team id is inert", () => {
    const workspace = teamFixture(stagedRecord())
    const calls: unknown[] = []
    const actions: PlanActions = {
      available: () => true,
      approve: async (input) => {
        calls.push(input)
        return { ok: true }
      },
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of "approve some-other-team") {
      pressAndRender(kit, components[PLAN_SCENE_ID], character)
    }
    const text = pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    expect(calls).toHaveLength(0)
    expect(text).toContain("confirmation does not match this team")
  })

  test("the exact phrase approves through the injected executor and reports the tool's own result", async () => {
    const workspace = teamFixture(stagedRecord())
    const calls: { teamId: string; confirmation: string; captainSessionId?: string }[] = []
    const actions: PlanActions = {
      available: () => true,
      approve: async (input) => {
        calls.push(input)
        return { ok: true, value: { status: "running", team_id: "mpd-fixture-1", members: 2, tasks: 3 } }
      },
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    // The executor is awaited; the settlement is visible on the next render.
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(calls).toEqual([{ teamId: "mpd-fixture-1", confirmation: "approve mpd-fixture-1", captainSessionId: "sess-1" }])
    expect(text).toContain("approved: mpd-fixture-1 running · members 2 · tasks 3")
  })

  test("a REFUSED tool result is rendered as a refusal, never as a success", async () => {
    const workspace = teamFixture(stagedRecord())
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: false, error: "team is already running" }),
      discard: async () => ({ ok: false, error: "no team" }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve failed: team is already running")
    expect(text).not.toContain("approved:")
  })

  test("an unavailable executor reports the tool as not registered", async () => {
    const workspace = teamFixture(stagedRecord())
    const actions: PlanActions = { available: () => false, approve: async () => ({ ok: true }), discard: async () => ({ ok: true }) }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain(`approve failed: ${APPROVE_TOOL} is not registered in this composition`)
    expect(text).not.toContain("approved:")
  })

  test("B5 — while a call is in flight EVERY key is ignored (single-flight)", async () => {
    const workspace = teamFixture(stagedRecord())
    const calls: unknown[] = []
    let settle: ((outcome: PlanActionOutcome) => void) | undefined
    const actions: PlanActions = {
      available: () => true,
      approve: (input) => {
        calls.push(input)
        // A call that stays in flight until the test settles it.
        return new Promise<PlanActionOutcome>((resolve) => {
          settle = resolve
        })
      },
      discard: async () => {
        calls.push("discard")
        return { ok: true }
      },
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    const working = pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    expect(working).toContain("working…")
    // Every one of these would mutate (or start a second call) if the guard were gone.
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "z")
    await Bun.sleep(0)
    expect(calls).toHaveLength(1)
    settle?.({ ok: true, value: { status: "running", team_id: "mpd-fixture-1", members: 2, tasks: 3 } })
    await Bun.sleep(0)
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("approved: mpd-fixture-1 running")
  })

  test("the echo is empty again after an `r` refresh (no prefill, no carry-over)", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[PLAN_SCENE_ID])
    for (const character of "approve mpd-fixture-1") pressAndRender(kit, components[PLAN_SCENE_ID], character)
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("approve mpd-fixture-1")
    // `r` is consent input once typing started (the phrase itself contains `r`), so the
    // unconditional refresh is the Ctrl+R chord.
    const text = pressAndRender(kit, components[PLAN_SCENE_ID], "r", { ctrl: true })
    expect(text).toContain("confirm    \n")
  })

  test("contract reconciliation: `r` refreshes while the echo is EMPTY, and never eats the phrase", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[PLAN_SCENE_ID])
    // An empty echo: `r` is the refresh key, and the echo stays empty.
    expect(pressAndRender(kit, components[PLAN_SCENE_ID], "r")).toContain("confirm    \n")
    // Once consent input starts, every printable key — `r` included — is appended,
    // otherwise `approve <teamId>` (which contains `r`) could never be typed.
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("confirm    approve mpd-fixture-1")
  })

  test("BSpace is the only editing key", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[PLAN_SCENE_ID])
    pressAndRender(kit, components[PLAN_SCENE_ID], "a")
    pressAndRender(kit, components[PLAN_SCENE_ID], "b")
    let text = pressAndRender(kit, components[PLAN_SCENE_ID], "", { backspace: true })
    expect(text).toContain("confirm    a\n")
    text = pressAndRender(kit, components[PLAN_SCENE_ID], "", { backspace: true })
    expect(text).toContain("confirm    \n")
  })

  test("discard is two-step: one Ctrl+D arms, a second inside the window calls the tool", async () => {
    const workspace = teamFixture(stagedRecord())
    let discards = 0
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: true }),
      discard: async () => {
        discards += 1
        return { ok: true }
      },
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    const armed = pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    expect(armed).toContain("DISCARD ARMED")
    expect(discards).toBe(0)
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    await Bun.sleep(0)
    expect(discards).toBe(1)
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("discarded: team archived")
  })

  test("any other key clears the discard arm", () => {
    const workspace = teamFixture(stagedRecord())
    const { kit, components } = mountScenes(workspace)
    render(kit, components[PLAN_SCENE_ID])
    expect(pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })).toContain("DISCARD ARMED")
    expect(pressAndRender(kit, components[PLAN_SCENE_ID], "z")).not.toContain("DISCARD ARMED")
  })

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
    const workflow = readTeamWorkflow(workspace)
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

  test("a tool error carrying ESC/OSC does NOT survive into the rendered row", async () => {
    const workspace = teamFixture(stagedRecord())
    const hostile = "\u001b[31mRED\u001b[0m\u001b]0;pwned\u0007 plain"
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: false, error: hostile }),
      discard: async () => ({ ok: false, error: hostile }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve failed:")
    // The visible remainder is kept (the message is still readable)...
    expect(text).toContain("pwned")
    expect(text).toContain("plain")
    // ...but no escape sequence reached the host's Text element.
    for (const control of ["\u001b", "\u0007", "\u009b", "\u001b]"]) expect(text).not.toContain(control)
  })

  // skipped on win32: a directory whose name carries C0 control characters cannot exist there
  // (mkdir answers ENOENT, not a policy refusal), so the hostile-name direction has no fixture.
  // The ESC-in-a-tool-error arm above exercises the same render boundary (safeLine) everywhere.
  test.skipIf(process.platform === "win32")("a control character in a team DIRECTORY name cannot reach a rendered row", () => {
    // The second untrusted direction: the record/directory name feeds the problem notes.
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-hostile-dir-"))
    temporary.push(root)
    const workspace = join(root, "workspace")
    mkdirSync(join(workspace, ".mpd", "team", "bad\u001bname\u0007"), { recursive: true })
    mkdirSync(join(workspace, ".mpd", "team", "ok"), { recursive: true })
    writeFileSync(
      join(workspace, ".mpd", "team", "ok", "team.json"),
      JSON.stringify({ id: "ok", name: "ok", phase: "running", members: [], tasks: [] }),
    )
    // The board (which renders the problem notes) goes through the same boundary.
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[BOARD_SCENE_ID])
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
    const workflow = readTeamWorkflow(workspace)
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
  test("a refused approve KEEPS the echo", async () => {
    const workspace = teamFixture(stagedRecord())
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: false, error: "team is already running" }),
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve failed: team is already running")
    // §4.5: "the echo stays, the scene stays open, nothing was written".
    expect(text).toContain("confirm    approve mpd-fixture-1")
  })

  test("a successful approve CONSUMES the echo", async () => {
    const workspace = teamFixture(stagedRecord())
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: true, value: { status: "running", team_id: "mpd-fixture-1", members: 2, tasks: 3 } }),
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approved: mpd-fixture-1 running")
    expect(text).toContain("confirm    \n")
  })
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

  test("the verdict renders even though the record has LEFT the staged phase", async () => {
    const workspace = teamFixture(stagedRecord())
    const recordPath = join(workspace, ".mpd", "team", "mpd-fixture-1", "team.json")
    // The record flip is what makes this test bite: without it the OLD (broken) code
    // would still render the message through the action block and pass.
    const actions: PlanActions = {
      available: () => true,
      approve: async () => {
        flipper(recordPath)()
        return { ok: true, value: { status: "running", team_id: "mpd-fixture-1", members: 2, tasks: 3 } }
      },
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    const rows = text.split("\n").map((row) => row.trim())

    // The record really left the staged phase, so this IS the non-usable branch.
    expect(readTeamWorkflow(workspace).team?.staged).toBe(false)
    expect(readTeamWorkflow(workspace).team?.phase).toBe("running")

    // 1. the frozen §4.5 verdict line: team id + resulting phase + the runtime's counts.
    expect(rows).toContain("approved: mpd-fixture-1 running · members 2 · tasks 3")
    // 2. it is the FIRST body row — the surface cannot read as "nothing to approve".
    expect(rows.findIndex((row) => row.startsWith("approved:"))).toBe(1)
    // 3. the empty state is NOT what the user gets after a committed approval.
    expect(text).not.toContain("no staged plan for team mpd-fixture-1")
    // 4. the re-read phase is still stated, and the exit hint is present.
    expect(text).toContain("team mpd-fixture-1 · phase running")
    expect(text).toContain("esc back")
    // 5. the verdict survives a re-render (the 2 s refresh must not eat it).
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("approved: mpd-fixture-1 running")
  })

  test("a COMMITTED discard reports its own verdict", async () => {
    const workspace = teamFixture(stagedRecord())
    const actions: PlanActions = {
      available: () => true,
      approve: async () => ({ ok: true }),
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    pressAndRender(kit, components[PLAN_SCENE_ID], "d", { ctrl: true })
    await Bun.sleep(0)
    expect(render(kit, components[PLAN_SCENE_ID])).toContain("discarded: team archived")
  })

  test("with NO settled outcome the precondition failure is UNCHANGED (no verdict row)", () => {
    const workspace = teamFixture({ id: "run-1", name: "Running", phase: "running", members: [], tasks: [] })
    const { kit, components } = mountScenes(workspace)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("no staged plan for team run-1 (phase running)")
    expect(text).toContain("esc back")
    expect(text).not.toContain("approved:")
    expect(text).not.toContain("discarded:")
  })

  test("a REFUSED call in the non-usable branch reports the refusal, never a success", async () => {
    // The other settled outcome that can meet a non-usable record: the plan was approved
    // elsewhere between the read and the call.
    const workspace = teamFixture(stagedRecord())
    const recordPath = join(workspace, ".mpd", "team", "mpd-fixture-1", "team.json")
    const actions: PlanActions = {
      available: () => true,
      approve: async () => {
        flipper(recordPath)()
        return { ok: false, error: "team is already running" }
      },
      discard: async () => ({ ok: true }),
    }
    const { kit, components } = mountScenes(workspace, { actions })
    render(kit, components[PLAN_SCENE_ID])
    for (const character of approvalPhrase("mpd-fixture-1")) pressAndRender(kit, components[PLAN_SCENE_ID], character)
    pressAndRender(kit, components[PLAN_SCENE_ID], "x", { ctrl: true })
    await Bun.sleep(0)
    const text = render(kit, components[PLAN_SCENE_ID])
    expect(text).toContain("approve failed: team is already running")
    expect(text).not.toContain("approved: mpd-fixture-1")
  })
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

  test("the frozen tool names are the adopted ones", () => {
    expect(APPROVE_TOOL).toBe("agent_teams_approve")
    expect(DISCARD_TOOL).toBe("agent_teams_delete")
    expect(approvalPhrase("mpd-default-8d65a2b2")).toBe("approve mpd-default-8d65a2b2")
  })

  test("the mailbox key normalization matches the adopted reader", () => {
    expect(mailboxKey("Senior Engineer")).toBe("senior-engineer")
    expect(mailboxKey("captain")).toBe("captain")
    expect(mailboxKey("中文 名")).toBe("中文-名")
  })
})
