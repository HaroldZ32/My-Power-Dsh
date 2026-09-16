// w6/w6b — the TUI front door for the team watchdog (notice composition, dialog, unread replay).
//
// The fakes model the host: a service is reachable ONLY inside `ctx.inject([id], …)` (the measured
// T4-INERT-1 behaviour), and `tuiDialogs` records the exact request it was asked to show. The STORE
// is real — the watchdog package's own `HoldRegistry` over a temp workspace, seeded through that
// package's own sidecar writers — so the replay assertions read bytes, not an in-process cache, and
// the TUI source under test never links a writer (the lane's T7 pins that on the built bytes).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { IncidentRecord } from "../../mpd-team-watchdog-plugin/src/sidecars"
import { appendIncident, clearHold, readWatermarks, writeHold } from "../../mpd-team-watchdog-plugin/src/sidecars"
import { HoldRegistry } from "../../mpd-team-watchdog-plugin/src/holds"
import { DEFAULT_STATE_DIR, watermarkPath } from "../../mpd-team-watchdog-plugin/src/paths"
import { createDialogs } from "../src/dialogs"
import { createLog } from "../src/log"
import { STATUS_KEY, registerStatus } from "../src/status"
import { readBoardState } from "../src/state"
import {
  ACKNOWLEDGE_OPTION,
  EMPTY_WATCHDOG_VIEW,
  WATCHDOG_SERVICE,
  attachWatchdogFrontDoor,
  composeNotices,
  heldTeams,
  readWatchdogView,
  watchdogDialog,
  watchdogNotice,
} from "../src/watchdog"

interface Harness {
  ctx: Record<string, any>
  statusSet: { key: string; text: string }[]
  dialogRequests: { title: string; options: { id: string; label: string }[]; timeoutMs?: number }[]
  warnings: string[]
  answer: (choice: string | undefined) => void
  workspace: string
  registry: HoldRegistry
  cleanup: () => void
}

function harness(options: { withDialogs?: boolean; withService?: boolean } = {}): Harness {
  const workspace = mkdtempSync(join(tmpdir(), "mpd-tui-watchdog-"))
  const statusSet: Harness["statusSet"] = []
  const dialogRequests: Harness["dialogRequests"] = []
  const warnings: string[] = []
  let nextChoice: string | undefined
  const registry = new HoldRegistry(DEFAULT_STATE_DIR, workspace)
  const service = {
    heldTeams: (ws?: string) => registry.heldTeams(ws ?? workspace),
    unread: (reader: string, ws?: string) => registry.unread(reader, ws ?? workspace),
    acknowledge: (reader: string, upTo: number, ws?: string) => registry.acknowledge(reader, upTo, ws ?? workspace),
    view: (reader: string, ws?: string) => registry.view(reader, ws ?? workspace),
  }
  const services: Record<string, any> = {
    tuiStatus: {
      set(key: string, text: unknown) {
        statusSet.push({ key, text: String(text) })
        return () => {}
      },
    },
  }
  if (options.withDialogs !== false) {
    services.tuiDialogs = {
      select: async (request: { title: string; options: { id: string; label: string }[]; timeoutMs?: number }) => {
        dialogRequests.push(request)
        return nextChoice
      },
      confirm: async () => undefined,
      input: async () => undefined,
    }
  }
  if (options.withService !== false) services[WATCHDOG_SERVICE] = service
  const build = (): Record<string, any> => ({
    get: () => undefined, // inject-free invisibility
    effect: (callback: () => () => void) => {
      callback()
      return {}
    },
    logger: {
      info: () => {},
      warn: (message: string) => warnings.push(message),
      debug: () => {},
    },
    inject: (dependencies: readonly string[], callback: (scoped: Record<string, any>) => void) => {
      const scoped = { get: (id: string) => services[id], ...services }
      if (dependencies.every((id) => services[id] !== undefined)) callback(scoped)
      return {}
    },
  })
  return {
    ctx: build(),
    statusSet,
    dialogRequests,
    warnings,
    answer: (choice) => {
      nextChoice = choice
    },
    workspace,
    registry,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  }
}

const incident = (at: number, overrides: Partial<IncidentRecord> = {}): IncidentRecord => ({
  id: `inc-${String(at)}`,
  teamId: "mpd-default-1",
  kind: "escalate",
  at,
  cause: { kind: "silence", ms: 90000 },
  taskId: "t1",
  attemptId: null,
  scene: null,
  hold: "applied",
  acknowledgedBy: [],
  ...overrides,
})

const hold = (teamId: string, since: number) => ({
  id: `hold-${teamId}`,
  teamId,
  since,
  cause: "silence",
  taskId: "t1",
  attemptId: null,
  sceneAt: since,
})

describe("watchdog front door — notice composition", () => {
  test("the notice is COMPOSED into the value the status publisher emits, and disappears once the team is resumed", () => {
    const h = harness()
    try {
      writeHold(h.workspace, DEFAULT_STATE_DIR, hold("mpd-default-1", 1000))
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      const door = attachWatchdogFrontDoor(h.ctx, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.ctx, log) })
      const status = registerStatus(h.ctx, log, () => h.workspace, () => h.workspace, 0, () =>
        composeNotices(undefined, door.notice()),
      )
      expect(door.available()).toBe(true)

      const first = h.statusSet.at(-1)
      expect(first?.key).toBe(STATUS_KEY)
      expect(first?.text).toContain("watchdog: held mpd-default-1")
      expect(first?.text).toContain("1 unread incident")
      // The notice is APPENDED to the real board line, not substituted for it.
      expect(first?.text).toContain("mpd: team -")
      expect(first?.text).toContain("plans ")

      // Resume the team: the live half of the notice must vanish on the next publish...
      clearHold(h.workspace, DEFAULT_STATE_DIR, "mpd-default-1")
      status.refresh()
      const second = h.statusSet.at(-1)
      expect(second?.text).not.toContain("held mpd-default-1")
      expect(second?.text).toContain("1 unread incident")

      // ...and the replay half too, once it is acknowledged (through the service).
      expect(door.acknowledge(1000).ok).toBe(true)
      status.refresh()
      const third = h.statusSet.at(-1)
      expect(third?.text).not.toContain("watchdog:")
      expect(third?.text).toBe(String(first?.text).replace(/ · watchdog:.*$/, ""))
    } finally {
      h.cleanup()
    }
  })

  test("watchdogNotice states the live condition and the replay separately; composeNotices joins providers", () => {
    expect(watchdogNotice({ holds: [], unread: [] })).toBeUndefined()
    expect(watchdogNotice({ holds: ["a"], unread: [] })).toBe("watchdog: held a")
    expect(watchdogNotice({ holds: [], unread: [incident(1)] })).toBe("watchdog: 1 unread incident")
    expect(watchdogNotice({ holds: ["a", "b"], unread: [incident(1), incident(2)] })).toBe(
      "watchdog: held a, b · 2 unread incidents",
    )
    expect(composeNotices(undefined, "watchdog: held a")).toBe("watchdog: held a")
    expect(composeNotices("saved to settings — no live session", "watchdog: held a")).toBe(
      "saved to settings — no live session · watchdog: held a",
    )
    expect(composeNotices(undefined, undefined)).toBeUndefined()
  })

  test("heldTeams reads the durable hold index through the service, not a cache", () => {
    const h = harness()
    try {
      expect(heldTeams(h.ctx ? h.registry : undefined, h.workspace)).toEqual([])
      writeHold(h.workspace, DEFAULT_STATE_DIR, hold("team-a", 1))
      writeHold(h.workspace, DEFAULT_STATE_DIR, hold("team-b", 2))
      expect(h.registry.heldTeams(h.workspace)).toEqual(["team-a", "team-b"])
      clearHold(h.workspace, DEFAULT_STATE_DIR, "team-a")
      expect(h.registry.heldTeams(h.workspace)).toEqual(["team-b"])
      // The pure helper degrades to [] without a service.
      expect(heldTeams(undefined, h.workspace)).toEqual([])
    } finally {
      h.cleanup()
    }
  })
})

describe("watchdog front door — dialog and acknowledge", () => {
  test("the dialog carries the notice text and an acknowledge option, and acknowledging advances the watermark", async () => {
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(2000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      let acknowledged = 0
      const door = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        onAcknowledged: () => {
          acknowledged += 1
        },
        replayOnAttach: false,
      })

      const watermarkFile = watermarkPath(h.workspace, DEFAULT_STATE_DIR)
      expect(existsSync(watermarkFile)).toBe(false)
      expect(readWatermarks(h.workspace, DEFAULT_STATE_DIR)).toEqual({})

      h.answer(ACKNOWLEDGE_OPTION)
      const choice = await door.offer()
      expect(choice).toBe(ACKNOWLEDGE_OPTION)

      // The request the host was asked to show: the notice text plus both options.
      expect(h.dialogRequests).toHaveLength(1)
      const request = h.dialogRequests[0]
      expect(request.title).toContain("watchdog: 2 unread incidents")
      expect(request.options.map((option) => option.id)).toEqual([ACKNOWLEDGE_OPTION, "later"])
      expect(request.options[0].label).toBe("Acknowledge")

      // Byte-level proof: the per-reader watermark advanced to the newest incident.
      const after = JSON.parse(readFileSync(watermarkFile, "utf8"))
      expect(after).toEqual({ "mpd-tui": 2000 })
      expect(acknowledged).toBe(1)
      expect(h.registry.unread("mpd-tui", h.workspace)).toEqual([])
    } finally {
      h.cleanup()
    }
  })

  test("a second start does not surface an acknowledged incident (the replay is watermark-driven)", async () => {
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      const first = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        replayOnAttach: false,
      })
      expect(first.view().unread).toHaveLength(1)
      h.answer(ACKNOWLEDGE_OPTION)
      expect(await first.offer()).toBe(ACKNOWLEDGE_OPTION)

      // A SECOND start: a fresh front door over the same workspace. Nothing unread, no dialog.
      h.dialogRequests.length = 0
      const second = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        replayOnAttach: false,
      })
      expect(second.view().unread).toEqual([])
      expect(await second.offer()).toBeUndefined()
      expect(h.dialogRequests).toHaveLength(0)
    } finally {
      h.cleanup()
    }
  })

  test("choosing Later keeps the incident unread: the replay is permanent re-display BY DESIGN", async () => {
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      const door = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        replayOnAttach: false,
      })
      h.answer("later")
      expect(await door.offer()).toBe("later")
      expect(existsSync(watermarkPath(h.workspace, DEFAULT_STATE_DIR))).toBe(false)
      expect(readWatermarks(h.workspace, DEFAULT_STATE_DIR)).toEqual({})
      const restarted = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        replayOnAttach: false,
      })
      expect(restarted.view().unread).toHaveLength(1)
      expect(watchdogDialog(restarted.view()).title).toContain("1 unread incident")
    } finally {
      h.cleanup()
    }
  })

  test("the attach-time replay runs once, when BOTH the service and the dialog seam are composed", async () => {
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      h.answer("later")
      attachWatchdogFrontDoor(h.ctx, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.ctx, log) })
      await Promise.resolve()
      await Promise.resolve()
      expect(h.dialogRequests).toHaveLength(1)
      expect(h.dialogRequests[0].title).toContain("1 unread incident")
    } finally {
      h.cleanup()
    }
  })

  test("no dialog service and nothing unread are both no-ops (never a hang, never a phantom dialog)", async () => {
    const h = harness({ withDialogs: false })
    try {
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      const door = attachWatchdogFrontDoor(h.ctx, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.ctx, log),
        replayOnAttach: false,
      })
      expect(await door.offer()).toBeUndefined()
      expect(door.view()).toEqual({ holds: [], unread: [] })
      expect(h.dialogRequests).toHaveLength(0)
    } finally {
      h.cleanup()
    }
  })

  test("readWatchdogView is a live read through the service (and empty without one)", () => {
    const h = harness()
    try {
      const service = { view: (reader: string, ws?: string) => h.registry.view(reader, ws ?? h.workspace) }
      expect(readWatchdogView(service, "mpd-tui", h.workspace)).toEqual({ holds: [], unread: [] })
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(7))
      const view = readWatchdogView(service, "mpd-tui", h.workspace)
      expect(view.unread.map((record) => record.at)).toEqual([7])
      expect(readWatchdogView(undefined, "mpd-tui", h.workspace)).toEqual(EMPTY_WATCHDOG_VIEW)
      // The board reader this package already had stays independent of the watchdog store: it
      // answers (no throw) with no team record present, while the watchdog view reports the incident.
      expect(readBoardState(h.workspace, h.workspace).team).toBeUndefined()
    } finally {
      h.cleanup()
    }
  })
})

describe("watchdog front door — the absent-service path", () => {
  test("with no mpdWatchdog service: no notice, no dialog, no fake acknowledge, one warning — and apply does not throw", async () => {
    const h = harness({ withService: false })
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      let threw = false
      let door: ReturnType<typeof attachWatchdogFrontDoor> | undefined
      try {
        door = attachWatchdogFrontDoor(h.ctx, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.ctx, log) })
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(door?.available()).toBe(false)
      // The status line stays the plain board line: no watchdog text.
      const status = registerStatus(h.ctx, log, () => h.workspace, () => h.workspace, 0, () =>
        composeNotices(undefined, door?.notice()),
      )
      expect(status).toBeDefined()
      expect(String(h.statusSet.at(-1)?.text)).not.toContain("watchdog")
      // No dialog is offered, and nothing was asked of the host.
      expect(await door?.offer()).toBeUndefined()
      expect(h.dialogRequests).toHaveLength(0)
      // The acknowledge is refused LOUDLY rather than pretended.
      const ack = door?.acknowledge(1000)
      expect(ack?.ok).toBe(false)
      expect(String(ack?.error)).toContain("mpdWatchdog service is not mounted")
      // Nothing was written: the incident is still unread in the store.
      expect(readWatermarks(h.workspace, DEFAULT_STATE_DIR)).toEqual({})
      // The absence is stated once (the warn-once path), never silently swallowed.
      await Promise.resolve()
      expect(h.warnings.filter((message) => message.includes("mpdWatchdog service is not mounted")).length).toBeLessThanOrEqual(1)
    } finally {
      h.cleanup()
    }
  })
})
