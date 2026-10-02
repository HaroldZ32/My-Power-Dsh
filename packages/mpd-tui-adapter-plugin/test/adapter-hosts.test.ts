// The DSH-TUI adapter's host-shape contract.
//
// The THREE shapes below are the ones a real composition produces, and they are the reason this
// package exists:
//   * REACHABLE BY `ctx.get` ONLY — the mediated plugin host, whose own documentation exposes it
//     through the soft probe before any row applies;
//   * REACHABLE ONLY INSIDE THE DEFERRED INJECT CALLBACK — every other `tui*` service, which an
//     inject-free row cannot see at all (T4-INERT-1, measured);
//   * ABSENT — a web or headless composition, where nothing may throw, nothing may be claimed and
//     exactly ONE aggregate warning line is printed.
//
// A fourth shape is the TIMING one (a seam that binds AFTER the consumer registered): the adapter
// must queue the registration and drain it at the bind, or a row that applies early would silently
// register nothing — the same defect class the inject discipline exists to close.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  SERVICE_NAME,
  TUI_SEAMS,
  TUI_SEAM_KEYS,
  createFileSink,
  createLazyTuiAdapter,
  createTuiAdapter,
  describeOutcome,
  reportOutcomes,
  resolveTuiAdapter,
} from "../src/index.js"
import type { SeamOutcome, TuiAdapter } from "../src/index.js"

/** The services one host double can carry, and the calls it recorded. */
interface Double {
  /** The context handed to the adapter. */
  ctx: Record<string, any>
  /** Every dependency list an `inject` call declared, in call order. */
  injections: string[][]
  /** Every cleanup handed to `effect`, in call order. */
  cleanups: (() => void)[]
  /** Every service id the double was asked to `get`, with the strictness of the read. */
  probes: { name: string; strict: boolean | undefined }[]
  /** Compose one service AFTER the adapter was built (the late-bind shape). */
  compose(id: string, service: unknown): void
}

/**
 * Build a host double whose injected scopes are the only way to reach a service.
 * @param services - the services this composition carries.
 * @param options - `probeAnswers` models the get-only shape; `injectSupported: false` models a ctx
 *   with no activation channel at all.
 * @returns the double.
 */
function hostDouble(
  services: Record<string, unknown> = {},
  options: { probeAnswers?: boolean; injectSupported?: boolean } = {},
): Double {
  /** The injections the double received, in call order. */
  const injections: string[][] = []
  /** The cleanups the double's effect registered. */
  const cleanups: (() => void)[] = []
  /** The probes the double received. */
  const probes: { name: string; strict: boolean | undefined }[] = []
  /** The callbacks waiting for a service that is not composed yet, by id. */
  const waiting: Record<string, ((scoped: Record<string, unknown>) => void)[]> = {}

  /** Build one context object; every injected scope gets its own. */
  const build = (): Record<string, any> => {
    /** The context under construction. */
    const ctx: Record<string, any> = {
      /** The inject-free invisibility, or the get-only shape when the double answers. */
      get(name: string, strict?: boolean): unknown {
        probes.push({ name, strict })
        return options.probeAnswers === true ? services[name] : undefined
      },
      /** Runs the cleanup once and records it, as the host's fiber ownership would. */
      effect(callback: () => (() => void) | void): Record<string, never> {
        /** The cleanup this effect returned, when it returned one. */
        const cleanup = callback()
        if (typeof cleanup === "function") cleanups.push(cleanup)
        return {}
      },
    }
    if (options.injectSupported !== false) {
      /** The deferred bind form: fire now when composed, otherwise wait for `compose`. */
      ctx.inject = (dependencies: readonly string[], callback: (scoped: Record<string, unknown>) => void) => {
        injections.push([...dependencies])
        /** The injected scope, whose `get` resolves the mounted services. */
        // The injected scope is a FULL context of its own (it owns `effect`, which is where every
        // host registration handle is handed back), with the services resolved through `get`.
        const scoped = build()
        scoped.get = (name: string) => services[name]
        if (dependencies.every((id) => services[id] !== undefined)) callback(scoped)
        else for (const id of dependencies) (waiting[id] ??= []).push(callback)
        return {}
      }
    }
    return ctx
  }

  return {
    ctx: build(),
    injections,
    cleanups,
    probes,
    /** Composes one service AFTER the adapter was built (the late-bind shape). */
    compose(id: string, service: unknown): void {
      services[id] = service
      for (const callback of waiting[id] ?? []) {
        /** The injected scope this late binding hands its callback, `effect` included. */
        const scoped = build()
        scoped.get = (name: string) => services[name]
        callback(scoped)
      }
      waiting[id] = []
    },
  }
}

/** A recording scene service, the shape the adapter's scene registration talks to. */
function sceneService(): { registered: string[]; opened: string[]; service: Record<string, unknown> } {
  /** The scene ids the host accepted. */
  const registered: string[] = []
  /** The scene ids the host was asked to open. */
  const opened: string[] = []
  return {
    registered,
    opened,
    service: {
      /** Records one scene descriptor and returns its disposer. */
      register: (descriptor: { id: string }) => {
        registered.push(descriptor.id)
        return () => undefined
      },
      /** Records one open request and answers true for the scene this double knows. */
      open: (id: string) => {
        opened.push(id)
        return id === "mpd-board"
      },
    },
  }
}

describe("host shape 1: reachable by ctx.get only (the mediated plugin host)", () => {
  test("the probe binds the plugin host, and ONLY that seam", () => {
    /** A service the soft probe can answer for. */
    const host = { subscribeDecision: () => () => undefined, grants: { allows: () => true } }
    /** A double whose `get` answers but whose inject never fires (nothing is composed). */
    const dbl = hostDouble({ [TUI_SEAMS.pluginHost]: host }, { probeAnswers: true })
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    // The rule is the HOST's own for this one service: the soft probe first, the deferred inject as
    // the fallback — and the probe is consulted only because this ctx HAS an inject channel.
    expect(tui.capabilities().seams.pluginHost).toBe(true)
    expect(tui.capabilities().seams.scenes).toBe(false)
    expect(tui.capabilities().bound).toBe(1)
    expect(tui.capabilities().total).toBe(TUI_SEAM_KEYS.length)
  })

  test("a probe that answers is NOT a binding channel when the ctx cannot inject", () => {
    /** A double with no `inject` at all, whose `get` answers everything. */
    const dbl = hostDouble({ [TUI_SEAMS.scenes]: sceneService().service, [TUI_SEAMS.pluginHost]: { subscribeDecision: () => undefined } }, {
      probeAnswers: true,
      injectSupported: false,
    })
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    // T4-INERT-1 in one assertion: without an activation channel nothing binds, however loudly the
    // probe answers — that mistake is what made the first TUI plugin register nothing.
    expect(tui.capabilities().bound).toBe(0)
    expect(dbl.injections).toHaveLength(0)
  })
})

describe("host shape 2: reachable only inside the deferred inject callback", () => {
  test("one inject per seam, never a batch", () => {
    /** The scenes this composition carries. */
    const scenes = sceneService()
    /** A double with the scene service composed up front. */
    const dbl = hostDouble({ [TUI_SEAMS.scenes]: scenes.service })
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    // ONE deferred inject per seam id: a batched `ctx.inject([a, b, c], …)` is all-or-nothing in
    // cordis, so one absent optional seam would silently suppress every other seam in the batch.
    expect(dbl.injections).toHaveLength(TUI_SEAM_KEYS.length)
    expect(dbl.injections.every((deps) => deps.length === 1)).toBe(true)
    expect(dbl.injections.map((deps) => deps[0])).toEqual(TUI_SEAM_KEYS.map((key) => TUI_SEAMS[key]))
    /** The scene handle this adapter hands back. */
    const handle = tui.registerScene({ id: "mpd-board", title: "board", component: {} })
    expect(handle.outcome().state).toBe("requested")
    expect(scenes.registered).toEqual(["mpd-board"])
    // The navigation members ride the SAME handle (Lane C's frozen shape).
    expect(handle.openScene("mpd-board")).toBe(true)
    expect(handle.openScene("nope")).toBe(false)
    expect(handle.closeScene("mpd-board")).toBe(false) // this host build carries no close member
    expect(scenes.opened).toEqual(["mpd-board", "nope"])
  })

  test("a registration made BEFORE the seam binds is queued and drained at the bind", () => {
    /** The scenes registry, composed only after the adapter exists. */
    const scenes = sceneService()
    /** A double with nothing composed yet. */
    const dbl = hostDouble({})
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    /** The handle taken while the seam is still absent. */
    const handle = tui.registerScene({ id: "mpd-team", title: "team", component: {} })
    expect(handle.outcome().state).toBe("absent")
    expect(handle.bound()).toBe(false)
    expect(scenes.registered).toEqual([])
    dbl.compose(TUI_SEAMS.scenes, scenes.service)
    // The queued registration ran at the bind, and the handle now reports the measured result.
    expect(scenes.registered).toEqual(["mpd-team"])
    expect(handle.outcome().state).toBe("requested")
    expect(handle.bound()).toBe(true)
  })

  test("every host handle goes to the injected scope's effect, and the cleanup clears the status key", () => {
    /** Every `set` the status double received. */
    const sets: { key: string; text: unknown }[] = []
    /** The status service double. */
    const status = {
      set: (key: string, text: unknown) => {
        sets.push({ key, text })
        return () => undefined
      },
    }
    /** A double with the status service composed. */
    const dbl = hostDouble({ [TUI_SEAMS.status]: status })
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    /** The view handle: one publish at registration, one clear at cleanup. */
    const view = tui.registerStatusView({ key: "mpd-tui", render: () => "mpd: ok" })
    expect(sets).toEqual([{ key: "mpd-tui", text: "mpd: ok" }])
    expect(view.outcome().state).toBe("requested")
    // The same value is not republished: the host records every set() as a ledger effect.
    view.refresh()
    expect(sets).toHaveLength(1)
    // The cleanup is owned by the INJECTED scope, which is what a plugin unload disposes.
    expect(dbl.cleanups.length).toBeGreaterThan(0)
    for (const cleanup of dbl.cleanups) cleanup()
    expect(sets.at(-1)).toEqual({ key: "mpd-tui", text: undefined })
  })
})

describe("host shape 3: absent (a web or headless composition)", () => {
  test("nothing binds, nothing throws, and exactly ONE aggregate warning is printed", () => {
    /** A double with no service composed and no late compose call. */
    const dbl = hostDouble({})
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    /** Everything the report sink received. */
    const lines: string[] = []
    /** What the aggregate reported. */
    const verdict = reportOutcomes({ info: (line) => lines.push(`info:${line}`), warn: (line) => lines.push(`warn:${line}`) }, tui.seamOutcomes())
    expect(verdict).toBe("warned")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("no DSH-TUI service is composed")
    // Every seam reports `absent` with the service id, and the adapter never threw.
    expect(tui.seamOutcomes()).toHaveLength(TUI_SEAM_KEYS.length)
    for (const outcome of tui.seamOutcomes()) expect(outcome.state).toBe("absent")
    expect(tui.capabilities().bound).toBe(0)
    expect(dbl.cleanups).toHaveLength(0)
  })

  test("a composition with ONE seam reports the info line instead, never the warning", () => {
    /** A double carrying only the scene registry. */
    const dbl = hostDouble({ [TUI_SEAMS.scenes]: sceneService().service })
    /** The adapter under test. */
    const tui = createTuiAdapter(dbl.ctx as never)
    /** Everything the report sink received. */
    const lines: string[] = []
    /** What the aggregate reported. */
    const verdict = reportOutcomes({ info: (line) => lines.push(`info:${line}`), warn: (line) => lines.push(`warn:${line}`) }, tui.seamOutcomes())
    expect(verdict).toBe("reported")
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("mpd TUI surfaces: ")
    expect(lines[0]).toContain("tuiScenes(available")
    expect(lines[0]).toContain("tuiStatus(absent")
  })
})

describe("resolution and diagnostics", () => {
  test("resolveTuiAdapter prefers the mounted service and falls back to a row-private adapter", () => {
    /** A mounted adapter over a composition with the scene service. */
    const mounting = hostDouble({ [TUI_SEAMS.scenes]: sceneService().service })
    /** The mounted instance, exactly as `apply` provides it. */
    const mounted = createTuiAdapter(mounting.ctx as never)
    /** A ctx whose `get` answers `mpdTui` with that instance. */
    const ctxWithService = { get: (name: string) => (name === SERVICE_NAME ? mounted : undefined) }
    expect(resolveTuiAdapter(ctxWithService as never)).toBe(mounted)
    /** A ctx that cannot answer (the standalone unit-test shape). */
    const bare = { get: () => undefined }
    /** The fallback adapter. */
    const fallback = resolveTuiAdapter(bare as never)
    expect(fallback).not.toBe(mounted)
    expect(typeof fallback.registerScene).toBe("function")
    expect(fallback.capabilities().bound).toBe(0)
  })

  test("a broken ctx.get never escapes resolveTuiAdapter", () => {
    /** A ctx whose probe throws, as an inject-filtered scope does. */
    const hostile = {
      get: () => {
        throw new Error('cannot get property "tuiScenes" without inject')
      },
    }
    expect(() => resolveTuiAdapter(hostile as never)).not.toThrow()
  })

  test("createLazyTuiAdapter warns exactly once per row", () => {
    /** The warning lines the lazy adapter produced. */
    const warnings: string[] = []
    /** A lazy adapter over a ctx that never provides the service. */
    const lazy: TuiAdapter = createLazyTuiAdapter({ get: () => undefined }, { label: "mpd-tui", warn: (line) => warnings.push(line) })
    // Two reads, one warning: the fallback is diagnosable without flooding a TUI log.
    expect(lazy.capabilities().bound).toBe(0)
    expect(lazy.seamOutcomes()).toHaveLength(TUI_SEAM_KEYS.length)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("TUI ADAPTER FALLBACK")
    expect(warnings[0]).toContain("fix the ROW ORDER")
  })

  test("describeOutcome renders the vocabulary consumers already read", () => {
    /** One outcome with a detail and one without. */
    const withDetail: SeamOutcome = { id: "tuiScenes", state: "requested", detail: "board requested" }
    /** The same shape without a detail, which must render without the parenthesised part. */
    const withoutDetail: SeamOutcome = { id: "tuiStatus", state: "absent" }
    expect(describeOutcome(withDetail)).toBe("tuiScenes(requested: board requested)")
    expect(describeOutcome(withoutDetail)).toBe("tuiStatus(absent)")
  })

  test("the file sink appends under .mpd/logs and caps its own size", () => {
    /** The temporary workspace this arm owns. */
    const root = mkdtempSync(join(tmpdir(), "mpd-tui-sink-"))
    try {
      /** A sink with a deliberately tiny cap. */
      const sink = createFileSink({ root, name: "mpd-tui.log", capBytes: 64 })
      sink.write("first-line")
      expect(existsSync(sink.path())).toBe(true)
      expect(readFileSync(sink.path(), "utf8")).toContain("first-line")
      for (let index = 0; index < 20; index += 1) sink.write(`line-${String(index)}`)
      // The cap is enforced by keeping the file's TAIL: a sink that grew without bound would fill
      // a user's workspace from a render loop.
      expect(readFileSync(sink.path(), "utf8").length).toBeLessThan(200)
      // An unwritable root must never throw out of a diagnostic.
      const hostile = createFileSink({ root: join(root, "nope", "deep", "\0bad"), name: "x.log" })
      expect(() => hostile.write("ignored")).not.toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
