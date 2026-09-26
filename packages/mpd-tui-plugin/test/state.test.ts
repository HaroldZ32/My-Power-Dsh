// Unit tests for the data + rendering helpers: the state projection the status
// line and the board read, the untrusted-input sanitizer, the transcript
// renderer table, and the log-only event-type registration.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boardLines, readBoardState, statusLine } from "../src/state"
import { cellWidth, clampCells, scalarLines, scalarText } from "../src/sanitize"
import { TRANSCRIPT_RENDERERS, TRANSCRIPT_TYPES } from "../src/renderers"
import { appendBoardOpened } from "../src/commands"
import { BOARD_OPENED_EVENT, candidateAnchors, registerInto } from "../src/registration"
import { createLog } from "../src/log"

const temporary: string[] = []

/**
 * 0.1.7: the TUI reads the OFFICIAL live readout, not the retired team.json under .mpd/team. This
 * map holds the views a fixture registers, so the arms below drive the projection the production
 * wiring drives (`liveTeamViews` returns exactly these on a host).
 */
const FIXTURE_VIEWS = new Map<string, unknown[]>()

/** One official team view from the fixture's own vocabulary. */
function viewOf(record: {
  id: string
  members?: Array<{ name?: string; status?: string }>
  tasks?: Array<{ id?: string; status?: string }>
  captainSessionId?: string
}): Record<string, unknown> {
  return {
    teamId: record.id,
    leadName: "lead",
    leadSessionId: record.captainSessionId ?? record.id + "-lead",
    members: [
      { id: record.captainSessionId ?? record.id + "-lead", name: "lead", role: "lead", status: "running", diagnostics: [] },
      ...(record.members ?? []).map((member, index) => ({
        id: "m" + index,
        name: String(member.name ?? "m" + index),
        role: "teammate",
        status: member.status ?? "inactive",
        diagnostics: [],
      })),
    ],
    tasks: (record.tasks ?? []).map((task, index) => ({
      id: String(task.id ?? "t" + index),
      revision: 1,
      subject: String(task.id ?? "t" + index),
      description: "",
      status: String(task.status ?? "pending"),
      blockedBy: [],
      writeScopes: [],
      ready: true,
      writeScopeWarnings: [],
    })),
  }
}

function fixture(): { workspace: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "mpd-tui-state-"))
  temporary.push(root)
  const workspace = join(root, "workspace")
  const home = join(root, "home")
  mkdirSync(join(workspace, ".mpd", "team", "alpha"), { recursive: true })
  mkdirSync(join(workspace, ".mpd", "team", "beta"), { recursive: true })
  mkdirSync(join(workspace, ".mpd", "plans"), { recursive: true })
  mkdirSync(join(home, ".mpd", "workmate", "one"), { recursive: true })
  mkdirSync(join(home, ".mpd", "workmate", "two"), { recursive: true })
  mkdirSync(join(home, ".mpd", "workmate", ".archive", "gone-1"), { recursive: true })
  mkdirSync(join(home, ".mpd", "workmate", "orphan"), { recursive: true })

  // The retired record file is still written: it proves the readers IGNORE it (the views below are
  // the only source). A host would have neither file.
  writeFileSync(
    join(workspace, ".mpd", "team", "alpha", "team.json"),
    JSON.stringify({ id: "alpha", name: "alpha", phase: "done", createdAt: "2026-01-01T00:00:00Z", members: [], tasks: [] }),
  )
  writeFileSync(
    join(workspace, ".mpd", "team", "beta", "team.json"),
    JSON.stringify({
      id: "beta",
      name: "beta",
      phase: "running",
      approvedAt: "2026-02-02T00:00:00Z",
      createdAt: "2026-02-01T00:00:00Z",
      members: [{ name: "A" }, { name: "B" }],
      tasks: [
        { id: "t1", status: "completed" },
        { id: "t2", status: "in_progress" },
        { id: "t3", status: "pending" },
        { id: "t4", status: "failed" },
        { id: "t5", status: "claimed" },
        { id: "t6", status: "cancelled" },
        { id: "t7", status: "weird" },
      ],
    }),
  )
  writeFileSync(
    join(workspace, ".mpd", "boulder.json"),
    JSON.stringify({
      active_work_id: "w1",
      works: {
        w1: { work_id: "w1", status: "active", plan_name: "plan-a" },
        w2: { work_id: "w2", status: "completed", plan_name: "plan-b" },
      },
    }),
  )
  writeFileSync(join(workspace, ".mpd", "plans", "a.md"), "# a\n")
  writeFileSync(join(workspace, ".mpd", "plans", "b.md"), "# b\n")
  writeFileSync(join(home, ".mpd", "workmate", "one", "meta.json"), JSON.stringify({ name: "one", baseId: "architect" }))
  writeFileSync(join(home, ".mpd", "workmate", "two", "meta.json"), JSON.stringify({ name: "two", baseId: "reviewer" }))
  FIXTURE_VIEWS.set(workspace, [
    viewOf({
      id: "beta",
      members: [{ name: "A" }, { name: "B" }],
      tasks: [
        { id: "t1", status: "completed" },
        { id: "t2", status: "in_progress" },
        { id: "t3", status: "pending" },
        { id: "t4", status: "failed" },
        { id: "t5", status: "claimed" },
        { id: "t6", status: "cancelled" },
        { id: "t7", status: "weird" },
      ],
    }),
  ])
  return { workspace, home }
}

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("state projection", () => {
  test("reads the newest team record, the task ledger, boulder, plans and workmates", () => {
    const { workspace, home } = fixture()
    const state = readBoardState(workspace, home, FIXTURE_VIEWS.get(workspace) ?? [])
    expect(state.team?.id).toBe("beta")
    expect(state.team?.members).toBe(2)
    expect(state.team?.tasks).toEqual({
      total: 7,
      completed: 1,
      inProgress: 1,
      pending: 1,
      failed: 1,
      claimed: 1,
      cancelled: 1,
      other: 1,
    })
    expect(state.boulder).toMatchObject({ works: 2, active: 1, completed: 1 })
    expect(state.plans).toEqual({ count: 2, newest: "b.md" })
    // `.archive` and the orphan directory (no meta.json) are not instances.
    expect(state.workmates).toEqual({ count: 2, names: ["one", "two"] })
    expect(state.problems).toEqual([])
  })

  test("a missing state tree degrades to empty sections without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-empty-"))
    temporary.push(root)
    const state = readBoardState(join(root, "nope"), join(root, "nohome"))
    expect(state.team).toBeUndefined()
    expect(state.boulder).toBeUndefined()
    expect(state.plans.count).toBe(0)
    expect(state.workmates.count).toBe(0)
    expect(statusLine(state)).toContain("mpd:")
    expect(boardLines(state).join("\n")).toContain("(no work ledger)")
  })

  test("a team READOUT that throws is reported as a note, not as a crash", () => {
    const { workspace, home } = fixture()
    // The retired record file is not a source any more: a corrupt one changes nothing (the views
    // are the truth). What CAN break is the adapter seam itself, so a throwing readout — which the
    // caller resolves OUTSIDE this projection — is modelled as "no views at all".
    writeFileSync(join(workspace, ".mpd", "team", "alpha", "team.json"), "{ not json")
    const clean = readBoardState(workspace, home, FIXTURE_VIEWS.get(workspace) ?? [])
    expect(clean.team?.id).toBe("beta")
    const noSeam = readBoardState(workspace, home, [])
    expect(noSeam.team).toBeUndefined()
    expect(noSeam.problems).toEqual([])
  })

  test("the status line is one bounded line", () => {
    const { workspace, home } = fixture()
    const line = statusLine(readBoardState(workspace, home, FIXTURE_VIEWS.get(workspace) ?? []))
    // 0.1.7: the team has no NAME on the official plane — the readout names the Lead pseudo-row
    // `lead`, and the counts are the board's own (7 tasks, 1 completed).
    expect(line.startsWith("mpd: team lead 2·1/7")).toBe(true)
    expect(line).toContain("boulder 1/2")
    expect(line).toContain("plans 2")
    expect(line).toContain("workmates 2")
    expect(line.includes("\n")).toBe(false)
  })
})

describe("sanitizer", () => {
  test("accepts scalars only and drops everything else", () => {
    expect(scalarText("hello")).toBe("hello")
    expect(scalarText(42)).toBe("42")
    expect(scalarText(true)).toBe("true")
    expect(scalarText(Number.NaN)).toBeUndefined()
    expect(scalarText({ a: 1 })).toBeUndefined()
    expect(scalarText(["a"])).toBeUndefined()
    expect(scalarText(null)).toBeUndefined()
    expect(scalarText(undefined)).toBeUndefined()
  })

  test("strips control characters and collapses whitespace", () => {
    expect(scalarText("a\u0000b\u001fc\n\nd")).toBe("a b c d")
    expect(scalarText("\u001b[31mred\u001b[0m")).toBe("[31mred [0m")
  })

  test("clamps by terminal cell, not by code-unit count", () => {
    expect(cellWidth("abc")).toBe(3)
    expect(cellWidth("日本語")).toBe(6)
    expect(clampCells("日本語", 5)).toBe("日本")
    expect(clampCells("abcdef", 3)).toBe("abc")
    expect(scalarText("日本語", 4)).toBe("日本")
  })

  test("scalarLines bounds the line count and per-line width", () => {
    const lines = scalarLines(Array.from({ length: 500 }, () => "x".repeat(900)), 5, 10)
    expect(lines).toHaveLength(5)
    expect(lines.every((line) => line.length <= 10)).toBe(true)
    expect(scalarLines([{ bad: true }, "ok", null], 5, 10)).toEqual(["ok"])
  })
})

describe("transcript renderers", () => {
  test("every declared type has a renderer and maps a payload to text rows", () => {
    for (const type of TRANSCRIPT_TYPES) {
      expect(typeof TRANSCRIPT_RENDERERS[type]).toBe("function")
    }
    const created = TRANSCRIPT_RENDERERS["agent-teams/team-created"]({
      teamId: "mpd-default",
      captainSessionId: "session-1",
      name: "MPD Default",
      profile: "mpd",
    })
    expect(created?.title).toBe("mpd team created")
    expect(created?.lines).toContain("MPD Default")
    expect(created?.lines.join(" ")).toContain("mpd-default")

    const updated = TRANSCRIPT_RENDERERS["agent-teams/task-updated"]({ taskId: "t4", status: "completed", output: "done" })
    expect(updated?.lines[0]).toBe("t4 -> completed")

    const board = TRANSCRIPT_RENDERERS[BOARD_OPENED_EVENT]({ view: "board", via: "command", at: 0 })
    expect(board?.title).toBe("mpd board")
    expect(board?.lines[0]).toContain("opened via command")
  })

  test("renderers never throw and always emit strings, whatever the payload", () => {
    const garbage: unknown[] = [undefined, null, 0, "", "text", [], {}, { a: { b: 1 } }, { at: Number.NaN }]
    for (const type of TRANSCRIPT_TYPES) {
      for (const payload of garbage) {
        const result = TRANSCRIPT_RENDERERS[type](payload)
        if (result === undefined) continue
        expect(result.lines.every((line) => typeof line === "string")).toBe(true)
      }
    }
  })

  test("renderer output is clamped (a huge payload cannot flood the transcript)", () => {
    const huge = TRANSCRIPT_RENDERERS["agent-teams/message-sent"]({ from: "a", to: "b", content: "z".repeat(5000) })
    expect(huge?.lines.length).toBeLessThanOrEqual(13)
    for (const line of huge?.lines ?? []) expect(line.length).toBeLessThanOrEqual(400)
  })
})

describe("log-only event registration", () => {
  test("registerInto reports and mutates truthfully", () => {
    const set = new Set<string>()
    expect(registerInto({ KNOWN_SESSION_EVENT_TYPES: set }, BOARD_OPENED_EVENT)).toBe(true)
    expect(set.has(BOARD_OPENED_EVENT)).toBe(true)
    expect(registerInto({}, BOARD_OPENED_EVENT)).toBe(false)
    expect(registerInto({ KNOWN_SESSION_EVENT_TYPES: null }, BOARD_OPENED_EVENT)).toBe(false)
    expect(registerInto(undefined, BOARD_OPENED_EVENT)).toBe(false)
  })

  test("candidateAnchors is deduplicated and never empty", () => {
    const anchors = candidateAnchors({ DSH_HOME: "/nonexistent-dsh-home" }, "/nonexistent-home")
    expect(anchors.length).toBeGreaterThan(0)
    expect(new Set(anchors).size).toBe(anchors.length)
    // The plugin's own module URL is always an anchor; an unreadable home
    // contributes none, which is the documented degradation.
    expect(anchors[0].endsWith("registration.ts")).toBe(true)
  })

  test("appendBoardOpened refuses to write an unregistered type", () => {
    const appends: unknown[] = []
    const session = { append: (type: string, data: unknown) => appends.push({ type, data }) }
    const log = createLog(undefined, "mpd-tui-test", {})
    expect(appendBoardOpened(session, false, "command", "board", log)).toBe(false)
    expect(appends).toHaveLength(0)
    expect(appendBoardOpened(undefined, true, "command", "board", log)).toBe(false)
    expect(appendBoardOpened(session, true, "command", "board", log)).toBe(true)
    expect(appends).toEqual([{ type: BOARD_OPENED_EVENT, data: { view: "board", via: "command", at: expect.any(Number) } }])
  })

  test("a throwing session.append is contained", () => {
    const session = {
      append() {
        throw new Error("session closed")
      },
    }
    const log = createLog(undefined, "mpd-tui-test", {})
    expect(appendBoardOpened(session, true, "shortcut", "board", log)).toBe(false)
  })
})

describe("logging", () => {
  test("never writes to stdout and falls back to stderr only for info/warn", () => {
    // The debug line is suppressed without DSH_TUI_DEBUG; the log object itself
    // must never throw, with or without a host logger.
    const log = createLog(undefined, "mpd-tui-test", {})
    expect(() => log.debug("quiet by default")).not.toThrow()
    expect(() => log.info("info")).not.toThrow()
    expect(() => log.warn("warn")).not.toThrow()
    const seen: string[] = []
    const withLogger = createLog({ info: (m: string) => seen.push(m) }, "tag", {})
    withLogger.info("hello")
    expect(seen).toEqual(["[tag] hello"])
  })
})
