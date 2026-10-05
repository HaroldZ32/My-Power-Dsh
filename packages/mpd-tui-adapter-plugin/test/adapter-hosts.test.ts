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
//
// The last two blocks are the HOST-CONTACT contract (the one load-time reach into the installed
// DSH-TUI): the resolver's arms against real temp host installs (happy path, missing module, wrong
// shape, a module that throws on evaluation, no candidates at all) and the adapter's own wiring of
// the probe (bound / absent / pending-then-settled, one diagnostic line each way, and the rich
// status-view registration the contact exists to serve).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  HOST_PACKAGE_PATH,
  HOST_ROOT_ENV,
  HOST_UI_MODULE,
  SERVICE_NAME,
  TUI_SEAMS,
  TUI_SEAM_KEYS,
  createFileSink,
  createLazyTuiAdapter,
  createTuiAdapter,
  describeOutcome,
  hostRootCandidates,
  probeHostInput,
  readHostStdinValue,
  reportOutcomes,
  resolveTuiAdapter,
} from "../src/index.js"
import type { SeamOutcome, TuiAdapter, TuiHostInput } from "../src/index.js"

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
  /**
   * The injected scope the double handed each seam's callback, by service id.
   *
   * This is the object the host's `assertCallerContext` compares a registration identity against —
   * the CALLING ACTIVATION — so the identity arms below assert against these very objects.
   */
  scopes: Record<string, unknown>
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
  /** The injected scope handed to each seam's callback, by service id (see {@link Double.scopes}). */
  const scopes: Record<string, unknown> = {}

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
        for (const id of dependencies) scopes[id] = scoped
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
    scopes,
    /** Composes one service AFTER the adapter was built (the late-bind shape). */
    compose(id: string, service: unknown): void {
      services[id] = service
      for (const callback of waiting[id] ?? []) {
        /** The injected scope this late binding hands its callback, `effect` included. */
        const scoped = build()
        scoped.get = (name: string) => services[name]
        scopes[id] = scoped
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

// ── the host contact: the resolver ──────────────────────────────────────────────────────────────

/** The module body a stubbed host install ships: a callable hook that answers a marker object. */
const USABLE_HOST_BODY = "export const useStdin = () => ({ internal_eventEmitter: { marker: 'host' } })\n"

/**
 * Stage a fake host install at `root` (the layout the resolver probes for).
 * @param root - the directory that must contain `<root>/lib/types/ui.js`.
 * @param body - the module source; the default exports a usable `useStdin`.
 * @returns the staged root, ready for {@link probeHostInput}.
 */
function stageHost(root: string, body: string = USABLE_HOST_BODY): string {
  mkdirSync(join(root, "lib", "types"), { recursive: true })
  writeFileSync(join(root, HOST_UI_MODULE), body)
  return root
}

/** Create one throwaway root; every arm gets its OWN URL, so the ESM cache cannot serve another's bytes. */
function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe("host contact resolver", () => {
  test("a host install carrying useStdin resolves, and the hook is the module's own", async () => {
    /** The staged host root this arm owns. */
    const root = tempRoot("mpd-host-ok-")
    try {
      stageHost(root)
      /** The probe's answer for a real install layout. */
      const found = await probeHostInput([root])
      expect(found.root).toBe(root)
      expect(typeof found.input?.useStdin).toBe("function")
      // The wrapper calls the module's own export, which is what keeps the host's React context
      // object reachable from a component the host renders.
      expect((found.input?.useStdin() as { internal_eventEmitter?: { marker?: string } } | undefined)?.internal_eventEmitter?.marker).toBe("host")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a candidate without lib/types/ui.js is skipped, and no candidate at all reports one reason", async () => {
    /** A root that looks like a host install but carries no module. */
    const root = tempRoot("mpd-host-missing-")
    try {
      mkdirSync(join(root, "lib", "types"), { recursive: true })
      /** The probe's answer for a directory that merely resembles an install. */
      const missing = await probeHostInput([root])
      expect(missing.input).toBeUndefined()
      expect(missing.detail).toContain(HOST_UI_MODULE)
      /** The probe's answer when the anchor list is empty (no profile carries the host). */
      const none = await probeHostInput([])
      expect(none.input).toBeUndefined()
      expect(none.detail).toContain("no candidate host root")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a version-skew host (no useStdin export) and a module that throws both degrade to undefined", async () => {
    /** A host root whose module lacks the export. */
    const skewRoot = tempRoot("mpd-host-skew-")
    /** A host root whose module throws while it is evaluated. */
    const brokenRoot = tempRoot("mpd-host-broken-")
    try {
      stageHost(skewRoot, "export const notTheHook = 1\n")
      stageHost(brokenRoot, "throw new Error('broken host module')\n")
      /** The probe's answer for the version-skew install. */
      const skew = await probeHostInput([skewRoot])
      expect(skew.input).toBeUndefined()
      expect(skew.detail).toContain("no useStdin export")
      // The arm that proves no error escapes: an evaluation failure is a finding, not a throw.
      /** The probe's answer for the install whose module throws. */
      const broken = await probeHostInput([brokenRoot])
      expect(broken.input).toBeUndefined()
      expect(broken.detail).toContain("broken host module")
      /** The same probe with a usable candidate behind the broken one keeps looking. */
      const recovered = await probeHostInput([brokenRoot, stageHost(tempRoot("mpd-host-ok2-"))])
      expect(typeof recovered.input?.useStdin).toBe("function")
    } finally {
      rmSync(skewRoot, { recursive: true, force: true })
      rmSync(brokenRoot, { recursive: true, force: true })
    }
  })

  test("a pinned root is exclusive, and without a pin every installed profile is probed", () => {
    /** A sandbox home holding two installed profiles. */
    const home = tempRoot("mpd-home-")
    try {
      mkdirSync(join(home, ".dsh", "profiles", "web"), { recursive: true })
      mkdirSync(join(home, ".dsh", "profiles", "dsh-tui"), { recursive: true })
      /** The explicit pin, which outranks — and REPLACES — every discovered anchor. */
      const pinned = join(home, "staged-host")
      expect(hostRootCandidates({ [HOST_ROOT_ENV]: pinned, DSH_HOME: join(home, ".dsh") }, home)).toEqual([pinned])
      /** The candidate list for an environment with no pin. */
      const candidates = hostRootCandidates({ DSH_HOME: join(home, ".dsh") }, home)
      expect(candidates).toContain(join(home, ".dsh", "profiles", "dsh-tui", ...HOST_PACKAGE_PATH))
      expect(candidates).toContain(join(home, ".dsh", "profiles", "web", ...HOST_PACKAGE_PATH))
      // The same root must never be probed twice (an anchor and a profile can name one install).
      expect(new Set(candidates).size).toBe(candidates.length)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

// ── the host contact: the adapter's own wiring ──────────────────────────────────────────────────

/** Temporarily replace environment variables, restoring them even when the body throws. */
async function withEnv<T>(vars: Record<string, string | undefined>, body: () => Promise<T>): Promise<T> {
  /** The values the process held before this arm, keyed by name. */
  const saved: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await body()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** Wait until the adapter's host-contact probe settles (or give up after `ms`). */
async function waitForHostSettle(adapter: TuiAdapter, ms: number = 2000): Promise<void> {
  await new Promise<void>((resolve) => {
    /** The guard timer, cleared as soon as the contact settles. */
    const timer = setTimeout(resolve, ms)
    adapter.whenHostInput(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

describe("host contact on the adapter", () => {
  test("an injected contact is reported bound and wakes a subscriber immediately", () => {
    /** The injected contact, standing in for a probed host module. */
    const contact: TuiHostInput = { useStdin: () => ({ internal_eventEmitter: {} }) }
    /** The adapter under test. */
    const adapter = createTuiAdapter({}, { hostInput: contact })
    expect(adapter.hostInput()).toBe(contact)
    expect(adapter.capabilities().hostInput.state).toBe("bound")
    expect(adapter.capabilities().hostInput.detail).toContain("injected")
    /** Every value the subscriber saw, in call order. */
    const seen: (TuiHostInput | undefined)[] = []
    /** The disposer of a subscription that ran at once. */
    const disposer = adapter.whenHostInput((input) => seen.push(input))
    expect(seen).toEqual([contact])
    expect(typeof disposer).toBe("function")
    expect(() => disposer()).not.toThrow()
  })

  test("an adapter that did not probe reports absent, and a subscriber still answers once", () => {
    /** The adapter under test: the default is deliberately no probe (only the row opts in). */
    const adapter = createTuiAdapter({})
    expect(adapter.hostInput()).toBeUndefined()
    expect(adapter.capabilities().hostInput.state).toBe("absent")
    /** Every value the subscriber saw. */
    const seen: (TuiHostInput | undefined)[] = []
    adapter.whenHostInput((input) => seen.push(input))
    expect(seen).toEqual([undefined])
  })

  test("a probe against a staged install binds the contact and writes ONE line", async () => {
    /** The staged host root the probe is pinned to. */
    const root = tempRoot("mpd-adapter-host-")
    try {
      stageHost(root)
      /** The lines the probe's diagnostic sink received. */
      const lines: string[] = []
      await withEnv({ [HOST_ROOT_ENV]: root, DSH_HOME: join(root, "no-such-home"), HOME: join(root, "no-such-home") }, async () => {
        /** The adapter whose probe must find the staged host. */
        const adapter = createTuiAdapter({}, { probeHostContact: true, hostInputLog: (line) => lines.push(line) })
        // Pending before the probe returns: the read-out must not claim a contact it has not loaded.
        expect(adapter.capabilities().hostInput.state).toBe("pending")
        await waitForHostSettle(adapter)
        expect(typeof adapter.hostInput()?.useStdin).toBe("function")
        expect(adapter.capabilities().hostInput.state).toBe("bound")
        expect(adapter.capabilities().hostInput.root).toBe(root)
      })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("host contact bound")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a probe with no reachable host degrades to absent with ONE line and no throw", async () => {
    /** The sandboxed home the probe is confined to (no profile carries a host). */
    const sandbox = tempRoot("mpd-adapter-nohost-")
    try {
      /** The lines the probe's diagnostic sink received. */
      const lines: string[] = []
      await withEnv({ [HOST_ROOT_ENV]: join(sandbox, "nothing-here"), DSH_HOME: sandbox, HOME: sandbox }, async () => {
        /** The adapter whose probe must find nothing. */
        const adapter = createTuiAdapter({}, { probeHostContact: true, hostInputLog: (line) => lines.push(line) })
        await waitForHostSettle(adapter)
        expect(adapter.hostInput()).toBeUndefined()
        expect(adapter.capabilities().hostInput.state).toBe("absent")
        // The takeover is then simply absent — and the missing capability is diagnosable.
        expect(adapter.capabilities().hostInput.detail?.length ?? 0).toBeGreaterThan(0)
      })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("host contact ABSENT")
    } finally {
      rmSync(sandbox, { recursive: true, force: true })
    }
  })

  test("a subscriber registered while the probe is pending runs at the settle", async () => {
    /** The staged host root the probe is pinned to. */
    const root = tempRoot("mpd-adapter-pending-")
    try {
      stageHost(root)
      await withEnv({ [HOST_ROOT_ENV]: root, DSH_HOME: join(root, "no-such-home"), HOME: join(root, "no-such-home") }, async () => {
        /** The adapter under test. */
        const adapter = createTuiAdapter({}, { probeHostContact: true, hostInputLog: () => {} })
        /** Every value the (not yet woken) subscriber saw. */
        const seen: (TuiHostInput | undefined)[] = []
        adapter.whenHostInput((input) => seen.push(input))
        expect(seen).toEqual([])
        await waitForHostSettle(adapter)
        expect(seen).toHaveLength(1)
        expect(seen[0]).toBe(adapter.hostInput())
        // A disposer taken while waiting is a no-op once the listener already ran.
        expect(() => adapter.whenHostInput(() => {})()).not.toThrow()
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// ── the live-context check (the silent failure the shape read exists to catch) ──────────────────

describe("live stdin context classification", () => {
  /** A bus shaped like the host's own emitter, as a plugin would receive it. */
  const bus = (): { on: () => void; removeListener: () => void; prependListener: () => void } => ({
    /** Present so the structural check passes. */
    on: () => {},
    /** Present so the structural check passes. */
    removeListener: () => {},
    /** Present so the structural check passes. */
    prependListener: () => {},
  })

  test("a value carrying internal_querier is the LIVE provider's and yields its bus", () => {
    /** The host's provided context value (the marker is whatever the App put there, never null). */
    const value = { internal_querier: { ask: () => {} }, internal_eventEmitter: bus() }
    /** The classification under test. */
    const read = readHostStdinValue(value)
    expect(read.emitter).toBeDefined()
    expect(read.detail).toBeUndefined()
  })

  test("the context DEFAULT is refused with ONE reason, never attached to", () => {
    // The measured default shape: `internal_querier: null` plus a FRESH emitter that no App feeds.
    // Both look usable, so only the marker separates them — this arm is the falsifier.
    /** The default's value, whose emitter is real and dead. */
    const value = { internal_querier: null, internal_eventEmitter: bus() }
    /** The classification under test. */
    const read = readHostStdinValue(value)
    expect(read.emitter).toBeUndefined()
    expect(read.detail).toContain("DEFAULT")
    expect(read.detail).toContain("internal_querier")
  })

  test("a missing marker, a dead shape, a throwing read and a nullish value are all refusals", () => {
    /** The marker-less object (a foreign shape, not even the default). */
    const markerless = readHostStdinValue({ internal_eventEmitter: bus() })
    expect(markerless.emitter).toBeUndefined()
    expect(markerless.detail).toContain("DEFAULT")
    /** A live marker with no emitter at all. */
    const noBus = readHostStdinValue({ internal_querier: {} })
    expect(noBus.emitter).toBeUndefined()
    expect(noBus.detail).toContain("no input emitter")
    /** A live marker whose emitter is missing a member the hook needs. */
    const partial = readHostStdinValue({ internal_querier: {}, internal_eventEmitter: { on: () => {}, removeListener: () => {} } })
    expect(partial.emitter).toBeUndefined()
    expect(partial.detail).toContain("prependListener")
    /** A getter that throws must be contained, not propagated. */
    const hostile = { internal_querier: {} }
    Object.defineProperty(hostile, "internal_eventEmitter", {
      /** The hostile read this arm proves is contained. */
      get(): never {
        throw new Error("hostile context")
      },
    })
    /** The classification of the hostile value: a refusal, never a propagated throw. */
    const threw = readHostStdinValue(hostile)
    expect(threw.emitter).toBeUndefined()
    expect(threw.detail).toContain("hostile context")
    expect(readHostStdinValue(undefined).emitter).toBeUndefined()
    expect(readHostStdinValue(null).detail).toContain("no context value")
  })
})

describe("the status identity rule and the remembered host kit", () => {
  test("a status registration carries the CALLING ACTIVATION, never the consumer's ctx", () => {
    // MEASURED on dsh-tui 0.12.0: the host runs `assertCallerContext(caller, identity, …)`, the caller
    // it resolved belongs to the activation that injected the service, and a consumer's ctx is a
    // DIFFERENT fiber — so every registration carrying one is refused (`registerView` returned
    // undefined for a fresh key both with and without an identity). BOTH status forms are pinned here,
    // because the keyed status LINE is the surface such a regression silently kills.
    /** Every identity the fake host received, by method. */
    const seen: { set: unknown[]; registerView: unknown[] } = { set: [], registerView: [] }
    /** The host's status service, recording the identity of each call. */
    const status = {
      /** Records the identity of a text contribution. */
      set(_key: string, _text: unknown, identity?: unknown): () => void {
        seen.set.push(identity)
        return () => {}
      },
      /** Records the identity of a rich view registration. */
      registerView(_descriptor: unknown, identity?: unknown): () => void {
        seen.registerView.push(identity)
        return () => {}
      },
    }
    /** The host double, whose `scopes.tuiStatus` IS the activation the host would compare against. */
    const host = hostDouble({ tuiStatus: status })
    /** The adapter under test. */
    const adapter = createTuiAdapter(host.ctx)
    /** A consumer ctx, deliberately a different object from the injected scope. */
    const consumerCtx = { consumer: true }
    adapter.setStatus("mpd-tui", "line", consumerCtx)
    adapter.registerStatusView({ key: "mpd-tui", identity: consumerCtx, render: () => "line" })
    adapter.registerStatusComponent({ key: "mpd-tui-keyhook", identity: consumerCtx, component: () => null })
    // TWO text writes: the explicit `setStatus` and the view's first publish (it publishes once at
    // bind), and exactly ONE rich registration.
    expect(seen.set).toHaveLength(2)
    expect(seen.registerView).toHaveLength(1)
    for (const identity of seen.set) {
      // The identity IS the bound injected scope …
      expect(identity).toBe(host.scopes.tuiStatus)
      // … and NOT the consumer's ctx, which is what the host refuses.
      expect(identity).not.toBe(consumerCtx)
    }
    expect(seen.registerView[0]).toBe(host.scopes.tuiStatus)
    expect(seen.registerView[0]).not.toBe(consumerCtx)
  })

  test("a remembered kit is preferred over the probed module, and the capability names the source", () => {
    /** What the probed contact answers (the foreign module instance: nothing usable). */
    const probed = { useStdin: () => undefined }
    /** What the host kit answers (the live context value). */
    const live = { internal_querier: {}, internal_eventEmitter: {} }
    /** The kit a scene render would hand the plugin. */
    const kit = { useStdin: () => live }
    /** The adapter under test, with an injected contact standing in for the probed module. */
    const adapter = createTuiAdapter({}, { hostInput: probed })
    expect(adapter.hostInput()?.useStdin()).toBeUndefined()
    expect(adapter.capabilities().hostInput.kit).toBe("probed")
    expect(adapter.rememberHostKit(kit)).toBe(true)
    // The kit wins from here on: the same call now resolves the live value.
    expect(adapter.hostInput()?.useStdin()).toBe(live)
    expect(adapter.capabilities().hostInput.state).toBe("bound")
    expect(adapter.capabilities().hostInput.kit).toBe("remembered")
    expect(String(adapter.capabilities().hostInput.detail)).toContain("kit")
  })

  test("a kit without a callable useStdin is refused, and the previous contact stands", () => {
    /** The probed contact the adapter starts from. */
    const probed = { useStdin: () => "probed" }
    /** The adapter under test. */
    const adapter = createTuiAdapter({}, { hostInput: probed })
    expect(adapter.rememberHostKit(undefined)).toBe(false)
    expect(adapter.rememberHostKit(null)).toBe(false)
    expect(adapter.rememberHostKit({ Box: () => null })).toBe(false)
    expect(adapter.rememberHostKit({ useStdin: "not-a-function" })).toBe(false)
    expect(adapter.hostInput()?.useStdin()).toBe("probed")
    expect(adapter.capabilities().hostInput.kit).toBe("probed")
  })

  test("a kit arriving AFTER the probe settled wakes a waiting subscriber exactly once", async () => {
    // The bootstrap path: the probe finds nothing (this host answers nothing from the imported
    // module), the take-over is inert, and a later scene render hands over the kit that arms it.
    /** The kit a scene render would hand over. */
    const kit = { useStdin: () => ({ internal_querier: {}, internal_eventEmitter: {} }) }
    /** The adapter whose probe is expected to come up empty. */
    const adapter = createTuiAdapter({}, { probeHostContact: true, hostInputLog: () => {} })
    /** Every value the subscriber saw, in call order. */
    const seen: unknown[] = []
    adapter.whenHostInput((input) => seen.push(input?.useStdin()))
    expect(seen).toEqual([])
    // The wake is deferred by one microtask (it runs inside a scene's React render); drain it first.
    expect(adapter.rememberHostKit(kit)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toHaveLength(1)
    expect(adapter.capabilities().hostInput.kit).toBe("remembered")
    // ONE wake only: every scene render reports a kit, and that must not re-fire the subscriber.
    adapter.rememberHostKit(kit)
    await Promise.resolve()
    expect(seen).toHaveLength(1)
  })
})

// ── the rich status view the host contact exists to serve ───────────────────────────────────────

describe("rich status view registration", () => {
  test("a bound status service registers the view and reports it as requested", () => {
    /** Every descriptor the host double received. */
    const registered: { key: string; maxRows?: number; component: unknown }[] = []
    /** The host double's status service. */
    const status = {
      /** The text form is unused by this arm. */
      set: () => undefined,
      /** Records the rich registration and returns a disposer, as a host admission does. */
      registerView: (descriptor: { key: string; maxRows?: number; component: unknown }) => {
        registered.push(descriptor)
        return () => {}
      },
    }
    /** The adapter under test. */
    const adapter = createTuiAdapter(hostDouble({ tuiStatus: status }).ctx)
    /** The component under test (never rendered here: the host double only records it). */
    const component = (): null => null
    /** The registration's handle. */
    const handle = adapter.registerStatusComponent({ key: "mpd-tui-hook", component, maxRows: 1 })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.key).toBe("mpd-tui-hook")
    expect(registered[0]?.maxRows).toBe(1)
    expect(registered[0]?.component).toBe(component)
    expect(handle.outcome().state).toBe("requested")
    expect(handle.bound()).toBe(true)
  })

  test("a host refusal (undefined) and a host without registerView are both reported refused", () => {
    /** A host double whose registration is refused, as the real one does for a bad descriptor. */
    const refusing = { /** Unused text form. */ set: () => undefined, /** The refusal contract. */ registerView: () => undefined }
    /** A host double from before the rich form existed. */
    const legacy = { /** The only member an older host carries. */ set: () => undefined }
    /** The handle for the refusing host. */
    const refused = createTuiAdapter(hostDouble({ tuiStatus: refusing }).ctx).registerStatusComponent({ key: "mpd-tui-hook", component: () => null })
    expect(refused.outcome().state).toBe("refused")
    expect(refused.outcome().detail).toContain("refused view")
    /** The handle for the legacy host, where the member is absent rather than refusing. */
    const missing = createTuiAdapter(hostDouble({ tuiStatus: legacy }).ctx).registerStatusComponent({ key: "mpd-tui-hook", component: () => null })
    expect(missing.outcome().state).toBe("refused")
    expect(missing.outcome().detail).toContain("registerView is missing")
  })
})
