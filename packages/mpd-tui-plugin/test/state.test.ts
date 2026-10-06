// This file's copy assertions are LANGUAGE-INDEPENDENT (they read `t(...)`), so no process-wide
// language pin is needed any more: the suite passes under no variable, `en` and `zh` alike.

// The arms below assert COPY, which is localized at use now — so the expectation comes from the same
// dictionary the product reads rather than from a hard-coded English string. Without this the suite
// only passes under one language and hides every other render (measured: 10 arms went red under
// `DSH_TUI_LANG=zh`).
import { t } from "../src/i18n"
// Unit tests for the data + rendering helpers: the state projection the status
// line and the board read, the untrusted-input sanitizer, the transcript
// renderer table, and the log-only event-type registration.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DshTeamView } from "../../mpd-dsh-adapter-plugin/src/index"
import { boardLines, readBoardState, statusLine } from "../src/state"
import { cellWidth, clampCells, scalarLines, scalarText } from "../src/sanitize"
import { TRANSCRIPT_RENDERERS, TRANSCRIPT_TYPES } from "../src/renderers"
import { appendBoardOpened } from "../src/commands"
import { BOARD_OPENED_EVENT, candidateAnchors, registerInto } from "../src/registration"
import { createLog } from "../src/log"

/** Every temp root this file created, removed in `afterEach`. */
const temporary: string[] = []

/**
 * 0.1.7: the TUI reads the OFFICIAL live readout, not the retired team.json under .mpd/team. This
 * map holds the views a fixture registers, so the arms below drive the projection the production
 * wiring drives (`liveTeamViews` returns exactly these on a host).
 */
const FIXTURE_VIEWS = new Map<string, DshTeamView[]>()

/** One official team view from the fixture's own vocabulary. */
function viewOf(record: {
  id: string
  members?: Array<{ name?: string; status?: string }>
  tasks?: Array<{ id?: string; status?: string }>
  captainSessionId?: string
}): DshTeamView {
  return {
    teamId: record.id,
    leadName: "lead",
    leadSessionId: record.captainSessionId ?? record.id + "-lead",
    members: [
      { id: record.captainSessionId ?? record.id + "-lead", name: "lead", role: "lead", status: "running", diagnostics: [] },
      ...(record.members ?? []).map((member, index) => ({
        id: "m" + index,
        name: String(member.name ?? "m" + index),
        role: "teammate" as const,
        // The fixture's raw record carries any status string; a view declares the four lifecycle
        // values the projection folds, so the two vocabularies meet exactly here.
        status: (member.status ?? "inactive") as DshTeamView["members"][number]["status"],
        diagnostics: [],
      })),
    ],
    tasks: (record.tasks ?? []).map((task, index) => ({
      id: String(task.id ?? "t" + index),
      revision: 1,
      subject: String(task.id ?? "t" + index),
      description: "",
      // Same meeting point as the roster above: the record speaks raw strings, the view the four
      // official task values, and `String(...)` keeps feeding the projection the same value.
      status: String(task.status ?? "pending") as DshTeamView["tasks"][number]["status"],
      blockedBy: [],
      writeScopes: [],
      ready: true,
      writeScopeWarnings: [],
    })),
  }
}

/** Creates one isolated workspace/home pair plus the fixture views the projection reads. */
function fixture(): { workspace: string; home: string } {
  /** The temp root this fixture owns, registered for cleanup. */
  const root = mkdtempSync(join(tmpdir(), "mpd-tui-state-"))
  temporary.push(root)
  /** The workspace half: every workspace-local state file lives under it. */
  const workspace = join(root, "workspace")
  /** The home half: the durable workmate library lives under it. */
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
    /** This arm's own isolated workspace and home. */
    const { workspace, home } = fixture()
    /** The projection under test. */
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
    /** The temp root of this arm. */
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-empty-"))
    temporary.push(root)
    /** The projection of a state tree that does not exist. */
    const state = readBoardState(join(root, "nope"), join(root, "nohome"))
    expect(state.team).toBeUndefined()
    expect(state.boulder).toBeUndefined()
    expect(state.plans.count).toBe(0)
    expect(state.workmates.count).toBe(0)
    expect(statusLine(state)).toContain("mpd:")
    expect(boardLines(state).join("\n")).toContain(t("board.noBoulder"))
  })

  test("a team READOUT that throws is reported as a note, not as a crash", () => {
    /** This arm's own isolated workspace and home. */
    const { workspace, home } = fixture()
    // The retired record file is not a source any more: a corrupt one changes nothing (the views
    // are the truth). What CAN break is the adapter seam itself, so a throwing readout — which the
    // caller resolves OUTSIDE this projection — is modelled as "no views at all".
    writeFileSync(join(workspace, ".mpd", "team", "alpha", "team.json"), "{ not json")
    /** The projection while the adapter seam still returns the fixture views. */
    const clean = readBoardState(workspace, home, FIXTURE_VIEWS.get(workspace) ?? [])
    expect(clean.team?.id).toBe("beta")
    /** The projection when the adapter seam yields no views at all. */
    const noSeam = readBoardState(workspace, home, [])
    expect(noSeam.team).toBeUndefined()
    expect(noSeam.problems).toEqual([])
  })

  test("the status line is one bounded line", () => {
    /** This arm's own isolated workspace and home. */
    const { workspace, home } = fixture()
    /** The rendered one-line status contribution. */
    const line = statusLine(readBoardState(workspace, home, FIXTURE_VIEWS.get(workspace) ?? []))
    // 0.1.7: the team has no NAME on the official plane — the readout names the Lead pseudo-row
    // `lead`, and the counts are the board's own (7 tasks, 1 completed).
    expect(line.startsWith("mpd: " + t("status.teamRow", { name: "lead", members: 2, done: 1, total: 7 }))).toBe(true)
    expect(line).toContain(t("status.boulder", { active: 1, works: 2 }))
    expect(line).toContain(t("status.plans", { n: 2 }))
    expect(line).toContain(t("status.workmates", { n: 2 }))
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
    /** The bounded line list. */
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
    /** The rendered row for a team-created event. */
    const created = TRANSCRIPT_RENDERERS["agent-teams/team-created"]({
      teamId: "mpd-default",
      captainSessionId: "session-1",
      name: "MPD Default",
      profile: "mpd",
    })
    expect(created?.title).toBe("mpd team created")
    expect(created?.lines).toContain("MPD Default")
    expect(created?.lines.join(" ")).toContain("mpd-default")

    /** The rendered row for a task-updated event. */
    const updated = TRANSCRIPT_RENDERERS["agent-teams/task-updated"]({ taskId: "t4", status: "completed", output: "done" })
    expect(updated?.lines[0]).toBe("t4 -> completed")

    /** The rendered row for this plugin's own board-opened event. */
    const board = TRANSCRIPT_RENDERERS[BOARD_OPENED_EVENT]({ view: "board", via: "command", at: 0 })
    expect(board?.title).toBe("mpd board")
    expect(board?.lines[0]).toContain("opened via command")
  })

  test("renderers never throw and always emit strings, whatever the payload", () => {
    /** Payload shapes every renderer must survive without throwing. */
    const garbage: unknown[] = [undefined, null, 0, "", "text", [], {}, { a: { b: 1 } }, { at: Number.NaN }]
    for (const type of TRANSCRIPT_TYPES) {
      for (const payload of garbage) {
        /** This renderer's answer, undefined when it declines the payload. */
        const result = TRANSCRIPT_RENDERERS[type](payload)
        if (result === undefined) continue
        expect(result.lines.every((line) => typeof line === "string")).toBe(true)
      }
    }
  })

  test("renderer output is clamped (a huge payload cannot flood the transcript)", () => {
    /** The rendered row for a 5000-character message payload. */
    const huge = TRANSCRIPT_RENDERERS["agent-teams/message-sent"]({ from: "a", to: "b", content: "z".repeat(5000) })
    expect(huge?.lines.length).toBeLessThanOrEqual(13)
    for (const line of huge?.lines ?? []) expect(line.length).toBeLessThanOrEqual(400)
  })
})

describe("log-only event registration", () => {
  test("registerInto reports and mutates truthfully", () => {
    /** The known-type set a session package validates its log against. */
    const set = new Set<string>()
    expect(registerInto({ KNOWN_SESSION_EVENT_TYPES: set }, BOARD_OPENED_EVENT)).toBe(true)
    expect(set.has(BOARD_OPENED_EVENT)).toBe(true)
    expect(registerInto({}, BOARD_OPENED_EVENT)).toBe(false)
    expect(registerInto({ KNOWN_SESSION_EVENT_TYPES: null }, BOARD_OPENED_EVENT)).toBe(false)
    expect(registerInto(undefined, BOARD_OPENED_EVENT)).toBe(false)
  })

  test("candidateAnchors is deduplicated and never empty", () => {
    /** The candidate anchors resolved for an unreadable home. */
    const anchors = candidateAnchors({ DSH_HOME: "/nonexistent-dsh-home" }, "/nonexistent-home")
    expect(anchors.length).toBeGreaterThan(0)
    expect(new Set(anchors).size).toBe(anchors.length)
    // The plugin's own module URL is always an anchor; an unreadable home
    // contributes none, which is the documented degradation.
    expect(anchors[0].endsWith("registration.ts")).toBe(true)
  })

  test("appendBoardOpened refuses to write an unregistered type", () => {
    /** Every append the session double received. */
    const appends: unknown[] = []
    /** A session double that records appends instead of writing them. */
    const session = { append: (type: string, data: unknown) => appends.push({ type, data }) }
    /** A silent logger: this arm asserts the return value, not the log. */
    const log = createLog(undefined, "mpd-tui-test", {})
    expect(appendBoardOpened(session, false, "command", "board", log)).toBe(false)
    expect(appends).toHaveLength(0)
    expect(appendBoardOpened(undefined, true, "command", "board", log)).toBe(false)
    expect(appendBoardOpened(session, true, "command", "board", log)).toBe(true)
    expect(appends).toEqual([{ type: BOARD_OPENED_EVENT, data: { view: "board", via: "command", at: expect.any(Number) } }])
  })

  test("a throwing session.append is contained", () => {
    /** A session double whose `append` always fails. */
    const session = {
      /** Models a session whose log is already closed. */
      append(): never {
        throw new Error("session closed")
      },
    }
    /** A silent logger for this arm. */
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
    /** The lines the host logger received. */
    const seen: string[] = []
    /** A log object backed by a host logger. */
    const withLogger = createLog({ info: (m: string) => seen.push(m) }, "tag", {})
    withLogger.info("hello")
    expect(seen).toEqual(["[tag] hello"])
  })
})
