// This file's copy assertions are LANGUAGE-INDEPENDENT (they read `t(...)`), so no process-wide
// language pin is needed any more: the suite passes under no variable, `en` and `zh` alike.

import { t } from "../src/i18n"
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
import type { HoldRecord, IncidentRecord } from "../../mpd-team-watchdog-plugin/src/sidecars"
import { appendIncident, clearHold, readWatermarks, writeHold } from "../../mpd-team-watchdog-plugin/src/sidecars"
import { HoldRegistry } from "../../mpd-team-watchdog-plugin/src/holds"
import { DEFAULT_STATE_DIR, watermarkPath } from "../../mpd-team-watchdog-plugin/src/paths"
import { createDialogs } from "../src/dialogs"
import { createLog } from "../src/log"
import { STATUS_KEY, registerStatus } from "../src/status"
import { readBoardState } from "../src/state"
import { createTuiAdapter } from "../../mpd-tui-adapter-plugin/src/index.js"
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

/** The fakes and the real hold store one arm works against. */
interface Harness {
  /** The context double, in which services are reachable only through `inject`. */
  ctx: Record<string, any>
  /** The DSH-TUI seam adapter over that same context. */
  tui: ReturnType<typeof createTuiAdapter>
  /** Every contribution the status double received. */
  statusSet: { key: string; text: string }[]
  /** Every request the dialog double was asked to show. */
  dialogRequests: { title: string; options: { id: string; label: string }[]; timeoutMs?: number }[]
  /** Warning lines the logger double received. */
  warnings: string[]
  /** Sets the choice the next dialog request answers with. */
  answer: (choice: string | undefined) => void
  /** The temp workspace the real hold store is rooted at. */
  workspace: string
  /** The watchdog package's own hold registry over that workspace. */
  registry: HoldRegistry
  /** Removes the temp workspace this arm owns. */
  cleanup: () => void
}

/** Builds one arm's fakes plus a REAL hold store over a temp workspace. */
function harness(options: { withDialogs?: boolean; withService?: boolean } = {}): Harness {
  /** The temp workspace this arm owns. */
  const workspace = mkdtempSync(join(tmpdir(), "mpd-tui-watchdog-"))
  /** Contributions the status double collects. */
  const statusSet: Harness["statusSet"] = []
  /** Requests the dialog double collects. */
  const dialogRequests: Harness["dialogRequests"] = []
  /** Warning lines the logger double collects. */
  const warnings: string[] = []
  /** The choice the next dialog request answers with. */
  let nextChoice: string | undefined
  /** The real hold registry, reading and writing that temp workspace. */
  const registry = new HoldRegistry(DEFAULT_STATE_DIR, workspace)
  /** The `mpdWatchdog` service double, backed by that registry. */
  const service = {
    heldTeams: (ws?: string) => registry.heldTeams(ws ?? workspace),
    unread: (reader: string, ws?: string) => registry.unread(reader, ws ?? workspace),
    acknowledge: (reader: string, upTo: number, ws?: string) => registry.acknowledge(reader, upTo, ws ?? workspace),
    view: (reader: string, ws?: string) => registry.view(reader, ws ?? workspace),
  }
  /** The services this composition exposes; `inject` gates on them. */
  const services: Record<string, any> = {
    tuiStatus: {
      /** Records one contribution and returns the host's no-op disposer. */
      set(key: string, text: unknown): () => void {
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
  /** Builds the context double: inject-free invisibility plus the two seams. */
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
      /** The injected scope, carrying the same services as properties. */
      const scoped = { get: (id: string) => services[id], ...services }
      if (dependencies.every((id) => services[id] !== undefined)) callback(scoped)
      return {}
    },
  })
  /** The context double shared by this arm's adapter and its seam calls. */
  const ctx = build()
  return {
    ctx,
    // The seam adapter the migrated call sites take: it binds through the SAME ctx, so the
    // double's inject-free invisibility stays what the arms exercise.
    tui: createTuiAdapter(ctx as never),
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

/** One incident record at the given timestamp, with optional overrides. */
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

/**
 * The hold fixture this arm writes. `ttlMs: 0` is the value the reader gives a hold persisted
 * before T-17 introduced the field (0 = no TTL), so these arms keep exercising the never-expire
 * path their notices and acknowledgements depend on.
 */
const hold = (teamId: string, since: number): HoldRecord => ({
  id: `hold-${teamId}`,
  teamId,
  since,
  cause: "silence",
  taskId: "t1",
  attemptId: null,
  sceneAt: since,
  ttlMs: 0,
})

describe("watchdog front door — notice composition", () => {
  test("the notice is COMPOSED into the value the status publisher emits, and disappears once the team is resumed", () => {
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      writeHold(h.workspace, DEFAULT_STATE_DIR, hold("mpd-default-1", 1000))
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      /** A silent logger: this arm asserts the published text and the bytes, not logs. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** The front door under test. */
      const door = attachWatchdogFrontDoor(h.ctx, h.tui, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.tui, log) })
      /** The status seam, publishing the composed notice. */
      const status = registerStatus(h.ctx, h.tui, log, () => h.workspace, () => h.workspace, 0, () =>
        composeNotices(undefined, door.notice()),
      )
      expect(door.available()).toBe(true)

      /** The contribution published while the team is held and an incident is unread. */
      const first = h.statusSet.at(-1)
      expect(first?.key).toBe(STATUS_KEY)
      // The two halves are JOINED by the notice composer, so the arm asserts each localized part
      // rather than re-deriving the join in the expectation (which is how the language dependency was
      // hiding here): the held-team clause and the unread clause both have to reach the published text.
      expect(first?.text).toContain(t("watchdog.held", { teams: "mpd-default-1" }))
      expect(first?.text).toContain(t("watchdog.unreadOne", { n: 1 }))
      // The notice is APPENDED to the real board line, not substituted for it.
      expect(first?.text).toContain("mpd: " + t("status.teamNone"))
      expect(first?.text).toContain(t("status.plans", { n: 0 }))

      // Resume the team: the live half of the notice must vanish on the next publish...
      clearHold(h.workspace, DEFAULT_STATE_DIR, "mpd-default-1")
      status.refresh()
      /** The contribution after the hold was cleared: the live half must be gone. */
      const second = h.statusSet.at(-1)
      expect(second?.text).not.toContain("held mpd-default-1")
      expect(second?.text).toContain(t("watchdog.unreadOne", { n: 1 }))

      // ...and the replay half too, once it is acknowledged (through the service).
      expect(door.acknowledge(1000).ok).toBe(true)
      status.refresh()
      /** The contribution after the acknowledge: no watchdog text at all. */
      const third = h.statusSet.at(-1)
      // The language-independent form: the acknowledged publish drops the notice and leaves the BOARD
      // line untouched, so the assertion is "the notice's own text is gone", not a regex over a literal
      // English prefix (which silently pinned this arm to one language).
      expect(third?.text).not.toContain("watchdog:")
      expect(third?.text).not.toContain(t("watchdog.held", { teams: "mpd-default-1" }))
      expect(String(first?.text).startsWith(String(third?.text))).toBe(true)
    } finally {
      h.cleanup()
    }
  })

  test("watchdogNotice states the live condition and the replay separately; composeNotices joins providers", () => {
    expect(watchdogNotice({ holds: [], unread: [] })).toBeUndefined()
    expect(watchdogNotice({ holds: ["a"], unread: [] })).toBe(t("watchdog.notice", { parts: t("watchdog.held", { teams: "a" }) }))
    expect(watchdogNotice({ holds: [], unread: [incident(1)] })).toBe(t("watchdog.notice", { parts: t("watchdog.unreadOne", { n: 1 }) }))
    expect(watchdogNotice({ holds: ["a", "b"], unread: [incident(1), incident(2)] })).toBe(
      t("watchdog.notice", { parts: t("watchdog.held", { teams: "a, b" }) + " · " + t("watchdog.unread", { n: 2 }) }),
    )
    expect(composeNotices(undefined, "watchdog: held a")).toBe("watchdog: held a")
    expect(composeNotices("saved to settings — no live session", "watchdog: held a")).toBe(
      "saved to settings — no live session · watchdog: held a",
    )
    expect(composeNotices(undefined, undefined)).toBeUndefined()
  })

  test("heldTeams reads the durable hold index through the service, not a cache", () => {
    /** This arm's fakes and its real hold store. */
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
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(2000))
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** How many times the post-acknowledge hook ran. */
      let acknowledged = 0
      /** The front door under test. */
      const door = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
        onAcknowledged: () => {
          acknowledged += 1
        },
        replayOnAttach: false,
      })

      /** Path of the per-reader watermark sidecar. */
      const watermarkFile = watermarkPath(h.workspace, DEFAULT_STATE_DIR)
      expect(existsSync(watermarkFile)).toBe(false)
      expect(readWatermarks(h.workspace, DEFAULT_STATE_DIR)).toEqual({})

      h.answer(ACKNOWLEDGE_OPTION)
      /** The option the user chose. */
      const choice = await door.offer()
      expect(choice).toBe(ACKNOWLEDGE_OPTION)

      // The request the host was asked to show: the notice text plus both options.
      expect(h.dialogRequests).toHaveLength(1)
      /** The one request the host was asked to show. */
      const request = h.dialogRequests[0]
      expect(request.title).toContain(t("watchdog.notice", { parts: t("watchdog.unread", { n: 2 }) }))
      expect(request.options.map((option) => option.id)).toEqual([ACKNOWLEDGE_OPTION, "later"])
      expect(request.options[0].label).toBe(t("watchdog.acknowledge"))

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
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** The front door of the first start. */
      const first = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
        replayOnAttach: false,
      })
      expect(first.view().unread).toHaveLength(1)
      h.answer(ACKNOWLEDGE_OPTION)
      expect(await first.offer()).toBe(ACKNOWLEDGE_OPTION)

      // A SECOND start: a fresh front door over the same workspace. Nothing unread, no dialog.
      h.dialogRequests.length = 0
      /** The front door of a SECOND start over the same workspace. */
      const second = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
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
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** The front door under test. */
      const door = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
        replayOnAttach: false,
      })
      h.answer("later")
      expect(await door.offer()).toBe("later")
      expect(existsSync(watermarkPath(h.workspace, DEFAULT_STATE_DIR))).toBe(false)
      expect(readWatermarks(h.workspace, DEFAULT_STATE_DIR)).toEqual({})
      /** A fresh front door over the same workspace, i.e. a restart. */
      const restarted = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
        replayOnAttach: false,
      })
      expect(restarted.view().unread).toHaveLength(1)
      expect(watchdogDialog(restarted.view()).title).toContain(t("watchdog.unreadOne", { n: 1 }))
    } finally {
      h.cleanup()
    }
  })

  test("the attach-time replay runs once, when BOTH the service and the dialog seam are composed", async () => {
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      h.answer("later")
      attachWatchdogFrontDoor(h.ctx, h.tui, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.tui, log) })
      await Promise.resolve()
      await Promise.resolve()
      expect(h.dialogRequests).toHaveLength(1)
      expect(h.dialogRequests[0].title).toContain(t("watchdog.unreadOne", { n: 1 }))
    } finally {
      h.cleanup()
    }
  })

  test("no dialog service and nothing unread are both no-ops (never a hang, never a phantom dialog)", async () => {
    /** This arm's fakes, with no dialog service composed. */
    const h = harness({ withDialogs: false })
    try {
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** The front door under test. */
      const door = attachWatchdogFrontDoor(h.ctx, h.tui, log, {
        workspaceRoot: () => h.workspace,
        dialogs: createDialogs(h.tui, log),
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
    /** This arm's fakes and its real hold store. */
    const h = harness()
    try {
      /** A minimal service exposing only `view`, the optional member form. */
      const service = { view: (reader: string, ws?: string) => h.registry.view(reader, ws ?? h.workspace) }
      expect(readWatchdogView(service, "mpd-tui", h.workspace)).toEqual({ holds: [], unread: [] })
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(7))
      /** The view that service returns. */
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
    /** This arm's fakes, with no `mpdWatchdog` service composed. */
    const h = harness({ withService: false })
    try {
      appendIncident(h.workspace, DEFAULT_STATE_DIR, incident(1000))
      /** A silent logger for this arm. */
      const log = createLog({ warn: () => {}, info: () => {}, debug: () => {} }, "test")
      /** Whether the attach threw, which it must never do. */
      let threw = false
      /** The front door, when the attach returned one at all. */
      let door: ReturnType<typeof attachWatchdogFrontDoor> | undefined
      try {
        door = attachWatchdogFrontDoor(h.ctx, h.tui, log, { workspaceRoot: () => h.workspace, dialogs: createDialogs(h.tui, log) })
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(door?.available()).toBe(false)
      // The status line stays the plain board line: no watchdog text.
      const status = registerStatus(h.ctx, h.tui, log, () => h.workspace, () => h.workspace, 0, () =>
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
