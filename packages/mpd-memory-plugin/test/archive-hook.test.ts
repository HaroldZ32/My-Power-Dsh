// THE PROJECT-ARCHIVE HOOK (wave W3-D, decision D6): one post-execute listener that turns a closed
// project into a deterministic digest in the GLOBAL memory store.
//
// The arms drive the REAL registration path: they mount the plugin, take the listener the adapter
// registered on `tools/post-execute`, and invoke it the way the harness waterfall does (with a `next()`
// that answers an accept decision). Every arm runs with HOME sandboxed (T-43), so the real
// `~/.mpd/memory` can never be written from here.
import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { enterSandboxHome, mount, sandbox } from "./support.ts"

/** Every throwaway directory this file created, removed once the suite ends. */
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

/** A fresh throwaway directory, tracked for cleanup. */
function scratch(prefix: string): string {
  /** The directory mkdtemp just created. */
  const dir = sandbox(prefix)
  created.push(dir)
  return dir
}

/** Write one fixture file, creating its parent directories. */
function fixture(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** Write one JSON fixture file, creating its parent directories. */
function jsonFixture(path: string, value: unknown): void {
  fixture(path, JSON.stringify(value, null, 2))
}

/** The global store's entry directory under one sandbox home. */
function globalMemoryDir(home: string): string {
  return join(home, ".mpd", "memory", "repo", "memory")
}

/** The global store's markdown entries, sorted. */
function globalEntries(home: string): string[] {
  return existsSync(globalMemoryDir(home)) ? readdirSync(globalMemoryDir(home)).filter((name) => name.endsWith(".md")).sort() : []
}

/** The global store's project index, or undefined when no archive event ever ran. */
function readIndex(home: string): any {
  /** The index file's path. */
  const path = join(home, ".mpd", "memory", "runtime", "index.json")
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined
}

/** The global store's journal records, parsed one per line. */
function journalRecords(home: string): any[] {
  /** The journal file's path. */
  const path = join(home, ".mpd", "memory", "runtime", "journal.jsonl")
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line))
}

/** Split one written entry into its JSON frontmatter and its body. */
function parseEntry(file: string): { meta: any; body: string } {
  /** The entry's whole text. */
  const raw = readFileSync(file, "utf8")
  /** Offset of the closing delimiter of the JSON frontmatter block. */
  const end = raw.indexOf("\n---\n", 4)
  return { meta: JSON.parse(raw.slice(4, end)), body: raw.slice(end + 5) }
}

/**
 * Write the boulder fixtures one completed work needs: the ledger plus its plan file.
 *
 * @param workspace - the workspace root the ledger lives under.
 * @param workId - the work id the ledger records.
 * @param planRel - the plan's workspace-relative path, as the ledger stores it.
 * @param taskTitle - the plan's first TODO title, so a supersede arm can prove the file was overwritten.
 */
function boulderFixture(workspace: string, workId: string, planRel: string, taskTitle: string): void {
  jsonFixture(join(workspace, ".mpd", "boulder.json"), {
    schema_version: 2,
    active_work_id: workId,
    works: {
      [workId]: {
        work_id: workId,
        active_plan: planRel,
        plan_name: "refactor",
        status: "completed",
        started_at: "2026-11-01T00:00:00.000Z",
        ended_at: "2026-11-01T00:10:00.000Z",
        elapsed_ms: 600000,
        session_ids: ["dsh:current"],
        task_sessions: {
          "1": { task_key: "1", task_label: "1. " + taskTitle, task_title: taskTitle, session_id: "dsh:current", status: "completed", updated_at: "2026-11-01T00:05:00.000Z" },
        },
      },
    },
  })
  fixture(join(workspace, planRel), "# plan\n\n## TODOs\n\n- [x] 1. " + taskTitle + "\n- [ ] 2. Leave the second item open\n")
  jsonFixture(join(workspace, "mpd-gates.json"), { version: 1, gates: {} })
}

test("(c1) mpd_boulder_complete records one global digest under the work id, through the real listener", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-hook-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-hook-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  boulderFixture(workspace, "work-a", ".mpd/plans/refactor.md", "Alpha task")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git" })
  try {
    // EXACTLY ONE listener is installed, on the post-execute waterfall.
    expect(plugin.listeners.length).toBe(1)
    expect(plugin.listeners[0].event).toBe("tools/post-execute")
    /** What the waterfall answered: the listener returns nothing, so the downstream accept passes through. */
    const decision = await plugin.listeners[0].run(
      { name: "mpd_boulder_complete", arguments: { workId: "work-a" } },
      { isError: false, value: { workId: "work-a", status: "completed", elapsedMs: 600000 } },
    )
    expect(decision).toEqual({ kind: "accept" })
    /** The entries the global store now holds. */
    const entries = globalEntries(home)
    expect(entries.length).toBe(1)
    expect(entries[0].startsWith("project-work-a-")).toBe(true)
    /** The written digest, as the file carries it. */
    const entry = parseEntry(join(globalMemoryDir(home), entries[0]))
    expect(entry.meta.kind).toBe("fact")
    expect(entry.meta.scope).toBe("global")
    expect(entry.meta.tags).toEqual(["project", "archive", "boulder_complete"])
    expect(entry.meta.description).toBe("project archive: work-a (boulder_complete)")
    // The four body sections the contract fixes, and the facts this arm's fixtures make readable.
    expect(entry.body).toContain("## What was built")
    expect(entry.body).toContain("boulder work work-a")
    expect(entry.body).toContain("Alpha task")
    expect(entry.body).toContain("## Proof")
    expect(entry.body).toContain("gate table mpd-gates.json sha256=")
    expect(entry.body).toContain("## Where")
    expect(entry.body).toContain("the event's sources declare no write scopes")
    expect(entry.body).toContain("## Open")
    expect(entry.body).toContain("1 plan item(s) still unticked in .mpd/plans/refactor.md")
    // The key is namespaced by the WORKSPACE, so two workspaces never collide in the shared store.
    expect(readIndex(home).entries[resolve(workspace) + ":work-a"].eventKind).toBe("boulder_complete")
    expect(journalRecords(home).some((record) => record.kind === "archive" && record.projectKey === "work-a")).toBe(true)
    // The digest was committed through the configured VCS backend, exactly like a memory write.
    /** The global repository's tip subject, read with the real git CLI. */
    const log = spawnSync("git", ["log", "-1", "--pretty=%s"], { cwd: join(home, ".mpd", "memory", "repo"), encoding: "utf8" })
    expect(log.status).toBe(0)
    expect(log.stdout).toContain("memory: project archive work-a (boulder_complete)")
  } finally {
    plugin.restore()
    leave()
  }
})

test("(d) a second event on the same key overwrites ONE entry and journals `superseded`", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-supersede-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-supersede-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  boulderFixture(workspace, "work-b", ".mpd/plans/refactor.md", "Alpha task")
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git" })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    /** Run one completed-work event for this arm's work id. */
    const fire = async (): Promise<unknown> => listener.run(
      { name: "mpd_boulder_complete", arguments: { workId: "work-b" } },
      { isError: false, value: { workId: "work-b", status: "completed" } },
    )
    await fire()
    expect(globalEntries(home).length).toBe(1)
    // The SECOND close of the same project: the plan changed, so the overwritten digest must show it.
    boulderFixture(workspace, "work-b", ".mpd/plans/refactor.md", "Beta task")
    await fire()
    /** The entries after the second event: still exactly one, because the key owns one file. */
    const entries = globalEntries(home)
    expect(entries.length).toBe(1)
    /** The entry after the supersede. */
    const entry = parseEntry(join(globalMemoryDir(home), entries[0]))
    expect(entry.body).toContain("Beta task")
    expect(entry.body).not.toContain("Alpha task")
    // The FACT of the second event survives in the journal and in the index row.
    expect(journalRecords(home).some((record) => record.kind === "superseded" && record.by === "boulder_complete")).toBe(true)
    expect(readIndex(home).entries[resolve(workspace) + ":work-b"].superseded).toBe(1)
  } finally {
    plugin.restore()
    leave()
  }
})

test("(c2) cellwork_stop records one global digest under the cell id, and a REFUSED stop records nothing", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-cell-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-cell-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  jsonFixture(join(workspace, ".mpd", "cellwork", "cell-x", "state.json"), {
    version: 1,
    cellId: "cell-x",
    phase: "stopped",
    archived: true,
    objective: "ship the wave",
    stopReason: "wave merged",
    teamId: "",
    requirementsRevision: 1,
    splitRevision: 1,
    subcellIds: [],
  })
  jsonFixture(join(workspace, ".mpd", "cellwork", "cell-x", "split", "1.json"), {
    version: 1,
    cellId: "cell-x",
    revision: 1,
    accepted: false,
    tasks: [
      { key: "T1", subject: "Write the store", writeScopes: ["packages/x/src"], accepted: true },
      { key: "T2", subject: "Verify the store", writeScopes: ["packages/x/test"], accepted: false },
    ],
    findings: [{ kind: "scope-overlap", message: "T1 and T2 overlap" }],
  })
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git" })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    // A REFUSED stop answers `{ok:false}` instead of throwing; it closed no project, so nothing is written.
    await listener.run({ name: "cellwork_stop", arguments: {} }, { isError: false, value: { ok: false, error: "cellwork_stop refused: live tasks" } })
    expect(existsSync(join(home, ".mpd", "memory"))).toBe(false)
    // An ACCEPTED stop of the same cell is a closed project.
    await listener.run({ name: "cellwork_stop", arguments: { reason: "wave merged" } }, { isError: false, value: { ok: true, cellId: "cell-x", archived: true, forced: false, reason: "wave merged" } })
    /** The single entry the accepted stop produced. */
    const entries = globalEntries(home)
    expect(entries.length).toBe(1)
    expect(entries[0].startsWith("project-cell-x-")).toBe(true)
    /** The written digest. */
    const entry = parseEntry(join(globalMemoryDir(home), entries[0]))
    expect(entry.meta.tags).toEqual(["project", "archive", "cellwork_stop"])
    expect(entry.body).toContain("cell cell-x")
    expect(entry.body).toContain("ship the wave")
    expect(entry.body).toContain("Write the store")
    expect(entry.body).toContain("packages/x/src")
    expect(entry.body).toContain("stopReason: wave merged")
    expect(entry.body).toContain("split task T2 (Verify the store) was not accepted")
    expect(entry.body).toContain("split finding: T1 and T2 overlap")
    expect(readIndex(home).entries[resolve(workspace) + ":cell-x"].eventKind).toBe("cellwork_stop")
    // The failed-event filter: an ERROR result of the same tool never records anything.
    await listener.run({ name: "cellwork_stop", arguments: {} }, { isError: true, value: { ok: true, cellId: "cell-x" } })
    expect(globalEntries(home).length).toBe(1)
  } finally {
    plugin.restore()
    leave()
  }
})

test("(c3) an approved team-plan delete records the plan + team digest under the team id", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-plan-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-plan-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The archive directory the delete reports, and the plan document it wrote. */
  const archiveDir = join(workspace, ".mpd", "team", "archive", "plan-1")
  jsonFixture(join(archiveDir, "plan.json"), {
    version: 2,
    planId: "plan-1",
    sessionId: "session-1",
    name: "wave-x",
    description: "ship the refactor",
    approval: "required",
    members: [],
    tasks: [
      { subject: "Build the store", writeScopes: ["packages/m/src"] },
      { subject: "Document it", writeScopes: ["packages/m/README.md"] },
    ],
    stagedAt: "2026-11-01T00:00:00.000Z",
    approvedAt: "2026-11-01T00:01:00.000Z",
    created: { members: [], tasks: [], unresolved: [{ taskId: "T2", references: ["T9"] }] },
  })
  /** The `mpdTeams` stub this arm mounts: the plan listing plus the live team record. */
  const teams = {
    /** The archived plans the hook matches the delete against. */
    archivedPlans: (): unknown[] => [{ planId: "plan-1", approvedAt: "2026-11-01T00:01:00.000Z", teamId: "team-1", path: join(archiveDir, "plan.json") }],
    /** The live team record, which adds the board states the archived plan cannot know. */
    get: (_workspace: string, teamId: string): unknown => teamId === "team-1"
      ? {
        teamId: "team-1",
        name: "wave-x",
        tasks: [
          { id: "T1", subject: "Build the store", status: "completed", writeScopes: ["packages/m/src"] },
          { id: "T2", subject: "Document it", status: "pending", blockedBy: ["T1"], writeScopes: ["packages/m/README.md"] },
        ],
      }
      : undefined,
  }
  /** The mounted plugin under test, with the team service. */
  const plugin = mount(workspace, { vcs: "git" }, { teams })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    await listener.run({ name: "agent_teams_plan", arguments: { action: "delete" } }, { isError: false, value: { archivedTo: archiveDir } })
    /** The single entry the approved delete produced. */
    const entries = globalEntries(home)
    expect(entries.length).toBe(1)
    expect(entries[0].startsWith("project-team-1-")).toBe(true)
    /** The written digest. */
    const entry = parseEntry(join(globalMemoryDir(home), entries[0]))
    expect(entry.meta.tags).toEqual(["project", "archive", "team_plan_archive"])
    expect(entry.body).toContain("team plan plan-1")
    expect(entry.body).toContain("ship the refactor")
    expect(entry.body).toContain("Build the store")
    expect(entry.body).toContain("Document it")
    expect(entry.body).toContain("packages/m/src")
    expect(entry.body).toContain("T2 (Document it) status=pending, blocked by T1")
    expect(entry.body).toContain("unresolved blocker reference(s) on T2: T9")
    // The key is the TEAM id (the plan's team link), namespaced by the workspace.
    expect(readIndex(home).entries[resolve(workspace) + ":team-1"].eventKind).toBe("team_plan_archive")
  } finally {
    plugin.restore()
    leave()
  }
})

test("(e) a delete of an UNAPPROVED plan writes nothing (the approval filter)", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-unapproved-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-unapproved-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The archive directory of the unapproved plan. */
  const archiveDir = join(workspace, ".mpd", "team", "archive", "plan-2")
  jsonFixture(join(archiveDir, "plan.json"), { version: 2, planId: "plan-2", sessionId: "session-2", name: "never-approved", description: "discarded", approval: "required", members: [], tasks: [], stagedAt: "2026-11-01T00:00:00.000Z", discardedAt: "2026-11-01T00:02:00.000Z" })
  /** The `mpdTeams` stub whose listing carries NO approvedAt for this plan. */
  const teams = {
    /** The archived plans the hook matches the delete against. */
    archivedPlans: (): unknown[] => [{ planId: "plan-2", path: join(archiveDir, "plan.json") }],
  }
  /** The mounted plugin under test, with the team service. */
  const plugin = mount(workspace, { vcs: "git" }, { teams })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    /** What the waterfall answered: an unapproved archive is not a project, so the hook is a no-op. */
    const decision = await listener.run({ name: "agent_teams_plan", arguments: { action: "delete" } }, { isError: false, value: { archivedTo: archiveDir } })
    expect(decision).toEqual({ kind: "accept" })
    // Nothing at all was created: no store, no index, no journal.
    expect(existsSync(join(home, ".mpd", "memory"))).toBe(false)
  } finally {
    plugin.restore()
    leave()
  }
})

test("(f) a delete with the mpdTeams service absent degrades to a no-op with ONE logged line", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-noteams-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-noteams-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The archive directory the delete reports, which no service can confirm. */
  const archiveDir = join(workspace, ".mpd", "team", "archive", "plan-3")
  jsonFixture(join(archiveDir, "plan.json"), { version: 2, planId: "plan-3", sessionId: "session-3", name: "orphan", description: "", approval: "required", members: [], tasks: [], stagedAt: "2026-11-01T00:00:00.000Z", approvedAt: "2026-11-01T00:01:00.000Z" })
  /** The mounted plugin under test, WITHOUT any team service. */
  const plugin = mount(workspace, { vcs: "git" })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    /** What the waterfall answered: no throw, and the downstream accept passes through. */
    const decision = await listener.run({ name: "agent_teams_plan", arguments: { action: "delete" } }, { isError: false, value: { archivedTo: archiveDir } })
    expect(decision).toEqual({ kind: "accept" })
    expect(existsSync(join(home, ".mpd", "memory"))).toBe(false)
    // The ONE log line the contract requires, read from the row's real sink.
    /** The row's own log file under the workspace. */
    const logPath = join(workspace, ".mpd", "logs", "mpd-memory.log")
    expect(existsSync(logPath)).toBe(true)
    /** The log's lines that speak about the absent service. */
    const lines = readFileSync(logPath, "utf8").split("\n").filter((line) => line.includes("mpdTeams service is absent"))
    expect(lines.length).toBe(1)
  } finally {
    plugin.restore()
    leave()
  }
})

test("(g) a refused home-scoped write is contained: the listener logs and returns the downstream decision", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-contained-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-contained-ws-")
  /** A global root OUTSIDE that home, which the T-43 containment rule must refuse. */
  const outside = join(scratch("mpd-mem-contained-outside-"), "global-memory")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  boulderFixture(workspace, "work-c", ".mpd/plans/refactor.md", "Alpha task")
  /** The mounted plugin, configured with a root the guard refuses. */
  const plugin = mount(workspace, { vcs: "git", globalDir: outside })
  try {
    /** The one listener the hook installed. */
    const listener = plugin.listeners[0]
    /** What the waterfall answered: still the downstream accept, never a throw. */
    const decision = await listener.run(
      { name: "mpd_boulder_complete", arguments: { workId: "work-c" } },
      { isError: false, value: { workId: "work-c", status: "completed" } },
    )
    expect(decision).toEqual({ kind: "accept" })
    // The refusal caused NO write and left NO directory behind.
    expect(existsSync(outside)).toBe(false)
    /** The row's own log file under the workspace. */
    const logPath = join(workspace, ".mpd", "logs", "mpd-memory.log")
    expect(existsSync(logPath)).toBe(true)
    expect(readFileSync(logPath, "utf8")).toContain("refusing to record a global project-archive memory")
  } finally {
    plugin.restore()
    leave()
  }
})

test("the row releases its ONE listener through ctx.on('dispose')", async () => {
  /** The sandbox home this arm treats as the user's home. */
  const home = scratch("mpd-mem-dispose-home-")
  /** The throwaway workspace. */
  const workspace = scratch("mpd-mem-dispose-ws-")
  /** The environment hook that points HOME/DSH_HOME at the sandbox. */
  const leave = enterSandboxHome(home)
  /** The mounted plugin under test. */
  const plugin = mount(workspace, { vcs: "git" })
  try {
    expect(plugin.listeners.length).toBe(1)
    expect(plugin.listeners[0].disposed).toBe(false)
    // Disposing the row must release the waterfall registration, not leave it registered forever.
    plugin.dispose()
    expect(plugin.listeners[0].disposed).toBe(true)
  } finally {
    plugin.restore()
    leave()
  }
})
